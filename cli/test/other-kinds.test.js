// Non-web projects get a flow that fits: the spec prompt asks only for states that
// exist on the stack, and verify says plainly what it cannot check there.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasScreens } from "../lib/detect.js";
import { composeSpecPrompt, projectKind } from "../lib/prompts.js";
import { formatResults, renderEvidence, verify } from "../lib/verify.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-kinds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const projects = {
  web: (root) => writeFileSync(join(root, "index.html"), "<!doctype html>"),
  api: (root) => writeFileSync(join(root, "go.mod"), "module shop\n"),
  cli: (root) => writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tool", bin: { tool: "bin.js" } })),
  script: (root) => writeFileSync(join(root, "package.json"), JSON.stringify({ name: "job" })),
  other: () => {},
};

const SCREEN_ROWS = ["| Dark mode |", "| Small screen |", "| Screen reader |", "| Back or cancel |"];
const REDUCED_ROWS = ["| Loading or feedback |", "| Empty input |", "| Error |", "| Run twice |", "| No permission |"];

function promptFor(t, kind) {
  const root = temp(t);
  projects[kind](root);
  return composeSpecPrompt(root, { name: "shop", kind: "other" }, "a job", "specs/001-a-job/spec.md", {});
}

test("other kinds: the spec prompt holds only the states that exist on the stack", (t) => {
  for (const kind of ["api", "cli", "script", "other"]) {
    const prompt = promptFor(t, kind);
    for (const row of REDUCED_ROWS) assert.ok(prompt.includes(row), `${kind} asks for ${row}`);
    for (const row of SCREEN_ROWS) assert.ok(!prompt.includes(row), `${kind} does not ask for ${row}`);
    assert.match(prompt, /do not apply to this stack/);
  }
});

test("other kinds: web keeps the full states table, unchanged", (t) => {
  const prompt = promptFor(t, "web");
  for (const row of SCREEN_ROWS) assert.ok(prompt.includes(row), `web asks for ${row}`);
  assert.ok(!prompt.includes("| Run twice |"));
  const template = readFileSync(new URL("../template/spec.md", import.meta.url), "utf8");
  const states = template.slice(template.indexOf("## States"), template.indexOf("## Expected baseline"));
  assert.ok(prompt.includes(states.trim()), "the template's states block is in the prompt byte for byte");
});

test("other kinds: verify names what it cannot check on a stack without screens", (t) => {
  const root = temp(t);
  projects.other(root);
  const run = verify(root, { save: false, config: { name: "shop", kind: "other", checks: {} } });
  assert.equal(run.cannotCheck.length, 3);
  const evidence = renderEvidence(root, run);
  assert.match(evidence, /## On this stack the factory cannot check/);
  assert.match(evidence, /dark mode, small screens and screen readers/);
  assert.match(formatResults(root, run), /On this stack the factory cannot check/);
});

test("other kinds: verify on a website carries no cannot-check block", (t) => {
  const root = temp(t);
  projects.web(root);
  const run = verify(root, { save: false, config: { name: "shop", kind: "web", checks: { budgetKb: 1500, maxFileKb: 700 } } });
  assert.deepEqual(run.cannotCheck, []);
  assert.ok(!renderEvidence(root, run).includes("On this stack the factory cannot check"));
});

test("other kinds: the universal checks still run for kind other", (t) => {
  const root = temp(t);
  const run = verify(root, { save: false, config: { name: "shop", kind: "other", checks: {} } });
  for (const id of ["secrets", "secrets-maybe", "test-proof", "tests", "build", "personal"]) {
    assert.ok(run.results.some((r) => r.id === id), `${id} is present`);
  }
});

test("other kinds: the person's config kind still overrides a detection of other", (t) => {
  const root = temp(t);
  assert.equal(projectKind(root, { kind: "api" }), "api");
  assert.equal(projectKind(root, { kind: "other" }), "other");
  projects.web(root);
  assert.equal(projectKind(root, { kind: "api" }), "web", "detection wins when it knows better");
});

test("other kinds: the constitution scopes the states table to work with a screen", () => {
  const text = readFileSync(new URL("../template/constitution.md", import.meta.url), "utf8");
  assert.match(text, /applies\n?.{0,20}to work with a screen/s);
  assert.match(text, /Never claim a state, or a check, that does not exist on\nthe stack/);
  assert.equal(hasScreens("web") && hasScreens("mobile") && !hasScreens("other") && !hasScreens("api") && !hasScreens("script") && !hasScreens("cli"), true);
});
