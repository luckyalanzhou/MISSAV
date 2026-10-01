import { fetch } from "scripting"
import { loadWebViewPage, submitWebViewSearch } from "./webview"

const SUBTITLECAT_ORIGIN = "https://www.subtitlecat.com"
const SUBTITLECAT_HOME = `${SUBTITLECAT_ORIGIN}/`
const SEARCH_TIMEOUT_MS = 20_000

export type SubtitleCatSubtitleFile = {
  id: string
  source: "SubtitleCat"
  language: string
  details: string
  downloadURL: string
  isFree: true
  isDemo: false
}

export type SubtitleCatSearchResult = {
  files: SubtitleCatSubtitleFile[]
  searchResultCount: number
  failedDetailCount: number
}

type SubtitleCatSearchEntry = { url?: unknown; title?: unknown }
type SubtitleCatRawFile = { url?: unknown; details?: unknown }

export async function searchSubtitleCatFiles(controller: WebViewController, value: string): Promise<SubtitleCatSearchResult> {
  const videoCode = normalizeSubtitleCatVideoCode(value)
  let page = await loadWebViewPage(controller, SUBTITLECAT_HOME)
  if (!page.loaded || !page.finished || !page.html) throw new Error("Subtitle Cat 页面加载失败，请检查网络后重试。")

  if (isSubtitleCatChallenge(page.html)) {
    await Dialog.alert({ title: "需要完成网站验证", message: "Subtitle Cat 要求先验证访问线路。请在随后打开的网页中完成验证并关闭网页，应用会继续搜索。" })
    await controller.present({ fullscreen: true, navigationTitle: "Subtitle Cat 验证" })
    page = await loadWebViewPage(controller, SUBTITLECAT_HOME)
    if (!page.loaded || !page.finished || !page.html || isSubtitleCatChallenge(page.html)) {
      throw new Error("Subtitle Cat 验证尚未完成，暂时无法搜索字幕。")
    }
  }

  await submitWebViewSearch(controller, videoCode, "Subtitle Cat")

  const entries = await waitForSubtitleCatSearchResults(controller, videoCode)
  const files: SubtitleCatSubtitleFile[] = []
  const seen = new Set<string>()
  let failedDetailCount = 0
  for (const entry of entries) {
    if (!entry.url) continue
    let detailURL: URL
    try { detailURL = new URL(entry.url, SUBTITLECAT_ORIGIN) }
    catch { continue }
    if (detailURL.origin !== SUBTITLECAT_ORIGIN || !/^\/subs\/\d+\/[^/]+\.html$/i.test(detailURL.pathname)) continue

    try {
      const detailPage = await loadWebViewPage(controller, detailURL.toString(), 12_000)
      if (!detailPage.loaded || !detailPage.finished || !detailPage.html || isSubtitleCatChallenge(detailPage.html)) {
        failedDetailCount += 1
        continue
      }
      const listing = await controller.evaluateJavaScript<string>(`return (() => {
        const files = Array.from(document.querySelectorAll("a[href]"))
          .filter(anchor => /\\.srt(?:[?#]|$)/i.test(anchor.href))
          .map(anchor => {
          let node = anchor;
          let details = anchor.getAttribute("aria-label") || anchor.title || anchor.textContent || "";
          for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
            const text = (node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
            if (text.length > 180) break;
            if (text && text.length > details.length) details = text;
            if (/(chinese|english|japanese|korean|simplified|traditional|zh-cn|zh-tw)/i.test(text)) break;
          }
          return { url: anchor.href, details };
        });
        return JSON.stringify(files);
      })()`)
      for (const file of parseSubtitleCatFileListing(listing || "[]")) {
        if (seen.has(file.downloadURL)) continue
        seen.add(file.downloadURL)
        files.push(file)
      }
    } catch {
      failedDetailCount += 1
    }
  }

  files.sort((left, right) => subtitleCatLanguagePriority(left.language) - subtitleCatLanguagePriority(right.language))
  return { files, searchResultCount: entries.length, failedDetailCount }
}

