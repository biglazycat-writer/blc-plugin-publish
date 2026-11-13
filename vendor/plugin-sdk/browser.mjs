/** The bridge is served by the installed host; no Wails globals enter a page. */
export async function connect() {
  const config = globalThis.__biglazycatPlugin;
  if (!config || config.apiVersion !== 1) throw new Error('API_MISMATCH: 在大懒猫创作平台中打开此插件页面');
  const url = new URL('__sdk.mjs', config.endpoint).href;
  const bridge = await import(/* @vite-ignore */ url);
  return bridge.connect();
}
