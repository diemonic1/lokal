// The side panel's trails: Clément Roche's "Canvas Audio Visualizer"
// (codepen.io/ClementRoche/pen/dgwavz) on a 2D canvas. Each dot listens to
// one frequency, from the deepest bass up to about 13 kHz: the louder it is,
// the bigger it gets and the less it wanders. The bass spreads them all out
// from the centre (the pen's circles[3]). Every frame the old picture fades a
// little instead of being cleared, which leaves the trails; how much it fades
// is the pen's slider (Trails life here).
//
// Colours: the pen's (red in the bass, through orange and yellow to green), or
// two of one's own: each dot gets a shade near one of them, and the shades
// drift a little over time, so the two colours shimmer.
//
// Layout: round the middle (the pen's), or all over the box (fill): there
// each dot keeps to its own place and circles it with the bass.
//
// Paused, the audio stops (App.jsx suspends it) and the analyser keeps its
// last frame: the dots don't go on wandering on it but fold in and fade,
// as at a quiet start, and wake up again with the music.
//
// The canvas is see-through (it fades by erasing), so the background colour
// and the cover behind it show. It fills its box, under the floating player
// bar too; the dots circle the middle of the part above it (--player-space).
// It only runs while mounted (RightSidebar mounts it through useSideVisual,
// which is 'off' in eco mode).

import React, { useEffect, useRef } from 'react'
import { getAnalyser, pickColor, playerCovered } from './audio'
import { usePlayerStore } from '../store/player'
import { TRAILS_DEFAULTS } from './trailsSettings'

const TAU = Math.PI * 2
// The pen's 600 dots were its first 600 of 1024 bins: up to about 13 kHz.
const TOP_HZ = 12900
// The pen's bass bin (circles[3]: 3 x 21.5 Hz).
const BASS_HZ = 65

// 2D simplex noise (Stefan Gustavson's), what the pen's SimplexNoise gave.
function makeNoise() {
  const perm = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  const corner = (gi, x, y) => {
    const t = 0.5 - x * x - y * y
    if (t < 0) return 0
    const g = grad[gi & 7]
    return t * t * t * t * (g[0] * x + g[1] * y)
  }
  return (xin, yin) => {
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    return 70 * (corner(perm[ii + perm[jj]], x0, y0)
      + corner(perm[ii + i1 + perm[jj + j1]], x1, y1)
      + corner(perm[ii + 1 + perm[jj + 1]], x2, y2))
  }
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16 & 255) / 255
  const g = (n >> 8 & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

function makeDots(count) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    xR: Math.random(),
    yR: Math.random(),
    i: 0,
    value: 0,
    // Which of the two custom colours, and how far its shade strays.
    pick: Math.random(),
    hueJitter: Math.random() * 2 - 1,
    lightJitter: Math.random() * 2 - 1,
    x: 0,
    y: 0,
  }))
}

// A level (0-255) at `hz`, between the two nearest bins.
function levelAt(data, binHz, hz) {
  const pos = Math.min(data.length - 1, hz / binHz)
  const bin = Math.floor(pos)
  const next = Math.min(data.length - 1, bin + 1)
  return data[bin] + (data[next] - data[bin]) * (pos - bin)
}

