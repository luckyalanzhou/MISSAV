import { AVPlayerView, Button, Device, ForEach, Navigation, NavigationStack, PIPStatus, Text, VStack, ZStack, useEffect, useObservable } from "scripting"
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

const SUBTITLE_FONT_SIZE = 27
const SUBTITLE_BOTTOM_INSET = 25
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

  useEffect(() => {
    if (!subtitles) { captionRows.setValue([]); return }
    const refreshSubtitle = () => {
      const time = player.currentTime
      const nextRows = subtitleDisplayRows(subtitles, time)
      if (nextRows[0]?.id === captionRows.value[0]?.id) return
      captionRows.setValue(nextRows)
    }
    refreshSubtitle()
    return startPlaybackPolling(refreshSubtitle, 250)
  }, [player, subtitles])

  return <NavigationStack preferredColorScheme="dark">
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="black"
      navigationBarTitleDisplayMode="inline"
      statusBarHidden={true}
      toolbar={{ cancellationAction: <Button title="完成" action={dismiss} /> }}
    >
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" ignoresSafeArea={true}>
        <AVPlayerView
          player={player}
          pipStatus={pipStatus}
          allowsPictureInPicturePlayback={!subtitles}
          canStartPictureInPictureAutomaticallyFromInline={!subtitles}
          updatesNowPlayingInfoCenter={true}
          entersFullScreenWhenPlaybackBegins={false}
          exitsFullScreenWhenPlaybackEnds={false}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          ignoresSafeArea={true}
        />
        {subtitles ? <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 56, bottom: SUBTITLE_BOTTOM_INSET }}>
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
    </VStack>
  </NavigationStack>
}
