/**
 * CIPHERVOTE (`web/src/ballot.js`)
 *
 * End-to-End Showcase for SuperLexicon's Wasmtime Threshold Additive Homomorphic Encryption:
 * - Pure-JS `Edwards25519` Exponential ElGamal client-side encryptor,
 * - Cramer-Damgård-Schoenmakers 1-of-2 Disjunctive Schnorr `0/1` ZK Prover (`3 × 128 B`),
 * - Chaum-Pedersen One-Hot `b_yes + b_no + b_abstain == 1` DLEQ Prover (`64 B`),
 * - Supports both Civic `1-Identity = 1-Vote` Referendums and `SLX-EQ` Share-Weighted Polls,
 * - **1-Click Browser Audit Verifier** that independently re-sums every voter's encrypted
 *   ciphertext on `Edwards25519`, verifies every validator's Chaum-Pedersen DLEQ decryption share,
 *   Lagrange-interpolates `D_s = ∑ λ_i D_{i,s}`, and verifies `C_{2,s} - D_s == Tally_s · B`!
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  encodeAbi,
  decodeUintWord,
  readU16BE,
  readU32BE,
  readU64BE,
  shortAddr,
  signOrderedLexiconTx,
  ZERO_ADDR,
  SlxWalletManager,
  SlxHfsCache,
  slxNodeRpc,
  slxWaitForReceipt,
  getDefaultNodeWsUrl,
  readOnChainIdentityNickname,
  slxWatchChainApp,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from './slx-hfs-registry.js';

// ============================================================================
// 1. Pure-JS Edwards25519 ElGamal + CDS 0/1 ZK + Threshold DLEQ Engine
// ============================================================================

const ED_P = (1n << 255n) - 19n;
const ED_L = (1n << 252n) + 27742317777372353535851937790883648493n;

function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function modPow(base, exp, m) {
  let res = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return res;
}

function modInv(a, m) {
  return modPow(a, m - 2n, m);
}

const ED_D = mod(-121665n * modInv(121666n, ED_P), ED_P);
const ED_SQRT_M1 = modPow(2n, (ED_P - 1n) / 4n, ED_P);
const ED_IDENTITY = { X: 0n, Y: 1n, Z: 1n, T: 0n };

function recoverX(y, sign) {
  if (y >= ED_P) return null;
  const y2 = (y * y) % ED_P;
  const u = mod(y2 - 1n, ED_P);
  const v = mod(ED_D * y2 + 1n, ED_P);
  const x2 = (u * modInv(v, ED_P)) % ED_P;
  if (x2 === 0n) return sign ? null : 0n;
  let x = modPow(x2, (ED_P + 3n) / 8n, ED_P);
  if (mod(x * x - x2, ED_P) !== 0n) x = (x * ED_SQRT_M1) % ED_P;
  if (mod(x * x - x2, ED_P) !== 0n) return null;
  if ((x & 1n) !== BigInt(sign)) x = ED_P - x;
  return x;
}

const ED_BY = (4n * modInv(5n, ED_P)) % ED_P;
const ED_BX = recoverX(ED_BY, 0);
const ED_BASE = { X: ED_BX, Y: ED_BY, Z: 1n, T: (ED_BX * ED_BY) % ED_P };

function edAdd(P, Q) {
  const A = mod((P.Y - P.X) * (Q.Y - Q.X), ED_P);
  const B = mod((P.Y + P.X) * (Q.Y + Q.X), ED_P);
  const C = mod(2n * P.T * Q.T * ED_D, ED_P);
  const D = mod(2n * P.Z * Q.Z, ED_P);
  const E = mod(B - A, ED_P);
  const F = mod(D - C, ED_P);
  const G = mod(D + C, ED_P);
  const H = mod(B + A, ED_P);
  return {
    X: (E * F) % ED_P,
    Y: (G * H) % ED_P,
    Z: (F * G) % ED_P,
    T: (E * H) % ED_P,
  };
}

function edNeg(P) {
  return { X: mod(-P.X, ED_P), Y: P.Y, Z: P.Z, T: mod(-P.T, ED_P) };
}

function edMul(scalar, P) {
  let R = ED_IDENTITY;
  let Q = P;
  let k = BigInt(scalar);
  while (k > 0n) {
    if (k & 1n) R = edAdd(R, Q);
    Q = edAdd(Q, Q);
    k >>= 1n;
  }
  return R;
}

function edEncode(P) {
  const zi = modInv(P.Z, ED_P);
  const x = (P.X * zi) % ED_P;
  const y = (P.Y * zi) % ED_P;
  const out = new Uint8Array(32);
  let tmp = y;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  out[31] |= Number(x & 1n) << 7;
  return out;
}

function edDecode(bytes32) {
  if (!bytes32 || bytes32.length !== 32) return null;
  let y = 0n;
  for (let i = 0; i < 32; i++) {
    const b = i === 31 ? bytes32[31] & 0x7f : bytes32[i];
    y |= BigInt(b) << BigInt(8 * i);
  }
  const sign = (bytes32[31] >> 7) & 1;
  const x = recoverX(y, sign);
  if (x === null) return null;
  const P = { X: x, Y: y, Z: 1n, T: (x * y) % ED_P };
  const re = edEncode(P);
  for (let i = 0; i < 32; i++) {
    if (re[i] !== bytes32[i]) return null;
  }
  return P;
}

function edIsIdentity(P) {
  return mod(P.X, ED_P) === 0n && mod(P.Y - P.Z, ED_P) === 0n;
}

function leBytesToBigInt(bytes) {
  let acc = 0n;
  for (let i = 0; i < bytes.length; i++) {
    acc |= BigInt(bytes[i]) << BigInt(8 * i);
  }
  return acc;
}

function scalarToLeBytes32(s) {
  const out = new Uint8Array(32);
  let v = mod(s, ED_L);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function u64BeBytes(n) {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

function u32BeBytes(n) {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function randomNonZeroScalar() {
  const wide = crypto.getRandomValues(new Uint8Array(64));
  let s = leBytesToBigInt(wide) % ED_L;
  if (s === 0n) s = 1n;
  return s;
}

async function sha512Bytes(data) {
  const buf = await crypto.subtle.digest('SHA-512', data);
  return new Uint8Array(buf);
}

function buildBallotOr01Ctx(ballotHex, pollId, voterHex, slot) {
  return concatBytes(
    utf8ToBytes('SLX_BALLOT_OR01_V1:'),
    hexToBytes(ballotHex).slice(-20),
    u64BeBytes(pollId),
    hexToBytes(voterHex).slice(-20),
    new Uint8Array([slot])
  );
}

function buildBallotSum1Ctx(ballotHex, pollId, voterHex) {
  return concatBytes(
    utf8ToBytes('SLX_BALLOT_SUM1_V1:'),
    hexToBytes(ballotHex).slice(-20),
    u64BeBytes(pollId),
    hexToBytes(voterHex).slice(-20)
  );
}

async function proveHeZeroOrOneJs(epochPkBytes, bit, rScalar, auxCtx) {
  const Y = edDecode(epochPkBytes);
  if (!Y || edIsIdentity(Y)) throw new Error('Invalid Epoch ElGamal public key');
  const C1 = edMul(rScalar, ED_BASE);
  const C2 = bit === 1 ? edAdd(ED_BASE, edMul(rScalar, Y)) : edMul(rScalar, Y);

  const k = randomNonZeroScalar();
  const simC = randomNonZeroScalar();
  const simZ = randomNonZeroScalar();

  let A0, B0, A1, B1;
  if (bit === 0) {
    A0 = edMul(k, ED_BASE);
    B0 = edMul(k, Y);
    const M1 = edAdd(C2, edNeg(ED_BASE));
    A1 = edAdd(edMul(simZ, ED_BASE), edNeg(edMul(simC, C1)));
    B1 = edAdd(edMul(simZ, Y), edNeg(edMul(simC, M1)));
  } else {
    A0 = edAdd(edMul(simZ, ED_BASE), edNeg(edMul(simC, C1)));
    B0 = edAdd(edMul(simZ, Y), edNeg(edMul(simC, C2)));
    A1 = edMul(k, ED_BASE);
    B1 = edMul(k, Y);
  }

  const chalDigest = await sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_HE_OR01_V1'),
      edEncode(Y),
      edEncode(C1),
      edEncode(C2),
      edEncode(A0),
      edEncode(B0),
      edEncode(A1),
      edEncode(B1),
      u64BeBytes(auxCtx.length),
      auxCtx
    )
  );
  const c = leBytesToBigInt(chalDigest) % ED_L;

  let c0, z0, c1, z1;
  if (bit === 0) {
    c0 = mod(c - simC, ED_L);
    z0 = mod(k + c0 * rScalar, ED_L);
    c1 = simC;
    z1 = simZ;
  } else {
    c1 = mod(c - simC, ED_L);
    z1 = mod(k + c1 * rScalar, ED_L);
    c0 = simC;
    z0 = simZ;
  }

  return {
    ct64: concatBytes(edEncode(C1), edEncode(C2)),
    proof128: concatBytes(
      scalarToLeBytes32(c0),
      scalarToLeBytes32(z0),
      scalarToLeBytes32(c1),
      scalarToLeBytes32(z1)
    ),
  };
}

async function proveHeSumEqualsOneJs(epochPkBytes, rSum, sumCtx) {
  const Y = edDecode(epochPkBytes);
  const Csum1 = edMul(rSum, ED_BASE);
  const Csum2MinusB = edMul(rSum, Y);
  const k = randomNonZeroScalar();
  const R1 = edMul(k, ED_BASE);
  const R2 = edMul(k, Y);
  const digest = await sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_VM_DLEQ_CHAL_V1'),
      edEncode(ED_BASE),
      edEncode(Csum1),
      edEncode(Y),
      edEncode(Csum2MinusB),
      edEncode(R1),
      edEncode(R2),
      u64BeBytes(sumCtx.length),
      sumCtx
    )
  );
  const c = leBytesToBigInt(digest) % ED_L;
  const z = mod(k + c * rSum, ED_L);
  return concatBytes(scalarToLeBytes32(c), scalarToLeBytes32(z));
}

async function buildEncryptedBallotJs(epochPkBytes, ballotHex, pollId, voterHex, choiceSlot) {
  const cts = [];
  const ors = [];
  let rSum = 0n;
  for (let s = 0; s < 3; s++) {
    const bit = s === choiceSlot ? 1 : 0;
    let r = randomNonZeroScalar();
    if (s === 2 && mod(rSum + r, ED_L) === 0n) {
      r = mod(r + 1n, ED_L) || 1n;
    }
    rSum = mod(rSum + r, ED_L);
    const orCtx = buildBallotOr01Ctx(ballotHex, pollId, voterHex, s);
    const { ct64, proof128 } = await proveHeZeroOrOneJs(epochPkBytes, bit, r, orCtx);
    cts.push(ct64);
    ors.push(proof128);
  }
  const sumCtx = buildBallotSum1Ctx(ballotHex, pollId, voterHex);
  const sumProof64 = await proveHeSumEqualsOneJs(epochPkBytes, rSum, sumCtx);
  return {
    ciphertexts192: concatBytes(...cts),
    orProofs384: concatBytes(...ors),
    sumOneProof64: sumProof64,
  };
}

async function verifyDleqJs(G1, Y1, G2, Y2, auxCtx, proof64) {
  const c = leBytesToBigInt(proof64.slice(0, 32));
  const z = leBytesToBigInt(proof64.slice(32, 64));
  if (c >= ED_L || z >= ED_L) return false;
  const R1 = edAdd(edMul(z, G1), edNeg(edMul(c, Y1)));
  const R2 = edAdd(edMul(z, G2), edNeg(edMul(c, Y2)));
  const digest = await sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_VM_DLEQ_CHAL_V1'),
      edEncode(G1),
      edEncode(Y1),
      edEncode(G2),
      edEncode(Y2),
      edEncode(R1),
      edEncode(R2),
      u64BeBytes(auxCtx.length),
      auxCtx
    )
  );
  const expectedC = leBytesToBigInt(digest) % ED_L;
  return c === expectedC;
}

function lagrangeCombinePointsJs(shares) {
  let combined = ED_IDENTITY;
  for (let i = 0; i < shares.length; i++) {
    const xi = BigInt(shares[i].valIdx + 1);
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      const xj = BigInt(shares[j].valIdx + 1);
      num = mod(num * xj, ED_L);
      den = mod(den * (xj - xi), ED_L);
    }
    const lambda = mod(num * modInv(den, ED_L), ED_L);
    combined = edAdd(combined, edMul(lambda, shares[i].pt));
  }
  return combined;
}

// ============================================================================
// 2. CipherVote Application State & Binary Decoders
// ============================================================================

const wallet = new SlxWalletManager();
const rpcUrl = getDefaultNodeWsUrl();
const nickCache = new Map();

let ballotHubAddr = '';
let hubState = null;
let selectedPollId = 0;
let activePollDetail = null;
let myVoteReceipt = null;
let myShareBalance = 0;
let beaconState = null;
let selectedChoice = 0;
let busyTx = false;
let stopWatcher = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setStatus(msg, isErr = false) {
  const el = document.getElementById('txStatusMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? '#fb7185' : '#7dd3fc';
}

async function getNicknameCached(addr) {
  const k = String(addr || '').toLowerCase();
  if (!k || k === ZERO_ADDR) return shortAddr(k);
  if (nickCache.has(k)) return nickCache.get(k);
  const n = await readOnChainIdentityNickname(rpcUrl, k);
  const label = n ? `${n} (${shortAddr(k)})` : shortAddr(k);
  nickCache.set(k, label);
  return label;
}

function decodeHubState(bytes) {
  if (!bytes || bytes.length < 110) return null;
  const pollCount = readU64BE(bytes, 0);
  const settledCount = readU64BE(bytes, 8);
  const totalBallots = readU64BE(bytes, 16);
  const minValidators = readU64BE(bytes, 24);
  const nowBlock = readU64BE(bytes, 32);
  const idRegistry = bytesToHex(bytes.slice(40, 60));
  const defaultShareLedger = bytesToHex(bytes.slice(60, 80));
  const vrfBeacon = bytesToHex(bytes.slice(80, 100));
  const orgLen = readU16BE(bytes, 100);
  const returnedCount = readU32BE(bytes, 102);
  let cursor = 110;
  const orgTitle = bytesToUtf8(bytes.slice(cursor, cursor + orgLen));
  cursor += orgLen;

  const polls = [];
  for (let i = 0; i < returnedCount && cursor + 160 <= bytes.length; i++) {
    const tlen = readU16BE(bytes, cursor + 158);
    if (cursor + 160 + tlen > bytes.length) break;
    polls.push({
      pollId: readU64BE(bytes, cursor),
      status: bytes[cursor + 8],
      weightMode: bytes[cursor + 9],
      epochId: readU64BE(bytes, cursor + 10),
      openBlock: readU64BE(bytes, cursor + 18),
      closeBlock: readU64BE(bytes, cursor + 26),
      settledBlock: readU64BE(bytes, cursor + 34),
      creator: bytesToHex(bytes.slice(cursor + 42, cursor + 62)),
      shareLedger: bytesToHex(bytes.slice(cursor + 62, cursor + 82)),
      ballotCount: readU32BE(bytes, cursor + 82),
      totalWeight: readU64BE(bytes, cursor + 86),
      yesTally: readU64BE(bytes, cursor + 94),
      noTally: readU64BE(bytes, cursor + 102),
      abstainTally: readU64BE(bytes, cursor + 110),
      signerBitmap: readU64BE(bytes, cursor + 118),
      decReqId: bytesToHex(bytes.slice(cursor + 126, cursor + 158)),
      title: bytesToUtf8(bytes.slice(cursor + 160, cursor + 160 + tlen)),
    });
    cursor += 160 + tlen;
  }

  return {
    pollCount,
    settledCount,
    totalBallots,
    minValidators,
    nowBlock,
    idRegistry,
    defaultShareLedger,
    vrfBeacon,
    orgTitle,
    polls,
  };
}

function decodePollDetail(bytes) {
  if (!bytes || bytes.length < 418) return null;
  const pollId = readU64BE(bytes, 0);
  const status = bytes[8];
  const weightMode = bytes[9];
  const epochId = readU64BE(bytes, 10);
  const openBlock = readU64BE(bytes, 18);
  const closeBlock = readU64BE(bytes, 26);
  const settledBlock = readU64BE(bytes, 34);
  const creator = bytesToHex(bytes.slice(42, 62));
  const shareLedger = bytesToHex(bytes.slice(62, 82));
  const epochPkBytes = bytes.slice(82, 114);
  const ballotCount = readU32BE(bytes, 114);
  const totalWeight = readU64BE(bytes, 118);
  const yesTally = readU64BE(bytes, 126);
  const noTally = readU64BE(bytes, 134);
  const abstainTally = readU64BE(bytes, 142);
  const signerBitmap = readU64BE(bytes, 150);
  const decReqId = bytesToHex(bytes.slice(158, 190));
  const accYes = bytes.slice(190, 254);
  const accNo = bytes.slice(254, 318);
  const accAbstain = bytes.slice(318, 382);
  const ballotsCommit = bytesToHex(bytes.slice(382, 414));

  const titleLen = readU16BE(bytes, 414);
  const descLen = readU16BE(bytes, 416);
  let cursor = 418;
  const title = bytesToUtf8(bytes.slice(cursor, cursor + titleLen));
  cursor += titleLen;
  const desc = bytesToUtf8(bytes.slice(cursor, cursor + descLen));
  cursor += descLen;

  const ballots = [];
  for (let i = 0; i < ballotCount && cursor + 228 <= bytes.length; i++) {
    ballots.push({
      idx: i,
      voter: bytesToHex(bytes.slice(cursor, cursor + 20)),
      blockNumber: readU64BE(bytes, cursor + 20),
      weight: readU64BE(bytes, cursor + 28),
      ctYes: bytes.slice(cursor + 36, cursor + 100),
      ctNo: bytes.slice(cursor + 100, cursor + 164),
      ctAbstain: bytes.slice(cursor + 164, cursor + 228),
    });
    cursor += 228;
  }

  return {
    pollId,
    status,
    weightMode,
    epochId,
    openBlock,
    closeBlock,
    settledBlock,
    creator,
    shareLedger,
    epochPkBytes,
    epochPkHex: bytesToHex(epochPkBytes),
    ballotCount,
    totalWeight,
    yesTally,
    noTally,
    abstainTally,
    signerBitmap,
    decReqId,
    accYes,
    accNo,
    accAbstain,
    ballotsCommit,
    title,
    desc,
    ballots,
  };
}

function decodeBeaconState(bytes) {
  if (!bytes || bytes.length < 193) return null;
  const curEpoch = readU64BE(bytes, 0);
  const actEpoch = readU64BE(bytes, 8);
  const liveCount = readU32BE(bytes, 32);
  const liveThresh = readU32BE(bytes, 36);
  const epStatus = bytes[72];
  const epValCount = readU32BE(bytes, 73);
  const epThresh = readU32BE(bytes, 77);
  const epPk = bytesToHex(bytes.slice(129, 161));
  const validators = [];
  for (let i = 0; i < liveCount && 193 + (i + 1) * 52 <= bytes.length; i++) {
    const b = 193 + i * 52;
    validators.push({
      idx: i,
      address: bytesToHex(bytes.slice(b, b + 20)),
      pubkey: bytesToHex(bytes.slice(b + 20, b + 52)),
    });
  }
  return { curEpoch, actEpoch, liveCount, liveThresh, epStatus, epValCount, epThresh, epPk, validators };
}

// ============================================================================
// 3. Rendering & Live Refresh
// ============================================================================

async function refreshAll() {
  if (!ballotHubAddr) return;
  try {
    const rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: ballotHubAddr, data: encodeAbi('getBallotHubState()', []) },
      'latest',
    ]);
    const st = decodeHubState(hexToBytes(rawHex));
    if (!st) return;
    hubState = st;

    if (!selectedPollId && st.polls.length > 0) {
      const openOne = st.polls.find((p) => p.status === 1);
      selectedPollId = openOne ? openOne.pollId : st.polls[0].pollId;
    } else if (selectedPollId && !st.polls.some((p) => p.pollId === selectedPollId) && st.polls.length > 0) {
      selectedPollId = st.polls[0].pollId;
    }

    if (selectedPollId > 0) {
      const detHex = await slxNodeRpc(rpcUrl, 'eth_call', [
        { to: ballotHubAddr, data: encodeAbi('getPollDetail(uint64)', [['uint64', selectedPollId]]) },
        'latest',
      ]);
      activePollDetail = decodePollDetail(hexToBytes(detHex));
    } else {
      activePollDetail = null;
    }

    if (st.vrfBeacon && st.vrfBeacon !== ZERO_ADDR) {
      const bHex = await slxNodeRpc(rpcUrl, 'eth_call', [
        { to: st.vrfBeacon, data: encodeAbi('getBeaconState()', []) },
        'latest',
      ]);
      beaconState = decodeBeaconState(hexToBytes(bHex));
    }

    const myIdRec = await wallet.resolveVerifiedIdentity(rpcUrl).catch(() => wallet.getIdentityRecord());
    myVoteReceipt = null;
    myShareBalance = 0;
    if (myIdRec?.identityAddr && activePollDetail) {
      const hvHex = await slxNodeRpc(rpcUrl, 'eth_call', [
        {
          to: ballotHubAddr,
          data: encodeAbi('hasVoted(uint64,address)', [
            ['uint64', activePollDetail.pollId],
            ['address', myIdRec.identityAddr],
          ]),
        },
        'latest',
      ]);
      const hv = hexToBytes(hvHex);
      if (hv.length >= 21 && hv[0] === 1) {
        myVoteReceipt = {
          ballotIdx: readU32BE(hv, 1),
          blockNumber: readU64BE(hv, 5),
          weight: readU64BE(hv, 13),
        };
      }
      if (activePollDetail.weightMode === 2 && activePollDetail.shareLedger !== ZERO_ADDR) {
        const balHex = await slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: activePollDetail.shareLedger,
            data: encodeAbi('balanceOf(address)', [['address', myIdRec.identityAddr]]),
          },
          'latest',
        ]);
        myShareBalance = decodeUintWord(balHex);
      }
    }

    if (activePollDetail) {
      await Promise.all(activePollDetail.ballots.slice(0, 24).map((b) => getNicknameCached(b.voter)));
    }

    renderUI();
  } catch (err) {
    console.warn('[CipherVote] refresh warning:', err);
  }
}

function renderUI() {
  if (!hubState) return;
  document.getElementById('pollsTotalTag').textContent = `${hubState.pollCount} Polls • ${hubState.totalBallots} ZK Votes`;

  // Render Polls Directory
  const pollsEl = document.getElementById('pollsList');
  if (hubState.polls.length === 0) {
    pollsEl.innerHTML = `<div class="bv-muted mono">No polls created yet — click "+ New Encrypted Poll" above!</div>`;
  } else {
    pollsEl.innerHTML = hubState.polls
      .map((p) => {
        const stLbl =
          p.status === 1
            ? '🟢 OPEN'
            : p.status === 2
            ? '🟡 DECRYPTING'
            : '✅ VERIFIED';
        const modeLbl = p.weightMode === 2 ? '🏛️ Share-Weighted' : '🪪 1-ID = 1-Vote';
        const summary =
          p.status === 3
            ? `YES ${p.yesTally.toLocaleString()} • NO ${p.noTally.toLocaleString()} • ABS ${p.abstainTally.toLocaleString()}`
            : `🔒 ${p.ballotCount} Encrypted Ballots (${p.totalWeight.toLocaleString()} wt)`;
        return `
          <div class="bv-poll-item ${p.pollId === selectedPollId ? 'active' : ''}" data-poll-id="${p.pollId}">
            <div style="display:flex;justify-content:space-between;gap:0.4rem;font-size:0.7rem;" class="mono">
              <strong style="color:#e9d5ff;">POLL #${p.pollId} • ${stLbl}</strong>
              <span style="color:#7dd3fc;">${modeLbl}</span>
            </div>
            <div style="font-size:0.83rem;font-weight:700;color:#f8fafc;">${esc(p.title)}</div>
            <div class="mono" style="font-size:0.7rem;color:#94a3b8;">${summary}</div>
          </div>
        `;
      })
      .join('');
    pollsEl.querySelectorAll('.bv-poll-item').forEach((el) => {
      el.addEventListener('click', () => {
        selectedPollId = parseInt(el.getAttribute('data-poll-id'), 10);
        refreshAll();
      });
    });
  }

  // Render Validator Beacon Panel
  if (beaconState) {
    document.getElementById('quorumBadge').textContent = `${beaconState.liveThresh} of ${beaconState.liveCount} BFT`;
    document.getElementById('beaconMetaSummary').innerHTML =
      `Active DKG Epoch <strong>#${beaconState.actEpoch}</strong> • Threshold <code>t = ${beaconState.epThresh}/${beaconState.epValCount}</code><br/>` +
      `Epoch ElGamal PK: <code>${beaconState.epPk.slice(0, 22)}…${beaconState.epPk.slice(-10)}</code>`;
    document.getElementById('validatorNodesList').innerHTML = beaconState.validators
      .map(
        (v) => `
        <div class="bv-val-row">
          <span>Validator #${v.idx} (<code>${shortAddr(v.address)}</code>)</span>
          <code style="color:#6ee7b7;">${v.pubkey.slice(0, 14)}…</code>
        </div>`
      )
      .join('');
  }

  // Render Active Poll Hero & Booth
  const p = activePollDetail;
  const closeBtn = document.getElementById('btnCloseAndDecrypt');
  const castBtn = document.getElementById('btnCastBallot');
  if (!p) {
    document.getElementById('pollStatusBadge').textContent = 'NO POLL SELECTED';
    document.getElementById('pollTitle').textContent = hubState.orgTitle || 'CipherVote Governance Hub';
    closeBtn.style.display = 'none';
    return;
  }

  const dot = document.getElementById('pollStatusDot');
  dot.className = p.status === 1 ? 'bv-pulse-dot' : 'bv-pulse-dot closed';
  const statusTxt =
    p.status === 1
      ? 'OPEN FOR ENCRYPTED BALLOTS'
      : p.status === 2
      ? 'AWAITING QUORUM THRESHOLD DECRYPTION'
      : 'QUORUM TALLY DECRYPTED & VERIFIED';
  document.getElementById('pollStatusBadge').textContent = `POLL #${p.pollId} • ${statusTxt}`;
  document.getElementById('pollModeBadge').textContent =
    p.weightMode === 2 ? '🏛️ NVDAX-EQ Share-Weighted' : '🪪 1-Identity = 1-Vote';
  document.getElementById('pollTitle').textContent = p.title;
  document.getElementById('pollDesc').textContent =
    p.desc || 'Zero-knowledge encrypted poll under Validator Epoch ElGamal PK.';
  document.getElementById('windowSub').textContent = `Epoch #${p.epochId} PK ${p.epochPkHex.slice(0, 12)}…`;

  const remBlocks = Math.max(0, p.closeBlock - hubState.nowBlock);
  if (p.status === 1) {
    if (remBlocks > 0) {
      document.getElementById('windowLabel').textContent = 'VOTING WINDOW OPEN';
      document.getElementById('windowValue').textContent = `${remBlocks} Blocks (~${remBlocks * 4}s)`;
      closeBtn.style.display = 'none';
    } else {
      document.getElementById('windowLabel').textContent = 'READY FOR QUORUM TALLY';
      document.getElementById('windowValue').textContent =
        p.ballotCount > 0 ? 'Window Closed — Ready!' : 'Awaiting ≥ 1 Ballot';
      closeBtn.style.display = p.ballotCount > 0 ? 'inline-flex' : 'none';
    }
  } else if (p.status === 2) {
    document.getElementById('windowLabel').textContent = 'THRESHOLD DECRYPTING';
    document.getElementById('windowValue').textContent = 'Validators Signing D_i…';
    closeBtn.style.display = 'none';
  } else {
    document.getElementById('windowLabel').textContent = `SETTLED AT BLOCK #${p.settledBlock}`;
    const signersCnt = BigInt(p.signerBitmap)
      .toString(2)
      .split('')
      .filter((c) => c === '1').length;
    document.getElementById('windowValue').textContent = `${signersCnt} Validators Verified`;
    closeBtn.style.display = 'none';
  }

  // Tally section
  const tallyEl = document.getElementById('tallySection');
  const unit = p.weightMode === 2 ? 'Shares' : 'Votes';
  if (p.status === 3) {
    const tot = Math.max(1, p.totalWeight);
    const rows = [
      { lbl: '✅ YES / APPROVE', val: p.yesTally, color: '#10b981' },
      { lbl: '❌ NO / REJECT', val: p.noTally, color: '#f43f5e' },
      { lbl: '⚖️ ABSTAIN', val: p.abstainTally, color: '#f59e0b' },
    ];
    tallyEl.innerHTML = rows
      .map((r) => {
        const pct = ((r.val / tot) * 100).toFixed(1);
        return `
          <div class="bv-tally-row mono">
            <div class="bv-tally-hdr">
              <span>${r.lbl}</span>
              <span>${r.val.toLocaleString()} ${unit} (${pct}%)</span>
            </div>
            <div class="bv-tally-track">
              <div class="bv-tally-fill" style="width:${pct}%;background:${r.color};"></div>
            </div>
          </div>`;
      })
      .join('');
  } else {
    tallyEl.innerHTML = `
      <div class="bv-sealed-banner mono">
        🔒 <strong>HOMOMORPHICALLY SEALED (${p.ballotCount} Ballots • ${p.totalWeight.toLocaleString()} Total ${unit}):</strong>
        Every vote is folded into <code>(Acc_Yes, Acc_No, Acc_Abstain)</code> inside Wasmtime without decryption.
        No observer, contract, or single validator can see partial standings while voting is open!
      </div>`;
  }

  // Voting Power & Booth button state
  const myIdRec = wallet.getIdentityRecord();
  const powerBadge = document.getElementById('myVotingPowerBadge');
  if (!myIdRec?.identityAddr) {
    powerBadge.textContent = 'Create Identity on Cast';
  } else if (p.weightMode === 1) {
    powerBadge.textContent = `Power: 1 Civic Vote`;
  } else {
    powerBadge.textContent = `Power: ${myShareBalance.toLocaleString()} NVDAX-EQ`;
  }

  if (myVoteReceipt) {
    castBtn.disabled = true;
    castBtn.textContent = `✓ Encrypted Ballot #${myVoteReceipt.ballotIdx + 1} Recorded (Weight: ${myVoteReceipt.weight.toLocaleString()})`;
  } else if (p.status !== 1) {
    castBtn.disabled = true;
    castBtn.textContent = '🔒 Poll Closed — Individual Votes Remain Permanently Encrypted';
  } else if (p.weightMode === 2 && myIdRec?.identityAddr && myShareBalance === 0) {
    castBtn.disabled = true;
    castBtn.textContent = '⚠ Requires > 0 NVDAX-EQ Shares (Select a Civic Poll or Acquire NVDAX-EQ on DEX)';
  } else {
    castBtn.disabled = busyTx;
    const choiceNames = ['YES', 'NO', 'ABSTAIN'];
    castBtn.textContent = `🔐 Encrypt "${choiceNames[selectedChoice]}" & Cast Zero-Knowledge Ballot`;
  }

  // Encrypted Accumulators & Ballot Box
  document.getElementById('ballotBoxCount').textContent = String(p.ballotCount);
  document.getElementById('ballotsCommitTag').textContent = `commit: ${p.ballotsCommit.slice(0, 14)}…`;
  document.getElementById('accumulatorsStrip').innerHTML = [
    ['Acc_Yes (C1||C2)', bytesToHex(p.accYes)],
    ['Acc_No (C1||C2)', bytesToHex(p.accNo)],
    ['Acc_Abstain (C1||C2)', bytesToHex(p.accAbstain)],
  ]
    .map(
      ([lbl, hx]) => `
      <div class="bv-acc-box">
        <span>${lbl}</span>
        <code>${hx.slice(0, 26)}…${hx.slice(-14)}</code>
      </div>`
    )
    .join('');

  const myAddrLow = (myIdRec?.identityAddr || '').toLowerCase();
  const blEl = document.getElementById('ballotsList');
  if (p.ballots.length === 0) {
    blEl.innerHTML = `<div class="bv-muted">No encrypted ballots cast in Poll #${p.pollId} yet. Be the first!</div>`;
  } else {
    blEl.innerHTML = p.ballots
      .slice()
      .reverse()
      .map((b) => {
        const who = nickCache.get(b.voter.toLowerCase()) || shortAddr(b.voter);
        const isMine = b.voter.toLowerCase() === myAddrLow;
        return `
          <div class="bv-ballot-row ${isMine ? 'mine' : ''}">
            <div style="display:flex;justify-content:space-between;gap:0.5rem;">
              <strong>#${b.idx + 1} • ${esc(who)} ${isMine ? '(You)' : ''}</strong>
              <span style="color:#6ee7b7;">Weight: ${b.weight.toLocaleString()} • Blk #${b.blockNumber}</span>
            </div>
            <div style="color:#94a3b8;font-size:0.67rem;">
              🔒 Ciphertexts: Yes <code>${bytesToHex(b.ctYes).slice(0, 14)}…</code> | No <code>${bytesToHex(b.ctNo).slice(0, 14)}…</code> | Abs <code>${bytesToHex(b.ctAbstain).slice(0, 14)}…</code> (Choice Hidden Forever)
            </div>
          </div>`;
      })
      .join('');
  }
}

// ============================================================================
// 4. Transactions: Cast Encrypted Ballot, Close & Decrypt, Create New Poll
// ============================================================================

async function castBallotTx() {
  if (busyTx || !activePollDetail || activePollDetail.status !== 1) return;
  busyTx = true;
  renderUI();
  try {
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'CipherVote' });
    const voterId = idRec.identityAddr;
    const p = activePollDetail;

    setStatus('🔐 Generating 3 ElGamal ciphertexts + CDS 0/1 OR-proofs + DLEQ sum==1 proof in browser…');
    const { ciphertexts192, orProofs384, sumOneProof64 } = await buildEncryptedBallotJs(
      p.epochPkBytes,
      ballotHubAddr,
      p.pollId,
      voterId,
      selectedChoice
    );

    const innerHex = encodeAbi('castEncryptedBallot(uint64,bytes,bytes,bytes)', [
      ['uint64', p.pollId],
      ['bytes', ciphertexts192],
      ['bytes', orProofs384],
      ['bytes', sumOneProof64],
    ]);
    const execHex = encodeAbi('execute(address,bytes)', [
      ['address', ballotHubAddr],
      ['bytes', hexToBytes(innerHex)],
    ]);

    const myEoa = wallet.keypair.address;
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const extraTargets = [ballotHubAddr, hubState.idRegistry];
    if (p.weightMode === 2 && p.shareLedger !== ZERO_ADDR) {
      extraTargets.push(p.shareLedger);
    }

    setStatus('📡 Broadcasting 640-byte Zero-Knowledge Encrypted Ballot to Subnet 1 ($0.00 gas)…');
    const signed = signOrderedLexiconTx({
      privateKey: wallet.keypair.privateKey,
      nonce,
      to: voterId,
      data: execHex,
      gasLimit: 2_800_000n,
      extraTargets,
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    const rcpt = await slxWaitForReceipt(rpcUrl, txHash, 25000);
    if (rcpt?.status === '0x0') {
      throw new Error('Transaction reverted by WASM ZK verifier');
    }
    wallet.recordExternalRpcTx({
      txHash,
      rawTx: signed.raw,
      from: myEoa,
      to: voterId,
      contractLabel: 'CipherVote',
      fnLabel: `castEncryptedBallot(Poll #${p.pollId})`,
      dataHex: execHex,
      blockNumber: parseInt(rcpt?.blockNumber || '0x0', 16),
      nonce: Number(nonce),
    });
    setStatus(`✓ Zero-knowledge ballot verified & homomorphically accumulated in Block #${parseInt(rcpt?.blockNumber || '0x0', 16)}!`);
    await refreshAll();
  } catch (err) {
    setStatus(`⚠ ${err?.message || err}`, true);
  } finally {
    busyTx = false;
    renderUI();
  }
}

async function closeAndRequestTallyTx() {
  if (busyTx || !activePollDetail) return;
  busyTx = true;
  try {
    await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'CipherVote' });
    const myEoa = wallet.keypair.address;
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const dataHex = encodeAbi('closeAndRequestTally(uint64)', [['uint64', activePollDetail.pollId]]);
    setStatus('🔓 Freezing ballot box & requesting Validator-Quorum Threshold Decryption…');
    const signed = signOrderedLexiconTx({
      privateKey: wallet.keypair.privateKey,
      nonce,
      to: ballotHubAddr,
      data: dataHex,
      gasLimit: 2_200_000n,
      extraTargets: [hubState.vrfBeacon],
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    await slxWaitForReceipt(rpcUrl, txHash, 25000);
    setStatus('✓ Decryption requested! Active validators will reveal aggregate tallies in ~1 block.');
    await refreshAll();
  } catch (err) {
    setStatus(`⚠ ${err?.message || err}`, true);
  } finally {
    busyTx = false;
    renderUI();
  }
}

async function createPollTx(ev) {
  ev.preventDefault();
  if (busyTx || !hubState) return;
  const statusEl = document.getElementById('npStatus');
  const title = document.getElementById('npTitle').value.trim();
  const desc = document.getElementById('npDesc').value.trim();
  const weightMode = parseInt(document.getElementById('npWeightMode').value, 10) || 1;
  const duration = Math.max(4, Math.min(600, parseInt(document.getElementById('npDuration').value, 10) || 20));
  if (!title) return;

  busyTx = true;
  statusEl.textContent = '⏳ Locking active Validator Epoch PK & creating poll on Subnet 1…';
  try {
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'CipherVote' });
    const innerHex = encodeAbi('createPoll(string,string,uint64,address,uint64)', [
      ['string', title],
      ['string', desc],
      ['uint64', weightMode],
      ['address', ZERO_ADDR],
      ['uint64', duration],
    ]);
    const execHex = encodeAbi('execute(address,bytes)', [
      ['address', ballotHubAddr],
      ['bytes', hexToBytes(innerHex)],
    ]);
    const myEoa = wallet.keypair.address;
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const signed = signOrderedLexiconTx({
      privateKey: wallet.keypair.privateKey,
      nonce,
      to: idRec.identityAddr,
      data: execHex,
      gasLimit: 2_400_000n,
      extraTargets: [ballotHubAddr, hubState.idRegistry, hubState.vrfBeacon],
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    await slxWaitForReceipt(rpcUrl, txHash, 25000);
    document.getElementById('newPollModal').style.display = 'none';
    document.getElementById('npTitle').value = '';
    document.getElementById('npDesc').value = '';
    statusEl.textContent = '';
    selectedPollId = 0; // Select newly opened poll
    await refreshAll();
    setStatus('✓ New encrypted poll opened!');
  } catch (err) {
    statusEl.textContent = `⚠ ${err?.message || err}`;
  } finally {
    busyTx = false;
  }
}

// ============================================================================
// 5. 1-Click Browser End-to-End Homomorphic Re-Summation + Threshold DLEQ Audit
// ============================================================================

async function openAuditModal() {
  if (!activePollDetail || !hubState) return;
  const p = activePollDetail;
  const modal = document.getElementById('auditModal');
  const titleEl = document.getElementById('auditModalTitle');
  const bodyEl = document.getElementById('auditModalBody');
  titleEl.textContent = `🔬 Browser Cryptographic Audit — Poll #${p.pollId}`;
  bodyEl.innerHTML = `<p>Re-summing ${p.ballots.length} encrypted ciphertexts on <code>Edwards25519</code> in pure browser JavaScript…</p>`;
  modal.style.display = 'flex';

  try {
    // Step 1: Independently recompute `(Acc_Yes, Acc_No, Acc_Abstain) = ∑ w_k · C_{k, s}`!
    const slotNames = ['YES', 'NO', 'ABSTAIN'];
    const onChainAccs = [p.accYes, p.accNo, p.accAbstain];
    const accChecks = [];

    for (let s = 0; s < 3; s++) {
      let sumC1 = ED_IDENTITY;
      let sumC2 = ED_IDENTITY;
      for (const b of p.ballots) {
        const ct = s === 0 ? b.ctYes : s === 1 ? b.ctNo : b.ctAbstain;
        const c1 = edDecode(ct.slice(0, 32));
        const c2 = edDecode(ct.slice(32, 64));
        if (!c1 || !c2) throw new Error(`Malformed curve point on ballot #${b.idx}`);
        const w = BigInt(b.weight);
        sumC1 = edAdd(sumC1, edMul(w, c1));
        sumC2 = edAdd(sumC2, edMul(w, c2));
      }
      const recomputedHex = bytesToHex(concatBytes(edEncode(sumC1), edEncode(sumC2)));
      const onChainHex = bytesToHex(onChainAccs[s]);
      if (recomputedHex !== onChainHex) {
        throw new Error(`Accumulator mismatch on slot ${slotNames[s]}!`);
      }
      accChecks.push(
        `<div>• <strong>Acc_${slotNames[s]}</strong>: <code>${recomputedHex.slice(0, 26)}…</code> — <strong style="color:#34d399;">EXACT SUM MATCH ✓</strong></div>`
      );
    }

    let html = `
      <div class="bv-audit-step">
        <strong>1. Public Homomorphic Ciphertext Re-Summation (<code>∑ w_k · Enc(b_{k,s})</code> across ${p.ballots.length} ballots):</strong><br/>
        ${accChecks.join('')}
      </div>
    `;

    if (p.status !== 3 || p.decReqId === '0x' + '00'.repeat(32)) {
      html += `
        <div class="bv-audit-step" style="border-color:rgba(192,132,252,0.5);">
          <strong>2. Threshold Decryption Status:</strong><br/>
          Poll #${p.pollId} is still sealed — validators have revealed <strong>zero</strong> decryption shares, so partial tallies are information-theoretically hidden until <code>closeAndRequestTally(${p.pollId})</code>!
        </div>
      `;
      bodyEl.innerHTML = html;
      return;
    }

    // Step 2: Fetch `getDecryptionProof(decReqId)` from `vrf-beacon` and verify all DLEQ shares + Lagrange + Discrete Log!
    const prfHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      {
        to: hubState.vrfBeacon,
        data: encodeAbi('getDecryptionProof(bytes32)', [['bytes32', p.decReqId]]),
      },
      'latest',
    ]);
    const pb = hexToBytes(prfHex);
    if (pb.length < 138) throw new Error('Decryption proof bundle too short');

    const slotCount = pb[1];
    const valCount = readU32BE(pb, 10);
    const threshold = readU32BE(pb, 14);
    const decCtx = pb.slice(62, 94);
    const shareCount = readU32BE(pb, 134);

    let cursor = 138;
    const sharePks = [];
    for (let i = 0; i < valCount; i++) {
      sharePks.push(edDecode(pb.slice(cursor + 52, cursor + 84)));
      cursor += 84;
    }

    const slots = [];
    for (let s = 0; s < slotCount; s++) {
      slots.push({
        c1Bytes: pb.slice(cursor, cursor + 32),
        c2Bytes: pb.slice(cursor + 32, cursor + 64),
        dBytes: pb.slice(cursor + 64, cursor + 96),
        mBytes: pb.slice(cursor + 96, cursor + 128),
        tally: readU64BE(pb, cursor + 128),
      });
      cursor += 136;
    }

    const perValidatorShares = [];
    const stride = slotCount * 96;
    for (let k = 0; k < shareCount; k++) {
      const valIdx = readU32BE(pb, cursor);
      const raw = pb.slice(cursor + 4, cursor + 4 + stride);
      cursor += 4 + stride;
      perValidatorShares.push({ valIdx, raw });
    }

    const dleqChecks = [];
    for (const vs of perValidatorShares) {
      const spk = sharePks[vs.valIdx];
      for (let s = 0; s < slotCount; s++) {
        const c1Pt = edDecode(slots[s].c1Bytes);
        const dBytes = vs.raw.slice(s * 96, s * 96 + 32);
        const prf64 = vs.raw.slice(s * 96 + 32, (s + 1) * 96);
        const dPt = edDecode(dBytes);
        if (edIsIdentity(c1Pt)) {
          if (!edIsIdentity(dPt)) throw new Error(`Validator #${vs.valIdx} non-identity share on 𝒪`);
        } else {
          const slotCtx = concatBytes(decCtx, u32BeBytes(s));
          const ok = await verifyDleqJs(ED_BASE, spk, c1Pt, dPt, slotCtx, prf64);
          if (!ok) throw new Error(`Validator #${vs.valIdx} failed DLEQ on slot ${s}`);
        }
      }
      dleqChecks.push(
        `<div>• Validator #${vs.valIdx}: all ${slotCount} partial decryptions <code>D_{${vs.valIdx},s}</code> passed Chaum-Pedersen DLEQ — <strong style="color:#34d399;">VALID ✓</strong></div>`
      );
    }

    const lagrangeChecks = [];
    const subset = perValidatorShares.slice(0, threshold);
    let tallySum = 0;
    for (let s = 0; s < slotCount; s++) {
      const c1Pt = edDecode(slots[s].c1Bytes);
      const c2Pt = edDecode(slots[s].c2Bytes);
      const combinedD = edIsIdentity(c1Pt)
        ? ED_IDENTITY
        : lagrangeCombinePointsJs(
            subset.map((vs) => ({
              valIdx: vs.valIdx,
              pt: edDecode(vs.raw.slice(s * 96, s * 96 + 32)),
            }))
          );
      const mPt = edAdd(c2Pt, edNeg(combinedD));
      const expectedMPt = edMul(BigInt(slots[s].tally), ED_BASE);
      if (bytesToHex(edEncode(mPt)) !== bytesToHex(edEncode(expectedMPt))) {
        throw new Error(`Discrete-log verification failed on slot ${slotNames[s]}!`);
      }
      tallySum += slots[s].tally;
      lagrangeChecks.push(
        `<div>• <strong>${slotNames[s]}</strong>: <code>C_2 - ∑ λ_i D_i == ${slots[s].tally.toLocaleString()} · B</code> — <strong style="color:#34d399;">VERIFIED ✓</strong></div>`
      );
    }
    if (tallySum !== p.totalWeight) {
      throw new Error(`Conservation law mismatch (${tallySum} vs ${p.totalWeight})`);
    }

    html += `
      <div class="bv-audit-step">
        <strong>2. Validator Chaum-Pedersen DLEQ Proofs (${perValidatorShares.length} Signers, Threshold <code>t = ${threshold}</code>):</strong><br/>
        ${dleqChecks.join('')}
      </div>
      <div class="bv-audit-step">
        <strong>3. Lagrange Decryption &amp; Discrete-Log Proof (<code>C_{2,s} - D_s == Tally_s · B</code>):</strong><br/>
        ${lagrangeChecks.join('')}
        <div style="margin-top:0.35rem;color:#fde68a;">• Conservation Invariant: <code>${p.yesTally.toLocaleString()} + ${p.noTally.toLocaleString()} + ${p.abstainTally.toLocaleString()} == ${p.totalWeight.toLocaleString()}</code> — <strong style="color:#34d399;">100% EXACT ✓</strong></div>
      </div>
    `;
    bodyEl.innerHTML = html;
  } catch (err) {
    bodyEl.innerHTML = `<p style="color:#fb7185;">Audit verification error: ${esc(err?.message || err)}</p>`;
  }
}

// ============================================================================
// 6. Boot & Unified Header Wiring
// ============================================================================

async function selectBallotHub(addr) {
  ballotHubAddr = String(addr || '').toLowerCase();
  selectedPollId = 0;
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  await refreshAll();
  stopWatcher = slxWatchChainApp({
    rpcUrlFn: () => rpcUrl,
    contractAddresses: () => [ballotHubAddr, hubState?.vrfBeacon].filter(Boolean),
    onNewBlock: () => refreshAll(),
    onContractLog: () => refreshAll(),
    pollIntervalMs: 3200,
  });
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'ballot',
    title: 'CipherVote Secret Ballot',
    subtitle:
      'Threshold Homomorphic ElGamal • CDS 0/1 Zero-Knowledge Proofs • Quorum-Only Tally Decryption',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => ballotHubAddr || '',
    getContractLabel: () => hubState?.orgTitle || 'CipherVote Governance Hub',
    onWalletSwitch: () => refreshAll(),
    extraElements: [
      document.getElementById('btnOpenNewPoll'),
    ],
  });

  document.querySelectorAll('.bv-choice-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedChoice = parseInt(btn.getAttribute('data-choice'), 10) || 0;
      document.querySelectorAll('.bv-choice-card').forEach((b) => {
        b.classList.toggle('selected', b === btn);
      });
      renderUI();
    });
  });

  document.getElementById('btnCastBallot').addEventListener('click', castBallotTx);
  document.getElementById('btnCloseAndDecrypt').addEventListener('click', closeAndRequestTallyTx);
  document.getElementById('btnAuditActivePoll').addEventListener('click', openAuditModal);

  document.getElementById('btnOpenNewPoll').addEventListener('click', () => {
    document.getElementById('newPollModal').style.display = 'flex';
  });
  document.getElementById('btnCloseNewPoll').addEventListener('click', () => {
    document.getElementById('newPollModal').style.display = 'none';
  });
  document.getElementById('newPollForm').addEventListener('submit', createPollTx);

  document.getElementById('btnCryptoSpec').addEventListener('click', () => {
    document.getElementById('specModal').style.display = 'flex';
  });
  document.getElementById('btnCloseSpec').addEventListener('click', () => {
    document.getElementById('specModal').style.display = 'none';
  });
  document.getElementById('btnCloseAudit').addEventListener('click', () => {
    document.getElementById('auditModal').style.display = 'none';
  });

  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const fallbackAddr = manifest?.secretBallot?.contractAddr;
  if (fallbackAddr) {
    await selectBallotHub(fallbackAddr);
    unifiedHdr?.refresh?.();
  }

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'SECRET_BALLOT',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => ballotHubAddr || '',
    onSelectInstance: async (inst) => {
      await selectBallotHub(inst.primaryAddr);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
