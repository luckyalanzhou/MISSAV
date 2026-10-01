import { Script } from "scripting"
import { isCloudflareChallengeHTML, isLikelyMissAVHTML, isLikelyMissAVListingHTML, parseMissAVSearchPage, parseMissAVVideoDetail } from "../html-parser"

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
  assert(page.items[0].detailPath.endsWith("/cn/ABC-123") && page.items[0].coverUrl.endsWith("/covers/abc.jpg"), "旧语言详情应转为 cn，封面地址应保持不变")
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
  assert(isCloudflareChallengeHTML("<html><head><title>missav.ws</title></head><body><div id=\"cf-turnstile\">Verify you are human</div></body></html>"), "标题没有 Cloudflare 字样时也应根据验证组件识别挑战页")
  assert(isCloudflareChallengeHTML("<html><head><title>missav.ws</title></head><body>接続を確認しています<script src=\"/cdn-cgi/challenge-platform/script.js\"></script></body></html>"), "应识别本地化 Cloudflare 挑战资源")
  assert(isLikelyMissAVHTML(`<html><head><title>MISSAV</title></head><body><main>${"content ".repeat(80)}</main></body></html>`), "正常 MISSAV 内容页应被识别")
  const listingHTML = `<html><head><title>MISSAV</title></head><body><h1>Browse videos</h1><a href="/ja/ABC-123"><img src="/cover.jpg" alt="ABC-123 sample title"></a><a href="/ja/ABC-123">ABC-123 sample title</a><a href="/ja/ABC-123">1:23:45</a><!-- ${"content ".repeat(80)} --></body></html>`
  assert(isLikelyMissAVListingHTML(listingHTML), "只有包含可解析作品卡片的页面才应作为有效列表")
  assert(!isLikelyMissAVListingHTML(`<html><head><title>MISSAV</title></head><body><main>${"content ".repeat(80)}</main></body></html>`), "只有品牌字样但没有作品卡片的页面不得验证通过")
  assert(!isLikelyMissAVListingHTML("<html><head><title>Just a moment</title></head><body>Checking your browser</body></html>"), "Cloudflare 挑战页不得验证为作品列表")
  Script.exit({ passed: 14, message: "MISSAV client parser regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
