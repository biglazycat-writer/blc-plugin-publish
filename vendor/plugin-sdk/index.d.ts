export const apiVersion: 1;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface InvocationContext {
  source: string; workspaceId?: string; workspaceSession?: string; windowId?: string;
  editorId?: string; documentId?: string; revision?: string; selection?: string;
  sessionId?: string; resource?: string;
}
export interface Invocation extends InvocationContext {
  signal: AbortSignal; invocationId: string; taskId?: string;
  progress(value: number, message?: string): Promise<void>;
}
export interface DocumentTarget { workspaceId: string; workspaceSession: string; documentId: string; editorId: string; windowId?: string }
export interface DocumentSnapshot extends DocumentTarget { content: string; format: 'markdown' | 'tiptap'; revision: string; draftHash: string; dirty: boolean }
export interface DocumentChange extends DocumentTarget { operationId: string; revision: string; draftHash: string; content: string }
export interface Operation { operationId: string; state: 'pending' | 'completed' | 'failed' | 'uncertain'; result?: Json; error?: string }
export interface ResourceRequest { workspaceId: string; workspaceSession: string; path?: string; query?: string; offset?: number; limit?: number; content?: string; expectedHash?: string; operationId?: string }
export interface Resource { path: string; name: string; kind: string; size?: number }
export interface Task { id: string; pluginId: string; version: string; generation: string; command: string; context: InvocationContext; state: 'waiting'|'running'|'cancelling'|'completed'|'failed'|'cancelled'|'interrupted'|'uncertain'; progress: number; hasResult: boolean; result?: Json; error?: string }
export interface ViewOptions { location?: 'tab'|'panel'|'window'; context?: InvocationContext; state?: Json; instanceId?: string }
export interface ViewSession { pluginId: string; viewId: string; instanceId: string; title: string; location: string; context: InvocationContext; state?: Json; dirty: boolean; connected: boolean; theme?: Record<string,string> }
export interface SharedAPI {
  images: { list(request?: {query?:string;offset?:number;limit?:number;workspaceId?:string;workspaceSession?:string}): Promise<{items:{id:string;name:string;src:string;width:number;height:number}[];total:number}>; read(request:{src:string;offset?:number;limit?:number;hash?:string;workspaceId?:string;workspaceSession?:string}): Promise<{chunk:string;total:number;hash:string}> };
  workspace: { list(): Promise<Json>; resources(request: ResourceRequest): Promise<Json>; read(request: ResourceRequest): Promise<Json>; search(request: ResourceRequest): Promise<Json>; import(request: ResourceRequest): Promise<Json> };
  documents: { snapshot(target: DocumentTarget): Promise<DocumentSnapshot>; apply(change: DocumentChange): Promise<Operation>; operation(operationId: string): Promise<Operation> };
  storage: { get(key: string, workspaceId?: string): Promise<Json>; set(key: string, value: Json, workspaceId?: string): Promise<void> };
  views: { open(view: string, options?: ViewOptions): Promise<ViewSession> };
  ui: { notify(message: string): Promise<void>; openFile(options?: Json): Promise<string>; saveFile(options?: Json): Promise<string>; openExternal(url: string): Promise<void> };
}
export interface PluginContext extends SharedAPI {
  apiVersion: 1; pluginId: string; generation: string; dataDir: string;
  views: SharedAPI['views'] & { close(instanceId: string): Promise<void> };
  commands: { register(id: string, handler: (args: any, invocation: Invocation) => unknown | Promise<unknown>): void };
  services: { provide(id: string, methods: Record<string,(args: any, invocation: Invocation) => unknown|Promise<unknown>>): void; call(plugin: string, service: string, method: string, args: Json, invocation?: Invocation): Promise<Json>; list(): Promise<Json> };
  events: { on(name: string, handler: (event: {id:string;name:string;workspaceId:string;payload:Json}, context: {signal:AbortSignal}) => void|Promise<void>): void; emit(name: string, payload: Json): Promise<void> };
  credentials: { get(key: string): Promise<string|null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> };
  ai: { run(request: { conversationId: string; text: string }): Promise<Json> };
}
export function definePlugin(activate: (context: PluginContext) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>): { activate: typeof activate };
