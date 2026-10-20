// Web mode: the same online radio catalogue and now-playing lookups as the
// desktop app (electron/ipc/radio.js).
const router = require('express').Router()
const { getCatalog, loadAndSave } = require('../../electron/ipc/radio')
const { nowPlaying } = require('../../electron/radio/nowPlaying')
const history = require('../../electron/radio/history')

router.get('/catalog', (req, res) => res.json(getCatalog()))

router.post('/catalog', async (req, res) => {
  res.json(await loadAndSave(req.body?.url).catch(error => ({ ok: false, errors: [{ path: '', code: 'network', detail: String(error?.message || error) }] })))
})

router.post('/now-playing', async (req, res) => {
  res.json((await nowPlaying(req.body?.api).catch(() => null)) || null)
})

// The stations' local history (electron/radio/history.js).
router.get('/history', (req, res) => res.json(history.stationIds()))
router.get('/history/:stationId', (req, res) => res.json(history.get(req.params.stationId)))
router.post('/history', (req, res) => res.json(history.add(req.body?.stationId, req.body?.station, req.body?.song)))

module.exports = router
