/**
 * FRACTURED HEGEMONY: Simultaneous Sovereign Conquest (`hegemony.js` — HFS #15)
 *
 * Built on `@superlexicon/sdk` + `@superlexicon/sdk/ui`:
 * - Standardized top `mountSlxChainBar` + `mountSlxWalletHeader` + `mountHfsRegistryDropdown`.
 * - Pure WebSocket `eth_subscribe("logs")` & `newHeads` via `slxWatchChainApp` (zero RPC polling).
 * - 36 Sovereign Sectors across 6 Tectonic Confederations + 3 Aether Relays + 3 Sub-Orbital Warp Gates.
 */

import {
  hexToBytes,
  bytesToHex,
  encodeAbi,
  eventTopic,
  decodeUintWord,
  readU16BE,
  readU32BE,
  readU64BE,
  shortAddr,
  ZERO_ADDR,
  SlxClient,
  SlxWalletManager,
  SlxHfsCache,
  getDefaultNodeWsUrl,
  readOnChainIdentityNickname,
  slxWatchChainApp,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from './slx-hfs-registry.js';
import { mountSlxGameGuide } from './game-guide.js';

// ---------------------------------------------------------------------------
// 36-Sector Shattered Pangaea Topology (Exact match to `examples/hegemony/src/main.rs`)
// ---------------------------------------------------------------------------

const OWNER_WARDEN = 255;
const FLAG_CITADEL = 0x01;
const FLAG_CONTESTED = 0x02;
const FLAG_RELAY = 0x04;

const REGIONS = [
  { id: 0, name: 'Boreal Atlantic', short: 'N.Atlantic', bonus: 4, color: '#38bdf8', labelPos: [255, 58], sectors: [0, 1, 2, 3, 4, 5] },
  { id: 1, name: 'Andean Austral', short: 'Austral', bonus: 3, color: '#f59e0b', labelPos: [248, 488], sectors: [6, 7, 8, 9, 10] },
  { id: 2, name: 'Boreal Steppe', short: 'Steppe', bonus: 6, color: '#f43f5e', labelPos: [845, 76], sectors: [11, 12, 13, 14, 15, 16, 17] },
  { id: 3, name: 'Afro-Med League', short: 'Afro-Med', bonus: 4, color: '#10b981', labelPos: [548, 560], sectors: [18, 19, 20, 21, 22, 23] },
  { id: 4, name: 'Pelagic Rim', short: 'Pelagic', bonus: 3, color: '#a855f7', labelPos: [988, 608], sectors: [24, 25, 26, 27, 28] },
  { id: 5, name: 'Continental Core', short: 'Silk Core', bonus: 5, color: '#eab308', labelPos: [748, 202], sectors: [29, 30, 31, 32, 33, 34, 35] },
];

const SECTORS = [
  // 0..5 Boreal Atlantic (North America & Greenland)
  { id: 0, name: 'Yukon Spire', reg: 0, x: 104, y: 132 },
  { id: 1, name: 'Hudson Shield', reg: 0, x: 232, y: 148 },
  { id: 2, name: 'Thule Station', reg: 0, x: 432, y: 84 },
  { id: 3, name: 'Cascadia', reg: 0, x: 186, y: 232 },
  { id: 4, name: 'Great Lakes Hub', reg: 0, x: 294, y: 238 },
  { id: 5, name: 'Sierra Isthmus', reg: 0, x: 238, y: 318 },

  // 6..10 Andean & Austral Compact (South America)
  { id: 6, name: 'Orinoco Delta', reg: 1, x: 336, y: 374 },
  { id: 7, name: 'Cordillera High', reg: 1, x: 318, y: 442 },
  { id: 8, name: 'Amazonia', reg: 1, x: 404, y: 432 },
  { id: 9, name: 'Pampas Reach', reg: 1, x: 368, y: 508 },
  { id: 10, name: 'Tierra Austral', reg: 1, x: 334, y: 582 },

  // 11..17 Boreal Steppe Directorate (Northern Eurasia & Far East)
  { id: 11, name: 'Nordkapp', reg: 2, x: 618, y: 132 },
  { id: 12, name: 'Ural Frontier', reg: 2, x: 735, y: 152 },
  { id: 13, name: 'Baikal Relay', reg: 2, x: 868, y: 166, relay: true },
  { id: 14, name: 'Amur Basin', reg: 2, x: 964, y: 214 },
  { id: 15, name: 'Sakha Tundra', reg: 2, x: 978, y: 128 },
  { id: 16, name: 'Kuroshio Arc', reg: 2, x: 1034, y: 252 },
  { id: 17, name: 'Bering Watch', reg: 2, x: 1094, y: 136 },

  // 18..23 Afro-Mediterranean League (Africa & Madagascar)
  { id: 18, name: 'Atlas Littoral', reg: 3, x: 552, y: 314 },
  { id: 19, name: 'Guinea Coast', reg: 3, x: 564, y: 378 },
  { id: 20, name: 'Great Rift', reg: 3, x: 636, y: 424 },
  { id: 21, name: 'Nile Nexus', reg: 3, x: 668, y: 338, relay: true },
  { id: 22, name: 'Cape Drakens', reg: 3, x: 642, y: 504 },
  { id: 23, name: 'Malagasy Reef', reg: 3, x: 716, y: 478 },

  // 24..28 Pelagic Indo-Pacific Archipelago (Maritime SE Asia & Oceania)
  { id: 24, name: 'Sunda Strait', reg: 4, x: 928, y: 408 },
  { id: 25, name: 'Luzon Trench', reg: 4, x: 982, y: 348 },
  { id: 26, name: 'Arafura Outback', reg: 4, x: 974, y: 498 },
  { id: 27, name: 'Coral Tasman', reg: 4, x: 1054, y: 516 },
  { id: 28, name: 'Zealandia Spire', reg: 4, x: 1126, y: 568 },

  // 29..35 Continental Silk Core (Europe, Levant, South & East Asia)
  { id: 29, name: 'Geneva Prime', reg: 5, x: 574, y: 212, relay: true },
  { id: 30, name: 'Danube Bastion', reg: 5, x: 646, y: 218 },
  { id: 31, name: 'Levant Crossroads', reg: 5, x: 708, y: 294 },
  { id: 32, name: 'Caspian Gate', reg: 5, x: 776, y: 236 },
  { id: 33, name: 'Deccan Subcontinent', reg: 5, x: 834, y: 324 },
  { id: 34, name: 'Yangtze Heartland', reg: 5, x: 918, y: 274 },
  { id: 35, name: 'Mekong Delta', reg: 5, x: 908, y: 346 },
];

const EDGES = [
  [0, 1], [0, 3], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4], [3, 5], [4, 5],
  [6, 7], [6, 8], [7, 8], [7, 9], [8, 9], [9, 10],
  [11, 12], [12, 13], [13, 14], [13, 15], [14, 15], [14, 16], [15, 17], [16, 17],
  [18, 19], [18, 21], [19, 20], [19, 21], [20, 21], [20, 22], [21, 23], [22, 23],
  [24, 25], [24, 26], [25, 26], [26, 27], [26, 28], [27, 28],
  [29, 30], [30, 31], [30, 32], [31, 32], [31, 33], [32, 33], [32, 34], [33, 34], [33, 35], [34, 35],
  [5, 6], [2, 11], [8, 18], [11, 29], [11, 30], [12, 30], [12, 32], [13, 34], [14, 34], [16, 25], [18, 29], [21, 31], [23, 24], [24, 35], [25, 35],
];

