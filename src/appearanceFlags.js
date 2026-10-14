// Appearance settings read outside the Settings page (the player bar, the
// app layout). Read once and shared; re-read whenever settings are saved, so
// a switch applies straight away. An on/off setting is on unless it's '0'.
//   glass_player_bar        Settings > Appearance > Player Bar > Glass (see-through, blurred)
//   player_bar_floating     ... > Floating bar (off: docked to the bottom edge).
//                           Unset: follows Glass, which used to switch both.
//   player_bar_gradient     ... > Cover gradient
//   player_waveform         ... > Waveform
// Numbers (useAppearanceValue):
//   player_bar_gradient_strength   0-100, how strongly the cover gradient shows
//   player_bar_gradient_speed      0-100, how fast its colours drift (0: still)
//   player_bar_glass_transparency  0-90, how see-through the glass is
//   player_bar_shade_transparency  0-100, the shade under the seek bar (glass only)

import { useEffect, useState } from 'react'
import { api } from './api'

const KEYS = ['glass_player_bar', 'player_bar_floating', 'player_bar_gradient', 'player_waveform']
const VALUE_KEYS = ['player_bar_gradient_strength', 'player_bar_gradient_speed', 'player_bar_glass_transparency', 'player_bar_shade_transparency']
let values = Object.fromEntries(KEYS.map(key => [key, true]))
let raw = {}
let load = null
const listeners = new Set()

function apply(s) {
  raw = Object.fromEntries(VALUE_KEYS.map(key => [key, s[key]]))
  values = Object.fromEntries(KEYS.map(key => [key, s[key] !== '0']))
  if (s.player_bar_floating == null || s.player_bar_floating === '') values.player_bar_floating = s.glass_player_bar !== '0'
}

function notify() { listeners.forEach(fn => fn()) }

function refresh() {
  load = Promise.resolve(api.getSettings?.())
    .then(s => { if (s && !s.error) apply(s) })
    .catch(() => {})
    .then(notify)
  return load
}
if (typeof window !== 'undefined') window.addEventListener('lokal:settings-saved', refresh)

function useSubscribed(read) {
  const [value, setValue] = useState(read)
  useEffect(() => {
    const update = () => setValue(read())
    listeners.add(update)
    if (!load) refresh()
    else load.then(update)
    return () => { listeners.delete(update) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return value
}

/** true unless the appearance setting `key` has been switched off. */
export function useAppearanceFlag(key) {
  return useSubscribed(() => values[key])
}

/** A numeric appearance setting, or `fallback` when unset. */
export function useAppearanceValue(key, fallback) {
  return useSubscribed(() => {
    const n = Number(raw[key])
    return raw[key] != null && raw[key] !== '' && Number.isFinite(n) ? n : fallback
  })
}

/** Shows a value at once (a slider being dragged), before the save comes back. */
export function previewAppearanceValue(key, value) {
  raw = { ...raw, [key]: String(value) }
  notify()
}
