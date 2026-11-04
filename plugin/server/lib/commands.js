import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { analyseProject } from "./analyse.js";
import { approvalView, GUARDED_QUESTIONS, guardedTopics } from "./approval.js";
import { agentAvailable, agentVersion, detectAgent, runAgent, savePrompt } from "./agent.js";
import { normaliseAgent } from "./agents.js";
import { defaultConfig, ensure, paths, readConfig, readState, writeConfig, writeState } from "./config.js";
import { detectStack } from "./detect.js";
import { fixSummary, pickFix } from "./fixes.js";
import { askList, QUESTIONS } from "./interview.js";
import {
  composeBuildPrompt,
  composeJourneyPrompt,
  composePlanPrompt,
  composeReviewPrompt,
  composeSpecPrompt,
  composeTasksPrompt,
} from "./prompts.js";
import {
  appUrlAllowed,
  checkJourneys,
  journeyAgent,
  journeysResultNa,
  journeysResultNotRun,
  pickDriver,
  startApp,
  startCommand,
} from "./journeys.js";
import { changeSince, isGitRepo, parseReview, reviewBase, reviewLine, reviewPassed, workingTreeFingerprint } from "./review.js";
import {
  activeSpec,
  approvalState,
  approve,
  findSpec,
  gitUser,
  listSpecs,
  nextSpecName,
  setActive,
  specPaths,
} from "./spec.js";
import { formatResults, label, specEvidenceDir, verify } from "./verify.js";
import { colors, isTestFile, rel, walk } from "./util.js";
import { recordProven, send } from "./telemetry.js";
import { createRequire } from "node:module";
const PACKAGE_VERSION = createRequire(import.meta.url)("../package.json").version;


const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "template");
const KINDS = ["web", "mobile", "api", "data", "cli", "library", "other"];

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function copyIfMissing(from, to) {
  if (!existsSync(from) || existsSync(to)) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

export function scaffold(root) {
  const p = ensure(root);
  copyIfMissing(join(TEMPLATES, "constitution.md"), join(p.dir, "constitution.md"));

  const rolesDir = join(TEMPLATES, "roles");
  if (existsSync(rolesDir)) {
    for (const file of readdirSync(rolesDir)) {
      copyIfMissing(join(rolesDir, file), join(p.roles, file));
    }
  }

  for (const file of ["spec.md", "plan.md", "tasks.md", "review-rules.md"]) {
    copyIfMissing(join(TEMPLATES, file), join(p.templates, file));
  }
}

export function ensureConfig(root) {
  if (!existsSync(paths(root).config)) {
    const stack = detectStack(root);
    const config = defaultConfig(root);
    if (stack.kind !== "other") config.kind = stack.kind;
    const agent = detectAgent();
    if (agent) config.agent = agent;
    writeConfig(root, config);
  }
  scaffold(root);
  return readConfig(root);
}

const IGNORE_BLOCK = `# Software Factory (machine state; evidence, reports and lessons are committed and shared)
.factory/state.json
.factory/last-verify.json
.factory/prompts/
.factory/idea.txt
`;

// Only machine state is hidden from git. Evidence, reports, lessons and the constitution
// are team records, so they stay committable. The old block hid all of .factory/ and is
// replaced wherever the factory next runs. Touches nothing a person wrote.
export function ignoreFactory(root) {
  if (!existsSync(join(root, ".git"))) return "unchanged";
  const file = join(root, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.includes(".factory/state.json")) return "unchanged";
  let next;
  let outcome = "migrated";
  if (/^# Software Factory\r?\n\.factory\/\r?$/m.test(text)) {
    next = text.replace(/^# Software Factory\r?\n\.factory\/\r?$/m, IGNORE_BLOCK.trimEnd());
  } else if (/^\.factory\/?\r?$/m.test(text)) {
    next = text.replace(/^\.factory\/?\r?$/m, IGNORE_BLOCK.trimEnd());
  } else {
    const prefix = text.endsWith("\n") || text === "" ? "" : "\n";
    next = `${text}${prefix}\n${IGNORE_BLOCK}`;
    outcome = "created";
  }
  try {
    writeFileSync(file, next);
    return outcome;
  } catch {
    return "failed";
  }
}

function sayIgnored(outcome) {
  if (outcome === "created" || outcome === "migrated") {
    console.log(colors.dim("Evidence, reports and lessons are saved to be committed and shared; only .factory machine state is ignored."));
  } else if (outcome === "failed") {
    console.log(colors.yellow("Could not update .gitignore. Evidence, reports and lessons are meant to be committed; only .factory machine state should be ignored."));
  }
}

function normalizeKind(value, fallback) {
  const kind = String(value ?? "").trim().toLowerCase();
  return KINDS.includes(kind) ? kind : fallback;
}

function normalizeData(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["y", "yes", "true"].includes(text)) return "yes";
  if (["n", "no", "false"].includes(text)) return "no";
  return "unknown";
}

async function ask(rl, question, fallback) {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback || "";
}

export async function init(root, opts = {}) {
  const stack = detectStack(root);
  const existing = readConfig(root);

  const detectedKind = stack.kind !== "other" ? stack.kind : "other";
  let name = opts.name ?? existing.name ?? basename(root);
  let kind = normalizeKind(
    opts.kind ?? (existing.kind !== "other" ? existing.kind : detectedKind),
    detectedKind,
  );
  let who = opts.who ?? (existing.whoDepends?.join(", ") || "nobody yet");
  let neverBreak = opts["never-break"] ?? existing.neverBreak ?? "";
  let data = normalizeData(opts.data ?? existing.personalData ?? "unknown");
  const configured = existsSync(paths(root).config);
  let agent = opts.agent ?? (configured ? existing.agent?.command : detectAgent()?.command) ?? "claude";

  if (!opts.yes && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log(colors.dim("Five questions. Press enter to keep the default.\n"));
      name = await ask(rl, "1. What is this project called?", name);
      const detected = stack.kind !== "other" ? `, looks like ${stack.kind}` : "";
      kind = normalizeKind(
        await ask(rl, `2. What kind of project is it? (${KINDS.join(", ")}${detected})`, kind),
        stack.kind,
      );
      who = await ask(rl, "3. Who depends on it? (client, funder, public, your team, nobody yet)", who);
      neverBreak = await ask(rl, "4. What must never break?", neverBreak);
      data = normalizeData(await ask(rl, "5. Does it handle personal data? (yes, no, not sure)", data));
      agent = await ask(rl, "Which agent command do you use? (claude, codex, gemini, other)", agent);
    } finally {
      rl.close();
    }
  }

  const config = {
    ...existing,
    name: name.trim() || basename(root),
    kind,
    whoDepends: String(who)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    neverBreak: String(neverBreak).trim(),
    personalData: data,
    agent:
      configured && existing.agent?.command === (agent.trim() || "claude")
        ? existing.agent
        : normaliseAgent({ command: agent.trim() || "claude" }),
    updatedAt: new Date().toISOString(),
  };

  writeConfig(root, config);
  scaffold(root);

  console.log(colors.green(`Created ${rel(root, paths(root).config)}`));
  sayIgnored(ignoreFactory(root));
  console.log(colors.dim(`Detected: ${stack.framework ?? "unknown"} / ${stack.language ?? "unknown"}`));
  console.log("");
  console.log("Next:");
  console.log('  factory spec "what to build"   write the spec first');
  console.log("  factory spec --approve         record your approval");
  console.log("  factory verify                 fast check, under a minute");
  return 0;
}

