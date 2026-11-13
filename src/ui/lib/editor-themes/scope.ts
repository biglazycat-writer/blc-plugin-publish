/**
 * 主题作用域。
 *
 * 一份主题 CSS 要同时喂给两个完全不同的 DOM：
 *
 *  - 编辑器：`.neEditorContent .ProseMirror` 下的 ProseMirror 文档；
 *  - 公众号导出：`#nice-export` 里的结构化 HTML（每个顶层块包一层 <section>）。
 *
 * 所以主题文件里**不写根前缀**，注入时按目标补。补前缀这件事看着简单，但 CSS 不是
 * 逐行文本：注释里有大括号、字符串里有分号、`@media` 里还嵌着一整段规则、选择器列表
 * 里的逗号可能躲在 `:not(a, b)` 里。按行切或按 `}` 切都会切坏，这里用一个小扫描器
 * 按花括号深度真正解析一遍。
 *
 * `html` / `body` / `:root` 会被映射成作用域本身 —— 主题作者习惯写 `body { font-family }`，
 * 但那在编辑器里会打到整个应用，必须收进作用域。
 */

/** 一条规则、一条 @ 规则，或一条顶层声明（如 @import）。 */
export type CssBlock =
  | { kind: 'decl'; text: string }
  | { kind: 'rule'; prelude: string; body: string }
  | { kind: 'at'; prelude: string; body: string }

/** 注释里的大括号会骗过扫描器，先整段剔掉。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

/** 按花括号深度把 CSS 拆成块。字符串和括号内的 `{` `}` `;` 都不算分隔符。 */
function parseBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = []
  const length = css.length
  let i = 0

  while (i < length) {
    while (i < length && /\s/u.test(css[i])) i++
    if (i >= length) break

    const start = i
    let depth = 0
    let quote: string | null = null

    while (i < length) {
      const ch = css[i]
      if (quote) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === quote) quote = null
        i++
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        i++
        continue
      }
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (depth === 0 && (ch === '{' || ch === ';')) break
      i++
    }

    if (i >= length) break

    const prelude = css.slice(start, i).trim()

    if (css[i] === ';') {
      i++
      if (prelude) blocks.push({ kind: 'decl', text: prelude })
      continue
    }

    // css[i] === '{'
    i++
    const bodyStart = i
    let inner = 1
    let innerQuote: string | null = null

    while (i < length && inner > 0) {
      const ch = css[i]
      if (innerQuote) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === innerQuote) innerQuote = null
        i++
        continue
      }
      if (ch === '"' || ch === "'") {
        innerQuote = ch
        i++
        continue
      }
      if (ch === '{') inner++
      else if (ch === '}') inner--
      if (inner === 0) break
      i++
    }

    const body = css.slice(bodyStart, i)
    i++ // 跳过 '}'
    if (!prelude) continue
    blocks.push({ kind: prelude.startsWith('@') ? 'at' : 'rule', prelude, body })
  }

  return blocks
}

/** 顶层逗号分隔的选择器列表；括号和字符串里的逗号不算。 */
export function splitCssSelectors(prelude: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0

  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i]
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      out.push(prelude.slice(start, i))
      start = i + 1
    }
  }

  out.push(prelude.slice(start))
  return out
}

/** 把 `html` / `body` / `:root` 开头的选择器收进作用域，其余整体加前缀。 */
function applyScope(selector: string, scope: string): string {
  const trimmed = selector.trim()
  if (!trimmed) return ''

  // 主题作者写 body { ... } 是习惯，但那会打到整个应用。
  const withoutRoot = trimmed.replace(/^(?:html|body|:root)(?![-\w])/u, '').trim()
  if (!withoutRoot) return scope

  // 主题若已经自带作用域（导入的外来主题），不要叠第二层。
  if (withoutRoot.startsWith(scope)) return withoutRoot

  // `*` 作为选择器时 `scope *` 才成立，`scope*` 是语法错误。
  if (withoutRoot === '*') return `${scope} *`

  return `${scope} ${withoutRoot}`
}

/** 条件型 @ 规则：内部还是一整段 CSS，需要递归加作用域。 */
const NESTED_AT_RULES = /^@(?:media|supports|layer|container|scope)\b/iu

