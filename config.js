/**
 * Server configuration from environment variables
 */
const int = (value, fallback) => {
  const parsed = parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const config = {
  port: Math.max(1, Math.min(65535, int(process.env.PORT, 4000))),
  /** SQLite database path, relative to the server root unless absolute. */
  dbFile: process.env.DB_FILE || "arcanist.db",
  /** Shared bearer token required for /notes endpoints. Empty string disables auth. */
  authToken: process.env.AUTH_TOKEN || "",
  /** CORS allowed origins - comma-separated, or "*" for all */
  corsOrigins: process.env.CORS_ORIGINS || "*",
  /** Max JSON body size (bytes) for a single note. */
  bodyLimit: int(process.env.BODY_LIMIT, 1024 * 1024),
  /** Deleted notes are kept this long so other devices learn about the deletion. */
  tombstoneTtlDays: int(process.env.TOMBSTONE_TTL_DAYS, 30),
  /** Rate limit: max requests per window per IP */
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 300),
};
