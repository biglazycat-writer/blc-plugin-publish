/**
 * 主题模型。
 *
 * 只有**一套**主题：编辑器用它渲染正文，公众号发布时把同一份 CSS 收进导出作用域
 * 再内联成 style 属性。不再有「基础主题」和「版式模板」两个概念。
 *
 * 主题文件是纯 CSS，**不带根前缀** —— 注入时由 `scopeThemeCss` 按目标补
 * （编辑器补 `.neEditorContent .ProseMirror`，导出补 `#nice-export`）。
 *
 * 编写约定（决定同一份 CSS 能否在两边都命中）：
 *
 *  1. 用**裸标签**选择器（p / h1 / h2 / blockquote / ul / ol / pre / code / table / img / hr / a）。
 *  2. 需要「块」语义时用 `pm-*` 类名，两边都会命中：
 *     `.pm-block` `.pm-paragraph` `.pm-heading-1..6` `.pm-readable-block`
 *     `.pm-lead-paragraph` `.pm-first-block` `.pm-blockquote` `.pm-list-block`。
 *  3. **不要写 `.pm-heading-1 h1` 这种后代选择器** —— 编辑器里带类名的元素就是 h1 本身，
 *     没有内部 h1，这类规则在编辑器里永远不命中。
 *  4. 不要用 CSS 变量、`@media`、`@keyframes`、`position: fixed|absolute|sticky`、
 *     `float`、`display: grid` —— 公众号导出时会被整体丢弃（见 wechat-html-compliance.ts），
 *     主题会在「编辑器好看、发出去变形」之间产生落差。
 *  5. 正文的行高、字间距、段间距（`p` / `li` / `blockquote` 上的那三个属性）会被读成
 *     编辑器设置面板里三个滑块的**默认值**（`readThemeRhythm`）：用户没拖过滑块时
 *     编辑器就用主题的值，拖过之后以用户的值覆盖（直到点「跟随主题」）。所以改这三个
 *     属性等于改编辑器里的默认排版，不只是改导出；`p` 与 `.pm-block` / `.pm-paragraph`
 *     同时出现时以后者为准（编辑器里装饰类特异性更高）。
 *  6. **不要写渐变**（`linear-gradient` / `radial-gradient` / `conic-gradient`，含
 *     `repeating-*`）。公众号排版规范 4.1.2 要求文字背景尽量不用渐变 —— 微信会把渐变底
 *     标成「文字背景渐变」、粘贴检查过不去，暗色模式下渐变底也不可控。两种最常见的用法：
 *       · 「荧光笔」`linear-gradient(transparent 62%, <色> 0)` 只盖文字底部一截
 *         → 改成实色 `background`；
 *       · 「同色渐变当纯色使」`linear-gradient(#x, #x)` 画短条 / 竖条 / 代码块标题栏
 *         → 改成内联 SVG data URI，几何形状能逐像素保住（URI 里不能用引号字符，
 *         见下面深色版之后的说明与 `builtin-themes.test.ts` 的守卫）。
 *     守卫测试 `builtin-themes.test.ts` 的「没有渐变」那条会拦住回潮。
 *
 * 深色版（可选）：主题文件里写一个内容为 `@dark` 的注释，之后的所有规则就是黑夜模式
 * 专用的颜色覆盖。这段**只进编辑器**，公众号导出永远用 `@dark` 之前的浅色版，所以
 * 它可以自由使用 `var()` 等导出侧会被丢弃的语法。没写这段的主题在黑夜模式下不套深色，
 * 而是把纸张钉回浅色（见 `LIGHT_PAPER_PIN`）—— 浅色版面在深色外壳里仍然自洽，
 * 也不会出现「深底深字」。
 */

import type { LayoutTokens } from '../wechat/layout/tokens'

/** 后端读出来的原始主题文件。元数据（名字/描述/色板）由前端从 CSS 头部注释解析。 */
export type ThemeFile = {
  /** 同时是主题文件夹名。 */
  id: string
  /** 正文样式（编辑器 + 公众号导出）。 */
  css: string
  /** 界面层颜色 token（`ui.css`）。可选，缺了就是空串。 */
  ui: string
  /** 内置主题：应用启动时从嵌入资源释放到主题目录。 */
  builtin: boolean
}

