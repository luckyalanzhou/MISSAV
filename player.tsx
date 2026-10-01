import { presentNativeOnlinePlayer } from "./native-player"
import { missavClient, type MissAVVideoItem, type MissAVVideoSource } from "./client"
import { loadMissAVPlaybackProgress, recordMissAVPlayback, saveMissAVPlaybackProgress } from "./storage"
import { matchFreshMissAVPlaybackSource } from "./playback-source"
import { isMissAVSubtitleEnabled, loadMissAVSubtitle, type SubtitleTrack } from "./subtitles"
export type MissAVPlaybackResult = { opened: true } | { opened: false }

export async function chooseAndPresentMissAVPlayer(video: MissAVVideoItem, selected: MissAVVideoSource, options?: { subtitles?: SubtitleTrack; preview?: boolean }): Promise<MissAVPlaybackResult> {
  const freshDetail = await missavClient.getVideo(video)
  const freshSource = matchFreshMissAVPlaybackSource(selected, freshDetail.sources)
  if (!freshSource) throw new Error("所选清晰度已不可用，请刷新详情后重试。")
  if (!/^https?:\/\//i.test(freshSource.url)) throw new Error("当前清晰度没有可用的播放地址。")
  try {
    const preview = options?.preview === true
    const storedSubtitles = !preview && isMissAVSubtitleEnabled(video.videoCode) ? await loadMissAVSubtitle(video.videoCode) : null
    const subtitles = options?.subtitles ?? storedSubtitles ?? undefined
    const progress = preview ? undefined : await loadMissAVPlaybackProgress(video.videoCode)
    if (!preview) await recordMissAVPlayback(video, freshSource)
    await presentNativeOnlinePlayer({
      url: freshSource.url,
      headers: missavClient.playbackHeaders(freshDetail.watchUrl, freshSource.url),
      title: freshDetail.title,
      providerLabel: "MISSAV",
      qualityLabel: freshSource.label,
      resumePositionSeconds: preview ? 0 : progress?.positionSeconds,
      resumeDurationSeconds: progress?.durationSeconds,
      subtitles,
      onProgress: preview ? undefined : (positionSeconds, durationSeconds) => saveMissAVPlaybackProgress(video.videoCode, positionSeconds, durationSeconds),
    })
    return { opened: true }
  } catch (reason) {
    await Dialog.alert({ title: "系统播放器打开失败", message: reason instanceof Error ? reason.message : String(reason) })
    return { opened: false }
  }
}
