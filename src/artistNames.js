// The renderer's copy of electron/artistSplit.js (the scanner's split):
// a track's credit read as the artists it links to. Keep the two in step,
// scripts/artist-split.test.mjs checks they agree.

// Names that hold a separator (a comma, "&", "/", " x "...) but are one
// artist. The user's own list (Settings > keep_comma_artists) is added to these.
export const DEFAULT_KEEP_COMMA_ARTISTS = [
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

export function keepCommaSet(userList = []) {
  const keep = new Set(DEFAULT_KEEP_COMMA_ARTISTS)
  for (const name of userList || []) {
    const lower = String(name || '').toLowerCase().trim()
    if (lower) keep.add(lower)
  }
  return keep
}

// A kept name anywhere in a credit ("AC/DC/Foyon", "Simon & Garfunkel x
// Foyon"), whatever separator it holds -- "/", "&", ",", " x "...: stands in
// for itself as a mark no separator matches while the credit is split, and
// comes back as written. Only as a whole name (not inside a longer word).
const MARK = /\uE000(\d+)\uE001/g
const WORD_CHAR = /[\p{L}\p{N}]/u

function protectKept(raw, keepComma) {
  const names = []
  let text = raw
  const lowerOf = () => text.toLowerCase()
  for (const known of [...keepComma].sort((a, b) => b.length - a.length)) {
    if (!known) continue
    let from = 0
    for (;;) {
      const lower = lowerOf()
      const start = lower.indexOf(known, from)
      if (start < 0) break
      const end = start + known.length
      if ((start > 0 && WORD_CHAR.test(text[start - 1])) || (end < text.length && WORD_CHAR.test(text[end]))) { from = start + 1; continue }
      const mark = `\uE000${names.length}\uE001`
      names.push(text.slice(start, end))
      text = text.slice(0, start) + mark + text.slice(end)
      from = start + mark.length
    }
  }
  return { text, restore: part => part.replace(MARK, (_, i) => names[Number(i)] ?? '') }
}

/** "A/B (feat. C), D & E" -> ['A', 'B', 'D', 'E', 'C'], without repeats. */
export function splitArtists(raw, keepComma = keepCommaSet()) {
  if (!raw) return []
  if (keepComma.has(String(raw).toLowerCase().trim())) return [String(raw).trim()]
  const { text, restore } = protectKept(String(raw), keepComma)
  const artists = splitFeatured(text)
    .flatMap(part => isKept(part, keepComma) ? [part] : splitUnlessTiny(part, LIST_SEPARATOR))
    .flatMap(part => splitCredit(part, keepComma))
    .map(restore)
  return [...new Set(artists.map(name => name.trim()).filter(Boolean))]
}


const LIST_GAP = /^\s*[;/\\,]\s*$/

/**
 * A credit as it should be shown: its own text, with each artist marked so it
 * can be a link. "Ark Patrol (feat. Veronika Redd)" stays as written (both
 * names linked); only a bare "/", "\", ";" or "," between two names reads
 * ", ". -> [{ text, artist? }]
 */
export function artistCreditParts(raw, keepComma = keepCommaSet(), names = splitArtists(raw, keepComma)) {
  const text = String(raw || '').trim()
  if (!text) return []
  // Longest names first, so "Redd" can't claim part of "Veronika Redd".
  const claimed = []
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    let from = 0
    while (from <= text.length) {
      const start = text.indexOf(name, from)
      if (start < 0) break
      const end = start + name.length
      if (!claimed.some(range => start < range.end && end > range.start)) { claimed.push({ start, end, name }); break }
      from = start + 1
    }
  }
  // A name the text doesn't hold as written: just list them all.
  if (claimed.length < names.length) {
    return names.flatMap((name, index) => index ? [{ text: ', ' }, { text: name, artist: name }] : [{ text: name, artist: name }])
  }
  claimed.sort((a, b) => a.start - b.start)
  const parts = []
  let cursor = 0
  claimed.forEach((range, index) => {
    const gap = text.slice(cursor, range.start)
    if (gap) parts.push({ text: index > 0 && LIST_GAP.test(gap) ? ', ' : gap })
    parts.push({ text: range.name, artist: range.name })
    cursor = range.end
  })
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts
}
