// Settings > Integrations > Block All Network Access (setting offline_mode).
// While it's on, nothing Lokal does reaches the internet:
// - Node's own connections in the main process (http, https, fetch, sockets)
//   are refused at net.Socket.connect, which every one of them goes through;
// - Electron's (windows, webviews, net.fetch, the updater) are cancelled by
//   every session's webRequest;
// - the programs Lokal starts (yt-dlp, slskd...) get a proxy that leads
//   nowhere, which those tools honour.
// This computer and the home network stay reachable: the local server, Cast
// devices, slskd's own API.
const net = require('net')

let enabled = false
const DEAD_PROXY = 'http://127.0.0.1:9'
const LOCAL_HOSTS = 'localhost,127.0.0.1,::1'
const PROXY_ENV = {
  HTTP_PROXY: DEAD_PROXY, HTTPS_PROXY: DEAD_PROXY, ALL_PROXY: DEAD_PROXY, NO_PROXY: LOCAL_HOSTS,
  http_proxy: DEAD_PROXY, https_proxy: DEAD_PROXY, all_proxy: DEAD_PROXY, no_proxy: LOCAL_HOSTS,
}
const savedEnv = {}

function isLocalHost(host) {
  let h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (h.startsWith('::ffff:')) h = h.slice(7)
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
  }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || /^fe[89ab]/.test(h) || /^f[cd]/.test(h)
  // A name without a dot is a computer on the home network.
  return !h.includes('.')
}

function blockedError(host) {
  const error = new Error(`Network access is blocked in Settings (${host})`)
  error.code = 'ENETUNREACH'
  return error
}

// Where a connect() call is going: (options), (port, host), (path) or the
// [options, callback] array net.connect hands it.
function connectTarget(args) {
  let first = args[0]
  if (Array.isArray(first)) first = first[0]
  if (first && typeof first === 'object') return first.path ? null : (first.host || first.hostname || 'localhost')
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null
  return typeof args[1] === 'string' ? args[1] : 'localhost'
}

const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  if (enabled) {
    const host = connectTarget(args)
    if (host && !isLocalHost(host)) {
      process.nextTick(() => this.destroy(blockedError(host)))
      return this
    }
  }
  return originalConnect.apply(this, args)
}

const guardedSessions = new WeakSet()
function guardSession(ses) {
  if (!ses || guardedSessions.has(ses)) return
  guardedSessions.add(ses)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    let host = ''
    try { host = new URL(details.url).hostname } catch {}
    callback({ cancel: enabled && !isLocalHost(host) })
  })
}

function applyEnv() {
  for (const [name, value] of Object.entries(PROXY_ENV)) {
    // Windows' environment ignores case: http_proxy is HTTP_PROXY there.
    if (process.platform === 'win32' && name !== name.toUpperCase()) continue
    if (enabled) {
      if (!(name in savedEnv)) savedEnv[name] = process.env[name]
      process.env[name] = value
    } else if (name in savedEnv) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
      delete savedEnv[name]
    }
  }
}

/** Once the app is ready: every session, the ones made later too. */
function install(app) {
  const { session } = require('electron')
  app.on('session-created', guardSession)
  guardSession(session.defaultSession)
}

function setEnabled(value) {
  const next = value === true || value === '1' || value === 1
  if (next === enabled) return
  enabled = next
  applyEnv()
  console.log(`[network] ${enabled ? 'blocked' : 'allowed'}`)
}

const isEnabled = () => enabled

module.exports = { install, setEnabled, isEnabled, isLocalHost }
