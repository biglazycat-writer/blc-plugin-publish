/**
 * Derive a `LayoutPlan` from a ProseMirror document — deterministically.
 *
 * This runs on every export and is the sole source of the plan when no AI
 * annotation is applied, so the component renderer always has real structure to
 * work with. The AI Workflow only *refines* what is inferred here; if it is never
 * run, or returns nothing usable, output quality degrades to "inferred layout"
 * rather than breaking.
 *
 * Heuristics, in order of application:
 *   - H1 → cover (with the following paragraph as its subtitle when short)
 *   - H2 → chapter boundary; text before the first H2 becomes the lead
 *   - H3, or a paragraph opening with an emoji + short text, → sub-heading
 *   - blockquote → pull quote
 *   - a paragraph that is exactly `[TOC]` → table of contents, rendered in place
 *   - a trailing paragraph made only of #hashtags → article tags
 *   - `strong` marks → key phrases
 */

import type {
  InlineSpan,
  LayoutPlan,
  PlanBlock,
  PlanChapter,
  PlanCover,
  PlanTocEntry,
} from './layout-plan';
import { emptyPlan } from './layout-plan';
import { isMermaidLanguage, mermaidImageSrc } from '../../mermaid-inline';
import type { MermaidPng } from '../../mermaid-render';

type PMNode = Record<string, unknown>;
type PMMark = Record<string, unknown>;

function nodes(node: PMNode | undefined): PMNode[] {
  const content = node?.content;
  return Array.isArray(content) ? (content as PMNode[]) : [];
}

function attrs(node: PMNode): Record<string, unknown> {
  const value = node.attrs;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function textOf(node: PMNode): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  // 块首的全角空格缩进（编辑器「首行缩进」/排版预设插入的）在公众号排版里没有
  // 意义，还会干扰「整行形状」类识别（emoji 小节、话题标签行）。分析与渲染都按
  // 剥掉缩进之后的文本走；递归调用剥的是同一处块首，内层再剥是幂等的。
  return nodes(node).map(textOf).join('').replace(/^[\s　]+/u, '');
}

/** Convert a text-bearing node's children into inline spans. */
function spansOf(node: PMNode): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const child of nodes(node)) {
    if (child.type === 'hardBreak') {
      const last = out[out.length - 1];
      if (last) last.text += ' ';
      continue;
    }
    if (child.type !== 'text') {
      const nested = textOf(child);
      if (nested) out.push({ text: nested });
      continue;
    }
    const text = typeof child.text === 'string' ? child.text : '';
    if (!text) continue;
    const marks = Array.isArray(child.marks) ? (child.marks as PMMark[]) : [];
    const span: InlineSpan = { text };
    for (const mark of marks) {
      switch (mark.type) {
        case 'bold':
          // A bold run is the author's own emphasis: treat it as a key phrase so
          // the theme's underline treatment applies.
          span.key = true;
          break;
        case 'italic':
          span.italic = true;
          break;
        case 'code':
          span.code = true;
          break;
        case 'highlight':
          span.strong = true;
          break;
        case 'link': {
          const href = attrs(mark).href;
          if (typeof href === 'string' && href) span.href = href;
          break;
        }
        default:
          break;
      }
    }
    out.push(span);
  }
  return mergePlainSpans(out);
}

/** Collapse adjacent unstyled spans so the output HTML stays compact. */
function mergePlainSpans(spans: InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    const plain = (s: InlineSpan) => !s.strong && !s.italic && !s.key && !s.code && !s.href;
    if (prev && plain(prev) && plain(span)) {
      prev.text += span.text;
      continue;
    }
    out.push(span);
  }
  // 渲染与分析对齐：块首缩进同样从 span 里剥掉（见 textOf 上的注释）。
  if (out.length > 0 && out[0]!.text) {
    out[0]!.text = out[0]!.text.replace(/^[\s　]+/u, '');
  }
  return out.filter((s) => s.text.length > 0);
}

// A paragraph like "🌐 多模态：从看图说话到跨模态推理" acts as a sub-heading in
// most WeChat writing, even though the author never used a real H3.
const EMOJI_LEAD = /^[\p{Extended_Pictographic}☀-➿][️‍]?\s*/u;

