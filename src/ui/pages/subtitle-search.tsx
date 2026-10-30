import { Button, HStack, Image, LazyVStack, ProgressView, QuickLook, ScrollView, Text, TextField, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { ACCENT, CardSurface, READING_MAX_WIDTH, PageBackground, glassButtonStyle, PAGE_BOTTOM_PADDING, PAGE_PADDING } from "../design"
import { saveMissAVSubtitle } from "../../features/subtitles/subtitles"
import { downloadSubtitleCatFile, searchSubtitleCatFiles, type SubtitleCatSearchResult, type SubtitleCatSubtitleFile } from "../../features/subtitles/subtitlecat"
import { SubtitleFileRow } from "../components/subtitle_file_row"
import { extractSubtitleSearchCode } from "../../features/subtitles/subtitle-search-code"
import { SubtitleSearchSession } from "../../features/subtitles/subtitle-search-session"

export function SubtitleSearchPage(props: { videoCode: string; onDownloaded: (videoCode: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState(() => extractSubtitleSearchCode(props.videoCode))
  const [title, setTitle] = useState("")
  const [files, setFiles] = useState<SubtitleCatSubtitleFile[]>([])
  const [hasSuccessfulSource, setHasSuccessfulSource] = useState(false)
  const [hasIncompleteResults, setHasIncompleteResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchProgress, setSearchProgress] = useState("")
  const [searchSession] = useState(() => new SubtitleSearchSession(searchSubtitleCatFiles))
  const subtitleOperation = useRef(false)
  const active = useRef(true)

  function closeSearch() { active.current = false; searchSession.stop(); setLoading(false); props.onClose() }

  function appear() {
    active.current = true
    if (!hasSearched && !loading) void search(props.videoCode)
  }

  function disappear() {
    active.current = false
    searchSession.stop()
    setLoading(false)
  }

  async function search(value = query, forceRefresh = false) {
    const code = extractSubtitleSearchCode(value)
    if (!code || loading || downloadingId || subtitleOperation.current || !active.current) return
    setQuery(code)
    setLoading(true)
    setError(null)
    setFiles([])
    setHasSuccessfulSource(false)
    setHasIncompleteResults(false)
    setTitle("")
    setHasSearched(false)
    setSearchProgress("正在搜索匹配条目…")
    const updateResults = (result: SubtitleCatSearchResult) => {
      setTitle(code)
      setFiles(result.files)
      setHasSuccessfulSource(result.processedDetailCount > result.failedDetailCount || result.searchResultCount === 0)
      setHasIncompleteResults(result.failedDetailCount > 0 || result.processedDetailCount < result.searchResultCount)
      const cacheHits = (result.metrics?.searchCacheHits || 0) + (result.metrics?.detailCacheHits || 0)
      setSearchProgress(`已读取 ${result.processedDetailCount}/${result.searchResultCount} 个匹配条目${result.failedDetailCount ? ` · ${result.failedDetailCount} 个详情页未能读取` : ""}${cacheHits ? ` · 复用 ${cacheHits} 项缓存` : ""}`)
      setHasSearched(true)
    }
    await searchSession.search(code, forceRefresh, {
      onResult: updateResults,
      onError: reason => {
        setTitle(code)
        setHasSearched(true)
        setHasIncompleteResults(true)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
      onSettled: () => setLoading(false),
    })
  }

  async function download(file: SubtitleCatSubtitleFile) {
    if (!file.isFree || file.isDemo || subtitleOperation.current || !active.current) return
    subtitleOperation.current = true
    const fileKey = `${file.source}:${file.id}`
    pauseSearchForSubtitle()
    setDownloadingId(fileKey)
    setError(null)
    try {
      const content = await downloadSubtitleCatFile(file)
      if (!active.current) return
      // Search text is editable and may differ from this detail page's work.
      // Always save under the displayed video's identity so its playback path
      // and the subtitle folder use the same association key.
      const associatedCode = props.videoCode
      await saveMissAVSubtitle(associatedCode, content)
      if (!active.current) return
      props.onDownloaded(associatedCode)
      closeSearch()
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { subtitleOperation.current = false; setDownloadingId(null) }
  }

  async function preview(file: SubtitleCatSubtitleFile) {
    if (!file.isFree || file.isDemo || subtitleOperation.current || !active.current) return
    subtitleOperation.current = true
    pauseSearchForSubtitle()
    setDownloadingId(`${file.source}:${file.id}`)
    setError(null)
    try {
      const content = await downloadSubtitleCatFile(file)
      if (active.current) await QuickLook.previewText(content)
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { subtitleOperation.current = false; setDownloadingId(null) }
  }

  function pauseSearchForSubtitle() {
    if (!searchSession.stop()) return
    setLoading(false)
    setHasIncompleteResults(true)
    setSearchProgress("已停止剩余搜索，可预览或下载已载入的字幕")
  }

  useEffect(() => {
    return () => {
      active.current = false
      searchSession.stop()
    }
  }, [])

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} navigationTitle="按番号搜索字幕" navigationBarTitleDisplayMode="inline" toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}>
    <PageBackground />
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onAppear={appear} onDisappear={disappear}>
        <VStack spacing={16} alignment="leading" frame={{ maxWidth: READING_MAX_WIDTH }} padding={{ horizontal: PAGE_PADDING, top: 0, bottom: PAGE_BOTTOM_PADDING }}>
          <HStack spacing={8} padding={{ horizontal: 14 }} frame={{ maxWidth: "infinity", minHeight: 52 }} background={<CardSurface />} contentShape="rect">
            <TextField title="番号" prompt="例如 SSIS-655" value={query} onChanged={setQuery} onSubmit={() => { void search() }} autocorrectionDisabled frame={{ maxWidth: "infinity" }} />
            <Button action={() => { void search() }} disabled={loading || Boolean(downloadingId) || !query.trim()} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="capsule" accessibilityLabel="搜索字幕">
              {loading ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : <Image systemName="magnifyingglass" foregroundStyle={ACCENT} />}
            </Button>
          </HStack>
          <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">仅搜索简体和繁体中文字幕。下载始终关联当前作品，即使修改搜索番号。</Text>
          {error ? <VStack spacing={8} alignment="leading" padding={16} frame={{ maxWidth: "infinity", alignment: "leading" }} background={<CardSurface />}>
            <Text font="subheadline" foregroundStyle="systemRed" multilineTextAlignment="leading">{error}</Text>
            <Button title="重试搜索" systemImage="arrow.clockwise" disabled={loading} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44 }} action={() => { void search() }} />
          </VStack> : undefined}
          {loading && !hasSearched ? <HStack spacing={10} frame={{ maxWidth: "infinity", minHeight: 68 }}><ProgressView tint={ACCENT} /><VStack spacing={2} alignment="leading"><Text font="subheadline" fontWeight="medium">{`正在搜索 ${extractSubtitleSearchCode(query) || "字幕"}`}</Text><Text font="caption" foregroundStyle="secondaryLabel">有结果后会立即显示</Text></VStack></HStack> : undefined}
          {hasSearched ? <HStack spacing={8}>{loading ? <ProgressView tint={ACCENT} /> : undefined}<Text font="caption" foregroundStyle="secondaryLabel">{searchProgress}</Text></HStack> : undefined}
          {hasSearched ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <Text font="headline" fontWeight="semibold">{title || `番号 ${query}`}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{hasSuccessfulSource ? `Subtitle Cat · ${loading ? "已" : "共"}找到 ${files.length} 个可下载中文字幕文件${hasIncompleteResults && !loading ? "；部分详情页未能读取，结果可能不完整。" : ""}` : loading ? "正在读取 Subtitle Cat 字幕详情，有结果后立即显示。" : "Subtitle Cat 搜索没有成功完成，当前无法判断该番号是否有中文字幕。"}</Text>
            {files.length ? <LazyVStack spacing={8} frame={{ maxWidth: "infinity" }}>{files.map(file => <VStack key={`${file.source}-${file.id}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              <SubtitleFileRow file={file} downloadingId={downloadingId} onDownload={file => { void download(file) }} onPreview={file => { void preview(file) }} />
            </VStack>)}</LazyVStack> : <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">{loading ? "搜索仍在进行，请稍候…" : !hasSuccessfulSource ? "Subtitle Cat 没有返回有效搜索结果；不能据此认定没有中文字幕，请检查网络或稍后重试。" : hasIncompleteResults ? "已读取的详情页没有返回可下载中文字幕，仍有详情页未完成搜索。请重试，暂时无法判断是否有字幕。" : "没有找到这个番号的简体或繁体中文字幕。可以修改番号后重新搜索。"}</Text>}
            {hasIncompleteResults && hasSuccessfulSource ? <Button title="重试搜索" systemImage="arrow.clockwise" disabled={loading || Boolean(downloadingId)} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44 }} action={() => { void search() }} /> : undefined}
            <Button title="刷新搜索" systemImage="arrow.clockwise.circle" disabled={loading || Boolean(downloadingId)} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44 }} action={() => { void search(query, true) }} />
          </VStack> : undefined}
          {!loading && !hasSearched && !error ? <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">将自动搜索当前作品番号；也可以编辑番号后搜索其他字幕。</Text> : undefined}
        </VStack>
      </ScrollView>
    </VStack>
  </ZStack>
}