function written(file) {
  return existsSync(file) && readFileSync(file, "utf8").trim().length >= 40;
}

function noAgent(root, config, file) {
  console.log(colors.yellow(`No agent found: ${config.agent.command}`));
  console.log(`The prompt is saved at ${rel(root, file)}`);
  console.log("Run it with your agent, then continue. Nothing was called done.");
  return 2;
}

function printSpecList(root, config) {
  const names = listSpecs(root);
  if (!names.length) {
    console.log("No specs yet. Start one:");
    console.log('  factory spec "what you want to build"');
    return 0;
  }

  console.log(colors.bold("Specs"));
  for (const name of names) {
    const { state } = approvalState(root, name);
    const mark = config.spec?.active === name ? "*" : " ";
    console.log(`${mark} ${name.padEnd(42)} ${state}`);
  }
  console.log("");
  console.log('Start one: factory spec "what you want to build"');
  console.log("Approve:   factory spec --approve [name]");
  return 0;
}

// Who approves: --by, then the name saved in the config, then git's user.name, then (in a
// terminal) ask once and remember it. approve() itself never asks.
async function approverName(root, config, opts) {
  const known = String(opts.by ?? "").trim() || config.approvedBy || gitUser(root);
  if (known) return known;
  if (opts.yes || !process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = (await rl.question("Your name, for the approval record: ")).trim();
    if (name) writeConfig(root, { ...readConfig(root), approvedBy: name });
    return name;
  } finally {
    rl.close();
  }
}

export async function specCommand(root, opts = {}, args = []) {
  if (opts.approve) {
    const config = ensureConfig(root);
    const query = String(args[0] ?? config.spec?.active ?? "").trim();
    const name = findSpec(root, query);
    if (!name) {
      console.error("No spec to approve.");
      console.error('Start one with: factory "what you want to change"');
      return 1;
    }

    const approval = approve(root, name, await approverName(root, config, opts));
    if (!approval) {
      console.error(`Spec ${name} is empty. Nothing to approve.`);
      return 1;
    }

    setActive(root, name);
    console.log(colors.green(`Approved: ${name}`));
    console.log(`By ${approval.approvedBy}, ${approval.approvedAt.slice(0, 10)}.`);
    console.log(colors.dim(`Fingerprint ${approval.hash.slice(0, 12)}. Editing the spec invalidates it.`));
    if (!opts.quiet) console.log("Next: factory build");
    return 0;
  }

  const title = args.join(" ").trim();
  if (!title) return printSpecList(root, readConfig(root));

  const job = String(opts.job ?? title);
  const name = nextSpecName(root, title);
  const target = `specs/${name}/spec.md`;
  const abs = join(root, target);
  const analysis = opts.analysis ?? analyseProject(root);
  const context = { analysis, answers: opts.answers ?? {}, lane: opts.lane };

  if (opts.print) {
    console.log(composeSpecPrompt(root, readConfig(root), job, target, context));
    return 0;
  }

  const config = ensureConfig(root);
  const prompt = composeSpecPrompt(root, config, job, target, context);
  const file = savePrompt(root, `spec-${stamp()}`, prompt);

  mkdirSync(join(root, "specs", name), { recursive: true });
  if (!agentAvailable(config)) return noAgent(root, config, file);

  console.log(colors.bold(`Writing the spec: ${name}`));
  if (runAgent(root, prompt, config, file).capped) {
    console.error(colors.red("NOT DONE: the agent was stopped at the time cap; the spec is not finished."));
    return 1;
  }

  if (!written(abs)) {
    console.error(colors.red("The agent did not write a spec."));
    console.error(`The prompt is at ${rel(root, file)}. Run it yourself, then: factory approve ${name}`);
    return 1;
  }

  setActive(root, name);
  console.log(colors.green(`Spec written to ${target}`));
  if (!opts.quiet) {
    console.log("");
    console.log("Read it. If it is right:");
    console.log(`  factory approve ${name}`);
    console.log("If not, edit it, then approve. Editing after approval invalidates it.");
  }
  return 0;
}

function approvedSpecOrExplain(root) {
  const spec = activeSpec(root);
  if (!spec) {
    console.error("No active spec.");
    console.error('Start one with: factory "what you want to change"');
    return null;
  }
  if (spec.state !== "approved") {
    console.error(`Spec ${spec.name} is ${spec.state}. Read it, then: factory approve ${spec.name}`);
    return null;
  }
  return spec;
}