const WARP_EDGES = [
  [0, 17, 'Bering Strait'],
  [3, 16, 'N.Pacific Lane'],
  [10, 28, 'S.Polar Lane'],
];

const ADJ_SETS = Array.from({ length: 36 }, () => new Set());
for (const [a, b] of [...EDGES, ...WARP_EDGES]) {
  ADJ_SETS[a].add(b);
  ADJ_SETS[b].add(a);
}

const SOVEREIGN_PALETTE = [
  '#38bdf8', '#f59e0b', '#10b981', '#f43f5e', '#a855f7', '#eab308',
  '#2dd4bf', '#fb7185', '#60a5fa', '#c084fc', '#4ade80', '#fb923c',
];

const TOPICS = {
  SOVEREIGN_JOINED: eventTopic('SovereignJoined(bytes32,address,uint64,uint64,uint64)'),
  DIRECTIVES_STAGED: eventTopic('DirectivesStaged(bytes32,address,uint64,uint64,uint64,uint64)'),
  SECTOR_CLASH: eventTopic('SectorClash(bytes32,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)'),
  CYCLE_RESOLVED: eventTopic('CycleResolved(bytes32,uint64,uint64,uint64)'),
  EPOCH_CONQUERED: eventTopic('EpochConquered(bytes32,address,uint64,uint64,uint64)'),
  COMPACT_PROPOSED: eventTopic('CompactProposed(bytes32,uint64,uint64,uint64)'),
  COMPACT_RATIFIED: eventTopic('CompactRatified(bytes32,uint64,uint64,uint64)'),
  OATH_BROKEN: eventTopic('OathBroken(bytes32,uint64,uint64,uint64)'),
};

// ---------------------------------------------------------------------------
// Live Client State
// ---------------------------------------------------------------------------

const rpcUrl = getDefaultNodeWsUrl();
const slxClient = new SlxClient({ rpcUrl });
const wallet = new SlxWalletManager();

let contractAddr = null;
let realmId = null;
let latestBlock = 0;
let realmState = null; // Decoded `getRealmState`
let selectedSector = null;
let preferredLanding = 0;

// Staged local orders for the current cycle
let stagedDeploys = new Map(); // sectorId -> count
let stagedStrikes = [];        // [{ from, to, count }]
let stagedCycleNum = 0;

const nicknameCache = new Map();
const seenLogKeys = new Set();
let watcherHandle = null;
let txBusy = false;

// ---------------------------------------------------------------------------
// Binary State Decoder (`getRealmState(bytes32)`)
// ---------------------------------------------------------------------------

function decodeRealmStateHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 32 + 36 * 4) return null;

  const hdr = {
    active: b[0],
    sovereignCount: b[1],
    compactCount: b[2],
    lastHegemonSid: b[3],
    epoch: readU32BE(b, 4),
    cycle: readU32BE(b, 8),
    lastResolvedBlock: readU64BE(b, 12),
    totalClashes: readU32BE(b, 20),
    stagedMask: readU32BE(b, 24),
  };

  const sectors = [];
  let pos = 32;
  for (let i = 0; i < 36; i++) {
    sectors.push({
      id: i,
      owner: b[pos],
      legions: readU16BE(b, pos + 1),
      flags: b[pos + 3],
    });
    pos += 4;
  }

  const sovereigns = [];
  for (let i = 0; i < hdr.sovereignCount && pos + 56 <= b.length; i++) {
    const addr = bytesToHex(b.slice(pos, pos + 20)).toLowerCase();
    const identityAddr = bytesToHex(b.slice(pos + 20, pos + 40)).toLowerCase();
    sovereigns.push({
      sid: i,
      addr,
      identityAddr: identityAddr === ZERO_ADDR ? null : identityAddr,
      citadelSector: b[pos + 40],
      sectorCount: b[pos + 41],
      supply: readU16BE(b, pos + 42),
      epochsWon: readU16BE(b, pos + 44),
      peakSectors: readU16BE(b, pos + 46),
      vanquished: readU32BE(b, pos + 48),
      oathsBroken: readU16BE(b, pos + 52),
    });
    pos += 56;
  }

  const compacts = [];
  for (let c = 0; c < hdr.compactCount && pos + 8 <= b.length; c++) {
    compacts.push({
      sidA: b[pos],
      sidB: b[pos + 1],
      proposer: b[pos + 2],
      status: b[pos + 3],
      expiresCycle: readU32BE(b, pos + 4),
    });
    pos += 8;
  }

  return { hdr, sectors, sovereigns, compacts };
}

function sovColor(sid) {
  if (sid === OWNER_WARDEN || sid == null) return '#475569';
  return SOVEREIGN_PALETTE[sid % SOVEREIGN_PALETTE.length];
}

function sovName(sid) {
  if (sid === OWNER_WARDEN) return 'Autonomous Wardens';
  const sv = realmState?.sovereigns?.[sid];
  if (!sv) return `Sovereign #${sid}`;
  if (sv.identityAddr && nicknameCache.has(sv.identityAddr)) {
    return nicknameCache.get(sv.identityAddr);
  }
  return `Sov·${shortAddr(sv.addr)}`;
}

async function hydrateNicknames(sovereigns) {
  let changed = false;
  await Promise.all(
    sovereigns.map(async (sv) => {
      if (!sv.identityAddr || nicknameCache.has(sv.identityAddr)) return;
      const nick = await readOnChainIdentityNickname(rpcUrl, sv.identityAddr).catch(() => null);
      if (nick) {
        nicknameCache.set(sv.identityAddr, nick);
        changed = true;
      }
    })
  );
  if (changed) renderAll();
}

