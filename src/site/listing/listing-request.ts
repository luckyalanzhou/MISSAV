import { missavClient, type MissAVSearchPage, type MissAVSearchParams } from "../client"
import { MissAVRequestScope, isMissAVRequestCancelled } from "../../core/request/request-scope"

type Read = (params: MissAVSearchParams, options: { scope: MissAVRequestScope; forceRefresh?: boolean; allowStale?: boolean }) => Promise<MissAVSearchPage>
type Observer = {
  loaded(page: MissAVSearchPage): void
  failed(reason: unknown): void
  settled(): void
}

// Replacing a listing request revokes every callback from the old request.
// Pages still own whether a successful page replaces or appends their results.
export class MissAVListingRequest {
  private current: MissAVRequestScope | null = null
  private readonly read: Read
  constructor(read: Read = (params, options) => missavClient.searchVideoPage(params, options)) { this.read = read }

  cancel(): void {
    const scope = this.current
    this.current = null
    scope?.cancel()
  }
  async load(params: MissAVSearchParams, options: { forceRefresh?: boolean; allowStale?: boolean }, observer: Observer): Promise<void> {
    this.cancel()
    const scope = new MissAVRequestScope()
    this.current = scope
    const valid = () => this.current === scope && !scope.cancelled
    try {
      const page = await scope.waitFor(this.read(params, { ...options, scope }))
      if (valid()) observer.loaded(page)
    } catch (reason) {
      if (valid() && !isMissAVRequestCancelled(reason)) observer.failed(reason)
    } finally {
      if (valid()) { this.current = null; observer.settled() }
    }
  }
}
