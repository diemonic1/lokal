// More of the Recap Stories' slides' backgrounds, from the user's
// wrapped-visuals sketches (as tunnel.js): dunes, interference, Truchet
// tiles, cubes, Riley waves and the pulsar, each in its slide's song's cover
// colours (coverColors.js) over the darkest of them, filling its box; and the
// op-art chessboard in its own fixed colours (the radio has no cover). Each is a loop
// and every frame follows from the time alone (see slideScenes.js). Ported to
// the phone as Lokal_android ui/WrappedScenes.kt: keep the two alike.

import { css, ramp } from './coverColors'

const TAU = Math.PI * 2
const frac = x => x - Math.floor(x)
const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** A sketch as a scene: `body(ctx, w, h, p, colors)` with p the loop's 0-1, in its box over the darkest colour. */
function looped(period, body) {
  return (ctx, x, y, w, h, t, colors) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.clip()
    ctx.fillStyle = css(colors.lo)
    ctx.fillRect(0, 0, w, h)
    body(ctx, w, h, frac(t / period), colors)
    ctx.restore()
  }
}

/** "Dunes": wavy ridges stacked back to front. */
export const drawDunes = looped(9, (ctx, W, H, p, c) => {
  const a = p * TAU
  const L = 13
  for (let i = 0; i < L; i++) {
    const base = H * (0.1 + i * 0.075)
    const amp = H * (0.03 + 0.02 * Math.sin(a + i * 0.7))
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
    ctx.shadowBlur = H * 0.03
    ctx.shadowOffsetY = -H * 0.006
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W + 4; x += 4) {
      ctx.lineTo(x, base
        + amp * Math.sin((x / W) * TAU * 1.5 + a * (i % 2 ? 1 : -1) + i)
        + amp * 0.6 * Math.sin((x / W) * TAU * 3.2 - 2 * a + i * 1.3))
    }
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, base - amp * 2, 0, base + H * 0.12)
    g.addColorStop(0, ramp(c, 0.55 + 0.45 * (i / (L - 1))))
    g.addColorStop(0.5, ramp(c, 0.4))
    g.addColorStop(1, css(c.lo))
    ctx.fillStyle = g
    ctx.fill()
    ctx.restore()
  }
})

/** "Interference": a grid of dots swelling with two circular waves. */
export const drawInterference = looped(6, (ctx, W, H, p, c) => {
  const a = p * TAU
  const step = W / 13
  const s1 = { x: W * (0.5 + 0.3 * Math.sin(a)), y: H * 0.3 }
  const s2 = { x: W * (0.5 - 0.3 * Math.sin(a)), y: H * 0.7 }
  const f = TAU / (W * 0.3)
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const d1 = Math.hypot(x - s1.x, y - s1.y)
      const d2 = Math.hypot(x - s2.x, y - s2.y)
      const v = (Math.sin(d1 * f - a) + Math.sin(d2 * f - a)) / 4 + 0.5
      ctx.fillStyle = ramp(c, v)
      ctx.beginPath()
      ctx.arc(x, y, step * 0.5 * (0.15 + 0.85 * v), 0, TAU)
      ctx.fill()
    }
  }
})

/** "Truchet": tiles of quarter circles, flipping in eased quarter turns. */
export const drawTruchet = looped(8, (ctx, W, H, p, c) => {
  const cols = 6
  const s = W / cols
  const rows = Math.ceil(H / s)
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const seed = frac(Math.sin(r * 12.9898 + col * 78.233) * 43758.5453)
      const q = frac(p + (col + r) * 0.045) * 4
      const angle = (Math.floor(seed * 4) * TAU) / 4 + (TAU / 4) * (Math.floor(q) + easeInOut(Math.min(1, frac(q) * 1.6)))
      ctx.save()
      ctx.translate(col * s + s / 2, r * s + s / 2)
      ctx.fillStyle = ramp(c, 0.08)
      ctx.fillRect(-s / 2, -s / 2, s, s)
      ctx.rotate(angle * (seed > 0.5 ? 1 : -1))
      ctx.fillStyle = ramp(c, 0.75 + 0.25 * seed)
      ctx.beginPath()
      ctx.moveTo(-s / 2, -s / 2)
      ctx.arc(-s / 2, -s / 2, s * 0.98, 0, Math.PI / 2)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = ramp(c, 0.45)
      ctx.beginPath()
      ctx.moveTo(s / 2, s / 2)
      ctx.arc(s / 2, s / 2, s * 0.5, Math.PI, Math.PI * 1.5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }
})

