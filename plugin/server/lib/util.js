import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, extname, parse as parse_, resolve } from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  ".factory",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "Pods",
  ".expo",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".idea",
  ".vscode",
]);

const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".tar", ".mp4", ".mov", ".mp3", ".wav", ".woff", ".woff2", ".ttf", ".eot",
  ".so", ".dylib", ".dll", ".exe", ".class", ".jar", ".lock", ".map",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "composer.lock",
]);

const MAX_BYTES = 1024 * 1024;

export function walk(root, { skipDirs = SKIP_DIRS } = {}) {
  const files = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) visit(full);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        if (!SKIP_EXT.has(extname(entry.name).toLowerCase())) files.push(full);
      }
    }
  };
  visit(root);
  return files;
}

export function readText(file) {
  try {
    if (statSync(file).size > MAX_BYTES) return null;
    const text = readFileSync(file, "utf8");
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

export function isTestFile(file) {
  const name = file.split(/[\\/]/).pop();
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /_test\.(?:py|go)$/.test(name) ||
    /[\\/]__tests__[\\/].*\.[cm]?[jt]sx?$/.test(file)
  );
}

// Forward slashes on every machine, so reports and committed evidence read the same.
export function rel(root, file) {
  return (relative(root, file) || file).split("\\").join("/");
}

export const colors = {
  enabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  paint(code, text) {
    return this.enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text);
  },
  green: (t) => colors.paint("32", t),
  red: (t) => colors.paint("31", t),
  yellow: (t) => colors.paint("33", t),
  dim: (t) => colors.paint("2", t),
  bold: (t) => colors.paint("1", t),
};

// 1,695 on every machine, whatever the locale data Node was built with.
export function formatCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function plural(n, word) {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}

// Your home folder or the top of the disk is never one project. Reading it means reading
// every file on the computer, which takes minutes and shows nothing.
export function notAProjectFolder(root, home = homedir()) {
  const here = resolve(root);
  if (here !== resolve(home) && here !== parse_(here).root) return null;
  return [
    `This is ${here === resolve(home) ? "your home folder" : "the top of your disk"}, not a project.`,
    "Go into a project folder first, then run it again. For example:",
    "",
    "  cd my-project",
    "  npx @next-generation-collective/factory",
  ].join("\n");
}
