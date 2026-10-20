// AutoMix's analyses for the window (electron/automix): a song's, by its
// library file or its online stream, analysed once and kept.

function registerAutomixHandlers(ipcMain) {
  const fs = require('fs')
  const { getDB } = require('./db')
  const { analysisFor } = require('../automix')
  const log = message => { try { require('electron-log').info(message) } catch {} }

  ipcMain.handle('automix:analyze', async (_, track) => {
    if (!track?.id) return null
    const db = getDB()
    const sources = require('../online/sources')
    const ref = sources.streamRef(track)
    if (ref) {
      return analysisFor({
        db, key: `${ref.provider}:${ref.id}`, log,
        ffmpeg: () => require('./tools').findFfmpeg(),
        source: async () => {
          const stream = await sources.resolveStream(ref.provider, ref.id, require('./online').streamOptions())
          return stream?.file ? { file: stream.file } : stream?.url ? { url: stream.url, headers: stream.headers } : null
        },
      })
    }
    const file = String(track.file_path || '')
    if (!file || file.startsWith('ghost://')) return null
    return analysisFor({
      db, key: String(track.id), trackId: String(track.id), log,
      ffmpeg: () => require('./tools').findFfmpeg(),
      source: async () => (fs.existsSync(file) ? { file } : null),
    })
  })

  // Loudness normalization: a library song's measured loudness (electron/loudness.js).
  // Online songs aren't measured (it would mean downloading them twice).
  const loudnessJob = (track) => {
    if (!track?.id) return null
    const file = String(track.file_path || '')
    if (!file || /^(ghost|https?):/i.test(file) || !fs.existsSync(file)) return null
    let stamp = ''
    try { const st = fs.statSync(file); stamp = `${st.size}:${Math.round(st.mtimeMs)}` } catch {}
    return { db: getDB(), key: `${track.id}|${stamp}`, file, log, ffmpeg: () => require('./tools').findFfmpeg() }
  }
  ipcMain.handle('loudness:measure', async (_, track) => {
    const job = loudnessJob(track)
    return job ? require('../loudness').loudnessFor(job) : null
  })
  // A quick estimate for a song starting before it's been measured.
  ipcMain.handle('loudness:estimate', async (_, track) => {
    const job = loudnessJob(track)
    return job ? require('../loudness').quickLoudnessFor(job) : null
  })
}

module.exports = { registerAutomixHandlers }
