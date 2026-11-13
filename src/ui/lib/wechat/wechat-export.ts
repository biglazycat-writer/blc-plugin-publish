/**
 * WeChat public account HTML export (ported from newbiling, adapted for biglazycat).
 *
 * Generates self-contained, fully inline-styled HTML using the markdown-nice
 * approach:
 *   1. Walk ProseMirror JSON → structural HTML (semantic tags + pm-* class
 *      hooks, almost no inline styles).
 *   2. Code blocks → lowlight syntax highlighting (hljs-* class spans).
 *   3. Concatenate theme CSS — the editor's own theme, scoped to `#nice-export`,
 *      plus the publishing panel's fine-tuning overrides.
 *   4. juice.inlineContent() → fold every CSS rule into inline style attributes,
 *      converting ::before/::after decorations into real nodes.
 *   5. normalizeWechatHtmlFragment() → strip class/id, div→section, drop styles
 *      WeChat rejects, wrap text nodes in <span leaf>.
 *
 * The result pastes cleanly into the WeChat article editor. Unlike newbiling,
 * biglazycat's editor has no custom wechatDivider/wechatDate/resizableImage/
 * wechatStyleBlock nodes, so those branches are removed; the standard image and
 * horizontalRule nodes are kept. An optional resolveImage hook lets the caller
 * swap local (/localimg/...) image srcs for uploaded mmbiz URLs or data URLs.
 */

import type { Editor } from '@tiptap/react'
import juice from 'juice'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import typescript from 'highlight.js/lib/languages/typescript'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import { buildExportThemeCss, type EditorTheme } from '../editor-themes'
import { buildOverrideCss, type WeChatStyleOverrides } from '../editor-themes/overrides'
import { normalizeWechatHtmlFragment } from './wechat-html-compliance'
import { isMermaidLanguage, mermaidImageSrc } from '../mermaid-inline'
import type { MermaidPng } from '../mermaid-render'
import { COLLAPSIBLE_DEFAULT_SUMMARY, calloutStyle } from '../rich-blocks'
import { blockClasses } from '../editor-themes/block-classes'
import { columnWidthsForRows, columnWidthsToPercent } from '../table-columns'
import { escapeTocLabel, isTocMarker, tocHtml, type TocEntry } from '../toc'

type PMNode = Record<string, unknown>
type PMMark = Record<string, unknown>

// resolveImage maps an in-editor image src (e.g. /localimg/<id>) to the src that
// should appear in exported HTML. Identity for preview; the publish flow passes
// a resolver that returns an uploaded mmbiz URL or an inline data URL.
export type ImageResolver = (src: string) => string

// Register common languages for syntax highlighting.
const lowlightInstance = createLowlight()
lowlightInstance.register({ javascript, python, css, xml, json, bash, java, cpp, c, typescript, markdown, sql })
lowlightInstance.registerAlias({ javascript: ['js'], typescript: ['ts'], python: ['py'], xml: ['html'] })

// WeChat-safe font sizes (only these px values render reliably).
const WECHAT_SIZES = ['12px', '14px', '15px', '16px', '18px', '20px', '22px', '24px', '28px', '36px']

// WeChat-safe color palette; anything else falls back to #333333.
const WECHAT_COLORS = [
  '#000000', '#333333', '#555555', '#666666', '#999999',
  '#cc0000', '#0000cc', '#006600', '#880000', '#000088',
  '#1677ff', '#ff4d4f', '#52c41a', '#faad14', '#ff6600',
]

function mapFontSize(size: string): string {
  if (WECHAT_SIZES.includes(size)) return size
  const num = parseFloat(size)
  if (Number.isNaN(num)) return '16px'
  const safeNums = WECHAT_SIZES.map((s) => parseFloat(s))
  let closest = safeNums[0]
  let minDiff = Math.abs(num - closest)
  for (const s of safeNums) {
    const diff = Math.abs(num - s)
    if (diff < minDiff) {
      closest = s
      minDiff = diff
    }
  }
  return closest + 'px'
}

function mapColor(color: string): string {
  const lower = color.toLowerCase()
  if (WECHAT_COLORS.includes(lower)) return lower
  return '#333333'
}

// RenderContext threads document-wide options through the recursive renderer.
interface RenderContext {
  resolveImage?: ImageResolver
  /** 预先位图化的 mermaid 图表，按源码索引；渲染是同步的，只能先备好。 */
  mermaidPngs?: Map<string, MermaidPng>
  /** 全文的 H2 列表。目录条目要等全文扫完才知道，所以渲染前先扫一遍。 */
  tocEntries?: TocEntry[]
}

