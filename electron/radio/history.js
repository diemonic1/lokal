// Online radio's local history: the songs each station played while it was
// listened to -- artist, title and when -- the newest 100 per station, one
// file each in data/radio-history:
//   <hash>.json  { v: 1, stationId, station, entries: [{ artist, title, at }] } (newest first)
// A song is written down the moment the stream names it. Only the full cache
// cleanup (Cache Analysis) removes the folder.

const fs = require('fs')
const path = require('path')
const { createHash } = require('node:crypto')
const { getStorageDir } = require('../ipc/db')

const DIR_NAME = 'radio-history'
const MAX_ENTRIES = 100
// The same song named again this soon (a reconnect, tuning in again): not a new play.
const REPEAT_MS = 20 * 60 * 1000

function dir() {
  const root = getStorageDir()
  return root ? path.join(root, DIR_NAME) : null
}

const fileName = (stationId) => `${createHash('sha1').update(String(stationId)).digest('hex').slice(0, 20)}.json`

function fileFor(stationId) {
  const root = dir()
  return root && stationId != null && String(stationId) !== '' ? path.join(root, fileName(stationId)) : null
}

function readFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!value || value.v !== 1 || !Array.isArray(value.entries)) return null
    return value
  } catch { return null }
}

/** Written next to it first and moved over, so a power cut never leaves half a file. */
function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const data = JSON.stringify(value)
  try {
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  } catch {
    try { fs.rmSync(tmp, { force: true }) } catch {}
    fs.writeFileSync(file, data)
  }
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
const norm = (value) => clean(value).toLowerCase()

/** A song the station is playing now: written down. -> { ok, added } */
function add(stationId, stationTitle, song, at = Date.now()) {
  const file = fileFor(stationId)
  const title = clean(song?.title)
  const artist = clean(song?.artist)
  if (!file || !title) return { ok: false }
  const current = readFile(file) || { v: 1, stationId: String(stationId), station: '', entries: [] }
  const last = current.entries[0]
  if (last && norm(last.title) === norm(title) && norm(last.artist) === norm(artist) && at - (Number(last.at) || 0) < REPEAT_MS) {
    return { ok: true, added: false }
  }
  const next = {
    v: 1,
    stationId: String(stationId),
    station: clean(stationTitle) || current.station || '',
    entries: [{ artist, title, at }, ...current.entries].slice(0, MAX_ENTRIES),
  }
  writeFile(file, next)
  return { ok: true, added: true }
}

/** A station's history: { stationId, station, entries } (entries empty when there's none). */
function get(stationId) {
  const file = fileFor(stationId)
  const value = file ? readFile(file) : null
  return { stationId: String(stationId ?? ''), station: value?.station || '', entries: value?.entries || [] }
}

/** Every station with a history: [{ stationId, station, count, size, path }]. */
function list() {
  const root = dir()
  if (!root) return []
  let names = []
  try { names = fs.readdirSync(root) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(root, name)
    const value = readFile(file)
    if (!value?.entries.length) continue
    let size = 0
    try { size = fs.statSync(file).size } catch {}
    out.push({ stationId: value.stationId, station: value.station, count: value.entries.length, size, path: file })
  }
  return out
}

/** The ids of the stations that have a history (for the stations' menus). */
const stationIds = () => list().map(entry => entry.stationId)

module.exports = { DIR_NAME, MAX_ENTRIES, add, get, list, stationIds, fileName }
