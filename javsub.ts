import { fetch } from "scripting"
import { loadWebViewPage } from "./webview"

const JAVSUB_ORIGIN = "https://javsub.ai"
const JAVSUB_HOME = `${JAVSUB_ORIGIN}/`
const JAVSUB_HOST = "javsub.ai"
const JAVSUB_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const SEARCH_TIMEOUT_MS = 20_000

export type JavSubSubtitleFile = {
  id: string
  source: "JavSub.ai"
  language: string
  details: string
  downloadURL: string
  isFree: boolean
  isDemo: boolean
}

export type JavSubSubtitleSearchResult = {
  title: string
  totalCount: number
  files: JavSubSubtitleFile[]
  cookieHeader: string
}

type RawJavSubFile = { url?: unknown; details?: unknown }
type RawJavSubListing = { title?: unknown; totalCount?: unknown; files?: unknown }
type JavSubCookie = { name?: unknown; value?: unknown; domain?: unknown; expiresDate?: unknown }

export async function searchJavSubSubtitleFiles(controller: WebViewController, value: string): Promise<JavSubSubtitleSearchResult> {
  const videoCode = normalizeJavSubVideoCode(value)
  let page = await loadWebViewPage(controller, JAVSUB_HOME)
  if (!page.loaded || !page.finished || !page.html) throw new Error("JavSub.ai 页面加载失败，请检查网络后重试。")

  if (isJavSubChallenge(page.html)) {
    await Dialog.alert({ title: "需要完成网站验证", message: "JavSub.ai 要求先验证访问线路。请在随后打开的网页中完成人机验证并关闭网页，应用会继续搜索。" })
    await controller.present({ fullscreen: true, navigationTitle: "JavSub.ai 验证" })
    page = await loadWebViewPage(controller, JAVSUB_HOME)
    if (!page.loaded || !page.finished || !page.html || isJavSubChallenge(page.html)) {
      throw new Error("JavSub.ai 验证尚未完成，暂时无法搜索字幕。")
    }
  }

  const searchScript = `(() => {
    const code = ${JSON.stringify(videoCode)};
    const inputs = Array.from(document.querySelectorAll("input"));
    const input = inputs.find(item => /search by code|search code|search by title/i.test([item.placeholder, item.name, item.id, item.getAttribute("aria-label") || ""].join(" ")))
      || inputs.find(item => item.type === "search")
      || inputs.find(item => item.type !== "hidden" && item.type !== "submit" && item.type !== "button");
    if (!input) return "search-field-not-found";
    input.focus();
    input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (input.form) {
      if (typeof input.form.requestSubmit === "function") input.form.requestSubmit();
      else input.form.submit();
      return "submitted";
    }
    const button = Array.from(document.querySelectorAll("button, input[type=submit]")).find(item => {
      const label = [item.innerText || "", item.value || "", item.getAttribute("aria-label") || "", item.title || ""].join(" ");
      return /search|find/i.test(label) || item.closest("form") === input.closest("form");
    });
    if (button) { button.click(); return "submitted"; }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    return "submitted";
  })()`
  const submitted = await controller.evaluateJavaScript<string>(searchScript)
  if (submitted !== "submitted") throw new Error("没有找到 JavSub.ai 的番号搜索框，请稍后重试。")

  const resultPage = await waitForJavSubResultPage(controller)
  if (resultPage.noResults) return { title: "", totalCount: 0, files: [], cookieHeader: await javSubCookieHeader(controller) }

  const listingScript = `(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/download/"]'));
    const files = anchors.map(anchor => {
      let node = anchor.parentElement;
      let details = (anchor.innerText || anchor.textContent || "").replace(/\\s+/g, " ").trim();
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = (node.innerText || "").replace(/\\s+/g, " ").trim();
        if (text.length > 320) break;
        if (text && text.length > details.length) details = text;
      }
      return { url: anchor.href, details };
    });
    const pageText = document.body ? document.body.innerText : "";
    const count = pageText.match(/available subtitles\\s*\\((\\d+)\\)/i);
    return JSON.stringify({ title: document.querySelector("h1")?.innerText || document.title || "", totalCount: count ? Number(count[1]) : files.length, files });
  })()`
  const payload = await controller.evaluateJavaScript<string>(listingScript)
  if (!payload) throw new Error("JavSub.ai 已打开作品页，但没有读取到字幕列表。")
  const parsed = parseJavSubSubtitleListing(payload)
  return { ...parsed, cookieHeader: await javSubCookieHeader(controller) }
}

