// The per-output sync offsets (see syncOffsetCore.js): which outputs this
// app has seen, each one's offset, and which one is playing now. Kept in
// localStorage under a lokal- key, so the full app export carries them.

import { create } from 'zustand'
import { usePlayerStore } from './store/player.js'
import { readOutputPreferences } from './audio/nativeOutput.js'
import { listAudioOutputs } from './audioOutput.js'
import { browserOutputNames, clampSyncOffset, deviceKey, readDeviceMap, rememberDevices, resolveBrowserOutput } from './syncOffsetCore.js'

export const SYNC_OFFSETS_KEY = 'lokal-sync-offsets'

function save(devices) {
  try { localStorage.setItem(SYNC_OFFSETS_KEY, JSON.stringify({ devices })) } catch {}
}

export const useSyncOffsets = create((set, get) => ({
  devices: (() => { try { return readDeviceMap(localStorage.getItem(SYNC_OFFSETS_KEY)) } catch { return {} } })(),
  // The output playing now: its key and name ('' until it's known).
  activeKey: '',
  activeName: '',
  remember: (names) => {
    const devices = rememberDevices(get().devices, names)
    if (devices === get().devices) return
    set({ devices })
    save(devices)
  },
  setActive: (name) => {
    const key = deviceKey(name)
    if (key) get().remember([name])
    if (key !== get().activeKey || name !== get().activeName) set({ activeKey: key, activeName: key ? name : '' })
  },
  setOffset: (key, seconds) => {
    const entry = get().devices[key]
    if (!entry) return
    const offset = clampSyncOffset(seconds)
    if (offset === entry.offset) return
    const devices = { ...get().devices, [key]: { ...entry, offset } }
    set({ devices })
    save(devices)
  },
}))

/** Seconds lyrics, videos and visualizations are held back for the output playing now. */
export function currentSyncOffset() {
  // Casting: the TV plays it, by its own clock.
  if (usePlayerStore.getState().castActive) return 0
  const { devices, activeKey } = useSyncOffsets.getState()
  return devices[activeKey]?.offset || 0
}

/** The same, as a hook: re-renders when the output or its offset changes. */
export function useSyncOffset() {
  const offset = useSyncOffsets(state => state.devices[state.activeKey]?.offset || 0)
  return usePlayerStore(state => state.castActive) ? 0 : offset
}

/** The output playing now and its offset, also while casting (for Settings). */
export function useActiveSyncDevice() {
  const activeKey = useSyncOffsets(state => state.activeKey)
  const entry = useSyncOffsets(state => state.devices[state.activeKey])
  return { key: activeKey, name: entry?.name || '', offset: entry?.offset || 0 }
}

/** A visual time for a player position: the position, held back by the offset. */
export function visualTime(position) {
  return position - currentSyncOffset()
}

let started = false
let refreshSeq = 0

async function refresh() {
  const seq = ++refreshSeq
  const store = useSyncOffsets.getState()
  const [browser, native] = await Promise.all([
    listAudioOutputs().catch(() => []),
    window.electron?.nativeAudio?.devices?.().catch(() => null) ?? null,
  ])
  if (seq !== refreshSeq) return
  const nativeDevices = native?.available ? native.devices || [] : []
  store.remember([...browserOutputNames(browser), ...nativeDevices.map(d => d.name)])
  if (window.__lokalOutputStatus?.mode === 'native') {
    const chosen = readOutputPreferences().deviceName
    store.setActive(chosen || nativeDevices.find(d => d.isDefault)?.name || '')
  } else {
    store.setActive(resolveBrowserOutput(browser, usePlayerStore.getState().outputDeviceId))
  }
}

/**
 * Follows the outputs: remembers every one that shows up and which one plays
 * now (the chosen output, or what Windows' default points at). Call once.
 */
export function startSyncOffsetTracking() {
  if (started || typeof window === 'undefined') return
  started = true
  refresh()
  navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
  window.addEventListener('lokal:output-status', refresh)
  usePlayerStore.subscribe((state, prev) => { if (state.outputDeviceId !== prev.outputDeviceId) refresh() })
}
