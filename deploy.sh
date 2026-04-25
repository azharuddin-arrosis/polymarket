#!/bin/bash
# deploy.sh — Polymarket BTC Bot deployment helper
# Usage:
#   ./deploy.sh [all|sim|real|down|logs|status] [service]

set -euo pipefail

# Always run from the project root regardless of call location
cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()  { echo -e "${CYAN}${BOLD}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}${BOLD}[  ok  ]${NC} $*"; }
warn() { echo -e "${YELLOW}${BOLD}[ warn ]${NC} $*"; }
err()  { echo -e "${RED}${BOLD}[ err  ]${NC} $*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
usage() {
  echo -e "
${BOLD}Polymarket BTC Bot — Deploy Helper${NC}

${BOLD}Usage:${NC}
  ./deploy.sh              Deploy all bots + main dashboard (sim + real)
  ./deploy.sh all          Same as above
  ./deploy.sh sim          Deploy sim bots only  (sim1, sim2 + their dashboards)
  ./deploy.sh real         Deploy real bots only (real1, real2 + their dashboards)
  ./deploy.sh down         Stop and remove all containers
  ./deploy.sh logs         Tail logs for sim1 (default)
  ./deploy.sh logs <svc>   Tail logs for specific service
                           Available: sim1 sim2 real1 real2
                                      dash-sim1 dash-sim2 dash-real1 dash-real2 main
  ./deploy.sh status       Show status of all bot containers
"
}

compose() {
  docker compose "$@"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
cmd_all() {
  log "Deploying ALL services (sim + real + main dashboard)..."
  compose --profile all up -d --build
  ok "All services are up."
  echo
  print_urls
}

cmd_sim() {
  log "Deploying SIM bots (sim1, sim2 + dashboards + main)..."
  compose --profile sim up -d --build
  ok "SIM services are up."
  echo
  print_urls_sim
}

cmd_real() {
  log "Deploying REAL bots (real1, real2 + dashboards + main)..."
  compose --profile real up -d --build
  ok "REAL services are up."
  echo
  print_urls_real
}

cmd_down() {
  warn "Stopping and removing all containers..."
  compose --profile all down --remove-orphans
  ok "All containers stopped and removed."
}

cmd_logs() {
  local service="${1:-sim1}"
  log "Tailing logs for: ${BOLD}${service}${NC}"
  compose logs -f "$service"
}

cmd_status() {
  log "Container status:"
  echo
  docker ps --filter "name=pb-" \
    --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

print_urls() {
  echo -e "${BOLD}URLs:${NC}"
  echo -e "  Main Dashboard  →  http://localhost:3000"
  echo -e "  SIM 1           →  http://localhost:3101"
  echo -e "  SIM 2           →  http://localhost:3102"
  echo -e "  REAL 1          →  http://localhost:3201"
  echo -e "  REAL 2          →  http://localhost:3202"
}

print_urls_sim() {
  echo -e "${BOLD}URLs:${NC}"
  echo -e "  Main Dashboard  →  http://localhost:3000"
  echo -e "  SIM 1           →  http://localhost:3101"
  echo -e "  SIM 2           →  http://localhost:3102"
}

print_urls_real() {
  echo -e "${BOLD}URLs:${NC}"
  echo -e "  Main Dashboard  →  http://localhost:3000"
  echo -e "  REAL 1          →  http://localhost:3201"
  echo -e "  REAL 2          →  http://localhost:3202"
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
COMMAND="${1:-all}"
shift || true   # shift is fine even if $1 was unset (set -u safe via || true)

case "$COMMAND" in
  all)    cmd_all ;;
  sim)    cmd_sim ;;
  real)   cmd_real ;;
  down)   cmd_down ;;
  logs)   cmd_logs "${1:-sim1}" ;;
  status) cmd_status ;;
  -h|--help|help) usage ;;
  *)
    err "Unknown command: '${COMMAND}'"
    usage
    exit 1
    ;;
esac
