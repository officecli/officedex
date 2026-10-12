import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProcesses, parseProcesses } from './verify-running-engine.mjs';

const app = '/test builds/OfficeDex.app/Contents/MacOS/officedex';
const engine = '/test builds/OfficeDex.app/Contents/Resources/officecli/officecli';
const rows = (...children) => parseProcesses(`10 1 ${app}\n${children.join('\n')}`);

test('verifies the selected app and its actual bundled child, including paths with spaces', () => {
  const result = checkProcesses(rows(`11 10 ${engine}`, '99 1 /other/officecli'), 10, app, engine);
  assert.deepEqual(result.engines.map(p => p.pid), [11]);
});
test('rejects an old override even when a valid bundled engine also runs', () => {
  assert.throws(() => checkProcesses(rows(`11 10 ${engine}`, '12 10 /checkout/officecli'), 10, app, engine), /outside/);
});
test('does not mistake an unrelated engine or an app without an engine for a pass', () => {
  assert.throws(() => checkProcesses(rows(`11 1 ${engine}`), 10, app, engine), /No running/);
  assert.throws(() => checkProcesses(rows(`11 10 ${engine}`), 999, app, engine), /App PID/);
});
test('follows descendants and rejects an old engine behind a wrapper', () => {
  assert.throws(() => checkProcesses(rows('11 10 /bin/sh', '12 11 /checkout/officecli'), 10, app, engine), /outside/);
});
