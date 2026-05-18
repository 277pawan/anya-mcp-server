// src/routes/index.js — Central route registry
// Import all route modules and mount them on the Express app
import userRoutes from './user.routes.js';
import calendarRoutes from './calendar.routes.js';
import chatRoutes from './chat.routes.js';
import lifeEngineRoutes from './lifeEngine.routes.js';
import nudgeRoutes from './nudge.routes.js';
import historyRoutes from './history.routes.js';

/**
 * Register all API routes on the given Express app instance.
 * @param {import('express').Application} app
 */
export function registerRoutes(app) {
  app.use('/api/user', userRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/life-engine', lifeEngineRoutes);
  app.use('/api/nudges', nudgeRoutes);
  app.use('/api/history', historyRoutes);
}
