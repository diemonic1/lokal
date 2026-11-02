// The quick player: an audio file opened from Explorer (double-click, "Open
// with" Lokal) plays in a small window of its own -- cover, tags, play/pause,
// the files next to it in its folder, a fine seek bar -- without the app.
//
// It runs as a process of its own with a profile of its own (quick-player
// under the app's data), so it never meets the app's single-instance lock: the
// app can be open or not. The first file starts this process; while any of
// its windows is open, every other file opened gets a new window here at once
// (the same file too). The last window closed ends it.
//
// Only what these windows need is loaded: no server, no library database,
// no plugins. The page is quick.html (src/quick/).

const { app, BrowserWindow, ipcMain, shell, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const { findQuickFileArg, isQuickAudioFile } = require('../audioFormats')

// The app's own profile (where ffmpeg, the playback cache and its settings
// are); this process keeps its Chromium profile apart from it.
const appData = app.getPath('userData')
app.setPath('userData', path.join(appData, 'quick-player'))
app.setAppUserModelId('com.lokal.music')

// Settings > About > Hardware Acceleration applies here too.
try {
  const perf = JSON.parse(fs.readFileSync(path.join(appData, 'performance-settings.json'), 'utf8'))
  if (perf?.hardwareAcceleration === false) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-software-rasterizer')
    app.commandLine.appendSwitch('disable-gpu-compositing')
  }
} catch {}

// Some of the app's settings, read from its library database (read-only, on demand).
function appSettings(keys) {
  const out = {}
  try {
    const Database = require('better-sqlite3')
    const db = new Database(path.join(appData, 'data', 'lokal.db'), { readonly: true, fileMustExist: true })
    try {
      const get = db.prepare('SELECT value FROM settings WHERE key = ?')
      for (const key of keys) out[key] = get.get(key)?.value ?? null
    } finally { db.close() }
  } catch {}
  return out
}

// The app's language (Settings > Language), else the system's.
let language = null
function appLanguage() {
  if (language) return language
  const saved = appSettings(['app_language']).app_language
  language = saved || (String(app.getLocale() || '').toLowerCase().startsWith('ru') ? 'ru' : 'en')
  return language
}

function windowBackground() {
  try {
    const value = fs.readFileSync(path.join(appData, 'window-background.txt'), 'utf8').trim()
    if (/^#[0-9a-f]{6}$/i.test(value)) return value
  } catch {}
  return '#0a0a0a'
}

const firstFile = findQuickFileArg(process.argv.slice(1))

if (!app.requestSingleInstanceLock()) {
  // Already running: it got this command line (second-instance) and opens the window.
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const file = findQuickFileArg(argv.slice(1).map(arg => (typeof arg === 'string' && !arg.startsWith('-') ? path.resolve(workingDirectory || '.', arg) : arg)))
    if (file) app.whenReady().then(() => openWindow(file))
  })
  app.on('window-all-closed', () => app.quit())
  app.whenReady().then(() => {
    registerHandlers()
    openWindow(firstFile)
  })
}

// ---------------------------------------------------------------- windows

// Cover and player on the left, the details on the right.
const WIDTH = 780
const HEIGHT = 500
const CASCADE = 28

