// Share cards: a playlist, an artist or a recap as one 1080×1350 picture
// (the portrait size social apps show in full), to copy or save. Drawn on a
// canvas from the page's own data; covers are read as data (the file on
// desktop, a same-origin request on the web), so the picture can always be
// exported. Opened with openShareCard(spec) (the dialog lives in App).
//
// spec: {
//   kind: 'Playlist' | 'Artist' | 'Recap',  title, subtitle,
//   label: the slide's name over the title ("top artist"), counter: "5 / 11" (a Stories slide),
//   art: [{ path, url }]   (one picture, or four for a mosaic),
//   round: true            (a round picture, for an artist),
//   stats: [[label, value]] (up to 4),
//   list: { title, items: [[main, secondary]] },
//   fileName,
// }

import { api } from './api'
import { translate } from './i18n'
// The app's cat for the card's corner, inlined (a data URL): a file:// picture would taint the canvas.
import logoURL from './assets/share-logo.png?inline'
import { SLIDE_SCENES, paintScene } from './visualizers/slideScenes'

const W = 1080
const H = 1350
const M = 90 // side margin
const IMAGE_TIMEOUT_MS = 8000

/** Where a track's cover can be read from. */
export function trackArtSource(track) {
  if (!track) return null
  if (track.artwork_path) return { path: track.artwork_path, url: api.isElectron ? null : api.artworkURL(track.id) }
  return track.artwork_url ? { url: track.artwork_url } : null
}

/** Where an artist's picture can be read from. */
export function artistArtSource(artist) {
  if (!artist?.image_path) return null
  return { path: artist.image_path, url: api.isElectron ? null : `/api/artist-image/${encodeURIComponent(artist.id)}` }
}

/** Up to `count` different covers from tracks. */
export function coversOf(tracks, count = 4) {
  const seen = new Set()
  const out = []
  for (const track of tracks || []) {
    const source = trackArtSource(track)
    const key = source?.path || source?.url
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(source)
    if (out.length >= count) break
  }
  return out
}

async function loadImage(source) {
  if (!source) return null
  let src = null
  let revoke = null
  try {
    if (source.path && api.isElectron) src = await api.readFileAsDataURL(source.path)
    if (!src && source.url) {
      // A server that stalls mustn't hold up the card: it's drawn without this picture.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
      try {
        const res = await fetch(source.url, { signal: controller.signal })
        if (!res.ok) return null
        src = URL.createObjectURL(await res.blob())
        revoke = src
      } finally {
        clearTimeout(timer)
      }
    }
    if (!src) return null
    const image = new Image()
    image.src = src
    await image.decode()
    return image
  } catch {
    return null
  } finally {
    // The bitmap stays decoded once drawn; the blob link isn't needed after.
    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 30000)
  }
}

