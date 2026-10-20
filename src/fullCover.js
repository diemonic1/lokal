// Full-size covers for the big views (the fullscreen player, a cover opened
// big). The library keeps a small thumbnail of each song's cover; the full
// picture is read out of the song's file when one of those views opens, and
// shown in place of the thumbnail as soon as it's ready. A few stay in memory
// (as blob: URLs) so going back and forth doesn't read the file again. The
// app keeps a full cover once it's been read (electron/artwork/fullCover.js):
// the song then shows it everywhere, so its lists read it again.

import { useEffect, useState } from 'react'
import { api } from './api.js'
import { isGhostTrack } from './onlineTracks.js'
import { announceTrackChanged } from './trackChanged.js'

const KEEP = 6
const covers = new Map() // key -> { promise, url }

// Only a library song whose cover is in the covers cache has a bigger one in its file.
// (An album's cover comes as { id, artwork_path } of the song it's taken from:
// no file_path, the app looks it up.)
const hasFileCover = track => !!(track?.id && track.artwork_path && (!track.file_path || !isGhostTrack(track)))
const keyOf = track => `${track.id}|${track.artwork_path}`

function remember(key, entry) {
  covers.set(key, entry)
  while (covers.size > KEEP) {
    const [oldest, old] = covers.entries().next().value
    covers.delete(oldest)
    if (old.url) { try { URL.revokeObjectURL(old.url) } catch {} }
  }
}

/** The song's full cover is its cover now: the player and the lists showing it take the new path. */
function coverKept(trackId, artworkPath) {
  // Loaded when needed: this module is also used where there's no player.
  import('./store/player.js').then(({ usePlayerStore }) => {
    const { currentTrack, syncTrack } = usePlayerStore.getState()
    if (currentTrack && String(currentTrack.id) === String(trackId)) syncTrack({ ...currentTrack, artwork_path: artworkPath })
  }).catch(() => {})
  announceTrackChanged(trackId)
}

/** Starts reading the song's full cover (if it has one) -> Promise<url | null>. */
export function prefetchFullCover(track) {
  if (!hasFileCover(track) || typeof URL?.createObjectURL !== 'function') return Promise.resolve(null)
  const key = keyOf(track)
  const known = covers.get(key)
  if (known) {
    // Most recently used last, so it's the last one let go.
    covers.delete(key)
    covers.set(key, known)
    return known.promise
  }
  const entry = { url: null, promise: null }
  entry.promise = api.fullArtwork(track.id).then(async (blob) => {
    if (!blob) return null
    if (blob.artworkPath && blob.artworkPath !== track.artwork_path) coverKept(track.id, blob.artworkPath)
    const url = URL.createObjectURL(blob)
    // Decoded before it's shown, so the swap from the thumbnail doesn't flash.
    try {
      const img = new Image()
      img.src = url
      await img.decode()
    } catch {
      URL.revokeObjectURL(url)
      return null
    }
    if (covers.get(key) !== entry) { URL.revokeObjectURL(url); return null }
    entry.url = url
    return url
  }).catch(() => null)
  remember(key, entry)
  return entry.promise
}

/**
 * The full cover's URL once it's read (null until then, or when the song has
 * none bigger than its thumbnail), and whether it's still being read.
 * `enabled` false reads nothing. -> { url, loading }
 */
export function useFullCoverStatus(track, enabled = true) {
  const key = enabled && hasFileCover(track) ? keyOf(track) : null
  const [state, setState] = useState(() => ({ key, done: false, url: null }))
  useEffect(() => {
    if (!key) return undefined
    let alive = true
    prefetchFullCover(track).then((url) => { if (alive) setState({ key, done: true, url }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!key) return { url: null, loading: false }
  if (state.key === key && state.done) return { url: state.url, loading: false }
  const known = covers.get(key)?.url || null
  return { url: known, loading: !known }
}

/** The full cover's URL once it's read, else null (see useFullCoverStatus). */
export function useFullCover(track, enabled = true) {
  return useFullCoverStatus(track, enabled).url
}