export function planCommand(root, opts = {}) {
  const spec = approvedSpecOrExplain(root);
  if (!spec) return 1;

  const files = specPaths(root, spec.name);
  if (existsSync(files.plan) && !opts.force) {
    console.error(`${rel(root, files.plan)} already exists. Use --force to rewrite it.`);
    return 1;
  }

  const target = `specs/${spec.name}/plan.md`;
  if (opts.print) {
    console.log(composePlanPrompt(root, readConfig(root), spec.name, spec.artifacts.spec, target));
    return 0;
  }

  const config = ensureConfig(root);
  const prompt = composePlanPrompt(root, config, spec.name, spec.artifacts.spec, target);
  const file = savePrompt(root, `plan-${stamp()}`, prompt);
  if (!agentAvailable(config)) return noAgent(root, config, file);

  console.log(colors.bold(`Writing the plan: ${spec.name}`));
  if (runAgent(root, prompt, config, file).capped) {
    console.error(colors.red("NOT DONE: the agent was stopped at the time cap; the plan is not finished."));
    return 1;
  }

  if (!written(files.plan)) {
    console.error(colors.red("The agent did not write a plan."));
    console.error(`The prompt is at ${rel(root, file)}. Run it yourself, then: factory tasks`);
    return 1;
  }

  console.log(colors.green(`Plan written to ${target}`));
  if (!opts.quiet) console.log("Next: factory tasks");
  return 0;
}

export function tasksCommand(root, opts = {}) {
  const spec = approvedSpecOrExplain(root);
  if (!spec) return 1;

  const files = specPaths(root, spec.name);
  if (!existsSync(files.plan)) {
    console.error("No plan yet. Run: factory plan");
    return 1;
  }
  if (existsSync(files.tasks) && !opts.force) {
    console.error(`${rel(root, files.tasks)} already exists. Use --force to rewrite it.`);
    return 1;
  }

  const planText = readFileSync(files.plan, "utf8");
  const target = `specs/${spec.name}/tasks.md`;
  if (opts.print) {
    console.log(composeTasksPrompt(root, readConfig(root), spec.name, spec.artifacts.spec, planText, target));
    return 0;
  }

  const config = ensureConfig(root);
  const prompt = composeTasksPrompt(root, config, spec.name, spec.artifacts.spec, planText, target);
  const file = savePrompt(root, `tasks-${stamp()}`, prompt);
  if (!agentAvailable(config)) return noAgent(root, config, file);

  console.log(colors.bold(`Writing the tasks: ${spec.name}`));
  if (runAgent(root, prompt, config, file).capped) {
    console.error(colors.red("NOT DONE: the agent was stopped at the time cap; the task list is not finished."));
    return 1;
  }

  if (!written(files.tasks)) {
    console.error(colors.red("The agent did not write a task list."));
    console.error(`The prompt is at ${rel(root, file)}. Run it yourself, then: factory build`);
    return 1;
  }

  console.log(colors.green(`Tasks written to ${target}`));
  if (!opts.quiet) console.log("Next: factory build");
  return 0;
}

function specTitle(text, fallback) {
  const line = String(text)
    .split("\n")
    .find((item) => /^#\s+/.test(item));
  if (!line) return fallback;
  return line.replace(/^#\s+(?:Feature Specification:\s*)?/i, "").trim() || fallback;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return ["y", "yes"].includes(answer);
  } finally {
    rl.close();
  }
}

function showApproval(root, name, text) {
  console.log("");
  console.log(`${colors.bold(`Spec ${name}`)}  ${colors.dim(rel(root, specPaths(root, name).spec))}`);
  console.log("");
  console.log(approvalView(text));
  console.log("");
}

async function reviewAndApprove(root, spec) {
  showApproval(root, spec.name, spec.artifacts.spec);
  if (!(await confirm("Approve it, and I'll plan, build and check it? (y/n) "))) {
    console.log(`\nNot approved. Edit ${rel(root, spec.artifacts.spec)} if you want, then: factory approve`);
    return false;
  }
  await specCommand(root, { approve: true, quiet: true }, [spec.name]);
  return true;
}

// factory approve [name]: read what matters, then approve. Resumes a spec written earlier.
export async function approveCommand(root, opts = {}, args = []) {
  const config = readConfig(root);
  const name = findSpec(root, String(args[0] ?? config.spec?.active ?? "").trim());
  if (!name) {
    console.error("No spec to approve.");
    console.error('Start one with: factory "what you want to change"');
    return 1;
  }

  const { state, artifacts } = approvalState(root, name);
  if (state === "missing") {
    console.error(`Spec ${name} is empty. Nothing to approve.`);
    return 1;
  }
  if (state === "approved") {
    console.log(`Spec ${name} is already approved.`);
    console.log("Next: factory build");
    return 0;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error("Approving needs a terminal, so you can read what you approve.");
      console.error(`Or record it without reading: factory approve ${name} --yes`);
      return 1;
    }
    showApproval(root, name, artifacts.spec);
    if (!(await confirm("Approve? (y/n) "))) {
      console.log(`Not approved. Edit ${rel(root, specPaths(root, name).spec)} if you want, then run factory approve again.`);
      return 0;
    }
  }

  return specCommand(root, { approve: true, by: opts.by, yes: opts.yes }, [name]);
}

function nextSteps(root, configured) {
  const lines = [];
  const spec = configured ? activeSpec(root) : null;
  if (spec && spec.state !== "approved") {
    lines.push(["factory approve", `spec ${spec.name} is waiting for your approval`]);
  } else if (spec && !readState(root).lastBuild) {
    lines.push(["factory build", `spec ${spec.name} is approved; plan, build and check it`]);
  }
  lines.push(['factory "what you want to change"', "spec, your approval, then it builds and checks"]);
  lines.push(["factory verify --deep", "also runs your tests and build"]);
  const width = Math.max(...lines.map(([command]) => command.length));
  return lines.map(([command, what]) => `  ${command.padEnd(width)}   ${colors.dim(what)}`);
}

function createConfig(root) {
  const config = ensureConfig(root);
  console.log(colors.dim(`Created factory.config.json (edit it any time). Agent: ${config.agent.command}`));
  sayIgnored(ignoreFactory(root));
  return config;
}

