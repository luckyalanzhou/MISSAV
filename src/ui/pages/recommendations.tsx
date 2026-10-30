import { HStack, LazyVGrid, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { loadLocalRecommendations, type MissAVRecommendation } from "../../features/recommendations/recommendation"
import type { MissAVVideoItem } from "../../site/client"
import { CONTENT_MAX_WIDTH, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground } from "../design"
import { DetailPage } from "./detail"
import { useDetailNavigation } from "./detail-navigation"
import { StateView } from "../components/state_view"
import { MediaGridCard } from "../components/media_cards"

export function RecommendationsPage(props: { revision: number; onHistoryChanged: () => void; onDiscover: () => void }) {
  const [items, setItems] = useState<MissAVRecommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented
  const recommendationGeneration = useRef(0)

  async function load(forceRefresh = false) {
    const generation = ++recommendationGeneration.current
    setLoading(true)
    setError(null)
    try {
      const next = await loadLocalRecommendations(20, forceRefresh)
      if (generation === recommendationGeneration.current) setItems(next)
    } catch (reason) {
      if (generation === recommendationGeneration.current) setError(reason instanceof Error ? reason.message : "暂时无法更新推荐，请稍后重试。")
    } finally {
      if (generation === recommendationGeneration.current) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [props.revision])
  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  const reasons = new Map(items.map(item => [item.video.videoCode, item.reason]))

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel}><PageBackground /><ScrollView navigationTitle="为你推荐" navigationBarTitleDisplayMode="inline" toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }} refreshable={() => load(true)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}><VStack spacing={16} alignment="leading" frame={{ maxWidth: CONTENT_MAX_WIDTH }} padding={{ top: 0, bottom: PAGE_BOTTOM_PADDING }}>
    {loading && items.length === 0 ? <StateView title="正在准备推荐" description="正在根据你的浏览记录和播放记录生成推荐。" loading presentation="section" /> : items.length === 0 && error ? <StateView title="暂时无法加载推荐" description={error} kind="error" action={() => { void load(true) }} presentation="section" /> : items.length === 0 ? <StateView title="暂无足够数据生成推荐" description="浏览或播放部分作品后，推荐内容将显示在这里。" systemImage="sparkles" action={props.onDiscover} actionTitle="前往浏览" presentation="section" /> : <>
      <HStack spacing={8} padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", minHeight: 32 }}>
        <Image systemName="sparkles" foregroundStyle="secondaryLabel" />
        <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>结合本机偏好、近期热门与新作</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">{`${items.length} 部`}</Text>
        {loading ? <ProgressView progressViewStyle="circular" /> : undefined}
      </HStack>
      <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 220 }, spacing: 14 }]} spacing={16} padding={{ horizontal: PAGE_PADDING }}>{items.map(item => <MediaGridCard key={item.video.videoCode} video={item.video} status={reasons.get(item.video.videoCode)} statusSystemImage="sparkles" responsiveArtwork onOpen={open} />)}</LazyVGrid>
    </>}
    {error && items.length ? <StateView title="暂时无法更新" description="正在显示上次的推荐内容。" kind="error" action={() => { void load(true) }} actionTitle="重试" presentation="row" /> : undefined}
  </VStack></ScrollView></ZStack>
}
