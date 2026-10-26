import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, Scaling, Play, Pause, SkipBack, SkipForward, Heart, Shuffle, Repeat, Repeat1, Mic2, ListMusic, ListPlus, Search, Maximize2, Expand, Minimize, Volume2, Film, Clapperboard, Image as ImageIcon, SquareArrowOutUpRight, Square, RectangleHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import LyricsPanel from './LyricsPanel'
import { cacheLyrics, hasLyricLines, peekLyrics } from '../lyrics/lyricsCache'
import ArtworkBackdrop, { meshKeyFor, useArtworkBackdropEnabled } from './ArtworkBackdrop'
import MotionCover, { loadMotionCover } from './MotionCover'
import ClipLoop, { useTrackClip } from './ClipLoop'
import { clipOpenUrl } from '../clipVideo'
import { openLink } from '../trackLinks'
import { previewAppearanceValue, useAppearanceText } from '../appearanceFlags'
import LikeBurst from './LikeBurst'
import { useMotionCoverOff } from '../motionCoverPrefs'
import MixCovers from './MixCovers'
import MixingMark from './MixingMark'
import { useMusicVideo, useMusicVideoView } from '../musicVideo'
import { startCoverFlight } from '../coverFlight'
import { QueueContent } from './QueuePanel'
import LyricsFullscreen, { FULLSCREEN_SWITCH, FULLSCREEN_IN, FULLSCREEN_OUT } from './LyricsFullscreen'
import { api, wordSyncEnabled } from '../api'
import { useTranslation } from '../i18n'
import { contextLabel, isContextNavigable, navigateToContext } from '../playbackContext'
import { trackArtURL } from '../onlineTracks'
import FullCoverImage from './FullCoverImage'
import { isStationTrack } from '../radio/stations'
import ArtistNames from './ArtistNames'
import { useEcoMode } from '../ecoMode'
import { COVER_PERCENT, fullscreenCoverPercent, setFullscreenCoverPercent, useFullscreenCoverScale } from '../fullscreenCoverSize'
import { useFavoritesEnabled } from '../appearanceFlags'

// The cover's size (square), and the lyrics/queue panel's width beside it.
// The cover follows its size setting (fullscreenCoverSize), but never past
// the room it has: the screen's height under the header and over the title,
// and the column's width beside the panel.
const PANEL_WIDTH = 'min(52vw, 780px)'
const coverSize = (scale, panel) => `min(calc(min(34rem, 54vh) * ${scale}), calc(100vh - 17rem), calc(100vw - ${panel ? PANEL_WIDTH : '0px'} - 6rem))`
const canvasHeight = scale => `min(calc(min(38rem, 62vh) * ${scale}), calc(100vh - 16rem))`
// The widest the song's own video gets, shown whole (beside the panel when it's open).
const clipMaxWidth = panel => `calc(100vw - ${panel ? PANEL_WIDTH : '0px'} - 6rem)`

/** The small button over the card's top right: a slider for the card's size. */
function CoverSizeButton({ hidden }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const percent = fullscreenCoverPercent(useFullscreenCoverScale())
  const ref = useRef(null)
  useEffect(() => { if (hidden) setOpen(false) }, [hidden])
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title={t('Cover size')} aria-label={t('Cover size')} aria-expanded={open}
        className={`w-8 h-8 flex items-center justify-center rounded-full text-white/80 hover:text-white transition-opacity duration-200 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)] ${open ? 'opacity-100' : 'opacity-45 hover:opacity-100'}`}>
        <Scaling size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-60 rounded-xl border border-white/10 bg-black/85 px-3 py-2.5 backdrop-blur-md shadow-xl">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/60">
            <span>{t('Cover size')}</span>
            <span className="tabular-nums text-white">{percent}%</span>
          </div>
          <input type="range" min={COVER_PERCENT.min} max={COVER_PERCENT.max} step={COVER_PERCENT.step} value={percent}
            onChange={(e) => setFullscreenCoverPercent(e.target.value)}
            onDoubleClick={() => setFullscreenCoverPercent(COVER_PERCENT.initial)}
            title={t('Double-click to reset')}
            className="block w-full h-5 cursor-pointer accent-accent" />
        </div>
      )}
    </div>
  )
}
const FULLSCREEN_LYRICS_WAIT_MS = 1500 // lyrics found after this don't open the panel on their own
// The header and the cover's controls hide (and the cursor too) after this
// long without the mouse moving.
const IDLE_MS = 3000
// The clip on the whole screen: its controls go almost as soon as the mouse stops.
const CLIP_IDLE_MS = 1200

// Glass (backdrop-blur) has to fade by itself, never inside a parent that
// fades: while an ancestor's opacity is below 1, Chromium blurs that
// ancestor's (empty) layer instead of what's behind it, so the bubbles showed
// as flat grey discs during the fade, then snapped to clear glass at the end.
// So the cover's controls and the header fade piece by piece.
const COVER_FADE = 'transition-[opacity,color,background-color,border-color] duration-200 opacity-0 group-data-[shown=true]/controls:opacity-100 group-has-[:focus-visible]/controls:opacity-100'

/** A glassy bubble on the cover (like, playlist, queue, lyrics). */
function CoverButton({ onClick, label, active = false, children }) {
  // Small and see-through, so they cover little of the picture (a video too).
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={`relative w-9 h-9 flex items-center justify-center rounded-full border backdrop-blur-[2px] ${COVER_FADE} shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)] ${active ? 'border-white/25 bg-white/[0.12] text-white/90 hover:text-white' : 'border-white/[0.10] bg-white/[0.03] text-white/60 hover:bg-white/[0.12] hover:text-white'}`}>
      {children}
    </button>
  )
}

/** A bare control on the cover (play, skip...): just the icon, with a soft shadow. */
function CoverIcon({ onClick, label, pressed, dim = false, children }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={pressed}
      className={`flex items-center justify-center transition-[color,transform] hover:scale-105 active:scale-95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${dim ? 'text-white/60 hover:text-white' : 'text-white/90 hover:text-white'}`}>
      {children}
    </button>
  )
}

