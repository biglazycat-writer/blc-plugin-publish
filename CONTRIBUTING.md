# 参与贡献

## 开发环境

- Node `>=22.23.3 <23.0.0`、npm `>=10.9.9 <11.0.0`，宿主支持 API 1 修订 1。
- 大懒猫创作平台，用于实际安装、启用和打开插件视图。
- 本工程不依赖桌面端源码；SDK 由 npm 包 `blc-plugin-sdk@1.1.0` 提供，`package-lock.json` 锁定版本，`npm ci` 需要能访问 npm registry。

```bash
npm install
npm run typecheck
npm run build
npm test
```

`npm test` 包含后台集成测试（`node --test`）与 UI 单元测试（`vitest run`）。后台测试读取 `dist/`，所以**修改后台代码后先 `npm run build` 再跑测试**。

## 改动规范

1. **清单与实现同步**：新增/删除命令时，同时更新 `package.json` 的 `biglazycat.contributes.commands` 与 `src/main.ts` 中的 `ctx.commands.register`；`aiCallable`、`externalEffect` 必须如实标注。只有确实写远端数据的命令才允许 `externalEffect: true`。
2. **写测试**：新功能与缺陷修复都要有对应测试。涉及微信接口的测试一律使用本地模拟服务器，禁止请求真实公众号、禁止创建真实草稿或群发。
3. **不提交生成物**：`dist/`、`node_modules/`、`coverage/` 不入库；`package-lock.json` 必须入库（含 SDK 版本与 integrity）。
4. **保持工程独立**：不要引入指向桌面端/其他工程的相对路径、软链接或 workspace 依赖；SDK 统一从 npm 安装，不再保留 `vendor` 副本。
5. **凭据安全**：AppSecret 只经 `ctx.credentials` 存取，不写入配置文件、日志或测试快照；错误信息需脱敏。不要把真实 AppID/AppSecret、代理账号密码或 token 提交进仓库。
6. **分段协议**：受宿主单次结果 1 MiB 限制，大数据继续走 `transfer.put` / `article.read` 的分片与 hash 一致性校验，不要绕过限制直接返回大结果。
7. **不做兼容层**：废弃路径直接删除，保持实现简单；不做无关重构。
8. **文档**：用户可见行为、命令、限制或环境要求有变化时，同步更新 `README.md`、`README.en.md` 与 `CHANGELOG.md`。

## 提交与 PR

- 提交信息用简短的中文或英文说明「改了什么、为什么」，一个提交只做一件事。
- PR 中请附上：改动说明、验证过的命令与结果、涉及的宿主版本；若改动了插件清单或分段协议，说明对已安装插件的影响。
- 提交前自检：

  ```bash
  git status --short
  npm run typecheck && npm run build && npm test
  ```

- 不要提交本机 `account.json`、`article-*.json` 或任何账号数据。
