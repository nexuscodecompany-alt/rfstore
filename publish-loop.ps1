$ErrorActionPreference = 'Continue'
$totalIterations = 110  # 513 pending / 5 per run = ~103 + margen
$success = 0
$failed = 0

Write-Host "Procesando cola ML en loop..."

for ($i = 1; $i -le $totalIterations; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-process-publish-queue" -Method POST -ContentType "application/json" -Body "{}" -TimeoutSec 15 -UseBasicParsing
        $success++
        if ($i % 10 -eq 0) { Write-Host ("Iter {0}/{1} - OK" -f $i, $totalIterations) }
    } catch {
        $failed++
        Write-Host ("Iter {0} fallo: {1}" -f $i, $_.Exception.Message)
    }
    Start-Sleep -Seconds 28
}

Write-Host "`nLoop finalizado: $success disparados, $failed fallos en el trigger"
