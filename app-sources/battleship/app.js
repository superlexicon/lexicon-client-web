/**
 * PHANTOM FLEET: 100-PLAYER RED vs. BLUE NAVAL WARFARE & ECONOMY (HFS #13 — Live Subnet 1)
 *
 * Designed for 1–3 block live finality over `wss://node1.superlexicon.com/rpc`:
 * 1. Instant `100%` Square Hits: Every hit on an intact hull square immediately destroys that
 *    square (`100%`), awarding `+120 CR` + Kill Bounties (`120–600 CR`) when all squares are hit.
 * 2. 8-Direction Compass (`N, NE, E, SE, S, SW, W, NW`) + Percentage Speed Throttle
 *    (`25% / 50% / 75% / 100%` of Max Speed): `battleship.wasm` computes the final grid coordinates
 *    on-chain and emits `ShipMoved`, teleporting the ship directly from the receipt event log!
 * 3. Dual Green Move vs. Hold-Key (`Shift` / `Space`) Red Targeting Cursor Modes:
 *    - Default Mouse Mode = Green Navigation Mode (8-way compass rays + green move square + `%` popover).
 *    - Hold `Shift` or `Space` = Red Targeting Mode (gun range ring + red targeting square(s); click fires!).
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  keccak256Hex,
  selectorBytes,
  signLexiconTx,
  SlxWalletManager,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  truncAddr4,
  readOnChainIdentityNickname,
  slxWatchChainApp,
  slxWaitForReceipt,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from './slx-hfs-registry.js';
import { mountSlxGameGuide, hasSeenGameWelcome } from './game-guide.js';
import {
  FleetSocialClient,
  FleetSocialAbi,
  bridgeChannelHash,
  squadronChannelHash,
  deterministicEncounterNonce,
  computeEncounterCommit,
} from './slx-fleet-social.js';

// ---------------------------------------------------------------------------
// Game Balance Tables (Exact 1:1 Mirror of `examples/battleship/src/main.rs`)
// ---------------------------------------------------------------------------

const MAX_PLAYERS = 100;
const SHIPS_PER_PLAYER = 3;
const STARTING_CREDITS = 1000;
const REPAIR_COST_PER_CELL = 100;
const CREDITS_PER_CELL_HIT = 120;
const TEAM_RED = 0;
const TEAM_BLUE = 1;

const HULL_CLASSES = [
  {
    id: 0,
    name: 'Patrol Gunboat',
    short: 'Gunboat',
    icon: '🚤',
    len: 2,
    wid: 1,
    cells: 2,
    cost: 200,
    bounty: 120,
    maxSpeed: 12,
    mountLabel: 'S',
    sinkCells: 2,
  },
  {
    id: 1,
    name: 'Frigate',
    short: 'Frigate',
    icon: '⚓',
    len: 3,
    wid: 1,
    cells: 3,
    cost: 350,
    bounty: 200,
    maxSpeed: 8,
    mountLabel: 'M',
    sinkCells: 3,
  },
  {
    id: 2,
    name: 'Heavy Cruiser',
    short: 'Cruiser',
    icon: '⛴️',
    len: 4,
    wid: 1,
    cells: 4,
    cost: 550,
    bounty: 320,
    maxSpeed: 6,
    mountLabel: 'L',
    sinkCells: 4,
  },
  {
    id: 3,
    name: 'Dreadnought',
    short: 'Dreadnought',
    icon: '🛳️',
    len: 5,
    wid: 2,
    cells: 10,
    cost: 1100,
    bounty: 600,
    maxSpeed: 4,
    mountLabel: 'XL',
    sinkCells: 10,
  },
];

const WEAPONS = [
  {
    id: 0,
    name: 'Deck Autocannon',
    minClass: 0,
    mountLabel: 'S',
    cost: 0,
    range: 10,
    pattern: 0, // 1x1
    spreadDesc: '1×1 Pinpoint',
  },
  {
    id: 1,
    name: 'Twin Torpedo Salvo',
    minClass: 0,
    mountLabel: 'S',
    cost: 250,
    range: 9,
    pattern: 1, // 2x2
    spreadDesc: '2×2 Area (4 sq)',
  },
  {
    id: 2,
    name: '155mm Howitzer',
    minClass: 1,
    mountLabel: 'M (Frigate+)',
    cost: 450,
    range: 14,
    pattern: 2, // + cross
    spreadDesc: '+ Cross (5 sq)',
  },
  {
    id: 3,
    name: '280mm Broadside',
    minClass: 2,
    mountLabel: 'L (Cruiser+)',
    cost: 700,
    range: 18,
    pattern: 1, // 2x2
    spreadDesc: '2×2 Heavy (4 sq)',
  },
  {
    id: 4,
    name: 'Siege Railgun',
    minClass: 3,
    mountLabel: 'XL (Dreadnought)',
    cost: 1100,
    range: 30,
    pattern: 0, // 1x1 long-range sniper
    spreadDesc: '1×1 Sniper',
  },
];

const ENGINE_UPGRADE_COST = [200, 450];
const ENGINE_SPEED_BONUS = [0, 2, 4];

const COMPASS_DIRS = [
  { dir8: 0, code: 'N',  arrow: '↑', name: 'North',      dx:  0, dy: -1 },
  { dir8: 1, code: 'NE', arrow: '↗', name: 'North-East', dx:  1, dy: -1 },
  { dir8: 2, code: 'E',  arrow: '→', name: 'East',       dx:  1, dy:  0 },
  { dir8: 3, code: 'SE', arrow: '↘', name: 'South-East', dx:  1, dy:  1 },
  { dir8: 4, code: 'S',  arrow: '↓', name: 'South',      dx:  0, dy:  1 },
  { dir8: 5, code: 'SW', arrow: '↙', name: 'South-West', dx: -1, dy:  1 },
  { dir8: 6, code: 'W',  arrow: '←', name: 'West',       dx: -1, dy:  0 },
  { dir8: 7, code: 'NW', arrow: '↖', name: 'North-West', dx: -1, dy: -1 },
];

export const TOPIC_SHIP_MOVED = keccak256Hex(
  utf8ToBytes('ShipMoved(bytes32,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)')
).toLowerCase();

export const TOPIC_VESSEL_COLLISION = keccak256Hex(
  utf8ToBytes('VesselCollision(bytes32,uint64,uint64,uint64,uint64,uint64,uint64,uint64)')
).toLowerCase();

export const TOPIC_WEAPON_FIRED = keccak256Hex(
  utf8ToBytes('WeaponFired(bytes32,uint64,uint64,uint64,uint64,uint64)')
).toLowerCase();

export const TOPIC_SHIP_SUNK = keccak256Hex(
  utf8ToBytes('ShipSunk(bytes32,uint64,uint64,uint64)')
).toLowerCase();

export const TOPIC_SHIP_COMMISSIONED = keccak256Hex(
  utf8ToBytes('ShipCommissioned(bytes32,uint64,uint64,uint64,uint64,uint64)')
).toLowerCase();

export const TOPIC_PLAYER_RESTARTED = keccak256Hex(
  utf8ToBytes('PlayerRestarted(bytes32,address,uint64,uint64,uint64)')
).toLowerCase();

// ---------------------------------------------------------------------------
// Dynamic Grid Formula, Speed Math & Geometry Helpers
// ---------------------------------------------------------------------------

export function computeDynamicGridDims(playerCount) {
  if (playerCount <= 4) return { gridW: 40, gridH: 25 };
  const targetTiles = 1000 + 220 * (playerCount - 4);
  let h = 25;
  let w = 40;
  while (w * h < targetTiles && h < 125) {
    h += 1;
    w = Math.min(200, Math.floor((h * 8 + 4) / 5));
  }
  return { gridW: w, gridH: h };
}

function shipDims(classId, dir) {
  const meta = HULL_CLASSES[classId] || HULL_CLASSES[0];
  return dir === 0 ? [meta.len, meta.wid] : [meta.wid, meta.len];
}

function shipCenter(ship) {
  const [w, h] = shipDims(ship.classId, ship.dir);
  return {
    cx: ship.x + Math.floor(w / 2),
    cy: ship.y + Math.floor(h / 2),
    exactX: ship.x + w / 2,
    exactY: ship.y + h / 2,
    w,
    h,
  };
}

function effectiveMaxSpeed(ship) {
  const meta = HULL_CLASSES[ship.classId] || HULL_CLASSES[0];
  const bonus = ENGINE_SPEED_BONUS[Math.min(2, ship.armorTier || 0)] || 0;
  return meta.maxSpeed + bonus;
}

function cellIndexOnShip(ship, cx, cy) {
  if (!ship.alive) return -1;
  const meta = HULL_CLASSES[ship.classId] || HULL_CLASSES[0];
  const [dxMax, dyMax] = ship.dir === 0 ? [meta.len, meta.wid] : [meta.wid, meta.len];
  if (cx < ship.x || cy < ship.y) return -1;
  const rx = cx - ship.x;
  const ry = cy - ship.y;
  if (rx >= dxMax || ry >= dyMax) return -1;
  return ship.dir === 0 ? ry * meta.len + rx : rx * meta.len + ry;
}

function getImpactCells(gunId, tx, ty, gridW, gridH) {
  const w = WEAPONS[gunId] || WEAPONS[0];
  const raw = [];
  if (w.pattern === 0) {
    raw.push([tx, ty]);
  } else if (w.pattern === 1) {
    raw.push([tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]);
  } else {
    raw.push([tx, ty], [tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]);
  }
  return raw.filter(([x, y]) => x >= 0 && y >= 0 && x < gridW && y < gridH);
}

function shipsOverlap(a, b) {
  const [aw, ah] = shipDims(a.classId, a.dir);
  const [bw, bh] = shipDims(b.classId, b.dir);
  return !(a.x + aw <= b.x || b.x + bw <= a.x || a.y + ah <= b.y || b.y + bh <= a.y);
}

function isPlacementFreeInView(view, ignoreGidx, cand) {
  const [w, h] = shipDims(cand.classId, cand.dir);
  if (cand.x < 0 || cand.y < 0 || cand.x + w > view.gridW || cand.y + h > view.gridH) {
    return false;
  }
  for (const other of view.ships) {
    if (other.alive && other.gidx !== ignoreGidx && shipsOverlap(cand, other)) {
      return false;
    }
  }
  return true;
}

function inOceanBounds(gridW, gridH, classId, dir, x, y) {
  const [w, h] = shipDims(classId, dir);
  return x >= 0 && y >= 0 && x + w <= gridW && y + h <= gridH;
}

/**
 * Exact client-side mirror of `handle_move_ship` in `battleship/src/main.rs`:
 * Free 2D single-click destination anywhere inside the vessel's max range circle (`dx^2 + dy^2 <= maxRange^2`),
 * bounded by ocean edges, with live `collisionSquares` preview when overlapping another alive vessel!
 */
export function navalBaseRect(team, gridW, gridH) {
  if (team === TEAM_RED) {
    return {
      x0: 0,
      y0: 0,
      x1: Math.min(3, Math.max(0, gridW - 1)),
      y1: Math.min(4, Math.max(0, gridH - 1)),
    };
  }
  return {
    x0: Math.max(0, gridW - 4),
    y0: Math.max(0, gridH - 5),
    x1: Math.max(0, gridW - 1),
    y1: Math.max(0, gridH - 1),
  };
}

function shipOverlapsRect(classId, dir, x, y, r) {
  const [w, h] = shipDims(classId, dir);
  const sx1 = x + w - 1;
  const sy1 = y + h - 1;
  return !(sx1 < r.x0 || x > r.x1 || sy1 < r.y0 || y > r.y1);
}

function shipInFriendlyBase(ship, gridW, gridH) {
  if (!ship) return false;
  return shipOverlapsRect(ship.classId, ship.dir, ship.x, ship.y, navalBaseRect(ship.team, gridW, gridH));
}

function shipInEnemyBase(classId, dir, x, y, team, gridW, gridH) {
  const enemyTeam = team === TEAM_RED ? TEAM_BLUE : TEAM_RED;
  return shipOverlapsRect(classId, dir, x, y, navalBaseRect(enemyTeam, gridW, gridH));
}

function computeDirectMovePreview(ship, cursorTx, cursorTy, dirOverride, view) {
  const maxRange = effectiveMaxSpeed(ship);
  const { cx, cy } = shipCenter(ship);

  let hullDir = ship.dir;
  if (dirOverride === 0 || dirOverride === 1) {
    hullDir = dirOverride;
  } else {
    const rdx = Math.abs(cursorTx - cx);
    const rdy = Math.abs(cursorTy - cy);
    if (rdx > rdy) hullDir = 0;
    else if (rdy > rdx) hullDir = 1;
  }

  const [dw, dh] = shipDims(ship.classId, hullDir);
  const destX = Math.max(0, Math.min(view.gridW - dw, cursorTx - Math.floor(dw / 2)));
  const destY = Math.max(0, Math.min(view.gridH - dh, cursorTy - Math.floor(dh / 2)));

  const destCx = destX + Math.floor(dw / 2);
  const destCy = destY + Math.floor(dh / 2);
  const dx = destCx - cx;
  const dy = destCy - cy;
  const distSq = dx * dx + dy * dy;
  const distTiles = Math.max(1, Math.floor(Math.sqrt(distSq)));
  const isNoop = destX === ship.x && destY === ship.y && hullDir === ship.dir;
  const inEnemyHarbor = shipInEnemyBase(
    ship.classId,
    hullDir,
    destX,
    destY,
    ship.team,
    view.gridW,
    view.gridH
  );
  const inBounds =
    inOceanBounds(view.gridW, view.gridH, ship.classId, hullDir, destX, destY) && !inEnemyHarbor;
  const inRange = inBounds && !isNoop && distSq <= maxRange * maxRange;

  const collisionSquares = [];
  if (inBounds && !isNoop) {
    const cand = { alive: true, classId: ship.classId, dir: hullDir, x: destX, y: destY };
    for (const other of view.ships) {
      if (other.alive && other.gidx !== ship.gidx && shipsOverlap(cand, other)) {
        for (let ry = 0; ry < dh; ry++) {
          for (let rx = 0; rx < dw; rx++) {
            const ox = destX + rx;
            const oy = destY + ry;
            if (cellIndexOnShip(other, ox, oy) >= 0) {
              collisionSquares.push([ox, oy]);
            }
          }
        }
      }
    }
  }

  return {
    maxRange,
    destX,
    destY,
    destCx,
    destCy,
    hullDir,
    distSq,
    distTiles,
    inRange,
    isNoop,
    collisionSquares,
  };
}

// ---------------------------------------------------------------------------
// ABI Calldata & Binary State / Event Log Decoders for `battleship.wasm`
// ---------------------------------------------------------------------------

