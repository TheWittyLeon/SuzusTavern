import { render, screen } from '@testing-library/react'
import LoginPage from '@/app/login/page'

describe('Login page', () => {
  it('renders without throwing', () => {
    render(<LoginPage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