/**
 * Generate WeChat-compatible HTML from a ProseMirror document (the tiptap
 * `doc`, not the StoredEditorContent wrapper). Primary export entry point.
 *
 * The theme is passed in rather than looked up: themes live on disk now, so the
 * caller (which already has the loaded list) owns the lookup.
 */
export function exportWechatHtmlFromJson(
  doc: Record<string, unknown>,
  theme: EditorTheme,
  styleOverrides?: WeChatStyleOverrides,
  ctx: RenderContext = {},
): string {
  // 主题是编辑器那一套：同一份 CSS，这里换个作用域（#nice-export）再交给 juice 内联。
  const mergedCss = [buildExportThemeCss(theme), buildOverrideCss(theme, styleOverrides)]
    .filter((css) => css.length > 0)
    .join('\n')

  // Each top-level block is wrapped in a <section> — WeChat treats these as
  // individually editable "cards", preserving block separation on paste.
  const structuralHtml = `<section id="nice-export" style="background-color:#ffffff;color:#333333;color-scheme:only light;max-width:750px;margin:0 auto;padding:0 2px;box-sizing:border-box;">${generateStructuralHtml(doc, ctx)}</section>`

  const inlinedHtml = juice.inlineContent(structuralHtml, mergedCss, {
    inlinePseudoElements: true,
    preserveImportant: true,
    removeStyleTags: true,
  })

  return normalizeWechatHtmlFragment(inlinedHtml)
}

/** Convenience wrapper: export directly from a tiptap Editor instance. */
export function exportWechatHtml(
  editor: Editor,
  theme: EditorTheme,
  styleOverrides?: WeChatStyleOverrides,
  ctx: RenderContext = {},
): string {
  const doc = editor.getJSON() as Record<string, unknown>
  return exportWechatHtmlFromJson(doc, theme, styleOverrides, ctx)
}

function generateStructuralHtml(doc: Record<string, unknown>, ctx: RenderContext): string {
  const parts: string[] = []
  const content = doc.content as PMNode[] | undefined
  if (!content) return ''

  // 目录条目要等全文扫完才算得出来，所以先扫一遍再逐块渲染。
  const scoped: RenderContext = { ...ctx, tocEntries: tocEntriesFromDoc(content) }

  for (const [index, node] of content.entries()) {
    const rendered = renderNode(node, scoped)
    if (!rendered) continue
    parts.push(`<section class="${getTopLevelBlockClasses(node, index)}">${rendered}</section>`)
  }

  return parts.join('\n')
}

/**
 * 文档顶层的 H2 → 目录条目。
 *
 * 条目口径与 `lib/toc.ts`、组件管线一致：**只收 H2**（一个 H2 = 一个章节）。
 * 标签是纯文本 —— 与组件管线的 `tocNumbered` 一样；公众号会把锚点过滤掉，链接点了不动，
 * 所以不传 `href`，`tocHtml` 会渲染成 `<span class="pm-toc-link">`，主题照样命中。
 */
function tocEntriesFromDoc(content: PMNode[]): TocEntry[] {
  const entries: TocEntry[] = []
  for (const node of content) {
    if (node.type !== 'heading') continue
    if (Number((node.attrs as PMNode | undefined)?.level) !== 2) continue
    const text = extractText(node).trim()
    if (!text) continue
    entries.push({ label: escapeTocLabel(text) })
  }
  return entries
}

function getTopLevelBlockClasses(node: PMNode, index: number): string {
  const type = node.type as string
  // 目录块不是可读段落：`pm-readable-block` 会让主题给正文的底边线、首行缩进套到目录上
  // （编辑器侧同样放走它，见 ThemeBlockClassesExtension）。
  if (type === 'paragraph' && isTocMarker(extractText(node))) return 'pm-block pm-toc-block'
  return blockClasses({
    type,
    level: type === 'heading' ? ((node.attrs as PMNode)?.level as number) || 1 : undefined,
    hasText: type === 'paragraph' ? hasTextContent(node) : false,
    index,
    multiline: type === 'paragraph' ? hasLineBreak(node) : false,
  })
}

function renderBlockStyle(attrs: PMNode | undefined): string {
  const styleParts: string[] = []
  const textAlign = attrs?.textAlign as string | undefined

  if (textAlign && textAlign !== 'left' && ['center', 'right', 'justify'].includes(textAlign)) {
    styleParts.push(`text-align:${textAlign}`)
  }
  // 刻意不导出 text-indent：微信移动端阅读不需要段首缩进，编辑器侧的段落缩进
  // （indent 属性）在公众号里一律丢弃；块首的全角空格缩进由 renderInlineHtml 剥掉。
  // 主题自己声明的 text-indent（如定制中文、学术文）走主题 CSS，不受这里影响。

  return styleParts.length > 0 ? ` style="${styleParts.join(';')}"` : ''
}

