#!/bin/sh
# Install (or update) Kill All Email and start it.
#
#   curl -fsSL https://killall.email/install.sh | sh
#   curl -fsSL https://killall.email/install.sh | sh -s -- --demo    # made-up inbox
#
# Puts the `kill-email` binary in ~/.local/bin (or $KILL_EMAIL_DIR). Set
# KILL_EMAIL_NO_RUN=1 to install without starting it.
set -eu

REPO="JulianKingman/Kill-email"
CHANNEL="${KILL_EMAIL_CHANNEL:-nightly}"
DIR="${KILL_EMAIL_DIR:-$HOME/.local/bin}"

say() { printf '\033[38;2;255;59;46m⌜✉⌟\033[0m %s\n' "$*"; }
die() { say "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) asset="kill-email-macos.tar.gz" ;;
  Linux)
    case "$(uname -m)" in
      x86_64 | amd64) asset="kill-email-linux-x86_64.tar.gz" ;;
      *) die "No Linux build for $(uname -m) yet. Build it with Rust: cargo install --git https://github.com/$REPO kill-email" ;;
    esac
    ;;
  *) die "Unsupported system $(uname -s). On Windows, run in PowerShell: irm https://killall.email/install.ps1 | iex" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is needed"
command -v tar >/dev/null 2>&1 || die "tar is needed"

url="https://github.com/$REPO/releases/download/$CHANNEL/$asset"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading $asset"
curl -fSL --progress-bar "$url" -o "$tmp/$asset" || die "Download failed: $url"
tar -xzf "$tmp/$asset" -C "$tmp"

mkdir -p "$DIR"
install -m 755 "$tmp/kill-email" "$DIR/kill-email"
say "Installed $DIR/kill-email"

case ":$PATH:" in
  *":$DIR:"*) ;;
  *) say "Add it to your PATH to run it by name: export PATH=\"$DIR:\$PATH\"" ;;
esac

if [ "${KILL_EMAIL_NO_RUN:-}" = "1" ]; then
  exit 0
fi
# Piped into sh, stdin is this script; give the app the terminal instead
if [ -r /dev/tty ]; then
  exec "$DIR/kill-email" "$@" </dev/tty
fi
say "Run it with: $DIR/kill-email"
