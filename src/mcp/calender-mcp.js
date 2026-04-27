import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

// Use CONFIG instead of process.env directly
const timeZone = CONFIG.TIMEZONE;

const server = new McpServer({
  name: "pawan-calendar",
  version: "1.0.0",
});

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

async function getMyCalendarDataByDate(date) {
  const calendar = google.calendar({
    version: "v3",
    auth: CONFIG.GOOGLE_PUBLIC_API_KEY, // Use CONFIG
  });

  const { timeMin, timeMax } = getDayBoundsInIST(date);

  try {
    const res = await calendar.events.list({
      calendarId: CONFIG.CALENDAR_ID, // Use CONFIG
      timeMin,
      timeMax,
      timeZone: "Asia/Kolkata",
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items || [];

    if (events.length === 0) {
      return { meetings: [], message: "No meetings found for this date." };
    }

    const meetings = events.map((event) => {
      const rawStart = event.start.dateTime || event.start.date;
      const display = formatISTDisplay(rawStart);
      return `${event.summary} at ${display}`;
    });

    return { meetings };
  } catch (err) {
    return { error: err.message };
  }
}

server.tool(
  "getMyCalendarDataByDate",
  "Get all calendar events/meetings for a specific date.",
  {
    date: z.string().describe("Date in YYYY-MM-DD format"),
  },
  async ({ date }) => {
    const result = await getMyCalendarDataByDate(date);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

async function init() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

init();
