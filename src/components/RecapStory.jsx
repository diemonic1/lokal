// The Recap page's story: a full-screen, story-style walk through a recap.
//
// - Rendered into <body> (a portal), so no page transform or scroll box can
//   size or place it, and the rest of the app is inert while it's open.
// - A 9:16 card that fits the window whatever its size: its type is sized in
//   container units (cqw), so every slide fits without scrolling.
// - Slides advance by themselves; the bars show the time left. Hold the card,
//   press Space or the pause button to stop; hidden windows pause too.
// - Each slide can play one of its songs (the sound toggle is remembered).
// - "Play this session" and "Play top N" start those songs and close the
//   story, so the player bar shows them (the next slide's song would
//   otherwise replace them, hidden behind the story).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { ChevronLeft, ChevronRight, Disc3, Moon, Pause, Play, Radio, Share2, Sun, Sunrise, Sunset, Volume2, VolumeX, X } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { plural } from '../plural'
import { translate, useTranslation } from '../i18n'
import { periodLabel, periodTitle } from '../recapPeriods'
import { albumArt, artistAlbumName, daysText, filteredGenres, fmtHour, fmtMinutes, genreComment, hourComment, sessionComment, sessionLabel, trackArt } from '../recapText'
import { isWindowHidden, onWindowVisibility } from '../windowVisibility'
import { coversOf, openShareCard } from '../shareCard'

const SOUND_KEY = 'lokal-recap-story-sound'
// A press this long pauses (like holding a story) instead of turning the page.
const HOLD_MS = 220
// The card: 9:16, as tall as the window allows below the controls, and never
// wider than the window minus the side arrows.
const CARD_HEIGHT = 'min(calc(100dvh - 8.5rem), calc((100vw - 8rem) * 16 / 9))'
const CARD_WIDTH = `calc(${CARD_HEIGHT} * 9 / 16)`

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

function readSound() {
  try { return localStorage.getItem(SOUND_KEY) !== '0' } catch { return true }
}

