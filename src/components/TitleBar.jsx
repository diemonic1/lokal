import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Minus, Settings, Square, X } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'
import HeaderSearch from './HeaderSearch'
import { DownloadManagerPanel, DownloadsButton } from './DownloadManager'

// What in a `.titlebar` is pressed rather than dragged.
const NO_DRAG = 'button, input, select, textarea, a, [role="menu"], [role="listbox"], [data-no-drag]'

/**
 * The header's drag when the native one misses. A press on an empty bit of a
 * `.titlebar` normally never reaches the page (Windows takes it as a window
 * drag); when it does, the hit-test map is stale or something unseen covers
 * it, so the main process moves the window with the cursor instead (and
 * a double press maximizes, like the real title bar).
 */
function useWindowDragFallback(enabled) {
  React.useEffect(() => {
    const electron = window.electron
    if (!enabled || !electron?.dragStart) return undefined
    let dragging = false
    const end = () => { if (dragging) { dragging = false; electron.dragEnd() } }
    const onDown = (event) => {
      if (event.button !== 0) return
      const target = event.target
      if (!target?.closest?.('.titlebar') || target.closest(NO_DRAG)) return
      event.preventDefault()
      if (event.detail === 2) { end(); electron.maximize(); return }
      dragging = true
      electron.dragStart()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', end)
    window.addEventListener('blur', end)
    return () => {
      end()
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('blur', end)
    }
  }, [enabled])
}

/**
 * The window header: on the left the app name (the draggable part in the
 * desktop app) with Settings and Downloads right after it, close to the
 * sidebar and search (Settings nearer the edge: the downloads panel opens
 * inwards, to the right, so Settings stays in reach); the Home button and
 * search in the middle; the window controls on the right. In the browser it's
 * the same bar without the window controls. Every empty bit of it (and of the
 * tab row under it) drags the window.
 */
export default function TitleBar() {
  const { t } = useTranslation()
  const desktop = api.isElectron
  const nav = useNavigate()
  const onSettings = useLocation().pathname === '/settings'
  useWindowDragFallback(desktop)
  return (
    <div
      className={`${desktop ? 'titlebar' : ''} relative z-40 h-[35px] grid items-center gap-3 px-3 pt-2 flex-shrink-0`}
      style={{ gridTemplateColumns: 'minmax(max-content, 1fr) minmax(0, 660px) minmax(0, 1fr)', backgroundColor: 'rgb(var(--surface-rgb) / 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {/* A narrow window keeps the buttons, not the name. */}
        <span className="mr-2 hidden min-w-0 truncate font-display text-xs text-muted tracking-widest uppercase sm:inline">Lokal Music</span>
        <button
          type="button"
          data-tour="settings"
          onClick={() => nav('/settings')}
          title={t('Settings')}
          aria-label={t('Settings')}
          aria-current={onSettings ? 'page' : undefined}
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center transition-colors ${onSettings ? 'text-accent' : 'text-text/90 hover:text-text'}`}
        >
          <Settings size={15} />
        </button>
        <DownloadsButton />
        <DownloadManagerPanel />
      </div>

      <HeaderSearch />

      <div className="-mt-2 flex items-center gap-1 justify-end">
        {desktop && (
          <>
            <button
              onClick={() => window.electron?.minimize()}
              className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-elevated transition-colors"
            >
              <Minus size={12} />
            </button>
            <button
              onClick={() => window.electron?.maximize()}
              className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-elevated transition-colors"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => window.electron?.close()}
              className="w-7 h-7 rounded flex items-center justify-center text-muted hover:bg-red/30 hover:text-red transition-colors"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
