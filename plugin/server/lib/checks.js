import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readConfig } from "./config.js";
import { buildOutputDirs, detectStack } from "./detect.js";
import { isTestFile, plural, readText, rel, walk } from "./util.js";

// Shapes that are a credential wherever they appear.
const STRONG_SECRETS = [
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
];

const ASSIGNED_SECRET =
  /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']([^"']{8,})["']/i;
const CONNECTION_STRING =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/([^\s:@/]+):([^\s:@/]{4,})@([^\s/:?]+)/;

const PLACEHOLDER =
  /(process\.env|\$\{|\$[A-Z_]|\{[^}]*\}|<[^>]+>|your[_-]?|example|sample|changeme|placeholder|redacted|dummy|fake|mock|stub|demo|not[_-]?real|test[_-]?key|abcdefghijklmnopqrstuvwxyz|1234567890|xxxx|\*\*\*|\.\.\.)/i;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\[::1\])$/i;
const SOFT_PATH =
  /(?:^|[\\/])(?:tests?|__tests__|specs?|e2e|fixtures?|__fixtures__|__mocks__|mocks?|examples?|samples?|docs?|migrations?|seeds?)(?:[\\/]|$)/i;
const SOFT_NAME = /\.(?:md|mdx|txt|rst)$|(?:example|sample|template)/i;

const make = (status) => (id, title, kind, summary, details = [], evidence = []) => ({
  id,
  title,
  kind,
  status,
  summary,
  details,
  evidence,
});
const ok = make("pass");
const bad = make("fail");
const na = (id, title, kind, summary) => make("na")(id, title, kind, summary);
const notRun = (id, title, kind, summary, details = [], evidence = []) =>
  make("not-run")(id, title, kind, summary, details, evidence);


function isSoftFile(relPath) {
  return isTestFile(relPath) || SOFT_PATH.test(relPath) || SOFT_NAME.test(relPath.split(/[\\/]/).pop());
}

// Returns null (not a secret), "proven" or "maybe" for one line.
function classifyLine(line, relPath) {
  for (const pattern of STRONG_SECRETS) {
    if (pattern.re.test(line)) return { name: pattern.name, tier: "proven" };
  }

  const conn = line.match(CONNECTION_STRING);
  if (conn) {
    const [, user, password, host] = conn;
    if (!PLACEHOLDER.test(password)) {
      const local = LOCAL_HOST.test(host) || user === password;
      return {
        name: "connection string with a password",
        tier: local || isSoftFile(relPath) ? "maybe" : "proven",
      };
    }
  }

  const assigned = line.match(ASSIGNED_SECRET);
  if (assigned) {
    const value = assigned[1];
    if (/\s/.test(value) || PLACEHOLDER.test(value)) return null;
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("#")) return null;
    const weak = value.length < 12 || isSoftFile(relPath);
    return { name: "assigned secret", tier: weak ? "maybe" : "proven" };
  }
  return null;
}

function envProblem(root) {
  if (!existsSync(join(root, ".env"))) return null;
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ".env"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (tracked.status === 0) return { tier: "proven", text: ".env is tracked by git" };

  const check = spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: root, stdio: "ignore" });
  let ignored = check.status === 0;
  if (check.status !== 0 && check.status !== 1) {
    const ignore = readText(join(root, ".gitignore")) ?? "";
    ignored = ignore
      .split("\n")
      .map((line) => line.trim())
      .some((line) => [".env", ".env*", "*.env", "/.env", "/.env*"].includes(line));
  }
  return ignored ? null : { tier: "maybe", text: ".env exists and is not ignored by git" };
}

