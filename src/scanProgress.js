// The library scan's progress, for the bar next to Home: one subscription to
// the scanner's progress events, shared by everyone who shows it.

import { useSyncExternalStore } from 'react'
import { api, peekSettings } from './api'

let state = { scanning: false, done: 0, total: 0 }
const listeners = new Set()
const set = next => {
  state = { ...state, ...next }
  listeners.forEach(fn => fn())
}

let subscribed = false
function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  api.onScanProgress((_, data) => {
    if (!data) return
    if (data.complete) {
      set({ scanning: false, done: data.total || 0, total: data.total || 0 })
      window.dispatchEvent(new Event('lokal:refresh'))
    } else {
      set({ scanning: true, done: data.done || 0, total: data.total || 0 })
    }
  })
}

export function useScanProgress() {
  ensureSubscribed()
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => state)
}

/**
 * Scan the music folder, reading every file's tags again. The desktop app
 * reports progress as it goes; the web server only answers once it started.
 */
export async function rescanLibrary(folder) {
  ensureSubscribed()
  let target = folder || peekSettings()?.music_folder
  if (!target) {
    try { target = (await api.getSettings())?.music_folder } catch {}
  }
  if (!target) return
  set({ scanning: true, done: 0, total: 0 })
  try {
    await api.scanFolder(target, { full: true })
  } catch {
    set({ scanning: false })
  } finally {
    if (!api.isElectron) {
      set({ scanning: false })
      window.dispatchEvent(new Event('lokal:refresh'))
    }
  }
}

// Every launch reads the tags again (once per app start, not per remount).
let startupScanDone = false
export function rescanOnStartup() {
  if (startupScanDone) return
  startupScanDone = true
  rescanLibrary().catch(() => {})
}
