import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, planCommand, specCommand, tasksCommand } from "../lib/commands.js";
import { readConfig, readState, writeConfig } from "../lib/config.js";
import { activeSpec, nextSpecName, readApproval } from "../lib/spec.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-spec-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function setAgent(root, target, content) {
  const script = `
const fs = require("node:fs");
const path = require("node:path");
const file = ${JSON.stringify(target)};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, ${JSON.stringify(content)});
`;
  const config = readConfig(root);
  config.agent = { command: process.execPath, args: ["-e", script] };
  writeConfig(root, config);
}

function setMissingAgent(root) {
  const config = readConfig(root);
  config.agent = { command: "definitely-not-a-real-agent-xyz", args: ["-p", "{prompt}"] };
  writeConfig(root, config);
}

const SPEC = `# Feature Specification: Booking form

## The problem

People cannot book a slot without phoning.

## Acceptance checks

- [ ] After submit, the booking is in the database.
`;

const PLAN = `# Implementation Plan: Booking form

## Summary

Reuse the existing form component and insert one row.
`;

const TASKS = `# Tasks: Booking form

- [ ] T001 Add the booking form
  Proves: the row exists after submit.
  Files: src/booking.js
`;

test("spec: writes a spec, makes it active, and starts as a draft", async (t) => {
  const root = temp(t);
  const name = nextSpecName(root, "booking form");
  setAgent(root, `specs/${name}/spec.md`, SPEC);

  const code = await specCommand(root, {}, ["booking form"]);
  assert.equal(code, 0);

  assert.ok(existsSync(join(root, "specs", name, "spec.md")));
  assert.equal(readConfig(root).spec.active, name);
  assert.equal(activeSpec(root).state, "draft");
});

test("spec: approval records who and invalidates when the spec changes", async (t) => {
  const root = temp(t);
  const name = nextSpecName(root, "booking form");
  setAgent(root, `specs/${name}/spec.md`, SPEC);
  await specCommand(root, {}, ["booking form"]);

  const code = await specCommand(root, { approve: true, by: "Sibusiso" }, []);
  assert.equal(code, 0);
  assert.equal(activeSpec(root).state, "approved");
  assert.equal(readApproval(root, name).approvedBy, "Sibusiso");

  appendFileSync(join(root, "specs", name, "spec.md"), "\nAn edit after approval.\n");
  assert.equal(activeSpec(root).state, "stale");
});

test("plan: refuses a spec that is not approved", async (t) => {
  const root = temp(t);
  const name = nextSpecName(root, "booking form");
  setAgent(root, `specs/${name}/spec.md`, SPEC);
  await specCommand(root, {}, ["booking form"]);

  assert.equal(planCommand(root, {}), 1);
  assert.ok(!existsSync(join(root, "specs", name, "plan.md")));
});

test("plan and tasks: written in order, after approval", async (t) => {
  const root = temp(t);
  const name = nextSpecName(root, "booking form");
  setAgent(root, `specs/${name}/spec.md`, SPEC);
  await specCommand(root, {}, ["booking form"]);
  await specCommand(root, { approve: true, by: "Sibusiso" }, []);

  assert.equal(tasksCommand(root, {}), 1);

  setAgent(root, `specs/${name}/plan.md`, PLAN);
  assert.equal(planCommand(root, {}), 0);
  assert.match(readFileSync(join(root, "specs", name, "plan.md"), "utf8"), /Implementation Plan/);

  setAgent(root, `specs/${name}/tasks.md`, TASKS);
  assert.equal(tasksCommand(root, {}), 0);
  assert.match(readFileSync(join(root, "specs", name, "tasks.md"), "utf8"), /Proves:/);
});

test("build: refuses to start without an approved spec", async (t) => {
  const root = temp(t);
  writeFileSync(join(root, "app.js"), "1;\n");
  setMissingAgent(root);

  assert.equal(build(root, { idea: "add a form" }), 1);
});

test("build: an unapproved draft also stops it", async (t) => {
  const root = temp(t);
  const name = nextSpecName(root, "booking form");
  setAgent(root, `specs/${name}/spec.md`, SPEC);
  await specCommand(root, {}, ["booking form"]);
  setMissingAgent(root);

  assert.equal(build(root, { idea: "add a form" }), 1);
});

test("build: --hotfix is the recorded escape", async (t) => {
  const root = temp(t);
  writeFileSync(join(root, "app.js"), "1;\n");
  setMissingAgent(root);

  assert.equal(build(root, { idea: "fix a typo", hotfix: true }), 2);
  assert.ok(readState(root).lastHotfix);
});

test("build: an approved spec still needs an agent", async (t) => {
  const root = temp(t);
  const name = nextSpecName(root, "booking form");
  setAgent(root, `specs/${name}/spec.md`, SPEC);
  await specCommand(root, {}, ["booking form"]);
  await specCommand(root, { approve: true, by: "Sibusiso" }, []);
  setMissingAgent(root);

  assert.equal(build(root, { idea: "add a form" }), 2);
});
