/**
 * CommonsRF — Composable Radio-Bounded Social Network & Identity-Owned ProductLedger Marketplace
 *
 * Composes 8 Haltproof Subroutines with zero duplicated ledger logic:
 * 1. `identity_registry.wasm`    — Canonical code_hash allowlist & active Identity HFS registry
 * 2. `identity.wasm`             — Per-user Identity HFS (@handle, delegates, execute, upsertProduct, buyProduct)
 * 3. `messaging.wasm`            — Extended Channel & Protected Attributed Social Message Bus
 * 4. `product_ledger.wasm`       — Personal Identity-Owned Storefronts (initializeForIdentity + <=150m RF buyProduct)
 * 5. `social_charter.wasm`       — Root of Trust, Radio Presence Lease, Web-of-Trust & Storefront Directory
 * 6. `social_relationships.wasm` — <=150m 2.4 GHz Encounter Handshakes & Relationship Tiers
 * 7. `social_feed.wasm`          — Scoped Wall Posts, Comments & Proximity Messenger (via Messaging HFS)
 * 8. `social_events.wasm`        — Local Meetups, Event Chat (via Messaging HFS) & <=150m RF Check-In
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  randomBytes,
  keccak256Hex,
  selectorBytes,
  computeAddress,
  signLexiconTx,
  SlxWalletManager,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  slxWatchChainApp,
  deterministicEncounterNonce,
  SUBNET1_FLEET_SOCIAL_DEFAULT,
  getUrlHfsParam,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from './slx-hfs-registry.js';

// ---------------------------------------------------------------------------
// Capabilities & ABI Encoders for Identity, ProductLedger & Social Subroutines
// ---------------------------------------------------------------------------

export const CAP_SOCIAL_RELATIONSHIPS = keccak256Hex(utf8ToBytes('CAP_SOCIAL_RELATIONSHIPS'));
export const CAP_SOCIAL_MESSAGING = keccak256Hex(utf8ToBytes('CAP_SOCIAL_MESSAGING'));
export const CAP_SOCIAL_EVENTS = keccak256Hex(utf8ToBytes('CAP_SOCIAL_EVENTS'));

function wordU64(v) {
  const b = new Uint8Array(32);
  let n = BigInt(v);
  for (let i = 31; i >= 24; i--) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return b;
}

function wordBool(flag) {
  return wordU64(flag ? 1 : 0);
}

function wordAddr(addrHex) {
  const b = new Uint8Array(32);
  if (addrHex && addrHex !== '0x') {
    b.set(hexToBytes(addrHex).slice(-20), 12);
  }
  return b;
}

function wordB32(b32Hex) {
  const b = new Uint8Array(32);
  if (b32Hex && b32Hex !== '0x') {
    b.set(hexToBytes(b32Hex).slice(0, 32), 0);
  }
  return b;
}

function tailBytes(data) {
  const raw = typeof data === 'string' ? utf8ToBytes(data) : data;
  const pad = (32 - (raw.length % 32)) % 32;
  return concatBytes(wordU64(raw.length), raw, new Uint8Array(pad));
}

export function computeEncounterCommitHex(charterAddr, initiatorId, targetId, secretNonceHex) {
  return keccak256Hex(
    concatBytes(
      utf8ToBytes('SLX_RF_ENC_V1'),
      hexToBytes(charterAddr).slice(-20),
      hexToBytes(initiatorId).slice(-20),
      hexToBytes(targetId).slice(-20),
      wordB32(secretNonceHex)
    )
  );
}

export const IdentityRegistryAbi = {
  initialize(adminIdAddr, idCodeHashHex, authCodeHashHex, initialIdentitiesAddrs = []) {
    const packed = concatBytes(...initialIdentitiesAddrs.map((a) => hexToBytes(a).slice(-20)));
    return bytesToHex(
      concatBytes(
        selectorBytes('initialize(address,bytes32,bytes32,bytes)'),
        wordAddr(adminIdAddr),
        wordB32(idCodeHashHex),
        wordB32(authCodeHashHex),
        wordU64(0x80),
        tailBytes(packed)
      )
    );
  },
};

export const IdentityAbi = {
  initialize(ownerEoa, handleStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('initialize(address,string)'),
        wordAddr(ownerEoa),
        wordU64(0x40),
        tailBytes(handleStr)
      )
    );
  },
  execute(targetHps, innerCalldataHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('execute(address,bytes)'),
        wordAddr(targetHps),
        wordU64(0x40),
        tailBytes(hexToBytes(innerCalldataHex))
      )
    );
  },
  upsertProduct(productLedger, productIdB32, units, price, nameStr, authObj = '0x0000000000000000000000000000000000000000') {
    return bytesToHex(
      concatBytes(
        selectorBytes('upsertProduct(address,bytes32,uint64,uint64,bytes,address)'),
        wordAddr(productLedger),
        wordB32(productIdB32),
        wordU64(units),
        wordU64(price),
        wordU64(0xc0),
        wordAddr(authObj),
        tailBytes(nameStr.slice(0, 32))
      )
    );
  },
  buyProduct(productLedger, productIdB32, quantity) {
    return bytesToHex(
      concatBytes(
        selectorBytes('buyProduct(address,bytes32,uint64)'),
        wordAddr(productLedger),
        wordB32(productIdB32),
        wordU64(quantity)
      )
    );
  },
  owner() {
    return bytesToHex(selectorBytes('owner()'));
  },
  transferOwnership(newOwnerEoa) {
    return bytesToHex(
      concatBytes(selectorBytes('transferOwnership(address)'), wordAddr(newOwnerEoa))
    );
  },
};

export const ProductLedgerAbi = {
  initializeForIdentity(registryAddr, ownerIdAddr, socialCharterAddr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('initializeForIdentity(address,address,address,bytes)'),
        wordAddr(registryAddr),
        wordAddr(ownerIdAddr),
        wordAddr(socialCharterAddr),
        wordU64(0x80),
        tailBytes(new Uint8Array(0))
      )
    );
  },
  getCatalogSnapshot() {
    return bytesToHex(selectorBytes('getCatalogSnapshot()'));
  },
};

export const CharterAbi = {
  initialize(registryAddr, messagingAddr, radiusM, rfRangeM, leaseBlocks, founderMetaStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('initialize(address,address,uint64,uint64,uint64,bytes)'),
        wordAddr(registryAddr),
        wordAddr(messagingAddr),
        wordU64(radiusM),
        wordU64(rfRangeM),
        wordU64(leaseBlocks),
        wordU64(0xc0),
        tailBytes(founderMetaStr)
      )
    );
  },
  authorizeModule(moduleAddr, capB32, expectedCodeHashB32, allowed) {
    return bytesToHex(
      concatBytes(
        selectorBytes('authorizeModule(address,bytes32,bytes32,bool)'),
        wordAddr(moduleAddr),
        wordB32(capB32),
        wordB32(expectedCodeHashB32),
        wordBool(allowed)
      )
    );
  },
  registerProfile(xM, yM, metaStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('registerProfile(uint64,uint64,bytes)'),
        wordU64(xM),
        wordU64(yM),
        wordU64(0x60),
        tailBytes(metaStr)
      )
    );
  },
  attachProductLedger(productLedgerAddr) {
    return bytesToHex(
      concatBytes(selectorBytes('attachProductLedger(address)'), wordAddr(productLedgerAddr))
    );
  },
  pingPresence(xM, yM) {
    return bytesToHex(
      concatBytes(selectorBytes('pingPresence(uint64,uint64)'), wordU64(xM), wordU64(yM))
    );
  },
  vouchNeighbor(subjectIdAddr) {
    return bytesToHex(
      concatBytes(selectorBytes('vouchNeighbor(address)'), wordAddr(subjectIdAddr))
    );
  },
  flagAccountability(offenderIdAddr, reasonCode) {
    return bytesToHex(
      concatBytes(
        selectorBytes('flagAccountability(address,uint64)'),
        wordAddr(offenderIdAddr),
        wordU64(reasonCode)
      )
    );
  },
  getCharterSnapshot() {
    return bytesToHex(selectorBytes('getCharterSnapshot()'));
  },
};

export const RelationshipsAbi = {
  initialize(charterAddr) {
    return bytesToHex(concatBytes(selectorBytes('initialize(address)'), wordAddr(charterAddr)));
  },
  openEncounterHandshake(targetIdAddr, tier, commitHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('openEncounterHandshake(address,uint64,bytes32)'),
        wordAddr(targetIdAddr),
        wordU64(tier),
        wordB32(commitHex)
      )
    );
  },
  acceptEncounterHandshake(initiatorIdAddr, secretNonceHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('acceptEncounterHandshake(address,bytes32)'),
        wordAddr(initiatorIdAddr),
        wordB32(secretNonceHex)
      )
    );
  },
  getRelationshipsSnapshot() {
    return bytesToHex(selectorBytes('getRelationshipsSnapshot()'));
  },
};

export const FeedAbi = {
  initialize(charterAddr, relAddr, msgAddr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('initialize(address,address,address)'),
        wordAddr(charterAddr),
        wordAddr(relAddr),
        wordAddr(msgAddr)
      )
    );
  },
  createPost(visibility, contentStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('createPost(uint64,bytes)'),
        wordU64(visibility),
        wordU64(0x40),
        tailBytes(contentStr)
      )
    );
  },
  reactPost(postId, kind) {
    return bytesToHex(
      concatBytes(selectorBytes('reactPost(uint64,uint64)'), wordU64(postId), wordU64(kind))
    );
  },
  commentPost(postId, textStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('commentPost(uint64,bytes)'),
        wordU64(postId),
        wordU64(0x40),
        tailBytes(textStr)
      )
    );
  },
  sendDirectMessage(recipientIdAddr, msgStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('sendDirectMessage(address,bytes)'),
        wordAddr(recipientIdAddr),
        wordU64(0x40),
        tailBytes(msgStr)
      )
    );
  },
  getDirectMessages(idA, idB, maxCount) {
    return bytesToHex(
      concatBytes(
        selectorBytes('getDirectMessages(address,address,uint64)'),
        wordAddr(idA),
        wordAddr(idB),
        wordU64(maxCount)
      )
    );
  },
  getFeedSnapshot() {
    return bytesToHex(selectorBytes('getFeedSnapshot()'));
  },
};

export const EventsAbi = {
  initialize(charterAddr, relAddr, msgAddr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('initialize(address,address,address)'),
        wordAddr(charterAddr),
        wordAddr(relAddr),
        wordAddr(msgAddr)
      )
    );
  },
  createEvent(venueX, venueY, startBlk, endBlk, vis, metaStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('createEvent(uint64,uint64,uint64,uint64,uint64,bytes)'),
        wordU64(venueX),
        wordU64(venueY),
        wordU64(startBlk),
        wordU64(endBlk),
        wordU64(vis),
        wordU64(0xc0),
        tailBytes(metaStr)
      )
    );
  },
  checkInEvent(eventId) {
    return bytesToHex(concatBytes(selectorBytes('checkInEvent(uint64)'), wordU64(eventId)));
  },
  getEventsSnapshot() {
    return bytesToHex(selectorBytes('getEventsSnapshot()'));
  },
};

// ---------------------------------------------------------------------------
// Binary Snapshot Decoders
// ---------------------------------------------------------------------------

function readU16LE(b, o) {
  return b[o] | (b[o + 1] << 8);
}

function readU32LE(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function readU64LEBig(b, o) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(b[o + i]);
  }
  return v;
}

function parseMeta(str) {
  const [name = 'Neighbor', handle = '@neighbor', role = 'Resident', device = 'Slate'] =
    str.split('|');
  return { name, handle, role, device };
}

function parseMessagingEntries(b, startPos, count) {
  let pos = startPos;
  const list = [];
  for (let i = 0; i < count; i++) {
    if (pos + 30 > b.length) break;
    const block = Number(readU64LEBig(b, pos));
    const authorAddr = bytesToHex(b.slice(pos + 8, pos + 28));
    const len = readU16LE(b, pos + 28);
    pos += 30;
    const text = bytesToUtf8(b.slice(pos, pos + len));
    pos += len;
    list.push({ block, authorAddr, text });
  }
  return { list, nextPos: pos };
}

export function decodeRecentMessagesHex(hex) {
  if (!hex || hex === '0x') return [];
  const b = hexToBytes(hex);
  if (b.length < 4) return [];
  return parseMessagingEntries(b, 4, readU32LE(b, 0)).list;
}

export function decodeCharterSnapshotHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 136 || b[0] !== 1) return null;

  const memberCount = b[1];
  const subnetRadiusM = readU32LE(b, 4);
  const rfEncounterRangeM = readU32LE(b, 8);
  const heartbeatLeaseBlocks = readU32LE(b, 12);
  const centerX = readU32LE(b, 16);
  const centerY = readU32LE(b, 20);
  const currentBlock = Number(readU64LEBig(b, 24));
  const totalSlashes = readU32LE(b, 32);

  const identityRegistryHps = bytesToHex(b.slice(36, 56));
  const messagingHps = bytesToHex(b.slice(56, 76));
  const relationshipsHps = bytesToHex(b.slice(76, 96));
  const feedHps = bytesToHex(b.slice(96, 116));
  const eventsHps = bytesToHex(b.slice(116, 136));

  let pos = 136;
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    if (pos + 72 > b.length) break;
    const identityAddr = bytesToHex(b.slice(pos, pos + 20));
    const productLedgerAddr = bytesToHex(b.slice(pos + 20, pos + 40));
    const uid = b[pos + 40];
    const trustScore = b[pos + 41];
    const sanctioned = b[pos + 42] !== 0;
    const isActive = b[pos + 43] !== 0;
    const xM = readU16LE(b, pos + 44);
    const yM = readU16LE(b, pos + 46);
    const lastHeartbeatBlock = Number(readU64LEBig(b, pos + 48));
    const flaggedByMask = readU64LEBig(b, pos + 56);
    const voucherCount = b[pos + 64];
    const vouchers = [];
    for (let k = 0; k < Math.min(4, voucherCount); k++) vouchers.push(b[pos + 65 + k]);
    const vouchersSlashed = b[pos + 69] !== 0;
    const slashCount = b[pos + 70];
    const metaLen = b[pos + 71];
    pos += 72;
    const metaStr = bytesToUtf8(b.slice(pos, pos + metaLen));
    pos += metaLen;

    members.push({
      addr: identityAddr,
      identityAddr,
      productLedgerAddr,
      uid,
      trustScore,
      sanctioned,
      isActive,
      xM,
      yM,
      lastHeartbeatBlock,
      flaggedByMask,
      vouchers,
      vouchersSlashed,
      slashCount,
      metaStr,
      ...parseMeta(metaStr),
    });
  }

  return {
    subnetRadiusM,
    rfEncounterRangeM,
    heartbeatLeaseBlocks,
    centerX,
    centerY,
    currentBlock,
    totalSlashes,
    modules: { identityRegistryHps, messagingHps, relationshipsHps, feedHps, eventsHps },
    members,
  };
}

export function decodeCatalogSnapshotHex(hex) {
  if (!hex || hex === '0x') return { ownerIdentity: '', skus: [] };
  const b = hexToBytes(hex);
  if (b.length < 24) return { ownerIdentity: '', skus: [] };
  const count = readU32LE(b, 0);
  const ownerIdentity = bytesToHex(b.slice(4, 24));
  let pos = 24;
  const skus = [];
  for (let i = 0; i < count; i++) {
    if (pos + 90 > b.length) break;
    const productId = bytesToHex(b.slice(pos, pos + 32));
    const unitsAvailable = Number(readU64LEBig(b, pos + 32));
    const latestPrice = Number(readU64LEBig(b, pos + 40));
    const totalUnitsSold = Number(readU64LEBig(b, pos + 48));
    const active = b[pos + 56] === 1;
    const nlen = Math.min(32, b[pos + 57]);
    const name = bytesToUtf8(b.slice(pos + 58, pos + 58 + nlen));
    pos += 90;
    skus.push({ productId, unitsAvailable, latestPrice, totalUnitsSold, active, name });
  }
  return { ownerIdentity, skus };
}

export function decodeRelationshipsSnapshotHex(hex) {
  if (!hex || hex === '0x') return { encounters: new Array(64).fill(0), edges: [], handshakes: [] };
  const b = hexToBytes(hex);
  if (b.length < 68) return { encounters: new Array(64).fill(0), edges: [], handshakes: [] };
  const edgeCount = readU16LE(b, 0);
  const pendingCount = readU16LE(b, 2);
  const encounters = Array.from(b.slice(4, 68));
  let pos = 68;
  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    if (pos + 4 > b.length) break;
    edges.push({ u1: b[pos], u2: b[pos + 1], tier: b[pos + 2] });
    pos += 4;
  }
  const handshakes = [];
  for (let i = 0; i < pendingCount; i++) {
    if (pos + 44 > b.length) break;
    handshakes.push({
      initiatorUid: b[pos],
      targetUid: b[pos + 1],
      tier: b[pos + 2],
      expiresBlock: Number(readU64LEBig(b, pos + 4)),
      commitHex: bytesToHex(b.slice(pos + 12, pos + 44)),
    });
    pos += 44;
  }
  return { encounters, edges, handshakes };
}

export function decodeFeedSnapshotHex(hex) {
  if (!hex || hex === '0x') return { totalPosts: 0, posts: [] };
  const b = hexToBytes(hex);
  if (b.length < 8) return { totalPosts: 0, posts: [] };
  const count = readU32LE(b, 0);
  const totalPosts = readU32LE(b, 4);
  let pos = 8;
  const posts = [];
  for (let i = 0; i < count; i++) {
    if (pos + 34 > b.length) break;
    const postId = readU32LE(b, pos);
    const authorUid = b[pos + 4];
    const visibility = b[pos + 5];
    const cmtCnt = b[pos + 6];
    const createdBlock = Number(readU64LEBig(b, pos + 8));
    const likedByMask = readU64LEBig(b, pos + 16);
    const endorsedByMask = readU64LEBig(b, pos + 24);
    const clen = readU16LE(b, pos + 32);
    pos += 34;
    const content = bytesToUtf8(b.slice(pos, pos + clen));
    pos += clen;
    const parsedCmts = parseMessagingEntries(b, pos, cmtCnt);
    pos = parsedCmts.nextPos;
    posts.push({
      postId,
      authorUid,
      visibility,
      createdBlock,
      likedByMask,
      endorsedByMask,
      content,
      comments: parsedCmts.list.slice().reverse(),
    });
  }
  return { totalPosts, posts };
}

export function decodeEventsSnapshotHex(hex) {
  if (!hex || hex === '0x') return { totalEvents: 0, events: [] };
  const b = hexToBytes(hex);
  if (b.length < 8) return { totalEvents: 0, events: [] };
  const count = readU32LE(b, 0);
  const totalEvents = readU32LE(b, 4);
  let pos = 8;
  const events = [];
  for (let i = 0; i < count; i++) {
    if (pos + 46 > b.length) break;
    const eventId = readU32LE(b, pos);
    const hostUid = b[pos + 4];
    const visibility = b[pos + 5];
    const chatCnt = b[pos + 6];
    const venueX = readU16LE(b, pos + 8);
    const venueY = readU16LE(b, pos + 10);
    const startBlock = Number(readU64LEBig(b, pos + 12));
    const endBlock = Number(readU64LEBig(b, pos + 20));
    const rsvpMask = readU64LEBig(b, pos + 28);
    const attendedMask = readU64LEBig(b, pos + 36);
    const mlen = readU16LE(b, pos + 44);
    pos += 46;
    const metaStr = bytesToUtf8(b.slice(pos, pos + mlen));
    pos += mlen;
    const [title = 'Meetup', venueName = 'Estate Square', desc = ''] = metaStr.split('|');
    const parsedChats = parseMessagingEntries(b, pos, chatCnt);
    pos = parsedChats.nextPos;
    events.push({
      eventId,
      hostUid,
      visibility,
      venueX,
      venueY,
      startBlock,
      endBlock,
      rsvpMask,
      attendedMask,
      title,
      venueName,
      desc,
      chats: parsedChats.list.slice().reverse(),
    });
  }
  return { totalEvents, events };
}

// ---------------------------------------------------------------------------
// Constants & Personas (Each with Radio EOA + Verified Identity HFS!)
// ---------------------------------------------------------------------------

const CENTER_X = 1500;
const CENTER_Y = 1500;
const SUBNET_RADIUS_M = 1200;
const RF_RANGE_M = 150;
const LEASE_BLOCKS = 12;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const TIER_LABELS = {
  1: '👋 Neighbor',
  2: '🤝 Mutual RF Friend',
  3: '💎 Close Circle',
};

const AVATAR_COLORS = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#7c3aed',
  '#d97706',
  '#e11d48',
  '#475569',
];

const slxWallet = new SlxWalletManager();

function makeSeedPersonas() {
  const defs = [
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111101',
      simIdAddr: '0x00000000000000000000000000000000001d0001',
      name: 'Stevve Wozniakk [SIM-BOT]',
      shortName: 'Stevve Wozniakk [SIM-BOT]',
      handle: '@wozniakk_simbot',
      role: 'Homebrew Garage Host',
      device: 'Starlynx Mini Dish',
      xM: 1500,
      yM: 1500,
    },
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111102',
      simIdAddr: '0x00000000000000000000000000000000001d0002',
      name: 'Gordun Ramzay [SIM-BOT]',
      shortName: 'Gordun Ramzay [SIM-BOT]',
      handle: '@ramzay_chef_bot',
      role: 'Hells Kitchen Stall #01',
      device: 'Apel Vizion Pro',
      xM: 1575,
      yM: 1460,
    },
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111103',
      simIdAddr: '0x00000000000000000000000000000000001d0003',
      name: 'Marthaa Stewert [SIM-BOT]',
      shortName: 'Marthaa Stewert [SIM-BOT]',
      handle: '@marthaa_bot',
      role: 'Rooftop Hydro Garden',
      device: 'Starlynx Mini Dish',
      xM: 1180,
      yM: 1360,
    },
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111104',
      simIdAddr: '0x00000000000000000000000000000000001d0004',
      name: 'Sanjayy Guptah [SIM-BOT]',
      shortName: 'Sanjayy Guptah [SIM-BOT]',
      handle: '@drguptah_bot',
      role: 'Neuro-Mesh Clinic',
      device: 'Apel Vizion Pro',
      xM: 1590,
      yM: 1555,
    },
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111105',
      simIdAddr: '0x00000000000000000000000000000000001d0005',
      name: 'Lannce Armstrung [SIM-BOT]',
      shortName: 'Lannce Armstrung [SIM-BOT]',
      handle: '@lannce_bike_bot',
      role: 'Peloton Mesh Cyclist',
      device: 'Apel Vizion Pro',
      xM: 2880,
      yM: 1510,
    },
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111106',
      simIdAddr: '0x00000000000000000000000000000000001d0006',
      name: 'Jordun Belfortt [SIM-BOT]',
      shortName: 'Jordun Belfortt [SIM-BOT]',
      handle: '@wolf_spam_bot',
      role: 'Unvouched Penny Caller',
      device: 'H200 Mini-Pod',
      xM: 1555,
      yM: 1430,
    },
    {
      keySeed: '1111111111111111111111111111111111111111111111111111111111111107',
      simIdAddr: '0x00000000000000000000000000000000001d0007',
      name: 'Martin Shkrely [SIM-BOT] (4.2 km Away)',
      shortName: 'Martin Shkrely [SIM-BOT]',
      handle: '@shkrely_remote_bot',
      role: 'Remote Non-Local Actor',
      device: 'No Local RF Link',
      xM: 4450,
      yM: 4450,
    },
  ];

  return defs.map((d, idx) => {
    const priv = idx === 0 ? slxWallet.keypair.privateKey : '0x' + d.keySeed;
    return {
      idx,
      priv,
      eoa: idx === 0 ? slxWallet.keypair.address : computeAddress(priv),
      identityAddr: d.simIdAddr, // updated to live deployed Identity HFS address in RPC mode!
      productLedgerAddr: '',
      color: AVATAR_COLORS[idx % AVATAR_COLORS.length],
      radioMuted: false,
      ...d,
    };
  });
}

// ---------------------------------------------------------------------------
// Application State
// ---------------------------------------------------------------------------

const defaultHost =
  typeof window !== 'undefined' && window.location && window.location.hostname
    ? window.location.hostname
    : '127.0.0.1';

const app = {
  mode: 'rpc',
  mainTab: 'feed',
  archOpen: false,
  activePersonaIdx: 0,
  selectedDmPeerUid: 1,
  personas: makeSeedPersonas(),
  sim: null,
  knownHandshakeNonces: new Map(),
  auditLogs: [],
  postVisDraft: 0,
  postTextDraft: '',
  // RPC state for the 8 composable contracts (WebSocket JSON-RPC over ws://<host>:8545)
  rpcUrl: getDefaultNodeWsUrl(),
  onboardingPool: { addrs: [], privs: [] },
  suiteAddrs: {
    identityRegistry: '',
    messaging: '',
    charter: '',
    relationships: '',
    feed: '',
    events: '',
  },
  rpcData: {
    charter: null,
    relationships: null,
    feed: null,
    events: null,
    storefronts: [], // [{ sellerMember, productLedgerAddr, skus }]
    dms: [],
  },
  rpcBusy: false,
  draggingPersonaIdx: -1,
};

function logAudit(html) {
  app.auditLogs.unshift(html);
  if (app.auditLogs.length > 45) app.auditLogs.pop();
}

function distMeters(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function popcountBig(mask) {
  let n = BigInt(mask);
  let c = 0;
  while (n > 0n) {
    c += Number(n & 1n);
    n >>= 1n;
  }
  return c;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// In-Browser Simulator Mirroring Identity + ProductLedger + SocialCharter Suite
// ---------------------------------------------------------------------------

function initSimSuite() {
  app.personas = makeSeedPersonas();
  app.knownHandshakeNonces.clear();
  app.auditLogs = [];

  const st = {
    subnetRadiusM: SUBNET_RADIUS_M,
    rfEncounterRangeM: RF_RANGE_M,
    heartbeatLeaseBlocks: LEASE_BLOCKS,
    centerX: CENTER_X,
    centerY: CENTER_Y,
    currentBlock: 100,
    totalSlashes: 0,
    members: [],
    edges: [],
    encounters: new Array(64).fill(0),
    handshakes: [],
    posts: [],
    nextPostId: 0,
    dms: new Map(),
    events: [],
    nextEventId: 0,
    // Map `identityAddr.toLowerCase()` -> { productLedgerAddr, skus: [] }
    storefronts: new Map(),
  };

  for (let i = 0; i < 6; i++) {
    const p = app.personas[i];
    st.members.push({
      addr: p.identityAddr,
      identityAddr: p.identityAddr,
      productLedgerAddr: ZERO_ADDR,
      uid: i,
      trustScore: i === 0 ? 88 : 35,
      sanctioned: false,
      xM: i === 4 ? 1560 : p.xM,
      yM: i === 4 ? 1510 : p.yM,
      lastHeartbeatBlock: 100,
      flaggedByMask: 0n,
      vouchers: [],
      vouchersSlashed: false,
      slashCount: 0,
      metaStr: `${p.shortName}|${p.handle}|${p.role}|${p.device}`,
      name: p.shortName,
      handle: p.handle,
      role: p.role,
      device: p.device,
    });
  }

  app.sim = st;

  // Vouch Mei Lin, Uncle Lim, and Marcus
  st.members[1].vouchers.push(0);
  st.members[1].trustScore = 84;
  st.members[2].vouchers.push(0);
  st.members[2].trustScore = 91;
  st.members[4].vouchers.push(2);
  st.members[4].trustScore = 76;

  // Relationships between Identity HFS instances
  simSetEdge(0, 1, 2);
  simSetEdge(0, 2, 3);
  simSetEdge(0, 4, 2);
  simSetEdge(1, 2, 2);

  // Attach Identity-owned `ProductLedger` storefronts for Mei Lin (`@meilin_hawker`) and Uncle Lim (`@unclelim31`)!
  const meiStoreAddr = '0x0000000000000000000000000000000000570002';
  st.members[1].productLedgerAddr = meiStoreAddr;
  app.personas[1].productLedgerAddr = meiStoreAddr;
  st.storefronts.set(st.members[1].identityAddr.toLowerCase(), {
    productLedgerAddr: meiStoreAddr,
    skus: [
      {
        productId: keccak256Hex(utf8ToBytes('SKU_SOON_KUEH_12')),
        name: 'Teochew Soon Kueh (12pc Box)',
        unitsAvailable: 14,
        latestPrice: 12,
        totalUnitsSold: 6,
        active: true,
      },
      {
        productId: keccak256Hex(utf8ToBytes('SKU_KOPI_O_FLASK')),
        name: 'Nanyang Kopi-O Thermal Flask',
        unitsAvailable: 8,
        latestPrice: 5,
        totalUnitsSold: 3,
        active: true,
      },
    ],
  });

  const limStoreAddr = '0x0000000000000000000000000000000000570003';
  st.members[2].productLedgerAddr = limStoreAddr;
  app.personas[2].productLedgerAddr = limStoreAddr;
  st.storefronts.set(st.members[2].identityAddr.toLowerCase(), {
    productLedgerAddr: limStoreAddr,
    skus: [
      {
        productId: keccak256Hex(utf8ToBytes('SKU_BOSCH_DRILL_LOAN')),
        name: 'Bosch Cordless Drill (Loan)',
        unitsAvailable: 1,
        latestPrice: 0,
        totalUnitsSold: 4,
        active: true,
      },
      {
        productId: keccak256Hex(utf8ToBytes('SKU_PANDAN_BUNDLE')),
        name: 'Rooftop Pandan & Basil Bundle',
        unitsAvailable: 6,
        latestPrice: 2,
        totalUnitsSold: 9,
        active: true,
      },
    ],
  });

  // Wall Posts via `SocialFeed` -> `Messaging`
  st.posts.push(
    {
      postId: st.nextPostId++,
      authorUid: 1,
      visibility: 0,
      createdBlock: 99,
      likedByMask: (1n << 0n) | (1n << 2n),
      endorsedByMask: 1n << 0n,
      content:
        'Just restocked 14 boxes of handmade Soon Kueh on my @meilin_hawker ProductLedger! Walk within <=150m of Stall #01-14 and call Identity.buyProduct to pick up fresh ☕🥟',
      comments: [
        {
          block: 99,
          authorAddr: app.personas[0].identityAddr,
          text: 'Grabbing a box right now from my @alextan Identity HFS!',
        },
      ],
    },
    {
      postId: st.nextPostId++,
      authorUid: 4,
      visibility: 1,
      createdBlock: 98,
      likedByMask: 1n << 0n,
      endorsedByMask: 0n,
      content:
        '🔒 [RF Friends Only] Cycling out past Bedok toward Changi — my @marcus_rides Identity will go Dormant while outside our 1.2 km subnet!',
      comments: [],
    },
    {
      postId: st.nextPostId++,
      authorUid: 2,
      visibility: 0,
      createdBlock: 96,
      likedByMask: (1n << 0n) | (1n << 1n),
      endorsedByMask: 1n << 1n,
      content:
        'Listed my Bosch Cordless Drill (SGD 0 neighbor loan) & fresh pandan bundles on my @unclelim31 ProductLedger! Meet at Blk 31 within 150m RF 🌿',
      comments: [],
    }
  );

  simAppendDm(1, 0, 'Morning @alextan! Soon kueh inventory is live on my ProductLedger.', 98);
  simAppendDm(0, 1, 'Awesome — walking within 85m of Blk 29 now!', 99);

  st.events.push({
    eventId: st.nextEventId++,
    hostUid: 1,
    visibility: 0,
    venueX: 1620,
    venueY: 1420,
    startBlock: 90,
    endBlock: 250,
    rsvpMask: (1n << 0n) | (1n << 1n) | (1n << 2n),
    attendedMask: 1n << 1n,
    title: 'Saturday Kopi & Neighbor Storefront Market',
    venueName: 'Blk 29 Amphitheatre (1620, 1420)',
    desc: 'Walk within <=150m 2.4 GHz range of Blk 29 Amphitheatre to check in via Identity.execute (+2 Civic Trust)!',
    chats: [],
  });

  // Move Marcus outside the 1.2 km subnet (`2880, 1510`) so Dormancy is immediately visible!
  st.members[4].xM = 2880;
  st.members[4].yM = 1510;

  logAudit(
    `🆔 <strong>IdentityRegistry + Identity HFS Active</strong>: All residents transact via verified <code>Identity</code> HFS instances.`
  );
  logAudit(
    `🛒 <strong>Identity-Owned ProductLedgers Attached</strong>: <code>@meilin_hawker</code> &amp; <code>@unclelim31</code> storefronts live.`
  );
}

function simSetEdge(u1, u2, tier) {
  const [lo, hi] = u1 <= u2 ? [u1, u2] : [u2, u1];
  app.sim.edges = app.sim.edges.filter((e) => !(e.u1 === lo && e.u2 === hi));
  if (tier > 0) {
    app.sim.edges.push({ u1: lo, u2: hi, tier });
    app.sim.encounters[lo] += 1;
    app.sim.encounters[hi] += 1;
  }
}

function simDmKey(u1, u2) {
  return u1 <= u2 ? `${u1}:${u2}` : `${u2}:${u1}`;
}

function simAppendDm(fromUid, toUid, text, blk) {
  const k = simDmKey(fromUid, toUid);
  if (!app.sim.dms.has(k)) app.sim.dms.set(k, []);
  app.sim.dms.get(k).push({
    block: blk,
    authorAddr: app.personas[fromUid].identityAddr,
    text,
  });
}

function simIsMemberActive(m, st = app.sim) {
  if (!m || m.sanctioned || m.trustScore < 15) return false;
  if (distMeters(m.xM, m.yM, st.centerX, st.centerY) > st.subnetRadiusM) return false;
  return st.currentBlock - m.lastHeartbeatBlock <= st.heartbeatLeaseBlocks;
}

function getEdgeTierFromSnap(relSnap, u1, u2) {
  if (u1 === u2) return 3;
  const [lo, hi] = u1 <= u2 ? [u1, u2] : [u2, u1];
  const e = relSnap.edges.find((x) => x.u1 === lo && x.u2 === hi);
  return e ? e.tier : 0;
}

function getActiveSuiteView() {
  if (app.rpcData.charter) {
    return {
      charter: app.rpcData.charter,
      relationships: app.rpcData.relationships || {
        encounters: new Array(64).fill(0),
        edges: [],
        handshakes: [],
      },
      feed: app.rpcData.feed || { totalPosts: 0, posts: [] },
      events: app.rpcData.events || { totalEvents: 0, events: [] },
      storefronts: app.rpcData.storefronts || [],
      dms: app.rpcData.dms || [],
    };
  }

  return {
    charter: {
      subnetRadiusM: SUBNET_RADIUS_M,
      rfEncounterRangeM: RF_RANGE_M,
      heartbeatLeaseBlocks: LEASE_BLOCKS,
      centerX: 1500,
      centerY: 1500,
      currentBlock: 0,
      totalSlashes: 0,
      modules: {
        identityRegistryHps: 'Connecting Subnet 1…',
        messagingHps: 'Connecting Subnet 1…',
        relationshipsHps: 'Connecting Subnet 1…',
        feedHps: 'Connecting Subnet 1…',
        eventsHps: 'Connecting Subnet 1…',
      },
      members: [],
    },
    relationships: {
      encounters: new Array(64).fill(0),
      edges: [],
      handshakes: [],
    },
    feed: { totalPosts: 0, posts: [] },
    events: { totalEvents: 0, events: [] },
    storefronts: [],
    dms: [],
  };
}

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const el = {
  personaSelect: document.getElementById('personaSelect'),
  btnToggleArch: document.getElementById('btnToggleArch'),
  archDrawer: document.getElementById('archDrawer'),
  archModulesGrid: document.getElementById('archModulesGrid'),
  engineModeSelect: document.getElementById('engineModeSelect'),
  subnetBlockBadge: document.getElementById('subnetBlockBadge'),
  btnAdvanceBlock: document.getElementById('btnAdvanceBlock'),
  btnResetDemo: document.getElementById('btnResetDemo'),
  rpcDrawer: document.getElementById('rpcDrawer'),
  rpcUrlInput: document.getElementById('rpcUrlInput'),
  btnDeploySuite: document.getElementById('btnDeploySuite'),
  charterAddrInput: document.getElementById('charterAddrInput'),
  btnSeedSuite: document.getElementById('btnSeedSuite'),
  rpcStatusText: document.getElementById('rpcStatusText'),
  toastBanner: document.getElementById('toastBanner'),
  toastText: document.getElementById('toastText'),
  btnDismissToast: document.getElementById('btnDismissToast'),
  activeCountBadge: document.getElementById('activeCountBadge'),
  rfRadarCanvas: document.getElementById('rfRadarCanvas'),
  selectedRadioBox: document.getElementById('selectedRadioBox'),
  btnScenarioWalkPriya: document.getElementById('btnScenarioWalkPriya'),
  btnScenarioEventCheckin: document.getElementById('btnScenarioEventCheckin'),
  btnScenarioToggleMarcus: document.getElementById('btnScenarioToggleMarcus'),
  btnScenarioSlashBot: document.getElementById('btnScenarioSlashBot'),
  btnScenarioTestOutsider: document.getElementById('btnScenarioTestOutsider'),
  tabMessagesBtn: document.getElementById('tabMessagesBtn'),
  tabEventsBtn: document.getElementById('tabEventsBtn'),
  tabMarketBtn: document.getElementById('tabMarketBtn'),
  tabHandshakesBtn: document.getElementById('tabHandshakesBtn'),
  centerModuleView: document.getElementById('centerModuleView'),
  myStandingCard: document.getElementById('myStandingCard'),
  nearbyCountBadge: document.getElementById('nearbyCountBadge'),
  nearbyList: document.getElementById('nearbyList'),
  friendsCountBadge: document.getElementById('friendsCountBadge'),
  friendsList: document.getElementById('friendsList'),
  slashesBadge: document.getElementById('slashesBadge'),
  auditLogList: document.getElementById('auditLogList'),
};

const radarCtx = el.rfRadarCanvas.getContext('2d');

function showToast(msgHtml, tone = 'info') {
  const styles = {
    info: { bg: 'rgba(37, 99, 235, 0.22)', border: '#60a5fa', color: '#dbeafe' },
    ok: { bg: 'rgba(16, 185, 129, 0.2)', border: '#34d399', color: '#d1fae5' },
    warn: { bg: 'rgba(245, 158, 11, 0.22)', border: '#fbbf24', color: '#fef3c7' },
    err: { bg: 'rgba(244, 63, 94, 0.24)', border: '#fb7185', color: '#ffe4e6' },
  }[tone];
  el.toastBanner.style.background = styles.bg;
  el.toastBanner.style.border = `1px solid ${styles.border}`;
  el.toastBanner.style.color = styles.color;
  el.toastText.innerHTML = msgHtml;
  el.toastBanner.classList.add('show');
}

// ---------------------------------------------------------------------------
// Live SuperLexicon 8-HFS RPC Deployment & Identity-Routed Execution
// ---------------------------------------------------------------------------

async function rpcCall(method, params = []) {
  return slxNodeRpc(app.rpcUrl, method, params);
}

async function waitReceipt(txHash, label = 'tx') {
  for (let i = 0; i < 45; i++) {
    const rcpt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    if (rcpt) {
      if (rcpt.status !== '0x1') throw new Error(`On-chain HFS revert in ${label}`);
      return rcpt;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function sendRawEoaTx(personaIdx, toAddr, dataHex, label, extraTargets = []) {
  const p = app.personas[personaIdx];
  const nonce = BigInt(await rpcCall('eth_getTransactionCount', [p.eoa, 'latest']));
  const chainId = BigInt(await rpcCall('eth_chainId').catch(() => '0x539'));
  const raw = signLexiconTx({
    privateKey: p.priv,
    nonce,
    to: toAddr,
    data: dataHex,
    gasLimit: 8_500_000n,
    gasPrice: 1_000_000_000n,
    chainId,
    extraTargets,
  });
  const h = await rpcCall('eth_sendRawTransaction', [raw]);
  slxWallet.recordExternalRpcTx({
    txHash: h,
    rawTx: raw,
    from: p.eoa,
    to: toAddr,
    contractLabel: 'CommonsRF(RPC)',
    fnLabel: label,
    dataHex,
    blockNumber: app.rpcData?.charter?.currentBlock || 0,
  });
  return waitReceipt(h, label);
}

function allRpcExtraTargets(extraAddrs = []) {
  const s = new Set([...Object.values(app.suiteAddrs), ...extraAddrs].filter(Boolean));
  for (const p of app.personas) {
    if (p.identityAddr && !p.identityAddr.startsWith('0x00000000000000000000000000000000001d')) {
      s.add(p.identityAddr);
    }
    if (p.productLedgerAddr) s.add(p.productLedgerAddr);
  }
  return Array.from(s);
}

/** Execute a call through the persona's verified `Identity` HFS (`Identity.execute(target, data)`)! */
async function sendViaIdentity(personaIdx, targetHps, innerCalldataHex, label, extraAddrs = []) {
  const p = app.personas[personaIdx];
  const rcpt = await sendRawEoaTx(
    personaIdx,
    p.identityAddr,
    IdentityAbi.execute(targetHps, innerCalldataHex),
    label,
    allRpcExtraTargets(extraAddrs)
  );
  await refreshRpcSuite();
  return rcpt;
}

