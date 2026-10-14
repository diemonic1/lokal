// "Refresh" for online album and artist data, which is kept once loaded
// (see cachedOnline in onlineBrowse.js): says when it was loaded, spins
// while loading again.

import React from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '../i18n'

function age(at, t) {
  const minutes = Math.round((Date.now() - at) / 60000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n} min ago', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{n} h ago', { n: hours })
  const days = Math.round(hours / 24)
  return t('{n} day ago|{n} days ago', { n: days })
}

export default function RefreshButton({ onClick, loading = false, loadedAt = 0, label, className = '' }) {
  const { t } = useTranslation()
  label = label ?? t('Refresh')
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={loading ? t('Loading…') : loadedAt ? t('Loaded {age}. Look it up again online.', { age: age(loadedAt, t) }) : t('Look it up again online')}
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white/80 transition-colors hover:border-accent/40 hover:text-white disabled:opacity-60 ${className}`}
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      {label}
    </button>
  )
}
