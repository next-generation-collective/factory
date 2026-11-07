// What the factory remembers on the builder's own computer, and the anonymous counts it may
// share with Next-Gen, only if the builder said yes. Never code, file names, project names,
// secrets, names or emails. docs/TELEMETRY.md lists every field.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const ENDPOINT = "https://ng-telemetry.nextgencollective.workers.dev/v1/events";

function folder() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "next-gen");
}

function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(folder(), name), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  try {
    mkdirSync(folder(), { recursive: true });
    writeFileSync(join(folder(), name), `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // A read-only home folder only means nothing is remembered.
  }
}

// Off on build servers, and whenever the builder has said "do not track" anywhere.
export function blockedByEnvironment(env = process.env) {
  const off = (value) => ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
  const no = (value) => ["0", "false", "no", "off"].includes(String(value ?? "").toLowerCase());
  return off(env.CI) || off(env.DO_NOT_TRACK) || no(env.NEXT_GEN_TELEMETRY) || Boolean(env.NODE_TEST_CONTEXT);
}

export function settings() {
  return readJson("settings.json", {});
}

export function sharing() {
  return settings().share === true && !blockedByEnvironment();
}

export function needsAnswer() {
  return settings().share === undefined && !blockedByEnvironment();
}

export function setSharing(share) {
  const current = settings();
  writeJson("settings.json", { ...current, share: Boolean(share), id: current.id ?? randomUUID(), answeredAt: new Date().toISOString().slice(0, 10) });
}

export const SHARE_QUESTION =
  "Help make the factory better for every builder? It shares anonymous counts: which checks ran and what they caught. Never your code, file names or personal details. You can change this any time with: factory share off";

// Counts only. Anything else a caller passes is dropped here, before it can leave the machine.
const ALLOWED = new Set(["mode", "client", "kind", "status", "via", "ok", "attempts", "caught", "verdict", "checks", "failed", "minutes", "feeling", "lane", "stopped", "upgraded"]);

function clean(props) {
  const out = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (!ALLOWED.has(key)) continue;
    if (Array.isArray(value)) out[key] = value.filter((v) => /^[a-z0-9-]{1,32}$/.test(String(v))).slice(0, 20);
    else if (value && typeof value === "object") {
      out[key] = Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[a-z0-9-]{1,32}$/.test(k) && Number.isFinite(v)).slice(0, 20));
    } else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else out[key] = String(value).replace(/[^a-z0-9 .-]/gi, "").slice(0, 32);
  }
  return out;
}

export function payload(event, props, version) {
  return {
    id: settings().id ?? null,
    event: String(event).replace(/[^a-z_]/g, "").slice(0, 32),
    v: version,
    os: platform(),
    node: process.versions.node.split(".")[0],
    props: clean(props),
  };
}

const pending = new Set();

// Wait for anything still being sent, for at most a moment, before the command exits.
export function flush() {
  return Promise.allSettled([...pending]);
}

export function send(event, props, version, options) {
  const sending = post(event, props, version, options);
  pending.add(sending);
  sending.finally(() => pending.delete(sending));
  return sending;
}

// Never blocks the builder for more than a moment, and never fails their work.
async function post(event, props, version, { fetchImpl = globalThis.fetch } = {}) {
  if (!sharing() || typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchImpl(process.env.NEXT_GEN_TELEMETRY_URL || ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(event, props, version)),
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// A one-line feedback form, filled in, on GitHub. Opening it sends nothing; the builder
// reads it and chooses whether to submit.
const FEELINGS = {
  loved: "Loved it: it caught something or saved me time",
  "false-alarm": "False alarm: it flagged something that was fine",
  confusing: "Confusing: I did not understand what it wanted",
  wish: "Wish: I want it to do something it does not",
};

export function feedbackUrl(text, feeling = null) {
  const words = String(text ?? "").trim();
  const params = new URLSearchParams({ template: "feedback.yml", title: `Feedback: ${words.slice(0, 60)}`, what: words });
  if (FEELINGS[feeling]) params.set("kind", FEELINGS[feeling]);
  return `https://github.com/next-generation-collective/factory/issues/new?${params}`;
}

export function guessFeeling(text) {
  const t = String(text ?? "").toLowerCase();
  if (/false alarm|not a real|wrong|fine actually|flagged .* fine/.test(t)) return "false-alarm";
  if (/confus|did ?n.t understand|unclear|lost/.test(t)) return "confusing";
  if (/wish|would love|please add|want it to|could it/.test(t)) return "wish";
  if (/love|great|saved|caught|amazing|helpful|useful/.test(t)) return "loved";
  return null;
}

// The builder's own progress, kept on their computer whether or not they share anything.
function weekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function stats() {
  return readJson("stats.json", { proven: 0, caught: 0, weeks: {} });
}

export function recordProven({ caught = 0 } = {}, now = new Date()) {
  const s = stats();
  const week = weekOf(now);
  const w = s.weeks?.[week] ?? { proven: 0, caught: 0 };
  const weeks = { [week]: { proven: w.proven + 1, caught: w.caught + caught } };
  writeJson("stats.json", { proven: (s.proven ?? 0) + 1, caught: (s.caught ?? 0) + caught, weeks });
}

export function progressLine(s = stats(), now = new Date()) {
  if (!s.proven) return null;
  const week = s.weeks?.[weekOf(now)] ?? { proven: 0, caught: 0 };
  const builds = `${s.proven} proven ${s.proven === 1 ? "build" : "builds"}`;
  if (week.caught) return `${builds}. The factory caught ${week.caught} ${week.caught === 1 ? "mistake" : "mistakes"} for you this week.`;
  if (s.caught) return `${builds}. ${s.caught} ${s.caught === 1 ? "mistake" : "mistakes"} caught before anyone saw them.`;
  return `${builds}. Keep going.`;
}
