// A Stories slide's moving picture (visualizers/slideScenes.js) in its box: a
// canvas at the screen's pixel density, redrawn every frame and dimmed as the
// scene says. It stops by itself while the window is hidden (no animation
// frames then). Marked with its kind (data-scene), so Share finds where it is
// and draws the same moment itself; html2canvas leaves it out. A scene with a
// frame overflows its box (className sizes the box) as the frame says.

import React, { useEffect, useRef } from 'react'
import { SLIDE_SCENES, sceneClock } from '../visualizers/slideScenes'

export default function SlideScene({ kind, className = '' }) {
  const canvasRef = useRef(null)
  const scene = SLIDE_SCENES[kind]
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !scene) return undefined
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ratio = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const h = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.clearRect(0, 0, w, h)
      scene.draw(ctx, 0, 0, w, h, sceneClock())
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [scene])
  if (!scene) return null
  const canvas = (
    <canvas ref={canvasRef} aria-hidden="true" data-scene={kind} data-share-skip
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
