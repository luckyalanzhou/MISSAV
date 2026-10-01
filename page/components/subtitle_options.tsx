import { Button, HStack, Image, ScrollView, Text, VStack } from "scripting"
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
      <SubtitleValueControl title="字体大小" value={options.subtitleFontSize} range={SUBTITLE_FONT_RANGE} onChanged={value => onChanged({ ...options, subtitleFontSize: value })} />
      <SubtitleValueControl title="距底部" value={options.subtitleBottomInset} range={SUBTITLE_POSITION_RANGE} onChanged={value => onChanged({ ...options, subtitleBottomInset: value })} />
      <Text font="caption" foregroundStyle="white">位置数值越大，字幕越靠上。调整即时生效并保存到本机。</Text>
      <Button title="恢复默认字幕样式" action={() => onChanged({ ...options, subtitleFontSize: DEFAULT_PLAYBACK_OPTIONS.subtitleFontSize, subtitleBottomInset: DEFAULT_PLAYBACK_OPTIONS.subtitleBottomInset })} buttonStyle="bordered" tint="white" frame={{ minHeight: 44 }} />
    </VStack>
  </ScrollView>
}
function SubtitleValueControl(props: {
  title: string
  value: number
  range: { min: number; max: number; step: number }
  onChanged: (value: number) => void
}) {
  const { title, value, range, onChanged } = props
  const adjust = (direction: number) => {
    const next = Math.min(range.max, Math.max(range.min, value + direction * range.step))
    if (next !== value) onChanged(next)
  }
  return <VStack spacing={4} alignment="leading">
    <Text font="subheadline" foregroundStyle="white">{title}</Text>
    <HStack spacing={8}>
      <Button action={() => adjust(-1)} disabled={value <= range.min} buttonStyle="bordered" tint="white" frame={{ width: 44, height: 44 }} accessibilityLabel={`减小${title}`}><Image systemName="minus" /></Button>
      <Text font="headline" foregroundStyle="white" frame={{ maxWidth: "infinity", minHeight: 44, alignment: "center" }} accessibilityLabel={`${title}：${value} 点`}>{`${value} 点`}</Text>
      <Button action={() => adjust(1)} disabled={value >= range.max} buttonStyle="bordered" tint="white" frame={{ width: 44, height: 44 }} accessibilityLabel={`增大${title}`}><Image systemName="plus" /></Button>
    </HStack>
  </VStack>
}
