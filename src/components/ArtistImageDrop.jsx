// A JPEG, PNG or WebP dragged in from the computer onto an artist (their page's
// header, their card on Artists): "Replace the artist's picture?" with both
// pictures, and on yes it becomes their picture (saved as a JPEG, as "Change
// the picture" does).
//
//   const imageDialog = useArtistImageDialog(onSaved)   // one per page
//   const target = useImageDropTarget(file => imageDialog.ask(artist, currentSrc, file))
//   <div {...target.dropProps}> ... {target.over && ...} </div>
//   {imageDialog.dialog}

import React, { useCallback, useRef, useState } from 'react'
import { ImagePlus, RefreshCw } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'
import { showToast } from './Toaster'
import { useTranslation } from '../i18n'
import { coverError, draggingFiles, droppedCover, readAsDataURL } from './CoverDrop'

/** The picture as a JPEG data URL (artist pictures are stored as .jpg). */
function toJpeg(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = () => reject(new Error('Could not read the picture'))
    img.src = dataUrl
  })
}

/**
 * Something files can be dropped on. `onFile(file)` gets the dropped picture;
 * stopPropagation keeps a card's drop from reaching the page around it.
 * @returns { over, dropProps }
 */
export function useImageDropTarget(onFile, enabled = true) {
  const { t } = useTranslation()
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const fileRef = useRef(onFile)
  fileRef.current = onFile

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
  }, [enabled])
  const onDrop = useCallback((event) => {
    if (!enabled || !draggingFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    depth.current = 0
    setOver(false)
    const file = droppedCover(event)
    if (!file) { showToast(t('Only .jpg, .png and .webp pictures can be used')); return }
    fileRef.current?.(file)
  }, [enabled, t])

  return { over, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

/**
 * The confirmation, one per page. `ask(artist, currentSrc, file)` opens it;
 * `onUpdated(artist, imagePath)` runs once the picture is saved.
 */
export function useArtistImageDialog(onUpdated) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  const ask = useCallback(async (artist, current, file) => {
    if (!artist?.id || !file) return
    try {
      const dataUrl = await readAsDataURL(file)
      setPending({ artist, current: current || null, dataUrl, name: file.name })
    } catch (e) {
      showToast(t("Couldn't set the picture: {error}", { error: e.message }))
    }
  }, [t])

  const close = () => { if (!busy) setPending(null) }
  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const result = await api.artistSetImage(pending.artist.id, await toJpeg(pending.dataUrl))
      if (result?.error) throw new Error(result.error)
      // The app answers with the file's path, the web server with { path }.
      const imagePath = typeof result === 'string' ? result : result?.path || pending.artist.image_path || null
      showToast(t('Artist picture saved'))
      setPending(null)
      onUpdated?.(pending.artist, imagePath)
    } catch (e) {
      showToast(t("Couldn't set the picture: {error}", { error: coverError(e) }))
    } finally {
      setBusy(false)
    }
  }

  const current = pending?.current
  const dialog = (
    <Modal open={!!pending} onClose={close} title={current ? t('Replace the artist’s picture?') : t('Add a picture for the artist?')} width="max-w-md">
      {pending && (
        <div className="space-y-4">
          <p className="text-sm text-muted break-words">{pending.artist.name}</p>
          <div className="flex items-center justify-center gap-4">
            {current && (
              <>
                <figure className="text-center">
                  <img src={current} alt="" className="h-36 w-36 rounded-full border border-border object-cover" />
                  <figcaption className="mt-1 text-[11px] text-muted">{t('Now')}</figcaption>
                </figure>
                <span className="text-xl text-muted">→</span>
              </>
            )}
            <figure className="text-center">
              <img src={pending.dataUrl} alt="" className="h-36 w-36 rounded-full border border-accent/50 object-cover" />
              <figcaption className="mt-1 max-w-36 truncate text-[11px] text-muted" title={pending.name}>{pending.name}</figcaption>
            </figure>
          </div>
          <p className="text-[11px] leading-snug text-muted">
            {t('.jpg, .png and .webp pictures are supported.')} {t('The picture is saved as .jpg and won’t be replaced by one found online.')}
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

  return { ask, dialog }
}

/** One artist's page: its header is the drop area. @returns { over, dropProps, dialog } */
export function useArtistImageDrop(artist, current, onUpdated) {
  const imageDialog = useArtistImageDialog(() => onUpdated?.())
  const target = useImageDropTarget(file => imageDialog.ask(artist, current, file), !!artist?.id)
  return { over: target.over, dropProps: target.dropProps, dialog: imageDialog.dialog }
}
