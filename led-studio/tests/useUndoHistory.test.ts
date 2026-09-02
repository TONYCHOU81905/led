// @vitest-environment jsdom
// renderHook 需要 DOM；本專案只有 tests/ui/ 預設吃 jsdom，這支放在 tests/ 根層，
// 所以用 docblock 單獨指定環境。
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoHistory } from '../src/features/timeline/hooks/useUndoHistory'

describe('useUndoHistory', () => {
  it('沒有動作時 undo / redo 都回 null', () => {
    const { result } = renderHook(() => useUndoHistory<string>())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    act(() => {
      expect(result.current.undo('now')).toBeNull()
      expect(result.current.redo('now')).toBeNull()
    })
  })

  it('commit 之後可以 undo 回上一步', () => {
    const { result } = renderHook(() => useUndoHistory<string>())
    act(() => result.current.commit('A'))
    expect(result.current.canUndo).toBe(true)

    let restored: string | null = null
    act(() => {
      restored = result.current.undo('B')
    })
    expect(restored).toBe('A')
    expect(result.current.canRedo).toBe(true)
  })

  it('undo 之後可以 redo 回去', () => {
    const { result } = renderHook(() => useUndoHistory<string>())
    act(() => result.current.commit('A'))
    act(() => {
      result.current.undo('B')
    })
    let redone: string | null = null
    act(() => {
      redone = result.current.redo('A')
    })
    expect(redone).toBe('B')
  })

  it('undo 之後做新動作，redo 路徑要被截斷', () => {
    const { result } = renderHook(() => useUndoHistory<string>())
    act(() => result.current.commit('A'))
    act(() => {
      result.current.undo('B')
    })
    expect(result.current.canRedo).toBe(true)

    // 新動作
    act(() => result.current.commit('A2'))
    expect(result.current.canRedo).toBe(false)
  })

  it('超過深度上限時丟掉最舊的一步', () => {
    const { result } = renderHook(() => useUndoHistory<number>(3))
    act(() => {
      result.current.commit(1)
      result.current.commit(2)
      result.current.commit(3)
      result.current.commit(4) // 1 被擠掉
    })

    const seen: number[] = []
    act(() => {
      let cur = 5
      for (let i = 0; i < 5; i++) {
        const prev = result.current.undo(cur)
        if (prev === null) break
        seen.push(prev)
        cur = prev
      }
    })
    // 只留得住最近 3 步：4, 3, 2（1 已被擠掉）
    expect(seen).toEqual([4, 3, 2])
  })

  it('reset 會清空兩個堆疊（切換角色時用）', () => {
    const { result } = renderHook(() => useUndoHistory<string>())
    act(() => result.current.commit('A'))
    act(() => {
      result.current.undo('B')
    })
    expect(result.current.canUndo || result.current.canRedo).toBe(true)

    act(() => result.current.reset())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })
})
