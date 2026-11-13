import { parseCssBlocks, splitCssSelectors } from './scope'
import { DEFAULT_THEME_RHYTHM, type EditorTheme, type EditorThemePreview, type ThemeRhythm } from './types'

/**
 * 主题元数据解析。
 *
 * 主题就是一个 CSS 文件，装不下名字和描述，所以元数据写在文件头部的注释里：
 *
 * ```css
 * /*
 * @name 深夜蓝
 * @description 低饱和蓝，适合技术长文
 * @accent #1D4ED8
 * @accentSecondary #93C5FD
 * @tags 深色,技术
 *  *\/
 * h1 { color: #1D4ED8; }
 * ```
 *
 * 全部可选：缺 `@name` 就用文件夹名，缺 `@accent` 就从 CSS 里捞第一个颜色。
 * 这样从网上随手下载一份主题 CSS 丢进主题文件夹，它就能出现在列表里。
 */

const META_BLOCK = /\/\*([\s\S]*?)\*\//
const META_LINE = /@([\w-]+)[ \t]+([^\n\r*]+)/gu
const COLOR = /#[0-9a-fA-F]{3,8}\b/u

/**
 * 深色段的标记：一个内容恰好是 `@dark` 的注释。
 *
 * 用整段注释而不是 `@dark` 这种元数据行 —— 元数据行只出现在文件头，而深色段在文件
 * 中间；而且主题正文的注释里常出现 `@` 开头的说明，只有「整段注释就等于 @dark」
 * 才不会被误判。
 */
const DARK_MARKER = /\/\*\s*@dark\s*\*\//u

/**
 * 把主题文件切成浅色段与深色段。
 *
 * 浅色段是 `@dark` 之前的部分（元数据头在里面），深色段是之后的部分。没有标记时
 * 深色段为空串 —— 表示这套主题没有深色版，编辑器在黑夜模式下走浅色纸张兜底。
 */
export function splitDarkSection(source: string): { light: string; dark: string } {
  const match = DARK_MARKER.exec(source)
  if (!match) return { light: source, dark: '' }
  return {
    light: source.slice(0, match.index).trimEnd(),
    dark: source.slice(match.index + match[0].length).trim(),
  }
}

function readMeta(source: string): Record<string, string> {
  const meta: Record<string, string> = {}
  const block = META_BLOCK.exec(source)
  if (!block) return meta
  for (const line of block[1].matchAll(META_LINE)) {
    meta[line[1].toLowerCase()] = line[2].trim()
  }
  return meta
}

/** 把主题名变成一个能当文件夹名的 id。中文原样保留，其余非法字符折成连字符。 */
export function themeIdFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return base || 'theme'
}

/** 把磁盘上的一份主题读成 EditorTheme。id 同时是文件夹名。 */
export function parseThemeSource(
  id: string,
  source: string,
  builtin: boolean,
  uiSource = '',
): EditorTheme {
  const meta = readMeta(source)
  const { light, dark } = splitDarkSection(source)
  const ui = uiSource.trim() ? splitDarkSection(uiSource) : { light: '', dark: '' }
  const preview: EditorThemePreview = {
    accent: meta.accent || COLOR.exec(source)?.[0] || '#333333',
    // 没写 @bg 就从根规则读纸色（内置主题的惯例写法），导入的主题同样能识别。
    bg: meta.bg || readThemePaperBackground(light) || '#ffffff',
  }
  if (meta.accentsecondary) preview.accentSecondary = meta.accentsecondary

  return {
    id,
    name: meta.name || id.trim() || '未命名主题',
    description: meta.description || (builtin ? '内置主题' : '导入的主题'),
    tags: meta.tags
      ? meta.tags.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean)
      : [],
    css: light,
    darkCss: dark || undefined,
    uiCss: ui.light.trim() || undefined,
    uiDarkCss: ui.dark.trim() || undefined,
    source,
    preview,
    rhythm: readThemeRhythm(light),
    builtin,
  }
}

/* ─────────────────────────── 纸色的读取 ─────────────────────────── */

