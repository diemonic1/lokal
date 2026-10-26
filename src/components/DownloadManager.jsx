// Download manager, after BitChord's: the Downloads button in the window
// header turns into a ring showing the whole batch's progress, and stays so
// until you've seen how it ended. It opens a panel with every download, where
// each can be cancelled, retried or cleared, and the playlists downloaded so
// far (to download again for what's new, or remove). The panel drops down
// from the button and grows inwards (away from the window's edge), so the
// Settings button next to it, nearer the edge, stays in reach. Downloads
// start from Search.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, RotateCcw, AlertCircle, Info, Disc3, Library, ChevronDown, Mic2, Trash2, Square, Search, Download, Clapperboard, CalendarDays, UserRound, ScanSearch, Play, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDownloads, batchOf, isActive, startDownloadSync } from '../store/downloads'
import { useSearchStore } from '../store/search'
import { api, peekSettings } from '../api'
import { peekCache, writeCache } from '../pageCache'
import { displayTitle } from '../downloadLinks'
import { plural } from '../plural'
import { explainDownloadError } from '../downloadErrors'
import { ago, useReleaseCheck } from './ReleasesPanel'
import { cancelVideoIndex, startVideoIndex, useVideoIndex } from '../videoIndex'
import { useDiscoveryArtists, loadDiscoveryArtists } from '../discoveryArtists'
import { useTranslation } from '../i18n'
import { HEADER_MORE } from './HeaderPopover'

// ------------------------------------------------------------------ ring

export function ProgressRing({ value = 0, size = 18, stroke = 2.25, settled = false, failed = false }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={failed && settled ? 'rgb(248,113,113)' : 'currentColor'}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 300ms ease' }}
      />
    </svg>
  )
}

/**
 * The header's Downloads button: a download icon, or while there's a batch,
 * its progress ring with how many are left (a check or "!" once it's over).
 */
