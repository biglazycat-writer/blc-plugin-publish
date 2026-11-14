import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import plugin from '../dist/main.js';

test('opening the page directly initializes the current document once and preserves its draft', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'blc-direct-page-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const commands=new Map();let exports=0;
  const content='当前文章',bytes=Buffer.from(content),hash=createHash('sha256').update(content).digest('hex');
  const dispose=await plugin.activate({dataDir:dir,commands:{register:(id,handler)=>commands.set(id,handler)},documents:{export:async()=>{
    exports++;return{exportId:'snapshot',format:'markdown',formatVersion:1,chunk:content,offset:0,nextOffset:bytes.length,totalBytes:bytes.length,hash,revision:'1',draftHash:'draft',dirty:true};
  }}});
  t.after(dispose);
  const invocation={workspaceId:'w',workspaceSession:'s',documentId:'d',editorId:'e',signal:new AbortController().signal};
  const first=await commands.get('article.read')({draftKey:'page-one'},invocation);
  assert.equal(JSON.parse(first.chunk).articleText,content);
  const reopened=await commands.get('article.read')({draftKey:'page-one'},invocation);
  assert.equal(reopened.chunk,first.chunk);assert.equal(exports,1);
});

test('the command palette contains only publishing and account settings', async () => {
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const contributions=pkg.biglazycat.contributes;
  assert.deepEqual(contributions.commands.filter(command=>command.visibility!=='internal').map(command=>command.id),['publish.open']);
  assert.deepEqual(contributions.views.filter(view=>view.commandPalette!==false).map(view=>view.id),['settings']);
  assert.equal(contributions.commands.find(command=>command.id==='debug.status').aiCallable,true);
  assert.equal(pkg.biglazycat.minimumApiRevision,3);
});

test('publish opens an immutable Markdown export without parsing host editor JSON', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'blc-export-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const commands=new Map();
  const content='猫😀\n'.repeat(25000), bytes=Buffer.from(content), hash=createHash('sha256').update(content).digest('hex');
  const offsets=[];
  let opened;
  const dispose=await plugin.activate({dataDir:dir,commands:{register:(id,fn)=>commands.set(id,fn)},documents:{
    snapshot(){ throw Error('internal editor JSON must not be read'); },
    async export(request){
      offsets.push(request.offset);
      const end=Math.min(request.offset+80000,bytes.length);
      return {exportId:'export',format:'markdown',formatVersion:1,chunk:bytes.subarray(request.offset,end).toString(),offset:request.offset,nextOffset:end,totalBytes:bytes.length,hash,revision:'9',draftHash:'draft',dirty:true};
    },
  },views:{open:async(_,options)=>{opened=options;return options;}}});
  t.after(dispose);
  const inv={workspaceId:'w',workspaceSession:'s',documentId:'d',editorId:'e',signal:new AbortController().signal};
  await commands.get('publish.open')({},inv);
  assert.deepEqual(offsets,[0,80000,160000]);
  const stored=JSON.parse(await readFile(path.join(dir,'publishing',`article-${opened.state.draftKey}.json`),'utf8'));
  assert.equal(stored.articleText,content);
  assert.equal(stored.format,'markdown');
});
