import { expect, mock, test } from 'claude-code/testing'
import type { ContextCategory, ContextCategoryKind, On, SessionMessage } from 'claude-code'

const BAND = {
  plugin: 'syaq',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// /syaq as the person types it
const SYAQ = {
  command: 'syaq',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

// Stands for the engine's own drawing beneath the band
const drawEngine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const row = (name: string, tokens: number, color: string, kind: ContextCategoryKind): ContextCategory => ({
  name,
  tokens,
  color,
  kind,
  isDeferred: kind === 'deferred',
})

// A session that measured 90k of a 1M window, unless a test names other figures
const seedUsage = (
  on: On,
  {
    total = 90_000 as number | (() => number),
    fiveHour = 23,
    extra = [] as ContextCategory[],
  } = {},
) => {
  // A function is read at each measurement, so a test can move the fill
  const totalNow = () => (typeof total === 'function' ? total() : total)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [
        { kind: 'five_hour', percentUsed: fiveHour },
        { kind: 'seven_day', percentUsed: 41.5 },
      ],
      cost: { usd: 1.5 },
      context: {
        window: 1_000_000,
        breakdown: {
          categories: [
            row('System prompt', 4200, 'inactive', 'used'),
            row('System tools', 17_000, 'subtle', 'used'),
            ...extra,
            row('MCP tools', 88_000, 'cyan', 'deferred'),
            row('Messages', 68_800, 'purple', 'used'),
            row('Free space', 877_000, 'promptBorder', 'free'),
            row('Autocompact buffer', 33_000, 'inactive', 'buffer'),
          ],
          totalTokens: totalNow(),
          maxTokens: 1_000_000,
          rawMaxTokens: 1_000_000,
          autocompactSource: 'model-default',
          percentage: Math.round(totalNow() / 10_000),
          gridRows: [],
          model: 'claude-opus-5-5',
          memoryFiles: [],
          mcpTools: [],
          agents: [],
          autoCompactThreshold: 967_000,
          isAutoCompactEnabled: true,
          apiUsage: null,
        },
      },
    },
  }))
}

test('the band shows the totals, the compaction point and each category', async ($, on) => {
  seedUsage(on)
  mock.store(on, { view: 'full' })

  // Another mod's band beneath this one
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>pomo band</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  // The band is passed on: what draws beneath stacks under the panel
  expect(await ui.find({ type: 'Text', text: /pomo band/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /90k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /auto-compacts at 967k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /9%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /system tools/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /free space/ })).toBeDefined()
  // Deferred tools sit outside the window and are left out
  expect(await ui.find({ type: 'Text', text: /mcp tools/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /┃/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude-opus-5-5/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /5h limit 23%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /weekly 42%/ })).toBeDefined()
  // Under 1% of the window still reads as more than nothing
  expect(await ui.find({ type: 'Text', text: /system prompt 4\.2k <1%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$1\.50/ })).toBeDefined()
  await ui.unmount()
})

test('nothing is drawn before the first measurement', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the slim view is the default: one bordered line with the key figures', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /90k\/1M/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /9%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h 23%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /week 42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /┃/ })).toBeDefined()
  // The model goes by the name /model lists
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude-opus-5-5/ })).toBeUndefined()
  // The legend belongs to the full view
  expect(await ui.find({ type: 'Text', text: /system tools/ })).toBeUndefined()
  await ui.unmount()
})

test('/syaq toggles the view and names an unknown one', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /system tools/ })).toBeUndefined()

  expect((await $.command.run({ ...SYAQ, args: '' })).text).toBe('Full view on')
  expect(await ui.find({ type: 'Text', text: /system tools/ })).toBeDefined()

  expect((await $.command.run({ ...SYAQ, args: 'Slim' })).text).toBe('Slim view on')
  expect(await ui.find({ type: 'Text', text: /system tools/ })).toBeUndefined()

  // The earlier names still work
  expect((await $.command.run({ ...SYAQ, args: 'simple' })).text).toBe('Slim view on')
  expect((await $.command.run({ ...SYAQ, args: 'detailed' })).text).toBe('Full view on')

  expect((await $.command.run({ ...SYAQ, args: 'tiny' })).text).toMatch(/Unknown view "tiny"/)
  await ui.unmount()
})

test('a narrow bar shows the fill, not one cell per category', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  // Stored under the slim view's earlier name
  mock.store(on, { view: 'simple' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // 40 columns: the model and limits drop, leaving a 22-cell bar; 9% of it is 2 cells
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 40 } })

  const filled = await ui.findAll({ type: 'Text', text: /^█+$/ })
  expect(filled.map(f => f.text).join('')).toBe('██')
  // Messages, the biggest category, keeps its cells; the small ones give theirs up
  expect(filled.map(f => f.props.color)).toEqual(['purple'])
  await ui.unmount()
})