export type EditorThemePreview = {
  accent: string
  bg: string
  /** 装饰用的第二色。 */
  accentSecondary?: string
}

/**
 * 主题的正文排版节奏：编辑器里正文的行高、字间距与段间距。
 *
 * **单位与编辑器设置面板一致**，不是 CSS 单位：行高是倍数，字间距与段间距是 em。
 * 这样设置面板可以直接把它当作滑块的默认位置显示。
 *
 * 值是从主题 CSS 的正文规则里读出来的（见 `readThemeRhythm`），所以主题作者改
 * `p { line-height }` 就等于改了编辑器里的默认节奏，不需要在第二个地方再声明一次。
 *
 * 用途只有一个：**设置面板里没被用户拖过的滑块，显示并采用主题的节奏**。
 * 用户拖过之后就以用户的值覆盖（见 `EditorPreferences` 里那三个可空字段）。
 */
export type ThemeRhythm = {
  lineHeight: number
  letterSpacing: number
  paragraphSpacing: number
}

/** 主题没写正文排版、或者根本没套主题时的节奏 —— 与设置面板的滑块默认值同源。 */
export const DEFAULT_THEME_RHYTHM: ThemeRhythm = {
  lineHeight: 1.85,
  letterSpacing: 0,
  paragraphSpacing: 1,
}

export type EditorTheme = {
  id: string
  name: string
  description: string
  /** 主题选择器上显示的能力标签，如「杂志风」「衬线」。 */
  tags: string[]
  /** 不带根前缀的外观 CSS（`@dark` 之前的浅色部分）。 */
  css: string
  /**
   * 黑夜模式的颜色覆盖：主题文件里 `@dark` 标记之后的规则。
   *
   * 空 = 这套主题没有深色版。编辑器在黑夜模式下会退回 `LIGHT_PAPER_PIN`
   * （纸张钉回浅色），而不是硬把浅色规则反转成深色。
   */
  darkCss?: string
  /**
   * 界面层的浅色段（`ui.css` 里 `@dark` 之前的部分）。
   *
   * 主题同时管**界面颜色**与**正文样式** —— 这是「一个主题决定整个产品外观」的
   * 全部含义。界面层只写颜色 token，注入到 `:root`（见 `buildUiThemeCss`）。
   * 缺省（用户从网上下载的、只有 theme.css 的主题）时界面落在
   * `styles/ui-base.css` 的底座上。
   */
  uiCss?: string
  /**
   * 界面层的黑夜段：`ui.css` 里 `@dark` 之后的 `:root` 规则，注入成
   * `:root[data-theme='dark']`。缺省时界面沿用底座的黑夜档。
   */
  uiDarkCss?: string
  /**
   * 磁盘上的完整文件内容：元数据头 + 浅色段 + `@dark` 段。
   *
   * `css` / `darkCss` 是拆解后的视图，写回文件必须用 `source`，否则元数据头
   * 和深色段会在保存时丢失。主题管理器的 CSS 编辑器直接查看、编辑它。
   * 测试夹具或内存构造的主题（如 `PLAIN_THEME`）可以缺省。
   */
  source?: string
  preview: EditorThemePreview
  /**
   * 正文排版节奏，从 CSS 的正文规则里读出来。
   *
   * 编辑器设置面板里「没被用户拖过」的滑块显示它；用户拖过之后由用户的值覆盖。
   * 它**不参与导出** —— 公众号导出直接用主题 CSS 自己的值（发布弹窗另有一套滑杆）。
   */
  rhythm: ThemeRhythm
  /** 内置主题为 true；用户从文件导入的为 false。 */
  builtin: boolean
  /**
   * 结构增强：封面、章节头、金句、目录的形状。
   *
   * 带这个字段的主题在**公众号导出**时会额外生成这些结构块（组件渲染管线），
   * 纯 CSS 表达不了「目录」这种需要真实元素列表的东西。编辑器正文目前只渲染
   * CSS 部分 —— 结构块尚未在编辑器里预览。
   */
  layout?: LayoutTokens
}

