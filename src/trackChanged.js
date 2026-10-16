// One song's details changed (tag editor, lyrics written into its file): the
// lists showing it read just that song again instead of reloading everything.

import { api } from './api'

export const TRACK_CHANGED = 'lokal:track-changed'

export function announceTrackChanged(trackId) {
  if (trackId == null || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TRACK_CHANGED, { detail: { trackId } }))
}

/** The song as the library has it now (null when it's gone or doesn't match `filters`). */
export async function readTrack(trackId, filters = {}) {
  try {
    const rows = await api.getTracks({ ...filters, id: trackId, limit: 1, offset: 0 })
    return Array.isArray(rows) ? rows.find(row => String(row?.id) === String(trackId)) || null : null
  } catch { return null }
}

// ---------------------------------------------------------------- library order
//
// The same order the library query uses (electron/trackErrors.js), so a song
// whose details changed moves to where a reload would have put it.

const nocase = value => String(value ?? '').replace(/[A-Z]/g, c => c.toLowerCase())
const binary = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
// SQLite puts NULL first when ascending, last when descending.
function byValue(a, b, desc) {
  const an = a == null
  const bn = b == null
  if (an || bn) return an && bn ? 0 : (an ? -1 : 1) * (desc ? -1 : 1)
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : binary(String(a), String(b))
  return desc ? -order : order
}
const LYRICS_RANK = { sync: 3, plain: 2, instrumental: 1, unfound: 1 }

export function libraryComparator(sort) {
  const value = String(sort || '').trim()
  if (/^lyrics/i.test(value)) {
    return (a, b) => ((LYRICS_RANK[a.lyrics_kind] || 0) - (LYRICS_RANK[b.lyrics_kind] || 0))
      || binary(nocase(a.artist), nocase(b.artist))
      || binary(nocase(a.title), nocase(b.title))
  }
  const [column, direction] = value.split(/\s+/)
  const desc = /^desc$/i.test(direction || '')
  return (a, b) => byValue(a?.[column], b?.[column], desc)
}

/**
 * The list with `track` put back where the sort puts it (or dropped when
 * `track` is null). A song that would land after the last loaded one is
 * left for paging to bring in, when there are more pages.
 */
export function placeTrack(list, trackId, track, sort, hasMore = false) {
  const index = list.findIndex(row => String(row?.id) === String(trackId))
  const rest = list.filter(row => String(row?.id) !== String(trackId))
  if (!track) return rest
  const compare = libraryComparator(sort)
  // Still in order where it is (its sort value didn't change): stays put.
  if (index >= 0) {
    const prev = list[index - 1]
    const next = list[index + 1]
    if ((!prev || compare(prev, track) <= 0) && (!next || compare(track, next) <= 0)) {
      return list.map((row, i) => (i === index ? track : row))
    }
  }
  let at = rest.findIndex(row => compare(track, row) < 0)
  if (at < 0) {
    if (hasMore) return rest
    at = rest.length
  }
  return [...rest.slice(0, at), track, ...rest.slice(at)]
}
