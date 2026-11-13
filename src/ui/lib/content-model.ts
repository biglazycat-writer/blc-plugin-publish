import { common, createLowlight } from 'lowlight'
import { parseWikiLink, wikiLinkMarkdown } from './wiki-link'
import katex from 'katex'
import { collectJsonFigureNumbers, figureCaptionLabel } from './figure-caption'
import {
  COLLAPSIBLE_DEFAULT_SUMMARY,
  PAGE_BREAK_LABEL,
  PAGE_BREAK_MARKDOWN,
  calloutKindFromAlert,
  calloutStyle,
} from './rich-blocks'

/** Legacy `<!-- mediarow … -->` markers are ignored; they no longer encode a node. */
const MEDIA_ROW_MARKER_LINE_RE = /^<!--\s*mediarow\b.*-->\s*$/i

import { columnWidthsForRows, columnWidthsToPercent } from './table-columns'
import { blockClasses } from './editor-themes/block-classes'
import { mermaidPlaceholderHtml } from './mermaid-inline'
import { isTocMarker, tocHtml, type TocEntry } from './toc'

export type EditorMode = 'richtext' | 'markdown'

/** Markdown 编辑子视图：所见即所得（默认）或源码双栏 */
export type MarkdownViewMode = 'wysiwyg' | 'source'

export const DEFAULT_MARKDOWN_VIEW_MODE: MarkdownViewMode = 'wysiwyg'
const MD_VIEW_MODE_STORAGE_KEY = 'biglazycat.mdViewMode'

export function loadMarkdownViewMode(): MarkdownViewMode {
  try {
    const v = localStorage.getItem(MD_VIEW_MODE_STORAGE_KEY)
    if (v === 'source' || v === 'wysiwyg') return v
  } catch {
    /* ignore */
  }
  return DEFAULT_MARKDOWN_VIEW_MODE
}

export function saveMarkdownViewMode(mode: MarkdownViewMode): void {
  try {
    localStorage.setItem(MD_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/** 是否在可交互的富文本编辑表面（富文本模式，或 Markdown 所见即所得） */
export function isRichEditingSurface(mode: EditorMode, mdView: MarkdownViewMode = DEFAULT_MARKDOWN_VIEW_MODE): boolean {
  return mode === 'richtext' || (mode === 'markdown' && mdView === 'wysiwyg')
}

/** 是否为 Markdown 源码双栏（textarea + 预览） */
export function isMarkdownSourceView(mode: EditorMode, mdView: MarkdownViewMode = DEFAULT_MARKDOWN_VIEW_MODE): boolean {
  return mode === 'markdown' && mdView === 'source'
}

export type AnnotationCoordinateSpace = 'prosemirror' | 'markdown-source'

export interface AnnotationData {
  id: string
  from: number
  to: number
  comment: string
  text_fragment: string
  timestamp: number
  coordinate_space: AnnotationCoordinateSpace
}

/**
 * Resolve a Markdown-source annotation after nearby edits. The exact stored
 * offsets win; otherwise the nearest occurrence of the captured fragment is
 * used. This keeps duplicate fragments attached to the closest original spot.
 */
export function resolveMarkdownAnnotationRange(
  markdown: string,
  annotation: Pick<AnnotationData, 'from' | 'to' | 'text_fragment'>,
): { from: number; to: number } | null {
  const from = Number(annotation.from)
  const to = Number(annotation.to)
  const numericRangeIsValid =
    Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from && to <= markdown.length
  const fragment = annotation.text_fragment || ''

  if (numericRangeIsValid && (!fragment || markdown.slice(from, to) === fragment)) {
    return { from, to }
  }
  if (!fragment) return null

  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let searchFrom = 0
  while (searchFrom <= markdown.length - fragment.length) {
    const index = markdown.indexOf(fragment, searchFrom)
    if (index < 0) break
    const distance = Math.abs(index - (Number.isFinite(from) ? from : 0))
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
    searchFrom = index + Math.max(1, fragment.length)
  }

  return bestIndex < 0 ? null : { from: bestIndex, to: bestIndex + fragment.length }
}
export interface StoredEditorContent {
  type: 'biglazycat_editor_content'
  version: 3
  doc: Record<string, unknown>
  /** Exact Markdown captured by the source editor. Present only after a source-mode edit. */
  sourceMarkdown?: string
  plainText?: string
  annotations?: AnnotationData[]
  updatedAt?: string
}

const EMPTY_DOC: Record<string, unknown> = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export function emptyTiptapDoc(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(EMPTY_DOC)) as Record<string, unknown>
}

export function isStoredEditorContent(content: unknown): content is StoredEditorContent {
  if (!content || typeof content !== 'object') return false
  const obj = content as Record<string, unknown>
  return obj.type === 'biglazycat_editor_content' && !!obj.doc
}

export function parseStoredContent(raw: string): StoredEditorContent | null {
  const t = (raw || '').trim()
  if (!t.startsWith('{')) return null
  try {
    const obj = JSON.parse(t) as unknown
    if (isStoredEditorContent(obj)) return obj
  } catch {
    /* plain text */
  }
  return null
}

export function docFromStored(raw: string, st: StoredEditorContent | null = parseStoredContent(raw)): Record<string, unknown> {
  if (st?.doc) return st.doc
  if (!raw) return emptyTiptapDoc()
  return docFromMarkdown(raw)
}

/**
 * Chapter body from a workspace file, for the whole-work book exporters.
 *
 * Unlike `docFromStored`, this also accepts a bare ProseMirror doc and a JSON
 * wrapper that lost its `doc` but kept `sourceMarkdown`. A JSON string must
 * never fall through to the Markdown parser: braces would survive as text.
 */
export function storedDocFromRaw(raw: string): Record<string, unknown> {
  const text = raw || ''
  const trimmed = text.trim()
  if (!trimmed) return emptyTiptapDoc()
  if (trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return docFromMarkdown(text)
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (obj.type === 'biglazycat_editor_content') {
        if (obj.doc && typeof obj.doc === 'object') return obj.doc as Record<string, unknown>
        if (typeof obj.sourceMarkdown === 'string' && obj.sourceMarkdown.trim()) {
          return docFromMarkdown(obj.sourceMarkdown)
        }
        if (typeof obj.plainText === 'string' && obj.plainText.trim()) {
          return docFromMarkdown(obj.plainText)
        }
        return emptyTiptapDoc()
      }
      if (obj.type === 'doc' && Array.isArray(obj.content)) return obj
    }
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
  }
  return docFromMarkdown(text)
}

type PMNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: PMNode[]
}

function applyMarks(text: string, marks?: PMNode['marks']): string {
  if (!text) return ''
  let out = text
  const names = (marks || []).map((m) => m.type)
  if (names.includes('code')) out = '`' + out + '`'
  if (names.includes('bold')) out = '**' + out + '**'
  if (names.includes('italic')) out = '*' + out + '*'
  if (names.includes('strike')) out = '~~' + out + '~~'
  if (names.includes('underline')) out = '<u>' + out + '</u>'
  if (names.includes('highlight')) out = '==' + out + '=='
  const link = (marks || []).find((m) => m.type === 'link')
  if (link?.attrs?.href) {
    out = '[' + out + '](' + String(link.attrs.href) + ')'
  }
  return out
}

function imageToMd(node: PMNode): string {
  const src = String(node.attrs?.src || '')
  if (!src) return ''
  const alt = String(node.attrs?.alt || '')
  const title = String(node.attrs?.title || '')
  return `![${alt}](${src}${title ? ` "${title.replace(/"/g, '')}"` : ''})`
}

/**
 * Markdown 存不下「用户拖出来的宽度」和「非居中对齐」，单独写成一行标记注释。
 *
 * 不写这一行，重新打开章节时图片会退回原始尺寸。标记本身不产出内容，只把信息
 * 交给紧随其后的那一张图。居中 + 没有宽度是默认值，不写标记，普通图片行保持干净。
 */
function imageMarkerToMd(node: PMNode): string {
  const parts: string[] = []
  const width = Number(node.attrs?.width)
  if (Number.isFinite(width) && width > 0) parts.push(`width=${Math.round(width)}`)
  const align = String(node.attrs?.textAlign || '')
  if (align && align !== 'center') parts.push(`align=${align}`)
  return parts.length ? `<!-- image ${parts.join(' ')} -->` : ''
}

export type ImageMarker = { width?: number; align?: 'left' | 'center' | 'right' }

/** 读回 {@link imageMarkerToMd} 写出的那一行；不是标记行返回 null。 */
export function parseImageMarker(line: string): ImageMarker | null {
  const match = /^<!--\s*image\b([^>]*)-->$/.exec(line.trim())
  if (!match) return null
  const marker: ImageMarker = {}
  for (const part of match[1].trim().split(/\s+/)) {
    const [key, value] = part.split('=')
    if (key === 'width') {
      const width = Number(value)
      if (Number.isFinite(width) && width > 0) marker.width = Math.round(width)
    } else if (key === 'align' && (value === 'left' || value === 'center' || value === 'right')) {
      marker.align = value
    }
  }
  return marker.width || marker.align ? marker : null
}

function withImageMarker(node: PMNode, marker: ImageMarker | null): PMNode {
  if (!marker) return node
  const attrs: Record<string, unknown> = { ...(node.attrs || {}) }
  if (marker.width) attrs.width = marker.width
  if (marker.align) attrs.textAlign = marker.align
  return { ...node, attrs }
}

/**
 * 图注在 Markdown 里只能退化成一行斜体文字。
 *
 * 这是单向的：md 再解析回富文本时它会变成普通斜体段落，图注属性丢失。
 * 但这比不输出好得多 —— markdown 模式下保存会走 docFromMarkdown 重新解析
 * （见 NovelEditor.getStoredContent），不写这一行的话图注文字会被静默抹掉。
 */
function imageCaptionToMd(node: PMNode, index: number | null): string {
  const text = figureCaptionLabel(node.attrs?.caption, index)
  if (!text) return ''
  return `*${text.replace(/([*_])/g, '\\$1')}*`
}

function inlineToMd(nodes?: PMNode[]): string {
  if (!nodes?.length) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'text') return applyMarks(n.text || '', n.marks)
      if (n.type === 'wikiLink') return wikiLinkMarkdown({ target: String(n.attrs?.target || ''), alias: String(n.attrs?.alias || '') })
      if (n.type === 'image') return imageToMd(n)
      if (n.type === 'inlineIcon') return String(n.attrs?.symbol || '')
      if (n.type === 'inlineTag') {
        const name = String(n.attrs?.name || '').trim()
        return name ? (name.includes(' ') ? `#${name}#` : `#${name}`) : ''
      }
      if (n.type === 'formula') {
        const latex = String(n.attrs?.latex || '').trim()
        if (!latex) return ''
        return n.attrs?.displayMode ? `$$${latex}$$` : `$${latex}$`
      }
      if (n.type === 'footnoteReference') {
        const name = String(n.attrs?.name || '').trim()
        return name ? `[^${name}]` : ''
      }
      if (n.content) return inlineToMd(n.content)
      return ''
    })
    .join('')
}

function listToMd(node: PMNode, ordered: boolean, indent = 0): string {
  const items = node.content || []
  const pad = '  '.repeat(indent)
  const taskList = node.type === 'taskList'
  return items
    .map((item, i) => {
      const prefix = taskList ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : ordered ? `${i + 1}. ` : '- '
      const lines: string[] = []
      let wrotePrimary = false
      for (const child of item.content || []) {
        if (child.type === 'paragraph' || child.type === 'heading') {
          const text = inlineToMd(child.content as PMNode[])
          if (!wrotePrimary) {
            lines.push(`${pad}${prefix}${text}`)
            wrotePrimary = true
          } else {
            lines.push(`${pad}  ${text}`)
          }
        } else if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
          if (!wrotePrimary) {
            lines.push(`${pad}${prefix}`.trimEnd())
            wrotePrimary = true
          }
          lines.push(listToMd(child, child.type === 'orderedList', indent + 1))
        }
      }
      if (!wrotePrimary) lines.push(`${pad}${prefix}`.trimEnd())
      return lines.join('\n')
    })
    .join('\n')
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let escaped = false
  let inCode = false
  for (const char of body) {
    if (escaped) {
      cell += char
      escaped = false
      continue
    }
    if (char === '\\') {
      cell += char
      escaped = true
      continue
    }
    if (char === '\x60') inCode = !inCode
    if (char === '|' && !inCode) {
      cells.push(cell.trim().replace(/\\\|/g, '|'))
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim().replace(/\\\|/g, '|'))
  return cells.length > 0 ? cells : null
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line)
  return !!cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
}

