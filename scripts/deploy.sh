#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-zarplati}"
SERVICE_NAME="${SERVICE_NAME:-zarplati}"
APP_USER="${APP_USER:-zarplati}"
APP_HOME="${APP_HOME:-/home/${APP_USER}}"
APP_DIR="${APP_DIR:-}"
STORAGE_DIR="${STORAGE_DIR:-}"
ENV_DIR="${ENV_DIR:-}"
ENV_FILE="${ENV_FILE:-}"
BRANCH="${BRANCH:-main}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-}"
MODE="${MODE:-}"
REPO_URL="${REPO_URL:-}"
ADMIN_LOGIN="${ADMIN_LOGIN:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

usage() {
  cat <<'USAGE'
Deploy zarplati on a Linux server with systemd.

Usage:
  sudo bash scripts/deploy.sh
  curl -fsSL https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/deploy.sh \
    | sudo bash -s -- --repo https://github.com/NGPpQr0oWJ12/zarplati.git

Options:
  --mode deploy          Deployment mode. Only deploy is supported.
  --repo URL             Public GitHub repository clone URL.
  --branch NAME          Git branch to deploy. Default: main.
  --port PORT            Local application port.
  --host HOST            Bind host. Default: 127.0.0.1.
  --app-home PATH        Base application home. Default: /home/zarplati.
  --app-dir PATH         Code directory. Default: /home/zarplati/app.
  --storage-dir PATH     Data directory. Default: /home/zarplati/data.
  --env-file PATH        dotenv file. Default: /home/zarplati/config/.env.
  --service NAME         systemd service name. Default: zarplati.
  --admin-login LOGIN    Admin login. Required.
  --admin-password PASS  Admin password. Required.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --app-home) APP_HOME="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --storage-dir) STORAGE_DIR="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; ENV_DIR="$(dirname "$ENV_FILE")"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    --admin-login) ADMIN_LOGIN="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

APP_DIR="${APP_DIR:-${APP_HOME}/app}"
STORAGE_DIR="${STORAGE_DIR:-${APP_HOME}/data}"
ENV_DIR="${ENV_DIR:-${APP_HOME}/config}"
ENV_FILE="${ENV_FILE:-${ENV_DIR}/.env}"
ENV_DIR="$(dirname "$ENV_FILE")"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this script as root: sudo bash scripts/deploy.sh" >&2
    exit 1
  fi
}

validate_port() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "Port must be an integer from 1 to 65535." >&2
    exit 1
  fi
}

can_prompt() {
  [[ -r /dev/tty && -w /dev/tty ]]
}

prompt_if_empty() {
  local variable_name="$1"
  local prompt="$2"
  local default_value="${3:-}"
  local current_value="${!variable_name:-}"
  if [[ -n "$current_value" ]]; then
    return
  fi
  if ! can_prompt; then
    if [[ -n "$default_value" ]]; then
      printf -v "$variable_name" '%s' "$default_value"
      return
    fi
    echo "Missing required value: ${variable_name}" >&2
    exit 1
  fi

  local answer
  if [[ -n "$default_value" ]]; then
    read -r -p "${prompt} [${default_value}]: " answer < /dev/tty
    printf -v "$variable_name" '%s' "${answer:-$default_value}"
  else
    read -r -p "${prompt}: " answer < /dev/tty
    printf -v "$variable_name" '%s' "$answer"
  fi
}

prompt_password_if_empty() {
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    return
  fi
  if ! can_prompt; then
    echo "Missing required value: ADMIN_PASSWORD" >&2
    exit 1
  fi
  local answer
  while [[ -z "$answer" ]]; do
    read -r -s -p "Admin password: " answer < /dev/tty
    echo
  done
  ADMIN_PASSWORD="$answer"
}

detect_repo_url() {
  if [[ -n "$REPO_URL" ]]; then
    return
  fi
  if [[ -d .git ]]; then
    REPO_URL="$(git config --get remote.origin.url || true)"
  fi
}

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git openssl
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates curl git openssl
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    yum install -y ca-certificates curl git openssl
    return
  fi
  if command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm ca-certificates curl git openssl
    return
  fi
}

node_major_version() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

