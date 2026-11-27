import { Kysely, PostgresDialect } from 'kysely';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

export const META_SCHEMA = process.env.META_SCHEMA ?? 'onto_meta';
export const DOMAIN_SCHEMA = process.env.DOMAIN_SCHEMA ?? 'onto_app';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── metadata row shapes (typed access to the meta schema via Kysely) ────────
export interface ObjectTypeRow {
  id: string;
  api_name: string;
  name: string;
  description: string | null;
  datasource_schema: string;
  datasource_table: string;
  title_property: string;
  edits_enabled: boolean;
}

export interface PropertyRow {
  id: string;
  object_type_id: string;
  api_name: string;
  name: string;
  data_type: string;
  required: boolean;
  is_title: boolean;
  datasource_column: string;
  searchable: boolean;
}

export interface LinkRow {
  id: string;
  api_name: string;
  name: string;
  inverse_name: string;
  source_type: string;
  target_type: string;
  cardinality: string;
  datasource_column: string;
}

export interface ActionTypeRow {
  id: string;
  api_name: string;
  name: string;
  description: string;
  object_type: string;
  parameter_schema: unknown;
  allowed_callers: string[] | null;
}

export interface MetaDB {
  object_type: ObjectTypeRow;
  object_property: PropertyRow;
  object_link: LinkRow;
  action_type: ActionTypeRow;
}

export const db = new Kysely<MetaDB>({
  dialect: new PostgresDialect({ pool }),
});

/** Safely quote a SQL identifier (schema, table, column names). */
export function ident(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

// ── transaction helper used by action handlers ──────────────────────────────
export interface Tx {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Tx = {
      query: async (text, values) => client.query(text, values as never[]),
    };
    const out = await fn(tx);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
