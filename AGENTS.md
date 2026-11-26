# Zotero BridgeFlow 仓库工程规范

本仓库遵循根目录 [AGENTS.md](../../AGENTS.md) 的全部长期工程铁律，并补充以下项目级约束：

1. **品牌与兼容边界**：
   - 显示名称：`Zotero BridgeFlow`（中文名：桥引）；仓库名：`Zotero-BridgeFlow`；扩展 ID：`bridgeflow@groele`；首选项前缀：`extensions.zotero.bridgeflow.`；宿主门面：`Zotero.zoterobridgeflow`；CSS/DOM/FTL 前缀：`zbf-`。
   - 宿主兼容范围锁定为 Zotero `10.0` ~ `12.*`（Gecko 153+ / Firefox 140+）。
2. **五层微内核与子域模块化结构（禁止越层依赖）**：
   - 依赖流向严格单向：`bootstrap.js` ➔ `src/kernel/` ➔ `src/services/` ➔ `src/domains/` ➔ `src/bridges/`（设置页 `src/preferences.ts` + `src/prefs/` 仅依赖 `src/kernel/` 与 `src/services/`）。
   - **严禁 `src/domains/workspace/`、`src/domains/visual-notes/`、`src/domains/inspector/`、`src/domains/word-cite/` 之间互相直接 `import`**；跨领域协作必须经由 `TypedEventBus` 或 `src/services/` 在 `src/bridges/` 中完成。
   - **子域内部按职责清晰分包**：
     - `src/prefs/`：`color-editor.ts`、`dependencies.ts`、`helpers.ts`（入口 `src/preferences.ts`）
     - `src/domains/workspace/`：`store/`（状态与独立磁盘缓存）、`tabs/`（标签投影/关闭/右键菜单）、`topbar/`（水平栏/固定条/Hub 弹窗）、`sidebar/`（侧边栏/批量操作/悬停预览卡）、`reader/`（阅读器多版本切换器/相邻阅读器/计时）、`spotlight/`（全局命令面板）、`styles/`（样式定义），域根保留 `module.ts`、`workspace-ui.ts` 等门面文件。
     - `src/domains/visual-notes/`：`columns/`（文库列/状态评级/题名热力图）、`gallery/`（画廊网格与看板虚拟滚动）、`hub/`（分类笔记中心与对比矩阵）、`reader/`（选词弹窗颜色语义标签/批注合并/条目简记），域根保留 `module.ts`、`visual-notes-prefs.ts`、`data-source.ts` 等门面文件。
     - `src/domains/inspector/`：`csl-preview/`、`lookup/`、`pdf/`、`word-panel/`，域根保留 `module.ts`。
     - `src/domains/word-cite/`：`ipc/`、`orphan/`、`governance/`，域根保留 `module.ts`、`word-cite-bus.ts`。
3. **构建与源码唯一权威**：
   - 唯一可编辑源码目录为 `src/`（严格 TypeScript + ES Modules），禁止手改编译产物 `zoterobridgeflow.js` 与 `zoterobridgeflow_prefs.js`。
   - 任何单文件不得超过 `360` 行；执行 `npm test` 必须同时通过 `tsc --noEmit`、esbuild 打包、架构守卫 (`scripts/architecture-guard.mjs`)、语法校验与全部单元测试。
4. **设置面板与本地化规范**：
   - 按用户最新明确指令，设置页回归 **v0.2 简练视觉风格与底边线横向标签页**（`.zbf-tabs` / `.zbf-tab-btn`，`总览` / `工作区` / `可视化与简记` / `检阅与反查` / `Word 引用` / `存储维护`），总览页采用简练复选框式「启用模块」卡片、各子系统停用横幅与一键恢复、Word 引用面板统一归入「Word 引用」标签页，并支持点击色块直接可视化编辑 8 色语义标签而无需手写 JSON；严格遵守 40px 黄金对齐基准线（16px / 24px / 40px）与 Fluent `data-l10n-id` 全本地化（`zh-CN` / `en-US` 100% 对称，零硬编码中文）。
5. **独立运行与数据契约**：
   - BridgeFlow 使用自己的偏好命名空间与工作区格式。工作区持久化和 JSON 导入以同一份运行时 schema 为准，类型从 schema 推导。
   - 用户管理其他插件的启停。新功能直接基于当前 Zotero API 与 BridgeFlow 原生模型开发。
6. **版本递增铁律**：
   - **每次修改必须更新版本号**：每轮代码、样式或功能修改完成时，必须同步递增语义化版本号（如 `0.3.5` → `0.3.6`）并保证 `package.json`、`manifest.json`、`update.json`、`package-lock.json`、`scripts/architecture-baseline.json`、`prefs.xhtml`、`README.md` 及重新打包产物 100% 对齐。
