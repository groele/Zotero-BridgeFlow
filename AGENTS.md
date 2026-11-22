# Zotero BridgeFlow 仓库工程规范

本仓库遵循根目录 [AGENTS.md](../../AGENTS.md) 的全部长期工程铁律，并补充以下项目级约束：

1. **品牌与兼容边界**：
   - 显示名称：`Zotero BridgeFlow`（中文名：桥引）；仓库名：`Zotero-BridgeFlow`；扩展 ID：`bridgeflow@groele`；首选项前缀：`extensions.zotero.bridgeflow.`；宿主门面：`Zotero.zoterobridgeflow`；CSS/DOM/FTL 前缀：`zbf-`。
   - 宿主兼容范围锁定为 Zotero `10.0` ~ `12.*`（Gecko 153+ / Firefox 140+）。
2. **五层微内核架构红线（禁止越层依赖）**：
   - 依赖流向严格单向：`bootstrap.js` ➔ `src/kernel/` ➔ `src/services/` ➔ `src/domains/` ➔ `src/bridges/`（设置页 `src/prefs/` 仅依赖 `src/kernel/` 与 `src/services/`）。
   - **严禁 `src/domains/workspace/`、`src/domains/inspector/`、`src/domains/word-cite/` 之间互相直接 `import`**；跨领域协作必须经由 `TypedEventBus` 或 `src/services/` 在 `src/bridges/` 中完成。
3. **构建与源码唯一权威**：
   - 唯一可编辑源码目录为 `src/`（严格 TypeScript + ES Modules），禁止手改编译产物 `zoterobridgeflow.js` 与 `zoterobridgeflow_prefs.js`。
   - 任何单文件不得超过 `360` 行；执行 `npm test` 必须同时通过 `tsc --noEmit`、esbuild 打包、架构守卫 (`scripts/architecture-guard.mjs`)、语法校验与全部单元测试。
4. **设置面板与本地化规范**：
   - 采用 5 卡片单层折叠布局（仅第 1 张卡片默认展开）、严格遵守 40px 黄金对齐基准线（16px / 24px / 40px）与 Fluent `data-l10n-id` 全本地化（`zh-CN` / `en-US` 100% 对称，零硬编码中文）。
5. **冲突停用与无损迁移**：
   - 启动时自动安全停用旧版 `zotero-tabflow@groele`、`zotero-viewflow@groele`、`citeflow@groele` 与 `zoterocitation@polygon.org`，并一次性无损迁移旧偏好设置与本地状态，不删除旧键，保障可回退。
