import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  buildCanvasDocument,
  buildCanvasPage,
  CANVAS_CSP,
  CANVAS_ERROR_MESSAGE,
  CANVAS_INPUT_MAX_LENGTH,
  CANVAS_STATE_MAX_LENGTH,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_LIBRARY_SOURCE,
  CANVAS_STATE_MESSAGE,
  CANVAS_PERMISSIONS,
  CANVAS_SANDBOX,
  CANVAS_WRAPPER_SANDBOX,
  canvasFrameWindow,
  canvasPolicy,
} from './canvasDocument';
import { FALLBACK_CANVAS_THEMES } from './canvasTheme';

describe('buildCanvasPage', () => {
  it('puts the CSP before any agent markup so agent content cannot loosen it', () => {
    const doc = buildCanvasPage(
      '<meta http-equiv="Content-Security-Policy" content="default-src *"><p>hi</p>',
      'dark'
    );
    const cspIndex = doc.indexOf(`content="${CANVAS_CSP}"`);
    expect(cspIndex).toBeGreaterThan(0);
    expect(cspIndex).toBeLessThan(doc.indexOf('default-src *'));
    expect(doc.indexOf('<head>')).toBeLessThan(cspIndex);
    expect(doc.indexOf('</head>')).toBeLessThan(doc.indexOf('<p>hi</p>'));
  });

  it('loads scripts, styles, and fonts from the library source only when libraries are on', () => {
    expect(CANVAS_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
        "font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; " +
        "worker-src 'none'; base-uri 'none'"
    );
    expect(CANVAS_LIBRARY_SOURCE).toBe('https://cdn.jsdelivr.net/npm/');
    const policy = canvasPolicy(true);
    const directive = (name: string) =>
      policy.split('; ').find((candidate) => candidate.startsWith(`${name} `));
    expect(directive('script-src')).toBe(`script-src 'unsafe-inline' ${CANVAS_LIBRARY_SOURCE}`);
    expect(directive('style-src')).toBe(`style-src 'unsafe-inline' ${CANVAS_LIBRARY_SOURCE}`);
    expect(directive('font-src')).toBe(`font-src data: ${CANVAS_LIBRARY_SOURCE}`);
    // Network requests, images, frames, and every other directive stay as strict as before.
    const others = (value: string) =>
      value.split('; ').filter((candidate) => !/^(script|style|font)-src /.test(candidate));
    expect(others(policy)).toEqual(others(CANVAS_CSP));
    expect(buildCanvasPage('<p>hi</p>', 'light', FALLBACK_CANVAS_THEMES.light, true)).toContain(
      `content="${policy}"`
    );
  });

  it('gives the page its saved state before its scripts run, and a way to save it', () => {
    expect(buildCanvasPage('', 'light')).toContain('state: undefined');
    const json = '{"note":"</script><b>","__proto__":{"kept":true}}';
    const doc = buildCanvasPage(
      '<script>render(mindroom.state)</script>',
      'light',
      FALLBACK_CANVAS_THEMES.light,
      false,
      { json }
    );
    // The state cannot close the bridge script it is written into, and comes back exactly as saved.
    expect(doc.split('</script>')).toHaveLength(3);
    const restore = doc.match(/state: (JSON\.parse\(.*?\)),/)?.[1];
    // eslint-disable-next-line no-new-func
    expect(JSON.stringify(new Function(`return ${restore}`)())).toBe(json);
    expect(doc.indexOf('state: JSON.parse(')).toBeLessThan(doc.indexOf('render(mindroom.state)'));
    expect(doc).toContain(`type: '${CANVAS_STATE_MESSAGE}'`);
  });

  it('tells the page the color scheme it is shown in', () => {
    expect(buildCanvasPage('', 'dark')).toContain('colorScheme: "dark"');
    expect(buildCanvasPage('', 'light')).toContain('colorScheme: "light"');
  });

  it('reports errors, failed loads, and blocked loads before agent scripts run', () => {
    const doc = buildCanvasPage('<script>boom()</script>', 'light');
    const agentScript = doc.indexOf('boom()');
    for (const listener of [
      "addEventListener('error'",
      "addEventListener('unhandledrejection'",
      "addEventListener('securitypolicyviolation'",
    ]) {
      expect(doc.indexOf(listener)).toBeGreaterThan(0);
      expect(doc.indexOf(listener)).toBeLessThan(agentScript);
    }
    expect(doc).toContain(`type: '${CANVAS_ERROR_MESSAGE}'`);
  });

  it('numbers error lines from the start of the agent markup', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const doc = buildCanvasPage('<script>boom()</script>', scheme);
      const offset = doc.slice(0, doc.indexOf('<script>boom()')).split('\n').length - 1;
      expect(offset).toBeGreaterThan(0);
      expect(doc).toContain(`(event.lineno - ${offset})`);
    }
  });

  it('defines the bridge before agent scripts run', () => {
    const doc = buildCanvasPage('<script>mindroom.submit({a: 1})</script>', 'light');
    expect(doc.indexOf('mindroom.canvas.submit')).toBeLessThan(
      doc.indexOf('mindroom.submit({a: 1})')
    );
  });

  it('blocks network, navigation targets, and nested frames', () => {
    expect(CANVAS_CSP).toContain("default-src 'none'");
    expect(CANVAS_CSP).toContain("connect-src 'none'");
    expect(CANVAS_CSP).toContain("form-action 'none'");
    expect(CANVAS_CSP).toContain("frame-src 'none'");
    expect(CANVAS_CSP).toContain("base-uri 'none'");
    expect(CANVAS_CSP).not.toMatch(/https?:/);
  });

  it('never grants same-origin, popups, or top navigation', () => {
    expect(CANVAS_SANDBOX.split(' ').sort()).toEqual(['allow-forms', 'allow-scripts']);
    expect(CANVAS_WRAPPER_SANDBOX).toBe(CANVAS_SANDBOX);
  });

  it('sends answers past the wrapper to Chat', () => {
    expect(buildCanvasPage('', 'light')).toContain('parent.parent.postMessage');
  });

  it('follows the app color scheme', () => {
    expect(buildCanvasPage('', 'dark')).toContain('<meta name="color-scheme" content="dark">');
    expect(buildCanvasPage('', 'light')).toContain('<meta name="color-scheme" content="light">');
  });

  it('removes WebRTC constructors before agent scripts and denies powerful features', () => {
    const doc = buildCanvasPage('<script>agent()</script>', 'light');
    expect(doc.indexOf('RTCPeerConnection')).toBeLessThan(doc.indexOf('agent()'));
    expect(CANVAS_PERMISSIONS).toContain("camera 'none'");
    expect(CANVAS_PERMISSIONS).toContain("microphone 'none'");
    expect(CANVAS_PERMISSIONS).toContain("clipboard-read 'none'");
  });

  it('exposes the Chat theme as CSS variables before agent styles', () => {
    const doc = buildCanvasPage('<style>body{background:red}</style>', 'dark', {
      ...FALLBACK_CANVAS_THEMES.dark,
      accent: '#123456',
    });
    expect(doc.indexOf('--mr-accent:#123456')).toBeGreaterThan(0);
    expect(doc.indexOf('--mr-accent:#123456')).toBeLessThan(doc.indexOf('body{background:red}'));
    expect(doc).toContain('background:var(--mr-bg)');
  });
});

