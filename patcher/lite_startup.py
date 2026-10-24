#!/usr/bin/env python3
"""Turn off Google Play Games and dead third-party services at startup.

Runs on an apktool-decoded tree (apktool d -r). The game is no longer on the
Play Store and these services are shut down or useless; on new phones their
old SDKs can stall startup. Each change is an early return or a skipped
assignment, and the game null-checks every one of them already.

Usage: lite_startup.py DECODED_DIR
"""
import glob, os, re, sys

ROOT = sys.argv[1]

# (class, method name+signature, what to return)
NEUTER = [
    # Google Play Games / Play services: report "not installed" so the game
    # skips GPGS init, sign-in prompts and Play services update dialogs.
    ("com/appsomniacs/da2/DA2Activity", "isGooglePlayServicesAvailable()Z", "false"),
    # Location analytics, residential-proxy SDK, ad interstitials.
    ("com/appsomniacs/da2/DA2Activity", "initializeCuebiq()V", "void"),
    ("com/appsomniacs/da2/DA2Activity", "initLuminatiTopVpnSdk()V", "void"),
    ("com/appsomniacs/da2/DA2Activity", "isLuminatiPeer()Z", "false"),
    ("com/appsomniacs/da2/DA2Activity", "initializeInterstitial()V", "void"),
    ("com/appsomniacs/da2/DA2Activity", "loadInterstitial()V", "void"),
    ("com/appsomniacs/da2/DA2Activity", "showInterstitial()V", "void"),
    # Analytics / ad SDKs started from onCreate.
    ("com/newrelic/agent/android/NewRelic", "start(Landroid/content/Context;)V", "void"),
    ("com/mopub/mobileads/MoPubConversionTracker", "reportAppOpen(Landroid/content/Context;)V", "void"),
]
INMOBI_INIT = ("com/inmobi/sdk/InMobiSdk", re.compile(r"init\(Landroid/(app/Activity|content/Context);Ljava/lang/String;\)V"))


def smali_path(cls):
    hits = glob.glob(os.path.join(ROOT, "smali*", cls + ".smali"))
    if len(hits) != 1:
        sys.exit("class not found: " + cls)
    return hits[0]


def neuter(text, sig_match, ret, label):
    lines = text.split("\n")
    count = 0
    for i, line in enumerate(lines):
        if not line.startswith(".method ") or "abstract" in line or "native" in line:
            continue
        name = line.split()[-1]
        if not sig_match(name):
            continue
        j = i + 1
        while not lines[j].strip().startswith((".locals", ".registers")):
            j += 1
        directive, n = lines[j].split()
        if ret == "false":
            if int(n) < 1:
                lines[j] = "    %s 1" % directive
            body = ["    const/4 v0, 0x0", "    return v0"]
        else:
            body = ["    return-void"]
        lines[j + 1:j + 1] = body
        count += 1
    if count == 0:
        sys.exit("method not found: " + label)
    return "\n".join(lines)


for cls, sig, ret in NEUTER:
    p = smali_path(cls)
    with open(p) as f:
        s = f.read()
    s = neuter(s, lambda n, sig=sig: n == sig, ret, cls + "." + sig)
    with open(p, "w") as f:
        f.write(s)
    print("disabled", cls.split("/")[-1] + "." + sig.split("(")[0])

cls, rx = INMOBI_INIT
p = smali_path(cls)
with open(p) as f:
    s = f.read()
s = neuter(s, lambda n: bool(rx.fullmatch(n)), "void", "InMobiSdk.init")
with open(p, "w") as f:
    f.write(s)
print("disabled InMobiSdk.init")

# Never create the Play Games client, so onStart() doesn't try to sign in.
p = smali_path("com/appsomniacs/da2/DA2Activity")
with open(p) as f:
    s = f.read()
field = "Lcom/appsomniacs/da2/DA2Activity;->mGoogleApiClient:Lcom/google/android/gms/common/api/GoogleApiClient;"
m = re.search(r"(\.method protected onCreate\(Landroid/os/Bundle;\)V.*?\.end method)", s, re.S)
body = m.group(1)
puts = re.findall(r"\n\s*iput-object [vp]\d+, [vp]\d+, " + re.escape(field), body)
if len(puts) != 1:
    sys.exit("expected one mGoogleApiClient assignment in onCreate, found %d" % len(puts))
s = s.replace(body, body.replace(puts[0], "\n    # Play Games client disabled"))
with open(p, "w") as f:
    f.write(s)
print("disabled Google Play Games client")
