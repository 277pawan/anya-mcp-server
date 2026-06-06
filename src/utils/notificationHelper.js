// src/utils/notificationHelper.js
/**
 * 🔔 Anya Smart Notification Helper
 *
 * A unified, context-aware push notification dispatcher.
 * Works with Firebase FCM (push.service.js) + WebSocket broadcast.
 *
 * Usage:
 *   import { sendSmartNotification } from '../utils/notificationHelper.js';
 *   await sendSmartNotification({ type: 'meeting_alert', userId, token, payload });
 *
 * Notification Types:
 *   - 'meeting_alert'    → Life Engine: upcoming calendar event
 *   - 'ai_reply'         → AI response that surfaces an important insight
 *   - 'mcp_result'       → MCP tool call returned actionable data (maps, books, etc.)
 *   - 'nudge'            → Scheduled life-nudge from nudge scheduler
 *   - 'lead_alert'       → Lead pipeline found a new opportunity
 *   - 'life_insight'     → Daily chat cleanup surfaced a new life_context insight
 *   - 'custom'           → Arbitrary title + body from anywhere in the codebase
 */

import { sendPushNotification } from "../services/push.service.js";
import { broadcast } from "../services/ws-registry.js";
import { query } from "../db/pool.js";

// ─── Config ─────────────────────────────────────────────────────────────────

/**
 * Rules that decide whether a given notification type should be sent.
 * Each type has: minIntervalMs (cooldown), quietHoursRespected, defaultEnabled.
 */
const NOTIFICATION_RULES = {
  meeting_alert: {
    minIntervalMs: 0,
    quietHoursRespected: false,
    defaultEnabled: true,
  },
  ai_reply: {
    minIntervalMs: 5 * 60_000,
    quietHoursRespected: true,
    defaultEnabled: false,
  },
  mcp_result: {
    minIntervalMs: 10 * 60_000,
    quietHoursRespected: true,
    defaultEnabled: true,
  },
  nudge: {
    minIntervalMs: 60 * 60_000,
    quietHoursRespected: true,
    defaultEnabled: true,
  },
  lead_alert: {
    minIntervalMs: 30 * 60_000,
    quietHoursRespected: true,
    defaultEnabled: true,
  },
  life_insight: {
    minIntervalMs: 24 * 3600_000,
    quietHoursRespected: false,
    defaultEnabled: true,
  },
  custom: {
    minIntervalMs: 0,
    quietHoursRespected: false,
    defaultEnabled: true,
  },
};

/** Default quiet hours (IST 22:00 – 07:00). User can override in preferences. */
const DEFAULT_QUIET_START = 22; // 10 PM
const DEFAULT_QUIET_END = 7; // 7 AM

// In-memory per-type cooldown tracker  { `${userId}:${type}` → lastSentMs }
const lastSentMap = new Map();

// ─── Core decision function ───────────────────────────────────────────────────

