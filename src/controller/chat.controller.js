// src/controller/chat.controller.js
import * as ChatService from '../services/chat.service.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function createSession(req, res) {
  try {
    const session = await ChatService.createSession(uid(req), req.body.title);
    res.status(201).json({ success: true, data: session });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function listSessions(req, res) {
  try {
    const sessions = await ChatService.listSessions(uid(req), {
      limit: parseInt(req.query.limit || '20'), offset: parseInt(req.query.offset || '0')
    });
    res.json({ success: true, data: sessions });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getSession(req, res) {
  try {
    const session = await ChatService.getSession(uid(req), req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true, data: session });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function deleteSession(req, res) {
  try {
    const deleted = await ChatService.deleteSession(uid(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function sendMessage(req, res) {
  try {
    const { sessionId, content } = req.body;
    if (!sessionId || !content) return res.status(400).json({ error: 'sessionId and content are required' });
    const msg = await ChatService.sendMessage(uid(req), sessionId, content);
    res.json({ success: true, data: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function searchMessages(req, res) {
  try {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'q (search term) is required' });
    const results = await ChatService.searchMessages(uid(req), q, { limit: parseInt(limit || '20') });
    res.json({ success: true, data: results, count: results.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function synthesizeSpeech(req, res) {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_PUBLIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'No Google API key configured on backend' });
    }

    const response = await fetch(`https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioConfig: {
          audioEncoding: "MP3",
          pitch: 0,
          speakingRate: 1.0
        },
        input: {
          text: text
        },
        voice: {
          languageCode: "en-US",
          modelName: "gemini-3.1-flash-tts-preview",
          name: "Aoede"
        }
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('Google Cloud TTS Error:', data.error);
      return res.status(data.error.code || 400).json({ error: data.error.message });
    }

    if (!data.audioContent) {
      return res.status(500).json({ error: 'No audio content received from Google Cloud TTS' });
    }

    const audioDataUri = `data:audio/mp3;base64,${data.audioContent}`;
    res.json({ success: true, audio: audioDataUri });
  } catch (err) {
    console.error('TTS Controller Error:', err);
    res.status(500).json({ error: err.message });
  }
}
