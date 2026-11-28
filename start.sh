#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
exec node server.js "$@"
