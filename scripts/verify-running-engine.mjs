import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inspect executable names only: process arguments/environment may hold secrets.
export function parseProcesses(text) {
  return text.split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), executable: m[3] }] : [];
  });
}

export function checkProcesses(processes, appPID, appExecutable, engineExecutable) {
  const app = processes.find(p => p.pid === appPID);
  if (!app || app.executable !== appExecutable) throw new Error('App PID does not match the requested bundle executable');
  const descendants = new Set([appPID]);
  for (let previous = -1; previous !== descendants.size;) {
    previous = descendants.size;
    for (const p of processes) if (descendants.has(p.ppid)) descendants.add(p.pid);
  }
  const engines = processes.filter(p => descendants.has(p.pid) && path.basename(p.executable) === 'officecli');
  if (!engines.length) throw new Error('No running OfficeCLI child: trigger an engine operation in the app, then retry');
  const wrong = engines.filter(p => p.executable !== engineExecutable);
  if (wrong.length) throw new Error(`Running engine is outside the requested bundle: ${wrong.map(p => `${p.pid}: ${p.executable}`).join(', ')}`);
  return { app, engines };
}

export function verifyRunningEngine({ appPath, pid, settingsPath, expectedVersion }) {
  if (process.platform !== 'darwin') throw new Error('This packaged-app check requires macOS');
  const bundle = realpathSync(appPath);
  const plist = path.join(bundle, 'Contents/Info.plist');
  const plistValue = key => execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  const version = plistValue('CFBundleShortVersionString');
  if (version !== expectedVersion) throw new Error(`Expected OfficeDex ${expectedVersion}, found ${version}`);
  const appExecutable = realpathSync(path.join(bundle, 'Contents/MacOS', plistValue('CFBundleExecutable')));
  const engineExecutable = realpathSync(path.join(bundle, 'Contents/Resources/officecli/officecli'));
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  if (settings.bridgeBinaryPath?.trim()) throw new Error('bridgeBinaryPath override is set; clear it before packaged-app acceptance');
  const snapshot = () => parseProcesses(execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }));
  const before = checkProcesses(snapshot(), pid, appExecutable, engineExecutable);
  const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const appSHA256 = sha256(appExecutable);
  const engineSHA256 = sha256(engineExecutable);
  const engineVersion = execFileSync(engineExecutable, ['version'], { encoding: 'utf8', timeout: 15000 }).trim();
  const after = checkProcesses(snapshot(), pid, appExecutable, engineExecutable);
  if (!before.engines.some(p => after.engines.some(q => q.pid === p.pid))) throw new Error('Engine restarted during verification; retry');
  return { result: 'passed', checkedAt: new Date().toISOString(), appVersion: version, app: after.app,
    engines: after.engines, appSHA256, engineSHA256, engineVersion, settingsPath, bridgeBinaryPath: null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--app', '--pid', '--settings', '--expected-version', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid arguments');
      values[args[i]] = args[i + 1];
    }
    const pid = Number(values['--pid']);
    if (!values['--app'] || !values['--settings'] || !values['--expected-version'] || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error('Usage: node scripts/verify-running-engine.mjs --app <bundle> --pid <app PID> --settings <active settings.json> --expected-version <x.y.z> [--out <report.json>]');
    }
    const report = verifyRunningEngine({ appPath: values['--app'], pid, settingsPath: values['--settings'], expectedVersion: values['--expected-version'] });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (values['--out']) writeFileSync(values['--out'], json);
    console.log(json.trim());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
