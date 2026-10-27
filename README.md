# syaq · سياق

*Arabic for "context".* A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps a context and relevant info above the prompt.

**Problem:** Claude Code's context fills up out of sight. You can't see how full it is or what's filling it, and you find out only when auto-compaction interrupts a task and burns too many tokens than it needs to.

**Problem:** Claude Code's context fills up quietly in the background. You only find out when auto-compaction interrupts you and burns more tokens than it needs to.

**Solution:** Syaq to keep the context in view, how full it is, what's filling it, where auto-compact will kick in, plus your usage limits and the current model. It has a full panel and a slim one-line view. When you hit a threshold you set (60% by default), it nudges you once to run `/compact`, while it's still cheap, instead of at the last second.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ◆ Context                             40k of 1M · auto-compacts at 967k  4%  │
│                                                                              │
│ ███████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░┃░░░ │
│ ■ system prompt 2.9k <1%  ■ system tools 27k 3%  ■ skills 10k 1%             │
│ ■ free space 927k                                                            │
│                                   model Opus 5.5 · 5h limit 19% · weekly 46% │
╰──────────────────────────────────────────────────────────────────────────────╯
```

- **Bar**: one coloured run per category of the context window (system prompt, tools, memory files, skills, messages and so on), sized to its share, with the categories past the five largest drawn as one "other" run. The filled part always matches the percentage, so on a short bar the smallest categories give up their cells first.
- **Compaction marker**: the `┃` shows where auto-compaction starts, when it's turned on.
- **Legend**: the token count and percentage for the five largest categories. The rest share one "other" entry.
- **Footer**: the current model, rate-limit usage (5-hour, weekly, spend) and, on pay-as-you-go plans, what the session has cost so far.

The percentage badge and the limit figures turn green, then yellow at 60%, then red at 85%.

Once the context is over 60% full, the panel suggests running `/compact`: "over 60% · consider running /compact" next to the title, or "run /compact" in the slim view. The prompt box offers `/compact` too, so Tab then Enter runs it, and a toast says so: "🧹 Conversation context is 62% full · run /compact to free up space".

The prompt box offers it once each time the context crosses 60%, as soon as the box is empty and no turn is running. After a compaction brings the context back under 60%, it offers it again the next time the context fills up.

### Changing when it suggests /compact

60% is the default. To change it, run `/syaq at 70` (any percent from 1 to 99), or open `/config` and set **Suggest /compact at (%)** under syaq. Both change the same setting, so it's remembered across sessions. The context badge turns yellow, and the hint, the prompt suggestion and the toast all appear, at the percent you set. The rate-limit figures keep turning yellow at 60%.

## Views

The panel above is the **full** view. The **slim** view keeps just the bar, the key figures and the model's name (as `/model` lists it) on one line, in the same border:

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ◆ █░░░░░░░░░░░░░░░░░░░░░░┃░  40k/1M  4%  ·  Opus 5.5  ·  5h 19%  ·  week 46% │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Switch between them with the `/syaq` command:

| Command | What it does |
| --- | --- |
| `/syaq` | Switches between the two views |
| `/syaq slim` | Shows the slim view |
| `/syaq full` | Shows the full view |
| `/syaq at 70` | Suggests `/compact` from 70% instead of the default 60% |

Your choice is remembered across sessions. The views' earlier names, `detailed` and `simple`, still work. On a narrow terminal the slim view drops the rate limits, then the model, to keep the bar readable.

The full view fits the terminal's width too, dropping what is there for reference before what you act on:

| Width | What changes |
| --- | --- |
| 100 columns and up | Everything shows |
| 70 to 99 | No auto-compact point in the header (the `┃` marks it), a shorter `/compact` hint, the three largest categories in the legend and no free space, short footer labels |
| 50 to 69 | Header, bar and limits only: no legend, model or cost |
| Under 50 | The slim layout, whatever view you chose; widen the terminal and your view comes back |

## When it refreshes

The panel refreshes when a session starts, when context is measured and after each compaction. When only the rate limits or cost moved, just those figures update. Deferred tools, which sit outside the window, are left out.

## Requirements

Claude Code 2.1.310 or later, in a terminal session.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install syaq --marketplace hassanhafezzz/syaq
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod in every session).

From a shell:

```
claude plugin install syaq --marketplace hassanhafezzz/syaq
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hassanhafezzz/syaq`, then **Add plugin**.

## Uninstall

```
claude plugin uninstall syaq
```

## Development

Run a session with the mod loaded straight from a checkout. Saving a file reloads it:

```
claude --plugin-dir /path/to/syaq
```

Check it, type-check it and run the tests:

```
claude plugin validate .
tsc -p .
claude plugin test .
```

`tsc` needs `.claude-plugin/types/`, which Claude Code writes the first time it loads the mod.

| Path | What it holds |
| --- | --- |
| `hooks/register.tsx` | The hooks module: measures usage and draws the panel |
| `types/index.d.ts` | The mod's state contract |
| `tests/band.test.tsx` | Tests run by `claude plugin test` |

## Contributing

Issues and pull requests are welcome. Before opening a pull request, make sure `claude plugin validate .`, `tsc -p .` and `claude plugin test .` all pass, and add a test for any change in what the panel shows.

## License

[MIT](LICENSE)
