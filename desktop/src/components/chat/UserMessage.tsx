import { memo, useCallback, useMemo } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { UsersRound } from 'lucide-react'
import type { UIAttachment } from '../../types/chat'
import { useTranslation } from '../../i18n'
import { openPreviewLink } from '../../lib/openPreviewLink'
import { splitTextByUrls } from '../../lib/urlBoundary'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar, type MessageBranchAction } from './MessageActionBar'

type Props = {
  content: string
  attachments?: UIAttachment[]
  branchAction?: MessageBranchAction
  timestamp?: number
  sessionId?: string
  /** Set when this turn came from another agent rather than from the user. */
  teammateFrom?: string
}

export const UserMessage = memo(function UserMessage({ content, attachments, branchAction, timestamp, sessionId, teammateFrom }: Props) {
  const t = useTranslation()
  const hasText = content.trim().length > 0

  // The prompt is literal text, NOT markdown — `**`, `#` and file paths have to
  // stay exactly as the user typed them. So instead of running it through the
  // markdown renderer we only split the bare URLs out and wrap those.
  const segments = useMemo(() => splitTextByUrls(content), [content])

  const handleLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
      if (!sessionId) return
      if (openPreviewLink(href, sessionId)) event.preventDefault()
    },
    [sessionId],
  )

  const body: ReactNode = segments.map((segment, index) =>
    segment.type === 'url' ? (
      <a
        key={index}
        href={segment.value}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[var(--color-text-accent)] underline decoration-[1px] underline-offset-[3px] decoration-[var(--color-text-accent)] [overflow-wrap:anywhere] hover:decoration-[2px]"
        onClick={(event) => handleLinkClick(event, segment.value)}
      >
        {segment.value}
      </a>
    ) : (
      segment.value
    ),
  )

  // A teammate's instruction is not the user speaking, so it does not take the
  // user's right-aligned bubble. Attributing and left-aligning it is what gives
  // a member transcript the same read-at-a-glance structure the main session
  // has: prompt right, everything the agents said left.
  if (teammateFrom) {
    return (
      <div className="flex justify-start">
        <div
          data-message-shell="teammate"
          data-teammate-from={teammateFrom}
          className="group flex min-w-0 max-w-[82%] flex-col items-start sm:max-w-[78%] lg:max-w-[680px]"
        >
          <div className="mb-1 flex min-w-0 items-center gap-1.5 px-0.5 text-[11px] text-[var(--color-text-tertiary)]">
            <UsersRound size={12} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-[var(--color-brand)]" />
            <span className="min-w-0 truncate font-mono font-bold text-[var(--color-text-secondary)]">
              {teammateFrom}
            </span>
            <span className="shrink-0">{t('chat.teammateMessage')}</span>
          </div>

          <div className="flex max-w-full flex-col items-start gap-2">
            {attachments && attachments.length > 0 && (
              <AttachmentGallery attachments={attachments} variant="message" />
            )}
            {hasText && (
              <div
                data-message-body="teammate"
                className="min-w-0 max-w-full whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border-l-2 border-[var(--color-brand)] bg-[var(--color-surface-container)] px-[16px] py-[12px] text-[14px] leading-relaxed text-[var(--color-text-primary)]"
                style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
              >
                {body}
              </div>
            )}
          </div>

          {hasText && (
            <MessageActionBar
              copyText={content}
              copyLabel={t('chat.copyPrompt')}
              align="start"
              timestamp={timestamp}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <div
        data-message-shell="user"
        className="group flex min-w-0 max-w-[82%] flex-col items-end sm:max-w-[78%] lg:max-w-[640px]"
      >
        <div className="flex max-w-full flex-col items-end gap-2">
          {attachments && attachments.length > 0 && (
            <AttachmentGallery attachments={attachments} variant="message" />
          )}

          {hasText && (
            <div
              data-message-body="user"
              className="min-w-0 max-w-full rounded-[var(--radius-lg)] bg-[var(--color-surface-user-msg)] px-[18px] py-[13px] text-[14.5px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words"
              style={{
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              }}
            >
              {body}
            </div>
          )}
        </div>

        {hasText && (
          <MessageActionBar
            copyText={content}
            copyLabel={t('chat.copyPrompt')}
            branchAction={branchAction}
            align="end"
            timestamp={timestamp}
          />
        )}
      </div>
    </div>
  )
})
