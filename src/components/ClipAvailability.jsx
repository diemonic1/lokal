// Edit Track's badge next to the music video link: green "Available" when the
// video is still there, red "Not available" when the site answers 404 (or
// YouTube no longer has it, or the file is gone). Asked a moment after the
// link stops changing (see checkClipLink in electron/online/clipVideo.js).

import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../api'
import { clipVideoLink } from '../clipVideo'
import { useTranslation } from '../i18n'

const CHECK_DELAY_MS = 600

export default function ClipAvailability({ link }) {
  const { t } = useTranslation()
  const [state, setState] = useState(null) // null | 'checking' | { ok, reason }
  const value = clipVideoLink(link)

  useEffect(() => {
    if (!value || !api.isElectron) { setState(null); return }
    let alive = true
    setState('checking')
    const timer = setTimeout(() => {
      api.clipVideoCheck(value).then(result => { if (alive) setState(result || null) })
    }, CHECK_DELAY_MS)
    return () => { alive = false; clearTimeout(timer) }
  }, [value])

  if (!state) return null
  const badge = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-4'
  if (state === 'checking') {
    return <span className={`${badge} bg-white/10 text-muted`}><RefreshCw size={10} className="animate-spin" />{t('Checking…')}</span>
  }
  if (state.ok === true) return <span className={`${badge} bg-emerald-500/20 text-emerald-400`}>{t('Available')}</span>
  if (state.ok === false) {
    return <span className={`${badge} bg-red-500/20 text-red-400`} title={state.reason || ''}>{t('Not available')}</span>
  }
  return <span className={`${badge} bg-white/10 text-muted`} title={state.reason || ''}>{t("Couldn't check")}</span>
}
