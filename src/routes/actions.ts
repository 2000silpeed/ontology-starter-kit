import { Hono } from 'hono';
import { Validator } from '@cfworker/json-schema';
import { db, META_SCHEMA, pool, ident, withTransaction } from '../db.ts';
import { getHandler } from '../actions/index.ts';
import { ActionError } from '../errors.ts';

export const actionsRoute = new Hono();

async function accessLog(caller: string | null, actionName: string, decision: 'allowed' | 'denied', reason?: string) {
  await pool.query(
    `INSERT INTO ${ident(META_SCHEMA)}.${ident('access_log')} (caller, action_name, decision, reason) VALUES ($1, $2, $3, $4)`,
    [caller, actionName, decision, reason ?? null],
  );
}

async function auditLog(caller: string, actionName: string, targetType: string, targetId: string, params: unknown, outcome: 'ok' | 'error') {
  await pool.query(
    `INSERT INTO ${ident(META_SCHEMA)}.${ident('audit_log')} (caller, action_name, target_type, target_id, params, outcome) VALUES ($1, $2, $3, $4, $5, $6)`,
    [caller, actionName, targetType, targetId, JSON.stringify(params ?? {}), outcome],
  );
}

// POST /actions/:objectType/:id/:actionName — the single write surface.
// Flow: resolve action -> authorization gate -> parameter validation
//       -> handler (READ/VALIDATE/WRITE inside a transaction) -> audit.
actionsRoute.post('/actions/:objectType/:id/:actionName', async (c) => {
  const caller = c.req.header('x-caller-identity') ?? 'anonymous';
  const objectType = c.req.param('objectType');
  const targetId = c.req.param('id');
  const actionName = c.req.param('actionName');

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  const actionType = await db
    .withSchema(META_SCHEMA)
    .selectFrom('action_type')
    .selectAll()
    .where('api_name', '=', actionName)
    .executeTakeFirst();
  if (!actionType || actionType.object_type !== objectType) {
    return c.json({ error: `unknown action "${objectType}.${actionName}"` }, 404);
  }

  const handler = getHandler(actionName);
  if (!handler) {
    return c.json({ error: `action "${actionName}" has no registered handler` }, 501);
  }

  // Authorization gate. allowed_callers = NULL means unrestricted;
  // otherwise the exact caller id must appear in the list.
  if (actionType.allowed_callers && !actionType.allowed_callers.includes(caller)) {
    await accessLog(caller, actionName, 'denied', 'caller not in allowed_callers');
    return c.json({ error: `caller "${caller}" is not allowed to run "${actionName}"` }, 403);
  }

  // Parameter validation against the metadata JSON Schema.
  const validator = new Validator(actionType.parameter_schema as Record<string, unknown>);
  const check = validator.validate(body);
  if (!check.valid) {
    const details = check.errors?.map((e) => (e as { error?: string }).error ?? 'validation failed') ?? [];
    await accessLog(caller, actionName, 'denied', 'invalid parameters');
    return c.json({ error: 'invalid parameters', details }, 400);
  }
  await accessLog(caller, actionName, 'allowed');

  try {
    const result = await withTransaction(async (tx) => {
      const out = await handler.run(targetId, body, { caller, now: new Date(), query: tx.query });
      await auditLog(caller, actionName, objectType, targetId, body, 'ok');
      return out;
    });
    return c.json({ ok: true, result });
  } catch (err) {
    if (err instanceof ActionError) {
      // The transaction rolled back; record the failure in a fresh one.
      await withTransaction(async (tx) => {
        await tx.query(
          `INSERT INTO ${ident(META_SCHEMA)}.${ident('audit_log')} (caller, action_name, target_type, target_id, params, outcome) VALUES ($1, $2, $3, $4, $5, 'error')`,
          [caller, actionName, objectType, targetId, JSON.stringify(body ?? {})],
        );
      }).catch(() => {});
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});
