// The quick player's seek bar and times, to the millisecond.
//
// A click jumps there. Dragging moves the position by how far the mouse moves,
// slower the further the mouse is above (or below) the bar -- like scrubbing
// on a phone: next to it a pixel is the bar's own share of the length, then
// half as much every HALVE_EVERY pixels further, down to a millisecond a
// pixel, so even a two-hour file can be set to the millisecond. Shift drags at
// a millisecond a pixel at once. The audio is moved at most ~15 times a second
// while dragging, exactly on release.

import React, { useEffect, useRef, useState } from 'react'
import { t } from './strings'

// Seconds a pixel at the finest.
const FINEST = 0.001
const SEEK_EVERY_MS = 66
// How far from the bar (px) the speed starts dropping, and every how many
// pixels further it halves.
const NEAR = 12
const HALVE_EVERY = 30

/** 75.0423 -> "1:15.042" (or "1:01:15.042" when the length runs to hours). */
export function formatTime(seconds, withHours = false) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const rest = `${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
  return h || withHours ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** Seconds a pixel of mouse movement moves the position, `distance` px from the bar. */
const stepFor = (normal, distance, shift) => (shift ? FINEST : Math.min(normal, Math.max(FINEST, normal / 2 ** (Math.max(0, distance - NEAR) / HALVE_EVERY))))

function stepLabel(step, normal) {
  if (step >= normal * 0.75) return t('Seeking: normal')
  const amount = step >= 1 ? t('{n} s', { n: step.toFixed(1) }) : t('{n} ms', { n: Math.max(1, Math.round(step * 1000)) })
  return t('Seeking: {step} a pixel', { step: amount })
}

export default function SeekBar({ audioRef, duration, onSeek }) {
  const barRef = useRef(null)
  const timeRef = useRef(null)
  const fillRef = useRef(null)
  const thumbRef = useRef(null)
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [step, setStep] = useState(null)
  const [hover, setHover] = useState(null)
  const hours = duration >= 3600

  // Painted every frame from the audio (or the drag), without re-rendering.
  useEffect(() => {
    let raf
    const paint = () => {
      raf = requestAnimationFrame(paint)
      const time = drag.current ? drag.current.value : (audioRef.current?.currentTime || 0)
      const share = duration > 0 ? Math.min(1, time / duration) : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${share})`
      if (thumbRef.current) thumbRef.current.style.left = `${share * 100}%`
      if (timeRef.current) {
        const text = formatTime(time, hours)
        if (timeRef.current.textContent !== text) timeRef.current.textContent = text
      }
    }
    paint()
    return () => cancelAnimationFrame(raf)
  }, [audioRef, duration, hours])

  const timeAt = (clientX) => {
    const box = barRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * duration
  }

  const onPointerDown = (event) => {
    if (event.button !== 0 || !(duration > 0)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const value = timeAt(event.clientX)
    drag.current = { value, lastX: event.clientX, lastSeek: 0 }
    setDragging(true)
    setStep(null)
    onSeek(value, false)
  }

  const onPointerMove = (event) => {
    if (!drag.current) {
      if (duration > 0) setHover({ x: event.clientX - barRef.current.getBoundingClientRect().left, time: timeAt(event.clientX) })
      return
    }
    const box = barRef.current.getBoundingClientRect()
    const distance = Math.abs(event.clientY - (box.top + box.height / 2))
    const normal = duration / box.width
    const nextStep = stepFor(normal, distance, event.shiftKey)
    const dx = event.clientX - drag.current.lastX
    drag.current.lastX = event.clientX
    drag.current.value = Math.max(0, Math.min(duration, drag.current.value + dx * nextStep))
    setStep({ step: nextStep, normal })
    setHover(null)
    const now = performance.now()
    if (now - drag.current.lastSeek >= SEEK_EVERY_MS) {
      drag.current.lastSeek = now
      onSeek(drag.current.value, false)
    }
  }

  const endDrag = () => {
    if (!drag.current) return
    const { value } = drag.current
    drag.current = null
    setDragging(false)
    onSeek(value, true)
  }

  return (
    <div className="seek">
      <div
        ref={barRef}
        className={`seek-bar ${dragging ? 'is-dragging' : ''}`}
        role="slider"
        aria-label={t('Drag to seek; move the mouse up from the bar while dragging to seek slower and finer, down to 1 ms a pixel (Shift: 1 ms a pixel at once)')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration || 0)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
      >
        <div className="seek-track"><div ref={fillRef} className="seek-fill" /></div>
        <div ref={thumbRef} className="seek-thumb" />
        {hover && !dragging && <div className="seek-tip" style={{ left: hover.x }}>{formatTime(hover.time, hours)}</div>}
        {dragging && step && <div className="seek-speed">{stepLabel(step.step, step.normal)}</div>}
      </div>
      <div className="seek-times" title={`${t('Drag to seek; move the mouse up from the bar while dragging to seek slower and finer, down to 1 ms a pixel (Shift: 1 ms a pixel at once)')}
${t('Mouse wheel over the player: a second on or back; with Shift, a millisecond')}`}>
        <span ref={timeRef} className="time" />
        <span className="time muted">{formatTime(duration, hours)}</span>
      </div>
    </div>
  )
}
