#!/bin/sh
# 本项目原创，MIT（licenses/MIT.md）
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
exec node server.js "$@"
