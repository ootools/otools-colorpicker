# 屏幕取色 · Color Picker

一个独立的 OTools 插件仓库，与 `otools-puter-*` 仓库同级。取色业务、界面、测试和打包均在此仓库中，核心仓库不包含本插件源码。

## 功能

- 静默直达 Panel 插件：点击插件图标，或点击宿主托盘「插件动作 → 屏幕取色」，宿主在隐藏状态加载页面并立即进入原生全屏取色。托盘入口由 `plugin.json` 的 `trayActions` 声明（id `pick`，关键词 `launch`），与图标点击走同一条 `source: "direct"` 链路。
- 原生覆盖层负责定位、放大和确认/取消。插件不显示截图画布、放大镜、选区工具或自定义浮窗。
- “冻结画面取色”开关默认关闭，使用实时取色；开启后在冻结画面上取色。原生面板和浏览器预览均显示开关与提示，取色期间不可更改，设置保存在本地并用于下次启动。
- 确认后自动复制颜色，默认 HEX；在面板中选择 RGB/HSL 后会记住自动复制格式。
- 成功、取消和失败后均不自动显示 Panel；通过宿主的 Option 操作手动打开面板，查看色卡、复制格式、最近颜色或错误。手动展开本身不会再次取色，结束回调也不会再次隐藏用户已主动打开的面板。
- 面板的“再次取色”按钮显式启动同一原生流程；权限按钮显式申请屏幕录制权限。
- 最近24色去重保存在本地，色块附带 HEX 文案；可点击星标收藏常用颜色，收藏独立持久化。无截图上传或图片持久化。
- 主面板色板：饱和度/明度方阵与色相滑条支持鼠标/触摸拖拽和方向键操作，并内置 24 个预设色块；拖拽过程不刷历史，一次手势只记一条。
- 颜色格式实时转换：HEX / RGB / HSL / HEXA / RGBA / HSLA / HSV / CMYK / LAB 并列展示，每行可独立复制；可编辑输入框实时解析 HEX、RGB(A)、HSL(A)、HSV(A)、CMYK、LAB 色值（含百分比与 alpha，alpha 不参与屏幕取色），无效输入给出行内提示。
- 八种语言。浏览器仅提供明确标注的演示色块和浏览器剪贴板复制，不提供屏幕取色。

## 取色协议

页面启动时立即通过 `onOtoolsKeyword` 订阅 SDK 邮箱，在收到 `keyword: "launch"`、`source: "direct"` 时取色。事件等待同一能力/权限初始化流程，因此冷启动消息不会因检查尚未完成而丢失；普通挂载不会自动取色，并发启动会合并为一次在途操作。

宿主接受直达请求时已隐藏 Panel，因此直达事件通过 `session.start({ panelAlreadyHidden: true })` 跳过插件再次隐藏，保留用户在冷启动初始化期间通过 Option 主动展开的状态。手动点击“再次取色”时才先等待官方 Tauri core `invoke("hide_panel_window", {})` 通过宿主路由仅隐藏 Panel。两条路径都在等待初始化前锁定本次 `freezeScreen`，经 `session.start({ panelAlreadyHidden, freezeScreen })` 调用 `capture.select({ mode: "color", edit: false, hideHost: false, restoreHost: false, freezeScreen }, signal)`。省略会话选项时 `freezeScreen` 默认为 `false`。偏好键为 `otools-colorpicker:freeze-screen:v1`，仅字符串 `"true"` 启用冻结。不使用会隐藏所有宿主窗口的 `hideHost: true`，避免影响便签、贴图及其他窗口。完成结果沿用 SDK 的 `completed` 图像租约：读取 1×1 PNG，经离屏 Canvas 解码 RGB，再调用官方 Tauri core `invoke("otools_copy_text", { text })` 走 SDK 的宿主剪贴板路由。仅宿主返回布尔值 `true` 才显示复制成功，最终释放图像租约；读取、解码或复制失败也会释放。取消和卸载后到达的图像仅释放，不读取或复制。

插件只在手动取色开始前请求宿主隐藏 Panel，不使用 `getCurrentWindow` 或显示、缩放、居中、拖动、关闭窗口 API，结束时不再执行任何显隐操作。颜色值是宿主 PNG 解码后的 RGB，不额外转换显示器 ICC 色彩空间。复制失败时保留色值供手动查看。

