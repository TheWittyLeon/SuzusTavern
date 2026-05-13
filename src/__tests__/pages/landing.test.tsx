import { render, screen } from '@testing-library/react'
import LandingPage from '@/app/page'

describe('Landing page', () => {
  it('renders without throwing', () => {
    render(<LandingPage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<LandingPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
