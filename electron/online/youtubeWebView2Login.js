// Windows: YouTube Music sign-in in Microsoft Edge WebView2, through the
// LokalSignIn helper (tools/webview2-signin). Google signs in there like in a
// browser, Windows Hello passkeys included, where it refuses Electron's own
// window ("This browser or app may not be secure"). Lokal reads the YouTube
// Music cookies from the helper and checks them the same way as before
// (youtubeSession.js). A profile that signed in successfully is kept
// (userData/youtube-profile-*): Google rotates the session cookies only while a
// signed-in page is open, so youtubeSession.js reopens it hidden now and then
// to keep the session alive. A profile that did not sign in is deleted.
//
// Same shape as openEmbeddedYouTubeLogin: { session, close, focus, read }.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const handoff = new URL('https://www.youtube.com/signin?action_handle_signin=true&app=desktop')
handoff.searchParams.set('next', 'https://music.youtube.com/')
const LOGIN = new URL('https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube')
LOGIN.searchParams.set('continue', handoff.href)

const START_TIMEOUT_MS = 30000
const READ_TIMEOUT_MS = 15000

/** The helper, where the installer puts it (or a Windows dev build); null elsewhere. */
function helperPath({ platform = process.platform, resourcesPath = process.resourcesPath, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return null
  const candidates = [
    resourcesPath && path.join(resourcesPath, 'webview2-signin', 'LokalSignIn.exe'),
    path.join(__dirname, '..', '..', 'build', 'webview2-signin', 'LokalSignIn.exe'),
  ].filter(Boolean)
  return candidates.find(file => exists(file)) || null
}

/** A sign-in the helper can't do (no WebView2 runtime, didn't start): Lokal's own window instead. */
class HelperUnavailable extends Error {}

/**
 * @param profile  the profile folder; default: a new temporary one
 * @param hidden   no visible window (far off screen, not in the taskbar): refreshing the session in the background
 * @param url      the first page (default: Google's sign-in)
 */
async function openWebView2Login({ electron, signal, profile: profileDir, hidden = false, url = LOGIN.href, onChange = () => {}, onClosed = () => {}, onError = () => {}, onProgress = () => {}, executable = helperPath(), spawnImpl = require('child_process').spawn } = {}) {
  if (!executable) throw new HelperUnavailable('The WebView2 sign-in helper is not installed.')
  if (signal?.aborted) throw new Error('Sign-in cancelled.')
  const runtime = electron || require('electron')
  const profile = profileDir || path.join(runtime.app.getPath('userData'), 'youtube-signin', crypto.randomUUID())
  fs.mkdirSync(profile, { recursive: true })
  const child = spawnImpl(executable, [...(hidden ? ['--hidden'] : []), '--profile', profile, '--url', url], { windowsHide: hidden, stdio: ['pipe', 'pipe', 'ignore'] })
  let keep = hidden // a background refresh never deletes the kept profile
  let closed = false
  let closing = false // Lokal asked it to close: not the person cancelling
  let started = false
  let nextId = 1
  const pending = new Map() // id -> { resolve, reject, timer }
  let buffer = ''

  const removeProfile = () => {
    if (keep) return
    // WebView2 lets go of its files a moment after the window closes.
    const attempt = left => fs.rm(profile, { recursive: true, force: true }, error => { if (error && left > 0) setTimeout(() => attempt(left - 1), 1000) })
    attempt(5)
  }
  const send = command => { try { child.stdin.write(`${JSON.stringify(command)}\n`) } catch {} }

  let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const startTimer = setTimeout(() => readyReject(new HelperUnavailable('The WebView2 sign-in window did not open.')), START_TIMEOUT_MS)

  const finish = () => {
    if (closed) return
    closed = true
    clearTimeout(startTimer)
    signal?.removeEventListener('abort', abort)
    runtime.app.removeListener('before-quit', abort)
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Sign-in window closed.')) }
    pending.clear()
    removeProfile()
  }
  const close = async ({ preserveSession = false } = {}) => {
    if (closed) return
    keep = preserveSession
    closing = true
    send({ cmd: 'close' })
    const exited = new Promise(resolve => child.once('exit', resolve))
    const timer = setTimeout(() => { try { child.kill() } catch {} }, 3000)
    await exited.catch(() => {})
    clearTimeout(timer)
    finish()
  }
  const abort = () => { close().catch(() => {}) }

  const handle = message => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'ready') { started = true; clearTimeout(startTimer); readyResolve(); if (!hidden) onProgress({ message: 'Complete Google sign-in. This window closes once Lokal confirms your YouTube Music connection.' }) }
    else if (message.type === 'changed') { if (!closed) onChange() }
    else if (message.type === 'snapshot') {
      const waiter = pending.get(message.id)
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message) }
    } else if (message.type === 'error') {
      const error = message.code === 'no-runtime' || !started ? new HelperUnavailable(message.message || 'The WebView2 sign-in window could not open.') : new Error(message.message || 'The sign-in window failed.')
      if (!started) readyReject(error)
      else if (!closed) onError(error)
    }
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try { handle(JSON.parse(line)) } catch {}
    }
  })
  child.on('error', error => { if (!started) readyReject(new HelperUnavailable(`Could not start the WebView2 sign-in window (${error.message}).`)); else if (!closed) onError(error) })
  child.on('exit', () => {
    const wasClosed = closed || closing
    finish()
    if (!started) readyReject(new HelperUnavailable('The WebView2 sign-in window closed before it opened.'))
    else if (!wasClosed) onClosed()
  })
  signal?.addEventListener('abort', abort, { once: true })
  runtime.app.once('before-quit', abort)

  try { await ready } catch (error) { await close(); throw error }

  return {
    // Not Lokal's own session: each read carries the cookies (youtubeSession.js copies them in).
    session: null,
    close: options => close(options),
    profile,
    focus: () => send({ cmd: 'focus' }),
    read() {
      if (closed) return Promise.reject(new Error('Sign-in window closed.'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('The sign-in window did not answer.')) }, READ_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        send({ cmd: 'read', id })
      }).then(snapshot => ({
        url: String(snapshot.url || 'about:blank'),
        context: snapshot.context && typeof snapshot.context === 'object' ? snapshot.context : {},
        userAgent: String(snapshot.userAgent || ''),
        cookies: (Array.isArray(snapshot.cookies) ? snapshot.cookies : []).filter(cookie => cookie && typeof cookie.name === 'string' && typeof cookie.domain === 'string'),
      }))
    },
  }
}

module.exports = { openWebView2Login, helperPath, HelperUnavailable, LOGIN }
