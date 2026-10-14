// A soft glow of the cover's colours behind the player bar's cover, title and
// artist (Settings > Appearance > Player Bar > Cover gradient). Not one flat
// colour: up to three of the cover's own colours, picked to differ from each
// other, drift as blurred blobs that fade out towards the controls.

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { loadMesh } from './ArtworkBackdrop'

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map(v => Math.round(v * 255))
}

const hueGap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1 - d) }

/**
 * Up to three colours from the cover's 6x6 colour grid: the most vivid one,
 * then the most vivid ones whose hue (or, for grey covers, lightness) differs.
 * Each is evened out to a glowing middle lightness so none shouts.
 */
export function coverPalette(grid) {
  const cells = (Array.isArray(grid) ? grid.flat() : []).filter(c => Array.isArray(c) && c.length >= 3)
  if (!cells.length) return []
  const scored = cells.map(rgb => {
    const [h, s, l] = rgbToHsl(rgb)
    // Vivid and neither near-black nor near-white.
    return { h, s, l, score: s * (1 - Math.abs(l - 0.5) * 1.4) }
  }).sort((a, b) => b.score - a.score)
  const picked = [scored[0]]
  for (const c of scored) {
    if (picked.length >= 3) break
    const distinct = picked.every(p => (p.s > 0.15 && c.s > 0.15 ? hueGap(p.h, c.h) > 0.06 : Math.abs(p.l - c.l) > 0.18))
    if (distinct) picked.push(c)
  }
  // A one-colour cover: neighbours of its hue, so it still has depth.
  while (picked.length < 3) {
    const base = picked[0]
    picked.push({ ...base, h: (base.h + (picked.length === 1 ? 0.05 : -0.05) + 1) % 1, l: base.l * (picked.length === 1 ? 0.8 : 1.15) })
  }
  return picked.map(({ h, s, l }) => hslToRgb(h, Math.min(0.85, s * 1.1), Math.min(0.6, Math.max(0.38, l))))
}

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`

// Each colour's blob: where it sits, and the loop it drifts along when the
// gradient is animated (offsets as % of the blob layer; mirrored back and forth).
const BLOBS = [
  { shape: '60% 120% at 6% 50%', alpha: 0.95, x: ['0%', '14%', '4%', '-6%'], y: ['0%', '-12%', '10%', '-4%'], scale: [1, 1.12, 0.94, 1.06] },
  { shape: '45% 95% at 34% 12%', alpha: 0.85, x: ['0%', '-16%', '10%', '-4%'], y: ['0%', '22%', '6%', '16%'], scale: [1, 0.9, 1.15, 1] },
  { shape: '50% 105% at 52% 92%', alpha: 0.8, x: ['0%', '-22%', '-8%', '6%'], y: ['0%', '-20%', '-30%', '-8%'], scale: [1, 1.18, 0.96, 1.08] },
]

/**
 * @param strength 0-100: how strongly it shows (opacity and colour)
 * @param speed    0-100: how fast the colours drift (0: still)
 * @param rounded  round its left corners (the floating bar's)
 */
export default function CoverGradient({ trackId, strength = 40, speed = 0, rounded = false }) {
  const [grid, setGrid] = useState({ id: null, value: null })
  useEffect(() => {
    if (!trackId) { setGrid({ id: null, value: null }); return undefined }
    let alive = true
    loadMesh(trackId).then(value => { if (alive) setGrid({ id: trackId, value }) })
    // The cover changed (edited, found later): look again.
    const onUpdated = (e) => {
      if (!(e.detail?.ids || []).some(id => String(id) === String(trackId))) return
      loadMesh(trackId).then(value => { if (alive) setGrid({ id: trackId, value }) })
    }
    window.addEventListener('lokal:track-updated', onUpdated)
    return () => { alive = false; window.removeEventListener('lokal:track-updated', onUpdated) }
  }, [trackId])

  // The colours last loaded: while the next song's are still on their way the
  // previous song's stay up, and only then cross-fade (no flash of nothing).
  const palette = useMemo(() => coverPalette(grid.value), [grid])
  const k = Math.max(0, Math.min(100, Number(strength) || 0)) / 100
  const shown = palette.length > 0 && k > 0
  const [a, b, c] = shown ? palette : [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const v = Math.max(0, Math.min(100, Number(speed) || 0)) / 100
  // One loop: about 40 s at the slowest, 5 s at full speed.
  const loop = v > 0 ? 40 - v * 35 : 0

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 overflow-hidden ${rounded ? 'rounded-l-2xl' : ''}`}
      // Below the bar's contents (the bar is their stacking context), above its background.
      style={{ zIndex: -1, width: 'var(--cover-gradient-width, 40%)', WebkitMaskImage: 'linear-gradient(90deg, #000 0%, #000 45%, transparent 100%)', maskImage: 'linear-gradient(90deg, #000 0%, #000 45%, transparent 100%)' }}>
      <AnimatePresence initial={false}>
        {shown && <motion.div key={grid.id}
          initial={{ opacity: 0 }} animate={{ opacity: 0.12 + k * 0.78 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}
          className="absolute -inset-6"
          style={{ background: `linear-gradient(90deg, ${rgba(a, 0.55)} 0%, ${rgba(b, 0.25)} 45%, ${rgba(c, 0)} 100%)`, filter: `blur(18px) saturate(${0.55 + k * 0.75})` }}>
          {BLOBS.map((blob, i) => {
            const color = palette[i]
            return (
              <motion.div key={`${i}-${loop}`} className="absolute inset-0"
                style={{ background: `radial-gradient(${blob.shape}, ${rgba(color, blob.alpha)} 0%, ${rgba(color, 0)} 72%)` }}
                animate={loop ? { x: blob.x, y: blob.y, scale: blob.scale } : { x: '0%', y: '0%', scale: 1 }}
                // Each blob on its own period, so the three never fall into step.
                transition={loop ? { duration: loop * (1 + i * 0.23), repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' } : { duration: 0.8 }} />
            )
          })}
        </motion.div>}
      </AnimatePresence>
    </div>
  )
}