function nextNonEmptyLine(lines: readonly string[], start: number): number {
  let index = start
  while (index < lines.length && !lines[index].trim()) index += 1
  return index
}

function tableCellFromMarkdown(text: string, header: boolean, width: number): PMNode {
  const inline = parseInlineMarks(text)
  return {
    type: header ? 'tableHeader' : 'tableCell',
    // colwidth 让 `table-layout: fixed` 按内容分配列宽；不写就各列等宽（见 table-columns.ts）。
    attrs: { colwidth: [width] },
    content: [{ type: 'paragraph', content: inline.length ? inline : undefined }],
  }
}

function markdownTableToNode(headerCells: string[], bodyRows: string[][]): PMNode {
  const columnCount = Math.max(headerCells.length, ...bodyRows.map((row) => row.length), 1)
  const normalize = (row: string[]) => Array.from({ length: columnCount }, (_, index) => row[index] || '')
  const rows: string[][] = [normalize(headerCells), ...bodyRows.map(normalize)]
  const widths = columnWidthsForRows(rows)
  return {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: rows[0]!.map((cell, index) => tableCellFromMarkdown(cell, true, widths[index]!)),
      },
      ...rows.slice(1).map((row) => ({
        type: 'tableRow',
        content: row.map((cell, index) => tableCellFromMarkdown(cell, false, widths[index]!)),
      })),
    ],
  }
}

/**
 * 表格单元格 → 一个 Markdown 单元格。
 *
 * 单元格里是块级内容，之前只取 `inlineToMd(block.content)`，块级图片（没有 content）
 * 会被整个丢掉，所以必须在这里补上。单元格内换不了行，多个块之间只能用 `<br>` 接。
 */
function blocksToMarkdownCell(blocks: PMNode[] | undefined, figureNumbers: Map<PMNode, number>): string {
  return (blocks || [])
    .map((block) => {
      if (block.type === 'image') {
        const image = imageToMd(block)
        const caption = imageCaptionToMd(block, figureNumbers.get(block) ?? null)
        return caption ? (image ? `${image}<br>${caption}` : caption) : image
      }
      if (block.type === 'horizontalRule') return ''
      return inlineToMd(block.content)
    })
    .filter((text) => text.length > 0)
    .join('<br>')
    .replace(/\n/g, '<br>')
    .replace(/\|/g, '\\|')
}

function tableNodeToMarkdown(node: PMNode, figureNumbers: Map<PMNode, number>): string {
  const rows = node.content || []
  if (!rows.length) return ''
  const toCells = (row?: PMNode) => (row?.content || []).map((cell) => blocksToMarkdownCell(cell.content, figureNumbers))
  const header = toCells(rows[0])
  const columnCount = Math.max(header.length, ...rows.slice(1).map((row) => toCells(row).length), 1)
  const normalize = (cells: string[]) => Array.from({ length: columnCount }, (_, index) => cells[index] || '')
  const format = (cells: string[]) => '| ' + normalize(cells).join(' | ') + ' |'
  return [
    format(header),
    '| ' + Array.from({ length: columnCount }, () => '---').join(' | ') + ' |',
    ...rows.slice(1).map((row) => format(toCells(row))),
  ].join('\n')
}

/** 嵌套块（提示框 / 折叠块的正文）→ Markdown，直接复用顶层那套规则。 */
function nestedBlocksToMarkdown(blocks: PMNode[] | undefined): string {
  if (!blocks?.length) return ''
  return docToMarkdown({ type: 'doc', content: blocks })
}

/**
 * 提示框 → GitHub 警告语法。GitHub / Obsidian / Typora 都会渲染成带色块的提示，
 * 认不出来的渲染器也至少把它显示成一段引用，文字一个都不丢。
 */
function calloutToMarkdown(node: PMNode): string {
  const style = calloutStyle(node.attrs?.kind)
  const body = nestedBlocksToMarkdown(node.content)
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
  return [`> [!${style.alert}]`, ...body].join('\n')
}

/**
 * 折叠块 → `<details>`。Markdown 没有折叠语法，但 GitHub / Typora / VS Code 都直接
 * 认这段 HTML，标题和正文照样能读；正文前后留空行，里面的 Markdown 才会被继续解析。
 */
function collapsibleToMarkdown(node: PMNode): string {
  const blocks = node.content || []
  const summaryNode = blocks.find((block) => block.type === 'collapsibleSummary')
  const summary = inlineToMd(summaryNode?.content).trim() || COLLAPSIBLE_DEFAULT_SUMMARY
  const body = nestedBlocksToMarkdown(blocks.filter((block) => block !== summaryNode))
  return [node.attrs?.open === false ? '<details>' : '<details open>', `<summary>${summary}</summary>`, '', body, '', '</details>'].join('\n')
}

/** TipTap/ProseMirror JSON to Markdown (desktop subset). */
export function docToMarkdown(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return ''
  const root = doc as PMNode
  const blocks = root.content || []
  const lines: string[] = []
  const figureNumbers = collectJsonFigureNumbers(root)

  for (const node of blocks) {
    const type = node.type || ''
    if (type === 'rawMarkdown') {
      lines.push(String(node.attrs?.source || ''), '')
    } else if (type === 'image') {
      const marker = imageMarkerToMd(node)
      if (marker) lines.push(marker)
      lines.push(imageToMd(node))
      const caption = imageCaptionToMd(node, figureNumbers.get(node) ?? null)
      if (caption) {
        lines.push('')
        lines.push(caption)
      }
      lines.push('')
    } else if (type === 'heading') {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level || 1)))
      lines.push(`${'#'.repeat(level)} ${inlineToMd(node.content)}`)
      lines.push('')
    } else if (type === 'paragraph') {
      lines.push(inlineToMd(node.content))
      lines.push('')
    } else if (type === 'blockquote') {
      // 和提示框一样递归序列化再加前缀。原来只取行内内容（inlineToMd），引用里的
      // 代码块、表格、标题在保存时会被整个丢掉 —— 这是「引用解析成纯文本」的另一半。
      const inner = nestedBlocksToMarkdown(node.content as PMNode[] | undefined)
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n')
      lines.push(inner)
      lines.push('')
    } else if (type === 'footnoteDefinition') {
      // `[^name]: 首行` + 缩进续行，与 readFootnoteDefinition 的读取规则互为镜像。
      const name = String(node.attrs?.name || '').trim()
      const inner = nestedBlocksToMarkdown(node.content as PMNode[] | undefined)
      if (name && inner.trim()) {
        const defLines = inner.split('\n')
        lines.push(`[^${name}]: ${defLines[0]}`)
        for (const cont of defLines.slice(1)) lines.push(cont.trim() ? `    ${cont}` : '')
        lines.push('')
      }
    } else if (type === 'bulletList') {
      lines.push(listToMd(node, false))
      lines.push('')
    } else if (type === 'orderedList') {
      lines.push(listToMd(node, true))
      lines.push('')
    } else if (type === 'taskList') {
      lines.push(listToMd(node, false))
      lines.push('')
    } else if (type === 'codeBlock') {
      const lang = String(node.attrs?.language || '')
      const code = (node.content || []).map((c) => c.text || '').join('')
      lines.push('```' + lang)
      lines.push(code)
      lines.push('```')
      lines.push('')
    } else if (type === 'horizontalRule') {
      lines.push('---')
      lines.push('')
    } else if (type === 'table') {
      const table = tableNodeToMarkdown(node, figureNumbers)
      if (table) {
        lines.push(table)
        lines.push('')
      }

    } else if (type === 'mediaRow') {
      // Legacy JSON may still carry mediaRow; flatten cell children as sibling blocks.
      const flat: PMNode[] = []
      for (const cell of node.content || []) {
        for (const child of cell.content || []) {
          if (child.type === 'paragraph' && !(child.content?.length)) continue
          flat.push(child)
        }
      }
      if (flat.length) {
        const nested = docToMarkdown({ type: 'doc', content: flat })
        if (nested.trim()) {
          lines.push(nested.trimEnd())
          lines.push('')
        }
      }
    } else if (type === 'pageBreak') {
      lines.push(PAGE_BREAK_MARKDOWN)
      lines.push('')
    } else if (type === 'callout') {
      lines.push(calloutToMarkdown(node))
      lines.push('')
    } else if (type === 'collapsible') {
      lines.push(collapsibleToMarkdown(node))
      lines.push('')
    } else {
      const text = inlineToMd(node.content)
      if (text) {
        lines.push(text)
        lines.push('')
      } else {
        // Markdown has no form for this node, so it is kept as a JSON comment,
        // exactly as the Go writer keeps it. Writing nothing would drop a canvas
        // or mind-map reference on every save (architecture doc §12).
        const marker = rawNodeMarker(node)
        if (marker) {
          lines.push(marker)
          lines.push('')
        }
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Writes a node the way the Go writer writes a PreservedRaw one.
 *
 * The key order matches the Go struct's field order on purpose: a document the
 * user did not change must round-trip byte for byte, or every save would churn
 * the file and show up as a whole-file diff (architecture doc §12, §20 P1).
 */
function rawNodeMarker(node: PMNode): string {
  if (!node.type) return ''
  const ordered: Record<string, unknown> = { type: node.type }
  if (node.text) ordered.text = node.text
  if (node.attrs && Object.keys(node.attrs).length > 0) ordered.attrs = node.attrs
  if (node.marks && node.marks.length > 0) ordered.marks = node.marks
  if (node.content && node.content.length > 0) ordered.content = node.content
  return `<!-- blc:node ${JSON.stringify(ordered)} -->`
}

export function plainFromDoc(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return ''
  const lines: string[] = []
  const walk = (node: Record<string, unknown>) => {
    const type = node.type as string | undefined
    if (type === 'wikiLink') {
      if (lines.length === 0) lines.push('')
      const attrs = node.attrs as Record<string, unknown> | undefined
      lines[lines.length - 1] += String(attrs?.alias || attrs?.target || '')
      return
    }
    if (type === 'text' && typeof node.text === 'string') {
      if (lines.length === 0) lines.push('')
      lines[lines.length - 1] += node.text
      return
    }
    if (type === 'inlineIcon') {
      if (lines.length === 0) lines.push('')
      lines[lines.length - 1] += String((node.attrs as Record<string, unknown> | undefined)?.symbol || '')
      return
    }
    if (type === 'inlineTag') {
      if (lines.length === 0) lines.push('')
      const name = String((node.attrs as Record<string, unknown> | undefined)?.name || '').trim()
      if (name) lines[lines.length - 1] += `#${name}`
      return
    }
    if (type === 'footnoteReference') {
      if (lines.length === 0) lines.push('')
      const name = String((node.attrs as Record<string, unknown> | undefined)?.name || '').trim()
      if (name) lines[lines.length - 1] += `[^${name}]`
      return
    }
    if (type === 'formula') {
      if (lines.length === 0) lines.push('')
      const latex = String((node.attrs as Record<string, unknown> | undefined)?.latex || '').trim()
      if (latex) lines[lines.length - 1] += latex
      return
    }
    const children = node.content as Record<string, unknown>[] | undefined
    if (type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'collapsibleSummary') {
      lines.push('')
    }
    if (type === 'hardBreak') {
      lines.push('')
      return
    }
    if (children) {
      for (const c of children) walk(c)
    }
  }
  walk(doc)
  return lines.join('\n').replace(/^\n+/, '').trimEnd()
}

/** Stable GitHub-style fragment used by Markdown TOC links and rendered headings. */
export function markdownAnchorSlug(value: string): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\p{Script=Han}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * Link and image targets reach us from untrusted places: imported Markdown
 * files, pasted text and AI output. The preview pane renders through
 * dangerouslySetInnerHTML inside the Wails origin that exposes the Go bridge,
 * so a `javascript:` target would run with app privileges. Whitespace and
 * control characters are dropped first, otherwise "java\tscript:alert(1)"
 * would not match the scheme test.
 */
export function sanitizeUrl(raw: string): string {
  let value = ''
  for (const ch of raw || '') {
    if (ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f) value += ch
  }
  if (!value) return ''
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)
  // No scheme means a relative or root-relative reference (/localimg/…), which
  // cannot execute script.
  if (!scheme) return value
  return SAFE_URL_SCHEMES.has(scheme[1].toLowerCase()) ? value : ''
}

/**
 * 图片地址比链接多认一种：内联的 `data:image/…`。
 *
 * 旧版图片工具把裁剪/压缩结果直接写成 base64，这些引用已经落在章节文件里；
 * 读回来时如果按链接规则过滤，整张图会被静默丢掉，看起来就是「图片消失了」。
 * 放宽只针对图片节点，链接仍然走 sanitizeUrl（`data:text/html` 依旧被拦）。
 */
export function sanitizeImageSrc(raw: string): string {
  let value = ''
  for (const ch of raw || '') {
    if (ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f) value += ch
  }
  if (/^data:image\//i.test(value)) return value
  return sanitizeUrl(raw)
}
const previewLowlight = createLowlight(common)

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: string | string[] }
  children?: HastNode[]
}

