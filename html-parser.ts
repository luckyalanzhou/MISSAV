import { getMissAVBaseURL, MISSAV_LOCALE, resolveMissAVURL } from "./domain"
import { MISSAV_COLLECTION_OPTIONS, type MissAVDirectoryCollection } from "./collections"
import type { MissAVCategoryItem, MissAVCollection, MissAVSearchPage, MissAVVideoDetail, MissAVVideoItem, MissAVVideoSource } from "./client"

export function parseMissAVCollectionLinks(html: string, pageURL: string = getMissAVBaseURL()): Partial<Record<MissAVCollection, string>> {
  const links: Partial<Record<MissAVCollection, string>> = {}
  const selectedOrigin = new URL(pageURL).origin
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), pageURL)
      if (url.origin !== selectedOrigin) continue
      const route = /^(?:\/dm\d+)?\/([a-z]{2,3})\/(.+?)\/?$/i.exec(url.pathname)
      if (!route || route[1].toLowerCase() !== MISSAV_LOCALE) continue
      const collection = MISSAV_COLLECTION_OPTIONS.find(option => option.value.toLowerCase() === route[2].toLowerCase())?.value
      if (!collection) continue
      // Prefer the site's current menu routes over bare or filtered links.
      if (links[collection] && !/^\/dm\d+\//i.test(url.pathname)) continue
      links[collection] = url.pathname
    } catch { /* Ignore non-URL menu actions. */ }
  }
  return links
}

export function parseMissAVDirectoryPage(html: string, page: number, collection: MissAVDirectoryCollection, pageURL: string): MissAVSearchPage {
  const categories: MissAVCategoryItem[] = []
  const seen = new Set<string>()
  const heading = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(html)
  const body = heading ? html.slice(heading.index + heading[0].length).split(/<footer\b/i)[0] : ""
  const kind = collection === "actresses/ranking" ? "actresses" : collection
  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), pageURL)
      const route = /^\/(?:dm\d+\/)?cn\/(actresses|genres|makers)\/([^/]+)\/?$/.exec(url.pathname)
      if (url.origin !== new URL(pageURL).origin || !route || route[1] !== kind || route[2] === "ranking" || seen.has(url.pathname)) continue
      const image = firstMatch(match[2], /(<img\b[^>]*>)/i)
      const title = cleanText(match[2]) || cleanText(attr(image, "alt"))
      if (!title) continue
      seen.add(url.pathname)
      categories.push({ title, path: url.pathname, coverUrl: normalizeMissAVUrl(attr(image, "data-src") || attr(image, "src")) || undefined })
    } catch { /* Ignore malformed or unrelated directory links. */ }
  }
  return { items: [], categories, page, hasNext: hasNextPage(html, page), title: cleanText(heading?.[0] || "") }
}

export function parseMissAVSearchPage(html: string, page: number): MissAVSearchPage {
  return {
    items: parseMissAVVideoItems(html),
    page,
    hasNext: hasNextPage(html, page),
    title: cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)),
  }
}