async function fetchAndStoreWasm(founderIdx, wasmFileName) {
  let resp = await fetch(`/contracts/${wasmFileName}`);
  if (!resp.ok) resp = await fetch(`/public/contracts/${wasmFileName}`);
  const wasm = new Uint8Array(await resp.arrayBuffer());
  const codeHash = keccak256Hex(wasm);
  await sendRawEoaTx(
    founderIdx,
    '0x0000000000000000000000000000000000000100',
    codeHash + bytesToHex(wasm, false),
    `store ${wasmFileName}`
  );
  return codeHash;
}

async function instantiateCodeHash(personaIdx, codeHash, label) {
  const rcpt = await sendRawEoaTx(personaIdx, null, codeHash, label);
  return rcpt.contractAddress;
}

async function deployFullIdentityAndSocialSuite() {
  if (app.rpcBusy) return;
  app.rpcBusy = true;
  el.rpcStatusText.textContent =
    'Deploying IdentityRegistry, Identity, ProductLedger, Messaging & SocialCharter WASMs...';
  try {
    const idRegHash = await fetchAndStoreWasm(0, 'identity_registry.wasm');
    const idHash = await fetchAndStoreWasm(0, 'identity.wasm');
    const msgHash = await fetchAndStoreWasm(0, 'messaging.wasm');
    const plHash = await fetchAndStoreWasm(0, 'product_ledger.wasm');
    const chrHash = await fetchAndStoreWasm(0, 'social_charter.wasm');
    const relHash = await fetchAndStoreWasm(0, 'social_relationships.wasm');
    const feedHash = await fetchAndStoreWasm(0, 'social_feed.wasm');
    const evntHash = await fetchAndStoreWasm(0, 'social_events.wasm');

    app.productLedgerCodeHash = plHash;

    // 1. Instantiate & initialize an `Identity` HFS for each persona!
    const deployedIds = [];
    for (let i = 0; i < app.personas.length; i++) {
      const p = app.personas[i];
      const idAddr = await instantiateCodeHash(i, idHash, `Identity(${p.handle})`);
      p.identityAddr = idAddr;
      await sendRawEoaTx(i, idAddr, IdentityAbi.initialize(p.eoa, p.handle), `Identity.init`);
      deployedIds.push(idAddr);
    }

    // 2. Instantiate & initialize `IdentityRegistry` allowlisting `idHash` and activating all 7 Identity HFSs!
    const idRegAddr = await instantiateCodeHash(0, idRegHash, 'IdentityRegistry');
    await sendRawEoaTx(
      0,
      idRegAddr,
      IdentityRegistryAbi.initialize(deployedIds[0], idHash, idHash, deployedIds.slice(1)),
      'IdentityRegistry.init',
      deployedIds
    );

    // 3. Instantiate `Messaging`, `SocialCharter`, `SocialRelationships`, `SocialFeed`, `SocialEvents`
    const msgAddr = await instantiateCodeHash(0, msgHash, 'Messaging');
    const chrAddr = await instantiateCodeHash(0, chrHash, 'SocialCharter');
    const relAddr = await instantiateCodeHash(0, relHash, 'SocialRelationships');
    const feedAddr = await instantiateCodeHash(0, feedHash, 'SocialFeed');
    const evntAddr = await instantiateCodeHash(0, evntHash, 'SocialEvents');

    app.suiteAddrs = {
      identityRegistry: idRegAddr,
      messaging: msgAddr,
      charter: chrAddr,
      relationships: relAddr,
      feed: feedAddr,
      events: evntAddr,
    };
    el.charterAddrInput.value = chrAddr;
    SlxHfsCache.save({ rpcUrl: app.rpcUrl, socialCharterAddr: chrAddr });

    // 4. Initialize `SocialCharter` via Founder's `Identity` HFS (`AlexIdentity.execute(...)`)!
    const f = app.personas[0];
    await sendViaIdentity(
      0,
      chrAddr,
      CharterAbi.initialize(
        idRegAddr,
        msgAddr,
        SUBNET_RADIUS_M,
        RF_RANGE_M,
        LEASE_BLOCKS,
        `${f.shortName}|${f.handle}|${f.role}|${f.device}`
      ),
      'SocialCharter.init'
    );
    await sendRawEoaTx(0, relAddr, RelationshipsAbi.initialize(chrAddr), 'Rel.init', allRpcExtraTargets());
    await sendRawEoaTx(0, feedAddr, FeedAbi.initialize(chrAddr, relAddr, msgAddr), 'Feed.init', allRpcExtraTargets());
    await sendRawEoaTx(0, evntAddr, EventsAbi.initialize(chrAddr, relAddr, msgAddr), 'Events.init', allRpcExtraTargets());

    for (const [mAddr, cap, ch] of [
      [relAddr, CAP_SOCIAL_RELATIONSHIPS, relHash],
      [feedAddr, CAP_SOCIAL_MESSAGING, feedHash],
      [evntAddr, CAP_SOCIAL_EVENTS, evntHash],
    ]) {
      await sendViaIdentity(
        0,
        chrAddr,
        CharterAbi.authorizeModule(mAddr, cap, ch, true),
        'authorizeModule'
      );
    }

    el.rpcStatusText.textContent = `8-HFS Suite Live @ SocialCharter ${chrAddr.slice(0, 10)}..!`;
    app.archOpen = true;
    el.archDrawer.classList.add('open');
    showToast(
      `🚀 Deployed <strong>IdentityRegistry + 7 Identity HFSs + Messaging + ProductLedger + SocialCharter Suite</strong> on live Wasmtime!`,
      'ok'
    );
    await refreshRpcSuite();
  } catch (e) {
    el.rpcStatusText.textContent = `Deploy error: ${e.message}`;
    showToast(`⚠️ Deploy error: ${escapeHtml(e.message)}`, 'err');
  } finally {
    app.rpcBusy = false;
  }
}

