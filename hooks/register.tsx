import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionCost, SessionRateLimit } from 'claude-code'

import type { Limit, Segment, Snapshot, View } from '../types'

// Bump the shape when Snapshot changes: a value stored under another reads as absent
const snapshot = atom({ plugin: 'syaq', key: 'snapshot' } as const, null, { shape: 'v2' })
const view = atom({ plugin: 'syaq', key: 'view' } as const, 'full')

// "detailed" and "simple" are the views' earlier names: the command and a stored
// choice still take them
const toView = (v: unknown): View | null =>
  v === 'full' || v === 'detailed' ? 'full' : v === 'slim' || v === 'simple' ? 'slim' : null

// The slim view's one line has less room, so it takes the short label
const LIMIT_LABELS: Record<string, { long: string; short: string }> = {
  five_hour: { long: '5h limit', short: '5h' },
  seven_day: { long: 'weekly', short: 'week' },
  spend_limit: { long: 'spend', short: 'spend' },
}

const limitLabel = (kind: string, size: 'long' | 'short'): string => LIMIT_LABELS[kind]?.[size] ?? kind

// "claude-opus-5-5[1m]" reads as "Opus 5.5 [1m]", the name /model lists;
// a provider prefix and a date stamp are dropped
const modelName = (id: string): string => {
  const m = id.match(/^(?:.*\bclaude-)?([a-z]+)-(\d+(?:-\d{1,2})?)(?:-\d{8})?(\[[^\]]+\])?$/i)
  const [, family, version, suffix] = m ?? []
  if (!family || !version) return id
  const name = family[0]!.toUpperCase() + family.slice(1).toLowerCase()
  return `${name} ${version.replace('-', '.')}${suffix ? ` ${suffix}` : ''}`
}

const formatTokens = (n: number): string => {
  // From 999.5k up, "k" would round to "1000k"
  if (n >= 999_500) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return `${n}`
}

const formatPercent = (part: number, whole: number): string => {
  const pct = whole ? (part / whole) * 100 : 0
  // A category that holds tokens never reads as empty
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

// From here the figures turn yellow and the band suggests /compact; the context's
// point is the `compactAt` setting, the rate limits keep the default
const DEFAULT_COMPACT_AT = 60

// A stored value outside 1-99 falls back to the default
const toCompactAt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 99 ? Math.round(v) : null

// Takes the percent as shown, so the colour never disagrees with the figure
const levelColor = (percent: number, warnAt = DEFAULT_COMPACT_AT): string =>
  percent >= 85 ? 'error' : percent >= warnAt ? 'warning' : 'success'

// One cell per column: the used share split across categories, the rest free, then the marker
const barRuns = (snap: Snapshot, width: number): { color: string; text: string }[] => {
  const used = snap.segments.filter(s => s.kind === 'used' && s.tokens > 0)
  const usedTokens = used.reduce((n, s) => n + s.tokens, 0)
  // The used cells match the window's fill; any fill shows at least one
  const usedCells = usedTokens > 0 ? Math.min(width, Math.max(1, Math.round((usedTokens / snap.max) * width))) : 0

  // Largest remainder: each category its share of the used cells, so a narrow bar
  // drops the smallest categories instead of overflowing past the fill
  const exact = used.map(s => (s.tokens / usedTokens) * usedCells)
  const counts = exact.map(Math.floor)
  const byRemainder = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
  for (let k = 0, left = usedCells - counts.reduce((a, b) => a + b, 0); k < left; k++) counts[byRemainder[k]!.i]!++

  const cells: { color: string; glyph: string }[] = []
  used.forEach((s, i) => {
    for (let j = 0; j < counts[i]!; j++) cells.push({ color: s.color, glyph: '█' })
  })
  while (cells.length < width) cells.push({ color: 'subtle', glyph: '░' })
  if (snap.threshold !== null) {
    const at = Math.min(width - 1, Math.round((snap.threshold / snap.max) * width))
    cells[at] = { color: 'warning', glyph: '┃' }
  }

  // Merge runs of the same cell into one Text each
  const runs: { color: string; text: string }[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === c.color && last.text[0] === c.glyph) last.text += c.glyph
    else runs.push({ color: c.color, text: c.glyph })
  }
  return runs
}

// How the full view fits the terminal: each step down drops what is there only for
// reference (the auto-compact point, the model, the cost, the legend) and keeps
// what is acted on (the badge, the bar, the /compact hint); under 50 columns the
// slim layout is drawn instead, the chosen view kept
type Fit = 'wide' | 'medium' | 'narrow' | 'slim'
const fitFor = (columns: number): Fit =>
  columns >= 100 ? 'wide' : columns >= 70 ? 'medium' : columns >= 50 ? 'narrow' : 'slim'