test('a limit is coloured by the figure it shows', async ($, on) => {
  seedUsage(on, { fiveHour: 84.6 })
  drawEngine(on)
  mock.store(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /^85%$/ }))?.props.color).toBe('error')
  await ui.unmount()
})

test('a window just short of 1M reads as 1M, not 1000k', async ($, on) => {
  seedUsage(on, { total: 999_600 })
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^1M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1000k/ })).toBeUndefined()
  await ui.unmount()
})

test('other surfaces draw without the panel', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a measurement that moves only cost and limits updates them in place', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on, { view: 'full' })
  // Stands for core, which echoes what changed
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 50 }],
    cost: { usd: 3 },
    changed: ['rateLimits', 'cost'],
  })

  expect(await ui.find({ type: 'Text', text: /5h limit 50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$3\.00/ })).toBeDefined()
  // The categories stay as last measured
  expect(await ui.find({ type: 'Text', text: /system tools/ })).toBeDefined()
  await ui.unmount()
})

// Stands for the prompt box: records each suggestion, shown while `isIdle` says so
const promptBox = (on: On, isIdle: () => boolean = () => true) => {
  const suggested: { text: string; from: string }[] = []
  on('prompt.suggest', (_, e) => {
    suggested.push({ text: e.text, from: e.origin.kind })
    return { isShown: isIdle() }
  })
  return suggested
}

// Records each toast's text
const toastStack = (on: On) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

test('crossing 60% toasts a /compact nudge once', async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  promptBox(on)
  const toasts = toastStack(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(toasts).toEqual(['🧹 Conversation context is 62% full · run /compact to free up space'])

  // Still over 60%: no second toast
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})

test('over 60% the band hints at /compact and the prompt suggests it once', async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on, { view: 'full' })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const suggested = promptBox(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /over 60% · consider running \/compact/ })).toBeDefined()

  // Still over 60%: no second suggestion
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  expect(suggested.map(s => s.text)).toEqual(['/compact'])

  await $.command.run({ ...SYAQ, args: 'slim' })
  expect(await ui.find({ type: 'Text', text: /·  run \/compact/ })).toBeDefined()
  await ui.unmount()
})

test('a busy prompt box gets /compact after the next turn', async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  let isIdle = false
  const suggested = promptBox(on, () => isIdle)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  // Each measurement at start tries, and the busy box refuses
  const refused = suggested.length
  expect(refused).toBeGreaterThan(0)

  // The turn ends: the box is free and the suggestion lands
  isIdle = true
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 2 }, changed: ['cost'] })
  expect(suggested).toHaveLength(refused + 1)

  // Shown: nothing more to suggest
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 3 }, changed: ['cost'] })
  expect(suggested).toHaveLength(refused + 1)
  await ui.unmount()
})

test("Claude Code's own suggestion gives way to a pending /compact", async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on)
  let isIdle = false
  const suggested = promptBox(on, () => isIdle)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  isIdle = true
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  expect(suggested.at(-1)).toEqual({ text: '/compact', from: 'suggestion' })

  // Once taken, the next guess goes through as is
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  expect(suggested.at(-1)?.text).toBe('run the tests')
  await ui.unmount()
})

test('under 60% nothing suggests /compact', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on)
  const suggested = promptBox(on)
  const toasts = toastStack(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /\/compact/ })).toBeUndefined()
  expect(suggested).toEqual([])
  expect(toasts).toEqual([])
  await ui.unmount()
})

test('the compactAt setting moves where the band suggests /compact', { options: { compactAt: 70 } }, async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on, { view: 'full' })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const toasts = toastStack(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  // 62% is under the 70% set: no hint, no toast, a green badge
  expect(await ui.find({ type: 'Text', text: /\/compact/ })).toBeUndefined()
  expect(toasts).toEqual([])
  expect((await ui.find({ type: 'Text', text: /^ 62% $/ }))?.props.backgroundColor).toBe('success')
  await ui.unmount()
})

test('past a lowered compactAt the band suggests /compact', { options: { compactAt: 5 } }, async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on, { view: 'full' })
  promptBox(on)
  const toasts = toastStack(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /over 5% · consider running \/compact/ })).toBeDefined()
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})

