# MISSAV 项目架构说明

本文根据当前仓库源码整理，说明项目如何分层、各模块包含什么，以及页面、网络、播放、字幕和本地数据之间如何协作。它描述的是代码结构，不代表网站访问、Cloudflare 验证或真实 iPhone 播放体验始终可用。

## 1. 项目概况

- **运行环境**：iOS/iPadOS 上的 Scripting 应用，使用其原生 UI、网络、WebView、SQLite、文件和 AVPlayer 能力。
- **语言与文件**：以 TypeScript / TSX 编写；页面和播放器 UI 使用 TSX，其余业务逻辑以 TypeScript 模块组织。
- **应用入口**：`script.json` 将 `index.tsx` 配置为完整脚本入口。
- **另一种首页入口**：`home_screen_default_ui.tsx` 是供 Scripting Home Tab 使用的首页实现，不是 `script.json` 当前配置的入口。
- **主要职责**：浏览与搜索站点栏目、解析作品详情与播放源、使用系统播放器、按番号查找并关联简体/繁体字幕，以及保存本机浏览/播放状态。

## 2. 整体分层

```text
Scripting 宿主
├─ 入口与生命周期：index.tsx / runtime.ts / lifecycle.ts
├─ 页面与组件：page/* / home_screen_default_ui.tsx / design.tsx
├─ 站点访问：client.ts / domain.ts / webview.ts / site-verification.ts
│  ├─ 页面解析：html-parser.ts / listing-dom.ts / collections.ts
│  └─ 会话与请求控制：cloudflare-session.ts / request-scope.ts / request-deadline.ts
├─ 作品详情与播放：page/detail* / playback-*.ts / player.tsx / native-player.tsx
├─ 字幕：subtitlecat.ts / subtitlecat-webview.ts / subtitle-search-*.ts / subtitles.ts
├─ 本机数据：database.ts / storage.ts / listing-cache*.ts / subtitle-search-cache*.ts
└─ 辅助能力：recommendation.ts / access-diagnostics.ts / background-data.ts
```

这些分层不是独立应用：页面调用业务模块，业务模块依赖 Scripting API 和客户端；数据模块由运行时初始化后供页面与功能模块共享。

## 3. 启动与运行时

| 文件 | 主要内容与职责 |
| --- | --- |
| `script.json` | Scripting 项目元信息、版本、图标、脚本入口（`index.tsx`）。 |
| `index.tsx` | 启动完整脚本页面；初始化运行时和生命周期监听；负责关闭时清理监听并结束脚本实例。 |
| `runtime.ts` | 一次性安装栏目缓存、字幕搜索缓存和本地数据库；清理旧账号数据；预热数据库。 |
| `lifecycle.ts` | 汇总脚本最小化与恢复事件，供需要关注生命周期的模块订阅；退出时可解除监听。 |
| `home_screen_default_ui.tsx` | 给 Scripting Home Tab 使用的替代首页入口，复用共享数据、详情导航、浏览、搜索、资料库与设置页面。 |

完整脚本入口和 Home Tab 入口共用业务模块与本机数据库初始化逻辑，但 UI 入口和宿主展示方式不同。

## 4. 页面与导航

| 部分 | 主要文件 | 组成及职责 |
| --- | --- | --- |
| 主页面容器 | `page/index.tsx` | 原生 Tab 与导航容器，组织首页、浏览、资料库、搜索和设置；同步域名、访问状态及历史变化。 |
| 首页 | `page/home.tsx`、`home-screen-data.ts` | 继续观看、最近更新、热门/推荐等首页区块；合并本地历史和远端栏目数据。 |
| Home Tab 首页 | `home_screen_default_ui.tsx` | 独立的 Home Tab UI；使用本地优先的首页加载器与相同的详情导航/页面模块。 |
| 浏览 | `page/discover.tsx`、`collections.ts` | 栏目分组、子栏目、分类目录、筛选、排序、分页及作品网格。 |
| 搜索 | `page/search.tsx` | 站内番号/作品搜索，并通过共享详情导航打开作品。 |
| 资料库 | `page/library.tsx` | 本机浏览记录、播放历史、继续观看进度及相关管理操作。 |
| 设置 | `page/settings.tsx` | 站点域名、Safari 打开站点、线路验证、播放/本机数据选项等设置入口。 |
| 推荐 | `page/recommendations.tsx`、`recommendation.ts` | 基于本地浏览与播放偏好生成本机推荐，不等同于站点官方推荐。 |
| 作品详情 | `page/detail.tsx` | 展示封面、番号、标题、时长、演员/分类等资料；提供播放、字幕搜索及字幕开关。 |
| 共享子组件 | `page/components/*`、`design.tsx` | 作品卡片、字幕文件行、空/错误状态、按钮/间距/主题等视觉规范。 |
| 详情导航与准备状态 | `page/detail-navigation.tsx` | 统一处理点击作品、请求取消、加载进度、详情准备和页面跳转；当前设计是在有可用播放源后进入详情。 |

