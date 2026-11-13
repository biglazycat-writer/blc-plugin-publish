import i18next from 'i18next';
export const wt=(key:string,options?:Record<string,unknown>)=>String(i18next.t(key,{ns:'writing',...options}));
