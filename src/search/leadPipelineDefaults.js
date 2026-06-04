/**
 * Central defaults for lead discovery. Replace with DB-backed values from your
 * settings API and pass via `userContext.pipelineSettings` (or `options.fetchLimit` /
 * `options.maxLeads`) — do not rely on env vars for these caps.
 */
export const DEFAULT_LEAD_FETCH_LIMIT = 20;
export const DEFAULT_MAX_LEADS = 20;
