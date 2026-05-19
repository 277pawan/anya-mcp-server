# 🗄️ Anya DB — Operations Guide

> All commands run from project root: `/home/pawan-bisht/Documents/anya-mcp-server`

---

## ⚡ Quick Reference

| Action | Command |
|---|---|
| Migrate + start server | `npm start` |
| Run migration only | `npm run migrate` |
| Seed from userContext.json | `npm run seed` |
| Start server only | `npm run dev:server` |

---

## 🔐 First-Time PostgreSQL Setup

Run once to grant the `anya` user schema access (PostgreSQL 15+ requires this):

```bash
psql -U postgres -d anya_db -c "GRANT ALL ON SCHEMA public TO anya; GRANT ALL PRIVILEGES ON DATABASE anya_db TO anya;"
```

---

## 📦 Migration

Runs `src/db/migrations/001_init.sql` — creates all tables, indexes, enums, and triggers.
Safe to re-run — uses `CREATE TABLE IF NOT EXISTS` and `DO $$ ... EXCEPTION WHEN duplicate_object` everywhere.

```bash
npm run migrate
```

**If migration fails:**
```bash
# Check which table failed
psql -U anya -d anya_db -c "\dt"

# Drop all and start fresh (DESTRUCTIVE — loses all data)
psql -U anya -d anya_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO anya;"
npm run migrate
```

---

## 🌱 Seed

Seeds all data from `src/dummydata/userContext.json` into the DB.
Run **once** after first migration. Prints your `DEFAULT_USER_ID` UUID.

```bash
npm run seed
```

After seed, copy the printed UUID into `.env`:
```
DEFAULT_USER_ID=<uuid-printed-by-seed>
```

**Re-seeding** is safe — uses `ON CONFLICT DO UPDATE` for upserts (won't duplicate).

---

## 🔧 Common ALTER Operations

### Add a column
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_col TEXT;
```

### Drop a column
```sql
ALTER TABLE users DROP COLUMN IF EXISTS old_col;
```

### Add a new ENUM value
```sql
ALTER TYPE nudge_category_enum ADD VALUE IF NOT EXISTS 'new_category';
```

### Add a new index
```sql
CREATE INDEX IF NOT EXISTS idx_name ON table_name (column_name);
```

### Drop an index
```sql
DROP INDEX IF EXISTS idx_name;
```

---

## 🗑️ Drop Operations

### Drop a single table (cascade removes FK dependencies)
```sql
-- Connect first: psql -U anya -d anya_db
DROP TABLE IF EXISTS table_name CASCADE;
```

### Drop all tables (full reset — DESTRUCTIVE)
```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO anya;
```
Then re-run `npm run migrate`.

### Drop and recreate an ENUM type
```sql
-- Must remove all columns using the enum first
ALTER TABLE nudges ALTER COLUMN theme TYPE TEXT;
DROP TYPE IF EXISTS nudge_theme_enum;
CREATE TYPE nudge_theme_enum AS ENUM ('normal', 'rabbit_hole', 'deep_dive', 'quick_hit', 'new_value');
ALTER TABLE nudges ALTER COLUMN theme TYPE nudge_theme_enum USING theme::nudge_theme_enum;
```

---

## 🔍 Useful psql Commands

```bash
# Connect to DB
psql -U anya -d anya_db

# Inside psql:
\dt              # list all tables
\d table_name    # describe a table (columns, types, constraints)
\di              # list all indexes
\dT              # list all custom types (enums)
\dn              # list schemas
\q               # quit
```

### Useful queries

```sql
-- Count rows in all tables
SELECT schemaname, tablename, n_live_tup AS row_count
FROM pg_stat_user_tables ORDER BY n_live_tup DESC;

-- Check all indexes on a table
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'nudges';

-- Check user permissions
SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'users';
```

---

## 🔄 Adding a New Migration

1. Create `src/db/migrations/002_your_change.sql`
2. Update `migrate.js` to also run it:

```js
// In src/db/migrate.js — add after 001:
const sql2 = readFileSync(join(__dirname, 'migrations/002_your_change.sql'), 'utf8');
await client.query(sql2);
```

Or keep it simple — just add new `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` statements directly to the bottom of `001_init.sql` (since it's idempotent).

---

## 🖥️ Adminer (DB GUI)

```bash
# Start Adminer on http://localhost:8080
php -S localhost:8080 adminer/adminer.php
```

Login:
| Field | Value |
|---|---|
| System | PostgreSQL |
| Server | `127.0.0.1` |
| Username | `anya` |
| Password | `anya123` |
| Database | `anya_db` |

---

## 📁 DB File Structure

```
src/db/
├── pool.js              # pg Pool singleton + withTransaction helper
├── migrate.js           # Runs 001_init.sql
├── seed.js              # Seeds from userContext.json
└── migrations/
    └── 001_init.sql     # Full schema (tables, indexes, enums, triggers)
```

// Running Adminer throught PHP
cd ~/Documents/anya-mcp-server
php -S localhost:8080 adminer/adminer.php
