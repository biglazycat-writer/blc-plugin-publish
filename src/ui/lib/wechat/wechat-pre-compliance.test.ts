// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeWechatHtmlFragment } from './wechat-html-compliance'
import { exportWechatHtmlFromJson } from './wechat-export'
import { PLAIN_THEME } from '../editor-themes'

const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks })

describe('normalizeWechatHtmlFragment pre 处理', () => {
  it('把 pre 改名 section，主题内联样式保留在元素上', () => {
    const html = normalizeWechatHtmlFragment(
      '<pre data-language="python" style="background:#f8f8f8;white-space:pre-wrap;"><code>ok</code></pre>',
    )

    expect(html).not.toContain('<pre')
    expect(html).toContain('<section data-language="python"')
    expect(html).toContain('white-space:pre-wrap')
  })

  it('代码文本的换行转成 <br>、空格转成不间断空格，标签属性不受影响', () => {
    const html = normalizeWechatHtmlFragment(
      '<pre><code><span class="hljs-keyword">def</span> run(x):\n  <span class="hljs-keyword">return</span> x + 1</code></pre>',
    )

    expect(html).not.toContain('<pre')
    expect(html).toContain('<br>')
    // innerHTML 序列化会把不间断空格写成实体
    expect(html).toContain('&nbsp;')
    // 标签内部的空格不能被替换成 nbsp，否则标签直接坏掉
    expect(html).toContain('<span leaf="">')
    expect(html).not.toContain('<span&nbsp;')
    expect(html).not.toContain('&nbsp;class=')
  })
})

describe('exportWechatHtmlFromJson 代码块', () => {
  it('导出结果不含 pre 标签，换行与主题换行样式保留', () => {
    const html = exportWechatHtmlFromJson(
      doc({
        type: 'codeBlock',
        attrs: { language: 'python' },
        content: [{ type: 'text', text: 'def run(x):\n    return x + 1' }],
      }),
      PLAIN_THEME,
    )

    expect(html).not.toContain('<pre')
    expect(html).toContain('<br')
    expect(html).toContain('&nbsp;')
    // 主题排版底座 pre 规则的换行样式已内联到改名后的元素上
    expect(html).toContain('pre-wrap')
  })
})
