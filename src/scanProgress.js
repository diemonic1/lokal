// The library scan's progress, for the bar next to Home: one subscription to
// the scanner's progress events, shared by everyone who shows it.

import { useSyncExternalStore } from 'react'
import { api, peekSettings } from './api'
import { announceTrackChanged } from './trackChanged'

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
  // The music folder changed outside Lokal (a tag editor, Explorer). A few
  // retagged songs are read again where they are shown; songs that came or
  // went (or many at once) refresh the lists, counts and albums.
  api.onLibraryChanged(changes => {
    const added = changes?.added || []
    const updated = changes?.updated || []
    const removed = changes?.removed || []
    if (added.length || removed.length || updated.length > 20) {
      window.dispatchEvent(new Event('lokal:refresh'))
      return
    }
    for (const id of updated) announceTrackChanged(id)
  })
}

export function useScanProgress() {
  ensureSubscribed()
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => state)
}

/**
 * Scan the music folder: `full` reads every file's tags again, otherwise only
 * new and changed files are read. The desktop app reports progress as it
 * goes; the web server only answers once it started.
 */
export async function rescanLibrary(folder, { full = true } = {}) {
  ensureSubscribed()
  let target = folder || peekSettings()?.music_folder
  if (!target) {
    try { target = (await api.getSettings())?.music_folder } catch {}
  }
  if (!target) return
  set({ scanning: true, done: 0, total: 0 })
  try {
    await api.scanFolder(target, { full })
  } catch {
    set({ scanning: false })
  } finally {
    if (!api.isElectron) {
      set({ scanning: false })
      window.dispatchEvent(new Event('lokal:refresh'))
    }
  }
}

// Every launch catches up with what changed while the app was closed (once
// per app start, not per remount): files whose modification time differs
// from the library's are read again, the rest cost a stat. Then the desktop
// app watches the folder.
let startupScanDone = false
export function rescanOnStartup() {
  if (startupScanDone) return
  startupScanDone = true
  rescanLibrary(null, { full: false }).catch(() => {})
}
