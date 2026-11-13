# 大懒猫创作平台插件 SDK v1

SDK 随桌面版提供本地副本，未在公共 npm 仓库发布。每个工程使用自己的 `vendor/plugin-sdk`，依赖声明为 `file:vendor/plugin-sdk`。

桌面安装包不携带 Node/npm。用户可在系统设置 → 运行环境选择本机安装，或下载经过 SHA-256 校验的应用专用版本；两种来源均检查下述固定版本。首次配置后可直接使用，切换运行环境前需要停止插件后台和任务。SDK 和加载器不依赖 Node 下载而缺失。

后台是 Node 22.23.3，npm 10.9.9。`export default definePlugin(async context => { ... })` 在激活期注册清单声明的全部命令与服务，可返回清理函数。JS/TS、ESM/CJS、标准 Node 文件/网络/子进程和兼容的原生包均在独立进程执行。TypeScript 使用工程的 `typecheck` 与 `build` 脚本，不使用类型擦除替代编译。

浏览器 `import { connect } from '@biglazycat/plugin-sdk/browser'; const sdk = await connect()`。也可直接从页面所在目录的 `./__sdk.mjs` 导入宿主桥接（同步 connect）。页面可用任意浏览器框架；禁止在浏览器直接导入 Node 模块。业务表单由插件开发。

命令返回宿主持有的任务。通过 `invocation.signal` 协作取消，通过 `invocation.progress()` 报告进度。取消、退出与超时可能留下 `uncertain` 的外部执行结果，不自动重试有副作用的操作。服务依赖在清单显式声明，服务调用传入 invocation 传播调用链；环路被拒绝。

浏览器用 `sdk.tasks.get(task.id)` 查询单个任务的状态和结果；只允许读取本插件任务。`sdk.tasks.list()`、插件列表和诊断中的任务历史仅返回摘要，以 `hasResult` 表示是否有结果，避免历史大结果挤满控制帧。插件页展开“结果 / 日志”和外部 MCP `plugin_task` 按需获取完整单任务结果。命令单次结果仍须小于 1 MiB；大稿件或图片由插件自行分段传输。

文档 API 针对明确的工作区、编辑器和文档身份。先 snapshot，再携带 revision、draftHash、唯一 operationId 调用 apply。变更经目标编辑器事务和现有保存流程，其他脏编辑器、外部修改或标签切换会产生冲突。超时后先查询 operation，不重复提交。Node 直接文件写入绕过这些保证。

配置最多 64 KiB，控制帧最多 1 MiB。大资源应分段读取。事件在应用运行期间通知已提交变化；没有永久送达或恰好一次保证。定时任务声明 skip/once，检查点跨应用重启保存，恢复后按策略跳过或补一次。

视图关闭释放桥接与渲染进程，不停止后台任务。setState 只存小型恢复状态；凭据放到后台 credentials。Windows 使用系统用户绑定的 DPAPI；其他平台需配置系统凭据服务后使用。插件是可信本地程序，进程隔离不是安全沙箱。

## 最小工程与编译

通过外部 MCP 的 `plugin_project_create` 在空目录生成普通工程，或自行创建 npm 工程。产品不内置源码编辑器。`package.json` 的 `biglazycat` 字段是唯一清单；完整签名见随 SDK 提供的 `manifest.schema.json` 与 `index.d.ts`。

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": "22.23.3" },
  "dependencies": { "@biglazycat/plugin-sdk": "file:vendor/plugin-sdk" },
  "devDependencies": { "typescript": "5.9.3", "@types/node": "22.19.0" },
  "scripts": { "typecheck": "tsc --noEmit", "build": "tsc" },
  "biglazycat": {
    "apiVersion": 1,
    "displayName": "我的插件",
    "main": "dist/main.js",
    "platforms": ["windows/amd64", "darwin/amd64", "darwin/arm64", "linux/amd64"],
    "contributes": {
      "commands": [{ "id": "hello", "title": "运行示例", "aiCallable": true }]
    }
  }
}
```

使用 `.npmrc` 的 `install-links=true` 将本地 SDK 安装成物理副本。提交工程的 `package-lock.json`、源码、构建脚本和测试，排除 `node_modules`。平台准备流程执行锁定版本的 `npm ci`；外部编程工具执行 `npm install` 或 MCP `plugin_project_run(script:"install")` 可更新锁文件。“类型检查”和“构建”分别报告，不会将 Node 类型擦除当作 TS 编译。

```ts
import { definePlugin } from '@biglazycat/plugin-sdk'

