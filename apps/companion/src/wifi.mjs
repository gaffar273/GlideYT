import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {AppError} from './errors.mjs';

// Windows UAC remains interactive. This only requests a narrowly scoped rule; it cannot approve UAC.
export function requestPrivateWifiAccess(port) {
  if (process.platform !== 'win32' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new AppError('Automatic Wi-Fi setup is available on Windows only.');
  }
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = `$ErrorActionPreference='Stop';
    foreach ($protocol in 'TCP','UDP') {
    $name = "LanTube-Private-$protocol-${port}";
    $existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue;
    if ($existing) {
      if ($existing.Enabled -ne 'True' -or $existing.Action -ne 'Allow' -or $existing.Profile -ne 'Private') { throw 'Existing Glide YT firewall rule needs manual review.' }
    } else {
      New-NetFirewallRule -Name $name -DisplayName "Glide YT - Private Wi-Fi ($protocol)" -Direction Inbound -Action Allow -Protocol $protocol -LocalPort ${port} -RemoteAddress LocalSubnet -Program ${quote(process.execPath)} -Profile Private | Out-Null
    }}`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const elevate = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ${quote(powershell)} -ArgumentList @('-NoProfile','-EncodedCommand',${quote(encoded)}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-Command', elevate], {windowsHide: true, stdio: 'ignore'});
    child.once('error', () => reject(new AppError('Could not request Windows Wi-Fi approval.')));
    child.once('exit', code => code === 0 ? resolve({ok: true, message: 'Private Wi-Fi access is enabled.'})
      : reject(new AppError('Windows administrator approval was cancelled or unavailable. Use this button again to retry.')));
  });
}
