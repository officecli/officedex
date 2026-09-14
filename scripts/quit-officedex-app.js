// Run with osascript -l JavaScript. NSRunningApplication sends a normal quit
// request to an existing process; unlike `tell application`, it cannot launch
// an app that is not running. Never terminate by executable name alone.
ObjC.import('AppKit');
ObjC.import('Foundation');

function isOfficeDexApp(app) {
  if (ObjC.unwrap(app.bundleIdentifier) !== 'com.wails.OfficeDex') return false;
  var bundle = ObjC.unwrap(app.bundleURL.path);
  var executable = ObjC.unwrap(app.executableURL.path);
  return typeof bundle === 'string' && /\/OfficeDex\.app$/.test(bundle)
    && executable === bundle + '/Contents/MacOS/officedex';
}

function run(argv) {
  var applications = $.NSWorkspace.sharedWorkspace.runningApplications;
  var targets = [];
  for (var i = 0; i < applications.count; i++) {
    var app = applications.objectAtIndex(i);
    if (isOfficeDexApp(app)) targets.push(app);
  }
  if (targets.length === 0) return '[build-local-latest] no running OfficeDex.app';
  var pids = targets.map(function (app) { return app.processIdentifier; }).join(', ');
  if (argv.indexOf('--check') !== -1) {
    return '[build-local-latest] running OfficeDex.app PID: ' + pids;
  }
  console.log('[build-local-latest] asking OfficeDex.app to quit (PID: ' + pids + ')');
  targets.forEach(function (app) {
    if (!app.isTerminated && !app.terminate && !app.isTerminated) {
      throw new Error('OfficeDex refused to quit. Build cancelled; no processes were force-stopped.');
    }
  });
  var deadline = Date.now() + 15000;
  while (targets.some(function (app) { return !app.isTerminated; })) {
    if (Date.now() >= deadline) {
      throw new Error('OfficeDex did not exit within 15 seconds. Resolve any pending exit dialog and retry. Build cancelled.');
    }
    // AppKit updates isTerminated only when the main run loop advances.
    // Sleeping the thread leaves the cached value false after the process exits.
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
  return '[build-local-latest] OfficeDex.app exited';
}
