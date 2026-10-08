// Run with osascript -l JavaScript. NSRunningApplication sends a normal quit
// request to an existing process; unlike `tell application`, it cannot launch
// an app that is not running. Never terminate by executable name alone.
ObjC.import('AppKit');
ObjC.import('Foundation');

// Every bundle this repository builds. Both interfaces ship as separate apps
// with separate identifiers, and a rebuild has to quit whichever is running —
// matching only the shell's identifier left a legacy build replacing a bundle
// that was open, which macOS handles by keeping the deleted one running.
var OFFICEDEX_BUNDLES = [
  { identifier: 'com.wails.OfficeDex', bundle: /\/OfficeDex\.app$/ },
  { identifier: 'com.wails.OfficeDexLegacy', bundle: /\/OfficeDex Legacy\.app$/ },
];

function isOfficeDexApp(app) {
  var identifier = ObjC.unwrap(app.bundleIdentifier);
  var known = OFFICEDEX_BUNDLES.filter(function (entry) { return entry.identifier === identifier; })[0];
  if (!known) return false;
  var bundle = ObjC.unwrap(app.bundleURL.path);
  var executable = ObjC.unwrap(app.executableURL.path);
  return typeof bundle === 'string' && known.bundle.test(bundle)
    && executable === bundle + '/Contents/MacOS/officedex';
}

function isRunningApplication(bundleIdentifier) {
  var applications = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (var i = 0; i < applications.count; i++) {
    if (ObjC.unwrap(applications.objectAtIndex(i).bundleIdentifier) === bundleIdentifier) return true;
  }
  return false;
}

// Whether an Apple event can leave this process at all. A sandbox (sandbox-exec,
// e.g. DSH's workspace-write mode) denies appleevent-send, and
// NSRunningApplication.terminate() only POSTS the quit event without waiting for
// a reply: it still returns true while the event is dropped, so inside a sandbox
// this script always walks into the 15-second timeout below. That timeout has
// nothing to do with "a pending exit dialog", which is what the message used to
// claim — so probe first and fail with something actionable instead.
// The probe MUST round-trip to the other process: Application('Finder').name()
// is answered from cached local metadata and succeeds even inside a sandbox,
// while startupDisk() has to ask Finder and is therefore a real detector.
// Finder is resident on any normal Mac and is only queried when already running,
// so Application() can never launch an app that is not running — the exact
// hazard this script avoids `tell application` for.
function detectAppleEventFailure() {
  if (!isRunningApplication('com.apple.finder')) return null;
  try {
    Application('Finder').startupDisk().name();
    return null;
  } catch (error) {
    return String((error && (error.message || error.toString())) || error);
  }
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
  // Probe before claiming we asked anything: if Apple events cannot leave this
  // process, the quit request would be dropped and we would blame a dialog that
  // does not exist.
  var appleEventFailure = detectAppleEventFailure();
  if (appleEventFailure !== null) {
    throw new Error('Apple events cannot leave this process, so the quit request can never reach OfficeDex.app '
      + '(probe: ' + appleEventFailure + '). The usual cause is a sandbox (DSH workspace-write mode, sandbox-exec), '
      + 'which drops the event silently while NSRunningApplication.terminate() still reports success. Re-run with '
      + 'full access (or from Terminal.app), or quit OfficeDex.app yourself first — this step is then skipped entirely. '
      + 'Build cancelled; no processes were force-stopped.');
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
      throw new Error('OfficeDex did not exit within 15 seconds. Resolve any pending exit dialog and retry. Build cancelled.'
        + ' (The quit request WAS delivered — Apple events work in this process — so the app itself is holding exit.)');
    }
    // AppKit updates isTerminated only when the main run loop advances.
    // Sleeping the thread leaves the cached value false after the process exits.
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
  return '[build-local-latest] OfficeDex.app exited';
}
