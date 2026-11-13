import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import writing from './i18n/zh-CN/writing.json';
import settings from './i18n/zh-CN/settings.json';
import common from './i18n/zh-CN/common.json';
import { WeChatPublishModal, type PublishDraft } from './features/writing/modals/WeChatPublishModal';
import { WeChatMPPanel, type WeChatMPPanelHandle } from './features/settings/WeChatMPPanel';
import { sdk, invoke, transfer, readArticle } from './bridge/publishing-api';
import { useThemes } from './lib/editor-themes/theme-store';
import { setThemeId, useThemeId } from './lib/theme';
import './style.css';

await i18next.use(initReactI18next).init({
  lng: 'zh-CN', fallbackLng: 'zh-CN',
  resources: { 'zh-CN': { writing, settings, common } },
  defaultNS: 'writing', interpolation: { escapeValue: false },
});
const view = await sdk.context();
const draftKey = (view.state as { draftKey?: string } | undefined)?.draftKey ?? view.instanceId;
const restoredPage = (view.state as { page?: string } | undefined)?.page;

function App() {
  const [page, setPage] = useState(restoredPage === 'settings' || restoredPage === 'publish' ? restoredPage : location.hash.includes('settings') ? 'settings' : 'publish');
  const currentPage = useRef(page);
  const [draft, setDraft] = useState<PublishDraft | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [accountDirty, setAccountDirty] = useState(false);
  const latest = useRef<PublishDraft | null>(null);
  const articleSaved = useRef(true);
  const settingsDirty = useRef(false);
  const account = useRef<WeChatMPPanelHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const themes = useThemes();
  const { themeId } = useThemeId();

  useEffect(() => {
    void readArticle<PublishDraft & { format?: string }>(draftKey).then(value => {
      if (value.format && value.format !== 'markdown') throw new Error('发布稿需要 Markdown 格式，请从原文重新打开发布');
      setDraft(value);
      latest.current = value;
    }).catch(e => setError(String(e)));
    return () => clearTimeout(timer.current);
  }, []);

  const persist = useCallback(async () => {
    clearTimeout(timer.current);
    const task = queue.current.catch(() => {}).then(async () => {
      for (;;) {
        const value = latest.current;
        if (!value) return;
        if (!articleSaved.current) {
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
    await task;
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
    void sdk.setState({ draftKey, page: currentPage.current }, true).catch(e => setError(String(e)));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist().catch(e => setError(String(e))); }, 700);
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

  return <main className="publisher">
    <header className="publisherHeader">
      <div><strong>微信公众号发布</strong><small>大懒猫创作平台插件</small></div>
      <nav aria-label="插件导航">
        <button aria-current={page === 'publish' ? 'page' : undefined} onClick={() => void navigate('publish')}>文章发布</button>
        <button aria-current={page === 'settings' ? 'page' : undefined} onClick={() => void navigate('settings')}>账号设置</button>
      </nav>
      {page === 'publish' && <label>排版主题 <select value={themeId} onChange={e => setThemeId(e.target.value)}>
        {themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
      </select></label>}
      <small role="status">{accountDirty ? '账号设置未保存' : saved ? '草稿已保存' : '正在保存…'}</small>
    </header>
    {error && <p role="alert" className="settingsErr">{error}</p>}
    {page === 'settings'
      ? <div className="accountSettings"><WeChatMPPanel ref={account} onDirtyChange={accountChanged} /></div>
      : draft
        ? <WeChatPublishModal open markdownText={draft.articleText ?? ''} title={draft.publishTitle} draft={draft} onDraftChange={changed} />
        : <p>正在读取文章…</p>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