/** The slides a recap has something to say in (no "nothing here yet" slides). */
function buildSlides(recap, period) {
  const topGenres = filteredGenres(recap?.topGenres || [])
  const topArtists = recap?.topArtists || []
  const topAlbums = recap?.topAlbums || []
  const topTracks = recap?.topTracks || []
  const session = recap?.biggestSession || recap?.sessions?.[0]
  const topArtist = topArtists[0]
  const topAlbum = topAlbums[0]
  const topTrack = topTracks[0]
  const when = period ? periodLabel(period) : translate('your recap')
  const artistTrack = (name) => topTracks.find(track => track.artist === name)
  const slides = [{
    key: 'intro',
    eyebrow: translate('lokal recap'),
    title: translate('your {period} in lokal.', { period: when.toLowerCase() }),
    body: translate("let's look back at what you played."),
    track: topTrack,
    duration: 5000,
  }, {
    key: 'overview',
    eyebrow: when.toLowerCase(),
    title: translate('{time} of music.', { time: fmtMinutes(recap?.totalMinutes || 0) }),
    body: translate("(that's about {days}... you okay?)", { days: daysText(recap?.totalMinutes || 0) }),
    track: topTrack,
    duration: 6500,
  }]
  if (topArtist) slides.push({
    key: 'artist',
    eyebrow: translate('top artist'),
    title: translate('your favorite artist was {artist}.', { artist: topArtist.artist.toLowerCase() }),
    body: translate('{plays}, {time} together. {album} kept dragging you back in.', { plays: plural(topArtist.plays, 'play'), time: secondsText(topArtist.seconds), album: artistAlbumName(topArtist, topAlbums, topTracks).toLowerCase() }),
    track: artistTrack(topArtist.artist) || topTrack,
    artists: topArtists.slice(1, 4),
    duration: 7500,
  })
  if (topArtists.length > 1) slides.push({
    key: 'artists',
    eyebrow: translate('top artists'),
    title: translate('the artists you kept coming back to.'),
    body: translate('{n} different artists in all.', { n: (recap?.uniqueArtists || topArtists.length).toLocaleString() }),
    track: artistTrack(topArtists[1].artist) || topTrack,
    artists: topArtists.slice(0, 5),
    duration: 8000,
  })
  if (topAlbum) slides.push({
    key: 'albums',
    eyebrow: translate('top albums'),
    title: translate('{album} was your soundtrack.', { album: topAlbum.album.toLowerCase() }),
    body: topAlbums[1] ? translate('these almost took the crown:') : translate('this era leaned more track-by-track.'),
    track: topTracks.find(track => track.album === topAlbum.album) || topTrack,
    albums: topAlbums.slice(0, 5),
    duration: 8000,
  })
  if (topTracks.length > 1) slides.push({
    key: 'tracks',
    eyebrow: translate('top tracks'),
    title: translate('the songs you had on repeat.'),
    body: translate('{n} different tracks in all.', { n: (recap?.uniqueTracks || topTracks.length).toLocaleString() }),
    track: topTracks[1],
    tracks: topTracks.slice(0, 5),
    duration: 8000,
  })
  if (topTrack) slides.push({
    key: 'track',
    eyebrow: translate('your #1 track'),
    title: `${topTrack.title || ''}.`.toLowerCase(),
    body: String(topTrack.artist || '').toLowerCase(),
    track: topTrack,
    duration: 7000,
  })
  const parts = dayparts(recap?.hours)
  if (recap?.peakHour?.plays && parts.top) slides.push({
    key: 'hour',
    eyebrow: translate('when you listen'),
    title: translate(`${parts.top.persona}.`),
    body: translate('most of your music played from {from} to {to}; your favorite hour was {hour}.', { from: shortHour(parts.top.from), to: shortHour(parts.top.to), hour: shortHour(recap.peakHour.hour) }),
    track: topTracks[2] || topTrack,
    parts,
    duration: 7500,
  })
  if (session?.tracks?.length) slides.push({
    key: 'session',
    eyebrow: translate('the vibe check'),
    title: translate('deep session: {name}.', { name: (session.label ? sessionLabel(session) : translate('one long run')).toLowerCase() }),
    body: translate('{tracks} over {time}, mostly by {artist}. {comment}', { tracks: plural(session.trackCount, 'track'), time: fmtMinutes(session.durationMinutes), artist: session.topArtists?.[0]?.artist || translate('your queue'), comment: sessionComment(session) }),
    track: session.tracks[0],
    session,
    duration: 8000,
  })
  if (topGenres[0]) slides.push({
    key: 'genre',
    eyebrow: translate('genre check'),
    title: translate('out of every genre, {genre} won.', { genre: topGenres[0].genre.toLowerCase() }),
    body: genreComment(topGenres[0].genre),
    track: topTracks[3] || topTrack,
    genres: topGenres.slice(0, 5),
    duration: 8000,
  })
  const stations = recap?.topStations || []
  if (stations.length) slides.push({
    key: 'stations',
    eyebrow: translate('on the radio'),
    title: translate('you tuned in for {time}.', { time: fmtMinutes(recap.radioMinutes || 0) }),
    body: translate('mostly to {station}.', { station: stations[0].station.toLowerCase() }),
    stations: stations.slice(0, 5),
    duration: 7000,
  })
  if (topArtist || topTrack) slides.push({
    key: 'summary',
    eyebrow: translate('the summary'),
    title: translate('{period} at a glance.', { period: when.toLowerCase() }),
    body: '',
    track: topTrack,
    duration: 9000,
  })
  slides.push({
    key: 'end',
    eyebrow: translate('the replay'),
    title: translate("now, let's replay this era."),
    body: translate('your top {n}, ready to play or keep.', { n: Math.min((recap?.replayQueue || topTracks).length, 50) }),
    track: topTrack,
    duration: 0, // the last slide stays
  })
  // A long name (album, artist, session) makes a long headline: smaller type
  // and a smaller picture keep the slide inside the card.
  return slides.map(slide => ({ ...slide, long: slide.title.length > 55 }))
}

