import {parseThemeSource} from './theme-parse';
const files=import.meta.glob('../../themes/*.css',{query:'?raw',import:'default',eager:true}) as Record<string,string>;
const themes=Object.entries(files).map(([file,css])=>parseThemeSource(file.split('/').pop()!.replace('.css',''),css,true));
export function useThemes(){return themes}
