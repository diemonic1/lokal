// The Recap page's Stories: a full-screen, story-style walk through a recap.
//
// - Rendered into <body> (a portal), so no page transform or scroll box can
//   size or place it, and the rest of the app is inert while it's open.
// - A 9:16 card that fits the window whatever its size: its type is sized in
//   container units (cqw), so every slide fits without scrolling.
// - Slides turn only when asked (a tap, the arrows, the keyboard); the card's
//   corner says which one of how many it is.
// - Each slide plays one of its songs (or the top station), from its big
//   moment when AutoMix's analysis finds one (desktop). The card's foot always
//   shows what's playing, with play/pause and the app's volume; pausing there
//   keeps the next slides quiet until it's played again.
// - Closing it (X, Escape) pauses the soundtrack; Share opens its dialog over
//   the Stories, which go on behind it.
// - Names (tracks, artists, genres, stations) are written as their tags have them.
// - Around the card, the colour splashes move with the music (Settings > Appearance >
//   Stories), over the blurred cover or the splashes' own colour. The card keeps its own
//   copy of the cover behind it, so it looks the same either way; neither is in the
//   share picture (the card only, without its backdrop).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Disc3, Moon, Pause, Play, Radio, Share2, Sun, Sunrise, Sunset, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { useRadioStore } from '../store/radio'
import { RADIO_CONTEXT, stationTrack } from '../radio/stations'
import { api } from '../api'
import { setResumePosition } from '../cast/useCastPlayback'
import { plural } from '../plural'
import { translate, useTranslation } from '../i18n'
import { periodTitle } from '../recapPeriods'
import { daysText, filteredGenres, fmtDate, fmtHour, fmtMinutes, sessionDescription, sessionLabel, trackArt } from '../recapText'
import { coversOf, openShareCard, trackArtSource } from '../shareCard'
import { useAppearanceSettings, useAppearanceText, useStoriesBackground, useStoriesCardVisuals } from '../appearanceFlags'
import SlideScene from './SlideScene'
import { sceneClock, sceneFor } from '../visualizers/slideScenes'
import Splashes from '../visualizers/Splashes'
import { readSplashSettings } from '../visualizers/splashSettings'
import { pickColor } from '../visualizers/audio'
import { useFullCover } from '../fullCover'

// How long a slide's song waits for its analysis (to start at its highlight)
// before it plays from the top anyway.
const ANALYSIS_WAIT_MS = 2000
// The card: 9:16, as tall as the window allows below the controls, and never
// wider than the window minus the side arrows.
const CARD_HEIGHT = 'min(calc(100dvh - 6.5rem), calc((100vw - 14rem) * 16 / 9))'
const CARD_WIDTH = `calc(${CARD_HEIGHT} * 9 / 16)`
// Behind a slide with no cover (the radio's): colour instead of black.
const COLOR_BACKDROP = 'radial-gradient(60% 55% at 15% 20%, rgb(var(--accent-rgb) / 0.75), transparent 70%), radial-gradient(55% 50% at 85% 25%, rgb(236 72 153 / 0.6), transparent 70%), radial-gradient(70% 60% at 50% 95%, rgb(56 189 248 / 0.55), transparent 70%), linear-gradient(160deg, #1e1b4b, #0f172a)'

/** "11 pm": short enough for a headline. */
function shortHour(hour) {
  const n = Number(hour)
  // {hour24}: a 24-hour clock for the languages that use one.
  return translate('{hour} {suffix}', { hour: n % 12 || 12, suffix: n < 12 ? 'am' : 'pm', hour24: n })
}

// Parts of the day, as the "when you listen" slide splits them (to: the hour it ends at).
const DAYPARTS = [
  { key: 'morning', from: 5, to: 12, icon: Sunrise, label: 'Morning', persona: 'early riser' },
  { key: 'day', from: 12, to: 17, icon: Sun, label: 'Day', persona: 'daytime explorer' },
  { key: 'evening', from: 17, to: 22, icon: Sunset, label: 'Evening', persona: 'evening dreamer' },
  { key: 'night', from: 22, to: 5, icon: Moon, label: 'Night', persona: 'night owl' },
]

/** Plays in each part of the day (from the 24 hours), and the part with the most. */
function dayparts(hours) {
  const parts = DAYPARTS.map(part => {
    let plays = 0
    for (let hour = part.from; hour !== part.to; hour = (hour + 1) % 24) plays += Number(hours?.[hour]) || 0
    return { ...part, plays }
  })
  const top = parts.reduce((best, part) => (part.plays > best.plays ? part : best), parts[0])
  return { parts, top: top.plays ? top : null }
}

/** Minutes from seconds, as the slides write them ("12 min", "1h 4m"). */
const secondsText = (seconds) => fmtMinutes(Math.round((Number(seconds) || 0) / 60))

/** A track's genres, lower case, as the backend splits them (electron/ipc/recaps.js). */
const trackGenres = (track) => String(track?.genres || track?.genre || '').split(/[\\/;,|]/).map(part => part.trim().toLowerCase()).filter(Boolean)

/** A headline without its full stop (names read better bare); an ellipsis stays. */
const bare = (text) => String(text || '').replace(/(^|[^.])\.$/, '$1')