// The first run: what the project is and what it can prove, with no questions, no
// account and no agent. Without factory.config.json it writes nothing. In a terminal,
// with an agent installed, it then offers to fix the top problem it found.
export async function firstRun(root) {
  const configured = existsSync(paths(root).config);
  const analysis = analyseProject(root);
  if (analysis.empty) {
    console.log("No project found here. Run factory inside a project.");
    return 0;
  }

  const config = readConfig(root);
  const run = verify(root, { deep: false, config, save: configured });
  send("check", checkCounts(run, { mode: "cli" }), PACKAGE_VERSION);

  console.log(`${colors.bold(config.name)}  ${colors.dim(`(${analysis.label})`)}`);
  console.log("");
  console.log(colors.bold("What I see"));
  for (const line of analysis.summary.slice(1)) console.log(`  ${line}`);
  console.log("");
  console.log(colors.bold("What this project can prove right now"));
  console.log(formatResults(root, run, { header: false }));

  const fix = pickFix(run.results);
  let noAgentForFix = false;
  if (fix && process.stdin.isTTY && process.stdout.isTTY) {
    const agent = configured ? (agentAvailable(config) ? config.agent : null) : detectAgent();
    if (agent) {
      console.log("");
      console.log(colors.bold("Top problem"));
      console.log(`  ${fix.problem}`);
      console.log("");
      if (await confirm("Want me to fix this one now? You approve a short plan first. (y/n) ")) {
        return fixNow(root, fix, analysis);
      }
    } else {
      noAgentForFix = true;
    }
  }

  console.log("");
  console.log(colors.bold("Next"));
  for (const line of nextSteps(root, configured)) console.log(line);
  if (noAgentForFix) {
    console.log("");
    console.log(colors.dim("Install Claude Code, Codex, Gemini CLI or OpenCode and I can fix the top problem for you."));
  }
  return run.ok ? 0 : 1;
}

async function fixNow(root, fix, analysis) {
  if (!existsSync(paths(root).config)) createConfig(root);
  return runJob(root, { job: fix.job, title: fix.title, analysis, lane: "quick", fix });
}

async function runJob(root, { job, title, analysis, answers = {}, lane, fix, hotfix }) {
  const code = await specCommand(root, { quiet: true, analysis, answers, lane, job }, [title]);
  if (code !== 0) return code;
  const active = activeSpec(root);
  if (!active) return 1;
  if (!(await reviewAndApprove(root, active))) return 0;

  const built = build(root, { idea: job, hotfix, requires: fix?.requires });
  if (built !== 0) return built;
  report(root, {});
  if (fix) shareSummary(root, fix);
  return 0;
}

function shareSummary(root, fix) {
  const config = readConfig(root);
  const p = paths(root);
  if (!existsSync(p.lastVerify)) return;
  const run = JSON.parse(readFileSync(p.lastVerify, "utf8"));
  const spec = activeSpec(root);
  const text = fixSummary({
    project: config.name,
    fix,
    run,
    approval: spec?.artifacts.approval,
    diffStat: readState(root).lastDiffStat,
    review: readState(root).lastReview,
  });
  const dir = specEvidenceDir(root, config) ?? p.evidence;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.txt"), text);
  console.log("");
  console.log(colors.bold("Done. Here's the proof, ready to paste to your team:"));
  console.log("");
  console.log(text);
  console.log(colors.dim(`Saved to ${rel(root, join(dir, "summary.txt"))}`));
}

export async function start(root, opts = {}) {
  const title = String(opts.idea ?? "").trim();
  if (!title) return firstRun(root);

  if (!process.stdin.isTTY) {
    console.error("A job needs a terminal, so you can approve the spec.");
    console.error('Or run the steps one by one: factory spec "...", factory approve --yes, factory build');
    return 1;
  }

  if (!existsSync(paths(root).config)) createConfig(root);
  else ensureConfig(root);
  const analysis = analyseProject(root);

  let answers = {};
  const questions = opts.ask ? QUESTIONS : guardedTopics(title) ? GUARDED_QUESTIONS : [];
  if (questions.length) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log(opts.ask ? "A few questions, so the spec is yours." : "Two questions the code cannot answer.");
      answers = await askList(rl, questions, { log: console.log });
    } finally {
      rl.close();
    }
  }

  return runJob(root, { job: title, title, analysis, answers, hotfix: Boolean(opts.hotfix) });
}

function gitText(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return run.status === 0 ? run.stdout.trim() : null;
}

function countTests(root) {
  return walk(root).filter(isTestFile).length;
}

// What the build changed, from the commit it started on. Kept as evidence, and the
// future reviewer reads the same range.
function saveChanges(root, config, base) {
  if (!base) return null;
  const stat = gitText(root, ["diff", "--stat", base]) ?? "";
  const untracked = (gitText(root, ["status", "--porcelain"]) ?? "")
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => `new: ${line.slice(3)}`);
  const dir = specEvidenceDir(root, config) ?? paths(root).evidence;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "changes.txt"), [`Changes since ${base.slice(0, 12)}`, "", stat, ...untracked, ""].join("\n"));
  const last = stat.split("\n").pop()?.trim() ?? "";
  const summary = [last, untracked.length ? `${untracked.length} new ${untracked.length === 1 ? "file" : "files"}` : ""].filter(Boolean).join(", ");
  writeState(root, { lastDiffStat: summary || "no changes" });
  return summary;
}

function printBuild(root, idea) {
  const config = readConfig(root);
  const spec = activeSpec(root);
  const artifacts = spec?.state === "approved" ? spec.artifacts : null;
  console.log(composeBuildPrompt(root, config, idea || (artifacts ? specTitle(artifacts.spec, spec.name) : ""), [], artifacts));
  return 0;
}

