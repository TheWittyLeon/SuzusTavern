import { render, screen } from '@testing-library/react'
import LandingPage from '@/app/page'

describe('Landing page', () => {
  it('renders without throwing', () => {
    render(<LandingPage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('has a single h1 with the hero headline', () => {
    render(<LandingPage />)
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    // Check key words from the headline are present (the em split doesn't matter)
    expect(headings[0]).toHaveTextContent(/dungeon master/i)
    expect(headings[0]).toHaveTextContent(/Twice/i)
  })

  it('renders the three "How it works" card titles', () => {
    render(<LandingPage />)
    expect(
      screen.getByRole('heading', { level: 3, name: /1 — Pick a story/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /2 — Roll a character/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /3 — Play/i }),
    ).toBeInTheDocument()
  })

  it('renders the six capability card titles', () => {
    render(<LandingPage />)
    expect(
      screen.getByRole('heading', { level: 3, name: /Living memory/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /A codex you can ask/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /Encounter math, live/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /Transparent rolls/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /Four palettes, one product/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /Safety tools, on by default/i }),
    ).toBeInTheDocument()
  })

  it('Sign in CTA links to /login', () => {
    render(<LandingPage />)
    // There are two "Sign in" / login links — header and story section
    const loginLinks = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('href') === '/login')
    expect(loginLinks.length).toBeGreaterThanOrEqual(1)
  })

  it('does not render out-of-scope pricing content', () => {
    render(<LandingPage />)
    expect(screen.queryByText(/Pricing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$9/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$24/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pour a round/i)).not.toBeInTheDocument()
  })

  it('does not render out-of-scope books content', () => {
    render(<LandingPage />)
    expect(
      screen.queryByText(/bring your own books/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Your books/i)).not.toBeInTheDocument()
  })

  it('does not render the fabricated hero stat row', () => {
    render(<LandingPage />)
    expect(screen.queryByText(/1,284/)).not.toBeInTheDocument()
    expect(screen.queryByText(/active campaigns/i)).not.toBeInTheDocument()
  })

  it('renders the story section with the why quote', () => {
    render(<LandingPage />)
    expect(screen.getByText(/The why/i)).toBeInTheDocument()
    expect(screen.getByText(/everyone, all the time/i)).toBeInTheDocument()
  })

  it('renders the footer copyright line', () => {
    render(<LandingPage />)
    expect(
      screen.getByText(/© 2026 Aurora Tavern/i),
    ).toBeInTheDocument()
  })
})
