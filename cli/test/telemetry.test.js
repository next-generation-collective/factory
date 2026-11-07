import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedByEnvironment, needsAnswer, payload, progressLine, recordProven, send, setSharing, sharing, stats } from "../lib/telemetry.js";

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), "factory-telemetry-"));
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT, CI: process.env.CI };
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("telemetry: build servers and do-not-track are never asked and never share", () => {
  assert.equal(blockedByEnvironment({ CI: "true" }), true);
  assert.equal(blockedByEnvironment({ DO_NOT_TRACK: "1" }), true);
  assert.equal(blockedByEnvironment({ NEXT_GEN_TELEMETRY: "off" }), true);
  assert.equal(blockedByEnvironment({}), false);
});

test("telemetry: nothing is shared until the builder says yes", (t) => {
  home(t);
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.CI;
  assert.equal(needsAnswer(), true);
  assert.equal(sharing(), false);
  setSharing(false);
  assert.equal(needsAnswer(), false);
  assert.equal(sharing(), false);
  setSharing(true);
  assert.equal(sharing(), true);
});

test("telemetry: only counts leave the machine; names, paths and text are dropped", () => {
  const sent = payload("prove", { ok: true, attempts: 2, failed: ["tests", "../etc/passwd", "secrets"], project: "Sibusiso's shop", file: "/Users/x/a.js", via: "chat" }, "1.0.0");
  assert.deepEqual(Object.keys(sent.props).sort(), ["attempts", "failed", "ok", "via"]);
  assert.deepEqual(sent.props.failed, ["tests", "secrets"]);
  assert.equal(JSON.stringify(sent).includes("Sibusiso"), false);
});

test("telemetry: it sends only when sharing, and a failure never breaks the work", async (t) => {
  home(t);
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.CI;
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push(JSON.parse(init.body)), { ok: true });
  assert.equal(await send("run", { mode: "cli" }, "1.0.0", { fetchImpl }), false);
  setSharing(true);
  assert.equal(await send("run", { mode: "cli" }, "1.0.0", { fetchImpl }), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(await send("run", {}, "1.0.0", { fetchImpl: async () => { throw new Error("offline"); } }), false);
});

test("telemetry: the builder's own progress is kept on their computer", (t) => {
  home(t);
  assert.equal(progressLine(), null);
  const now = new Date("2026-10-28T10:00:00Z");
  recordProven({ caught: 1 }, now);
  recordProven({ caught: 0 }, now);
  assert.equal(stats().proven, 2);
  assert.equal(progressLine(stats(), now), "2 proven builds. The factory caught 1 mistake for you this week.");
});

test("feedback: the builder's words become a filled-in GitHub form, never sent for them", async () => {
  const { feedbackUrl, guessFeeling } = await import("../lib/telemetry.js");
  assert.equal(guessFeeling("it caught a secret I missed, amazing"), "loved");
  assert.equal(guessFeeling("false alarm on my test password"), "false-alarm");
  assert.equal(guessFeeling("I wish it worked with Cursor"), "wish");
  const url = new URL(feedbackUrl("I wish it worked with Cursor", "wish"));
  assert.equal(url.searchParams.get("template"), "feedback.yml");
  assert.equal(url.searchParams.get("what"), "I wish it worked with Cursor");
  assert.match(url.searchParams.get("kind"), /^Wish/);
});
