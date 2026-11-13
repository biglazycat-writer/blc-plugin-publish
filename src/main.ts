import { definePlugin, readDocument, type Invocation } from 'blc-plugin-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { WeChatClient, type Draft } from './wechat.js';
import { createPublishingStore } from './publishing-store.js';

type Account = { app_id?: string; proxy_url?: string; last_verified_at?: string };
type AccountInput = Account & { app_secret?: string; clearSecret?: boolean };

export default definePlugin(async ctx => {
  let client: WeChatClient | undefined;
  const store = await createPublishingStore(ctx.dataDir);
  const account = () => store.load<Account>('account.json', {});
  const config = async () => {
    const value = await account();
    return {
      app_id: value.app_id ?? '', app_secret: '', proxy_url: value.proxy_url ?? '',
      secret_configured: !!await ctx.credentials.get('wechat-app-secret'),
      account_name: '', default_author: '', last_verified_at: value.last_verified_at ?? '', last_error: '',
    };
  };
  const connection = async () => {
    if (!client) {
      const value = await account();
      client = new WeChatClient(value.app_id ?? '', await ctx.credentials.get('wechat-app-secret') ?? '', value.proxy_url ?? '');
    }
    return client;
  };
  const signal = (inv: Invocation) => AbortSignal.any([inv.signal, AbortSignal.timeout(300000)]);

  ctx.commands.register('transfer.put', store.put);
  ctx.commands.register('config.read', config);
  ctx.commands.register('config.save', async (args: AccountInput) => {
    const old = await account();
    const appID = String(args.app_id ?? '').trim();
    if (!appID) throw Error('请填写 AppID');
    const proxy = String(args.proxy_url ?? '').trim();
    new WeChatClient(appID, '', proxy).close();
    if (args.clearSecret || old.app_id && old.app_id !== appID) await ctx.credentials.delete('wechat-app-secret');
    if (args.app_secret) await ctx.credentials.set('wechat-app-secret', String(args.app_secret).trim());
    await store.save('account.json', { app_id: appID, proxy_url: proxy });
    client?.close(); client = undefined;
    return config();
  });
  ctx.commands.register('connection.test', async (_, inv) => {
    await (await connection()).token(signal(inv));
    await store.save('account.json', { ...await account(), last_verified_at: new Date().toISOString() });
    return config();
  });
  ctx.commands.register('connection.ip', async (_, inv) => (await connection()).detectIP(signal(inv)));
  ctx.commands.register('materials.list', async (args: { offset?: number; count?: number }, inv) =>
    (await connection()).materials(args.offset ?? 0, args.count ?? 20, signal(inv)));
  ctx.commands.register('draft.create', async (args: { transferId: string }, inv) =>
    (await connection()).draft(store.consume(args.transferId) as Draft, signal(inv), (n, message) => inv.progress(n, message)));

  ctx.commands.register('article.save', async (args: { draftKey?: string; transferId: string }) => {
    await store.save(store.articleFile(args.draftKey), store.consume(args.transferId));
    return { saved: true };
  });
  ctx.commands.register('article.read', async (args: { draftKey?: string; offset?: number; limit?: number; hash?: string } = {}, inv) => {
    const offset = args.offset ?? 0, limit = args.limit ?? 96 * 1024;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 96 * 1024) throw Error('无效的发布稿片段范围');
    let article = await store.load<Record<string, unknown> | null>(store.articleFile(args.draftKey), null);
    if (!article) {
      article = { articleText: '', publishTitle: '' };
      if (inv.documentId && inv.editorId && inv.workspaceId && inv.workspaceSession) {
        const document = await readDocument(ctx.documents, {
          workspaceId: inv.workspaceId, workspaceSession: inv.workspaceSession,
          documentId: inv.documentId, editorId: inv.editorId, windowId: inv.windowId,
        }, { signal: inv.signal });
        article = { articleText: document.content, format: document.format, publishTitle: '' };
      }
      await store.save(store.articleFile(args.draftKey), article);
    }
    const text = store.serialize(article);
    const hash = createHash('sha256').update(text).digest('hex');
    if (offset > text.length) throw Error('无效的发布稿片段范围');
    if (offset > 0 && args.hash !== hash || args.hash && args.hash !== hash) throw Error('发布稿已变更，请重新读取');
    return { chunk: text.slice(offset, offset + limit), total: text.length, hash };
  });
  ctx.commands.register('publish.open', async (_, inv) => {
    const draftKey = randomUUID();
    if (inv.documentId && inv.editorId && inv.workspaceId && inv.workspaceSession) {
      const document = await readDocument(ctx.documents, {
        workspaceId: inv.workspaceId, workspaceSession: inv.workspaceSession,
        documentId: inv.documentId, editorId: inv.editorId, windowId: inv.windowId,
      }, { signal: inv.signal });
      await store.save(store.articleFile(draftKey), { articleText: document.content, format: document.format, publishTitle: '' });
    }
    return ctx.views.open('publish', { context: inv, state: { draftKey } });
  });
  ctx.commands.register('debug.status', async () => ({ pluginId: ctx.pluginId, apiVersion: ctx.apiVersion, accountConfigured: !!(await config()).secret_configured, commands: 11, publicPublishing: false }));
  return () => { client?.close(); store.clear(); };
});
