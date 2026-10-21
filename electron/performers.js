// Settings > Library > Artists > Performers Config: a JSON file at a link
// with whole artist names and separator words, used on top of the built-in
// ones (electron/artistSplit.js) and the user's own. Like the radio
// catalogue, only the parsed data is kept (in settings), never the file.
// With no link of the user's, the app's own file is used; its contents at
// the time of the build are bundled below, so they work before any download.

const { fetchCatalog, isHttpUrl } = require('./radio/catalog')

const DEFAULT_PERFORMERS_URL = 'https://raw.githubusercontent.com/BodaIOT/bodaiot.github.io/refs/heads/main/MusicData/Performers.json'
// What "Open" shows for the default file: its page on GitHub.
const DEFAULT_PERFORMERS_PAGE = 'https://github.com/BodaIOT/bodaiot.github.io/blob/main/MusicData/Performers.json'

const BUNDLED_PERFORMERS = {
  whole_artist_names: [
    'Tyler, The Creator', 'Earth, Wind & Fire', 'Freaks & Geeks', 'Kalwi & Remi',
    'Ibrahim & Ømer', 'Slips & Slurs', 'Chase & Status', 'Rick & Morty',
  ],
  separator_words: [
    ',', 'feat', 'feat.', 'ft', 'ft.', 'featuring', 'remix', 'remix by', 'remixed by', 'prod',
    'prod.', 'prod by', 'prod. by', 'produced by', 'instr', 'instr.', 'instr by', 'instr. by',
    'cover', 'cover by',
  ],
}

const URL_KEY = 'performers_url'
const DATA_KEY = 'performers_remote'
const UPDATED_KEY = 'performers_updated_at'

function readSetting(db, key) {
  try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null } catch { return null }
}

/** Text items, trimmed, without repeats (any case); the first spelling wins. */
function uniqueTexts(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      const text = String(item ?? '').replace(/\s+/g, ' ').trim()
      const key = text.toLowerCase()
      if (!text || seen.has(key)) continue
      seen.add(key)
      out.push(text)
    }
  }
  return out
}

/** The file's text -> { ok: true, data: { whole_artist_names, separator_words } } or { ok: false, errors }. */
function parsePerformers(text) {
  const source = String(text ?? '').replace(/^﻿/, '')
  if (!source.trim()) return { ok: false, errors: [{ path: '', code: 'empty' }] }
  let root
  try { root = JSON.parse(source) } catch (error) {
    const message = String(error?.message || error)
    const pos = message.match(/position (\d+)/i)
    const lc = message.match(/line (\d+) column (\d+)/i)
    let line = lc ? Number(lc[1]) : null
    let column = lc ? Number(lc[2]) : null
    if (!lc && pos) {
      const before = source.slice(0, Number(pos[1])).split('\n')
      line = before.length
      column = before[before.length - 1].length + 1
    }
    let excerpt = ''
    if (line) {
      const lines = source.split('\n')
      const from = Math.max(0, line - 3)
      excerpt = lines.slice(from, line + 1).map((content, i) => `${String(from + i + 1).padStart(4)} | ${content.replace(/\r$/, '')}`).join('\n')
    }
    return { ok: false, errors: [{ path: '', code: 'json-syntax', detail: message, line, column, excerpt }] }
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return { ok: false, errors: [{ path: '', code: 'performers-root' }] }
  const errors = []
  const data = {}
  for (const field of ['whole_artist_names', 'separator_words']) {
    const list = root[field]
    if (list == null) { data[field] = []; continue }
    if (!Array.isArray(list)) { errors.push({ path: field, code: 'not-array' }); continue }
    list.forEach((item, index) => { if (typeof item !== 'string') errors.push({ path: `${field}[${index}]`, code: 'not-string' }) })
    data[field] = uniqueTexts(list.filter(item => typeof item === 'string'))
  }
  if (root.whole_artist_names == null && root.separator_words == null) errors.push({ path: '', code: 'performers-root' })
  return errors.length ? { ok: false, errors } : { ok: true, data }
}

/** The saved state: { url (the user's, '' for the default), defaultUrl, pageUrl, data, updatedAt }. */
function getPerformersConfig(db) {
  let data = null
  try { data = JSON.parse(readSetting(db, DATA_KEY) || 'null') } catch {}
  return {
    url: readSetting(db, URL_KEY) || '',
    defaultUrl: DEFAULT_PERFORMERS_URL,
    pageUrl: DEFAULT_PERFORMERS_PAGE,
    data,
    updatedAt: Number(readSetting(db, UPDATED_KEY)) || 0,
  }
}

/** The names and words from the bundled file and the last one downloaded. */
function configLists(db) {
  const saved = getPerformersConfig(db).data || {}
  return {
    names: uniqueTexts(BUNDLED_PERFORMERS.whole_artist_names, saved.whole_artist_names),
    words: uniqueTexts(BUNDLED_PERFORMERS.separator_words, saved.separator_words),
  }
}

/**
 * Download the file at `url` ('' for the default) and keep its data. Saved
 * only when it parses, so a broken file never replaces what's there.
 */
async function loadPerformers(db, url) {
  const own = String(url || '').trim()
  const target = own || DEFAULT_PERFORMERS_URL
  if (!isHttpUrl(target)) return { ok: false, errors: [{ path: '', code: 'bad-catalog-url' }] }
  const fetched = await fetchCatalog(target)
  if (!fetched.ok) return fetched
  const parsed = parsePerformers(fetched.text)
  if (!parsed.ok) return parsed
  const updatedAt = Date.now()
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  db.transaction(() => {
    stmt.run(URL_KEY, own)
    stmt.run(DATA_KEY, JSON.stringify(parsed.data))
    stmt.run(UPDATED_KEY, String(updatedAt))
  })()
  return { ok: true, ...getPerformersConfig(db) }
}

const configKeys = db => new Set(configLists(db).names.map(name => name.toLowerCase()))

// What Settings shows (the IPC handlers and the web server answer with these).
const state = {
  /**
   * Separator words: "Always on" (the splitter's own and the bundled file's),
   * the downloaded file's that aren't among those or the user's, the user's,
   * and all applied.
   */
  splitWords(db) {
    const artistSplit = require('./artistSplit')
    const key = word => word.toLowerCase().replace(/\.$/, '').trim()
    const words = artistSplit.readSplitWords(db)
    const builtIn = uniqueTexts(artistSplit.DEFAULT_SPLIT_WORDS, BUNDLED_PERFORMERS.separator_words)
    const taken = new Set([...builtIn, ...words].map(key))
    const config = uniqueTexts(getPerformersConfig(db).data?.separator_words).filter(word => !taken.has(key(word)))
    return { builtIn, config, words, applied: artistSplit.applySplitWordsFrom(db) }
  },
  /** The config's link and data, and the whole artist names: the config's, the user's, all. */
  config(db) {
    const artistSplit = require('./artistSplit')
    return {
      ...getPerformersConfig(db),
      configNames: configLists(db).names,
      // The user's own, without the config's (older versions added the
      // first two default names to the user's list on every load).
      userNames: uniqueTexts(artistSplit.readUserKeepComma(db)).filter(name => !configKeys(db).has(name.toLowerCase())),
      allNames: artistSplit.readKeepCommaList(db),
      ...this.splitWords(db),
    }
  },
}

module.exports = { state, DEFAULT_PERFORMERS_URL, DEFAULT_PERFORMERS_PAGE, BUNDLED_PERFORMERS, parsePerformers, getPerformersConfig, configLists, loadPerformers, uniqueTexts }
