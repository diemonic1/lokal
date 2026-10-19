// The Lyrics Search tab: lyrics looked up for every library song that could
// have better ones, kept apart until the user saves them.
//
// Nothing found here touches a file, the lyrics cache or the database until
// Save, and then only for the songs ticked. Everything found so far lives in
// its own folder (data/lyrics-search), written after every song, so a search
// stopped -- by the Stop button or by the computer going off -- carries on
// from the same song later:
//   state.json        where the search is, the times it took, what's ticked
//   queue.json        the songs to look at, in order (written once)
//   found/<hash>.json one song's lyrics: { trackId, fromKind, toKind, source, text, privateTag }
// The safe cache cleanup (Cache Analysis) removes the folder.
//
// Lyrics only ever go up a level: none -> plain/synced/syllable/instrumental,
// plain -> synced/syllable, synced -> syllable. Syllable, instrumental and
// "can't be found" songs are never looked at.

const fs = require('fs')
const path = require('path')
const { createHash } = require('node:crypto')
const storage = require('../ipc/db')
const repository = require('./repository')
const service = require('./service')
const fileLyrics = require('./fileLyrics')
const embedded = require('./embedded')

const DIR_NAME = 'lyrics-search'
const INSTRUMENTAL_TRACK_TEXT = 'Instrumental track without lyrics'
// Fewer letters than this isn't lyrics (insert_lyrics.py's LENGTH_OF_NORMAL_TEXT).
const MIN_TEXT_LENGTH = 40
// The time left is shown once this many songs have been looked at.
const ETA_MIN_SAMPLES = 10
const RANK = { '': 0, plain: 1, sync: 2, syllable: 3 }

// ---------------------------------------------------------------- files

function dir() {
  const root = storage.getStorageDir()
  return root ? path.join(root, DIR_NAME) : null
}

const foundFile = (trackId) => path.join(dir(), 'found', `${createHash('sha1').update(String(trackId)).digest('hex')}.json`)

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** Written next to it first and moved over, so a power cut never leaves half a file. */
function writeJson(file, value) {
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

function readState() {
  const root = dir()
  if (!root) return null
  const state = readJson(path.join(root, 'state.json'))
  if (!state || state.v !== 1) return null
  return state
}

const saveState = (state) => writeJson(path.join(dir(), 'state.json'), state)
const readQueue = () => readJson(path.join(dir(), 'queue.json')) || []
const readEntry = (trackId) => readJson(foundFile(trackId))

function clearAll() {
  const root = dir()
  if (root) { try { fs.rmSync(root, { recursive: true, force: true }) } catch {} }
}

// ---------------------------------------------------------------- kinds

/** What the file holds now: '' | plain | sync | syllable | instrumental | unfound. */
async function fileKind(filePath) {
  const mm = require('../musicMetadata')
  const meta = await mm.parseFile(filePath, { duration: false, skipCovers: true })
  return fileLyrics.lyricsKind(fileLyrics.lyricsFromMeta(meta), embedded.hasSyllables(embedded.privateTagText(meta)))
}

/** True when lyrics of kind `to` may replace lyrics of kind `from`. */
function isUpgrade(from, to) {
  if (to === 'instrumental') return from === ''
  return from in RANK && to in RANK && RANK[to] > RANK[from]
}

const kindOf = (text, privateTag) => fileLyrics.lyricsKind(text, embedded.hasSyllables(privateTag))

/** The words alone, without time stamps. */
const wordsOf = (text) => String(text || '').replace(/\[[^\]]*\]|<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- the ignore list
//
// Songs and artists never looked up: not a single request goes online for
// them. Kept in the settings table (so the app export carries it) as
// { tracks: [{ id, title, artist }], artists: [{ name }] }. A song also matches
// by its title and artist, so the list still works after an import elsewhere.

const IGNORE_KEY = 'lyrics_search_ignore'
const norm = (value) => String(value || '').trim().toLowerCase()

function readIgnore(db) {
  let value = null
  try { value = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(IGNORE_KEY)?.value || 'null') } catch {}
  const tracks = Array.isArray(value?.tracks) ? value.tracks.filter(t => t && t.id != null) : []
  const artists = Array.isArray(value?.artists) ? value.artists.filter(a => a && String(a.name || '').trim()) : []
  return { tracks, artists }
}