// Two rows, always both: real credentials (proven), and lines that look like test or
// dev passwords (a person decides). A false alarm is worse than a missed problem.
export function checkSecrets(root, { files } = {}) {
  const proven = [];
  const maybe = [];
  let scanned = 0;

  for (const file of files ?? walk(root)) {
    const text = readText(file);
    if (text == null) continue;
    scanned++;
    const where = rel(root, file);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("factory:allow-secret")) continue;
      const found = classifyLine(lines[i], where);
      if (!found) continue;
      (found.tier === "proven" ? proven : maybe).push(`${where}:${i + 1}  ${found.name}`);
    }
  }

  const env = envProblem(root);
  if (env?.tier === "proven") proven.push(env.text);
  if (env?.tier === "maybe") maybe.push(env.text);

  const secrets = proven.length
    ? bad(
        "secrets",
        "Secrets in code",
        "proven",
        proven.length === 1
          ? `1 credential: ${proven[0].split("  ")[0]}`
          : `${proven.length} credentials found`,
        proven.slice(0, 50),
      )
    : ok("secrets", "Secrets in code", "proven", `No credentials found in ${plural(scanned, "file")}`);

  const possible = maybe.length
    ? bad(
        "secrets-maybe",
        "Possible test passwords",
        "flagged",
        `${plural(maybe.length, "line")} in test and dev files; add factory:allow-secret on the line if it is fake`,
        maybe.slice(0, 50),
      )
    : ok("secrets-maybe", "Possible test passwords", "flagged", "None seen");

  return [secrets, possible];
}

const COULD_NOT_RUN =
  /command not found|is not recognized as an internal or external command|No module named pytest|ENOENT|not found: (?:yarn|pnpm|bun|npm|uv|poetry)/i;

