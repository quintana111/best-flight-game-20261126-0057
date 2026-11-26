# Garuda Senja — Island Ring Run

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/quintana111/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/quintana111/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

An original arcade flight game for the make.fun best-flight-game bounty.
Fly the bush plane **PK-GSJ** through six glowing golden rings over a
Nusantara archipelago at golden hour — past beaches, islets and the
smoking volcano Gunung Senja — then bring her home and land on the
island runway before the 5-minute clock runs out.

## How to play

- **Goal:** fly through all 6 rings (150 pts each), then land on the runway.
  Landing slow and level on the strip after all rings wins the run.
  Crashing into terrain or ditching in the sea ends it; the clock running
  out does too.
- **W / S** — throttle up / down
- **↑ / ↓** — pitch (climb / dive)
- **← / →** or **A / D** — roll and turn
- **Mouse drag** on the game — steer
- **P** — pause, **R** — restart, **M** — mute

The HUD shows altitude (ft), speed (kt), heading, rings flown, time and
score; the instrument panel has an artificial horizon, compass strip,
altimeter and airspeed tapes, and a throttle gauge.

## How to run

Open `game/index.html` in a desktop browser, or serve the `game/` folder
with any static server, e.g. `python3 -m http.server` inside `game/`.
No network is used: no libraries, no CDN, no fetched assets — all art is
procedural canvas 2D and all sound is synthesised WebAudio.

Deterministic screenshot poses are available via query params, e.g.
`game/index.html?shot=play&seed=1` (`start`, `play`, `runway`, `end`).

## Licence

MIT — see `LICENSE`. Original game, art, sounds and names; no third-party
assets.
