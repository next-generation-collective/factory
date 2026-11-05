import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkBuild,
  checkOffline,
  checkPersonalData,
  checkSecrets,
  checkTests,
  checkTestQuality,
  checkWeight,
  runChecks,
} from "../lib/checks.js";
import { defaultConfig } from "../lib/config.js";
import { detectStack } from "../lib/detect.js";

const FAKE_KEY = ["sk", "R7kQ2mX9pL4vT8nB3wZ6cF1hJ5sD0aG"].join("-");
const BASE32 = ["KVKFKRCPNZQU", "YMLXOVYDSQKJKZDTSRLD"].join("");

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, file, text) {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

const secrets = (root) => {
  const [proven, maybe] = checkSecrets(root);
  return { proven, maybe };
};

test("secrets: a real key shape fails anywhere, even in a test", (t) => {
  const root = temp(t);
  write(root, "test/config.test.js", `const key = "${FAKE_KEY}";\n`);
  const { proven } = secrets(root);
  assert.equal(proven.status, "fail");
  assert.equal(proven.kind, "proven");
  assert.match(proven.summary, /test\/config\.test\.js:1/);
});

test("secrets: clean project passes both rows", (t) => {
  const root = temp(t);
  write(root, "app.js", 'const greeting = "hello";\n');
  const { proven, maybe } = secrets(root);
  assert.equal(proven.status, "pass");
  assert.equal(maybe.status, "pass");
  assert.equal(maybe.kind, "flagged");
});

test("secrets: a hard-coded secret in source code fails (the login-code case)", (t) => {
  const root = temp(t);
  write(root, "src/services/otp/index.ts", `const secret = '${BASE32}';\n`);
  const { proven, maybe } = secrets(root);
  assert.equal(proven.status, "fail");
  assert.match(proven.summary, /1 credential: src\/services\/otp\/index\.ts:1/);
  assert.equal(maybe.status, "pass");
});

test("secrets: a local dev database string is a possible test password, not a failure", (t) => {
  const root = temp(t);
  write(root, "drizzle.config.ts", 'url: env ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres",\n'); // factory:allow-secret
  const { proven, maybe } = secrets(root);
  assert.equal(proven.status, "pass");
  assert.equal(maybe.status, "fail");
  assert.match(maybe.details.join("\n"), /drizzle\.config\.ts:1/);
});

test("secrets: a fake value in a test file is a possible test password", (t) => {
  const root = temp(t);
  write(root, "tests/test_config.py", 'secret = "super-secret-key-12345"\n'); // factory:allow-secret
  const { proven, maybe } = secrets(root);
  assert.equal(proven.status, "pass");
  assert.equal(maybe.status, "fail");
});

test("secrets: mock tokens, template strings and prose are not secrets", (t) => {
  const root = temp(t);
  write(root, "src/a.ts", 'const accessToken = "mock-access-token";\n');
  write(root, "src/b.py", 'if "auth_token=" in value and "ct0=" in value:\n');
  write(root, "src/c.py", "line = f'AUTH_TOKEN=\"{auth_token}\"'\n");
  const { proven, maybe } = secrets(root);
  assert.equal(proven.status, "pass");
  assert.equal(maybe.status, "pass", maybe.details.join("\n"));
});

test("secrets: factory:allow-secret on the line is honoured", (t) => {
  const root = temp(t);
  write(root, "src/a.ts", `const secret = '${BASE32}'; // factory:allow-secret\n`);
  assert.equal(secrets(root).proven.status, "pass");
});

test("secrets: a .env that is not ignored is flagged for a person", (t) => {
  const root = temp(t);
  write(root, ".env", "TOKEN=abc\n");
  const { proven, maybe } = secrets(root);
  assert.equal(proven.status, "pass");
  assert.equal(maybe.status, "fail");
  assert.match(maybe.details.join("\n"), /\.env exists and is not ignored/);
});

test("secrets: a .env tracked by git fails", (t) => {
  const root = temp(t);
  const git = (...args) => spawnSync("git", args, { cwd: root, stdio: "ignore" });
  if (git("init", "-q").status !== 0) return t.skip("git not available");
  write(root, ".env", "TOKEN=abc\n");
  git("add", ".env");
  const { proven } = secrets(root);
  assert.equal(proven.status, "fail");
  assert.match(proven.details.join("\n"), /\.env is tracked by git/);
});

test("tests: not run in the fast pass", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", scripts: { test: 'node -e "0"' } }));
  const result = checkTests(root, { deep: false, stack: detectStack(root) });
  assert.equal(result.status, "not-run");
});