function hastToHtml(node: HastNode): string {
  if (!node) return ''
  if (node.type === 'text') return escapeHtml(node.value || '')
  if (node.type === 'root') {
    return (node.children || []).map(hastToHtml).join('')
  }
  if (node.type === 'element') {
    const cls = node.properties?.className
    const classAttr = Array.isArray(cls)
      ? cls.length
        ? ` class="${cls.map((x) => escapeHtml(String(x))).join(' ')}"`
        : ''
      : cls
        ? ` class="${escapeHtml(String(cls))}"`
        : ''
    const kids = (node.children || []).map(hastToHtml).join('')
    return `<${node.tagName}${classAttr}>${kids}</${node.tagName}>`
  }
  return ''
}

/** Syntax-highlight fenced code for markdown preview (IDEA-like token classes). */
function highlightCodeToHtml(code: string, lang: string): string {
  const source = code || ''
  try {
    const key = (lang || '').trim().toLowerCase()
    if (key && previewLowlight.registered(key)) {
      return hastToHtml(previewLowlight.highlight(key, source) as HastNode)
    }
    const alias: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      rb: 'ruby',
      sh: 'bash',
      shell: 'bash',
      yml: 'yaml',
      md: 'markdown',
      rs: 'rust',
    }
    const mapped = alias[key]
    if (mapped && previewLowlight.registered(mapped)) {
      return hastToHtml(previewLowlight.highlight(mapped, source) as HastNode)
    }
    if (source.trim()) {
      return hastToHtml(previewLowlight.highlightAuto(source) as HastNode)
    }
  } catch {
    // fall through
  }
  return escapeHtml(source)
}


const MARK_TAGS: Record<string, string> = {
  code: 'code',
  bold: 'strong',
  italic: 'em',
  strike: 's',
  underline: 'u',
  highlight: 'mark',
}

function inlineNodesToHtml(nodes: PMNode[], interactiveWikiLinks = true): string {
  let html = ''
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      html += '<br/>'
      continue
    }
    if (node.type === 'image') {
      const src = sanitizeImageSrc(String(node.attrs?.src || ''))
      if (!src) continue
      const alt = escapeHtml(String(node.attrs?.alt || ''))
      html += `<img alt="${alt}" src="${escapeHtml(src)}" />`
      continue
    }
    if (node.type === 'formula') {
      const source = String(node.attrs?.latex || '')
      const latex = escapeHtml(source)
      const display = node.attrs?.displayMode ? ' display' : ''
      const rendered = katex.renderToString(source || '\\square', {
        displayMode: !!node.attrs?.displayMode,
        throwOnError: false,
        strict: false,
        output: 'htmlAndMathml',
      })
      html += `<span class="editor-formula${display}" data-lingbi-formula="${latex}" data-display-mode="${node.attrs?.displayMode ? 'true' : 'false'}">${rendered}</span>`
      continue
    }
    if (node.type === 'footnoteReference') {
      const name = String(node.attrs?.name || '').trim()
      if (!name) continue
      // 预览走路时带着「名字 → 定义序号」的映射，引用就能编号并跳到底部列表；
      // 没有映射（或引用没有对应定义）就显示名字本身，不装作有出处。
      const order = activeFootnoteOrder?.get(name)
      html += order
        ? `<sup class="mdFootnoteRef" id="fnref-${order}"><a href="#fn-${order}">[${order}]</a></sup>`
        : `<sup class="mdFootnoteRef">${escapeHtml(`[${name}]`)}</sup>`
      continue
    }
    if (node.type === 'inlineTag') {
      const name = escapeHtml(String(node.attrs?.name || '').trim())
      if (name) html += `<span class="editor-inline-tag" data-inline-tag data-tag-name="${name}">#${name}</span>`
      continue
    }
    if (node.type === 'wikiLink') {
      const target = escapeHtml(String(node.attrs?.target || ''))
      const alias = escapeHtml(String(node.attrs?.alias || ''))
      html += interactiveWikiLinks
        ? `<span class="wikiLink" role="link" tabindex="0" data-wiki-target="${target}" data-wiki-alias="${alias}"><span class="wikiLinkIcon" aria-hidden="true"></span>${alias || target}</span>`
        : alias || target
      continue
    }
    if (node.type !== 'text') continue

    let piece = escapeHtml(node.text || '')
    const marks = node.marks || []
    // Innermost first so the emitted nesting mirrors the mark order.
    for (const mark of marks) {
      const tag = MARK_TAGS[mark.type]
      if (tag) piece = `<${tag}>${piece}</${tag}>`
    }
    const link = marks.find((mark) => mark.type === 'link')
    const href = link ? sanitizeUrl(String(link.attrs?.href || '')) : ''
    if (href) {
      piece = `<a href="${escapeHtml(href)}">${piece}</a>`
    }
    html += piece
  }
  return html
}

/**
 * Renders one inline run to preview HTML. This deliberately reuses the same
 * token grammar as the editor parser (parseInlineMarks) so the preview pane and
 * the TipTap document can never disagree about what a line means, and so URL
 * sanitising happens in exactly one place.
 */
function inlineMdToHtml(text: string): string {
  return inlineNodesToHtml(parseInlineMarks(text))
}

type InlineMark = { type: string; attrs?: Record<string, unknown> }

/**
 * Inline token grammar. Ordering is significant: code spans win over everything
 * (their content is literal), the linked image must be tried before the plain
 * image and the link so `[![a](b)](c)` is not read as the short link
 * `[![a` + `](b)` plus trailing garbage, and the two-character emphasis runs
 * must precede the single-character ones.
 *
 * `_underscore_` emphasis requires non-word boundaries so identifiers such as
 * `snake_case_name` survive a Markdown round trip unchanged.
 */
const INLINE_TOKEN = new RegExp(
  [
    '(`+)([\\s\\S]*?)\\1', // 1,2 code span
    '\\$\\$([^$\\n]+?)\\$\\$', // 3 display formula
    '(?<!\\$)\\$([^$\\n]+?)\\$(?!\\$)', // 4 inline formula
    '\\[!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)', // 5,6,7,8 linked image
    '!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)', // 9,10,11 image
    '\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)', // 12,13 link
    '\\*\\*([\\s\\S]+?)\\*\\*', // 14 bold
    '__([\\s\\S]+?)__', // 15 bold
    '~~([\\s\\S]+?)~~', // 16 strike
    '==([\\s\\S]+?)==', // 17 highlight
    '<u>([\\s\\S]*?)<\\/u>', // 18 underline
    '\\*([^*\\n]+?)\\*', // 19 italic
    '(?<![A-Za-z0-9_])_([^_\\n]+?)_(?![A-Za-z0-9_])', // 20 italic
    '(?<![A-Za-z0-9_#])#([^#\\n]+?)#(?=$|[\\s.,，。!?！？;；:：()（）\\[\\]{}<>])', // 21 closed multi-word tag
    '(?<![A-Za-z0-9_#])#([^\\s#.,，。!?！？;；:：()（）\\[\\]{}<>]+)', // 22 compact tag
    // 脚注引用放最后：`[^1](url)` 要先让链接认走，图片/链接/标签都不吃 `[^x]` 才轮到它。
    '\\[\\^([^\\]\\n]+)\\]', // 23 footnote reference
    '(?<!\\\\)\\[\\[([^\\[\\]\\n]+)\\]\\]', // 24 wiki link
  ].join('|'),
  'g',
)

/**
 * `#` 前面紧贴着网址时它是锚点，不是行内标签 —— `https://host/#section` 这类
 * 文本里的 `#` 必须原样留着。
 *
 * 判据取「向左扫到空白为止的这一段」：网址不含空白，所以这段要么带协议头、要么
 * 带域名后缀，要么是 `/`、`?` 起头的相对路径。标点开头的标签（`：#灵感`、`(#灵感)`）
 * 那一段里没有这些特征，照旧按标签处理。
 */
function isUrlAnchor(text: string, index: number): boolean {
  let start = index
  while (start > 0 && !/\s/.test(text[start - 1])) start--
  const run = text.slice(start, index)
  return /:\/\//.test(run) || /\.[A-Za-z]{2,}(?:[/?#]|$)/.test(run) || /^[/?]/.test(run)
}

function withMark(marks: InlineMark[], next: InlineMark): InlineMark[] {
  return marks.some((m) => m.type === next.type) ? marks : [...marks, next]
}