/**
 * The slides a recap has something to say in (no "nothing here yet" slides),
 * each with the song (or station) playing under it. The songs don't repeat
 * from one subject to the next: #1 on the first two, #2 on the top 5 and
 * the artist count, a song of the top artist and of the second one, one of
 * the top genres, the radio, then #3 for the last two. `libraryOf` (artist
 * -> their library songs) gives an artist a song not played yet when their
 * recap songs all are.
 */
function buildSlides(recap, period, libraryOf = {}) {
  const topGenres = filteredGenres(recap?.topGenres || [])
  const topArtists = recap?.topArtists || []
  const topTracks = recap?.topTracks || []
  const topTrack = topTracks[0]
  // The nth top track, else the top one.
  const nth = (n) => topTracks[n - 1] || topTrack
  // Songs already given to a slide (and #3, kept for the last ones).
  const used = new Set([nth(1)?.id, nth(2)?.id, nth(3)?.id].filter(Boolean))
  const fresh = (candidates, fallback) => {
    const track = candidates.find(item => item?.id && !used.has(item.id)) || fallback || topTrack
    if (track?.id) used.add(track.id)
    return track
  }
  // An artist's songs: their most played in the recap first, then the rest of their library.
  const artistSongs = (name) => [...topTracks.filter(track => track.artist === name), ...(libraryOf[name] || [])]
  const slides = [{
    key: 'overview',
    // The period is over the card already.
    eyebrow: translate('in all, you listened to'),
    title: translate('{time} of music.', { time: fmtMinutes(recap?.totalMinutes || 0) }),
    track: topTrack,
  }]
  if (topTrack) slides.push({
    key: 'track',
    eyebrow: translate('your #1 track'),
    title: String(topTrack.title || ''),
    body: String(topTrack.artist || ''),
    track: topTrack,
  })
  if (topTracks.length > 1) slides.push({
    key: 'tracks',
    eyebrow: translate('top tracks'),
    title: translate('the songs you had on repeat.'),
    body: translate('{n} different tracks in all.', { n: (recap?.uniqueTracks || topTracks.length).toLocaleString() }),
    track: nth(2),
    tracks: topTracks.slice(0, 5),
  })
  const topArtist = topArtists[0]
  if (topArtist) slides.push({
    key: 'artist',
    eyebrow: translate('top artist'),
    title: translate('your favorite artist was {artist}.', { artist: topArtist.artist }),
    body: translate('{plays}, {time} together.', { plays: plural(topArtist.plays, 'play'), time: secondsText(topArtist.seconds) }),
    track: fresh(artistSongs(topArtist.artist), artistSongs(topArtist.artist)[0]),
    artist: topArtist,
  })
  if (topArtists.length > 1) slides.push({
    key: 'artists',
    eyebrow: translate('top artists'),
    title: translate('your favorite artists.'),
    body: translate('{n} different artists listened to in all.', { n: (recap?.uniqueArtists || topArtists.length).toLocaleString() }),
    track: fresh(artistSongs(topArtists[1].artist), artistSongs(topArtists[1].artist)[0]),
    artists: topArtists.slice(0, 5),
  })
  // A song of the top genres (the first one first) no slide plays, else any one no slide plays.
  if (topGenres[0]) slides.push({
    key: 'genre',
    eyebrow: translate('genre check'),
    title: translate('out of every genre, {genre} won.', { genre: topGenres[0].genre }),
    body: translate('your top genres:'),
    genres: topGenres.slice(0, 5),
    track: fresh([...topGenres.slice(0, 5).flatMap(genre => topTracks.filter(track => trackGenres(track).includes(genre.genre.toLowerCase()))), ...topTracks], nth(4)),
  })
  const stations = recap?.topStations || []
  if (stations.length) slides.push({
    key: 'stations',
    eyebrow: translate('on the radio'),
    title: translate('you tuned in for {time}.', { time: fmtMinutes(recap.radioMinutes || 0) }),
    body: translate('mostly to {station}.', { station: stations[0].station }),
    station: stations[0],
    stations: stations.slice(0, 5),
  })
  // The longest session: one of its songs no slide plays (not #3 either, kept for the next two).
  const session = recap?.longestSession
  if (session?.tracks?.length) slides.push({
    key: 'session',
    eyebrow: translate('the longest session'),
    title: translate('{time} in one go.', { time: fmtMinutes(session.durationMinutes) }),
    body: `${sessionLabel(session)} · ${fmtDate(session.start)}`,
    track: fresh(session.tracks, session.tracks[0]),
    session,
  })
  if (recap?.addedCount > 0) slides.push({
    key: 'added',
    eyebrow: translate('new in your library'),
    title: translate('{tracks} joined your library.', { tracks: plural(recap.addedCount, 'track') }),
    body: translate('fresh finds for the collection.'),
    track: nth(3),
    added: (recap.addedTracks || []).slice(0, 4),
  })
  const parts = dayparts(recap?.hours)
  if (recap?.peakHour?.plays && parts.top) slides.push({
    key: 'hour',
    eyebrow: translate('when you listen'),
    title: translate(`${parts.top.persona}.`),
    body: translate('most of your music played from {from} to {to}; your favorite hour was {hour}.', { from: shortHour(parts.top.from), to: shortHour(parts.top.to), hour: shortHour(recap.peakHour.hour) }),
    track: nth(3),
    parts,
  })
  // No full stops after names (nor anywhere else). A long name (track,
  // artist) makes a long headline: smaller type and a smaller picture keep
  // the slide inside the card.
  return slides.map(slide => ({ ...slide, title: bare(slide.title), body: bare(slide.body), long: slide.title.length > 55 }))
}

