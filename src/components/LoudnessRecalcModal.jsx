import React, { useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'
import { useTranslation } from '../i18n'

/**
 * Settings > Loudness Normalization > Recalculate all: opening it starts the
 * run (electron/loudnessBatch.js): the songs without their loudness are
 * counted, then measured one by one, MP3s getting it written into their
 * ReplayGain tags. Cancel (or closing the window) stops it; the next run goes
 * on with the songs still left.
 */
export default function LoudnessRecalcModal({ open, onClose }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    let timer = null
    let cancelled = false
    setStatus(null)
    const tick = async () => {
      const next = await Promise.resolve(api.loudnessRecalcStatus()).catch(() => null)
      if (cancelled) return
      if (next) setStatus(next)
      if (next?.running) timer = setTimeout(tick, 400)
    }
    Promise.resolve(api.loudnessRecalcStart()).catch(() => null).then(next => {
      if (cancelled) return
      if (next) setStatus(next)
      timer = setTimeout(tick, 400)
    })
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open])

  const running = !!status?.running
  const close = () => {
    if (running) api.loudnessRecalcCancel()
    onClose()
  }

  const counting = running && status.phase === 'counting'
  const total = status?.total || 0
  const done = status?.done || 0
  const percent = total ? Math.round((done / total) * 100) : 0
  const finished = !!(status && !running && status.finishedAt)

  return (
    <Modal open={open} onClose={close} title={t('Recalculate loudness')} width="max-w-md">
      <div className="space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          {t("Measures every song whose loudness isn't known yet; MP3s get it written into their ReplayGain tags. Cancelled, the next run goes on with the songs still left.")}
        </p>

        <div className="space-y-2">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full bg-accent rounded-full transition-[width] duration-300 ${counting || !status ? 'animate-pulse' : ''}`}
              style={{ width: `${counting || !status ? 100 : finished && !status.cancelled ? 100 : percent}%`, opacity: counting || !status ? 0.35 : 1 }} />
          </div>
          <p className="text-xs text-muted tabular-nums">
            {!status || counting
              ? t('Counting songs without loudness… {n} so far', { n: total.toLocaleString() })
              : running
                ? t('{done} of {total} processed · {left} left', { done: done.toLocaleString(), total: total.toLocaleString(), left: (total - done).toLocaleString() })
                : total === 0 && !status.cancelled
                  ? t('Every song already has its loudness.')
                  : status.cancelled
                    ? t('Cancelled: {done} of {total} processed, {left} left for the next run.', { done: done.toLocaleString(), total: total.toLocaleString(), left: (total - done).toLocaleString() })
                    : t('Done: {done} songs processed.', { done: done.toLocaleString() })}
          </p>
          {status && (status.written > 0 || status.failed > 0) && (
            <p className="text-[11px] text-muted/70 tabular-nums">
              {t('Written into files: {written}', { written: status.written.toLocaleString() })}
              {status.failed > 0 && ` · ${t('Failed: {n}', { n: status.failed.toLocaleString() })}`}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {running ? (
            <button onClick={close} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors inline-flex items-center justify-center gap-2">
              <Square size={12} /> {t('Cancel')}
            </button>
          ) : (
            <button onClick={close} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">{t('Close')}</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
