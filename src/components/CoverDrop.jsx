// A JPEG or PNG dragged in from the computer onto a song's cover (the player
// bar's, Edit Track's): "Replace the cover?" with both pictures, and on yes the
// picture goes into the song's file (see electron/trackCover.js).

import React, { useCallback, useRef, useState } from 'react'
import { ImagePlus, RefreshCw } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { trackArtURL } from '../onlineTracks'
import { showToast } from './Toaster'
import { useTranslation } from '../i18n'
import { announceTrackChanged } from '../trackChanged'

// WebP is taken too, and turned into a JPEG before it goes into the file
// (MP3 players rarely show a WebP cover; see coverImage in electron/trackCover.js).
const COVER_TYPES = /^image\/(jpeg|png|webp)$/i
const COVER_NAMES = /\.(jpe?g|png|webp)$/i
export const isWebp = file => /^image\/webp$/i.test(file?.type || '') || /\.webp$/i.test(file?.name || '')

export const draggingFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files')

/** The dropped picture, when it's a JPEG, PNG or WebP. */
export function droppedCover(event) {
  const files = Array.from(event.dataTransfer?.files || [])
  return files.find(file => COVER_TYPES.test(file.type) || COVER_NAMES.test(file.name)) || null
}

/** An error's message without Electron's "Error invoking remote method ..." in front. */
export function coverError(error) {
  return String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read the picture'))
    reader.readAsDataURL(file)
  })
}

/** Songs with a file on this computer (or the server's library) can take a cover. */
export function canTakeCover(track) {
  return !!track?.id && !!track.file_path && !/^(ghost|https?):/i.test(String(track.file_path))
}

/**
 * @param track      the song the cover is for
 * @param onUpdated  called with the song's row once the cover is in
 * @returns { over, dropProps, dialog } -- spread dropProps on the cover, render dialog
 */
export function useCoverDrop(track, onUpdated) {
  const { t } = useTranslation()
  const syncTrack = usePlayerStore(s => s.syncTrack)
  const [over, setOver] = useState(false)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const depth = useRef(0)
  const enabled = canTakeCover(track)

  // stopPropagation: React passes these on through portals (Edit Track is one)
  // to the page under it, whose own drop zone (Library: "drop to add to the
  // folder") would light up behind the window and stay up after the drop.
  const onDragEnter = useCallback((event) => {
    if (!enabled || !draggingFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    depth.current += 1
    setOver(true)
  }, [enabled])
  const onDragOver = useCallback((event) => {
    if (!enabled || !draggingFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [enabled])
  const onDragLeave = useCallback((event) => {
    if (enabled) event.stopPropagation()
    depth.current = Math.max(0, depth.current - 1)
    if (!depth.current) setOver(false)
  }, [])
  const onDrop = useCallback(async (event) => {
    if (!enabled || !draggingFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    depth.current = 0
    setOver(false)
    const file = droppedCover(event)
    if (!file) { showToast(t('Only .jpg, .png and .webp pictures can be used as a cover')); return }
    try {
      const dataUrl = await readAsDataURL(file)
      setPending({ track, dataUrl, name: file.name, webp: isWebp(file) })
    } catch (e) {
      showToast(t("Couldn't set the cover: {error}", { error: e.message }))
    }
  }, [enabled, track, t])

  const close = () => { if (!busy) setPending(null) }
  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const updated = await api.trackSetArtwork(pending.track.id, pending.dataUrl)
      if (updated?.error) throw new Error(updated.error)
      if (updated?.id) {
        syncTrack(updated)
        onUpdated?.(updated)
        // Every list showing the song (and the folder's cover) reads it again.
        announceTrackChanged(updated.id)
      }
      showToast(t('Cover saved into the file'))
      setPending(null)
    } catch (e) {
      showToast(t("Couldn't set the cover: {error}", { error: coverError(e) }))
    } finally {
      setBusy(false)
    }
  }

  const current = pending ? trackArtURL(pending.track) : null
  const dialog = (
    <Modal open={!!pending} onClose={close} title={current ? t('Replace the cover?') : t('Add a cover?')} width="max-w-md">
      {pending && (
        <div className="space-y-4">
          <p className="text-sm text-muted break-words">
            {[pending.track.artist, pending.track.title].filter(Boolean).join(' — ')}
          </p>
          <div className="flex items-center justify-center gap-4">
            {current && (
              <>
                <figure className="text-center">
                  <img src={current} alt="" className="h-36 w-36 rounded-lg border border-border object-cover" />
                  <figcaption className="mt-1 text-[11px] text-muted">{t('Now')}</figcaption>
                </figure>
                <span className="text-xl text-muted">→</span>
              </>
            )}
            <figure className="text-center">
              <img src={pending.dataUrl} alt="" className="h-36 w-36 rounded-lg border border-accent/50 object-cover" />
              <figcaption className="mt-1 max-w-36 truncate text-[11px] text-muted" title={pending.name}>{pending.name}</figcaption>
            </figure>
          </div>
          <p className="text-[11px] leading-snug text-muted">
            {t('The picture is saved into the song’s file, inside its tags.')} {t('.jpg, .png and .webp pictures are supported.')}
            {pending.webp && <> {t('This .webp picture will be converted to .jpg first.')}</>}
          </p>
          <div className="flex gap-3">
            <button onClick={close} disabled={busy}
              className="flex-1 rounded-xl border border-border bg-card py-2.5 text-sm text-white transition-colors hover:bg-card/70 disabled:opacity-50">
              {t('Cancel')}
            </button>
            <button onClick={confirm} disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? <RefreshCw size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              {current ? t('Replace') : t('Add')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )

  return { over, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop }, dialog }
}
