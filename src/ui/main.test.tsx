import React, { act, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  view: { instanceId: 'view-one' } as { instanceId: string; state?: { draftKey?: string; page?: string }; context?: { workspaceId?: string; workspaceSession?: string; documentId?: string } },
  rendered: null as ReactElement | null,
  appearance: { getColorScheme: vi.fn(() => 'dark'), onDidChangeColorScheme: vi.fn((_listener: (mode: 'light' | 'dark') => void) => vi.fn()) }, ready: vi.fn(),
  readArticle: vi.fn(), invoke: vi.fn(), transfer: vi.fn(), setState: vi.fn(), accountSave: vi.fn(), openDocument: vi.fn(),
  save: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: (value: ReactElement) => { mocks.rendered = value; } }) }));
vi.mock('./bridge/publishing-api', () => ({
  readArticle: mocks.readArticle, invoke: mocks.invoke, transfer: mocks.transfer,
  sdk: { ui: { openDocument: mocks.openDocument }, appearance: mocks.appearance, ready: mocks.ready, context: async () => mocks.view, setState: mocks.setState, onSave: (handler: () => Promise<void>) => { mocks.save = handler; return () => { mocks.save = undefined; }; } },
}));
vi.mock('./lib/content-model', () => ({ docToMarkdown: (text: string) => text, storedDocFromRaw: (text: string) => text }));
vi.mock('./lib/editor-themes/theme-store', () => ({ useThemes: () => [] }));
vi.mock('./lib/theme', () => ({ setThemeId: vi.fn(), useThemeId: () => ({ themeId: 'default' }) }));
vi.mock('./features/writing/modals/WeChatPublishModal', () => ({
  WeChatPublishModal: function PublishForm(props: { draft: { articleText: string; publishTitle: string }; onDraftChange: (value: { articleText: string; publishTitle: string }) => void }) {
    const [draft, setDraft] = React.useState(props.draft);
    React.useEffect(() => setDraft(props.draft), [props.draft]);
    return <textarea aria-label="test article" value={draft.articleText} onChange={event => {
      const next = { ...draft, articleText: event.target.value };
      setDraft(next); props.onDraftChange(next);
    }} />;
  },
}));
vi.mock('./features/settings/WeChatMPPanel', () => ({
  WeChatMPPanel: React.forwardRef(function Panel(props: { onDirtyChange?: (dirty: boolean) => void }, ref) {
    React.useImperativeHandle(ref, () => ({ save: mocks.accountSave }));
    return <button onClick={() => props.onDirtyChange?.(true)}>edit account</button>;
  }),
}));

