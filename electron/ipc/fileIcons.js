// Settings > File Icons: audio files in Explorer get an icon from the set
// picked (Lokal's own or an AIMP pack, ../iconPacks.js) -- or their cover,
// when the file has one -- once Lokal opens them.
//
// Windows takes a file's icon from the DefaultIcon of the type (ProgID) it
// opens with, so Lokal registers one type an extension, for this user only
// (HKCU, no administrator rights): Lokal.Audio.<ext>, opening with this very
// exe and listed in the extension's "Open with". Windows doesn't let a
// program make itself the default: the user picks Lokal there once, with
// "Always". Picking another set rewrites only the icons.
//
// Covers come from Windows itself: the thumbnail handler on the extension
// (MP3, FLAC, M4A, OGG, Opus, WMA have one) is copied onto Lokal's type, with
// no program badge over it, and, unless switched off, down to 16 px (Details
// and List views too).
//
// Lokal moved (another folder, a new build elsewhere): its types still name
// the old exe. healFileIcons() rewrites them at start-up -- an "Open with"
// entry for a file that's gone is what made Windows hold on to an old Lokal.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { QUICK_EXTS } = require('../audioFormats')
const iconPacks = require('../iconPacks')

const PROG_PREFIX = 'Lokal.Audio'
const CLASSES = 'HKEY_CURRENT_USER\\Software\\Classes'
const THUMBNAIL_HANDLER = '{e357fccd-a995-4576-b01f-234630154e96}'
const KEYS = { pack: 'file_icons_pack', exe: 'file_icons_exe', covers: 'file_icons_covers_everywhere', coverIcons: 'file_icons_cover_icons', format: 'file_icons_format' }
// What Lokal writes for its types, by version: types written by an older
// one are written again at start-up (healFileIcons). 2: the thumbnail
// handler is the extension's own (1 wrote the handler key's id there, so
// no covers showed). 3: covers as icons too (Lokal's icon handler).
const FORMAT = '3'
// Lokal's icon handler (native/icon-handler): each file's cover as its icon,
// so Details and List show covers too; the set's icon (LokalFallbackIcon) where there's none.
const ICON_HANDLER_CLSID = '{7B3E2C91-5A4D-4F6B-9E1A-6C2D8F0B3A57}'

const progId = (ext) => `${PROG_PREFIX}.${ext.slice(1)}`
const regString = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * The .reg text for Lokal's types: exe (the app), icons (ext -> DefaultIcon),
 * thumbnails (ext -> the handler on the extension, if any), coversEverywhere,
 * iconHandler ({ clsid, dll }: covers as icons; null: the set's icons),
 * typeName(ext) -> what Explorer's Type column says.
 */
function registryText({ exe, icons, thumbnails = {}, coversEverywhere = true, iconHandler = null, typeName = (ext) => `${ext.slice(1).toUpperCase()} audio file` }) {
  const lines = ['Windows Registry Editor Version 5.00', '']
  const command = `"${exe}" "%1"`
  const handlerKey = `${CLASSES}\\CLSID\\${ICON_HANDLER_CLSID}`
  lines.push(`[-${handlerKey}]`, '')
  if (iconHandler) {
    lines.push(`[${handlerKey}]`, '@="Lokal cover icons"', '')
    lines.push(`[${handlerKey}\\InprocServer32]`, `@=${regString(iconHandler.dll)}`, '"ThreadingModel"="Apartment"', '')
  }
  for (const ext of QUICK_EXTS) {
    const key = `${CLASSES}\\${progId(ext)}`
    // Gone first: what an earlier set or setting wrote doesn't stay behind.
    lines.push(`[-${key}]`, '', `[${key}]`, `@=${regString(typeName(ext))}`, `"FriendlyTypeName"=${regString(typeName(ext))}`, '"TypeOverlay"=""')
    if (coversEverywhere) lines.push('"ThumbnailCutoff"=dword:00000001')
    // With the icon handler, the icon is the file's own ("%1"): the set's one is its fallback.
    if (iconHandler) lines.push(`"LokalFallbackIcon"=${regString(icons[ext])}`)
    lines.push('', `[${key}\\DefaultIcon]`, `@=${regString(iconHandler ? '%1' : icons[ext])}`, '')
    lines.push(`[${key}\\shell\\open]`, '"FriendlyAppName"="Lokal"', '')
    lines.push(`[${key}\\shell\\open\\command]`, `@=${regString(command)}`, '')
    if (thumbnails[ext]) lines.push(`[${key}\\ShellEx\\${THUMBNAIL_HANDLER}]`, `@=${regString(thumbnails[ext])}`, '')
    if (iconHandler) lines.push(`[${key}\\ShellEx\\IconHandler]`, `@="${ICON_HANDLER_CLSID}"`, '')
    lines.push(`[${CLASSES}\\${ext}\\OpenWithProgids]`, `"${progId(ext)}"=hex(0):`, '')
  }
  return lines.join('\r\n')
}

/** The .reg text that takes Lokal's types out again. */
function removalText() {
  const lines = ['Windows Registry Editor Version 5.00', '', `[-${CLASSES}\\CLSID\\${ICON_HANDLER_CLSID}]`, '']
  for (const ext of QUICK_EXTS) {
    lines.push(`[-${CLASSES}\\${progId(ext)}]`, '', `[${CLASSES}\\${ext}\\OpenWithProgids]`, `"${progId(ext)}"=-`, '')
  }
  return lines.join('\r\n')
}

// ---------------------------------------------------------------- icon handler DLL

// Explorer keeps the DLL it loaded open, so the one in the app's resources
// could never be replaced by a new build: a copy of it is registered, named
// by its contents, and older copies go once nothing holds them.
function shellDir() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'lokal-music', 'shell')
}

