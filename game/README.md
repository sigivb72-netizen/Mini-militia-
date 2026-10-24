# Jet Skirmish (working title)

An original 2D jetpack shooter in the style of LAN-party mobile shooters:
jetpack flight, two weapon slots, grenades, melee, pickups, bots, and online
rooms with friends. Runs in any phone or desktop browser (Android and iPhone),
and can be added to the home screen.

All art is placeholder shapes, drawn in `src/render.js`. Maps are plain
polygons in `src/maps.js`; the game builds collision from them.

## Play
Serve the folder with any static web server, e.g.

```bash
cd game && python3 -m http.server 8000   # then open http://localhost:8000
```

- **Play vs bots**: offline match.
- **Host online room**: your device runs the match and shows a 5-letter room
  code. **Invite friends** shares a link that fills in the code.
- **Join**: enter a friend's room code.

Phone controls: left thumb moves (push up to fly), right thumb aims (push to
the edge to shoot), buttons for reload, swap, grenade, melee and pick up.
Desktop: A/D move, W/Space fly, mouse aim and shoot, R reload, Q swap,
E pick up, G or right-click grenade, F melee, Tab scores.

## Online play (no game server)
Rooms use WebRTC peer-to-peer connections through [PeerJS](https://peerjs.com).
PeerJS's free hosted broker introduces the phones, then game traffic goes
directly between them. The host's device runs the authoritative simulation;
others send inputs (30/s) and receive snapshots (20/s).

Some mobile networks block direct connections. If friends can't join, add a
free TURN relay (e.g. a metered.ca free account) to `ICE_SERVERS` in
`src/net.js`. Add `?debug` to the URL to log connection details.

## Code map
| File | What it does |
|---|---|
| `src/sim.js` | Game rules: movement, jetpack, weapons, damage, pickups, scoring |
| `src/bots.js` | Bot behaviour |
| `src/geom.js` | Polygon collision and ray casts |
| `src/maps.js` | Maps (Quarry, Bunker, Skyline) as polygons + spawn and pickup points |
| `src/weapons.js` | Weapon stats |
| `src/render.js` | All drawing (swap placeholder shapes for art here) |
| `src/input.js` | Touch sticks, buttons, keyboard and mouse |
| `src/net.js` | Online rooms |
| `src/main.js` | Menus, game loop, host/client wiring |
