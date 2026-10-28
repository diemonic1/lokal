// Clip Search: the official music video looked up (the Videos tab's own
// lookup) for every song that has none in its tags yet, kept apart until
// Save. Each video found can be checked -- the song plays with it in the side
// panel's Visualization + Lyrics tab, only as a preview -- with the loop
// times typed next to it and its zoom (the scale button's slider) applied at once; opened in the browser, its link
// copied, or marked wrong (it's never offered for the song again, and the
// song leaves the report). Only the ticked ones are written into their tags,
// with the times when they're filled in and the zoom when it isn't 0. Stopping keeps what was found so
// far, even across a restart, and "Go to report" opens it to save from
// without waiting for the rest; Cancel throws it all away. See
// electron/online/clipSearch.js.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, Copy, ImagePlay, Info, ListChecks, Loader2, MonitorPlay, Music, Play, Scaling, SquareArrowOutUpRight, Square, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'
import { usePageReady } from '../pageCache'
import { plural } from '../plural'
import { trackArtURL } from '../onlineTracks'
import { usePlayerStore } from '../store/player'
import { announceTrackChanged } from '../trackChanged'
import { CLIP_ZOOM_MAX, clipTimeInput, clipZoomPercent, parseClipTime, previewClip } from '../clipVideo'
import { showToast } from '../components/Toaster'
import MotionCoverMarks from '../components/MotionCoverMarks'
import SpotifyIcon from '../components/SpotifyIcon'
import { AppleMusicIcon, TidalIcon } from '../components/ServiceIcons'
import Modal from '../components/Modal'
import { Checkbox, Confirm, Progress, Timing } from './LyricsSearch'

// The song whose video is being checked now (kept across visits to the tab):
// its preview ends when another is checked, or the song leaves the report.
let previewing = null
const previewListeners = new Set()
function setPreviewing(trackId, clip) {
  if (previewing != null && previewing !== trackId) previewClip(previewing, null)
  previewing = trackId
  if (trackId != null) previewClip(trackId, clip)
  previewListeners.forEach(listener => listener(trackId))
}
/** Ends the preview of these songs (all of them: none given). */
function endPreview(ids) {
  if (previewing == null || (ids && !ids.includes(previewing))) return
  setPreviewing(null)
}
function usePreviewing() {
  const [id, setId] = useState(previewing)
  useEffect(() => { previewListeners.add(setId); return () => { previewListeners.delete(setId) } }, [])
  return id
}

