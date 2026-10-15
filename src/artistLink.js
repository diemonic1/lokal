// Shared logic for turning a track's `artist` name into a link to that
// artist's page. Artist IDs in this app are `a-<slugified-name>` (see
// server/routes/artists.js), and tracks only carry the artist's display
// name, not a resolved id -- so every call site has to re-derive the same
// slug. Centralised here so PlayerBar, RightSidebar, etc. can't drift.

import { isOnlineTrack } from './onlineBrowse.js'
import { streamRef } from './onlineTracks.js'
import { splitArtists, keepCommaSet, artistCreditParts } from './artistNames.js'

// Matches slugify in electron/ipc/scanner.js: non-Latin scripts keep their
// letters (a Cyrillic name used to slug to nothing and got no link).
const SLUG_SEPARATORS = /(?:(?![a-z0-9])[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]|[^\p{L}\p{N}\p{M}])+/gu
const toSlug = value => value.toLowerCase().replace(SLUG_SEPARATORS, '-').replace(/^-+|-+$/g, '')

export function artistToSlug(artistName, keepCommaArtists = []) {
  if (!artistName) return ''
  const lowerName = artistName.toLowerCase().trim()
  for (const keep of keepCommaArtists) {
    const lowerKeep = keep.toLowerCase().trim()
    if (lowerName === lowerKeep || lowerName.startsWith(lowerKeep + ' ') || lowerName.endsWith(' ' + lowerKeep)) {
      return toSlug(keep)
    }
  }
  const firstPart = artistName.split(',')[0].trim()
  return toSlug(firstPart)
}

/**
 * The artists a track credits, each one its own link: the library's songs
 * split the way the scanner links them ("A/B (feat. C)" -> A, B, C); a
 * streamed song lists what its source said.
 */
export function trackArtistNames(track, keepCommaArtists = []) {
  if (!track?.artist) return []
  if (isOnlineTrack(track)) {
    const listed = Array.isArray(track.artists) ? track.artists.map(name => String(name || '').trim()).filter(Boolean) : []
    return listed.length ? listed : [String(track.artist).trim()]
  }
  return splitArtists(track.artist, keepCommaSet(keepCommaArtists))
}

/**
 * A track's credit as shown, its artists marked as links (see
 * artistCreditParts): "A (feat. B)" keeps its own text.
 */
export function trackArtistParts(track, keepCommaArtists = []) {
  const keep = keepCommaSet(keepCommaArtists)
  return artistCreditParts(track?.artist, keep, trackArtistNames(track, keepCommaArtists))
}

/** Opens one of a track's artists (a name from trackArtistNames). */
export function navigateToArtistName(nav, track, name) {
  const slug = name ? toSlug(String(name)) : ''
  if (!nav || !slug) return false
  if (isOnlineTrack(track)) {
    const ref = streamRef(track)
    nav(`/artist/a-${slug}`, { state: { name, anchor: { title: track.title, album: track.album || '', provider: ref?.provider || null, id: ref?.id ?? null } } })
  } else {
    nav(`/artist/a-${slug}`, { state: { name } })
  }
  return true
}

export function navigateToTrackArtist(nav, track, keepCommaArtists = []) {
  if (!nav || !track?.artist) return false
  // A streamed song names its artist as the source does ("Earth, Wind & Fire"
  // is one artist): their page goes by the whole name (built online when the
  // library doesn't have them; it tries the part before a comma if the whole
  // name finds nothing).
  if (isOnlineTrack(track)) {
    const name = String(track.artists?.[0] || track.artist).trim()
    const slug = artistToSlug(name, [name])
    if (!slug) return false
    // The song itself tells their YouTube Music channel from a namesake's.
    const ref = streamRef(track)
    nav(`/artist/a-${slug}`, { state: { name, anchor: { title: track.title, album: track.album || '', provider: ref?.provider || null, id: ref?.id ?? null } } })
    return true
  }
  const slug = artistToSlug(track.artist, keepCommaArtists)
  if (!slug) return false
  // The name too: an artist who's only streamed has no library entry to
  // read it from (their page is built online, see OnlineArtist).
  const name = String(track.artist).split(',')[0].trim()
  nav(`/artist/a-${slug}`, { state: { name: keepCommaArtists.find(keep => String(track.artist).toLowerCase().includes(keep.toLowerCase())) || name } })
  return true
}