// Categories with their own run and entry; a medium legend has room for fewer
const topCategories = (fit: Fit): number => (fit === 'medium' ? 3 : 5)

// "other" takes the first of these no shown category uses; status colours
// (success, warning, error) and greys are left out so it never reads as a level
// or blends into the grey categories
const OTHER_COLORS = ['planMode', 'suggestion', 'permission', 'ide', 'remember', 'merged']

// The `count` largest categories keep their own run and entry, in the engine's
// order; the rest share one "other"
const groupSmallest = (segments: Segment[], count: number): Segment[] => {
  const used = segments.filter(s => s.kind === 'used' && s.tokens > 0)
  if (used.length <= count) return segments
  const top = new Set([...used].sort((a, b) => b.tokens - a.tokens).slice(0, count))
  const taken = new Set([...top].map(s => s.color))
  const other: Segment = {
    name: 'Other',
    tokens: used.filter(s => !top.has(s)).reduce((n, s) => n + s.tokens, 0),
    color: OTHER_COLORS.find(c => !taken.has(c)) ?? OTHER_COLORS[0]!,
    kind: 'used',
  }
  return [...used.filter(s => top.has(s)), other, ...segments.filter(s => s.kind === 'free')]
}

// "System prompt" reads "system prompt"; an acronym such as MCP keeps its capitals
const legendName = (name: string): string =>
  name
    .split(' ')
    .map(w => (/[A-Z]/.test(w) && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(' ')

const toLimits = (rateLimits: SessionRateLimit[]): Limit[] =>
  rateLimits.map(r => ({ kind: r.kind, percent: Math.round(r.percentUsed) }))

// The percent to warn from, whether the last measured fill was past it, and whether
// /compact is still to be suggested for this crossing; one per registration
type Warn = { at: number; isPast: boolean; isSuggestPending: boolean }

// The prompt box shows a suggestion only while empty and idle: a refusal leaves
// it pending, to try again after the next turn. Claimed before the await, so
// overlapping refreshes suggest once
const suggestCompact = async ($: EngineInterface, warn: Warn) => {
  if (!warn.isSuggestPending) return
  warn.isSuggestPending = false
  const { isShown } = await $.prompt.suggest({ text: '/compact' }).catch(() => ({ isShown: false }))
  if (!isShown && warn.isPast) warn.isSuggestPending = true
}

const refresh = async ($: EngineInterface, warn: Warn) => {
  const { context, rateLimits, cost } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  if (!b) return

  // Deferred rows sit outside the window; the buffer is drawn as the marker
  const segments: Segment[] = b.categories
    .filter(c => c.kind === 'used' || c.kind === 'free')
    .map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind as Segment['kind'] }))

  const next: Snapshot = {
    total: b.totalTokens,
    max: b.maxTokens,
    percent: b.percentage,
    threshold: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    segments,
    model: b.model,
    limits: toLimits(rateLimits),
    costUsd: cost?.usd,
  }
  // Once per crossing: a compaction that brings the fill back under re-arms it.
  // Checked and set with no await between, so overlapping refreshes suggest once
  const wasPast = warn.isPast
  warn.isPast = next.percent >= warn.at
  if (warn.isPast !== wasPast) warn.isSuggestPending = warn.isPast
  // The toast draws wherever it can, so unlike the suggestion it needs no retry
  if (warn.isPast && !wasPast) {
    $.ui.toast(`🧹 Conversation context is ${next.percent}% full · run /compact to free up space`, { timeoutMs: 6000 })
  }
  await update($, snapshot, () => next)
  await suggestCompact($, warn)
}

// Limits and cost arrive with the measurement itself: no breakdown needed
const patchFigures = async ($: EngineInterface, rateLimits: SessionRateLimit[], cost?: SessionCost) => {
  await update($, snapshot, s => (s ? { ...s, limits: toLimits(rateLimits), costUsd: cost?.usd } : s))
}

// The `compactAt` row's key in /config: `<plugin>.<field>`, the plugin's name as
// loaded (a --plugin-dir checkout's can differ), so it is looked up, not spelled
const findCompactAtRow = async ($: EngineInterface) =>
  (await $.config.list()).find(r => r.provider.plugin.startsWith('syaq') && r.key.endsWith('.compactAt'))