const thumbnailOf = item => item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`
const badTime = text => Number.isNaN(parseClipTime(text))

/**
 * Whether the song has a Spotify Canvas: as written on its row, else asked of
 * Spotify now (only asked, nothing downloaded). true / false, null while not known.
 */
function useSpotifyCanvas(track) {
  const known = track?.spotify_canvas == null ? null : !!track.spotify_canvas
  const [asked, setAsked] = useState({ id: null, has: null })
  useEffect(() => {
    if (!track?.id || known != null) return undefined
    let current = true
    api.motionCoverInfo(track.id, true).then(info => { if (current) setAsked({ id: track.id, has: info?.spotify ?? null }) })
    return () => { current = false }
  }, [track?.id, known])
  return known ?? (asked.id === track?.id ? asked.has : null)
}

/** How the video was matched to the song, for its tooltip. */
function useCheckText() {
  const { t } = useTranslation()
  return check => check === 'audio' ? t('Its sound lines up with the song')
    : check === 'length' ? t('Its length matches the song')
      : check === 'title' ? t('Found by the song’s title')
        : null
}

const ZOOM_PANEL_WIDTH = 256

/**
 * The scale button: a slider (and the same number typed) for how far the
 * video is zoomed in, 0-100 %, in a small panel under it. Closed by a press
 * outside it, Escape, scrolling the report or resizing.
 */
function ZoomButton({ zoom, onChange, className }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const button = useRef(null)
  const panel = useRef(null)
  useLayoutEffect(() => {
    if (!open) return
    const r = button.current.getBoundingClientRect()
    setPosition({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - ZOOM_PANEL_WIDTH, window.innerWidth - ZOOM_PANEL_WIDTH - 8)) })
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    const outside = event => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) close() }
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    // Only a scroll that moves the button (the page, the report) closes it:
    // the side panel's lyrics scrolling along with the song doesn't.
    const scroll = event => {
      const target = event.target === document ? document.documentElement : event.target
      if (target?.contains?.(button.current)) close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])
  const label = t('How far the video is zoomed in, in the side panel')
  return <>
    <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog"
      title={zoom ? `${label}: ${zoom}%` : label} aria-label={label}
      className={`${className} ${open || zoom ? 'border-accent/50 text-accent' : ''}`}>
      <Scaling size={13} />
    </button>
    {open && position && createPortal(
      <div ref={panel} role="dialog" aria-label={label} style={{ top: position.top, left: position.left, width: ZOOM_PANEL_WIDTH }}
        className="fixed z-[200] rounded-xl border border-border bg-elevated p-3 shadow-2xl">
        <p className="mb-2 text-xs text-muted">{label}</p>
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={CLIP_ZOOM_MAX} step={1} value={zoom} autoFocus
            onChange={event => onChange(clipZoomPercent(event.target.value))} aria-label={label} className="min-w-0 flex-1 accent-accent" />
          <input inputMode="numeric" value={zoom} onChange={event => onChange(clipZoomPercent(event.target.value.replace(/[^0-9]/g, '') || 0))}
            aria-label={label} className="h-7 w-12 flex-shrink-0 rounded-lg border border-border bg-card px-1 text-center text-xs tabular-nums text-white outline-none focus:border-accent/50" />
          <span className="text-xs text-muted">%</span>
        </div>
      </div>, document.body,
    )}
  </>
}

/**
 * A count out of the library's songs, with its share as a bar and a percent.
 * @param sample  the first few of those songs, listed on hover
 */
function StatRow({ icon, label, n, total, tone = 'bg-accent', sub, sample }) {
  const share = total ? n / total : 0
  const percent = total ? (share * 100).toLocaleString(undefined, { maximumFractionDigits: share < 0.1 && n ? 1 : 0 }) : '0'
  const hint = sample?.length ? sample.join(', ') + (n > sample.length ? '…' : '') : undefined
  return (
    <tr className={`border-b border-border/60 last:border-0 ${hint ? 'cursor-help hover:bg-white/[0.03]' : ''}`} title={hint}>
      <td className={`py-2 pr-3 ${sub ? 'pl-9 text-muted' : 'pl-4 text-white'}`}>
        <span className="flex items-center gap-2">{icon}{label}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-white">{n.toLocaleString()}</td>
      <td className="w-40 py-2 pl-3 pr-4">
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <span className={`block h-full rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
          </span>
          <span className="w-12 text-right text-xs tabular-nums text-muted">{percent}%</span>
        </span>
      </td>
    </tr>
  )
}