/** A slide as a share card (shareCard.js): its name and number, headline, the period's numbers and the slide's list. */
function slideShareSpec(slide, recap, period, number, total) {
  const topTracks = recap?.topTracks || []
  const topArtists = recap?.topArtists || []
  const title = slide.title
  const list = slide.key === 'tracks' || slide.key === 'track'
    ? { title: 'Top tracks', items: topTracks.slice(0, 5).map(track => [track.title, track.artist]) }
    : slide.key === 'hour'
      ? { title: 'When you listen', items: slide.parts.parts.map(part => [translate(part.label), plural(part.plays, 'play')]) }
      : slide.key === 'genre'
        ? { title: 'Genres', items: slide.genres.map(genre => [genre.genre, plural(genre.plays, 'play')]) }
        : slide.key === 'stations'
          ? { title: 'Favorite stations', items: slide.stations.map(item => [item.station, secondsText(item.seconds)]) }
          : slide.key === 'added'
            ? { title: 'New in your library', items: slide.added.map(track => [track.title, track.artist]) }
            : topArtists.length
              ? { title: 'Top artists', items: topArtists.slice(0, 5).map(artist => [artist.artist, secondsText(artist.seconds)]) }
              : { title: 'Top tracks', items: topTracks.slice(0, 5).map(track => [track.title, track.artist]) }
  const art = slide.key === 'track' ? coversOf([slide.track], 1)
    : slide.key === 'artist' ? coversOf(topTracks.filter(track => track.artist === topArtists[0]?.artist), 1)
      : slide.key === 'added' ? coversOf(slide.added, 4)
        : coversOf(topTracks, 4)
  return {
    kind: 'Recap',
    label: slide.eyebrow,
    counter: `${number} / ${total}`,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    subtitle: period ? periodTitle(period) : translate('My recap'),
    art: art.length ? art : coversOf(topTracks, 4),
    stats: [['Listened', fmtMinutes(recap?.totalMinutes || 0)], ['Plays', (recap?.totalPlays || 0).toLocaleString()], ['Tracks', (recap?.uniqueTracks || 0).toLocaleString()], ['Artists', (recap?.uniqueArtists || 0).toLocaleString()]],
    list,
    fileName: `${translate('Recap')} ${period ? periodTitle(period) : ''}`.trim(),
  }
}

export default function RecapStory({ open, recap, ...props }) {
  return createPortal(
    <AnimatePresence>
      {open && recap && <StoryViewer key="recap-story" recap={recap} {...props} />}
    </AnimatePresence>,
    document.body,
  )
}

