import { presentNativeOnlinePlayer } from "./native-player"
import { missavClient, type MissAVVideoDetail, type MissAVVideoItem, type MissAVVideoSource } from "./client"
import { loadMissAVPlaybackProgress, recordMissAVPlayback, saveMissAVPlaybackProgress } from "./storage"
import { isMissAVSubtitleEnabled, loadMissAVSubtitle } from "./subtitles"
import { withMissAVDeadline } from "./request-deadline"
import type { MissAVPlaybackPreparation } from "./playback-preparation"
import { matchFreshMissAVPlaybackSource } from "./playback-source"
export type MissAVPlaybackResult = { opened: true } | { opened: false }

export async function chooseAndPresentMissAVPlayer(video: MissAVVideoItem, selected: MissAVVideoSource, options: { detail: MissAVVideoDetail; preparation?: MissAVPlaybackPreparation; onDetailRefreshed?: (detail: MissAVVideoDetail) => void }): Promise<MissAVPlaybackResult> {
  const freshDetail = options.detail
  const freshSource = freshDetail.sources.find(source => source.url === selected.url && source.type === selected.type)
  if (!freshSource) throw new Error("所选清晰度已不可用，请刷新详情后重试。")
  if (!/^https?:\/\//i.test(freshSource.url)) throw new Error("当前清晰度没有可用的播放地址。")
  try {
    // Optional native file/SQLite operations run together and cannot keep a
    // ready stream from opening indefinitely. Keep resume/subtitles when they
    // arrive on time; late local data joins the opened player without blocking it.
    const [storedSubtitles, progress] = options.preparation ? [options.preparation.data.subtitles, options.preparation.data.progress] : await Promise.all([
      isMissAVSubtitleEnabled(video.videoCode) ? optionalPlaybackData(() => loadMissAVSubtitle(video.videoCode), "字幕读取") : Promise.resolve(null),
      optionalPlaybackData(() => loadMissAVPlaybackProgress(video.videoCode), "播放进度读取"),
    ])
    const subtitles = (isMissAVSubtitleEnabled(video.videoCode) ? storedSubtitles : null) ?? undefined
    void Promise.resolve().then(() => recordMissAVPlayback(video, freshSource)).catch(() => console.warn("播放记录保存失败，不影响视频播放。"))
    await presentNativeOnlinePlayer({
      url: freshSource.url,
      asset: options.preparation?.takeAsset(freshDetail, freshSource),
      headers: missavClient.playbackHeaders(freshDetail.watchUrl, freshSource.url),
      title: freshDetail.title,
      diagnosticTarget: freshDetail.watchUrl,
      providerLabel: "MISSAV",
      qualityLabel: freshSource.label,
      resumePositionSeconds: progress?.positionSeconds,
      resumeDurationSeconds: progress?.durationSeconds,
      subtitles,
      subtitleDataPending: Boolean(options.preparation?.subtitlePending),
      playbackData: options.preparation?.waitForData(),
      refreshSource: async scope => {
        // Called only for a confirmed startup access/signature failure.
        const nextDetail = await missavClient.getVideo(video, { scope })
        scope.assertActive()
        const nextSource = matchFreshMissAVPlaybackSource(freshSource, nextDetail.sources)
        if (!nextSource) throw new Error("所选清晰度已不可用，请刷新详情后重试。")
        options.onDetailRefreshed?.(nextDetail)
        return { url: nextSource.url, headers: missavClient.playbackHeaders(nextDetail.watchUrl, nextSource.url) }
      },
      onProgress: (positionSeconds, durationSeconds) => {
        if (options.preparation) options.preparation.data.progress = { videoCode: video.videoCode, positionSeconds, durationSeconds, updatedAt: Date.now() }
        return saveMissAVPlaybackProgress(video.videoCode, positionSeconds, durationSeconds)
      },
    })
    return { opened: true }
  } catch (reason) {
    await Dialog.alert({ title: "系统播放器打开失败", message: reason instanceof Error ? reason.message : String(reason) })
    return { opened: false }
  }
}

async function optionalPlaybackData<T>(read: () => Promise<T>, label: string): Promise<T | null> {
  try { return await withMissAVDeadline(Promise.resolve().then(read), 2_000, `${label}超时。`) }
  catch { console.warn(`${label}未能及时完成，本次播放继续。`); return null }
}
