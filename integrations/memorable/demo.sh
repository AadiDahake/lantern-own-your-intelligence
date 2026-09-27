#!/usr/bin/env bash
# Asks one question two times through the API. The second answer comes from the route that the
# first walk completed. Needs a running Lantern (npm run dev) and the project's embed key.
#
#   LANTERN_API=http://localhost:3000 LANTERN_KEY=<embed key> ./integrations/memorable/demo.sh ["question"]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/demo.mjs" "$@"