export function DownloadsButton() {
  const jobs = useDownloads(s => s.jobs)
  const panelOpen = useDownloads(s => s.panelOpen)
  const togglePanel = useDownloads(s => s.togglePanel)
  const { t } = useTranslation()
  useEffect(() => { startDownloadSync() }, [])
  const { batch, active, failed, progress, settled } = batchOf(jobs)
  const label = !batch.length ? t('Downloads')
    : settled
      ? failed.length ? t('Downloads: {n} failed', { n: failed.length }) : t('Downloads finished')
      : t('Downloads: {n} in progress', { n: active.length })
  return (
    <button
      type="button"
      data-downloads-toggle
      data-tour="downloader"
      onClick={togglePanel}
      title={label}
      aria-label={label}
      aria-expanded={panelOpen}
      aria-haspopup="dialog"
      className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center transition-colors ${panelOpen ? 'text-accent' : batch.length ? (settled && failed.length ? 'text-red-400' : 'text-accent') : 'text-text/90 hover:text-text'}`}
    >
      {batch.length ? (
        <>
          <ProgressRing value={settled ? 100 : progress} size={20} settled={settled} failed={failed.length > 0} />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold leading-none">
            {settled ? (failed.length ? '!' : <Check size={10} strokeWidth={3.5} />) : active.length}
          </span>
        </>
      ) : <Download size={15} />}
    </button>
  )
}

// ------------------------------------------------------------------ rows

function statusText(job, t) {
  switch (job.status) {
    case 'queued': return job.retryAt ? job.message || t('Retrying soon') : job.message && job.message !== 'Queued' ? job.message : t('Queued')
    case 'downloading': return job.message || t('Downloading...')
    case 'done': return job.message || t('Saved')
    case 'error': return explainDownloadError(job.error).summary
    case 'cancelled': return t('Cancelled')
    case 'incomplete': return t('Stopped before finishing')
    default: return job.status
  }
}

function Artwork({ job, size = 40 }) {
  const [broken, setBroken] = useState(false)
  const Icon = job.kind === 'music-video' ? Clapperboard : job.kind === 'playlist' ? Library : Disc3
  const width = job.kind === 'music-video' ? Math.round(size * 16 / 9) : size
  if (job.thumbnail && !broken) {
    return (
      <div className="relative flex-shrink-0 overflow-hidden rounded-lg bg-black/30" style={{ width, height: size }}>
        <img src={job.thumbnail} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </div>
    )
  }
  return (
    <div className="flex flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/25" style={{ width, height: size }}>
      <Icon size={size * 0.42} className="text-muted" />
    </div>
  )
}

export function DownloadRow({ job, detailed = false }) {
  const { cancel, retry, remove } = useDownloads.getState()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const active = isActive(job)
  const canRetry = job.status === 'error' || job.status === 'cancelled' || job.status === 'incomplete'
  const files = (job.downloadedTracks || []).filter(t => !/\.webm$/i.test(t))
  // A failed download: its cause in plain words, the whole message on demand.
  const failure = job.status === 'error' ? explainDownloadError(job.error) : null
  const [why, setWhy] = useState(false)
  const tone = job.status === 'error' ? 'text-red-400' : job.status === 'done' ? 'text-green-400' : job.status === 'cancelled' || job.status === 'incomplete' ? 'text-yellow-300' : 'text-muted'

  return (
    <div className={`group rounded-xl ${detailed ? 'border border-border bg-black/15 p-3' : 'px-2 py-2 hover:bg-white/[0.04]'}`}>
      <div className="flex items-center gap-3">
        <Artwork job={job} size={detailed ? 44 : 38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-white">{job.title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
            {job.status === 'done' && <Check size={11} className="flex-shrink-0 text-green-400" />}
            {job.status === 'error' && <AlertCircle size={11} className="flex-shrink-0 text-red-400" />}
            <span className={`truncate ${tone}`} title={failure?.detail || undefined}>{statusText(job, t)}</span>
            {job.status === 'downloading' && job.speed ? <span className="flex-shrink-0 text-subtle">· {job.speed}</span> : null}
          </p>
          {job.from ? <p className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.14em] text-subtle">{t('from {source}', { source: t(job.from) })}</p> : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {job.status === 'downloading' && <span className="w-9 text-right text-[11px] tabular-nums text-muted">{Math.round(job.progress || 0)}%</span>}
          {job.lyricsCount > 0 && !active && (
            <span title={t('Lyrics added to {n} file|Lyrics added to {n} files', { n: job.lyricsCount })} className="text-accent/80"><Mic2 size={12} /></span>
          )}
          {failure?.detail && (
            <button onClick={() => setWhy(o => !o)} title={why ? t('Hide the details') : t('What went wrong')} aria-expanded={why}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white"><Info size={13} /></button>
          )}
          {canRetry && (
            <button onClick={() => retry(job.id)} title={t('Retry')} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white"><RotateCcw size={13} /></button>
          )}
          {active ? (
            <button onClick={() => cancel(job.id)} title={t('Cancel')} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white"><Square size={11} fill="currentColor" /></button>
          ) : (
            <button onClick={() => remove(job.id)} title={t('Remove from list')} className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/10 hover:text-white"><X size={13} /></button>
          )}
          {detailed && (files.length > 0 || job.output) && (
            <button onClick={() => setOpen(o => !o)} title={t('Details')} className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/10 hover:text-white">
              <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {why && failure?.detail && (
        <p className="mt-2 max-h-32 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-500/5 p-2 text-[11px] leading-relaxed text-muted">{failure.detail.split(/\s+\|\s+|;\s+/).join('\n')}</p>
      )}

      {active && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className={`h-full rounded-full ${job.status === 'queued' ? 'bg-white/25' : 'bg-accent'}`}
            initial={false}
            animate={{ width: job.status === 'queued' ? '100%' : `${Math.max(3, job.progress || 0)}%`, opacity: job.status === 'queued' ? 0.35 : 1 }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {detailed && open && (
        <div className="mt-3 space-y-2">
          {job.totalTracks ? <p className="text-xs text-muted">{t('{done} / {total} tracks', { done: Math.min(job.currentTrack || 0, job.totalTracks), total: job.totalTracks })}</p> : null}
          {files.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border bg-black/15 p-2">
              {files.map((file, i) => (
                <p key={`${file}-${i}`} className="truncate text-xs text-muted"><span className="mr-1 text-accent/70">{i + 1}.</span>{file}</p>
              ))}
            </div>
          )}
          {job.output && (
            <details>
              <summary className="cursor-pointer text-xs text-muted">{t('Log')}</summary>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-black/20 p-2 text-[11px] text-muted">{job.output}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export function DownloadList({ jobs, detailed = false, empty = null }) {
  if (!jobs.length) return empty
  return (
    <div className={detailed ? 'space-y-2' : 'space-y-0.5'}>
      {jobs.map(job => <DownloadRow key={job.id} job={job} detailed={detailed} />)}
    </div>
  )
}

// ------------------------------------------------------------------ panel

/** The playlists downloaded so far: download again (for what's new) or remove. */
function DownloadedPlaylists() {
  const jobs = useDownloads(s => s.jobs)
  const { t } = useTranslation()
  const [list, setList] = useState(() => peekCache('dl:playlists') || [])
  const [loaded, setLoaded] = useState(() => peekCache('dl:playlists') !== undefined)
  const [confirming, setConfirming] = useState(null) // a playlist's id, asked "Remove?"
  const [problem, setProblem] = useState('') // why the last download again / remove failed
  const load = () => Promise.resolve(api.getDownloadedPlaylists())
    .then(response => {
      if (!Array.isArray(response)) return
      writeCache('dl:playlists', response)
      setList(response)
    })
    .catch(() => {})
    .finally(() => setLoaded(true))
  useEffect(() => { load() }, [])

  // Both answer { error } or throw when they fail: say so.
  const attempt = (call) => Promise.resolve().then(call).then(result => result?.error || null, e => e?.message || t('Something went wrong'))
  const redownload = async (id) => {
    setProblem('')
    const failed = await attempt(() => api.redownloadPlaylist(id))
    if (failed) setProblem(t("Couldn't download it again: {error}", { error: failed }))
    useDownloads.getState().load()
    load()
  }
  const remove = async (id) => {
    setConfirming(null)
    setProblem('')
    setList(current => current.filter(playlist => playlist.id !== id))
    const failed = await attempt(() => api.deleteDownloadedPlaylist(id))
    // Reloading brings it back when it wasn't removed.
    if (failed) setProblem(t("Couldn't remove it: {error}", { error: failed }))
    load()
  }
  const problemLine = problem ? <p role="alert" className="px-2 pb-1 text-[11px] text-red-400">{problem}</p> : null

  if (!list.length) {
    return <>{problemLine}<p className="px-3 py-8 text-center text-xs text-muted">{loaded ? t('No playlists downloaded yet. Search for one, or paste its link.') : t('Loading…')}</p></>
  }
  return (
    <div className="space-y-0.5">
      {problemLine}
      {list.map(playlist => {
        const downloading = jobs.some(job => isActive(job) && job.kind === 'playlist' && (job.playlistId === playlist.id || (playlist.url && job.url === playlist.url)))
        const title = displayTitle(playlist, t('Playlist'))
        return (
          <div key={playlist.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
            <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/25">
              <Library size={16} className="text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white" title={playlist.url || title}>{title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted">{plural(playlist.downloaded_count, 'track')}{playlist.status ? ` · ${playlist.status}` : ''}</p>
            </div>
            {confirming === playlist.id ? (
              <div className="flex flex-shrink-0 items-center gap-1">
                <button onClick={() => remove(playlist.id)} className="rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/25">{t('Remove')}</button>
                <button onClick={() => setConfirming(null)} className="rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:text-white">{t('Keep')}</button>
              </div>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-1">
                <button onClick={() => redownload(playlist.id)} disabled={downloading}
                  title={downloading ? t('Downloading') : t('Download again (gets what was added since)')}
                  aria-label={t('Download {title} again', { title })}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40">
                  <RotateCcw size={13} className={downloading ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => setConfirming(playlist.id)} title={t('Remove from this list')} aria-label={t('Remove {title}', { title })}
                  className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/10 hover:text-red-300">
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A job running outside the download queue: its progress, or how it last ended, and a button to run it. */
// soon: the job can't be run yet -- a greyed "Available later" mark whose tooltip (soon) says what it will do.
function TaskRow({ icon: Icon, label, running, done = 0, total = 0, detail, onStop, onOpen, onRun, runLabel: runLabelProp, runDisabled = false, runTitle, soon = null }) {
  const { t } = useTranslation()
  const runLabel = runLabelProp || t('Run')
  const [starting, setStarting] = useState(false)
  const run = async () => {
    if (starting) return
    setStarting(true)
    try { await onRun() } finally { setStarting(false) }
  }
  const percent = total ? Math.min(100, (done / total) * 100) : 0
  return (
    <div className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
      <div className={`flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border bg-black/25 ${running ? 'border-accent/40' : 'border-white/10'}`}>
        <Icon size={16} className={running ? 'text-accent' : 'text-muted'} />
      </div>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[13px] font-semibold text-white">{label}</p>
        {running ? (
          <>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full bg-accent transition-[width] duration-300 ${total ? '' : 'w-1/3 animate-pulse'}`} style={total ? { width: `${percent}%` } : undefined} />
            </div>
            <p className="mt-1 truncate text-[11px] tabular-nums text-muted" title={detail}>{total ? `${done}/${total}` : t('Starting…')}{detail ? ` · ${detail}` : ''}</p>
          </>
        ) : <p className="mt-0.5 truncate text-[11px] text-muted" title={detail}>{detail || t('Not running')}</p>}
      </button>
      {running && onStop && (
        <button onClick={onStop} title={t('Stop')} aria-label={t('Stop {task}', { task: label.toLowerCase() })}
          className="flex-shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white">
          <Square size={12} />
        </button>
      )}
      {!running && soon && (
        <span title={soon} tabIndex={0} aria-label={`${t('Available later')}. ${soon}`}
          className="inline-flex flex-shrink-0 cursor-help items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-muted/60">
          <Clock size={10} /> {t('Available later')}
        </span>
      )}
      {!running && !soon && onRun && (
        <button onClick={run} disabled={runDisabled || starting} title={runTitle || `${runLabel}: ${label}`} aria-label={t('{action} {task}', { action: runLabel, task: label.toLowerCase() })}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-muted">
          {starting ? <span className="h-2.5 w-2.5 animate-spin rounded-full border border-accent/30 border-t-accent" /> : <Play size={10} fill="currentColor" />}
          {runLabel}
        </button>
      )}
    </div>
  )
}

