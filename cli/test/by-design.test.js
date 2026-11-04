// The accepted register: a recorded human decision is shown instead of re-argued,
// nothing is silently hidden, and the secrets check can never be accepted.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { acceptedRegister, runChecks } from "../lib/checks.js";
import { runAgent } from "../lib/agent.js";
import { composeReviewPrompt } from "../lib/prompts.js";
import { formatResults, label, renderEvidence, verify } from "../lib/verify.js";

const FAKE_KEY = ["sk", "R7kQ2mX9pL4vT8nB3wZ6cF1hJ5sD0aG"].join("-");

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-bydesign-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function personalProject(t) {
  const root = temp(t);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop" }));
  writeFileSync(join(root, "signup.js"), "const field = 'date_of_birth';\n");
  return root;
}

const ENTRY = { check: "personal", what: "date of birth on sign-up", reason: "age gate required by the category", owner: "Sibusiso", date: "2026-11-04" };

test("by design: a valid entry turns the check into a visible decision, not a failure", (t) => {
  const root = personalProject(t);
  const config = { name: "shop", checks: {}, accepted: [ENTRY] };
  const results = runChecks(root, { config });
  const personal = results.find((r) => r.id === "personal");
  assert.equal(personal.status, "accepted");
  assert.equal(label(personal), "BY DESIGN");
  assert.match(personal.summary, /skipped, by design: age gate required by the category \(Sibusiso, 2026-11-04\)/);
  assert.ok(personal.details.some((d) => d.includes("Without the entry this check said")), "the original finding stays visible");
  const run = { project: "shop", at: new Date().toISOString(), deep: false, ok: true, results, notes: [] };
  assert.match(renderEvidence(root, run), /BY DESIGN/);
  assert.match(formatResults(root, run), /BY DESIGN/);
});

test("by design: the secrets check can never be accepted", (t) => {
  const root = temp(t);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop" }));
  writeFileSync(join(root, "config.js"), `const key = "${FAKE_KEY}";\n`); // factory:allow-secret only in this test source, not the scanned file
  const config = { name: "shop", checks: {}, accepted: [{ check: "secrets", what: "", reason: "we know", owner: "Someone", date: "2026-11-04" }] };
  const results = runChecks(root, { config });
  const secrets = results.find((r) => r.id === "secrets");
  assert.equal(secrets.status, "fail", "the secret is still a failure");
  const { notes } = acceptedRegister(config);
  assert.ok(notes.some((n) => n.includes("secrets check cannot be accepted")), "the refusal is said in one line");
});

test("by design: an entry without reason or owner is ignored, named, and never crashes", (t) => {
  const root = personalProject(t);
  const config = { name: "shop", checks: {}, accepted: [{ check: "personal", owner: "Sibusiso" }, "not even an object"] };
  const results = runChecks(root, { config });
  assert.equal(results.find((r) => r.id === "personal").status, "fail", "the check behaves as if unlisted");
  const { notes } = acceptedRegister(config);
  assert.equal(notes.length, 2);
  assert.ok(notes.some((n) => n.includes("personal") && n.includes("reason and owner")));
});

test("by design: no accepted key means nothing changes", (t) => {
  const root = personalProject(t);
  const plain = runChecks(root, { config: { name: "shop", checks: {} } });
  assert.ok(plain.every((r) => r.status !== "accepted"));
  assert.deepEqual(acceptedRegister({}).notes, []);
});

test("by design: verify records the register notes in the saved run", (t) => {
  const root = personalProject(t);
  spawnSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "factory.config.json"), JSON.stringify({ name: "shop", kind: "script", checks: {}, accepted: [{ check: "personal" }] }));
  const run = verify(root, { deep: false });
  assert.equal(run.notes.length, 1);
  const saved = JSON.parse(readFileSync(run.jsonFile, "utf8"));
  assert.equal(saved.notes.length, 1);
});

test("by design: the reviewer is told the decision, not handed a warning to re-raise", () => {
  const run = { results: [{ id: "personal", title: "Personal data", kind: "flagged", status: "accepted", summary: "skipped, by design: age gate (Sibusiso, 2026-11-04)", details: [], evidence: [] }] };
  const prompt = composeReviewPrompt(process.cwd(), { name: "shop" }, { artifacts: null, change: { text: "diff", files: [], stat: "" }, reviewFile: "r.md", run });
  assert.match(prompt, /Personal data: BY DESIGN\. skipped, by design: age gate \(Sibusiso, 2026-11-04\)/);
});

test("by design: an agent run is stopped at the cap and reported as not finished", (t) => {
  const root = temp(t);
  const lines = [];
  const saved = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  t.after(() => {
    console.error = saved;
  });
  const config = { agent: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"] }, checks: { agentMinutes: 0.02 } };
  const run = runAgent(root, "job", config);
  assert.equal(run.ok, false, "a capped run never counts as success");
  assert.equal(run.capped, true, "the caller is told it was the cap, so the step fails too");
  assert.ok(lines.some((l) => l.includes("stopped at the 0.02 minute cap")), "the cap is said out loud");
});

test("by design: the constitution template carries the register rule", () => {
  const text = readFileSync(new URL("../template/constitution.md", import.meta.url), "utf8");
  assert.match(text, /Accepted, by design/);
  assert.match(text, /secrets[\s\S]{0,40}never be accepted/i);
});
