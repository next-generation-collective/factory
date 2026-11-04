import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = new Set([
  "next", "nuxt", "svelte", "sveltekit", "astro", "remix", "vite", "react",
  "react-dom", "vue", "angular", "@angular/core", "solid-js", "gatsby",
]);

const API = new Set(["express", "fastify", "koa", "hono", "@hapi/hapi", "nest", "@nestjs/core"]);

const BUILD_DIRS = ["dist", "build", "out", ".next/static", "public/build"];

// .next/static is left behind by `next dev` too; only a production build writes BUILD_ID.
export function buildOutputDirs(root, base = "") {
  return BUILD_DIRS.filter((name) => {
    const dir = join(root, base, name);
    if (!existsSync(dir)) return false;
    return name !== ".next/static" || existsSync(join(root, base, ".next", "BUILD_ID"));
  }).map((name) => (base ? `${base}/${name}` : name));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function jsPackageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

function pythonPackageManager(root) {
  if (existsSync(join(root, "uv.lock"))) return "uv";
  if (existsSync(join(root, "poetry.lock"))) return "poetry";
  return "pip";
}

function pythonTestCommand(root, pm) {
  if (pm === "uv") return "uv run pytest -q";
  if (pm === "poetry") return "poetry run pytest -q";
  const windows = process.platform === "win32";
  const venv = windows ? join(".venv", "Scripts", "python") : join(".venv", "bin", "python");
  if (existsSync(join(root, venv)) || existsSync(join(root, `${venv}.exe`))) return `${venv} -m pytest -q`;
  return `${windows ? "python" : "python3"} -m pytest -q`;
}

function isPlaceholder(script) {
  return !script || /no test specified|no build specified/i.test(script);
}

// One package: what kind of project it is, from its package.json or language files.
function detectOne(dir, pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const has = (name) => Boolean(deps[name]);

  if (has("expo")) return { kind: "mobile", framework: "expo", language: "javascript" };
  if (has("react-native")) return { kind: "mobile", framework: "react-native", language: "javascript" };
  if (has("next")) return { kind: "web", framework: "next", language: "javascript" };
  if (has("nuxt")) return { kind: "web", framework: "nuxt", language: "javascript" };
  if (has("@angular/core")) return { kind: "web", framework: "angular", language: "typescript" };
  if (has("svelte") || has("sveltekit")) return { kind: "web", framework: "svelte", language: "javascript" };
  if (has("astro")) return { kind: "web", framework: "astro", language: "javascript" };
  if ([...WEB].some(has)) return { kind: "web", framework: [...WEB].find(has), language: "javascript" };
  if ([...API].some(has)) return { kind: "api", framework: [...API].find(has), language: "javascript" };
  if (pkg) return { kind: pkg.bin ? "cli" : "script", framework: null, language: "javascript" };

  if (existsSync(join(dir, "index.html"))) return { kind: "web", framework: "static", language: "html" };
  if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "requirements.txt"))) {
    return { kind: "script", framework: "python", language: "python" };
  }
  if (existsSync(join(dir, "go.mod"))) return { kind: "api", framework: "go", language: "go" };
  if (existsSync(join(dir, "Cargo.toml"))) return { kind: "script", framework: "rust", language: "rust" };
  return { kind: "other", framework: null, language: null };
}

function workspacePatterns(root, pkg) {
  const fromPkg = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  if (Array.isArray(fromPkg)) return fromPkg;
  const pnpm = join(root, "pnpm-workspace.yaml");
  if (!existsSync(pnpm)) return [];
  return [...readFileSync(pnpm, "utf8").matchAll(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/gm)].map((m) => m[1]);
}

// Expands "apps/*" and "packages/web" style patterns. Deeper globs are skipped.
export function findWorkspaces(root, pkg) {
  const found = [];
  for (const pattern of workspacePatterns(root, pkg)) {
    if (pattern.startsWith("!")) continue;
    const clean = pattern.replace(/\/+$/, "");
    if (clean.endsWith("/*") && !clean.slice(0, -2).includes("*")) {
      const base = clean.slice(0, -2);
      if (!isDir(join(root, base))) continue;
      for (const name of readdirSync(join(root, base)).sort()) {
        const rel = `${base}/${name}`;
        if (existsSync(join(root, rel, "package.json"))) found.push(rel);
      }
    } else if (!clean.includes("*") && existsSync(join(root, clean, "package.json"))) {
      found.push(clean);
    }
  }
  return [...new Set(found)];
}

const PRIMARY_ORDER = ["mobile", "web", "api", "cli", "script"];

// Work with a screen gets the full states ritual; everything else gets the states that
// actually exist for it, and an honest list of what cannot be checked.
export function hasScreens(kind) {
  return kind === "web" || kind === "mobile";
}

export function detectStack(root) {
  const pkg = existsSync(join(root, "package.json")) ? readJson(join(root, "package.json")) : null;
  const scripts = pkg?.scripts ?? {};

  const workspaces = findWorkspaces(root, pkg).map((path) => {
    const wpkg = readJson(join(root, path, "package.json"));
    return { path, pkg: wpkg, ...detectOne(join(root, path), wpkg) };
  });

  const own = detectOne(root, pkg);
  let primary = null;
  if (workspaces.length) {
    for (const kind of PRIMARY_ORDER) {
      primary = workspaces.find((w) => w.kind === kind);
      if (primary) break;
    }
    primary = primary ?? workspaces[0];
  }

  const base = primary ?? own;
  const language = base.language;
  const packageManager =
    language === "python" ? pythonPackageManager(root)
      : language === "go" ? "go"
        : language === "rust" ? "cargo"
          : language ? jsPackageManager(root) : null;

  let testCommand = null;
  let buildCommand = null;
  let commandCwd = null;
  const primaryScripts = primary?.pkg?.scripts ?? {};

  if (!isPlaceholder(scripts.test)) testCommand = `${packageManager} test`;
  else if (primary && !isPlaceholder(primaryScripts.test)) {
    testCommand = `${packageManager} test`;
    commandCwd = primary.path;
  } else if (language === "python") {
    const hasTests = ["tests", "test", "pytest.ini"].some((name) => existsSync(join(root, name)));
    if (hasTests) testCommand = pythonTestCommand(root, packageManager);
  } else if (language === "go") testCommand = "go test ./...";
  else if (language === "rust") testCommand = "cargo test";

  if (!isPlaceholder(scripts.build)) buildCommand = `${packageManager} run build`;
  else if (primary && !isPlaceholder(primaryScripts.build)) {
    buildCommand = `${packageManager} run build`;
    commandCwd = commandCwd ?? primary.path;
  } else if (language === "go") buildCommand = "go build ./...";
  else if (language === "rust") buildCommand = "cargo build";

  const buildDirs = buildOutputDirs(root);
  if (primary) buildDirs.push(...buildOutputDirs(root, primary.path));

  return {
    kind: base.kind,
    framework: base.framework,
    language,
    packageManager,
    testCommand,
    buildCommand,
    commandCwd,
    buildDirs,
    hasPackageJson: Boolean(pkg),
    workspaces: workspaces.map(({ path, kind, framework }) => ({ path, kind, framework })),
    primary: primary?.path ?? null,
  };
}