function renderNode(node: PMNode, ctx: RenderContext): string {
  const type = node.type as string

  if (type === 'heading') {
    const level = ((node.attrs as PMNode)?.level as number) || 1
    const hTag = level <= 3 ? `h${level}` : 'h3'
    const styleAttr = renderBlockStyle(node.attrs as PMNode | undefined)
    return `<${hTag}${styleAttr}>${renderInlineHtml(node, ctx)}</${hTag}>`
  }

  if (type === 'paragraph') {
    // 目录占位符（正文里单独一行 `[TOC]`）：换成整块目录，DOM 与编辑器、源码预览共用
    // `lib/toc.ts` 那一份，主题的 `.pm-toc*` 规则三处同时命中。
    // 必须先认出来 —— 它也是一个段落，落到下面就成了一个字面量 `[TOC]`。
    if (isTocMarker(extractText(node))) return tocHtml(ctx.tocEntries ?? [])
    if (!hasTextContent(node)) return `<p>&nbsp;</p>`
    const styleAttr = renderBlockStyle(node.attrs as PMNode | undefined)
    return `<p${styleAttr}>${renderInlineHtml(node, ctx)}</p>`
  }

  if (type === 'blockquote') {
    return `<blockquote>${renderBlockChildren(node, ctx)}</blockquote>`
  }

  if (type === 'horizontalRule') {
    return `<hr/>`
  }

  if (type === 'image') {
    const rawSrc = ((node.attrs as PMNode)?.src as string) || ''
    const src = ctx.resolveImage ? ctx.resolveImage(rawSrc) : rawSrc
    const alt = ((node.attrs as PMNode)?.alt as string) || ''
    return `<section style="text-align:center;margin:1em 0;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;border-radius:4px;"/></section>`
  }

  if (type === 'bulletList') {
    return `<ul>${renderListItems(node, ctx)}</ul>`
  }

  if (type === 'orderedList') {
    return `<ol>${renderListItems(node, ctx)}</ol>`
  }

  if (type === 'codeBlock') {
    const language = ((node.attrs as PMNode)?.language as string) || undefined
    const code = extractText(node)
    // mermaid 走图片：公众号编辑器不认 SVG，也不会执行脚本。src 和普通图片一样
    // 交给 resolveImage（预览换 data URL，草稿由后端上传后改写）。没预扫到
    // （渲染失败）就退回代码块，源码总比空白好。
    if (isMermaidLanguage(language) && ctx.mermaidPngs?.has(code.trim())) {
      const raw = mermaidImageSrc(code)
      const src = ctx.resolveImage ? ctx.resolveImage(raw) : raw
      return `<section style="text-align:center;margin:1em 0;"><img src="${escapeHtml(src)}" alt="Mermaid 图表" style="max-width:100%;border-radius:4px;"/></section>`
    }
    const highlighted = highlightCode(code, language)
    // `data-language` 挂在 `<pre>` 上：主题的代码块标题栏靠 `attr(data-language)`
    // 显示语言名（`<code>` 上的 class 供 highlight.js 配色用，两边各司其职）。
    // 没写语言就落回 text，否则标题栏只剩三个圆点。
    const lang = escapeHtml(language || 'text')
    return `<pre data-language="${lang}"><code${language ? ` class="language-${lang}"` : ''}>${highlighted}</code></pre>`
  }

  if (type === 'table') {
    return renderTable(node, ctx)
  }

  if (type === 'mediaRow') {
    // Legacy mediaRow: flatten cell children as sibling blocks.
    return ((node.content as PMNode[] | undefined) || [])
      .flatMap((cell) => ((cell.content as PMNode[] | undefined) || []).map((child) => renderNode(child, ctx)))
      .filter(Boolean)
      .join('\n')
  }

  if (type === 'pageBreak') {
    // 公众号文章是一条不分页的长页面，分页符没有对应物。也不退化成分割线——那会让读者
    // 以为作者真的画了一条线。返回空串，generateStructuralHtml 会把它整块跳过。
    return ''
  }

  if (type === 'callout') {
    const style = calloutStyle((node.attrs as Record<string, unknown> | undefined)?.kind)
    return (
      `<section style="border-left:4px solid ${style.accent};background:${style.background};padding:12px 14px;margin:1em 0;border-radius:4px;">` +
      `<p style="color:${style.accent};font-weight:600;margin:0 0 6px;">${escapeHtml(style.label)}</p>` +
      `${renderBlockChildren(node, ctx)}</section>`
    )
  }

  if (type === 'collapsible') {
    // 公众号会过滤掉 details/summary，连正文一起吃掉，所以摊平成一个带标题的框：
    // 读者少了「点开」这一步，但内容一个字都不会丢。
    const children = (node.content as PMNode[] | undefined) || []
    const summary = children.find((child) => (child.type as string) === 'collapsibleSummary')
    const title = summary ? renderInlineHtml(summary, ctx) : ''
    const body = children
      .filter((child) => (child.type as string) !== 'collapsibleSummary')
      .map((child) => renderNode(child, ctx))
      .join('\n')
    return (
      `<section style="border:1px solid #d9d9e3;border-radius:6px;padding:12px 14px;margin:1em 0;">` +
      `<p style="font-weight:600;margin:0 0 6px;">${title || escapeHtml(COLLAPSIBLE_DEFAULT_SUMMARY)}</p>` +
      `${body}</section>`
    )
  }

  // Generic container: recurse into children so nothing is silently dropped.
  if (Array.isArray(node.content)) {
    return (node.content as PMNode[]).map((n) => renderNode(n, ctx)).join('\n')
  }

  return ''
}

