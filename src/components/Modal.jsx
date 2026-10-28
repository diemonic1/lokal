import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

/**
 * Where a docked dialog goes: over the left menu and the page, from under the
 * tabs to the player bar, up to the right side panels -- which, with the
 * player bar, stay in sight and usable. The whole window until the app's
 * layout is there.
 */
function dockRect() {
  const layout = document.querySelector('[data-app-layout]')
  if (!layout) return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
  const box = layout.getBoundingClientRect()
  const main = layout.querySelector(':scope > main')?.getBoundingClientRect()
  const bar = document.querySelector('[data-player-bar]')?.getBoundingClientRect()
  return {
    top: box.top,
    left: box.left,
    right: main ? main.right : box.right,
    bottom: bar && bar.height ? Math.min(box.bottom, bar.top) : box.bottom,
  }
}

// What counts as a control for a docked dialog (a press on one closes it).
const CONTROLS = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="slider"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [contenteditable="true"]'

function useDockRect(active) {
  const [rect, setRect] = useState(null)
  useLayoutEffect(() => {
    if (!active) return undefined
    const update = () => {
      const next = dockRect()
      setRect(prev => (prev && ['top', 'left', 'right', 'bottom'].every(key => Math.abs(prev[key] - next[key]) < 0.5) ? prev : next))
    }
    update()
    // The side panel opening or being dragged wider, the window resized...
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    for (const el of [document.querySelector('[data-app-layout]'), document.querySelector('[data-app-layout] > main'), document.querySelector('[data-player-bar]')]) {
      if (el) observer?.observe(el)
    }
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [active])
  return rect
}

/**
 * @param onEntered  called once the opening animation has finished, so heavy
 *                   content (long lists with artwork) can mount after it
 *                   instead of stuttering it.
 */
/** @param clearBackdrop  the page behind stays as it is (not dimmed or blurred); a click on it still closes. */
/**
 * @param dock  fills the space of the left menu and the page (dockRect) and
 *              leaves the rest of the window working: a press on a control
 *              anywhere else (CONTROLS), or a context menu opened there,
 *              closes it (and does what it does), except on what's marked
 *              data-keep-dialog -- play/pause, the seek bar, a lyrics line --
 *              and in another dialog or menu (one this one opened).
 */
export default function Modal({ open, onClose, title, children, width = 'max-w-md', onEntered, clearBackdrop = false, dock = false }) {
  const panelRef = useRef(null)
  const rect = useDockRect(open && dock)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !dock) return undefined
    const outside = (target) => target instanceof Element && !panelRef.current?.contains(target)
      && !target.closest('[data-keep-dialog], [role="dialog"], [role="menu"], [role="listbox"]')
    // Only a control closes it (a button, a link, a field, a slider...): a
    // press on an empty part of the window leaves it open.
    const onPress = (event) => {
      if (outside(event.target) && event.target.closest(CONTROLS)) closeRef.current?.()
    }
    // A context menu opened anywhere else closes it too.
    const onMenu = (event) => { if (outside(event.target)) closeRef.current?.() }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('contextmenu', onMenu, true)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('contextmenu', onMenu, true)
    }
  }, [open, dock])

  // Rendered at the end of <body>, so no page wrapper (a transform, a
  // filter) can move or clip it: it always covers the screen.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={dock ? 'pointer-events-none fixed z-50 flex' : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4'}
          style={dock ? (rect ? { top: rect.top, left: rect.left, width: rect.right - rect.left, height: rect.bottom - rect.top } : { inset: 0 }) : undefined}
        >
          {!dock && <div className={`absolute inset-0 ${clearBackdrop ? 'bg-transparent' : 'bg-black/70 backdrop-blur-sm'}`} onClick={onClose} />}
          <motion.div
            ref={panelRef}
            initial={dock ? { opacity: 0, y: 12 } : { opacity: 0, scale: 0.94, y: 16 }}
            animate={dock ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={dock ? { opacity: 0, y: 8 } : { opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onAnimationComplete={(target) => { if (target?.opacity === 1) onEntered?.() }}
            role="dialog"
            aria-modal={dock ? undefined : 'true'}
            aria-label={typeof title === 'string' ? title : undefined}
            className={dock
              ? 'pointer-events-auto relative flex h-full w-full flex-col overflow-hidden border border-border bg-elevated shadow-2xl'
              : `relative z-10 flex max-h-[calc(100vh-1.5rem)] w-full flex-col ${width} bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden sm:max-h-[calc(100vh-2rem)]`}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-center justify-between px-5 pt-4 pb-0 sm:px-6 sm:pt-5">
                <h2 className="font-display text-sm uppercase tracking-widest text-white">{title}</h2>
                {onClose && (
                  <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-white hover:bg-card transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            <div className={dock ? 'flex min-h-0 flex-1 flex-col overflow-y-auto p-5 sm:p-6' : 'min-h-0 overflow-y-auto p-5 sm:p-6'}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
