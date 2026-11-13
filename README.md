# 微信公众号发布 · 大懒猫创作平台插件

[大懒猫创作平台](https://github.com/biglazycat-writer) 的官方 API 版公众号发布插件。把编辑器里的文章排版成符合微信公众号要求的 HTML，处理正文图片与封面，通过公众号官方接口创建**草稿**；最终发表仍由作者在公众号后台人工确认，插件不群发、不公开发表。

本仓库是一个**独立的 npm 工程**：SDK、排版代码、主题和测试都是本工程内的物理副本，不引用、不软链接、不依赖桌面端源码。

| 项目 | 值 |
| --- | --- |
| 插件 ID / 包名 | `blc-plugin-publish` |
| 版本 | `0.1.0` |
| 插件 API | `biglazycat.apiVersion = 1` |
| 运行环境 | Node `22.23.3`（宿主提供，安装包不内嵌 Node） |
| 支持平台 | Windows amd64/arm64、macOS amd64/arm64、Linux amd64/arm64 |
| UI 技术 | React 19 + TypeScript + Vite 7 + Vitest |

---

## 功能

**账号与连接**

- 在「账号设置」页填写 AppID / AppSecret，可配置不含账号密码的 HTTP(S) 代理。
- 「测试连接」验证凭据并缓存 `access_token`（提前 300 秒过期，并发请求共用一次取 token）。
- 「检测 IP」从微信 `40164` 错误中解析出口 IP，提示加入公众号 IP 白名单；带代理时标记出口来源。
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

- 从编辑器命令「发布当前文章」进入时，通过 `documents.snapshot` 读取当前文章快照作为插件自己的发布稿；也可直接粘贴 Markdown。
- 编辑、封面和排版设置自动保存到插件私有数据（700 ms 防抖 + 宿主保存钩子），**不覆盖原文**。
- 大稿件分段传输：96 KiB 分片、总量 ≤ 32 MiB、顺序校验、5 分钟过期、最多 4 个在途传输；读取时用 SHA-256 校验一致性，内容变更会拒绝续读。
- 调用 `draft/add` 创建草稿，返回草稿 ID 与图片上传结果。标题 1–64 字符、摘要截断至 120 字符。

---

## 架构

```
浏览器视图 (src/ui, React + Vite)
   │  @biglazycat/plugin-sdk/browser  →  connect() / commands.invoke / tasks.get
   │  分段桥接：transfer.put → article.save / article.read → draft.create
   ▼
后台插件进程 (src/main.ts + src/wechat.ts, Node ESM)
   │  definePlugin(ctx) 注册 11 个命令，ctx.credentials 存取密钥
   ▼
微信公众号官方 API (api.weixin.qq.com，可走 HTTP(S) 代理)
```

- `package.json` 的 `biglazycat` 字段是**唯一清单**：命令、菜单、视图、入口、平台都在这里声明。
- 后台入口编译为 `dist/main.js` + `dist/wechat.js`；页面入口为 `dist/ui/index.html`（两个视图 `publish` / `settings` 共用一个 HTML，按路由切换）。
- 宿主单次命令结果上限 1 MiB，因此所有大数据都走插件自己的分段协议，不塞进任务结果。

### 目录结构

```
├─ src/
│  ├─ main.ts                     后台入口：命令注册、配置/凭据、发布稿存储、分段传输
│  ├─ wechat.ts                   微信 API 客户端：token、图片、素材、草稿、错误脱敏
│  └─ ui/
│     ├─ main.tsx / index.html    页面入口与视图状态
│     ├─ bridge/publishing-api.ts SDK 桥接与分段读写封装
│     ├─ features/               发布面板、账号设置、素材选择器
│     ├─ lib/                    内容模型、主题、微信 HTML / 排版导出
│     ├─ themes/                 10 套排版主题 CSS
│     └─ i18n/                   zh-CN / en-US 文案资源
├─ tests/wechat.test.mjs          后台集成测试（本地模拟微信服务器）
├─ vendor/plugin-sdk/            SDK v1 物理副本（含 LICENSE、schema、说明）
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
| `connection.ip` | 检测出口 IP | 否 | 否 |
| `materials.list` | 读取封面素材 | 否 | 否 |
| `draft.create` | 创建公众号草稿 | 否 | **是** |
| `transfer.put` | 传输发布内容 | 否 | 否 |
| `article.save` | 保存本地发布稿 | 否 | 否 |
| `article.read` | 读取本地发布稿 | 否 | 否 |

只有 `draft.create` 会真正写远端数据，且只创建草稿；`debug.status` 明确返回 `publicPublishing: false`。

---

## 快速开始

### 方式一：作为用户安装

1. 启动大懒猫创作平台，在插件页安装并启用本插件。
2. 打开「公众号账号设置」，填写 AppID 和 AppSecret，按需填写代理地址。
3. 点击「检测 IP」，把得到的出口 IP 加入微信开发者平台 → 公众号 → 开发 → 基本配置 → **IP 白名单**；公众号需已完成微信认证，否则草稿箱接口不可用。
4. 在编辑器执行「发布当前文章」（或工具栏按钮），选择主题、封面，预览后点「创建草稿」。
5. 到公众号后台草稿箱预览确认，再手动发表。

### 方式二：从源码开发

需要 Node 22.x 与大懒猫创作平台（提供插件 SDK 与运行环境）。清单 `engines.node` 固定声明 `22.23.3`，宿主的平台准备流程会校验这个版本；本机开发用相近的 22.x（例如 22.22.x）也能正常构建和测试。

```bash
npm install          # .npmrc 的 install-links=true 会把本地 SDK 装成物理副本
npm run typecheck    # 前后台两份 tsconfig 的严格类型检查
npm run build        # tsc -p tsconfig.node.json && vite build
npm test             # node --test tests/*.test.mjs && vitest run
```

`npm run build` 生成 `dist/main.js`、`dist/wechat.js` 与 `dist/ui/`；`dist/` 与 `node_modules/` 都不进版本库，`package-lock.json` 需要提交。

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

- 不提交构建产物和依赖：`dist/`、`node_modules/`、`coverage/` 均被忽略；`vendor/plugin-sdk` 作为物理副本随仓库提交。
- 单次命令结果受 SDK 的 1 MiB 限制；大于此值的内容必须走 `transfer.put` 分段协议。
- 需要公众号完成微信认证且出口 IP 在白名单内；网络不通时可通过代理地址排查。
- 封面与正文图片走微信接口上传，受微信侧体积/格式与调用频次限制，超出会返回明确错误。
- 插件只创建草稿，**不提供群发/定时发表**能力。
- 仓库内容为中文文档优先，`i18n` 内已备有中英文文案资源。

---

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

`vendor/plugin-sdk` 自带其 [LICENSE](vendor/plugin-sdk/LICENSE)。本仓库其余部分的授权方式待维护者确认，请勿默认按开源许可证使用。
