// The quick player window (electron/quick/main.js): one audio file from the
// computer -- its cover, its tags, what it is -- playing at once, with
// play/pause, the files next to it in its folder, and a fine seek bar.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Minus, Music, Pause, Pin, PinOff, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import SeekBar, { formatTime } from './SeekBar'
import { startFile, t } from './strings'

const quick = window.quick

/** C:\Music\a b.mp3 -> file:///C:/Music/a%20b.mp3 (as src/api.js electronFileURL). */
function fileURL(filePath) {
  const encoded = String(filePath).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':')
  if (encoded.startsWith('//')) return `file:${encoded}`
  return /^[A-Za-z]:/.test(encoded) ? `file:///${encoded}` : `file://${encoded}`
}

const baseName = (filePath) => String(filePath).split(/[\\/]/).pop() || ''
const withoutExtension = (name) => name.replace(/\.[^.]+$/, '')

function readVolume() {
  try {
    const saved = Number(localStorage.getItem('quick-volume'))
    return Number.isFinite(saved) && localStorage.getItem('quick-volume') !== null ? Math.max(0, Math.min(1, saved)) : 1
  } catch { return 1 }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return null
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const ofTotal = (n, total) => (n ? (total ? t('{n} of {total}', { n, total }) : String(n)) : null)

function Row({ label, value, onClick, title }) {
  if (value == null || value === '') return null
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      {onClick
        ? <button type="button" className="row-value link" onClick={onClick} title={title}>{value}</button>
        : <span className="row-value" title={typeof value === 'string' ? value : undefined}>{value}</span>}
    </div>
  )
}

