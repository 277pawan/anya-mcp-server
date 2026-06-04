// maps-mcp.js - Geoapify Free Tier Edition
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

const server = new McpServer({
  name: "pawan-maps",
  version: "1.0.0",
});

// ─── Base URLs ────────────────────────────────────────────────────────────────
// IMPORTANT: Geoapify has TWO versioned base paths:
const BASEURLV1 = "https://api.geoapify.com/v1";
const BASEURLV2 = "https://api.geoapify.com/v2";

// ─── Generic fetch helper ─────────────────────────────────────────────────────
async function fetchGeoapify(baseUrl, endpoint, params) {
  const urlParams = { ...params, apiKey: CONFIG.GEOAPIFY_API_KEY };
  const url = new URL(`${baseUrl}/${endpoint}`);
  Object.entries(urlParams).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  const res = await fetch(url.toString());
  const data = await res.json();

  if (res.ok && data) {
    return data;
  }
  throw new Error(
    `Geoapify API error: ${res.status} - ${data?.error || data?.message || "Unknown error"}`,
  );
}

// ─── 1. geocodeAddress ────────────────────────────────────────────────────────
// Endpoint: GET /v1/geocode/search?text=...
// Returns GeoJSON FeatureCollection; coordinates are [lon, lat].
server.tool(
  "geocodeAddress",
  {
    address: z.string().describe("Address to convert to coordinates"),
  },
  async ({ address }) => {
    const data = await fetchGeoapify(BASEURLV1, "geocode/search", {
      text: address,
      limit: 1,
    });
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
              // coordinates array is [lon, lat] — swap to expose lat/lon clearly
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

// ─── 2. reverseGeocode ───────────────────────────────────────────────────────
// Endpoint: GET /v1/geocode/reverse?lat=...&lon=...
server.tool(
  "reverseGeocode",
  {
    lat: z.number().describe("Latitude"),
    lng: z.number().describe("Longitude"),
  },
  async ({ lat, lng }) => {
    const data = await fetchGeoapify(BASEURLV1, "geocode/reverse", {
      lat,
      lon: lng, // Geoapify uses "lon", not "lng"
    });
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

// ─── 3. searchNearbyPlaces ───────────────────────────────────────────────────
// FIX 1: Places API is v2, not v1 → use BASEURLV2 + "places"
// FIX 2: Circle filter format is "circle:lon,lat,radius" (lon FIRST, then lat)
// FIX 3: `name` param does exact name matching — used correctly for keyword
server.tool(
  "searchNearbyPlaces",
  {
    location: z.string().describe("Address or place name to search around"),
    radius: z.number().default(1000).describe("Search radius in meters"),
    type: z
      .string()
      .optional()
      .describe(
        "Geoapify place category e.g. catering.restaurant, healthcare.hospital, education.school",
      ),
    keyword: z
      .string()
      .optional()
      .describe("Keyword to filter results by name"),
  },
  async ({ location, radius, type, keyword }) => {
    // Step 1: geocode the location string to get a lat/lon centre point
    const geoData = await fetchGeoapify(BASEURLV1, "geocode/search", {
      text: location,
      limit: 1,
    });
    const geoResult = geoData.features?.[0];
    if (!geoResult) throw new Error("Location could not be geocoded.");

    // Geoapify GeoJSON coordinates are [lon, lat]
    const [lon, lat] = geoResult.geometry.coordinates;

    // Auto-map common types to Geoapify categories if they don't contain a dot
    let mappedType = type || "catering.restaurant";
    if (type && !type.includes(".")) {
      const typeMap = {
        hospital: "healthcare.hospital",
        restaurant: "catering.restaurant",
        cafe: "catering.cafe",
        school: "education.school",
        gym: "sport.fitness",
        pharmacy: "healthcare.pharmacy",
        atm: "commercial.finance.atm",
        bank: "commercial.finance.bank",
        park: "leisure.park",
        gas_station: "commercial.gas",
        supermarket: "commercial.supermarket",
        mall: "commercial.shopping_mall"
      };
      mappedType = typeMap[type.toLowerCase()] || type;
    }

    const params = {
      // FIX: circle filter is "circle:lon,lat,radius" — lon comes first
      filter: `circle:${lon},${lat},${radius}`,
      bias: `proximity:${lon},${lat}`,
      categories: mappedType,
      limit: 10,
    };
    if (keyword) params.name = keyword;

    // FIX: Places API lives at v2/places
    const data = await fetchGeoapify(BASEURLV2, "places", params);

    const places =
      data.features?.map((place) => ({
        name: place.properties.name,
        address: place.properties.formatted || place.properties.address_line1,
        categories: place.properties.categories,
        open_now: place.properties.opening_hours ?? null,
        place_id: place.properties.place_id,
      })) || [];

    return {
      content: [{ type: "text", text: JSON.stringify(places, null, 2) }],
    };
  },
);

// ─── 4. getPlaceDetails ──────────────────────────────────────────────────────
// FIX: Place Details API is at v2/place-details?id=PLACE_ID
//      NOT v1/places/PLACE_ID — that route does not exist and always 400s.
server.tool(
  "getPlaceDetails",
  {
    place_id: z.string().describe("Geoapify Place ID"),
  },
  async ({ place_id }) => {
    // Correct endpoint: GET /v2/place-details?id=PLACE_ID
    const data = await fetchGeoapify(BASEURLV2, "place-details", {
      id: place_id,
    });
    const result = data.features?.[0];

    if (!result) {
      return {
        content: [
          { type: "text", text: "No details found for this place ID." },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.properties || {}, null, 2),
        },
      ],
    };
  },
);

// ─── 5. getDirections ───────────────────────────────────────────────────────
// FIX 1: Waypoints format must be "lat,lon|lat,lon" (lat first) in default mode,
//         OR "lonlat:lon,lat|lonlat:lon,lat". The old code sent "lon,lat|lon,lat"
//         which is wrong for the default format and gives incorrect routes / 400s.
// FIX 2: Response structure depends on format param:
//         - GeoJSON (default, no format param): data.features[0].properties.legs
//         - JSON (format=json):                 data.results[0].legs
//         The old code passed format=json but parsed data.features — pick one and
//         be consistent. We use the lonlat: prefix format + GeoJSON (default) here
//         so we can drop the format param entirely and parse features correctly.
// FIX 3: "transit" is not a valid Geoapify mode — removed from enum.
//         Valid modes: drive, walk, bicycle, bus, scooter, motorcycle, hike, etc.
server.tool(
  "getDirections",
  {
    origin: z.string().describe("Starting location"),
    destination: z.string().describe("Destination location"),
    mode: z
      .enum(["drive", "walk", "bicycle", "bus", "scooter", "hike"])
      .default("drive")
      .describe("Travel mode"),
  },
  async ({ origin, destination, mode }) => {
    // Geocode both locations
    const [originData, destData] = await Promise.all([
      fetchGeoapify(BASEURLV1, "geocode/search", { text: origin, limit: 1 }),
      fetchGeoapify(BASEURLV1, "geocode/search", {
        text: destination,
        limit: 1,
      }),
    ]);

    const originCoords = originData.features?.[0]?.geometry.coordinates; // [lon, lat]
    const destCoords = destData.features?.[0]?.geometry.coordinates; // [lon, lat]

    if (!originCoords || !destCoords) {
      return {
        content: [
          { type: "text", text: "Could not find one or both locations." },
        ],
      };
    }

    // FIX: Use "lonlat:lon,lat" prefix format so order is unambiguous
    const waypoints = `lonlat:${originCoords[0]},${originCoords[1]}|lonlat:${destCoords[0]},${destCoords[1]}`;

    // No format param → GeoJSON response → parse via data.features
    const data = await fetchGeoapify(BASEURLV1, "routing", {
      waypoints,
      mode,
    });

    if (!data.features?.length) {
      return {
        content: [{ type: "text", text: "No routes found." }],
      };
    }

    // GeoJSON response structure: features[0].properties.legs[0]
    const leg = data.features[0].properties.legs?.[0];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              distance: `${(leg.distance / 1000).toFixed(1)} km`,
              duration: `${Math.round(leg.time / 60)} mins`,
              steps:
                leg.steps
                  ?.map((step) => step.instruction?.text)
                  .filter(Boolean) || [],
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─── 6. searchPlaces ────────────────────────────────────────────────────────
// FIX 1: Places API is v2, not v1.
// FIX 2: Geocoding a compound query like "pizza near Delhi" may return a pizza
//         shop, not a city centre. Extract the city component from the geocoding
//         result's properties to get a proper area anchor, then fall back to the
//         raw coordinates if the city can't be resolved.
// FIX 3: Circle filter lon/lat order corrected.
server.tool(
  "searchPlaces",
  {
    query: z.string().describe("Text search query e.g. 'pizza near Delhi'"),
  },
  async ({ query }) => {
    // Step 1: geocode the whole query to get a rough coordinate + city info
    const geoData = await fetchGeoapify(BASEURLV1, "geocode/search", {
      text: query,
      limit: 1,
    });
    const geoResult = geoData.features?.[0];
    if (!geoResult) throw new Error("Could not resolve location from query.");

    // Step 2: use the city/state from the result to get a proper area centre
    const cityName =
      geoResult.properties.city ||
      geoResult.properties.county ||
      geoResult.properties.state;

    let centerLon, centerLat;

    if (cityName) {
      const cityData = await fetchGeoapify(BASEURLV1, "geocode/search", {
        text: cityName,
        limit: 1,
      });
      const cityResult = cityData.features?.[0];
      if (cityResult) {
        [centerLon, centerLat] = cityResult.geometry.coordinates;
      }
    }

    // Fall back to raw query coordinates if city geocoding failed
    if (!centerLon || !centerLat) {
      [centerLon, centerLat] = geoResult.geometry.coordinates;
    }

    const data = await fetchGeoapify(BASEURLV2, "places", {
      categories: "catering,commercial",
      filter: `circle:${centerLon},${centerLat},5000`,
      bias: `proximity:${centerLon},${centerLat}`,
      limit: 10,
    });

    const places =
      data.features?.map((place) => ({
        name: place.properties.name,
        address: place.properties.formatted,
        categories: place.properties.categories,
        place_id: place.properties.place_id,
      })) || [];

    return {
      content: [{ type: "text", text: JSON.stringify(places, null, 2) }],
    };
  },
);

// ─── Start server ─────────────────────────────────────────────────────────────
async function init() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

init();
