import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Camera, Save, RefreshCw, Check, AlertCircle, Search, ImagePlus, Download, Copy, ScanSearch, Maximize2, Minimize2, TextCursorInput } from 'lucide-react'
import { api } from '../api'
import Modal from './Modal'
import GenreChips from './GenreChips'
import { trackGenreList, genreKey } from '../genres'
import { usePlayerStore } from '../store/player'
import { useTranslation } from '../i18n'
import { announceLyricsFileChanged } from '../lyricLine'
import { clearLyricsPreview, showLyricsPreview, useLyricsPreview } from '../lyricsPreview'
import { setResumePosition } from '../cast/useCastPlayback'
import { songTime } from '../musicVideo'
import { announceTrackChanged } from '../trackChanged'
import { useCoverDrop, coverError } from './CoverDrop'
import ClipAvailability from './ClipAvailability'
import LyricsTextArea from './LyricsTextArea'
import MotionCoverMarks from './MotionCoverMarks'
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

/**
 * Beside "Check lyrics": the song's playing position as a lyrics time stamp,
 * read from the audio element every frame; a click copies it, to paste into
 * the lyrics. Syllable lyrics time to the millisecond (mm:ss.xxx), the lyrics
 * tag to the hundredth (mm:ss.xx). Beside it, a button puts the stamp in the
 * lyrics where the text cursor is (onInsert): <mm:ss.xxx> for a syllable,
 * [mm:ss.xx] for a line. Shown while this song is the one playing.
 */
function PlayheadStamp({ trackId, digits = 3, onInsert }) {
  const { t } = useTranslation()
  const current = usePlayerStore(s => trackId != null && s.currentTrack?.id === trackId)
  const textRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!current) return undefined
    let frame = 0
    const tick = () => {
      if (textRef.current) textRef.current.textContent = stampOf(songTime(), digits)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [current, digits])
  if (!current) return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(stampOf(songTime(), digits)) } catch { return }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }
  return (
    <>
    <button type="button" onClick={copy} title={t('Copy the playing time as a time stamp')} aria-label={t('Copy the playing time as a time stamp')}
      className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[12px] tabular-nums transition-colors ${copied ? 'border-accent/50 text-accent' : 'border-border bg-card text-white hover:border-accent/30'}`}>
      <span ref={textRef} />
      {copied ? <Check size={11} /> : <Copy size={11} className="text-muted" />}
    </button>
    {onInsert && (
      <button type="button" onClick={() => onInsert(stampOf(songTime(), digits))}
        title={t('Insert the playing time at the text cursor')} aria-label={t('Insert the playing time at the text cursor')}
        className={TOOL}>
        <TextCursorInput size={13} /> {t('Insert time')}
      </button>
    )}
    </>
  )
}

// A line's own time stamp at its start, [mm:ss.xx].
const LINE_STAMP = /^\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/

// The buttons over the lyrics: one height, never wrapping their words.
const TOOL = 'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 text-[12px] text-muted transition-colors hover:text-white disabled:opacity-50'

/** Seconds -> "mm:ss.xxx" (or "mm:ss.xx" with digits 2), like the lyrics' time stamps. */
function stampOf(seconds, digits = 3) {
  const unit = 10 ** digits
  const n = Math.max(0, Math.round((Number(seconds) || 0) * unit))
  const m = Math.floor(n / (60 * unit))
  const s = Math.floor((n % (60 * unit)) / unit)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(n % unit).padStart(digits, '0')}`
}

/**
 * The song's file name at the foot of the tags: not editable, a click copies it
 * (it's what "Lokal.exe play_track <name>" can be given).
 */
function FileNameRow({ filePath }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const name = String(filePath).split(/[\\/]/).pop()
  const copy = async () => {
    try { await navigator.clipboard.writeText(name) } catch { return }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div>
      <label className="text-[10px] font-display text-muted uppercase tracking-widest block mb-1">{t('File name')}</label>
      <button type="button" onClick={copy} title={t('Click to copy')}
        className="group flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-left transition-colors hover:border-accent/30">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/80 select-text" title={name}>{name}</span>
        <span className={`flex flex-shrink-0 items-center gap-1 text-[11px] ${copied ? 'text-accent' : 'text-muted group-hover:text-white'}`}>
          {copied ? <><Check size={12} /> {t('Copied')}</> : <Copy size={12} />}
        </span>
      </button>
    </div>
  )
}