/** Volume as a slim glass pill up the cover's edge: drag (or click) along it. */
function VolumePill({ volume, onChange }) {
  const { t } = useTranslation()
  const ref = useRef(null)
  const setFrom = (clientY) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    onChange(Math.max(0, Math.min(1, (r.bottom - clientY) / r.height)))
  }
  const start = (event) => {
    event.preventDefault()
    setFrom(event.clientY)
    const move = e => setFrom(e.clientY)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const keys = (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); onChange(Math.min(1, volume + 0.05)) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); onChange(Math.max(0, volume - 0.05)) }
  }
  // The speaker sits inside the pill, at its foot: dark over the white fill,
  // light over the glass.
  const covered = volume > 0.12
  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label={t('Volume')} aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(volume * 100)} title={t('Volume {n}%', { n: Math.round(volume * 100) })}
      onPointerDown={start} onKeyDown={keys}
      className={`relative h-44 w-7 cursor-pointer overflow-hidden rounded-full border border-white/[0.14] bg-white/[0.06] backdrop-blur-[2px] drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)] outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${COVER_FADE}`}>
      <div className="absolute inset-x-0 bottom-0 bg-white/60" style={{ height: `${Math.round(volume * 100)}%` }} />
      <Volume2 size={13} className={`pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 ${covered ? 'text-black/55' : 'text-white/80'}`} />
    </div>
  )
}

