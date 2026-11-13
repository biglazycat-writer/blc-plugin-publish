/**
 * 主题注册表。
 *
 * 只有一套主题：编辑器与公众号导出共用。区别只在于注入时套哪个作用域
 * （见 `scope.ts`）。
 */

import { getLayoutTheme } from '../wechat/layout/layout-themes'
import { EDITOR_THEME_SCOPE, EXPORT_THEME_SCOPE, retargetRoot, scopeRootRules, scopeThemeCss } from './scope'
import { readThemePaperBackground } from './theme-parse'
import {
  BASE_THEME_CSS,
  DARK_BASE_THEME_CSS,
  DEFAULT_THEME_RHYTHM,
  LIGHT_PAPER_PIN,
  type EditorTheme,
} from './types'

export * from './scope'
export * from './types'
export * from './overrides'
export * from './theme-parse'

/**
 * 默认主题（原来是「磨砂玻璃」，现在是「默认主题」）。
 *
 * 新装、旧配置里的空 id、以及当前主题已被删除时都落到它身上 —— 产品始终有一套
 * 完整的主题在外观上，不会出现「界面有主题、正文裸奔」的半套状态。
 */
export const DEFAULT_EDITOR_THEME_ID = 'frostedGlass'

/**
 * 从列表里挑一个主题。
 *
 * 空 id、或者 id 指向一个已经不存在的主题（比如主题文件夹被删了），都返回
 * `undefined` —— 调用方按 `DEFAULT_EDITOR_THEME_ID` 兜底。
 */
export function findTheme(
  id: string | null | undefined,
  themes: EditorTheme[],
): EditorTheme | undefined {
  const wanted = (id ?? '').trim()
  if (!wanted) return undefined
  return themes.find((theme) => theme.id === wanted)
}

/**
 * 默认主题也被删掉时的兜底：只有排版底座，没有任何主题装饰。
 */
export const PLAIN_THEME: EditorTheme = {
  id: DEFAULT_EDITOR_THEME_ID,
  name: '默认主题',
  description: '编辑器默认排版，不套用扩展主题',
  tags: [],
  css: '',
  source: '',
  preview: { accent: '#64748B', bg: '#ffffff' },
  rhythm: DEFAULT_THEME_RHYTHM,
  builtin: true,
}

/**
 * 这套主题在公众号导出时是否会额外生成封面/章节头/目录。
 *
 * 结构形状（封面、章节头、目录）是渲染器的配置，不是 CSS 能表达的东西，所以它
 * 仍然跟着主题 id 定义在 `lib/wechat/layout/layout-themes.ts`。
 */
export function themeHasStructure(theme: EditorTheme): boolean {
  return Boolean(getLayoutTheme(theme.id))
}

/** 主题的全部 CSS：排版底座 + 主题自己的规则。 */
function themeSource(theme: EditorTheme, mode: EditorColorMode): string {
  const parts = [BASE_THEME_CSS, theme.css]
  // 黑夜模式下主题自带的浅色规则**仍然注入** —— 版式（间距、装饰、伪元素图形）都在
  // 里面，只靠深色段重写一遍会漂移。颜色由深色底座 + 主题的深色段从后面盖掉。
  if (mode === 'dark' && theme.darkCss) parts.push(DARK_BASE_THEME_CSS, theme.darkCss)
  return parts.filter((css) => css.trim().length > 0).join('\n')
}

/**
 * 编辑器里需要套主题的正文区域。富文本编辑区之外，Markdown 源码模式的只读预览
 * （`.mdPreviewContent`）也是同一份文章内容的另一种呈现，主题不跟过去的话，
 * 切到源码模式就会看到两套外观。
 */
const EDITOR_THEME_SCOPES = [EDITOR_THEME_SCOPE, '.mdPreviewContent']

/** 纸张容器。主题的根规则（底色、字体、行距）要落在它身上，而不是只落在正文块上。 */
const EDITOR_PAGE_SCOPE = '.neEditorContent'

/** 编辑器/预览区的配色模式。跟着应用全局的白天/黑夜走。 */
export type EditorColorMode = 'light' | 'dark'

/**
 * 编辑器用的样式表。分三层注入：
 *
 *  1. 纸张 `.neEditorContent` —— 只放主题的**根规则**。背景色属于「整张纸」，
 *     只映射到正文块的话，正文那一层变了色而纸张边缘还是原样，看着像没生效。
 *  2. 富文本正文 —— 全部规则。
 *  3. Markdown 源码预览 —— 同上。
 *
 * `mode` 只影响编辑器。公众号导出固定走浅色（`buildExportThemeCss`），因为文章是
 * 给白天读、还会被打印的读者看的 —— 编辑器在夜里可以是深色，发出去必须是浅色。
 */
/**
 * 纸张实际铺的那个颜色，交给图片背景下的「编辑器」透明度滑块用。
 *
 * 主题的纸色写在根规则的 `background` 里，落到纸上是一块实色 —— CSS 没法把一个已经
 * 声明好的实色再调透明，所以在这里把它读出来，滑块拿它做 `color-mix`。没写纸色的主题
 * 留给底座的 `--editor-page-bg`；没做深色版的主题在黑夜里被钉回白纸，纸色也跟着是白。
 *
 * 变量挂在编辑器容器 `.neContainer` 上而不是纸上：流式模式没有纸，整屏要铺同一张纸色，
 * 纸外面的容器也得读得到它。
 */
