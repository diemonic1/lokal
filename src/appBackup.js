// Full App Export (Settings > Data > Backup, and the header's quick settings):
// everything the database holds plus this window's interface preferences, as
// one JSON file.

import { api } from './api'
import { collectLocalPrefs } from './localPrefsBackup'
import { translate } from './i18n'

export function triggerDownload(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Saves the full export; throws when it can't be made. */
export async function exportAllAppData() {
  const exported = await api.exportAllData()
  if (!exported || exported.error) throw new Error(exported?.error || translate('Export failed'))
  // Interface preferences live in this window, not the database: they go along.
  const data = { ...exported, local_prefs: collectLocalPrefs() }
  triggerDownload(
    JSON.stringify(data, null, 2),
    `lokal-app-data-${new Date().toISOString().split('T')[0]}.json`,
    'application/json'
  )
}
