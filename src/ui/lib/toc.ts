/**
 * 目录（`[TOC]`）的唯一约定：标记识别 + 目录块 HTML。
 *
 * 三条渲染链路都要认出正文里单独一行的 `[TOC]`，而且都要吐出一模一样的 DOM ——
 * 主题 CSS 正是靠这些 `pm-toc*` 类名命中目录，好让每套主题给目录自己的长相：
 *
 *  1. 源码模式的只读预览 —— `content-model.ts` 的 `markdownToPreviewHtml`
 *  2. 所见即所得编辑器 —— `features/writing/extensions/TocBlockExtension.ts` 的节点视图
 *  3. 公众号导出的 CSS 管线 —— `wechat/wechat-export.ts` 的 `renderNode`
 *
 * 组件管线（国风节日这类带封面的版式主题）**不用**这份 HTML：它有自己按 token 画的
 * 目录卡片（`wechat/layout/components.ts` 的 `renderToc`），那是 CSS 复刻不出来的形状。
 * 两边只在「条目口径」上对齐：都只收 H2。
 *
 * 条目口径 = **H2**，与组件管线「一个 H2 一个章节」对齐。只列 H2 是刻意的 —— 多列 H3
 * 会让用户以为导出漏了东西，宁可少列，不要两边对不上。
 */

/**
 * 目录占位符。与 `wechat/layout/infer-plan.ts` 的 `TOC_MARKER` 是同一套约定，两处一起改。
 *
 * 大小写不敏感（`[toc]` 也认）—— 这是 Markdown 里唯一通用的那个约定（Typora、docsify、
 * VNote、Markdown Preview Enhanced 都用它）。
 */
export const TOC_MARKER_RE = /^\[toc\]$/iu

/** 这一段（或这一行）是不是目录占位符。前后空白不算。 */
export function isTocMarker(text: string): boolean {
  return TOC_MARKER_RE.test(text.trim())
}

/**
 * 目录条目。
 *
 * `label` 是**已经渲染好的行内 HTML**（标题里可能有代码、强调、公式），本模块只负责
 * 拼装，不再转义 —— 纯文本标题请先过 `escapeTocLabel`。
 */
export type TocEntry = {
  label: string
  /**
   * 标题锚点（`markdownAnchorSlug` 的输出：只有字母、数字、汉字和连字符）。
   *
   * 不传就渲染成 `<span class="pm-toc-link">` —— 公众号会把锚点过滤掉，导出侧拿到的
   * 链接点了不动，不如干脆不出 `<a>`。两条路都带同一个类名，主题只写一次 `.pm-toc-link`。
   */
  href?: string
}

/** 纯文本标题 → 转义过的行内 HTML。给只有纯文本标题的来源（编辑器文档 / 导出文档）用。 */
export function escapeTocLabel(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/**
 * 目录块。
 *
 * 类名三处共用，主题 CSS 直接写 `.pm-toc` / `.pm-toc-title` / `.pm-toc-item` /
 * `.pm-toc-link`。刻意用 `<ol>` 而不是 `<ul>`：目录天然是有序的（与组件管线的
 * `PART 01` 编号同一个意思），浏览器自带序号，主题想去掉再自己 `list-style: none`。
 *
 * 一个条目都没有时返回空串：空的目录框比没有目录更像坏了。
 *
 * `attrs` 追加到 `<nav>` 上，仅供源码预览写行锚点；编辑器和导出不传，输出保持原样。
 */
export function tocHtml(entries: TocEntry[], attrs = ''): string {
  if (entries.length === 0) return ''
  const items = entries
    .map((entry) =>
      entry.href
        ? `<li class="pm-toc-item"><a class="pm-toc-link" href="#${entry.href}">${entry.label}</a></li>`
        : `<li class="pm-toc-item"><span class="pm-toc-link">${entry.label}</span></li>`,
    )
    .join('')
  return `<nav class="pm-toc"${attrs}><div class="pm-toc-title">目录</div><ol class="pm-toc-list">${items}</ol></nav>`
}