/** A slide as a share card (shareCard.js): its headline, the period's numbers and the slide's list. */
function slideShareSpec(slide, recap, period) {
  const topTracks = recap?.topTracks || []
  const topArtists = recap?.topArtists || []
  const title = slide.title.replace(/\.$/, '')
  const list = slide.key === 'tracks' || slide.key === 'track'
    ? { title: 'Top tracks', items: topTracks.slice(0, 5).map(track => [track.title, track.artist]) }
    : slide.key === 'albums'
      ? { title: 'Top albums', items: (recap?.topAlbums || []).slice(0, 5).map(album => [album.album, album.artist || plural(album.plays, 'play')]) }
      : slide.key === 'hour'
        ? { title: 'When you listen', items: slide.parts.parts.map(part => [translate(part.label), plural(part.plays, 'play')]) }
        : slide.key === 'genre'
          ? { title: 'Genres', items: slide.genres.map(genre => [genre.genre, plural(genre.plays, 'play')]) }
          : slide.key === 'stations'
            ? { title: 'Favorite stations', items: slide.stations.map(item => [item.station, secondsText(item.seconds)]) }
          : topArtists.length
            ? { title: 'Top artists', items: topArtists.slice(0, 5).map(artist => [artist.artist, secondsText(artist.seconds)]) }
            : { title: 'Top tracks', items: topTracks.slice(0, 5).map(track => [track.title, track.artist]) }
  const art = slide.key === 'track' ? coversOf([slide.track], 1)
    : slide.key === 'artist' ? coversOf(topTracks.filter(track => track.artist === topArtists[0]?.artist), 1)
      : coversOf(topTracks, 4)
  return {
    kind: 'Recap',
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
  const slides = useMemo(() => buildSlides(recap, period), [recap, period, language]) // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const [hidden, setHidden] = useState(isWindowHidden)
  const [sound, setSound] = useState(readSound)
  const playQueue = usePlayerStore(state => state.playQueue)
  // A button's songs: played, and the story closes (see the top).
  const playAndClose = useCallback((tracks, name) => {
    if (!tracks?.length) return
    playQueue(tracks, 0, { type: 'recap', id: `${period?.id || 'recap'}:${name}`, name })
    onClose()
  }, [playQueue, onClose, period?.id])
  const last = slides.length - 1
  const slide = slides[Math.min(index, last)]
  const topTracks = recap?.topTracks || []
  const replayQueue = recap?.replayQueue || topTracks
  const running = !paused && !held && !hidden && slide.duration > 0
  const dialogRef = useRef(null)
  const press = useRef(null)

  const go = useCallback((step) => setIndex(value => Math.max(0, Math.min(value + step, last))), [last])

  // Time spent on this slide (0-1), driving its bar without re-rendering.
  const progress = useMotionValue(0)
  const barWidth = useTransform(progress, value => `${value * 100}%`)
  useEffect(() => { progress.set(0) }, [index, progress])
  useEffect(() => {
    if (!running) return undefined
    let frame
    let before = performance.now()
    const tick = (now) => {
      const value = Math.min(1, progress.get() + (now - before) / slide.duration)
      before = now
      progress.set(value)
      if (value < 1) frame = requestAnimationFrame(tick)
      else go(1)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, index, slide.duration, progress, go])

  // Paused while nobody can see it, minimized included (windowVisibility.js).
  useEffect(() => onWindowVisibility(setHidden), [])

  // The rest of the app can't be reached (Tab, screen readers) while it's open;
  // focus goes back where it was on close. The story itself takes focus (not
  // Close, which Space or Enter would then press), so Space pauses.
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

  // Captured before the app's own shortcuts (arrows seek, Space plays).
  useEffect(() => {
    const onKey = (event) => {
      const onButton = event.target?.closest?.('button')
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') go(1)
      else if (event.key === 'ArrowLeft') go(-1)
      else if (event.key === ' ' && !onButton) setPaused(value => !value)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])

  // The slide's song, unless sound is off; the same song isn't restarted.
  useEffect(() => {
    if (!sound || !slide.track?.id) return
    const { currentTrack, isPlaying, togglePlay } = usePlayerStore.getState()
    if (currentTrack?.id === slide.track.id) {
      if (!isPlaying) togglePlay()
      return
    }
    playQueue([slide.track], 0)
  }, [sound, slide.track?.id, playQueue])

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    try { localStorage.setItem(SOUND_KEY, next ? '1' : '0') } catch {}
    const player = usePlayerStore.getState()
    if (!next && player.isPlaying) player.togglePlay()
  }

  // Every cover the story shows, fetched up front so slides don't pop in.
  useEffect(() => {
    const urls = new Set()
    for (const item of slides) {
      if (item.track) urls.add(trackArt(item.track))
      for (const track of item.session?.tracks?.slice(0, 4) || []) urls.add(trackArt(track))
      for (const album of item.albums || []) urls.add(albumArt(album, topTracks))
    }
    for (const url of urls) if (url) { const image = new Image(); image.src = url }
  }, [slides, topTracks])

  // A tap turns the page (left third: back); a longer press pauses while held.
  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest('button, a, [data-interactive]')) return
    const timer = setTimeout(() => setHeld(true), HOLD_MS)
    press.current = { x: event.clientX, at: performance.now(), timer }
  }
  const endPress = (event, turn) => {
    const current = press.current
    press.current = null
    if (!current) return
    clearTimeout(current.timer)
    setHeld(false)
    if (!turn || performance.now() - current.at >= HOLD_MS) return
    const rect = event.currentTarget.getBoundingClientRect()
    go(current.x - rect.left < rect.width * 0.3 ? -1 : 1)
  }

  const art = trackArt(slide.track)
  const move = reduceMotion ? 0 : 1

  return (
    <motion.div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t('{name} story', { name: period ? periodTitle(period) : t('Recap') })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black text-white outline-none"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {/* The slide's cover, blurred, behind everything. */}
      <AnimatePresence initial={false}>
        {art && (
          <motion.div
            key={art}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-[-10%] bg-cover bg-center"
            style={{ backgroundImage: `url("${art}")`, filter: 'blur(70px) saturate(1.3)' }}
          />
        )}
      </AnimatePresence>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.25),rgba(0,0,0,0.85))]" />

      <div className="relative flex flex-col items-center gap-3">
        {/* Bars and controls, as wide as the card. */}
        <div className={`flex flex-col gap-3 transition-opacity duration-200 ${held ? 'opacity-0' : ''}`} style={{ width: CARD_WIDTH }}>
          <div className="flex gap-1.5">
            {slides.map((item, slideIndex) => (
              <div key={item.key} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                {slideIndex < index || (slideIndex === index && slide.duration === 0)
                  ? <div className="h-full w-full rounded-full bg-white" />
                  : slideIndex === index && <motion.div className="h-full rounded-full bg-white" style={{ width: barWidth }} />}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[10px] font-display uppercase tracking-[0.24em] text-white/50">
              {t('lokal recap')} · {period ? periodLabel(period) : ''}
            </p>
            {/* The share dialog lives in the app behind the story: the story closes for it. */}
            <StoryButton onClick={() => { const spec = slideShareSpec(slide, recap, period); onClose(); openShareCard(spec) }} label={t('Share this slide as a picture')}>
              <Share2 size={14} />
            </StoryButton>
            {slide.duration > 0 && (
              <StoryButton onClick={() => setPaused(value => !value)} label={paused ? t('Resume') : t('Pause')}>
                {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
              </StoryButton>
            )}
            <StoryButton onClick={toggleSound} label={sound ? t('Turn the soundtrack off') : t('Turn the soundtrack on')} pressed={sound}>
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </StoryButton>
            <StoryButton onClick={onClose} label={t('Close story')}>
              <X size={16} />
            </StoryButton>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SideArrow label={t('Previous slide')} disabled={index === 0} onClick={() => go(-1)}><ChevronLeft size={18} /></SideArrow>
          <div
            onPointerDown={onPointerDown}
            onPointerUp={(event) => endPress(event, true)}
            onPointerCancel={(event) => endPress(event, false)}
            onPointerLeave={(event) => endPress(event, false)}
            onContextMenu={(event) => event.preventDefault()}
            className="relative select-none overflow-hidden rounded-[28px] border border-white/10 bg-black/30 shadow-2xl backdrop-blur-xl"
            style={{ height: CARD_HEIGHT, aspectRatio: '9 / 16', containerType: 'size' }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={slide.key}
                initial={{ opacity: 0, x: 24 * move }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 * move }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 flex flex-col p-[7cqw] pt-[8cqw]"
              >
                <span className="w-fit rounded-full border border-white/10 bg-white/5 px-[3cqw] py-[1cqw] font-display text-[2.8cqw] uppercase tracking-widest text-accent/90">
                  {slide.eyebrow}
                </span>
                <motion.h2
                  initial={{ opacity: 0, y: 14 * move }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08, duration: 0.45 }}
                  className={`mt-[5cqw] line-clamp-5 break-words font-display leading-[1.1] lowercase ${slide.long ? 'text-[6.2cqw]' : 'text-[8cqw]'}`}
                >
                  {slide.title}
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 10 * move }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16, duration: 0.45 }}
                  className="mt-[3.5cqw] line-clamp-3 text-[3.9cqw] italic leading-relaxed text-white/60 lowercase"
                >
                  {slide.body}
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 16 * move }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.24, duration: 0.5 }}
                  className="mt-auto pt-[5cqw]"
                >
                  <SlideVisual slide={slide} recap={recap} topTracks={topTracks} replayQueue={replayQueue}
                    playAndClose={playAndClose} periodTitle={period ? periodTitle(period) : ''} />
                </motion.div>
              </motion.div>
            </AnimatePresence>
            {(paused || held) && slide.duration > 0 && (
              <div className="pointer-events-none absolute right-[5cqw] top-[5cqw] rounded-full bg-black/50 px-[2.5cqw] py-[1cqw] text-[2.6cqw] uppercase tracking-widest text-white/70">{t('paused')}</div>
            )}
          </div>
          <SideArrow label={t('Next slide')} disabled={index === last} onClick={() => go(1)}><ChevronRight size={18} /></SideArrow>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{t('Slide {n} of {total}: {title}', { n: index + 1, total: slides.length, title: slide.title })}</p>
    </motion.div>
  )
}

