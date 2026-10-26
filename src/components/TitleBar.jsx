import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppWindow, Globe, Minus, MoreHorizontal, Settings, Square, SquareArrowOutUpRight, X } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'
import { useAppearanceText } from '../appearanceFlags'
import { HEADER_ITEM, MORE, SEARCH, useHeaderLayout } from '../headerLayout'
import HeaderSearch, { HomeButton, RescanButton } from './HeaderSearch'
import { DownloadManagerPanel, DownloadsButton } from './DownloadManager'
import { QuickSettingsButton, QuickSettingsPanel } from './QuickSettings'
import { EqualizerButton, EqualizerPanel } from './EqualizerPopup'
import CastButton from './CastButton'
import { AudioOutputButton, HEADER_ICON, MiniPlayerButton, SleepTimerButton, headerIconTone } from './HeaderPlayerControls'
import { parseFolderApps } from './FolderAppsSettings'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { showToast } from './Toaster'

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

/** Settings, as a header button. */
function SettingsButton() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const onSettings = useLocation().pathname === '/settings'
  return (
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
  )
}

/**
 * A header button's menu, opened under it (by any mouse button); a press on
 * the button while its menu is open only closes it (the menu closes itself on
 * any press outside it; this keeps the click from reopening it).
 */
function useButtonMenu() {
  const menu = useContextMenu()
  const wasOpen = React.useRef(false)
  const open = (event, items) => {
    event.preventDefault()
    event.stopPropagation()
    if (wasOpen.current) { wasOpen.current = false; return }
    const r = event.currentTarget.getBoundingClientRect()
    menu.open({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, items)
  }
  const buttonProps = items => ({
    'aria-haspopup': 'menu',
    'aria-expanded': !!menu.state,
    onMouseDown: () => { wasOpen.current = !!menu.state },
    onClick: event => open(event, items()),
    onContextMenu: event => open(event, items()),
  })
  return { menu, buttonProps }
}

/**
 * The arrow button: the programs and links from Settings > Library > Top Bar
 * Programs (a program starts without arguments, a link opens in the browser),
 * or, with none set up, only a way to that list.
 */
function ProgramsButton() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const apps = parseFolderApps(useAppearanceText('top_apps', '')).filter(app => app.path.trim())
  const { menu, buttonProps } = useButtonMenu()
  const launch = async app => {
    const result = await Promise.resolve(api.launchTopApp(app.path.trim())).catch(error => ({ ok: false, error: error.message }))
    if (!result?.ok) showToast(t('Couldn’t open “{name}”: {error}', { name: app.name.trim() || app.path.trim(), error: t(result?.error || 'unknown error') }))
  }
  const items = () => apps.length
    ? apps.map(app => ({
      label: app.name.trim() || app.path.trim(),
      icon: /^(?:https?:|www\.)/i.test(app.path.trim()) ? Globe : AppWindow,
      onSelect: () => launch(app),
    }))
    : [{ label: t('Add programs in Settings…'), icon: Settings, onSelect: () => nav('/settings', { state: { category: 'library' } }) }]
  return <>
    <button type="button" title={t('Programs')} aria-label={t('Programs')} {...buttonProps(items)}
      className={`${HEADER_ICON} ${headerIconTone(!!menu.state)}`}>
      <SquareArrowOutUpRight size={15} />
    </button>
    <ContextMenu menu={menu} />
  </>
}

/** One header item by its id (see ../headerLayout.js). */
function HeaderItem({ id, more }) {
  switch (id) {
    case 'settings': return <SettingsButton />
    case 'downloads': return <DownloadsButton />
    case 'quickSettings': return <QuickSettingsButton />
    case 'rescan': return <RescanButton />
    case 'home': return <HomeButton />
    case 'equalizer': return <EqualizerButton />
    case SEARCH: return <HeaderSearch />
    case 'cast': return <CastButton />
    case 'audioOutput': return <AudioOutputButton />
    case 'miniPlayer': return <MiniPlayerButton />
    case 'sleepTimer': return <SleepTimerButton />
    case 'programs': return <ProgramsButton />
    case MORE: return <MoreButton ids={more} />
    default: return null
  }
}

