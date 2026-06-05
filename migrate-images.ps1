$ErrorActionPreference = 'Continue'

# Codes cargados via SQL del MCP
$codes = Get-Content -Path 'codes.json' | ConvertFrom-Json

$chunkSize = 50
$total = $codes.Count
$processed = 0
$totalRenamed = 0
$chunkNum = 0

Write-Host "Procesando $total codes en chunks de $chunkSize"

for ($i = 0; $i -lt $total; $i += $chunkSize) {
    $chunkNum++
    $end = [Math]::Min($i + $chunkSize - 1, $total - 1)
    $chunk = $codes[$i..$end]
    $body = @{ codes = $chunk } | ConvertTo-Json -Compress
    try {
        $resp = Invoke-WebRequest -Uri "https://bwjptocnkqedakdibosu.supabase.co/functions/v1/cdr-fix-image-extensions" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 180 -UseBasicParsing
        $data = $resp.Content | ConvertFrom-Json
        $processed += $chunk.Count
        $totalRenamed += $data.renamed
        Write-Host ("Chunk {0}/{1} ({2}/{3} codes) - renombrados: {4} - tiempo: {5}s" -f $chunkNum, [Math]::Ceiling($total/$chunkSize), $processed, $total, $data.renamed, $data.elapsed_s)
    } catch {
        Write-Host ("Chunk {0} FALLO: {1}" -f $chunkNum, $_.Exception.Message)
    }
}

Write-Host "`nTOTAL: $processed codes procesados, $totalRenamed imagenes renombradas"