function StoryButton({ onClick, label, pressed, children }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 transition-colors hover:bg-white/10 hover:text-white">
      {children}
    </button>
  )
}

function SideArrow({ label, disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-0">
      {children}
    </button>
  )
}

function Cover({ src, className = '', iconSize = 18, style }) {
  return (
    <div className={`overflow-hidden bg-white/5 ${className}`} style={style}>
      {src
        ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-white/30"><Disc3 size={iconSize} /></div>}
    </div>
  )
}

/** The song playing under a slide. */
function TrackChip({ track }) {
  if (!track) return null
  return (
    <div className="flex items-center gap-[3cqw] rounded-[4cqw] border border-white/10 bg-black/35 p-[2.5cqw]">
      <Cover src={trackArt(track)} className="h-[12cqw] w-[12cqw] flex-shrink-0 rounded-[2.5cqw]" />
      <div className="min-w-0">
        <p className="truncate text-[3.4cqw] lowercase">{track.title}</p>
        <p className="truncate text-[2.9cqw] text-white/55 lowercase">{track.artist}</p>
      </div>
    </div>
  )
}

function SlideVisual({ slide, recap, topTracks, replayQueue, playAndClose, periodTitle }) {
  const { t } = useTranslation()
  if (slide.key === 'overview') {
    const stats = [
      [recap.totalPlays || 0, t('plays')],
      [recap.uniqueTracks || 0, t('different tracks')],
      [recap.uniqueArtists || 0, t('artists')],
    ]
    return (
      <div className="space-y-[5cqw]">
        <div className="space-y-[3cqw]">
          {stats.map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-[3cqw]">
              <span className="font-display text-[13cqw] leading-none">{Number(value).toLocaleString()}</span>
              <span className="text-[3.4cqw] text-white/50 lowercase">{label}</span>
            </div>
          ))}
        </div>
        <TrackChip track={slide.track} />
      </div>
    )
  }
  if (slide.key === 'hour') {
    const hours = Array.isArray(recap.hours) && recap.hours.length === 24 ? recap.hours : null
    if (!hours) return <TrackChip track={slide.track} />
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
                <div className="flex h-[24cqw] w-full items-end">
                  <div className={`w-full rounded-[2.5cqw] ${top ? 'bg-accent' : 'bg-white/25'}`} style={{ height: `${Math.max(8, (part.plays / partsMost) * 100)}%` }} />
                </div>
                <Icon size={14} className={top ? 'text-accent' : 'text-white/45'} />
                <span className={`text-[2.7cqw] lowercase ${top ? 'text-white' : 'text-white/50'}`}>{t(part.label)}</span>
              </div>
            )
          })}
        </div>
        <div>
          <div className="flex h-[16cqw] items-end gap-[0.7cqw]" aria-label={t('Plays by hour of the day')} role="img">
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
  if (slide.key === 'intro') {
    const covers = topTracks.slice(0, 4)
    return (
      <div className="space-y-[5cqw]">
        <div className="relative mx-auto h-[56cqw] w-[56cqw]">
          {covers.map((track, i) => (
            <Cover key={track.id || i} src={trackArt(track)} iconSize={22}
              className="absolute aspect-square w-[34cqw] rounded-[4cqw] shadow-2xl"
              style={{ left: `${[0, 22, 4, 20][i]}cqw`, top: `${[2, 0, 22, 20][i]}cqw`, transform: `rotate(${[-8, 6, 4, -5][i]}deg)`, zIndex: 4 - i }} />
          ))}
        </div>
        <TrackChip track={slide.track} />
      </div>
    )
  }
  if (slide.key === 'stations') {
    const most = Math.max(...slide.stations.map(item => item.seconds), 1)
    return (
      <div className="space-y-[3cqw]">
        {slide.stations.map((item, i) => (
          <div key={item.station}>
            <div className="flex items-baseline justify-between gap-[3cqw] text-[3.6cqw] lowercase">
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
  if (slide.key === 'artists') {
    return (
      <div className="space-y-[2.2cqw]">
        {slide.artists.map((artist, i) => {
          const track = topTracks.find(item => item.artist === artist.artist)
          return (
            <div key={artist.artist} className="flex items-center gap-[3cqw]">
              <span className={`w-[5cqw] flex-shrink-0 font-display text-[4.6cqw] ${i === 0 ? 'text-accent' : 'text-white/45'}`}>{i + 1}</span>
              <Cover src={trackArt(track)} className="h-[12cqw] w-[12cqw] flex-shrink-0 rounded-[2.5cqw]" />
              <div className="min-w-0">
                <p className={`truncate font-display text-[4.2cqw] lowercase ${i === 0 ? 'text-white' : 'text-white/80'}`}>{artist.artist}</p>
                <p className="text-[2.9cqw] text-white/45 lowercase">{artist.seconds ? secondsText(artist.seconds) : plural(artist.plays, 'play')}</p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  if (slide.key === 'tracks') {
    return (
      <div className="space-y-[2.2cqw]">
        {slide.tracks.map((track, i) => (
          <div key={track.id || i} className="flex items-center gap-[3cqw]">
            <span className={`w-[5cqw] flex-shrink-0 font-display text-[4.6cqw] ${i === 0 ? 'text-accent' : 'text-white/45'}`}>{i + 1}</span>
            <Cover src={trackArt(track)} className="h-[12cqw] w-[12cqw] flex-shrink-0 rounded-[2.5cqw]" />
            <div className="min-w-0 flex-1">
              <p className={`truncate font-display text-[4cqw] lowercase ${i === 0 ? 'text-white' : 'text-white/80'}`}>{track.title}</p>
              <p className="truncate text-[2.9cqw] text-white/45 lowercase">{track.artist}</p>
            </div>
            <span className="flex-shrink-0 text-[2.7cqw] text-white/40">{plural(track.plays, 'play')}</span>
          </div>
        ))}
      </div>
    )
  }
  if (slide.key === 'track') {
    return (
      <div className="space-y-[5cqw]">
        <div className="relative mx-auto mb-[4cqw] w-[54cqw]">
          <div aria-hidden className="absolute inset-0 translate-x-[3cqw] translate-y-[2cqw] rotate-6 rounded-[5cqw] bg-accent/40" />
          <Cover src={trackArt(slide.track)} iconSize={30} className="relative aspect-square w-full -rotate-3 rounded-[5cqw] shadow-2xl" />
        </div>
        <div className="flex justify-center">
          <span className="rounded-full bg-accent px-[4cqw] py-[1.8cqw] text-[3.6cqw] font-semibold text-base">
            {t('played {times}', { times: plural(slide.track?.plays || 0, 'time') })}
          </span>
        </div>
      </div>
    )
  }
  if (slide.key === 'summary') {
    const topArtists = (recap.topArtists || []).slice(0, 5)
    const tracks = topTracks.slice(0, 5)
    const column = (label, items) => (
      <div className="min-w-0">
        <p className="text-[2.6cqw] uppercase tracking-widest text-accent">{label}</p>
        <div className="mt-[1.5cqw] space-y-[1cqw]">
          {items.map((text, i) => (
            <p key={`${text}-${i}`} className="flex min-w-0 gap-[1.5cqw] text-[3.3cqw] lowercase">
              <span className="flex-shrink-0 text-accent">{i + 1}</span>
              <span className="truncate">{text}</span>
            </p>
          ))}
        </div>
      </div>
    )
    return (
      <div className="space-y-[5cqw]">
        <div className="grid grid-cols-4 gap-[2cqw]">
          {coversOf(tracks, 4).length > 0 && tracks.slice(0, 4).map((track, i) => <Cover key={track.id || i} src={trackArt(track)} className="aspect-square rounded-[2.5cqw]" />)}
        </div>
        <div className="grid grid-cols-2 gap-[4cqw]">
          {column(t('Artists'), topArtists.map(artist => artist.artist))}
          {column(t('Tracks'), tracks.map(track => track.title))}
        </div>
        <div className="grid grid-cols-2 gap-[4cqw]">
          <div>
            <p className="text-[2.6cqw] uppercase tracking-widest text-accent">{t('minutes of music')}</p>
            <p className="font-display text-[10cqw] leading-none">{Number(recap.totalMinutes || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[2.6cqw] uppercase tracking-widest text-accent">{t('Plays')}</p>
            <p className="font-display text-[10cqw] leading-none">{Number(recap.totalPlays || 0).toLocaleString()}</p>
          </div>
        </div>
      </div>
    )
  }
  if (slide.key === 'session') {
    const session = slide.session
    const covers = session.tracks.slice(0, 4)
    return (
      <div className="space-y-[4cqw]">
        <div className="grid grid-cols-4 gap-[2cqw]">
          {covers.map((track, i) => <Cover key={track.id || i} src={trackArt(track)} className="aspect-square rounded-[2.5cqw]" />)}
        </div>
        <div className="grid grid-cols-3 gap-[2cqw] text-center">
          {[[fmtMinutes(session.durationMinutes), t('long')], [session.trackCount || 0, t('tracks')], [session.skippedCount || 0, t('skips')]].map(([value, label]) => (
            <div key={label} className="rounded-[3cqw] bg-white/[0.06] py-[2.5cqw]">
              <p className="font-display text-[4.6cqw]">{value}</p>
              <p className="text-[2.6cqw] text-white/45 lowercase">{label}</p>
            </div>
          ))}
        </div>
        <button data-interactive onClick={() => playAndClose(session.tracks, session.label ? sessionLabel(session) : t('Listening session'))}
          className="flex w-full items-center justify-center gap-[2cqw] rounded-[4cqw] border border-white/10 bg-white/[0.08] py-[3cqw] text-[3.4cqw] hover:bg-white/[0.14]">
          <Play size={14} fill="currentColor" /> {t('play this session')}
        </button>
      </div>
    )
  }
  if (slide.key === 'genre') {
    const most = Math.max(...slide.genres.map(genre => genre.plays), 1)
    return (
      <div className="space-y-[4cqw]">
        <div className="space-y-[2.2cqw]">
          {slide.genres.map((genre, i) => (
            <div key={genre.genre}>
              <div className="flex items-baseline justify-between text-[3.2cqw] lowercase">
                <span className={`truncate ${i === 0 ? 'text-white' : 'text-white/70'}`}>#{i + 1} {genre.genre}</span>
                <span className="text-[2.7cqw] text-white/40">{plural(genre.plays, 'play')}</span>
              </div>
              <div className="mt-[1cqw] h-[1.6cqw] overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${i === 0 ? 'bg-accent' : 'bg-white/40'}`} style={{ width: `${(genre.plays / most) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <TrackChip track={slide.track} />
      </div>
    )
  }
  if (slide.key === 'artist') {
    return (
      <div className="space-y-[4cqw]">
        <div className="flex items-end gap-[4cqw]">
          <Cover src={trackArt(slide.track)} className={`aspect-square flex-shrink-0 -rotate-2 ${slide.long ? 'w-[34cqw]' : 'w-[50cqw]'} rounded-[4cqw] shadow-2xl`} iconSize={28} />
          <div className="min-w-0 pb-[1cqw]">
            <p className="truncate text-[3.4cqw] lowercase">{slide.track?.title}</p>
            <p className="truncate text-[2.9cqw] text-white/55 lowercase">{slide.track?.artist}</p>
          </div>
        </div>
        {slide.artists.length > 0 && (
          <div className="space-y-[1.5cqw]">
            {slide.artists.map((artist, i) => (
              <div key={artist.artist} className="flex items-center justify-between rounded-[3cqw] bg-white/[0.05] px-[3.5cqw] py-[2.2cqw] text-[3.1cqw] lowercase">
                <span className="truncate text-white/75">#{i + 2} {artist.artist}</span>
                <span className="flex-shrink-0 text-[2.7cqw] text-white/40">{artist.seconds ? secondsText(artist.seconds) : plural(artist.plays, 'play')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (slide.key === 'albums') {
    const [first, ...others] = slide.albums
    return (
      <div className="space-y-[4cqw]">
        <div className="flex items-end gap-[4cqw]">
          <Cover src={albumArt(first, topTracks)} className={`aspect-square flex-shrink-0 rotate-2 ${slide.long ? 'w-[34cqw]' : 'w-[50cqw]'} rounded-[4cqw] shadow-2xl`} iconSize={28} />
          <div className="min-w-0 pb-[1cqw]">
            <p className="truncate text-[3.4cqw] lowercase">{first.album}</p>
            {first.artist && <p className="truncate text-[2.9cqw] text-white/55 lowercase">{first.artist}</p>}
            <p className="text-[2.9cqw] text-white/55">{plural(first.plays, 'play')}</p>
          </div>
        </div>
        {others.length > 0 && (
          <div className="grid grid-cols-4 gap-[2.5cqw]">
            {others.slice(0, 4).map(album => (
              <div key={album.album} className="min-w-0">
                <Cover src={albumArt(album, topTracks)} className="aspect-square rounded-[2.5cqw]" />
                <p className="mt-[1cqw] truncate text-[2.5cqw] text-white/60 lowercase">{album.album}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  // The replay.
  const topArtist = recap.topArtists?.[0]?.artist
  const topGenre = filteredGenres(recap.topGenres || [])[0]?.genre
  const summary = [
    [t('listened'), fmtMinutes(recap.totalMinutes || 0)],
    [t('top track'), topTracks[0]?.title],
    [t('top artist'), topArtist],
    [t('top genre'), topGenre],
  ].filter(([, value]) => value)
  return (
    <div className="space-y-[4cqw]">
      <div className="grid grid-cols-2 gap-[2cqw]">
        {summary.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-[3cqw] bg-white/[0.06] px-[3cqw] py-[2.5cqw]">
            <p className="text-[2.5cqw] uppercase tracking-widest text-white/40">{label}</p>
            <p className="mt-[0.8cqw] truncate text-[3.6cqw] lowercase">{value}</p>
          </div>
        ))}
      </div>
      <div className="space-y-[2cqw]">
        <button data-interactive onClick={() => playAndClose(replayQueue.slice(0, 50), `${t('Top {n}', { n: Math.min(replayQueue.length, 50) })}${periodTitle ? ` · ${periodTitle}` : ''}`)}
          className="flex w-full items-center justify-center gap-[2cqw] rounded-[4cqw] bg-accent py-[3.6cqw] text-[3.6cqw] font-semibold text-base hover:bg-accent/85">
          <Play size={15} fill="currentColor" /> {t('play top {n}', { n: Math.min(replayQueue.length, 50) })}
        </button>
      </div>
    </div>
  )
}
