export type SubtitleWebViewDocument = { url: string; html: string; previousDocument: boolean }

export async function readSubtitleWebViewDocument(controller: WebViewController, marker = "", timeoutMs?: number): Promise<SubtitleWebViewDocument | null> {
  const evaluation = controller.evaluateJavaScript<string>(`return JSON.stringify({
    url: location.href,
    html: document.documentElement ? document.documentElement.outerHTML : "",
    previousDocument: window.__missavSubtitleNavigation === ${JSON.stringify(marker)}
  })`)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const payload = timeoutMs === undefined ? await evaluation : await Promise.race([
      evaluation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Subtitle Cat 页面读取超时，请稍后重试。")), timeoutMs) }),
    ])
    if (!payload) return null
    const value = JSON.parse(payload)
    if (typeof value?.url !== "string" || typeof value?.html !== "string") return null
    return { url: value.url, html: value.html, previousDocument: value.previousDocument === true }
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

// Subtitle-only readiness: do not change the site's verification loader.
export async function loadSubtitleWebViewDocument(controller: WebViewController, url: string, options: {
  accept: (document: SubtitleWebViewDocument) => boolean
  checkCancelled: () => void
  timeoutMs?: number
}): Promise<SubtitleWebViewDocument> {
  const marker = `${Date.now()}-${Math.random()}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const timeoutError = new Error("Subtitle Cat 网页读取超时，请稍后重试。")
  const check = () => { if (stopped) throw timeoutError; options.checkCancelled() }
  try {
    return await Promise.race([
      (async () => {
        check()
        // Mark the previous page so a same-URL reload cannot accept its stale DOM.
        try { await controller.evaluateJavaScript(`window.__missavSubtitleNavigation = ${JSON.stringify(marker)}`) } catch {}
        check()
        // A late load callback must not block usable content or produce unhandled rejection.
        void controller.loadURL(url).catch(() => {})
        while (true) {
          check()
          let document: SubtitleWebViewDocument | null = null
          try { document = await readSubtitleWebViewDocument(controller, marker) } catch {}
          check()
          if (document && !document.previousDocument && options.accept(document)) return document
          await new Promise<void>(resolve => setTimeout(resolve, 250))
        }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; reject(timeoutError) }, options.timeoutMs ?? 20_000) }),
    ])
  } finally {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