function wordU64(n) {
  const b = new Uint8Array(32);
  let v = BigInt(Math.max(0, Math.floor(Number(n))));
  for (let i = 31; i >= 24; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

function wordBytes32(hex32) {
  const b = new Uint8Array(32);
  b.set(hexToBytes(hex32).slice(0, 32), 0);
  return b;
}

function wordAddress(addrHex) {
  const b = new Uint8Array(32);
  if (addrHex && addrHex !== '0x') {
    b.set(hexToBytes(addrHex).slice(-20), 12);
  }
  return b;
}

export const NavalAbi = {
  createBattle(bid) {
    return bytesToHex(concatBytes(selectorBytes('createBattle(bytes32)'), wordBytes32(bid)));
  },
  joinBattle(bid, preferredTeam) {
    return bytesToHex(
      concatBytes(
        selectorBytes('joinBattle(bytes32,uint64)'),
        wordBytes32(bid),
        wordU64(preferredTeam)
      )
    );
  },
  joinAndDeploy(bid, preferredTeam, s0, s1, s2) {
    return bytesToHex(
      concatBytes(
        selectorBytes('joinAndDeploy(bytes32,uint64,uint64,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(preferredTeam),
        wordU64(s0 < 0 ? 255 : s0),
        wordU64(s1 < 0 ? 255 : s1),
        wordU64(s2 < 0 ? 255 : s2)
      )
    );
  },
  joinAndDeployWithIdentity(bid, preferredTeam, identityAddr, s0, s1, s2) {
    return bytesToHex(
      concatBytes(
        selectorBytes('joinAndDeployWithIdentity(bytes32,uint64,address,uint64,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(preferredTeam),
        wordAddress(identityAddr || '0x0000000000000000000000000000000000000000'),
        wordU64(s0 < 0 ? 255 : s0),
        wordU64(s1 < 0 ? 255 : s1),
        wordU64(s2 < 0 ? 255 : s2)
      )
    );
  },
  setPlayerIdentity(bid, identityAddr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('setPlayerIdentity(bytes32,address)'),
        wordBytes32(bid),
        wordAddress(identityAddr || '0x0000000000000000000000000000000000000000')
      )
    );
  },
  startAnew(bid, s0, s1, s2) {
    return bytesToHex(
      concatBytes(
        selectorBytes('startAnew(bytes32,uint64,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(s0 < 0 ? 255 : s0),
        wordU64(s1 < 0 ? 255 : s1),
        wordU64(s2 < 0 ? 255 : s2)
      )
    );
  },
  buyShip(bid, slotIdx, classId, x, y, dir) {
    return bytesToHex(
      concatBytes(
        selectorBytes('buyShip(bytes32,uint64,uint64,uint64,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx),
        wordU64(classId),
        wordU64(x),
        wordU64(y),
        wordU64(dir)
      )
    );
  },
  moveShip(bid, slotIdx, destX, destY, hullDir = 2) {
    return bytesToHex(
      concatBytes(
        selectorBytes('moveShip(bytes32,uint64,uint64,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx),
        wordU64(destX),
        wordU64(destY),
        wordU64(hullDir)
      )
    );
  },
  fireWeapon(bid, slotIdx, tx, ty) {
    return bytesToHex(
      concatBytes(
        selectorBytes('fireWeapon(bytes32,uint64,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx),
        wordU64(tx),
        wordU64(ty)
      )
    );
  },
  upgradeGun(bid, slotIdx, gunId) {
    return bytesToHex(
      concatBytes(
        selectorBytes('upgradeGun(bytes32,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx),
        wordU64(gunId)
      )
    );
  },
  upgradeArmor(bid, slotIdx) {
    return bytesToHex(
      concatBytes(
        selectorBytes('upgradeArmor(bytes32,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx)
      )
    );
  },
  repairShip(bid, slotIdx) {
    return bytesToHex(
      concatBytes(
        selectorBytes('repairShip(bytes32,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx)
      )
    );
  },
  returnShipToBase(bid, slotIdx) {
    return bytesToHex(
      concatBytes(
        selectorBytes('returnShipToBase(bytes32,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx)
      )
    );
  },
  returnFleetToBase(bid) {
    return bytesToHex(
      concatBytes(selectorBytes('returnFleetToBase(bytes32)'), wordBytes32(bid))
    );
  },
  sortieShipFromBase(bid, slotIdx) {
    return bytesToHex(
      concatBytes(
        selectorBytes('sortieShipFromBase(bytes32,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx)
      )
    );
  },
  sortieFleetFromBase(bid) {
    return bytesToHex(
      concatBytes(selectorBytes('sortieFleetFromBase(bytes32)'), wordBytes32(bid))
    );
  },
  cancelRecall(bid, slotIdx) {
    return bytesToHex(
      concatBytes(
        selectorBytes('cancelRecall(bytes32,uint64)'),
        wordBytes32(bid),
        wordU64(slotIdx)
      )
    );
  },
  resolvePendingShells(bid) {
    return bytesToHex(
      concatBytes(selectorBytes('resolvePendingShells(bytes32)'), wordBytes32(bid))
    );
  },
  getBattleState(bid) {
    return bytesToHex(concatBytes(selectorBytes('getBattleState(bytes32)'), wordBytes32(bid)));
  },
  getPlayersSlice(bid, offset, limit) {
    return bytesToHex(
      concatBytes(
        selectorBytes('getPlayersSlice(bytes32,uint64,uint64)'),
        wordBytes32(bid),
        wordU64(offset),
        wordU64(limit)
      )
    );
  },
};

function readU16BE(b, off) {
  return (b[off] << 8) | b[off + 1];
}

function readU32BE(b, off) {
  return (
    ((b[off] << 24) >>> 0) +
    ((b[off + 1] << 16) >>> 0) +
    ((b[off + 2] << 8) >>> 0) +
    b[off + 3]
  );
}

function readU64BE(b, off) {
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(b[off + i]);
  return Number(n);
}

export function decodeShipMovedLog(receipt) {
  if (!receipt || !Array.isArray(receipt.logs)) return null;
  const lg = receipt.logs.find(
    (entry) => (entry.topics?.[0] || '').toLowerCase() === TOPIC_SHIP_MOVED
  );
  if (!lg || !lg.data) return null;
  const d = hexToBytes(lg.data);
  if (d.length < 64) return null;
  return {
    slotIdx: readU64BE(d, 0),
    fromX: readU64BE(d, 8),
    fromY: readU64BE(d, 16),
    finalX: readU64BE(d, 24),
    finalY: readU64BE(d, 32),
    hullDir: readU64BE(d, 40),
    dir8: readU64BE(d, 48),
    actualSteps: readU64BE(d, 56),
  };
}

export function decodeVesselCollisionLogs(receipt) {
  if (!receipt || !Array.isArray(receipt.logs)) return [];
  return receipt.logs
    .filter((entry) => (entry.topics?.[0] || '').toLowerCase() === TOPIC_VESSEL_COLLISION)
    .map((lg) => {
      const d = hexToBytes(lg.data || '0x');
      if (d.length < 56) return null;
      return {
        moverGidx: readU64BE(d, 0),
        otherGidx: readU64BE(d, 8),
        x: readU64BE(d, 16),
        y: readU64BE(d, 24),
        overlapSquares: readU64BE(d, 32),
        moverSunk: readU64BE(d, 40) !== 0,
        otherSunk: readU64BE(d, 48) !== 0,
      };
    })
    .filter(Boolean);
}

export function decodeBattleStateHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 36) return null;

  const hdr = {
    active: b[0] !== 0,
    playerCount: b[1],
    redCount: b[2],
    blueCount: b[3],
    gridW: b[4],
    gridH: b[5],
    shellCount: readU16BE(b, 6),
    redKills: readU32BE(b, 8),
    blueKills: readU32BE(b, 12),
    lastResolvedBlock: readU64BE(b, 16),
    totalShotsFired: readU64BE(b, 24),
  };

  const aliveShipCount = readU16BE(b, 32);
  const activeShellCount = readU16BE(b, 34);
  let pos = 36;

  const ships = [];
  for (let i = 0; i < aliveShipCount && pos + 34 <= b.length; i++) {
    const gidx = readU16BE(b, pos);
    const sb = b.slice(pos + 2, pos + 34);
    const rawStatus = sb[0]; // 0 = Dead, 1 = At Sea, 2 = Docked in Naval Base, 3 = Recalling (Tow Countdown)
    ships.push({
      gidx,
      slotIdx: gidx % 3,
      rawStatus,
      exists: rawStatus !== 0,
      alive: rawStatus === 1 || rawStatus === 3,
      docked: rawStatus === 2,
      recalling: rawStatus === 3,
      recallBlocksLeft: rawStatus === 3 ? sb[28] : 0,
      ownerPid: sb[1],
      team: sb[2],
      classId: sb[3],
      gunId: sb[4],
      armorTier: sb[5], // Engine / Turbine tier (`0..=2`, `+0/+2/+4` sq Max Speed)
      dir: sb[6],
      x: sb[7],
      y: sb[8],
      heading8: sb[9],
      cellDmg: Array.from(sb.slice(10, 20)), // Binary: `0` = Intact, `100` = Destroyed (100% Hit)
      lastMoveBlock: readU32BE(sb, 20),
      lastFireBlock: readU32BE(sb, 24),
      flashX: sb[28],
      flashY: sb[29],
    });
    pos += 34;
  }

  const shells = [];
  for (let q = 0; q < activeShellCount && pos + 16 <= b.length; q++) {
    const sh = b.slice(pos, pos + 16);
    shells.push({
      active: sh[0] !== 0,
      attackerPid: sh[1],
      attackerTeam: sh[2],
      gunId: sh[3],
      tx: sh[4],
      ty: sh[5],
      impactBlock: readU64BE(sh, 8),
    });
    pos += 16;
  }

  return { ...hdr, ships, shells };
}

export function decodePlayersSliceHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 8) return [];
  const count = readU64BE(b, 0);
  const out = [];
  // Supports 68-byte PlayerRec (`best_score` in bytes 60..68 + `restarts` in byte 23), 60-byte, and legacy 40-byte records
  const stride =
    count > 0 && b.length >= 8 + count * 68
      ? 68
      : count > 0 && b.length >= 8 + count * 60
        ? 60
        : 40;
  let pos = 8;
  for (let i = 0; i < count && pos + stride <= b.length; i++) {
    const idRaw = stride >= 60 ? bytesToHex(b.slice(pos + 40, pos + 60)) : '';
    const identityAddr = idRaw && !/^0x0{40}$/i.test(idRaw) ? idRaw.toLowerCase() : '';
    const score = readU64BE(b, pos + 32);
    const bestScore = stride >= 68 ? Math.max(score, readU64BE(b, pos + 60)) : score;
    out.push({
      pid: i,
      addr: bytesToHex(b.slice(pos, pos + 20)),
      team: b[pos + 20],
      kills: readU16BE(b, pos + 21),
      restarts: b[pos + 23] || 0,
      credits: readU64BE(b, pos + 24),
      score,
      bestScore,
      identityAddr,
    });
    pos += stride;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Browser Session Identity & Live App State
// ---------------------------------------------------------------------------

const slxWallet = new SlxWalletManager();

const myWallet = {
  priv: slxWallet.keypair.privateKey,
  addr: slxWallet.keypair.address,
};

const app = {
  joinModalOpen: false,
  preferredTeam: TEAM_RED,
  starterLoadout: [2, 0, -1], // Cruiser (550) + Gunboat (200) -> 750 CR, 250 CR spare!
  identityNicknames: new Map(), // identityAddrLower -> on-chain nickname
  resolvingIdentities: new Set(),

  selectedSlot: 0,
  hoverTile: null, // { tx, ty }

  // Dual Cursor Modes:
  // - Default (`false`): Green Move Mode (green max-range circle + 1-click destination footprint)
  // - Hold `Shift` / `Space` (`true`): Red Targeting Mode (red gun-range circle + 1-click fireWeapon!)
  keyTargetingHeld: false,
  pinnedTargetingMode: false,
  moveDirOverride: null, // null = auto-orient along travel vector; 0 = Horizontal, 1 = Vertical (`R` key)

  // Pending On-Chain Commands (Strictly <= 1 pending tx per action type per round!)
  pendingActions: new Map(), // actionType -> { label, slotIdx, nonce, txHash, startedAt, ... }
  pendingMoves: new Map(),   // slotIdx -> { fromX, fromY, previewX, previewY, hullDir, distTiles, startedAt }
  pendingFires: [],          // { slotIdx, fromX, fromY, tx, ty, gunId, team, startedAt }
  selectedGunDraft: new Map(), // slotIdx -> gunId chosen in Round Action Deck

  // Camera pan & zoom
  cam: {
    cx: 24,
    cy: 15,
    tilePx: 18,
    autoFit: true,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    camStartX: 0,
    camStartY: 0,
  },

  // Visual FX & Authoritative Snap Interpolators
  arrivalSnaps: new Map(),   // gidx -> { fromX, fromY, toX, toY, hullDir, startedAt, durationMs }
  shellSnapImpacts: [],      // { fromX, fromY, toX, toY, aoeCells, sunk, tx, ty, team, gunId, rcptBlk, startedAt, durationMs }
  upgradeRings: [],          // { x, y, w, h, color, createdAt }
  tracers: [],
  explosions: [],
  teleports: [], // { fromX, fromY, toX, toY, w, h, createdAt }
  floatTexts: [],
  feedLogs: [],
  lastMyLossAlert: null, // { slot, killerLabel, cause, blk, until }
  lastWeaponByTx: new Map(), // txHash -> { gunName, tx, ty, attackerPid }
  lastCollisionByTx: new Map(), // txHash -> { x, y, overlapSquares }
  navalWatcher: null,

  // Live Subnet 1 RPC State
  rpcUrl: getDefaultNodeWsUrl(),
  contractAddr: '',
  battleId: '',
  rpcBlock: 0,
  rpcState: null,
  rpcPlayers: [],
  rpcBusy: false,

  // In-Game Social Network & VHF Comms State
  sideMode: 'fleet', // 'fleet' | 'social'
  socialTab: 'bridge', // 'bridge' | 'squadron' | 'captains' | 'dm'
  dmMode: 'dm', // 'dm' | 'wall'
  activeDmPeerId: '',
};

const fleetSocial = new FleetSocialClient({ rpcUrlFn: () => app.rpcUrl });

function isTargetingMode() {
  return app.keyTargetingHeld || app.pinnedTargetingMode;
}

// ---------------------------------------------------------------------------
// DOM References (Safe in Node import tests too)
// ---------------------------------------------------------------------------

const hasDom = typeof document !== 'undefined' && !!document.getElementById('oceanCanvas');

const el = hasDom
  ? {
      scoreRedBadge: document.getElementById('scoreRedBadge'),
      scoreBlueBadge: document.getElementById('scoreBlueBadge'),
      gridSizeBadge: document.getElementById('gridSizeBadge'),
      blockTickBadge: document.getElementById('blockTickBadge'),
      btnOpenJoinModal: document.getElementById('btnOpenJoinModal'),

      rpcDrawer: document.getElementById('rpcDrawer'),
      rpcUrlInput: document.getElementById('rpcUrlInput'),
      btnDeployWasm: document.getElementById('btnDeployWasm'),
      contractAddrInput: document.getElementById('contractAddrInput'),
      battleIdInput: document.getElementById('battleIdInput'),
      btnRpcCreateOrJoin: document.getElementById('btnRpcCreateOrJoin'),
      rpcStatusText: document.getElementById('rpcStatusText'),

      cursorModePill: document.getElementById('cursorModePill'),
      btnTargetModePill: document.getElementById('btnTargetModePill'),
      btnRotateHull: document.getElementById('btnRotateHull'),
      btnNavalHowToPlay: document.getElementById('btnNavalHowToPlay'),
      nvWelcomeMount: document.getElementById('nvWelcomeMount'),
      nvCoachMount: document.getElementById('nvCoachMount'),
      selectedShipHint: document.getElementById('selectedShipHint'),
      roundQueueBar: document.getElementById('roundQueueBar'),
      canvasWrap: document.getElementById('canvasWrap'),
      oceanCanvas: document.getElementById('oceanCanvas'),
      minimapCanvas: document.getElementById('minimapCanvas'),
      hoverTooltip: document.getElementById('hoverTooltip'),

      btnFitSquare: document.getElementById('btnFitSquare'),
      btnZoomIn: document.getElementById('btnZoomIn'),
      btnZoomOut: document.getElementById('btnZoomOut'),
      btnCenterShip: document.getElementById('btnCenterShip'),

      myTeamBadge: document.getElementById('myTeamBadge'),
      myPidLabel: document.getElementById('myPidLabel'),
      myCreditsText: document.getElementById('myCreditsText'),
      myBestScoreText: document.getElementById('myBestScoreText'),
      myScoreText: document.getElementById('myScoreText'),
      myKillsText: document.getElementById('myKillsText'),
      gameOverBanner: document.getElementById('gameOverBanner'),
      fleetSocialAlertBanner: document.getElementById('fleetSocialAlertBanner'),
      shipSlotsContainer: document.getElementById('shipSlotsContainer'),
      roundActionDeck: document.getElementById('roundActionDeck'),
      shotsCountBadge: document.getElementById('shotsCountBadge'),
      combatFeedBox: document.getElementById('combatFeedBox'),

      tabFleetCmd: document.getElementById('tabFleetCmd'),
      tabFleetScores: document.getElementById('tabFleetScores'),
      tabFleetSocial: document.getElementById('tabFleetSocial'),
      socialNotifBadge: document.getElementById('socialNotifBadge'),
      fleetCommandPane: document.getElementById('fleetCommandPane'),
      fleetLeaderboardPane: document.getElementById('fleetLeaderboardPane'),
      leaderboardBodyBox: document.getElementById('leaderboardBodyBox'),
      fleetSocialPane: document.getElementById('fleetSocialPane'),
      socialIncomingBox: document.getElementById('socialIncomingBox'),
      socialPeerSelectRow: document.getElementById('socialPeerSelectRow'),
      socialBodyBox: document.getElementById('socialBodyBox'),
      socialComposerForm: document.getElementById('socialComposerForm'),
      socialMsgInput: document.getElementById('socialMsgInput'),
      socialSendBtn: document.getElementById('socialSendBtn'),

      joinModal: document.getElementById('joinModal'),
      btnCloseJoinModal: document.getElementById('btnCloseJoinModal'),
      teamBalanceHint: document.getElementById('teamBalanceHint'),
      btnPickRed: document.getElementById('btnPickRed'),
      btnPickBlue: document.getElementById('btnPickBlue'),
      redCountSub: document.getElementById('redCountSub'),
      blueCountSub: document.getElementById('blueCountSub'),
      loadoutBudgetText: document.getElementById('loadoutBudgetText'),
      loadoutSlotsGrid: document.getElementById('loadoutSlotsGrid'),
      btnLaunchBattle: document.getElementById('btnLaunchBattle'),
    }
  : {};

const ctx = hasDom ? el.oceanCanvas.getContext('2d') : null;
const miniCtx = hasDom ? el.minimapCanvas.getContext('2d') : null;

// ---------------------------------------------------------------------------
// Visual FX & Combat Log Helpers
// ---------------------------------------------------------------------------

function pushFeed(html) {
  app.feedLogs.unshift(html);
  if (app.feedLogs.length > 35) app.feedLogs.pop();
  if (hasDom && el.combatFeedBox) {
    el.combatFeedBox.innerHTML = app.feedLogs.slice(0, 18).join('');
  }
}

function addFloatText(x, y, text, color = '#fde68a') {
  app.floatTexts.push({ x, y, text, color, createdAt: performance.now() });
  if (app.floatTexts.length > 35) app.floatTexts.shift();
}

function addTracer(x1, y1, x2, y2, team) {
  app.tracers.push({ x1, y1, x2, y2, team, createdAt: performance.now() });
  if (app.tracers.length > 40) app.tracers.shift();
}

function addExplosion(cells) {
  app.explosions.push({ cells, createdAt: performance.now() });
  if (app.explosions.length > 30) app.explosions.shift();
}

function addTeleportFx(fromX, fromY, toX, toY, w, h) {
  app.teleports.push({ fromX, fromY, toX, toY, w, h, createdAt: performance.now() });
  if (app.teleports.length > 25) app.teleports.shift();
}

function addUpgradeRing(x, y, w, h, color = '#fbbf24') {
  app.upgradeRings.push({ x, y, w, h, color, createdAt: performance.now() });
  if (app.upgradeRings.length > 20) app.upgradeRings.shift();
}

function computeAsymptoticProgress(startedAt, now, tauMs = 2400, cap = 0.88) {
  const elapsed = Math.max(0, now - (startedAt || now));
  return Math.min(cap, 1 - Math.exp(-elapsed / tauMs));
}

let navalGuide = null;

function updateNavalCoach(viewOverride = null) {
  if (!navalGuide) return;
  const v = viewOverride || getActiveView();
  if (!v) {
    navalGuide.updateCoach({
      pill: '🧭 CONNECTING',
      tone: 'info',
      html: 'Syncing live ocean grid &amp; 100-player battle state from Subnet 1…',
    });
    return;
  }
  if (!v.me.joined) {
    navalGuide.updateCoach({
      pill: 'STEP 1 OF 3 • DEPLOY',
      tone: 'urgent',
      html: '<strong>You are spectating!</strong> Spend your free <code>1,000 CR</code> to pick Red or Blue and commission up to 3 starter ships in 1 block.',
      actionLabel: '⚓ Deploy My Squadron',
      onAction: () => {
        app.joinModalOpen = true;
        el.joinModal.classList.add('open');
        renderJoinModal();
      },
    });
    return;
  }
  if (v.me.isGameOver) {
    navalGuide.updateCoach({
      pill: '💀 SQUADRON LOST',
      tone: 'urgent',
      html: `All 3 ships sunk &amp; warchest under <code>200 CR</code>. Your Peak High Score (<code>${v.me.bestScore.toLocaleString()} pts</code>) is saved — re-deploy with a fresh <code>1,000 CR</code> fleet!`,
      actionLabel: '🔄 Start Anew (1,000 CR)',
      onAction: () => {
        app.joinModalOpen = true;
        el.joinModal.classList.add('open');
        renderJoinModal();
      },
    });
    return;
  }
  const dockedShips = v.myShips.filter((s) => s && s.docked);
  const atSeaShips = v.myShips.filter((s) => s && s.alive);
  if (dockedShips.length > 0 && atSeaShips.length === 0) {
    navalGuide.updateCoach({
      pill: '⚓ SAFE IN HARBOR',
      tone: 'action',
      html: `<strong>All ${dockedShips.length} ship(s) are safely drydocked in your Naval Base!</strong> They cannot be attacked while you take a break. Ready to return to battle?`,
      actionLabel: `🚀 Sortie All (${dockedShips.length})`,
      onAction: () => playerSortieFleetFromBase(),
    });
    return;
  }

  const sel = getEffectiveShipForRound(v.myShips[app.selectedSlot]);
  if (sel && sel.docked) {
    const hullMeta = HULL_CLASSES[sel.classId] || HULL_CLASSES[0];
    navalGuide.updateCoach({
      pill: '⚓ SHIP DOCKED',
      tone: 'action',
      html: `<strong>${hullMeta.short} [${app.selectedSlot + 1}] is drydocked in Naval Base</strong> (100% immune; repairs &amp; upgrades remain open). Launch it back onto the coast anytime!`,
      actionLabel: `🚀 Sortie Ship [${app.selectedSlot + 1}]`,
      onAction: () => playerSortieShipFromBase(app.selectedSlot),
    });
    return;
  }
  if (sel && sel.recalling) {
    const hullMeta = HULL_CLASSES[sel.classId] || HULL_CLASSES[0];
    navalGuide.updateCoach({
      pill: `📡 TOWING (${sel.recallBlocksLeft} BLK)`,
      tone: 'urgent',
      html: `<strong>${hullMeta.short} [${app.selectedSlot + 1}] is towing to Naval Base (${sel.recallBlocksLeft} block${sel.recallBlocksLeft === 1 ? '' : 's'} left)!</strong> Avoid enemy hits until drydock completes.`,
      actionLabel: '✕ Cancel Tow',
      onAction: () => playerCancelRecall(app.selectedSlot),
    });
    return;
  }
  if (!sel || !sel.alive) {
    const aliveIdx = v.myShips.findIndex((s) => s && s.alive);
    if (aliveIdx >= 0) {
      navalGuide.updateCoach({
        pill: '⚓ SELECT ACTIVE SHIP',
        tone: 'urgent',
        html: `Slot <code>[${app.selectedSlot + 1}]</code> is empty/sunk! Switch to surviving Ship <code>[${aliveIdx + 1}]</code> or commission a new hull in your Fleet sidebar.`,
        actionLabel: `Switch to Ship [${aliveIdx + 1}]`,
        onAction: () => {
          app.selectedSlot = aliveIdx;
          app.moveDirOverride = null;
          centerCameraOnSlot(aliveIdx);
          renderSidebarAndHud();
        },
      });
    } else {
      navalGuide.updateCoach({
        pill: '⚓ COMMISSION NEW HULL',
        tone: 'urgent',
        html: `All berths empty, but you have <code>${v.me.credits.toLocaleString()} CR</code>! Commission a replacement vessel in the right-hand <strong>⚓ Fleet</strong> deck.`,
      });
    }
    return;
  }

  const hullMeta = HULL_CLASSES[sel.classId] || HULL_CLASSES[0];
  const gunMeta = WEAPONS[sel.gunId] || WEAPONS[0];
  const targeting = isTargetingMode();
  if (targeting) {
    navalGuide.updateCoach({
      pill: '🎯 TARGETING ACTIVE',
      tone: 'target',
      html: `<strong>Aiming ${hullMeta.short} [${app.selectedSlot + 1}] (${gunMeta.name}, Range ${gunMeta.range} sq):</strong> Click any enemy ship inside the <strong>Red Ring</strong> to destroy hull squares (<code>+120 CR</code>/hit)!`,
      actionLabel: '🟢 Back to Move Mode',
      onAction: () => {
        app.pinnedTargetingMode = false;
        app.keyTargetingHeld = false;
        syncModePillUi();
      },
    });
  } else {
    navalGuide.updateCoach({
      pill: '🟢 SAIL OR AIM',
      tone: 'action',
      html: `<strong>Commanding ${hullMeta.short} [${app.selectedSlot + 1}]:</strong> Click water inside the <strong>Green Circle</strong> (${effectiveMaxSpeed(sel)} sq) to sail — or switch to <strong>🎯 Fire Mode</strong> to shoot enemies!`,
      actionLabel: '🎯 Switch to Fire Mode',
      onAction: () => {
        app.pinnedTargetingMode = true;
        syncModePillUi();
      },
    });
  }
}

function syncModePillUi() {
  if (!hasDom || !el.cursorModePill) return;
  const targeting = isTargetingMode();
  el.cursorModePill.className = `nv-mode-pill ${targeting ? '' : 'move'} mono`;
  el.cursorModePill.style.opacity = targeting ? '0.68' : '1';
  el.cursorModePill.textContent = '🟢 Move Mode';
  if (el.btnTargetModePill) {
    el.btnTargetModePill.style.background = targeting
      ? 'rgba(244, 63, 94, 0.28)'
      : 'rgba(15, 23, 42, 0.75)';
    el.btnTargetModePill.style.borderColor = targeting
      ? '#fb7185'
      : 'rgba(251, 113, 133, 0.45)';
    el.btnTargetModePill.style.color = targeting ? '#ffe4e6' : '#fda4af';
    el.btnTargetModePill.textContent = targeting ? '🎯 Fire Mode (ACTIVE)' : '🎯 Fire Mode';
  }
  el.oceanCanvas.style.cursor = targeting ? 'crosshair' : 'pointer';
  renderRoundActionDeck();
  updateNavalCoach();
}

// ---------------------------------------------------------------------------
// Live View Model
// ---------------------------------------------------------------------------

function getActiveView() {
  if (!app.rpcState) return null;
  const s = app.rpcState;
  const meRec = app.rpcPlayers.find(
    (p) => p.addr.toLowerCase() === myWallet.addr.toLowerCase()
  ) || {
    pid: -1,
    joined: false,
    team: app.preferredTeam,
    credits: STARTING_CREDITS,
    score: 0,
    bestScore: 0,
    restarts: 0,
    kills: 0,
  };
  const joined = meRec.pid >= 0;

  const myShips = [0, 1, 2].map((slot) => {
    if (!joined) {
      return {
        slotIdx: slot,
        exists: false,
        alive: false,
        docked: false,
        recalling: false,
        recallBlocksLeft: 0,
        classId: 0,
        gunId: 0,
        armorTier: 0,
        cellDmg: new Array(10).fill(0),
      };
    }
    return (
      s.ships.find((sh) => sh.ownerPid === meRec.pid && sh.slotIdx === slot) || {
        slotIdx: slot,
        exists: false,
        alive: false,
        docked: false,
        recalling: false,
        recallBlocksLeft: 0,
        classId: 0,
        gunId: 0,
        armorTier: 0,
        cellDmg: new Array(10).fill(0),
      }
    );
  });

  const allDead = joined && myShips.every((sh) => !sh || !sh.exists);
  const isGameOver = allDead && meRec.credits < HULL_CLASSES[0].cost;

  return {
    blockNumber: app.rpcBlock,
    gridW: s.gridW,
    gridH: s.gridH,
    playerCount: s.playerCount,
    redCount: s.redCount,
    blueCount: s.blueCount,
    redKills: s.redKills,
    blueKills: s.blueKills,
    totalShotsFired: s.totalShotsFired,
    ships: s.ships,
    shells: s.shells,
    me: {
      ...meRec,
      bestScore: meRec.bestScore ?? meRec.score ?? 0,
      restarts: meRec.restarts ?? 0,
      joined,
      allDead,
      isGameOver,
    },
    myShips,
  };
}

// ---------------------------------------------------------------------------
// Multi-Tx Per-Round Queue (1 Pending Tx / Action Type) + Local Nonce Manager
// ---------------------------------------------------------------------------

const ROUND_ACTION_META = {
  move:          { icon: '🧭', short: 'Move',     title: 'Movement' },
  fire:          { icon: '🎯', short: 'Fire',     title: 'Weapon Fire' },
  heal:          { icon: '🔧', short: 'Heal',     title: 'Hull Repair' },
  purchase:      { icon: '⚓', short: 'Purchase', title: 'Ship Purchase' },
  upgradeGun:    { icon: '🔫', short: 'Gun',      title: 'Gun Upgrade' },
  upgradeEngine: { icon: '⚡', short: 'Engine',   title: 'Engine Upgrade' },
  baseOps:       { icon: '⚓', short: 'Harbor',   title: 'Naval Base Operations' },
  comms:         { icon: '📡', short: 'Comms',    title: 'VHF / Social Comms' },
};

/**
 * Projects any in-flight same-round actions (`move`, `upgradeGun`, `upgradeEngine`) onto `ship`
 * so a player can e.g. Move into range AND Fire (or Upgrade Gun AND Fire) in the SAME round!
 */
function getEffectiveShipForRound(ship) {
  if (!ship || !ship.exists) return ship;
  let eff = { ...ship };
  const pendEng = app.pendingActions.get('upgradeEngine');
  if (pendEng && pendEng.slotIdx === ship.slotIdx) {
    eff.armorTier = Math.min(2, (eff.armorTier || 0) + 1);
  }
  const pendGun = app.pendingActions.get('upgradeGun');
  if (pendGun && pendGun.slotIdx === ship.slotIdx && pendGun.gunId !== undefined) {
    eff.gunId = pendGun.gunId;
  }
  const pendMv = app.pendingMoves.get(ship.slotIdx);
  if (pendMv) {
    eff.x = pendMv.previewX;
    eff.y = pendMv.previewY;
    eff.dir = pendMv.hullDir;
  }
  return eff;
}

function renderRoundQueueBar() {
  if (!hasDom) return;
  if (el.roundQueueBar) {
    const chipsHtml = Object.entries(ROUND_ACTION_META)
      .map(([key, meta]) => {
        const pend = app.pendingActions.get(key);
        if (pend) {
          const nonceTag = pend.nonce !== undefined ? ` #${pend.nonce}` : '';
          return `<span class="nv-q-chip pending" data-q-type="${key}" title="Pending on Subnet 1: ${pend.label}">
            ${meta.icon} ${meta.short}:${nonceTag} ⏳
          </span>`;
        }
        return `<span class="nv-q-chip ready" data-q-type="${key}">
          ${meta.icon} ${meta.short}: Ready
        </span>`;
      })
      .join('');
    el.roundQueueBar.innerHTML = `<span style="color:#94a3b8;font-weight:700;">ROUND TX QUEUE (1/type):</span>${chipsHtml}`;
  }
  renderRoundActionDeck();
}

async function rpcCall(method, params = []) {
  return slxNodeRpc(app.rpcUrl, method, params);
}

/**
 * Signs an EIP-155 Lexicon transaction while choosing a tiny `+0..191` gasLimit salt so that
 * multiple in-flight transactions from the same player satisfy `txHash(N) < txHash(N+1) < ...`.
 * Because Subnet 1 orders intra-block same-sender groups by `tx.hash`, this guarantees sequential
 * actions (e.g. Move -> Fire, Upgrade Gun -> Fire) execute in exact submission & nonce order!
 */
export function signHashOrderedLexiconTx({
  privateKey,
  nonce,
  to,
  data,
  gasLimit = 5_000_000n,
  gasPrice = 50_000_000_000n,
  chainId = 1337n,
  extraTargets = [],
  lowerBoundHashHex = null,
}) {
  const lb = lowerBoundHashHex ? lowerBoundHashHex.toLowerCase() : null;
  let best = null;
  let validSamples = 0;

  for (let salt = 0n; salt < 192n; salt++) {
    const raw = signLexiconTx({
      privateKey,
      nonce,
      to,
      data,
      gasLimit: gasLimit + salt,
      gasPrice,
      chainId,
      extraTargets,
    });
    const txHash = keccak256Hex(hexToBytes(raw)).toLowerCase();
    if (!lb || txHash > lb) {
      if (!best || txHash < best.txHash) {
        best = { raw, txHash };
      }
      validSamples += 1;
      if (validSamples >= 12) break;
    }
  }

  if (best) return best;
  const fallbackRaw = signLexiconTx({
    privateKey,
    nonce,
    to,
    data,
    gasLimit,
    gasPrice,
    chainId,
    extraTargets,
  });
  return { raw: fallbackRaw, txHash: keccak256Hex(hexToBytes(fallbackRaw)).toLowerCase() };
}

// Per-wallet FIFO async mutex + active in-flight nonce registry (`nonce -> { txHash, actionType, sentAt }`)
const senderLocks = new Map();
const inFlightNoncesByAddr = new Map();

function getInFlightMap(addr) {
  const k = addr.toLowerCase();
  if (!inFlightNoncesByAddr.has(k)) {
    inFlightNoncesByAddr.set(k, new Map());
  }
  return inFlightNoncesByAddr.get(k);
}

function withSenderNonceLock(addr, fn) {
  const k = addr.toLowerCase();
  const prev = senderLocks.get(k) || Promise.resolve();
  const next = prev.then(fn, fn);
  senderLocks.set(
    k,
    next.catch(() => {})
  );
  return next;
}

function releaseInFlightNonce(addr, nonce) {
  if (!addr || nonce === undefined || nonce === null) return;
  getInFlightMap(addr).delete(BigInt(nonce));
}

function resetLocalNonce(addr) {
  if (!addr) return;
  inFlightNoncesByAddr.delete(addr.toLowerCase());
}

/**
 * Allocates the next contiguous nonce inside the per-wallet FIFO lock, signs with hash-order
 * preservation (`txHash(N) > txHash(N-1)`), and broadcasts over WebSocket before releasing the lock.
 */
async function sendRpcTxWithNonceQueue(
  dataHex,
  label,
  gasLimit = 5_500_000n,
  toAddr = app.contractAddr,
  extraTargets = []
) {
  const senderAddr = myWallet.addr;
  const senderPriv = myWallet.priv;

  return withSenderNonceLock(senderAddr, async () => {
    const chainNonce = BigInt(await rpcCall('eth_getTransactionCount', [senderAddr, 'latest']));
    const inFlight = getInFlightMap(senderAddr);
    const nowMs = Date.now();

    for (const [n, entry] of inFlight.entries()) {
      if (n < chainNonce || nowMs - entry.sentAt > 90_000) {
        inFlight.delete(n);
      }
    }

    let nonce = chainNonce;
    let lowerBoundHashHex = null;
    for (const [n, entry] of inFlight.entries()) {
      if (n >= nonce) nonce = n + 1n;
      if (!lowerBoundHashHex || entry.txHash > lowerBoundHashHex) {
        lowerBoundHashHex = entry.txHash;
      }
    }

    const targets = Array.from(new Set([...(toAddr ? [toAddr] : []), ...extraTargets].filter(Boolean)));
    const { raw } = signHashOrderedLexiconTx({
      privateKey: senderPriv,
      nonce,
      to: toAddr,
      data: dataHex,
      gasLimit,
      gasPrice: 50_000_000_000n,
      chainId: 1337n,
      extraTargets: targets,
      lowerBoundHashHex,
    });

    const txHash = (await rpcCall('eth_sendRawTransaction', [raw])).toLowerCase();
    inFlight.set(nonce, { txHash, label, sentAt: Date.now() });

    slxWallet.recordExternalRpcTx({
      txHash,
      rawTx: raw,
      from: senderAddr,
      to: toAddr || '(instantiate)',
      contractLabel: 'Battleship',
      fnLabel: label,
      dataHex,
      blockNumber: app.rpcBlock || 0,
      nonce: Number(nonce),
    });

    return { txHash, nonce, senderAddr };
  });
}

async function sendRpcTx(dataHex, label, gasLimit = 5_500_000n) {
  try {
    const { txHash, nonce } = await sendRpcTxWithNonceQueue(dataHex, label, gasLimit);
    if (hasDom) {
      el.rpcStatusText.textContent = `⏳ Broadcast ${label} [Nonce #${nonce}] (${txHash.slice(0, 10)}…)`;
    }
    return { txHash, nonce };
  } catch (e) {
    if (hasDom) {
      el.rpcStatusText.textContent = `⚠ ${label} failed: ${e.message}`;
    }
    return null;
  }
}

/**
 * Enforces strictly <= 1 pending transaction per `actionType` (`move`, `fire`, `heal`, `purchase`,
 * `upgradeGun`, `upgradeEngine`), while allowing different action types to run concurrently in the
 * same round with collision-free local nonces!
 */
async function submitTypedRoundAction({
  actionType,
  slotIdx,
  label,
  dataHex,
  gasLimit = 5_000_000n,
  extraMeta = {},
}) {
  const meta = ROUND_ACTION_META[actionType] || { icon: '⏳', title: actionType };
  if (app.pendingActions.has(actionType)) {
    if (hasDom) {
      el.rpcStatusText.textContent = `⏳ Only 1 ${meta.title} txn allowed per round — other action types remain ready!`;
    }
    return null;
  }

  // Reserve the actionType slot synchronously before any `await` so rapid clicks cannot double-submit!
  const record = { actionType, slotIdx, label, startedAt: performance.now(), ...extraMeta };
  app.pendingActions.set(actionType, record);
  renderRoundQueueBar();
  renderSidebarAndHud();

  let sent = null;
  try {
    sent = await sendRpcTxWithNonceQueue(dataHex, label, gasLimit);
    record.txHash = sent.txHash;
    record.nonce = Number(sent.nonce);
    renderRoundQueueBar();
    if (hasDom) {
      const activeCount = app.pendingActions.size;
      el.rpcStatusText.textContent = `⏳ Queued ${label} [Nonce #${sent.nonce}] (${activeCount} action${activeCount === 1 ? '' : 's'} in flight this round)…`;
    }
  } catch (e) {
    app.pendingActions.delete(actionType);
    renderRoundQueueBar();
    renderSidebarAndHud();
    if (hasDom) {
      el.rpcStatusText.textContent = `⚠ ${label} rejected: ${e.message}`;
    }
    return null;
  }

  const rcpt = await waitForReceipt(sent.txHash);
  if (rcpt) {
    app.navalWatcher?.markReceiptSeen?.(rcpt);
  }
  releaseInFlightNonce(sent.senderAddr, sent.nonce);
  app.pendingActions.delete(actionType);
  renderRoundQueueBar();
  renderSidebarAndHud();

  return { rcpt, txHash: sent.txHash, nonce: Number(sent.nonce) };
}

async function waitForReceipt(txHash) {
  return slxWaitForReceipt((m, p) => rpcCall(m, p), txHash, {
    timeoutMs: 56_000,
    fallbackPollMs: 800,
  });
}

// ---------------------------------------------------------------------------
// Direct 1-Click 2D Range Movement & Event-Log Teleport!
// ---------------------------------------------------------------------------

async function playerMoveToTile(slotIdx, cursorTx, cursorTy) {
  const v = getActiveView();
  if (!v || !app.contractAddr || !app.battleId) return;
  if (!v.me.joined) {
    app.joinModalOpen = true;
    el.joinModal.classList.add('open');
    renderJoinModal();
    return;
  }
  if (app.pendingActions.has('move')) {
    el.rpcStatusText.textContent =
      '⏳ 1 Movement txn is already pending this round — Fire, Heal, Purchase & Upgrades remain open!';
    return;
  }
  const rawSel = v.myShips[slotIdx];
  if (!rawSel || !rawSel.alive) return;
  const sel = getEffectiveShipForRound(rawSel);

  const prev = computeDirectMovePreview(sel, cursorTx, cursorTy, app.moveDirOverride, v);
  if (prev.isNoop) return;
  if (!prev.inRange) {
    el.rpcStatusText.textContent = `⚠ Destination (${prev.destX}, ${prev.destY}) is outside Ship [${slotIdx + 1}]'s ${prev.maxRange}-square range circle!`;
    return;
  }

  const moveStartedAt = performance.now();
  const pendingMoveObj = {
    fromX: rawSel.x,
    fromY: rawSel.y,
    fromDir: rawSel.dir,
    previewX: prev.destX,
    previewY: prev.destY,
    hullDir: prev.hullDir,
    distTiles: prev.distTiles,
    startedAt: moveStartedAt,
  };
  app.pendingMoves.set(slotIdx, pendingMoveObj);
  pushFeed(
    `<div style="color:#a7f3d0;">🧭 Sailing: Ship [${slotIdx + 1}] &rarr; <strong>(${prev.destX}, ${prev.destY})</strong> (${prev.distTiles} sq)…</div>`
  );

  const res = await submitTypedRoundAction({
    actionType: 'move',
    slotIdx,
    label: `moveShip(${prev.destX},${prev.destY})`,
    dataHex: NavalAbi.moveShip(app.battleId, slotIdx, prev.destX, prev.destY, prev.hullDir),
    gasLimit: 4_500_000n,
  });
  const nowAtRcpt = performance.now();
  const cruiseT = computeAsymptoticProgress(moveStartedAt, nowAtRcpt, 2500, 0.88);
  const curVisX = pendingMoveObj.fromX + (pendingMoveObj.previewX - pendingMoveObj.fromX) * cruiseT;
  const curVisY = pendingMoveObj.fromY + (pendingMoveObj.previewY - pendingMoveObj.fromY) * cruiseT;
  app.pendingMoves.delete(slotIdx);

  if (!res || !res.rcpt || res.rcpt.status !== '0x1') {
    if (res) {
      addFloatText(rawSel.x, rawSel.y - 0.5, '⚠ MOVE REVERTED', '#fca5a5');
      el.rpcStatusText.textContent = `⚠ moveShip reverted or timed out (${res.txHash.slice(0, 10)}…)`;
      await pollLiveRpcState();
    }
    return;
  }

  const rcptBlk = Number(BigInt(res.rcpt.blockNumber || '0x0'));
  if (rcptBlk > app.rpcBlock) app.rpcBlock = rcptBlk;

  // Decode HFS-computed final coordinates directly from the emitted `ShipMoved` event log
  // and smoothly fast-forward the hull from its local cruise position into `(ev.finalX, ev.finalY)`!
  const ev = decodeShipMovedLog(res.rcpt);
  if (ev && app.rpcState) {
    const liveShip = app.rpcState.ships.find(
      (sh) => sh.ownerPid === v.me.pid && sh.slotIdx === ev.slotIdx
    );
    if (liveShip) {
      const [w, h] = shipDims(liveShip.classId, ev.hullDir);
      app.arrivalSnaps.set(liveShip.gidx, {
        fromX: curVisX,
        fromY: curVisY,
        toX: ev.finalX,
        toY: ev.finalY,
        hullDir: ev.hullDir,
        startedAt: performance.now(),
        durationMs: 210,
      });
      addTeleportFx(curVisX, curVisY, ev.finalX, ev.finalY, w, h);
      liveShip.x = ev.finalX;
      liveShip.y = ev.finalY;
      liveShip.dir = ev.hullDir;
      liveShip.heading8 = ev.dir8;
      liveShip.lastMoveBlock = rcptBlk;
    }
    addFloatText(ev.finalX, ev.finalY - 0.5, `✓ ARRIVED (${ev.finalX}, ${ev.finalY})`, '#34d399');
    pushFeed(
      `<div style="color:#6ee7b7;">⚡ <strong>ShipMoved Log (Blk #${rcptBlk})</strong>: Ship [${ev.slotIdx + 1}] confirmed at <code>(${ev.finalX},${ev.finalY})</code> [${ev.actualSteps} sq]!</div>`
    );
    el.rpcStatusText.textContent = `✓ ShipMoved Log (Blk #${rcptBlk}): Ship [${ev.slotIdx + 1}] arrived at (${ev.finalX}, ${ev.finalY})!`;

    const collisions = decodeVesselCollisionLogs(res.rcpt);
    for (const col of collisions) {
      addExplosion([[col.x, col.y]]);
      const ramMsg = col.otherSunk
        ? `💥 RAMMED & SUNK VESSEL (${col.overlapSquares} SQ)!`
        : `💥 HULL COLLISION (${col.overlapSquares} SQ @ 100%)!`;
      addFloatText(col.x, col.y - 1.0, ramMsg, '#fbbf24');
      pushFeed(
        `<div style="color:#fcd34d;">💥 <strong>VesselCollision Log (Blk #${rcptBlk})</strong>: Ship #${col.moverGidx} &amp; Ship #${col.otherGidx} collided on <strong>${col.overlapSquares}</strong> square(s) at <code>(${col.x},${col.y})</code>${col.otherSunk ? ' — target vessel SUNK!' : ''}${col.moverSunk ? ' — your vessel SUNK!' : ''}!</div>`
      );
    }
    renderSidebarAndHud();
  }

  await pollLiveRpcState(rcptBlk);
}

async function playerFireSelected(tx, ty) {
  const v = getActiveView();
  if (!v || !app.contractAddr || !app.battleId) return;
  if (!v.me.joined) {
    app.joinModalOpen = true;
    el.joinModal.classList.add('open');
    renderJoinModal();
    return;
  }
  if (app.pendingActions.has('fire')) {
    el.rpcStatusText.textContent =
      '⏳ 1 Weapon Fire txn is already pending this round — Move, Heal, Purchase & Upgrades remain open!';
    return;
  }
  const rawSel = v.myShips[app.selectedSlot];
  if (!rawSel || !rawSel.alive) {
    if (rawSel?.docked) {
      el.rpcStatusText.textContent =
        '⚓ Ship is safely drydocked in Naval Base — click 🚀 Sortie first to return to combat!';
    }
    return;
  }
  if (rawSel.recalling) {
    el.rpcStatusText.textContent =
      '📡 Ship is towing to Naval Base (weapons offline) — click ✕ Cancel Tow first if you want to fire!';
    return;
  }
  const sel = getEffectiveShipForRound(rawSel);

  const { cx, cy } = shipCenter(sel);
  const gun = WEAPONS[sel.gunId] || WEAPONS[0];
  if ((tx - cx) ** 2 + (ty - cy) ** 2 > gun.range ** 2) {
    el.rpcStatusText.textContent = `⚠ Target (${tx}, ${ty}) is outside ${gun.name} range (${gun.range} sq)!`;
    addFloatText(tx, ty, `OUT OF RANGE (${gun.range} sq)`, '#fca5a5');
    return;
  }

  const slotIdx = app.selectedSlot;
  const shotStartedAt = performance.now();
  const pendingShot = {
    slotIdx,
    fromX: cx + 0.5,
    fromY: cy + 0.5,
    tx,
    ty,
    gunId: sel.gunId,
    team: v.me.team,
    startedAt: shotStartedAt,
  };
  app.pendingFires.push(pendingShot);
  pushFeed(
    `<div style="color:#fda4af;">🎯 Shell in Flight: Ship [${slotIdx + 1}] <strong>${gun.name}</strong> &rarr; <code>(${tx}, ${ty})</code>…</div>`
  );

  const res = await submitTypedRoundAction({
    actionType: 'fire',
    slotIdx,
    label: `fireWeapon(${tx},${ty})`,
    dataHex: NavalAbi.fireWeapon(app.battleId, slotIdx, tx, ty),
    gasLimit: 5_000_000n,
  });
  const nowAtImpact = performance.now();
  const flightT = computeAsymptoticProgress(shotStartedAt, nowAtImpact, 2200, 0.88);
  const curPx = pendingShot.fromX + (tx + 0.5 - pendingShot.fromX) * flightT;
  const curPy = pendingShot.fromY + (ty + 0.5 - pendingShot.fromY) * flightT;
  app.pendingFires = app.pendingFires.filter((p) => p !== pendingShot);

  if (!res || !res.rcpt || res.rcpt.status !== '0x1') {
    if (res) {
      addFloatText(tx, ty, '⚠ SALVO CANCELLED', '#fca5a5');
      el.rpcStatusText.textContent = `⚠ fireWeapon reverted (1 shot/ship/block or out of range)`;
      await pollLiveRpcState();
    }
    return;
  }

  const rcptBlk = Number(BigInt(res.rcpt.blockNumber || '0x0'));
  const latestView = getActiveView() || v;
  const aoeCells = getImpactCells(sel.gunId, tx, ty, latestView.gridW, latestView.gridH);
  const sunkLog = (res.rcpt.logs || []).find(
    (lg) => (lg.topics?.[0] || '').toLowerCase() === TOPIC_SHIP_SUNK
  );

  // Fast-forward projectile's final sprint (`160ms`) into authoritative `(tx, ty)` and detonate on arrival!
  app.shellSnapImpacts.push({
    fromX: curPx,
    fromY: curPy,
    toX: tx + 0.5,
    toY: ty + 0.5,
    aoeCells,
    sunk: Boolean(sunkLog),
    tx,
    ty,
    team: latestView.me.team,
    gunId: sel.gunId,
    startedAt: nowAtImpact,
    durationMs: 160,
  });

  if (sunkLog) {
    pushFeed(
      `<div style="color:#fde047;">💥 <strong>ShipSunk Log (Blk #${rcptBlk})</strong>: Enemy warship destroyed at <code>(${tx}, ${ty})</code>!</div>`
    );
  }

  el.rpcStatusText.textContent = `✓ Salvo impacted (${tx}, ${ty}) in block #${rcptBlk}!`;
  await pollLiveRpcState(rcptBlk);
}

function findFreeTeamSpawn(view, team, classId, slotIdx) {
  const [w, h] = shipDims(classId, 0);
  const maxX = Math.max(1, view.gridW - w - 1);
  const maxY = Math.max(1, view.gridH - h - 1);
  const enemies = (view.ships || []).filter((s) => s && s.alive && s.team !== team);
  const anchor = view.myShips.find((s) => s && s.alive);
  const homeX = team === TEAM_RED ? 2 : Math.max(1, maxX - 2);
  const baseX = anchor
    ? Math.max(1, Math.min(maxX, anchor.x + 3))
    : homeX;
  const baseY = anchor
    ? Math.max(1, Math.min(maxY, anchor.y + (slotIdx - 1) * 3))
    : Math.max(1, Math.min(maxY, Math.floor(view.gridH / 2) + (slotIdx - 1) * 5));

  let bestSpot = null;
  let bestMinEnemyDistSq = -1;

  for (let dy = 0; dy < maxY; dy++) {
    const y = 1 + ((baseY + dy) % maxY);
    for (let dx = 0; dx < maxX; dx += 2) {
      const x = 1 + ((baseX + dx) % maxX);
      if (shipInEnemyBase(classId, 0, x, y, team, view.gridW, view.gridH)) continue;
      if (!isPlacementFreeInView(view, -1, { classId, x, y, dir: 0 })) continue;
      if (enemies.length === 0) return { x, y, dir: 0 };

      let minDistSq = Infinity;
      for (const en of enemies) {
        const dsq = (en.x - x) ** 2 + (en.y - y) ** 2;
        if (dsq < minDistSq) minDistSq = dsq;
      }
      if (minDistSq >= 19 * 19) {
        return { x, y, dir: 0 };
      }
      if (minDistSq > bestMinEnemyDistSq) {
        bestMinEnemyDistSq = minDistSq;
        bestSpot = { x, y, dir: 0 };
      }
    }
  }
  return bestSpot || { x: baseX, y: baseY, dir: 0 };
}

async function playerBuyShip(slotIdx, classId) {
  const v = getActiveView();
  if (!v || !v.me.joined) return;
  const spot = findFreeTeamSpawn(v, v.me.team, classId, slotIdx);
  const res = await submitTypedRoundAction({
    actionType: 'purchase',
    slotIdx,
    label: `buyShip(slot=${slotIdx + 1})`,
    dataHex: NavalAbi.buyShip(app.battleId, slotIdx, classId, spot.x, spot.y, spot.dir),
    gasLimit: 5_000_000n,
    extraMeta: { classId, x: spot.x, y: spot.y, dir: spot.dir },
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    const [bw, bh] = shipDims(classId, spot.dir);
    addUpgradeRing(spot.x, spot.y, bw, bh, '#38bdf8');
    addFloatText(spot.x, spot.y - 0.6, `⚓ ${HULL_CLASSES[classId].short.toUpperCase()} COMMISSIONED!`, '#7dd3fc');
    app.selectedSlot = slotIdx;
    pushFeed(
      `<div style="color:#7dd3fc;">⚓ Commissioned <strong>${HULL_CLASSES[classId].name}</strong> in Slot [${slotIdx + 1}] at (${spot.x}, ${spot.y})!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  }
}

async function playerUpgradeGun(slotIdx, gunId) {
  const v = getActiveView();
  const sh = v?.myShips?.[slotIdx];
  const res = await submitTypedRoundAction({
    actionType: 'upgradeGun',
    slotIdx,
    label: `upgradeGun(${WEAPONS[gunId]?.name || gunId})`,
    dataHex: NavalAbi.upgradeGun(app.battleId, slotIdx, gunId),
    gasLimit: 4_500_000n,
    extraMeta: { gunId },
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    const curSh = getActiveView()?.myShips?.[slotIdx] || sh;
    if (curSh) {
      const [w, h] = shipDims(curSh.classId, curSh.dir);
      addUpgradeRing(curSh.x, curSh.y, w, h, '#fde047');
      addFloatText(curSh.x, curSh.y - 0.6, `🔫 ${WEAPONS[gunId].name.toUpperCase()} READY!`, '#fde047');
    }
    pushFeed(
      `<div style="color:#fde047;">🔫 Equipped <strong>${WEAPONS[gunId].name}</strong> on Ship [${slotIdx + 1}]!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  }
}

async function playerUpgradeEngine(slotIdx) {
  const v = getActiveView();
  const sh = v?.myShips?.[slotIdx];
  const res = await submitTypedRoundAction({
    actionType: 'upgradeEngine',
    slotIdx,
    label: `upgradeEngine(slot=${slotIdx + 1})`,
    dataHex: NavalAbi.upgradeArmor(app.battleId, slotIdx),
    gasLimit: 4_500_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    const curSh = getActiveView()?.myShips?.[slotIdx] || sh;
    if (curSh) {
      const [w, h] = shipDims(curSh.classId, curSh.dir);
      addUpgradeRing(curSh.x, curSh.y, w, h, '#34d399');
      addFloatText(curSh.x, curSh.y - 0.6, `⚡ +2 MAX RANGE UNLOCKED!`, '#6ee7b7');
    }
    pushFeed(
      `<div style="color:#6ee7b7;">⚡ Upgraded Turbines (+2 sq Max Range) on Ship [${slotIdx + 1}]!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  }
}

async function playerRepairShip(slotIdx) {
  const v = getActiveView();
  const sh = v?.myShips?.[slotIdx];
  const res = await submitTypedRoundAction({
    actionType: 'heal',
    slotIdx,
    label: `repairShip(slot=${slotIdx + 1})`,
    dataHex: NavalAbi.repairShip(app.battleId, slotIdx),
    gasLimit: 4_500_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    const curSh = getActiveView()?.myShips?.[slotIdx] || sh;
    if (curSh) {
      const [w, h] = shipDims(curSh.classId, curSh.dir);
      addUpgradeRing(curSh.x, curSh.y, w, h, '#10b981');
      addFloatText(curSh.x, curSh.y - 0.6, `🔧 HULL REPAIRED!`, '#6ee7b7');
    }
    pushFeed(
      `<div style="color:#38bdf8;">🔧 Restored destroyed hull squares on Ship [${slotIdx + 1}]!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  }
}

async function playerReturnShipToBase(slotIdx) {
  const v = getActiveView();
  const sh = v?.myShips?.[slotIdx];
  if (!v || !sh || !sh.alive) return;
  const inHarbor = shipInFriendlyBase(sh, v.gridW, v.gridH);
  const res = await submitTypedRoundAction({
    actionType: 'baseOps',
    slotIdx,
    label: `returnShipToBase(slot=${slotIdx + 1})`,
    dataHex: NavalAbi.returnShipToBase(app.battleId, slotIdx),
    gasLimit: 4_500_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    pushFeed(
      inHarbor
        ? `<div style="color:#6ee7b7;">⚓ Ship [${slotIdx + 1}] docked inside Naval Base — 100% protected from attack!</div>`
        : `<div style="color:#7dd3fc;">📡 Ship [${slotIdx + 1}] started 3-block (~13s) Out-of-Combat Tow to Naval Base!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  } else if (res) {
    const msg =
      '⚠ Cannot Return to Base yet: ship must be Out of Combat (no firing, hits taken, or undocking within the last 3 blocks ≈ 13s)!';
    el.rpcStatusText.textContent = msg;
    pushFeed(`<div style="color:#fca5a5;">${msg}</div>`);
  }
}

async function playerReturnFleetToBase() {
  const v = getActiveView();
  if (!v || !v.me.joined) return;
  const res = await submitTypedRoundAction({
    actionType: 'baseOps',
    slotIdx: app.selectedSlot,
    label: 'returnFleetToBase',
    dataHex: NavalAbi.returnFleetToBase(app.battleId),
    gasLimit: 5_000_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    pushFeed(
      `<div style="color:#6ee7b7;">⚓ Squadron Return-to-Base engaged! Harbor ships docked immediately; open-sea ships towing home in 3 blocks (~13s).</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  } else if (res) {
    const msg =
      '⚠ Cannot Return Fleet yet: wait 3 quiet blocks (~13s) after firing, taking hits, or undocking before recalling!';
    el.rpcStatusText.textContent = msg;
    pushFeed(`<div style="color:#fca5a5;">${msg}</div>`);
  }
}

async function playerSortieShipFromBase(slotIdx) {
  const res = await submitTypedRoundAction({
    actionType: 'baseOps',
    slotIdx,
    label: `sortieShipFromBase(slot=${slotIdx + 1})`,
    dataHex: NavalAbi.sortieShipFromBase(app.battleId, slotIdx),
    gasLimit: 4_800_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    pushFeed(
      `<div style="color:#fde047;">🚀 Ship [${slotIdx + 1}] sortied from Naval Base — battle stations!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
    centerCameraOnSlot(slotIdx);
  }
}

async function playerSortieFleetFromBase() {
  const res = await submitTypedRoundAction({
    actionType: 'baseOps',
    slotIdx: app.selectedSlot,
    label: 'sortieFleetFromBase',
    dataHex: NavalAbi.sortieFleetFromBase(app.battleId),
    gasLimit: 5_500_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    pushFeed(
      `<div style="color:#fde047;">🚀 Full Squadron sortied from Naval Base — welcome back, Captain!</div>`
    );
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
    const v = getActiveView();
    const firstAlive = v?.myShips?.findIndex((s) => s && s.alive) ?? -1;
    if (firstAlive >= 0) centerCameraOnSlot(firstAlive);
  }
}

async function playerCancelRecall(slotIdx) {
  const res = await submitTypedRoundAction({
    actionType: 'baseOps',
    slotIdx,
    label: `cancelRecall(slot=${slotIdx + 1})`,
    dataHex: NavalAbi.cancelRecall(app.battleId, slotIdx),
    gasLimit: 3_500_000n,
  });
  if (res && res.rcpt && res.rcpt.status === '0x1') {
    pushFeed(`<div style="color:#cbd5e1;">✕ Cancelled Naval Base tow for Ship [${slotIdx + 1}].</div>`);
    await pollLiveRpcState(Number(BigInt(res.rcpt.blockNumber || '0x0')));
  }
}

async function deployWasmOnNode() {
  if (app.rpcBusy) return;
  app.rpcBusy = true;
  el.rpcStatusText.textContent = 'Uploading /contracts/battleship.wasm (23.1 KB) to Subnet 1…';
  try {
    let resp = await fetch('/contracts/battleship.wasm', { cache: 'no-store' });
    if (!resp.ok) resp = await fetch('/public/contracts/battleship.wasm', { cache: 'no-store' });
    const wasm = new Uint8Array(await resp.arrayBuffer());
    const codeHash = keccak256Hex(wasm);

    const storeSent = await sendRpcTxWithNonceQueue(
      codeHash + bytesToHex(wasm, false),
      'storeBytecode',
      9_000_000n,
      '0x0000000000000000000000000000000000000100'
    );
    await waitForReceipt(storeSent.txHash);
    releaseInFlightNonce(storeSent.senderAddr, storeSent.nonce);

    const instSent = await sendRpcTxWithNonceQueue(codeHash, 'instantiate', 4_000_000n, null);
    const rcpt = await waitForReceipt(instSent.txHash);
    releaseInFlightNonce(instSent.senderAddr, instSent.nonce);

    app.contractAddr = rcpt.contractAddress;
    app.battleId = keccak256Hex(randomBytes(32));
    el.contractAddrInput.value = app.contractAddr;
    el.battleIdInput.value = app.battleId;
    SlxHfsCache.save({
      rpcUrl: app.rpcUrl,
      battleshipAddr: app.contractAddr,
      battleId: app.battleId,
    });
    el.rpcStatusText.textContent = `✓ Deployed Battleship HFS @ ${app.contractAddr.slice(0, 10)}…`;
  } catch (e) {
    el.rpcStatusText.textContent = `Deploy failed: ${e.message}`;
  } finally {
    app.rpcBusy = false;
  }
}

function formatCaptainVesselLabel(ownerPid) {
  const plr = app.rpcPlayers[ownerPid];
  if (!plr) return `Capt#${ownerPid}`;
  const addr4 = truncAddr4(plr.addr);
  const myRec = slxWallet.getIdentityRecord();
  if (plr.addr.toLowerCase() === myWallet.addr.toLowerCase() && myRec?.nickname) {
    return `${myRec.nickname} · ${addr4}`;
  }
  const nick = plr.identityAddr ? app.identityNicknames.get(plr.identityAddr.toLowerCase()) : '';
  return nick ? `${nick} · ${addr4}` : `Capt#${ownerPid} · ${addr4}`;
}

function syncPlayerNicknames() {
  for (const p of app.rpcPlayers) {
    if (!p.identityAddr) continue;
    const idLow = p.identityAddr.toLowerCase();
    if (app.identityNicknames.has(idLow) || app.resolvingIdentities.has(idLow)) continue;
    app.resolvingIdentities.add(idLow);
    readOnChainIdentityNickname(app.rpcUrl, idLow)
      .then((nick) => {
        if (nick) {
          app.identityNicknames.set(idLow, nick);
          renderSidebarAndHud();
        }
      })
      .catch(() => {})
      .finally(() => {
        app.resolvingIdentities.delete(idLow);
      });
  }
}

async function createOrJoinOnChainBattle() {
  if (!app.contractAddr) {
    el.rpcStatusText.textContent = 'Waiting for Subnet 1 HFS contract address…';
    return;
  }
  if (app.rpcBusy) return;
  app.rpcBusy = true;
  if (el.btnLaunchBattle) {
    el.btnLaunchBattle.disabled = true;
    el.btnLaunchBattle.textContent = '⏳ Deploying Fleet on Subnet 1 (1 Block)…';
  }
  try {
    // Ensure user's cross-app Identity HFS + Nickname is deployed first!
    const idRec = await slxWallet.ensureIdentityWithPrompt({
      rpcUrl: app.rpcUrl,
      appName: 'Phantom Fleet',
    });
    if (idRec?.identityAddr && idRec?.nickname) {
      app.identityNicknames.set(idRec.identityAddr.toLowerCase(), idRec.nickname);
    }

    if (!app.battleId) {
      app.battleId = keccak256Hex(randomBytes(32));
      el.battleIdInput.value = app.battleId;
    }
    SlxHfsCache.save({
      rpcUrl: app.rpcUrl,
      battleshipAddr: app.contractAddr,
      battleId: app.battleId,
    });

    const existingHex = await rpcCall('eth_call', [
      { to: app.contractAddr, data: NavalAbi.getBattleState(app.battleId) },
      'latest',
    ]);
    const decodedExisting = decodeBattleStateHex(existingHex);
    if (!decodedExisting) {
      const ch = await sendRpcTxWithNonceQueue(NavalAbi.createBattle(app.battleId), 'createBattle', 4_500_000n);
      await waitForReceipt(ch.txHash);
      releaseInFlightNonce(ch.senderAddr, ch.nonce);
    }

    const [s0, s1, s2] = app.starterLoadout;
    const curView = getActiveView();
    const restartingAfterGameOver = Boolean(curView?.me?.isGameOver);

    const jh = restartingAfterGameOver
      ? await sendRpcTxWithNonceQueue(
          NavalAbi.startAnew(app.battleId, s0, s1, s2),
          'startAnew(-50% Score)',
          6_500_000n
        )
      : await sendRpcTxWithNonceQueue(
          NavalAbi.joinAndDeployWithIdentity(
            app.battleId,
            app.preferredTeam,
            idRec?.identityAddr || '0x0000000000000000000000000000000000000000',
            s0,
            s1,
            s2
          ),
          'joinAndDeployWithIdentity',
          6_500_000n
        );
    const rcpt = await waitForReceipt(jh.txHash);
    releaseInFlightNonce(jh.senderAddr, jh.nonce);
    if (rcpt && rcpt.status === '0x1') {
      const blk = Number(BigInt(rcpt.blockNumber || '0x0'));
      await pollLiveRpcState(blk);
    }

    const firstSlot = app.starterLoadout.findIndex((c) => c >= 0);
    app.selectedSlot = firstSlot >= 0 ? firstSlot : 0;
    app.joinModalOpen = false;
    el.joinModal.classList.remove('open');
    fitBoardToWidget();
    renderSidebarAndHud();
    pushFeed(
      restartingAfterGameOver
        ? `<div style="color:#fcd34d;">🔄 <strong>${idRec?.nickname || 'Captain'} · ${truncAddr4(myWallet.addr)}</strong> started anew (1,000 CR • -50% Current Score; Peak High Score preserved)!</div>`
        : `<div style="color:#6ee7b7;">⚓ <strong>${idRec?.nickname || 'Captain'} · ${truncAddr4(myWallet.addr)}</strong> deployed fleet on Subnet 1!</div>`
    );
  } catch (e) {
    if (e?.isIdentityPromptCanceled) {
      el.rpcStatusText.textContent = '👁️ Spectating Live Naval Battle — Click "Join Battle" anytime to deploy your fleet!';
    } else {
      el.rpcStatusText.textContent = `RPC error: ${e.message}`;
    }
  } finally {
    app.rpcBusy = false;
    if (el.btnLaunchBattle) {
      el.btnLaunchBattle.disabled = false;
      const vAfter = getActiveView();
      el.btnLaunchBattle.textContent = vAfter?.me?.isGameOver
        ? '🔄 Start Anew (1,000 CR • -50% Current Score) →'
        : '⚓ Sign & Deploy Fleet on Subnet 1 →';
    }
  }
}

async function pollLiveRpcState(minBlockFloor = 0, knownBlockNum = 0) {
  if (!app.contractAddr || !app.battleId) return;
  try {
    const [blkHex, stHex, plrsHex] = await Promise.all([
      knownBlockNum > 0 ? Promise.resolve(null) : rpcCall('eth_blockNumber'),
      rpcCall('eth_call', [
        { to: app.contractAddr, data: NavalAbi.getBattleState(app.battleId) },
        'latest',
      ]),
      rpcCall('eth_call', [
        { to: app.contractAddr, data: NavalAbi.getPlayersSlice(app.battleId, 0, 100) },
        'latest',
      ]),
    ]);
    const blkNum = knownBlockNum > 0 ? knownBlockNum : Number(BigInt(blkHex));
    if (blkNum < Math.max(app.rpcBlock, minBlockFloor)) return;

    const decoded = decodeBattleStateHex(stHex);
    if (!decoded) return;

    // Smoothly interpolate AI & rival vessels into their newly finalized positions!
    if (app.rpcState?.ships && hasDom) {
      const prevByGidx = new Map(app.rpcState.ships.map((s) => [s.gidx, s]));
      const now = performance.now();
      for (const sh of decoded.ships) {
        if (!sh.alive) continue;
        const old = prevByGidx.get(sh.gidx);
        if (old && old.alive && (old.x !== sh.x || old.y !== sh.y) && !app.arrivalSnaps.has(sh.gidx)) {
          app.arrivalSnaps.set(sh.gidx, {
            fromX: old.x,
            fromY: old.y,
            toX: sh.x,
            toY: sh.y,
            hullDir: sh.dir,
            startedAt: now,
            durationMs: 420,
          });
        }
      }
    }

    app.rpcBlock = blkNum;
    app.rpcState = decoded;
    app.rpcPlayers = decodePlayersSliceHex(plrsHex);
    syncPlayerNicknames();
    pollFleetSocialState();
    renderSidebarAndHud();
    if (app.joinModalOpen) renderJoinModal();
  } catch (_) {}
}

function ingestArenaSubscriptionLog(lg) {
  if (!lg || !lg.data) return;
  const t0 = String(lg.topics?.[0] || '').toLowerCase();
  const blk = lg.blockNumberNum || app.rpcBlock || 0;
  const txHash = lg.transactionHash || '';
  const d = hexToBytes(lg.data);
  const myPlr = app.rpcPlayers.find((p) => p.addr.toLowerCase() === myWallet.addr.toLowerCase());
  const myPid = myPlr ? myPlr.pid : -1;

  if (t0 === TOPIC_WEAPON_FIRED && d.length >= 32) {
    const attackerGidx = readU64BE(d, 0);
    const gunId = readU64BE(d, 8);
    const tx = readU64BE(d, 16);
    const ty = readU64BE(d, 24);
    const attackerPid = Math.floor(attackerGidx / 3);
    const gun = WEAPONS[gunId] || WEAPONS[0];
    const captLabel = escapeSocialHtml(formatCaptainVesselLabel(attackerPid));
    const attPlr = app.rpcPlayers[attackerPid];
    const isEnemy = myPlr && attPlr ? attPlr.team !== myPlr.team : attPlr?.team === TEAM_RED;

    if (txHash) {
      app.lastWeaponByTx.set(txHash, { gunName: gun.name, tx, ty, attackerPid });
      if (app.lastWeaponByTx.size > 128) {
        const first = app.lastWeaponByTx.keys().next().value;
        if (first !== undefined) app.lastWeaponByTx.delete(first);
      }
    }

    if (!lg.isBackfill && hasDom) {
      const gw = app.rpcState?.gridW || 48;
      const gh = app.rpcState?.gridH || 30;
      const attShip = app.rpcState?.ships?.find((s) => s.gidx === attackerGidx);
      const fromX = attShip ? shipCenter(attShip).cx + 0.5 : tx + 0.5;
      const fromY = attShip ? shipCenter(attShip).cy + 0.5 : Math.max(0.5, ty - 4.5);
      const aoeCells = getImpactCells(gunId, tx, ty, gw, gh);

      let hitsMe = false;
      if (myPid >= 0 && app.rpcState?.ships) {
        for (const mySh of app.rpcState.ships) {
          if (!mySh.alive || mySh.ownerPid !== myPid) continue;
          if (aoeCells.some(([cx, cy]) => cellIndexOnShip(mySh, cx, cy) >= 0)) {
            hitsMe = true;
            break;
          }
        }
      }

      app.shellSnapImpacts.push({
        fromX,
        fromY,
        toX: tx + 0.5,
        toY: ty + 0.5,
        aoeCells,
        sunk: false,
        tx,
        ty,
        team: attPlr?.team ?? TEAM_RED,
        gunId,
        strokeColor: hitsMe ? '#ef4444' : isEnemy ? '#fb7185' : '#38bdf8',
        impactLabel: hitsMe ? `🚨 HIT BY ${gun.name.toUpperCase()}!` : `💥 ${gun.name.toUpperCase()}`,
        impactColor: hitsMe ? '#fca5a5' : isEnemy ? '#fda4af' : '#7dd3fc',
        startedAt: performance.now(),
        durationMs: 460,
      });
    }

    pushFeed(
      `<div style="color:${isEnemy ? '#fda4af' : '#93c5fd'};">🔥 <strong>Blk #${blk}</strong>: <strong>${captLabel}</strong> fired <strong>${escapeSocialHtml(gun.name)}</strong> &rarr; <code>(${tx},${ty})</code></div>`
    );
    return;
  }

  if (t0 === TOPIC_VESSEL_COLLISION && d.length >= 56) {
    const moverGidx = readU64BE(d, 0);
    const otherGidx = readU64BE(d, 8);
    const x = readU64BE(d, 16);
    const y = readU64BE(d, 24);
    const overlapSquares = readU64BE(d, 32);
    const moverCapt = escapeSocialHtml(formatCaptainVesselLabel(Math.floor(moverGidx / 3)));
    const otherCapt = escapeSocialHtml(formatCaptainVesselLabel(Math.floor(otherGidx / 3)));

    if (txHash) {
      app.lastCollisionByTx.set(txHash, { x, y, overlapSquares });
      if (app.lastCollisionByTx.size > 128) {
        const first = app.lastCollisionByTx.keys().next().value;
        if (first !== undefined) app.lastCollisionByTx.delete(first);
      }
    }

    if (!lg.isBackfill && hasDom) {
      addExplosion([[x, y]]);
      addFloatText(x, y - 0.9, `💥 HULL COLLISION (${overlapSquares} SQ)!`, '#fbbf24');
    }

    pushFeed(
      `<div style="color:#fcd34d;">💥 <strong>Blk #${blk}</strong>: <strong>${moverCapt}</strong> &amp; <strong>${otherCapt}</strong> collided at <code>(${x},${y})</code> [${overlapSquares} sq]!</div>`
    );
    return;
  }

  if (t0 === TOPIC_SHIP_SUNK && d.length >= 24) {
    const sunkGidx = readU64BE(d, 0);
    const killerPid = readU64BE(d, 8);
    const bounty = readU64BE(d, 16);
    const victimPid = Math.floor(sunkGidx / 3);
    const victimSlot = (sunkGidx % 3) + 1;
    const killerRaw =
      killerPid === victimPid ? 'Friendly/Self Collision' : formatCaptainVesselLabel(killerPid);
    const killerLabel = escapeSocialHtml(killerRaw);
    const victimLabel = escapeSocialHtml(formatCaptainVesselLabel(victimPid));
    const weaponInfo = txHash ? app.lastWeaponByTx.get(txHash) : null;
    const colInfo = txHash ? app.lastCollisionByTx.get(txHash) : null;
    const cause = weaponInfo?.gunName || (colInfo ? 'Hull Ramming Collision' : 'Naval Salvo');

    if (myPid >= 0 && victimPid === myPid) {
      app.lastMyLossAlert = {
        slot: victimSlot,
        killerLabel: killerRaw,
        cause,
        blk,
        until: Date.now() + 12_000,
      };
      if (!lg.isBackfill && hasDom) {
        const ax = weaponInfo?.tx ?? colInfo?.x ?? 24;
        const ay = weaponInfo?.ty ?? colInfo?.y ?? 15;
        addFloatText(ax, ay - 1.2, `☠ SLOT [${victimSlot}] SUNK BY ${killerRaw}!`, '#fca5a5');
        renderSidebarAndHud();
      }
    } else if (!lg.isBackfill && hasDom && weaponInfo) {
      addFloatText(weaponInfo.tx, weaponInfo.ty - 1.1, `☠ VESSEL SUNK!`, '#fde047');
    }

    pushFeed(
      `<div style="color:${victimPid === myPid ? '#fca5a5' : '#fde047'};">☠ <strong>Blk #${blk}</strong>: <strong>${killerLabel}</strong> sunk <strong>${victimLabel}</strong> [Slot ${victimSlot}] via <em>${escapeSocialHtml(cause)}</em>${bounty > 0 ? ` (+${bounty} CR)` : ''}!</div>`
    );
  }
}

// ---------------------------------------------------------------------------
// In-Game Social Network & VHF Comms (`Messaging` + `SocialCharter` + `SocialRelationships` + `SocialFeed`)
// ---------------------------------------------------------------------------

function escapeSocialHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getMyTeamAndShipCoords() {
  const myPlr = app.rpcPlayers.find((p) => p.addr.toLowerCase() === myWallet.addr.toLowerCase());
  const team = myPlr ? myPlr.team : app.preferredTeam;
  let gx = 24;
  let gy = 15;
  if (myPlr && app.rpcState?.ships) {
    const sh = app.rpcState.ships.find((s) => s.alive && s.ownerPid === myPlr.pid);
    if (sh) {
      gx = sh.x;
      gy = sh.y;
    }
  }
  return { myPlr, team, gx, gy };
}

let autoSocialSyncedForId = '';

async function pollFleetSocialState() {
  if (!app.battleId) return;
  try {
    const idRec = slxWallet.getIdentityRecord();
    const myIdLow = (idRec?.identityAddr || '').toLowerCase();
    const { team } = getMyTeamAndShipCoords();
    if (!app.activeDmPeerId && fleetSocial.connectedIds.size > 0) {
      app.activeDmPeerId = Array.from(fleetSocial.connectedIds)[0];
    }
    await fleetSocial.refresh({
      battleId: app.battleId,
      myTeam: team,
      myIdentityAddr: myIdLow,
      activeDmPeerId: app.activeDmPeerId,
      players: app.rpcPlayers,
    });
    if (hasDom) renderFleetSocialPane();

    // Auto-onboard active player's verified Identity onto `fleetSocial.charter` in background once per session
    if (myIdLow && autoSocialSyncedForId !== myIdLow && fleetSocial.suite?.charter) {
      const meMem = fleetSocial.charterSnap?.members?.find((m) => m.identityAddr === myIdLow);
      if (!meMem || !meMem.isActive) {
        autoSocialSyncedForId = myIdLow;
        sendRpcTxWithNonceQueue(
          FleetSocialAbi.syncVerifiedIdentity(myIdLow),
          'syncVerifiedIdentity',
          5_500_000n,
          fleetSocial.suite.charter,
          fleetSocial.suiteTargets([myIdLow])
        )
          .then((sent) =>
            waitForReceipt(sent.txHash).then(() => {
              releaseInFlightNonce(sent.senderAddr, sent.nonce);
              return fleetSocial.refresh({
                battleId: app.battleId,
                myTeam: team,
                myIdentityAddr: myIdLow,
                activeDmPeerId: app.activeDmPeerId,
                players: app.rpcPlayers,
              });
            })
          )
          .then(() => {
            if (hasDom) renderFleetSocialPane();
          })
          .catch(() => {
            autoSocialSyncedForId = '';
          });
      } else {
        autoSocialSyncedForId = myIdLow;
      }
    }
  } catch (_) {}
}

async function runCommsRoundAction(label, execCallback) {
  if (app.pendingActions.has('comms')) {
    if (hasDom) {
      el.rpcStatusText.textContent =
        '⏳ 1 Comms txn is already in flight this round — Move, Fire, Heal & Upgrades remain ready!';
    }
    return false;
  }
  let idRec = null;
  try {
    idRec = await slxWallet.ensureIdentityWithPrompt({
      rpcUrl: app.rpcUrl,
      appName: 'Phantom Fleet Comms',
    });
  } catch (err) {
    if (err?.isIdentityPromptCanceled) return false;
    throw err;
  }
  if (!idRec?.identityAddr) return false;

  app.pendingActions.set('comms', { actionType: 'comms', label });
  renderRoundQueueBar();
  if (hasDom && el.socialSendBtn) el.socialSendBtn.disabled = true;

  const inFlightStepNonces = [];
  const sendIdentityTx = async (toAddr, dataHex, extraTargets = [], gasLimit = 6_500_000n) => {
    const sent = await sendRpcTxWithNonceQueue(dataHex, label, gasLimit, toAddr, extraTargets);
    inFlightStepNonces.push(sent);
    app.pendingActions.set('comms', {
      actionType: 'comms',
      label,
      nonce: Number(sent.nonce),
      txHash: sent.txHash,
    });
    renderRoundQueueBar();
    const rcpt = await waitForReceipt(sent.txHash);
    releaseInFlightNonce(sent.senderAddr, sent.nonce);
    if (!rcpt || rcpt.status !== '0x1') {
      throw new Error(`Transaction reverted on-chain (${sent.txHash.slice(0, 10)}…)`);
    }
    return { ...sent, rcpt };
  };

  try {
    await execCallback(idRec, sendIdentityTx);
    app.pendingActions.delete('comms');
    renderRoundQueueBar();
    await pollFleetSocialState();
    return true;
  } catch (e) {
    for (const s of inFlightStepNonces) releaseInFlightNonce(s.senderAddr, s.nonce);
    app.pendingActions.delete('comms');
    renderRoundQueueBar();
    if (hasDom) el.rpcStatusText.textContent = `⚠ Comms error: ${e.message}`;
    return false;
  } finally {
    if (hasDom && el.socialSendBtn) el.socialSendBtn.disabled = false;
  }
}

async function handleConnectCaptain(targetIdentityAddr) {
  const suite = await fleetSocial.ensureSuiteLoaded();
  if (!suite?.charter || !suite?.relationships || !targetIdentityAddr) return;
  const targetLow = targetIdentityAddr.toLowerCase();

  await pollFleetSocialState();

  // If already connected, jump straight to 1-on-1 Direct Messaging!
  if (fleetSocial.connectedIds.has(targetLow)) {
    app.activeDmPeerId = targetLow;
    app.sideMode = 'social';
    app.socialTab = 'dm';
    app.dmMode = 'dm';
    await pollFleetSocialState();
    renderFleetSocialPane();
    return;
  }

  // If that Captain ALREADY sent us a request, clicking Connect auto-accepts it!
  if (fleetSocial.incomingHandshakes.some((h) => h.initiatorIdentity === targetLow)) {
    await handleAcceptCaptain(targetLow);
    return;
  }

  const { team, gx, gy } = getMyTeamAndShipCoords();

  const ok = await runCommsRoundAction('openHandshake', async (idRec, sendIdentityTx) => {
    await fleetSocial.ensureOnboardedAndActive({
      sendIdentityTx,
      myIdentityAddr: idRec.identityAddr,
      myNickname: idRec.nickname,
      myHandle: idRec.handle,
      myTeam: team,
      gridX: gx,
      gridY: gy,
    });
    await fleetSocial.ensurePeerActive({
      sendIdentityTx,
      peerIdentityAddr: targetLow,
    });
    const secretNonce = deterministicEncounterNonce(
      suite.charter,
      idRec.identityAddr,
      targetLow
    );
    const commit = computeEncounterCommit(
      suite.charter,
      idRec.identityAddr,
      targetLow,
      secretNonce
    );
    await sendIdentityTx(
      idRec.identityAddr,
      FleetSocialAbi.execViaIdentity(
        suite.relationships,
        FleetSocialAbi.openEncounterHandshake(targetLow, 2, commit)
      ),
      fleetSocial.suiteTargets([idRec.identityAddr, targetLow]),
      6_500_000n
    );
  });
  if (ok) {
    fleetSocial.outgoingIds.add(targetLow);
    if (hasDom) {
      renderFleetSocialPane();
      const peerLabel = labelForSocialAuthor(targetLow);
      el.rpcStatusText.textContent = `✓ Connection request sent to ${peerLabel} — Direct Msg unlocks once accepted (AI accepts in ~1 block)!`;
    }
    pushFeed(
      `<div style="color:#6ee7b7;">🤝 Sent connection request to <strong>${escapeSocialHtml(labelForSocialAuthor(targetLow))}</strong> — Direct Comms unlock upon ✓ Accept!</div>`
    );
    // Poll again after 2.2s and 4.8s so AI auto-accept immediately flips button to `💬 Direct Msg`!
    setTimeout(() => pollFleetSocialState(), 2200);
    setTimeout(() => pollFleetSocialState(), 4800);
  }
}

async function handleAcceptCaptain(initiatorIdentityAddr) {
  const suite = await fleetSocial.ensureSuiteLoaded();
  if (!suite?.charter || !suite?.relationships || !initiatorIdentityAddr) return;
  const initiatorLow = initiatorIdentityAddr.toLowerCase();
  const { team, gx, gy } = getMyTeamAndShipCoords();

  const ok = await runCommsRoundAction('acceptHandshake', async (idRec, sendIdentityTx) => {
    await fleetSocial.ensureOnboardedAndActive({
      sendIdentityTx,
      myIdentityAddr: idRec.identityAddr,
      myNickname: idRec.nickname,
      myHandle: idRec.handle,
      myTeam: team,
      gridX: gx,
      gridY: gy,
    });
    await fleetSocial.ensurePeerActive({
      sendIdentityTx,
      peerIdentityAddr: initiatorLow,
    });
    const secretNonce = deterministicEncounterNonce(
      suite.charter,
      initiatorLow,
      idRec.identityAddr
    );
    await sendIdentityTx(
      idRec.identityAddr,
      FleetSocialAbi.execViaIdentity(
        suite.relationships,
        FleetSocialAbi.acceptEncounterHandshake(initiatorLow, secretNonce)
      ),
      fleetSocial.suiteTargets([idRec.identityAddr, initiatorLow]),
      6_500_000n
    );
  });
  if (ok) {
    app.activeDmPeerId = initiatorLow;
    app.sideMode = 'social';
    app.socialTab = 'dm';
    app.dmMode = 'dm';
    await pollFleetSocialState();
    if (hasDom) {
      renderFleetSocialPane();
      el.socialMsgInput?.focus();
    }
    pushFeed(
      `<div style="color:#fde047;">★ Connected with <strong>${escapeSocialHtml(labelForSocialAuthor(initiatorLow))}</strong> (+3 Civic Trust) — 1-on-1 Direct Comms open!</div>`
    );
  }
}

async function handleSendSocialComposer(textStr) {
  const clean = String(textStr || '').trim();
  if (!clean) return;
  const suite = await fleetSocial.ensureSuiteLoaded();
  if (!suite?.messaging) return;
  const { team, gx, gy } = getMyTeamAndShipCoords();

  if (app.socialTab === 'bridge' || app.socialTab === 'squadron') {
    const chan =
      app.socialTab === 'bridge'
        ? bridgeChannelHash(app.battleId)
        : squadronChannelHash(app.battleId, team);
    const label = app.socialTab === 'bridge' ? 'postBridgeRadio' : 'postSquadronRadio';
    const ok = await runCommsRoundAction(label, async (idRec, sendIdentityTx) => {
      await sendIdentityTx(
        idRec.identityAddr,
        FleetSocialAbi.execViaIdentity(suite.messaging, FleetSocialAbi.postMessage(chan, clean)),
        [idRec.identityAddr, suite.messaging],
        6_000_000n
      );
    });
    if (ok && hasDom && el.socialMsgInput) el.socialMsgInput.value = '';
    return;
  }

  if (app.socialTab === 'dm') {
    if (app.dmMode === 'wall') {
      const ok = await runCommsRoundAction('postFleetWall', async (idRec, sendIdentityTx) => {
        await fleetSocial.ensureOnboardedAndActive({
          sendIdentityTx,
          myIdentityAddr: idRec.identityAddr,
          myNickname: idRec.nickname,
          myHandle: idRec.handle,
          myTeam: team,
          gridX: gx,
          gridY: gy,
        });
        await sendIdentityTx(
          idRec.identityAddr,
          FleetSocialAbi.execViaIdentity(suite.feed, FleetSocialAbi.createPost(0, clean)),
          fleetSocial.suiteTargets([idRec.identityAddr]),
          7_000_000n
        );
      });
      if (ok && hasDom && el.socialMsgInput) el.socialMsgInput.value = '';
    } else if (app.activeDmPeerId) {
      const peer = app.activeDmPeerId;
      const ok = await runCommsRoundAction('sendDirectMessage', async (idRec, sendIdentityTx) => {
        await fleetSocial.ensureOnboardedAndActive({
          sendIdentityTx,
          myIdentityAddr: idRec.identityAddr,
          myNickname: idRec.nickname,
          myHandle: idRec.handle,
          myTeam: team,
          gridX: gx,
          gridY: gy,
        });
        await fleetSocial.ensurePeerActive({
          sendIdentityTx,
          peerIdentityAddr: peer,
        });
        await sendIdentityTx(
          idRec.identityAddr,
          FleetSocialAbi.execViaIdentity(
            suite.feed,
            FleetSocialAbi.sendDirectMessage(peer, clean)
          ),
          fleetSocial.suiteTargets([idRec.identityAddr, peer]),
          7_000_000n
        );
      });
      if (ok && hasDom && el.socialMsgInput) el.socialMsgInput.value = '';
    }
  }
}

function labelForSocialAuthor(identityAddrLower) {
  const low = String(identityAddrLower || '').toLowerCase();
  const myRec = slxWallet.getIdentityRecord();
  if (myRec?.identityAddr && myRec.identityAddr.toLowerCase() === low) {
    return `${myRec.nickname} · ${truncAddr4(myWallet.addr)} (You)`;
  }
  const plr = app.rpcPlayers.find((p) => (p.identityAddr || '').toLowerCase() === low);
  if (plr) {
    const nick = app.identityNicknames.get(low) || fleetSocial.identityTagCache.get(low);
    if (nick) return nick.includes('·') ? nick : `${nick} · ${truncAddr4(plr.addr)}`;
    return `Capt#${plr.pid} · ${truncAddr4(plr.addr)}`;
  }
  return fleetSocial.identityTagCache.get(low) || `Capt · ${truncAddr4(low)}`;
}

function syncSideTabVisibility() {
  if (!hasDom) return;
  el.tabFleetCmd?.classList.toggle('active', app.sideMode === 'fleet');
  el.tabFleetScores?.classList.toggle('active', app.sideMode === 'scores');
  el.tabFleetSocial?.classList.toggle('active', app.sideMode === 'social');
  if (el.fleetCommandPane) {
    el.fleetCommandPane.style.display = app.sideMode === 'fleet' ? 'flex' : 'none';
  }
  if (el.fleetLeaderboardPane) {
    el.fleetLeaderboardPane.style.display = app.sideMode === 'scores' ? 'flex' : 'none';
  }
  if (el.fleetSocialPane) {
    el.fleetSocialPane.style.display = app.sideMode === 'social' ? 'flex' : 'none';
  }
}

function renderLeaderboardPane() {
  if (!hasDom || !el.leaderboardBodyBox) return;
  syncSideTabVisibility();
  if (app.sideMode !== 'scores') return;

  const ranked = [...app.rpcPlayers].sort((a, b) => {
    const ba = a.bestScore ?? a.score ?? 0;
    const bb = b.bestScore ?? b.score ?? 0;
    if (bb !== ba) return bb - ba;
    if (b.score !== a.score) return b.score - a.score;
    return b.kills - a.kills;
  });

  if (!ranked.length) {
    el.leaderboardBodyBox.innerHTML = `<div style="color:#64748b;padding:0.5rem;">No Captains scored yet — hit enemy hulls (+100 pts) &amp; sink warships (+250–1,500 pts)!</div>`;
    return;
  }

  const myAddrLow = myWallet.addr.toLowerCase();
  el.leaderboardBodyBox.innerHTML = ranked
    .map((p, idx) => {
      const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
      const isMe = p.addr.toLowerCase() === myAddrLow;
      const idLow = (p.identityAddr || '').toLowerCase();
      const isAlly = idLow && fleetSocial.connectedIds.has(idLow);
      const teamDot = p.team === TEAM_RED ? '🔴' : '🔵';
      const bestPts = (p.bestScore ?? p.score ?? 0).toLocaleString();
      const curPts = (p.score ?? 0).toLocaleString();
      const restartTag = p.restarts > 0 ? ` • <span style="color:#fca5a5;">↻${p.restarts}</span>` : '';
      return `
        <div class="nv-cap-row" style="${isMe ? 'border-color:#fde047;background:rgba(250,204,21,0.12);' : ''}">
          <div style="min-width:0;">
            <div style="font-weight:800;color:${isMe ? '#fde047' : isAlly ? '#6ee7b7' : '#f1f5f9'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${rankBadge} ${teamDot} ${isAlly ? '★ ' : ''}${escapeSocialHtml(formatCaptainVesselLabel(p.pid))}${isMe ? ' (You)' : ''}
            </div>
            <div style="font-size:0.62rem;color:#94a3b8;margin-top:2px;">
              Now: <strong style="color:#cbd5e1;">${curPts} pts</strong> • ${p.kills} Sink${p.kills === 1 ? '' : 's'}${restartTag}
            </div>
          </div>
          <div style="text-align:right;white-space:nowrap;">
            <div style="font-size:0.8rem;font-weight:900;color:#fde047;">🏆 ${bestPts}</div>
            <div style="font-size:0.59rem;color:#94a3b8;">PEAK PTS</div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderFleetSocialPane() {
  if (!hasDom || !el.fleetSocialPane) return;

  const incomingCount = fleetSocial.incomingHandshakes.length;
  if (el.socialNotifBadge) {
    if (incomingCount > 0) {
      el.socialNotifBadge.style.display = 'inline-block';
      el.socialNotifBadge.textContent = String(incomingCount);
    } else {
      el.socialNotifBadge.style.display = 'none';
    }
  }

  const incomingRowsHtml = fleetSocial.incomingHandshakes
    .map(
      (hs) => `
      <div class="nv-cap-row" style="border-color:#34d399;background:rgba(16,185,129,0.18);">
        <span style="color:#a7f3d0;font-size:0.68rem;">
          🤝 <strong>${escapeSocialHtml(labelForSocialAuthor(hs.initiatorIdentity))}</strong> wants to connect for 1-on-1 Direct Comms!
        </span>
        <button type="button" class="nv-btn nv-btn-emerald" style="padding:0.22rem 0.54rem;font-size:0.66rem;" data-accept-id="${escapeSocialHtml(hs.initiatorIdentity)}">
          ✓ Accept &amp; Msg
        </button>
      </div>`
    )
    .join('');

  // Also show incoming connection requests right on the main `⚓ Fleet` tab so players never miss them!
  if (el.fleetSocialAlertBanner) {
    if (incomingCount > 0) {
      el.fleetSocialAlertBanner.style.display = 'flex';
      el.fleetSocialAlertBanner.style.flexDirection = 'column';
      el.fleetSocialAlertBanner.style.gap = '0.3rem';
      el.fleetSocialAlertBanner.innerHTML = incomingRowsHtml;
    } else {
      el.fleetSocialAlertBanner.style.display = 'none';
      el.fleetSocialAlertBanner.innerHTML = '';
    }
  }

  syncSideTabVisibility();
  if (app.sideMode !== 'social') return;

  el.fleetSocialPane.querySelectorAll('[data-soc-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-soc-tab') === app.socialTab);
  });

  // Incoming Handshake Alert Strip inside Comms
  if (incomingCount > 0) {
    el.socialIncomingBox.style.display = 'flex';
    el.socialIncomingBox.style.flexDirection = 'column';
    el.socialIncomingBox.style.gap = '0.3rem';
    el.socialIncomingBox.innerHTML = incomingRowsHtml;
  } else {
    el.socialIncomingBox.style.display = 'none';
    el.socialIncomingBox.innerHTML = '';
  }

  const myIdLow = (slxWallet.getIdentityRecord()?.identityAddr || '').toLowerCase();
  const { team } = getMyTeamAndShipCoords();

  if (app.socialTab === 'bridge' || app.socialTab === 'squadron') {
    el.socialPeerSelectRow.style.display = 'none';
    el.socialComposerForm.style.display = 'flex';
    el.socialMsgInput.placeholder =
      app.socialTab === 'bridge'
        ? 'Broadcast to all ships on Bridge VHF Ch.16…'
        : `Transmit to ${team === TEAM_RED ? 'Red Armada' : 'Blue Coalition'} Squadron…`;

    const msgs = app.socialTab === 'bridge' ? fleetSocial.bridgeMsgs : fleetSocial.squadronMsgs;
    el.socialBodyBox.innerHTML = msgs.length
      ? msgs
          .map((m) => {
            const isMine = myIdLow && m.authorAddr === myIdLow;
            const isAlly = fleetSocial.connectedIds.has(m.authorAddr);
            return `
              <div class="nv-msg-bubble ${isMine ? 'mine' : ''}">
                <div style="display:flex;justify-content:space-between;gap:0.4rem;font-size:0.64rem;color:#94a3b8;margin-bottom:2px;">
                  <strong style="color:${isMine ? '#6ee7b7' : isAlly ? '#fde047' : '#7dd3fc'};">
                    ${isAlly ? '★ ' : ''}${escapeSocialHtml(labelForSocialAuthor(m.authorAddr))}
                  </strong>
                  <span>Blk #${m.block}</span>
                </div>
                <div style="color:#f1f5f9;word-break:break-word;">${escapeSocialHtml(m.text)}</div>
              </div>
            `;
          })
          .join('')
      : `<div style="color:#64748b;padding:0.5rem;">No transmissions on this frequency yet — key your mic below!</div>`;
    el.socialBodyBox.scrollTop = el.socialBodyBox.scrollHeight;
    return;
  }

  if (app.socialTab === 'captains') {
    el.socialPeerSelectRow.style.display = 'none';
    el.socialComposerForm.style.display = 'none';

    // Combine Arena Captains (`rpcPlayers`) + Charter Members
    const seenIds = new Set();
    const rows = [];
    for (const p of app.rpcPlayers) {
      const idLow = (p.identityAddr || '').toLowerCase();
      if (!idLow || idLow === myIdLow || seenIds.has(idLow)) continue;
      seenIds.add(idLow);
      const mem = fleetSocial.charterSnap?.members?.find((m) => m.identityAddr === idLow);
      rows.push({
        idLow,
        label: formatCaptainVesselLabel(p.pid),
        team: p.team,
        kills: p.kills,
        trust: mem?.trustScore || 35,
      });
    }
    for (const m of fleetSocial.charterSnap?.members || []) {
      if (!m.identityAddr || m.identityAddr === myIdLow || seenIds.has(m.identityAddr)) continue;
      seenIds.add(m.identityAddr);
      rows.push({
        idLow: m.identityAddr,
        label: labelForSocialAuthor(m.identityAddr),
        team: null,
        kills: 0,
        trust: m.trustScore,
      });
    }

    el.socialBodyBox.innerHTML = rows.length
      ? rows
          .map((r) => {
            const connected = fleetSocial.connectedIds.has(r.idLow);
            const outgoing = fleetSocial.outgoingIds.has(r.idLow);
            const incoming = fleetSocial.incomingHandshakes.some(
              (h) => h.initiatorIdentity === r.idLow
            );
            const teamDot =
              r.team === TEAM_RED ? '🔴 ' : r.team === TEAM_BLUE ? '🔵 ' : '🪪 ';
            let actionHtml = '';
            if (connected) {
              actionHtml = `<button type="button" class="nv-btn nv-btn-primary" style="padding:0.2rem 0.48rem;font-size:0.65rem;" data-open-dm="${r.idLow}">💬 Direct Msg</button>`;
            } else if (incoming) {
              actionHtml = `<button type="button" class="nv-btn nv-btn-emerald" style="padding:0.2rem 0.48rem;font-size:0.65rem;" data-accept-id="${r.idLow}">✓ Accept &amp; Msg</button>`;
            } else if (outgoing) {
              actionHtml = `<span style="color:#fcd34d;font-size:0.62rem;font-weight:700;" title="Waiting for this Captain to click ✓ Accept to unlock 1-on-1 Direct Comms">⏳ Awaiting Accept</span>`;
            } else {
              actionHtml = `<button type="button" class="nv-btn nv-btn-emerald" style="padding:0.2rem 0.48rem;font-size:0.65rem;" data-connect-id="${r.idLow}">🤝 Connect</button>`;
            }
            return `
              <div class="nv-cap-row">
                <div>
                  <div style="font-weight:800;color:${connected ? '#fde047' : '#e2e8f0'};">
                    ${teamDot}${connected ? '★ ' : ''}${escapeSocialHtml(r.label)}
                  </div>
                  <div style="font-size:0.62rem;color:#94a3b8;">
                    Trust ${r.trust} ${r.team !== null ? `• ${r.kills} Sinks` : '• Subnet Guild'} ${connected ? '• Connected Ally' : ''}
                  </div>
                </div>
                ${actionHtml}
              </div>
            `;
          })
          .join('')
      : `<div style="color:#64748b;padding:0.5rem;">Waiting for Captains on Subnet 1…</div>`;
    return;
  }

  // `dm` tab: Direct 1-on-1 Comms OR Fleet Wall
  const allies = Array.from(fleetSocial.connectedIds);
  if (app.dmMode === 'dm' && (!app.activeDmPeerId || !fleetSocial.connectedIds.has(app.activeDmPeerId))) {
    app.activeDmPeerId = allies[0] || '';
  }

  el.socialPeerSelectRow.style.display = 'flex';
  el.socialPeerSelectRow.innerHTML = `
    <button type="button" class="nv-btn ${app.dmMode === 'dm' ? 'nv-btn-primary' : ''}" style="padding:0.18rem 0.45rem;font-size:0.65rem;" data-dm-mode="dm">
      💬 1-on-1 DMs (${allies.length})
    </button>
    <button type="button" class="nv-btn ${app.dmMode === 'wall' ? 'nv-btn-primary' : ''}" style="padding:0.18rem 0.45rem;font-size:0.65rem;" data-dm-mode="wall">
      📰 Fleet Wall (${fleetSocial.feedSnap.posts.length})
    </button>
    ${
      app.dmMode === 'dm' && allies.length > 0
        ? `<select id="dmPeerSelect" class="nv-select mono" style="flex:1;min-width:110px;font-size:0.66rem;padding:0.18rem 0.35rem;">
            ${allies
              .map(
                (aid) =>
                  `<option value="${aid}" ${aid === app.activeDmPeerId ? 'selected' : ''}>★ ${escapeSocialHtml(labelForSocialAuthor(aid))}</option>`
              )
              .join('')}
          </select>`
        : ''
    }
  `;

  el.socialPeerSelectRow.querySelector('#dmPeerSelect')?.addEventListener('change', (ev) => {
    app.activeDmPeerId = ev.target.value;
    pollFleetSocialState();
  });

  if (app.dmMode === 'wall') {
    el.socialComposerForm.style.display = 'flex';
    el.socialMsgInput.placeholder = 'Publish an update to the Subnet 1 Fleet Wall…';
    const byUid = new Map((fleetSocial.charterSnap?.members || []).map((m) => [m.uid, m]));
    el.socialBodyBox.innerHTML = fleetSocial.feedSnap.posts.length
      ? fleetSocial.feedSnap.posts
          .map((p) => {
            const authorMem = byUid.get(p.authorUid);
            const authorLabel = authorMem
              ? labelForSocialAuthor(authorMem.identityAddr)
              : `Member #${p.authorUid}`;
            return `
              <div class="nv-msg-bubble">
                <div style="display:flex;justify-content:space-between;font-size:0.64rem;color:#94a3b8;margin-bottom:3px;">
                  <strong style="color:#fde047;">⚓ ${escapeSocialHtml(authorLabel)}</strong>
                  <span>Blk #${p.createdBlock} • ❤️ ${p.likeCount}</span>
                </div>
                <div style="color:#f8fafc;">${escapeSocialHtml(p.content)}</div>
              </div>
            `;
          })
          .join('')
      : `<div style="color:#64748b;padding:0.5rem;">No Fleet Wall posts yet — share the first battle dispatch!</div>`;
  } else {
    if (!allies.length) {
      el.socialComposerForm.style.display = 'none';
      const pendingList = Array.from(fleetSocial.outgoingIds).map((pid) =>
        escapeSocialHtml(labelForSocialAuthor(pid))
      );
      el.socialBodyBox.innerHTML = pendingList.length
        ? `<div style="color:#fde68a;padding:0.6rem;line-height:1.5;">
            ⏳ <strong>Awaiting ✓ Accept from:</strong> ${pendingList.join(', ')}<br/>
            <span style="color:#cbd5e1;">1-on-1 Direct Messaging unlocks automatically as soon as they click <strong>✓ Accept &amp; Msg</strong> on their banner (AI Captains accept within 1 block; meanwhile you can hail human Captains on <strong>🌐 Bridge</strong>!).</span>
          </div>`
        : `<div style="color:#94a3b8;padding:0.6rem;line-height:1.45;">
            🤝 Open the <strong>Captains</strong> tab and click <strong>Connect</strong> next to any Captain (AI Captains accept within 1 block!) to unlock protected 1-on-1 Direct Comms on <code>SocialFeed</code>.
          </div>`;
    } else {
      el.socialComposerForm.style.display = 'flex';
      el.socialMsgInput.placeholder = `Direct message ★ ${labelForSocialAuthor(app.activeDmPeerId)}…`;
      el.socialBodyBox.innerHTML = fleetSocial.dmMsgs.length
        ? fleetSocial.dmMsgs
            .map((m) => {
              const isMine = myIdLow && m.authorAddr === myIdLow;
              return `
                <div class="nv-msg-bubble ${isMine ? 'mine' : ''}">
                  <div style="display:flex;justify-content:space-between;font-size:0.64rem;color:#94a3b8;margin-bottom:2px;">
                    <strong style="color:${isMine ? '#6ee7b7' : '#fde047'};">
                      ${escapeSocialHtml(labelForSocialAuthor(m.authorAddr))}
                    </strong>
                    <span>Blk #${m.block}</span>
                  </div>
                  <div style="color:#f1f5f9;word-break:break-word;">${escapeSocialHtml(m.text)}</div>
                </div>
              `;
            })
            .join('')
        : `<div style="color:#64748b;padding:0.5rem;">Connected with ★ ${escapeSocialHtml(labelForSocialAuthor(app.activeDmPeerId))}! Send the first encrypted-channel DM below.</div>`;
      el.socialBodyBox.scrollTop = el.socialBodyBox.scrollHeight;
    }
  }
}

// ---------------------------------------------------------------------------
// Join Modal & Starter Shipyard UI
// ---------------------------------------------------------------------------

function renderJoinModal() {
  if (!hasDom) return;
  const liveRed = app.rpcState ? app.rpcState.redCount : 0;
  const liveBlue = app.rpcState ? app.rpcState.blueCount : 0;

  el.redCountSub.textContent = `Live Captains: ${liveRed}`;
  el.blueCountSub.textContent = `Live Captains: ${liveBlue}`;

  const curView = getActiveView();
  const isRestartMode = Boolean(curView?.me?.isGameOver);

  if (isRestartMode) {
    app.preferredTeam = curView.me.team;
    el.btnPickRed.disabled = true;
    el.btnPickBlue.disabled = true;
    const halved = Math.floor(curView.me.score / 2);
    el.teamBalanceHint.textContent = `💀 GAME OVER RESTART — Score ${curView.me.score.toLocaleString()} → ${halved.toLocaleString()} pts (-50%) • Peak ${curView.me.bestScore.toLocaleString()} pts preserved!`;
    if (!app.rpcBusy && el.btnLaunchBattle) {
      el.btnLaunchBattle.textContent = '🔄 Start Anew (1,000 CR • -50% Current Score) →';
    }
  } else if (liveRed > liveBlue) {
    app.preferredTeam = TEAM_BLUE;
    el.btnPickRed.disabled = true;
    el.btnPickBlue.disabled = false;
    el.teamBalanceHint.textContent = '⚖ Red has +1 captain — auto-balancing you to Blue Coalition!';
    if (!app.rpcBusy && el.btnLaunchBattle) {
      el.btnLaunchBattle.textContent = '⚓ Sign & Deploy Fleet on Subnet 1 →';
    }
  } else if (liveBlue > liveRed) {
    app.preferredTeam = TEAM_RED;
    el.btnPickBlue.disabled = true;
    el.btnPickRed.disabled = false;
    el.teamBalanceHint.textContent = '⚖ Blue has +1 captain — auto-balancing you to Red Armada!';
    if (!app.rpcBusy && el.btnLaunchBattle) {
      el.btnLaunchBattle.textContent = '⚓ Sign & Deploy Fleet on Subnet 1 →';
    }
  } else {
    el.btnPickRed.disabled = false;
    el.btnPickBlue.disabled = false;
    el.teamBalanceHint.textContent = 'Teams balanced — choose either Armada!';
    if (!app.rpcBusy && el.btnLaunchBattle) {
      el.btnLaunchBattle.textContent = '⚓ Sign & Deploy Fleet on Subnet 1 →';
    }
  }

  el.btnPickRed.classList.toggle('active-red', app.preferredTeam === TEAM_RED);
  el.btnPickBlue.classList.toggle('active-blue', app.preferredTeam === TEAM_BLUE);

  let spent = 0;
  for (const cid of app.starterLoadout) {
    if (cid >= 0) spent += HULL_CLASSES[cid].cost;
  }
  const spare = STARTING_CREDITS - spent;
  el.loadoutBudgetText.textContent = `Cost: ${spent} CR • Spare Credits: ${spare} CR`;
  el.loadoutBudgetText.style.color = spare >= 0 ? '#6ee7b7' : '#fca5a5';
  if (!app.rpcBusy) {
    el.btnLaunchBattle.disabled = spare < 0 || app.starterLoadout.every((c) => c < 0);
  }

  el.loadoutSlotsGrid.innerHTML = [0, 1, 2]
    .map((slot) => {
      const curCid = app.starterLoadout[slot];
      return `<div style="background:#0d1a30;border:1px solid #22385e;border-radius:0.55rem;padding:0.6rem;">
        <div class="mono" style="font-size:0.7rem;color:#7dd3fc;font-weight:700;margin-bottom:0.35rem;">
          SHIP SLOT [${slot + 1}]
        </div>
        <select class="nv-select" data-loadout-slot="${slot}" style="width:100%;">
          <option value="-1" ${curCid === -1 ? 'selected' : ''}>— Keep Empty (0 CR) —</option>
          ${HULL_CLASSES.filter((h) => h.cost <= 1000)
            .map(
              (h) =>
                `<option value="${h.id}" ${curCid === h.id ? 'selected' : ''}>${h.icon} ${h.short} (${h.len}×${h.wid} • ${h.cost} CR)</option>`
            )
            .join('')}
        </select>
        ${
          curCid >= 0
            ? `<div style="font-size:0.67rem;color:#94a3b8;margin-top:0.35rem;">
                Max Speed: <strong style="color:#6ee7b7;">${HULL_CLASSES[curCid].maxSpeed} sq</strong> • Hull: <strong>${HULL_CLASSES[curCid].cells} sq</strong> • Mount: <strong>${HULL_CLASSES[curCid].mountLabel}</strong>
              </div>`
            : `<div style="font-size:0.67rem;color:#64748b;margin-top:0.35rem;">Save CR for Gun/Turbine upgrades!</div>`
        }
      </div>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Camera Fit & Pan Helpers
// ---------------------------------------------------------------------------

function resizeCanvasIfNeeded() {
  if (!hasDom) return;
  const rect = el.canvasWrap.getBoundingClientRect();
  const w = Math.max(240, Math.floor(rect.width));
  const h = Math.max(150, Math.floor(rect.height));
  if (el.oceanCanvas.width !== w || el.oceanCanvas.height !== h) {
    el.oceanCanvas.width = w;
    el.oceanCanvas.height = h;
  }
}

function getMinFitTilePx(gridW, gridH) {
  resizeCanvasIfNeeded();
  const availW = Math.max(180, el.oceanCanvas.width - 4);
  const availH = Math.max(120, el.oceanCanvas.height - 4);
  return Math.min(availW / Math.max(1, gridW), availH / Math.max(1, gridH));
}

function clampCamera(W, H, gridW, gridH) {
  const availW = Math.max(180, W - 4);
  const availH = Math.max(120, H - 4);
  const minFit = Math.min(availW / Math.max(1, gridW), availH / Math.max(1, gridH));
  if (app.cam.autoFit || app.cam.tilePx <= minFit * 1.01) {
    app.cam.autoFit = true;
    app.cam.tilePx = minFit;
  }

  const visW = W / app.cam.tilePx;
  const visH = H / app.cam.tilePx;

  app.cam.cx =
    visW >= gridW ? gridW / 2 : Math.max(visW / 2, Math.min(gridW - visW / 2, app.cam.cx));
  app.cam.cy =
    visH >= gridH ? gridH / 2 : Math.max(visH / 2, Math.min(gridH - visH / 2, app.cam.cy));
}

function fitBoardToWidget() {
  if (!hasDom) return;
  const v = getActiveView();
  const gw = v ? v.gridW : 48;
  const gh = v ? v.gridH : 30;
  app.cam.autoFit = true;
  app.cam.tilePx = getMinFitTilePx(gw, gh);
  app.cam.cx = gw / 2;
  app.cam.cy = gh / 2;
}

function centerCameraOnSlot(slotIdx) {
  const v = getActiveView();
  if (!v) return;
  const sh = v.myShips[slotIdx];
  if (sh && sh.alive) {
    const { cx, cy } = shipCenter(sh);
    app.cam.cx = cx;
    app.cam.cy = cy;
  } else {
    app.cam.cx = v.gridW / 2;
    app.cam.cy = v.gridH / 2;
  }
  resizeCanvasIfNeeded();
  clampCamera(el.oceanCanvas.width, el.oceanCanvas.height, v.gridW, v.gridH);
}

// ---------------------------------------------------------------------------
// Right Sidebar: 3 Ship Slot Cards (`100%` Square Integrity, Turbines, Guns, Repairs)
// ---------------------------------------------------------------------------

function renderSidebarAndHud() {
  if (!hasDom) return;
  const v = getActiveView();
  if (!v) return;

  el.scoreRedBadge.textContent = `🔴 RED: ${v.redKills} Sinks (${v.redCount}p)`;
  el.scoreBlueBadge.textContent = `🔵 BLUE: ${v.blueKills} Sinks (${v.blueCount}p)`;
  el.gridSizeBadge.textContent = `🌊 ${v.gridW}×${v.gridH} (${v.playerCount}/100p)`;
  if (el.blockTickBadge) el.blockTickBadge.textContent = `Blk #${v.blockNumber}`;
  app.chainBar?.refresh?.();

  const isRed = v.me.team === TEAM_RED;
  const myIdRec = slxWallet.getIdentityRecord();
  const myBadgeName = myIdRec?.nickname
    ? `${myIdRec.nickname} · ${truncAddr4(myWallet.addr)}`
    : v.me.joined
      ? formatCaptainVesselLabel(v.me.pid)
      : `Wallet · ${truncAddr4(myWallet.addr)}`;
  el.myTeamBadge.className = `nv-badge ${isRed ? 'nv-badge-red' : 'nv-badge-blue'} mono`;
  el.myTeamBadge.textContent = isRed ? '🔴 RED ARMADA' : '🔵 BLUE COALITION';
  el.myPidLabel.textContent = v.me.joined ? myBadgeName : `${myBadgeName} (Spectating)`;
  el.myCreditsText.textContent = v.me.credits.toLocaleString();
  if (el.myBestScoreText) {
    el.myBestScoreText.textContent = `🏆 HIGH: ${v.me.bestScore.toLocaleString()} pts${v.me.restarts > 0 ? ` (↻${v.me.restarts})` : ''}`;
  }
  el.myScoreText.textContent = `${v.me.score.toLocaleString()} pts`;
  el.myKillsText.textContent = `${v.me.kills} Ship${v.me.kills === 1 ? '' : 's'} Sunk`;
  el.shotsCountBadge.textContent = `${v.totalShotsFired} salvos`;
  if (el.btnOpenJoinModal) {
    el.btnOpenJoinModal.textContent = v.me.isGameOver
      ? '🔄 Game Over — Start Anew'
      : v.me.joined
        ? '⚓ Fleet Roster'
        : '⚓ Squadron / Join Battle';
  }

  renderRoundQueueBar();
  renderLeaderboardPane();
  updateNavalCoach(v);

  if (el.gameOverBanner) {
    const activeLoss =
      app.lastMyLossAlert && app.lastMyLossAlert.until > Date.now() ? app.lastMyLossAlert : null;
    if (v.me.isGameOver) {
      const nextScore = Math.floor(v.me.score / 2);
      const lossLine = app.lastMyLossAlert
        ? `<div style="font-size:0.7rem;color:#fecaca;background:rgba(0,0,0,0.28);padding:0.32rem 0.48rem;border-radius:0.4rem;">☠ Final blow: Slot [${app.lastMyLossAlert.slot}] sunk by <strong>${escapeSocialHtml(app.lastMyLossAlert.killerLabel)}</strong> via <em>${escapeSocialHtml(app.lastMyLossAlert.cause)}</em> (Blk #${app.lastMyLossAlert.blk})</div>`
        : '';
      el.gameOverBanner.style.display = 'block';
      el.gameOverBanner.innerHTML = `
        <div style="background:rgba(127,29,29,0.34);border:1.5px solid #f87171;border-radius:0.65rem;padding:0.68rem 0.78rem;display:flex;flex-direction:column;gap:0.42rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong class="mono" style="color:#fecaca;font-size:0.78rem;">💀 GAME OVER — SQUADRON LOST</strong>
            <span class="nv-badge nv-badge-amber mono">🏆 Peak: ${v.me.bestScore.toLocaleString()} pts</span>
          </div>
          ${lossLine}
          <div style="font-size:0.7rem;color:#e2e8f0;line-height:1.38;">
            All 3 vessels are sunk and warchest (<code>${v.me.credits} CR</code>) is below <code>200 CR</code>. Your <strong>Peak High Score (${v.me.bestScore.toLocaleString()} pts)</strong> is locked onto the Leaderboard!
          </div>
          <button type="button" id="btnStartAnewInline" class="nv-btn nv-btn-emerald mono" style="width:100%;justify-content:center;padding:0.46rem;font-weight:800;">
            🔄 Start Anew (1,000 CR • Score ${v.me.score.toLocaleString()} &rarr; ${nextScore.toLocaleString()} pts [-50%])
          </button>
        </div>
      `;
      el.gameOverBanner.querySelector('#btnStartAnewInline')?.addEventListener('click', () => {
        app.joinModalOpen = true;
        el.joinModal.classList.add('open');
        renderJoinModal();
      });
    } else if (activeLoss) {
      el.gameOverBanner.style.display = 'block';
      el.gameOverBanner.innerHTML = `
        <div style="background:rgba(127,29,29,0.38);border:1.5px solid #fb7185;border-radius:0.6rem;padding:0.52rem 0.68rem;font-size:0.71rem;color:#fecdd3;line-height:1.38;">
          ☠ <strong>VESSEL SUNK (Blk #${activeLoss.blk})</strong>: Slot [${activeLoss.slot}] destroyed by <strong>${escapeSocialHtml(activeLoss.killerLabel)}</strong> via <em>${escapeSocialHtml(activeLoss.cause)}</em>!
        </div>
      `;
    } else {
      el.gameOverBanner.style.display = 'none';
      el.gameOverBanner.innerHTML = '';
    }
  }

  const selShip = getEffectiveShipForRound(v.myShips[app.selectedSlot]);
  el.selectedShipHint.textContent =
    selShip && selShip.docked
      ? `Selected: [${app.selectedSlot + 1}] ${HULL_CLASSES[selShip.classId].short} • ⚓ Docked in Naval Base (100% Safe — Click 🚀 Sortie to Resume)`
      : selShip && selShip.recalling
        ? `Selected: [${app.selectedSlot + 1}] ${HULL_CLASSES[selShip.classId].short} • 📡 Towing to Naval Base (${selShip.recallBlocksLeft} blk left — Stay Unhit!)`
        : selShip && selShip.alive
          ? `Selected: [${app.selectedSlot + 1}] ${HULL_CLASSES[selShip.classId].short} (Range ${effectiveMaxSpeed(selShip)} sq • Gun Rng ${WEAPONS[selShip.gunId].range})`
          : v.me.isGameOver
            ? '💀 GAME OVER — Click "Start Anew" to re-deploy with 1,000 CR (-50% Current Score)!'
            : v.me.joined
              ? `Selected: Slot [${app.selectedSlot + 1}] (Empty — Commission Below!)`
              : 'Deploy Squadron to Command Ships!';

  // Compact 3-Slot Squadron Selector Strip (All 3 slots visible side-by-side without scrolling!)
  const pendHeal = app.pendingActions.get('heal');
  const pendEng = app.pendingActions.get('upgradeEngine');
  const pendGun = app.pendingActions.get('upgradeGun');
  const pendBuy = app.pendingActions.get('purchase');

  el.shipSlotsContainer.innerHTML = [0, 1, 2]
    .map((slot) => {
      const sh = v.myShips[slot];
      const isSel = app.selectedSlot === slot;

      if (!sh || !sh.exists) {
        const buildingHere = pendBuy && pendBuy.slotIdx === slot;
        return `<div class="nv-squad-mini-card empty ${isSel ? 'selected' : ''}" data-select-slot="${slot}">
          <div style="display:flex;justify-content:space-between;align-items:center;" class="mono">
            <strong style="font-size:0.71rem;color:${isSel ? '#fde047' : '#94a3b8'};">[${slot + 1}] Empty</strong>
            <span style="font-size:0.62rem;color:${buildingHere ? '#38bdf8' : '#64748b'};">${buildingHere ? '⚓⏳' : 'Berth'}</span>
          </div>
          <div class="mono" style="font-size:0.62rem;color:${buildingHere ? '#7dd3fc' : '#64748b'};margin-top:2px;">
            ${buildingHere ? 'Building hull…' : v.me.isGameOver ? 'Game Over' : '+ Commission'}
          </div>
        </div>`;
      }

      const effSh = getEffectiveShipForRound(sh);
      const meta = HULL_CLASSES[sh.classId];
      const gun = WEAPONS[effSh.gunId];
      const maxSpd = effectiveMaxSpeed(effSh);

      let destroyedCount = 0;
      for (let i = 0; i < meta.cells; i++) {
        if ((sh.cellDmg[i] || 0) >= 100) destroyedCount += 1;
      }
      const intactCount = meta.cells - destroyedCount;

      const miniBar = Array.from({ length: meta.cells })
        .map((_, idx) => {
          const hit = (sh.cellDmg[idx] || 0) >= 100;
          return `<span style="flex:1;height:6px;border-radius:2px;background:${hit ? '#dc2626' : sh.docked ? '#38bdf8' : '#10b981'};"></span>`;
        })
        .join('');

      const activeBadges = [
        sh.docked ? '⚓SAFE' : '',
        sh.recalling ? `📡${sh.recallBlocksLeft}b` : '',
        app.pendingMoves.has(slot) ? '🧭' : '',
        app.pendingFires.some((f) => f.slotIdx === slot) ? '🎯' : '',
        pendHeal?.slotIdx === slot ? '🔧' : '',
        pendEng?.slotIdx === slot ? '⚡' : '',
        pendGun?.slotIdx === slot ? '🔫' : '',
      ]
        .filter(Boolean)
        .join('');

      return `<div class="nv-squad-mini-card ${isSel ? 'selected' : ''}" data-select-slot="${slot}" style="${sh.docked ? 'border-color:rgba(56,189,248,0.65);background:rgba(8,47,73,0.45);' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:2px;">
          <strong style="font-size:0.73rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${isSel ? '#fde047' : '#f1f5f9'};">
            [${slot + 1}] ${meta.icon} ${meta.short}
          </strong>
          <span class="mono" style="font-size:0.62rem;color:${sh.docked ? '#67e8f9' : sh.recalling ? '#fde047' : destroyedCount > 0 ? '#fca5a5' : '#6ee7b7'};">
            ${activeBadges || `${intactCount}/${meta.cells}`}
          </span>
        </div>
        <div style="display:flex;gap:2px;">${miniBar}</div>
        <div class="mono" style="display:flex;justify-content:space-between;font-size:0.6rem;color:#94a3b8;">
          <span>${sh.docked ? '⚓Harbor' : sh.recalling ? '📡Towing' : `⚡${maxSpd}sq`}</span>
          <span>🔫R${gun.range}</span>
        </div>
      </div>`;
    })
    .join('');

  renderRoundActionDeck(v);
  el.combatFeedBox.innerHTML = app.feedLogs.slice(0, 18).join('');
}

/**
 * Unified "Round Action Deck" — surfaces ALL 6 parallel round action types in a single panel so
 * players immediately see everything they can combine in the current round (1 tx per action type):
 *  - Map Cursor Modes: `🧭 Maneuver` & `🎯 Salvo Fire`
 *  - Direct 1-Click Ship & Shipyard Actions: `🔧 Hull Repair`, `⚡ Turbines`, `🔫 Ordnance`, `⚓ Shipyard`
 */
function renderRoundActionDeck(viewArg = null) {
  if (!hasDom || !el.roundActionDeck) return;
  const v = viewArg || getActiveView();
  if (!v || !v.me.joined) {
    el.roundActionDeck.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
        <strong class="mono" style="font-size:0.74rem;color:#7dd3fc;">👁️ SPECTATING LIVE BATTLE</strong>
        <span class="mono" style="font-size:0.62rem;color:#6ee7b7;">0 Identity Required to Watch</span>
      </div>
      <div style="font-size:0.69rem;color:#cbd5e1;line-height:1.42;">
        Watching live on-chain salvos in real time. Ready to command your own 3-vessel squadron?
      </div>
      <button type="button" data-deck-open-join="1" class="nv-btn nv-btn-emerald mono" style="width:100%;justify-content:center;padding:0.46rem 0.65rem;font-weight:800;font-size:0.74rem;margin-top:0.2rem;">
        🚀 Join Battle &amp; Deploy Squadron →
      </button>
    `;
    el.roundActionDeck.querySelector('[data-deck-open-join]')?.addEventListener('click', () => {
      app.joinModalOpen = true;
      el.joinModal.classList.add('open');
      renderJoinModal();
    });
    return;
  }

  const targeting = isTargetingMode();
  const movePend = app.pendingActions.get('move');
  const firePend = app.pendingActions.get('fire');
  const healPend = app.pendingActions.get('heal');
  const engPend = app.pendingActions.get('upgradeEngine');
  const gunPend = app.pendingActions.get('upgradeGun');
  const buyPend = app.pendingActions.get('purchase');
  const basePend = app.pendingActions.get('baseOps');
  const inFlightCount = [
    'move',
    'fire',
    'heal',
    'upgradeEngine',
    'upgradeGun',
    'purchase',
    'baseOps',
  ].filter((k) => app.pendingActions.has(k)).length;

  const selSlot = app.selectedSlot;
  const rawSel = v.myShips[selSlot];
  const selExists = Boolean(rawSel && rawSel.exists);
  const selAlive = Boolean(rawSel && rawSel.alive);
  const selDocked = Boolean(rawSel && rawSel.docked);
  const selRecalling = Boolean(rawSel && rawSel.recalling);
  const effSel = selExists ? getEffectiveShipForRound(rawSel) : null;

  const atSeaShips = v.myShips.filter((s) => s && s.alive && !s.recalling);
  const recallingShips = v.myShips.filter((s) => s && s.recalling);
  const dockedShips = v.myShips.filter((s) => s && s.docked);
  const selInHarbor = selAlive && shipInFriendlyBase(rawSel, v.gridW, v.gridH);

  // Smart Repair Target: prefer selected ship if damaged; otherwise auto-offer any damaged wingman (including drydocked!)
  let healTargetSlot = selSlot;
  let healDestroyed = 0;
  for (const candSlot of [selSlot, 0, 1, 2]) {
    const s = v.myShips[candSlot];
    if (!s || !s.exists) continue;
    const total = HULL_CLASSES[s.classId].cells;
    let dmg = 0;
    for (let i = 0; i < total; i++) if ((s.cellDmg[i] || 0) >= 100) dmg += 1;
    if (dmg > 0) {
      healTargetSlot = candSlot;
      healDestroyed = dmg;
      break;
    }
  }
  const repairableSq = Math.min(healDestroyed, Math.floor(v.me.credits / REPAIR_COST_PER_CELL));
  const repairCost = repairableSq * REPAIR_COST_PER_CELL;
  const canHeal = !healPend && repairCost > 0;

  // Turbine Upgrade for Selected Ship (works at sea OR drydocked!)
  const nextEngCost = selExists && rawSel.armorTier < 2 ? ENGINE_UPGRADE_COST[rawSel.armorTier] : null;
  const canEng = selExists && !engPend && nextEngCost !== null && v.me.credits >= nextEngCost;

  // Ordnance Refit for Selected Ship (works at sea OR drydocked!)
  let draftGunId = selExists ? app.selectedGunDraft.get(selSlot) : undefined;
  if (selExists && (draftGunId === undefined || WEAPONS[draftGunId]?.minClass > rawSel.classId)) {
    // Default dropdown to the next affordable/unowned upgrade if available, else current gun
    const nextW = WEAPONS.find((w) => w.id > effSel.gunId && rawSel.classId >= w.minClass);
    draftGunId = nextW ? nextW.id : effSel.gunId;
  }
  const chosenGun = selExists ? WEAPONS[draftGunId] || WEAPONS[0] : null;
  const canEquipGun =
    selExists &&
    !gunPend &&
    chosenGun &&
    chosenGun.id !== effSel.gunId &&
    rawSel.classId >= chosenGun.minClass &&
    v.me.credits >= chosenGun.cost;

  // Empty Berth for Shipyard Commission (prefer selectedSlot if empty, else first empty slot)
  const emptySlots = [0, 1, 2].filter((s) => !v.myShips[s] || !v.myShips[s].exists);
  const buyTargetSlot = emptySlots.includes(selSlot) ? selSlot : emptySlots[0] ?? -1;

  const pmInfo = movePend ? app.pendingMoves.get(movePend.slotIdx) : null;
  const pfInfo = firePend ? app.pendingFires[0] : null;

  el.roundActionDeck.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;">
      <div>
        <strong class="mono" style="font-size:0.74rem;color:#fde047;">⚡ ROUND ACTION DECK</strong>
        <span class="mono" style="font-size:0.61rem;color:#94a3b8;margin-left:4px;">(Ship [${selSlot + 1}])</span>
      </div>
      <span class="nv-badge ${inFlightCount > 0 ? 'nv-badge-amber' : 'nv-badge-emerald'} mono" style="font-size:0.61rem;">
        ${inFlightCount > 0 ? `⏳ ${inFlightCount}/7 In Flight` : '✓ 7/7 Ready'}
      </span>
    </div>
    <div style="font-size:0.62rem;color:#94a3b8;margin-top:-2px;">
      Combine <strong>1 action of each type</strong> in the same round without waiting for the block!
    </div>

    <!-- 1 & 2: Map-Spatial Actions (Maneuver & Fire Salvo) -->
    <div class="nv-action-map-grid mono">
      <button type="button" class="nv-action-map-tile ${movePend ? 'pending' : !targeting ? 'active-move' : ''}" data-deck-mode="move">
        <div style="display:flex;justify-content:space-between;width:100%;font-size:0.68rem;font-weight:800;">
          <span style="color:${movePend ? '#fde68a' : '#6ee7b7'};">🧭 1. Maneuver</span>
          <span style="font-size:0.59rem;color:#cbd5e1;">${movePend ? 'SAILING' : selDocked ? 'DOCKED' : !targeting ? 'ACTIVE' : 'READY'}</span>
        </div>
        <div style="font-size:0.6rem;color:#cbd5e1;">
          ${
            movePend
              ? `Ship [${movePend.slotIdx + 1}] &rarr; (${pmInfo?.previewX ?? '?'},${pmInfo?.previewY ?? '?'})`
              : selDocked
                ? 'Sortie from Base to sail'
                : selAlive
                  ? `Click Green Circle (${effectiveMaxSpeed(effSel)} sq)`
                  : 'Select alive ship'
          }
        </div>
        ${movePend ? '<div class="nv-inflight-bar"><span></span></div>' : ''}
      </button>

      <button type="button" class="nv-action-map-tile ${firePend ? 'pending' : targeting ? 'active-fire' : ''}" data-deck-mode="fire">
        <div style="display:flex;justify-content:space-between;width:100%;font-size:0.68rem;font-weight:800;">
          <span style="color:${firePend ? '#fde68a' : '#fda4af'};">🎯 2. Fire Salvo</span>
          <span style="font-size:0.59rem;color:#cbd5e1;">${firePend ? 'IN FLIGHT' : selDocked ? 'DOCKED' : selRecalling ? 'TOWING' : targeting ? 'AIMING' : 'READY'}</span>
        </div>
        <div style="font-size:0.6rem;color:#cbd5e1;">
          ${
            firePend
              ? `Shell &rarr; (${pfInfo?.tx ?? '?'},${pfInfo?.ty ?? '?'})`
              : selDocked
                ? 'Sortie from Base to fire'
                : selRecalling
                  ? `Offline during ${rawSel.recallBlocksLeft}b tow`
                  : selAlive
                    ? `${targeting ? 'Click Red Reticle!' : 'Click here or Hold Shift'} (R${WEAPONS[effSel.gunId].range})`
                    : 'Select alive ship'
          }
        </div>
        ${firePend ? '<div class="nv-inflight-bar"><span></span></div>' : ''}
      </button>
    </div>

    <!-- Naval Base Safe Break / Sortie Bar -->
    <div class="nv-action-row ${basePend ? 'pending' : ''} mono" style="flex-direction:column;align-items:stretch;border-color:${dockedShips.length > 0 ? 'rgba(56,189,248,0.55)' : 'rgba(51,65,85,0.85)'};background:${dockedShips.length > 0 ? 'rgba(8,47,73,0.38)' : ''};">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.35rem;">
        <span style="font-size:0.67rem;font-weight:800;color:#67e8f9;">⚓ Naval Base (Take a Break)</span>
        <span style="font-size:0.58rem;color:#94a3b8;">
          ${
            basePend
              ? `⏳ ${basePend.label}…`
              : dockedShips.length > 0
                ? `${dockedShips.length} Safe in Harbor • ${atSeaShips.length + recallingShips.length} At Sea`
                : recallingShips.length > 0
                  ? `📡 ${recallingShips.length} Towing Home (Auto-Docks Unhit)`
                  : v.me.team === TEAM_RED
                    ? 'NW Harbor (0..3, 0..4) • 3-Blk Sea Tow'
                    : `SE Harbor (${v.gridW - 4}..${v.gridW - 1}, ${v.gridH - 5}..${v.gridH - 1})`
          }
        </span>
      </div>
      <div style="font-size:0.59rem;color:#cbd5e1;line-height:1.35;">
        ${
          dockedShips.length > 0 && atSeaShips.length === 0 && recallingShips.length === 0
            ? 'All ships are <strong>100% invulnerable</strong> in Drydock! Close tab safely or click <strong>Sortie All</strong> to resume.'
            : selRecalling
              ? `Ship [${selSlot + 1}] docks automatically in <strong>${rawSel.recallBlocksLeft} blk</strong> if unhit (enemy hits cancel tow).`
              : selInHarbor
                ? `Ship [${selSlot + 1}] is inside Friendly Harbor — <strong>Instant 1-Block Safe Dock</strong> ready!`
                : 'Instant dock inside Harbor, or <strong>3-block (~13s) Out-of-Combat Tow</strong> from open sea (no hits/shots for 3 blks).'
        }
      </div>
      ${
        basePend
          ? '<div class="nv-inflight-bar"><span></span></div>'
          : `<div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:2px;">
              ${
                atSeaShips.length > 0
                  ? `<button type="button" class="nv-btn nv-btn-primary" data-base-op="return-fleet" style="flex:1;justify-content:center;font-size:0.62rem;padding:0.26rem 0.42rem;">
                      ⚓ Return All (${atSeaShips.length})
                    </button>`
                  : ''
              }
              ${
                dockedShips.length > 0
                  ? `<button type="button" class="nv-btn nv-btn-emerald" data-base-op="sortie-fleet" style="flex:1;justify-content:center;font-size:0.62rem;padding:0.26rem 0.42rem;">
                      🚀 Sortie All (${dockedShips.length})
                    </button>`
                  : ''
              }
              ${
                selDocked
                  ? `<button type="button" class="nv-btn nv-btn-amber" data-base-op="sortie-slot:${selSlot}" style="font-size:0.61rem;padding:0.26rem 0.44rem;white-space:nowrap;">
                      🚀 Sortie [${selSlot + 1}]
                    </button>`
                  : selRecalling
                    ? `<button type="button" class="nv-btn" data-base-op="cancel-slot:${selSlot}" style="font-size:0.61rem;padding:0.26rem 0.44rem;white-space:nowrap;border-color:#fda4af;color:#fecdd3;">
                        ✕ Cancel Tow [${selSlot + 1}]
                      </button>`
                    : selAlive
                      ? `<button type="button" class="nv-btn" data-base-op="return-slot:${selSlot}" style="font-size:0.61rem;padding:0.26rem 0.44rem;white-space:nowrap;">
                          ⚓ ${selInHarbor ? `Dock [${selSlot + 1}]` : `Tow [${selSlot + 1}]`}
                        </button>`
                      : ''
              }
            </div>`
      }
    </div>

    <!-- 3: Hull Repair -->
    <div class="nv-action-row ${healPend ? 'pending' : ''} mono">
      <div style="min-width:0;flex:1;">
        <div style="font-size:0.67rem;font-weight:800;color:#6ee7b7;">🔧 3. Hull Repair</div>
        <div style="font-size:0.6rem;color:#94a3b8;">
          ${
            healPend
              ? `Welding Ship [${healPend.slotIdx + 1}] hull plates…`
              : healDestroyed > 0
                ? `Ship [${healTargetSlot + 1}]: ${healDestroyed} sq hit (${REPAIR_COST_PER_CELL} CR/sq)`
                : 'All squadron hulls 100% intact ✓'
          }
        </div>
        ${healPend ? '<div class="nv-inflight-bar"><span></span></div>' : ''}
      </div>
      <button type="button" class="nv-btn ${canHeal ? 'nv-btn-emerald' : ''}" data-repair-slot="${healTargetSlot}" ${canHeal ? '' : 'disabled'} style="font-size:0.65rem;padding:0.28rem 0.52rem;white-space:nowrap;">
        ${
          healPend
            ? '⏳ Welding…'
            : healDestroyed > 0
              ? `Repair ${repairableSq || 1} sq (${(repairableSq || 1) * REPAIR_COST_PER_CELL} CR)`
              : '✓ Intact'
        }
      </button>
    </div>

    <!-- 4: Turbine Range Upgrade -->
    <div class="nv-action-row ${engPend ? 'pending' : ''} mono">
      <div style="min-width:0;flex:1;">
        <div style="font-size:0.67rem;font-weight:800;color:#fcd34d;">⚡ 4. Turbines</div>
        <div style="font-size:0.6rem;color:#94a3b8;">
          ${
            engPend
              ? `Tuning Ship [${engPend.slotIdx + 1}] turbines (+2 sq)…`
              : !selExists
                ? 'Select a vessel [1–3]'
                : nextEngCost !== null
                  ? `Ship [${selSlot + 1}] Tier ${rawSel.armorTier}/2 • ${effectiveMaxSpeed(effSel)} &rarr; ${effectiveMaxSpeed(effSel) + 2} sq`
                  : `Ship [${selSlot + 1}] Max Tier 2/2 (${effectiveMaxSpeed(effSel)} sq) ✓`
          }
        </div>
        ${engPend ? '<div class="nv-inflight-bar"><span></span></div>' : ''}
      </div>
      <button type="button" class="nv-btn ${canEng ? 'nv-btn-amber' : ''}" data-engine-slot="${selSlot}" ${canEng ? '' : 'disabled'} style="font-size:0.65rem;padding:0.28rem 0.52rem;white-space:nowrap;">
        ${engPend ? '⏳ Tuning…' : nextEngCost !== null ? `+2 sq (${nextEngCost} CR)` : '✓ Maxed'}
      </button>
    </div>

    <!-- 5: Ordnance / Turret Upgrade -->
    <div class="nv-action-row ${gunPend ? 'pending' : ''} mono" style="flex-wrap:wrap;">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
        <span style="font-size:0.67rem;font-weight:800;color:#7dd3fc;">🔫 5. Ordnance</span>
        <span style="font-size:0.59rem;color:#94a3b8;">
          ${
            gunPend
              ? `⏳ Refitting Ship [${gunPend.slotIdx + 1}]…`
              : selExists
                ? `Equipped: ${WEAPONS[effSel.gunId].name} (${WEAPONS[effSel.gunId].spreadDesc})`
                : 'Select vessel [1–3]'
          }
        </span>
      </div>
      ${
        gunPend
          ? '<div class="nv-inflight-bar" style="width:100%;"><span></span></div>'
          : selExists
            ? `<div style="display:flex;gap:0.32rem;width:100%;margin-top:2px;">
                <select class="nv-select mono" id="deckGunSelect" data-deck-gun-slot="${selSlot}" style="flex:1;min-width:0;font-size:0.64rem;padding:0.24rem 0.35rem;">
                  ${WEAPONS.map((w) => {
                    const fits = rawSel.classId >= w.minClass;
                    const owned = effSel.gunId === w.id;
                    const tag = owned ? '✓' : !fits ? `🔒 ${w.mountLabel}` : `${w.cost} CR`;
                    return `<option value="${w.id}" ${w.id === draftGunId ? 'selected' : ''} ${!fits ? 'disabled' : ''}>
                      ${w.name} (${w.spreadDesc}, R${w.range}) • ${tag}
                    </option>`;
                  }).join('')}
                </select>
                <button type="button" class="nv-btn ${canEquipGun ? 'nv-btn-primary' : ''}" data-equip-gun="${selSlot}" ${canEquipGun ? '' : 'disabled'} style="font-size:0.65rem;padding:0.26rem 0.5rem;white-space:nowrap;">
                  ${chosenGun && chosenGun.id === effSel.gunId ? 'Equipped' : `Equip${chosenGun ? ` (${chosenGun.cost})` : ''}`}
                </button>
              </div>`
            : ''
      }
    </div>

    <!-- 6: Shipyard Berth Commission -->
    <div class="nv-action-row ${buyPend ? 'pending' : ''} mono" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:0.67rem;font-weight:800;color:#c4b5fd;">⚓ 6. Shipyard</span>
        <span style="font-size:0.59rem;color:#94a3b8;">
          ${
            buyPend
              ? `⏳ Building in Slot [${buyPend.slotIdx + 1}]…`
              : buyTargetSlot >= 0
                ? `Empty Berth: Slot [${buyTargetSlot + 1}]`
                : '✓ All 3/3 Berths Deployed'
          }
        </span>
      </div>
      ${
        buyPend
          ? '<div class="nv-inflight-bar"><span></span></div>'
          : buyTargetSlot >= 0
            ? `<div class="nv-buy-grid" style="margin-top:3px;">
                ${HULL_CLASSES.map((h) => {
                  const canBuy = !buyPend && v.me.credits >= h.cost;
                  return `<button type="button" class="nv-btn ${canBuy ? 'nv-btn-primary' : ''}" data-buy-ship="${buyTargetSlot}:${h.id}" ${canBuy ? '' : 'disabled'} style="justify-content:space-between;font-size:0.62rem;padding:0.25rem 0.4rem;">
                    <span>${h.icon} ${h.short}</span>
                    <span>${h.cost} CR</span>
                  </button>`;
                }).join('')}
              </div>`
            : ''
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 60 FPS Ocean Renderer (Green 8-Way Compass & Move Square vs Red Targeting Square)
// ---------------------------------------------------------------------------

function screenToTile(clientX, clientY) {
  const rect = el.oceanCanvas.getBoundingClientRect();
  const sx = ((clientX - rect.left) / rect.width) * el.oceanCanvas.width;
  const sy = ((clientY - rect.top) / rect.height) * el.oceanCanvas.height;
  const tp = app.cam.tilePx;
  const tx = Math.floor(app.cam.cx + (sx - el.oceanCanvas.width / 2) / tp);
  const ty = Math.floor(app.cam.cy + (sy - el.oceanCanvas.height / 2) / tp);
  return { tx, ty };
}

function tileToScreen(tx, ty) {
  const tp = app.cam.tilePx;
  return {
    sx: el.oceanCanvas.width / 2 + (tx - app.cam.cx) * tp,
    sy: el.oceanCanvas.height / 2 + (ty - app.cam.cy) * tp,
  };
}

function renderOcean(now) {
  if (!hasDom) return;
  resizeCanvasIfNeeded();
  const W = el.oceanCanvas.width;
  const H = el.oceanCanvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#030915';
  ctx.fillRect(0, 0, W, H);

  const v = getActiveView();
  if (!v) return;

  const gw = v.gridW;
  const gh = v.gridH;
  clampCamera(W, H, gw, gh);
  const tp = app.cam.tilePx;
  const origin = tileToScreen(0, 0);

  // 1. Unified Full-Ocean Water Arena Background (No Left/Right Side Restriction!)
  const seaW = gw * tp;
  const seaH = gh * tp;
  ctx.fillStyle = '#07172d';
  ctx.fillRect(origin.sx, origin.sy, seaW, seaH);

  // 2. Grid Lines
  if (tp >= 9) {
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.42)';
    ctx.lineWidth = 1;
    const startX = Math.max(0, Math.floor(app.cam.cx - W / (2 * tp)));
    const endX = Math.min(gw, Math.ceil(app.cam.cx + W / (2 * tp)));
    const startY = Math.max(0, Math.floor(app.cam.cy - H / (2 * tp)));
    const endY = Math.min(gh, Math.ceil(app.cam.cy + H / (2 * tp)));

    for (let x = startX; x <= endX; x++) {
      const px = origin.sx + x * tp;
      ctx.beginPath();
      ctx.moveTo(px, origin.sy + startY * tp);
      ctx.lineTo(px, origin.sy + endY * tp);
      ctx.stroke();
    }
    for (let y = startY; y <= endY; y++) {
      const py = origin.sy + y * tp;
      ctx.beginPath();
      ctx.moveTo(origin.sx + startX * tp, py);
      ctx.lineTo(origin.sx + endX * tp, py);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.strokeRect(origin.sx, origin.sy, seaW, seaH);

  // 2B. Render Red (NW) & Blue (SE) Fortified Naval Bases (Safe Break Drydocks)
  for (const baseTeam of [TEAM_RED, TEAM_BLUE]) {
    const br = navalBaseRect(baseTeam, gw, gh);
    const bw = br.x1 - br.x0 + 1;
    const bh = br.y1 - br.y0 + 1;
    const bp = tileToScreen(br.x0, br.y0);
    const isRed = baseTeam === TEAM_RED;
    const isFriendly = v.me.joined && v.me.team === baseTeam;
    const dockedHere = v.ships.filter((s) => s.docked && s.team === baseTeam).length;
    const myDockedHere = v.myShips.filter((s) => s && s.docked && s.team === baseTeam).length;

    ctx.save();
    ctx.fillStyle = isRed ? 'rgba(153, 27, 27, 0.28)' : 'rgba(30, 58, 138, 0.30)';
    ctx.fillRect(bp.sx, bp.sy, bw * tp, bh * tp);

    // Subtle pier stripes inside harbor
    if (tp >= 10) {
      ctx.strokeStyle = isRed ? 'rgba(248, 113, 113, 0.18)' : 'rgba(96, 165, 250, 0.18)';
      ctx.lineWidth = 1.5;
      for (let py = 1; py < bh; py++) {
        ctx.beginPath();
        ctx.moveTo(bp.sx + 3, bp.sy + py * tp);
        ctx.lineTo(bp.sx + bw * tp - 3, bp.sy + py * tp);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = isFriendly
      ? '#67e8f9'
      : isRed
        ? 'rgba(251, 113, 133, 0.85)'
        : 'rgba(96, 165, 250, 0.85)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = isFriendly ? 2.4 : 1.8;
    ctx.strokeRect(bp.sx + 1, bp.sy + 1, bw * tp - 2, bh * tp - 2);
    ctx.setLineDash([]);

    if (tp >= 9) {
      const title = isRed ? '⚓ RED BASE' : '⚓ BLUE BASE';
      ctx.font = '800 9.5px "JetBrains Mono", monospace';
      const tw = ctx.measureText(title).width;
      const badgeY = isRed ? bp.sy + 3 : bp.sy + bh * tp - 15;
      ctx.fillStyle = 'rgba(4, 10, 20, 0.86)';
      ctx.fillRect(bp.sx + 3, badgeY, tw + 6, 12);
      ctx.fillStyle = isFriendly ? '#67e8f9' : isRed ? '#fca5a5' : '#93c5fd';
      ctx.fillText(title, bp.sx + 6, badgeY + 9.5);

      if (dockedHere > 0 && tp >= 11) {
        const sub =
          myDockedHere > 0 ? `🛡 ${myDockedHere} YOURS SAFE` : `🛡 ${dockedHere} DOCKED`;
        const subW = ctx.measureText(sub).width;
        const subY = isRed ? badgeY + 14 : badgeY - 14;
        ctx.fillStyle = 'rgba(8, 47, 73, 0.9)';
        ctx.fillRect(bp.sx + 3, subY, subW + 6, 12);
        ctx.fillStyle = '#a5f3fc';
        ctx.fillText(sub, bp.sx + 6, subY + 9.5);
      }
    }
    ctx.restore();
  }

  const pulse = 0.5 + 0.5 * Math.sin(now / 150);
  const rawSelShip = v.myShips[app.selectedSlot];
  const selShip = getEffectiveShipForRound(rawSelShip);
  const targeting = isTargetingMode();
  const moveAlreadyPending = app.pendingActions.has('move');
  const fireAlreadyPending = app.pendingActions.has('fire');

  // 3A. GREEN NAVIGATION MODE (Default: Emerald Max-Range Circle + 1-Click Hull Destination!)
  if (selShip && selShip.alive && !targeting && !moveAlreadyPending) {
    const { cx, cy } = shipCenter(selShip);
    const maxRange = effectiveMaxSpeed(selShip);
    const centerPx = tileToScreen(cx + 0.5, cy + 0.5);

    // Emerald Max-Range Circle (mirrors Red Gun-Range Circle!)
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerPx.sx, centerPx.sy, maxRange * tp, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.045)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (app.hoverTile) {
      const { tx, ty } = app.hoverTile;
      if (tx >= 0 && ty >= 0 && tx < gw && ty < gh) {
        const mainPrev = computeDirectMovePreview(selShip, tx, ty, app.moveDirOverride, v);
        if (!mainPrev.isNoop) {
          const [mw, mh] = shipDims(selShip.classId, mainPrev.hullDir);
          const destTopLeft = tileToScreen(mainPrev.destX, mainPrev.destY);
          const destCenterPx = tileToScreen(mainPrev.destX + mw / 2, mainPrev.destY + mh / 2);

          if (mainPrev.inRange) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(centerPx.sx, centerPx.sy);
            ctx.lineTo(destCenterPx.sx, destCenterPx.sy);
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.restore();
          }

          ctx.fillStyle = mainPrev.inRange
            ? `rgba(16, 185, 129, ${0.3 + pulse * 0.16})`
            : 'rgba(148, 163, 184, 0.14)';
          ctx.strokeStyle = mainPrev.inRange ? '#34d399' : 'rgba(52, 211, 153, 0.35)';
          ctx.lineWidth = 2.2;
          ctx.fillRect(destTopLeft.sx, destTopLeft.sy, mw * tp, mh * tp);
          ctx.strokeRect(destTopLeft.sx, destTopLeft.sy, mw * tp, mh * tp);

          // Highlight any overlapping vessel collision squares in pulsing amber!
          if (mainPrev.inRange && mainPrev.collisionSquares.length > 0) {
            ctx.fillStyle = `rgba(245, 158, 11, ${0.45 + pulse * 0.3})`;
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            for (const [ox, oy] of mainPrev.collisionSquares) {
              const cp = tileToScreen(ox, oy);
              ctx.fillRect(cp.sx, cp.sy, tp, tp);
              ctx.strokeRect(cp.sx, cp.sy, tp, tp);
            }
          }

          if (tp >= 11) {
            ctx.fillStyle = !mainPrev.inRange
              ? '#94a3b8'
              : mainPrev.collisionSquares.length > 0
                ? '#fde68a'
                : '#a7f3d0';
            ctx.font = '800 10.5px "JetBrains Mono", monospace';
            const colTag =
              mainPrev.collisionSquares.length > 0
                ? ` • 💥 RAM ${mainPrev.collisionSquares.length} sq`
                : '';
            const label = mainPrev.inRange
              ? `(${mainPrev.destX}, ${mainPrev.destY}) • ${mainPrev.distTiles} sq${colTag}`
              : `Out of Range (Max ${mainPrev.maxRange} sq)`;
            ctx.fillText(label, destTopLeft.sx, destTopLeft.sy - 5);
          }
        }
      }
    }
  }

  // 3B. RED TARGETING MODE (While holding `Shift` / `Space` or toggled!)
  if (selShip && selShip.alive && targeting && !fireAlreadyPending) {
    const { cx, cy } = shipCenter(selShip);
    const gun = WEAPONS[selShip.gunId] || WEAPONS[0];
    const centerPx = tileToScreen(cx + 0.5, cy + 0.5);

    // Crimson/Amber Gun Range Circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerPx.sx, centerPx.sy, gun.range * tp, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.78)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (app.hoverTile) {
      const { tx, ty } = app.hoverTile;
      if (tx >= 0 && ty >= 0 && tx < gw && ty < gh) {
        const inRange = (tx - cx) ** 2 + (ty - cy) ** 2 <= gun.range ** 2;
        const aoe = getImpactCells(selShip.gunId, tx, ty, gw, gh);
        ctx.fillStyle = inRange
          ? `rgba(239, 68, 68, ${0.36 + pulse * 0.18})`
          : 'rgba(148, 163, 184, 0.16)';
        ctx.strokeStyle = inRange ? '#f87171' : 'rgba(248, 113, 113, 0.4)';
        ctx.lineWidth = 2;
        for (const [ix, iy] of aoe) {
          const p = tileToScreen(ix, iy);
          ctx.fillRect(p.sx, p.sy, tp, tp);
          ctx.strokeRect(p.sx, p.sy, tp, tp);
        }
      }
    }
  }

  // 3C. Pending On-Chain Move Berth, Shipyard Drydock & Target Reticles
  const pendBuyRec = app.pendingActions.get('purchase');
  if (pendBuyRec && pendBuyRec.x !== undefined) {
    const [bw, bh] = shipDims(pendBuyRec.classId, pendBuyRec.dir || 0);
    const bp = tileToScreen(pendBuyRec.x, pendBuyRec.y);
    const buildProg = computeAsymptoticProgress(pendBuyRec.startedAt, now, 2500, 0.9);
    ctx.save();
    ctx.fillStyle = 'rgba(14, 116, 144, 0.22)';
    ctx.fillRect(bp.sx, bp.sy, bw * tp, bh * tp);
    ctx.fillStyle = `rgba(56, 189, 248, ${0.32 + pulse * 0.2})`;
    ctx.fillRect(bp.sx, bp.sy, bw * tp * buildProg, bh * tp);
    ctx.strokeStyle = '#38bdf8';
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 2;
    ctx.strokeRect(bp.sx, bp.sy, bw * tp, bh * tp);
    if (tp >= 10) {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = '800 10px "JetBrains Mono", monospace';
      ctx.fillText(`⚓ BUILDING ${HULL_CLASSES[pendBuyRec.classId].short.toUpperCase()}…`, bp.sx, bp.sy - 5);
    }
    ctx.restore();
  }

  for (const [slotIdx, pm] of app.pendingMoves.entries()) {
    const sh = v.myShips[slotIdx];
    if (!sh || !sh.alive) continue;
    const [pw, ph] = shipDims(sh.classId, pm.hullDir);
    const pDest = tileToScreen(pm.previewX, pm.previewY);
    ctx.save();
    ctx.strokeStyle = `rgba(52, 211, 153, ${0.42 + pulse * 0.4})`;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeRect(pDest.sx + 1, pDest.sy + 1, pw * tp - 2, ph * tp - 2);
    ctx.restore();
  }

  // 4. Render All Active Warships (with Smooth Local Cruise + Authoritative Snap + Repair/Refit Overlays!)
  const pendHealRec = app.pendingActions.get('heal');
  const pendEngRec = app.pendingActions.get('upgradeEngine');
  const pendGunRec = app.pendingActions.get('upgradeGun');

  for (const sh of v.ships) {
    if (!sh.alive) continue;
    const isMine = v.me.joined && sh.ownerPid === v.me.pid;
    const isSel = isMine && sh.slotIdx === app.selectedSlot;
    const meta = HULL_CLASSES[sh.classId] || HULL_CLASSES[0];

    let drawX = sh.x;
    let drawY = sh.y;
    let drawDir = sh.dir;
    let isLocallySailing = false;

    if (isMine && app.pendingMoves.has(sh.slotIdx)) {
      const pm = app.pendingMoves.get(sh.slotIdx);
      const t = computeAsymptoticProgress(pm.startedAt, now, 2500, 0.88);
      drawX = pm.fromX + (pm.previewX - pm.fromX) * t;
      drawY = pm.fromY + (pm.previewY - pm.fromY) * t;
      drawDir = t > 0.15 ? pm.hullDir : pm.fromDir;
      isLocallySailing = true;

      // Glowing propeller wake trail behind the sailing vessel!
      const [fw, fh] = shipDims(sh.classId, drawDir);
      const wakeStart = tileToScreen(pm.fromX + fw / 2, pm.fromY + fh / 2);
      const wakeCur = tileToScreen(drawX + fw / 2, drawY + fh / 2);
      ctx.save();
      const grad = ctx.createLinearGradient(wakeStart.sx, wakeStart.sy, wakeCur.sx, wakeCur.sy);
      grad.addColorStop(0, 'rgba(52, 211, 153, 0.04)');
      grad.addColorStop(1, 'rgba(110, 231, 183, 0.72)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(3, tp * 0.45);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wakeStart.sx, wakeStart.sy);
      ctx.lineTo(wakeCur.sx, wakeCur.sy);
      ctx.stroke();
      ctx.restore();
    } else if (app.arrivalSnaps.has(sh.gidx)) {
      const sn = app.arrivalSnaps.get(sh.gidx);
      const u = Math.min(1, Math.max(0, (now - sn.startedAt) / (sn.durationMs || 220)));
      const ease = 1 - (1 - u) * (1 - u);
      drawX = sn.fromX + (sn.toX - sn.fromX) * ease;
      drawY = sn.fromY + (sn.toY - sn.fromY) * ease;
      drawDir = sn.hullDir;
      if (u >= 1) app.arrivalSnaps.delete(sh.gidx);
    }

    const [wCells, hCells] = shipDims(sh.classId, drawDir);
    const topLeft = tileToScreen(drawX, drawY);

    for (let ry = 0; ry < hCells; ry++) {
      for (let rx = 0; rx < wCells; rx++) {
        const cIdx = drawDir === 0 ? ry * meta.len + rx : rx * meta.len + ry;
        const hit = (sh.cellDmg[cIdx] || 0) >= 100;
        const cxPx = topLeft.sx + rx * tp;
        const cyPx = topLeft.sy + ry * tp;

        ctx.fillStyle = hit
          ? '#1e293b'
          : sh.team === TEAM_RED
            ? '#dc2626'
            : '#2563eb';
        ctx.fillRect(cxPx + 1, cyPx + 1, Math.max(2, tp - 2), Math.max(2, tp - 2));

        if (hit && tp >= 11) {
          ctx.fillStyle = '#fca5a5';
          ctx.font = `800 ${Math.max(8, Math.floor(tp * 0.56))}px sans-serif`;
          ctx.fillText('×', cxPx + tp * 0.26, cyPx + tp * 0.73);
        }
      }
    }

    ctx.strokeStyle = isSel
      ? '#fde047'
      : isMine
        ? '#38bdf8'
        : sh.team === TEAM_RED
          ? '#fca5a5'
          : '#93c5fd';
    ctx.lineWidth = isSel ? 2.6 : isMine ? 2 : 1.2;
    ctx.strokeRect(topLeft.sx + 0.5, topLeft.sy + 0.5, wCells * tp - 1, hCells * tp - 1);

    // Live Repair Welding Scan & Sparks (`heal` pending on this ship)
    if (isMine && pendHealRec && pendHealRec.slotIdx === sh.slotIdx) {
      const hullW = wCells * tp;
      const hullH = hCells * tp;
      const scanPhase = 0.5 + 0.5 * Math.sin(now / 190);
      const scanY = topLeft.sy + scanPhase * hullH;
      ctx.save();
      ctx.fillStyle = `rgba(16, 185, 129, ${0.22 + pulse * 0.16})`;
      ctx.fillRect(topLeft.sx, topLeft.sy, hullW, hullH);
      ctx.strokeStyle = '#6ee7b7';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(topLeft.sx - 3, scanY);
      ctx.lineTo(topLeft.sx + hullW + 3, scanY);
      ctx.stroke();
      for (let sp = 0; sp < 4; sp++) {
        const sx = topLeft.sx + ((sp * 0.27 + (now / 420) % 1) % 1) * hullW;
        const sy = topLeft.sy + ((sp * 0.41 + (now / 310) % 1) % 1) * hullH;
        ctx.fillStyle = sp % 2 === 0 ? '#a7f3d0' : '#38bdf8';
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
      if (tp >= 10) {
        ctx.fillStyle = '#6ee7b7';
        ctx.font = '800 9.5px "JetBrains Mono", monospace';
        ctx.fillText('🔧 WELDING…', topLeft.sx, topLeft.sy + hullH + 11);
      }
      ctx.restore();
    }

    // Live Rotating Engineering Gantry Ring (`upgradeGun` or `upgradeEngine` pending on this ship)
    if (
      isMine &&
      ((pendEngRec && pendEngRec.slotIdx === sh.slotIdx) ||
        (pendGunRec && pendGunRec.slotIdx === sh.slotIdx))
    ) {
      const centerScr = tileToScreen(drawX + wCells / 2, drawY + hCells / 2);
      const radiusPx = (Math.max(wCells, hCells) * 0.65 + 0.45) * tp;
      const rot = now / 280;
      const isGun = Boolean(pendGunRec && pendGunRec.slotIdx === sh.slotIdx);
      ctx.save();
      ctx.strokeStyle = isGun ? '#fde047' : '#38bdf8';
      ctx.lineWidth = 2.2;
      for (let seg = 0; seg < 3; seg++) {
        const a0 = rot + (seg * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(centerScr.sx, centerScr.sy, radiusPx, a0, a0 + 1.15);
        ctx.stroke();
      }
      if (tp >= 10) {
        ctx.fillStyle = isGun ? '#fde047' : '#7dd3fc';
        ctx.font = '800 9.5px "JetBrains Mono", monospace';
        ctx.fillText(
          isGun ? '🔫 REFITTING…' : '⚡ TURBINES…',
          topLeft.sx,
          topLeft.sy + hCells * tp + (pendHealRec?.slotIdx === sh.slotIdx ? 22 : 11)
        );
      }
      ctx.restore();
    }

    // Live Pulsing Naval Base Tow Beacon (`sh.recalling`)
    if (sh.recalling) {
      const centerScr = tileToScreen(drawX + wCells / 2, drawY + hCells / 2);
      const radiusPx = (Math.max(wCells, hCells) * 0.62 + 0.35 + pulse * 0.22) * tp;
      ctx.save();
      ctx.strokeStyle = `rgba(103, 232, 249, ${0.55 + pulse * 0.4})`;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(centerScr.sx, centerScr.sy, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Render `<Nickname> · <4-char addr>` (+ `★` Connected Ally badge + live VHF callout!) right beside every vessel!
    if (tp >= 8) {
      const ownerIdLow = (app.rpcPlayers[sh.ownerPid]?.identityAddr || '').toLowerCase();
      const isSocialAlly = ownerIdLow && fleetSocial.connectedIds.has(ownerIdLow);
      const capTag = formatCaptainVesselLabel(sh.ownerPid);
      const allyPrefix = isSocialAlly ? '★ ' : '';
      const sailSuffix = sh.recalling
        ? ` • 📡 TOW ${sh.recallBlocksLeft}B`
        : isLocallySailing
          ? ' • 🧭 SAILING'
          : '';
      const labelTxt = isMine
        ? `[${sh.slotIdx + 1}] ${capTag}${sailSuffix}`
        : `${allyPrefix}${capTag}${sh.recalling ? ` • 📡 TOW ${sh.recallBlocksLeft}B` : ''}`;
      ctx.font = `${isMine || isSocialAlly ? '800' : '700'} 10px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(labelTxt).width;
      const lx = topLeft.sx;
      const ly = topLeft.sy - 4;

      ctx.fillStyle = 'rgba(4, 10, 20, 0.85)';
      ctx.fillRect(lx - 2, ly - 10, tw + 5, 12);
      ctx.fillStyle = isMine
        ? '#fde047'
        : isSocialAlly
          ? '#6ee7b7'
          : sh.team === TEAM_RED
            ? '#fecaca'
            : '#bfdbfe';
      ctx.fillText(labelTxt, lx, ly - 1);

      // Show brief VHF Bridge Radio speech callout above lead ship if transmitted within last 4 blocks
      if (ownerIdLow && sh.slotIdx === 0 && app.rpcBlock > 0) {
        const recentRadio = [...fleetSocial.bridgeMsgs, ...fleetSocial.squadronMsgs]
          .filter((m) => m.authorAddr === ownerIdLow && app.rpcBlock - m.block <= 4)
          .pop();
        if (recentRadio) {
          const snippet =
            recentRadio.text.length > 34 ? `${recentRadio.text.slice(0, 32)}…` : recentRadio.text;
          const radioTxt = `📻 "${snippet}"`;
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          const rw = ctx.measureText(radioTxt).width;
          ctx.fillStyle = 'rgba(6, 78, 59, 0.9)';
          ctx.fillRect(lx - 2, ly - 24, rw + 6, 13);
          ctx.fillStyle = '#a7f3d0';
          ctx.fillText(radioTxt, lx + 1, ly - 14);
        }
      }
    }
  }

  // 4B. Live Slow-Flight Projectiles (`pendingFires`) & Terminal Receipt Sprint (`shellSnapImpacts`)!
  for (const pf of app.pendingFires) {
    const aoe = getImpactCells(pf.gunId, pf.tx, pf.ty, gw, gh);
    const t = computeAsymptoticProgress(pf.startedAt, now, 2200, 0.88);
    const targX = pf.tx + 0.5;
    const targY = pf.ty + 0.5;
    const curX = pf.fromX + (targX - pf.fromX) * t;
    const curY = pf.fromY + (targY - pf.fromY) * t;
    const isTorpedo = pf.gunId === 1;
    const arcLiftTiles = isTorpedo ? 0 : Math.sin(t * Math.PI) * 1.15;

    // Pulsing target-lock AoE cells
    ctx.save();
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.45 + pulse * 0.45})`;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    for (const [ix, iy] of aoe) {
      const p = tileToScreen(ix, iy);
      ctx.strokeRect(p.sx + 2, p.sy + 2, tp - 4, tp - 4);
    }

    // Trajectory smoke / torpedo bubble ribbon
    const pOrig = tileToScreen(pf.fromX, pf.fromY);
    const pHead = tileToScreen(curX, curY - arcLiftTiles);
    const trailGrad = ctx.createLinearGradient(pOrig.sx, pOrig.sy, pHead.sx, pHead.sy);
    trailGrad.addColorStop(0, 'rgba(251, 146, 60, 0.05)');
    trailGrad.addColorStop(1, isTorpedo ? 'rgba(56, 189, 248, 0.88)' : 'rgba(251, 191, 36, 0.9)');
    ctx.setLineDash([]);
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = isTorpedo ? 3.2 : 2.6;
    ctx.beginPath();
    ctx.moveTo(pOrig.sx, pOrig.sy);
    ctx.lineTo(pHead.sx, pHead.sy);
    ctx.stroke();

    // Glowing warhead core
    ctx.beginPath();
    ctx.arc(pHead.sx, pHead.sy, Math.max(4.5, tp * 0.24), 0, Math.PI * 2);
    ctx.fillStyle = isTorpedo ? '#38bdf8' : '#fde047';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = isTorpedo ? '#e0f2fe' : '#ef4444';
    ctx.stroke();
    ctx.restore();
  }

  const remainingSnaps = [];
  for (const si of app.shellSnapImpacts) {
    const u = Math.min(1, Math.max(0, (now - si.startedAt) / (si.durationMs || 160)));
    const curX = si.fromX + (si.toX - si.fromX) * u;
    const curY = si.fromY + (si.toY - si.fromY) * u;
    const pFrom = tileToScreen(si.fromX, si.fromY);
    const pHead = tileToScreen(curX, curY);

    ctx.save();
    ctx.strokeStyle = si.strokeColor || (si.gunId === 1 ? '#38bdf8' : '#fbbf24');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pFrom.sx, pFrom.sy);
    ctx.lineTo(pHead.sx, pHead.sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pHead.sx, pHead.sy, Math.max(5, tp * 0.28), 0, Math.PI * 2);
    ctx.fillStyle = '#fffbeb';
    ctx.fill();
    ctx.restore();

    if (u >= 1) {
      addExplosion(si.aoeCells);
      if (si.impactLabel) {
        addFloatText(si.tx, si.ty - 0.65, si.impactLabel, si.impactColor || '#fbbf24');
      } else if (si.sunk) {
        addFloatText(si.tx, si.ty - 0.8, '💥 ENEMY SHIP SUNK (100%)!', '#6ee7b7');
      } else {
        addFloatText(si.tx, si.ty - 0.5, `💥 SALVO IMPACT (${si.tx}, ${si.ty})`, '#fbbf24');
      }
    } else {
      remainingSnaps.push(si);
    }
  }
  app.shellSnapImpacts = remainingSnaps;

  // 4C. Upgrade / Repair / Commission Confirmation Shockwave Rings
  app.upgradeRings = app.upgradeRings.filter((r) => now - r.createdAt < 780);
  for (const r of app.upgradeRings) {
    const age = (now - r.createdAt) / 780;
    const pc = tileToScreen(r.x + r.w / 2, r.y + r.h / 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pc.sx, pc.sy, (0.5 + age * 2.3) * tp, 0, Math.PI * 2);
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = 1 - age;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.restore();
  }

  // 5. Teleport Wake Trails, Cannon Tracers, Explosions & Floating Text
  app.teleports = app.teleports.filter((t) => now - t.createdAt < 950);
  for (const t of app.teleports) {
    const age = (now - t.createdAt) / 950;
    const pFrom = tileToScreen(t.fromX + t.w / 2, t.fromY + t.h / 2);
    const pTo = tileToScreen(t.toX + t.w / 2, t.toY + t.h / 2);
    ctx.save();
    ctx.strokeStyle = `rgba(52, 211, 153, ${(1 - age) * 0.85})`;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(pFrom.sx, pFrom.sy);
    ctx.lineTo(pTo.sx, pTo.sy);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pTo.sx, pTo.sy, (0.6 + age * 1.8) * tp, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(110, 231, 183, ${1 - age})`;
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  app.tracers = app.tracers.filter((t) => now - t.createdAt < 520);
  for (const t of app.tracers) {
    const age = (now - t.createdAt) / 520;
    const p1 = tileToScreen(t.x1, t.y1);
    const p2 = tileToScreen(t.x2, t.y2);
    ctx.strokeStyle =
      t.team === TEAM_RED
        ? `rgba(251, 113, 133, ${1 - age})`
        : `rgba(96, 165, 250, ${1 - age})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.stroke();
  }

  app.explosions = app.explosions.filter((ex) => now - ex.createdAt < 720);
  for (const ex of app.explosions) {
    const age = (now - ex.createdAt) / 720;
    ctx.fillStyle = `rgba(251, 146, 60, ${(1 - age) * 0.7})`;
    for (const [ix, iy] of ex.cells) {
      const p = tileToScreen(ix, iy);
      ctx.fillRect(p.sx, p.sy, tp, tp);
    }
  }

  app.floatTexts = app.floatTexts.filter((f) => now - f.createdAt < 1550);
  for (const f of app.floatTexts) {
    const age = (now - f.createdAt) / 1550;
    const p = tileToScreen(f.x, f.y - age * 1.4);
    ctx.fillStyle = f.color;
    ctx.globalAlpha = 1 - age;
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.fillText(f.text, p.sx, p.sy);
    ctx.globalAlpha = 1;
  }

  renderMinimap(v, W, H);
}

function renderMinimap(v, viewW, viewH) {
  const mw = el.minimapCanvas.width;
  const mh = el.minimapCanvas.height;
  miniCtx.fillStyle = '#050e1d';
  miniCtx.fillRect(0, 0, mw, mh);

  const gw = v.gridW;
  const gh = v.gridH;
  const scaleX = mw / Math.max(1, gw);
  const scaleY = mh / Math.max(1, gh);

  for (const baseTeam of [TEAM_RED, TEAM_BLUE]) {
    const br = navalBaseRect(baseTeam, gw, gh);
    const bw = (br.x1 - br.x0 + 1) * scaleX;
    const bh = (br.y1 - br.y0 + 1) * scaleY;
    miniCtx.fillStyle =
      baseTeam === TEAM_RED ? 'rgba(239, 68, 68, 0.28)' : 'rgba(59, 130, 246, 0.28)';
    miniCtx.fillRect(br.x0 * scaleX, br.y0 * scaleY, bw, bh);
    miniCtx.strokeStyle = baseTeam === TEAM_RED ? '#fca5a5' : '#93c5fd';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(br.x0 * scaleX, br.y0 * scaleY, bw, bh);
  }

  for (const sh of v.ships) {
    if (!sh.alive) continue;
    const [w, h] = shipDims(sh.classId, sh.dir);
    miniCtx.fillStyle =
      v.me.joined && sh.ownerPid === v.me.pid
        ? '#fde047'
        : sh.team === TEAM_RED
          ? '#ef4444'
          : '#3b82f6';
    miniCtx.fillRect(
      sh.x * scaleX,
      sh.y * scaleY,
      Math.max(2.5, w * scaleX),
      Math.max(2.5, h * scaleY)
    );
  }

  const tilesVisW = viewW / app.cam.tilePx;
  const tilesVisH = viewH / app.cam.tilePx;
  const vx = Math.max(1, (app.cam.cx - tilesVisW / 2) * scaleX);
  const vy = Math.max(1, (app.cam.cy - tilesVisH / 2) * scaleY);
  const vw = Math.min(mw - 2 - vx, tilesVisW * scaleX);
  const vh = Math.min(mh - 2 - vy, tilesVisH * scaleY);
  miniCtx.strokeStyle = '#38bdf8';
  miniCtx.lineWidth = 1.2;
  miniCtx.strokeRect(vx, vy, Math.max(4, vw), Math.max(4, vh));
}

function mainLoop(now) {
  renderOcean(now);
  requestAnimationFrame(mainLoop);
}

// ---------------------------------------------------------------------------
// Input Events (Green Move Mode, Hold-Key Red Targeting Mode, Popover, Sidebar)
// ---------------------------------------------------------------------------

if (hasDom) {
  el.oceanCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  el.cursorModePill.addEventListener('click', () => {
    app.pinnedTargetingMode = false;
    app.keyTargetingHeld = false;
    syncModePillUi();
  });

  el.btnTargetModePill?.addEventListener('click', () => {
    app.pinnedTargetingMode = !app.pinnedTargetingMode;
    syncModePillUi();
  });

  el.btnRotateHull?.addEventListener('click', () => {
    const v = getActiveView();
    const sel = v?.myShips?.[app.selectedSlot];
    const baseDir = sel?.dir || 0;
    app.moveDirOverride =
      app.moveDirOverride === null ? (baseDir === 0 ? 1 : 0) : app.moveDirOverride === 0 ? 1 : 0;
  });

  el.oceanCanvas.addEventListener('pointermove', (e) => {
    if (app.cam.dragging) {
      const dx = (e.clientX - app.cam.dragStartX) / app.cam.tilePx;
      const dy = (e.clientY - app.cam.dragStartY) / app.cam.tilePx;
      app.cam.cx = app.cam.camStartX - dx;
      app.cam.cy = app.cam.camStartY - dy;
      return;
    }

    // Track Shift key synchronously from mouse event too so holding Shift never misses a state change!
    if (e.shiftKey !== app.keyTargetingHeld && !e.target.closest('input,select')) {
      if (e.shiftKey) {
        app.keyTargetingHeld = true;
        syncModePillUi();
      }
    }

    const { tx, ty } = screenToTile(e.clientX, e.clientY);
    app.hoverTile = { tx, ty };

    const v = getActiveView();
    if (!v || tx < 0 || ty < 0 || tx >= v.gridW || ty >= v.gridH) {
      el.hoverTooltip.textContent = 'Outside active ocean bounds';
      return;
    }

    const sel = getEffectiveShipForRound(v.myShips[app.selectedSlot]);

    // Inspect ship under cursor
    for (const sh of v.ships) {
      const cIdx = cellIndexOnShip(sh, tx, ty);
      if (cIdx >= 0) {
        const meta = HULL_CLASSES[sh.classId];
        const gun = WEAPONS[sh.gunId];
        const hit = (sh.cellDmg[cIdx] || 0) >= 100;
        const capTag = formatCaptainVesselLabel(sh.ownerPid);
        el.hoverTooltip.textContent = `${sh.team === TEAM_RED ? '🔴 RED' : '🔵 BLUE'} ${capTag} • ${meta.name} | Square #${cIdx + 1}: ${hit ? 'DESTROYED (100%)' : 'INTACT'} | ${gun.name} | Range ${effectiveMaxSpeed(sh)} sq`;
        return;
      }
    }

    if (isTargetingMode() && sel && sel.alive) {
      const { cx, cy } = shipCenter(sel);
      const gun = WEAPONS[sel.gunId];
      const inRng = (tx - cx) ** 2 + (ty - cy) ** 2 <= gun.range ** 2;
      el.hoverTooltip.textContent = `🔴 TARGETING (${tx}, ${ty}) • ${gun.name} (${gun.spreadDesc}) — ${inRng ? 'Click to Fire (100% Square Hit)!' : `Out of Range (Max ${gun.range} sq)`}`;
      return;
    }

    if (sel && sel.alive) {
      const prev = computeDirectMovePreview(sel, tx, ty, app.moveDirOverride, v);
      if (prev.inEnemyHarbor) {
        el.hoverTooltip.textContent = `⛔ ENEMY NAVAL BASE (${tx}, ${ty}) — Protected opposing harbor; ships cannot enter`;
        return;
      }
      el.hoverTooltip.textContent = prev.inRange
        ? `🟢 MOVE TO (${prev.destX}, ${prev.destY}) • ${prev.distTiles} sq (Max ${prev.maxRange} sq) — Click to Move | R Rotate | Hold Shift/Space to Fire`
        : `⚪ (${prev.destX}, ${prev.destY}) — Outside ${prev.maxRange}-sq Range Circle | Hold Shift/Space to Aim Guns`;
      return;
    }

    const redB = navalBaseRect(TEAM_RED, v.gridW, v.gridH);
    const blueB = navalBaseRect(TEAM_BLUE, v.gridW, v.gridH);
    if (tx >= redB.x0 && tx <= redB.x1 && ty >= redB.y0 && ty <= redB.y1) {
      el.hoverTooltip.textContent = `⚓ RED NAVAL BASE (${tx}, ${ty}) — Safe Break Drydock (Sortie All to resume)`;
      return;
    }
    if (tx >= blueB.x0 && tx <= blueB.x1 && ty >= blueB.y0 && ty <= blueB.y1) {
      el.hoverTooltip.textContent = `⚓ BLUE NAVAL BASE (${tx}, ${ty}) — Safe Break Drydock (Sortie All to resume)`;
      return;
    }

    el.hoverTooltip.textContent = `Ocean Tile (${tx}, ${ty}) • Grid ${v.gridW}×${v.gridH}`;
  });

  el.oceanCanvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1) {
      app.cam.dragging = true;
      app.cam.dragStartX = e.clientX;
      app.cam.dragStartY = e.clientY;
      app.cam.camStartX = app.cam.cx;
      app.cam.camStartY = app.cam.cy;
      return;
    }

    const v = getActiveView();
    if (!v) return;
    const { tx, ty } = screenToTile(e.clientX, e.clientY);
    if (tx < 0 || ty < 0 || tx >= v.gridW || ty >= v.gridH) {
      return;
    }

    // Hold-Key (`Shift` / `Space`) Red Targeting Mode (or Right-Click) -> Fire Weapon!
    if (isTargetingMode() || e.shiftKey || e.button === 2) {
      playerFireSelected(tx, ty);
      return;
    }

    // Clicking a different friendly ship selects that slot!
    for (const myS of v.myShips) {
      if (myS && myS.alive && myS.slotIdx !== app.selectedSlot && cellIndexOnShip(myS, tx, ty) >= 0) {
        app.selectedSlot = myS.slotIdx;
        app.moveDirOverride = null;
        renderSidebarAndHud();
        return;
      }
    }

    const sel = v.myShips[app.selectedSlot];
    if (!sel || !sel.alive) {
      for (const myS of v.myShips) {
        if (myS && myS.alive && cellIndexOnShip(myS, tx, ty) >= 0) {
          app.selectedSlot = myS.slotIdx;
          app.moveDirOverride = null;
          renderSidebarAndHud();
          return;
        }
      }
      return;
    }

    // Default Green Navigation Mode: 1-Click directly moves anywhere inside the vessel's max range circle!
    playerMoveToTile(app.selectedSlot, tx, ty);
  });

  window.addEventListener('pointerup', () => {
    app.cam.dragging = false;
  });

  el.oceanCanvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const v = getActiveView();
      const minFit = getMinFitTilePx(v ? v.gridW : 48, v ? v.gridH : 30);
      const factor = e.deltaY < 0 ? 1.16 : 0.86;
      const next = Math.max(minFit, Math.min(72, app.cam.tilePx * factor));
      app.cam.tilePx = next;
      app.cam.autoFit = next <= minFit * 1.01;
    },
    { passive: false }
  );

  el.minimapCanvas.addEventListener('pointerdown', (e) => {
    const v = getActiveView();
    if (!v) return;
    const rect = el.minimapCanvas.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    app.cam.cx = rx * v.gridW;
    app.cam.cy = ry * v.gridH;
    clampCamera(el.oceanCanvas.width, el.oceanCanvas.height, v.gridW, v.gridH);
  });

  el.btnFitSquare.addEventListener('click', () => {
    fitBoardToWidget();
  });
  el.btnZoomIn.addEventListener('click', () => {
    app.cam.autoFit = false;
    app.cam.tilePx = Math.min(72, app.cam.tilePx * 1.25);
  });
  el.btnZoomOut.addEventListener('click', () => {
    const v = getActiveView();
    const minFit = getMinFitTilePx(v ? v.gridW : 48, v ? v.gridH : 30);
    const next = Math.max(minFit, app.cam.tilePx * 0.8);
    app.cam.tilePx = next;
    app.cam.autoFit = next <= minFit * 1.01;
  });
  el.btnCenterShip.addEventListener('click', () => {
    const v = getActiveView();
    if (!v) return;
    if (app.cam.autoFit) {
      app.cam.autoFit = false;
      app.cam.tilePx = Math.min(56, getMinFitTilePx(v.gridW, v.gridH) * 2.0);
    }
    centerCameraOnSlot(app.selectedSlot);
  });

  // Keyboard Controls: NO WASD / NO Arrow movement!
  // Hold `Shift` or `Space` -> Red Targeting Mode; `R` -> Rotate Hull Orientation; `1 / 2 / 3` -> Select Ship
  window.addEventListener('keydown', (e) => {
    if (
      document.activeElement &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
    ) {
      return;
    }

    if (e.key === 'Shift' || e.code === 'Space') {
      if (e.code === 'Space') e.preventDefault();
      if (!app.keyTargetingHeld) {
        app.keyTargetingHeld = true;
        syncModePillUi();
      }
      return;
    }

    if (e.key === 'Escape') {
      app.moveDirOverride = null;
      app.pinnedTargetingMode = false;
      syncModePillUi();
      return;
    }

    if (app.joinModalOpen) return;

    if (e.code === 'KeyR') {
      const v = getActiveView();
      const sel = v?.myShips?.[app.selectedSlot];
      const baseDir = sel?.dir || 0;
      app.moveDirOverride =
        app.moveDirOverride === null ? (baseDir === 0 ? 1 : 0) : app.moveDirOverride === 0 ? 1 : 0;
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      app.selectedSlot = Number(e.key) - 1;
      app.moveDirOverride = null;
      centerCameraOnSlot(app.selectedSlot);
      renderSidebarAndHud();
    } else if (e.code === 'KeyF') {
      fitBoardToWidget();
    } else if (e.code === 'KeyC') {
      el.btnCenterShip.click();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.code === 'Space') {
      app.keyTargetingHeld = false;
      syncModePillUi();
    }
  });

  window.addEventListener('blur', () => {
    app.keyTargetingHeld = false;
    syncModePillUi();
  });

  // Compact Squadron Strip + Unified Round Action Deck Listeners
  el.shipSlotsContainer.addEventListener('click', (e) => {
    const card = e.target.closest('[data-select-slot]');
    if (card) {
      app.selectedSlot = Number(card.getAttribute('data-select-slot'));
      app.moveDirOverride = null;
      renderSidebarAndHud();
    }
  });

  el.roundActionDeck?.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-deck-gun-slot]');
    if (sel) {
      const slot = Number(sel.getAttribute('data-deck-gun-slot'));
      app.selectedGunDraft.set(slot, Number(sel.value));
      renderRoundActionDeck();
    }
  });

  el.roundActionDeck?.addEventListener('click', (e) => {
    const baseBtn = e.target.closest('[data-base-op]');
    if (baseBtn) {
      const op = baseBtn.getAttribute('data-base-op') || '';
      if (op === 'return-fleet') {
        playerReturnFleetToBase();
      } else if (op === 'sortie-fleet') {
        playerSortieFleetFromBase();
      } else if (op.startsWith('return-slot:')) {
        playerReturnShipToBase(Number(op.split(':')[1]));
      } else if (op.startsWith('sortie-slot:')) {
        playerSortieShipFromBase(Number(op.split(':')[1]));
      } else if (op.startsWith('cancel-slot:')) {
        playerCancelRecall(Number(op.split(':')[1]));
      }
      return;
    }
    const modeBtn = e.target.closest('[data-deck-mode]');
    if (modeBtn) {
      const mode = modeBtn.getAttribute('data-deck-mode');
      app.pinnedTargetingMode = mode === 'fire' ? !app.pinnedTargetingMode : false;
      syncModePillUi();
      return;
    }
    const buyBtn = e.target.closest('[data-buy-ship]');
    if (buyBtn) {
      const [s, cid] = buyBtn.getAttribute('data-buy-ship').split(':').map(Number);
      playerBuyShip(s, cid);
      return;
    }
    const repBtn = e.target.closest('[data-repair-slot]');
    if (repBtn) {
      playerRepairShip(Number(repBtn.getAttribute('data-repair-slot')));
      return;
    }
    const engBtn = e.target.closest('[data-engine-slot]');
    if (engBtn) {
      playerUpgradeEngine(Number(engBtn.getAttribute('data-engine-slot')));
      return;
    }
    const gunBtn = e.target.closest('[data-equip-gun]');
    if (gunBtn) {
      const s = Number(gunBtn.getAttribute('data-equip-gun'));
      const selEl = document.getElementById('deckGunSelect');
      if (selEl) playerUpgradeGun(s, Number(selEl.value));
    }
  });

  // Join Modal & RPC Bar Controls
  el.btnPickRed.addEventListener('click', () => {
    app.preferredTeam = TEAM_RED;
    renderJoinModal();
  });
  el.btnPickBlue.addEventListener('click', () => {
    app.preferredTeam = TEAM_BLUE;
    renderJoinModal();
  });
  el.loadoutSlotsGrid.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-loadout-slot]');
    if (!sel) return;
    app.starterLoadout[Number(sel.getAttribute('data-loadout-slot'))] = Number(sel.value);
    renderJoinModal();
  });
  el.btnLaunchBattle.addEventListener('click', createOrJoinOnChainBattle);
  el.btnOpenJoinModal.addEventListener('click', () => {
    app.joinModalOpen = true;
    el.joinModal.classList.add('open');
    renderJoinModal();
  });
  el.btnCloseJoinModal.addEventListener('click', () => {
    app.joinModalOpen = false;
    el.joinModal.classList.remove('open');
  });

  el.rpcUrlInput.addEventListener('change', () => {
    app.rpcUrl = el.rpcUrlInput.value.trim();
    SlxHfsCache.save({ rpcUrl: app.rpcUrl });
    pollLiveRpcState();
  });
  el.contractAddrInput.addEventListener('change', () => {
    app.contractAddr = el.contractAddrInput.value.trim();
    SlxHfsCache.save({ battleshipAddr: app.contractAddr });
    pollLiveRpcState();
  });
  el.battleIdInput.addEventListener('change', () => {
    app.battleId = el.battleIdInput.value.trim();
    SlxHfsCache.save({ battleId: app.battleId });
    pollLiveRpcState();
  });
  el.btnDeployWasm.addEventListener('click', deployWasmOnNode);
  el.btnRpcCreateOrJoin.addEventListener('click', createOrJoinOnChainBattle);

  async function preloadNavalStateFromCachedNode(overrideEntry = null) {
    try {
      const { cache } = await SlxHfsCache.hydrateWithManifest();
      if (cache.rpcUrl) {
        app.rpcUrl = cache.rpcUrl;
        el.rpcUrlInput.value = app.rpcUrl;
      }
      if (overrideEntry) {
        app.userSelectedHfs = true;
        app.contractAddr = overrideEntry.primaryAddr;
        el.contractAddrInput.value = app.contractAddr;
        if (overrideEntry.meta?.battleId) {
          app.battleId = overrideEntry.meta.battleId;
          el.battleIdInput.value = app.battleId;
        }
      } else if (!app.userSelectedHfs) {
        if (cache.battleshipAddr) {
          app.contractAddr = cache.battleshipAddr;
          el.contractAddrInput.value = app.contractAddr;
        }
        if (cache.battleId) {
          app.battleId = cache.battleId;
          el.battleIdInput.value = app.battleId;
        }
      }
      if (!app.contractAddr || !app.battleId) return false;

      const [blkHex, stHex, plrsHex] = await Promise.all([
        rpcCall('eth_blockNumber'),
        rpcCall('eth_call', [
          { to: app.contractAddr, data: NavalAbi.getBattleState(app.battleId) },
          'latest',
        ]),
        rpcCall('eth_call', [
          { to: app.contractAddr, data: NavalAbi.getPlayersSlice(app.battleId, 0, 100) },
          'latest',
        ]),
      ]);
      const st = decodeBattleStateHex(stHex);
      if (!st) return false;

      app.rpcBlock = Number(BigInt(blkHex));
      app.rpcState = st;
      app.rpcPlayers = decodePlayersSliceHex(plrsHex);
      syncPlayerNicknames();

      fitBoardToWidget();
      renderSidebarAndHud();

      // Spectator-first boot: passively check if this keypair already owns an on-chain Identity HFS
      // without forcing a deployment modal until the user clicks "Join Battle & Deploy Squadron"!
      const idRec =
        (await slxWallet.resolveVerifiedIdentity?.(app.rpcUrl).catch(() => null)) ||
        slxWallet.getIdentityRecord();
      if (idRec?.identityAddr && idRec?.nickname) {
        app.identityNicknames.set(idRec.identityAddr.toLowerCase(), idRec.nickname);
      }

      const myRec = app.rpcPlayers.find(
        (p) => p.addr.toLowerCase() === myWallet.addr.toLowerCase()
      );
      if (myRec) {
        app.joinModalOpen = false;
        el.joinModal.classList.remove('open');
        if (!myRec.identityAddr && idRec?.identityAddr) {
          sendRpcTxWithNonceQueue(
            NavalAbi.setPlayerIdentity(app.battleId, idRec.identityAddr),
            'setPlayerIdentity',
            4_000_000n
          ).then((sent) => waitForReceipt(sent.txHash).then(() => releaseInFlightNonce(sent.senderAddr, sent.nonce))).catch(() => {});
        }
        el.rpcStatusText.textContent = `✓ Live Captain ${idRec?.nickname || `#${myRec.pid}`} · ${truncAddr4(myWallet.addr)} (${myRec.credits} CR)`;
      } else {
        app.joinModalOpen = false;
        el.joinModal.classList.remove('open');
        el.rpcStatusText.textContent = idRec?.nickname
          ? `👁️ Spectating as "${idRec.nickname}" (${truncAddr4(myWallet.addr)}) — Click "Join Battle" to deploy your Squadron!`
          : `👁️ Spectating Live Naval Battle — Click "Join Battle" anytime to deploy your Squadron!`;
      }
      renderSidebarAndHud();
      pollFleetSocialState();
      return true;
    } catch (_) {
      return false;
    }
  }

  // Sidebar Tabs & In-Game Social / Leaderboard / VHF Comms Listeners
  el.tabFleetCmd?.addEventListener('click', () => {
    app.sideMode = 'fleet';
    syncSideTabVisibility();
  });
  el.tabFleetScores?.addEventListener('click', () => {
    app.sideMode = 'scores';
    renderLeaderboardPane();
  });
  el.tabFleetSocial?.addEventListener('click', () => {
    app.sideMode = 'social';
    pollFleetSocialState();
    renderFleetSocialPane();
  });
  el.fleetSocialAlertBanner?.addEventListener('click', (e) => {
    const accBtn = e.target.closest('[data-accept-id]');
    if (accBtn) {
      handleAcceptCaptain(accBtn.getAttribute('data-accept-id'));
    }
  });
  el.fleetSocialPane?.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-soc-tab]');
    if (tabBtn) {
      app.socialTab = tabBtn.getAttribute('data-soc-tab');
      pollFleetSocialState();
      renderFleetSocialPane();
      return;
    }
    const modeBtn = e.target.closest('[data-dm-mode]');
    if (modeBtn) {
      app.dmMode = modeBtn.getAttribute('data-dm-mode');
      renderFleetSocialPane();
      return;
    }
    const connBtn = e.target.closest('[data-connect-id]');
    if (connBtn) {
      handleConnectCaptain(connBtn.getAttribute('data-connect-id'));
      return;
    }
    const accBtn = e.target.closest('[data-accept-id]');
    if (accBtn) {
      handleAcceptCaptain(accBtn.getAttribute('data-accept-id'));
      return;
    }
    const dmBtn = e.target.closest('[data-open-dm]');
    if (dmBtn) {
      app.activeDmPeerId = dmBtn.getAttribute('data-open-dm');
      app.socialTab = 'dm';
      app.dmMode = 'dm';
      pollFleetSocialState();
      renderFleetSocialPane();
    }
  });
  el.socialComposerForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSendSocialComposer(el.socialMsgInput?.value || '');
  });

  // Boot (100% Live Subnet 1 WebSocket RPC)
  el.rpcUrlInput.value = app.rpcUrl;
  syncModePillUi();
  renderJoinModal();
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet: slxWallet,
    activeAppId: 'battleship',
    title: 'Phantom Fleet: 100-Player Naval Warfare',
    subtitle:
      '8-Way Speed Throttle • ShipMoved Teleport • 100% Hull Square Hits • Live Subnet 1 Economy',
    rpcUrlFn: () => app.rpcUrl,
    getContractLabel: () => 'Fleet',
    getContractAddr: () => app.contractAddr,
    onToggleNodeDrawer: () => {
      el.rpcDrawer?.classList.toggle('open');
      setTimeout(fitBoardToWidget, 20);
    },
    onWalletSwitch: async (kp) => {
      resetLocalNonce(myWallet.addr);
      myWallet.priv = kp.privateKey;
      myWallet.addr = kp.address;
      app.rpcBlock = 0;
      await preloadNavalStateFromCachedNode();
      renderSidebarAndHud();
    },
    getAppPeers: () =>
      (app.rpcPlayers || [])
        .filter((p) => p?.identityAddr)
        .map((p) => ({
          identityAddr: p.identityAddr,
          label: p.nickname ? `${p.nickname} · ${truncAddr4(p.addr)}` : '',
          role: p.team === 0 ? 'Red Armada Captain' : 'Blue Coalition Captain',
        })),
    contextElements: [document.getElementById('nvHeaderScoreboard')],
    extraElements: [
      document.getElementById('btnOpenJoinModal'),
      document.getElementById('btnNavalHowToPlay'),
    ],
  });
  navalGuide = mountSlxGameGuide({
    gameId: 'battleship',
    headerBtnEl: el.btnNavalHowToPlay,
    welcomeMountEl: el.nvWelcomeMount,
    coachMountEl: el.nvCoachMount,
    onLayoutChange: () => setTimeout(fitBoardToWidget, 20),
    onWelcomePrimaryAction: () => {
      const v = getActiveView();
      if (!v || !v.me.joined) {
        app.joinModalOpen = true;
        el.joinModal.classList.add('open');
        renderJoinModal();
      }
    },
  });
  syncModePillUi();
  app.chainBar = unifiedHdr?.chainBar || null;
  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet: slxWallet,
    typeName: 'PHANTOM_FLEET',
    rpcUrlFn: () => app.rpcUrl,
    getCurrentPrimaryAddr: () => app.contractAddr,
    onSelectInstance: async (entry) => {
      app.rpcBlock = 0;
      app.feedLogs = [];
      app.lastMyLossAlert = null;
      app.pendingActions?.clear?.();
      await preloadNavalStateFromCachedNode(entry);
      app.navalWatcher?.refreshFilter?.();
    },
  });
  preloadNavalStateFromCachedNode().then((ok) => {
    app.navalWatcher?.refreshFilter?.();
    if (!ok) {
      setTimeout(() => {
        preloadNavalStateFromCachedNode().then(() => app.navalWatcher?.refreshFilter?.());
      }, 3000);
    }
  });
  app.navalWatcher = slxWatchChainApp({
    rpcUrl: () => app.rpcUrl,
    filter: () => {
      if (!app.contractAddr) return { address: [] };
      const f = {
        address: app.contractAddr,
        topics: [
          [TOPIC_WEAPON_FIRED, TOPIC_VESSEL_COLLISION, TOPIC_SHIP_SUNK],
        ],
      };
      if (app.battleId) {
        f.topics.push(bytesToHex(wordBytes32(app.battleId)));
      }
      return f;
    },
    onLog: ingestArenaSubscriptionLog,
    onRefresh: (meta) => pollLiveRpcState(0, meta?.blockNumber || 0),
  });
  requestAnimationFrame(mainLoop);
}
