import { useEffect, useRef, useState } from 'react'
import { HexColorPicker, HexColorInput } from 'react-colorful'
import { Pipette } from 'lucide-react'
import { useTranslation } from '../i18n'

// The darker shade the theme uses next to the accent (hover, pressed states).
export function dimHex(hex, amount = 0.12) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - amount)).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

// A swatch button that opens a colour palette with a hex field. Changes are
// applied while dragging and saved once the colour settles.
export default function AccentColorPicker({ value, active, onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [color, setColor] = useState(isHex(value) ? value : '#c8ff57')
  const wrapRef = useRef(null)
  const timer = useRef(null)

  useEffect(() => { if (!open && isHex(value)) setColor(value) }, [value, open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => clearTimeout(timer.current), [])

  const pick = (next) => {
    if (!isHex(next)) return
    const hex = next.toLowerCase()
    setColor(hex)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange({ value: hex, dim: dimHex(hex) }), 120)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-8 h-8 rounded-lg transition-all flex items-center justify-center border border-border ${
          active ? 'ring-2 ring-offset-2 ring-offset-elevated ring-white scale-110' : 'hover:scale-110'
        }`}
        style={{ background: active ? color : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
        title={t('Custom color')}
      >
        <Pipette size={14} className="text-black/70 drop-shadow" />
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-10 p-3 rounded-xl bg-elevated border border-border shadow-2xl accent-color-picker">
          <HexColorPicker color={color} onChange={pick} />
          <div className="mt-3 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md border border-border shrink-0" style={{ background: color }} />
            <span className="text-muted text-sm">#</span>
            <HexColorInput
              color={color}
              onChange={pick}
              className="flex-1 min-w-0 bg-card border border-border rounded-md px-2 py-1 text-sm text-white uppercase outline-none focus:border-accent/60"
            />
          </div>
        </div>
      )}
    </div>
  )
}
