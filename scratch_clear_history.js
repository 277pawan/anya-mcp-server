import pool from './src/db/pool.js';

async function clearHistory() {
  try {
    console.log('⏳ Clearing all historical database records...');
    await pool.query('TRUNCATE mcp_tool_calls, ai_model_calls, lead_searches, chat_messages, chat_sessions CASCADE;');
    console.log('✅ Success! Historical records deleted. You now have a clean slate!');
  } catch (err) {
    console.error('❌ Error clearing database history:', err);
  } finally {
    await pool.end();
  }
}

clearHistory();