export function parseSubtitleCatFileListing(payload: string): SubtitleCatSubtitleFile[] {
  let raw: unknown
  try { raw = JSON.parse(payload) }
  catch { throw new Error("Subtitle Cat 返回的字幕文件列表格式无法识别。") }
  if (!Array.isArray(raw)) return []

  const files: SubtitleCatSubtitleFile[] = []
  const seen = new Set<string>()
  for (const candidateValue of raw as unknown[]) {
    if (!candidateValue || typeof candidateValue !== "object") continue
    const candidate = candidateValue as SubtitleCatRawFile
    if (typeof candidate.url !== "string") continue
    let url: URL
    try { url = new URL(candidate.url, SUBTITLECAT_ORIGIN) }
    catch { continue }
    if (url.protocol !== "https:" || url.origin !== SUBTITLECAT_ORIGIN || !/^\/subs\/\d+\/[^/]+\.srt$/i.test(url.pathname)) continue
    if (seen.has(url.toString())) continue
    seen.add(url.toString())
    const details = normalizeSubtitleCatText(typeof candidate.details === "string" ? candidate.details : "")
    const filename = decodePathName(url.pathname)
    files.push({
      id: url.pathname,
      source: "SubtitleCat",
      language: parseSubtitleCatLanguage(`${filename} ${details}`),
      details: details || filename,
      downloadURL: url.toString(),
      isFree: true,
      isDemo: false,
    })
  }
  files.sort((left, right) => subtitleCatLanguagePriority(left.language) - subtitleCatLanguagePriority(right.language))
  return files
}

export async function downloadSubtitleCatFile(file: SubtitleCatSubtitleFile): Promise<string> {
  let url: URL
  try { url = new URL(file.downloadURL) }
  catch { throw new Error("Subtitle Cat 字幕地址无效，已取消下载。") }
  if (url.protocol !== "https:" || url.origin !== SUBTITLECAT_ORIGIN || !/^\/subs\/\d+\/[^/]+\.srt$/i.test(url.pathname)) {
    throw new Error("Subtitle Cat 字幕下载地址不安全，已取消下载。")
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "text/plain, application/x-subrip, */*", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
    timeout: 45,
    debugLabel: "Download Subtitle Cat SRT",
    handleRedirect: async request => {
      try {
        const target = new URL(request.url)
        return target.protocol === "https:" && target.origin === SUBTITLECAT_ORIGIN ? request : null
      } catch { return null }
    },
  })
  if (!response.ok) throw new Error(`Subtitle Cat 字幕下载失败（HTTP ${response.status}）。`)
  const content = await response.text()
  if (isSubtitleCatChallenge(content) || /^\s*<!doctype\s+html/i.test(content)) throw new Error("Subtitle Cat 暂时没有返回字幕文件，请稍后重试或完成网站验证。")
  return content
}

