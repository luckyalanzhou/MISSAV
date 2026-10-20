import type { SubtitleCatSearchOptions, SubtitleCatSearchResult } from "./subtitlecat"

type Search = (code: string, options: SubtitleCatSearchOptions) => Promise<SubtitleCatSearchResult>
type Observer = {
  onResult: (result: SubtitleCatSearchResult) => void
  onError: (reason: unknown) => void
  onSettled: () => void
}

// Owns only search resources. The provider disposes its controllers; stopping
// dismisses visible validation and rejects all later callbacks from that search.
export class SubtitleSearchSession {
  private current: { controller: WebViewController | null } | null = null
  private readonly searchFiles: Search

  constructor(searchFiles: Search) { this.searchFiles = searchFiles }

  stop(): boolean {
    const request = this.current
    this.current = null
    if (!request) return false
    try { request.controller?.dismiss() } catch { /* The native window may already be closing. */ }
    return true
  }

  async search(code: string, forceRefresh: boolean, observer: Observer): Promise<void> {
    this.stop()
    const request = { controller: null as WebViewController | null }
    this.current = request
    const isCurrent = () => this.current === request
    try {
      const result = await this.searchFiles(code, {
        forceRefresh,
        isCancelled: () => !isCurrent(),
        onControllerChange: controller => {
          request.controller = controller
          if (controller && !isCurrent()) {
            try { controller.dismiss() } catch { /* Already closing. */ }
          }
        },
        onProgress: result => { if (isCurrent()) observer.onResult(result) },
      })
      if (isCurrent()) observer.onResult(result)
    } catch (reason) {
      if (isCurrent()) observer.onError(reason)
    } finally {
      if (isCurrent()) {
        this.current = null
        observer.onSettled()
      }
    }
  }
}
