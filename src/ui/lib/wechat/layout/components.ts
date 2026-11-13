/**
 * WeChat layout components.
 *
 * Each function returns a self-contained, fully inline-styled HTML fragment for
 * one structural piece of the article. The markup deliberately mirrors the
 * hand-tuned reference exports (cover cards, numbered chapter headers, scroll
 * TOC, pull quotes, tag pills, signature) rather than inventing new structures,
 * because those are known to survive a paste into the WeChat editor.
 *
 * Conventions that matter for WeChat:
 *   - `<section>` for every box; `<p>` only for text lines.
 *   - Inline styles only. No classes, no <style>, no CSS variables.
 *   - Flex is used exactly the way the references use it (row layouts with
 *     `align-items:center`); grid is avoided because WeChat strips it.
 *   - Decorative empty boxes carry `<br>` so the editor keeps their height.
 */

import type { InlineSpan, PlanBlock, PlanChapter, PlanCover, PlanSignature, PlanTocEntry } from './layout-plan';
import type { LayoutTokens } from './tokens';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Spacer that keeps its height in the WeChat editor. */
const FILL = '<br>';

/** Render inline spans, applying the theme's emphasis treatment. */
export function renderSpans(spans: InlineSpan[] | undefined, t: LayoutTokens): string {
  if (!spans || spans.length === 0) return '';
  const { palette, components } = t;
  return spans
    .map((span) => {
      const text = esc(span.text);
      if (!text) return '';
      if (span.code) {
        return `<code style="color:${palette.accent};background:${palette.accentWash};border:1px solid ${palette.accentSoft};border-radius:4px;padding:1px 5px;font-size:0.92em;">${text}</code>`;
      }
      if (span.href) {
        return `<a href="${esc(span.href)}" style="color:${palette.accent};border-bottom:1px solid ${palette.accentSoft};text-decoration:none;font-weight:600;">${text}</a>`;
      }
      // Key phrases guide skim-reading: a soft underline reads better than a
      // second color, but themes with no soft accent fall back to tinting.
      if (span.key) {
        return components.underlineKeyPhrases
          ? `<span style="border-bottom:2px solid ${palette.accentSoft};font-weight:600;">${text}</span>`
          : `<span style="color:${palette.accent};font-weight:700;">${text}</span>`;
      }
      if (span.strong) {
        return `<strong style="color:${palette.accent};font-weight:800;">${text}</strong>`;
      }
      if (span.italic) {
        return `<em style="font-style:italic;">${text}</em>`;
      }
      return text;
    })
    .join('');
}

function bodyStyle(t: LayoutTokens): string {
  const { typography, shape, palette } = t;
  return `margin:0 0 ${shape.paragraphGap}px;font-size:${typography.bodySize}px;line-height:${typography.bodyLineHeight};letter-spacing:${typography.letterSpacing}px;color:${palette.body};text-align:${typography.bodyAlign};`;
}

export function renderParagraph(block: PlanBlock, t: LayoutTokens): string {
  const inner = renderSpans(block.spans, t);
  if (!inner) return '';
  return `<p style="${bodyStyle(t)}">${inner}</p>`;
}

/** Sub-heading inside a chapter (the "🌐 多模态：…" lines in the reference). */
export function renderSubHeading(block: PlanBlock, t: LayoutTokens): string {
  const inner = renderSpans(block.spans, t);
  if (!inner) return '';
  const { palette, typography } = t;
  return `<p style="margin:28px 0 14px;font-size:${typography.subHeadingSize}px;font-weight:800;color:${palette.ink};line-height:1.5;border-left:4px solid ${palette.accent};padding-left:12px;">${inner}</p>`;
}

