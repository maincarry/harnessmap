// Codex supplies the event and collects context through redirected handles.
// CreateNoWindow alone does not preserve those handles on Windows: explicitly
// pipe all three streams, copying bytes so JSON/Unicode survive unchanged.
export function windowsHookCommand(bun: string, quotedScript: string): string {
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    '$ErrorActionPreference=\'Stop\'',
    '$i=New-Object Diagnostics.ProcessStartInfo',
    `$i.FileName=${literal(bun)}`,
    `$i.Arguments=${literal(`run ${quotedScript}`)}`,
    '$i.UseShellExecute=$false',
    '$i.CreateNoWindow=$true',
    '$i.RedirectStandardInput=$true',
    '$i.RedirectStandardOutput=$true',
    '$i.RedirectStandardError=$true',
    '$p=[Diagnostics.Process]::Start($i)',
    '$o=$p.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())',
    '$e=$p.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())',
    '[Console]::OpenStandardInput().CopyTo($p.StandardInput.BaseStream)',
    '$p.StandardInput.Close()',
    '$p.WaitForExit()',
    '[void]$o.GetAwaiter().GetResult()',
    '[void]$e.GetAwaiter().GetResult()',
    'exit $p.ExitCode',
  ].join(';');
}
