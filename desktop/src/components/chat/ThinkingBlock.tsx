import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

/**
 * `standalone` is the historical inline line used when a thinking block is the
 * only thing in its run. `row` is the in-activity-group form: the label sits on
 * one line with a preview of the reasoning, matching the tool rows around it so
 * an expanded group reads as one timeline instead of a stack of cards (#1177).
 */
type ThinkingVariant = 'standalone' | 'row'

export function ThinkingBlock({
  content,
  isActive = false,
  variant = 'standalone',
}: {
  content: string
  isActive?: boolean
  variant?: ThinkingVariant
}) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const displayContent = useMemo(() => content.replace(/\r\n?/g, '\n').trimEnd(), [content])
  const hasDisplayContent = displayContent.trim().length > 0
  const preview = useMemo(() => (variant === 'row' ? thinkingPreview(displayContent) : ''), [displayContent, variant])

  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [displayContent, expanded, isActive])

  const label = (
    <>
      {isActive ? t('thinking.label') : t('thinking.labelDone')}
      {isActive && <span className="thinking-dots" />}
    </>
  )

  if (variant === 'row') {
    return (
      <div>
        <style>{thinkingStyles}</style>
        <button
          type="button"
          data-chat-disclosure="true"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-2 rounded-[var(--radius-md)] px-2 py-1 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
        >
          <span className="shrink-0 text-[12.5px] italic text-[var(--color-text-tertiary)]">
            {label}
          </span>
          {preview ? (
            <span className="min-w-0 flex-1 truncate text-[12.5px] italic leading-[1.7] text-[var(--color-text-tertiary)]">
              {preview}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <span aria-hidden="true" className="shrink-0 text-[8px] text-[var(--color-text-tertiary)]">
            {expanded ? '▾' : '▸'}
          </span>
        </button>
        {expanded && hasDisplayContent && (
          <div
            ref={contentRef}
            data-thinking-content="expanded"
            className="relative mb-2 mt-1 max-h-[300px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2.5 text-[11px] text-[var(--color-text-secondary)]"
          >
            <MarkdownRenderer
              content={displayContent}
              variant="compact"
              cache={!isActive}
              streaming={isActive}
              className="thinking-markdown text-[var(--color-text-secondary)]"
            />
            {isActive && <span className="thinking-cursor" />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mb-1">
      <style>{thinkingStyles}</style>
      <button
        type="button"
        data-chat-disclosure="true"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-[7px] rounded-[var(--radius-sm)] px-1 py-0.5 text-left text-[13.5px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <span className="text-[10px]">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="shrink-0 font-medium italic">
          {label}
        </span>
      </button>
      {expanded && hasDisplayContent && (
        <div
          ref={contentRef}
          data-thinking-content="expanded"
          className="relative mt-1 max-h-[300px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-2.5 text-[11px] text-[var(--color-text-secondary)]"
        >
          <MarkdownRenderer
            content={displayContent}
            variant="compact"
            cache={!isActive}
            streaming={isActive}
            className="thinking-markdown text-[var(--color-text-secondary)]"
          />
          {isActive && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  )
}

const THINKING_PREVIEW_MAX_CHARS = 160

/**
 * First line of reasoning, stripped of the markdown that would render as literal
 * `##` / `-` noise on a single-line row. Only ever a hint — the full block is one
 * click away, so truncating here loses nothing.
 */
export function thinkingPreview(content: string): string {
  for (const rawLine of content.split('\n')) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/^\d+\.\s+/, '')
      .trim()
    if (!line || line === '---') continue
    return line.length > THINKING_PREVIEW_MAX_CHARS
      ? `${line.slice(0, THINKING_PREVIEW_MAX_CHARS)}…`
      : line
  }
  return ''
}

const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-tertiary);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
.thinking-markdown > :first-child,
.thinking-markdown > :first-child > :first-child {
  margin-top: 0;
}
.thinking-markdown > :last-child,
.thinking-markdown > :last-child > :last-child {
  margin-bottom: 0;
}
`
