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

async function fetchAPI(url) {
  const res = await fetch(url);
  const data = await res.json();
  // BUG FIX #5: data.error.message can be undefined — use safe access + fallback
  if (data.error) {
    throw new Error(
      `API Error: ${data.error?.message || data.error?.status || JSON.stringify(data.error)}`,
    );
  }
  return data;
}

function getDayBoundsInIST(dateStr) {
  const [year, month, day] = new Date(dateStr)
    .toLocaleDateString("en-CA", { timeZone })
    .split("-")
    .map(Number);

  // BUG FIX #3: IST is UTC+5:30, so midnight IST = UTC minus 5.5 hours
  // To get UTC time of midnight IST: subtract 5.5h from midnight UTC
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
  // Using API key auth — works for public calendars
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
  "Get all calendar events/meetings for a specific date. Use this when the user asks about their schedule, meetings, or events on a particular day. Always pass the date as a string in YYYY-MM-DD format.",
  {
    date: z
      .string()
      .describe(
        "The date to fetch calendar events for, in YYYY-MM-DD format. Example: '2025-04-25'",
      )
      .refine((val) => !isNaN(Date.parse(val)), {
        message:
          "Invalid date format. Please provide a date in YYYY-MM-DD format.",
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

// BUG FIX #1: "Object.enteries" → "Object.entries"
// BUG FIX #2: "ok" → "OK" (Google Maps API returns uppercase status)
async function fetchMaps(endpoint, params) {
  const url = new URL(`${BASEURL}/${endpoint}/json`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
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

server.tool(
  "reverseGeocode",
  {
    lat: z.number().describe("Latitude"),
    lng: z.number().describe("Longitude"),
  },
  async ({ lat, lng }) => {
    const data = await fetchMaps("geocode", { latlng: `${lat},${lng}` });
    const result = data.results[0];

    if (!result) {
      return {
        content: [
          { type: "text", text: "No address found for these coordinates." },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              formatted_address: result.formatted_address,
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

server.tool(
  "searchNearbyPlaces",
  {
    location: z.string().describe("Address or place name to search around"),
    radius: z.number().default(1000).describe("Search radius in meters"),
    type: z
      .string()
      .optional()
      .describe("Place type e.g. restaurant, hospital, school"),
    keyword: z.string().optional().describe("Keyword to filter results"),
  },
  async ({ location, radius, type, keyword }) => {
    const geo = await fetchMaps("geocode", { address: location });
    const { lat, lng } = geo.results[0].geometry.location;

    const params = {
      location: `${lat},${lng}`,
      radius: radius.toString(),
    };
    if (type) params.type = type;
    if (keyword) params.keyword = keyword;

    const data = await fetchMaps("place/nearbysearch", params);

    const places = data.results.slice(0, 10).map((place) => ({
      name: place.name,
      address: place.vicinity,
      rating: place.rating,
      total_ratings: place.user_ratings_total,
      open_now: place.opening_hours?.open_now,
      place_id: place.place_id,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(places, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "getPlaceDetails",
  {
    place_id: z.string().describe("Google Place ID"),
  },
  async ({ place_id }) => {
    const data = await fetchMaps("place/details", {
      place_id,
      fields:
        "name,formatted_address,formatted_phone_number,website,rating,opening_hours,reviews",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data.result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "getDirections",
  {
    origin: z.string().describe("Starting location"),
    destination: z.string().describe("Destination location"),
    mode: z
      .enum(["driving", "walking", "bicycling", "transit"])
      .default("driving")
      .describe("Travel mode"),
  },
  async ({ origin, destination, mode }) => {
    const data = await fetchMaps("directions", { origin, destination, mode });

    if (!data.routes.length) {
      return {
        content: [{ type: "text", text: "No routes found." }],
      };
    }

    const route = data.routes[0].legs[0];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              from: route.start_address,
              to: route.end_address,
              distance: route.distance.text,
              duration: route.duration.text,
              steps: route.steps.map((step) =>
                step.html_instructions.replace(/<[^>]+>/g, ""),
              ),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "getDistance",
  {
    origins: z.string().describe("Starting location"),
    destinations: z.string().describe("Destination location"),
    mode: z
      .enum(["driving", "walking", "bicycling", "transit"])
      .default("driving"),
  },
  async ({ origins, destinations, mode }) => {
    const data = await fetchMaps("distancematrix", {
      origins,
      destinations,
      mode,
    });

    const result = data.rows[0].elements[0];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              from: data.origin_addresses[0],
              to: data.destination_addresses[0],
              distance: result.distance.text,
              duration: result.duration.text,
              status: result.status,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "searchPlaces",
  {
    query: z.string().describe("Text search query e.g. 'pizza near Delhi'"),
  },
  async ({ query }) => {
    const data = await fetchMaps("place/textsearch", { query });

    const places = data.results.slice(0, 10).map((place) => ({
      name: place.name,
      address: place.formatted_address,
      rating: place.rating,
      total_ratings: place.user_ratings_total,
      place_id: place.place_id,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(places, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "searchBooks",
  {
    query: z
      .string()
      .describe("Search query e.g. 'system design' or 'author:robert martin'"),
    maxResults: z
      .number()
      .optional()
      .default(10)
      .describe("Max results to return (max 40)"),
    language: z
      .string()
      .optional()
      .describe("Filter by language code e.g. en, hi, fr"),
  },
  async ({ query, maxResults, language }) => {
    let url = `https://www.googleapis.com/books/v1/volumes?key=${process.env.GOOGLE_PUBLIC_API_KEY}`;
    url += `&q=${encodeURIComponent(query)}`;
    url += `&maxResults=${maxResults}`;
    if (language) url += `&langRestrict=${language}`;

    const data = await fetchAPI(url);

    if (!data.items || data.items.length === 0) {
      return {
        content: [{ type: "text", text: "No books found." }],
      };
    }

    const books = data.items.map((item) => {
      const info = item.volumeInfo;
      return {
        title: info.title,
        authors: info.authors || [],
        publisher: info.publisher,
        published_date: info.publishedDate,
        description: info.description
          ? info.description.slice(0, 200) + "..."
          : "No description",
        page_count: info.pageCount,
        categories: info.categories || [],
        language: info.language,
        rating: info.averageRating,
        ratings_count: info.ratingsCount,
        preview_link: info.previewLink,
        isbn: info.industryIdentifiers?.[0]?.identifier,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(books, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "getBookDetails",
  {
    volume_id: z.string().describe("Google Books volume ID"),
  },
  async ({ volume_id }) => {
    const url = `https://www.googleapis.com/books/v1/volumes/${volume_id}?key=${process.env.GOOGLE_PUBLIC_API_KEY}`;

    const data = await fetchAPI(url);
    const info = data.volumeInfo;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              title: info.title,
              subtitle: info.subtitle,
              authors: info.authors,
              publisher: info.publisher,
              published_date: info.publishedDate,
              description: info.description,
              page_count: info.pageCount,
              categories: info.categories,
              language: info.language,
              rating: info.averageRating,
              ratings_count: info.ratingsCount,
              preview_link: info.previewLink,
              info_link: info.infoLink,
              isbn_10: info.industryIdentifiers?.find(
                (i) => i.type === "ISBN_10",
              )?.identifier,
              isbn_13: info.industryIdentifiers?.find(
                (i) => i.type === "ISBN_13",
              )?.identifier,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "searchBooksByAuthor",
  {
    author: z.string().describe("Author name to search"),
    maxResults: z.number().optional().default(10),
  },
  async ({ author, maxResults }) => {
    const url = `https://www.googleapis.com/books/v1/volumes?key=${process.env.GOOGLE_PUBLIC_API_KEY}&q=inauthor:${encodeURIComponent(author)}&maxResults=${maxResults}`;

    const data = await fetchAPI(url);

    if (!data.items) {
      return {
        content: [{ type: "text", text: "No books found for this author." }],
      };
    }

    const books = data.items.map((item) => {
      const info = item.volumeInfo;
      return {
        title: info.title,
        published_date: info.publishedDate,
        rating: info.averageRating,
        preview_link: info.previewLink,
        volume_id: item.id,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(books, null, 2),
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