/** "Cubes": an isometric field of columns rising and falling in a wave. */
export const drawCubes = looped(10, (ctx, W, H, p, c) => {
  const a = p * TAU
  const e = W / 9
  const ex = e * Math.cos(Math.PI / 6)
  const M = Math.ceil(((H + 4 * e) / e) * 2)
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, e * 0.02)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
  const face = (points, color) => {
    ctx.fillStyle = color
    ctx.beginPath()
    points.forEach(([px, py]) => ctx.lineTo(px, py))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  for (let sum = 0; sum <= 2 * M; sum++) {
    for (let i = 0; i <= sum; i++) {
      const j = sum - i
      if (i > M || j > M) continue
      const x = W / 2 + (i - j) * ex
      if (x < -ex || x > W + ex) continue
      const y = -e * 2 + ((i + j) * e) / 2
      const v = 0.5 + 0.5 * Math.sin(a - (Math.hypot(x - W / 2, y - H / 2) / H) * TAU * 1.4)
      const yt = y - e * (0.15 + 1.1 * v)
      face([[x - ex, yt], [x, yt + e / 2], [x, y + e / 2], [x - ex, y]], ramp(c, 0.25 + 0.3 * v))
      face([[x + ex, yt], [x, yt + e / 2], [x, y + e / 2], [x + ex, y]], ramp(c, 0.05 + 0.15 * v))
      face([[x, yt - e / 2], [x + ex, yt], [x, yt + e / 2], [x - ex, yt]], ramp(c, 0.55 + 0.45 * v))
    }
  }
})

/** "Riley waves": Bridget Riley-style stripes bent by travelling waves. */
export const drawRiley = looped(8, (ctx, W, H, p, c) => {
  const a = p * TAU
  const N = 24
  const w = W / N
  const edge = (i, y) => i * w + W * 0.08 * Math.sin((y / H) * TAU * 1.2 + a + i * 0.2) * (0.6 + 0.4 * Math.sin(a - i * 0.15))
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, css(c.hi))
  g.addColorStop(0.5, css(c.mid))
  g.addColorStop(1, css(c.hi))
  ctx.fillStyle = g
  const step = Math.max(2, H / 140)
  for (let i = -4; i < N + 4; i += 2) {
    ctx.beginPath()
    for (let y = -8; y <= H + 8; y += step) ctx.lineTo(edge(i, y), y)
    for (let y = H + 8; y >= -8; y -= step) ctx.lineTo(edge(i + 1, y), y)
    ctx.closePath()
    ctx.fill()
  }
})

/** "Pulsar": Joy Division's "Unknown Pleasures" ridgelines, top to bottom. */
export const drawPulsar = looped(8, (ctx, W, H, p, c) => {
  const a = p * TAU
  const N = 44
  const gap = H / (N - 4)
  // The sketch's sizes are for a phone-sized screen in CSS pixels: scaled to the box.
  const k = W / 450
  ctx.lineWidth = Math.max(1.2 * k, W * 0.004)
  ctx.lineJoin = 'round'
  const step = 4 * k
  for (let i = 0; i < N; i++) {
    const y0 = i * gap
    ctx.beginPath()
    ctx.moveTo(-2, y0)
    for (let x = 0; x <= W + step; x += step) {
      const env = Math.exp(-(((x - W / 2) / (W * 0.27)) ** 2))
      const n = (Math.sin(x / k * 0.045 + i * 1.7 + a) + Math.sin(x / k * 0.083 - i * 0.9 - 2 * a) + Math.sin(x / k * 0.019 + i * 2.3 + a)) / 3
      ctx.lineTo(x, y0 - env * H * 0.1 * (0.5 + 0.5 * n) ** 2)
    }
    ctx.lineTo(W + step, y0)
    ctx.lineTo(W + step, H + 4)
    ctx.lineTo(-2, H + 4)
    ctx.closePath()
    ctx.fillStyle = css(c.lo)
    ctx.fill()
    ctx.strokeStyle = ramp(c, 0.55 + 0.45 * (i / (N - 1)))
    ctx.stroke()
  }
})

