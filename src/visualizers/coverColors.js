// The colours the Stories' cover-coloured scenes (slideScenes.js) are drawn
// in: three, from the slide's song's cover (CoverGradient.jsx coverPalette,
// as the player bar's gradient), as the user's wrapped-visuals sketches use
// their palettes: hi (light), mid (the most vivid), lo (almost black). Each is
// [r, g, b] (they go to Share as JSON). The phone has the same: Lokal_android
// ui/CoverColors.kt.

/** hi / mid / lo from the cover's palette (the most vivid colour first). */
export function coverColors(palette) {
  const [first, second = first] = palette
  return {
    hi: second.map(v => v + (255 - v) * 0.35),
    mid: [...first],
    lo: first.map(v => v * 0.08),
  }
}

/** A colour as CSS, see-through by `alpha`. */
export function css([r, g, b], alpha = 1) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`
}

/** Along the colours: 0 lo, 0.5 mid, 1 hi (the sketches' ramp). */
export function ramp(colors, t, alpha = 1) {
  const k = Math.max(0, Math.min(1, t))
  const [a, b, f] = k < 0.5 ? [colors.lo, colors.mid, k * 2] : [colors.mid, colors.hi, k * 2 - 1]
  return css(a.map((v, i) => v + (b[i] - v) * f), alpha)
}
