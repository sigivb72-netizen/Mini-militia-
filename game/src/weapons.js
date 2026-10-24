// Weapon stats. rate = shots per second, mag/reserve = rounds, spread in
// radians, len = drawn barrel length. projectile weapons fire a rocket
// instead of a hitscan bullet.
export const WEAPONS = {
  pistol:  { name: 'Pistol',  dmg: 20, rate: 4,   mag: 12, reserve: 60,  reload: 1.1, spread: 0.025, range: 1000, pellets: 1, len: 16 },
  smg:     { name: 'SMG',     dmg: 12, rate: 12,  mag: 32, reserve: 128, reload: 1.6, spread: 0.075, range: 850,  pellets: 1, len: 22 },
  rifle:   { name: 'Rifle',   dmg: 17, rate: 8,   mag: 28, reserve: 112, reload: 1.8, spread: 0.035, range: 1300, pellets: 1, len: 30 },
  shotgun: { name: 'Shotgun', dmg: 10, rate: 1.3, mag: 6,  reserve: 30,  reload: 2.2, spread: 0.22,  range: 520,  pellets: 8, len: 26 },
  sniper:  { name: 'Sniper',  dmg: 85, rate: 0.9, mag: 5,  reserve: 20,  reload: 2.4, spread: 0.002, range: 2600, pellets: 1, len: 38, zoom: true },
  rocket:  { name: 'Rocket',  dmg: 95, rate: 0.8, mag: 2,  reserve: 6,   reload: 2.6, spread: 0.01,  range: 0,    pellets: 1, len: 30, projectile: 'rocket', radius: 150 },
};

export const GRENADE = { dmg: 90, radius: 170, fuse: 2.2, speed: 750, perLife: 3 };
export const MELEE = { dmg: 45, range: 55, cooldown: 0.6 };
export const MEDKIT_HEAL = 60;
