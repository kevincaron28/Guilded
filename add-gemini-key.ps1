$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host 'Paste your Gemini API key below (right-click pastes), then press Enter.'
Write-Host 'Paste only the key itself - no AI_API_KEY= and no < > around it.'
Write-Host ''
$key = (Read-Host 'Key').Trim().Trim('<', '>', '"', "'")
if ($key.StartsWith('AI_API_KEY=')) { $key = $key.Substring(11) }
if (-not $key) {
  Write-Host 'No key entered. Nothing was changed.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$remote = 'read -r k; k=${k//[^A-Za-z0-9._-]/}; if [ -z $k ]; then echo EMPTY_KEY; exit 1; fi; sudo sed -i /^AI_API_KEY=/d /opt/guilded/.env.local; echo AI_API_KEY=$k | sudo tee -a /opt/guilded/.env.local >/dev/null; echo KEY_SAVED_OK'
$result = $key | ssh -i "$env:USERPROFILE\.ssh\guilded_oracle" -o StrictHostKeyChecking=accept-new ubuntu@168.138.70.194 $remote
$key = $null

Write-Host ''
if ($result -match 'KEY_SAVED_OK') {
  Write-Host 'Done - the key is saved on the server.' -ForegroundColor Green
  Write-Host 'Go back to Claude and say "key is in".'
} else {
  Write-Host "It did not save. Server said: $result" -ForegroundColor Red
}
Read-Host 'Press Enter to close'
