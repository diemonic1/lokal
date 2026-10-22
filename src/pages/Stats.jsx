// Statistics: the listening as numbers and pictures, from every device's
// plays (see electron/listeningHistory.js):
//
// - all time: plays, time, since when, minutes a day, the longest run of days;
// - the latest recaps (year, month, week), opening the Recap page on them;
// - activity: plays (bars) and time (line) by day of a week or a month, or by
//   month of a year, stepping back through earlier ones;
// - a year in music: active days, the best day, the busiest weekday and a
//   calendar of minutes a day.
//
// Plays are counted as recaps count them (30 seconds or more). The backend
// only sends plays and seconds per day (in the listener's time zone).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChartColumn, ChevronLeft, ChevronRight, Clock3, Flame, Radio, Sparkles } from 'lucide-react'
import { api } from '../api'
import { getLanguage, translate, useTranslation } from '../i18n'
import { useCachedState, usePageReady } from '../pageCache'
import { useAppStore } from '../store/player'
import { plural } from '../plural'
import { fmtMinutes } from '../recapText'
import { isoDay, listenerTimeZone, mondayOf, periodLabel, recapTree, treePeriods } from '../recapPeriods'

const DAY_MS = 24 * 60 * 60 * 1000

const parseDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
const minutesOf = (seconds) => Math.round((Number(seconds) || 0) / 60)
const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

function fmtDayShort(date) {
  return date.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short' })
}
function monthName(index, style = 'long') {
  return capitalize(new Date(2000, index, 1).toLocaleDateString(getLanguage(), { month: style }))
}
/** Monday-first weekday names: "Mon" … "Sun". */
function weekdayName(index, style = 'short') {
  return capitalize(new Date(2024, 0, 1 + index).toLocaleDateString(getLanguage(), { weekday: style })) // Jan 1, 2024 was a Monday
}

/** A round top for an axis: 0, 4, 8, 12, 16 or 0, 5, 10… (four steps). */
function niceMax(value) {
  if (value <= 4) return 4
  const step = value / 4
  const magnitude = 10 ** Math.floor(Math.log10(step))
  const nice = [1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= step)
  return nice * 4
}

/** A round top for the minutes axis: whole quarters, halves or hours once past an hour. */
function niceMinutes(value) {
  const step = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600, 720, 900, 1200, 1800, 2400, 3000, 3600, 4800, 6000].find(n => n * 4 >= value)
  return (step || Math.ceil(value / 4 / 600) * 600) * 4
}

/** "1h" or "45m" for the time axis. */
function axisMinutes(minutes) {
  if (minutes >= 60 && minutes % 60 === 0) return translate('{h}h', { h: minutes / 60 })
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  return translate('{n}m', { n: minutes })
}

/** The width an element gets, kept up to date. */
function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** A smooth path through points that never overshoots them (monotone cubic). */
function smoothPath(points) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : ''
  const n = points.length
  const dx = [], slope = [], tangent = []
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1][0] - points[i][0]
    slope[i] = (points[i + 1][1] - points[i][1]) / (dx[i] || 1)
  }
  tangent[0] = slope[0]
  tangent[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i += 1) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue }
    const a = tangent[i] / slope[i]
    const b = tangent[i + 1] / slope[i]
    const h = a * a + b * b
    if (h > 9) { const t = 3 / Math.sqrt(h); tangent[i] = t * a * slope[i]; tangent[i + 1] = t * b * slope[i] }
  }
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    d += ` C${x0 + dx[i] / 3},${y0 + tangent[i] * dx[i] / 3} ${x1 - dx[i] / 3},${y1 - tangent[i + 1] * dx[i] / 3} ${x1},${y1}`
  }
  return d
}

export default function Stats() {
  const { user } = useAppStore()
  return <StatsContent key={user?.id || 'guest'} userId={user?.id || 'guest'} />
}

