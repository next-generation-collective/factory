import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { colors, rel } from "./util.js";
import { ensure, paths, readConfig, writeState } from "./config.js";
import { detectStack } from "./detect.js";
import { acceptedRegister, runChecks } from "./checks.js";
import { SPECS_DIR } from "./spec.js";

export function label(result) {
  if (result.status === "na") return "N/A";
  if (result.status === "not-run") return "NOT RUN";
  if (result.status === "accepted") return "BY DESIGN";
  if (result.status === "pass") return result.kind === "flagged" ? "OK" : "PASS";
  return result.kind === "flagged" ? "LOOK" : "FAIL";
}

export function paintLabel(result) {
  const text = label(result).padEnd(9);
  if (result.status === "fail" && result.kind === "proven") return colors.red(text);
  if (result.status === "fail") return colors.yellow(text);
  if (result.status === "pass") return colors.green(text);
  return colors.dim(text);
}

// Where a spec's proof lives: in the spec folder, committed with the code. Without an
// active spec there is nowhere shared to put it, so it stays in .factory/.
export function specEvidenceDir(root, config) {
  const name = config?.spec?.active;
  if (!name || !existsSync(join(root, SPECS_DIR, name))) return null;
  return join(root, SPECS_DIR, name, "evidence");
}

// save: false computes the result and writes nothing into the project. Command logs from
// a deep pass go to the system temp folder instead.
export function verify(root, { deep = false, config, save = true } = {}) {
  const cfg = config ?? readConfig(root);
  const detected = detectStack(root);
  const stack = { ...detected };
  if (stack.kind === "other" && cfg.kind && cfg.kind !== "other") stack.kind = cfg.kind;
  const p = paths(root);
  const logDir = save ? ensure(root).evidence : null;
  const started = Date.now();
  const results = runChecks(root, { deep, config: cfg, stack, logDir });
  const minutes = Math.max(0, Math.round((Date.now() - started) / 60000));
  const notes = acceptedRegister(cfg).notes;
  const ok = !results.some((result) => result.kind === "proven" && result.status === "fail");
  const at = new Date().toISOString();
  const result = {
    at,
    deep,
    ok,
    minutes,
    project: cfg.name,
    kind: stack.kind,
    notes,
    results,
  };
  if (!save) return { ...result, saved: false, jsonFile: null, mdFile: null };

  const stamp = at.replace(/[:.]/g, "-");
  const jsonFile = join(p.evidence, `verify-${stamp}.json`);
  let mdFile = join(p.evidence, `verify-${stamp}.md`);
  const specDir = specEvidenceDir(root, cfg);
  const stored = { ...result, jsonFile: rel(root, jsonFile), mdFile: rel(root, mdFile) };

  if (specDir) {
    mkdirSync(specDir, { recursive: true });
    mdFile = join(specDir, "verify-latest.md");
    stored.mdFile = rel(root, mdFile);
    writeFileSync(join(specDir, "verify-latest.json"), `${JSON.stringify(stored, null, 2)}\n`);
  }

  writeFileSync(jsonFile, `${JSON.stringify(stored, null, 2)}\n`);
  writeFileSync(join(p.evidence, `verify-${stamp}.md`), renderEvidence(root, stored));
  if (specDir) writeFileSync(mdFile, renderEvidence(root, stored));
  writeFileSync(p.lastVerify, `${JSON.stringify(stored, null, 2)}\n`);
  writeState(root, { lastVerify: at, lastOk: ok });

  return {
    ...stored,
    saved: true,
    jsonFile,
    mdFile,
    jsonRel: stored.jsonFile,
    mdRel: stored.mdFile,
  };
}

export function renderEvidence(root, run) {
  const lines = [
    `# Verification: ${run.project}`,
    "",
    `${new Date(run.at).toLocaleString()}: ${run.deep ? "deep pass (tests and build run)" : "fast pass"}`,
    "",
    "| Check | Result | Kind | What it found |",
    "|---|---|---|---|",
    ...run.results.map(
      (result) => `| ${result.title} | ${label(result)} | ${result.kind} | ${result.summary} |`,
    ),
    ...(run.notes?.length ? ["", ...run.notes.map((note) => `> ${note}`)] : []),
    "",
    "## Details",
    "",
  ];

  for (const result of run.results) {
    lines.push(`### ${result.title}: ${label(result)}`, "");
    if (!result.details.length) lines.push(result.summary, "");
    else {
      for (const detail of result.details) lines.push(`- ${detail}`);
      lines.push("");
    }
    if (result.evidence.length) {
      lines.push(`Evidence: ${result.evidence.map((file) => `[${file}](${file})`).join(", ")}`, "");
    }
  }

  lines.push(
    "## What this does not prove",
    "",
    "- It does not prove the software is correct or free of bugs.",
    "- It does not prove compliance with POPIA or any other law.",
    "- It does not know whether the design is good or the words are clear.",
    "",
  );

  return lines.join("\n");
}

export function formatResults(root, run, { header = true } = {}) {
  const lines = header
    ? [colors.bold(`factory verify: ${run.project}`) + colors.dim(`  ${run.deep ? "deep pass" : "fast pass"}`), ""]
    : [];
  const width = Math.max(...run.results.map((result) => result.title.length));

  for (const result of run.results) {
    lines.push(`  ${paintLabel(result)} ${result.title.padEnd(width)}   ${result.summary}`);
    if (result.status === "fail" && result.kind === "proven" && result.details.length > 1) {
      for (const detail of result.details.slice(0, 4)) lines.push(colors.dim(`             ${detail}`));
    }
  }
  for (const note of run.notes ?? []) lines.push(colors.yellow(`  ${note}`));

  const failed = run.results.filter((result) => result.kind === "proven" && result.status === "fail");
  const look = run.results.filter((result) => result.kind === "flagged" && result.status === "fail");

  lines.push("");
  if (failed.length) {
    lines.push(colors.red(`NOT DONE: ${failed.length} ${failed.length === 1 ? "check" : "checks"} failed.`));
  } else {
    lines.push(colors.green("PASSED: the checks that ran found no proven problem."));
  }
  if (look.length) lines.push(colors.yellow(`${look.length} ${look.length === 1 ? "thing" : "things"} for a person to look at.`));
  if (run.jsonFile) lines.push(colors.dim(`Evidence: ${rel(root, run.mdFile ?? run.jsonFile)}`));

  return lines.join("\n");
}