function editorPaperColorVars(theme: EditorTheme, mode: EditorColorMode, source: string): string {
  const color = readThemePaperBackground(source) ?? (mode === 'dark' && !theme.darkCss ? '#FFFFFF' : null)
  return color ? `.neContainer { --editor-paper-color: ${color}; }` : ''
}

export function buildEditorThemeCss(theme: EditorTheme, mode: EditorColorMode = 'light'): string {
  const source = themeSource(theme, mode)
  return [
    // 主题没做深色版：把纸钉回浅色，主题的浅色版面原样成立。必须排在主题根规则之前，
    // 这样主题自己声明的纸色（宣纸底之类）还能压过这里的白。
    mode === 'dark' && !theme.darkCss ? LIGHT_PAPER_PIN : '',
    scopeRootRules(source, EDITOR_PAGE_SCOPE),
    ...EDITOR_THEME_SCOPES.map((scope) => scopeThemeCss(source, scope)),
    editorPaperColorVars(theme, mode, source),
  ]
    .filter((css) => css.trim().length > 0)
    .join('\n')
}

/**
 * 主题的**界面层** CSS：把 `ui.css` 的根规则映射到 `:root`。
 *
 * 与正文层的区别是作用域 —— 正文要收进 `.neEditorContent .ProseMirror`，界面
 * 直接落在 `:root` 上（它本来就是一份变量表）。`ui.css` 的浅色段与深色段写法
 * 完全一样（都是 `:root { … }`），区别只在注入时映射到哪个选择器：
 *
 *   浅色段 → `:root`                    （特异度 0,1,0）
 *   深色段 → `:root[data-theme='dark']` （特异度 0,2,0，天然压过浅色段）
 *
 * 这个映射是**必须**的：ui.css 的 `:root` 与 `ui-base.css` 的 `:root` 特异度相同，
 * 靠「主题样式表注入在 head 末尾」取胜；而 `ui-base.css` 的深色档是
 * `:root[data-theme='dark']`，比浅色段的 `:root` 高一层，主题的浅色段压不过它 ——
 * 所以深色覆盖必须也写成 `:root[data-theme='dark']`。
 *
 * 用 `retargetRoot`（改前缀）而不是 `scopeRootRules`（整块搬走）：`ui.css` 里除了
 * 变量表还有带后续段的复合选择器（毛玻璃的 `:root:not(…) .appSidebar`），整块搬走
 * 会把后半段丢掉。理由见 `scope.ts` 的 `retargetRoot`。
 *
 * 没有 ui.css 的主题（用户从网上下载的那些）仍会传递正文纸色，其他界面颜色
 * 继续留在底座上。
 */
export function buildUiThemeCss(theme: EditorTheme, mode: EditorColorMode = 'light'): string {
  const parts: string[] = []
  // The editor theme owns the paper colour, while ui.css owns the application
  // chrome. Expose the parsed paper colour to the chrome as a low-level token so
  // the sidebar, top bar and desk can share the same colour family without
  // copying the theme's document selectors into the global application.
  if (mode === 'light' && theme.preview.bg) {
    parts.push(`:root { --theme-paper-bg: ${theme.preview.bg}; }`)
  } else if (mode === 'dark') {
    // Do not let a light paper preview tint the dark application chrome.
    // A theme's dark ui.css may provide a more specific paper token; otherwise
    // the dark ui-base value is the correct fallback.
    parts.push(":root[data-theme='dark'] { --theme-paper-bg: var(--editor-page-bg); }")
  }
  if (theme.uiCss) parts.push(retargetRoot(theme.uiCss, ':root'))
  if (mode === 'dark' && theme.uiDarkCss) {
    parts.push(retargetRoot(theme.uiDarkCss, ":root[data-theme='dark']"))
  }
  return parts.filter((css) => css.trim().length > 0).join('\n')
}

/**
 * 公众号导出 HTML 的样式表（随后由 juice 内联）。
 *
 * 固定浅色：文章是给白天读、还会被打印的读者看的，导出的东西不能跟着作者当时的
 * 应用主题走。主题的 `@dark` 段只属于编辑器，这里连注入的机会都没有。
 */
/**
 * 主题 CSS 里以 `"..."` 形式定义的字符串变量（报头口号之类）。只收带引号的定义：
 * 非字符串的变量（颜色等）不归这条路径管 —— 主题编写约定本来就不许在导出样式里
 * 用 CSS 变量。
 */
function themeDefinedStringVars(css: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*"([^"]*)"/gu)) {
    if (match[1] && match[2] !== undefined) vars.set(match[1], match[2])
  }
  return vars
}

/**
 * 公众号导出 HTML 的样式表（随后由 juice 内联）。
 *
 * juice 内联伪元素时**不求值 var()**，`content: var(--theme-motto, "")` 会把
 * 字面量原样印进文章。导出前把引用解析成字面值：主题 :root 定义过的用定义值，
 * 都没有就取 var() 自带的 fallback。
 */
export function buildExportThemeCss(theme: EditorTheme): string {
  const css = scopeThemeCss(themeSource(theme, 'light'), EXPORT_THEME_SCOPE)
  const defined = themeDefinedStringVars(css)
  return css.replace(/var\((--[\w-]+)[^)]*\)/gu, (whole: string, name: string) => {
    const fallback = /"[^"]*"/u.exec(whole.slice(name.length))?.[0] ?? '""'
    const value = defined.get(name) ?? fallback.slice(1, -1)
    return `"${value}"`
  })
}
