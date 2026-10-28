#!/bin/bash
# Turns Bazzite into ReaperOS. Runs once, inside the image build.
set -ouex pipefail

# ReaperOS files: the app in /usr/lib/reaperos, the session, scripts and settings
cp -avf /ctx/system_files/. /

# The ReaperOS app (Electron). chrome-sandbox must be setuid root for Chromium's sandbox.
test -x /usr/lib/reaperos/reaperos
chown root:root /usr/lib/reaperos/chrome-sandbox
chmod 4755 /usr/lib/reaperos/chrome-sandbox
ln -sf /usr/lib/reaperos/reaperos /usr/bin/reaperos

chmod 0755 /usr/bin/reaperos-session /usr/bin/reaperos-desktop-mode /usr/bin/reaperos-gaming-mode \
  /usr/libexec/reaperos-set-session /usr/libexec/reaperos-autologin /usr/libexec/reaperos-batocera
chmod 0440 /etc/sudoers.d/reaperos-session
visudo -cf /etc/sudoers.d/reaperos-session

# Libraries the app needs, and mpv for ReaperOS Player (most are already in Bazzite)
dnf5 install -y --skip-unavailable efibootmgr mpv nss gtk3 alsa-lib mesa-libgbm libXScrnSaver cups-libs at-spi2-atk

# Sign in to the ReaperOS session automatically at boot
systemctl enable reaperos-autologin.service

# Tell Universal Blue's update tools which image this is
if [ -f /usr/share/ublue-os/image-info.json ]; then
  jq '."image-name" = "reaperos"
      | ."image-vendor" = "nookiekrizp-sketch"
      | ."image-ref" = "ostree-unverified-registry:ghcr.io/nookiekrizp-sketch/reaperos"' \
    /usr/share/ublue-os/image-info.json > /tmp/image-info.json
  mv /tmp/image-info.json /usr/share/ublue-os/image-info.json
fi

# Name the OS in "About this system" while keeping Bazzite's IDs, which its tools rely on
if [ -f /usr/lib/os-release ]; then
  sed -i 's/^PRETTY_NAME=.*/PRETTY_NAME="ReaperOS (Bazzite)"/' /usr/lib/os-release
fi
