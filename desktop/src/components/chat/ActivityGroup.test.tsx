import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ActivityGroup } from './ActivityGroup'
import { buildActivitySegments, type ActivityStep } from './activityGroupModel'
import { useSettingsStore } from '../../stores/settingsStore'
import { translate } from '../../i18n'
import type { UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

function toolCall(overrides: Partial<ToolCall> & Pick<ToolCall, 'id' | 'toolUseId' | 'toolName'>): ToolCall {
  return {
    type: 'tool_use',
    input: {},
    timestamp: 0,
    ...overrides,
  }
}

function toolResult(overrides: Partial<ToolResult> & Pick<ToolResult, 'id' | 'toolUseId'>): ToolResult {
  return {
    type: 'tool_result',
    content: 'ok',
    isError: false,
    timestamp: 0,
    ...overrides,
  }
}

function thinkingStep(id: string, content: string, timestamp = 0): ActivityStep {
  return { kind: 'thinking', message: { id, type: 'thinking', content, timestamp } }
}

function resultsOf(results: ToolResult[]): Map<string, ToolResult> {
  return new Map(results.map((result) => [result.toolUseId, result]))
}

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params)

describe('ActivityGroup', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  const readCall = toolCall({
    id: 'use-read',
    toolUseId: 'read-1',
    toolName: 'Read',
    input: { file_path: '/repo/src/MessageList.tsx' },
    timestamp: 1_000,
  })
  const bashCall = toolCall({
    id: 'use-bash',
    toolUseId: 'bash-1',
    toolName: 'Bash',
    input: { command: 'bun run lint' },
    timestamp: 2_000,
  })

  it('collapses a thinking + tool run into one header instead of a card per step', () => {
    const steps: ActivityStep[] = [
      thinkingStep('think-1', 'Locate the five call sites first, then patch each file.', 500),
      { kind: 'tool', toolCall: readCall },
      { kind: 'tool', toolCall: bashCall },
    ]

    render(
      <ActivityGroup
        steps={steps}
        resultMap={resultsOf([
          toolResult({ id: 'res-read', toolUseId: 'read-1', timestamp: 2_400 }),
          toolResult({ id: 'res-bash', toolUseId: 'bash-1', timestamp: 5_700 }),
        ])}
        childToolCallsByParent={new Map()}
      />,
    )

    const header = screen.getByRole('button', { expanded: false })
    expect(header.textContent).toContain('Thinking')
    expect(header.textContent).toContain('Read 1 file')
    expect(header.textContent).toContain('ran a command')
    // Whole-run wall clock: first step start (500) to last result (5700).
    expect(header.textContent).toContain('5.2s')

    // Nothing from the individual steps is on screen until the run is opened.
    expect(screen.queryByText('MessageList.tsx')).toBeNull()
    expect(screen.queryByText('bun run lint')).toBeNull()
    expect(screen.queryByText(/Locate the five call sites/)).toBeNull()
  })

  it('reveals the thinking preview and one row per tool once expanded', () => {
    const steps: ActivityStep[] = [
      thinkingStep('think-1', '- Locate the five call sites first.\nThen patch each file.', 500),
      { kind: 'tool', toolCall: readCall },
      { kind: 'tool', toolCall: bashCall },
    ]

    render(
      <ActivityGroup
        steps={steps}
        resultMap={resultsOf([toolResult({ id: 'res-read', toolUseId: 'read-1', timestamp: 2_400 })])}
        childToolCallsByParent={new Map()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    const group = screen.getByTestId('activity-group')
    expect(group.getAttribute('data-expanded')).toBe('true')
    // The bullet marker is stripped: a row is one line, not rendered markdown.
    expect(within(group).getByText('Locate the five call sites first.')).toBeTruthy()
    expect(within(group).getByText('MessageList.tsx')).toBeTruthy()
    expect(within(group).getByText('bun run lint')).toBeTruthy()
  })

  it('makes a lone tool call its own header row rather than hiding it behind a summary', () => {
    render(
      <ActivityGroup
        steps={[{ kind: 'tool', toolCall: readCall }]}
        resultMap={resultsOf([toolResult({ id: 'res-read', toolUseId: 'read-1', timestamp: 2_400 })])}
        childToolCallsByParent={new Map()}
      />,
    )

    const group = screen.getByTestId('activity-group')
    expect(group.getAttribute('data-single-step')).toBe('true')
    // The file is readable without a click; "Read 1 file" would say less.
    expect(within(group).getByText('MessageList.tsx')).toBeTruthy()
    expect(within(group).queryByText('Read 1 file')).toBeNull()
  })

  it('counts failed steps in the header while the run still reports its duration', () => {
    render(
      <ActivityGroup
        steps={[
          { kind: 'tool', toolCall: readCall },
          { kind: 'tool', toolCall: bashCall },
        ]}
        resultMap={resultsOf([
          toolResult({ id: 'res-read', toolUseId: 'read-1', timestamp: 1_400 }),
          toolResult({
            id: 'res-bash',
            toolUseId: 'bash-1',
            content: 'IndentationError',
            isError: true,
            timestamp: 3_000,
          }),
        ])}
        childToolCallsByParent={new Map()}
      />,
    )

    expect(screen.getByText(t('toolGroup.failedCount', { count: 1 }))).toBeTruthy()
  })

  it('does not claim a duration while a step is still unresolved', () => {
    render(
      <ActivityGroup
        steps={[
          { kind: 'tool', toolCall: readCall },
          { kind: 'tool', toolCall: bashCall },
        ]}
        resultMap={resultsOf([toolResult({ id: 'res-read', toolUseId: 'read-1', timestamp: 1_400 })])}
        childToolCallsByParent={new Map()}
      />,
    )

    const header = screen.getByRole('button', { expanded: false })
    expect(header.textContent).not.toMatch(/\d+(\.\d+)?(ms|s)\b/)
    expect(screen.getByTestId('activity-group').getAttribute('data-running')).toBe('true')
  })

  it('reports a run as finished once every step has a result', () => {
    render(
      <ActivityGroup
        steps={[
          { kind: 'tool', toolCall: readCall },
          { kind: 'tool', toolCall: bashCall },
        ]}
        resultMap={resultsOf([
          toolResult({ id: 'res-read', toolUseId: 'read-1', timestamp: 1_400 }),
          toolResult({ id: 'res-bash', toolUseId: 'bash-1', timestamp: 3_000 }),
        ])}
        childToolCallsByParent={new Map()}
      />,
    )

    expect(screen.getByTestId('activity-group').getAttribute('data-running')).toBe('false')
  })
})

describe('buildActivitySegments', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('keeps families in first-appearance order and counts repeats', () => {
    const segments = buildActivitySegments(
      [
        { kind: 'tool', toolCall: toolCall({ id: 'a', toolUseId: 'a', toolName: 'Bash' }) },
        { kind: 'tool', toolCall: toolCall({ id: 'b', toolUseId: 'b', toolName: 'Read' }) },
        { kind: 'tool', toolCall: toolCall({ id: 'c', toolUseId: 'c', toolName: 'Read' }) },
      ],
      t,
    )

    expect(segments.map((segment) => segment.label)).toEqual(['ran a command', 'Read 2 files'])
  })

  it('places thinking where it happened and never counts it', () => {
    const segments = buildActivitySegments(
      [
        { kind: 'tool', toolCall: toolCall({ id: 'a', toolUseId: 'a', toolName: 'Bash' }) },
        thinkingStep('t1', 'first'),
        thinkingStep('t2', 'second'),
      ],
      t,
    )

    expect(segments.map((segment) => segment.label)).toEqual(['ran a command', 'Thinking'])
  })

  it('falls back to a named count for tools with no verb', () => {
    const segments = buildActivitySegments(
      [{ kind: 'tool', toolCall: toolCall({ id: 'a', toolUseId: 'a', toolName: 'TaskUpdate' }) }],
      t,
    )

    expect(segments.map((segment) => segment.label)).toEqual(['TaskUpdate (1)'])
  })
})
