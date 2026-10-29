// A page title (h1) that copies its text to the clipboard when clicked.

import React from 'react'
import { showToast } from './Toaster'
import { useTranslation } from '../i18n'

export default function CopyTitle({ text, className = '' }) {
  const { t } = useTranslation()
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); showToast(t('Copied: {text}', { text })) } catch { showToast(t('Couldn’t copy')) }
  }
  return (
    <h1 onClick={copy} title={t('Click to copy')} className={`cursor-pointer transition-opacity hover:opacity-80 ${className}`}>{text}</h1>
  )
}
