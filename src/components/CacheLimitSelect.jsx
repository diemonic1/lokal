// The cache size limit (Settings > Data > Cache, and the Cache Analysis page):
// moving covers, converted copies and cast copies past it go, oldest first
// (electron/cache.js). Changing it brings the caches under it at once.

import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useTranslation } from '../i18n'

const FALLBACK_LIMITS = [512, 1024, 2048, 4096, 8192, 16384]

/** `info`/`onChange` from a page that shows the cache's use too; without them it reads it itself. */
export default function CacheLimitSelect({ info: given, onChange }) {
  const { t } = useTranslation()
  const [own, setOwn] = useState(null)
  const info = given !== undefined ? given : own
  useEffect(() => {
    if (given !== undefined) return
    Promise.resolve(api.cacheUsage?.()).then(next => { if (next && !next.error) setOwn(next) }).catch(() => {})
  }, [given])
  const change = async (mb) => {
    await Promise.resolve(api.saveSettings({ cache_limit_mb: String(mb) })).catch(() => {})
    const next = await Promise.resolve(api.cacheTrim?.()).catch(() => null)
    if (next && !next.error) { setOwn(next); onChange?.(next, mb) }
  }
  return (
    <select aria-label={t('Cache size limit')} value={String(Math.round((info?.limit || 4096 * 1048576) / 1048576))} onChange={e => change(Number(e.target.value))}
      className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50">
      {(info?.limits || FALLBACK_LIMITS).map(mb => <option key={mb} value={String(mb)}>{mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}</option>)}
    </select>
  )
}
