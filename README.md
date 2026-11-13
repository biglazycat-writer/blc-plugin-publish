# 微信公众号发布 · 大懒猫创作平台插件

**简体中文** | [English](README.en.md)

[大懒猫创作平台](https://github.com/biglazycat-writer) 的官方 API 版公众号发布插件。把编辑器里的文章排版成符合微信公众号要求的 HTML，处理正文图片与封面，通过公众号官方接口创建**草稿**；最终发表仍由作者在公众号后台人工确认，插件不群发、不公开发表。

本仓库是一个**独立的 npm 工程**：SDK 从随仓库携带的固定 tgz 安装，排版代码、主题和测试由本工程独立维护，不引用、不软链接、不依赖桌面端源码。

| 项目 | 值 |
| --- | --- |
| 插件 ID / 包名 | `blc-plugin-publish` |
| 版本 | `0.2.1` |
| 插件 API | `biglazycat.apiVersion = 1`、`minimumApiRevision = 2` |
| SDK | `vendor/blc-plugin-sdk-1.2.0.tgz`（已验证的待发布工件） |
| 运行环境 | Node `>=22.23.3 <23.0.0`（宿主提供，安装包不内嵌 Node） |
| 支持平台 | Windows amd64/arm64、macOS amd64/arm64、Linux amd64/arm64 |
| UI 技术 | React 19 + TypeScript + Vite 7 + Vitest |

---

## 功能

**账号与连接**

- 在「账号设置」页填写 AppID / AppSecret，可配置不含账号密码的 HTTP(S) 代理。
- 「测试连接」验证凭据并缓存 `access_token`（提前 300 秒过期，并发请求共用一次取 token）。
- 「检查微信 IP 白名单」检查微信是否接受当前连接；遇到 `40164` 时解析出口 IP 并提示加入白名单。检查成功时微信不一定返回 IP；带代理时标记出口来源。
- 常用微信错误码（`40001` / `40013` / `40125` / `40164` / `45009` / `48001` 等）翻译成中文提示。

**写作与排版**

- 10 套内置主题：中国风、暗黑科技、毛玻璃、GitHub Markdown、LaTeX 学术、绿豆护眼、藕荷、摸鱼票根、清风杂志、先锋看报。
- Markdown 编辑与实时预览，代码高亮（highlight.js / lowlight）、KaTeX 公式、Mermaid 图（内联渲染后随正文导出）、表格列宽、图注、目录、富文本块。
- 生成满足微信正文约束的 HTML（标签/样式内联、缩进与空格合规处理），导出时保留正文实体与图片地址。

**图片与封面**

- 正文图片自动压缩重编码到 1 MiB 以内并上传 `media/uploadimg`，逐张替换占位符；单张失败不阻断草稿创建，会汇总失败数量提示补图。
- 封面通过 `material/add_material` 上传为永久素材（10 MiB 以内），支持 2.35:1 与 1:1 居中裁剪参数。
- 内置公众号素材库选择器，分页读取已有图片（每页最多 20 张）。
- 图片 data URL 严格校验，单图 ≤ 20 MiB、`sharp` 限制 40M 像素，防止超大输入。

**发布与草稿**

- 从编辑器命令「发布当前文章」进入时，通过 `readDocument`（`documents.export`）读取当前文章快照作为插件自己的发布稿；也可直接粘贴 Markdown。
- 编辑、封面和排版设置自动保存到插件私有数据（700 ms 防抖 + 宿主保存钩子），**不覆盖原文**。
- 页面显示“本地发布稿已保存”；失败时保留内容并可“重试保存”。本地保存不创建微信后台草稿；账号设置仍需保存。
- 大稿件分段传输：96 KiB 分片、总量 ≤ 32 MiB、顺序校验、5 分钟过期、最多 4 个在途传输；读取时用 SHA-256 校验一致性，内容变更会拒绝续读。
- 调用 `draft/add` 创建草稿，返回草稿 ID 与图片上传结果。标题 1–64 字符、摘要截断至 120 字符。

---

## 架构

```
浏览器视图 (src/ui, React + Vite)
   │  blc-plugin-sdk/browser  →  connect() / commands.invoke / tasks.get
   │  分段桥接：transfer.put → article.save / article.read → draft.create
   ▼
后台插件进程 (src/main.ts + src/publishing-store.ts + src/wechat.ts, Node ESM)
   │  definePlugin(ctx) 注册 11 个命令，ctx.credentials 存取密钥
   ▼
微信公众号官方 API (api.weixin.qq.com，可走 HTTP(S) 代理)
```

- `package.json` 的 `biglazycat` 字段是**唯一清单**：命令、菜单、视图、入口、平台都在这里声明。
- 后台入口编译为 `dist/main.js` + `dist/publishing-store.js` + `dist/wechat.js`；页面入口为 `dist/ui/index.html`（两个视图 `publish` / `settings` 共用一个 HTML，按路由切换）。
- 宿主单次命令结果上限 1 MiB，因此所有大数据都走插件自己的分段协议，不塞进任务结果。

### 目录结构

```
├─ src/
│  ├─ main.ts                     后台入口：命令注册、配置/凭据；publishing-store.ts 负责发布稿与传输
│  ├─ wechat.ts                   微信 API 客户端：token、图片、素材、草稿、错误脱敏
│  └─ ui/
│     ├─ main.tsx / index.html    页面入口与视图状态
│     ├─ bridge/publishing-api.ts SDK 桥接与分段读写封装
│     ├─ features/               发布面板、账号设置、素材选择器
│     ├─ lib/                    内容模型、主题、微信 HTML / 排版导出
│     ├─ themes/                 10 套排版主题 CSS
│     └─ i18n/                   zh-CN / en-US 文案资源
├─ tests/wechat.test.mjs          后台集成测试（本地模拟微信服务器）
├─ dist/                         构建产物（不提交）
├─ package.json / package-lock.json
└─ vite.config.mjs / tsconfig*.json
```

### 命令清单

| 命令 ID | 标题 | AI 可调用 | 外部副作用 |
| --- | --- | --- | --- |
| `publish.open` | 发布当前文章 | 是 | 否 |
| `debug.status` | 检查插件状态 | 是 | 否 |
| `config.read` | 读取账号状态 | 否 | 否 |
| `config.save` | 保存账号配置 | 否 | 否 |
| `connection.test` | 测试连接 | 否 | 否 |
| `connection.ip` | 检查微信 IP 白名单 | 否 | 否 |
| `materials.list` | 读取封面素材 | 否 | 否 |
| `draft.create` | 创建公众号草稿 | 否 | **是** |
| `transfer.put` | 传输发布内容 | 否 | 否 |
| `article.save` | 保存本地发布稿 | 否 | 否 |
| `article.read` | 读取本地发布稿 | 否 | 否 |

命令面板仅提供「发布当前文章」与「公众号账号设置」。除 `publish.open` 外，其余命令均为内部调用，由插件页面提供操作与结果；`debug.status` 仍允许 AI 调用。只有 `draft.create` 会真正写远端数据，且只创建草稿；`debug.status` 明确返回 `publicPublishing: false`。

---

## 快速开始

### 方式一：作为用户安装

1. 启动大懒猫创作平台，在插件页安装并启用本插件。
2. 打开「公众号账号设置」，填写 AppID 和 AppSecret，按需填写代理地址。
3. 点击「检查微信 IP 白名单」。若微信拒绝当前出口，将提示中的 IP 加入微信开发者平台 → 公众号 → 开发 → 基本配置 → **IP 白名单**；公众号需已完成微信认证，否则草稿箱接口不可用。
4. 在编辑器执行「发布当前文章」（或工具栏按钮），选择主题、封面，预览后点「创建草稿」。
5. 到公众号后台草稿箱预览确认，再手动发表。

新版桌面端的发布页面顶部提供“返回原文章”，先保存本地发布稿，再定位到原文章标签；保存失败时会留在发布页。顶部不再显示重复的保存按钮，快捷键、关闭页面和重新加载仍会执行保存。

### 方式二：从源码开发

需要 Node >=22.23.3 <23.0.0 与大懒猫创作平台 API 1 修订 2。宿主按选定运行时的实际版本校验 engines；公众号插件的原生依赖仍须在目标系统验证。

```bash
npm ci               # 从锁文件安装本地 SDK 1.2.0 工件与其余依赖
npm run typecheck    # 前后台两份 tsconfig 的严格类型检查
npm run build        # tsc -p tsconfig.node.json && vite build
npm test             # node --test tests/*.test.mjs && vitest run
```

`npm run build` 生成 `dist/main.js`、`dist/publishing-store.js`、`dist/wechat.js` 与 `dist/ui/`；`dist/` 与 `node_modules/` 都不进版本库，`package-lock.json` 需要提交。

SDK 固定使用 `vendor/blc-plugin-sdk-1.2.0.tgz`，完整工件随源码和安装包分发；其他依赖首次安装仍需访问 npm registry。宿主按 `package-lock.json` 自动准备依赖，已有完整 `dist` 时跳过类型检查和构建。

### 方式三：外部 AI / MCP 开发

1. 在宿主「系统设置」配置 Node/npm，并启用 MCP 服务中的插件工具。
2. Codex 等外部编程工具连接应用的 `--mcp-stdio`，先读 `plugin_sdk` 与 `get_app_guide(section:"plugins")`；源码在本目录编辑。
3. 用 `plugin_project_run` 或上面的 npm 命令执行安装、类型检查、构建与测试。
4. 调用 `plugin_install`：

   ```json
   {
     "source": { "kind": "directory", "location": "D:\\blc-plugin-publish" },
     "development": true,
     "prepare": false,
     "trusted": true,
     "requestId": "唯一标识"
   }
   ```

5. 用 `plugin_task` 确认完成，再调用 `plugin_enable` 与 `plugin_open_view`。修改源码后宿主会自动类型检查、构建并刷新已打开页面；构建失败查看 `plugin_diagnostics` 与任务日志。停用插件会停止自动刷新，卸载保留源码。

---

## 凭据与数据安全

- AppSecret 只写入宿主提供的系统凭据存储（Windows 为用户绑定的 DPAPI，其他平台需配置系统凭据服务）。`account.json` 仅保存 `app_id`、`proxy_url`、`last_verified_at`，**不保存明文密钥**。
- `config.read` 返回的 `app_secret` 永远是空串，只用 `secret_configured` 表示是否已配置；更换 AppID 会清除旧密钥。
- 微信返回的错误信息会脱敏 AppSecret 与 `access_token` 后才会展示；配置文件以 `0600` 写入并原子替换。
- 代理地址仅允许不含账号密码的 HTTP(S)，避免凭据进入 URL；跟随重定向被禁用。
- 微信接口测试全部使用**本地模拟 HTTP 服务器**（`tests/wechat.test.mjs`），不会向真实账号创建草稿或公开发表；测试还断言密钥不落盘、大稿件可跨激活恢复。

> 插件是可信本地程序，宿主进程隔离不等于安全沙箱；请只安装你信任的插件。

---

## 约束与已知限制

- 不提交构建产物和依赖目录：`dist/`、`node_modules/`、`coverage/` 均被忽略；SDK 的固定 tgz 工件与锁文件需要提交。
- 单次命令结果受 SDK 的 1 MiB 限制；大于此值的内容必须走 `transfer.put` 分段协议。
- 需要公众号完成微信认证且出口 IP 在白名单内；网络不通时可通过代理地址排查。
- 封面与正文图片走微信接口上传，受微信侧体积/格式与调用频次限制，超出会返回明确错误。
- 插件只创建草稿，**不提供群发/定时发表**能力。
- README 提供完整中英文版本；`i18n` 内已有中英文文案资源，当前页面默认语言仍为中文。

---

## 发布版本

本插件是 `private` 工程，**不发布到 npm**，版本以 GitHub Release 的形式分发。仓库自带 `.github/workflows/release.yml`，打标签即自动完成构建、测试与发版。

发布步骤：

1. 更新 `package.json` 的 `version`，在 `CHANGELOG.md` 里补对应段落，提交并推送到 `main`。
2. 打标签并推送：`git tag -a v0.2.1 -m "blc-plugin-publish 0.2.1" && git push origin v0.2.1`。
3. 工作流自动执行 `npm ci` → `typecheck` → `build` → `test`，然后创建（或更新）GitHub Release，附上 `blc-plugin-publish-<version>.tgz` 与 `.sha256` 校验文件；Release notes 从 `CHANGELOG.md` 中该版本段落提取，末尾附提交对比链接。

约束与说明：

- 标签必须是 **`v` + `package.json` 版本**（例如版本 `0.2.1` 对应 `v0.2.1`），不一致时工作流直接报错退出。
- 只做构建验证：Actions 页面手动运行 **Release** 工作流、`tag` 留空，会跑完整检查并把产物上传为 workflow artifact，不会创建 Release。
- 产物是 `.tgz`，归档**顶层目录固定为 `package/`**（与 `npm pack` 一致）。桌面端解压时只剥离 `package/` 前缀，并要求 `package.json` 位于解压根目录；若用「包名-版本」作为顶层目录，安装会报找不到 `package.json`。
- 产物包含 `dist/`、`package.json`、`package-lock.json`、`vendor/` 中的 SDK 工件与文档，**不含 `node_modules`**。桌面端自动识别已有构建产物，只安装运行依赖，无需用户判断是否类型检查或构建。
- 该工作流只使用仓库自带的 `GITHUB_TOKEN`，不需要额外配置 npm token 或其他 secret。

---

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

SDK 包 [blc-plugin-sdk](https://github.com/biglazycat-writer/blc-plugin-sdk) 为 MIT。本仓库其余部分的授权方式待维护者确认，请勿默认按开源许可证使用。

## SDK 与平台支持

本工程固定使用 SDK 1.2.0 tgz 工件。页面调用通过 `waitForTask` 有限等待；超时后查询现有任务，不自动重新提交有副作用的操作。

构建目标为 ES2022 / Chromium 109 / Safari 16.4。当前更新在 Windows amd64 完成测试；平台声明与编译目标不代表所有系统 WebView、原生依赖均已完成实机验证。

## 0.2.1 与宿主要求

此版本需要大懒猫创作平台 API 1 修订 2。界面跟随宿主白天/黑夜模式，公众号排版与导出配色独立。命令面板仅显示“发布当前文章”和“公众号账号设置”；连接与 IP 白名单检查在账号设置页进行。

发布页与设置页分开加载，预览计算在界面提交后执行，输入期间合并重复计算。宿主插件诊断提供容器、资源加载、桥接和 UI 就绪耗时。SDK 1.2.0 以 vendor 中的固定 tgz 工件随插件分发，因此构建和安装不依赖另一个源码目录或尚未发布的 npm 版本。

白屏修复、返回原文章与打开页面后收起任务提示属于宿主能力，须配合包含这些修改的新版桌面端；仅升级插件安装包无法更新宿主界面。