/** 所有主题共享的排版底座，先于主题 CSS 注入。 */
export const BASE_THEME_CSS = `
/*
 * 只放排版属性。这里刻意**不含 max-width / margin / padding / box-sizing**：
 * 主题会同时注入编辑器和公众号导出两个作用域，而 750px 居中那一套是公众号容器的
 * 约束 —— 放进编辑器会把正文卡成一条窄栏，页面宽度（A4 / 标准 / 宽屏）就失效了。
 * 导出的容器宽度由 #nice-export 上的内联样式负责，不依赖这条规则。
 *
 * 行距与字间距消费编辑器偏好变量（--editor-line-height / --editor-letter-spacing）：
 * 变量由编辑器容器提供，值是**「用户拖过的值 ?? 主题的正文节奏」**（见
 * EditorTheme.rhythm）。底座这里写 var 是给「主题没写正文排版」的主题兜底；
 * 主题自己写死的值仍然有效 —— 它是公众号导出用的，编辑器里由 writing.css 把变量
 * 抬到恒赢（见那条规则上的注释）。导出作用域里没有这些变量，主题的默认值照常生效。
 */
:root {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
  color: #3e3e3e;
  line-height: var(--editor-line-height, 1.9);
  letter-spacing: var(--editor-letter-spacing, 0.5px);
  /* 断行机会交给文种规则：CJK 可在字间断，拉丁只在词间断。原来的 break-all
     会把英文单词从中间折断（Claude → Cl / aude），长 URL 交给 overflow-wrap 兜底。 */
  word-break: normal;
  overflow-wrap: break-word;
  /* CJK 与拉丁/数字之间自动留出排版间距。默认值是 no-autospace，必须显式开启；
     不支持的引擎忽略此声明，退回今天的效果。 */
  text-autospace: normal;
}

.pm-block {
  margin: 0.58em 0;
  box-sizing: border-box;
}
.pm-heading-1 { margin-top: 1.35em; margin-bottom: 0.95em; }
.pm-heading-2 { margin-top: 1.1em; margin-bottom: 0.7em; }
.pm-heading-3 { margin-top: 0.85em; margin-bottom: 0.55em; }
.pm-heading-4, .pm-heading-5, .pm-heading-6 { margin-top: 0.75em; margin-bottom: 0.45em; }
.pm-blockquote,
.pm-code-block,
.pm-table-block {
  margin-top: 1em;
  margin-bottom: 1em;
}

p {
  font-size: 16px;
  line-height: var(--editor-line-height, 1.9);
  letter-spacing: var(--editor-letter-spacing, 0.5px);
  margin-top: var(--editor-paragraph-top, 0.25em);
  margin-bottom: var(--editor-paragraph-spacing, 0.6em);
  text-align: left;
  word-break: normal;
  overflow-wrap: break-word;
}

h1 {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 1px;
  margin-top: 1.2em;
  margin-bottom: 0.6em;
  text-align: center;
}
h2 {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.8px;
  margin-top: 1em;
  margin-bottom: 0.5em;
  text-align: left;
}
h3 {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.6px;
  margin-top: 0.8em;
  margin-bottom: 0.4em;
  text-align: left;
}
/* h4–h6 的兜底（2026-10-08 补）：以前这里没有声明，五、六级标题落到浏览器默认的
   0.83em / 0.67em，比正文小一大截，大纲层级是倒的。倍率与编辑器底座
   （writing.css 的 .neEditorContent .ProseMirror h1，18px 正文版）完全一致，
   只是按这里的 16px 正文换算：1.75 / 1.375 / 1.25 / 1.125 / 0.94 / 0.875。
   这两处必须同步改 —— 套主题时主题样式表后注入、同特异度取胜，真正生效的是这一份。 */
h4 {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.4px;
  margin-top: 0.75em;
  margin-bottom: 0.35em;
  text-align: left;
}
h5 {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.4px;
  margin-top: 0.7em;
  margin-bottom: 0.3em;
  text-align: left;
}
h6 {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.4px;
  margin-top: 0.7em;
  margin-bottom: 0.3em;
  text-align: left;
}

blockquote {
  margin: 0.8em 0;
  padding: 0.6em 1em;
  border-left: 4px solid #d0d0d0;
  background: #f8f8f8;
  line-height: var(--editor-line-height, 1.8);
  border-radius: 0 4px 4px 0;
}
blockquote p {
  margin-top: 0;
  margin-bottom: 0.3em;
  font-size: 15px;
  color: #666666;
}
blockquote p:last-child { margin-bottom: 0; }

ul, ol {
  margin: 0.6em 0;
  padding-left: 1.8em;
  line-height: var(--editor-line-height, 1.9);
}
li {
  font-size: 16px;
  margin-bottom: 0.2em;
  letter-spacing: var(--editor-letter-spacing, 0.5px);
}
li p { margin: 0; }

a {
  color: #576b95;
  border-bottom: 1px solid #576b95;
  text-decoration: none;
  /* 链接文本可能是一句英文（会断词）也可能是一条 URL（必须能断），
     anywhere 只在真放不下时才断。 */
  overflow-wrap: anywhere;
}

pre {
  margin: 1em 0;
  padding: 1em;
  background: #f8f8f8;
  border-radius: 5px;
  border: 1px solid #e8e8e8;
  font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", Menlo, Monaco, "Courier New", monospace;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  /* 代码块里的对齐靠等宽栅格，自动中西文间距会把注释挤歪。 */
  text-autospace: no-autospace;
}
pre code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
}
p code, li code {
  background: #f0f0f0;
  color: #c7254e;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", Menlo, Monaco, "Courier New", monospace;
  /* 绝对 px 而不是 0.9em：相对单位会算出 14.4，工具栏的字号框读 getComputedStyle
     并原样显示，用户会看到小数点。 */
  font-size: 14px;
  letter-spacing: 0;
  text-autospace: no-autospace;
}

.hljs-keyword { color: #708; }
.hljs-string { color: #a11; }
.hljs-number { color: #164; }
.hljs-comment { color: #8a8a8a; font-style: italic; }
.hljs-function { color: #05a; }
.hljs-title { color: #05a; }
.hljs-params { color: #3e3e3e; }
.hljs-built_in { color: #05a; }
.hljs-attr { color: #05a; }
.hljs-tag { color: #708; }
.hljs-name { color: #708; }
.hljs-selector-class { color: #05a; }
.hljs-selector-tag { color: #708; }
.hljs-literal { color: #164; }
.hljs-type { color: #05a; }
.hljs-meta { color: #8a8a8a; }

img {
  display: block;
  margin: 0.8em auto;
  max-width: 100%;
  border-radius: 4px;
}

hr {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 1.2em 0;
}

table {
  width: 100%;
  /* 表格默认 content-box：width: 100% 再加上主题给的边框会比容器宽 1~4px，
     公众号里会顶出一截横向滚动。边框算进宽度对任何主题都更稳。 */
  box-sizing: border-box;
  border-collapse: collapse;
  margin: 0.8em 0;
  font-size: 14px;
  line-height: 1.7;
}
table th, table td {
  border: 1px solid #e0e0e0;
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}
table th {
  background: #f5f5f5;
  font-weight: 700;
}

strong { font-weight: 700; letter-spacing: 0.5px; }
em { font-style: italic; }
del { text-decoration: line-through; }
`.trim()

