$ErrorActionPreference = 'Continue'
# Loop conservador: 1 invocacion cada 20s, max 10 iteraciones (procesa 50 items, suficiente para los ~9 monitores con margen)
for ($i = 1; $i -le 10; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-process-publish-queue" -Method POST -ContentType "application/json" -Body "{}" -TimeoutSec 15 -UseBasicParsing
        Write-Host ("Iter {0}/10 - OK" -f $i)
    } catch {
        Write-Host ("Iter {0} fallo: {1}" -f $i, $_.Exception.Message)
    }
    if ($i -lt 10) { Start-Sleep -Seconds 20 }
}
Write-Host "Loop monitor finalizado"
