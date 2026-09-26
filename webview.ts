export type WebViewPageLoad = {
  loaded: boolean
  finished: boolean
  html: string | null
}

export async function loadWebViewPage(controller: WebViewController, url: string): Promise<WebViewPageLoad> {
  const loaded = await controller.loadURL(url)
  const finished = loaded ? await controller.waitForLoad() : false
  const html = await controller.getHTML()
  return { loaded, finished, html }
}
