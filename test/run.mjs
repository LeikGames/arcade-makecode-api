// Builds the extension, the demo and the fixture, then plays the fixture in
// MakeCode's real simulator, inside a real MakeCode-Arcade-to-App export, with
// this script acting as the launcher.
//
//   node run.mjs <folder of any exported game> [name filter]
//
// The export supplies the host page and simulator; only its binary.js is swapped.
// Needs internet for the first build, and an installed Chrome or Edge.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '..');
const exportDir = process.argv[2] && path.resolve(process.argv[2]);
const filter = process.argv[3] ?? '';
if (!exportDir || !fs.existsSync(path.join(exportDir, '---simulator.html'))) {
  console.error('Usage: node run.mjs <folder of any exported MakeCode game> [name filter]');
  process.exit(2);
}

// ---- Build ----
function build(dir) {
  const cli = path.join(HERE, 'node_modules', 'makecode', 'makecode');
  const r = spawnSync(process.execPath, [cli, 'build', '-j'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`Build failed in ${dir}`);
  }
  return fs.readFileSync(path.join(dir, 'built', 'binary.js'));
}
const binaries = { demo: build(ROOT), fixture: build(path.join(HERE, 'fixture')) };
console.log('built extension + demo, fixture');

// ---- Serve ----
let binary = binaries.fixture;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(exportDir, name === '/' ? 'index.html' : name);
  if (!file.startsWith(exportDir + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(name === '/binary.js' ? binary : fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let browser;
for (const channel of ['chrome', 'msedge']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try the next */ }
}
if (!browser) throw new Error('No Chrome or Edge found');

// ---- A running game ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = { left: 1, up: 2, right: 3, down: 4, a: 5, b: 6, menu: 7 };
const P2 = 7;

class Game {
  static async open({ state = {}, welcome = true, program = 'fixture' } = {}) {
    binary = binaries[program];
    const g = new Game();
    g.context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    g.page = await g.context.newPage();
    g.errors = [];
    g.page.on('pageerror', (e) => g.errors.push(String(e)));
    await g.page.addInitScript(({ state, welcome }) => {
      if (window !== window.top) return;
      if (!localStorage.simState) {
        localStorage.simState = JSON.stringify(Object.fromEntries(
          Object.entries(state).map(([k, v]) => ['S/' + k, btoa(String.fromCharCode(...v))])));
      }
      window.launcherLog = []; window.testLog = []; window.simErrors = [];
      window.postRaw = (m) => document.querySelector('iframe').contentWindow.postMessage(m, '*');
      window.toGame = (channel, text) => postRaw({ type: 'messagepacket', channel, data: new TextEncoder().encode(text) });
      window.welcome = welcome;
      addEventListener('message', (e) => {
        const d = e.data;
        if (d?.type === 'debugger' && d.subtype === 'breakpoint') simErrors.push(d.exceptionMessage ?? 'breakpoint');
        if (d?.type !== 'messagepacket') return;
        if (d.channel === 'cabinet-test') testLog.push(JSON.parse(new TextDecoder().decode(d.data)));
        if (d.channel !== 'arcade-launcher') return;
        // The same checks as the launcher's preload
        if (e.source !== document.querySelector('iframe').contentWindow || !(d.data instanceof Uint8Array)) return;
        const m = JSON.parse(new TextDecoder().decode(d.data));
        launcherLog.push({ ...m, broadcast: d.broadcast });
        if (m.type === 'hello' && window.welcome) toGame('arcade-launcher', '{"v":1,"type":"welcome"}');
      });
    }, { state: { '#scope': [...Buffer.from('cabinet-fixture')], ...state }, welcome });
    await g.page.goto(url);
    await g.until(() => window.launcherLog.some((m) => m.type === 'hello'));
    await sleep(400);
    return g;
  }
  until(fn, arg, timeout = 8000) { return this.page.waitForFunction(fn, arg, { timeout }); }
  key(k, down) {
    return this.page.evaluate(([k, down]) => document.querySelector('iframe').contentWindow.pxsim.board().setButton(k, down), [k, down]);
  }
  async press(k, hold = 90) { await this.key(k, true); await sleep(hold); await this.key(k, false); await sleep(110); }
  cmd(text) { return this.page.evaluate((t) => toGame('cabinet-test', t), text); }
  raw(message) { return this.page.evaluate((m) => postRaw(m), message); }
  sendText(text) { return this.page.evaluate((t) => toGame('arcade-launcher', t), text); }
  async state() {
    const n = await this.page.evaluate(() => testLog.length);
    await this.cmd('state');
    await this.until((n) => testLog.length > n && testLog.slice(n).some((m) => m.type === 'state'), n);
    return this.page.evaluate((n) => testLog.slice(n).find((m) => m.type === 'state'), n);
  }
  log(type) { return this.page.evaluate((t) => launcherLog.filter((m) => !t || m.type === t), type); }
  starts() { return this.page.evaluate(() => testLog.filter((m) => m.type === 'started').length); }
  saved(key) {
    return this.page.evaluate((k) => {
      const v = JSON.parse(localStorage.simState)['S/' + k];
      return v === undefined ? undefined : [...atob(v)].map((c) => c.charCodeAt(0));
    }, key);
  }
  async shot(name) {
    const data = await this.page.evaluate(() => document.querySelector('iframe').contentDocument.getElementById('game-screen').toDataURL());
    fs.mkdirSync(path.join(HERE, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(HERE, 'shots', name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    return data;
  }
  async begin() {
    const n = await this.starts();
    await this.press(K.a);
    await this.until((n) => testLog.filter((m) => m.type === 'started').length > n, n);
    await sleep(200);
  }
  /** result screen -> whatever comes next */
  async passResult() { await sleep(1100); await this.press(K.a); await sleep(450); }
  async enter(player = 1) { for (let i = 0; i < 3; i++) await this.press(K.a + (player - 1) * P2); await sleep(900); }
  async close() {
    const errors = [...this.errors, ...(await this.page.evaluate(() => simErrors))];
    await this.context.close();
    eq(errors, [], 'no errors in the page or simulator');
  }
}

function eq(actual, expected, what) {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(v, what) { if (!v) throw new Error(what); }

/** A stored table, encoded independently of the extension's code. */
function table(entries) {
  const b = Buffer.alloc(4 + entries.length * 12 + 2);
  b.set([0x4c, 0x53, 1, entries.length]);
  entries.forEach(([initials, score, player], i) => {
    const at = 4 + i * 12;
    b.writeUInt32LE(score, at);
    [...initials].forEach((c, j) => b.writeUInt16LE(c.charCodeAt(0), at + 4 + j * 2));
    b[at + 10] = player;
  });
  let sum = 0x5343;
  for (let i = 0; i < b.length - 2; i++) sum = (sum * 31 + b[i]) & 0xffff;
  b.writeUInt16LE(sum, b.length - 2);
  return [...b];
}
const full = Array.from({ length: 10 }, (_, i) => ['ÆØÅ', 1000 - i * 100, 1 + (i % 2)]);

// ---- Tests ----
const tests = {
  async 'hello is the first message, exact and not broadcast'() {
    const g = await Game.open();
    eq(await g.log(), [{ v: 1, type: 'hello', ext: JSON.parse(fs.readFileSync(path.join(ROOT, 'pxt.json'))).version, broadcast: false }], 'messages');
    await g.close();
  },
  async 'the game waits for A, from either player, and A does not leak into it'() {
    for (const k of [K.a, K.a + P2]) {
      const g = await Game.open();
      await g.press(K.menu); await g.press(K.b);
      eq(await g.starts(), 0, 'started');
      await g.press(k); await sleep(300);
      eq(await g.starts(), 1, 'started');
      const s = await g.state();
      eq([s.presses, s.paused, s.systemMenu], [0, false, false], 'presses, paused, systemMenu');
      await g.close();
    }
  },
  async 'Menu from either player opens our menu and never the system menu, and the game is frozen'() {
    for (const k of [K.menu, K.menu + P2]) {
      const g = await Game.open(); await g.begin();
      await g.press(k); await sleep(200);
      const s1 = await g.state(); await sleep(700); const s2 = await g.state();
      eq([s1.paused, s1.systemMenu], [true, false], 'paused, systemMenu');
      eq([s2.updates, s2.runtime], [s1.updates, s1.runtime], 'updates, runtime while paused');
      eq(s2.volume, 0, 'volume');
      await g.press(K.a); await sleep(300);
      const s3 = await g.state();
      ok(s3.updates > s2.updates && s3.runtime - s2.runtime < 700, 'resumes without a time jump');
      eq([s3.paused, s3.presses, s3.volume > 0], [false, 0, true], 'paused, presses, volume on');
      if (k === K.menu) eq(s3.menuReleases, 1, 'the missed Menu release is delivered');
      await g.close();
    }
  },
  async 'Menu and B close the pause menu; it reopens; fast toggling is safe'() {
    const g = await Game.open(); await g.begin();
    for (const k of [K.menu, K.b]) {
      await g.press(K.menu); ok((await g.state()).paused, 'open');
      await g.press(k); await sleep(200); ok(!(await g.state()).paused, 'closed');
    }
    for (let i = 0; i < 12; i++) await g.press(K.menu, 30);
    await sleep(500);
    if ((await g.state()).paused) { await g.press(K.b); await sleep(200); }
    const a = await g.state(); await sleep(300); const b = await g.state();
    ok(!b.paused && b.updates > a.updates && !b.systemMenu, 'running after toggling');
    await g.close();
  },
  async 'both players pressing Menu together opens one menu'() {
    const g = await Game.open(); await g.begin();
    await g.key(K.menu, true); await g.key(K.menu + P2, true); await sleep(100);
    await g.key(K.menu, false); await g.key(K.menu + P2, false); await sleep(150);
    await g.press(K.b); await sleep(200);
    ok(!(await g.state()).paused, 'one close is enough');
    await g.close();
  },
  async 'the menu works in pushed scenes and after popping'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('push'); await sleep(200);
    await g.press(K.menu); let s = await g.state();
    eq([s.paused, s.systemMenu], [true, false], 'in pushed scene');
    await g.press(K.b); await sleep(200);
    await g.cmd('pop'); await sleep(200);
    await g.press(K.menu); s = await g.state();
    eq([s.paused, s.systemMenu], [true, false], 'after pop');
    await g.close();
  },
  async 'background fibers: sprites land in the game, wait() stops, blocked fibers stay blocked'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('block'); await g.cmd('wait 600'); await sleep(100);
    await g.press(K.menu); await g.cmd('stray'); await sleep(1200);
    await g.press(K.down); await g.press(K.up); await g.press(K.a, 60); await sleep(150);
    let s = await g.state();
    eq([s.sprites, s.waited, s.blockedWoke], [1, false, false], 'sprites, waited, blockedWoke');
    await sleep(900);
    eq((await g.state()).waited, true, 'waited after resuming');
    await g.press(K.a); eq((await g.state()).blockedWoke, true, 'wakes on a real press');
    await g.close();
  },
  async 'pauseMenu() opens the menu'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('pausemenu'); await sleep(150); ok((await g.state()).paused, 'paused');
    await g.close();
  },
  async 'Start på nytt restarts straight into the game, once'() {
    const g = await Game.open(); await g.begin();
    await g.press(K.menu); await g.press(K.down); await g.press(K.a);
    await g.until(() => launcherLog.filter((m) => m.type === 'hello').length === 2, null, 12000);
    await g.until(() => testLog.filter((m) => m.type === 'started').length === 2);
    await sleep(2500);
    eq(await g.saved('cabinet.skiptitle'), undefined, 'flag');
    await g.page.reload();
    await g.until(() => window.launcherLog.length > 0); await sleep(600);
    eq(await g.starts(), 0, 'title screen is back');
    await g.close();
  },
  async 'without welcome there is no quit option'() {
    const g = await Game.open({ welcome: false }); await g.begin();
    await g.press(K.menu); await g.shot('pause-standalone');
    await g.press(K.up); await g.press(K.a); // wraps to the last choice: restart, not quit
    await g.until(() => launcherLog.filter((m) => m.type === 'hello').length === 2, null, 12000);
    eq(await g.log('quit'), [], 'quit messages');
    await g.close();
  },
  async 'connected does not survive a restart'() {
    const g = await Game.open(); await g.begin();
    await g.page.evaluate(() => { window.welcome = false; });
    await g.press(K.menu); await g.press(K.down); await g.press(K.a);
    await g.until(() => testLog.filter((m) => m.type === 'started').length === 2, null, 12000); await sleep(300);
    await g.press(K.menu); await g.press(K.up); await g.press(K.a); // last choice must be restart
    await g.until(() => launcherLog.filter((m) => m.type === 'hello').length === 3, null, 12000);
    eq(await g.log('quit'), [], 'quit messages');
    await g.close();
  },
  async 'a late welcome, during play or while the menu is open, adds the quit option'() {
    const g = await Game.open({ welcome: false }); await g.begin();
    await g.press(K.menu); await g.sendText('{"v":1,"type":"welcome"}'); await sleep(200);
    await g.press(K.up); await g.press(K.a); await sleep(800);
    eq((await g.log('quit')).length, 1, 'quit messages');
    await g.close();
  },
  async 'quit is sent once and the menu comes back if nothing happens'() {
    const g = await Game.open(); await g.begin();
    await g.press(K.menu); await g.press(K.up); await g.press(K.a); await sleep(1200);
    eq(await g.log('quit'), [{ v: 1, type: 'quit', broadcast: false }], 'quit'); await g.shot('quitting');
    await sleep(3000);
    await g.press(K.b); await sleep(200);
    eq([(await g.state()).paused, (await g.log('quit')).length], [false, 1], 'resumed, quits');
    await g.close();
  },
  async 'malformed and unknown messages are ignored and do not block a later welcome'() {
    const g = await Game.open({ welcome: false }); await g.begin();
    const alive = async (what) => { const a = await g.state().catch(() => undefined); ok(a, `game stopped after ${what}`); };
    for (const t of ['', '{', '{bad', '{"a":"unterminated', '{"v":1,"type":"welcome', '[1', 'null', '1', '"x"', '[]', '{}',
      '{"v":2,"type":"welcome"}', '{"v":"1","type":"welcome"}', '{"v":1}', '{"v":1,"type":null}', '{"v":1,"type":"future"}',
      '{"v":1,"type":"welcome"}x', '['.repeat(900), '{"a":'.repeat(150), '{"v":1,"type":"welcome","pad":"' + 'x'.repeat(2000) + '"}',
      '{"v":1,"type":{"a":[1]}}']) { await g.sendText(t); await alive('text ' + t.slice(0, 40)); }
    await g.page.evaluate(() => postRaw({ type: 'messagepacket', channel: 'arcade-launcher', data: new Uint8Array([255, 254, 0]) })); await alive('invalid UTF-8');
    // Packets whose data isn't bytes are not tested: they crash inside the simulator's Buffer, see README.
    await sleep(500);
    const a = await g.state(); await sleep(200); const b = await g.state();
    ok(b.updates > a.updates, 'still running');
    await g.press(K.menu); await g.press(K.up); await g.press(K.a); await sleep(200);
    eq(await g.log('quit'), [], 'not connected');
    await g.close();
    const h = await Game.open({ welcome: false }); await h.begin();
    await h.sendText('{bad'); await h.sendText('{"v":1,"type":"welcome","extra":[1,{"a":"}"}]}'); await sleep(200);
    await h.press(K.menu); await h.press(K.up); await h.press(K.a); await sleep(800);
    eq((await h.log('quit')).length, 1, 'connected');
    await h.close();
  },
  async 'game over: entry, message, saved table, play again'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('over 1234'); await sleep(1000); await g.shot('result'); await g.passResult();
    await g.press(K.up); await g.press(K.a); await g.press(K.down); await g.press(K.b); await g.press(K.a);
    await g.shot('initials');
    for (let i = 0; i < 10; i++) await g.press(K.down); // 9..0, then Å
    await g.press(K.a); await g.press(K.a); await sleep(900);
    eq(await g.log('score'), [{ v: 1, type: 'score', score: 1234, initials: 'BÅA', player: 1, broadcast: false }], 'score');
    await g.shot('table'); await g.press(K.a); await sleep(200); await g.shot('end-menu');
    eq(await g.saved('cabinet.scores'), table([['BÅA', 1234, 1]]), 'saved bytes');
    await g.press(K.a);
    await g.until(() => testLog.filter((m) => m.type === 'started').length === 2, null, 12000);
    eq((await g.state()).scores, [{ initials: 'BÅA', score: 1234, player: 1 }], 'scores after the restart');
    eq((await g.log('hello')).length, 2, 'hellos');
    await g.close();
  },
  async 'player 2 enters with their own controls only'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('over 50 2'); await g.passResult();
    await g.enter(1); eq(await g.log('score'), [], 'player 1 has no say');
    await g.enter(2); eq((await g.log('score')).map((m) => [m.initials, m.player]), [['AAA', 2]], 'score');
    await g.close();
  },
  async 'versus: two entries, best first, one message each'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('versus 100 300'); await sleep(1000); await g.shot('versus'); await g.passResult();
    await g.enter(2); await g.enter(1);
    eq((await g.log('score')).map((m) => [m.score, m.player]), [[300, 2], [100, 1]], 'scores');
    eq(await g.saved('cabinet.scores'), table([['AAA', 300, 2], ['AAA', 100, 1]]), 'saved');
    await g.shot('versus-table');
    await g.close();
  },
  async 'versus: only the score that makes a full table is entered and sent'() {
    const g = await Game.open({ state: { 'cabinet.scores': table(full) } }); await g.begin();
    await g.cmd('versus 101 100'); await g.passResult(); await g.enter(1);
    eq((await g.log('score')).map((m) => [m.score, m.player]), [[101, 1]], 'scores');
    await g.close();
  },
  async 'scores that do not qualify are not entered or sent'() {
    for (const [state, score] of [[{}, 0], [{}, -5], [{}, NaN], [{ 'cabinet.scores': table(full) }, 100]]) {
      const g = await Game.open({ state }); await g.begin();
      await g.cmd(`over ${score}`); await g.passResult(); await sleep(400);
      await g.press(K.a); await sleep(300); await g.press(K.a); // table, then play again
      await g.until(() => testLog.filter((m) => m.type === 'started').length === 2, null, 12000);
      eq(await g.log('score'), [], `messages for ${score}`);
      await g.close();
    }
  },
  async 'scores are floored and capped'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('versus 12.9 5000000000'); await g.passResult(); await g.enter(2); await g.enter(1);
    eq((await g.log('score')).map((m) => m.score), [999999999, 12], 'scores'); await g.shot('table-wide');
    await g.close();
  },
  async 'stored tables load, and corrupt ones read as empty and can be replaced'() {
    const good = table(full);
    const g = await Game.open({ state: { 'cabinet.scores': good } }); await g.begin();
    const s = (await g.state()).scores;
    eq([s.length, s[0], s[9]], [10, { initials: 'ÆØÅ', score: 1000, player: 1 }, { initials: 'ÆØÅ', score: 100, player: 2 }], 'loaded');
    await g.close();
    const bad = {
      empty: [], short: [0x4c], 'flipped byte': good.map((v, i) => (i === 9 ? v ^ 1 : v)), truncated: good.slice(0, -5),
      'wrong version': good.map((v, i) => (i === 2 ? 9 : v)), 'huge count': [0x4c, 0x53, 1, 255, 0, 0], text: [...Buffer.from('{"a":"x')],
      'bad initials': table([['a-!', 5, 1]]), 'bad player': table([['AAA', 5, 3]]), unsorted: table([['AAA', 5, 1], ['BBB', 9, 1]]), zero: table([['AAA', 0, 1]]),
    };
    for (const [name, bytes] of Object.entries(bad)) {
      const h = await Game.open({ state: { 'cabinet.scores': bytes } }); await h.begin();
      eq((await h.state()).scores, [], name);
      if (name === 'flipped byte') {
        await h.cmd('over 7'); await h.passResult(); await h.enter();
        eq(await h.saved('cabinet.scores'), table([['AAA', 7, 1]]), 'replaced');
      }
      await h.close();
    }
  },
  async 'resetHighScores empties the table'() {
    const g = await Game.open({ state: { 'cabinet.scores': table(full) } }); await g.begin();
    await g.cmd('reset'); await sleep(400);
    eq([(await g.state()).scores, await g.saved('cabinet.scores')], [[], undefined], 'table');
    await g.close();
  },
  async 'built-in game over is routed to ours'() {
    for (const [cmd, player] of [['builtin', 1], ['builtin2', 2], ['lives', 1]]) {
      const g = await Game.open(); await g.begin();
      await g.cmd(`${cmd} 42`); await sleep(400); await g.passResult(); await g.enter(player);
      eq((await g.log('score')).map((m) => [m.score, m.player]), [[42, player]], cmd);
      await g.close();
    }
  },
  async 'gameOver from the frame loop, while paused, and called twice'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('frameover 9'); await g.passResult(); await g.enter();
    eq((await g.log('score')).length, 1, 'from onUpdate'); await g.close();
    const h = await Game.open(); await h.begin();
    await h.press(K.menu); await h.cmd('over 8'); await h.cmd('over 7'); await sleep(500);
    await h.press(K.b); await sleep(300); await h.passResult(); await h.enter();
    eq((await h.log('score')).map((m) => m.score), [8], 'paused, twice');
    await h.close();
  },
  async 'a game that never calls start keeps MakeCode\'s menu but can use gameOver'() {
    const g = await Game.open({ state: { nostart: [1] } }); await sleep(300);
    await g.press(K.menu); await sleep(200);
    eq([(await g.state()).systemMenu, (await g.state()).paused], [true, false], 'system menu');
    await g.press(K.menu); await sleep(200);
    await g.cmd('over 5'); await g.passResult(); await g.enter();
    eq((await g.log('score')).length, 1, 'score');
    await g.close();
  },
  async 'initials time out so an absent player cannot block the cabinet'() {
    const g = await Game.open(); await g.begin();
    await g.cmd('over 5 2'); await g.passResult(); await sleep(31500);
    eq((await g.log('score')).map((m) => m.initials), ['AAA'], 'score');
    await g.close();
  },
  async 'screens (pictures only)'() {
    const g = await Game.open({ state: { 'cabinet.scores': table(full) } });
    await g.shot('title'); await g.press(K.right); await g.shot('title-table'); await g.press(K.right); await g.shot('title-howto');
    await g.begin(); await g.press(K.menu); await sleep(150); await g.shot('pause'); await g.close();
    const a = await Game.open({ state: { art: [1] } }); await a.shot('title-art'); await a.close();
    const d = await Game.open({ program: 'demo' });
    await d.shot('demo-title'); await d.press(K.left); await d.shot('demo-howto'); await d.press(K.a); await sleep(2500); await d.shot('demo-play');
    await d.press(K.a + P2); await sleep(1500); await d.press(K.menu); await sleep(150); await d.shot('demo-pause');
    await d.close();
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  if (!name.includes(filter)) continue;
  try { await test(); console.log('ok    ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  for (const c of browser.contexts()) await c.close();
}
await browser.close();
server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
