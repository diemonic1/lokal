import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/player'
import { api } from '../api'
import { latestPeriod, listenerTimeZone, nextPeriodBoundary, recapOpened, recapTree } from '../recapPeriods'
import { getLastHomePath } from '../recommendationSession'
import { TABS, rememberTab, tabForPath } from '../libraryNav'
import { useTranslation } from '../i18n'

/** Whether there's a finished recap period that hasn't been opened yet. */
function useRecapBadge(userId) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    let alive = true
    const sync = async () => {
      // The latest finished period with plays (same rule as the Recap page).
      let latest = ''
      try {
        const result = await api.getListeningDays(userId || 'guest', { tz: listenerTimeZone() })
        latest = latestPeriod(recapTree(Array.isArray(result?.days) ? result.days : []))?.id || ''
        if (latest) localStorage.setItem('lokal-recap-latest-completed', latest)
      } catch {}
      if (!alive) return
      setShow(Boolean(latest) && !recapOpened(latest, userId))
    }
    // Check again when the next period ends (e.g. Monday 00:00), and when
    // the app comes back (a timer doesn't fire while the computer sleeps).
    let boundaryTimer = null
    const scheduleNext = () => {
      clearTimeout(boundaryTimer)
      const wait = Math.max(1000, nextPeriodBoundary().getTime() - Date.now() + 1000)
      boundaryTimer = setTimeout(() => { sync(); scheduleNext() }, Math.min(wait, 2 ** 31 - 1))
    }
    const onResume = () => {
      if (document.visibilityState === 'hidden') return
      sync()
      scheduleNext()
    }
    sync()
    scheduleNext()
    window.addEventListener('storage', sync)
    window.addEventListener('lokal:recap-viewed', sync)
    window.addEventListener('lokal:recap-periods-changed', sync)
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('lokal:recap-viewed', sync)
      window.removeEventListener('lokal:recap-periods-changed', sync)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
      clearTimeout(boundaryTimer)
      alive = false
    }
  }, [userId])
  return show
}

/** The app's sections as tabs under the title bar; the open one is remembered. */
export default function TabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const { t } = useTranslation()
  const user = useAppStore(s => s.user)
  const showRecapBadge = useRecapBadge(user?.id)
  const activeTab = tabForPath(loc.pathname)

  useEffect(() => { if (activeTab) rememberTab(activeTab) }, [activeTab])

  return (
    <div
      role="tablist"
      aria-label="Sections"
      className="relative z-30 flex h-[34px] flex-shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border px-2 [scrollbar-width:none]"
      style={{ backgroundColor: 'rgb(var(--surface-rgb) / 0.85)', backdropFilter: 'blur(12px)' }}
    >
      {TABS.map(({ icon: Icon, label, path, tour }) => {
        const active = activeTab === path
        const badge = path === '/recap' && showRecapBadge
        return (
          <button
            key={path}
            type="button"
            role="tab"
            aria-selected={active}
            data-tour={tour || undefined}
            onClick={() => nav(path === '/' ? getLastHomePath(user?.id) : path)}
            className={`relative -mb-px flex h-[28px] flex-shrink-0 items-center gap-1.5 rounded-t-lg border px-3 text-xs font-medium transition-colors ${active ? 'border-border border-b-transparent bg-bg/70 text-accent' : 'border-transparent text-muted hover:bg-elevated hover:text-white'}`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <span className="whitespace-nowrap">{t(label)}</span>
            {badge && <span aria-label="(new)" className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        )
      })}
    </div>
  )
}
