import {useSyncExternalStore} from 'react';
const listeners=new Set<()=>void>();
export function setThemeId(id:string){localStorage.setItem('publish-theme',id);for(const listener of listeners)listener()}
export function useThemeId(){const themeId=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>localStorage.getItem('publish-theme')??'githubMarkdown');return{themeId}}
