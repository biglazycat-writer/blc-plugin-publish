import {definePlugin, type Json, type PluginContext, type Invocation} from '@biglazycat/plugin-sdk';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {WeChatClient, type Draft} from './wechat.js';

export default definePlugin(async(ctx:PluginContext)=>{
 let client:WeChatClient|undefined;
 const transfers=new Map<string,{chunks:string[];size:number;time:number}>();
 const data=path.join(ctx.dataDir,'publishing');await mkdir(data,{recursive:true});
 const load=async(name:string,fallback:any)=>{try{return JSON.parse(await readFile(path.join(data,name),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e}};
 const serialize=(value:any)=>{const text=JSON.stringify(value);if(Buffer.byteLength(text,'utf8')>32<<20)throw Error('发布内容超过 32 MiB');return text};
 const save=async(name:string,value:any)=>{const text=serialize(value),temp=path.join(data,randomUUID()+'.tmp');await writeFile(temp,text,{mode:0o600});await rename(temp,path.join(data,name));};
 const config=async()=>{const c=await load('account.json',{});return{app_id:c.app_id??'',app_secret:'',proxy_url:c.proxy_url??'',secret_configured:!!await ctx.credentials.get('wechat-app-secret'),account_name:'',default_author:'',last_verified_at:c.last_verified_at??'',last_error:''}};
 const connection=async()=>{if(!client){const c=await load('account.json',{});client=new WeChatClient(c.app_id??'',await ctx.credentials.get('wechat-app-secret')??'',c.proxy_url??'')}return client};
 const signal=(inv:Invocation)=>AbortSignal.any([inv.signal,AbortSignal.timeout(300000)]);
 const consume=(id:string)=>{const transfer=transfers.get(id);if(!transfer)throw Error('传输已失效，请重新提交');transfers.delete(id);return JSON.parse(transfer.chunks.join(''))};
 ctx.commands.register('transfer.put',args=>{
  for(const[id,t]of transfers)if(Date.now()-t.time>300000)transfers.delete(id);
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(args.id)||typeof args.chunk!=='string'||args.chunk.length>128<<10)throw Error('无效的传输片段');
  let transfer=transfers.get(args.id);if(!transfer){if(args.index!==0||transfers.size>=4)throw Error('传输顺序无效或队列已满');transfer={chunks:[],size:0,time:Date.now()};transfers.set(args.id,transfer)}
  if(args.index!==transfer.chunks.length)throw Error('传输顺序不一致');
  const size=Buffer.byteLength(args.chunk,'utf8');
  if(transfer.size+size>32<<20){transfers.delete(args.id);throw Error('发布内容超过 32 MiB')}
  transfer.chunks.push(args.chunk);transfer.size+=size;transfer.time=Date.now();return{received:transfer.chunks.length};
 });
 ctx.commands.register('config.read',config);
 ctx.commands.register('config.save',async(args)=>{
  const old=await load('account.json',{});const appID=String(args.app_id??'').trim();if(!appID)throw Error('请填写 AppID');
  const proxy=String(args.proxy_url??'').trim();new WeChatClient(appID,'',proxy).close();
  if(args.clearSecret||old.app_id&&old.app_id!==appID)await ctx.credentials.delete('wechat-app-secret');
  if(args.app_secret)await ctx.credentials.set('wechat-app-secret',String(args.app_secret).trim());
  await save('account.json',{app_id:appID,proxy_url:proxy});client?.close();client=undefined;return config();
 });
 ctx.commands.register('connection.test',async(_,inv)=>{await(await connection()).token(signal(inv));const c=await load('account.json',{});await save('account.json',{...c,last_verified_at:new Date().toISOString()});return config()});
 ctx.commands.register('connection.ip',async(_,inv)=>(await connection()).detectIP(signal(inv)));
 ctx.commands.register('materials.list',async(args,inv)=>(await connection()).materials(args.offset??0,args.count??20,signal(inv)));
 ctx.commands.register('draft.create',async(args,inv)=>{const draft=consume(args.transferId) as Draft;return(await connection()).draft(draft,signal(inv),(n,message)=>inv.progress(n,message))});
 const articleFile=(key='default')=>{if(!/^[a-zA-Z0-9-]{1,80}$/.test(key))throw Error('无效的发布稿标识');return 'article-'+key+'.json'};
 ctx.commands.register('article.save',async(args)=>{await save(articleFile(args.draftKey),consume(args.transferId));return{saved:true}});
 ctx.commands.register('article.read',async(args={})=>{
  const offset=args.offset??0,limit=args.limit??96*1024;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>96*1024)throw Error('无效的发布稿片段范围');
  const text=serialize(await load(articleFile(args.draftKey),{articleText:'',publishTitle:''}));
  const hash=createHash('sha256').update(text).digest('hex');
  if(offset>text.length)throw Error('无效的发布稿片段范围');
  if(offset>0&&args.hash!==hash||args.hash&&args.hash!==hash)throw Error('发布稿已变更，请重新读取');
  return{chunk:text.slice(offset,offset+limit),total:text.length,hash};
 });
 ctx.commands.register('publish.open',async(_,inv)=>{
  const draftKey=randomUUID();
  if(inv.documentId&&inv.editorId&&inv.workspaceId&&inv.workspaceSession){const snapshot=await ctx.documents.snapshot({workspaceId:inv.workspaceId,workspaceSession:inv.workspaceSession,documentId:inv.documentId,editorId:inv.editorId,windowId:inv.windowId});await save(articleFile(draftKey),{articleText:snapshot.content,format:snapshot.format,publishTitle:''})}
  return ctx.views.open('publish',{context:inv,state:{draftKey} as Json});
 });
 ctx.commands.register('debug.status',async()=>({pluginId:ctx.pluginId,apiVersion:ctx.apiVersion,accountConfigured:!!(await config()).secret_configured,commands:11,publicPublishing:false}));
 return()=>{client?.close();transfers.clear()};
});
