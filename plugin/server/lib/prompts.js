import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { section } from "./approval.js";
import { paths } from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "template");

export const ROLES = ["planner", "builder", "tester", "reviewer", "shipper"];

export function readRole(root, name) {
  const local = join(paths(root).roles, `${name}.md`);
  const fallback = join(TEMPLATES, "roles", `${name}.md`);
  const file = existsSync(local) ? local : fallback;
  return existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim() : "";
}

export function readTemplate(root, name) {
  const local = join(paths(root).templates, name);
  const fallback = join(TEMPLATES, name);
  const file = existsSync(local) ? local : fallback;
  return existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim() : "";
}

function roleBlock(root) {
  return ROLES.map((name) => {
    const body = readRole(root, name);
    return body ? `## ${name[0].toUpperCase()}${name.slice(1)}\n\n${body}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

const ANSWER_LABELS = {
  problem: "Problem",
  who: "Who feels it",
  outcome: "What working means",
  never: "Must never break",
  people: "Others affected",
  states: "Worries",
  out: "Out of scope",
};

function personBlock(answers) {
  const lines = Object.entries(answers ?? {})
    .filter(([, value]) => String(value ?? "").trim())
    .map(([key, value]) => `- ${ANSWER_LABELS[key] ?? key}: ${String(value).trim()}`);
  return lines.length
    ? lines.join("\n")
    : "The person skipped the questions. Decide, and record every assumption you make.";
}

const QUICK_LANE = `This is a small fix. Keep the spec short: Problem, What must never break, Acceptance
checks (each with its Proof:), Assumptions, Out of scope. Answer States and Expected baseline
only if the fix changes what a person sees; otherwise write one line saying so.`;

export function composeSpecPrompt(root, config, title, target, context = {}) {
  const template = readTemplate(root, "spec.md");
  const brief = context.analysis?.brief?.trim() || "No project files were found.";
  return `You are the Planner for "${config.name}".

Read these before you write anything:
- .factory/constitution.md (the rules; they win over this prompt)
- factory.config.json (what this project is, who depends on it, what must never break)
- the code this job touches

## What the repo already shows

${brief}

## What the person said

${personBlock(context.answers)}

## The job

${title}

## Write the spec here

\`${target}\`

Fill every section of this template from the repo and the job line. Replace every
placeholder.
${context.lane === "quick" ? `\n${QUICK_LANE}\n` : ""}
${template}

## Rules

- Do not ask the person anything now. Decide from the code and the job line.
- Where you had to guess, start the line with \`Assumed:\`. The person reads every one
  before approving.
- Put only the decisions the person must make under Open questions, at most five.
- Every acceptance check must be provable by a machine from a known state, and names its
  proof. "Sending..." on screen is not proof; the result on the other side is.
- Prove acceptance checks with the project's tests (run by the factory) or with something a
  reviewer can see by reading the code. The factory runs the tests, build and checks and
  records the evidence itself. Do not make an acceptance check out of git chores (staging,
  committing, tags) or out of evidence files someone must produce by running commands:
  committing is the person's job after the review.
- If the repo already does part of this, say so and reuse it.
- No code, no plan, no task list.
- Plain language. British/South African spelling. Dates as YYYY-MM-DD.
- Return one line when the file is written, and nothing else.
`;
}

export function composePlanPrompt(root, config, name, specText, target) {
  const template = readTemplate(root, "plan.md");
  return `You are the Planner for "${config.name}".

Read \`.factory/constitution.md\` and \`factory.config.json\` first.

## The approved spec

\`specs/${name}/spec.md\`

${specText}

## Write the plan here

\`${target}\`

Fill in this template. Replace every placeholder.

${template}

## Additional rules

- Walk the reuse ladder in the constitution. Say what already exists and why it was or was
  not used. If you propose a substantial new component, say why rungs 1 to 6 failed.
- State the schema, every index and what it is for, and what would be painful to change
  once real people are in it.
- State who can read or write each thing, where secrets live, and what personal data is
  stored, why, and for how long.
- The plan must not add a state the spec did not answer. If the spec is missing something,
  stop and say what is missing.
- Every acceptance check in the spec gets a row in "One check per acceptance check".
- Plain language. Dates as YYYY-MM-DD.
- Return one line when the file is written, and nothing else.
`;
}

export function composeTasksPrompt(root, config, name, specText, planText, target) {
  const template = readTemplate(root, "tasks.md");
  return `You are the Planner for "${config.name}".

Read \`.factory/constitution.md\` first.

## The approved spec

${specText}

## The plan

${planText}

## Write the task list here

\`${target}\`

Fill in this template. Replace every placeholder.

${template}

## Additional rules

- Every task is a reviewable change with an exact file path.
- Every task says what proves it: \`Proves: <the check that shows the outcome>\`.
  A task whose proof is "it looks right" is not a task.
- Proves: lines name tests or the factory's checks. Do not ask for evidence files made by
  running commands, and do not make staging or committing a task; the factory records the
  evidence and the person commits after the review.
- The last task is: the factory's checks pass.
- Order by risk: the uncertain part first, not last.
- Plain language. Dates as YYYY-MM-DD.
- Return one line when the file is written, and nothing else.
`;
}

export function composeBuildPrompt(root, config, idea, failures, artifacts) {
  const failureBlock =
    failures && failures.length
      ? `\n## What failed last time\n\nThe factory checked your work and these did not pass. Fix them, then continue.\n\n${failures
          .map((r) => `- ${r.title}: ${r.summary}${r.details?.length ? `\n${r.details.map((d) => `  - ${d}`).join("\n")}` : ""}`)
          .join("\n")}\n`
      : "";

  const specBlock = artifacts?.spec
    ? `\n## The approved spec\n\n\`specs/${artifacts.name}/spec.md\`\n\n${artifacts.spec}\n`
    : "";
  const planBlock = artifacts?.plan
    ? `\n## The plan\n\n\`specs/${artifacts.name}/plan.md\`\n\n${artifacts.plan}\n`
    : "";
  const tasksBlock = artifacts?.tasks
    ? `\n## The tasks\n\n\`specs/${artifacts.name}/tasks.md\`\n\nTick each box only when its proof passes.\n\n${artifacts.tasks}\n`
    : "";

  return `You are the engineering team for "${config.name}".

Read these before you start:
- .factory/constitution.md (the rules)
- factory.config.json (what this project is and who depends on it)
- the code already in this project
${specBlock}${planBlock}${tasksBlock}
${roleBlock(root)}

## The job

${idea}
${failureBlock}
## How to work

- Work through the tasks in order. Tick a box only when its proof passes.
- Small changes. Walk the reuse ladder before writing anything new.
- Run the project's own tests and build as you go.
- Never leave a secret, key or password in a file.
- If the job touches personal data, say what data, why, and where it is stored.
- Do not add a dependency if the project already has a way to do it.
- If something is unclear, ask one question and stop. Do not guess.

## When you believe it is done

Stop. Do not announce success. As soon as you finish, the factory runs the project's tests,
build and checks itself (\`factory verify --deep\`) and decides. If you are not allowed to
run commands here, that is expected: do not ask the person to run them, and do not list
commands for them. Say in a few lines what you changed, what you ran, and anything only the
person can do (for example, changing a leaked key).

If a check fails, you will be given the failure and asked to fix it.
`;
}

function constitutionText(root) {
  const local = join(paths(root).dir, "constitution.md");
  const file = existsSync(local) ? local : join(TEMPLATES, "constitution.md");
  return existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
}

function checkLines(run) {
  if (!run?.results) return "The factory has not run its checks yet.";
  return run.results
    .map((result) => `- ${result.title}: ${result.status === "accepted" ? "BY DESIGN" : result.status.toUpperCase()}. ${result.summary}`)
    .join("\n");
}

// The reviewer is a separate agent run. It sees the change, the approved spec and the
// rules, never the builder's prompt or reasoning.
export function composeReviewPrompt(root, config, { artifacts, change, reviewFile, run }) {
  const rules = readTemplate(root, "review-rules.md").replaceAll("{{reviewFile}}", reviewFile);
  const traps = section(constitutionText(root), "Known traps");
  const changeBlock = change.text
    ? `\`\`\`diff\n${change.text}\n\`\`\``
    : `The change is too large to paste. Read these files yourself:\n\n${change.files.map((file) => `- ${file}`).join("\n")}`;

  return `You are the Reviewer for "${config.name}". You did not write this change.

## Your role

${readRole(root, "reviewer")}

${rules}

## Known traps

${traps || "None recorded."}

## The approved spec

${artifacts?.spec ? `\`specs/${artifacts.name}/spec.md\`\n\n${artifacts.spec}` : "There is no approved spec (a hotfix). Review the change against the rules only, and write \"No spec\" under Acceptance checks."}
${artifacts?.tasks ? `\n## The task list\n\n${artifacts.tasks}\n` : ""}
## What the factory's own checks found

These ran after the build, outside the builder's control. You may cite them as evidence.

${checkLines(run)}

## The change

${change.stat ? `\`\`\`\n${change.stat}\`\`\`\n\n` : ""}${changeBlock}

Write the review file, then return one line saying it is written, and nothing else.
`;
}

const DRIVER_STEPS = {
  mcp: (info, url, dir) => `The app is running at ${url}. Open it with your ${info.driver} browser tools (server "${info.server}").
For each check: do the steps a person would, then check the result where it lands (reload
the page, read the record back, look as the other account when it matters). Save one
screenshot of the result with the screenshot tool's save option, to
\`${dir}/<check>-<a-few-words>.png\` (for example \`${dir}/AC1-booking-saved.png\`).`,
  playwright: (info, url, dir) => `The app is running at ${url}. Run the project's Playwright tests that cover these checks
with \`npx playwright test <file>\`. If a check has no test, add one next to the existing
browser tests. In each test, check the result where it lands, not only the screen, and
save a screenshot of the result with \`page.screenshot({ path: "${dir}/<check>-<a-few-words>.png" })\`.`,
  maestro: (info, url, dir) => `A simulator must already be running with the app installed; if it is not, write that in
journeys.md and stop. Run the flows that cover these checks with \`maestro test <flow>\`
(or \`./scripts/e2e.sh <flow>\` when the project has it), and add a \`takeScreenshot\` step
saving to \`${dir}\` where a flow has none. Save each flow's output to \`${dir}/<check>.txt\`
and use that file, or the screenshot, in the Screenshot column.`,
};

// The tester: a separate run after the checks pass, that uses the app the way a person
// does and leaves a screenshot for every claim.
export function composeJourneyPrompt(root, config, { info, url, artifacts, dir }) {
  const steps = (info.driver.endsWith("-mcp") ? DRIVER_STEPS.mcp : DRIVER_STEPS[info.driver])(info, url, dir);
  return `You are the Tester for "${config.name}". The code is written and the factory's checks
passed. Now use the app the way a person would, and prove each acceptance check a person can
see.

## Your role

${readRole(root, "tester")}

## The approved spec

\`specs/${artifacts.name}/spec.md\`

${artifacts.spec}

## How to use the app

${steps}

## Write this file

\`${dir}/journeys.md\`

\`\`\`
| Check | Steps | What you saw | Result | Screenshot |
|---|---|---|---|---|
| AC1 | opened /book, picked 10:00, pressed Book, reloaded | the booking is listed after reload | PASS | ${dir}/AC1-booking-saved.png |
\`\`\`

- Result is PASS or FAIL. PASS needs the screenshot file to exist.
- A check a person cannot see (a log line, a header, a database rule) is not a journey;
  leave it out. If nothing in the spec is visible to a person, write one row:
  \`| none | | nothing a person sees changed | SKIP | |\`
- Do not change the app's code in this step. If something is broken, mark it FAIL and say
  what you saw.

Return one line when journeys.md is written, and nothing else.
`;
}
