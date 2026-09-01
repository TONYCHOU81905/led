/**
 * app-media protocol 的 Range 處理。
 *
 * 抽成獨立模組是為了能單元測試：main.ts 在 top-level 就呼叫
 * protocol.registerSchemesAsPrivileged，在沒有 Electron 的測試環境 import
 * 會直接爆掉，所以純函式不能放在那裡。
 */

/** 由副檔名推 Content-Type。<video> 需要正確的型別才會啟用串流解碼。 */
export function mediaContentType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg'
  }
  return map[ext] ?? 'application/octet-stream'
}

/**
 * 解析 Range header。只支援單一區間（bytes=start-end），這是 <video> 唯一會送的形式。
 *
 * 回 null 表示「沒有 Range，或這個 Range 不合法」，呼叫端一律退回整個檔案（200）。
 * 刻意不對不合法的輸入回傳猜測的區間 —— 回錯區間會讓解碼器拿到錯位的資料，
 * 那比整檔重傳難查太多。
 */
export function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number
): { start: number; end: number } | null {
  if (!rangeHeader) return null
  if (fileSize <= 0) return null

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!m) return null

  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // bytes=-N：檔案最後 N bytes
    const suffixLen = Number(rawEnd)
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null
    start = Math.max(0, fileSize - suffixLen)
    end = fileSize - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? fileSize - 1 : Number(rawEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start >= fileSize) return null
  if (end < start) return null
  return { start, end: Math.min(end, fileSize - 1) }
}
