import cron from 'node-cron';
import { getUpcomingEvents } from '../mcp/mcp-client.js';
import { broadcast } from './ws-registry.js';
import { notifyMeetingAlert, notifyNudge, notifyCustom } from '../utils/notificationHelper.js';
import fetch from 'node-fetch';
import https from 'https';
import { getUserProfile } from './user.service.js';
import { getNudgesCountToday, recordNudge, getLastNudgeTime } from './nudge.service.js';
import { getLifeEngineState } from './lifeEngine.service.js';
import { CategorySelector } from '../modules/life-engine/categorySelector.js';
import { AIGenerator } from '../modules/life-engine/aiGenerator.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const notifiedEvents = new Set(); // In-memory tracker to prevent spam

import { runGlobalChatCleanup } from './chat-cleanup.service.js';

export function startLifeEngine() {
  console.log('❤️ Life Engine pulse started... (Running every 30 mins)');

  // Run checks every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    checkCalendarEvents();
    checkDailyNudges();
  });

  // Run chat history cleanup and insight extraction daily at 2:00 AM
  cron.schedule('0 2 * * *', () => {
    runGlobalChatCleanup();
  });
  
  // Run daily morning motivation nudge at exactly 6:30 AM
  cron.schedule('30 6 * * *', () => {
    sendMorningQuoteNudge();
  });

  // Run once immediately on boot in parallel!
  checkCalendarEvents();
  checkDailyNudges();

  // Run initial chat cleanup and insight extraction on boot in the background
  console.log('🧹 [Life Engine] Triggering initial startup chat cleanup...');
  runGlobalChatCleanup();
}

async function checkCalendarEvents() {
  try {
    const eventsRes = await getUpcomingEvents(1, 50);
    if (eventsRes && eventsRes.upcoming_events && eventsRes.upcoming_events.length > 0) {
      const now = Date.now();

      for (const event of eventsRes.upcoming_events) {
        if (notifiedEvents.has(event.id)) continue;

        // The format is "May 3, 2026, 12:00 PM" which natively parses in JS
        const eventStart = new Date(event.start).getTime();

        // We want to alert exactly 10 minutes before the meeting
        const alertTime = eventStart - (10 * 60 * 1000);
        const msUntilAlert = alertTime - now;

        // Case 1: Alert is in the future
        if (msUntilAlert > 0) {
          notifiedEvents.add(event.id);
          console.log(`⏰ Life Engine: Scheduled exact alert for ${event.summary} in ${Math.round(msUntilAlert / 60000)} mins`);

          setTimeout(() => triggerAlert(event, 10), msUntilAlert);
        }
        // Case 2: Server just booted, and we are within the 10 min window but before the meeting
        else if (msUntilAlert <= 0 && eventStart > now) {
          notifiedEvents.add(event.id);
          const minsLeft = Math.round((eventStart - now) / 60000);
          console.log(`⏰ Life Engine: Immediate alert for ${event.summary} starting in ${minsLeft} mins`);
          triggerAlert(event, minsLeft);
        }
      }
    }
  } catch (calendarErr) {
    console.error('⏰ [Life Engine] Calendar check bypassed:', calendarErr.message);
  }
}

async function checkDailyNudges() {
  try {
    const uid = process.env.DEFAULT_USER_ID;
    const profile = await getUserProfile(uid);
    if (profile) {
      const maxNudges = profile.preferences?.notifications?.maxNudgesPerDay || 3;
      const sentToday = await getNudgesCountToday(uid);

      if (sentToday < maxNudges) {
        // Calculate minutes since last nudge
        const lastNudgeTime = await getLastNudgeTime(uid);
        const nowMs = Date.now();
        const lastNudgeAgeMinutes = lastNudgeTime ? (nowMs - lastNudgeTime.getTime()) / 60000 : Infinity;

        // Random interval between 2 to 3 hours (120 - 180 minutes)
        const randomHoursCooldown = Math.floor(Math.random() * 60) + 120;
        const shouldNudge = lastNudgeAgeMinutes >= randomHoursCooldown;

        if (shouldNudge) {
          console.log(`💡 [Life Engine] Triggering dev nudge check. (Sent today: ${sentToday}/${maxNudges}, Last age: ${lastNudgeAgeMinutes.toFixed(1)} mins)`);

          const state = await getLifeEngineState(uid);
          const contextMock = { receivedNudges: [], ...state };
          const nudgeSelection = CategorySelector.selectNudge(contextMock);

          const message = await AIGenerator.generateMessage(
            nudgeSelection,
            contextMock,
            profile.name || "there"
          );

          const normalizedCategory = (nudgeSelection.category || 'health').toLowerCase();

          await notifyNudge({
            userId: uid,
            message,
            category: normalizedCategory
          });

          await recordNudge(uid, {
            category: normalizedCategory,
            theme: nudgeSelection.type,
            message
          });

        } else {
          console.log(`💡 [Life Engine] Cooldown active. Last nudge age: ${lastNudgeAgeMinutes.toFixed(1)} mins. Skipping slot.`);
        }
      }
    }
  } catch (err) {
    console.error('Life Engine Nudge Error:', err.message);
  }
}

