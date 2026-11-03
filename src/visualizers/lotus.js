// The Recap Stories' first slide's picture: VoXelo's "Quantum Lotus Geometry"
// (a three.js pen) redrawn flat: a glowing dodecahedron with sparks running
// along its edges, a three-layer lotus opening and closing inside it, and
// stardust swirling round, seen from above (the pen's camera raised, no
// orbiting) and added up as light. No bloom: the glow is soft gradients, and
// the colours are the pen's as its tone mapping and bloom show them (paler).
// Every frame follows from the time alone (see slideScenes.js). Ported to the phone as
// Lokal_android ui/LotusScene.kt: keep the two alike.

const PHI = (1 + Math.sqrt(5)) / 2
const RADIUS = 2.8
const CAMERA = [1.9, 5.3, 7.2]
const DUST = 500

const VIOLET = [138, 44, 255]
const EMERALD = [0, 255, 157]
const GOLD = [255, 215, 0]
const WHITE = [255, 255, 255]
// As the pen shows them: the petals pink to white, the orbs mint, the edges pale.
const ORCHID = [205, 70, 185]
const PINK = [255, 115, 185]
const CREAM = [255, 215, 150]
const MINT = [140, 235, 180]
const LILAC = [175, 160, 255]

/** A stable pseudo-random 0-1 from a number. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const rgba = (c, a) => `rgba(${Math.round(Math.min(255, c[0]))}, ${Math.round(Math.min(255, c[1]))}, ${Math.round(Math.min(255, c[2]))}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`

// The dodecahedron: its 20 corners at RADIUS, and its 30 edges (the closest pairs).
const CORNERS = (() => {
  const list = []
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) list.push([x, y, z])
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    list.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI])
  }
  const scale = RADIUS / Math.sqrt(3)
  return list.map(p => p.map(v => v * scale))
})()
const EDGES = (() => {
  const length = (2 / PHI) * (RADIUS / Math.sqrt(3))
  const list = []
  for (let i = 0; i < CORNERS.length; i++) for (let j = i + 1; j < CORNERS.length; j++) {
    const d = Math.hypot(...CORNERS[i].map((v, k) => v - CORNERS[j][k]))
    if (Math.abs(d - length) < 0.1) list.push([i, j])
  }
  return list
})()
const LAYERS = [
  { petals: 10, size: 1.0, open: 1.1, from: ORCHID, to: PINK, spin: 0.2, turn: 0 },
  { petals: 8, size: 0.75, open: 0.7, from: PINK, to: CREAM, spin: -0.3, turn: Math.PI / 8 },
  { petals: 6, size: 0.5, open: 0.3, from: CREAM, to: WHITE, spin: 0.5, turn: Math.PI / 4 },
]

// The camera, looking at the middle from the pen's place.
const VIEW = (() => {
  const len = Math.hypot(...CAMERA)
  const f = CAMERA.map(v => -v / len)
  const rl = Math.hypot(f[2], f[0])
  const r = [-f[2] / rl, 0, f[0] / rl]
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
  return { f, r, u }
})()

/** Euler XYZ (as three.js): Rx · Ry · Rz · p. */
function rotate([x, y, z], ax, ay, az) {
  let c = Math.cos(az), s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c]
  c = Math.cos(ay); s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(ax); s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c]
  return [x, y, z]
}

// How far the picture reaches (left/right, up, down) at a focal length of 1, over a whole turn of the
// dodecahedron with its orbs at their biggest: zoomed so this just fills the box, it never leaves it.
const EXTENT = (() => {
  const { f, r, u } = VIEW
  let side = 0, top = 0, bottom = 0
  for (let t = 0; t < 2 * Math.PI / 0.15; t += 0.1) {
    const ay = t * 0.15
    const ax = Math.sin(t * 0.1) * 0.08
    const az = Math.cos(t * 0.08) * 0.05
    for (const lift of [-0.12, 0.12]) {
      for (const corner of CORNERS) {
        const q = rotate(corner, ax, ay, az)
        const d = [q[0] - CAMERA[0], q[1] + lift - CAMERA[1], q[2] - CAMERA[2]]
        const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]
        const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / depth
        const y = -(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / depth
        const orb = (0.24 * 1.3 * 1.35) / depth
        side = Math.max(side, Math.abs(x) + orb)
        top = Math.min(top, y - orb)
        bottom = Math.max(bottom, y + orb)
      }
    }
  }
  return { side, top, bottom }
})()