/** The library before a search: music videos there and not, and the moving covers by where they're from. */
function LibraryStats({ counts }) {
  const { t } = useTranslation()
  const total = counts?.total
  if (total == null) {
    return <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted">{t('Tracks without a music video')}: {counts?.missing == null ? '…' : counts.missing.toLocaleString()}</div>
  }
  const motion = counts.motion || {}
  const samples = counts.samples || {}
  const head = 'px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted'
  const group = text => (
    <tr className="border-b border-border/60 bg-white/[0.03]">
      <td colSpan={3} className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{text}</td>
    </tr>
  )
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={`${head} pl-4 text-left`}>{t('Tracks in the library: {n}', { n: total.toLocaleString() })}</th>
            <th className={`${head} text-right`}>{t('Number of tracks')}</th>
            <th className={`${head} pr-4 text-right`}>{t('Share of the library')}</th>
          </tr>
        </thead>
        <tbody>
          {group(t('Music videos'))}
          <StatRow icon={<MonitorPlay size={14} className="text-accent" />} label={t('With a music video')} n={counts.withClip || 0} total={total} />
          <StatRow icon={<X size={14} className="text-red-300" />} label={t('Without a music video (the search looks for these)')} n={counts.missing || 0} total={total} tone="bg-red-400/70" />
          {group(t('Moving covers'))}
          <StatRow icon={<ImagePlay size={14} className="text-accent" />} label={t('With a moving cover')} n={motion.any || 0} total={total} sample={samples.any} />
          <StatRow sub icon={<SpotifyIcon size={13} />} label="Spotify Canvas" n={motion.spotify || 0} total={total} sample={samples.spotify} tone="bg-[#1db954]" />
          <StatRow sub icon={<AppleMusicIcon size={13} />} label="Apple Music" n={motion.apple || 0} total={total} sample={samples.apple} tone="bg-pink-400" />
          <StatRow sub icon={<TidalIcon size={13} />} label="Tidal" n={motion.tidal || 0} total={total} sample={samples.tidal} tone="bg-sky-400" />
          <StatRow sub icon={<ImagePlay size={13} className="text-accent" />} label={t('Community list')} n={motion.community || 0} total={total} sample={samples.community} tone="bg-violet-400" />
          <StatRow sub label={t('Not checked on Spotify yet')} n={motion.unknown || 0} total={total} tone="bg-white/30" />
        </tbody>
      </table>
    </div>
  )
}