// Using the app: a separate agent run, after the checks pass and before the review, that
// works the app like a person and leaves a screenshot for every claim. Websites are started
// here; phone apps need a simulator already running.
function runJourneys(root, config, { artifacts }) {
  const analysis = analyseProject(root);
  const info = pickDriver(root, analysis, config);
  const finish = (row, dir = null) => {
    writeState(root, { lastJourneys: { at: new Date().toISOString(), status: row.status, summary: row.summary, dir } });
    return { result: row, dir };
  };

  if (!info.driver) return finish(journeysResultNa(info.reason));
  if (!artifacts) return finish(journeysResultNa("No approved spec, so there is nothing to walk through"));
  const tester = journeyAgent(config, info);
  if (!tester) return finish(journeysResultNa("Using the app runs with Claude Code; for another agent, set agent.journeys"));
  if (!agentAvailable(tester)) return finish(journeysResultNotRun(`No agent found for the journeys: ${tester.agent.command}`));

  const base = specEvidenceDir(root, config) ?? ensure(root).evidence;
  const dir = join(base, "journeys");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let app = null;
  let url = null;
  if (analysis.stack.kind === "web") {
    const start = startCommand(root, analysis.stack);
    if (!start) return finish(journeysResultNotRun("No dev or start script found, so the app could not be started"), rel(root, dir));
    url = config.checks?.appUrl ?? null;
    if (url && !appUrlAllowed(url, config)) {
      return finish(journeysResultNotRun("checks.appUrl is not on this machine; set checks.allowRemoteApp to true to allow it"), rel(root, dir));
    }
    const logFile = join(dir, "app.log");
    console.log(colors.dim(`Starting the app: ${start.command}${start.cwd ? ` (in ${start.cwd})` : ""}`));
    app = startApp(root, start, { logFile, url, timeoutSeconds: config.checks?.appStartSeconds ?? 60 });
    if (app.error) {
      return finish(journeysResultNotRun(`The app could not be used: ${app.error}`, [], [rel(root, logFile)]), rel(root, dir));
    }
    url = app.url;
  }

  const prompt = composeJourneyPrompt(root, config, { info, url, artifacts, dir: rel(root, dir) });
  const promptFile = savePrompt(root, `journeys-${stamp()}`, prompt);
  const guarded = info.driver !== "playwright" && isGitRepo(root);
  const before = guarded ? workingTreeFingerprint(root) : null;
  console.log(colors.bold(`Using the app: ${info.driver}${url ? ` at ${url}` : ""}`));
  let tested;
  try {
    tested = runAgent(root, prompt, tester, promptFile);
  } finally {
    app?.stop();
  }

  if (tested.capped) {
    return finish(
      { ...journeysResultNotRun(""), status: "fail", summary: "The tester was stopped at the time cap, so its journeys do not count" },
      rel(root, dir),
    );
  }

  if (guarded && workingTreeFingerprint(root) !== before) {
    return finish(
      { ...journeysResultNotRun(""), status: "fail", summary: "The tester changed the app's code, so its journeys do not count" },
      rel(root, dir),
    );
  }
  return finish(checkJourneys(root, dir), rel(root, dir));
}

function printJourneys(row) {
  const paint = row.status === "pass" ? colors.green : row.status === "fail" ? colors.red : colors.dim;
  console.log(paint(`${label(row).padEnd(8)} Used the app: ${row.summary}`));
  if (row.status === "fail") for (const detail of row.details.slice(0, 5)) console.log(colors.dim(`         ${detail}`));
}

// The independent review: a separate agent run that sees the change, the approved spec,
// the rules and the factory's check results, never the builder's prompt. It may write
// only its review file; if anything else changes, the review does not count.
function reviewerConfig(config) {
  return config.agent.review ? { ...config, agent: normaliseAgent(config.agent.review) } : config;
}

export function runReview(root, config, { artifacts, base, run }) {
  const reviewer = reviewerConfig(config);
  const stop = (problem) => {
    writeState(root, { lastReview: { at: new Date().toISOString(), passed: false, summary: problem, file: null, unproven: [] } });
    return { passed: false, problem, summary: problem };
  };
  if (!agentAvailable(reviewer)) return stop(`No reviewer agent found: ${reviewer.agent.command}`);
  const change = changeSince(root, base);
  if (!change.files.length) return stop(`Nothing changed since ${base.slice(0, 12)}; nothing to review`);

  const dir = specEvidenceDir(root, config) ?? ensure(root).evidence;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "review.md");
  rmSync(file, { force: true });

  const prompt = composeReviewPrompt(root, config, { artifacts, change, reviewFile: rel(root, file), run });
  const promptFile = savePrompt(root, `review-${stamp()}`, prompt);
  const before = workingTreeFingerprint(root);
  console.log(colors.bold(`Independent review: ${reviewer.agent.command}, a separate session`));
  const reviewedRun = runAgent(root, prompt, reviewer, promptFile);

  let problem = null;
  if (reviewedRun.capped) problem = "The reviewer was stopped at the time cap, so the review does not count";
  else if (workingTreeFingerprint(root) !== before) problem = "The reviewer changed files besides its review, so the review does not count";
  else if (!existsSync(file)) problem = "The reviewer wrote no review";
  const review = problem ? null : parseReview(readFileSync(file, "utf8"));
  if (review && !review.verdict) problem = "The review has no VERDICT line, so it does not count";

  const passed = !problem && reviewPassed(review);
  const summary = problem ?? reviewLine(review);
  writeState(root, {
    lastReview: {
      at: new Date().toISOString(),
      passed,
      summary,
      file: rel(root, file),
      mustFix: review?.mustFix.length ?? null,
      unproven: review?.unproven.map((check) => `${check.check}: ${check.evidence}`) ?? [],
    },
  });
  return { passed, problem, review, file, summary };
}

function reviewFailure(result) {
  const details = [];
  if (result.review) {
    for (const finding of result.review.mustFix) details.push(`${finding.where} ${finding.rule}: ${finding.what}`);
    for (const check of result.review.failed) details.push(`${check.check} FAIL: ${check.evidence}`);
    for (const item of result.review.missing) details.push(`Missing: ${item}`);
  }
  return {
    id: "review",
    title: "Independent review",
    kind: "proven",
    status: "fail",
    summary: result.summary,
    details: [...details, `Full review: ${rel(process.cwd(), result.file ?? "")}`].filter((line) => !line.endsWith(": ")),
    evidence: result.file ? [result.file] : [],
  };
}

function printReview(root, result) {
  const paint = result.passed ? colors.green : colors.red;
  console.log(paint(`Review: ${result.summary}`));
  if (result.review) {
    for (const finding of result.review.mustFix) console.log(`  must fix  ${finding.where}  ${finding.rule}: ${finding.what}`);
    for (const check of result.review.failed) console.log(`  FAIL      ${check.check}: ${check.evidence}`);
    for (const check of result.review.unproven) console.log(colors.yellow(`  a person  ${check.check}: ${check.evidence}`));
  }
  if (result.file && existsSync(result.file)) console.log(colors.dim(`  ${rel(root, result.file)}`));
}

