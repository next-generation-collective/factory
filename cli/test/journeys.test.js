import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseProject } from "../lib/analyse.js";
import { build, specCommand } from "../lib/commands.js";
import { readConfig, readState, writeConfig } from "../lib/config.js";
import { appUrlAllowed, browserServers, checkJourneys, journeyAgent, pickDriver, startApp, startCommand } from "../lib/journeys.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-journeys-"));
  // Windows keeps a stopped server's folder busy for a moment; retry the clean-up.
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  return root;
}

function write(root, file, text) {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

const config = { agent: { command: "claude", args: ["-p", "--permission-mode", "acceptEdits"] }, checks: {} };

test("driver: a website uses Playwright when the project has it", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ dependencies: { next: "15" }, devDependencies: { "@playwright/test": "1" } }));
  assert.equal(pickDriver(root, analyseProject(root), config, { home: root }).driver, "playwright");
});

test("driver: a website uses a browser tool from the project or from Claude's own settings", (t) => {
  const root = temp(t);
  const home = temp(t);
  write(root, "package.json", JSON.stringify({ dependencies: { next: "15" } }));
  assert.equal(pickDriver(root, analyseProject(root), config, { home }).driver, null);

  write(home, ".claude.json", JSON.stringify({ mcpServers: { "firefox-devtools": { command: "npx", args: ["firefox-devtools-mcp"] } } }));
  const info = pickDriver(root, analyseProject(root), config, { home });
  assert.equal(info.driver, "firefox-devtools-mcp");
  assert.deepEqual(info.tools, ["mcp__firefox-devtools"]);

  write(root, ".mcp.json", JSON.stringify({ mcpServers: { browser: { command: "npx", args: ["chrome-devtools-mcp@latest"] } } }));
  assert.equal(pickDriver(root, analyseProject(root), config, { home }).driver, "chrome-devtools-mcp");
  assert.deepEqual(browserServers(root, home).map((s) => s.name), ["browser", "firefox-devtools"]);
});

test("driver: a phone app uses Maestro only when the project already has it", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ dependencies: { expo: "54" } }));
  assert.match(pickDriver(root, analyseProject(root), config, { home: root }).reason, /Maestro/);
  write(root, ".maestro/sign_in.yaml", "appId: x\n");
  assert.equal(pickDriver(root, analyseProject(root), config, { home: root }).driver, "maestro");
});

test("tester: Claude Code gets exactly the driver's tools; other agents need agent.journeys", () => {
  const info = { driver: "firefox-devtools-mcp", tools: ["mcp__firefox-devtools"] };
  assert.deepEqual(journeyAgent(config, info).agent.args, ["-p", "--permission-mode", "acceptEdits", "--allowedTools", "mcp__firefox-devtools"]);
  assert.equal(journeyAgent({ agent: { command: "codex", args: [] } }, info), null);
  assert.equal(journeyAgent({ agent: { command: "codex", args: [], journeys: { command: "my-tester", args: [] } } }, info).agent.command, "my-tester");
});

test("safety: the app is used on this machine unless the config allows otherwise", () => {
  assert.equal(appUrlAllowed("http://localhost:3000", config), true);
  assert.equal(appUrlAllowed("http://127.0.0.1:5173/", config), true);
  assert.equal(appUrlAllowed("https://shop.example.com", config), false);
  assert.equal(appUrlAllowed("https://shop.example.com", { checks: { allowRemoteApp: true } }), true);
});

const SERVER = `
const http = require("http");
const server = http.createServer((req, res) => res.end("<h1>hello</h1>"));
server.listen(0, "127.0.0.1", () => console.log("ready on http://localhost:" + server.address().port));
`;

test("start: the dev script runs, the printed address is found, and the app is stopped after", (t) => {
  const root = temp(t);
  write(root, "server.js", SERVER);
  write(root, "package.json", JSON.stringify({ dependencies: { vite: "5" }, scripts: { dev: "node server.js" } }));
  const start = startCommand(root, analyseProject(root).stack);
  assert.deepEqual(start, { command: "npm run dev", cwd: null });
  const app = startApp(root, start, { logFile: join(root, "app.log"), timeoutSeconds: 30 });
  t.after(() => app.stop());
  assert.equal(app.error, undefined, app.error);
  assert.match(app.url, /^http:\/\/localhost:\d+$/);
  app.stop();
});

test("start: an app that never answers is reported, not waited on forever", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ scripts: { dev: 'node -e "setTimeout(() => {}, 60000)"' } }));
  const app = startApp(root, { command: "npm run dev", cwd: null }, { logFile: join(root, "app.log"), url: "http://localhost:9", timeoutSeconds: 2 });
  assert.match(app.error, /did not answer within 2 seconds/);
});

const TABLE = (rows) => `| Check | Steps | What you saw | Result | Screenshot |\n|---|---|---|---|---|\n${rows.join("\n")}\n`;

test("journeys: every PASS needs its screenshot", (t) => {
  const root = temp(t);
  const dir = join(root, "evidence", "journeys");
  write(root, "evidence/journeys/AC1-saved.png", "png");
  write(root, "evidence/journeys/journeys.md", TABLE(["| AC1 | booked, reloaded | listed | PASS | evidence/journeys/AC1-saved.png |"]));
  assert.equal(checkJourneys(root, dir).status, "pass");

  write(root, "evidence/journeys/journeys.md", TABLE(["| AC1 | booked | listed | PASS | evidence/journeys/missing.png |"]));
  const missing = checkJourneys(root, dir);
  assert.equal(missing.status, "fail");
  assert.match(missing.details[0], /no screenshot/);

  write(root, "evidence/journeys/journeys.md", TABLE(["| AC1 | booked | error toast | FAIL | |"]));
  assert.equal(checkJourneys(root, dir).status, "fail");

  write(root, "evidence/journeys/journeys.md", TABLE(["| none | | nothing a person sees changed | SKIP | |"]));
  assert.equal(checkJourneys(root, dir).status, "na");
});

