const FORBIDDEN_STYLE_RULES = [
  /^position\s*:\s*(fixed|absolute|sticky)\b/i,
  /^float\s*:/i,
  /^display\s*:\s*grid\b/i,
  /^@media\b/i,
  /^@keyframes\b/i,
  /^@import\b/i,
  // juice 无法求值 counter()，原样内联会把 "counter(section, decimal-leading-zero)"
  // 当字面文本渲染出来。主题拿 counter 做章节编号时，编号是编辑器独有的增值，
  // 导出时丢掉整条声明，比印出一串函数名干净。
  /counter\s*\(/i,
];

function fallbackNormalize(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<\/?div\b/gi, (match) => match.replace(/div/i, "section"))
    .replace(/<\/?pre\b/gi, (match) => match.replace(/pre/i, "section"))
    .replace(/\s(?:class|id)="[^"]*"/gi, "")
    .replace(/\s(?:class|id)='[^']*'/gi, "");
}

function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .filter((rule) => !FORBIDDEN_STYLE_RULES.some((pattern) => pattern.test(rule)))
    .filter((rule) => !/var\s*\(\s*--/i.test(rule))
    .join(";");
}

function replaceDivWithSection(element: Element): Element {
  if (element.tagName.toLowerCase() !== "div") return element;

  return replaceTagName(element, "section");
}

function replaceTagName(element: Element, tagName: string): Element {
  const replacement = element.ownerDocument.createElement(tagName);
  for (const attr of Array.from(element.attributes)) {
    replacement.setAttribute(attr.name, attr.value);
  }
  while (element.firstChild) {
    replacement.appendChild(element.firstChild);
  }
  element.replaceWith(replacement);
  return replacement;
}

/**
 * 把代码文本转成微信编辑器不依赖 `white-space` 保存的形式：换行 → `<br>`，
 * 空格/制表 → 不间断空格。只动文本节点，highlight.js 的高亮 span 原样保留。
 *
 * 这是布局管线 renderCode 已经验证过的做法 —— 微信会丢 `white-space:pre`，
 * 靠样式保换行不可靠。
 */
function flattenPreWhitespace(element: Element): void {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) {
    const value = node.nodeValue || "";
    if (!value) continue;
    const fragment = element.ownerDocument.createDocumentFragment();
    const lines = value.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) fragment.appendChild(element.ownerDocument.createElement("br"));
      if (line) {
        fragment.appendChild(
          element.ownerDocument.createTextNode(line.replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0").replace(/ /g, "\u00A0")),
        );
      }
    });
    node.replaceWith(fragment);
  }
}

function sanitizeElement(element: Element): Element | null {
  const tagName = element.tagName.toLowerCase();
  if (["style", "script", "link"].includes(tagName)) {
    element.remove();
    return null;
  }

  const current = replaceDivWithSection(element);
  for (const attr of Array.from(current.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === "class" || name === "id" || name.startsWith("on")) {
      current.removeAttribute(attr.name);
      continue;
    }

    if (name === "style") {
      const cleaned = cleanStyle(attr.value);
      if (cleaned) current.setAttribute("style", cleaned);
      else current.removeAttribute("style");
    }
  }

  return current;
}

function hasLeafAncestor(node: Node): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (parent.tagName.toLowerCase() === "span" && parent.hasAttribute("leaf")) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

function shouldWrapTextNode(node: Text): boolean {
  if (!node.nodeValue || node.nodeValue.trim().length === 0) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  if (hasLeafAncestor(node)) return false;
  return !["style", "script", "title", "head"].includes(parent.tagName.toLowerCase());
}

function wrapTextNode(node: Text): void {
  const span = node.ownerDocument.createElement("span");
  span.setAttribute("leaf", "");
  span.textContent = node.nodeValue || "";
  node.replaceWith(span);
}

export function normalizeWechatHtmlFragment(html: string): string {
  if (typeof document === "undefined") return fallbackNormalize(html);

  const template = document.createElement("template");
  template.innerHTML = html;

  // 公众号粘贴检查见到 <pre> 就提示「内容不换行、移动端可能横向溢出」，而且微信
  // 编辑器会丢 white-space:pre。走到这里时主题样式已由 juice 内联在元素上，把 pre
  // 改名 section 丝毫不丢样式；代码文本同步转成 <br> + 不间断空格（布局管线
  // renderCode 的同一套做法），换行不再依赖 white-space。
  for (const pre of Array.from(template.content.querySelectorAll("pre"))) {
    flattenPreWhitespace(pre);
    replaceTagName(pre, "section");
  }

  const elements = Array.from(template.content.querySelectorAll("*"));
  for (const element of elements) {
    sanitizeElement(element);
  }

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    if (shouldWrapTextNode(node)) wrapTextNode(node);
  }

  return template.innerHTML;
}

