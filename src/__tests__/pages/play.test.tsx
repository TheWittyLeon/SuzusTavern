import { render, screen } from '@testing-library/react'
import PlayPage from '@/app/play/[sessionId]/page'

describe('Play page', () => {
  it('renders without throwing', () => {
    render(<PlayPage params={{ sessionId: 'test-session' }} />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<PlayPage params={{ sessionId: 'test-session' }} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
