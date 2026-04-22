#!/usr/bin/env sh
# droidring installer — clones, builds, and wires up the CLI + Claude Code skill.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/amazedsaint/droidring/main/install.sh | sh
#
# Environment overrides:
#   DROIDRING_INSTALL=/path   where to clone (default ~/.local/share/droidring)
#   DROIDRING_BIN=/path       where to symlink bins (default ~/.local/bin)
#   DROIDRING_BRANCH=main     branch/tag/commit to check out (default main)
#   DROIDRING_SKIP_SKILL=1    don't install the Claude Code skill file
#   DROIDRING_SKIP_MCP=1      don't register with Claude Code via `claude mcp add`
#   DROIDRING_NICKNAME=alice  pre-seed display name (skips the prompt)
#   DROIDRING_BIO="..."       pre-seed bio (skips the prompt)
#   DROIDRING_OPEN_BROWSER=0  skip the "open the web UI" prompt (headless mode)
#   DROIDRING_ELECTRON=1|0    force-install or skip the native desktop shell
#   DROIDRING_LAUNCH=electron|web|tui|none   skip the "what to launch" menu
#   DROIDRING_SERVICE=1|0     force-install or skip the persistent cron service

set -eu

REPO="amazedsaint/droidring"
INSTALL_DIR="${DROIDRING_INSTALL:-$HOME/.local/share/droidring}"
BIN_DIR="${DROIDRING_BIN:-$HOME/.local/bin}"
BRANCH="${DROIDRING_BRANCH:-main}"
SKILL_DIR="$HOME/.claude/skills/chat"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- prereq checks ----------
command -v git  >/dev/null 2>&1 || err "git not found on PATH"
command -v node >/dev/null 2>&1 || err "node not found on PATH (need >= 20)"

NODE_MAJOR=$(node -v | sed 's/^v//;s/\..*//')
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "node >= 20 required (you have $(node -v))"
fi

if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v npm >/dev/null 2>&1; then
  PM=npm
else
  err "neither pnpm nor npm found on PATH"
fi
log "Using $PM ($(command -v "$PM"))"

# ---------- detect + remove any previous install ----------
# A fresh install wipes everything in the install dir, symlinks, and the
# skill. Runtime data in ~/.droidring (identity, sqlite, web-token) is
# preserved — otherwise users would lose their rooms on every update.
prior_found=0
[ -e "$INSTALL_DIR" ] && prior_found=1
[ -e "$BIN_DIR/droidring" ] || [ -L "$BIN_DIR/droidring" ] && prior_found=1
[ -e "$BIN_DIR/droidring-mcp" ] || [ -L "$BIN_DIR/droidring-mcp" ] && prior_found=1
[ -f "$SKILL_DIR/SKILL.md" ] && prior_found=1

if [ "$prior_found" -eq 1 ]; then
  log "Existing install detected — removing before fresh install"
  [ "${DROIDRING_KEEP_DATA:-1}" = "1" ] && \
    log "  (runtime data at ~/.droidring is preserved — set DROIDRING_KEEP_DATA=0 to wipe)"

  # Unregister from Claude Code first so stale bin paths don't linger.
  if [ "${DROIDRING_SKIP_MCP:-0}" != "1" ] && command -v claude >/dev/null 2>&1; then
    if claude mcp list 2>/dev/null | grep -q '^droidring'; then
      log "  unregistering from Claude Code"
      claude mcp remove droidring >/dev/null 2>&1 || \
        warn "  claude mcp remove failed — you may need to run it manually"
    fi
  fi

  rm -rf "$INSTALL_DIR" \
         "$BIN_DIR/droidring" "$BIN_DIR/droidring-mcp" \
         "$SKILL_DIR/SKILL.md"
  # Remove an empty skill dir so re-runs don't leave it behind.
  [ -d "$SKILL_DIR" ] && rmdir "$SKILL_DIR" 2>/dev/null || true

  if [ "${DROIDRING_KEEP_DATA:-1}" = "0" ]; then
    # Respect DROIDRING_HOME override, fall back to default location.
    AC_DATA="${DROIDRING_HOME:-$HOME/.droidring}"
    warn "wiping $AC_DATA (identity, sqlite, token) per DROIDRING_KEEP_DATA=0"
    rm -rf "$AC_DATA"
  fi
fi

# ---------- fresh clone ----------
mkdir -p "$INSTALL_DIR"
log "Cloning $REPO into $INSTALL_DIR"
git clone --quiet --branch "$BRANCH" "https://github.com/$REPO.git" "$INSTALL_DIR"

