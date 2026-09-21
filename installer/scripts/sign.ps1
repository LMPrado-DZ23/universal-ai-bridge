# Signing material stays in memory; never pass certificate/password in argv.
param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference='Stop'
if(-not $env:CODE_SIGN_PFX_BASE64 -or -not $env:CODE_SIGN_PASSWORD){throw 'Certificado/senha de assinatura ausentes.'}
$cert=$null
try {
  $bytes=[Convert]::FromBase64String($env:CODE_SIGN_PFX_BASE64)
  $cert=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes,$env:CODE_SIGN_PASSWORD,[System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
  if(-not $cert.HasPrivateKey){throw 'Certificado sem chave privada.'}
  $sig=Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
  if($sig.Status -ne 'Valid'){throw 'Assinatura do instalador nao validada.'}
} catch { throw 'Falha de assinatura Authenticode; nenhuma release autorizada.' }
finally {if($cert){$cert.Dispose()}; if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}}
