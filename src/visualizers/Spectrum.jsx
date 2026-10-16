// The player bar's centre visualization: a row of spectrum bars standing on
// the bar's bottom edge and jumping up with the music (after the classic
// "JS Audio Visualizer" pen). Low notes on the left, high on the right.
//   bars       how many bars
//   barWidth   each bar's width, px (1 px apart)
//   height     the tallest a bar gets, px
//   strength   how high the music throws them, 1 = as loud as it is
//   color      #rrggbb, 'accent' for the accent colour; anything else: white
//   opacity    0-1
//   mirrored   grows up and down from its middle line instead of up from its
//              bottom edge (the player bar's "Spectrum from the center", on
//              the line through the playback buttons): twice as high, and
//              nothing at all while it's silent

import React, { useEffect, useRef } from 'react'
import { getAnalyser, pickColor, sliceLevel, spectrumSlices, useAnalyserVersion } from './audio'

const GAP = 1
// 30 frames a second, like the waveform: inside the glass player bar each
// repaint also redoes its blur.
const FRAME_MS = 1000 / 30

export default function Spectrum({ isPlaying, bars = 119, barWidth = 4, height = 76, strength = 0.58, color = '#ffffff', opacity = 0.2, mirrored = false, className = '' }) {
  const canvasRef = useRef(null)
  const levelsRef = useRef(null)
  const analyserVersion = useAnalyserVersion()
  const width = bars * (barWidth + GAP) - GAP
  const canvasHeight = mirrored ? height * 2 : height

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(canvasHeight * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const fill = pickColor(color, '#ffffff')

    if (!levelsRef.current || levelsRef.current.length !== bars) levelsRef.current = new Float32Array(bars)
    const levels = levelsRef.current
    const analyser = getAnalyser()
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null

    // Each bar takes a slice of the spectrum, narrow in the bass and wider
    // towards the highs.
    const ranges = analyser ? spectrumSlices(analyser, bars) : []

    let frame = null
    let last = 0
    const draw = (now = performance.now()) => {
      frame = requestAnimationFrame(draw)
      if (now - last < FRAME_MS - 1) return
      last = now
      if (analyser && isPlaying) analyser.getByteFrequencyData(data)
      let moving = false
      for (let i = 0; i < bars; i++) {
        let target = 0
        if (analyser && isPlaying) {
          const peak = sliceLevel(data, ranges[i])
          // The highs are quieter: lifted a little so the right side moves too.
          const lift = 1 + (i / bars) * 0.6
          target = Math.min(1, (peak / 255) * strength * lift)
        }
        // Up at once, down gently.
        levels[i] = target > levels[i] ? target : levels[i] + (target - levels[i]) * 0.25
        if (levels[i] > 0.002) moving = true
      }
      ctx.clearRect(0, 0, width, canvasHeight)
      ctx.fillStyle = fill
      for (let i = 0; i < bars; i++) {
        if (mirrored) {
          // Half above the middle line, half below: shrinks to nothing.
          const h = levels[i] * height
          if (h >= 0.25) ctx.fillRect(i * (barWidth + GAP), height - h, barWidth, h * 2)
          continue
        }
        const h = Math.round(levels[i] * height)
        if (h > 0) ctx.fillRect(i * (barWidth + GAP), height - h, barWidth, h)
      }
      // Paused (or no audio yet): once the bars have fallen, stop drawing.
      if (!moving && !(analyser && isPlaying)) { cancelAnimationFrame(frame); frame = null }
    }
    draw()
    return () => { if (frame) cancelAnimationFrame(frame) }
  }, [isPlaying, bars, barWidth, height, strength, color, width, canvasHeight, mirrored, analyserVersion])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ display: 'block', width, height: canvasHeight, opacity }}
    />
  )
}