function scopeBlocks(blocks: CssBlock[], scope: string): string {
  const parts: string[] = []

  for (const block of blocks) {
    if (block.kind === 'decl') {
      parts.push(`${block.text};`)
      continue
    }

    if (block.kind === 'at') {
      // @keyframes / @font-face / @import 内部不是选择器，原样保留。
      // 它们在公众号导出时会被 FORBIDDEN_STYLE_RULES 丢掉，但编辑器里仍然有效。
      if (NESTED_AT_RULES.test(block.prelude)) {
        const inner = scopeBlocks(parseBlocks(block.body), scope)
        if (inner) parts.push(`${block.prelude} {\n${inner}\n}`)
      } else {
        parts.push(`${block.prelude} {${block.body}}`)
      }
      continue
    }

    const selectors = splitCssSelectors(block.prelude)
      .map((selector) => applyScope(selector, scope))
      .filter(Boolean)
    if (selectors.length === 0) continue
    parts.push(`${selectors.join(', ')} {${block.body}}`)
  }

  return parts.join('\n')
}

/** 编辑器里的作用域。与 writing.css 的 `.neEditorContent .ProseMirror p` 同深度，靠后加载取胜。 */
export const EDITOR_THEME_SCOPE = '.neEditorContent .ProseMirror'

/** 公众号导出 HTML 的根。 */
export const EXPORT_THEME_SCOPE = '#nice-export'

/** 把一份无前缀的主题 CSS 收进指定作用域。 */
export function scopeThemeCss(css: string, scope: string): string {
  if (!css.trim()) return ''
  return scopeBlocks(parseBlocks(stripComments(css)), scope)
}

/**
 * 把一份主题 CSS 拆成块，供**读取**用（作用域化之外的用途，比如读正文排版值）。
 * 注释先整段剔掉，所以调用方拿到的是干净的规则。
 */
export function parseCssBlocks(css: string): CssBlock[] {
  return parseBlocks(stripComments(css))
}

const ROOT_SELECTOR = /^(?:html|body|:root)(?![-\w])/u

/**
 * 只取**根规则**（原 `:root` / `html` / `body`），整块搬到指定作用域。
 *
 * 主题的根规则写的是「整篇文章的底色、字体、行距」，在公众号里 `#nice-export` 就是
 * 文章容器，所以一切正常。但编辑器里文章容器是纸张 `.neEditorContent`，而正文块
 * `.ProseMirror` 只是它内部的一层 —— 把根规则只映射到正文，背景色就只涂在正文块上，
 * 纸张边缘还是原来的颜色。所以编辑器侧要把根规则**再注入一次到纸张**。
 */
export function scopeRootRules(css: string, scope: string): string {
  if (!css.trim()) return ''
  const parts: string[] = []
  for (const block of parseBlocks(stripComments(css))) {
    if (block.kind !== 'rule') continue
    const isRoot = splitCssSelectors(block.prelude).some((selector) => ROOT_SELECTOR.test(selector.trim()))
    if (!isRoot) continue
    parts.push(`${scope} {${block.body}}`)
  }
  return parts.join('\n')
}

/**
 * 把每条规则选择器里的**根记号**（`html` / `body` / `:root`）换成另一个根选择器，
 * 选择器其余部分原样保留。
 *
 * 与 `scopeRootRules` 的区别是「改前缀」而不是「整块搬走」。界面层的 `ui.css` 里既有
 * 纯变量表 `:root { … }`，也有带后续段的复合选择器 —— 毛玻璃的
 * `:root:not([data-background='image']) .appSidebar`。后者若走 `scopeRootRules`，会被
 * 整块搬到 `:root` 上，`.appSidebar` 直接丢掉：一条本该只作用于侧栏的 `!important`
 * 背景规则会打到 `<html>` 上，整个界面变透明。
 *
 * 深色段同理：`:root button` 要变成 `:root[data-theme='dark'] button`，而不是退化成
 * `:root[data-theme='dark']`（那样圆角、描边这类落在子元素上的手感签名就全丢了）。
 */
export function retargetRoot(css: string, rootSelector: string): string {
  if (!css.trim()) return ''
  const parts: string[] = []
  for (const block of parseBlocks(stripComments(css))) {
    if (block.kind === 'decl') {
      parts.push(`${block.text};`)
      continue
    }
    if (block.kind === 'at') {
      if (NESTED_AT_RULES.test(block.prelude)) {
        const inner = retargetRoot(block.body, rootSelector)
        if (inner) parts.push(`${block.prelude} {\n${inner}\n}`)
      } else {
        parts.push(`${block.prelude} {${block.body}}`)
      }
      continue
    }
    const selectors = splitCssSelectors(block.prelude)
      .map((selector) => {
        const trimmed = selector.trim()
        if (!trimmed) return ''
        // 根记号在开头才替换（`html body` 这种只换掉最前面的 `html`，其余照旧）。
        return ROOT_SELECTOR.test(trimmed) ? rootSelector + trimmed.replace(ROOT_SELECTOR, '') : trimmed
      })
      .filter(Boolean)
    if (selectors.length === 0) continue
    parts.push(`${selectors.join(', ')} {${block.body}}`)
  }
  return parts.join('\n')
}
