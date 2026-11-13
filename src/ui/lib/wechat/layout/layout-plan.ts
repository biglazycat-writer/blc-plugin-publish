/**
 * LayoutPlan — the structural description a WeChat article is rendered from.
 *
 * This type is the contract between three producers and one consumer:
 *   - `infer-plan.ts` derives a plan from the ProseMirror document (always runs)
 *   - the `publishing.wechat_layout_plan` Workflow returns *annotations* that
 *     refine that plan (optional)
 *   - the publish modal may carry small user edits
 *   → `render-plan.ts` turns the plan plus `LayoutTokens` into HTML
 *
 * Only plain data lives here: no HTML, no CSS, no colors. That separation is
 * what makes AI-assisted layout stable — the model picks structure and never
 * emits markup, so it cannot produce styles WeChat rejects.
 */

/** An inline run inside a paragraph. */
export interface InlineSpan {
  text: string;
  /** Rendered as a colored bold run. */
  strong?: boolean;
  italic?: boolean;
  /** A key phrase: underlined (or tinted) to guide skim-reading. */
  key?: boolean;
  code?: boolean;
  /** Present for links. */
  href?: string;
}

export type BlockKind =
  | 'paragraph'
  | 'subHeading'
  | 'quote'
  | 'callout'
  | 'list'
  | 'image'
  | 'code'
  | 'table'
  | 'divider'
  /** 作者手写的 `[TOC]` 占位符。条目由 `render-plan` 从章节列表现算，这里只带位置。 */
  | 'toc';

/** One rendered block inside a chapter. */
export interface PlanBlock {
  kind: BlockKind;
  /** Inline content for text-bearing blocks. */
  spans?: InlineSpan[];
  /** List items, each a span run. */
  items?: InlineSpan[][];
  ordered?: boolean;
  /** Secondary line, used by `callout` and `quote` cards. */
  subText?: string;
  /** Image source and caption. */
  src?: string;
  alt?: string;
  /** Fenced code payload (already highlighted HTML is *not* allowed here). */
  code?: string;
  language?: string;
  /** Table rows; first row is treated as the header. */
  rows?: string[][];
}

export interface PlanChapter {
  /** Display number, e.g. "01" or "///" for the closing chapter. */
  number: string;
  title: string;
  /** Latin or short descriptive kicker under the title. Optional. */
  subtitle?: string;
  blocks: PlanBlock[];
}

export interface PlanCover {
  /** Struck-through misconception line (breaking style). Optional. */
  strikeLine?: string;
  /** Main headline; may be split across two lines for emphasis. */
  title: string;
  /** Second headline line, rendered in the accent color. */
  titleAccent?: string;
  /** One-line summary or keyword trail under the rule. */
  subtitle?: string;
  /** Small kicker chips shown in the cover footer. */
  tags?: string[];
  /** Emoji or single glyph shown in the cover thumbnail. */
  glyph?: string;
  /** Series label in the cover footer bar. */
  series?: string;
}

export interface PlanTocEntry {
  label: string;
  title: string;
  hint?: string;
}

export interface PlanSignature {
  /** e.g. "我是 XX，热衷于分享 AI 观察". */
  intro?: string;
  /** Call to action line. */
  cta?: string;
}

export interface LayoutPlan {
  cover?: PlanCover;
  /** Lead paragraphs shown between the cover and the first chapter. */
  lead: PlanBlock[];
  chapters: PlanChapter[];
  /** Hashtags rendered as pills at the end of the article. */
  tags: string[];
  signature?: PlanSignature;
}

export function emptyPlan(): LayoutPlan {
  return { lead: [], chapters: [], tags: [] };
}

/** Count of renderable pieces, for the "封面 / N 章 / M 金句" summary chips. */
export function planSummary(plan: LayoutPlan): {
  chapters: number;
  quotes: number;
  callouts: number;
  hasCover: boolean;
  hasToc: boolean;
} {
  let quotes = 0;
  let callouts = 0;
  let hasToc = false;
  for (const blocks of [plan.lead, ...plan.chapters.map((c) => c.blocks)]) {
    for (const block of blocks) {
      if (block.kind === 'quote') quotes += 1;
      if (block.kind === 'callout') callouts += 1;
      if (block.kind === 'toc') hasToc = true;
    }
  }
  return {
    chapters: plan.chapters.length,
    quotes,
    callouts,
    hasCover: Boolean(plan.cover),
    hasToc,
  };
}
