import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// What a profile shows until it changes anything (and after Reset).
export const DEFAULT_TRACK_COLUMNS = {
  actions: false, artwork: true, artist: true, source: false, comment: true, genre: true,
  tracknum: false, lyrics: false, quality: false, clip: false,
  order: ['number', 'title', 'time', 'source', 'genre', 'album', 'comment', 'added', 'quality', 'tracknum', 'lyrics', 'clip'],
  widths: { title: 453, album: 167, genre: 135, comment: 112, tracknum: 1.5, clip: 81, time: 3.81 },
  rowSize: 1.25, rowGap: 0.1875,
}

/** A profile's saved columns, or the defaults. */
export const savedTrackColumns = (profiles, profile) => profiles[profile] ?? DEFAULT_TRACK_COLUMNS

// Preferences follow the active local profile, across pages and restarts.
// A blocked/full browser store still lets the current session edit columns.
export const useTrackColumnsStore = create(persist((set) => ({
  profiles: {},
  setColumn: (profile, key, value) => set(state => ({
    profiles: { ...state.profiles, [profile]: { ...savedTrackColumns(state.profiles, profile), [key]: value } },
  })),
  resetColumns: (profile) => set(state => {
    const profiles = { ...state.profiles }
    delete profiles[profile]
    return { profiles }
  }),
}), {
  name: 'lokal-track-columns-v1',
  storage: createJSONStorage(() => ({
    getItem: key => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key, value) => { try { localStorage.setItem(key, value) } catch {} },
    removeItem: key => { try { localStorage.removeItem(key) } catch {} },
  })),
  partialize: state => ({ profiles: state.profiles }),
}))