let root: Root, element: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules(); vi.clearAllMocks();
  mocks.view = { instanceId: 'view-one' };
  mocks.readArticle.mockResolvedValue({ articleText: 'saved article', publishTitle: 'saved title' });
  mocks.invoke.mockResolvedValue({ saved: true }); mocks.transfer.mockResolvedValue('payload-one');
  mocks.setState.mockResolvedValue(undefined); mocks.accountSave.mockResolvedValue(undefined);
  mocks.ready.mockResolvedValue(undefined);
  mocks.openDocument.mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  location.hash = '#/publish';
  element = document.createElement('div'); document.body.append(element);
  root = (await vi.importActual<typeof import('react-dom/client')>('react-dom/client')).createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount() {
  const app = await import('./App'); app.mount(element);
  await act(async () => root.render(mocks.rendered));
  await act(async () => { await vi.dynamicImportSettled(); });
}
async function button(text: string) {
  const target = [...element.querySelectorAll('button')].find(value => value.textContent === text)!;
  await act(async () => target.click());
  await act(async () => { await vi.dynamicImportSettled(); });
}
async function edit(text: string) {
  await act(async () => {
    const input = element.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('publishing view persistence', () => {
  it('automatically saves edits and labels the result as a local publishing draft', async () => {
    await mount(); vi.useFakeTimers();
    expect(element.textContent).toContain('本地发布稿已保存');
    await edit('edited article');
    expect(element.textContent).toContain('正在保存本地发布稿');
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(mocks.invoke).toHaveBeenCalledWith('article.save', { draftKey: 'view-one', transferId: 'payload-one' });
    expect(element.textContent).toContain('本地发布稿已保存');
    expect(element.textContent).not.toContain('草稿已保存');
  });

  it('reports an automatic save failure and retries the latest article from the page', async () => {
    await mount(); vi.useFakeTimers(); await edit('unsaved article');
    mocks.invoke.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(element.textContent).toContain('本地发布稿保存失败');
    expect(element.querySelector('[role=alert]')?.textContent).toContain('disk full');
    expect(element.querySelector('textarea')?.value).toBe('unsaved article');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, true);
    await edit('latest article');
    await button('重试保存');
    expect(mocks.transfer).toHaveBeenLastCalledWith({ articleText: 'latest article', publishTitle: 'saved title' });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, false);
    expect(element.querySelector('[role=alert]')).toBeNull();
    expect(element.textContent).toContain('本地发布稿已保存');
    expect([...element.querySelectorAll('button')].some(button => button.textContent === '重试保存')).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('retries the host checkpoint without re-uploading an already saved local draft', async () => {
    await mount(); vi.useFakeTimers(); await edit('edited article');
    mocks.setState.mockRejectedValueOnce(new Error('checkpoint unavailable'));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(element.querySelector('[role=alert]')?.textContent).toContain('checkpoint unavailable');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await button('重试保存');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, false);
    expect(element.querySelector('[role=alert]')).toBeNull();
    expect(element.textContent).toContain('本地发布稿已保存');
  });

  it('uses distinct view identities for independent publishing drafts', async () => {
    await mount();
    expect(mocks.readArticle).toHaveBeenLastCalledWith('view-one');
    await act(async () => root.unmount());
    vi.resetModules(); mocks.view = { instanceId: 'view-two' };
    root = (await vi.importActual<typeof import('react-dom/client')>('react-dom/client')).createRoot(element);
    await mount();
    expect(mocks.readArticle).toHaveBeenLastCalledWith('view-two');
    expect(mocks.readArticle.mock.calls.map(call => call[0])).toEqual(['view-one', 'view-two']);
  });

  it('restores the saved section and draft key across reload, then persists navigation', async () => {
    mocks.view = { instanceId: 'reloaded-view', state: { draftKey: 'saved-draft', page: 'settings' } };
    await mount();
    expect(element.querySelector('nav [aria-current=page]')?.textContent).toBe('账号设置');
    expect(mocks.readArticle).not.toHaveBeenCalled();
    await button('文章发布');
    expect(mocks.readArticle).toHaveBeenCalledWith('saved-draft');
    expect(element.querySelector('textarea')?.value).toBe('saved article');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'saved-draft', page: 'publish' }, false);
  });

  it('retains an edited draft after a failed host save and saves the latest content on retry', async () => {
    await mount(); vi.useFakeTimers(); await edit('unsaved article');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, true);
    mocks.invoke.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { await expect(mocks.save!()).rejects.toThrow('disk full'); });
    expect(element.querySelector('textarea')?.value).toBe('unsaved article');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, true);
    await edit('latest article');
    await act(async () => { await mocks.save!(); });
    expect(mocks.transfer).toHaveBeenLastCalledWith({ articleText: 'latest article', publishTitle: 'saved title' });
    expect(mocks.invoke).toHaveBeenLastCalledWith('article.save', { draftKey: 'view-one', transferId: 'payload-one' });
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, false);
  });

  it('keeps unsaved account settings dirty until the host save succeeds in the same section', async () => {
    mocks.view.state = { page: 'settings' }; await mount(); await button('edit account');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'settings' }, true);
    mocks.accountSave.mockRejectedValueOnce(new Error('credential store unavailable'));
    await act(async () => { await expect(mocks.save!()).rejects.toThrow('credential store unavailable'); });
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'settings' }, true);
    await act(async () => { await mocks.save!(); });
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'settings' }, false);
    expect(element.querySelector('nav [aria-current=page]')?.textContent).toBe('账号设置');
  });

  it('coalesces edits during an in-flight save and finishes with the latest draft', async () => {
    await mount(); vi.useFakeTimers(); await edit('first article');
    let release!: () => void;
    mocks.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    let first!: Promise<void>, second!: Promise<void>, third!: Promise<void>;
    await act(async () => { first = mocks.save!(); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await edit('second article');
    await act(async () => { second = mocks.save!(); });
    await edit('latest article');
    await act(async () => { third = mocks.save!(); });
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, true);
    await act(async () => { release(); await Promise.all([first, second, third]); });
    expect(mocks.transfer.mock.calls.map(call => call[0].articleText)).toEqual(['first article', 'latest article']);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(element.querySelector('textarea')?.value).toBe('latest article');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, false);
  });
});

