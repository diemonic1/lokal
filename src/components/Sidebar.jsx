import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Folder, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { api } from '../api'
import FadeImg from './FadeImg'
import { setLibraryFolder, useLibraryFolder } from '../libraryNav'
import { LEFT_SIDEBAR_WIDTH, setLeftSidebarWidth, useLeftSidebarScale, useLeftSidebarWidth } from '../sidePanelPrefs'
import { useTranslation } from '../i18n'

// Collapsed, the sidebar shows only the folders' covers (their names on
// hover); the choice is remembered.
const COLLAPSED_KEY = 'lokal-sidebar-collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false } }

const coverSrc = folder => folder.coverPath
  ? (api.isElectron ? api.fileURL(folder.coverPath) : api.artworkURL(folder.coverTrackId))
  : null

/** Left sidebar: the music folder's subfolders with songs; picking one opens it in Library. */
export default function Sidebar() {
  const nav = useNavigate()
  const loc = useLocation()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [folders, setFolders] = useState([])
  const [allFolders, setAllFolders] = useState([])
  const selected = useLibraryFolder()
  const width = useLeftSidebarWidth()
  const scale = useLeftSidebarScale()
  const [resizing, setResizing] = useState(false)
  const toggleCollapsed = () => setCollapsed(value => {
    try { localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1') } catch {}
    return !value
  })

  useEffect(() => {
    let alive = true
    const load = () => Promise.resolve(api.getLibraryFolders('')).then(result => {
      if (!alive || !Array.isArray(result?.folders)) return
      setAllFolders(result.folders)
      // Folders without any music aren't listed.
      setFolders(result.folders.filter(folder => folder.trackCount > 0))
    }).catch(() => {})
    load()
    window.addEventListener('lokal:refresh', load)
    return () => { alive = false; window.removeEventListener('lokal:refresh', load) }
  }, [])

  // Nothing picked yet, or the picked folder no longer exists: the first one.
  // A folder that's still there keeps its place even while it reads as empty
  // (e.g. mid-scan), so the choice survives restarts.
  useEffect(() => {
    if (!folders.length) return
    if (selected && allFolders.some(folder => folder.path === selected)) return
    setLibraryFolder(folders[0].path)
  }, [folders, allFolders, selected])

  const onLibrary = loc.pathname === '/library'
  const open = path => {
    setLibraryFolder(path)
    if (!onLibrary) nav('/library')
  }

  // Width: dragged by the right edge, kept between sessions.
  const startResize = (event) => {
    if (event.button !== 0 || collapsed) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    let last = startWidth
    setResizing(true)
    const move = e => { last = setLeftSidebarWidth(startWidth + (e.clientX - startX), { persist: false }) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setLeftSidebarWidth(last)
      setResizing(false)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const cover = Math.round(32 * scale)
  const collapsedWidth = cover + 40

  return (
    <aside
      aria-label="Sidebar"
      className={`relative border-r border-border flex flex-col h-full pb-[var(--player-space,0px)] flex-shrink-0 ${resizing ? '' : 'transition-[width] duration-200 ease-out'}`}
      style={{ width: collapsed ? collapsedWidth : width, backgroundColor: 'rgba(var(--surface-rgb), 0.85)', backdropFilter: 'blur(12px)' }}
    >
      {/* Over the list, shown only while the pointer is near the button itself. */}
      <div className={`group/collapse absolute top-0 z-20 p-1.5 ${collapsed ? 'left-1/2 -translate-x-1/2' : 'right-0.5'}`}>
      <button
        onClick={toggleCollapsed}
        title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
        aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
        aria-expanded={!collapsed}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-elevated text-muted opacity-0 shadow-lg transition-opacity hover:text-white focus-visible:opacity-100 group-hover/collapse:opacity-100"
      >
        {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      </div>

      <nav aria-label="Music folders" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-1.5">
        {folders.map(folder => {
          const active = onLibrary && folder.path === selected
          const src = coverSrc(folder)
          return (
            <button
              key={folder.path}
              type="button"
              onClick={() => open(folder.path)}
              title={collapsed ? folder.name : undefined}
              aria-label={collapsed ? folder.name : undefined}
              aria-current={active ? 'page' : undefined}
              style={{ fontSize: `${0.75 * scale}rem`, gap: `${0.625 * scale}rem` }}
              className={`w-full flex items-center py-1.5 rounded-lg transition-all ${collapsed ? 'justify-center px-0' : 'px-2'} ${active ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}
            >
              <div className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded bg-elevated" style={{ width: cover, height: cover }}>
                {src
                  ? <FadeImg src={src} alt="" className="h-full w-full object-cover" />
                  : <Folder size={Math.round(14 * scale)} className="text-muted" />}
              </div>
              {!collapsed && <span className="min-w-0 flex-1 truncate text-left font-medium">{folder.name}</span>}
            </button>
          )
        })}
      </nav>

      {/* Drag the right edge to resize; double-click puts it back. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          title={t("Drag to resize")}
          onPointerDown={startResize}
          onDoubleClick={() => setLeftSidebarWidth(LEFT_SIDEBAR_WIDTH.initial)}
          className="absolute right-0 inset-y-0 z-30 w-1.5 translate-x-1/2 cursor-col-resize"
        />
      )}
    </aside>
  )
}