export function renderQuote(block: PlanBlock, t: LayoutTokens): string {
  const inner = renderSpans(block.spans, t);
  if (!inner) return '';
  const { palette, typography, shape, components } = t;
  const sub = block.subText
    ? `<p style="margin:8px 0 0;font-size:13px;color:${palette.muted};line-height:1.6;">${esc(block.subText)}</p>`
    : '';

  if (components.quote === 'sideBar') {
    return `<section style="background:${palette.accentWash};border-left:4px solid ${palette.accent};border-radius:0 ${shape.radius}px ${shape.radius}px 0;padding:16px 20px;margin:0 0 24px;"><p style="margin:0;font-size:${typography.bodySize + 1}px;font-weight:800;color:${palette.accent};line-height:1.8;">${inner}</p>${sub}</section>`;
  }
  if (components.quote === 'card') {
    return `<section style="background:${palette.cardBg};border:1px dashed ${palette.accentSoft};border-radius:${Math.max(shape.radius - 6, 4)}px;padding:14px 16px;margin:0 0 24px;text-align:center;"><p style="margin:0;line-height:1.6;"><span style="font-size:${typography.bodySize}px;color:${palette.accent};font-weight:700;">${inner}</span></p>${sub}</section>`;
  }
  if (components.quote === 'floating') {
    return `<section style="display:flex;margin:0 0 24px;padding:4px 0;"><span style="flex-shrink:0;font-size:44px;line-height:1;color:${palette.accentSoft};font-weight:900;font-family:Georgia,serif;">“</span><section style="padding:6px 0 0 10px;"><p style="margin:0;font-size:${typography.bodySize + 1}px;color:${palette.accent};font-weight:700;line-height:1.7;">${inner}</p>${sub}</section></section>`;
  }
  // centered
  return `<p style="margin:0 0 24px;font-size:${typography.bodySize}px;text-align:center;color:${palette.accent};font-weight:700;letter-spacing:1px;border-top:1px solid ${palette.border};border-bottom:1px solid ${palette.border};padding:12px 0;">${inner}</p>${sub}`;
}

/** Emphasis card used for tips and takeaways. */
export function renderCallout(block: PlanBlock, t: LayoutTokens): string {
  const inner = renderSpans(block.spans, t);
  if (!inner) return '';
  const { palette, typography, shape } = t;
  const sub = block.subText
    ? `<p style="margin:8px 0 0;font-size:13px;color:${palette.muted};line-height:1.6;">${esc(block.subText)}</p>`
    : '';
  const shadow = shape.cardShadow ? `box-shadow:${shape.cardShadow};` : '';
  return `<section style="background:${palette.accentWash};border:1px solid ${palette.accentSoft};border-radius:${shape.radius}px;padding:16px 18px;margin:0 0 24px;${shadow}"><p style="margin:0;font-size:${typography.bodySize}px;line-height:1.8;color:${palette.body};font-weight:600;">${inner}</p>${sub}</section>`;
}

export function renderList(block: PlanBlock, t: LayoutTokens): string {
  const items = block.items || [];
  if (items.length === 0) return '';
  const { palette, typography, shape } = t;
  const tag = block.ordered ? 'ol' : 'ul';
  const lis = items
    .map((spans) => {
      const inner = renderSpans(spans, t);
      if (!inner) return '';
      return `<li style="margin:0 0 8px;font-size:${typography.bodySize}px;line-height:${typography.bodyLineHeight};color:${palette.body};">${inner}</li>`;
    })
    .filter(Boolean)
    .join('');
  if (!lis) return '';
  return `<section style="background:${palette.accentWash};border:1px solid ${palette.border};border-radius:${shape.radius}px;padding:14px 16px 14px 34px;margin:0 0 20px;"><${tag} style="margin:0;padding:0;">${lis}</${tag}></section>`;
}

export function renderImage(block: PlanBlock, t: LayoutTokens): string {
  if (!block.src) return '';
  const { palette, shape } = t;
  const caption = block.alt
    ? `<p style="margin:8px 0 0;font-size:12px;color:${palette.muted};text-align:center;">${esc(block.alt)}</p>`
    : '';
  return `<section style="margin:0 0 20px;text-align:center;"><img src="${esc(block.src)}" alt="${esc(block.alt || '')}" style="max-width:100%;border-radius:${Math.max(shape.radius - 6, 4)}px;"/>${caption}</section>`;
}

