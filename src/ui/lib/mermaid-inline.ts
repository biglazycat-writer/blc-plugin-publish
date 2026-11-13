import { renderMermaidPng, type MermaidPng, type MermaidTheme } from './mermaid-render'

/** 预览/导出 HTML 里 mermaid 占位块的 class。 */
export const MERMAID_PLACEHOLDER_CLASS = 'mermaidDiagram'

const RENDERED_FLAG = 'data-mermaid-rendered'

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * mermaid 占位块。
 *
 * markdownToPreviewHtml 是同步的，mermaid 渲染是异步的，中间只能靠占位：
 * 先把源码原样放进一个代码块，再由 renderMermaidPlaceholders 在真实 DOM 上换成图。
 * 这样即使渲染失败或没人来填，读者看到的仍是完整的图表源码，而不是空白。
 */
export function mermaidPlaceholderHtml(code: string, attrs = ''): string {
  const escaped = escapeAttr(code)
  return (
    `<div class="${MERMAID_PLACEHOLDER_CLASS}" data-mermaid-source="${escaped}"${attrs}>` +
    `<pre class="idea-code-block" data-language="mermaid"><code class="hljs language-mermaid">${escaped}</code></pre>` +
    `</div>`
  )
}

/** 编辑器里 mermaid 节点视图的外壳标记（见 MermaidCodeBlock.tsx）。 */
const EDITOR_BLOCK_SELECTOR = '[data-mermaid-block]'

/** 图表源码：占位块放在属性里，编辑器节点视图里则是那个 <pre> 的文本。 */
function hostSource(host: HTMLElement): string {
  const attr = host.getAttribute('data-mermaid-source')
  if (attr !== null) return attr
  return host.querySelector('.mermaidBlockSource')?.textContent || ''
}

/**
 * 把 root 里的 mermaid 图表换成位图。
 *
 * 两种来源都吃：markdownToPreviewHtml 产生的占位块，以及从编辑器克隆出来的
 * 节点视图（后者带工具栏和内联 SVG，直接截图会把「编辑源码」按钮也印进去）。
 *
 * 用 PNG 而不是内联 SVG：导出走 SVG foreignObject，而 SVG 里再嵌一层 SVG（尤其自带
 * foreignObject 的）在其中渲染并不稳；一条路径同时服务预览和导出，
 * 也保证屏幕上看到的和导出的是同一张图。
 */
export async function renderMermaidPlaceholders(
  root: HTMLElement | null | undefined,
  theme: MermaidTheme = 'light',
): Promise<void> {
  if (!root) return
  // 标记里记的是主题：换主题后同一个占位块要按新配色重画一次。
  const done = `[${RENDERED_FLAG}="${theme}"]`
  const hosts = Array.from(
    root.querySelectorAll<HTMLElement>(
      `.${MERMAID_PLACEHOLDER_CLASS}:not(${done}),${EDITOR_BLOCK_SELECTOR}:not(${done})`,
    ),
  )
  if (hosts.length === 0) return

  await Promise.all(
    hosts.map(async (host) => {
      const source = hostSource(host)
      if (!source.trim()) return
      try {
        const png = await renderMermaidPng(source, theme)
        // 失败时什么都不动：占位块里的源码就是兜底，内容永远不丢。
        host.innerHTML =
          `<img src="${png.dataUrl}" width="${png.width}" height="${png.height}" alt="Mermaid 图表" />`
        host.setAttribute(RENDERED_FLAG, theme)
      } catch {
        // 保留占位块里的源码。
      }
    }),
  )
}

type DiagramNode = { type: { name: string }; attrs?: Record<string, unknown>; textContent: string }
type DiagramDoc = { descendants: (fn: (node: DiagramNode) => void) => void }

/** 代码块的语言是不是 mermaid。渲染器手上通常已经有 language，直接问这个就行。 */
export function isMermaidLanguage(language: unknown): boolean {
  return String(language || '').toLowerCase() === 'mermaid'
}

/** 文档里某个代码块是不是 mermaid 图表。 */
export function isMermaidCodeBlock(node: DiagramNode): boolean {
  if (node.type.name !== 'codeBlock') return false
  return isMermaidLanguage(node.attrs?.language)
}

async function renderSources(sources: Iterable<string>, theme: MermaidTheme): Promise<Map<string, MermaidPng>> {
  const rendered = new Map<string, MermaidPng>()
  await Promise.all(
    Array.from(sources).map(async (source) => {
      try {
        rendered.set(source, await renderMermaidPng(source, theme))
      } catch {
        // 留给调用方退回代码块。
      }
    }),
  )
  return rendered
}

/**
 * 预扫描文档里所有 mermaid 图表并位图化，按源码去重。
 *
 * docx / 公众号的渲染是同步的树遍历，没法在里面 await；和图片预取一样，
 * 先把结果准备好再进遍历。渲染失败的图不会进 map，调用方退回代码块。
 */
export async function collectMermaidPngs(
  doc: DiagramDoc,
  theme: MermaidTheme = 'light',
): Promise<Map<string, MermaidPng>> {
  const sources = new Set<string>()
  doc.descendants((node) => {
    if (!isMermaidCodeBlock(node)) return
    const source = node.textContent.trim()
    if (source) sources.add(source)
  })
  return renderSources(sources, theme)
}

type JsonNode = { type?: string; attrs?: Record<string, unknown>; text?: string; content?: JsonNode[] }

function jsonText(node: JsonNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.content || []).map(jsonText).join('')
}

/** 同样的预扫描，输入换成 tiptap 的 JSON 文档 —— 公众号那条线拿到的是纯 JSON。 */
export async function collectMermaidPngsFromJson(
  doc: JsonNode | null | undefined,
  theme: MermaidTheme = 'light',
): Promise<Map<string, MermaidPng>> {
  const sources = new Set<string>()
  const walk = (node: JsonNode) => {
    if (node.type === 'codeBlock' && isMermaidLanguage(node.attrs?.language)) {
      const source = jsonText(node).trim()
      if (source) sources.add(source)
      return
    }
    for (const child of node.content || []) walk(child)
  }
  if (doc) walk(doc)
  return renderSources(sources, theme)
}

/**
 * 图表在公众号导出里的图片 src。
 *
 * 公众号正文只认 mmbiz 图片，data URL 发出去就是死图。所以图表走和普通图片
 * 完全一样的路：先给一个稳定的假 src，预览时 resolveImage 换成 data URL，
 * 发草稿时后端上传素材再把它替换成 mmbiz 地址。因此这个 src 必须只由源码
 * 决定 —— 渲染端和上传端得算出同一个名字。
 */
export function mermaidImageSrc(code: string): string {
  const source = code.trim()
  let hash = 0x811c9dc5
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `/mermaid/${(hash >>> 0).toString(16)}-${source.length}.png`
}
