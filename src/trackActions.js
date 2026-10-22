// What a selection of songs can be sent to: the queue or a playlist.
// Shared by the song lists, the album page, the albums grid, Home's
// mixes and suggestions, and the recap.

import { usePlayerStore, useAppStore } from './store/player'
import { showToast } from './components/Toaster'
import { plural } from './plural'
import { isGhostTrack, isPlayable } from './onlineTracks'
import { translate } from './i18n'

// Import placeholders can't be played; streamed songs can.
const isPlaceholder = (track) => !track?.id || !isPlayable(track)

/** Songs that are in the library (not streamed or import placeholders): what can be deleted. */
export function libraryTracks(tracks) {
  return (tracks || []).filter(track => track?.id && !isGhostTrack(track))
}

/** Right after the current song, in the order given (one by one, they'd end up reversed). */
export function playNextMany(tracks) {
  const list = (tracks || []).filter(track => !isPlaceholder(track))
  if (!list.length) return
  const { playNext } = usePlayerStore.getState()
  for (let i = list.length - 1; i >= 0; i -= 1) playNext(list[i])
  showToast(list.length === 1 ? translate('Playing next: {title}', { title: list[0].title || translate('Unknown track') }) : translate('{tracks} will play next', { tracks: plural(list.length, 'track') }))
}

export function addToQueueMany(tracks) {
  const list = (tracks || []).filter(track => !isPlaceholder(track))
  if (!list.length) return
  const { addToQueue } = usePlayerStore.getState()
  for (const track of list) addToQueue(track)
  showToast(list.length === 1 ? translate('Added to queue: {title}', { title: list[0].title || translate('Unknown track') }) : translate('Added {tracks} to queue', { tracks: plural(list.length, 'track') }))
}

export function addToPlaylistMany(tracks) {
  const list = (tracks || []).filter(track => track?.id)
  if (!list.length) return
  const { openAddToPlaylist, openAddMultipleToPlaylist } = useAppStore.getState()
  if (list.length === 1) openAddToPlaylist(list[0])
  else openAddMultipleToPlaylist(list.map(track => track.id))
}
