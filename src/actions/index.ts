import { DOMAIN_SCHEMA, ident, type Tx } from '../db.ts';
import { ActionError } from '../errors.ts';

export interface ActionContext extends Tx {
  caller: string;
  now: Date;
}

export interface ActionHandler {
  /** api_name of the object type this action acts on */
  objectType: string;
  run(targetId: string, params: Record<string, unknown>, ctx: ActionContext): Promise<Record<string, unknown>>;
}

// ── example write action: deferShipment ─────────────────────────────────────
// Shape: READ -> VALIDATE -> WRITE (AUDIT is added by the action route).
const deferShipment: ActionHandler = {
  objectType: 'delivery',
  async run(targetId, params, ctx) {
    const newShippedAt = String(params.newShippedAt ?? '');
    const reason = String(params.reason ?? '');
    if (Number.isNaN(Date.parse(newShippedAt))) {
      throw new ActionError(400, `newShippedAt is not a valid date: "${newShippedAt}"`);
    }

    const find = await ctx.query(
      `SELECT id, status, shipped_at FROM ${ident(DOMAIN_SCHEMA)}.${ident('delivery')} WHERE ${ident('id')} = $1`,
      [targetId],
    );
    const row = find.rows[0] as { id: string; status: string; shipped_at: string | null } | undefined;
    if (!row) throw new ActionError(404, `delivery "${targetId}" not found`);
    if (row.status !== 'planned') {
      throw new ActionError(409, `cannot defer delivery "${targetId}" while status is "${row.status}" (must be "planned")`);
    }

    await ctx.query(
      `UPDATE ${ident(DOMAIN_SCHEMA)}.${ident('delivery')} SET ${ident('shipped_at')} = $1 WHERE ${ident('id')} = $2`,
      [newShippedAt, targetId],
    );
    return { id: targetId, status: row.status, shippedAt: newShippedAt, reason };
  },
};

// ── proposal approve: run the wrapped action, then mark the proposal ────────
// Ordering matters: the inner action runs FIRST. If it throws, the proposal
// stays pending and no approve audit row is written — the error propagates.
const approveProposal: ActionHandler = {
  objectType: 'proposal',
  async run(targetId, params, ctx) {
    const decisionNote = typeof params.decisionNote === 'string' ? params.decisionNote : null;

    const find = await ctx.query(
      `SELECT id, action_name, target_type, target_id, params, status, reason
       FROM ${ident(DOMAIN_SCHEMA)}.${ident('proposal')} WHERE ${ident('id')} = $1`,
      [targetId],
    );
    const prop = find.rows[0] as
      | { id: string; action_name: string; target_type: string; target_id: string; params: Record<string, unknown>; status: string; reason: string }
      | undefined;
    if (!prop) throw new ActionError(404, `proposal "${targetId}" not found`);
    if (prop.status !== 'pending') throw new ActionError(409, `proposal "${targetId}" is already ${prop.status}`);

    const inner = getHandler(prop.action_name);
    if (!inner) throw new ActionError(501, `action "${prop.action_name}" has no registered handler`);
    if (inner.objectType !== prop.target_type) {
      throw new ActionError(409, `proposal targets "${prop.target_type}" but action "${prop.action_name}" acts on "${inner.objectType}"`);
    }

    // Re-validate the inner action's parameters against its JSON Schema at
    // execution time: the world may have changed while the proposal waited.
    const innerResult = await inner.run(prop.target_id, prop.params ?? {}, ctx);

    await ctx.query(
      `UPDATE ${ident(DOMAIN_SCHEMA)}.${ident('proposal')}
       SET ${ident('status')} = 'approved', ${ident('decided_by')} = $1, ${ident('decided_at')} = $2, ${ident('decision_note')} = $3
       WHERE ${ident('id')} = $4`,
      [ctx.caller, ctx.now, decisionNote, targetId],
    );
    return { proposal: targetId, executed: prop.action_name, result: innerResult };
  },
};

// ── proposal reject: record the decision, execute nothing ───────────────────
const rejectProposal: ActionHandler = {
  objectType: 'proposal',
  async run(targetId, params, ctx) {
    const decisionNote = typeof params.decisionNote === 'string' ? params.decisionNote : null;

    const find = await ctx.query(
      `SELECT id, status FROM ${ident(DOMAIN_SCHEMA)}.${ident('proposal')} WHERE ${ident('id')} = $1`,
      [targetId],
    );
    const prop = find.rows[0] as { id: string; status: string } | undefined;
    if (!prop) throw new ActionError(404, `proposal "${targetId}" not found`);
    if (prop.status !== 'pending') throw new ActionError(409, `proposal "${targetId}" is already ${prop.status}`);

    await ctx.query(
      `UPDATE ${ident(DOMAIN_SCHEMA)}.${ident('proposal')}
       SET ${ident('status')} = 'rejected', ${ident('decided_by')} = $1, ${ident('decided_at')} = $2, ${ident('decision_note')} = $3
       WHERE ${ident('id')} = $4`,
      [ctx.caller, ctx.now, decisionNote, targetId],
    );
    return { proposal: targetId, status: 'rejected', decisionNote };
  },
};

// ── registry: action_type.api_name -> handler ───────────────────────────────
const registry: Record<string, ActionHandler> = {
  deferShipment,
  approve: approveProposal,
  reject: rejectProposal,
};

export function getHandler(apiName: string): ActionHandler | undefined {
  return registry[apiName];
}