function renderBlockChildren(node: PMNode, ctx: RenderContext): string {
  const content = node.content as PMNode[] | undefined
  if (!content) return ''
  return content.map((n) => renderNode(n, ctx)).join('\n')
}

function renderListItems(listNode: PMNode, ctx: RenderContext): string {
  const items = listNode.content as PMNode[] | undefined
  if (!items) return ''
  return items
    .map((item) => {
      const itemContent = item.content as PMNode[] | undefined
      if (!itemContent) return '<li></li>'
      // Unwrap the paragraph tiptap nests inside each item so markers align.
      const inner = itemContent
        .map((child) => (child.type === 'paragraph' ? renderInlineHtml(child, ctx) : renderNode(child, ctx)))
        .join('')
      return `<li>${inner}</li>`
    })
    .join('\n')
}

function renderTable(tableNode: PMNode, ctx: RenderContext): string {
  const rows = tableNode.content as PMNode[] | undefined
  if (!rows) return ''
  // 列宽按内容算，和编辑器里的 colwidth 同一口径（table-columns.ts）。这里显式给两处：
  // `<colgroup>` 是标准做法，首行单元格的 `width` 是保险 —— 公众号编辑器粘贴时常把
  // 表格布局重置成等宽，两者数值同源，不会互相打架。
  const widths = columnWidthsToPercent(
    columnWidthsForRows(
      rows.map((row) => ((row.content as PMNode[]) ?? []).map((cell) => extractText(cell))),
    ),
  )
  let html = `<table><colgroup>${widths.map((width) => `<col style="width:${width}%" />`).join('')}</colgroup>`
  for (const [rowIndex, row] of rows.entries()) {
    html += `<tr>`
    const cells = row.content as PMNode[] | undefined
    if (cells) {
      for (const [cellIndex, cell] of cells.entries()) {
        const isHeader = cell.type === 'tableHeader' || (cell.attrs as PMNode)?.header
        const tag = isHeader ? 'th' : 'td'
        const width = rowIndex === 0 ? ` style="width:${widths[cellIndex] ?? 0}%"` : ''
        html += `<${tag}${width}>${renderTableCellContent(cell, ctx)}</${tag}>`
      }
    }
    html += `</tr>`
  }
  html += `</table>`
  return html
}

function renderTableCellContent(cell: PMNode, ctx: RenderContext): string {
  const content = cell.content as PMNode[] | undefined
  if (!content) return '&nbsp;'
  const rendered = content
    .map((child) => (child.type === 'paragraph' ? renderInlineHtml(child, ctx) : renderNode(child, ctx)))
    .join('')
  return rendered || '&nbsp;'
}

