# Low-latency relay for South Africa (free)

Mini Militia's multiplayer only works over a local network (LAN), so internet
play uses a virtual LAN: [ZeroTier](https://www.zerotier.com). Phones connect
directly when they can. When they can't (common on mobile data), traffic goes
through a relay. ZeroTier's own relays are overseas, which adds lag, so this
folder sets up a free relay in Johannesburg.

## 1. Get a free server (Oracle Cloud Always Free)

1. Sign up at <https://www.oracle.com/cloud/free/>. **Choose
   "South Africa Central (Johannesburg)" as your home region.** Free servers
   only run in your home region, and it can't be changed later.
   A card is needed to verify your identity; it isn't charged.
2. Compute > Instances > Create instance:
   - Image: **Canonical Ubuntu** (22.04 or 24.04)
   - Shape: `VM.Standard.E2.1.Micro` (Always Free). The Ampere A1 shape also
     works if it isn't "out of capacity".
   - Keep "Assign a public IPv4 address" on and download the SSH key.
3. Open the relay port: Networking > Virtual Cloud Networks > your VCN >
   Security Lists > Default Security List > **Add Ingress Rule**
   - Source CIDR `0.0.0.0/0`, IP Protocol **UDP**, Destination Port **9993**

## 2. Install the relay

SSH in (`ssh -i key.pem ubuntu@<public-ip>`), then:

```bash
curl -fsSLO https://raw.githubusercontent.com/sigivb72-netizen/Mini-militia-/ccr-526ce2e0-967aej/relay/setup-moon.sh
sudo bash setup-moon.sh
```

(Or copy `setup-moon.sh` to the server with `scp`.) It installs ZeroTier, opens
the server's firewall, and turns the server into a ZeroTier relay (a "moon").
At the end it prints a **Moon ID**.

## 3. Point the phones at it

Each phone has to "orbit" the moon using the Moon ID.

- The official **ZeroTier One** Android app may not have a moon setting.
  Moon support isn't documented for it.
- **ZerotierFix** is an open-source Android client built from the official
  one, with moon support: <https://github.com/kaaass/ZerotierFix>. In its
  settings, add a moon with World ID = Seed = the Moon ID.

## 4. Play

Use the patched APK and ZeroTier setup in the [main README](../README.md).
