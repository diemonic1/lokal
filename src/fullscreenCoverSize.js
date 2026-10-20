// The size of the full-screen player's cover / clip, set from the small button
// over the card (not shown in Settings). Kept with the app's settings, so it
// goes into Export All Settings and comes back with an import. A multiplier of
// the default size: up to one and a half times smaller or larger.

import { useEffect, useState } from 'react'
import { api } from './api'

const KEY = 'fullscreen_cover_scale'
export const COVER_SCALE = { min: 1 / 1.5, max: 1.5, initial: 1 }
// Shown as a percentage of the default size.
export const COVER_PERCENT = { min: Math.round(COVER_SCALE.min * 100), max: Math.round(COVER_SCALE.max * 100), step: 1, initial: 100 }

const clamp = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(COVER_SCALE.max, Math.max(COVER_SCALE.min, n)) : COVER_SCALE.initial
}

let scale = COVER_SCALE.initial
let load = null
const listeners = new Set()
const tell = () => listeners.forEach(fn => fn(scale))

function refresh() {
  load = Promise.resolve(api.getSettings?.())
    .then(s => { if (s && s[KEY] !== undefined) scale = clamp(s[KEY]) })
    .catch(() => {})
    .then(tell)
  return load
}
// An import (or anything else saving settings) brings its own value.
if (typeof window !== 'undefined') window.addEventListener('lokal:settings-saved', refresh)

/** The cover's size multiplier (1 = the default). */
export function useFullscreenCoverScale() {
  const [value, setValue] = useState(scale)
  useEffect(() => {
    listeners.add(setValue)
    if (!load) refresh()
    else load.then(() => setValue(scale))
    return () => { listeners.delete(setValue) }
  }, [])
  return value
}

// The card follows the slider at once; the setting is written once it rests.
let saveTimer = null
export function setFullscreenCoverPercent(percent) {
  scale = clamp(Math.round(Number(percent)) / 100)
  tell()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { api.saveSettings({ [KEY]: String(scale) }) }, 400)
}
export const fullscreenCoverPercent = value => Math.round(value * 100)
