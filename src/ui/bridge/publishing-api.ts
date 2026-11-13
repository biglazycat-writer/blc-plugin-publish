import {connect} from '@biglazycat/plugin-sdk/browser';
import type {Json} from '@biglazycat/plugin-sdk';
import type {WeChatMPConfig,WeChatMPDraftInput,WeChatMPDraftResult,WeChatMPEgressIP,WeChatMPMaterialPage} from '../types/models';
export const sdk=await connect();
export async function invoke<T=unknown>(command:string,args:Json={}):Promise<T>{
 const task=await sdk.commands.invoke(command,args);
 for(;;){const current=await sdk.tasks.get(task.id);if(current.state==='completed')return current.result as T;if(['failed','cancelled','interrupted','uncertain'].includes(current.state))throw Error(current.error??current.state);await new Promise(resolve=>setTimeout(resolve,150))}
}
export async function transfer(value:unknown){const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>32<<20)throw Error('发布内容超过 32 MiB');const id=crypto.randomUUID();for(let offset=0,index=0;offset<text.length;offset+=96*1024,index++)await invoke('transfer.put',{id,index,chunk:text.slice(offset,offset+96*1024)});return id;}
export async function readArticle<T>(draftKey:string):Promise<T>{let text='',hash='';for(;;){const part=await invoke<{chunk:string;total:number;hash:string}>('article.read',{draftKey,offset:text.length,hash});if(part.total>32<<20||!part.chunk&&text.length<part.total)throw Error('无效的发布稿片段');hash=part.hash;text+=part.chunk;if(text.length>=part.total)return JSON.parse(text) as T;}}
export async function readImage(src:string){if(src.startsWith('data:'))return src;let result='',hash='';for(;;){const part=await sdk.images.read({src,offset:result.length,hash});hash=part.hash;result+=part.chunk;if(result.length>=part.total)return result;}}
export const publishingApi={
 getWeChatMPConfig:()=>invoke<WeChatMPConfig>('config.read'),
 saveWeChatMPConfig:(value:WeChatMPConfig,clearSecret:boolean)=>invoke<WeChatMPConfig>('config.save',{...value,clearSecret}),
 testWeChatMPConnection:()=>invoke<WeChatMPConfig>('connection.test'),
 detectWeChatMPEgressIP:()=>invoke<WeChatMPEgressIP>('connection.ip'),
 listWeChatMPMaterial:(offset:number,count:number)=>invoke<WeChatMPMaterialPage>('materials.list',{offset,count}),
 createWeChatMPDraft:async(value:WeChatMPDraftInput)=>invoke<WeChatMPDraftResult>('draft.create',{transferId:await transfer(value)}),
 readImageAsDataURL:readImage,
};
