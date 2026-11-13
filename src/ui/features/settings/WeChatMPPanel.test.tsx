import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeChatMPPanel, type WeChatMPPanelHandle } from './WeChatMPPanel';

const bridge = vi.hoisted(() => ({
  getWeChatMPConfig: vi.fn(), saveWeChatMPConfig: vi.fn(),
  testWeChatMPConnection: vi.fn(), detectWeChatMPEgressIP: vi.fn(), openExternal: vi.fn(),
}));
vi.mock('../../bridge/publishing-api', () => ({ publishingApi: bridge, sdk: { ui: { openExternal: bridge.openExternal } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));

let root: Root, element: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  bridge.getWeChatMPConfig.mockResolvedValue({ app_id: 'wx-one', app_secret: '', proxy_url: '', secret_configured: true });
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
async function edit(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('account settings save contract', () => {
  it('groups the actions separately from the proxy field and keeps connection actions disabled for unsaved settings', async () => {
    await act(async () => root.render(<WeChatMPPanel />));
    const proxy = element.querySelector<HTMLInputElement>('input[placeholder="http://127.0.0.1:7890"]')!;
    const actions = element.querySelector('.settingsActions')!;
    expect(actions.contains(proxy)).toBe(false);
    const buttons = [...actions.querySelectorAll('button')];
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['wechatmp.save', 'wechatmp.test', 'wechatmp.detect']);
    expect(buttons.every(button => button.classList.contains('lbBtn'))).toBe(true);
    expect(buttons[0].disabled).toBe(true);
    await edit(proxy, 'http://127.0.0.1:7890');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[2].disabled).toBe(true);
    expect(element.querySelector('.settingsSectionHead button')?.classList.contains('lbBtn')).toBe(true);
  });
  it('marks edits dirty and saves through the host save handler without retaining a secret', async () => {
    const ref = createRef<WeChatMPPanelHandle>(), changed = vi.fn();
    await act(async () => root.render(<WeChatMPPanel ref={ref} onDirtyChange={changed} />));
    const secret = element.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(secret.value).toBe('');
    await edit(secret, 'new-secret');
    expect(changed).toHaveBeenLastCalledWith(true);
    bridge.saveWeChatMPConfig.mockResolvedValue({ app_id: 'wx-one', app_secret: '', proxy_url: '', secret_configured: true });
    await act(async () => { await ref.current!.save(); });
    expect(bridge.saveWeChatMPConfig.mock.calls[0][0].app_secret).toBe('new-secret');
    expect(secret.value).toBe('');
    expect(changed).toHaveBeenLastCalledWith(false);
    expect(element.textContent).not.toContain('new-secret');
  });

  it('keeps edits dirty when credential persistence fails and reports the failure to the host', async () => {
    const ref = createRef<WeChatMPPanelHandle>(), changed = vi.fn();
    await act(async () => root.render(<WeChatMPPanel ref={ref} onDirtyChange={changed} />));
    const input = element.querySelector<HTMLInputElement>('input[type=text]')!;
    await edit(input, 'wx-two');
    bridge.saveWeChatMPConfig.mockRejectedValue(new Error('credential-store unavailable'));
    await act(async () => { await expect(ref.current!.save()).rejects.toThrow('credential-store unavailable'); });
    expect(input.value).toBe('wx-two');
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(element.textContent).toContain('credential-store unavailable');
  });
});
