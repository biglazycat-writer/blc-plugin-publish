import sharp from 'sharp';
import { ProxyAgent, FormData, fetch as request } from 'undici';
import { isIP } from 'node:net';

export type Draft = {title:string;author?:string;content:string;digest?:string;thumb_media_id?:string;thumb_data_url?:string;thumb_url?:string;cover_crop_ratios?:string[];need_open_comment?:boolean;only_fans_can_comment?:boolean;images?:{placeholder:string;data_url:string}[]};
export class WeChatError extends Error { constructor(public code:number,message:string){super(`微信接口 ${code}: ${message}`)} }
const hints:Record<number,string>={40164:'请将出口 IP 加入公众号的 IP 白名单',40001:'AppSecret 无效或 access_token 已失效',40125:'AppSecret 无效',40013:'AppID 无效',48001:'账号未获得接口权限',45009:'接口调用次数已达上限',40113:'不支持的图片格式'};
export function centeredCrop(ratio:string,width:number,height:number){
 const target=ratio==='2.35_1'?2.35:ratio==='1_1'?1:0;if(!target||width<=0||height<=0)throw Error('封面尺寸或比例无效');
 const aspect=width/height;const x=aspect>target?(1-target/aspect)/2:0,y=aspect<=target?(1-aspect/target)/2:0;
 const coord=(v:number)=>String(Number(v.toFixed(6)));return{ratio,x1:coord(x),y1:coord(y),x2:coord(1-x),y2:coord(1-y)};
}
export function decodeImage(url:string){const match=/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);if(!match)throw Error('无效的图片数据');const data=Buffer.from(match[2],'base64');if(!data.length||data.length>20<<20)throw Error('图片必须在 20 MiB 以内');return data;}
export async function prepareImage(url:string,limit:number){
 const data=decodeImage(url),image=sharp(data,{limitInputPixels:40_000_000}),meta=await image.metadata();
 if((meta.format==='png'||meta.format==='jpeg')&&data.length<=limit)return{data,mime:meta.format==='png'?'image/png':'image/jpeg'};
 for(const size of [2000,1600,1200,900,640])for(const quality of [85,70,55]){const out=await image.clone().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality}).toBuffer();if(out.length<=limit)return{data:out,mime:'image/jpeg'};}
 throw Error('图片压缩后仍超过微信接口限制');
}
export async function echoIP(proxy:string,signal:AbortSignal,endpoints:string[]=['https://myip.ipip.net','https://api.ipify.org','https://ifconfig.me/ip']){
 if(proxy){const url=new URL(proxy);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('代理仅支持不含账号密码的 HTTP(S) 地址')}
 const dispatcher=proxy?new ProxyAgent(proxy):undefined;
 try{
  for(const endpoint of endpoints){signal.throwIfAborted();
   try{const r=await request(endpoint,{signal,dispatcher,redirect:'error',headers:{'user-agent':'blc-plugin-publish'}});if(!r.ok)continue;const text=(await r.text()).slice(0,4096);
    const ip=(text.match(/(?:\d{1,3}\.){3}\d{1,3}/g)??[]).find((s:string)=>isIP(s));if(ip)return{ip,via_proxy:!!proxy};
   }catch{signal.throwIfAborted()}
  }
  throw Error('未能获取出口 IP，请检查网络或插件代理设置');
 }finally{void dispatcher?.close()}
}
export class WeChatClient {
 private tokenValue='';private expires=0;private fetching?:Promise<string>;private dispatcher?:ProxyAgent;
 constructor(private appID:string,private secret:string,private proxy='',private base='https://api.weixin.qq.com'){
  if(proxy){const url=new URL(proxy);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('代理仅支持不含账号密码的 HTTP(S) 地址');this.dispatcher=new ProxyAgent(proxy)}
 }
 close(){void this.dispatcher?.close()}
 private redact(message:string){for(const value of [this.secret,this.tokenValue])if(value)message=message.split(value).join('[已隐藏]');return message.slice(0,500)}
 async json(path:string,body:unknown,signal:AbortSignal,auth=true){
  const token=auth?await this.token(signal):'';const url=new URL(path,this.base);if(token)url.searchParams.set('access_token',token);
  let response;try{response=await request(url,{method:body===undefined?'GET':'POST',headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal,dispatcher:this.dispatcher,redirect:'error'})}catch{signal.throwIfAborted();throw Error('连接微信接口失败，请检查网络或插件代理设置')}
  if(!response.ok)throw Error(`微信接口 HTTP ${response.status}`);
  const text=await response.text();if(text.length>2<<20)throw Error('微信接口响应过大');let data:any;try{data=JSON.parse(text)}catch{throw Error('微信接口返回无效 JSON')}
  if(data.errcode){const message=this.redact(String(data.errmsg??''));if([40001,40014,42001].includes(data.errcode)){this.tokenValue='';this.expires=0}throw new WeChatError(data.errcode,`${hints[data.errcode]??'请求失败'}；${message}`)}return data;
 }
 async token(signal:AbortSignal):Promise<string>{
  if(!this.appID||!this.secret)throw Error('请在插件的账号设置中填写 AppID 与 AppSecret');
  if(this.tokenValue&&Date.now()<this.expires)return this.tokenValue;
  if(!this.fetching)this.fetching=(async()=>{const q=new URLSearchParams({grant_type:'client_credential',appid:this.appID,secret:this.secret});const r=await this.json('/cgi-bin/token?'+q,undefined,signal,false);if(!r.access_token)throw Error('微信未返回 access_token');this.tokenValue=r.access_token;this.expires=Date.now()+Math.max(1,(r.expires_in??7200)-300)*1000;return this.tokenValue})().finally(()=>{this.fetching=undefined});
  return this.fetching;
 }
 async detectIP(signal:AbortSignal){this.tokenValue='';this.expires=0;try{await this.token(signal);return{ip:'',whitelisted:true,via_proxy:!!this.proxy,message:'当前出口已在白名单中'}}catch(error){if(!(error instanceof WeChatError)||error.code!==40164)throw error;const candidates=error.message.match(/(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{4,}/g)??[];const ip=candidates.find(s=>isIP(s));return{ip:ip??'',whitelisted:false,via_proxy:!!this.proxy,message:error.message}}}
 async upload(dataURL:string,cover:boolean,signal:AbortSignal){const{data,mime}=await prepareImage(dataURL,cover?10<<20:1<<20);const form=new FormData();form.set('media',new Blob([new Uint8Array(data)],{type:mime}),mime==='image/png'?'image.png':'image.jpg');const r=await this.json(cover?'/cgi-bin/material/add_material?type=image':'/cgi-bin/media/uploadimg',form,signal);if(cover?!r.media_id:!r.url)throw Error('微信未返回图片上传结果');return r;}
 async materials(offset:number,count:number,signal:AbortSignal){const r=await this.json('/cgi-bin/material/batchget_material',{type:'image',offset:Math.max(0,offset),count:Math.max(1,Math.min(20,count||20))},signal);return{items:r.item??[],total_count:r.total_count??0,item_count:r.item_count??0};}
 async downloadImage(url:string,signal:AbortSignal){
  if(url.startsWith('data:'))return decodeImage(url);const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw Error('图片地址必须为 HTTP(S)');
  const r=await request(parsed,{signal,dispatcher:this.dispatcher});if(!r.ok||!r.body)throw Error('封面图片读取失败');const parts:Uint8Array[]=[];let size=0;for await(const part of r.body){size+=part.length;if(size>20<<20)throw Error('图片超过 20 MiB');parts.push(part)}return Buffer.concat(parts);
 }
 async draft(incoming:Draft,signal:AbortSignal,progress:(n:number,message:string)=>Promise<void>=async()=>{}){
  const title=incoming.title?.trim();if(!title||[...title].length>64)throw Error('标题必须为 1–64 个字符');if(!incoming.content?.trim())throw Error('文章正文为空');
  if(!incoming.thumb_media_id&&!incoming.thumb_data_url)throw Error('请选择封面图片');
  let content=incoming.content;const images=[];let failed=0;
  for(const [index,img]of(incoming.images??[]).entries()){signal.throwIfAborted();await progress((index+1)/((incoming.images?.length??0)+3),'上传正文图片');try{const r=await this.upload(img.data_url,false,signal);content=content.split(img.placeholder).join(r.url);images.push({placeholder:img.placeholder,url:r.url,error:''})}catch(error){signal.throwIfAborted();failed++;images.push({placeholder:img.placeholder,url:'',error:String((error as Error).message)})}}
  let thumb=incoming.thumb_media_id??'',coverURL=incoming.thumb_url??'';if(!thumb){await progress(.8,'上传封面');const r=await this.upload(incoming.thumb_data_url!,true,signal);thumb=r.media_id;coverURL=r.url??''}
  const article:any={title,author:incoming.author?.trim()??'',digest:[...(incoming.digest?.trim()??'')].slice(0,120).join(''),content,thumb_media_id:thumb,need_open_comment:incoming.need_open_comment?1:0,only_fans_can_comment:incoming.only_fans_can_comment?1:0};
  let cropWarning='';if(incoming.cover_crop_ratios?.length){try{const data=await this.downloadImage(incoming.thumb_data_url||coverURL,signal);const{width,height}=await sharp(data,{limitInputPixels:40_000_000}).metadata();article.cover_info={crop_percent_list:[...new Set(incoming.cover_crop_ratios)].map(r=>centeredCrop(r,width!,height!))}}catch{signal.throwIfAborted();cropWarning=' 封面尺寸读取失败，微信将使用默认裁剪。'}}
  await progress(.95,'创建草稿');const r=await this.json('/cgi-bin/draft/add',{articles:[article]},signal);if(!r.media_id)throw Error('微信未返回草稿 ID');
  return{media_id:r.media_id,images,failed_images:failed,thumb_media_id:thumb,message:failed?`草稿已创建，${failed} 张正文图片上传失败，请在公众号后台补图。`+cropWarning:'草稿已创建，请在公众号后台预览确认后再发表。'+cropWarning};
 }
}
