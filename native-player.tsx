import { AVPlayerView, Button, Device, ForEach, Image, Navigation, PIPStatus, Text, VStack, VideoPlayer, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { resolveMissAVResumePosition } from "./playback-progress"
import { startPlaybackPolling } from "./playback-polling"
import { findSubtitleCue, type SubtitleTrack } from "./subtitles"

export type NativePlaybackRequest = {
  url: string
  headers?: Record<string, string>
  title: string
  providerLabel: string
  qualityLabel: string
  resumePositionSeconds?: number
  resumeDurationSeconds?: number
  subtitles?: SubtitleTrack
  onProgress?: (positionSeconds: number, durationSeconds: number) => Promise<void> | void
}

export async function presentNativeOnlinePlayer(request: NativePlaybackRequest): Promise<void> {
  if (!/^https?:\/\//i.test(request.url)) throw new Error("当前清晰度没有可用的播放地址。")
  const player = new AVPlayer()
  let hasStarted = false
  let hasEnded = false
  let stopProgressPolling: (() => void) | undefined
  let progressWrites = Promise.resolve()
  const saveProgress = (positionSeconds: number, durationSeconds: number): void => {
    if (!request.onProgress) return
    progressWrites = progressWrites.then(() => request.onProgress?.(positionSeconds, durationSeconds)).then(() => undefined).catch(error => {
      console.error(`${request.providerLabel} 播放进度保存失败:`, error)
    })
  }
  try {
    player.onReadyToPlay = () => {
      if (hasStarted) return
      hasStarted = true
      const resumePosition = resolveMissAVResumePosition(request.resumePositionSeconds, request.resumeDurationSeconds, player.duration)
      if (resumePosition > 0) player.currentTime = resumePosition
      player.play()
      stopProgressPolling = startPlaybackPolling(() => {
        if (!hasEnded) saveProgress(player.currentTime, player.duration)
      }, 5_000)
    }
    player.onEnded = () => {
      hasEnded = true
      stopProgressPolling?.()
      saveProgress(0, player.duration)
    }
    player.onError = message => console.error(`${request.providerLabel} 播放失败:`, message)
    const accepted = player.setSource(request.url, { headers: request.headers })
    if (!accepted) throw new Error("系统无法加载该视频格式。")
    SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
    SharedAudioSession.setActive(true)
    const previousOrientations = Device.supportedInterfaceOrientations.slice()
    Device.supportedInterfaceOrientations = ["landscapeLeft", "landscapeRight"]
    try {
      await Navigation.present({
        element: <NativeOnlinePlayerModal player={player} subtitles={request.subtitles} />,
        modalPresentationStyle: "fullScreen",
      })
    } finally {
      Device.supportedInterfaceOrientations = previousOrientations
    }
  } finally {
    stopProgressPolling?.()
    if (hasStarted) saveProgress(hasEnded ? 0 : player.currentTime, player.duration)
    await progressWrites
    player.stop()
    player.dispose()
  }
}

type SubtitleDisplayRow = { id: string; text: string }

function subtitleDisplayRows(subtitles: SubtitleTrack | undefined, time: number): SubtitleDisplayRow[] {
  const cue = subtitles ? findSubtitleCue(subtitles, time) : null
  return cue ? [{ id: `${cue.startSeconds}:${cue.endSeconds}:${cue.text}`, text: cue.text }] : []
}

function NativeOnlinePlayerModal({ player, subtitles }: { player: AVPlayer; subtitles?: SubtitleTrack }) {
  const dismiss = Navigation.useDismiss()
  const pipStatus = useObservable<PIPStatus>()
  // ForEach observes this native data binding even when the initial time has no cue.
  // Do not leave a blank Text at opacity=0 and rely on parent props diffing to reveal it.
  const captionRows = useObservable<SubtitleDisplayRow[]>(() => subtitleDisplayRows(subtitles, player.currentTime))
  const displayStatus = useRef({ polls: 0, sampledTime: player.currentTime, builtText: "" })

  useEffect(() => {
    if (!subtitles) { captionRows.setValue([]); return }
    const refreshSubtitle = () => {
      const time = player.currentTime
      displayStatus.current.polls += 1
      displayStatus.current.sampledTime = time
      const nextRows = subtitleDisplayRows(subtitles, time)
      if (nextRows[0]?.id === captionRows.value[0]?.id) return
      if (!nextRows.length) displayStatus.current.builtText = ""
      captionRows.setValue(nextRows)
    }
    refreshSubtitle()
    return startPlaybackPolling(refreshSubtitle, 250)
  }, [player, subtitles])

  const subtitleDisplayInfo = () => {
    const status = displayStatus.current
    return `显示路径：原生绑定 / 底部对齐\n定时器：递归 setTimeout（250 毫秒）\n自动采样：${status.polls} 次，最近 ${status.sampledTime.toFixed(2)} 秒\n送往显示层：${captionRows.value[0]?.text ?? "当前空档"}\n文本节点构建：${status.builtText || "尚未构建或当前空档"}`
  }

  return <ZStack alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" ignoresSafeArea={true} preferredColorScheme="dark" statusBarHidden={true}>
    {subtitles
      ? <VideoPlayer
        player={player}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
      />
      : <AVPlayerView
        player={player}
        pipStatus={pipStatus}
        allowsPictureInPicturePlayback={true}
        canStartPictureInPictureAutomaticallyFromInline={true}
        updatesNowPlayingInfoCenter={true}
        entersFullScreenWhenPlaybackBegins={false}
        exitsFullScreenWhenPlaybackEnds={false}
        videoGravity="resizeAspect"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={true}
      />}
    {/* ZStack's alignment only aligns its children; its expanded frame must also
        align the intrinsic subtitle stack to the bottom instead of the center. */}
    {subtitles ? <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 56, bottom: 64 }}>
      <ForEach data={captionRows} builder={row => {
        displayStatus.current.builtText = row.text
        return <Text
          key={row.id}
          styledText={{
            content: row.text,
            font: "headline",
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
          padding={{ horizontal: 4, vertical: 4 }}
          shadow={{ color: "black", radius: 1, x: 0, y: 1 }}
        />
      }} />
    </ZStack> : undefined}
    <PlayerCloseControl dismiss={dismiss} player={player} subtitles={subtitles} subtitleDisplayInfo={subtitleDisplayInfo} />
  </ZStack>
}

function PlayerCloseControl({ dismiss, player, subtitles, subtitleDisplayInfo }: { dismiss: () => void; player: AVPlayer; subtitles?: SubtitleTrack; subtitleDisplayInfo: () => string }) {
  const [showLoadNotice, setShowLoadNotice] = useState(true)
  useEffect(() => {
    setShowLoadNotice(true)
    if (!subtitles) return
    const timer = setTimeout(() => setShowLoadNotice(false), 5_000)
    return () => clearTimeout(timer)
  }, [subtitles])

  async function showSubtitleInfo() {
    const time = player.currentTime
    const cue = subtitles ? findSubtitleCue(subtitles, time) : null
    const first = subtitles?.cues[0]
    await Dialog.alert({
      title: "字幕信息",
      message: subtitles
        ? `已读取 ${subtitles.cues.length} 条对白\n当前视频时间：${time.toFixed(2)} 秒\n首句时间：${first?.startSeconds.toFixed(2) ?? "无"} 秒\n当前匹配：${cue ? `${cue.startSeconds.toFixed(2)}–${cue.endSeconds.toFixed(2)} 秒\n${cue.text}` : "当前时间没有对白；字幕可能有空档或与视频版本不一致。"}\n\n${subtitleDisplayInfo()}`
        : "播放器没有收到字幕。请确认详情页已导入字幕，并且字幕开关已开启。",
    })
  }

  // Float in the leading-side middle, away from native top/bottom/central transport controls.
  return <VStack spacing={8} alignment="leading" padding={{ leading: 64 }}>
    <Button action={() => dismiss()} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" background="rgba(0, 0, 0, 0.72)" clipShape={{ type: "rect", cornerRadius: 22 }} accessibilityLabel="关闭播放器" contextMenu={{ menuItems: <Button title="字幕信息" systemImage="captions.bubble" action={() => { void showSubtitleInfo() }} /> }}>
      <Image systemName="xmark" font="headline" foregroundStyle="white" />
    </Button>
    {subtitles && showLoadNotice ? <Text font="caption" foregroundStyle="white" lineLimit={1}>{`字幕已加载 · ${subtitles.cues.length} 条`}</Text> : undefined}
  </VStack>
}
