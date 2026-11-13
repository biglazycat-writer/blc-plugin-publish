/**
 * 表格列宽：按内容算，不按列数均分。
 *
 * 应用的表格是 `table-layout: fixed`（见 writing.css 的注释：用 `max-content` 会让单元格
 * 永不换行、一张大图把整张表撑到几千像素）。但固定布局下**不设列宽就各列等宽** ——
 * 「方法」列只有 GET / POST，却和「路径」列一样宽，长内容反而挤成窄条
 * （2026-09-29 用户反馈「有的列文字很少但占据宽度很宽」）。
 *
 * 这里按每列**最长单元格的视觉宽度**分配相对宽度：中日韩字符算 2 个单位、其余算 1，
 * 再按上下限夹一次，避免一列独吞、或窄到看不清。返回值单位是 px（总和固定），
 * 调用方按比例换算成百分比即可（导出与预览的 `<colgroup>` 用百分比）。
 */

/** 列宽总和。取比最窄的纸张（A4 正文栏 ≈650px）小一点：`table-layout: fixed` 会把
 *  多出来的空间按比例分给各列，所以总和小于表格宽度不会失真，反而能适配所有纸张宽度。 */
export const TABLE_COLUMN_TOTAL_WIDTH = 600

/** 单列上下限：下限保证「GET」这种短列还认得出，上限避免一整段话把别的列挤没。 */
export const TABLE_COLUMN_MIN_WIDTH = 64
export const TABLE_COLUMN_MAX_WIDTH = 300

/** Markdown 的行内标记（`**`、`` ` ``、链接括号…）不占版面宽度，估宽前先去掉。 */
const INLINE_MARKUP_RE = /[*_`~[\]()#>!]/g

/** 中日韩文字（含全角标点）按两倍宽度计 —— 一个汉字约占两个西文字符的位置。 */
const CJK_RE = /[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uffef]/

export function visualLength(text: string): number {
  let length = 0
  for (const char of text.replace(INLINE_MARKUP_RE, '')) {
    length += CJK_RE.test(char) ? 2 : 1
  }
  return length
}

/**
 * 给一张表算每列宽度（px）。
 *
 * 权重取该列最长单元格的视觉宽度，夹在 [4, 40] 个单位之间：太短的列不该缩到看不见，
 * 太长的列（整段话）也不该把别的列挤成一条缝。
 */
export function columnWidthsForRows(rows: readonly (readonly string[])[]): number[] {
  const columnCount = Math.max(1, ...rows.map((row) => row.length))
  const weights = Array.from({ length: columnCount }, (_, column) => {
    const longest = rows.reduce((max, row) => Math.max(max, visualLength(row[column] ?? '')), 0)
    return Math.min(Math.max(longest, 4), 40)
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
  // 列特别多时下限要跟着降，否则总和会超过纸张宽度、表格反而溢出。
  const minWidth = Math.min(TABLE_COLUMN_MIN_WIDTH, Math.floor(TABLE_COLUMN_TOTAL_WIDTH / columnCount))
  return weights.map((weight) => {
    const width = Math.round((weight / total) * TABLE_COLUMN_TOTAL_WIDTH)
    return Math.min(Math.max(width, minWidth), TABLE_COLUMN_MAX_WIDTH)
  })
}

/** 把 px 列宽换算成百分比（四舍五入到 0.1%），给 `<colgroup>` 用。 */
export function columnWidthsToPercent(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0) || 1
  return widths.map((width) => Math.round((width / total) * 1000) / 10)
}
