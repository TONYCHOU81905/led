import { useCallback, useRef, useState } from 'react'

/**
 * Timeline 編輯的 undo / redo。
 *
 * 用快照式（存整份陣列）而不是指令式（存 do/undo 函式）：
 * events 頂多幾百筆，快照成本可忽略；指令式要為每一種操作各寫一對函式，
 * 複雜度高很多，而且只要有人新增了操作卻忘了寫對應的 undo，就會出現
 * 「按了沒反應」或「退到錯誤狀態」這種很難查的問題。
 *
 * 粒度是一個「動作」一步，不是一次 state 更新一步。
 * 拖曳過程中滑鼠會觸發幾十次更新，若每次都記錄，按一次 undo 只會退一個像素。
 */

export const DEFAULT_HISTORY_LIMIT = 50

export interface UndoHistory<T> {
  /** 在「即將改變」之前呼叫，把當前狀態推進 undo 堆疊。 */
  commit: (present: T) => void
  /** 回傳要還原成的狀態；沒有可退的步驟時回 null。 */
  undo: (present: T) => T | null
  /** 回傳要重做的狀態；沒有可重做的步驟時回 null。 */
  redo: (present: T) => T | null
  /** 清空兩個堆疊（例如切換角色時）。 */
  reset: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useUndoHistory<T>(limit = DEFAULT_HISTORY_LIMIT): UndoHistory<T> {
  const undoStack = useRef<T[]>([])
  const redoStack = useRef<T[]>([])
  // 只為了讓按鈕的 disabled 狀態能重繪；真正的資料在 ref 裡。
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const commit = useCallback(
    (present: T) => {
      undoStack.current.push(present)
      if (undoStack.current.length > limit) undoStack.current.shift()
      // 產生新動作後，原本的 redo 路徑就失效了 —— 這是 undo/redo 的標準語意，
      // 留著會讓使用者 redo 到一個從未存在過的混合狀態。
      redoStack.current = []
      bump()
    },
    [limit, bump]
  )

  const undo = useCallback(
    (present: T): T | null => {
      const prev = undoStack.current.pop()
      if (prev === undefined) return null
      redoStack.current.push(present)
      bump()
      return prev
    },
    [bump]
  )

  const redo = useCallback(
    (present: T): T | null => {
      const next = redoStack.current.pop()
      if (next === undefined) return null
      undoStack.current.push(present)
      bump()
      return next
    },
    [bump]
  )

  const reset = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    bump()
  }, [bump])

  return {
    commit,
    undo,
    redo,
    reset,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0
  }
}
