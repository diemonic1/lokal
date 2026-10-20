// Lyrics Search: lyrics looked up for every song that could have better ones
// (none -> any, plain -> synced or syllable, synced -> syllable), kept apart
// until Save. Each song found can be checked (played with the found lyrics in
// the side panel) or compared with its own and edited; only the ticked ones
// are written into their files. Stopping keeps what was found so far, even
// across a restart, and "Go to report" opens it to save from without waiting
// for the rest; Cancel throws it all away. See electron/lyrics/bulkSearch.js.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Clock, EyeOff, FileSearch, GitCompareArrows, Info, ListChecks, Loader2, Music, Play, Square, X } from 'lucide-react'
import { api } from '../api'
import Modal from '../components/Modal'
import { getLanguage, useTranslation } from '../i18n'
import { usePageReady } from '../pageCache'
import { plural } from '../plural'
import { trackArtURL } from '../onlineTracks'
import { usePlayerStore } from '../store/player'
import { announceLyricsFileChanged } from '../lyricLine'
import { announceTrackChanged } from '../trackChanged'
import { clearLyricsPreview, showLyricsPreview, useLyricsPreview } from '../lyricsPreview'
import { showToast } from '../components/Toaster'
import LyricsIgnoreList from '../components/LyricsIgnoreList'

const KINDS_KEY = 'lokal-lyrics-search-kinds'

function savedKinds() {
  try {
    const value = JSON.parse(localStorage.getItem(KINDS_KEY) || 'null')
    if (value && typeof value === 'object') return { plain: !!value.plain, sync: !!value.sync }
  } catch {}
  return { plain: true, sync: true }
}

/** A kind of lyrics as the song list's Lyrics column shows it. */
function KindLabel({ kind }) {
  const { t } = useTranslation()
  const tone = !kind ? 'text-[#ff4848]' : kind === 'syllable' ? 'text-accent' : kind === 'sync' ? 'text-accent/80' : 'text-muted'
  return <span className={`font-display text-xs ${tone}`}>{kind ? kind : t('no lyrics')}</span>
}

