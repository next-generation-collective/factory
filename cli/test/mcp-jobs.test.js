import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../lib/mcp.js";

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(check, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await wait(50);
  }
  return false;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A project whose tests take 30 seconds and write down their process id.
function slowProject(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-jobs-"));
  const home = mkdtempSync(join(tmpdir(), "factory-jobs-home-"));
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  t.after(() => {
    process.env.XDG_CONFIG_HOME = saved;
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  const test = `node -e "require('fs').writeFileSync('test.pid', String(process.pid)); setTimeout(() => {}, 30000)"`;
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop", scripts: { test } }));
  writeFileSync(join(root, "index.js"), "export const add = (a, b) => a + b;\n");
  return root;
}

function connect(root, options = {}) {
  const sent = [];
  const server = createServer({ root, send: (message) => sent.push(message), ...options });
  const call = (id, method, params) => server.handle({ jsonrpc: "2.0", id, method, params });
  const replyTo = (id) => sent.find((m) => m.id === id);
  return { server, sent, call, replyTo };
}

test("mcp: ping answers while a slow prove is running, and cancel stops the tests it started", async (t) => {
  const root = slowProject(t);
  const { server, call, replyTo } = connect(root);
  t.after(() => server.stopAll());
  await call(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  await call(1, "tools/call", { name: "factory_start", arguments: { request: "add numbers" } });
  writeFileSync(join(root, "specs", "001-add-numbers", "spec.md"), "# Spec\n\n## Acceptance checks\n\n- AC1: add(1, 2) is 3\n");
  await call(4, "tools/call", { name: "factory_approve", arguments: { person_said: "Yes, build it" } });
  assert.match(replyTo(4).result.content[0].text, /Approved by/);

  const proving = call(2, "tools/call", { name: "factory_prove", arguments: {} });
  const pidFile = join(root, "test.pid");
  assert.ok(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim()), "the tests started");
  const pid = Number(readFileSync(pidFile, "utf8"));

  await call(3, "ping");
  assert.deepEqual(replyTo(3).result, {});
  assert.equal(replyTo(2), undefined, "the ping was answered before prove finished");

  await call(undefined, "notifications/cancelled", { requestId: 2, reason: "the person moved on" });
  await proving;
  assert.ok(await until(() => !alive(pid), 2000), "the test command stopped within 2 seconds");
  assert.equal(replyTo(2), undefined, "a cancelled call gets no reply");
});

test("mcp: the home folder is refused at once instead of read", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "factory-jobs-home-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { call, replyTo } = connect(root, { home: root });
  await call(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  const started = Date.now();
  for (const [id, name] of [[1, "factory_check"], [2, "factory_start"], [3, "factory_prove"]]) {
    await call(id, "tools/call", { name, arguments: { request: "anything" } });
    assert.match(replyTo(id).result.content[0].text, /your home folder, not a project/);
    assert.equal(replyTo(id).result.isError, true);
  }
  assert.ok(Date.now() - started < 1000);
  assert.ok(!existsSync(join(root, "specs")), "nothing was written into the home folder");
});
