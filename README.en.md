# WeChat Official Account Publishing · 大懒猫创作平台 Plugin

[简体中文](README.md) | **English**

A plugin for [大懒猫创作平台](https://github.com/biglazycat-writer) that formats articles as WeChat-compatible HTML, processes body images and covers, and creates **drafts** through the official WeChat API. Final publication is confirmed manually in the WeChat account console. The plugin does not broadcast or publish articles publicly.

This is an independent npm project. The SDK comes from npm; formatting code, themes and tests are maintained within this repository. It does not import or link desktop application source files.

| Item | Value |
| --- | --- |
| Plugin ID / package | `blc-plugin-publish` |
| Plugin version | `0.1.0` |
| Host API | `biglazycat.apiVersion = 1`, `minimumApiRevision = 1` |
| SDK | `blc-plugin-sdk@1.1.0` |
| Runtime | Node `>=22.23.3 <23.0.0`, configured by the host |
| Declared platforms | Windows, macOS and Linux; amd64/arm64 |
| View stack | React 19, TypeScript, Vite 7 and Vitest |

## Features

**Account and connectivity.** Configure AppID/AppSecret and an optional HTTP(S) proxy without embedded credentials. Connection tests verify credentials and cache `access_token`, refreshing 300 seconds early and sharing concurrent token requests. Egress-IP detection interprets WeChat's `40164` response to help configure the IP allowlist. Common WeChat API errors are mapped to readable messages.

**Writing and formatting.** Edit Markdown and preview WeChat-compatible HTML with ten bundled layout themes. The renderer supports code highlighting, KaTeX, Mermaid rendered before export, table column widths, captions, a table of contents and rich-text blocks. Export inlines styles and preserves text entities and image URLs while applying WeChat HTML constraints.

**Images and covers.** Body images are re-encoded to at most 1 MiB and uploaded through `media/uploadimg`. A failed body image upload is reported without necessarily aborting the whole draft. Covers use the permanent-material endpoint with a 10 MiB limit and centered `2.35:1` / `1:1` crop metadata. The material picker loads up to 20 items per page. Input data URLs are validated, with a 20 MiB image limit and a 40-million-pixel `sharp` limit.

**Drafts and persistence.** “Publish current article” reads an immutable host Markdown export through `readDocument` / `documents.export`; the plugin does not parse the host's Tiptap snapshot. You can also paste Markdown directly. Editing, cover choices and layout settings are saved to private plugin data with a 700 ms debounce and host save callback. The source document is not overwritten. Large payloads use ordered chunks, a 32 MiB total limit, five-minute expiry, up to four in-flight transfers and SHA-256 checks when reading saved drafts. `draft/add` returns the draft ID and image results. Titles are limited to 1–64 characters, and summaries to 120 characters.

## Architecture

```text
Browser view: src/ui, React + Vite
  blc-plugin-sdk/browser → connect / commands.invoke / waitForTask
  transfer.put → article.save / article.read → draft.create
        ↓
Backend: src/main.ts + src/publishing-store.ts + src/wechat.ts
  definePlugin registers 11 commands; ctx.credentials stores secrets
        ↓
Official WeChat API: api.weixin.qq.com, optionally through an HTTP(S) proxy
```

`package.json` contains the only plugin manifest in `biglazycat`. Backend output includes `dist/main.js`, `dist/publishing-store.js` and `dist/wechat.js`. Both `publish` and `settings` views share `dist/ui/index.html`, selected by route. Host command results are limited to 1 MiB, so large payloads use the plugin's chunk protocol rather than a single task result.

```text
src/main.ts                    Command registration and account/credential orchestration
src/publishing-store.ts        Local JSON storage and incoming transfer management
src/wechat.ts                  WeChat tokens, images, materials, drafts and error redaction
src/ui/main.tsx                 View entry and state persistence
src/ui/bridge/publishing-api.ts SDK calls and chunked data transfer
src/ui/features/               Publishing, account settings and image/material pickers
src/ui/lib/                    Plugin-owned content model, themes and HTML export
src/ui/themes/                 Ten layout themes
src/ui/i18n/                   Chinese and English text resources
tests/                         Backend integration tests using a local mock server
dist/                          Generated output; excluded from version control
```

### Commands

| Command | Purpose | AI-callable | External effect |
| --- | --- | --- | --- |
| `publish.open` | Open the article publishing view | Yes | No |
| `debug.status` | Inspect plugin status | Yes | No |
| `config.read` | Read account configuration status | No | No |
| `config.save` | Save account configuration | No | No |
| `connection.test` | Test connectivity and credentials | No | No |
| `connection.ip` | Detect the egress IP | No | No |
| `materials.list` | List cover materials | No | No |
| `draft.create` | Create a WeChat draft | No | **Yes** |
| `transfer.put` | Upload a payload chunk to the backend | No | No |
| `article.save` | Save a local publishing draft | No | No |
| `article.read` | Read a local publishing draft | No | No |

Only `draft.create` writes remote content, and it creates a draft. `debug.status` explicitly returns `publicPublishing: false`.

## Install and use

1. Start 大懒猫创作平台 and install/enable the plugin from its plugin page.
2. Open the account settings view and enter AppID/AppSecret, plus a proxy if needed.
3. Use egress-IP detection and add the address to the account's **IP allowlist** in the WeChat developer console. The account must meet WeChat's verification requirements for draft APIs.
4. Run “Publish current article” from the editor/menu, choose a theme and cover, preview the result and create a draft.
5. Review the draft in the WeChat account console and publish it manually.

## Develop from source

Use Node `>=22.23.3 <23.0.0`, npm `>=10.9.9 <11.0.0` and a host supporting API 1 revision 1. The host checks the actual selected Node against `engines.node`; native dependencies still need validation on each target system.

```bash
npm ci                 # Install published SDK 1.1.0 and the locked dependencies
npm run typecheck      # Check browser and backend TypeScript
npm run build          # Compile the backend and bundle the view
npm test               # Backend integration tests and Vitest UI tests
```

Tests use built backend output, so build before testing. Exclude `dist/`, `node_modules/` and coverage from commits; commit `package-lock.json`. The SDK is installed from npm, without a vendor copy or cross-project source dependency. Initial installation requires registry access. The host's preparation flow also uses `npm ci`.

### External coding tools and MCP

1. Configure Node/npm and enable the host's MCP plugin tools.
2. Connect your tools through `--mcp-stdio`, then read `plugin_sdk` and `get_app_guide(section:"plugins")`.
3. Use npm or `plugin_project_run` for installation, type checking, build and tests.
4. Call `plugin_install` with the local project path:

   ```json
   {
     "source": { "kind": "directory", "location": "D:\\blc-plugin-publish" },
     "development": true,
     "prepare": false,
     "trusted": true,
     "requestId": "unique-request-id"
   }
   ```

5. Confirm completion with `plugin_task`, then use `plugin_enable` and `plugin_open_view`. Source changes trigger type checking, building and view refresh. Failed builds keep the last working artifact; read diagnostics and task logs. Disabling stops automatic refresh, while uninstalling preserves source.

## Credentials and private data

AppSecret is written only through the host's credential API. Windows uses user-bound DPAPI; other platforms need a system credential service. `account.json` stores only AppID, proxy URL and verification time. `config.read` always returns an empty secret string and uses `secret_configured` to indicate whether a secret exists. Changing AppID clears the old secret.

WeChat errors redact AppSecret and access tokens before display. Local JSON writes use mode `0600` and atomic replacement. Proxy URLs must be HTTP(S) without embedded credentials, and redirects are disabled.

WeChat API tests use a local HTTP mock server. They do not contact real accounts, create remote drafts or publish articles. Tests also cover secret-free account files, large draft restoration, Markdown export and bounded task waiting. Install only plugins you trust: process isolation is not a security sandbox.

## Limits and platform support

- The account must satisfy WeChat's verification and IP-allowlist requirements. WeChat's file, API-rate and format limits still apply.
- Payloads larger than the host's 1 MiB command-result limit use chunked transfer. View task waiting is bounded; query an existing task after timeout instead of replaying a remote write.
- The plugin creates drafts only. It does not provide broadcasting or scheduled public publication.
- Both README languages are provided. Chinese and English UI resources exist, while the current view defaults to Chinese.
- View syntax targets are ES2022 / Chromium 109 / Safari 16.4. This update was tested on Windows amd64. Declared platforms and build targets do not replace native WebView and dependency tests on the other systems.

## Contributing and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md), currently in Chinese. Keep both README versions aligned when behavior changes.

The [SDK](https://github.com/biglazycat-writer/blc-plugin-sdk) is MIT licensed. Licensing for the rest of this repository has not been specified by its maintainer; do not assume the entire project uses the SDK's license.
