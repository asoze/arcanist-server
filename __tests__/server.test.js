import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../server.js";
import { openDb } from "../db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function setup({ authToken = "" } = {}) {
  let clock = 1_000_000;
  const db = openDb(":memory:");
  const app = createApp({ db, authToken, now: () => clock });
  return {
    db,
    app,
    tick: (ms = 1000) => (clock += ms),
    put: (id, body, user = "andrew") =>
      request(app).put(`/notes/${id}`).set("X-Arcanist-User", user).send(body),
    del: (id, user = "andrew") => request(app).delete(`/notes/${id}`).set("X-Arcanist-User", user),
    since: (cursor) => request(app).get(`/notes?since=${cursor}`),
  };
}

describe("notes API", () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it("reports health", async () => {
    const res = await request(ctx.app).get("/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok" });
  });

  it("starts empty with a reset response", async () => {
    const res = await ctx.since(0);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { notes: [], cursor: 0, reset: true });
  });

  it("creates a note and stamps authorship, time and version", async () => {
    const res = await ctx.put("n1", { title: "Hello", html: "<p>Hi</p>", tags: ["a", "a", "b"], shared: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      id: "n1",
      title: "Hello",
      html: "<p>Hi</p>",
      tags: ["a", "b"],
      shared: true,
      deleted: false,
      createdBy: "andrew",
      lastModifiedBy: "andrew",
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
      version: 1,
    });
  });

  it("keeps the original creator when someone else edits", async () => {
    await ctx.put("n1", { title: "Mine" });
    ctx.tick();
    const res = await ctx.put("n1", { title: "Edited" }, "wife");
    assert.equal(res.body.createdBy, "andrew");
    assert.equal(res.body.lastModifiedBy, "wife");
    assert.equal(res.body.createdAt, 1_000_000);
    assert.equal(res.body.updatedAt, 1_001_000);
  });

  it("last save wins regardless of client-supplied times", async () => {
    await ctx.put("n1", { title: "first", createdAt: 5 });
    await ctx.put("n1", { title: "second", createdAt: 999_999_999 });
    const res = await ctx.since(0);
    assert.equal(res.body.notes.length, 1);
    assert.equal(res.body.notes[0].title, "second");
    assert.equal(res.body.notes[0].createdAt, 5);
  });

  it("returns only changes after the cursor, including deletions", async () => {
    await ctx.put("n1", { title: "one" });
    await ctx.put("n2", { title: "two" });
    const { body: first } = await ctx.since(0);
    assert.equal(first.cursor, 2);

    await ctx.put("n2", { title: "two, edited" });
    await ctx.del("n1");
    const { body: delta } = await ctx.since(first.cursor);
    assert.equal(delta.reset, false);
    assert.equal(delta.cursor, 4);
    assert.deepEqual(
      delta.notes.map((n) => [n.id, n.deleted, n.title]),
      [["n2", false, "two, edited"], ["n1", true, ""]]
    );
  });

  it("leaves tombstones out of a full sync", async () => {
    await ctx.put("n1", { title: "one" });
    await ctx.del("n1");
    const res = await ctx.since(0);
    assert.deepEqual(res.body.notes, []);
  });

  it("treats deleting an unknown or already deleted note as a no-op", async () => {
    assert.equal((await ctx.del("missing")).status, 204);
    await ctx.put("n1", {});
    await ctx.del("n1");
    assert.equal((await ctx.del("n1")).status, 204);
    assert.equal((await ctx.since(0)).body.cursor, 2);
  });

  it("forces a reset once tombstones a client never saw are purged", async () => {
    await ctx.put("n1", {});
    const { body: synced } = await ctx.since(0);
    await ctx.del("n1");
    await ctx.put("n2", {});

    assert.equal(ctx.db.purgeTombstones(1_000_000 + DAY_MS), 1);
    const res = await ctx.since(synced.cursor);
    assert.equal(res.body.reset, true);
    assert.deepEqual(res.body.notes.map((n) => n.id), ["n2"]);

    const caughtUp = await ctx.since(res.body.cursor);
    assert.equal(caughtUp.body.reset, false);
  });

  it("sanitizes HTML but keeps editor formatting", async () => {
    const html =
      '<p onclick="x()">Hi <mark data-color="#ff0" style="background-color: #ff0; color: inherit">there</mark>' +
      '<span style="color: #d9480f; position: fixed">red</span><script>alert(1)</script></p>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>' +
      '<a href="javascript:alert(1)">bad</a><a href="https://ok.example">good</a>';
    const res = await ctx.put("n1", { html });
    assert.equal(
      res.body.html,
      '<p>Hi <mark data-color="#ff0" style="background-color:#ff0;color:inherit">there</mark>' +
        '<span style="color:#d9480f">red</span></p>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked" /><span></span></label><div><p>done</p></div></li></ul>' +
        '<a>bad</a><a href="https://ok.example">good</a>'
    );
  });

  it("rejects bad input", async () => {
    assert.equal((await ctx.put("bad id!", {})).status, 400);
    assert.equal((await ctx.put("n1", { title: 5 })).status, 400);
    assert.equal((await ctx.put("n1", { unknown: true })).status, 400);
    assert.equal((await ctx.put("n1", {}, "  ")).status, 400);
    const noUser = await request(ctx.app).put("/notes/n1").send({});
    assert.equal(noUser.status, 400);
  });
});

describe("cors", () => {
  it("allows the browser client to PUT with auth and user headers", async () => {
    const db = openDb(":memory:");
    const app = createApp({ db, corsOrigins: "https://notes.example" });
    const res = await request(app)
      .options("/notes/n1")
      .set("Origin", "https://notes.example")
      .set("Access-Control-Request-Method", "PUT")
      .set("Access-Control-Request-Headers", "authorization,content-type,x-arcanist-user");
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "https://notes.example");
    assert.match(res.headers["access-control-allow-methods"], /PUT/);
    assert.match(res.headers["access-control-allow-headers"], /X-Arcanist-User/);
  });
});

describe("auth", () => {
  it("requires the bearer token when configured", async () => {
    const { app } = setup({ authToken: "secret" });
    assert.equal((await request(app).get("/notes")).status, 401);
    assert.equal((await request(app).get("/notes").set("Authorization", "Bearer nope")).status, 401);
    assert.equal((await request(app).get("/notes").set("Authorization", "Bearer secret")).status, 200);
    assert.equal((await request(app).get("/health")).status, 200);
  });
});
