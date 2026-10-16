// The "E" mark next to an explicit track's title, with a hover hint.
import React from 'react'
import { useTranslation } from '../i18n'

export default function ExplicitBadge({ className = '' }) {
  const { t } = useTranslation()
  const label = t('Explicit content')
  return (
    <span
      title={label}
      aria-label={label}
      style={{ backgroundColor: '#292929' }}
      className={`inline-flex items-center justify-center w-[14px] h-[15px] rounded border border-border text-[10px] leading-none font-display uppercase text-muted flex-shrink-0 cursor-default select-none ${className}`}
    >
      E
    </span>
  )
}
