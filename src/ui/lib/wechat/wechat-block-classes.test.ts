import { describe, expect, it } from 'vitest'
import { exportWechatHtmlFromJson } from './wechat-export'
import { parseThemeSource } from '../editor-themes/theme-parse'

/**
 * 导出的段落首行缩进必须认 `pm-line-block`。
 *
 * 中文主题的首行缩进（`text-indent`）只该给散文段落，元信息块（编写日期 / 适用项目…）
 * 是一行一件事，缩进整块的第一行会变成「只有第一行缩进」的怪样子。
 *
 * 这里必须走**真实导出管线**（juice 内联 + class 剥离），因为导出侧块类名挂在包住段落的
 * `<section>` 上，而 `text-indent` 要落在 `<p>` 上 —— 主题为此同时写了
 * `p.pm-line-block` 与 `.pm-line-block p` 两条选择器，只有内联后的 style 才能证明它生效。
 */
const THEME = parseThemeSource(
  'probe',
  [
    '/*',
    '@name 探针',
    '*/',
    'p { text-indent: 2em; }',
    'p.pm-line-block, .pm-line-block p { text-indent: 0; }',
    '',
  ].join('\n'),
  false,
)

/** 取第 n 个段落内联后的 text-indent。 */
function indentOf(html: string, index: number): string {
  const tags = html.match(/<p[^>]*>/g) || []
  const match = /text-indent:\s*([^;"]+)/.exec(tags[index] ?? '')
  return (match?.[1] ?? '').trim()
}

describe('导出的块类名 → 段落首行缩进', () => {
  it('段内有换行（Markdown soft break）的块不缩进，散文段落照旧缩进', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '编写日期：2026-09-22\n适用项目：uacs-flight-web\n文档状态：改造设计。' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '这是一段普通正文。' }] },
      ],
    }

    const html = exportWechatHtmlFromJson(doc, THEME)

    expect(indentOf(html, 0)).toBe('0')
    expect(indentOf(html, 1)).toBe('2em')
  })

  it('行内硬换行（<br>）同样按分行排列的块处理', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '第一行。' },
            { type: 'hardBreak' },
            { type: 'text', text: '第二行。' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '对照段落。' }] },
      ],
    }

    const html = exportWechatHtmlFromJson(doc, THEME)

    expect(indentOf(html, 0)).toBe('0')
    expect(indentOf(html, 1)).toBe('2em')
  })
})

/**
 * 目录占位符 `[TOC]` 在 CSS 管线的导出里也必须变成目录。
 *
 * 否则会出现最尴尬的那种不一致：作者在编辑器里看见一块目录，发到公众号却是一行字面量
 * `[TOC]`。DOM 与类名跟编辑器、源码预览共用 `lib/toc.ts` 那一份，所以主题的 `.pm-toc*`
 * 规则三处同时命中 —— 这里顺便证明它确实被 juice 内联进了导出结果。
 */
describe('导出的目录（[TOC]）', () => {
  const TOC_THEME = parseThemeSource(
    'toc-probe',
    [
      '/*',
      '@name 目录探针',
      '*/',
      '.pm-readable-block { border-bottom: 1px dotted #cccccc; }',
      '.pm-toc-link { color: #123456; }',
      '',
    ].join('\n'),
    false,
  )

  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '[TOC]' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '一、引言' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '1.1 小节' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '二、维度' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '正文。' }] },
    ],
  }

  it('占位段落变成目录块，条目只收 H2', () => {
    const html = exportWechatHtmlFromJson(doc, TOC_THEME)
    const nav = /<nav[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? ''

    expect(html).not.toContain('[TOC]')
    expect(nav).toContain('一、引言')
    expect(nav).toContain('二、维度')
    // H3 不进目录（口径与组件管线、源码预览一致）。
    expect(nav).not.toContain('1.1 小节')
    // 主题的 `.pm-toc-link` 被内联进来了（导出侧 class 会被剥掉，只剩 style）。
    expect(nav).toContain('color: #123456')
  })

  it('目录块不吃 pm-readable-block —— 主题给正文的底边线不该套到目录上', () => {
    const html = exportWechatHtmlFromJson(doc, TOC_THEME)
    const navIndex = html.indexOf('<nav')
    const wrapper = html.slice(html.lastIndexOf('<section', navIndex), navIndex)

    expect(navIndex).toBeGreaterThan(-1)
    expect(wrapper).not.toContain('border-bottom')
    // 对照：普通段落照旧拿到那条底边线。
    expect(html).toContain('border-bottom: 1px dotted #cccccc')
  })

  it('没有 H2 时整块不输出，而不是留一个空目录框', () => {
    const html = exportWechatHtmlFromJson(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '[TOC]' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '正文。' }] },
        ],
      },
      TOC_THEME,
    )

    expect(html).not.toContain('[TOC]')
    expect(html).not.toContain('<nav')
  })
})
