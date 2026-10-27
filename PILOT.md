# Try the factory in 10 minutes

Thank you for trying it early. You are a **Founding Builder**: what you build with the
factory, and every lesson you share, becomes the proof that opens jobs and funding for the
young builders after you. [Why that matters](MOVEMENT.md).

This page is everything you need. What you report shapes what we build next.

## What you need

- Node.js 20 or newer (`node --version`).
- A project of yours: a website, a phone app, an API, or a script. It does not need to be
  finished.
- For step 2 only: an AI coding tool, signed in. Claude Code works best; Codex, Gemini CLI
  and OpenCode work too.

## Step 0: put it inside your AI (1 minute, recommended)

In Claude Code, type this once, then `/reload-plugins`:

```
/plugin install factory --marketplace next-generation-collective/factory
```

From then on you just ask for what you want, in plain words. Needs Node.js 20 or newer.
Cursor, Codex, Gemini CLI and VS Code: [one line each](docs/USE-IN-YOUR-AI.md). The steps
below work either way: in your AI's chat, or in a terminal.

## Step 1: what your project can prove (1 minute)

In Claude Code, type `/factory:check`. Or in a terminal:

```bash
cd your-project
npx @next-generation-collective/factory
```

It reads your project and shows what it can prove: credentials in the code, tests that
check nothing, no tests at all, and more. No account, no questions, and it writes nothing
into your project.

Note one line that surprised you, and one line that was wrong.

## Step 2: let it fix something (5 to 10 minutes)

If it found a problem and you have an AI tool, it asks:

```
Want me to fix this one now? You approve a short plan first. (y/n)
```

Say yes. It writes a short spec, shows you only what matters (its guesses and how each
check will be proven), and waits for your yes. Then it plans, builds, runs your tests,
uses the app if it can, and a separate AI session reviews the change. You get a summary
you can paste to your team.

It found nothing to fix? Give it a small real job instead. Inside your AI, just ask for it.
In a terminal:

```bash
npx @next-generation-collective/factory "the small change you were going to make anyway"
```

Nothing is committed for you. Look at the change with `git diff` and commit it yourself
if you are happy.

## Step 3: one lesson (10 minutes, optional)

Think of something that went wrong in a project you worked on, and what would have caught
it. Write it down:

```bash
npx @next-generation-collective/factory lesson new
```

Lessons are how the factory learns. The good ones become checks.

## Report back

Open a **Pilot report** issue:
<https://github.com/next-generation-collective/factory/issues/new?template=pilot-report.yml>

It takes three minutes. The most useful things to tell us:

- Did it install and run? On which system?
- Which line was wrong? (A false alarm is the worst thing it can do.)
- Which line was useful?
- Where did it stop, and what did you expect to happen next?

## What it cannot do yet

It cannot prove your software has no bugs, and it never says so. It does not set up a
phone simulator for you. Screenshots show what the AI saw on your machine, not what every
user will see. The full list: [WHAT-IT-CANNOT-DO.md](docs/WHAT-IT-CANNOT-DO.md).

## Safety

The first run and `factory verify` only read your files (`verify --deep` runs your own test
and build commands). A job runs your AI tool inside your project: it may edit files there,
and by default it may not run commands; the factory runs the checks. Read
[SECURITY.md](SECURITY.md) for details.
