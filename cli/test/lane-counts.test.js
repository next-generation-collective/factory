// Spec 007: the shared counts say which lane a job took, when the prove loop stopped
// itself, and when a small job was upgraded to a full one. Nothing else new leaves.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep every write away from the real home folder, before anything reads it.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "factory-lane-home-"));

const { payload } = await import("../lib/telemetry.js");
const { writeState } = await import("../lib/config.js");
const { jobs } = await import("../lib/mcp.js");

const FAKE_KEY = ["sk", "R7kQ2mX9pL4vT8nB3wZ6cF1hJ5sD0aG"].join("-"); // factory:allow-secret

// AC1: clean() lets exactly the three new keys through and still drops everything else.
test("counts: lane, stopped and upgraded pass the filter, unknown keys never do", () => {
  const p = payload("prove", { lane: "quick", stopped: true, upgraded: true, file: "a.js", path: "/home/x" }, "0.0.0");
  assert.equal(p.props.lane, "quick");
  assert.equal(p.props.stopped, true);
  assert.equal(p.props.upgraded, true);
  assert.ok(!("file" in p.props), "file names are dropped before sending");
  assert.ok(!("path" in p.props), "paths are dropped before sending");
});

// A local stand-in for the worker, so the test reads exactly what would have been sent.
async function listener(t) {
  const events = [];
  const server = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      events.push(JSON.parse(body));
      response.end("{}");
    });
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(() => server.close());
  return { events, url: `http://127.0.0.1:${server.address().port}/v1/events` };
}

// Sharing on, and none of the environment blocks in the way, restored after the test.
function allowSending(t, url) {
  const saved = {};
  for (const key of ["NODE_TEST_CONTEXT", "CI", "DO_NOT_TRACK", "NEXT_GEN_TELEMETRY", "NEXT_GEN_TELEMETRY_URL"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NEXT_GEN_TELEMETRY_URL = url;
  mkdirSync(join(process.env.XDG_CONFIG_HOME, "next-gen"), { recursive: true });
  writeFileSync(join(process.env.XDG_CONFIG_HOME, "next-gen", "settings.json"), JSON.stringify({ share: true, id: "lane-counts-test" }));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  });
}

function project(t, { leaky = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "factory-lane-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop" }));
  writeFileSync(join(root, "index.js"), leaky ? `const key = "${FAKE_KEY}";\n` : "export const add = (a, b) => a + b;\n"); // factory:allow-secret
  const name = "001-job";
  const spec = "# Job\n\n## Acceptance checks\n\n- AC1: something\n";
  mkdirSync(join(root, "specs", name), { recursive: true });
  writeFileSync(join(root, "specs", name, "spec.md"), spec);
  writeFileSync(
    join(root, "specs", name, "approval.json"),
    JSON.stringify({ spec: name, hash: createHash("sha256").update(spec).digest("hex"), approvedAt: new Date().toISOString(), approvedBy: "Test" }),
  );
  writeFileSync(join(root, "factory.config.json"), JSON.stringify({ name: "shop", kind: "script", spec: { active: name, required: true } }));
  return root;
}

// AC2: the MCP prove event carries the lane, and the flags only when they happened.
test("counts: a quick job's prove event says quick, with no stopped or upgraded flag", async (t) => {
  const { events, url } = await listener(t);
  allowSending(t, url);
  const root = project(t);
  writeState(root, { lane: "quick", notDone: 0 });
  await jobs.factory_prove({ root, client: "test" });
  const prove = events.find((e) => e.event === "prove");
  assert.ok(prove, "the prove event arrived");
  assert.equal(prove.props.lane, "quick");
  assert.ok(!("stopped" in prove.props), "a first round is never marked stopped");
  assert.ok(!("upgraded" in prove.props), "nothing was upgraded");
});

test("counts: only the third failed round in a row carries stopped: true", async (t) => {
  const { events, url } = await listener(t);
  allowSending(t, url);
  const root = project(t, { leaky: true });
  writeState(root, { lane: "full", notDone: 0 });
  for (let round = 0; round < 3; round++) await jobs.factory_prove({ root, client: "test" });
  const proves = events.filter((e) => e.event === "prove");
  assert.equal(proves.length, 3, "each round sent one event");
  assert.ok(!("stopped" in proves[0].props), "round one is not stopped");
  assert.ok(!("stopped" in proves[1].props), "round two is not stopped");
  assert.equal(proves[2].props.stopped, true, "round three says the loop stopped itself");
  for (const p of proves) assert.equal(p.props.lane, "full");
});

test("counts: a small job that outgrew its route reports upgraded: true and lane full", async (t) => {
  const { events, url } = await listener(t);
  allowSending(t, url);
  const root = project(t);
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=T", ...args], { cwd: root, encoding: "utf8" });
  git("init");
  git("add", ".");
  git("commit", "-m", "start");
  const head = git("rev-parse", "HEAD").stdout.trim();
  for (const file of ["b.js", "c.js", "d.js"]) writeFileSync(join(root, file), "1\n");
  writeState(root, { lane: "quick", buildBase: head, notDone: 0 });
  await jobs.factory_prove({ root, client: "test" });
  const prove = events.find((e) => e.event === "prove");
  assert.ok(prove, "the prove event arrived");
  assert.equal(prove.props.upgraded, true);
  assert.equal(prove.props.lane, "full", "the lane reported is the one the job ended on");
});

// AC3: the CLI path names the lane on both of its prove sends, and records the lane
// when the spec is written. The build loop needs a live agent, so this is a tripwire
// on the source, the same way the minutes field is held in place.
test("counts: both CLI prove sends carry the lane, and the spec step records it", () => {
  const source = readFileSync(new URL("../lib/commands.js", import.meta.url), "utf8");
  const sends = source.match(/send\("prove",.*$/gm) ?? [];
  assert.equal(sends.length, 2, "both prove call sites are present");
  for (const line of sends) assert.match(line, /lane/, `carries the lane: ${line}`);
  assert.match(source, /writeState\(root, \{ lane: /, "writing a spec records the lane it took");
});

// AC4: the published promise matches what is sent.
test("counts: docs/TELEMETRY.md lists the three new fields", () => {
  const doc = readFileSync(new URL("../../docs/TELEMETRY.md", import.meta.url), "utf8");
  assert.match(doc, /`quick`, `full`/, "the lane row names its only two values");
  assert.match(doc, /stopped itself at 3 failed rounds/);
  assert.match(doc, /upgraded to a full one/);
});
