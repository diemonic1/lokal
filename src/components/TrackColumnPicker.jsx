import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns3, GripVertical, LockKeyhole } from 'lucide-react'
import { ALWAYS_SHOWN, ROW_SIZE, TRACK_COLUMN_DEFS } from '../trackColumns'

// Shown inside Title or at the row's ends: switched on and off, not moved.
const OTHER_OPTIONS = [['artwork', 'Artwork'], ['artist', 'Artist'], ['actions', 'Quick actions'], ['grip', 'Drag handle']]

export default function TrackColumnPicker({ columns, playlist, onChange, onReset }) {
  const [open, setOpen] = useState(false)
  // The column being dragged in the list, and where it would land.
  const [dragKey, setDragKey] = useState(null)
  const [overKey, setOverKey] = useState(null)
  const moveColumn = (key, target) => {
    if (!key || key === target) return
    const order = columns.order.filter(k => k !== key)
    order.splice(order.indexOf(target) + (columns.order.indexOf(key) < columns.order.indexOf(target) ? 1 : 0), 0, key)
    onChange('order', order)
  }
  const [position, setPosition] = useState({})
  const button = useRef(null)
  const panel = useRef(null)
  const id = useId()
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) button.current?.focus()
  }
  useLayoutEffect(() => {
    if (!open) return
    const anchor = button.current.getBoundingClientRect()
    const rect = panel.current.getBoundingClientRect()
    const below = window.innerHeight - anchor.bottom - 12
    const above = anchor.top - 12
    const upwards = below < rect.height && above > below
    setPosition({
      left: Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)),
      top: upwards ? undefined : anchor.bottom + 4,
      bottom: upwards ? window.innerHeight - anchor.top + 4 : undefined,
      maxHeight: Math.max(120, upwards ? above : below),
    })
    panel.current.querySelector('input:not(:disabled)')?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = event => {
      if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) close()
    }
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    }
    const resize = () => close(true)
    const scroll = event => { if (!panel.current?.contains(event.target)) close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])

  return <>
    <button ref={button} type="button" title="Edit song list columns" aria-label="Edit song list columns"
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onClick={event => { event.stopPropagation(); setOpen(value => !value) }}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-elevated hover:text-text focus-visible:outline focus-visible:outline-accent">
      <Columns3 size={14} /> Columns
    </button>
    {open && createPortal(
      <div ref={panel} id={id} role="dialog" aria-label="Song list columns" style={position}
        onClick={event => event.stopPropagation()}
        className="fixed z-[200] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-elevated p-2 shadow-2xl">
        <p className="px-2 py-1.5 text-xs font-display uppercase tracking-wider text-muted">Show in song lists</p>
        {columns.order.map(key => {
          const locked = ALWAYS_SHOWN.has(key)
          const label = TRACK_COLUMN_DEFS[key].label
          return (
            <div key={key} draggable
              onDragStart={event => { setDragKey(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key) }}
              onDragOver={event => { if (!dragKey) return; event.preventDefault(); setOverKey(key) }}
              onDrop={event => { event.preventDefault(); moveColumn(dragKey, key); setDragKey(null); setOverKey(null) }}
              onDragEnd={() => { setDragKey(null); setOverKey(null) }}
              className={`flex items-center gap-1.5 rounded-lg pr-2 text-sm hover:bg-card focus-within:bg-card ${dragKey === key ? 'opacity-40' : ''} ${overKey === key && dragKey !== key ? 'ring-1 ring-accent/60' : ''}`}>
              <span title="Drag to reorder" className="cursor-grab px-0.5 py-1.5 text-muted active:cursor-grabbing"><GripVertical size={13} aria-hidden="true" /></span>
              {locked ? (
                <label title="Always shown" className="flex flex-1 items-center gap-2.5 py-1.5 text-muted">
                  <input type="checkbox" checked disabled className="accent-accent" />
                  <span className="flex-1">{label}</span><LockKeyhole size={12} aria-hidden="true" />
                </label>
              ) : (
                <label className="flex flex-1 cursor-pointer items-center gap-2.5 py-1.5 text-text">
                  <input type="checkbox" checked={!!columns[key]} onChange={event => onChange(key, event.target.checked)} className="accent-accent" />
                  {label}
                </label>
              )}
            </div>
          )
        })}
        <div className="my-1 border-t border-border" />
        {OTHER_OPTIONS.filter(([key]) => key !== 'grip' || playlist).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-text hover:bg-card focus-within:bg-card">
            <input type="checkbox" checked={!!columns[key]} onChange={event => onChange(key, event.target.checked)} className="accent-accent" />
            {label}
          </label>
        ))}
        <div className="mt-1 border-t border-border px-2 py-2">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span>Row size</span><span>{Math.round(columns.rowSize * 100)}%</span>
          </div>
          <input type="range" min={ROW_SIZE.min} max={ROW_SIZE.max} step={ROW_SIZE.step} value={columns.rowSize}
            onChange={event => onChange('rowSize', Number(event.target.value))}
            onDoubleClick={() => onChange('rowSize', ROW_SIZE.initial)}
            aria-label="Row size" title="Double-click to reset" className="w-full accent-accent" />
        </div>
        <p className="border-t border-border px-2 pt-2 text-[11px] leading-relaxed text-muted">Saved for all song lists in this profile. Drag a column's edge in the header to resize it. Narrow lists tuck Album under Title and fit other columns as space allows.</p>
        <button type="button" onClick={onReset} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-accent hover:bg-card">Reset to defaults</button>
      </div>, document.body,
    )}
  </>
}