/** 根规则：主题作者习惯把正文纸色写在 :root / html / body 上。 */
const PAPER_ROOT_SELECTOR = /^(?:html|body|:root)$/u
/** 渐变与图片不是纸色，声明里带它们时整条放弃。 */
const NON_SOLID_BACKGROUND = /gradient\(|url\(/iu

/**
 * 从主题 CSS 里读正文纸色（根规则里的纯色底）。
 *
 * 用于桌面染色等「主题周边跟着主题走」的场合。读 `@dark` 之前的浅色段：深色段的
 * 底色属于黑夜模式，浅色界面不该被它影响。读不出来（纯白主题、或根本没写）返回
 * null，由调用方兜底。
 */
export function readThemePaperBackground(css: string): string | null {
  let paper: string | null = null
  for (const block of parseCssBlocks(css)) {
    if (block.kind !== 'rule') continue
    const isRoot = splitCssSelectors(block.prelude).some((raw) => PAPER_ROOT_SELECTOR.test(raw.trim()))
    if (!isRoot) continue
    const declarations = readDeclarations(block.body)
    const value = declarations['background-color'] ?? declarations['background']
    if (!value || NON_SOLID_BACKGROUND.test(value)) continue
    const color = COLOR.exec(value)?.[0]
    if (color) paper = color
  }
  return paper
}

/* ─────────────────────────── 正文排版节奏的读取 ─────────────────────────── */

/** 正文段落的裸标签规则。 */
const RHYTHM_TAG_SELECTOR = /^p$/u
/** 正文段落的 pm-* 装饰类：编辑器里这些类就挂在段落自己身上，特异性比裸标签高。 */
const RHYTHM_CLASS_SELECTOR = /^\.(?:pm-block|pm-paragraph)$/u
/** 根规则：整篇文章的默认行高与字距写在这里（主题作者的习惯）。 */
const RHYTHM_ROOT_SELECTOR = /^(?:html|body|:root)$/u

/** 一个数值 + 可选单位。`margin` 简写、`line-height: normal` 这类读不出来的值一律返回 null。 */
const RHYTHM_NUMBER = /^(-?\d*\.?\d+)\s*(px|em|rem|%)?$/u

/** `rem` 的基准是应用根字号（style.css 的 token 体系），不是编辑器的正文字号。 */
const APP_ROOT_FONT_SIZE = 14
/** 主题没写正文字号时的基准 —— 排版底座 `BASE_THEME_CSS` 的 `p { font-size: 16px }`。 */
const BASE_BODY_FONT_SIZE = 16

type RhythmSources = {
  /** 裸标签规则里的声明，按出现顺序由后者覆盖前者。 */
  tag: Record<string, string>
  klass: Record<string, string>
  root: Record<string, string>
}

/** 按 `;` 拆声明，跳过字符串与括号里的分号（`url(data:…;base64,…)`）。 */
function splitDeclarations(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ';' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

function readDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const chunk of splitDeclarations(body)) {
    const colon = chunk.indexOf(':')
    if (colon <= 0) continue
    const property = chunk.slice(0, colon).trim().toLowerCase()
    const value = chunk.slice(colon + 1).trim()
    if (property && value) declarations[property] = value
  }
  return declarations
}

/** 收集三类来源里的声明。一个选择器列表里出现多个类别时，各类别都收一份。 */
function collectRhythmSources(css: string): RhythmSources {
  const sources: RhythmSources = { tag: {}, klass: {}, root: {} }
  for (const block of parseCssBlocks(css)) {
    if (block.kind !== 'rule') continue
    const declarations = readDeclarations(block.body)
    for (const raw of splitCssSelectors(block.prelude)) {
      const selector = raw.trim()
      if (RHYTHM_TAG_SELECTOR.test(selector)) Object.assign(sources.tag, declarations)
      else if (RHYTHM_CLASS_SELECTOR.test(selector)) Object.assign(sources.klass, declarations)
      else if (RHYTHM_ROOT_SELECTOR.test(selector)) Object.assign(sources.root, declarations)
    }
  }
  return sources
}

/**
 * 取一个属性的值：装饰类 > 裸标签 > 根规则。
 *
 * 这个顺序就是编辑器里的实际优先级（装饰类把规则抬到 (0,3,0)，裸标签是 (0,2,1)），
 * 所以读出来的值就是编辑器正文真正生效的那个。导出侧优先级不同（裸标签在
 * `<section>` 里面，装饰类在外面），但导出用的是主题 CSS 本身，不读这个值。
 */
function pickRhythmValue(sources: RhythmSources, property: string): string | undefined {
  return sources.klass[property] ?? sources.tag[property] ?? sources.root[property]
}

/** 读一个不带单位的像素值（正文字号的基准）。 */
function readFontSize(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d*\.?\d+)\s*(px|rem)?$/u.exec(value.trim().toLowerCase())
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  return match[2] === 'rem' ? amount * APP_ROOT_FONT_SIZE : amount
}

