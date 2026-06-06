// src/db/migrate.js — Run all SQL migrations in numeric order
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    // Auto-discover all *.sql files in migrations/ sorted numerically (001_, 002_, ...)
    const migrationsDir = join(__dirname, 'migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`🗄️  Checking ${files.length} migration(s)...`);
    let applied = 0;
    for (const file of files) {
      const existing = await client.query(
        `SELECT 1 FROM _schema_migrations WHERE filename = $1`,
        [file],
      );
      if (existing.rows.length > 0) {
        console.log(`  ⏭  ${file} (already applied)`);
        continue;
      }

      console.log(`  ▶ ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO _schema_migrations (filename) VALUES ($1)`,
          [file],
        );
        await client.query('COMMIT');
        applied += 1;
        console.log(`  ✅ ${file} done`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log(
      applied > 0
        ? `✅ Applied ${applied} new migration(s)!`
        : '✅ Database schema is up to date.',
    );
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    if (err.detail) console.error('📍 Detail:', err.detail);
    if (err.hint)   console.error('💡 Hint:',   err.hint);
    throw err;
  } finally {
    client.release();
  }
}

// Run standalone if executed directly
const nodePath = process.argv[1];
if (nodePath && (nodePath.endsWith('migrate.js') || nodePath.endsWith('migrate'))) {
  runMigrations()
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch(() => {
      pool.end();
      process.exit(1);
    });
}