function StoryViewer({ onClose, recap, period }) {
  const { t, language } = useTranslation()
  const reduceMotion = useReducedMotion()
  // The top two artists' library songs, for a song of theirs no other slide plays.
  const [libraryOf, setLibraryOf] = useState({})
  useEffect(() => {
    let alive = true
    for (const { artist } of (recap?.topArtists || []).slice(0, 2)) {
      Promise.resolve(api.getTracks({ artistName: artist, limit: 200 })).then(list => {
        if (!alive || !Array.isArray(list)) return
        const songs = list.filter(track => !String(track.file_path || '').startsWith('ghost://'))
        // Shuffled, so a replay of the story can bring another one.
        for (let i = songs.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [songs[i], songs[j]] = [songs[j], songs[i]] }
        setLibraryOf(current => ({ ...current, [artist]: songs }))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [recap])
  const slides = useMemo(() => buildSlides(recap, period, libraryOf), [recap, period, libraryOf, language]) // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0)
  // Off once the soundtrack is paused (the card's foot): the next slides stay quiet until it's played again.
  const [sound, setSound] = useState(true)
  const playQueue = usePlayerStore(state => state.playQueue)
  const playTrack = usePlayerStore(state => state.playTrack)
  const radioCatalog = useRadioStore(state => state.catalog)
  const initRadio = useRadioStore(state => state.init)
  useEffect(() => { initRadio() }, [initRadio])
  // Closed: the story's soundtrack stops with it.
  const closeStory = useCallback(() => {
    const player = usePlayerStore.getState()
    if (sound && player.isPlaying) player.togglePlay()
    onClose()
  }, [sound, onClose])
  const last = slides.length - 1
  const slide = slides[Math.min(index, last)]
  const topTracks = recap?.topTracks || []
  const dialogRef = useRef(null)
  const cardRef = useRef(null)
  const press = useRef(null)

  const go = useCallback((step) => setIndex(value => Math.max(0, Math.min(value + step, last))), [last])

  // The rest of the app can't be reached (Tab, screen readers) while it's open;
  // focus goes back where it was on close. The story itself takes focus (not
  // Close, which Space or Enter would then press).
  useEffect(() => {
    const before = document.activeElement
    const root = document.getElementById('root')
    if (root) root.inert = true
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      if (root) root.inert = false
      before?.focus?.({ preventScroll: true })
    }
  }, [])

  // The top station as something to play: the catalog's own, else as the history saved it.
  const stationOf = useCallback((item) => {
    if (!item) return null
    const station = radioCatalog?.stations?.find(entry => entry.title.toLowerCase() === item.station.toLowerCase())
      || (item.url ? { id: item.id || item.url, title: item.station, url: item.url } : null)
    return station ? stationTrack(station, radioCatalog?.title || '') : null
  }, [radioCatalog])

  // Each slide song's analysis (its highlight), asked for up front so it's
  // ready by the time its slide comes.
  const analyses = useRef(new Map())
  const analysisOf = useCallback((track) => {
    if (!analyses.current.has(track.id)) analyses.current.set(track.id, Promise.resolve(api.automixAnalyze(track)).catch(() => null))
    return analyses.current.get(track.id)
  }, [])
  useEffect(() => {
    for (const item of slides) if (item.track?.id) analysisOf(item.track)
  }, [slides, analysisOf])

  // The slide's song (or station), from its highlight; one the Stories
  // already play is only resumed. Returns a cancel for a start still waiting
  // on its analysis. What the Stories play is marked (recapStory): it isn't
  // listening, so it never goes into the history (App.jsx flushTime), and
  // the same song playing before the Stories starts again as theirs.
  const playSlide = useCallback(() => {
    const source = slide.station ? stationOf(slide.station) : slide.track
    if (!source?.id) return undefined
    const track = { ...source, recapStory: true }
    const { currentTrack, isPlaying, togglePlay } = usePlayerStore.getState()
    if (currentTrack?.id === track.id && currentTrack.recapStory) {
      if (!isPlaying) togglePlay()
      return undefined
    }
    if (slide.station) {
      playTrack(track, [track], { type: RADIO_CONTEXT, name: radioCatalog?.title || translate('Online Radio') })
      return undefined
    }
    let cancelled = false
    const timeout = new Promise(resolve => setTimeout(resolve, ANALYSIS_WAIT_MS, null))
    Promise.race([analysisOf(track), timeout]).then(analysis => {
      if (cancelled) return
      const at = Number(analysis?.highlight)
      if (at > 0) setResumePosition(track.id, at)
      playQueue([track], 0)
    })
    return () => { cancelled = true }
  }, [slide, stationOf, playTrack, playQueue, analysisOf, radioCatalog?.title])

  useEffect(() => {
    if (!sound) return undefined
    return playSlide()
  }, [sound, playSlide])

  // Play / pause (the card's foot, Space): pausing turns the soundtrack off.
  const togglePlayback = useCallback(() => {
    const player = usePlayerStore.getState()
    if (player.isPlaying) { setSound(false); player.togglePlay() }
    else if (!sound) setSound(true)
    else playSlide()
  }, [sound, playSlide])

  // Captured before the app's own shortcuts (arrows seek, Space plays).
  useEffect(() => {
    const onKey = (event) => {
      // The share dialog over the Stories has the keys (Escape closes it, not them).
      if (document.querySelector('[data-share-card]')) return
      const onControl = event.target?.closest?.('button, input')
      if (event.key === 'Escape') closeStory()
      else if (event.key === 'ArrowRight' && !onControl) go(1)
      else if (event.key === 'ArrowLeft' && !onControl) go(-1)
      else if (event.key === ' ' && !onControl) togglePlayback()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, closeStory, togglePlayback])

  // Every cover the story shows, fetched up front so slides don't pop in.
  useEffect(() => {
    const urls = new Set()
    for (const item of slides) {
      if (item.track) urls.add(trackArt(item.track))
      for (const track of [...(item.tracks || []), ...(item.added || [])]) urls.add(trackArt(track))
    }
    for (const url of urls) if (url) { const image = new Image(); image.src = url }
  }, [slides])

  // A tap turns the page (left third: back).
  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest('button, a, input, [data-interactive]')) return
    press.current = { x: event.clientX }
  }
  const endPress = (event, turn) => {
    const current = press.current
    press.current = null
    if (!current || !turn) return
    const rect = event.currentTarget.getBoundingClientRect()
    go(current.x - rect.left < rect.width * 0.3 ? -1 : 1)
  }

  const art = slide.key === 'stations' ? '' : trackArt(slide.track)
  const background = useStoriesBackground()
  // The slide's own moving pictures (Settings > Appearance > Stories, visualizers/slideScenes.js):
  // behind the whole card instead of the cover, or in a box the slide leaves for it.
  const cardVisuals = useStoriesCardVisuals()
  const cardScene = cardVisuals ? sceneFor(slide.key, 'card') : null
  const slotScene = cardVisuals ? sceneFor(slide.key, 'slot') : null
  // Share: where each picture is on the card, and the moment to draw.
  const sceneShots = () => {
    const card = cardRef.current.getBoundingClientRect()
    const time = sceneClock()
    return [...cardRef.current.querySelectorAll('[data-scene]')].map(element => {
      const rect = element.getBoundingClientRect()
      const colors = element.dataset.colors ? JSON.parse(element.dataset.colors) : undefined
      return { kind: element.dataset.scene, time, colors, x: rect.left - card.left, y: rect.top - card.top, w: rect.width, h: rect.height }
    })
  }
  const splashSettings = useAppearanceSettings(readSplashSettings)
  const splashBackground = pickColor(useAppearanceText('side_splash_bg'), '#161616')
  const move = reduceMotion ? 0 : 1

  return (
    <motion.div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t('{name} Stories', { name: period ? periodTitle(period) : t('Recap') })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black text-white outline-none"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {/* Behind the card: the slide's cover, blurred, and/or the colour splashes. */}
      {(!background.visual || background.cover) && <Backdrop art={art} />}
      {background.visual && (
        <div aria-hidden className="absolute inset-0 flex" style={background.cover ? undefined : { background: splashBackground }}>
          <Splashes className="flex-1" settings={splashSettings} style={{ opacity: background.opacity }} />
        </div>
      )}

      <div className="relative flex flex-col items-center gap-3">
        {/* The period, Share and Close, as wide as the card. */}
        <div className="flex items-center gap-2" style={{ width: CARD_WIDTH }}>
          <p className="min-w-0 flex-1 truncate text-[10px] font-display uppercase tracking-[0.24em] text-white/60">
            {t('lokal recap')}{period ? ` · ${periodTitle(period)}` : ''}
          </p>
          {/* The share dialog opens over the Stories, which go on (and play on) behind it; the
              picture is the slide itself as it looks (shareCard.js renderStorySlide). */}
          <StoryButton onClick={() => cardRef.current && openShareCard({ ...slideShareSpec(slide, recap, period, index + 1, slides.length), slide: { card: cardRef.current, cover: slide.key === 'stations' ? null : trackArtSource(slide.track), period: period ? periodTitle(period) : '', scenes: sceneShots() } })} label={t('Share this slide as a picture')}>
            <Share2 size={14} />
          </StoryButton>
          <StoryButton onClick={closeStory} label={t('Close Stories')}>
            <X size={16} />
          </StoryButton>
        </div>

        <div className="flex items-center gap-4">
          <SideArrow label={t('Previous slide')} disabled={index === 0} onClick={() => go(-1)}><ChevronLeft size={34} /></SideArrow>
          <div
            ref={cardRef}
            onPointerDown={onPointerDown}
            onPointerUp={(event) => endPress(event, true)}
            onPointerCancel={(event) => endPress(event, false)}
            onPointerLeave={(event) => endPress(event, false)}
            onContextMenu={(event) => event.preventDefault()}
            className="relative select-none overflow-hidden rounded-[28px] border border-white/10 shadow-2xl"
            style={{ height: CARD_HEIGHT, aspectRatio: '9 / 16', containerType: 'size' }}
          >
            <CardBackdrop card={cardRef} art={art} />
            <AnimatePresence initial={false}>
              {cardScene && (
                <motion.div key={cardScene} data-share-skip aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }} className="pointer-events-none absolute inset-0">
                  <SlideScene kind={cardScene} track={slide.track} className="h-full w-full" />
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={slide.key}
                initial={{ opacity: 0, x: 24 * move }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 * move }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 isolate flex flex-col p-[7cqw] pb-[40cqw] pt-[8cqw]"
              >
                <span className="w-fit max-w-[62cqw] truncate rounded-full border border-white/10 bg-white/5 px-[3cqw] py-[1cqw] font-display text-[2.8cqw] uppercase tracking-widest text-accent/90">
                  {slide.eyebrow}
                </span>
                {slide.lead && <p className="mt-[5cqw] text-[3.9cqw] text-white/60">{slide.lead}</p>}
                <motion.h2
                  initial={{ opacity: 0, y: 14 * move }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08, duration: 0.45 }}
                  className={`${slide.lead ? 'mt-[1.5cqw]' : 'mt-[5cqw]'} line-clamp-4 break-words font-display leading-[1.1] ${slide.long ? 'text-[6.2cqw]' : 'text-[8cqw]'}`}
                >
                  {slide.key === 'overview' ? <NumbersFirst text={slide.title} /> : slide.title}
                </motion.h2>
                {slide.body && (
                  <motion.p
                    initial={{ opacity: 0, y: 10 * move }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.16, duration: 0.45 }}
                    className="mt-[3cqw] line-clamp-3 text-[3.9cqw] italic leading-relaxed text-white/60"
                  >
                    {slide.body}
                  </motion.p>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 16 * move }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.24, duration: 0.5 }}
                  className={slotScene ? '-z-10 mt-[5cqw] flex min-h-0 flex-1 flex-col' : slide.key === 'track' ? 'mb-[8cqw] mt-auto pt-[4cqw]' : 'mt-auto pt-[4cqw]'}
                >
                  <SlideVisual slide={slide} recap={recap} topTracks={topTracks} />
                  {/* With its picture, the slide's numbers go up under the title and the picture fills
                      the rest, edge to edge, down to the top of the player (behind the text if it ever
                      reaches it: this block is below the slide's others). */}
                  {slotScene && <SlideScene kind={slotScene} track={slide.track} className="-mx-[7cqw] -mb-[21cqw] mt-[1cqw] min-h-0 w-[calc(100%+14cqw)] flex-1" />}
                </motion.div>
              </motion.div>
            </AnimatePresence>
            <span className="pointer-events-none absolute right-[7cqw] top-[8cqw] rounded-full border border-white/10 bg-white/5 px-[3cqw] py-[1cqw] font-display text-[2.8cqw] uppercase tracking-widest tabular-nums text-accent/90">
              {index + 1} / {slides.length}
            </span>
            <NowPlaying onToggle={togglePlayback} />
          </div>
          {/* The last slide: Close in place of Next. */}
          {index === last
            ? <SideArrow label={t('Close Stories')} onClick={closeStory}><X size={30} /></SideArrow>
            : <SideArrow label={t('Next slide')} onClick={() => go(1)}><ChevronRight size={34} /></SideArrow>}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{t('Slide {n} of {total}: {title}', { n: index + 1, total: slides.length, title: slide.title })}</p>
    </motion.div>
  )
}