export const register: Register = (on, options) => {
  // The band measures once on its own; later measurements come through the hooks
  let hasMeasuredFromBand = false
  // A changed setting reloads the module, so the point is read once here
  const warn: Warn = {
    at: toCompactAt(options.compactAt) ?? DEFAULT_COMPACT_AT,
    isPast: false,
    isSuggestPending: false,
  }

  // These hooks gate session start, measurement and compaction: each waits only
  // on core, and the refresh behind it runs on, its failure swallowed
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const [, stored] = await Promise.all([
      $.command
        .register({
          name: 'syaq',
          description: 'Switch the context panel between the full and slim views, or set when it suggests /compact',
          argumentHint: '[full|slim|at <percent>]',
          immediate: true,
        })
        .catch(() => {}),
      // The chosen view outlives the session
      $.store.get('view').catch(() => undefined),
    ])
    const storedView = toView(stored)
    if (storedView) await update($, view, () => storedView)
    void refresh($, warn).catch(() => {})
    return result
  })

  on('command.run', { command: 'syaq' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    // "at 70" or "at 70%" writes the setting, so /config shows it too; the
    // write reloads the module with the new point
    const at = arg.match(/^at(?:\s+(.*))?$/)
    if (at) {
      const percent = toCompactAt(Number((at[1] ?? '').replace(/%$/, '')))
      if (percent === null) return { text: 'Give a percent from 1 to 99, like /syaq at 70.' }
      const row = await findCompactAtRow($).catch(() => undefined)
      if (!row) return { text: 'The setting is unavailable; set it in /config.' }
      const { deny } = await $.config.set({ key: row.key, value: percent }).catch(() => ({ deny: 'it could not be saved' }))
      return { text: deny ? `Not changed: ${deny}` : `Suggests /compact from ${percent}%` }
    }

    const current = await read($, view)
    // No argument toggles; a named view is set as is
    const chosen: View | null = arg === '' ? (current === 'full' ? 'slim' : 'full') : toView(arg)
    if (chosen === null) {
      return { text: `Unknown view "${arg}". Use /syaq, /syaq full, /syaq slim or /syaq at <percent>.` }
    }

    await update($, view, () => chosen)
    await $.store.set('view', chosen).catch(() => {})
    // Claude Code heads the reply with the mod's name already
    return { text: `${chosen === 'full' ? 'Full' : 'Slim'} view on` }
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    const hasSnapshot = (await read($, snapshot)) !== null
    // Only a moved fill needs the category breakdown
    if (e.changed.includes('context') || !hasSnapshot) void refresh($, warn).catch(() => {})
    else {
      void patchFigures($, e.rateLimits, e.cost).catch(() => {})
      void suggestCompact($, warn).catch(() => {})
    }
    return result
  })

  // Claude Code's own guess after a turn would take the box: while /compact is
  // pending, it goes in that guess's place, once
  on('prompt.suggest', { origin: { kind: 'suggestion' } }, async ($, e, next) => {
    if (!warn.isSuggestPending) return next(e)
    const result = await next({ ...e, text: '/compact' })
    if (result.isShown) warn.isSuggestPending = false
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    void refresh($, warn).catch(() => {})
    return result
  })

  // The panel is drawn in block glyphs and terminal columns: other surfaces go without
  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    // Loaded mid-session: measure once now; the write redraws the band
    if (snap === null && !hasMeasuredFromBand) {
      hasMeasuredFromBand = true
      void refresh($, warn).catch(() => {})
    }
    if (e.props.hasSurvey || snap === null || snap.max === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const fit = fitFor(e.props.bodyColumns)
    const isSlim = fit === 'slim' || (await read($, view)) === 'slim'
    // The bar and the legend group alike, so each entry matches a run
    const drawn: Snapshot = { ...snap, segments: groupSmallest(snap.segments, topCategories(fit)) }
    const shouldCompact = snap.percent >= warn.at

    let body
    if (isSlim) {
      const usage = `${formatTokens(snap.total)}/${formatTokens(snap.max)}`
      const pct = `${snap.percent}%`
      const shown = snap.limits.map(l => ({ label: limitLabel(l.kind, 'short'), percent: l.percent }))
      const limitsWidth = shown.reduce((n, l) => n + `  ·  ${l.label} ${l.percent}%`.length, 0)
      const hint = shouldCompact ? '  ·  run /compact' : ''
      // Border and padding, "◆ ", the bar, then "  usage  pct", the hint, the model and the
      // limits; a narrow terminal drops the limits first, then the model, never the hint
      const room = e.props.bodyColumns - 4
      const fixed = 2 + `  ${usage}  ${pct}${hint}`.length
      const model = snap.model ? modelName(snap.model) : null
      const modelWidth = model ? `  ·  ${model}`.length : 0
      const withModel = room - fixed - modelWidth >= 10
      const withLimits = withModel && room - fixed - modelWidth - limitsWidth >= 10
      const width = Math.max(
        10,
        room - fixed - (withModel ? modelWidth : 0) - (withLimits ? limitsWidth : 0),
      )

      body = (
        <Box borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text wrap="truncate-end">
            <Text color="claude">◆ </Text>
            {barRuns(drawn, width).map((r, i) => (
              <Text key={`r${i}`} color={r.color}>
                {r.text}
              </Text>
            ))}
            <Text weight="bold">{`  ${usage}`}</Text>
            <Text color={levelColor(snap.percent, warn.at)} weight="bold">{`  ${pct}`}</Text>
            {shouldCompact ? <Text color="warning">{hint}</Text> : null}
            {withModel && model ? (
              <Text>
                <Text dimColor>{'  ·  '}</Text>
                <Text color="claude">{model}</Text>
              </Text>
            ) : null}
            {withLimits
              ? shown.map(l => (
                  <Text key={l.label}>
                    <Text dimColor>{`  ·  ${l.label} `}</Text>
                    <Text color={levelColor(l.percent)}>{`${l.percent}%`}</Text>
                  </Text>
                ))
              : null}
          </Text>
        </Box>
      )
    } else {
      const isWide = fit === 'wide'
      const isNarrow = fit === 'narrow'
      // Border and padding take four columns
      const runs = barRuns(drawn, Math.max(10, e.props.bodyColumns - 4))
      // "run /compact" wherever room is short, so the command never reads as a label
      const hint = isWide
        ? `  over ${warn.at}% · consider running /compact`
        : isNarrow
          ? '  run /compact'
          : `  over ${warn.at}% · run /compact`
      // Free space is the bar's empty part: only a wide legend has room to repeat it
      const legend = isNarrow ? [] : drawn.segments.filter(s => isWide || s.kind !== 'free')
      // The model leads; a narrow footer keeps only the limits. `color` absent: dim
      const footer: { key: string; label: string; value: string; color?: string }[] = [
        ...(snap.model && !isNarrow
          ? [{ key: 'model', label: isWide ? 'model ' : '', value: modelName(snap.model), color: 'claude' }]
          : []),
        ...snap.limits.map(l => ({
          key: l.kind,
          label: `${limitLabel(l.kind, isWide ? 'long' : 'short')} `,
          value: `${l.percent}%`,
          color: levelColor(l.percent),
        })),
        // Subscription sessions report no spend: leave the figure out
        ...(snap.costUsd && !isNarrow
          ? [{ key: 'cost', label: isWide ? 'session ' : '', value: `$${snap.costUsd.toFixed(2)}` }]
          : []),
      ]

      body = (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
            <Text wrap="truncate-end">
              <Text color="claude">◆ </Text>
              <Text weight="bold">Context</Text>
              {shouldCompact ? <Text color="warning">{hint}</Text> : null}
            </Text>
            <Text>
              <Text weight="bold">{formatTokens(snap.total)}</Text>
              <Text dimColor>{isNarrow ? `/${formatTokens(snap.max)}` : ` of ${formatTokens(snap.max)}`}</Text>
              {/* The ┃ on the bar marks it too: only a wide header spells it out */}
              {isWide && snap.threshold !== null ? (
                <Text dimColor> · auto-compacts at {formatTokens(snap.threshold)}</Text>
              ) : null}
              <Text> </Text>
              <Text backgroundColor={levelColor(snap.percent, warn.at)} color="inverseText" weight="bold">
                {` ${snap.percent}% `}
              </Text>
            </Text>
          </Box>
          <Text wrap="truncate-end">
            {runs.map((r, i) => (
              <Text key={`r${i}`} color={r.color}>
                {r.text}
              </Text>
            ))}
          </Text>
          {legend.length ? (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {legend.map(s => (
                <Text key={s.name}>
                  <Text color={s.kind === 'free' ? 'subtle' : s.color}>■ </Text>
                  <Text>{legendName(s.name)} </Text>
                  <Text weight="bold">{formatTokens(s.tokens)}</Text>
                  {s.kind === 'used' ? <Text dimColor> {formatPercent(s.tokens, snap.max)}</Text> : null}
                </Text>
              ))}
            </Box>
          ) : null}
          {footer.length ? (
            <Box flexDirection="row" justifyContent="flex-end">
              <Text wrap="truncate-start">
                {footer.map((f, i) => (
                  <Text key={f.key}>
                    {i > 0 ? <Text dimColor> · </Text> : null}
                    {f.label ? <Text dimColor>{f.label}</Text> : null}
                    {f.color ? <Text color={f.color}>{f.value}</Text> : <Text dimColor>{f.value}</Text>}
                  </Text>
                ))}
              </Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    // Pass the band on, so a band another mod draws stacks under this one
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {body}
        {below}
      </Box>
    )
  })
}
