import { AVPlayerView, Device, ForEach, Navigation, PIPStatus, Text, ZStack, useEffect, useObservable } from "scripting"
import { resolveMissAVResumePosition } from "./playback-progress"
import { startPlaybackPolling } from "./playback-polling"
import { findSubtitleCue, type SubtitleTrack } from "./subtitles"
import { subscribeMissAVLifecycle } from "./lifecycle"
import { createPlaybackProgressWriter } from "./playback-writer"
import { withMissAVDeadline } from "./request-deadline"
import { MissAVRequestScope } from "./request-scope"
import { isExpiredMissAVPlaybackError } from "./playback-startup"
import type { PreparedPlaybackData } from "./playback-preparation"
import { recordMissAVAccessDiagnostic } from "./access-diagnostics"

export type NativePlaybackRequest = {
  url: string
  asset?: AVAsset
  headers?: Record<string, string>
  title: string
  providerLabel: string
  qualityLabel: string
  resumePositionSeconds?: number
  resumeDurationSeconds?: number
  subtitles?: SubtitleTrack
  playbackData?: Promise<PreparedPlaybackData>
  subtitleDataPending?: boolean
  refreshSource?: (scope: MissAVRequestScope) => Promise<{ url: string; headers?: Record<string, string> }>
  diagnosticTarget?: string
  onProgress?: (positionSeconds: number, durationSeconds: number) => Promise<void> | void
}

