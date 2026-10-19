// The trails' settings (Settings > Visualizations > Side Panel > Trails),
// apart from the visualization so the settings can be read without it.

export const TRAILS_DEFAULTS = {
  life: 50,               // 0-100, how long the trails stay (the pen's slider: 50)
  layout: 'circle',       // 'circle' (the pen's: round the middle) or 'fill' (all over the box)
  scale: 220,             // 30-300 %, how big the whole picture is (how far the dots spread)
  colorMode: 'classic',   // 'classic' (the pen's reds, yellows and greens) or 'custom'
  color1: '#ff3d6e',      // #rrggbb or 'accent': the first of the two custom colours
  color2: '#3d8bff',      // the second
  shimmer: 50,            // 0-100, how far the custom colours' shades stray (the sheen)
  speed: 100,             // 10-300 %, how fast the dots wander
  sensitivity: 110,       // 10-300 %, how strongly the music moves them
  size: 100,              // 30-300 %, how big the dots are
  count: 600,             // 100-1200 dots
}

const num = (min, max) => ['num', min, max]
const TRAILS_KEYS = {
  life: ['side_trails_life', num(0, 100)],
  layout: ['side_trails_layout', 'text'],
  scale: ['side_trails_scale', num(30, 300)],
  colorMode: ['side_trails_color_mode', 'text'],
  color1: ['side_trails_color_1', 'text'],
  color2: ['side_trails_color_2', 'text'],
  shimmer: ['side_trails_shimmer', num(0, 100)],
  speed: ['side_trails_speed', num(10, 300)],
  sensitivity: ['side_trails_sensitivity', num(10, 300)],
  size: ['side_trails_size', num(30, 300)],
  count: ['side_trails_count', num(100, 1200)],
}
export const TRAILS_SETTING_KEYS = Object.values(TRAILS_KEYS).map(([key]) => key)

/** The trails' settings as saved (TRAILS_DEFAULTS where unset or unreadable). */
export function readTrailsSettings(get) {
  const out = { ...TRAILS_DEFAULTS }
  for (const [name, [key, kind]] of Object.entries(TRAILS_KEYS)) {
    const raw = get(key)
    if (raw == null || raw === '') continue
    if (kind === 'text') out[name] = String(raw)
    else {
      const n = Number(raw)
      if (Number.isFinite(n)) out[name] = Math.max(kind[1], Math.min(kind[2], n))
    }
  }
  if (out.colorMode !== 'custom') out.colorMode = 'classic'
  if (out.layout !== 'fill') out.layout = 'circle'
  return out
}
