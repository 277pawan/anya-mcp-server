// books-mcp.js - Fixed version
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

const server = new McpServer({
  name: "pawan-books",
  version: "1.0.0",
});

async function fetchAPI(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`API Error: ${data.error.message || data.error.status}`);
  }
  return data;
}

server.tool(
  "searchBooks",
  {
    query: z
      .string()
      .describe("Search query e.g. 'system design' or 'author:robert martin'"),
    maxResults: z
      .number()
      .optional()
      .default(4)
      .describe("Max results to return (max 40)"),
    language: z
      .string()
      .optional()
      .describe("Filter by language code e.g. en, hi, fr"),
  },
  async ({ query, maxResults, language }) => {
    let url = `https://www.googleapis.com/books/v1/volumes?key=${CONFIG.GOOGLE_PUBLIC_API_KEY}`;
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
    const url = `https://www.googleapis.com/books/v1/volumes/${volume_id}?key=${CONFIG.GOOGLE_PUBLIC_API_KEY}`;

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
    maxResults: z.number().optional().default(4),
  },
  async ({ author, maxResults }) => {
    const url = `https://www.googleapis.com/books/v1/volumes?key=${CONIFG.GOOGLE_PUBLIC_API_KEY}&q=inauthor:${encodeURIComponent(author)}&maxResults=${maxResults}`;

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