// Stands for /config, recording each change
const configMenu = (on: On) => {
  const changes: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => {
    changes.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  return changes
}

test('/syaq at sets the compactAt setting and names a bad percent', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on)
  const changes = configMenu(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ ...SYAQ, args: 'at 70%' })).text).toBe('Suggests /compact from 70%')
  expect(changes).toEqual([{ key: 'syaq.compactAt', value: 70 }])

  for (const args of ['at', 'at 0', 'at 100', 'at lots']) {
    expect((await $.command.run({ ...SYAQ, args })).text).toMatch(/from 1 to 99/)
  }
  expect(changes).toHaveLength(1)
})

test('both views keep the engine colours, the same in each', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Wide enough that every category gets cells
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 } })

  const swatches = await ui.findAll({ type: 'Text', text: /^■ $/ })
  expect(swatches.map(f => f.props.color)).toEqual(['inactive', 'subtle', 'purple', 'subtle'])
  const fullBar = (await ui.findAll({ type: 'Text', text: /^█+$/ })).map(f => f.props.color)
  expect(fullBar).toEqual(['inactive', 'subtle', 'purple'])

  await $.command.run({ ...SYAQ, args: 'slim' })
  const slimBar = (await ui.findAll({ type: 'Text', text: /^█+$/ })).map(f => f.props.color)
  expect(slimBar).toEqual(fullBar)
  await ui.unmount()
})

test('past the five largest categories, the rest share one "other" entry', async ($, on) => {
  seedUsage(on, {
    extra: [
      row('Skills', 9000, 'cyan', 'used'),
      row('Memory files', 6000, 'permission', 'used'),
      row('Custom agents', 5000, 'ide', 'used'),
      row('MCP instructions', 2000, 'remember', 'used'),
    ],
  })
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /custom agents 5k/ })).toBeDefined()
  // System prompt 4.2k and MCP instructions 2k: listed however small
  expect(await ui.find({ type: 'Text', text: /other 6\.2k <1%/ })).toBeDefined()
  // Not grey: the first colour no shown category uses (teal, planMode)
  const swatches = await ui.findAll({ type: 'Text', text: /^■ $/ })
  expect(swatches.map(f => f.props.color)).toContain('planMode')
  expect(swatches.map(f => f.props.color).filter(c => c === 'planMode')).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /system prompt/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /mcp instructions/ })).toBeUndefined()
  await ui.unmount()
})

const atWidth = (bodyColumns: number) => ({ ...BAND, props: { ...BAND.props, bodyColumns } })

test('a medium terminal drops the reference figures and shortens the rest', async ($, on) => {
  seedUsage(on, {
    total: 620_000,
    extra: [
      row('Skills', 9000, 'cyan', 'used'),
      row('Memory files', 6000, 'permission', 'used'),
      row('Custom agents', 5000, 'ide', 'used'),
    ],
  })
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(atWidth(80))

  // Header: a shorter hint, no auto-compact point (the ┃ marks it)
  expect(await ui.find({ type: 'Text', text: /over 60% · run \/compact/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /consider running/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /auto-compacts/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /┃/ })).toBeDefined()
  // Legend: the three largest, the rest as "other", no free space
  expect(await ui.find({ type: 'Text', text: /messages 69k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /other 15k 2%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /memory files/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /free space/ })).toBeUndefined()
  // Footer: short labels, no "model" or "session"
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^model $/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^week $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$1\.50$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session/ })).toBeUndefined()
  await ui.unmount()
})

test('a narrow terminal keeps the badge, the bar, the hint and the limits', async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(atWidth(60))

  expect(await ui.find({ type: 'Text', text: /^  run \/compact$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\/1M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /62%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h $/ })).toBeDefined()
  // No legend, model or cost
  expect(await ui.find({ type: 'Text', text: /■/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.50/ })).toBeUndefined()
  await ui.unmount()
})

test('a very narrow terminal draws the slim layout and keeps the chosen view', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const narrow = await $.ui.mount(atWidth(40))
  expect(await narrow.find({ type: 'Text', text: /90k\/1M/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /Context/ })).toBeUndefined()
  await narrow.unmount()

  // Wide again: the full view is back
  const wide = await $.ui.mount(BAND)
  expect(await wide.find({ type: 'Text', text: /Context/ })).toBeDefined()
  await wide.unmount()
})

test('the legend lowercases category names but keeps acronyms', async ($, on) => {
  seedUsage(on, { extra: [row('MCP server instructions', 1400, 'cyan', 'used')] })
  drawEngine(on)
  mock.store(on, { view: 'full' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^MCP server instructions $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^system prompt $/ })).toBeDefined()
  await ui.unmount()
})

// The chip beside the label and the cells the sweep draws, at this step
// The icon's glyph, read off the Text that holds it and its space
const iconOf = async (ui: { find: Function }) =>
  (await ui.find({ type: 'Text', text: /^[●⬮│] $/ }))?.text?.trim()