function getMySid() {
  if (!realmState) return -1;
  const myEoa = wallet.keypair.address.toLowerCase();
  const found = realmState.sovereigns.find((s) => s.addr === myEoa);
  return found ? found.sid : -1;
}

function totalStagedDeploy() {
  let sum = 0;
  for (const v of stagedDeploys.values()) sum += v;
  return sum;
}

function stagedOutFrom(secId) {
  return stagedStrikes
    .filter((s) => s.from === secId)
    .reduce((acc, s) => acc + s.count, 0);
}

// ---------------------------------------------------------------------------
// Live Feed Logger
// ---------------------------------------------------------------------------

function pushFeed(html, cls = '') {
  const el = document.getElementById('warFeed');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `heg-feed-item ${cls}`.trim();
  div.innerHTML = html;
  el.prepend(div);
  while (el.children.length > 45) {
    el.removeChild(el.lastChild);
  }
}

function handleChainLog(log) {
  if (!log?.topics?.length) return;
  const dedup = `${log.transactionHash || ''}:${log.logIndex || ''}:${log.topics[0]}:${log.data || ''}`;
  if (seenLogKeys.has(dedup)) return;
  seenLogKeys.add(dedup);

  const t0 = String(log.topics[0]).toLowerCase();
  const t1 = String(log.topics[1] || '').toLowerCase();
  if (realmId && t1 && t1 !== realmId.toLowerCase()) return;

  const d = log.data || '0x';
  if (t0 === TOPICS.SECTOR_CLASH) {
    const cyc = decodeUintWord(d, 0);
    const sec = decodeUintWord(d, 1);
    const attSid = decodeUintWord(d, 2);
    const defSid = decodeUintWord(d, 3);
    const attTr = decodeUintWord(d, 4);
    const defTr = decodeUintWord(d, 5);
    const winSid = decodeUintWord(d, 6);
    const surv = decodeUintWord(d, 7);
    const secName = SECTORS[sec]?.name || `S#${sec}`;
    const captured = winSid !== defSid;
    pushFeed(
      `<strong>[C${cyc}]</strong> <span style="color:${sovColor(attSid)}">${sovName(attSid)}</span> (${attTr}) ${
        captured ? 'conquered' : 'repelled at'
      } <strong>${secName}</strong> vs <span style="color:${sovColor(defSid)}">${sovName(defSid)}</span> (${defTr}) → ${surv} Legions`,
      'clash'
    );
  } else if (t0 === TOPICS.CYCLE_RESOLVED) {
    const ep = decodeUintWord(d, 0);
    const newCyc = decodeUintWord(d, 1);
    const clashes = decodeUintWord(d, 2);
    pushFeed(`<strong>⚡ Epoch ${ep} → Cycle ${newCyc}</strong> resolved (${clashes} border clashes)`, '');
  } else if (t0 === TOPICS.EPOCH_CONQUERED) {
    const winSid = decodeUintWord(d, 0);
    const ep = decodeUintWord(d, 1);
    const secs = decodeUintWord(d, 2);
    pushFeed(
      `👑 <strong>EPOCH ${ep} HEGEMON!</strong> <span style="color:${sovColor(winSid)}">${sovName(winSid)}</span> unified ${secs}/36 Sectors!`,
      'epoch'
    );
  } else if (t0 === TOPICS.SOVEREIGN_JOINED) {
    const sid = decodeUintWord(d, 0);
    const cap = decodeUintWord(d, 1);
    pushFeed(
      `⚔️ <span style="color:${sovColor(sid)}">${sovName(sid)}</span> raised Citadel at <strong>${SECTORS[cap]?.name || cap}</strong>!`,
      'pact'
    );
  } else if (t0 === TOPICS.COMPACT_RATIFIED) {
    const a = decodeUintWord(d, 0);
    const b = decodeUintWord(d, 1);
    const exp = decodeUintWord(d, 2);
    pushFeed(
      `🤝 <strong>Compact Ratified:</strong> ${sovName(a)} &amp; ${sovName(b)} through Cycle ${exp}`,
      'pact'
    );
  } else if (t0 === TOPICS.OATH_BROKEN) {
    const traitor = decodeUintWord(d, 0);
    const victim = decodeUintWord(d, 1);
    pushFeed(
      `🗡️ <strong>OATH BROKEN!</strong> ${sovName(traitor)} betrayed ${sovName(victim)} (+6 Emergency Supply transferred!)`,
      'oath'
    );
  }
}

// ---------------------------------------------------------------------------
// SVG Map & Sidebar Rendering
// ---------------------------------------------------------------------------

