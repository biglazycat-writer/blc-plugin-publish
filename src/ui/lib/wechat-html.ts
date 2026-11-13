/**
 * Convert editor HTML / markdown-rendered HTML into a WeChat-friendly fragment.
 * Goal: pasteable content for mp.weixin.qq.com article editor — not pixel-perfect
 * theming. Scripts, forms, and layout chrome are stripped; common writing tags kept.
 */

export type WeChatHtmlOptions = {
  title?: string
  author?: string
  keepTitleHeading?: boolean
}

const ALLOWED_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4',
  'P', 'BR', 'HR',
  'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'CODE',
  'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'SPAN',
  'A', 'IMG',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'FIGURE', 'FIGCAPTION', 'SECTION', 'DIV',
])

const VOID_TAGS = new Set(['BR', 'HR', 'IMG'])

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
}

function cleanText(text: string): string {
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

function attr(el: Element, name: string): string {
  return (el.getAttribute(name) || '').trim()
}

function serializeChildren(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    out += serializeNode(child)
  })
  return out
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return cleanText(node.textContent || '')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName.toUpperCase()

  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'FORM') {
    return ''
  }

  if (tag === 'BR') return '<br/>'
  if (tag === 'HR') return '<hr/>'

  if (tag === 'IMG') {
    const src = attr(el, 'src') || attr(el, 'data-src')
    if (!src || src.startsWith('data:')) {
      // Local/data images cannot be pasted into WeChat reliably; keep alt as note.
      const alt = attr(el, 'alt')
      return alt ? `<p>【图片：${escapeHtml(alt)}】</p>` : '<p>【图片需先上传到公众号素材库】</p>'
    }
    const alt = escapeHtml(attr(el, 'alt'))
    const safeSrc = escapeAttr(src)
    return `<p style="text-align:center;margin:12px 0;"><img src="${safeSrc}" alt="${alt}" style="max-width:100%;height:auto;"/></p>`
  }

  if (tag === 'A') {
    const href = attr(el, 'href')
    const inner = serializeChildren(el).trim() || href
    if (!href || href.startsWith('javascript:')) return inner
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
  }

  if (!ALLOWED_TAGS.has(tag)) {
    return serializeChildren(el)
  }

  // Flatten decorative spans/divs that only wrap text.
  if ((tag === 'SPAN' || tag === 'DIV' || tag === 'SECTION') && !el.querySelector('img,ul,ol,table,blockquote,pre,h1,h2,h3,h4')) {
    const inner = serializeChildren(el)
    // Prefer block separation for div/section with block children already handled.
    if (tag === 'DIV' || tag === 'SECTION') {
      const trimmed = inner.trim()
      if (!trimmed) return ''
      if (/^<(p|h\d|ul|ol|blockquote|table|pre|hr)\b/i.test(trimmed) || /<\/(p|h\d|ul|ol|blockquote|table|pre)>$/i.test(trimmed)) {
        return trimmed
      }
      return `<p>${trimmed}</p>`
    }
    return inner
  }

  const inner = serializeChildren(el)
  if (!inner.trim() && !VOID_TAGS.has(tag)) {
    // Keep empty paragraphs lightly for spacing from blank lines.
    if (tag === 'P') return '<p><br/></p>'
    return ''
  }

  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
      return `<${tag.toLowerCase()} style="font-weight:600;margin:1.2em 0 0.6em;">${inner}</${tag.toLowerCase()}>`
    case 'P':
      return `<p style="margin:0.7em 0;line-height:1.75;">${inner}</p>`
    case 'BLOCKQUOTE':
      return `<blockquote style="margin:0.9em 0;padding:0.4em 0 0.4em 0.9em;border-left:3px solid #ddd;color:#666;">${inner}</blockquote>`
    case 'PRE':
      return `<pre style="padding:12px;background:#f6f6f6;border-radius:6px;overflow:auto;font-size:13px;line-height:1.6;">${inner}</pre>`
    case 'CODE':
      if (el.parentElement?.tagName === 'PRE') return escapeHtml(el.textContent || '')
      return `<code style="padding:0 4px;background:#f3f3f3;border-radius:3px;">${inner}</code>`
    case 'UL':
      return `<ul style="margin:0.7em 0;padding-left:1.4em;">${inner}</ul>`
    case 'OL':
      return `<ol style="margin:0.7em 0;padding-left:1.4em;">${inner}</ol>`
    case 'LI':
      return `<li style="margin:0.25em 0;">${inner}</li>`
    case 'TABLE':
      return `<table style="border-collapse:collapse;width:100%;margin:0.8em 0;">${inner}</table>`
    case 'TH':
    case 'TD':
      return `<${tag.toLowerCase()} style="border:1px solid #ddd;padding:6px 8px;">${inner}</${tag.toLowerCase()}>`
    case 'STRONG':
    case 'B':
      return `<strong>${inner}</strong>`
    case 'EM':
    case 'I':
      return `<em>${inner}</em>`
    case 'U':
      return `<u>${inner}</u>`
    case 'S':
    case 'DEL':
      return `<s>${inner}</s>`
    default:
      return inner
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

/**
 * Build a WeChat-oriented HTML fragment from arbitrary editor HTML.
 */
export function toWeChatHtml(rawHtml: string, options: WeChatHtmlOptions = {}): string {
  const source = (rawHtml || '').trim()
  if (!source && !options.title) return ''

  const doc = new DOMParser().parseFromString(
    `<div id="lb-wechat-root">${source || '<p></p>'}</div>`,
    'text/html',
  )
  const root = doc.getElementById('lb-wechat-root')
  if (!root) return source

  // Drop TipTap chrome wrappers if present.
  root.querySelectorAll('.tableWrapper').forEach((wrap) => {
    const table = wrap.querySelector('table')
    if (table) wrap.replaceWith(table)
  })

  let body = serializeChildren(root).trim()
  // Collapse accidental double wrappers.
  body = body.replace(/(?:<p><br\/?><\/p>\s*){3,}/g, '<p><br/></p>')

  const parts: string[] = []
  if (options.keepTitleHeading !== false && options.title?.trim()) {
    parts.push(`<h1 style="font-weight:600;margin:0 0 0.8em;font-size:22px;">${escapeHtml(options.title.trim())}</h1>`)
  }
  if (options.author?.trim()) {
    parts.push(`<p style="color:#888;margin:0 0 1em;font-size:13px;">作者：${escapeHtml(options.author.trim())}</p>`)
  }
  if (body) parts.push(body)
  return parts.join('\n')
}

/** Plain-text fallback for clipboard / fill when HTML injection fails. */
export function toWeChatPlain(rawHtml: string, title?: string): string {
  const doc = new DOMParser().parseFromString(`<div>${rawHtml || ''}</div>`, 'text/html')
  const text = (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  if (title?.trim()) return `${title.trim()}\n\n${text}`.trim()
  return text
}

/** Write HTML + plain to clipboard (best-effort). */
export async function copyWeChatHtml(html: string, plain: string): Promise<void> {
  const plainText = plain || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return
    }
  } catch {
    /* fall through */
  }
  await navigator.clipboard.writeText(plainText || html)
}
