// Listening History: every play from every device (this PC and the phones
// that share the music folder through Syncthing), newest first, by day.
// The plays live in <music folder>/ListeningHistory (electron/listeningHistory.js);
// the page reads the database's copy of them and refreshes when another
// device's plays come in.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, FolderOpen, History as HistoryIcon, Laptop, Pause, Play, Radio, RefreshCw, Smartphone } from 'lucide-react'
import { api } from '../api'
import { getLanguage, translate, useTranslation } from '../i18n'
import { useCachedState, usePageReady } from '../pageCache'
import { useAppStore, usePlayerStore } from '../store/player'
import { useRadioStore } from '../store/radio'
import { RADIO_CONTEXT, stationTrack } from '../radio/stations'
import TrackList from '../components/TrackList'

const PAGE = 300

function dayLabel(seconds) {
  const date = new Date(Number(seconds) * 1000)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return translate('Today')
  if (date.toDateString() === yesterday.toDateString()) return translate('Yesterday')
  return date.toLocaleDateString(getLanguage(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** "3:07": how long a play went on. */
function listened(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const pad = (n) => String(n).padStart(2, '0')
  // A long time on a station: hours too.
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}

function DeviceLabel({ device }) {
  if (!device) return null
  const Icon = device.startsWith('Android') ? Smartphone : Laptop
  return <span className="inline-flex min-w-0 items-center gap-1" title={device}><Icon size={11} className="flex-shrink-0" /><span className="truncate">{device.replace(/^(PC|Android) · /, '')}</span></span>
}

/** "14:07": when a play ended. */
const playedAt = (entry) => new Date(Number(entry.played_at) * 1000).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' })

const SCROBBLE_SERVICES = [['Last.fm', 'lastfm'], ['ListenBrainz', 'listenbrainz']]

/**
 * Where this PC's play was scrobbled: a white ring (nowhere yet), its left
 * half filled (some of its services), green (all of them). The services are
 * the ones that were on when the play counted; none (too short, or from
 * another device) - no circle. Hovering a ring that isn't green shows each
 * service's state and why it's still waiting.
 */
function ScrobbleDot({ track }) {
  const { t } = useTranslation()
  const [at, setAt] = useState(null)
  const states = SCROBBLE_SERVICES
    .map(([name, key]) => ({ name, state: track[`scrobble_${key}`], error: track[`scrobble_${key}_error`] }))
    .filter(({ state }) => state === 0 || state === 1)
  if (!states.length) return null
  const sent = states.filter(({ state }) => state === 1).length
  const all = sent === states.length
  const show = (event) => {
    if (all) return
    const rect = event.currentTarget.getBoundingClientRect()
    setAt({ right: window.innerWidth - rect.right, top: rect.bottom + 6 })
  }
  return (
    <span className="inline-flex items-center" onMouseEnter={show} onMouseLeave={() => setAt(null)}>
      <svg width="11" height="11" viewBox="0 0 12 12" className={all ? 'text-green-400' : 'text-white'} aria-label={all ? t('Scrobbled') : undefined}>
        <circle cx="6" cy="6" r="5" fill={all ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
        {!all && sent > 0 && <path d="M6 1 A5 5 0 0 0 6 11 Z" fill="currentColor" />}
      </svg>
      {at && createPortal(
        <div className="pointer-events-none fixed z-[1000] w-72 rounded-lg border border-border bg-elevated px-3 py-2 text-left text-xs shadow-xl" style={{ right: at.right, top: at.top }}>
          {states.map(({ name, state, error }) => (
            <div key={name} className="py-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white">{name}</span>
                <span className={state === 1 ? 'text-green-400' : 'text-muted'}>{t(state === 1 ? 'sent' : 'waiting to be sent')}</span>
              </div>
              {state !== 1 && error && <p className="mt-0.5 whitespace-normal text-[11px] leading-snug text-muted">{t(error)}</p>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}

const historyColumns = () => [
  { key: 'played', label: translate('Played'), width: 4, render: playedAt },
  { key: 'listened', label: translate('Listened'), width: 5.5, render: track => track.live ? translate('now') : listened(track.seconds_played) },
  { key: 'device', label: translate('Device'), width: 8, render: track => <DeviceLabel device={track.device} /> },
  { key: 'scrobble', label: '', width: 1.75, render: track => <ScrobbleDot track={track} /> },
]

/**
 * Time on an online radio station. A click plays it (the catalogue's station
 * of that name when it's still there, else the stream as it was).
 */
function StationRow({ entry }) {
  const { t } = useTranslation()
  const catalog = useRadioStore(state => state.catalog)
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayerStore()
  const name = entry.station?.title || ''
  const station = catalog?.stations?.find(item => item.title.toLowerCase() === name.toLowerCase()) || (entry.station?.url ? { ...entry.station, id: entry.station.id || entry.station.url } : null)
  const current = !!station && currentTrack?.id === station.id
  const play = () => {
    if (!station) return
    if (current) { togglePlay(); return }
    const track = stationTrack(station, catalog?.title || '')
    playTrack(track, [track], { type: RADIO_CONTEXT, name: catalog?.title || t('Online Radio') })
  }
  return (
    <button type="button" onClick={play} disabled={!station} title={station ? t('Play {name}', { name }) : name}
      className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04] disabled:cursor-default">
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-card ${current ? 'text-accent' : 'text-muted'}`}>
        {current && isPlaying ? <Pause size={15} /> : <><Radio size={16} className="group-hover:hidden" /><Play size={14} className="hidden group-hover:block" /></>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${current ? 'text-accent' : 'text-white'}`}>{name}</span>
        <span className="block truncate text-xs text-muted">{t('Online Radio')}</span>
      </span>
      <span className="w-16 flex-shrink-0 text-right text-xs text-muted">{playedAt(entry)}</span>
      <span className="w-20 flex-shrink-0 text-right text-xs text-muted">{entry.live ? t('now') : listened(entry.seconds_played)}</span>
      <span className="w-32 flex-shrink-0 truncate text-right text-xs text-muted"><DeviceLabel device={entry.device} /></span>
    </button>
  )
}

/** A day's rows: runs of songs as track lists, stations between them. */
function DayEntries({ entries }) {
  const runs = []
  for (const entry of entries) {
    const station = entry.kind === 'station'
    const last = runs[runs.length - 1]
    if (!station && last?.songs) last.songs.push(entry)
    else runs.push(station ? { station: entry } : { songs: [entry] })
  }
  return runs.map((run, index) => run.station
    ? <StationRow key={run.station.history_id} entry={run.station} />
    : <TrackList key={`songs-${index}`} tracks={run.songs} extraColumns={historyColumns()} reduceMotion context={{ type: 'history', name: 'Listen History' }} />)
}

export default function History() {
  const { user } = useAppStore()
  return <HistoryContent key={user?.id || 'guest'} userId={user?.id || 'guest'} />
}

function HistoryContent({ userId }) {
  const { t } = useTranslation()
  const [entries, setEntries, wasCached] = useCachedState(`history:${userId}`, [])
  const [loaded, setLoaded] = useState(wasCached)
  const [more, setMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [info, setInfo] = useState(null)
  const shownRef = useRef(entries.length)
  shownRef.current = entries.length
  usePageReady(loaded)

  // The newest plays again, as many as are on screen (at least a page).
  const reload = useCallback(async () => {
    const result = await Promise.resolve(api.getHistory(userId, Math.max(PAGE, shownRef.current))).catch(() => null)
    if (Array.isArray(result)) {
      setEntries(result)
      setMore(result.length >= Math.max(PAGE, shownRef.current))
    }
    setLoaded(true)
  }, [userId, setEntries])

  const initRadio = useRadioStore(state => state.init)
  useEffect(() => {
    reload()
    initRadio()
    Promise.resolve(api.historyInfo()).then(setInfo).catch(() => {})
    const off = api.onHistoryChanged(reload)
    const onFocus = () => reload()
    window.addEventListener('focus', onFocus)
    window.addEventListener('lokal:refresh', onFocus)
    return () => {
      off?.()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('lokal:refresh', onFocus)
    }
  }, [reload])

  const loadMore = async () => {
    const last = entries[entries.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    const result = await Promise.resolve(api.getHistory(userId, PAGE, last.played_at)).catch(() => null)
    if (Array.isArray(result)) {
      setEntries(current => [...current, ...result])
      setMore(result.length >= PAGE)
    }
    setLoadingMore(false)
  }

  // The play going on now: at the top straight away (its own row comes when it ends).
  const listening = usePlayerStore(state => state.listening)
  const playing = usePlayerStore(state => state.currentTrack)
  const [liveStatus, setLiveStatus] = useState(null)
  const livePid = listening?.pid || null
  useEffect(() => {
    setLiveStatus(null)
    if (!livePid) return undefined
    const load = () => Promise.resolve(api.scrobbleStatus([livePid])).then(states => setLiveStatus(states?.[livePid] || null)).catch(() => {})
    load()
    // Sent (or failed) in the middle of the song: the dot changes then.
    return api.onHistoryChanged(load)
  }, [livePid])
  let live = null
  if (listening && playing?.id === listening.trackId && !(livePid && entries.some(entry => entry.pid === livePid))) {
    const device = `PC · ${t('this computer')}`
    live = playing.station
      ? { kind: 'station', history_id: 'live', played_at: listening.startedAt, device, station: { id: playing.station.id, title: playing.station.title, url: playing.station.url }, live: true }
      : {
          ...playing, history_id: 'live', played_at: listening.startedAt, device, live: true, pid: livePid,
          scrobble_lastfm: liveStatus?.lastfm ?? null, scrobble_listenbrainz: liveStatus?.listenbrainz ?? null,
          scrobble_lastfm_error: liveStatus?.lastfm_error ?? null, scrobble_listenbrainz_error: liveStatus?.listenbrainz_error ?? null,
        }
  }
  const shown = live ? [live, ...entries] : entries

  const groups = []
  for (const entry of shown) {
    const label = dayLabel(entry.played_at)
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, entries: [] })
    groups[groups.length - 1].entries.push(entry)
  }

  return (
    <div className="p-6 pb-10 space-y-6 w-full max-w-6xl mx-auto">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-accent">
          <HistoryIcon size={13} />
          {t('History')}
        </div>
        <h1 className="mt-2 text-3xl font-display text-white">{t('Listen History')}</h1>
        <p className="mt-1 text-sm text-muted">{t('Every song and online radio station you played on this computer and on your other devices that share the music folder.')}</p>
        {info?.folder && (
          <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted/70" title={info.folder}>
            <FolderOpen size={12} className="flex-shrink-0" />
            <span className="truncate">{t('Kept in {folder}, this computer writes to {device}', { folder: info.folder, device: info.device })}</span>
          </p>
        )}
      </div>

      {!shown.length ? (
        <p className="py-10 text-center text-sm text-muted">{loaded ? t('No listen history yet.') : t('Loading...')}</p>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <section key={group.label}>
              <div className="mb-2 flex items-center gap-2 text-xs font-display uppercase tracking-widest text-muted">
                <CalendarDays size={14} />
                {group.label}
                <span className="text-muted/60">· {group.entries.length}</span>
              </div>
              <div className="rounded-xl border border-border bg-elevated p-3">
                <DayEntries entries={group.entries} />
              </div>
            </section>
          ))}
          {more && (
            <div className="flex justify-center">
              <button onClick={loadMore} disabled={loadingMore}
                className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm text-muted transition-colors hover:border-accent/40 hover:text-white disabled:opacity-50">
                {loadingMore && <RefreshCw size={13} className="animate-spin" />}
                {t('Show older plays')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
