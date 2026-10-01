export type SubtitleCue = {
  startSeconds: number
  endSeconds: number
  text: string
}

export type SubtitleTrack = {
  cues: SubtitleCue[]
  prefixMaxEndSeconds: number[]
}

const parseTimestamp = (value: string): number | null => {
  const long = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (long) {
    const hours = Number(long[1])
    const minutes = Number(long[2])
    const seconds = Number(long[3])
    const milliseconds = Number(long[4].padEnd(3, "0"))
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
  }

  const short = value.trim().match(/^(\d{2}):(\d{2})\.(\d{1,3})$/)
  if (!short) return null
  const minutes = Number(short[1])
  const seconds = Number(short[2])
  const milliseconds = Number(short[3].padEnd(3, "0"))
  return minutes * 60 + seconds + milliseconds / 1000
}

const normalizeCueText = (lines: string[]): string => lines
  .join(" ")
  .replace(/<[^>]*>/g, "")
  .replace(/\{\\[^}]*\}/g, "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim()

export function parseSubtitleTrack(source: string): SubtitleTrack {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const cues: SubtitleCue[] = []

  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split("\n")
    const timingIndex = lines.findIndex(line => line.includes("-->"))
    if (timingIndex < 0) continue

    const [startValue, endValue] = lines[timingIndex].split("-->", 2)
    const startSeconds = startValue ? parseTimestamp(startValue.trim()) : null
    const endToken = endValue?.trim().split(/\s+/, 1)[0]
    const endSeconds = endToken ? parseTimestamp(endToken) : null
    const text = normalizeCueText(lines.slice(timingIndex + 1))
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) continue
    cues.push({ startSeconds, endSeconds, text })
  }

  cues.sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds)
  let maxEndSeconds = Number.NEGATIVE_INFINITY
  const prefixMaxEndSeconds = cues.map(cue => {
    maxEndSeconds = Math.max(maxEndSeconds, cue.endSeconds)
    return maxEndSeconds
  })
  return { cues, prefixMaxEndSeconds }
}

export function findSubtitleCue(track: SubtitleTrack, timeSeconds: number): SubtitleCue | null {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !track.cues.length) return null

  let low = 0
  let high = track.cues.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (track.cues[middle].startSeconds <= timeSeconds) low = middle + 1
    else high = middle
  }

  for (let index = low - 1; index >= 0; index -= 1) {
    if (track.prefixMaxEndSeconds[index] <= timeSeconds) break
    const cue = track.cues[index]
    if (cue.startSeconds <= timeSeconds && timeSeconds < cue.endSeconds) return cue
  }
  return null
}

export const MISSAV_SUBTITLE_PREVIEW = parseSubtitleTrack(`1
00:00:01,000 --> 00:00:05,500
本地字幕测试：应在横屏底部单行显示

2
00:00:05,500 --> 00:00:11,500
拖动播放进度，字幕应切换到这一行

3
00:00:11,500 --> 00:00:19,500
暂停时字幕保持，继续播放后按时间更新
`)
