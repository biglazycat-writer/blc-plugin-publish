/**
 * Full layout themes for the component renderer.
 *
 * Unlike the plain CSS themes in `lib/editor-themes` — which can only restyle
 * bare tags and therefore differ mostly in heading color — each theme here
 * selects a different *shape* for the cover, chapter header, pull quote and TOC
 * on top of its palette and type scale. They are surfaced to the user as ordinary
 * themes (see `lib/editor-themes/layout-themes.ts`); the shape tokens ride along
 * as the theme's `layout` field.
 *
 * Themes are authored as small diffs against `BASE_LAYOUT_TOKENS` so a new token
 * field gets a sensible value everywhere without editing every theme.
 *
 * Curation rule: two themes may not share the same (cover, chapterHeader,
 * quote, toc) combination. A theme that only swaps a palette was removed.
 */

import {
  BASE_LAYOUT_TOKENS,
  mergeLayoutTokens,
  SERIF_STACK,
  type LayoutTokens,
} from './tokens';

export interface WeChatLayoutTheme {
  id: string;
  name: string;
  description: string;
  tags: string[];
  tokens: LayoutTokens;
  preview: { accent: string; bg: string; accentSecondary?: string };
}

/** 国风节日 — the merged Chinese long-form theme: warm paper, serif, restrained print. */
const chineseTraditional: WeChatLayoutTheme = {
  id: 'chineseTraditional',
  name: '国风节日',
  description: '宣纸暖底、朱印章节号与宋体长文：沿用默认排版的克制节奏，留一点国风的气韵，安静耐读',
  tags: ['完整版式', '国风', '宣纸', '宋体', '长文'],
  preview: { accent: '#B22222', bg: '#FBF7EE', accentSecondary: '#C9A96E' },
  tokens: mergeLayoutTokens(BASE_LAYOUT_TOKENS, {
    palette: {
      accent: '#B22222',
      accentAlt: '#C9A96E',
      accentSoft: '#EBDCC8',
      accentWash: '#F7F1E6',
      ink: '#241F1A',
      body: '#2E2A24',
      muted: '#8A7560',
      border: '#E7DCC8',
      bg: '#FBF7EE',
      cardBg: '#FFFDF8',
    },
    typography: {
      bodySize: 17,
      bodyLineHeight: 1.9,
      letterSpacing: 0.34,
      coverTitleSize: 30,
      chapterTitleSize: 23,
      subHeadingSize: 21,
      fontFamily: SERIF_STACK,
      bodyAlign: 'left',
    },
    shape: {
      radius: 4,
      pagePadding: 22,
      chapterGap: 44,
      paragraphGap: 15,
      cardShadow: '',
    },
    components: {
      cover: 'poster',
      chapterHeader: 'centeredRule',
      quote: 'centered',
      toc: 'numberedList',
      coverKicker: '随笔 · ESSAY',
      chapterKicker: '第',
      endMark: '完',
      underlineKeyPhrases: false,
    },
  }),
};

export const WECHAT_LAYOUT_THEMES: Record<string, WeChatLayoutTheme> = {
  [chineseTraditional.id]: chineseTraditional,
};

export const DEFAULT_LAYOUT_THEME_ID = chineseTraditional.id;

/** True when the id addresses a component-renderer theme. */
export function isLayoutThemeId(id: string | undefined): boolean {
  return Boolean(id && Object.prototype.hasOwnProperty.call(WECHAT_LAYOUT_THEMES, id));
}

export function getLayoutTheme(id: string | undefined): WeChatLayoutTheme | undefined {
  if (!id) return undefined;
  return WECHAT_LAYOUT_THEMES[id];
}

export function getLayoutThemeList(): WeChatLayoutTheme[] {
  return Object.values(WECHAT_LAYOUT_THEMES);
}
