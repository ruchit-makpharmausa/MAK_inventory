#requires -Version 5.1
#requires -RunAsAdministrator
<#
Run in Windows PowerShell as Administrator on the SQL Server PC.
Creates a dedicated self-signed server certificate with DNS/IP identity,
gives the selected SQL Server service read access to its private key,
and exports only its public certificate for this app to trust explicitly.
SQL Server certificate selection and service restart are manual steps.
#>
[CmdletBinding()]
param(
  [string]$ServerAddress = '192.168.1.114',
  [string]$SqlServiceName,
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') {
  throw 'Run this script in Windows PowerShell (powershell.exe), as Administrator.'
}
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open Windows PowerShell as Administrator on the SQL Server PC.'
}
$address = [Net.IPAddress]::Parse($ServerAddress)
if ($address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'ServerAddress must be the IPv4 address used by the app.'
}
$localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress)
if ($localAddresses -notcontains $ServerAddress) {
  throw "This PC does not own $ServerAddress. Run this script on the SQL Server PC."
}
$services = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -eq 'MSSQLSERVER' -or $_.Name -like 'MSSQL$*' })
if ($services.Count -eq 0) { throw 'No SQL Server Database Engine service was found on this PC.' }
if (-not $SqlServiceName) {
  if ($services.Count -eq 1) { $SqlServiceName = $services[0].Name }
  else {
    $services | Select-Object Name, DisplayName, StartName | Format-Table -AutoSize | Out-Host
    $SqlServiceName = Read-Host 'Enter the Name of the SQL Server service that serves port 1433'
  }
}
$service = $services | Where-Object { $_.Name -eq $SqlServiceName } | Select-Object -First 1
if (-not $service) { throw 'The selected service is not a detected SQL Server Database Engine service.' }

$computer = Get-CimInstance Win32_ComputerSystem
$shortName = $computer.DNSHostName
$suffix = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().DomainName
$hostName = if ($suffix) { "$shortName.$suffix" } else { $shortName }
$dnsNames = @($shortName, $hostName) | Select-Object -Unique
$sanEntries = @($dnsNames | ForEach-Object { "DNS=$_" })
$sanEntries += "IPAddress=$ServerAddress"
$san = $sanEntries -join '&'
$friendlyName = "MAK SQL Server TLS - $ServerAddress"
$certificate = Get-ChildItem Cert:\LocalMachine\My | Where-Object {
  $_.FriendlyName -eq $friendlyName -and $_.Subject -eq "CN=$hostName" -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30)
} | Sort-Object NotAfter -Descending | Select-Object -First 1

if (-not $certificate) {
  $parameters = @{
    Type = 'Custom'
    Subject = "CN=$hostName"
    FriendlyName = $friendlyName
    CertStoreLocation = 'Cert:\LocalMachine\My'
    Provider = 'Microsoft RSA SChannel Cryptographic Provider'
    KeySpec = 'KeyExchange'
    KeyAlgorithm = 'RSA'
    KeyLength = 2048
    HashAlgorithm = 'SHA256'
    KeyExportPolicy = 'NonExportable'
    KeyUsage = @('DigitalSignature', 'KeyEncipherment')
    TextExtension = @('2.5.29.37={text}1.3.6.1.5.5.7.3.1', "2.5.29.17={text}$san")
    NotAfter = (Get-Date).AddYears(2)
  }
  $certificate = New-SelfSignedCertificate @parameters
}

$key = $certificate.PrivateKey
if (-not $key -or $key.CspKeyContainerInfo.KeyNumber.ToString() -ne 'Exchange') {
  throw 'The certificate does not have the legacy KeyExchange key required by SQL Server.'
}
$keyPath = Join-Path (Join-Path $env:ProgramData 'Microsoft\Crypto\RSA\MachineKeys') $key.CspKeyContainerInfo.UniqueKeyContainerName
$account = if ($service.StartName -eq 'LocalSystem') { 'NT AUTHORITY\SYSTEM' } else { $service.StartName }
$identity = [Security.Principal.NTAccount]::new($account)
$sid = $identity.Translate([Security.Principal.SecurityIdentifier])
$acl = Get-Acl -LiteralPath $keyPath
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::Read, [Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $keyPath -AclObject $acl

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MAK-SQL-Certificate'
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$pemPath = Join-Path $OutputDirectory "mak-sql-server-$($certificate.Thumbprint.Substring(0, 8)).pem"
$encoded = [Convert]::ToBase64String($certificate.RawData, [Base64FormattingOptions]::InsertLineBreaks)
[IO.File]::WriteAllText($pemPath, "-----BEGIN CERTIFICATE-----`r`n$encoded`r`n-----END CERTIFICATE-----`r`n", [Text.Encoding]::ASCII)

Write-Output "Certificate created or reused: $friendlyName"
Write-Output "Subject: $($certificate.Subject)"
Write-Output "Thumbprint: $($certificate.Thumbprint)"
Write-Output "SQL Server service: $SqlServiceName"
Write-Output "Public certificate: $pemPath"
Write-Output ''
Write-Output 'Next: open SQL Server Configuration Manager, select this certificate for the instance, then restart the selected SQL Server service when ready.'
Write-Output 'The restart briefly interrupts database connections. The script has not restarted the service.'
Write-Output 'Copy the public .pem file to the app PC and set SQLSERVER_CA_FILE to its local path. Keep SQLSERVER_TRUST_SERVER_CERTIFICATE=false.'