function Checkbox({ checked, disabled, onChange, label }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange?.(!checked)}
      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${checked ? 'border-accent bg-accent text-black' : 'border-white/25 bg-transparent hover:border-white/50'} ${disabled ? 'cursor-default opacity-60' : ''}`}>
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  )
}

function useDuration() {
  const { t } = useTranslation()
  return (ms) => {
    if (ms == null) return null
    // Hours only when there are any; minutes and seconds always, seconds alone at the end.
    const total = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h) return t('{h} h {m} min {s} s', { h, m, s })
    if (m) return t('{m} min {s} s', { m, s })
    return t('{s} s', { s })
  }
}

/** A moment of the search: the time, with the date when it wasn't today. */
function moment(at) {
  if (!at) return null
  const date = new Date(at)
  const time = date.toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === new Date().toDateString()) return time
  return `${date.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'long' })}, ${time}`
}

/** When the search started and finished, and how long it took (the pauses left out too, if there were any). */
function Timing({ progress }) {
  const { t } = useTranslation()
  const duration = useDuration()
  const { startedAt, finishedAt, runMs } = progress
  if (!startedAt || !finishedAt) return null
  const total = finishedAt - startedAt
  // Stopped and continued: the time spent searching differs from start-to-end.
  const paused = runMs != null && total - runMs >= 60000
  return (
    <p className="text-xs tabular-nums text-muted">
      {t('Started: {time}', { time: moment(startedAt) })} · {t('Finished: {time}', { time: moment(finishedAt) })} · {t('Took {time}', { time: duration(total) })}
      {paused && ` ${t('(searching: {time})', { time: duration(runMs) })}`}
    </p>
  )
}

/** Progress while searching (or stopped): done / total, percent, time left. */
function Progress({ progress }) {
  const { t } = useTranslation()
  const duration = useDuration()
  const total = progress.total || 0
  const done = Math.min(progress.done || 0, total)
  const pct = total ? Math.floor((done / total) * 100) : 0
  const left = duration(progress.etaMs)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-4xl tabular-nums text-white">{pct}%</span>
        <span className="text-xs tabular-nums text-muted">{t('{done} of {total} files', { done: done.toLocaleString(), total: total.toLocaleString() })}</span>
        <span className="text-xs tabular-nums text-muted">{t('Lyrics found: {n}', { n: (progress.found || 0).toLocaleString() })}</span>
        {progress.startedAt && <span className="text-xs tabular-nums text-muted">{t('Started: {time}', { time: moment(progress.startedAt) })}</span>}
        <span className="text-xs tabular-nums text-muted">
          {left ? t('About {time} left', { time: left }) : t('Time left is shown after the first 10 files')}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      {progress.status === 'running' && <p className="truncate text-xs text-muted">{progress.current || t('Looking for files...')}</p>}
    </div>
  )
}

/** Compare: the file's lyrics (read-only) next to the found ones (editable). */
function CompareModal({ item, onClose, onApplied }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!item) return undefined
    let alive = true
    setData(null); setError(null)
    api.lyricsSearchCompare(item.trackId).then(r => {
      if (!alive) return
      if (r?.ok) { setData(r); setText(r.text || '') } else setError(r?.error || '?')
    }).catch(e => alive && setError(e?.message || '?'))
    return () => { alive = false }
  }, [item])

  const apply = async () => {
    if (!data || busy) return
    if (text === data.text) { onClose(); return }
    setBusy(true)
    setError(null)
    try {
      const r = await api.lyricsSearchEdit(item.trackId, text)
      if (r?.ok) { onApplied(item.trackId, r); onClose() }
      else setError(r?.error === 'not-higher'
        ? t('These lyrics are not a level above the ones in the file ({kind}), so they can’t replace them.', { kind: r.kind || t('no lyrics') })
        : r?.error === 'empty' ? t('The new lyrics are empty.') : (r?.error || '?'))
    } catch (e) { setError(e?.message || '?') } finally { setBusy(false) }
  }

  const area = 'min-h-0 w-full flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs leading-relaxed outline-none'
  return (
    <Modal open={!!item} onClose={onClose} title={t('Compare lyrics')} width="max-w-6xl" clearBackdrop>
      <div className="flex h-[min(calc(46rem+50px),calc(100vh-8rem))] flex-col gap-3">
        {item && <p className="truncate text-sm text-white">{item.track.title} <span className="text-muted">— {item.track.artist}</span></p>}
        {!data && !error && <div className="flex flex-1 items-center justify-center text-muted"><Loader2 size={16} className="animate-spin" /></div>}
        {data && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3">
            <div className="flex min-h-0 flex-col">
              <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">{t('Original lyrics')} · <KindLabel kind={data.originalKind} /></p>
              <textarea readOnly value={data.original} spellCheck={false} className={`${area} text-white/60`} />
            </div>
            <div className="flex items-center text-muted"><ArrowRight size={18} /></div>
            <div className="flex min-h-0 flex-col">
              <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">{t('New lyrics')} · <KindLabel kind={data.kind} /></p>
              <textarea value={text} onChange={e => setText(e.target.value)} spellCheck={false} className={`${area} text-white focus:border-accent/50`} />
              {data.syllable && <p className="mt-1 text-[11px] leading-snug text-muted">{t('Word and syllable timings: <mm:ss.xxx> before each syllable, a space after a word. The lyrics tag is made from these lines.')}</p>}
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-xs text-muted hover:text-white">{t('Cancel')}</button>
          <button onClick={apply} disabled={!data || busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-50">
            {busy && <Loader2 size={12} className="animate-spin" />} {t('Apply')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Confirm({ open, title, text, confirmLabel, danger, busy, onConfirm, onClose }) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} width="max-w-md">
      <p className="text-sm leading-relaxed text-white/80">{text}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-xs text-muted hover:text-white disabled:opacity-50">{t('Back')}</button>
        <button onClick={onConfirm} disabled={busy}
          className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50 ${danger ? 'bg-red-500/90 text-white hover:bg-red-500' : 'bg-accent text-black hover:bg-accent/90'}`}>
          {busy && <Loader2 size={12} className="animate-spin" />} {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export default function LyricsSearch() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [progress, setProgress] = useState({ status: 'idle' })
  const [kinds, setKinds] = useState(savedKinds)
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [comparing, setComparing] = useState(null)
  const [confirm, setConfirm] = useState(null) // 'save' | 'cancel' | null
  const [busy, setBusy] = useState(false)
  // The report row whose "Add to the ignore list" waits to be confirmed.
  const [ignoring, setIgnoring] = useState(null)
  // The report of a stopped search, opened with "Go to report".
  const [report, setReport] = useState(false)
  const [sources, setSources] = useState([])
  const previewId = useLyricsPreview(s => s.trackId)
  const statusRef = useRef('idle')
  usePageReady(loaded)

  const refresh = useCallback(() => api.lyricsSearchGet().then(next => {
    setLoaded(true)
    if (next?.unsupported) { setError(t('Lyrics search works in the desktop app.')); return }
    if (next?.error) { setError(next.error); return }
    setData(next)
    if (next?.progress) { statusRef.current = next.progress.status; setProgress(next.progress) }
  }).catch(e => { setLoaded(true); setError(e?.message || '?') }), [t])

  useEffect(() => {
    refresh()
    return api.onLyricsSearchProgress(p => {
      if (!p) return
      // Finished or thrown away: read the whole state again (the list).
      const changed = p.status !== statusRef.current
      statusRef.current = p.status
      setProgress(p)
      if (changed && (p.status === 'done' || p.status === 'idle' || p.status === 'stopped')) refresh()
    })
  }, [refresh])

  // The sources' names, for the report's "i".
  useEffect(() => {
    api.getLyricsSources?.().then(s => setSources(s?.providers || [])).catch(() => {})
  }, [])

  // "Insert into report" in the side panel's source menu: that row's new lyrics.
  useEffect(() => {
    const onEntry = (e) => {
      const { trackId, toKind, source } = e.detail || {}
      setData(prev => prev?.items && ({ ...prev, items: prev.items.map(item => (item.trackId === trackId ? { ...item, toKind, source: source || item.source, edited: false } : item)) }))
    }
    // "Remove wrong lyrics" there with nothing else to put in: the row leaves the report.
    const onRemoved = (e) => {
      const { trackId } = e.detail || {}
      setData(prev => prev?.items && ({ ...prev, items: prev.items.filter(item => item.trackId !== trackId) }))
      setComparing(prev => (prev?.trackId === trackId ? null : prev))
      refresh()
    }
    window.addEventListener('lokal:lyrics-search-entry', onEntry)
    window.addEventListener('lokal:lyrics-search-removed', onRemoved)
    return () => {
      window.removeEventListener('lokal:lyrics-search-entry', onEntry)
      window.removeEventListener('lokal:lyrics-search-removed', onRemoved)
    }
  }, [refresh])

  const status = progress.status || 'idle'
  const items = useMemo(() => data?.items || [], [data])
  // Only a stopped search keeps its report open; Continue, Cancel or the end close it.
  const reportOpen = report && status === 'stopped'
  useEffect(() => { if (status !== 'stopped') setReport(false) }, [status])
  const sourceName = (id) => sources.find(s => s.id === id)?.label || id
  const checkedCount = items.filter(item => item.checked).length
  const allChecked = items.length > 0 && checkedCount === items.length

  const setKind = (key, value) => setKinds(prev => {
    const next = { ...prev, [key]: value }
    try { localStorage.setItem(KINDS_KEY, JSON.stringify(next)) } catch {}
    return next
  })

  const call = async (fn) => {
    setError(null)
    try {
      const r = await fn()
      if (r && r.ok === false && r.error) setError(r.error)
      return r
    } catch (e) { setError(e?.message || '?') }
    return null
  }

  const start = (options = {}) => call(async () => {
    const r = await api.lyricsSearchStart(kinds, options)
    if (r?.progress) { statusRef.current = r.progress.status; setProgress(r.progress) }
    return r
  })
  const resume = () => call(async () => {
    const r = await api.lyricsSearchResume()
    if (r?.progress) { statusRef.current = r.progress.status; setProgress(r.progress) }
    return r
  })
  const stop = () => call(() => api.lyricsSearchStop())

  const setChecked = (ids, checked) => {
    setData(prev => prev && ({ ...prev, items: prev.items.map(item => (ids.includes(item.trackId) ? { ...item, checked } : item)) }))
    api.lyricsSearchSetChecked(ids, checked).catch(() => {})
  }

  const check = async (item) => {
    const preview = await api.lyricsSearchPreview(item.trackId).catch(() => null)
    if (!preview) { showToast(t("Couldn't read the found lyrics")); return }
    showLyricsPreview(item.trackId, preview)
    const player = usePlayerStore.getState()
    if (player.currentTrack?.id !== item.trackId) player.playTrack(item.track, [item.track])
    else if (!player.isPlaying) player.togglePlay()
    usePlayerStore.setState({ showRightSidebar: true, sidePanelView: 'lyrics' })
  }

  const applied = async (trackId, r) => {
    setData(prev => prev && ({ ...prev, items: prev.items.map(item => (item.trackId === trackId ? { ...item, toKind: r.toKind, edited: true } : item)) }))
    // Being checked right now: the side panel shows the edited lyrics.
    if (previewId === trackId) {
      const preview = await api.lyricsSearchPreview(trackId).catch(() => null)
      if (preview) showLyricsPreview(trackId, preview)
    }
  }

  const cancelAll = async () => {
    setBusy(true)
    try {
      await api.lyricsSearchCancel()
      clearLyricsPreview()
      setConfirm(null)
      await refresh()
    } finally { setBusy(false) }
  }

  const saveChecked = async () => {
    setBusy(true)
    try {
      const r = await api.lyricsSearchSave()
      setConfirm(null)
      if (!r?.ok) { setError(r?.error || '?'); return }
      const byId = new Map(items.map(item => [item.trackId, item]))
      const { syncTrack } = usePlayerStore.getState()
      for (const done of r.saved || []) {
        const item = byId.get(done.trackId)
        if (item && done.lyricsKind != null) syncTrack({ ...item.track, lyrics_kind: done.lyricsKind })
        announceLyricsFileChanged(done.trackId)
        announceTrackChanged(done.trackId)
      }
      clearLyricsPreview((r.saved || []).map(s => s.trackId))
      if (r.reset) clearLyricsPreview()
      const failed = (r.failed || []).length
      showToast(failed
        ? t('Lyrics saved into {saved}; {failed} could not be saved', { saved: plural(r.saved?.length || 0, 'track'), failed: plural(failed, 'track') })
        : t('Lyrics saved into {saved}', { saved: plural(r.saved?.length || 0, 'track') }))
      await refresh()
    } finally { setBusy(false) }
  }

  // The song goes on the ignore list and leaves the report at once.
  const ignoreItem = async () => {
    const item = ignoring
    if (!item) return
    setBusy(true)
    try {
      const r = await call(() => api.lyricsSearchIgnoreFromReport(item.trackId))
      if (!r?.ok) return
      setIgnoring(null)
      setData(prev => prev?.items && ({ ...prev, items: prev.items.filter(it => it.trackId !== item.trackId) }))
      if (comparing?.trackId === item.trackId) setComparing(null)
      clearLyricsPreview([item.trackId])
      showToast(t('“{title}” added to the ignore list', { title: item.track.title }))
      // The counts too (and a finished search left empty starts over).
      await refresh()
    } finally { setBusy(false) }
  }

  const counts = data?.counts || {}
  // Tracks added in the last day that the boxes ticked above would look at.
  const recent = counts.recent || {}
  const recentCount = (recent.none || 0) + (kinds.plain ? recent.plain || 0 : 0) + (kinds.sync ? recent.sync || 0 : 0)
  const btn = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-white disabled:opacity-50 disabled:hover:text-muted'
  const accentBtn = 'inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-accent/90 disabled:cursor-default disabled:opacity-40'

  return (
    <div className="w-full space-y-6 px-6 pb-12 pt-6">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <FileSearch size={18} className="text-accent" />
          <h1 className="font-display text-lg uppercase tracking-[0.28em] text-white">{t('Lyrics Search')}</h1>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {/* Before the search starts (or while it's stopped): what it never looks up. */}
        {(status === 'idle' || (status === 'stopped' && !reportOpen)) && loaded && !data?.unsupported && (
          <div className="mt-6"><LyricsIgnoreList /></div>
        )}

        {status === 'idle' && !data?.unsupported && loaded && (
          <div className="mt-6 max-w-xl space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              {t('Looks up lyrics for the songs that could have better ones. Nothing is written into the files until you tick the songs and save; until then the lyrics found are only kept here.')}
            </p>
            <div className="space-y-2 rounded-xl border border-border bg-card/50 p-4">
              <p className="pb-1 text-[11px] uppercase tracking-wider text-muted">{t('Look for lyrics for')}</p>
              {[
                ['none', t('Tracks without lyrics'), true, true, counts.none],
                ['plain', t('Tracks with plain lyrics'), kinds.plain, false, counts.plain],
                ['sync', t('Tracks with synced lyrics'), kinds.sync, false, counts.sync],
              ].map(([key, label, checked, locked, count]) => (
                <label key={key} className={`flex items-center gap-3 text-sm ${locked ? 'text-white/70' : 'cursor-pointer text-white'}`}>
                  <Checkbox checked={checked} disabled={locked} label={label} onChange={value => setKind(key, value)} />
                  <span className="flex-1">{label}</span>
                  {count != null && <span className="text-xs tabular-nums text-muted">{count.toLocaleString()}</span>}
                </label>
              ))}
              <p className="pt-1 text-[11px] leading-snug text-muted">
                {t('Lyrics only go up a level: plain over none, synced over plain, by syllable over synced. Syllable, instrumental and “can’t be found” tracks are skipped.')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => start()} className={accentBtn}><Play size={12} fill="currentColor" /> {t('Start the search')}</button>
              {/* The same kinds, among the tracks added in the last day only. */}
              <button onClick={() => start({ recent: true })} disabled={!recentCount} className={btn}
                title={recentCount ? t('Look only at the tracks added to the library in the last day') : t('No tracks were added in the last day')}>
                <Clock size={12} /> {t('Added in the last day')} <span className="tabular-nums">({recentCount.toLocaleString()})</span>
              </button>
            </div>
          </div>
        )}

        {(status === 'running' || (status === 'stopped' && !reportOpen)) && (
          <div className="mt-6 space-y-4">
            <Progress progress={progress} />
            <div className="flex flex-wrap gap-2">
              {status === 'running' ? (
                <button onClick={stop} className={btn}><Square size={11} /> {t('Stop')}</button>
              ) : (
                <>
                  <button onClick={resume} className={accentBtn}><Play size={12} fill="currentColor" /> {t('Continue')}</button>
                  <button onClick={() => setConfirm('cancel')} className={btn}><X size={12} /> {t('Cancel')}</button>
                  {/* What was found so far, to save without waiting for the rest. */}
                  <button onClick={() => { setReport(true); refresh() }} disabled={!progress.found} className={btn}
                    title={progress.found ? t('Open the report with the lyrics found so far') : t('No lyrics found yet')}>
                    <ListChecks size={12} /> {t('Go to report')}
                  </button>
                </>
              )}
            </div>
            {status === 'stopped' && <p className="text-xs text-muted">{t('Stopped. What was found so far is kept, even if the app is closed: Continue picks up from the same file.')}</p>}
          </div>
        )}

        {reportOpen && (
          <div className="mt-6 space-y-3">
            <button onClick={() => setReport(false)} className={btn}><ArrowLeft size={12} /> {t('Back to the search')}</button>
            <p className="text-xs text-muted">
              {t('The search is stopped at {done} of {total} files. These are the lyrics found so far; Continue looks through the rest.', { done: (progress.done || 0).toLocaleString(), total: (progress.total || 0).toLocaleString() })}
            </p>
            {items.length === 0 && <p className="text-sm text-muted">{t('No lyrics left in the report.')}</p>}
          </div>
        )}

        {status === 'done' && items.length === 0 && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted">{t('No better lyrics were found.')}</p>
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

          <div className="overflow-hidden rounded-xl border border-border">
            {items.map((item, index) => {
              const art = trackArtURL(item.track)
              const checking = previewId === item.trackId
              return (
                <div key={item.trackId} className={`flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-card ${checking ? 'bg-accent/[0.06]' : ''}`}>
                  <span className="min-w-[2ch] flex-shrink-0 text-right text-xs tabular-nums text-muted" style={{ width: `${String(items.length).length}ch` }}>{index + 1}</span>
                  <Checkbox checked={item.checked} label={item.track.title} onChange={value => setChecked([item.trackId], value)} />
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-card">
                    {art ? <img src={art} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-subtle"><Music size={16} /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white" title={item.track.title}>{item.track.title}</p>
                    <p className="truncate text-xs text-muted" title={item.track.artist}>{item.track.artist}</p>
                  </div>
                  <button onClick={() => check(item)} className={`${btn} ${checking ? 'border-accent/50 text-accent' : ''}`} title={t('Play the track with the found lyrics in the side panel')}>
                    <Play size={11} /> {t('Check lyrics')}
                  </button>
                  <button onClick={() => setComparing(item)} className={btn} title={t('Compare with the lyrics in the file, and edit')}>
                    <GitCompareArrows size={12} /> {t('Compare lyrics')}
                  </button>
                  <button onClick={() => setIgnoring(item)} className={btn} title={t('Never look up lyrics for this track again, and take it out of the report')}>
                    <EyeOff size={12} /> {t('Add to the ignore list')}
                  </button>
                  <span className="flex w-40 flex-shrink-0 items-center justify-end gap-1.5 whitespace-nowrap" title={item.edited ? t('Edited') : undefined}>
                    <KindLabel kind={item.fromKind} /> <span className="text-xs text-muted">→</span> <KindLabel kind={item.toKind} />
                    {item.edited && <span className="text-[10px] text-muted">*</span>}
                  </span>
                  {/* Where the lyrics came from, on hover. */}
                  <span className="flex flex-shrink-0 cursor-help items-center text-muted hover:text-white"
                    title={item.source ? t('Lyrics found on {source}', { source: sourceName(item.source) }) : t('The source of these lyrics is unknown')}
                    aria-label={item.source ? t('Lyrics found on {source}', { source: sourceName(item.source) }) : t('The source of these lyrics is unknown')}>
                    <Info size={13} />
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button onClick={() => setConfirm('cancel')} className={btn}><X size={12} /> {t('Cancel')}</button>
            <button onClick={() => setConfirm('save')} disabled={!checkedCount} className={accentBtn}><Check size={12} /> {t('Save')}</button>
          </div>
        </section>
      )}

      <CompareModal item={comparing} onClose={() => setComparing(null)} onApplied={applied} />
      <Confirm open={confirm === 'save'} busy={busy} onClose={() => setConfirm(null)} onConfirm={saveChecked}
        title={t('Save lyrics')} confirmLabel={t('Save')}
        text={t('Lyrics will be written into the tags of {tracks}. The tracks left unticked stay in the list.', { tracks: plural(checkedCount, 'track') })} />
      <Confirm open={confirm === 'cancel'} busy={busy} danger onClose={() => setConfirm(null)} onConfirm={cancelAll}
        title={t('Cancel lyrics search')} confirmLabel={t('Delete found lyrics')}
        text={t('All the lyrics found ({n}) will be deleted, including edited ones. The tracks themselves are not changed.', { n: (status === 'done' ? items.length : progress.found || 0).toLocaleString() })} />
      <Confirm open={!!ignoring} busy={busy} onClose={() => setIgnoring(null)} onConfirm={ignoreItem}
        title={t('Add to the ignore list')} confirmLabel={t('Add to the ignore list')}
        text={t('Add “{title}” to the ignore list? Lyrics will no longer be looked up for it, and the lyrics found now are taken out of the report. The track itself is not changed.', { title: ignoring?.track?.title || '' })} />
    </div>
  )
}
