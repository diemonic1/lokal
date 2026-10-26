// The header's Equalizer button (right of Home) and the popup it opens: the
// same equalizer as in Settings (one store, so a change in either shows in
// both).

import React from 'react'
import { EqualizerControls } from '../equalizer'
import { useTranslation } from '../i18n'
import HeaderPopover, { createPopoverStore } from './HeaderPopover'

const useEqualizerPopup = createPopoverStore()

// Three sliders with filled knobs at different heights.
export function EqualizerIcon({ size = 15, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 3v18M12 3v18M19 3v18" />
      <circle cx="5" cy="9" r="3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15" r="3" fill="currentColor" stroke="none" />
      <circle cx="19" cy="9" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

const OPENER = '[data-equalizer-toggle]'

export function EqualizerButton({ className = '' }) {
  const open = useEqualizerPopup(s => s.open)
  const toggle = useEqualizerPopup(s => s.toggle)
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-equalizer-toggle
      onClick={toggle}
      title={t('Equalizer')}
      aria-label={t('Equalizer')}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center transition-colors ${open ? 'text-accent' : 'text-text/90 hover:text-text'} ${className}`}
    >
      <EqualizerIcon />
    </button>
  )
}

export function EqualizerPanel() {
  const open = useEqualizerPopup(s => s.open)
  const close = useEqualizerPopup(s => s.close)
  const { t } = useTranslation()
  return (
    <HeaderPopover open={open} onClose={close} opener={OPENER} width={400} label={t('Equalizer')}>
      <EqualizerControls compact />
    </HeaderPopover>
  )
}
