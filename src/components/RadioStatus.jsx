import React, { useEffect, useState } from 'react'
import { usePlayerStore } from '../store/player'
import { useRadioStore } from '../store/radio'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from '../i18n'

// How long a station may take to start before the label says it's connecting.
const CONNECTING_AFTER_MS = 4000

/**
 * The small label under the player's buttons while a station plays: "On air";
 * "Connecting…" when it takes a while to start (with what went wrong on the
 * way, in a word or two); the reason when it gave up.
 *   tone  'accent' (the player bar) or 'light' (over a cover)
 */
export default function RadioStatus({ className = '', tone = 'accent' }) {
  const { t } = useTranslation()
  const { trackId, isPlaying, isBuffering } = usePlayerStore(useShallow(s => ({ trackId: s.currentTrack?.id, isPlaying: s.isPlaying, isBuffering: s.isBuffering })))
  const connection = useRadioStore(s => s.connection)
  const mine = connection.trackId === trackId
  const issue = mine ? connection.issue : null
  const failed = mine && connection.failed

  const waiting = isPlaying && isBuffering
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!waiting) { setSlow(false); return }
    const timer = setTimeout(() => setSlow(true), CONNECTING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [waiting, trackId])

  const issueText = issue ? t(issue.key, { status: issue.status }) : ''
  const base = `inline-flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap text-[10px] leading-4 font-display uppercase tracking-wider ${className}`
  const errorColor = tone === 'light' ? 'text-red-300' : 'text-red-400'
  const calm = tone === 'light' ? 'text-white/70' : 'text-muted'

  if (failed && !isPlaying) {
    return (
      <span className={base} title={connection.detail || issueText} role="status">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current ${errorColor}`} />
        <span className={`truncate ${errorColor}`}>{issueText || t('Not playing')}</span>
      </span>
    )
  }
  if (waiting && slow) {
    return (
      <span className={base} title={connection.detail || undefined} role="status">
        <span className={`h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-current ${calm}`} />
        <span className={calm}>{t('Connecting…')}</span>
        {issueText && <>
          <span className={`${calm} opacity-60`}>·</span>
          <span className={`truncate ${errorColor}`}>{issueText}</span>
        </>}
      </span>
    )
  }
  return <span className={`${base} ${tone === 'light' ? 'text-white/75' : 'text-accent'}`}>{t('On air')}</span>
}
