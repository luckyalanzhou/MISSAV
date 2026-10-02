import { Button, Divider, HStack, Image, LazyVStack, Navigation, NavigationStack, ProgressView, QuickLook, ScrollView, ScrollViewReader, Text, TextField, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { missavClient, MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoDetail, type MissAVVideoItem, type MissAVVideoSource } from "../client"
import { ACCENT, Badge, MEDIA_HERO_RADIUS, PAGE_BOTTOM_PADDING, PAGE_PADDING, PRIMARY_ACTION_HEIGHT, PageBackground, SECONDARY_ACTION_HEIGHT, SECTION_SPACING, SectionHeading } from "../design"
import { chooseAndPresentMissAVPlayer } from "../player"
import { rememberMissAVDetail } from "../storage"
import { hasMissAVSubtitle, isMissAVSubtitleEnabled, saveMissAVSubtitle, setMissAVSubtitleEnabled } from "../subtitles"
import { downloadSubtitleCatFile, searchSubtitleCatFiles, type SubtitleCatSearchResult, type SubtitleCatSubtitleFile } from "../subtitlecat"
import { MediaArtwork } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { VideoRowList } from "./components/video_row"
import { SubtitleFileRow } from "./components/subtitle_file_row"
import { MISSAV_SUBTITLE_PREVIEW } from "../subtitles"
import { withMissAVDeadline } from "../request-deadline"
import { createMissAVDetailTrace, MISSAV_DETAIL_STAGE_LABELS, type MissAVDetailProgress, type MissAVDetailTrace } from "../detail-loading"
import { DetailPreparationStatus, useDetailNavigation } from "./detail-navigation"
import type { MissAVPlaybackPreparation } from "../playback-preparation"

export function DetailPage(props: { video: MissAVVideoItem; initialDetail?: MissAVVideoDetail; preparation?: MissAVPlaybackPreparation; onHistoryChanged: () => void }) {
  const [detail, setDetail] = useState<MissAVVideoDetail | null>(props.initialDetail ?? null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!props.initialDetail)
  const [loadProgress, setLoadProgress] = useState<MissAVDetailProgress | null>(null)
  const detailTrace = useRef<MissAVDetailTrace | null>(null)
  const [openingSource, setOpeningSource] = useState<string | null>(null)
  const [subtitleAvailable, setSubtitleAvailable] = useState(false)
  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [subtitleBusy, setSubtitleBusy] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagSearchPresented = useObservable(false)
  const generation = useRef(0)
  const requestScope = useRef<MissAVRequestScope | null>(null)
  const subtitleGeneration = useRef(0)
  const appeared = useRef(false)
  const initializedVideo = useRef<string | null>(null)
  const needsReload = useRef(true)

  async function load() {
    const current = ++generation.current
    requestScope.current?.cancel()
    const trace = createMissAVDetailTrace(props.video.detailPath, progress => { if (current === generation.current) setLoadProgress(progress) })
    detailTrace.current = trace
    trace.mark("entered")
    const scope = new MissAVRequestScope()
    requestScope.current = scope
    setLoading(true); setDetailError(null)
    try {
      const next = await missavClient.getVideo(props.video, { scope, trace })
      if (current !== generation.current) { trace.mark("discarded"); return }
      trace.mark("ui-update", { sourceCount: next.sources.length })
      setDetail(next)
      props.preparation?.prepareSource(next)
      trace.mark("completed")
      // History persistence is not part of loading playable detail.
      void rememberMissAVDetail(props.video, next).then(() => { if (current === generation.current) props.onHistoryChanged() }).catch(reason => console.error("保存浏览记录失败:", reason))
    } catch (reason) {
      if (current === generation.current) {
        if (isMissAVRequestCancelled(reason)) {
          needsReload.current = true
          setDetailError("详情请求已中断，请在访问线路验证结束后重试。")
        } else setDetailError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally { if (current === generation.current) { setLoading(false); requestScope.current = null } }
  }

  // A navigation destination can be constructed before it is shown. Own
  // requests with the native visible-page lifecycle, not separate effect
  // setup/cleanup hooks that can cancel a newly created destination request.
  function appear() {
    const changed = initializedVideo.current !== props.video.videoCode
    if (appeared.current && !changed) return
    appeared.current = true
    if (detail) props.preparation?.prepareSource(detail)
    if (changed) {
      initializedVideo.current = props.video.videoCode
      needsReload.current = !props.initialDetail
      setDetail(props.initialDetail ?? null); setLoading(!props.initialDetail); setOpeningSource(null)
      if (props.initialDetail) {
        void rememberMissAVDetail(props.video, props.initialDetail).then(props.onHistoryChanged).catch(reason => console.error("保存浏览记录失败:", reason))
      }
      setSubtitleAvailable(false); setSubtitleEnabled(true)
      const subtitleRequest = ++subtitleGeneration.current
      void hasMissAVSubtitle(props.video.videoCode).then(available => {
        if (subtitleRequest !== subtitleGeneration.current) return
        setSubtitleAvailable(available)
        setSubtitleEnabled(isMissAVSubtitleEnabled(props.video.videoCode))
      }).catch(reason => console.error("读取字幕状态失败:", reason))
    }
    if (needsReload.current) { needsReload.current = false; void load() }
  }

  function disappear() {
    if (initializedVideo.current !== props.video.videoCode || !appeared.current) return
    appeared.current = false
    // The full-screen player already claimed its asset; release only unused work.
    props.preparation?.releaseAsset()
    if (requestScope.current) {
      ++generation.current
      needsReload.current = true
      detailTrace.current?.mark("left")
      requestScope.current.cancel()
      requestScope.current = null
      setLoading(false)
    }
  }

  async function play(source: MissAVVideoSource, subtitlePreview = false) {
    if (!detail || openingSource) return
    setOpeningSource(source.url)
    try {
      const result = await chooseAndPresentMissAVPlayer(props.video, source, { detail, preparation: props.preparation, onDetailRefreshed: next => { setDetail(next); props.preparation?.releaseAsset() }, ...(subtitlePreview ? { subtitles: MISSAV_SUBTITLE_PREVIEW, preview: true } : {}) })
      if (result.opened && !subtitlePreview) props.onHistoryChanged()
    }
    catch (reason) { await Dialog.alert({ title: "播放失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setOpeningSource(null) }
  }

  function toggleSubtitle() {
    const next = !subtitleEnabled
    try {
      setMissAVSubtitleEnabled(props.video.videoCode, next)
      setSubtitleEnabled(next)
      void props.preparation?.refreshSubtitles()
    } catch (reason) {
      void Dialog.alert({ title: "字幕设置保存失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  async function searchSubtitles() {
    if (subtitleBusy) return
    setSubtitleBusy(true)
    try {
      await Navigation.present({
        element: <SubtitleSearchPage videoCode={code} onDownloaded={downloadedCode => {
          if (normalizeSubtitleAssociationCode(downloadedCode) !== normalizeSubtitleAssociationCode(code)) return
          setSubtitleAvailable(true)
          setSubtitleEnabled(true)
          void props.preparation?.refreshSubtitles()
        }} />,
        modalPresentationStyle: "overFullScreen",
      })
    } catch (reason) {
      await Dialog.alert({ title: "字幕搜索失败", message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setSubtitleBusy(false)
    }
  }

  const resolved = detail ?? { ...props.video, videoCode: props.video.videoCode, genres: [], sources: [] }
  const primarySource = detail?.sources[0]
  const code = props.video.videoCode.toUpperCase()
  const secondaryMetadata = [detail?.releaseDate, detail?.duration || props.video.duration, detail?.maker].filter(Boolean).join(" · ")
  function searchTag(tag: string) { setSelectedTag(tag); tagSearchPresented.setValue(true) }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="详情" navigationBarTitleDisplayMode="inline" onAppear={appear} onDisappear={disappear} refreshable={load} navigationDestination={{ isPresented: tagSearchPresented, content: selectedTag ? <TagSearchPage tag={selectedTag} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
    <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
      <MediaArtwork video={{ ...props.video, coverUrl: detail?.coverUrl || props.video.coverUrl }} height={204} radius={MEDIA_HERO_RADIUS} />

      <VStack spacing={6} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" fontWeight="bold" foregroundStyle={ACCENT} frame={{ maxWidth: "infinity", alignment: "leading" }}>{code}</Text>
        <Text font="title2" fontWeight="bold" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{detail?.title || resolved.title}</Text>
        {detail?.actress ? <Text font="headline" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{detail.actress}</Text> : undefined}
        {secondaryMetadata ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{secondaryMetadata}</Text> : undefined}
      </VStack>

      <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
        {primarySource ? <Button action={() => { void play(primarySource) }} disabled={Boolean(openingSource)} buttonStyle="borderedProminent" controlSize="large" tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: PRIMARY_ACTION_HEIGHT }} accessibilityLabel={openingSource === primarySource.url ? `正在打开 ${primarySource.label}` : `播放 ${primarySource.label}`}><HStack spacing={8}>{openingSource === primarySource.url ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName="play.fill" />}<Text font="headline" fontWeight="bold">{openingSource === primarySource.url ? "正在打开" : `播放 ${primarySource.label}`}</Text></HStack></Button> : loading ? <StateView title="正在获取播放信息" loading presentation="row" /> : undefined}
        {primarySource ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <Button action={() => { void searchSubtitles() }} disabled={subtitleBusy || Boolean(openingSource)} buttonStyle="bordered" frame={{ maxWidth: "infinity", minHeight: SECONDARY_ACTION_HEIGHT }} accessibilityLabel={`按番号搜索字幕 ${code}`}><HStack spacing={7}><Image systemName="magnifyingglass" /><Text>{subtitleBusy ? "正在搜索…" : "搜索字幕"}</Text></HStack></Button>
          {subtitleAvailable ? <Button action={toggleSubtitle} buttonStyle="bordered" frame={{ maxWidth: "infinity", minHeight: SECONDARY_ACTION_HEIGHT }} accessibilityLabel={subtitleEnabled ? "关闭本作品字幕显示" : "开启本作品字幕显示"}><HStack spacing={7}><Image systemName={subtitleEnabled ? "captions.bubble.fill" : "captions.bubble"} foregroundStyle={subtitleEnabled ? ACCENT : "secondaryLabel"} /><Text>{subtitleEnabled ? "关闭字幕" : "开启字幕"}</Text></HStack></Button> : undefined}
        </HStack> : undefined}
        {!subtitleAvailable ? <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">按番号搜索并下载字幕；文件保存在脚本目录的 subtitles 文件夹中，自动关联到对应作品，保存数量不限。</Text> : undefined}
        {primarySource ? <Button title="本地字幕叠层测试" systemImage="captions.bubble" buttonStyle="bordered" disabled={Boolean(openingSource)} action={() => { void play(primarySource, true) }} /> : undefined}
      </VStack>

      {loading && loadProgress ? <Text font="caption" foregroundStyle="secondaryLabel">{MISSAV_DETAIL_STAGE_LABELS[loadProgress.stage]}</Text> : undefined}
      {loading || detailError ? <Button title="加载诊断信息" systemImage="info.circle" buttonStyle="plain" action={() => { void Dialog.alert({ title: "详情加载诊断", message: detailTrace.current?.describe() || "尚未开始详情请求。" }) }} /> : undefined}
      {detailError && !detail ? <StateView title="详情加载失败" description={detailError} kind="error" action={() => { void load() }} /> : undefined}
      {detailError && detail ? <StateView title="刷新失败" description="正在显示上次加载的详情。" kind="error" action={() => { void load() }} presentation="row" /> : undefined}

      <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
        <SectionHeading title="作品信息" />
        <Text font="body" foregroundStyle="label" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{resolved.title}</Text>
      </VStack>

      {detail && detail.genres.length ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="作品标签" subtitle="选择标签，查看相关作品" /><ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}><HStack spacing={8}><Badge title={code} active systemImage="number" />{detail.genres.map(genre => <TagButton key={genre} title={genre} action={() => searchTag(genre)} />)}</HStack></ScrollView>{detail.maker ? <Text font="footnote" foregroundStyle="secondaryLabel">{`制作：${detail.maker}`}</Text> : undefined}</VStack> : undefined}

      {detail && detail.sources.length > 1 ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="其他清晰度" subtitle="选择其他可用画质" /><VStack spacing={0} frame={{ maxWidth: "infinity" }}>{detail.sources.slice(1).map((source, index) => <VStack key={`${source.label}-${source.url}`} spacing={0} frame={{ maxWidth: "infinity" }}>{index ? <Divider /> : undefined}<SourceRow source={source} openingSource={openingSource} action={() => { void play(source) }} /></VStack>)}</VStack></VStack> : !loading && detail && !detail.sources.length ? <StateView title="暂无可用播放源" description="请下拉刷新后重试。" kind="empty" systemImage="play.slash" action={() => { void load() }} actionTitle="重新加载" /> : undefined}
    </VStack>
  </ScrollView></ZStack>
}

function SubtitleSearchPage(props: { videoCode: string; onDownloaded: (videoCode: string) => void }) {
  const dismiss = Navigation.useDismiss()
  const [query, setQuery] = useState(props.videoCode)
  const [title, setTitle] = useState("")
  const [files, setFiles] = useState<SubtitleCatSubtitleFile[]>([])
  const [sourceStatus, setSourceStatus] = useState<string[]>([])
  const [hasSuccessfulSource, setHasSuccessfulSource] = useState(false)
  const [hasIncompleteResults, setHasIncompleteResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchProgress, setSearchProgress] = useState("")
  const searchSession = useRef<{ controller: WebViewController | null; cancelled: boolean } | null>(null)
  const subtitleOperation = useRef(false)
  const active = useRef(true)

  function closeSearch() { active.current = false; stopSearch(); dismiss() }

  function stopSearch() {
    const session = searchSession.current
    searchSession.current = null
    if (session) {
      session.cancelled = true
      try { session.controller?.dismiss() } catch { /* The native window may already be closing. */ }
    }
  }

  async function search(value = query, forceRefresh = false) {
    const code = value.trim().toUpperCase().replace(/\s+/g, "-")
    if (!code || loading || downloadingId || subtitleOperation.current || !active.current) return
    stopSearch()
    const session = { controller: null as WebViewController | null, cancelled: false }
    searchSession.current = session
    setQuery(code)
    setLoading(true)
    setError(null)
    setFiles([])
    setSourceStatus([])
    setHasSuccessfulSource(false)
    setHasIncompleteResults(false)
    setTitle("")
    setHasSearched(false)
    setSearchProgress("正在搜索匹配条目…")
    const updateResults = (result: SubtitleCatSearchResult) => {
      if (searchSession.current !== session) return
      setTitle(code)
      setFiles(result.files)
      setSourceStatus([`Subtitle Cat：${result.files.length} 个文件，${result.searchResultCount} 个匹配条目${result.failedDetailCount ? `，${result.failedDetailCount} 个详情页未能读取` : ""}`])
      setHasSuccessfulSource(result.processedDetailCount > result.failedDetailCount || result.searchResultCount === 0)
      setHasIncompleteResults(result.failedDetailCount > 0 || result.processedDetailCount < result.searchResultCount)
      const cacheHits = (result.metrics?.searchCacheHits || 0) + (result.metrics?.detailCacheHits || 0)
      setSearchProgress(`已读取 ${result.processedDetailCount}/${result.searchResultCount} 个匹配条目${cacheHits ? ` · 复用 ${cacheHits} 项缓存` : ""}`)
      setHasSearched(true)
    }
    try {
      const result = await searchSubtitleCatFiles(code, {
        isCancelled: () => session.cancelled || searchSession.current !== session,
        onControllerChange: controller => {
          session.controller = controller
          if (controller && session.cancelled) controller.dismiss()
        },
        onProgress: updateResults,
        forceRefresh,
      })
      if (searchSession.current !== session) return
      updateResults(result)
    } catch (reason) {
      if (searchSession.current === session) {
        setTitle(code)
        setHasSearched(true)
        setHasIncompleteResults(true)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (searchSession.current === session) {
        searchSession.current = null
        setLoading(false)
      }
    }
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
    } finally { subtitleOperation.current = false; if (active.current) setDownloadingId(null) }
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
    } finally { subtitleOperation.current = false; if (active.current) setDownloadingId(null) }
  }

  function pauseSearchForSubtitle() {
    if (!searchSession.current) return
    stopSearch()
    setLoading(false)
    setHasIncompleteResults(true)
    setSearchProgress("已停止剩余搜索，可预览或下载已载入的字幕")
  }

  useEffect(() => {
    void search(props.videoCode)
    return () => {
      active.current = false
      stopSearch()
    }
  }, [])

  return <NavigationStack><ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground">
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <HStack spacing={10} padding={{ horizontal: PAGE_PADDING, vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: 52 }}>
        <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="headline" fontWeight="bold">按番号搜索字幕</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">仅搜索简体中文和繁体中文字幕</Text>
        </VStack>
        <Button action={closeSearch} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭字幕搜索"><Image systemName="xmark" foregroundStyle="secondaryLabel" /></Button>
      </HStack>
      <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <VStack spacing={14} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
          <HStack spacing={8} padding={{ horizontal: 12 }} frame={{ maxWidth: "infinity", minHeight: 50 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
            <TextField title="番号" prompt="例如 SSIS-655" value={query} onChanged={setQuery} onSubmit={() => { void search() }} autocorrectionDisabled frame={{ maxWidth: "infinity" }} />
            <Button action={() => { void search() }} disabled={loading || Boolean(downloadingId) || !query.trim()} buttonStyle="borderedProminent" tint={ACCENT} accessibilityLabel="搜索字幕">
              {loading ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName="magnifyingglass" />}
            </Button>
          </HStack>
          <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">搜索 Subtitle Cat 的公开免费字幕。点击语言名称可预览文本，预览不会关联字幕。下载的完整 SRT 保存在脚本目录的 subtitles 文件夹中，保存数量不限，并关联到当前详情作品。修改搜索番号时，请确认字幕适用于当前作品。</Text>
          {error ? <VStack spacing={8} alignment="leading" padding={12} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
            <Text font="subheadline" foregroundStyle="systemRed" multilineTextAlignment="leading">{error}</Text>
            <Button title="重试搜索" systemImage="arrow.clockwise" disabled={loading} action={() => { void search() }} />
          </VStack> : undefined}
          {loading && !hasSearched ? <HStack spacing={10} frame={{ maxWidth: "infinity", minHeight: 100 }}><ProgressView tint={ACCENT} /><Text font="subheadline" foregroundStyle="secondaryLabel">正在按番号搜索…</Text></HStack> : undefined}
          {hasSearched ? <HStack spacing={8}>{loading ? <ProgressView tint={ACCENT} /> : undefined}<Text font="caption" foregroundStyle="secondaryLabel">{searchProgress}</Text></HStack> : undefined}
          {hasSearched ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <Text font="headline" fontWeight="semibold">{title || `番号 ${query}`}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{hasSuccessfulSource ? `${loading ? "已" : "共"}找到 ${files.length} 个可下载中文字幕文件；仅包含简体中文和繁体中文。${hasIncompleteResults && !loading ? " 部分详情页未能读取，结果可能不完整。" : ""}` : loading ? "正在读取字幕详情，有结果后立即显示。" : "Subtitle Cat 搜索没有成功完成，当前无法判断该番号是否有中文字幕。"}</Text>
            {sourceStatus.map((status, index) => <Text key={`subtitle-source-${index}`} font="caption" foregroundStyle={status.startsWith("失败") ? "systemRed" : "secondaryLabel"} multilineTextAlignment="leading">{status}</Text>)}
            {files.length ? <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>{files.map((file, index) => <VStack key={`${file.source}-${file.id}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index ? <Divider /> : undefined}
              <SubtitleFileRow file={file} downloadingId={downloadingId} onDownload={file => { void download(file) }} onPreview={file => { void preview(file) }} />
            </VStack>)}</LazyVStack> : <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">{loading ? "搜索仍在进行，请稍候…" : !hasSuccessfulSource ? "Subtitle Cat 没有返回有效搜索结果；不能据此认定没有中文字幕，请检查网络或稍后重试。" : hasIncompleteResults ? "已读取的详情页没有返回可下载中文字幕，仍有详情页未完成搜索。请重试，暂时无法判断是否有字幕。" : "没有找到这个番号的简体或繁体中文字幕。可以修改番号后重新搜索。"}</Text>}
            {hasIncompleteResults && hasSuccessfulSource ? <Button title="重试搜索" systemImage="arrow.clockwise" disabled={loading || Boolean(downloadingId)} action={() => { void search() }} /> : undefined}
            <Button title="刷新搜索" systemImage="arrow.clockwise.circle" disabled={loading || Boolean(downloadingId)} action={() => { void search(query, true) }} />
          </VStack> : undefined}
          {!loading && !hasSearched && !error ? <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">将自动搜索当前作品番号；也可以编辑番号后搜索其他字幕。</Text> : undefined}
        </VStack>
      </ScrollView>
    </VStack>
  </ZStack></NavigationStack>
}

function normalizeSubtitleAssociationCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "")
}

function TagButton(props: { title: string; action: () => void }) {
  return <Button action={props.action} buttonStyle="plain" frame={{ minHeight: 44 }} contentShape="rect" accessibilityLabel={`搜索标签 ${props.title}`}><HStack spacing={5} padding={{ horizontal: 10, vertical: 7 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 9, style: "continuous" }}><Image systemName="magnifyingglass" font="caption2" foregroundStyle={ACCENT} /><Text font="caption" fontWeight="semibold" lineLimit={1}>{props.title}</Text></HStack></Button>
}

function TagSearchPage(props: { tag: string; onHistoryChanged: () => void }) {
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultsRevision, setResultsRevision] = useState(0)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented
  const generation = useRef(0)
  const requestScope = useRef<MissAVRequestScope | null>(null)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  async function load(nextPage = 1) {
    const current = ++generation.current
    requestScope.current?.cancel()
    const scope = new MissAVRequestScope()
    requestScope.current = scope
    setLoading(true); setError(null)
    try { const result = await missavClient.searchVideoPage({ query: props.tag, page: nextPage, sort: "released_at", filter: "" }, { scope }); if (current !== generation.current) return; setItems(result.items); setPage(result.page); setHasNext(result.hasNext); setResultsRevision(value => value + 1) }
    catch (reason) { if (current === generation.current && !isMissAVRequestCancelled(reason)) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) { setLoading(false); requestScope.current = null } }
  }
  useEffect(() => { void load(1) }, [props.tag])
  useEffect(() => () => { ++generation.current; requestScope.current?.cancel() }, [props.tag])
  useEffect(() => { if (resultsRevision) scrollProxy.current?.scrollTo("tag-results-top", "top") }, [resultsRevision])
  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}><PageBackground /><ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle={props.tag} navigationBarTitleDisplayMode="inline" refreshable={() => load(page)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}><VStack key="tag-results-top" spacing={18} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}><VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><HStack spacing={7}><Image systemName="tag.fill" foregroundStyle={ACCENT} /><Text font="title2" fontWeight="bold">{props.tag}</Text></HStack><Text font="footnote" foregroundStyle="secondaryLabel">{`相关作品 · 第 ${page} 页 · ${items.length} 个结果`}</Text></VStack>{loading && !items.length ? <StateView title="正在搜索标签" loading presentation="section" /> : error && !items.length ? <StateView title="标签搜索失败" description={error} kind="error" action={() => { void load(page) }} /> : !items.length ? <StateView title="暂无相关作品" description="未找到带有此标签的作品。" systemImage="tag.slash" /> : <VideoRowList items={items} status={() => `标签 · ${props.tag}`} statusSystemImage="tag" onOpen={open} />}{error && items.length ? <StateView title="刷新失败" description="正在显示上次成功的结果。" kind="error" action={() => { void load(page) }} presentation="row" /> : undefined}{items.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}><Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} action={() => { void load(page - 1) }} /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text><Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} action={() => { void load(page + 1) }} /></HStack> : undefined}</VStack></ScrollView>}}</ScrollViewReader></ZStack>
}

function SourceRow(props: { source: MissAVVideoSource; openingSource: string | null; action: () => void }) {
  const opening = props.openingSource === props.source.url
  return <Button action={props.action} disabled={Boolean(props.openingSource)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={opening ? `正在打开 ${props.source.label}` : props.openingSource ? `${props.source.label}，正在打开其他清晰度` : `播放 ${props.source.label}`}><HStack spacing={12} padding={{ vertical: 10 }} frame={{ maxWidth: "infinity", minHeight: 58 }}>{opening ? <ProgressView progressViewStyle="circular" tint={ACCENT} frame={{ width: 30 }} /> : <Image systemName="play.circle" font="title2" foregroundStyle={ACCENT} frame={{ width: 30 }} />}<VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">{opening ? "正在打开" : props.source.label}</Text><Text font="caption" foregroundStyle="secondaryLabel">使用系统播放器</Text></VStack><Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" /></HStack></Button>
}
