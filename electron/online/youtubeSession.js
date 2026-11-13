const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const youtube = require('./youtube')
const { openYouTubeBrowser, accountContext, youtubeCookie } = require('./youtubeBrowser')
const { openEmbeddedYouTubeLogin } = require('./youtubeEmbeddedLogin')
const { openWebView2Login, helperPath, HelperUnavailable } = require('./youtubeWebView2Login')

/**
 * The sign-in window: on Windows, Microsoft Edge WebView2 (Google accepts it,
 * Windows Hello passkeys work), else, or when it can't open, Lokal's own.
 */
async function openSignInWindow(options) {
  if (helperPath()) {
    try { return await openWebView2Login(options) } catch (error) { if (!(error instanceof HelperUnavailable)) throw error }
  }
  return openEmbeddedYouTubeLogin(options)
}

const PARTITION = 'persist:lokal-ytmusic'
const MUSIC = 'https://music.youtube.com'
const PROFILE_PREFIX = 'youtube-profile-'
// Google rotates the session cookies only while a signed-in page is open. A copy
// taken once at sign-in goes stale, so the WebView2 profile of the sign-in is
// kept, and reopened hidden now and then (like the Video Player app does):
// that is where the rotation happens, and the fresh cookies are copied back.
const KEEP_ALIVE_EVERY_MS = 20 * 60 * 1000
const KEEP_ALIVE_FIRST_MS = 8 * 1000
const SETTLE_MS = 8000

// Cookies that name the signed-in account. Google rotates the others (SIDCC,
// __Secure-*PSIDCC, __Secure-*PSIDTS, YSC…) on ordinary responses, including
// the ones to Lokal's own verification requests.
const IDENTITY_COOKIES = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'LOGIN_INFO'])

/** Which account (and channel) a sign-in snapshot is for, ignoring rotating cookies. */
function accountIdentity(snapshot = {}) {
  let music = false
  try { music = new URL(snapshot.url).origin === MUSIC } catch {}
  const context = accountContext(snapshot.context)
  const cookies = (snapshot.cookies || []).filter(cookie => youtubeCookie(cookie) && IDENTITY_COOKIES.has(cookie.name)).map(cookie => `${cookie.name}=${cookie.value}`).sort()
  return JSON.stringify([music, context['x-goog-authuser'] || '0', context['x-goog-pageid'] || '', cookies])
}

/** Preserve cookie scope/lifetime while transferring only this app's Music session. */
function electronCookie(cookie) {
  const host = cookie.domain.replace(/^\./, '')
  return {
    url: `https://${host}${cookie.path || '/'}`, name: cookie.name, value: cookie.value,
    ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}),
    path: cookie.path || '/', secure: !!cookie.secure, httpOnly: !!cookie.httpOnly,
    sameSite: ({ None: 'no_restriction', Lax: 'lax', Strict: 'strict' })[cookie.sameSite] || 'unspecified',
    ...(!cookie.session && cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
  }
}

