# 字幕播放检查

字幕保存成功不等于播放器已经显示字幕。需要分别检查文件读取、时间匹配和 iPhone 原生播放器的叠层。

## 本次实现

- 下载和文件导入仍保存到当前作品对应的本地 SRT 文件，播放前重新读取。
- 有字幕时通过 `VideoPlayer.overlay` 挂载字幕和关闭按钮，不再把字幕放在播放器外层。
- 字幕组件每 250 毫秒读取实际 `AVPlayer.currentTime`，不会用计时器运行时长模拟播放进度；暂停、跳转和续播都使用视频时间。
- 字幕状态更新限定在叠层组件内；不会为了切换一行对白而更新整个播放器组件。
- 开始播放时短暂显示“字幕已加载 · N 条”，5 秒后消失。对白仍只在匹配的时间区间内以底部单行显示。
- 没有字幕或关闭字幕时，保持原来的 `AVPlayerView` 和画中画路径。自定义字幕不承诺在画中画窗口内显示。

官方接口：[Scripting VideoPlayer](https://scriptingapp.github.io/guide/Device%20Capabilities/Play%20Video/VideoPlayer/)。其 `overlay` 是播放器内的自定义叠层，位于系统播放控件下方。

## 本机回归检查

`tests/native-player-subtitle-regression.mjs` 是 Node 测试，不是 Scripting 脚本入口。使用 Node 24 或更新版本，以及 Playwright 的 Babel 代码转换包：

```powershell
node tests/native-player-subtitle-regression.mjs "完整路径/playwright/lib/transform/babelBundle.js"
```

如果已经在本地安装 Playwright，可省略路径参数：

```powershell
node tests/native-player-subtitle-regression.mjs
```

测试执行实际 `subtitles.ts → player.tsx → native-player.tsx` 代码，模拟本地文件、播放请求和 Scripting UI，检查导入后读取、原生 overlay 接线、续播匹配、倒退跳转、字幕空档、暂停保持、提示消失、关闭清理，以及关闭字幕后的原生画中画路径。

这不是 iPhone 上的布局、触摸或全屏动画测试，也不是完整 TypeScript 类型检查。

## iPhone 必须检查

1. 更新脚本后，打开已导入字幕的作品。确认详情页字幕开关已开启，不必重新下载相同字幕。
2. 播放时查看左上角是否出现“字幕已加载 · N 条”，并确认关闭按钮可点。
3. 在详情页使用“本地字幕叠层测试”。其测试字幕从第 1 秒开始，超过 11.5 秒后仍有一行测试文字；这个步骤不依赖网上下载文件。
4. 正常播放导入的字幕时，跳转到 SRT 中的对白时间，确认底部一行字幕出现；字幕空档内没有文字是正常的。
5. 暂停、倒退、前进和退出后续播，分别检查显示的对白与当前视频时间一致。
6. 若点击系统全屏按钮，再检查字幕和关闭控件；系统控件出现时可能覆盖部分字幕，这是原生 overlay 的层级限制。
7. 关闭字幕后播放，确认原生播放控件和画中画行为没有回归。

如果“字幕已加载”也不出现，请反馈是否仍显示关闭按钮，以及“本地字幕叠层测试”是否显示。若载入提示出现、测试字幕能显示、只有下载字幕不显示，需要继续核对该字幕的对白时间与当前视频版本，而不能把保存成功当成匹配成功。
