import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Camera, Save, RefreshCw, Check, AlertCircle, Search, ImagePlus, Download } from 'lucide-react'
import { api } from '../api'
import Modal from './Modal'
import GenreChips from './GenreChips'
import { trackGenreList, genreKey } from '../genres'
import { usePlayerStore } from '../store/player'
import { useTranslation } from '../i18n'
import { announceLyricsFileChanged } from '../lyricLine'
import { announceTrackChanged } from '../trackChanged'
import { useCoverDrop, coverError } from './CoverDrop'
import ClipAvailability from './ClipAvailability'
import { CLIP_ZOOM_MAX, clipTimeInput, clipVideoLink, clipZoomPercent, formatClipTime, parseClipTime, previewClip } from '../clipVideo'

function asInput(value) {
  return value === null || value === undefined ? '' : String(value)
}

function parseIntegerField(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  const parsed = parseInt(trimmed, 10)
  return Number.isNaN(parsed) ? null : parsed
}

const LRC_STAMP = /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/
const hasLocalFile = (track) => !!track?.file_path && !/^(ghost|https?):/i.test(String(track.file_path))

function parseNumberField(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  const parsed = parseFloat(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

export default function TrackEditModal({ track, open, onClose, onSave }) {
  const { t } = useTranslation()
  const syncTrack = usePlayerStore(s => s.syncTrack)
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    album: '',
    album_artist: '',
    track_num: '',
    year: '',
    genre: '',
    genres: [],
    record_label: '',
    comment: '',
    explicit: false,
    clip_url: '',
    clip_start: '',
    clip_end: '',
    clip_zoom: 0,
    danceability: '',
    energy: '',
    track_key: '',
    loudness: '',
    mode: '',
    speechiness: '',
    acousticness: '',
    instrumentalness: '',
    liveness: '',
    valence: '',
    tempo: '',
    time_signature: '',
  })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)
  const [artworkPreview, setArtworkPreview] = useState(null)
  const [genreOptions, setGenreOptions] = useState([])
  // The lyrics inside the file's tags, saved on "Save Changes":
  //   text      the standard tags: USLT (and SYLT when it has LRC time stamps)
  //   syllable  Lokal's own LOKAL_LYRICS word timings, as enhanced LRC; ''
  //             when the file has none
  // Both are edited side by side; `mode` only picks which one the field shows.
  const emptyLyrics = { text: '', original: '', syllable: '', syllableOriginal: '', mode: 'plain', sidecar: null, error: null }
  const [lyrics, setLyrics] = useState({ ...emptyLyrics, state: 'idle' })

  useEffect(() => {
    if (!open || !track?.id || !hasLocalFile(track)) { setLyrics({ ...emptyLyrics, state: 'none' }); return }
    let active = true
    setLyrics({ ...emptyLyrics, state: 'loading' })
    api.readFileLyrics(track.id).then((r) => {
      if (!active) return
      if (!r || r.ok === false) { setLyrics({ ...emptyLyrics, state: 'error', error: r?.error || null }); return }
      const text = String(r.text || '')
      const syllable = String(r.syllable || '')
      setLyrics({ ...emptyLyrics, text, original: text, syllable, syllableOriginal: syllable, mode: syllable ? 'syllable' : 'plain', state: 'ready', sidecar: r.sidecar || null })
    }).catch((e) => { if (active) setLyrics({ ...emptyLyrics, state: 'error', error: e?.message || null }) })
    return () => { active = false }
  }, [open, track?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    let active = true
    api.getAllGenres().then((result) => {
      if (!active) return
      setGenreOptions(Array.isArray(result) ? result : [])
    }).catch(() => {
      if (active) setGenreOptions([])
    })
    return () => {
      active = false
    }
  }, [open])

  useEffect(() => {
    if (track) {
      setFormData({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        album_artist: track.album_artist || '',
        track_num: asInput(track.track_num),
        year: asInput(track.year),
        genre: track.genre || '',
        // Every genre of the song (its main one and its list, split at / \ ; ,).
        genres: trackGenreList(track),
        record_label: track.record_label || '',
        comment: track.comment || '',
        explicit: !!track.explicit,
        clip_url: track.clip_url || '',
        clip_start: formatClipTime(track.clip_start),
        clip_end: formatClipTime(track.clip_end),
        clip_zoom: clipZoomPercent(track.clip_zoom),
        danceability: asInput(track.danceability),
        energy: asInput(track.energy),
        track_key: asInput(track.track_key),
        loudness: asInput(track.loudness),
        mode: asInput(track.mode),
        speechiness: asInput(track.speechiness),
        acousticness: asInput(track.acousticness),
        instrumentalness: asInput(track.instrumentalness),
        liveness: asInput(track.liveness),
        valence: asInput(track.valence),
        tempo: asInput(track.tempo),
        time_signature: asInput(track.time_signature),
      })
      
      if (track.artwork_path) {
        setArtworkPreview(api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id))
      } else {
        setArtworkPreview(null)
      }
      setStatus(null)
    }
  }, [track])

  // Once a video field is touched, the video as typed plays in the side panel
  // at once (the link once it stops changing), before it's saved.
  const [clipTouched, setClipTouched] = useState(false)
  const previewedUrl = useRef(null)
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (field.startsWith('clip_')) setClipTouched(true)
  }
  useEffect(() => {
    const id = track?.id
    if (!open || !clipTouched || id == null) return undefined
    const { clip_url: url, clip_start: start, clip_end: end, clip_zoom: zoom } = formData
    const timer = setTimeout(() => {
      previewedUrl.current = url
      previewClip(id, { url, start, end, zoom })
    }, url === previewedUrl.current ? 0 : 450)
    return () => clearTimeout(timer)
  }, [open, clipTouched, track?.id, formData.clip_url, formData.clip_start, formData.clip_end, formData.clip_zoom]) // eslint-disable-line react-hooks/exhaustive-deps
  // Closed (saved or not) or another song: the video goes back to the saved one.
  useEffect(() => {
    const id = track?.id
    if (!open || id == null) return undefined
    setClipTouched(false)
    previewedUrl.current = null
    return () => previewClip(id, null)
  }, [open, track?.id])

  // The picture (.jpg/.png) goes into the song's file (electron/trackCover.js).
  const showArtwork = (row) => setArtworkPreview(row?.artwork_path ? (api.isElectron ? `file://${row.artwork_path}` : api.artworkURL(row.id)) : null)
  const handleSelectArtwork = async () => {
    if (!api.isElectron) return
    
    const fp = await api.openFile([{ name: t('Images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    
    setSaving(true)
    try {
      const dataUrl = await api.readFileAsDataURL(fp)
      const updatedTrack = await api.trackSetArtwork(track.id, dataUrl)
      if (updatedTrack?.error) throw new Error(updatedTrack.error)
      if (updatedTrack?.id) {
        showArtwork(updatedTrack)
        syncTrack(updatedTrack)
        if (onSave) onSave(updatedTrack)
        announceTrackChanged(updatedTrack.id)
      }
      setStatus({ type: 'success', message: t('Cover saved into the file') })
      setTimeout(() => setStatus(null), 2000)
    } catch (e) {
      setStatus({ type: 'error', message: coverError(e) })
    }
    setSaving(false)
  }
  // A .jpg/.png dragged onto the cover: asks first, then into the file.
  const coverDrop = useCoverDrop(track, (updatedTrack) => {
    showArtwork(updatedTrack)
    if (onSave) onSave(updatedTrack)
  })

  const handleSave = async () => {
    if (!track) return
    
    setSaving(true)
    setStatus(null)
    
    try {
      const updateData = {}
      if (formData.title && formData.title !== track.title) updateData.title = formData.title
      if (formData.artist && formData.artist !== track.artist) updateData.artist = formData.artist
      if (formData.album !== track.album) updateData.album = formData.album || null
      if (formData.album_artist !== track.album_artist) updateData.album_artist = formData.album_artist || null
      if (String(formData.track_num) !== String(track.track_num ?? '')) updateData.track_num = parseIntegerField(formData.track_num)
      if (String(formData.year) !== String(track.year ?? '')) updateData.year = parseIntegerField(formData.year)
      // The first genre is the song's main one; all of them make its list.
      const genreList = Array.isArray(formData.genres) ? formData.genres : trackGenreList({ genres: formData.genres })
      if (genreList.map(genreKey).join('\n') !== trackGenreList(track).map(genreKey).join('\n')) {
        updateData.genre = genreList[0] || null
        updateData.genres = genreList.join(', ') || null
      }
      if (formData.record_label !== (track.record_label || '')) updateData.record_label = formData.record_label || null
      if (formData.comment.trim() !== (track.comment || '').trim()) updateData.comment = formData.comment.trim()
      if (formData.explicit !== !!track.explicit) updateData.explicit = formData.explicit ? 1 : 0
      // The music video: a link (YouTube or any site with a video) or a video
      // file; the seconds it loops between in the side panel's Visualization +
      // Lyrics tab.
      const clipUrl = formData.clip_url.trim()
      if (clipUrl && !clipVideoLink(clipUrl)) {
        setStatus({ type: 'error', message: t('The music video must be a link or a video file on this computer') })
        setSaving(false)
        return
      }
      // Typed as seconds or minutes:seconds; either may be left empty (see clipVideo.js).
      const clipStart = parseClipTime(formData.clip_start)
      const clipEnd = parseClipTime(formData.clip_end)
      if (Number.isNaN(clipStart) || Number.isNaN(clipEnd)) {
        setStatus({ type: 'error', message: t('Loop times are seconds or minutes:seconds, like 75 or 1:15') })
        setSaving(false)
        return
      }
      if (clipStart != null && clipEnd != null && clipEnd <= clipStart) {
        setStatus({ type: 'error', message: t('The loop must end after it starts') })
        setSaving(false)
        return
      }
      if (clipUrl !== (track.clip_url || '')) updateData.clip_url = clipUrl || null
      if (clipStart !== (track.clip_start ?? null)) updateData.clip_start = clipStart
      if (clipEnd !== (track.clip_end ?? null)) updateData.clip_end = clipEnd
      const clipZoom = clipZoomPercent(formData.clip_zoom)
      if (clipZoom !== clipZoomPercent(track.clip_zoom)) updateData.clip_zoom = clipZoom || null
      if (String(formData.danceability) !== String(track.danceability ?? '')) updateData.danceability = parseNumberField(formData.danceability)
      if (String(formData.energy) !== String(track.energy ?? '')) updateData.energy = parseNumberField(formData.energy)
      if (String(formData.track_key) !== String(track.track_key ?? '')) updateData.track_key = parseIntegerField(formData.track_key)
      if (String(formData.loudness) !== String(track.loudness ?? '')) updateData.loudness = parseNumberField(formData.loudness)
      if (String(formData.mode) !== String(track.mode ?? '')) updateData.mode = parseIntegerField(formData.mode)
      if (String(formData.speechiness) !== String(track.speechiness ?? '')) updateData.speechiness = parseNumberField(formData.speechiness)
      if (String(formData.acousticness) !== String(track.acousticness ?? '')) updateData.acousticness = parseNumberField(formData.acousticness)
      if (String(formData.instrumentalness) !== String(track.instrumentalness ?? '')) updateData.instrumentalness = parseNumberField(formData.instrumentalness)
      if (String(formData.liveness) !== String(track.liveness ?? '')) updateData.liveness = parseNumberField(formData.liveness)
      if (String(formData.valence) !== String(track.valence ?? '')) updateData.valence = parseNumberField(formData.valence)
      if (String(formData.tempo) !== String(track.tempo ?? '')) updateData.tempo = parseNumberField(formData.tempo)
      if (String(formData.time_signature) !== String(track.time_signature ?? '')) updateData.time_signature = parseIntegerField(formData.time_signature)
      
      const textChanged = lyrics.state === 'ready' && lyrics.text.trim() !== lyrics.original.trim()
      const syllableChanged = lyrics.state === 'ready' && lyrics.syllable.trim() !== lyrics.syllableOriginal.trim()
      const lyricsChanged = textChanged || syllableChanged
      let lyricsKind = null
      if (lyricsChanged) {
        // Edited syllables with the standard text untouched: the server
        // rewrites that text from them, the way "Insert into track" does.
        const written = await api.writeFileLyrics(
          track.id,
          textChanged || !syllableChanged ? lyrics.text : null,
          syllableChanged ? lyrics.syllable : undefined,
        )
        if (!written || written.ok === false) {
          setStatus({ type: 'error', message: t("Couldn't save the lyrics: {error}", { error: written?.error || '?' }) })
          setSaving(false)
          return
        }
        setLyrics(prev => ({ ...prev, original: prev.text, syllableOriginal: prev.syllable }))
        announceLyricsFileChanged(track.id)
        lyricsKind = written.lyricsKind ?? null
      }
      // The song list's Lyrics column follows what the file now holds.
      const withLyrics = (row) => (lyricsKind == null ? row : { ...row, lyrics_kind: lyricsKind })

      if (Object.keys(updateData).length === 0 && lyricsChanged) {
        const updatedTrack = withLyrics(track)
        syncTrack(updatedTrack)
        if (onSave) onSave(updatedTrack)
        setStatus({ type: 'success', message: t('Lyrics saved into the file') })
        setTimeout(() => onClose(), 1000)
      } else if (Object.keys(updateData).length > 0) {
        const result = await api.updateTrack(track.id, updateData)
        if (result?.error) {
          setStatus({ type: 'error', message: result.error })
        } else {
          const updatedTrack = withLyrics(result?.track || { ...track, ...updateData })
          syncTrack(updatedTrack)
          setStatus({ type: 'success', message: t('Track updated!') })
          if (onSave) onSave(updatedTrack)
          setTimeout(() => {
            onClose()
          }, 1000)
        }
      } else {
        setStatus({ type: 'success', message: t('No changes to save') })
        setTimeout(() => setStatus(null), 2000)
      }
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    }
    
    setSaving(false)
  }

  // Yandex Images for "Artist - Title", square pictures, in the default
  // browser. Slashes become commas: a link with them may not open.
  const searchCover = () => {
    const name = [formData.artist || track?.artist, formData.title || track?.title]
      .map(part => String(part || '').trim()).filter(Boolean).join(' - ').replace(/[\\/]+/g, ',')
    if (!name) return
    api.openExternal(`https://yandex.ru/images/search?text=${encodeURIComponent(name)}&iorient=square`)
  }

  // The cover into the computer's Downloads, named after the song's tags.
  const downloadCover = async () => {
    if (!track?.id) return
    const base = [track.artist, track.title].map(part => String(part || '').trim().replace(/[\\/]+/g, ',')).filter(Boolean).join(' - ')
    try {
      const result = await api.trackSaveCover(track.id, `${base || 'Cover'} - Album Art.jpg`)
      const name = result?.path ? String(result.path).split(/[\\/]/).pop() : null
      setStatus({ type: 'success', message: name ? t('Saved to Downloads: {name}', { name }) : t('Cover downloaded') })
      setTimeout(() => setStatus(null), 3000)
    } catch (e) {
      setStatus({ type: 'error', message: coverError(e) })
    }
  }

  const field = 'w-full bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50'
  const small = 'w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-accent/50'
  const label = 'text-[10px] font-display text-muted uppercase tracking-widest block mb-1'
  const showLyrics = lyrics.state !== 'none'
  const audioFields = [
    ['danceability', 'Danceability', '0.522'], ['energy', 'Energy', '0.992'], ['track_key', 'Key', '0'], ['loudness', 'Loudness', '-3.076'],
    ['mode', 'Mode', '1'], ['speechiness', 'Speechiness', '0.173'], ['acousticness', 'Acousticness', '0.0631'], ['instrumentalness', 'Instrumentalness', '0.743'],
    ['liveness', 'Liveness', '0.0724'], ['valence', 'Valence', '0.701'], ['tempo', 'Tempo', '73.528'], ['time_signature', 'Time Signature', '4'],
  ]

  // Lyrics on the left, tags on the right; Close and Save stay at the bottom
  // whatever is scrolled.
  return (
    <Modal open={open} onClose={onClose} title={t('Edit Track')} width={showLyrics ? 'max-w-6xl' : 'max-w-2xl'} clearBackdrop>
      <div className="flex h-[min(calc(46rem+50px),calc(100vh-8rem))] flex-col gap-3">
        <div className={`grid min-h-0 flex-1 gap-4 ${showLyrics ? 'grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : 'grid-cols-1'}`}>
          {showLyrics && (
            <div className="flex min-h-0 flex-col">
              <div className="mb-1 flex items-center justify-between">
                <label className={`${label} mb-0`}>{t('Lyrics')}</label>
                {lyrics.state === 'ready' && lyrics.syllableOriginal ? (
                  <div className="flex rounded-lg border border-border bg-card p-0.5 text-[11px]">
                    {[['syllable', t('By syllable')], ['plain', t('In the lyrics tag')]].map(([mode, name]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setLyrics(prev => ({ ...prev, mode }))}
                        className={`rounded-md px-2 py-0.5 transition-colors ${lyrics.mode === mode ? 'bg-accent/20 text-white' : 'text-muted hover:text-white'}`}
                      >{name}</button>
                    ))}
                  </div>
                ) : lyrics.state === 'ready' && lyrics.text.trim() && (
                  <span className="text-[11px] text-muted">{LRC_STAMP.test(lyrics.text) ? t('Synced (LRC)') : t('Not synced')}</span>
                )}
              </div>
              {lyrics.state === 'loading' ? (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-card text-muted"><RefreshCw size={16} className="animate-spin" /></div>
              ) : lyrics.state === 'error' ? (
                <p className="text-xs text-red-400">{t("Couldn't read the lyrics from the file")}{lyrics.error ? `: ${lyrics.error}` : ''}</p>
              ) : (
                <textarea
                  key={lyrics.mode}
                  value={lyrics.mode === 'syllable' ? lyrics.syllable : lyrics.text}
                  onChange={(e) => {
                    const value = e.target.value
                    setLyrics(prev => (prev.mode === 'syllable' ? { ...prev, syllable: value } : { ...prev, text: value }))
                  }}
                  spellCheck={false}
                  className="min-h-0 w-full flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs leading-relaxed text-white outline-none focus:border-accent/50"
                  placeholder={lyrics.mode === 'syllable' ? '[00:12.300]<00:12.300>Сло<00:12.610>ва<00:13.020>' : t('[00:12.30] A synced line, or plain text')}
                />
              )}
              <p className="mt-1 text-[11px] leading-snug text-muted">{lyrics.mode === 'syllable'
                ? t("Lokal's own tag with word and syllable timings: <mm:ss.xxx> before each syllable, a space after a word. Edited here and left alone in the other mode, the lyrics tag is rewritten from these lines on save.")
                : t('Saved into the file itself: text with [mm:ss.xx] time stamps goes into both lyrics tags (USLT and SYLT), plain text into the lyrics field.')}</p>
              {lyrics.sidecar && (
                <p className="mt-1 text-[11px] text-orange-400">{t('A lyrics file next to the song ({file}) is shown instead of these.', { file: lyrics.sidecar.split(/[\\/]/).pop() })}</p>
              )}
            </div>
          )}

          <div className="min-h-0 space-y-2.5 overflow-y-auto pr-1">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div {...coverDrop.dropProps} className={`group relative h-24 w-24 overflow-hidden rounded-lg border bg-card ${coverDrop.over ? 'border-accent ring-2 ring-accent' : 'border-border'}`}>
                  {artworkPreview ? (
                    <img src={artworkPreview} alt={t('Artwork')} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted"><Camera size={26} /></div>
                  )}
                  <button onClick={handleSelectArtwork} disabled={saving} aria-label={t('Replace artwork')} title={t('Replace artwork')}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera size={20} className="text-white" />
                  </button>
                  {coverDrop.over && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-[10px] text-white">
                      <ImagePlus size={18} />{t('Drop cover')}
                    </div>
                  )}
                </div>
                <button onClick={searchCover} disabled={!(formData.title || formData.artist)} title={t('Search for the cover on Yandex Images')}
                  className="mt-1.5 flex w-24 items-center justify-center gap-1 rounded-lg border border-border bg-card py-1 text-[11px] text-muted transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-50">
                  <Search size={11} />
                  {t('Find cover')}
                </button>
                <button onClick={downloadCover} disabled={!artworkPreview} title={t('Save the cover to Downloads')}
                  className="mt-1.5 flex w-24 items-center justify-center gap-1 rounded-lg border border-border bg-card py-1 text-[11px] text-muted transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-50">
                  <Download size={11} />
                  {t('Download cover')}
                </button>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <label className={label}>{t('Title')}</label>
                  <input value={formData.title} onChange={(e) => handleChange('title', e.target.value)} className={field} placeholder={t('Track title')} />
                </div>
                <div>
                  <label className={label}>{t('Artist')}</label>
                  <input value={formData.artist} onChange={(e) => handleChange('artist', e.target.value)} className={field} placeholder={t('Artist name')} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={label}>{t('Album')}</label>
                <input value={formData.album} onChange={(e) => handleChange('album', e.target.value)} className={field} placeholder={t('Album name')} />
              </div>
              <div>
                <label className={label}>{t('Album Artist')}</label>
                <input value={formData.album_artist} onChange={(e) => handleChange('album_artist', e.target.value)} className={field} placeholder={t('Album artist (if different)')} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className={label}>{t('Track #')}</label>
                <input type="number" min="1" value={formData.track_num} onChange={(e) => handleChange('track_num', e.target.value)} className={field} placeholder="1" />
              </div>
              <div>
                <label className={label}>{t('Year')}</label>
                <input type="number" min="1900" max="2100" value={formData.year} onChange={(e) => handleChange('year', e.target.value)} className={field} placeholder="2024" />
              </div>
              <div>
                <label className={label}>{t('Record Label')}</label>
                <input value={formData.record_label} onChange={(e) => handleChange('record_label', e.target.value)} className={field} placeholder={t('Label')} />
              </div>
            </div>

            <div>
              <label className={label}>{t('Genres')}</label>
              <GenreChips compact value={Array.isArray(formData.genres) ? formData.genres : []} onChange={(list) => handleChange('genres', list)} suggestions={genreOptions} />
            </div>

            <div>
              <label className={label}>{t('Comment')}</label>
              <textarea value={formData.comment} onChange={(e) => handleChange('comment', e.target.value)} rows={2} className={`${field} resize-y`} />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2" title={t('Show the track with the explicit badge.')}>
              <input type="checkbox" checked={formData.explicit} onChange={(e) => handleChange('explicit', e.target.checked)} className="rounded border-border bg-card text-accent focus:ring-accent/40" />
              <span className="text-sm text-white">{t('Explicit')}</span>
            </label>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className={label}>{t('Music video')}</label>
                <ClipAvailability link={formData.clip_url} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2">
                <input value={formData.clip_url} onChange={(e) => handleChange('clip_url', e.target.value)} className={field} placeholder={t('A link to the video, or a video file')} spellCheck={false} />
                <input inputMode="numeric" value={formData.clip_start} onChange={(e) => handleChange('clip_start', clipTimeInput(e.target.value))} className={field}
                  placeholder={t('Start')} title={t('Where the loop starts: seconds or minutes:seconds')} aria-label={t('Where the loop starts: seconds or minutes:seconds')} />
                <input inputMode="numeric" value={formData.clip_end} onChange={(e) => handleChange('clip_end', clipTimeInput(e.target.value))} className={field}
                  placeholder={t('End')} title={t('Where the loop ends: seconds or minutes:seconds')} aria-label={t('Where the loop ends: seconds or minutes:seconds')} />
              </div>
              {/* How far it's zoomed in, in the side panel: a slider and the same number typed. */}
              <div className="mt-2 flex items-center gap-3" title={t('How far the video is zoomed in, in the side panel')}>
                <span className="flex-shrink-0 text-xs text-muted">{t('Zoom')}</span>
                <input type="range" min={0} max={CLIP_ZOOM_MAX} step={1} value={formData.clip_zoom}
                  onChange={(e) => handleChange('clip_zoom', clipZoomPercent(e.target.value))}
                  aria-label={t('How far the video is zoomed in, in the side panel')}
                  className="min-w-0 flex-1 accent-accent" />
                <div className="flex flex-shrink-0 items-center gap-1">
                  <input inputMode="numeric" value={formData.clip_zoom}
                    onChange={(e) => handleChange('clip_zoom', clipZoomPercent(e.target.value.replace(/[^0-9]/g, '') || 0))}
                    aria-label={t('How far the video is zoomed in, in the side panel')}
                    className={`${field} w-14 text-center`} />
                  <span className="text-xs text-muted">%</span>
                </div>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">{t('A link to the video (YouTube or any site with videos) or the path of a video file. It loops, muted, in the side panel’s Visualization + Lyrics tab instead of the canvas: between the two times (75 or 1:15), 10 seconds from the start time when only that is set, or the whole video when neither is.')}</p>
            </div>

            <details className="rounded-lg border border-border bg-card/70 px-3 py-2">
              <summary className="cursor-pointer text-[10px] font-display uppercase tracking-widest text-muted">{t('Imported Audio Data')}</summary>
              <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-4">
                {audioFields.map(([key, name, placeholder]) => (
                  <div key={key}>
                    <label className="mb-0.5 block text-[10px] uppercase tracking-widest text-muted">{t(name)}</label>
                    <input value={formData[key]} onChange={(e) => handleChange(key, e.target.value)} className={small} placeholder={placeholder} />
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>

        <AnimatePresence>
          {status && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                status.type === 'success' ? 'bg-accent/20 text-accent' :
                status.type === 'error' ? 'bg-red-500/20 text-red-400' :
                'bg-card text-muted'
              }`}
            >
              {status.type === 'success' && <Check size={15} />}
              {status.type === 'error' && <AlertCircle size={15} />}
              {status.type === 'loading' && <RefreshCw size={15} className="animate-spin" />}
              <span className="text-sm">{status.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-shrink-0 gap-3">
          <button onClick={onClose}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/80 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500">
            <X size={16} /> {t('Close')}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {t('Save')}
          </button>
        </div>
      </div>
      {coverDrop.dialog}
    </Modal>
  )
}
