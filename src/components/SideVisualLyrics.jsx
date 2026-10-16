// The side panel's Visualization + Lyrics tab: a picture at the top, the
// song's lyrics (synced or plain) under it, like the Details tab's cover over
// its info. The picture is, first that the song has:
//   1. its music video, set by hand in Edit Track (a YouTube link and the
//      seconds it loops between: without both it isn't shown),
//   2. its Spotify Canvas (MotionCover's tall clip),
//   3. the side panel's own visualization.
// Both videos are muted, have no controls, can't be clicked, and stop with
// the song. While there are no lines to show (an instrumental, lyrics that
// can't be found, none found) the picture takes the whole panel.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { isWindowHidden, onWindowVisibility } from '../windowVisibility'
import { trackClipLoop } from '../youtubeClip'
import MotionCover from './MotionCover'
import LyricsPanel from './LyricsPanel'

// How much of the panel the picture takes above the lyrics.
const PICTURE_SHARE = 46

/** A YouTube video looping between two of its seconds, muted. */
function YoutubeClipLoop({ videoId, start, end, onActive, onFail }) {
  const ref = useRef(null)
  const [src, setSrc] = useState(null)
  const [ready, setReady] = useState(false)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying

  useEffect(() => {
    let current = true
    setSrc(null)
    setReady(false)
    Promise.resolve(api.youtubeVideoSrc?.(videoId)).then(found => {
      if (!current) return
      if (found) setSrc(found)
      else onFail?.()
    }).catch(() => { if (current) onFail?.() })
    return () => { current = false }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onActiveRef = useRef(onActive)
  onActiveRef.current = onActive
  useEffect(() => () => onActiveRef.current?.(false), [])

  // Back to the start once past the end (checked every frame while it plays:
  // timeupdate comes only a few times a second).
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return undefined
    let frame = 0
    const stopAt = () => (Number.isFinite(v.duration) && v.duration > 0 ? Math.min(end, v.duration - 0.05) : end)
    const check = () => {
      if (v.currentTime >= stopAt() || v.currentTime < start - 0.5) v.currentTime = start
      frame = requestAnimationFrame(check)
    }
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check) }
    const halt = () => cancelAnimationFrame(frame)
    const ended = () => { v.currentTime = start; if (playingRef.current && !isWindowHidden()) v.play().catch(() => {}) }
    v.addEventListener('playing', run)
    v.addEventListener('pause', halt)
    v.addEventListener('ended', ended)
    return () => {
      halt()
      v.removeEventListener('playing', run)
      v.removeEventListener('pause', halt)
      v.removeEventListener('ended', ended)
    }
  }, [src, start, end])

  // Plays while the song does and someone can see it.
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    if (isPlaying && !isWindowHidden()) v.play().catch(() => {})
    else v.pause()
  }, [src, isPlaying])
  useEffect(() => onWindowVisibility((hidden) => {
    const v = ref.current
    if (!v) return
    if (hidden || !playingRef.current) v.pause()
    else v.play().catch(() => {})
  }), [])

  if (!src) return null
  const show = () => { if (!ready) { setReady(true); onActive?.(true) } }
  return (
    <video
      ref={ref}
      key={src}
      src={src}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      controls={false}
      tabIndex={-1}
      aria-hidden="true"
      onLoadedMetadata={e => { e.currentTarget.currentTime = start }}
      onSeeked={show}
      onPlaying={show}
      onError={() => { onActive?.(false); onFail?.() }}
      onContextMenu={e => e.preventDefault()}
      className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 320ms ease' }}
    />
  )
}

export default function SideVisualLyrics({ track, progress, visual, visualBg, coverOff = false, wordSync, textScale, isAutoSynced }) {
  const loop = trackClipLoop(track)
  const loopKey = loop ? `${track?.id}:${loop.videoId}:${loop.start}:${loop.end}` : null
  // The music video stays off for this song once it fails to play.
  const [failedLoop, setFailedLoop] = useState(null)
  const useLoop = !!loop && failedLoop !== loopKey
  const [loopOn, setLoopOn] = useState(false)
  const [canvasOn, setCanvasOn] = useState(false)
  const [idle, setIdle] = useState(false)
  const videoOn = (useLoop && loopOn) || (!useLoop && canvasOn)

  return (
    <div className="absolute inset-0" style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}>
      <motion.div
        className="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
        initial={false}
        animate={{ height: idle ? '100%' : `${PICTURE_SHARE}%` }}
        transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
        style={{
          backgroundColor: videoOn ? '#000000' : visualBg,
          WebkitMaskImage: idle ? 'none' : 'linear-gradient(to bottom, black 78%, transparent 100%)',
          maskImage: idle ? 'none' : 'linear-gradient(to bottom, black 78%, transparent 100%)',
        }}
      >
        {/* The built-in visualization only runs while no video shows. */}
        {!videoOn && visual}
        {useLoop ? (
          <YoutubeClipLoop key={loopKey} videoId={loop.videoId} start={loop.start} end={loop.end}
            onActive={setLoopOn} onFail={() => { setLoopOn(false); setFailedLoop(loopKey) }} />
        ) : (
          <MotionCover trackId={track?.id} only="tall" onActive={setCanvasOn} off={coverOff} className="pointer-events-none" />
        )}
      </motion.div>
      {/* The lyrics start over the picture's fading bottom edge. */}
      <div className="absolute inset-x-0 bottom-0 pb-[var(--player-space,0px)]" style={{ top: `${PICTURE_SHARE - 4}%` }}>
        <div className="relative h-full min-h-0 overflow-hidden">
          <LyricsPanel track={track} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={textScale} isAutoSynced={isAutoSynced}
            idleVisual onIdleChange={setIdle} />
        </div>
      </div>
    </div>
  )
}
