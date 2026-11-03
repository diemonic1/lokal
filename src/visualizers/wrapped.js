// More of the Recap Stories' slides' backgrounds, from the user's
// wrapped-visuals sketches (as tunnel.js): dunes, stars, interference,
// Truchet tiles and cubes, each in its slide's song's cover colours
// (coverColors.js) over the darkest of them, filling its box. Each is a loop
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

/** "Stars": nested five-point stars spinning, their spikes breathing. */
export const drawStars = looped(18, (ctx, W, H, p, c) => {
  const a = p * TAU
  const N = 22
  const cx = W * (0.5 + 0.1 * Math.sin(a))
  const cy = H * (0.5 + 0.08 * Math.sin(2 * a))
  for (let i = 0; i < N; i++) {
    const R = H * 0.9 * Math.pow(0.87, i)
    const inner = 0.42 + 0.14 * Math.sin(2 * a + i * 0.35)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a + i * (0.1 + 0.06 * Math.sin(a)))
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
    ctx.shadowBlur = W * 0.03
    ctx.beginPath()
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? R * inner : R
      const angle = -Math.PI / 2 + (k * TAU) / 10
      ctx.lineTo(r * Math.cos(angle), r * Math.sin(angle))
    }
    ctx.closePath()
    const g = ctx.createLinearGradient(-R, -R, R, R)
    const flip = i % 2
    g.addColorStop(0, css(flip ? c.mid : c.hi))
    g.addColorStop(0.6, css(flip ? c.lo : c.mid))
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
