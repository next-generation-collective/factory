# Software Factory Constitution

Every spec, plan and task list in this repo is checked against these rules. They were
distilled from real delivery runs. Principle VI uses a reuse ladder.

## Core Principles

### I. Design before code
No code is written until a spec says what problem it solves, for whom, and how we will know
it works. Larger work also needs a design document: problem, constraints, approaches
considered, the choice and why, risks, and how success is measured.

### II. The data model is the hardest thing to change
Features can be rewritten in a week. A wrong schema with real people's data in it lasts
years. Every plan that stores data states the schema, what each index is for, and what
would be painful to change once real people are in it.

### III. Personal data and credentials come first
Personal data is regulated: POPIA in South Africa, the local equivalent elsewhere. A plan
that touches it states who can reach it, with what rights, and where the secret lives.
Credentials live in your secret manager and nowhere else: never in code, specs, config
files or chat. Security fixes on exposed personal data
outrank all other work.

### IV. "Closed" means verified
Work is closed when it is fixed, written up and off the list. A fix with no check proving
it works is not closed. Every task list ends with the step that proves the outcome.

### V. Every incident gets a Correction of Error
When something breaks or is found exposed, write a Correction of Error: what happened,
timeline, who was affected, five whys to the real cause, and actions with named owners.
No blame, no hedging.

### VI. Build the least that works
Every plan and every task stops at the first rung that holds:

1. Does this need to exist? If not, skip it.
2. Is it already in the target repo? Reuse it.
3. Does the language's standard library do it? Use it.
4. Does the platform (browser, phone, database) do it natively? Use it.
5. Is a dependency already installed that does it? Use it.
6. Has an open-source project already solved it, under a licence we may use? Adopt or
   adapt it. Run `/find-existing` and record the result in the spec's `reuse.md`.
7. Can it be one line? Make it one line.
8. Only then: write the minimum that works.

Read the code the change touches before choosing a rung. Validation at trust boundaries,
data-loss handling, security and accessibility are never cut to make code smaller.
A plan that writes a substantial new component must point to a `reuse.md` showing why
rungs 1 to 6 failed. Code with no licence, or a GPL/AGPL licence, is never reused without
the user's explicit agreement.

### VII. Every state is designed, and every "done" is tested
Quality is decided in the spec, not discovered in QA. For each screen or feature a spec
says what the user sees and can do in each of these states, or marks it "not applicable"
with a reason:

| State | The question the spec answers |
|---|---|
| Loading | What shows while waiting? Nothing that later turns out wrong |
| Empty | What shows when there is nothing yet, and what can the user do next? |
| Error | What does a failure say, and how does the user retry? Never a misleading message |
| Offline / slow | What happens with no network or a very slow one? |
| No permission | What happens when location, camera or notifications are refused? |
| Dark mode | Is every text readable (contrast at least 4.5:1)? |
| Tapped twice | Can a double tap send twice, pay twice or open two copies? |
| Back / cancel | Where does Back go? Does cancelling leave anything half-done? |
| Small screen | Does it fit the smallest supported phone without hiding actions? |
| Screen reader | Does every control have a label that says what it does? |

Anything one account does that another account can see also answers two shared states
(how to check them: `kit/expo-supabase-maestro/TWO-ACCOUNT.md`):

| State | The question the spec answers |
|---|---|
| Other person | For each action (block, unsend, change photo, type, hide), what does the other account see, and how fast? Checked from a second account, not the one that acted |
| Setting semantics | For each toggle: is it stored on the server or on this phone, and who does it affect (me, the people I talk to, everyone)? Checked from the other account. A setting that changes what others see lives on the server |

A spec with an unanswered state does not go to planning. Every acceptance criterion
becomes an automated check (a unit test or an end-to-end flow), written with the code,
and the feature is done when its checks pass automatically on every change. Before
handing work to a person, the AI runs the app, tries the hard states above, and records
what it saw (screenshots or test output) in the spec's folder.

### VIII. Test against reality
Tests exercise the code that ships, against the real backend, with dedicated test
accounts that real users never meet (placed far away, clearly named "(Test)", passwords
only in an untracked file). No demo-data layer inside production code: it rewrites real
behaviour and lets tests pass without testing the fix.
- Every test starts from a known state: reset the test data before each journey and
  confirm which account is signed in. Never trust what an earlier test left behind.