function textNode(text: string, marks: InlineMark[]): PMNode {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

function parseInlineMarks(text: string, inherited: InlineMark[] = []): PMNode[] {
  if (!text) return []
  const nodes: PMNode[] = []
  const re = new RegExp(INLINE_TOKEN.source, 'g')
  let last = 0
  let m: RegExpExecArray | null

  const pushNested = (inner: string, mark: InlineMark) => {
    const children = parseInlineMarks(inner, withMark(inherited, mark))
    if (children.length) nodes.push(...children)
  }

  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(textNode(text.slice(last, m.index), inherited))
    last = m.index + m[0].length

    if (m[2] !== undefined) {
      // Code spans are literal: never recurse into them.
      // An empty code span (for example a quoted Markdown fence, `> ``` > ```)
      // must not become an empty ProseMirror text node. ProseMirror rejects
      // those nodes, which otherwise makes large-document progressive loading
      // fall back to an empty compatibility document.
      if (m[2]) nodes.push(textNode(m[2], withMark(inherited, { type: 'code' })))
    } else if (m[3] !== undefined) {
      nodes.push({ type: 'formula', attrs: { latex: m[3], displayMode: true } })
    } else if (m[4] !== undefined) {
      nodes.push({ type: 'formula', attrs: { latex: m[4], displayMode: false } })
    } else if (m[6] !== undefined) {
      // `[![alt](src)](href)`：图片节点是 `inline: false`，套不进链接标记，
      // 所以只保留图片本身（外层的链接目标在 Markdown 里会丢失，见 imageToMd）。
      const src = sanitizeImageSrc(m[6])
      if (src) {
        const attrs: Record<string, unknown> = { src, alt: m[5] || '' }
        if (m[7]) attrs.title = m[7]
        nodes.push({ type: 'image', attrs })
      } else if (m[5]) {
        nodes.push(textNode(m[5], inherited))
      }
    } else if (m[10] !== undefined) {
      const src = sanitizeImageSrc(m[10])
      if (src) {
        const attrs: Record<string, unknown> = { src, alt: m[9] || '' }
        if (m[11]) attrs.title = m[11]
        nodes.push({ type: 'image', attrs })
      } else if (m[9]) {
        nodes.push(textNode(m[9], inherited))
      }
    } else if (m[13] !== undefined) {
      const href = sanitizeUrl(m[13])
      if (href) {
        pushNested(m[12], { type: 'link', attrs: { href } })
      } else {
        // An unsafe target degrades to plain label text, not a live link.
        nodes.push(...parseInlineMarks(m[12], inherited))
      }
    } else if (m[14] !== undefined) {
      pushNested(m[14], { type: 'bold' })
    } else if (m[15] !== undefined) {
      pushNested(m[15], { type: 'bold' })
    } else if (m[16] !== undefined) {
      pushNested(m[16], { type: 'strike' })
    } else if (m[17] !== undefined) {
      pushNested(m[17], { type: 'highlight' })
    } else if (m[18] !== undefined) {
      pushNested(m[18], { type: 'underline' })
    } else if (m[19] !== undefined) {
      pushNested(m[19], { type: 'italic' })
    } else if (m[20] !== undefined) {
      pushNested(m[20], { type: 'italic' })
    } else if (m[21] !== undefined || m[22] !== undefined) {
      // 网址锚点不是标签：整段匹配原样当文本输出。
      if (isUrlAnchor(text, m.index)) {
        nodes.push(textNode(m[0], inherited))
        continue
      }
      const name = String(m[21] ?? m[22] ?? '').trim().replace(/^#|#$/g, '')
      if (name) nodes.push({ type: 'inlineTag', attrs: { name } })
    } else if (m[23] !== undefined) {
      const name = m[23].trim()
      if (name) nodes.push({ type: 'footnoteReference', attrs: { name } })
    } else if (m[24] !== undefined) {
      const link = parseWikiLink(m[24])
      nodes.push(link ? { type: 'wikiLink', attrs: link } : textNode(m[0], inherited))
    }
  }
  if (last < text.length) nodes.push(textNode(text.slice(last), inherited))
  return nodes
}

function paragraphFromLine(line: string): PMNode {
  const content = parseInlineMarks(line)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/**
 * 整行只有图片时把这些图片取出来，否则返回空数组。
 *
 * 复用 `parseInlineMarks` 而不是另写一套正则，url 消毒和 token 语法才不会两边分叉。
 */
function imagesFromImageOnlyLine(line: string): PMNode[] {
  const nodes = parseInlineMarks(line.trim())
  const images = nodes.filter((node) => node.type === 'image')
  if (!images.length) return []
  // 图片之间只允许空白，出现任何实义内容就还是普通段落。
  const solid = nodes.some((node) => node.type !== 'image' && (node.type !== 'text' || (node.text || '').trim()))
  return solid ? [] : images
}

/** 行里是否含图片节点，不论是否和文字混排。 */
function lineCarriesImage(line: string): boolean {
  return parseInlineMarks(line.trim()).some((node) => node.type === 'image')
}

/**
 * 一行里图片和文字混排时，按顺序拆成「段落 / 块级图片 / 段落」。
 *
 * 网页剪藏会产出 `![](icon.svg) 评论` 这种行。图片节点是 `inline: false`
 * （见 `ImageWithAlign.configure`），而段落的内容表达式只允许 inline，所以图片
 * 不能留在段落里 —— 否则解析出来的文档在 schema 上就是非法的：之后任何
 * `setNodeMarkup` 都会抛 `Invalid content for node type paragraph`，
 * 整个创作页随之白屏。整行只有图片的情况由 `imagesFromImageOnlyLine` 先接走。
 */
function blocksFromMixedImageLine(line: string): PMNode[] {
  const nodes = parseInlineMarks(line.trim())
  const solid = (node: PMNode) =>
    node.type !== 'image' && (node.type !== 'text' || (node.text || '').trim().length > 0)
  if (!nodes.some((node) => node.type === 'image') || !nodes.some(solid)) return []

  const blocks: PMNode[] = []
  let inline: PMNode[] = []
  const flushInline = () => {
    // 图片之间的纯空白不值得单独成段。
    if (inline.some(solid)) blocks.push({ type: 'paragraph', content: inline })
    inline = []
  }
  for (const node of nodes) {
    if (node.type === 'image') {
      flushInline()
      blocks.push(node)
      continue
    }
    inline.push(node)
  }
  flushInline()
  return blocks
}

/**
 * 一行 Markdown 拆成块级节点序列。图片节点是 `inline: false`，绝不能留在段落里。
 *
 * 返回空数组表示这一行没有可产出的块（纯空白），调用方自己决定要不要占位空段落。
 */
function blocksFromLine(line: string): PMNode[] {
  const images = imagesFromImageOnlyLine(line)
  if (images.length) return images
  const mixed = blocksFromMixedImageLine(line)
  if (mixed.length) return mixed
  return line.trim() ? [paragraphFromLine(line)] : []
}

type ListItemLine = { indent: number; ordered: boolean; text: string; checked: boolean | null }

function matchListItem(line: string): ListItemLine | null {
  const m = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line)
  if (!m) return null
  // Tabs count as one indent step; two spaces is the emitted convention.
  const indent = m[1].replace(/\t/g, '  ').length
  const task = m[2] ? /^\[([ xX])\]\s+(.*)$/.exec(m[4]) : null
  return {
    indent,
    ordered: !m[2],
    text: task ? task[2] : m[4],
    checked: task ? task[1].toLowerCase() === 'x' : null,
  }
}

/**
 * Parses one list, recursing for deeper indentation so `docToMarkdown`'s
 * two-space nesting survives the round trip instead of being flattened.
 */
function parseList(lines: string[], start: number): { node: PMNode; next: number } {
  const first = matchListItem(lines[start])!
  const baseIndent = first.indent
  const ordered = first.ordered
  const taskList = first.checked !== null
  const items: PMNode[] = []
  let i = start

  while (i < lines.length) {
    const current = matchListItem(lines[i])
    if (!current || current.indent < baseIndent) break
    // A sibling list of the other kind at the same level starts a new list.
    if (current.indent === baseIndent && (current.ordered !== ordered || (current.checked !== null) !== taskList)) break
    if (current.indent > baseIndent) {
      const nested = parseList(lines, i)
      const lastItem = items[items.length - 1]
      if (lastItem) lastItem.content = [...(lastItem.content || []), nested.node]
      else items.push({ type: 'listItem', content: [{ type: 'paragraph' }, nested.node] })
      i = nested.next
      continue
    }
    const itemBlocks = blocksFromLine(current.text)
    // listItem / taskItem 的内容表达式是 `paragraph block*`，首个子节点必须是段落。
    if (!itemBlocks.length || itemBlocks[0].type !== 'paragraph') itemBlocks.unshift({ type: 'paragraph' })
    items.push(taskList
      ? { type: 'taskItem', attrs: { checked: current.checked === true }, content: itemBlocks }
      : { type: 'listItem', content: itemBlocks })
    i++
  }

  return {
    node: { type: taskList ? 'taskList' : ordered ? 'orderedList' : 'bulletList', content: items },
    next: i,
  }
}

/* ------------------------------------------------------------------ *
 * 只能靠 HTML 表达的块：分页符、折叠块，以及排版行的行标记。
 * 三者在 Markdown 里都各占整行，解析和预览都按整行匹配，绝不下探到行内。
 * ------------------------------------------------------------------ */

const HTML_COMMENT_LINE_RE = /^<!--[\s\S]*?-->$/
/** 认 Typora 的 `page-break-after` 和 CSS3 的 `break-after`，写法宽一点好导入。 */
const PAGE_BREAK_LINE_RE = /^<div[^>]*(?:page-break-after|break-after)\s*:\s*(?:always|page)[^>]*>\s*(?:<\/div>)?$/i
const DETAILS_OPEN_RE = /^<details(?:\s[^>]*)?>$/i
const DETAILS_CLOSE_RE = /^<\/details>$/i
const SUMMARY_LINE_RE = /^<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>$/i
/**
 * 单独占一行的空标签。README 里常拿 `<br/>` 当块间距，它本身没有任何内容可读，
 * 落进段落就会变成一段可见的 `<br/>` 文字 —— 和"表格变成尖括号"是同一类毛病。
 * 只收纯占位标签：`<hr>` 有语义，不该被静默丢掉。
 */
const VOID_HTML_LINE_RE = /^<(?:br|wbr)\s*\/?>$/i
/** GitHub 警告：`> [!NOTE]`，也认同一行就带正文的紧凑写法。 */
const CALLOUT_ALERT_RE = /^\[!([A-Za-z]+)\]\s*(.*)$/

/** 段落不能把这些整行 HTML 吸进来，否则它们会变成一段可见的尖括号文字。 */
function isHtmlBlockLine(line: string): boolean {
  const trimmed = (line || '').trim()
  if (!trimmed.startsWith('<')) return false
  return (
    HTML_COMMENT_LINE_RE.test(trimmed) ||
    PAGE_BREAK_LINE_RE.test(trimmed) ||
    DETAILS_OPEN_RE.test(trimmed) ||
    DETAILS_CLOSE_RE.test(trimmed) ||
    SUMMARY_LINE_RE.test(trimmed) ||
    VOID_HTML_LINE_RE.test(trimmed)
  )
}

/** `<details>` … `</details>` 的整块范围，支持嵌套。 */
function readDetailsBlock(lines: string[], start: number): { summary: string; body: string[]; open: boolean; next: number } {
  const open = /\sopen(?:\s|=|>)/i.test(lines[start])
  let i = start + 1
  let depth = 1
  const inner: string[] = []
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (DETAILS_OPEN_RE.test(trimmed)) depth += 1
    if (DETAILS_CLOSE_RE.test(trimmed)) {
      depth -= 1
      if (depth === 0) {
        i += 1
        break
      }
    }
    inner.push(lines[i])
    i += 1
  }

  let summary = ''
  const body: string[] = []
  for (const line of inner) {
    const match = SUMMARY_LINE_RE.exec(line.trim())
    if (match && !summary.trim()) {
      summary = match[1]
      continue
    }
    body.push(line)
  }
  return { summary, body, open, next: i }
}

/* ------------------------------------------------------------------ *
 * 手写 HTML 表格
 *
 * README、Typora 导出的 Markdown 里，表格常常是手写 HTML
 * （`<table><tr><td align="center" width="33%">`）而不是管道表格。
 * 之前这类整行 HTML 不在 `isHtmlBlockLine` 的白名单里，会被段落分支吸进去，
 * 变成一串可见的尖括号文字 —— 用户看到的就是"这份文件坏掉了"。
 *
 * 这里把它读成原生表格节点：编辑器里能直接改，预览和导出走同一份数据。
 * 只认表格相关的标签与属性，其余标签一律剥掉、内容保留。
 * ------------------------------------------------------------------ */

const HTML_TABLE_START_RE = /^<table\b/i
const HTML_TABLE_ROW_RE = /<tr\b[^>]*>/gi
const HTML_TABLE_CELL_RE = /<(td|th)\b([^>]*)>/gi

/**
 * 单元格横向对齐 → 白名单，不认识的取值返回 null。
 *
 * 三处需要同一份判断且必须一致：本文件解析手写 HTML 表格时、单元格 schema
 * （`features/writing/TableExtensions.ts`）、以及 Go 渲染端
 * （`publication_article_renderer.go` 的 normalizePublicationCellAlign）。
 * 三端禁止互相引用，所以各存一份，改一处要同步另两处。
 */
export function normalizeTableCellAlign(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'left' || raw === 'center' || raw === 'right' || raw === 'justify') return raw
  // `start` 是逻辑值，LTR 文档里等于 left；`middle` 是 <td align> 里常见的笔误。
  if (raw === 'start') return 'left'
  if (raw === 'middle') return 'center'
  return null
}

/**
 * 读一个完整的 `<table>…</table>` 块。
 *
 * 标签之间允许空行 —— GitHub README 的常见写法就是每个 `</tr>` 后面空一行，
 * 而 CommonMark 的 HTML block 遇空行就结束，逐行处理会把表格切碎。
 * 没有闭合标签时返回 null，交给后面的分支按原文处理（与改动前一致）。
 */
function readHtmlTableBlock(lines: string[], start: number): { html: string; next: number } | null {
  if (!HTML_TABLE_START_RE.test(lines[start].trim())) return null
  const collected: string[] = []
  let depth = 0
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    collected.push(line)
    depth += (line.match(/<table\b/gi) || []).length
    depth -= (line.match(/<\/table\s*>/gi) || []).length
    if (depth <= 0) return { html: collected.join('\n'), next: i + 1 }
  }
  return null
}

interface HtmlTableCell {
  header: boolean
  align: string | null
  colspan: number
  rowspan: number
  html: string
}

/** 从一个标签的属性串里取属性值，去引号。 */
function htmlAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i').exec(attrs)
  if (!match) return null
  return match[1].replace(/^["']|["']$/g, '')
}

/**
 * 按 `<tr>` 开标签切分。
 * HTML 里 `</tr>` 可以省略（手写表格很常见），所以不能按结束标签配对。
 */
function splitHtmlTableRows(html: string): string[] {
  return html
    .split(HTML_TABLE_ROW_RE)
    .slice(1)
    .map((row) => row.replace(/<\/tr\s*>/gi, ''))
}

/** 同理，`</td>` / `</th>` 也可以省略，按开标签切分。 */
function splitHtmlTableCells(rowHtml: string): HtmlTableCell[] {
  const starts: { tagStart: number; contentStart: number; header: boolean; attrs: string }[] = []
  const re = new RegExp(HTML_TABLE_CELL_RE.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(rowHtml))) {
    starts.push({
      tagStart: match.index,
      contentStart: match.index + match[0].length,
      header: match[1].toLowerCase() === 'th',
      attrs: match[2],
    })
  }
  return starts.map((cell, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].tagStart : rowHtml.length
    const style = htmlAttr(cell.attrs, 'style') || ''
    const styleAlign = /text-align\s*:\s*([^;]+)/i.exec(style)?.[1]
    return {
      header: cell.header,
      align: normalizeTableCellAlign(htmlAttr(cell.attrs, 'align') || styleAlign),
      colspan: Math.max(1, parseInt(htmlAttr(cell.attrs, 'colspan') || '', 10) || 1),
      rowspan: Math.max(1, parseInt(htmlAttr(cell.attrs, 'rowspan') || '', 10) || 1),
      html: rowHtml.slice(cell.contentStart, end).replace(/<\/(td|th)\s*>\s*$/i, ''),
    }
  })
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    const key = entity.toLowerCase()
    if (key in HTML_ENTITY_MAP) return HTML_ENTITY_MAP[key]
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : key.startsWith('#') ? parseInt(key.slice(1), 10) : NaN
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
    try {
      return String.fromCodePoint(code)
    } catch {
      return whole
    }
  })
}

