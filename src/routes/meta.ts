import { Hono } from 'hono';
import { db, META_SCHEMA } from '../db.ts';

export const metaRoute = new Hono();

metaRoute.get('/meta/types', async (c) => {
  const rows = await db
    .withSchema(META_SCHEMA)
    .selectFrom('object_type')
    .selectAll()
    .orderBy('api_name')
    .execute();
  return c.json({ count: rows.length, types: rows });
});

metaRoute.get('/meta/types/:type', async (c) => {
  const apiName = c.req.param('type');
  const type = await db
    .withSchema(META_SCHEMA)
    .selectFrom('object_type')
    .selectAll()
    .where('api_name', '=', apiName)
    .executeTakeFirst();
  if (!type) return c.json({ error: `unknown object type "${apiName}"` }, 404);

  const properties = await db
    .withSchema(META_SCHEMA)
    .selectFrom('object_property')
    .selectAll()
    .where('object_type_id', '=', type.id)
    .orderBy('api_name')
    .execute();

  const links = await db
    .withSchema(META_SCHEMA)
    .selectFrom('object_link')
    .selectAll()
    .where('source_type', '=', apiName)
    .orderBy('api_name')
    .execute();

  const actions = await db
    .withSchema(META_SCHEMA)
    .selectFrom('action_type')
    .select(['api_name', 'name', 'description', 'object_type', 'allowed_callers'])
    .where('object_type', '=', apiName)
    .orderBy('api_name')
    .execute();

  return c.json({ type, properties, links, actions });
});

metaRoute.get('/meta/actions', async (c) => {
  const rows = await db
    .withSchema(META_SCHEMA)
    .selectFrom('action_type')
    .selectAll()
    .orderBy('object_type')
    .orderBy('api_name')
    .execute();
  return c.json({ count: rows.length, actions: rows });
});
