# arcanist-server

Express + SQLite notes API for Arcanist. Notes are stored as sanitized HTML.
Requires Node 22.13+ (uses the built-in `node:sqlite`).

## Running

```bash
npm install
AUTH_TOKEN=... npm start
```

## API

All `/notes` routes require `Authorization: Bearer <AUTH_TOKEN>` when
`AUTH_TOKEN` is set. Writes also require an `X-Arcanist-User` header naming
the user making the change (asserted by the client, not authenticated).

| Route | Purpose |
|---|---|
| `GET /health` | Liveness check |
| `GET /notes?since=<cursor>` | `{ notes, cursor, reset }`. Returns every note (including deletions) changed after `cursor`. With `since=0`, or when deletions the client never saw have been purged, `reset` is `true` and `notes` is the full set of live notes. |
| `PUT /notes/:id` | Create or replace a note. Body: `{ title, html, tags, shared, createdAt? }`. Returns the stored note. |
| `DELETE /notes/:id` | Mark a note deleted. Returns the tombstone, or `204` if there was nothing to delete. |

A stored note looks like:

```json
{
  "id": "…", "title": "…", "html": "<p>…</p>", "tags": ["…"],
  "shared": false, "deleted": false,
  "createdBy": "andrew", "lastModifiedBy": "andrew",
  "createdAt": 1762700000000, "updatedAt": 1762700000000, "version": 42
}
```

Conflicts are last-write-wins in the order the server receives them;
`updatedAt` and `version` are always set by the server. Deleted notes are kept
for `TOMBSTONE_TTL_DAYS` so other devices see the deletion, then purged.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `DB_FILE` | `arcanist.db` | SQLite file (relative to server root unless absolute) |
| `AUTH_TOKEN` | `""` | Shared bearer token. Empty disables auth — do not deploy without it. |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins. **Set explicitly in production.** |
| `BODY_LIMIT` | `1048576` | Max request body bytes (one note) |
| `TOMBSTONE_TTL_DAYS` | `30` | How long deleted notes are kept before purging |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `RATE_LIMIT_MAX` | `300` | Max requests per window per IP |
| `LOG_LEVEL` | `info` | pino log level |

## Migrating from the old JSON store

The pre-2026 server kept Markdown notes in `notes.json`. Import them once:

```bash
npm run import-legacy -- notes.json --owner Andrew --dry-run   # preview the HTML
npm run import-legacy -- notes.json --owner Andrew
```

Deleted notes are skipped. Markdown becomes HTML, list notes become
checklists, and notes the old app posted as user `All` become shared notes.
`--owner` is assigned to notes with no recorded author. Notes already in the
database are left alone unless you pass `--force`.

## Production deployment checklist

- [ ] Set `AUTH_TOKEN` to a long random string and enter it in each client's
      Settings.
- [ ] Set `CORS_ORIGINS` to your actual client origin(s), not `*`.
- [ ] Terminate TLS in front of the server (Caddy / nginx).
- [ ] Back up the SQLite file (`sqlite3 arcanist.db ".backup backup.db"`).

## Tests

```bash
npm test
```
