// M376 — the single choke-point for spawning child processes.
//
// Every production spawn goes through here so no call site has to remember windowsHide, and none can forget it:
// on Windows a child spawned without windowsHide flashes a console window (Mark hit this repeatedly, fixed piecemeal
// in 0.9.79/0.9.81 before this). windowsHide is a Windows-only flag — Bun/Node ignore it on Linux and macOS — so
// defaulting it true is cross-platform safe. Callers may still override it (e.g. the embedded terminal's ConPTY,
// which is a real visible console) by passing windowsHide explicitly.
//
// The repo-hygiene guard (src/eval/repo-hygiene.ts) fails the build if a raw Bun.spawn/spawnSync appears in
// production code (hooks/, src/, excluding this file's own two calls and the ConPTY terminal) without windowsHide,
// so a new spawn that bypasses this wrapper is caught in CI rather than on a founder's machine.

type SpawnArgs = Parameters<typeof Bun.spawn>;
type SpawnSyncArgs = Parameters<typeof Bun.spawnSync>;

export function spawnHidden(cmd: SpawnArgs[0], opts: SpawnArgs[1] = {}) {
  return Bun.spawn(cmd as any, { windowsHide: true, ...(opts as any) });
}

export function spawnSyncHidden(cmd: SpawnSyncArgs[0], opts: SpawnSyncArgs[1] = {}) {
  return Bun.spawnSync(cmd as any, { windowsHide: true, ...(opts as any) });
}