const WIDE_KEY = 'lokal-edit-track-lyrics-wide'

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
    highlight_time: '',
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

  // "Check lyrics": the field's text, as it is now, shown in the side panel's
  // lyrics while the song plays (from `at` seconds, a line's play button) --
  // nothing is saved; Save writes it into the file.
  const [checking, setChecking] = useState(false)
  const lyricsInput = useRef(null)
  // After a stamp is put in: where the text cursor goes and where the field
  // was scrolled (a new value would otherwise send it back to the top).
  const afterStamp = useRef(null)
  // Puts a time stamp in the lyrics. Syllable lyrics: <stamp> where the text
  // cursor is (over any selection). The lyrics tag: [stamp] at the start of
  // the cursor's line, in place of the one already there.
  const insertStamp = (stamp) => {
    const area = lyricsInput.current
    if (!area) return
    const { selectionStart: from, selectionEnd: to, value, scrollTop, scrollLeft } = area
    let next, caret
    if (lyrics.mode === 'syllable') {
      const piece = `<${stamp}>`
      next = value.slice(0, from) + piece + value.slice(to)
      caret = from + piece.length
    } else {
      const piece = `[${stamp}]`
      const start = value.lastIndexOf('\n', from - 1) + 1
      const old = LINE_STAMP.exec(value.slice(start))
      next = value.slice(0, start) + piece + value.slice(start + (old ? old[0].length : 0))
      caret = start + piece.length
    }
    afterStamp.current = { caret, scrollTop, scrollLeft }
    setLyrics(prev => (prev.mode === 'syllable' ? { ...prev, syllable: next } : { ...prev, text: next }))
  }
  useLayoutEffect(() => {
    const area = lyricsInput.current
    const after = afterStamp.current
    if (!area || !after) return
    afterStamp.current = null
    area.focus({ preventScroll: true })
    area.setSelectionRange(after.caret, after.caret)
    area.scrollTop = after.scrollTop
    area.scrollLeft = after.scrollLeft
  }, [lyrics])
  // Where this song is playing (seconds), for the lyrics field's red marks; null when another plays.
  const playhead = usePlayerStore(s => (track?.id != null && s.currentTrack?.id === track.id ? s.progress : null))
  // Lyrics across the whole dialog (the tags hidden): remembered for next time.
  const [wide, setWideState] = useState(() => { try { return localStorage.getItem(WIDE_KEY) === '1' } catch { return false } })
  const setWide = (on) => { setWideState(on); try { localStorage.setItem(WIDE_KEY, on ? '1' : '0') } catch {} }
  const checkLyrics = async (at = null) => {
    if (!track?.id || checking) return
    const text = lyrics.mode === 'syllable' ? lyrics.syllable : lyrics.text
    if (!text.trim()) { setStatus({ type: 'error', message: t('There are no lyrics to check') }); return }
    setChecking(true)
    try {
      const parsed = await api.parseLyrics(text).catch(() => null)
      if (!parsed?.lines?.length) { setStatus({ type: 'error', message: t("Couldn't read these lyrics") }); return }
      showLyricsPreview(track.id, { ...parsed, source: 'edited', preview: true, editor: true })
      const player = usePlayerStore.getState()
      if (player.currentTrack?.id !== track.id) {
        if (at != null) setResumePosition(track.id, at)
        player.playTrack(track, [track])
      } else {
        if (at != null) player.setProgressWithAudioUpdate(at)
        if (!player.isPlaying) player.togglePlay()
      }
      // Always the side panel's Lyrics tab.
      usePlayerStore.setState({ showRightSidebar: true, sidePanelView: 'lyrics' })
    } finally { setChecking(false) }
  }
  // Closed (or saved, below): the side panel goes back to the song's own lyrics.
  const endCheck = () => {
    const preview = useLyricsPreview.getState()
    if (preview.result?.editor) clearLyricsPreview([preview.trackId])
  }
  useEffect(() => { if (!open) endCheck() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // While it's open a song that ends just stops: no next song under the editor.
  useEffect(() => {
    if (!open) return undefined
    usePlayerStore.setState({ holdAtEnd: true })
    return () => usePlayerStore.setState({ holdAtEnd: false })
  }, [open])

  // Whether the song has a Spotify Canvas, and where the moving cover it played
  // with came from, as its row has them now (written when it played, or by
  // Clip Search); not known: no mark.
  const [coverInfo, setCoverInfo] = useState(null)
  useEffect(() => {
    setCoverInfo(null)
    if (!open || !track?.id) return undefined
    let active = true
    api.motionCoverInfo(track.id).then((info) => { if (active) setCoverInfo(info || null) })
    return () => { active = false }
  }, [open, track?.id])

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
        highlight_time: formatClipTime(track.highlight_time),
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
      if ((formData.album || null) !== (track.album || null)) updateData.album = formData.album || null
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
        setStatus({ type: 'error', message: t('Loop times are seconds or minutes:seconds, like 75, 1:15 or 0:11.5') })
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
      // The important moment: typed like the loop times; marked on the seek bar.
      const highlight = parseClipTime(formData.highlight_time)
      if (Number.isNaN(highlight)) {
        setStatus({ type: 'error', message: t('The important moment is seconds, minutes:seconds or hours:minutes:seconds, like 75, 1:15 or 0:11.5') })
        setSaving(false)
        return
      }
      if (highlight !== (track.highlight_time ?? null)) updateData.highlight_time = highlight
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
        // Edited syllables: the server rewrites the standard text from them
        // (one stamp a line), the way "Insert into track" does -- unless they
        // were cleared, when the standard text is kept as it stands.
        const fromSyllables = syllableChanged && lyrics.syllable.trim()
        const written = await api.writeFileLyrics(
          track.id,
          fromSyllables ? null : lyrics.text,
          syllableChanged ? lyrics.syllable : undefined,
        )
        if (!written || written.ok === false) {
          setStatus({ type: 'error', message: t("Couldn't save the lyrics: {error}", { error: written?.error || '?' }) })
          setSaving(false)
          return
        }
        // What went into the file: the standard text rebuilt from the
        // syllables, pasted JSON turned into syllable lines.
        setLyrics(prev => {
          const text = typeof written.text === 'string' ? written.text : prev.text
          const syllable = typeof written.syllable === 'string' ? written.syllable : prev.syllable
          return { ...prev, text, original: text, syllable, syllableOriginal: syllable }
        })
        endCheck()
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
  // The lyrics across the whole dialog, the tags hidden (kept mounted).
  const lyricsWide = showLyrics && wide
  const audioFields = [
    ['danceability', 'Danceability', '0.522'], ['energy', 'Energy', '0.992'], ['track_key', 'Key', '0'], ['loudness', 'Loudness', '-3.076'],
    ['mode', 'Mode', '1'], ['speechiness', 'Speechiness', '0.173'], ['acousticness', 'Acousticness', '0.0631'], ['instrumentalness', 'Instrumentalness', '0.743'],
    ['liveness', 'Liveness', '0.0724'], ['valence', 'Valence', '0.701'], ['tempo', 'Tempo', '73.528'], ['time_signature', 'Time Signature', '4'],
  ]

  // Lyrics on the left, tags on the right; Close and Save stay at the bottom
  // whatever is scrolled.
  return (
    // Docked over the left menu and the page: the player bar's play/pause and
    // seek bar, and the side panel's lyrics, stay usable while editing.
    <Modal open={open} onClose={onClose} title={t('Edit Track')} dock>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className={`grid min-h-0 flex-1 gap-4 ${showLyrics && !lyricsWide ? 'grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : 'grid-cols-1'}`}>
          {showLyrics && (
            <div className="flex min-h-0 flex-col">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => setWide(!wide)} aria-pressed={wide}
                    title={wide ? t('Show the tags beside the lyrics') : t('Lyrics across the whole window')} aria-label={wide ? t('Show the tags beside the lyrics') : t('Lyrics across the whole window')}
                    className={`${TOOL} w-7 justify-center px-0`}>
                    {wide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>
                  {lyrics.state === 'ready' && (
                    <button type="button" onClick={() => checkLyrics()} disabled={checking}
                      title={t('Plays the song with these lyrics in the side panel, without saving them')}
                      className={TOOL}>
                      {checking ? <RefreshCw size={13} className="animate-spin" /> : <ScanSearch size={13} />}
                      {t('Check lyrics')}
                    </button>
                  )}
                  <PlayheadStamp trackId={track?.id} digits={lyrics.mode === 'syllable' ? 3 : 2}
                    onInsert={lyrics.state === 'ready' ? insertStamp : undefined} />
                </div>
                {/* Both tabs always: syllables can be added to a song that has none. */}
                {lyrics.state === 'ready' && (
                  <div className="ml-auto flex items-center">
                    <div className="flex h-7 rounded-lg border border-border bg-card p-0.5 text-[12px]">
                      {[['syllable', t('By syllable')], ['plain', t('In the lyrics tag')]].map(([mode, name]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setLyrics(prev => ({ ...prev, mode }))}
                          className={`whitespace-nowrap rounded-md px-2.5 transition-colors ${lyrics.mode === mode ? 'bg-accent/20 text-white' : 'text-muted hover:text-white'}`}
                        >{name}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {lyrics.state === 'loading' ? (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-card text-muted"><RefreshCw size={16} className="animate-spin" /></div>
              ) : lyrics.state === 'error' ? (
                <p className="text-xs text-red-400">{t("Couldn't read the lyrics from the file")}{lyrics.error ? `: ${lyrics.error}` : ''}</p>
              ) : (
                <LyricsTextArea
                  key={lyrics.mode}
                  value={lyrics.mode === 'syllable' ? lyrics.syllable : lyrics.text}
                  onChange={(e) => {
                    const value = e.target.value
                    setLyrics(prev => (prev.mode === 'syllable' ? { ...prev, syllable: value } : { ...prev, text: value }))
                  }}
                  placeholder={lyrics.mode === 'syllable' ? '[00:12.300]<00:12.300>Сло<00:12.610>ва<00:13.020>' : t('[00:12.30] A synced line, or plain text')}
                  onPlayLine={(time) => checkLyrics(time)}
                  playhead={playhead}
                  playLabel={t('Check the lyrics from this line')}
                  textareaRef={lyricsInput}
                />
              )}
              <p className="mt-1 text-[11px] leading-snug text-muted">
                {lyrics.mode === 'plain' && lyrics.text.trim() && (
                  <span className="mr-1.5 text-white/70">{LRC_STAMP.test(lyrics.text) ? t('Synced (LRC)') : t('Not synced')} ·</span>
                )}
                {lyrics.mode === 'syllable'
                ? t("Lokal's own tag with word and syllable timings: <mm:ss.xxx> before each syllable, a space after a word. Word-timed JSON (WhisperX: words with start and end) can be pasted too. When these change, the lyrics tag is rewritten from them on save.")
                : t('Saved into the file itself: text with [mm:ss.xx] time stamps goes into both lyrics tags (USLT and SYLT), plain text into the lyrics field.')}</p>
              {lyrics.sidecar && (
                <p className="mt-1 text-[11px] text-orange-400">{t('A lyrics file next to the song ({file}) is shown instead of these.', { file: lyrics.sidecar.split(/[\\/]/).pop() })}</p>
              )}
            </div>
          )}

          <div className={`min-h-0 space-y-2.5 overflow-y-auto pr-1 ${lyricsWide ? 'hidden' : ''}`}>
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div {...coverDrop.dropProps} className={`group relative h-28 w-28 overflow-hidden rounded-lg border bg-card ${coverDrop.over ? 'border-accent ring-2 ring-accent' : 'border-border'}`}>
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
                {/* The cover's buttons: the icon over its name, centred. */}
                {[
                  { onClick: searchCover, disabled: !(formData.title || formData.artist), title: t('Search for the cover on Yandex Images'), Icon: Search, text: t('Find cover') },
                  { onClick: downloadCover, disabled: !artworkPreview, title: t('Save the cover to Downloads'), Icon: Download, text: t('Download cover') },
                ].map(({ onClick, disabled, title, Icon, text }) => (
                  <button key={text} type="button" onClick={onClick} disabled={disabled} title={title}
                    className="mt-1.5 flex w-28 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-center text-[11px] leading-tight text-muted transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-50">
                    <Icon size={13} className="flex-shrink-0" />
                    <span>{text}</span>
                  </button>
                ))}
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
                <div>
                  <label className={label}>{t('Album')}</label>
                  <input value={formData.album} onChange={(e) => handleChange('album', e.target.value)} className={field} placeholder={t('Album name')} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className={label}>{t('Track #')}</label>
                <input type="number" min="1" value={formData.track_num} onChange={(e) => handleChange('track_num', e.target.value)} className={field} placeholder="1" />
              </div>
              <div>
                <label className={label}>{t('Year')}</label>
                <input type="number" min="1900" max="2100" value={formData.year} onChange={(e) => handleChange('year', e.target.value)} className={field} placeholder={t('Enter the year')} />
              </div>
              <div>
                <span className={label} aria-hidden>&nbsp;</span>
                <label className={`${field} flex cursor-pointer items-center gap-2.5`} title={t('Show the track with the explicit badge.')}>
                  <input type="checkbox" checked={formData.explicit} onChange={(e) => handleChange('explicit', e.target.checked)} />
                  <span className="text-sm text-white">{t('Explicit')}</span>
                </label>
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

            {/* A moment of the song worth finding: a small mark on the player bar's seek bar. */}
            <div className="flex items-center gap-3">
              <label htmlFor="track-edit-highlight" className={`${label} mb-0 whitespace-nowrap`}>{t('Important moment of the track')}</label>
              {/* As wide as the music video's Start and End fields. */}
              <input id="track-edit-highlight" inputMode="decimal" value={formData.highlight_time} onChange={(e) => handleChange('highlight_time', clipTimeInput(e.target.value))}
                className={`${field.replace('w-full', 'w-[5.5rem]')} flex-shrink-0 ${Number.isNaN(parseClipTime(formData.highlight_time)) ? 'border-red-400/70' : ''}`} placeholder="1:15"
                title={`${t('Shown as a small mark on the seek bar.')} ${t('Seconds, minutes:seconds or hours:minutes:seconds; a dot for fractions of a second')}`} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <label className={label}>{t('Music video')}</label>
                  {/* Its Spotify Canvas and moving cover, as written on its row (nothing is looked up here). */}
                  <MotionCoverMarks spotify={coverInfo?.spotify === true} source={coverInfo?.source} size={12} className="mb-1" />
                </div>
                <ClipAvailability link={formData.clip_url} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2">
                <input value={formData.clip_url} onChange={(e) => handleChange('clip_url', e.target.value)} className={field} placeholder={t('A link to the video, or a video file')} spellCheck={false} />
                <input inputMode="decimal" value={formData.clip_start} onChange={(e) => handleChange('clip_start', clipTimeInput(e.target.value))} className={field}
                  placeholder={t('Start')} title={t('Where the loop starts: seconds or minutes:seconds')} aria-label={t('Where the loop starts: seconds or minutes:seconds')} />
                <input inputMode="decimal" value={formData.clip_end} onChange={(e) => handleChange('clip_end', clipTimeInput(e.target.value))} className={field}
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

            {/* Less often changed: the album artist and the record label, last. */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={label}>{t('Album Artist')}</label>
                <input value={formData.album_artist} onChange={(e) => handleChange('album_artist', e.target.value)} className={field} placeholder={t('Album artist (if different)')} />
              </div>
              <div>
                <label className={label}>{t('Record Label')}</label>
                <input value={formData.record_label} onChange={(e) => handleChange('record_label', e.target.value)} className={field} placeholder={t('Label')} />
              </div>
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

            {hasLocalFile(track) && <FileNameRow filePath={track.file_path} />}
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

        <div className="flex flex-shrink-0 justify-end gap-2">
          <button onClick={onClose}
            className="flex w-36 items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/80 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-500">
            <X size={14} /> {t('Close')}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex w-36 items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[13px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {t('Save')}
          </button>
        </div>
      </div>
      {coverDrop.dialog}
    </Modal>
  )
}
