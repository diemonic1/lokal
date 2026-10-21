// Loudness normalization (Settings > Playback > Loudness Normalization): how
// loud a song is, measured once and kept, so the player can bring every song
// to the same level: its integrated loudness (LUFS, ITU-R BS.1770: what
// Spotify, YouTube and ReplayGain 2 measure) and its sample peak.
//
// MP3s are measured by Lokal's own decoder and meter (native/loudness, the
// same code Lokal for Android runs), and the result goes into the file as
// ReplayGain tags (./replayGainTag.js): other players read it, and a file
// synced with the phone is measured once for both. A file already holding a
// track gain (from either Lokal or any other program) isn't measured at all.
// Other formats are measured by ffmpeg's ebur128 filter, kept only here.
// A fraction of a second for a new song, one at a time; afterwards it's read
// back from the database.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const replayGainTag = require('./replayGainTag')

const VERSION = 2 // 2: Lokal's own decoder and meter (1 was ffmpeg for everything)
const MAX_SECONDS = 20 * 60 // longer (a DJ set, an album in one file): only the start is measured
const TIMEOUT_MS = 120 * 1000
const REPLAYGAIN_REFERENCE_LUFS = -18

const running = new Map() // key -> Promise<{ lufs, peakDb } | null>
let queue = Promise.resolve() // one measurement at a time

let tableReady = false
function ensureTable(db) {
  if (tableReady) return
  db.prepare('CREATE TABLE IF NOT EXISTS track_loudness (key TEXT PRIMARY KEY, version INTEGER NOT NULL, lufs REAL, peak_db REAL, measured_at INTEGER DEFAULT (unixepoch()))').run()
  // Older measurements are measured again (and then written into the files).
  db.prepare('DELETE FROM track_loudness WHERE version <> ?').run(VERSION)
  tableReady = true
}

// --- Lokal's own measurement (MP3) ---

const STATUS = { OK: 0, SILENT: 1, NOT_MP3: 2 }
let addon
function nativeLoudness() {
  if (addon === undefined) {
    try { addon = require(path.join(__dirname, 'native', `loudness.${process.platform}-${process.arch}.node`)) } catch { addon = null }
  }
  return addon
}

const isMp3 = file => /\.mp3$/i.test(file)
const peakDbOf = peakMicro => (peakMicro > 0 ? 20 * Math.log10(peakMicro / 1e6) : null)

/**
 * { lufs, peakDb, lufsTenths, peakMicro } (lufs null for silence) by Lokal's
 * own decoder; null when it isn't an MP3 it can read (ffmpeg's turn).
 */
async function measureNative(file, seconds) {
  const native = nativeLoudness()
  if (!native || !isMp3(file)) return null
  const r = await native.measure(file, seconds)
  if (r.status === STATUS.OK) return { lufs: r.lufsTenths / 10, peakDb: peakDbOf(r.peakMicro), lufsTenths: r.lufsTenths, peakMicro: r.peakMicro }
  if (r.status === STATUS.SILENT) return { lufs: null, peakDb: peakDbOf(r.peakMicro) }
  if (r.status === STATUS.NOT_MP3) return null
  throw new Error(`Couldn't read the file (${r.status})`)
}

// --- ffmpeg (other formats) ---

/** "I: -9.8 LUFS" and "Peak: 0.4 dBFS" from the end of ebur128's summary. */
function parseSummary(text) {
  const summary = text.slice(text.lastIndexOf('Summary:'))
  const lufs = Number(summary.match(/I:\s*(-?[\d.]+|-inf)\s*LUFS/)?.[1])
  const peakDb = Number(summary.match(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/)?.[1])
  return {
    lufs: Number.isFinite(lufs) ? lufs : null,
    peakDb: Number.isFinite(peakDb) ? peakDb : null,
  }
}

function measureFfmpeg(ffmpeg, file, { from = 0, seconds = MAX_SECONDS } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', ...(from > 0 ? ['-ss', String(from)] : []), '-i', file, '-vn', '-t', String(seconds), '-af', 'ebur128=peak=sample', '-f', 'null', '-']
    const child = spawn(ffmpeg, args, { windowsHide: true })
    // The per-frame lines can run long: only the end (the summary) is kept.
    let tail = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Measuring took too long')) }, TIMEOUT_MS)
    child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-6000) })
    child.stdout.resume()
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) { reject(new Error(tail.trim().split('\n').pop() || `ffmpeg exited with ${code}`)); return }
      resolve(parseSummary(tail))
    })
  })
}

/** Lokal's own measurement for MP3s, else ffmpeg's; null when there's neither. */
async function measure(file, seconds, ffmpeg) {
  const own = await measureNative(file, seconds)
  if (own) return own
  const binary = ffmpeg()
  return binary ? measureFfmpeg(binary, file, { seconds }) : null
}

// --- ReplayGain tags ---

/** The loudness a file's track gain stands for, or null when it has none. */
function fromTags(file) {
  if (!isMp3(file)) return null
  const rg = replayGainTag.readTrackReplayGain(file)
  if (!rg) return null
  return { lufs: REPLAYGAIN_REFERENCE_LUFS - rg.trackGainDb, peakDb: rg.trackPeak ? 20 * Math.log10(rg.trackPeak) : null, fromTags: true }
}

// Measurements whose file couldn't be written at once (it's playing, or
// locked by another program): tried again a bit later, a few times.
const pendingWrites = new Map() // file -> { measured, size, mtimeMs, tries, onWritten, log }
const WRITE_RETRY_MS = 30 * 1000
const WRITE_TRIES = 20
let retryTimer = null

