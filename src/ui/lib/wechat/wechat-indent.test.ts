// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { exportWechatHtmlFromJson } from './wechat-export'
import { buildLayoutHtml } from './layout'
import { PLAIN_THEME } from '../editor-themes'

const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks })

describe('公众号导出剥离内容级段首缩进', () => {
  it('CSS 管线：块首的全角空格缩进与 text-indent 属性都不导出', () => {
    const html = exportWechatHtmlFromJson(
      doc(
        {
          type: 'paragraph',
          attrs: { indent: 2 },
          content: [
            { type: 'text', text: '　　', },
            { type: 'text', marks: [{ type: 'bold' }], text: '人工智能' },
            { type: 'text', text: '正在改变世界' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '正文段落' }] },
      ),
      PLAIN_THEME,
    )

    expect(html).not.toContain('　')
    expect(html).not.toContain('text-indent')
    expect(html).toContain('人工智能')
  })

  it('CSS 管线：标题的首行缩进同样剥掉', () => {
    const html = exportWechatHtmlFromJson(
      doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '　　一、引言' }] }),
      PLAIN_THEME,
    )

    expect(html).not.toContain('　')
    expect(html).toContain('一、引言')
  })

  it('布局管线：块首缩进剥掉，且不再破坏 emoji 小节识别', () => {
    const { html, plan } = buildLayoutHtml(
      doc(
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '　　🌐 多模态：从看图说话到跨模态推理' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
      ),
      { themeId: 'chineseTraditional' },
    )

    const subHeading = [...plan.lead, ...plan.chapters.flatMap((chapter) => chapter.blocks)]
      .find((block) => block.kind === 'subHeading')
    expect(subHeading).toBeTruthy()
    expect(html).not.toContain('　　')
  })
})
