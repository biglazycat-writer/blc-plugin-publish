import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ commands: { invoke: vi.fn() }, tasks: { get: vi.fn() } }));
vi.mock('blc-plugin-sdk/browser', () => ({ connect: async () => mock }));
import { invoke } from './publishing-api';
beforeEach(() => { vi.useRealTimers(); mock.commands.invoke.mockReset().mockResolvedValue({ id: 'one' }); mock.tasks.get.mockReset(); });
it('keeps task failure codes without replaying the command', async () => {
  mock.tasks.get.mockResolvedValue({ id: 'one', state: 'failed', errorCode: 'DRAFT_CONFLICT', error: 'changed' });
  await expect(invoke('draft.create')).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  expect(mock.commands.invoke).toHaveBeenCalledTimes(1);
});
it('bounds waiting even if the task query hangs', async () => {
  vi.useFakeTimers();
  mock.tasks.get.mockReturnValue(new Promise(() => {}));
  const check = expect(invoke('draft.create')).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(300000);
  await check;
  expect(mock.commands.invoke).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
