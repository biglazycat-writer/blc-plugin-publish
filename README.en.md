# WeChat Publishing (blc-plugin-publish)

[简体中文](README.md) | **English**

A BigLazyCat Writer plugin that formats Markdown into WeChat-compatible articles and delivers them to the Official Account draft box through the official WeChat API. Final publication is always confirmed manually in the WeChat console — the plugin never broadcasts or publishes publicly.

Requires BigLazyCat Writer **0.4.5 or newer** (plugin API 1, revision 3). The account must be WeChat-verified, with the egress IP on the allowlist.

## Highlights

- **Layout themes**: 10 bundled themes (Chinese classic, dark tech, frosted glass, GitHub Markdown, LaTeX academic, green-bean eye care, lotus, ticket stub, breeze magazine, newspaper press) with code highlighting, KaTeX formulas, Mermaid diagrams, captions and a table of contents;
- **WeChat-compliant export**: body HTML that satisfies WeChat's constraints, with inlined styles and conforming indentation;
- **Image handling**: automatic compression and upload of body images, permanent cover assets with 2.35:1 / 1:1 cropping, and a library picker;
- **Official API publishing**: large articles transferred in segments (SHA-256 verified, 32 MiB cap), drafts created through the official `draft/add`;
- **Local publishing draft**: edits auto-save to plugin-private data without touching the source article; failed saves offer a retry;
- **Back to the article**: saves the draft first, then jumps back; the button only shows when the source context is complete.

## Usage

1. Install and enable the plugin in the plugin center;
2. Open the account settings, enter AppID / AppSecret and an optional proxy;
3. Run "Check WeChat IP allowlist" and add the reported egress IP to the allowlist in the WeChat console;
4. Run "发布当前文章" (Publish current article) from the editor, pick a theme and cover, preview and create the draft;
5. Review the draft in the WeChat console and publish manually.

## Development

```bash
npm ci             # install dependencies (SDK locked as a vendor artifact)
npm run typecheck  # strict typecheck for backend and view
npm run build      # tsc for the backend + vite bundle for the view
npm test           # backend integration tests (local mock WeChat server) + UI unit tests
```

- The project is independent of desktop sources: formatting code, themes and tests live in this repository; the command list is the `biglazycat` field in `package.json`;
- Only `draft.create` has an external effect (it creates a draft); all other commands are internal;
- Releases: bump the version, add a CHANGELOG section, push a `v*` tag — GitHub Actions builds, tests and publishes the Release (`.tgz` plus SHA-256).

Architecture at a glance:

```
Browser view (React + Vite)
   │  blc-plugin-sdk/browser  →  connect / commands.invoke
   ▼
Backend plugin process (Node ESM): definePlugin registers commands; secrets go to the system credential store
   ▼
Official WeChat API (api.weixin.qq.com, optional HTTP(S) proxy)
```

## Credentials and data safety

- AppSecret is written only to the host's system credential store (user-bound DPAPI on Windows); `account.json` holds only the AppID, proxy URL and verification time — never the secret;
- WeChat error messages are redacted before display; the proxy must be HTTP(S) without embedded credentials and redirects are disabled;
- Tests run entirely against a local mock WeChat server and never touch real accounts.

## Known limitations

- Drafts only — no broadcasting or scheduled publication;
- Cover and body image uploads follow WeChat's size, format and rate limits;
- View copy currently defaults to Chinese (English resources are included); build targets are ES2022 / Chromium 109 / Safari 16.4, tested on Windows amd64.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

The [blc-plugin-sdk](https://github.com/biglazycat-writer/blc-plugin-sdk) package is MIT. Licensing for the rest of this repository is pending the maintainer's decision — do not assume the whole project is open source.

## Choosing feature locations

Open plugin details in BigLazyCat Writer to choose where each declared feature appears. This plugin defines its features and supported locations in `contributes.features`; users choose among those locations. See the SDK [feature reference](https://github.com/biglazycat-writer/blc-plugin-sdk/blob/main/FEATURES.md) for the declaration format.
