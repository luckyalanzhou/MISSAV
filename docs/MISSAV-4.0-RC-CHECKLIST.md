# MISSAV 4.0.0 候选验收清单

## 候选身份

- Candidate：`MISSAV-4.0.0-ui-rc1`
- Production entry：`index.tsx`
- Home Tab entry：`home_screen_default_ui.tsx`
- Baseline：`3.4.0`
- Scope：原生 iOS UI、信息架构、正式文案、对齐和共享展示组件
- Frozen domain：网络、解析、账号、数据库、存储 identity、推荐算法、播放源与系统播放器

## 自动证据

| 项目 | 状态 | 结果 |
|---|---|---|
| TypeScript diagnostics | Confirmed | 0 diagnostics |
| `scripting-ts project "MISSAV" --check` | Confirmed | 通过 |
| 媒体源回归 | Confirmed | 6 项通过 |
| Home Tab preview | Confirmed | 成功渲染 |
| 独立入口启动 | Inspected | 长驻 UI 在超时前未报告构建错误；需真机完成交互确认 |
| TS/TSX 界面规范检查 | Confirmed | 通过 |
| Home Tab 显式 NavigationStack | Confirmed | 单一根栈 |
| Home Tab `topBarTrailing` | Confirmed | 0 个匹配 |
| Home Tab 运行入口导入 | Confirmed | 未导入 `index.tsx` |
| 版本一致性 | Confirmed | metadata、设置、应用内日志为 4.0.0 |

## 已实施页面

- 首页：继续观看优先、推荐/收藏导航行、今日热门、最近更新。
- 浏览：第一页精选、后续统一网格、选中 checkmark、正式计数。
- 搜索：正式搜索范围、列表/大封面双模式、四个低饱和分类入口；显示偏好保存在本机。
- 资料库：收藏/历史双层分类、本机/网站与播放/浏览子分类。
- 详情：单一主播放、双收藏同级操作、肯定式状态文案。
- 推荐：正式隐私说明、统一媒体行和推荐理由。
- 设置：移除版本营销区，保留长期设置。
- Home Tab：继续观看优先、低饱和快速入口、宿主边界不变。

## 真机 P0（Pending manual verification）

### 视觉与内容压力

- [ ] Light / Dark。
- [ ] 320–375pt 窄屏。
- [ ] 最大常用 Dynamic Type。
- [ ] 长中文、日文、英文标题。
- [ ] 详情双收藏在 compact width 或无障碍大字时自动纵向，按钮无截断。
- [ ] 资料库“收藏/历史”切换后子分类原子更新，无短暂无选中或 metadata 跳变。
- [ ] 资料库第二层轻量菜单在大字模式可完整理解。
- [ ] 搜索列表/大封面开关、浏览分类动作在窄屏与大字下无竞争和截断。
- [ ] 大封面模式的 196pt 封面、三行标题、metadata 与 badge 无重叠。

### 无障碍

- [ ] VoiceOver 阅读顺序正确。
- [ ] 灰度或常用色彩滤镜下栏目选中可辨。
- [ ] Increase Contrast。
- [ ] Reduce Transparency。
- [ ] 收藏、账号、错误和禁用状态均有非颜色线索。

### 宿主与生命周期

- [ ] 独立入口工具栏中部标题随四 Tab 正确切换，关闭、设置与最小化始终可用。
- [ ] 独立入口四 Tab 正常切换。
- [ ] 设置 push/pop。
- [ ] 关闭、最小化、恢复、退出语义正确。
- [ ] 真实 Home Tab 宿主三点菜单位置正确。
- [ ] Home Tab 滚动、回弹时无顶部横向模糊条。
- [ ] Home Tab 下拉刷新与重新选中刷新正常。

### 业务冻结回归

- [ ] 搜索、栏目、筛选、排序与分页。
- [ ] 本机收藏加入/取消。
- [ ] 网站收藏登录、读取、加入/取消与失效状态。
- [ ] 播放记录、浏览记录和清空操作。
- [ ] 播放源获取、其他清晰度、失败反馈。
- [ ] 系统播放器、画中画、旋转和关闭后无残余音频。
- [ ] 弱网下首页部分成功、详情刷新失败、分页失败。

## 当前判断

**Conditional Go（自动候选） / 真机发布 No-Go**

自动诊断、项目检查、Home Tab 预览、界面规范检查和媒体源回归均已通过；但 P0 真机矩阵尚未绑定当前候选完成，因此不能作无条件发布判断。

## 回滚

- 业务数据 schema、identity 和路径未变。
- 可回滚至 3.4.0 UI 代码，现有收藏、账号会话、浏览记录与播放记录不应受影响。
- 任何真机修复若触及网络、存储、账号或播放域，必须建立新候选并重跑对应证据。
