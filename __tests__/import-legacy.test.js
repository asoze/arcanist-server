import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { convertLegacyNote } from "../scripts/import-legacy.js";

describe("convertLegacyNote", () => {
  it("skips deleted notes", () => {
    assert.equal(convertLegacyNote({ id: "1", text: "x", deleted: true }), null);
  });

  it("converts markdown content to HTML", () => {
    const note = convertLegacyNote({
      id: "1",
      title: "T",
      content: { text: "**Bold** and _em_\n\n- a\n- b" },
      username: "andrew",
      tags: [" x ", "x", "y"],
      updatedAt: 10,
    });
    assert.equal(note.html, "<p><strong>Bold</strong> and <em>em</em></p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n");
    assert.deepEqual(note.tags, ["x", "y"]);
    assert.equal(note.createdBy, "andrew");
    assert.equal(note.createdAt, 10);
    assert.equal(note.shared, false);
  });

  it("titles untitled plain-text notes from their first line and keeps the full text as the body", () => {
    const note = convertLegacyNote({ id: "1", text: "Groceries\nmilk\neggs", updatedAt: 1 }, { owner: "andrew" });
    assert.equal(note.title, "Groceries");
    assert.equal(note.html, "<p>Groceries<br />milk<br />eggs</p>\n");
    assert.equal(note.createdBy, "andrew");
  });

  it("keeps one-line untitled notes as body text", () => {
    const note = convertLegacyNote({ id: "1", text: "Hello wife!" });
    assert.equal(note.title, "Hello wife!");
    assert.equal(note.html, "<p>Hello wife!</p>\n");
  });

  it("turns list notes into task lists and escapes item text", () => {
    const note = convertLegacyNote({
      id: "1",
      type: "list",
      title: "L",
      items: [
        { id: "a", text: "<b>milk</b>", checked: true },
        { id: "b", text: "  " },
        { id: "c", text: "eggs" },
      ],
    });
    assert.equal(
      note.html,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>&lt;b&gt;milk&lt;/b&gt;</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>eggs</p></li></ul>'
    );
  });

  it("maps the legacy 'All' user to a shared note owned by --owner", () => {
    const note = convertLegacyNote({ id: "1", text: "hi", username: "All" }, { owner: "andrew" });
    assert.equal(note.shared, true);
    assert.equal(note.createdBy, "andrew");
  });
});