export default function Trails({ className = '', settings = TRAILS_DEFAULTS }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  // Read each frame, so a change applies without restarting the scene.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const playingRef = useRef(false)
  playingRef.current = usePlayerStore(s => s.isPlaying)
  // The custom colours, resolved here ('accent' reads a CSS variable).
  const color1 = pickColor(settings.color1, TRAILS_DEFAULTS.color1)
  const color2 = pickColor(settings.color2, TRAILS_DEFAULTS.color2)
  const paletteRef = useRef(null)
  paletteRef.current = [hexToHsl(color1), hexToHsl(color2)]

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    // Read back now and then (scrub): kept on the CPU side for that.
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const noise = makeNoise()
    let dots = []
    let data = new Uint8Array(0)
    let width = 1
    let height = 1
    let seen = 1
    let radius = 0
    // 1 while the music plays, easing to 0 when it pauses (the dots fold in).
    let live = 0
    let frame = null
    let last = 0
    // Seconds since the last scrub, and since the dots folded in on a pause.
    let sinceScrub = 0
    let stillFor = 0

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, wrap.clientWidth)
      height = Math.max(1, wrap.clientHeight)
      // Only the part of the box the player bar covers is left out: over the
      // lyrics (Visualization + Lyrics) the box ends above it, and the circle
      // is in its middle.
      seen = Math.max(1, height - playerCovered(wrap))
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const scrub = () => {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const px = image.data
      let wiped = false
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] !== 0 && px[i] < 26) { px[i - 3] = px[i - 2] = px[i - 1] = px[i] = 0; wiped = true }
      }
      if (wiped) ctx.putImageData(image, 0, 0)
    }

    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      // A long gap (the window was hidden) is skipped rather than caught up.
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      const s = settingsRef.current
      const count = Math.round(s.count)
      if (dots.length !== count) dots = makeDots(count)

      const analyser = getAnalyser()
      const playing = playingRef.current && (!analyser?.context?.state || analyser.context.state === 'running')
      live += ((playing ? 1 : 0) - live) * (1 - Math.exp(-dt * (playing ? 3 : 4)))
      if (live < 0.02 && !playing) live = 0
      // Paused: the last frame stays, shrinking with `live`.
      if (!playing && data.length) { /* keep it */ } else if (analyser) {
        if (data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
      } else data.fill(0)
      const binHz = analyser ? (analyser.context?.sampleRate || 44100) / 2 / Math.max(1, data.length) : 1
      const gain = s.sensitivity / 100
      const read = hz => (data.length ? Math.min(255, levelAt(data, binHz, hz) * gain) * live : 0)

      // Folded in and faded: the canvas is cleared, and nothing more is drawn
      // until the music plays again.
      stillFor = live === 0 ? stillFor + dt : 0
      if (stillFor > 0.8) {
        if (stillFor - dt <= 0.8) ctx.clearRect(0, 0, width, height)
        return
      }

      // The pen's fade (its slider: alpha 0-1 a frame at 60 fps), however
      // fast the frames come.
      const fade = Math.max(0.004, 1 - s.life / 100)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(1 - fade, dt * 60)})`
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'source-over'
      // Fading by a share each frame never quite reaches nothing: the canvas
      // keeps 8 bits of alpha, and a pixel a few steps above zero stays
      // there, leaving pale smudges where the dots went. Now and then those
      // nearly gone pixels are wiped.
      sinceScrub += dt
      if (sinceScrub > 0.25) {
        sinceScrub = 0
        scrub()
      }

      // The pen eased its spread to the bass over 2 s; folding in is quicker.
      radius += (read(BASS_HZ) - radius) * (1 - Math.exp(-dt * (playing ? 2.5 : 6)))
      // The pen's sizes were for a full screen: here they follow the panel.
      const scale = Math.min(width, seen) / 1000
      const dotScale = Math.max(0.45, scale) * (s.size / 100)
      // How big the whole picture is: how far the dots spread and wander.
      const spread = s.scale / 100
      const fill = s.layout === 'fill'
      const cx = width / 2
      const cy = seen / 2
      // Folding in, they slow down to a stop.
      const step = 0.6 * dt * (s.speed / 100) * live
      const custom = s.colorMode === 'custom'
      const palette = paletteRef.current
      const sheen = s.shimmer / 100
      const time = now / 1000

      for (const dot of dots) {
        const share = dot.index / count
        const value = read(share * TOP_HZ)
        dot.value = value
        if (value < 0.3) continue
        let xC
        let yC
        if (fill) {
          // Its own place in the box (all of it, under the player bar too),
          // circled with the bass.
          const orbit = radius * Math.max(0.5, scale) * 0.5 * spread
          xC = dot.xR * width + orbit * Math.cos(dot.index + dot.i)
          yC = dot.yR * height + orbit * Math.sin(dot.index + dot.i)
        } else {
          xC = radius * scale * spread * 2 * dot.xR * Math.cos(dot.index + dot.i) + cx
          yC = radius * scale * spread * 2 * dot.yR * Math.sin(dot.index + dot.i) + cy
        }
        // The pen's wander: quieter dots stray further. Folding in, it goes too.
        const p = (210 - value / Math.max(live, 0.05)) * 0.5 * Math.max(0.5, scale) * spread * live
        dot.y = noise(dot.xR, dot.i) * p + yC
        dot.x = noise(dot.yR, dot.i) * p + xC
        dot.i += step

        if (custom) {
          // Lower notes lean to the first colour, higher to the second.
          const [h, sat, l] = palette[dot.pick < 0.8 - 0.6 * share ? 0 : 1]
          const hue = h + dot.hueJitter * 18 * sheen + Math.sin(time * 0.8 + dot.index * 0.07) * 14 * sheen
          const light = Math.max(8, Math.min(92, l * (0.55 + 0.45 * value / 255) + dot.lightJitter * 10 * sheen))
          ctx.fillStyle = `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`
        } else {
          // The pen's: index / bufferLength, its 600 of 1024 bins.
          const t = share * 600 / 1024
          ctx.fillStyle = `rgb(${Math.round(Math.min(255, value + 25 * t))},${Math.round(Math.min(255, 500 * t))},50)`
        }
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, value * 0.1 * dotScale, 0, TAU)
        ctx.fill()
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    frame = requestAnimationFrame(tick)
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      frame = null
    }
  }, [])

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 block" />
    </div>
  )
}
