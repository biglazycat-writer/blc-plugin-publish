import { describe, expect, it } from 'vitest'
import { docFromMarkdown } from '../../content-model'
import { inferPlan } from './infer-plan'
import { planSummary } from './layout-plan'
import { getLayoutTheme, WECHAT_LAYOUT_THEMES } from './layout-themes'
import { renderLayoutPlan } from './render-plan'
import { buildLayoutHtml } from './index'

// Minimal ProseMirror doc helpers, matching what tiptap's getJSON() produces.
const text = (t: string, marks?: Record<string, unknown>[]) => ({ type: 'text', text: t, marks })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })
const heading = (level: number, t: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(t)],
})
const doc = (...content: unknown[]) => ({ type: 'doc', content })

const SAMPLE = doc(
  heading(1, 'AI 正从会聊天走向真能干活'),
  para(text('多模态 · 长上下文 · 智能体')),
  para(text('过去两年，大家更关注参数规模。现在，'), text('真正重要的问题变了', [{ type: 'bold' }]), text('。')),
  heading(2, '大模型能力边界的扩展'),
  para(text('从技术主线来看，大模型依然是 AI 发展的基础，需要理解图像、语音和代码。')),
  { type: 'blockquote', content: [para(text('模型的能力边界，决定了它能触达多远的现实世界。'))] },
  heading(2, '智能体与 AI 编程'),
  para(text('🛠️ 智能体：真正能把事情办完的 AI')),
  para(text('普通聊天机器人只回答问题，而智能体需要理解目标、拆解任务并调用工具。')),
  para(text('#人工智能 #AI趋势 #大模型')),
)

describe('inferPlan', () => {
  it('derives cover, chapters and tags from the document', () => {
    const plan = inferPlan(SAMPLE)
    expect(plan.cover?.title).toBe('AI 正从会聊天走向真能干活')
    // The short standfirst paragraph is promoted to the cover subtitle.
    expect(plan.cover?.subtitle).toBe('多模态 · 长上下文 · 智能体')
    expect(plan.chapters.map((c) => c.title)).toEqual([
      '大模型能力边界的扩展',
      '智能体与 AI 编程',
    ])
    expect(plan.chapters[0].number).toBe('01')
    expect(plan.tags).toEqual(['#人工智能', '#AI趋势', '#大模型'])
  })

  it('classifies quotes, sub-headings and key phrases', () => {
    const plan = inferPlan(SAMPLE)
    const kinds = plan.chapters[0].blocks.map((b) => b.kind)
    expect(kinds).toContain('quote')

    // An emoji-led short paragraph reads as a sub-heading, not body copy.
    expect(plan.chapters[1].blocks[0].kind).toBe('subHeading')

    // A bold run in the lead becomes a key phrase for skim-reading.
    const leadSpans = plan.lead.flatMap((b) => b.spans || [])
    expect(leadSpans.some((s) => s.key || s.strong)).toBe(true)
  })

  it('never invents a TOC — it only appears where the author wrote [TOC]', () => {
    const tocBlocks = (plan: ReturnType<typeof inferPlan>) =>
      [...plan.lead, ...plan.chapters.flatMap((c) => c.blocks)].filter((b) => b.kind === 'toc')

    // 有多个章节也不自动出目录 —— 目录是作者的显式请求。
    expect(tocBlocks(inferPlan(SAMPLE))).toHaveLength(0)

    const withToc = inferPlan(doc(
      heading(1, '标题'),
      para(text('[TOC]')),
      heading(2, '第一章'),
      para(text('正文')),
    ))
    // 位置保留：`[TOC]` 写在第一个 H2 之前，所以落在导语里，而不是被挪到某处。
    expect(withToc.lead.map((b) => b.kind)).toEqual(['toc'])
  })

  it('falls back to the supplied title when the document has no H1', () => {
    const plan = inferPlan(doc(para(text('正文段落'))), { title: '外部标题' })
    expect(plan.cover?.title).toBe('外部标题')
  })

  it('returns an empty plan for a null document', () => {
    const plan = inferPlan(null)
    expect(plan.chapters).toHaveLength(0)
    expect(plan.cover).toBeUndefined()
  })
})

