// scratch_check_db.js
import dotenv from 'dotenv';
dotenv.config();

import { query } from './src/db/pool.js';

async function checkUser() {
  const userId = '89968338-6678-48e0-be01-f8472e550e1d';
  try {
    const { rows } = await query(
      `SELECT id, name, email, fcm_token, preferences FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    console.log("=== DB USER RECORD ===");
    console.log(JSON.stringify(rows[0], null, 2));
    process.exit(0);
  } catch (err) {
    console.error("DB Query failed:", err.message);
    process.exit(1);
  }
}

checkUser();
