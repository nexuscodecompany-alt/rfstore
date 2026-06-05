$ErrorActionPreference = 'Continue'
$totalIterations = 100
$success = 0
$failed = 0

Write-Host "Loop #2 - Procesando 100 iter..."

for ($i = 1; $i -le $totalIterations; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-process-publish-queue" -Method POST -ContentType "application/json" -Body "{}" -TimeoutSec 15 -UseBasicParsing
        $success++
        if ($i % 10 -eq 0) { Write-Host ("L2 Iter {0}/{1} - OK" -f $i, $totalIterations) }
    } catch {
        $failed++
    }
    Start-Sleep -Seconds 14  # mitad del primer loop para acelerar
}

Write-Host "`nLoop #2 finalizado: $success disparados, $failed fallos"
