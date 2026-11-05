// Spec 006: a factory job costs fewer tokens. Small jobs get the short route, each stage
// gets only its rules, nothing already sent is sent again, and the prove loop stops itself.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep every write away from the real home folder.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "factory-token-home-"));

const { exceedsSmall, requestLane, MAX_SMALL_FILES } = await import("../lib/lane.js");
const { composeBuildPrompt, composeReviewPrompt, composeSpecPrompt } = await import("../lib/prompts.js");
const { defaultConfig, readConfig, readState, writeState } = await import("../lib/config.js");
const { approve, setActive } = await import("../lib/spec.js");
const { jobs, upgradeIfGrown } = await import("../lib/mcp.js");

const FAKE_KEY = ["sk", "R7kQ2mX9pL4vT8nB3wZ6cF1hJ5sD0aG"].join("-"); // factory:allow-secret

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-token-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const config = (root) => ({ ...defaultConfig(root), name: "shop" });

// AC1: a small request gets the quick lane and the short spec instructions.
test("small route: the person's words pick the lane, sensitive subjects never qualify", () => {
  assert.equal(requestLane("fix a typo in the readme"), "quick");
  assert.equal(requestLane("rename the Save label"), "quick");
  assert.equal(requestLane("add a booking page with a calendar"), "full");
  assert.equal(requestLane("fix a typo in the password reset email"), "full");
  assert.equal(requestLane("quick fix to the payment total"), "full");
  assert.equal(requestLane(""), "full");
});

test("small route: the quick lane shortens the spec prompt, the full lane does not", (t) => {
  const root = temp(t);
  const quick = composeSpecPrompt(root, config(root), "fix a typo", "specs/001-x/spec.md", { lane: "quick" });
  const full = composeSpecPrompt(root, config(root), "add a page", "specs/001-x/spec.md", {});
  assert.ok(quick.includes("This is a small fix"));
  assert.ok(!full.includes("This is a small fix"));
  for (const heading of ["## Scenarios", "## Expected baseline", "## Who else sees it", "## States"]) {
    assert.ok(!quick.includes(heading), `the quick lane does not ship ${heading}`);
    assert.ok(full.includes(heading), `the full lane keeps ${heading}`);
  }
  assert.ok(quick.length < full.length, "the quick prompt is shorter, never longer");
});

// AC2: text the session already holds is referenced by path, never pasted again.
test("never resend: the build prompt points at a spec the session already has", (t) => {
  const root = temp(t);
  const artifacts = { name: "001-x", spec: "A VERY RECOGNISABLE SPEC BODY", plan: "", tasks: "" };
  const fresh = composeBuildPrompt(root, config(root), "", [], artifacts);
  const repeat = composeBuildPrompt(root, config(root), "", [], artifacts, { alreadySent: true });
  assert.ok(fresh.includes("A VERY RECOGNISABLE SPEC BODY"), "a fresh session gets the full text");
  assert.ok(!repeat.includes("A VERY RECOGNISABLE SPEC BODY"), "the same session never gets it twice");
  assert.ok(repeat.includes("specs/001-x/spec.md"));
  assert.ok(repeat.includes("You already have this"));
});

// AC3: each stage carries only its own constitution sections.
test("stage rules: build and review each get their own sections, nobody re-reads the whole file", (t) => {
  const root = temp(t);
  const build = composeBuildPrompt(root, config(root), "a job", [], null);
  assert.ok(build.includes("Known traps"), "build gets the traps");
  assert.ok(!build.includes("## Release gate"), "build does not get the review's gate");
  assert.ok(!build.includes(".factory/constitution.md (the rules)"), "build is not told to read the whole file");
  const review = composeReviewPrompt(root, config(root), {
    artifacts: null,
    change: { text: "diff", files: [], stat: "" },
    reviewFile: "review.md",
    run: null,
  });
  assert.ok(review.includes("Release gate"), "review gets the gate");
  assert.ok(review.includes("Launch Readiness"), "review gets launch readiness");
  assert.ok(!build.includes("Launch Readiness"), "build does not");
  const spec = composeSpecPrompt(root, config(root), "a job", "specs/001-x/spec.md", {});
  assert.match(spec, /Read only the "Core Principles" section/);
});