export async function presentNativeOnlinePlayer(request: NativePlaybackRequest): Promise<void> {
  const startedAt = Date.now()
  const mark = (phase: "player-open" | "media-ready" | "playing" | "source-refresh" | "startup-timeout" | "player-failed" | "player-closed", failed = false) => {
    recordMissAVAccessDiagnostic("playback", request.diagnosticTarget ?? "runtime", { state: failed ? "load-error" : "normal", phase, elapsedMs: Date.now() - startedAt })
  }
  mark("player-open")
  if (!/^https?:\/\//i.test(request.url)) { request.asset?.dispose(); throw new Error("当前清晰度没有可用的播放地址。") }
  let player: AVPlayer
  try { player = new AVPlayer() } catch (error) { request.asset?.dispose(); throw error }
  let asset: AVAsset | undefined = request.asset
  let hasStarted = false, hasPlayed = false, hasEnded = false, closing = false
  let resumeApplied = false, recovering = false, retried = false
  let retryScope: MissAVRequestScope | undefined
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  let stopStartupPolling: (() => void) | undefined
  let dismissModal: (() => void) | undefined
  let playbackError: Error | undefined
  let reportFailure!: (error: Error) => void
  const failure = new Promise<Error>(resolve => { reportFailure = resolve })
  const subtitleState = { track: request.subtitles, pending: Boolean(request.subtitleDataPending) }
  let stopProgressPolling: (() => void) | undefined
  const progressWriter = createPlaybackProgressWriter((position, duration) => request.onProgress?.(position, duration), error => {
    console.error(`${request.providerLabel} 播放进度保存失败:`, error)
  })
  const saveProgress = (positionSeconds: number, durationSeconds: number): void => {
    if (request.onProgress) progressWriter.enqueue(positionSeconds, durationSeconds)
  }
  const stopProgress = () => { stopProgressPolling?.(); stopProgressPolling = undefined }
  const clearStartupTimer = () => {
    if (startupTimer !== undefined) clearTimeout(startupTimer)
    startupTimer = undefined
    stopStartupPolling?.(); stopStartupPolling = undefined
  }
  const isPlaying = (status: TimeControlStatus) => status === (typeof TimeControlStatus !== "undefined" ? TimeControlStatus.playing : "playing")
  const startProgress = () => {
    if (!hasStarted || hasEnded || closing || stopProgressPolling || !request.onProgress) return
    stopProgressPolling = startPlaybackPolling(() => {
      if (!hasEnded && !closing) saveProgress(player.currentTime, player.duration)
    }, 5_000)
  }
  const confirmPlaying = () => {
    if (closing || recovering || playbackError || hasEnded) return
    if (!hasPlayed) mark("playing")
    hasPlayed = true
    clearStartupTimer()
    startProgress()
  }
  const observeStartup = () => {
    if (closing || recovering || playbackError || hasEnded || hasPlayed) return
    // Native controls may deliver state callbacks late. Read the documented
    // player state as well; view resizing never starts a new startup deadline.
    if (isPlaying(player.timeControlStatus)) confirmPlaying()
  }
  const applyResume = () => {
    if (resumeApplied || closing || hasEnded) return
    const position = resolveMissAVResumePosition(request.resumePositionSeconds, request.resumeDurationSeconds, player.duration)
    if (position > 0) { resumeApplied = true; player.currentTime = position }
  }
  const fail = (reason: unknown) => {
    if (closing || playbackError) return
    playbackError = reason instanceof Error ? reason : new Error(String(reason))
    mark("player-failed", true)
    clearStartupTimer()
    retryScope?.cancel()
    reportFailure(playbackError)
    dismissModal?.()
  }
  const setSource = (url: string, headers?: Record<string, string>, prepared?: AVAsset) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("当前清晰度没有可用的播放地址。")
    const previous = asset
    const next = prepared ?? (headers && Object.keys(headers).length ? new AVAsset(url, { headers }) : undefined)
    asset = next
    try {
      if (!player.setSource(next ?? url)) throw new Error("系统无法加载该视频格式。")
    } finally { if (previous && previous !== next) previous.dispose() }
  }
  const recover = async (message: string) => {
    if (closing || recovering || playbackError) return
    if (hasPlayed || retried || !request.refreshSource || !isExpiredMissAVPlaybackError(message)) { fail(new Error(message)); return }
    retried = true; recovering = true; hasStarted = false
    mark("source-refresh")
    stopProgress()
    retryScope = new MissAVRequestScope()
    try {
      const next = await request.refreshSource(retryScope)
      retryScope.assertActive()
      if (closing || playbackError) return
      recovering = false
      setSource(next.url, next.headers)
    } catch (error) { if (!closing && !playbackError) fail(error) }
    finally { recovering = false }
  }
  const removeLifecycle = subscribeMissAVLifecycle(() => {
    if (hasStarted && !hasEnded && !closing) saveProgress(player.currentTime, player.duration)
  })
  // Late local data can join a loading player, without delaying presentation.
  void request.playbackData?.then(data => {
    if (closing || playbackError) return
    subtitleState.track = data.subtitles ?? undefined
    subtitleState.pending = false
    if (data.progress) {
      request.resumePositionSeconds = data.progress.positionSeconds
      request.resumeDurationSeconds = data.progress.durationSeconds
      if (hasStarted && !resumeApplied && player.currentTime <= 3) applyResume()
    }
  }, () => { subtitleState.pending = false })
  try {
    player.onReadyToPlay = () => {
      if (hasStarted || closing || recovering || playbackError) return
      hasStarted = true
      mark("media-ready")
      applyResume()
      if (player.play() === false) { fail(new Error("系统播放器未能开始播放。")); return }
      startProgress()
    }
    player.onTimeControlStatusChanged = status => {
      if (closing || recovering || playbackError) return
      if (isPlaying(status)) confirmPlaying()
      else if (hasStarted && !hasEnded) { stopProgress(); saveProgress(player.currentTime, player.duration) }
    }
    player.onEnded = () => {
      if (closing || hasEnded) return
      hasEnded = true; clearStartupTimer(); stopProgress(); saveProgress(0, player.duration)
    }
    player.onError = message => { void recover(message) }
    // Each native audio operation and the complete source/retry startup are bounded.
    await withMissAVDeadline(Promise.resolve(SharedAudioSession.setCategory("playback", [])), 3_000, "音频会话配置超时。")
    await withMissAVDeadline(Promise.resolve(SharedAudioSession.setActive(true)), 3_000, "音频会话启动超时。")
    startupTimer = setTimeout(() => {
      if (closing || playbackError || hasEnded || hasPlayed) return
      observeStartup()
      if (hasPlayed) return
      mark("startup-timeout", true)
      fail(new Error("视频启动超时，请检查网络后重试。"))
    }, 18_000)
    stopStartupPolling = startPlaybackPolling(observeStartup, 500)
    setSource(request.url, request.headers, request.asset)
    const previousOrientations = Device.supportedInterfaceOrientations.slice()
    Device.supportedInterfaceOrientations = ["landscapeLeft", "landscapeRight"]
    try {
      const presentation = Navigation.present({
        element: <NativeOnlinePlayerModal player={player} subtitles={request.subtitles} subtitleState={request.playbackData ? subtitleState : undefined} onDismissAvailable={dismiss => {
          dismissModal = dismiss
          if (playbackError) dismiss()
        }} />,
        modalPresentationStyle: "fullScreen",
      })
      await Promise.race([presentation, failure])
      if (playbackError) {
        // Let native dismissal finish before releasing the player view's resources.
        await withMissAVDeadline(presentation, 2_000, "播放器关闭超时。").catch(() => {})
        throw playbackError
      }
    } finally { Device.supportedInterfaceOrientations = previousOrientations }
  } finally {
    closing = true; clearStartupTimer(); retryScope?.cancel(); removeLifecycle(); stopProgress()
    if (hasStarted) saveProgress(hasEnded ? 0 : player.currentTime, player.duration)
    try { await withMissAVDeadline(progressWriter.flush(), 2_000, "播放进度保存超时。").catch(() => {}) }
    finally { player.stop(); player.dispose(); asset?.dispose(); mark("player-closed") }
  }
}

