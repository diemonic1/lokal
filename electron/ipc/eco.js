// Eco mode (src/ecoMode.js), the main process's part. While it's on, the
// window is told the person prefers reduced motion (DevTools protocol
// emulation), so the page's animations -- the CSS ones and framer-motion's --
// drop to their still versions. Turning it on also has the window and this
// process let go of memory: garbage collected, and Chromium's in-memory
// caches (decoded images, fonts...) dropped as under memory pressure. The
// files on disk (the caches in Settings > Data) are left as they are.

const v8 = require('v8')
const vm = require('vm')

let gc = null
function mainGc() {
  if (gc === null) {
    try { v8.setFlagsFromString('--expose-gc'); gc = vm.runInNewContext('gc') } catch { gc = false }
  }
  if (gc) try { gc() } catch {}
}

const attachedByUs = new WeakSet()

function debuggerOf(contents) {
  if (!contents || contents.isDestroyed()) return null
  const dbg = contents.debugger
  if (!dbg.isAttached()) {
    try { dbg.attach('1.3'); attachedByUs.add(contents) } catch { return null }
    dbg.once('detach', () => attachedByUs.delete(contents))
  }
  return dbg
}

async function send(contents, method, params = {}) {
  const dbg = debuggerOf(contents)
  if (!dbg) return null
  try { return await dbg.sendCommand(method, params) } catch { return null }
}

async function setReducedMotion(contents, on) {
  if (on) {
    await send(contents, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    return
  }
  if (!contents || contents.isDestroyed() || !contents.debugger.isAttached()) return
  await send(contents, 'Emulation.setEmulatedMedia', { features: [] })
  // Ours only for the emulation: let go of it (DevTools may be using its own).
  if (attachedByUs.has(contents)) try { contents.debugger.detach() } catch {}
}

async function freeMemory(contents) {
  await send(contents, 'HeapProfiler.collectGarbage')
  await send(contents, 'Memory.simulatePressureNotification', { level: 'critical' })
  mainGc()
  if (!contents.debugger.isAttached() || !attachedByUs.has(contents)) return
  // Attached only for this (eco mode isn't on in this window): let go again.
  if (!contents.__lokalEco) try { contents.debugger.detach() } catch {}
}

function registerEcoHandlers(ipcMain) {
  ipcMain.handle('eco:set', async (event, on) => {
    const contents = event.sender
    contents.__lokalEco = !!on
    await setReducedMotion(contents, !!on)
    return { ok: true }
  })
  ipcMain.handle('eco:freeMemory', async (event) => {
    await freeMemory(event.sender)
    return { ok: true }
  })
}

module.exports = { registerEcoHandlers }
