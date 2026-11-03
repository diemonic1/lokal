// A Stories slide's moving picture (visualizers/slideScenes.js) in its box: a
// canvas at the screen's pixel density, redrawn every frame and dimmed as the
// scene says. It stops by itself while the window is hidden (no animation
// frames then). Marked with its kind (data-scene), so Share finds where it is
// and draws the same moment itself; html2canvas leaves it out. A scene with a
// frame overflows its box (className sizes the box) as the frame says. A
// scene in its cover's colours takes them from `track`'s cover (as the player
// bar's gradient does), and shows once they're read; they go with it to Share
// (data-colors).

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SLIDE_SCENES, sceneClock } from '../visualizers/slideScenes'
import { loadMesh } from './ArtworkBackdrop'
import { coverPalette } from './CoverGradient'

// When the cover has no colours to give: the sketch's own red and pink.
const FALLBACK = [[255, 26, 31], [255, 85, 220]]

export default function SlideScene({ kind, track, className = '' }) {
  const canvasRef = useRef(null)
  const scene = SLIDE_SCENES[kind]
  const trackId = scene?.colors ? track?.id : null
  const [grid, setGrid] = useState({ id: undefined, value: null })
  useEffect(() => {
    if (!scene?.colors) return undefined
    let alive = true
    loadMesh(trackId).then(value => { if (alive) setGrid({ id: trackId, value }) })
    return () => { alive = false }
  }, [scene, trackId])
  const colors = useMemo(() => {
    if (!scene?.colors || grid.id !== trackId) return null
    const palette = coverPalette(grid.value)
    return scene.colors(palette.length ? palette : FALLBACK)
  }, [scene, grid, trackId])
  const ready = !scene?.colors || !!colors
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !scene || !ready) return undefined
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ratio = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const h = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.clearRect(0, 0, w, h)
      scene.draw(ctx, 0, 0, w, h, sceneClock(), colors)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [scene, ready, colors])
  if (!scene || !ready) return null
  const canvas = (
    <canvas ref={canvasRef} aria-hidden="true" data-scene={kind} data-colors={colors ? JSON.stringify(colors) : undefined} data-share-skip
      className={`pointer-events-none block ${scene.frame ? 'absolute' : className}`}
      style={{ filter: `brightness(${scene.brightness})`, ...frameStyle(scene.frame) }} />
  )
  return scene.frame ? <div aria-hidden className={`pointer-events-none relative ${className}`}>{canvas}</div> : canvas
}

/** Where a framed scene's canvas goes in its box: `scale` times as big round the middle, `down` lower. */
function frameStyle(frame) {
  if (!frame) return {}
  const over = (frame.scale - 1) / 2
  return {
    left: `${-over * 100}%`, top: `${(-over + frame.down) * 100}%`,
    width: `${frame.scale * 100}%`, height: `${frame.scale * 100}%`,
  }
}
