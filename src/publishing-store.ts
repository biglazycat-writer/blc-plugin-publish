import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function createPublishingStore(dataDir: string) {
  const directory = path.join(dataDir, 'publishing');
  await mkdir(directory, { recursive: true });
  const transfers = new Map<string, { chunks: string[]; size: number; time: number }>();
  async function load<T>(name: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(path.join(directory, name), 'utf8')) as T; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
  }
  function serialize(value: unknown): string {
    const text = JSON.stringify(value);
    if (text === undefined || Buffer.byteLength(text, 'utf8') > 32 << 20) throw Error('发布内容超过 32 MiB 或无法序列化');
    return text;
  }
  async function save(name: string, value: unknown): Promise<void> {
    const text = serialize(value);
    const temporary = path.join(directory, randomUUID() + '.tmp');
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, path.join(directory, name));
  }
  function put(args: { id: string; index: number; chunk: string }) {
    for (const [id, transfer] of transfers) if (Date.now() - transfer.time > 300000) transfers.delete(id);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(args.id) || typeof args.chunk !== 'string' || args.chunk.length > 128 << 10) throw Error('无效的传输片段');
    let transfer = transfers.get(args.id);
    if (!transfer) {
      if (args.index !== 0 || transfers.size >= 4) throw Error('传输顺序无效或队列已满');
      transfer = { chunks: [], size: 0, time: Date.now() };
      transfers.set(args.id, transfer);
    }
    if (args.index !== transfer.chunks.length) throw Error('传输顺序不一致');
    const size = Buffer.byteLength(args.chunk, 'utf8');
    if (transfer.size + size > 32 << 20) { transfers.delete(args.id); throw Error('发布内容超过 32 MiB'); }
    transfer.chunks.push(args.chunk); transfer.size += size; transfer.time = Date.now();
    return { received: transfer.chunks.length };
  }
  function consume(id: string): unknown {
    const transfer = transfers.get(id);
    if (!transfer || Date.now() - transfer.time > 300000) { transfers.delete(id); throw Error('传输已失效，请重新提交'); }
    transfers.delete(id);
    return JSON.parse(transfer.chunks.join(''));
  }
  function articleFile(key = 'default'): string {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(key)) throw Error('无效的发布稿标识');
    return 'article-' + key + '.json';
  }
  return { load, save, serialize, put, consume, articleFile, clear: () => transfers.clear() };
}
