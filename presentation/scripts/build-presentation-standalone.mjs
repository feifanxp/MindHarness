import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import postcss from 'postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const contentPath = path.resolve(root, 'Mind_Harness_Presentation_编辑.json');
const outputPath = path.resolve(root, 'Mind_Harness_独立版.html');
// The standalone HTML is the editing source of truth after the first export.
const previousHtml = existsSync(outputPath) ? await readFile(outputPath, 'utf8') : null;
const embedded = previousHtml?.match(
  /<script\b(?=[^>]*\bid=["']mind-harness-content["'])[^>]*>([\s\S]*?)<\/script>/i
);
if (previousHtml !== null && !embedded)
  throw new Error('现有独立 HTML 缺少编辑数据，已停止导出以避免覆盖修改。');
const saved = JSON.parse(embedded ? embedded[1] : await readFile(contentPath, 'utf8'));
if (
  saved.format !== 'mind-harness-text' ||
  saved.version !== 1 ||
  !saved.fields ||
  typeof saved.fields !== 'object' ||
  !Object.values(saved.fields).every(value => typeof value === 'string')
)
  throw new Error('演示内容文件格式无效。');
const result = await build({
  configFile: false,
  envDir: false,
  root,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(root, 'src/presentationStandalone.tsx'),
      name: 'MindHarnessStandalone',
      formats: ['iife'],
    },
    minify: true,
    sourcemap: false,
  },
});
const bundles = Array.isArray(result) ? result : [result];
const outputs = bundles.flatMap(bundle => bundle.output);
const scripts = outputs.filter(item => item.type === 'chunk');
if (scripts.length !== 1 || scripts[0].imports.length || scripts[0].dynamicImports.length)
  throw new Error('独立演示必须只有一个内嵌脚本。');
const styles = outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
if (!styles.length) throw new Error('未生成演示样式。');
const css = postcss.parse(styles.map(item => String(item.source)).join('\n'));
css.walkAtRules('import', rule => rule.remove());
const reset =
  'html,body{margin:0;padding:0;background:#111411;color:#f1f0e9}html{font-size:16px}body{font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}button,input,textarea{font:inherit}svg{display:block;vertical-align:middle}';
const style = (reset + css.toString()).replace(/<\/style/gi, '<\\/style');
const script = scripts[0].code.replace(/<\/script/gi, '<\\/script');
const logo = await readFile(path.join(root, 'src/assets/mind-harness-logo.png'));
const favicon = 'data:image/png;base64,' + logo.toString('base64');
const content = JSON.stringify(saved)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
const html = [
  '<!doctype html>',
  '<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="color-scheme" content="dark"><title>Mind Harness — 独立演示</title>',
  '<link rel="icon" type="image/png" href="' + favicon + '">',
  '<style id="mind-harness-styles">' + style + '</style></head><body>',
  '<div id="root"></div><noscript>请用启用 JavaScript 的浏览器打开这个独立演示文件。</noscript>',
  '<script id="mind-harness-content" type="application/json" data-revision="0">' +
    content +
    '</script>',
  '<script id="mind-harness-runtime">' + script + '</script>',
  '</body></html>',
].join('\n');
await writeFile(outputPath, html);
console.log('Standalone HTML: ' + outputPath);
console.log(
  'Size: ' + Math.round(Buffer.byteLength(html) / 1024) + ' KiB; external scripts/styles: 0'
);
