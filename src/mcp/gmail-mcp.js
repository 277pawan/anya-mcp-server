import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CONFIG } from "../config/config.js";

const server = new McpServer({
  name: "pawan-gmail",
  version: "1.0.0",
});

// ─── OAuth2 Token Helper ──────────────────────────────────────────────────────
// Exchanges the refresh token for a short-lived access token.
// Gmail API uses Bearer token auth on every request.
async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     CONFIG.GOOGLE_CLIENT_ID,
      client_secret: CONFIG.GOOGLE_CLIENT_SECRET,
      refresh_token: CONFIG.GOOGLE_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Failed to get access token: ${data.error} - ${data.error_description}`
    );
  }
  return data.access_token;
}

// ─── Gmail API Helper ─────────────────────────────────────────────────────────
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Gmail API error: ${res.status} - ${data.error?.message || JSON.stringify(data)}`
    );
  }
  return data;
}

// ─── Base64url encode for RFC 2822 email body ─────────────────────────────────
function encodeEmail(rawEmail) {
  return Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Build RFC 2822 raw email string ─────────────────────────────────────────
function buildRawEmail({ to, cc, bcc, subject, body, isHtml = false, threadId }) {
  const lines = [
    `To: ${to}`,
    cc  ? `Cc: ${cc}`  : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=utf-8`,
    "",
    body,
  ].filter((l) => l !== null);

  return lines.join("\r\n");
}

// ─── 1. listEmails ────────────────────────────────────────────────────────────
// Lists recent emails. Supports Gmail search query syntax (same as the search bar).
server.tool(
  "listEmails",
  {
    query: z
      .string()
      .optional()
      .describe(
        "Gmail search query e.g. 'is:unread', 'from:boss@company.com', 'subject:invoice'. Defaults to inbox."
      ),
    maxResults: z
      .number()
      .default(10)
      .describe("Max number of emails to return (1-50)"),
  },
  async ({ query = "in:inbox", maxResults }) => {
    const params = new URLSearchParams({
      q:          query,
      maxResults: Math.min(maxResults, 50).toString(),
    });

    const listData = await gmailFetch(`/messages?${params}`);

    if (!listData.messages?.length) {
      return {
        content: [{ type: "text", text: "No emails found matching the query." }],
      };
    }

    // Fetch minimal metadata for each message in parallel
    const emails = await Promise.all(
      listData.messages.map((msg) =>
        gmailFetch(`/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
      )
    );

    const results = emails.map((email) => {
      const headers = email.payload?.headers || [];
      const get = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      return {
        id:      email.id,
        threadId: email.threadId,
        from:    get("From"),
        subject: get("Subject"),
        date:    get("Date"),
        snippet: email.snippet,
        labels:  email.labelIds || [],
      };
    });

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ─── 2. getEmail ──────────────────────────────────────────────────────────────
// Reads the full content of a single email by its message ID.
server.tool(
  "getEmail",
  {
    messageId: z.string().describe("Gmail message ID (from listEmails)"),
  },
  async ({ messageId }) => {
    const email = await gmailFetch(`/messages/${messageId}?format=full`);

    const headers = email.payload?.headers || [];
    const get = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    // Recursively find plain-text or HTML body parts
    function extractBody(payload) {
      if (!payload) return "";

      // Direct body data
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, "base64").toString("utf-8");
      }

      // Multipart — prefer text/plain, fall back to text/html
      if (payload.parts) {
        const plain = payload.parts.find((p) => p.mimeType === "text/plain");
        const html  = payload.parts.find((p) => p.mimeType === "text/html");
        const part  = plain || html;
        if (part?.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
        // Nested multipart
        for (const part of payload.parts) {
          const nested = extractBody(part);
          if (nested) return nested;
        }
      }

      return "";
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id:       email.id,
              threadId: email.threadId,
              from:     get("From"),
              to:       get("To"),
              cc:       get("Cc"),
              subject:  get("Subject"),
              date:     get("Date"),
              labels:   email.labelIds || [],
              body:     extractBody(email.payload),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── 3. sendEmail ─────────────────────────────────────────────────────────────
// Sends a new email.
server.tool(
  "sendEmail",
  {
    to:      z.string().describe("Recipient email address(es), comma-separated"),
    subject: z.string().describe("Email subject"),
    body:    z.string().describe("Email body (plain text or HTML)"),
    cc:      z.string().optional().describe("CC recipients, comma-separated"),
    bcc:     z.string().optional().describe("BCC recipients, comma-separated"),
    isHtml:  z.boolean().default(false).describe("Set true if body contains HTML"),
  },
  async ({ to, subject, body, cc, bcc, isHtml }) => {
    const raw = encodeEmail(buildRawEmail({ to, cc, bcc, subject, body, isHtml }));

    const sent = await gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw }),
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: true, messageId: sent.id, threadId: sent.threadId },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── 4. replyToEmail ─────────────────────────────────────────────────────────
// Replies to an existing email thread, preserving the thread.
server.tool(
  "replyToEmail",
  {
    messageId: z.string().describe("Original message ID to reply to"),
    body:      z.string().describe("Reply body text"),
    isHtml:    z.boolean().default(false).describe("Set true if body contains HTML"),
  },
  async ({ messageId, body, isHtml }) => {
    // Fetch original to get headers needed for a proper reply
    const original = await gmailFetch(
      `/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`
    );

    const headers = original.payload?.headers || [];
    const get = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    const originalFrom      = get("From");
    const originalSubject   = get("Subject");
    const originalMessageId = get("Message-ID");
    const originalRefs      = get("References");

    const replySubject = originalSubject.startsWith("Re:")
      ? originalSubject
      : `Re: ${originalSubject}`;

    const references = [originalRefs, originalMessageId]
      .filter(Boolean)
      .join(" ");

    // Build the raw reply with In-Reply-To and References headers
    const rawLines = [
      `To: ${originalFrom}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${originalMessageId}`,
      `References: ${references}`,
      `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=utf-8`,
      "",
      body,
    ].join("\r\n");

    const raw = encodeEmail(rawLines);

    const sent = await gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw, threadId: original.threadId }),
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: true, messageId: sent.id, threadId: sent.threadId },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── 5. searchEmails ─────────────────────────────────────────────────────────
// Dedicated search using full Gmail query syntax.
server.tool(
  "searchEmails",
  {
    query: z
      .string()
      .describe(
        "Gmail search query. Examples: 'from:someone@gmail.com has:attachment', 'subject:invoice after:2024/01/01', 'is:unread label:work'"
      ),
    maxResults: z.number().default(10).describe("Max results (1-50)"),
  },
  async ({ query, maxResults }) => {
    const params = new URLSearchParams({
      q:          query,
      maxResults: Math.min(maxResults, 50).toString(),
    });

    const listData = await gmailFetch(`/messages?${params}`);

    if (!listData.messages?.length) {
      return {
        content: [{ type: "text", text: "No emails found." }],
      };
    }

    const emails = await Promise.all(
      listData.messages.map((msg) =>
        gmailFetch(
          `/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
        )
      )
    );

    const results = emails.map((email) => {
      const headers = email.payload?.headers || [];
      const get = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      return {
        id:      email.id,
        threadId: email.threadId,
        from:    get("From"),
        to:      get("To"),
        subject: get("Subject"),
        date:    get("Date"),
        snippet: email.snippet,
      };
    });

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ─── 6. trashEmail ───────────────────────────────────────────────────────────
// Moves an email to Trash (recoverable, unlike permanent delete).
server.tool(
  "trashEmail",
  {
    messageId: z.string().describe("Gmail message ID to move to trash"),
  },
  async ({ messageId }) => {
    await gmailFetch(`/messages/${messageId}/trash`, { method: "POST" });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, trashed: messageId }, null, 2),
        },
      ],
    };
  }
);

// ─── 7. markAsRead / markAsUnread ────────────────────────────────────────────
server.tool(
  "markEmail",
  {
    messageId: z.string().describe("Gmail message ID"),
    markAs: z
      .enum(["read", "unread"])
      .describe("Mark the email as read or unread"),
  },
  async ({ messageId, markAs }) => {
    const body =
      markAs === "read"
        ? { removeLabelIds: ["UNREAD"] }
        : { addLabelIds: ["UNREAD"] };

    await gmailFetch(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, messageId, markedAs: markAs }, null, 2),
        },
      ],
    };
  }
);

// ─── 8. listLabels ───────────────────────────────────────────────────────────
// Returns all Gmail labels (system + user-created).
server.tool(
  "listLabels",
  {},
  async () => {
    const data = await gmailFetch("/labels");
    const labels = data.labels?.map((l) => ({
      id:   l.id,
      name: l.name,
      type: l.type,
    })) || [];

    return {
      content: [{ type: "text", text: JSON.stringify(labels, null, 2) }],
    };
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────
async function init() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

init();
