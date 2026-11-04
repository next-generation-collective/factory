import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentInvocation, runAgent, safeCommand } from "../lib/agent.js";
import { normaliseAgent } from "../lib/agents.js";
import { readConfig } from "../lib/config.js";
import { detectStack } from "../lib/detect.js";
import { verify } from "../lib/verify.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, file, text) {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

const BIG = "x".repeat(200000);

test("agent: with no placeholder the prompt goes on stdin, however long", (t) => {
  const root = temp(t);
  const script = 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>require("fs").writeFileSync("got.txt",String(d.length)))';
  const { ok } = runAgent(root, BIG, { agent: { command: process.execPath, args: ["-e", script] } });
  assert.equal(ok, true);
  assert.equal(readFileSync(join(root, "got.txt"), "utf8"), String(BIG.length));
});

test("agent: {promptFile} is replaced with the saved prompt's path", (t) => {
  const root = temp(t);
  write(root, "prompt.md", "hello");
  const script = 'require("fs").writeFileSync("got.txt", require("fs").readFileSync(process.argv[1], "utf8"))';
  const { ok } = runAgent(root, "hello", { agent: { command: process.execPath, args: ["-e", script, "{promptFile}"] } }, join(root, "prompt.md"));
  assert.equal(ok, true);
  assert.equal(readFileSync(join(root, "got.txt"), "utf8"), "hello");
});

test("agent: {prompt} still works for custom configs, and then nothing goes on stdin", () => {
  const call = agentInvocation(["-p", "{prompt}"], "do it", "/tmp/p.md");
  assert.deepEqual(call.args, ["-p", "do it"]);
  assert.equal(call.stdin, null);
  assert.equal(call.inline, true);
});

test("agent: a command with shell syntax is refused", () => {
  assert.equal(safeCommand("claude"), true);
  assert.equal(safeCommand("/usr/local/bin/claude"), true);
  assert.equal(safeCommand("C:\\Tools\\claude.cmd"), true);
  assert.equal(safeCommand("C:\\Program Files\\nodejs\\node.exe"), true);
  assert.equal(safeCommand("claude; rm -rf ~"), false);
  assert.equal(safeCommand("$(evil)"), false);
  assert.equal(runAgent(process.cwd(), "x", { agent: { command: "claude && evil", args: [] } }).ok, false);
});

test("agents: known agents get their settings from the command alone", () => {
  assert.deepEqual(normaliseAgent({ command: "codex" }).args, ["exec", "-s", "workspace-write"]);
  assert.deepEqual(normaliseAgent({ command: "claude" }).args, ["-p", "--permission-mode", "acceptEdits"]);
  assert.ok(normaliseAgent({ command: "opencode" }).args.includes("{promptFile}"));
  assert.deepEqual(normaliseAgent({ command: "my-agent" }).args, []);
  assert.deepEqual(normaliseAgent({ command: "my-agent", args: ["--go"] }).args, ["--go"]);
});

test("agents: a 0.2.0 config (claude -p {prompt}) moves to stdin and may edit files", (t) => {
  const root = temp(t);
  write(root, "factory.config.json", JSON.stringify({ name: "Old", agent: { command: "claude", args: ["-p", "{prompt}"] } }));
  assert.deepEqual(readConfig(root).agent.args, ["-p", "--permission-mode", "acceptEdits"]);
});

test("detect: a monorepo reports its main app and runs commands in the right place", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "mono", workspaces: ["apps/*", "packages/*"] }));
  write(root, "yarn.lock", "");
  write(root, "apps/api/package.json", JSON.stringify({ dependencies: { hono: "4" }, scripts: { test: "bun test" } }));
  write(root, "apps/native/package.json", JSON.stringify({ dependencies: { expo: "54" }, scripts: { test: "node --test" } }));
  write(root, "packages/ui/package.json", JSON.stringify({ name: "ui" }));

  const stack = detectStack(root);
  assert.equal(stack.kind, "mobile");
  assert.equal(stack.framework, "expo");
  assert.equal(stack.primary, "apps/native");
  assert.equal(stack.packageManager, "yarn");
  assert.equal(stack.testCommand, "yarn test");
  assert.equal(stack.commandCwd, "apps/native");
  assert.deepEqual(stack.workspaces.map((w) => w.path), ["apps/api", "apps/native", "packages/ui"]);
});

test("detect: root scripts win in a monorepo (turbo runs every package)", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ workspaces: ["apps/*"], scripts: { test: "turbo run test" } }));
  write(root, "apps/web/package.json", JSON.stringify({ dependencies: { next: "15" }, scripts: { test: "vitest" } }));
  const stack = detectStack(root);
  assert.equal(stack.kind, "web");
  assert.equal(stack.testCommand, "npm test");
  assert.equal(stack.commandCwd, null);
});

test("detect: a Python project never says npm, and uses its own runner", (t) => {
  const root = temp(t);
  write(root, "pyproject.toml", "[project]\nname = 'x'\n");
  write(root, "uv.lock", "");
  mkdirSync(join(root, "tests"));
  const stack = detectStack(root);
  assert.equal(stack.language, "python");
  assert.equal(stack.packageManager, "uv");
  assert.equal(stack.testCommand, "uv run pytest -q");
});

test("evidence: with an active spec, proof lands in the spec folder", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  write(root, "specs/001-booking/spec.md", "# Spec\n");
  write(root, "factory.config.json", JSON.stringify({ name: "Demo", spec: { active: "001-booking" } }));
  const run = verify(root, {});
  assert.equal(run.mdRel, "specs/001-booking/evidence/verify-latest.md");
  assert.ok(readFileSync(join(root, "specs", "001-booking", "evidence", "verify-latest.json"), "utf8").includes('"ok": true'));
});

test("evidence: without a spec, proof stays in .factory", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  const run = verify(root, {});
  assert.match(run.mdRel, /^\.factory/);
});