async function seedOnChainNeighborhood() {
  if (!app.suiteAddrs.charter || app.rpcBusy) return;
  app.rpcBusy = true;
  el.rpcStatusText.textContent =
    'Registering Identities on SocialCharter & deploying Mei Lin / Uncle Lim ProductLedgers...';
  try {
    const chrAddr = app.suiteAddrs.charter;
    for (let i = 1; i <= 5; i++) {
      const p = app.personas[i];
      const rx = i === 4 ? 1560 : p.xM;
      const ry = i === 4 ? 1510 : p.yM;
      await sendViaIdentity(
        i,
        chrAddr,
        CharterAbi.registerProfile(rx, ry, `${p.shortName}|${p.handle}|${p.role}|${p.device}`),
        'registerProfile'
      );
    }
    await sendViaIdentity(0, chrAddr, CharterAbi.vouchNeighbor(app.personas[1].identityAddr), 'vouch');
    await sendViaIdentity(0, chrAddr, CharterAbi.vouchNeighbor(app.personas[2].identityAddr), 'vouch');

    // Mei Lin (Persona 1) deploys her Identity-owned `ProductLedger` HFS & upserts Soon Kueh via `MeiLinIdentity.upsertProduct`!
    const plHash = app.productLedgerCodeHash || (await fetchAndStoreWasm(1, 'product_ledger.wasm'));
    const meiStore = await instantiateCodeHash(1, plHash, 'MeiLin ProductLedger');
    app.personas[1].productLedgerAddr = meiStore;
    await sendViaIdentity(
      1,
      meiStore,
      ProductLedgerAbi.initializeForIdentity(
        app.suiteAddrs.identityRegistry,
        app.personas[1].identityAddr,
        chrAddr
      ),
      'ProductLedger.initForIdentity'
    );
    await sendViaIdentity(1, chrAddr, CharterAbi.attachProductLedger(meiStore), 'attachProductLedger');

    const skuSoonKueh = keccak256Hex(utf8ToBytes('SKU_SOON_KUEH_12'));
    await sendRawEoaTx(
      1,
      app.personas[1].identityAddr,
      IdentityAbi.upsertProduct(meiStore, skuSoonKueh, 14, 12, 'Teochew Soon Kueh (12pc)'),
      'Identity.upsertProduct',
      allRpcExtraTargets()
    );

    // Live RF Handshake + Wall Post + DM
    const nonce = bytesToHex(randomBytes(32));
    const commit = computeEncounterCommitHex(
      chrAddr,
      app.personas[0].identityAddr,
      app.personas[1].identityAddr,
      nonce
    );
    await sendViaIdentity(
      0,
      app.suiteAddrs.relationships,
      RelationshipsAbi.openEncounterHandshake(app.personas[1].identityAddr, 2, commit),
      'openHandshake'
    );
    await sendViaIdentity(
      1,
      app.suiteAddrs.relationships,
      RelationshipsAbi.acceptEncounterHandshake(app.personas[0].identityAddr, nonce),
      'acceptHandshake'
    );
    await sendViaIdentity(
      1,
      app.suiteAddrs.feed,
      FeedAbi.createPost(0, 'My @meilin_hawker Identity-owned ProductLedger is live on Wasmtime! ☕🥟'),
      'createPost'
    );
    await sendViaIdentity(4, chrAddr, CharterAbi.pingPresence(2880, 1510), 'Marcus out of range');

    el.rpcStatusText.textContent = 'Neighborhood & Identity-owned ProductLedger live on-chain!';
    showToast(
      `✅ Seeded Verified Identities &amp; <code>@meilin_hawker</code>'s Identity-owned <code>ProductLedger</code> on Wasmtime!`,
      'ok'
    );
    await refreshRpcSuite();
  } catch (e) {
    el.rpcStatusText.textContent = `Seed error: ${e.message}`;
    showToast(`⚠️ Seed error: ${escapeHtml(e.message)}`, 'err');
  } finally {
    app.rpcBusy = false;
  }
}

