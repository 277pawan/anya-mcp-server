import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

const timeZone = CONFIG.TIMEZONE;

const server = new McpServer({
  name: "pawan-calendar",
  version: "1.0.0",
});

// ─── Auth (OAuth2) ────────────────────────────────────────────────────────────
// Calendar API requires OAuth2, NOT a public API key.
// Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to your config.
function getAuthClient() {
  // Add this guard so you get a clear error if any value is missing
  if (
    !CONFIG.GOOGLE_CLIENT_ID ||
    !CONFIG.GOOGLE_CLIENT_SECRET ||
    !CONFIG.GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error(
      `Missing OAuth credentials: CLIENT_ID=${!!CONFIG.GOOGLE_CLIENT_ID}, SECRET=${!!CONFIG.GOOGLE_CLIENT_SECRET}, REFRESH=${!!CONFIG.GOOGLE_REFRESH_TOKEN}`,
    );
  }

  const auth = new google.auth.OAuth2(
    CONFIG.GOOGLE_CLIENT_ID,
    CONFIG.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: CONFIG.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getCalendarClient() {
  return google.calendar({ version: "v3", auth: getAuthClient() });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDayBoundsInIST(dateStr) {
  const [year, month, day] = new Date(dateStr)
    .toLocaleDateString("en-CA", { timeZone })
    .split("-")
    .map(Number);

  const ISTOffsetMs = 5.5 * 60 * 60 * 1000;
  const startUTC = new Date(Date.UTC(year, month - 1, day) - ISTOffsetMs);
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);

  return {
    timeMin: startUTC.toISOString(),
    timeMax: endUTC.toISOString(),
  };
}

function formatISTDisplay(dateTimeStr) {
  return new Date(dateTimeStr).toLocaleString("en-IN", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Tool 1: Get events for a date ───────────────────────────────────────────
server.tool(
  "getMyCalendarDataByDate",
  "Get all calendar events/meetings for a specific date.",
  {
    date: z.string().describe("Date in YYYY-MM-DD format"),
  },
  async ({ date }) => {
    const calendar = getCalendarClient();
    const { timeMin, timeMax } = getDayBoundsInIST(date);

    try {
      const res = await calendar.events.list({
        calendarId: CONFIG.CALENDAR_ID,
        timeMin,
        timeMax,
        timeZone,
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = res.data.items || [];

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                meetings: [],
                message: "No meetings found for this date.",
              }),
            },
          ],
        };
      }

      const meetings = events.map((event) => ({
        id: event.id,
        summary: event.summary,
        description: event.description || null,
        start: formatISTDisplay(event.start.dateTime || event.start.date),
        end: formatISTDisplay(event.end.dateTime || event.end.date),
        location: event.location || null,
        attendees: event.attendees?.map((a) => a.email) || [],
        meet_link: event.hangoutLink || null,
        status: event.status,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ meetings }) }],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Tool 2: Get upcoming events ─────────────────────────────────────────────
server.tool(
  "getUpcomingEvents",
  "Get upcoming calendar events from today, up to a given number of days ahead.",
  {
    days: z
      .number()
      .optional()
      .default(7)
      .describe("How many days ahead to look (default: 7)"),
    maxResults: z
      .number()
      .optional()
      .default(10)
      .describe("Max number of events to return"),
  },
  async ({ days, maxResults }) => {
    const calendar = getCalendarClient();
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    try {
      const res = await calendar.events.list({
        calendarId: CONFIG.CALENDAR_ID,
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        timeZone,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = (res.data.items || []).map((event) => ({
        id: event.id,
        summary: event.summary,
        start: formatISTDisplay(event.start.dateTime || event.start.date),
        end: formatISTDisplay(event.end.dateTime || event.end.date),
        location: event.location || null,
        meet_link: event.hangoutLink || null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              upcoming_events: events,
              count: events.length,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Tool 3: Create a meeting ─────────────────────────────────────────────────
server.tool(
  "createMeeting",
  "Create a new calendar event/meeting.",
  {
    summary: z.string().describe("Title of the meeting"),
    start_datetime: z
      .string()
      .describe("Start time in ISO format e.g. 2025-06-01T10:00:00"),
    end_datetime: z
      .string()
      .describe("End time in ISO format e.g. 2025-06-01T11:00:00"),
    description: z
      .string()
      .optional()
      .describe("Meeting description or agenda"),
    location: z.string().optional().describe("Physical or virtual location"),
    attendees: z
      .array(z.string())
      .optional()
      .describe("List of attendee email addresses"),
    add_google_meet: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to add a Google Meet link"),
  },
  async ({
    summary,
    start_datetime,
    end_datetime,
    description,
    location,
    attendees,
    add_google_meet,
  }) => {
    const calendar = getCalendarClient();

    const event = {
      summary,
      description,
      location,
      start: { dateTime: new Date(start_datetime).toISOString(), timeZone },
      end: { dateTime: new Date(end_datetime).toISOString(), timeZone },
      attendees: attendees?.map((email) => ({ email })),
    };

    if (add_google_meet) {
      event.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    try {
      const res = await calendar.events.insert({
        calendarId: CONFIG.CALENDAR_ID,
        conferenceDataVersion: add_google_meet ? 1 : 0,
        sendUpdates: attendees?.length ? "all" : "none",
        requestBody: event,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              event_id: res.data.id,
              summary: res.data.summary,
              start: formatISTDisplay(res.data.start.dateTime),
              end: formatISTDisplay(res.data.end.dateTime),
              meet_link: res.data.hangoutLink || null,
              html_link: res.data.htmlLink,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Tool 4: Update a meeting ─────────────────────────────────────────────────
server.tool(
  "updateMeeting",
  "Update an existing calendar event by its event ID.",
  {
    event_id: z.string().describe("Google Calendar event ID"),
    summary: z.string().optional().describe("New title"),
    start_datetime: z
      .string()
      .optional()
      .describe("New start time in ISO format"),
    end_datetime: z.string().optional().describe("New end time in ISO format"),
    description: z.string().optional().describe("New description"),
    location: z.string().optional().describe("New location"),
    attendees: z
      .array(z.string())
      .optional()
      .describe("Updated attendee emails"),
  },
  async ({
    event_id,
    summary,
    start_datetime,
    end_datetime,
    description,
    location,
    attendees,
  }) => {
    const calendar = getCalendarClient();

    try {
      // Fetch existing event first
      const existing = await calendar.events.get({
        calendarId: CONFIG.CALENDAR_ID,
        eventId: event_id,
      });

      const updated = { ...existing.data };

      if (summary) updated.summary = summary;
      if (description) updated.description = description;
      if (location) updated.location = location;
      if (start_datetime)
        updated.start = {
          dateTime: new Date(start_datetime).toISOString(),
          timeZone,
        };
      if (end_datetime)
        updated.end = {
          dateTime: new Date(end_datetime).toISOString(),
          timeZone,
        };
      if (attendees) updated.attendees = attendees.map((email) => ({ email }));

      const res = await calendar.events.update({
        calendarId: CONFIG.CALENDAR_ID,
        eventId: event_id,
        sendUpdates: "all",
        requestBody: updated,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              event_id: res.data.id,
              summary: res.data.summary,
              start: formatISTDisplay(res.data.start.dateTime),
              end: formatISTDisplay(res.data.end.dateTime),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Tool 5: Delete a meeting ─────────────────────────────────────────────────
server.tool(
  "deleteMeeting",
  "Delete a calendar event by its event ID.",
  {
    event_id: z.string().describe("Google Calendar event ID to delete"),
    notify_attendees: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to send cancellation emails to attendees"),
  },
  async ({ event_id, notify_attendees }) => {
    const calendar = getCalendarClient();

    try {
      await calendar.events.delete({
        calendarId: CONFIG.CALENDAR_ID,
        eventId: event_id,
        sendUpdates: notify_attendees ? "all" : "none",
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, deleted_event_id: event_id }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Tool 6: Search events ────────────────────────────────────────────────────
server.tool(
  "searchEvents",
  "Search calendar events by keyword within a date range.",
  {
    query: z.string().describe("Search keyword e.g. 'standup' or 'interview'"),
    from_date: z
      .string()
      .optional()
      .describe("Start of search range in YYYY-MM-DD format (default: today)"),
    to_date: z
      .string()
      .optional()
      .describe(
        "End of search range in YYYY-MM-DD format (default: 30 days ahead)",
      ),
    maxResults: z.number().optional().default(10),
  },
  async ({ query, from_date, to_date, maxResults }) => {
    const calendar = getCalendarClient();

    const timeMin = from_date
      ? new Date(from_date).toISOString()
      : new Date().toISOString();

    const timeMax = to_date
      ? new Date(to_date).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const res = await calendar.events.list({
        calendarId: CONFIG.CALENDAR_ID,
        q: query,
        timeMin,
        timeMax,
        timeZone,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = (res.data.items || []).map((event) => ({
        id: event.id,
        summary: event.summary,
        start: formatISTDisplay(event.start.dateTime || event.start.date),
        end: formatISTDisplay(event.end.dateTime || event.end.date),
        description: event.description || null,
        meet_link: event.hangoutLink || null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results: events, count: events.length }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Tool 7: Get a single event by ID ────────────────────────────────────────
server.tool(
  "getEventById",
  "Fetch full details of a single calendar event by its ID.",
  {
    event_id: z.string().describe("Google Calendar event ID"),
  },
  async ({ event_id }) => {
    const calendar = getCalendarClient();

    try {
      const res = await calendar.events.get({
        calendarId: CONFIG.CALENDAR_ID,
        eventId: event_id,
      });

      const e = res.data;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: e.id,
              summary: e.summary,
              description: e.description,
              location: e.location,
              start: formatISTDisplay(e.start.dateTime || e.start.date),
              end: formatISTDisplay(e.end.dateTime || e.end.date),
              attendees:
                e.attendees?.map((a) => ({
                  email: a.email,
                  status: a.responseStatus,
                })) || [],
              meet_link: e.hangoutLink || null,
              html_link: e.htmlLink,
              status: e.status,
              created: e.created,
              updated: e.updated,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: err.message }) },
        ],
      };
    }
  },
);

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

init();
