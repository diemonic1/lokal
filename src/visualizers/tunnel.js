// The Recap Stories' "your #1 track" slide's background: the "Tunnel" of the
// user's wrapped-visuals sketches. Rectangles nested one in another, each a
// gradient of the song's cover colours (coverColors.js), twist towards a
// vanishing point that wanders round the screen; a loop of 20 s. Bigger
// rectangles round the outside (and the darkest colour under them all) keep
// the whole box covered however they turn. Every frame follows from the time
// alone (see slideScenes.js).

import { css } from './coverColors'

const PERIOD = 20
const TAU = Math.PI * 2
// How many rectangles are drawn outside the sketch's biggest one.
const OUTSIDE = 4

/** Draws the tunnel into ctx's box (x, y, w, h) as it is at `t` seconds, in `colors` (coverColors). */
export function drawTunnel(ctx, x, y, w, h, t, colors) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  ctx.fillStyle = css(colors.lo)
  ctx.fillRect(0, 0, w, h)
  const a = ((t % PERIOD) / PERIOD) * TAU
  const twist = 0.09 + 0.06 * Math.sin(a * 2)
  const vx = w * (0.5 + 0.2 * Math.sin(a))
  const vy = h * (0.55 + 0.14 * Math.sin(2 * a + 1))
  for (let i = -OUTSIDE; i < 30; i++) {
    const k = Math.pow(0.885, i)
    const s = h * 1.25 * k
    const cx = vx + (w / 2 - vx) * k
    const cy = vy + (h / 2 - vy) * k
    const rw = s
    const rh = s * 0.72
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a + i * twist)
    const g = ctx.createLinearGradient(-rw / 2, -rh / 2, rw / 2, rh / 2)
    g.addColorStop(0, css(colors.hi))
    g.addColorStop(0.5, css(colors.mid))
    g.addColorStop(1, css(colors.lo))
    ctx.fillStyle = g
    ctx.fillRect(-rw / 2, -rh / 2, rw, rh)
    ctx.restore()
  }
  ctx.restore()
}
