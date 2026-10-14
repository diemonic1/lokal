import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A song list toolbar button (same look as Columns) that opens a small
 * panel under it: closed by a click outside, Escape, scrolling or resizing.
 */
export default function ToolbarMenu({ icon: Icon, label, badge = null, active = false, width = 'w-64', children }) {
  const [open, setOpen] = useState(false)
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
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])

  return <>
    <button ref={button} type="button" title={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onClick={event => { event.stopPropagation(); setOpen(value => !value) }}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-elevated focus-visible:outline focus-visible:outline-accent ${active ? 'text-accent' : 'text-muted hover:text-text'}`}>
      <Icon size={14} /> {label}
      {badge != null && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-base">{badge}</span>}
    </button>
    {open && createPortal(
      <div ref={panel} id={id} role="dialog" aria-label={label} style={position}
        onClick={event => event.stopPropagation()}
        className={`fixed z-[200] ${width} max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-elevated p-2 shadow-2xl`}>
        {typeof children === 'function' ? children(close) : children}
      </div>, document.body,
    )}
  </>
}