/**
 * The card's foot, on every slide: what's playing right now (a song, or a
 * station and its song), play/pause, and the app's volume in a small pop-up.
 */
function NowPlaying({ onToggle }) {
  const { t } = useTranslation()
  const track = usePlayerStore(state => state.currentTrack)
  const isPlaying = usePlayerStore(state => state.isPlaying)
  const volume = usePlayerStore(state => state.volume)
  const setVolume = usePlayerStore(state => state.setVolume)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const rootRef = useRef(null)
  useEffect(() => {
    if (!volumeOpen) return undefined
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setVolumeOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [volumeOpen])
  const station = track?.kind === 'station'
  const title = station ? (track.song_key ? track.title : track.station?.title || track.title) : track?.title
  const subtitle = station
    ? [track.song_key ? track.artist : '', track.station?.title || t('Online radio')].filter(Boolean).join(' · ')
    : track?.artist
  const VolumeIcon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  return (
    <div ref={rootRef} data-interactive data-share-skip className="absolute inset-x-[4cqw] bottom-[3.5cqw] flex items-center gap-[3cqw]">
      <Cover src={trackArt(track)} className="h-[15cqw] w-[15cqw] flex-shrink-0 rounded-[3cqw] shadow-lg" icon={station ? Radio : Disc3} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[3.6cqw] font-medium">{title || t('Nothing playing')}</p>
        {subtitle && (
          <p className="flex min-w-0 items-center gap-[1.2cqw] text-[3cqw] text-white/60">
            {station && <Radio size={11} className="flex-shrink-0 text-accent" />}
            <span className="truncate">{subtitle}</span>
          </p>
        )}
      </div>
      <CardButton onClick={onToggle} label={isPlaying ? t('Pause') : t('Play')}>
        {isPlaying ? <Pause className="h-[2.9cqw] w-[2.9cqw]" fill="currentColor" /> : <Play className="h-[2.9cqw] w-[2.9cqw] translate-x-[0.3cqw]" fill="currentColor" />}
      </CardButton>
      <CardButton onClick={() => setVolumeOpen(open => !open)} label={t('Volume')} pressed={volumeOpen}>
        <VolumeIcon className="h-[3.1cqw] w-[3.1cqw]" />
      </CardButton>
      <AnimatePresence>
        {volumeOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-[calc(100%+2cqw)] right-0 flex items-center gap-[2.5cqw] rounded-[3.5cqw] border border-white/10 bg-black/80 px-[3.5cqw] py-[2.5cqw] backdrop-blur-md"
          >
            <button onClick={() => setVolume(volume > 0 ? 0 : 1)} aria-label={volume > 0 ? t('Mute') : t('Unmute')} title={volume > 0 ? t('Mute') : t('Unmute')} className="text-white/70 hover:text-white">
              <VolumeIcon size={15} />
            </button>
            <input type="range" min={0} max={1} step={0.01} value={volume} aria-label={t('Volume')}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="w-[36cqw] accent-[rgb(var(--accent-rgb))]" />
            <span className="w-[7cqw] text-right text-[2.8cqw] tabular-nums text-white/60">{Math.round(volume * 100)}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CardButton({ onClick, label, pressed, children }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}
      className="flex h-[7.5cqw] w-[7.5cqw] flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
      {children}
    </button>
  )
}

/** The slide's cover, blurred, over the whole window (colour where there's none), dimmed towards the edges. */
function Backdrop({ art }) {
  return <>
    <AnimatePresence initial={false}>
      <motion.div
        key={art || 'colour'}
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: art ? 0.5 : 0.9 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.8 }}
        className="absolute inset-[-10%] bg-cover bg-center"
        style={art ? { backgroundImage: `url("${art}")`, filter: 'blur(70px) saturate(1.3)' } : { backgroundImage: COLOR_BACKDROP, filter: 'blur(30px)' }}
      />
    </AnimatePresence>
    <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.25),rgba(0,0,0,0.85))]" />
  </>
}

