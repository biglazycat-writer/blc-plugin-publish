import React, { act, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  view: { instanceId: 'view-one' } as { instanceId: string; state?: { draftKey?: string; page?: string } },
  rendered: null as ReactElement | null,
  readArticle: vi.fn(), invoke: vi.fn(), transfer: vi.fn(), setState: vi.fn(), accountSave: vi.fn(),
  save: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: (value: ReactElement) => { mocks.rendered = value; } }) }));
vi.mock('./bridge/publishing-api', () => ({
  readArticle: mocks.readArticle, invoke: mocks.invoke, transfer: mocks.transfer,
  sdk: { context: async () => mocks.view, setState: mocks.setState, onSave: (handler: () => Promise<void>) => { mocks.save = handler; return () => { mocks.save = undefined; }; } },
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
  location.hash = '#/publish';
  element = document.createElement('div'); document.body.append(element);
  root = (await vi.importActual<typeof import('react-dom/client')>('react-dom/client')).createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); });
async function mount() {
  await import('./main');
  await act(async () => root.render(mocks.rendered));
}
async function button(text: string) {
  const target = [...element.querySelectorAll('button')].find(value => value.textContent === text)!;
  await act(async () => target.click());
}
async function edit(text: string) {
  await act(async () => {
    const input = element.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('publishing view persistence', () => {
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
    expect(mocks.readArticle).toHaveBeenCalledWith('saved-draft');
    await button('文章发布');
    expect(element.querySelector('textarea')?.value).toBe('saved article');
    expect(mocks.setState).toHaveBeenLastCalledWith({ draftKey: 'saved-draft', page: 'publish' }, false);
  });

  it('retains an edited draft after a failed host save and saves the latest content on retry', async () => {
    vi.useFakeTimers(); await mount(); await edit('unsaved article');
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
    vi.useFakeTimers(); await mount(); await edit('first article');
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
