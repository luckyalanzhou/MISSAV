export type WebViewPageLoad = {
  loaded: boolean
  finished: boolean
  html: string | null
}

const WEBVIEW_PAGE_LOAD_TIMEOUT_MS = 30_000
const WEBVIEW_HTML_READ_ATTEMPTS = 10
const WEBVIEW_HTML_READ_INTERVAL_MS = 300

export async function loadWebViewPage(controller: WebViewController, url: string, timeoutMs = WEBVIEW_PAGE_LOAD_TIMEOUT_MS): Promise<WebViewPageLoad> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeoutError = new Error("网页加载超时，请检查网络后重试。")
  try {
    return await Promise.race([
      (async () => {
        let loaded = false
        let finished = false
        let loadError: unknown
        try { loaded = await controller.loadURL(url) } catch (error) { loadError = error }
        if (timedOut) throw timeoutError
        if (loaded) {
          try { finished = await controller.waitForLoad() } catch { /* A redirect can cancel a load callback. */ }
        }
        for (let attempt = 0; attempt < WEBVIEW_HTML_READ_ATTEMPTS; attempt += 1) {
          if (timedOut) throw timeoutError
          let html: string | null = null
          try { html = await controller.getHTML() } catch { /* The document may be between navigations. */ }
          if (timedOut) throw timeoutError
          if (!hasWebViewDocument(html)) {
            try { html = await controller.evaluateJavaScript<string | null>("return document.documentElement ? document.documentElement.outerHTML : null") }
            catch { /* JavaScript is unavailable while the new document is being created. */ }
          }
          if (timedOut) throw timeoutError
          if (hasWebViewDocument(html)) return { loaded, finished, html }
          if (attempt + 1 < WEBVIEW_HTML_READ_ATTEMPTS) await new Promise<void>(resolve => setTimeout(resolve, WEBVIEW_HTML_READ_INTERVAL_MS))
        }
        if (loadError) throw loadError
        return { loaded, finished, html: null }
      })(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => { timedOut = true; reject(timeoutError) }, timeoutMs)
      }),
    ])
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