export function renderCode(block: PlanBlock, t: LayoutTokens): string {
  if (!block.code) return '';
  const { shape } = t;
  // WeChat drops `white-space:pre`, so newlines and runs of spaces are converted
  // to markup the editor preserves.
  const body = esc(block.code).replace(/\n/g, '<br/>').replace(/ /g, '&nbsp;');
  return `<section style="background:#1E293B;border-radius:${Math.max(shape.radius - 4, 6)}px;padding:16px 18px;margin:0 0 20px;overflow-x:auto;"><p style="margin:0 0 8px;color:#64748B;font-size:11px;letter-spacing:5px;">● ● ●</p><p style="margin:0;color:#E2E8F0;font-size:13px;line-height:1.7;font-family:Menlo,Monaco,'Courier New',monospace;">${body}</p></section>`;
}

export function renderTable(block: PlanBlock, t: LayoutTokens): string {
  const rows = block.rows || [];
  if (rows.length === 0) return '';
  const { palette, shape } = t;
  const [head, ...body] = rows;
  const th = head
    .map(
      (cell) =>
        `<th style="border:1px solid ${palette.accentSoft};background:${palette.accent};color:#ffffff;padding:8px 10px;font-size:13px;text-align:left;">${esc(cell)}</th>`,
    )
    .join('');
  const trs = body
    .map((row, i) => {
      const tds = row
        .map(
          (cell) =>
            `<td style="border:1px solid ${palette.accentSoft};padding:8px 10px;font-size:13px;color:${palette.body};background:${i % 2 === 1 ? palette.accentWash : palette.cardBg};">${esc(cell)}</td>`,
        )
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<section style="margin:0 0 20px;border-radius:${shape.radius}px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><tr>${th}</tr>${trs}</table></section>`;
}

export function renderDivider(t: LayoutTokens): string {
  const { palette } = t;
  return `<section style="margin:0 0 24px;"><section style="height:1px;background:linear-gradient(to right,transparent,${palette.accentSoft},${palette.accent},${palette.accentSoft},transparent);">${FILL}</section></section>`;
}

/** Dispatch one block to its component. */
/**
 * 渲染一个块。
 *
 * `tocEntries` 只在块是 `kind: 'toc'` 时用得上 —— 目录条目要等所有章节扫完才算得出来，
 * 所以由调用方（`render-plan`）算好传进来，而不是挂在块自己身上。
 */
export function renderBlock(block: PlanBlock, t: LayoutTokens, tocEntries: PlanTocEntry[] = []): string {
  switch (block.kind) {
    case 'subHeading':
      return renderSubHeading(block, t);
    case 'quote':
      return renderQuote(block, t);
    case 'callout':
      return renderCallout(block, t);
    case 'list':
      return renderList(block, t);
    case 'image':
      return renderImage(block, t);
    case 'code':
      return renderCode(block, t);
    case 'table':
      return renderTable(block, t);
    case 'divider':
      return renderDivider(t);
    case 'toc':
      return renderToc(tocEntries, t);
    case 'paragraph':
    default:
      return renderParagraph(block, t);
  }
}

// ──── Cover ─────────────────────────────────────────────────────

export function renderCover(cover: PlanCover, t: LayoutTokens): string {
  const { palette, typography, shape, components } = t;
  switch (components.cover) {
    case 'quote':
      return coverQuote(cover, t);
    case 'poster':
      return coverPoster(cover, t);
    case 'banner':
      return coverBanner(cover, t);
    case 'plain':
      return coverPlain(cover, t);
    case 'breaking':
    default:
      return coverBreaking(cover, t, palette, typography, shape);
  }
}

function coverBreaking(
  cover: PlanCover,
  t: LayoutTokens,
  palette: LayoutTokens['palette'],
  typography: LayoutTokens['typography'],
  shape: LayoutTokens['shape'],
): string {
  const kicker = t.components.coverKicker;
  const shadow = shape.cardShadow ? `box-shadow:${shape.cardShadow};` : '';

  const kickerRow = kicker
    ? `<section style="display:flex;align-items:center;gap:8px;margin-bottom:28px;">
        <span style="width:6px;height:6px;background:${palette.accent};border-radius:50%;">${FILL}</span>
        <span style="font-size:11px;font-weight:700;letter-spacing:3px;color:${palette.accent};">${esc(kicker)}</span>
        <section style="flex:1;height:1px;overflow:hidden;background:linear-gradient(to right,${palette.accentSoft},transparent);">${FILL}</section>
      </section>`
    : '';

  const strike = cover.strikeLine
    ? `<p style="font-size:15px;color:${palette.muted};margin:0 0 6px;text-decoration:line-through;letter-spacing:0.5px;">${esc(cover.strikeLine)}</p>`
    : '';
  const accentLine = cover.titleAccent
    ? `<p style="font-size:${typography.coverTitleSize}px;font-weight:900;color:${palette.accent};margin:0 0 16px;line-height:1.15;letter-spacing:-1px;">${esc(cover.titleAccent)}</p>`
    : '';
  const subtitle = cover.subtitle
    ? `<p style="font-size:13px;color:${palette.muted};margin:0;line-height:1.7;letter-spacing:0.5px;">${esc(cover.subtitle)}</p>`
    : '';
  const glyph = cover.glyph
    ? `<section style="flex-shrink:0;width:110px;height:110px;border-radius:${shape.radius}px;overflow:hidden;border:1px solid ${palette.accentSoft};background:${palette.accentWash};text-align:center;"><p style="font-size:32px;margin:34px 0 0;">${esc(cover.glyph)}</p></section>`
    : '';

  const chips = (cover.tags || [])
    .map(
      (tag) =>
        `<span style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:3px;font-size:9px;color:#fff;font-weight:600;">${esc(tag)}</span>`,
    )
    .join('');
  const footer =
    cover.series || chips
      ? `<section style="background:linear-gradient(135deg,${palette.accent},${palette.accentAlt});padding:12px 28px;display:flex;align-items:center;justify-content:space-between;">
          <p style="font-size:12px;color:rgba(255,255,255,0.92);margin:0;font-weight:600;letter-spacing:0.5px;">${esc(cover.series || '')}</p>
          <section style="display:flex;gap:4px;">${chips}</section>
        </section>`
      : '';

  return `<section style="margin:0 0 32px;background:${palette.cardBg};border:1.5px solid ${palette.accentSoft};border-radius:${shape.radius + 6}px;overflow:hidden;${shadow}width:100%;">
    <section style="padding:32px 28px 28px;">
      ${kickerRow}
      <section style="display:flex;align-items:center;gap:20px;">
        <section style="flex:1;min-width:0;">
          ${strike}
          <p style="font-size:${typography.coverTitleSize}px;font-weight:900;color:${palette.ink};margin:0;line-height:1.15;letter-spacing:-1px;">${esc(cover.title)}</p>
          ${accentLine}
          <section style="width:48px;height:3px;background:linear-gradient(to right,${palette.accent},${palette.accentAlt});border-radius:2px;margin-bottom:12px;">${FILL}</section>
          ${subtitle}
        </section>
        ${glyph}
      </section>
    </section>
    ${footer}
  </section>`;
}

function coverQuote(cover: PlanCover, t: LayoutTokens): string {
  const { palette, typography, shape } = t;
  const shadow = shape.cardShadow ? `box-shadow:${shape.cardShadow};` : '';
  const subtitle = cover.subtitle
    ? `<p style="font-size:13px;color:${palette.muted};margin:12px 0 0;line-height:1.7;">${esc(cover.subtitle)}</p>`
    : '';
  const accent = cover.titleAccent
    ? `<span style="background:${palette.accent};color:#FFFFFF;padding:2px 8px;border-radius:4px;">${esc(cover.titleAccent)}</span>`
    : '';
  return `<section style="margin:0 0 32px;background:${palette.cardBg};border-radius:${shape.radius}px;${shadow}padding:28px 24px 22px;overflow:hidden;">
    <p style="font-size:42px;color:${palette.accent};font-weight:900;margin:0;line-height:0.6;">“</p>
    <p style="font-size:${Math.max(typography.coverTitleSize - 6, 16)}px;font-weight:800;color:${palette.ink};margin:12px 0 8px;line-height:1.75;padding-left:4px;">${esc(cover.title)}${accent ? ' ' + accent : ''}</p>
    ${subtitle}
  </section>`;
}

function coverPoster(cover: PlanCover, t: LayoutTokens): string {
  const { palette, typography, shape } = t;
  const kicker = t.components.coverKicker;
  const kickerLine = kicker
    ? `<p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:4px;color:${palette.accent};text-align:center;">${esc(kicker)}</p>`
    : '';
  const accentLine = cover.titleAccent
    ? `<p style="font-size:${typography.coverTitleSize}px;font-weight:900;color:${palette.accent};margin:4px 0 0;line-height:1.2;text-align:center;">${esc(cover.titleAccent)}</p>`
    : '';
  const subtitle = cover.subtitle
    ? `<p style="font-size:13px;color:${palette.muted};margin:16px 0 0;line-height:1.7;text-align:center;">${esc(cover.subtitle)}</p>`
    : '';
  return `<section style="margin:0 0 32px;padding:32px 24px;background:${palette.cardBg};border-top:4px solid ${palette.accent};border-bottom:1px solid ${palette.border};border-radius:${shape.radius > 0 ? shape.radius : 0}px;">
    ${kickerLine}
    <p style="font-size:${typography.coverTitleSize}px;font-weight:900;color:${palette.ink};margin:0;line-height:1.2;letter-spacing:1px;text-align:center;">${esc(cover.title)}</p>
    ${accentLine}
    <section style="width:56px;height:3px;background:${palette.accent};margin:16px auto 0;border-radius:2px;">${FILL}</section>
    ${subtitle}
  </section>`;
}

/** Full-width saturated band with white centered type — poster-like, no card. */
function coverBanner(cover: PlanCover, t: LayoutTokens): string {
  const { palette, typography } = t;
  const kicker = t.components.coverKicker;
  const kickerLine = kicker
    ? `<p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:5px;color:rgba(255,255,255,0.75);text-align:center;">${esc(kicker)}</p>`
    : '';
  const accentLine = cover.titleAccent
    ? `<p style="margin:10px 0 0;font-size:15px;color:rgba(255,255,255,0.85);text-align:center;letter-spacing:1px;">${esc(cover.titleAccent)}</p>`
    : '';
  const subtitle = cover.subtitle
    ? `<p style="margin:18px 0 0;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.8;text-align:center;">${esc(cover.subtitle)}</p>`
    : '';
  return `<section style="margin:0 0 32px;background:linear-gradient(135deg,${palette.accent},${palette.accentAlt});border-radius:16px;padding:44px 26px;text-align:center;">
    ${kickerLine}
    <p style="font-size:${typography.coverTitleSize + 2}px;font-weight:900;color:#ffffff;margin:0;line-height:1.3;letter-spacing:2px;">${esc(cover.title)}</p>
    ${accentLine}${subtitle}
  </section>`;
}

/** Pure typography between ink rules — masthead feel, no fills or cards. */
function coverPlain(cover: PlanCover, t: LayoutTokens): string {
  const { palette, typography } = t;
  const kicker = t.components.coverKicker;
  const kickerLine = kicker
    ? `<p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:4px;color:${palette.accent};text-align:center;">${esc(kicker)}</p>`
    : '';
  const accentLine = cover.titleAccent
    ? `<p style="margin:8px 0 0;font-size:${Math.round(typography.coverTitleSize * 0.6)}px;font-weight:700;color:${palette.accent};text-align:center;letter-spacing:3px;">— ${esc(cover.titleAccent)} —</p>`
    : '';
  const subtitle = cover.subtitle
    ? `<p style="margin:14px 0 0;font-size:13px;color:${palette.muted};line-height:1.9;text-align:center;">${esc(cover.subtitle)}</p>`
    : '';
  return `<section style="margin:0 0 32px;padding:30px 12px 26px;border-top:3px solid ${palette.ink};border-bottom:1px solid ${palette.border};text-align:center;">
    ${kickerLine}
    <p style="font-size:${typography.coverTitleSize + 3}px;font-weight:900;color:${palette.ink};margin:0;line-height:1.35;letter-spacing:5px;">${esc(cover.title)}</p>
    ${accentLine}${subtitle}
  </section>`;
}

// ──── Table of contents ─────────────────────────────────────────

export function renderToc(entries: PlanTocEntry[], t: LayoutTokens): string {
  const { components } = t;
  if (components.toc === 'none' || entries.length === 0) return '';
  if (components.toc === 'numberedList') return tocNumbered(entries, t);
  if (components.toc === 'inlineLine') return tocInline(entries, t);
  return tocScroll(entries, t);
}

/** Single centered line of dot-separated titles — the lightest possible TOC. */
function tocInline(entries: PlanTocEntry[], t: LayoutTokens): string {
  const { palette } = t;
  const items = entries
    .map((entry) => `<span style="font-size:13px;font-weight:700;color:${palette.body};">${esc(entry.title)}</span>`)
    .join('<span style="color:${palette.accentSoft};margin:0 8px;">·</span>'.replace('${palette.accentSoft}', palette.accentSoft));
  return `<p style="margin:0 0 28px;padding:10px 12px;text-align:center;background:${palette.accentWash};border-radius:999px;line-height:1.9;">${items}</p>`;
}

function tocScroll(entries: PlanTocEntry[], t: LayoutTokens): string {
  const { palette, shape } = t;
  const cards = entries
    .map((entry, i) => {
      const active = i === 0;
      const bg = active
        ? `background:linear-gradient(135deg,${palette.accent},${palette.accentAlt});`
        : `background:${palette.cardBg};border:1px solid ${palette.border};`;
      const labelColor = active ? 'rgba(255,255,255,0.72)' : palette.muted;
      const titleColor = active ? '#ffffff' : palette.ink;
      const hintColor = active ? 'rgba(255,255,255,0.72)' : palette.muted;
      const hint = entry.hint
        ? `<p style="font-size:10px;color:${hintColor};margin:0;">${esc(entry.hint)}</p>`
        : '';
      return `<section style="display:inline-block;white-space:normal;vertical-align:top;width:110px;${bg}border-radius:12px;padding:12px;margin-right:8px;">
        <p style="font-size:9px;font-weight:700;color:${labelColor};letter-spacing:1px;margin:0 0 5px;">${esc(entry.label)}</p>
        <p style="font-size:13px;font-weight:800;color:${titleColor};margin:0 0 3px;">${esc(entry.title)}</p>
        ${hint}
      </section>`;
    })
    .join('');
  return `<section style="margin:0 0 32px;">
    <section style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <p style="font-size:10px;color:${palette.muted};margin:0;letter-spacing:2px;font-weight:600;">📦 全文导航</p>
      <p style="font-size:10px;color:${palette.muted};margin:0;">👉 滑动</p>
    </section>
    <section style="overflow-x:scroll;-webkit-overflow-scrolling:touch;white-space:nowrap;padding-bottom:8px;">${cards}</section>
  </section>`.replace(/\bborder-radius:12px;/g, `border-radius:${Math.max(shape.radius - 2, 4)}px;`);
}

function tocNumbered(entries: PlanTocEntry[], t: LayoutTokens): string {
  const { palette, shape } = t;
  const rows = entries
    .map(
      (entry) =>
        `<section style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <span style="flex-shrink:0;font-size:12px;font-weight:800;color:${palette.accent};letter-spacing:1px;">${esc(entry.label)}</span>
          <span style="font-size:14px;font-weight:700;color:${palette.ink};">${esc(entry.title)}</span>
        </section>`,
    )
    .join('');
  return `<section style="margin:0 0 32px;padding:18px 20px;background:${palette.accentWash};border:1px solid ${palette.border};border-radius:${shape.radius}px;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:3px;color:${palette.accent};">目录 · CONTENTS</p>
    ${rows}
  </section>`;
}

// ──── Chapter header ────────────────────────────────────────────

export function renderChapterHeader(chapter: PlanChapter, t: LayoutTokens): string {
  switch (t.components.chapterHeader) {
    case 'badgeRow':
      return chapterBadgeRow(chapter, t);
    case 'ruleUnderline':
      return chapterRuleUnderline(chapter, t);
    case 'band':
      return chapterBand(chapter, t);
    case 'centeredRule':
      return chapterCenteredRule(chapter, t);
    case 'numberBar':
    default:
      return chapterNumberBar(chapter, t);
  }
}

function chapterNumberBar(chapter: PlanChapter, t: LayoutTokens): string {
  const { palette, typography } = t;
  const subtitle = chapter.subtitle
    ? `<p style="margin:0;font-size:11px;font-weight:600;color:${palette.muted};letter-spacing:1.5px;">${esc(chapter.subtitle)}</p>`
    : '';
  return `<section style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
    <section style="text-align:center;flex-shrink:0;">
      <p style="margin:0;font-size:28px;font-weight:900;color:${palette.accent};line-height:1;letter-spacing:-2px;">${esc(chapter.number)}</p>
      <p style="margin:0;font-size:8px;font-weight:700;color:${palette.border};letter-spacing:2px;">${esc(t.components.chapterKicker)}</p>
    </section>
    <span style="width:1px;height:36px;background:${palette.border};flex-shrink:0;">${FILL}</span>
    <section>
      <p style="margin:0 0 1px;font-size:${typography.chapterTitleSize}px;font-weight:900;color:${palette.ink};letter-spacing:0.3px;">${esc(chapter.title)}</p>
      ${subtitle}
    </section>
  </section>`;
}

function chapterBadgeRow(chapter: PlanChapter, t: LayoutTokens): string {
  const { palette, typography } = t;
  const subtitle = chapter.subtitle
    ? `<p style="font-size:10px;color:${palette.accent};font-weight:700;letter-spacing:3px;margin:0 0 2px;">${esc(chapter.subtitle)}</p>`
    : '';
  return `<section style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid ${palette.accent};">
    <section style="display:flex;align-items:center;">
      <span style="display:inline-block;background:${palette.accent};color:#FFFFFF;font-size:18px;font-weight:900;padding:4px 14px;border-radius:6px;margin-right:14px;line-height:1.3;">${esc(chapter.number)}</span>
      <section>
        ${subtitle}
        <p style="font-size:${typography.chapterTitleSize}px;font-weight:800;color:${palette.ink};margin:0;letter-spacing:0.5px;">${esc(chapter.title)}</p>
      </section>
    </section>
  </section>`;
}

function chapterRuleUnderline(chapter: PlanChapter, t: LayoutTokens): string {
  const { palette, typography } = t;
  const subtitle = chapter.subtitle
    ? `<p style="margin:6px 0 0;font-size:11px;color:${palette.muted};letter-spacing:2px;">${esc(chapter.subtitle)}</p>`
    : '';
  return `<section style="margin-bottom:22px;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:${palette.accent};letter-spacing:3px;">${esc(t.components.chapterKicker)} ${esc(chapter.number)}</p>
    <p style="margin:0;font-size:${typography.chapterTitleSize + 1}px;font-weight:900;color:${palette.ink};letter-spacing:0.5px;">${esc(chapter.title)}</p>
    ${subtitle}
    <section style="height:1px;background:${palette.border};margin-top:14px;">${FILL}</section>
  </section>`;
}

/** Full-width solid accent band with the number and white title inside. */
function chapterBand(chapter: PlanChapter, t: LayoutTokens): string {
  const { palette, typography, shape } = t;
  const radius = Math.max(shape.radius - 4, 2);
  const subtitle = chapter.subtitle
    ? `<p style="margin:4px 0 0;font-size:10px;color:rgba(255,255,255,0.75);letter-spacing:2px;">${esc(chapter.subtitle)}</p>`
    : '';
  return `<section style="display:flex;align-items:center;gap:14px;background:${palette.accent};border-radius:${radius}px;padding:14px 18px;margin-bottom:24px;">
    <span style="flex-shrink:0;font-size:26px;font-weight:900;color:rgba(255,255,255,0.5);line-height:1;">${esc(chapter.number)}</span>
    <span style="flex-shrink:0;width:1px;height:30px;background:rgba(255,255,255,0.35);">${FILL}</span>
    <section>
      <p style="margin:0;font-size:${typography.chapterTitleSize}px;font-weight:800;color:#ffffff;line-height:1.35;">${esc(chapter.title)}</p>
      ${subtitle}
    </section>
  </section>`;
}

/** Centered kicker + title over a symmetric dot-leader rule. */
function chapterCenteredRule(chapter: PlanChapter, t: LayoutTokens): string {
  const { palette, typography } = t;
  const kicker = t.components.chapterKicker;
  const kickerLine = kicker
    ? `<p style="margin:0 0 8px;text-align:center;"><span style="font-size:10px;font-weight:700;color:${palette.accent};letter-spacing:4px;">${esc(kicker)} · ${esc(chapter.number)}</span></p>`
    : '';
  const subtitle = chapter.subtitle
    ? `<p style="margin:6px 0 0;font-size:11px;color:${palette.muted};letter-spacing:2px;text-align:center;">${esc(chapter.subtitle)}</p>`
    : '';
  return `<section style="margin-bottom:24px;">
    ${kickerLine}
    <p style="margin:0;font-size:${typography.chapterTitleSize + 2}px;font-weight:800;color:${palette.ink};letter-spacing:1.5px;text-align:center;">${esc(chapter.title)}</p>
    ${subtitle}
    <section style="display:flex;align-items:center;margin-top:14px;">
      <span style="flex:1;height:1px;background:${palette.border};overflow:hidden;">${FILL}</span>
      <span style="flex-shrink:0;width:5px;height:5px;border-radius:50%;background:${palette.accent};font-size:0;line-height:0;">&nbsp;</span>
      <span style="flex:1;height:1px;background:${palette.border};overflow:hidden;">${FILL}</span>
    </section>
  </section>`;
}

// ──── Closing pieces ────────────────────────────────────────────

export function renderEndMark(t: LayoutTokens): string {
  const { palette, components } = t;
  if (!components.endMark) return '';
  return `<section style="text-align:center;margin:0 0 32px;">
    <section style="display:flex;align-items:center;justify-content:center;">
      <span style="height:2px;width:60px;background:linear-gradient(to right,transparent,${palette.accent});margin-right:12px;">${FILL}</span>
      <span style="font-size:11px;color:${palette.accent};letter-spacing:3px;font-weight:700;">${esc(components.endMark)}</span>
      <span style="height:2px;width:60px;background:linear-gradient(to left,transparent,${palette.accent});margin-left:12px;">${FILL}</span>
    </section>
  </section>`;
}

export function renderTagGroup(tags: string[], t: LayoutTokens): string {
  if (tags.length === 0) return '';
  const { palette } = t;
  const pills = tags
    .map((tag) => {
      const label = tag.startsWith('#') ? tag : `#${tag}`;
      return `<span style="display:inline-block;font-size:12px;font-weight:700;color:${palette.accent};background:${palette.accentWash};padding:3px 10px;border-radius:999px;margin:0 6px 6px 0;">${esc(label)}</span>`;
    })
    .join('');
  return `<section style="margin:0 0 24px;"><section style="display:flex;flex-wrap:wrap;">${pills}</section></section>`;
}

export function renderSignature(sig: PlanSignature, t: LayoutTokens): string {
  const { palette, shape, typography } = t;
  const intro = sig.intro
    ? `<p style="font-size:12px;color:${palette.muted};margin:0 0 10px;line-height:1.8;">${esc(sig.intro)}</p>`
    : '';
  const cta = sig.cta
    ? `<p style="font-size:${typography.bodySize - 1}px;color:${palette.body};margin:0;font-weight:600;line-height:1.7;">${esc(sig.cta)}</p>`
    : '';
  if (!intro && !cta) return '';
  return `<section style="background:${palette.accentWash};border:1px solid ${palette.border};border-radius:${shape.radius + 2}px;padding:24px;text-align:center;margin:0 0 32px;">${intro}${cta}</section>`;
}

/** Outer page wrapper. */
export function renderShell(inner: string, t: LayoutTokens): string {
  const { palette, typography } = t;
  return `<section style="max-width:677px;margin:0 auto;background:${palette.bg};font-family:${typography.fontFamily};color:${palette.body};line-height:${typography.bodyLineHeight};letter-spacing:${typography.letterSpacing}px;overflow-x:hidden;">${inner}</section>`;
}
