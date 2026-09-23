import { Button, Image, Navigation, NavigationStack, Script, Tab, TabView, Text, Toolbar, ToolbarItem, useObservable, useState } from "scripting"
import { isMissAVAccessReady } from "../access"
import { MediaHomePage } from "./home"
import { DiscoverPage } from "./discover"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"
import { AccessGate } from "./access_gate"

export function HomePage() {
  const [accessReady, setAccessReady] = useState(() => isMissAVAccessReady())
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)
  const favouritesRevision = useObservable(0)
  const historyRevision = useObservable(0)
  const domainRevision = useObservable(0)
  const accountRevision = useObservable(0)
  const settingsPresented = useObservable(false)
  const bumpFavourites = () => favouritesRevision.setValue(favouritesRevision.value + 1)
  const bumpHistory = () => historyRevision.setValue(historyRevision.value + 1)
  const bumpDomain = () => domainRevision.setValue(domainRevision.value + 1)
  const bumpAccount = () => accountRevision.setValue(accountRevision.value + 1)
  const supportsMinimization = Script.supportsMinimization()
  const toolbar = <Toolbar>
    <ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible">
      <Button action={() => dismiss()} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭 MISSAV 浏览器"><Image systemName="xmark" font="headline" foregroundStyle="label" /></Button>
    </ToolbarItem>
    <ToolbarItem placement="principal"><Text font="headline" fontWeight="semibold">{["首页", "浏览", "资料库", "搜索"][selection.value] || "MISSAV"}</Text></ToolbarItem>
    <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => settingsPresented.setValue(true)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" navigationDestination={{ isPresented: settingsPresented, content: <SettingsPage onDomainChanged={bumpDomain} onAccountChanged={bumpAccount} /> }} accessibilityLabel="设置"><Image systemName="gearshape" font="headline" foregroundStyle="label" /></Button>
    </ToolbarItem>
    {supportsMinimization ? <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => { if (!Script.isMinimized()) Script.minimize().catch(() => {}) }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="最小化浏览器"><Image systemName="arrow.down.right.and.arrow.up.left" font="headline" foregroundStyle="label" /></Button>
    </ToolbarItem> : null}
  </Toolbar>
  const localRevision = favouritesRevision.value + historyRevision.value
  if (!accessReady) return <AccessGate onReady={() => setAccessReady(true)} onClose={() => dismiss()} />
  return <NavigationStack>
    <TabView selection={selection} tint="systemPink" tabViewStyle="sidebarAdaptable" tabBarMinimizeBehavior="onScrollDown" toolbar={toolbar}>
      <Tab title="首页" systemImage="house" value={0}><MediaHomePage key={`home-${domainRevision.value}`} revision={localRevision} onFavouriteChanged={bumpFavourites} onHistoryChanged={bumpHistory} onDiscover={() => selection.setValue(1)} onLibrary={() => selection.setValue(2)} /></Tab>
      <Tab title="浏览" systemImage="square.grid.2x2" value={1}><DiscoverPage key={`discover-${domainRevision.value}`} onFavouriteChanged={bumpFavourites} onHistoryChanged={bumpHistory} /></Tab>
      <Tab title="资料库" systemImage="play.square.stack" value={2}><LibraryPage favouritesRevision={favouritesRevision.value} historyRevision={historyRevision.value} accountRevision={accountRevision.value} onFavouriteChanged={bumpFavourites} onHistoryChanged={bumpHistory} onDiscover={() => selection.setValue(1)} /></Tab>
      <Tab title="搜索" systemImage="magnifyingglass" role="search" value={3}><SearchPage key={`search-${domainRevision.value}`} onFavouriteChanged={bumpFavourites} onHistoryChanged={bumpHistory} /></Tab>
    </TabView>
  </NavigationStack>
}
