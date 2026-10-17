// Lyrics written into downloaded files, and read back from them.
//
// Two tags, the way BitChord does it:
//   - the standard lyrics tag (ID3 USLT, Vorbis LYRICS, MP4 ©lyr) gets plain
//     line-synced LRC -- or plain text -- which any player can show;
//   - a private LOKAL_LYRICS tag keeps everything else Lokal knows: word and
//     syllable timings, background vocals, which side of a duet each line is
//     on. Other players ignore it, so they never show "<00:12.34>" noise.

const PRIVATE_TAG = 'LOKAL_LYRICS'
const FORMAT_VERSION = 1
const MAX_PRIVATE_BYTES = 256 * 1024

const r3 = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 1000) / 1000)

function stamp(seconds) {
  const cs = Math.max(0, Math.round(Number(seconds) * 100))
  const m = Math.floor(cs / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}]`
}

function withBackground(line) {
  const text = String(line.text || '').trim()
  const bg = String(line.bgText || '').trim()
  if (!bg) return text
  const wrapped = /^[([].*[)\]]$/.test(bg) ? bg : `(${bg})`
  return text ? `${text} ${wrapped}` : wrapped
}

/** Standard-tag text: LRC for synced lyrics, plain lines otherwise. Null when there's nothing. */
function toPortableLyrics(result) {
  const lines = Array.isArray(result?.lines) ? result.lines : []
  if (!lines.length) return null
  if (result.sync === 'none' || result.type === 'unsynced') {
    const text = lines.map(withBackground).filter(Boolean).join('\n').trim()
    return text || null
  }
  const out = []
  for (const line of lines) {
    if (line.time == null) continue
    // A break is written the way LRC writes one: a bare stamp.
    if (line.gap) { if (line.time > 0) out.push(stamp(line.time)); continue }
    const text = withBackground(line)
    if (text) out.push(`${stamp(line.time)}${text}`)
  }
  return out.length ? out.join('\n') : null
}

const packUnits = (units) => (Array.isArray(units) ? units : [])
  .filter(u => u && u.word != null && u.time != null)
  .map(u => [String(u.word), r3(u.time), r3(u.end), u.space ? 1 : 0])

const unpackUnits = (units) => (Array.isArray(units) ? units : [])
  .filter(u => Array.isArray(u) && u.length >= 2 && u[1] != null)
  .map(([word, time, end, space]) => ({ word: String(word), time: Number(time), end: end == null ? null : Number(end), space: !!space }))

/** Private-tag JSON, or null when the lyrics have no timing worth keeping (or are too big). */
function toPrivateTag(result) {
  const lines = Array.isArray(result?.lines) ? result.lines : []
  if (!lines.length || result.sync === 'none' || result.type === 'unsynced') return null
  const packed = []
  for (const line of lines) {
    if (line.gap || line.time == null) continue
    const entry = { t: r3(line.time), x: String(line.text || '') }
    if (line.end != null) entry.e = r3(line.end)
    if (line.endStated) entry.s = 1
    const words = packUnits(line.words)
    if (words.length) entry.w = words
    if (line.bgText) entry.b = String(line.bgText)
    const bgWords = packUnits(line.bgWords)
    if (bgWords.length) entry.bw = bgWords
    if (line.agent) entry.a = String(line.agent)
    if (result.duet && line.side === 'end') entry.d = 'e'
    packed.push(entry)
  }
  if (!packed.length) return null
  const json = JSON.stringify({
    lokal: FORMAT_VERSION,
    sync: result.sync || 'line',
    source: result.source || null,
    language: result.language || null,
    duet: !!result.duet,
    lines: packed,
  })
  return Buffer.byteLength(json, 'utf8') <= MAX_PRIVATE_BYTES ? json : null
}

/** Private-tag JSON -> its parsed envelope, or null if it isn't ours. */
function readPrivate(text) {
  if (!text || typeof text !== 'string' || text[0] !== '{') return null
  let data
  try { data = JSON.parse(text) } catch { return null }
  return data && data.lokal === FORMAT_VERSION && Array.isArray(data.lines) ? data : null
}

/** Private-tag JSON -> provider output ({ lines, language }), or null if it isn't ours. */
function fromPrivateTag(text) {
  const data = readPrivate(text)
  if (!data) return null
  const lines = data.lines
    .filter(l => l && l.t != null)
    .map(l => {
      const line = {
        time: Number(l.t),
        end: l.e == null ? null : Number(l.e),
        endStated: !!l.s,
        text: String(l.x || ''),
        words: unpackUnits(l.w),
      }
      if (l.b) line.bgText = String(l.b)
      const bgWords = unpackUnits(l.bw)
      if (bgWords.length) line.bgWords = bgWords
      // Sides are re-derived from voices, so a right-hand line gets its own voice.
      if (data.duet) line.agent = l.d === 'e' ? 'v2' : (l.a === 'v1000' ? 'v1000' : 'v1')
      else if (l.a) line.agent = String(l.a)
      return line
    })
  if (!lines.length) return null
  return { lines, language: data.language || null, origin: data.source || null }
}

// ---------------------------------------------------------------- reading it back from a file

const PRIVATE_IDS = new Set([`TXXX:${PRIVATE_TAG}`, PRIVATE_TAG, `----:com.apple.iTunes:${PRIVATE_TAG}`])

const tagText = (value) => (typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : '')

/** The LOKAL_LYRICS JSON in a music-metadata result, as stored; null when there's none. */
function privateTagText(meta) {
  const values = Object.values(meta?.native || {}).flat()
    .filter(tag => tag && (PRIVATE_IDS.has(tag.id) || String(tag.id).toUpperCase() === PRIVATE_TAG))
    .map(tag => tagText(tag.value))
  for (const value of values) if (readPrivate(value)) return value
  // ID3v2.3 readers split TXXX text on "/", so a lyric with a slash in it
  // ("AC/DC", "24/7") comes back in pieces.
  const joined = values.length > 1 ? values.join('/') : null
  return joined && readPrivate(joined) ? joined : null
}

/** True when the private tag carries word or syllable timings. */
function hasSyllables(text) {
  const data = readPrivate(text)
  return !!data && data.lines.some(l => Array.isArray(l?.w) && l.w.length)
}

// ---------------------------------------------------------------- the tag editor's syllable mode
//
// The private tag is edited as enhanced LRC with millisecond stamps:
//   [00:12.340]<00:12.340>Сло<00:12.610>ва <00:13.020>песни<00:13.500>
// A line nobody touched is written back exactly as it was (word ends, background
// vocal, duet side); an edited one is rebuilt from its stamps and keeps its
// background vocal and voice.

function clock(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000))
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

function entryToEnhanced(entry) {
  const words = unpackUnits(entry.w)
  if (!words.length) return `[${clock(entry.t)}]${String(entry.x || '')}`
  let out = `[${clock(entry.t)}]`
  for (const w of words) out += `<${clock(w.time)}>${w.word}${w.space ? ' ' : ''}`
  const last = words[words.length - 1]
  if (last.end != null) out += `<${clock(last.end)}>`
  return out
}

/** Private-tag JSON -> editable enhanced LRC; '' when it has no word timings. */
function privateToEnhanced(text) {
  if (!hasSyllables(text)) return ''
  return readPrivate(text).lines.filter(l => l && l.t != null).map(entryToEnhanced).join('\n')
}

function parseEditedLine(source) {
  const { parseEnhancedLRC, parseLRC } = require('./lrc')
  return parseEnhancedLRC(source)[0] || parseLRC(source)[0] || null
}

/**
 * Edited enhanced LRC -> private-tag JSON (null when the text is empty).
 * @param previous the tag's JSON before editing, whose untouched lines and
 *                 per-line extras are kept
 */
function enhancedToPrivate(text, previous = null) {
  const rows = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
  if (!rows.length) return null
  const before = readPrivate(previous)
  const old = before ? before.lines.filter(l => l && l.t != null) : []
  const oldByTime = new Map(old.map(entry => [r3(entry.t), entry]))
  const parsed = rows.map(parseEditedLine).filter(Boolean)
  if (!parsed.length) throw new Error('The syllable lyrics need [mm:ss.xx] time stamps on their lines')
  const sameShape = parsed.length === old.length
  const lines = []
  rows.forEach((row) => {
    const line = parseEditedLine(row)
    if (!line) return
    const prior = sameShape ? old[lines.length] : oldByTime.get(r3(line.time))
    if (prior && entryToEnhanced(prior) === row) { lines.push(prior); return }
    const entry = { t: r3(line.time), x: String(line.text || '') }
    if (line.end != null) entry.e = r3(line.end)
    if (line.endStated) entry.s = 1
    const words = packUnits(line.words)
    if (words.length) entry.w = words
    for (const key of ['b', 'bw', 'a', 'd']) if (prior && prior[key] != null) entry[key] = prior[key]
    lines.push(entry)
  })
  lines.sort((a, b) => a.t - b.t)
  const json = JSON.stringify({
    lokal: FORMAT_VERSION,
    sync: lines.some(l => l.w) ? 'syllable' : 'line',
    source: before?.source || 'edited',
    language: before?.language || null,
    duet: !!before?.duet,
    lines,
  })
  if (Buffer.byteLength(json, 'utf8') > MAX_PRIVATE_BYTES) throw new Error('The syllable lyrics are too long to store')
  return json
}

/** Private-tag JSON -> the standard tag's LRC, the way a download writes it. */
function portableFromPrivate(text) {
  const parsed = fromPrivateTag(text)
  return parsed ? toPortableLyrics({ sync: 'syllable', lines: parsed.lines }) : null
}

module.exports = {
  toPortableLyrics, toPrivateTag, fromPrivateTag, stamp, PRIVATE_TAG,
  privateTagText, hasSyllables, privateToEnhanced, enhancedToPrivate, portableFromPrivate,
}
