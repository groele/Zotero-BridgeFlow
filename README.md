<div align="center">

<img src="assets/bridgeflow.svg" alt="Zotero BridgeFlow Logo" width="96" height="96" />

# Zotero BridgeFlow（桥引）

> 当前版本：**0.1.4** · 兼容范围：**Zotero `10.0` ~ `12.*`** · 协议：**AGPL-3.0-or-later**

</div>

**Zotero BridgeFlow（桥引）** 是将 **Zotero TabFlow**（多标签阅读工作区）、**Zotero ViewFlow**（侧栏引文预览与反向逆查）与 **Zotero CiteFlow**（Microsoft Word 写作引用追踪与拖拽直插）深度融合为一体的一站式科研读写工作台插件，彻底打通 **「多篇沉浸精读 ➔ 即时引文检阅/反查 ➔ Word 写作引用追踪」** 闭环。

## 核心架构与融合特性

- **五层微内核分层架构**：`bootstrap.js` ➔ `src/kernel/`（统一生命周期热启停、强类型事件总线、全局唯一 `Zotero.Notifier`、Schema 偏好中心、`NativeRuntime` 幂等 Patch 链）➔ `src/services/`（共享 CSL/剪贴板/反查历史库、条目解析、右侧 4 面板统一注册、Win32 句柄池）➔ `src/domains/`（`workspace` / `inspector` / `word-cite` 严格隔离，静态架构守卫禁止横向导入）➔ `src/bridges/`（事件驱动跨领域深度联动）。
- **四大内在功能联动**：
  1. **全入口复制引文 ➔ 自动沉淀反查历史**：标签右键、CSL 预览区或 Spotlight 复制的引文统一写入本地历史缓存，粘贴回来 100% 秒级反查命中。
  2. **Word 引用状态 ➔ 垂直标签侧栏实时徽标**：实时在左侧阅读标签行展示当前 Word 稿件引用序数（如 `[1]`）。
  3. **Spotlight 跨三域命令中枢（`Ctrl+P` / `Cmd+P`）**：统一检索已开标签、当前 Word 稿件已引用文献，并支持一键将当前稿件引用的打开标签归入同名分组。
  4. **引文反查命中 ➔ 工作区智能跳转**：点击反查命中条目时优先激活已打开的对应阅读器标签页并展开其折叠分组，避免重复打开。
- **独立工作区**：新版从空工作区开始。备份中心仅接受 BridgeFlow 格式 2。启用前请自行停用与所需功能重叠的独立插件。

## 开发、测试与打包

本版使用 TypeScript 6.0.3 严格类型检查和 esbuild 0.28.2 构建两个宿主入口。标签工作区使用 Valibot 校验原生状态与备份，快照记录当前打开的文献，也可单独归档指定分组。

环境要求：Node.js `>= 22.14`、PowerShell（用于打包 `.xpi`）。

```bash
npm install
npm test
npm run build:xpi
```

## 安装包完整性校验 (`v0.1.4`)

- 文件名：`Zotero-BridgeFlow-0.1.4.xpi`（`157,808` 字节，19 个条目）
- SHA-256：`219934A200060CD728C694BC2BC6FA39E0946A107358CEAC860DF91BE7A0C886`
- SHA-512：`8ca7cb31df90b5269a2aacc0291d7d9ab30099c726455743235985e43ad9d6f3241682e353751e3ec86bf0fc16bf7edce25a9fc3bd5a773c6b77243a4685d017`

## 开源协议与致谢

本项目采用 **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** 协议，完整继承并致谢原 Zotero TabFlow、Zotero ViewFlow（基于 ZoteroPreview）、Zotero CiteFlow（基于 Easier Citation）以及 Tab Enhance、Tab Manager、Weavero 等上游开源社区贡献者。
