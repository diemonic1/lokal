// Settings > Library > Open Folders In: programs the user listed (a name and
// the program's full path, kept as JSON in the folder_apps setting). Right-
// clicking a folder in the left sidebar offers them; the picked one starts
// with the folder's full path as its only argument.

const path = require('path')
const fs = require('fs')
const { spawn, execFileSync } = require('child_process')
const { shell } = require('electron')
const { getDB } = require('./db')

// Registry values, read fresh: the app's own PATH is the one it started with,
// so a Python installed (or added to PATH) since then wouldn't be in it.
function regValues(key, name) {
  try {
    const out = execFileSync('reg', ['query', key, ...(name ? ['/v', name] : ['/s'])], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    return out.split(/\r?\n/).map(line => line.match(/^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/)).filter(Boolean).map(m => ({ name: m[1], value: m[2].trim() }))
  } catch { return [] }
}

const expandEnv = value => value.replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all)

// Folders to look for an interpreter in: the PATH now (the user's and the
// system's, from the registry), the app's PATH, Windows, and where Python's
// installers put it (its registry entries, the py launcher's folder).
function searchDirs() {
  const dirs = [...String(process.env.PATH || '').split(path.delimiter)]
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
      for (const { value } of regValues(key, 'Path')) dirs.push(...expandEnv(value).split(';'))
    }
    if (process.env.SystemRoot) dirs.push(path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot)
    for (const key of ['HKCU\\Software\\Python', 'HKLM\\Software\\Python']) {
      for (const { name, value } of regValues(key)) {
        if ((name === 'ExecutablePath' || name === 'WindowedExecutablePath') && value) dirs.push(path.dirname(value))
      }
    }
    const local = process.env.LOCALAPPDATA
    if (local) dirs.push(path.join(local, 'Programs', 'Python', 'Launcher'), path.join(local, 'Python', 'bin'))
  }
  return [...new Set(dirs.map(dir => dir.trim()).filter(Boolean))]
}

// The first of `names` found in those folders, or null.
function findOnPath(names) {
  const dirs = searchDirs()
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name)
      try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
    }
  }
  return null
}

// Scripts run in their interpreter: { program, args } with the script first.
const SCRIPT_RUNNERS = {
  '.py': ['py.exe', 'python.exe', 'python3.exe'],
  '.pyw': ['pyw.exe', 'pythonw.exe', 'py.exe', 'python.exe'],
  '.vbs': ['wscript.exe'],
}

/** The folder_apps setting as [{ name, path }], blank rows left out. */
function parseFolderApps(value) {
  let list
  try { list = JSON.parse(value || '[]') } catch { return [] }
  if (!Array.isArray(list)) return []
  return list
    .map(item => ({ name: String(item?.name || '').trim(), path: String(item?.path || '').trim() }))
    .filter(item => item.path)
}

function readSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
}

// The folder, given relative to the music folder, as a full path; null when
// it's outside the music folder or isn't there.
function folderPath(db, relativePath) {
  const root = readSetting(db, 'music_folder')
  if (!root || typeof relativePath !== 'string' || !relativePath) return null
  const rootPath = path.resolve(String(root))
  const target = path.resolve(rootPath, relativePath.slice(0, 4096))
  const relative = path.relative(rootPath, target)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null
  try { return fs.statSync(target).isDirectory() ? target : null } catch { return null }
}

/**
 * Starts the program at `appPath` (one from the setting, nothing else) with
 * the folder's full path: { ok } or { ok: false, error }.
 */
function launchFolderApp(appPath, relativeFolder) {
  const db = getDB()
  const wanted = String(appPath || '').trim()
  const known = parseFolderApps(readSetting(db, 'folder_apps')).some(item => item.path === wanted)
  if (!known) return { ok: false, error: 'This program is not in Settings > Library' }
  const folder = folderPath(db, relativeFolder)
  if (!folder) return { ok: false, error: 'The folder is not available' }

  let program = wanted
  let args = []
  let cwd
  // A shortcut: what it points at, with its own arguments first.
  if (process.platform === 'win32' && path.extname(program).toLowerCase() === '.lnk') {
    try {
      const link = shell.readShortcutLink(program)
      program = link.target
      args = link.args ? link.args.match(/"[^"]*"|\S+/g).map(arg => arg.replace(/^"(.*)"$/, '$1')) : []
      cwd = link.cwd || undefined
    } catch {
      return { ok: false, error: 'Could not read the shortcut' }
    }
  }
  if (!fs.existsSync(program)) return { ok: false, error: 'The program was not found' }

  try {
    const ext = path.extname(program).toLowerCase()
    // Python and VBScript files: their interpreter, the script, then the folder.
    if (SCRIPT_RUNNERS[ext]) {
      const runner = findOnPath(SCRIPT_RUNNERS[ext])
      if (!runner) return { ok: false, error: ext === '.vbs' ? 'Windows Script Host was not found' : 'Python was not found' }
      cwd = cwd || path.dirname(program)
      args = [program, ...args]
      program = runner
    }
    // Batch files run through cmd; everything else is started directly, so
    // the folder's path reaches the program as one argument, as it is.
    const child = process.platform === 'win32' && (ext === '.bat' || ext === '.cmd')
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[program, ...args, folder].map(arg => `"${arg}"`).join(' ')}"`], { cwd: cwd || path.dirname(program), detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      : spawn(program, [...args, folder], { cwd: cwd || path.dirname(program), detached: true, stdio: 'ignore' })
    child.on('error', error => console.warn('[folderApps] Could not start', program, error.message))
    child.unref()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: 'Could not start the program', detail: error.message }
  }
}

function registerFolderAppsHandlers(ipcMain) {
  ipcMain.handle('folderApps:launch', (_, appPath, relativeFolder) => launchFolderApp(appPath, relativeFolder))
}

module.exports = { parseFolderApps, launchFolderApp, registerFolderAppsHandlers }
