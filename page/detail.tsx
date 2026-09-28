import { Button, Divider, EnvironmentValuesReader, HStack, Image, ProgressView, ScrollView, ScrollViewReader, Text, VStack, ZStack, useEffect, useObservable, useRef, useState, type DynamicTypeSize, type ScrollViewProxy } from "scripting"
import { missavClient, type MissAVVideoDetail, type MissAVVideoItem, type MissAVVideoSource } from "../client"
import { ACCENT, Badge, MEDIA_HERO_RADIUS, PAGE_BOTTOM_PADDING, PAGE_PADDING, PRIMARY_ACTION_HEIGHT, PageBackground, SECONDARY_ACTION_HEIGHT, SECTION_SPACING, SectionHeading } from "../design"
import { chooseAndPresentMissAVPlayer } from "../player"
import { getMissAVAccountSnapshot, getMissAVWebsiteSavedState, setMissAVWebsiteSaved } from "../account"
import { isMissAVFavourite, rememberMissAVDetail, toggleMissAVFavourite } from "../storage"
import { MediaArtwork } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { VideoRowList } from "./components/video_row"

export function DetailPage(props: { video: MissAVVideoItem; onFavouriteChanged: () => void; onHistoryChanged: () => void }) {
  const [detail, setDetail] = useState<MissAVVideoDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingSource, setOpeningSource] = useState<string | null>(null)
  const [favourite, setFavourite] = useState<boolean | null>(null)
  const [favouriteError, setFavouriteError] = useState<string | null>(null)
  const [websiteSaved, setWebsiteSaved] = useState<boolean | null>(null)
  const [websiteSavedError, setWebsiteSavedError] = useState<string | null>(null)
  const [changingFavourite, setChangingFavourite] = useState<"local" | "website" | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagSearchPresented = useObservable(false)
  const generation = useRef(0)
  const favouriteGeneration = useRef(0)

  async function load() {
    const current = ++generation.current
    setLoading(true); setDetailError(null)
    try {
      const next = await missavClient.getVideo(props.video)
      if (current !== generation.current) return
      setDetail(next)
      try { await rememberMissAVDetail(props.video, next); if (current === generation.current) props.onHistoryChanged() }
      catch (reason) { console.error("保存浏览记录失败:", reason) }
    } catch (reason) {
      if (current === generation.current) setDetailError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (current === generation.current) setLoading(false) }
  }

  useEffect(() => {
    setDetail(null); setOpeningSource(null); void load()
    const current = ++favouriteGeneration.current
    setFavourite(null)
    setFavouriteError(null)
    void isMissAVFavourite(props.video.videoCode).then(value => { if (current === favouriteGeneration.current) setFavourite(value) }).catch(() => { if (current === favouriteGeneration.current) setFavouriteError("本机收藏状态读取失败。") })
    setWebsiteSaved(null)
    const account = getMissAVAccountSnapshot()
    if (account.state !== "signedIn") {
      setWebsiteSavedError(account.state === "expired" ? "网站账号已失效，请在设置中重新登录。" : "登录网站账号后，即可使用网站收藏。")
    } else {
      setWebsiteSavedError(null)
      void getMissAVWebsiteSavedState(props.video.detailPath).then(value => { if (current === favouriteGeneration.current) setWebsiteSaved(value.saved) }).catch(reason => { if (current === favouriteGeneration.current) setWebsiteSavedError(reason instanceof Error ? reason.message : "网站收藏状态读取失败。") })
    }
  }, [props.video.videoCode])

  async function play(source: MissAVVideoSource) {
    if (!detail || openingSource) return
    setOpeningSource(source.url)
    try { const result = await chooseAndPresentMissAVPlayer(props.video, source); if (result.opened) props.onHistoryChanged() }
    catch (reason) { await Dialog.alert({ title: "播放失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setOpeningSource(null) }
  }

  async function changeFavourite() {
    if (changingFavourite || favourite === null) return
    setChangingFavourite("local")
    try { const next = await toggleMissAVFavourite(props.video); setFavourite(next); props.onFavouriteChanged() }
    catch (reason) { await Dialog.alert({ title: "本机收藏操作失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setChangingFavourite(null) }
  }

  async function changeWebsiteSaved() {
    if (changingFavourite || websiteSaved === null) return
    setChangingFavourite("website")
    try { const result = await setMissAVWebsiteSaved(props.video.detailPath, !websiteSaved); setWebsiteSaved(result.saved); props.onFavouriteChanged() }
    catch (reason) { await Dialog.alert({ title: "网站收藏操作失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setChangingFavourite(null) }
  }

  const resolved = detail ?? { ...props.video, videoCode: props.video.videoCode, genres: [], sources: [] }
  const primarySource = detail?.sources[0]
  const code = props.video.videoCode.toUpperCase()
  const secondaryMetadata = [detail?.releaseDate, detail?.duration || props.video.duration, detail?.maker].filter(Boolean).join(" · ")
  function searchTag(tag: string) { setSelectedTag(tag); tagSearchPresented.setValue(true) }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="详情" navigationBarTitleDisplayMode="inline" refreshable={load} navigationDestination={{ isPresented: tagSearchPresented, content: selectedTag ? <TagSearchPage tag={selectedTag} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
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
        <EnvironmentValuesReader keys={["horizontalSizeClass", "dynamicTypeSize"]}>{environment => {
          const vertical = environment.horizontalSizeClass === "compact" || isAccessibilityTypeSize(environment.dynamicTypeSize)
          const local = <FavouriteButton kind="local" value={favourite} error={favouriteError} changing={changingFavourite} action={() => { void changeFavourite() }} />
          const website = <FavouriteButton kind="website" value={websiteSaved} error={websiteSavedError} changing={changingFavourite} action={() => { void changeWebsiteSaved() }} />
          return vertical ? <VStack spacing={10} frame={{ maxWidth: "infinity" }}>{local}{website}</VStack> : <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>{local}{website}</HStack>
        }}</EnvironmentValuesReader>
        {favouriteError ? <Text font="caption" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{`本机收藏：${favouriteError}`}</Text> : undefined}
        {websiteSavedError ? <Text font="caption" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{`网站收藏：${websiteSavedError}`}</Text> : undefined}
        {!favouriteError && !websiteSavedError ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{websiteSaved === null ? "正在读取收藏状态。" : "网站收藏将同步至当前网站账号；本机收藏仅保存在此设备。"}</Text> : undefined}
      </VStack>

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

function isAccessibilityTypeSize(size: DynamicTypeSize) {
  return size.startsWith("accessibility")
}

function FavouriteButton(props: { kind: "local" | "website"; value: boolean | null; error: string | null; changing: "local" | "website" | null; action: () => void }) {
  const local = props.kind === "local"
  const noun = local ? "本机收藏" : "网站收藏"
  const icon = local ? (props.value ? "heart.fill" : "heart") : (props.value ? "bookmark.fill" : "bookmark")
  const title = props.error ? `${noun}不可用` : props.value === null ? `正在读取${noun}` : props.value ? `已加入${noun}` : `加入${noun}`
  const accessibility = props.error ? `${noun}不可用` : props.value === null ? `正在读取${noun}状态` : props.value ? `已加入${noun}，轻点取消` : `未加入${noun}，轻点加入`
  return <Button action={props.action} disabled={Boolean(props.changing) || props.value === null || Boolean(props.error)} buttonStyle="bordered" tint={props.value ? "systemRed" : ACCENT} frame={{ maxWidth: "infinity", minHeight: SECONDARY_ACTION_HEIGHT }} accessibilityLabel={accessibility}>
    <HStack spacing={7}>{props.changing === props.kind ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : <Image systemName={icon} />}<Text font="subheadline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="center">{title}</Text></HStack>
  </Button>
}

function TagButton(props: { title: string; action: () => void }) {
  return <Button action={props.action} buttonStyle="plain" frame={{ minHeight: 44 }} contentShape="rect" accessibilityLabel={`搜索标签 ${props.title}`}><HStack spacing={5} padding={{ horizontal: 10, vertical: 7 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 9, style: "continuous" }}><Image systemName="magnifyingglass" font="caption2" foregroundStyle={ACCENT} /><Text font="caption" fontWeight="semibold" lineLimit={1}>{props.title}</Text></HStack></Button>
}

function TagSearchPage(props: { tag: string; onFavouriteChanged: () => void; onHistoryChanged: () => void }) {
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultsRevision, setResultsRevision] = useState(0)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
  const generation = useRef(0)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  async function load(nextPage = 1) {
    const current = ++generation.current
    setLoading(true); setError(null)
    try { const result = await missavClient.searchVideoPage({ query: props.tag, page: nextPage, sort: "released_at", filter: "" }); if (current !== generation.current) return; setItems(result.items); setPage(result.page); setHasNext(result.hasNext); setResultsRevision(value => value + 1) }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setLoading(false) }
  }
  useEffect(() => { void load(1) }, [props.tag])
  useEffect(() => { if (resultsRevision) scrollProxy.current?.scrollTo("tag-results-top", "top") }, [resultsRevision])
  function open(video: MissAVVideoItem) { setSelected(video); detailPresented.setValue(true) }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle={props.tag} navigationBarTitleDisplayMode="inline" refreshable={() => load(page)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}><VStack key="tag-results-top" spacing={18} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}><VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><HStack spacing={7}><Image systemName="tag.fill" foregroundStyle={ACCENT} /><Text font="title2" fontWeight="bold">{props.tag}</Text></HStack><Text font="footnote" foregroundStyle="secondaryLabel">{`相关作品 · 第 ${page} 页 · ${items.length} 个结果`}</Text></VStack>{loading && !items.length ? <StateView title="正在搜索标签" loading presentation="section" /> : error && !items.length ? <StateView title="标签搜索失败" description={error} kind="error" action={() => { void load(page) }} /> : !items.length ? <StateView title="暂无相关作品" description="未找到带有此标签的作品。" systemImage="tag.slash" /> : <VideoRowList items={items} status={() => `标签 · ${props.tag}`} statusSystemImage="tag" onOpen={open} />}{error && items.length ? <StateView title="刷新失败" description="正在显示上次成功的结果。" kind="error" action={() => { void load(page) }} presentation="row" /> : undefined}{items.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}><Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} action={() => { void load(page - 1) }} /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text><Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} action={() => { void load(page + 1) }} /></HStack> : undefined}</VStack></ScrollView>}}</ScrollViewReader></ZStack>
}

function SourceRow(props: { source: MissAVVideoSource; openingSource: string | null; action: () => void }) {
  const opening = props.openingSource === props.source.url
  return <Button action={props.action} disabled={Boolean(props.openingSource)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={opening ? `正在打开 ${props.source.label}` : props.openingSource ? `${props.source.label}，正在打开其他清晰度` : `播放 ${props.source.label}`}><HStack spacing={12} padding={{ vertical: 10 }} frame={{ maxWidth: "infinity", minHeight: 58 }}>{opening ? <ProgressView progressViewStyle="circular" tint={ACCENT} frame={{ width: 30 }} /> : <Image systemName="play.circle" font="title2" foregroundStyle={ACCENT} frame={{ width: 30 }} />}<VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">{opening ? "正在打开" : props.source.label}</Text><Text font="caption" foregroundStyle="secondaryLabel">使用系统播放器</Text></VStack><Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" /></HStack></Button>
}