test("tests: a passing command passes, with its log", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", scripts: { test: 'node -e "console.log(1)"' } }));
  const result = checkTests(root, { deep: true, stack: detectStack(root) });
  assert.equal(result.status, "pass");
  assert.equal(result.evidence.length, 1);
});

test("tests: a command that cannot start is not run, never a failure", (t) => {
  const root = temp(t);
  const stack = { ...detectStack(root), testCommand: "definitely-not-a-real-runner-xyz --quiet" };
  const result = checkTests(root, { deep: true, stack });
  assert.equal(result.status, "not-run");
  assert.match(result.summary, /could not start/);
});

test("tests: logs go to the temp folder when nothing may be written", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", scripts: { test: 'node -e "0"' } }));
  checkTests(root, { deep: true, stack: detectStack(root), logDir: null });
  assert.ok(!existsSync(join(root, ".factory")));
});

test("tests: no test command is not applicable", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  const result = checkTests(root, { deep: true, stack: detectStack(root) });
  assert.equal(result.status, "na");
});

test("build: a failing build fails", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", scripts: { build: 'node -e "process.exit(1)"' } }));
  const result = checkBuild(root, { deep: true, stack: detectStack(root) });
  assert.equal(result.status, "fail");
});

test("weight: over budget fails, with the largest files listed", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", dependencies: { next: "15" } }));
  write(root, "dist/app.js", randomBytes(400 * 1024));
  const config = defaultConfig(root);
  config.checks.budgetKb = 10;
  const result = checkWeight(root, { stack: detectStack(root), config });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /largest/);
  assert.ok(result.details.length > 0);
});

test("weight: no build output is not run", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", dependencies: { next: "15" } }));
  const result = checkWeight(root, { stack: detectStack(root), config: defaultConfig(root) });
  assert.equal(result.status, "not-run");
});

test("weight: not applicable to phone apps", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", dependencies: { expo: "54" } }));
  write(root, "dist/app.js", randomBytes(4000 * 1024));
  const result = checkWeight(root, { stack: detectStack(root), config: defaultConfig(root) });
  assert.equal(result.status, "na");
  assert.match(result.summary, /store build/);
});

test("weight: not applicable outside websites", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  const result = checkWeight(root, { stack: detectStack(root), config: defaultConfig(root) });
  assert.equal(result.status, "na");
});

test("offline: a website that does not claim offline support is not nagged", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  const result = checkOffline(root, { kind: "web", config: defaultConfig(root) });
  assert.equal(result.status, "na");
  assert.match(result.summary, /checks\.offline/);
});

test("offline: phone apps are checked on the device", (t) => {
  const root = temp(t);
  const result = checkOffline(root, { kind: "mobile", config: defaultConfig(root) });
  assert.equal(result.status, "na");
});

test("offline: a manifest without a service worker is flagged, not failed hard", (t) => {
  const root = temp(t);
  write(root, "public/manifest.json", "{}\n");
  const result = checkOffline(root, { kind: "web", config: defaultConfig(root) });
  assert.equal(result.status, "fail");
  assert.equal(result.kind, "flagged");
});

