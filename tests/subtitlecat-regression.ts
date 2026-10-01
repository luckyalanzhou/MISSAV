import { Script } from "scripting"
import { parseSubtitleCatFileListing } from "../subtitlecat"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const files = parseSubtitleCatFileListing(JSON.stringify([
    { url: "https://www.subtitlecat.com/subs/1647/SNOS-130--en.srt", details: "English Download" },
    { url: "https://www.subtitlecat.com/subs/1652/SNOS-130--zh-TW.srt", details: "Chinese (Traditional) Download" },
    { url: "https://www.subtitlecat.com/subs/1708/SNOS-130--zh-CN.srt", details: "Chinese (Simplified) Download" },
    { url: "https://www.subtitlecat.com/subs/1708/SNOS-130--zh-CN.srt", details: "duplicate" },
    { url: "https://evil.example/subs/1708/SNOS-130--zh-CN.srt", details: "wrong origin" },
    { url: "https://www.subtitlecat.com/subs/1708/not-a-subtitle.html", details: "not an SRT" },
  ]))

  assert(files.length === 3, "只应保留去重后的 Subtitle Cat SRT 下载文件")
  assert(files[0].language === "简体中文" && files[1].language === "繁体中文", "聚合列表内简体中文和繁体中文应优先置顶")
  assert(files.every(file => file.source === "SubtitleCat" && file.isFree && !file.isDemo), "Subtitle Cat 的公开 SRT 应明确标记来源和免费完整状态")
  assert(files[2].language === "英语", "应从字幕文件名或可见详情中识别英语")

  Script.exit({ passed: 4, message: "Subtitle Cat subtitle listing regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
