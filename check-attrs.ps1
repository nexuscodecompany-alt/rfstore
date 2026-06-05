$ErrorActionPreference = 'Continue'
# Obtenemos token via Supabase Edge Function (usa ml_credentials)
$tokenResp = Invoke-WebRequest -Uri "https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-token-refresh" -Method GET -UseBasicParsing -ErrorAction SilentlyContinue
Write-Host "Token endpoint response: $($tokenResp.StatusCode)"

# En lugar de eso, listo solo la cat con curl publico (algunas categorias son publicas)
$cat = $args[0]
if (-not $cat) { $cat = "MLU14407" }
Write-Host "Consultando atributos required de la categoria $cat"
$resp = Invoke-WebRequest -Uri "https://api.mercadolibre.com/categories/$cat/attributes" -Method GET -UseBasicParsing
$attrs = $resp.Content | ConvertFrom-Json
Write-Host "Total atributos: $($attrs.Count)"
Write-Host ""
Write-Host "REQUIRED o CATALOG_REQUIRED:"
foreach ($a in $attrs) {
    if ($a.tags.required -eq $true -or $a.tags.catalog_required -eq $true) {
        $req = if ($a.tags.required) { "REQ" } else { "CAT" }
        $vals = if ($a.values) { ($a.values | Select-Object -First 5 | ForEach-Object { $_.name }) -join ", " } else { "-" }
        Write-Host ("  [$req] {0} ({1}) - type:{2} - values: {3}" -f $a.id, $a.name, $a.value_type, $vals)
    }
}
