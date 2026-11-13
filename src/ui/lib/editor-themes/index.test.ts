import { describe, expect, it } from 'vitest'
import {
  buildEditorThemeCss,
  buildExportThemeCss,
  buildUiThemeCss,
  DEFAULT_EDITOR_THEME_ID,
  findTheme,
  PLAIN_THEME,
} from './index'
import { DEFAULT_THEME_RHYTHM, type EditorTheme } from './types'

const theme = (id: string): EditorTheme => ({
  id,
  name: id,
  description: '',
  tags: [],
  css: '',
  preview: { accent: '#000000', bg: '#ffffff' },
  rhythm: DEFAULT_THEME_RHYTHM,
  builtin: true,
})

const THEMES = [theme('a'), theme('b')]

/**
 * 默认主题是一套真实主题；找不到时调用方按 `DEFAULT_EDITOR_THEME_ID` 兜底。
 */
describe('findTheme', () => {
  it('空 id 不命中，返回 undefined 交给调用方兜底', () => {
    expect(findTheme('', THEMES)).toBeUndefined()
    expect(findTheme('   ', THEMES)).toBeUndefined()
    expect(findTheme(null, THEMES)).toBeUndefined()
    expect(findTheme(undefined, THEMES)).toBeUndefined()
  })

  it('主题被删掉后返回 undefined，由调用方回落到默认主题', () => {
    expect(findTheme('已经删掉的主题', THEMES)).toBeUndefined()
  })

  it('命中时返回那套主题', () => {
    expect(findTheme('b', THEMES)?.id).toBe('b')
  })

  it('主题列表为空时也不报错', () => {
    expect(findTheme('a', [])).toBeUndefined()
  })
})

describe('PLAIN_THEME', () => {
  it('不带任何装饰 CSS —— 导出时只上排版底座', () => {
    expect(PLAIN_THEME.css).toBe('')
    expect(PLAIN_THEME.id).toBe(DEFAULT_EDITOR_THEME_ID)
  })
})

/**
 * 主题要跟着应用的白天/黑夜走：同一套主题，黑夜模式下必须换一份**深色**的 CSS。
 * 但公众号导出永远拿浅色版 —— 文章是给白天读、还会被打印的读者看的。
 */