### 主要页面流

1. 首页、浏览或搜索产生统一的 `MissAVVideoItem` 作品记录。
2. 点击作品后，`useDetailNavigation` 创建本次请求范围并调用 `missavClient.getVideo`。
3. 客户端加载/解析详情，返回可用播放源；若请求已取消或结果过期，不再更新当前页面。
4. `MissAVPlaybackPreparation` 预备首选媒体资源，并读取可选的续播进度和已启用字幕。
5. 详情页展示分辨率/播放入口；选择播放源后交给播放器模块。

## 5. 站点访问、栏目与解析

| 文件 | 主要内容与职责 |
| --- | --- |
| `domain.ts` | 可用站点域名、当前域名读取/保存、中文站点路径与 URL 规范化。 |
| `collections.ts` | 站点栏目、栏目分组、排序/筛选类型及目录类栏目定义。 |
| `client.ts` | 站点访问主客户端；发起栏目/搜索/详情请求，管理内存缓存、请求合并、取消、超时、验证页判定和播放请求头。 |
| `webview.ts` | 在持久 WebView 中导航并读取匹配页面文档；提供页面加载、文档就绪和读取超时处理。 |
| `cloudflare-session.ts` | 读取、恢复和保存允许范围内的 Cloudflare 会话 Cookie，并处理过期、域名范围和恢复超时。 |
| `site-verification.ts` | 打开验证访问线路页面、等待用户在页面中完成挑战、检查目标栏目内容并同步会话状态。 |
| `html-parser.ts` | 从站点 HTML 中解析栏目列表、作品、目录分类、详情元数据和播放源；也识别验证/拦截页面。 |
| `listing-dom.ts` | 现有 WebView 页面精简 DOM 提取试验及其结果一致性选择；生产试验开关默认状态需以源码运行时配置为准。 |
| `listing-cache.ts`、`listing-cache-db.ts` | 栏目页缓存策略与 SQLite 后端。 |
| `request-scope.ts`、`request-deadline.ts` | 请求所有权/取消传播和通用时限控制。 |
| `access-diagnostics.ts`、`detail-loading.ts` | 记录脱敏访问状态和详情加载各阶段耗时，生成可复制诊断信息。 |

请求的大致链路是：页面 → `client.ts` → 选择网络/WebView 页面读取方式 → `html-parser.ts` 或 DOM 提取 → 返回统一类型给页面。Cloudflare 会话恢复与线路验证是访问链路的一部分，但能否访问仍受站点挑战、域名、网络和会话状态影响。

## 6. 播放与续播

| 文件 | 主要内容与职责 |
| --- | --- |
| `playback-preparation.ts` | 为单个作品准备媒体 `AVAsset`、读取播放进度和可选字幕；可取消并释放媒体资源。 |
| `playback-source.ts` | 播放源选择/刷新和播放源有效性相关逻辑。 |
| `playback-startup.ts` | 系统播放器启动与启动状态处理。 |
| `playback-polling.ts` | 对需要采样的播放状态/时间执行受控轮询，并支持清理。 |
| `playback-progress.ts` | 续播位置、时长和显示文案的计算。 |
| `playback-writer.ts` | 合并/节制播放进度写入，避免高频持久化。 |
| `player.tsx` | 选择播放器路径，整合原生播放入口、准备数据和播放记录。 |
| `native-player.tsx` | 使用 Scripting 的原生 AVPlayer 组件显示视频、系统控制及字幕叠层，并管理方向/关闭等播放 UI 行为。 |

播放地址属于可能变化的远端资源，不应当作长期稳定数据；长期历史保存作品身份、播放质量和进度，启动播放时再取得/使用当前有效的地址。原生 AVPlayer 的实际表现仍需在 Scripting/iPhone 上验证。

## 7. 字幕搜索、下载与显示

