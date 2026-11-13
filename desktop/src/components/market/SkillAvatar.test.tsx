import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SkillAvatar } from '@/components/market/SkillAvatar'

describe('SkillAvatar image failures', () => {
  it.each([32, 40, 56])('replaces a failed image with the themed initial at size %i', size => {
    const { container } = render(
      <SkillAvatar skill={{ name: '  技能', iconUrl: 'https://example.invalid/icon.png' }} size={size} className="custom-avatar" />,
    )

    fireEvent.error(container.querySelector('img')!)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    const fallback = screen.getByTestId('skill-avatar-fallback')
    expect(fallback).toHaveTextContent('技')
    expect(fallback).toHaveAttribute('aria-hidden', 'true')
    expect(fallback).toHaveStyle({ width: `${size}px`, height: `${size}px` })
    expect(fallback).toHaveClass('custom-avatar', 'bg-[var(--color-surface-container)]')
  })

  it('tries a changed URL after failure and falls back again if that image fails', () => {
    const { container, rerender } = render(
      <SkillAvatar skill={{ name: 'Demo', iconUrl: 'https://example.invalid/old.png' }} />,
    )
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByTestId('skill-avatar-fallback')).toHaveTextContent('D')

    rerender(<SkillAvatar skill={{ name: 'New', iconUrl: 'https://example.invalid/new.png' }} />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.invalid/new.png')
    expect(screen.queryByTestId('skill-avatar-fallback')).not.toBeInTheDocument()

    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByTestId('skill-avatar-fallback')).toHaveTextContent('N')
  })

  it('keeps a failed URL on the fallback when only the name changes', () => {
    const { container, rerender } = render(
      <SkillAvatar skill={{ name: 'Demo', iconUrl: 'https://example.invalid/icon.png' }} />,
    )
    fireEvent.error(container.querySelector('img')!)

    rerender(<SkillAvatar skill={{ name: 'Other', iconUrl: 'https://example.invalid/icon.png' }} />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('skill-avatar-fallback')).toHaveTextContent('O')
  })
})
