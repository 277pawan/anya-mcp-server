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
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isFirebaseInitialized = true;
    console.log('✅ Firebase Admin SDK Initialized from Environment (FIREBASE_SERVICE_ACCOUNT).');
  } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      })
    });
    isFirebaseInitialized = true;
    console.log('✅ Firebase Admin SDK Initialized from Environment (individual variables).');
  } else if (fs.existsSync(keyPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isFirebaseInitialized = true;
    console.log('✅ Firebase Admin SDK Initialized from local firebase-admin-key.json.');
  } else {
    console.warn('⚠️ Firebase Admin SDK config not found in environment or local file. Push notifications will be mocked.');
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
