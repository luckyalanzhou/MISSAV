import { AVPlayerView, Button, Device, HStack, Image, Navigation, PIPStatus, Spacer, Text, VStack, VideoPlayer, ZStack, useEffect, useObservable, useState } from "scripting"
import { resolveMissAVResumePosition } from "./playback-progress"
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
  let progressTimer: ReturnType<typeof setInterval> | undefined
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
      progressTimer = setInterval(() => {
        if (!hasEnded) saveProgress(player.currentTime, player.duration)
      }, 5_000)
    }
    player.onEnded = () => {
      hasEnded = true
      if (progressTimer !== undefined) clearInterval(progressTimer)
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
    if (progressTimer !== undefined) clearInterval(progressTimer)
    if (hasStarted) saveProgress(hasEnded ? 0 : player.currentTime, player.duration)
    await progressWrites
    player.stop()
    player.dispose()
  }
}

function NativeOnlinePlayerModal({ player, subtitles }: { player: AVPlayer; subtitles?: SubtitleTrack }) {
  const dismiss = Navigation.useDismiss()
  const pipStatus = useObservable<PIPStatus>()
  const [subtitleText, setSubtitleText] = useState(subtitles ? findSubtitleCue(subtitles, player.currentTime)?.text ?? "" : "")

  useEffect(() => {
    if (!subtitles) { setSubtitleText(""); return }
    let previousText: string | undefined
    const refreshSubtitle = () => {
      const nextText = findSubtitleCue(subtitles, player.currentTime)?.text ?? ""
      if (nextText === previousText) return
      previousText = nextText
      setSubtitleText(nextText)
    }
    refreshSubtitle()
    const timer = setInterval(refreshSubtitle, 250)
    return () => clearInterval(timer)
  }, [player, subtitles])

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
    {subtitles ? <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 28, bottom: 48 }}>
      <Spacer />
      {/* Keep the concrete Text mounted on the same page layer as the visible close control. */}
      <Text
        font="headline"
        fontWeight="semibold"
        foregroundStyle="white"
        lineLimit={1}
        truncationMode="tail"
        allowsTightening={true}
        multilineTextAlignment="center"
        frame={{ maxWidth: "infinity", alignment: "center" }}
        padding={{ horizontal: 14, vertical: 8 }}
        background="rgba(0, 0, 0, 0.72)"
        clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
        opacity={subtitleText ? 1 : 0}
      >{subtitleText || " "}</Text>
    </VStack> : undefined}
    <PlayerCloseControl dismiss={dismiss} player={player} subtitles={subtitles} />
  </ZStack>
}

function PlayerCloseControl({ dismiss, player, subtitles }: { dismiss: () => void; player: AVPlayer; subtitles?: SubtitleTrack }) {
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
        ? `已读取 ${subtitles.cues.length} 条对白\n当前视频时间：${time.toFixed(2)} 秒\n首句时间：${first?.startSeconds.toFixed(2) ?? "无"} 秒\n当前匹配：${cue ? `${cue.startSeconds.toFixed(2)}–${cue.endSeconds.toFixed(2)} 秒\n${cue.text}` : "当前时间没有对白；字幕可能有空档或与视频版本不一致。"}`
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