function StatsContent({ userId }) {
  const { t } = useTranslation()
  const [data, setData, wasCached] = useCachedState(`stats:${userId}`, null)
  const [loaded, setLoaded] = useState(wasCached)
  usePageReady(loaded)

  const load = useCallback(async () => {
    const result = await Promise.resolve(api.getListeningStats(userId, { tz: listenerTimeZone() })).catch(() => null)
    if (result && !result.error && result.days) setData(result)
    setLoaded(true)
  }, [userId, setData])

  useEffect(() => {
    load()
    const off = api.onHistoryChanged(load)
    window.addEventListener('focus', load)
    window.addEventListener('lokal:refresh', load)
    return () => {
      off?.()
      window.removeEventListener('focus', load)
      window.removeEventListener('lokal:refresh', load)
    }
  }, [load])

  const days = data?.days || {}
  const hasPlays = Object.keys(days).length > 0

  return (
    <div className="p-6 pb-10 space-y-6 w-full max-w-6xl mx-auto">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-accent">
          <ChartColumn size={13} />
          {t('Statistics')}
        </div>
        <h1 className="mt-2 text-3xl font-display text-white">{t('Your listening in numbers')}</h1>
        <p className="mt-1 text-sm text-muted">{t('Plays of 30 seconds or more, from this computer and your other devices; time includes online radio.')}</p>
      </div>
      {!hasPlays ? (
        <div className="rounded-xl border border-border bg-elevated p-10 text-center text-sm text-muted">
          {loaded ? t('No plays yet: statistics show up once you have listened to something.') : t('Loading...')}
        </div>
      ) : (
        <>
          <AllTime days={days} first={data.first} />
          <LatestRecaps days={days} />
          <Activity days={days} />
          <YearInMusic days={days} />
        </>
      )}
    </div>
  )
}

function AllTime({ days, first }) {
  const { t } = useTranslation()
  const summary = useMemo(() => {
    const keys = Object.keys(days).sort()
    let plays = 0
    let seconds = 0
    let radio = 0
    for (const key of keys) { plays += days[key][0]; seconds += days[key][1]; radio += days[key][2] || 0 }
    // The longest run of days in a row with plays.
    let longest = 0
    let run = 0
    let previous = null
    for (const key of keys) {
      const date = parseDay(key)
      run = previous && Math.round((date - previous) / DAY_MS) === 1 ? run + 1 : 1
      longest = Math.max(longest, run)
      previous = date
    }
    const firstDay = first ? new Date(first * 1000) : parseDay(keys[0])
    const today = new Date()
    const span = Math.max(1, Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate())) / DAY_MS) + 1)
    return { plays, minutes: minutesOf(seconds), radioMinutes: minutesOf(radio), longest, firstDay, perDay: Math.round(minutesOf(seconds) / span) }
  }, [days, first])
  const since = summary.firstDay.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-elevated p-6"
      style={{ backgroundImage: 'radial-gradient(120% 140% at 0% 0%, rgb(var(--accent-rgb) / 0.18), transparent 60%)' }}>
      <div className="flex items-center justify-between gap-3 text-[10px] font-display uppercase tracking-widest">
        <span className="text-accent">{t('All time')}</span>
        <span className="text-muted">{t('since {date}', { date: since })}</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-5 @md:grid-cols-[1fr_auto_1fr]">
        <div>
          <p className="font-display text-4xl text-white @lg:text-5xl">{summary.plays.toLocaleString()}</p>
          <p className="mt-1 text-sm text-muted">{t('tracks listened to')}</p>
        </div>
        <div className="hidden w-px bg-border @md:block" />
        <div>
          <p className="whitespace-nowrap font-display text-4xl text-white @lg:text-5xl">{fmtMinutes(summary.minutes)}</p>
          <p className="mt-1 text-sm text-muted">{t('listened')}</p>
        </div>
      </div>
      <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><Clock3 size={12} />{t('≈ {n} min a day', { n: summary.perDay })}</span>
        <span className="flex items-center gap-1.5"><Flame size={12} />{t('longest streak: {days}', { days: plural(summary.longest, 'day') })}</span>
        {summary.radioMinutes > 0 && <span className="flex items-center gap-1.5"><Radio size={12} />{t('online radio: {time}', { time: fmtMinutes(summary.radioMinutes) })}</span>}
      </p>
    </section>
  )
}

