import { presentNativeOnlinePlayer } from "./native-player"
import { missavClient, type MissAVVideoItem, type MissAVVideoSource } from "./client"
import { loadMissAVPlaybackProgress, recordMissAVPlayback, saveMissAVPlaybackProgress } from "./storage"
import { matchFreshMissAVPlaybackSource } from "./playback-source"
export type MissAVPlaybackResult = { opened: true } | { opened: false }

export async function chooseAndPresentMissAVPlayer(video: MissAVVideoItem, selected: MissAVVideoSource): Promise<MissAVPlaybackResult> {
  const freshDetail = await missavClient.getVideo(video)
  const freshSource = matchFreshMissAVPlaybackSource(selected, freshDetail.sources)
  if (!freshSource) throw new Error("所选清晰度已不可用，请刷新详情后重试。")
  if (!/^https?:\/\//i.test(freshSource.url)) throw new Error("当前清晰度没有可用的播放地址。")
  try {
    const progress = await loadMissAVPlaybackProgress(video.videoCode)
    await recordMissAVPlayback(video, freshSource)
    await presentNativeOnlinePlayer({
      url: freshSource.url,
      headers: missavClient.playbackHeaders(freshDetail.watchUrl, freshSource.url),
      title: freshDetail.title,
      providerLabel: "MISSAV",
      qualityLabel: freshSource.label,
      resumePositionSeconds: progress?.positionSeconds,
      resumeDurationSeconds: progress?.durationSeconds,
      onProgress: (positionSeconds, durationSeconds) => saveMissAVPlaybackProgress(video.videoCode, positionSeconds, durationSeconds),
    })
    return { opened: true }
  } catch (reason) {
    await Dialog.alert({ title: "系统播放器打开失败", message: reason instanceof Error ? reason.message : String(reason) })
    return { opened: false }
  }
}
