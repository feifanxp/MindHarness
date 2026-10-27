window.routingBootId = crypto.randomUUID();
document.querySelector('#app').append(` at ${location.pathname}`);

// Native UI tests read the real plugin, including after terminating the host.
const read = document.createElement('button');
read.textContent = 'Read native diagnostics';
read.style.cssText = 'position:fixed;top:100px;left:8px;min-height:44px';
const result = document.createElement('button');
result.style.cssText = 'position:fixed;top:152px;left:8px;width:40px;height:44px;overflow:hidden';
let readCount = 0;
const refresh = async () => {
  result.textContent = 'Reading native diagnostics';
  let snapshot;
  try {
    snapshot = window.Capacitor.isPluginAvailable('MindRoomDiagnostics')
      ? await window.Capacitor.nativePromise('MindRoomDiagnostics', 'read', {})
      : { status: 'unsupported', events: [] };
  } catch {
    snapshot = { status: 'unavailable', events: [] };
  }
  readCount += 1;
  result.textContent = `Native diagnostics ${JSON.stringify({
    readCount,
    status: snapshot.status,
    currentSessionId: snapshot.currentSessionId,
    events: snapshot.events
      .filter(({ name }) => ['app.launch', 'scene.background', 'scene.active'].includes(name))
      .slice(-24)
      .map(({ name, sessionId, sequence, data }) => ({ name, sessionId, sequence, data })),
  })}`;
};
read.addEventListener('click', refresh);
document.body.append(read, result);
void refresh();
