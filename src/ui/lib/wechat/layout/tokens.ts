/**
 * Layout tokens for the component-based WeChat renderer.
 *
 * The older export path (`wechat-export.ts` + theme CSS) can only restyle bare
 * tags, which is why those themes end up differing mostly in heading colors.
 * This layer instead describes a *layout*: a palette plus the shape each
 * structural component takes (cover, chapter header, pull quote, TOC).
 *
 * A theme that supplies `LayoutTokens` opts into the component renderer; themes
 * without them keep using the CSS pipeline unchanged.
 */

/** Cover card shape at the top of the article. */
export type CoverStyle =
  /** Struck-through "wrong" line, then the real headline. Magazine/news feel. */
  | 'breaking'
  /** Oversized quotation mark with highlighted key phrases. Profile pieces. */
  | 'quote'
  /** Centered poster block with kicker rule and subtitle. */
  | 'poster'
  /** Full-width saturated gradient band with white centered type. */
  | 'banner'
  /** Pure typography between ink rules — no card, no fill. Masthead feel. */
  | 'plain';

/** Per-chapter header shape. */
export type ChapterHeaderStyle =
  /** Big number, vertical rule, Chinese title + latin subtitle. */
  | 'numberBar'
  /** Solid number badge in a row, kicker above the title, thick underline. */
  | 'badgeRow'
  /** Understated title with a full-width rule beneath it. */
  | 'ruleUnderline'
  /** Full-width solid accent band, number + white title inside. */
  | 'band'
  /** Centered kicker + title over a symmetric dot-leader rule. */
  | 'centeredRule';

/** Pull-quote / highlight shape. */
export type QuoteStyle =
  /** Centered line between hairline rules. */
  | 'centered'
  /** Left accent bar over a tinted card. */
  | 'sideBar'
  /** Dashed card, centered, with an optional sub-line. */
  | 'card'
  /** Oversized quotation glyph floating left of the text, no box. */
  | 'floating';

/** Table-of-contents shape (omitted entirely when `none`). */
export type TocStyle = 'none' | 'scrollCards' | 'numberedList' | 'inlineLine';

export interface LayoutPalette {
  /** Primary accent: numbers, kickers, emphasis. */
  accent: string;
  /** Secondary accent for gradients and badges. */
  accentAlt: string;
  /** Pale accent used for underlines and tinted fills. */
  accentSoft: string;
  /** Very pale accent for card backgrounds. */
  accentWash: string;
  /** Headline / high-contrast text. */
  ink: string;
  /** Body text. */
  body: string;
  /** De-emphasized captions and latin kickers. */
  muted: string;
  /** Hairlines and card borders. */
  border: string;
  /** Page background. */
  bg: string;
  /** Card background (usually pure white over a tinted page). */
  cardBg: string;
}

export interface LayoutTypography {
  /** Body paragraph size in px. WeChat renders 14–16px most reliably. */
  bodySize: number;
  bodyLineHeight: number;
  letterSpacing: number;
  /** Cover headline size in px. */
  coverTitleSize: number;
  /** Chapter title size in px. */
  chapterTitleSize: number;
  /** Sub-heading size in px. */
  subHeadingSize: number;
  /** Font stack; serif families make the scholarly/book layouts read right. */
  fontFamily: string;
  /** `justify` suits dense Chinese prose; `left` suits airy layouts. */
  bodyAlign: 'justify' | 'left';
}

export interface LayoutShape {
  /** Card corner radius in px. 0 gives the hard-edged newspaper look. */
  radius: number;
  /** Horizontal page padding in px. */
  pagePadding: number;
  /** Vertical gap between chapters in px. */
  chapterGap: number;
  /** Paragraph bottom margin in px. */
  paragraphGap: number;
  /** Card shadow; empty string disables it (flat / print styles). */
  cardShadow: string;
}

export interface LayoutComponents {
  cover: CoverStyle;
  chapterHeader: ChapterHeaderStyle;
  quote: QuoteStyle;
  toc: TocStyle;
  /** Latin kicker above the cover title, e.g. "AI INSIGHT · 技术盘点". */
  coverKicker: string;
  /** Latin label paired with chapter numbers, e.g. "PART". */
  chapterKicker: string;
  /** Marker closing the article body, e.g. "END". Empty string omits it. */
  endMark: string;
  /** Underline key phrases marked with `strong` instead of recoloring them. */
  underlineKeyPhrases: boolean;
}

export interface LayoutTokens {
  palette: LayoutPalette;
  typography: LayoutTypography;
  shape: LayoutShape;
  components: LayoutComponents;
}

/** Sans stack that resolves on iOS, Android and WeChat's desktop preview. */
export const SANS_STACK =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

/** Serif stack for book-like layouts; falls back to sans where unavailable. */
export const SERIF_STACK =
  "'Songti SC','Source Han Serif SC','Noto Serif CJK SC','PingFang SC','Microsoft YaHei',serif";

/**
 * Deep-merge a partial token override onto a base. Themes are authored as small
 * diffs against `BASE_LAYOUT_TOKENS`, which keeps them readable and means new
 * token fields get sane values everywhere without touching each theme.
 */
export function mergeLayoutTokens(
  base: LayoutTokens,
  override: DeepPartial<LayoutTokens> = {},
): LayoutTokens {
  return {
    palette: { ...base.palette, ...(override.palette || {}) },
    typography: { ...base.typography, ...(override.typography || {}) },
    shape: { ...base.shape, ...(override.shape || {}) },
    components: { ...base.components, ...(override.components || {}) },
  };
}

export type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

/** Neutral starting point: the moyu-green magazine layout with a gray palette. */
export const BASE_LAYOUT_TOKENS: LayoutTokens = {
  palette: {
    accent: '#059669',
    accentAlt: '#34D399',
    accentSoft: '#A7F3D0',
    accentWash: '#ECFDF5',
    ink: '#111827',
    body: '#374151',
    muted: '#9CA3AF',
    border: '#E5E7EB',
    bg: '#ffffff',
    cardBg: '#ffffff',
  },
  typography: {
    bodySize: 15,
    bodyLineHeight: 1.85,
    letterSpacing: 0.5,
    coverTitleSize: 24,
    chapterTitleSize: 17,
    subHeadingSize: 16,
    fontFamily: SANS_STACK,
    bodyAlign: 'justify',
  },
  shape: {
    radius: 14,
    pagePadding: 20,
    chapterGap: 44,
    paragraphGap: 16,
    cardShadow: '0 4px 20px rgba(0,0,0,0.06)',
  },
  components: {
    cover: 'breaking',
    chapterHeader: 'numberBar',
    quote: 'centered',
    toc: 'none',
    coverKicker: '',
    chapterKicker: 'PART',
    endMark: 'END',
    underlineKeyPhrases: true,
  },
};