/** Draws the scene into ctx's box (x, y, w, h), see-through, as it is at `t` seconds. */
export function drawLotus(ctx, x, y, w, h, t) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  ctx.globalCompositeOperation = 'lighter'
  const focal = Math.min(w / (2 * EXTENT.side), h / (EXTENT.bottom - EXTENT.top))
  const cx = w / 2
  const cy = h / 2 - focal * (EXTENT.top + EXTENT.bottom) / 2
  const px = Math.min(w, h) / 600
  const { f, r, u } = VIEW
  const project = ([wx, wy, wz]) => {
    const d = [wx - CAMERA[0], wy - CAMERA[1], wz - CAMERA[2]]
    const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]
    const k = focal / depth
    return [cx + (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) * k, cy - (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) * k, k]
  }
  const surge = Math.pow(Math.sin(t * 1.8) * 0.5 + 0.5, 3)
  const flicker = 0.8 + surge * 0.6
  const lift = Math.sin(t * 0.6) * 0.12

  // Stardust, circling the middle (faster close in), twinkling.
  for (let i = 0; i < DUST; i++) {
    const radius = 0.5 + Math.pow(hash(i * 3 + 1), 2) * 5
    const angle0 = hash(i * 3 + 2) * Math.PI * 2
    const scale = hash(i * 5 + 7)
    const colorMix = hash(i * 7 + 3)
    const angle = angle0 + t * (0.3 / radius) + t * 0.03
    const wy = (hash(i * 3 + 3) - 0.5) * 3 + Math.sin(t * 1.2 + radius * 3 + scale * 8) * 0.05
    const point = [Math.cos(angle) * radius, wy, -Math.sin(angle) * radius]
    const alpha = (0.2 + 0.6 * Math.sin(t * 2 + scale * 10)) * (1 - smooth(0, 6, Math.hypot(...point)))
    if (alpha <= 0.01) continue
    const [sx, sy, k] = project(point)
    let color = mix(EMERALD, GOLD, smooth(0.2, 0.8, colorMix))
    color = mix(color, VIOLET, smooth(0.7, 1, colorMix) * 0.5)
    ctx.fillStyle = rgba(color, alpha)
    // As the pen's points: (12 · scale + 2) / depth pixels across.
    const size = Math.max(0.35 * px, ((12 * scale + 2) * k / focal) * 0.55 * px)
    ctx.beginPath()
    ctx.arc(sx, sy, size, 0, Math.PI * 2)
    ctx.fill()
  }

  // The lotus: three layers of petals, each its own way round, opening with the pulse.
  const coreY = -1.25 + lift
  const coreTurn = -t * 0.2
  const [lx, ly, lk] = project([0, coreY + 0.85, 0])
  const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, 1.9 * lk)
  halo.addColorStop(0, rgba(WHITE, 0.55 * flicker))
  halo.addColorStop(0.25, rgba(CREAM, 0.3 * flicker))
  halo.addColorStop(0.6, rgba(PINK, 0.1 * flicker))
  halo.addColorStop(1, rgba(PINK, 0))
  ctx.fillStyle = halo
  ctx.fillRect(lx - 2 * lk, ly - 2 * lk, 4 * lk, 4 * lk)
  LAYERS.forEach((layer, idx) => {
    const open = layer.open + Math.sin(t * 1.5 + idx) * 0.1 + surge * 0.05
    const turn = layer.turn + layer.spin * 0.6 * t + coreTurn
    const long = 1.4 * layer.size
    const wide = 0.4 * layer.size
    for (let i = 0; i < layer.petals; i++) {
      const around = (i / layer.petals) * Math.PI * 2 + turn
      const place = (lx0, ly0) => {
        // The petal's own plane, tipped open, turned round the middle.
        const py = ly0 * Math.cos(open)
        const pz = ly0 * Math.sin(open)
        return project([lx0 * Math.cos(around) + pz * Math.sin(around), py + coreY, -lx0 * Math.sin(around) + pz * Math.cos(around)])
      }
      const base = place(0, 0)
      const tip = place(0, 2 * long)
      const paint = ctx.createLinearGradient(base[0], base[1], tip[0], tip[1])
      for (let s = 0; s <= 10; s++) {
        const v = s / 10
        const energy = smooth(0.8, 1, Math.sin(v * 20 - t) * 0.5 + 0.5) * 0.6
        const color = mix(mix(layer.from, layer.to, Math.min(1, v + 0.1)), WHITE, energy * flicker)
        paint.addColorStop(v, rgba(color, (0.3 + v * 0.55 + energy) * 0.75 * flicker))
      }
      ctx.fillStyle = paint
      ctx.beginPath()
      for (let s = 0; s <= 24; s++) {
        const a = (s / 24) * Math.PI * 2
        const [sx, sy] = place(wide * Math.cos(a), long * (1 + Math.sin(a)))
        if (s) ctx.lineTo(sx, sy)
        else ctx.moveTo(sx, sy)
      }
      ctx.closePath()
      ctx.fill()
    }
  })

  // The dodecahedron, turning slowly, rocking a little.
  const ay = t * 0.15
  const ax = Math.sin(t * 0.1) * 0.08
  const az = Math.cos(t * 0.08) * 0.05
  const corners = CORNERS.map(p => {
    const q = rotate(p, ax, ay, az)
    return project([q[0], q[1] + lift, q[2]])
  })
  const world = CORNERS.map(p => { const q = rotate(p, ax, ay, az); return [q[0], q[1] + lift, q[2]] })
  ctx.lineCap = 'round'
  EDGES.forEach(([i, j], n) => {
    const a = corners[i]
    const b = corners[j]
    const line = ctx.createLinearGradient(a[0], a[1], b[0], b[1])
    for (let s = 0; s <= 6; s++) {
      const v = s / 6
      const travel = smooth(0.7, 1, Math.sin(v * 10 - t * 4 + n) * 0.5 + 0.5)
      const color = mix(mix(LILAC, MINT, Math.min(1, Math.max(0, v + Math.sin(t) * 0.2))), WHITE, 0.35 + travel * 0.5)
      line.addColorStop(v, rgba(color, 0.4 + travel * 0.5))
    }
    ctx.strokeStyle = line
    // A wide faint line for the glow, a thin one for the tube.
    ctx.globalAlpha = 0.1 * flicker
    ctx.lineWidth = 5 * px
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineWidth = Math.max(1, 1.6 * px)
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
  })

  // Sparks running along every other edge, to and fro.
  EDGES.forEach(([i, j], n) => {
    if (n % 2) return
    const speed = 0.2 + hash(n + 201) * 0.4
    const raw = (t * speed + hash(n + 211) * Math.PI * 2) % 2
    let along = raw > 1 ? 2 - raw : raw
    if (hash(n + 221) > 0.5) along = 1 - along
    const p = world[i].map((v, k) => v + (world[j][k] - v) * along)
    const [sx, sy, k] = project(p)
    const flare = 1 + (Math.sin(t * 8 + n) * 0.5 + 0.5) * 0.3 + surge * 0.2
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 0.22 * k * flare)
    glow.addColorStop(0, rgba(WHITE, 0.9))
    glow.addColorStop(0.3, rgba(MINT, 0.3))
    glow.addColorStop(1, rgba(MINT, 0))
    ctx.fillStyle = glow
    ctx.fillRect(sx - 0.25 * k * flare, sy - 0.25 * k * flare, 0.5 * k * flare, 0.5 * k * flare)
    // Its wire diamond, spinning.
    const d = 0.12 * k * flare
    const spin = t * 2.5 + n
    ctx.strokeStyle = rgba(MINT, 0.75)
    ctx.lineWidth = Math.max(1, 1.1 * px)
    ctx.beginPath()
    for (let s = 0; s <= 4; s++) {
      const a = spin + (s * Math.PI) / 2
      const qx = sx + Math.cos(a) * d
      const qy = sy + Math.sin(a) * d * 0.8
      if (s) ctx.lineTo(qx, qy)
      else ctx.moveTo(qx, qy)
    }
    ctx.stroke()
  })

  // The corners: mint orbs, breathing: a see-through disc with a hard edge, a bright core, and a thin
  // glow just round it.
  corners.forEach(([sx, sy, k], n) => {
    const scale = 1 + 0.1 * Math.sin(t * 4 + hash(n + 301) * Math.PI * 2) + surge * 0.2
    const radius = 0.24 * scale * k
    const glow = ctx.createRadialGradient(sx, sy, radius * 0.9, sx, sy, radius * 1.35)
    glow.addColorStop(0, rgba(MINT, 0.3))
    glow.addColorStop(1, rgba(MINT, 0))
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(sx, sy, radius * 1.35, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = rgba(MINT, 0.42)
    ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = rgba(mix(MINT, WHITE, 0.6), 0.9)
    ctx.beginPath(); ctx.arc(sx, sy, radius * 0.2, 0, Math.PI * 2); ctx.fill()
  })
  ctx.restore()
}