function renderMapSvg() {
  const svg = document.getElementById('hegemonySvg');
  if (!svg || !realmState) return;

  const mySid = getMySid();
  const reachSet = selectedSector != null ? ADJ_SETS[selectedSector] : new Set();

  let html = `
    <defs>
      <marker id="strikeArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24" />
      </marker>
    </defs>
    <image href="/assets/hegemony/world_map.jpg" x="0" y="0" width="1160" height="652" preserveAspectRatio="none" opacity="0.96" />
  `;

  // Geopolitical Bloc labels placed cleanly over open ocean / steppe zones
  for (const reg of REGIONS) {
    const [lx, ly] = reg.labelPos;
    html += `
      <text x="${lx}" y="${ly}" text-anchor="middle" fill="${reg.color}" fill-opacity="0.82" font-size="10.5" font-weight="800" font-family="JetBrains Mono, monospace" style="paint-order:stroke;stroke:#030712;stroke-width:3.5px;">${reg.name.toUpperCase()} (+${reg.bonus})</text>
    `;
  }

  // East-West Wrap-Around Sea/Orbital Lanes (drawn as clean edge portal stubs!)
  for (const [westId, eastId, label] of WARP_EDGES) {
    const pw = SECTORS[westId];
    const pe = SECTORS[eastId];
    const hi =
      (selectedSector === westId && reachSet.has(eastId)) ||
      (selectedSector === eastId && reachSet.has(westId));
    const col = hi ? '#fbbf24' : '#c084fc';
    const w = hi ? 2.8 : 1.7;
    html += `
      <line x1="${pw.x}" y1="${pw.y}" x2="6" y2="${pw.y}" stroke="${col}" stroke-width="${w}" stroke-dasharray="5 4" opacity="${hi ? 1 : 0.72}" />
      <text x="12" y="${pw.y - 6}" text-anchor="start" fill="${col}" font-size="8.5" font-weight="700" font-family="JetBrains Mono, monospace">←⇄ ${SECTORS[eastId].name.split(' ')[0]}</text>
      <line x1="${pe.x}" y1="${pe.y}" x2="1154" y2="${pe.y}" stroke="${col}" stroke-width="${w}" stroke-dasharray="5 4" opacity="${hi ? 1 : 0.72}" />
      <text x="1148" y="${pe.y - 6}" text-anchor="end" fill="${col}" font-size="8.5" font-weight="700" font-family="JetBrains Mono, monospace">${SECTORS[westId].name.split(' ')[0]} ⇄→</text>
    `;
    if (hi) {
      const arcY = Math.min(pw.y, pe.y) < 300 ? 18 : 636;
      html += `<path d="M ${pw.x} ${pw.y} Q 580 ${arcY} ${pe.x} ${pe.y}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6 5" opacity="0.65" />`;
      html += `<text x="580" y="${arcY < 100 ? 32 : 628}" text-anchor="middle" fill="#fde68a" font-size="9.5" font-family="JetBrains Mono, monospace">⇄ ${label}</text>`;
    }
  }

  // Land Corridors & Regional Sea Straits
  for (const [a, b] of EDGES) {
    const pa = SECTORS[a];
    const pb = SECTORS[b];
    const hi = (selectedSector === a && reachSet.has(b)) || (selectedSector === b && reachSet.has(a));
    html += `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="${hi ? '#fbbf24' : '#38bdf8'}" stroke-width="${hi ? 3.0 : 1.5}" opacity="${hi ? 0.96 : 0.44}" />`;
  }

  // Staged Vector Strike arrows
  for (const st of stagedStrikes) {
    const pa = SECTORS[st.from];
    const pb = SECTORS[st.to];
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    html += `
      <line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="#fbbf24" stroke-width="3.2" marker-end="url(#strikeArrow)" />
      <rect x="${mx - 18}" y="${my - 10}" width="36" height="17" rx="4" fill="#0f172a" stroke="#fbbf24" stroke-width="1.2" />
      <text x="${mx}" y="${my + 2}" text-anchor="middle" fill="#fde68a" font-size="10" font-weight="800" font-family="JetBrains Mono, monospace">⚔${st.count}</text>
    `;
  }

  // 36 Sovereign Sector Hex/Node Badges
  for (const meta of SECTORS) {
    const sec = realmState.sectors[meta.id];
    const ownerColor = sovColor(sec.owner);
    const regColor = REGIONS[meta.reg].color;
    const isMine = mySid >= 0 && sec.owner === mySid;
    const isSelected = selectedSector === meta.id;
    const isReachable = selectedSector != null && reachSet.has(meta.id);
    const isCitadel = (sec.flags & FLAG_CITADEL) !== 0;
    const isContested = (sec.flags & FLAG_CONTESTED) !== 0;
    const isRelay = (sec.flags & FLAG_RELAY) !== 0 || meta.relay;
    const addDep = stagedDeploys.get(meta.id) || 0;

    let ringStroke = regColor;
    let ringWidth = 2;
    if (isSelected) {
      ringStroke = '#ffffff';
      ringWidth = 3.5;
    } else if (isReachable) {
      ringStroke = '#fbbf24';
      ringWidth = 2.8;
    } else if (mySid < 0 && preferredLanding === meta.id) {
      ringStroke = '#fbbf24';
      ringWidth = 3;
    }

    html += `<g class="heg-sector-node" data-sector="${meta.id}">`;
    if (isContested) {
      html += `<circle cx="${meta.x}" cy="${meta.y}" r="30" fill="none" stroke="#f43f5e" stroke-width="2" stroke-dasharray="3 3" opacity="0.85" />`;
    }
    if (isRelay) {
      html += `<polygon points="${meta.x},${meta.y - 31} ${meta.x + 29},${meta.y} ${meta.x},${meta.y + 31} ${meta.x - 29},${meta.y}" fill="none" stroke="#38bdf8" stroke-width="1.4" opacity="0.7" />`;
    }
    html += `
      <circle cx="${meta.x}" cy="${meta.y}" r="19" fill="${ownerColor}" fill-opacity="${sec.owner === OWNER_WARDEN ? 0.52 : 0.88}" stroke="${ringStroke}" stroke-width="${ringWidth}" />
      ${isMine ? `<circle cx="${meta.x}" cy="${meta.y}" r="23" fill="none" stroke="#e0f2fe" stroke-width="1.4" opacity="0.9" />` : ''}
      <text x="${meta.x}" y="${meta.y + 4}" text-anchor="middle" fill="#ffffff" font-size="12.5" font-weight="900" font-family="JetBrains Mono, monospace">${sec.legions + addDep}</text>
      <text x="${meta.x}" y="${meta.y + 31}" text-anchor="middle" fill="#f1f5f9" font-size="9.2" font-weight="800" style="paint-order:stroke;stroke:#030712;stroke-width:3.2px;">${meta.name}</text>
    `;
    if (isCitadel) {
      html += `<text x="${meta.x - 18}" y="${meta.y - 16}" font-size="12">🏰</text>`;
    }
    if (isRelay) {
      html += `<text x="${meta.x + 12}" y="${meta.y - 16}" font-size="11" fill="#7dd3fc">⚡</text>`;
    }
    if (addDep > 0) {
      html += `
        <rect x="${meta.x + 12}" y="${meta.y - 8}" width="26" height="15" rx="4" fill="#065f46" stroke="#34d399" stroke-width="1" />
        <text x="${meta.x + 25}" y="${meta.y + 3}" text-anchor="middle" fill="#a7f3d0" font-size="9.5" font-weight="800" font-family="JetBrains Mono, monospace">+${addDep}</text>
      `;
    }
    html += `</g>`;
  }

  svg.innerHTML = html;
  svg.querySelectorAll('.heg-sector-node').forEach((node) => {
    node.addEventListener('click', () => onSectorClicked(Number(node.getAttribute('data-sector'))));
  });
}

function onSectorClicked(secId) {
  if (!realmState) return;
  const mySid = getMySid();
  const mySov = mySid >= 0 ? realmState.sovereigns[mySid] : null;

  if (!mySov || mySov.sectorCount === 0) {
    preferredLanding = secId;
    renderAll();
    return;
  }

  const sec = realmState.sectors[secId];
  if (selectedSector == null) {
    selectedSector = secId;
    renderAll();
    return;
  }

  if (selectedSector === secId) {
    // Clicking own selected sector again deploys +1 Supply if available!
    if (sec.owner === mySid) {
      const rem = mySov.supply - totalStagedDeploy();
      if (rem > 0 && stagedDeploys.size < 6) {
        stagedDeploys.set(secId, (stagedDeploys.get(secId) || 0) + 1);
      }
    }
    renderAll();
    return;
  }

  const originSec = realmState.sectors[selectedSector];
  if (originSec.owner === mySid && ADJ_SETS[selectedSector].has(secId)) {
    const effLegions = originSec.legions + (stagedDeploys.get(selectedSector) || 0) - stagedOutFrom(selectedSector);
    if (effLegions > 1 && stagedStrikes.length < 6) {
      const send = Math.max(1, Math.floor((effLegions - 1) * 0.75));
      const existing = stagedStrikes.find((s) => s.from === selectedSector && s.to === secId);
      if (existing) {
        existing.count = Math.min(originSec.legions + (stagedDeploys.get(selectedSector) || 0) - 1, existing.count + 1);
      } else {
        stagedStrikes.push({ from: selectedSector, to: secId, count: send });
      }
    }
    renderAll();
    return;
  }

  selectedSector = secId;
  renderAll();
}

