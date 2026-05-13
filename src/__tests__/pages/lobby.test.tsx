import { render, screen } from '@testing-library/react'
import LobbyPage from '@/app/lobby/page'

describe('Lobby page', () => {
  it('renders without throwing', () => {
    render(<LobbyPage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<LobbyPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
