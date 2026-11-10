# 独立屏幕取色插件迁移

已定方案：独立 Vue + TypeScript Panel 插件，点击图标静默启动原生全屏取色，复制后不自动显示面板。源码与测试仅在本仓库，SDK 与宿主协议由协调器维护；不创建远程仓库、提交或推送。

## 设计

- 清单使用 `openMode: "panel"`、`directLaunch: true`、`screenCapture: true`，不声明 panelWidth/panelHeight，沿用宿主默认布局与全局尺寸偏好；删除 customWindow。
- 页面启动立即订阅 SDK `onOtoolsKeyword` 邮箱，匹配 `keyword: "launch"` 与 `source: "direct"`。在任何能力/权限等待之前设置在途锁，复用同一初始化 Promise，防止冷启动事件丢失及重复启动。
- 普通挂载、焦点变化、可见性变化和宿主 Option 手动展开不会自动取色。手动取色按钮复用同一流程。
- 宿主接受直达请求时已隐藏 Panel，直达事件通过 `session.start({ panelAlreadyHidden: true })` 跳过再次隐藏，保留用户在冷启动初始化期间通过 Option 主动展开的状态。手动取色才先等待宿主 `invoke("hide_panel_window", {})`，仅隐藏 Panel。两条路径都调用 `capture.select({ mode: "color", edit: false, hideHost: false, restoreHost: false }, signal)`。使用 `hideHost: false` 保留便签、贴图及其他宿主窗口的原有可见状态。
- 宿主覆盖层负责全屏选择和确认/取消。插件无截图预览、区域控件或放大镜，无拖动/关闭/调整大小等浮窗行为。
- 完成时读取 SDK 已有图像租约中的 1×1 PNG，在离屏 Canvas 解码 RGB，通过官方 Tauri core `invoke("otools_copy_text", { text })` 复制；只有布尔 `true` 才确认成功。默认 HEX，选中格式本地保存。无原生失败后的浏览器剪贴板回退。
- 在 finally 中释放 imageId；读取、解码、复制失败也释放，保留原始错误。取消/卸载会 abort；迟到结果只释放，不读取或复制。在途锁覆盖隐藏、选择、读取、解码、复制和释放。
- 成功、取消和失败不自动显示窗口或弹窗，结束时也不再次隐藏用户主动展开的面板。面板保留颜色和错误用于手动查看。
- 普通面板保留色卡、HEX/RGB/HSL、复制、最近24色和显式权限请求。每次明确启动先刷新权限，缺少权限且允许申请时调用系统授权，获得许可后继续；普通挂载不发起授权。原生返回 permissionDenied 后刷新状态。
- 保留 colors.ts 的颜色/历史工具与测试，保留八种语言。浏览器只有标注清晰的演示色块与浏览器剪贴板。

## 验证

1. 先替换截图/窗口恢复测试，运行失败测试验证新协议尚未实现，再实现原生颜色会话。
2. 会话测试覆盖仅隐藏 Panel 的顺序、1×1 read/decode/copy/release、严格复制确认、失败清理、取消/卸载迟到回收和并发锁。
3. App 测试覆盖冷启动等待初始化且只取色一次、普通展开不取色、手动取色、持久化格式和历史、权限撤销与重新授权、复制失败保留色值、无浮窗控件及无窗口 API 调用。
4. 运行全量 Vitest、vue-tsc 和生产构建。真实原生覆盖层、隐藏启动、多屏和系统权限需在桌面宿主验收；浏览器演示不代替这部分验收。
