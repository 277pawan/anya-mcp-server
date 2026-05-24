import cron from 'node-cron';
import { getUpcomingEvents } from '../mcp/mcp-client.js';
import { broadcast } from './ws-registry.js';
import { sendPushNotification } from './push.service.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const notifiedEvents = new Set(); // In-memory tracker to prevent spam

export function startLifeEngine() {
  console.log('❤️ Life Engine pulse started... (Running every 30 mins)');
  
  // Run every 30 minutes to save API quota
  cron.schedule('*/30 * * * *', checkAndSchedule);
  
  // Run once immediately on boot
  checkAndSchedule();
}

async function checkAndSchedule() {
  try {
    const eventsRes = await getUpcomingEvents(1, 50);
    if (!eventsRes || !eventsRes.upcoming_events || eventsRes.upcoming_events.length === 0) {
      return;
    }
    
    const now = Date.now();
    
    for (const event of eventsRes.upcoming_events) {
      if (notifiedEvents.has(event.id)) continue;

      // The new format is "May 3, 2026, 12:00 PM" which natively parses in JS
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
  } catch (err) {
    console.error('Life Engine Error:', err.message);
  }
}

async function triggerAlert(event, minutesUntil) {
  try {
    const prompt = `
      You are Anya, a personal AI assistant. The user has an upcoming meeting.
      Meeting: ${event.summary}
      Starting in: ${minutesUntil} minutes
      Link: ${event.meet_link || 'None'}
      
      Write a very short, friendly 1-2 sentence push notification alerting them. Be warm and supportive. 
      Do not mention that you are an AI.
    `;
    
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const alertText = result.response.text();
    
    // 1. Broadcast to active web UI sessions (WebSockets)
    broadcast('notification', { text: alertText, event_id: event.id, minutes_until: minutesUntil });

    // 2. Send OS-Level Push Notification (FCM)
    // In production, fetch the user's FCM token from DB (e.g., SELECT fcm_token FROM users WHERE id = user_id)
    // For now, we pass a dummy token to trigger the mock
    const userDeviceToken = "dummy-device-token-12345"; 
    await sendPushNotification(userDeviceToken, 'Anya Alert', alertText, { event_id: event.id });
    
  } catch (err) {
    console.error("Failed to generate alert:", err.message);
  }
}
