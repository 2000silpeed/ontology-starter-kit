import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { pool } from './db.ts';
import { metaRoute } from './routes/meta.ts';
import { objectsRoute } from './routes/objects.ts';
import { actionsRoute } from './routes/actions.ts';

const app = new Hono();

app.get('/health', async (c) => {
  const r = await pool.query('SELECT 1 AS ok');
  return c.json({ ok: r.rows[0]?.ok === 1 });
});

app.route('/', metaRoute);
app.route('/', objectsRoute);
app.route('/', actionsRoute);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

const port = Number(process.env.PORT ?? 3456);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ontology-starter-kit listening on http://localhost:${info.port}`);
});