describe('plugin-owned return to the original article', () => {
  const origin = { workspaceId: 'workspace', workspaceSession: 'session', documentId: 'article' };
  it.each([undefined, {}, { workspaceId: 'workspace', documentId: 'article' }, { workspaceId: 'workspace', workspaceSession: 'session' }])('omits its return button without a complete origin: %o', async context => {
    mocks.view.context = context; await mount();
    expect(element.textContent).not.toContain('返回原文章');
    expect(mocks.openDocument).not.toHaveBeenCalled();
  });

  it('renders its own header button and saves the draft before calling host navigation', async () => {
    mocks.view.context = origin; await mount(); await edit('edited publishing draft');
    let finish!: () => void;
    mocks.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await button('返回原文章');
    const back = element.querySelector<HTMLButtonElement>('.publisherHeader .publisherBack')!;
    expect(back.disabled).toBe(true); expect(back.textContent).toContain('正在返回');
    expect(mocks.openDocument).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.transfer).toHaveBeenLastCalledWith({ articleText: 'edited publishing draft', publishTitle: 'saved title' });
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'view-one', page: 'publish' }, false);
    expect(mocks.openDocument).toHaveBeenCalledWith(origin);
    expect(back.disabled).toBe(false);
  });

  it('keeps the edited publishing draft when saving fails and does not navigate', async () => {
    mocks.view.context = origin; await mount(); await edit('unsaved publishing draft');
    mocks.invoke.mockRejectedValueOnce(new Error('disk full'));
    await button('返回原文章');
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(element.textContent).toContain('无法返回原文章：disk full');
    expect(element.querySelector('textarea')?.value).toBe('unsaved publishing draft');
    expect(element.querySelector<HTMLButtonElement>('.publisherBack')?.disabled).toBe(false);
  });

  it('saves account edits too and stays on settings when account save fails', async () => {
    mocks.view.context = origin; mocks.view.state = { page: 'settings' }; await mount();
    await button('edit account'); mocks.accountSave.mockRejectedValueOnce(new Error('credential unavailable'));
    await button('返回原文章');
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(element.textContent).toContain('无法返回原文章：credential unavailable');
    expect(element.querySelector('nav [aria-current=page]')?.textContent).toBe('账号设置');
    await button('返回原文章');
    expect(mocks.openDocument).toHaveBeenCalledWith(origin);
    expect(mocks.accountSave).toHaveBeenCalledTimes(2);
  });

  it('reports navigation errors in its own page and prevents duplicate requests', async () => {
    mocks.view.context = origin; await mount();
    let fail!: (error: Error) => void;
    mocks.openDocument.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const back = element.querySelector<HTMLButtonElement>('.publisherBack')!;
    await act(async () => { back.click(); back.click(); });
    expect(mocks.openDocument).toHaveBeenCalledOnce();
    await act(async () => fail(Object.assign(new Error('工作区已切换或关闭'), { code: 'WORKSPACE_CHANGED' })));
    expect(element.textContent).toContain('无法返回原文章：工作区已切换或关闭');
    expect(element.querySelector('textarea')?.value).toBe('saved article');
    expect(back.disabled).toBe(false);
    await button('返回原文章'); expect(mocks.openDocument).toHaveBeenCalledTimes(2);
  });
});

it('applies the resolved host mode and subscribes without changing article styling', async () => {
  await mount();
  expect(document.documentElement.dataset.colorScheme).toBe('dark');
  expect(mocks.appearance.onDidChangeColorScheme).toHaveBeenCalledOnce();
  const listener = mocks.appearance.onDidChangeColorScheme.mock.calls[0][0] as unknown as (mode: string) => void;
  await act(async () => listener('light'));
  expect(document.documentElement.dataset.colorScheme).toBe('light');
  expect(mocks.ready).toHaveBeenCalledOnce();
});