/**
 * 单元格内的一段 HTML → Markdown 片段，再交给 `docFromMarkdown` 递归解析。
 *
 * 复用现有块解析器（标题、段落、列表、引用、图片都现成），与 `<details>` 正文
 * 的处理方式一致。嵌套表格的标签在这里被剥掉，所以不会无限递归。
 */
function htmlFragmentToMarkdown(html: string): string {
  let text = html
  text = text.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
    (_whole, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner}\n\n`,
  )
  text = text.replace(/<\/(p|div|section|blockquote|li)\s*>/gi, '\n\n')
  text = text.replace(/<(p|div|section|blockquote)\b[^>]*>/gi, '\n\n')
  text = text.replace(/<li\b[^>]*>/gi, '\n- ')
  text = text.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '**$2**')
  text = text.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '*$2*')
  text = text.replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '~~$2~~')
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, '`$1`')
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = htmlAttr(tag, 'src')
    return src ? `![${htmlAttr(tag, 'alt') || ''}](${src})` : ''
  })
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_whole, attrs: string, inner: string) => {
    const href = htmlAttr(attrs, 'href')
    return href ? `[${inner}](${href})` : inner
  })
  text = text.replace(/<br\s*\/?>/gi, '\n')
  // 其余标签一律剥掉、内容保留。
  text = text.replace(/<[^>]*>/g, '')
  return decodeHtmlEntities(text).trim()
}

function htmlTableToNode(html: string): PMNode | null {
  const rows = splitHtmlTableRows(html)
    .map(splitHtmlTableCells)
    .filter((cells) => cells.length > 0)
  if (!rows.length) return null

  const columnCount = Math.max(...rows.map((row) => row.length))
  // 列宽同样按内容算（HTML 表格里的文字要先剥标签、解实体才是真实宽度）。
  const widths = columnWidthsForRows(
    rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => htmlFragmentToMarkdown(row[index]?.html ?? '')),
    ),
  )
  const toCell = (cell: HtmlTableCell | undefined, column: number): PMNode => {
    const attrs: Record<string, unknown> = {}
    if (cell?.align) attrs.align = cell.align
    if (cell && cell.colspan > 1) attrs.colspan = cell.colspan
    if (cell && cell.rowspan > 1) attrs.rowspan = cell.rowspan
    // colspan 的格子要吃掉所跨各列的宽度（colwidth 是「每跨一列一个数」的数组）。
    const span = cell && cell.colspan > 1 ? cell.colspan : 1
    attrs.colwidth = Array.from({ length: span }, (_, offset) => widths[column + offset] ?? widths[column] ?? 0)
    const parsed = cell ? (docFromMarkdown(htmlFragmentToMarkdown(cell.html)) as PMNode) : null
    const blocks = parsed?.content || []
    return {
      type: cell?.header ? 'tableHeader' : 'tableCell',
      attrs,
      content: blocks.length ? blocks : [{ type: 'paragraph' }],
    }
  }

  return {
    type: 'table',
    content: rows.map((row) => ({
      type: 'tableRow',
      // 补齐缺格的短行，ProseMirror 的表格必须是矩形。
      content: Array.from({ length: columnCount }, (_, index) => toCell(row[index], index)),
    })),
  }
}

/** 预览用：把手写 HTML 表格重建成结构化的 HTML，不原样透传用户 HTML。 */
function htmlTableToPreviewHtml(html: string, rootAttrs = ''): string | null {
  const rows = splitHtmlTableRows(html)
    .map(splitHtmlTableCells)
    .filter((cells) => cells.length > 0)
  if (!rows.length) return null

  const toCellHtml = (cell: HtmlTableCell, tag: 'td' | 'th') => {
    const style = cell.align ? ` style="text-align: ${cell.align}"` : ''
    const inner = markdownToPreviewHtml(htmlFragmentToMarkdown(cell.html), { pmBlocks: false })
    return `<${tag}${style}>${inner}</${tag}>`
  }
  // 只有整行都是 <th> 才当成表头行；README 里的三栏卡片通常全是 <td>。
  const headerRow = rows[0].every((cell) => cell.header) ? rows[0] : null
  const bodyRows = headerRow ? rows.slice(1) : rows
  const head = headerRow ? `<thead><tr>${headerRow.map((cell) => toCellHtml(cell, 'th')).join('')}</tr></thead>` : ''
  const body = bodyRows
    .map((row) => `<tr>${row.map((cell) => toCellHtml(cell, cell.header ? 'th' : 'td')).join('')}</tr>`)
    .join('')
  // 列宽按内容算（与 docFromMarkdown 的 colwidth 同一口径），否则 fixed 布局下各列等宽。
  const colgroup =
    '<colgroup>' +
    columnWidthsToPercent(
      columnWidthsForRows(rows.map((row) => row.map((cell) => htmlFragmentToMarkdown(cell.html)))),
    )
      .map((percent) => `<col style="width:${percent}%" />`)
      .join('') +
    '</colgroup>'
  return `<div class="mdTableWrap"${rootAttrs}><table>${colgroup}${head}<tbody>${body}</tbody></table></div>`
}

/** Convert markdown/plain to TipTap doc. */
/**
 * A node the Markdown writer could not express, written as a JSON comment. The
 * Go writer emits exactly this form (`internal/markdown`'s rawNodePrefix) for
 * every node whose registry disposition is PreservedRaw — today the canvas and
 * mind-map references.
 */
const BLC_NODE_LINE_RE = /^<!--\s*blc:node\s+([\s\S]*?)\s*-->$/

/**
 * Restores one of those nodes from its marker.
 *
 * Without this the visual editor drops the marker on the way in and writes the
 * document back without it, so a canvas or mind-map reference disappears on the
 * next save. Architecture doc §12 forbids that: an unsupported Markdown
 * extension is kept as a raw node or refused, never silently lost.
 */
function parseRawNodeMarker(line: string): PMNode | null {
  const match = BLC_NODE_LINE_RE.exec(line)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1]) as PMNode
    if (!parsed || typeof parsed.type !== 'string' || !parsed.type) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * CommonMark 的行尾预处理。所有 markdown 入口都要先过这一层。
 *
 * 编辑器以前把行尾的**孤立 CR** 和**行尾空白**原样吃进了文档：它们在编辑器里看不见、
 * 光标很难停在上面，用户删不掉；下游空行判断和导出也会把这些字符当成内容。
 * 在入口清掉，文档里就不会再出现这类字符。
 *
 * 三条规则都来自 CommonMark：
 *  - §2.1 行尾：CR、CRLF、LF 都算换行，统一成 LF。只替换 CRLF 会漏掉孤立 CR ——
 *    旧写法 `replace(/\r\n/g, '\n')` 正是这么漏的。
 *  - §2.3 不安全字符：U+0000 一律换成 U+FFFD。
 *  - §6.8 硬换行：行尾两个以上空格表示硬换行，**空格本身不进内容**；段落最后一行
 *    的行尾空白同样丢弃。围栏代码块里的行尾空白是内容，必须原样保留。
 *
 * 行尾空白用 `\s` 而不是 CommonMark 的「空格与制表符」，是**刻意放宽**：中文稿子里
 * 全角空格、NBSP、零宽不换行空格同样看不见也删不掉，因此一并清理。
 */
/**
 * 围栏行判定（CommonMark §4.5）：``` 开头即围栏，**允许 1-3 个空格的缩进** ——
 * 从聊天记录、IDE、别的笔记里拷出来的代码块，围栏常常带着缩进。此前只认顶格：
 * 缩进的**开头**围栏落进段落，被行内记号器当成一对 ``` 行内代码，整块代码缩成
 * 一行行内代码芯片；缩进的**闭合**围栏则让代码块一路吞到文件尾。
 *
 * docFromMarkdown、markdownToPreviewHtml、preprocessMarkdownSource 三处的围栏
 * 判定都必须走这里，否则两边对「哪几行是代码」会错开。
 *
 * 返回剥掉缩进后的行首（``` 加语言串），不是围栏行时返回 null。缩进 4 个空格
 * 及以上不算围栏（那是 CommonMark 的缩进代码块，本渲染器按段落处理）。
 */
export function markdownFenceLine(line: string): string | null {
  const stripped = line.replace(/^ {1,3}/, '')
  return stripped.startsWith('```') ? stripped : null
}

/**
 * ATX 标题行判定（CommonMark §4.2）：`#` 后必须跟空格，**允许 1-3 个空格的缩进** ——
 * 与围栏同理，拷来的稿子标题常带着缩进；此前只认顶格，缩进标题整行落进段落，
 * 预览里「## 标题」原样显形。缩进 4 空格起是缩进代码块，不算标题。
 * 返回级别与标题文本，不是标题行时返回 null。docFromMarkdown 与 markdownToPreviewHtml
 * 的标题判定（含段落打断）都必须走这里。
 */
export function markdownHeadingLine(line: string): { level: number; text: string } | null {
  const match = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line)
  return match ? { level: match[1].length, text: match[2] } : null
}

export function preprocessMarkdownSource(source: string): string {
  const unified = (source || '').replace(/\u0000/g, '\uFFFD').replace(/\r\n?/g, '\n')
  // 不要为"没有换行"开快捷路径：单行文本同样有行尾空白要清，漏掉这一条就会留下
  // 一个只在单行时复现的差异。
  const lines = unified.split('\n')
  let fenced = false
  for (let index = 0; index < lines.length; index += 1) {
    // 围栏判定必须和 docFromMarkdown / markdownToPreviewHtml 完全一致，
    // 否则两边的"哪几行是代码"会错开，代码块里的空白就会被误删。
    if (markdownFenceLine(lines[index])) {
      fenced = !fenced
      continue
    }
    if (!fenced) lines[index] = lines[index].replace(/\s+$/u, '')
  }
  return lines.join('\n')
}

/**
 * 块级公式：`$$` 行首开块，内容允许跨行，到下一处以 `$$` 结尾的行收块。
 * 行内记号器只认同一行里的 `$$…$$`（`[^$\n]` 不跨行），所以标准的
 * 「`$$` 独占一行、公式占几行、再一行 `$$`」写法会散成纯文本 —— 这里补上块级读取。
 *
 * 收块行两种形状：`$$` 独占一行，或最后一行公式直接以 `$$` 收尾
 * （docToMarkdown 序列化带换行的 latex 时正是后者）。收不到就返回 null，
 * 让调用方按普通段落走 —— 没写完的公式块不能整段吞掉。
 */
function readMathBlock(lines: string[], start: number): { latex: string; next: number } | null {
  const trimmed = lines[start].trim()
  if (!trimmed.startsWith('$$')) return null
  // `$$E=mc^2$$` 单行成块：行内记号器本来就认，原样交给它。
  if (trimmed.slice(2).includes('$$')) return null
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimEnd().endsWith('$$')) {
      const close = line.trimEnd().slice(0, -2)
      // `a $$ b $$` 这类行不是收块行，别把半截 latex 当公式。
      if (!close.includes('$$')) {
        if (close.trim()) body.push(close)
        const latex = body.join('\n').trim()
        if (!latex) return null
        return { latex, next: i + 1 }
      }
    }
    body.push(line)
  }
  return null
}

/** 脚注定义行：`[^name]: 内容`。带冒号，和行首的引用 `[^name]` 靠这一点区分。 */
const FOOTNOTE_DEF_LINE = /^\[\^([^\]\s]+)\]:\s?(.*)$/

function isFootnoteDefinitionLine(line: string): boolean {
  return FOOTNOTE_DEF_LINE.test(line.trim())
}

/**
 * 脚注定义：`[^name]: 内容`。缩进的续行并进同一条脚注（空行或顶行文本结束定义）。
 * 引用 `[^name]` 由行内记号器认；这里只管定义块。内容为空的定义不收 ——
 * 收进文档只会造出一个空块，按普通文本显示反而能让人看出哪里没写完。
 */
function readFootnoteDefinition(lines: string[], start: number): { name: string; body: string; next: number } | null {
  const m = FOOTNOTE_DEF_LINE.exec(lines[start].trim())
  if (!m) return null
  const body = [m[2]]
  let i = start + 1
  while (i < lines.length && lines[i].trim() && /^\s/.test(lines[i])) {
    body.push(lines[i].trim())
    i++
  }
  const text = body.join('\n').trim()
  if (!text) return null
  return { name: m[1], body: text, next: i }
}

