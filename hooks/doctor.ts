#!/usr/bin/env bun
// M267 (Jacob, 2026-09-15: "do you have a serious map debug mode where if the user
// finds installation error they can just ask the hook these things?"): the map
// doctor. One run answers: is the server up, on which build, is the code current,
// where is the database, which engine and is it signed in, are the hooks in place,
// does the engine actually answer. --fix applies what a program may (start the
// server, restart a stale one, switch an engine that cannot work, re-derive stale
// hook entries); --update pulls a newer map; YOU lines are the steps only the
// person can take (trust the hooks, sign in). Run by the "doctor" skill, the
// installers, and by hand:  bun run hooks/doctor.ts [--fix] [--update] [--no-probe]
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HOME, BASE, ensureServer } from './common.js';
import { codexBin, claudeBin } from '../src/harness-bins.js';

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const args = new Set(process.argv.slice(2));
const FIX = args.has('--fix'), UPDATE = args.has('--update'), PROBE = !args.has('--no-probe');
const NO_UPDATE_CHECK = args.has('--no-update-check'); // the installer just pulled — nothing to ask GitHub
const PROBE_MS = Number([...args].find((a) => a.startsWith('--probe-timeout='))?.split('=')[1] ?? 60_000) || 60_000;
type Level = 'OK' | 'FIX' | 'YOU' | 'WARN' | 'FAIL';
const lines: { level: Level; text: string }[] = [];
const say = (level: Level, text: string) => lines.push({ level, text });
const sh = (argv: string[], timeout = 8000) => { try { const r = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe', timeout, windowsHide: true }); return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() }; } catch (e) { return { code: -1, out: '', err: String(e) }; } };
const getJ = async (u: string, ms = 4000): Promise<any> => { try { const r = await fetch(BASE + u, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
const postJ = async (u: string, body: unknown = {}, ms = 20000): Promise<{ status: number; json: any; error?: string }> => { try { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return { status: r.status, json: await r.json().catch(() => null) }; } catch (e) { return { status: 0, json: null, error: String(e).slice(0, 120) }; } };
const kb = (p: string) => { try { return `${Math.max(1, Math.round(statSync(p).size / 1024))} KB`; } catch { return '?'; } };

// 1. the app and its code
const isGit = existsSync(join(APP, '.git'));
const disk = isGit ? sh(['git', '-C', APP, 'rev-parse', '--short', 'HEAD']).out : '';
say('OK', `app: ${APP}${disk ? ` — code on disk: build ${disk}` : ' — not a git checkout (a plugin-cache copy; updates come through the harness: /plugin update map@harnessmap)'}`);
say('OK', `bun ${Bun.version}; data home: ${HOME}`);

// 2. the server
let st = await getJ('/api/state');
if (!st) {
  if (FIX) {
    const r = await ensureServer();
    st = r.up ? await getJ('/api/state') : null;
    say(st ? 'FIX' : 'FAIL', st ? `the server was down — started it at ${BASE}` : `the server is down and would not start — the last lines of ${join(HOME, 'server.log')} say why`);
  } else say('FAIL', `the server is not answering at ${BASE} — run the doctor with --fix to start it (a new session's hook starts it too)`);
}
if (st && st.machine && st.machine !== hostname()) say('FAIL', `the port is answered by a map server on ANOTHER machine ("${st.machine}") — an SSH tunnel or port forward; close it`);
else if (st) {
  const mapName = (st.projects ?? []).find((p: any) => p.id === st.projectId)?.name ?? '?';
  say('OK', `server up at ${BASE} — build ${st.build || st.version}, showing the map "${mapName}" (${(st.nodes ?? []).length} nodes, ${(st.projects ?? []).length} map(s))`);
  if (disk && st.build && st.build !== disk) {
    if (FIX) { await postJ('/api/shutdown'); await new Promise((r) => setTimeout(r, 1200)); const r = await ensureServer(); st = r.up ? await getJ('/api/state') : st; say(r.up ? 'FIX' : 'FAIL', r.up ? `the server ran ${st?.build} while the code on disk was ${disk} — restarted on the new code` : 'the stale server was stopped but did not come back — start a new session'); }
    else say('WARN', `the server runs build ${st.build} but the code on disk is ${disk} — it restarts itself within a minute (or run the doctor with --fix)`);
  }
}

// 3. is the code current
if (st && !NO_UPDATE_CHECK) {
  const uc = (await postJ('/api/update-check', {}, 8000)).json;
  if (uc) {
    const newer = uc.updateAvailable ? `v${uc.updateAvailable}` : uc.updateBuild ? `build ${uc.updateBuild}` : '';
    if (newer && UPDATE && uc.canSelfUpdate) {
      const u = await postJ('/api/update', {}, 200_000);
      if (u.json?.ok && u.json.changed) { say('FIX', `updated ${u.json.from} → ${u.json.to}; the server is restarting${u.json.hooksChanged ? ' — the hook definitions changed' : ''}`); if (u.json.hooksChanged) say('YOU', 'Codex will ask you to trust the changed hook entries once more: run codex, then /hooks'); }
      else say(u.json?.ok ? 'OK' : 'FAIL', u.json?.ok ? 'nothing to pull — already current' : `update failed: ${u.json?.error ?? u.error ?? 'HTTP ' + u.status}${u.json?.how ? ' — ' + u.json.how : ''}`);
    } else if (newer) say('WARN', `a newer map is available (${newer}; this one is ${uc.build || uc.current})${(uc.changes ?? []).length ? ` — ${uc.changes.length} change(s): ${uc.changes.slice(0, 3).map((c: any) => c.message.slice(0, 70)).join(' · ')}${uc.changes.length > 3 ? ' …' : ''}` : ''} — say "update map", press ⬆ on the map page, or run the doctor with --update`);
    else say('OK', `the code is current (build ${uc.build || disk || uc.current})`);
  } else say('WARN', 'could not check for updates (offline?)');
}

// 4. the database
if (st?.storage) {
  say('OK', `database: ${st.storage} (${kb(st.storage)})`);
  const stray = join(APP, 'harnessmap.sqlite');
  if (existsSync(stray) && stray !== st.storage) say('WARN', `a second database exists at ${stray} (${kb(stray)}) — an earlier installer ran the server there; if maps look missing, say so: nothing is lost, the server can be pointed at it`);
}

// 5. the engine
const codex = codexBin(), claude = claudeBin();
const be = st ? await getJ('/api/backend') : null;
if (be) {
  const label = be.backend === 'codex' ? 'GPT via Codex (your ChatGPT plan)' : be.backend === 'api' ? 'Anthropic API key' : 'Claude (your Claude subscription)';
  say('OK', `engine: ${label} — ${be.source === 'env' ? 'fixed by HARNESSMAP_INFERENCE' : be.source === 'chosen' ? 'chosen (installer or ⚙ models)' : 'auto-detected'}; codex CLI ${codex ? 'found' : 'not found'}, claude CLI ${claude ? 'found' : 'not found'}`);
  if (be.backend === 'subscription' && !claude && codex) {
    if (FIX) { const r = await postJ('/api/backend', { backend: 'codex' }); say(r.json?.ok ? 'FIX' : 'FAIL', r.json?.ok ? 'the engine was Claude but no claude CLI exists here — switched to GPT via Codex' : `could not switch the engine: ${r.json?.error ?? r.error}`); }
    else say('WARN', 'the engine is Claude but no claude CLI exists here — run the doctor with --fix to switch to GPT via Codex (or choose it in ⚙ models)');
  }
  if (be.backend === 'codex') { if (codex) { const ls = sh([codex, 'login', 'status'], 10_000); const said = `${ls.out}\n${ls.err}`;
      // M342b (Mark): inside a sandbox the check itself fails ("Could not find home directory") — that is "could not check", not "signed out".
      if (ls.code === 0) say('OK', 'codex is signed in');
      else if (/not logged in|not signed in|no credentials|please run.*login|logged out/i.test(said)) say('YOU', 'codex is not signed in — run:  codex login');
      else say('WARN', `could not check the Codex sign-in from here (${(ls.err || ls.out || `exit ${ls.code}`).split('\n')[0].slice(0, 120)}) — run  codex login status  yourself; a sandbox without a home directory fails this check while the sign-in is fine`); } else say('YOU', 'the engine is Codex but no codex CLI was found (PATH or the Codex app) — install the Codex CLI or app, or choose Claude in ⚙ models'); }
  if (be.backend === 'subscription' && !claude) say('YOU', 'the engine is Claude but no claude CLI was found — install Claude Code and sign in, or choose GPT via Codex in ⚙ models');
}

// 6. the hooks
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const hooksFile = join(codexHome, 'hooks.json');
if (existsSync(hooksFile)) {
  let txt = ''; try { txt = readFileSync(hooksFile, 'utf8'); } catch {}
  const n = (txt.match(/harnessmap/g) ?? []).length;
  const appNorm = APP.replace(/\\/g, '/');
  const pointsHere = txt.replace(/\\\\/g, '/').includes(appNorm);
  if (!n) say('WARN', `Codex user hooks (${hooksFile}) carry no harnessmap entries — rerun the installer`);
  else if (!pointsHere) { if (FIX) { const r = sh([process.execPath, 'run', join(APP, 'hooks', 'enable-codex.ts'), '--force'], 30_000); say(r.code === 0 ? 'FIX' : 'FAIL', r.code === 0 ? 'the Codex hook entries pointed at another copy of the app — re-derived for this one' : `could not re-derive the Codex hooks: ${r.err.slice(-160)}`); say('YOU', 'Codex asks you to trust hook entries when they change: run codex, then /hooks'); } else say('WARN', 'the Codex hook entries point at another copy of the app — run the doctor with --fix'); }
  else say('OK', `Codex user hooks: ${n} harnessmap entries in ${hooksFile}, pointing at this app`);
  const h = st?.health ?? {};
  if (!h.promptAt && !h.filedAt) say('YOU', 'no Codex hook has reached the server yet. Codex runs hooks only after you trust them ONCE in the CLI: run  codex  in any folder, type  /hooks , accept the harnessmap entries. Then, in a NEW thread, say "open map".');
  else say('OK', `hooks are reaching the server (last prompt ${h.promptAt ? new Date(h.promptAt).toLocaleTimeString() : '—'}, last filed ${h.filedAt ? new Date(h.filedAt).toLocaleTimeString() : '—'})`);
} else if (codex) say('WARN', `no Codex user hooks file (${hooksFile}) — rerun the installer to register the map's hooks`);

// 7. does the engine answer
if (PROBE && st) {
  const p = await postJ('/api/doctor/probe', {}, PROBE_MS);
  if (p.json?.ok) say('OK', `the engine answers: ${p.json.backend} · ${p.json.model} · ${p.json.ms} ms`);
  else {
    const err = p.json?.error ?? p.error ?? `HTTP ${p.status}`;
    const hint = be?.backend === 'codex' ? 'sign in with  codex login , or choose Claude in ⚙ models' : be?.backend === 'api' ? 'check ANTHROPIC_API_KEY in the server\'s environment' : 'sign in by running  claude  once, or choose GPT via Codex in ⚙ models';
    say(p.status === 404 ? 'WARN' : 'FAIL', p.status === 404 ? 'this server predates the doctor\'s probe — update the map' : `the engine does not answer: ${String(err).slice(0, 160)} — ${hint}`);
  }
}
const ai = st ? await getJ('/api/auth-info') : null;
if (ai?.lastErr && (!ai.lastOkAt || ai.lastErrAt > ai.lastOkAt)) say('WARN', `the last agent call failed: ${String(ai.lastErr).slice(0, 140)}`);

// the report
const order: Level[] = ['FAIL', 'YOU', 'FIX', 'WARN', 'OK'];
console.log(`map doctor — ${new Date().toLocaleString()}${FIX ? ' (with --fix)' : ''}`);
for (const lv of order) for (const l of lines.filter((x) => x.level === lv)) console.log(`  ${lv.padEnd(4)} ${l.text}`);
const counts = order.map((lv) => [lv, lines.filter((x) => x.level === lv).length] as const).filter(([, n]) => n);
console.log(`summary: ${counts.map(([lv, n]) => `${n} ${lv}`).join(', ')}${lines.some((l) => l.level === 'YOU') ? ' — the YOU lines are steps only you can take' : ''}${!FIX && lines.some((l) => l.level === 'WARN' || l.level === 'FAIL') ? ' — rerun with --fix to apply the fixes a program may' : ''}`);
console.log('words the agent knows: open map · close map · map doctor · update map · map status');
process.exit(lines.some((l) => l.level === 'FAIL') ? 2 : 0);
