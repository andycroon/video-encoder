Set-Location $PSScriptRoot
pip install -e .
Set-Location frontend
npm install
npm run build
Set-Location ..
