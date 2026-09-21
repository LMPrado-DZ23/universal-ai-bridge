param([Parameter(Mandatory=$true)][string]$File,[switch]$Production)
$ErrorActionPreference='Stop'
$sig=Get-AuthenticodeSignature -LiteralPath $File
if($Production -and $sig.Status -ne 'Valid'){throw 'Release de producao exige Authenticode valido.'}
if($sig.Status -ne 'Valid'){Write-Output 'Preview unsigned; nao homologado.'}
