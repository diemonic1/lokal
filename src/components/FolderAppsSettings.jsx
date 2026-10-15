// Settings > Library > Open Folders In: programs to open a sidebar folder in
// (its right-click menu). Each row: the name shown in that menu and the
// program's full path (.exe, a shortcut, .bat/.cmd, or a .py/.pyw/.vbs script,
// run in Python / Windows Script Host); the folder's full path is passed to it. Kept as JSON
// [{ name, path }] in the folder_apps setting (electron/ipc/folderApps.js).

import React, { useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'

export function parseFolderApps(value) {
  try {
    const list = JSON.parse(value || '[]')
    return Array.isArray(list) ? list.map(item => ({ name: String(item?.name || ''), path: String(item?.path || '') })) : []
  } catch { return [] }
}

export default function FolderAppsSettings({ value, onChange }) {
  const { t } = useTranslation()
  // Edited here as typed (blank rows too); saved on every change.
  const [rows, setRows] = useState(() => parseFolderApps(value))
  const lastSaved = useRef(value)
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
  const browse = async index => {
    const picked = await Promise.resolve(api.openFile({ filters: [{ name: t('Programs'), extensions: ['exe', 'lnk', 'bat', 'cmd', 'py', 'pyw', 'vbs'] }, { name: t('All files'), extensions: ['*'] }] })).catch(() => null)
    if (!picked) return
    const row = rows[index]
    const fileName = String(picked).split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    update(index, { path: picked, ...(row?.name?.trim() ? {} : { name: fileName }) })
  }

  const input = 'min-w-0 bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted/60'
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input type="text" value={row.name} spellCheck={false} onChange={event => update(index, { name: event.target.value })}
            placeholder={t('Name in the menu')} aria-label={t('Name in the menu')} className={`${input} w-40 flex-shrink-0`} />
          <input type="text" value={row.path} spellCheck={false} onChange={event => update(index, { path: event.target.value })}
            placeholder="C:\Program Files\…\program.exe" aria-label={t('Program path')} className={`${input} flex-1`} />
          {api.isElectron && (
            <button type="button" onClick={() => browse(index)} title={t('Choose the program')} aria-label={t('Choose the program')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted hover:text-white">
              <FolderOpen size={14} />
            </button>
          )}
          <button type="button" onClick={() => save(rows.filter((_, i) => i !== index))} title={t('Remove')} aria-label={t('Remove')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => save([...rows, { name: '', path: '' }])}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent/40 hover:text-white">
        <Plus size={14} /> {t('Add program')}
      </button>
    </div>
  )
}