/** The canvas page the wrapper carries as a script string. */
const embeddedPage = (wrapper: string): string => {
  const literal = /frame\.srcdoc = ("(?:[^"\\]|\\.)*");/.exec(wrapper);
  return literal ? (JSON.parse(literal[1]) as string) : '';
};

describe('buildCanvasDocument', () => {
  it('fixes a policy that stops the canvas frame navigating before the wrapper script runs', () => {
    const doc = buildCanvasDocument('<p>hi</p>', 'dark');
    const cspIndex = doc.indexOf(`content="${CANVAS_CSP}"`);
    expect(CANVAS_CSP).toContain("frame-src 'none'");
    expect(cspIndex).toBeGreaterThan(0);
    expect(cspIndex).toBeLessThan(doc.indexOf('<script>'));
  });

  it('creates the sandboxed canvas frame with the page, the permissions, and the title', () => {
    const doc = buildCanvasDocument('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark, 'Plans "Q3"');
    expect(doc).toContain(`frame.setAttribute('sandbox', '${CANVAS_SANDBOX}')`);
    expect(doc).toContain(JSON.stringify(CANVAS_PERMISSIONS));
    expect(doc).toContain('frame.title = "Plans \\"Q3\\""');
    expect(embeddedPage(doc)).toBe(
      buildCanvasPage('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark)
    );
  });

  it('allows the library source in the wrapper too, because the canvas frame inherits its policy', () => {
    const doc = buildCanvasDocument('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark, '', true);
    expect(doc.indexOf(`content="${canvasPolicy(true)}"`)).toBeGreaterThan(0);
    expect(embeddedPage(doc)).toBe(
      buildCanvasPage('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark, true)
    );
    expect(buildCanvasDocument('<p>hi</p>', 'dark')).not.toContain(CANVAS_LIBRARY_SOURCE);
  });

  it('keeps agent markup from closing the wrapper script', () => {
    const html = '</script><script>parent.postMessage("x", "*")</script><!--';
    const doc = buildCanvasDocument(html, 'light');
    expect(doc.split('</script>')).toHaveLength(2);
    expect(embeddedPage(doc)).toContain(html);
  });

  it('reports a second load of the canvas frame as an escape', () => {
    const doc = buildCanvasDocument('', 'light');
    expect(doc).toContain("frame.addEventListener('load'");
    expect(doc).toContain(
      `if (loads > 1) parent.postMessage({ type: '${CANVAS_ESCAPE_MESSAGE}' }, '*')`
    );
    expect(doc.indexOf("addEventListener('load'")).toBeLessThan(
      doc.indexOf('document.body.append(frame)')
    );
  });
});

describe('kept inputs', () => {
  // Runs the bridge for real, so these are the page's own scripts and events.
  const open = (html: string, inputs?: string) => {
    const { window } = new JSDOM(buildCanvasPage(html, 'light', undefined, false, { inputs }), {
      runScripts: 'dangerously',
    });
    const sent: string[] = [];
    window.addEventListener('message', (event) => sent.push(event.data.inputs));
    const $ = <T extends Element = HTMLInputElement>(selector: string) =>
      window.document.querySelector(selector) as unknown as T;
    const use = (selector: string, set: (control: HTMLInputElement) => void, type = 'input') => {
      set($(selector));
      $(selector).dispatchEvent(new window.Event(type, { bubbles: true }));
    };
    const kept = () => JSON.parse(sent.at(-1) ?? '{}');
    return { window, sent, $, use, kept };
  };
  const settle = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  const RATE = `<input id="rate" type="range" min="0" max="10" value="2"><output id="shown"></output>
<script>
  const rate = document.getElementById('rate');
  const show = () => { document.getElementById('shown').textContent = rate.value; };
  rate.addEventListener('input', show);
  show();
</script>`;

  it('keeps named controls and gives them back to the next page, which redraws from them', async () => {
    const controls = `${RATE}
<select name="unit"><option>m</option><option>km</option></select>
<select name="days" multiple><option>mon</option><option>tue</option><option>wed</option></select>
<input type="checkbox" name="extras" value="map">
<input type="radio" name="size" value="s" checked><input type="radio" name="size" value="l">
<input id="untouched" value="same"><input placeholder="no id or name">`;
    const first = open(controls);
    await settle();
    first.use('#rate', (control) => {
      control.value = '7';
    });
    first.use(
      'select',
      (control) => {
        control.value = 'km';
      },
      'change'
    );
    first.use(
      '[name=days]',
      (control) => {
        [...(control as unknown as HTMLSelectElement).options].forEach((option) => {
          option.selected = option.value !== 'tue';
        });
      },
      'change'
    );
    first.use(
      '[name=extras]',
      (control) => {
        control.checked = true;
      },
      'change'
    );
    first.use(
      '[value=l]',
      (control) => {
        control.checked = true;
      },
      'change'
    );
    await settle();
    // Only changed values are kept, and a radio group keeps the value of its checked button.
    expect(first.kept()).toEqual({
      '#rate': '7',
      unit: 'km',
      days: ['mon', 'wed'],
      'extras=map': true,
      size: 'l',
    });

    // A kept value the control already shows needs no redraw.
    const second = open(controls, JSON.stringify({ ...first.kept(), '#untouched': 'same' }));
    const untouchedEvents: string[] = [];
    second.$('#untouched').addEventListener('input', () => untouchedEvents.push('input'));
    await settle();
    expect(second.$('#rate').value).toBe('7');
    expect(second.$('#shown').textContent).toBe('7');
    expect(second.$('select').value).toBe('km');
    expect(
      [...second.$<HTMLSelectElement>('[name=days]').selectedOptions].map((o) => o.value)
    ).toEqual(['mon', 'wed']);
    expect(second.$('[name=extras]').checked).toBe(true);
    expect(second.$('[value=l]').checked).toBe(true);
    expect(untouchedEvents).toEqual([]);
  });

  it('keeps values a version cannot show for the versions that can', async () => {
    const saved = JSON.stringify({ '#rate': '7', unit: 'km', size: 'l' });
    // No #rate, no "km" option, and only one of the radio buttons.
    const other = open(
      '<select name="unit"><option>m</option></select><input type="radio" name="size" value="s"><input id="zoom" value="1">',
      saved
    );
    await settle();
    other.use('#zoom', (control) => {
      control.value = '2';
    });
    await settle();
    expect(other.kept()).toEqual({ '#rate': '7', unit: 'km', size: 'l', '#zoom': '2' });
    other.use(
      '[value=s]',
      (control) => {
        control.checked = true;
      },
      'change'
    );
    await settle();
    expect(other.kept().size).toBe('s');
    const back = open(
      '<input type="radio" name="size" value="s"><input type="radio" name="size" value="l" checked>',
      other.sent.at(-1)
    );
    await settle();
    expect(back.$('[value=s]').checked).toBe(true);
  });

  it('gives a control the page draws later its kept value, rather than keeping its default', async () => {
    const page = open(
      `<div id="step"></div><button onclick="document.getElementById('step').innerHTML = '<input id=\\'seats\\' value=\\'1\\'>'">Next</button>`,
      JSON.stringify({ '#seats': '4' })
    );
    await settle();
    page.$<HTMLButtonElement>('button').click();
    await settle();
    expect(page.$('#seats').value).toBe('4');
    expect(page.kept()).toEqual({});
  });

  it("keeps the user's first change to a control the page drew later, but not the page's own event on it", async () => {
    const page = open(
      `<div id="step"></div><output id="shown"></output>
<script>
  setTimeout(() => {
    document.getElementById('step').innerHTML = '<input type="radio" name="size" value="s"><input type="radio" name="size" value="l"><input id="rate" type="range" min="0" max="10" value="2">';
    const rate = document.getElementById('rate');
    rate.addEventListener('input', () => { document.getElementById('shown').textContent = rate.value; });
    rate.dispatchEvent(new Event('input', { bubbles: true }));
  }, 5);
</script>`,
      JSON.stringify({ '#rate': '7' })
    );
    await settle();
    expect(page.$('#rate').value).toBe('7');
    expect(page.$('#shown').textContent).toBe('7');
    page.$('[value=l]').click();
    await settle();
    expect(page.kept()).toEqual({ '#rate': '7', size: 'l' });
  });

  it('keeps a choice made on a control the bridge has not seen yet', async () => {
    const page = open(
      `<div id="step"></div>
<script>
  setTimeout(() => {
    document.getElementById('step').innerHTML = '<input type="radio" name="size" value="s"><input type="radio" name="size" value="l">';
  }, 5);
</script>`
    );
    await settle();
    page.$('[value=l]').click();
    await settle();
    expect(page.kept()).toEqual({ size: 'l' });
  });

  it('restores one control at a time, for pages that redraw every control from their own state', async () => {
    // Like a framework's controlled inputs: the page writes its state back into every control on each change.
    const page = open(
      `<input id="rate" value="2"><input id="zoom" value="1"><input type="checkbox" id="flag">
<input type="checkbox" id="all"><input type="checkbox" id="one"><input type="checkbox" id="two">
<script>
  const state = { rate: '2', zoom: '1', flag: false };
  const $ = (id) => document.getElementById(id);
  const render = () => { $('rate').value = state.rate; $('zoom').value = state.zoom; $('flag').checked = state.flag; };
  $('rate').addEventListener('input', () => { state.rate = $('rate').value; render(); });
  $('zoom').addEventListener('input', () => { state.zoom = $('zoom').value; render(); });
  $('flag').addEventListener('click', () => { state.flag = $('flag').checked; render(); });
  // Select all checks the others.
  $('all').addEventListener('click', () => { $('one').checked = $('all').checked; $('two').checked = $('all').checked; });
</script>`,
      JSON.stringify({
        '#rate': '7',
        '#zoom': '3',
        '#flag': true,
        '#all': true,
        '#one': true,
        '#two': false,
      })
    );
    await settle();
    expect([page.$('#rate').value, page.$('#zoom').value, page.$('#flag').checked]).toEqual([
      '7',
      '3',
      true,
    ]);
    expect([page.$('#all').checked, page.$('#one').checked, page.$('#two').checked]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('restores every item of a list the page rebuilds on each change, and keeps them', async () => {
    const page = open(
      `<div id="list"></div>
<script>
  const state = { a: false, b: false, c: false };
  const list = document.getElementById('list');
  const draw = () => {
    list.innerHTML = Object.keys(state).map((id) => '<input type="checkbox" id="' + id + '"' + (state[id] ? ' checked' : '') + '>').join('');
  };
  list.addEventListener('change', (event) => { state[event.target.id] = event.target.checked; draw(); });
  draw();
</script>`,
      JSON.stringify({ '#a': true, '#b': true, '#c': true })
    );
    await settle();
    expect(['#a', '#b', '#c'].map((id) => page.$(id).checked)).toEqual([true, true, true]);
    expect(page.sent).toEqual([]);
  });

  it('gives a field that a restored checkbox reveals its kept value too', async () => {
    const page = open(
      `<input type="checkbox" id="adv"><div id="more"></div><script>
  document.getElementById('adv').addEventListener('change', (event) => {
    document.getElementById('more').innerHTML = event.target.checked ? '<input id="extra">' : '';
  });
</script>`,
      JSON.stringify({ '#adv': true, '#extra': 'hello' })
    );
    await settle();
    await settle();
    expect(page.$('#extra').value).toBe('hello');
  });

  it('restores a field revealed by a control that was itself restored later', async () => {
    const page = open(
      `<input type="checkbox" id="adv"><div id="more"></div><script>
  const more = document.getElementById('more');
  document.getElementById('adv').addEventListener('change', (event) => {
    more.innerHTML = event.target.checked ? '<input type="checkbox" id="opt"><span id="sub"></span>' : '';
    document.getElementById('opt')?.addEventListener('change', (inner) => {
      document.getElementById('sub').innerHTML = inner.target.checked ? '<input id="note">' : '';
    });
  });
</script>`,
      JSON.stringify({ '#adv': true, '#opt': true, '#note': 'keep me' })
    );
    for (let pass = 0; pass < 4; pass += 1) {
      // eslint-disable-next-line no-await-in-loop
      await settle();
    }
    expect(page.$('#note').value).toBe('keep me');
    // Restoring keeps nothing new, so no default replaces a kept value.
    expect(page.sent).toEqual([]);
  });

  it('restores disabled checkboxes and radio buttons, which ignore clicks', async () => {
    const page = open(
      `<input type="checkbox" id="flag" disabled><fieldset disabled><input type="radio" name="size" value="s" checked><input type="radio" name="size" value="l"></fieldset>`,
      JSON.stringify({ '#flag': true, size: 'l' })
    );
    await settle();
    expect(page.$('#flag').checked).toBe(true);
    expect(page.$('[value=l]').checked).toBe(true);
  });

  it('leaves a select showing its own choice when this version lacks the kept one', async () => {
    const page = open(
      '<select name="unit"><option>m</option></select>',
      JSON.stringify({ unit: 'km' })
    );
    await settle();
    expect(page.$<HTMLSelectElement>('select').value).toBe('m');
  });

  it('redraws a page that fires an event before it listens for one', async () => {
    const page = open(
      `<input id="rate" type="range" min="0" max="10" value="2"><output id="shown"></output>
<script>
  const rate = document.getElementById('rate');
  rate.dispatchEvent(new Event('input', { bubbles: true }));
  rate.addEventListener('input', () => { document.getElementById('shown').textContent = rate.value; });
</script>`,
      JSON.stringify({ '#rate': '7' })
    );
    await settle();
    expect(page.$('#shown').textContent).toBe('7');
  });

  it('tells Chat whether the user has clicked or typed in the page', async () => {
    const { window } = new JSDOM(buildCanvasPage(RATE, 'light'), {
      runScripts: 'dangerously',
      beforeParse(win) {
        Object.defineProperty(win.navigator, 'userActivation', { value: { hasBeenActive: false } });
      },
    });
    const sent: Array<Record<string, unknown>> = [];
    window.addEventListener('message', (event) => sent.push(event.data));
    await settle();
    (window.document.querySelector('#rate') as HTMLInputElement).value = '7';
    window.document
      .querySelector('#rate')
      ?.dispatchEvent(new window.Event('input', { bubbles: true }));
    (window as unknown as { mindroom: { saveState: (value: unknown) => void } }).mindroom.saveState(
      1
    );
    await settle();
    expect(sent.map((message) => message.user)).toEqual([false, false]);
  });

  it("ignores the page's own events until the kept values are back", async () => {
    const page = open(
      `${RATE}<script>document.addEventListener('DOMContentLoaded', () => rate.dispatchEvent(new Event('input', { bubbles: true })));</script>`,
      JSON.stringify({ '#rate': '7' })
    );
    await settle();
    expect(page.$('#rate').value).toBe('7');
    expect(page.sent).toEqual([]);
  });

  it('keeps values a button changes without an input event', async () => {
    const page = open(
      `${RATE}<button onclick="rate.value = '2'; show()">Reset</button>`,
      JSON.stringify({ '#rate': '7' })
    );
    await settle();
    page.$<HTMLButtonElement>('button').click();
    await settle();
    expect(page.kept()).toEqual({ '#rate': '2' });
  });

  it('never keeps a password, even while it is shown, nor a field or form that turns autocomplete off', async () => {
    const page = open(
      `${RATE}<input id="secret" type="password"><input id="code" autocomplete="off"><form autocomplete="off"><input id="pin"></form>`
    );
    await settle();
    page.use('#secret', (control) => {
      control.type = 'text';
      control.value = 'hunter2';
    });
    page.use('#code', (control) => {
      control.value = '123456';
    });
    page.use('#pin', (control) => {
      control.value = '0000';
    });
    page.use('#rate', (control) => {
      control.value = '7';
    });
    await settle();
    expect(page.kept()).toEqual({ '#rate': '7' });
  });

  it('never keeps a password the page reveals, at startup or on a later field', async () => {
    const page = open(
      `${RATE}<input id="early" type="password"><script>document.getElementById('early').type = 'text';</script>
<div id="login"></div>
<script>
  function draw() { document.getElementById('login').innerHTML = '<input id="late" type="password">'; }
</script>
<button id="draw" onclick="draw()">Log in</button>
<button id="show" onclick="document.getElementById('late').type = 'text'">Show</button>`
    );
    await settle();
    page.$<HTMLButtonElement>('#draw').click();
    page.$<HTMLButtonElement>('#show').click();
    await settle();
    page.use('#early', (control) => {
      control.value = 'hunter2';
    });
    page.use('#late', (control) => {
      control.value = 'hunter3';
    });
    page.use('#rate', (control) => {
      control.value = '7';
    });
    await settle();
    expect(page.kept()).toEqual({ '#rate': '7' });
  });

  it('declines a whole radio group when one of its buttons turns autocomplete off, in any case', async () => {
    const page = open(
      `${RATE}<input id="code" autocomplete="OFF"><input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b" autocomplete="off">`
    );
    await settle();
    page.use('#code', (control) => {
      control.value = '123456';
    });
    page.use(
      '[value=b]',
      (control) => {
        control.checked = true;
      },
      'change'
    );
    page.use('#rate', (control) => {
      control.value = '7';
    });
    await settle();
    expect(page.kept()).toEqual({ '#rate': '7' });
  });

  it('clicks kept checkboxes and radio buttons, which is what frameworks listen to', async () => {
    const page = open(
      `<input type="checkbox" id="flag"><input type="radio" name="size" value="s" checked><input type="radio" name="size" value="l">
<script>window.clicked = []; document.addEventListener('click', (event) => window.clicked.push(event.target.id || event.target.value));</script>`,
      JSON.stringify({ '#flag': true, size: 'l' })
    );
    await settle();
    expect(page.$('#flag').checked).toBe(true);
    expect(page.$('[value=l]').checked).toBe(true);
    expect((page.window as unknown as { clicked: string[] }).clicked).toEqual(['flag', 'l']);
    // Giving the values back keeps nothing new.
    expect(page.sent).toEqual([]);
  });

  it('leaves a long text to saveState, so it cannot stop other values from being kept', async () => {
    const page = open(
      `${RATE}<textarea id="notes"></textarea>`,
      JSON.stringify({ '#notes': 'short' })
    );
    await settle();
    page.use('#notes', (control) => {
      control.value = 'x'.repeat(CANVAS_INPUT_MAX_LENGTH);
    });
    page.use('#rate', (control) => {
      control.value = '7';
    });
    await settle();
    expect(page.kept()).toEqual({ '#rate': '7' });
  });

  it('tells a page about a restored disabled checkbox the way it hears about clicks, so enabling it keeps the value', async () => {
    const page = open(
      `<input type="checkbox" id="flag" disabled><button id="enable">Enable</button>
<script>
  const state = { flag: false };
  const flag = document.getElementById('flag');
  flag.addEventListener('click', () => { state.flag = flag.checked; });
  document.getElementById('enable').addEventListener('click', () => { flag.disabled = false; flag.checked = state.flag; });
</script>`,
      JSON.stringify({ '#flag': true })
    );
    await settle();
    page.$<HTMLButtonElement>('#enable').click();
    await settle();
    expect(page.$('#flag').checked).toBe(true);
  });

  it("restores controls drawn later only after the page has handled the user's change", async () => {
    // The page writes its state into every control when the checkbox changes.
    const page = open(
      `<div id="step"></div>
<script>
  const state = { size: 's', flag: false };
  setTimeout(() => {
    document.getElementById('step').innerHTML = '<input type="radio" name="size" value="s" checked><input type="radio" name="size" value="l"><input type="checkbox" id="flag">';
    const render = () => {
      document.querySelector('[value=' + state.size + ']').checked = true;
      document.getElementById('flag').checked = state.flag;
    };
    document.getElementById('step').addEventListener('change', (event) => {
      if (event.target.name === 'size') state.size = event.target.value;
    });
    document.getElementById('flag').addEventListener('click', () => { state.flag = document.getElementById('flag').checked; render(); });
  }, 5);
</script>`,
      JSON.stringify({ '#flag': true })
    );
    await settle();
    page.$('[value=l]').click();
    await settle();
    expect([page.$('[value=l]').checked, page.$('#flag').checked]).toEqual([true, true]);
    expect(page.kept()).toEqual({ '#flag': true, size: 'l' });
  });

  it('leaves a checkbox alone when its kept value is not a choice', async () => {
    const page = open('<input type="checkbox" id="flag">', JSON.stringify({ '#flag': 'yes' }));
    await settle();
    expect(page.$('#flag').checked).toBe(false);
  });

  it('drops the longest values once all kept values outgrow what Chat keeps, so the others are still kept', async () => {
    const fields = Array.from(
      { length: 9 },
      (_, index) => `<textarea id="t${index}"></textarea>`
    ).join('');
    const page = open(`${RATE}${fields}`);
    await settle();
    for (let index = 0; index < 9; index += 1) {
      page.use(`#t${index}`, (control) => {
        control.value = 'x'.repeat(30_000 + index);
      });
    }
    page.use('#rate', (control) => {
      control.value = '7';
    });
    await settle();
    const last = page.sent.at(-1) ?? '';
    expect(last.length).toBeLessThanOrEqual(CANVAS_STATE_MAX_LENGTH);
    expect(JSON.parse(last)['#rate']).toBe('7');
    expect(JSON.parse(last)['#t8']).toBeUndefined();
  });

  it('reads autocomplete as whole tokens, so a street field in an "office" section is kept', async () => {
    const page = open(
      `<input id="street" autocomplete="section-office street-address"><input id="pin" autocomplete="section-login one-time-code current-password">`
    );
    await settle();
    page.use('#street', (control) => {
      control.value = 'Main St 1';
    });
    page.use('#pin', (control) => {
      control.value = 'hunter2';
    });
    await settle();
    expect(page.kept()).toEqual({ '#street': 'Main St 1' });
  });

  it('restores through the native setter, so a framework tracking the value sees the change', async () => {
    // React keeps its own copy of the value in a setter on the element and skips onChange when they match.
    const page = open(
      `${RATE}<script>
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  window.tracked = [];
  Object.defineProperty(rate, 'value', {
    get() { return native.get.call(this); },
    set(value) { window.tracked.push(value); native.set.call(this, value); },
  });
</script>`,
      JSON.stringify({ '#rate': '7' })
    );
    await settle();
    expect(page.$('#rate').value).toBe('7');
    expect((page.window as unknown as { tracked: string[] }).tracked).toEqual([]);
  });
});

describe('canvasFrameWindow', () => {
  it('reads the canvas frame inside the wrapper', () => {
    const inner = {} as Window;
    const panelFrame = { contentWindow: { frames: [inner] } } as unknown as HTMLIFrameElement;
    expect(canvasFrameWindow(panelFrame)).toBe(inner);
    expect(canvasFrameWindow(null)).toBeUndefined();
  });

  it('reads nothing while the cross-origin wrapper holds no canvas frame yet', () => {
    // Like a browser, a cross-origin window throws for a frame index it does not hold.
    const frames = new Proxy([] as Window[], {
      get: (target, key) => {
        if (key === '0') throw new DOMException('Blocked a frame', 'SecurityError');
        return Reflect.get(target, key);
      },
    });
    const panelFrame = { contentWindow: { frames } } as unknown as HTMLIFrameElement;
    expect(canvasFrameWindow(panelFrame)).toBeUndefined();
  });
});