/**
 * The card's own background: the window's [Backdrop] laid where the card is, under a light shade,
 * so the card shows its piece of the blurred cover whatever is drawn around it. Not in the share
 * picture (shareCard.js draws its own backdrop).
 */
function CardBackdrop({ card, art }) {
  const [place, setPlace] = useState(null)
  useEffect(() => {
    const element = card.current
    if (!element) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setPlace({ left: -(rect.left + element.clientLeft), top: -(rect.top + element.clientTop), width: window.innerWidth, height: window.innerHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [card])
  return (
    <div aria-hidden data-share-skip className="pointer-events-none absolute inset-0 overflow-hidden bg-black">
      {place && <div className="absolute overflow-hidden" style={place}><Backdrop art={art} /></div>}
      <div className="absolute inset-0 bg-black/30" />
    </div>
  )
}

/**
 * A headline of numbers ("11 ч 37 мин музыки"): the numbers at full size, the words 2.5 times smaller,
 * each unit right against its number.
 */
function NumbersFirst({ text }) {
  const parts = String(text).replace(/(\d)\s+(?=\p{L})/gu, '$1').split(/(\d[\d\s.,]*\d|\d)/u)
  return parts.map((part, i) => (i % 2 ? part : part && <span key={i} className="text-[0.4em]">{part}</span>))
}

function StoryButton({ onClick, label, children }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 transition-colors hover:bg-white/10 hover:text-white">
      {children}
    </button>
  )
}

function SideArrow({ label, disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-0">
      {children}
    </button>
  )
}

/** A slide's big cover: the song's full-size picture (the thumbnail is blurry this big), the thumbnail until it's read. */
function BigCover({ track, ...props }) {
  const full = useFullCover(track)
  return <Cover src={full || trackArt(track)} {...props} />
}

function Cover({ src, className = '', iconSize = 18, icon: Icon = Disc3, style }) {
  return (
    <div className={`overflow-hidden bg-white/5 ${className}`} style={style}>
      {src
        ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-white/30"><Icon size={iconSize} /></div>}
    </div>
  )
}

/** A numbered row of a top 5: cover, name, what's under it. */
function RankRow({ rank, art, name, sub, aside }) {
  return (
    <div className="flex items-center gap-[3cqw]">
      <span className={`w-[5cqw] flex-shrink-0 font-display text-[4.6cqw] ${rank === 1 ? 'text-accent' : 'text-white/45'}`}>{rank}</span>
      <Cover src={art} className="h-[11cqw] w-[11cqw] flex-shrink-0 rounded-[2.5cqw]" />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-display text-[4cqw] ${rank === 1 ? 'text-white' : 'text-white/80'}`}>{name}</p>
        {sub && <p className="truncate text-[2.9cqw] text-white/45">{sub}</p>}
      </div>
      {aside && <span className="flex-shrink-0 text-[2.7cqw] text-white/40">{aside}</span>}
    </div>
  )
}

function SlideVisual({ slide, recap, topTracks }) {
  const { t } = useTranslation()
  if (slide.key === 'overview') {
    const stats = [
      [recap.totalPlays || 0, t('plays')],
      [recap.uniqueTracks || 0, t('different tracks')],
      [recap.uniqueArtists || 0, t('artists')],
      [recap.activeDays || 0, t('days with music')],
    ]
    // Two by two: the number, its name under it; the right column to the right edge, mirroring the left.
    return (
      <div className="relative z-10 grid grid-cols-2 gap-x-[4cqw] gap-y-[4cqw]">
        {stats.map(([value, label], i) => (
          <div key={label} className={`min-w-0 ${i % 2 ? 'text-right' : ''}`}>
            <div className="font-display text-[11cqw] leading-none">{Number(value).toLocaleString()}</div>
            <div className="-mt-[1cqw] truncate text-[3.4cqw] text-white/50">{label}</div>
          </div>
        ))}
      </div>
    )
  }
  if (slide.key === 'track') {
    return (
      // The cover about the card's middle, the play count well clear of it (and of the tilted card
      // behind it) below.
      <div>
        <div className="relative mx-auto w-[50cqw]">
          <div aria-hidden className="absolute inset-0 translate-x-[3cqw] translate-y-[2cqw] rotate-6 rounded-[5cqw] bg-accent/40" />
          <BigCover track={slide.track} iconSize={30} className="relative aspect-square w-full -rotate-3 rounded-[5cqw] shadow-2xl" />
        </div>
        <div className="mt-[10cqw] flex justify-center">
          <span className="rounded-full bg-accent px-[4cqw] py-[1.8cqw] text-[3.6cqw] font-semibold text-base">
            {t('played {times}', { times: plural(slide.track?.plays || 0, 'time') })}
          </span>
        </div>
      </div>
    )
  }
  if (slide.key === 'tracks') {
    return (
      <div className="space-y-[2.2cqw]">
        {slide.tracks.map((track, i) => (
          <RankRow key={track.id || i} rank={i + 1} art={trackArt(track)} name={track.title} sub={track.artist} aside={plural(track.plays, 'play')} />
        ))}
      </div>
    )
  }
  if (slide.key === 'artist') {
    return (
      <div className="space-y-[4cqw]">
        <div className="flex items-end gap-[4cqw]">
          <BigCover track={slide.track} className={`aspect-square flex-shrink-0 -rotate-2 ${slide.long ? 'w-[34cqw]' : 'w-[44cqw]'} rounded-[4cqw] shadow-2xl`} iconSize={28} />
          <div className="min-w-0 pb-[1cqw]">
            <p className="text-[2.5cqw] uppercase tracking-widest text-white/40">{t('most played')}</p>
            <p className="truncate text-[3.4cqw]">{slide.track?.title}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-[2cqw]">
          {[[Number(slide.artist.plays || 0).toLocaleString(), t('Plays')], [secondsText(slide.artist.seconds), t('listened')]].map(([value, label]) => (
            <div key={label} className="rounded-[3cqw] bg-white/[0.07] px-[3cqw] py-[2.5cqw]">
              <p className="text-[2.5cqw] uppercase tracking-widest text-white/40">{label}</p>
              <p className="mt-[0.8cqw] truncate font-display text-[4.6cqw]">{value}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (slide.key === 'artists') {
    return (
      <div className="space-y-[2.2cqw]">
        {slide.artists.map((artist, i) => (
          <RankRow key={artist.artist} rank={i + 1} art={trackArt(topTracks.find(item => item.artist === artist.artist))}
            name={artist.artist} sub={artist.seconds ? secondsText(artist.seconds) : plural(artist.plays, 'play')} />
        ))}
      </div>
    )
  }
  if (slide.key === 'genre') {
    const most = Math.max(...slide.genres.map(genre => genre.plays), 1)
    return (
      <div className="space-y-[2.4cqw]">
        {slide.genres.map((genre, i) => (
          <div key={genre.genre}>
            <div className="flex items-baseline justify-between gap-[3cqw] text-[3.4cqw]">
              <span className={`truncate ${i === 0 ? 'text-white' : 'text-white/70'}`}>#{i + 1} {genre.genre}</span>
              <span className="flex-shrink-0 text-[2.7cqw] text-white/40">{plural(genre.plays, 'play')}</span>
            </div>
            <div className="mt-[1cqw] h-[1.6cqw] overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${i === 0 ? 'bg-accent' : 'bg-white/40'}`} style={{ width: `${(genre.plays / most) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (slide.key === 'stations') {
    const most = Math.max(...slide.stations.map(item => item.seconds), 1)
    return (
      <div className="space-y-[3cqw]">
        {slide.stations.map((item, i) => (
          <div key={item.station}>
            <div className="flex items-baseline justify-between gap-[3cqw] text-[3.6cqw]">
              <span className={`flex min-w-0 items-center gap-[2cqw] ${i === 0 ? 'text-white' : 'text-white/70'}`}>
                <Radio size={13} className={`flex-shrink-0 ${i === 0 ? 'text-accent' : 'text-white/40'}`} />
                <span className="truncate">{item.station}</span>
              </span>
              <span className="flex-shrink-0 text-[2.8cqw] text-white/45">{secondsText(item.seconds)}</span>
            </div>
            <div className="mt-[1.2cqw] h-[1.8cqw] overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${i === 0 ? 'bg-accent' : 'bg-white/40'}`} style={{ width: `${(item.seconds / most) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (slide.key === 'session') {
    const session = slide.session
    const start = new Date(session.start * 1000)
    const stats = [
      [t('Date'), fmtDate(session.start)],
      [t('Started'), start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
      [t('Length'), fmtMinutes(session.durationMinutes)],
      [t('Tracks'), (session.trackCount || 0).toLocaleString()],
    ]
    return (
      <div className="space-y-[4cqw]">
        <div className="grid grid-cols-4 gap-[2cqw]">
          {session.tracks.slice(0, 4).map((track, i) => <Cover key={track.id || i} src={trackArt(track)} className="aspect-square rounded-[2.5cqw]" />)}
        </div>
        <div className="grid grid-cols-2 gap-[2cqw]">
          {stats.map(([label, value]) => (
            // Dark, so they read over the cubes behind.
            <div key={label} className="min-w-0 rounded-[3cqw] bg-black/40 px-[3cqw] py-[2.2cqw]">
              <p className="text-[2.5cqw] uppercase tracking-widest text-white/40">{label}</p>
              <p className="mt-[0.6cqw] truncate font-display text-[4.2cqw]">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-[2.9cqw] leading-snug text-white/50">{sessionDescription(session)}</p>
      </div>
    )
  }
  if (slide.key === 'added') {
    return (
      <div className="space-y-[4cqw]">
        <p className="font-display text-[22cqw] leading-none text-accent">+{Number(recap.addedCount || 0).toLocaleString()}</p>
        {slide.added.length > 0 && (
          <div className="grid grid-cols-4 gap-[2.5cqw]">
            {slide.added.map(track => (
              <div key={track.id} className="min-w-0">
                <Cover src={trackArt(track)} className="aspect-square rounded-[2.5cqw]" />
                <p className="mt-[1cqw] truncate text-[2.5cqw] text-white/70">{track.title}</p>
                <p className="truncate text-[2.2cqw] text-white/40">{track.artist}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (slide.key === 'hour') {
    const hours = Array.isArray(recap.hours) && recap.hours.length === 24 ? recap.hours : null
    if (!hours) return null
    const most = Math.max(...hours, 1)
    const peak = recap.peakHour?.hour
    const partsMost = Math.max(...slide.parts.parts.map(part => part.plays), 1)
    return (
      <div className="space-y-[5cqw]">
        <div className="grid grid-cols-4 items-end gap-[3cqw]">
          {slide.parts.parts.map(part => {
            const Icon = part.icon
            const top = part.key === slide.parts.top?.key
            return (
              <div key={part.key} className="flex flex-col items-center gap-[1.5cqw]">
                <div className="flex h-[22cqw] w-full items-end">
                  <div className={`w-full rounded-[2.5cqw] ${top ? 'bg-accent' : 'bg-white/25'}`} style={{ height: `${Math.max(8, (part.plays / partsMost) * 100)}%` }} />
                </div>
                <Icon size={14} className={top ? 'text-accent' : 'text-white/45'} />
                <span className={`text-[2.7cqw] ${top ? 'text-white' : 'text-white/50'}`}>{t(part.label)}</span>
              </div>
            )
          })}
        </div>
        <div>
          <div className="flex h-[14cqw] items-end gap-[0.7cqw]" aria-label={t('Plays by hour of the day')} role="img">
            {hours.map((plays, hour) => (
              <div key={hour} className={`flex-1 rounded-t-[1cqw] ${hour === peak ? 'bg-accent' : 'bg-white/25'}`}
                style={{ height: `${Math.max(plays ? 4 : 1.5, (plays / most) * 100)}%` }} title={`${fmtHour(hour)}: ${plural(plays, 'play')}`} />
            ))}
          </div>
          <div className="mt-[2cqw] grid grid-cols-4 text-[2.6cqw] text-white/40">
            {[0, 6, 12, 18].map(hour => <span key={hour}>{shortHour(hour)}</span>)}
          </div>
        </div>
      </div>
    )
  }
  return null
}
