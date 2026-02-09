#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$ROOT_DIR/config/environments/local"

usage() {
  cat <<'USAGE'
Usage: scripts/local-fleet.sh <command>

Commands:
  up         Build agent image (if needed) and start local stack
  down       Stop local stack
  restart    Restart local stack
  status     Show running containers for local stack
  logs       Tail fleet-manager logs
  clean      Stop local stack and remove volumes

Environment variables:
  FLEET_SECRET   Required by fleet-manager. Defaults to "test123" if unset.
  HOST_ROOT      Path to repo root. Defaults to current repo root.

Examples:
  scripts/local-fleet.sh up
  scripts/local-fleet.sh down
  scripts/local-fleet.sh clean
USAGE
}

ensure_builds() {
  local missing=0
  if [ ! -f "$ROOT_DIR/packages/setup/fleet-manager/dist/cli.js" ]; then
    missing=1
  fi
  if [ ! -f "$ROOT_DIR/packages/setup/agent-runtime/dist/index.js" ]; then
    missing=1
  fi
  if [ ! -f "$ROOT_DIR/packages/plugins/people/dist/index.js" ]; then
    missing=1
  fi

  if [ "$missing" -eq 1 ]; then
    echo "Building workspace packages..."
    (cd "$ROOT_DIR" && npm run build)
  fi
}

build_agent_image() {
  if ! docker image inspect openclaw-agent:latest >/dev/null 2>&1; then
    echo "Building agent image: openclaw-agent:latest"
    docker build -t openclaw-agent:latest -f "$ENV_DIR/Dockerfile.agent" "$ROOT_DIR"
  fi
}

compose() {
  (cd "$ENV_DIR" && docker compose "$@")
}

remove_agents() {
  local agents
  agents=$(docker ps -a --format '{{.Names}}' | grep -E '^agent-' || true)
  if [ -n "$agents" ]; then
    echo "Stopping agent containers..."
    echo "$agents" | xargs docker rm -f
  fi
}

cmd=${1:-}
case "$cmd" in
  up)
    : "${FLEET_SECRET:=test123}"
    export FLEET_SECRET
    : "${HOST_ROOT:=$ROOT_DIR}"
    export HOST_ROOT
    : "${HOST_HOME:=$HOME}"
    export HOST_HOME
    : "${AWS_SDK_LOAD_CONFIG:=1}"
    export AWS_SDK_LOAD_CONFIG
    if [ -n "${AWS_PROFILE:-}" ]; then
      export AWS_PROFILE
    fi
    ensure_builds
    build_agent_image
    compose up -d
    ;;
  down)
    remove_agents
    compose down
    ;;
  restart)
    : "${FLEET_SECRET:=test123}"
    export FLEET_SECRET
    : "${HOST_ROOT:=$ROOT_DIR}"
    export HOST_ROOT
    : "${HOST_HOME:=$HOME}"
    export HOST_HOME
    : "${AWS_SDK_LOAD_CONFIG:=1}"
    export AWS_SDK_LOAD_CONFIG
    if [ -n "${AWS_PROFILE:-}" ]; then
      export AWS_PROFILE
    fi
    remove_agents
    compose down
    compose up -d
    ;;
  status)
    docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E "agent-|fleet-manager|conduit|element" || true
    ;;
  logs)
    fm=$(docker ps --format '{{.Names}}' | grep -E 'fleet-manager' | head -n 1 || true)
    if [ -z "$fm" ]; then
      echo "No running fleet-manager container found."
      exit 1
    fi
    docker logs -f "$fm"
    ;;
  clean)
    remove_agents
    compose down -v
    ;;
  *)
    usage
    exit 1
    ;;
esac
