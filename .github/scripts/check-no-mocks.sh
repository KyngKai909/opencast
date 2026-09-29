#!/usr/bin/env bash
# After `turbo run build` of the web apps: their production bundles carry no mock code (Mock
# Service Worker, the mock sign-in, the test-token sign-in, the mock HLS streams, the Cast bridge).
# Only what Vite bundled is searched (dist/assets/ and the HTML entry points): public/ files copied
# as they are (mockServiceWorker.js, inert unless a bundle registers it; the web app's sw.js, which
# lets /mock-hls/ pass) aren't bundles.
#
#   .github/scripts/check-no-mocks.sh web business tv site
#
# KNOWN_MOCK_CHUNKS="business" reports those apps as warnings instead of failing (a known lazy
# mock chunk that production never loads); remove an app from it once its build is clean.
set -euo pipefail

markers='setupWorker|\[MSW\]|mockServiceWorker|oc-mock-signed-in|oc-dev-token|/mock-hls/|mock-cast-bridge'
known=" ${KNOWN_MOCK_CHUNKS:-} "
failed=0

for app in "$@"; do
  dist="apps/$app/dist"
  if [ ! -d "$dist" ]; then
    echo "::error::$dist is missing: build it first"
    failed=1
    continue
  fi
  hits=$(grep -lE "$markers" "$dist"/assets/*.js "$dist"/*.html 2>/dev/null || true)
  if [ -z "$hits" ]; then
    echo "$app: no mock code in the build"
    continue
  fi
  found=$(grep -ohE "$markers" $hits | sort -u | tr '\n' ' ')
  if [[ "$known" == *" $app "* ]]; then
    echo "::warning title=Mock code in the $app build::$(echo $hits | tr ' ' ',') ($found). Listed in KNOWN_MOCK_CHUNKS."
  else
    echo "::error title=Mock code in the $app build::$(echo $hits | tr ' ' ',') ($found)"
    failed=1
  fi
done

exit $failed