function writeIgnore(db, list) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(IGNORE_KEY, JSON.stringify(list))
}

/** Every artist name a song is credited to (its links, and its artist tags split up). */
function artistNamesOf(db, row) {
  const names = new Set()
  try {
    for (const r of db.prepare('SELECT a.name FROM artist_track_links l JOIN artists a ON a.id = l.artist_id WHERE l.track_id = ?').all(row.id)) names.add(norm(r.name))
  } catch {}
  for (const field of [row.artist, row.album_artist]) {
    if (!field) continue
    names.add(norm(field))
    for (const part of String(field).split(/\s*(?:[,;&/]|\bfeat\.?|\bft\.?|\bx\b)\s*/i)) if (part.trim()) names.add(norm(part))
  }
  return names
}

/** A test for "is this song ignored?", made once per search. */
function ignoreMatcher(db) {
  const { tracks, artists } = readIgnore(db)
  const ids = new Set(tracks.map(t => String(t.id)))
  const key = (title, artist) => `${norm(title)}|${norm(artist)}`
  const titles = new Set(tracks.filter(t => t.title).map(t => key(t.title, t.artist)))
  const names = new Set(artists.map(a => norm(a.name)))
  return (row) => {
    if (!row) return false
    if (ids.has(String(row.id)) || titles.has(key(row.title, row.artist))) return true
    if (!names.size) return false
    for (const name of artistNamesOf(db, row)) if (names.has(name)) return true
    return false
  }
}

/** The list as the tab shows it: songs with their covers, artists with their pictures. */
function ignoreGet(db) {
  const { tracks, artists } = readIgnore(db)
  const rows = tracksByIds(db, tracks.map(t => t.id))
  const artistRow = db.prepare('SELECT id, name, image_path FROM artists WHERE name = ? COLLATE NOCASE')
  return {
    tracks: tracks.map(t => {
      const row = rows.get(t.id)
      return { id: t.id, title: row?.title || t.title || '', artist: row?.artist || t.artist || '', artwork_path: row?.artwork_path || null, artwork_url: row?.artwork_url || null, track: row || null }
    }),
    artists: artists.map(a => {
      const row = artistRow.get(a.name)
      return { name: row?.name || a.name, id: row?.id || null, image_path: row?.image_path || null }
    }),
  }
}

/** The add window's search: library songs and artists matching the text. */
function ignoreSearch(db, query) {
  const q = String(query || '').trim()
  if (!q) return { tracks: [], artists: [] }
  const like = `%${q.replace(/[!%_]/g, c => `!${c}`)}%`
  const tracks = db.prepare(`SELECT id, title, artist, album, artwork_path, artwork_url FROM tracks
    WHERE file_path NOT LIKE 'ghost://%' AND (title LIKE ? ESCAPE '!' OR artist LIKE ? ESCAPE '!')
    ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE LIMIT 50`).all(like, like)
  const artists = db.prepare(`SELECT a.id, a.name, a.image_path FROM artists a
    WHERE a.name LIKE ? ESCAPE '!' AND EXISTS (SELECT 1 FROM artist_track_links l JOIN tracks t ON t.id = l.track_id WHERE l.artist_id = a.id AND t.file_path NOT LIKE 'ghost://%')
    ORDER BY a.name COLLATE NOCASE LIMIT 30`).all(like)
  return { tracks, artists }
}

