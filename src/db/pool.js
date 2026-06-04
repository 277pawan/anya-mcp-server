// src/db/pool.js — PostgreSQL connection pool singleton
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Always load .env from project root regardless of where node is invoked from
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'anya_db',
  user:     process.env.DB_USER     || 'postgres',
  password: String(process.env.DB_PASSWORD ?? ''),  // must be a string, never undefined
  max:      20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err);
});

/**
 * Execute a query with optional params.
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 query:', { duration: `${Date.now() - start}ms`, rows: res.rowCount });
  }
  return res;
}

/**
 * Get a raw client — caller MUST release() in a finally block.
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Run a function inside a transaction.
 * Auto commits on success, rolls back on error.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