function looksLikeSubHeading(text: string): boolean {
  if (!EMOJI_LEAD.test(text)) return false;
  const body = text.replace(EMOJI_LEAD, '').trim();
  if (body.length === 0 || body.length > 40) return false;
  // Real headings do not end in sentence punctuation.
  return !/[。！？.!?]$/.test(body);
}

const HASHTAG_LINE = /^(?:#[^\s#]+[\s]*)+$/;

/**
 * 目录占位符：单独一段写着 `[TOC]`（大小写不敏感）。
 *
 * **目录不由我们自动生成** —— 作者写在哪，目录就出现在哪；不写就没有。
 * 语法取自 Typora（本项目主题体系的上游正是 Typora 主题），它也是 docsify、VNote、
 * Markdown Preview Enhanced 用的同一个记号。Markdown 本身**没有**目录语法，
 * 各家都是约定：GitLab / Azure DevOps 用 `[[_TOC_]]`，markdown-toc 用
 * `<!-- toc -->`，kramdown 用 `{:toc}`。
 *
 * 只在组件管线（`themeHasStructure` 命中的主题，如国风节日）里生效 —— 只有那些主题
 * 才有 `components.toc` 这套形状；其余主题走 CSS 管线，这行会原样显示成文字。
 */
const TOC_MARKER = /^\[toc\]$/iu;

function hashtagsOf(text: string): string[] {
  const trimmed = text.trim();
  if (!HASHTAG_LINE.test(trimmed)) return [];
  return trimmed
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('#') && t.length > 1);
}

function blockFromNode(node: PMNode, options: InferOptions = {}): PlanBlock | null {
  const { resolveImage } = options;
  const type = node.type as string;

  switch (type) {
    case 'paragraph': {
      const text = textOf(node).trim();
      if (!text) return null;
      if (TOC_MARKER.test(text)) return { kind: 'toc' };
      if (looksLikeSubHeading(text)) return { kind: 'subHeading', spans: spansOf(node) };
      return { kind: 'paragraph', spans: spansOf(node) };
    }
    case 'heading': {
      const text = textOf(node).trim();
      if (!text) return null;
      return { kind: 'subHeading', spans: spansOf(node) };
    }
    case 'blockquote': {
      const paras = nodes(node).filter((n) => textOf(n).trim());
      if (paras.length === 0) return null;
      const [first, ...rest] = paras;
      const block: PlanBlock = { kind: 'quote', spans: spansOf(first) };
      const sub = rest.map(textOf).join(' ').trim();
      if (sub) block.subText = sub;
      return block;
    }
    case 'bulletList':
    case 'orderedList': {
      const items: InlineSpan[][] = [];
      for (const item of nodes(node)) {
        const spans: InlineSpan[] = [];
        for (const child of nodes(item)) {
          spans.push(...spansOf(child));
        }
        const merged = mergePlainSpans(spans);
        if (merged.length) items.push(merged);
      }
      if (items.length === 0) return null;
      return { kind: 'list', items, ordered: type === 'orderedList' };
    }
    case 'image': {
      const raw = attrs(node).src;
      if (typeof raw !== 'string' || !raw) return null;
      const src = resolveImage ? resolveImage(raw) : raw;
      const alt = attrs(node).alt;
      return { kind: 'image', src, alt: typeof alt === 'string' ? alt : '' };
    }
    case 'codeBlock': {
      const code = textOf(node);
      if (!code.trim()) return null;
      const language = attrs(node).language;
      // 图表位图化后当普通图片排版；没预扫到（渲染失败）就退回代码块。
      if (isMermaidLanguage(language) && options.mermaidPngs?.has(code.trim())) {
        const raw = mermaidImageSrc(code);
        return { kind: 'image', src: resolveImage ? resolveImage(raw) : raw, alt: 'Mermaid 图表' };
      }
      return { kind: 'code', code, language: typeof language === 'string' ? language : undefined };
    }
    case 'table': {
      const rows: string[][] = [];
      for (const row of nodes(node)) {
        const cells = nodes(row).map((cell) => textOf(cell).trim());
        if (cells.length) rows.push(cells);
      }
      if (rows.length === 0) return null;
      return { kind: 'table', rows };
    }
    case 'horizontalRule':
      return { kind: 'divider' };
    default: {
      const text = textOf(node).trim();
      if (!text) return null;
      return { kind: 'paragraph', spans: [{ text }] };
    }
  }
}

