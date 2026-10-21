// The ReplayGain tags Lokal writes into an MP3 once it has measured it
// (TXXX:REPLAYGAIN_TRACK_GAIN and _TRACK_PEAK, read by foobar2000, MusicBee,
// AIMP, Poweramp, VLC...), so the measurement travels with the file.
//
// Lokal for Android writes the same tags into the same files (a library synced
// between the two with Syncthing). Both measure with the same code
// (native/loudness) and both write with this same writer: a port of Android's
// Id3Writer (app/src/main/java/com/lokal/music/data/Id3.kt), so a song measured
// on both before they sync comes out the same to the byte, and Syncthing sees
// one file instead of a conflict. Not taglib-sharp: it lays a tag out its own
// way. Keep this file and Id3.kt in step (the tests compare their output).
//
//   - every other frame is kept as it is; the two frames go last, gain first
//   - the tag keeps its version (v2.3/v2.4); a file without one gets v2.3;
//     v2.2 isn't written
//   - when the tag fits in the old one's room it's patched in place, else the
//     file is rewritten through a temp file next to it with 2048 bytes to spare

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const GAIN = 'REPLAYGAIN_TRACK_GAIN'
const PEAK = 'REPLAYGAIN_TRACK_PEAK'

/** "-3.70 dB" from the measured loudness in tenths of a LUFS (ReplayGain 2's reference is -18 LUFS). */
function gainText(lufsTenths) {
  const g = -180 - lufsTenths
  const a = Math.abs(g)
  return `${g < 0 ? '-' : '+'}${Math.floor(a / 10)}.${a % 10}0 dB`
}

/** "0.987654" from the sample peak in millionths. */
function peakText(peakMicro) {
  return `${Math.floor(peakMicro / 1e6)}.${String(peakMicro % 1e6).padStart(6, '0')}`
}

// --- reading (Id3.kt RawTag / RawFrame) ---

const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const int32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) | 0
const isIdChar = c => (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)

function unsyncDecode(d) {
  const out = []
  for (let i = 0; i < d.length; i++) {
    out.push(d[i])
    if (d[i] === 0xff && i + 1 < d.length && d[i + 1] === 0) i++
  }
  return Buffer.from(out)
}

function landsOnFrame(body, pos) {
  if (pos === body.length) return true
  if (pos + 4 > body.length) return false
  if (body[pos] === 0) return true
  for (let i = 0; i < 4; i++) if (!isIdChar(body[pos + i])) return false
  return true
}

function parseFrames(body, start, major) {
  const frames = []
  const idLen = major === 2 ? 3 : 4
  const headLen = major === 2 ? 6 : 10
  let pos = start
  while (pos + headLen <= body.length) {
    if (body[pos] === 0) break
    for (let i = 0; i < idLen; i++) if (!isIdChar(body[pos + i])) return frames
    const id = body.toString('latin1', pos, pos + idLen)
    let size = major === 2 ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5]
      : major === 3 ? int32(body, pos + 4) : synchsafe(body, pos + 4)
    if (major === 4) {
      const plain = int32(body, pos + 4)
      if (plain !== size && !landsOnFrame(body, pos + headLen + size) && landsOnFrame(body, pos + headLen + plain)) size = plain
    }
    const flags = major === 2 ? 0 : (body[pos + 8] << 8) | body[pos + 9]
    const dataStart = pos + headLen
    if (size < 0 || dataStart + size > body.length) break
    frames.push({ id, flags, data: body.subarray(dataStart, dataStart + size) })
    pos = dataStart + size
  }
  return frames
}

/** The ID3v2 tag at the start of the open file: { major, flags, totalSize, frames, broken }, or null. */
function readRawTag(fd, fileSize) {
  if (fileSize < 10) return null
  const h = Buffer.alloc(10)
  fs.readSync(fd, h, 0, 10, 0)
  if (h.toString('latin1', 0, 3) !== 'ID3') return null
  const major = h[3]
  if (major < 2 || major > 4) return null
  const flags = h[5]
  const size = synchsafe(h, 6)
  const footer = major === 4 && (flags & 0x10) ? 10 : 0
  const total = 10 + size + footer
  if (size <= 0 || 10 + size > fileSize) return { major, flags, totalSize: Math.min(total, fileSize), frames: [], broken: 10 + size > fileSize }
  let body = Buffer.alloc(size)
  fs.readSync(fd, body, 0, size, 10)
  if (major < 4 && (flags & 0x80)) body = unsyncDecode(body)
  let pos = 0
  if ((flags & 0x40) && major >= 3) pos = major === 3 ? 4 + int32(body, 0) : synchsafe(body, 0)
  return { major, flags, totalSize: total, frames: parseFrames(body, pos, major), broken: false }
}

