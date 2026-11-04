# How Next-Gen runs a job

This is the order of work, written for a person joining a job. The engineering rules are in
[the constitution](../cli/template/constitution.md); this page is how we apply them.

The tool is built against this page. Where the tool does not yet do a step, the step is done
by a person, and the tool says so.

## The promise

We do not report work as done until we can show what passed, what a person still has to
look at, and what we did not check. A false alarm is worse than a missed problem, and a
green result that proves nothing is worse than both.

## What a job is

One job is one spec, and one spec is one change a person can review in one sitting. If it
is too big to review in one sitting, it is two jobs.

## Who does what

| Who | Does |
|---|---|
| The person who owns the outcome | Answers the questions, approves the spec, decides what is out of scope, accepts the finished work |
| The AI | Writes the spec, plan and tasks, builds, runs the checks, records evidence |
| The tool | Reads the project, holds the approval gate, runs the checks, uses the app, writes the report |
| A fresh AI session | Reviews the change independently before it is called done |
| A person | Reads what the review marks for a person, and commits the change |

The builder never reviews its own work. The tool runs the reviewer in a separate session
that never sees the builder's reasoning.

## The steps

### 1. Agree the problem

The tool answers what the code can answer and marks every guess `Assumed:`. It asks a
person only what the code cannot know (for login, money or personal data: who else is
affected and what must never break). These are the questions behind the spec:

- What is wrong today, in one sentence?
- Who feels it, and what do they do instead right now?
- How will we know it works? Name one result that can be checked.
- What must never break while we change this?
- Who else sees or depends on this?
- Which situations worry you: offline, slow, two people at once, no permission, a small
  screen?
- What is out of scope?

A job does not start with a solution. If the answer to the first question is "build X",
ask what X is for.

### 2. Look before building

Read the project first: what kind of software it is, how it starts, how it is tested, what
data it stores, and which keys it expects (names only, never values).

Then search for code that already solves the problem: GitHub, the package registry for the
stack, and the web. For each candidate, record the licence, the last change, whether it has
real users, and whether it fits the stack. Write the result to `reuse.md` beside the spec
with one recommendation: install the package, copy one file, fork it, or build it.

No licence means do not copy. GPL or AGPL is a decision for the person, not the AI.

### 3. Write the spec

The spec states the problem, the people, every state (loading, empty, error, offline, no
permission, dark mode, tapped twice, back or cancel, small screen, screen reader, the other
person, setting meaning), what people expect from this kind of software, and the acceptance
checks.

Every acceptance check must be something a machine can prove, starting from a known state.
"Sending..." on screen is not proof; the result on the other side is.

A person reads the spec and approves it. The approval records who approved it and a
fingerprint of the text. Editing the spec afterwards makes the approval stale. Nothing is
built while the approval is stale, unless the person records a hotfix.

### 4. Write the plan

The plan says what already exists and will be reused, the schema and every index, who can
read or write each thing, where secrets live, what personal data is stored and for how long,
and which check proves each acceptance criterion.

If the plan needs a state the spec did not answer, stop and go back to the spec.

### 5. Write the tasks

Each task is a small change with an exact file path and a proof: `Proves: <the check that
shows the outcome>`. Order by risk: the uncertain part first, not last. The final task runs
the checks and records the result.

### 6. Build

Make the smallest change that works. Reuse what is there before adding anything. Write the
test with the code, not afterwards. Never leave a secret, key or password in a file.

### 7. Prove it

Run the project's tests and build. Then use the software the way a person does:

- Web: open it in a browser, sign in as two accounts, check what the second one sees.
- Phone: run the journey on a simulator or a real phone with the test accounts.
- Service: call it as a client, with two accounts' tokens, and check the stored result.
- Command line or library: run it in a throwaway folder, as someone who installed it would.

Start every run from a known state. Reset the test data first. After a write, read the
record back. After a permission change, try it as the other account. Keep the screenshot,
log or recording in the spec's `evidence/` folder.

When a run fails, first decide whether the app or the test is wrong. Record the evidence
before fixing anything.

### 8. Review independently

A fresh person or a fresh AI session reads the actual change, not the summary. They send it
back for a claim with no proof, a control that does nothing, a state that was never handled,
a secret in a file, another person's data exposed, or a test that checks a label instead of
a result.

They also check the copy: fixing a bug in one place does not fix the same mistake in a
sibling.

### 9. Report

Say what passed, what a person still has to look at, and what was not checked. Never say
"bug-free", "secure" or "compliant". Say "passed these checks".

### 10. Learn

Write one dated lesson for anything that went wrong or took real time. A lesson that repeats
becomes a rule in the constitution, a trap in the list, or a check in the tool. Re-run the
failed step after adding the rule, to prove the rule works.

A lesson that only lives in someone's memory will be learned again the hard way.

## What "done" means

Done means:

- the spec was approved by a person and has not changed since;
- the acceptance checks pass;
- the app was used, and the evidence is in the spec's folder;
- an independent review has no open objection;
- the report says plainly what was and was not checked.

Done does not mean the software has no bugs. It means we know what we proved.

## Data and access

Personal data is regulated: POPIA in South Africa, the local equivalent elsewhere. A plan
that touches it says who can reach it, with what rights, and where the secret lives.

- Credentials live in the secret manager, never in code, specs, config files or chat.
- Test accounts are clearly named "(Test)" and placed away from real people. Passwords live
  in an untracked file.
- Do not put production data in a test. Do not put a demo-data layer inside production code.
- A helper that plays another person goes through the same calls the app makes, never
  straight to the database.
- When the law is unclear, stop and ask a person who knows it.

## Release gate

Nothing goes to a store or to real users while either of these is open:

1. **Server work.** A migration, policy, storage rule or setting that the release needs is
   not live. "Written" is not done; it must be checked against the live system.
2. **Outside testers.** At least three people outside the team have used it on their own
   devices, and their notes are in the spec's evidence folder.

## Where things live

| Path | What it holds |
|---|---|
| `specs/NNN-name/` | The spec, plan, tasks, reuse report, approval and evidence |
| `factory.config.json` | What the project is, who depends on it, what must never break |
| `.factory/` | The constitution, evidence and reports, committed and shared. Only machine state (`state.json`, `last-verify.json`, `prompts/`, `idea.txt`) is git-ignored |
| `.factory/constitution.md` | The engineering rules, copied into your project from the factory |
| `kit/` | Test setup proven on a real run |
| `lessons/` | Dated failures and the checks they became |
| `docs/bench/` (in this repository) | Replays of solved issues, with the rules they changed |

## What the tool does today

| Step | Today |
|---|---|
| Read the project, answer the questions it can | The tool |
| Find existing code, write `reuse.md` | A person, with `/find-existing` |
| Spec, approval, plan, tasks | The tool; a person approves |
| Build and fix loop | The tool, with your agent |
| Tests, build and the project checks | The tool |
| Use the app, with screenshots | The tool for websites, and for phone apps with Maestro and a running simulator; two accounts are still a person |
| Independent review, every acceptance check | The tool, in a separate session |
| What the review marks for a person | A person |
| Report and lessons | The tool |

The table is updated as each step moves into the tool. It is not marketing; it is the honest
state.

## When to stop and ask

- The work needs personal data you cannot justify.
- A candidate is GPL, AGPL or has no licence.
- Someone wants production data used in a test.
- The spec and the code disagree.
- A check cannot be written for an acceptance criterion.
- The release gate is open.
