import pool from './src/db/pool.js';

async function checkTime() {
  try {
    const sysTime = new Date().toString();
    const sysTimeISO = new Date().toISOString();
    console.log('System Local Time:', sysTime);
    console.log('System ISO Time (UTC):', sysTimeISO);

    const { rows: pgTime } = await pool.query("SELECT now(), now() AT TIME ZONE 'UTC' as now_utc, current_setting('timezone') as tz;");
    console.log('PostgreSQL now() output:', pgTime[0].now);
    console.log('PostgreSQL now_utc output:', pgTime[0].now_utc);
    console.log('PostgreSQL timezone setting:', pgTime[0].tz);

    const { rows: testCalls } = await pool.query("SELECT id, tool, called_at FROM mcp_tool_calls ORDER BY called_at DESC LIMIT 5;");
    console.log('Latest 5 MCP Calls:');
    testCalls.forEach(c => {
      console.log(`- Tool: ${c.tool}, Raw called_at in Node: ${c.called_at} (Type: ${typeof c.called_at}), toISOString: ${c.called_at instanceof Date ? c.called_at.toISOString() : c.called_at}`);
    });
  } catch (err) {
    console.error('Error running checkTime:', err);
  } finally {
    await pool.end();
  }
}

checkTime();
