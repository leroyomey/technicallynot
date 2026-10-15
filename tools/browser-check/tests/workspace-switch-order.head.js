// Stand-in for the desktop's project list (00's TnaiDesktop), loaded before the app's scripts. The
// first question 07 (terminal workspaces) asks at startup is answered late, with the old project,
// so a project switch made meanwhile finishes first. Every other call answers at once with nothing.
(() => {
  let startupAsked = false;
  const projects = () => {
    const from07 = /07-terminal-workspaces/.test(new Error().stack || '');
    if (from07 && !startupAsked) {
      startupAsked = true;
      return new Promise(resolve =>
        setTimeout(() => resolve({ active: 'C:\\Old', projects: [] }), 400)
      );
    }
    return Promise.resolve({ active: '', projects: [] });
  };
  window.TnaiDesktop = new Proxy(
    { projects },
    { get: (target, name) => target[name] || (async () => undefined) }
  );
})();