export function reviewCommand(root, opts = {}) {
  if (!isGitRepo(root)) {
    console.error("factory review needs git, to know what changed.");
    return 1;
  }
  const config = ensureConfig(root);
  const spec = activeSpec(root);
  const artifacts = spec?.state === "approved" ? spec.artifacts : null;
  const base = reviewBase(root, { base: opts.base, state: readState(root) });
  if (!base) {
    console.error("No commit to compare against. Pass one: factory review --base <commit or branch>");
    return 1;
  }
  const p = paths(root);
  const run = existsSync(p.lastVerify) ? JSON.parse(readFileSync(p.lastVerify, "utf8")) : null;
  const result = runReview(root, config, { artifacts, base, run });
  printReview(root, result);
  if (result.problem?.startsWith("No reviewer agent")) return 2;
  return result.passed ? 0 : 1;
}

export function build(root, opts = {}) {
  let idea = String(opts.idea ?? "").trim();
  if (opts.print) return printBuild(root, idea);

  const config = ensureConfig(root);
  let spec = activeSpec(root);
  const specRequired = config.spec?.required !== false;

  if (specRequired && !opts.hotfix) {
    if (!spec) {
      console.error("No active spec. The factory builds against an approved spec.");
      console.error('Start one: factory "what you want to change"');
      console.error("For a genuine quick fix: add --hotfix (it is recorded).");
      return 1;
    }
    if (spec.state !== "approved") {
      console.error(`Spec ${spec.name} is ${spec.state}. Read it, then: factory approve ${spec.name}`);
      console.error("Editing a spec after approval makes it stale; approve it again.");
      return 1;
    }
  }

  if (!idea && spec?.state === "approved") idea = specTitle(spec.artifacts.spec, spec.name);
  if (!idea) {
    console.error('Say what to build. Example: factory build "add a booking form" --hotfix');
    return 1;
  }

  // Plan and tasks come before code; `factory build` resumes from wherever it stopped.
  if (spec?.state === "approved" && !opts.hotfix) {
    const files = specPaths(root, spec.name);
    if (!existsSync(files.plan)) {
      const code = planCommand(root, { quiet: true });
      if (code !== 0) return code;
    }
    if (!existsSync(files.tasks)) {
      const code = tasksCommand(root, { quiet: true });
      if (code !== 0) return code;
    }
    spec = activeSpec(root);
  }

  const p = ensure(root);
  writeFileSync(p.idea, `${idea}\n`);
  if (opts.hotfix) {
    console.log(colors.yellow("HOTFIX: no approved spec. This is recorded in the evidence."));
    writeState(root, { lastHotfix: new Date().toISOString() });
  }

  const base = gitText(root, ["rev-parse", "HEAD"]);
  writeState(root, { buildBase: base, buildStartedAt: new Date().toISOString() });
  const testsBefore = countTests(root);

  const artifacts = spec?.state === "approved" ? spec.artifacts : null;
  const attempts = Math.max(1, Number(opts.attempts ?? 2) || 1);
  let failures = [];
  let lastMinutes = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const prompt = composeBuildPrompt(root, config, idea, failures, artifacts);
    const file = savePrompt(root, `build-${stamp()}-${attempt}`, prompt);

    if (!agentAvailable(config)) {
      console.log(colors.yellow(`No agent found: ${config.agent.command}`));
      console.log(`The prompt is saved at ${rel(root, file)}`);
      console.log("Run it with your agent, then run: factory verify --deep");
      return 2;
    }

    console.log(colors.bold(`Attempt ${attempt}/${attempts}: ${config.agent.command}`));
    const built = runAgent(root, prompt, config, file);
    // A builder stopped at the cap is a proven failure: the attempt can never end in
    // DONE, whatever the checks say about the half-finished work.
    const capped = built.capped
      ? {
          id: "agent-cap",
          title: "Builder stopped at the time cap",
          kind: "proven",
          status: "fail",
          summary: "The build ran past checks.agentMinutes and was stopped; the attempt is not finished.",
          details: [],
          evidence: [],
        }
      : null;

    const run = verify(root, { deep: true, config });
    lastMinutes = run.minutes ?? 0;
    const testsAfter = countTests(root);
    const removed =
      testsAfter < testsBefore
        ? {
            id: "tests-removed",
            title: "Tests removed",
            kind: "proven",
            status: "fail",
            summary: `${testsBefore} test files before the build, ${testsAfter} after. Put them back or say why in the spec.`,
            details: [],
            evidence: [],
          }
        : null;
    // A fix can name checks that must pass, not merely not fail: "add the first test"
    // is not done while the tests cannot run.
    const unmet = (opts.requires ?? [])
      .map((id) => run.results.find((result) => result.id === id))
      .filter((result) => result && result.status !== "pass")
      .map((result) => ({
        ...result,
        id: `required-${result.id}`,
        kind: "proven",
        status: "fail",
        summary: `This job needs "${result.title}" to pass; it is ${label(result)}: ${result.summary}`,
      }));
    saveChanges(root, config, base);
    console.log(`\n${formatResults(root, run)}`);
    if (capped) console.log(colors.red(`FAIL     ${capped.title}: ${capped.summary}`));
    if (removed) console.log(colors.red(`FAIL     ${removed.title}: ${removed.summary}`));
    for (const item of unmet) console.log(colors.red(`FAIL     ${item.summary}`));
    console.log("");

    let reviewed = null;
    if (run.ok && !capped && !removed && !unmet.length) {
      if (artifacts) {
        const after = activeSpec(root);
        if (!after || after.state !== "approved") {
          console.error(colors.red("NOT DONE: the spec changed during the build. Approve it again."));
          return 1;
        }
      }

      const used = runJourneys(root, config, { artifacts });
      printJourneys(used.result);
      if (used.result.status === "fail") {
        failures = [used.result];
        if (attempt < attempts) console.log(colors.red("NOT DONE: sending what failed in the app back to the team.\n"));
        continue;
      }
      const evidenceRun = { ...run, results: [...run.results, used.result] };

      if (config.review?.enabled !== false && base) {
        reviewed = runReview(root, config, { artifacts, base, run: evidenceRun });
        printReview(root, reviewed);
        console.log("");
      } else {
        writeState(root, { lastReview: null });
        console.log(colors.yellow(base ? "No independent review: review.enabled is false." : "No independent review: this is not a git repository."));
      }

      if (!reviewed || reviewed.passed) {
        writeState(root, { lastBuild: new Date().toISOString() });
        recordProven({ caught: attempt > 1 ? 1 : 0 });
        send("prove", { mode: "cli", ok: true, attempts: attempt, caught: attempt > 1, verdict: reviewed ? "approve" : "none", minutes: run.minutes ?? 0 }, PACKAGE_VERSION);
        console.log(colors.dim('Was it useful? Tell us in one line: factory feedback "..."'));
        console.log(colors.green(`DONE: the checks passed${reviewed ? " and a separate session approved the change" : ""}. Proof: ${rel(root, run.mdFile)}`));
        return 0;
      }
    }

    failures = run.results.filter((result) => result.kind === "proven" && result.status === "fail");
    if (capped) failures.push(capped);
    if (removed) failures.push(removed);
    failures.push(...unmet);
    if (reviewed && !reviewed.passed) failures.push(reviewFailure(reviewed));
    if (failures.length && attempt < attempts) {
      console.log(colors.red(`NOT DONE: sending ${failures.length} ${failures.length === 1 ? "failure" : "failures"} back to the team.\n`));
    }
  }

  console.log(colors.red("NOT DONE: the checks did not pass. Nothing was called done."));
  send("prove", { mode: "cli", ok: false, attempts, failed: failures.map((f) => f.id).filter(Boolean), minutes: lastMinutes }, PACKAGE_VERSION);
  return 1;
}

