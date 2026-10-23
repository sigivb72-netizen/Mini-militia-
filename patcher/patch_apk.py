#!/usr/bin/env python3
"""Patch a Mini Militia (Doodle Army 2) 4.0.x APK for internet play over a
virtual LAN (ZeroTier) and for installing on Android 15+.

What it changes, and nothing else:
  1. lib/armeabi-v7a/libcocos2dcpp.so: the LAN lobby finds games by sending a
     RakNet ping to 255.255.255.255 on UDP 9331-9341 (RakNetLAN::pingForServer,
     the only user of that string). Android sends that broadcast out of Wi-Fi /
     mobile data, never into the ZeroTier VPN, so remote hosts are never found.
     The string is replaced with an address that routes through ZeroTier.
  2. AndroidManifest.xml: targetSdkVersion 23 -> 24. Android 15+ refuses to
     install apps that target below 24.
  3. Old v1 signature removed; the output must be re-signed (see build.sh).

Usage: patch_apk.py IN.apk OUT-unsigned.apk --lan-target 10.147.17.255
"""
import argparse, ipaddress, struct, sys, zipfile

SO_PATH = "lib/armeabi-v7a/libcocos2dcpp.so"
BROADCAST = b"255.255.255.255\0"
TARGET_SDK_ATTR = 0x01010270
MIN_TARGET_SDK = 24


def patch_so(data, target):
    ipaddress.IPv4Address(target)  # validates
    if data.count(BROADCAST) != 1:
        sys.exit("libcocos2dcpp.so: expected exactly one 255.255.255.255 string; "
                 "unsupported game version")
    new = target.encode().ljust(len(BROADCAST), b"\0")  # <= 15 chars, NUL padded
    return data.replace(BROADCAST, new)


def patch_manifest(data):
    """Raise targetSdkVersion in binary AndroidManifest.xml (AXML)."""
    buf = bytearray(data)
    pos = 8
    res_ids = []
    patched = False
    while pos < len(buf):
        ctype, hsize, csize = struct.unpack_from("<HHI", buf, pos)
        if ctype == 0x0180:  # XML_RESOURCE_MAP
            n = (csize - hsize) // 4
            res_ids = list(struct.unpack_from("<%dI" % n, buf, pos + hsize))
        elif ctype == 0x0102:  # XML_START_ELEMENT
            ext = pos + hsize
            attr_start, attr_size, attr_count = struct.unpack_from("<HHH", buf, ext + 8)
            for i in range(attr_count):
                a = ext + attr_start + i * attr_size
                name = struct.unpack_from("<I", buf, a + 4)[0]
                if name < len(res_ids) and res_ids[name] == TARGET_SDK_ATTR:
                    vtype = buf[a + 15]
                    value = struct.unpack_from("<I", buf, a + 16)[0]
                    if vtype != 0x10:  # TYPE_INT_DEC
                        sys.exit("targetSdkVersion is not an integer; unsupported manifest")
                    if value < MIN_TARGET_SDK:
                        struct.pack_into("<I", buf, a + 16, MIN_TARGET_SDK)
                    patched = True
        pos += csize
    if not patched:
        sys.exit("targetSdkVersion not found in manifest")
    return bytes(buf)


def is_old_signature(name):
    if not name.startswith("META-INF/") or name.count("/") != 1:
        return False
    return name == "META-INF/MANIFEST.MF" or name.rsplit(".", 1)[-1] in ("SF", "RSA", "DSA", "EC")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--lan-target", required=True,
                    help="address LAN discovery pings go to, e.g. 10.147.17.255 or 10.147.17.1")
    args = ap.parse_args()

    with zipfile.ZipFile(args.src) as zin, \
         zipfile.ZipFile(args.dst, "w", zipfile.ZIP_DEFLATED) as zout:
        names = zin.namelist()
        for required in (SO_PATH, "AndroidManifest.xml"):
            if required not in names:
                sys.exit("%s missing from APK" % required)
        for info in zin.infolist():
            if is_old_signature(info.filename):
                continue
            data = zin.read(info)
            if info.filename == SO_PATH:
                data = patch_so(data, args.lan_target)
            elif info.filename == "AndroidManifest.xml":
                data = patch_manifest(data)
            out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            out.compress_type = info.compress_type
            out.external_attr = info.external_attr
            zout.writestr(out, data)
    print("patched: LAN discovery -> %s, targetSdkVersion >= %d" % (args.lan_target, MIN_TARGET_SDK))


if __name__ == "__main__":
    main()