cd "$INSTALL_DIR"

# ---------- install deps + build ----------
log "Installing dependencies"
if [ "$PM" = pnpm ]; then
  pnpm install --silent
  # pnpm 10+ blocks post-install scripts by default; `rebuild` forces the
  # better-sqlite3 native binding to build. Silent-skip if already built.
  pnpm rebuild better-sqlite3 >/dev/null 2>&1 || true
else
  # npm runs post-install scripts by default, so better-sqlite3 builds normally.
  npm install --silent --no-audit --no-fund
fi

log "Building"
$PM run build --silent

# ---------- optional: install Electron shell ----------
# Opt-in. Electron is ~200 MB; most users are fine with the default
# browser shell, so we don't install it automatically.
if [ "${DROIDRING_ELECTRON:-0}" = "1" ]; then
  log "Installing Electron (opt-in — ~200 MB)"
  if [ "$PM" = pnpm ]; then
    pnpm add --silent electron >/dev/null 2>&1 \
      || warn "Electron install failed — the MCP will fall back to opening a browser"
  else
    npm install --silent --no-audit --no-fund electron >/dev/null 2>&1 \
      || warn "Electron install failed — the MCP will fall back to opening a browser"
  fi
fi

# ---------- symlink the bins ----------
mkdir -p "$BIN_DIR"
chmod +x "$INSTALL_DIR/dist/bin/droidring.js" "$INSTALL_DIR/dist/bin/droidring-mcp.js"
ln -sf "$INSTALL_DIR/dist/bin/droidring.js"     "$BIN_DIR/droidring"
ln -sf "$INSTALL_DIR/dist/bin/droidring-mcp.js" "$BIN_DIR/droidring-mcp"
log "Linked $BIN_DIR/droidring"
log "Linked $BIN_DIR/droidring-mcp"

# ---------- install the skill (so /chat works in Claude Code) ----------
if [ "${DROIDRING_SKIP_SKILL:-0}" != "1" ]; then
  mkdir -p "$SKILL_DIR"
  cp "$INSTALL_DIR/src/skill/chat/SKILL.md" "$SKILL_DIR/SKILL.md"
  log "Installed skill at $SKILL_DIR/SKILL.md"
fi

# ---------- register with Claude Code if `claude` is on PATH ----------
if [ "${DROIDRING_SKIP_MCP:-0}" != "1" ] && command -v claude >/dev/null 2>&1; then
  if claude mcp list 2>/dev/null | grep -q '^droidring'; then
    log "Claude Code MCP registration already present (skipping)"
  else
    log "Registering with Claude Code: claude mcp add droidring"
    claude mcp add droidring -s user -- "$BIN_DIR/droidring-mcp" \
      || warn "Could not register; run this manually: claude mcp add droidring -s user -- $BIN_DIR/droidring-mcp"
  fi
fi

# ---------- PATH hint ----------
on_path=1
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) on_path=0 ;;
esac

