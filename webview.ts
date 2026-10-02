import { classifyCloudflareHTML, hasCloudflareInteractivePrompt } from "./html-parser"
import type { MissAVRequestScope } from "./request-scope"
import { isMissAVDOMExtractionTrialEnabled, MISSAV_DOM_DOCUMENT_SCRIPT } from "./listing-dom"

export type WebViewDocument = { url: string; html: string | null; compactHTML?: string }

export type WebViewPageLoad = {
  loaded: boolean
  finished: boolean
  html: string | null
  url?: string
  challengeObserved?: boolean
  compactHTML?: string
}

const WEBVIEW_PAGE_LOAD_TIMEOUT_MS = 30_000
const WEBVIEW_HTML_READ_ATTEMPTS = 10
const WEBVIEW_HTML_READ_INTERVAL_MS = 300
const WEBVIEW_DOCUMENT_READ_TIMEOUT_MS = 3_000

export function isMatchingWebViewURL(actual: string, expected: string): boolean {
  try {
    const target = new URL(expected)
    const current = new URL(actual)
    const route = (value: URL) => value.pathname.replace(/^\/dm\d+(?=\/)/i, "").replace(/\/+$/, "")
    if (current.origin !== target.origin || current.username || current.password || route(current) !== route(target)) return false
    // Ignore fragment/challenge tokens, not the requested pagination or filters.
    for (const key of ["page", "sort", "filters"]) {
      if (current.searchParams.getAll(key).length > 1 || target.searchParams.getAll(key).length > 1) return false
      const normalize = (value: URL) => key === "page" ? value.searchParams.get(key) || "1" : value.searchParams.get(key) || ""
      if (normalize(current) !== normalize(target)) return false
    }
    return true
  } catch { return false }
}

export async function readMatchingWebViewDocument(controller: WebViewController, expectedURL: string): Promise<WebViewDocument | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Read location and markup together so a redirect cannot pair old HTML with a new URL.
    const document = await Promise.race([
      controller.evaluateJavaScript<WebViewDocument>(
        isMissAVDOMExtractionTrialEnabled() ? MISSAV_DOM_DOCUMENT_SCRIPT : "return { url: window.location.href, html: document.documentElement ? document.documentElement.outerHTML : null }"),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), WEBVIEW_DOCUMENT_READ_TIMEOUT_MS) }),
    ])
    return document && typeof document.url === "string" && (document.html === null || typeof document.html === "string")
      && isMatchingWebViewURL(document.url, expectedURL) ? {
        url: document.url, html: document.html,
        ...(typeof document.compactHTML === "string" && document.compactHTML.length <= 2_000_000 ? { compactHTML: document.compactHTML } : {}),
      } : null
  } catch { return null }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

export async function loadWebViewPage(controller: WebViewController, url: string, timeoutMs = WEBVIEW_PAGE_LOAD_TIMEOUT_MS, isContentReady?: (html: string) => boolean, scope?: MissAVRequestScope): Promise<WebViewPageLoad> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeoutError = new Error("网页加载超时，请检查网络后重试。")
  try {
    scope?.assertActive()
    const request = Promise.race([
      (async () => {
        let loaded = false
        let finished = false
        let loadError: unknown
        let challengeObserved = false
        let lastDocument: WebViewDocument | null = null
        scope?.assertActive()
        try { loaded = await controller.loadURL(url) } catch (error) { loadError = error }
        scope?.assertActive()
        if (timedOut) throw timeoutError
        if (loaded) {
          try { finished = await controller.waitForLoad() } catch { /* A redirect can cancel a load callback. */ }
          scope?.assertActive()
        }
        for (let attempt = 0; attempt < WEBVIEW_HTML_READ_ATTEMPTS; attempt += 1) {
          scope?.assertActive()
          if (timedOut) throw timeoutError
          const document = await readMatchingWebViewDocument(controller, url)
          scope?.assertActive()
          if (timedOut) throw timeoutError
          lastDocument = document && hasWebViewDocument(document.html) ? document : null
          if (lastDocument) {
            const state = classifyCloudflareHTML(lastDocument.html)
            challengeObserved ||= state === "challenge"
            // Give an automatic interstitial a bounded chance to redirect in this
            // same WebView. Explicit human-interaction pages go to Settings promptly.
            const interactive = state === "challenge" && hasCloudflareInteractivePrompt(lastDocument.html!)
            // A normal header is not necessarily a finished listing. Callers
            // can wait for their own content without navigating again.
            if (state === "blocked" || interactive || (state === "none" && (!isContentReady || isContentReady(lastDocument.html!)))) {
              return { loaded, finished, ...lastDocument, challengeObserved }
            }
          }
          if (attempt + 1 < WEBVIEW_HTML_READ_ATTEMPTS) await new Promise<void>(resolve => setTimeout(resolve, WEBVIEW_HTML_READ_INTERVAL_MS))
        }
        if (lastDocument) return { loaded, finished, ...lastDocument, challengeObserved }
        if (loadError) throw loadError
        return { loaded, finished, html: null, challengeObserved }
      })(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => { timedOut = true; reject(timeoutError) }, timeoutMs)
      }),
    ])
    return await (scope ? scope.waitFor(request) : request)
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function hasWebViewDocument(html: string | null): html is string {
  return Boolean(html && html
    .replace(/<(head|script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, "")
    .trim())
}
