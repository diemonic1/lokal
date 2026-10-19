// Playback speed (0.1x-2.5x), set above the equalizer (Settings and the
// header's equalizer popup). The song's audio elements play at it (App.jsx),
// and so does its music video (src/musicVideoPlayback.js, ClipLoop), which
// follows the song. Saved in localStorage ('lokal-playback-speed').

import { create } from 'zustand'

export const SPEED_MIN = 0.1
export const SPEED_MAX = 2.5
export const SPEED_STEP = 0.05
const KEY = 'lokal-playback-speed'

export function normalizeSpeed(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)) * 100) / 100
}

function readStored() {
  try { return normalizeSpeed(localStorage.getItem(KEY) ?? 1) } catch { return 1 }
}

export const usePlaybackSpeed = create(set => ({
  speed: readStored(),
  setSpeed: (value) => {
    const speed = normalizeSpeed(value)
    set({ speed })
    try { localStorage.setItem(KEY, String(speed)) } catch {}
  },
}))

/** The current speed, outside React. */
export const playbackSpeed = () => usePlaybackSpeed.getState().speed