// The op-art chessboard's own colours.
export const OP_LIGHT = '#d8cbb1'
const OP_DARK = '#282624'
const OP_STEPS = 25
const OP_AFTER_DEPTH = (7.2 * Math.PI) / 180
let opTile = null

/**
 * One square of "Geometric Abstraction op art" (Stijn Van Minnebruggen, codepen.io/donotfold/pen/XWvqbYX)
 * seen from above, at `phase` of its loop: 25 dark squares flipping round the diagonal, each with a light
 * layer tilting a little further just behind it, painted back to front on each side of the axis.
 */
function drawOpTile(t, S, phase) {
  const h = S / 2
  t.setTransform(1, 0, 0, 1, h, h)
  t.fillStyle = OP_LIGHT
  t.fillRect(-h, -h, S, S)
  const planes = []
  for (let i = 1; i <= OP_STEPS; i++) {
    const f = frac(phase - i / OP_STEPS)
    const th = Math.PI * f
    const tilt = OP_AFTER_DEPTH * (f < 0.5 ? 2 * f : 2 - 2 * f)
    planes.push({ th, color: OP_DARK, behind: 0 })
    planes.push({ th: th + tilt, color: OP_LIGHT, behind: 1 })
  }
  for (const plane of planes) {
    // A light layer can lie exactly in a dark square's plane: nudged, so the order doesn't flip on float noise.
    plane.k = Math.tan(plane.th - plane.behind * 1e-9)
    plane.w = h * Math.abs(Math.cos(plane.th))
  }
  for (const side of [1, -1]) {
    const order = planes.slice().sort((m, n) => (side * (m.k - n.k)) || (n.behind - m.behind))
    for (const plane of order) {
      t.fillStyle = plane.color
      t.beginPath()
      t.moveTo(-h, -h)
      t.lineTo(h, h)
      t.lineTo(-side * plane.w, side * plane.w)
      t.closePath()
      t.fill()
    }
  }
}

/** "Chess (op art)": those squares on every other square of a tilted, gently swaying board; fixed colours. */
export function drawChess(ctx, x, y, w, h, t) {
  const W = w
  const H = h
  const p = frac(t / 10)
  const a = p * TAU
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.rect(0, 0, W, H)
  ctx.clip()
  ctx.fillStyle = OP_LIGHT
  ctx.fillRect(0, 0, W, H)
  const cell = W * 0.3
  const S = Math.max(1, Math.ceil(cell))
  opTile ||= document.createElement('canvas')
  if (opTile.width !== S) opTile.width = opTile.height = S
  // The original loop is 5 s: twice in each 10 s sway.
  drawOpTile(opTile.getContext('2d'), S, frac(p * 2))
  const N = 9
  ctx.translate(W / 2 + W * 0.06 * Math.sin(a), H / 2 + H * 0.035 * Math.sin(2 * a))
  ctx.rotate(((30 + 5 * Math.sin(a + 0.6)) * Math.PI) / 180)
  const scale = 1 + 0.05 * Math.sin(2 * a)
  ctx.scale(scale, scale)
  for (let r = 0; r < N; r++) {
    for (let col = 0; col < N; col++) {
      if ((r + col) % 2) continue
      ctx.drawImage(opTile, (col - N / 2) * cell, (r - N / 2) * cell, cell, cell)
    }
  }
  ctx.restore()
}
