// src/db/migrate.js — Run all SQL migrations in numeric order
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const client = await pool.connect();
  try {
    // Auto-discover all *.sql files in migrations/ sorted numerically (001_, 002_, ...)
    const migrationsDir = join(__dirname, 'migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`🗄️  Running ${files.length} migration(s)...`);
    for (const file of files) {
      console.log(`  ▶ ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`  ✅ ${file} done`);
    }
    console.log('✅ All migrations complete!');
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
