// The Lyrics Search tab's Check: the song plays and the side panel's Lyrics
// tab shows the lyrics found for it instead of its own -- nothing is written
// anywhere. It lasts while that song is the one playing (or until the search
// is saved or cancelled).

import { create } from 'zustand'
import { usePlayerStore } from './store/player'

export const useLyricsPreview = create(() => ({ trackId: null, result: null }))

export function showLyricsPreview(trackId, result) {
  useLyricsPreview.setState({ trackId: trackId ?? null, result: result || null })
}

export function clearLyricsPreview(trackIds = null) {
  const { trackId } = useLyricsPreview.getState()
  if (trackId == null) return
  if (trackIds && !trackIds.some(id => String(id) === String(trackId))) return
  useLyricsPreview.setState({ trackId: null, result: null })
}

/** The found lyrics for this song while it's being checked, else null. */
export function useLyricsPreviewFor(trackId) {
  return useLyricsPreview(s => (s.trackId != null && trackId != null && String(s.trackId) === String(trackId) ? s.result : null))
}

// Another song started: the check is over.
usePlayerStore.subscribe((state, prev) => {
  if (state.currentTrack?.id === prev.currentTrack?.id) return
  const { trackId } = useLyricsPreview.getState()
  if (trackId != null && String(state.currentTrack?.id) !== String(trackId)) clearLyricsPreview()
})
