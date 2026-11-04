// Whether each of this device's plays reached Last.fm and ListenBrainz, for the
// History page's dot. Kept only in this PC's database (another device's plays
// have no dot): a play is known by its key (pid, "<track id>:<started at>"),
// which is also written into its history line.
//
//   lastfm / listenbrainz: NULL - not sent there (off or not connected when the
//   play counted), 0 - waiting to be sent, 1 - sent.
//   lastfm_error / listenbrainz_error: why the last try didn't get it there
//   (cleared once it's sent).

const { getDB } = require('./ipc/db')

const SERVICES = new Set(['lastfm', 'listenbrainz'])

function ensureTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS scrobble_status (pid TEXT PRIMARY KEY, lastfm INTEGER, listenbrainz INTEGER, created_at INTEGER NOT NULL)')
  const columns = db.prepare('PRAGMA table_info(scrobble_status)').all().map(c => c.name)
  for (const service of SERVICES) {
    if (!columns.includes(`${service}_error`)) db.exec(`ALTER TABLE scrobble_status ADD COLUMN ${service}_error TEXT`)
  }
}

let notifyTimer = null

/** The History page reloads (once for a batch of marks). */
function notify() {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    try {
      const { BrowserWindow } = require('electron')
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('history:changed')
    } catch {}
  }, 200)
  notifyTimer.unref?.()
}

/**
 * Sets `service`'s state (0 waiting, 1 sent) for each of `pids`, with `error`:
 * why it's still waiting (a new try without one clears it). A sent play never
 * goes back to waiting, and keeps no error.
 */
function mark(pids, service, state, db = getDB(), error = null) {
  const list = [].concat(pids).filter(pid => typeof pid === 'string' && pid)
  if (!db || !list.length || !SERVICES.has(service)) return
  try {
    ensureTable(db)
    const sent = `MAX(COALESCE(${service}, 0), excluded.${service})`
    const insert = db.prepare(`INSERT INTO scrobble_status (pid, ${service}, ${service}_error, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(pid) DO UPDATE SET ${service}_error = CASE WHEN ${sent} = 1 THEN NULL ELSE excluded.${service}_error END, ${service} = ${sent}`)
    const message = state ? null : (error ? String(error) : null)
    db.transaction(() => { for (const pid of list) insert.run(pid, state ? 1 : 0, message, Date.now()) })()
    notify()
  } catch (e) {
    console.warn('[scrobble] status not saved:', e.message)
  }
}

/** The states of `pids`: { [pid]: { lastfm, listenbrainz, lastfm_error, listenbrainz_error } } (the playing song's row). */
function get(pids, db = getDB()) {
  const list = [].concat(pids).filter(pid => typeof pid === 'string' && pid)
  if (!db || !list.length) return {}
  try {
    ensureTable(db)
    const rows = db.prepare(`SELECT * FROM scrobble_status WHERE pid IN (${list.map(() => '?').join(',')})`).all(...list)
    return Object.fromEntries(rows.map(row => [row.pid, row]))
  } catch { return {} }
}

module.exports = { ensureTable, mark, get }
