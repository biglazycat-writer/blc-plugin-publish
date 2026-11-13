import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useScheduledValue } from './use-scheduled-value';
afterEach(() => vi.useRealTimers());
it('paints the shell before computing and drops obsolete preview requests while typing', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const calls: string[] = [], element = document.createElement('div'), root = createRoot(element);
  function Preview({ text }: { text: string }) {
    const result = useScheduledValue(() => { calls.push(text); return text.toUpperCase(); }, [text], '');
    return <div><span>发布页面</span><button disabled={result.pending}>发布</button><output>{result.value}</output></div>;
  }
  await act(async () => root.render(<Preview text="first" />));
  expect(element.textContent).toContain('发布页面'); expect(calls).toEqual([]);
  expect(element.querySelector('button')?.disabled).toBe(true);
  await act(async () => root.render(<Preview text="latest" />));
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(calls).toEqual(['latest']); expect(element.querySelector('output')?.textContent).toBe('LATEST');
  expect(element.querySelector('button')?.disabled).toBe(false);
  await act(async () => root.render(<Preview text="closed" />));
  await act(async () => root.unmount());
  await vi.advanceTimersByTimeAsync(100); expect(calls).toEqual(['latest']);
});
