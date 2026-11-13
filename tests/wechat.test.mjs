import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import sharp from 'sharp';import {WeChatClient,centeredCrop,prepareImage} from '../dist/wechat.js';import plugin from '../dist/main.js';
const signal=()=>AbortSignal.timeout(10000);
test('official API flow caches token, separates body/cover endpoints and preserves HTML',async t=>{
 let tokens=0,article,uploads=[];const secret='fixture-secret';
 const png=await sharp({create:{width:400,height:200,channels:3,background:'#abcdef'}}).png().toBuffer();const dataURL='data:image/png;base64,'+png.toString('base64');
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/cgi-bin/token'){tokens++;assert.equal(url.searchParams.get('secret'),secret);res.end(JSON.stringify({access_token:'test-token',expires_in:7200}));return}
  assert.equal(url.searchParams.get('access_token'),'test-token');
  if(url.pathname==='/cgi-bin/media/uploadimg'){uploads.push('body');assert.match(body,/filename="image.png"/);res.end(JSON.stringify({url:'https://mmbiz.qpic.cn/body.png'}));return}
  if(url.pathname==='/cgi-bin/material/add_material'){uploads.push('cover');assert.equal(url.searchParams.get('type'),'image');res.end(JSON.stringify({media_id:'cover-1',url:'https://mmbiz.qpic.cn/cover.png'}));return}
  if(url.pathname==='/cgi-bin/material/batchget_material'){assert.equal(JSON.parse(body).count,20);res.end(JSON.stringify({item:[{media_id:'cover-1'}],total_count:1,item_count:1}));return}
  if(url.pathname==='/cgi-bin/draft/add'){article=JSON.parse(body).articles[0];res.end(JSON.stringify({media_id:'draft-1'}));return}res.writeHead(404).end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const client=new WeChatClient('wx-fixture',secret,'',`http://127.0.0.1:${server.address().port}`);t.after(()=>client.close());
 const result=await client.draft({title:'中文文章',content:'<p>正文 &amp; 图片</p><img src="original">',digest:'中'.repeat(130),thumb_data_url:dataURL,cover_crop_ratios:['2.35_1','1_1'],need_open_comment:true,images:[{placeholder:'original',data_url:dataURL}]},signal());
 assert.equal(tokens,1);assert.deepEqual(uploads,['body','cover']);assert.equal(result.media_id,'draft-1');assert.match(article.content,/<p>正文 &amp; 图片<\/p>/);assert.match(article.content,/https:\/\/mmbiz/);assert.equal([...article.digest].length,120);assert.equal(article.cover_info.crop_percent_list.length,2);assert.equal(article.need_open_comment,1);
 assert.equal((await client.materials(0,200,signal())).total_count,1);assert.equal(tokens,1);
});
test('cover crop bounds and image re-encoding',async()=>{assert.deepEqual(centeredCrop('1_1',400,200),{ratio:'1_1',x1:'.25'.replace(/^\./,'0.'),y1:'0',x2:'0.75',y2:'1'});assert.throws(()=>centeredCrop('other',1,1));const webp=await sharp({create:{width:200,height:100,channels:3,background:'#ffffff'}}).webp().toBuffer();const result=await prepareImage('data:image/webp;base64,'+webp.toString('base64'),1<<20);assert.equal(result.mime,'image/jpeg');assert.ok(result.data.length<1<<20)});
test('invalid draft fails before any network request',async()=>{const client=new WeChatClient('x','y');await assert.rejects(client.draft({title:'',content:'x'},signal()),/标题/);await assert.rejects(client.draft({title:'x',content:'x'},signal()),/封面/);client.close()});
test('plugin credentials stay out of account files and transfer payloads are ordered',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'blc-publish-'));const commands=new Map(),credentials=new Map();
 try{const dispose=await plugin.activate({pluginId:'blc-plugin-publish',apiVersion:1,dataDir:dir,commands:{register:(id,handler)=>commands.set(id,handler)},credentials:{get:async k=>credentials.get(k)??null,set:async(k,v)=>credentials.set(k,v),delete:async k=>credentials.delete(k)}});
 const saved=await commands.get('config.save')({app_id:'wx-one',app_secret:'SECRET'});assert.equal(saved.app_secret,'');assert.equal(saved.secret_configured,true);assert.doesNotMatch(await readFile(path.join(dir,'publishing/account.json'),'utf8'),/SECRET/);
 commands.get('transfer.put')({id:'draft-one',index:0,chunk:'{"articleText":"hello"}'});assert.throws(()=>commands.get('transfer.put')({id:'draft-one',index:0,chunk:'repeat'}),/顺序/);await commands.get('article.save')({transferId:'draft-one'});assert.equal(JSON.parse((await commands.get('article.read')()).chunk).articleText,'hello');
 const changed=await commands.get('config.save')({app_id:'wx-two'});assert.equal(changed.secret_configured,false);assert.equal(commands.size,11);dispose();
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('large publishing drafts restore across backend activation using bounded consistent segments',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'blc-publish-large-'));
 const commands=new Map(),context={pluginId:'blc-plugin-publish',apiVersion:1,dataDir:dir,commands:{register:(id,handler)=>commands.set(id,handler)},credentials:{get:async()=>null}};
 let dispose;
 try{
  dispose=await plugin.activate(context);
  const value={articleText:'中文😀\n"\\\u0000'.repeat(24000),publishTitle:'大稿件',coverImage:'data:image/png;base64,'+'A'.repeat(1500000)};
  const text=JSON.stringify(value);assert.ok(Buffer.byteLength(text)>1<<20);
  for(let offset=0,index=0;offset<text.length;offset+=96*1024,index++)commands.get('transfer.put')({id:'large-draft',index,chunk:text.slice(offset,offset+96*1024)});
  await commands.get('article.save')({draftKey:'large',transferId:'large-draft'});
  await dispose();dispose=await plugin.activate(context);
  let restored='',hash='',segments=0;
  for(;;){const part=await commands.get('article.read')({draftKey:'large',offset:restored.length,hash});assert.ok(part.chunk.length<=96*1024);assert.ok(Buffer.byteLength(JSON.stringify(part))<1<<20);if(hash)assert.equal(part.hash,hash);hash=part.hash;restored+=part.chunk;segments++;if(restored.length===part.total)break}
  assert.ok(segments>10);assert.deepEqual(JSON.parse(restored),value);
  for(const args of [{offset:-1},{limit:0},{limit:96*1024+1},{offset:1},{offset:1,hash:'changed'},{offset:text.length+1,hash}])await assert.rejects(commands.get('article.read')({draftKey:'large',...args}),/范围|变更/);
  commands.get('transfer.put')({id:'changed-draft',index:0,chunk:'{"articleText":"changed"}'});
  await commands.get('article.save')({draftKey:'large',transferId:'changed-draft'});
  await assert.rejects(commands.get('article.read')({draftKey:'large',offset:1,hash}),/变更/);
 }finally{await dispose?.();await rm(dir,{recursive:true,force:true})}
});
test('transfer total is limited by UTF-8 bytes and overflow invalidates the partial payload',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'blc-publish-limit-')),commands=new Map();let dispose;
 try{
  dispose=await plugin.activate({pluginId:'blc-plugin-publish',apiVersion:1,dataDir:dir,commands:{register:(id,handler)=>commands.set(id,handler)}});
  const chunk='中'.repeat(128*1024),accepted=Math.floor((32<<20)/Buffer.byteLength(chunk));
  for(let index=0;index<accepted;index++)commands.get('transfer.put')({id:'overflow',index,chunk});
  assert.throws(()=>commands.get('transfer.put')({id:'overflow',index:accepted,chunk}),/32 MiB/);
  await assert.rejects(commands.get('article.save')({transferId:'overflow'}),/失效/);
 }finally{await dispose?.();await rm(dir,{recursive:true,force:true})}
});