/** Adds songs (by id) and artists (by name). */
function ignoreAdd(db, { tracks = [], artists = [] } = {}) {
  const list = readIgnore(db)
  const ids = (Array.isArray(tracks) ? tracks : []).map(String)
  const haveTrack = new Set(list.tracks.map(t => String(t.id)))
  const rows = tracksByIds(db, ids)
  for (const id of ids) {
    const row = rows.get(id)
    if (!row || haveTrack.has(id)) continue
    haveTrack.add(id)
    list.tracks.push({ id: row.id, title: row.title || '', artist: row.artist || '' })
  }
  const haveArtist = new Set(list.artists.map(a => norm(a.name)))
  for (const name of Array.isArray(artists) ? artists : []) {
    const clean = String(name || '').trim()
    if (!clean || haveArtist.has(norm(clean))) continue
    haveArtist.add(norm(clean))
    list.artists.push({ name: clean })
  }
  writeIgnore(db, list)
  return { ok: true, ...ignoreGet(db) }
}

/** Removes one song ({ type: 'track', id }) or artist ({ type: 'artist', name }). */
function ignoreRemove(db, { type, id, name } = {}) {
  const list = readIgnore(db)
  if (type === 'track') list.tracks = list.tracks.filter(t => String(t.id) !== String(id))
  else if (type === 'artist') list.artists = list.artists.filter(a => norm(a.name) !== norm(name))
  writeIgnore(db, list)
  return { ok: true, ...ignoreGet(db) }
}

// ---------------------------------------------------------------- the search

let job = null // { cancelled, controller }
let progress = null

function broadcast(channel, payload) {
  try {
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload) } catch {}
    }
  } catch {}
}

function progressOf(state, current = null) {
  if (!state) return { status: 'idle' }
  const status = state.status === 'running' && !job ? 'stopped' : state.status
  const done = state.next
  const total = state.total
  const avgMs = state.timedCount ? state.timedMs / state.timedCount : null
  return {
    status,
    kinds: state.kinds,
    done,
    total,
    found: state.found.length,
    avgMs,
    etaMs: avgMs != null && state.timedCount >= ETA_MIN_SAMPLES ? Math.round(avgMs * Math.max(0, total - done)) : null,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    // Time spent actually searching (without the pauses), the current run included.
    runMs: (state.runMs || 0) + (state.runStartedAt && status === 'running' ? Date.now() - state.runStartedAt : 0),
    current,
  }
}

function send(state, current) {
  progress = progressOf(state, current)
  broadcast('lyricsSearch:progress', progress)
}

/** Looks one song up. The entry to keep, or null. */
async function searchOne(db, trackId, kinds, signal, ignored = () => false) {
  const row = db.prepare('SELECT id, title, artist, album_artist, album, duration, file_path FROM tracks WHERE id = ?').get(trackId)
  // On the ignore list: skipped before anything is asked online.
  if (ignored(row)) return null
  if (!row?.file_path || String(row.file_path).startsWith('ghost://') || !fs.existsSync(row.file_path)) return null
  let fromKind
  try { fromKind = await fileKind(row.file_path) } catch { return null }
  const wanted = fromKind === '' || (fromKind === 'plain' && kinds.plain) || (fromKind === 'sync' && kinds.sync)
  if (!wanted) return null
  const settings = service.readSettings(db)
  const { result } = await repository.lookup(
    { title: row.title, artist: row.artist, album: row.album, duration: Number(row.duration) || 0, filePath: row.file_path, keepCommaArtists: settings.keepCommaArtists },
    // Syllable lyrics are looked for even past a synced answer: they're the level above.
    { ...settings, prioritizeSyllable: true, exclude: ['local', ...service.rejectedSources(db, trackId)], signal },
  )
  if (signal?.aborted || !result) return null
  const written = toWritten(result)
  if (!written || !isUpgrade(fromKind, written.toKind)) return null
  return { trackId, fromKind, ...written, source: result.source || null, edited: false, foundAt: Date.now() }
}

