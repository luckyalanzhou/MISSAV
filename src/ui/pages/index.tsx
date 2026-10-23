import { Button, HStack, Image, NavigationStack, Script, Tab, TabView, Text, Toolbar, ToolbarItem, VStack, useObservable } from "scripting"
import { MediaHomePage } from "./home"
import { DiscoverPage } from "./discover"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"
import { ACCENT, PAGE_CANVAS } from "../design"

export function HomePage(props: { onClose: () => void }) {
  const selection = useObservable<number>(0)
  const historyRevision = useObservable(0)
  const domainRevision = useObservable(0)
  const accessRevision = useObservable(0)
  const settingsPresented = useObservable(false)
  const bumpHistory = () => historyRevision.setValue(historyRevision.value + 1)
  const bumpDomain = () => domainRevision.setValue(domainRevision.value + 1)
  const bumpAccess = () => accessRevision.setValue(accessRevision.value + 1)
  const supportsMinimization = Script.supportsMinimization()
  const toolbar = <Toolbar>
    <ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible">
      <Button action={props.onClose} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭并结束 MISSAV 脚本"><Image systemName="xmark" font="headline" foregroundStyle="label" /></Button>
    </ToolbarItem>
    <ToolbarItem placement="principal"><Text font="headline" fontWeight="semibold">{["首页", "浏览", "资料库", "搜索"][selection.value] || "MISSAV"}</Text></ToolbarItem>
    <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => settingsPresented.setValue(true)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" navigationDestination={{ isPresented: settingsPresented, content: <SettingsPage onDomainChanged={bumpDomain} onAccessVerified={bumpAccess} /> }} accessibilityLabel="设置"><Image systemName="gearshape" font="headline" foregroundStyle="label" /></Button>
    </ToolbarItem>
    {supportsMinimization ? <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => { if (!Script.isMinimized()) Script.minimize().catch(() => {}) }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="最小化浏览器"><Image systemName="arrow.down.right.and.arrow.up.left" font="headline" foregroundStyle="label" /></Button>
    </ToolbarItem> : null}
  </Toolbar>
  const localRevision = historyRevision.value
  return <NavigationStack toolbar={toolbar}>
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background={PAGE_CANVAS}>
    <TabView selection={selection} tint={ACCENT} tabViewStyle="sidebarAdaptable" tabBarVisibility="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Tab title="首页" systemImage="house" value={0}><MediaHomePage key={`home-${domainRevision.value}`} accessRevision={accessRevision.value} revision={localRevision} onHistoryChanged={bumpHistory} onDiscover={() => selection.setValue(1)} /></Tab>
      <Tab title="浏览" systemImage="square.grid.2x2" value={1}><DiscoverPage key={`discover-${domainRevision.value}`} accessRevision={accessRevision.value} onHistoryChanged={bumpHistory} /></Tab>
      <Tab title="资料库" systemImage="play.square.stack" value={2}><LibraryPage historyRevision={historyRevision.value} onHistoryChanged={bumpHistory} onDiscover={() => selection.setValue(1)} /></Tab>
      <Tab title="搜索" systemImage="magnifyingglass" role="search" value={3}><SearchPage key={`search-${domainRevision.value}`} onHistoryChanged={bumpHistory} /></Tab>
    </TabView>
    <HStack spacing={0} frame={{ maxWidth: "infinity", minHeight: 60 }} background={PAGE_CANVAS}>
      {[
        { title: "首页", image: "house", value: 0 },
        { title: "浏览", image: "square.grid.2x2", value: 1 },
        { title: "资料库", image: "play.square.stack", value: 2 },
        { title: "搜索", image: "magnifyingglass", value: 3 },
      ].map(item => {
        const active = selection.value === item.value
        const color = active ? ACCENT : "secondaryLabel"
        return <Button key={item.value} action={() => selection.setValue(item.value)} buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: 60 }} contentShape="rect" accessibilityLabel={item.title}>
          <VStack spacing={3} alignment="center" frame={{ maxWidth: "infinity", minHeight: 60 }}>
            <Image systemName={item.image} font="body" foregroundStyle={color} />
            <Text font="caption2" fontWeight={active ? "semibold" : "regular"} foregroundStyle={color}>{item.title}</Text>
          </VStack>
        </Button>
      })}
    </HStack>
    </VStack>
  </NavigationStack>
}
