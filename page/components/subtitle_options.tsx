import { Button, HStack, Image, ScrollView, Slider, Text, VStack } from "scripting"
import { DEFAULT_PLAYBACK_OPTIONS, SUBTITLE_FONT_RANGE, SUBTITLE_POSITION_RANGE, type PlaybackOptions } from "../../playback-options"

export function SubtitleOptionsPanel(props: {
  options: PlaybackOptions
  onChanged: (options: PlaybackOptions) => void
  onClose: () => void
}) {
  const { options, onChanged, onClose } = props
  return <ScrollView frame={{ width: 300, maxHeight: 300 }} background="rgba(0, 0, 0, 0.88)" clipShape={{ type: "rect", cornerRadius: 16 }}>
    <VStack spacing={10} alignment="leading" padding={16}>
      <HStack spacing={8}>
        <Text font="headline" foregroundStyle="white" frame={{ maxWidth: "infinity", alignment: "leading" }}>字幕选项</Text>
        <Button action={onClose} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭字幕选项"><Image systemName="xmark" foregroundStyle="white" /></Button>
      </HStack>
      <Text font="subheadline" foregroundStyle="white">{`字体大小：${options.subtitleFontSize} 点`}</Text>
      <Slider {...SUBTITLE_FONT_RANGE} value={options.subtitleFontSize} onChanged={value => onChanged({ ...options, subtitleFontSize: value })} label={<Text>字幕字体大小</Text>} tint="white" />
      <Text font="subheadline" foregroundStyle="white">{`距底部：${options.subtitleBottomInset} 点`}</Text>
      <Slider {...SUBTITLE_POSITION_RANGE} value={options.subtitleBottomInset} onChanged={value => onChanged({ ...options, subtitleBottomInset: value })} label={<Text>字幕上下位置</Text>} tint="white" />
      <Text font="caption" foregroundStyle="white">位置数值越大，字幕越靠上。调整即时生效并保存到本机。</Text>
      <Button title="恢复默认字幕样式" action={() => onChanged({ ...options, subtitleFontSize: DEFAULT_PLAYBACK_OPTIONS.subtitleFontSize, subtitleBottomInset: DEFAULT_PLAYBACK_OPTIONS.subtitleBottomInset })} buttonStyle="bordered" tint="white" frame={{ minHeight: 44 }} />
    </VStack>
  </ScrollView>
}