/** The newest year, month and week recaps (finished ones, or so far), opening the Recap page on them. */
function LatestRecaps({ days }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cards = useMemo(() => {
    const tree = recapTree(Object.keys(days))
    const year = tree[0]
    const months = year?.months || []
    const month = months[months.length - 1]
    const weeks = treePeriods(tree).filter(period => period.scope === 'week').sort((a, b) => b.completedAt - a.completedAt)
    return [
      year && { kind: t('Year recap'), period: year.period || year.soFar, text: String(year.year) },
      month && { kind: t('Month recap'), period: month.period || month.soFar, text: monthName(month.month - 1) },
      weeks[0] && { kind: t('Week recap'), period: weeks[0], text: periodLabel(weeks[0]) },
    ].filter(card => card?.period)
  }, [days, t])
  if (!cards.length) return null
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-display uppercase tracking-widest text-muted">{t('Your recaps')}</h2>
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
        {cards.map((card, index) => (
          <button key={card.period.id} onClick={() => navigate('/recap', { state: { periodId: card.period.id } })}
            className={`group relative h-32 overflow-hidden rounded-2xl border p-4 text-left transition-colors ${index === 0 ? 'border-accent/40 bg-accent/20 hover:bg-accent/30' : 'border-border bg-elevated hover:border-accent/40'}`}>
            <span aria-hidden className={`absolute -right-6 -top-6 h-24 w-24 rounded-full ${index === 0 ? 'bg-accent/25' : 'bg-white/[0.04]'} transition-transform group-hover:scale-110`} />
            <span aria-hidden className="absolute -bottom-10 right-8 h-20 w-20 rounded-full border-[6px] border-white/[0.06]" />
            <p className="relative text-xs font-display uppercase tracking-widest text-muted">{card.kind}</p>
            <p className={`relative mt-auto pt-8 text-2xl font-display ${index === 0 ? 'text-white' : 'text-accent'}`}>{card.text}</p>
            {card.period.partial && <Sparkles size={13} className="absolute right-4 top-4 text-accent" aria-label={t('so far')} />}
          </button>
        ))}
      </div>
    </section>
  )
}

const SCOPES = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']]

/** The buckets (days or months) of a week, month or year, `offset` periods back from now. */
function activityBuckets(days, scope, offset) {
  const today = new Date()
  const todayKey = isoDay(today)
  const sum = (keys) => keys.reduce((acc, key) => {
    const day = days[key]
    if (day) { acc.plays += day[0]; acc.seconds += day[1] }
    return acc
  }, { plays: 0, seconds: 0 })
  if (scope === 'year') {
    const year = today.getFullYear() + offset
    const buckets = Array.from({ length: 12 }, (_, month) => {
      const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
      const keys = Object.keys(days).filter(key => key.startsWith(prefix))
      return { label: monthName(month, 'narrow'), title: monthName(month), future: new Date(year, month, 1) > today, current: year === today.getFullYear() && month === today.getMonth(), ...sum(keys) }
    })
    return { buckets, heading: translate('{year} · by month', { year }), tick: () => true }
  }
  if (scope === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const buckets = Array.from({ length: count }, (_, i) => {
      const date = new Date(first.getFullYear(), first.getMonth(), i + 1)
      const key = isoDay(date)
      return { label: String(i + 1), title: fmtDayShort(date), future: key > todayKey, current: key === todayKey, ...sum([key]) }
    })
    const heading = capitalize(first.toLocaleDateString(getLanguage(), { month: 'long', year: 'numeric' }))
    return { buckets, heading, tick: (i) => i === 0 || (i + 1) % 7 === 0 }
  }
  const monday = addDays(mondayOf(today), offset * 7)
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i)
    const key = isoDay(date)
    return { label: weekdayName(i), title: `${weekdayName(i, 'long')}, ${fmtDayShort(date)}`, future: key > todayKey, current: key === todayKey, ...sum([key]) }
  })
  const range = `${fmtDayShort(monday)} – ${fmtDayShort(addDays(monday, 6))}`
  return { buckets, heading: offset === 0 ? translate('This week · {range}', { range }) : range, tick: () => true }
}