// AC4: the prove loop stops itself after 3 failed rounds.
test("prove loop: the third failed round stops the loop, and it stays stopped", async (t) => {
  const root = temp(t);
  writeFileSync(join(root, "app.js"), `const key = "${FAKE_KEY}";\n`); // factory:allow-secret
  const name = "001-leak";
  mkdirSync(join(root, "specs", name), { recursive: true });
  writeFileSync(join(root, "specs", name, "spec.md"), "# Leak\n\nA spec.\n");
  setActive(root, name);
  approve(root, name, "Tester");
  writeState(root, { notDone: 2 });

  const third = await jobs.factory_prove({ root, client: "test" });
  assert.match(third.content[0].text, /STOPPED: the checks failed 3 rounds in a row/);
  assert.equal(readState(root).notDone, 3);
  assert.ok(existsSync(join(root, ".factory", "evidence", `${name}-stopped.md`)), "the stop is on the record in the evidence");

  const fourth = await jobs.factory_prove({ root, client: "test" });
  assert.match(fourth.content[0].text, /STOPPED/);
  assert.equal(readState(root).notDone, 3, "a stopped loop does not keep counting");
});

// AC5: checks get 3 minutes by default, and the project can still raise it.
test("timeout: the default is 3 minutes and factory.config.json still overrides it", (t) => {
  const root = temp(t);
  assert.equal(defaultConfig(root).checks.timeoutMinutes, 3);
  writeFileSync(join(root, "factory.config.json"), JSON.stringify({ name: "shop", checks: { timeoutMinutes: 7 } }));
  assert.equal(readConfig(root).checks.timeoutMinutes, 7);
});

// AC6: a small job that grew is upgraded, on the record.
test("small route: a job that outgrows the limits is upgraded and the evidence says so", (t) => {
  assert.equal(exceedsSmall(["a.js"]), false);
  assert.equal(exceedsSmall(["a.js", "b.js"]), false);
  assert.equal(exceedsSmall(["a.js", "b.js", "c.js"]), true, `more than ${MAX_SMALL_FILES} files is not small`);
  assert.equal(exceedsSmall(["a.js", "package.json"]), true, "touching a dependency file is not small");

  const root = temp(t);
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=T", ...args], { cwd: root, encoding: "utf8" });
  git("init");
  writeFileSync(join(root, "a.js"), "1\n");
  git("add", ".");
  git("commit", "-m", "start");
  const head = git("rev-parse", "HEAD").stdout.trim();

  // The factory's own uncommitted records are not part of the change and never count.
  mkdirSync(join(root, ".factory", "evidence"), { recursive: true });
  writeFileSync(join(root, ".factory", "evidence", "note.md"), "evidence\n");
  mkdirSync(join(root, "specs", "001-x"), { recursive: true });
  writeFileSync(join(root, "specs", "001-x", "spec.md"), "# Spec\n");
  writeFileSync(join(root, "a.js"), "2\n");
  assert.equal(upgradeIfGrown(root, { lane: "quick", buildBase: head }, "001-x"), null, "one code file plus the factory's own records stays small");

  for (const file of ["b.js", "c.js"]) writeFileSync(join(root, file), "2\n");
  const why = upgradeIfGrown(root, { lane: "quick", buildBase: head }, "001-x");
  assert.match(String(why), /3 files changed/);
  assert.equal(readState(root).lane, "full");
  assert.ok(existsSync(join(root, ".factory", "evidence", "001-x-upgraded.md")));

  const calm = upgradeIfGrown(root, { lane: "quick", buildBase: head }, "001-x");
  assert.match(String(calm), /files changed/, "still over the limit, still reported");
  assert.equal(upgradeIfGrown(root, { lane: "full", buildBase: head }, "001-x"), null, "a full job is never re-checked");
});
