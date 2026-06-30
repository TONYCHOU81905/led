import { useEffect, useRef, useState } from 'react'
import type { LedProject } from '../../shared/types/project'
import { STAGE_COLOR_NAMES, resolveColorCss } from '../../shared/stageColors'

interface ColorSwatchSelectProps {
  value: string
  colors: LedProject['colors']
  onChange: (color: string) => void
}

export function ColorSwatchSelect({ value, colors, onChange }: ColorSwatchSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="color-swatch-select" ref={rootRef}>
      <button
        type="button"
        className="color-swatch-select-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="color-swatch-lg" style={{ background: resolveColorCss(value, colors) }} />
        <span className="color-swatch-select-label">{value}</span>
        <span className="color-swatch-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="color-swatch-select-menu" role="listbox">
          {STAGE_COLOR_NAMES.map((name) => (
            <li key={name} role="option" aria-selected={name === value}>
              <button
                type="button"
                className={name === value ? 'color-swatch-option active' : 'color-swatch-option'}
                onClick={() => {
                  onChange(name)
                  setOpen(false)
                }}
              >
                <span className="color-swatch-chip" style={{ background: resolveColorCss(name, colors) }} />
                <span>{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
