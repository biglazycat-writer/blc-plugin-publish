// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_RHYTHM } from '../editor-themes/types'
import { exportWechatHtmlFromJson } from './wechat-export'
import { inferPlan } from './layout/infer-plan'
import { mermaidImageSrc } from '../mermaid-inline'
import type { MermaidPng } from '../mermaid-render'

const DIAGRAM = 'graph TD\n  A[开始] --> B[结束]'

const diagramBlock = {
  type: 'codeBlock',
  attrs: { language: 'mermaid' },
  content: [{ type: 'text', text: DIAGRAM }],
}

const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks })

const PNG: MermaidPng = { dataUrl: 'data:image/png;base64,AAA', width: 400, height: 200 }

/** 预扫描的结果：按源码索引，命中即表示这张图渲染成功了。 */
const rendered = new Map<string, MermaidPng>([[DIAGRAM, PNG]])

const TEST_THEME = {
  id: 'test',
  name: '测试主题',
  description: '',
  tags: [],
  css: '',
  preview: { accent: '#333333', bg: '#ffffff' },
  rhythm: DEFAULT_THEME_RHYTHM,
  builtin: false,
}

describe('mermaid 的公众号导出', () => {
  it('位图化后当居中图片输出，src 走 resolveImage（公众号只认 mmbiz 图片）', () => {
    const src = mermaidImageSrc(DIAGRAM)
    const html = exportWechatHtmlFromJson(doc(diagramBlock), TEST_THEME, undefined, {
      mermaidPngs: rendered,
      resolveImage: (raw) => (raw === src ? PNG.dataUrl : raw),
    })

    expect(html).toContain(`src="${PNG.dataUrl}"`)
    expect(html).toContain('alt="Mermaid 图表"')
    // 图表不应该再以源码形式出现一次。
    expect(html).not.toContain('graph TD')
  })

  it('没有解析器时保留假 src，交给上传环节替换 —— 和普通图片一致', () => {
    const html = exportWechatHtmlFromJson(doc(diagramBlock), TEST_THEME, undefined, {
      mermaidPngs: rendered,
    })

    expect(html).toContain(`src="${mermaidImageSrc(DIAGRAM)}"`)
  })

  it('渲染失败（不在预扫描结果里）时退回代码块，源码不丢', () => {
    const html = exportWechatHtmlFromJson(doc(diagramBlock), TEST_THEME, undefined, {
      mermaidPngs: new Map(),
    })

    expect(html).not.toContain('alt="Mermaid 图表"')
    // 代码块不能带 <pre>：公众号粘贴检查会对 pre 提示移动端横向溢出风险
    expect(html).not.toContain('<pre')
    expect(html).toContain('A[开始]')
  })

  it('其它语言的代码块照旧输出，不受影响', () => {
    const html = exportWechatHtmlFromJson(
      doc({ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const a = 1' }] }),
      TEST_THEME,
      undefined,
      { mermaidPngs: rendered },
    )

    expect(html).toContain('const')
    expect(html).not.toContain('alt="Mermaid 图表"')
  })
})

describe('mermaid 在排版计划里的位置', () => {
  it('预扫描命中就当图片块排版', () => {
    const plan = inferPlan(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '章节' }] }, diagramBlock), {
      mermaidPngs: rendered,
    })

    const block = plan.chapters[0].blocks[0]
    expect(block.kind).toBe('image')
    expect(block.src).toBe(mermaidImageSrc(DIAGRAM))
    expect(block.alt).toBe('Mermaid 图表')
  })

  it('没命中就还是代码块', () => {
    const plan = inferPlan(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '章节' }] }, diagramBlock))

    const block = plan.chapters[0].blocks[0]
    expect(block.kind).toBe('code')
    expect(block.code).toContain('graph TD')
  })
})