// Artists > Refresh artist info runs in the main process (or the server):
// followed while the panel is open, every second while it runs.
function useArtistRefreshStatus(enabled) {
  const [status, setStatus] = useState(null)
  // Bumped when the job is started here: the status is read again at once.
  const [kick, setKick] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    let cancelled = false
    const tick = async () => {
      const next = await Promise.resolve(api.artistsRefreshAllStatus()).catch(() => null)
      if (cancelled) return
      if (next && !next.error) setStatus(next)
      timer = setTimeout(tick, next?.running ? 1000 : 4000)
    }
    tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, kick])
  const cancel = async () => {
    const next = await Promise.resolve(api.artistsRefreshAllCancel()).catch(() => null)
    if (next && !next.error) setStatus(next)
  }
  // With the source chosen in Settings (Artists → Refresh artist info uses the same).
  const start = async () => {
    const next = await Promise.resolve(api.artistsRefreshAllMetadata({ source: peekSettings()?.artist_metadata_source || 'either' })).catch(() => null)
    if (next && !next.error) setStatus(next)
    setKick(value => value + 1)
  }
  return [status, cancel, start]
}

/** The panel's Others tab: library jobs that aren't downloads, then the downloaded playlists. */
// What "Music videos" will do once it can be run again (startVideoIndex).
const VIDEO_INDEX_HINT = "Finds the official music video of every song in the library, one song at a time.\n\nWhere it looks: TheAudioDB, YouTube Music (videos), and YouTube search.\nA video is kept only if it is official, its title and artist match the song, its length fits and the picture actually moves.\n\nThen ffmpeg compares the video's sound with the song and lines them up, so the video plays in time with the song (intros and outros skipped).\n\nNothing is downloaded and no music file is changed: what's found is kept in a list in the app's data (music-videos.json). Found videos are remembered for 60 days, songs without one for 3 days. The videos show on the Videos page and in the video player."

