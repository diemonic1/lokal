// The Recap Stories' "When you listen" slide's background: a sunset over the
// sea, drawn from nothing but gradients and paths. The sky's streaks drift,
// the sun bobs on the horizon, the waves roll and its path on the water
// glitters. Every frame follows from the time alone (no randomness), so the
// screen and the share picture can draw the same moment at any size (see
// slideScenes.js). Ported to the phone as Lokal_android ui/SunsetScene.kt:
// keep the two alike.

/** The sky's top colour. */
export const SKY_TOP = '#1b0f2e'

const HORIZON = 0.42
const SUN_X = 0.32
const WAVES = 15
const STREAKS = 48

/** A stable pseudo-random 0-1 from a number (the streaks' and clouds' own shapes). */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Draws the scene into ctx's box (x, y, w, h) as it is at `t` seconds. */
export function drawSunset(ctx, x, y, w, h, t) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  const u = w / 100
  const horizon = h * HORIZON
  const sunX = w * SUN_X
  const sunR = w * 0.21
  const sunY = horizon + h * 0.012 * Math.sin(t * 0.55)

  // The sky: night at the top, warm towards the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, SKY_TOP)
  sky.addColorStop(0.32, '#3a1844')
  sky.addColorStop(0.6, '#742a52')
  sky.addColorStop(0.84, '#c2513f')
  sky.addColorStop(1, '#f08a44')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, horizon + 1)

  // The sun's glow over the sky.
  const glow = ctx.createRadialGradient(sunX, horizon, 0, sunX, horizon, w * 0.85)
  glow.addColorStop(0, 'rgba(255, 150, 70, 0.55)')
  glow.addColorStop(0.35, 'rgba(240, 100, 70, 0.18)')
  glow.addColorStop(1, 'rgba(200, 60, 90, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, horizon + 1)

  // Streaks of cloud, slanting a little, drifting slowly.
  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < 9; i++) {
    const r = hash(i + 1)
    const cy = horizon * (0.08 + 0.095 * i) + Math.sin(t * 0.18 + i) * u * 0.8
    const thick = u * (1.5 + 5 * hash(i + 11))
    const slope = (i % 2 ? 1 : -1) * (0.04 + 0.03 * r)
    const drift = ((t * (1.2 + r) * u + r * w * 2) % (w * 2.4)) - w * 0.7
    const len = w * (0.7 + 0.6 * hash(i + 21))
    const x0 = drift - len / 2
    const band = ctx.createLinearGradient(x0, 0, x0 + len, 0)
    const warm = 0.35 + 0.65 * (i / 8)
    const color = `rgba(255, ${Math.round(120 + 60 * warm)}, ${Math.round(150 - 60 * warm)}, `
    band.addColorStop(0, color + '0)')
    band.addColorStop(0.5, color + (0.06 + 0.12 * warm).toFixed(3) + ')')
    band.addColorStop(1, color + '0)')
    ctx.fillStyle = band
    ctx.beginPath()
    ctx.moveTo(x0, cy - slope * len / 2)
    ctx.lineTo(x0 + len, cy + slope * len / 2)
    ctx.lineTo(x0 + len, cy + slope * len / 2 + thick)
    ctx.lineTo(x0, cy - slope * len / 2 + thick * 0.4)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  // The sun: a disc sinking into the sea, its own soft halo.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, horizon)
  ctx.clip()
  const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.9, sunX, sunY, sunR * 1.5)
  halo.addColorStop(0, 'rgba(255, 140, 80, 0.45)')
  halo.addColorStop(1, 'rgba(255, 140, 80, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(sunX - sunR * 1.6, sunY - sunR * 1.6, sunR * 3.2, sunR * 3.2)
  const disc = ctx.createLinearGradient(0, sunY - sunR, 0, sunY)
  disc.addColorStop(0, '#b8403a')
  disc.addColorStop(0.55, '#d9572f')
  disc.addColorStop(1, '#ff9a3c')
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // The sea: a deep violet, darker towards the bottom.
  const sea = ctx.createLinearGradient(0, horizon, 0, h)
  sea.addColorStop(0, '#2c2452')
  sea.addColorStop(0.35, '#1f1a44')
  sea.addColorStop(1, '#0c0a1f')
  ctx.fillStyle = sea
  ctx.fillRect(0, horizon, w, h - horizon)

  // The waves, row after row, wider and taller towards the front; their crests
  // catch the sun near its path.
  const shine = ctx.createLinearGradient(sunX - w * 0.55, 0, sunX + w * 0.55, 0)
  shine.addColorStop(0, 'rgba(255, 150, 110, 0)')
  shine.addColorStop(0.5, 'rgba(255, 170, 110, 0.55)')
  shine.addColorStop(1, 'rgba(255, 150, 110, 0)')
  const step = Math.max(2, u * 1.2)
  for (let i = 0; i < WAVES; i++) {
    const f = (i + 1) / WAVES
    const base = horizon + (h - horizon) * Math.pow(f, 1.55) - u * 0.4
    const amp = u * (0.2 + 1.5 * f * f)
    const k1 = (2 * Math.PI) / (w * (0.22 + 0.5 * f))
    const k2 = (2 * Math.PI) / (w * (0.11 + 0.2 * f))
    const p = hash(i + 41) * 10
    const crest = (px) => base
      + amp * (0.65 * Math.sin(px * k1 + t * (0.45 + 0.25 * hash(i + 51)) + p)
        + 0.35 * Math.sin(px * k2 - t * (0.7 + 0.3 * hash(i + 61)) + p * 1.7))
    ctx.beginPath()
    ctx.moveTo(-step, crest(-step))
    for (let px = 0; px <= w + step; px += step) ctx.lineTo(px, crest(px))
    const bottom = Math.min(h, base + (h - horizon) * 0.35)
    ctx.lineTo(w + step, bottom)
    ctx.lineTo(-step, bottom)
    ctx.closePath()
    const body = ctx.createLinearGradient(0, base - amp, 0, bottom)
    const light = 1 - f
    body.addColorStop(0, `rgba(${Math.round(48 + 22 * light)}, ${Math.round(38 + 16 * light)}, ${Math.round(88 + 18 * light)}, 0.9)`)
    body.addColorStop(0.2, `rgba(${Math.round(30 + 10 * light)}, ${Math.round(25 + 8 * light)}, ${Math.round(62 + 12 * light)}, 0.94)`)
    body.addColorStop(1, `rgba(${Math.round(16 + 10 * light)}, ${Math.round(13 + 8 * light)}, ${Math.round(36 + 12 * light)}, 0.95)`)
    ctx.fillStyle = body
    ctx.fill()
    // The crest: a thin bright line, sunlit by the path.
    ctx.beginPath()
    ctx.moveTo(-step, crest(-step))
    for (let px = 0; px <= w + step; px += step) ctx.lineTo(px, crest(px))
    ctx.strokeStyle = shine
    ctx.globalAlpha = 0.25 + 0.5 * (1 - f)
    ctx.lineWidth = Math.max(1, u * 0.22)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // The sun's path: a warm column on the water, glints over it, wider towards the front, flickering.
  ctx.globalCompositeOperation = 'screen'
  ctx.save()
  ctx.translate(sunX, horizon)
  ctx.scale(0.32, 1)
  const column = ctx.createRadialGradient(0, 0, 0, 0, 0, (h - horizon) * 0.75)
  column.addColorStop(0, 'rgba(255, 130, 60, 0.5)')
  column.addColorStop(0.35, 'rgba(200, 80, 60, 0.16)')
  column.addColorStop(1, 'rgba(120, 40, 60, 0)')
  ctx.fillStyle = column
  ctx.fillRect(-w * 2.5, 0, w * 5, h - horizon)
  ctx.restore()
  for (let j = 0; j < STREAKS; j++) {
    const f = Math.pow((j + 0.5) / STREAKS, 1.35)
    const gy = horizon + u * 0.6 + (h - horizon) * 0.62 * f
    const flicker = 0.5 + 0.5 * Math.sin(t * (1.1 + hash(j + 71)) + hash(j + 81) * 20)
    const half = w * (0.06 + 0.26 * f) * (0.45 + 0.55 * flicker) * (0.6 + 0.4 * hash(j + 91))
    const gx = sunX + Math.sin(t * 0.4 + j * 1.9) * w * 0.02 * (0.3 + f) + (hash(j + 101) - 0.5) * w * 0.08 * f
    const alpha = (0.85 - 0.7 * f) * (0.35 + 0.65 * flicker)
    const glint = ctx.createLinearGradient(gx - half, 0, gx + half, 0)
    glint.addColorStop(0, 'rgba(255, 140, 70, 0)')
    glint.addColorStop(0.5, `rgba(255, ${Math.round(150 + 50 * (1 - f))}, 90, ${alpha.toFixed(3)})`)
    glint.addColorStop(1, 'rgba(255, 140, 70, 0)')
    ctx.fillStyle = glint
    ctx.fillRect(gx - half, gy, half * 2, Math.max(1, u * (0.25 + 0.5 * f)))
  }
  // The horizon's own bright line under the sun.
  const line = ctx.createLinearGradient(sunX - w * 0.5, 0, sunX + w * 0.5, 0)
  line.addColorStop(0, 'rgba(255, 150, 80, 0)')
  line.addColorStop(0.5, 'rgba(255, 190, 110, 0.9)')
  line.addColorStop(1, 'rgba(255, 150, 80, 0)')
  ctx.fillStyle = line
  ctx.fillRect(0, horizon - u * 0.15, w, Math.max(1, u * 0.35))
  ctx.globalCompositeOperation = 'source-over'

  // Darker towards the foot, where the player sits.
  const foot = ctx.createLinearGradient(0, h * 0.72, 0, h)
  foot.addColorStop(0, 'rgba(8, 6, 22, 0)')
  foot.addColorStop(1, 'rgba(8, 6, 22, 0.55)')
  ctx.fillStyle = foot
  ctx.fillRect(0, h * 0.72, w, h * 0.28)
  ctx.restore()
}
