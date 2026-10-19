// A popup dropping down from a header button (the equalizer, quick settings):
// under the button, growing inwards from the window edge it's nearer to.
// Esc or a press outside it (other than on its button) closes it.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { create } from 'zustand'

/** A store for one popup's open state. */
export const createPopoverStore = () => create(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  close: () => set({ open: false }),
}))

export default function HeaderPopover({ open, onClose, opener, width = 380, label, children }) {
  const [anchor, setAnchor] = useState({ top: 44, left: 12, width, origin: 'top left' })
  const panelRef = useRef(null)

  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const rect = document.querySelector(opener)?.getBoundingClientRect()
      if (!rect) return
      const w = Math.min(width, window.innerWidth - 24)
      const fromLeft = rect.left + rect.width / 2 < window.innerWidth / 2
      const wanted = fromLeft ? rect.left : rect.right - w
      setAnchor({ top: rect.bottom + 8, width: w, origin: fromLeft ? 'top left' : 'top right', left: Math.max(12, Math.min(wanted, window.innerWidth - w - 12)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, opener, width])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (e.target.closest?.(opener)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [open, onClose, opener])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.16 }}
          style={{ top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: `calc(100vh - ${anchor.top + 12}px)`, transformOrigin: anchor.origin, backgroundColor: 'rgba(var(--surface-rgb), 0.97)' }}
          className="fixed z-[80] overflow-y-auto rounded-2xl border border-border p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
