import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";

import { config } from "./config.js";
import { openDb } from "./db.js";
import { sanitizeNoteHtml } from "./sanitize.js";
import { noteIdSchema, noteInputSchema, usernameSchema } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAY_MS = 24 * 60 * 60 * 1000;

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
  transport:
    process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

/**
 * @param {object} options
 * @param {ReturnType<typeof openDb>} options.db
 * @param {string} [options.authToken] empty disables auth
 * @param {string} [options.corsOrigins] comma-separated, or "*"
 * @param {() => number} [options.now]
 */
export function createApp({
  db,
  authToken = "",
  corsOrigins = "*",
  bodyLimit = config.bodyLimit,
  rateLimitMax = 0,
  rateLimitWindowMs = config.rateLimitWindowMs,
  now = Date.now,
}) {
  const app = express();

  app.use(
    cors({
      origin: corsOrigins === "*" ? "*" : corsOrigins.split(",").map((o) => o.trim()),
      methods: ["GET", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Arcanist-User"],
    })
  );

  if (rateLimitMax > 0) {
    app.use(rateLimit({ windowMs: rateLimitWindowMs, max: rateLimitMax, standardHeaders: true }));
  }

  app.use(express.json({ limit: bodyLimit }));

  function requireAuth(req, res, next) {
    if (!authToken) return next();
    const [scheme, token] = (req.get("authorization") || "").split(" ");
    if (scheme !== "Bearer" || token !== authToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  /** Authorship is asserted by the client; acceptable for a shared-token, few-user setup. */
  function requireUser(req, res, next) {
    const parsed = usernameSchema.safeParse(req.get("x-arcanist-user") ?? "");
    if (!parsed.success) {
      return res.status(400).json({ error: "Missing X-Arcanist-User header" });
    }
    req.username = parsed.data;
    next();
  }

  function requireNoteId(req, res, next) {
    if (!noteIdSchema.safeParse(req.params.id).success) {
      return res.status(400).json({ error: "Invalid note id" });
    }
    next();
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/notes", requireAuth, (req, res) => {
    const since = Number.parseInt(req.query.since ?? "0", 10);
    res.json(db.changesSince(Number.isNaN(since) ? 0 : since));
  });

  app.put("/notes/:id", requireAuth, requireUser, requireNoteId, (req, res) => {
    const parsed = noteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid note", details: parsed.error.flatten() });
    }
    const input = parsed.data;
    const existing = db.getNote(req.params.id);
    const timestamp = now();

    const saved = db.saveNote({
      id: req.params.id,
      title: input.title,
      html: sanitizeNoteHtml(input.html),
      tags: [...new Set(input.tags)],
      shared: input.shared,
      deleted: false,
      createdBy: existing?.createdBy ?? req.username,
      lastModifiedBy: req.username,
      createdAt: existing?.createdAt ?? input.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    logger.info({ id: saved.id, version: saved.version, user: req.username }, "Note saved");
    res.json(saved);
  });

  app.delete("/notes/:id", requireAuth, requireUser, requireNoteId, (req, res) => {
    const existing = db.getNote(req.params.id);
    if (!existing || existing.deleted) {
      return res.status(204).end();
    }
    const saved = db.saveNote({
      ...existing,
      title: "",
      html: "",
      tags: [],
      deleted: true,
      lastModifiedBy: req.username,
      updatedAt: now(),
    });
    logger.info({ id: saved.id, version: saved.version, user: req.username }, "Note deleted");
    res.json(saved);
  });

  app.use((err, _req, res, _next) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Note too large" });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON" });
    }
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const dbPath = path.isAbsolute(config.dbFile) ? config.dbFile : path.join(__dirname, config.dbFile);
  const db = openDb(dbPath);

  const purge = () => {
    const purged = db.purgeTombstones(Date.now() - config.tombstoneTtlDays * DAY_MS);
    if (purged > 0) logger.info({ purged }, "Purged expired tombstones");
  };
  purge();
  setInterval(purge, DAY_MS).unref();

  if (!config.authToken) {
    logger.warn("AUTH_TOKEN is not set; the notes API is open to anyone who can reach it");
  }

  const app = createApp({
    db,
    authToken: config.authToken,
    corsOrigins: config.corsOrigins,
    rateLimitMax: config.rateLimitMax,
  });
  app.listen(config.port, () => {
    logger.info(`Notes API listening on http://localhost:${config.port} (db: ${dbPath})`);
  });
}