export function runCommand(root, command, logName, { cwd = null, logDir = null, timeoutMinutes = 10 } = {}) {
  const dir = logDir ?? join(tmpdir(), "factory-logs");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, logName);
  const run = spawnSync(command, {
    cwd: cwd ? join(root, cwd) : root,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMinutes * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  writeFileSync(
    log,
    [`$ ${command}${cwd ? `   (in ${cwd})` : ""}`, "", run.stdout ?? "", run.stderr ?? "", `exit ${run.status ?? "timeout"}`].join("\n"),
  );
  const tail = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
  const couldNotRun = run.status === 127 || run.error?.code === "ENOENT" || (run.status !== 0 && COULD_NOT_RUN.test(text));
  const reason = couldNotRun
    ? (text.split("\n").find((line) => COULD_NOT_RUN.test(line)) ?? "").replace(/^.*?:\s*(?=No module|command not found)/, "").trim()
    : "";
  return {
    reason,
    status: run.status,
    timedOut: run.status == null,
    couldNotRun,
    log: logDir ? rel(root, log) : log,
    tail,
  };
}

function commandCheck(root, { deep, stack, config, logDir }, { id, title, command, logName }) {
  if (!command) return na(id, title, "proven", `No ${id === "tests" ? "test" : "build"} command found`);
  if (!deep) return notRun(id, title, "proven", "factory verify --deep runs it");

  const minutes = config?.checks?.timeoutMinutes ?? 10;
  const run = runCommand(root, command, logName, { cwd: stack.commandCwd, logDir, timeoutMinutes: minutes });
  const where = stack.commandCwd ? ` in ${stack.commandCwd}` : "";
  if (run.status === 0) return ok(id, title, "proven", `\`${command}\`${where} passed`, [], [run.log]);
  if (run.couldNotRun) {
    const why = run.reason ? ` (${run.reason.slice(0, 80)})` : "";
    return notRun(id, title, "proven", `\`${command}\` could not start here${why}; install what it needs, then run it again`, run.tail, [run.log]);
  }
  if (run.timedOut) {
    return notRun(id, title, "proven", `\`${command}\` did not finish within ${minutes} minutes; raise checks.timeoutMinutes`, run.tail, [run.log]);
  }
  return bad(id, title, "proven", `\`${command}\`${where} failed (exit ${run.status})`, run.tail, [run.log]);
}

export function checkTests(root, ctx) {
  return commandCheck(root, ctx, {
    id: "tests",
    title: "Tests run and pass",
    command: ctx.stack.testCommand,
    logName: "tests.log",
  });
}

export function checkBuild(root, ctx) {
  return commandCheck(root, ctx, {
    id: "build",
    title: "Builds",
    command: ctx.stack.buildCommand,
    logName: "build.log",
  });
}

const MATCHER = /\.(?:toBe|toEqual|toStrictEqual|toMatch|toContain|toHaveLength|toThrow|toHaveTextContent|toBeVisible|toContainText|toHaveText|toHaveBeenCalled|rejects|resolves)\b/g;
const SCREEN_MATCHER = /\.(?:toHaveTextContent|toBeVisible|toContainText|toHaveText)\b/g;
const BROWSER_TEST = /(?:^|[\\/])(?:e2e|playwright|cypress)[\\/]|\.e2e\.[cm]?[jt]sx?$/i;

export function checkTestQuality(root, { files } = {}) {
  const tests = (files ?? walk(root)).filter(isTestFile);
  if (!tests.length) {
    return bad("test-proof", "Tests prove something", "flagged", "No tests found: nothing here can be proven automatically yet");
  }

  const problems = [];
  let checked = 0;

  for (const file of tests) {
    const text = readText(file);
    if (!text) continue;
    checked++;

    const blocks =
      (text.match(/\b(?:it|test|specify)\s*\(/g) || []).length +
      (text.match(/\bdef test_\w+\s*\(/g) || []).length +
      (text.match(/\bfunc Test\w+\s*\(\s*\w+\s+\*testing\.T\s*\)/g) || []).length;
    if (!blocks) continue;

    const assertions =
      (text.match(/\bexpect\s*\(/g) || []).length +
      (text.match(/\bassert(?:\.\w+)?\s*\(|\bassert\s+/g) || []).length +
      (text.match(/\.assert\w+\s*\(/g) || []).length +
      (text.match(/\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\s*\(/g) || []).length +
      (text.match(/\.should\b/g) || []).length;

    const matchers = text.match(MATCHER) || [];
    const screen = text.match(SCREEN_MATCHER) || [];
    const skipped = (text.match(/\b(?:it|test|describe)\.(?:skip|todo)\s*\(/g) || []).length;
    const where = rel(root, file);

    if (!assertions) {
      problems.push(`${where}: ${plural(blocks, "test")}, no assertion`);
    } else if (screen.length && screen.length === matchers.length && !BROWSER_TEST.test(where)) {
      problems.push(`${where}: ${plural(blocks, "test")}, only checks what is on screen`);
    }
    if (skipped) problems.push(`${where}: ${skipped} skipped`);
  }

  if (!problems.length) {
    return ok(
      "test-proof",
      "Tests prove something",
      "flagged",
      `${plural(checked, "test file")}; none empty or screen-only`,
      ["A static read of the test files. It cannot tell whether the assertions check the right thing."],
    );
  }

  const shown = problems.slice(0, 8);
  if (problems.length > shown.length) shown.push(`...and ${problems.length - shown.length} more`);
  return bad("test-proof", "Tests prove something", "flagged", `${plural(problems.length, "test file")} to look at`, shown);
}

const kb = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export function checkWeight(root, { stack, config }) {
  if (stack.kind === "mobile") return na("weight", "Download weight", "proven", "Phone app: size is checked in the store build");
  if (stack.kind !== "web") return na("weight", "Download weight", "proven", "Not a website");

  const buildDirs = stack.buildDirs?.length ? stack.buildDirs : buildOutputDirs(root);
  if (!buildDirs.length) {
    return notRun("weight", "Download weight", "proven", "No production build yet; factory verify --deep builds it");
  }

  const files = [];
  for (const dirName of buildDirs) {
    for (const file of walk(join(root, dirName))) {
      if (!/\.(?:js|mjs|css|html)$/i.test(file)) continue;
      let raw;
      try {
        raw = readFileSync(file);
      } catch {
        continue;
      }
      files.push({ file: rel(root, file), gz: gzipSync(raw).length });
    }
  }

  if (!files.length) return na("weight", "Download weight", "proven", "Build output has no JS, CSS or HTML");

  files.sort((a, b) => b.gz - a.gz);
  const total = files.reduce((sum, file) => sum + file.gz, 0);
  const largest = files[0];
  const budget = config.checks.budgetKb * 1024;
  const maxFile = config.checks.maxFileKb * 1024;
  const over = total > budget || largest.gz > maxFile;

  const details = files.slice(0, 5).map((file) => `${file.file}  ${kb(file.gz)} (gzip)`);
  const summary = `${kb(total)} shipped across ${plural(files.length, "file")}; largest ${kb(largest.gz)}`;

  if (over) {
    const why = [];
    if (total > budget) why.push(`total over ${config.checks.budgetKb} KB`);
    if (largest.gz > maxFile) why.push(`one file over ${config.checks.maxFileKb} KB`);
    return bad("weight", "Download weight", "proven", `${summary} (${why.join(", ")})`, details);
  }
  return ok("weight", "Download weight", "proven", summary, details);
}

// Only for websites that claim offline support. Phone apps are checked on the device.
export function checkOffline(root, { kind, config, files } = {}) {
  if (kind === "mobile") return na("offline", "No connection", "flagged", "Phone apps are checked on the device");
  if (kind && kind !== "web") return na("offline", "No connection", "flagged", "Not a website");

  const manifest =
    existsSync(join(root, "public", "manifest.json")) || existsSync(join(root, "public", "manifest.webmanifest"));
  if (!manifest && !config?.checks?.offline) {
    return na("offline", "No connection", "flagged", "Offline support not claimed; set checks.offline to true to check it");
  }

  const all = files ?? walk(root);
  const workers = all.filter((file) => /(?:^|[/\\])(?:sw|service-worker|serviceworker)\.(?:js|ts|mjs)$/i.test(file));
  let registered = false;
  if (!workers.length) {
    for (const file of all) {
      const text = readText(file);
      if (text && /navigator\.serviceWorker\.register|serviceWorker\.register\s*\(/.test(text)) {
        registered = true;
        break;
      }
    }
  }

  if (!workers.length && !registered) {
    return bad(
      "offline",
      "No connection",
      "flagged",
      "The site has a web app manifest but no service worker; if the connection drops, it may not open",
      ["This is a prompt to look, not proof."],
    );
  }

  return ok("offline", "No connection", "flagged", "Offline support appears to exist; a browser run is still needed", [
    ...workers.map((file) => rel(root, file)),
    ...(registered ? ["service worker registration found in code"] : []),
    "Offline behaviour is not proven without running it in a browser.",
  ]);
}

const PERSONAL_RULES = [
  { id: "form", re: /<input[^>]+type=["'](?:email|password|tel)["']/i, why: "forms collect contact or login details" },
  {
    id: "identity",
    re: /\b(?:id[_-]?number|national[_-]?id|passport(?:[_-]?number|Number)|date[_-]?of[_-]?birth)\b/i,
    why: "identity fields",
  },
  { id: "analytics", re: /\b(?:gtag|googletagmanager|mixpanel|amplitude|posthog|hotjar|fbq)\s*\(/, why: "analytics calls" },
  {
    id: "logs",
    re: /console\.(?:log|info|debug)\([^)]*\b(?:email|password|phone|token|user)\b/i,
    why: "personal data may be written to logs",
  },
  {
    id: "device",
    re: /localStorage\.setItem\([^)]*\b(?:user|email|token|profile)\b/i,
    why: "personal data stored in the browser",
  },
];

export function checkPersonalData(root, { files } = {}) {
  const hits = new Map(PERSONAL_RULES.map((rule) => [rule.id, { rule, files: [], example: null }]));
  let privacy = false;
  let consent = false;
  let scanned = 0;

  for (const file of files ?? walk(root)) {
    if (file.endsWith(".md")) continue;
    const text = readText(file);
    if (text == null) continue;
    scanned++;

    if (/privacy\s*(?:policy|notice)?|popia|paia/i.test(text)) privacy = true;
    if (/\bconsent\b|i agree|accept (?:the )?terms|opt[_-]?in/i.test(text)) consent = true;

    const lines = text.split("\n");
    for (const rule of PERSONAL_RULES) {
      const index = lines.findIndex((line) => rule.re.test(line));
      if (index === -1) continue;
      const entry = hits.get(rule.id);
      entry.files.push(`${rel(root, file)}:${index + 1}`);
      if (!entry.example && rule.id === "identity") entry.example = lines[index].match(rule.re)[0];
    }
  }

  const found = [...hits.values()].filter((entry) => entry.files.length);
  if (!found.length) {
    return ok("personal", "Personal data", "flagged", `No personal-data signals found in ${plural(scanned, "file")}`);
  }

  const clauses = found
    .slice(0, 3)
    .map((entry) => `${entry.rule.why}${entry.example ? ` (${entry.example})` : ""} in ${plural(entry.files.length, "file")}`);
  if (!privacy) clauses.push("no privacy notice found");

  const details = [];
  for (const entry of found) {
    details.push(`${entry.rule.why}: ${entry.files.slice(0, 3).join(", ")}${entry.files.length > 3 ? `, and ${entry.files.length - 3} more` : ""}`);
  }
  if (!consent) details.push("No consent text found in the project files");
  details.push("A prompt to look, not proof of compliance.");

  return bad("personal", "Personal data", "flagged", clauses.join("; "), details);
}

// Decisions a human recorded on purpose. Checks named in factory.config.json's
// "accepted" list report the recorded decision instead of a warning: visible in every
// report, never silently hidden. The secrets check can never be accepted. An entry
// without a check, a reason or an owner is ignored, and a note says so.
export function acceptedRegister(config) {
  const entries = Array.isArray(config?.accepted) ? config.accepted : [];
  const valid = new Map();
  const notes = [];
  for (const entry of entries) {
    const check = String(entry?.check ?? "").trim();
    const reason = String(entry?.reason ?? "").trim();
    const owner = String(entry?.owner ?? "").trim();
    if (!check || !reason || !owner) {
      notes.push(`Accepted entry ignored (${check || "no check named"}): it needs check, reason and owner.`);
      continue;
    }
    if (check === "secrets") {
      notes.push("Accepted entry ignored: the secrets check cannot be accepted by design.");
      continue;
    }
    valid.set(check, { check, what: String(entry?.what ?? "").trim(), reason, owner, date: String(entry?.date ?? "").trim() });
  }
  return { valid, notes };
}

function applyAccepted(results, register) {
  if (!register.valid.size) return results;
  return results.map((result) => {
    const entry = register.valid.get(result.id);
    if (!entry || result.status === "na") return result;
    const who = [entry.owner, entry.date].filter(Boolean).join(", ");
    return {
      ...result,
      status: "accepted",
      summary: `skipped, by design: ${entry.reason} (${who})`,
      details: [
        ...(entry.what ? [`Accepted: ${entry.what}`] : []),
        "Recorded in factory.config.json under accepted; remove the entry to run this check again.",
        `Without the entry this check said: ${result.summary}`,
      ],
    };
  });
}

export function runChecks(root, { deep = false, config, stack, logDir = null } = {}) {
  const s = stack ?? detectStack(root);
  const cfg = config ?? readConfig(root);
  const files = walk(root);
  const ctx = { deep, stack: s, config: cfg, logDir, files };
  return applyAccepted(
    [
      ...checkSecrets(root, ctx),
      checkTestQuality(root, ctx),
      checkTests(root, ctx),
      checkBuild(root, ctx),
      checkWeight(root, ctx),
      checkPersonalData(root, ctx),
      checkOffline(root, { kind: s.kind, config: cfg, files }),
    ],
    acceptedRegister(cfg),
  );
}
