import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "../lib/mcp.js";
import { readApproval } from "../lib/spec.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-mcp-"));
  const home = mkdtempSync(join(tmpdir(), "factory-mcp-home-"));
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  t.after(() => {
    process.env.XDG_CONFIG_HOME = saved;
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop", scripts: { test: "node -e 0" } }));
  writeFileSync(join(root, "index.js"), "export const add = (a, b) => a + b;\n");
  return root;
}

// A pretend AI tool: collects what the server sends and answers its questions.
function client(root, { canAsk = false, answer = null } = {}) {
  const sent = [];
  let server;
  const send = (message) => {
    sent.push(message);
    if (message.method === "elicitation/create") queueMicrotask(() => server.handle({ jsonrpc: "2.0", id: message.id, result: answer }));
  };
  server = createServer({ root, send });
  const call = async (id, method, params) => {
    await server.handle({ jsonrpc: "2.0", id, method, params });
    return sent.find((m) => m.id === id);
  };
  const ready = call(0, "initialize", { protocolVersion: "2025-06-18", capabilities: canAsk ? { elicitation: {} } : {} });
  const tool = async (id, name, args = {}) => (await call(id, "tools/call", { name, arguments: args })).result.content[0].text;
  return { ready, call, tool, sent };
}

function writeSpec(root, text = "# Spec\n\n## Acceptance checks\n\n- AC1: add(1, 2) is 3\n") {
  const dir = join(root, "specs", "001-add-numbers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), text);
}

test("mcp: the AI tool sees the server, its instructions and its tools", async (t) => {
  const { ready, call } = client(temp(t));
  const init = (await ready).result;
  assert.equal(init.serverInfo.title, "Next-Gen Factory");
  assert.match(init.instructions, /The person approves the spec, not you/);
  const names = (await call(1, "tools/list")).result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["factory_check", "factory_start", "factory_approve", "factory_prove", "factory_share", "factory_feedback", "factory_review"]);
});

test("mcp: an unknown protocol version gets one the server speaks", async (t) => {
  const root = temp(t);
  const sent = [];
  const server = createServer({ root, send: (m) => sent.push(m) });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01", capabilities: {} } });
  assert.equal(sent[0].result.protocolVersion, "2025-06-18");
});

test("mcp: the first check welcomes the builder once, and changes nothing", async (t) => {
  const root = temp(t);
  const { ready, tool } = client(root);
  await ready;
  const first = await tool(1, "factory_check");
  assert.match(first, /Welcome to Next-Gen Factory/);
  assert.match(first, /What this project can prove right now/);
  assert.doesNotMatch(await tool(2, "factory_check"), /Welcome to Next-Gen Factory/);
});

test("mcp: start sets up the job and says where the spec goes", async (t) => {
  const root = temp(t);
  const { ready, tool } = client(root);
  await ready;
  const reply = await tool(1, "factory_start", { request: "add a discount" });
  assert.match(reply, /Write the spec to specs\/001-add-a-discount\/spec\.md/);
});

test("mcp: without an approval box, the AI must bring back the person's own words", async (t) => {
  const root = temp(t);
  const { ready, tool } = client(root);
  await ready;
  await tool(1, "factory_start", { request: "add numbers" });
  writeSpec(root);
  assert.match(await tool(2, "factory_approve"), /Only after they say yes/);
  assert.equal(readApproval(root, "001-add-numbers"), null);

  const reply = await tool(3, "factory_approve", { person_said: "Yes, build it" });
  assert.match(reply, /Approved by .+ \(chat\)/);
  assert.equal(readApproval(root, "001-add-numbers").how.personSaid, "Yes, build it");
});

test("mcp: the approval box decides when the AI tool has one", async (t) => {
  const yes = temp(t);
  const accepted = client(yes, { canAsk: true, answer: { action: "accept", content: { approve: true } } });
  await accepted.ready;
  await accepted.tool(1, "factory_start", { request: "add numbers" });
  writeSpec(yes);
  assert.match(await accepted.tool(2, "factory_approve"), /approval box/);

  const no = temp(t);
  const declined = client(no, { canAsk: true, answer: { action: "decline" } });
  await declined.ready;
  await declined.tool(1, "factory_start", { request: "add numbers" });
  writeSpec(no);
  assert.match(await declined.tool(2, "factory_approve", { person_said: "" }), /did not approve/);
  assert.equal(readApproval(no, "001-add-numbers"), null);
});

test("mcp: prove refuses work that was never approved", async (t) => {
  const root = temp(t);
  const { ready, tool } = client(root);
  await ready;
  await tool(1, "factory_start", { request: "add numbers" });
  writeSpec(root);
  assert.match(await tool(2, "factory_prove"), /Get the person's approval/);
});

test("mcp: nothing the commands print reaches the AI tool's channel", async (t) => {
  const root = temp(t);
  const { ready, tool, sent } = client(root);
  await ready;
  await tool(1, "factory_start", { request: "add numbers" });
  assert.ok(sent.every((m) => m.jsonrpc === "2.0"));
});

test("mcp: started in the home folder, it asks the AI tool which project is open (VS Code)", async (t) => {
  const project = temp(t);
  const home = mkdtempSync(join(tmpdir(), "factory-mcp-start-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sent = [];
  let server;
  const send = (message) => {
    sent.push(message);
    if (message.method === "roots/list") {
      queueMicrotask(() => server.handle({ jsonrpc: "2.0", id: message.id, result: { roots: [{ uri: pathToFileURL(project).href, name: "shop" }] } }));
    }
  };
  server = createServer({ root: home, home, send });
  await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { roots: {} } } });
  await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "factory_start", arguments: { request: "Add a total" } } });
  const reply = sent.find((m) => m.id === 1).result;
  assert.ok(!reply.isError, reply.content[0].text);
  assert.match(reply.content[0].text, /Next-Gen Factory job/);
  assert.ok(existsSync(join(project, "specs")));
});

test("mcp: started in the home folder with no way to ask, it still refuses kindly", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "factory-mcp-start-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sent = [];
  const server = createServer({ root: home, home, send: (m) => sent.push(m) });
  await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "factory_check", arguments: {} } });
  assert.match(sent.find((m) => m.id === 1).result.content[0].text, /home folder/);
});