- Check the test setup before trusting a result. A failure is first classified as
  "app" or "test" with evidence (screenshot, log, timing), then fixed where it belongs.
- Before planning any database change, inspect the live database. The repo's migration
  files are not proof of what is deployed.
- Before telling a person what they will see, check it on their device or account.
- **Assert the outcome, not the app's claim.** A journey passes when the result exists on
  the other side: the message arrived, the push was delivered, the file is in storage, the
  other account sees the change. "Sending…" on screen proves nothing.
- **A flow that taps a mutating action ends with an outcome assertion.** After Send,
  Block, Delete, Accept or Save, the flow checks the result: the item is in (or gone
  from) a list, or a script signed in as the other account sees the change. A screen
  title alone is not an outcome. `kit/expo-supabase-maestro/scripts/lint-outcome-flows.mjs`
  flags the flows that break this.
- **Simulated people behave like real ones.** A test helper that plays another person goes
  through the same server calls the app makes (including notifications), never straight
  to the database.
- **What only a real phone can show gets its own list, prepared by the AI:** cold start
  with nothing cached, push notifications, camera and microphone, fonts and text fitting
  on the smallest phone, the compass or heading (turn the phone slowly through north and
  compare with the iOS Compass app), the photo picker (a photo arrives whole, with no
  forced crop), and the splash screen on a cold start on the smallest supported phone.
  The AI sets each one up and states the expected result; the person only looks. Each
  item leaves a screen recording in the spec's `evidence/` folder.

### IX. Every run makes the factory better
After each spec, record what went wrong and what went right as a dated file in `lessons/`
at the project root. Lessons are committed and shared with the whole team, never kept
private to one person or one AI session. Turn each repeatable lesson into a rule here, a
trap in "Known traps" below, or a tool in `kit/`. A lesson that only lives in someone's
memory, or in a folder git ignores, will be relearned the hard way.

### X. Expected baseline
People judge an app against the apps they already use. A chat with no way to start a
new line feels broken, even if every feature the spec named works. So every spec lists
the features users expect from apps of its category and marks each one:

- **In scope**: built and tested in this spec.
- **Hidden**: not built, and nothing on screen suggests it exists.
- **Out**: not built and not hidden (it never had a button), with a reason and the spec
  that will take it.

Every row has a reason. Starting points, by category:

| Category | Users expect |
|---|---|
| Chat | New line in the message box; unsend or delete your own message; reply to a message; typing indicator; tap a photo to see it full screen; photos sent whole, never force-cropped; shared media shows photos and videos, not voice notes |
| Profiles | A photo gallery, not one photo; your changes reach other people promptly |
| Settings | Privacy toggles change what **others** see, not only what this phone shows |
| Sign-up | Nothing asked twice (no name screens when sign-in already gave the name); dates picked, not typed; photos not force-cropped |
| Safety | Block works in both directions and from every place the person appears; unblock from the same places |

The list grows with each run: a baseline item testers report becomes a row here.

## Known traps

Checked in every plan and every review. Each one cost real time once.

