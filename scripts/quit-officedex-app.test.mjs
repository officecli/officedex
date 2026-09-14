import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./quit-officedex-app.js', import.meta.url), 'utf8');
function app({ id = 'com.wails.OfficeDex', bundle = '/Applications/OfficeDex.app', executable, exits = true, accepts = true, deferred = false } = {}) {
  let terminated = false;
  let requests = 0;
  return {
    bundleIdentifier: id,
    bundleURL: { path: bundle },
    executableURL: { path: executable ?? `${bundle}/Contents/MacOS/officedex` },
    processIdentifier: 123,
    get isTerminated() { return terminated; },
    get terminate() { requests++; if (exits && !deferred) terminated = true; return accepts; },
    get requests() { return requests; },
    advanceRunLoop() { if (requests && exits && deferred) terminated = true; },
  };
}
function harness(apps) {
  let now = 0;
  const context = vm.createContext({
    ObjC: { import() {}, unwrap: value => value },
    $: {
      NSWorkspace: { sharedWorkspace: { runningApplications: { count: apps.length, objectAtIndex: i => apps[i] } } },
      NSDate: { dateWithTimeIntervalSinceNow: seconds => now + seconds * 1000 },
      NSRunLoop: { currentRunLoop: { runUntilDate: date => {
        now = date;
        apps.forEach(a => a.advanceRunLoop());
      } } },
    },
    Date: { now: () => now },
    console: { log() {} },
  });
  vm.runInContext(source, context);
  return args => context.run(args ?? []);
}

test('does nothing when the application is absent', () => {
  assert.match(harness([])(), /no running/);
});
test('quits each verified bundle instance and waits for exit', () => {
  const installed = app();
  const built = app({ bundle: '/Workspace with spaces/officedex/build/bin/OfficeDex.app' });
  assert.match(harness([installed, built])(), /exited/);
  assert.equal(installed.requests, 1);
  assert.equal(built.requests, 1);
});
test('does not close similarly named apps or unbundled development processes', () => {
  const others = [app({ id: 'other.app' }), app({ bundle: '/Applications/Other.app' }), app({ executable: '/workspace/build/bin/officedex' })];
  assert.match(harness(others)(), /no running/);
  assert.ok(others.every(a => a.requests === 0));
});
test('check mode lists targets without requesting exit', () => {
  const target = app();
  assert.match(harness([target])(['--check']), /PID: 123/);
  assert.equal(target.requests, 0);
});
test('aborts on refusal instead of forcing termination', () => {
  const target = app({ exits: false, accepts: false });
  assert.throws(() => harness([target])(), /refused/);
  assert.equal(target.requests, 1);
});
test('aborts after a bounded wait when a quit request does not finish', () => {
  const target = app({ exits: false });
  assert.throws(() => harness([target])(), /15 seconds/);
  assert.equal(target.requests, 1);
});

test('advances the AppKit run loop to observe asynchronous termination', () => {
  const target = app({ deferred: true });
  assert.match(harness([target])(), /exited/);
  assert.equal(target.requests, 1);
  assert.equal(target.isTerminated, true);
});
