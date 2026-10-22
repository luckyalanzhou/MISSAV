import { Button, Capsule, FlowLayout, GeometryReader, HStack, Image, ProgressView, RoundedRectangle, ScrollView, ScrollViewReader, Text, VStack, ZStack, useEffect, useObservable, useRef, useState, type DynamicShapeStyle, type ScrollViewProxy } from "scripting"
import { missavClient, MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoDetail, type MissAVVideoItem, type MissAVVideoSource } from "../../site/client"
import { ACCENT, glassButtonStyle, PAGE_BOTTOM_PADDING, PAGE_PADDING, PRIMARY_ACTION_HEIGHT, PageBackground, READING_MAX_WIDTH } from "../design"
import { chooseAndPresentMissAVPlayer } from "../../features/playback/player"
import { rememberMissAVDetail } from "../../data/storage"
import { hasMissAVSubtitle, isMissAVSubtitleEnabled, setMissAVSubtitleEnabled } from "../../features/subtitles/subtitles"
import { StateView } from "../components/state_view"
import { VideoRowList } from "../components/video_row"
import { SubtitleSearchPage } from "./subtitle-search"
import { copyMissAVDetailReport, createMissAVDetailTrace, MISSAV_DETAIL_STAGE_LABELS, type MissAVDetailProgress, type MissAVDetailTrace } from "../../features/detail/detail-loading"
import { DetailPreparationStatus, useDetailNavigation } from "./detail-navigation"
import type { MissAVPlaybackPreparation } from "../../features/playback/playback-preparation"
import { startPlaybackPolling } from "../../features/playback/playback-polling"
import { MissAVListingRequest } from "../../site/listing/listing-request"

// Native dynamic styles keep the page responsive to system appearance changes.
const DETAIL_CANVAS: DynamicShapeStyle = { light: "#FFFFFF", dark: "#101114" }
const DETAIL_BACKGROUND: DynamicShapeStyle = {
  light: { gradient: [{ color: "rgba(255,255,255,0.84)", location: 0 }, { color: "#FFFFFF", location: 0.65 }], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } },
  dark: { gradient: [{ color: "rgba(16,17,20,0.82)", location: 0 }, { color: "#101114", location: 0.65 }], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } },
}
const DETAIL_SURFACE: DynamicShapeStyle = { light: "rgba(255,255,255,0.88)", dark: "rgba(255,255,255,0.07)" }
const DETAIL_RIM: DynamicShapeStyle = { light: "rgba(96,108,124,0.18)", dark: "rgba(255,255,255,0.12)" }