test("offline: a service worker is found when offline is claimed", (t) => {
  const root = temp(t);
  write(root, "public/sw.js", "self.addEventListener('fetch', () => {});\n");
  const config = defaultConfig(root);
  config.checks.offline = true;
  const result = checkOffline(root, { kind: "web", config });
  assert.equal(result.status, "pass");
});

const FORM = ["<input type=", '"email"', " />"].join("");

test("personal data: one summary line, grouped, never a wall of lines", (t) => {
  const root = temp(t);
  for (let i = 0; i < 30; i++) write(root, `src/form${i}.jsx`, `export const F = () => ${FORM};\n`);
  write(root, "db/schema.sql", "create table people (date_of_birth date);\n");
  const result = checkPersonalData(root);
  assert.equal(result.status, "fail");
  assert.equal(result.kind, "flagged");
  assert.match(result.summary, /forms collect contact or login details in 30 files/);
  assert.match(result.summary, /identity fields \(date_of_birth\) in 1 file/);
  assert.match(result.summary, /no privacy notice found/);
  assert.ok(result.details.length <= 5, result.details.join("\n"));
  assert.match(result.details.join("\n"), /and 27 more/);
  assert.match(result.details.join("\n"), /not proof of compliance/i);
});

test("personal data: nothing found passes as flagged", (t) => {
  const root = temp(t);
  write(root, "app.js", "export const add = (a, b) => a + b;\n");
  const result = checkPersonalData(root);
  assert.equal(result.status, "pass");
  assert.equal(result.kind, "flagged");
});

test("test quality: a test with no assertion is flagged, never failed", (t) => {
  const root = temp(t);
  write(root, "a.test.js", 'test("saves", () => {});\n');
  const result = checkTestQuality(root);
  assert.equal(result.status, "fail");
  assert.equal(result.kind, "flagged");
  assert.match(result.summary, /to look at/);
  assert.match(result.details.join("\n"), /no assertion/);
});

test("test quality: a screen-only assertion is flagged", (t) => {
  const root = temp(t);
  write(root, "a.test.js", 'test("saves", () => { expect(screen.getByText("Saved")).toBeVisible(); });\n');
  const result = checkTestQuality(root);
  assert.equal(result.status, "fail");
  assert.match(result.details.join("\n"), /only checks what is on screen/);
});

test("test quality: browser tests may check what is on screen", (t) => {
  const root = temp(t);
  write(root, "e2e/saves.spec.ts", 'test("saves", async () => { await expect(page.getByText("Saved")).toBeVisible(); });\n');
  assert.equal(checkTestQuality(root).status, "pass");
});

test("test quality: a real assertion passes as flagged", (t) => {
  const root = temp(t);
  write(root, "a.test.js", 'test("adds", () => { expect(add(1, 2)).toBe(3); });\n');
  const result = checkTestQuality(root);
  assert.equal(result.status, "pass");
  assert.equal(result.kind, "flagged");
});

test("test quality: no tests at all is said plainly", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  const result = checkTestQuality(root);
  assert.equal(result.status, "fail");
  assert.equal(result.kind, "flagged");
  assert.match(result.summary, /No tests found/);
});

test("runChecks: eight rows in a stable order", (t) => {
  const root = temp(t);
  write(root, "app.js", "1;\n");
  const results = runChecks(root, { deep: false });
  assert.deepEqual(
    results.map((result) => result.id),
    ["secrets", "secrets-maybe", "test-proof", "tests", "build", "weight", "personal", "offline"],
  );
});

test("weight: leftovers from next dev are not measured as a real build", (t) => {
  const root = temp(t);
  write(root, "package.json", JSON.stringify({ name: "x", dependencies: { next: "15" } }));
  write(root, ".next/static/chunks/main-app.js", randomBytes(2000 * 1024));
  const config = defaultConfig(root);
  assert.equal(checkWeight(root, { stack: detectStack(root), config }).status, "not-run");

  write(root, ".next/BUILD_ID", "abc\n");
  assert.equal(checkWeight(root, { stack: detectStack(root), config }).status, "fail");
});
