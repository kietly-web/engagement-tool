#!/usr/bin/env bash
set -euo pipefail

# VITE_* values are inlined into the browser bundle, and wrangler.jsonc "vars" are plaintext;
# secrets belong in `wrangler secret put` (docs/design/07-infrastructure.md).
secretish='(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|DATABASE|DSN|ENCRYPTION_KEY)'
status=0

if hits=$(git grep -nE "VITE_[A-Z0-9_]*$secretish" -- ':!scripts/check-public-env.sh'); then
  echo "Secret-looking VITE_ variable names found:"
  echo "$hits"
  status=1
fi

if hits=$(git grep -nE "\"[A-Z0-9_]*$secretish[A-Z0-9_]*\"[[:space:]]*:" -- '*wrangler.json*' '*wrangler.toml'); then
  echo "Secret-looking names in wrangler config (use wrangler secret put instead):"
  echo "$hits"
  status=1
fi

[ $status = 0 ] && echo "No secret-looking public names."
exit $status
