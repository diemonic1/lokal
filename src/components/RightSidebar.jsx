import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AudioWaveform, Info, ListMusic, Music, Mic2, Disc3, PanelLeftClose, PanelRightClose, Radio, Clapperboard, Gem, ImageOff, ImagePlay, MonitorPlay } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import LyricsPanel from './LyricsPanel'
import SideVisualLyrics from './SideVisualLyrics'
import { QueueContent } from './QueuePanel'
import ArtworkBackdrop, { meshKeyFor, useArtworkBackdropEnabled } from './ArtworkBackdrop'
import MotionCover, { loadMotionCover } from './MotionCover'
import { useMotionCoverOff } from '../motionCoverPrefs'
import MixCovers from './MixCovers'
import { useMusicVideo, useMusicVideoView } from '../musicVideo'
import { api, wordSyncEnabled } from '../api'
import { useTranslation } from '../i18n'
import {
  contextLabel,
  isContextNavigable,
  navigateToContext,
  navigateToTrackAlbum,
} from '../playbackContext'
import ArtistNames from './ArtistNames'
import { isStreamed, trackArtURL } from '../onlineTracks'
import { commentLink, openLink } from '../trackLinks'

import ContextMenu, { useContextMenu } from './ContextMenu'
import { openRadio } from '../radioActions'
import LikeBurst from './LikeBurst'
import { showToast } from './Toaster'
import { formatLabel, isSuspect, losslessMenuItem, tierOf, TIERS } from '../quality'
import { trackGenreList } from '../genres'
import { useAppearanceSettings, useAppearanceText, useAppearanceValue, useSideVisual, useFavoritesEnabled } from '../appearanceFlags'
import PowerCircle, { CHARACTER_DEFAULTS } from '../visualizers/PowerCircle'
import Anomaly from '../visualizers/Anomaly'
import Splashes from '../visualizers/Splashes'
import { readSplashSettings } from '../visualizers/splashSettings'
import Trails from '../visualizers/Trails'
import { readTrailsSettings } from '../visualizers/trailsSettings'
import { pickColor } from '../visualizers/audio'
import { useSidePanelWidth, useSideLyricsScale, setSidePanelWidth } from '../sidePanelPrefs'
import { trackFolderItems } from '../trackFolderItem'

// "Music" is a placeholder some files carry, not a genre.
const isPlaceholderGenre = genre => !String(genre || '').trim() || String(genre).trim().toLowerCase() === 'music'

function InfoRow({ label, value, onClick = null, title = null, fx = true }) {
  if (!value) return null
  return (
    <div className={`flex items-start gap-3 py-1.5 border-b last:border-0 ${fx ? 'border-white/10' : 'border-border/30'}`}>
      <span className={`text-xs font-display uppercase tracking-wider w-20 flex-shrink-0 pt-0.5 ${fx ? 'text-white/45' : 'text-muted'}`}>{label}</span>
      {onClick ? (
        <button
          onClick={onClick}
          title={title || undefined}
          className="text-xs text-white/70 leading-relaxed break-all text-left hover:text-accent hover:underline transition-colors">
          {value}
        </button>
      ) : (
        <span className="text-xs text-white/70 leading-relaxed break-all">{value}</span>
      )}
    </div>
  )
}

const LYRICS_KINDS = { syllable: 'Synced by syllable', sync: 'Time-synced', plain: 'Not synced', instrumental: 'Instrumental', unfound: "Can't be found" }

/** "FLAC · 16-bit / 44.1 kHz" for a track whose source says so, else null. */
function streamQualityLabel(track) {
  if (!track?.codec) return null
  const parts = [String(track.codec).toUpperCase()]
  if (track.bit_depth && track.sample_rate) parts.push(`${track.bit_depth}-bit / ${Number(track.sample_rate) / 1000} kHz`)
  return parts.join(' · ')
}