/** The picture's average colour, for the background glow. */
function averageColor(image) {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 8
    const ctx = c.getContext('2d')
    ctx.drawImage(image, 0, 0, 8, 8)
    const data = ctx.getImageData(0, 0, 8, 8).data
    let r = 0; let g = 0; let b = 0
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2] }
    const n = data.length / 4
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`
  } catch {
    return null
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Draws `image` to fill the box (cropped to its centre). */
function cover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height)
  const sw = w / scale
  const sh = h / scale
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h)
}

/** `text` cut to fit `width`, with an ellipsis. */
function fit(ctx, text, width) {
  let value = String(text || '')
  if (ctx.measureText(value).width <= width) return value
  while (value && ctx.measureText(`${value}…`).width > width) value = value.slice(0, -1)
  return `${value.trimEnd()}…`
}

/** Up to `max` lines of `text` within `width`, the last one cut. */
function wrap(ctx, text, width, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= width || !line) { line = next; continue }
    if (lines.length === max - 1) { lines.push(fit(ctx, [line, ...words.slice(i)].join(' '), width)); return lines }
    lines.push(fit(ctx, line, width))
    line = words[i]
  }
  if (line) lines.push(fit(ctx, line, width))
  return lines.slice(0, max)
}

function themeColor(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback } catch { return fallback }
}

/** The card for `spec`, as a canvas. */
export async function renderShareCard(spec) {
  const fonts = ['600 64px "DM Sans"', '400 30px "DM Sans"', '500 30px "DM Mono"']
  await Promise.all(fonts.map(font => document.fonts?.load(font).catch(() => null)))
  const images = (await Promise.all((spec.art || []).slice(0, 4).map(loadImage))).filter(Boolean)
  // The app's cat (public/lokal-icon.png) by its name in the corner.
  const logo = await new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = logoURL })
  const accent = themeColor('--accent', '#ffd6f0')
  const sans = '"DM Sans", system-ui, sans-serif'
  const mono = '"DM Mono", ui-monospace, monospace'

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Background: near black, lit from the top by the picture's colour.
  ctx.fillStyle = '#0b0b0d'
  ctx.fillRect(0, 0, W, H)
  const glow = images[0] ? averageColor(images[0]) : null
  const gradient = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 900)
  gradient.addColorStop(0, glow ? glow.replace('rgb', 'rgba').replace(')', ', 0.65)') : 'rgba(232, 255, 87, 0.12)')
  gradient.addColorStop(1, 'rgba(11, 11, 13, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, W, H)

  // Header: the app, and what this is.
  ctx.textBaseline = 'alphabetic'
  let nameX = M + 32
  if (logo) {
    // Its own proportions, 60 px tall, centred on the name's line.
    const h = 60
    const w = h * logo.width / logo.height
    ctx.drawImage(logo, M, 92 - h / 2 - 1, w, h)
    nameX = M + w + 18
  } else {
    ctx.fillStyle = accent
    ctx.beginPath(); ctx.arc(M + 9, 92, 9, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = '#ffffff'
  ctx.font = `500 30px ${mono}`
  ctx.letterSpacing = '6px'
  ctx.textAlign = 'left'
  ctx.fillText('LOKAL', nameX, 102)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.font = `400 24px ${mono}`
  ctx.fillText([translate(String(spec.kind || '')).toUpperCase(), spec.counter].filter(Boolean).join(' · '), W - M, 100)
  ctx.letterSpacing = '0px'

  // The picture: a cover, a 2×2 mosaic, or a round artist photo.
  const size = 500
  const ax = (W - size) / 2
  const ay = 160
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 20
  if (spec.round) { ctx.beginPath(); ctx.arc(W / 2, ay + size / 2, size / 2, 0, Math.PI * 2) } else roundRect(ctx, ax, ay, size, size, 28)
  ctx.fillStyle = '#1c1c20'
  ctx.fill()
  ctx.restore()
  ctx.save()
  if (spec.round) { ctx.beginPath(); ctx.arc(W / 2, ay + size / 2, size / 2, 0, Math.PI * 2) } else roundRect(ctx, ax, ay, size, size, 28)
  ctx.clip()
  if (images.length >= 4 && !spec.round) {
    const half = size / 2
    images.slice(0, 4).forEach((image, i) => cover(ctx, image, ax + (i % 2) * half, ay + Math.floor(i / 2) * half, half, half))
  } else if (images[0]) {
    cover(ctx, images[0], ax, ay, size, size)
  } else {
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.25
    ctx.font = `600 220px ${sans}`
    ctx.textAlign = 'center'
    ctx.fillText('♪', W / 2, ay + size / 2 + 80)
    ctx.globalAlpha = 1
  }
  ctx.restore()

  // The slide's name, then the title and subtitle.
  let y = ay + size + 100
  if (spec.label) {
    ctx.textAlign = 'center'
    ctx.fillStyle = accent
    ctx.font = `500 26px ${mono}`
    ctx.letterSpacing = '5px'
    ctx.fillText(fit(ctx, String(spec.label).toUpperCase(), W - M * 2), W / 2, y - 18)
    ctx.letterSpacing = '0px'
    y += 46
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 64px ${sans}`
  for (const line of wrap(ctx, spec.title, W - M * 2, 2)) { ctx.fillText(line, W / 2, y); y += 72 }
  if (spec.subtitle) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)'
    ctx.font = `400 30px ${sans}`
    ctx.fillText(fit(ctx, spec.subtitle, W - M * 2), W / 2, y - 14)
    y += 40
  }

  // Numbers, side by side.
  const stats = (spec.stats || []).filter(([, value]) => value !== undefined && value !== null && value !== '').slice(0, 4)
  if (stats.length) {
    y += 34
    const cell = (W - M * 2) / stats.length
    stats.forEach(([label, value], i) => {
      const cx = M + cell * i + cell / 2
      ctx.fillStyle = accent
      ctx.font = `500 46px ${mono}`
      ctx.fillText(fit(ctx, value, cell - 20), cx, y)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.font = `400 20px ${mono}`
      ctx.letterSpacing = '3px'
      ctx.fillText(translate(String(label)).toUpperCase(), cx, y + 36)
      ctx.letterSpacing = '0px'
    })
    y += 70
  }

  // A short ranked list, as many rows as fit above the footer.
  const items = spec.list?.items || []
  if (items.length && y < H - 220) {
    y += 46
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.font = `400 20px ${mono}`
    ctx.letterSpacing = '3px'
    ctx.fillText(translate(String(spec.list.title || '')).toUpperCase(), M, y)
    ctx.letterSpacing = '0px'
    y += 18
    for (let i = 0; i < items.length && y + 46 < H - 110; i++) {
      y += 46
      const [main, secondary] = items[i]
      ctx.fillStyle = accent
      ctx.font = `500 26px ${mono}`
      ctx.fillText(String(i + 1).padStart(2, '0'), M, y)
      ctx.font = `500 30px ${sans}`
      ctx.fillStyle = '#ffffff'
      const mainText = fit(ctx, main, secondary ? (W - M * 2 - 70) * 0.62 : W - M * 2 - 70)
      ctx.fillText(mainText, M + 70, y)
      if (secondary) {
        const mainWidth = ctx.measureText(mainText).width
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.font = `400 28px ${sans}`
        ctx.fillText(fit(ctx, ` · ${secondary}`, W - M * 2 - 70 - mainWidth), M + 70 + mainWidth, y)
      }
    }
  }

  // Footer.
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.font = `400 20px ${mono}`
  ctx.letterSpacing = '3px'
  ctx.fillText(translate('Made with Lokal').toUpperCase(), W / 2, H - 56)
  ctx.letterSpacing = '0px'
  return canvas
}

