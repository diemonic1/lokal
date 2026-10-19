// A song's own video (set in Edit Track, see ../clipVideo.js), looping muted
// over its part. Shown by the side panel's Visualization + Lyrics tab and in
// the full-screen player's cover card, ahead of the song's Spotify Canvas.
// A part long enough to follow the song (SEEK_MIN) stays in step with it:
// seeking the song (the seek bar, the lyrics, anything else) seeks the video
// to the matching place, and it's put back when it drifts off (a stall, the
// window hidden for a while).

import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { isWindowHidden, onWindowVisibility } from '../windowVisibility'
import { clipPreview, clipRange, clipSongTime, onClipPreview, trackClipLoop } from '../clipVideo'

// The song's time is reported a few times a second: this far off (seconds)
// is a seek, or the video drifting.
const SEEK_JUMP = 1
const DRIFT = 1
// A drifting video is put back at most this often (ms), so a slow stream
// isn't sent seeking over and over.
const DRIFT_FIX_MS = 1500

/**
 * The video this song shows, if any: the one being tried in Edit Track, else
 * its saved one. One that fails to play stays off for the song (fail()).
 * -> { loop: { link, start, end, zoom } | null, loopKey, fail }
 */
export function useTrackClip(track) {
  const [, setPreviewTick] = useState(0)
  useEffect(() => onClipPreview(() => setPreviewTick(n => n + 1)), [])
  const preview = clipPreview(track?.id)
  const loop = preview ? (preview.link ? preview : null) : trackClipLoop(track)
  // Not the zoom: changing it only rescales the video playing.
  const loopKey = loop ? `${track?.id}:${loop.link}:${loop.start}:${loop.end}` : null
  const [failedLoop, setFailedLoop] = useState(null)
  return { loop: loop && failedLoop !== loopKey ? loop : null, loopKey, fail: () => setFailedLoop(loopKey) }
}

/** The song's own video looping, muted: between its two times, or the part clipRange picks. */
export default function ClipLoop({ trackId, link, start, end, zoom = 0, onActive, onFail }) {
  const ref = useRef(null)
  const [src, setSrc] = useState(null)
  const [ready, setReady] = useState(false)
  // A YouTube video the stream can't play (age-restricted...) is tried once
  // more through yt-dlp's own link.
  const triedFallback = useRef(false)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying

  const resolve = (fallback) => {
    let current = true
    Promise.resolve(api.clipVideoSource?.(link, { fallback })).then(found => {
      if (!current) return
      if (found?.src) setSrc(found.src)
      else {
        if (found?.error) console.warn(`[clip] ${link}: ${found.error}`)
        onFail?.()
      }
    }).catch(() => { if (current) onFail?.() })
    return () => { current = false }
  }
  useEffect(() => {
    setSrc(null)
    setReady(false)
    triedFallback.current = false
    return resolve(false)
  }, [link]) // eslint-disable-line react-hooks/exhaustive-deps

  const onActiveRef = useRef(onActive)
  onActiveRef.current = onActive
  useEffect(() => () => onActiveRef.current?.(false), [])

  // Where the video should be now to follow the song, or null (a short part,
  // another song playing, the video's length not known yet).
  const songTarget = (v) => {
    const { currentTrack, progress } = usePlayerStore.getState()
    if (trackId != null && String(currentTrack?.id) !== String(trackId)) return null
    return clipSongTime(clipRange(start, end, v.duration), progress)
  }
  const startAt = (v) => songTarget(v) ?? clipRange(start, end, v.duration).start

  // Back to the start once past the end (checked every frame while it plays:
  // timeupdate comes only a few times a second).
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return undefined
    let frame = 0
    const range = () => clipRange(start, end, v.duration)
    const stopAt = (to) => (Number.isFinite(v.duration) && v.duration > 0 ? Math.min(to, v.duration - 0.05) : to)
    const check = () => {
      const part = range()
      if (v.currentTime >= stopAt(part.end) || v.currentTime < part.start - 0.5) v.currentTime = part.start
      frame = requestAnimationFrame(check)
    }
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check) }
    const halt = () => cancelAnimationFrame(frame)
    const ended = () => { v.currentTime = startAt(v); if (playingRef.current && !isWindowHidden()) v.play().catch(() => {}) }
    v.addEventListener('playing', run)
    v.addEventListener('pause', halt)
    v.addEventListener('ended', ended)
    return () => {
      halt()
      v.removeEventListener('playing', run)
      v.removeEventListener('pause', halt)
      v.removeEventListener('ended', ended)
    }
  }, [src, start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follows the song: a seek moves the video at once; drifting off, it's put
  // back now and then. (Distances are taken round the part: its end and its
  // start are the same place.)
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return undefined
    let lastFix = 0
    const follow = (seeked) => {
      if (v.readyState < 1) return
      const target = songTarget(v)
      if (target == null) return
      const part = clipRange(start, end, v.duration)
      const length = part.end - part.start
      const gap = Math.abs(v.currentTime - target) % length
      const off = Math.min(gap, length - gap)
      if (seeked ? off < 0.3 : off < DRIFT) return
      const now = performance.now()
      if (!seeked && (v.seeking || v.readyState < 3 || now - lastFix < DRIFT_FIX_MS)) return
      lastFix = now
      v.currentTime = target
    }
    let last = { progress: usePlayerStore.getState().progress, at: performance.now() }
    return usePlayerStore.subscribe((state, prev) => {
      if (state.progress === prev.progress) return
      const now = performance.now()
      const expected = last.progress + (prev.isPlaying ? (now - last.at) / 1000 : 0)
      last = { progress: state.progress, at: now }
      follow(Math.abs(state.progress - expected) > SEEK_JUMP)
    })
  }, [src, start, end, trackId]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const failed = () => {
    setReady(false)
    onActive?.(false)
    if (!triedFallback.current) {
      triedFallback.current = true
      setSrc(null)
      resolve(true)
    } else onFail?.()
  }
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
      onLoadedMetadata={e => { e.currentTarget.currentTime = startAt(e.currentTarget) }}
      onSeeked={show}
      onPlaying={show}
      onError={failed}
      onContextMenu={e => e.preventDefault()}
      className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
      // Zoomed in from its centre by the song's Edit Track setting (0-50 %).
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 320ms ease', transform: zoom > 0 ? `scale(${1 + zoom / 100})` : undefined }}
    />
  )
}
