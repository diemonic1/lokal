// Settings > Library > Open Folders In: programs to open a sidebar folder in
// (its right-click menu). Each row: the name shown in that menu and the
// program's full path (.exe, a shortcut, .bat/.cmd, or a .py/.pyw/.vbs script,
// run in Python / Windows Script Host); the folder's full path is passed to it. Kept as JSON
// [{ name, path }] in the folder_apps setting (electron/ipc/folderApps.js).
// Settings > Library > Top Bar Programs uses it too (`links`): the same rows
// in the top_apps setting, where a row may be a web link instead of a program.
// Rows are dragged by their handle (or moved with the arrows) to reorder them.

import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FolderOpen, GripVertical, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'

export function parseFolderApps(value) {
  try {
    const list = JSON.parse(value || '[]')
    return Array.isArray(list) ? list.map(item => ({ name: String(item?.name || ''), path: String(item?.path || '') })) : []
  } catch { return [] }
}

export default function FolderAppsSettings({ value, onChange, links = false }) {
  const { t } = useTranslation()
  // Edited here as typed (blank rows too); saved on every change.
  const [rows, setRows] = useState(() => parseFolderApps(value))
  const lastSaved = useRef(value)
  // Dragging: only from the handle (the row is draggable while it's held).
  const [grabbed, setGrabbed] = useState(null)
  const [dragged, setDragged] = useState(null)
  const [over, setOver] = useState(null)
  useEffect(() => {
    if (value !== lastSaved.current) { lastSaved.current = value; setRows(parseFolderApps(value)) }
  }, [value])
  const save = next => {
    setRows(next)
    const json = JSON.stringify(next)
    lastSaved.current = json
    onChange(json)
  }
  const update = (index, patch) => save(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const move = (from, to) => {
    if (from === to || to < 0 || to >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    save(next)
  }
  const endDrag = () => { setGrabbed(null); setDragged(null); setOver(null) }
  const browse = async index => {
    const picked = await Promise.resolve(api.openFile({ filters: [{ name: t('Programs'), extensions: ['exe', 'lnk', 'bat', 'cmd', 'py', 'pyw', 'vbs'] }, { name: t('All files'), extensions: ['*'] }] })).catch(() => null)
    if (!picked) return
    const row = rows[index]
    const fileName = String(picked).split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    update(index, { path: picked, ...(row?.name?.trim() ? {} : { name: fileName }) })
  }

  const input = 'min-w-0 bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted/60'
  const arrow = 'rounded p-0.5 text-muted hover:text-white disabled:opacity-30'
  return (
    <div className="space-y-2" onDragEnd={endDrag}>
      {rows.map((row, index) => (
        <div key={index} draggable={grabbed === index}
          onDragStart={event => { setDragged(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)) }}
          onDragOver={event => { if (dragged != null) { event.preventDefault(); setOver(index) } }}
          onDrop={event => { event.preventDefault(); if (dragged != null) move(dragged, index); endDrag() }}
          className={`flex items-center gap-2 rounded-lg transition-opacity ${dragged === index ? 'opacity-50' : ''} ${over === index && dragged !== index ? 'outline outline-1 outline-accent/60' : ''}`}>
          <span onMouseDown={() => setGrabbed(index)} onMouseUp={() => { if (dragged == null) setGrabbed(null) }}
            title={t('Drag to reorder')} aria-hidden
            className="flex h-9 w-5 flex-shrink-0 cursor-grab items-center justify-center text-muted hover:text-white active:cursor-grabbing">
            <GripVertical size={14} />
          </span>
          <input type="text" value={row.name} spellCheck={false} onChange={event => update(index, { name: event.target.value })}
            placeholder={t('Name in the menu')} aria-label={t('Name in the menu')} className={`${input} w-40 flex-shrink-0`} />
          <input type="text" value={row.path} spellCheck={false} onChange={event => update(index, { path: event.target.value })}
            placeholder={links ? t('C:\\Program Files\\…\\program.exe or https://…') : 'C:\\Program Files\\…\\program.exe'}
            aria-label={links ? t('Program path or link') : t('Program path')} className={`${input} flex-1`} />
          {api.isElectron && (
            <button type="button" onClick={() => browse(index)} title={t('Choose the program')} aria-label={t('Choose the program')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted hover:text-white">
              <FolderOpen size={14} />
            </button>
          )}
          <span className="flex flex-shrink-0 flex-col">
            <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} title={t('Move up')} aria-label={t('Move up')} className={arrow}>
              <ChevronUp size={13} />
            </button>
            <button type="button" onClick={() => move(index, index + 1)} disabled={index === rows.length - 1} title={t('Move down')} aria-label={t('Move down')} className={arrow}>
              <ChevronDown size={13} />
            </button>
          </span>
          <button type="button" onClick={() => save(rows.filter((_, i) => i !== index))} title={t('Remove')} aria-label={t('Remove')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => save([...rows, { name: '', path: '' }])}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent/40 hover:text-white">
        <Plus size={14} /> {links ? t('Add program or link') : t('Add program')}
      </button>
    </div>
  )
}