/**
 * 脚注名字 → 定义出现顺序（1 起）。预览里引用编号跟定义顺序走，而不是名字本身 ——
 * `[^note]` 这样的名字没法当编号。引用比定义先出现（正常写法）也没关系，
 * 预览渲染前先扫一遍全文。必须复用 readFootnoteDefinition：空定义不算数，
 * 否则编号和底部列表会对不上。
 */
function collectFootnoteOrder(lines: string[]): Map<string, number> {
  const order = new Map<string, number>()
  for (let i = 0; i < lines.length; ) {
    const def = readFootnoteDefinition(lines, i)
    if (def) {
      if (!order.has(def.name)) order.set(def.name, order.size + 1)
      i = def.next
      continue
    }
    i++
  }
  return order
}

/**
 * 行内渲染期间生效的脚注序号表。渲染是单线程同步的，markdownToPreviewHtml
 * 进入时设置、退出时清掉；为 null 时引用退化为显示名字的上标。
 */
let activeFootnoteOrder: ReadonlyMap<string, number> | null = null

export function docFromMarkdown(md: string): Record<string, unknown> {
  const text = preprocessMarkdownSource(md)
  if (!text.trim()) return emptyTiptapDoc()

  const lines = text.split('\n')
  const content: PMNode[] = []
  let pendingImageMarker: ImageMarker | null = null
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (i === 0 && line === '---') {
      const end = lines.findIndex((value, index) => index > 0 && /^(---|\.\.\.)$/.test(value))
      if (end > 0) {
        content.push({ type: 'rawMarkdown', attrs: { source: lines.slice(0, end + 1).join('\n') } })
        i = end + 1
        continue
      }
    }

    // Legacy 图文排版标记行：忽略，按普通 markdown 继续解析后面的内容。
    if (MEDIA_ROW_MARKER_LINE_RE.test(line.trim())) {
      i++
      continue
    }
    // 图片标记（宽度 / 非居中对齐）只作用于紧跟着的那一张图。
    const imageMarker = parseImageMarker(line)
    if (imageMarker) {
      pendingImageMarker = imageMarker
      i++
      continue
    }
    // 标记只作用于紧跟着的一块，别的块顺手把它清掉，免得漂到后面去。
    const nextImageMarker = pendingImageMarker
    pendingImageMarker = null

    // 应用自己写出的原样保留节点（画布、思维导图引用）必须读回来，否则下一次保存
    // 就把引用悄悄丢了。这一条要排在「整行 HTML 一律丢弃」之前。
    const rawNode = parseRawNodeMarker(line.trim())
    if (rawNode) {
      content.push(rawNode)
      i++
      continue
    }

    if (PAGE_BREAK_LINE_RE.test(line.trim())) {
      content.push({ type: 'pageBreak' })
      i++
      continue
    }

    if (DETAILS_OPEN_RE.test(line.trim())) {
      const details = readDetailsBlock(lines, i)
      i = details.next
      const summary = parseInlineMarks(details.summary.trim() || COLLAPSIBLE_DEFAULT_SUMMARY)
      const body = docFromMarkdown(details.body.join('\n')) as PMNode
      content.push({
        type: 'collapsible',
        attrs: { open: details.open },
        content: [
          { type: 'collapsibleSummary', content: summary.length ? summary : undefined },
          ...(body.content?.length ? body.content : [{ type: 'paragraph' }]),
        ],
      })
      continue
    }

    // 手写 HTML 表格（README / Typora 导出里很常见）→ 原生表格。
    // 必须排在「整行 HTML 一律丢弃」之前，否则表格会被当成认不出的 HTML 整块丢掉。
    const htmlTable = readHtmlTableBlock(lines, i)
    if (htmlTable) {
      const tableNode = htmlTableToNode(htmlTable.html)
      if (tableNode) {
        content.push(tableNode)
        i = htmlTable.next
        continue
      }
    }

    // Preserve unsupported HTML/comments as inert source, rather than losing them on save.
    if (isHtmlBlockLine(line)) {
      const start = i++
      if (line.trimStart().startsWith('<!--') && !line.includes('-->')) {
        while (i < lines.length && !lines[i - 1].includes('-->')) i++
      }
      content.push({ type: 'rawMarkdown', attrs: { source: lines.slice(start, i).join('\n') } })
      continue
    }

    const fence = markdownFenceLine(line)
    if (fence) {
      const lang = fence.slice(3).trim()
      i++
      const codeLines: string[] = []
      while (i < lines.length && !markdownFenceLine(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length && markdownFenceLine(lines[i])) i++
      content.push({
        type: 'codeBlock',
        attrs: { language: lang || null },
        content: codeLines.length ? [{ type: 'text', text: codeLines.join('\n') }] : [],
      })
      continue
    }

    // 块级公式排在表格之前：公式里常见 `|`（\left| x \right|），不能让表格分支截胡。
    const mathBlock = readMathBlock(lines, i)
    if (mathBlock) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'formula', attrs: { latex: mathBlock.latex, displayMode: true } }],
      })
      i = mathBlock.next
      continue
    }

    const footnoteDef = readFootnoteDefinition(lines, i)
    if (footnoteDef) {
      content.push({
        type: 'footnoteDefinition',
        attrs: { name: footnoteDef.name },
        content: [paragraphFromLine(footnoteDef.body)],
      })
      i = footnoteDef.next
      continue
    }

    const tableHeader = splitMarkdownTableRow(line)
    const tableSeparator = tableHeader ? nextNonEmptyLine(lines, i + 1) : -1
    if (tableHeader && tableSeparator < lines.length && isMarkdownTableSeparator(lines[tableSeparator])) {
      i = tableSeparator + 1
      const bodyRows: string[][] = []
      while (i < lines.length) {
        if (!lines[i].trim()) {
          i += 1
          continue
        }
        const row = splitMarkdownTableRow(lines[i])
        if (!row) break
        bodyRows.push(row)
        i++
      }
      content.push(markdownTableToNode(tableHeader, bodyRows))
      continue
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      content.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const heading = markdownHeadingLine(line)
    if (heading) {
      const level = heading.level
      const inner = parseInlineMarks(heading.text)
      content.push({
        type: 'heading',
        attrs: { level },
        content: inner.length ? inner : undefined,
      })
      i++
      continue
    }

    // `>text` without a space is still a quote in CommonMark.
    if (/^>/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      // 首行是 GitHub 警告标记的引用其实是提示框，别当普通引用。
      const alert = CALLOUT_ALERT_RE.exec((quoteLines[0] || '').trim())
      const kind = alert ? calloutKindFromAlert(alert[1]) : null
      if (alert && kind) {
        const rest = quoteLines.slice(1)
        // `> [!NOTE] 正文` 这种紧凑写法里，正文就跟在标记后面。
        if (alert[2].trim()) rest.unshift(alert[2])
        const body = docFromMarkdown(rest.join('\n')) as PMNode
        content.push({
          type: 'callout',
          attrs: { kind },
          content: body.content?.length ? body.content : [{ type: 'paragraph' }],
        })
        continue
      }
      // 引用内容整体递归解析，不能逐行处理：逐行只认单行块，引用里的围栏代码、
      // 表格、嵌套引用会整块退化成纯文本。提示框那条分支一直是递归解析的，所以那边没事。
      const body = docFromMarkdown(quoteLines.join('\n')) as PMNode
      content.push({
        type: 'blockquote',
        // blockquote 的内容表达式是 `block+`，空引用要留一个空段落占位。
        content: body.content?.length ? body.content : [{ type: 'paragraph' }],
      })
      continue
    }

    // 一行多张图 → 连续的块级图片；单张图同样是块级图片。
    // 图片节点是 inline: false（见 ImageWithAlign），塞进段落解析时会被 schema 丢弃。
    const lineImages = imagesFromImageOnlyLine(line)
    if (lineImages.length) {
      lineImages.forEach((image, index) => {
        content.push(withImageMarker(image, index === 0 ? nextImageMarker : null))
      })
      i++
      continue
    }

    if (matchListItem(line)) {
      const consumed = parseList(lines, i)
      content.push(consumed.node)
      i = consumed.next
      continue
    }

    // 图片和文字混在一行（网页剪藏常见：`![](icon.svg) 评论`）。图片是块级节点，
    // 留在段落里会让段落内容不合法，编辑器改节点属性时直接抛错把创作页打白。
    // 必须排在列表之后：`- ![](icon.svg) 条目` 是列表项，不是图文混排行。
    if (lineCarriesImage(line)) {
      content.push(...blocksFromLine(line))
      i++
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const paraLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !markdownHeadingLine(lines[i]) &&
      !lines[i].startsWith('>') &&
      !markdownFenceLine(lines[i]) &&
      // 块级公式和围栏代码一样能打断段落，否则紧跟段落的 $$ 块会被整段吸进来。
      !lines[i].startsWith('$$') &&
      // 脚注定义行同理。判断带冒号 —— 行首的引用 `[^1] 文字` 不断段。
      !isFootnoteDefinitionLine(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) &&
      // 整行 HTML（分页符、折叠块、排版行标记）是独立的块。
      !isHtmlBlockLine(lines[i]) &&
      // 手写 HTML 表格也是独立的块，不能被上一段吸进去。
      !HTML_TABLE_START_RE.test(lines[i].trim()) &&
      // 紧跟着的整行图片是独立的块，不能被吸进上一段。
      !imagesFromImageOnlyLine(lines[i]).length &&
      // 夹着图片的行同理：吸进段落就会造出内容非法的段落。
      !lineCarriesImage(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    content.push(paragraphFromLine(paraLines.join('\n')))
  }

  return {
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph' }],
  }
}

/**
 * Preview counterpart of `parseList`. It walks the same indentation rules so the
 * preview pane and the TipTap document agree about list nesting; a flat renderer
 * silently dropped every sub-level.
 *
 * `pmClasses` 只给顶层列表用 —— 嵌套子列表在编辑器里不是顶层节点，不吃块类名。
 */
function renderList(
  lines: string[],
  start: number,
  pmClasses?: string,
  source?: { ordinal: number },
  isRoot = true,
): { html: string; next: number } {
  const first = matchListItem(lines[start])!
  const baseIndent = first.indent
  const ordered = first.ordered
  const taskList = first.checked !== null
  const attrs = (from: number, to: number): string =>
    source ? ` data-src-start="${from}" data-src-end="${to}" data-src-block="${source.ordinal}"` : ''
  const items: Array<{ start: number; end: number; html: string }> = []
  let i = start

  while (i < lines.length) {
    const current = matchListItem(lines[i])
    if (!current || current.indent < baseIndent) break
    if (current.indent === baseIndent && (current.ordered !== ordered || (current.checked !== null) !== taskList)) break
    if (current.indent > baseIndent) {
      const nested = renderList(lines, i, undefined, source, false)
      if (items.length) {
        const last = items[items.length - 1]
        last.html += nested.html
        last.end = nested.next - 1
      } else {
        items.push({ start: i, end: nested.next - 1, html: nested.html })
      }
      i = nested.next
      continue
    }
    const itemStart = i
    const content = inlineMdToHtml(current.text)
    let itemHtml = taskList
      ? `<label><input type="checkbox" disabled${current.checked ? ' checked' : ''}><span>${content}</span></label>`
      : content
    i++
    // 子列表属于当前这一项：行范围要一起覆盖，点击子项时 closest 仍能落回自己的 <li>。
    while (i < lines.length) {
      const nestedLine = matchListItem(lines[i])
      if (!nestedLine || nestedLine.indent <= baseIndent) break
      const nested = renderList(lines, i, undefined, source, false)
      itemHtml += nested.html
      i = nested.next
    }
    items.push({ start: itemStart, end: i - 1, html: itemHtml })
  }

  const tag = ordered ? 'ol' : 'ul'
  const listClasses = [pmClasses, taskList ? 'mdTaskList' : ''].filter(Boolean).join(' ')
  const listAttrs = source && isRoot ? attrs(start, Math.max(start, i - 1)) : ''
  return {
    html: `<${tag}${listClasses ? ` class="${listClasses}"` : ''}${listAttrs}>${items.map((item) => `<li${attrs(item.start, item.end)}>${item.html}</li>`).join('')}</${tag}>`,
    next: i,
  }
}

/**
 * 预览里的目录：正文里单独一行写 `[TOC]`（大小写不敏感）就在这里放一份目录。
 *
 * 标记识别与目录块的 DOM 都在 `lib/toc.ts` —— 三条渲染链路（源码预览 / 所见即所得 /
 * 公众号导出）共用那一份，主题才有一套稳定的类名可写。这里只负责「从 Markdown 行里
 * 挑出 H2」这一件事。
 *
 * 锚点复用标题自己那套 `markdownAnchorSlug`（标题渲染时已经写了同一个 `id`），点击由
 * `handleEditorLinkClick` 接管、在预览容器里平滑滚动，这里不需要挂任何事件。
 * 标签走 `inlineMdToHtml`：标题里的 `**强调**`、`` `代码` `` 在目录里也照原样显示。
 */
function previewTocHtml(lines: string[], attrs = ''): string {
  const entries: TocEntry[] = []
  for (const line of lines) {
    const heading = markdownHeadingLine(line)
    if (!heading || heading.level !== 2) continue
    const anchor = markdownAnchorSlug(heading.text)
    entries.push({ label: inlineNodesToHtml(parseInlineMarks(heading.text), false), href: anchor || undefined })
  }
  return tocHtml(entries, attrs)
}

/**
 * Markdown to HTML for preview pane.
 *
 * `pmBlocks`：顶层块要不要挂 `pm-*` 类名。富文本编辑器由 ThemeBlockClassesExtension
 * 给顶层块挂同一套类名，主题 CSS（`.pm-heading-1` 面板、`.pm-readable-block` 间距…）
 * 靠它们同时命中两处 —— 源码预览不挂的话，同一份主题在两种模式下就是两张皮。
 * 折叠块内部是嵌套内容，编辑器的装饰只到顶层为止，所以递归时关掉。
 *
 * `sourceMap`：给每个可定位块写 `data-src-start` / `data-src-end` / `data-src-block`，
 * 供源码预览做双向定位。默认关闭，导出和公众号拿到的 HTML 一个字节都不变。
 */
export function markdownToPreviewHtml(md: string, options?: { pmBlocks?: boolean; sourceMap?: boolean }): string {
  const pmBlocks = options?.pmBlocks !== false
  const sourceMap = options?.sourceMap === true
  const text = preprocessMarkdownSource(md)
  if (!text.trim()) {
    return '<p class="md-empty">预览区域</p>'
  }
  const lines = text.split('\n')
  const html: string[] = []
  const footnoteDefs: Array<{
    name: string
    body: string
    startLine: number
    endLine: number
    ordinal: number
  }> = []
  // 引用编号要靠定义顺序，而定义往往在引用后面 —— 先扫一遍全文建好序号表。
  // try/finally 保证任何一条提前 return 都不会把表泄漏到下一次渲染。
  const previousFootnoteOrder = activeFootnoteOrder
  activeFootnoteOrder = collectFootnoteOrder(lines)
  let blockIndex = 0
  /** 顶层块类名 + 计数：与编辑器的 doc 顶层节点一一对应，pm-first-block 才不会错位。 */
  const pmClass = (type: string, block?: { level?: number; hasText?: boolean; multiline?: boolean }): string => {
    const classes = pmBlocks
      ? blockClasses({
        type,
        level: block?.level,
        hasText: block?.hasText ?? false,
        index: blockIndex,
        multiline: block?.multiline ?? false,
      })
      : ''
    blockIndex += 1
    return classes
  }
  /** 编辑器里不吃块类名的顶层节点（分页符/代码块/表格/图片行…）也要占一个序号。 */
  const skipPm = () => {
    blockIndex += 1
  }
  /** 源码行锚点；sourceMap 关闭时返回空串，导出/公众号输出保持原样。 */
  const srcAttrs = (startLine: number, endLine: number, ordinal: number): string =>
    sourceMap ? ` data-src-start="${startLine}" data-src-end="${endLine}" data-src-block="${ordinal}"` : ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // 顶层块序号在 pmClass/skipPm 之前取；本分支消费完后再算结束行。
    const blockStart = i
    const ordinal = blockIndex

    if (MEDIA_ROW_MARKER_LINE_RE.test(line.trim())) {
      i++
      continue
    }

    if (PAGE_BREAK_LINE_RE.test(line.trim())) {
      html.push(`<div class="mdPageBreak"${srcAttrs(blockStart, blockStart, ordinal)}><span>${PAGE_BREAK_LABEL}</span></div>`)
      skipPm()
      i++
      continue
    }

    if (DETAILS_OPEN_RE.test(line.trim())) {
      const details = readDetailsBlock(lines, i)
      i = details.next
      const summary = inlineMdToHtml(details.summary.trim() || COLLAPSIBLE_DEFAULT_SUMMARY)
      const body = details.body.join('\n').trim()
        ? markdownToPreviewHtml(details.body.join('\n'), { pmBlocks: false })
        : ''
      html.push(
        `<details class="mdCollapsible"${details.open ? ' open' : ''}${srcAttrs(blockStart, i - 1, ordinal)}><summary>${summary}</summary>${body}</details>`,
      )
      skipPm()
      continue
    }

    // 手写 HTML 表格：与 docFromMarkdown 同一个读取器，预览和编辑器不能对同一行各说各话。
    const htmlTable = readHtmlTableBlock(lines, i)
    if (htmlTable) {
      const preview = htmlTableToPreviewHtml(htmlTable.html, srcAttrs(blockStart, htmlTable.next - 1, ordinal))
      if (preview) {
        html.push(preview)
        skipPm()
        i = htmlTable.next
        continue
      }
    }

    // 认不出来的整行 HTML 直接跳过：预览里显示一行转义后的尖括号只会让人以为坏了。
    if (isHtmlBlockLine(line)) {
      i++
      continue
    }

    const fence = markdownFenceLine(line)
    if (fence) {
      const rawLang = fence.slice(3).trim()
      const lang = escapeHtml(rawLang)
      i++
      const codeLines: string[] = []
      while (i < lines.length && !markdownFenceLine(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length && markdownFenceLine(lines[i])) i++
      const code = codeLines.join('\n')
      const blockAttrs = srcAttrs(blockStart, i - 1, ordinal)
      // mermaid 只能先出占位块：渲染是异步的，这个函数是同步的。
      if (rawLang.toLowerCase() === 'mermaid') {
        html.push(mermaidPlaceholderHtml(code, blockAttrs))
        skipPm()
        continue
      }
      const highlighted = highlightCodeToHtml(code, rawLang)
      // `data-language` 始终带上：主题的代码块标题栏用 `attr(data-language)` 显示语言名，
      // 缺属性就是空标题栏。没写语言时落回 text。
      html.push(
        `<pre class="idea-code-block" data-language="${lang || 'text'}"${blockAttrs}><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`,
      )
      skipPm()
      continue
    }

    // 目录占位符 `[TOC]`。**必须排在围栏之后** —— 否则代码块里那行 `[TOC]` 会被当成目录，
    // 而代码块的正文正在上面那个分支里被整段消费掉。
    if (isTocMarker(line)) {
      const toc = previewTocHtml(lines, srcAttrs(blockStart, blockStart, ordinal))
      if (toc) html.push(toc)
      skipPm()
      i++
      continue
    }

    // 块级公式：与 docFromMarkdown 同一个读取器、同一个优先级（排在表格前），
    // 预览和编辑器文档不能对同一行各说各话。编辑器里它住在段落里，预览同样包一层
    // 段落（不吃 pm-readable-block —— 公式不是文本节点，与 nodeHasText 的口径一致），
    // `.editor-formula.display` 自带块级居中（writing.css）。
    const mathBlock = readMathBlock(lines, i)
    if (mathBlock) {
      html.push(
        `<p class="${pmClass('paragraph', { hasText: false })}"${srcAttrs(blockStart, mathBlock.next - 1, ordinal)}>${inlineNodesToHtml([{ type: 'formula', attrs: { latex: mathBlock.latex, displayMode: true } }])}</p>`,
      )
      i = mathBlock.next
      continue
    }

    // 脚注定义不直接渲染：先收起来，全文走完后统一输出到底部脚注区。
    const footnoteDef = readFootnoteDefinition(lines, i)
    if (footnoteDef) {
      footnoteDefs.push({
        name: footnoteDef.name,
        body: footnoteDef.body,
        startLine: blockStart,
        endLine: footnoteDef.next - 1,
        ordinal,
      })
      skipPm()
      i = footnoteDef.next
      continue
    }

    const tableHeader = splitMarkdownTableRow(line)
    const tableSeparator = tableHeader ? nextNonEmptyLine(lines, i + 1) : -1
    if (tableHeader && tableSeparator < lines.length && isMarkdownTableSeparator(lines[tableSeparator])) {
      i = tableSeparator + 1
      const bodyRows: string[][] = []
      const rowLines: number[] = []
      while (i < lines.length) {
        if (!lines[i].trim()) {
          i += 1
          continue
        }
        const row = splitMarkdownTableRow(lines[i])
        if (!row) break
        bodyRows.push(row)
        rowLines.push(i)
        i++
      }
      const columns = Math.max(tableHeader.length, ...bodyRows.map((row) => row.length), 1)
      const toRow = (cells: string[], tag: 'td' | 'th', attrs = '') =>
        `<tr${attrs}>` +
        Array.from({ length: columns }, (_, index) => '<' + tag + '>' + inlineMdToHtml(cells[index] || '') + '</' + tag + '>').join('') +
        '</tr>'
      const previewRows = [tableHeader, ...bodyRows]
      const colgroup =
        '<colgroup>' +
        columnWidthsToPercent(columnWidthsForRows(previewRows))
          .map((percent) => `<col style="width:${percent}%" />`)
          .join('') +
        '</colgroup>'
      html.push(
        `<div class="mdTableWrap"${srcAttrs(blockStart, i - 1, ordinal)}><table>` +
          colgroup +
          '<thead>' +
          toRow(tableHeader, 'th', srcAttrs(blockStart, tableSeparator, ordinal)) +
          '</thead><tbody>' +
          bodyRows
            .map((row, index) => toRow(row, 'td', srcAttrs(rowLines[index], rowLines[index], ordinal)))
            .join('') +
          '</tbody></table></div>',
      )
      skipPm()
      continue
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      html.push(`<hr${srcAttrs(blockStart, blockStart, ordinal)} />`)
      skipPm()
      i++
      continue
    }

    const heading = markdownHeadingLine(line)
    if (heading) {
      const level = heading.level
      const anchor = markdownAnchorSlug(heading.text)
      html.push(`<h${level} class="${pmClass('heading', { level })}"${anchor ? ` id="${escapeHtml(anchor)}"` : ''}${srcAttrs(blockStart, blockStart, ordinal)}>${inlineMdToHtml(heading.text)}</h${level}>`)
      i++
      continue
    }

    // `>text` without a space is a quote too — match the document parser.
    if (/^>/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      const alert = CALLOUT_ALERT_RE.exec((quote[0] || '').trim())
      const kind = alert ? calloutKindFromAlert(alert[1]) : null
      if (alert && kind) {
        const style = calloutStyle(kind)
        const rest = quote.slice(1)
        if (alert[2].trim()) rest.unshift(alert[2])
        const body = rest.map((text) => inlineMdToHtml(text)).join('<br/>')
        html.push(
          `<div class="mdCallout mdCallout-${kind}" style="border-left:4px solid ${style.accent};background:${style.background}"${srcAttrs(blockStart, i - 1, ordinal)}>` +
            `<p class="mdCalloutTitle" style="color:${style.accent}">${escapeHtml(style.label)}</p>` +
            `<p>${body}</p></div>`,
        )
        skipPm()
        continue
      }
      html.push(`<blockquote class="${pmClass('blockquote')}"${srcAttrs(blockStart, i - 1, ordinal)}><p>${quote.map((text) => inlineMdToHtml(text)).join('<br/>')}</p></blockquote>`)
      continue
    }

    // 一行多张图按顺序拆成多个块级图片，与 docFromMarkdown 对齐。
    const previewImages = imagesFromImageOnlyLine(line)
    if (previewImages.length > 1) {
      const tokens = line.trim().match(/!\[[^\]]*\]\([^)]*\)/g) || []
      tokens.forEach((token, index) => {
        html.push(`<p${index === 0 ? srcAttrs(blockStart, blockStart, ordinal) : ''}>${inlineMdToHtml(token)}</p>`)
        skipPm()
      })
      i++
      continue
    }

    if (matchListItem(line)) {
      const first = matchListItem(line)!
      // 任务列表在编辑器里不吃块类名（不在装饰名单里），但同样占一个顶层节点序号。
      const listPmClass = first.checked !== null
        ? (skipPm(), '')
        : pmClass(first.ordered ? 'orderedList' : 'bulletList')
      const consumed = renderList(lines, i, listPmClass, sourceMap ? { ordinal } : undefined)
      html.push(consumed.html)
      i = consumed.next
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !markdownHeadingLine(lines[i]) &&
      !lines[i].startsWith('>') &&
      !markdownFenceLine(lines[i]) &&
      // 与 docFromMarkdown 同步：$$ 块能打断段落。
      !lines[i].startsWith('$$') &&
      // 脚注定义行同理。
      !isFootnoteDefinitionLine(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      para.push(lines[i])
      i++
    }
    // hasText 与编辑器的 nodeHasText 同一口径：只有真实文本才算可读块，
    // 纯公式/纯图片的段落不吃 pm-readable-block。
    const paraNodes = parseInlineMarks(para.join('\n'))
    const paraHasText = paraNodes.some((n) => n.type === 'text' && String(n.text ?? '').trim())
    // multiline 与编辑器的 nodeHasLineBreak 同一口径：这个段落由多行拼成（或行内写了硬换行）。
    const paraMultiline = para.length > 1 || paraNodes.some((n) => String(n.type) === 'hardBreak')
    html.push(`<p class="${pmClass('paragraph', { hasText: paraHasText, multiline: paraMultiline })}"${srcAttrs(blockStart, i - 1, ordinal)}>${inlineNodesToHtml(paraNodes)}</p>`)
  }
  // 脚注区收尾：定义按出现顺序编号（与引用的序号表同一顺序），带回到引用处的回链。
  if (footnoteDefs.length) {
    const items = footnoteDefs.map((def, index) => {
      const n = index + 1
      return `<li id="fn-${n}"${srcAttrs(def.startLine, def.endLine, def.ordinal)}>${inlineMdToHtml(def.body)}<a class="mdFootnoteBack" href="#fnref-${n}">↩</a></li>`
    })
    html.push(`<div class="mdFootnotes"><hr /><ol>${items.join('')}</ol></div>`)
  }
  activeFootnoteOrder = previousFootnoteOrder
  return html.join('\n') || '<p class="md-empty">预览区域</p>'
}

