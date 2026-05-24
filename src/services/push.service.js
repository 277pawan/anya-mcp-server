import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Firebase Admin key.
// The user should place the key at the root of anya-mcp-server/firebase-admin-key.json
const keyPath = path.resolve(__dirname, '../../firebase-admin-key.json');

let isFirebaseInitialized = false;

try {
  if (fs.existsSync(keyPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    isFirebaseInitialized = true;
    console.log('✅ Firebase Admin SDK Initialized Successfully.');
  } else {
    console.warn('⚠️ Firebase Admin SDK key not found. Push notifications will be mocked.');
  }
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
}

/**
 * Sends a push notification to a specific device token.
 * @param {string} token - The FCM device token.
 * @param {string} title - The notification title.
 * @param {string} body - The notification body.
 * @param {object} data - Optional data payload.
 */
export async function sendPushNotification(token, title, body, data = {}) {
  if (!token) {
    console.warn('Cannot send push notification: Device token is missing.');
    return false;
  }

  const payload = {
    notification: {
      title,
      body,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK', // standard intent payload
      ...data
    },
    token
  };

  if (isFirebaseInitialized) {
    try {
      const response = await admin.messaging().send(payload);
      console.log('📡 Push Notification Sent Successfully:', response);
      return true;
    } catch (error) {
      console.error('❌ Error sending push notification:', error.message);
      return false;
    }
  } else {
    // Mock the behavior if Firebase isn't configured yet
    console.log('\n' + '='.repeat(40));
    console.log('🔔 [MOCK PUSH NOTIFICATION]');
    console.log(`To: ${token}`);
    console.log(`Title: ${title}`);
    console.log(`Body: ${body}`);
    console.log('='.repeat(40) + '\n');
    return true;
  }
}
