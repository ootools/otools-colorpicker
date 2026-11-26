# Panel 直达版本验证

## 2026-11-26 主面板功能升级

- 全量 204 项 Vitest 通过（colors 126 / captureSession 26 / App 52），`vue-tsc` 与 Vite production build 通过，修复 `pack.mjs` 的 SDK license 路径后 `pnpm run pack` 生成 11 文件、48810 字节的 `.oplg`。
- 新增覆盖：HSV/CMYK/LAB 转换与舍入、多格式解析及拒绝表、扩展格式输出；预设色选择、输入框实时解析与单次历史提交、无效输入提示、SV 拖拽与键盘操作（一次手势只记一条历史）、收藏跨挂载持久化、转换结果经宿主剪贴板复制。
- 兼容修复：安装依赖刷新到 npm SDK 0.3.0 后，`otools-plugin-sdk/capture-factory` 运行时子路径已不存在；错误类改为插件本地实现，类型从 `otools-plugin-sdk/capture` 导入，测试相应调整。原生取色协议与既有断言（精确色值、唯一 alert/status、无窗口 API）保持不变。
- 未做真实宿主原生全屏取色验收；浏览器预览不替代该部分。

2026-11-10，冻结画面偏好更新：插件全量 163 项测试、vue-tsc 与 Vite production build 均通过。先执行新增测试确认缺少开关、参数及实时模式提示的失败，再实现功能。新增覆盖默认 `freezeScreen: false`、仅字面值 `"true"` 启用、切换后跨挂载恢复、冻结参数、忙碌期间禁止切换、选项快照、八种语言提示、两种模式取消不复制及宿主默认 Panel 尺寸。保留现有权限申请/重检、直达不重复隐藏及结束不自动显示行为。

实时取色需支持 `freezeScreen` 的新宿主及 SDK，原生实时实现要求 macOS 14+ / ScreenCaptureKit。实时不可用时引导用户手动开启冻结，不自动切换模式。此次插件验证未执行真实桌面实时/冻结取色验收。

本次宿主实时取色最终验证：

- 捕获前端 50 项测试通过，`tsconfig.capture.json` 类型检查通过；独立 capture/capture-pin 生产页面构建通过。
- SDK 截图/注入/复制相关 46 项测试通过，类型检查通过。
- 完整 Rust library 337 项通过、4 项忽略。此前并行模块编译错误已消除；`plugin_link_install.rs` 的阻塞闭包仅补充 `Result<(), String>` 类型标注。
- 受控浏览器夹具验证生产取色页面：背景为透明、没有冻结图 Canvas、读取冻结图片次数为 0；鼠标静止时样本计数和颜色持续变化；点击新位置提交匹配的 sampleId 与 1×1 坐标，成功后退出。夹具模拟原生数据，不代表实际 ScreenCaptureKit 桌面采样已验收。
- 新安装包已重新生成并校验；仍不声明 panelWidth/panelHeight，沿用默认 Panel 布局。
- 本轮未替换本机 `/Applications/OTools.app` 或已安装插件。实时模式须配套更新宿主，不能只更新插件包。

此前 Panel 直达版本验证结果：

- 独立取色插件：135 项测试通过，vue-tsc 与 Vite production build 通过。
- SDK：84 项全量测试通过，tsc 及 capture 注入一致性检查通过。
- 宿主相关前端：89 项测试通过，覆盖 Panel 静默打开、手动显示、旧模式回归和全屏点取色。
- Rust library：291 项通过、2 项原有忽略。包括色彩模式参数、1×1 输出约束、所有终止路径不恢复窗口、旧 custom 来源隔离匹配。
- 安装包校验通过：openMode=panel、directLaunch=true，没有 customWindow/devUrl，入口文件存在，ZIP CRC 正常。
- 浏览器确认 Panel 页面已删除浮窗关闭、拖拽、缩放及快照编辑入口。浏览器不执行原生取色。

尚未做真实桌面 GUI 验收：录屏授权、多屏/DPI、图标点击到全屏像素选择、系统剪贴板结果及双击 Option 显示。自动化测试不能替代这些原生验收。

宿主常规 vue-tsc 命令通过；额外显式 tsconfig.app.json 全应用检查仍有既有 Git 插件文件列表、MCP 测试及其他类型错误，未为本功能修改无关文件。

必须配合本次新增直达及color/restoreHost选项的宿主。旧宿主不支持这些清单/协议字段，不能只更新插件包验证完整流程。
