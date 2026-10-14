// Per-viewer looks of the right-hand Now Playing panel, kept between
// sessions: its width (dragged by its left edge) and the size of the lyrics
// shown in it (Settings > Appearance). Changes reach every open copy at once.
import { useEffect, useState } from 'react'

const WIDTH_KEY = 'lokal-side-panel-width'
const LYRICS_SCALE_KEY = 'lokal-side-lyrics-scale'
const CHANGED = 'lokal:side-panel-prefs'

export const SIDE_PANEL_WIDTH = { min: 260, max: 640, initial: 300 }
export const SIDE_LYRICS_SCALE = { min: 0.7, max: 2, step: 0.05, initial: 1.4 }

const clamp = (value, { min, max, initial }) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : initial
}

function read(key, range) {
  try {
    const saved = localStorage.getItem(key)
    return saved === null ? range.initial : clamp(saved, range)
  } catch {
    return range.initial
  }
}

function write(key, range, value, persist) {
  const next = clamp(value, range)
  if (persist) { try { localStorage.setItem(key, String(next)) } catch {} }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: { key, value: next } }))
  return next
}

function usePref(key, range) {
  const [value, setValue] = useState(() => read(key, range))
  useEffect(() => {
    const onChange = e => { if (e.detail?.key === key) setValue(e.detail.value) }
    window.addEventListener(CHANGED, onChange)
    return () => window.removeEventListener(CHANGED, onChange)
  }, [key])
  return value
}

export const useSidePanelWidth = () => usePref(WIDTH_KEY, SIDE_PANEL_WIDTH)
// While dragging only the open panels follow; the width is saved on release.
export const setSidePanelWidth = (value, { persist = true } = {}) => write(WIDTH_KEY, SIDE_PANEL_WIDTH, value, persist)

export const useSideLyricsScale = () => usePref(LYRICS_SCALE_KEY, SIDE_LYRICS_SCALE)
export const setSideLyricsScale = value => write(LYRICS_SCALE_KEY, SIDE_LYRICS_SCALE, value, true)
