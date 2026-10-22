// A link pasted into the search box: what it is (one song, or a playlist /
// album / channel) and a button to download it into the library, then its
// progress right there. Enter in the search box starts the first choice.
// Its real title, artist and cover are looked up as soon as it's pasted
// (api.linkInfo); until then the card goes by what the link itself says.
// A playlist can also be saved as one of your playlists without downloading
// (Import playlist, from a link, with this link filled in).

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Disc3, Download, Library, Link2, ListMusic } from 'lucide-react'
import { useDownloads, startDownloadSync } from '../store/downloads'
import { useSearchStore } from '../store/search'
import { api } from '../api'
import { inferTitleFromUrl, linkKind, splitLink } from '../downloadLinks'
import { DownloadRow } from './DownloadManager'
import DownloadNotices from './DownloadNotices'
import { translate, useTranslation } from '../i18n'
import { plural } from '../plural'

function sourceOf(link) {
  try {
    const host = new URL(link).hostname.replace(/^(?:www|m)\./, '')
    if (host === 'music.youtube.com') return { label: 'YouTube Music', youtube: true }
    if (host === 'youtu.be' || /(^|\.)youtube\.com$/.test(host)) return { label: 'YouTube', youtube: true }
    if (/(^|\.)soundcloud\.com$/.test(host)) return { label: 'SoundCloud' }
    if (/(^|\.)bandcamp\.com$/.test(host)) return { label: 'Bandcamp' }
    return { label: host }
  } catch {
    return { label: translate('Link') }
  }
}

/** The ways to download `link`: the song, everything, or (a song in a playlist) either. */
function choicesFor(link) {
  const kind = linkKind(link)
  if (kind === 'both') {
    const { song, list } = splitLink(link)
    return [
      { id: 'song', kind: 'single', url: song, label: translate('This song'), icon: Disc3, title: inferTitleFromUrl(song, 'Song') },
      { id: 'list', kind: 'playlist', url: list, label: translate('Whole playlist'), icon: ListMusic, title: inferTitleFromUrl(list, 'Playlist / Album') },
    ]
  }
  if (kind === 'single') return [{ id: 'song', kind: 'single', url: link, label: translate('Download song'), icon: Download, title: inferTitleFromUrl(link, 'Song') }]
  return [{ id: 'all', kind: 'playlist', url: link, label: translate('Download all'), icon: Download, title: inferTitleFromUrl(link, 'Playlist / Album') }]
}

export default function LinkDownload({ link }) {
  const { t } = useTranslation()
  const source = sourceOf(link)
  const kind = linkKind(link)
  const choices = choicesFor(link)
  const jobs = useDownloads(s => s.jobs)
  const enqueue = useDownloads(s => s.enqueue)
  const [pending, setPending] = useState(null) // a choice's id, while it's being queued
  const [error, setError] = useState('')
  useEffect(() => { startDownloadSync() }, [])
  useEffect(() => { setError(''); setPending(null) }, [link])

  // url -> { title, author, thumbnail, count }, for each of the link's choices.
  const [info, setInfo] = useState({})
  const [coverFailed, setCoverFailed] = useState(false)
  useEffect(() => {
    let live = true
    setInfo({})
    setCoverFailed(false)
    for (const url of new Set(choices.map(choice => choice.url))) {
      api.linkInfo?.(url).then(result => { if (live && result?.ok) setInfo(prev => ({ ...prev, [url]: result })) }).catch(() => {})
    }
    return () => { live = false }
  }, [link]) // eslint-disable-line react-hooks/exhaustive-deps
  const titleOf = choice => info[choice.url]?.title || choice.title

  const jobFor = (choice) => jobs.find(job => !job.removed && job.url === choice.url && (job.kind || 'single') === choice.kind) || null

  const start = async (choice) => {
    if (pending || jobFor(choice)) return
    setError('')
    setPending(choice.id)
    const result = await enqueue(choice.kind, choice.url, { title: titleOf(choice), from: 'Link' }).catch(e => ({ error: e.message }))
    setPending(null)
    if (result?.error) setError(result.error)
  }

  // Enter in the search box: the first choice (the song, for a song in a
  // playlist). Pressed on this link, even before this was shown (the page
  // still appearing), it's taken once.
  const submitSeq = useSearchStore(s => s.submitSeq)
  const takeSubmit = useSearchStore(s => s.takeSubmit)
  useEffect(() => {
    if (takeSubmit(link)) start(choices[0])
  }, [submitSeq, link]) // eslint-disable-line react-hooks/exhaustive-deps

  const listUrl = kind === 'both' ? splitLink(link).list : kind === 'single' ? null : link

  const started = choices.map(jobFor).filter(Boolean)
  const what = kind === 'single' ? t('Song') : kind === 'both' ? t('Song from a playlist') : t('Playlist, album or channel')
  const main = info[choices[0].url]
  const cover = !coverFailed && main?.thumbnail
  // A song from a playlist: the playlist's name under it.
  const fromList = kind === 'both' ? info[listUrl]?.title : null

  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-3" aria-label={t('Download a link')}>
      <h2 className="text-xs font-display text-muted uppercase tracking-widest flex items-center gap-2">
        <Link2 size={12} /> {t('Link')}
      </h2>
      <div className="rounded-2xl border border-border bg-elevated/60 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card text-accent">
            {cover
              ? <img src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} className="h-full w-full object-cover" />
              : kind === 'single' ? <Disc3 size={20} /> : <Library size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text">{titleOf(choices[0])}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              <span className="text-accent/90">{what}</span>
              {main?.author ? ` · ${main.author}` : ''}
              {main?.count && kind !== 'single' ? ` · ${plural(main.count, 'song')}` : ''}
              {` · ${source.label}`}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-subtle">{fromList ? t('From {name}', { name: fromList }) : link}</p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
            {choices.map((choice, i) => {
              const job = jobFor(choice)
              const Icon = choice.icon
              return (
                <button
                  key={choice.id}
                  onClick={() => start(choice)}
                  disabled={!!job || !!pending}
                  title={i === 0 ? t('Enter in the search box does this too') : undefined}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-default ${i === 0 ? 'bg-accent text-[rgb(var(--bg-rgb))] hover:bg-accent/85 disabled:bg-accent/30' : 'border border-border text-text hover:border-accent/50 disabled:opacity-40'}`}
                >
                  {pending === choice.id ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon size={13} />}
                  {choice.label}
                </button>
              )
            })}
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {started.length > 0 && (
          <div className="mt-3 space-y-2">
            {started.map(job => <DownloadRow key={job.id} job={job} detailed />)}
          </div>
        )}
        {!started.length && (
          <p className="mt-3 text-[11px] text-muted">
            {t('Saved to your music folder and added to the library, with lyrics and a square cover.')}{main ? '' : ` ${kind === 'single' ? t('The real title is filled in from {source} once it starts.', { source: source.label }) : t('The real name is filled in from {source} once it starts.', { source: source.label })}`}
          </p>
        )}
      </div>
      <DownloadNotices youtube={!!source.youtube} />
    </motion.section>
  )
}
