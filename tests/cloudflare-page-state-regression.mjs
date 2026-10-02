import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

globalThis.Storage = { get: () => null, set: () => {} }
const parser = await import(compile("../html-parser.ts"))
const { loadWebViewPage, isMatchingWebViewURL, readMatchingWebViewDocument } = await import(compile("../webview.ts"))
const url = "https://missav.ws/cn/new?sort=published_at"
const listing = `<html><head><title>MISSAV</title></head><body><h1>作品列表</h1>
  <a href="/cn/TEST-001"><img src="/cover.jpg" alt="TEST-001 sample"></a>
  <a href="/cn/TEST-001">TEST-001 sample</a><a href="/cn/TEST-001">2:00:00</a>
  ${"fixture ".repeat(80)}</body></html>`
const automatic = '<html><head><title>Just a moment...</title></head><body>Checking your browser<script src="/cdn-cgi/challenge-platform/script.js"></script></body></html>'
const interactive = '<html><head><title>missav.ws</title></head><body>请验证您是真人<div id="cf-turnstile"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>'
const denied = '<html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked. Cloudflare Ray ID: fixture</body></html>'

for (const script of [
  '<script src="/cdn-cgi/challenge-platform/scripts/jsd/api.js"></script>',
  '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
  '<script>const translatedPrompt = "Verify you are human";</script>',
  '<!-- Verify you are human /cdn-cgi/challenge-platform -->',
  '<!-- <form id="challenge-form">Verify you are human</form> -->',
  '<script>const example = `<form id="challenge-form">Verify you are human</form>`;</script>',
  '<meta name="cf-mitigated" content="challenge">',
]) {
  const html = listing.replace('</body>', `${script}</body>`)
  assert.equal(parser.classifyCloudflareHTML(html), "none")
  assert.equal(parser.isCloudflareChallengeHTML(html), false)
  assert.equal(parser.isLikelyMissAVListingHTML(html), true)
}
assert.equal(parser.classifyCloudflareHTML('<html><title>MISSAV</title><body><script src="/cdn-cgi/challenge-platform/scripts/jsd/api.js"></script></body></html>'), "none", "A script alone is not a challenge even without cards")
assert.equal(parser.classifyCloudflareHTML('<html><title>MISSAV</title><body><form><input type="email"><input type="password"><div class="cf-turnstile">Verify you are human</div></form></body></html>'), "none", "An embedded form widget is not a whole-page route challenge")
for (const html of [automatic, interactive,
  '<html><body>接続を確認しています<script src="/cdn-cgi/challenge-platform/script.js"></script></body></html>',
  '<html><body><script>window._cf_chl_opt = {fixture:true}</script></body></html>',
  '<html><body><div class="cf-turnstile"></div></body></html>',
  listing.replace('<body>', '<body><form id="challenge-form"></form>'),
]) assert.equal(parser.classifyCloudflareHTML(html), "challenge")
assert.equal(parser.classifyCloudflareHTML(denied), "blocked")
assert.equal(parser.classifyCloudflareHTML('<html><title>Cloudflare Error</title><body>Bad gateway. Cloudflare Ray ID: fixture</body></html>'), "none", "A gateway error is not human verification")
assert.equal(parser.classifyCloudflareHTML('<html><title>Cloudflare Error</title><body>Error 1015. You are being rate limited. Cloudflare Ray ID: fixture</body></html>'), "blocked")
assert.equal(parser.isCloudflareChallengeHTML(denied), true, "Account code must continue rejecting blocked documents")

assert.equal(isMatchingWebViewURL('https://missav.ws/dm999/cn/new?sort=published_at&__cf_chl_tk=fixture#top', url), true)
assert.equal(isMatchingWebViewURL('https://missav.ws/cn/new/?page=1&sort=published_at', url), true)
for (const actual of [
  'https://missav.ai/cn/new?sort=published_at', 'https://other.example/cn/new?sort=published_at',
  'https://missav.ws/ja/new?sort=published_at', 'https://missav.ws/cn/release?sort=published_at',
  'https://missav.ws/cn/new?page=2&sort=published_at', 'https://missav.ws/cn/new?sort=views',
  'https://missav.ws/cn/new?sort=published_at&filters=individual', 'about:blank',
  'https://missav.ws/cn/new?sort=published_at&sort=views',
]) assert.equal(isMatchingWebViewURL(actual, url), false, actual)
assert.equal(await readMatchingWebViewDocument({ evaluateJavaScript: async () => listing }, url), null, "No unverified HTML-only bridge fallback")

const nativeTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 300 ? 0 : delay, ...args)
function controller(documents) {
  let index = 0
  const loads = []
  const api = {
    loadURL: async target => { loads.push(target); return true },
    waitForLoad: async () => true,
    evaluateJavaScript: async source => {
      assert.match(source, /url: window\.location\.href/)
      const document = documents[Math.min(index++, documents.length - 1)]
      return typeof document === 'string' ? { url, html: document } : document
    },
  }
  return { api, loads, get reads() { return index } }
}
try {
  const transient = controller([automatic, automatic, listing])
  const recovered = await loadWebViewPage(transient.api, url)
  assert.equal(recovered.html, listing)
  assert.equal(recovered.challengeObserved, true)
  assert.equal(transient.reads, 3)
  assert.deepEqual(transient.loads, [url], "Wait in the same WebView; never issue repeat navigation")
  const promptOnlyInScript = automatic.replace('</body>', '<script>const prompt="Verify you are human";</script></body>')
  const scriptPrompt = controller([promptOnlyInScript, listing])
  assert.equal((await loadWebViewPage(scriptPrompt.api, url)).html, listing, "Script strings do not prove that manual interaction is needed")
  const human = controller([interactive])
  assert.equal((await loadWebViewPage(human.api, url)).html, interactive)
  assert.equal(human.reads, 1, "Explicit human verification can be presented promptly by Settings")
  const persistent = controller([automatic])
  assert.equal((await loadWebViewPage(persistent.api, url)).html, automatic)
  assert.equal(persistent.reads, 10, "Automatic challenge polling must be bounded")
  const blocked = controller([denied])
  assert.equal((await loadWebViewPage(blocked.api, url)).html, denied)
  assert.equal(blocked.reads, 1)
  const wrongRoute = controller([{ url: 'https://missav.ws/cn/release?sort=published_at', html: listing }])
  assert.equal((await loadWebViewPage(wrongRoute.api, url)).html, null, "A previous route listing cannot validate this route")
  const wrongThenRight = controller([{ url: 'https://other.example/', html: listing }, listing])
  assert.equal((await loadWebViewPage(wrongThenRight.api, url)).html, listing)
  assert.equal(wrongThenRight.reads, 2)
  const challengeThenWrong = controller([automatic, { url: 'https://other.example/', html: listing }])
  assert.equal((await loadWebViewPage(challengeThenWrong.api, url)).html, null, "Never return a stale challenge after leaving the route")

  let releaseRead
  let bridgeReads = 0
  const pending = loadWebViewPage({ loadURL: async () => true, waitForLoad: async () => true,
    evaluateJavaScript: () => { bridgeReads++; return new Promise(resolve => { releaseRead = resolve }) },
  }, url, 15)
  await assert.rejects(pending, /网页加载超时/)
  releaseRead({ url, html: listing })
  await new Promise(resolve => nativeTimeout(resolve, 5))
  assert.equal(bridgeReads, 1, "Late bridge results cannot start another read after timeout/disposal")
  console.log("PASS: background-script false positives; real challenges/access denial; bounded automatic transition; atomic route validation; late-read timeout safety")
} finally { globalThis.setTimeout = nativeTimeout }
