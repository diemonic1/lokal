// The side panel's Visualization + Lyrics tab: a picture at the top, the
// song's lyrics (synced or plain) under it, like the Details tab's cover over
// its info. The picture is, first that the song has:
//   1. its video, set by hand in Edit Track (any link or video file), looping
//      over the part its times give (see clipRange in ../clipVideo.js),
//   2. its moving cover, from any source (MotionCover: a Spotify Canvas,
//      Apple Music, Tidal...),
//   3. the side panel's own visualization.
// Both videos are muted, have no controls, can't be clicked, and stop with
// the song. While there are no lines to show (an instrumental, lyrics that
// can't be found, none found) the picture takes the whole panel.
// Under the lyrics, the album's colours (Settings > Visualizations > Now
// Playing > Colour Background, as strong as its Visualization + Lyrics
// slider says); the picture fades into them.

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useAppearanceText, useAppearanceValue } from '../appearanceFlags'
import ArtworkBackdrop, { meshKeyFor, useArtworkBackdropEnabled } from './ArtworkBackdrop'
import MotionCover from './MotionCover'
import ClipLoop, { useTrackClip } from './ClipLoop'
import LyricsPanel from './LyricsPanel'

// How much of the panel the picture takes above the lyrics (which start
// where it has faded out).
// Settings > Visualizations > Now Playing moves the lyrics up or down from
// there (px; 0: right under it).
const PICTURE_SHARE = 46
// Drawn over the picture's bottom (not a mask on it: a mask left stripes in
// the video): clear, then into the panel's colour.
const FADE = 'linear-gradient(rgb(var(--surface-rgb) / 0) 0%, rgb(var(--surface-rgb) / 0.18) 75%, rgb(var(--surface-rgb) / 0.8) 90%, rgb(var(--surface-rgb)) 100%)'
const PICTURE_MOTION = { duration: 0.55, ease: [0.4, 0, 0.2, 1] }

// visual / visualBg: the visualization with lyrics; fullVisual / fullVisualBg:
// the fullscreen one, while the lyrics are hidden (the picture fills the panel).
export default function SideVisualLyrics({ track, progress, visual, visualBg, fullVisual = visual, fullVisualBg = visualBg, coverOff = false, wordSync, textScale, isAutoSynced }) {
  // Edit Track open on this song: the video being tried (link, times, zoom)
  // shows straight away, before it's saved. It stays off for the song once it
  // fails to play.
  const { loop, loopKey, fail: failLoop } = useTrackClip(track)
  const zoom = loop?.zoom ?? 0
  const useLoop = !!loop
  const [loopOn, setLoopOn] = useState(false)
  const [canvasOn, setCanvasOn] = useState(false)
  const [canvasSource, setCanvasSource] = useState(null)
  const [idle, setIdle] = useState(false)
  const videoOn = (useLoop && loopOn) || (!useLoop && canvasOn)
  const fx = useArtworkBackdropEnabled()
  const strength = Math.max(0, Math.min(100, useAppearanceValue('side_lyrics_backdrop_strength', 50))) / 100
  const lyricsOffset = Math.max(-400, Math.min(400, useAppearanceValue('side_lyrics_offset', 0)))
  // Settings > Visualizations > Side Panel: no fade over the visualization
  // (only over a video), unless switched off.
  const keepFade = useAppearanceText('side_visual_gradient_off') === '0'
  const fadeOn = videoOn || keepFade

  return (
    <div className="side-lyrics-edge absolute inset-0" style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}>
      {fx && strength > 0 && (
        <div className="pointer-events-none absolute inset-0" style={{ opacity: strength }}>
          <ArtworkBackdrop trackId={meshKeyFor(track)} />
        </div>
      )}
      <motion.div
        className="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
        initial={false}
        animate={{ height: idle ? '100%' : `${PICTURE_SHARE}%` }}
        transition={PICTURE_MOTION}
        style={{ backgroundColor: videoOn ? '#000000' : idle ? fullVisualBg : visualBg }}
      >
        {/* The built-in visualization only runs while no video shows. */}
        {!videoOn && (idle ? fullVisual : visual)}
        {useLoop ? (
          <ClipLoop key={loopKey} trackId={track?.id} link={loop.link} start={loop.start} end={loop.end} zoom={zoom}
            onActive={setLoopOn} onFail={() => { setLoopOn(false); failLoop() }} />
        ) : (
          <MotionCover trackId={track?.id} onActive={(on, source) => { setCanvasOn(on); setCanvasSource(on ? source || null : null) }} off={coverOff} className="pointer-events-none" />
        )}
      </motion.div>
      {/* A long fade from the picture into the colours under the lyrics: no
          edge between them. Same size and place as the picture, over it. */}
      {fadeOn && <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0"
        initial={false}
        animate={{ height: idle ? '100%' : `${PICTURE_SHARE}%`, opacity: idle ? 0 : 1 }}
        transition={PICTURE_MOTION}
        style={{ background: FADE }}
      />}
      {/* The lyrics start under the picture, moved by the setting; the list
          reaches --side-lyrics-edge-overlap further up, over it, where the lines scrolled
          up fade and blur into it (LyricsPanel's topBlur). */}
      <div className={`absolute inset-x-0 bottom-0 pb-[var(--player-space,0px)] ${idle ? 'pointer-events-none' : ''}`} style={{ top: `max(0px, calc(${PICTURE_SHARE}% + ${lyricsOffset}px - var(--side-lyrics-edge-overlap)))` }}>
        {/* Not clipped: the list runs on under the player bar (underBar). */}
        <div className="relative h-full min-h-0">
          <LyricsPanel track={track} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={textScale} isAutoSynced={isAutoSynced}
            idleVisual onIdleChange={setIdle} toolbarAtBottom sizeControl underBar topBlur
            media={useLoop && loopOn ? { clip: loop.link } : !useLoop && canvasOn ? { cover: canvasSource } : null} />
        </div>
      </div>
    </div>
  )
}