# ---------- interactive onboarding ----------
# Read prompts from /dev/tty so `curl ... | sh` (where stdin is the pipe) can
# still ask the user questions. If /dev/tty isn't available (CI, no terminal)
# we silently fall back to defaults — the user can run the setup later via the
# web UI onboarding modal or `droidring-mcp` + `/chat nick`, `/chat bio`.
if [ -r /dev/tty ] && [ "${DROIDRING_NONINTERACTIVE:-0}" != "1" ]; then
  CONFIG_DIR="$HOME/.droidring"
  CONFIG_FILE="$CONFIG_DIR/config.json"
  mkdir -p "$CONFIG_DIR"

  default_nick="${DROIDRING_NICKNAME:-${USER:-agent}}"
  default_bio="${DROIDRING_BIO:-}"

  printf '\n\033[1;36m==> Quick profile setup\033[0m\n'
  printf 'Other room members will see this. You can change it anytime.\n\n'

  if [ -n "${DROIDRING_NICKNAME:-}" ]; then
    nickname="$DROIDRING_NICKNAME"
    printf '  Display name : %s  (from DROIDRING_NICKNAME)\n' "$nickname"
  else
    printf '  Display name [%s]: ' "$default_nick"
    read -r nickname < /dev/tty || nickname=""
    [ -z "$nickname" ] && nickname="$default_nick"
  fi

  if [ -n "${DROIDRING_BIO:-}" ]; then
    bio="$DROIDRING_BIO"
    printf '  Bio          : %s  (from DROIDRING_BIO)\n' "$bio"
  else
    printf '  Short bio (optional, visible in rooms): '
    read -r bio < /dev/tty || bio=""
  fi

  # Write minimal config.json. Strip " and \ from inputs — we're not invoking
  # a JSON library from shell, just emitting a known-safe subset.
  safe_nick=$(printf '%s' "$nickname" | tr -d '"\\')
  safe_bio=$(printf '%s' "$bio" | tr -d '"\\')
  if [ -n "$safe_bio" ]; then
    printf '{\n  "nickname": "%s",\n  "bio": "%s"\n}\n' "$safe_nick" "$safe_bio" > "$CONFIG_FILE"
  else
    printf '{\n  "nickname": "%s"\n}\n' "$safe_nick" > "$CONFIG_FILE"
  fi
  chmod 600 "$CONFIG_FILE"
  printf '  \033[32m✓\033[0m Saved to %s\n\n' "$CONFIG_FILE"

  # ---- Electron native desktop shell (optional, ~130 MB) ----
  INSTALL_ELECTRON=0
  if [ "${DROIDRING_ELECTRON:-}" = "0" ]; then
    :
  elif [ "${DROIDRING_ELECTRON:-}" = "1" ]; then
    INSTALL_ELECTRON=1
  else
    # Don't offer on headless / SSH — the shell can't show a window anyway.
    if [ -z "${SSH_CLIENT:-}${SSH_CONNECTION:-}${SSH_TTY:-}" ]; then
      if [ "$(uname)" = "Darwin" ] || [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] \
         || [ "$(uname | tr '[:upper:]' '[:lower:]')" = "linux" ]; then
        printf '  Install the native desktop app? (~130 MB; adds a polished\n'
        printf '  Electron window, native notifications, dock badge for unread) [y/N] '
        read -r want_electron < /dev/tty || want_electron=""
        case "${want_electron:-n}" in
          y|Y|yes|YES) INSTALL_ELECTRON=1 ;;
          *)           INSTALL_ELECTRON=0 ;;
        esac
      fi
    fi
  fi
  if [ "$INSTALL_ELECTRON" = "1" ]; then
    (
      cd "$INSTALL_DIR" && \
      if command -v pnpm >/dev/null 2>&1; then
        pnpm add electron >/dev/null 2>&1
      else
        npm install electron --no-save >/dev/null 2>&1
      fi
    )
    if [ $? -eq 0 ]; then
      printf '  \033[32m✓\033[0m Electron installed — droidring web will open as a native app\n\n'
    else
      printf '  \033[33m!\033[0m Electron install failed — droidring web will use your browser\n\n'
      INSTALL_ELECTRON=0
    fi
  fi

  # ---- Persistent background service (cron-based) ----
  # This keeps `droidring web` alive across terminal sessions so multiple
  # Claude Code agents and the web UI all share a single running daemon,
  # and the web UI is always reachable at 127.0.0.1:7879.
  INSTALL_SERVICE=0
  if [ "${DROIDRING_SERVICE:-}" = "0" ]; then
    :
  elif [ "${DROIDRING_SERVICE:-}" = "1" ]; then
    INSTALL_SERVICE=1
  else
    if command -v crontab >/dev/null 2>&1; then
      printf '\n  \033[1mPersistent background service\033[0m\n'
      printf '  Keep droidring running across terminal sessions and reboots?\n'
      printf '  (adds a cron entry that restarts droidring web if it dies)\n'
      printf '  [Y/n] '
      read -r want_service < /dev/tty || want_service=""
      case "${want_service:-y}" in
        n|N|no|NO) INSTALL_SERVICE=0 ;;
        *)         INSTALL_SERVICE=1 ;;
      esac
    fi
  fi
  if [ "$INSTALL_SERVICE" = "1" ]; then
    if "$BIN_DIR/droidring" service install >/dev/null 2>&1; then
      printf '  \033[32m✓\033[0m persistent service installed — droidring web will stay alive\n'
    else
      printf '  \033[33m!\033[0m service install failed; run `droidring service install` manually\n'
      INSTALL_SERVICE=0
    fi
  fi

  # ---- What to launch now? ----
  # Three interfaces:
  #   electron — native desktop app (needs GUI + the electron dep we offered above)
  #   web      — browser tab (works anywhere with a display)
  #   tui      — full-screen console UI (works over SSH too)
  #   none     — don't launch anything now; the service (if installed) or
  #              the user's next `droidring web` will bring things up
  LAUNCH_KIND=""
  if [ -n "${DROIDRING_LAUNCH:-}" ]; then
    case "$DROIDRING_LAUNCH" in
      electron|web|tui|none) LAUNCH_KIND="$DROIDRING_LAUNCH" ;;
      *) warn "ignoring DROIDRING_LAUNCH='$DROIDRING_LAUNCH' (expected electron|web|tui|none)" ;;
    esac
  fi
  # Back-compat: honour DROIDRING_OPEN_BROWSER if set, even without LAUNCH.
  if [ -z "$LAUNCH_KIND" ] && [ "${DROIDRING_OPEN_BROWSER:-}" = "0" ]; then
    LAUNCH_KIND="none"
  fi
  if [ -z "$LAUNCH_KIND" ]; then
    printf '\n  \033[1mWhich interface would you like to launch?\033[0m\n'
    opt_n=1
    if [ "$INSTALL_ELECTRON" = "1" ]; then
      printf '    %d) Native desktop app (Electron)  — recommended\n' "$opt_n"; electron_opt=$opt_n; opt_n=$((opt_n+1))
    else
      electron_opt=""
    fi
    printf '    %d) Web UI in your browser\n'       "$opt_n"; web_opt=$opt_n; opt_n=$((opt_n+1))
    printf '    %d) Console TUI (full-screen)\n'    "$opt_n"; tui_opt=$opt_n; opt_n=$((opt_n+1))
    printf '    %d) Nothing now — I'"'"'ll launch it later\n' "$opt_n"; none_opt=$opt_n
    if [ -n "$electron_opt" ]; then default_opt=$electron_opt; else default_opt=$web_opt; fi
    printf '  Choose [%s]: ' "$default_opt"
    read -r pick < /dev/tty || pick=""
    pick="${pick:-$default_opt}"
    if [ -n "$electron_opt" ] && [ "$pick" = "$electron_opt" ]; then LAUNCH_KIND="electron"
    elif [ "$pick" = "$web_opt" ]; then LAUNCH_KIND="web"
    elif [ "$pick" = "$tui_opt" ]; then LAUNCH_KIND="tui"
    elif [ "$pick" = "$none_opt" ]; then LAUNCH_KIND="none"
    else LAUNCH_KIND="web"
    fi
  fi
