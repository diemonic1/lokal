// The first line of a song's right-click menu: the folder its file is in, small
// and grey, like a caption. A click copies the file's full path (with its name).

import { FolderOpen } from 'lucide-react'
import { showToast } from './components/Toaster'

/** The song's file on this computer, or null (streamed, ghost, missing, the web app). */
function localFilePath(track) {
  const filePath = String(track?.file_path || '')
  if (!filePath || track.missing || /^(ghost|https?):/i.test(filePath)) return null
  return /^([a-z]:[\\/]|[\\/])/i.test(filePath) ? filePath : null
}

/** The menu item (then a separator), or nothing when the song has no file here. */
export function trackFolderItems(track, t) {
  const filePath = localFilePath(track)
  if (!filePath) return []
  const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  const folder = cut > 0 ? filePath.slice(0, cut) : filePath
  return [
    {
      label: folder,
      caption: true,
      icon: FolderOpen,
      title: t('Click to copy the path: {path}', { path: filePath }),
      onSelect: () => Promise.resolve(navigator.clipboard?.writeText(filePath))
        .then(() => showToast(t('Copied: {text}', { text: filePath })))
        .catch(() => showToast(t('Could not copy to the clipboard'))),
    },
    { separator: true },
  ]
}