/**
 * Structural markup means the clipboard HTML actually carries formatting worth
 * keeping (Word, web pages), so ProseMirror should parse it. Code editors and
 * terminals also publish text/html, but only as colour-styled <div>/<span>
 * wrappers around what is really plain text — that flavour must not suppress
 * Markdown handling, which is why "has any text/html" is not a usable test.
 */
const STRUCTURAL_HTML =
  /<\s*(h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code|img|a|strong|b|em|i|u|s|del|mark|hr|br)\b/i

export function htmlCarriesFormatting(html: string): boolean {
  const body = (html || '').replace(/<!--[\s\S]*?-->/g, '')
  if (!body.trim()) return false
  return STRUCTURAL_HTML.test(body)
}

const MARKDOWN_BLOCK_PATTERNS = [
  /^#{1,6}\s+\S/m, // heading
  /^```[^\n]*$/m, // fenced code
  /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/m, // thematic break
  /\|.+\|\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?/, // table
  /^\s{0,3}>/m, // blockquote (space after marker optional)
  /^\s{0,3}[-*+]\s+\S/m, // bullet list
  /^\s{0,3}\d+[.)]\s+\S/m, // ordered list
]

/**
 * Unambiguous inline constructs. Converting these beats the plain-text
 * fallback, which pastes the literal `**` / backticks as visible characters.
 * Single `*` and `_` runs are excluded: ordinary prose uses them too often.
 */
const MARKDOWN_INLINE_PATTERNS = [
  /\*\*[^*\n]+\*\*/,
  /~~[^~\n]+~~/,
  /==[^=\n]+==/,
  /`[^`\n]+`/,
  /!?\[[^\]\n]*\]\([^)\s]+\)/,
]

