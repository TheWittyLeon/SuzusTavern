import fs from 'fs'
import path from 'path'

describe('globals.css token verification', () => {
  let cssContent: string

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/globals.css'),
      'utf8'
    )
  })

  it('contains the hearthlight palette', () => {
    expect(cssContent).toContain('data-vibe="hearthlight"')
  })

  it('contains the dusk-tavern palette', () => {
    expect(cssContent).toContain('data-vibe="dusk-tavern"')
  })

  it('contains the candlelit palette', () => {
    expect(cssContent).toContain('data-vibe="candlelit"')
  })

  it('contains the aetheric palette', () => {
    expect(cssContent).toContain('data-vibe="aetheric"')
  })

  it('contains the moonlit-grove palette', () => {
    expect(cssContent).toContain('data-vibe="moonlit-grove"')
  })

  it('contains the --bg token', () => {
    expect(cssContent).toContain('--bg:')
  })

  it('contains the --accent token', () => {
    expect(cssContent).toContain('--accent:')
  })

  it('contains the --font-display token', () => {
    expect(cssContent).toContain('--font-display:')
  })

  it('contains the --radius token', () => {
    expect(cssContent).toContain('--radius:')
  })

  it('has Google Fonts import as the first non-comment content', () => {
    // The @import for Google Fonts must appear before any rule declarations
    const importIndex = cssContent.indexOf("@import url('https://fonts.googleapis.com")
    const firstRuleIndex = cssContent.indexOf(':root')
    expect(importIndex).toBeGreaterThan(-1)
    expect(importIndex).toBeLessThan(firstRuleIndex)
  })

  it('has forced-colors focus fallback for .input', () => {
    // Iro MINOR-2: .input:focus must have a forced-colors override so
    // box-shadow + color-mix don't silently vanish under Windows High Contrast.
    expect(cssContent).toContain('forced-colors: active')
    expect(cssContent).toContain('outline: 2px solid Highlight')
  })

  it('has a global select color-scheme rule so native <select> popups follow the active vibe', () => {
    // Dark-mode dropdown fix: a styled select with a custom background loses
    // the inherited color-scheme in the browser's popup renderer, so the open
    // option list renders light even in dark vibes. This global rule fixes
    // CastSpellPanel/ConditionsPanel/GrantCurrencyPanel/DmOverrideModal at once.
    expect(cssContent).toMatch(/select\s*\{\s*color-scheme:\s*inherit;?\s*\}/)
  })

  it('has a global select option rule using solid theme tokens', () => {
    const optionBlock = cssContent.match(/select option\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(optionBlock).toContain('var(--card-solid)')
    expect(optionBlock).toContain('var(--ink)')
  })
})

describe('A11Y-BUTTON-BORDER-CONTRAST: --line-strong meets WCAG 1.4.11 (3:1 non-text)', () => {
  // jsdom can't compute real CSS color-mix/rgba composites, so this proves
  // the token math directly from the source values (regex-extracted from
  // globals.css) rather than faking a rendered-DOM contrast check.
  let cssContent: string

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/globals.css'),
      'utf8'
    )
  })

  function relLuminance([r, g, b]: [number, number, number]): number {
    const chan = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
  }

  function contrast(a: [number, number, number], b: [number, number, number]): number {
    const l1 = relLuminance(a)
    const l2 = relLuminance(b)
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
    return (hi + 0.05) / (lo + 0.05)
  }

  /** Alpha-composite an rgba(r,g,b,a) foreground over an opaque bg. */
  function blendOver(
    fg: [number, number, number],
    alpha: number,
    bg: [number, number, number],
  ): [number, number, number] {
    return [
      fg[0] * alpha + bg[0] * (1 - alpha),
      fg[1] * alpha + bg[1] * (1 - alpha),
      fg[2] * alpha + bg[2] * (1 - alpha),
    ]
  }

  function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }

  /** Extract `--token: <value>;` from a specific `[data-vibe="X"] { ... }` (or
   *  the shared `:root` block, for dusk-tavern which shares its rule). */
  function extractInBlock(vibeSelector: RegExp, token: string): string {
    const blockMatch = cssContent.match(
      new RegExp(`${vibeSelector.source}[^{]*\\{([\\s\\S]*?)\\n\\}`, 'm'),
    )
    if (!blockMatch) throw new Error(`Could not find block for ${vibeSelector}`)
    const tokenMatch = blockMatch[1].match(
      new RegExp(`--${token}:\\s*([^;]+);`),
    )
    if (!tokenMatch) throw new Error(`Could not find --${token} in block ${vibeSelector}`)
    return tokenMatch[1].trim()
  }

  function parseRgba(value: string): { rgb: [number, number, number]; alpha: number } {
    const m = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (!m) throw new Error(`Not an rgba() value: ${value}`)
    return {
      rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
      alpha: m[4] !== undefined ? Number(m[4]) : 1,
    }
  }

  const VIBES: { name: string; selector: RegExp }[] = [
    { name: 'hearthlight', selector: /\[data-vibe="hearthlight"\]/ },
    { name: 'dusk-tavern', selector: /:root,\s*\[data-vibe="dusk-tavern"\]/ },
    { name: 'candlelit', selector: /\[data-vibe="candlelit"\]/ },
    { name: 'aetheric', selector: /\[data-vibe="aetheric"\]/ },
    { name: 'moonlit-grove', selector: /\[data-vibe="moonlit-grove"\]/ },
  ]

  it.each(VIBES)(
    '$name: --line-strong composited over --bg clears 3:1 (was ~1.2-1.3:1 for --line)',
    ({ selector }) => {
      const bgHex = extractInBlock(selector, 'bg')
      const lineStrong = parseRgba(extractInBlock(selector, 'line-strong'))
      const bg = hexToRgb(bgHex)
      const composite = blendOver(lineStrong.rgb, lineStrong.alpha, bg)
      expect(contrast(composite, bg)).toBeGreaterThanOrEqual(3.0)
    },
  )

  it.each(VIBES)(
    '$name: --line-strong composited over --card-solid also clears 3:1',
    ({ selector }) => {
      const cardHex = extractInBlock(selector, 'card-solid')
      const lineStrong = parseRgba(extractInBlock(selector, 'line-strong'))
      const card = hexToRgb(cardHex)
      const composite = blendOver(lineStrong.rgb, lineStrong.alpha, card)
      expect(contrast(composite, card)).toBeGreaterThanOrEqual(3.0)
    },
  )

  it.each(VIBES)('$name: --line alone (the hairline default) still FAILS 3:1, proving this is a real fix not a no-op', ({ selector }) => {
    const bgHex = extractInBlock(selector, 'bg')
    const line = parseRgba(extractInBlock(selector, 'line'))
    const bg = hexToRgb(bgHex)
    const composite = blendOver(line.rgb, line.alpha, bg)
    expect(contrast(composite, bg)).toBeLessThan(3.0)
  })
})

describe('A11Y-BUTTON-BORDER-CONTRAST: flagged buttons use --line-strong, not the low-contrast --line', () => {
  it('.xCardBannerDismiss and .safetyBtns button border on --line-strong', () => {
    const playCss = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/app/play/[sessionId]/Play.module.css',
      ),
      'utf8',
    )
    const xCardBlock = playCss.match(/\.xCardBannerDismiss\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    const safetyBlock = playCss.match(/\.safetyBtns button\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(xCardBlock).toContain('var(--line-strong)')
    expect(xCardBlock).not.toContain('border: 1px solid var(--line);')
    expect(safetyBlock).toContain('var(--line-strong)')
    expect(safetyBlock).not.toContain('border: 1px solid var(--line);')
  })
})
