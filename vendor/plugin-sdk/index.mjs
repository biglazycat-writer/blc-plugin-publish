export const apiVersion = 1;
export function definePlugin(activate) {
  if (typeof activate !== 'function') throw new TypeError('definePlugin expects activate(context)');
  return { activate };
}
