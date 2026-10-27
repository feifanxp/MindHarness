// Test resources come from the shipping document builder, including both opaque frames and CSP.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const server = await createServer({ server: { middlewareMode: true } });
try {
  const { buildCanvasDocument, CANVAS_WRAPPER_SANDBOX, CANVAS_PERMISSIONS } =
    await server.ssrLoadModule('/src/app/mindroom/canvas/canvasDocument.ts');
  const attack = `<p>Native canvas security probe</p><script>
    let handler;
    try {
      webkit.messageHandlers.bridge.postMessage({type:'message',pluginId:'BridgeProbe',methodName:'record',callbackId:'canvas-hostile',options:{}});
      handler = 'posted';
    } catch { handler = 'unavailable'; }
    let sessionAccess = false;
    try { sessionAccess = !!parent.parent.localStorage; } catch {}
    parent.parent.postMessage({nativeCanvasProbe:true,handler,bridge:typeof window.Capacitor,sessionAccess}, '*');
  </script>`;
  const chart = `<h1>Native Chart.js canvas</h1><canvas id="chart" style="max-height:300px"></canvas>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js"></script>
    <script>
      const chart = new Chart(document.getElementById('chart'), {
        type:'bar', data:{labels:['Canvas','Computer'],datasets:[{label:'iOS panels',data:[4,3]}]},
        options:{animation:false,responsive:true}
      });
      const pixels = chart.ctx.getImageData(0,0,chart.width,chart.height).data;
      parent.parent.postMessage({nativeCanvasProbe:true,chart:typeof Chart,painted:pixels.some(v => v !== 0)}, '*');
    </script>`;
  const appFramePolicy = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
  )?.[1];
  if (!appFramePolicy) throw new Error('Shipping app frame policy is missing');
  process.stdout.write(
    JSON.stringify({
      sandbox: CANVAS_WRAPPER_SANDBOX,
      permissions: CANVAS_PERMISSIONS,
      appFramePolicy,
      attack: buildCanvasDocument(attack, 'light'),
      chart: buildCanvasDocument(chart, 'light', undefined, 'Chart.js', true),
    })
  );
} finally {
  await server.close();
}
