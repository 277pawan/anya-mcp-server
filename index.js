import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { google } from "googleapis";
import { z } from "zod";

dotenv.config();

const timeZone = "Asia/Kolkata";
const BASEURL = "https://maps.googleapis.com/maps/api";

const server = new McpServer({
  name: "pawan-calendar",
  version: "1.0.0",
});

//  Pure JS — zero date-fns, zero format strings, zero 'n' token risk
function getDayBoundsInIST(dateStr) {
  // Build midnight IST for the given date using Temporal-style trick
  const [year, month, day] = new Date(dateStr)
    .toLocaleDateString("en-CA", { timeZone }) // gives "YYYY-MM-DD" in IST
    .split("-")
    .map(Number);

  // Midnight IST = UTC-5:30 offset, so add 330 minutes worth of ms back
  const ISTOffsetMs = 5.5 * 60 * 60 * 1000;

  const startUTC = new Date(Date.UTC(year, month - 1, day) - ISTOffsetMs);
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);

  return {
    timeMin: startUTC.toISOString(),
    timeMax: endUTC.toISOString(),
  };
}

//  Safe display formatter — no date-fns, no format tokens
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
    auth: process.env.GOOGLE_PUBLIC_API_KEY,
  });

  const { timeMin, timeMax } = getDayBoundsInIST(date);

  try {
    const res = await calendar.events.list({
      calendarId: process.env.CALENDAR_ID,
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
  {
    date: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid date format. Please provide a valid date string.",
    }),
  },
  async ({ date }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(await getMyCalendarDataByDate(date)),
        },
      ],
    };
  },
);
async function fetchMaps(endpoint, params) {
  const url = new URL(`${BASEURL}/${endpoint}/json`);
  Object.enteries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "ok" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      `Google API error: ${data.status} - ${data.error_message || ""}`,
    );
  }
  return data;
}

server.tool(
  "geocodeAddress",
  {
    address: z.string().describe("Address to convert to coordinates"),
  },
  async ({ address }) => {
    const data = await fetchMaps("geocode", { address });
    const result = data.results[0];

    if (!result) {
      return {
        content: [{ type: "text", text: "No results found for this address." }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              formatted_address: result.formatted_address,
              lat: result.geometry.location.lat,
              lng: result.geometry.location.lng,
              place_id: result.place_id,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

async function init() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

init();