async function refreshRpcSuite() {
  if (!app.suiteAddrs.charter) return;
  try {
    const chrHex = await rpcCall('eth_call', [
      { to: app.suiteAddrs.charter, data: CharterAbi.getCharterSnapshot() },
      'latest',
    ]);
    const chr = decodeCharterSnapshotHex(chrHex);
    if (!chr) return;
    app.rpcData.charter = chr;
    app.suiteAddrs.identityRegistry = chr.modules.identityRegistryHps;
    app.suiteAddrs.messaging = chr.modules.messagingHps;
    app.suiteAddrs.relationships = chr.modules.relationshipsHps;
    app.suiteAddrs.feed = chr.modules.feedHps;
    app.suiteAddrs.events = chr.modules.eventsHps;

    const [relHex, feedHex, evtHex] = await Promise.all([
      app.suiteAddrs.relationships !== ZERO_ADDR
        ? rpcCall('eth_call', [
            { to: app.suiteAddrs.relationships, data: RelationshipsAbi.getRelationshipsSnapshot() },
            'latest',
          ])
        : '0x',
      app.suiteAddrs.feed !== ZERO_ADDR
        ? rpcCall('eth_call', [{ to: app.suiteAddrs.feed, data: FeedAbi.getFeedSnapshot() }, 'latest'])
        : '0x',
      app.suiteAddrs.events !== ZERO_ADDR
        ? rpcCall('eth_call', [
            { to: app.suiteAddrs.events, data: EventsAbi.getEventsSnapshot() },
            'latest',
          ])
        : '0x',
    ]);

    app.rpcData.relationships = decodeRelationshipsSnapshotHex(relHex);
    app.rpcData.feed = decodeFeedSnapshotHex(feedHex);
    app.rpcData.events = decodeEventsSnapshotHex(evtHex);

    // Fetch each member's Identity-owned `ProductLedger` catalog snapshot!
    const storefronts = [];
    for (const m of chr.members) {
      if (m.productLedgerAddr && m.productLedgerAddr !== ZERO_ADDR) {
        const catHex = await rpcCall('eth_call', [
          { to: m.productLedgerAddr, data: ProductLedgerAbi.getCatalogSnapshot() },
          'latest',
        ]);
        const cat = decodeCatalogSnapshotHex(catHex);
        storefronts.push({
          sellerMember: m,
          productLedgerAddr: m.productLedgerAddr,
          skus: cat.skus,
        });
      }
    }
    app.rpcData.storefronts = storefronts;

    const meId = app.personas[app.activePersonaIdx].identityAddr;
    const meM = meId
      ? chr.members.find((m) => m.identityAddr.toLowerCase() === meId.toLowerCase())
      : null;
    if (meM && app.rpcData.relationships?.edges?.length) {
      const myFriends = [];
      for (const e of app.rpcData.relationships.edges) {
        if (e.tier > 0) {
          if (e.u1 === meM.uid) myFriends.push(e.u2);
          else if (e.u2 === meM.uid) myFriends.push(e.u1);
        }
      }
      if (myFriends.length > 0 && !myFriends.includes(app.selectedDmPeerUid)) {
        app.selectedDmPeerUid = myFriends[0];
      }
    }
    const peerM = chr.members.find((m) => m.uid === app.selectedDmPeerUid);
    if (app.suiteAddrs.feed !== ZERO_ADDR && peerM && meId) {
      const dmHex = await rpcCall('eth_call', [
        { to: app.suiteAddrs.feed, data: FeedAbi.getDirectMessages(meId, peerM.identityAddr, 20) },
        'latest',
      ]);
      app.rpcData.dms = decodeRecentMessagesHex(dmHex).slice().reverse();
    }
    renderAll();
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Unified Actions (All Executed as the Persona's `Identity` HFS!)
// ---------------------------------------------------------------------------

function findMe(charter) {
  if (!charter || !charter.members) return null;
  const idAddr = (app.personas[app.activePersonaIdx]?.identityAddr || '').toLowerCase();
  if (!idAddr) return null;
  return charter.members.find((m) => m.identityAddr.toLowerCase() === idAddr) || null;
}

async function queryIdentityOwner(idAddr) {
  try {
    const hex = await rpcCall('eth_call', [{ to: idAddr, data: IdentityAbi.owner() }, 'latest']);
    if (!hex || hex.length < 42) return '';
    return '0x' + hex.slice(-40).toLowerCase();
  } catch (_) {
    return '';
  }
}

async function sendSignedDirectTx(privKey, toAddr, dataHex, label, extraTargets = []) {
  const fromEoa = computeAddress(privKey);
  const nonce = BigInt(await rpcCall('eth_getTransactionCount', [fromEoa, 'latest']));
  const chainId = BigInt(await rpcCall('eth_chainId').catch(() => '0x539'));
  const raw = signLexiconTx({
    privateKey: privKey,
    nonce,
    to: toAddr,
    data: dataHex,
    gasLimit: 8_500_000n,
    gasPrice: 1_000_000_000n,
    chainId,
    extraTargets,
  });
  const h = await rpcCall('eth_sendRawTransaction', [raw]);
  slxWallet.recordExternalRpcTx({
    txHash: h,
    rawTx: raw,
    from: fromEoa,
    to: toAddr,
    contractLabel: 'CommonsRF(RPC)',
    fnLabel: label,
    dataHex,
    blockNumber: app.rpcData?.charter?.currentBlock || 0,
  });
  return waitReceipt(h, label);
}

/**
 * Automatically claim & register a dedicated on-chain `Identity` HFS on Subnet 1
 * when a new/switched `secp256k1` wallet performs its first CommonsRF write action.
 */
async function ensureActivePersonaRegisteredOnNode() {
  if (app.mode !== 'rpc' || app.activePersonaIdx !== 0 || !app.suiteAddrs.charter) return null;
  const existing = findMe(app.rpcData.charter);
  if (existing) return existing;

  const isUnifiedRegistry =
    !app.suiteAddrs.identityRegistry ||
    app.suiteAddrs.identityRegistry.toLowerCase() ===
      SUBNET1_FLEET_SOCIAL_DEFAULT.identityRegistry.toLowerCase();

  if (isUnifiedRegistry) {
    const idRec = await slxWallet.ensureIdentityWithPrompt({
      rpcUrl: app.rpcUrl,
      appName: 'CommonsRF Social',
    });
    if (!idRec?.identityAddr) {
      throw new Error('Unified Identity HFS required to enroll on SocialCharter.');
    }
    const tag = slxWallet.keypair.address.slice(2, 6).toUpperCase();
    const shortName = idRec.nickname || `Citizen ${tag}`;
    const handle = `@${(idRec.handle || `citizen_${tag.toLowerCase()}`).replace(/^@/, '')}`;
    app.personas[0].priv = slxWallet.keypair.privateKey;
    app.personas[0].eoa = slxWallet.keypair.address;
    app.personas[0].identityAddr = idRec.identityAddr;
    app.personas[0].handle = handle;
    app.personas[0].shortName = shortName;
    app.personas[0].name = `${shortName} (You)`;
    app.personas[0].role = 'Subnet 1 Citizen';
    app.personas[0].device = 'Web Radio Client';
    app.personas[0].xM = 1525;
    app.personas[0].yM = 1490;

    // Check again in case this Identity was already registered on SocialCharter (e.g. from Phantom Fleet!)
    const alreadyMem = app.rpcData.charter?.members?.find(
      (m) => m.identityAddr.toLowerCase() === idRec.identityAddr.toLowerCase()
    );
    if (alreadyMem) return alreadyMem;

    await sendViaIdentity(
      0,
      app.suiteAddrs.charter,
      CharterAbi.registerProfile(
        1525,
        1490,
        `${shortName}|${handle}|Subnet 1 Citizen|Web Radio Client`
      ),
      'SocialCharter.registerProfile',
      [idRec.identityAddr]
    );
    return findMe(app.rpcData.charter);
  }

  const walletEoa = slxWallet.keypair.address.toLowerCase();
  const poolAddrs = app.onboardingPool.addrs || [];
  const poolPrivs = app.onboardingPool.privs || [];

  let claimedAddr = '';
  let slotIdx = -1;

  // 1. Check if this wallet already owns one of the pool Identity HFSs
  for (let k = 0; k < poolAddrs.length; k++) {
    const owner = await queryIdentityOwner(poolAddrs[k]);
    if (owner === walletEoa) {
      claimedAddr = poolAddrs[k];
      slotIdx = k;
      break;
    }
  }

  // 2. Otherwise transfer ownership of the next unclaimed pool Identity HFS to this wallet!
  if (!claimedAddr) {
    for (let k = 0; k < poolAddrs.length && k < poolPrivs.length; k++) {
      const slotOwnerEoa = computeAddress(poolPrivs[k]).toLowerCase();
      const owner = await queryIdentityOwner(poolAddrs[k]);
      if (owner === slotOwnerEoa) {
        showToast(
          `🪪 Onboarding <code>${walletEoa.slice(0, 8)}..</code> onto dedicated Subnet 1 <code>Identity</code> HFS...`,
          'info'
        );
        await sendSignedDirectTx(
          poolPrivs[k],
          poolAddrs[k],
          IdentityAbi.transferOwnership(slxWallet.keypair.address),
          'Identity.transferOwnership'
        );
        claimedAddr = poolAddrs[k];
        slotIdx = k;
        break;
      }
    }
  }

  if (!claimedAddr) {
    throw new Error('No unclaimed citizen Identity HFS slots remaining in onboarding pool.');
  }

  const tag = slxWallet.keypair.address.slice(2, 6).toUpperCase();
  const handle = `@citizen_${slotIdx >= 0 ? slotIdx + 1 : tag.toLowerCase()}`;
  const shortName = `Citizen ${tag}`;
  app.personas[0].priv = slxWallet.keypair.privateKey;
  app.personas[0].eoa = slxWallet.keypair.address;
  app.personas[0].identityAddr = claimedAddr;
  app.personas[0].handle = handle;
  app.personas[0].shortName = shortName;
  app.personas[0].name = `${shortName} (You)`;
  app.personas[0].role = 'Local Subnet Citizen';
  app.personas[0].device = 'Web Radio Client';
  app.personas[0].xM = 1525;
  app.personas[0].yM = 1490;

  await sendViaIdentity(
    0,
    app.suiteAddrs.charter,
    CharterAbi.registerProfile(
      1525,
      1490,
      `${shortName}|${handle}|Local Subnet Citizen|Web Radio Client`
    ),
    'SocialCharter.registerProfile'
  );
  return findMe(app.rpcData.charter);
}

async function actionMoveOrPing(personaIdx, newX, newY, announce = false) {
  const p = app.personas[personaIdx];
  p.xM = Math.max(50, Math.min(4800, Math.round(newX)));
  p.yM = Math.max(50, Math.min(4800, Math.round(newY)));

  if (app.mode === 'rpc' && app.suiteAddrs.charter) {
    try {
      await sendViaIdentity(
        personaIdx,
        app.suiteAddrs.charter,
        CharterAbi.pingPresence(p.xM, p.yM),
        'pingPresence'
      );
    } catch (_) {}
    return;
  }

  const m = app.sim.members.find(
    (x) => x.identityAddr.toLowerCase() === p.identityAddr.toLowerCase()
  );
  if (m && !m.sanctioned) {
    const wasActive = simIsMemberActive(m);
    m.xM = p.xM;
    m.yM = p.yM;
    if (!p.radioMuted) m.lastHeartbeatBlock = app.sim.currentBlock;
    const nowActive = simIsMemberActive(m);
    if (wasActive && !nowActive) {
      logAudit(`⚫ <strong>${escapeHtml(m.handle)}</strong> left 1.2 km subnet → connections <strong>DORMANT</strong>.`);
      if (announce) {
        showToast(
          `⚫ <strong>${escapeHtml(m.name)} (${escapeHtml(m.handle)})</strong> moved outside the 1.2 km subnet — their DMs, Friends-Only wall &amp; ProductLedger storefront are <strong>Dormant</strong>!`,
          'warn'
        );
      }
    } else if (!wasActive && nowActive) {
      logAudit(`🟢 <strong>${escapeHtml(m.handle)}</strong> returned inside subnet → connections <strong>AWAKE</strong>!`);
      if (announce) {
        showToast(
          `🟢 <strong>${escapeHtml(m.name)} (${escapeHtml(m.handle)})</strong> is back inside the radio subnet!`,
          'ok'
        );
      }
    }
  }
  renderAll();
}

async function actionOpenHandshake(targetUid, tier = 2) {
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
      return;
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  const target = view.charter.members.find((m) => m.uid === targetUid);
  if (!me || !target) {
    showToast(`🚫 Unregistered outsider Identity cannot open RF handshakes!`, 'err');
    return;
  }
  const chrAddr = app.suiteAddrs.charter || '0x00000000000000000000000000000000000000c1';
  const nonceHex =
    app.mode === 'rpc'
      ? deterministicEncounterNonce(chrAddr, me.identityAddr, target.identityAddr)
      : bytesToHex(randomBytes(32));
  const commitHex = computeEncounterCommitHex(
    chrAddr,
    me.identityAddr,
    target.identityAddr,
    nonceHex
  );

  if (app.mode === 'rpc') {
    try {
      const rfMax = Math.max(120, (view.charter.rfEncounterRangeM || 500) - 30);
      if (!me.isActive || distMeters(me.xM, me.yM, target.xM, target.yM) > rfMax) {
        await sendViaIdentity(
          app.activePersonaIdx,
          app.suiteAddrs.charter,
          CharterAbi.pingPresence(
            Math.max(100, Math.min(4900, (target.xM || 1500) + 12)),
            Math.max(100, Math.min(4900, (target.yM || 1500) + 8))
          ),
          'pingPresence',
          [me.identityAddr, target.identityAddr]
        );
      }
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.relationships,
        RelationshipsAbi.openEncounterHandshake(target.identityAddr, tier, commitHex),
        'openHandshake',
        [me.identityAddr, target.identityAddr]
      );
      app.knownHandshakeNonces.set(`${me.uid}->${target.uid}`, nonceHex);
      showToast(`📶 Sent 2.4 GHz Handshake Challenge to ${escapeHtml(target.handle)}!`, 'ok');
    } catch (e) {
      showToast(`🚫 Handshake Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }

  const dist = distMeters(me.xM, me.yM, target.xM, target.yM);
  if (!me.isActive || !target.isActive || dist > view.charter.rfEncounterRangeM) {
    showToast(`🚫 Must be within &le;150m 2.4 GHz range (${Math.round(dist)}m apart)!`, 'err');
    return;
  }
  app.knownHandshakeNonces.set(`${me.uid}->${target.uid}`, nonceHex);
  app.sim.handshakes = app.sim.handshakes.filter(
    (h) => !(h.initiatorUid === me.uid && h.targetUid === target.uid)
  );
  app.sim.handshakes.push({
    initiatorUid: me.uid,
    targetUid: target.uid,
    tier,
    expiresBlock: app.sim.currentBlock + 6,
    commitHex,
  });
  app.mainTab = 'handshakes';
  if (wasmSocialAddrs.ready && wasmSocialAddrs.charter) {
    const wasmCommit = computeEncounterCommitHex(
      wasmSocialAddrs.charter,
      me.identityAddr,
      target.identityAddr,
      nonceHex
    );
    recordSignedSocialViaIdentity(
      app.activePersonaIdx,
      wasmSocialAddrs.relationships,
      RelationshipsAbi.openEncounterHandshake(target.identityAddr, tier, wasmCommit),
      'SocialRelationships.openHandshake'
    );
  }
  showToast(`📶 <strong>2.4 GHz Challenge Sent (${Math.round(dist)}m)!</strong> Complete co-sign below.`, 'info');
  renderAll();
}

async function actionAcceptHandshake(initUid, targUid) {
  const view = getActiveSuiteView();
  const initM = view.charter.members.find((m) => m.uid === initUid);
  const targM = view.charter.members.find((m) => m.uid === targUid);
  if (!initM || !targM) return;

  const nonceHex =
    app.knownHandshakeNonces.get(`${initUid}->${targUid}`) ||
    (app.mode === 'rpc' && app.suiteAddrs.charter
      ? deterministicEncounterNonce(app.suiteAddrs.charter, initM.identityAddr, targM.identityAddr)
      : bytesToHex(randomBytes(32)));
  const targIdx = app.personas.findIndex(
    (p) => p.identityAddr.toLowerCase() === targM.identityAddr.toLowerCase()
  );

  if (app.mode === 'rpc' && targIdx >= 0) {
    try {
      const rfMax = Math.max(120, (view.charter.rfEncounterRangeM || 500) - 30);
      if (!targM.isActive || distMeters(initM.xM, initM.yM, targM.xM, targM.yM) > rfMax) {
        await sendViaIdentity(
          targIdx,
          app.suiteAddrs.charter,
          CharterAbi.pingPresence(
            Math.max(100, Math.min(4900, (initM.xM || 1500) + 12)),
            Math.max(100, Math.min(4900, (initM.yM || 1500) + 8))
          ),
          'pingPresence',
          [initM.identityAddr, targM.identityAddr]
        );
      }
      await sendViaIdentity(
        targIdx,
        app.suiteAddrs.relationships,
        RelationshipsAbi.acceptEncounterHandshake(initM.identityAddr, nonceHex),
        'acceptHandshake',
        [initM.identityAddr, targM.identityAddr]
      );
      showToast(`🤝 Mutual RF Relationship verified between Identity HFSs (+3 Trust)!`, 'ok');
    } catch (e) {
      showToast(`🚫 Accept Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }

  const dist = distMeters(initM.xM, initM.yM, targM.xM, targM.yM);
  if (!initM.isActive || !targM.isActive || dist > view.charter.rfEncounterRangeM) {
    showToast(`🚫 Both Identities must remain within &le;150m 2.4 GHz range!`, 'err');
    return;
  }
  const h = app.sim.handshakes.find(
    (x) => x.initiatorUid === initUid && x.targetUid === targUid
  );
  app.sim.handshakes = app.sim.handshakes.filter(
    (x) => !(x.initiatorUid === initUid && x.targetUid === targUid)
  );
  simSetEdge(initUid, targUid, h ? h.tier : 2);
  app.sim.members[initUid].trustScore = Math.min(100, app.sim.members[initUid].trustScore + 3);
  app.sim.members[targUid].trustScore = Math.min(100, app.sim.members[targUid].trustScore + 3);
  if (targIdx >= 0) {
    recordSignedSocialViaIdentity(
      targIdx,
      wasmSocialAddrs.relationships,
      RelationshipsAbi.acceptEncounterHandshake(initM.identityAddr, nonceHex),
      'SocialRelationships.acceptHandshake'
    );
  }
  logAudit(`🤝 <strong>Identity Handshake</strong>: ${escapeHtml(initM.handle)} &harr; ${escapeHtml(targM.handle)} (+3 Trust).`);
  showToast(`🤝 <strong>RF Relationship Established!</strong> ${escapeHtml(initM.handle)} &amp; ${escapeHtml(targM.handle)} connected!`, 'ok');
  renderAll();
}

async function actionVouch(subjectUid) {
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  const subj = view.charter.members.find((m) => m.uid === subjectUid);
  if (!me || !subj) return;

  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.charter,
        CharterAbi.vouchNeighbor(subj.identityAddr),
        'vouchNeighbor'
      );
      showToast(`🛡️ Co-signed vouch for ${escapeHtml(subj.handle)}!`, 'ok');
    } catch (e) {
      showToast(`🚫 Vouch Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }

  const dist = distMeters(me.xM, me.yM, subj.xM, subj.yM);
  if (!me.isActive || !subj.isActive || me.trustScore < 60 || dist > view.charter.rfEncounterRangeM) {
    showToast(`🚫 Requires Verified Citizen (&ge;60 Trust) within &le;150m 2.4 GHz range!`, 'err');
    return;
  }
  const sm = app.sim.members[subjectUid];
  if (sm.vouchers.includes(me.uid)) return;
  const boost = sm.vouchers.length === 0 ? 25 : 12;
  sm.vouchers.push(me.uid);
  sm.trustScore = Math.min(100, sm.trustScore + boost);
  recordSignedSocialViaIdentity(
    app.activePersonaIdx,
    wasmSocialAddrs.charter,
    CharterAbi.vouchNeighbor(subj.identityAddr),
    'SocialCharter.vouchNeighbor'
  );
  logAudit(`🛡️ <strong>SocialCharter</strong>: ${escapeHtml(me.handle)} vouched ${escapeHtml(sm.handle)} (&rarr; ${sm.trustScore} Trust).`);
  showToast(
    `🛡️ <strong>Vouch Co-Signed!</strong> ${escapeHtml(sm.handle)} now has <strong>${sm.trustScore} Trust</strong> and can own a <code>ProductLedger</code> storefront!`,
    'ok'
  );
  renderAll();
}

async function actionFlag(offenderUid, reason = 1) {
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  const off = view.charter.members.find((m) => m.uid === offenderUid);
  if (!me || !off) {
    showToast(`🚫 Overseas Identity outside subnet cannot flag local citizens!`, 'err');
    return;
  }
  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.charter,
        CharterAbi.flagAccountability(off.identityAddr, reason),
        'flagAccountability'
      );
      showToast(`⚖️ Flagged ${escapeHtml(off.handle)} on SocialCharter!`, 'warn');
    } catch (e) {
      showToast(`🚫 Flag Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }

  if (!me.isActive || me.trustScore < 55) {
    showToast(`🚫 Requires Active Verified Citizen (&ge;55 Trust)!`, 'err');
    return;
  }
  const target = app.sim.members[offenderUid];
  if ((target.flaggedByMask & (1n << BigInt(me.uid))) !== 0n) {
    showToast(`ℹ️ Switch Act As to a 2nd Verified Neighbor to trigger consensus voucher slashing!`, 'warn');
    return;
  }
  target.flaggedByMask |= 1n << BigInt(me.uid);
  target.trustScore = Math.max(0, target.trustScore - 15);
  recordSignedSocialViaIdentity(
    app.activePersonaIdx,
    wasmSocialAddrs.charter,
    CharterAbi.flagAccountability(off.identityAddr, reason),
    'SocialCharter.flagAccountability'
  );
  const flags = popcountBig(target.flaggedByMask);
  let slashNote = '';
  if (!target.vouchersSlashed && flags >= 2) {
    target.vouchersSlashed = true;
    target.trustScore = Math.max(0, target.trustScore - 25);
    const names = [];
    for (const vUid of target.vouchers) {
      const vm = app.sim.members[vUid];
      if (vm) {
        vm.trustScore = Math.max(0, vm.trustScore - 18);
        vm.slashCount += 1;
        app.sim.totalSlashes += 1;
        names.push(`${vm.handle} (-18 → ${vm.trustScore} Trust)`);
        logAudit(`⚡ <strong>VOUCHER SLASHED</strong>: ${escapeHtml(vm.handle)} lost <code>-18 Trust</code>!`);
      }
    }
    if (names.length) slashNote = ` Slashed reckless voucher(s): <strong>${escapeHtml(names.join(', '))}</strong>!`;
  }
  if (target.trustScore < 15) target.sanctioned = true;
  showToast(
    `⚖️ <strong>Flag #${flags} Recorded!</strong> ${escapeHtml(target.handle)} &rarr; <strong>${target.trustScore} Trust</strong>${target.sanctioned ? ' (<strong>SANCTIONED</strong>)' : ''}.${slashNote}`,
    flags >= 2 ? 'err' : 'warn'
  );
  renderAll();
}

async function actionCreatePost(vis, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
      return;
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  const p = app.personas[app.activePersonaIdx];
  if (!me) {
    const d = Math.round(distMeters(p.xM, p.yM, CENTER_X, CENTER_Y));
    showToast(
      `🚫 <strong>Identity.execute → SocialFeed Revert (-48):</strong> <strong>${escapeHtml(p.handle)}</strong> is <code>${d}m</code> outside the physical radio subnet!`,
      'err'
    );
    logAudit(`🚫 Blocked remote post from <strong>${escapeHtml(p.handle)}</strong> (${d}m away).`);
    return;
  }
  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.feed,
        FeedAbi.createPost(vis, trimmed),
        'createPost'
      );
      app.postTextDraft = '';
    } catch (e) {
      showToast(`🚫 Post Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }
  if (!me.isActive || me.trustScore < 20) {
    showToast(`🚫 Dormant or sanctioned Identities cannot broadcast!`, 'err');
    return;
  }
  app.sim.posts.unshift({
    postId: app.sim.nextPostId++,
    authorUid: me.uid,
    visibility: vis,
    createdBlock: app.sim.currentBlock,
    likedByMask: 0n,
    endorsedByMask: 0n,
    content: trimmed,
    comments: [],
  });
  app.postTextDraft = '';
  recordSignedSocialViaIdentity(
    app.activePersonaIdx,
    wasmSocialAddrs.feed,
    FeedAbi.createPost(vis, trimmed),
    'SocialFeed.createPost'
  );
  renderAll();
}

async function actionReactPost(postId, kind) {
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      return showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  if (!me || !me.isActive) return showToast(`🚫 Active subnet radio presence required!`, 'err');
  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.feed,
        FeedAbi.reactPost(postId, kind),
        'reactPost'
      );
    } catch (e) {
      showToast(`🚫 Reaction Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }
  const post = app.sim.posts.find((x) => x.postId === postId);
  if (!post) return;
  const author = view.charter.members.find((m) => m.uid === post.authorUid);
  if (post.visibility >= 1 && me.uid !== post.authorUid) {
    const tier = getEdgeTierFromSnap(view.relationships, me.uid, post.authorUid);
    if (!author?.isActive || tier < (post.visibility === 2 ? 3 : 2)) {
      return showToast(`🚫 Requires active RF relationship in subnet range!`, 'warn');
    }
  }
  if (kind === 1) post.likedByMask |= 1n << BigInt(me.uid);
  else post.endorsedByMask |= 1n << BigInt(me.uid);
  recordSignedSocialViaIdentity(
    app.activePersonaIdx,
    wasmSocialAddrs.feed,
    FeedAbi.reactPost(postId, kind),
    'SocialFeed.reactPost'
  );
  renderAll();
}

async function actionCommentPost(postId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      return showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  if (!me || !me.isActive) return showToast(`🚫 Active subnet radio presence required!`, 'err');
  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.feed,
        FeedAbi.commentPost(postId, trimmed),
        'commentPost'
      );
    } catch (e) {
      showToast(`🚫 Comment Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }
  const post = app.sim.posts.find((x) => x.postId === postId);
  if (!post) return;
  post.comments.push({ block: app.sim.currentBlock, authorAddr: me.identityAddr, text: trimmed });
  recordSignedSocialViaIdentity(
    app.activePersonaIdx,
    wasmSocialAddrs.feed,
    FeedAbi.commentPost(postId, trimmed),
    'SocialFeed.commentPost'
  );
  renderAll();
}

async function actionSendDm(peerUid, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      return showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  const peer = view.charter.members.find((m) => m.uid === peerUid);
  if (!me || !peer) return showToast(`🚫 Unregistered outsider cannot DM!`, 'err');

  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.feed,
        FeedAbi.sendDirectMessage(peer.identityAddr, trimmed),
        'sendDirectMessage'
      );
      showToast(`💬 Proximity DM stored in protected <code>Messaging</code> HFS!`, 'ok');
    } catch (e) {
      showToast(`🚫 DM Rejected: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }

  const tier = getEdgeTierFromSnap(view.relationships, me.uid, peer.uid);
  if (!me.isActive || !peer.isActive || tier < 1) {
    showToast(
      `🚫 <strong>SocialFeed → Messaging Revert (-51):</strong> ${!peer.isActive ? `${escapeHtml(peer.handle)} is Dormant (Out of Range)!` : `Complete a <=150m 2.4 GHz Handshake with ${escapeHtml(peer.handle)} first!`}`,
      'err'
    );
    return;
  }
  simAppendDm(me.uid, peer.uid, trimmed, app.sim.currentBlock);
  recordSignedSocialViaIdentity(
    app.activePersonaIdx,
    wasmSocialAddrs.feed,
    FeedAbi.sendDirectMessage(peer.identityAddr, trimmed),
    'SocialFeed.sendDirectMessage'
  );
  renderAll();
}

async function actionCheckInEvent(eventId) {
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      return showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  if (!me) return showToast(`🚫 Unregistered outsider cannot check in!`, 'err');
  if (app.mode === 'rpc') {
    try {
      await sendViaIdentity(
        app.activePersonaIdx,
        app.suiteAddrs.events,
        EventsAbi.checkInEvent(eventId),
        'checkInEvent'
      );
      showToast(`📍 Verified 2.4 GHz Event Check-In via Identity.execute (+2 Trust)!`, 'ok');
    } catch (e) {
      showToast(`🚫 Check-In Rejected (Walk <=150m of venue!): ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }
  const ev = app.sim.events.find((x) => x.eventId === eventId);
  if (!ev) return;
  const dist = distMeters(me.xM, me.yM, ev.venueX, ev.venueY);
  if (!me.isActive || dist > view.charter.rfEncounterRangeM) {
    return showToast(
      `🚫 <strong>SocialEvents Revert (-45):</strong> You are <code>${Math.round(dist)}m</code> from ${escapeHtml(ev.venueName)} (&gt;150m 2.4 GHz limit)!`,
      'err'
    );
  }
  if ((ev.attendedMask & (1n << BigInt(me.uid))) === 0n) {
    ev.rsvpMask |= 1n << BigInt(me.uid);
    ev.attendedMask |= 1n << BigInt(me.uid);
    app.sim.members[me.uid].trustScore = Math.min(100, app.sim.members[me.uid].trustScore + 2);
    recordSignedSocialViaIdentity(
      app.activePersonaIdx,
      wasmSocialAddrs.events,
      EventsAbi.checkInEvent(eventId),
      'SocialEvents.checkInEvent'
    );
    logAudit(`📍 <strong>SocialEvents</strong>: ${escapeHtml(me.handle)} checked in via 2.4 GHz RF (+2 Trust).`);
    showToast(`📍 <strong>2.4 GHz Check-In Verified (${Math.round(dist)}m)!</strong> +2 Civic Trust on <code>SocialCharter</code>!`, 'ok');
  }
  renderAll();
}

/** Upsert a SKU onto the active Persona's own `Identity`-owned `ProductLedger` HFS! */
async function actionUpsertMyProduct(nameStr, units, price) {
  const cleanName = nameStr.trim().slice(0, 32);
  if (!cleanName) return;
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  if (!me) return showToast(`🚫 Overseas accounts cannot deploy a ProductLedger!`, 'err');

  const skuId = keccak256Hex(utf8ToBytes(`${me.identityAddr}:${cleanName}`));

  if (app.mode === 'rpc') {
    try {
      let storeAddr = me.productLedgerAddr;
      if (!storeAddr || storeAddr === ZERO_ADDR) {
        const plHash =
          app.productLedgerCodeHash ||
          (await fetchAndStoreWasm(app.activePersonaIdx, 'product_ledger.wasm'));
        storeAddr = await instantiateCodeHash(app.activePersonaIdx, plHash, 'ProductLedger');
        app.personas[app.activePersonaIdx].productLedgerAddr = storeAddr;
        await sendViaIdentity(
          app.activePersonaIdx,
          storeAddr,
          ProductLedgerAbi.initializeForIdentity(
            app.suiteAddrs.identityRegistry,
            me.identityAddr,
            app.suiteAddrs.charter
          ),
          'ProductLedger.initForIdentity'
        );
        await sendViaIdentity(
          app.activePersonaIdx,
          app.suiteAddrs.charter,
          CharterAbi.attachProductLedger(storeAddr),
          'attachProductLedger'
        );
      }
      await sendRawEoaTx(
        app.activePersonaIdx,
        me.identityAddr,
        IdentityAbi.upsertProduct(storeAddr, skuId, units, price, cleanName),
        'Identity.upsertProduct',
        allRpcExtraTargets()
      );
      await refreshRpcSuite();
      showToast(
        `🛒 Listed <strong>${escapeHtml(cleanName)}</strong> on <code>${escapeHtml(me.handle)}</code>'s Identity-owned <code>ProductLedger</code>!`,
        'ok'
      );
    } catch (e) {
      showToast(`🚫 ProductLedger Rejected Listing: ${escapeHtml(e.message)}`, 'err');
    }
    return;
  }

  if (!me.isActive || me.trustScore < 60) {
    showToast(
      `🚫 <strong>ProductLedger → SocialCharter Revert (-46):</strong> Only Active Verified Citizens (&ge;60 Trust) can own &amp; list on a <code>ProductLedger</code> (${escapeHtml(me.handle)} has <strong>${me.trustScore} Trust</strong>)!`,
      'err'
    );
    return;
  }

  let sf = app.sim.storefronts.get(me.identityAddr.toLowerCase());
  if (!sf) {
    const newAddr = `0x000000000000000000000000000000000057000${me.uid + 1}`;
    sf = { productLedgerAddr: newAddr, skus: [] };
    app.sim.storefronts.set(me.identityAddr.toLowerCase(), sf);
    app.sim.members[me.uid].productLedgerAddr = newAddr;
  }
  sf.skus.unshift({
    productId: skuId,
    name: cleanName,
    unitsAvailable: units,
    latestPrice: price,
    totalUnitsSold: 0,
    active: true,
  });
  logAudit(
    `🛒 <strong>Identity.upsertProduct</strong>: ${escapeHtml(me.handle)} listed "${escapeHtml(cleanName)}" (${units} units @ SGD ${price}) on their <code>ProductLedger</code>.`
  );
  showToast(
    `🛒 Upserted <strong>${escapeHtml(cleanName)}</strong> on <code>${escapeHtml(me.handle)}</code>'s personal <code>ProductLedger</code>!`,
    'ok'
  );
  renderAll();
}

/** Buy 1 unit from a neighbor's `ProductLedger` via `BuyerIdentity.buyProduct(sellerProductLedger, productId, 1)`! */
async function actionBuyFromProductLedger(sellerUid, productLedgerAddr, productIdHex) {
  if (app.mode === 'rpc' && app.activePersonaIdx === 0 && !findMe(getActiveSuiteView().charter)) {
    try { await ensureActivePersonaRegisteredOnNode(); } catch (e) {
      return showToast(`🚫 Onboarding error: ${escapeHtml(e.message)}`, 'err');
    }
  }
  const view = getActiveSuiteView();
  const me = findMe(view.charter);
  const seller = view.charter.members.find((m) => m.uid === sellerUid);
  if (!me || !seller) {
    return showToast(`🚫 Unverified outsider Identity cannot buy from local ProductLedgers!`, 'err');
  }
  if (me.uid === sellerUid) {
    return showToast(`ℹ️ Switch Act As to another neighbor to buy from your own ProductLedger!`, 'info');
  }

  if (app.mode === 'rpc') {
    try {
      await sendRawEoaTx(
        app.activePersonaIdx,
        me.identityAddr,
        IdentityAbi.buyProduct(productLedgerAddr, productIdHex, 1),
        'Identity.buyProduct',
        allRpcExtraTargets()
      );
      await refreshRpcSuite();
      showToast(
        `🛍️ <strong>Identity.buyProduct Verified (&le;150m RF)!</strong> Purchased 1 unit from <code>${escapeHtml(seller.handle)}</code>'s <code>ProductLedger</code> (+2 Civic Trust)!`,
        'ok'
      );
    } catch (e) {
      showToast(
        `🚫 ProductLedger.buyProduct Reverted (Must be within <=150m 2.4 GHz RF of ${escapeHtml(seller.handle)}!): ${escapeHtml(e.message)}`,
        'err'
      );
    }
    return;
  }

  const dist = distMeters(me.xM, me.yM, seller.xM, seller.yM);
  if (!me.isActive || !seller.isActive || dist > view.charter.rfEncounterRangeM) {
    return showToast(
      `🚫 <strong>Identity.buyProduct → ProductLedger → SocialCharter Revert (-45):</strong> Buyer <code>${escapeHtml(me.handle)}</code> and Seller <code>${escapeHtml(seller.handle)}</code> are <code>${Math.round(dist)}m</code> apart (&gt;150m 2.4 GHz in-person limit). Walk closer on the radar map!`,
      'err'
    );
  }

  const sf = app.sim.storefronts.get(seller.identityAddr.toLowerCase());
  const sku = sf?.skus.find((s) => s.productId === productIdHex);
  if (!sku || sku.unitsAvailable < 1) {
    return showToast(`🚫 Out of stock on ProductLedger (-82)!`, 'err');
  }
  sku.unitsAvailable -= 1;
  sku.totalUnitsSold += 1;
  app.sim.members[me.uid].trustScore = Math.min(100, app.sim.members[me.uid].trustScore + 2);
  app.sim.members[sellerUid].trustScore = Math.min(100, app.sim.members[sellerUid].trustScore + 2);
  logAudit(
    `🛍️ <strong>Identity.buyProduct</strong>: ${escapeHtml(me.handle)} bought "${escapeHtml(sku.name)}" from ${escapeHtml(seller.handle)}'s <code>ProductLedger</code> at <code>${Math.round(dist)}m</code> (+2 Trust each).`
  );
  showToast(
    `🛍️ <strong>2.4 GHz Checkout Verified (${Math.round(dist)}m)!</strong> <code>${escapeHtml(me.handle)}</code> bought <strong>${escapeHtml(sku.name)}</strong> from <code>${escapeHtml(seller.handle)}</code>'s <code>ProductLedger</code> (+2 Civic Trust)!`,
    'ok'
  );
  renderAll();
}

// ---------------------------------------------------------------------------
// Radar Map & UI Renderers
// ---------------------------------------------------------------------------

const MAP_SPAN_M = 1580;

function worldToCanvas(xM, yM, W, H) {
  const scale = (W * 0.5) / MAP_SPAN_M;
  const cx = Math.max(CENTER_X - MAP_SPAN_M + 42, Math.min(CENTER_X + MAP_SPAN_M - 42, xM));
  const cy = Math.max(CENTER_Y - MAP_SPAN_M + 42, Math.min(CENTER_Y + MAP_SPAN_M - 42, yM));
  return { cx: W / 2 + (cx - CENTER_X) * scale, cy: H / 2 + (cy - CENTER_Y) * scale };
}

function canvasToWorld(px, py, W, H) {
  const scale = (W * 0.5) / MAP_SPAN_M;
  return {
    xM: Math.round(CENTER_X + (px - W / 2) / scale),
    yM: Math.round(CENTER_Y + (py - H / 2) / scale),
  };
}

function renderRadar(view) {
  const W = el.rfRadarCanvas.width;
  const H = el.rfRadarCanvas.height;
  const scale = (W * 0.5) / MAP_SPAN_M;
  const chr = view.charter;

  radarCtx.clearRect(0, 0, W, H);
  radarCtx.fillStyle = '#040b17';
  radarCtx.fillRect(0, 0, W, H);

  radarCtx.strokeStyle = 'rgba(30, 58, 95, 0.26)';
  for (let p = 38; p < W; p += 38) {
    radarCtx.beginPath();
    radarCtx.moveTo(p, 0);
    radarCtx.lineTo(p, H);
    radarCtx.stroke();
    radarCtx.beginPath();
    radarCtx.moveTo(0, p);
    radarCtx.lineTo(W, p);
    radarCtx.stroke();
  }

  const subR = chr.subnetRadiusM * scale;
  radarCtx.save();
  radarCtx.beginPath();
  radarCtx.arc(W / 2, H / 2, subR, 0, Math.PI * 2);
  radarCtx.fillStyle = 'rgba(16, 185, 129, 0.06)';
  radarCtx.fill();
  radarCtx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
  radarCtx.lineWidth = 2;
  radarCtx.setLineDash([7, 5]);
  radarCtx.stroke();
  radarCtx.restore();

  radarCtx.fillStyle = 'rgba(110, 231, 183, 0.8)';
  radarCtx.font = '700 9.5px "JetBrains Mono", monospace';
  radarCtx.fillText('SUB-GHZ SUBNET (1.2 km)', W / 2 - 74, H / 2 - subR + 14);

  for (const ev of view.events.events) {
    const vp = worldToCanvas(ev.venueX, ev.venueY, W, H);
    radarCtx.fillStyle = 'rgba(245, 158, 11, 0.22)';
    radarCtx.beginPath();
    radarCtx.arc(vp.cx, vp.cy, Math.max(12, chr.rfEncounterRangeM * scale), 0, Math.PI * 2);
    radarCtx.fill();
    radarCtx.font = '12px sans-serif';
    radarCtx.fillText('📍', vp.cx - 6, vp.cy + 4);
  }

  for (const e of view.relationships.edges) {
    const a = chr.members.find((m) => m.uid === e.u1);
    const b = chr.members.find((m) => m.uid === e.u2);
    if (!a || !b) continue;
    const pa = worldToCanvas(a.xM, a.yM, W, H);
    const pb = worldToCanvas(b.xM, b.yM, W, H);
    const bothActive = a.isActive && b.isActive;
    radarCtx.save();
    radarCtx.beginPath();
    radarCtx.moveTo(pa.cx, pa.cy);
    radarCtx.lineTo(pb.cx, pb.cy);
    radarCtx.strokeStyle = bothActive ? 'rgba(56, 189, 248, 0.5)' : 'rgba(148, 163, 184, 0.24)';
    radarCtx.lineWidth = bothActive ? 2 : 1.2;
    if (!bothActive) radarCtx.setLineDash([4, 4]);
    radarCtx.stroke();
    radarCtx.restore();
  }

  const curP = app.personas[app.activePersonaIdx];
  const curM = findMe(chr);
  const curPt = worldToCanvas(curM ? curM.xM : curP.xM, curM ? curM.yM : curP.yM, W, H);
  const rfR = Math.max(18, chr.rfEncounterRangeM * scale);
  radarCtx.save();
  radarCtx.beginPath();
  radarCtx.arc(curPt.cx, curPt.cy, rfR, 0, Math.PI * 2);
  radarCtx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  radarCtx.fill();
  radarCtx.strokeStyle = '#38bdf8';
  radarCtx.lineWidth = 1.8;
  radarCtx.stroke();
  radarCtx.restore();

  for (const p of app.personas) {
    const m = chr.members.find(
      (x) => x.identityAddr.toLowerCase() === p.identityAddr.toLowerCase()
    );
    const pt = worldToCanvas(m ? m.xM : p.xM, m ? m.yM : p.yM, W, H);
    const isCur = p.idx === app.activePersonaIdx;
    const active = m ? m.isActive : false;

    radarCtx.save();
    radarCtx.beginPath();
    radarCtx.arc(pt.cx, pt.cy, isCur ? 13 : 10, 0, Math.PI * 2);
    radarCtx.fillStyle = !m ? '#334155' : active ? p.color : '#475569';
    radarCtx.fill();
    radarCtx.lineWidth = isCur ? 3 : 1.8;
    radarCtx.strokeStyle = isCur ? '#fde047' : active ? '#e2e8f0' : '#64748b';
    radarCtx.stroke();
    radarCtx.restore();

    const initials = p.shortName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    radarCtx.fillStyle = '#fff';
    radarCtx.font = '800 9px Inter, sans-serif';
    radarCtx.textAlign = 'center';
    radarCtx.fillText(initials, pt.cx, pt.cy + 3);
    radarCtx.font = '600 9.2px Inter, sans-serif';
    radarCtx.fillStyle = isCur ? '#fde047' : active ? '#e2e8f0' : '#94a3b8';
    radarCtx.fillText(
      `${p.shortName}${!m ? ' (4.2km)' : !active ? ' (Dormant)' : ''}`,
      pt.cx,
      pt.cy + 22
    );
    radarCtx.textAlign = 'start';
  }
}

function trustBadgeHtml(m) {
  if (m.sanctioned) return `<span class="sc-badge sc-badge-rose mono">🚫 SANCTIONED (${m.trustScore})</span>`;
  if (m.trustScore >= 60) return `<span class="sc-badge sc-badge-emerald mono">🛡️ Verified • ${m.trustScore} Trust</span>`;
  return `<span class="sc-badge sc-badge-amber mono">⚠️ Unvouched • ${m.trustScore} Trust</span>`;
}

function renderArchitectureBar(view) {
  const m = view.charter.modules;
  const curP = app.personas[app.activePersonaIdx];
  const specs = [
    ['1. IdentityRegistry', '19.2 KB', 'Allowlists identity.wasm code_hash & active Identities', m.identityRegistryHps],
    ['2. Identity (Per-User)', '34.0 KB', `@handle, delegates, execute(), upsertProduct(), buyProduct()`, curP.identityAddr],
    ['3. Messaging (Extended)', '7.8 KB', 'Protected Attributed Channels (Feed, Comments, DMs)', m.messagingHps],
    ['4. ProductLedger (Extended)', '35.6 KB', 'Owned by Seller Identity HFS + <=150m RF buyProduct()', `${view.storefronts.length} Storefront(s)`],
    ['5. SocialCharter', '21.4 KB', 'Radio Lease, Web-of-Trust, Slashing & Storefront Index', app.suiteAddrs.charter || 'Sim Root'],
    ['6. SocialRelationships', '13.0 KB', '<=150m 2.4 GHz Handshakes & Tiers (1..3)', m.relationshipsHps],
    ['7. SocialFeed & DMs', '16.0 KB', 'Scoped Wall & Proximity Messenger via Messaging HFS', m.feedHps],
    ['8. SocialEvents', '15.7 KB', 'Local Meetups & <=150m 2.4 GHz Proof-of-Attendance', m.eventsHps],
  ];
  el.archModulesGrid.innerHTML = specs
    .map(
      ([title, size, desc, addr]) => `<div class="sc-arch-chip">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#f8fafc;">${title}</strong>
          <span style="color:#6ee7b7;font-size:0.62rem;">${size}</span>
        </div>
        <div style="color:#94a3b8;font-family:Inter,sans-serif;font-size:0.67rem;margin:3px 0;">${desc}</div>
        <div style="color:#7dd3fc;font-size:0.62rem;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(addr)}</div>
      </div>`
    )
    .join('');
}

function renderCenterTab(view, me, curPersona) {
  const chr = view.charter;
  const rel = view.relationships;
  const meX = me ? me.xM : curPersona.xM;
  const meY = me ? me.yM : curPersona.yM;

  // TAB 1: WALL FEED
  if (app.mainTab === 'feed') {
    const canPost = me && me.isActive && me.trustScore >= 20;
    const composerHtml = canPost
      ? `<div class="sc-card">
          <div style="display:flex;gap:0.7rem;align-items:flex-start;">
            <div class="sc-avatar" style="background:${curPersona.color};">
              ${escapeHtml(curPersona.shortName[0])}
              <span class="sc-avatar-dot" style="background:#10b981;"></span>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:0.5rem;">
              <textarea id="composerInput" class="sc-textarea" placeholder="Broadcast via ${escapeHtml(me.handle)} Identity.execute → SocialFeed → Messaging HFS...">${escapeHtml(app.postTextDraft)}</textarea>
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.5rem;">
                <select id="composerVisSelect" class="sc-select" style="font-size:0.74rem;">
                  <option value="0" ${app.postVisDraft === 0 ? 'selected' : ''}>🌐 Subnet Commons</option>
                  <option value="1" ${app.postVisDraft === 1 ? 'selected' : ''}>🔒 RF Friends Only (Tier &ge; 2)</option>
                  <option value="2" ${app.postVisDraft === 2 ? 'selected' : ''}>💎 Close Circle Only (Tier 3)</option>
                </select>
                <button type="button" id="btnPublishPost" class="sc-btn sc-btn-primary">📡 Broadcast via Identity ($0.00)</button>
              </div>
            </div>
          </div>
        </div>`
      : `<div class="sc-card" style="border-color:rgba(244,63,94,0.45);">
          <strong style="color:#fda4af;font-size:0.86rem;">🚫 Verified In-Subnet Identity Presence Required</strong>
          <div style="font-size:0.76rem;color:#94a3b8;margin-top:4px;">
            ${!me ? `<code>${escapeHtml(curPersona.handle)}</code> is outside the 1.2 km subnet.` : `<code>${escapeHtml(me.handle)}</code> is currently Dormant or Sanctioned.`}
          </div>
        </div>`;

    const postsHtml = view.feed.posts
      .map((p) => {
        const author = chr.members.find((m) => m.uid === p.authorUid) || {
          uid: p.authorUid,
          name: `Citizen #${p.authorUid}`,
          handle: '@citizen',
          role: 'Resident',
          trustScore: 50,
          sanctioned: false,
          isActive: false,
          xM: CENTER_X,
          yM: CENTER_Y,
        };
        const tier = me ? getEdgeTierFromSnap(rel, me.uid, author.uid) : 0;
        const reqTier = p.visibility === 2 ? 3 : p.visibility === 1 ? 2 : 0;
        const locked = reqTier > 0 && (!me || (me.uid !== author.uid && tier < reqTier));
        const dFromMe = Math.round(distMeters(meX, meY, author.xM, author.yM));
        const avColor =
          app.personas.find(
            (x) => x.identityAddr.toLowerCase() === (author.identityAddr || '').toLowerCase()
          )?.color || '#2563eb';

        return `<article class="sc-post-card ${!author.isActive ? 'dormant-post' : ''}">
          <div class="sc-post-header">
            <div style="display:flex;gap:0.65rem;align-items:center;">
              <div class="sc-avatar" style="background:${avColor};">
                ${escapeHtml(author.name[0])}
                <span class="sc-avatar-dot" style="background:${author.isActive ? '#10b981' : '#64748b'};"></span>
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <strong style="font-size:0.9rem;">${escapeHtml(author.name)}</strong>
                  <span class="mono" style="font-size:0.72rem;color:#7dd3fc;">${escapeHtml(author.handle)}</span>
                  ${trustBadgeHtml(author)}
                  ${
                    author.isActive
                      ? `<span class="sc-badge sc-badge-cyan mono">🟢 ${dFromMe}m</span>`
                      : `<span class="sc-badge sc-badge-dormant mono">⚫ Dormant</span>`
                  }
                </div>
                <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">
                  ${escapeHtml(author.role)} • Blk #${p.createdBlock} •
                  <strong>${p.visibility === 2 ? '💎 Close Circle' : p.visibility === 1 ? '🔒 RF Friends' : '🌐 Subnet Commons'}</strong>
                </div>
              </div>
            </div>
            ${
              me && me.uid !== author.uid && !author.sanctioned
                ? `<button type="button" class="sc-btn sc-btn-rose" data-flag-uid="${author.uid}">🚩 Flag</button>`
                : ''
            }
          </div>
          ${
            locked
              ? `<div style="padding:0.7rem;border-radius:0.55rem;background:#091326;border:1px dashed #2b497a;font-size:0.78rem;color:#94a3b8;">
                  🔒 Restricted by <code>SocialRelationships</code> — requires active ${p.visibility === 2 ? 'Close Circle' : 'Mutual RF Friend'} handshake!
                </div>`
              : `<div class="sc-post-body">${escapeHtml(p.content)}</div>`
          }
          <div class="sc-post-actions">
            <button type="button" class="sc-btn" data-like-post="${p.postId}" ${locked ? 'disabled' : ''}>👍 Support (${popcountBig(p.likedByMask)})</button>
            <button type="button" class="sc-btn" data-endorse-post="${p.postId}" ${locked ? 'disabled' : ''}>🌟 Endorse (${popcountBig(p.endorsedByMask)})</button>
            <span style="margin-left:auto;font-size:0.7rem;color:#94a3b8;align-self:center;" class="mono">💬 ${p.comments.length} (Messaging HFS)</span>
          </div>
          ${
            !locked
              ? `<div class="sc-comments-list">
                  ${p.comments
                    .map((c) => {
                      const cm = chr.members.find(
                        (x) => x.identityAddr.toLowerCase() === c.authorAddr.toLowerCase()
                      );
                      return `<div class="sc-comment-bubble">
                        <strong style="color:#93c5fd;">${escapeHtml(cm ? `${cm.name} (${cm.handle})` : c.authorAddr.slice(0, 10))}</strong>
                        <div style="margin-top:2px;">${escapeHtml(c.text)}</div>
                      </div>`;
                    })
                    .join('')}
                  <div style="display:flex;gap:0.4rem;margin-top:0.2rem;">
                    <input type="text" class="sc-input" id="cmtInput_${p.postId}" placeholder="Reply via ${escapeHtml(curPersona.handle)} Identity..." style="flex:1;font-size:0.74rem;" />
                    <button type="button" class="sc-btn sc-btn-primary" data-send-cmt="${p.postId}">Reply</button>
                  </div>
                </div>`
              : ''
          }
        </article>`;
      })
      .join('');

    el.centerModuleView.innerHTML = composerHtml + postsHtml;
    const ci = document.getElementById('composerInput');
    if (ci) ci.oninput = (e) => (app.postTextDraft = e.target.value);
    const cv = document.getElementById('composerVisSelect');
    if (cv) cv.onchange = (e) => (app.postVisDraft = Number(e.target.value));
    const pb = document.getElementById('btnPublishPost');
    if (pb) pb.onclick = () => actionCreatePost(app.postVisDraft, app.postTextDraft);
    return;
  }

  // TAB 2: PROXIMITY MESSENGER
  if (app.mainTab === 'messages') {
    const peers = chr.members.filter((m) => !me || m.uid !== me.uid);
    if (peers.length > 0 && !peers.some((p) => p.uid === app.selectedDmPeerUid)) {
      app.selectedDmPeerUid = peers[0].uid;
    }
    const selPeer = chr.members.find((m) => m.uid === app.selectedDmPeerUid) || peers[0];
    const tier = me && selPeer ? getEdgeTierFromSnap(rel, me.uid, selPeer.uid) : 0;
    const canDm = me && selPeer && me.isActive && selPeer.isActive && tier >= 1;

    el.centerModuleView.innerHTML = `<div class="sc-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;flex-wrap:wrap;gap:0.4rem;">
        <div>
          <strong style="font-size:0.92rem;">💬 Identity-to-Identity Proximity Messenger</strong>
          <span class="sc-badge sc-badge-cyan mono" style="margin-left:6px;">Extended Messaging HFS</span>
        </div>
      </div>

      <div class="sc-dm-layout">
        <div style="display:flex;flex-direction:column;gap:0.38rem;border-right:1px solid #1e355d;padding-right:0.6rem;">
          ${peers
            .map((p) => {
              const t = me ? getEdgeTierFromSnap(rel, me.uid, p.uid) : 0;
              return `<button type="button" class="sc-btn ${p.uid === app.selectedDmPeerUid ? 'sc-btn-primary' : ''}" data-select-dm="${p.uid}" style="justify-content:space-between;text-align:left;padding:0.45rem 0.55rem;">
                <span>${p.isActive ? '🟢' : '⚫'} ${escapeHtml(p.name)}</span>
                <span class="mono" style="font-size:0.62rem;">${t > 0 ? `T${t}` : '🔒'}</span>
              </button>`;
            })
            .join('')}
        </div>

        <div style="display:flex;flex-direction:column;justify-content:space-between;gap:0.6rem;">
          <div style="padding:0.45rem 0.65rem;background:#091326;border-radius:0.55rem;border:1px solid #1e355d;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;">
            <div>
              <strong>${selPeer ? `${escapeHtml(selPeer.name)} (${escapeHtml(selPeer.handle)})` : 'Select Neighbor'}</strong>
            </div>
            <span class="sc-badge ${canDm ? 'sc-badge-emerald' : 'sc-badge-dormant'} mono">
              ${canDm ? '📡 Channel Live' : !selPeer?.isActive ? '⏸️ Peer Dormant' : '🔒 Handshake Needed'}
            </span>
          </div>

          <div style="flex:1;min-height:200px;max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:0.45rem;padding:0.4rem;">
            ${
              view.dms.length === 0
                ? `<div style="color:#64748b;font-size:0.78rem;margin:auto;">No DMs yet.</div>`
                : view.dms
                    .map((m) => {
                      const isMine =
                        me && m.authorAddr.toLowerCase() === me.identityAddr.toLowerCase();
                      return `<div class="sc-dm-bubble ${isMine ? 'mine' : 'theirs'}">
                        <div>${escapeHtml(m.text)}</div>
                        <div class="mono" style="font-size:0.62rem;opacity:0.75;margin-top:3px;">Blk #${m.block}</div>
                      </div>`;
                    })
                    .join('')
            }
          </div>

          <div style="display:flex;gap:0.45rem;">
            <input type="text" id="dmInputBox" class="sc-input" style="flex:1;" placeholder="Send DM via Identity.execute → SocialFeed → Messaging..." />
            <button type="button" class="sc-btn sc-btn-primary" id="btnSendDmNow">Send DM</button>
          </div>
        </div>
      </div>
    </div>`;

    const sendBtn = document.getElementById('btnSendDmNow');
    const dmInp = document.getElementById('dmInputBox');
    if (sendBtn && dmInp && selPeer) {
      sendBtn.onclick = () => actionSendDm(selPeer.uid, dmInp.value);
      dmInp.onkeydown = (e) => {
        if (e.key === 'Enter') actionSendDm(selPeer.uid, dmInp.value);
      };
    }
    return;
  }

  // TAB 3: LOCAL EVENTS
  if (app.mainTab === 'events') {
    el.centerModuleView.innerHTML =
      `<div class="sc-card">
        <strong style="font-size:0.92rem;">📅 Neighborhood Events &amp; &le;150m 2.4 GHz Proof-of-Attendance</strong>
        <div style="font-size:0.73rem;color:#94a3b8;margin-top:3px;">
          Check in via <code>Identity.execute → SocialEvents.checkInEvent</code> while physically within <code>&le;150m</code> of the 📍 venue (+2 Civic Trust)!
        </div>
      </div>` +
      view.events.events
        .map((ev) => {
          const host = chr.members.find((m) => m.uid === ev.hostUid);
          const distVenue = Math.round(distMeters(meX, meY, ev.venueX, ev.venueY));
          const inRf = me && me.isActive && distVenue <= chr.rfEncounterRangeM;
          const attended = me && (ev.attendedMask & (1n << BigInt(me.uid))) !== 0n;
          return `<div class="sc-post-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.6rem;flex-wrap:wrap;">
              <div>
                <strong style="font-size:0.94rem;">📍 ${escapeHtml(ev.title)}</strong>
                <span class="sc-badge ${inRf ? 'sc-badge-emerald' : 'sc-badge-amber'} mono" style="margin-left:6px;">
                  ${distVenue}m ${inRf ? '(In 2.4 GHz Range!)' : '(Walk <=150m)'}
                </span>
                <div style="font-size:0.72rem;color:#94a3b8;margin-top:3px;">
                  Host: <strong>${escapeHtml(host ? `${host.name} (${host.handle})` : 'Neighbor')}</strong> • Venue: <code>${escapeHtml(ev.venueName)}</code>
                </div>
              </div>
              <div style="display:flex;gap:0.4rem;">
                <button type="button" class="sc-btn" data-walk-venue="${ev.venueX}:${ev.venueY}">🚶 Walk to Venue</button>
                <button type="button" class="sc-btn ${attended ? '' : 'sc-btn-emerald'}" data-checkin-ev="${ev.eventId}" ${attended ? 'disabled' : ''}>
                  ${attended ? '✓ Checked In (+2 Trust)' : '📡 2.4 GHz Check-In'}
                </button>
              </div>
            </div>
            <div style="font-size:0.82rem;color:#e2e8f0;">${escapeHtml(ev.desc)}</div>
          </div>`;
        })
        .join('');
    return;
  }

  // TAB 4: IDENTITY-OWNED PRODUCTLEDGER MARKETPLACE!
  if (app.mainTab === 'market') {
    const canList = me && me.isActive && me.trustScore >= 60;
    el.centerModuleView.innerHTML =
      `<div class="sc-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;">
          <div>
            <strong style="font-size:0.92rem;">🛒 Identity-Owned <code>ProductLedger</code> Storefronts</strong>
            <div style="font-size:0.73rem;color:#94a3b8;margin-top:2px;">
              Each Verified Citizen (<code>&ge;60 Trust</code>) owns their own <code>ProductLedger</code> HFS via their <code>Identity</code> HFS! Buyers purchase in-person within <code>&le;150m</code> 2.4 GHz RF via <code>Identity.buyProduct(sellerProductLedger, sku, 1)</code>.
            </div>
          </div>
          <span class="sc-badge ${canList ? 'sc-badge-emerald' : 'sc-badge-rose'} mono">
            ${canList ? `✓ ${escapeHtml(me.handle)} Can Own ProductLedger` : '🔒 Seller Gate: Needs >=60 Trust'}
          </span>
        </div>
        <div style="display:grid;grid-template-columns:2fr 95px 95px auto;gap:0.45rem;align-items:center;">
          <input id="skuNameInput" class="sc-input" maxlength="32" placeholder="SKU name (max 32 chars, e.g. Kaya Jam Jar)..." />
          <input id="skuUnitsInput" type="number" min="1" value="5" class="sc-input mono" title="Units Available" />
          <input id="skuPriceInput" type="number" min="0" value="10" class="sc-input mono" title="Unit Price ($)" />
          <button type="button" id="btnUpsertMySku" class="sc-btn sc-btn-primary">+ Upsert on My ProductLedger</button>
        </div>
      </div>` +
      view.storefronts
        .map(({ sellerMember: s, productLedgerAddr, skus }) => {
          const dSeller = Math.round(distMeters(meX, meY, s.xM, s.yM));
          const inRf = me && me.isActive && s.isActive && dSeller <= chr.rfEncounterRangeM;
          return `<div class="sc-post-card ${!s.isActive ? 'dormant-post' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <div>
                <strong style="font-size:0.93rem;">🏪 ${escapeHtml(s.name)}'s <code>ProductLedger</code></strong>
                <span class="mono" style="font-size:0.72rem;color:#7dd3fc;margin-left:5px;">Owner Identity: ${escapeHtml(s.handle)}</span>
                <div class="mono" style="font-size:0.67rem;color:#94a3b8;margin-top:2px;">
                  ProductLedger HFS: <code>${escapeHtml(productLedgerAddr)}</code> • Seller Trust: <strong>${s.trustScore}</strong> • Distance: <strong>${dSeller}m</strong>
                </div>
              </div>
              <div style="display:flex;gap:0.35rem;align-items:center;">
                <span class="sc-badge ${inRf ? 'sc-badge-emerald' : 'sc-badge-amber'} mono">
                  ${!s.isActive ? '⚫ Seller Dormant' : inRf ? '📶 <=150m 2.4 GHz Ready' : `🚶 ${dSeller}m (>150m)`}
                </span>
                ${
                  me && me.uid !== s.uid
                    ? `<button type="button" class="sc-btn" data-walk-venue="${s.xM}:${s.yM}" style="font-size:0.69rem;padding:0.3rem 0.5rem;">🚶 Walk to Seller</button>`
                    : ''
                }
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.45rem;">
              ${skus
                .map(
                  (sku) => `<div class="sc-person-row">
                    <div>
                      <strong style="font-size:0.84rem;">${escapeHtml(sku.name)}</strong>
                      <div class="mono" style="font-size:0.68rem;color:#94a3b8;margin-top:2px;">
                        Price: <strong style="color:#6ee7b7;">${sku.latestPrice === 0 ? 'FREE / LOAN' : `SGD ${sku.latestPrice}`}</strong> •
                        Available: <strong>${sku.unitsAvailable}</strong> •
                        Sold: <strong>${sku.totalUnitsSold}</strong>
                      </div>
                    </div>
                    <button type="button" class="sc-btn ${sku.unitsAvailable > 0 && me && me.uid !== s.uid ? 'sc-btn-emerald' : ''}" data-buy-sku="${s.uid}|${productLedgerAddr}|${sku.productId}" ${sku.unitsAvailable > 0 && me && me.uid !== s.uid ? '' : 'disabled'}>
                      ${sku.unitsAvailable === 0 ? 'Sold Out' : '🛍️ Buy 1 via Identity.buyProduct'}
                    </button>
                  </div>`
                )
                .join('')}
            </div>
          </div>`;
        })
        .join('');

    const upBtn = document.getElementById('btnUpsertMySku');
    if (upBtn) {
      upBtn.onclick = () => {
        const name = document.getElementById('skuNameInput').value;
        const units = Math.max(1, Number(document.getElementById('skuUnitsInput').value) || 1);
        const price = Math.max(0, Number(document.getElementById('skuPriceInput').value) || 0);
        actionUpsertMyProduct(name, units, price);
      };
    }
    return;
  }

  // TAB 5: HANDSHAKES
  const hnds = rel.handshakes;
  el.centerModuleView.innerHTML =
    hnds.length === 0
      ? `<div class="sc-card" style="font-size:0.82rem;color:#94a3b8;">No pending 2.4 GHz handshakes.</div>`
      : hnds
          .map((h) => {
            const initM = chr.members.find((m) => m.uid === h.initiatorUid);
            const targM = chr.members.find((m) => m.uid === h.targetUid);
            if (!initM || !targM) return '';
            return `<div class="sc-card" style="border-color:#38bdf8;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <div>
                <span class="sc-badge sc-badge-cyan mono">📶 2.4 GHz IDENTITY CHALLENGE</span>
                <div style="margin-top:4px;font-size:0.85rem;">
                  <strong>${escapeHtml(initM.handle)}</strong> &rarr; <strong>${escapeHtml(targM.handle)}</strong>
                </div>
              </div>
              <button type="button" class="sc-btn sc-btn-emerald" data-accept-hnd="${h.initiatorUid}:${h.targetUid}">
                🤝 Co-Sign via ${escapeHtml(targM.handle)} Identity
              </button>
            </div>`;
          })
          .join('');
}

function renderAll() {
  const view = getActiveSuiteView();
  const chr = view.charter;
  const rel = view.relationships;
  const curPersona = app.personas[app.activePersonaIdx];
  const me = findMe(chr);
  const meX = me ? me.xM : curPersona.xM;
  const meY = me ? me.yM : curPersona.yM;

  renderArchitectureBar(view);

  el.personaSelect.innerHTML = app.personas
    .map((p) => {
      const m = chr.members.find(
        (x) => x.identityAddr.toLowerCase() === p.identityAddr.toLowerCase()
      );
      const tag = !m
        ? '🚫 Outside Subnet'
        : m.sanctioned
          ? '🚫 Sanctioned'
          : m.isActive
            ? `🟢 ${m.trustScore} Trust`
            : '⚫ Dormant';
      return `<option value="${p.idx}" ${p.idx === app.activePersonaIdx ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.handle)}) — ${tag}</option>`;
    })
    .join('');

  el.subnetBlockBadge.textContent = `Blk #${chr.currentBlock} • Lease: ${chr.heartbeatLeaseBlocks} blks`;
  el.activeCountBadge.textContent = `${chr.members.filter((m) => m.isActive).length}/${chr.members.length} In-Range`;
  el.slashesBadge.textContent = `${chr.totalSlashes} Slash${chr.totalSlashes === 1 ? '' : 'es'}`;

  document.querySelectorAll('[data-main-tab]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-main-tab') === app.mainTab);
  });
  const totalSkus = view.storefronts.reduce((s, x) => s + x.skus.length, 0);
  el.tabEventsBtn.textContent = `📅 Events (${view.events.events.length})`;
  el.tabMarketBtn.textContent = `🛒 ProductLedgers (${totalSkus})`;
  el.tabHandshakesBtn.textContent = `📶 Handshakes (${rel.handshakes.length})`;

  renderRadar(view);

  const distTower = Math.round(distMeters(meX, meY, chr.centerX, chr.centerY));
  el.selectedRadioBox.innerHTML = me
    ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;">
        <div>
          <strong>${escapeHtml(me.name)}</strong> <span class="mono" style="color:#7dd3fc;">${escapeHtml(me.handle)}</span>
          <div class="mono" style="font-size:0.65rem;color:#94a3b8;margin-top:2px;">
            Identity HFS: <code>${escapeHtml(me.identityAddr.slice(0, 12))}...</code> • Tower: <strong>${distTower}m</strong>
          </div>
        </div>
        <button type="button" class="sc-btn ${curPersona.radioMuted ? 'sc-btn-amber' : ''}" id="btnMuteToggle" style="font-size:0.68rem;padding:0.28rem 0.5rem;">
          ${curPersona.radioMuted ? '🔇 Muted (Unmute)' : '📡 Radio ON'}
        </button>
      </div>`
    : `<div style="color:#fda4af;font-size:0.72rem;">
        <strong>${escapeHtml(curPersona.handle)}</strong>: <code>${distTower}m</code> from tower (&gt;1,200m Subnet Boundary).
      </div>`;

  const muteBtn = document.getElementById('btnMuteToggle');
  if (muteBtn) {
    muteBtn.onclick = () => {
      curPersona.radioMuted = !curPersona.radioMuted;
      if (!curPersona.radioMuted && app.mode === 'sim' && me) {
        app.sim.members[me.uid].lastHeartbeatBlock = app.sim.currentBlock;
      }
      renderAll();
    };
  }

  renderCenterTab(view, me, curPersona);

  // Right Column: Civic Standing & Identity Info
  if (me) {
    const voucherNames = me.vouchers
      .map((u) => chr.members.find((x) => x.uid === u)?.handle)
      .filter(Boolean);
    const stakedFor = chr.members.filter((x) => x.vouchers.includes(me.uid)).map((x) => x.handle);
    const encCnt = rel.encounters[me.uid] || 0;

    el.myStandingCard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
        <div>
          <strong style="font-size:0.85rem;">🆔 ${escapeHtml(me.name)}</strong>
          <div class="mono" style="font-size:0.68rem;color:#7dd3fc;">${escapeHtml(me.handle)}</div>
        </div>
        ${trustBadgeHtml(me)}
      </div>
      <div class="sc-trust-track" style="margin:0.4rem 0;">
        <div class="sc-trust-fill" style="width:${me.trustScore}%;background:${me.sanctioned || me.trustScore < 20 ? '#f43f5e' : me.trustScore < 60 ? '#f59e0b' : '#10b981'};"></div>
      </div>
      <div style="font-size:0.69rem;color:#94a3b8;margin-top:0.45rem;line-height:1.48;" class="mono">
        <div>Identity HFS: <span style="color:#cbd5e1;">${escapeHtml(me.identityAddr.slice(0, 16))}...</span></div>
        <div>ProductLedger: <span style="color:#6ee7b7;">${me.productLedgerAddr && me.productLedgerAddr !== ZERO_ADDR ? escapeHtml(me.productLedgerAddr.slice(0, 16)) + '...' : 'None attached'}</span></div>
        <div>RF Encounters: <strong>${encCnt}</strong> • Slashes: <strong style="color:${me.slashCount ? '#fda4af' : '#6ee7b7'};">${me.slashCount}</strong></div>
        <div>Vouched By: ${voucherNames.length ? escapeHtml(voucherNames.join(', ')) : 'Seed / None'}</div>
        <div>You Vouched: ${stakedFor.length ? escapeHtml(stakedFor.join(', ')) : 'None'}</div>
      </div>`;
  } else {
    el.myStandingCard.innerHTML = `<strong style="color:#fda4af;font-size:0.84rem;">🚫 Outside Physical Subnet</strong>
      <p style="font-size:0.73rem;color:#94a3b8;margin:0.35rem 0 0 0;">Identity <code>${escapeHtml(curPersona.handle)}</code> has zero radio standing on this subnet.</p>`;
  }

  const nearby = me
    ? chr.members.filter(
        (m) =>
          m.uid !== me.uid &&
          m.isActive &&
          distMeters(me.xM, me.yM, m.xM, m.yM) <= chr.rfEncounterRangeM
      )
    : [];
  el.nearbyCountBadge.textContent = `${nearby.length} in range`;
  el.nearbyList.innerHTML =
    nearby.length === 0
      ? `<div style="font-size:0.73rem;color:#64748b;">Drag your avatar within 150m of a neighbor!</div>`
      : nearby
          .map((m) => {
            const d = Math.round(distMeters(me.xM, me.yM, m.xM, m.yM));
            const tier = getEdgeTierFromSnap(rel, me.uid, m.uid);
            const vouched = m.vouchers.includes(me.uid);
            return `<div class="sc-person-row">
              <div>
                <div style="font-weight:700;font-size:0.78rem;">${escapeHtml(m.name)} <span class="mono" style="color:#7dd3fc;font-size:0.66rem;">(${d}m)</span></div>
                <div class="mono" style="font-size:0.65rem;color:#94a3b8;">${escapeHtml(m.handle)} • ${m.trustScore} Trust</div>
              </div>
              <div style="display:flex;gap:0.28rem;flex-wrap:wrap;">
                ${
                  tier === 0
                    ? `<button type="button" class="sc-btn sc-btn-primary" data-open-hnd="${m.uid}" style="padding:0.25rem 0.45rem;font-size:0.66rem;">🤝 Handshake</button>`
                    : `<span class="sc-badge sc-badge-blue mono">${TIER_LABELS[tier]}</span>`
                }
                ${
                  !vouched && me.trustScore >= 60
                    ? `<button type="button" class="sc-btn sc-btn-emerald" data-vouch-uid="${m.uid}" style="padding:0.25rem 0.45rem;font-size:0.66rem;">🛡️ Vouch</button>`
                    : ''
                }
              </div>
            </div>`;
          })
          .join('');

  const myConns = me
    ? chr.members
        .map((m) => ({ m, tier: m.uid === me.uid ? 0 : getEdgeTierFromSnap(rel, me.uid, m.uid) }))
        .filter((x) => x.tier > 0)
    : [];
  el.friendsCountBadge.textContent = `${myConns.filter((x) => x.m.isActive).length} Active / ${myConns.length} Total`;
  el.friendsList.innerHTML =
    myConns.length === 0
      ? `<div style="font-size:0.73rem;color:#64748b;">No RF connections yet.</div>`
      : myConns
          .map(
            ({ m, tier }) => `<div class="sc-person-row" style="${!m.isActive ? 'opacity:0.65;border-style:dashed;' : ''}">
              <div>
                <div style="font-weight:700;font-size:0.78rem;">${m.isActive ? '🟢' : '⚫'} ${escapeHtml(m.name)}</div>
                <div class="mono" style="font-size:0.65rem;color:#94a3b8;">${escapeHtml(m.handle)} • ${m.isActive ? TIER_LABELS[tier] : 'DORMANT'}</div>
              </div>
              <button type="button" class="sc-btn" data-jump-dm="${m.uid}" style="padding:0.24rem 0.48rem;font-size:0.66rem;">💬 DM</button>
            </div>`
          )
          .join('');

  el.auditLogList.innerHTML = app.auditLogs
    .map((l) => `<div style="padding:0.2rem 0;border-bottom:1px solid rgba(37,60,102,0.42);">${l}</div>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Events & Guided Demos
// ---------------------------------------------------------------------------

el.rfRadarCanvas.addEventListener('pointerdown', (e) => {
  const rect = el.rfRadarCanvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * el.rfRadarCanvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * el.rfRadarCanvas.height;
  const { charter } = getActiveSuiteView();
  let bestIdx = -1;
  let bestD = 22;
  for (const p of app.personas) {
    const m = charter.members.find(
      (x) => x.identityAddr.toLowerCase() === p.identityAddr.toLowerCase()
    );
    const pt = worldToCanvas(
      m ? m.xM : p.xM,
      m ? m.yM : p.yM,
      el.rfRadarCanvas.width,
      el.rfRadarCanvas.height
    );
    const d = Math.hypot(px - pt.cx, py - pt.cy);
    if (d < bestD) {
      bestD = d;
      bestIdx = p.idx;
    }
  }
  if (bestIdx >= 0) {
    app.draggingPersonaIdx = bestIdx;
    el.rfRadarCanvas.setPointerCapture?.(e.pointerId);
  }
});

el.rfRadarCanvas.addEventListener('pointermove', (e) => {
  if (app.draggingPersonaIdx < 0) return;
  const rect = el.rfRadarCanvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * el.rfRadarCanvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * el.rfRadarCanvas.height;
  const { xM, yM } = canvasToWorld(px, py, el.rfRadarCanvas.width, el.rfRadarCanvas.height);
  actionMoveOrPing(app.draggingPersonaIdx, xM, yM, false);
});

window.addEventListener('pointerup', () => {
  app.draggingPersonaIdx = -1;
});

document.addEventListener('click', (e) => {
  const mt = e.target.closest('[data-main-tab]');
  if (mt) {
    app.mainTab = mt.getAttribute('data-main-tab');
    if (app.mode === 'rpc') refreshRpcSuite();
    else renderAll();
    return;
  }
  const selDm = e.target.closest('[data-select-dm]');
  if (selDm) {
    app.selectedDmPeerUid = Number(selDm.getAttribute('data-select-dm'));
    if (app.mode === 'rpc') refreshRpcSuite();
    else renderAll();
    return;
  }
  const jumpDm = e.target.closest('[data-jump-dm]');
  if (jumpDm) {
    app.selectedDmPeerUid = Number(jumpDm.getAttribute('data-jump-dm'));
    app.mainTab = 'messages';
    if (app.mode === 'rpc') refreshRpcSuite();
    else renderAll();
    return;
  }
  const oh = e.target.closest('[data-open-hnd]');
  if (oh) return actionOpenHandshake(Number(oh.getAttribute('data-open-hnd')), 2);
  const ah = e.target.closest('[data-accept-hnd]');
  if (ah) {
    const [i, t] = ah.getAttribute('data-accept-hnd').split(':').map(Number);
    return actionAcceptHandshake(i, t);
  }
  const vb = e.target.closest('[data-vouch-uid]');
  if (vb) return actionVouch(Number(vb.getAttribute('data-vouch-uid')));
  const fb = e.target.closest('[data-flag-uid]');
  if (fb) return actionFlag(Number(fb.getAttribute('data-flag-uid')), 1);
  const lb = e.target.closest('[data-like-post]');
  if (lb) return actionReactPost(Number(lb.getAttribute('data-like-post')), 1);
  const eb = e.target.closest('[data-endorse-post]');
  if (eb) return actionReactPost(Number(eb.getAttribute('data-endorse-post')), 2);
  const cb = e.target.closest('[data-send-cmt]');
  if (cb) {
    const pid = Number(cb.getAttribute('data-send-cmt'));
    const inp = document.getElementById(`cmtInput_${pid}`);
    if (inp) actionCommentPost(pid, inp.value);
    return;
  }
  const wv = e.target.closest('[data-walk-venue]');
  if (wv) {
    const [vx, vy] = wv.getAttribute('data-walk-venue').split(':').map(Number);
    actionMoveOrPing(app.activePersonaIdx, vx - 20, vy + 15, false);
    showToast(`🚶 Walked within <=150m 2.4 GHz range!`, 'info');
    return;
  }
  const chk = e.target.closest('[data-checkin-ev]');
  if (chk) return actionCheckInEvent(Number(chk.getAttribute('data-checkin-ev')));
  const buy = e.target.closest('[data-buy-sku]');
  if (buy) {
    const [sUid, plAddr, skuHex] = buy.getAttribute('data-buy-sku').split('|');
    return actionBuyFromProductLedger(Number(sUid), plAddr, skuHex);
  }
});

el.btnToggleArch.addEventListener('click', () => {
  app.archOpen = !app.archOpen;
  el.archDrawer.classList.toggle('open', app.archOpen);
});

el.personaSelect.addEventListener('change', () => {
  app.activePersonaIdx = Number(el.personaSelect.value) || 0;
  if (app.mode === 'rpc') refreshRpcSuite();
  else renderAll();
});

el.engineModeSelect.addEventListener('change', () => {
  app.mode = el.engineModeSelect.value;
  el.rpcDrawer.classList.toggle('open', app.mode === 'rpc');
  if (app.mode === 'rpc' && app.suiteAddrs.charter) refreshRpcSuite();
  else renderAll();
});

el.btnAdvanceBlock.addEventListener('click', () => {
  if (app.mode === 'rpc') return refreshRpcSuite();
  app.sim.currentBlock += 4;
  for (const p of app.personas) {
    const m = app.sim.members.find(
      (x) => x.identityAddr.toLowerCase() === p.identityAddr.toLowerCase()
    );
    if (m && !m.sanctioned && !p.radioMuted) {
      if (distMeters(m.xM, m.yM, CENTER_X, CENTER_Y) <= app.sim.subnetRadiusM) {
        m.lastHeartbeatBlock = app.sim.currentBlock;
      }
    }
  }
  renderAll();
});

el.btnResetDemo.addEventListener('click', () => {
  app.activePersonaIdx = 0;
  initSimSuite();
  showToast(`↻ Reset Identity + ProductLedger + SocialCharter Suite.`, 'info');
  renderAll();
});

el.btnDismissToast.addEventListener('click', () => el.toastBanner.classList.remove('show'));

el.btnScenarioWalkPriya.addEventListener('click', async () => {
  app.activePersonaIdx = 0;
  await actionMoveOrPing(0, 1535, 1525, false);
  await actionVouch(3);
  await actionOpenHandshake(3, 2);
  await actionAcceptHandshake(0, 3);
  app.selectedDmPeerUid = 3;
  app.mainTab = 'messages';
  await actionSendDm(3, 'Welcome Dr. Priya! Connected our Identity HFSs over 2.4 GHz 👋');
});

el.btnScenarioEventCheckin.addEventListener('click', async () => {
  app.activePersonaIdx = 0;
  app.mainTab = 'events';
  await actionMoveOrPing(0, 1605, 1430, false);
  await actionCheckInEvent(0);
});

el.btnScenarioToggleMarcus.addEventListener('click', async () => {
  const { charter } = getActiveSuiteView();
  const marcus = charter.members[4];
  if (!marcus) return;
  if (marcus.isActive) await actionMoveOrPing(4, 2880, 1510, true);
  else {
    app.personas[4].radioMuted = false;
    await actionMoveOrPing(4, 1590, 1510, true);
  }
});

el.btnScenarioSlashBot.addEventListener('click', async () => {
  if (app.mode !== 'sim') return;
  const bot = app.sim.members[5];
  if (bot.sanctioned) return showToast(`ℹ️ @cryptoking99 is already Sanctioned!`, 'info');
  app.activePersonaIdx = 1;
  await actionMoveOrPing(1, 1550, 1445, false);
  if (!bot.vouchers.includes(1)) await actionVouch(5);
  app.activePersonaIdx = 0;
  await actionFlag(5, 3);
  app.activePersonaIdx = 2;
  await actionFlag(5, 3);
  app.activePersonaIdx = 0;
  renderAll();
});

el.btnScenarioTestOutsider.addEventListener('click', async () => {
  app.activePersonaIdx = 6;
  renderAll();
  await actionCreatePost(0, 'Remote bot spam from 4,200m away!');
});

el.rpcUrlInput.value = app.rpcUrl;
el.rpcUrlInput.addEventListener('change', () => {
  app.rpcUrl = el.rpcUrlInput.value.trim();
  SlxHfsCache.save({ rpcUrl: app.rpcUrl });
});
el.charterAddrInput.addEventListener('change', () => {
  app.suiteAddrs.charter = el.charterAddrInput.value.trim();
  SlxHfsCache.save({ socialCharterAddr: app.suiteAddrs.charter });
  preloadSocialFromCachedNode();
});
el.btnDeploySuite.addEventListener('click', deployFullIdentityAndSocialSuite);
el.btnSeedSuite.addEventListener('click', seedOnChainNeighborhood);

// In-Browser 8-HFS WebAssembly VM Boot & Signed Call Dispatcher
function recordSignedSocialViaIdentity() {}

// Preload Latest On-Chain State from Cached SocialCharter HFS via WebSocket Node
async function preloadSocialFromCachedNode() {
  try {
    const { cache } = await SlxHfsCache.hydrateWithManifest();
    if (cache.rpcUrl) {
      app.rpcUrl = cache.rpcUrl;
      if (el.rpcUrlInput) el.rpcUrlInput.value = app.rpcUrl;
    }
    if (cache.citizenOnboardingPool?.length) {
      app.onboardingPool = {
        addrs: cache.citizenOnboardingPool,
        privs: cache.poolSlotPrivs || [],
      };
    }
    if (cache.personaIdentities?.length) {
      for (let i = 1; i < Math.min(app.personas.length, cache.personaIdentities.length); i++) {
        app.personas[i].identityAddr = cache.personaIdentities[i];
        if (cache.personaPrivs?.[i]) {
          app.personas[i].priv = cache.personaPrivs[i];
          app.personas[i].eoa = computeAddress(cache.personaPrivs[i]);
        }
      }
    }
    const urlCharter = getUrlHfsParam();
    const preferredCharter =
      urlCharter ||
      cache.fleetSocial?.charter ||
      cache.socialCharterAddr ||
      SUBNET1_FLEET_SOCIAL_DEFAULT.charter;
    if (
      preferredCharter &&
      (!app.suiteAddrs.charter ||
        app.suiteAddrs.charter.toLowerCase() === '0x24707a2b8115992bc864c014b2f5e71e831ab8d5')
    ) {
      app.suiteAddrs.charter = preferredCharter;
      if (el.charterAddrInput) el.charterAddrInput.value = app.suiteAddrs.charter;
    }
    if (!app.suiteAddrs.charter) return false;

    const chrHex = await rpcCall('eth_call', [
      { to: app.suiteAddrs.charter, data: CharterAbi.getCharterSnapshot() },
      'latest',
    ]);
    const chr = decodeCharterSnapshotHex(chrHex);
    if (!chr || !chr.members || chr.members.length === 0) return false;

    app.mode = 'rpc';
    if (el.engineModeSelect) el.engineModeSelect.value = 'rpc';
    app.activePersonaIdx = 0;
    if (el.personaSelect) el.personaSelect.value = '0';

    // Query `Identity.owner()` on every registered member to see if the connected wallet already owns an Identity HFS!
    const walletEoa = slxWallet.keypair.address.toLowerCase();
    const owners = await Promise.all(chr.members.map((m) => queryIdentityOwner(m.identityAddr)));
    const matchIdx = owners.findIndex((o) => o === walletEoa);

    if (matchIdx >= 0) {
      const m = chr.members[matchIdx];
      app.personas[0].priv = slxWallet.keypair.privateKey;
      app.personas[0].eoa = slxWallet.keypair.address;
      app.personas[0].identityAddr = m.identityAddr;
      app.personas[0].productLedgerAddr = m.productLedgerAddr || '';
      app.personas[0].handle = m.handle;
      app.personas[0].shortName = m.name;
      app.personas[0].name = `${m.name} (You)`;
      app.personas[0].role = m.role;
      app.personas[0].device = m.device;
      app.personas[0].xM = m.xM;
      app.personas[0].yM = m.yM;
      if (el.rpcStatusText) {
        el.rpcStatusText.textContent = `Preloaded live Identity ${m.handle} (${m.identityAddr.slice(0, 8)}..) from Subnet 1!`;
      }
    } else {
      const tag = slxWallet.keypair.address.slice(2, 6).toUpperCase();
      // Spectator-first boot: passively check for an existing Identity without forcing a modal on page load.
      const idRec =
        (await slxWallet.resolveVerifiedIdentity?.(app.rpcUrl).catch(() => null)) ||
        slxWallet.getIdentityRecord();
      const chosenNick = idRec?.nickname || `Spectator ${tag}`;
      app.personas[0].priv = slxWallet.keypair.privateKey;
      app.personas[0].eoa = slxWallet.keypair.address;
      app.personas[0].identityAddr = idRec?.identityAddr || '';
      app.personas[0].productLedgerAddr = '';
      app.personas[0].handle = `@${idRec?.handle || `wallet_${tag.toLowerCase()}`}`;
      app.personas[0].shortName = chosenNick;
      app.personas[0].name = idRec?.nickname ? `${chosenNick} (You)` : `${chosenNick} (Spectating)`;
      app.personas[0].role = idRec?.nickname ? 'New Local Radio Wallet' : 'Spectator Mode';
      app.personas[0].device = 'Web Radio Client';
      app.personas[0].xM = 1525;
      app.personas[0].yM = 1490;
      if (el.rpcStatusText) {
        el.rpcStatusText.textContent = idRec?.nickname
          ? `Preloaded live SocialCharter @ ${app.suiteAddrs.charter.slice(0, 10)}.. — post or handshake to onboard ${app.personas[0].handle}!`
          : `👁️ Spectating live SocialCharter @ ${app.suiteAddrs.charter.slice(0, 10)}.. — post, react or handshake anytime to create your Identity!`;
      }
    }

    await refreshRpcSuite();
    return true;
  } catch (_) {
    return false;
  }
}

// Boot (Strictly Live Subnet 1 RPC — keep developer RPC drawer collapsed on mobile so content sits above the fold)
if (el.engineModeSelect) el.engineModeSelect.value = 'rpc';
if (el.rpcDrawer && typeof window !== 'undefined' && window.innerWidth > 960) {
  el.rpcDrawer.classList.add('open');
}
renderAll();
let socialWatcher = null;
const extraSocialEl = document.getElementById('socialExtraControls');
if (extraSocialEl) extraSocialEl.style.display = 'inline-flex';
const unifiedSocialHdr = mountSlxUnifiedHeader({
  mountContainer: document.getElementById('slxUnifiedHeaderMount'),
  wallet: slxWallet,
  activeAppId: 'social',
  title: 'CommonsRF: Radio-Bounded Social & Storefronts',
  subtitle:
    'Identity + SocialCharter + Messaging + Relationships + Feed/DMs + Events + ProductLedgers',
  rpcUrlFn: () => app.rpcUrl,
  getContractLabel: () => 'SocialCharter',
  getContractAddr: () => app.suiteAddrs.charter,
  onToggleNodeDrawer: () => el.rpcDrawer?.classList.toggle('open'),
  onWalletSwitch: async (kp) => {
    app.personas[0].priv = kp.privateKey;
    app.personas[0].eoa = kp.address;
    await preloadSocialFromCachedNode();
    renderAll();
  },
  extraElements: extraSocialEl ? [extraSocialEl] : [],
});
const socialChainBar = unifiedSocialHdr?.chainBar || null;

mountHfsRegistryDropdown({
  mountContainer: unifiedSocialHdr?.contextSlot,
  wallet: slxWallet,
  typeName: 'SOCIAL_CHARTER',
  rpcUrlFn: () => app.rpcUrl,
  getCurrentPrimaryAddr: () => app.suiteAddrs.charter,
  onSelectInstance: async (entry) => {
    app.suiteAddrs.charter = entry.primaryAddr;
    if (el.charterAddrInput) el.charterAddrInput.value = app.suiteAddrs.charter;
    const m = entry.meta || {};
    if (m.identityRegistry) app.suiteAddrs.identityRegistry = m.identityRegistry;
    if (m.messaging) app.suiteAddrs.messaging = m.messaging;
    if (m.relationships) app.suiteAddrs.relationships = m.relationships;
    if (m.feed) app.suiteAddrs.feed = m.feed;
    if (m.events) app.suiteAddrs.events = m.events;
    await preloadSocialFromCachedNode();
    socialChainBar?.refresh?.();
    socialWatcher?.refreshFilter?.();
  },
});
preloadSocialFromCachedNode().then((ok) => {
  socialChainBar?.refresh?.();
  socialWatcher?.refreshFilter?.();
  if (!ok) {
    setTimeout(() => {
      preloadSocialFromCachedNode().then(() => socialWatcher?.refreshFilter?.());
    }, 3000);
  }
});
socialWatcher = slxWatchChainApp({
  rpcUrl: () => app.rpcUrl,
  filter: () => ({
    address: [
      app.suiteAddrs.charter,
      app.suiteAddrs.messaging,
      app.suiteAddrs.relationships,
      app.suiteAddrs.feed,
      app.suiteAddrs.events,
    ].filter(Boolean),
  }),
  onLog: (lg) => {
    if (!lg.isBackfill && app.suiteAddrs.charter && !app.rpcBusy) {
      socialWatcher?.triggerRefresh?.({ source: 'log', blockNumber: lg.blockNumberNum });
    }
  },
  onRefresh: async () => {
    if (app.suiteAddrs.charter && !app.rpcBusy) {
      await refreshRpcSuite();
    }
  },
});
