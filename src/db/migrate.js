// src/db/migrate.js — Run SQL migrations
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  Running migration: 001_init.sql...');
    const sql = readFileSync(join(__dirname, 'migrations/001_init.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    if (err.detail) console.error('📍 Detail:', err.detail);
    if (err.hint)   console.error('💡 Hint:',   err.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

migrate();
