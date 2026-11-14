import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import writing from './i18n/zh-CN/writing.json';
import settings from './i18n/zh-CN/settings.json';
import common from './i18n/zh-CN/common.json';
import type { PublishDraft } from './features/writing/modals/WeChatPublishModal';
import type { WeChatMPPanelHandle } from './features/settings/WeChatMPPanel';
import { sdk, invoke, transfer, readArticle } from './bridge/publishing-api';
const WeChatPublishModal = lazy(() => import('./features/writing/modals/WeChatPublishModal').then(module => ({ default: module.WeChatPublishModal })));
const WeChatMPPanel = lazy(() => import('./features/settings/WeChatMPPanel').then(module => ({ default: module.WeChatMPPanel })));
const ThemePicker = lazy(() => import('./ThemePicker'));

import './style.css';

await i18next.use(initReactI18next).init({
  lng: 'zh-CN', fallbackLng: 'zh-CN',
  resources: { 'zh-CN': { writing, settings, common } },
  defaultNS: 'writing', interpolation: { escapeValue: false },
});
const view = await sdk.context();
const draftKey = (view.state as { draftKey?: string } | undefined)?.draftKey ?? view.instanceId;
const restoredPage = (view.state as { page?: string } | undefined)?.page;
const origin = view.context;
const canReturnToArticle = !!(origin?.workspaceId && origin.workspaceSession && origin.documentId);

function App() {
  const [page, setPage] = useState(restoredPage === 'settings' || restoredPage === 'publish' ? restoredPage : location.hash.includes('settings') ? 'settings' : 'publish');
  const currentPage = useRef(page);
  const [draft, setDraft] = useState<PublishDraft | null>(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(true);
  const [accountDirty, setAccountDirty] = useState(false);
  const [returning, setReturning] = useState(false);
  const returningRef = useRef(false);
  const latest = useRef<PublishDraft | null>(null);
  const articleSaved = useRef(true);
  const settingsDirty = useRef(false);
  const account = useRef<WeChatMPPanelHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const apply = (mode: 'light' | 'dark') => { document.documentElement.dataset.colorScheme = mode; document.documentElement.style.colorScheme = mode; };
    apply(sdk.appearance.getColorScheme());
    const unsubscribe = sdk.appearance.onDidChangeColorScheme(apply);
    // Native containers can be hidden while loading; animation frames may pause.
    void sdk.ready().catch(e => setError(String(e)));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (page !== 'publish' || latest.current) return;
    let active = true;
    void readArticle<PublishDraft & { format?: string }>(draftKey).then(value => {
      if (value.format && value.format !== 'markdown') throw new Error('发布稿需要 Markdown 格式，请从原文重新打开发布');
      if (!active) return;
      setDraft(value);
      latest.current = value;
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [page]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const persist = useCallback(async () => {
    clearTimeout(timer.current);
    const task = queue.current.catch(() => {}).then(async () => {
      setSaveError('');
      for (;;) {
        const value = latest.current;
        if (value && !articleSaved.current) {
          await invoke('article.save', { draftKey, transferId: await transfer(value) });
          if (latest.current !== value) continue;
          articleSaved.current = true;
        }
        const dirty = settingsDirty.current;
        await sdk.setState({ draftKey, page: currentPage.current }, dirty);
        if (latest.current !== value || settingsDirty.current !== dirty) continue;
        setSaved(true);
        return;
      }
    });
    queue.current = task;
    try { await task; }
    catch (e) { setSaved(false); setSaveError(String(e)); throw e; }
  }, []);

  const saveAll = useCallback(async () => {
    await account.current?.save();
    settingsDirty.current = false;
    setAccountDirty(false);
    await persist();
  }, [persist]);
  useEffect(() => sdk.onSave(saveAll), [saveAll]);

  const changed = useCallback((value: PublishDraft) => {
    latest.current = value;
    articleSaved.current = false;
    setSaved(false);
    void sdk.setState({ draftKey, page: currentPage.current }, true).catch(e => setSaveError(String(e)));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist().catch(() => {}); }, 700);
  }, [persist]);

  const accountChanged = useCallback((dirty: boolean) => {
    settingsDirty.current = dirty;
    setAccountDirty(dirty);
    void sdk.setState({ draftKey, page: currentPage.current }, dirty || !articleSaved.current).catch(e => setError(String(e)));
  }, []);

  const navigate = async (next: string) => {
    try {
      await saveAll();
      setDraft(latest.current);
      currentPage.current = next;
      setPage(next);
      await sdk.setState({ draftKey, page: next }, false);
      setError('');
    } catch (e) { setError(String(e)); }
  };

  const returnToArticle = async () => {
    if (!canReturnToArticle || returningRef.current) return;
    returningRef.current = true;
    setReturning(true);
    setError('');
    try {
      await saveAll();
      await sdk.ui.openDocument({ workspaceId: origin.workspaceId!, workspaceSession: origin.workspaceSession!, documentId: origin.documentId! });
    } catch (e) { setError(`无法返回原文章：${e instanceof Error ? e.message : String(e)}`); }
    finally { returningRef.current = false; setReturning(false); }
  };

  return <main className="publisher">
    <header className="publisherHeader">
      {canReturnToArticle && <button className="publisherBack" disabled={returning} onClick={() => void returnToArticle()}><ArrowLeft size={15} />{returning ? '正在返回…' : '返回原文章'}</button>}
      <div><strong>微信公众号发布</strong><small>大懒猫创作平台插件</small></div>
      <nav aria-label="插件导航">
        <button aria-current={page === 'publish' ? 'page' : undefined} onClick={() => void navigate('publish')}>文章发布</button>
        <button aria-current={page === 'settings' ? 'page' : undefined} onClick={() => void navigate('settings')}>账号设置</button>
      </nav>
      {page === 'publish' && <Suspense fallback={null}><ThemePicker /></Suspense>}
      {(draft || page === 'settings') && <small role="status" className={saveError ? 'error' : accountDirty ? 'dirty' : undefined}>{saveError ? '本地发布稿保存失败' : accountDirty ? '账号设置未保存' : page === 'settings' ? '账号设置已保存' : saved ? '本地发布稿已保存' : '正在保存本地发布稿…'}</small>}
      {saveError && <button onClick={() => void persist().catch(() => {})}>重试保存</button>}
    </header>
    {error && <p role="alert" className="settingsErr">{error}</p>}
    {saveError && <p role="alert" className="settingsErr">本地发布稿未能保存：{saveError}</p>}
    <Suspense fallback={<p role="status">正在加载页面…</p>}>{page === 'settings'
      ? <div className="accountSettings"><WeChatMPPanel ref={account} onDirtyChange={accountChanged} /></div>
      : draft
        ? <WeChatPublishModal open markdownText={draft.articleText ?? ''} title={draft.publishTitle} draft={draft} onDraftChange={changed} />
        : <p role="status">正在读取文章…</p>}</Suspense>
  </main>;
}

export function mount(element: HTMLElement) { createRoot(element).render(<App />); }