function OthersTab({ artists, cancelArtists, startArtists, onNavigate }) {
  const releases = useReleaseCheck(s => s.checking)
  const releasesCheckedAt = useReleaseCheck(s => s.saved?.checkedAt)
  const stopReleases = useReleaseCheck(s => s.stop)
  const videos = useVideoIndex(s => s.progress)
  const followed = useDiscoveryArtists(s => s.followed)
  const followedLoaded = useDiscoveryArtists(s => s.loaded)
  const { t } = useTranslation()
  useEffect(() => {
    if (!followedLoaded) loadDiscoveryArtists().catch(() => {})
  }, [followedLoaded])
  const checkReleases = () => useReleaseCheck.getState().start([...followed.values()].map(name => ({ name })))

  const artistsDetail = artists?.running
    ? `${plural(artists.bios || 0, 'bio')}, ${plural(artists.images || 0, 'picture')}${artists.failed ? ` · ${t('{n} failed', { n: artists.failed })}` : ''}`
    : artists?.finishedAt ? `${artists.done < artists.total ? t('Stopped') : t('Done')} ${ago(artists.finishedAt)} · ${t('{bios}, {pictures} updated', { bios: plural(artists.bios || 0, 'bio'), pictures: plural(artists.images || 0, 'picture') })}` : ''
  const videosDetail = videos?.running
    ? `${t('{items} found', { items: plural(videos.found || 0, 'video') })}${videos.title ? ` · ${videos.title}` : ''}`
    : videos ? `${videos.cancelled ? t('Stopped') : t('Done')} · ${t('{videos} found for {songs}', { videos: plural(videos.found || 0, 'video'), songs: plural(videos.total || 0, 'song') })}` : ''

  return (
    <div className="space-y-3">
      <section>
        <p className="px-2 pb-1 pt-1 text-[10px] font-display uppercase tracking-[0.2em] text-subtle">{t('Library jobs')}</p>
        <div className="space-y-0.5">
          <TaskRow icon={CalendarDays} label={t('Artist releases')} running={!!releases} done={releases?.done} total={releases?.total}
            detail={releases ? t('Checking for new releases') : releasesCheckedAt ? t('Checked {when}', { when: ago(releasesCheckedAt) }) : t('Not checked yet')}
            onStop={stopReleases} onOpen={() => onNavigate('/home/releases')}
            onRun={checkReleases} runLabel={t('Check')} runDisabled={!followed.size} runTitle={followed.size ? t('Check {artists} for new releases', { artists: plural(followed.size, 'followed artist') }) : t('Follow artists first (Home → Releases)')} />
          <TaskRow icon={UserRound} label={t('Artist info')} running={!!artists?.running} done={artists?.done} total={artists?.total}
            detail={artistsDetail} onStop={cancelArtists} onOpen={() => onNavigate('/artists')}
            onRun={startArtists} runLabel={t('Refresh')} runTitle={t("Refresh every artist's bio and picture")} />
          {api.isElectron && (
            <TaskRow icon={ScanSearch} label={t('Music videos')} running={!!videos?.running} done={videos?.done} total={videos?.total}
              detail={videosDetail} onStop={cancelVideoIndex} onOpen={() => onNavigate('/videos')}
              soon={t(VIDEO_INDEX_HINT)} />
          )}
        </div>
      </section>
      <section>
        <p className="px-2 pb-1 text-[10px] font-display uppercase tracking-[0.2em] text-subtle">{t('Downloaded playlists')}</p>
        <DownloadedPlaylists />
      </section>
    </div>
  )
}