| 文件 | 主要内容与职责 |
| --- | --- |
| `page/search.tsx` | 站内作品搜索页面；字幕搜索入口位于作品详情相关 UI。 |
| `subtitle-search-code.ts` | 从作品番号/详情标识中抽取、规范化字幕搜索番号。 |
| `subtitlecat.ts` | SubtitleCat 搜索结果解析、中文语言识别与排序、下载文件验证和字幕文件下载。 |
| `subtitlecat-webview.ts` | 使用 WebView 读取 SubtitleCat 搜索页/文件页，处理站点返回与文档读取。 |
| `subtitle-search-cache.ts`、`subtitle-search-cache-db.ts` | 字幕搜索结果缓存接口与 SQLite 持久后端；缓存的是搜索信息，不是已下载字幕文件的数量上限。 |
| `page/components/subtitle_file_row.tsx` | 字幕结果列表中的语言/文件信息和下载操作行。 |
| `subtitles.ts` | SRT 时间轴解析、字幕文件本地读写、按作品番号关联、启用状态和字幕轨道缓存。 |
| `background-data.ts` | 将可移出的纯数据计算（如字幕解析/序列化）交给宿主后台计算能力；不在后台更新 UI。 |

字幕功能分成三段：按番号搜索 → 下载并保存/关联本机字幕 → 播放期间按视频时间匹配字幕并叠加显示。搜索结果缓存与已下载字幕文件是不同数据，删除搜索缓存不等于删除已下载文件。

## 8. 本机持久数据

| 文件/位置 | 保存内容 |
| --- | --- |
| `database.ts` | SQLite 表结构及读写：作品资料、浏览记录、播放历史、播放进度，以及栏目缓存所需的数据库设施。 |
| `storage.ts` | 页面和业务层使用的存储适配/公开操作函数，减少页面直接依赖数据库细节。 |
| `listing-cache-db.ts` | 栏目缓存 SQLite 数据库实现。 |
| `subtitle-search-cache-db.ts` | 字幕搜索结果缓存数据库实现。 |
| `subtitles.ts` 使用的应用文稿目录 | 下载的字幕文件单独保存，不与脚本源文件混放；目录实现和 Scripting 重建/升级后的保留行为，应以设备上的真实文稿容器验证为准。 |

存储设计中需区分：**用户数据**（播放/浏览进度、下载字幕）、**可重建缓存**（栏目快照、字幕搜索结果）、**临时数据**（播放 URL、解析内存缓存）。三类数据的保留策略不同。

## 9. 回归测试

`tests/` 按功能包含独立回归脚本，覆盖页面解析、栏目缓存、详情加载/导航、Cloudflare 会话、播放启动/进度、字幕搜索/下载/存储及 UI 合约等。`.mjs` 脚本运行生产模块回归；TypeScript 测试可通过 `tests/run-ts.mjs` 编译后运行。`tests/check-syntax.mjs` 检查项目 TypeScript/TSX 的语法转换。

测试文件名通常体现测试主题，例如：

- `tests/detail-loading-regression.mjs`、`tests/detail-navigation-regression.mjs`：详情请求与跳转。
- `tests/cloudflare-session-regression.ts`、`tests/site-verification-regression.mjs`：验证会话和访问流程。
- `tests/native-player-startup-regression.mjs`、`tests/playback-progress-regression.ts`：播放器启动和进度。
- `tests/subtitle-search-regression.mjs`、`tests/subtitle-download-regression.mjs`、`tests/subtitle-storage-regression.mjs`：字幕搜索、下载、存储。

回归测试验证可控的代码逻辑，不等于真实站点请求、Cloudflare 人机挑战、iOS 原生播放器、Scripting 宿主能力或重建后文件保留已在设备端验收。

## 10. 阅读与修改建议

按功能追踪时，可从页面入口开始，沿着对应调用链阅读：

- **页面/栏目问题**：`page/*` → `client.ts` → `webview.ts` / `html-parser.ts` → 对应 `tests/*`。
- **Cloudflare/域名问题**：`page/settings.tsx` → `site-verification.ts` → `cloudflare-session.ts` / `client.ts`。
- **详情/播放问题**：`page/detail-navigation.tsx` → `client.ts` → `playback-preparation.ts` → `player.tsx` / `native-player.tsx`。
- **字幕问题**：字幕列表 UI → `subtitlecat.ts` → `subtitles.ts` → `playback-preparation.ts` → `native-player.tsx`。
- **进度/本地数据问题**：页面/播放器 → `storage.ts` → `database.ts`。

修改前应先确认数据所有权（哪个页面请求、哪个 request scope 可取消）、缓存键是否包括域名/栏目/筛选条件、以及网络/Cookie/播放器能力是否属于宿主限制；完成后运行相关回归，并把设备端验收单独记录。