/**
 * 排版底座的深色版。只重写 `BASE_THEME_CSS` 里**带颜色**的规则，不碰任何排版属性。
 *
 * 位置在主题自带的浅色规则**之后**、主题的 `@dark` 段**之前**：底座的颜色（正文色、
 * 引用卡、行内代码、代码块、表格、hljs）是所有主题共用的，集中在这里深色化一次，
 * 各主题的 `@dark` 段就只需要处理它自己声明的颜色。同时也是漏项的安全网 —— 主题的
 * `@dark` 段忘了某个选择器时，落到的至少是深色默认值，而不是浅色。
 *
 * 只在主题确实带 `@dark` 段时才注入。没有深色版的主题走 `LIGHT_PAPER_PIN`，
 * 不会被这里的通用深色覆盖掉自己的浅色身份。
 *
 * 它只进编辑器，所以不受「禁用 CSS 变量」那条约束；这里仍然写死颜色，是为了让
 * 各主题的 `@dark` 段有一组稳定的基准值可以覆盖。
 */
export const DARK_BASE_THEME_CSS = `
:root {
  color: #D4D4D4;
  background-color: #1B1B1B;
}

blockquote {
  border-left-color: #4A4A4A;
  background: #202020;
}
blockquote p { color: #A3A3A3; }

a { color: #7FA7E0; border-bottom-color: #7FA7E0; }

pre {
  background: #151515;
  border-color: #333333;
}

p code, li code { background: #2A2A2A; color: #E58FA8; }

.hljs-keyword { color: #C678DD; }
.hljs-string { color: #98C379; }
.hljs-number { color: #D19A66; }
.hljs-comment { color: #6B7280; }
.hljs-function { color: #61AFEF; }
.hljs-title { color: #61AFEF; }
.hljs-params { color: #ABB2BF; }
.hljs-built_in { color: #E6C07B; }
.hljs-attr { color: #D19A66; }
.hljs-tag { color: #E06C75; }
.hljs-name { color: #E06C75; }
.hljs-selector-class { color: #61AFEF; }
.hljs-selector-tag { color: #C678DD; }
.hljs-literal { color: #D19A66; }
.hljs-type { color: #E6C07B; }
.hljs-meta { color: #6B7280; }

hr { border-top-color: #3A3A3A; }

table th, table td { border-color: #3A3A3A; }
table th { background: #242424; }
`.trim()