function Activity({ days }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState('week')
  const [offset, setOffset] = useState(0)
  const firstKey = useMemo(() => Object.keys(days).sort()[0], [days])
  const { buckets, heading, tick } = activityBuckets(days, scope, offset)
  // No stepping back past the first play.
  const earliest = useMemo(() => {
    const first = parseDay(firstKey)
    const today = new Date()
    if (scope === 'year') return first.getFullYear() - today.getFullYear()
    if (scope === 'month') return (first.getFullYear() - today.getFullYear()) * 12 + first.getMonth() - today.getMonth()
    return Math.round((mondayOf(first) - mondayOf(today)) / (7 * DAY_MS))
  }, [firstKey, scope])
  const totals = buckets.reduce((acc, bucket) => ({ plays: acc.plays + bucket.plays, seconds: acc.seconds + bucket.seconds }), { plays: 0, seconds: 0 })
  const pick = (next) => { setScope(next); setOffset(0) }
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-display uppercase tracking-widest text-muted">{t('Activity')}</h2>
      <div className="rounded-2xl border border-border bg-elevated p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="inline-flex rounded-lg border border-border bg-card/70 p-0.5">
            {SCOPES.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={scope === id} onClick={() => pick(id)}
                className={`rounded-md px-4 py-1.5 text-xs font-display uppercase tracking-wider transition-colors ${scope === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
                {t(label)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <StepButton label={t('Earlier')} disabled={offset <= earliest} onClick={() => setOffset(value => value - 1)}><ChevronLeft size={15} /></StepButton>
            <StepButton label={t('Later')} disabled={offset >= 0} onClick={() => setOffset(value => value + 1)}><ChevronRight size={15} /></StepButton>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">{heading}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-3xl text-white">{totals.plays.toLocaleString()}</span>
          <span className="text-sm text-muted">{plural(totals.plays, 'track').replace(/^[\d\s,. ]+/, '')} ·</span>
          <span className="font-display text-2xl text-accent">{fmtMinutes(minutesOf(totals.seconds))}</span>
        </p>
        <ActivityChart buckets={buckets} tick={tick} />
        <div className="mt-3 flex items-center gap-5 text-xs text-muted">
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-accent/30" />{t('Tracks')}</span>
          <span className="flex items-center gap-2">
            <svg width="22" height="10" aria-hidden><line x1="0" y1="5" x2="22" y2="5" stroke="var(--accent)" strokeWidth="2" /><circle cx="11" cy="5" r="3" fill="var(--color-elevated, #1a1a1a)" stroke="var(--accent)" strokeWidth="2" /></svg>
            {t('Listening time')}
          </span>
        </div>
      </div>
    </section>
  )
}

function StepButton({ label, disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent/40 hover:text-white disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  )
}

/** Plays as bars (left axis) and minutes as a line (right axis). */
function ActivityChart({ buckets, tick }) {
  const [ref, width] = useWidth()
  const height = 240
  const left = 34
  const right = 44
  const top = 12
  const bottom = 26
  const plotW = Math.max(0, width - left - right)
  const plotH = height - top - bottom
  const playsMax = niceMax(Math.max(...buckets.map(bucket => bucket.plays)))
  const minutesMax = niceMinutes(Math.max(1, ...buckets.map(bucket => minutesOf(bucket.seconds))))
  const slot = plotW / buckets.length
  const barW = Math.max(2, Math.min(28, slot * 0.55))
  const x = (i) => left + slot * i + slot / 2
  const yPlays = (value) => top + plotH - (value / playsMax) * plotH
  const yMinutes = (value) => top + plotH - (value / minutesMax) * plotH
  // The line runs up to today, not into days still to come.
  const shown = buckets.map((bucket, i) => ({ bucket, i })).filter(({ bucket }) => !bucket.future)
  const points = shown.map(({ bucket, i }) => [x(i), yMinutes(minutesOf(bucket.seconds))])
  const dots = buckets.length <= 12
  return (
    <div ref={ref} className="mt-4 w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={translate('Plays and listening time')} className="block overflow-visible">
          {[0, 1, 2, 3, 4].map(step => {
            const y = top + plotH - (step / 4) * plotH
            return (
              <g key={step}>
                <line x1={left} x2={left + plotW} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
                <text x={left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.45)">{Math.round((playsMax / 4) * step)}</text>
                <text x={left + plotW + 8} y={y + 4} fontSize="11" fill="var(--accent)" opacity="0.75">{axisMinutes(Math.round((minutesMax / 4) * step))}</text>
              </g>
            )
          })}
          {buckets.map((bucket, i) => (
            <g key={i}>
              {bucket.future
                ? <rect x={x(i) - barW / 2} y={top + plotH - 3} width={barW} height={3} rx={1.5} fill="rgba(255,255,255,0.06)" />
                : bucket.plays > 0 && <rect x={x(i) - barW / 2} y={yPlays(bucket.plays)} width={barW} height={top + plotH - yPlays(bucket.plays)} rx={Math.min(4, barW / 3)}
                  fill="rgb(var(--accent-rgb))" opacity={bucket.current ? 0.55 : 0.28} />}
              {tick(i) && <text x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill={bucket.current ? '#fff' : 'rgba(255,255,255,0.45)'} fontWeight={bucket.current ? 600 : 400}>{bucket.label}</text>}
              <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent">
                <title>{`${bucket.title}: ${plural(bucket.plays, 'track')}, ${fmtMinutes(minutesOf(bucket.seconds))}`}</title>
              </rect>
            </g>
          ))}
          <path d={smoothPath(points)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" pointerEvents="none" />
          {points.map(([px, py], index) => {
            const last = index === points.length - 1
            if (!dots && !last) return null
            return <circle key={index} cx={px} cy={py} r={last ? 5 : 3.5} fill="#151515" stroke="var(--accent)" strokeWidth="2" pointerEvents="none" />
          })}
        </svg>
      )}
    </div>
  )
}

const LEVELS = ['bg-white/[0.06]', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent']

function YearInMusic({ days }) {
  const { t } = useTranslation()
  const years = useMemo(() => {
    const set = new Set(Object.keys(days).map(key => Number(key.slice(0, 4))))
    set.add(new Date().getFullYear())
    return [...set].sort((a, b) => a - b)
  }, [days])
  const [year, setYear] = useState(() => new Date().getFullYear())
  const at = years.indexOf(year)

  const summary = useMemo(() => {
    const keys = Object.keys(days).filter(key => key.startsWith(`${year}-`))
    let best = null
    const weekdays = Array(7).fill(0)
    for (const key of keys) {
      const seconds = days[key][1]
      if (!best || seconds > best.seconds) best = { key, seconds }
      weekdays[(parseDay(key).getDay() + 6) % 7] += seconds
    }
    const busiest = weekdays.some(Boolean) ? weekdays.indexOf(Math.max(...weekdays)) : null
    const max = Math.max(1, ...keys.map(key => days[key][1]))
    return { active: keys.length, best, busiest, max }
  }, [days, year])

  // Monday-first weeks from the week holding Jan 1 to the one holding Dec 31.
  const weeks = useMemo(() => {
    const start = mondayOf(new Date(year, 0, 1))
    const end = new Date(year, 11, 31)
    const list = []
    for (let monday = start; monday <= end; monday = addDays(monday, 7)) list.push(monday)
    return list
  }, [year])
  const todayKey = isoDay(new Date())
  const level = (seconds) => {
    if (!seconds) return 0
    const share = seconds / summary.max
    return share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-display uppercase tracking-widest text-muted">{t('Your {year} in music', { year })}</h2>
        <div className="flex items-center gap-1">
          <StepButton label={t('Earlier')} disabled={at <= 0} onClick={() => setYear(years[at - 1])}><ChevronLeft size={15} /></StepButton>
          <StepButton label={t('Later')} disabled={at >= years.length - 1} onClick={() => setYear(years[at + 1])}><ChevronRight size={15} /></StepButton>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-elevated p-5">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="font-display text-2xl text-white">{summary.active}</p>
            <p className="text-xs text-muted">{plural(summary.active, 'active day').replace(/^[\d\s,. ]+/, '')}</p>
          </div>
          <div>
            <p className="font-display text-2xl text-white">{summary.best ? fmtMinutes(minutesOf(summary.best.seconds)) : '—'}</p>
            <p className="text-xs text-muted">{summary.best ? t('best day · {date}', { date: fmtDayShort(parseDay(summary.best.key)) }) : t('best day')}</p>
          </div>
          <div>
            <p className="font-display text-2xl text-white">{summary.busiest === null ? '—' : weekdayName(summary.busiest)}</p>
            <p className="text-xs text-muted">{t('most active day')}</p>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto pb-1">
          <div className="grid min-w-[30rem] gap-[2px]" style={{ gridTemplateColumns: `2rem repeat(${weeks.length}, minmax(0, 1fr))` }}>
            <span />
            {weeks.map((monday, i) => {
              // A month's name over the week its 1st is in.
              const sunday = addDays(monday, 6)
              const label = sunday.getFullYear() === year && sunday.getDate() <= 7 ? monthName(sunday.getMonth(), 'short') : ''
              return <span key={i} className="relative h-4"><span className="absolute left-0 top-0 whitespace-nowrap text-[10px] text-muted">{label}</span></span>
            })}
            {Array.from({ length: 7 }, (_, row) => (
              <React.Fragment key={row}>
                <span className="pr-1 text-[10px] leading-none text-muted self-center">{row % 2 === 0 ? weekdayName(row) : ''}</span>
                {weeks.map((monday, column) => {
                  const date = addDays(monday, row)
                  const key = isoDay(date)
                  if (date.getFullYear() !== year) return <span key={column} />
                  const day = days[key]
                  const future = key > todayKey
                  return (
                    <span key={column} title={`${fmtDayShort(date)}: ${day ? `${plural(day[0], 'track')}, ${fmtMinutes(minutesOf(day[1]))}` : translate('no plays')}`}
                      className={`aspect-square rounded-[3px] ${future ? 'border border-white/[0.08]' : LEVELS[level(day?.[1])]} ${key === todayKey ? 'ring-1 ring-white' : ''}`} />
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
          <CalendarDays size={12} />
          <span>{t('Minutes listened a day')}</span>
          <span className="ml-auto">{t('Less time')}</span>
          {LEVELS.map(cls => <span key={cls} className={`h-3 w-3 rounded-[3px] ${cls}`} />)}
          <span>{t('More time')}</span>
        </div>
      </div>
    </section>
  )
}