export function parseJavSubSubtitleListing(payload: string): Omit<JavSubSubtitleSearchResult, "cookieHeader"> {
  let raw: RawJavSubListing
  try { raw = JSON.parse(payload) as RawJavSubListing }
  catch { throw new Error("JavSub.ai 返回的字幕列表格式无法识别。") }

  const candidates = Array.isArray(raw.files) ? raw.files as RawJavSubFile[] : []
  const files: JavSubSubtitleFile[] = []
  const seen = new Set<string>()
  for (const candidateValue of candidates.slice(0, 100)) {
    if (!candidateValue || typeof candidateValue !== "object") continue
    const candidate = candidateValue as RawJavSubFile
    if (typeof candidate.url !== "string") continue
    let url: URL
    try { url = new URL(candidate.url, JAVSUB_ORIGIN) }
    catch { continue }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== JAVSUB_HOST) continue
    const match = url.pathname.match(/^\/download\/(free|demo)\/([a-z0-9-]+)\/?$/i)
    if (!match) continue
    const id = match[2].toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    const isFree = match[1].toLowerCase() === "free"
    const details = normalizeVisibleText(typeof candidate.details === "string" ? candidate.details : "")
    files.push({ id, source: "JavSub.ai", language: parseJavSubLanguage(details), details, downloadURL: url.toString(), isFree, isDemo: !isFree })
  }

  files.sort((left, right) => languagePriority(left.language) - languagePriority(right.language))
  const rawCount = typeof raw.totalCount === "number" && Number.isFinite(raw.totalCount) ? Math.max(0, Math.floor(raw.totalCount)) : files.length
  return {
    title: typeof raw.title === "string" ? normalizeVisibleText(raw.title) : "",
    totalCount: Math.max(rawCount, files.length),
    files,
  }
}

export async function downloadJavSubSubtitleFile(file: JavSubSubtitleFile, cookieHeader = ""): Promise<string> {
  if (!file.isFree || file.isDemo) throw new Error("这个条目只是字幕预览，不是可导入的完整字幕文件。")
  const url = new URL(file.downloadURL)
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== JAVSUB_HOST || !/^\/download\/free\/[a-z0-9-]+\/?$/i.test(url.pathname)) {
    throw new Error("字幕下载地址不安全，已取消下载。")
  }

  let storageURL: string | null = null
  const headers: Record<string, string> = {
    Accept: "text/plain, application/x-subrip, text/vtt, */*",
    "User-Agent": JAVSUB_USER_AGENT,
  }
  if (cookieHeader) headers.Cookie = cookieHeader
  const response = await fetch(url.toString(), {
    headers,
    timeout: 45,
    debugLabel: "Download JavSub subtitle",
    handleRedirect: async request => {
      let target: URL
      try { target = new URL(request.url) }
      catch { return null }
      if (target.protocol === "https:" && target.hostname.toLowerCase() === JAVSUB_HOST) return request
      if (target.protocol === "https:" && isJavSubStorageHost(target.hostname)) storageURL = target.toString()
      // Stop before leaving JavSub.ai so its cookies are never forwarded to storage.
      return null
    },
  })

  const content = storageURL
    ? await readSubtitleResponse(await fetch(storageURL, {
      headers: { Accept: "text/plain, application/x-subrip, text/vtt, */*", "User-Agent": JAVSUB_USER_AGENT },
      timeout: 45,
      debugLabel: "Read JavSub subtitle file",
    }))
    : await readSubtitleResponse(response)
  if (isJavSubChallenge(content) || /^\s*<!doctype\s+html/i.test(content)) {
    throw new Error("JavSub.ai 暂时阻止了文件下载。请先在设置/浏览器中打开 JavSub.ai 并完成验证，再重试。")
  }
  return content
}

function normalizeJavSubVideoCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/\s+/g, "-")
  if (!/^[A-Z0-9]{2,16}(?:-[A-Z0-9]{1,16}){0,2}$/.test(code)) throw new Error("请输入有效的作品番号。")
  return code
}

async function waitForJavSubResultPage(controller: WebViewController): Promise<{ noResults: boolean }> {
  const deadline = Date.now() + SEARCH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const raw = await controller.evaluateJavaScript<string>(`JSON.stringify({ url: location.href, text: (document.body?.innerText || "").slice(0, 2000) })`)
      if (raw) {
        const state = JSON.parse(raw) as { url?: unknown; text?: unknown }
        const currentURL = typeof state.url === "string" ? new URL(state.url) : null
        const text = typeof state.text === "string" ? state.text : ""
        if (isJavSubChallenge(text)) throw new Error("JavSub.ai 访问验证未完成，请完成验证后重试。")
        if (currentURL?.origin === JAVSUB_ORIGIN && /^\/subtitles\/[a-z0-9-]+-\d+\/?$/i.test(currentURL.pathname)) return { noResults: false }
        if (/no subtitles found|no results for|title not found/i.test(text)) return { noResults: true }
      }
    } catch (reason) {
      if (reason instanceof Error && /验证未完成/.test(reason.message)) throw reason
    }
    await pause(250)
  }
  throw new Error("JavSub.ai 搜索超时，页面没有返回该番号的字幕结果。")
}

async function javSubCookieHeader(controller: WebViewController): Promise<string> {
  try {
    const cookies = await controller.getCookies(JAVSUB_HOME) as JavSubCookie[]
    const now = Date.now()
    return cookies.filter(cookie => {
      if (typeof cookie.name !== "string" || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(cookie.name)) return false
      if (typeof cookie.value !== "string" || !cookie.value) return false
      if (typeof cookie.domain === "string") {
        const domain = cookie.domain.replace(/^\./, "").toLowerCase()
        if (domain !== JAVSUB_HOST && !JAVSUB_HOST.endsWith(`.${domain}`)) return false
      }
      if (cookie.expiresDate instanceof Date && cookie.expiresDate.getTime() <= now) return false
      return true
    }).map(cookie => `${cookie.name}=${String(cookie.value)}`).join("; ")
  } catch { return "" }
}

async function readSubtitleResponse(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  if (!response.ok) throw new Error(`字幕下载失败（HTTP ${response.status}）。`)
  return response.text()
}

function isJavSubStorageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "s3.amazonaws.com" || host.endsWith(".s3.amazonaws.com")
}

function isJavSubChallenge(value: string): boolean {
  return /just a moment|verify you are human|checking your browser|attention required|sorry, you have been blocked|security verification|请验证您是真人/i.test(value)
}

function parseJavSubLanguage(text: string): string {
  const value = text.toLowerCase()
  if (/chinese\s*\(\s*traditional\s*\)/.test(value)) return "繁体中文"
  if (/\bchinese\b/.test(value)) return "简体中文"
  if (/\bjapanese\b/.test(value)) return "日语"
  if (/\benglish\b/.test(value)) return "英语"
  if (/\bkorean\b/.test(value)) return "韩语"
  if (/\bindonesian\b/.test(value)) return "印尼语"
  if (/\bthai\b/.test(value)) return "泰语"
  if (/\bspanish\b/.test(value)) return "西班牙语"
  if (/\bvietnamese\b/.test(value)) return "越南语"
  return "其他语言"
}

function languagePriority(language: string): number {
  if (language === "简体中文") return 0
  if (language === "繁体中文") return 1
  return 2
}

function normalizeVisibleText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
