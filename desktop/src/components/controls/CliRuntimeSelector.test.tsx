import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
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
    fireEvent.click(screen.getByRole('option', { name: 'External' }))

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
    expect(screen.queryByRole('option', { name: 'External' })).toBeNull()
  })

  it('shows the effective runtime while a failed switch is on screen', () => {
    // The server rolls a failed switch back and re-acks the runtime that is
    // actually running. Showing the rejected request here would leave the
    // selector on a choice the session is not using.
    render(
      <CliRuntimeSelector
        effectiveRuntime="bundled"
        requestedRuntime="installed"
        status="failed"
        hasInstalledRuntime
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /CLI runtime/i }))
    expect(screen.getByRole('option', { name: 'EchoFlow Managed' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('option', { name: 'External' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })
})