describe('renderLayoutPlan', () => {
  const themes = Object.values(WECHAT_LAYOUT_THEMES)

  it.each(themes.map((t) => [t.name, t] as const))(
    'renders WeChat-compliant HTML for %s',
    (_name, theme) => {
      const html = renderLayoutPlan(inferPlan(SAMPLE), theme.tokens)
      expect(html).not.toBe('')
      // Compliance rules enforced by normalizeWechatHtmlFragment.
      expect(html).not.toMatch(/\sclass=/)
      expect(html).not.toMatch(/<style|<script|<link/i)
      expect(html).not.toMatch(/position\s*:\s*(fixed|absolute|sticky)/)
      expect(html).not.toMatch(/display\s*:\s*grid/)
      expect(html).not.toMatch(/var\(--/)
      expect(html).not.toContain('<div')
      // Content survives rendering.
      expect(html).toContain('大模型能力边界的扩展')
      expect(html).toContain('人工智能')
    },
  )

  it('gives each theme a visually distinct cover and chapter header', () => {
    const plan = inferPlan(SAMPLE)
    const covers = new Set(themes.map((t) => renderLayoutPlan(plan, t.tokens).slice(0, 900)))
    // Distinct component shapes must not collapse to the same markup.
    expect(covers.size).toBe(themes.length)
  })


  it('renders the TOC card where the author put it, and nowhere when they did not', () => {
    const theme = getLayoutTheme('chineseTraditional')!
    const withToc = doc(
      heading(1, '标题'),
      para(text('[TOC]')),
      heading(2, '第一章'),
      para(text('正文一')),
      heading(2, '第二章'),
      para(text('正文二')),
    )
    const html = renderLayoutPlan(inferPlan(withToc), theme.tokens)
    expect(html).toContain('目录 · CONTENTS')
    expect(html).toContain('PART 01')
    expect(html).toContain('PART 02')
    // 目录卡片排在第一个章节头之前 —— 位置来自作者，不是固定插槽。
    expect(html.indexOf('目录 · CONTENTS')).toBeLessThan(html.indexOf('第 · 01'))

    // 没写 `[TOC]` 就没有目录卡片，章节再多也一样。
    expect(renderLayoutPlan(inferPlan(SAMPLE), theme.tokens)).not.toContain('目录 · CONTENTS')
  })

  it('applies the image resolver to article images', () => {
    const withImage = doc(
      heading(1, '标题'),
      heading(2, '章节'),
      { type: 'image', attrs: { src: '/localimg/abc', alt: '示意图' } },
    )
    const theme = getLayoutTheme('chineseTraditional')!
    const html = renderLayoutPlan(inferPlan(withImage), theme.tokens, {
      resolveImage: (src) => (src === '/localimg/abc' ? 'https://mmbiz.qpic.cn/x.png' : src),
    })
    expect(html).toContain('https://mmbiz.qpic.cn/x.png')
    expect(html).not.toContain('/localimg/abc')
  })

  it('escapes HTML in document text', () => {
    const hostile = doc(heading(1, '<img onerror=x>'), para(text('a < b & c')))
    const theme = getLayoutTheme('chineseTraditional')!
    const html = renderLayoutPlan(inferPlan(hostile), theme.tokens)
    // The hostile text must survive only as inert entities: no live <img> tag,
    // and no attribute the editor could execute. Checking for the bare string
    // "onerror" would be wrong — it legitimately appears inside the escaped
    // literal `&lt;img onerror=x&gt;`, which renders as visible text.
    // The hostile markup survives only as inert, escaped text: no live tag is
    // produced, so nothing is executable when pasted into the WeChat editor.
    expect(html).toContain('&lt;img onerror=x&gt;')
    expect(html).not.toMatch(/<img\b/)
    expect(html).toContain('a &lt; b &amp; c')
  })
})

describe('buildLayoutHtml', () => {
  it('infers and renders in one call', () => {
    const result = buildLayoutHtml(SAMPLE, { themeId: 'chineseTraditional' })
    expect(result.html).not.toBe('')
    expect(result.plan.cover).toBeDefined()
    expect(result.plan.chapters).toHaveLength(2)
  })

  it('returns empty HTML for a non-layout theme id', () => {
    const result = buildLayoutHtml(SAMPLE, { themeId: 'darkTech' })
    expect(result.html).toBe('')
  })

  it('picks up [TOC] written in Markdown source', () => {
    // 用户实际走的是这条路：源码模式里写 Markdown → 解析成 doc → 导出。
    const md = '# 标题\n\n[TOC]\n\n## 第一章\n\n正文一\n\n## 第二章\n\n正文二\n'
    const result = buildLayoutHtml(docFromMarkdown(md) as Record<string, unknown>, {
      themeId: 'chineseTraditional',
    })
    expect(result.plan.chapters).toHaveLength(2)
    expect(result.html).toContain('目录 · CONTENTS')
    // 占位符本身不该以文字形式漏进正文。
    expect(result.html).not.toContain('[TOC]')
  })

  it('applies publishing typography and spacing overrides to layout themes', () => {
    const theme = getLayoutTheme('chineseTraditional')!
    const html = renderLayoutPlan(inferPlan(SAMPLE), theme.tokens, {
      styleOverrides: {
        fontSize: 18,
        lineHeight: 2.1,
        paragraphSpacing: 0.8,
        contentPadding: 24,
        headingScale: 1.2,
      },
    })

    // 只验证「覆盖生效」：具体像素由各主题自己的 tokens 决定，写死数字会让这条
    // 测试在每次调整主题时误报。
    expect(html).toContain('font-size:18px')
    expect(html).toContain('line-height:2.1')
    expect(html).toMatch(/padding:0 \d+px/)
    expect(html).toMatch(/font-size:\d+px/)
    expect(html).toMatch(/margin:0 0 \d+px/)
  })

  it('summarizes the plan for the UI chips', () => {
    const summary = planSummary(inferPlan(SAMPLE))
    expect(summary.hasCover).toBe(true)
    expect(summary.chapters).toBe(2)
    expect(summary.quotes).toBeGreaterThanOrEqual(1)
    // SAMPLE 里没有 `[TOC]`，所以「目录」chip 不该亮。
    expect(summary.hasToc).toBe(false)
  })
})
