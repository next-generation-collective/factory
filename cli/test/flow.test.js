import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalView, guardedTopics } from "../lib/approval.js";
import { approveCommand, build, specCommand } from "../lib/commands.js";
import { readConfig, readState, writeConfig } from "../lib/config.js";
import { fixSummary, pickFix } from "../lib/fixes.js";
import { readApproval } from "../lib/spec.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-flow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, file, text) {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

// A pretend agent: writes the file a spec, plan or task prompt asks for; on a build
// prompt it deletes FAKE_DELETE if set. Reads the prompt from stdin, like claude -p.
const APPROVE = "# Review\n\n| # | Severity | Where | Rule | What is wrong | How to prove it |\n|---|---|---|---|---|---|\n\n## Acceptance checks\n\n| Check | Verdict | Evidence |\n|---|---|---|\n| AC1 | PASS | the factory's npm test passed |\n\nMissing: none\nExtra: none\n\nVERDICT: approve\n";

// A pretend agent: writes the file a spec, plan or task prompt asks for; writes the review
// a review prompt asks for (FAKE_REVIEW, or an approval); on a build prompt it deletes
// FAKE_DELETE if set. FAKE_REVIEWER_EDITS makes the reviewer touch a source file.
// Reads the prompt from stdin, like claude -p.
const FAKE_AGENT = `
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const fs = require("fs"), path = require("path");
  const m = d.match(/## Write the (?:spec|plan|task list) here\\n\\n\`([^\`]+)\`/);
  const r = d.match(/## Write this file, and nothing else\\n\\n\`([^\`]+)\`/);
  if (m) {
    fs.mkdirSync(path.dirname(m[1]), { recursive: true });
    fs.writeFileSync(m[1], "# Booking form\\n\\nWritten by the pretend agent, long enough to count.\\n");
  } else if (r) {
    if (process.env.FAKE_REVIEWER_EDITS) fs.appendFileSync(process.env.FAKE_REVIEWER_EDITS, "// sneaky\\n");
    if (process.env.FAKE_REVIEW !== "none") fs.writeFileSync(r[1], process.env.FAKE_REVIEW || ${JSON.stringify(APPROVE)});
  } else if (process.env.FAKE_DELETE) {
    fs.rmSync(process.env.FAKE_DELETE, { force: true });
  }
});`;

function project(t, { tests = 0 } = {}) {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "demo" }));
  for (let i = 0; i < tests; i++) write(root, `src/t${i}.test.js`, `test("a", () => { expect(${i}).toBe(${i}); });\n`);
  const git = (...args) => spawnSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "start");
  writeConfig(root, { ...readConfig(root), agent: { command: process.execPath, args: ["-e", FAKE_AGENT] } });
  return root;
}

const SPEC = `# Booking form

## Problem

People phone to book.

## States

Covered: loading, error, tapped twice; n/a: dark mode (no new screen)

## Acceptance checks

- [ ] AC1 A booking is stored. Proof: the row exists after submit

## Assumptions

Assumed: one booking per slot.
- Assumed: times are in SAST.

## Open questions

1. Can a patient cancel online?
`;

test("approval view: decisions, guesses, states covered and proof, nothing else", () => {
  const view = approvalView(SPEC);
  assert.match(view, /Decide these first[\s\S]*cancel online/);
  assert.match(view, /The AI assumed[\s\S]*one booking per slot[\s\S]*times are in SAST/);
  assert.match(view, /Covered: loading, error, tapped twice/);
  assert.match(view, /How it will be proven[\s\S]*the row exists after submit/);
  assert.doesNotMatch(view, /People phone to book/);
});

test("approval view: a spec without those sections falls back to its first lines", () => {
  assert.match(approvalView("# Old spec\n\nSome text.\n"), /Old spec/);
});

test("questions: asked only when the code cannot know who else is affected", () => {
  assert.equal(guardedTopics("add sign in with Google"), true);
  assert.equal(guardedTopics("let people pay with a card"), true);
  assert.equal(guardedTopics("show the other user when someone blocks them"), true);
  assert.equal(guardedTopics("make the header button bigger"), false);
  assert.equal(guardedTopics("fix the typo on the about page"), false);
});

const row = (id, status, kind, summary, details = []) => ({ id, status, kind, summary, details, evidence: [], title: id });

test("fix offer: a real credential comes first, and the job never contains its value", () => {
  const results = [
    row("secrets", "fail", "proven", "1 credential", ["src/otp.ts:34  assigned secret"]),
    row("test-proof", "fail", "flagged", "No tests found: nothing here can be proven automatically yet"),
  ];
  const fix = pickFix(results);
  assert.equal(fix.id, "secret");
  assert.match(fix.job, /src\/otp\.ts:34/);
  assert.match(fix.job, /rotated/);
});

