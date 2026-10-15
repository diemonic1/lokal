// How an artist credit reads as several artists. Used by the scanner and the
// web server; src/artistNames.js is the renderer's copy (keep them in step,
// scripts/artist-split.test.mjs checks they agree).

// Names that hold a separator but are one artist. The user's own list
// (Settings > keep_comma_artists) is added to these.
const DEFAULT_KEEP_COMMA_ARTISTS = [
  'tyler, the creator', 'earth, wind & fire', 'crosby, stills & nash',
  'crosby, stills, nash & young', 'simon & garfunkel', 'emerson, lake & palmer',
  'syd barrett', 'pete & bas', 'pe & ne', 'ac/dc',
]

// "Ark Patrol (feat. Veronika Redd)", "A [ft. B]" and "A feat B" all credit B
// as a second artist; so do "A (B Remix)", "A (Remix B)", "A (B prod)" and
// "A (prod. by B)", in any case. The bracket may sit anywhere in the credit.
const BRACKET = /\s*[([]\s*([^()[\]]+?)\s*[)\]]/g
const ROLE_BEFORE = /^(?:feat\.?|ft\.?|featuring|remix(?:ed)?(?:\s+by)?|prod\.?(?:\s+by)?|produced\s+by)\s+(.+)$/i
const ROLE_AFTER = /^(.+?)\s+(?:remix|prod\.?)$/i
// "(Radio Remix)", "(VIP Remix)": a kind of remix, not who made it.
const NOT_AN_ARTIST = /^(?:radio|extended|club|vip|original|official|edit|dub|instrumental|acoustic|live|short|long|bootleg|mashup|house|techno|slowed|sped up|remastered|\d{4})(?:\s+(?:edit|mix|version))?$/i
const FEAT_BARE = /\s+(?:feat\.?|ft\.?|featuring)\s+/i
// "A/B", "A \ B", "A; B".
const LIST_SEPARATOR = /\s*[;/\\]\s*/
// "A, B" and "A,B", but not "Tyler, the Creator" (see below) or "10,000 Maniacs".
const COMMA = /\s*,(?!\s*[\d\p{Ll}])\s*/u
const JOINER = /\s+(?:&|x|vs\.?)\s+/i

function splitFeatured(raw) {
  const featured = []
  const main = raw.replace(BRACKET, (whole, inner) => {
    const names = (inner.match(ROLE_BEFORE) || inner.match(ROLE_AFTER))?.[1]?.trim()
    if (!names || NOT_AN_ARTIST.test(names)) return whole
    featured.push(names)
    return ' '
  })
  return [...main.split(FEAT_BARE), ...featured].map(part => part.trim()).filter(Boolean)
}

// A split that leaves one-letter pieces isn't a collaboration but one
// stylised name ("h x m x d" was becoming the artists h, m and d).
function splitUnlessTiny(name, separator) {
  const parts = name.split(separator)
  return parts.some(part => part.trim().length < 2) ? [name] : parts
}

function isKept(name, keepComma) {
  const lower = name.toLowerCase().trim()
  for (const known of keepComma) {
    if (lower === known || lower.startsWith(known + ' ') || lower.endsWith(' ' + known)) return true
  }
  return false
}

function splitCredit(raw, keepComma) {
  if (isKept(raw, keepComma)) return [raw.trim()]
  // "Tyler, the Creator": a comma before a lower-case word is part of the name.
  if (/,\s+[a-z]/.test(raw)) return [raw.trim()]
  return raw.split(COMMA).flatMap(part => isKept(part, keepComma) ? [part] : splitUnlessTiny(part, JOINER))
}

function keepCommaSet(userList = []) {
  const keep = new Set(DEFAULT_KEEP_COMMA_ARTISTS)
  for (const name of userList || []) {
    const lower = String(name || '').toLowerCase().trim()
    if (lower) keep.add(lower)
  }
  return keep
}

/** "A/B (feat. C), D & E" -> ['A', 'B', 'D', 'E', 'C'], without repeats. */
function splitArtists(raw, keepComma = keepCommaSet()) {
  if (!raw) return []
  if (keepComma.has(String(raw).toLowerCase().trim())) return [String(raw).trim()]
  const artists = splitFeatured(String(raw))
    .flatMap(part => isKept(part, keepComma) ? [part] : splitUnlessTiny(part, LIST_SEPARATOR))
    .flatMap(part => splitCredit(part, keepComma))
  return [...new Set(artists.map(name => name.trim()).filter(Boolean))]
}

module.exports = { DEFAULT_KEEP_COMMA_ARTISTS, keepCommaSet, splitArtists }