const pulseOf = async (ui: { find: Function; findAll: Function }) => {
  const chip = await ui.find({ type: 'Text', text: /^  ([+−]|freed)/ })
  const cells = await ui.findAll({ type: 'Text', text: /^█+$/ })
  return {
    chip: chip?.text?.trim(),
    chipProps: chip?.props,
    green: cells.filter((c: { props: { color?: string } }) => c.props.color === 'success').length,
  }
}

test('a grown fill turns the icon edge-on and back, with no chip or sweep', async ($, on) => {
  let total = 90_000
  seedUsage(on, { total: () => total })
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  // The first measurement has nothing to move from
  expect(await iconOf(ui)).toBe('●')

  total = 120_000
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  const seen = [await iconOf(ui)]
  for (let i = 0; i < 3; i++) {
    await clock.advance(240)
    seen.push(await iconOf(ui))
  }
  expect(seen).toEqual(['⬮', '│', '⬮', '●'])
  // The bar and the label keep still
  const fresh = await pulseOf(ui)
  expect(fresh.chip).toBeUndefined()
  expect(fresh.green).toBe(0)
  expect(await ui.find({ type: 'Text', text: /^  \+/ })).toBeUndefined()
  await ui.unmount()
})

test('a freed fill flashes the freed cells green and names what it freed', async ($, on) => {
  let total = 120_000
  seedUsage(on, { total: () => total })
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  total = 40_000
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  const fresh = await pulseOf(ui)
  expect(fresh.chip).toBe('−80k freed')
  expect(fresh.chipProps?.color).toBe('success')
  expect(fresh.green).toBeGreaterThan(0)

  await clock.advance(180 * 10)
  expect(await pulseOf(ui)).toMatchObject({ chip: undefined, green: 0 })
  await ui.unmount()
})

test('/compact pulses even before the usage shows the drop, and once', async ($, on) => {
  let total = 90_000
  seedUsage(on, { total: () => total })
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const summary: SessionMessage[] = [{ role: 'user', text: 'The summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary, tokensBefore: 90_000, tokensAfter: 40_000 }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  // The usage still reads the old size when the compaction returns
  await $.session.compact({ trigger: 'manual', messages: summary })
  const fresh = await pulseOf(ui)
  expect(fresh.chip).toBe('−50k freed')
  expect(fresh.green).toBeGreaterThan(0)
  await clock.advance(180 * 10)

  // The measurement that catches up does not play it again
  total = 40_000
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  expect((await pulseOf(ui)).chip).toBeUndefined()
  await ui.unmount()
})

test('the slim view pulses /compact too', async ($, on) => {
  seedUsage(on, { total: () => 90_000 })
  drawEngine(on)
  mock.store(on, { view: 'slim' })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const summary: SessionMessage[] = [{ role: 'user', text: 'The summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary, tokensBefore: 90_000, tokensAfter: 40_000 }))
  mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  await $.session.compact({ trigger: 'manual', messages: summary })
  const fresh = await pulseOf(ui)
  expect(fresh.chip).toBe('−50k freed')
  expect(fresh.green).toBeGreaterThan(0)
  // The bar makes room for the chip, so the one line still fits inside the border
  const texts: { props: { wrap?: string }; text: string }[] = await ui.findAll({ type: 'Text' })
  const line = texts.find(t => t.props.wrap === 'truncate-end')
  expect(line?.text.length).toBeLessThanOrEqual(BAND.props.bodyColumns - 4)
  await ui.unmount()
})

test('a measurement that leaves the fill alone does not pulse', async ($, on) => {
  seedUsage(on)
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('claude')
  await ui.unmount()
})

test('past the point the icon keeps its colour', async ($, on) => {
  seedUsage(on, { total: 620_000 })
  drawEngine(on)
  mock.store(on)
  toastStack(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('claude')
  await ui.unmount()
})

test('moves during a turn wait for the spinner to go, then pulse as one', async ($, on) => {
  let total = 90_000
  seedUsage(on, { total: () => total })
  drawEngine(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  const measure = () => $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  // A subagent's turn ends inside the main one and keeps it still
  await $.turn.start({ text: 'look', turnId: 't2', agentId: 'a1' })
  total = 100_000
  await measure()
  total = 120_000
  await measure()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  await clock.advance(240)
  expect(await iconOf(ui)).toBe('●')

  // The whole turn's growth, once
  await $.turn.complete({ answer: 'hello', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await iconOf(ui)).toBe('⬮')
  await clock.advance(240 * 3)
  expect(await iconOf(ui)).toBe('●')
  await ui.unmount()
})
