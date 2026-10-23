#!/usr/bin/env bash
# Build signed, installable APKs from the original Mini Militia APK.
#
# Usage: patcher/build.sh ORIGINAL.apk OUT_DIR KEYSTORE [BUILD_TOOLS_DIR]
#   KEYSTORE is created on first run. Keep it: Android only installs updates
#   signed with the same key, and it must never be committed to this repo.
#   BUILD_TOOLS_DIR holds zipalign and apksigner (Android build-tools 34).
#
# Produces two variants (install only one; both use the same package name):
#   mini-militia-online-broadcast.apk  anyone can host (needs ZeroTier to pass broadcasts)
#   mini-militia-online-host1.apk      host must be the phone with ZeroTier IP 10.147.17.1
set -euo pipefail

SRC="$1"; OUT="$2"; KS="$3"; BT="${4:-$(dirname "$(command -v apksigner)")}"
HERE="$(cd "$(dirname "$0")" && pwd)"
KS_PASS="${KS_PASS:-minimilitia}"
mkdir -p "$OUT"

if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias mm -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Mini Militia Online" -noprompt
fi

build() {
  local name="$1" target="$2" tmp
  tmp="$(mktemp -d)"
  python3 -I "$HERE/patch_apk.py" "$SRC" "$tmp/unsigned.apk" --lan-target "$target"
  "$BT/zipalign" -f -p 4 "$tmp/unsigned.apk" "$tmp/aligned.apk"
  "$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias mm \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --out "$OUT/$name.apk" "$tmp/aligned.apk"
  "$BT/apksigner" verify "$OUT/$name.apk"
  rm -rf "$tmp"
  echo "built $OUT/$name.apk"
}

build mini-militia-online-broadcast 10.147.17.255
build mini-militia-online-host1 10.147.17.1
