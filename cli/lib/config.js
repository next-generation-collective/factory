import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { normaliseAgent } from "./agents.js";

export const FACTORY_DIR = ".factory";
export const CONFIG_FILE = "factory.config.json";

export function paths(root) {
  const dir = join(root, FACTORY_DIR);
  return {
    root,
    dir,
    config: join(root, CONFIG_FILE),
    state: join(dir, "state.json"),
    evidence: join(dir, "evidence"),
    lastVerify: join(dir, "last-verify.json"),
    prompts: join(dir, "prompts"),
    roles: join(dir, "roles"),
    templates: join(dir, "templates"),
    idea: join(dir, "idea.txt"),
    report: join(dir, "report.md"),
  };
}

export function ensure(root) {
  const p = paths(root);
  for (const dir of [p.dir, p.evidence, p.prompts, p.roles, p.templates]) {
    mkdirSync(dir, { recursive: true });
  }
  return p;
}

export function defaultConfig(root) {
  return {
    name: basename(root),
    kind: "other",
    whoDepends: [],
    neverBreak: "",
    personalData: "unknown",
    agent: {
      command: "claude",
      args: ["-p", "--permission-mode", "acceptEdits"],
    },
    spec: {
      active: null,
      required: true,
    },
    checks: {
      budgetKb: 1500,
      maxFileKb: 700,
      timeoutMinutes: 3,
    },
    createdAt: new Date().toISOString(),
  };
}

export function readConfig(root) {
  const base = defaultConfig(root);
  const file = paths(root).config;
  if (!existsSync(file)) return base;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return base;
  }
  return {
    ...base,
    ...raw,
    agent: raw.agent ? normaliseAgent(raw.agent) : base.agent,
    spec: { ...base.spec, ...(raw.spec ?? {}) },
    checks: { ...base.checks, ...(raw.checks ?? {}) },
  };
}

export function writeConfig(root, config) {
  ensure(root);
  writeFileSync(paths(root).config, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function readState(root) {
  const file = paths(root).state;
  if (!existsSync(file)) return { lastVerify: null };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { lastVerify: null };
  }
}

export function writeState(root, patch) {
  const next = { ...readState(root), ...patch };
  ensure(root);
  writeFileSync(paths(root).state, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
