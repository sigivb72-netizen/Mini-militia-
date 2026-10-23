#!/usr/bin/env bash
# Turns a free Oracle Cloud (or any Ubuntu) VM into a ZeroTier "moon": a relay
# close to the players, used whenever two phones can't connect directly.
#
# Usage:  sudo bash setup-moon.sh [PUBLIC_IP]
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo bash $0"; exit 1; }

ZT=/var/lib/zerotier-one
PORT=9993
PUBLIC_IP="${1:-$(curl -fsS https://api.ipify.org)}"

if ! command -v zerotier-cli >/dev/null 2>&1; then
  curl -fsSL https://install.zerotier.com | bash
fi
systemctl enable --now zerotier-one

# Oracle's Ubuntu images ship iptables rules that reject everything but SSH.
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p udp --dport "$PORT" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p udp --dport "$PORT" -j ACCEPT
  if command -v apt-get >/dev/null 2>&1 && ! command -v netfilter-persistent >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
  fi
  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi
fi
# Oracle Linux images use firewalld instead.
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$PORT/udp"
  firewall-cmd --reload
fi

for _ in $(seq 30); do [ -s "$ZT/identity.public" ] && break; sleep 1; done
[ -s "$ZT/identity.public" ] || { echo "ZeroTier identity not created"; exit 1; }

NODE_ID="$(zerotier-cli info | awk '{print $3}')"
mkdir -p "$ZT/moons.d"

if ! ls "$ZT"/moons.d/*.moon >/dev/null 2>&1; then
  WORK="$(mktemp -d)"
  cd "$WORK"
  zerotier-idtool initmoon "$ZT/identity.public" > moon.json
  python3 - "$PUBLIC_IP/$PORT" <<'PY'
import json, sys
m = json.load(open("moon.json"))
m["roots"][0]["stableEndpoints"] = [sys.argv[1]]
json.dump(m, open("moon.json", "w"), indent=2)
PY
  zerotier-idtool genmoon moon.json
  cp ./*.moon "$ZT/moons.d/"
  cp moon.json "$ZT/moon.json"
  systemctl restart zerotier-one
fi

cat <<MSG

Relay ready.
  Public IP : $PUBLIC_IP
  Moon ID   : $NODE_ID

Still to do in the Oracle web console (once):
  Networking > Virtual Cloud Networks > your VCN > Security Lists > Default
  > Add Ingress Rule: Source 0.0.0.0/0, IP Protocol UDP, Destination Port $PORT

On each phone, add a moon in the ZeroTier client's settings with
  World ID: $NODE_ID   Seed: $NODE_ID
(the open-source ZerotierFix client supports this; see relay/README.md).
On a PC/Linux client instead run:
  zerotier-cli orbit $NODE_ID $NODE_ID
MSG