/** The icon handler, copied where Explorer may load it from; null when this build has none. */
function iconHandlerCopy() {
  const source = iconPacks.iconHandlerDll()
  let bytes
  try { bytes = fs.readFileSync(source) } catch { return null }
  const hash = require('crypto').createHash('sha1').update(bytes).digest('hex').slice(0, 12)
  const dir = shellDir()
  const target = path.join(dir, `LokalIconHandler-${hash}.dll`)
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes)
  return target
}

/** Older copies of the icon handler, except `keep` (one Explorer still holds stays till next time). */
function removeOldIconHandlers(keep) {
  let names = []
  try { names = fs.readdirSync(shellDir()) } catch { return }
  for (const name of names) {
    const file = path.join(shellDir(), name)
    if (/^LokalIconHandler-[0-9a-f]+\.dll$/i.test(name) && file !== keep) { try { fs.unlinkSync(file) } catch {} }
  }
}

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim())) : resolve(String(stdout))))
})

// UTF-16 with its mark: paths with any letters (a Cyrillic folder) go in whole.
async function importRegistry(text) {
  const file = path.join(os.tmpdir(), `lokal-file-icons-${process.pid}-${Date.now()}.reg`)
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
  try { await run('reg.exe', ['import', file]) } finally { try { fs.unlinkSync(file) } catch {} }
}

// Explorer redraws the icons (and drops the old ones it keeps).
function notifyShell() {
  const script = 'Add-Type -Namespace L -Name S -MemberDefinition \'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, IntPtr a, IntPtr b);\'; [L.S]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)'
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).catch(() => {})
}

// The value in `reg query <key> /ve` output: the line with its type, not the
// key's own path (which has an id too).
function handlerFromQuery(text) {
  const line = String(text).split(/\r?\n/).find(row => /\bREG_(?:EXPAND_)?SZ\b/.test(row))
  return line?.match(/\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}/i)?.[0] || null
}

/** The thumbnail handler each extension has (its covers), where it has one. */
async function thumbnailHandlers() {
  const out = {}
  await Promise.all([...QUICK_EXTS].map(async (ext) => {
    try {
      const text = await run('reg.exe', ['query', `HKCR\\${ext}\\ShellEx\\${THUMBNAIL_HANDLER}`, '/ve'])
      const clsid = handlerFromQuery(text)
      if (clsid) out[ext] = clsid
    } catch {}
  }))
  return out
}

// ---------------------------------------------------------------- settings

function db() { return require('./db').getDB() }
function readSettings() {
  const get = (key) => { try { return db().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null } catch { return null } }
  return { pack: get(KEYS.pack), exe: get(KEYS.exe), coversEverywhere: get(KEYS.covers) !== '0', coverIcons: get(KEYS.coverIcons) !== '0', format: get(KEYS.format), language: get('app_language') }
}
function writeSettings(values) {
  const set = db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const remove = db().prepare('DELETE FROM settings WHERE key = ?')
  for (const [key, value] of Object.entries(values)) value == null ? remove.run(key) : set.run(key, String(value))
}

function canRegister() {
  if (process.platform !== 'win32') return 'Windows only'
  if (!require('electron').app.isPackaged) return 'Only the built app can be registered'
  return null
}