/**
 * A lookup result -> what Save would write: { text, privateTag, toKind }, or
 * null when it isn't lyrics. An instrumental answer is the marker text the
 * library reads as "instrumental".
 */
function toWritten(result) {
  if (!result) return null
  if (result.instrumental) return { text: INSTRUMENTAL_TRACK_TEXT, privateTag: null, toKind: 'instrumental' }
  const { text, privateTag } = fileLyrics.fromResult(result)
  if (!text || wordsOf(text).length < MIN_TEXT_LENGTH) return null
  return { text, privateTag: privateTag || null, toKind: kindOf(text, privateTag) }
}

async function run(db, state) {
  const current = { cancelled: false, controller: null }
  job = current
  state.status = 'running'
  state.runStartedAt = Date.now()
  saveState(state)
  const queue = readQueue()
  const titleOf = db.prepare('SELECT title, artist FROM tracks WHERE id = ?')
  // Read whenever the search (re)starts: songs added while it was stopped are skipped too.
  const ignored = ignoreMatcher(db)
  try {
    while (state.next < queue.length && !current.cancelled) {
      const trackId = queue[state.next]
      const names = titleOf.get(trackId)
      send(state, names ? `${names.artist || ''} — ${names.title || ''}` : null)
      const started = Date.now()
      current.controller = new AbortController()
      let entry = null
      try { entry = await searchOne(db, trackId, state.kinds, current.controller.signal, ignored) } catch { entry = null }
      // Stopped while this song was being looked up: it's looked up again on Continue.
      if (current.cancelled) break
      if (entry) {
        writeJson(foundFile(trackId), entry)
        if (!state.found.includes(trackId)) state.found.push(trackId)
      }
      state.timedMs += Date.now() - started
      state.timedCount++
      state.next++
      saveState(state)
    }
  } catch {
    // Saving failed (the folder went away): nothing to carry on with.
  }
  // Cancelled meanwhile (the folder is gone, maybe a new search started): nothing to save.
  if (job !== current) return
  job = null
  if (!readState()) return
  state.runMs = (state.runMs || 0) + (Date.now() - state.runStartedAt)
  state.runStartedAt = null
  state.status = state.next >= queue.length ? 'done' : 'stopped'
  if (state.status === 'done') state.finishedAt = Date.now()
  saveState(state)
  send(state, null)
}

// ---------------------------------------------------------------- the tab's calls

/** How many library songs there are of each kind the search can look at. */
// "Only tracks added in the last day": tracks.added_at is in seconds.
const DAY_S = 24 * 60 * 60
const addedSince = () => Math.floor(Date.now() / 1000) - DAY_S

/** How many library songs there are of each kind the search can look at; `recent`: of those added in the last day. */
function counts(db) {
  const out = { none: 0, plain: 0, sync: 0, recent: { none: 0, plain: 0, sync: 0 } }
  try {
    const rows = db.prepare(`SELECT IFNULL(lyrics_kind, '') AS kind, COUNT(*) AS n, SUM(CASE WHEN added_at >= ? THEN 1 ELSE 0 END) AS recent
      FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND title IS NOT NULL GROUP BY IFNULL(lyrics_kind, '')`).all(addedSince())
    for (const row of rows) {
      const kind = row.kind === '' ? 'none' : row.kind
      if (!(kind in out.recent)) continue
      out[kind] += row.n
      out.recent[kind] += row.recent || 0
    }
  } catch {}
  return out
}

