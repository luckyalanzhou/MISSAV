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

  // Reserve a real row outside the video; native controls never share this hit area.
  return <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" statusBarHidden={false}>
    <PlayerCloseControl dismiss={dismiss} subtitles={subtitles} />
    {subtitles
      ? <VideoPlayer
        player={player}
        // Use the native video overlay so captions follow the system full-screen player.
        overlay={<SubtitlePlaybackOverlay player={player} subtitles={subtitles} />}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
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
      />}
  </VStack>
}

function SubtitlePlaybackOverlay({ player, subtitles }: { player: AVPlayer; subtitles: SubtitleTrack }) {
  const [subtitleText, setSubtitleText] = useState("")

  useEffect(() => {
    // Keep caption state in the overlay: changing a cue must not rebuild VideoPlayer.
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

  return <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    {subtitleText ? <SubtitleCaption text={subtitleText} /> : undefined}
  </ZStack>
}

function PlayerCloseControl({ dismiss, subtitles }: { dismiss: () => void; subtitles?: SubtitleTrack }) {
  const [showLoadNotice, setShowLoadNotice] = useState(true)
  useEffect(() => {
    setShowLoadNotice(true)
    if (!subtitles) return
    const timer = setTimeout(() => setShowLoadNotice(false), 5_000)
    return () => clearTimeout(timer)
  }, [subtitles])

  return <HStack spacing={10} frame={{ maxWidth: "infinity", height: 52, alignment: "leading" }} padding={{ horizontal: 14 }} background="black">
    <Button action={() => dismiss()} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭播放器">
      <Image systemName="xmark" font="headline" foregroundStyle="white" />
    </Button>
    {subtitles && showLoadNotice ? <Text font="caption" foregroundStyle="white" lineLimit={1}>{`字幕已加载 · ${subtitles.cues.length} 条`}</Text> : undefined}
    <Spacer />
  </HStack>
}

function SubtitleCaption({ text }: { text: string }) {
  return <VStack spacing={0} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ horizontal: 28, bottom: 48 }}>
    <Text
      font="headline"
      fontWeight="semibold"
      foregroundStyle="white"
      lineLimit={1}
      truncationMode="tail"
      allowsTightening={true}
      multilineTextAlignment="center"
      padding={{ horizontal: 14, vertical: 8 }}
      background="rgba(0, 0, 0, 0.72)"
      clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
    >{text}</Text>
  </VStack>
}