ensure_node() {
  local major
  major="$(node_major_version)"
  if (( major >= 20 )); then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm nodejs npm
  else
    echo "Install Node.js 20+ and rerun this script." >&2
    exit 1
  fi

  major="$(node_major_version)"
  if (( major < 20 )); then
    echo "Node.js 20+ is required, found $(node -v 2>/dev/null || echo missing)." >&2
    exit 1
  fi
}

open_firewall_port() {
  local port="$1"
  local opened=0

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
    ufw allow "${port}/tcp"
    ufw allow "${port}/udp"
    opened=1
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="${port}/tcp"
    firewall-cmd --permanent --add-port="${port}/udp"
    firewall-cmd --reload
    opened=1
  fi

  if [[ "$opened" -eq 0 ]]; then
    echo "No active ufw/firewalld detected; no OS firewall rule was changed."
  else
    echo "Opened TCP and UDP port ${port} in the active OS firewall."
  fi
}

create_user_and_dirs() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    local nologin_shell="/usr/sbin/nologin"
    if [[ ! -x "$nologin_shell" && -x "/sbin/nologin" ]]; then
      nologin_shell="/sbin/nologin"
    fi
    useradd --system --user-group --home "$APP_HOME" --create-home --shell "$nologin_shell" "$APP_USER"
  fi

  mkdir -p "$APP_HOME" "$APP_DIR" "$STORAGE_DIR" "$ENV_DIR"
  chown "$APP_USER:$APP_USER" "$APP_HOME"
  chmod 750 "$APP_HOME"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$STORAGE_DIR"
  chown root:"$APP_USER" "$ENV_DIR"
  chmod 750 "$ENV_DIR"
  chmod 750 "$STORAGE_DIR"
  chmod 750 "$APP_DIR"
}

checkout_code() {
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch --prune origin
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  else
    if [[ -e "$APP_DIR" ]] && [[ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      echo "${APP_DIR} exists and is not an empty Git checkout." >&2
      exit 1
    fi
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

install_app() {
  cd "$APP_DIR"
  npm ci
  npm run build
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

quote_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/}"
  printf '"%s"' "$value"
}

write_environment() {
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
HOST=$(quote_env_value "$HOST")
PORT=${PORT}
STORAGE_DIR=$(quote_env_value "$STORAGE_DIR")
ADMIN_LOGIN=$(quote_env_value "$ADMIN_LOGIN")
ADMIN_PASSWORD=$(quote_env_value "$ADMIN_PASSWORD")
ENV
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
}

write_service() {
  local node_bin
  node_bin="$(command -v node)"

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Zarplati payout app
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} node_modules/tsx/dist/cli.mjs server/index.ts --production
User=${APP_USER}
Group=${APP_USER}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LogRateLimitIntervalSec=30
LogRateLimitBurst=200
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=false
ProtectSystem=full
ReadWritePaths=${STORAGE_DIR}

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}.service"
}

main() {
  require_root
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This deploy script supports Linux servers only." >&2
    exit 1
  fi

  detect_repo_url
  prompt_if_empty MODE "Select mode (deploy)" "deploy"
  if [[ "$MODE" != "deploy" ]]; then
    echo "Only deploy mode is supported by this script." >&2
    exit 1
  fi
  prompt_if_empty REPO_URL "Public GitHub repo URL"
  prompt_if_empty PORT "Application port" "3000"
  validate_port "$PORT"
  prompt_if_empty ADMIN_LOGIN "Admin login"
  prompt_password_if_empty

  install_base_packages
  ensure_node
  create_user_and_dirs
  checkout_code
  install_app
  write_environment
  write_service
  open_firewall_port "$PORT"

  cat <<SUMMARY

Deploy complete.
Service: ${SERVICE_NAME}
Home: ${APP_HOME}
Code: ${APP_DIR}
Data: ${STORAGE_DIR}
Env: ${ENV_FILE}
URL: http://${HOST}:${PORT}
Admin login: ${ADMIN_LOGIN}
Admin password: saved to ${ENV_FILE}

Useful commands:
  systemctl status ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f
  systemctl restart ${SERVICE_NAME}
SUMMARY
}

main "$@"
