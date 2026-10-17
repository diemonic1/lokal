// The colour splashes' settings (Settings > Visualizations > Side Panel),
// apart from the visualization so the settings can be read without it.

export const SPLASH_DEFAULTS = {
  audio: true,            // splashes on the music
  sensitivity: 5,         // 0.01-10, how many splashes the music throws (the wallpaper's)
  // How the music's level is heard, to match it to Wallpaper Engine's (whose
  // levels are far lower than the analyser's): each band's level (0-1) less
  // the floor, raised to the curve, times the gain.
  audioGain: 4,           // 0.1-100 %, how loud the music reads
  audioCurve: 4,          // 1-8, higher: only the loudest parts count
  audioFloor: 0,          // 0-90 %, quieter than this counts as silence
  // The floating threshold (see adaptThreshold in Splashes.jsx): the music
  // must clear it to splash. While nothing splashes it sinks, so a quiet
  // song still splashes; while too much splashes it climbs back.
  dynamic: true,          // on / off (off: always 100 %)
  dynTarget: 30,          // 1-300 splashes a second it settles at
  dynFall: 30,            // 1-90 %, how much it sinks a second with no splashes
  dynRise: 50,            // 1-500 %, how much it climbs a second with too many
  dynWindow: 2,           // 0.2-10 s the splashes are counted over before it climbs
  dynMin: 10,             // 1-100 %, the lowest it sinks to (10 %: 10x as sensitive)
  dynMax: 300,            // 100-1000 %, the highest it climbs to
  dynReset: false,        // back to 100 % when a new song starts
  freqRange: 8,           // 1-62, how many of the 64 bands are listened to
  freqStart: 0,           // 0-62, the first of them (0: the deepest bass)
  idle: false,            // random splashes now and then, music or not
  idleInterval: 1,        // 0-30 s between them
  idleAmount: 10,         // 1-100 at a time
  onClick: true,          // a click splashes
  mouse: true,            // the mouse moving over it leaves a trail
  colorMode: 'rainbow',   // 'rainbow' (any hue) or 'color' (around `color`)
  color: '#00ff66',       // #rrggbb or 'accent'
  hueRange: 30,           // 0-180°, how far from its hue the splashes may go
  radius: 0.3,            // 0.01-1, how big a splash is
  curl: 30,               // 0-50, vorticity: how much it swirls
  densityDissipation: 0.97,   // 0.9-1, how long the colour stays
  velocityDissipation: 0.98,  // 0.9-1, how long it keeps moving
  pressureDissipation: 0.8,   // 0-1
  simResolution: 256,     // 32-256, the flow's grid
  dyeResolution: 512,     // 32-4096, the colour's grid
  shading: true,          // a little relief on the ink
  bloom: true,            // glow around bright ink
  bloomIntensity: 0.8,    // 0.1-2
  bloomThreshold: 0.6,    // 0-1
}

// Settings > Visualizations > Side Panel > Colour splashes: setting -> its
// key in the settings (side_splash_*), and how it's read.
const num = (min, max) => ['num', min, max]
const SPLASH_KEYS = {
  audio: ['side_splash_audio', 'bool'],
  sensitivity: ['side_splash_sensitivity', num(0.01, 10)],
  audioGain: ['side_splash_audio_gain', num(0.1, 100)],
  audioCurve: ['side_splash_audio_curve', num(1, 8)],
  audioFloor: ['side_splash_audio_floor', num(0, 90)],
  dynamic: ['side_splash_dyn', 'bool'],
  dynTarget: ['side_splash_dyn_target', num(1, 300)],
  dynFall: ['side_splash_dyn_fall', num(1, 90)],
  dynRise: ['side_splash_dyn_rise', num(1, 500)],
  dynWindow: ['side_splash_dyn_window', num(0.2, 10)],
  dynMin: ['side_splash_dyn_min', num(1, 100)],
  dynMax: ['side_splash_dyn_max', num(100, 1000)],
  dynReset: ['side_splash_dyn_reset', 'bool'],
  freqRange: ['side_splash_freq_range', num(1, 62)],
  freqStart: ['side_splash_freq_start', num(0, 62)],
  idle: ['side_splash_idle', 'bool'],
  idleInterval: ['side_splash_idle_interval', num(0, 30)],
  idleAmount: ['side_splash_idle_amount', num(1, 100)],
  onClick: ['side_splash_click', 'bool'],
  mouse: ['side_splash_mouse', 'bool'],
  colorMode: ['side_splash_color_mode', 'text'],
  color: ['side_splash_color', 'text'],
  hueRange: ['side_splash_hue_range', num(0, 180)],
  radius: ['side_splash_radius', num(0.01, 1)],
  curl: ['side_splash_curl', num(0, 50)],
  densityDissipation: ['side_splash_density', num(0.9, 1)],
  velocityDissipation: ['side_splash_velocity', num(0.9, 1)],
  pressureDissipation: ['side_splash_pressure', num(0, 1)],
  simResolution: ['side_splash_sim_res', num(32, 256)],
  dyeResolution: ['side_splash_dye_res', num(32, 4096)],
  shading: ['side_splash_shading', 'bool'],
  bloom: ['side_splash_bloom', 'bool'],
  bloomIntensity: ['side_splash_bloom_intensity', num(0.1, 2)],
  bloomThreshold: ['side_splash_bloom_threshold', num(0, 1)],
}
export const SPLASH_SETTING_KEYS = Object.values(SPLASH_KEYS).map(([key]) => key)

/** The splashes' settings as saved (SPLASH_DEFAULTS where unset or unreadable). */
export function readSplashSettings(get) {
  const out = { ...SPLASH_DEFAULTS }
  for (const [name, [key, kind]] of Object.entries(SPLASH_KEYS)) {
    const raw = get(key)
    if (raw == null || raw === '') continue
    if (kind === 'bool') out[name] = raw !== '0'
    else if (kind === 'text') out[name] = String(raw)
    else {
      const n = Number(raw)
      if (Number.isFinite(n)) out[name] = Math.max(kind[1], Math.min(kind[2], n))
    }
  }
  if (out.colorMode !== 'color') out.colorMode = 'rainbow'
  return out
}
