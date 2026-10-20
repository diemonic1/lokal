// Loudness normalization (Settings > Playback > Loudness Normalization): how
// loud a song is, measured once and kept, so the player can bring every song
// to the same level. ffmpeg's ebur128 filter reads the whole file and reports
// its integrated loudness (LUFS, ITU-R BS.1770: what Spotify, YouTube and
// ReplayGain 2 measure) and its sample peak. A few seconds for a new song,
// one at a time; afterwards it's read back from the database.

const { spawn } = require('child_process')

const VERSION = 1
const MAX_SECONDS = 20 * 60 // longer (a DJ set, an album in one file): not measured
const TIMEOUT_MS = 120 * 1000

const running = new Map() // key -> Promise<{ lufs, peakDb } | null>
let queue = Promise.resolve() // one ffmpeg at a time

function ensureTable(db) {
  db.prepare('CREATE TABLE IF NOT EXISTS track_loudness (key TEXT PRIMARY KEY, version INTEGER NOT NULL, lufs REAL, peak_db REAL, measured_at INTEGER DEFAULT (unixepoch()))').run()
}

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

function measure(ffmpeg, file, { from = 0, seconds = MAX_SECONDS } = {}) {
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

/**
 * A song's loudness: { lufs, peakDb } (either may be null), from the database
 * or measured now; null when it can't be (no file, no ffmpeg, silence).
 */
function loudnessFor({ db, key, file, ffmpeg, log = () => {} }) {
  if (!key || !file) return Promise.resolve(null)
  ensureTable(db)
  const row = db.prepare('SELECT version, lufs, peak_db FROM track_loudness WHERE key = ?').get(key)
  if (row && row.version === VERSION) return Promise.resolve(row.lufs == null ? null : { lufs: row.lufs, peakDb: row.peak_db })
  if (running.has(key)) return running.get(key)
  const job = queue.then(async () => {
    try {
      const binary = ffmpeg()
      if (!binary) { log(`loudness: no ffmpeg, ${key} not measured`); return null }
      const started = Date.now()
      const result = await measure(binary, file)
      db.prepare('INSERT OR REPLACE INTO track_loudness (key, version, lufs, peak_db) VALUES (?, ?, ?, ?)').run(key, VERSION, result.lufs, result.peakDb)
      log(`loudness: ${key} is ${result.lufs} LUFS, peak ${result.peakDb} dBFS (${Date.now() - started} ms)`)
      return result.lufs == null ? null : result
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
// seconds read in a fraction of a second, so the song starts near its level
// instead of at full volume; the full measurement (done a few seconds later)
// then takes over. Not kept, and not in the queue: it's for the song
// starting right now.
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
      const binary = ffmpeg()
      if (!binary) return null
      const started = Date.now()
      const result = await Promise.race([
        measure(binary, file, { seconds: QUICK_SECONDS }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('estimate took too long')), QUICK_TIMEOUT_MS)),
      ])
      log(`loudness: ${key} estimated at ${result.lufs} LUFS (${Date.now() - started} ms)`)
      return result.lufs == null ? null : { ...result, estimate: true }
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

module.exports = { loudnessFor, quickLoudnessFor, parseSummary }
