import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CliRuntimeSelector } from './CliRuntimeSelector'

describe('CliRuntimeSelector', () => {
  it('sends the selected runtime through the session action', async () => {
    const onChange = vi.fn()
    render(
      <CliRuntimeSelector
        effectiveRuntime="bundled"
        requestedRuntime="bundled"
        status="applied"
        hasInstalledRuntime
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /CLI runtime/i }))
    fireEvent.click(screen.getByRole('option', { name: 'Installed' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('installed'))
  })

  it('does not allow installed selection when no installed runtime is configured', () => {
    render(
      <CliRuntimeSelector
        effectiveRuntime="bundled"
        requestedRuntime="bundled"
        status="applied"
        hasInstalledRuntime={false}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /CLI runtime/i }))
    expect(screen.queryByRole('option', { name: 'Installed' })).toBeNull()
  })
})