function renderInspectorAndConsole() {
  if (!realmState) return;
  const mySid = getMySid();
  const mySov = mySid >= 0 ? realmState.sovereigns[mySid] : null;

  const uprisingEl = document.getElementById('uprisingOverlay');
  if (!mySov || mySov.sectorCount === 0) {
    uprisingEl.style.display = 'flex';
    document.getElementById('uprisingHint').textContent = `Preferred Citadel Zone: ${SECTORS[preferredLanding]?.name || 'Auto'} — Claims 3 Sectors + 8 Supply instantly ($0 Gas)!`;
  } else {
    uprisingEl.style.display = 'none';
  }

  const sumEl = document.getElementById('mySovereignSummary');
  if (!mySov || mySov.sectorCount === 0) {
    sumEl.innerHTML = `<span style="color:#fbbf24;">UNSEATED COMMANDER</span> • Launch an Uprising above to enter Epoch ${realmState.hdr.epoch}!`;
  } else {
    const remSupply = Math.max(0, mySov.supply - totalStagedDeploy());
    const alreadyStaged = ((realmState.hdr.stagedMask >>> mySid) & 1) !== 0;
    sumEl.innerHTML = `
      <span class="heg-swatch" style="background:${sovColor(mySid)}"></span>
      <span>${sovName(mySid)}</span> •
      <strong>${mySov.sectorCount}/24</strong> Sectors •
      Supply: <strong style="color:#34d399;">${remSupply}</strong>/${mySov.supply} •
      🏆 <strong>${mySov.epochsWon}</strong> Epochs
      ${alreadyStaged ? '<span class="heg-ready-tag" style="margin-left:6px;">✓ COMMITTED ON-CHAIN</span>' : ''}
    `;
  }

  const insp = document.getElementById('sectorInspector');
  if (selectedSector == null) {
    insp.textContent = 'Tip: Click your Sector to reinforce (+Supply) or click an adjacent gold-ringed Sector to stage a Vector Strike.';
  } else {
    const meta = SECTORS[selectedSector];
    const sec = realmState.sectors[selectedSector];
    const reg = REGIONS[meta.reg];
    const isMine = mySid >= 0 && sec.owner === mySid;
    const remSupply = mySov ? Math.max(0, mySov.supply - totalStagedDeploy()) : 0;

    insp.innerHTML = `
      <strong>${meta.name}</strong> <span style="color:${reg.color}">(${reg.short})</span> •
      Owner: <strong style="color:${sovColor(sec.owner)}">${sovName(sec.owner)}</strong> •
      Legions: <strong>${sec.legions}</strong>
      ${isMine && remSupply > 0 ? `
        <button class="heg-mini-btn" data-dep="1">+1 Supply</button>
        <button class="heg-mini-btn" data-dep="3">+${Math.min(3, remSupply)} Supply</button>
        <button class="heg-mini-btn" data-dep="${remSupply}">+All (${remSupply})</button>
      ` : ''}
    `;
    insp.querySelectorAll('[data-dep]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const amt = Number(btn.getAttribute('data-dep'));
        if (amt > 0) {
          stagedDeploys.set(selectedSector, (stagedDeploys.get(selectedSector) || 0) + amt);
          renderAll();
        }
      });
    });
  }

  // Staged list summary
  const ops = [];
  for (const [secId, cnt] of stagedDeploys.entries()) {
    ops.push(`+${cnt} → ${SECTORS[secId]?.name}`);
  }
  for (const st of stagedStrikes) {
    ops.push(`⚔${st.count} ${SECTORS[st.from]?.name} → ${SECTORS[st.to]?.name}`);
  }
  document.getElementById('stagedCountLabel').textContent = String(ops.length);
  document.getElementById('stagedList').textContent = ops.length
    ? ops.join('  |  ')
    : 'No directives staged for this cycle.';

  const blocksElapsed = Math.max(0, latestBlock - realmState.hdr.lastResolvedBlock);
  const canResolve = blocksElapsed >= 2;
  document.getElementById('hudEpoch').textContent = String(realmState.hdr.epoch);
  document.getElementById('hudCycle').textContent = String(realmState.hdr.cycle);
  document.getElementById('hudCycleWindow').textContent = canResolve
    ? `⚡ Cycle Ready (${blocksElapsed} blks)`
    : `⏳ Simultaneous Window (${blocksElapsed}/2 blks)`;

  document.getElementById('btnCommitOrders').disabled =
    txBusy || !mySov || mySov.sectorCount === 0 || ops.length === 0;
  document.getElementById('btnResolveCycle').disabled = txBusy || !canResolve;
}

