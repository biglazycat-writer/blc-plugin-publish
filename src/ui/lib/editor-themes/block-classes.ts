/**
 * 顶层块的类名。
 *
 * 编辑器与公众号导出必须算出**同一套**类名 —— 主题 CSS 就是靠这些类名同时命中两边的。
 *
 * 挂法不同但视觉一致：
 *  - 编辑器：类名挂在块元素本身，`<h1 class="pm-block pm-heading-1">`；
 *  - 导出：类名挂在包住它的 `<section>` 上，`<section class="pm-block pm-heading-1"><h1>`。
 *
 * 之所以能一致，是因为主题只写 `.pm-X { ... }`，不写 `.pm-X h1`。给 `<section>` 加背景和
 * 内边距、给 `<h1>` 加背景和内边距，在块级布局下看起来是同一个东西。
 */

export type BlockClassInput = {
  /** ProseMirror 节点类型：paragraph / heading / blockquote / bulletList / ... */
  type: string
  /** heading 的级别，其他类型忽略。 */
  level?: number
  /** 段落是否有实际文本 —— 空段落不算可读块，不该吃到正文样式。 */
  hasText: boolean
  /** 在顶层节点里的下标，用来标记首块与导语段。 */
  index: number
  /**
   * 块内文本含换行（Markdown 的 soft break）。
   *
   * 这种块通常**不是连续散文**：元信息（编写日期 / 适用项目 / 文档状态）、地址、诗句都是
   * 一行一件事，靠换行分条。中文主题的首行缩进（`text-indent`）只该给散文段落 —— 认这个
   * 类名就能躲开它们，否则会出现「整块只有第一行缩进」的怪样子。
   *
   * 只对 paragraph 计算：列表/引用的「行」是各自的项目，不是整块的属性。
   */
  multiline?: boolean
}

export function blockClasses(input: BlockClassInput): string {
  const classes = ['pm-block', `pm-${input.type}`]

  if (input.index === 0) classes.push('pm-first-block')

  if (input.type === 'heading') {
    const level = Math.min(Math.max(input.level ?? 1, 1), 6)
    classes.push(`pm-heading-${level}`)
  }

  if (input.type === 'paragraph' && input.hasText) {
    classes.push('pm-readable-block')
    if (input.index === 0) classes.push('pm-lead-paragraph')
  }

  // 与 pm-readable-block 互不排斥：有文本才算可读块，段内有换行则说明它是分行排列的块。
  if (input.multiline) classes.push('pm-line-block')

  if (input.type === 'blockquote') classes.push('pm-blockquote')
  if (input.type === 'codeBlock') classes.push('pm-code-block')
  if (input.type === 'bulletList' || input.type === 'orderedList') classes.push('pm-list-block')
  if (input.type === 'table') classes.push('pm-table-block')
  if (input.type === 'horizontalRule') classes.push('pm-hr-block')
  if (input.type === 'image') classes.push('pm-image-block')

  return classes.join(' ')
}
