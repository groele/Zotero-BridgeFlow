<div align="center">

<img src="assets/bridgeflow.svg" alt="Zotero BridgeFlow Logo" width="96" height="96" />

# Zotero BridgeFlow（桥引）

> 当前版本：**0.4.2** · 兼容范围：**Zotero `10.0` ~ `12.*`** · 协议：**AGPL-3.0-or-later**

</div>

**Zotero BridgeFlow（桥引）** 是将 **Zotero TabFlow**（多标签阅读工作区）、**Zotero ViewFlow**（侧栏引文预览与反向逆查）与 **Zotero CiteFlow**（Microsoft Word 写作引用追踪与拖拽直插）深度融合为一体的一站式科研读写工作台插件，彻底打通 **「多篇沉浸精读 ➔ 即时引文检阅/反查 ➔ Word 写作引用追踪」** 闭环。

## 核心架构与融合特性

- **五层微内核分层架构**：`bootstrap.js` ➔ `src/kernel/`（统一生命周期热启停、强类型事件总线、全局唯一 `Zotero.Notifier`、Schema 偏好中心、`NativeRuntime` 幂等 Patch 链）➔ `src/services/`（共享 CSL/剪贴板/反查历史库、条目解析、右侧 4 面板统一注册、Win32 句柄池）➔ `src/domains/`（`workspace` / `visual-notes` / `inspector` / `word-cite` 四大子系统严格隔离，静态架构守卫禁止横向导入）➔ `src/bridges/`（事件驱动跨领域深度联动）。
- **四大内在功能联动**：
  1. **全入口复制引文 ➔ 自动沉淀反查历史**：标签右键、CSL 预览区或 Spotlight 复制的引文统一写入本地历史缓存，粘贴回来 100% 秒级反查命中。
  2. **Word 引用状态 ➔ 垂直标签侧栏实时徽标**：实时在左侧阅读标签行展示当前 Word 稿件引用序数（如 `[1]`）。
  3. **Spotlight 跨三域命令中枢（`Ctrl+P` / `Cmd+P`）**：查找已打开的标签，并通过命令将当前 Word 稿件引用的打开标签归入同名分组。
  4. **引文反查命中 ➔ 工作区智能跳转**：点击反查命中条目时优先激活已打开的对应阅读器标签页并展开其折叠分组，避免重复打开。
- **独立工作区**：新版从空工作区开始。备份中心仅接受 BridgeFlow 格式 2。启用前请自行停用与所需功能重叠的独立插件。

## 设置

采用以四大子系统为核心的 6 张单层 `<html:details>` 可折叠设置卡片（默认仅展开「概览与四大子系统总开关」），支持子系统总开关联动、热图颜色与最大透明度自定义，以及直接在设置面板内所见即所得地编辑 8 色标注语义标签并自动保存。

## 快速查找与本地存储

快速查找直接读取本窗口的标签标题和备注。打开时最多显示 12 项，输入后最多显示 40 项，也可按分组或会话名称定位。输入 `>` 查看命令。整库文献请使用 Zotero 主文库搜索框。

磁盘文件默认位于 Zotero 数据目录的 `bridgeflow-cache/`。其中 `citation-history.json` 保存引文复制历史，`workspace-snapshots.json` 和 `workspace-snapshots.bak.json` 保存工作区与上一份快照。两者共用设置中的缓存目录，修改后重启 Zotero 生效。切换到已有目录会读取其中的文件；若新目录缺少文件，插件会尝试从默认目录恢复。自定义目录之间迁移时，可在 Zotero 关闭后复制上述文件。CSL 格式化结果和 PDF 预览只在内存中复用。

## 开发、测试与打包

本版使用 TypeScript 6.0.3 严格类型检查和 esbuild 0.28.2 构建两个宿主入口。标签工作区使用 Valibot 校验原生状态与备份，快照记录当前打开的文献，也可单独归档指定分组。

环境要求：Node.js `>= 22.14`、PowerShell（用于打包 `.xpi`）。

```bash
npm install
npm test
npm run build:xpi
```

## 安装包完整性校验 (`v0.4.2`)

- 文件名：`Zotero-BridgeFlow-0.4.2.xpi`（`191,844` 字节，19 个条目）
- SHA-256：`140F1532A5FEBEC397A070FA17AD760A25F5A8F74E25F3392065F7262A259D0F`
- SHA-512：`D137E700FF070660FF148DE66A048E471F557421E2B56BCB2D3CD63ABD6CDDA8A7F970FDC83CEEE031627937531CCFF5D8AE43E690D740904F670E6A0F496FBC`

## 开源协议与致谢

本项目采用 **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** 协议，完整继承并致谢原 Zotero TabFlow、Zotero ViewFlow（基于 ZoteroPreview）、Zotero CiteFlow（基于 Easier Citation）以及 Tab Enhance、Tab Manager、Weavero 等上游开源社区贡献者。
