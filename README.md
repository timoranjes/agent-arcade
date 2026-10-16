# 🕹️ agent-arcade

A Claude Code mod that gives you a playful, live view of Claude and its subagents while they work.

## What you get

- **📊 Dashboard pane:** an animated stage with one lane per agent, showing each agent's model, effort and token usage (including cache reads).
- **📜 Activity pane:** a running feed of tool calls, tagged by agent, with their targets and whether they succeeded.
- **Stats band** above the prompt: model and effort, a context bar (green, amber or red), session cost, running agents, turn timer and tool count.
- **Toasts** for:
  - a finished turn (time, tools, files and agents)
  - subagents finishing or stopping
  - denied or failed tools
  - context reaching 80%
  - a rate limit reaching 90%

## Install

Clone the repo:

```sh
git clone https://github.com/timoranjes/agent-arcade.git
```

Then point Claude Code at the folder. You can do this for one session:

```sh
claude --plugin-dir /path/to/agent-arcade
```

Or set it permanently in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/agent-arcade" }
}
```

The panes open on their own when a session starts.

## Commands

| Command         | What it does                                                        |
| --------------- | ------------------------------------------------------------------- |
| `/arcade`       | Show or hide the Dashboard and Activity panes                       |
| `/arcade reset` | Clear the feed and finished agents (agents still running are kept)  |

## Layout

```
.claude-plugin/plugin.json   mod manifest
hooks/hooks.json             loads register.tsx
hooks/register.tsx           event handlers, the /arcade command, panes, toasts
hooks/model.ts               pure state and formatting logic
hooks/views.tsx              band, dashboard and feed rendering
hooks/stage.tsx              animated agent stage
hooks/*.test.ts(x)           tests
types/index.d.ts             shared types
```

## License

[MIT](LICENSE)