// A new window: a step down and right of the last one (back to the start
// when that runs off the screen), else in the middle of the screen the mouse is on.
function placement() {
  const last = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().at(-1)
  if (last && !last.isDestroyed() && !last.isMinimized()) {
    const [x, y] = last.getPosition()
    const area = screen.getDisplayMatching(last.getBounds()).workArea
    if (x + CASCADE + WIDTH <= area.x + area.width && y + CASCADE + HEIGHT <= area.y + area.height) return { x: x + CASCADE, y: y + CASCADE }
    return { x: area.x + 40, y: area.y + 40 }
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return { x: Math.round(area.x + (area.width - WIDTH) / 2), y: Math.round(area.y + (area.height - HEIGHT) / 2) }
}

function openWindow(filePath) {
  if (!filePath) return null
  const win = new BrowserWindow({
    ...placement(), width: WIDTH, height: HEIGHT, minWidth: 360, minHeight: 420,
    icon: path.join(__dirname, '../../public/lokal-icon.ico'),
    title: path.basename(filePath),
    frame: false, show: false, backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      // file:// audio from the page (a localhost one in development).
      webSecurity: false,
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  const query = { file: filePath, lang: appLanguage() }
  if (!app.isPackaged) win.loadURL(`http://localhost:5173/quick.html?${new URLSearchParams(query)}`)
  else win.loadFile(path.join(__dirname, '../../dist/quick.html'), { query })
  return win
}

// ---------------------------------------------------------------- file info

const audioPath = (value) => (typeof value === 'string' && isQuickAudioFile(value) && fs.existsSync(value) ? value : null)

let mm = null
const metadata = () => (mm ||= require('../musicMetadata'))

const text = (value) => {
  if (value == null) return null
  const out = (Array.isArray(value) ? value.join('; ') : String(value)).trim()
  return out || null
}

/** The file's tags and what it is (no cover: see cover()). */
async function info(filePath) {
  const file = audioPath(filePath)
  if (!file) return { error: 'missing' }
  let size = null
  try { size = fs.statSync(file).size } catch {}
  const result = { path: file, name: path.basename(file), folder: path.dirname(file), size }
  try {
    const meta = await metadata().parseFile(file, { duration: false, skipCovers: true })
    const c = meta.common || {}
    const f = meta.format || {}
    result.tags = {
      title: text(c.title), artist: text(c.artist), albumartist: text(c.albumartist), album: text(c.album),
      year: c.year || null, date: text(c.date), genre: text(c.genre), label: text(c.label),
      track: c.track?.no || null, trackOf: c.track?.of || null, disk: c.disk?.no || null, diskOf: c.disk?.of || null,
      composer: text(c.composer), comment: text((c.comment || []).map(entry => (typeof entry === 'string' ? entry : entry?.text))),
      bpm: c.bpm || null, key: text(c.key),
    }
    result.format = {
      container: text(f.container), codec: text(f.codec), lossless: !!f.lossless,
      bitrate: Number.isFinite(f.bitrate) ? f.bitrate : null, sampleRate: f.sampleRate || null,
      bitsPerSample: f.bitsPerSample || null, channels: f.numberOfChannels || null,
      duration: Number.isFinite(f.duration) ? f.duration : null,
    }
  } catch (e) {
    result.tagError = e?.message || String(e)
  }
  return result
}

const COVER_NAMES = ['cover', 'folder', 'front', 'albumart', 'album']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const dataUrl = (bytes, mime) => `data:${mime || 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`

/** The picture in the file, else one in its folder (cover.jpg, folder.jpg..., Lokal's folder cover), as a data URL, or null. */
async function cover(filePath) {
  const file = audioPath(filePath)
  if (!file) return null
  try {
    const lib = metadata()
    const meta = await lib.parseFile(file, { duration: false })
    const picture = lib.selectCover ? lib.selectCover(meta.common?.picture) : meta.common?.picture?.[0]
    if (picture?.data?.length) return dataUrl(picture.data, picture.format)
  } catch {}
  const folder = path.dirname(file)
  let names = []
  try { names = fs.readdirSync(folder) } catch { return null }
  const byName = new Map(names.map(name => [name.toLowerCase(), name]))
  for (const base of COVER_NAMES) {
    for (const ext of IMAGE_EXTS) {
      const name = byName.get(base + ext)
      if (!name) continue
      try { return dataUrl(fs.readFileSync(path.join(folder, name)), ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg') } catch {}
    }
  }
  const stored = byName.get('folder_cover.lokal')
  if (stored) {
    try {
      const found = require('../folderCover').readFolderCover(path.join(folder, stored))
      if (found?.bytes) return dataUrl(found.bytes, found.mime)
    } catch {}
  }
  return null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The audio files in the file's folder, in Explorer's order, and where it is among them. */
function siblings(filePath) {
  const file = audioPath(filePath)
  if (!file) return { list: [], index: -1 }
  const folder = path.dirname(file)
  let list = []
  try {
    list = fs.readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile() && isQuickAudioFile(entry.name))
      .map(entry => entry.name)
      .sort(collator.compare)
      .map(name => path.join(folder, name))
  } catch {}
  const key = file.toLowerCase()
  return { list, index: list.findIndex(item => item.toLowerCase() === key) }
}

// ---------------------------------------------------------------- formats Chromium can't play

const run = (command) => { try { require('child_process').execFileSync(command, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); return true } catch { return false } }

// Where the app finds ffmpeg (electron/ipc/tools.js findFfmpeg), read from its profile.
function findFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = [path.join(appData, 'bin', exe)]
  let bundled = path.join(process.resourcesPath || '', 'bin', process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux', exe)
  if (bundled.includes('app.asar') && !bundled.includes('app.asar.unpacked')) bundled = bundled.replace('app.asar', 'app.asar.unpacked')
  candidates.push(bundled)
  const custom = appSettings(['custom_ffmpeg_path']).custom_ffmpeg_path
  if (custom) candidates.push(custom)
  for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return candidate
  return run('ffmpeg') ? 'ffmpeg' : null
}

/** A copy Chromium can play, made once with ffmpeg into the app's playback cache. -> { path } | { error } */
async function playable(filePath) {
  const file = audioPath(filePath)
  if (!file) return { error: 'missing' }
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return { error: 'no-ffmpeg' }
  const { playableCopy } = require('../download/convert')
  // The app trims the cache (its limit is in its settings); not done from here.
  const copy = await playableCopy(file, { ffmpeg, cacheDir: path.join(appData, 'data', 'playback-cache'), force: true, trim: false })
  return copy ? { path: copy } : { error: 'failed' }
}

// ---------------------------------------------------------------- the app

// Pauses the app (when it's running) as a quick window starts playing.
function pauseApp() {
  const socket = net.connect(require('../controlPipe').PIPE_PATH)
  socket.on('error', () => {})
  socket.setTimeout(2000, () => socket.destroy())
  socket.end(`${JSON.stringify({ action: 'pause' })}\n`)
}

// ---------------------------------------------------------------- IPC

function registerHandlers() {
  const sender = (event) => BrowserWindow.fromWebContents(event.sender)
  ipcMain.handle('quick:info', (_e, file) => info(file))
  ipcMain.handle('quick:cover', (_e, file) => cover(file))
  ipcMain.handle('quick:siblings', (_e, file) => siblings(file))
  ipcMain.handle('quick:playable', (_e, file) => playable(file))
  ipcMain.handle('quick:showInFolder', (_e, file) => { if (audioPath(file)) shell.showItemInFolder(file) })
  ipcMain.handle('quick:close', (e) => sender(e)?.close())
  ipcMain.handle('quick:minimize', (e) => sender(e)?.minimize())
  ipcMain.handle('quick:setPinned', (e, pinned) => { const win = sender(e); if (win) win.setAlwaysOnTop(!!pinned); return !!win?.isAlwaysOnTop() })
  // This window started playing: every other one stops, and so does the app.
  ipcMain.handle('quick:playing', (e) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== e.sender && !win.isDestroyed()) win.webContents.send('quick:pause')
    }
    pauseApp()
  })
}
