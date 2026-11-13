import type { SharedAPI, Json, Task, ViewSession } from './index.js';
export interface BrowserAPI extends SharedAPI {
  onSave(handler: () => void | Promise<void>): () => void;
  context(): Promise<ViewSession>;
  setState(state: Json, dirty?: boolean): Promise<void>;
  commands: { invoke(command: string, args?: Json): Promise<Task> };
  tasks: { list(): Promise<Omit<Task, 'result'>[]>; get(id: string): Promise<Task>; cancel(id: string): Promise<void> };
}
export function connect(): Promise<BrowserAPI>;
