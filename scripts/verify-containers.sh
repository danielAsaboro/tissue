#!/usr/bin/env bash
set -euo pipefail

suffix="$$"
analyst="tissue-analyst-verify-${suffix}"
dashboard="tissue-dashboard-verify-${suffix}"
daemon_log="$(mktemp -t tissue-daemon-verify.XXXXXX)"

cleanup() {
  docker rm -f "$analyst" "$dashboard" >/dev/null 2>&1 || true
  rm -f "$daemon_log"
}
trap cleanup EXIT

for image in tissue-daemon:latest tissue-analyst:latest tissue-dashboard:latest; do
  test "$(docker image inspect "$image" --format '{{.Config.User}}')" = "node"
done

docker run --rm --entrypoint node tissue-daemon:latest -e '
  const fs = require("node:fs");
  if (!fs.existsSync("/app/apps/daemon/main.mjs")) process.exit(1);
  if (fs.existsSync("/app/apps/daemon/src")) process.exit(1);
  if (fs.existsSync("/app/apps/daemon/node_modules/.bin/tsx")) process.exit(1);
'
docker run --rm --entrypoint node tissue-analyst:latest -e '
  const fs = require("node:fs");
  if (!fs.existsSync("/app/apps/analyst/server.mjs")) process.exit(1);
  if (fs.existsSync("/app/apps/analyst/src")) process.exit(1);
  if (fs.existsSync("/app/node_modules")) process.exit(1);
'

if docker run --rm tissue-daemon:latest >"$daemon_log" 2>&1; then
  echo "daemon unexpectedly started without live configuration" >&2
  exit 1
fi
grep -Fq "TISSUE_MODE=live is required" "$daemon_log"
grep -Fq "never falls back to replay or synthetic input" "$daemon_log"

docker run -d --rm --name "$analyst" -p 127.0.0.1::8787 tissue-analyst:latest >/dev/null
docker run -d --rm --name "$dashboard" -p 127.0.0.1::3000 tissue-dashboard:latest >/dev/null
analyst_port="$(docker port "$analyst" 8787/tcp | awk -F: 'NR == 1 { print $NF }')"
dashboard_port="$(docker port "$dashboard" 3000/tcp | awk -F: 'NR == 1 { print $NF }')"

wait_for_url() {
  local url="$1"
  for _ in $(seq 1 50); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  echo "container endpoint did not become ready: $url" >&2
  return 1
}

wait_for_url "http://127.0.0.1:${analyst_port}/health"
wait_for_url "http://127.0.0.1:${dashboard_port}/"

curl -fsS "http://127.0.0.1:${analyst_port}/health" \
  | jq -e '.alive == true and .ready == false and .readOnlyTools == true and .providerConfigured == false' >/dev/null
curl -fsS "http://127.0.0.1:${analyst_port}/metrics" \
  | grep -Fq 'tissue_analyst_requests_total{outcome="succeeded"} 0'

headers="$(curl -fsSI "http://127.0.0.1:${dashboard_port}/")"
grep -Fqi "content-security-policy:" <<<"$headers"
grep -Fqi "x-frame-options: DENY" <<<"$headers"
grep -Fqi "x-content-type-options: nosniff" <<<"$headers"
if grep -Fqi "x-powered-by:" <<<"$headers"; then
  echo "dashboard exposed an X-Powered-By header" >&2
  exit 1
fi

body="$(curl -fsS "http://127.0.0.1:${dashboard_port}/")"
grep -Fq "replay(corpus) === ledger" <<<"$body"
grep -Fq "Grade yourself from evidence" <<<"$body"

echo "container verification passed"