const typeNameIn = (language) => (ext) => (language === 'ru' ? `Аудиофайл ${ext.slice(1).toUpperCase()}` : `${ext.slice(1).toUpperCase()} audio file`)

/** Registers Lokal's types with the set `packId` ('builtin' or a DLL's file name). */
async function applyFileIcons(packId = iconPacks.BUILTIN, { coversEverywhere, coverIcons } = {}) {
  const refused = canRegister()
  if (refused) return { ok: false, error: refused }
  const saved = readSettings()
  const covers = coversEverywhere ?? saved.coversEverywhere
  const asIcons = coverIcons ?? saved.coverIcons
  const pack = packId && packId !== iconPacks.BUILTIN ? iconPacks.listPacks().find(item => item.id === packId) : null
  if (packId && packId !== iconPacks.BUILTIN && !pack) return { ok: false, error: `Icon pack not found: ${packId}` }
  let dll = null
  if (asIcons) { try { dll = iconHandlerCopy() } catch {} }
  try {
    await importRegistry(registryText({
      exe: process.execPath,
      icons: iconPacks.iconLocations(pack),
      thumbnails: await thumbnailHandlers(),
      coversEverywhere: covers,
      iconHandler: dll ? { dll } : null,
      typeName: typeNameIn(saved.language),
    }))
  } catch (e) {
    return { ok: false, error: e.message }
  }
  writeSettings({ [KEYS.pack]: pack ? pack.id : iconPacks.BUILTIN, [KEYS.exe]: process.execPath, [KEYS.covers]: covers ? '1' : '0', [KEYS.coverIcons]: asIcons ? '1' : '0', [KEYS.format]: FORMAT })
  await notifyShell()
  removeOldIconHandlers(dll)
  return { ok: true, pack: pack ? pack.id : iconPacks.BUILTIN, count: QUICK_EXTS.size, coverIcons: !!dll }
}

async function removeFileIcons() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' }
  try { await importRegistry(removalText()) } catch (e) { return { ok: false, error: e.message } }
  writeSettings({ [KEYS.pack]: null, [KEYS.exe]: null, [KEYS.format]: null })
  await notifyShell()
  removeOldIconHandlers(null)
  return { ok: true }
}

/** At start-up: Lokal's types point at another exe (Lokal moved), a pack that's gone, or were written by an older Lokal -> written again. */
async function healFileIcons() {
  if (canRegister()) return null
  const saved = readSettings()
  if (!saved.exe) return null
  const packGone = saved.pack && saved.pack !== iconPacks.BUILTIN && !fs.existsSync(path.join(iconPacks.packsDir(), saved.pack))
  if (saved.exe === process.execPath && !packGone && saved.format === FORMAT) return null
  return applyFileIcons(packGone ? iconPacks.BUILTIN : saved.pack)
}

/** The sets to pick from, with previews, and what's applied. */
function listFileIcons() {
  const saved = readSettings()
  const sets = [
    { id: iconPacks.BUILTIN, name: 'Lokal', author: null, file: null, builtin: true, preview: iconPacks.previewOf(null) },
    ...iconPacks.listPacks().map(pack => ({ id: pack.id, name: pack.name || pack.id, author: pack.author || null, file: pack.id, builtin: false, preview: iconPacks.previewOf(pack) })),
  ]
  return {
    sets,
    applied: saved.exe ? (saved.pack || iconPacks.BUILTIN) : null,
    coversEverywhere: saved.coversEverywhere,
    coverIcons: saved.coverIcons,
    coverIconsAvailable: fs.existsSync(iconPacks.iconHandlerDll()),
    folder: iconPacks.packsDir(),
    canRegister: !canRegister(),
  }
}

function openIconsFolder() {
  const dir = iconPacks.packsDir()
  fs.mkdirSync(dir, { recursive: true })
  return require('electron').shell.openPath(dir)
}

function registerFileIconsHandlers(ipcMain) {
  ipcMain.handle('fileIcons:list', () => listFileIcons())
  ipcMain.handle('fileIcons:apply', (_e, packId, options) => applyFileIcons(packId, options || {}))
  ipcMain.handle('fileIcons:remove', () => removeFileIcons())
  ipcMain.handle('fileIcons:openFolder', () => openIconsFolder())
}

module.exports = { ICON_HANDLER_CLSID, registryText, removalText, handlerFromQuery, applyFileIcons, removeFileIcons, healFileIcons, listFileIcons, registerFileIconsHandlers, progId }