/**
 * The ⋯ button: the buttons in the ⋯ group, each with its icon and name.
 * They're mounted here too, out of sight (.header-ghost), and picking one
 * presses its hidden button -- so its own menu or panel opens under ⋯, as it
 * would under the button. One that isn't there now (Cast with no devices,
 * the output picker while casting) is left out of the menu.
 */
function MoreButton({ ids }) {
  const { t } = useTranslation()
  const { menu, buttonProps } = useButtonMenu()
  const hosts = React.useRef({})
  if (!ids.length) return null
  const items = () => ids.map(id => {
    const button = hosts.current[id]?.querySelector('button')
    const item = HEADER_ITEM[id]
    if (!button || !item) return null
    return { label: t(item.label), icon: item.icon, disabled: button.disabled, onSelect: () => button.click() }
  })
  return (
    <div className="relative flex flex-shrink-0 items-center">
      <button type="button" data-header-more title={t('More')} aria-label={t('More')} {...buttonProps(items)}
        className={`${HEADER_ICON} ${headerIconTone(!!menu.state)}`}>
        <MoreHorizontal size={16} />
      </button>
      {ids.map(id => (
        <div key={id} ref={node => { hosts.current[id] = node }} className="header-ghost">
          <HeaderItem id={id} />
        </div>
      ))}
      <ContextMenu menu={menu} />
    </div>
  )
}

/**
 * The window header, in three parts: on the left the app's icon and name
 * (the draggable part in the desktop app) and the buttons after it; the
 * middle (the search box and the buttons around it); the right, before the
 * window controls. Which button goes where, and which sit in the ⋯ menu, is
 * Settings > App Top Bars > Top Bar Buttons (../headerLayout.js). By default
 * Settings, Downloads and Quick settings are on the left, close to the
 * sidebar (the downloads panel opens inwards, to the right, so Settings stays
 * in reach); Rescan, Home, the Equalizer, the search box, the output picker,
 * the mini player and ⋯ (Programs, Sleep Timer, Cast) in the middle. In the
 * browser it's the same bar without the window controls. Every empty bit of
 * it (and of the tab row under it) drags the window.
 */
export default function TitleBar() {
  const desktop = api.isElectron
  const { left, center, right, more } = useHeaderLayout()
  useWindowDragFallback(desktop)
  const items = ids => ids.map(id => <HeaderItem key={id} id={id} more={more} />)
  return (
    <div
      className={`${desktop ? 'titlebar' : ''} relative z-40 h-[35px] grid items-center gap-3 px-3 pt-2 flex-shrink-0`}
      style={{ gridTemplateColumns: 'minmax(max-content, 1fr) minmax(0, 660px) minmax(0, 1fr)', backgroundColor: 'rgb(var(--surface-rgb) / 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <img src="lokal-icon.png" alt="" aria-hidden draggable={false} className="mr-0.5 h-4 w-4 flex-shrink-0 select-none object-contain" />
        {/* A narrow window keeps the buttons, not the name. */}
        <span className="mr-2 hidden min-w-0 truncate font-display text-xs text-muted tracking-widest uppercase sm:inline">Lokal Music</span>
        {items(left)}
      </div>

      <div className="flex min-w-0 w-full items-center justify-center gap-1.5">
        {items(center)}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        {items(right)}
        {desktop && (
          <div className="-mt-2 ml-1 flex items-center gap-1">
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
          </div>
        )}
      </div>

      {/* The buttons' panels, wherever their button is (the ⋯ group too). */}
      <DownloadManagerPanel />
      <QuickSettingsPanel />
      <EqualizerPanel />
    </div>
  )
}