export default definePlugin(ctx => {
  ctx.commands.register('hello', async (_args, invocation) => {
    invocation.signal.throwIfAborted()
    await invocation.progress(0.5, '正在处理')
    return { message: '你好，大懒猫创作平台！' }
  })
  return async () => { /* 释放自己创建的连接、监听器等 */ }
})
```

所有命令和服务必须在激活时注册且与清单一致。不要在首次调用时再补注册。纯页面插件可省略 `main`；后台插件不必创建页面。普通 Node ESM/CJS 和动态导入均可使用，原生模块必须匹配系统、架构与 Node ABI。TS 路径别名、JSX/TSX 与 UI 打包遵循所选工具链。

## 页面、草稿与保存

`contributes.views` 中的每个页面声明 `id/title/entry/defaultLocation`。`entry` 指向普通 HTML 产物，可由 Vite、React、Vue 等构建。页面中的 `@biglazycat/plugin-sdk/browser` 提供异步 `connect()`，不导入 Node 入口。

```ts
import { connect } from '@biglazycat/plugin-sdk/browser'
const sdk = await connect()
const view = await sdk.context()
let draft = view.state ?? { text: '' }

async function edited(text: string) {
  draft = { text }
  await sdk.setState(draft, true)
}

sdk.onSave(async () => {
  // 先将内容提交到自己的资源；失败要抛出错误，保持 dirty。
  await persistDraft(draft)
  await sdk.setState(draft, false)
})
```

`persistDraft` 是插件自身的持久化函数；自定义文件编辑器可以使用下节 `workspace.import`。页面状态是最多 64 KiB 的 JSON 检查点，不是任意文件数据库。宿主保存 `pluginId/viewId/instanceId/workspaceId/resource` 关联，防止恢复到其他文件。状态写入只保留一个在途请求和一个最新快照；同批写入共享完成结果，保存确认等待已提交状态。

浏览器最多 32 个在途 SDK 请求，宿主每个页面最多 16 个并发处理。桥接超时或连接失效时向用户显示错误，不盲目重放副作用。后台的 `ctx.views.close(instanceId)` 拒绝关闭脏页面，用户保存或放弃通过应用外壳处理。

主题由 `view.theme` 的 CSS 变量提供并动态更新。页面只能访问自己的视图会话与已有 SDK，不能调用宿主任意 Wails 方法。后台需要完整文件/网络能力时使用 Node API。

`sdk.ui.openExternal(url)` 在系统默认浏览器打开 HTTP(S) 链接。插件原生页面保持自己的来源边界；用户点击外部服务或账号控制台链接时使用此接口。

## 内容与资源身份

核心文档先 `documents.snapshot({workspaceId,workspaceSession,documentId,editorId,windowId})`，再用返回的 `revision/draftHash` 和新的 `operationId` 调用 `documents.apply`。文档、标签、工作区、草稿或持久化版本改变会产生可见冲突。目标编辑器通过现有事务与保存协调器提交，保留该编辑器已有的撤销能力，不承诺任意跨文件副作用可撤销。

自定义 UTF-8 文件先 `workspace.read`，携带完整读取结果的 `hash` 调用：

```ts
const result = await sdk.workspace.import({
  workspaceId, workspaceSession, path: 'notes/example.catnote',
  expectedHash: loadedHash, content: nextText, operationId: crypto.randomUUID(),
})
```

没有 `expectedHash` 表示创建新文件，不能用它覆盖已存在文件。核心文档已有内容必须经 `documents.apply`。资源变更限 700 KiB，读取单次至多 512 KiB、文本文件总量至多 16 MiB；更大或二进制资源可直接使用 Node 文件 API，并自行处理并发语义。

图片库使用 `images.list({query,offset,limit})` 分页，每页最多 100 张，返回 `id/name/src/width/height` 与 `total`。`images.read({src,offset,limit,hash})` 将图片转为 data URL 分段返回，每段最多 384 KiB、总量最多 28 MiB。将首段的 `hash` 传给后续读取，图片变化返回 `RESOURCE_CHANGED`。浏览器自动绑定页面的工作区身份；Node 端需传 `workspaceId/workspaceSession`。工作区切换后原页面的读取被拒绝。

`documents.operation(operationId)` 查询确认结果。相同 ID 与相同规范化参数返回原记录，不重复提交；不同参数被拒绝。崩溃后的未确认操作变为 `uncertain`。操作记录落盘失败时不报告确认完成。当前日志目录最多保留 10000 份操作回执，到上限拒绝新操作；没有自动删除去重记录或产品内归档入口，不能手工删除后重试历史操作。

## 服务、导出、事件与定时

`biglazycat.dependencies` 声明运行插件服务依赖，与 npm `dependencies` 分开。每项包含 `plugin/service/version/optional`。必需依赖缺失、版本不符或依赖环在启用/启动时拒绝；可选依赖不会自动启动不兼容版本，调用方处理不可用错误。

`ctx.services.provide('text', { transform })` 对应清单服务的方法；`ctx.services.call(plugin, service, method, args, invocation)` 传播调用链。服务调用限 20 秒、深度 8，环路返回错误。通用宿主导出契约为 `export.text` v1：服务 `transform({text, format: 'markdown', filename}, invocation)` 返回 `{text}`；用户选择提供者后才使用它，失败时不静默换回内置实现。

可订阅 `startup`、`workspace.opened`、`document.committed`、`plugin:<包名>:<事件名>`。`ctx.events.emit(name, payload)` 自动添加插件命名空间。工作区恢复也发送打开事件；通知只覆盖接入的提交路径，不是所有任意 Node 文件修改的广播。事件队列满时丢弃并记录事件 ID；消费者需要重新读取领域状态。

计划任务使用 `contributes.schedules` 的 `id/command/intervalSeconds/catchUp`，最短间隔由 Schema 校验。检查点写入安装索引，跨重启保留；超过间隔及 5 秒调度宽限后，`skip` 跳过、`once` 最多补一次；同命令未结束时不重叠触发。先保存检查点再调度，保存失败不执行；两步之间崩溃可能跳过一轮，但不会重放已占用的时间段。不安装系统常驻服务，也不保证恰好一次。事件订阅者可通过 `storage` 保存业务检查点，激活后重新读取领域状态；事件通知本身不是持久队列。

## 宿主工具与诊断

现有 AI 会话使用固定工具：`plugins_list`、`plugin_diagnostics`、`plugin_task`、`plugin_cancel`、`plugin_enable`、`plugin_open_view`、`plugin_sdk`、`plugin_project_create/files/read/write/run`、`plugin_install`、`plugin_invoke`。写操作沿用 AgentService 的审批和调用 ID；工具不会接受模型自行注入工作区上下文。再次收到相同工具调用 ID 时返回既有结果，未确认操作不重放。

标准错误码包括 `API_MISMATCH`、`NODE_MISMATCH`、`BACKPRESSURE`、`STALE_GENERATION`、`WORKSPACE_CHANGED`、`DRAFT_CONFLICT`、`DIRTY_VIEW`、`SAVE_TIMEOUT`、`OPERATION_CONFLICT`。任务历史由宿主持有，页面或 AI 对话关闭不结束后台任务。

运行上限：16 个插件后台、32 个页面、128 个未完成命令任务、8 个安装/开发准备任务；准备脚本串行且排队可取消。每个插件日志至多 500 条/256 KiB。默认 V8 堆 256 MiB，进程树资源阈值 512 MiB、整机 CPU 25%；Windows 使用 Job Object 硬配额，macOS/Linux 每秒采样，CPU 连续 10 次超限才停止。不能把 V8 堆限制或采样阈值称作所有平台的内存硬上限。

已运行后台异常退出后按 2 秒、4 秒退避，最多自动重启两次；仅重新激活，不重放命令、事件或外部操作。连续故障计数跨应用重启保留，达到上限后需用户明确启用或重启才重置。首次激活、版本切换失败以及必需依赖失效保持故障状态，用户处理后恢复。命令本身没有统一短总时限，心跳仅检测事件循环是否响应。取消超时会结束同一实例中的其他任务，故障 UI 可重载并恢复已提交检查点。

## 外部 MCP 与开发模式

在系统设置 → MCP 服务启用连接并勾选“插件开发与管理”工具。外部编程工具通过应用 `--mcp-stdio` 接入；先读取 `plugin_sdk` 和 `get_app_guide(section:"plugins")`。`plugin_project_create` 将 SDK 物理副本写入指定空目录，外部工具自行编辑文件，无需产品内工程管理界面。

依次用 `plugin_project_run` 的 lock/install/typecheck/build/test 脚本准备工程。写工具必须提供唯一 `requestId`；安装和执行工程脚本还需要 `trusted:true`。通过 `plugin_task` 读取完成状态，超时不重放副作用。`plugin_install({source:{kind:"directory",location:"绝对路径"},development:true,prepare:false,trusted:true,requestId:"唯一标识"})` 返回任务，成功后 `plugin_enable`、`plugin_open_view` 预览。

开发模式每秒检测源码，稳定两次后在隔离目录执行 typecheck/build，再切换成功产物并重新打开同一页面实例。dist、node_modules、.git、.cache、coverage 不触发构建；失败可从 plugins_list 的 development 和 plugin_task 查看，原成功页面保留。未完成任务和未保存页面会推迟刷新。依赖先在外部工程安装；切换源码、停用或卸载会停止后续自动刷新，卸载保留源码。凭据仅存后台 credentials，不能进入清单、源码或页面恢复状态。
