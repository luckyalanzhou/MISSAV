import { Script } from "scripting"
import { isCloudflareChallengeHTML, isLikelyMissAVHTML, parseMissAVSearchPage, parseMissAVVideoDetail } from "../html-parser"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const page = parseMissAVSearchPage(`
    <h1>Browse videos</h1>
    <div class="video">
      <a href="/ja/ABC-123"><img src="/covers/abc.jpg" alt="ABC-123 sample title"></a>
      <a href="/ja/ABC-123">ABC-123 sample title</a>
      <a href="/ja/ABC-123">1:23:45</a>
      <a href="/ja/new?page=2">Next</a>
    </div>
  `, 1)
  assert(page.title === "Browse videos", "列表标题应从页面 HTML 中解析")
  assert(page.items.length === 1, "列表页应解析出作品卡片且不重复")
  assert(page.items[0].title === "ABC-123 sample title" && page.items[0].duration === "1:23:45", "卡片标题和时长应正确解析")
  assert(page.items[0].detailPath.endsWith("/ja/ABC-123") && page.items[0].coverUrl.endsWith("/covers/abc.jpg"), "相对详情和封面地址应规范化")
  assert(page.hasNext, "下一页链接应被识别")

  const detail = parseMissAVVideoDetail(`
    <html><head>
      <meta property="og:title" content="Sample detail &amp; title">
      <meta property="og:video:duration" content="83">
    </head><body><video src="https://cdn.example/asset/1080p/video.m3u8"></video></body></html>
  `, "ABC-123", "https://missav.ws/ja/ABC-123")
  assert(detail.title === "Sample detail & title" && detail.duration === "1:23", "详情标题和时长应正确解析")
  assert(detail.sources.length === 1 && detail.sources[0].label === "1080p", "详情页播放源应保留并显示分辨率")

  assert(isCloudflareChallengeHTML("<html><head><title>Just a moment</title></head><body>Checking your browser</body></html>"), "Cloudflare 验证页应被识别")
  assert(isLikelyMissAVHTML(`<html><head><title>MISSAV</title></head><body><main>${"content ".repeat(80)}</main></body></html>`), "正常 MISSAV 内容页应被识别")
  Script.exit({ passed: 9, message: "MISSAV client parser regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
