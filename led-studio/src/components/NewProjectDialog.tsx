import { useEffect, useRef, useState } from 'react'

interface NewProjectDialogProps {
  open: boolean
  defaultName?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function NewProjectDialog({
  open,
  defaultName = '我的演出',
  onConfirm,
  onCancel
}: NewProjectDialogProps) {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(defaultName)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open, defaultName])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>新建專案</h2>
        <label className="modal-field">
          專案名稱
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onConfirm(name.trim())
              if (e.key === 'Escape') onCancel()
            }}
          />
        </label>
        <p className="hint">將自動建立 4 位舞者（A–D），可在 Timeline 編輯亮燈條件。</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => onConfirm(name.trim())}
          >
            建立
          </button>
        </div>
      </div>
    </div>
  )
}
