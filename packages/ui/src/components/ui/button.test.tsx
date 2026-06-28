import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('applies default variant class', () => {
    const { container } = render(<Button>Default</Button>)
    const btn = container.querySelector('button')
    expect(btn?.className).toMatch(/bg-accent/)
  })

  it('applies outline variant class', () => {
    const { container } = render(<Button variant="outline">Out</Button>)
    const btn = container.querySelector('button')
    expect(btn?.className).toMatch(/border/)
  })
})