function tracksByIds(db, ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    try {
      for (const row of db.prepare(`SELECT * FROM tracks WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) out.set(row.id, row)
    } catch {}
  }
  return out
}

/** True when the report can be opened: the search is done, or stopped with what it found so far. */
const reportable = (state) => !!state && !job && (state.status === 'done' || state.status === 'stopped' || state.status === 'running')

/** The tab's whole state: progress, and once the search is done (or stopped), what it found. */
function get(db) {
  const state = readState()
  const base = { progress: progressOf(state, job ? progress?.current : null), counts: counts(db) }
  if (!reportable(state)) return base
  const rows = tracksByIds(db, state.found)
  const checked = new Set(state.checked || [])
  const items = []
  for (const trackId of state.found) {
    const entry = readEntry(trackId)
    const track = rows.get(trackId)
    if (!entry || !track) continue
    items.push({ trackId, fromKind: entry.fromKind, toKind: entry.toKind, source: entry.source, edited: !!entry.edited, checked: checked.has(trackId), track })
  }
  return { ...base, items }
}

/**
 * Starts a new search. kinds: { plain, sync } -- songs without lyrics are
 * always looked at. recent: only the songs added to the library in the last day.
 */
function start(db, kinds = {}, { recent = false } = {}) {
  if (job) return { running: true }
  if (!dir()) return { ok: false, error: 'No data folder' }
  const want = { plain: !!kinds.plain, sync: !!kinds.sync }
  const allowed = ["IFNULL(lyrics_kind, '') = ''"]
  if (want.plain) allowed.push("lyrics_kind = 'plain'")
  if (want.sync) allowed.push("lyrics_kind = 'sync'")
  const since = recent ? ' AND added_at >= ?' : ''
  const ids = db.prepare(`SELECT id FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND title IS NOT NULL AND (${allowed.join(' OR ')})${since}
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_num, title COLLATE NOCASE`).all(...(recent ? [addedSince()] : [])).map(row => row.id)
  if (recent && !ids.length) return { ok: false, error: 'No tracks were added in the last day' }
  clearAll()
  writeJson(path.join(dir(), 'queue.json'), ids)
  const state = { v: 1, status: 'running', kinds: want, recent: !!recent, total: ids.length, next: 0, timedMs: 0, timedCount: 0, found: [], checked: [], startedAt: Date.now(), finishedAt: null, runMs: 0, runStartedAt: null }
  saveState(state)
  run(db, state).catch(() => {})
  return { ok: true, progress: progressOf(state) }
}

/** Carries on a stopped search from the song it stopped at. */
function resume(db) {
  if (job) return { running: true }
  const state = readState()
  if (!state || state.status === 'done') return { ok: false }
  run(db, state).catch(() => {})
  return { ok: true, progress: progressOf({ ...state, status: 'running' }) }
}

/** Stops the search; what was found so far stays. */
function stop() {
  if (!job) return { ok: true }
  job.cancelled = true
  try { job.controller?.abort() } catch {}
  return { ok: true }
}

/** Throws away everything found. The songs are left as they are. */
function cancel() {
  stop()
  job = null
  clearAll()
  tried.clear()
  progress = { status: 'idle' }
  broadcast('lyricsSearch:progress', progress)
  return { ok: true }
}

function setChecked(ids, checked) {
  const state = readState()
  if (!state) return { ok: false }
  const set = new Set(state.checked || [])
  for (const id of Array.isArray(ids) ? ids : []) {
    if (checked && state.found.includes(id)) set.add(id)
    else set.delete(id)
  }
  state.checked = [...set]
  saveState(state)
  return { ok: true, checked: state.checked }
}

/** The text an entry is edited as: enhanced LRC when it has word timings. */
function editableText(entry) {
  return embedded.hasSyllables(entry.privateTag) ? embedded.privateToEnhanced(entry.privateTag) : entry.text
}

/** Compare: the file's lyrics now and the ones found. */
async function compare(db, trackId) {
  const entry = readEntry(trackId)
  if (!entry) return { ok: false, error: 'not-found' }
  let original = ''
  try { original = (await service.readFileLyrics(db, trackId)).text || '' } catch {}
  return {
    ok: true,
    original,
    originalKind: entry.fromKind,
    text: editableText(entry),
    kind: entry.toKind,
    syllable: embedded.hasSyllables(entry.privateTag),
  }
}

/** Compare's Apply: the edited lyrics replace the found ones (still only here). */
function edit(trackId, text) {
  const entry = readEntry(trackId)
  if (!entry) return { ok: false, error: 'not-found' }
  const value = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!value) return { ok: false, error: 'empty' }
  let next
  if (embedded.hasSyllables(entry.privateTag)) {
    const privateTag = embedded.enhancedToPrivate(value, entry.privateTag)
    next = { text: embedded.portableFromPrivate(privateTag) || '', privateTag }
  } else {
    next = { text: value, privateTag: null }
  }
  const toKind = kindOf(next.text, next.privateTag)
  if (!isUpgrade(entry.fromKind, toKind)) return { ok: false, error: 'not-higher', kind: toKind }
  const updated = { ...entry, ...next, toKind, edited: true }
  writeJson(foundFile(trackId), updated)
  return { ok: true, toKind, edited: true }
}

/** Check: the found lyrics the way the lyrics panel shows them. */
function preview(trackId) {
  const entry = readEntry(trackId)
  if (!entry) return null
  const output = entry.privateTag ? embedded.fromPrivateTag(entry.privateTag) : { raw: entry.text }
  const result = repository.toResult('lyrics-search', output) || repository.toResult('lyrics-search', { raw: entry.text })
  return result ? { ...result, source: 'lyrics-search', foundSource: entry.source || null, preview: true } : null
}

// ---------------------------------------------------------------- Check's other sources
//
// While a song is being checked, the side panel's source menu can ask the
// other sources too. Their answers stay in memory here -- never in the lyrics
// cache or the file -- and "Insert into report" makes one the song's entry.

const tried = new Map() // trackId -> { [providerId]: result }
const TRIED_MAX = 20

function remember(trackId, results) {
  const prev = tried.get(trackId) || {}
  tried.delete(trackId)
  tried.set(trackId, { ...prev, ...results })
  while (tried.size > TRIED_MAX) tried.delete(tried.keys().next().value)
}

function queryFor(db, trackId) {
  const row = db.prepare('SELECT id, title, artist, album, duration, file_path FROM tracks WHERE id = ?').get(trackId)
  if (!row) return null
  const settings = service.readSettings(db)
  return {
    settings,
    query: { title: row.title, artist: row.artist, album: row.album, duration: Number(row.duration) || 0, filePath: row.file_path, keepCommaArtists: settings.keepCommaArtists },
  }
}

/** What a source's answer would be in the report: its kind, and whether it may replace the file's lyrics. */
function verdict(entry, result) {
  const written = toWritten(result)
  return { kind: written?.toKind ?? null, usable: !!written && !!entry && isUpgrade(entry.fromKind, written.toKind) }
}

/** One source asked for the song being checked. -> { result, attempts, kind, usable } */
async function fromSource(db, trackId, providerId) {
  const entry = readEntry(trackId)
  const found = queryFor(db, trackId)
  if (!entry || !found || providerId === 'local') return { result: null, attempts: {} }
  const { result, attempts } = await repository.lookup(found.query, { only: providerId, spicyKey: found.settings.spicyKey, spotifyCookie: found.settings.spotifyCookie })
  if (result) remember(trackId, { [providerId]: result })
  return { result: result || null, attempts: attempts || {}, ...verdict(entry, result) }
}

/** "Search all sources again" while checking: every source heard out. -> { attempts } */
async function allSources(db, trackId) {
  const entry = readEntry(trackId)
  const found = queryFor(db, trackId)
  if (!entry || !found) return { attempts: {} }
  const { attempts, results } = await repository.lookup(found.query, {
    ...found.settings, prioritizeSyllable: true, exhaustive: true, exclude: ['local', ...service.rejectedSources(db, trackId)],
  })
  remember(trackId, results || {})
  return { attempts: attempts || {} }
}

/** "Insert into report": a source's answer becomes the song's entry, to be saved later. */
async function useSource(db, trackId, providerId) {
  const entry = readEntry(trackId)
  if (!entry) return { ok: false, error: 'not-found' }
  let result = tried.get(trackId)?.[providerId] || null
  if (!result) result = (await fromSource(db, trackId, providerId)).result
  if (!result) return { ok: false, error: 'no-lyrics' }
  const written = toWritten(result)
  if (!written) return { ok: false, error: 'no-lyrics' }
  if (!isUpgrade(entry.fromKind, written.toKind)) return { ok: false, error: 'not-higher', kind: written.toKind }
  writeJson(foundFile(trackId), { ...entry, ...written, source: providerId, edited: false, foundAt: Date.now() })
  return { ok: true, toKind: written.toKind, source: providerId }
}

/**
 * Save: the ticked songs get their lyrics written in and leave the list.
 * A stopped search can be saved from too ("Go to report"): it carries on
 * from where it stopped afterwards, without the songs saved.
 */
async function save(db) {
  if (job) return { ok: false, error: 'running' }
  const state = readState()
  if (!reportable(state)) return { ok: false }
  const ids = (state.checked || []).filter(id => state.found.includes(id))
  const saved = []
  const failed = []
  for (const trackId of ids) {
    const entry = readEntry(trackId)
    if (!entry) { failed.push({ trackId, error: 'not-found' }); continue }
    try {
      const filePath = db.prepare('SELECT file_path FROM tracks WHERE id = ?').get(trackId)?.file_path
      // The file may have got better lyrics since the search.
      const now = filePath ? await fileKind(filePath) : null
      if (now == null || !isUpgrade(now, entry.toKind)) { failed.push({ trackId, error: 'not-higher' }); continue }
      const done = await service.writeFoundLyrics(db, trackId, entry.text, entry.privateTag)
      if (!done?.ok) { failed.push({ trackId, error: done?.error || '?' }); continue }
      saved.push({ trackId, lyricsKind: done.lyricsKind })
    } catch (e) {
      failed.push({ trackId, error: e?.message || String(e) })
    }
  }
  const gone = new Set([...saved.map(s => s.trackId), ...failed.filter(f => f.error === 'not-higher' || f.error === 'not-found').map(f => f.trackId)])
  for (const trackId of gone) { try { fs.rmSync(foundFile(trackId), { force: true }) } catch {} }
  state.found = state.found.filter(id => !gone.has(id))
  state.checked = (state.checked || []).filter(id => !gone.has(id))
  // The last one saved: the search starts over -- unless it's only stopped, with songs still to look at.
  const reset = !state.found.length && state.status === 'done'
  if (reset) cancel()
  else saveState(state)
  return { ok: true, saved, failed, reset }
}

/**
 * The report's "Add to the ignore list": the song goes on the ignore list and
 * leaves the report, its found lyrics thrown away (the file is not touched).
 */
function ignoreFromReport(db, trackId) {
  if (job) return { ok: false, error: 'running' }
  const state = readState()
  if (!reportable(state) || !state.found.includes(trackId)) return { ok: false, error: 'not-found' }
  ignoreAdd(db, { tracks: [trackId] })
  try { fs.rmSync(foundFile(trackId), { force: true }) } catch {}
  tried.delete(trackId)
  state.found = state.found.filter(id => id !== trackId)
  state.checked = (state.checked || []).filter(id => id !== trackId)
  // The last one gone from a finished search: it starts over, as after Save.
  const reset = !state.found.length && state.status === 'done'
  if (reset) cancel()
  else saveState(state)
  return { ok: true, reset }
}

module.exports = { get, start, resume, stop, cancel, setChecked, compare, edit, preview, save, fromSource, allSources, useSource, ignoreGet, ignoreSearch, ignoreAdd, ignoreRemove, ignoreFromReport, IGNORE_KEY, DIR_NAME, isUpgrade }