/**
 * 主题没有深色版时的黑夜模式兜底：把纸张钉回浅色。
 *
 * 为什么不是「自动反转成深色」：主题是为一篇浅色文章设计的，把它的颜色机械变暗会
 * 得到一套既不像原主题、也不像应用深色的东西（朱红印章会变成灰块）。把纸钉成浅色，
 * 主题的版面**原样成立**，只是坐在一张深色书桌上 —— 代价是夜里仍是一张亮纸，换来的是
 * 「绝不会出现深底深字」。
 *
 * 两个细节：
 *  1. 它是**原样注入**的（不经过 `scopeThemeCss` 的作用域化），因为它自带应用自己的
 *     选择器 `.neEditorContent` / `.mdPreviewContent`，不是主题作者的 CSS。
 *  2. 必须排在主题的根规则**之前**。主题自己的 `background` / `background-color`
 *     （比如国风节日的宣纸底）与它同深度，靠加载顺序取胜 —— 排在后面，主题的纸色
 *     才压得住这里的白。
 *
 * 只覆盖「被深色 palette 变过、而主题管不到」的变量：应用界面用的语义色在深色下是
 * 亮色，直接落在白纸上会看不见（引用块的左边线、分隔线、占位符）。`--color-primary`
 * 故意不动 —— 链接色几乎每套主题都会自己声明，而应用主题色是产品身份，不该在这里
 * 被写死成某个具体色值。
 */
export const LIGHT_PAPER_PIN = `
.neEditorContent {
  --content-text: #1F2328;
  --text-primary: #111827;
  --text-tertiary: #4B5563;
  --text-faint: #9CA3AF;
  --border-subtle: rgba(0, 0, 0, 0.12);
  --border-strong: rgba(0, 0, 0, 0.26);
  background-color: #FFFFFF;
}

.mdPreviewContent {
  --content-text: #1F2328;
  --text-primary: #111827;
  --text-tertiary: #4B5563;
  --text-faint: #9CA3AF;
  --border-subtle: rgba(0, 0, 0, 0.12);
  --border-strong: rgba(0, 0, 0, 0.26);
  background-color: #FFFFFF;
}
`.trim()
