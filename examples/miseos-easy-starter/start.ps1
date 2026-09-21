$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example."
    Write-Host "Add OPENROUTER_API_KEY to .env, then run .\start.ps1 again."
    exit 0
}

npm start -- @args
