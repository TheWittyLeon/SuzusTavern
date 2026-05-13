import { render } from '@testing-library/react'
import Card from '@/components/Card'
import Button from '@/components/Button'
import Pill from '@/components/Pill'
import Die from '@/components/Die'
import Avatar from '@/components/Avatar'
import SuzuDM from '@/components/SuzuDM'
import Icon from '@/components/Icon'

describe('Component stubs', () => {
  it('Card mounts without throwing', () => {
    const { container } = render(<Card />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="Card"]')).toBeInTheDocument()
  })

  it('Button mounts without throwing', () => {
    const { container } = render(<Button />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="Button"]')).toBeInTheDocument()
  })

  it('Pill mounts without throwing', () => {
    const { container } = render(<Pill />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="Pill"]')).toBeInTheDocument()
  })

  it('Die mounts without throwing', () => {
    const { container } = render(<Die />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="Die"]')).toBeInTheDocument()
  })

  it('Avatar mounts without throwing', () => {
    const { container } = render(<Avatar />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="Avatar"]')).toBeInTheDocument()
  })

  it('SuzuDM mounts without throwing', () => {
    const { container } = render(<SuzuDM />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="SuzuDM"]')).toBeInTheDocument()
  })

  it('Icon mounts without throwing', () => {
    const { container } = render(<Icon />)
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('[data-component="Icon"]')).toBeInTheDocument()
  })
})