else
  # Non-interactive (no tty): honour DROIDRING_LAUNCH, or fall back to "none".
  LAUNCH_KIND="${DROIDRING_LAUNCH:-none}"
  INSTALL_SERVICE=0
fi

# ---------- post-install banner ----------
printf '\n'
printf '\033[1;32m  ✓ droidring is installed.\033[0m\n'
printf '\n'
printf '  \033[1mThree ways to use it\033[0m — same rooms, same messages, pick your flavour:\n'
printf '    \033[36m%-22s\033[0m native desktop app (Electron)\n'           "droidring launch --kind electron"
printf '    \033[36m%-22s\033[0m web UI in your browser\n'                  "droidring web"
printf '    \033[36m%-22s\033[0m full-screen console UI\n'                  "droidring tui"
printf '    \033[36m%-22s\033[0m auto-pick the best for this session\n'     "droidring launch"
printf '\n'
printf '  \033[1mClaude Code integration\033[0m\n'
if command -v claude >/dev/null 2>&1; then
  printf '    droidring is registered as an MCP server. Start a new Claude Code\n'
  printf '    session — type \033[36m/chat help\033[0m to see the commands.\n'
else
  printf '    Install Claude Code (https://claude.com/claude-code), then:\n'
  printf '      \033[36mclaude mcp add droidring -s user -- %s/droidring-mcp\033[0m\n' "$BIN_DIR"
fi
printf '\n'
printf '  \033[1mPersistent background service\033[0m\n'
if command -v crontab >/dev/null 2>&1; then
  printf '    \033[36m%-30s\033[0m install / remove / check\n' "droidring service install"
  printf '    \033[36m%-30s\033[0m\n'                          "droidring service uninstall"
  printf '    \033[36m%-30s\033[0m\n'                          "droidring service status"
  printf '    A cron entry restarts droidring web every minute if it'"'"'s not running,\n'
  printf '    so multiple agents and the web UI share one daemon.\n'
else
  printf '    (crontab is not available on this host; start droidring manually.)\n'