/** 把 CSS 值读成一个倍数：无单位与 `em` 原样，`px` / `rem` 按正文字号折算。 */
function readRatio(value: string | undefined, fontSize: number): number | null {
  if (!value) return null
  const text = value.trim().toLowerCase()
  if (!text || text === 'normal' || text.startsWith('var(')) return null
  const match = RHYTHM_NUMBER.exec(text)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  switch (match[2]) {
    case undefined:
    case 'em':
      return amount
    case 'px':
      return fontSize > 0 ? amount / fontSize : null
    case 'rem':
      return fontSize > 0 ? (amount * APP_ROOT_FONT_SIZE) / fontSize : null
    case '%':
      return amount / 100
    default:
      return null
  }
}

/** `margin` / `padding` 简写里的下边距：1 个值=四边，2 个值=上下，3/4 个值取第三个。 */
function readBottomFromShorthand(value: string | undefined): string | undefined {
  if (!value) return undefined
  const tokens = value.trim().split(/\s+/u)
  return tokens[tokens.length === 1 ? 0 : tokens.length === 2 ? 1 : 2]
}

function clampRatio(value: number | null, min: number, max: number): number | null {
  if (value === null) return null
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 从主题 CSS 里读出正文排版节奏（行高 / 字间距 / 段间距）。
 *
 * 读的是**浅色段**：深色段只覆盖颜色，版式一律写在浅色段里。读不出来的项退回
 * `DEFAULT_THEME_RHYTHM`（也就是设置面板的滑块默认值），所以任何一份主题 ——
 * 包括从网上下载、我们完全不认识的那些 —— 都有一个合理的节奏。
 */
export function readThemeRhythm(css: string): ThemeRhythm {
  const sources = collectRhythmSources(splitDarkSection(css).light)
  const fontSize =
    readFontSize(pickRhythmValue(sources, 'font-size')) ??
    readFontSize(sources.root['font-size']) ??
    BASE_BODY_FONT_SIZE

  const lineHeight = clampRatio(readRatio(pickRhythmValue(sources, 'line-height'), fontSize), 1, 3)
  const letterSpacing = clampRatio(readRatio(pickRhythmValue(sources, 'letter-spacing'), fontSize), 0, 0.5)
  // 段距要**先按来源各自算出下边距**再比优先级：装饰类里的 `margin` 简写同样能压过
  // 裸标签的 `margin-bottom`（两者最终都在比同一个属性），先挑属性再挑来源会挑错。
  const paragraphSpacing = clampRatio(
    (['klass', 'tag', 'root'] as const)
      .map((kind) =>
        readRatio(
          sources[kind]['margin-bottom'] ?? readBottomFromShorthand(sources[kind]['margin']),
          fontSize,
        ),
      )
      .find((value) => value !== null) ?? null,
    0,
    3,
  )

  return {
    lineHeight: round2(lineHeight ?? DEFAULT_THEME_RHYTHM.lineHeight),
    letterSpacing: round2(letterSpacing ?? DEFAULT_THEME_RHYTHM.letterSpacing),
    paragraphSpacing: round2(paragraphSpacing ?? DEFAULT_THEME_RHYTHM.paragraphSpacing),
  }
}

/**
 * 导入时给一份没有元数据的 CSS 补上注释头。
 *
 * 不补的话，保存到磁盘后名字以外的信息（描述、色板）下次加载就丢了 —— 文件夹名
 * 只装得下名字。已经有 `@name` 的文件原样保存，尊重作者的写法。
 */
export function withMetadataHeader(source: string, fileName: string): string {
  if (readMeta(source).name) return source
  const name = fileName.replace(/\.css$/iu, '').trim() || '未命名主题'
  const accent = COLOR.exec(source)?.[0] || '#333333'
  return ['/*', `@name ${name}`, `@accent ${accent}`, '*/'].join('\n') + '\n' + source
}

/** 导入时用来算落盘 id：优先用文件里声明的名字，否则用文件名。 */
export function themeIdForImport(source: string, fileName: string): string {
  return themeIdFromName(readMeta(source).name || fileName.replace(/\.css$/iu, ''))
}
