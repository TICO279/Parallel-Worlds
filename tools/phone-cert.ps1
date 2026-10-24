param([Parameter(Mandatory=$true)][string]$Address,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$parsedAddress=[System.Net.IPAddress]::Parse($Address)
if($parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork){throw 'An IPv4 address is required.'}
[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$rootKey=[System.Security.Cryptography.RSA]::Create(2048)
$leafKey=[System.Security.Cryptography.RSA]::Create(2048)
$root=$null; $leaf=$null; $withKey=$null
try {
  $algorithm=[System.Security.Cryptography.HashAlgorithmName]::SHA256
  $padding=[System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  $rootRequest=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Parallel Worlds Phone Test Root',$rootKey,$algorithm,$padding)
  $rootRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$true,0,$true))
  $rootRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign,$true))
  $rootRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($rootRequest.PublicKey,$false))
  $notBefore=[DateTimeOffset]::UtcNow.AddMinutes(-5)
  $root=$rootRequest.CreateSelfSigned($notBefore,[DateTimeOffset]::UtcNow.AddDays(14))
  $leafRequest=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$Address",$leafKey,$algorithm,$padding)
  $leafRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
  $leafRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,$true))
  $usage=[System.Security.Cryptography.OidCollection]::new(); $usage.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
  $leafRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage,$false))
  $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddIpAddress($parsedAddress)
  $leafRequest.CertificateExtensions.Add($san.Build())
  $serial=[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16); $serial[0]=$serial[0] -band 127
  $expires=[DateTimeOffset]::UtcNow.AddDays(7)
  $leaf=$leafRequest.Create($root,$notBefore,$expires,$serial)
  $withKey=[System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($leaf,$leafKey)
  [System.IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'phone.pfx'),$withKey.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,''))
  [System.IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'root.cer'),$root.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  @{host=$Address;expiresAt=$expires.ToUnixTimeMilliseconds();fingerprint=$root.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'certificate.json') -Encoding utf8
} finally {
  if($withKey){$withKey.Dispose()};if($leaf){$leaf.Dispose()};if($root){$root.Dispose()};$leafKey.Dispose();$rootKey.Dispose()
}
# No certificate is installed in Windows. The root signing key is never written to disk.
