#!/usr/bin/env bash
set -euo pipefail

# Idempotent repository bootstrap for the Cloud Agent environment. Runs from the
# repository root after the source is checked out. Safe to run repeatedly and
# against cached/snapshotted state.

# Use the pnpm version pinned in package.json's `packageManager` field.
corepack enable
corepack prepare pnpm@11.14.0 --activate

# Recreate node_modules deterministically from the committed lockfile.
pnpm install --frozen-lockfile

# The Playwright-driven end-to-end suite (`pnpm e2e`) launches a real Chrome and
# loads the unpacked extension into it. The base image already ships Google
# Chrome; install it only when missing so this stays a no-op on a warm snapshot
# and still works from a bare image.
if ! command -v google-chrome-stable >/dev/null 2>&1; then
  echo "Google Chrome not found; installing for the e2e suite..."
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends wget ca-certificates gnupg
  wget -q -O /tmp/google-chrome.deb \
    https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y --no-install-recommends /tmp/google-chrome.deb
  rm -f /tmp/google-chrome.deb
fi

# scripts/e2e.mjs defaults CHROME_PATH to a macOS application path. Expose the
# Linux binary to interactive/login shells so `pnpm e2e` runs without a manual
# override. (environment.json has no env field, so persist it via the shell rc.)
CHROME_BIN="$(command -v google-chrome-stable)"
if ! grep -q 'CHROME_PATH=' "${HOME}/.bashrc" 2>/dev/null; then
  echo "export CHROME_PATH=\"${CHROME_BIN}\"" >> "${HOME}/.bashrc"
fi

echo "semantic-dark environment ready (node $(node -v), pnpm $(pnpm -v), chrome: ${CHROME_BIN})"
