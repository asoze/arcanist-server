/**
 * One-time import of the legacy notes.json (Markdown/plain-text/list notes)
 * into the SQLite store as HTML.
 *
 *   node scripts/import-legacy.js <notes.json> [--db arcanist.db] [--owner NAME] [--force] [--dry-run]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { marked } from "marked";

import { openDb } from "../db.js";
import { sanitizeNoteHtml } from "../sanitize.js";
import { noteIdSchema } from "../schema.js";

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function listToHtml(items) {
  const entries = items
    .filter((item) => item?.text?.trim())
    .map(
      (item) =>
        `<li data-type="taskItem" data-checked="${item.checked ? "true" : "false"}"><p>${escapeHtml(item.text.trim())}</p></li>`
    );
  return entries.length ? `<ul data-type="taskList">${entries.join("")}</ul>` : "";
}

function splitTitle(text) {
  const [first, ...rest] = text.trim().split("\n");
  if (first.length > 80) return { title: "", body: text };
  return { title: first.replace(/^#+\s*/, "").trim(), body: rest.join("\n").trim() };
}

/** Returns the new-format note, or null if the legacy note should be skipped. */
export function convertLegacyNote(legacy, { owner = null } = {}) {
  if (legacy.deleted || !noteIdSchema.safeParse(String(legacy.id)).success) return null;

  let title = (legacy.title ?? "").trim();
  let html;
  if (legacy.type === "list") {
    html = listToHtml(legacy.items ?? []);
  } else {
    let markdown = legacy.content?.text ?? legacy.text ?? "";
    if (!title && markdown.trim()) {
      ({ title, body: markdown } = splitTitle(markdown));
    }
    html = markdown.trim() ? marked.parse(markdown, { gfm: true, breaks: true, async: false }) : "";
  }

  const legacyUser = legacy.username && legacy.username !== "All" ? legacy.username : null;
  const createdBy = legacy.createdBy || legacyUser || owner;
  const updatedAt = legacy.lastModifiedOn || legacy.updatedAt || Date.now();

  return {
    id: String(legacy.id),
    title,
    html: sanitizeNoteHtml(html),
    tags: [...new Set((legacy.tags ?? []).filter((t) => typeof t === "string").map((t) => t.trim()).filter(Boolean))],
    shared: Boolean(legacy.sharing?.isShared || legacy.isGlobal || legacy.username === "All"),
    deleted: false,
    createdBy,
    lastModifiedBy: legacy.lastModifiedBy || createdBy,
    createdAt: legacy.createdAt || updatedAt,
    updatedAt,
  };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: "string", default: "arcanist.db" },
      owner: { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1) {
    console.error("Usage: node scripts/import-legacy.js <notes.json> [--db arcanist.db] [--owner NAME] [--force] [--dry-run]");
    process.exit(1);
  }

  const legacyNotes = JSON.parse(fs.readFileSync(positionals[0], "utf8"));
  const converted = legacyNotes.map((note) => convertLegacyNote(note, { owner: values.owner })).filter(Boolean);
  const skipped = legacyNotes.length - converted.length;

  if (values["dry-run"]) {
    for (const note of converted) {
      console.log(`--- ${note.id} "${note.title}" by ${note.createdBy ?? "?"}${note.shared ? " (shared)" : ""} [${note.tags.join(", ")}]`);
      console.log(note.html);
    }
    console.log(`\n${converted.length} notes would be imported, ${skipped} skipped (deleted or invalid id).`);
    return;
  }

  const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dbPath = path.isAbsolute(values.db) ? values.db : path.join(serverRoot, values.db);
  const db = openDb(dbPath);
  let imported = 0;
  let existing = 0;
  for (const note of converted) {
    if (!values.force && db.getNote(note.id)) {
      existing += 1;
      continue;
    }
    db.saveNote(note);
    imported += 1;
  }
  db.close();

  const ownerless = converted.filter((n) => !n.createdBy).length;
  console.log(`Imported ${imported} notes into ${dbPath}; ${existing} already present, ${skipped} skipped.`);
  if (ownerless) {
    console.log(`${ownerless} notes have no owner; rerun with --owner NAME --force to assign one.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
