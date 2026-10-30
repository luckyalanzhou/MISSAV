import { missavClient, type MissAVVideoDetail, type MissAVVideoItem, type MissAVVideoSource } from "../../site/client"
import { loadMissAVPlaybackProgress, type MissAVPlaybackProgress } from "../../data/storage"
import { isMissAVSubtitleEnabled, loadMissAVSubtitle, type SubtitleTrack } from "../subtitles/subtitles"
import { withMissAVDeadline } from "../../core/request/request-deadline"

export type PreparedPlaybackData = { progress: MissAVPlaybackProgress | null; subtitles: SubtitleTrack | null }
export type PreparedPlaybackDataListener = (data: PreparedPlaybackData) => void

// Navigation owns a selection, rather than coordinating two preparation
// lifetimes itself. The selected preparation survives a cancelled next tap.
export class MissAVPlaybackSelection {
  private pending: MissAVPlaybackPreparation | null = null
  private selected: MissAVPlaybackPreparation | null = null
  begin(video: MissAVVideoItem): MissAVPlaybackPreparation {
    this.pending?.dispose()
    this.pending = new MissAVPlaybackPreparation(video)
    return this.pending
  }
  accept(preparation: MissAVPlaybackPreparation, detail: MissAVVideoDetail): void {
    if (this.pending !== preparation) return
    preparation.prepareSource(detail)
    this.selected?.dispose()
    this.selected = preparation
    this.pending = null
  }
  abandon(preparation: MissAVPlaybackPreparation): void {
    if (this.pending !== preparation) return
    this.pending = null
    preparation.dispose()
  }
  dispose(): void {
    this.pending?.dispose()
    this.selected?.dispose()
    this.pending = null
    this.selected = null
  }
}

// One selected work owns one default-quality resource. No list-wide media loads.
export class MissAVPlaybackPreparation {
  readonly data: PreparedPlaybackData = { progress: null, subtitles: null }
  readonly ready: Promise<void>
  private asset: AVAsset | undefined
  private resourceKey = ""
  private closed = false
  private subtitleGeneration = 0
  private subtitleRead: Promise<void> = Promise.resolve()
  private dataListeners = new Set<PreparedPlaybackDataListener>()
  subtitlePending = false

  constructor(private video: MissAVVideoItem) {
    this.ready = Promise.all([
      this.refreshSubtitles(),
      this.optional(() => loadMissAVPlaybackProgress(video.videoCode), progress => {
        if (!this.closed) this.updateData({ progress })
      }).then(progress => { if (!this.closed) this.updateData({ progress }) }),
    ]).then(() => {}, () => {})
  }

  refreshSubtitles(): Promise<void> {
    const current = ++this.subtitleGeneration
    this.data.subtitles = null
    this.subtitlePending = true
    const read = (async () => {
      try {
        if (this.closed || !isMissAVSubtitleEnabled(this.video.videoCode)) return
        const isCurrent = () => !this.closed && current === this.subtitleGeneration && isMissAVSubtitleEnabled(this.video.videoCode)
        const track = await this.optional(() => loadMissAVSubtitle(this.video.videoCode), lateTrack => {
          if (isCurrent()) this.updateData({ subtitles: lateTrack })
        })
        if (isCurrent()) this.updateData({ subtitles: track })
      } catch { /* Optional data must not break playback preparation. */ }
      finally { if (current === this.subtitleGeneration) this.subtitlePending = false }
    })()
    this.subtitleRead = read
    return read
  }

  async waitForData(): Promise<PreparedPlaybackData> {
    await Promise.all([this.ready, this.subtitleRead])
    return { ...this.data }
  }

  subscribeData(listener: PreparedPlaybackDataListener): () => void {
    this.dataListeners.add(listener)
    listener({ ...this.data })
    return () => { this.dataListeners.delete(listener) }
  }

  private updateData(patch: Partial<PreparedPlaybackData>): void {
    Object.assign(this.data, patch)
    const snapshot = { ...this.data }
    for (const listener of [...this.dataListeners]) {
      try { listener(snapshot) } catch { /* One consumer cannot interrupt preparation. */ }
    }
  }

  prepareSource(detail: MissAVVideoDetail, source = detail.sources[0]): void {
    if (this.closed || !source) return
    const key = `${detail.watchUrl}\n${source.url}`
    if (this.asset && this.resourceKey === key) return
    this.releaseAsset()
    try {
      const asset = new AVAsset(source.url, { headers: missavClient.playbackHeaders(detail.watchUrl, source.url) })
      this.asset = asset
      this.resourceKey = key
      // Constructor alone is lazy. Load only properties useful to playback;
      // retain this exact asset even if preparation times out or is unsupported.
      const loads: Promise<unknown>[] = []
      if (typeof asset.loadIsPlayable === "function") loads.push(asset.loadIsPlayable())
      if (typeof asset.loadDuration === "function") loads.push(asset.loadDuration())
      void withMissAVDeadline(Promise.all(loads), 5_000, "媒体准备超时。")
        .catch(() => { /* Actual playback remains authoritative and can retry. */ })
    } catch { /* Native playback can still construct the resource when tapped. */ }
  }

  takeAsset(detail: MissAVVideoDetail, source: MissAVVideoSource): AVAsset | undefined {
    if (this.closed || this.resourceKey !== `${detail.watchUrl}\n${source.url}`) return undefined
    const asset = this.asset
    this.asset = undefined
    this.resourceKey = ""
    return asset // Ownership transfers to the presented player, including disposal.
  }

  releaseAsset(): void {
    const asset = this.asset
    this.asset = undefined
    this.resourceKey = ""
    try { asset?.dispose() } catch { /* Native cleanup is best effort. */ }
  }

  dispose(): void { this.closed = true; ++this.subtitleGeneration; this.releaseAsset() }

  private async optional<T>(read: () => Promise<T>, onLate?: (value: T) => void): Promise<T | null> {
    let timedOut = false
    const request = Promise.resolve().then(read).then(value => {
      if (timedOut) onLate?.(value)
      return value
    })
    try { return await withMissAVDeadline(request, 2_000, "本机播放数据读取超时。", () => { timedOut = true }) }
    catch { return null }
  }
}