export function DetailPage(props: { video: MissAVVideoItem; initialDetail?: MissAVVideoDetail; initialTrace?: MissAVDetailTrace; preparation?: MissAVPlaybackPreparation; onHistoryChanged: () => void }) {
  const [detail, setDetail] = useState<MissAVVideoDetail | null>(props.initialDetail ?? null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!props.initialDetail)
  const [loadProgress, setLoadProgress] = useState<MissAVDetailProgress | null>(null)
  const [clock, setClock] = useState(Date.now())
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null)
  const detailTrace = useRef<MissAVDetailTrace | null>(props.initialTrace ?? null)
  const [openingSource, setOpeningSource] = useState<string | null>(null)
  const [subtitleAvailable, setSubtitleAvailable] = useState(false)
  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [subtitleSearchPresented, setSubtitleSearchPresented] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [titleExpanded, setTitleExpanded] = useState(false)
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
    const startedAt = Date.now()
    setLoadStartedAt(startedAt)
    setClock(startedAt)
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

  async function copyLoadDiagnostics() {
    try {
      await copyMissAVDetailReport(detailTrace.current, props.video.videoCode)
      await Dialog.alert({ title: "诊断已复制", message: "已复制详情加载的阶段耗时和解析信息。回到对话粘贴即可发送给我。" })
    } catch (reason) {
      await Dialog.alert({ title: "复制诊断失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  useEffect(() => {
    if (!loading) return
    return startPlaybackPolling(() => setClock(Date.now()), 1000)
  }, [loading])

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
      setTitleExpanded(false)
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

  async function play(source: MissAVVideoSource) {
    if (!detail || openingSource) return
    setOpeningSource(source.url)
    try {
      const result = await chooseAndPresentMissAVPlayer(props.video, source, { detail, preparation: props.preparation, onDetailRefreshed: next => { setDetail(next); props.preparation?.releaseAsset() } })
      if (result.opened) props.onHistoryChanged()
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

  const primarySource = detail?.sources[0]
  const code = props.video.videoCode.toUpperCase()
  const title = detail?.title || props.video.title
  const coverUrl = detail?.coverUrl || props.video.coverUrl
  const secondaryMetadata = [detail?.releaseDate, detail?.duration || props.video.duration].filter(Boolean).join(" · ")
  function searchTag(tag: string) { setSelectedTag(tag); tagSearchPresented.setValue(true) }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background={DETAIL_CANVAS}>
    <DetailBackdrop coverUrl={coverUrl} />
    <ScrollView navigationTitle="详情" navigationBarTitleDisplayMode="inline" onAppear={appear} onDisappear={disappear} refreshable={load} navigationDestination={{ isPresented: tagSearchPresented, content: selectedTag ? <TagSearchPage tag={selectedTag} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
    <VStack frame={{ maxWidth: "infinity" }}>
    <VStack spacing={24} alignment="leading" frame={{ maxWidth: 760 }} padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
      <ZStack frame={{ maxWidth: "infinity", minHeight: 120 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}>
        {coverUrl ? <Image imageUrl={coverUrl} resizable aspectRatio={{ contentMode: "fit" }} frame={{ maxWidth: "infinity" }} /> : <Image systemName="photo" font="largeTitle" foregroundStyle="tertiaryLabel" />}
      </ZStack>

      <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" fontWeight="bold" foregroundStyle={ACCENT} frame={{ maxWidth: "infinity", alignment: "leading" }}>{code}</Text>
        <Text font="title3" fontWeight="bold" foregroundStyle="label" lineLimit={titleExpanded ? undefined : 3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{title}</Text>
        <Button title={titleExpanded ? "收起标题" : "展开标题"} action={() => setTitleExpanded(!titleExpanded)} buttonStyle="plain" foregroundStyle={ACCENT} font="subheadline" frame={{ minHeight: 44 }} accessibilityLabel={titleExpanded ? "收起作品完整标题" : "展开作品完整标题"} />
        {secondaryMetadata ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{secondaryMetadata}</Text> : undefined}
      </VStack>

      <VStack spacing={14} alignment="leading" frame={{ maxWidth: "infinity" }}>
        {primarySource ? <Button action={() => { void play(primarySource) }} disabled={Boolean(openingSource)} buttonStyle={glassButtonStyle(true)} buttonBorderShape="capsule" controlSize="large" tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: PRIMARY_ACTION_HEIGHT }} accessibilityLabel={openingSource === primarySource.url ? `正在打开 ${primarySource.label}` : `播放 ${primarySource.label}`}>
          <HStack spacing={8}>
            {openingSource === primarySource.url ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName="play.fill" />}
            <Text font="headline" fontWeight="bold">{openingSource === primarySource.url ? "正在打开" : `播放 ${primarySource.label}`}</Text>
          </HStack>
        </Button> : loading ? <StateView title="正在获取播放信息" loading presentation="row" /> : undefined}
        <FlowLayout spacing={10}>
          <Button action={() => setSubtitleSearchPresented(true)} disabled={subtitleSearchPresented} buttonStyle="plain" contentShape="capsule" accessibilityLabel={`按番号搜索字幕 ${code}`} navigationDestination={{
            isPresented: subtitleSearchPresented,
            onChanged: setSubtitleSearchPresented,
            content: subtitleSearchPresented ? <SubtitleSearchPage videoCode={code} onClose={() => setSubtitleSearchPresented(false)} onDownloaded={downloadedCode => {
              if (normalizeSubtitleAssociationCode(downloadedCode) !== normalizeSubtitleAssociationCode(code)) return
              setSubtitleAvailable(true)
              setSubtitleEnabled(true)
              void props.preparation?.refreshSubtitles()
            }} /> : <VStack />,
          }}><HStack spacing={7} padding={{ horizontal: 16, vertical: 8 }} frame={{ minHeight: 44 }} background={<DetailCapsuleSurface />}><Image systemName="magnifyingglass" foregroundStyle={ACCENT} /><Text font="subheadline" foregroundStyle="label">搜索字幕</Text></HStack></Button>
          {subtitleAvailable ? <Button action={toggleSubtitle} buttonStyle="plain" contentShape="capsule" accessibilityLabel={subtitleEnabled ? "关闭本作品字幕显示" : "开启本作品字幕显示"}><HStack spacing={7} padding={{ horizontal: 16, vertical: 8 }} frame={{ minHeight: 44 }} background={<DetailCapsuleSurface />}><Image systemName={subtitleEnabled ? "captions.bubble.fill" : "captions.bubble"} foregroundStyle={subtitleEnabled ? ACCENT : "secondaryLabel"} /><Text font="subheadline" foregroundStyle="label">{subtitleEnabled ? "关闭字幕" : "开启字幕"}</Text></HStack></Button> : undefined}
        </FlowLayout>
        {!subtitleAvailable ? <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">下载中文字幕，自动关联本作品。</Text> : undefined}
      </VStack>

      {loading && loadProgress ? <Text font="caption" foregroundStyle="secondaryLabel">{`${MISSAV_DETAIL_STAGE_LABELS[loadProgress.stage]} · ${(Math.max(loadProgress.elapsedMs, loadStartedAt === null ? loadProgress.elapsedMs : clock - loadStartedAt) / 1000).toFixed(1)} 秒`}</Text> : undefined}
      {detailError && !detail ? <StateView title="详情加载失败" description={detailError} kind="error" action={() => { void load() }} /> : undefined}
      {detailError && detail ? <StateView title="刷新失败" description="正在显示上次加载的详情。" kind="error" action={() => { void load() }} presentation="row" /> : undefined}

      {detail && detail.sources.length > 1 ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity" }}><Text font="subheadline" foregroundStyle="secondaryLabel">其他清晰度</Text><FlowLayout spacing={8}>{detail.sources.slice(1).map(source => <SourceRow key={`${source.label}-${source.url}`} source={source} openingSource={openingSource} action={() => { void play(source) }} />)}</FlowLayout></VStack> : !loading && detail && !detail.sources.length ? <StateView title="暂无可用播放源" description="请下拉刷新后重试。" kind="empty" systemImage="play.slash" action={() => { void load() }} actionTitle="重新加载" /> : undefined}

      {detail && (detail.maker || detail.actress || detail.genres.length > 0) ? <VStack spacing={16} alignment="leading" padding={18} frame={{ maxWidth: "infinity", alignment: "leading" }} background={<DetailCardSurface />}>
        <Text font="headline" fontWeight="semibold" foregroundStyle="label">作品资料</Text>
        {detail.maker ? <DetailInfoRow title="制作商" value={detail.maker} /> : undefined}
        {detail.actress ? <DetailInfoRow title="出演" value={detail.actress} /> : undefined}
        {detail.genres.length ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="subheadline" foregroundStyle="secondaryLabel">分类 · 点击查看相关作品</Text><FlowLayout spacing={8}>{detail.genres.map(genre => <TagButton key={genre} title={genre} action={() => searchTag(genre)} />)}</FlowLayout></VStack> : undefined}
      </VStack> : undefined}

      {detailTrace.current || loading || detailError ? <Button title={loading ? "复制当前诊断" : detailError ? "复制失败诊断" : "复制完整诊断"} systemImage="doc.on.doc" buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44 }} action={() => { void copyLoadDiagnostics() }} /> : undefined}
    </VStack>
    </VStack>
  </ScrollView></ZStack>
}


function normalizeSubtitleAssociationCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "")
}

function TagButton(props: { title: string; action: () => void }) {
  return <Button action={props.action} buttonStyle="plain" contentShape="capsule" accessibilityLabel={`搜索标签 ${props.title}`}><HStack spacing={5} padding={{ horizontal: 12, vertical: 8 }} frame={{ minHeight: 44 }} background={<DetailCapsuleSurface />}><Text font="footnote" foregroundStyle="label" multilineTextAlignment="leading">{props.title}</Text></HStack></Button>
}

function DetailCapsuleSurface() {
  return <Capsule fill={DETAIL_SURFACE} stroke={{ shapeStyle: DETAIL_RIM, strokeStyle: { lineWidth: 1 } }} />
}

function DetailBackdrop(props: { coverUrl: string }) {
  return <GeometryReader ignoresSafeArea={true}>{geometry => <ZStack frame={{ width: geometry.size.width, height: geometry.size.height }} background={DETAIL_CANVAS} clipped>
    {props.coverUrl ? <Image imageUrl={props.coverUrl} resizable aspectRatio={{ contentMode: "fill" }} frame={{ width: geometry.size.width, height: geometry.size.height }} clipped blur={36} /> : undefined}
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background={DETAIL_BACKGROUND} />
  </ZStack>}</GeometryReader>
}

function DetailCardSurface() {
  return <RoundedRectangle cornerRadius={24} fill={DETAIL_SURFACE} stroke={{ shapeStyle: DETAIL_RIM, strokeStyle: { lineWidth: 1 } }} />
}

function DetailInfoRow(props: { title: string; value: string }) {
  return <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ width: 64, alignment: "leading" }}>{props.title}</Text><Text font="subheadline" foregroundStyle="label" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.value}</Text></HStack>
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
  const listingRequest = useRef(new MissAVListingRequest())
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  async function load(nextPage = 1) {
    setLoading(true); setError(null)
    await listingRequest.current.load({ query: props.tag, page: nextPage, sort: "released_at", filter: "" }, {}, {
      loaded: result => { setItems(result.items); setPage(result.page); setHasNext(result.hasNext); setResultsRevision(value => value + 1) },
      failed: reason => setError(reason instanceof Error ? reason.message : String(reason)),
      settled: () => setLoading(false),
    })
  }
  useEffect(() => { void load(1) }, [props.tag])
  useEffect(() => () => listingRequest.current.cancel(), [props.tag])
  useEffect(() => { if (resultsRevision) scrollProxy.current?.scrollTo("tag-results-top", "top") }, [resultsRevision])
  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle={props.tag} navigationBarTitleDisplayMode="inline" refreshable={() => load(page)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack key="tag-results-top" spacing={24} alignment="leading" frame={{ maxWidth: READING_MAX_WIDTH }} padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        {loading && !items.length ? <StateView title="正在搜索标签" loading presentation="section" /> : error && !items.length ? <StateView title="标签搜索失败" description={error} kind="error" action={() => { void load(page) }} /> : !items.length ? <StateView title="暂无相关作品" description="未找到带有此标签的作品。" systemImage="tag.slash" /> : <VideoRowList items={items} status={() => `标签 · ${props.tag}`} statusSystemImage="tag" onOpen={open} />}
        {error && items.length ? <StateView title="刷新失败" description="正在显示上次成功的结果。" kind="error" action={() => { void load(page) }} presentation="row" /> : undefined}
        {items.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44 }} action={() => { void load(page - 1) }} />
          <Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text>
          <Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} buttonStyle={glassButtonStyle(true)} buttonBorderShape="capsule" controlSize="small" frame={{ minHeight: 44 }} action={() => { void load(page + 1) }} />
        </HStack> : undefined}
      </VStack>
    </ScrollView>}}</ScrollViewReader>
  </ZStack>
}

function SourceRow(props: { source: MissAVVideoSource; openingSource: string | null; action: () => void }) {
  const opening = props.openingSource === props.source.url
  return <Button action={props.action} disabled={Boolean(props.openingSource)} buttonStyle="plain" contentShape="capsule" accessibilityLabel={opening ? `正在打开 ${props.source.label}` : props.openingSource ? `${props.source.label}，正在打开其他清晰度` : `播放 ${props.source.label}`}><HStack spacing={7} padding={{ horizontal: 16, vertical: 8 }} frame={{ minHeight: 44 }} background={<DetailCapsuleSurface />}>{opening ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : <Image systemName="play.fill" font="caption" foregroundStyle={ACCENT} />}<Text font="subheadline" foregroundStyle="label">{opening ? `正在打开 ${props.source.label}` : props.source.label}</Text></HStack></Button>
}
