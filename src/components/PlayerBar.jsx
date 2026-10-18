import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, PanelRight, Maximize2, Radio, Gem, Cast, Clock, ListEnd, Download, Disc3, Edit2, Camera, FolderOpen, ExternalLink, Link2, Clapperboard } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useTranslation } from '../i18n'
import ExplicitBadge from './ExplicitBadge'
import { navigateToTrackAlbum } from '../playbackContext'
import ArtistNames from './ArtistNames'
import Waveform from '../visualizers/Waveform'
import Spectrum from '../visualizers/Spectrum'
import Waves from '../visualizers/Waves'
import Lightning from '../visualizers/Lightning'
import { showToast, showLoadingToast } from './Toaster'
import TrackEditModal from './TrackEditModal'
import { addToQueueMany, playNextMany } from '../trackActions'
import { TRACK_SEARCH_SITES, clipLink, commentLink, openLink, trackSearchText, trackSearchUrl } from '../trackLinks'
import { announceTrackChanged } from '../trackChanged'
import { useAppearanceFlag, useAppearanceText, useAppearanceValue, usePlayerVisualizer } from '../appearanceFlags'
import CoverGradient from './CoverGradient'
import { meshKeyFor } from './ArtworkBackdrop'
import { trackArtURL, isStreamed, streamLabel, saveTracksToLibrary, libraryDownloadMessage } from '../onlineTracks'
import { isStationTrack } from '../radio/stations'
import SaveToLibraryButton from './SaveToLibraryButton'
import { TIERS, formatLabel, isSuspect, tierOf, losslessMenuItem } from '../quality'
import MixingMark from './MixingMark'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { openRadio } from '../radioActions'
import { useCastStore } from '../cast/castStore'
import { useCoverDrop } from './CoverDrop'
import { trackFolderItems } from '../trackFolderItem'

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
  // Settings > Visualizations > Player Bar > Visualization: bars beside the
  // volume (waveform), a spectrum or waves under the seek bar, lightning
  // across the whole bar, or none.
  const visualizer = usePlayerVisualizer()
  const showWaveform = visualizer === 'waveform'
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)))
  const spectrum = {
    bars: clamp(useAppearanceValue('player_spectrum_bars', 119), 8, 160),
    barWidth: clamp(useAppearanceValue('player_spectrum_bar_width', 4), 1, 12),
    height: clamp(useAppearanceValue('player_spectrum_height', 76), 10, 90),
    strength: clamp(useAppearanceValue('player_spectrum_strength', 58), 10, 300) / 100,
    opacity: clamp(useAppearanceValue('player_spectrum_opacity', 20), 5, 100) / 100,
    radius: clamp(useAppearanceValue('player_spectrum_radius', 0), 0, 6),
  }
  const spectrumColor = useAppearanceText('player_spectrum_color')
  // Spectrum from the center: the same settings, kept apart from the other one's.
  const centerSpectrumSettings = {
    bars: clamp(useAppearanceValue('player_center_spectrum_bars', 119), 8, 160),
    barWidth: clamp(useAppearanceValue('player_center_spectrum_bar_width', 4), 1, 12),
    height: clamp(useAppearanceValue('player_center_spectrum_height', 30), 10, 90),
    strength: clamp(useAppearanceValue('player_center_spectrum_strength', 58), 10, 300) / 100,
    opacity: clamp(useAppearanceValue('player_center_spectrum_opacity', 20), 5, 100) / 100,
    radius: clamp(useAppearanceValue('player_center_spectrum_radius', 2), 0, 6),
  }
  const centerSpectrumColor = useAppearanceText('player_center_spectrum_color')
  const waves = {
    width: clamp(useAppearanceValue('player_waves_width', 480), 120, 1200),
    height: clamp(useAppearanceValue('player_waves_height', 50), 10, 90),
    strength: clamp(useAppearanceValue('player_waves_strength', 100), 10, 300) / 100,
    opacity: clamp(useAppearanceValue('player_waves_opacity', 85), 5, 100) / 100,
    colorBack: useAppearanceText('player_waves_color_back'),
    colorFront: useAppearanceText('player_waves_color_front'),
  }
  const lightningColors = [useAppearanceText('player_lightning_color_1'), useAppearanceText('player_lightning_color_2'), useAppearanceText('player_lightning_color_3')]
  const lightning = {
    strength: clamp(useAppearanceValue('player_lightning_strength', 150), 10, 300) / 100,
    opacity: clamp(useAppearanceValue('player_lightning_opacity', 10), 5, 100) / 100,
  }
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
  // Spectrum from the center: its middle line runs through the playback
  // buttons' middle (measured: the seek bar under them moves it off the
  // column's centre).
  const controlsRef = useRef(null)
  const [controlsMid, setControlsMid] = useState(null)
  const centerSpectrum = visualizer === 'spectrumCenter' && !!currentTrack
  useLayoutEffect(() => {
    const row = controlsRef.current
    if (!centerSpectrum || !row || typeof ResizeObserver === 'undefined') return undefined
    const update = () => setControlsMid(row.offsetTop + row.offsetHeight / 2)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row.parentElement || row)
    return () => observer.disconnect()
  }, [centerSpectrum])
  const { user, openAddToPlaylist } = useAppStore()
  const [likeAnim, setLikeAnim] = useState(false)
  const scrubbing = useRef(false)
  const [localProg, setLocalProg] = useState(null)
  const menu = useContextMenu()
  const display = localProg ?? progress
  const isLiked = currentTrack && likedIds.has(currentTrack.id)
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat


  const scrubAt = useCallback((bar, clientX) => {
    if (!duration || isStationTrack(usePlayerStore.getState().currentTrack)) return
    const r = bar.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
    setLocalProg(t)
    // Through the store: it seeks the playing element, or the TV while casting.
    if (scrubbing.current) usePlayerStore.getState().setProgressWithAudioUpdate(t)
  }, [duration])
  const handleScrub = useCallback((e) => { if (!scrubbing.current) scrubAt(e.currentTarget, e.clientX) }, [scrubAt])
  // A drag follows the mouse anywhere in the window and ends wherever the
  // button is let go (also off the bar), so hovering later never seeks.
  const endScrub = useRef(null)
  const startScrub = useCallback((e) => {
    if (e.button !== 0) return
    const bar = e.currentTarget
    endScrub.current?.()
    scrubbing.current = true
    scrubAt(bar, e.clientX)
    const move = ev => scrubAt(bar, ev.clientX)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
      endScrub.current = null
      scrubbing.current = false
      setLocalProg(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
    endScrub.current = up
  }, [scrubAt])
  useEffect(() => () => endScrub.current?.(), [])

  const toggleLike = async () => {
    if (!currentTrack) return
    const r = await api.toggleLike(currentTrack.id, user?.id, currentTrack)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(currentTrack.id, liked)
    if (liked) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 600) }
  }

  const artSrc = trackArtURL(currentTrack)
  // A .jpg/.png dropped on the cover replaces it, inside the song's file.
  const coverDrop = useCoverDrop(currentTrack)

  // An online song (YouTube, SoundCloud): label, and a button to save it.
  const streamed = isStreamed(currentTrack)
  // An online radio station: live, nothing to seek; its song's length only
  // when the station's API said.
  const station = isStationTrack(currentTrack)


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

  // Edit info from the bar's menu (as from a song's row).
  const [editingTrack, setEditingTrack] = useState(null)
  const saveToLibrary = async (track) => {
    const toast = showLoadingToast(t('Preparing downloads…'))
    try {
      const result = await saveTracksToLibrary([track], { onProgress: message => toast.update(message) })
      toast.close(libraryDownloadMessage(result))
    } catch { toast.close(t('Could not download the selected songs.')) }
  }
  // The picture (.jpg/.png) goes into the song's file too (electron/trackCover.js).
  const replaceArtwork = async (track) => {
    const fp = await api.openFile([{ name: t('Images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    try {
      const dataUrl = await api.readFileAsDataURL(fp)
      if (!dataUrl) throw new Error(t('Could not read the picture'))
      const updated = await api.trackSetArtwork(track.id, dataUrl)
      if (updated?.error) throw new Error(updated.error)
      if (updated?.id) { usePlayerStore.getState().syncTrack(updated); announceTrackChanged(updated.id) }
      showToast(t('Cover saved into the file'))
    } catch (err) {
      showToast(t("Couldn't set the cover: {error}", { error: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
    }
  }

  // A right click anywhere on the bar: the playing song's menu, as on its row
  // in a list, without removing or deleting it.
  const openTrackMenu = (event) => {
    if (!currentTrack || station) return
    const track = currentTrack
    const ghost = !track.file_path || track.missing
    menu.open(event, [
      ...trackFolderItems(track, t),
      { label: isPlaying ? t('Pause') : t('Play'), icon: isPlaying ? Pause : Play, onSelect: togglePlay },
      { label: t('Play next'), icon: Clock, onSelect: () => playNextMany([track]) },
      { label: t('Add to queue'), icon: ListEnd, onSelect: () => addToQueueMany([track]) },
      { label: t('Start radio'), icon: Radio, onSelect: () => openRadio(nav, track, user?.id) },
      track.artist && { label: t('Start artist radio'), icon: Radio, onSelect: () => openRadio(nav, { artist: track.artist, type: 'artist' }, user?.id) },
      losslessMenuItem(track, Gem),
      isStreamed(track) && { label: t('Save to library'), icon: Download, onSelect: () => saveToLibrary(track) },
      { separator: true },
      track.album && { label: t('Go to album'), icon: Disc3, onSelect: () => navigateToTrackAlbum(nav, track) },
      { label: t('Edit info'), icon: Edit2, onSelect: () => setEditingTrack(track) },
      api.isElectron && { label: t('Replace artwork'), icon: Camera, onSelect: () => replaceArtwork(track) },
      !ghost && !isStreamed(track) && api.isElectron && { label: t('Show in Explorer'), icon: FolderOpen, onSelect: () => api.showItemInFolder(track.file_path) },
      { separator: true },
      ...(trackSearchText(track) ? TRACK_SEARCH_SITES.map(site => ({ label: t(site.label), icon: ExternalLink, onSelect: () => openLink(trackSearchUrl(site, track)) })) : []),
      commentLink(track) && { label: t('Open comment'), icon: Link2, onSelect: () => openLink(commentLink(track)) },
      clipLink(track) && { label: t('Open music video'), icon: Clapperboard, onSelect: () => openLink(clipLink(track)) },
    ].filter(Boolean).filter((item, index, all) => !(item.separator && (index === 0 || index === all.length - 1 || all[index - 1]?.separator))))
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
        onWheel={onBarWheel}
        onContextMenu={openTrackMenu}>
        {showGradient && <CoverGradient trackId={meshKeyFor(currentTrack)} strength={gradientStrength} speed={gradientSpeed} rounded={floating} />}
        {currentTrack && visualizer === 'lightning' && (
          <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${floating ? 'rounded-2xl' : ''}`}>
            <Lightning isPlaying={isPlaying} colors={lightningColors} {...lightning} />
          </div>
        )}
        <div ref={infoRef} className="relative flex flex-1 items-center gap-3 min-w-0">
        <button onClick={toggleFullscreen} disabled={!currentTrack} {...coverDrop.dropProps}
          className={`relative w-[70px] h-[70px] my-[10px] rounded-md overflow-hidden flex-shrink-0 bg-elevated hover:ring-2 ring-accent/30 transition-all disabled:cursor-default ${coverDrop.over ? 'ring-2 ring-accent' : ''}`}>
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
          {coverDrop.over && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] font-medium text-white">{t('Drop cover')}</div>
          )}
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
                {!!currentTrack?.explicit && <ExplicitBadge />}
              </div>
              {currentTrack ? (
                <div className="min-w-0">
                  <ArtistNames track={currentTrack} disabled={station} onContextMenu={openTrackMenu}
                    className="text-sm leading-5 text-muted truncate max-w-full block text-left" />
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

        {/* Full height, so the spectrum can stand on the bar's bottom edge. */}
        <div className="relative flex flex-[0_1_40rem] flex-col items-center justify-center gap-1.5 min-w-0 self-stretch">
        {currentTrack && visualizer === 'spectrum' && (
          <Spectrum isPlaying={isPlaying} {...spectrum}
            color={spectrumColor}
            className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2" />
        )}
        {currentTrack && visualizer === 'waves' && (
          <Waves isPlaying={isPlaying} {...waves} className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2" />
        )}
        {/* Kept inside the bar's height (clipped above and below), under the buttons. */}
        {centerSpectrum && controlsMid != null && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ overflowY: 'clip' }}>
            <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: controlsMid }}>
              <Spectrum isPlaying={isPlaying} {...centerSpectrumSettings} mirrored color={centerSpectrumColor} />
            </div>
          </div>
        )}
        <div ref={controlsRef} className="relative flex items-center gap-4">
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
            onMouseDown={startScrub}
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
      <TrackEditModal
        track={editingTrack}
        open={!!editingTrack}
        onClose={() => setEditingTrack(null)}
        onSave={(updated) => {
          if (!updated?.id) return
          usePlayerStore.getState().syncTrack(updated)
          setEditingTrack(updated)
          announceTrackChanged(updated.id)
        }}
      />
      {coverDrop.dialog}
    </>
  )
}
