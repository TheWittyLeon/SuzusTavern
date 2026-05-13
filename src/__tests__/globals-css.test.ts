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
})