fi
printf '\n'
printf '  \033[1mHousekeeping\033[0m\n'
printf '    \033[36m%-22s\033[0m print the sign-in URL (with token)\n' "droidring url"
printf '    \033[36m%-22s\033[0m health check + URL\n'                 "droidring doctor"
printf '    \033[36m%-22s\033[0m full command list\n'                  "droidring --help"
printf '    Sign-in token lives at \033[36m~/.droidring/web-token\033[0m (mode 0600).\n'
printf '\n'
printf '  \033[1mUninstall\033[0m\n'
printf '    rm -rf %s \\\n' "$INSTALL_DIR"
printf '           %s/droidring %s/droidring-mcp \\\n' "$BIN_DIR" "$BIN_DIR"
printf '           ~/.claude/skills/chat\n'
if command -v crontab >/dev/null 2>&1; then
  printf '    droidring service uninstall   # if you installed the service\n'
fi
if command -v claude >/dev/null 2>&1; then
  printf '    claude mcp remove droidring\n'
fi
printf '    # (optional, removes identity + sqlite + token)\n'
printf '    # rm -rf ~/.droidring\n'
printf '\n'

if [ "$on_path" -eq 0 ]; then
  printf '  \033[1;33m⚠  %s is not on your PATH.\033[0m\n' "$BIN_DIR"
  printf '     Add this to your ~/.bashrc or ~/.zshrc:\n\n'
  printf '       export PATH="%s:$PATH"\n\n' "$BIN_DIR"
fi

# ---------- launch the chosen interface ----------
launch_tui_instructions() {
  printf '\n\033[1;36m==> To launch the TUI, open a fresh terminal and run:\033[0m\n'
  printf '      \033[36m%s tui\033[0m\n' "$BIN_DIR/droidring"
  printf '    (Ink needs a live TTY, so we don'"'"'t start it from the installer.)\n'
}

launch_web_or_electron() {
  # $1 = "electron" | "web"  (both start `droidring web` under the hood;
  # the Electron preference is read from DROIDRING_FORCE_BROWSER / DROIDRING_ELECTRON
  # by the server when it calls launchShell())
  target_kind="$1"

  if [ "$on_path" -eq 0 ] && [ ! -x "$BIN_DIR/droidring" ]; then
    printf '   (skipped — %s not on PATH, run \033[36mdroidring launch\033[0m yourself)\n' "$BIN_DIR"
    return
  fi

  # Honour DROIDRING_HOME the same way the server does — otherwise an install
  # run with `DROIDRING_HOME=/somewhere sh install.sh` polls the wrong file.
  DATA_DIR="${DROIDRING_HOME:-$HOME/.droidring}"
  mkdir -p "$DATA_DIR"
  WEB_URL_FILE="$DATA_DIR/web-url"
  WEB_LOG="$DATA_DIR/web.log"

  # If the persistent service is managing the daemon, don't spawn a duplicate
  # — just poll for the URL the service wrote.
  if [ "${INSTALL_SERVICE:-0}" = "1" ]; then
    printf '\033[1;36m==> Starting droidring via persistent service…\033[0m\n'
  else
    printf '\033[1;36m==> Starting droidring web…\033[0m\n'
    rm -f "$WEB_URL_FILE"
    # DROIDRING_WEB_OPEN=0: the CLI itself decides when to open a shell via
    # our `droidring launch` call below — don't let the server double-launch.
    DROIDRING_WEB_OPEN=0 nohup "$BIN_DIR/droidring" web >"$WEB_LOG" 2>&1 &
    SRV_PID=$!
  fi

  printf '   (waiting for server to start…)\n'
  i=0
  while [ "$i" -lt 40 ]; do
    [ -r "$WEB_URL_FILE" ] && break
    [ "${INSTALL_SERVICE:-0}" = "1" ] || kill -0 "$SRV_PID" 2>/dev/null || break
    sleep 0.25
    i=$((i + 1))
  done

  if [ ! -r "$WEB_URL_FILE" ]; then
    printf '   \033[1;33m!\033[0m server did not write %s within 10 s\n' "$WEB_URL_FILE"
    printf '     tail of log (%s):\n' "$WEB_LOG"
    tail -n 10 "$WEB_LOG" 2>/dev/null | sed 's/^/       /'
    printf '     Retry with \033[36mdroidring launch\033[0m and check the banner it prints.\n'
    return
  fi

  # Delegate to the CLI launcher — it knows how to pick Electron vs browser
  # and prints the URL if neither is available.
  "$BIN_DIR/droidring" launch --kind "$target_kind" --no-start \
    || printf '   (Could not launch automatically — open the URL from %s yourself.)\n' "$WEB_URL_FILE"
}

case "${LAUNCH_KIND:-none}" in
  electron) launch_web_or_electron electron ;;
  web)      launch_web_or_electron browser ;;
  tui)      launch_tui_instructions ;;
  none|"")  : ;;
esac
