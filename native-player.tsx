import { AVPlayerView, Device, Navigation, PIPStatus, ZStack, useEffect, useObservable } from "scripting"

export type NativePlaybackRequest = {
  url: string
  headers?: Record<string, string>
  title: string
  providerLabel: string
  qualityLabel: string
}

export async function presentNativeOnlinePlayer(request: NativePlaybackRequest): Promise<void> {
  if (!/^https?:\/\//i.test(request.url)) throw new Error("当前清晰度没有可用的播放地址。")
  const player = new AVPlayer()
  try {
    player.onReadyToPlay = () => player.play()
    player.onError = message => console.error(`${request.providerLabel} 播放失败:`, message)
    const accepted = player.setSource(request.url, { headers: request.headers })
    if (!accepted) throw new Error("系统无法加载该视频格式。")
    SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
    SharedAudioSession.setActive(true)
    await Navigation.present({
      element: <NativeOnlinePlayerModal player={player} />,
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    player.stop()
    player.dispose()
  }
}

function NativeOnlinePlayerModal({ player }: { player: AVPlayer }) {
  const pipStatus = useObservable<PIPStatus>()
  useEffect(() => {
    Device.supportedInterfaceOrientations = ["landscapeLeft", "landscapeRight"]
    return () => {
      Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations
    }
  }, [])
  return <ZStack alignment="topLeading" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" statusBarHidden={false}>
    <AVPlayerView
      player={player}
      pipStatus={pipStatus}
      allowsPictureInPicturePlayback={true}
      canStartPictureInPictureAutomaticallyFromInline={true}
      updatesNowPlayingInfoCenter={true}
      entersFullScreenWhenPlaybackBegins={true}
      exitsFullScreenWhenPlaybackEnds={false}
      videoGravity="resizeAspect"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
    />
  </ZStack>
}
