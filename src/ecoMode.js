// Eco mode (Settings > Appearance > Eco Mode, and the header's quick settings):
// the app as a plain player. While it's on, everything but the music is
// switched off: visualizations, music videos and song clips, moving covers,
// the colour backgrounds and cover gradient, glass and blur, animations
// (html[data-eco] in index.css, and reduced motion emulated by the main
// process). Turning it on also lets go of what those had loaded (the
// 'lokal:eco-free-memory' event, then the main process's clean-up).
// Turning it off brings everything back as it was: no setting is changed.
//   eco_mode   '1': on. Unset: off

import { useSyncExternalStore } from 'react'
import { api } from './api'

const LOCAL_KEY = 'lokal-eco-mode' // so it applies from the first frame, before the settings load
export const ECO_FREE_MEMORY_EVENT = 'lokal:eco-free-memory'

function readLocal() {
  try { return localStorage.getItem(LOCAL_KEY) === '1' } catch { return false }
}

let on = readLocal()
let started = false
const listeners = new Set()

function apply(next, { force = false } = {}) {
  next = !!next
  if (next === on && !force) return
  const turnedOn = next && !on
  on = next
  try { localStorage.setItem(LOCAL_KEY, on ? '1' : '0') } catch {}
  if (typeof document !== 'undefined') {
    if (on) document.documentElement.dataset.eco = '1'
    else delete document.documentElement.dataset.eco
  }
  listeners.forEach(fn => fn())
  // The main process: reduced motion for the window, and (turning on) its garbage collected.
  Promise.resolve(api.setEcoMode?.(on)).catch(() => {})
  if (turnedOn || (force && on)) freeMemory()
}

/** Lets go of what the switched-off features had loaded. */
function freeMemory() {
  if (typeof window === 'undefined') return
  // After the components using them are gone (the next frames).
  setTimeout(() => {
    window.dispatchEvent(new Event(ECO_FREE_MEMORY_EVENT))
    setTimeout(() => { Promise.resolve(api.freeMemory?.()).catch(() => {}) }, 300)
  }, 100)
}

function refresh() {
  return Promise.resolve(api.getSettings?.())
    .then(s => { if (s && !s.error) apply(s.eco_mode === '1') })
    .catch(() => {})
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  // The saved state on launch: the main process is told even when it's unchanged.
  apply(on, { force: true })
  window.addEventListener('lokal:settings-saved', refresh)
  refresh()
}
start()

export function isEcoMode() { return on }

export function subscribeEcoMode(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** true while eco mode is on. */
export function useEcoMode() {
  return useSyncExternalStore(subscribeEcoMode, isEcoMode, isEcoMode)
}

/** Shows a switch at once, before the save comes back. */
export function previewEcoMode(value) { apply(value) }

/** Switches eco mode and saves it. */
export function setEcoMode(value) {
  apply(value)
  Promise.resolve(api.saveSettings({ eco_mode: value ? '1' : '0' }))
    .then(r => { if (!r?.error) window.dispatchEvent(new Event('lokal:settings-saved')) })
    .catch(() => {})
}
