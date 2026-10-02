import { presentNativeOnlinePlayer } from "./native-player"
import { missavClient, type MissAVVideoItem, type MissAVVideoSource } from "./client"
import { loadMissAVPlaybackProgress, recordMissAVPlayback, saveMissAVPlaybackProgress } from "./storage"
import { matchFreshMissAVPlaybackSource } from "./playback-source"
import { isMissAVSubtitleEnabled, loadMissAVSubtitle, type SubtitleTrack } from "./subtitles"
import { withMissAVDeadline } from "./request-deadline"
export type MissAVPlaybackResult = { opened: true } | { opened: false }

export async function chooseAndPresentMissAVPlayer(video: MissAVVideoItem, selected: MissAVVideoSource, options?: { subtitles?: SubtitleTrack; preview?: boolean }): Promise<MissAVPlaybackResult> {
  const freshDetail = await missavClient.getVideo(video, { preferRecent: true })
  const freshSource = matchFreshMissAVPlaybackSource(selected, freshDetail.sources)
  if (!freshSource) throw new Error("所选清晰度已不可用，请刷新详情后重试。")
  if (!/^https?:\/\//i.test(freshSource.url)) throw new Error("当前清晰度没有可用的播放地址。")
  try {
    const preview = options?.preview === true
    // Optional native file/SQLite operations run together and cannot keep a
    // ready stream from opening indefinitely. Keep resume/subtitles when they
    // arrive on time; late results do not change an already opened player.
    const [storedSubtitles, progress] = await Promise.all([
      !preview && isMissAVSubtitleEnabled(video.videoCode) ? optionalPlaybackData(() => loadMissAVSubtitle(video.videoCode), "字幕读取") : Promise.resolve(null),
      !preview ? optionalPlaybackData(() => loadMissAVPlaybackProgress(video.videoCode), "播放进度读取") : Promise.resolve(null),
    ])
    const subtitles = options?.subtitles ?? storedSubtitles ?? undefined
    if (!preview) void Promise.resolve().then(() => recordMissAVPlayback(video, freshSource)).catch(() => console.warn("播放记录保存失败，不影响视频播放。"))
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

async function optionalPlaybackData<T>(read: () => Promise<T>, label: string): Promise<T | null> {
  try { return await withMissAVDeadline(Promise.resolve().then(read), 2_000, `${label}超时。`) }
  catch { console.warn(`${label}未能及时完成，本次播放继续。`); return null }
}