function fmt(s) {
  if (!s || isNaN(s)) return '0:00'
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function SearchDrawer({ track, onClose, onSelect }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(track?.title || '')
  const [artist, setArtist] = useState(track?.artist || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const formatDuration = (d) => {
    if (!d) return '--:--'
    return Math.floor(d / 60) + ':' + String(Math.floor(d % 60)).padStart(2, '0')
  }

  const handleSearch = async () => {
    if (!title || !artist) return
    setLoading(true)
    setError(null)
    setResults([])

    try {
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
      const res = await fetch(url)
      const data = await res.json()
      if (Array.isArray(data)) {
        setResults(data)
      } else {
        setResults([])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResultClick = (result) => {
    const lyrics = result.syncedLyrics || result.plainLyrics
    const type = result.syncedLyrics ? 'lrc' : 'txt'
    onSelect(lyrics, type)
  }

  return (
    <motion.div
      initial={{ x: 420 }}
      animate={{ x: 0 }}
      exit={{ x: 420 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute top-0 right-0 h-full w-[420px] bg-black/95 backdrop-blur-xl border-l border-white/10 z-30 flex flex-col"
    >
      {/* The close button is sized/positioned to match the main fullscreen
          exit button exactly (top-5, w-9 h-9, same circle style) -- it used
          to be a small p-1 icon sitting inside a p-4 row, which put it a
          few pixels lower than the exit button it sits right below. */}
      <div className="relative flex items-center justify-center px-4 py-4 border-b border-white/10">
        <button onClick={onClose}
          className="absolute top-5 left-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
          <X size={15} />
        </button>
        <h3 className="text-sm font-medium text-white">{t('Search Lyrics')}</h3>
      </div>

      <div className="p-4 space-y-3 border-b border-white/10">
        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">{t('Title')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Track title')}
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">{t('Artist')}</label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t('Artist name')}
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={!title || !artist || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent text-base rounded-lg text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? t('Searching...') : <><Search size={14} /> {t('Search')}</>}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {results.length === 0 && !loading && !error && (
          <p className="text-xs text-white/30 text-center py-8">{t('Enter title and artist to search')}</p>
        )}
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => handleResultClick(r)}
            className="w-full p-3 text-left hover:bg-white/5 rounded-lg transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{r.trackName}</p>
                <p className="text-xs text-white/50 truncate">{r.artistName}</p>
                {r.albumName && <p className="text-xs text-white/30 truncate">{r.albumName}</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-white/40">{formatDuration(r.duration)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.syncedLyrics ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                  {r.syncedLyrics ? t('Synced') : t('Unsynced')}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

export default function FullscreenPlayer() {
  const { t } = useTranslation()
  const {
    showFullscreen, toggleFullscreen, currentTrack, isPlaying,
    progress, duration, volume, shuffle, repeat,
    showLyricsFullscreen, toggleLyricsFullscreen, switchFullscreenView,
    togglePlay, next, prev, setProgress, toggleShuffle, toggleRepeat,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    playbackContext, setVolume,
  } = usePlayerStore(useShallow(({
    showFullscreen, toggleFullscreen, currentTrack, isPlaying,
    progress, duration, volume, shuffle, repeat,
    showLyricsFullscreen, toggleLyricsFullscreen, switchFullscreenView,
    togglePlay, next, prev, setProgress, toggleShuffle, toggleRepeat,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    playbackContext, setVolume,
  }) => ({
    showFullscreen, toggleFullscreen, currentTrack, isPlaying,
    progress, duration, volume, shuffle, repeat,
    showLyricsFullscreen, toggleLyricsFullscreen, switchFullscreenView,
    togglePlay, next, prev, setProgress, toggleShuffle, toggleRepeat,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    playbackContext, setVolume,
  })))
  const { user, openAddToPlaylist } = useAppStore()
  const nav = useNavigate()
  const wordSync = wordSyncEnabled()
  const [likeAnim, setLikeAnim] = useState(false)
  const [burst, setBurst] = useState(null)
  const likeBusy = useRef(false)
  const burstTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(burstTimer.current), [])
  const [bgLoaded, setBgLoaded] = useState(false)
  const backdropFx = useArtworkBackdropEnabled()
  const eco = useEcoMode()
  const [fsCanvas, setFsCanvas] = useState(false)
  // Turned off for this song from the side panel.
  const [coverOff, setCoverOff] = useMotionCoverOff(currentTrack)
  // Whether the song has a Canvas / moving cover (asked even while it's
  // turned off, so its button stays to turn it back on).
  const [coverClip, setCoverClip] = useState({ id: null, clip: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id || !(showFullscreen || showLyricsFullscreen) || eco) return undefined
    let current = true
    loadMotionCover(id).then(clip => { if (current) setCoverClip({ id, clip: clip?.src ? clip : null }) })
    return () => { current = false }
  }, [currentTrack?.id, showFullscreen, showLyricsFullscreen, eco])
  // The song's own video (Edit Track) plays in the card ahead of its Canvas /
  // moving cover, following the song's seeks (see ClipLoop).
  const { loop: songClip, loopKey: songClipKey, fail: failSongClip } = useTrackClip(currentTrack)
  // The song's own video in the cover card: in the square (cropped), or whole
  // in its own shape (Settings: fullscreen_clip_fit, square | original). Its
  // shape is known once it's loaded.
  const clipShown = !!songClip && !coverOff
  const clipUrl = songClip ? clipOpenUrl(songClip.link) : null
  const clipOriginal = useAppearanceText('fullscreen_clip_fit', 'square') === 'original'
  const [clipShape, setClipShape] = useState(null) // { key, ratio }
  const clipRatio = clipShown && clipShape?.key === songClipKey ? clipShape.ratio : null
  const toggleClipFit = () => {
    const value = clipOriginal ? 'square' : 'original'
    previewAppearanceValue('fullscreen_clip_fit', value)
    Promise.resolve(api.saveSettings({ fullscreen_clip_fit: value })).catch(() => {})
  }
  const clipNow = !songClip && coverClip.id === currentTrack?.id ? coverClip.clip : null
  const { video: musicVideo } = useMusicVideo(currentTrack, showFullscreen || showLyricsFullscreen)
  const showMusicVideo = useMusicVideoView(s => s.show)
  // The switch over the card: the song's video / Canvas / moving cover, or the still cover.
  const motionLabel = songClip ? t('Music video')
    : clipNow ? ({ spotify: 'Spotify Canvas', apple: 'Apple Music', tidal: 'Tidal' }[clipNow.source] || t('Moving cover'))
    : null
  const [settings, setSettings] = useState({})
  const [showSearch, setShowSearch] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // Which side panel is open, driven purely by the two buttons below -- not
  // by whether the current track actually has lyrics. It used to require
  // hasLyrics to become true before the panel would show at all, so on a
  // track with no lyrics the Lyrics button looked completely broken (LyricsPanel
  // never even got a chance to render its own "no lyrics found" + search
  // state, exactly like it already does in windowed mode).
  const [fullscreenPanel, setFullscreenPanel] = useState('none')
  const prevTrackId = useRef(null)
  // Full-screen lyrics is this same overlay in another layout (see
  // LyricsFullscreen): it's open when either view is, and the player's own
  // controls step aside while lyrics shows.
  const open = showFullscreen || showLyricsFullscreen
  const lyricsMode = showLyricsFullscreen
  // Reduced motion: the views just crossfade (the cover doesn't fly).
  const reduceMotion = useReducedMotion()
  const playerLayerRef = useRef(null)
  const coverRef = useRef(null)
  useEffect(() => {
    if (playerLayerRef.current) playerLayerRef.current.inert = lyricsMode
  }, [lyricsMode, open])
  // The cover flies between the player and the full-screen lyrics header (see
  // coverFlight): a copy of it moves while the real ones stay hidden until it
  // lands. With a canvas playing, the copy keeps playing it and turns into
  // the cover on the way (the header shows the cover), without stretching
  // from the card's 9:16 into the square. Both views are always laid out
  // (just faded), so both ends can be measured right away.
  const flightRef = useRef(null)
  const prevModeRef = useRef(null)
  useLayoutEffect(() => {
    const was = prevModeRef.current
    prevModeRef.current = open ? lyricsMode : null
    if (!open || was === null || was === lyricsMode || reduceMotion) return
    flightRef.current?.()
    const overlay = document.querySelector('[data-fullscreen-player-overlay]')
    const big = coverRef.current
    const thumb = overlay?.querySelector('[data-fullscreen-thumb]')
    const art = trackArtURL(usePlayerStore.getState().currentTrack)
    if (!overlay || !big || !thumb || !art) return
    const card = big.getBoundingClientRect()
    const small = thumb.getBoundingClientRect()
    if (!card.width || !small.width) return
    // The canvas, if one is showing in the card (MotionCover fades it in once playing).
    const video = [...big.querySelectorAll('video')].find(v => v.readyState >= 2 && v.style.opacity !== '0') || null
    const flight = startCoverFlight({
      parent: overlay,
      from: lyricsMode ? card : small,
      to: lyricsMode ? small : card,
      art,
      video,
      card: { width: card.width, height: card.height },
      toLyrics: lyricsMode,
      radius: lyricsMode ? [16, 8] : [8, 16],
      timing: { duration: FULLSCREEN_SWITCH.duration * 1000 + 60, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    })
    big.style.visibility = 'hidden'
    thumb.style.visibility = 'hidden'
    const land = () => {
      if (flightRef.current !== land) return
      flightRef.current = null
      big.style.visibility = ''
      thumb.style.visibility = ''
      flight.cancel()
    }
    flightRef.current = land
    flight.finished.then(land, land)
  }, [lyricsMode, open, reduceMotion])
  useEffect(() => () => flightRef.current?.(), [])
  // The panel container fades/collapses out over 500ms after fullscreenPanel
  // goes back to 'none' (see isPanelVisible below), but the ternary that picks
  // Queue vs. Lyrics content only matched 'queue' -- everything else, 'none'
  // included, fell through to the Lyrics branch. That swapped the panel's
  // contents to Lyrics the instant Queue was closed, so users saw a flash of
  // the Lyrics header/panel during the queue's own closing animation. Tracking
  // the last non-'none' panel keeps showing that panel's content while it
  // fades out, instead of switching to whatever the fallback branch was.
  const lastPanelRef = useRef('lyrics')
  useEffect(() => {
    if (fullscreenPanel !== 'none') lastPanelRef.current = fullscreenPanel
  }, [fullscreenPanel])

  // FullscreenPlayer stays mounted for the whole app session (App.jsx renders
  // it unconditionally and it just hides its own JSX), so a settings fetch
  // tied to mount only ever ran once at startup -- toggling and saving
  // Unsynced Lyrics Auto-Sync later in Settings never updated this component,
  // and lyrics kept using whatever value was cached at launch. Re-fetching
  // whenever the overlay actually opens picks up the current saved value.
  useEffect(() => {
    if (!showFullscreen) return
    api.getSettings().then(s => setSettings(s || {}))
  }, [showFullscreen])

  // Leaving fullscreen only fades the *outer* overlay out over its own
  // 300ms AnimatePresence exit. Confirmed live (Windows, DevTools attached
  // to a real build) that this exit can get stuck indefinitely: the whole
  // overlay -- side panel and all its buttons included -- stays mounted,
  // faded to opacity 0 but with computed pointer-events still "auto",
  // sitting at z-50 over the entire window and intercepting every click
  // anywhere in the app until the process is restarted. Repeatedly
  // switching Queue<->Lyrics right before closing (which tears down and
  // remounts the heavy LyricsPanel -- rAF word-sync ticking, springs,
  // selection/scroll listeners) right as the outer AnimatePresence exit
  // starts made this reliable to reproduce, but the stuck exit itself is
  // the bug; that's just what triggers it.
  //
  // Two things that look like fixes for this do NOT work, confirmed live:
  //  1. A `style={{ pointerEvents: showFullscreen ? 'auto' : 'none' }}`
  //     ternary on the overlay. It's dead code: that JSX only ever gets
  //     (re-)created while `showFullscreen && (...)` is true, so the
  //     'none' branch can never be reached at creation time. Once
  //     showFullscreen flips false, this component stops including the
  //     motion.div in its own return value at all -- AnimatePresence
  //     keeps animating out a snapshot of the *last* element it was
  //     given, frozen with whatever props/classes it had at that moment.
  //  2. Resetting fullscreenPanel/showSearch React state (still done
  //     below, for its own sake -- it's what makes reopening fullscreen
  //     start from a clean panel-closed state). It runs fine, but can't
  //     reach the frozen snapshot either, for the same reason: by the
  //     time this component re-renders with the new state, showFullscreen
  //     is already false, so it again contributes nothing for that slot.
  //
  // The only thing that actually worked, verified live: reaching the real
  // DOM node directly, outside React, and hiding it. pointer-events alone
  // isn't enough either -- the "Go to {context}" link a little further
  // down explicitly opts back in with its own pointer-events-auto (by
  // design, for while fullscreen is genuinely open), which would stay
  // clickable through an ancestor's pointer-events: none. visibility is
  // not overridden anywhere in this file, so visibility: hidden reliably
  // takes every descendant out of hit-testing regardless of what pointer-
  // events they set. This queries the DOM instead of using a single ref
  // because if this happens more than once without a previous exit ever
  // completing, more than one stuck copy can accumulate; a ref would only
  // ever reach the most recently mounted one. data-fullscreen-player-
  // overlay is a marker unique to this component -- Modal.jsx,
  // AlbumsModal.jsx and LyricsFullscreen.jsx all reuse the same "fixed
  // inset-0 z-50" classes, so matching on those instead risked hiding an
  // unrelated, legitimately open overlay.
  useEffect(() => {
    if (open) {
      // Reopening before the exit animation finishes can make Framer Motion
      // reuse the same overlay DOM node, and React doesn't manage the inline
      // visibility set below -- clear it or the player reopens invisible.
      document.querySelectorAll('[data-fullscreen-player-overlay]').forEach((el) => {
        el.style.removeProperty('visibility')
      })
      return
    }
    setFullscreenPanel('none')
    setShowSearch(false)
    document.querySelectorAll('[data-fullscreen-player-overlay]').forEach((el) => {
      el.style.setProperty('visibility', 'hidden')
    })
  }, [open])

  // Opened for a song with lyrics found: the lyrics at the side of the cover
  // (the Lyrics button's panel); for one without: the cover, centred. Lyrics
  // not looked up yet are asked for, and found within a moment they open the
  // panel; later, or none, the cover stays (a view changing under someone
  // already looking at it is worse than a cover). Only on opening, and only
  // while the panel is still closed: picking a panel meanwhile wins.
  const wasShowingRef = useRef(false)
  useLayoutEffect(() => {
    const opened = showFullscreen && !wasShowingRef.current
    wasShowingRef.current = showFullscreen
    if (!opened || !currentTrack) return undefined
    const track = currentTrack
    const showLyrics = () => setFullscreenPanel(panel => (panel === 'none' ? 'lyrics' : panel))
    const cached = peekLyrics(track.id)
    if (hasLyricLines(cached)) { showLyrics(); return undefined }
    if (cached !== undefined) return undefined
    let cancelled = false
    const asked = Date.now()
    Promise.resolve(api.getLyrics(track.id, track.title, track.artist, track.album, track.duration, track.file_path)).then(result => {
      const found = result && (result.lines?.length || result.instrumental) ? result : null
      cacheLyrics(track.id, found)
      if (cancelled || !hasLyricLines(found) || Date.now() - asked > FULLSCREEN_LYRICS_WAIT_MS) return
      if (usePlayerStore.getState().currentTrack?.id === track.id) showLyrics()
    }).catch(() => {})
    return () => { cancelled = true }
  }, [showFullscreen]) // eslint-disable-line react-hooks/exhaustive-deps

  const canOpenContext = isContextNavigable(playbackContext)
  const openContext = () => {
    if (!canOpenContext) return
    // Leave fullscreen first, otherwise the overlay hides the page we land on.
    toggleFullscreen()
    navigateToContext(nav, playbackContext, currentTrack?.id)
  }

  useEffect(() => {
    // LyricsFullscreen renders on top of this overlay when both are open
    // (see the Expand Lyrics button below), so while it's showing, Escape
    // should close *that* first instead of also tearing down this whole
    // fullscreen view underneath it.
    const h = (e) => {
      if (e.key !== 'Escape') return
      // In the whole-screen mode, Escape leaves that first (the player stays).
      if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return }
      toggleFullscreen()
    }
    if (showFullscreen && !showLyricsFullscreen) document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [showFullscreen, showLyricsFullscreen])

  useEffect(() => {
    if (currentTrack?.id !== prevTrackId.current) {
      setBgLoaded(false)
      prevTrackId.current = currentTrack?.id
    }
  }, [currentTrack?.id])

  const artSrc = trackArtURL(currentTrack)

  const isLiked = currentTrack && likedIds.has(currentTrack.id)
  const favorites = useFavoritesEnabled()
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat


  const toggleLike = async () => {
    if (!currentTrack || likeBusy.current) return
    likeBusy.current = true
    try {
      const r = await api.toggleLike(currentTrack.id, user?.id, currentTrack)
      const liked = typeof r === 'boolean' ? r : r?.liked ?? false
      setLiked(currentTrack.id, liked)
      if (liked && !reduceMotion) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 700) }
    } finally {
      likeBusy.current = false
    }
  }

  // Double-clicking the cover itself (not a button or the volume pill on it)
  // likes the song; doing it again un-likes it. One at a time, so a quick triple
  // click can't get the heart and the server out of step.
  const doubleClickLike = async (event) => {
    if (!currentTrack || likeBusy.current || !favorites) return
    if (event.target.closest?.('button, a, input, [role="slider"]')) return
    window.clearTimeout(burstTimer.current)
    setBurst({ id: Date.now(), trackId: currentTrack.id, kind: isLiked ? 'unlike' : 'like' })
    burstTimer.current = window.setTimeout(() => setBurst(null), 1200)
    try {
      await toggleLike()
    } catch {
      setBurst(null)
    }
  }

  const handleLyricsSelect = (lyrics, type) => {
    if (!currentTrack) return
    api.importLyrics(currentTrack.id, lyrics, type)
    setRefreshKey(k => k + 1)
    setShowSearch(false)
  }

  // Idle: after a few seconds without the mouse moving, the header and the
  // cover's controls fade out and the cursor hides; any movement brings them
  // back. Not while the pointer rests on the header or the lyrics search is open.
  // The lyrics layout (LyricsFullscreen) hides its own the same way.
  const [idle, setIdle] = useState(false)
  const overChromeRef = useRef(false)
  // The song's own video on the whole screen (the monitor's, the app with it):
  // only the video, its controls showing while the mouse moves.
  const [clipFull, setClipFull] = useState(false)
  useEffect(() => {
    if (!showFullscreen) { setIdle(false); return undefined }
    let timer = null
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => { if (!overChromeRef.current || clipFull) setIdle(true) }, clipFull ? CLIP_IDLE_MS : IDLE_MS)
    }
    wake()
    const events = ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart']
    events.forEach(type => window.addEventListener(type, wake, { passive: true }))
    return () => { clearTimeout(timer); events.forEach(type => window.removeEventListener(type, wake)) }
  }, [showFullscreen, clipFull])
  const chromeHidden = idle && !showSearch
  const setOverChrome = useCallback((over) => { overChromeRef.current = over }, [])
  // Each piece of the header fades by itself (glass inside a fading parent flashes grey; see COVER_FADE).
  const chromeFade = `transition-[opacity,color,background-color] duration-300 ${chromeHidden ? 'opacity-0' : 'opacity-100'}`
  const [coverHover, setCoverHover] = useState(false)
  // The card's own buttons over it (clip / cover, size) show while the mouse
  // is anywhere on the left: the card, them, the title.
  const [sideHover, setSideHover] = useState(false)
  const coverScale = useFullscreenCoverScale()
  const controlsShown = coverHover && !chromeHidden
  // The lyrics' buttons in the header's left block (full-screen lyrics,
  // Translate, the source, search) only show while the mouse is near them --
  // or while the source menu is open. Native listeners: the lyrics' own
  // buttons are portaled in, so React's enter/leave wouldn't count them.
  const [toolsEl, setToolsEl] = useState(null)
  const [lyricsBarEl, setLyricsBarEl] = useState(null)
  const [toolsHover, setToolsHover] = useState(false)
  const [toolsMenu, setToolsMenu] = useState(false)
  useEffect(() => {
    if (!toolsEl) return undefined
    const enter = () => setToolsHover(true)
    const leave = () => setToolsHover(false)
    const blur = (e) => { if (!toolsEl.contains(e.relatedTarget)) setToolsHover(false) }
    toolsEl.addEventListener('pointerenter', enter)
    toolsEl.addEventListener('pointerleave', leave)
    toolsEl.addEventListener('focusin', enter)
    toolsEl.addEventListener('focusout', blur)
    return () => {
      toolsEl.removeEventListener('pointerenter', enter)
      toolsEl.removeEventListener('pointerleave', leave)
      toolsEl.removeEventListener('focusin', enter)
      toolsEl.removeEventListener('focusout', blur)
    }
  }, [toolsEl])
  useEffect(() => { if (!open) { setToolsHover(false); setToolsMenu(false) } }, [open])
  const toolsShown = !chromeHidden && (toolsHover || toolsMenu)
  const toolsFade = `transition-[opacity,color,background-color] duration-300 ${toolsShown ? 'opacity-100' : 'opacity-0'}`

  // The whole screen (the OS's full screen), on top of this view; left when
  // the view closes.
  const [screenFull, setScreenFull] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const onChange = () => setScreenFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleScreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }
  useEffect(() => {
    if (!open && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    if (!open) setClipFull(false)
  }, [open])
  const enterClipFull = () => {
    setClipFull(true)
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const exitClipFull = () => {
    setClipFull(false)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }
  // Left the whole screen some other way (Escape), or the video went (another
  // song without one, the cover picked instead): back to the card.
  useEffect(() => { if (clipFull && !screenFull) setClipFull(false) }, [screenFull]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (clipFull && !clipShown) exitClipFull() }, [clipShown]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seeking: click or drag along a bar (the one under the card, or the
  // video's own on the whole screen).
  const seekTo = (clientX, bar) => {
    const { duration: length } = usePlayerStore.getState()
    if (!bar || !length) return
    const r = bar.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * length
    // Through the store: it seeks the playing element, or the TV while casting.
    usePlayerStore.getState().setProgressWithAudioUpdate(t)
  }
  const startScrub = (event) => {
    event.preventDefault()
    const bar = event.currentTarget
    seekTo(event.clientX, bar)
    const move = e => seekTo(e.clientX, bar)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // On unless switched off (Settings > Lyrics > Time Plain Lyrics).
  const isAutoSynced = settings.unsynced_auto_sync !== '0'
  const isPanelVisible = currentTrack && fullscreenPanel !== 'none'
  // The whole video's width; the seek bar and the names under the card follow it.
  const clipWide = clipOriginal && !!clipRatio && !fsCanvas
  const clipWidth = clipRatio ? `min(calc(${canvasHeight(coverScale)} * ${clipRatio}), ${clipMaxWidth(isPanelVisible)})` : null
  const belowWidth = clipWide ? clipWidth : coverSize(coverScale, isPanelVisible)
  // The two layout-affecting transitions below (main content re-centering,
  // panel width collapsing) only need to animate while this view is
  // actually staying open -- while it's closing, the whole overlay is
  // already fading to invisible over its own 300ms exit transition, so
  // nobody sees these settle anyway. Snapping them instantly on close
  // avoids running three overlapping layout/paint transitions (this pair
  // plus the overlay's own fade) at the exact moment a wide subtree
  // (Queue/Lyrics) unmounts, which on Windows has been enough to leave the
  // frameless window's native hit-test map stale -- see toggleFullscreen
  // in store/player.js and window:refreshHitRegions in electron/main.js.

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          // Idle, the cursor hides everywhere, the seek bar and other clickable bits included.
          className={`fixed inset-0 z-50 flex overflow-hidden ${chromeHidden && !lyricsMode ? 'cursor-none [&_*]:!cursor-none' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' }}
          // Marks this exact DOM node so the useEffect above can reach and
          // hide it (and any stuck earlier copies) directly if its exit
          // animation never completes -- see that effect's comment.
          data-fullscreen-player-overlay=""
        >
          {/* The video on the whole screen covers all of it: not drawn then
              (its blur, the lyrics' animation), so every video frame
              composites only the video and its controls. */}
          <div className={`absolute inset-0 bg-black ${clipFull ? 'invisible' : ''}`}>
            {/* Colours taken from the cover (see ArtworkBackdrop), or -- with
                that switched off in Settings -- the plain blurred cover. */}
            {/* Eco mode: just the dark background, no blurred cover either. */}
            {eco ? null : backdropFx ? (
              <ArtworkBackdrop trackId={meshKeyFor(currentTrack)} blur={64} />
            ) : (
              <AnimatePresence mode="wait">
                {artSrc ? (
                  <motion.img
                    key={currentTrack?.id}
                    src={artSrc}
                    onLoad={() => setBgLoaded(true)}
                    initial={{ opacity: 0, scale: 1.15 }}
                    animate={{ opacity: bgLoaded ? 0.45 : 0, scale: 1.08 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8 }}
                    className="w-full h-full object-cover"
                    style={{ filter: 'blur(72px) saturate(1.6) brightness(0.5)' }}
                  />
                ) : (
                  <motion.div
                    key="no-art"
                    className="w-full h-full bg-gradient-to-br from-neutral-900 to-black"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  />
                )}
              </AnimatePresence>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/30" />
            {/* Lyrics read over a darker backdrop: the same one, dimmed. */}
            <motion.div className="absolute inset-0 bg-black" initial={false}
              animate={{ opacity: lyricsMode ? 0.35 : 0 }} transition={FULLSCREEN_SWITCH} />
          </div>

          {/* The player's own controls, which step aside for full-screen
              lyrics (and come back when it closes) instead of a second
              overlay sliding over them. Faded out, they stay drawn (opacity
              0, not visibility: hidden, which would drop what's drawn and
              make coming back redraw all of it on the switch's first frame). */}
          <motion.div ref={playerLayerRef} className="absolute inset-0 flex"
            initial={false}
            animate={{ opacity: lyricsMode ? 0 : 1 }}
            transition={lyricsMode ? FULLSCREEN_OUT : FULLSCREEN_IN}
            style={{ pointerEvents: lyricsMode ? 'none' : undefined }}>

          {/* The header: lyrics view, what's playing from, full screen, close.
              It fades out (and the cursor hides) after a few seconds without
              the mouse moving, and comes back as soon as it moves. */}
          <div className={`absolute inset-x-0 top-0 z-20 grid grid-cols-[1fr_minmax(0,2fr)_1fr] items-start gap-4 px-5 pt-5 ${chromeHidden ? 'pointer-events-none' : ''} ${clipFull ? 'invisible' : ''}`}
            onMouseEnter={() => { overChromeRef.current = true }} onMouseLeave={() => { overChromeRef.current = false }}>
            <div />
            {playbackContext?.name && (
              <div className={`col-start-2 min-w-0 text-center ${chromeFade}`}>
                <p className="text-[10px] font-display uppercase tracking-[0.28em] text-white/45">
                  {contextLabel(playbackContext)}
                </p>
                {canOpenContext ? (
                  <button
                    onClick={openContext}
                    title={t('Go to {name}', { name: playbackContext.name })}
                    className="mt-1 max-w-full truncate text-sm font-medium text-white/85 hover:text-white hover:underline transition-colors">
                    {playbackContext.name}
                  </button>
                ) : (
                  <p className="mt-1 truncate text-sm font-medium text-white/85">{playbackContext.name}</p>
                )}
              </div>
            )}
            <div className="relative col-start-3 justify-self-end pointer-events-auto flex items-center gap-2">
              {/* The lyrics' buttons: straight to full-screen lyrics (the view to
                  come back from has a Player button), then the lyrics panel's own
                  (Translate, the source...; portaled in by LyricsPanel), then
                  search. Left of full screen and close, and unseen until the mouse
                  comes near (the block reaches a little past them to catch it). */}
              <div ref={setToolsEl} className="absolute right-full top-0 -my-4 -ml-4 py-4 pl-4 pr-2 flex items-center gap-2 whitespace-nowrap">
                {currentTrack && (
                  <button onClick={() => switchFullscreenView('lyrics')} title={t('Switch to full-screen lyrics')}
                    className={`h-9 px-3.5 flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white/80 hover:text-white backdrop-blur-sm ${toolsFade}`}>
                    <Maximize2 size={13} /> {t('Lyrics')}
                  </button>
                )}
                <div ref={setLyricsBarEl} className="contents" />
                {currentTrack && fullscreenPanel === 'lyrics' && (
                  <button onClick={() => setShowSearch(true)} title={t('Search lyrics')} aria-label={t('Search lyrics')}
                    className={`w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white backdrop-blur-sm ${toolsFade}`}>
                    <Search size={14} />
                  </button>
                )}
              </div>
              <button onClick={toggleScreen} title={screenFull ? t('Exit full screen') : t('Fill the whole screen')} aria-label={screenFull ? t('Exit full screen') : t('Fill the whole screen')}
                className={`w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm`}>
                {screenFull ? <Minimize size={15} /> : <Expand size={15} />}
              </button>
              <button onClick={toggleFullscreen} title={t('Close')} aria-label={t('Close full-screen player')}
                className={`w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm`}>
                <X size={15} />
              </button>
            </div>
          </div>

          {/* The cover, with the controls over it (shown while the pointer is
              on it), then the progress, the title and the artist. Clear of
              the header, so a tall canvas doesn't run into "Playing from". */}
          {/* Above the header and the panel while the video fills the whole screen. */}
          <div className={`relative ${clipFull ? 'z-30' : 'z-10'} flex flex-col items-center justify-center flex-1 min-w-0 px-12 pt-24 pb-12 ${showFullscreen ? 'transition-all duration-500' : ''}`}
            onMouseEnter={() => setSideHover(true)} onMouseLeave={() => setSideHover(false)}>
            {/* One card for every song (never swapped, so never waiting on an
                exit while the window is minimized): the artwork changes inside
                it (MixCovers: AutoMix's cloudy dissolve, else a short fade). */}
            <div className="relative flex-shrink-0">
              {/* Over the card: its video (the song's clip, Canvas or moving
                  cover) or the still cover, for this song, in the middle; the
                  card's size at its right corner. */}
              {currentTrack && (
                <div className={`absolute bottom-full inset-x-0 mb-3 flex items-center justify-center transition-opacity duration-300 ${sideHover && !chromeHidden ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  {motionLabel && (
                    <div className="flex items-center gap-2">
                      {[
                        { off: false, label: motionLabel, Icon: songClip ? Clapperboard : Film },
                        { off: true, label: t('Artwork'), Icon: ImageIcon },
                      ].map(({ off, label, Icon }) => {
                        const current = coverOff === off
                        return (
                          <button key={label} onClick={() => setCoverOff(off)} aria-pressed={current}
                            className={`h-8 px-3 flex items-center gap-1.5 rounded-full border text-xs font-medium transition-[opacity,border-color,color] duration-200 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)] ${current ? 'border-white/90 text-white opacity-70 hover:opacity-100' : 'border-transparent text-white/80 opacity-45 hover:opacity-100 hover:text-white'}`}>
                            <Icon size={13} /> {label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="absolute right-0 bottom-0">
                    <CoverSizeButton hidden={!sideHover || chromeHidden} />
                  </div>
                </div>
              )}
              <motion.div
                ref={coverRef}
                initial={{ opacity: 0, scale: 0.92, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 26 }}
                onMouseEnter={() => setCoverHover(true)}
                onMouseLeave={() => setCoverHover(false)}
                onDoubleClick={doubleClickLike}
                className={clipFull
                  ? 'group/cover fixed inset-0 z-40 select-none overflow-hidden bg-black flex items-center justify-center'
                  : 'group/cover relative select-none rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.8)] border border-white/10 flex-shrink-0 bg-white/5 flex items-center justify-center'}
                // A tall (9:16) canvas plays in the card itself, which grows to
                // its shape. (It used to fill the whole screen behind the
                // lyrics panel, whose blur then had to be redone every video
                // frame -- slow, especially while the panel slid open.)
                style={clipFull
                  ? { width: '100vw', height: '100vh' }
                  : fsCanvas
                  ? { height: canvasHeight(coverScale), aspectRatio: '9 / 16', transition: 'height 420ms ease' }
                  : clipOriginal && clipRatio
                    // The whole video in its own shape, as big as it fits: as
                    // tall as a tall canvas may be, as wide as the cover's side
                    // of the screen allows.
                    ? {
                        width: clipWidth,
                        aspectRatio: String(clipRatio),
                        transition: 'width 420ms ease',
                      }
                    : { width: coverSize(coverScale, isPanelVisible), height: coverSize(coverScale, isPanelVisible), transition: 'width 420ms ease, height 420ms ease' }}
              >
                {artSrc
                  ? <MixCovers track={currentTrack} render={(track, { top }) => (
                      <>
                        {!clipFull && <FullCoverImage track={track} enabled={open} className="absolute inset-0 w-full h-full object-cover" alt="" />}
                        {songClip && String(track?.id) === String(currentTrack?.id) ? (
                          !coverOff && <ClipLoop key={songClipKey} trackId={track.id} link={songClip.link} start={songClip.start} end={songClip.end} zoom={songClip.zoom} onFail={failSongClip} onRatio={ratio => setClipShape({ key: songClipKey, ratio })} fit={clipFull ? 'contain' : 'cover'} />
                        ) : (
                          <>
                            <MotionCover trackId={track?.id} only="square" off={coverOff} />
                            <MotionCover trackId={track?.id} only="tall" onActive={top ? setFsCanvas : undefined} off={coverOff} />
                          </>
                        )}
                      </>
                    )} />
                  : <span className="text-white/10 text-7xl">♪</span>
                }

                {currentTrack && (
                  // Over the video on the whole screen, no glass: a blur behind
                  // a button is redone for every video frame.
                  <div data-shown={controlsShown} className={`group/controls absolute inset-0 z-10 flex flex-col justify-between ${clipFull ? '[&_*]:![backdrop-filter:none]' : ''}`}>
                    <div className={`absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40 pointer-events-none ${COVER_FADE}`} />
                    <div className="relative flex items-center justify-center gap-3 pt-5">
                      {favorites && <CoverButton onClick={toggleLike} label={isLiked ? t('Remove from Liked Songs') : t('Add to Liked Songs')} active={isLiked}>
                        <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
                        <AnimatePresence>
                          {likeAnim && (
                            <motion.span initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 2.5, opacity: 0 }} exit={{}}
                              transition={{ duration: 0.5 }} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <Heart size={16} className="text-accent" fill="currentColor" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </CoverButton>}
                      <CoverButton onClick={() => openAddToPlaylist(currentTrack)} label={t('Add to a playlist')}><ListPlus size={16} /></CoverButton>
                      {!clipFull && <>
                      <CoverButton onClick={() => setFullscreenPanel(p => p === 'queue' ? 'none' : 'queue')} label={fullscreenPanel === 'queue' ? t('Hide the queue') : t('Show the queue')} active={fullscreenPanel === 'queue'}><ListMusic size={16} /></CoverButton>
                      <CoverButton onClick={() => setFullscreenPanel(p => p === 'lyrics' ? 'none' : 'lyrics')} label={fullscreenPanel === 'lyrics' ? t('Hide the lyrics') : t('Show the lyrics')} active={fullscreenPanel === 'lyrics'}><Mic2 size={16} /></CoverButton>
                      </>}
                      {/* The song's own video showing: open it in the browser, and fit it in the square or show it whole. */}
                      {clipShown && clipUrl && <CoverButton onClick={() => openLink(clipUrl)} label={t('Open the video in the browser')}><SquareArrowOutUpRight size={16} /></CoverButton>}
                      {clipShown && !clipFull && (
                        <CoverButton onClick={toggleClipFit} label={clipOriginal ? t('Fit the video in the square') : t('Show the whole video, in its own shape')}>
                          {clipOriginal ? <Square size={16} /> : <RectangleHorizontal size={16} />}
                        </CoverButton>
                      )}
                    </div>
                    {/* On the whole screen, at the bottom, right over the seek bar. */}
                    <div className={`relative flex items-center justify-center gap-8 ${clipFull ? 'mt-auto pb-3' : 'pb-7'} ${COVER_FADE}`}>
                      <CoverIcon onClick={toggleShuffle} label={t('Shuffle')} pressed={shuffle} dim={!shuffle}>
                        <Shuffle size={22} className={shuffle ? 'text-accent' : ''} />
                      </CoverIcon>
                      <CoverIcon onClick={prev} label={t('Previous')}>
                        <SkipBack size={32} fill="currentColor" />
                      </CoverIcon>
                      <CoverIcon onClick={togglePlay} label={isPlaying ? t('Pause') : t('Play')}>
                        {isPlaying ? <Pause size={44} fill="currentColor" strokeWidth={0} /> : <Play size={44} fill="currentColor" strokeWidth={0} className="translate-x-0.5" />}
                      </CoverIcon>
                      <CoverIcon onClick={() => next(false)} label={t('Next')}>
                        <SkipForward size={32} fill="currentColor" />
                      </CoverIcon>
                      <CoverIcon onClick={toggleRepeat} label={t('Repeat')} pressed={repeat !== 'none'} dim={repeat === 'none'}>
                        <RepeatIcon size={22} className={repeat !== 'none' ? 'text-accent' : ''} />
                      </CoverIcon>
                      {/* The video on the whole screen: level with play, right
                          under the volume (as wide as it); back from it, at the
                          end of the seek bar. */}
                      {clipShown && !clipFull && (
                        <div className="absolute right-4 top-0 bottom-7 flex w-7 items-center justify-center">
                          <CoverButton onClick={enterClipFull} label={t('Video on the whole screen')}><Expand size={16} /></CoverButton>
                        </div>
                      )}
                    </div>
                    {/* The video on the whole screen: its own seek bar, with the controls. */}
                    {clipFull && (
                      <div className={`relative flex items-center gap-3 px-8 pb-6 ${COVER_FADE}`}>
                        <span className="w-11 text-right text-sm tabular-nums text-white/75">{fmt(progress)}</span>
                        <div className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/25 drop-shadow-[0_1px_4px_rgba(0,0,0,0.35)] before:absolute before:-inset-y-2 before:inset-x-0"
                          onPointerDown={startScrub} role="slider" aria-label={t('Position')} aria-valuemin={0} aria-valuemax={Math.round(duration || 0)} aria-valuenow={Math.round(progress || 0)}>
                          <div className="absolute inset-y-0 left-0 rounded-full bg-white/90" style={{ width: `${duration ? Math.min(100, (progress / duration) * 100) : 0}%` }} />
                        </div>
                        <span className="w-11 text-sm tabular-nums text-white/75">{isStationTrack(currentTrack) && !duration ? t('On air') : fmt(duration)}</span>
                        <CoverButton onClick={exitClipFull} label={t('Exit full screen')}><Minimize size={16} /></CoverButton>
                      </div>
                    )}
                    {/* The music video, mid left edge (opposite the volume). */}
                    {musicVideo && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        <CoverButton onClick={showMusicVideo} label={t('Play the music video')}><Clapperboard size={16} /></CoverButton>
                      </div>
                    )}
                    {/* Volume, up the right edge. */}
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <VolumePill volume={volume} onChange={setVolume} />
                    </div>
                  </div>
                )}
                {burst && burst.trackId === currentTrack?.id && <LikeBurst key={burst.id} kind={burst.kind} />}
              </motion.div>
            </div>

            <div className={`relative mt-6 flex items-center gap-3 ${clipFull ? 'invisible' : ''}`} style={{ width: belowWidth }}>
              <MixingMark className="absolute -top-4 left-1/2 -translate-x-1/2 pointer-events-none !text-white/80" />
              <span className="w-11 text-right text-sm tabular-nums text-white/75">{fmt(progress)}</span>
              <div className="group/bar relative h-3.5 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/20 backdrop-blur-[2px] drop-shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
                onPointerDown={startScrub} role="slider" aria-label={t('Position')} aria-valuemin={0} aria-valuemax={Math.round(duration || 0)} aria-valuenow={Math.round(progress || 0)}>
                <div className="absolute inset-y-0 left-0 bg-white/90" style={{ width: `${duration ? Math.min(100, (progress / duration) * 100) : 0}%` }} />
              </div>
              <span className="w-11 text-sm tabular-nums text-white/75">{isStationTrack(currentTrack) && !duration ? t('On air') : fmt(duration)}</span>
            </div>

            {/* In at once, fading: never waiting on the old title's way out (see PlayerBar). */}
            <motion.div key={currentTrack?.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`mt-5 text-center ${clipFull ? 'invisible' : ''}`} style={{ width: belowWidth }}>
              <h2 className="text-3xl font-bold text-white leading-tight truncate">{currentTrack?.title || '—'}</h2>
              <p className="mt-1.5 text-lg text-white/70 truncate"><ArtistNames track={currentTrack} disabled={isStationTrack(currentTrack)} onNavigate={toggleFullscreen} linkClassName="hover:text-white hover:underline" /></p>
              {currentTrack?.album && <p className="mt-0.5 text-sm text-white/40 truncate">{currentTrack.album}</p>}
            </motion.div>
          </div>

          {currentTrack && (
              // Panel visibility (and which panel) is driven entirely by the
              // Queue/Lyrics buttons on the cover, not by whether lyrics
              // happen to exist; with lyrics missing, the panel shows its own
              // "no lyrics" state and search, same as windowed mode.
              <div
                className={`relative z-10 flex flex-col overflow-hidden pt-24 pb-10 ${showFullscreen ? 'transition-all duration-500' : ''} ${isPanelVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'} ${clipFull ? 'invisible' : ''}`}
                style={{ width: isPanelVisible ? PANEL_WIDTH : '0px' }}
              >
                {(fullscreenPanel !== 'none' ? fullscreenPanel : lastPanelRef.current) === 'queue' ? (
                  <QueueContent variant="fullscreen" />
                ) : (
                  <>
                    <div className="flex-1 min-h-0 pr-6">
                      <LyricsPanel
                        key={`${currentTrack?.id}-${refreshKey}`}
                        track={currentTrack}
                        progress={progress}
                        darkMode
                        fullscreen
                        wordSync={wordSync}
                        onSearchRequest={() => setShowSearch(true)}
                        textScale={1.6}
                        toolbarHidden={chromeHidden}
                        toolbarTarget={fullscreenPanel === 'lyrics' ? lyricsBarEl : null}
                        toolbarConcealed={!toolsShown}
                        onToolbarMenuChange={setToolsMenu}
                        isAutoSynced={isAutoSynced}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

          <AnimatePresence>
            {showSearch && currentTrack && (
              <SearchDrawer 
                track={currentTrack} 
                onClose={() => setShowSearch(false)} 
                onSelect={handleLyricsSelect} 
              />
            )}
          </AnimatePresence>
          </motion.div>

          <LyricsFullscreen idle={idle} onChromeHover={setOverChrome} screenFull={screenFull} onToggleScreen={toggleScreen} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
