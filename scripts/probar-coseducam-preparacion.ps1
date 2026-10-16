param(
  [ValidateSet('simulacion','control','diagnostico','preparar')]
  [string]$Modo = 'control',
  [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
  [string]$Fecha = '2026-10-15',
  [uri]$Endpoint = 'https://ygshfayhmzqhemzanvhz.supabase.co/functions/v1/coseducam-worker'
)
$ErrorActionPreference = 'Stop'
if ($Endpoint.Scheme -ne 'https' -or $Endpoint.Host -notmatch '^[a-z0-9]+\.supabase\.co$' -or
    $Endpoint.AbsolutePath -ne '/functions/v1/coseducam-worker' -or
    $Endpoint.Query -or $Endpoint.Fragment -or $Endpoint.UserInfo) {
  throw 'Indica el endpoint HTTPS de coseducam-worker en tu proyecto Supabase.'
}
$taskHeaders = @{}
if ($Modo -ne 'simulacion') {
  $taskSecureToken = Read-Host 'DAILY_SYNC_TEST_TOKEN (entrada oculta)' -AsSecureString
  $taskHeaders['x-daily-test-token'] = [System.Net.NetworkCredential]::new('', $taskSecureToken).Password
}
try {
  $taskUri = '{0}?modo={1}&fecha={2}' -f $Endpoint.AbsoluteUri, $Modo, $Fecha
  Invoke-RestMethod -Method Post -Uri $taskUri -Headers $taskHeaders -Body '{}' `
    -ContentType 'application/json' -MaximumRedirection 0 -TimeoutSec 25 | ConvertTo-Json -Depth 12
} finally {
  $taskHeaders.Clear()
  Remove-Variable taskSecureToken -ErrorAction SilentlyContinue
}