/** Activate an isolated login snapshot only after authenticated Music verification. */
function createYouTubeSession({ electron, getSettings, saveSettings, provider = youtube, syncCookies = header => require('../ipc/ytCookies').syncSessionCookies(header), openBrowser, openHidden, settleMs = SETTLE_MS } = {}) {
  const runtime = () => electron || require('electron')
  const profilePath = name => path.join(runtime().app?.getPath?.('userData') || require('os').tmpdir(), name)
  const removeProfile = name => {
    if (!/^youtube-profile-[\da-f-]+$/.test(name || '')) return
    const attempt = left => fs.rm(profilePath(name), { recursive: true, force: true }, error => { if (error && left > 0) setTimeout(() => attempt(left - 1), 1000) })
    attempt(5)
  }
  let refreshing = null
  let refreshController = null
  let keepAliveTimer
  let ses, loginJob
  let revision = 0
  let requestContext = {}
  const watchCookies = session => session.cookies.on('changed', () => {
    const token = revision
    if (session === ses && getSettings().yt_account_session === '1') cookieHeader(session).then(header => {
      if (token === revision && session === ses && getSettings().yt_account_session === '1') syncCookies(header)
    }).catch(() => {})
  })
  const getSession = () => {
    if (ses) return ses
    const saved = getSettings()
    const partition = /^persist:lokal-ytmusic(?:-[\da-f-]+)?$/.test(saved.yt_account_partition || '') ? saved.yt_account_partition : PARTITION
    ses = runtime().session.fromPartition(partition)
    // External-browser and legacy profiles keep their saved identity; native
    // embedded profiles use Electron's current default, including after updates.
    if (saved.yt_account_user_agent) ses.setUserAgent(saved.yt_account_user_agent)
    try { requestContext = accountContext(JSON.parse(saved.yt_account_context || '{}')) } catch {}
    watchCookies(ses)
    return ses
  }
  const cookieHeader = async session => (await session.cookies.get({ url: MUSIC })).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  const sessionCredentials = async (session, context, token) => {
    const headersFor = cookies => JSON.stringify({ ...context, 'user-agent': session.getUserAgent(), Cookie: cookies })
    const cookies = await cookieHeader(session)
    if (token !== revision) throw new Error('YouTube Music session changed. Try again.')
    if (session === ses && getSettings().yt_account_session === '1') syncCookies(cookies)
    return {
      cookies: headersFor(cookies),
      fetchImpl: async (url, init = {}) => {
        if (new URL(url).origin !== MUSIC) throw new Error('Unexpected YouTube Music request origin.')
        const fresh = headersFor(await cookieHeader(session))
        if (token !== revision) throw new Error('YouTube Music session changed. Try again.')
        const headers = { ...init.headers, ...provider.accountHeaders(fresh, {
          SESSION_INDEX: init.headers?.['X-Goog-AuthUser'], DELEGATED_SESSION_ID: init.headers?.['X-Goog-PageId'],
          VISITOR_DATA: init.headers?.['X-Goog-Visitor-Id'], INNERTUBE_CLIENT_VERSION: init.headers?.['X-YouTube-Client-Version'],
        }), 'User-Agent': session.getUserAgent() }
        delete headers.Cookie
        let body = init.body
        if (typeof body === 'string') {
          const data = JSON.parse(body)
          if (data.context?.client) {
            data.context.client.clientVersion = headers['X-YouTube-Client-Version']
            if (headers['X-Goog-Visitor-Id']) data.context.client.visitorData = headers['X-Goog-Visitor-Id']
            if (headers['X-Goog-PageId']) data.context.user = { ...data.context.user, onBehalfOfUser: headers['X-Goog-PageId'] }
          }
          body = JSON.stringify(data)
        }
        return session.fetch(url, { ...init, body, headers, credentials: 'include' })
      },
    }
  }
  const credentials = async () => {
    if (getSettings().yt_account_session !== '1') return { cookies: '', fetchImpl: fetch }
    const session = getSession()
    return sessionCredentials(session, requestContext, revision)
  }
  const finish = (job, result) => {
    if (job.finished) return
    job.finished = true
    clearInterval(job.verifyTimer)
    revision++
    if (loginJob === job) loginJob = null
    // Close before aborting so a successful native login keeps its full profile.
    Promise.resolve(job.browser?.close({ preserveSession: !!result.authenticated })).catch(() => {})
    job.controller.abort()
    if (!result.authenticated) job.session.clearStorageData().catch(() => {})
    job.resolve(result)
  }
  const signIn = ({ mode = 'embedded', onProgress = () => {}, verifyPollMs = 1500 } = {}) => {
    if (!['embedded', 'browser'].includes(mode)) return Promise.resolve({ authenticated: false, error: 'Unknown YouTube Music sign-in mode.' })
    if (loginJob) { loginJob.browser?.focus(); return loginJob.promise }
    getSession()
    const partition = `${PARTITION}-${crypto.randomUUID()}`
    const profileName = `${PROFILE_PREFIX}${crypto.randomUUID()}`
    const job = { token: ++revision, partition, session: runtime().session.fromPartition(partition), controller: new AbortController(), finished: false, checking: false, dirty: true, browser: null }
    job.promise = new Promise(resolve => { job.resolve = resolve })
    loginJob = job
    const current = () => !job.finished && job.token === revision && loginJob === job
    // Changes during a check (cookie rotation from the check's own requests,
    // page requests, navigations) only matter when the account itself changed:
    // retrying on every change never finishes, since each retry rotates cookies.
    // Native windows share the candidate jar, so that is where the account
    // lives; an external browser's snapshot carries its own cookies.
    const identityOf = async snapshot => accountIdentity(job.browser.session === job.session
      ? { ...snapshot, cookies: await job.session.cookies.get({ url: MUSIC }) }
      : snapshot)
    const sameAccount = async identity => {
      if (!job.dirty) return true
      const now = await job.browser.read()
      if (!current()) return false
      if (await identityOf(now) !== await identity) return false
      job.dirty = false
      return true
    }
    const check = async () => {
      job.dirty = true
      if (!job.browser || job.checking || !current()) return
      job.checking = true
      try {
        while (job.dirty && current()) {
          job.dirty = false
          const snapshot = await job.browser.read()
          if (!current()) return
          // A snapshot that went stale while reading is read again (no requests yet).
          if (job.dirty) continue
          if (new URL(snapshot.url).origin !== MUSIC) return
          // Read before the check's own requests can change anything; awaited
          // only if something changes meanwhile.
          const identity = identityOf(snapshot)
          identity.catch(() => {})
          const context = accountContext(snapshot.context)
          const native = job.browser.session === job.session
          if (!native) {
            job.session.setUserAgent(snapshot.userAgent)
            await job.session.clearStorageData({ storages: ['cookies'] })
            for (const cookie of snapshot.cookies.filter(youtubeCookie)) {
              if (!current()) return
              await job.session.cookies.set(electronCookie(cookie))
            }
          }
          if (!current()) return
          const auth = await sessionCredentials(job.session, context, job.token)
          if (!provider.accountHeaders(auth.cookies)) return
          provider.clearAccountCache()
          const result = await provider.fetchAccountData({ ...auth, force: true })
          if (!current()) return
          if (!(await sameAccount(identity))) { if (current()) continue; return }
          if (!result.authenticated || result.error) { onProgress({ message: result.error || 'YouTube Music has not confirmed account access yet.' }); return }
          await job.session.cookies.flushStore()
          job.session.flushStorageData?.()
          const freshCookies = await cookieHeader(job.session)
          if (!current()) return
          if (!(await sameAccount(identity))) { if (current()) continue; return }
          // The old jar and selected account remain intact until this atomic switch.
          const keptProfile = job.browser.profile ? profileName : ''
          const previousProfile = getSettings().yt_account_profile
          saveSettings({ yt_account_profile: keptProfile, yt_account_partition: partition, yt_account_user_agent: native ? '' : job.session.getUserAgent(), yt_account_context: JSON.stringify(context), yt_account_session: '1', yt_account_revision: String(Date.now()), yt_cookies: '1', yt_cookie_browser: 'session' })
          const previous = ses
          ses = job.session
          requestContext = context
          watchCookies(ses)
          syncCookies(freshCookies)
          finish(job, result)
          previous.clearStorageData().catch(() => {})
          lastRefresh = Date.now()
          if (previousProfile && previousProfile !== keptProfile) removeProfile(previousProfile)
        }
      } finally { job.checking = false }
    }
    const changed = () => { check().catch(error => { if (current()) onProgress({ message: error.message || 'Could not verify YouTube Music account access.' }) }) }
    ;(async () => {
      try {
        const opener = openBrowser || (mode === 'browser' ? openYouTubeBrowser : openSignInWindow)
        job.browser = await opener({ electron: runtime(), session: job.session, signal: job.controller.signal, profile: profilePath(profileName), onChange: changed, onClosed: () => finish(job, { authenticated: false, cancelled: true }), onError: error => finish(job, { authenticated: false, error: error.message || 'The sign-in window failed.' }), onProgress })
        if (!current()) { await job.browser.close(); return }
        job.verifyTimer = setInterval(() => {
          if (!current() || job.checking) return
          changed()
        }, Math.max(25, Number(verifyPollMs) || 1500))
        await check()
      } catch (error) { finish(job, { authenticated: false, ...(job.controller.signal.aborted ? { cancelled: true } : { error: error.message || 'Could not open the sign-in browser.' }) }) }
    })()
    return job.promise
  }
  let lastRefresh = 0
  const hasIdentity = cookies => cookies.some(cookie => youtubeCookie(cookie) && IDENTITY_COOKIES.has(cookie.name) && cookie.value)
  const openProfile = options => (openHidden || openWebView2Login)({ electron: runtime(), ...options })

  /**
   * Reopens the kept WebView2 profile hidden, lets YouTube Music rotate the
   * cookies there, and copies them into Lokal's session (and cookies.txt).
   * → true when the session was refreshed, false when left as it is.
   */
  const refreshFromProfile = async () => {
    const name = getSettings().yt_account_profile
    if (getSettings().yt_account_session !== '1' || !name || !/^youtube-profile-[\da-f-]+$/.test(name)) return false
    if (loginJob || !fs.existsSync(profilePath(name)) || (!openHidden && !helperPath())) return false
    const target = getSession()
    const token = revision
    refreshController = new AbortController()
    let win
    try {
      win = await openProfile({ profile: profilePath(name), hidden: true, url: `${MUSIC}/`, signal: refreshController.signal, onChange: () => {}, onClosed: () => {}, onError: () => {} })
      if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs))
      const snapshot = await win.read()
      if (token !== revision || target !== ses || loginJob) return false
      const cookies = snapshot.cookies.filter(youtubeCookie)
      if (!hasIdentity(cookies)) return false
      const wanted = new Set(cookies.map(cookie => `${cookie.domain}|${cookie.path}|${cookie.name}`))
      for (const old of await target.cookies.get({ url: MUSIC })) {
        if (wanted.has(`${old.domain}|${old.path}|${old.name}`)) continue
        await target.cookies.remove(`https://${String(old.domain || '').replace(/^\./, '')}${old.path || '/'}`, old.name).catch(() => {})
      }
      for (const cookie of cookies) await target.cookies.set(electronCookie(cookie))
      const context = accountContext(snapshot.context)
      if (Object.keys(context).length) { requestContext = context; saveSettings({ yt_account_context: JSON.stringify(context) }) }
      await target.cookies.flushStore()
      provider.clearAccountCache()
      syncCookies(await cookieHeader(target))
      lastRefresh = Date.now()
      return true
    } catch (error) {
      // No WebView2, the app is closing: the cookies we have stay.
      return false
    } finally {
      try { await win?.close({ preserveSession: true }) } catch {}
      refreshController = null
    }
  }
  const refresh = () => {
    if (!refreshing) refreshing = refreshFromProfile().catch(() => false).finally(() => { refreshing = null })
    return refreshing
  }
  /** Refreshes the session shortly after launch and then every 20 minutes. */
  const startKeepAlive = () => {
    if (keepAliveTimer) return
    const tick = () => { refresh() }
    keepAliveTimer = setInterval(tick, KEEP_ALIVE_EVERY_MS)
    keepAliveTimer.unref?.()
    setTimeout(tick, KEEP_ALIVE_FIRST_MS).unref?.()
  }

  const cancelSignIn = () => { if (loginJob) finish(loginJob, { authenticated: false, cancelled: true }); return { ok: true } }
  const disconnect = async () => {
    revision++
    cancelSignIn()
    refreshController?.abort()
    if (refreshing) await refreshing.catch(() => {})
    await getSession().clearStorageData()
    removeProfile(getSettings().yt_account_profile)
    saveSettings({ yt_account_profile: '', yt_account_session: '0', yt_account_context: '', yt_account_partition: '', yt_account_user_agent: '', yt_account_revision: String(Date.now()), yt_cookies: '0', yt_cookie_browser: 'session', yt_cookie_header: '' })
    syncCookies('')
    requestContext = {}
    provider.clearAccountCache()
    return { ok: true }
  }
  return { credentials, signIn, cancelSignIn, disconnect, refresh, startKeepAlive }
}

module.exports = { createYouTubeSession, electronCookie, accountIdentity, PARTITION }
