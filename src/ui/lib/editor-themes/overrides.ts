import { EXPORT_THEME_SCOPE } from './scope'
import type { EditorTheme } from './types'

/**
 * 发布面板的 CSS 微调。
 *
 * 这几个滑杆只作用于**公众号导出**：它们补偿的是「同一份主题在手机窄屏上读起来
 * 和宽屏编辑器里不一样」，不是编辑器偏好 —— 编辑器的字号行距在编辑器设置里。
 */
export type WeChatStyleOverrides = {
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  paragraphSpacing?: number
  contentPadding?: number
  headingScale?: number
  accentColor?: string
}

export const DEFAULT_STYLE_OVERRIDES = {
  fontSize: 16,
  lineHeight: 1.9,
  letterSpacing: 0.5,
  paragraphSpacing: 0.6,
  contentPadding: 2,
  headingScale: 1,
}

/** 生成覆盖 CSS。放在主题 CSS 之后，所以同优先级下它赢。 */
export function buildOverrideCss(theme: EditorTheme, overrides?: WeChatStyleOverrides): string {
  if (!overrides) return ''

  const fontSize = overrides.fontSize ?? DEFAULT_STYLE_OVERRIDES.fontSize
  const lineHeight = overrides.lineHeight ?? DEFAULT_STYLE_OVERRIDES.lineHeight
  const letterSpacing = overrides.letterSpacing ?? DEFAULT_STYLE_OVERRIDES.letterSpacing
  const paragraphSpacing = overrides.paragraphSpacing ?? DEFAULT_STYLE_OVERRIDES.paragraphSpacing
  const contentPadding = overrides.contentPadding ?? DEFAULT_STYLE_OVERRIDES.contentPadding
  const headingScale = overrides.headingScale ?? DEFAULT_STYLE_OVERRIDES.headingScale
  const accentColor = overrides.accentColor || theme.preview.accent

  const h1Size = Math.round(fontSize * 1.5 * headingScale)
  const h2Size = Math.round(fontSize * 1.25 * headingScale)
  const h3Size = Math.round(fontSize * 1.125 * headingScale)

  const s = EXPORT_THEME_SCOPE
  return `
${s} { padding-left: ${contentPadding}px; padding-right: ${contentPadding}px; line-height: ${lineHeight}; letter-spacing: ${letterSpacing}px; }
${s} p { font-size: ${fontSize}px; line-height: ${lineHeight}; letter-spacing: ${letterSpacing}px; margin-bottom: ${paragraphSpacing}em; }
${s} li { font-size: ${fontSize}px; line-height: ${lineHeight}; letter-spacing: ${letterSpacing}px; }
${s} h1 { font-size: ${h1Size}px; line-height: ${Math.max(1.35, lineHeight - 0.25)}; }
${s} h2 { font-size: ${h2Size}px; line-height: ${Math.max(1.35, lineHeight - 0.2)}; }
${s} h3 { font-size: ${h3Size}px; line-height: ${Math.max(1.35, lineHeight - 0.15)}; }
${s} h2 { border-color: ${accentColor}; }
${s} h2::before { color: ${accentColor}; }
${s} blockquote { border-left-color: ${accentColor}; }
${s} a { border-bottom-color: ${accentColor}; }
${s} hr { border-top-color: ${accentColor}; }
`.trim()
}
