// Island shim: the galaxy's on-device crash recorder is a no-op when embedded in HarnessMap.
export function setCrashContext(_ctx?: unknown): void {}
export function recordCrashEvent(_e?: unknown): void {}
export function getCrashDiagnostics(): null { return null; }
export function clearCrashDiagnostics(): void {}
