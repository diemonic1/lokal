import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { useAppStore } from '../store/player'
import { api } from '../api'
import { latestPeriod, listenerTimeZone, nextPeriodBoundary, recapOpened, recapTree } from '../recapPeriods'
import { getLastHomePath } from '../recommendationSession'
import { rememberTab, tabForPath } from '../libraryNav'
import { useAppTabs } from '../appTabs'
import { useTranslation } from '../i18n'
import ContextMenu, { useContextMenu } from './ContextMenu'

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

/**
 * The app's sections as tabs under the title bar; the open one is remembered.
 * Tabs the user moved below the line in Settings > Appearance > App Tabs go
 * to the ⋯ menu after the last tab (opened by any mouse button).
 */
export default function TabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const { t } = useTranslation()
  const user = useAppStore(s => s.user)
  const showRecapBadge = useRecapBadge(user?.id)
  const activeTab = tabForPath(loc.pathname)
  const { visible, hidden } = useAppTabs()
  const menu = useContextMenu()
  const go = path => nav(path === '/' ? getLastHomePath(user?.id) : path)
  const hiddenActive = hidden.some(tab => tab.path === activeTab)
  const hiddenBadge = showRecapBadge && hidden.some(tab => tab.path === '/recap')

  useEffect(() => { if (activeTab) rememberTab(activeTab) }, [activeTab])

  // A press on ⋯ while its menu is open only closes it (the menu closes
  // itself on any press outside it; this keeps the click from reopening it).
  const wasOpen = React.useRef(false)
  const openMore = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (wasOpen.current) { wasOpen.current = false; return }
    const r = event.currentTarget.getBoundingClientRect()
    menu.open({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, hidden.map(({ icon, label, path }) => ({
      label: t(label),
      icon,
      hint: path === '/recap' && showRecapBadge ? t('(new)') : undefined,
      onSelect: () => go(path),
    })))
  }

  return (
    <div
      role="tablist"
      aria-label={t('Sections')}
      className="relative z-30 flex h-[34px] flex-shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border px-2 [scrollbar-width:none]"
      style={{ backgroundColor: 'rgb(var(--surface-rgb) / 0.85)', backdropFilter: 'blur(12px)' }}
    >
      {visible.map(({ icon: Icon, label, path, tour }) => {
        const active = activeTab === path
        const badge = path === '/recap' && showRecapBadge
        return (
          <button
            key={path}
            type="button"
            role="tab"
            aria-selected={active}
            data-tour={tour || undefined}
            onClick={() => go(path)}
            className={`relative -mb-px flex h-[28px] flex-shrink-0 items-center gap-1.5 rounded-t-lg border px-3 text-xs font-medium transition-colors ${active ? 'border-border border-b-transparent bg-bg/70 text-accent' : 'border-transparent text-muted hover:bg-elevated hover:text-white'}`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <span className="whitespace-nowrap">{t(label)}</span>
            {badge && <span aria-label={t('(new)')} className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        )
      })}
      {hidden.length > 0 && (
        <button
          type="button"
          title={t('More tabs')}
          aria-label={t('More tabs')}
          aria-haspopup="menu"
          aria-expanded={!!menu.state}
          // Opened by any button: a left, right or middle click.
          onMouseDown={() => { wasOpen.current = !!menu.state }}
          onClick={openMore}
          onContextMenu={openMore}
          onAuxClick={event => { if (event.button === 1) openMore(event) }}
          className={`relative -mb-px flex h-[28px] flex-shrink-0 items-center rounded-t-lg border px-2 transition-colors ${hiddenActive ? 'border-border border-b-transparent bg-bg/70 text-accent' : 'border-transparent text-muted hover:bg-elevated hover:text-white'}`}
        >
          <MoreHorizontal size={14} />
          {hiddenBadge && <span aria-label={t('(new)')} className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      )}
      <ContextMenu menu={menu} />
    </div>
  )
}