/**
 * Decides whether to send a notification based on type rules, cooldowns, and quiet hours.
 *
 * @param {object} opts
 * @param {'meeting_alert'|'ai_reply'|'mcp_result'|'nudge'|'lead_alert'|'life_insight'|'custom'} opts.type
 * @param {string}  opts.userId      - User's UUID (used to fetch FCM token + preferences)
 * @param {string}  [opts.token]     - FCM device token. If omitted, fetched from DB.
 * @param {string}  opts.title       - Notification title
 * @param {string}  opts.body        - Notification body text
 * @param {object}  [opts.data]      - Optional FCM data payload (key-value strings)
 * @param {boolean} [opts.wsOnly]    - If true, only send via WebSocket, skip FCM push
 * @param {boolean} [opts.pushOnly]  - If true, only FCM push, skip WebSocket broadcast
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
// Helper to resolve a professional illustration/photo URL based on category and keywords
function getNotificationImage(type, category, text) {
  const normalizedText = (text || "").toLowerCase();

  // If text is open-source/developer focused:
  if (
    normalizedText.includes("open source") ||
    normalizedText.includes("github") ||
    normalizedText.includes("repository") ||
    normalizedText.includes("open-source")
  ) {
    return "https://images.unsplash.com/photo-1618401471353-b98aedd07871?w=600&auto=format&fit=crop&q=80"; // Open source/GitHub desk setup
  }

  if (category === "tech" || category === "business" || normalizedText.includes("code") || normalizedText.includes("coding")) {
    return "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80"; // Tech/code
  }

  // Fallback to category maps
  const categoryImages = {
    health: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=600&auto=format&fit=crop&q=80",      // Mindfulness/Yoga
    mind: "https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=600&auto=format&fit=crop&q=80",        // Zen/Meditation
    body: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600&auto=format&fit=crop&q=80",        // Fitness
    motivation: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&auto=format&fit=crop&q=80",  // Sunset/Beach/Inspiration
    reflection: "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=600&auto=format&fit=crop&q=80",  // Nature reflection
    innovation: "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=600&auto=format&fit=crop&q=80",  // Art/Creativity
    business: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&auto=format&fit=crop&q=80",    // Corporate/Offices
  };

  return categoryImages[category] || null;
}

/**
 * Decides whether to send a notification based on type rules, cooldowns, and quiet hours.
 *
 * @param {object} opts
 * @param {'meeting_alert'|'ai_reply'|'mcp_result'|'nudge'|'lead_alert'|'life_insight'|'custom'} opts.type
 * @param {string}  opts.userId      - User's UUID (used to fetch FCM token + preferences)
 * @param {string}  [opts.token]     - FCM device token. If omitted, fetched from DB.
 * @param {string}  opts.title       - Notification title
 * @param {string}  opts.body        - Notification body text
 * @param {object}  [opts.data]      - Optional FCM data payload (key-value strings)
 * @param {boolean} [opts.wsOnly]    - If true, only send via WebSocket, skip FCM push
 * @param {boolean} [opts.pushOnly]  - If true, only FCM push, skip WebSocket broadcast
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendSmartNotification({
  type = "custom",
  userId,
  token,
  title,
  body,
  data = {},
  wsOnly = false,
  pushOnly = false,
}) {
  try {
    const rule = NOTIFICATION_RULES[type] ?? NOTIFICATION_RULES.custom;

    // ── 1. Fetch user preferences + FCM token from DB if not supplied ─────────
    let fcmToken = token;
    let userPrefs = {};
    if (userId) {
      try {
        const { rows } = await query(
          `SELECT fcm_token, preferences FROM users WHERE id = $1 LIMIT 1`,
          [userId],
        );
        if (rows.length) {
          fcmToken = fcmToken || rows[0].fcm_token;
          userPrefs = rows[0].preferences || {};
        }
      } catch (_) {
        // DB unavailable — proceed with supplied token
      }
    }

    // ── 2. Check user-level notification preference override ──────────────────
    const userNotifPrefs = userPrefs?.notifications ?? {};
    const isEnabled = userNotifPrefs[type] ?? rule.defaultEnabled;
    if (!isEnabled) {
      return { sent: false, reason: `user_disabled_type:${type}` };
    }

    // ── 3. Quiet hours check ──────────────────────────────────────────────────
    if (rule.quietHoursRespected) {
      const quietStart = userPrefs?.quiet_hour_start ?? DEFAULT_QUIET_START;
      const quietEnd = userPrefs?.quiet_hour_end ?? DEFAULT_QUIET_END;
      const nowHour = new Date().getHours();
      const inQuiet =
        quietStart > quietEnd
          ? nowHour >= quietStart || nowHour < quietEnd // overnight range e.g. 22–7
          : nowHour >= quietStart && nowHour < quietEnd; // same-day range
      if (inQuiet) {
        return { sent: false, reason: "quiet_hours" };
      }
    }

    // ── 4. Cooldown check (per user + type) ───────────────────────────────────
    if (rule.minIntervalMs > 0 && userId) {
      const key = `${userId}:${type}`;
      const lastSent = lastSentMap.get(key) ?? 0;
      const elapsed = Date.now() - lastSent;
      if (elapsed < rule.minIntervalMs) {
        const waitMins = Math.round((rule.minIntervalMs - elapsed) / 60_000);
        return { sent: false, reason: `cooldown:${waitMins}min_remaining` };
      }
    }

    // ── 4.1 Link & Image Extraction + Cleanup ────────────────────────────────
    let cleanBody = body || "";
    let extractedUrl = data.url || null;
    let extractedUrlTitle = data.url_title || null;

    // Regex to match markdown links: [Text](URL)
    const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
    const mdMatch = cleanBody.match(mdLinkRegex);
    if (mdMatch) {
      extractedUrlTitle = mdMatch[1];
      extractedUrl = mdMatch[2];
      // Clean up body text to replace markdown link syntax with just the text label
      cleanBody = cleanBody.replace(mdLinkRegex, extractedUrlTitle);
    } else {
      // Fallback: extract raw HTTP/HTTPS URL
      const urlRegex = /(https?:\/\/[^\s]+)/;
      const urlMatch = cleanBody.match(urlRegex);
      if (urlMatch) {
        extractedUrl = urlMatch[1];
        try {
          const domain = new URL(extractedUrl).hostname.replace("www.", "");
          extractedUrlTitle = domain;
        } catch (_) {
          extractedUrlTitle = "Open Link";
        }
      }
    }

    // Determine rich image banner URL
    const category = data.category || (type === "nudge" ? "reflection" : null);
    const imageUrl = getNotificationImage(type, category, cleanBody);

    // Enriched data payload for notification
    const enrichedData = {
      ...data,
    };
    if (extractedUrl) {
      enrichedData.url = extractedUrl;
      enrichedData.url_title = extractedUrlTitle || "Open Link";
    }
    if (imageUrl) {
      enrichedData.image_url = imageUrl;
    }

    // ── 5. Dispatch ───────────────────────────────────────────────────────────
    let pushSent = false;

    // WebSocket (for active sessions in the app)
    if (!pushOnly) {
      broadcast("notification", { type, title, body: cleanBody, ...enrichedData });
    }

    // FCM push (for background / locked screen)
    if (!wsOnly && fcmToken) {
      pushSent = await sendPushNotification(fcmToken, title, cleanBody, {
        notification_type: type,
        ...enrichedData,
      });
    } else if (!wsOnly) {
      // No token yet — log for debugging
      console.warn(
        `[NotifHelper] No FCM token for user ${userId ?? "?"}, type=${type}. WebSocket only.`,
      );
    }

    // Update cooldown tracker
    if (userId && rule.minIntervalMs > 0) {
      lastSentMap.set(`${userId}:${type}`, Date.now());
    }

    console.log(
      `🔔 [NotifHelper] Sent [${type}] → "${title}" (push=${pushSent}, ws=true)`,
    );
    return { sent: true };
  } catch (err) {
    console.error("[NotifHelper] Error dispatching notification:", err.message);
    return { sent: false, reason: err.message };
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Meeting alert — always goes through (no quiet hour guard) */
export const notifyMeetingAlert = ({
  userId,
  token,
  eventSummary,
  minutesUntil,
  eventId,
}) =>
  sendSmartNotification({
    type: "meeting_alert",
    userId,
    token,
    title: "📅 Anya Alert",
    body: `"${eventSummary}" starts in ${minutesUntil} minute${minutesUntil === 1 ? "" : "s"}.`,
    data: {
      event_id: String(eventId ?? ""),
      minutes_until: String(minutesUntil),
    },
  });

