export type WebViewPageLoad = {
  loaded: boolean
  finished: boolean
  html: string | null
}

const WEBVIEW_PAGE_LOAD_TIMEOUT_MS = 30_000

export async function loadWebViewPage(controller: WebViewController, url: string, timeoutMs = WEBVIEW_PAGE_LOAD_TIMEOUT_MS): Promise<WebViewPageLoad> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const loaded = await controller.loadURL(url)
        const finished = loaded ? await controller.waitForLoad() : false
        const html = await controller.getHTML()
        return { loaded, finished, html }
      })(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("网页加载超时，请检查网络后重试。")), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
