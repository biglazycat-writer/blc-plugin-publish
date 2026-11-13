export type WikiLink = { target: string; alias?: string }

export function parseWikiLink(value: string): WikiLink | null {
  const separator = value.indexOf('|')
  const target = (separator < 0 ? value : value.slice(0, separator)).trim()
  const alias = separator < 0 ? undefined : value.slice(separator + 1).trim()
  if (!target || /[\[\]\r\n]/.test(value)) return null
  return { target, ...(alias ? { alias } : {}) }
}

export function wikiLinkMarkdown(link: WikiLink): string {
  return `[[${link.target}${link.alias ? `|${link.alias}` : ''}]]`
}

export function wikiPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').normalize('NFC').toLocaleLowerCase()
}

export type WikiQuery = { from: number; to: number; query: string }

export function findWikiQuery(text: string, cursor: number): WikiQuery | null {
  const before = text.slice(0, cursor)
  const match = /(?<!\\)\[\[([^\[\]\n]*)$/.exec(before)
  if (!match) return null
  return { from: cursor - match[0].length, to: cursor, query: match[1] }
}
