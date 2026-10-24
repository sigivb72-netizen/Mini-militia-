# Mini Militia: online play over a virtual LAN

Patches for Mini Militia – Doodle Army 2 **4.0.36** (`com.TVLMODS.da2`) so you
can play the game's own LAN mode with friends anywhere, plus a fix for
installing on Android 15+. Gameplay, mods (ammo, flight) and normal Wi-Fi LAN
play are untouched.

The game APK and signing key are **not** in this repo (it's public). Build
them with `patcher/build.sh` from your own copy of the APK.

## How the game's multiplayer works (from the APK)

- All multiplayer is native C++ (`libcocos2dcpp.so`, cocos2d-x 2.2.5) using
  **RakNet** over UDP. The Java side has no LAN code.
- **LAN host** (`RakNetLocalServer::startServer`): RakNet server bound to
  `0.0.0.0` on the first free UDP port in **9331–9341**.
- **LAN join** (`RakNetLAN::findSessions` / `pingForServer`): client binds UDP
  9330 and repeatedly sends a RakNet unconnected ping to **255.255.255.255**,
  cycling ports 9331–9341. Any host that replies appears in the lobby, and the
  client connects to the reply's source address.
- Opening LAN mode does **not** check for Wi-Fi (`MultiplayerGameLayer::onLocal`).
- The official online servers (`*.kryptcloud.com`, `appsomniacs.azurewebsites.net`)
  belong to the old publisher and aren't usable for this.

So the game already works across any network that looks like a LAN, except
for one thing: Android sends the 255.255.255.255 broadcast out of Wi-Fi or
mobile data, never into a VPN like ZeroTier, so remote hosts are never found.

## What the patch changes

1. In `libcocos2dcpp.so`, the single `255.255.255.255` string (used only by
   LAN discovery) becomes a ZeroTier address. Two variants are built:
   - `mini-militia-online-broadcast.apk` → `10.147.17.255`, the ZeroTier
     subnet's broadcast. Anyone can host, **if** ZeroTier's Android app
     forwards subnet broadcasts (unverified).
   - `mini-militia-online-host1.apk` → `10.147.17.1`, a normal unicast. Always
     routes, but the host must be the phone holding ZeroTier IP `10.147.17.1`.
   With either one, Wi-Fi LAN play with phones on the same hotspot stops
   finding games, because discovery no longer broadcasts on Wi-Fi. Keep using
   ZeroTier even when you're in the same room.
2. `targetSdkVersion` 23 → 24, because Android 15+ blocks installing apps that
   target below 24.
3. Startup services turned off (`patcher/lite_startup.py`): Google Play Games
   and Play services checks (the game is no longer on the Play Store), New
   Relic, InMobi, MoPub tracking, Cuebiq location analytics, the Luminati
   proxy SDK and interstitial ads. Each is an early return the game already
   handles, because it skips them on phones without Play services.
4. Re-signed with v1+v2+v3 signatures (the original had only the old v1).

## Play with a friend in another city

1. Create a free network at <https://my.zerotier.com>. Under **IPv4
   Auto-Assign** choose the `10.147.17.*` range.
2. Both phones: install **ZeroTier One**, join the Network ID and accept the
   VPN prompt. On the website, tick **Auth** for both members.
3. Uninstall the old Mini Militia and install one patched APK on both phones
   (same variant on both). Uninstalling wipes local progress.
4. Try `broadcast` first: one phone hosts LAN, the other opens LAN join.
5. If the room never shows, switch both phones to `host1`. In ZeroTier
   Central, set the hosting phone's Managed IP to `10.147.17.1`. Only that
   phone hosts; to swap hosts, move `10.147.17.1` to the other phone.

For lower lag when the phones can't connect directly (common on SA mobile
networks), add the free Johannesburg relay in [`relay/`](relay/README.md).

## Known limits

- **32-bit only.** The game ships only `armeabi-v7a` native code. Phones that
  can't run 32-bit apps (e.g. Pixel 7 and newer) can't run it, and this can't
  be fixed without the game's source code.
- **iOS is not possible.** An Android APK can't be converted to iOS.
- Not tested on a device yet; both variants are built and signature-verified.
- Google Play Games features (leaderboards, achievements, Play sign-in) are
  off.

## Building

```bash
# needs python3, Java, Android build-tools 34 (zipalign, apksigner) and apktool
patcher/build.sh original.apk out/ my-release.keystore /path/to/build-tools apktool.jar
```
