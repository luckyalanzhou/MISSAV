import { getMissAVBaseURL, resolveMissAVURL } from "./domain"
import type { MissAVSearchPage, MissAVVideoDetail, MissAVVideoItem, MissAVVideoSource } from "./client"

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

export function isCloudflareChallengeHTML(html: string | null): boolean {
  if (!html) return false
  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const visibleText = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, " ")
    .replace(/\s+/g, " ")
  const challengeMeta = /<meta\b[^>]*(?:cf-mitigated|cf_chl|cf-chl)[^>]*(?:challenge|verify)/i.test(html)
  const challengeTitle = /just a moment|checking (?:your )?browser|attention required|cloudflare/i.test(title)
  const challengeText = /just a moment|checking (?:your )?browser|verify you are human|human verification|performing security verification|正在进行安全验证|验证您不是自动程序|请验证您是真人|人机验证/i.test(visibleText)
  const challengeWidget = /<(?:div|input|iframe)\b[^>]*(?:cf-turnstile|cf-chl-widget|data-cf-chl|challenges\.cloudflare\.com)/i.test(html)
  return challengeMeta || challengeTitle || challengeText || challengeWidget
}

export function isLikelyMissAVHTML(html: string | null): html is string {
  return Boolean(html && /missav/i.test(html) && /<(?:html|body|main|video|meta)\b/i.test(html) && html.length > 500)
}

export function extractMissAVVideoCode(value: string | undefined | null): string | null {
  if (!value) return null
  const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0].replace(/^\/dm\d+/i, "").replace(/^\/(?:ja|en|cn|ko|ms|th|de|fr|vi|id|fil|pt)\//i, "/")
  const slug = decodeURIComponent(path.replace(/^\/+|\/+$/g, ""))
  return slug && !/^(?:new|release|uncensored-leak|english-subtitle|fc2|today-hot|weekly-hot|monthly-hot|search|genres|makers|actresses)$/i.test(slug) ? slug.toLowerCase() : null
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
    result.push({ title, videoCode, detailPath: normalizeMissAVUrl(detailPath), coverUrl, duration, badge: /uncensored-leak/i.test(videoCode) ? "无码流出" : /english-subtitle/i.test(videoCode) ? "英文字幕" : undefined })
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

function isLikelyMissAVVideoCode(value: string): boolean { return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(value) && /\d/.test(value) }
function unpackPackerMediaUrls(html: string): string[] {
  const result: string[] = []
  for (const match of html.matchAll(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('((?:\\.|[^'])*)',(\d+),(\d+),'((?:\\.|[^'])*)'\.split\('\|'\)/gi)) {
    const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\"); const radix = Number(match[2]); const words = match[4].replace(/\\'/g, "'").split("|")
    if (!payload || radix < 2 || radix > 36) continue
    const decoded = payload.replace(/\b[0-9a-z]+\b/gi, token => { const index = Number.parseInt(token, radix); return Number.isFinite(index) && words[index] ? words[index] : token })
    for (const urlMatch of decoded.matchAll(/https?:\/\/[^'"\s]+?\.(?:m3u8|mp4)(?:\?[^'"\s]*)?/gi)) result.push(urlMatch[0])
  }
  return result
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
