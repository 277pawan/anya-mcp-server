// maps-mcp.js - Geoapify Free Tier Edition
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

const server = new McpServer({
  name: "pawan-maps",
  version: "1.0.0",
});

// New base URL for Geoapify
const BASEURL = "https://api.geoapify.com/v1";

async function fetchGeoapify(endpoint, params) {
  // Geoapify expects the API key as a query parameter named 'apiKey'
  params.apiKey = CONFIG.GEOAPIFY_API_KEY;

  const url = new URL(`${BASEURL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  const res = await fetch(url.toString());
  const data = await res.json();

  // Geoapify's status/error handling might differ slightly, but checking for features/properties is a good start
  if (res.ok && data) {
    return data;
  }
  throw new Error(
    `Geoapify API error: ${res.status} - ${data?.error || data?.message || "Unknown error"}`,
  );
}

server.tool(
  "geocodeAddress",
  {
    address: z.string().describe("Address to convert to coordinates"),
  },
  async ({ address }) => {
    // Geoapify 'search' endpoint for forward geocoding
    const data = await fetchGeoapify("geocode/search", { text: address });
    const result = data.features?.[0];

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
              formatted_address: result.properties.formatted,
              lat: result.geometry.coordinates[1],
              lng: result.geometry.coordinates[0],
              place_id: result.properties.place_id,
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
    // Geoapify 'reverse' endpoint
    const data = await fetchGeoapify("geocode/reverse", { lat: lat, lon: lng });
    const result = data.features?.[0];

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
              formatted_address: result.properties.formatted,
              place_id: result.properties.place_id,
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
    // First, geocode the location string to get coordinates
    const geoData = await fetchGeoapify("geocode/search", { text: location });
    const geoResult = geoData.features?.[0];
    if (!geoResult) throw new Error("Location could not be geocoded.");
    const [lng, lat] = geoResult.geometry.coordinates;

    // 'places' endpoint
    const params = {
      categories: type || "catering", // 'catering' is a common fallback for 'restaurant' in OSM categories
      filter: `circle:${lng},${lat},${radius}`,
      bias: `proximity:${lng},${lat}`,
      limit: 10,
    };
    if (keyword) params.name = keyword; // Geoapify uses 'name' for keyword filtering

    const data = await fetchGeoapify("places", params);

    const places =
      data.features?.map((place) => ({
        name: place.properties.name,
        address: place.properties.formatted || place.properties.address_line1,
        rating: place.properties.rank?.confidence, // Rating system is different; confidence is a good proxy
        total_ratings: place.properties.datasource?.raw?.osm_id, // Not directly available
        open_now: place.properties.opening_hours, // May be a string, not a simple boolean
        place_id: place.properties.place_id,
      })) || [];

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
    place_id: z.string().describe("Geoapify Place ID"),
  },
  async ({ place_id }) => {
    // Geoapify 'place details' endpoint
    const data = await fetchGeoapify(`places/${place_id}`, {});
    const result = data.features?.[0];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result?.properties || {}, null, 2),
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
      .enum(["drive", "walk", "bicycle", "transit"]) // Geoapify modes
      .default("drive")
      .describe("Travel mode"),
  },
  async ({ origin, destination, mode }) => {
    // First, geocode both origin and destination
    const originData = await fetchGeoapify("geocode/search", { text: origin });
    const destData = await fetchGeoapify("geocode/search", {
      text: destination,
    });
    const originCoords = originData.features?.[0]?.geometry.coordinates;
    const destCoords = destData.features?.[0]?.geometry.coordinates;
    if (!originCoords || !destCoords) {
      return {
        content: [
          { type: "text", text: "Could not find one or both locations." },
        ],
      };
    }

    // 'routing' endpoint requires waypoints in the format "lon,lat|lon,lat"
    const waypoints = `${originCoords[0]},${originCoords[1]}|${destCoords[0]},${destCoords[1]}`;
    const data = await fetchGeoapify("routing", {
      waypoints: waypoints,
      mode: mode,
      format: "json",
    });

    if (!data.features?.length) {
      return {
        content: [{ type: "text", text: "No routes found." }],
      };
    }

    const route = data.features[0];
    const leg = route.properties.legs?.[0];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              distance: `${(leg.distance / 1000).toFixed(1)} km`,
              duration: `${Math.round(leg.time / 60)} mins`,
              steps: leg.steps?.map((step) => step.instruction.text) || [],
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
    // For a text search, we first geocode the query to get coordinates, then search nearby.
    // This is a simplified approach; a dedicated text search is often part of 'places' with bias.
    const geoData = await fetchGeoapify("geocode/search", { text: query });
    const geoResult = geoData.features?.[0];
    if (!geoResult) throw new Error("Location could not be geocoded.");
    const [lng, lat] = geoResult.geometry.coordinates;

    const data = await fetchGeoapify("places", {
      categories: "catering,commercial",
      filter: `circle:${lng},${lat},2000`,
      bias: `proximity:${lng},${lat}`,
      limit: 10,
    });

    const places =
      data.features?.map((place) => ({
        name: place.properties.name,
        address: place.properties.formatted,
        rating: place.properties.rank?.confidence,
        place_id: place.properties.place_id,
      })) || [];

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
}

init();
