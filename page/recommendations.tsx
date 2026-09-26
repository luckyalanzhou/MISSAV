import { ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { loadLocalRecommendations, type MissAVRecommendation } from "../recommendation"
import type { MissAVVideoItem } from "../client"
import { PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground } from "../design"
import { DetailPage } from "./detail"
import { StateView } from "./components/state_view"
import { VideoRowList } from "./components/video_row"

export function RecommendationsPage(props: { revision: number; onFavouriteChanged: () => void; onHistoryChanged: () => void; onDiscover: () => void }) {
  const [items, setItems] = useState<MissAVRecommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
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
  function open(video: MissAVVideoItem) { setSelected(video); detailPresented.setValue(true) }
  const reasons = new Map(items.map(item => [item.video.videoCode, item.reason]))

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="为你推荐" navigationBarTitleDisplayMode="large" refreshable={() => load(true)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}><VStack spacing={16} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
    <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">推荐内容根据保存在本机的收藏、浏览记录和播放记录生成；相关记录不会上传。</Text>
    {loading && items.length === 0 ? <StateView title="正在准备推荐" description="正在根据你的收藏和观看记录生成推荐。" loading /> : items.length === 0 && error ? <StateView title="暂时无法加载推荐" description={error} kind="error" action={() => { void load(true) }} /> : items.length === 0 ? <StateView title="暂无足够数据生成推荐" description="浏览、收藏或播放部分作品后，推荐内容将显示在这里。" systemImage="sparkles" action={props.onDiscover} actionTitle="前往浏览" /> : <VideoRowList items={items.map(item => item.video)} status={video => reasons.get(video.videoCode)} statusSystemImage="sparkles" onOpen={open} />}
    {error && items.length ? <StateView title="暂时无法更新" description="正在显示上次的推荐内容。" kind="error" action={() => { void load(true) }} actionTitle="重试" presentation="row" /> : undefined}
  </VStack></ScrollView></ZStack>
}
