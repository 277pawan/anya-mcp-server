// maps-mcp.js - Fixed version
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

const server = new McpServer({
  name: "pawan-maps",
  version: "1.0.0",
});

const timeZone = "Asia/Kolkata";
const BASEURL = "https://maps.googleapis.com/maps/api";

async function fetchMaps(endpoint, params) {
  const url = new URL(`${BASEURL}/${endpoint}/json`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("key", CONFIG.GOOGLE_MAPS_API_KEY);

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

async function init() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("✅ Maps MCP Server running");
}

init();