/** "Check for moving covers" running (or just over): its progress, and Stop / Close. */
function CoverCheckModal({ open, progress, onStop, onClose }) {
  const { t } = useTranslation()
  const running = progress.status === 'running'
  return (
    <Modal open={open} onClose={running ? undefined : onClose} title={t('Check for moving covers')} width="max-w-lg">
      <p className="mb-4 text-xs leading-relaxed text-muted">
        {t('Every track is asked of the moving-cover sources switched on in Settings; nothing is downloaded. What is found shows up in the table at once.')}
      </p>
      <Progress progress={progress} found={n => t('Moving covers found: {n}', { n: n.toLocaleString() })} />
      {progress.status === 'stopped' && <p className="mt-3 text-xs text-muted">{t('Stopped. The next check starts over from the first track.')}</p>}
      {progress.status === 'done' && <p className="mt-3 text-xs text-muted">{t('All the tracks are checked.')}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {running
          ? <button onClick={onStop} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs text-muted hover:text-white"><Square size={11} /> {t('Stop')}</button>
          : <button onClick={onClose} className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90">{t('Close')}</button>}
      </div>
    </Modal>
  )
}

/** One video found: the song, the video, Check, the loop times and the link's buttons. */
function ReportRow({ item, index, digits, checking, onChecked, onCheck, onTimes, onReject }) {
  const { t } = useTranslation()
  const checkText = useCheckText()
  const art = trackArtURL(item.track)
  const [start, setStart] = useState(item.start || '')
  const [end, setEnd] = useState(item.end || '')
  const [zoom, setZoom] = useState(clipZoomPercent(item.zoom))
  const btn = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-white'
  const icon = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:text-white'
  const field = bad => `h-7 w-[4.5rem] flex-shrink-0 rounded-lg border bg-card px-2 text-xs tabular-nums text-white outline-none placeholder:text-muted/60 ${bad ? 'border-red-400/70' : 'border-border focus:border-accent/50'}`
  const change = (which, value) => {
    const text = clipTimeInput(value)
    const next = which === 'start' ? { start: text, end, zoom } : { start, end: text, zoom }
    if (which === 'start') setStart(text)
    else setEnd(text)
    onTimes(item, next)
  }
  const changeZoom = value => {
    setZoom(value)
    onTimes(item, { start, end, zoom: value })
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(item.url); showToast(t('Link copied')) } catch { showToast(t('Couldn’t copy the link')) }
  }
  const matched = checkText(item.check)
  const canvas = useSpotifyCanvas(item.track)
  return (
    <div className={`flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-card ${checking ? 'bg-accent/[0.06]' : ''}`}>
      <span className="min-w-[2ch] flex-shrink-0 text-right text-xs tabular-nums text-muted" style={{ width: `${digits}ch` }}>{index + 1}</span>
      <Checkbox checked={item.checked} label={item.track.title} onChange={value => onChecked(item, value)} />
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-card">
        {art ? <img src={art} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-subtle"><Music size={16} /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white" title={item.track.title}>{item.track.title}</p>
        <p className="truncate text-xs text-muted" title={item.track.artist}>{item.track.artist}</p>
      </div>
      <div className="aspect-video h-10 flex-shrink-0 overflow-hidden rounded-md bg-card">
        <img src={thumbnailOf(item)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      </div>
      <p className="min-w-0 w-56 flex-shrink truncate text-xs text-white/80" title={item.title}>{item.title || item.url}</p>
      {/* How the video was matched to the song, on hover; under it, Spotify's
          logo when the song has a Spotify Canvas, and where its moving cover
          came from when that's elsewhere (MotionCoverMarks). */}
      <div className="flex min-w-[1rem] flex-shrink-0 flex-col items-center gap-1">
        <span className={`flex items-center ${matched ? 'cursor-help text-muted hover:text-white' : 'invisible'}`} title={matched || undefined} aria-label={matched || undefined}>
          <Info size={13} />
        </span>
        <MotionCoverMarks spotify={canvas} source={item.track.motion_cover_source} />
      </div>
      <button onClick={() => onCheck(item, { start, end, zoom })} className={`${btn} ${checking ? 'border-accent/50 text-accent' : ''}`} title={t('Play the track with this video in the side panel (only a preview: nothing is saved)')}>
        <Play size={11} /> {t('Check video')}
      </button>
      <input inputMode="decimal" value={start} onChange={event => change('start', event.target.value)} className={field(badTime(start))}
        placeholder={t('Start')} title={t('Where the loop starts: seconds or minutes:seconds')} aria-label={t('Where the loop starts: seconds or minutes:seconds')} />
      <input inputMode="decimal" value={end} onChange={event => change('end', event.target.value)} className={field(badTime(end))}
        placeholder={t('End')} title={t('Where the loop ends: seconds or minutes:seconds')} aria-label={t('Where the loop ends: seconds or minutes:seconds')} />
      <ZoomButton zoom={zoom} onChange={changeZoom} className={icon} />
      <button onClick={() => api.openExternal(item.url)} className={icon} title={t('Open the video in the browser')} aria-label={t('Open the video in the browser')}>
        <SquareArrowOutUpRight size={13} />
      </button>
      <button onClick={copy} className={icon} title={t('Copy the link')} aria-label={t('Copy the link')}>
        <Copy size={13} />
      </button>
      <button onClick={() => onReject(item)} className={`${icon} hover:border-red-400/50 hover:text-red-300`} title={t('Wrong video: never offer it for this track again')} aria-label={t('Wrong video')}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

export default function ClipSearch() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [progress, setProgress] = useState({ status: 'idle' })
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'save' | 'cancel' | null
  const [busy, setBusy] = useState(false)
  // The report row whose "Wrong video" waits to be confirmed.
  const [rejecting, setRejecting] = useState(null)
  // The report of a stopped search, opened with "Go to report".
  const [report, setReport] = useState(false)
  const checkingId = usePreviewing()
  // "Check for moving covers": its progress, and whether its popup is open.
  const [coverCheck, setCoverCheck] = useState({ status: 'idle' })
  const [coverCheckOpen, setCoverCheckOpen] = useState(false)
  const statusRef = useRef('idle')
  const timers = useRef(new Map())
  usePageReady(loaded)

  const refresh = useCallback(() => api.clipSearchGet().then(next => {
    setLoaded(true)
    if (next?.unsupported) { setError(t('Clip search works in the desktop app.')); return }
    if (next?.error) { setError(next.error); return }
    setData(next)
    if (next?.progress) { statusRef.current = next.progress.status; setProgress(next.progress) }
  }).catch(e => { setLoaded(true); setError(e?.message || '?') }), [t])

  useEffect(() => {
    refresh()
    return api.onClipSearchProgress(p => {
      if (!p) return
      // Finished, stopped or thrown away: read the whole state again (the list).
      const changed = p.status !== statusRef.current
      statusRef.current = p.status
      setProgress(p)
      if (changed && (p.status === 'done' || p.status === 'idle' || p.status === 'stopped')) refresh()
    })
  }, [refresh])

  // The check's progress, the table's counts with it (a check still running opens its popup again).
  useEffect(() => {
    const apply = p => {
      if (!p) return
      setCoverCheck(p)
      if (p.counts) setData(prev => prev && ({ ...prev, counts: p.counts }))
    }
    api.motionCoverCheckStatus().then(p => { apply(p); if (p?.status === 'running') setCoverCheckOpen(true) }).catch(() => {})
    return api.onMotionCoverCheckProgress(apply)
  }, [])

  // Times typed and not sent yet go now (leaving the tab).
  useEffect(() => () => { for (const [, send] of timers.current) send() }, [])

  const status = progress.status || 'idle'
  const items = useMemo(() => data?.items || [], [data])
  // Only a stopped search keeps its report open; Continue, Cancel or the end close it.
  const reportOpen = report && status === 'stopped'
  useEffect(() => { if (status !== 'stopped') setReport(false) }, [status])
  const checkedCount = items.filter(item => item.checked).length
  const allChecked = items.length > 0 && checkedCount === items.length

  const call = async (fn) => {
    setError(null)
    try {
      const r = await fn()
      if (r && r.ok === false && r.error) setError(t(r.error))
      return r
    } catch (e) { setError(e?.message || '?') }
    return null
  }

  const start = () => call(async () => {
    const r = await api.clipSearchStart()
    if (r?.progress) { statusRef.current = r.progress.status; setProgress(r.progress) }
    return r
  })
  const resume = () => call(async () => {
    const r = await api.clipSearchResume()
    if (r?.progress) { statusRef.current = r.progress.status; setProgress(r.progress) }
    return r
  })
  const stop = () => call(() => api.clipSearchStop())
  const startCoverCheck = () => call(async () => {
    const r = await api.motionCoverCheckStart()
    if (r?.ok) { if (r.progress) setCoverCheck(r.progress); setCoverCheckOpen(true) }
    return r
  })

  const setChecked = (ids, checked) => {
    setData(prev => prev && ({ ...prev, items: prev.items.map(item => (ids.includes(item.trackId) ? { ...item, checked } : item)) }))
    api.clipSearchSetChecked(ids, checked).catch(() => {})
  }

  const clipOf = (item, times) => ({ url: item.url, start: times.start, end: times.end, zoom: times.zoom })

  // The song plays with the video in the side panel's Visualization + Lyrics tab.
  const check = (item, times) => {
    setPreviewing(item.trackId, clipOf(item, times))
    const player = usePlayerStore.getState()
    if (player.currentTrack?.id !== item.trackId) player.playTrack(item.track, [item.track])
    else if (!player.isPlaying) player.togglePlay()
    usePlayerStore.setState({ showRightSidebar: true, sidePanelView: 'visualLyrics' })
  }

  // Typed times and the zoom: the preview follows at once; they're kept in the report a moment later.
  const setTimes = (item, times) => {
    if (previewing === item.trackId) previewClip(item.trackId, clipOf(item, times))
    setData(prev => prev && ({ ...prev, items: prev.items.map(row => (row.trackId === item.trackId ? { ...row, ...times } : row)) }))
    clearTimeout(timers.current.get(item.trackId)?.timer)
    const send = () => { timers.current.delete(item.trackId); api.clipSearchSetTimes(item.trackId, times.start, times.end, times.zoom).catch(() => {}) }
    const timer = setTimeout(send, 400)
    send.timer = timer
    timers.current.set(item.trackId, send)
  }
  const flushTimes = () => {
    const pending = [...timers.current.values()]
    for (const send of pending) { clearTimeout(send.timer); send() }
    return Promise.resolve()
  }

  const cancelAll = async () => {
    setBusy(true)
    try {
      for (const send of timers.current.values()) clearTimeout(send.timer)
      timers.current.clear()
      await api.clipSearchCancel()
      endPreview()
      setConfirm(null)
      await refresh()
    } finally { setBusy(false) }
  }

  const saveChecked = async () => {
    setBusy(true)
    try {
      await flushTimes()
      const r = await api.clipSearchSave()
      setConfirm(null)
      if (!r?.ok) { setError(t(r?.error || '?')); return }
      const { syncTrack } = usePlayerStore.getState()
      for (const done of r.saved || []) {
        if (done.track) syncTrack(done.track)
        announceTrackChanged(done.trackId)
      }
      endPreview((r.saved || []).map(s => s.trackId))
      if (r.reset) endPreview()
      const failed = r.failed || []
      const badTimes = failed.filter(f => f.error === 'bad-time').length
      showToast(failed.length
        ? t('Music videos saved into {saved}; {failed} could not be saved', { saved: plural(r.saved?.length || 0, 'track'), failed: plural(failed.length, 'track') })
          + (badTimes ? ` ${t('(check the loop times)')}` : '')
        : t('Music videos saved into {saved}', { saved: plural(r.saved?.length || 0, 'track') }))
      await refresh()
    } finally { setBusy(false) }
  }

  // The video is marked wrong for the song, which leaves the report at once.
  const rejectItem = async () => {
    const item = rejecting
    if (!item) return
    setBusy(true)
    try {
      const r = await call(() => api.clipSearchReject(item.trackId))
      if (!r?.ok) return
      setRejecting(null)
      setData(prev => prev?.items && ({ ...prev, items: prev.items.filter(it => it.trackId !== item.trackId) }))
      endPreview([item.trackId])
      showToast(t('The video won’t be offered for “{title}” again', { title: item.track.title }))
      // A finished search left empty starts over.
      await refresh()
    } finally { setBusy(false) }
  }

  const missing = data?.counts?.missing ?? null
  const btn = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-white disabled:opacity-50 disabled:hover:text-muted'
  const accentBtn = 'inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-accent/90 disabled:cursor-default disabled:opacity-40'
  const foundText = n => t('Videos found: {n}', { n: n.toLocaleString() })

  return (
    <div className="w-full space-y-6 px-6 pb-12 pt-6">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <MonitorPlay size={18} className="text-accent" />
          <h1 className="font-display text-lg uppercase tracking-[0.28em] text-white">{t('Clip Search')}</h1>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {status === 'idle' && !data?.unsupported && loaded && (
          <div className="mt-6 max-w-xl space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              {t('Looks up the official music video of every track that has none yet, the same way the Videos tab does. Nothing is written into the files until you tick the tracks and save; until then the videos found are only kept here.')}
            </p>
            <LibraryStats counts={data?.counts} />
            <p className="text-xs text-muted">{t('Moving covers are counted as the tracks have them written down: a track gets checked when it plays, shows up in the report or by “Check for moving covers”.')}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={start} disabled={!missing} className={accentBtn}><Play size={12} fill="currentColor" /> {t('Start the search')}</button>
              <button onClick={coverCheck.status === 'running' ? () => setCoverCheckOpen(true) : startCoverCheck} disabled={!data?.counts?.total}
                title={t('Asks every track whether it has a moving cover (Spotify Canvas, Apple Music…), without downloading them')}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-white/85 disabled:cursor-default disabled:opacity-40">
                {coverCheck.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <ImagePlay size={12} />} {t('Check for moving covers')}
              </button>
            </div>
          </div>
        )}

        {(status === 'running' || (status === 'stopped' && !reportOpen)) && (
          <div className="mt-6 space-y-4">
            <Progress progress={progress} found={foundText} />
            <div className="flex flex-wrap gap-2">
              {status === 'running' ? (
                <button onClick={stop} className={btn}><Square size={11} /> {t('Stop')}</button>
              ) : (
                <>
                  <button onClick={resume} className={accentBtn}><Play size={12} fill="currentColor" /> {t('Continue')}</button>
                  <button onClick={() => setConfirm('cancel')} className={btn}><X size={12} /> {t('Cancel')}</button>
                  {/* What was found so far, to save without waiting for the rest. */}
                  <button onClick={() => { setReport(true); refresh() }} disabled={!progress.found} className={btn}
                    title={progress.found ? t('Open the report with the videos found so far') : t('No videos found yet')}>
                    <ListChecks size={12} /> {t('Go to report')}
                  </button>
                </>
              )}
            </div>
            {status === 'stopped' && <p className="text-xs text-muted">{t('Stopped. What was found so far is kept, even if the app is closed: Continue picks up from the same track.')}</p>}
          </div>
        )}

        {reportOpen && (
          <div className="mt-6 space-y-3">
            <button onClick={() => setReport(false)} className={btn}><ArrowLeft size={12} /> {t('Back to the search')}</button>
            <p className="text-xs text-muted">
              {t('The search is stopped at {done} of {total} tracks. These are the videos found so far; Continue looks through the rest.', { done: (progress.done || 0).toLocaleString(), total: (progress.total || 0).toLocaleString() })}
            </p>
            {items.length === 0 && <p className="text-sm text-muted">{t('No videos left in the report.')}</p>}
          </div>
        )}

        {status === 'done' && items.length === 0 && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted">{t('No music videos were found.')}</p>
            <Timing progress={progress} />
            <button onClick={cancelAll} disabled={busy} className={btn}><Check size={12} /> {t('Done')}</button>
          </div>
        )}
      </section>

      {(status === 'done' || reportOpen) && items.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setChecked(items.map(item => item.trackId), !allChecked)} className={btn}>
              <Check size={12} /> {allChecked ? t('Deselect all') : t('Select all')}
            </button>
            <span className="text-xs tabular-nums text-muted">{t('Found: {n} · ticked: {checked}', { n: items.length.toLocaleString(), checked: checkedCount.toLocaleString() })}</span>
          </div>
          {status === 'done' && <Timing progress={progress} />}
          <p className="text-xs text-muted">{t('The loop times are written only when filled in: seconds, minutes:seconds or hours:minutes:seconds, like 75, 1:15 or 0:11.5.')}</p>

          <div className="overflow-x-auto rounded-xl border border-border">
            <div className="min-w-[62rem]">
              {items.map((item, index) => (
                <ReportRow key={item.trackId} item={item} index={index} digits={String(items.length).length} checking={checkingId === item.trackId}
                  onChecked={(row, value) => setChecked([row.trackId], value)} onCheck={check} onTimes={setTimes} onReject={setRejecting} />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button onClick={() => setConfirm('cancel')} className={btn}><X size={12} /> {t('Cancel')}</button>
            <button onClick={() => setConfirm('save')} disabled={!checkedCount} className={accentBtn}>
              {busy && confirm === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {t('Save')}
            </button>
          </div>
        </section>
      )}

      <CoverCheckModal open={coverCheckOpen} progress={coverCheck} onClose={() => setCoverCheckOpen(false)}
        onStop={() => api.motionCoverCheckStop().catch(() => {})} />
      <Confirm open={confirm === 'save'} busy={busy} onClose={() => setConfirm(null)} onConfirm={saveChecked}
        title={t('Save music videos')} confirmLabel={t('Save')}
        text={t('Music video links will be written into the tags of {tracks}, with the loop times where they are filled in and the zoom where it isn’t 0. The tracks left unticked stay in the list.', { tracks: plural(checkedCount, 'track') })} />
      <Confirm open={confirm === 'cancel'} busy={busy} danger onClose={() => setConfirm(null)} onConfirm={cancelAll}
        title={t('Cancel clip search')} confirmLabel={t('Delete found videos')}
        text={t('All the music videos found ({n}) will be deleted from the report. The tracks themselves are not changed.', { n: (status === 'done' ? items.length : progress.found || 0).toLocaleString() })} />
      <Confirm open={!!rejecting} busy={busy} danger onClose={() => setRejecting(null)} onConfirm={rejectItem}
        title={t('Wrong video')} confirmLabel={t('Mark as wrong')}
        text={t('Mark this video as wrong for “{title}”? It won’t be offered for this track again, and the track leaves the report; a new search looks for another video for it.', { title: rejecting?.track?.title || '' })} />
    </div>
  )
}
