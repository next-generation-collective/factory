import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { AGENT_ORDER, PRESETS } from "./agents.js";
import { ensure } from "./config.js";

const WINDOWS = process.platform === "win32";
const SAFE_COMMAND = /^[A-Za-z0-9._:/\\ ()-]+$/;
const INLINE_LIMIT = 30000;
const probes = new Map();

// factory.config.json is trusted like a package.json script, but a command name with
// shell syntax in it is refused, because Windows runs agents through the shell.
export function safeCommand(command) {
  return typeof command === "string" && SAFE_COMMAND.test(command);
}

function quoteForWindows(arg) {
  if (/^[A-Za-z0-9._:/\\=@+-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

// Windows: an .exe starts directly; a .cmd or .bat (how npm installs claude, codex and
// gemini) needs the shell, so its path is quoted. Elsewhere, start it directly.
function launch(command) {
  if (!WINDOWS) return { file: command, shell: false };
  let full = command;
  if (!/[\\/]/.test(command)) {
    const exts = /\.[a-z]+$/i.test(command) ? [""] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      const hit = exts.map((ext) => join(dir, command + ext)).find((candidate) => existsSync(candidate));
      if (hit) {
        full = hit;
        break;
      }
    }
  }
  if (/\.(?:cmd|bat)$/i.test(full)) return { file: quoteForWindows(full), shell: true };
  return { file: full, shell: false };
}

function probe(command) {
  if (!probes.has(command)) {
    const { file, shell } = launch(command);
    const run = spawnSync(file, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
      shell,
    });
    const first = String(run.stdout ?? "").trim().split("\n")[0];
    probes.set(command, run.status === 0 ? first || "found" : null);
  }
  return probes.get(command);
}

export function agentVersion(config) {
  const command = config?.agent?.command;
  return safeCommand(command) ? probe(command) : null;
}

export function agentAvailable(config) {
  return agentVersion(config) != null;
}

// The first coding agent installed on this machine, with its preset, or null.
export function detectAgent() {
  for (const name of AGENT_ORDER) {
    if (probe(name) != null) return { ...PRESETS[name], args: [...PRESETS[name].args] };
  }
  return null;
}

export function agentInvocation(args, prompt, promptFile) {
  const list = (args ?? []).map(String);
  const inline = list.some((arg) => arg.includes("{prompt}"));
  const usesFile = list.some((arg) => arg.includes("{promptFile}"));
  return {
    args: list.map((arg) => arg.replaceAll("{promptFile}", promptFile ?? "").replaceAll("{prompt}", prompt)),
    stdin: inline || usesFile ? null : prompt,
    inline,
  };
}

// Returns { ok, capped }. A capped run was stopped at checks.agentMinutes: it is never
// ok, and every caller must fail its step instead of carrying on as if it finished.
export function runAgent(root, prompt, config, promptFile) {
  const command = config.agent.command;
  if (!safeCommand(command)) {
    console.error(`Refusing to run agent.command "${command}": use the program's name or path only.`);
    return { ok: false, capped: false };
  }

  const call = agentInvocation(config.agent.args, prompt, promptFile);
  if (call.inline && WINDOWS) {
    console.error("{prompt} in agent.args does not work on Windows. Remove it and the prompt goes on stdin.");
    return { ok: false, capped: false };
  }
  if (call.inline && prompt.length > INLINE_LIMIT) {
    console.error(
      `Warning: the prompt is ${prompt.length} characters on the command line. Remove {prompt} from agent.args to send it on stdin.`,
    );
  }

  const { file, shell } = launch(command);
  const options = { cwd: root, shell, maxBuffer: 64 * 1024 * 1024 };
  // Inside an AI tool, our stdout is the conversation with that tool. The agent's own
  // output goes to stderr there, so it can never corrupt it.
  const out = process.env.FACTORY_MCP ? 2 : "inherit";
  if (call.stdin != null) {
    options.input = call.stdin;
    options.stdio = ["pipe", out, "inherit"];
  } else {
    options.stdio = ["inherit", out, "inherit"];
  }
  const args = shell ? call.args.map(quoteForWindows) : call.args;
  // A run that drags on is stopped at the cap and reported as not finished, never as
  // passed. checks.agentMinutes in factory.config.json moves the cap.
  const minutes = Number(config?.checks?.agentMinutes ?? 30);
  if (minutes > 0) options.timeout = minutes * 60 * 1000;
  const run = spawnSync(file, args, options);
  if (run.error?.code === "ETIMEDOUT" || (minutes > 0 && run.status === null && run.signal)) {
    console.error(`The agent was stopped at the ${minutes} minute cap (checks.agentMinutes); the run is not finished.`);
    return { ok: false, capped: true };
  }
  return { ok: run.status === 0, capped: false };
}

export function savePrompt(root, name, prompt) {
  const p = ensure(root);
  const file = join(p.prompts, `${name}.md`);
  writeFileSync(file, prompt);
  return file;
}