// What opens the panel: the header's Downloads button.
const OPENERS = '[data-downloads-toggle]'
const PANEL_WIDTH = 380

export function DownloadManagerPanel() {
  const panelOpen = useDownloads(s => s.panelOpen)
  const jobs = useDownloads(s => s.jobs)
  const { closePanel, cancelAll, clearFinished } = useDownloads.getState()
  const requestFocus = useSearchStore(s => s.requestFocus)
  const { t } = useTranslation()
  const nav = useNavigate()
  const [anchor, setAnchor] = useState({ top: 44, left: 12, width: PANEL_WIDTH, origin: 'top left' })
  const [tab, setTab] = useState('queue')
  const releaseCheck = useReleaseCheck(s => !!s.checking)
  const videoIndex = useVideoIndex(s => !!s.progress?.running)
  const [artistRefresh, cancelArtistRefresh, startArtistRefresh] = useArtistRefreshStatus(panelOpen)
  const panelRef = useRef(null)

  // Under the button, growing inwards: from a button on the left of the
  // window its left edge lines up with the button's (it grows rightwards),
  // from one on the right its right edge does. Either way it never covers the
  // Settings button, which sits between it and the edge.
  useLayoutEffect(() => {
    if (!panelOpen) return undefined
    const place = () => {
      // Its button in the header's ⋯ group: it drops from ⋯.
      const rect = (document.querySelector(OPENERS) || document.querySelector(HEADER_MORE))?.getBoundingClientRect()
      if (!rect) return
      // Narrower than the panel (the web app on a phone): it narrows to fit.
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 24)
      const fromLeft = rect.left + rect.width / 2 < window.innerWidth / 2
      const wanted = fromLeft ? rect.left : rect.right - width
      setAnchor({ top: rect.bottom + 8, width, origin: fromLeft ? 'top left' : 'top right', left: Math.max(12, Math.min(wanted, window.innerWidth - width - 12)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closePanel() }
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (e.target.closest?.(OPENERS)) return
      closePanel()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [panelOpen, closePanel])

  const active = jobs.filter(isActive)
  const othersRunning = (releaseCheck ? 1 : 0) + (videoIndex ? 1 : 0) + (artistRefresh?.running ? 1 : 0)
  const finished = jobs.filter(j => !isActive(j))

  const findMore = () => {
    closePanel()
    nav('/search')
    requestFocus()
  }

  return createPortal(
    <AnimatePresence>
      {panelOpen && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={t('Downloads')}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.16 }}
          style={{ top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: `min(440px, calc(100vh - ${anchor.top + 12}px))`, transformOrigin: anchor.origin, backgroundColor: 'rgba(var(--surface-rgb), 0.97)' }}
          className="fixed z-[80] flex flex-col overflow-hidden rounded-2xl border border-border shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <div role="tablist" aria-label={t('Downloads')} className="flex min-w-0 flex-1 items-center gap-1">
              {[['queue', t('Queue')], ['others', t('Others')]].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-display uppercase tracking-[0.16em] transition-colors ${tab === id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
                  {label}
                  {(id === 'queue' ? active.length : othersRunning) > 0 && (
                    <span className="rounded-full bg-accent/20 px-1.5 text-[10px] tracking-normal tabular-nums text-accent">{id === 'queue' ? active.length : othersRunning}</span>
                  )}
                </button>
              ))}
            </div>
            {tab === 'queue' && active.length > 0 && (
              <button onClick={cancelAll} className="whitespace-nowrap text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-white">{t('Cancel all')}</button>
            )}
            {tab === 'queue' && finished.length > 0 && (
              <button onClick={clearFinished} className="flex flex-shrink-0 items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-white"><Trash2 size={11} />{t('Clear')}</button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === 'queue'
              ? <DownloadList jobs={jobs} empty={<p className="px-3 py-8 text-center text-xs text-muted">{t('Nothing downloading.')}</p>} />
              : <OthersTab artists={artistRefresh} cancelArtists={cancelArtistRefresh} startArtists={startArtistRefresh} onNavigate={(path, options) => { closePanel(); nav(path, options) }} />}
          </div>
          <button
            onClick={findMore}
            className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-left text-[11px] uppercase tracking-[0.18em] text-accent transition-colors hover:bg-white/[0.04]"
          >
            <Search size={12} /> {t('Find music to download')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