const SUBTITLE_FONT_SIZE = 27
const SUBTITLE_BOTTOM_INSET = 25
type SubtitleDisplayRow = { id: string; text: string }

function subtitleDisplayRows(subtitles: SubtitleTrack | undefined, time: number): SubtitleDisplayRow[] {
  const cue = subtitles ? findSubtitleCue(subtitles, time) : null
  return cue ? [{ id: `${cue.startSeconds}:${cue.endSeconds}:${cue.text}`, text: cue.text }] : []
}

function NativeOnlinePlayerModal({ player, subtitles, subtitleState, onDismissAvailable }: { player: AVPlayer; subtitles?: SubtitleTrack; subtitleState?: { track?: SubtitleTrack; pending: boolean }; onDismissAvailable?: (dismiss: () => void) => void }) {
  const dismiss = Navigation.useDismiss()
  useEffect(() => { onDismissAvailable?.(dismiss) }, [])
  const pipStatus = useObservable<PIPStatus>()
  const captionsEnabled = useObservable(Boolean(subtitles || subtitleState?.track || subtitleState?.pending))
  // ForEach observes this native data binding even when the initial time has no cue.
  // Do not leave a blank Text at opacity=0 and rely on parent props diffing to reveal it.
  const captionRows = useObservable<SubtitleDisplayRow[]>(() => subtitleDisplayRows(subtitleState?.track ?? subtitles, player.currentTime))

  useEffect(() => {
    if (!subtitles && !subtitleState) { captionRows.setValue([]); return }
    const refreshSubtitle = () => {
      const enabled = Boolean(subtitleState ? subtitleState.track || subtitleState.pending : subtitles)
      if (enabled !== captionsEnabled.value) captionsEnabled.setValue(enabled)
      const time = player.currentTime
      const nextRows = subtitleDisplayRows(subtitleState ? subtitleState.track : subtitles, time)
      if (nextRows[0]?.id === captionRows.value[0]?.id) return
      captionRows.setValue(nextRows)
    }
    refreshSubtitle()
    return startPlaybackPolling(refreshSubtitle, 250)
  }, [player, subtitles, subtitleState])

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" preferredColorScheme="dark" statusBarHidden={true} ignoresSafeArea={true}>
    <AVPlayerView
      player={player}
      pipStatus={pipStatus}
      allowsPictureInPicturePlayback={!captionsEnabled.value}
      canStartPictureInPictureAutomaticallyFromInline={!captionsEnabled.value}
      updatesNowPlayingInfoCenter={true}
      entersFullScreenWhenPlaybackBegins={false}
      exitsFullScreenWhenPlaybackEnds={false}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
    />
    {subtitles || subtitleState ? <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 56, bottom: SUBTITLE_BOTTOM_INSET }}>
      <ForEach data={captionRows} builder={row => <Text
        key={row.id}
        styledText={{
          content: row.text,
          font: SUBTITLE_FONT_SIZE,
          fontDesign: "default",
          fontWeight: "semibold",
          foregroundColor: "white",
          strokeColor: "black",
          // Apple's attributed-text convention: negative width draws fill + outline.
          strokeWidth: -4,
        }}
        lineLimit={1}
        truncationMode="tail"
        allowsTightening={true}
        minScaleFactor={0.8}
        multilineTextAlignment="center"
        frame={{ maxWidth: "infinity", alignment: "center" }}
        padding={{ horizontal: 4 }}
        shadow={{ color: "black", radius: 1, x: 0, y: 1 }}
      />} />
    </ZStack> : undefined}
  </ZStack>
}
