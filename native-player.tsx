import { AVPlayerView, Device, Navigation, PIPStatus, Text, VStack, ZStack, useEffect, useObservable, useState } from "scripting"
import { resolveMissAVResumePosition } from "./playback-progress"
import { findMissAVSubtitleCue, type MissAVSubtitleCue } from "./subtitles"

export type NativePlaybackRequest = {
  url: string
  headers?: Record<string, string>
  title: string
  providerLabel: string
  qualityLabel: string
  subtitleCues?: MissAVSubtitleCue[]
  resumePositionSeconds?: number
  resumeDurationSeconds?: number
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
        element: <NativeOnlinePlayerModal player={player} subtitleCues={request.subtitleCues} />,
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

function NativeOnlinePlayerModal({ player, subtitleCues }: { player: AVPlayer; subtitleCues?: MissAVSubtitleCue[] }) {
  const pipStatus = useObservable<PIPStatus>()
  const [subtitleText, setSubtitleText] = useState("")
  useEffect(() => {
    if (!subtitleCues?.length) return
    const updateSubtitle = () => {
      const nextText = findMissAVSubtitleCue(subtitleCues, player.currentTime)?.text || ""
      setSubtitleText(current => current === nextText ? current : nextText)
    }
    updateSubtitle()
    const timer = setInterval(updateSubtitle, 300)
    return () => clearInterval(timer)
  }, [player, subtitleCues])
  return <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" statusBarHidden={false}>
    <AVPlayerView
      player={player}
      pipStatus={pipStatus}
      allowsPictureInPicturePlayback={true}
      canStartPictureInPictureAutomaticallyFromInline={true}
      updatesNowPlayingInfoCenter={true}
      entersFullScreenWhenPlaybackBegins={!subtitleCues?.length}
      exitsFullScreenWhenPlaybackEnds={false}
      videoGravity="resizeAspect"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
      overlay={subtitleText ? {
        alignment: "bottom",
        content: <VStack frame={{ maxWidth: "infinity" }} padding={{ horizontal: 24, bottom: 42 }}>
          <Text font="headline" fontWeight="semibold" foregroundStyle="white" multilineTextAlignment="center" lineLimit={3} padding={{ horizontal: 18, vertical: 8 }} background="black" clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}>{subtitleText}</Text>
        </VStack>,
      } : undefined}
    />
  </ZStack>
}
