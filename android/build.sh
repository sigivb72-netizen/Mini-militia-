#!/usr/bin/env bash
# Build the Jet Skirmish APK without Gradle.
#
# Usage: android/build.sh OUT.apk [KEYSTORE]
#   ANDROID_JAR      path to platforms/android-34/android.jar
#   BUILD_TOOLS      path to build-tools/34.x (aapt2, d8, zipalign, apksigner)
#   KEYSTORE         defaults to android/test-signing.keystore (created if
#                    missing). Keep the same keystore: Android installs an
#                    update over an older version only if both use the same key.
set -euo pipefail

OUT="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
KS="${2:-$HERE/test-signing.keystore}"
KS_PASS="${KS_PASS:-jetskirmish}"
: "${ANDROID_JAR:?set ANDROID_JAR to platforms/android-34/android.jar}"
: "${BUILD_TOOLS:?set BUILD_TOOLS to a build-tools/34.x directory}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias jet \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Jet Skirmish test build" -noprompt
fi

# Game files go into assets/game; the README and dev-only files stay out.
mkdir -p "$WORK/assets/game"
(cd "$ROOT/game" && cp -r index.html style.css manifest.webmanifest src vendor "$WORK/assets/game/")

"$BUILD_TOOLS/aapt2" compile --dir "$HERE/res" -o "$WORK/res.zip"
"$BUILD_TOOLS/aapt2" link -o "$WORK/base.apk" -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" -A "$WORK/assets" "$WORK/res.zip" \
  --min-sdk-version 24 --target-sdk-version 34

mkdir -p "$WORK/classes"
javac -source 8 -target 8 -nowarn -Xlint:-options -bootclasspath "$ANDROID_JAR" -cp "$ANDROID_JAR" -d "$WORK/classes" \
  $(find "$HERE/src" -name '*.java')
"$BUILD_TOOLS/d8" --min-api 24 --lib "$ANDROID_JAR" --output "$WORK" $(find "$WORK/classes" -name '*.class')
(cd "$WORK" && zip -q -j base.apk classes.dex)

"$BUILD_TOOLS/zipalign" -f -p 4 "$WORK/base.apk" "$WORK/aligned.apk"
"$BUILD_TOOLS/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias jet \
  --out "$OUT" "$WORK/aligned.apk"
"$BUILD_TOOLS/apksigner" verify "$OUT"
rm -f "$OUT.idsig"
echo "built $OUT"
