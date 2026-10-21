// Settings > Library > Artists > Performers Config: the link to a JSON file
// with whole artist names and separator words (electron/performers.js). With
// no link of the user's, the app's own file is used (shown as the
// placeholder). "Update" downloads it again; a file that can't be used opens
// a window saying why, as the radio catalogue does.

import React, { useEffect, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { CatalogErrorModal } from './RadioCatalogSetup'
import { useTranslation } from '../i18n'

/** Tells every list on screen about a new config state (names and words to split with). */
export function announcePerformersConfig(state) {
  if (!state) return
  try {
    window.dispatchEvent(new CustomEvent('lokal:performers-config-updated', { detail: state }))
    if (Array.isArray(state.allNames)) window.dispatchEvent(new CustomEvent('lokal:comma-artists-updated', { detail: state.allNames }))
    if (Array.isArray(state.applied)) window.dispatchEvent(new CustomEvent('lokal:split-words-updated', { detail: state.applied }))
  } catch {}
}

export default function PerformersConfigSetup() {
  const { t } = useTranslation()
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState(null)

  useEffect(() => {
    Promise.resolve(api.getPerformersConfig?.()).then(state => {
      if (!state) return
      setConfig(state)
      setDraft(state.url || '')
    }).catch(() => {})
  }, [])

  const defaultUrl = config?.defaultUrl || ''
  const trimmed = draft.trim()
  const update = async () => {
    setLoading(true)
    try {
      const result = await api.loadPerformersConfig(trimmed)
      if (!result?.ok) { setErrors(result?.errors?.length ? result.errors : [{ path: '', code: 'network' }]); return }
      setConfig(result)
      setDraft(result.url || '')
      announcePerformersConfig(result)
    } catch (error) {
      setErrors([{ path: '', code: 'network', detail: String(error?.message || error) }])
    } finally {
      setLoading(false)
    }
  }
  // The user's own link as it is; the app's own file on its GitHub page.
  const open = () => api.openExternal(trimmed || config?.pageUrl || defaultUrl)

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="url" value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter' && !loading) update() }}
          placeholder={defaultUrl} aria-label={t('Performers config link')} title={trimmed || defaultUrl}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-accent focus:outline-none" />
        <button type="button" onClick={open} disabled={!trimmed && !defaultUrl} title={trimmed || config?.pageUrl || defaultUrl}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
          <ExternalLink size={14} /> {t('Open')}
        </button>
        <button type="button" disabled={loading} onClick={update} title={t('Download the config again')}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('Update')}
        </button>
      </div>
      {config?.updatedAt > 0 && (
        <p className="text-xs text-muted">
          {t('Loaded: {names} names, {words} words', { names: config.data?.whole_artist_names?.length || 0, words: config.data?.separator_words?.length || 0 })}
          {` · ${new Date(config.updatedAt).toLocaleString()}`}
        </p>
      )}
      <CatalogErrorModal errors={errors} onClose={() => setErrors(null)}
        title={t('The performers config couldn\'t be loaded')}
        note={t('Nothing was changed: the names and words already loaded stay as they were. Fix the file or the link and try again.')} />
    </div>
  )
}
