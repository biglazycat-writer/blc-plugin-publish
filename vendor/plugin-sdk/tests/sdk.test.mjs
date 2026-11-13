import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { apiVersion, definePlugin } from '../index.mjs';
import { connect } from '../browser.mjs';

test('standard plugin activation preserves cleanup', async () => {
  let called = 0;
  const plugin = definePlugin(ctx => { ctx.register(); return () => called++; });
  const dispose = await plugin.activate({ register: () => called++ });
  assert.equal(called, 1); dispose(); assert.equal(called, 2);
  assert.equal(apiVersion, 1);
  assert.throws(() => definePlugin(null), TypeError);
});
test('browser entry refuses a host without the matching bridge', async () => {
  await assert.rejects(connect(), /API_MISMATCH|插件页面/);
});
test('manifest publishes only versioned extension points', async () => {
  const schema = JSON.parse(await readFile(new URL('../manifest.schema.json', import.meta.url)));
  assert.equal(schema.properties.apiVersion.const, apiVersion);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.contributes.additionalProperties, false);
  assert.deepEqual(schema.$defs.argumentSchema.required, ['type']);
  assert.deepEqual(Object.keys(schema.properties.contributes.properties).sort(), ['commands','editors','menus','providers','schedules','services','views']);
});
