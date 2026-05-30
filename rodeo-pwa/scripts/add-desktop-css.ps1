
$cssToAdd = @"

/* BASTON DESKTOP - dos columnas (agregado por audit script) */
@media (min-width: 1024px) {
  .baston-desktop-cols {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 24px;
    align-items: start;
    width: 100%;
  }
  .baston-col-ble {
    position: sticky;
    top: 88px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .baston-col-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  /* RECORRIDA DESKTOP - dos columnas */
  .recorrida-desktop-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    align-items: start;
    width: 100%;
  }
  .recorrida-col-grabadora {
    display: flex;
    flex-direction: column;
    gap: 20px;
    position: sticky;
    top: 88px;
  }
  .recorrida-col-lista {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
"@

$cssPath = Join-Path $PSScriptRoot "..\css\estilos.css"
Add-Content -Path $cssPath -Value $cssToAdd -Encoding UTF8
Write-Host "CSS desktop grid rules appended to estilos.css"
