import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    shared INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    last_modified_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_version ON notes (version);
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO meta (key, value) VALUES ('version', 0), ('purged_through', 0);
`;

function toNote(row) {
  return {
    id: row.id,
    title: row.title,
    html: row.html,
    tags: JSON.parse(row.tags),
    shared: row.shared === 1,
    deleted: row.deleted === 1,
    createdBy: row.created_by,
    lastModifiedBy: row.last_modified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/**
 * Every write takes the next value of a global counter, so clients can ask
 * for "everything after version N" without trusting anyone's clock.
 */
export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const statements = {
    getMeta: db.prepare("SELECT value FROM meta WHERE key = ?"),
    bumpVersion: db.prepare(
      "UPDATE meta SET value = value + 1 WHERE key = 'version' RETURNING value"
    ),
    setPurgedThrough: db.prepare(
      "UPDATE meta SET value = MAX(value, ?) WHERE key = 'purged_through'"
    ),
    get: db.prepare("SELECT * FROM notes WHERE id = ?"),
    live: db.prepare("SELECT * FROM notes WHERE deleted = 0 ORDER BY version"),
    since: db.prepare("SELECT * FROM notes WHERE version > ? ORDER BY version"),
    upsert: db.prepare(`
      INSERT INTO notes (id, title, html, tags, shared, deleted, created_by,
                         last_modified_by, created_at, updated_at, version)
      VALUES (:id, :title, :html, :tags, :shared, :deleted, :createdBy,
              :lastModifiedBy, :createdAt, :updatedAt, :version)
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title, html = excluded.html, tags = excluded.tags,
        shared = excluded.shared, deleted = excluded.deleted,
        last_modified_by = excluded.last_modified_by,
        updated_at = excluded.updated_at, version = excluded.version
    `),
    expiredTombstones: db.prepare(
      "SELECT MAX(version) AS maxVersion, COUNT(*) AS count FROM notes WHERE deleted = 1 AND updated_at < ?"
    ),
    deleteTombstones: db.prepare("DELETE FROM notes WHERE deleted = 1 AND updated_at < ?"),
  };

  const meta = (key) => statements.getMeta.get(key).value;

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  return {
    getNote(id) {
      const row = statements.get.get(id);
      return row ? toNote(row) : null;
    },

    /**
     * `reset` tells the client to replace its synced notes with this list
     * rather than merge: either it has nothing yet, or tombstones it never
     * saw have since been purged.
     */
    changesSince(since) {
      const cursor = meta("version");
      const reset = since <= 0 || since < meta("purged_through");
      const rows = reset ? statements.live.all() : statements.since.all(since);
      return { notes: rows.map(toNote), cursor, reset };
    },

    saveNote(note) {
      return transaction(() => {
        const { value: version } = statements.bumpVersion.get();
        const row = {
          id: note.id,
          title: note.title,
          html: note.html,
          tags: JSON.stringify(note.tags),
          shared: note.shared ? 1 : 0,
          deleted: note.deleted ? 1 : 0,
          createdBy: note.createdBy ?? null,
          lastModifiedBy: note.lastModifiedBy ?? null,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          version,
        };
        statements.upsert.run(row);
        return toNote(statements.get.get(note.id));
      });
    },

    purgeTombstones(olderThan) {
      return transaction(() => {
        const { maxVersion, count } = statements.expiredTombstones.get(olderThan);
        if (count === 0) return 0;
        statements.deleteTombstones.run(olderThan);
        statements.setPurgedThrough.run(maxVersion);
        return count;
      });
    },

    close() {
      db.close();
    },
  };
}
