// src/routes/index.js — Central route registry
// Import all route modules and mount them on the Express app
import userRoutes       from './user.routes.js';
import chatRoutes       from './chat.routes.js';
import lifeEngineRoutes from './lifeEngine.routes.js';
import nudgeRoutes      from './nudge.routes.js';
import historyRoutes    from './history.routes.js';
import adminRoutes      from './admin.routes.js';
import emailRoutes      from './email.routes.js';
import focusRoutes      from './focus.routes.js';

/**
 * Register all API routes on the given Express app instance.
 * @param {import('express').Application} app
 */
export function registerRoutes(app) {
  app.use('/api/user',        userRoutes);
  app.use('/api/chat',        chatRoutes);
  app.use('/api/life-engine', lifeEngineRoutes);
  app.use('/api/nudges',      nudgeRoutes);
  app.use('/api/history',     historyRoutes);
  app.use('/api/admin',       adminRoutes);   // model health, diagnostics
  app.use('/api/email',       emailRoutes);   // compose, send, send-proposals
  app.use('/api/focus',       focusRoutes);   // Pawan's Personal Focus OS endpoints
}
