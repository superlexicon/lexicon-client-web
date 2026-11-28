/**
 * VOLATILE VOLES: Chaotic Burrow Sabotage (`volatile-voles.js` — HFS #22)
 *
 * Tabletop creature-collection & out-of-turn `SQUEAK-NO!` counter-stack sabotage on Subnet 1:
 *  - 25 bespoke illustrated cards (`68`-card Main Deck + `8`-card Baby Vole Nest).
 *  - 1-click Solo Quick Match (1 Human + 3 Tactical AI Bots) OR 2–5 player Human PvP tables.
 *  - Viewer-scoped hand privacy (`0xFE` masked rival card backs) & real-time WebSocket `eth_subscribe` sync.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  encodeAbi,
  readU16BE,
  readU64BE,
  shortAddr,
  shortHex,
  ZERO_ADDR,
  SlxClient,
  SlxWalletManager,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  readOnChainIdentityNickname,
  slxWatchChainApp,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';
import { mountSlxGameGuide } from '@superlexicon/sdk/ui/game-guide';

// ---------------------------------------------------------------------------
// Protocol Constants & Canonical 25-Card Roster (Exact match to `main.rs`)
// ---------------------------------------------------------------------------

const PHASE_LOBBY = 1;
const PHASE_ACTION = 2;
const PHASE_REACTION = 3;
const PHASE_DISCARD = 4;
const PHASE_FINISHED = 5;

const CARD_NONE = 0xff;
const CARD_MASKED_BACK = 0xfe;
const HAND_LIMIT = 7;

const DEFAULT_TABLE_ID =
  '0x564f4c4154494c455f564f4c45535f425552524f575f30310000000000000000';

const BOT_PERSONAS = [
  { name: 'Sgt. Whiskers', icon: '🪖' },
  { name: 'Duchess Nibble', icon: '👑' },
  { name: 'Prof. Gnaw', icon: '🥽' },
  { name: 'Baron Squeak', icon: '🎩' },
  { name: 'Bandit Fuzz', icon: '🦹' },
];

export const CARD_CATALOG = {
  0: {
    id: 0,
    cat: 'baby',
    catLabel: '🍼 Baby Vole',
    name: 'Pipsqueak Spark-Kit',
    short: 'Spark-Kit',
    art: '/assets/volatile-voles/card_00.jpg',
    rule: 'Lives in The Nest. If destroyed, sacrificed, or bounced, returns safely to The Nest.',
    flavor: '“9 volts of pure chaotic joy.”',
    targetMode: 'none',
  },
  1: {
    id: 1,
    cat: 'baby',
    catLabel: '🍼 Baby Vole',
    name: 'Binky Boom-Pup',
    short: 'Boom-Pup',
    art: '/assets/volatile-voles/card_01.jpg',
    rule: 'Lives in The Nest. If destroyed, sacrificed, or bounced, returns safely to The Nest.',
    flavor: '“Who gave the toddler high explosives?!”',
    targetMode: 'none',
  },
  2: {
    id: 2,
    cat: 'baby',
    catLabel: '🍼 Baby Vole',
    name: 'Goggle-Nibble Kit',
    short: 'Goggle-Kit',
    art: '/assets/volatile-voles/card_02.jpg',
    rule: 'Lives in The Nest. If destroyed, sacrificed, or bounced, returns safely to The Nest.',
    flavor: '“Certified to Tighten Things That Shouldn’t Be Tightened.”',
    targetMode: 'none',
  },
  3: {
    id: 3,
    cat: 'baby',
    catLabel: '🍼 Baby Vole',
    name: 'Shroom-Cap Squeaker',
    short: 'Squeaker',
    art: '/assets/volatile-voles/card_03.jpg',
    rule: 'Lives in The Nest. If destroyed, sacrificed, or bounced, returns safely to The Nest.',
    flavor: '“Glows in the dark so you never step on it.”',
    targetMode: 'none',
  },
  4: {
    id: 4,
    cat: 'baby',
    catLabel: '🍼 Baby Vole',
    name: 'Teacup Fuzzball',
    short: 'Fuzzball',
    art: '/assets/volatile-voles/card_04.jpg',
    rule: 'Lives in The Nest. If destroyed, sacrificed, or bounced, returns safely to The Nest.',
    flavor: '“Rolls natural 20s on cuteness checks.”',
    targetMode: 'none',
  },
  5: {
    id: 5,
    cat: 'basic',
    catLabel: '🐹 Basic Vole',
    name: 'Three-Voles-In-A-Coat',
    short: '3-In-A-Coat',
    art: '/assets/volatile-voles/card_05.jpg',
    rule: 'Counts as 1 Vole toward your 7-Vole Victory (despite clearly being three voles).',
    flavor: '“Hello fellow adult human bankers, one mortgage please.”',
    targetMode: 'none',
  },
  6: {
    id: 6,
    cat: 'basic',
    catLabel: '🐹 Basic Vole',
    name: 'LoRa Antenna Vole',
    short: 'LoRa Vole',
    art: '/assets/volatile-voles/card_06.jpg',
    rule: 'Reliable Sub-GHz Burrow scout. Counts as 1 Vole toward Victory.',
    flavor: '“Broadcasts snack coordinates at 915 MHz.”',
    targetMode: 'none',
  },
  7: {
    id: 7,
    cat: 'basic',
    catLabel: '🐹 Basic Vole',
    name: 'Hard-Hat Tunnel Vole',
    short: 'Tunnel Vole',
    art: '/assets/volatile-voles/card_07.jpg',
    rule: 'Fearless burrow excavator. Counts as 1 Vole toward Victory.',
    flavor: '“Zero building permits, maximum enthusiasm.”',
    targetMode: 'none',
  },
  8: {
    id: 8,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Chainsaw Berserker Vole',
    short: 'Chainsaw Vole',
    art: '/assets/volatile-voles/card_08.jpg',
    rule: 'On Enter: Destroy 1 Vole or Perk in a rival Burrow (or saw off a Hex in YOUR Burrow!).',
    flavor: '“Subtlety was never on the agenda.”',
    targetMode: 'destroy_any_card',
  },
  9: {
    id: 9,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Klepto-Magnet Vole',
    short: 'Klepto Vole',
    art: '/assets/volatile-voles/card_09.jpg',
    rule: 'On Enter: Pull 1 random card straight out of a target rival’s Hand into yours!',
    flavor: '“Finders squeakers, losers weepers.”',
    targetMode: 'rival_seat',
  },
  10: {
    id: 10,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Necro-Spore Vole',
    short: 'Necro Vole',
    art: '/assets/volatile-voles/card_10.jpg',
    rule: 'On Enter: Resurrect 1 fallen Vole from the Scrap Heap directly into your Burrow!',
    flavor: '“Rise, my adorable furry minions!”',
    targetMode: 'necro_scrap',
  },
  11: {
    id: 11,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Siren Hypno-Vole',
    short: 'Siren Vole',
    art: '/assets/volatile-voles/card_11.jpg',
    rule: 'On Enter: Discard 1 card from your Hand to Abduct (steal) 1 Vole from a rival Burrow!',
    flavor: '“Look into the shiny pink spirals…”',
    targetMode: 'siren_abduct',
  },
  12: {
    id: 12,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Hazmat Bunker Vole',
    short: 'Hazmat Vole',
    art: '/assets/volatile-voles/card_12.jpg',
    rule: 'Passive: Immune to opponent Destroy, Abduct, and Bounce effects!',
    flavor: '“SPF 10,000 against rival shenanigans.”',
    targetMode: 'none',
  },
  13: {
    id: 13,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Broodmother Mech-Vole',
    short: 'Broodmother',
    art: '/assets/volatile-voles/card_13.jpg',
    rule: 'On Enter: Recruit 1 Baby Vole from The Nest straight into your Burrow (+2 Voles in 1 play)!',
    flavor: '“Armored stroller included.”',
    targetMode: 'none',
  },
  14: {
    id: 14,
    cat: 'mutant',
    catLabel: '⚡ Mutant Vole',
    name: 'Alpha Warlord Vole',
    short: 'Warlord Vole',
    art: '/assets/volatile-voles/card_14.jpg',
    rule: 'Dawn of Turn: Automatically draw +1 bonus card at the start of each of your turns!',
    flavor: '“Victory smells like roasted acorns.”',
    targetMode: 'none',
  },
  15: {
    id: 15,
    cat: 'spell',
    catLabel: '🧪 Chaos Spell',
    name: 'Two-For-One Collapse',
    short: '2-For-1 TNT',
    art: '/assets/volatile-voles/card_15.jpg',
    rule: 'Sacrifice 1 Vole or Hex in your Burrow to Destroy up to 2 cards in a rival’s Burrow!',
    flavor: '“Measure zero times, detonate twice.”',
    targetMode: 'collapse_sac_and_rival',
  },
  16: {
    id: 16,
    cat: 'spell',
    catLabel: '🧪 Chaos Spell',
    name: 'Grand Burrow Heist',
    short: 'Hand Swap',
    art: '/assets/volatile-voles/card_16.jpg',
    rule: 'Trade your entire Hand of cards with any target opponent’s Hand!',
    flavor: '“Enjoy my zero cards, bestie!”',
    targetMode: 'rival_seat',
  },
  17: {
    id: 17,
    cat: 'spell',
    catLabel: '🧪 Chaos Spell',
    name: 'Vole-nado Vortex',
    short: 'Vole-nado',
    art: '/assets/volatile-voles/card_17.jpg',
    rule: 'Bounce 1 non-Hazmat Vole from a rival’s Burrow to their Hand (or Nest) AND draw +1 card!',
    flavor: '“Category 5 fluff cyclone.”',
    targetMode: 'rival_vole',
  },
  18: {
    id: 18,
    cat: 'spell',
    catLabel: '🧪 Chaos Spell',
    name: 'Doomsday EMP Reset',
    short: 'EMP Reset',
    art: '/assets/volatile-voles/card_18.jpg',
    rule: 'Wipe out ALL Perks & Hexes across every player’s Burrow simultaneously!',
    flavor: '“Have you tried turning everyone’s burrow off and on again?”',
    targetMode: 'none',
  },
  19: {
    id: 19,
    cat: 'perk',
    catLabel: '🛡️ Burrow Perk',
    name: 'Overclocked Wheel',
    short: '2x Play Wheel',
    art: '/assets/volatile-voles/card_19.jpg',
    rule: 'Persistent Perk: You may play up to 2 cards during your Action Phase every turn!',
    flavor: '“14,000 RPM of pure rodent velocity.”',
    targetMode: 'none',
  },
  20: {
    id: 20,
    cat: 'perk',
    catLabel: '🛡️ Burrow Perk',
    name: 'Titanium Faraday Dome',
    short: 'Faraday Dome',
    art: '/assets/volatile-voles/card_20.jpg',
    rule: 'Persistent Perk: Your plays ignore standard SQUEAK-NO! counters & your Perks resist single-target destruction!',
    flavor: '“Sorry, can’t hear your Squeak-No inside my forcefield.”',
    targetMode: 'none',
  },
  21: {
    id: 21,
    cat: 'hex',
    catLabel: '☣️ Rival Hex',
    name: 'Hallucinogenic Truffles',
    short: '🥔 Potato Hex',
    art: '/assets/volatile-voles/card_21.jpg',
    rule: 'Curse Rival: Victim’s Voles think they are Potatoes — effective Vole count is capped at 5 (CANNOT WIN until removed)!',
    flavor: '“I am not a vole. I am a delicious russet tuber.”',
    targetMode: 'rival_seat',
  },
  22: {
    id: 22,
    cat: 'hex',
    catLabel: '☣️ Rival Hex',
    name: 'Tin-Foil Muzzle',
    short: '🤐 Muzzle Hex',
    art: '/assets/volatile-voles/card_22.jpg',
    rule: 'Curse Rival: Victim CANNOT play SQUEAK-NO! Instants and loses Dawn-of-Turn Warlord bonus draws!',
    flavor: '“Blocks 5G, telepathy, and counter-squeaks.”',
    targetMode: 'rival_seat',
  },
  23: {
    id: 23,
    cat: 'instant',
    catLabel: '🛑 Instant',
    name: 'SQUEAK-NO!',
    short: 'SQUEAK-NO!',
    art: '/assets/volatile-voles/card_23.jpg',
    rule: 'Play out-of-turn when ANY player plays a card: Cancel their card to the Scrap Heap! (Can be counter-squeaked!)',
    flavor: '“Talk to the paw.”',
    targetMode: 'instant_only',
  },
  24: {
    id: 24,
    cat: 'instant',
    catLabel: '💥 Apex Instant',
    name: 'APEX SQUEAK-NO!',
    short: 'APEX SQUEAK!',
    art: '/assets/volatile-voles/card_24.jpg',
    rule: 'Play out-of-turn: Unconditionally cancel a card! Pierces Faraday Dome & CANNOT be countered!',
    flavor: '“THE COUNCIL OF VOLES SAYS ABSOLUTELY NOT.”',
    targetMode: 'instant_only',
  },
};

// ---------------------------------------------------------------------------
// Runtime State
// ---------------------------------------------------------------------------

const wallet = new SlxWalletManager();
const rpcUrl = getDefaultNodeWsUrl();
const slxClient = new SlxClient(rpcUrl);

let contractAddr = '';
let activeTableId = DEFAULT_TABLE_ID;
let tableState = null;
let txBusy = false;
let stopWatcher = null;
let vvGuide = null;
let bootReadyResolve = null;
const bootReadyPromise = new Promise((r) => {
  bootReadyResolve = r;
});
const nicknameCache = new Map();

// Interactive Card Staging / Targeting Wizard State
let wizard = null; // { handIdx, cardId, step, auxIdx, targetSeat, targetSlot }
let discardMask = 0;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, ms = 3600) {
  const el = document.getElementById('vvToast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.style.display = 'none';
  }, ms);
}

// ---------------------------------------------------------------------------
// Binary Snapshot Decoder (`getTableState(bytes32,address)`)
// ---------------------------------------------------------------------------

function decodeTableSnapshotHex(hex) {
  const b = hexToBytes(hex);
  if (!b || b.length < 44 || b[0] !== 1) return null;

  const phase = b[1];
  const seatCount = b[2];
  const turnSeat = b[3];
  const playsRemaining = b[4];
  const targetVoles = b[5];
  const winnerSeat = b[6];
  const turnNumber = readU16BE(b, 7);
  const deckLen = b[9];
  const nestLen = b[10];
  const scrapLen = b[11];
  const topScrap = b[12];
  const logCount = b[13];
  const viewerSeat = b[14];
  const currentBlock = Number(readU64BE(b, 16));
  const expiresBlock = Number(readU64BE(b, 24));

  const pending = {
    active: b[32] === 1,
    actorSeat: b[33],
    cardId: b[34],
    targetSeat: b[35],
    targetSlot: b[36],
    auxIdx: b[37],
    squeakDepth: b[38],
    lastSqueakerSeat: b[39],
    passedMask: b[40],
    shieldedByDome: b[41] === 1,
  };

  let pos = 44;
  const seats = [];
  for (let i = 0; i < seatCount; i++) {
    if (pos + 84 > b.length) break;
    const eoa = bytesToHex(b.subarray(pos, pos + 20)).toLowerCase();
    const identity = bytesToHex(b.subarray(pos + 20, pos + 40)).toLowerCase();
    const isBot = b[pos + 40] === 1;
    const wins = readU16BE(b, pos + 41);
    const rawVolesLen = b[pos + 43];
    const effectiveVolesLen = b[pos + 44];
    const modsLen = b[pos + 45];
    const handLen = b[pos + 46];
    const flags = b[pos + 47];

    const voles = [];
    for (let v = 0; v < rawVolesLen && v < 12; v++) {
      const c = b[pos + 48 + v];
      if (c !== CARD_NONE) voles.push(c);
    }
    const mods = [];
    for (let m = 0; m < modsLen && m < 8; m++) {
      const c = b[pos + 60 + m];
      if (c !== CARD_NONE) mods.push(c);
    }
    const hand = [];
    for (let h = 0; h < handLen && h < 16; h++) {
      const c = b[pos + 68 + h];
      if (c !== CARD_NONE) hand.push(c);
    }

    seats.push({
      seatIdx: i,
      eoa,
      identity,
      isBot,
      wins,
      rawVolesLen,
      effectiveVolesLen,
      modsLen,
      handLen,
      trufflesCursed: (flags & 1) !== 0,
      muzzled: (flags & 2) !== 0,
      hasWheel: (flags & 4) !== 0,
      hasDome: (flags & 8) !== 0,
      voles,
      mods,
      hand,
    });
    pos += 84;
  }

  const nest = [];
  if (pos + 8 <= b.length) {
    for (let n = 0; n < nestLen && n < 8; n++) {
      if (b[pos + n] !== CARD_NONE) nest.push(b[pos + n]);
    }
    pos += 8;
  }

  const scrap = [];
  if (pos + scrapLen <= b.length) {
    for (let s = 0; s < scrapLen; s++) {
      if (b[pos + s] !== CARD_NONE) scrap.push(b[pos + s]);
    }
    pos += scrapLen;
  }

  const logs = [];
  for (let l = 0; l < logCount; l++) {
    if (pos + 8 > b.length) break;
    logs.push({
      turn: readU16BE(b, pos),
      actorSeat: b[pos + 2],
      kind: b[pos + 3],
      cardId: b[pos + 4],
      targetSeat: b[pos + 5],
      auxCard: b[pos + 6],
      flags: b[pos + 7],
    });
    pos += 8;
  }

  return {
    phase,
    seatCount,
    turnSeat,
    playsRemaining,
    targetVoles,
    winnerSeat,
    turnNumber,
    deckLen,
    nestLen,
    scrapLen,
    topScrap,
    viewerSeat,
    currentBlock,
    expiresBlock,
    pending,
    seats,
    nest,
    scrap,
    logs,
  };
}

function seatDisplayName(seatIdx) {
  const s = tableState?.seats?.[seatIdx];
  if (!s) return `Seat #${seatIdx + 1}`;
  if (s.isBot) {
    const p = BOT_PERSONAS[seatIdx % BOT_PERSONAS.length];
    return `${p.icon} ${p.name}`;
  }
  if (s.eoa === wallet.keypair.address.toLowerCase()) {
    const myNick = wallet.getIdentityRecord()?.nickname;
    return myNick ? `🧑 ${myNick} (You)` : `🧑 You (${shortAddr(s.eoa)})`;
  }
  if (s.identity && s.identity !== ZERO_ADDR && nicknameCache.has(s.identity)) {
    return `🧑 ${nicknameCache.get(s.identity)}`;
  }
  return `🧑 Player ${shortAddr(s.eoa)}`;
}

async function hydrateNicknames(seats) {
  let updated = false;
  await Promise.all(
    (seats || []).map(async (s) => {
      if (s.isBot || !s.identity || s.identity === ZERO_ADDR || nicknameCache.has(s.identity)) return;
      const nick = await readOnChainIdentityNickname(rpcUrl, s.identity).catch(() => null);
      if (nick) {
        nicknameCache.set(s.identity, nick);
        updated = true;
      }
    })
  );
  if (updated) renderAll();
}

// ---------------------------------------------------------------------------
// RPC Read & Write Helpers (`$0.00` Gas on Subnet 1)
// ---------------------------------------------------------------------------

async function refreshTableState() {
  if (!contractAddr || !activeTableId) {
    renderAll();
    return;
  }
  try {
    const myEoa = wallet.keypair.address.toLowerCase();
    const hex = await slxNodeRpc(rpcUrl, 'eth_call', [
      {
        to: contractAddr,
        data: encodeAbi('getTableState(bytes32,address)', [
          ['bytes32', activeTableId],
          ['address', myEoa],
        ]),
      },
      'latest',
    ]);
    tableState = hex && hex !== '0x' ? decodeTableSnapshotHex(hex) : null;
    if (tableState?.seats) {
      hydrateNicknames(tableState.seats);
    }
  } catch (_) {
    // Keep last known state if transient socket reconnect
  }
  renderAll();
}

async function sendVolesTx(label, calldataHex, extraTargets = []) {
  if (txBusy) return false;
  if (!contractAddr) {
    await bootReadyPromise;
  }
  if (!contractAddr) {
    showToast('⚠ Burrow Arena HFS contract not configured.');
    return false;
  }
  let idRec;
  try {
    idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl: getDefaultNodeWsUrl(),
      appName: 'Volatile Voles',
    });
  } catch (err) {
    showToast(`⚠ Identity HFS required: ${err?.message || err}`);
    return false;
  }
  if (!idRec?.identityAddr || idRec.identityAddr === ZERO_ADDR) {
    showToast('⚠ Please deploy your Identity HFS first to play Volatile Voles.');
    return false;
  }
  txBusy = true;
  renderAll();
  try {
    const uniqTargets = Array.from(
      new Set([contractAddr, idRec.identityAddr, ...extraTargets].filter(Boolean).map((a) => a.toLowerCase()))
    );
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: calldataHex,
      gasLimit: 5_000_000n,
      extraTargets: uniqTargets,
      label,
    });
    wizard = null;
    discardMask = 0;
    await refreshTableState();
    return true;
  } catch (err) {
    showToast(`⚠ ${err?.message || err}`);
    await refreshTableState();
    return false;
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function quickMatchTx(botCount = 3, targetVoles = 7) {
  let idRec;
  try {
    idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl: getDefaultNodeWsUrl(),
      appName: 'Volatile Voles',
    });
  } catch (err) {
    showToast(`⚠ Identity HFS required: ${err?.message || err}`);
    return;
  }
  const idAddr = idRec?.identityAddr || ZERO_ADDR;
  if (!idAddr || idAddr === ZERO_ADDR) {
    showToast('⚠ Please deploy your Identity HFS first to play Volatile Voles.');
    return;
  }
  // Use a player-scoped quick-match table ID if the shared default table is mid-match with other humans!
  if (
    tableState &&
    tableState.phase !== PHASE_LOBBY &&
    tableState.phase !== PHASE_FINISHED &&
    tableState.viewerSeat === 0xff
  ) {
    activeTableId = bytesToHex(concatBytes(utf8ToBytes('VV_SOLO_'), hexToBytes(wallet.keypair.address), new Uint8Array(4)));
  }
  showToast('⚡ Dealing 1 Baby Vole + 5 cards into your Burrow…');
  await sendVolesTx(
    'quickStartSolo',
    encodeAbi('quickStartSolo(bytes32,address,uint64,uint64)', [
      ['bytes32', activeTableId],
      ['address', idAddr],
      ['uint64', BigInt(botCount)],
      ['uint64', BigInt(targetVoles)],
    ])
  );
}

// ---------------------------------------------------------------------------
// Interactive Card Play & Smart Target Wizard
// ---------------------------------------------------------------------------

function getMySeat() {
  if (!tableState || tableState.viewerSeat === 0xff) return null;
  return tableState.seats[tableState.viewerSeat] || null;
}

function isMyActionTurn() {
  return (
    tableState &&
    tableState.phase === PHASE_ACTION &&
    tableState.viewerSeat !== 0xff &&
    tableState.turnSeat === tableState.viewerSeat &&
    tableState.playsRemaining > 0
  );
}

function handleHandCardClick(handIdx) {
  const me = getMySeat();
  if (!me || txBusy) return;
  const cardId = me.hand[handIdx];
  const spec = CARD_CATALOG[cardId];
  if (!spec) return;

  // Discard Excess Phase: toggle card in bitmask!
  if (tableState.phase === PHASE_DISCARD && tableState.turnSeat === tableState.viewerSeat) {
    discardMask ^= 1 << handIdx;
    renderAll();
    return;
  }

  // Reaction Phase: if user clicks SQUEAK-NO! or APEX SQUEAK-NO! in hand directly, fire it!
  if (tableState.phase === PHASE_REACTION && (cardId === 23 || cardId === 24)) {
    sendVolesTx(
      'playSqueakNo',
      encodeAbi('playSqueakNo(bytes32,uint64)', [
        ['bytes32', activeTableId],
        ['uint64', BigInt(handIdx)],
      ])
    );
    return;
  }

  if (!isMyActionTurn()) {
    openCardDetailModal(cardId);
    return;
  }

  if (spec.targetMode === 'instant_only') {
    showToast('🛑 SQUEAK-NO! is an Instant — hold it to cancel a rival card out-of-turn!');
    return;
  }

  if (wizard && wizard.handIdx === handIdx) {
    wizard = null;
    renderAll();
    return;
  }

  // Cards requiring zero targeting fire in 1 click (or Necro auto-picks or opens Scrap picker if >1 Vole in Scrap)
  if (spec.targetMode === 'none') {
    sendVolesTx(
      `playCard(${spec.short})`,
      encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
        ['bytes32', activeTableId],
        ['uint64', BigInt(handIdx)],
        ['uint64', BigInt(tableState.viewerSeat)],
        ['uint64', 0n],
        ['uint64', 0n],
      ])
    );
    return;
  }

  if (spec.targetMode === 'necro_scrap') {
    const scrapVoles = tableState.scrap
      .map((cid, sIdx) => ({ cid, sIdx }))
      .filter((x) => x.cid <= 14);
    if (scrapVoles.length <= 1) {
      const aux = scrapVoles.length === 1 ? scrapVoles[0].sIdx : 0xff;
      sendVolesTx(
        `playCard(${spec.short})`,
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(handIdx)],
          ['uint64', BigInt(tableState.viewerSeat)],
          ['uint64', 0n],
          ['uint64', BigInt(aux)],
        ])
      );
      return;
    }
  }

  // Otherwise open clean 1-click Target Wizard Bar right above hand!
  wizard = {
    handIdx,
    cardId,
    mode: spec.targetMode,
    sacSlot: null,
    discardIdx: null,
  };
  renderAll();
}

// ---------------------------------------------------------------------------
// Rendering Engine
// ---------------------------------------------------------------------------

function renderCardHtml(cardId, { compact = false, selected = false, badgeHtml = '', dataAttrs = '' } = {}) {
  if (cardId === CARD_MASKED_BACK) {
    return `
      <div class="vv-card ${compact ? 'compact' : ''}" style="cursor:default;">
        <div class="vv-card-art" style="height:100%;">
          <img src="/assets/volatile-voles/card_back.jpg" alt="Hidden Card" />
        </div>
      </div>
    `;
  }
  const c = CARD_CATALOG[cardId] || CARD_CATALOG[5];
  return `
    <button type="button" class="vv-card ${compact ? 'compact' : ''} cat-${c.cat} ${selected ? 'selected' : ''}" ${dataAttrs} title="${esc(c.name)} — ${esc(c.rule)}">
      <div class="vv-card-top">
        <span>${esc(c.catLabel)}</span>
        ${badgeHtml}
      </div>
      <div class="vv-card-art">
        <img src="${esc(c.art)}" alt="${esc(c.name)}" loading="lazy" />
      </div>
      <div class="vv-card-body">
        <div class="vv-card-name">${esc(c.name)}</div>
        <div class="vv-card-rule">${esc(c.rule)}</div>
      </div>
    </button>
  `;
}

function renderOpponents() {
  const row = document.getElementById('opponentsRow');
  if (!row) return;
  if (!tableState || !tableState.seats.length) {
    row.innerHTML = '';
    return;
  }
  const myIdx = tableState.viewerSeat;
  const rivals = tableState.seats.filter((s) => s.seatIdx !== myIdx);
  if (!rivals.length) {
    row.innerHTML = '';
    return;
  }

  row.innerHTML = rivals
    .map((s) => {
      const isTurn = tableState.phase === PHASE_ACTION && tableState.turnSeat === s.seatIdx;
      const seatTargetable =
        wizard && (wizard.mode === 'rival_seat' || (wizard.mode === 'collapse_sac_and_rival' && wizard.sacSlot !== null));
      const meterLabel = s.trufflesCursed
        ? `🥔 ${s.effectiveVolesLen}/${tableState.targetVoles} (Raw ${s.rawVolesLen})`
        : `🐹 ${s.effectiveVolesLen} / ${tableState.targetVoles} Voles`;

      const modsHtml = s.mods
        .map((mId, mSlot) => {
          const mc = CARD_CATALOG[mId];
          if (!mc) return '';
          const canSawMod =
            wizard &&
            wizard.mode === 'destroy_any_card' &&
            !(mc.cat === 'perk' && s.hasDome);
          return `<span class="vv-mod-pill ${mc.cat} ${canSawMod ? 'target-highlight' : ''}" data-target-seat="${s.seatIdx}" data-target-slot="${100 + mSlot}" data-zoom-card="${mId}" title="${esc(mc.name)}: ${esc(mc.rule)}">${esc(mc.short)}</span>`;
        })
        .join('');

      const volesHtml = s.voles.length
        ? s.voles
            .map((vId, vSlot) => {
              const vc = CARD_CATALOG[vId] || CARD_CATALOG[0];
              const canTargetVole =
                wizard &&
                vId !== 12 &&
                (wizard.mode === 'destroy_any_card' ||
                  wizard.mode === 'rival_vole' ||
                  (wizard.mode === 'siren_abduct' && wizard.discardIdx !== null) ||
                  (wizard.mode === 'collapse_sac_and_rival' && wizard.sacSlot !== null));
              return `
                <button type="button" class="vv-mini-vole ${canTargetVole ? 'target-highlight' : ''}" data-target-seat="${s.seatIdx}" data-target-slot="${vSlot}" data-zoom-card="${vId}" title="${esc(vc.name)} — ${esc(vc.rule)}">
                  <img src="${esc(vc.art)}" alt="${esc(vc.short)}" />
                  <span class="vv-mini-vole-tag">${esc(vc.short)}</span>
                </button>
              `;
            })
            .join('')
        : `<span class="vv-muted">Empty Burrow</span>`;

      return `
        <div class="vv-opp-card ${isTurn ? 'active-turn' : ''} ${seatTargetable ? 'targetable' : ''}" ${seatTargetable ? `data-pick-rival-seat="${s.seatIdx}"` : ''}>
          <div class="vv-opp-top">
            <div class="vv-opp-name">
              <span>${esc(seatDisplayName(s.seatIdx))}</span>
              ${isTurn ? '<span style="color:#fbbf24;font-size:0.68rem;">● TURN</span>' : ''}
            </div>
            <span class="vv-vole-meter mono ${s.trufflesCursed ? 'cursed' : ''}">${esc(meterLabel)}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <span class="mono vv-muted">🃏 ${s.handLen} card${s.handLen === 1 ? '' : 's'} in hand • 🏆 ${s.wins}W</span>
            <div class="vv-mod-pills">${modsHtml}</div>
          </div>
          <div class="vv-opp-burrow-row">${volesHtml}</div>
        </div>
      `;
    })
    .join('');
}

function renderCenterStage() {
  const stage = document.getElementById('centerStagePanel');
  const nestLbl = document.getElementById('lblNestCount');
  const deckLbl = document.getElementById('lblDeckCount');
  const scrapLbl = document.getElementById('lblScrapCount');
  const topScrapLbl = document.getElementById('lblTopScrap');
  const scrapArt = document.getElementById('scrapArtWrap');
  const playsLbl = document.getElementById('lblPlaysLeft');
  const btnForage = document.getElementById('btnForageDraw');

  if (!tableState) {
    if (nestLbl) nestLbl.textContent = '8';
    if (deckLbl) deckLbl.textContent = '68';
    if (scrapLbl) scrapLbl.textContent = '0';
    if (btnForage) btnForage.disabled = true;
    stage.className = 'vv-stage-panel';
    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:5px;">
        <div style="font-size:1rem;font-weight:800;color:#fde68a;">🐹 Welcome to the High-Voltage Burrow!</div>
        <div style="font-size:0.78rem;color:#cbd5e1;max-width:62ch;">
          Collect <strong>7 Voles</strong> in your Burrow before your rivals! Start with 1 adorable Baby Vole + 5 cards, unleash Chainsaw &amp; Hypno-Voles, drop Potato Truffle Hexes, and slam <strong>SQUEAK-NO!</strong> out of turn at <strong>$0.00 gas</strong>.
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="vv-btn vv-btn-amber" id="btnStageStartQuick" ${txBusy ? 'disabled' : ''}>
          ${txBusy ? '⏳ Dealing Cards…' : '⚡ Start Quick Match (You + 3 AI Bots)'}
        </button>
        <button type="button" class="vv-btn" id="btnStageCreatePvp" ${txBusy ? 'disabled' : ''}>
          🪑 Open PvP Table
        </button>
      </div>
    `;
    document.getElementById('btnStageStartQuick')?.addEventListener('click', () => quickMatchTx(3, 7));
    document.getElementById('btnStageCreatePvp')?.addEventListener('click', openPvpLobbyModal);
    return;
  }

  if (nestLbl) nestLbl.textContent = String(tableState.nestLen);
  if (deckLbl) deckLbl.textContent = String(tableState.deckLen);
  if (scrapLbl) scrapLbl.textContent = String(tableState.scrapLen);
  if (playsLbl) {
    playsLbl.textContent = isMyActionTurn()
      ? `${tableState.playsRemaining} play${tableState.playsRemaining === 1 ? '' : 's'} left`
      : 'Main Deck';
  }
  if (btnForage) {
    btnForage.disabled = txBusy || !isMyActionTurn();
  }

  if (tableState.topScrap !== CARD_NONE && CARD_CATALOG[tableState.topScrap]) {
    const tc = CARD_CATALOG[tableState.topScrap];
    topScrapLbl.textContent = tc.short;
    scrapArt.innerHTML = `<img src="${esc(tc.art)}" alt="${esc(tc.name)}" /><span class="vv-pile-cnt mono">${tableState.scrapLen}</span>`;
  } else {
    topScrapLbl.textContent = 'Empty';
    scrapArt.innerHTML = `<div class="vv-pile-empty">🗑️</div><span class="vv-pile-cnt mono">0</span>`;
  }

  // 1) PHASE_LOBBY
  if (tableState.phase === PHASE_LOBBY) {
    const seated = tableState.viewerSeat !== 0xff;
    stage.className = 'vv-stage-panel';
    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <strong style="font-size:0.95rem;color:#bae6fd;">🪑 PvP Burrow Lobby (${tableState.seatCount} / 5 Players Seated)</strong>
        <span style="font-size:0.76rem;color:#cbd5e1;">Invite friends to join this Table, or fill remaining seats with Tactical AI Vole Bots and deal!</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${
          !seated
            ? `<button type="button" class="vv-btn vv-btn-emerald" id="btnLobbyJoin" ${txBusy ? 'disabled' : ''}>🪑 Join Table</button>`
            : `<button type="button" class="vv-btn vv-btn-emerald" id="btnLobbyStartPvp" ${txBusy || tableState.seatCount < 2 ? 'disabled' : ''}>▶ Start (${tableState.seatCount} Humans)</button>
               <button type="button" class="vv-btn vv-btn-amber" id="btnLobbyStartBots" ${txBusy ? 'disabled' : ''}>🤖 Fill to 4 w/ AI &amp; Start</button>`
        }
      </div>
    `;
    document.getElementById('btnLobbyJoin')?.addEventListener('click', async () => {
      try {
        const idRec = await wallet.ensureIdentityWithPrompt({
          rpcUrl: getDefaultNodeWsUrl(),
          appName: 'Volatile Voles',
        });
        if (!idRec?.identityAddr || idRec.identityAddr === ZERO_ADDR) {
          showToast('⚠ Please deploy your Identity HFS first to play Volatile Voles.');
          return;
        }
        sendVolesTx(
          'joinTable',
          encodeAbi('joinTable(bytes32,address)', [
            ['bytes32', activeTableId],
            ['address', idRec.identityAddr],
          ])
        );
      } catch (err) {
        showToast(`⚠ Identity HFS required: ${err?.message || err}`);
      }
    });
    document.getElementById('btnLobbyStartPvp')?.addEventListener('click', () => {
      sendVolesTx('startMatch', encodeAbi('startMatch(bytes32,uint64)', [['bytes32', activeTableId], ['uint64', 0n]]));
    });
    document.getElementById('btnLobbyStartBots')?.addEventListener('click', () => {
      sendVolesTx('startMatch', encodeAbi('startMatch(bytes32,uint64)', [['bytes32', activeTableId], ['uint64', 4n]]));
    });
    return;
  }

  // 2) PHASE_REACTION (SQUEAK-NO! Counter-Stack!)
  if (tableState.phase === PHASE_REACTION && tableState.pending.active) {
    const p = tableState.pending;
    const c = CARD_CATALOG[p.cardId] || CARD_CATALOG[5];
    const isFizzling = p.squeakDepth % 2 === 1;
    const stackOwner = p.squeakDepth === 0 ? p.actorSeat : p.lastSqueakerSeat;
    const me = getMySeat();
    const blocksLeft = Math.max(0, tableState.expiresBlock - tableState.currentBlock);

    let mySqueakIdx = -1;
    let myApexIdx = -1;
    if (me && !me.muzzled && me.seatIdx !== stackOwner) {
      if (!p.shieldedByDome || p.squeakDepth > 0) {
        mySqueakIdx = me.hand.findIndex((cid) => cid === 23);
      }
      myApexIdx = me.hand.findIndex((cid) => cid === 24);
    }
    const alreadyPassed = me ? (p.passedMask & (1 << me.seatIdx)) !== 0 : false;

    stage.className = 'vv-stage-panel reaction-alert';
    stage.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        <img src="${esc(c.art)}" alt="${esc(c.name)}" style="width:66px;height:66px;border-radius:10px;object-fit:cover;border:2px solid #fb7185;flex-shrink:0;" />
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div class="mono" style="font-size:0.7rem;color:#fda4af;font-weight:800;">
            🛑 SQUEAK-NO! COUNTER WINDOW • DEPTH #${p.squeakDepth} • ${isFizzling ? '❌ CURRENTLY CANCELED' : '⚡ CURRENTLY RESOLVING'}
          </div>
          <div style="font-size:0.9rem;font-weight:800;color:#fff;">
            ${esc(seatDisplayName(p.actorSeat))} played <span style="color:#fde047;">${esc(c.name)}</span>
            ${p.targetSeat < tableState.seatCount && p.targetSeat !== p.actorSeat ? ` → ${esc(seatDisplayName(p.targetSeat))}` : ''}
          </div>
          <div style="font-size:0.73rem;color:#fecdd3;">
            ${esc(c.rule)} ${p.shieldedByDome ? '• 🛡️ Shielded by Faraday Dome (only APEX SQUEAK-NO! can cancel!)' : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;">
        ${
          mySqueakIdx >= 0
            ? `<button type="button" class="vv-btn vv-btn-crimson" id="btnSlamSqueak" ${txBusy ? 'disabled' : ''}>
                 🛑 ${isFizzling ? 'COUNTER-SQUEAK!' : 'SLAM SQUEAK-NO!'}
               </button>`
            : ''
        }
        ${
          myApexIdx >= 0
            ? `<button type="button" class="vv-btn vv-btn-crimson" id="btnSlamApex" ${txBusy ? 'disabled' : ''}>
                 💥 SLAM APEX SQUEAK-NO!
               </button>`
            : ''
        }
        ${
          me && me.seatIdx !== stackOwner && !alreadyPassed
            ? `<button type="button" class="vv-btn vv-btn-emerald" id="btnPassReaction" ${txBusy ? 'disabled' : ''}>
                 ✓ Allow / Pass
               </button>`
            : ''
        }
        ${
          blocksLeft === 0
            ? `<button type="button" class="vv-btn vv-btn-amber" id="btnFinalizeReaction" ${txBusy ? 'disabled' : ''}>
                 ⏱ Finalize Stack Now
               </button>`
            : `<span class="mono vv-muted">${blocksLeft} blk window</span>`
        }
      </div>
    `;
    document.getElementById('btnSlamSqueak')?.addEventListener('click', () =>
      sendVolesTx('playSqueakNo', encodeAbi('playSqueakNo(bytes32,uint64)', [['bytes32', activeTableId], ['uint64', BigInt(mySqueakIdx)]]))
    );
    document.getElementById('btnSlamApex')?.addEventListener('click', () =>
      sendVolesTx('playSqueakNo', encodeAbi('playSqueakNo(bytes32,uint64)', [['bytes32', activeTableId], ['uint64', BigInt(myApexIdx)]]))
    );
    document.getElementById('btnPassReaction')?.addEventListener('click', () =>
      sendVolesTx('passReaction', encodeAbi('passReaction(bytes32)', [['bytes32', activeTableId]]))
    );
    document.getElementById('btnFinalizeReaction')?.addEventListener('click', () =>
      sendVolesTx('resolveReaction', encodeAbi('resolveReaction(bytes32)', [['bytes32', activeTableId]]))
    );
    return;
  }

  // 3) PHASE_FINISHED (Victory Celebration + 1-Click Rematch!)
  if (tableState.phase === PHASE_FINISHED) {
    const winName = seatDisplayName(tableState.winnerSeat);
    const iWon = tableState.winnerSeat === tableState.viewerSeat;
    stage.className = 'vv-stage-panel';
    stage.style.borderColor = 'rgba(251, 191, 36, 0.85)';
    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:1.02rem;font-weight:800;color:#fde047;">
          🏆 ${iWon ? 'SUPREME BURROW VICTORY — YOU WON!' : `${esc(winName)} Assembled ${tableState.targetVoles} Voles & Won!`}
        </div>
        <div style="font-size:0.76rem;color:#cbd5e1;">
          All player hands are now revealed face-up! Ready for another round of burrow sabotage?
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="vv-btn vv-btn-amber" id="btnRematchNow" ${txBusy ? 'disabled' : ''}>
          🔄 Play Rematch
        </button>
        <button type="button" class="vv-btn" id="btnNewSoloFromWin" ${txBusy ? 'disabled' : ''}>
          ⚡ Fresh Quick Match
        </button>
      </div>
    `;
    document.getElementById('btnRematchNow')?.addEventListener('click', () =>
      sendVolesTx('rematchTable', encodeAbi('rematchTable(bytes32)', [['bytes32', activeTableId]]))
    );
    document.getElementById('btnNewSoloFromWin')?.addEventListener('click', () => quickMatchTx(3, 7));
    return;
  }

  // 4) PHASE_DISCARD (7-Card Hand Limit!)
  if (tableState.phase === PHASE_DISCARD && tableState.turnSeat === tableState.viewerSeat) {
    const me = getMySeat();
    const dropReq = Math.max(0, (me?.handLen || 0) - HAND_LIMIT);
    let chosen = 0;
    for (let b = 0; b < 16; b++) if ((discardMask >> b) & 1) chosen++;
    stage.className = 'vv-stage-panel';
    stage.innerHTML = `
      <div>
        <strong style="color:#fde047;">🗑️ End-of-Turn Hand Limit (${me?.handLen || 0} → 7 Cards)</strong>
        <div style="font-size:0.76rem;color:#cbd5e1;">Click <strong>${dropReq}</strong> card${dropReq === 1 ? '' : 's'} in your Hand below to discard (${chosen} / ${dropReq} selected).</div>
      </div>
      <button type="button" class="vv-btn vv-btn-amber" id="btnConfirmDiscard" ${txBusy || chosen !== dropReq ? 'disabled' : ''}>
        ✓ Discard ${chosen} Card${chosen === 1 ? '' : 's'}
      </button>
    `;
    document.getElementById('btnConfirmDiscard')?.addEventListener('click', () =>
      sendVolesTx('discardExcess', encodeAbi('discardExcess(bytes32,uint64)', [['bytes32', activeTableId], ['uint64', BigInt(discardMask)]]))
    );
    return;
  }

  // 5) Standard Active Turn Prompt
  stage.className = 'vv-stage-panel';
  stage.style.borderColor = '';
  const activeName = seatDisplayName(tableState.turnSeat);
  if (isMyActionTurn()) {
    stage.innerHTML = `
      <div>
        <strong style="font-size:0.92rem;color:#6ee7b7;">🎯 Your Action Phase (${tableState.playsRemaining} Play${tableState.playsRemaining === 1 ? '' : 's'} Available)</strong>
        <div style="font-size:0.76rem;color:#cbd5e1;">Click any <strong>Vole, Perk, Hex, or Chaos Spell</strong> in your Hand below to play it — OR click <strong>🌰 Forage (+1)</strong> on the Draw Pile!</div>
      </div>
      <span class="mono" style="font-size:0.72rem;color:#fde68a;"> Dawn &amp; Draw completed ✓ </span>
    `;
  } else {
    stage.innerHTML = `
      <div>
        <strong style="font-size:0.9rem;color:#bae6fd;">⏳ ${esc(activeName)} is taking Turn #${tableState.turnNumber}…</strong>
        <div style="font-size:0.75rem;color:#94a3b8;">Keep your <strong>🛑 SQUEAK-NO!</strong> Instants ready in case they drop a game-winning Vole or Hex!</div>
      </div>
    `;
  }
}

function renderMyBurrowAndHand() {
  const burrowCards = document.getElementById('myBurrowCards');
  const myTitle = document.getElementById('lblMyBurrowTitle');
  const myMeter = document.getElementById('lblMyVoleMeter');
  const myMods = document.getElementById('myModPills');
  const handCountLbl = document.getElementById('lblHandCounter');
  const btnEndEarly = document.getElementById('btnEndActionEarly');
  const handFan = document.getElementById('myHandFan');
  const targetBar = document.getElementById('targetingBar');

  const me = getMySeat();
  if (!me) {
    myTitle.textContent = '🏡 Spectator View';
    myMeter.textContent = '0 / 7 Voles';
    myMods.innerHTML = '';
    handCountLbl.textContent = 'Not seated';
    btnEndEarly.style.display = 'none';
    targetBar.style.display = 'none';
    burrowCards.innerHTML = `<span class="vv-muted">Click <strong>⚡ Quick Match</strong> above to deal your own Burrow &amp; Hand!</span>`;
    handFan.innerHTML = `<span class="vv-muted">Your 5-card starting hand will appear here as soon as you join or start a match.</span>`;
    return;
  }

  myTitle.textContent = `🏡 ${seatDisplayName(me.seatIdx)}’s Burrow`;
  myMeter.className = `vv-vole-meter mono ${me.trufflesCursed ? 'cursed' : ''}`;
  myMeter.textContent = me.trufflesCursed
    ? `🥔 ${me.effectiveVolesLen} / ${tableState.targetVoles} (Capped! Raw ${me.rawVolesLen})`
    : `🐹 ${me.effectiveVolesLen} / ${tableState.targetVoles} Voles`;
  handCountLbl.textContent = `Hand: ${me.handLen} / ${HAND_LIMIT}`;

  // Show "End Turn ->" if player has Hamster Wheel (2 plays), already played 1, and wants to hold remaining cards
  btnEndEarly.style.display = isMyActionTurn() && me.hasWheel && tableState.playsRemaining === 1 ? 'inline-flex' : 'none';

  myMods.innerHTML = me.mods
    .map((mId, mSlot) => {
      const mc = CARD_CATALOG[mId];
      if (!mc) return '';
      const highlightSelfHex =
        wizard &&
        ((wizard.mode === 'destroy_any_card' && mc.cat === 'hex') ||
          (wizard.mode === 'collapse_sac_and_rival' && wizard.sacSlot === null));
      return `<span class="vv-mod-pill ${mc.cat} ${highlightSelfHex ? 'target-highlight' : ''}" data-own-mod-slot="${100 + mSlot}" data-zoom-card="${mId}" title="${esc(mc.name)} — ${esc(mc.rule)}">${esc(mc.short)}</span>`;
    })
    .join('');

  burrowCards.innerHTML = me.voles.length
    ? me.voles
        .map((vId, vSlot) => {
          const highlightSac = wizard && wizard.mode === 'collapse_sac_and_rival' && wizard.sacSlot === null;
          return renderCardHtml(vId, {
            compact: true,
            selected: highlightSac,
            dataAttrs: `data-own-vole-slot="${vSlot}" data-zoom-card="${vId}"`,
          });
        })
        .join('')
    : `<span class="vv-muted">Your Burrow has 0 Voles! Play a Vole from your Hand below!</span>`;

  // Render Smart Target Wizard Bar if active
  if (wizard) {
    targetBar.style.display = 'flex';
    const wc = CARD_CATALOG[wizard.cardId];
    const rivals = tableState.seats.filter((s) => s.seatIdx !== me.seatIdx);
    let promptHtml = '';
    let quickButtonsHtml = '';

    if (wizard.mode === 'rival_seat') {
      promptHtml = `🎯 Choose a rival for <strong>${esc(wc.name)}</strong>:`;
      quickButtonsHtml = rivals
        .map(
          (r) =>
            `<button type="button" class="vv-btn vv-btn-amber" data-wiz-rival="${r.seatIdx}">${esc(seatDisplayName(r.seatIdx))} (${r.effectiveVolesLen}🐹, ${r.handLen}🃏)</button>`
        )
        .join('');
    } else if (wizard.mode === 'rival_vole') {
      promptHtml = `🌪️ Pick a non-Hazmat Vole to bounce with <strong>${esc(wc.name)}</strong>:`;
      quickButtonsHtml = rivals
        .flatMap((r) =>
          r.voles
            .map((vId, vSlot) =>
              vId === 12
                ? ''
                : `<button type="button" class="vv-btn vv-btn-amber" data-wiz-target="${r.seatIdx}:${vSlot}">${esc(seatDisplayName(r.seatIdx))}: ${esc(CARD_CATALOG[vId]?.short || 'Vole')}</button>`
            )
            .filter(Boolean)
        )
        .join('');
    } else if (wizard.mode === 'destroy_any_card') {
      promptHtml = `🪚 Pick a rival Vole/Perk (or your own cursed Hex!) to saw with <strong>${esc(wc.name)}</strong>:`;
      const ownHexBtns = me.mods
        .map((mId, mSlot) =>
          CARD_CATALOG[mId]?.cat === 'hex'
            ? `<button type="button" class="vv-btn vv-btn-emerald" data-wiz-target="${me.seatIdx}:${100 + mSlot}">✨ Saw Own ${esc(CARD_CATALOG[mId].short)}</button>`
            : ''
        )
        .filter(Boolean);
      const rivalBtns = rivals.flatMap((r) => [
        ...(!r.hasDome
          ? r.mods.map(
              (mId, mSlot) =>
                `<button type="button" class="vv-btn vv-btn-amber" data-wiz-target="${r.seatIdx}:${100 + mSlot}">${esc(seatDisplayName(r.seatIdx))}: ${esc(CARD_CATALOG[mId]?.short || 'Mod')}</button>`
            )
          : []),
        ...r.voles
          .map((vId, vSlot) =>
            vId === 12
              ? ''
              : `<button type="button" class="vv-btn vv-btn-amber" data-wiz-target="${r.seatIdx}:${vSlot}">${esc(seatDisplayName(r.seatIdx))}: ${esc(CARD_CATALOG[vId]?.short || 'Vole')}</button>`
          )
          .filter(Boolean),
      ]);
      quickButtonsHtml =
        [...ownHexBtns, ...rivalBtns].join('') ||
        `<button type="button" class="vv-btn vv-btn-emerald" data-wiz-target="${rivals[0]?.seatIdx ?? 0}:0">Play Without Target (Enter Burrow)</button>`;
    } else if (wizard.mode === 'necro_scrap') {
      promptHtml = `🧟 Pick a fallen Vole from the Scrap Heap to resurrect:`;
      quickButtonsHtml = tableState.scrap
        .map((cid, sIdx) =>
          cid <= 14
            ? `<button type="button" class="vv-btn vv-btn-violet" data-wiz-necro="${sIdx}">🧟 ${esc(CARD_CATALOG[cid]?.name || 'Vole')}</button>`
            : ''
        )
        .filter(Boolean)
        .join('');
    } else if (wizard.mode === 'siren_abduct') {
      if (wizard.discardIdx === null) {
        promptHtml = `🎶 Step 1/2 — Pick 1 other card from your Hand to discard for <strong>Siren Hypno-Vole</strong>:`;
        quickButtonsHtml = me.hand
          .map((cid, hIdx) =>
            hIdx === wizard.handIdx
              ? ''
              : `<button type="button" class="vv-btn vv-btn-violet" data-wiz-siren-disc="${hIdx}">Discard ${esc(CARD_CATALOG[cid]?.short || 'Card')}</button>`
          )
          .filter(Boolean)
          .join('');
      } else {
        promptHtml = `🎶 Step 2/2 — Pick a rival Vole to Abduct into your Burrow:`;
        quickButtonsHtml = rivals
          .flatMap((r) =>
            r.voles
              .map((vId, vSlot) =>
                vId === 12
                  ? ''
                  : `<button type="button" class="vv-btn vv-btn-amber" data-wiz-siren-target="${r.seatIdx}:${vSlot}">Abduct ${esc(seatDisplayName(r.seatIdx))}’s ${esc(CARD_CATALOG[vId]?.short || 'Vole')}</button>`
              )
              .filter(Boolean)
          )
          .join('');
      }
    } else if (wizard.mode === 'collapse_sac_and_rival') {
      if (wizard.sacSlot === null) {
        promptHtml = `🧨 Step 1/2 — Pick 1 card in YOUR Burrow to sacrifice (pro tip: you can sacrifice a Hex!):`;
        const ownModBtns = me.mods.map(
          (mId, mSlot) =>
            `<button type="button" class="vv-btn vv-btn-emerald" data-wiz-sac="${100 + mSlot}">Sacrifice ${esc(CARD_CATALOG[mId]?.short || 'Mod')}</button>`
        );
        const ownVoleBtns = me.voles.map(
          (vId, vSlot) =>
            `<button type="button" class="vv-btn" data-wiz-sac="${vSlot}">Sacrifice ${esc(CARD_CATALOG[vId]?.short || 'Vole')}</button>`
        );
        quickButtonsHtml = [...ownModBtns, ...ownVoleBtns].join('');
      } else {
        promptHtml = `🧨 Step 2/2 — Pick a rival Burrow to blast up to 2 cards:`;
        quickButtonsHtml = rivals
          .map((r) => {
            const firstSlot = r.mods.length && !r.hasDome ? 100 : 0;
            return `<button type="button" class="vv-btn vv-btn-crimson" data-wiz-collapse-rival="${r.seatIdx}:${firstSlot}">💥 Blast ${esc(seatDisplayName(r.seatIdx))}’s Burrow</button>`;
          })
          .join('');
      }
    }

    targetBar.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:5px;flex:1;">
        <div>${promptHtml}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${quickButtonsHtml || '<span class="vv-muted">No valid targets currently on board.</span>'}</div>
      </div>
      <button type="button" class="vv-btn" id="btnCancelWizard">Cancel</button>
    `;
    document.getElementById('btnCancelWizard')?.addEventListener('click', () => {
      wizard = null;
      renderAll();
    });
  } else {
    targetBar.style.display = 'none';
  }

  // Render Hand Fan
  handFan.innerHTML = me.hand.length
    ? me.hand
        .map((cId, hIdx) => {
          const isWizSel = wizard && wizard.handIdx === hIdx;
          const isDiscSel =
            tableState.phase === PHASE_DISCARD &&
            tableState.turnSeat === tableState.viewerSeat &&
            ((discardMask >> hIdx) & 1) !== 0;
          const badge = isDiscSel
            ? '<span style="color:#fb7185;">🗑️ DROP</span>'
            : cId === 23 || cId === 24
            ? '<span style="color:#fda4af;">⚡ REACT</span>'
            : '';
          return renderCardHtml(cId, {
            compact: false,
            selected: isWizSel || isDiscSel,
            badgeHtml: badge,
            dataAttrs: `data-hand-idx="${hIdx}"`,
          });
        })
        .join('')
    : `<span class="vv-muted">Your Hand is empty — Forage or wait for next Dawn Draw!</span>`;
}

function renderSidebarAndHud() {
  document.getElementById('hudTurn').textContent = String(tableState?.turnNumber || 0);
  document.getElementById('hudTargetVoles').textContent = `${tableState?.targetVoles || 7} VOLES`;

  const phasePill = document.getElementById('hudPhaseBadge');
  if (!tableState) {
    phasePill.className = 'vv-phase-pill';
    phasePill.textContent = 'Ready to Deal';
  } else if (tableState.phase === PHASE_REACTION) {
    phasePill.className = 'vv-phase-pill reaction';
    phasePill.textContent = `🛑 SQUEAK-NO! STACK (#${tableState.pending.squeakDepth})`;
  } else if (isMyActionTurn()) {
    phasePill.className = 'vv-phase-pill my-turn';
    phasePill.textContent = `⚡ YOUR TURN (${tableState.playsRemaining} Play)`;
  } else if (tableState.phase === PHASE_FINISHED) {
    phasePill.className = 'vv-phase-pill my-turn';
    phasePill.textContent = `🏆 WINNER: ${seatDisplayName(tableState.winnerSeat)}`;
  } else if (tableState.phase === PHASE_LOBBY) {
    phasePill.className = 'vv-phase-pill';
    phasePill.textContent = `🪑 LOBBY (${tableState.seatCount}/5)`;
  } else {
    phasePill.className = 'vv-phase-pill';
    phasePill.textContent = `${seatDisplayName(tableState.turnSeat)}’s Turn`;
  }

  // Standings
  const stList = document.getElementById('standingsList');
  const seatSum = document.getElementById('lblSeatSummary');
  if (seatSum) seatSum.textContent = `${tableState?.seatCount || 0} Seated`;
  if (stList) {
    stList.innerHTML = (tableState?.seats || [])
      .map(
        (s) => `
        <div class="vv-stand-row ${tableState.turnSeat === s.seatIdx && tableState.phase === PHASE_ACTION ? 'turn' : ''}">
          <span style="font-weight:700;">${esc(seatDisplayName(s.seatIdx))}</span>
          <span class="mono" style="color:${s.trufflesCursed ? '#bef264' : '#fde68a'};font-weight:800;">
            ${s.trufflesCursed ? '🥔' : '🐹'} ${s.effectiveVolesLen}/${tableState.targetVoles} • 🏆${s.wins}
          </span>
        </div>`
      )
      .join('') || '<div class="vv-muted">No active table yet.</div>';
  }

  // Chronicle Feed
  const feed = document.getElementById('chronicleFeed');
  if (feed) {
    const items = [...(tableState?.logs || [])].reverse();
    feed.innerHTML = items.length
      ? items
          .map((lg) => {
            const actor = seatDisplayName(lg.actorSeat);
            const cName = CARD_CATALOG[lg.cardId]?.name || 'Card';
            const tgt = lg.targetSeat < (tableState?.seatCount || 0) ? seatDisplayName(lg.targetSeat) : '';
            if (lg.kind === 1) {
              return `<div class="vv-feed-item">🎲 <strong>Match Dealt!</strong> ${lg.auxCard} players received 1 Baby Vole + 5 cards (Goal: ${lg.flags} Voles).</div>`;
            }
            if (lg.kind === 2) {
              return `<div class="vv-feed-item">🌅 <strong>[T${lg.turn}]</strong> ${esc(actor)}’s <em>Alpha Warlord Vole</em> drew +1 Dawn bonus card!</div>`;
            }
            if (lg.kind === 3) {
              return `<div class="vv-feed-item">🌰 <strong>[T${lg.turn}]</strong> ${esc(actor)} foraged +1 extra card from the Draw Pile.</div>`;
            }
            if (lg.kind === 4) {
              return `<div class="vv-feed-item">🃏 <strong>[T${lg.turn}]</strong> ${esc(actor)} staged <strong>${esc(cName)}</strong>${tgt && lg.targetSeat !== lg.actorSeat ? ` → ${esc(tgt)}` : ''}.</div>`;
            }
            if (lg.kind === 5) {
              return `<div class="vv-feed-item squeak">🛑 <strong>[T${lg.turn}] ${esc(actor)} SLAMMED ${esc(cName)}!</strong> (Stack Depth #${lg.flags})</div>`;
            }
            if (lg.kind === 6) {
              return `<div class="vv-feed-item squeak">💨 <strong>[T${lg.turn}] ${esc(cName)}</strong> was CANCELED by ${esc(actor)}’s Squeak-No!</div>`;
            }
            if (lg.kind === 7) {
              const auxTxt =
                lg.auxCard < 25 && CARD_CATALOG[lg.auxCard]
                  ? ` (${CARD_CATALOG[lg.auxCard].short})`
                  : lg.auxCard === CARD_MASKED_BACK
                  ? ' (stole 1 card!)'
                  : '';
              return `<div class="vv-feed-item">⚡ <strong>[T${lg.turn}]</strong> ${esc(actor)}’s <strong>${esc(cName)}</strong> resolved!${esc(auxTxt)}</div>`;
            }
            if (lg.kind === 8) {
              return `<div class="vv-feed-item">🗑️ <strong>[T${lg.turn}]</strong> ${esc(actor)} discarded <em>${esc(cName)}</em> (7-card hand limit).</div>`;
            }
            if (lg.kind === 9) {
              return `<div class="vv-feed-item victory">🏆 <strong>[T${lg.turn}] ${esc(actor)} WON THE BURROW CROWN (${lg.auxCard} Voles)!</strong></div>`;
            }
            return '';
          })
          .join('')
      : '<div class="vv-muted">Play-by-play burrow chaos logs appear here live.</div>';
  }

  // Update Contextual Coach Bar
  if (vvGuide) {
    if (!tableState) {
      vvGuide.updateCoach({
        pill: '🧭 READY TO DEAL',
        html: 'Click <strong>⚡ Quick Match (vs 3 AI)</strong> to deal 1 Baby Vole + 5 cards immediately in 1 block at <strong>$0.00 gas</strong>!',
        tone: 'amber',
        actionLabel: '⚡ Deal Quick Match',
        onAction: () => quickMatchTx(3, 7),
      });
    } else if (tableState.phase === PHASE_REACTION) {
      vvGuide.updateCoach({
        pill: '🛑 SQUEAK-NO! WINDOW',
        html: 'A card is on the stack! Slam <strong>SQUEAK-NO!</strong> in the crimson center banner to cancel it, or click <strong>✓ Allow / Pass</strong>.',
        tone: 'rose',
      });
    } else if (isMyActionTurn()) {
      const me = getMySeat();
      vvGuide.updateCoach({
        pill: `🎯 YOUR TURN (${me?.effectiveVolesLen || 0}/${tableState.targetVoles} VOLES)`,
        html: wizard
          ? 'Select a highlighted target in the golden bar above your hand (or click <strong>Cancel</strong>).'
          : 'Click any <strong>Vole, Perk, Hex, or Chaos Spell</strong> in your Hand below — or click <strong>🌰 Forage (+1)</strong> on the Draw Pile!',
        tone: 'emerald',
      });
    } else if (tableState.phase === PHASE_FINISHED) {
      vvGuide.updateCoach({
        pill: '🏆 MATCH COMPLETE',
        html: 'Click <strong>🔄 Play Rematch</strong> in the center banner to deal the next round and climb the win tally!',
        tone: 'amber',
      });
    } else {
      vvGuide.updateCoach({
        pill: '⏳ RIVAL TURN',
        html: 'Keep your <strong>🛑 SQUEAK-NO!</strong> Instants ready in case a rival plays a game-winning Vole or nasty Hex!',
        tone: 'info',
      });
    }
  }
}

function renderAll() {
  renderSidebarAndHud();
  renderOpponents();
  renderCenterStage();
  renderMyBurrowAndHand();
}

// ---------------------------------------------------------------------------
// Modals: Card Zoom, Compendium (All 25 Cards), Nest/Scrap Inspector & PvP Lobby
// ---------------------------------------------------------------------------

function openVvModal(title, html) {
  document.getElementById('vvModalTitle').textContent = title;
  document.getElementById('vvModalBody').innerHTML = html;
  document.getElementById('vvModalBackdrop').style.display = 'flex';
}

function closeVvModal() {
  document.getElementById('vvModalBackdrop').style.display = 'none';
}

function openCardDetailModal(cardId) {
  const c = CARD_CATALOG[cardId];
  if (!c) return;
  openVvModal(
    `${c.catLabel} — ${c.name}`,
    `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;">
       <img src="${esc(c.art)}" alt="${esc(c.name)}" style="width:240px;height:200px;object-fit:cover;border-radius:14px;border:2px solid rgba(248,250,252,0.25);" />
       <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:9px;">
         <div class="mono" style="font-size:0.74rem;color:#fde68a;">CARD #${c.id} • ${esc(c.catLabel)}</div>
         <div style="font-size:1.18rem;font-weight:800;">${esc(c.name)}</div>
         <div style="font-size:0.88rem;line-height:1.5;color:#e2e8f0;">${esc(c.rule)}</div>
         <div style="font-size:0.8rem;font-style:italic;color:#94a3b8;">${esc(c.flavor)}</div>
       </div>
     </div>`
  );
}

function openCompendiumModal() {
  const allCards = Object.values(CARD_CATALOG)
    .map((c) => renderCardHtml(c.id, { dataAttrs: `data-zoom-card="${c.id}"` }))
    .join('');
  openVvModal(
    '📚 Volatile Voles — Complete 25-Card Illustrated Compendium',
    `<div style="margin-bottom:10px;font-size:0.78rem;color:#cbd5e1;">
       <strong>68-Card Main Deck + 8-Card Baby Nest:</strong> Click any card below to enlarge its artwork &amp; flavor text.
     </div>
     <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;">${allCards}</div>`
  );
}

async function openPvpLobbyModal() {
  let tablesHtml = '<div class="vv-muted">Checking on-chain tables…</div>';
  openVvModal('🪑 Multiplayer PvP Burrow Tables (2–5 Players)', tablesHtml);

  let listed = [];
  if (contractAddr) {
    try {
      const hex = await slxNodeRpc(rpcUrl, 'eth_call', [
        { to: contractAddr, data: encodeAbi('listTables()', []) },
        'latest',
      ]);
      const b = hexToBytes(hex);
      if (b.length >= 1) {
        const cnt = b[0];
        let p = 1;
        for (let i = 0; i < cnt && p + 36 <= b.length; i++) {
          listed.push({
            tableId: bytesToHex(b.subarray(p, p + 32)),
            phase: b[p + 32],
            seatCount: b[p + 33],
            targetVoles: b[p + 34],
            humanCount: b[p + 35],
          });
          p += 36;
        }
      }
    } catch (_) {}
  }

  const rows = listed.length
    ? listed
        .reverse()
        .map(
          (t) => `
        <div class="vv-stand-row" style="padding:9px 11px;">
          <div>
            <strong class="mono">${shortHex(t.tableId, 10, 6)}</strong>
            <span class="vv-muted" style="margin-left:8px;">${t.seatCount}/5 seats (${t.humanCount} human) • Goal ${t.targetVoles}🐹 • ${
              t.phase === PHASE_LOBBY ? '🟢 Open Lobby' : t.phase === PHASE_FINISHED ? '🏁 Finished' : '⚡ In Progress'
            }</span>
          </div>
          <button type="button" class="vv-btn vv-btn-emerald" data-switch-table="${t.tableId}">Open Table →</button>
        </div>`
        )
        .join('')
    : '<div class="vv-muted">No multiplayer tables created yet — click Create New PvP Table below!</div>';

  document.getElementById('vvModalBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.85);border:1px solid rgba(56,189,248,0.35);">
        <div style="font-size:0.8rem;color:#e2e8f0;">Create a fresh 2–5 player Burrow Lobby (friends can join from their browser or fill empty seats with AI Bots!):</div>
        <button type="button" class="vv-btn vv-btn-amber" id="btnModalNewTable">➕ Create New PvP Table</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>
  `;

  document.getElementById('btnModalNewTable')?.addEventListener('click', async () => {
    let idRec;
    try {
      idRec = await wallet.ensureIdentityWithPrompt({
        rpcUrl: getDefaultNodeWsUrl(),
        appName: 'Volatile Voles',
      });
    } catch (err) {
      showToast(`⚠ Identity HFS required: ${err?.message || err}`);
      return;
    }
    const idAddr = idRec?.identityAddr || ZERO_ADDR;
    if (!idAddr || idAddr === ZERO_ADDR) {
      showToast('⚠ Please deploy your Identity HFS first to play Volatile Voles.');
      return;
    }
    const newTid = bytesToHex(concatBytes(utf8ToBytes('VV_PVP_'), randomBytes(25)));
    activeTableId = newTid;
    closeVvModal();
    await sendVolesTx(
      'createTable',
      encodeAbi('createTable(bytes32,address,uint64)', [
        ['bytes32', newTid],
        ['address', idAddr],
        ['uint64', 7n],
      ])
    );
  });
}

// ---------------------------------------------------------------------------
// Global Event Delegation & Subnet 1 WebSocket Watcher
// ---------------------------------------------------------------------------

function bindDomEvents() {
  document.getElementById('btnQuickMatch')?.addEventListener('click', () => quickMatchTx(3, 7));
  document.getElementById('btnOpenMultiplayerModal')?.addEventListener('click', openPvpLobbyModal);
  document.getElementById('btnOpenCompendium')?.addEventListener('click', openCompendiumModal);
  document.getElementById('btnCloseVvModal')?.addEventListener('click', closeVvModal);
  document.getElementById('vvModalBackdrop')?.addEventListener('click', (ev) => {
    if (ev.target.id === 'vvModalBackdrop') closeVvModal();
  });

  document.getElementById('btnForageDraw')?.addEventListener('click', () => {
    if (!isMyActionTurn()) return;
    sendVolesTx('forageDraw', encodeAbi('forageDraw(bytes32)', [['bytes32', activeTableId]]));
  });

  document.getElementById('btnEndActionEarly')?.addEventListener('click', () => {
    sendVolesTx('endActionPhase', encodeAbi('endActionPhase(bytes32)', [['bytes32', activeTableId]]));
  });

  document.getElementById('pileNest')?.addEventListener('click', () => {
    const cards = (tableState?.nest || [0, 1, 2, 3, 4, 0, 1, 2])
      .map((cid) => renderCardHtml(cid, { compact: true, dataAttrs: `data-zoom-card="${cid}"` }))
      .join('');
    openVvModal(
      `🪺 The Nest (${tableState ? tableState.nestLen : 8} Baby Voles Remaining)`,
      `<div style="margin-bottom:10px;font-size:0.78rem;color:#cbd5e1;">Baby Voles never go to the Scrap Heap — whenever destroyed, sacrificed, or bounced, they return safely here!</div>
       <div style="display:flex;flex-wrap:wrap;gap:8px;">${cards || '<span class="vv-muted">All Baby Voles are currently out in Burrows!</span>'}</div>`
    );
  });

  document.getElementById('pileScrap')?.addEventListener('click', () => {
    const cards = [...(tableState?.scrap || [])]
      .reverse()
      .map((cid) => renderCardHtml(cid, { compact: true, dataAttrs: `data-zoom-card="${cid}"` }))
      .join('');
    openVvModal(
      `🗑️ Scrap Heap (${tableState?.scrapLen || 0} Cards)`,
      `<div style="display:flex;flex-wrap:wrap;gap:8px;">${cards || '<span class="vv-muted">Scrap Heap is currently empty.</span>'}</div>`
    );
  });

  document.body.addEventListener('click', (ev) => {
    const switchTbl = ev.target.closest('[data-switch-table]');
    if (switchTbl) {
      activeTableId = switchTbl.getAttribute('data-switch-table');
      closeVvModal();
      refreshTableState();
      return;
    }

    const handBtn = ev.target.closest('[data-hand-idx]');
    if (handBtn) {
      handleHandCardClick(Number(handBtn.getAttribute('data-hand-idx')));
      return;
    }

    // Wizard 1-click target buttons
    const wizRival = ev.target.closest('[data-wiz-rival]');
    if (wizRival && wizard) {
      const ts = Number(wizRival.getAttribute('data-wiz-rival'));
      sendVolesTx(
        'playCard',
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(wizard.handIdx)],
          ['uint64', BigInt(ts)],
          ['uint64', 0n],
          ['uint64', 0n],
        ])
      );
      return;
    }

    const wizTarget = ev.target.closest('[data-wiz-target]');
    if (wizTarget && wizard) {
      const [ts, tslot] = wizTarget.getAttribute('data-wiz-target').split(':').map(Number);
      sendVolesTx(
        'playCard',
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(wizard.handIdx)],
          ['uint64', BigInt(ts)],
          ['uint64', BigInt(tslot)],
          ['uint64', 0n],
        ])
      );
      return;
    }

    const wizNecro = ev.target.closest('[data-wiz-necro]');
    if (wizNecro && wizard) {
      const sIdx = Number(wizNecro.getAttribute('data-wiz-necro'));
      sendVolesTx(
        'playCard',
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(wizard.handIdx)],
          ['uint64', BigInt(tableState.viewerSeat)],
          ['uint64', 0n],
          ['uint64', BigInt(sIdx)],
        ])
      );
      return;
    }

    const wizSirenDisc = ev.target.closest('[data-wiz-siren-disc]');
    if (wizSirenDisc && wizard) {
      let dIdx = Number(wizSirenDisc.getAttribute('data-wiz-siren-disc'));
      // Note: stage_card_play removes `wizard.handIdx` from hand FIRST, shifting higher indices left by 1!
      if (dIdx > wizard.handIdx) dIdx -= 1;
      wizard.discardIdx = dIdx;
      renderAll();
      return;
    }

    const wizSirenTarget = ev.target.closest('[data-wiz-siren-target]');
    if (wizSirenTarget && wizard && wizard.discardIdx !== null) {
      const [ts, tslot] = wizSirenTarget.getAttribute('data-wiz-siren-target').split(':').map(Number);
      sendVolesTx(
        'playCard',
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(wizard.handIdx)],
          ['uint64', BigInt(ts)],
          ['uint64', BigInt(tslot)],
          ['uint64', BigInt(wizard.discardIdx)],
        ])
      );
      return;
    }

    const wizSac = ev.target.closest('[data-wiz-sac]');
    if (wizSac && wizard) {
      wizard.sacSlot = Number(wizSac.getAttribute('data-wiz-sac'));
      renderAll();
      return;
    }

    const wizCollapseRival = ev.target.closest('[data-wiz-collapse-rival]');
    if (wizCollapseRival && wizard && wizard.sacSlot !== null) {
      const [ts, tslot] = wizCollapseRival.getAttribute('data-wiz-collapse-rival').split(':').map(Number);
      sendVolesTx(
        'playCard',
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(wizard.handIdx)],
          ['uint64', BigInt(ts)],
          ['uint64', BigInt(tslot)],
          ['uint64', BigInt(wizard.sacSlot)],
        ])
      );
      return;
    }

    // Direct board click shortcuts while wizard is open
    const directRivalCard = ev.target.closest('[data-target-seat][data-target-slot]');
    if (directRivalCard && wizard && (wizard.mode === 'destroy_any_card' || wizard.mode === 'rival_vole')) {
      const ts = Number(directRivalCard.getAttribute('data-target-seat'));
      const tslot = Number(directRivalCard.getAttribute('data-target-slot'));
      sendVolesTx(
        'playCard',
        encodeAbi('playCard(bytes32,uint64,uint64,uint64,uint64)', [
          ['bytes32', activeTableId],
          ['uint64', BigInt(wizard.handIdx)],
          ['uint64', BigInt(ts)],
          ['uint64', BigInt(tslot)],
          ['uint64', 0n],
        ])
      );
      return;
    }

    const zoomEl = ev.target.closest('[data-zoom-card]');
    if (zoomEl && !wizard) {
      openCardDetailModal(Number(zoomEl.getAttribute('data-zoom-card')));
    }
  });
}

async function selectArenaInstance(addr, tableIdHint) {
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  contractAddr = (addr || '').toLowerCase();
  if (tableIdHint) activeTableId = tableIdHint;
  await refreshTableState();

  if (contractAddr) {
    stopWatcher = slxWatchChainApp({
      rpcUrl,
      contractAddresses: [contractAddr],
      onRefresh: () => refreshTableState(),
    });
  }
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'volatile-voles',
    title: 'Volatile Voles: Chaotic Burrow Sabotage',
    subtitle: '2–5 Player Tabletop Card Chaos • Baby Nest • Perks & Potato Hexes • SQUEAK-NO! Counter-Stacks',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => contractAddr || '',
    getContractLabel: () => 'VolatileVoles',
    onWalletSwitch: () => refreshTableState(),
    extraElements: [document.getElementById('btnHowToPlay')],
  });

  bindDomEvents();

  vvGuide = mountSlxGameGuide({
    gameId: 'volatile-voles',
    headerBtnEl: document.getElementById('btnHowToPlay'),
    welcomeMountEl: document.getElementById('vvWelcomeMount'),
    coachMountEl: document.getElementById('vvCoachMount'),
    onWelcomePrimaryAction: () => {
      quickMatchTx(3, 7);
    },
  });

  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const fallbackAddr = manifest?.volatileVoles?.contractAddr || '';
  const fallbackTid = manifest?.volatileVoles?.defaultTableId || DEFAULT_TABLE_ID;

  if (fallbackAddr) {
    await selectArenaInstance(fallbackAddr, fallbackTid);
    unifiedHdr?.refresh?.();
  } else {
    renderAll();
  }
  bootReadyResolve?.();

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'VOLATILE_VOLES',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => contractAddr || '',
    onSelectInstance: async (inst) => {
      await selectArenaInstance(inst.primaryAddr, inst.meta?.tableId || fallbackTid);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
