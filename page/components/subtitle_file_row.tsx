import { Button, HStack, Image, ProgressView, Text, VStack } from "scripting"
import { ACCENT, MIN_HIT_SIZE } from "../../design"
import type { JavSubSubtitleFile } from "../../javsub"
import type { SubtitleCatSubtitleFile } from "../../subtitlecat"

type SubtitleFile = JavSubSubtitleFile | SubtitleCatSubtitleFile

export function SubtitleFileRow(props: {
  file: SubtitleFile
  downloadingId: string | null
  onDownload: (file: SubtitleFile) => void
}) {
  const { file, downloadingId } = props
  const canImport = file.isFree && !file.isDemo
  const downloading = downloadingId === `${file.source}:${file.id}`
  const metadata = [file.source, canImport ? "完整 · 免费" : "预览", file.details].filter(Boolean).join(" · ")

  return <HStack spacing={8} alignment="center" padding={{ vertical: 4 }} frame={{ maxWidth: "infinity", minHeight: MIN_HIT_SIZE }}>
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="subheadline" fontWeight="semibold" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{file.language}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} accessibilityLabel={metadata} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
    </VStack>
    <Button action={() => { if (canImport && !downloadingId) props.onDownload(file) }} disabled={!canImport || Boolean(downloadingId)} buttonStyle={canImport ? "borderedProminent" : "bordered"} tint={ACCENT} frame={{ minWidth: 108, minHeight: MIN_HIT_SIZE }} contentShape="rect" accessibilityLabel={canImport ? `下载并导入${file.source}的${file.language}字幕` : `${file.language}字幕仅供预览，无法导入`}>
      <HStack spacing={4}>
        {downloading ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName={canImport ? "square.and.arrow.down" : "eye"} font="caption" />}
        <Text font="caption" fontWeight="semibold" lineLimit={1}>{downloading ? "导入中…" : canImport ? "下载并导入" : "仅供预览"}</Text>
      </HStack>
    </Button>
  </HStack>
}
