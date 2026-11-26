import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
test('declares the user features independently from RPC and provider operations',()=>{
 const spec=pkg.biglazycat;assert.equal(spec.minimumApiRevision,8);assert.equal(spec.icon,'lucide:send');assert.equal(pkg.engines.biglazycat,'>=0.4.11');assert.deepEqual(spec.contributes.features.map(f=>f.id),["publish"]);
 assert.equal(spec.contributes.menus,undefined);
 for(const feature of spec.contributes.features)for(const [location,action] of Object.entries(feature.actions)){
  assert.ok(['toolbar','editor','resource','sidebar'].includes(location));assert.equal(Object.keys(action).length,1);
  if(action.command)assert.ok(spec.contributes.commands.some(c=>c.id===action.command&&c.visibility!=='internal'));
  if(action.view)assert.ok(spec.contributes.views.some(v=>v.id===action.view));
  if(action.speech){assert.ok(['toolbar','editor'].includes(location));assert.ok(spec.contributes.providers.some(p=>p.id===action.speech&&p.contract==='speech.tts'));}
 }
});
