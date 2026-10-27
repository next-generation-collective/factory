import { banner } from "./banner.js";
import { serve } from "./mcp.js";
import { notAProjectFolder } from "./util.js";
import { feedbackUrl, guessFeeling, needsAnswer, send, setSharing, settings, SHARE_QUESTION, sharing, blockedByEnvironment } from "./telemetry.js";
import { spawn } from "node:child_process";
import { createInterface as askLine } from "node:readline/promises";
import { createRequire } from "node:module";
import {
  approveCommand,
  build,
  reviewCommand,
  doctor,
  init,
  lessonNew,
  planCommand,
  report,
  specCommand,
  start,
  status,
  tasksCommand,
  verifyCommand,
} from "./commands.js";

const VERSION = createRequire(import.meta.url)("../package.json").version;

const COMMANDS = new Set([
  "init", "spec", "approve", "plan", "tasks", "verify", "build", "review", "report",
  "lesson", "status", "doctor", "help", "version", "mcp", "share", "feedback",
]);

const VALUE_FLAGS = new Set([
  "attempts", "out", "name", "kind", "who", "never-break", "data", "agent",
  "title", "what", "spot", "check", "example", "sa", "south-africa", "by", "base",
]);

function parse(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (VALUE_FLAGS.has(body) && argv[i + 1] && !argv[i + 1].startsWith("-")) {
        flags[body] = argv[++i];
        continue;
      }
      flags[body] = true;
      continue;
    }
    positional.push(token);
  }

  return { flags, positional };
}

function help() {
  console.log(`factory: a team of AI engineers that cannot say done without proof.

Start here
  factory                         what this project can prove, in about a second;
                                  then it offers to fix the top problem it found
  factory "what to change"        writes the spec from your code, you approve it,
                                  then it plans, builds and checks

Steps, if you want them one at a time
  factory spec "what to change"   write the spec
  factory approve [name]          read what matters in the spec, then approve it
  factory build                   plan, tasks, build and check the approved spec;
                                  a separate session then reviews the change
  factory review [--base=ref]     the independent review on its own
  factory verify [--deep]         the checks on their own (--deep runs tests and build)
  factory verify --app            use the app against the approved spec, with screenshots
  factory report                  one-page handover
  factory status                  the active spec and the last checks
  factory doctor                  what was detected, which agent, which checks apply
  factory lesson new              turn a real failure into a dated lesson
  factory init                    answer five questions to fill factory.config.json
  factory mcp                     run inside Claude Code, Cursor, Codex, Gemini or VS Code
  factory share on|off            share anonymous counts with Next-Gen, or stop
  factory feedback "..."          tell Next-Gen in one line what was good or wrong

Options
  --ask         ask all seven questions before writing the spec
  --deep        run the project's tests and build
  --json        machine-readable output (verify)
  --print       print the prompt instead of running an agent; writes nothing
  --by=name     who approved it (default: your saved name or git name)
  --yes         approve without the terminal prompt (approve)
  --force       rewrite an existing plan or task list
  --hotfix      build without an approved spec; recorded in the evidence
  --attempts=N  how many times to send failures back (default 2)

Nothing is written into your project until you start a job. Nothing is called
done until the checks pass, and it never says "bug-free" or "compliant".`);
}

function feedbackCommand(text) {
  if (!text.trim()) {
    console.error('Tell us in one line, for example: factory feedback "it caught a secret I missed"');
    return 1;
  }
  const feeling = guessFeeling(text);
  const url = feedbackUrl(text, feeling);
  send("feedback", { feeling: feeling ?? "other" }, VERSION);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser here; the link below still works.
  }
  console.log("Thank you. Your feedback is filled in on GitHub; check it and press Submit:");
  console.log(url);
  return 0;
}

function shareCommand(choice) {
  if (choice === "on" || choice === "off") {
    setSharing(choice === "on");
    console.log(choice === "on" ? "Sharing anonymous counts. Thank you. Turn it off any time: factory share off" : "Not sharing. Nothing leaves this computer.");
    return 0;
  }
  if (blockedByEnvironment()) console.log("Not sharing: this computer says do not track, or it is a build server.");
  else if (settings().share === undefined) console.log("You have not chosen yet. factory share on, or factory share off.");
  else console.log(sharing() ? "Sharing anonymous counts. Turn it off: factory share off" : "Not sharing. Turn it on: factory share on");
  console.log("What is shared, exactly: https://github.com/next-generation-collective/factory/blob/main/docs/TELEMETRY.md");
  return 0;
}

export { notAProjectFolder };

export async function main(argv) {
  const { flags, positional } = parse(argv);
  const root = process.cwd();
  const [command, ...rest] = positional;

  if (flags.version || command === "version") {
    console.log(`factory ${VERSION}`);
    return 0;
  }

  if (flags.help || command === "help") {
    help();
    return 0;
  }

  if (!command || (!COMMANDS.has(command) && (rest.length > 0 || /\s/.test(command)))) {
    const refusal = notAProjectFolder(root);
    if (refusal) {
      console.error(refusal);
      return 1;
    }
    if (process.stdout.isTTY) console.log(banner(VERSION, root));
    if (process.stdout.isTTY && process.stdin.isTTY && needsAnswer()) {
      const line = askLine({ input: process.stdin, output: process.stdout });
      const answer = await line.question(`${SHARE_QUESTION} (y/N) `);
      line.close();
      setSharing(/^y(es)?$/i.test(answer.trim()));
      send("share", { ok: sharing() }, VERSION);
      console.log("");
    }
    send("run", { mode: "cli" }, VERSION);
  }

  if (!command) return start(root, flags);

  if (!COMMANDS.has(command)) {
    const asJob = rest.length > 0 || /\s/.test(command);
    if (asJob) return start(root, { ...flags, idea: positional.join(" ") });
    console.error(`Unknown command: ${command}`);
    console.error("Run: factory --help");
    return 1;
  }

  switch (command) {
    case "share":
      return shareCommand(rest[0]);
    case "feedback":
      return feedbackCommand(rest.join(" "));
    case "mcp":
      return serve(VERSION, root);
    case "init":
      return init(root, flags);
    case "spec":
      return specCommand(root, flags, rest);
    case "review":
      return reviewCommand(root, flags);
    case "approve":
      return approveCommand(root, flags, rest);
    case "plan":
      return planCommand(root, flags);
    case "tasks":
      return tasksCommand(root, flags);
    case "verify":
      return verifyCommand(root, flags);
    case "build":
      return build(root, { ...flags, idea: rest.join(" ") });
    case "report":
      return report(root, flags);
    case "status":
      return status(root);
    case "doctor":
      return doctor(root);
    case "lesson":
      if (rest[0] !== "new") {
        console.error("Use: factory lesson new");
        return 1;
      }
      return lessonNew(root, flags);
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run: factory --help");
      return 1;
  }
}