export function parseMissAVVideoDetail(html: string, videoCode: string, watchUrl: string): MissAVVideoDetail {
  const title = meta(html, "og:title") || cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)) || videoCode.toUpperCase()
  const coverUrl = normalizeMissAVUrl(meta(html, "og:image") || firstMatch(html, /<video\b[^>]*\bdata-poster=["']([^"']+)/i))
  const durationSeconds = Number(meta(html, "og:video:duration"))
  const releaseDate = meta(html, "og:video:release_date") || undefined
  const actress = meta(html, "og:video:actor") || cleanText(firstMatch(html, /<a\b[^>]*href=["'][^"']*\/actresses\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)) || undefined
  const genres = unique([...html.matchAll(/<a\b[^>]*href=["'][^"']*\/genres\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)].map(match => cleanText(match[1])).filter(Boolean)).slice(0, 30)
  const maker = cleanText(firstMatch(html, /<a\b[^>]*href=["'][^"']*\/makers\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)) || undefined
  const sources = parseMissAVSources(html)
  return { title, videoCode, coverUrl, duration: durationSeconds > 0 ? formatDuration(durationSeconds) : undefined, releaseDate, actress, genres, maker, sources, watchUrl }
}

export type CloudflarePageState = "none" | "challenge" | "blocked"

export function classifyCloudflareHTML(html: string | null): CloudflarePageState {
  if (!html) return "none"
  const sourceMarkup = html.replace(/<!--[\s\S]*?-->/g, "")
  const contentMarkup = cloudflareContentMarkup(sourceMarkup)
  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const normalizedTitle = cleanText(title).toLowerCase()
  const visibleText = contentMarkup
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, " ")
    .replace(/\s+/g, " ")
  const cloudflareMarker = /(?:cdn-cgi\/challenge-platform|__cf_chl|cf_chl_opt|cf-turnstile|cf-chl-widget|data-cf-chl|challenges\.cloudflare\.com|cloudflare\s+ray\s+id)/i.test(sourceMarkup)
  if (/sorry,? you have been blocked|access denied|error\s*(?:1020|1015)|you are being rate limited|您已被阻止|访问被拒绝/i.test(visibleText)
    && (cloudflareMarker || /cloudflare/i.test(visibleText))) return "blocked"
  const challengeTitle = /just a moment|checking (?:your )?browser|attention required|cloudflare security/i.test(normalizedTitle)
  const interstitial = /<(?:form|div)\b[^>]*\bid\s*=\s*["'](?:challenge-form|cf-challenge-running|cf-chl-widget[^"']*)["']/i.test(contentMarkup)
  if (challengeTitle || interstitial) return "challenge"

  // JSD and a Turnstile loader can be present on an ordinary content page.
  // Neither a script URL nor a cf-mitigated HTML meta tag is an HTTP response header.
  const hasContent = parseMissAVVideoItems(contentMarkup).length > 0 || /<video\b/i.test(contentMarkup)
    || /<form\b[\s\S]*?<input\b[^>]*\b(?:name|type)\s*=\s*["'](?:email|password)["']/i.test(contentMarkup)
  const challengeText = /just a moment|checking (?:your )?browser|checking if the site connection is secure|verify you are human|verifying you are human|human verification|performing security verification|security verification|please enable javascript and cookies|人机验证|正在进行安全验证|验证您不是自动程序|请验证您是真人|接続を確認しています|セキュリティ確認|人間であることを確認|ブラウザを確認しています/i.test(visibleText)
  const challengeConfiguration = /\b(?:window\.)?_cf_chl_opt\s*=/i.test(sourceMarkup)
  const challengeWidget = /<(?:div|iframe)\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\bcf-turnstile\b/i.test(contentMarkup)
  return !hasContent && cloudflareMarker && (challengeText || challengeConfiguration || challengeWidget) ? "challenge" : "none"
}

export function hasCloudflareInteractivePrompt(html: string): boolean {
  const markup = cloudflareContentMarkup(html)
  return /verify you are human|请验证您是真人|人間であることを確認/i.test(markup.replace(/<[^>]+>/g, " "))
    || /<(?:div|iframe)\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\b(?:cf-turnstile|cf-chl-widget)/i.test(markup)
}

function cloudflareContentMarkup(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
}

// Existing account callers must reject both a challenge and an access-denied page.
export function isCloudflareChallengeHTML(html: string | null): boolean {
  return classifyCloudflareHTML(html) !== "none"
}

export function isLikelyMissAVHTML(html: string | null): html is string {
  return Boolean(html && /missav/i.test(html) && /<(?:html|body|main|video|meta)\b/i.test(html) && html.length > 500)
}

export function isLikelyMissAVListingHTML(html: string | null): html is string {
  return Boolean(html && isLikelyMissAVHTML(html) && !isCloudflareChallengeHTML(html) && parseMissAVVideoItems(html).length > 0)
}

export function extractMissAVVideoCode(value: string | undefined | null): string | null {
  if (!value) return null
  const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0].replace(/^\/dm\d+/i, "").replace(/^\/(?:ja|en|cn|ko|ms|th|de|fr|vi|id|fil|pt)\//i, "/")
  let slug: string
  try { slug = decodeURIComponent(path.replace(/^\/+|\/+$/g, "")) } catch { return null }
  return slug && !MISSAV_COLLECTION_OPTIONS.some(option => option.value.toLowerCase() === slug.toLowerCase()) && !/^(?:english-subtitle|search)$/i.test(slug) ? slug.toLowerCase() : null
}

export function parseMissAVVideoItems(html: string): MissAVVideoItem[] {
  const result: MissAVVideoItem[] = []
  const seen = new Set<string>()
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  for (let index = 0; index < links.length; index += 1) {
    const match = links[index]
    const detailPath = decodeHtml(match[1])
    const videoCode = extractMissAVVideoCode(detailPath)
    if (!videoCode || seen.has(videoCode) || !isLikelyMissAVVideoCode(videoCode) || /\/(?:genres|makers|actresses|labels|site|search|vip|upload|contact|terms)\//i.test(detailPath)) continue

    // A real card exposes cover, duration and title as adjacent links sharing one detail URL.
    const cardLinks: RegExpMatchArray[] = []
    for (let cursor = index; cursor < links.length; cursor += 1) {
      const candidateCode = extractMissAVVideoCode(decodeHtml(links[cursor][1]))
      if (candidateCode !== videoCode) break
      cardLinks.push(links[cursor])
    }
    const cardHtml = cardLinks.map(item => item[0]).join(" ")
    const imageTag = firstMatch(cardHtml, /(<img\b[^>]*>)/i)
    const imageTitle = cleanText(attr(imageTag, "alt"))
    const linkTexts = cardLinks.map(item => cleanText(item[2])).filter(text => text && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text))
    const title = linkTexts.sort((a, b) => b.length - a.length)[0] || imageTitle || cleanText(attr(cardHtml, "title"))
    const coverUrl = normalizeMissAVUrl(attr(imageTag, "data-src") || attr(imageTag, "data-original") || attr(imageTag, "src"))
    const duration = cleanText(firstMatch(cardHtml, /(\d{1,2}:\d{2}(?::\d{2})?)/i))
    if (!title || title.length < 3 || !duration || (!coverUrl && !imageTitle)) continue
    seen.add(videoCode)
    result.push({ title, videoCode, detailPath: normalizeMissAVUrl(detailPath), coverUrl, duration, badge: /chinese-subtitle/i.test(videoCode) ? "中文字幕" : /uncensored-leak/i.test(videoCode) ? "无码流出" : /english-subtitle/i.test(videoCode) ? "英文字幕" : undefined })
    index += Math.max(0, cardLinks.length - 1)
  }
  return result
}

export function parseMissAVSources(html: string): MissAVVideoSource[] {
  const candidates = [
    ...[...html.matchAll(/<video\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]),
    ...[...html.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]),
    ...[...html.matchAll(/["'](https?:\\?\/\\?\/[^"']+?\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi)].map(match => match[1]),
    ...unpackPackerMediaUrls(html),
  ]
  const sources: MissAVVideoSource[] = []
  const seenResources = new Set<string>()
  for (const candidate of candidates) {
    const url = validPlaybackUrl(candidate)
    if (!url) continue
    const resourceKey = playbackResourceKey(url)
    if (seenResources.has(resourceKey)) continue
    seenResources.add(resourceKey)
    const label = qualityLabel(url)
    sources.push({ label, qualityHeight: qualityHeight(label), url, type: isHlsUrl(url) ? "application/vnd.apple.mpegurl" : "video/mp4" })
  }
  return deduplicatePlaybackChoices(sources).sort((a, b) => qualityNumber(b.label) - qualityNumber(a.label))
}

export function hasNextPage(html: string, page: number): boolean {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].some(match => {
    try { return Number(new URL(decodeHtml(match[1]), getMissAVBaseURL()).searchParams.get("page")) === page + 1 }
    catch { return false }
  })
}

export function normalizeMissAVUrl(value: string): string {
  return resolveMissAVURL(decodeTransportUrl(value))
}

export function cleanText(value: string): string {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function isLikelyMissAVVideoCode(value: string): boolean {
  // Site detail slugs also include N1854/GACHIP140 and date-based codes such
  // as 092426_001/PONDO-092426_001. Keep separators intact for detail/playback.
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(value) && /\d/.test(value)
}
function unpackPackerMediaUrls(html: string): string[] {
  const result: string[] = []
  let blocks = 0
  // Never execute a remote script. Work on bounded individual script blocks,
  // with disjoint quoted-string alternatives: a backslash can only belong
  // to an escape, not also the ordinary-character branch (exponential
  // backtracking in the old expression on a malformed payload).
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/eval\s*\(\s*function\s*\(\s*p\s*,/.test(script[1])) continue
    if (++blocks > 64) break
    if (script[1].length > 512_000) continue
    const args = /\}\s*\(\s*'((?:\\[\s\S]|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\[\s\S]|[^'\\])*)'\s*\.\s*split\s*\(\s*'\|'\s*\)/g
    for (const match of script[1].matchAll(args)) {
      const payload = unpackQuotedString(match[1]), radix = Number(match[2]), count = Number(match[3])
      if (!payload || radix < 2 || radix > 62 || !Number.isSafeInteger(count) || count < 1 || count > 20_000) continue
      const words = unpackQuotedString(match[4]).split("|")
      if (words.length > 20_000) continue
      let decodedChars = payload.length, overflow = false
      const decoded = payload.replace(/\b[0-9a-zA-Z]+\b/g, token => {
        if (overflow) return token
        const index = packerWordIndex(token, radix, count)
        const word = index >= 0 ? words[index] : undefined
        if (!word) return token
        decodedChars += word.length - token.length
        if (decodedChars > 2_000_000) { overflow = true; return token }
        return word
      })
      if (overflow) continue
      for (const urlMatch of decoded.matchAll(/https?:\/\/[^'"\s]+?\.(?:m3u8|mp4)(?:\?[^'"\s]*)?/gi)) result.push(urlMatch[0])
    }
  }
  return result
}

function unpackQuotedString(value: string): string { return value.replace(/\\(['\\])/g, "$1") }
function packerWordIndex(token: string, radix: number, count: number): number {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  let index = 0
  for (const character of token) {
    const digit = alphabet.indexOf(character)
    if (digit < 0 || digit >= radix) return -1
    index = index * radix + digit
    if (index >= count) return -1
  }
  return index
}

function qualityLabel(url: string): string {
  const value = decodeTransportUrl(url)
  const match = /(?:^|[/_.-])(\d{3,4})p(?=[/_.?&=-]|$)/i.exec(value)
    || /[?&](?:quality|res(?:olution)?|height|q)=(\d{3,4})(?:&|$)/i.exec(value)
    || /(?:^|[/_.-])\d{3,4}x(\d{3,4})(?=[/_.?&=-]|$)/i.exec(value)
    || /[/_.-](\d{3,4})(?:\.m3u8|\.mp4)(?:\?|$)/i.exec(value)
  return match ? `${match[1]}p` : "自动清晰度"
}

function qualityNumber(label: string): number { return Number.parseInt(label, 10) || 0 }
function qualityHeight(label: string): number | undefined { const value = qualityNumber(label); return value > 0 ? value : undefined }
function validPlaybackUrl(value: string): string | null {
  const decoded = decodeTransportUrl(value)
  if (!/^https?:\/\//i.test(decoded) || /(?:\$\{|\{\{|\b(?:undefined|null)\b)/i.test(decoded)) return null
  try {
    const url = new URL(decoded)
    if (!/\.(?:m3u8|mp4)$/i.test(url.pathname) || /(?:^|\/)preview\.mp4$/i.test(url.pathname)) return null
    return url.toString()
  } catch { return null }
}

function isHlsUrl(url: string): boolean { try { return /\.m3u8$/i.test(new URL(url).pathname) } catch { return false } }
function playbackResourceKey(url: string): string { try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}` } catch { return url } }
function deduplicatePlaybackChoices(sources: MissAVVideoSource[]): MissAVVideoSource[] {
  const result: MissAVVideoSource[] = []
  const fixedHeights = new Set<number>()
  let hasAutomatic = false
  for (const source of sources) {
    if (source.qualityHeight != null) {
      if (fixedHeights.has(source.qualityHeight)) continue
      fixedHeights.add(source.qualityHeight)
    } else {
      if (hasAutomatic) continue
      hasAutomatic = true
    }
    result.push(source)
  }
  return result
}

function meta(html: string, name: string): string {
  const tag = firstMatch(html, new RegExp(`(<meta\\b(?=[^>]*(?:property|name)=["']${escapeRegExp(name)}["'])[^>]*>)`, "i"))
  return cleanText(attr(tag, "content"))
}
function attr(value: string, name: string): string { return firstMatch(value, new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)`, "i")) }
function firstMatch(value: string, regex: RegExp): string { return regex.exec(value)?.[1] || "" }
function decodeTransportUrl(value: string): string { return decodeHtml(value).replace(/\\\//g, "/").replace(/\\u0026/gi, "&").trim() }
function decodeHtml(value: string): string {
  let result = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = result.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|nbsp|lt|gt);/gi, (entity, decimal, hexadecimal) => decimal ? String.fromCodePoint(Number(decimal)) : hexadecimal ? String.fromCodePoint(Number.parseInt(hexadecimal, 16)) : ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" } as Record<string, string>)[entity.toLowerCase()] || entity)
    if (next === result) break
    result = next
  }
  return result
}
function unique(values: string[]): string[] { return [...new Set(values)] }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function formatDuration(seconds: number): string { const value = Math.max(0, Math.floor(seconds)); const h = Math.floor(value / 3600); const m = Math.floor((value % 3600) / 60); const s = value % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}` }
