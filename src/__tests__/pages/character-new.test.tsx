import { render, screen } from '@testing-library/react'
import CharacterNewPage from '@/app/character/new/page'

describe('Character new page', () => {
  it('renders without throwing', () => {
    render(<CharacterNewPage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<CharacterNewPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
