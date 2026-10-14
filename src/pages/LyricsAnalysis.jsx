// Lyrics Analysis: how many files in the music folder have synced lyrics,
// plain lyrics, the instrumental / "can't be found" markers, or nothing --
// overall and per folder. The last report is kept; Refresh counts again.

import React, { useEffect, useState } from 'react'
import { Loader2, RefreshCw, ScrollText } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'
import { usePageReady } from '../pageCache'

const percent = (n, total) => (total ? `${((n / total) * 100).toFixed(2)}%` : '—')

function Stat({ label, value, total, tone = 'text-white', note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card/50 p-3">
      <span className="truncate text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`font-display text-2xl leading-8 tabular-nums ${tone}`}>{value.toLocaleString()}</span>
      <span className="truncate text-[11px] tabular-nums text-muted/80">{total != null ? percent(value, total) : ' '}</span>
      {note && <span className="truncate text-[11px] text-muted">{note}</span>}
    </div>
  )
}

export default function LyricsAnalysis() {
  const { t } = useTranslation()
  const [report, setReport] = useState(null)
  const [progress, setProgress] = useState({ running: false })
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  usePageReady(loaded)

  const run = () => {
    setReport(null)
    setError(null)
    setProgress({ running: true, done: 0, total: 0, folder: '' })
    api.lyricsAnalysisRun().then(result => {
      if (result?.running) return
      if (result?.ok) setReport(result.report)
      else if (!result?.cancelled) setError(result?.error || '?')
    }).catch(e => setError(e?.message || '?'))
  }

  useEffect(() => {
    const off = api.onLyricsAnalysisProgress(p => setProgress(p || { running: false }))
    api.lyricsAnalysisGet().then(state => {
      setLoaded(true)
      if (state?.unsupported) { setError(t('Lyrics analysis works in the desktop app.')); return }
      if (state?.progress?.running) { setProgress(state.progress); return }
      if (state?.report) { setReport(state.report); return }
      // Nothing counted yet: count now.
      run()
    }).catch(() => setLoaded(true))
    return off
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A run started before this page opened (or from another window) ends here too.
  useEffect(() => {
    if (progress.running || report) return
    api.lyricsAnalysisGet().then(state => { if (state?.report) setReport(state.report) }).catch(() => {})
  }, [progress.running]) // eslint-disable-line react-hooks/exhaustive-deps

  const running = !!progress.running
  const pct = progress.total ? Math.floor((progress.done / progress.total) * 100) : 0
  const totals = report?.totals

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 px-4 pb-12 pt-6">
      <section className="rounded-[24px] border border-border bg-card/60 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <ScrollText size={18} className="text-accent" />
          <h1 className="font-display text-lg uppercase tracking-[0.28em] text-white">{t('Lyrics Analysis')}</h1>
          {report?.finishedAt && !running && (
            <span className="text-xs text-muted">{t('Counted {date}', { date: new Date(report.finishedAt).toLocaleString() })}</span>
          )}
          <div className="ml-auto">
            <button onClick={run} disabled={running}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:text-white disabled:opacity-50">
              {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {t('Refresh')}
            </button>
          </div>
        </div>

        {running && (
          <div className="mt-6 space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-4xl tabular-nums text-white">{pct}%</span>
              <span className="text-xs tabular-nums text-muted">{(progress.done || 0).toLocaleString()} / {(progress.total || 0).toLocaleString()}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <p className="truncate text-xs text-muted">{progress.folder || t('Looking for files...')}</p>
          </div>
        )}

        {!running && error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {!running && totals && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={t('All files')} value={totals.total} />
            <Stat label={t('Synced lyrics')} value={totals.synced} total={totals.total} tone="text-accent" />
            <Stat label={t('Plain lyrics')} value={totals.plain} total={totals.total} />
            <Stat label={t('No lyrics')} value={totals.none} total={totals.total} />
            <Stat label={t('Instrumental')} value={totals.instrumental} total={totals.total} />
            <Stat label={t("Can't be found")} value={totals.unfound} total={totals.total}
              note={t('fish covers: {fish}, others: {others}', { fish: totals.fish, others: totals.unfound - totals.fish })} />
          </div>
        )}
      </section>

      {!running && report?.folders?.length > 0 && (
        <section className="rounded-[24px] border border-border bg-card/60 p-2">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="w-[34%] px-3 py-2 font-normal">{t('Folder')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('Files')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('Synced lyrics')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('Plain lyrics')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('No lyrics')}</th>
                <th className="px-2 py-2 text-right font-normal">{t('Instrumental')}</th>
                <th className="px-3 py-2 text-right font-normal">{t("Can't be found")}</th>
              </tr>
            </thead>
            <tbody>
              {report.folders.map(row => (
                <tr key={row.folder} className="border-t border-border/60 tabular-nums hover:bg-card">
                  <td className="truncate px-3 py-1.5 text-white" title={row.folder}>{row.folder === '.' ? report.root : row.folder}</td>
                  <td className="px-2 py-1.5 text-right text-muted">{row.total}</td>
                  <td className={`px-2 py-1.5 text-right ${row.synced ? 'text-accent' : 'text-muted/40'}`}>{row.synced}</td>
                  <td className={`px-2 py-1.5 text-right ${row.plain ? 'text-white' : 'text-muted/40'}`}>{row.plain}</td>
                  <td className={`px-2 py-1.5 text-right ${row.none ? 'text-white' : 'text-muted/40'}`}>{row.none}</td>
                  <td className={`px-2 py-1.5 text-right ${row.instrumental ? 'text-white' : 'text-muted/40'}`}>{row.instrumental}</td>
                  <td className={`px-3 py-1.5 text-right ${row.unfound ? 'text-white' : 'text-muted/40'}`}>{row.unfound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