// The anonymous shape of a check run: its kind and how many checks passed or failed, and which.
export function checkCounts(run, extra = {}) {
  const checks = {};
  for (const result of run.results) checks[result.status] = (checks[result.status] ?? 0) + 1;
  const failed = run.results.filter((r) => r.status === "fail" || r.status === "look").map((r) => r.id).filter(Boolean);
  return { ...extra, kind: run.kind, ok: run.ok, minutes: run.minutes ?? 0, checks, failed };
}

export function verifyCommand(root, opts = {}) {
  if (opts.app) {
    const config = ensureConfig(root);
    const spec = activeSpec(root);
    const used = runJourneys(root, config, { artifacts: spec?.state === "approved" ? spec.artifacts : null });
    printJourneys(used.result);
    return used.result.status === "fail" ? 1 : 0;
  }
  const save = existsSync(paths(root).config) || Boolean(opts.save);
  const run = verify(root, { deep: Boolean(opts.deep), save });
  if (opts.json) process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
  else console.log(formatResults(root, run));
  return run.ok ? 0 : 1;
}

function renderReport(run, config, spec, review, journeys) {
  const date = new Date(run.at).toLocaleString();
  const skipped = run.results.filter((result) => result.status === "na" || result.status === "not-run");

  const lines = [
    `# ${config.name}: what was checked`,
    "",
    `Prepared ${date}. This is a record of checks that ran. It is not a guarantee.`,
    "",
    config.whoDepends?.length
      ? `Who depends on this: ${config.whoDepends.join(", ")}.`
      : "Who depends on this: not recorded.",
    "",
    spec
      ? `Spec: ${spec.name} (${spec.state}${
          spec.artifacts.approval
            ? `, approved by ${spec.artifacts.approval.approvedBy} on ${String(spec.artifacts.approval.approvedAt).slice(0, 10)}`
            : ""
        }).`
      : "Spec: none.",
    "",
    "## Results",
    "",
    "| Check | Result | What it found |",
    "|---|---|---|",
    ...run.results.map((result) => `| ${result.title} | ${label(result)} | ${result.summary} |`),
    "",
    "## Used the app",
    "",
    journeys ? `${journeys.summary}.${journeys.dir ? ` Screenshots and notes: ${journeys.dir}` : ""}` : "The app was not used for this result.",
    "",
    "## Independent review",
    "",
    review
      ? `${review.summary}.${review.file ? ` Review: ${review.file}` : ""}`
      : "No independent review ran for this result.",
    ...(review?.unproven?.length ? ["", "For a person to check:", ...review.unproven.map((item) => `- ${item}`)] : []),
    "",
    "## What was not checked",
    "",
  ];

  if (skipped.length) {
    for (const result of skipped) {
      lines.push(`- ${result.title}: ${result.summary}`);
    }
  } else {
    lines.push("- Every check in this run applied.");
  }

  lines.push(
    "",
    "## What this does not prove",
    "",
    "- It does not prove the software is correct or free of bugs.",
    "- It does not prove legal compliance, including POPIA.",
    "- It does not test real phones, real networks or real people. Screenshots show what the AI saw, on this machine.",
    "- It does not judge whether the design is good or the words are clear.",
    "",
    "## Evidence",
    "",
    `- Full result: ${run.jsonFile ?? ".factory/last-verify.json"}`,
  );

  for (const result of run.results) {
    for (const file of result.evidence) {
      lines.push(`- ${result.title}: ${file}`);
    }
  }

  lines.push(
    "",
    "## If you are receiving this",
    "",
    "Ask the builder for the evidence file, and run the same checks yourself:",
    "",
    "```bash",
    "factory verify --deep",
    "```",
    "",
  );

  return lines.join("\n");
}

export function report(root, opts = {}) {
  const p = paths(root);
  if (!existsSync(p.lastVerify)) {
    console.error("No verification yet. Run: factory verify --deep");
    return 1;
  }

  const run = JSON.parse(readFileSync(p.lastVerify, "utf8"));
  const config = readConfig(root);
  const state = readState(root);
  const text = renderReport(run, config, activeSpec(root), state.lastReview, state.lastJourneys);
  const out = opts.out ? resolve(root, String(opts.out)) : p.report;

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(colors.green(`Report written to ${out}`));
  return 0;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "lesson";
}

