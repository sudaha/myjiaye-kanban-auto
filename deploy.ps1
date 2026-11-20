$ErrorActionPreference = "Continue"
$tok = (Get-Content "C:\Users\48372\AccioWork\2026-10-23-14-02-13-871-69a259d0\_transfer\cf_api_token.txt" -Raw).Trim().Trim([char]0xFEFF)
$env:CLOUDFLARE_API_TOKEN = $tok
Set-Location "C:\Users\48372\AccioWork\2026-10-23-14-02-13-871-69a259d0\zycg_board"
# 输出目录与 KV 绑定统一由 wrangler.json 提供（pages_build_output_dir + kv_namespaces）
npx -y wrangler pages deploy --project-name=myjiaye-kanban --commit-dirty=true
exit $LASTEXITCODE
