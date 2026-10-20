// Online radio: a station's local history -- the songs it played while it was
// listened to (electron/radio/history.js), newest first, with when each one
// played. Each row copies "Artist - Title" or searches the web for it.

import React, { useEffect, useState } from 'react'
import { Copy, Globe, History, Loader2 } from 'lucide-react'
import { api } from '../api'
import Modal from './Modal'
import { useTranslation } from '../i18n'
import { showToast } from './Toaster'

const pad = n => String(n).padStart(2, '0')

/** When a song played: 24-hour time with seconds, and the date (dd.mm.yyyy). */
function playedAt(at) {
  const date = new Date(Number(at) || 0)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} · ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

/** "Artist - Title" (the title alone when there's no artist). */
export const songLine = entry => [entry?.artist, entry?.title].map(part => String(part || '').trim()).filter(Boolean).join(' - ')

export default function RadioHistoryModal({ station, onClose }) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!station) return undefined
    let alive = true
    setEntries(null)
    setError(null)
    Promise.resolve(api.radioHistoryGet(station.id))
      .then(result => { if (alive) setEntries(Array.isArray(result?.entries) ? result.entries : []) })
      .catch(e => { if (alive) setError(e?.message || '?') })
    return () => { alive = false }
  }, [station])

  const copy = (entry) => {
    const text = songLine(entry)
    Promise.resolve(navigator.clipboard?.writeText(text))
      .then(() => showToast(t('Copied: {text}', { text })))
      .catch(() => showToast(t('Could not copy to the clipboard')))
  }
  const search = (entry) => api.openExternal(`https://yandex.ru/search/?text=${encodeURIComponent(songLine(entry))}`)

  const btn = 'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-white'
  return (
    <Modal open={!!station} onClose={onClose} title={t('Local history: {station}', { station: station?.title || '' })} width="max-w-2xl">
      <div className="flex h-[min(36rem,calc(100vh-10rem))] flex-col gap-3">
        <p className="flex items-center gap-2 text-xs text-muted">
          <History size={13} /> {t('The last {n} tracks heard on this station in Lokal, newest first.', { n: 100 })}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
          {!entries && !error && <div className="flex h-full items-center justify-center text-muted"><Loader2 size={16} className="animate-spin" /></div>}
          {error && <p className="p-4 text-xs text-red-400">{error}</p>}
          {entries && !entries.length && <p className="p-4 text-center text-xs text-muted">{t('Nothing has been heard on this station yet.')}</p>}
          {entries?.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-card">
              <span className="w-7 flex-shrink-0 text-right text-xs tabular-nums text-muted">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white" title={entry.title}>{entry.title}</p>
                <p className="truncate text-xs text-muted" title={entry.artist}>{entry.artist || '—'}</p>
              </div>
              <span className="flex-shrink-0 text-xs tabular-nums text-muted">{playedAt(entry.at)}</span>
              <button type="button" onClick={() => copy(entry)} className={btn} title={t('Copy “{text}”', { text: songLine(entry) })}>
                <Copy size={11} /> {t('Copy')}
              </button>
              <button type="button" onClick={() => search(entry)} className={btn} title={t('Search the web for “{text}”', { text: songLine(entry) })}>
                <Globe size={11} /> {t('Search online')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
