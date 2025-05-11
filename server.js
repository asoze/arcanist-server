const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, "notes.json");

app.use(cors());
app.use(express.json());

// Utility to read/write JSON file
const loadNotes = () => {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
};

const saveNotes = (notes) => {
  console.log("Trying to save notes", notes.length);
  fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2));
};

// GET all notes
app.get("/notes", (req, res) => {
  try {
    console.log("REQUEST TO LOAD NOTES");
    const notes = loadNotes();
    res.status(200);
    res.setHeader("Content-Type", "application/json");
    return res.json(notes);
  } catch (err) {
    console.error("❌ Error during /notes GET:", err);
    return res.status(500).json({ error: "Server error loading notes." });
  }
});

// POST updated notes (merge instead of overwrite)
app.post("/notes", (req, res) => {
  try {
    const incoming = req.body;
    console.log("📝 Received notes from client");

    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: "Expected an array of notes" });
    }

    const existing = loadNotes();
    const mergedMap = new Map();

    for (const note of existing) {
      mergedMap.set(note.id, note);
    }

    for (const note of incoming) {
      const existingNote = mergedMap.get(note.id);
      if (!existingNote || note.updatedAt > existingNote.updatedAt) {
        mergedMap.set(note.id, note);
      }
    }

    const merged = Array.from(mergedMap.values());
    saveNotes(merged);

    console.log("✅ Merged notes saved:", merged.length);
    return res.status(200).json({ success: true, mergedCount: merged.length });
  } catch (err) {
    console.error("❌ Error during /notes POST:", err);
    return res.status(500).json({ error: "Server error during note sync." });
  }
});

const http = require("http");
const https = require("https");

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "ssl", "key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "ssl", "cert.pem")),
};

// Start HTTPS server
https.createServer(sslOptions, app).listen(443, () => {
  console.log("🔒 HTTPS server listening on port 443");
});

// Optional: Redirect HTTP to HTTPS
http
  .createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  })
  .listen(80, () => {
    console.log("🌐 HTTP redirect server listening on port 80");
  });
