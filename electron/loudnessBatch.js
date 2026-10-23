// Settings > Playback > Loudness Normalization > Recalculate all: every
// library song whose loudness isn't known yet is measured now, and MP3s get it
// written into their ReplayGain tags (./loudness.js measureIntoFile), as a
// song played for the first time does. First it counts the songs without it
// (an MP3 without a track gain in the file, another file not measured here),
// then works through them one at a time. Stopped, a later run picks up the
// ones still left: the count skips the finished ones.

const fs = require('fs')
const loudness = require('./loudness')
const replayGainTag = require('./replayGainTag')

const IDLE = { running: false, phase: null, total: 0, done: 0, written: 0, failed: 0, finishedAt: null, cancelled: false }
let status = { ...IDLE }
let cancelRequested = false

const breathe = () => new Promise(resolve => setImmediate(resolve))

function getStatus() {
  return { ...status }
}

/** The library songs whose loudness isn't in their file (MP3) or in the database (others). */
async function songsWithout(db) {
  const rows = db.prepare("SELECT id, file_path FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND file_path NOT LIKE 'http%'").all()
  const out = []
  for (let i = 0; i < rows.length; i++) {
    if (cancelRequested) break
    const { id, file_path: file } = rows[i]
    try {
      if (!file || !fs.statSync(file).isFile()) continue
      const missing = loudness.isMp3(file) ? !replayGainTag.readTrackReplayGain(file) : !loudness.isKnown(db, loudness.keyFor(id, file))
      if (missing) out.push({ id, file })
    } catch {}
    if (i % 50 === 49) {
      status = { ...status, total: out.length }
      await breathe()
    }
  }
  return out
}

async function run({ db, ffmpeg, log, onWritten }) {
  const songs = await songsWithout(db)
  status = { ...status, phase: 'measuring', total: songs.length }
  for (const song of songs) {
    if (cancelRequested) break
    try {
      const outcome = await loudness.measureIntoFile({ db, key: loudness.keyFor(song.id, song.file), file: song.file, ffmpeg, log, onWritten })
      if (outcome === 'written') status = { ...status, written: status.written + 1 }
      else if (outcome == null) status = { ...status, failed: status.failed + 1 }
    } catch (error) {
      log(`loudness: couldn't measure ${song.file}: ${error.message}`)
      status = { ...status, failed: status.failed + 1 }
    }
    status = { ...status, done: status.done + 1 }
  }
}

/** Starts the run (one stopping but not yet stopped keeps going). -> its status. */
function start(opts) {
  if (status.running) { cancelRequested = false; return getStatus() }
  cancelRequested = false
  status = { ...IDLE, running: true, phase: 'counting' }
  run({ log: () => {}, ...opts })
    .catch(error => opts.log?.(`loudness: Recalculate all stopped: ${error.message}`))
    .finally(() => { status = { ...status, running: false, phase: null, finishedAt: Date.now(), cancelled: cancelRequested } })
  return getStatus()
}

/** Stops after the song being measured. -> the status. */
function cancel() {
  if (status.running) cancelRequested = true
  return getStatus()
}

module.exports = { start, cancel, getStatus }
