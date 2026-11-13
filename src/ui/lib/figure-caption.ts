/**
 * 图注(图片说明)与全文自动编号的纯逻辑。
 *
 * 编号故意不存进节点属性:序号完全由文档顺序派生,插入/删除图片后自动重排,
 * 也就不会污染 undo 历史和保存脏标记。编辑器里由 ProseMirror 装饰派号,
 * 各条导出链路各跑一次下面的遍历,两边共用同一套规则和文案。
 */

/** 改编号文案只动这一行。 */
export const FIGURE_LABEL_PREFIX = '图'

/** 图注属性在 HTML 里的载体,parseHTML/renderHTML 与导出链路共用。 */
export const FIGURE_CAPTION_ATTR = 'data-caption'
export const FIGURE_NUMBERED_ATTR = 'data-caption-numbered'

/** nodeView 渲染出来的图注元素标记,导出时按它查找。 */
export const FIGURE_CAPTION_ELEMENT_ATTR = 'data-figure-caption'

/** 图片节点上与图注相关的属性,PM 节点和 JSON 节点都能喂进来。 */
export type FigureCaptionAttrs = {
  caption?: unknown
  captionNumbered?: unknown
}

export function normalizeCaption(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 只有写了图注、且没关掉编号的图片才参与编号——不编号的图注不占号。 */
export function participatesInNumbering(attrs: FigureCaptionAttrs | null | undefined): boolean {
  if (!attrs) return false
  return normalizeCaption(attrs.caption) !== '' && attrs.captionNumbered !== false
}

/**
 * 拼出图注最终显示的文字。index 为 null / 非正数时只返回图注本身。
 * 用户选定的格式是空格分隔:`图 1 说明文字`。
 */
export function figureCaptionLabel(caption: unknown, index: number | null): string {
  const text = normalizeCaption(caption)
  if (!text) return ''
  if (index == null || !Number.isFinite(index) || index < 1) return text
  return `${FIGURE_LABEL_PREFIX} ${index} ${text}`
}

/** 只要编号前缀部分,给不需要拼正文的场景(如 docx 分段)用。 */
export function figureNumberLabel(index: number | null): string {
  if (index == null || !Number.isFinite(index) || index < 1) return ''
  return `${FIGURE_LABEL_PREFIX} ${index}`
}

type JsonNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

/**
 * 按文档顺序给 JSON doc 里参与编号的图片派号,返回 节点对象 → 序号 的映射。
 * 用节点对象本身做 key,调用方拿着同一棵树遍历就能查到号。
 */
export function collectJsonFigureNumbers(doc: JsonNode | null | undefined): Map<JsonNode, number> {
  const numbers = new Map<JsonNode, number>()
  let next = 1
  const walk = (node: JsonNode | null | undefined) => {
    if (!node) return
    if (node.type === 'image' && participatesInNumbering(node.attrs)) {
      numbers.set(node, next)
      next += 1
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return numbers
}

/** ProseMirror 节点的最小结构约束,避免 lib 层直接依赖 prosemirror-model。 */
type PMLikeNode = {
  type: { name: string }
  attrs: Record<string, unknown>
  descendants: (fn: (node: PMLikeNode, pos: number) => boolean | void) => void
}

/** 按文档顺序遍历参与编号的图片,回调拿到节点、位置和序号。 */
function walkPmFigures(
  doc: PMLikeNode | null | undefined,
  visit: (node: PMLikeNode, pos: number, index: number) => void,
): void {
  if (!doc) return
  let next = 1
  doc.descendants((node, pos) => {
    if (node.type?.name === 'image' && participatesInNumbering(node.attrs)) {
      visit(node, pos, next)
      next += 1
    }
    return true
  })
}

/**
 * 位置 → 序号。编辑器插件用这份给装饰派号。
 */
export function collectFigureNumbers(doc: PMLikeNode | null | undefined): Map<number, number> {
  const numbers = new Map<number, number>()
  walkPmFigures(doc, (_node, pos, index) => numbers.set(pos, index))
  return numbers
}

/**
 * 节点 → 序号。导出链路(如 docx)只拿到节点对象、没有位置,用这份。
 */
export function collectFigureNumbersByNode(doc: PMLikeNode | null | undefined): Map<unknown, number> {
  const numbers = new Map<unknown, number>()
  walkPmFigures(doc, (node, _pos, index) => numbers.set(node, index))
  return numbers
}
