import { Hono } from 'hono';
import { db, META_SCHEMA, pool, ident, type ObjectTypeRow, type PropertyRow } from '../db.ts';

export const objectsRoute = new Hono();

async function getType(apiName: string): Promise<ObjectTypeRow | null> {
  const type = await db
    .withSchema(META_SCHEMA)
    .selectFrom('object_type')
    .selectAll()
    .where('api_name', '=', apiName)
    .executeTakeFirst();
  return type ?? null;
}

async function getProps(typeId: string): Promise<PropertyRow[]> {
  return db
    .withSchema(META_SCHEMA)
    .selectFrom('object_property')
    .selectAll()
    .where('object_type_id', '=', typeId)
    .orderBy('api_name')
    .execute();
}

// ── list instances ──────────────────────────────────────────────────────────
objectsRoute.get('/objects/:type', async (c) => {
  const ot = await getType(c.req.param('type'));
  if (!ot) return c.json({ error: `unknown object type "${c.req.param('type')}"` }, 404);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const res = await pool.query(
    `SELECT * FROM ${ident(ot.datasource_schema)}.${ident(ot.datasource_table)} ORDER BY id LIMIT $1`,
    [limit],
  );
  return c.json({ objectType: ot.api_name, count: res.rowCount ?? 0, rows: res.rows });
});

// ── single instance with resolved outbound links ────────────────────────────
objectsRoute.get('/objects/:type/:id', async (c) => {
  const ot = await getType(c.req.param('type'));
  if (!ot) return c.json({ error: `unknown object type "${c.req.param('type')}"` }, 404);
  const id = c.req.param('id');

  const res = await pool.query(
    `SELECT * FROM ${ident(ot.datasource_schema)}.${ident(ot.datasource_table)} WHERE ${ident('id')} = $1`,
    [id],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return c.json({ error: `${ot.api_name} "${id}" not found` }, 404);

  const links = await db
    .withSchema(META_SCHEMA)
    .selectFrom('object_link')
    .selectAll()
    .where('source_type', '=', ot.api_name)
    .orderBy('api_name')
    .execute();

  const resolved = [];
  for (const link of links) {
    const fk = row[link.datasource_column];
    if (fk == null) {
      resolved.push({ link: link.api_name, target: null });
      continue;
    }
    const target = await getType(link.target_type);
    if (!target) {
      resolved.push({ link: link.api_name, target: null });
      continue;
    }
    const tRes = await pool.query(
      `SELECT * FROM ${ident(target.datasource_schema)}.${ident(target.datasource_table)} WHERE ${ident('id')} = $1`,
      [fk],
    );
    const tRow = tRes.rows[0] as Record<string, unknown> | undefined;
    const title = tRow ? (tRow[target.title_property] ?? null) : null;
    resolved.push({
      link: link.api_name,
      target: tRow ? { type: link.target_type, id: fk, title } : null,
    });
  }

  return c.json({ objectType: ot.api_name, row, links: resolved });
});

// ── create an instance (only when the type allows it) ───────────────────────
objectsRoute.post('/objects/:type', async (c) => {
  const ot = await getType(c.req.param('type'));
  if (!ot) return c.json({ error: `unknown object type "${c.req.param('type')}"` }, 404);
  if (!ot.edits_enabled) {
    return c.json({ error: `creation is not enabled for "${ot.api_name}"` }, 403);
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'request body must be a JSON object' }, 400);
  }

  const props = await getProps(ot.id);
  const known = new Set(props.map((p) => p.api_name));
  const unknownKeys = Object.keys(body).filter((k) => !known.has(k));
  if (unknownKeys.length > 0) {
    return c.json({ error: `unknown properties: ${unknownKeys.join(', ')}` }, 400);
  }

  const missing = props.filter((p) => p.required && body[p.api_name] === undefined).map((p) => p.api_name);
  if (missing.length > 0) {
    return c.json({ error: `missing required properties: ${missing.join(', ')}` }, 400);
  }

  const columns: string[] = [];
  const values: unknown[] = [];
  for (const p of props) {
    const v = body[p.api_name];
    if (v === undefined) continue;
    columns.push(p.datasource_column);
    values.push(v);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const res = await pool.query(
    `INSERT INTO ${ident(ot.datasource_schema)}.${ident(ot.datasource_table)} (${columns.map(ident).join(', ')})
     VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return c.json({ ok: true, row: res.rows[0] }, 201);
});

// ── filtered query (typed, parameterized; no free-form SQL) ─────────────────
const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'isNull', 'isNotNull'] as const;

objectsRoute.post('/objects/:type/query', async (c) => {
  const ot = await getType(c.req.param('type'));
  if (!ot) return c.json({ error: `unknown object type "${c.req.param('type')}"` }, 404);

  const body = await c.req.json<{
    filters?: { property?: unknown; op?: unknown; value?: unknown }[];
    limit?: unknown;
  }>().catch(() => null);
  const filters = Array.isArray(body?.filters) ? body.filters : [];
  const limit = Math.min(Math.max(Number(body?.limit ?? 50), 1), 500);

  const props = await getProps(ot.id);
  const byApi = new Map(props.filter((p) => p.searchable).map((p) => [p.api_name, p]));

  const where: string[] = [];
  const values: unknown[] = [];
  for (const f of filters) {
    const prop = byApi.get(String(f.property ?? ''));
    if (!prop) return c.json({ error: `unknown or non-searchable property "${String(f.property)}"` }, 400);
    const op = String(f.op ?? '');
    if (!(OPERATORS as readonly string[]).includes(op)) {
      return c.json({ error: `unknown operator "${op}" (allowed: ${OPERATORS.join(', ')})` }, 400);
    }
    const col = ident(prop.datasource_column);
    if (op === 'isNull') {
      where.push(`${col} IS NULL`);
      continue;
    }
    if (op === 'isNotNull') {
      where.push(`${col} IS NOT NULL`);
      continue;
    }
    const v = f.value;
    if (op === 'in') {
      if (!Array.isArray(v) || v.length === 0) {
        return c.json({ error: `operator "in" requires a non-empty array value` }, 400);
      }
      values.push(v);
      where.push(`${col} = ANY($${values.length})`);
      continue;
    }
    if (op === 'contains') {
      values.push(`%${String(v)}%`);
      where.push(`${col}::text ILIKE $${values.length}`);
      continue;
    }
    values.push(v);
    const sqlOp = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op] ?? '=';
    where.push(`${col} ${sqlOp} $${values.length}`);
  }

  const sql = `SELECT * FROM ${ident(ot.datasource_schema)}.${ident(ot.datasource_table)}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id LIMIT $${values.length + 1}`;
  const res = await pool.query(sql, [...values, limit]);
  return c.json({ objectType: ot.api_name, count: res.rowCount ?? 0, rows: res.rows });
});