export async function lessonNew(root, opts = {}) {
  const answers = {
    title: opts.title ?? "",
    what: opts.what ?? "",
    spot: opts.spot ?? "",
    check: opts.check ?? "",
    example: opts.example ?? "",
    sa: ["y", "yes", "true"].includes(String(opts.sa ?? opts["south-africa"] ?? "").toLowerCase()),
  };

  if (!answers.title || !answers.what) {
    if (opts.yes || !process.stdin.isTTY) {
      console.error('A lesson needs --title and --what. Example: factory lesson new --title "..." --what "..."');
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      answers.title = await ask(rl, "Title (one line)", answers.title);
      answers.what = await ask(rl, "What went wrong?", answers.what);
      answers.spot = await ask(rl, "How can someone spot it?", answers.spot);
      answers.check = await ask(rl, "What check catches it? (or describe it in plain words)", answers.check);
      answers.example = await ask(rl, "A real example (project, what happened)", answers.example);
      answers.sa = normalizeData(await ask(rl, "Is it South Africa specific? (y/N)", "no")) === "yes";
    } finally {
      rl.close();
    }
  }

  if (!String(answers.title).trim() || !String(answers.what).trim()) {
    console.error("A lesson needs a title and what went wrong.");
    return 1;
  }

  const date = new Date().toISOString().slice(0, 10);
  const file = join(root, "lessons", `${date}-${slugify(answers.title)}.md`);

  if (existsSync(file)) {
    console.error(`That lesson already exists: ${rel(root, file)}`);
    return 1;
  }

  mkdirSync(join(root, "lessons"), { recursive: true });
  copyIfMissing(join(TEMPLATES, "lesson.md"), join(root, "lessons", "_template.md"));

  const lines = [
    `# ${String(answers.title).trim()}`,
    "",
    `- Date: ${date}`,
    `- South Africa specific: ${answers.sa ? "yes" : "no"}`,
    "",
    "## What went wrong",
    "",
    String(answers.what).trim() || "_Not written yet._",
    "",
    "## How to spot it",
    "",
    String(answers.spot).trim() || "_Not written yet._",
    "",
    "## The check",
    "",
    String(answers.check).trim() || "_No check yet. Describe it in plain words._",
    "",
    "## Real example",
    "",
    String(answers.example).trim() || "_Not written yet._",
    "",
  ];

  if (answers.sa) {
    lines.push(
      "## Not legal advice",
      "",
      "This lesson is a prompt to look, not legal advice. A person who knows the law has to decide.",
      "",
    );
  }

  writeFileSync(file, lines.join("\n"));
  console.log(colors.green(`Lesson written to ${rel(root, file)}`));
  return 0;
}

export function status(root) {
  const config = readConfig(root);
  const state = readState(root);
  const p = paths(root);

  console.log(colors.bold(`${config.name}`) + colors.dim(`  ${config.kind}`));
  console.log(`Config: ${existsSync(p.config) ? rel(root, p.config) : "not created (run factory init)"}`);
  const spec = activeSpec(root);
  console.log(`Spec:   ${spec ? `${spec.name} (${spec.state})` : "none"}`);

  if (!state.lastVerify || !existsSync(p.lastVerify)) {
    console.log("Checked: not yet. Run: factory verify");
    return 0;
  }

  const run = JSON.parse(readFileSync(p.lastVerify, "utf8"));
  const failed = run.results.filter((result) => result.kind === "proven" && result.status === "fail");
  const look = run.results.filter((result) => result.kind === "flagged" && result.status === "fail");
  const notRun = run.results.filter((result) => result.status === "not-run");

  console.log(`Checked: ${new Date(run.at).toLocaleString()} (${run.deep ? "deep" : "fast"} pass)`);
  console.log(failed.length ? colors.red(`Failed: ${failed.map((item) => item.title).join(", ")}`) : colors.green("Failed: none"));
  if (look.length) console.log(colors.yellow(`To look at: ${look.map((item) => item.title).join(", ")}`));
  if (notRun.length) console.log(colors.dim(`Not run: ${notRun.map((item) => item.title).join(", ")}`));
  if (state.lastReview) {
    const paint = state.lastReview.passed ? colors.green : colors.red;
    console.log(paint(`Review:  ${state.lastReview.summary}`));
  }
  console.log(colors.dim(`Evidence: ${rel(root, p.lastVerify)}`));
  return 0;
}

export function doctor(root) {
  const detected = detectStack(root);
  const config = readConfig(root);
  const stack = { ...detected };
  if (stack.kind === "other" && config.kind !== "other") stack.kind = config.kind;
  const p = paths(root);
  const configured = existsSync(p.config);
  const version = agentVersion(config);
  const found = configured || version ? null : detectAgent();

  console.log(colors.bold("factory doctor"));
  console.log(`Project:    ${config.name} (${stack.kind})`);
  console.log(`Detected:   ${stack.framework ?? "unknown"} / ${stack.language ?? "unknown"}${stack.workspaces.length ? `, monorepo (${stack.workspaces.length} packages, main: ${stack.primary})` : ""}`);
  console.log(`Config:     ${configured ? rel(root, p.config) : "none yet (factory writes nothing until you start a job)"}`);
  const spec = configured ? activeSpec(root) : null;
  console.log(`Spec:       ${spec ? `${spec.name} (${spec.state})` : "none"}`);
  console.log(`Tests:      ${stack.testCommand ? `${stack.testCommand}${stack.commandCwd ? ` (in ${stack.commandCwd})` : ""}` : "none found"}`);
  console.log(`Build:      ${stack.buildCommand ?? "none found"}`);
  if (version) {
    console.log(`Agent:      ${config.agent.command} ${colors.green(`(found: ${version})`)}`);
  } else if (found) {
    console.log(`Agent:      ${found.command} ${colors.green("(found; it will be used when you start a job)")}`);
  } else {
    console.log(`Agent:      ${colors.yellow("none found")}`);
    console.log("            Install Claude Code, Codex, Gemini CLI or OpenCode, or set agent.command in");
    console.log("            factory.config.json. Everything except spec, plan, tasks and build works without one.");
  }
  console.log("");
  const web = stack.kind === "web";
  console.log("Checks:");
  console.log("  secrets        always (real credentials, and possible test passwords)");
  console.log("  test proof     always (empty, screen-only or skipped tests; no tests at all)");
  console.log(`  tests          ${stack.testCommand ? "with --deep" : "not applicable (no test command)"}`);
  console.log(`  build          ${stack.buildCommand ? "with --deep" : "not applicable (no build command)"}`);
  console.log(`  weight         ${web ? "after a build" : "not applicable (websites only)"}`);
  console.log("  personal data  always");
  console.log(`  offline        ${web ? "when the site has a web app manifest or checks.offline is true" : "not applicable (websites only)"}`);
  return 0;
}
