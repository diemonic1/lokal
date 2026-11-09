// Lokal keeps its data next to its exe: <exe folder>\AppData holds what used to
// be in %APPDATA%\lokal-music (the library database, covers, caches, settings,
// sign-ins, logs). Same layout inside, so the old folder's contents copied into
// AppData are picked up as they are on the next launch.
//
// Only for the built app (in development the exe is Electron's own, in
// node_modules). When the exe's folder can't be written to (installed under
// Program Files...), the data stays in the system's folder as before.
// Called first thing, before anything asks for a path: the single-instance
// lock, the quick player's folder and electron-log all follow userData.

const fs = require('fs')
const path = require('path')

let portableDir = null

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.write-test-${process.pid}`)
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
    return true
  } catch { return false }
}

function usePortableData(app) {
  if (portableDir) return portableDir
  if (!app?.isPackaged) return null
  const dir = path.join(path.dirname(process.execPath), 'AppData')
  if (!canWrite(dir)) return null
  app.setPath('userData', dir)
  try { app.setPath('sessionData', dir) } catch {}
  try { app.setAppLogsPath(path.join(dir, 'logs')) } catch {}
  portableDir = dir
  return dir
}

/** The folder the app itself is in (the exe and its files), or null in development. */
function appInstallDir(app) {
  return app?.isPackaged ? path.dirname(process.execPath) : null
}

module.exports = { usePortableData, appInstallDir }
