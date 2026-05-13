import { render, screen } from '@testing-library/react'
import DashboardPage from '@/app/dashboard/page'

describe('Dashboard page', () => {
  it('renders without throwing', () => {
    render(<DashboardPage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders an h1 heading', () => {
    render(<DashboardPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
