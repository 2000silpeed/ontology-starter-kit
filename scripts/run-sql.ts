// Applies SQL files sequentially. Usage: npm run db:init
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const files = process.argv.slice(2);
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}
if (files.length === 0) {
  console.error('No SQL files given.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  process.stdout.write(`applying ${file} ... `);
  await pool.query(sql);
  console.log('ok');
}

await pool.end();
console.log('done.');