/**
 * Writes the measurement into the file, unless the file has changed since it
 * was measured or has a track gain by now (the phone's, synced in meanwhile).
 */
function writeTags(file, entry) {
  let st
  try { st = fs.statSync(file) } catch { return 'gone' }
  if (st.size !== entry.size || Math.round(st.mtimeMs) !== Math.round(entry.mtimeMs)) return 'changed'
  if (replayGainTag.readTrackReplayGain(file)) return 'tagged'
  replayGainTag.writeTrackReplayGain(file, entry.measured)
  return 'written'
}

function tryWrite(file, entry) {
  try {
    const outcome = writeTags(file, entry)
    if (outcome === 'written') {
      entry.onWritten?.(file)
      entry.log(`loudness: wrote ReplayGain into ${file}`)
    }
    pendingWrites.delete(file)
  } catch (error) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(error?.code || error?.message || ''))
    if (!busy || ++entry.tries >= WRITE_TRIES) {
      pendingWrites.delete(file)
      entry.log(`loudness: couldn't write ReplayGain into ${file}: ${error.message}`)
      return
    }
    pendingWrites.set(file, entry)
    if (!retryTimer) {
      retryTimer = setInterval(() => {
        for (const [f, e] of [...pendingWrites]) tryWrite(f, e)
        if (pendingWrites.size === 0) { clearInterval(retryTimer); retryTimer = null }
      }, WRITE_RETRY_MS)
      retryTimer.unref?.()
    }
  }
}

/**
 * A song's loudness: { lufs, peakDb } (either may be null), from the database,
 * the file's ReplayGain tags or measured now; null when it can't be (no file,
 * silence). `onWritten(file)`: called after the tags went into the file.
 */
function loudnessFor({ db, key, file, ffmpeg, log = () => {}, onWritten }) {
  if (!key || !file) return Promise.resolve(null)
  ensureTable(db)
  const row = db.prepare('SELECT version, lufs, peak_db FROM track_loudness WHERE key = ?').get(key)
  if (row && row.version === VERSION) return Promise.resolve(row.lufs == null ? null : { lufs: row.lufs, peakDb: row.peak_db })
  if (running.has(key)) return running.get(key)
  const job = queue.then(async () => {
    try {
      const tagged = fromTags(file)
      if (tagged) {
        db.prepare('INSERT OR REPLACE INTO track_loudness (key, version, lufs, peak_db) VALUES (?, ?, ?, ?)').run(key, VERSION, tagged.lufs, tagged.peakDb)
        return tagged
      }
      const before = fs.statSync(file)
      const started = Date.now()
      const result = await measure(file, MAX_SECONDS, ffmpeg)
      if (!result) { log(`loudness: no ffmpeg, ${key} not measured`); return null }
      db.prepare('INSERT OR REPLACE INTO track_loudness (key, version, lufs, peak_db) VALUES (?, ?, ?, ?)').run(key, VERSION, result.lufs, result.peakDb)
      log(`loudness: ${key} is ${result.lufs} LUFS, peak ${result.peakDb} dBFS (${Date.now() - started} ms)`)
      if (result.lufsTenths != null) {
        tryWrite(file, {
          measured: { lufsTenths: result.lufsTenths, peakMicro: result.peakMicro },
          size: before.size, mtimeMs: before.mtimeMs, tries: 0, onWritten, log,
        })
      }
      return result.lufs == null ? null : { lufs: result.lufs, peakDb: result.peakDb }
    } catch (error) {
      log(`loudness: couldn't measure ${key}: ${error.message}`)
      return null
    } finally {
      running.delete(key)
    }
  })
  queue = job.catch(() => {})
  running.set(key, job)
  return job
}

// A quick estimate while a new song's full measurement runs: its first five
// seconds read in a moment, so the song starts near its level instead of at
// full volume; the full measurement (done a moment later) then takes over.
// Not kept, and not in the queue: it's for the song starting right now.
const QUICK_SECONDS = 5
const QUICK_TIMEOUT_MS = 3000
const quickRunning = new Map() // key -> Promise<{ lufs, peakDb, estimate } | null>

function quickLoudnessFor({ db, key, file, ffmpeg, log = () => {} }) {
  if (!key || !file) return Promise.resolve(null)
  ensureTable(db)
  const row = db.prepare('SELECT version, lufs, peak_db FROM track_loudness WHERE key = ?').get(key)
  if (row && row.version === VERSION) return Promise.resolve(row.lufs == null ? null : { lufs: row.lufs, peakDb: row.peak_db })
  if (quickRunning.has(key)) return quickRunning.get(key)
  const job = (async () => {
    try {
      const tagged = fromTags(file)
      if (tagged) return tagged
      const started = Date.now()
      const result = await Promise.race([
        measure(file, QUICK_SECONDS, ffmpeg),
        new Promise((_, reject) => setTimeout(() => reject(new Error('estimate took too long')), QUICK_TIMEOUT_MS)),
      ])
      if (!result) return null
      log(`loudness: ${key} estimated at ${result.lufs} LUFS (${Date.now() - started} ms)`)
      return result.lufs == null ? null : { lufs: result.lufs, peakDb: result.peakDb, estimate: true }
    } catch (error) {
      log(`loudness: couldn't estimate ${key}: ${error.message}`)
      return null
    } finally {
      quickRunning.delete(key)
    }
  })()
  quickRunning.set(key, job)
  return job
}

module.exports = { loudnessFor, quickLoudnessFor, parseSummary, VERSION }