export default function RightSidebar() {
  const { t } = useTranslation()
  const { user } = useAppStore()
  const {
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels, likedIds, setLiked,
  } = usePlayerStore(useShallow(({
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels, likedIds, setLiked,
  }) => ({
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels, likedIds, setLiked,
  })))
  // Back from the mini player: the Lyrics and Queue overlays start over.
  // The app was hidden meanwhile (App's <Activity>), where no animation runs,
  // so one that was sliding out (the view changed while hidden) would stay
  // stuck over the view picked. Shown again as they are, without sliding in.
  const showMiniPlayer = usePlayerStore(state => state.showMiniPlayer)
  const [wasMini, setWasMini] = useState(showMiniPlayer)
  const [reveal, setReveal] = useState(0)
  if (wasMini !== showMiniPlayer) {
    setWasMini(showMiniPlayer)
    if (!showMiniPlayer) setReveal(n => n + 1)
  }
  const nav = useNavigate()
  const menu = useContextMenu()
  const likeBusy = useRef(false)
  const favorites = useFavoritesEnabled()
  const burstTimer = useRef(null)
  const [burst, setBurst] = useState(null)
  useEffect(() => () => clearTimeout(burstTimer.current), [])
  // Your plays of the song (30 s or more, as recaps count them), streamed
  // songs too: read for each song, as the one in the player keeps the count
  // it had when it started. This play is counted once it ends.
  const [trackPlays, setTrackPlays] = useState({ id: null, plays: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id) return undefined
    let current = true
    Promise.resolve(api.getTrackPlays?.(user?.id || 'guest', id))
      .then(result => { if (current && Number.isFinite(result?.plays)) setTrackPlays({ id, plays: result.plays }) })
      .catch(() => {})
    return () => { current = false }
  }, [currentTrack?.id, user?.id])
  const plays = trackPlays.id === currentTrack?.id && trackPlays.plays !== null ? trackPlays.plays : Number(currentTrack?.play_count) || 0
  // A streamed song rarely comes with a genre: looked up (and kept) for it.
  const [foundGenre, setFoundGenre] = useState({ id: null, genre: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id || !isPlaceholderGenre(currentTrack.genre) || !isStreamed(currentTrack)) return undefined
    let current = true
    Promise.resolve(api.onlineGenre?.(id)).then(genre => { if (current && genre) setFoundGenre({ id, genre }) }).catch(() => {})
    return () => { current = false }
  }, [currentTrack?.id, currentTrack?.genre]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every genre the song has (its tag and the library's list); "Music" is a
  // placeholder some files carry, not a genre: not shown.
  const ownGenres = trackGenreList(currentTrack).filter(name => !isPlaceholderGenre(name))
  const genres = ownGenres.length ? ownGenres : (foundGenre.id === currentTrack?.id && foundGenre.genre ? [foundGenre.genre] : [])
  const canOpenContext = isContextNavigable(playbackContext)
  const wordSync = wordSyncEnabled()
  // Backend-persisted setting (Settings' Unsynced Lyrics Auto-Sync toggle
  // saves via api.saveSettings, never to localStorage) -- reading a
  // localStorage key here that's never written left this permanently false
  // regardless of the actual saved choice. RightSidebar stays mounted for
  // the whole session, so a mount-once fetch would go stale the same way
  // FullscreenPlayer/LyricsFullscreen's did -- refetch whenever the Lyrics
  // overlay is opened so a change made in Settings takes effect right away.
  const [settings, setSettings] = useState({})
  // Guards against an in-flight getSettings() from an earlier call
  // resolving AFTER a later one (e.g. the Lyrics panel is reopened, or
  // 'lokal:settings-saved' fires again, while the first request is still
  // pending) and overwriting the newer settings with stale ones.
  const settingsSeqRef = useRef(0)
  useEffect(() => {
    if (sidePanelView !== 'lyrics' && sidePanelView !== 'visualLyrics') return
    const loadSettings = () => {
      const seq = ++settingsSeqRef.current
      api.getSettings()
        .then(s => { if (seq === settingsSeqRef.current) setSettings(s || {}) })
        .catch(() => {})
    }
    loadSettings()
    // Covers the case where the sidebar is *already* open to Lyrics when the
    // user saves in Settings -- sidePanelView itself never changes then, so
    // the effect above wouldn't otherwise refire.
    window.addEventListener('lokal:settings-saved', loadSettings)
    return () => window.removeEventListener('lokal:settings-saved', loadSettings)
  }, [sidePanelView])
  // On unless switched off (Settings > Lyrics > Time Plain Lyrics).
  const isAutoSynced = settings.unsynced_auto_sync !== '0'

  // Whichever of info/lyrics is showing beneath the Queue overlay. The
  // overlay fully covers this (opaque background, see below), and closing
  // The base content area always shows 'info' now -- Queue and Lyrics are
  // both overlays that slide up over it (see below) and slide back down to
  // reveal it, so there's nothing else the base itself needs to render.
  // This is only used for the Details/Lyrics/Queue pill highlight. Queue is
  // a tab here only when the panel is shared (exclusiveSidePanels); in the
  // other mode it opens its own panel next to this one, and "Details" stays
  // highlighted.
  // Settings > Visualizations > Side Panel: the visualization shown with the
  // lyrics (over them on Visualization + Lyrics) and the fullscreen one: the
  // Visualization tab, and wherever the lyrics are hidden (being searched
  // for, not found, instrumental...). Off: just the background colour.
  const textKind = useSideVisual('side_visual_text', 'character')
  const fullKind = useSideVisual('side_visual_full', 'splashes')
  const anomalySettings = {
    sensitivity: Math.max(1, Math.min(10, useAppearanceValue('side_anomaly_sensitivity', 5))),
    size: Math.max(50, Math.min(200, useAppearanceValue('side_anomaly_size', 100))) / 100,
    color: useAppearanceText('side_anomaly_color'),
  }
  const characterSettings = {
    sensitivity: Math.max(10, Math.min(300, useAppearanceValue('side_character_sensitivity', CHARACTER_DEFAULTS.sensitivity))),
    strength: Math.max(0, Math.min(200, useAppearanceValue('side_character_strength', CHARACTER_DEFAULTS.strength))),
    size: Math.max(50, Math.min(200, useAppearanceValue('side_character_size', CHARACTER_DEFAULTS.size))),
    color: useAppearanceText('side_character_color', CHARACTER_DEFAULTS.color),
    dots: useAppearanceText('side_character_dots') !== '0',
    mouse: useAppearanceText('side_character_mouse') !== '0',
  }
  const splashSettings = useAppearanceSettings(readSplashSettings)
  const trailsSettings = useAppearanceSettings(readTrailsSettings)
  // Each one's own background colour (#161616 unless picked), and maybe the
  // song's cover over it (filling the box, as see-through as set).
  const looks = {
    character: { bg: useAppearanceText('side_character_bg'), cover: useAppearanceText('side_character_cover') === '1', coverOpacity: useAppearanceValue('side_character_cover_opacity', 50) },
    anomaly: { bg: useAppearanceText('side_anomaly_bg'), cover: useAppearanceText('side_anomaly_cover') === '1', coverOpacity: useAppearanceValue('side_anomaly_cover_opacity', 50) },
    splashes: { bg: useAppearanceText('side_splash_bg'), cover: useAppearanceText('side_splash_cover') === '1', coverOpacity: useAppearanceValue('side_splash_cover_opacity', 50) },
    trails: { bg: useAppearanceText('side_trails_bg'), cover: useAppearanceText('side_trails_cover') === '1', coverOpacity: useAppearanceValue('side_trails_cover_opacity', 50) },
  }
  const backgroundOf = kind => (looks[kind] ? pickColor(looks[kind].bg, '#161616') : 'rgb(var(--surface-rgb))')
  const renderVisual = (kind) => {
    const look = looks[kind]
    if (!look) return <div className="flex-1 min-h-0" />
    const cover = look.cover ? trackArtURL(currentTrack) : null
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {cover && (
          <img src={cover} alt="" aria-hidden="true" draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
            style={{ opacity: Math.max(0, Math.min(100, look.coverOpacity)) / 100 }} />
        )}
        {kind === 'anomaly' ? <Anomaly className="relative flex-1 min-h-0" {...anomalySettings} />
          : kind === 'splashes' ? <Splashes className="relative flex-1 min-h-0" settings={splashSettings} />
          : kind === 'trails' ? <Trails className="relative flex-1 min-h-0" settings={trailsSettings} />
          : <PowerCircle className="relative flex-1 min-h-0" background={backgroundOf(kind)} transparent={!!cover} settings={characterSettings} />}
      </div>
    )
  }
  const visualBg = backgroundOf(textKind)
  const visual = renderVisual(textKind)
  const fullVisualBg = backgroundOf(fullKind)
  const fullVisual = renderVisual(fullKind)
  const showVisual = sidePanelView === 'visual'
  // The Lyrics tab without lyrics (still searching, or none found) shows the
  // same visualization behind it (LyricsPanel's idleVisual).
  const [lyricsIdle, setLyricsIdle] = useState(false)
  // Visualization + Lyrics: the picture over the lyrics (SideVisualLyrics);
  // a tab whatever the settings (its picture is the visualization with lyrics).
  const showVisualLyrics = sidePanelView === 'visualLyrics'
  const tab = sidePanelView === 'lyrics' ? 'lyrics' : showVisual ? 'visual' : showVisualLyrics ? 'visualLyrics' : exclusiveSidePanels && sidePanelView === 'queue' ? 'queue' : 'info'

  // Cosmetic case: when the panel is closed and Queue/Lyrics is clicked,
  // toggleQueueButton/toggleLyricsButton opens it straight to that
  // sidePanelView in the same state update -- both go from closed/info to
  // open/<view> together. Playing the overlay's usual slide-up animation
  // on top of the panel's own opening animation looks like two separate
  // motions stacked back to back. Detect exactly that transition (was
  // closed, is now open, and this overlay is what's showing) and skip
  // *just* the overlay's entrance for it -- switching to it from an
  // already-open panel is untouched and still slides up as before.
  const wasSidebarOpenRef = useRef(showRightSidebar)
  const openedFreshToQueue = !wasSidebarOpenRef.current && showRightSidebar && sidePanelView === 'queue'
  const openedFreshToLyrics = !wasSidebarOpenRef.current && showRightSidebar && sidePanelView === 'lyrics'
  const openedFreshToVisual = !wasSidebarOpenRef.current && showRightSidebar && showVisual
  const openedFreshToVisualLyrics = !wasSidebarOpenRef.current && showRightSidebar && showVisualLyrics
  useEffect(() => {
    wasSidebarOpenRef.current = showRightSidebar
  })

  // Colour background + full-bleed cover (default), or the classic dark panel.
  const fx = useArtworkBackdropEnabled()
  // A tall (9:16) canvas gets a taller hero area -- about 60% of the panel's
  // height -- instead of being cropped into the square cover.
  const [canvasOn, setCanvasOn] = useState(false)
  // A song with a moving cover (a Canvas or an animated album cover) gets a
  // button to turn it off for that song, here and in full screen
  // (motionCoverPrefs.js). Whether it has one is asked even while it's off,
  // so the button stays to turn it back on.
  const [coverOff, setCoverOff] = useMotionCoverOff(currentTrack)
  const [coverClip, setCoverClip] = useState({ id: null, clip: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id) return undefined
    let current = true
    loadMotionCover(id).then(clip => { if (current) setCoverClip({ id, clip: clip?.src ? clip : null }) })
    return () => { current = false }
  }, [currentTrack?.id])
  const clipNow = coverClip.id === currentTrack?.id ? coverClip.clip : null
  // AutoMix turns the cover over into the next song's (when it's a still one).
  // The official music video, once found and checked (musicVideo.js).
  const { video: musicVideo } = useMusicVideo(currentTrack)
  const showMusicVideo = useMusicVideoView(s => s.show)
  const clipName = clipNow && (clipNow.tall || clipNow.source === 'spotify') ? 'Canvas' : 'Moving Cover'
  const infoRef = useRef(null)
  const [infoHeight, setInfoHeight] = useState(0)
  useEffect(() => {
    const el = infoRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setInfoHeight(Math.round(entry.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showRightSidebar])
  const canvasHero = canvasOn && infoHeight > 0
  const heroHeight = canvasHero ? Math.max(300, Math.round(infoHeight * 0.6)) : 300

  const artSrc = trackArtURL(currentTrack)

  // Width: dragged by the panel's left edge, kept between sessions.
  const width = useSidePanelWidth()
  const lyricsScale = useSideLyricsScale()
  const [resizing, setResizing] = useState(false)
  const startResize = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    let last = startWidth
    setResizing(true)
    const move = e => { last = setSidePanelWidth(startWidth + (startX - e.clientX), { persist: false }) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidePanelWidth(last)
      setResizing(false)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const doubleClickLike = async event => {
    if (!currentTrack || likeBusy.current || !favorites || event.target.closest?.('button, a, input, [role="slider"]')) return
    likeBusy.current = true
    const liked = likedIds.has(currentTrack.id)
    setBurst({ id: Date.now(), trackId: currentTrack.id, kind: liked ? 'unlike' : 'like' })
    clearTimeout(burstTimer.current)
    burstTimer.current = setTimeout(() => setBurst(null), 1200)
    try {
      const result = await api.toggleLike(currentTrack.id, user?.id, currentTrack)
      if (result?.error) throw new Error(result.error)
      if (useAppStore.getState().user?.id === user?.id) setLiked(currentTrack.id, typeof result === 'boolean' ? result : !!result?.liked)
    } catch (error) { setBurst(null); showToast(error.message || t('Could not update this song’s like.')) } finally { likeBusy.current = false }
  }

  // The view picker's menu, under its button, right-aligned to it.
  const tabMenu = useContextMenu()
  const openTabMenu = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const pick = id => () => (id === 'queue' ? (tab === 'queue' ? null : toggleQueueButton()) : setSidePanelView(id))
    tabMenu.open({ preventDefault() {}, stopPropagation() {}, clientX: box.right, clientY: box.bottom + 4 }, [
      { label: t('Details'), icon: Info, checked: tab === 'info', onSelect: pick('info') },
      { label: t('Lyrics'), icon: Mic2, checked: tab === 'lyrics', onSelect: pick('lyrics') },
      { label: t('Visualization'), icon: AudioWaveform, checked: tab === 'visual', onSelect: pick('visual') },
      { label: t('Visualization + Lyrics'), icon: MonitorPlay, checked: tab === 'visualLyrics', onSelect: pick('visualLyrics') },
      { label: t('Queue'), icon: ListMusic, checked: tab === 'queue', onSelect: pick('queue') },
      { separator: true },
      { label: t('Close the side panel'), icon: PanelRightClose, onSelect: toggleRightSidebar },
    ])
  }

  const openTrackMenu = (event) => {
    if (!currentTrack) return
    menu.open(event, [
      ...trackFolderItems(currentTrack, t),
      { label: t('Start radio'), icon: Radio, onSelect: () => openRadio(nav, currentTrack, user?.id) },
      currentTrack.artist && { label: t('Start artist radio'), icon: Radio, onSelect: () => openRadio(nav, { artist: currentTrack.artist, type: 'artist' }, user?.id) },
      losslessMenuItem(currentTrack, Gem),
    ].filter(Boolean))
  }

  // No backdrop blur on these (nor on the panel): the colour behind them is
  // already a blurred image, and blur filters nested in this panel made
  // Chromium flash dark bands over them whenever anything repainted (hovering
  // a list in the page, a playing canvas).

  const contextBlock = currentTrack && playbackContext?.name ? (
    <div className="min-w-0">
      <p className={`text-[10px] font-display uppercase tracking-[0.22em] ${fx ? 'text-white/50' : 'text-muted'}`}>
        {contextLabel(playbackContext)}
      </p>
      {canOpenContext ? (
        <button
          onClick={() => navigateToContext(nav, playbackContext, currentTrack?.id)}
          title={t('Go to {name}', { name: playbackContext.name })}
          className={`mt-0.5 block max-w-full truncate text-xs hover:underline text-left ${fx ? 'text-white/85 hover:text-white' : 'text-accent'}`}>
          {playbackContext.name}
        </button>
      ) : (
        <p className="mt-0.5 truncate text-xs text-white/70">{playbackContext.name}</p>
      )}
    </div>
  ) : null

  return (
    <>
      {showRightSidebar && (
        // No AnimatePresence wrapping this: entering still animates fine
        // via initial->animate (that doesn't need AnimatePresence at all),
        // but closing has no exit animation to wait on -- React unmounts
        // this the instant showRightSidebar goes false, in the same
        // commit, so there is no animation-library timing to depend on
        // for "is the close actually instant" the way there would be with
        // an exit={{...}} + duration:0 override. This is guaranteed by
        // ordinary React unmount semantics, not by trusting Framer
        // Motion's internal exit-completion timing, which isn't something
        // I can verify without a live browser.
        <motion.aside
          initial={{ width: 0 }}
          animate={{ width }}
          transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }}
          aria-label={t("Now Playing")}
          className="relative overflow-hidden flex-shrink-0"
          style={{ minWidth: width }}
        >
          {/* Drag the left edge to resize; double-click puts it back. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("Resize the side panel")}
            title={t("Drag to resize")}
            onPointerDown={startResize}
            onDoubleClick={() => setSidePanelWidth(300)}
            className="absolute left-0 top-0 bottom-[var(--player-space,0px)] z-40 w-1.5 cursor-col-resize"
          />
          {/* Fixed width, slides via transform instead of the width above --
              keeping backdrop-filter/background off the width-animating
              element avoids the Chromium rendering glitch (blur resampling
              a shape that's actively changing) that read as a black-box
              flash. This element's own width never changes; sliding is
              purely x, and closing is instant along with the parent. */}
          <motion.div
            initial={{ x: width }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="relative h-full flex flex-col border-l border-border"
            style={{ width, backgroundColor: 'rgba(var(--surface-rgb), 0.85)' }}
          >
          {/* The view picker: a button in the top right corner, shown on
              hover, opening a menu of the tabs (and closing the panel). The
              content runs up to the top under it. */}
          <div className="group/tabs absolute top-0 right-0 z-50 p-2">
            <button
              type="button"
              onClick={openTabMenu}
              title={t('Side panel view')}
              aria-label={t('Side panel view')}
              aria-haspopup="menu"
              aria-expanded={!!tabMenu.state}
              className={`flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-elevated text-muted shadow-lg transition-opacity hover:text-white focus-visible:opacity-100 group-hover/tabs:opacity-100 ${tabMenu.state ? 'opacity-100' : 'opacity-0'}`}
            >
              <PanelLeftClose size={15} className="-rotate-90" />
            </button>
          </div>

          {/* Fixed-size content area: only what's INSIDE this ever changes
              when switching info/lyrics/queue -- the outer panel's width
              never moves, so there's no brief "adds space" moment and no
              second panel ever exists to overlap with. */}
          <div className="flex-1 overflow-hidden relative min-h-0">
            {/* The hidden Info/Lyrics pane is inert: not focusable or
                reachable by assistive tech while the other tab covers it. */}
            <div ref={infoRef} className="absolute inset-0 flex flex-col" inert={tab !== 'info'}
              // Hidden once another tab has slid over it (nothing of it shows
              // through); back at once when it's the one shown again.
              style={{ visibility: tab === 'info' ? 'visible' : 'hidden', transition: `visibility 0s linear ${tab === 'info' ? '0s' : '0.8s'}` }}>
              {/* Apple Music-style: the cover runs edge to edge and dissolves
                  into colours taken from it; a moving cover plays over the
                  still one when there is one. */}
              {fx && <ArtworkBackdrop trackId={meshKeyFor(currentTrack)} seam={artSrc ? heroHeight : 0} />}
              <div className={`relative flex-1 overflow-y-auto ${fx ? '' : 'p-4'} pb-[calc(var(--player-space,0px)+1rem)]`}>
                <motion.div
                  onDoubleClick={doubleClickLike}
                  title={t("Double-click to like or unlike this song")}
                  className={fx ? 'relative w-full overflow-hidden' : 'relative w-full rounded-xl overflow-hidden bg-card border border-border/50'}
                  style={{
                    // Square cover normally; a tall canvas grows it to ~60% of the panel.
                    height: fx ? heroHeight : (canvasHero ? heroHeight - 32 : 268),
                    transition: 'height 420ms cubic-bezier(0.4, 0, 0.2, 1)',
                    ...(fx && artSrc ? {
                      WebkitMaskImage: `linear-gradient(to bottom, black ${canvasHero ? 72 : 55}%, transparent 100%)`,
                      maskImage: `linear-gradient(to bottom, black ${canvasHero ? 72 : 55}%, transparent 100%)`,
                    } : null),
                  }}
                >
                  {/* Song to song: AutoMix's cloudy dissolve, else a short fade (MixCovers). */}
                  {artSrc ? (
                    <MixCovers track={currentTrack} render={(track, { top }) => (
                      <>
                        <img src={trackArtURL(track)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        {/* Off while another tab covers this one: on Windows a video can be
                            drawn over what covers it (the cover showed through Visualization + Lyrics). */}
                        <MotionCover trackId={track?.id} only="square" off={coverOff || tab !== 'info'} />
                        <MotionCover trackId={track?.id} only="tall" onActive={top ? setCanvasOn : undefined} off={coverOff || tab !== 'info'} />
                      </>
                    )} />
                  ) : (
                    <div className={`absolute inset-0 flex items-center justify-center ${fx ? 'text-white/25' : 'text-subtle'}`}><Music size={52} /></div>
                  )}
                  {burst && burst.trackId === currentTrack?.id && <LikeBurst key={burst.id} kind={burst.kind} />}
                </motion.div>

                <div className={fx ? 'relative -mt-16 px-4 pb-4 space-y-4' : 'mt-4 space-y-4'}>
                  {!fx && contextBlock}

                  {/* In at once, fading: never waiting on the old title's way out (see PlayerBar). */}
                    <motion.div key={currentTrack?.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                      {currentTrack?.album ? (
                        <button
                          onClick={() => navigateToTrackAlbum(nav, currentTrack)}
                          onContextMenu={openTrackMenu}
                          title={t('Go to album: {album}', { album: currentTrack.album })}
                          className={fx ? 'text-lg font-semibold text-white leading-tight text-left hover:underline transition-colors max-w-full block drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]' : 'font-display text-white text-sm leading-tight text-left hover:text-accent hover:underline transition-colors truncate max-w-full block'}>
                          {currentTrack?.title || t('Nothing playing')}
                        </button>
                      ) : (
                        <p onContextMenu={openTrackMenu} className={fx ? 'text-lg font-semibold text-white leading-tight drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]' : 'font-display text-white text-sm leading-tight'}>{currentTrack?.title || t('Nothing playing')}</p>
                      )}
                      {currentTrack?.artist ? (
                        <ArtistNames track={currentTrack} onContextMenu={openTrackMenu}
                          linkClassName={fx ? 'hover:text-white hover:underline' : 'hover:text-accent hover:underline'}
                          className={fx ? 'text-sm text-white/70 mt-0.5 text-left truncate max-w-full block' : 'text-xs text-muted mt-0.5 text-left truncate max-w-full block'} />
                      ) : (
                        <p className={fx ? 'text-sm text-white/70 mt-0.5' : 'text-xs text-muted mt-0.5'}>{currentTrack?.artist}</p>
                      )}
                    </motion.div>

                  {fx && contextBlock}

                  {/* One bar of icons: Full Screen and Lyrics always; Music Video
                      and the canvas switch only when this song has one. */}
                  {currentTrack && (() => {
                    const btn = `flex flex-1 items-center justify-center py-2.5 transition-colors ${fx ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-white/[0.04] hover:text-white'}`
                    const actions = [
                      { key: 'full', label: t('Full screen'), icon: Disc3, onClick: toggleFullscreen },
                      { key: 'lyrics', label: t('Lyrics, full screen'), icon: Mic2, onClick: toggleLyricsFullscreen },
                      musicVideo && { key: 'video', label: t('Music video'), title: t('Play the official music video, in time with the song'), icon: Clapperboard, onClick: showMusicVideo },
                      clipNow && {
                        key: 'clip', pressed: coverOff, icon: coverOff ? ImageOff : ImagePlay, onClick: () => setCoverOff(!coverOff),
                        label: clipName === 'Canvas'
                          ? (coverOff ? t('Show Canvas') : t('Hide Canvas'))
                          : (coverOff ? t('Show Moving Cover') : t('Hide Moving Cover')),
                        title: clipName === 'Canvas'
                          ? (coverOff ? t('Show the canvas for this song again') : t('Hide the canvas: the still cover for this song, here and in full screen'))
                          : (coverOff ? t('Show the moving cover for this song again') : t('Hide the moving cover: the still cover for this song, here and in full screen')),
                      },
                    ].filter(Boolean)
                    return (
                      <div role="toolbar" aria-label={t("Song actions")} className={`flex overflow-hidden rounded-xl border ${fx ? 'divide-x divide-white/10 border-white/10 bg-white/[0.12]' : 'divide-x divide-border border-border bg-card'}`}>
                        {actions.map(({ key, label, title, icon: Icon, onClick, pressed }) => (
                          <button key={key} type="button" onClick={onClick} title={title || label} aria-label={label} aria-pressed={pressed}
                            className={`${btn} ${pressed ? (fx ? 'text-white/45' : 'text-muted/60') : ''}`}>
                            <Icon size={15} />
                          </button>
                        ))}
                      </div>
                    )
                  })()}

                  {currentTrack && (
                    <div className={fx ? 'bg-black/25 rounded-xl border border-white/10 px-4 py-1' : 'bg-card rounded-xl border border-border px-4 py-1'}>
                      <InfoRow
                        fx={fx}
                        label={t('Album')}
                        value={currentTrack.album}
                        title={currentTrack.album ? t('Go to album: {album}', { album: currentTrack.album }) : null}
                        onClick={currentTrack.album ? () => navigateToTrackAlbum(nav, currentTrack) : null}
                      />
                      {currentTrack.album_artist && currentTrack.album_artist !== currentTrack.artist && <InfoRow fx={fx} label={t('Alb. Artist')} value={currentTrack.album_artist} />}
                      <InfoRow fx={fx} label={t('Year')} value={currentTrack.year} />
                      <InfoRow fx={fx} label={t(genres.length > 1 ? 'Genres' : 'Genre')} value={genres.join(', ')} />
                      <InfoRow fx={fx} label={t('Track #')} value={currentTrack.track_num ? `${currentTrack.track_num}` : null} />
                      <InfoRow fx={fx} label={t('Bitrate')} value={currentTrack.bitrate ? t('{n} kbps', { n: currentTrack.bitrate }) : null} />
                      {/* A file: its tier on the Audio Quality page (opens it there).
                          A stream (an addon's) has no file to measure: what the source says of it. */}
                      {(() => {
                        const tier = isStreamed(currentTrack) ? 'unknown' : isSuspect(currentTrack) ? 'suspect' : tierOf(currentTrack)
                        if (tier === 'unknown') return <InfoRow fx={fx} label={t('Quality')} value={streamQualityLabel(currentTrack)} />
                        const format = formatLabel(currentTrack)
                        return <InfoRow fx={fx} label={t('Quality')} value={[t(TIERS[tier].label), format].filter(Boolean).join(' · ')}
                          title={t(TIERS[tier].desc)} onClick={() => nav('/quality', { state: { tier } })} />
                      })()}
                      <InfoRow fx={fx} label={t('Lyrics')} value={LYRICS_KINDS[currentTrack.lyrics_kind] ? t(LYRICS_KINDS[currentTrack.lyrics_kind]) : null} />
                      <InfoRow fx={fx} label={t('Comment')} value={String(currentTrack.comment || '').trim()}
                        onClick={commentLink(currentTrack) ? () => openLink(commentLink(currentTrack)) : null} title={commentLink(currentTrack)} />
                      <InfoRow fx={fx} label={t('Plays')} value={plays > 0 ? plays.toLocaleString() : null} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Lyrics: slides up over the base view above, slides back down
                to reveal it -- same overlay pattern as Queue below, so
                switching to/from Lyrics from an already-open panel animates
                identically, and opening fresh straight to Lyrics skips this
                entrance the same way Queue does (see openedFreshToLyrics). */}
            <AnimatePresence key={`lyrics-${reveal}`} initial={reveal === 0}>
              {sidePanelView === 'lyrics' && (
                <motion.div
                  key="lyrics-overlay"
                  initial={openedFreshToLyrics ? false : { y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}
                >
                  <AnimatePresence>
                    {lyricsIdle && currentTrack && (
                      <motion.div key="lyrics-visual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: 'easeInOut' }} className="absolute inset-0 flex flex-col" style={{ backgroundColor: fullVisualBg }}>
                        {fullVisual}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Hidden over the visualization, the lyrics let the mouse through to it.
                      They run down to the player bar: nothing sits under them
                      (full screen is in the Details tab's button bar). */}
                  <div className={`relative flex-1 overflow-hidden min-h-0 pb-[var(--player-space,0px)] ${lyricsIdle && currentTrack ? 'pointer-events-none' : ''}`}>
                    {currentTrack ? (
                      <LyricsPanel track={currentTrack} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={lyricsScale} isAutoSynced={isAutoSynced} toolbarAtBottom sizeControl
                        idleVisual onIdleChange={setLyricsIdle} edgeFade={false} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted text-xs">{t('No track playing')}</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Visualization: same overlay as Lyrics. Mounted only while it
                shows, so it doesn't run while another tab (or no panel) is open. */}
            <AnimatePresence key={`visual-${reveal}`} initial={reveal === 0}>
              {showVisual && (
                <motion.div
                  key="visual-overlay"
                  initial={openedFreshToVisual ? false : { y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ backgroundColor: fullVisualBg }}
                >
                  {fullVisual}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Visualization + Lyrics: same overlay again, mounted only while it shows. */}
            <AnimatePresence key={`visual-lyrics-${reveal}`} initial={reveal === 0}>
              {showVisualLyrics && (
                <motion.div
                  key="visual-lyrics-overlay"
                  initial={openedFreshToVisualLyrics ? false : { y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}
                >
                  {currentTrack ? (
                    <SideVisualLyrics track={currentTrack} progress={progress} visual={visual} visualBg={visualBg} fullVisual={fullVisual} fullVisualBg={fullVisualBg} coverOff={coverOff}
                      wordSync={wordSync} textScale={lyricsScale} isAutoSynced={isAutoSynced} />
                  ) : (
                    <div className="flex flex-1 flex-col" style={{ backgroundColor: fullVisualBg }}>{fullVisual}</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Queue: slides up over the base view above, slides back down
                to reveal it -- never a second panel, never a width change. */}
            <AnimatePresence key={`queue-${reveal}`} initial={reveal === 0}>
              {exclusiveSidePanels && sidePanelView === 'queue' && (
                <motion.div
                  key="queue-overlay"
                  initial={openedFreshToQueue ? false : { y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}
                >
                  {/* No close button of its own: the view picker sits in that corner. */}
                  <QueueContent />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </motion.div>
        </motion.aside>
      )}
      <ContextMenu menu={menu} />
      <ContextMenu menu={tabMenu} />
    </>
  )
}