describe('buildEditorThemeCss 的配色模式', () => {
  const theme = (overrides: Partial<EditorTheme> = {}): EditorTheme => ({
    id: 't',
    name: 't',
    description: '',
    tags: [],
    css: 'h1 { margin: 2em 0; color: #101010; }',
    preview: { accent: '#000000', bg: '#ffffff' },
    rhythm: DEFAULT_THEME_RHYTHM,
    builtin: true,
    ...overrides,
  })

  it('默认（导出走的那条路）是浅色', () => {
    const withDark = theme({ darkCss: 'h1 { color: #EEEEEE; }' })
    expect(buildEditorThemeCss(withDark)).toBe(buildEditorThemeCss(withDark, 'light'))
  })

  it('浅色模式不含任何深色产物', () => {
    const css = buildEditorThemeCss(theme({ darkCss: 'h1 { color: #EEEEEE; }' }), 'light')

    expect(css).toContain('#101010')
    expect(css).not.toContain('#EEEEEE')
    expect(css).not.toContain('#D4D4D4')
  })

  it('主题带深色段时，黑夜模式用深色段覆盖浅色', () => {
    const css = buildEditorThemeCss(theme({ darkCss: 'h1 { color: #EEEEEE; }' }), 'dark')

    // 版式（间距）仍来自浅色段 —— 深色段只负责颜色，不该重写一遍版式。
    expect(css).toContain('margin: 2em 0')
    expect(css).toContain('#101010')
    expect(css).toContain('#EEEEEE')
    // 深色段必须排在浅色段后面，否则覆盖不了。
    expect(css.indexOf('#EEEEEE')).toBeGreaterThan(css.indexOf('#101010'))
    // 深色底座兜住主题没写的选择器。
    expect(css).toContain('#D4D4D4')
  })

  it('主题没有深色段时，黑夜模式把纸钉回浅色而不是套通用深色', () => {
    const css = buildEditorThemeCss(theme(), 'dark')

    expect(css).toContain('background-color: #FFFFFF')
    // 通用深色底座会把主题的浅色身份洗掉，所以这里必须缺席。
    expect(css).not.toContain('#D4D4D4')
    expect(css).toContain('#101010')
  })

  it('浅色纸张的兜底排在主题根规则之前 —— 主题自己的纸色要能压过它', () => {
    const papered = theme({ css: ':root { background-color: #F7F1E3; }' })
    const css = buildEditorThemeCss(papered, 'dark')

    expect(css.indexOf('background-color: #FFFFFF')).toBeLessThan(css.indexOf('#F7F1E3'))
  })

  it('把主题实际铺的纸色交给图片背景的透明度滑块', () => {
    const papered = theme({
      css: ':root { background-color: #F7F1E3; }',
      darkCss: ':root { background-color: #1A1512; }',
    })
    expect(buildEditorThemeCss(papered, 'light')).toContain('.neContainer { --editor-paper-color: #F7F1E3; }')
    expect(buildEditorThemeCss(papered, 'dark')).toContain('.neContainer { --editor-paper-color: #1A1512; }')
    // 没做深色版的主题在黑夜里被钉回白纸，滑块调的也是那张白纸。
    expect(buildEditorThemeCss(theme(), 'dark')).toContain('--editor-paper-color: #FFFFFF')
    // 浅色下没写纸色：留给底座的 --editor-page-bg。
    expect(buildEditorThemeCss(theme(), 'light')).not.toContain('--editor-paper-color')
  })

  it('公众号导出永远拿浅色 —— 深色段不许漏进去', () => {
    const css = buildExportThemeCss(theme({ darkCss: 'h1 { color: #EEEEEE; }' }))

    expect(css).toContain('#101010')
    expect(css).not.toContain('#EEEEEE')
    expect(css).not.toContain('.neEditorContent')
  })

  it('导出 CSS 把 content 里的 var() 解析成字面值，字面量不会印进文章', () => {
    const css = buildExportThemeCss(theme({
      css: [
        ':root { --theme-motto: "刊头口号"; }',
        'h1::after { content: var(--theme-motto, "缺省口号"); }',
        'h2::before { content: var(--theme-undefined, "兜底文案"); }',
      ].join('\n'),
    }))

    // juice 不会求值 var()，字面量会原样印进文章 —— 导出 CSS 里必须一个不剩
    expect(css).not.toMatch(/var\(--/)
    expect(css).toContain('content: "刊头口号"')
    // 主题里没定义的变量落到 var() 自带的 fallback
    expect(css).toContain('content: "兜底文案"')
  })
})

/**
 * 界面层（`ui.css`）与正文层共用一套主题，但注入方式不同：正文收进
 * `.neEditorContent .ProseMirror`，界面直接落在 `:root` 上（它本来就是一份变量表）。
 *
 * 这里钉的是「改前缀」这件事 —— 不能退化成「把根规则的 body 整块搬到 :root」。
 * `ui.css` 里除了纯变量表，还有带后续段的复合选择器（毛玻璃的
 * `:root:not([data-background='image']) .appSidebar`）。整块搬走会把 `.appSidebar`
 * 丢掉，一条本该只作用于侧栏的 `!important` 背景规则打到 `<html>` 上。
 */
describe('buildUiThemeCss 的界面层映射', () => {
  const withUi = (uiCss: string, uiDarkCss?: string): EditorTheme => ({
    ...theme('t'),
    uiCss,
    uiDarkCss,
  })

  it('浅色段落在 :root 上，不带深色档', () => {
    const css = buildUiThemeCss(withUi(':root { --bg-base: #FFFFFF; }'), 'light')

    expect(css).toContain(':root {')
    expect(css).toContain('--bg-base: #FFFFFF')
    expect(css).not.toContain("data-theme='dark'")
  })

  it('复合根选择器保留后半段 —— 玻璃面板规则不能被打到根元素上', () => {
    const css = buildUiThemeCss(
      withUi(":root:not([data-background='image']) .appSidebar { backdrop-filter: blur(18px); }"),
      'light',
    )

    expect(css).toContain('.appSidebar')
    // 退化成裸 `:root { … backdrop-filter … }` 就是 bug：整块界面会被一起模糊。
    expect(css).not.toMatch(/:root\s*\{[^}]*backdrop-filter/u)
  })

  it('深色段的根记号整体抬成 :root[data-theme=\'dark\']，后续段不丢', () => {
    const css = buildUiThemeCss(
      withUi(':root { --bg-base: #FFFFFF; }', ":root { --bg-base: #111111; }\n:root button { border-radius: 10px; }"),
      'dark',
    )

    expect(css).toContain(':root {')
    expect(css).toContain(":root[data-theme='dark'] {")
    expect(css).toContain(":root[data-theme='dark'] button")
    expect(css).toContain('--bg-base: #111111')
    expect(css).toContain('border-radius: 10px')
  })

  it('深色段排在浅色段之后 —— 同特异度时靠顺序决胜', () => {
    const css = buildUiThemeCss(
      withUi(':root { --bg-base: #FFFFFF; }', ':root { --bg-base: #111111; }'),
      'dark',
    )

    expect(css.indexOf('#111111')).toBeGreaterThan(css.indexOf('#FFFFFF'))
  })

  it('没有 ui.css 的主题仍把正文纸色传给应用外壳', () => {
    expect(buildUiThemeCss(theme('t'), 'light')).toContain('--theme-paper-bg: #ffffff')
    expect(buildUiThemeCss(theme('t'), 'dark')).toContain("--theme-paper-bg: var(--editor-page-bg)")
  })

  it('界面层使用正文主题的浅色纸色，避免纸张与外壳分裂', () => {
    const css = buildUiThemeCss({ ...theme('t'), preview: { accent: '#000000', bg: '#FFFAE8' } }, 'light')
    expect(css).toContain('--theme-paper-bg: #FFFAE8')
  })
})
