/**
 * Mermaid 渲染器：懒加载 + 缓存 + 位图化。
 *
 * mermaid 会打包进 d3 / cytoscape / dagre，体积很大，所以只用动态 import()，
 * 让它单独成 chunk，不进主包。桌面端必须全离线可用，因此不做任何 CDN 回退，
 * 也不启用 architecture-beta（那个图表类型会去 iconify 取图标，要联网）。
 */

/** 应用主题 → mermaid 内置主题。 */
export type MermaidTheme = 'light' | 'dark'

export type MermaidPng = {
  dataUrl: string
  width: number
  height: number
}

type MermaidModule = typeof import('mermaid')['default']

let loading: Promise<MermaidModule> | null = null
let renderSeq = 0

function mermaidThemeName(theme: MermaidTheme): 'default' | 'dark' {
  return theme === 'dark' ? 'dark' : 'default'
}

/**
 * 载入并初始化 mermaid（单例）。
 *
 * htmlLabels 全局关掉：mermaid 默认把标签渲染成 <foreignObject> 里的 HTML，
 * 而 <foreignObject> 经 Image → canvas 位图化时不可靠（多数浏览器画不出来），
 * 导出的图会整片缺字。改用 SVG <text> 后屏幕和导出表现一致。
 */
async function loadMermaid(theme: MermaidTheme): Promise<MermaidModule> {
  if (!loading) {
    loading = import('mermaid').then((mod) => mod.default)
  }
  const mermaid = await loading
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: mermaidThemeName(theme),
    fontFamily: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
  })
  return mermaid
}

/** 主题参与缓存键：同一段源码在明暗两套主题下是两张不同的图。 */
function cacheKey(code: string, theme: MermaidTheme): string {
  return `${theme}\u0000${code.trim()}`
}

const svgCache = new Map<string, Promise<string>>()
const pngCache = new Map<string, Promise<MermaidPng>>()

/** 清空缓存。主题切换后由调用方触发，测试里也用得到。 */
export function clearMermaidCache(): void {
  svgCache.clear()
  pngCache.clear()
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '图表语法无法解析')
  // mermaid 的报错常带多行的源码指示，这里只留第一行，卡片上放得下。
  return message.split('\n')[0].trim() || '图表语法无法解析'
}

/**
 * 校验语法，合法返回 null，非法返回一行错误信息。
 *
 * 用 suppressErrors 让 parse 返回 false 而不是抛，但 mermaid 载入本身仍可能失败，
 * 所以外面照样包一层 try。
 */
export async function validateMermaid(code: string, theme: MermaidTheme = 'light'): Promise<string | null> {
  if (!code.trim()) return '请输入图表内容'
  try {
    const mermaid = await loadMermaid(theme)
    const result = await mermaid.parse(code.trim(), { suppressErrors: true })
    return result === false ? '图表语法无法解析' : null
  } catch (error) {
    return normalizeError(error)
  }
}

/** 渲染成 SVG 字符串。语法错误会抛，调用方负责显示错误态。 */
export async function renderMermaidSvg(code: string, theme: MermaidTheme = 'light'): Promise<string> {
  const source = code.trim()
  if (!source) throw new Error('请输入图表内容')
  const key = cacheKey(source, theme)
  const cached = svgCache.get(key)
  if (cached) return cached

  const task = (async () => {
    const mermaid = await loadMermaid(theme)
    renderSeq += 1
    // id 必须唯一：mermaid 会用它建临时 DOM 节点和 CSS 选择器。
    const { svg } = await mermaid.render(`blc-mermaid-${renderSeq}`, source)
    // mermaid 默认写成 width="100%" 再配 max-width。放进编辑器栏宽后整张图被等比缩小，
    // 字跟着小到看不清。改成 viewBox 的像素尺寸，卡片按这个尺寸原样显示。
    const { width, height } = svgIntrinsicSize(svg)
    return withExplicitSize(svg, width, height)
  })()

  svgCache.set(key, task)
  // 失败的结果不留在缓存里，否则改好语法也还是报同一个错。
  task.catch(() => svgCache.delete(key))
  return task
}

/**
 * 从 SVG 里取出内在尺寸。
 *
 * 优先 viewBox：mermaid 给根节点的 width/height 常是 `100%` 或带 max-width 样式，
 * 直接读属性会拿到 0，画到 canvas 上就是一张空图。
 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const width = Math.abs(parts[2])
      const height = Math.abs(parts[3])
      if (width > 0 && height > 0) return { width, height }
    }
  }
  const widthAttr = /\bwidth="([\d.]+)(?:px)?"/.exec(svg)
  const heightAttr = /\bheight="([\d.]+)(?:px)?"/.exec(svg)
  const width = widthAttr ? Number(widthAttr[1]) : 0
  const height = heightAttr ? Number(heightAttr[1]) : 0
  if (width > 0 && height > 0) return { width, height }
  return { width: 800, height: 600 }
}

/**
 * 给 SVG 补上显式的像素尺寸。
 *
 * 屏幕和位图化都要这个尺寸：mermaid 输出的 `width="100%"` 加 `max-width` 会让
 * 图被压进容器，Image 的 naturalWidth 也会变成 0。顺手把 max-width 去掉。
 */
function withExplicitSize(svg: string, width: number, height: number): string {
  let out = svg.replace(/<svg\b([^>]*)>/, (_full, attrs: string) => {
    const cleaned = attrs
      .replace(/\s(?:width|height)="[^"]*"/g, '')
      .replace(/style="[^"]*"/g, (styleMatch) => styleMatch.replace(/max-width\s*:\s*[^;"]*;?/g, ''))
    return `<svg${cleaned} width="${width}" height="${height}">`
  })
  if (!/xmlns=/.test(out)) {
    out = out.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return out
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 位图化倍率：导出到 docx / PDF 时按两倍画，缩放后边缘不发虚。 */
const RASTER_SCALE = 2

/**
 * 渲染成 PNG dataURL。
 *
 * docx 只吃位图；导出的 SVG foreignObject 里再嵌一层 SVG 也不可靠。四条导出链路统一走这里，
 * 保证导出结果和屏幕上看到的是同一张图。
 */
export async function renderMermaidPng(code: string, theme: MermaidTheme = 'light'): Promise<MermaidPng> {
  const source = code.trim()
  const key = cacheKey(source, theme)
  const cached = pngCache.get(key)
  if (cached) return cached

  const task = (async () => {
    const svg = await renderMermaidSvg(source, theme)
    const { width, height } = svgIntrinsicSize(svg)
    const sized = withExplicitSize(svg, width, height)

    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图表位图化失败'))
      image.src = svgToDataUrl(sized)
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * RASTER_SCALE))
    canvas.height = Math.max(1, Math.round(height * RASTER_SCALE))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('图表位图化失败')
    // 导出目标（Word / PDF / 公众号）都是白底，透明背景会让深色主题的字看不见。
    ctx.fillStyle = theme === 'dark' ? '#1f2027' : '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  })()

  pngCache.set(key, task)
  task.catch(() => pngCache.delete(key))
  return task
}

/** 插入菜单用的起步模板。 */
export const MERMAID_STARTER = `graph TD
  A[开始] --> B{判断}
  B -->|是| C[处理]
  B -->|否| D[结束]
  C --> D`
