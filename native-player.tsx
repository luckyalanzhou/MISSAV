import { AVPlayerView, Button, Device, ForEach, Image, Menu, Navigation, PIPStatus, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { resolveMissAVResumePosition } from "./playback-progress"
import { startPlaybackPolling } from "./playback-polling"
import { findSubtitleCue, type SubtitleTrack } from "./subtitles"
import { loadPlaybackOptions, normalizePlaybackOptions, pictureGravity, PICTURE_MODES, savePlaybackOptions, type PlaybackOptions } from "./playback-options"
import { SubtitleOptionsPanel } from "./page/components/subtitle_options"

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

type SubtitleDisplayRow = { id: string; text: string; fontSize: number }

function subtitleDisplayRows(subtitles: SubtitleTrack | undefined, time: number, options: PlaybackOptions): SubtitleDisplayRow[] {
  const cue = subtitles ? findSubtitleCue(subtitles, time) : null
  // A size change must rebuild the native text even while paused on the same cue.
  return cue ? [{ id: `${cue.startSeconds}:${cue.endSeconds}:${cue.text}:${options.subtitleFontSize}`, text: cue.text, fontSize: options.subtitleFontSize }] : []
}

function NativeOnlinePlayerModal({ player, subtitles }: { player: AVPlayer; subtitles?: SubtitleTrack }) {
  const dismiss = Navigation.useDismiss()
  const pipStatus = useObservable<PIPStatus>()
  const [options, setOptions] = useState(loadPlaybackOptions)
  const optionsRef = useRef(options)
  const [showSubtitleOptions, setShowSubtitleOptions] = useState(false)
  // ForEach observes this native data binding even when the initial time has no cue.
  // Do not leave a blank Text at opacity=0 and rely on parent props diffing to reveal it.
  const captionRows = useObservable<SubtitleDisplayRow[]>(() => subtitleDisplayRows(subtitles, player.currentTime, optionsRef.current))
  const displayStatus = useRef({ polls: 0, sampledTime: player.currentTime, builtText: "" })

  useEffect(() => {
    if (!subtitles) { captionRows.setValue([]); return }
    const refreshSubtitle = () => {
      const time = player.currentTime
      displayStatus.current.polls += 1
      displayStatus.current.sampledTime = time
      const nextRows = subtitleDisplayRows(subtitles, time, optionsRef.current)
      if (nextRows[0]?.id === captionRows.value[0]?.id) return
      if (!nextRows.length) displayStatus.current.builtText = ""
      captionRows.setValue(nextRows)
    }
    refreshSubtitle()
    return startPlaybackPolling(refreshSubtitle, 250)
  }, [player, subtitles])

  const changeOptions = (value: PlaybackOptions) => {
    const next = normalizePlaybackOptions(value)
    optionsRef.current = next
    setOptions(next)
    savePlaybackOptions(next)
    const nextRows = subtitleDisplayRows(subtitles, player.currentTime, next)
    if (nextRows[0]?.id !== captionRows.value[0]?.id) captionRows.setValue(nextRows)
  }

  const subtitleDisplayInfo = () => {
    const status = displayStatus.current
    return `显示路径：原生绑定 / 底部对齐\n定时器：递归 setTimeout（250 毫秒）\n自动采样：${status.polls} 次，最近 ${status.sampledTime.toFixed(2)} 秒\n送往显示层：${captionRows.value[0]?.text ?? "当前空档"}\n文本节点构建：${status.builtText || "尚未构建或当前空档"}`
  }

  return <ZStack alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black" ignoresSafeArea={true} preferredColorScheme="dark" statusBarHidden={true}>
    {/* Use the documented videoGravity API without remounting/reloading the player.
        Custom page captions cannot follow native PiP, so keep PiP for plain playback. */}
    <AVPlayerView
      player={player}
      pipStatus={pipStatus}
      allowsPictureInPicturePlayback={!subtitles}
      canStartPictureInPictureAutomaticallyFromInline={!subtitles}
      updatesNowPlayingInfoCenter={true}
      entersFullScreenWhenPlaybackBegins={false}
      exitsFullScreenWhenPlaybackEnds={false}
      videoGravity={pictureGravity(options.pictureMode)}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
    />
    {/* ZStack's alignment only aligns its children; its expanded frame must also
        align the intrinsic subtitle stack to the bottom instead of the center. */}
    {subtitles ? <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 56, bottom: options.subtitleBottomInset }}>
      <ForEach data={captionRows} builder={row => {
        displayStatus.current.builtText = row.text
        return <Text
          key={row.id}
          styledText={{
            content: row.text,
            font: row.fontSize,
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
    <PlayerCloseControl dismiss={dismiss} player={player} subtitles={subtitles} subtitleDisplayInfo={subtitleDisplayInfo} options={options} onChanged={changeOptions} onSubtitleOptions={() => setShowSubtitleOptions(value => !value)} />
    {showSubtitleOptions && subtitles ? <ZStack alignment="trailing" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "trailing" }} padding={{ trailing: 64 }}>
      <SubtitleOptionsPanel options={options} onChanged={changeOptions} onClose={() => setShowSubtitleOptions(false)} />
    </ZStack> : undefined}
  </ZStack>
}

function PlayerCloseControl({ dismiss, player, subtitles, subtitleDisplayInfo, options, onChanged, onSubtitleOptions }: { dismiss: () => void; player: AVPlayer; subtitles?: SubtitleTrack; subtitleDisplayInfo: () => string; options: PlaybackOptions; onChanged: (options: PlaybackOptions) => void; onSubtitleOptions: () => void }) {
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
    <Button action={onSubtitleOptions} disabled={!subtitles} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" background="rgba(0, 0, 0, 0.72)" clipShape={{ type: "rect", cornerRadius: 22 }} accessibilityLabel={subtitles ? "字幕选项：调整字号和上下位置" : "字幕选项：请先导入并开启字幕"}>
      <Image systemName="captions.bubble" font="headline" foregroundStyle={subtitles ? "white" : "secondaryLabel"} />
    </Button>
    <Menu label={<Image systemName="aspectratio" font="headline" foregroundStyle="white" frame={{ width: 44, height: 44 }} background="rgba(0, 0, 0, 0.72)" clipShape={{ type: "rect", cornerRadius: 22 }} />} accessibilityLabel="画面比例">
      {PICTURE_MODES.map(mode => <Button key={mode.value} title={mode.title} systemImage={options.pictureMode === mode.value ? "checkmark" : undefined} action={() => onChanged({ ...options, pictureMode: mode.value })} />)}
    </Menu>
    {subtitles && showLoadNotice ? <Text font="caption" foregroundStyle="white" lineLimit={1}>{`字幕已加载 · ${subtitles.cues.length} 条`}</Text> : undefined}
  </VStack>
}
