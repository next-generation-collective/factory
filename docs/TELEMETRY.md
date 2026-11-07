# What the factory shares, and what it never does

*From version 0.5.0. Earlier versions share nothing at all.*

The factory can share anonymous counts with Next-Gen Collective, so we can see what helps
builders and what gets in their way. **It only does so if you say yes.** The first time you
start it, it asks once. You can change your mind any time:

```bash
npx @next-generation-collective/factory share off
npx @next-generation-collective/factory share on
npx @next-generation-collective/factory share        # what you chose
```

Inside Claude Code or another AI tool, your AI asks you the same question once, and records
only your answer. To change it later, just tell your AI: *"stop sharing with Next-Gen"* or
*"start sharing with Next-Gen"*.

## Never shared

- Your code, specs, plans or chat text
- File names, folder names or project names
- Secrets, or what the checks found inside your files
- Your name, email or IP address (the service does not store the address it receives from)

## Shared, if you say yes

| Field | Example | Why |
|---|---|---|
| A random install ID | `3f2a...` | To count builders without knowing who they are |
| Event | `check`, `job_start`, `approve`, `prove`, `review`, `share`, `run`, `feedback` | To see where jobs stop |
| Version, system, Node major version | `0.5.0`, `darwin`, `22` | To fix what breaks where |
| Where you run it | `cli`, or the AI tool's name such as `claude-code` | To know which tools to support first |
| Kind of project | `next`, `expo`, `python` | To know which checks matter |
| Check results as counts, and which checks failed | `{"pass":5,"fail":1}`, `["tests"]` | To know what the factory catches |
| The kind of feedback you gave, if you used `factory feedback` | `loved`, `false-alarm`, `confusing`, `wish` | To see what to fix first; your words go only to the GitHub form you submit |
| How a job ended | done or not, attempts, whether a mistake was caught, review verdict, approval by box or chat | To know if it helps |
| How long the checks took, in whole minutes | `0`, `12` | To see when a run drags on and bound it |
| Which route the job took (from 0.7.0) | `quick`, `full` | To see whether the small route saves tokens |
| Whether the prove loop stopped itself at 3 failed rounds (from 0.7.0) | `true` | To see where builders get stuck |
| Whether a small job was upgraded to a full one (from 0.7.0) | `true` | To see whether the small-route limits are right |

Anything else is dropped on your computer before sending, by `cli/lib/telemetry.js`, which
you can read. The same counts, under the same yes, are sent whether you use the command
line or an AI tool such as Claude Code; the AI-tool path sends nothing extra.

## Never asked, never shared

On build servers (`CI` is set), when `DO_NOT_TRACK=1`, or when `NEXT_GEN_TELEMETRY=0`.

## Your own progress

The factory keeps your own count of proven builds and caught mistakes on your computer, in
`~/.config/next-gen/stats.json`, to show you your progress. That file is never sent.

## Where it goes

To a small service run by Next-Gen Collective on Cloudflare. It is not sold or shared with
anyone. Personal information is not collected; if you think something here could identify
you, open an issue or email hello@nextgencollective.co.za.
