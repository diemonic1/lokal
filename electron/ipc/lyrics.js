// Lyrics IPC -- thin wrappers over electron/lyrics/service.js, which the web
// server's routes share, so desktop and web behave identically.

const { getDB } = require('./db')
const service = require('../lyrics/service')

function registerLyricsHandlers(ipcMain) {
  const db = getDB()

  // filePath arguments are accepted for compatibility but ignored: the
  // service resolves the file from the library by track id.
  ipcMain.handle('lyrics:get', (_, trackId, title, artist, album, duration, _filePath, options = {}) =>
    service.getLyrics(db, { trackId, title, artist, album, duration, refresh: !!options?.refresh }))

  ipcMain.handle('lyrics:getFrom', (_, providerId, trackId, title, artist, album, duration) =>
    service.getLyricsFrom(db, { trackId, title, artist, album, duration }, providerId))

  ipcMain.handle('lyrics:sources', () => service.sources(db))

  ipcMain.handle('lyrics:reject', (_, providerId, trackId, title, artist, album, duration) =>
    service.rejectSource(db, { trackId, title, artist, album, duration }, providerId))
  ipcMain.handle('lyrics:rejected', (_, trackId) => service.rejectedSources(db, trackId))

  ipcMain.handle('lyrics:import', (_, trackId, content, type) =>
    service.importLyrics(db, trackId, content, type))

  ipcMain.handle('lyrics:clearCache', (_, trackId) => service.clearCache(db, trackId))

  // Writing into the song's file happens only from these, i.e. when the user asks.
  const safely = (fn) => async (...args) => {
    try { return await fn(...args) } catch (e) { return { ok: false, error: e?.message || String(e) } }
  }
  ipcMain.handle('lyrics:readFile', safely((_, trackId) => service.readFileLyrics(db, trackId)))
  ipcMain.handle('lyrics:writeFile', safely((_, trackId, text, syllable) => service.writeFileLyrics(db, trackId, text, syllable)))
  ipcMain.handle('lyrics:embedFrom', safely((_, providerId, trackId, title, artist, album, duration) =>
    service.embedFrom(db, { trackId, title, artist, album, duration }, providerId)))

  ipcMain.handle('lyrics:translate', (_, trackId, lines, targetLang) =>
    service.translate(db, trackId, lines, targetLang))

  ipcMain.handle('lyrics:romanize', (_, trackId, lines) =>
    service.romanize(db, trackId, lines))

  // Kept for older callers; translation now reports the detected language itself.
  ipcMain.handle('lyrics:detectLanguage', async (_, trackId, lines) => {
    const r = await service.translate(db, trackId, lines, 'en')
    const lang = r?.detectedLang || 'unknown'
    return { lang, confidence: lang === 'unknown' ? 0 : 0.9, source: 'remote' }
  })

  // Settings -> Library -> Maintenance: fetch and cache every library song's
  // lyrics now, so they open at once later. One song at a time; cancellable.
  let indexJob = null
  ipcMain.handle('lyrics:indexAll', async (event) => {
    if (indexJob) return { running: true }
    const job = { cancelled: false }
    indexJob = job
    const send = (payload) => { try { if (!event.sender.isDestroyed()) event.sender.send('lyrics:indexProgress', payload) } catch {} }
    try {
      const rows = db.prepare("SELECT id, title, artist, album, duration FROM tracks WHERE title IS NOT NULL AND file_path NOT LIKE 'ghost://%' ORDER BY artist, title").all()
      let done = 0
      let found = 0
      for (const row of rows) {
        if (job.cancelled) break
        send({ running: true, done, total: rows.length, found, title: `${row.artist || ''} — ${row.title}` })
        const lyrics = await service.getLyrics(db, { trackId: row.id, title: row.title, artist: row.artist, album: row.album, duration: row.duration }).catch(() => null)
        if (lyrics) found++
        done++
      }
      send({ running: false, done, total: rows.length, found, cancelled: job.cancelled })
      return { done, total: rows.length, found, cancelled: job.cancelled }
    } finally { indexJob = null }
  })
  ipcMain.handle('lyrics:cancelIndex', () => { if (indexJob) indexJob.cancelled = true })

  // The Lyrics Search tab: lyrics found for many songs at once, kept apart
  // (electron/lyrics/bulkSearch.js) until the user saves the ones ticked.
  const bulk = require('../lyrics/bulkSearch')
  ipcMain.handle('lyricsSearch:get', safely(() => bulk.get(db)))
  ipcMain.handle('lyricsSearch:start', safely((_, kinds, options) => bulk.start(db, kinds, options || {})))
  ipcMain.handle('lyricsSearch:resume', safely(() => bulk.resume(db)))
  ipcMain.handle('lyricsSearch:stop', safely(() => bulk.stop()))
  ipcMain.handle('lyricsSearch:cancel', safely(() => bulk.cancel()))
  ipcMain.handle('lyricsSearch:setChecked', safely((_, ids, checked) => bulk.setChecked(ids, !!checked)))
  ipcMain.handle('lyricsSearch:compare', safely((_, trackId) => bulk.compare(db, trackId)))
  ipcMain.handle('lyricsSearch:edit', safely((_, trackId, text) => bulk.edit(trackId, text)))
  ipcMain.handle('lyricsSearch:preview', safely((_, trackId) => bulk.preview(trackId)))
  ipcMain.handle('lyricsSearch:save', safely(() => bulk.save(db)))
  ipcMain.handle('lyricsSearch:fromSource', safely((_, trackId, providerId) => bulk.fromSource(db, trackId, providerId)))
  ipcMain.handle('lyricsSearch:allSources', safely((_, trackId) => bulk.allSources(db, trackId)))
  ipcMain.handle('lyricsSearch:useSource', safely((_, trackId, providerId) => bulk.useSource(db, trackId, providerId)))
  ipcMain.handle('lyricsSearch:ignoreGet', safely(() => bulk.ignoreGet(db)))
  ipcMain.handle('lyricsSearch:ignoreSearch', safely((_, query) => bulk.ignoreSearch(db, query)))
  ipcMain.handle('lyricsSearch:ignoreAdd', safely((_, items) => bulk.ignoreAdd(db, items)))
  ipcMain.handle('lyricsSearch:ignoreRemove', safely((_, item) => bulk.ignoreRemove(db, item)))
  ipcMain.handle('lyricsSearch:ignoreFromReport', safely((_, trackId) => bulk.ignoreFromReport(db, trackId)))

  // The Lyrics Analysis page: counts what every file in the music folder has
  // in its lyrics tags. The last report is kept; "Refresh" counts again.
  const analysis = require('../lyrics/analysis')
  let analysisJob = null
  let analysisProgress = { running: false }
  ipcMain.handle('lyricsAnalysis:get', () => ({ report: analysis.savedReport(db), progress: analysisProgress }))
  ipcMain.handle('lyricsAnalysis:run', async (event) => {
    if (analysisJob) return { running: true }
    const job = { cancelled: false }
    analysisJob = job
    analysis.clearReport(db)
    const send = (payload) => {
      analysisProgress = payload
      try { if (!event.sender.isDestroyed()) event.sender.send('lyricsAnalysis:progress', payload) } catch {}
    }
    send({ running: true, done: 0, total: 0, folder: '' })
    try {
      const { AUDIO_EXTS } = require('./scanner')
      const result = await analysis.runAnalysis(db, { exts: AUDIO_EXTS, onProgress: send, job })
      send({ running: false, ...(result.ok ? {} : { error: result.error || null }) })
      return result
    } catch (e) {
      send({ running: false, error: e?.message || String(e) })
      return { ok: false, error: e?.message || String(e) }
    } finally { analysisJob = null }
  })
}

module.exports = { registerLyricsHandlers }