| Trap | Why it bites | Do instead |
|---|---|---|
| Calling the backend inside an auth state-change callback (Supabase `onAuthStateChange`) | The auth lock is still held, so the call waits forever: sign-out froze | Defer with `setTimeout(..., 0)`; give cleanup steps a time limit |
| Creating stores, clients or objects on every render | Effects that depend on them re-run every render: the chat screen froze | Create once per key (`useMemo`, module cache) |
| Copying a store's value once into derived state | The copy never updates: contacts sorted under "U" | Read the live value |
| Location or proximity queries without an upper limit | Anyone can scan a wide area and locate people | Cap distances on the server; review every location query for privacy |
| State flags written to one place and read from another | The app "never knew it was offline" | Unit-test the setter and the reader together |
| Local dev servers and long test runs | Background processes stop at their time limit mid-run | Restart before long runs; runners check the server first |
| Adding a new kind of upload (voice, video, files) without checking the storage bucket | A production bucket only allowed images, so voice notes failed for every user for months; its write rules also let anyone overwrite anyone's files | When a feature uploads, test the live bucket: the file type is accepted, and a second account cannot overwrite or delete it |
| Testing an over-the-air update on a newer development build than the one in the App Store | The update needed a native package the store build lacked, crashed on launch and rolled back; real users never got it | Before any OTA publish, compare native dependencies and the Expo fingerprint against the **store** build; test on that build or ship a new store build |
| Push tokens saved per phone with a "one account per phone" rule, but nothing removes the old account's row (sign-out, expired session, older app versions) | The next account's save fails silently; the phone keeps the old account's notifications, so people see pushes for messages they sent themselves | The account that registers a phone takes it over on the server (trigger or function), not only on sign-out in the app; test with two accounts on one phone |
| A visible button or menu item whose action does nothing (a "Reply" with no handler) | It is a lie on screen: the person taps, nothing happens, and they stop trusting every other button (release 2.1.0) | Hide it until it works; a review checks every menu item has a handler that is passed in |
| Long cache times (`offlineFirst`, `staleTime` of minutes, a 24-hour persisted cache) on **another person's** data | Their updates never reach you: a friend's new photos showed, then disappeared for viewers (release 2.1.0) | Your own data may cache; other people's data refetches on focus or listens for changes. Test: A changes it, B (with the old value cached) sees it within N seconds |
| A server migration written but never applied | The app ships assuming rules that are not live: blocking was one-sided for every user (migration 0007, 2026-10-12) | Each migration a release needs is a task; the release is blocked until `check-migrations.mjs` passes against the live database |
| A "fix" shipped without the device check it needed | The splash text was "fixed" on the simulator and still cut off on phones (release 2.1.0) | A fix on the device-only list counts as not fixed until its screen recording is in `evidence/` |
| Fixing a bug only where it was reported | The same mistake often lives in a sibling: a copy, a parallel type, another code path. Builder and reviewer both missed one in the bench pilot, and the maintainers' real fix covered it (2026-10-09) | Name the root cause in one sentence, search the codebase for the same pattern, fix or report every copy; the reviewer checks this too (review rule R7) |

## Launch Readiness

Nothing that real people use goes live until a plan answers four questions: what metric
says it is working, what alarms when it is not, who responds, and where the runbook is.

## Release gate

Nothing goes to a store while either of these is open:

1. **Server work.** Any task that touches the server (a migration, a policy, an edge
   function, a storage rule, a setting) is `[ ]` or `[~]`. "Written" is not done:
   `check-migrations.mjs` (or the matching check) must pass against the live database.
2. **Outside testers.** One TestFlight (or internal testing) round with at least three
   people outside the team, on their own phones, before each store release. Their notes
   are saved in the spec's `evidence/` folder, and anything they find is fixed or
   recorded as known before release.

## Workflow

- Specs live in `specs/` in this repo. Code lives in the repo the spec names, listed in
  `repos.md`. Every spec states its target repo.
- Plans use the existing stack of the target repo.
- Anything a partner, funder or the public will see follows the organisation's brand and
  design rules.
- Every build sent to a store gets an annotated git tag on its exact commit, pushed the
  same day, following the repo's own pattern (for example `v2.1.0-I45`, where A = Android build and I = iOS build).
- **One spec, one reviewable slice per pull request.** A stacked pull request says its
  base in its title or first line ("Stacked on #28") and targets the parent branch, not
  `main`, so its diff shows only its own change. Merge from the bottom of the stack up.
- CI turns on Biome's `noExcessiveCognitiveComplexity` as an error for **changed files
  only** (recipe in `kit/expo-supabase-maestro/README.md`). Old files are fixed when they
  are next touched.
- Dates are written YYYY-MM-DD. Spelling is British/South African.

## Governance

This constitution sits under the organisation's own house rules. Where they disagree,
the house rules win. Changes are made with `/speckit-constitution`, and the reason is
recorded as a decision in the organisation's decision log.

**Version**: 0.3.0 (draft, awaiting team agreement; VIII, IX and Known traps added from Run 1; X, the shared states, release gate and pull request rules added after release 2.1.0 tester feedback) | **Ratified**: not yet | **Last Amended**: 2026-10-12
