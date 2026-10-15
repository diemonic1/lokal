import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, PanelRight, Maximize2, Radio, Gem, Cast } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useTranslation } from '../i18n'
import { navigateToTrackAlbum } from '../playbackContext'
import { navigateToTrackArtist } from '../artistLink'
import Waveform from './Waveform'
import { showToast } from './Toaster'
import { useAppearanceFlag, useAppearanceValue } from '../appearanceFlags'
import CoverGradient from './CoverGradient'
import { meshKeyFor } from './ArtworkBackdrop'
import { trackArtURL, isStreamed, streamLabel } from '../onlineTracks'
import { isStationTrack } from '../radio/stations'
import SaveToLibraryButton from './SaveToLibraryButton'
import { TIERS, formatLabel, isSuspect, tierOf, losslessMenuItem } from '../quality'
import MixingMark from './MixingMark'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { openRadio } from '../radioActions'
import { useCastStore } from '../cast/castStore'

function fmt(s) { return `${Math.floor((s||0)/60)}:${Math.floor((s||0)%60).toString().padStart(2,'0')}` }

export default function PlayerBar() {
  const { t } = useTranslation()
  const glass = useAppearanceFlag('glass_player_bar')
  const floating = useAppearanceFlag('player_bar_floating')
  const showGradient = useAppearanceFlag('player_bar_gradient')
  const gradientStrength = useAppearanceValue('player_bar_gradient_strength', 50)
  const gradientSpeed = useAppearanceValue('player_bar_gradient_speed', 100)
  // How see-through the glass is (0: solid colour, still blurred).
  const glassTransparency = Math.max(0, Math.min(90, useAppearanceValue('player_bar_glass_transparency', 40)))
  // How see-through the shade under the times and seek bar is (100: none).
  const shadeTransparency = Math.max(0, Math.min(100, useAppearanceValue('player_bar_shade_transparency', 100)))
  // The cover gradient reaches as far as the cover, title and artist do.
  const infoRef = useRef(null)
  const [infoWidth, setInfoWidth] = useState(0)
  useEffect(() => {
    const node = infoRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setInfoWidth(node.getBoundingClientRect().width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const showWaveform = useAppearanceFlag('player_waveform')
  const nav = useNavigate()
  const {
    currentTrack, isPlaying, isBuffering, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue, showLyricsPanel, sidePanelView, exclusiveSidePanels,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsButton, toggleRightSidebar, toggleFullscreen, toggleQueueButton,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
  } = usePlayerStore(useShallow(({
    currentTrack, isPlaying, isBuffering, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue, showLyricsPanel, sidePanelView, exclusiveSidePanels,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsButton, toggleRightSidebar, toggleFullscreen, toggleQueueButton,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
  }) => ({
    currentTrack, isPlaying, isBuffering, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue, showLyricsPanel, sidePanelView, exclusiveSidePanels,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsButton, toggleRightSidebar, toggleFullscreen, toggleQueueButton,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
  })))
  const { user, openAddToPlaylist } = useAppStore()
  const [likeAnim, setLikeAnim] = useState(false)
  const [keepCommaArtists, setKeepCommaArtists] = useState([])
  const scrubbing = useRef(false)
  const [localProg, setLocalProg] = useState(null)
  const menu = useContextMenu()
  const display = localProg ?? progress
  const isLiked = currentTrack && likedIds.has(currentTrack.id)
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  useEffect(() => {
    api.getKeepCommaArtists().then(artists => {
      if (Array.isArray(artists)) {
        setKeepCommaArtists(artists)
      } else if (artists?.value) {
        try { setKeepCommaArtists(JSON.parse(artists.value)) } catch {}
      }
    }).catch(() => {})
  }, [])


  const handleScrub = useCallback((e) => {
    if (!duration || isStationTrack(usePlayerStore.getState().currentTrack)) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    setLocalProg(t)
    // Through the store: it seeks the playing element, or the TV while casting.
    if (scrubbing.current) usePlayerStore.getState().setProgressWithAudioUpdate(t)
  }, [duration])

  const toggleLike = async () => {
    if (!currentTrack) return
    const r = await api.toggleLike(currentTrack.id, user?.id, currentTrack)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(currentTrack.id, liked)
    if (liked) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 600) }
  }

  const artSrc = trackArtURL(currentTrack)

  // An online song (YouTube, SoundCloud): label, and a button to save it.
  const streamed = isStreamed(currentTrack)
  // An online radio station: live, nothing to seek; its song's length only
  // when the station's API said.
  const station = isStationTrack(currentTrack)

  const handleArtistClick = () => {
    if (!currentTrack || station) return
    navigateToTrackArtist(nav, currentTrack, keepCommaArtists)
  }

  const hasAlbum = !!currentTrack?.album
  // A click on the title copies "Artist - Title".
  const copyTrackName = () => {
    if (!currentTrack) return
    const text = [currentTrack.artist, currentTrack.title].filter(Boolean).join(' - ')
    Promise.resolve(navigator.clipboard?.writeText(text))
      .then(() => showToast(t('Copied: {text}', { text })))
      .catch(() => showToast(t('Could not copy to the clipboard')))
  }

  // Volume is shown and stepped in whole percent; a change shows the new
  // value over the slider for a moment.
  const [volumeTip, setVolumeTip] = useState(false)
  const volumeTipTimer = useRef(null)
  const showVolumeTip = () => {
    setVolumeTip(true)
    clearTimeout(volumeTipTimer.current)
    volumeTipTimer.current = setTimeout(() => setVolumeTip(false), 1000)
  }
  useEffect(() => () => clearTimeout(volumeTipTimer.current), [])
  const changeVolume = (percent) => {
    setVolume(Math.max(0, Math.min(100, Math.round(percent))) / 100)
    showVolumeTip()
  }
  // The wheel anywhere on the bar: volume in steps of Settings > Appearance >
  // Player Bar > Volume wheel step (%); over the seek bar: 1 s steps.
  const wheelStep = Math.max(1, Math.min(5, Math.round(useAppearanceValue('volume_wheel_step', 5))))
  const onBarWheel = (e) => {
    if (!e.deltaY) return
    const direction = e.deltaY < 0 ? 1 : -1
    changeVolume(Math.round(usePlayerStore.getState().volume * 100) + direction * wheelStep)
  }
  const onSeekWheel = (e) => {
    e.stopPropagation()
    if (!e.deltaY || !duration) return
    const { progress: p, setProgressWithAudioUpdate } = usePlayerStore.getState()
    setProgressWithAudioUpdate(Math.max(0, Math.min(duration, p + (e.deltaY < 0 ? 1 : -1))))
  }

  const openTrackMenu = (event) => {
    if (!currentTrack || station) return
    menu.open(event, [
      { label: t('Start radio'), icon: Radio, onSelect: () => openRadio(nav, currentTrack, user?.id) },
      currentTrack.artist && { label: t('Start artist radio'), icon: Radio, onSelect: () => openRadio(nav, { artist: currentTrack.artist, type: 'artist' }, user?.id) },
      losslessMenuItem(currentTrack, Gem),
    ].filter(Boolean))
  }

  // The playing song's audio quality, when it's been read (not for streams).
  // Casting: the device it plays on (the chip under the artist).
  const castActive = usePlayerStore(s => s.castActive)
  // Playing a Flow: the play button takes the Flow orb's colours (Home → Flow).
  const flowPlaying = usePlayerStore(s => s.playbackContext?.type === 'flow')
  const castStatusDevice = useCastStore(s => s.status?.device)
  const castDevice = castActive ? castStatusDevice : null
  const qualityTier = currentTrack && !streamed ? (isSuspect(currentTrack) ? 'suspect' : tierOf(currentTrack)) : 'unknown'
  const quality = qualityTier !== 'unknown' ? { info: TIERS[qualityTier], format: formatLabel(currentTrack) } : null

  return (
    <>
      {/* Settings > Appearance > Player Bar:
          Floating -- a card over the bottom of the pages, which scroll on
          underneath it (App leaves --player-space for it); off, the strip
          docked below the pages.
          Glass -- see-through and blurring what's behind; off, solid. */}
      <div data-player-bar className={`${floating
        ? 'absolute inset-x-3 bottom-3 z-30 rounded-2xl border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.45)]'
        : 'relative border-t border-border flex-shrink-0 z-10'} min-h-[90px] flex items-center pl-[10px] pr-4 gap-4 [&_button:not(:disabled)]:cursor-pointer ${glass ? 'backdrop-blur-lg backdrop-saturate-150' : ''}`}
        style={{
          backgroundColor: glass ? `rgb(var(--surface-rgb) / ${(1 - glassTransparency / 100).toFixed(2)})` : 'rgb(var(--surface-rgb))',
          '--cover-gradient-width': infoWidth ? `${Math.round(infoWidth + 16 + 48)}px` : undefined,
        }}
        onWheel={onBarWheel}>
        {showGradient && <CoverGradient trackId={meshKeyFor(currentTrack)} strength={gradientStrength} speed={gradientSpeed} rounded={floating} />}
        <div ref={infoRef} className="relative flex flex-1 items-center gap-3 min-w-0">
        <button onClick={toggleFullscreen} disabled={!currentTrack}
          className="relative w-[70px] h-[70px] my-[10px] rounded-md overflow-hidden flex-shrink-0 bg-elevated hover:ring-2 ring-accent/30 transition-all disabled:cursor-default">
          {/* Not "wait": with the window minimized no animation runs, and a
              wait for an exit that never finishes left the old song's cover
              (and title) up for good while songs changed. Layers crossfade. */}
          <AnimatePresence initial={false}>
            {artSrc ? (
              <motion.img key={station ? artSrc : currentTrack?.id} src={artSrc}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-subtle text-xl">♪</div>
            )}
          </AnimatePresence>
        </button>

        <div className="min-w-0 flex-1">
          {/* The new song's title in at once (fading in), never waiting on the old one's way out. */}
            <motion.div key={station ? `${currentTrack.id}|${currentTrack.artist}|${currentTrack.title}` : currentTrack?.id||'none'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
              <div className="flex items-center gap-2 min-w-0">
                {currentTrack ? (
                  <button
                    onClick={copyTrackName}
                    onContextMenu={openTrackMenu}
                    title={t('Copy “Artist - Title”')}
                    className="text-lg leading-7 font-medium truncate text-text hover:text-accent transition-colors text-left min-w-0">
                    {currentTrack.title}
                  </button>
                ) : (
                   <p className="text-lg leading-7 font-medium truncate text-text">—</p>
                )}
                {!!currentTrack?.explicit && (
                  <span className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-display uppercase tracking-wide text-muted flex-shrink-0">
                    E
                  </span>
                )}
              </div>
              {currentTrack ? (
                <div className="min-w-0">
                  <button onClick={handleArtistClick} onContextMenu={openTrackMenu}
                    className="text-sm leading-5 text-muted hover:text-accent transition-colors truncate max-w-full block text-left">
                    {currentTrack.artist}
                  </button>
                  {castDevice && (
                    // Casting: where it plays; a click opens the Cast menu.
                    <button onClick={() => window.dispatchEvent(new Event('lokal:open-cast-menu'))}
                      title={t('Playing on {name}', { name: castDevice.name })}
                      className="mt-1 flex max-w-full items-center gap-1 text-[9px] font-display uppercase tracking-wider text-accent hover:opacity-80">
                      <Cast size={10} className="flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{t('Playing on {name}', { name: castDevice.name })}</span>
                    </button>
                  )}
                </div>
              ) : <p className="text-sm leading-5 text-muted">{t('No track playing')}</p>}
            </motion.div>
        </div>

        {streamed && <SaveToLibraryButton key={currentTrack.id} track={currentTrack} className="text-text/90" />}
        </div>

        <div className="flex flex-[0_1_40rem] flex-col items-center gap-1.5 min-w-0">
        <div className="relative flex items-center gap-4">
          {/* Beside the buttons (not over the seek bar), without moving them. */}
          <MixingMark className="absolute left-full top-1/2 ml-4 -translate-y-1/2 whitespace-nowrap pointer-events-none" />
          <button onClick={toggleShuffle} className={`transition-colors ${shuffle ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={shuffle ? t("Shuffle on") : t("Shuffle off")}><Shuffle size={15} /></button>
          <button onClick={prev} className="text-text/90 hover:text-text transition-colors" title={t("Previous")}><SkipBack size={18} fill="currentColor" /></button>
          <motion.button onClick={togglePlay} disabled={!currentTrack} whileTap={{ scale: 0.88 }}
            className={`w-[45px] h-[45px] rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-40 ${flowPlaying ? 'flow-play' : 'bg-accent text-base'}`}>
            {isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </motion.button>
          <button onClick={next} className="text-text/90 hover:text-text transition-colors" title={t("Next")}><SkipForward size={18} fill="currentColor" /></button>
          <button onClick={toggleRepeat} className={`transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={t(repeat === 'none' ? 'Repeat off' : repeat === 'one' ? 'Repeat one' : 'Repeat all')}><RepeatIcon size={15} /></button>
        </div>
        <div className="relative flex items-center gap-2 w-full max-w-[36rem]">
          {/* Glass: a soft, blurred shade under the times and the seek bar, so
              they stay readable over light pages behind the bar. */}
          {glass && shadeTransparency < 100 && (
            <div aria-hidden className="pointer-events-none absolute -inset-x-3 rounded-full"
              style={{ backgroundColor: `rgb(var(--surface-rgb) / ${(1 - shadeTransparency / 100).toFixed(2)})`, filter: 'blur(10px)', top: 1, height: 12 }} />
          )}
          <span className="relative text-xs text-[#e5e5e5] [[data-theme=light]_&]:text-muted w-8 text-right font-display">{station && !duration ? '' : fmt(display)}</span>
          {/* The unplayed part in the theme's text colour, toned down to grey. */}
          <div className={`flex-1 h-1 bg-text/25 rounded-full group relative overflow-hidden ${station ? '' : 'cursor-pointer'}`}
            onWheel={station ? undefined : onSeekWheel}
            onMouseMove={handleScrub}
            onMouseDown={e => { scrubbing.current = true; handleScrub(e) }}
            onMouseUp={() => { scrubbing.current = false; setLocalProg(null) }}
            onMouseLeave={() => { if (!scrubbing.current) setLocalProg(null) }}>
            <div className="h-full bg-accent rounded-full relative" style={{ width: `${duration ? (display/duration)*100 : 0}%` }}>
              {!station && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />}
            </div>
            {isBuffering && (streamed || station) && (
              <div role="progressbar" aria-label={t("Loading track")} className="absolute inset-0 overflow-hidden rounded-full bg-elevated">
                <div className="queue-loading-seekbar h-full w-1/3 rounded-full bg-accent" />
              </div>
            )}
          </div>
          {station && !duration
            ? <span className="relative text-[10px] text-accent w-8 font-display uppercase tracking-wider">{t('On air')}</span>
            : <span className="relative text-xs text-[#e5e5e5] [[data-theme=light]_&]:text-muted w-8 font-display">{fmt(duration)}</span>}
        </div>
        </div>

        <div className="flex flex-1 items-center gap-2 min-w-0 justify-end">
          {currentTrack && showWaveform && (
            <div className="min-w-0 shrink basis-[120px] overflow-hidden">
              <Waveform isPlaying={isPlaying} className="w-full" />
            </div>
          )}
          {/* Online radio: which station. */}
          {station && (
            <span title={t('Online radio: {station}', { station: currentTrack.station?.title || currentTrack.album })}
              className="flex-shrink min-w-0 max-w-[10rem] truncate whitespace-nowrap rounded-md border border-accent px-2 py-0.5 text-[10px] font-display uppercase tracking-wider text-accent">
              {currentTrack.station?.title || currentTrack.album}
            </span>
          )}
          {/* Where the song plays from, when it isn't a file in the library. */}
          {streamed && (
            <span title={t('Streaming from {source}, not in your library', { source: streamLabel(currentTrack) })}
              className="flex-shrink-0 whitespace-nowrap rounded-md border border-accent px-2 py-0.5 text-[10px] font-display uppercase tracking-wider text-accent">
              {streamLabel(currentTrack)}
            </span>
          )}
          <button onClick={toggleRightSidebar} className={`transition-colors ${showRightSidebar ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={t("Now Playing")}>< PanelRight size={16} /></button>
          <button onClick={toggleFullscreen} disabled={!currentTrack} className="text-text/90 hover:text-text transition-colors disabled:opacity-30" title={t("Fullscreen")}><Maximize2 size={15} /></button>
          
          <div className="flex items-center gap-1.5 ml-1">
            <button onClick={() => changeVolume(volume > 0 ? 0 : 80)} className="text-text/90 hover:text-text transition-colors" title={`${Math.round(volume * 100)}%`}>
              {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <div className="relative flex items-center">
              <input type="range" min={0} max={100} step={1} value={Math.round(volume * 100)}
                onChange={e => changeVolume(Number(e.target.value))}
                aria-label={t('Volume')} aria-valuetext={`${Math.round(volume * 100)}%`}
                className="w-18 accent-accent cursor-pointer h-1" style={{ width: 72 }} />
              <span aria-hidden="true"
                className={`pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-elevated px-[9px] py-[3px] text-[15px] leading-tight font-display text-text shadow-lg transition-opacity duration-150 ${volumeTip ? 'opacity-100' : 'opacity-0'}`}
                style={{ left: `${Math.round(volume * 100) * 0.72 * 0.86 + 72 * 0.07}px` }}>
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <ContextMenu menu={menu} />
    </>
  )
}