/** A frame's content with frame-level unsync, grouping, data length and compression undone; null when encrypted. */
function decodedData(f, tag) {
  let d = f.data
  if (tag.major === 3) {
    if (f.flags & 0x0040) return null
    let pos = 0
    const compressed = (f.flags & 0x0080) !== 0
    if (compressed) pos += 4
    if (f.flags & 0x0020) pos += 1
    if (pos > 0) d = d.subarray(Math.min(pos, d.length))
    if (compressed) { try { d = zlib.inflateSync(d) } catch { return null } }
  } else if (tag.major === 4) {
    if (f.flags & 0x0004) return null
    let pos = 0
    if (f.flags & 0x0040) pos += 1
    if (f.flags & 0x0001) pos += 4
    if (pos > 0) d = d.subarray(Math.min(pos, d.length))
    if ((f.flags & 0x0002) || (tag.flags & 0x80)) d = unsyncDecode(d)
    if (f.flags & 0x0008) { try { d = zlib.inflateSync(d) } catch { return null } }
  }
  return d
}

function termEnd(enc, b, from, to) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < to; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i
    return to
  }
  for (let i = from; i < to; i++) if (b[i] === 0) return i
  return to
}

function decodeText(enc, b, from, to) {
  if (to <= from) return ''
  const s = b.subarray(from, to)
  if (enc === 1) {
    if (s.length >= 2 && s[0] === 0xff && s[1] === 0xfe) return s.subarray(2).toString('utf16le')
    if (s.length >= 2 && s[0] === 0xfe && s[1] === 0xff) return Buffer.from(s.subarray(2)).swap16().toString('utf16le')
    return s.toString('utf16le')
  }
  if (enc === 2) return Buffer.from(s.subarray(0, s.length & ~1)).swap16().toString('utf16le')
  if (enc === 3) return s.toString('utf8')
  return s.toString('latin1')
}

/** TXXX: [description, value]. */
function userText(d) {
  if (!d || d.length === 0) return ['', '']
  const enc = d[0]
  const descEnd = termEnd(enc, d, 1, d.length)
  const valueStart = Math.min(d.length, descEnd + (enc === 1 || enc === 2 ? 2 : 1))
  return [decodeText(enc, d, 1, descEnd), decodeText(enc, d, valueStart, termEnd(enc, d, valueStart, d.length))]
}

function txxxDescription(f, tag) {
  const d = decodedData(f, tag)
  if (!d || d.length === 0) return null
  return decodeText(d[0], d, 1, termEnd(d[0], d, 1, d.length))
}

/**
 * The file's track ReplayGain: { trackGainDb, trackPeak } (the peak may be
 * null), or null when it has no track gain or can't be read.
 */
function readTrackReplayGain(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const tag = readRawTag(fd, fs.fstatSync(fd).size)
    if (!tag) return null
    const rg = {}
    for (const f of tag.frames) {
      if (f.id !== (tag.major === 2 ? 'TXX' : 'TXXX')) continue
      const [desc, value] = userText(decodedData(f, tag))
      const key = desc.toUpperCase()
      if (key.startsWith('REPLAYGAIN_') && !(key in rg)) rg[key] = value
    }
    const gain = Number.parseFloat(String(rg[GAIN] ?? '').replace(/\s*dB\s*$/i, '').trim())
    if (!Number.isFinite(gain)) return null
    const peak = Number.parseFloat(String(rg[PEAK] ?? '').trim())
    return { trackGainDb: gain, trackPeak: Number.isFinite(peak) && peak > 0 ? peak : null }
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch {}
  }
}

