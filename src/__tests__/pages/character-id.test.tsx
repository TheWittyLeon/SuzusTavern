import { render, screen } from '@testing-library/react'
import CharacterPage from '@/app/character/[id]/page'

describe('Character page', () => {
  it('renders without throwing', () => {
    render(<CharacterPage params={{ id: 'test-id' }} />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<CharacterPage params={{ id: 'test-id' }} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
