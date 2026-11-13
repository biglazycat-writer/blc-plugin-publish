/**
 * Render a `LayoutPlan` into WeChat-ready HTML.
 *
 * This is the counterpart to the CSS pipeline in `wechat-export.ts`. Instead of
 * styling bare tags and letting juice inline the result, it assembles the
 * article from the components in `components.ts`, which lets a theme change the
 * *shape* of the cover, chapter headers and quotes — not just their colors.
 *
 * The output still goes through `normalizeWechatHtmlFragment` so it is held to
 * the same compliance rules as the CSS path (no classes, div→section, forbidden
 * declarations stripped, text nodes wrapped in `<span leaf>`).
 */

import type { ImageResolver } from '../wechat-export';
import type { WeChatStyleOverrides } from '../../editor-themes';
import { normalizeWechatHtmlFragment } from '../wechat-html-compliance';
import {
  renderBlock,
  renderChapterHeader,
  renderCover,
  renderEndMark,
  renderShell,
  renderSignature,
  renderTagGroup,
} from './components';
import { buildTocEntries } from './infer-plan';
import type { LayoutPlan, PlanBlock, PlanTocEntry } from './layout-plan';
import { mergeLayoutTokens, type LayoutTokens } from './tokens';

export interface RenderPlanOptions {
  /** Maps in-editor image srcs to their exported form (uploaded URL/data URL). */
  resolveImage?: ImageResolver;
  /** Fine-grained typography and spacing controls from the publishing workspace. */
  styleOverrides?: WeChatStyleOverrides;
}

/** Apply the image resolver so previews and drafts can differ per call. */
function resolveBlockImages(block: PlanBlock, resolve?: ImageResolver): PlanBlock {
  if (block.kind !== 'image' || !block.src || !resolve) return block;
  return { ...block, src: resolve(block.src) };
}

/**
 * 渲染一组块。
 *
 * `tocEntries` 透传给 `renderBlock`：目录条目依赖**全部**章节，所以不可能在块自己
 * 身上带着，只能由 `renderLayoutPlan` 在渲染前算好。
 */
function renderBlocks(
  blocks: PlanBlock[],
  t: LayoutTokens,
  options: RenderPlanOptions,
  tocEntries: PlanTocEntry[],
): string {
  return blocks
    .map((block) => renderBlock(resolveBlockImages(block, options.resolveImage), t, tocEntries))
    .filter(Boolean)
    .join('\n');
}

function applyStyleOverrides(tokens: LayoutTokens, overrides?: WeChatStyleOverrides): LayoutTokens {
  if (!overrides) return tokens;
  const bodySize = overrides.fontSize ?? tokens.typography.bodySize;
  const headingScale = overrides.headingScale ?? 1;
  const paragraphSpacing = overrides.paragraphSpacing;
  return mergeLayoutTokens(tokens, {
    typography: {
      bodySize,
      bodyLineHeight: overrides.lineHeight ?? tokens.typography.bodyLineHeight,
      letterSpacing: overrides.letterSpacing ?? tokens.typography.letterSpacing,
      coverTitleSize: Math.round(tokens.typography.coverTitleSize * headingScale),
      chapterTitleSize: Math.round(tokens.typography.chapterTitleSize * headingScale),
      subHeadingSize: Math.round(tokens.typography.subHeadingSize * headingScale),
    },
    shape: {
      // The CSS pipeline's default content padding is 2px. Treat the layout
      // control as an adjustment from that baseline so opening this workspace
      // does not collapse a layout theme's authored page padding.
      pagePadding: overrides.contentPadding === undefined
        ? tokens.shape.pagePadding
        : Math.max(0, tokens.shape.pagePadding + overrides.contentPadding - 2),
      paragraphGap: paragraphSpacing === undefined
        ? tokens.shape.paragraphGap
        : Math.round(tokens.shape.paragraphGap * (paragraphSpacing / 0.6)),
    },
  });
}

/** Horizontal page padding wrapper shared by body sections. */
function pad(inner: string, t: LayoutTokens, extraStyle = ''): string {
  if (!inner) return '';
  return `<section style="padding:0 ${t.shape.pagePadding}px;${extraStyle}">${inner}</section>`;
}

/**
 * Build the article HTML. Returns a WeChat-compliant fragment; pass the result
 * straight to the preview iframe, clipboard, or publish draft.
 */
export function renderLayoutPlan(
  plan: LayoutPlan,
  tokens: LayoutTokens,
  options: RenderPlanOptions = {},
): string {
  const effectiveTokens = applyStyleOverrides(tokens, options.styleOverrides);
  const parts: string[] = [];

  // 目录条目要等所有章节扫完才算得出来，所以在渲染前一次性算好，交给正文里
  // `kind: 'toc'` 那个块（作者写的 `[TOC]`）在原位使用。没有那个块就算了个寂寞，
  // 但这是一次 O(章节数) 的映射，不值得为它加惰性求值。
  const tocEntries = buildTocEntries(plan.chapters);

  if (plan.cover) parts.push(renderCover(plan.cover, effectiveTokens));

  const lead = renderBlocks(plan.lead, effectiveTokens, options, tocEntries);
  if (lead) parts.push(pad(lead, effectiveTokens));

  plan.chapters.forEach((chapter, i) => {
    const header = renderChapterHeader(chapter, effectiveTokens);
    const body = renderBlocks(chapter.blocks, effectiveTokens, options, tocEntries);
    if (!header && !body) return;
    // The first chapter sits closer to the lead; later ones get the full gap.
    const marginTop = i === 0 ? 16 : effectiveTokens.shape.chapterGap;
    parts.push(
      `<section style="margin-top:${marginTop}px;margin-bottom:32px;padding:0 ${effectiveTokens.shape.pagePadding}px;">${header}\n${body}</section>`,
    );
  });

  const endMark = renderEndMark(effectiveTokens);
  if (endMark) parts.push(pad(endMark, effectiveTokens));

  const tags = renderTagGroup(plan.tags, effectiveTokens);
  if (tags) parts.push(pad(tags, effectiveTokens));

  const signature = plan.signature ? renderSignature(plan.signature, effectiveTokens) : '';
  if (signature) parts.push(pad(signature, effectiveTokens));

  const shell = renderShell(parts.filter(Boolean).join('\n'), effectiveTokens);
  return normalizeWechatHtmlFragment(shell);
}
