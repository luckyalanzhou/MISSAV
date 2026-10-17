import { fetch } from "scripting"
import { missavClient } from "./client"
import { getMissAVBaseURL } from "./domain"
import { subscribeMissAVLifecycle } from "./lifecycle"
import { withMissAVDeadline } from "./request-deadline"
import { ThumbnailQualityQueue, highestManifestQuality, highestSourceQuality } from "./thumbnail-quality-queue"

const CACHE_KEY = "missav.thumbnail-quality.v1"

export const thumbnailQuality = new ThumbnailQualityQueue({
  key: video => `${getMissAVBaseURL()}|${video.videoCode.toLowerCase()}`,
  context: () => `${getMissAVBaseURL()}|${missavClient.thumbnailAccessRevision}`,
  canStart: () => missavClient.canLoadThumbnailQuality(),
  read: () => Storage.get<unknown>(CACHE_KEY),
  write: values => Storage.set(CACHE_KEY, values),
  load: async (video, scope) => {
    const detail = await missavClient.getVideo(video, { scope, preferRecent: true, background: true })
    scope.assertActive()
    const known = highestSourceQuality(detail.sources)
    if (known !== null) return known
    // Some works expose only an automatic HLS master. Read its small playlist,
    // never the video segments, to identify the highest declared rendition.
    const automatic = detail.sources.find(source => source.type === "application/vnd.apple.mpegurl")
    if (!automatic) return null
    const release = missavClient.trackThumbnailWork(scope)
    try { return await withMissAVDeadline(scope.waitFor((async () => {
      const response = await fetch(automatic.url, {
        headers: missavClient.playbackHeaders(detail.watchUrl, automatic.url), timeout: 3,
        debugLabel: "MissAV thumbnail quality playlist",
      })
      scope.assertActive()
      if (!response.ok) return null
      const manifest = await response.text()
      scope.assertActive()
      return highestManifestQuality(manifest)
    })()), 4_000, "画质读取超时。", () => scope.cancel()) }
    finally { release() }
  },
})

subscribeMissAVLifecycle(event => { if (event.kind === "minimize") thumbnailQuality.pause(); else thumbnailQuality.resume() })
