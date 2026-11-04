import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ignoreFactory, init, lessonNew, report } from "../lib/commands.js";
import { checkSecrets } from "../lib/checks.js";
import { readConfig } from "../lib/config.js";
import { verify } from "../lib/verify.js";

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "factory-cmd-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("init: writes config, rules and roles", async (t) => {
  const root = temp(t);
  const code = await init(root, {
    yes: true,
    name: "Demo",
    kind: "web",
    who: "client, funder",
    data: "yes",
  });
  assert.equal(code, 0);

  const config = readConfig(root);
  assert.equal(config.name, "Demo");
  assert.equal(config.kind, "web");
  assert.deepEqual(config.whoDepends, ["client", "funder"]);
  assert.equal(config.personalData, "yes");

  assert.ok(existsSync(join(root, "factory.config.json")));
  assert.ok(existsSync(join(root, ".factory", "constitution.md")));
  const constitution = readFileSync(join(root, ".factory", "constitution.md"), "utf8");
  assert.ok(constitution.length > 5000);
  assert.match(constitution, /Known traps/);
  assert.match(constitution, /Build the least that works/);
  assert.equal(readdirSync(join(root, ".factory", "roles")).length, 5);
  assert.ok(existsSync(join(root, ".factory", "templates", "spec.md")));
  assert.match(readFileSync(join(root, ".factory", "templates", "spec.md"), "utf8"), /## Acceptance checks/);
  assert.ok(!existsSync(join(root, "lessons")), "init must not add a lessons folder to the project");
});

test("lesson new: writes a dated lesson and adds the legal note", async (t) => {
  const root = temp(t);
  const code = await lessonNew(root, {
    title: "Saved but not saved",
    what: "The toast said saved and nothing was written.",
    check: "Reload and query the record.",
    example: "A booking form in a client app.",
    sa: "yes",
  });
  assert.equal(code, 0);

  const files = readdirSync(join(root, "lessons")).filter((file) => file !== "_template.md");
  assert.equal(files.length, 1);
  assert.ok(existsSync(join(root, "lessons", "_template.md")), "the template arrives with the first lesson");
  const text = readFileSync(join(root, "lessons", files[0]), "utf8");
  assert.match(text, /Saved but not saved/);
  assert.match(text, /Not legal advice/);
  assert.match(text, /Date: \d{4}-\d{2}-\d{2}/);
});

test("lesson new: refuses an empty lesson", async (t) => {
  const root = temp(t);
  const code = await lessonNew(root, { yes: true });
  assert.equal(code, 1);
});

test("report: needs a verification first", async (t) => {
  const root = temp(t);
  const code = await report(root, {});
  assert.equal(code, 1);
});

test("report: writes a handover with the limits stated", async (t) => {
  const root = temp(t);
  writeFileSync(join(root, "app.js"), "1;\n");
  const run = verify(root, { deep: false });
  assert.ok(run.jsonFile);

  const out = join(root, "handover.md");
  const code = await report(root, { out });
  assert.equal(code, 0);
  const text = readFileSync(out, "utf8");
  assert.match(text, /What this does not prove/);
  assert.match(text, /POPIA/);
  assert.match(text, /factory verify --deep/);
});

test("ignore: a fresh project hides machine state only", (t) => {
  const root = temp(t);
  mkdirSync(join(root, ".git"), { recursive: true });
  assert.equal(ignoreFactory(root), "created");
  const text = readFileSync(join(root, ".gitignore"), "utf8");
  for (const line of [".factory/state.json", ".factory/last-verify.json", ".factory/prompts/", ".factory/idea.txt"]) {
    assert.ok(text.includes(line), line);
  }
  assert.match(text, /committed and shared/);
  assert.ok(!/^\.factory\/?$/m.test(text));
});

test("ignore: the old block is replaced once, then left alone", (t) => {
  const root = temp(t);
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n\n# Software Factory\n.factory/\n");
  assert.equal(ignoreFactory(root), "migrated");
  const once = readFileSync(join(root, ".gitignore"), "utf8");
  assert.ok(once.startsWith("node_modules/\n"));
  assert.ok(once.includes(".factory/state.json"));
  assert.ok(!/^\.factory\/$/m.test(once));
  assert.equal(ignoreFactory(root), "unchanged");
  assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), once);
});

test("ignore: a bare .factory/ line is replaced and nothing else moves", (t) => {
  const root = temp(t);
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "dist/\n.factory/\n.env\n");
  assert.equal(ignoreFactory(root), "migrated");
  const text = readFileSync(join(root, ".gitignore"), "utf8");
  assert.ok(text.startsWith("dist/\n"));
  assert.ok(text.endsWith(".env\n"));
  assert.ok(text.includes(".factory/idea.txt"));
  assert.ok(!/^\.factory\/$/m.test(text));
});

test("ignore: outside a git repository nothing is written", (t) => {
  const root = temp(t);
  assert.equal(ignoreFactory(root), "unchanged");
  assert.ok(!existsSync(join(root, ".gitignore")));
});

test("constitution: lessons live in lessons/ and are committed", () => {
  const text = readFileSync(new URL("../template/constitution.md", import.meta.url), "utf8");
  const nine = text.split("### IX.")[1].split("### X.")[0];
  assert.match(nine, /lessons\//);
  assert.match(nine, /committed/);
});

test("secrets check names the place and the kind, never the value", (t) => {
  const root = temp(t);
  const fake = ["sk_live_", "a1b2c3d4e5f6g7h8i9j0k1l2"].join(""); // factory:allow-secret
  writeFileSync(join(root, "config.js"), `const key = "${fake}";\n`);
  const results = checkSecrets(root, { files: [join(root, "config.js")] });
  const text = JSON.stringify(results);
  assert.ok(text.includes("config.js:1"));
  assert.ok(text.includes("Stripe live key"));
  assert.ok(!text.includes(fake));
});

test("ignore: a Windows-style .gitignore is still migrated", (t) => {
  const root = temp(t);
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "dist/\r\n# Software Factory\r\n.factory/\r\n");
  assert.equal(ignoreFactory(root), "migrated");
  const text = readFileSync(join(root, ".gitignore"), "utf8");
  assert.ok(text.startsWith("dist/\r\n"));
  assert.ok(text.includes(".factory/state.json"));
  assert.ok(!/^\.factory\/\r?$/m.test(text));
});