/** Render a block node's inline children (text + marks + hardBreak) as HTML. */
function renderInlineHtml(node: PMNode, ctx: RenderContext): string {
  const parts: string[] = []
  const content = node.content as PMNode[] | undefined
  if (!content) return ''

  for (let index = 0; index < content.length; index++) {
    const child = content[index] as PMNode
    const type = child.type as string

    if (type === 'text' && child.text) {
      // 公众号正文不保留段首空白缩进，仅清理块首文本节点的空白（含全角空格）。
      // 后续节点中的空格仍属于正文，原样保留。
      const raw = index === 0 ? (child.text as string).replace(/^[\s　]+/u, '') : (child.text as string)
      let text = escapeHtml(raw)
      const marks = (child.marks as PMMark[] | undefined) || []

      let style = ''
      const textDecorations: string[] = []
      let hasCode = false
      for (const mark of marks) {
        const mt = mark.type as string
        if (mt === 'bold') style += 'font-weight:700;'
        if (mt === 'italic') style += 'font-style:italic;'
        if (mt === 'code') hasCode = true
        if (mt === 'underline') textDecorations.push('underline')
        if (mt === 'strike') textDecorations.push('line-through')
        if (mt === 'textStyle' && mark.attrs) {
          const attrs = mark.attrs as PMNode
          if (attrs.fontSize) style += `font-size:${mapFontSize(attrs.fontSize as string)};`
          if (attrs.color) style += `color:${mapColor(attrs.color as string)};`
        }
        if (mt === 'highlight') style += 'background:#fff3a3;padding:1px 3px;border-radius:2px;'
        if (mt === 'superscript') style += 'vertical-align:super;font-size:0.8em;'
        if (mt === 'subscript') style += 'vertical-align:sub;font-size:0.8em;'
      }
      if (textDecorations.length > 0) {
        style += `text-decoration:${textDecorations.join(' ')};`
      }

      const linkMark = marks.find((m) => m.type === 'link')
      if (linkMark?.attrs) {
        const href = (linkMark.attrs as PMNode).href as string
        text = `<a href="${escapeHtml(href)}">${text}</a>`
      }
      if (style) text = `<span style="${style}">${text}</span>`
      if (hasCode) text = `<code>${text}</code>`
      parts.push(text)
    }

    if (type === 'hardBreak') parts.push('<br/>')

    // Nested block inside inline context (e.g. paragraph inside blockquote).
    if (type === 'paragraph' || type === 'heading' || type === 'blockquote') {
      parts.push(renderNode(child, ctx))
    }
  }

  return parts.join('')
}

function hasTextContent(node: PMNode): boolean {
  return extractText(node).length > 0
}

/**
 * 块内是否有换行（与编辑器 ThemeBlockClassesExtension.nodeHasLineBreak 同口径）。
 *
 * 段内换行在文档里是**文本里的 `\n`**，显式 `<br>` 才是 `hardBreak` 节点，两者都算
 * 「分行排列的块」，供主题识别非散文段落（首行缩进要躲开它们）。
 */
function hasLineBreak(node: PMNode): boolean {
  if (extractText(node).includes('\n')) return true
  const content = node.content as PMNode[] | undefined
  if (!content) return false
  return content.some((child) => child.type === 'hardBreak' || hasLineBreak(child))
}

function extractText(node: PMNode): string {
  if (node.type === 'text' && node.text) return node.text as string
  const content = node.content as PMNode[] | undefined
  if (content) return content.map(extractText).join('')
  return ''
}

/**
 * Highlight code via lowlight (highlight.js grammars). Returns HTML with hljs-*
 * class spans; theme CSS colors them, juice then inlines. Newlines become <br/>
 * and spaces become &nbsp; (only in text, not tags) because WeChat drops the
 * white-space:pre layout on paste.
 */
function highlightCode(code: string, language?: string): string {
  const plain = () => escapeHtml(code).replace(/\n/g, '<br/>').replace(/ /g, '&nbsp;')
  if (!language) return plain()
  try {
    if (!lowlightInstance.registered(language)) return plain()
    const tree = lowlightInstance.highlight(language, code)
    return hastToHtml(tree)
      .replace(/\n/g, '<br/>')
      .replace(/>([^<]*)</g, (_m, textContent: string) => `>${textContent.replace(/ /g, '&nbsp;')}<`)
  } catch {
    return plain()
  }
}

/** Convert a HAST tree (from lowlight) to an HTML string. */
function hastToHtml(tree: {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: unknown[]
}): string {
  if (tree.type === 'text') return escapeHtml(tree.value || '')
  if (tree.type === 'element') {
    const tag = tree.tagName || 'span'
    const props = tree.properties || {}
    let attrs = ''
    if (props.className) {
      const classes = Array.isArray(props.className) ? props.className.join(' ') : String(props.className)
      attrs += ` class="${classes}"`
    }
    const children = (tree.children || []).map((c) => hastToHtml(c as Parameters<typeof hastToHtml>[0])).join('')
    return `<${tag}${attrs}>${children}</${tag}>`
  }
  if (tree.children) {
    return tree.children.map((c) => hastToHtml(c as Parameters<typeof hastToHtml>[0])).join('')
  }
  return ''
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
