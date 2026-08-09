import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { ToolCallBlock, formatDuration } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import {
  activityDurationMs,
  activityStepToolCalls,
  buildActivitySegments,
  countFailedToolCalls,
  hasUnresolvedToolCalls,
  THINKING_SEGMENT_KEY,
  toolCallDurationMs,
  type ActivityStep,
} from './activityGroupModel'
import { useTranslation } from '../../i18n'
import type { UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  steps: ActivityStep[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  activeThinkingId?: string | null
  /** When true, the last step is still executing. */
  isStreaming?: boolean
}

/**
 * One contiguous run of thinking + tool calls, rendered as a single collapsed
 * line instead of one card per step (#1177). Expanding reveals a left-ruled
 * timeline of borderless rows; only a row the reader opens gets its own card.
 *
 * A run holding exactly one tool call skips the summary header entirely: "Read 1
 * file" over a hidden `Read MessageList.tsx` row is strictly less information
 * than the row itself, so the row becomes the header.
 */
export const ActivityGroup = memo(function ActivityGroup({
  steps,
  resultMap,
  childToolCallsByParent,
  activeThinkingId,
  isStreaming,
}: Props) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => {
    setExpanded((value) => !value)
  }, [])

  const toolCalls = useMemo(() => activityStepToolCalls(steps), [steps])
  const segments = useMemo(() => buildActivitySegments(steps, t), [steps, t])
  const failedCount = countFailedToolCalls(toolCalls, resultMap, childToolCallsByParent)
  const hasActiveThinking = Boolean(activeThinkingId) && steps.some(
    (step) => step.kind === 'thinking' && step.message.id === activeThinkingId,
  )
  const isRunning =
    Boolean(isStreaming) ||
    hasActiveThinking ||
    hasUnresolvedToolCalls(toolCalls, resultMap, childToolCallsByParent)

  const soleToolCall = steps.length === 1 && steps[0]?.kind === 'tool' ? steps[0].toolCall : null
  if (soleToolCall) {
    return (
      <div className="mb-3">
        <div
          data-testid="activity-group"
          data-single-step="true"
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-1.5"
        >
          <ActivityToolRow
            toolCall={soleToolCall}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
          />
        </div>
      </div>
    )
  }

  const elapsed = activityDurationMs(steps, resultMap)
  const durationLabel = !isRunning && typeof elapsed === 'number' ? formatDuration(elapsed) : ''
  const headerText = segments.map((segment) => segment.label).join(' · ')

  return (
    <div className="mb-3">
      <div
        data-testid="activity-group"
        data-expanded={expanded ? 'true' : 'false'}
        data-running={isRunning ? 'true' : 'false'}
        className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] transition-colors ${
          expanded ? 'bg-[var(--color-surface-container-lowest)]' : 'bg-transparent'
        }`}
      >
        <button
          type="button"
          data-chat-disclosure="true"
          onClick={toggle}
          aria-expanded={expanded}
          title={headerText}
          className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] px-3.5 py-2 text-left text-[12.5px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {segments.map((segment, index) => (
              <Fragment key={segment.key}>
                {index > 0 && (
                  <span aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]">·</span>
                )}
                <span className="flex shrink-0 items-center gap-[6px] whitespace-nowrap">
                  <segment.icon
                    size={13}
                    strokeWidth={1.8}
                    className={hasActiveThinking && segment.key === THINKING_SEGMENT_KEY ? 'animate-pulse' : undefined}
                    aria-hidden="true"
                  />
                  {segment.label}
                </span>
              </Fragment>
            ))}
          </span>

          <span className="flex shrink-0 items-center gap-2">
            {failedCount > 0 && (
              <span className="flex items-center gap-[5px] whitespace-nowrap text-[11.5px] font-medium text-[var(--color-error)]">
                <CircleX size={13} strokeWidth={2} aria-hidden="true" />
                {t('toolGroup.failedCount', { count: failedCount })}
              </span>
            )}
            {isRunning ? (
              <LoaderCircle
                size={14}
                strokeWidth={2.4}
                className="animate-spin text-[var(--color-brand)]"
                aria-hidden="true"
              />
            ) : (
              <CircleCheck size={14} strokeWidth={2} className="text-[var(--color-success)]" aria-hidden="true" />
            )}
            {durationLabel && (
              <span className="whitespace-nowrap font-mono text-[11.5px] tabular-nums">{durationLabel}</span>
            )}
            <span
              aria-hidden="true"
              className={`w-3 text-center text-[9px] transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              ▾
            </span>
          </span>
        </button>

        {expanded && (
          <div className="px-3.5 pb-2.5 pt-0.5">
            <div className="ml-1.5 flex flex-col border-l border-[var(--color-border)] pl-4">
              {steps.map((step) => step.kind === 'thinking' ? (
                <ThinkingBlock
                  key={step.message.id}
                  content={step.message.content}
                  isActive={step.message.id === activeThinkingId}
                  variant="row"
                />
              ) : (
                <ActivityToolRow
                  key={step.toolCall.id}
                  toolCall={step.toolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

/** A tool row plus, indented under it, the rows of anything it dispatched. */
function ActivityToolRow({
  toolCall,
  resultMap,
  childToolCallsByParent,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
}) {
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []

  return (
    <div>
      <ToolCallBlock
        chrome="row"
        toolName={toolCall.toolName}
        input={toolCall.input}
        result={result ? { content: result.content, isError: result.isError } : null}
        isPending={toolCall.isPending}
        status={toolCall.status}
        partialInput={toolCall.partialInput}
        durationMs={toolCallDurationMs(toolCall, result)}
      />
      {childToolCalls.length > 0 && (
        <div className="ml-2 border-l border-[var(--color-border)] pl-3">
          {childToolCalls.map((childToolCall) => (
            <ActivityToolRow
              key={childToolCall.id}
              toolCall={childToolCall}
              resultMap={resultMap}
              childToolCallsByParent={childToolCallsByParent}
            />
          ))}
        </div>
      )}
    </div>
  )
}