/**
 * A Stories slide as it looks (components/RecapStory.jsx): the card's own
 * picture (html2canvas, at 1080 px wide) over the slide's blurred cover (or
 * the radio's colours), under the period, with the cat and the app's name
 * where the player was (it isn't in the picture). 1080 × 2070.
 * `scenes`: the slide's moving pictures as Share found them ({ kind, time, and
 * x, y, w, h on the card, CSS px }; visualizers/slideScenes.js), drawn here at
 * that moment: one in place of the whole card stands in for the cover.
 */
export async function renderStorySlide({ card, cover, period, scenes = [] }) {
  const { default: html2canvas } = await import('html2canvas-pro')
  const SW = 1080
  const HEAD = 150
  const rect = card.getBoundingClientRect()
  const scale = SW / rect.width
  const cardH = Math.round(rect.height * scale)
  const backdrop = scenes.find(scene => SLIDE_SCENES[scene.kind]?.place === 'card')
  const [shot, image, logo] = await Promise.all([
    html2canvas(card, {
      scale, backgroundColor: null, logging: false, useCORS: true,
      ignoreElements: el => el.hasAttribute?.('data-share-skip'),
      // Square, borderless and without its own see-through shade (laid over the whole picture below,
      // so the header shares the slide's colours).
      onclone: (_, clone) => { clone.style.borderRadius = '0'; clone.style.border = 'none'; clone.style.boxShadow = 'none'; clone.style.background = 'transparent' },
    }),
    backdrop ? null : loadImage(cover),
    new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = logoURL }),
  ])
  const accent = themeColor('--accent', '#ffd6f0')
  const mono = '"DM Mono", ui-monospace, monospace'
  const H = HEAD + cardH
  const canvas = document.createElement('canvas')
  canvas.width = SW
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, SW, H)
  if (backdrop) {
    // The slide's own picture, as it was when Share was pressed; the header continues its top.
    const look = SLIDE_SCENES[backdrop.kind]
    ctx.save()
    ctx.filter = `brightness(${look.brightness})`
    ctx.fillStyle = (typeof look.header === 'function' ? look.header(backdrop.colors) : look.header) || '#000'
    ctx.fillRect(0, 0, SW, HEAD + 1)
    ctx.restore()
    paintScene(ctx, backdrop.kind, 0, HEAD, SW, cardH, backdrop.time, backdrop.colors)
  } else {
    if (image) {
      // The cover blurred behind everything, as the Stories show it.
      ctx.save()
      ctx.filter = 'blur(90px) saturate(1.3)'
      ctx.globalAlpha = 0.5
      const s = Math.max(SW * 1.2 / image.width, H * 1.2 / image.height)
      ctx.drawImage(image, (SW - image.width * s) / 2, (H - image.height * s) / 2, image.width * s, image.height * s)
      ctx.restore()
    } else {
      // The radio's colours.
      const base = ctx.createLinearGradient(0, 0, SW, H)
      base.addColorStop(0, '#1e1b4b'); base.addColorStop(1, '#0f172a')
      ctx.fillStyle = base
      ctx.fillRect(0, 0, SW, H)
      for (const [x, y, r, color] of [[0.15, 0.2, 0.6, accent], [0.85, 0.25, 0.55, 'rgb(236, 72, 153)'], [0.5, 0.95, 0.7, 'rgb(56, 189, 248)']]) {
        const g = ctx.createRadialGradient(SW * x, H * y, 0, SW * x, H * y, SW * r * 1.3)
        ctx.globalAlpha = 0.6
        g.addColorStop(0, color); g.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, SW, H)
        ctx.globalAlpha = 1
      }
    }
    const shade = ctx.createRadialGradient(SW / 2, H / 2, 0, SW / 2, H / 2, H * 0.7)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.25)'); shade.addColorStop(1, 'rgba(0, 0, 0, 0.85)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, SW, H)
    // The card's own shade (bg-black/30), over the header too.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fillRect(0, 0, SW, H)
  }

  // Header: the cat, the app and the period.
  ctx.textBaseline = 'middle'
  if (period) {
    // Header: the period, the whole width (a long week is cut).
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = `400 28px ${mono}`
    ctx.letterSpacing = '4px'
    ctx.fillText(fit(ctx, period.toUpperCase(), SW - 144), 72, HEAD / 2 + 6)
  }

  // The pictures in the slide's own boxes, under its content.
  for (const scene of scenes) {
    if (scene !== backdrop) paintScene(ctx, scene.kind, scene.x * scale, HEAD + scene.y * scale, scene.w * scale, scene.h * scale, scene.time, scene.colors)
  }
  // The slide.
  ctx.drawImage(shot, 0, HEAD, SW, cardH)

  // Where the player was: the cat and the app's name, centred.
  const footY = H - 120
  ctx.font = `500 48px ${mono}`
  ctx.letterSpacing = '9px'
  const nameW = ctx.measureText('LOKAL').width
  const logoH = 96
  const logoW = logo ? logoH * logo.width / logo.height : 0
  let x = (SW - (logoW ? logoW + 28 : 0) - nameW) / 2
  if (logo) {
    ctx.drawImage(logo, x, footY - logoH / 2, logoW, logoH)
    x += logoW + 28
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillText('LOKAL', x, footY + 4)
  ctx.letterSpacing = '0px'
  return canvas
}

