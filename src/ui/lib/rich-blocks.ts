/**
 * 分页符 / 提示框 / 折叠块的纯逻辑：种类、配色、Markdown 写法。
 *
 * 放在 lib：编辑器扩展、Markdown 导出与导入、预览、docx、公众号都要按同一套规则
 * 决定「这个提示框长什么样、在 Markdown 里写成什么」。规则一旦分叉，同一份文档
 * 导出成 Word 和 Markdown 就是两种东西。这里刻意不引入 tiptap / docx 类型，
 * 保持能被 lib 层直接依赖。
 */

export type CalloutKind = 'info' | 'success' | 'warn' | 'danger'

export interface CalloutStyle {
  kind: CalloutKind
  /** 中文标题，写在提示框第一行（Markdown 里靠 GitHub 警告语法承载）。 */
  label: string
  /** GitHub / Obsidian / Typora 都认的警告标记。 */
  alert: 'NOTE' | 'TIP' | 'WARNING' | 'CAUTION'
  /** 左边那道竖线与标题的颜色。 */
  accent: string
  /** 浅色底。导出后没有应用样式表，所有颜色都得写成实色。 */
  background: string
  /** docx 的底纹填充色（不带 #）。 */
  docxFill: string
}

export const CALLOUT_STYLES: Record<CalloutKind, CalloutStyle> = {
  info: { kind: 'info', label: '提示', alert: 'NOTE', accent: '#1677ff', background: '#eff6ff', docxFill: 'EFF6FF' },
  success: { kind: 'success', label: '建议', alert: 'TIP', accent: '#16a34a', background: '#f0fdf4', docxFill: 'F0FDF4' },
  warn: { kind: 'warn', label: '注意', alert: 'WARNING', accent: '#d97706', background: '#fffbeb', docxFill: 'FFFBEB' },
  danger: { kind: 'danger', label: '警告', alert: 'CAUTION', accent: '#dc2626', background: '#fef2f2', docxFill: 'FEF2F2' },
}

export const CALLOUT_KINDS = Object.keys(CALLOUT_STYLES) as CalloutKind[]

export function normalizeCalloutKind(value: unknown): CalloutKind {
  return typeof value === 'string' && value in CALLOUT_STYLES ? (value as CalloutKind) : 'info'
}

export function calloutStyle(value: unknown): CalloutStyle {
  return CALLOUT_STYLES[normalizeCalloutKind(value)]
}

/** GitHub 警告标记 → 提示框种类。IMPORTANT 没有单独配色，归到「提示」。 */
export function calloutKindFromAlert(alert: string): CalloutKind | null {
  const upper = (alert || '').trim().toUpperCase()
  if (upper === 'NOTE' || upper === 'IMPORTANT') return 'info'
  if (upper === 'TIP') return 'success'
  if (upper === 'WARNING') return 'warn'
  if (upper === 'CAUTION') return 'danger'
  return null
}

/**
 * 分页符的 Markdown 写法。Typora / Pandoc 都按这个 div 分页，别的渲染器最多
 * 当成一个空 div，不会显示出奇怪的东西。
 */
export const PAGE_BREAK_MARKDOWN = '<div style="page-break-after:always"></div>'

export const PAGE_BREAK_LABEL = '分页符'

/** 折叠块没写标题时用的兜底标题：`<details>` 缺 `<summary>` 时浏览器只会显示「详细信息」。 */
export const COLLAPSIBLE_DEFAULT_SUMMARY = '详情'
