#!/usr/bin/env sh
set -eu

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
  echo "Add OPENROUTER_API_KEY to .env, then run ./start.sh again."
  exit 0
fi

exec npm start -- "$@"