// --- writing (Id3.kt Id3Writer) ---

function userTextFrame(major, desc, value) {
  if (major === 4) return Buffer.concat([Buffer.from([3]), Buffer.from(desc, 'utf8'), Buffer.from([0]), Buffer.from(value, 'utf8')])
  return Buffer.concat([
    Buffer.from([1, 0xff, 0xfe]), Buffer.from(desc, 'utf16le'), Buffer.from([0, 0]),
    Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le'),
  ])
}

/**
 * Writes the track gain and peak into the MP3's ID3v2 tag (replacing any
 * there). Throws when the file can't be written (busy, read-only, an ID3v2.2
 * or broken tag).
 */
function writeTrackReplayGain(filePath, { lufsTenths, peakMicro }) {
  const fd = fs.openSync(filePath, 'r')
  let old, audioStart, fileSize
  try {
    fileSize = fs.fstatSync(fd).size
    old = readRawTag(fd, fileSize)
    audioStart = old ? old.totalSize : 0
  } finally {
    fs.closeSync(fd)
  }
  if (old && old.major === 2) throw new Error("ID3v2.2 tags can't be written")
  if (old && old.broken) throw new Error('The ID3v2 tag is broken')
  const major = old ? old.major : 3
  const tagUnsync = !!old && major === 4 && (old.flags & 0x80) !== 0
  const frames = (old ? old.frames : []).map(f => (tagUnsync ? { id: f.id, flags: f.flags | 0x0002, data: f.data } : f))

  const ours = new Set([GAIN, PEAK])
  const kept = frames.filter(f => !(f.id === 'TXXX' && ours.has(String(txxxDescription(f, old) ?? '').toUpperCase())))
  kept.push({ id: 'TXXX', flags: 0, data: userTextFrame(major, GAIN, gainText(lufsTenths)) })
  kept.push({ id: 'TXXX', flags: 0, data: userTextFrame(major, PEAK, peakText(peakMicro)) })

  const parts = []
  for (const f of kept) {
    const n = f.data.length
    const head = Buffer.alloc(10)
    head.write(f.id, 0, 'latin1')
    if (major === 4) { head[4] = (n >> 21) & 0x7f; head[5] = (n >> 14) & 0x7f; head[6] = (n >> 7) & 0x7f; head[7] = n & 0x7f } else head.writeUInt32BE(n >>> 0, 4)
    head[8] = (f.flags >> 8) & 0xff
    head[9] = f.flags & 0xff
    parts.push(head, f.data)
  }
  const body = Buffer.concat(parts)
  const inPlace = !!old && 10 + body.length <= audioStart
  const tagSize = inPlace ? audioStart - 10 : body.length + 2048
  const tag = Buffer.alloc(10 + tagSize)
  tag.write('ID3', 0, 'latin1')
  tag[3] = major
  tag[6] = (tagSize >> 21) & 0x7f; tag[7] = (tagSize >> 14) & 0x7f; tag[8] = (tagSize >> 7) & 0x7f; tag[9] = tagSize & 0x7f
  body.copy(tag, 10)

  if (inPlace) {
    const out = fs.openSync(filePath, 'r+')
    try { fs.writeSync(out, tag, 0, tag.length, 0) } finally { fs.closeSync(out) }
    return
  }
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.lokaltmp`)
  try {
    const out = fs.openSync(temp, 'w')
    const input = fs.openSync(filePath, 'r')
    try {
      fs.writeSync(out, tag)
      const chunk = Buffer.alloc(1 << 16)
      for (let pos = audioStart; pos < fileSize;) {
        const n = fs.readSync(input, chunk, 0, chunk.length, pos)
        if (n <= 0) break
        fs.writeSync(out, chunk, 0, n)
        pos += n
      }
    } finally {
      fs.closeSync(input)
      fs.closeSync(out)
    }
    try { fs.renameSync(temp, filePath) } catch { fs.copyFileSync(temp, filePath) }
  } finally {
    try { fs.rmSync(temp, { force: true }) } catch {}
  }
}

module.exports = { GAIN, PEAK, gainText, peakText, readTrackReplayGain, writeTrackReplayGain }