export default function QuickPlayer() {
  const audioRef = useRef(null)
  const [file, setFile] = useState(startFile)
  const [info, setInfo] = useState(null)
  const [cover, setCover] = useState(null)
  const [folder, setFolder] = useState({ list: [], index: -1 })
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(readVolume)
  const [muted, setMuted] = useState(false)
  const [pinned, setPinned] = useState(false)
  // null, 'converting', or an error's text.
  const [status, setStatus] = useState(null)
  const converted = useRef(false)
  const fileRef = useRef(file)
  fileRef.current = file

  // A file: its sound at once, its tags and cover as they're read.
  useEffect(() => {
    if (!file) return undefined
    let current = true
    converted.current = false
    setInfo(null)
    setCover(null)
    setStatus(null)
    setDuration(0)
    const audio = audioRef.current
    audio.src = fileURL(file)
    audio.play().catch(() => {})
    quick.info(file).then(result => {
      if (!current) return
      setInfo(result)
      if (result?.error === 'missing') setStatus(t("The file isn't there any more."))
    })
    quick.cover(file).then(src => { if (current) setCover(src || null) })
    quick.siblings(file).then(result => { if (current) setFolder(result || { list: [], index: -1 }) })
    return () => { current = false }
  }, [file])

  const tags = info?.tags || {}
  const format = info?.format || {}
  const name = baseName(file)
  const title = tags.title || withoutExtension(name)
  useEffect(() => { document.title = tags.artist ? `${tags.artist} — ${title}` : title }, [tags.artist, title])

  useEffect(() => {
    const audio = audioRef.current
    audio.volume = volume
    audio.muted = muted
    try { localStorage.setItem('quick-volume', String(volume)) } catch {}
  }, [volume, muted])

  // Another quick window started playing: this one stops.
  useEffect(() => quick.onPause(() => audioRef.current?.pause()), [])

  // Chromium can't play it (ALAC, WMA, APE, AIFF...): a copy made with ffmpeg, once.
  const onError = useCallback(async () => {
    const audio = audioRef.current
    if (!file || converted.current || !audio.src.startsWith('file:')) {
      if (converted.current) setStatus(t("This file couldn't be played, even after conversion."))
      return
    }
    converted.current = true
    setStatus('converting')
    const result = await quick.playable(file)
    // Another file opened meanwhile.
    if (fileRef.current !== file) return
    if (result?.path) {
      setStatus(null)
      audio.src = fileURL(result.path)
      audio.play().catch(() => {})
    } else {
      setStatus(result?.error === 'no-ffmpeg'
        ? t("This format plays through ffmpeg, and it wasn't found. Download it in Lokal: Settings → External Tools.")
        : result?.error === 'missing' ? t("The file isn't there any more.") : t("This file couldn't be played, even after conversion."))
    }
  }, [file])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0
      audio.play().catch(() => {})
    } else audio.pause()
  }, [])

  const seek = useCallback((time) => {
    const audio = audioRef.current
    if (!Number.isFinite(time)) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || duration || 0, time))
  }, [duration])

  // The mouse wheel: up a second on, down a second back; with Shift a
  // millisecond. Steps add up from where the last one went (the time read
  // back right after a seek can lag), until the wheel rests.
  const wheel = useRef({ target: 0, at: 0 })
  const onWheel = useCallback((event) => {
    const audio = audioRef.current
    // Windows turns Shift + wheel into a sideways scroll.
    const delta = event.deltaY || event.deltaX
    if (!delta || !(audio.duration > 0)) return
    const by = (delta < 0 ? 1 : -1) * (event.shiftKey ? 0.001 : 1)
    const now = performance.now()
    const from = now - wheel.current.at < 400 ? wheel.current.target : audio.currentTime
    const target = Math.max(0, Math.min(audio.duration, from + by))
    wheel.current = { target, at: now }
    audio.currentTime = target
  }, [])

  const step = useCallback((by) => {
    const next = folder.list[folder.index + by]
    if (next) {
      setFile(next)
      setFolder(prev => ({ ...prev, index: prev.index + by }))
    }
  }, [folder])

  // Space: play/pause; arrows: seek; PageUp/PageDown: the next file; Esc: close.
  useEffect(() => {
    const onKey = (event) => {
      if (event.target instanceof HTMLInputElement) return
      const audio = audioRef.current
      if (event.code === 'Space') { event.preventDefault(); toggle() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const by = event.ctrlKey ? 0.1 : event.shiftKey ? 1 : 5
        seek(audio.currentTime + (event.key === 'ArrowLeft' ? -by : by))
      } else if (event.key === 'PageUp') { event.preventDefault(); step(-1) }
      else if (event.key === 'PageDown') { event.preventDefault(); step(1) }
      else if (event.key === 'Escape') quick.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seek, step])

  // An audio file dropped on the window plays here.
  useEffect(() => {
    const over = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
    const drop = (event) => {
      event.preventDefault()
      const dropped = event.dataTransfer.files?.[0]
      const path = dropped && quick.pathForFile(dropped)
      if (path) setFile(path)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])

  const togglePin = async () => setPinned(await quick.setPinned(!pinned))

  const channels = format.channels === 1 ? t('Mono') : format.channels === 2 ? t('Stereo') : format.channels ? String(format.channels) : null
  const codec = [format.codec, format.container && format.container !== format.codec ? format.container : null].filter(Boolean).join(' · ')
  const length = duration || format.duration

  return (
    <div className="quick">
      {cover && <div className="backdrop" style={{ backgroundImage: `url("${cover}")` }} />}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => { setPlaying(true); quick.playing() }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onError={onError}
      />

      <header className="titlebar">
        <span className="titlebar-name" title={file}>{name}</span>
        <button type="button" className="icon-btn" onClick={togglePin} title={pinned ? t('Unpin') : t('Pin on top')} aria-pressed={pinned}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button type="button" className="icon-btn" onClick={() => quick.minimize()} title={t('Minimize')}><Minus size={15} /></button>
        <button type="button" className="icon-btn close" onClick={() => quick.close()} title={t('Close')}><X size={15} /></button>
      </header>

      <main className="body">
        {/* Left: the cover and the player; the mouse wheel over it seeks. */}
        <div className="player" onWheel={onWheel}>
        <div className="cover">
          {cover ? <img src={cover} alt="" draggable={false} /> : <Music size={56} />}
        </div>

        <div className="heading">
          <div className="title" title={title}>{title}</div>
          {tags.artist && <div className="artist" title={tags.artist}>{tags.artist}</div>}
        </div>

        <SeekBar audioRef={audioRef} duration={length || 0} onSeek={seek} />

        <div className="controls">
          <button type="button" className="icon-btn big" onClick={() => step(-1)} disabled={folder.index <= 0} title={t('Previous file in the folder')}>
            <SkipBack size={20} />
          </button>
          <button type="button" className="play" onClick={toggle} title={playing ? t('Pause') : t('Play')}>
            {status === 'converting' ? <Loader2 size={24} className="spin" /> : playing ? <Pause size={24} /> : <Play size={24} className="nudge" />}
          </button>
          <button type="button" className="icon-btn big" onClick={() => step(1)} disabled={folder.index < 0 || folder.index >= folder.list.length - 1} title={t('Next file in the folder')}>
            <SkipForward size={20} />
          </button>
          <div className="volume">
            <button type="button" className="icon-btn" onClick={() => setMuted(!muted)} title={muted ? t('Unmute') : t('Mute')}>
              {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label={t('Volume')}
              onChange={(event) => { setMuted(false); setVolume(Number(event.target.value)) }} />
          </div>
        </div>
        {folder.list.length > 1 && folder.index >= 0 && <div className="position">{t('{n} of {total}', { n: folder.index + 1, total: folder.list.length })}</div>}

        {status && <div className={`status ${status === 'converting' ? '' : 'error'}`}>{status === 'converting' ? t('Converting for playback…') : status}</div>}
        </div>

        <div className="details-pane">
        <section className="details">
          <Row label={t('Album')} value={tags.album} />
          <Row label={t('Album artist')} value={tags.albumartist && tags.albumartist !== tags.artist ? tags.albumartist : null} />
          <Row label={t('Year')} value={tags.year || tags.date} />
          <Row label={t('Genre')} value={tags.genre} />
          <Row label={t('Label')} value={tags.label} />
          <Row label={t('Track')} value={ofTotal(tags.track, tags.trackOf)} />
          <Row label={t('Disc')} value={ofTotal(tags.disk, tags.diskOf)} />
          <Row label={t('Composer')} value={tags.composer} />
          <Row label={t('BPM')} value={tags.bpm ? String(Math.round(tags.bpm)) : null} />
          <Row label={t('Key')} value={tags.key} />
          <Row label={t('Comment')} value={tags.comment} />
          <div className="divider" />
          <Row label={t('Format')} value={codec ? `${codec}${format.lossless ? ` · ${t('lossless')}` : ''}` : null} />
          <Row label={t('Bitrate')} value={format.bitrate ? t('{n} kbps', { n: Math.round(format.bitrate / 1000) }) : null} />
          <Row label={t('Sample rate')} value={format.sampleRate ? t('{n} kHz', { n: format.sampleRate / 1000 }) : null} />
          <Row label={t('Bit depth')} value={format.bitsPerSample ? t('{n}-bit', { n: format.bitsPerSample }) : null} />
          <Row label={t('Channels')} value={channels} />
          <Row label={t('Length')} value={length ? formatTime(length, length >= 3600) : null} />
          <Row label={t('Size')} value={formatSize(info?.size)} />
          <Row label={t('File')} value={name} />
          <Row label={t('Folder')} value={info?.folder} onClick={() => quick.showInFolder(file)} title={t('Show in folder')} />
          {info?.tagError && <div className="status error">{t("Couldn't read the tags")}</div>}
        </section>
        </div>
      </main>
    </div>
  )
}
