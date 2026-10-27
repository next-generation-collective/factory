# What this cannot do

This file exists so nobody trusts the tool further than it deserves.

## It cannot prove your software is correct

It runs a small set of checks. Passing them means those checks found nothing. It does not
mean there are no bugs. It never says "bug-free", and neither should you.

## It cannot prove compliance

The personal-data check is a prompt to look, not legal advice and not proof of POPIA
compliance. It may miss something, and it may flag something that is fine. A person who
knows the law has to decide.

## It cannot tell you whether the spec is good

The spec is a gate, not a guarantee. The tool can check that a person approved it, and that
the text has not changed since. It cannot tell whether the spec is clear, complete, or worth
building. A bad spec approved is still a bad spec. Read it before you approve it.

## It uses your app, within limits

In a job it starts your website and has the AI use it in Chrome or Firefox (or with
Playwright), and it runs Maestro flows for phone apps. It does not set up a phone simulator
or a real phone for you, and it does not yet sign in as two accounts by itself. Screenshots
show what the AI saw on your machine, not what every user will see. With another agent than
Claude Code, set `agent.journeys` or the step is skipped and says so.

## Inside an AI tool, some steps work differently

When you use the factory inside Claude Code, Cursor or another AI tool:

- **Your approval.** Where the tool can show an approval box, you click it and the AI cannot
  answer for you. Where it cannot, the AI must bring back your own words, and the factory
  records them with the approval. The factory cannot prove you typed them; the box is the
  stronger proof, and the record says which one was used.
- **Using the app in a browser** is not part of the in-chat flow yet. The checks, tests,
  build and independent review run; the browser step runs with `factory verify --app` in a
  terminal.
- **Your AI decides whether to call the factory.** The Claude Code plugin tells Claude at the
  start of every session to use it for any change, and in our tests it then did. If your AI
  ever builds without asking for your approval, type `/factory:build` with your request.
- **Tested so far:** Claude Code, end to end. Cursor, Codex, Gemini CLI and VS Code use the
  same open standard but have not been tested by us yet.

## The reviewer is an AI too

The independent review is a separate session of the same agent unless you set
`agent.review` to another model. It can miss things. Its findings must cite a rule and a
line, and the tool, not the reviewer, decides from them. A check that needs a command
nobody ran is marked for a person, not passed.

## On a monorepo it reports the main app

It finds the workspaces, picks the main app (a phone app, then a website, then an API) and
runs the root test and build commands when there are any. The other packages are listed but
not described one by one.

## It cannot replace your tests

`verify --deep` runs the tests you already have. If your tests check that a button says
"Saved" but never check that anything was saved, the tool may still pass.

It can flag the obvious cases: a test file with no assertion, a test that only checks that
something is on screen, or skipped tests. That is a static read, not proof. It cannot know
what your tests were supposed to prove, and a test with a real assertion can still assert
the wrong thing.

## It cannot know your design is good

It checks behaviour and evidence. It cannot tell you the product is useful, the wording is
clear, or the flow makes sense to a first-time user.

## It cannot check what it cannot see

Third-party services, payment providers, email delivery, push notifications and store
review all happen outside the project. The tool can only report what it can run.

## It can be wrong in both directions

- **False alarm:** it flags something that is fine. This is why flagged results never fail
  a run.
- **Missed problem:** it says nothing because it has no check for that failure yet. The
  lessons library is how those gaps get filled.

## It cannot run without an agent for `build`

`build` needs an agent command already installed and signed in. Without one, it writes the
prompt to `.factory/prompts/` and stops. It does not ship a model, an account or an API key.

## It cannot tell you what strangers experienced

It runs on the machine it is given. Real phones, real networks, real accounts and real
people are still the only way to know what users get.

## It does not phone home

No accounts, no telemetry, no analytics. Nothing leaves the machine unless you pass a
command that explicitly sends something. That also means the maintainers cannot see how you
use it, so they rely on you telling them.