/** MCP tool call returned something actionable (e.g. nearby places, book recommendation) */
export const notifyMcpResult = ({ userId, token, tool, summary }) =>
  sendSmartNotification({
    type: "mcp_result",
    userId,
    token,
    title: `🛠️ Anya: ${tool}`,
    body: summary,
    data: { mcp_tool: tool },
  });

/** New lead found by the lead pipeline */
export const notifyLeadAlert = ({ userId, token, leadTitle, source }) =>
  sendSmartNotification({
    type: "lead_alert",
    userId,
    token,
    title: "🚀 New Opportunity Found!",
    body: `${leadTitle} — via ${source}`,
    data: { source },
  });

/** Life insight was extracted from chat cleanup (daily 2 AM job) */
export const notifyLifeInsight = ({
  userId,
  token,
  emotionalState,
  topStruggle,
}) =>
  sendSmartNotification({
    type: "life_insight",
    userId,
    token,
    title: "🧠 Anya Life Update",
    body: `You seem ${emotionalState}. Focus area: ${topStruggle}`,
    data: { emotional_state: emotionalState },
  });

/** Nudge scheduler — respects quiet hours + daily nudge limit */
export const notifyNudge = ({ userId, token, message, category }) =>
  sendSmartNotification({
    type: "nudge",
    userId,
    token,
    title: "💡 Anya Nudge",
    body: message,
    data: { category },
  });

/** Fully custom — use from anywhere */
export const notifyCustom = ({ userId, token, title, body, data }) =>
  sendSmartNotification({ type: "custom", userId, token, title, body, data });