function renderSidebars() {
  if (!realmState) return;
  const mySid = getMySid();

  // Region hegemony chips
  const regBar = document.getElementById('regionBonusBar');
  regBar.innerHTML = REGIONS.map((reg) => {
    const firstOwner = realmState.sectors[reg.sectors[0]].owner;
    const heldBy =
      firstOwner !== OWNER_WARDEN &&
      reg.sectors.every((s) => realmState.sectors[s].owner === firstOwner)
        ? firstOwner
        : null;
    return `<span class="heg-region-chip mono" style="border-color:${reg.color}55;color:${reg.color};">
      ${reg.short} +${reg.bonus}${heldBy != null ? ` • ${sovName(heldBy)}` : ''}
    </span>`;
  }).join('');

  // Sovereign leaderboard
  document.getElementById('hudSovereignCount').textContent = `${realmState.sovereigns.length} Registered`;
  const sorted = [...realmState.sovereigns].sort(
    (a, b) => b.sectorCount - a.sectorCount || b.epochsWon - a.epochsWon || b.vanquished - a.vanquished
  );
  const sovEl = document.getElementById('sovereignList');
  sovEl.innerHTML = sorted
    .map((sv) => {
      const ready = ((realmState.hdr.stagedMask >>> sv.sid) & 1) !== 0;
      const isMe = sv.sid === mySid;
      const canPact =
        mySid >= 0 &&
        !isMe &&
        sv.sectorCount > 0 &&
        !realmState.compacts.some(
          (c) =>
            (c.status === 1 || c.status === 2) &&
            ((c.sidA === mySid && c.sidB === sv.sid) || (c.sidB === mySid && c.sidA === sv.sid))
        );
      return `
        <div class="heg-sov-row ${isMe ? 'me' : ''}">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <span class="heg-swatch" style="background:${sovColor(sv.sid)}"></span>
            <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sovName(sv.sid)}${isMe ? ' (You)' : ''}</strong>
            ${ready ? '<span class="heg-ready-tag mono">READY</span>' : ''}
          </div>
          <div class="mono" style="display:flex;align-items:center;gap:6px;font-size:0.67rem;">
            <span title="Controlled Sectors">${sv.sectorCount}s</span>
            <span style="color:#34d399;" title="Supply">${sv.supply}⚡</span>
            ${sv.epochsWon > 0 ? `<span style="color:#fbbf24;">🏆${sv.epochsWon}</span>` : ''}
            ${canPact ? `<button class="heg-mini-btn" data-propose="${sv.sid}" title="Propose 6-Cycle Non-Aggression Compact">🤝</button>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  sovEl.querySelectorAll('[data-propose]').forEach((btn) => {
    btn.addEventListener('click', () => proposeCompactTx(Number(btn.getAttribute('data-propose'))));
  });

  // Compacts panel
  const cmpEl = document.getElementById('compactList');
  if (!realmState.compacts.length) {
    cmpEl.innerHTML = `<div class="heg-muted">No active Non-Aggression Compacts. Click 🤝 next to any Sovereign above to propose a 6-cycle treaty!</div>`;
  } else {
    cmpEl.innerHTML = realmState.compacts
      .map((c) => {
        const canRatify =
          c.status === 1 && (c.sidA === mySid || c.sidB === mySid) && c.proposer !== mySid;
        const statusBadge =
          c.status === 2
            ? `<span class="mono" style="color:#34d399;">ACTIVE → C${c.expiresCycle}</span>`
            : `<span class="mono" style="color:#fbbf24;">PROPOSED</span>`;
        return `
          <div class="heg-compact-row">
            <span>${sovName(c.sidA)} ⇄ ${sovName(c.sidB)}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              ${statusBadge}
              ${canRatify ? `<button class="heg-mini-btn" data-ratify="${c.proposer}">✓ Ratify</button>` : ''}
            </div>
          </div>
        `;
      })
      .join('');
    cmpEl.querySelectorAll('[data-ratify]').forEach((btn) => {
      btn.addEventListener('click', () => ratifyCompactTx(Number(btn.getAttribute('data-ratify'))));
    });
  }
}

function pruneStagedToCurrentOwnership() {
  if (!realmState) return;
  const mySid = getMySid();
  const mySov = mySid >= 0 ? realmState.sovereigns[mySid] : null;
  if (!mySov || mySov.sectorCount === 0) {
    stagedDeploys.clear();
    stagedStrikes = [];
    return;
  }

  let remSupply = mySov.supply;
  for (const [secId, cnt] of [...stagedDeploys.entries()]) {
    if (secId < 0 || secId >= 36 || realmState.sectors[secId].owner !== mySid || remSupply <= 0 || cnt <= 0) {
      stagedDeploys.delete(secId);
    } else {
      const clamped = Math.min(cnt, remSupply);
      stagedDeploys.set(secId, clamped);
      remSupply -= clamped;
    }
  }

  const nextStrikes = [];
  const usedFrom = new Map();
  for (const st of stagedStrikes) {
    if (
      st.from < 0 ||
      st.from >= 36 ||
      st.to < 0 ||
      st.to >= 36 ||
      realmState.sectors[st.from].owner !== mySid ||
      !ADJ_SETS[st.from]?.has(st.to)
    ) {
      continue;
    }
    const maxAvail =
      realmState.sectors[st.from].legions +
      (stagedDeploys.get(st.from) || 0) -
      1 -
      (usedFrom.get(st.from) || 0);
    if (maxAvail >= 1) {
      const clampedCnt = Math.min(st.count, maxAvail);
      nextStrikes.push({ from: st.from, to: st.to, count: clampedCnt });
      usedFrom.set(st.from, (usedFrom.get(st.from) || 0) + clampedCnt);
    }
  }
  stagedStrikes = nextStrikes;
  stagedCycleNum = realmState.hdr.cycle;
}

let hegGuide = null;

function updateHegemonyCoach() {
  if (!hegGuide || !realmState) return;
  const mySid = getMySid();
  const mySov = mySid >= 0 ? realmState.sovereigns[mySid] : null;
  const blocksElapsed = Math.max(0, latestBlock - realmState.hdr.lastResolvedBlock);
  const canResolve = blocksElapsed >= 2;

  if (!mySov || mySov.sectorCount === 0) {
    const landingName = SECTORS[preferredLanding]?.name || 'Auto';
    hegGuide.updateCoach({
      pill: 'STEP 1 OF 3 • CLAIM ENCLAVE',
      tone: 'urgent',
      html: `<strong>Drop in with 0 Gas!</strong> Click any map territory to pick a landing zone (selected: <strong>${landingName}</strong>), then launch your 3-sector Citadel Uprising!`,
      actionLabel: '⚔️ Launch Uprising',
      onAction: () => launchUprisingTx(),
    });
    return;
  }

  const opsCount = stagedDeploys.size + stagedStrikes.length;
  const alreadyCommitted = ((realmState.hdr.stagedMask >>> mySid) & 1) !== 0;
  const remSupply = Math.max(0, mySov.supply - totalStagedDeploy());

  if (opsCount > 0) {
    hegGuide.updateCoach({
      pill: 'STEP 3 OF 3 • COMMIT ORDERS',
      tone: 'urgent',
      html: `<strong>${opsCount} directive(s) staged locally!</strong> Click <strong>🚀 Commit Directives</strong> now so your reinforcements &amp; strikes lock on-chain for Cycle <code>#${realmState.hdr.cycle}</code>!`,
      actionLabel: '🚀 Commit Directives',
      onAction: () => commitDirectivesTx(),
    });
    return;
  }

  if (alreadyCommitted) {
    hegGuide.updateCoach({
      pill: canResolve ? '⚡ CLASH READY' : '✓ ORDERS COMMITTED',
      tone: 'action',
      html: canResolve
        ? `Cycle <code>#${realmState.hdr.cycle}</code> simultaneous window is complete (<code>${blocksElapsed}</code> blocks elapsed) — resolve clashes now or wait for the keeper!`
        : `Your Cycle <code>#${realmState.hdr.cycle}</code> orders are locked on-chain (<code>${blocksElapsed}/2</code> blocks). Propose a <strong>🤝 Compact</strong> on the right while awaiting clash!`,
      actionLabel: canResolve ? '⏱ Resolve Cycle' : '',
      onAction: canResolve ? () => resolveCycleTx() : null,
    });
    return;
  }

  hegGuide.updateCoach({
    pill: 'STEP 2 OF 3 • PLAN CYCLE',
    tone: 'action',
    html: `<strong>1)</strong> Click your colored territory to deploy Supply (<code>${remSupply}</code> left) &bull; <strong>2)</strong> Click a <strong>dashed gold neighbor</strong> to Strike — or click <strong>⚡ Auto-Plan</strong>!`,
    actionLabel: '⚡ Auto-Plan Moves',
    onAction: () => autoPlanStage(),
  });
}

function renderAll() {
  if (!realmState) return;
  pruneStagedToCurrentOwnership();
  renderMapSvg();
  renderInspectorAndConsole();
  renderSidebars();
  updateHegemonyCoach();
}

// ---------------------------------------------------------------------------
// On-Chain Reads & Transactions
// ---------------------------------------------------------------------------

async function sendHegTx({ data, fnLabel, gasLimit = 3_200_000n }) {
  const res = await slxClient.sendAndConfirm({
    privateKey: wallet.keypair.privateKey,
    to: contractAddr,
    data,
    gasLimit,
    extraTargets: [contractAddr],
    label: fnLabel,
  });
  wallet.recordExternalRpcTx({
    txHash: res.txHash,
    rawTx: res.rawTx,
    from: res.senderAddr,
    to: contractAddr,
    contractLabel: 'FracturedHegemony',
    fnLabel,
    dataHex: data,
    blockNumber: Number(res.receipt?.blockNumber || 0),
    nonce: Number(res.nonce),
  });
  watcherHandle?.markReceiptSeen?.(res.receipt);
  return res;
}

async function refreshRealmState() {
  if (!contractAddr || !realmId) return;
  try {
    const rawHex = await slxClient.callAbi(contractAddr, 'getRealmState(bytes32)', [
      ['bytes32', realmId],
    ]);
    const decoded = decodeRealmStateHex(rawHex);
    if (decoded) {
      realmState = decoded;
      renderAll();
      hydrateNicknames(decoded.sovereigns);
    }
  } catch (err) {
    console.warn('[Hegemony] refreshRealmState warning:', err);
  }
}

async function launchUprisingTx() {
  if (txBusy || !contractAddr || !realmId) return;
  txBusy = true;
  renderAll();
  try {
    const idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl,
      appName: 'Fractured Hegemony',
    });
    const idAddr = idRec?.identityAddr || ZERO_ADDR;
    const data = encodeAbi('launchUprising(bytes32,address,uint64)', [
      ['bytes32', realmId],
      ['address', idAddr],
      ['uint64', preferredLanding],
    ]);
    pushFeed(`⏳ Launching Sovereign Uprising near <strong>${SECTORS[preferredLanding]?.name}</strong>…`);
    await sendHegTx({ data, fnLabel: 'launchUprising', gasLimit: 3_500_000n });
    await refreshRealmState();
  } catch (err) {
    pushFeed(`⚠️ Uprising canceled/failed: ${err.message || err}`, 'oath');
    await refreshRealmState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function commitDirectivesTx() {
  if (txBusy || !contractAddr || !realmId || !realmState) return;

  txBusy = true;
  renderAll();
  try {
    await refreshRealmState();
    pruneStagedToCurrentOwnership();

    const mySid = getMySid();
    const mySov = mySid >= 0 ? realmState?.sovereigns?.[mySid] : null;
    if (!mySov || mySov.sectorCount === 0) {
      pushFeed(`⚠️ Your enclave fell in the previous clash — click <strong>⚔️ Launch Sovereign Uprising</strong> to re-enter!`, 'oath');
      return;
    }

    const depEntries = [...stagedDeploys.entries()].slice(0, 6);
    const strEntries = stagedStrikes.slice(0, 6);
    if (!depEntries.length && !strEntries.length) {
      pushFeed(`ℹ️ Stage at least 1 reinforcement or Vector Strike on your owned Sectors first.`);
      return;
    }

    const buf = new Uint8Array(1 + depEntries.length * 3 + 1 + strEntries.length * 4);
    let p = 0;
    buf[p++] = depEntries.length;
    for (const [secId, cnt] of depEntries) {
      buf[p++] = secId & 0xff;
      buf[p++] = (cnt >>> 8) & 0xff;
      buf[p++] = cnt & 0xff;
    }
    buf[p++] = strEntries.length;
    for (const st of strEntries) {
      buf[p++] = st.from & 0xff;
      buf[p++] = st.to & 0xff;
      buf[p++] = (st.count >>> 8) & 0xff;
      buf[p++] = st.count & 0xff;
    }

    const data = encodeAbi('stageDirectives(bytes32,bytes)', [
      ['bytes32', realmId],
      ['bytes', buf],
    ]);
    pushFeed(`🚀 Committing ${depEntries.length} reinforcement(s) &amp; ${strEntries.length} strike(s) for Cycle ${realmState.hdr.cycle}…`);
    await sendHegTx({ data, fnLabel: 'stageDirectives', gasLimit: 3_200_000n });
    stagedDeploys.clear();
    stagedStrikes = [];
    await refreshRealmState();
  } catch (err) {
    pushFeed(`⚠️ Directive commit failed: ${err.message || err}`, 'oath');
    await refreshRealmState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function resolveCycleTx() {
  if (txBusy || !contractAddr || !realmId) return;
  txBusy = true;
  renderAll();
  try {
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: encodeAbi('resolveCycle(bytes32)', [['bytes32', realmId]]),
      gasLimit: 4_200_000n,
      extraTargets: [contractAddr],
      label: 'resolveCycle',
    });
    await refreshRealmState();
  } catch (err) {
    pushFeed(`⚠️ Cycle already resolved by peer keeper or awaiting block.`, '');
    await refreshRealmState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function proposeCompactTx(targetSid) {
  if (txBusy || !contractAddr || !realmId) return;
  txBusy = true;
  try {
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: encodeAbi('proposeCompact(bytes32,uint64)', [
        ['bytes32', realmId],
        ['uint64', targetSid],
      ]),
      gasLimit: 2_500_000n,
      extraTargets: [contractAddr],
      label: 'proposeCompact',
    });
    pushFeed(`🤝 Proposed 6-Cycle Non-Aggression Compact to <strong>${sovName(targetSid)}</strong>!`, 'pact');
    await refreshRealmState();
  } catch (err) {
    pushFeed(`⚠️ Compact proposal failed: ${err.message || err}`, 'oath');
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function ratifyCompactTx(proposerSid) {
  if (txBusy || !contractAddr || !realmId) return;
  txBusy = true;
  try {
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: encodeAbi('ratifyCompact(bytes32,uint64)', [
        ['bytes32', realmId],
        ['uint64', proposerSid],
      ]),
      gasLimit: 2_500_000n,
      extraTargets: [contractAddr],
      label: 'ratifyCompact',
    });
    await refreshRealmState();
  } catch (err) {
    pushFeed(`⚠️ Compact ratification failed: ${err.message || err}`, 'oath');
  } finally {
    txBusy = false;
    renderAll();
  }
}

function autoPlanStage() {
  if (!realmState) return;
  const mySid = getMySid();
  const mySov = mySid >= 0 ? realmState.sovereigns[mySid] : null;
  if (!mySov || mySov.sectorCount === 0) return;

  stagedDeploys.clear();
  stagedStrikes = [];

  // Find best frontline sector
  let frontSec = null;
  let bestScore = -1;
  for (let s = 0; s < 36; s++) {
    if (realmState.sectors[s].owner !== mySid) continue;
    for (const nb of ADJ_SETS[s]) {
      const ow = realmState.sectors[nb].owner;
      if (ow !== mySid) {
        const sc = (SECTORS[nb].relay ? 20 : 0) + (ow === OWNER_WARDEN ? 10 : 5);
        if (sc > bestScore) {
          bestScore = sc;
          frontSec = s;
        }
      }
    }
  }
  if (frontSec != null && mySov.supply > 0) {
    stagedDeploys.set(frontSec, mySov.supply);
  }

  for (let s = 0; s < 36 && stagedStrikes.length < 3; s++) {
    if (realmState.sectors[s].owner !== mySid) continue;
    const eff = realmState.sectors[s].legions + (stagedDeploys.get(s) || 0);
    if (eff < 4) continue;
    for (const nb of ADJ_SETS[s]) {
      const target = realmState.sectors[nb];
      if (target.owner !== mySid && eff - 1 >= target.legions + 1) {
        stagedStrikes.push({ from: s, to: nb, count: Math.max(2, Math.floor((eff - 1) * 0.8)) });
        break;
      }
    }
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Real-Time WebSocket Watcher & App Bootstrap
// ---------------------------------------------------------------------------

function bindLiveWatcher() {
  if (watcherHandle) {
    watcherHandle.unsubscribe();
    watcherHandle = null;
  }
  if (!contractAddr) return;

  watcherHandle = slxWatchChainApp({
    rpcUrl: () => rpcUrl,
    filter: () => ({ address: contractAddr }),
    onHead: (head) => {
      if (head?.blockNumberNum > latestBlock) latestBlock = head.blockNumberNum;
    },
    onLog: (lg) => handleChainLog(lg),
    onRefresh: async () => {
      await refreshRealmState();
    },
  });
}

async function selectRealmInstance(addr, nextRealmId) {
  contractAddr = String(addr || '').toLowerCase();
  realmId = nextRealmId || null;
  if (contractAddr && (!realmId || realmId === '0x' + '0'.repeat(64))) {
    const activeHex = await slxClient.callAbi(contractAddr, 'getActiveRealmId()', []).catch(() => null);
    if (activeHex && activeHex.length >= 66) {
      realmId = activeHex.slice(0, 66).toLowerCase();
    }
  }
  selectedSector = null;
  stagedDeploys.clear();
  stagedStrikes = [];
  seenLogKeys.clear();
  document.getElementById('warFeed').innerHTML = '';
  pushFeed(`📡 Connected to Realm HFS <strong>${shortAddr(contractAddr)}</strong> on Subnet 1.`);
  bindLiveWatcher();
  await refreshRealmState();
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'hegemony',
    title: 'Fractured Hegemony: Simultaneous Sovereign Conquest',
    subtitle:
      'Global Satellite Command Map • 36 Sovereign Sectors • 6 Geopolitical Blocs • 3 Orbital Relays & Compacts',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => contractAddr || '',
    getContractLabel: () => 'Hegemony',
    onWalletSwitch: () => refreshRealmState(),
    getAppPeers: () =>
      (realmState?.sovereigns || [])
        .filter((sv) => sv?.identityAddr && sv.identityAddr !== ZERO_ADDR)
        .map((sv) => ({
          identityAddr: sv.identityAddr,
          label: sovName(sv.sid),
          role: sv.eliminated ? 'Eliminated Sovereign' : `Sovereign Seat #${sv.sid + 1}`,
        })),
    extraElements: [document.getElementById('btnHowToPlay')],
  });

  document.getElementById('btnLaunchUprising').addEventListener('click', launchUprisingTx);
  document.getElementById('btnCommitOrders').addEventListener('click', commitDirectivesTx);
  document.getElementById('btnResolveCycle').addEventListener('click', resolveCycleTx);
  document.getElementById('btnAutoStage').addEventListener('click', autoPlanStage);
  document.getElementById('btnClearStaged').addEventListener('click', () => {
    stagedDeploys.clear();
    stagedStrikes = [];
    renderAll();
  });
  hegGuide = mountSlxGameGuide({
    gameId: 'hegemony',
    headerBtnEl: document.getElementById('btnHowToPlay'),
    welcomeMountEl: document.getElementById('hegWelcomeMount'),
    coachMountEl: document.getElementById('hegCoachMount'),
    onWelcomePrimaryAction: () => {
      const mySid = getMySid();
      const mySov = mySid >= 0 ? realmState?.sovereigns?.[mySid] : null;
      if (!mySov || mySov.sectorCount === 0) {
        launchUprisingTx();
      }
    },
  });

  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  latestBlock = await slxClient.getBlockNumber().catch(() => 0);

  const fallbackAddr = manifest?.hegemony?.contractAddr;
  const fallbackRealmId = manifest?.hegemony?.realmId;

  if (fallbackAddr) {
    await selectRealmInstance(fallbackAddr, fallbackRealmId);
    unifiedHdr?.refresh?.();
  }

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'FRACTURED_HEGEMONY',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => contractAddr || '',
    onSelectInstance: async (inst) => {
      await selectRealmInstance(inst.primaryAddr, inst.meta?.realmId || fallbackRealmId);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
