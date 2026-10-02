import { Script } from "scripting"
import { parseSubtitleCatFileHTML, parseSubtitleCatFileListing, parseSubtitleCatSearchHTML } from "../subtitlecat"

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

  assert(files.length === 2, "只应保留去重后的简体中文和繁体中文 SRT 文件")
  assert(files[0].language === "简体中文" && files[1].language === "繁体中文", "结果只应包含简体中文和繁体中文")
  assert(files.every(file => file.source === "SubtitleCat" && file.isFree && !file.isDemo), "Subtitle Cat 的公开 SRT 应明确标记来源和免费完整状态")
  assert(files.every(file => file.language === "简体中文" || file.language === "繁体中文"), "英语等其他语言不得出现在结果中")

  const searchHTML = `<h2>4 subtitles found <span>(we have many subtitles)</span></h2>
    <a href="subs/1706/FNS-258.zh-cn%28by%20transub.cc%29.html">FNS-258.zh-cn(by transub.cc)</a>
    <a href="https://subtitlecat.com/subs/1706/FNS-258.zh-cn(by%20transub.cc).html">Duplicate FNS-258</a>
    <a href="subs/1706/FNS-2580.html">FNS-2580</a>
    <a href="https://evil.example/subs/1706/FNS-258.html">FNS-258</a>`
  const entries = parseSubtitleCatSearchHTML(searchHTML, "FNS-258")
  assert(entries.length === 1, "真实站点的相对结果链接应识别、去重，且不能匹配另一个番号或外部站点")
  assert(entries[0].url.startsWith("https://www.subtitlecat.com/subs/1706/"), "www 与非 www 的官方链接应统一处理")
  assert(parseSubtitleCatSearchHTML("<h2>0 subtitles found</h2>", "FNS-258").length === 0, "站点明确报告零结果时应正常完成搜索")
  let invalidPageRejected = false
  try { parseSubtitleCatSearchHTML("<html><body>Connection error</body></html>", "FNS-258") }
  catch { invalidPageRejected = true }
  assert(invalidPageRejected, "加载错误页面不得被当成没有字幕")

  const suffixedSearchHTML = `<h2>3 subtitles found</h2>
    <a href="subs/1/IPZZ-977.zh-cn.html">IPZZ-977 中文字幕</a>
    <a href="subs/2/IPZZ-977-UNCENSORED.html">IPZZ-977-UNCENSORED</a>
    <a href="subs/3/IPZZ-9770.zh-cn.html">IPZZ-9770</a>`
  assert(parseSubtitleCatSearchHTML(suffixedSearchHTML, "IPZZ-977-UNCENSORED-LEAK").length === 2, "使用基础番号筛选结果，同时排除不同数字番号")

  const detailHTML = `<h2>All language subtitles for FNS-258.zh-cn(by transub.cc)</h2>
    <div class="sub-single"><span>Chinese (Simplified)</span><a id="download_zh-CN" href="/subs/1706/FNS-258.zh-cn(by transub.cc)-zh-CN.srt">Download</a></div>
    <div class="sub-single"><span>Chinese (Traditional)</span><a id="download_zh-TW" href="/subs/1707/FNS-258.zh-cn(by transub.cc)-zh-TW.srt">Download</a></div>
    <div class="sub-single"><span>English</span><a id="download_en" href="/subs/1706/FNS-258.zh-cn(by transub.cc)-en.srt">Download</a></div>
    <div class="sub-single"><span>Japanese</span><button id="ja">Translate</button></div>`
  const detailFiles = parseSubtitleCatFileHTML(detailHTML)
  assert(detailFiles.length === 2, "详情页只应列出简繁中文直接 SRT 文件，Translate 按钮和英语文件不能当可用结果")
  assert(detailFiles.map(file => file.language).join(",") === "简体中文,繁体中文", "原始文件名里的 zh-cn 不得覆盖翻译文件末尾的语言代码")
  assert(parseSubtitleCatFileListing(JSON.stringify([{ url: "/subs/1706/FNS-258.zh-cn(original)-en.srt", details: "Chinese (Simplified) original file" }])).length === 0, "文件末尾标记英语时不得因原文件名包含 zh-cn 而误收")

  Script.exit({ passed: 13, message: "Subtitle Cat public search and file listing regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
