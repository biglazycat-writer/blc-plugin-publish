import './style.css';
const element = document.getElementById('root')!;
element.textContent = '正在打开公众号插件…';
element.setAttribute('role', 'status');
void import('./App').then(module => {
  element.removeAttribute('role');
  module.mount(element);
}).catch(async error => {
  element.setAttribute('role', 'alert');
  element.textContent = '公众号插件打开失败：' + String(error instanceof Error ? error.message : error);
  try { const { sdk } = await import('./bridge/publishing-api'); await sdk.ready(); } catch { /* Host displays a connection timeout. */ }
});
