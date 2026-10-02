import { Script } from "scripting"
import { findSubtitleCue, parseSubtitleTrack } from "../subtitles"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const srt = parseSubtitleTrack(`\uFEFF1\r\n00:00:01,2 --> 00:00:03,500\r\n<i>第一行</i>\r\n字幕第二行\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n第二条字幕`)
  assert(srt.cues.length === 2, "SRT 应解析出有效字幕段")
  assert(srt.cues[0].text === "第一行 字幕第二行", "字幕换行应合并为单行并清理基础标签")
  assert(findSubtitleCue(srt, 1.2)?.text === "第一行 字幕第二行", "字幕起始时间应包含在显示区间内")
  assert(findSubtitleCue(srt, 3.5) === null, "字幕结束时间应为不包含的边界")
  assert(findSubtitleCue(srt, 4.5)?.text === "第二条字幕", "时间跳转后应匹配新字幕")

  const vtt = parseSubtitleTrack(`WEBVTT\n\nintro\n00:01.000 --> 00:02.250 align:start\nVTT 字幕`)
  assert(vtt.cues.length === 1 && findSubtitleCue(vtt, 1.5)?.text === "VTT 字幕", "WebVTT 时间戳和设置应正确解析")

  const generated = parseSubtitleTrack(`1\n00:00:01,000 --> 00:00:03,000\n字幕由 Transub Pro 生成 [www.transub.cc]\n\n2\n00:00:03,000 --> 00:00:05,000\n正常对白字幕`)
  assert(generated.cues.length === 1 && generated.cues[0].text === "正常对白字幕", "Transub 署名提示不应显示为视频字幕")
  assert(parseSubtitleTrack(`1\n00:00:01,000 --> 00:00:03,000\n字幕由 Transub Pro 生成 [www.transub.cc]`).cues.length === 0, "只有 Transub 署名的字幕文件应识别为无有效对白")

  const overlapping = parseSubtitleTrack(`1\n00:00:01,000 --> 00:00:05,000\n较早但较长\n\n2\n00:00:03,000 --> 00:00:04,000\n较新的重叠字幕`)
  assert(findSubtitleCue(overlapping, 3.5)?.text === "较新的重叠字幕", "重叠区间应优先选择最近开始的字幕")
  assert(findSubtitleCue(overlapping, Number.NaN) === null, "无效播放时间不应显示字幕")

  Script.exit({ passed: 10, message: "MISSAV subtitle parser and timing regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