/**
 * A whole recap as one landscape picture (1920 × 1080): what all the Stories
 * slides say, in four columns of boxes. `summary` comes written out
 * (pages/Recap.jsx recapSummary); a part the recap has nothing for is null,
 * and the column's stretching box takes its room.
 * summary: {
 *   period, total, stats: [[value, label]] (4),
 *   track: { title, artist, note, art }, artist: { name, note, time, art },
 *   tracks: [{ title, artist, art }], artists: [{ name, value, art }],
 *   genres: [{ name, plays }], when: { title, text, parts: [{ label, plays, top }] },
 *   radio: { time, items: [[name, time]] }, session: { time, text },
 *   added: { title, text, art: [] },
 * }
 */
export async function renderRecapSummary(summary) {
  const RW = 1920
  const RH = 1080
  const PAD = 56
  const HEAD = 112
  const GAP = 20
  const COL_H = 900
  const COL_W = (RW - PAD * 2 - GAP * 3) / 4
  const BOX_X = 26 // box padding: sides
  const BOX_Y = 22 // and top / bottom
  const TALL = 333 // the last box of the outer columns
  const SHORT = 224 // and of the middle ones
  const sans = '"DM Sans", system-ui, sans-serif'
  const mono = '"DM Mono", ui-monospace, monospace'
  const accent = themeColor('--accent', '#ffd6f0')
  await Promise.all(['700 68px "DM Sans"', '500 24px "DM Sans"', '400 18px "DM Sans"', '500 20px "DM Mono"', '400 18px "DM Mono"'].map(font => document.fonts?.load(font).catch(() => null)))

  // Every picture once (the same cover can stand for a track and its artist).
  const sources = new Map()
  const want = (source) => { const key = source?.path || source?.url; if (key && !sources.has(key)) sources.set(key, source); return key || null }
  const s = summary
  const keys = {
    track: want(s.track?.art), artist: want(s.artist?.art),
    tracks: (s.tracks || []).map(item => want(item.art)), artists: (s.artists || []).map(item => want(item.art)),
    added: (s.added?.art || []).map(want),
  }
  const [images, logo] = await Promise.all([
    Promise.all([...sources].map(async ([key, source]) => [key, await loadImage(source)])).then(entries => new Map(entries)),
    new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = logoURL }),
  ])
  const imageOf = key => (key && images.get(key)) || null

  const canvas = document.createElement('canvas')
  canvas.width = RW
  canvas.height = RH
  const ctx = canvas.getContext('2d')
  ctx.textBaseline = 'alphabetic'

  // Background: near black, lit from the top left by the #1 track's colour.
  ctx.fillStyle = '#0b0b0d'
  ctx.fillRect(0, 0, RW, RH)
  const glowColor = imageOf(keys.track) ? averageColor(imageOf(keys.track)) : null
  const glow = ctx.createRadialGradient(RW * 0.15, RH * 0.1, 0, RW * 0.15, RH * 0.1, 900)
  glow.addColorStop(0, glowColor ? glowColor.replace('rgb', 'rgba').replace(')', ', 0.5)') : 'rgba(126, 74, 160, 0.55)')
  glow.addColorStop(1, 'rgba(11, 11, 13, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, RW, RH)
  const glow2 = ctx.createRadialGradient(RW * 0.95, RH, 0, RW * 0.95, RH, 800)
  glow2.addColorStop(0, 'rgba(236, 72, 153, 0.14)')
  glow2.addColorStop(1, 'rgba(11, 11, 13, 0)')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, RW, RH)

  const text = (value, x, y, font, color, { align = 'left', spacing = 0, width } = {}) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.letterSpacing = `${spacing}px`
    const shown = width ? fit(ctx, value, width) : String(value ?? '')
    ctx.fillText(shown, x, y)
    const measured = ctx.measureText(shown).width
    ctx.letterSpacing = '0px'
    return measured
  }
  const muted = 'rgba(255, 255, 255, 0.55)'
  const faint = 'rgba(255, 255, 255, 0.5)'
  const picture = (key, x, y, size, radius, round) => {
    const image = imageOf(key)
    ctx.save()
    if (round) { ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2) } else roundRect(ctx, x, y, size, size, radius)
    ctx.clip()
    if (image) cover(ctx, image, x, y, size, size)
    else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
      ctx.fillRect(x, y, size, size)
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.5
      ctx.font = `600 ${Math.round(size * 0.45)}px ${sans}`
      ctx.textAlign = 'center'
      ctx.fillText('♪', x + size / 2, y + size * 0.66)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }
  // A box with its name; returns where its content starts.
  const box = (x, y, h, label, extra) => {
    roundRect(ctx, x + 0.5, y + 0.5, COL_W - 1, h - 1, 26)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.055)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1
    ctx.stroke()
    const w = text(String(label).toUpperCase(), x + BOX_X, y + BOX_Y + 18, `500 20px ${mono}`, accent, { spacing: 4, width: COL_W - BOX_X * 2 })
    if (extra) text(extra, x + BOX_X + w + 4, y + BOX_Y + 18, `500 20px ${mono}`, 'rgba(255, 255, 255, 0.45)', { spacing: 2, width: COL_W - BOX_X * 2 - w - 4 })
    return y + BOX_Y + 20 + 14
  }
  const inner = COL_W - BOX_X * 2

  // Header: the cat and the app, the period on the right.
  let nameX = PAD
  if (logo) {
    const h = 64
    const w = h * logo.width / logo.height
    ctx.drawImage(logo, PAD, HEAD / 2 - h / 2, w, h)
    nameX = PAD + w + 18
  }
  text('LOKAL', nameX, HEAD / 2 + 12, `500 34px ${mono}`, '#ffffff', { spacing: 7 })
  ctx.font = `500 24px ${mono}`
  ctx.letterSpacing = '4px'
  const periodText = String(s.period || '').toUpperCase()
  const periodW = ctx.measureText(periodText).width
  ctx.letterSpacing = '0px'
  text(periodText, RW - PAD, HEAD / 2 + 9, `500 24px ${mono}`, '#ffffff', { align: 'right', spacing: 4 })
  text(`${translate('Recap').toUpperCase()} · `, RW - PAD - periodW, HEAD / 2 + 9, `400 24px ${mono}`, 'rgba(255, 255, 255, 0.6)', { align: 'right', spacing: 4 })

  // The boxes, column by column: [height | 'grow', draw(x, y, h)].
  const featureBox = (label, key, round, title, line1, line2) => (x, y, h) => {
    const top = box(x, y, h, label)
    picture(key, x + BOX_X, top, 112, 18, round)
    const tx = x + BOX_X + 112 + 20
    const tw = inner - 112 - 20
    // The name as big as fits on one line (34 px down to 26), else on two at 26 px (the second cut).
    let size = 34
    let titleLines = [title]
    for (; size > 26; size -= 2) {
      ctx.font = `600 ${size}px ${sans}`
      if (ctx.measureText(String(title || '')).width <= tw) break
    }
    ctx.font = `600 ${size}px ${sans}`
    if (ctx.measureText(String(title || '')).width > tw) titleLines = wrap(ctx, title, tw, 2)
    const titleH = size * 1.15
    // The lines together, centred on the picture.
    const blockH = titleH * titleLines.length + 32 + (line2 ? 32 : 0)
    let ty = top + 56 - blockH / 2
    for (const line of titleLines) { ty += titleH; text(line, tx, ty - size * 0.25, `600 ${size}px ${sans}`, '#ffffff', { width: tw }) }
    ty += 32
    text(line1, tx, ty - 6, `400 22px ${sans}`, muted, { width: tw })
    if (line2) { ty += 32; text(line2, tx, ty - 6, `500 20px ${mono}`, accent, { width: tw }) }
  }
  const rankBox = (label, rows, { round, compact, extra } = {}) => (x, y, h) => {
    const top = box(x, y, h, label, extra)
    const rowH = compact ? 46 : 60
    rows.forEach((row, i) => {
      const cy = top + rowH * i + rowH / 2
      text(String(i + 1).padStart(2, '0'), x + BOX_X, cy + 8, `500 22px ${mono}`, accent)
      let tx = x + BOX_X + 48
      if (row.art !== undefined) { picture(row.art, tx, cy - 25, 50, 9, round); tx += 50 + 16 }
      let right = x + COL_W - BOX_X
      if (row.value) right -= text(row.value, right, cy + 7, `400 18px ${mono}`, muted, { align: 'right' }) + 14
      const tw = right - tx
      if (row.sub) {
        text(row.main, tx, cy - 2, `500 24px ${sans}`, '#ffffff', { width: tw })
        text(row.sub, tx, cy + 22, `400 18px ${sans}`, faint, { width: tw })
      } else text(row.main, tx, cy + 8, `500 24px ${sans}`, '#ffffff', { width: tw })
    })
  }
  // Wrapped lines of `value`; returns the y under them.
  const lines = (value, x, y, font, color, max, lineH) => {
    ctx.font = font
    for (const line of wrap(ctx, value, inner, max)) { text(line, x, y, font, color); y += lineH }
    return y
  }

  const col1 = [
    ['grow', (x, y, h) => {
      const top = box(x, y, h, translate('in all, you listened to'))
      text(s.total, x + BOX_X, top + 62, `700 68px ${sans}`, '#ffffff', { spacing: -2, width: inner })
      text(translate('of music'), x + BOX_X, top + 112, `500 40px ${sans}`, 'rgba(255, 255, 255, 0.6)', { width: inner })
      // The four numbers, two by two, at the box's foot.
      const cellH = 100
      const gridTop = y + h - BOX_Y - cellH * 2
      ;(s.stats || []).slice(0, 4).forEach(([value, label], i) => {
        const cx = x + BOX_X + (i % 2) * (inner / 2)
        const cy = gridTop + Math.floor(i / 2) * cellH
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
        ctx.fillRect(cx, cy, inner / 2, 1)
        if (i % 2) ctx.fillRect(cx, cy, 1, cellH)
        const lx = cx + (i % 2 ? 20 : 0)
        text(value, lx, cy + 58, `500 42px ${mono}`, accent, { width: inner / 2 - 24 })
        text(String(label).toUpperCase(), lx, cy + 86, `400 16px ${mono}`, faint, { spacing: 3, width: inner / 2 - 24 })
      })
    }],
    s.added && [TALL, (x, y, h) => {
      const top = box(x, y, h, translate('new in your library'))
      text(s.added.title, x + BOX_X, top + 40, `700 44px ${sans}`, '#ffffff', { width: inner })
      lines(s.added.text, x + BOX_X, top + 76, `400 21px ${sans}`, muted, 2, 28)
      const art = keys.added.slice(0, 4)
      if (art.length) {
        const size = (inner - 12 * 3) / 4
        art.forEach((key, i) => picture(key, x + BOX_X + i * (size + 12), y + h - BOX_Y - size, size, 14))
      }
    }],
  ]
  const col2 = [
    s.track && [198, featureBox(translate('your #1 track'), keys.track, false, s.track.title, s.track.artist, s.track.note)],
    s.tracks?.length && ['grow', rankBox(translate('top tracks'), s.tracks.map((item, i) => ({ main: item.title, sub: item.artist, art: keys.tracks[i] })))],
    s.session && [SHORT, (x, y, h) => {
      const top = box(x, y, h, translate('the longest session'))
      text(s.session.time, x + BOX_X, top + 40, `700 44px ${sans}`, '#ffffff', { width: inner })
      lines(s.session.text, x + BOX_X, top + 78, `400 21px ${sans}`, muted, 3, 28)
    }],
  ]
  const col3 = [
    s.artist && [198, featureBox(translate('top artist'), keys.artist, true, s.artist.name, s.artist.note, s.artist.time)],
    s.artists?.length && ['grow', rankBox(translate('top artists'), s.artists.map((item, i) => ({ main: item.name, value: item.value, art: keys.artists[i] })), { round: true })],
    s.radio && [SHORT, rankBox(translate('on the radio'), s.radio.items.slice(0, 3).map(([main, value]) => ({ main, value })), { compact: true, extra: `· ${s.radio.time}` })],
  ]
  const col4 = [
    s.genres?.length && ['grow', (x, y, h) => {
      const top = box(x, y, h, translate('Genres'), translate('(plays)'))
      const max = Math.max(...s.genres.map(item => Number(item.plays) || 0), 1)
      s.genres.forEach((item, i) => {
        const ry = top + i * 65
        const vw = text(Number(item.plays || 0).toLocaleString(), x + COL_W - BOX_X, ry + 22, `400 18px ${mono}`, muted, { align: 'right' })
        text(item.name, x + BOX_X, ry + 22, `500 23px ${sans}`, '#ffffff', { width: inner - vw - 12 })
        roundRect(ctx, x + BOX_X, ry + 34, inner, 9, 4.5)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
        ctx.fill()
        roundRect(ctx, x + BOX_X, ry + 34, Math.max(9, inner * (Number(item.plays) || 0) / max), 9, 4.5)
        ctx.fillStyle = accent
        ctx.fill()
      })
    }],
    s.when && [TALL, (x, y, h) => {
      const top = box(x, y, h, translate('when you listen'))
      text(s.when.title, x + BOX_X, top + 40, `700 44px ${sans}`, '#ffffff', { width: inner })
      lines(s.when.text, x + BOX_X, top + 76, `400 21px ${sans}`, muted, 2, 28)
      // Four bars, the busiest part of the day lit, their names under them.
      const parts = s.when.parts || []
      const max = Math.max(...parts.map(part => part.plays), 1)
      const barW = (inner - 10 * 3) / 4
      const base = y + h - BOX_Y - 28
      parts.forEach((part, i) => {
        const bx = x + BOX_X + i * (barW + 10)
        const bh = Math.max(8, 92 * part.plays / max)
        ctx.save()
        ctx.beginPath()
        ctx.roundRect ? ctx.roundRect(bx, base - bh, barW, bh, [10, 10, 4, 4]) : roundRect(ctx, bx, base - bh, barW, bh, 4)
        ctx.fillStyle = part.top ? accent : 'rgba(255, 255, 255, 0.14)'
        ctx.fill()
        ctx.restore()
        text(String(part.label).toUpperCase(), bx + barW / 2, base + 24, `400 15px ${mono}`, 'rgba(255, 255, 255, 0.6)', { align: 'center', spacing: 1, width: barW })
      })
    }],
  ]

  ;[col1, col2, col3, col4].forEach((column, i) => {
    const items = column.filter(Boolean)
    if (!items.length) return
    const fixed = items.reduce((sum, [h]) => sum + (h === 'grow' ? 0 : h), 0) + GAP * (items.length - 1)
    const growing = items.filter(([h]) => h === 'grow').length
    // No stretching box (its part is missing): the first one stretches instead.
    const spare = COL_H - fixed
    const x = PAD + i * (COL_W + GAP)
    let y = HEAD
    items.forEach(([h, draw], n) => {
      const height = h === 'grow' ? spare / growing : (!growing && n === 0 ? h + spare : h)
      draw(x, y, height)
      y += height + GAP
    })
  })

  text(translate('Made with Lokal').toUpperCase(), RW / 2, RH - 26, `400 18px ${mono}`, 'rgba(255, 255, 255, 0.35)', { align: 'center', spacing: 3 })
  return canvas
}

/** Open the share card dialog for `spec`. */
export function openShareCard(spec) {
  window.dispatchEvent(new CustomEvent('lokal:share-card', { detail: spec }))
}
