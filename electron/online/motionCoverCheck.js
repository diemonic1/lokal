// Clip Search's "Check for moving covers": every library song is asked of the
// moving-cover sources (artwork/motion.js checkMotionCover) -- only asked,
// nothing downloaded -- and what's found is written on its row, so the tab's
// table fills in as it goes. Nothing about the run is kept: stopped, it starts
// over from the first song next time.

const { checkMotionCover, enabledSources } = require('../artwork/motion')
const { counts, SONG_SQL } = require('./clipSearch')

// Songs asked at once.
const WORKERS = 3
// The time left is shown once this many songs have been asked.
const ETA_MIN_SAMPLES = 10
// The table's counts are sent along at most this often.
const COUNTS_EVERY_MS = 1000

let job = null // { cancelled }
let progress = { status: 'idle' }

function broadcast(payload) {
  try {
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.webContents.isDestroyed()) win.webContents.send('motionCoverCheck:progress', payload) } catch {}
    }
  } catch {}
}

function settingsMap(db) {
  try { return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) } catch { return {} }
}

/** Where the check is: { status: 'idle' | 'running' | 'stopped' | 'done', done, total, found, etaMs, current, counts }. */
const status = () => progress

/** Starts the check over every song (from the first one again). */
function start(db) {
  if (job) return { ok: true, progress }
  const settings = settingsMap(db)
  if (settings.motion_covers === '0') return { ok: false, error: 'Moving covers are turned off in Settings.' }
  if (!enabledSources(settings).length) return { ok: false, error: 'No moving-cover sources are switched on in Settings.' }
  const rows = db.prepare(`SELECT id, title, artist, album FROM tracks WHERE ${SONG_SQL} ORDER BY id`).all()
  const current = job = { cancelled: false }
  const startedAt = Date.now()
  let done = 0
  let found = 0
  let next = 0
  let countsSentAt = 0
  const send = (status, now = null, withCounts = false) => {
    const elapsed = Date.now() - startedAt
    progress = {
      status, done, total: rows.length, found, startedAt, current: now,
      etaMs: done >= ETA_MIN_SAMPLES ? Math.round((elapsed / done) * Math.max(0, rows.length - done)) : null,
      counts: withCounts || Date.now() - countsSentAt >= COUNTS_EVERY_MS ? (countsSentAt = Date.now(), counts(db)) : undefined,
    }
    broadcast(progress)
  }
  const worker = async () => {
    while (!current.cancelled && next < rows.length) {
      const track = rows[next++]
      send('running', `${track.artist} — ${track.title}`)
      try { if (await checkMotionCover(db, track, settings)) found++ } catch {}
      done++
    }
  }
  send('running', null, true)
  Promise.all(Array.from({ length: Math.min(WORKERS, rows.length) }, worker)).finally(() => {
    if (job === current) job = null
    send(current.cancelled ? 'stopped' : 'done', null, true)
  })
  return { ok: true, progress }
}

/** Stops it after the songs being asked now; the next start begins from the first song. */
function stop() {
  if (job) job.cancelled = true
  return { ok: true }
}

module.exports = { start, stop, status }
