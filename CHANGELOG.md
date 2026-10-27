# Changelog

Newest first. Dates are YYYY-MM-DD.

## 0.5.1 (2026-10-27, in the Claude Code plugin)

### Fixed

- Inside your AI, the factory no longer freezes your session. Checks, proofs and reviews run
  in their own process, so your AI can keep talking to the factory, and stopping a call stops
  the work too, including any tests or review it started. You still get the result when it
  finishes.
- Opened in your home folder or the top of your disk, the factory says so at once instead of
  reading every file on the computer (that took minutes).
- The Claude Code commands are now `/factory:check` and `/factory:build`, instead of one
  command that showed as `/factory:factory`.

## 0.5.0 (2026-10-27, in the Claude Code plugin; npm to follow)

### Added

- Your progress: "Welcome back" now shows your proven builds and the mistakes the factory
  caught for you this week. Kept on your computer only.
- Anonymous counts, only if you say yes: asked once, `factory share on|off` to change.
  Never code, file names or personal details. See `docs/TELEMETRY.md`.
- Inside your AI: `factory_share`, so your AI asks you the same question once.
- `factory feedback "..."`: one line of feedback opens a filled-in GitHub form for you to submit.
  Inside your AI, `factory_feedback` does the same, and your AI asks once after a proven build
  whether the factory was useful.
- The Claude Code plugin now carries the factory inside it, so it updates with every release on
  GitHub and no longer downloads anything from npm.
- Claude Code plugin: tells Claude at the start of every session to use the factory for any
  change, after a real test where a plain request skipped it.

## 0.4.0 (2026-10-26)

### Added

- Inside your AI: `factory mcp` lets Claude Code, Cursor, Codex, Gemini CLI and VS Code use
  the factory directly. Ask for a change in plain words; the AI starts the job, you approve
  the plan, it builds, and the factory proves it. See `docs/USE-IN-YOUR-AI.md`.
- A Claude Code plugin, installed with one line, with a `/factory` command.
- Approval stays with the person: through the AI tool's approval box where it has one,
  otherwise the person's own words are recorded with the approval.

## 0.3.2 (2026-10-26)

### Added

- A welcome in the terminal: the NG mark in gold, and a greeting by your first name (from
  your git settings). The first time: "Welcome to Next-Gen Factory. You are one of the
  builders of the AI economy." After that: "Welcome back." A one-line file in
  `~/.config/next-gen/` remembers the first visit; nothing is sent anywhere.

## 0.3.1 (2026-10-26)

### Fixed

- Run from your home folder or the top of the disk, the factory read every file on the
  computer and showed nothing for minutes. It now says in plain words to go into a project
  folder first.
- It says "Reading your project..." straight away, so you know it has started.
- Plain wording in its messages: no em dashes, and "1 thing" or "2 things" instead of
  "thing(s)".

## 0.3.0 (2026-10-26)

The first public release, as `@next-generation-collective/factory`.

### Added

- `factory` with no arguments shows what the project can prove in about a second, with no
  questions, no account and nothing written into the project, then offers to fix the top
  problem it found.
- The fix offer: one key runs the whole loop on a real problem (a credential in the code, a
  tracked `.env`, tests that check nothing, no tests) and ends with a summary to paste.
- `factory approve`: shows the decisions left to you, the AI's guesses, the states covered
  and the proofs, then records the approval.
- An independent review in a separate session after every build, with a verdict for every
  acceptance check. `factory review` runs it alone. Method adapted from Otta (MIT).
- Using the app: websites through Playwright or the Chrome or Firefox DevTools MCP server,
  phone apps through Maestro; a screenshot for every journey. `factory verify --app`.
- Presets for Claude Code, Codex, Gemini CLI and OpenCode; the installed one is found.
- Monorepo detection; Python projects use their own test runner.
- CI on macOS, Linux and Windows with Node 20, 22 and 24.

### Changed

- Specs are written from the code; the tool asks nothing except two questions for jobs
  about login, money, personal data and similar. `--ask` asks all seven.
- Secrets: real credentials fail; test and dev passwords are flagged for a person.
- A test command that cannot start is "not run", never a failure.
- Proof is saved in `specs/<name>/evidence/`, committed with the code.
- The spec, plan and task templates are the factory's own (no more "tests are optional").
- The prompt reaches the agent on stdin or as a file, not on the command line.
- Agents may edit files in the project but not run commands, unless you allow it; the
  factory runs the checks.

### Removed

- The five-question setup before the first run.
- The `lessons/_template.md` file the first run used to add to every project.

## 0.2.0 (2026-10-22)

The spec gate, the build loop with seven checks, the report and lessons. Not published.
