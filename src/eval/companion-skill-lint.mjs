// Instruction-integrity lint for the codex-built companion path (Jacob 2026-10-01: the user
// has a Codex agent BUILD the companion by following our instructions — so a path/endpoint/
// command named in a skill that has quietly moved is a real "codex-built" bug, because the
// agent runs the instruction literally). This checks that everything the companion skill +
// install.sh tell a Codex agent to touch actually exists and parses. Pairs with
// companion-install-check.mjs (which drives the script's branching logic).
//
// Run: bun run src/eval/companion-skill-lint.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
let pass = 0, fail = 0; const out = [];
const check = (name, cond, detail) => { if (cond) { pass++; out.push(`  PASS ${name}`); } else { fail++; out.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };

console.log('== companion-skill-lint: the codex-built companion instructions point at real things ==');

// install.sh: exists + valid POSIX/bash syntax (a Codex agent runs it verbatim)
check('install.sh exists', existsSync(join(ROOT, 'companion/install.sh')));
{ const r = spawnSync('bash', ['-n', join(ROOT, 'companion/install.sh')], { encoding: 'utf8' });
  check('install.sh parses (bash -n)', r.status === 0, (r.stderr || '').trim()); }

// The companion skill tells the agent to run the installer at this exact path; the repo copy
// that ships to ~/.harnessmap/app must be the one it points at.
const skill = read('codex-plugin/skills/companion/SKILL.md');
check('companion skill exists', skill.length > 0);
check('companion skill points at install.sh', /\.harnessmap\/app\/companion\/install\.sh/.test(skill));

// Artifacts the skill names (debug steps + build inputs) must exist.
for (const f of ['companion/web/index.html', 'companion/src-tauri/src/lib.rs', 'companion/src-tauri/tauri.conf.json', 'companion/src-tauri/capabilities/default.json', 'companion/app-icon-source.png'])
  check(`artifact exists: ${f.replace('companion/', '')}`, existsSync(join(ROOT, f)));

// Tauri invoke commands the skill lists must be defined in the native shell.
const lib = read('companion/src-tauri/src/lib.rs');
for (const c of ['map_port_cmd', 'map_ready', 'open_map', 'start_drag', 'reset_position'])
  check(`invoke command defined: ${c}`, new RegExp(`fn\\s+${c}\\b`).test(lib));

// The skill promises macOS transparency hinges on this flag.
const confRaw = read('companion/src-tauri/tauri.conf.json');
const privateApi = /"macOSPrivateApi"\s*:\s*true/.test(confRaw);
check('tauri.conf macOSPrivateApi=true', privateApi);

// Cargo.toml tauri features MUST enable `macos-private-api` whenever the config sets
// macOSPrivateApi:true — Tauri's build script enforces the match. `cargo tauri build`
// auto-injects the feature (so CI/macOS stayed green without it), but a plain `cargo build`/
// `cargo check` — the natural way a fresh/codex build verifies compilation — fails with
// "the tauri dependency features … does not match the allowlist … add the macos-private-api
// feature". A real codex-built bug; this lint keeps the two files consistent. (Found 2026-10-01
// by driving a real in-box build.)
const cargoToml = read('companion/src-tauri/Cargo.toml');
const tauriDepLine = (cargoToml.match(/^\s*tauri\s*=\s*\{[^\n]*\}/m) || [''])[0];
const hasFeature = /macos-private-api/.test(tauriDepLine);
check('Cargo.toml tauri features include macos-private-api (matches conf allowlist)',
  !privateApi || hasFeature,
  privateApi ? `conf sets macOSPrivateApi:true but tauri dep features lack macos-private-api — plain cargo build/check will fail: ${tauriDepLine.trim() || '(tauri dep line not found)'}` : '');

// HTTP endpoints the widget (per the skill) calls must be served. server.ts matches most paths
// with regexes, so accept either a literal string or a path.match(/.../), tolerant of the <id>.
const server = read('src/server.ts');
const served = (ep) => {
  if (server.includes(`'${ep}'`) || server.includes(`"${ep}"`) || server.includes(ep)) return true;
  const esc = ep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\\\?/`).test(server) && new RegExp(esc.replace(/\//g, '\\\\?/')).test(server);
};
for (const [ep, re] of [
  ['/widget', /['"]\/widget/],
  ['/api/state', /\/api\/state/],
  ['/api/influence/toggle', /influence\/toggle/],
  ['/api/map-chat', /\/api\/map-chat|map-chat/],
  ['/api/nodes/<id>/favorite', /\/api\\?\/nodes\\?\/\(\[[\\\w-]+\]\+\)\\?\/favorite|nodes\/.*favorite/],
  ['/api/chats/<id>/focus', /chats\/.*\/focus|\/focus\$/],
  ['/api/chats/<id>/lit', /chats\/.*\/lit|\/lit\$/],
  ['/api/chats/<id>/zoomin', /chats\/.*\/zoomin|zoomin/],
  ['/ws (websocket)', /['"]\/ws['"]|\/ws\b/],
]) check(`endpoint served: ${ep}`, re.test(server), 'not found in src/server.ts');

// The codex plugin skills a user invokes must each exist with frontmatter.
const skillsDir = join(ROOT, 'codex-plugin/skills');
const expected = ['companion', 'update', 'doctor', 'restart', 'open', 'close', 'status', 'stop', 'help'];
for (const s of expected) {
  const md = read(`codex-plugin/skills/${s}/SKILL.md`);
  check(`codex skill ok: ${s}`, md.length > 0 && /^---[\s\S]*name:[\s\S]*description:[\s\S]*---/.test(md), md ? 'missing frontmatter' : 'missing SKILL.md');
}

console.log(out.join('\n'));
console.log(`\n================ companion-skill-lint · ${pass} passed, ${fail} failed ================`);
process.exit(fail ? 1 : 0);