## 开发与验证

Node.js ≥22.12，pnpm：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm run pack
```

预览：http://127.0.0.1:5994/ 。没有桌面桥接时屏幕取色禁用，演示色块可检查格式、历史和浏览器剪贴板；页面会明确标注此限制。

SDK 依赖为 npm 发布的 `otools-plugin-sdk@^0.3.0`（版本锁定在 `pnpm-lock.yaml`），安装和构建不需要核心仓库，也不引用核心源码路径。SDK 0.3+ 不再导出 `capture-factory` 运行时模块，因此错误类型由插件本地定义（`src/captureSession.ts`），能力/权限类型从 `otools-plugin-sdk/capture` 导入。

## 加载

开发：在 OTools 开发管理中创建插件记录，绑定本仓库根目录，配置清单中的 devUrl 并启用调试。不要软链到核心 plugins 目录。

离线安装：先 `pnpm build && pnpm run pack`，在插件市场的本地安装入口选择 `dist-pack/otools-colorpicker-0.1.1.oplg`。包采用与 puter 系列一致的扁平 ZIP 格式，生产清单移除 devUrl。

必须升级到支持 `freezeScreen` 实时/冻结选择协议的新 OTools 宿主及 SDK；仅更新插件不能让旧宿主获得实时取色能力。宿主还需支持直达 Panel、原生 color 模式、`restoreHost: false`、`hide_panel_window` 和 `otools_copy_text` 路由；托盘「插件动作」需要 OTools ≥ 0.9.10（该版本起支持清单 `trayActions` 与直达关键词透传），低版本宿主不会渲染该菜单项但不影响图标直达。清单声明 `openMode: "panel"`、`directLaunch: true`、`screenCapture: true` 与 `trayActions`，不声明面板宽高，沿用宿主默认 Panel 布局及用户的全局尺寸偏好。

## 权限与平台

- macOS：需要 OTools 的屏幕录制权限。每次明确启动取色都会重新检查系统权限；未授权且可申请时发起系统授权请求，用户同意后继续取色。若系统要求重启或仍未授权，可在系统设置中开启 OTools 的屏幕录制权限后再次启动。普通显示 Panel 不会触发授权请求。
- 实时取色：当前原生实现要求 macOS 14+，通过 ScreenCaptureKit 持续采样；画面继续更新，确认时取当前像素。
- 冻结取色：开启开关后使用宿主截图后端，选取启动时的静态画面。Windows 和 Linux/X11 等平台是否可用取决于宿主支持；Wayland 等不支持的环境会提示。
- 实时模式不可用时提示“实时取色不可用，可开启冻结画面取色”。插件不会静默回退或自动开启开关；请通过 Option 打开面板手动选择。冻结模式不可用仍显示通用的不支持提示。
- 桌面复制只调用宿主系统剪贴板；失败不会退回浏览器剪贴板，也不会弹出新窗口。
- 成功、取消和错误均不主动显示宿主或 Panel。

自动测试覆盖颜色计算与历史、1×1 读取/解码/复制/释放顺序、取消和迟到结果、冷启动和重复事件、权限与复制确认。真实权限、多显示器、原生覆盖层及隐藏 Panel 的直达启动仍需在对应桌面宿主验收。

本仓库已发布 **v0.1.1**：GitHub Release 标签 `v0.1.1`（含 `otools-colorpicker-0.1.1.oplg`、`plugin.json`、`logo.svg`、`SHA256SUMS`），并已上架 OTools 插件市场（单合包 `packageMode=0`）。推 `v<版本>` 标签会自动构建、发 Release 并同步上架；`release` environment 已配置 `XYCLOUD_PAT` 与 `OTOOLS_PUBLISH_MARKET=true`。

### 版本记录

- **v0.1.1**：重设计面板布局——按宿主默认 800×600 Panel 改为左右双栏（左主视觉色卡＋取色/冻结操作，右 SV 方阵×色相条＋输入），色值/预设/最近/收藏合并为四标签页（色值页 9 种格式 3 列），新增空态与权限提示；保留全部原生取色、键盘/拖拽、剪贴板与 8 语言能力。
- **v0.1.0**：首个版本，原生全屏取色并自动复制，支持冻结画面、9 种格式转换、最近 24 色与收藏。