test("fix offer: a tracked .env, then empty tests, then no tests at all", () => {
  assert.equal(pickFix([row("secrets", "fail", "proven", "", [".env is tracked by git"])]).id, "env");
  assert.equal(pickFix([row("test-proof", "fail", "flagged", "1 test file to look at", ["a.test.js: 2 tests, no assertion"])]).id, "assertions");
  assert.equal(pickFix([row("test-proof", "fail", "flagged", "No tests found: nothing here can be proven automatically yet")]).id, "first-test");
});

test("fix offer: personal data, offline and screen-only tests are never offered", () => {
  assert.equal(
    pickFix([
      row("personal", "fail", "flagged", "forms collect contact details"),
      row("offline", "fail", "flagged", "no service worker"),
      row("test-proof", "fail", "flagged", "1 test file to look at", ["a.test.js: 1 test, only checks what is on screen"]),
    ]),
    null,
  );
});

test("share summary: what was found, fixed and proved, with no values", () => {
  const fix = pickFix([row("secrets", "fail", "proven", "", ["src/otp.ts:34  assigned secret"])]);
  const text = fixSummary({
    project: "demo",
    fix,
    run: { results: [{ ...row("secrets", "pass", "proven", ""), title: "Secrets in code" }, { ...row("build", "na", "proven", ""), title: "Builds" }] },
    approval: { approvedBy: "Sibusiso" },
    diffStat: "2 files changed, 6 insertions(+), 1 deletion(-)",
  });
  assert.match(text, /Found: A credential is written in the code at src\/otp\.ts:34/);
  assert.match(text, /approved by Sibusiso/);
  assert.match(text, /Proved by: secrets in code/);
  assert.match(text, /Not checked: builds/);
});

test("build: writes the plan and tasks first, uses the spec title, records where it started", async (t) => {
  const root = project(t);
  await specCommand(root, { quiet: true }, ["booking form"]);
  await specCommand(root, { approve: true, by: "Sibusiso", quiet: true }, []);

  assert.equal(build(root, {}), 0);
  const name = readConfig(root).spec.active;
  assert.ok(existsSync(join(root, "specs", name, "plan.md")));
  assert.ok(existsSync(join(root, "specs", name, "tasks.md")));
  assert.equal(readFileSync(join(root, ".factory", "idea.txt"), "utf8").trim(), "Booking form");
  assert.match(readState(root).buildBase ?? "", /^[0-9a-f]{40}$/);
  assert.ok(existsSync(join(root, "specs", name, "evidence", "changes.txt")));
  assert.ok(existsSync(join(root, "specs", name, "evidence", "verify-latest.md")));
});

test("build: deleting tests is a proven failure, sent back like any other", async (t) => {
  const root = project(t, { tests: 2 });
  await specCommand(root, { quiet: true }, ["booking form"]);
  await specCommand(root, { approve: true, by: "Sibusiso", quiet: true }, []);

  process.env.FAKE_DELETE = join(root, "src", "t1.test.js");
  t.after(() => delete process.env.FAKE_DELETE);
  assert.equal(build(root, { attempts: 1 }), 1);
  assert.equal(readState(root).lastBuild, undefined);
});

test("approve: the name saved in the config is used, and nobody is asked", async (t) => {
  const root = project(t);
  writeConfig(root, { ...readConfig(root), approvedBy: "Sibusiso" });
  await specCommand(root, { quiet: true }, ["booking form"]);
  await specCommand(root, { approve: true, quiet: true }, []);
  assert.equal(readApproval(root, readConfig(root).spec.active).approvedBy, "Sibusiso");
});

test("factory approve: needs a terminal to read the spec, or --yes to record it", async (t) => {
  const root = project(t);
  await specCommand(root, { quiet: true }, ["booking form"]);
  assert.equal(await approveCommand(root, {}, []), 1);
  assert.equal(await approveCommand(root, { yes: true, by: "Sibusiso" }, []), 0);
  assert.equal(readApproval(root, readConfig(root).spec.active).approvedBy, "Sibusiso");
});

test("templates: one constitution, so the repo and the tool cannot drift", (t) => {
  const repo = new URL("../../.specify/memory/constitution.md", import.meta.url);
  if (!existsSync(repo)) return t.skip("not inside the factory repository");
  const tool = new URL("../template/constitution.md", import.meta.url);
  assert.equal(readFileSync(tool, "utf8"), readFileSync(repo, "utf8"));
});

test("build: a job that needs its tests to pass is not done while they cannot run", async (t) => {
  const root = project(t);
  await specCommand(root, { quiet: true }, ["add the first test"]);
  await specCommand(root, { approve: true, by: "Sibusiso", quiet: true }, []);
  assert.equal(build(root, { attempts: 1, requires: ["tests"] }), 1);
  assert.equal(readState(root).lastBuild, undefined);
});

