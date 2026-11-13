/**
 * Component-based WeChat layout pipeline.
 *
 * ```
 * PM doc ──► inferPlan ──► LayoutPlan ──► renderLayoutPlan ──► HTML
 * ```
 *
 * `buildLayoutHtml` is the single call the publish flow needs: it infers a plan
 * and renders it with the selected layout theme.
 */

export { inferPlan, type InferOptions } from './infer-plan';
export {
  emptyPlan,
  planSummary,
  type InlineSpan,
  type LayoutPlan,
  type PlanBlock,
  type PlanChapter,
  type PlanCover,
  type PlanSignature,
  type PlanTocEntry,
} from './layout-plan';
export {
  DEFAULT_LAYOUT_THEME_ID,
  getLayoutTheme,
  getLayoutThemeList,
  isLayoutThemeId,
  WECHAT_LAYOUT_THEMES,
  type WeChatLayoutTheme,
} from './layout-themes';
export { renderLayoutPlan, type RenderPlanOptions } from './render-plan';
export {
  BASE_LAYOUT_TOKENS,
  mergeLayoutTokens,
  SANS_STACK,
  SERIF_STACK,
  type ChapterHeaderStyle,
  type CoverStyle,
  type LayoutTokens,
  type QuoteStyle,
  type TocStyle,
} from './tokens';

import type { ImageResolver } from '../wechat-export';
import type { WeChatStyleOverrides } from '../../editor-themes';
import { inferPlan } from './infer-plan';
import type { LayoutPlan } from './layout-plan';
import { getLayoutTheme } from './layout-themes';
import { renderLayoutPlan } from './render-plan';
import type { MermaidPng } from '../../mermaid-render';

export interface BuildLayoutOptions {
  /** Layout theme id, e.g. `layout.moyuMagazine`. */
  themeId?: string;
  /** Fallback cover title when the document has no H1. */
  title?: string;
  /** Maps in-editor image srcs to their exported form. */
  resolveImage?: ImageResolver;
  /** Fine-grained typography and spacing controls from the publishing workspace. */
  styleOverrides?: WeChatStyleOverrides;
  /** 预先位图化的 mermaid 图表，按源码索引；没有的图表按代码块排版。 */
  mermaidPngs?: Map<string, MermaidPng>;
}

export interface BuildLayoutResult {
  html: string;
  /** The plan actually rendered, for summary chips and debugging. */
  plan: LayoutPlan;
}

/**
 * Infer → render. Returns empty HTML for an empty document rather than throwing,
 * so callers can bind this straight into a preview.
 */
export function buildLayoutHtml(
  doc: Record<string, unknown> | null | undefined,
  options: BuildLayoutOptions = {},
): BuildLayoutResult {
  const theme = getLayoutTheme(options.themeId);
  const plan = inferPlan(doc, { title: options.title, mermaidPngs: options.mermaidPngs });
  if (!theme) return { html: '', plan };
  const html = renderLayoutPlan(plan, theme.tokens, { resolveImage: options.resolveImage, styleOverrides: options.styleOverrides });
  return { html, plan };
}
