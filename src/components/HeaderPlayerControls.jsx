import React, { useEffect, useState } from 'react'
import { Moon, Radio, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { usePlayerStore } from '../store/player'
import { useCastStore } from '../cast/castStore'
import AudioOutputPicker from './AudioOutputPicker'
import Modal from './Modal'
import { useTranslation } from '../i18n'

// The header's plain icon buttons: white like the player bar's, no circle.
export const HEADER_ICON = 'flex h-7 w-7 flex-shrink-0 items-center justify-center transition-colors'
export const headerIconTone = active => active ? 'text-accent' : 'text-text/90 hover:text-text'

/** Sleep timer: the moon (with the time left) and its picker. */
function SleepTimerButton() {
  const { t } = useTranslation()
  const { sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer } = usePlayerStore(useShallow(
    ({ sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer }) => ({ sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer })))
  const [open, setOpen] = useState(false)
  const [display, setDisplay] = useState(null)

  useEffect(() => {
    if (!sleepTimerEndTime) {
      setDisplay(null)
      return
    }
    const update = () => {
      const remaining = sleepTimerEndTime - Date.now()
      if (remaining <= 0) {
        setDisplay(null)
        return
      }
      const minutes = Math.floor(remaining / 60000)
      const seconds = Math.floor((remaining % 60000) / 1000)
      setDisplay(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [sleepTimerEndTime])

  useEffect(() => () => {
    const { sleepTimerEndTime: end, cancelSleepTimer: cancel } = usePlayerStore.getState()
    if (end && Date.now() >= end) cancel()
  }, [])

  return <>
    <div className="relative flex items-center justify-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${HEADER_ICON} ${headerIconTone(!!sleepTimerEndTime)}`}
        title={sleepTimerEndTime ? `${t("Sleep Timer")}: ${display}` : t("Sleep Timer")}
        aria-label={t("Sleep Timer")}
      >
        <Moon size={15} />
      </button>
      {sleepTimerEndTime && display && (
        <span className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-surface px-1 font-mono text-[8px] text-accent">
          {display}
        </span>
      )}
    </div>

    <Modal open={open} onClose={() => setOpen(false)} title={t("Sleep Timer")} width="max-w-xs">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Music will stop after the selected time. Use this if you would like the app to stop while you are sleeping.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[5, 10, 15, 30, 45, 60].map(mins => (
            <button
              key={mins}
              onClick={() => { setSleepTimer(mins); setOpen(false) }}
              className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                sleepTimerMinutes === mins
                  ? 'bg-accent text-base'
                  : 'bg-card border border-border text-muted hover:text-white hover:border-accent/30'
              }`}
            >
              {mins} min
            </button>
          ))}
        </div>
        {sleepTimerEndTime && (
          <div className="pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-accent">Timer active: {display}</span>
              <button
                onClick={() => { cancelSleepTimer(); setOpen(false) }}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        )}
        <button
          onClick={() => setOpen(false)}
          className="w-full py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors"
        >
          Close
        </button>
      </div>
    </Modal>
  </>
}

/** Audio output, mini player and sleep timer, in the header next to Cast. */
export default function HeaderPlayerControls() {
  const { t } = useTranslation()
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const toggleMiniPlayer = usePlayerStore(s => s.toggleMiniPlayer)
  const castActive = usePlayerStore(s => s.castActive)
  const castDevice = useCastStore(s => s.status?.device)
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      {!(castActive && castDevice) && (
        <div className={HEADER_ICON}><AudioOutputPicker placement="down" /></div>
      )}
      <button
        type="button"
        onClick={toggleMiniPlayer}
        disabled={!currentTrack}
        className={`${HEADER_ICON} ${headerIconTone(false)} disabled:opacity-30`}
        title={t("Mini Player")}
        aria-label={t("Mini Player")}
      >
        <Radio size={15} />
      </button>
      <SleepTimerButton />
    </div>
  )
}
