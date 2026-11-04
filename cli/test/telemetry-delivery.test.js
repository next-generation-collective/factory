// End-to-end proof that counts queued on the AI-tool path actually arrive: the real MCP
// server forks the real job process against a local listener standing in for the worker.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../lib/mcp.js";
import { checkCounts } from "../lib/commands.js";

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// A stand-in for the worker. stall: accept the connection and never answer.
async function listener(t, { stall = false } = {}) {
  const events = [];
  const server = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      events.push(JSON.parse(body));
      if (!stall) response.end("{}");
    });
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(() => server.close());
  return { events, url: `http://127.0.0.1:${server.address().port}/v1/events` };
}

// A home with the sharing answer recorded, and an environment where sends are allowed.
// The forked job inherits this environment, which is the point: it is the real path.
function sharingHome(t, { share }) {
  const home = mkdtempSync(join(tmpdir(), "factory-delivery-home-"));
  const saved = {};
  for (const key of ["XDG_CONFIG_HOME", "NODE_TEST_CONTEXT", "CI", "DO_NOT_TRACK", "NEXT_GEN_TELEMETRY", "NEXT_GEN_TELEMETRY_URL"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, "next-gen"), { recursive: true });
  writeFileSync(join(home, "next-gen", "settings.json"), JSON.stringify({ share, id: "delivery-test" }));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

// A tiny project with an approved spec, so factory_prove runs for real.
function approvedProject(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-delivery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop" }));
  writeFileSync(join(root, "index.js"), "export const add = (a, b) => a + b;\n");
  const name = "001-add-numbers";
  const spec = "# Add numbers\n\n## Acceptance checks\n\n- AC1: add(1, 2) is 3\n";
  mkdirSync(join(root, "specs", name), { recursive: true });
  writeFileSync(join(root, "specs", name, "spec.md"), spec);
  writeFileSync(
    join(root, "specs", name, "approval.json"),
    JSON.stringify({ spec: name, hash: createHash("sha256").update(spec).digest("hex"), approvedAt: new Date().toISOString(), approvedBy: "Test" }),
  );
  writeFileSync(join(root, "factory.config.json"), JSON.stringify({ name: "shop", kind: "script", spec: { active: name, required: true } }));
  return root;
}

function connect(root) {
  const sent = [];
  const server = createServer({ root, send: (message) => sent.push(message) });
  const call = (id, method, params) => server.handle({ jsonrpc: "2.0", id, method, params });
  return { server, call, replyTo: (id) => sent.find((m) => m.id === id) };
}

test("delivery: check and prove events from the MCP job process reach the endpoint, with minutes", async (t) => {
  sharingHome(t, { share: true });
  const { events, url } = await listener(t);
  process.env.NEXT_GEN_TELEMETRY_URL = url;
  const root = approvedProject(t);
  const { server, call, replyTo } = connect(root);
  t.after(() => server.stopAll());

  // Blocks this process for longer than the send's 1.5 second abort, the way a
  // spawnSync-heavy handler blocks after queueing a count (spec scenario 1).
  const block = () => spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 2000)"]);

  await call(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code" } });
  await call(1, "tools/call", { name: "factory_check", arguments: {} });
  assert.ok(replyTo(1), "the check replied");
  block();
  assert.ok(events.some((e) => e.event === "check"), "the check event had already arrived when the reply existed");
  await call(2, "tools/call", { name: "factory_prove", arguments: {} });
  assert.ok(replyTo(2), "the prove replied");
  block();
  assert.ok(events.some((e) => e.event === "prove"), "the prove event had already arrived when the reply existed");
  for (const name of ["check", "prove"]) {
    const event = events.find((e) => e.event === name);
    assert.equal(event.props.mode, "mcp");
    assert.ok(Number.isInteger(event.props.minutes) && event.props.minutes >= 0, `${name} carries whole minutes`);
  }
});

test("delivery: with sharing off, the same runs send nothing", async (t) => {
  sharingHome(t, { share: false });
  const { events, url } = await listener(t);
  process.env.NEXT_GEN_TELEMETRY_URL = url;
  const root = approvedProject(t);
  const { server, call, replyTo } = connect(root);
  t.after(() => server.stopAll());

  await call(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  await call(1, "tools/call", { name: "factory_check", arguments: {} });
  await call(2, "tools/call", { name: "factory_prove", arguments: {} });
  assert.ok(replyTo(1) && replyTo(2), "both jobs replied");
  await wait(500);
  assert.equal(events.length, 0, "nothing left the machine");
});

test("delivery: an endpoint that never answers never delays or breaks the work", async (t) => {
  sharingHome(t, { share: true });
  const { url } = await listener(t, { stall: true });
  process.env.NEXT_GEN_TELEMETRY_URL = url;
  const root = approvedProject(t);
  const { server, call, replyTo } = connect(root);
  t.after(() => server.stopAll());

  await call(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  const started = Date.now();
  await call(1, "tools/call", { name: "factory_check", arguments: {} });
  assert.ok(replyTo(1), "the reply arrived despite the dead endpoint");
  assert.ok(Date.now() - started < 15000, "the job was not held hostage");
  assert.ok(!replyTo(1).result.isError, "the check still worked");
});

test("delivery: the CLI path reports the same shape, minutes included", () => {
  const run = { kind: "script", ok: true, minutes: 7, results: [{ id: "secrets", status: "pass" }] };
  const counts = checkCounts(run, { mode: "cli" });
  assert.equal(counts.minutes, 7);
  const old = checkCounts({ kind: "script", ok: true, results: [] }, { mode: "cli" });
  assert.equal(old.minutes, 0, "a run without a duration still sends a whole number");
});

test("delivery: both CLI prove sends carry minutes", async () => {
  // The prove sends live inside the build loop, which needs a live agent to drive, so
  // this is a tripwire on the source: every CLI prove event must name minutes.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../lib/commands.js", import.meta.url), "utf8");
  const sends = source.match(/send\("prove",.*$/gm) ?? [];
  assert.equal(sends.length, 2, "both prove call sites are present");
  for (const line of sends) assert.match(line, /minutes/, `carries minutes: ${line}`);
});

test("delivery: the telemetry doc names the minutes field and the AI-tool path", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = readFileSync(new URL("../../docs/TELEMETRY.md", import.meta.url), "utf8");
  assert.match(doc, /whole minutes/);
  assert.match(doc, /AI tool/);
});