async function triggerAlert(event, minutesUntil) {
  try {
    const prompt = `
      The user has an upcoming meeting.
      Meeting: ${event.summary}
      Starting in: ${minutesUntil} minutes
      Link: ${event.meet_link || 'None'}
      
      Write a very short, friendly 1-2 sentence push notification alerting them. Be warm and supportive.
    `;
    const systemPrompt = `You are Anya, a highly capable, warm, and friendly personal companion. Do not mention that you are an AI. Write a friendly notification for their meeting.`;

    const { chatWithGlobalFallback } = await import('../ai/llm-fallback.js');
    const result = await chatWithGlobalFallback({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      taskName: "Anya Meeting Alert Generation",
      temperature: 0.7,
      maxTokens: 80,
      geminiModels: ["gemini-1.5-flash", "gemini-2.0-flash"],
      groqModels: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
      mistralModels: ["mistral-small-latest"]
    });

    let alertText;
    if (result.success && result.content) {
      alertText = result.content.trim();
    } else {
      alertText = `Warm reminder: Your meeting "${event.summary}" is starting in ${minutesUntil} minutes!`;
    }

    // 1. Broadcast to active web UI sessions (WebSockets)
    broadcast('notification', { text: alertText, event_id: event.id, minutes_until: minutesUntil });

    // 2. Smart FCM push — fetches token from DB, respects quiet hours, no spam
    await notifyMeetingAlert({
      userId: process.env.DEFAULT_USER_ID,
      eventSummary: event.summary,
      minutesUntil,
      eventId: event.id,
    });

  } catch (err) {
    console.error("Failed to generate alert:", err.message);
  }
}


/**
 * Fetches a random motivational quote and sends it as a daily morning push notification.
 * Handles the certificate issue on quotable.io robustly.
 */
export async function sendMorningQuoteNudge() {
  const uid = process.env.DEFAULT_USER_ID || '89968338-6678-48e0-be01-f8472e550e1d';
  try {
    console.log('🌅 [Life Engine] Fetching morning quote of the day from quotable.io...');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await fetch('https://api.quotable.io/random', { agent });
    
    if (!response.ok) {
      throw new Error(`Quotable API returned status ${response.status}`);
    }
    
    const quoteData = await response.json();
    const { content, author } = quoteData;
    const message = `"${content}" — ${author}`;
    
    console.log(`🌅 [Life Engine] Sending morning quote: ${message}`);
    
    // 1. Broadcast to WS active sessions
    broadcast('notification', { 
      type: 'custom', 
      title: 'Morning Motivation 🌅', 
      body: message,
      category: 'motivation'
    });

    // 2. Dispatch Custom push notification (ignores quiet hours/cooldown to ensure delivery at 6:30 AM)
    await notifyCustom({
      userId: uid,
      title: 'Morning Motivation 🌅',
      body: message,
      data: { category: 'motivation' }
    });
    
    // 3. Record Nudge in DB
    await recordNudge(uid, {
      category: 'motivation',
      theme: 'normal',
      message: message
    });
    
  } catch (err) {
    console.error('🌅 [Life Engine] Morning quote nudge failed (using fallback):', err.message);
    
    const fallbacks = [
      { content: "Every adversity, every failure, every heartache carries with it the seed of an equal or greater benefit.", author: "Napoleon Hill" },
      { content: "The only limit to our realization of tomorrow will be our doubts of today.", author: "Franklin D. Roosevelt" },
      { content: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
      { content: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
      { content: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" }
    ];
    const picked = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    const message = `"${picked.content}" — ${picked.author}`;
    
    broadcast('notification', { 
      type: 'custom', 
      title: 'Morning Motivation 🌅', 
      body: message,
      category: 'motivation'
    });

    await notifyCustom({
      userId: uid,
      title: 'Morning Motivation 🌅',
      body: message,
      data: { category: 'motivation' }
    });
    
    await recordNudge(uid, {
      category: 'motivation',
      theme: 'normal',
      message: message
    });
  }
}
