# Use it inside your AI

You do not need to type factory commands. Add Next-Gen Factory to the AI tool you already
use, then ask for what you want in plain words. The AI plans it, you approve it, the AI
builds it, and the factory proves it.

## Claude Code (recommended)

**1. Install it.** In Claude Code, type:

```
/plugin install factory --marketplace next-generation-collective/factory
```

Or, from a terminal: `claude plugin install factory --marketplace next-generation-collective/factory`

**2. Switch it on.** Type `/reload-plugins`, or start a new Claude Code session.

**3. Just ask.** For example: *"add a discount for orders over 100"*. That is all. The
factory plans it with you, waits for your yes, and proves the result.

You need Node.js 20 or newer on your computer (`node --version` shows it; get it from
[nodejs.org](https://nodejs.org)). The plugin carries the factory itself, so nothing else is
downloaded.

### What you will see

1. A welcome, and one question: may the factory share anonymous counts? Yes or no, your call.
2. The plan, with the questions people usually forget, and what the AI assumed.
3. An approval. Nothing is built until you say yes.
4. The build, the checks and a second AI's review.
5. **Proven by Next-Gen**, and where the proof is saved.

### Handy things to say

| Say or type | What happens |
|---|---|
| `/factory:check` | What your project can prove right now. |
| `/factory:build add a discount` | Starts a proven change: plan, your approval, build, proof. |
| *"stop sharing with Next-Gen"* | Sharing is turned off. Nothing leaves your computer. |
| *"tell Next-Gen it caught a real bug"* | Your feedback opens filled in on GitHub, for you to submit. |

### If something is off

| What you see | What to do |
|---|---|
| Claude says the factory tools are not available | Type `/reload-plugins`. If that does not help, check `node --version` shows 20 or newer. |
| Claude builds without asking for your approval | Type `/factory:build` followed by your request, for example `/factory:build add a discount`. |
| You want the newest version | Type `/plugin`, choose the factory plugin and update it, or run `claude plugin update factory@next-gen`. |

## Cursor, Codex, Gemini CLI and VS Code

These use the same open standard (MCP) and download the factory from npm. They work, but we
have not tested them ourselves yet. Tell us how it goes.

### Cursor

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=factory&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBuZXh0LWdlbmVyYXRpb24tY29sbGVjdGl2ZS9mYWN0b3J5QGxhdGVzdCIsIm1jcCJdfQ==)

Or add this to `.cursor/mcp.json`:

```json
{ "mcpServers": { "factory": { "command": "npx", "args": ["-y", "@next-generation-collective/factory@latest", "mcp"] } } }
```

### Codex

```bash
codex mcp add factory -- npx -y @next-generation-collective/factory@latest mcp
```

### Gemini CLI

```bash
gemini mcp add factory npx -y @next-generation-collective/factory@latest mcp
```

### VS Code

In your project, make a file called `.vscode/mcp.json` with this in it:

```json
{ "servers": { "factory": { "type": "stdio", "command": "npx", "args": ["-y", "@next-generation-collective/factory@latest", "mcp"] } } }
```

Put it in the project, not in your user settings. VS Code starts servers from your user
settings in your home folder, so the factory cannot see your project.

## What happens

1. You ask for a change.
2. The factory sets up the job and your AI writes the plan.
3. **You approve it.** Where your AI tool can show an approval box, you click it there.
   Otherwise your AI shows you the plan and waits for your yes, and the factory records
   your exact words.
4. Your AI builds it.
5. The factory runs your tests and build. Anything that fails goes back to your AI.
6. A separate AI session reviews the change. This needs Claude Code, Codex, Gemini CLI or
   OpenCode installed on your computer; without one, the proof says the review did not run.
7. You get the proof in `specs/` and a one-page report in `.factory/report.md`.

Using the app in a real browser, with screenshots, is not part of the in-chat flow yet. Run
`npx @next-generation-collective/factory verify --app` in a terminal for that step.

## Tested so far

Tested end to end in Claude Code on 2026-10-26: a plain request, the person's approval, the
build, the tests and a separate review. The other tools use the same open standard (MCP)
but have not been tested by us yet. If you try one, tell us how it went in a
[pilot report](https://github.com/next-generation-collective/factory/issues/new?template=pilot-report.yml).