/** Two-digit chapter numbers read better than bare integers in the components. */
function chapterNumber(i: number): string {
  return String(i + 1).padStart(2, '0');
}

export interface InferOptions {
  /** Fallback cover title when the document has no H1. */
  title?: string;
  /** Maps an editor image src to its export src (upload/data URL). */
  resolveImage?: (src: string) => string;
  /** 预先位图化的 mermaid 图表，按源码索引；没有的图表按代码块排版。 */
  mermaidPngs?: Map<string, MermaidPng>;
}

export function inferPlan(doc: Record<string, unknown> | null | undefined, options: InferOptions = {}): LayoutPlan {
  const plan = emptyPlan();
  if (!doc) return plan;

  const top = nodes(doc as PMNode);
  let cover: PlanCover | undefined;
  const lead: PlanBlock[] = [];
  const chapters: PlanChapter[] = [];
  const tags: string[] = [];
  const push = (block: PlanBlock) => {
    if (chapters.length === 0) lead.push(block);
    else chapters[chapters.length - 1].blocks.push(block);
  };

  for (const node of top) {
    const type = node.type as string;
    const text = textOf(node).trim();

    // H1 becomes the cover; a second H1 is demoted to a chapter boundary.
    if (type === 'heading' && (attrs(node).level as number) === 1 && !cover && text) {
      cover = { title: text };
      continue;
    }

    // H2 (or a later H1) opens a new chapter.
    const level = type === 'heading' ? (attrs(node).level as number) || 1 : 0;
    if (type === 'heading' && level <= 2 && text) {
      chapters.push({ number: chapterNumber(chapters.length), title: text, blocks: [] });
      continue;
    }

    // A trailing hashtag-only paragraph is article metadata, not body copy.
    if (type === 'paragraph') {
      const found = hashtagsOf(text);
      if (found.length >= 2) {
        tags.push(...found);
        continue;
      }
    }

    // Legacy mediaRow: flatten cell children as sibling blocks.
    if (type === 'mediaRow') {
      for (const cell of nodes(node)) {
        for (const child of nodes(cell)) {
          const cellBlock = blockFromNode(child, options);
          if (cellBlock) push(cellBlock);
        }
      }
      continue;
    }

    const block = blockFromNode(node, options);
    if (!block) continue;
    push(block);
  }

  if (!cover && options.title?.trim()) {
    cover = { title: options.title.trim() };
  }

  // Promote the first short lead paragraph to the cover subtitle: it is almost
  // always a standfirst rather than body copy.
  if (cover && !cover.subtitle && lead.length > 1) {
    const first = lead[0];
    const firstText = (first.spans || []).map((s) => s.text).join('');
    if (first.kind === 'paragraph' && firstText.length <= 60) {
      cover.subtitle = firstText;
      lead.shift();
    }
  }

  plan.cover = cover;
  plan.lead = lead;
  plan.chapters = chapters;
  plan.tags = tags;
  return plan;
}

/**
 * 目录的一行 = 一个章节。**只有作者写了 `[TOC]` 时才会被调用**（`render-plan` 在遇到
 * `kind: 'toc'` 的块时现算），所以这里不设「少于 N 章就不出」「超过 N 章就截断」这类
 * 兜底 —— 以前那两条是为了避免自动塞一份没意义的目录，现在目录是作者明确要的。
 *
 * `label` 里的 `PART` 写死，不跟主题的 `components.chapterKicker` 走：计划是**主题无关**
 * 的，算这一行的时候还不知道最终选中了哪套主题。
 */
export function buildTocEntries(chapters: PlanChapter[]): PlanTocEntry[] {
  return chapters.map((chapter, i) => ({
    label: `PART ${chapterNumber(i)}`,
    title: chapter.title,
    hint: chapter.subtitle,
  }));
}