async function waitForSubtitleCatSearchResults(controller: WebViewController, videoCode: string): Promise<SubtitleCatSearchEntry[]> {
  const deadline = Date.now() + SEARCH_TIMEOUT_MS
  const compactCode = compactSubtitleCatCode(videoCode)
  while (Date.now() < deadline) {
    try {
      const raw = await controller.evaluateJavaScript<string>(`return (() => {
        const normalize = value => (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const code = ${JSON.stringify(compactCode)};
        const entries = Array.from(document.querySelectorAll('a[href*="/subs/"]'))
          .filter(anchor => /\\.html(?:$|[?#])/i.test(anchor.href))
          .map(anchor => ({ url: anchor.href, title: (anchor.innerText || anchor.textContent || "").replace(/\\s+/g, " ").trim() }))
          .filter(entry => normalize(entry.title + " " + entry.url).includes(code));
        return JSON.stringify({ url: location.href, text: (document.body?.innerText || "").slice(0, 4000), entries });
      })()`)
      if (raw) {
        const state = JSON.parse(raw) as { url?: unknown; text?: unknown; entries?: unknown }
        const url = typeof state.url === "string" ? new URL(state.url) : null
        const entries = Array.isArray(state.entries) ? state.entries as SubtitleCatSearchEntry[] : []
        if (entries.length) return dedupeSubtitleCatEntries(entries)
        const text = typeof state.text === "string" ? state.text : ""
        const query = url ? Array.from(url.searchParams.values()).join(" ") : ""
        const queryMatches = compactSubtitleCatCode(query).includes(compactCode)
        if (queryMatches && /no subtitles|no results|not found|0 results/i.test(text)) return []
        if (isSubtitleCatChallenge(text)) throw new Error("Subtitle Cat 访问验证未完成，请完成验证后重试。")
      }
    } catch (reason) {
      if (reason instanceof Error && /验证未完成/.test(reason.message)) throw reason
    }
    await pause(250)
  }
  throw new Error("Subtitle Cat 搜索超时，没有返回该番号的字幕结果。")
}

function parseSubtitleCatLanguage(text: string): string {
  const value = text.toLowerCase()
  if (/zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?mo|cht|traditional\s+chinese|chinese\s*\(\s*traditional\s*\)/i.test(value)) return "繁体中文"
  if (/zh[-_. ]?cn|zh[-_. ]?sg|chs|simplified\s+chinese|chinese\s*\(\s*simplified\s*\)/i.test(value)) return "简体中文"
  if (/(?:^|[^a-z])en(?:g)?(?:[^a-z]|$)|english/i.test(value)) return "英语"
  if (/(?:^|[^a-z])ja(?:p)?(?:[^a-z]|$)|japanese/i.test(value)) return "日语"
  if (/(?:^|[^a-z])ko(?:r)?(?:[^a-z]|$)|korean/i.test(value)) return "韩语"
  if (/(?:^|[^a-z])id(?:o)?(?:[^a-z]|$)|indonesian/i.test(value)) return "印尼语"
  if (/(?:^|[^a-z])th(?:a)?(?:[^a-z]|$)|thai/i.test(value)) return "泰语"
  if (/(?:^|[^a-z])vi(?:e)?(?:[^a-z]|$)|vietnamese/i.test(value)) return "越南语"
  if (/(?:^|[^a-z])es(?:p)?(?:[^a-z]|$)|spanish/i.test(value)) return "西班牙语"
  return "其他语言"
}

function subtitleCatLanguagePriority(language: string): number {
  if (language === "简体中文") return 0
  if (language === "繁体中文") return 1
  return 2
}

function normalizeSubtitleCatVideoCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/\s+/g, "-")
  if (!/^[A-Z0-9]{2,16}(?:-[A-Z0-9]{1,16}){0,2}$/.test(code)) throw new Error("请输入有效的作品番号。")
  return code
}

function compactSubtitleCatCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function dedupeSubtitleCatEntries(entries: SubtitleCatSearchEntry[]): SubtitleCatSearchEntry[] {
  const seen = new Set<string>()
  return entries.filter(entry => {
    if (typeof entry.url !== "string") return false
    let url: URL
    try { url = new URL(entry.url, SUBTITLECAT_ORIGIN) }
    catch { return false }
    if (url.origin !== SUBTITLECAT_ORIGIN || !/^\/subs\/\d+\/[^/]+\.html$/i.test(url.pathname)) return false
    const key = url.toString()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function decodePathName(pathname: string): string {
  const value = pathname.split("/").pop() || ""
  try { return decodeURIComponent(value) }
  catch { return value }
}

function normalizeSubtitleCatText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()
}

function isSubtitleCatChallenge(value: string): boolean {
  return /just a moment|verify you are human|checking your browser|attention required|sorry, you have been blocked|security verification|请验证您是真人/i.test(value)
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