/** Whether pasted plain text should be converted from Markdown. */
export function looksLikeMarkdownPaste(text: string): boolean {
  const t = preprocessMarkdownSource(text).trim()
  if (!t) return false
  return (
    MARKDOWN_BLOCK_PATTERNS.some((pattern) => pattern.test(t)) ||
    MARKDOWN_INLINE_PATTERNS.some((pattern) => pattern.test(t))
  )
}

/**
 * Whether the text contains a GFM pipe table. Deliberately the same condition
 * `docFromMarkdown` / `markdownToPreviewHtml` use — a header row followed by a
 * delimiter row, blank lines between them tolerated — so a caller can never
 * decide "not a table" about text those two then render as one.
 */
export function containsMarkdownTable(text: string): boolean {
  const lines = preprocessMarkdownSource(text).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (!splitMarkdownTableRow(lines[index])) continue
    const separator = nextNonEmptyLine(lines, index + 1)
    if (separator < lines.length && isMarkdownTableSeparator(lines[separator])) return true
  }
  return false
}

/**
 * Plain text whose columns are held together by runs of spaces or tabs — a
 * terminal listing, a fixed-width report. Pasting it as prose collapses the
 * columns, so the editor keeps the lines verbatim in a monospace font instead.
 *
 * Checked before `looksLikeMarkdownPaste`, so it must not claim a Markdown
 * table: an empty cell renders as `|  |`, and those two spaces between pipes
 * pass the whitespace test. That is how an OCR'd table with blank cells ended
 * up as monospace lines of literal pipes in the visual editor.
 */
export function looksLikeColumnAlignedPlainText(text: string): boolean {
  const lines = (text || '').replace(/\r\n|\r/g, '\n').split('\n').filter((line) => line.trim().length > 0)
  if (lines.length < 2) return false
  if (containsMarkdownTable(text)) return false
  const alignedLines = lines.filter((line) => /\t/.test(line) || /\S {2,}\S/.test(line))
  return alignedLines.length >= 2
}

export function getStoredMarkdown(raw: string, st: StoredEditorContent | null = parseStoredContent(raw)): string {
  if (typeof st?.sourceMarkdown === 'string') return st.sourceMarkdown
  if (st?.doc) return docToMarkdown(st.doc)
  return raw || ''
}

/**
 * `null` means this chapter predates durable annotation storage. An empty array
 * is meaningful: annotations were stored and the user has removed all of them.
 */
export function getStoredAnnotations(raw: string, st: StoredEditorContent | null = parseStoredContent(raw)): AnnotationData[] | null {
  return Array.isArray(st?.annotations) ? st.annotations : null
}

/**
 * The editor seed for a chapter read from the backend.
 *
 * The backend keeps a chapter's annotations outside its Markdown body, because
 * they anchor to offsets the file cannot carry, so a chapter arrives as the body
 * plus a separate annotation list. The editor reads annotations from one place
 * only, its own stored document, so the two are joined here. The body is kept
 * as the exact source so nothing is reflowed; content that already is a stored
 * document (a recovery draft, for example) carries its own annotations and is
 * returned as is.
 */
export function chapterEditorContent(chapter: {
  content?: string
  annotations?: AnnotationData[] | null
}): string {
  const content = chapter.content || ''
  const annotations = chapter.annotations
  if (!Array.isArray(annotations) || annotations.length === 0) return content
  if (parseStoredContent(content)) return content
  return buildStoredContent(docFromMarkdown(content), { sourceMarkdown: content, annotations })
}

export type MarkdownRoundTripReport = {
  /** True when the round trip keeps every character and every marker. */
  lossless: boolean
  /** Runs of text present in the source and absent after the round trip. */
  missingText: string[]
  /**
   * HTML comments the source carries that writing it back would lose.
   *
   * These are not decorative: the writer keeps every node Markdown cannot
   * express as a comment, so a dropped comment is a dropped reference. The
   * signal exists because such a comment carries no text, and the text check
   * alone would report the loss as clean.
   */
  droppedMarkers: string[]
}

/**
 * What an optional source-to-rich-text conversion would change.
 *
 * Architecture doc §12 makes the visual editor an opt-in conversion over an
 * external `.md`: it is allowed to reflow the document, but it must not silently
 * drop content, and the user has to be told when it would. This is that check —
 * `docFromMarkdown` is the parser the switch actually uses, so the report
 * describes the conversion the user is about to get rather than an idealised one.
 *
 * It compares substrings rather than whole structures on purpose: the point is
 * to catch content that vanished, and a byte-level comparison would flag every
 * harmless normalisation (spacing, list markers, escaping) and drown the real
 * losses. The Go side takes the same position in `internal/markdown.TextCoverage`.
 */
export function checkMarkdownRoundTrip(markdown: string): MarkdownRoundTripReport {
  const source = preprocessMarkdownSource(markdown)
  if (!source.trim()) return { lossless: true, missingText: [], droppedMarkers: [] }

  const doc = docFromMarkdown(source)
  const written = docToMarkdown(doc)
  const missingText = collectMissingTextRuns(doc, unescapeMarkdown(written))
  const droppedMarkers = droppedHtmlComments(source, written)
  return {
    lossless: missingText.length === 0 && droppedMarkers.length === 0,
    missingText,
    droppedMarkers,
  }
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

function droppedHtmlComments(source: string, written: string): string[] {
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const comment of source.match(HTML_COMMENT_RE) || []) {
    const trimmed = comment.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    if (!written.includes(trimmed)) dropped.push(trimmed)
  }
  return dropped.sort()
}

/** Node kinds that carry visible text, mirroring the Go coverage check. */
function nodeTextRun(node: PMNode): string {
  switch (node.type) {
    case 'text':
      return (node.text || '').trim()
    case 'inlineIcon':
      return String(node.attrs?.symbol ?? '').trim()
    case 'wikiLink':
      return String(node.attrs?.alias || node.attrs?.target || '').trim()
    case 'inlineTag':
      return String(node.attrs?.name ?? '').trim()
    case 'footnoteReference':
      return String(node.attrs?.name ?? '').trim()
    case 'formula':
      return String(node.attrs?.latex ?? '').trim()
    default:
      return ''
  }
}

/**
 * 一个文本节点在 Markdown 里**不一定是一段连续的字面量**。
 *
 * 块级容器会给内部每一行加前缀：引用是 `> `、脚注续行是 4 个空格、列表续行是 2 个空格。
 * 所以「段内含换行」的文本节点（`line1\nline2`，就是 `pm-line-block` 那种）写出去是
 * `> line1\n> line2` —— 拿整串去匹配必然落空，报出一段其实一个字都没少的内容
 * （2026-10-07 用户报的「两行引用块会丢失文字」就是这个）。
 * 所以按行核对：每一行都能在结果里找到才算没丢。
 */
function textRunIsCovered(text: string, haystack: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return true
  return lines.every((line) => haystack.includes(line))
}

function collectMissingTextRuns(root: Record<string, unknown>, haystack: string): string[] {
  const missing: string[] = []
  const seen = new Set<string>()
  const visit = (node: PMNode) => {
    const text = nodeTextRun(node)
    if (text && !seen.has(text)) {
      seen.add(text)
      if (!textRunIsCovered(text, haystack)) missing.push(text)
    }
    for (const child of node.content || []) visit(child)
  }
  visit(root as PMNode)
  return missing.sort()
}


/**
 * Reverses the escapes the Markdown writer introduces, so a correctly written
 * run is not reported as lost. The longest match wins, so a doubled backslash is
 * not mistaken for an escape of the next character.
 */
function unescapeMarkdown(markdown: string): string {
  return markdown.replace(/\\([\\|*_])/g, '$1')
}

export function buildStoredContent(
  doc: Record<string, unknown>,
  options?: {
    plainText?: string
    sourceMarkdown?: string
    annotations?: AnnotationData[]
  },
): string {
  // Rich editing remains JSON-authoritative. When sourceMarkdown is supplied,
  // it is the exact source-mode text and is authoritative for that save path.
  const plain = options?.plainText ?? plainFromDoc(doc)
  const payload = {
    type: 'biglazycat_editor_content',
    version: 3,
    doc: doc || EMPTY_DOC,
    plainText: plain,
    updatedAt: new Date().toISOString(),
  } as StoredEditorContent
  if (options?.sourceMarkdown !== undefined) {
    payload.sourceMarkdown = options.sourceMarkdown
  }
  if (options?.annotations !== undefined) {
    payload.annotations = options.annotations
  }
  return JSON.stringify(payload)
}

/**
 * Count non-whitespace code points (Chinese 字数 semantics).
 * Avoid Array.from + filter which allocate O(n) temporary arrays on long docs.
 */
const WORD_COUNT_WHITESPACE = /[\p{White_Space}\u200B\uFEFF]/u

export function countWords(text: string): number {
  if (!text) return 0
  let n = 0
  for (const char of text) {
    if (!WORD_COUNT_WHITESPACE.test(char)) n += 1
  }
  return n
}

export function plainFromStored(raw: string): string {
  const st = parseStoredContent(raw)
  if (st) {
    if (st.plainText) return st.plainText
    return plainFromDoc(st.doc)
  }
  return raw || ''
}