const SEND_BACK = APPROVE.replace(
  "|---|---|---|---|---|---|\n",
  "|---|---|---|---|---|---|\n| 1 | must fix | src/booking.js:4 | R5 | any account can read any booking | sign in as B, read A's booking |\n",
).replace("VERDICT: approve", "VERDICT: send back");

async function approvedProject(t) {
  const root = project(t);
  write(root, "src/booking.js", "export const book = () => 1;\n");
  await specCommand(root, { quiet: true }, ["booking form"]);
  await specCommand(root, { approve: true, by: "Sibusiso", quiet: true }, []);
  return root;
}

function withEnv(t, values) {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const key of Object.keys(values)) delete process.env[key];
  });
}

test("review: a separate session approves, and the build is done", async (t) => {
  const root = await approvedProject(t);
  assert.equal(build(root, { attempts: 1 }), 0);
  const review = readState(root).lastReview;
  assert.equal(review.passed, true);
  assert.match(review.summary, /approved by a separate session: 0 must fix, 0 should fix, acceptance checks 1 of 1 proven/);
  assert.ok(existsSync(join(root, review.file)));
});

test("review: a must-fix finding sends the work back, and the next attempt sees it", async (t) => {
  const root = await approvedProject(t);
  withEnv(t, { FAKE_REVIEW: SEND_BACK });
  assert.equal(build(root, { attempts: 2 }), 1);
  assert.equal(readState(root).lastBuild, undefined);
  const prompts = readdirSync(join(root, ".factory", "prompts")).filter((f) => f.startsWith("build-")).sort();
  const second = readFileSync(join(root, ".factory", "prompts", prompts.at(-1)), "utf8");
  assert.match(second, /Independent review/);
  assert.match(second, /src\/booking\.js:4 R5: any account can read any booking/);
});

test("review: no review written means not done", async (t) => {
  const root = await approvedProject(t);
  withEnv(t, { FAKE_REVIEW: "none" });
  assert.equal(build(root, { attempts: 1 }), 1);
  assert.match(readState(root).lastReview.summary, /wrote no review/);
});

test("review: a review that says approve but lists a FAIL is still sent back", async (t) => {
  const root = await approvedProject(t);
  withEnv(t, { FAKE_REVIEW: APPROVE.replace("| AC1 | PASS |", "| AC1 | FAIL |") });
  assert.equal(build(root, { attempts: 1 }), 1);
});

test("review: UNPROVEN alone does not send it back, and is reported for a person", async (t) => {
  const root = await approvedProject(t);
  withEnv(t, { FAKE_REVIEW: APPROVE.replace("| AC1 | PASS | the factory's npm test passed |", "| AC1 | UNPROVEN | needs git log over history |") });
  assert.equal(build(root, { attempts: 1 }), 0);
  const review = readState(root).lastReview;
  assert.match(review.summary, /0 of 1 proven, 1 for a person to check/);
  assert.match(review.unproven[0], /needs git log/);
});

test("review: a reviewer that changes code does not count", async (t) => {
  const root = await approvedProject(t);
  withEnv(t, { FAKE_REVIEWER_EDITS: join(root, "src", "booking.js") });
  assert.equal(build(root, { attempts: 1 }), 1);
  assert.match(readState(root).lastReview.summary, /changed files besides its review/);
});

test("review: the reviewer sees the change, the spec and the rules, never the builder's prompt", async (t) => {
  const root = await approvedProject(t);
  build(root, { attempts: 1 });
  const name = readdirSync(join(root, ".factory", "prompts")).find((f) => f.startsWith("review-"));
  const prompt = readFileSync(join(root, ".factory", "prompts", name), "utf8");
  assert.match(prompt, /You did not write this change/);
  assert.match(prompt, /R7 The same mistake elsewhere/);
  assert.match(prompt, /## Known traps/);
  assert.match(prompt, /src\/booking\.js/);
  assert.match(prompt, /What the factory's own checks found/);
  assert.doesNotMatch(prompt, /You are the engineering team/);
  assert.doesNotMatch(prompt, /## Builder/);
});

test("review: agent.review runs a different agent for the review", async (t) => {
  const root = await approvedProject(t);
  const config = readConfig(root);
  writeConfig(root, { ...config, agent: { ...config.agent, review: { command: "definitely-not-a-reviewer-xyz" } } });
  assert.equal(build(root, { attempts: 1 }), 1);
  assert.match(readState(root).lastReview?.summary ?? "", /No reviewer agent found: definitely-not-a-reviewer-xyz/);
});