test("journeys: nothing written is a failure", (t) => {
  const root = temp(t);
  assert.match(checkJourneys(root, join(root, "nowhere")).summary, /No journeys recorded/);
});

// A pretend agent for a whole build: writes spec, plan and tasks, writes journeys.md and a
// screenshot when asked to use the app, and approves when asked to review.
const FAKE = `
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const fs = require("fs"), path = require("path");
  const doc = d.match(/## Write the (?:spec|plan|task list) here\\n\\n\`([^\`]+)\`/);
  const journeys = d.match(/## Write this file\\n\\n\`([^\`]+journeys\\.md)\`/);
  const review = d.match(/## Write this file, and nothing else\\n\\n\`([^\`]+)\`/);
  if (doc) {
    fs.mkdirSync(path.dirname(doc[1]), { recursive: true });
    fs.writeFileSync(doc[1], "# Booking page\\n\\n- [ ] AC1 the booking is listed. Proof: it shows after reload\\n");
  } else if (journeys) {
    const dir = path.dirname(journeys[1]);
    const url = (d.match(/running at (http:\\/\\/localhost:\\d+)/) || [])[1] || "none";
    if (!process.env.FAKE_NO_PICTURE) fs.writeFileSync(path.join(dir, "AC1-listed.png"), "png");
    fs.writeFileSync(journeys[1], "| Check | Steps | What you saw | Result | Screenshot |\\n|---|---|---|---|---|\\n| AC1 | opened " + url + " | listed | PASS | " + dir + "/AC1-listed.png |\\n");
  } else if (review) {
    fs.writeFileSync(review[1], "# Review\\n\\n## Acceptance checks\\n\\n| Check | Verdict | Evidence |\\n|---|---|---|\\n| AC1 | PASS | screenshot |\\n\\nMissing: none\\n\\nVERDICT: approve\\n");
  }
});`;

async function webProject(t) {
  const root = temp(t);
  write(root, "server.js", SERVER);
  write(root, "package.json", JSON.stringify({ dependencies: { vite: "5" }, scripts: { dev: "node server.js" } }));
  write(root, ".mcp.json", JSON.stringify({ mcpServers: { "firefox-devtools": { command: "npx", args: ["firefox-devtools-mcp"] } } }));
  const git = (...args) => spawnSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "start");
  const agent = { command: process.execPath, args: ["-e", FAKE] };
  writeConfig(root, { ...readConfig(root), agent: { ...agent, journeys: agent } });
  await specCommand(root, { quiet: true }, ["booking page"]);
  await specCommand(root, { approve: true, by: "Sibusiso", quiet: true }, []);
  return root;
}

test("build: the app is started, used, screenshotted and stopped before the review", async (t) => {
  const root = await webProject(t);
  assert.equal(build(root, { attempts: 1 }), 0);
  const state = readState(root);
  assert.equal(state.lastJourneys.status, "pass");
  assert.match(state.lastJourneys.summary, /1 journey worked, each with a screenshot/);
  const dir = join(root, state.lastJourneys.dir);
  assert.ok(readdirSync(dir).includes("AC1-listed.png"));
  assert.ok(readdirSync(dir).includes("app.log"));
  assert.equal(state.lastReview.passed, true);
});

test("build: a journey that claims PASS without a screenshot sends the work back", async (t) => {
  const root = await webProject(t);
  process.env.FAKE_NO_PICTURE = "1";
  t.after(() => delete process.env.FAKE_NO_PICTURE);
  assert.equal(build(root, { attempts: 1 }), 1);
  assert.equal(readState(root).lastJourneys.status, "fail");
  assert.equal(readState(root).lastBuild, undefined);
});

test("start: an app already running at the address is never mistaken for this one", (t) => {
  const root = temp(t);
  write(root, "other.js", SERVER);
  const other = startApp(root, { command: "node other.js", cwd: null }, { logFile: join(root, "other.log"), timeoutSeconds: 30 });
  t.after(() => other.stop());
  assert.equal(other.error, undefined, other.error);

  write(root, "package.json", JSON.stringify({ scripts: { dev: "node server.js" } }));
  write(root, "server.js", SERVER);
  const app = startApp(root, { command: "npm run dev", cwd: null }, { logFile: join(root, "app.log"), url: other.url, timeoutSeconds: 5 });
  assert.match(app.error, /already answering/);
  other.stop();
});

test("start: an app that prints nothing is found on the port it was given", (t) => {
  const root = temp(t);
  write(root, "quiet.js", 'require("http").createServer((q, r) => r.end("ok")).listen(Number(process.env.PORT), "127.0.0.1");');
  const app = startApp(root, { command: "node quiet.js", cwd: null }, { logFile: join(root, "app.log"), timeoutSeconds: 30 });
  t.after(() => app.stop());
  assert.equal(app.error, undefined, app.error);
  assert.equal(app.url, `http://localhost:${app.port}`);
  app.stop();
});
