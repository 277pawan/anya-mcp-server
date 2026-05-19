// src/services/calendar.service.js
import { query, withTransaction } from '../db/pool.js';
import { getCalendar } from '../mcp/mcp-client.js';

export async function listCalendarEvents(userId, { from, to, search, limit = 50, offset = 0 }) {
  let sql = `SELECT * FROM calendar_events WHERE user_id = $1 AND status != 'cancelled'`;
  const params = [userId];
  let i = 2;
  if (from)   { sql += ` AND start_time >= $${i++}`; params.push(from); }
  if (to)     { sql += ` AND start_time <= $${i++}`; params.push(to); }
  if (search) { sql += ` AND to_tsvector('english', title || ' ' || COALESCE(description,'')) @@ plainto_tsquery('english', $${i++})`; params.push(search); }
  sql += ` ORDER BY start_time ASC LIMIT $${i++} OFFSET $${i++}`;
  params.push(limit, offset);
  const { rows } = await query(sql, params);
  return rows;
}

export async function getCalendarEventById(userId, id) {
  const { rows } = await query(
    `SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2`, [id, userId]
  );
  return rows[0] || null;
}

export async function upsertCalendarEvent(userId, event) {
  const {
    id, google_event_id, title, description, location,
    start_time, end_time, is_all_day = false, status = 'confirmed',
    attendees = [], recurrence = [], meet_link, raw_data = {}
  } = event;

  if (id) {
    const { rows } = await query(
      `UPDATE calendar_events SET
         google_event_id = COALESCE($3, google_event_id),
         title = COALESCE($4, title),
         description = $5, location = $6,
         start_time = COALESCE($7, start_time),
         end_time = COALESCE($8, end_time),
         is_all_day = $9, status = $10,
         attendees = $11::jsonb, recurrence = $12,
         meet_link = $13, raw_data = $14::jsonb,
         synced_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, google_event_id||null, title||null, description||null, location||null,
       start_time||null, end_time||null, is_all_day, status,
       JSON.stringify(attendees), recurrence, meet_link||null, JSON.stringify(raw_data)]
    );
    return rows[0];
  }

  const { rows } = await query(
    `INSERT INTO calendar_events
       (user_id, google_event_id, title, description, location, start_time, end_time,
        is_all_day, status, attendees, recurrence, meet_link, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb)
     ON CONFLICT (google_event_id) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       location = EXCLUDED.location, start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time, status = EXCLUDED.status,
       attendees = EXCLUDED.attendees, meet_link = EXCLUDED.meet_link,
       raw_data = EXCLUDED.raw_data, synced_at = now(), updated_at = now()
     RETURNING *`,
    [userId, google_event_id||null, title, description||null, location||null,
     start_time, end_time, is_all_day, status,
     JSON.stringify(attendees), recurrence, meet_link||null, JSON.stringify(raw_data)]
  );
  return rows[0];
}

export async function deleteCalendarEvent(userId, id) {
  const { rows } = await query(
    `UPDATE calendar_events SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}

export async function getTodayEvents(userId) {
  const { rows } = await query(
    `SELECT * FROM calendar_events
     WHERE user_id = $1
       AND status != 'cancelled'
       AND start_time >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
       AND start_time <  date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata' + interval '1 day') AT TIME ZONE 'Asia/Kolkata'
     ORDER BY start_time ASC`,
    [userId]
  );
  return rows;
}

export async function getUpcomingEvents(userId, days = 7) {
  const { rows } = await query(
    `SELECT * FROM calendar_events
     WHERE user_id = $1
       AND status != 'cancelled'
       AND start_time >= now()
       AND start_time <= now() + ($2 || ' days')::interval
     ORDER BY start_time ASC`,
    [userId, days]
  );
  return rows;
}

export async function syncTodayFromGoogle(userId) {
  const today = new Date().toISOString().split('T')[0];
  const result = await getCalendar(today);
  const events = result?.events || result || [];
  const synced = [];
  for (const ev of events) {
    const synced_ev = await upsertCalendarEvent(userId, {
      google_event_id: ev.id || ev.eventId,
      title:           ev.summary || ev.title || 'Untitled',
      description:     ev.description || null,
      location:        ev.location || null,
      start_time:      ev.start?.dateTime || ev.startTime || ev.start,
      end_time:        ev.end?.dateTime || ev.endTime || ev.end,
      is_all_day:      !!(ev.start?.date),
      status:          ev.status || 'confirmed',
      attendees:       ev.attendees || [],
      meet_link:       ev.hangoutLink || ev.meetLink || null,
      raw_data:        ev,
    });
    synced.push(synced_ev);
  }
  return synced;
}
