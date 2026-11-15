# 微信公众号发布（blc-plugin-publish）

大懒猫创作平台的微信公众号发布插件：把 Markdown 排版成微信图文，通过公众号官方接口送进草稿箱。最终发表由作者在公众号后台人工确认，插件不群发、不公开发表。

需要大懒猫创作平台 **0.4.5 及以上**（插件 API 1 修订 3）。公众号需完成微信认证，且出口 IP 在白名单内。

## 功能亮点

- **排版主题**：10 套内置主题（中国风、暗黑科技、毛玻璃、GitHub Markdown、LaTeX 学术、绿豆护眼、藕荷、摸鱼票根、清风杂志、先锋看报），支持代码高亮、KaTeX 公式、Mermaid 图表、图注与目录；
- **微信合规导出**：生成满足微信正文约束的 HTML，样式内联、缩进合规；
- **图片处理**：正文图片自动压缩上传，封面永久素材上传与 2.35:1 / 1:1 裁剪，素材库选择器；
- **官方接口发布**：大稿件分段传输（SHA-256 校验、32 MiB 上限），调用官方 `draft/add` 创建草稿；
- **本地发布稿**：编辑内容自动保存到插件私有数据，不覆盖原文章；保存失败可重试；
- **返回原文章**：先保存发布稿，再跳回原文章；原文上下文不完整时不显示按钮。

## 使用

1. 在插件中心安装并启用本插件；
2. 打开「公众号账号设置」，填写 AppID / AppSecret，按需填写代理地址；
3. 点「检查微信 IP 白名单」，把提示的出口 IP 加入公众号后台的 IP 白名单；
4. 在编辑器执行「发布当前文章」，选主题与封面，预览后点「创建草稿」；
5. 到公众号后台草稿箱预览确认，人工发表。

## 开发

```bash
npm ci             # 安装依赖（SDK 以 vendor 工件锁定）
npm run typecheck  # 前后台两份 tsconfig 严格类型检查
npm run build      # tsc 编译后台 + vite 打包页面
npm test           # 后台集成测试（本地模拟微信服务器）+ UI 单元测试
```

- 工程独立于桌面端源码：排版代码、主题与测试都在本仓库维护；命令清单以 `package.json` 的 `biglazycat` 字段为准；
- 只有 `draft.create` 有外部副作用（仅创建草稿），其余命令均为内部调用；
- 发布：更新 `package.json` 版本并补 `CHANGELOG.md` 段落，推送 `v*` 标签，GitHub Actions 自动构建、测试并创建 Release（附 `.tgz` 与 SHA-256）。

架构一览：

```
浏览器视图 (React + Vite)
   │  blc-plugin-sdk/browser  →  connect / commands.invoke
   ▼
后台插件进程 (Node ESM)：definePlugin 注册命令，凭据走系统凭据存储
   ▼
微信公众号官方 API (api.weixin.qq.com，可走 HTTP(S) 代理)
```

## 凭据与数据安全

- AppSecret 只写入宿主的系统凭据存储（Windows 为用户绑定的 DPAPI）；`account.json` 只存 AppID、代理地址与验证时间，不含明文密钥；
- 微信错误信息展示前脱敏密钥与 token；代理仅允许不含账号密码的 HTTP(S)，禁用重定向；
- 测试全部使用本地模拟微信服务器，不触真实账号。

## 已知限制

- 只创建草稿，不提供群发 / 定时发表；
- 封面与正文图片走微信接口上传，受微信侧体积、格式与调用频次限制；
- 页面文案当前默认中文（i18n 已含中英资源）；构建目标 ES2022 / Chromium 109 / Safari 16.4，Windows amd64 完成实测。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

SDK 包 [blc-plugin-sdk](https://github.com/biglazycat-writer/blc-plugin-sdk) 为 MIT。本仓库其余部分的授权方式待维护者确认，请勿默认按开源许可证使用。
