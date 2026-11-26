/**
 * QUANTUM 4D JACKPOT (`web/src/lottery.js`)
 *
 * End-to-End Showcase for SuperLexicon's Wasmtime Validator-Quorum Threshold ECVRF RNG:
 * - Reads live `lottery.wasm` state + `vrf_beacon.wasm` active validator quorum (`host_active_validators`),
 * - 1-click 4D ticket slip (`0000–9999`) settled directly in Institutional `SGD-FIAT`,
 * - Permissionless `closeAndRequestDraw()` + 1-block validator supermajority VRF settlement,
 * - **Pure-Browser `Edwards25519` Chaum-Pedersen DLEQ + Prime-Field `ℤ_ℓ` Lagrange Verifier**
 *   that independently recomputes `H(alpha)`, verifies every validator's 64-byte DLEQ proof,
 *   interpolates `Γ = ∑ λ_i Γ_i`, and checks the rejection-sampled 4D winning number!
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  keccak256Bytes,
  encodeAbi,
  decodeUintWord,
  readU16BE,
  readU32BE,
  readU64BE,
  shortAddr,
  computeAddress,
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
// 1. Pure-JS Edwards25519 Prime-Order-ℓ DLEQ + Lagrange Verifier (RFC 8032)
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
  if (mod(x * x - x2, ED_P) !== 0n) {
    x = (x * ED_SQRT_M1) % ED_P;
  }
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
  let k = scalar;
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

function u64BeBytes(n) {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

async function sha512Bytes(data) {
  const buf = await crypto.subtle.digest('SHA-512', data);
  return new Uint8Array(buf);
}

async function hashToCurveJs(alphaBytes) {
  const prefix = utf8ToBytes('SLX_VM_VRF_H2C_V1');
  const lenBe = u64BeBytes(alphaBytes.length);
  for (let ctr = 0; ctr <= 255; ctr++) {
    const digest = await sha512Bytes(
      concatBytes(prefix, lenBe, alphaBytes, new Uint8Array([ctr]))
    );
    const cand = digest.slice(0, 32);
    cand[31] &= 0x7f;
    const rawPt = edDecode(cand);
    if (rawPt) {
      const cleared = edMul(8n, rawPt); // mul_by_cofactor()
      if (!edIsIdentity(cleared)) return cleared;
    }
  }
  return ED_BASE;
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

function lagrangeCombineJs(shares) {
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
    combined = edAdd(combined, edMul(lambda, shares[i].gammaPt));
  }
  return edEncode(combined);
}

function deriveUnbiased4dJs(random32, reqId32) {
  const prefix = utf8ToBytes('QUANTUM_4D_NUM_V1:');
  for (let ctr = 0; ctr <= 255; ctr++) {
    const digest = keccak256Bytes(
      concatBytes(prefix, random32, reqId32, new Uint8Array([ctr]))
    );
    for (let i = 0; i + 1 < 32; i += 2) {
      const v = (digest[i] << 8) | digest[i + 1];
      if (v < 60000) return v % 10000;
    }
  }
  return ((random32[0] << 8) | random32[1]) % 10000;
}

// ============================================================================
// 2. Live Subnet 1 Lottery State & UI Controller
// ============================================================================

const wallet = new SlxWalletManager();
let rpcUrl = getDefaultNodeWsUrl();
let lotteryAddr = '';
let manifestCache = null;
let lotteryState = null;
let beaconState = null;
let curTickets = [];
let slipNumbers = [];
let nickCache = new Map();
let stopWatcher = null;
let busyTx = false;

function fmt4D(n) {
  return String(Number(n) % 10000).padStart(4, '0');
}

function fmtSgd(n) {
  return `${Number(n).toLocaleString()} SGD`;
}

function parseLotteryState(bytes) {
  if (!bytes || bytes.length < 226) return null;
  const roundId = Number(readU64BE(bytes, 0));
  const phase = bytes[8];
  const ticketPrice = Number(readU64BE(bytes, 9));
  const roundBlocks = Number(readU64BE(bytes, 17));
  const minVals = Number(readU64BE(bytes, 25));
  const openBlk = Number(readU64BE(bytes, 33));
  const closeBlk = Number(readU64BE(bytes, 41));
  const nowBlk = Number(readU64BE(bytes, 49));
  const jackpotPool = Number(readU64BE(bytes, 57));
  const reservePool = Number(readU64BE(bytes, 65));
  const curTicketCnt = readU32BE(bytes, 73);
  const totalSold = Number(readU64BE(bytes, 77));
  const totalPaid = Number(readU64BE(bytes, 85));
  const settledCnt = Number(readU64BE(bytes, 93));
  const fiatLedger = bytesToHex(bytes.slice(101, 121)).toLowerCase();
  const vaultIdentity = bytesToHex(bytes.slice(121, 141)).toLowerCase();
  const vrfBeacon = bytesToHex(bytes.slice(141, 161)).toLowerCase();
  const commitRoot = bytesToHex(bytes.slice(161, 193));
  const pendingReq = bytesToHex(bytes.slice(193, 225));
  const histCnt = bytes[225];

  const history = [];
  let cursor = 226;
  for (let i = 0; i < histCnt; i++) {
    if (cursor + 190 > bytes.length) break;
    const s = bytes.slice(cursor, cursor + 190);
    cursor += 190;
    history.push({
      roundId: Number(readU64BE(s, 0)),
      winning4d: readU16BE(s, 8),
      ticketCount: readU32BE(s, 10),
      w4dCount: readU16BE(s, 14),
      w3dCount: readU16BE(s, 16),
      w2dCount: readU16BE(s, 18),
      w1dCount: readU16BE(s, 20),
      jackpotBefore: Number(readU64BE(s, 22)),
      totalPaid: Number(readU64BE(s, 30)),
      settledBlock: Number(readU64BE(s, 38)),
      epochId: Number(readU64BE(s, 46)),
      signerBitmap: BigInt(readU64BE(s, 54)),
      reqId: bytesToHex(s.slice(62, 94)),
      randomHex: bytesToHex(s.slice(94, 126)),
      gammaHex: bytesToHex(s.slice(126, 158)),
      commitRoot: bytesToHex(s.slice(158, 190)),
    });
  }

  let title = 'Quantum 4D Jackpot';
  if (cursor < bytes.length) {
    const tlen = bytes[cursor];
    cursor += 1;
    if (tlen > 0 && cursor + tlen <= bytes.length) {
      title = new TextDecoder().decode(bytes.slice(cursor, cursor + tlen));
    }
  }

  return {
    roundId,
    phase,
    ticketPrice,
    roundBlocks,
    minVals,
    openBlk,
    closeBlk,
    nowBlk,
    jackpotPool,
    reservePool,
    curTicketCnt,
    totalSold,
    totalPaid,
    settledCnt,
    fiatLedger,
    vaultIdentity,
    vrfBeacon,
    commitRoot,
    pendingReq,
    history,
    title,
  };
}

function parseBeaconState(bytes) {
  if (!bytes || bytes.length < 193) return null;
  const curEpoch = Number(readU64BE(bytes, 0));
  const actEpoch = Number(readU64BE(bytes, 8));
  const reqCnt = Number(readU64BE(bytes, 16));
  const fulCnt = Number(readU64BE(bytes, 24));
  const liveValCnt = readU32BE(bytes, 32);
  const liveThresh = readU32BE(bytes, 36);
  const liveSetHash = bytesToHex(bytes.slice(40, 72));
  const epStatus = bytes[72];
  const epValCnt = readU32BE(bytes, 73);
  const epThresh = readU32BE(bytes, 77);
  const epOpenedBlk = Number(readU64BE(bytes, 81));
  const epDealBitmap = BigInt(readU64BE(bytes, 89));
  const epSetHash = bytesToHex(bytes.slice(97, 129));
  const epPk = bytesToHex(bytes.slice(129, 161));
  const validators = [];
  let cursor = 193;
  for (let i = 0; i < liveValCnt; i++) {
    if (cursor + 52 > bytes.length) break;
    validators.push({
      idx: i,
      address: bytesToHex(bytes.slice(cursor, cursor + 20)).toLowerCase(),
      pubkey: bytesToHex(bytes.slice(cursor + 20, cursor + 52)),
      hasDeal: (epDealBitmap & (1n << BigInt(i))) !== 0n,
    });
    cursor += 52;
  }
  return {
    curEpoch,
    actEpoch,
    reqCnt,
    fulCnt,
    liveValCnt,
    liveThresh,
    liveSetHash,
    epStatus,
    epValCnt,
    epThresh,
    epOpenedBlk,
    epDealBitmap,
    epSetHash,
    epPk,
    validators,
  };
}

async function resolveNick(addr) {
  const norm = String(addr || '').toLowerCase();
  if (!norm || norm === ZERO_ADDR) return '—';
  if (nickCache.has(norm)) return nickCache.get(norm);
  const nick = await readOnChainIdentityNickname(rpcUrl, norm).catch(() => '');
  const label = nick ? `${nick} (${shortAddr(norm)})` : shortAddr(norm);
  nickCache.set(norm, label);
  return label;
}

function getReelNumber() {
  let s = '';
  for (let i = 0; i < 4; i++) {
    const v = parseInt(document.getElementById(`digit${i}`).value, 10);
    s += Number.isFinite(v) ? String(((v % 10) + 10) % 10) : '0';
  }
  return parseInt(s, 10);
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('txStatusMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#fb7185' : '#22d3ee';
}

function renderSlip() {
  const listEl = document.getElementById('slipList');
  document.getElementById('slipCount').textContent = String(slipNumbers.length);
  const price = lotteryState?.ticketPrice || 10;
  document.getElementById('slipCost').textContent = fmtSgd(slipNumbers.length * price);
  if (!slipNumbers.length) {
    listEl.innerHTML = `<span class="lot-muted">No 4D numbers in slip yet — pick digits above or click Quick Pick!</span>`;
    return;
  }
  listEl.innerHTML = slipNumbers
    .map(
      (num, idx) =>
        `<span class="lot-slip-chip">${fmt4D(num)} <button type="button" data-rm="${idx}" title="Remove">✕</button></span>`
    )
    .join('');
  listEl.querySelectorAll('button[data-rm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-rm'), 10);
      slipNumbers.splice(i, 1);
      renderSlip();
    });
  });
}

async function refreshAll() {
  if (!lotteryAddr) return;
  try {
    const rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: lotteryAddr, data: encodeAbi('getLotteryState()', []) },
      'latest',
    ]);
    const st = parseLotteryState(hexToBytes(rawHex));
    if (!st) return;
    lotteryState = st;

    // Query beacon state + current round tickets in parallel
    const [beaconHex, ticketsHex] = await Promise.all([
      slxNodeRpc(rpcUrl, 'eth_call', [
        { to: st.vrfBeacon, data: encodeAbi('getBeaconState()', []) },
        'latest',
      ]).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [
        {
          to: lotteryAddr,
          data: encodeAbi('getRoundTickets(uint64)', [['uint64', BigInt(st.roundId)]]),
        },
        'latest',
      ]).catch(() => '0x'),
    ]);

    beaconState = parseBeaconState(hexToBytes(beaconHex));
    const tBytes = hexToBytes(ticketsHex);
    curTickets = [];
    if (tBytes.length >= 4) {
      const cnt = readU32BE(tBytes, 0);
      for (let i = 0; i < cnt && 4 + (i + 1) * 22 <= tBytes.length; i++) {
        const off = 4 + i * 22;
        curTickets.push({
          buyer: bytesToHex(tBytes.slice(off, off + 20)).toLowerCase(),
          pick: readU16BE(tBytes, off + 20),
        });
      }
    }

    // Resolve player identity balance & lifetime stats
    const myRec = await wallet.resolveVerifiedIdentity(rpcUrl).catch(() => null);
    const myId = myRec?.identityAddr?.toLowerCase() || '';
    if (myId) {
      document.getElementById('myIdentityShort').textContent = myRec.nickname
        ? `${myRec.nickname} (${shortAddr(myId)})`
        : shortAddr(myId);
      document.getElementById('btnFaucetTopup').style.display = manifestCache?.institutional?.faucetPriv
        ? ''
        : 'none';
      const [balHex, statsHex] = await Promise.all([
        slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: st.fiatLedger,
            data: encodeAbi('balanceOf(address)', [['address', myId]]),
          },
          'latest',
        ]).catch(() => '0x0'),
        slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: lotteryAddr,
            data: encodeAbi('getPlayerStats(address)', [['address', myId]]),
          },
          'latest',
        ]).catch(() => '0x'),
      ]);
      const mySgd = Number(decodeUintWord(balHex));
      document.getElementById('mySgdBalance').textContent = fmtSgd(mySgd);
      const sb = hexToBytes(statsHex);
      if (sb.length >= 32) {
        document.getElementById('statBought').textContent = String(readU64BE(sb, 0));
        document.getElementById('statSpent').textContent = fmtSgd(readU64BE(sb, 8));
        document.getElementById('statWon').textContent = fmtSgd(readU64BE(sb, 16));
        document.getElementById('statHits').textContent = String(readU64BE(sb, 24));
      }
    } else {
      document.getElementById('mySgdBalance').textContent = 'Create Identity to Play';
      document.getElementById('myIdentityShort').textContent = 'No Identity yet';
    }

    await renderState(myId);
  } catch (err) {
    console.warn('[Lottery] refresh warning:', err);
  }
}

async function renderState(myId) {
  const st = lotteryState;
  if (!st) return;

  const phaseText = st.phase === 1 ? 'SALES OPEN' : 'THRESHOLD VRF DRAWING…';
  document.getElementById('roundBadge').textContent = `${st.title.toUpperCase()} • ROUND #${st.roundId} • ${phaseText}`;
  document.getElementById('jackpotAmount').textContent = fmtSgd(st.jackpotPool);
  document.getElementById('reserveAmount').textContent = fmtSgd(st.reservePool);
  document.getElementById('tier4dVal').textContent = fmtSgd(st.jackpotPool);
  document.getElementById('curRoundTicketsCnt').textContent = String(st.curTicketCnt);
  document.getElementById('curCommitRoot').textContent = `commit: ${st.commitRoot.slice(0, 14)}…`;
  document.getElementById('settledCountTag').textContent = `${st.settledCnt} Draws`;

  const btnDraw = document.getElementById('btnTriggerDraw');
  const cdLbl = document.getElementById('countdownLabel');
  const cdVal = document.getElementById('countdownValue');
  const cdSub = document.getElementById('countdownSub');

  if (st.phase === 2) {
    cdLbl.textContent = 'QUORUM VRF IN FLIGHT';
    cdVal.textContent = 'Collecting Shares…';
    cdSub.textContent = `Req ${st.pendingReq.slice(0, 12)}…`;
    btnDraw.style.display = 'none';
  } else if (st.curTicketCnt === 0) {
    cdLbl.textContent = 'ROUND STANDBY';
    cdVal.textContent = 'Buy 1st Ticket';
    cdSub.textContent = `${st.roundBlocks}-block timer starts on 1st ticket`;
    btnDraw.style.display = 'none';
  } else if (st.nowBlk < st.closeBlk) {
    const rem = st.closeBlk - st.nowBlk;
    cdLbl.textContent = 'CLOSES IN';
    cdVal.textContent = `${rem} Block${rem === 1 ? '' : 's'} (~${rem * 4}s)`;
    cdSub.textContent = `Block #${st.nowBlk} → Draw at #${st.closeBlk}`;
    btnDraw.style.display = 'none';
  } else {
    cdLbl.textContent = 'READY FOR VRF DRAW';
    cdVal.textContent = `${st.curTicketCnt} Tickets Sealed`;
    cdSub.textContent = `Window closed at #${st.closeBlk}`;
    btnDraw.style.display = '';
  }

  // Render current round tickets
  const gridEl = document.getElementById('curTicketsGrid');
  if (!curTickets.length) {
    gridEl.innerHTML = `<span class="lot-muted">No tickets sealed in Round #${st.roundId} yet.</span>`;
  } else {
    const uniqueBuyers = [...new Set(curTickets.map((t) => t.buyer))];
    await Promise.all(uniqueBuyers.map((b) => resolveNick(b)));
    gridEl.innerHTML = curTickets
      .map((t) => {
        const mine = myId && t.buyer === myId;
        const who = mine ? 'YOU' : (nickCache.get(t.buyer) || shortAddr(t.buyer)).split(' ')[0];
        return `<span class="lot-ticket-pill ${mine ? 'lot-ticket-mine' : ''}"><strong>${fmt4D(t.pick)}</strong> · ${who}</span>`;
      })
      .join('');
  }

  // Render Validator Quorum Beacon panel
  if (beaconState) {
    const b = beaconState;
    document.getElementById('quorumBadge').textContent = `${b.liveThresh}-of-${b.liveValCnt} BFT Quorum`;
    const statusLabel =
      b.epStatus === 2 ? 'ACTIVE (Ready in 1 Block)' : b.epStatus === 1 ? 'OPENING DKG…' : 'UNINITIALIZED';
    document.getElementById('beaconMetaSummary').innerHTML =
      `<div>Epoch <strong>#${b.curEpoch}</strong>: <span style="color:#34d399;">${statusLabel}</span> • Fulfilled Draws: <strong>${b.fulCnt}</strong></div>` +
      `<div>Group PK: <code>${b.epPk.slice(0, 22)}…</code></div>` +
      `<div>Validator Set Hash: <code>${b.liveSetHash.slice(0, 22)}…</code> (min req: <strong>${st.minVals}</strong>)</div>`;

    document.getElementById('validatorNodesList').innerHTML = b.validators
      .map(
        (v) => `
        <div class="lot-val-row">
          <span>Validator #${v.idx} · <code>${v.pubkey.slice(0, 14)}…</code></span>
          <span style="color:${v.hasDeal ? '#34d399' : '#fbbf24'};">${v.hasDeal ? '✓ DKG Key Share Ready' : '⏳ Dealing'}</span>
        </div>`
      )
      .join('');
  }

  // Render settled history cards with 1-click browser verifier
  const histEl = document.getElementById('historyList');
  if (!st.history.length) {
    histEl.innerHTML = `<span class="lot-muted">Round #1 will appear here with its full threshold ECVRF proof as soon as it settles!</span>`;
  } else {
    histEl.innerHTML = st.history
      .map((h) => {
        const signers = [];
        for (let i = 0; i < 32; i++) {
          if ((h.signerBitmap & (1n << BigInt(i))) !== 0n) signers.push(`V${i}`);
        }
        return `
        <div class="lot-hist-card">
          <div class="lot-hist-top">
            <div>
              <strong class="mono">Round #${h.roundId}</strong>
              <div class="lot-muted mono">Block #${h.settledBlock} · ${h.ticketCount} tickets · Paid <strong style="color:#34d399;">${fmtSgd(h.totalPaid)}</strong></div>
            </div>
            <span class="lot-win-ball mono">${fmt4D(h.winning4d)}</span>
          </div>
          <div class="lot-muted mono" style="margin-top:6px;">
            Hits: <strong>${h.w4dCount}×4D</strong> · <strong>${h.w3dCount}×3D</strong> · <strong>${h.w2dCount}×2D</strong> · <strong>${h.w1dCount}×1D</strong> | Signers: <code>${signers.join(',')}</code>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
            <span class="lot-muted mono">VRF: <code>${h.randomHex.slice(0, 16)}…</code></span>
            <button type="button" class="lot-btn lot-btn-cyan" data-verify-req="${h.reqId}" data-verify-round="${h.roundId}" data-verify-win="${h.winning4d}">
              🔬 Verify Proof in Browser
            </button>
          </div>
        </div>`;
      })
      .join('');

    histEl.querySelectorAll('button[data-verify-req]').forEach((btn) => {
      btn.addEventListener('click', () => {
        verifyRoundProofInBrowser(
          btn.getAttribute('data-verify-req'),
          Number(btn.getAttribute('data-verify-round')),
          Number(btn.getAttribute('data-verify-win'))
        );
      });
    });
  }

  renderSlip();
}

async function buySlipTicketsTx() {
  if (busyTx) return;
  if (!slipNumbers.length) {
    // Convenience: if slip is empty, add the current 4-digit reel number automatically!
    slipNumbers.push(getReelNumber());
    renderSlip();
  }
  if (!lotteryState || lotteryState.phase !== 1) {
    setStatus('Round draw is currently in flight — wait 1 block for Round #' + ((lotteryState?.roundId || 0) + 1), true);
    return;
  }

  busyTx = true;
  try {
    setStatus('Ensuring your Subnet 1 Identity…');
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Quantum 4D Jackpot' });
    const myId = idRec.identityAddr.toLowerCase();
    const myEoa = wallet.keypair.address;
    const myPriv = wallet.keypair.privateKey;

    // Check SGD-FIAT balance; if insufficient and Institutional Faucet is available on demo Subnet 1, auto-fund 500 SGD!
    const needed = slipNumbers.length * (lotteryState.ticketPrice || 10);
    const balHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: lotteryState.fiatLedger, data: encodeAbi('balanceOf(address)', [['address', myId]]) },
      'latest',
    ]);
    const curBal = Number(decodeUintWord(balHex));
    if (curBal < needed) {
      if (manifestCache?.institutional?.faucetPriv && manifestCache?.institutional?.faucetIdentity) {
        setStatus(`Auto-funding 1,000 SGD-FIAT from Subnet 1 Faucet…`);
        await claimTestSgdInternal(myId, 1000n);
      } else {
        throw new Error(`Insufficient SGD-FIAT (${curBal} SGD < ${needed} SGD needed)`);
      }
    }

    // Check if `myId` already delegated `lotteryAddr`
    const authHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: myId, data: encodeAbi('isAuthorized(address)', [['address', lotteryAddr]]) },
      'latest',
    ]);
    const isAuth = decodeUintWord(authHex) === 1;

    const picksBytes = new Uint8Array(slipNumbers.length * 2);
    slipNumbers.forEach((n, i) => {
      picksBytes[2 * i] = (n >> 8) & 0xff;
      picksBytes[2 * i + 1] = n & 0xff;
    });
    const innerBuy = encodeAbi('buyTickets(bytes)', [['bytes', picksBytes]]);
    const execCd = encodeAbi('execute(address,bytes)', [
      ['address', lotteryAddr],
      ['bytes', hexToBytes(innerBuy)],
    ]);

    let nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const txHashes = [];
    let prevHash = undefined;

    if (!isAuth) {
      setStatus('Authorizing 1-click SGD ticket settlement & sealing 4D slip…');
      const txDel = signOrderedLexiconTx({
        privateKey: myPriv,
        nonce,
        to: myId,
        data: encodeAbi('setDelegate(address,bool)', [
          ['address', lotteryAddr],
          ['bool', true],
        ]),
        gasLimit: 800_000n,
        extraTargets: [myId],
      });
      nonce += 1n;
      prevHash = txDel.txHash;
      txHashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txDel.raw]));
    } else {
      setStatus(`Sealing ${slipNumbers.length} ticket(s) on Subnet 1…`);
    }

    const txBuy = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: myId,
      data: execCd,
      gasLimit: 2_500_000n,
      extraTargets: [myId, lotteryAddr, lotteryState.fiatLedger, lotteryState.vaultIdentity],
      ...(prevHash ? { lowerBoundHashHex: prevHash } : {}),
    });
    txHashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txBuy.raw]));

    for (const h of txHashes) {
      const r = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, { timeoutMs: 45_000 });
      if (!r || r.status !== '0x1') throw new Error('Ticket transaction reverted on Subnet 1');
    }

    slipNumbers = [];
    setStatus('✓ Tickets sealed on-chain in Round #' + lotteryState.roundId + '!');
    await refreshAll();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    busyTx = false;
  }
}

async function claimTestSgdInternal(targetIdentity, amountSgd = 1000n) {
  const inst = manifestCache?.institutional;
  if (!inst?.faucetPriv || !inst?.faucetIdentity || !inst?.fiatLedger) {
    throw new Error('Faucet not configured in manifest');
  }
  const fEoa = computeAddress(inst.faucetPriv);
  const fn = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [fEoa, 'latest']));
  const tx = signOrderedLexiconTx({
    privateKey: inst.faucetPriv,
    nonce: fn,
    to: inst.faucetIdentity,
    data: encodeAbi('transferBankBalance(address,address,uint64)', [
      ['address', inst.fiatLedger],
      ['address', targetIdentity],
      ['uint64', amountSgd],
    ]),
    gasLimit: 1_200_000n,
    extraTargets: [inst.faucetIdentity, inst.fiatLedger, targetIdentity],
  });
  const h = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tx.raw]);
  const r = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, { timeoutMs: 45_000 });
  if (!r || r.status !== '0x1') throw new Error('Faucet transfer failed');
}

async function triggerDrawTx() {
  if (busyTx || !lotteryState) return;
  busyTx = true;
  try {
    setStatus('Requesting Threshold ECVRF Draw from active Subnet 1 validators…');
    const myEoa = wallet.keypair.address;
    const myPriv = wallet.keypair.privateKey;
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const tx = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: lotteryAddr,
      data: encodeAbi('closeAndRequestDraw()', []),
      gasLimit: 2_500_000n,
      extraTargets: [
        lotteryAddr,
        lotteryState.vrfBeacon,
        lotteryState.fiatLedger,
        lotteryState.vaultIdentity,
      ],
    });
    const h = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tx.raw]);
    const r = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, { timeoutMs: 45_000 });
    if (!r || r.status !== '0x1') throw new Error('closeAndRequestDraw reverted');
    setStatus('⚡ VRF Requested! Watch the 4-of-5 validators submit DLEQ shares in the next block…');
    await refreshAll();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    busyTx = false;
  }
}

async function verifyRoundProofInBrowser(reqIdHex, roundId, expectedWin4d) {
  const modal = document.getElementById('proofModal');
  const titleEl = document.getElementById('proofModalTitle');
  const bodyEl = document.getElementById('proofModalBody');
  modal.style.display = 'flex';
  titleEl.textContent = `🔬 Verifying Edwards25519 DLEQ + Lagrange Proof — Round #${roundId}`;
  bodyEl.innerHTML = `<p>Fetching full proof bundle <code>${reqIdHex}</code> from <code>vrf_beacon.wasm</code> &amp; running browser verification…</p>`;

  try {
    const rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      {
        to: lotteryState.vrfBeacon,
        data: encodeAbi('getRequestProof(bytes32)', [['bytes32', reqIdHex]]),
      },
      'latest',
    ]);
    const b = hexToBytes(rawHex);
    if (b.length < 225) throw new Error('Incomplete proof bundle');

    const epochId = Number(readU64BE(b, 1));
    const valCount = readU32BE(b, 9);
    const threshold = readU32BE(b, 13);
    const alpha = b.slice(85, 117);
    const epochPk = b.slice(117, 149);
    const gammaOnChain = b.slice(149, 181);
    const randomOnChain = b.slice(181, 213);
    const shareCount = readU32BE(b, 221);

    let cursor = 225;
    const vals = [];
    for (let i = 0; i < valCount; i++) {
      vals.push({
        addr: bytesToHex(b.slice(cursor, cursor + 20)),
        valPk: b.slice(cursor + 20, cursor + 52),
        sharePk: b.slice(cursor + 52, cursor + 84),
      });
      cursor += 84;
    }

    const shares = [];
    for (let s = 0; s < shareCount && cursor + 100 <= b.length; s++) {
      const valIdx = readU32BE(b, cursor);
      const gammaI = b.slice(cursor + 4, cursor + 36);
      const proof64 = b.slice(cursor + 36, cursor + 100);
      shares.push({ valIdx, gammaI, proof64 });
      cursor += 100;
    }

    // Step 1: Hash-to-Curve H(alpha)
    const H = await hashToCurveJs(alpha);
    const hHex = bytesToHex(edEncode(H));

    // Step 2: Verify every validator's Chaum-Pedersen DLEQ proof!
    const verifiedShares = [];
    const dleqLines = [];
    for (const sh of shares) {
      const spkPt = edDecode(vals[sh.valIdx].sharePk);
      const gammaPt = edDecode(sh.gammaI);
      const ok =
        spkPt &&
        gammaPt &&
        (await verifyDleqJs(ED_BASE, spkPt, H, gammaPt, alpha, sh.proof64));
      if (!ok) throw new Error(`Validator #${sh.valIdx} DLEQ proof failed!`);
      if (verifiedShares.length < threshold) {
        verifiedShares.push({ valIdx: sh.valIdx, gammaPt });
      }
      dleqLines.push(
        `<div>✅ Validator #${sh.valIdx} (<code>${bytesToHex(vals[sh.valIdx].valPk).slice(0, 14)}…</code>): DLEQ(<code>SharePK_${sh.valIdx}</code>, <code>Γ_${sh.valIdx}</code>) = <strong>VALID</strong></div>`
      );
    }

    // Step 3: Lagrange-combine first `threshold` verified shares in ℤ_ℓ!
    const combinedGamma = lagrangeCombineJs(verifiedShares);
    const gammaMatch = bytesToHex(combinedGamma) === bytesToHex(gammaOnChain);
    if (!gammaMatch) throw new Error('Lagrange-combined Gamma mismatch!');

    // Step 4: Recompute random_32 = keccak256("SLX_VM_VRF_OUT_V1:" || epoch_pk || len_be8 || alpha || gamma)
    const recomputedRandom = keccak256Bytes(
      concatBytes(
        utf8ToBytes('SLX_VM_VRF_OUT_V1:'),
        epochPk,
        u64BeBytes(alpha.length),
        alpha,
        combinedGamma
      )
    );
    const rndMatch = bytesToHex(recomputedRandom) === bytesToHex(randomOnChain);
    if (!rndMatch) throw new Error('Keccak-256 VRF random output mismatch!');

    // Step 5: Recompute unbiased rejection-sampled 4D winning number!
    const recomputed4d = deriveUnbiased4dJs(recomputedRandom, hexToBytes(reqIdHex));
    const winMatch = recomputed4d === expectedWin4d;
    if (!winMatch) throw new Error('Winning 4D number derivation mismatch!');

    bodyEl.innerHTML = `
      <div class="lot-proof-step">
        <strong>✓ ALL 5 CRYPTOGRAPHIC INVARIANTS VERIFIED INDEPENDENTLY IN YOUR BROWSER</strong><br/>
        Epoch #${epochId} • Threshold <strong>${threshold}-of-${valCount}</strong> Active Consensus Validators
      </div>
      <div class="lot-proof-step">
        <strong>1. Cofactor-Cleared Hash-to-Curve <code>H(α) = 8 · TryAndIncrement(α)</code>:</strong><br/>
        α = <code>${bytesToHex(alpha)}</code><br/>
        H(α) = <code>${hHex}</code>
      </div>
      <div class="lot-proof-step">
        <strong>2. Individual Validator Chaum-Pedersen DLEQ Proofs (<code>log_B(SharePK_i) == log_{H(α)}(Γ_i)</code>):</strong>
        ${dleqLines.join('')}
      </div>
      <div class="lot-proof-step">
        <strong>3. Prime-Order <code>ℤ_ℓ</code> Lagrange Interpolation (<code>Γ = ∑ λ_i Γ_i</code>):</strong><br/>
        Browser Γ: <code>${bytesToHex(combinedGamma)}</code><br/>
        On-Chain Γ: <code>${bytesToHex(gammaOnChain)}</code> — <strong style="color:#34d399;">EXACT MATCH ✓</strong>
      </div>
      <div class="lot-proof-step">
        <strong>4. Unbiased Rejection-Sampled 4D Draw:</strong><br/>
        VRF Output: <code>${bytesToHex(recomputedRandom)}</code><br/>
        Winning 4D Number: <strong style="color:#fbbf24;font-size:1.05rem;">${fmt4D(recomputed4d)}</strong> — <strong style="color:#34d399;">EXACT MATCH ✓</strong>
      </div>
    `;
  } catch (err) {
    bodyEl.innerHTML = `<p style="color:#fb7185;">Verification error: ${err?.message || err}</p>`;
  }
}

async function selectLotteryInstance(addr) {
  lotteryAddr = String(addr || '').toLowerCase();
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  await refreshAll();
  stopWatcher = slxWatchChainApp({
    rpcUrlFn: () => rpcUrl,
    contractAddresses: () =>
      [lotteryAddr, lotteryState?.vrfBeacon].filter(Boolean),
    onNewBlock: () => refreshAll(),
    onContractLog: () => refreshAll(),
    pollIntervalMs: 3200,
  });
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'lottery',
    title: 'Quantum 4D Jackpot',
    subtitle:
      'Validator-Quorum Threshold ECVRF • Auto BFT Supermajority • Instant SGD-FIAT Payouts',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => lotteryAddr || '',
    getContractLabel: () => lotteryState?.title || 'Quantum 4D Jackpot',
    onWalletSwitch: () => refreshAll(),
    extraElements: [
      document.getElementById('btnFaucetTopup'),
    ],
  });

  // Wire 4-digit reel controls
  document.querySelectorAll('.lot-reel-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = btn.getAttribute('data-digit');
      const step = parseInt(btn.getAttribute('data-step'), 10);
      const inp = document.getElementById(`digit${idx}`);
      const cur = parseInt(inp.value, 10) || 0;
      inp.value = String(((cur + step) % 10 + 10) % 10);
    });
  });
  for (let i = 0; i < 4; i++) {
    const inp = document.getElementById(`digit${i}`);
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1) || '0';
    });
  }

  document.getElementById('btnAddPick').addEventListener('click', () => {
    if (slipNumbers.length >= 10) return setStatus('Max 10 tickets per transaction!', true);
    slipNumbers.push(getReelNumber());
    renderSlip();
  });
  document.getElementById('btnQuick1').addEventListener('click', () => {
    if (slipNumbers.length >= 10) return setStatus('Max 10 tickets per transaction!', true);
    const r = crypto.getRandomValues(new Uint16Array(1))[0] % 10000;
    const s = fmt4D(r);
    for (let i = 0; i < 4; i++) document.getElementById(`digit${i}`).value = s[i];
    slipNumbers.push(r);
    renderSlip();
  });
  document.getElementById('btnQuick5').addEventListener('click', () => {
    const slots = Math.min(5, 10 - slipNumbers.length);
    if (slots <= 0) return setStatus('Slip already has 10 tickets!', true);
    const arr = crypto.getRandomValues(new Uint16Array(slots));
    for (let i = 0; i < slots; i++) slipNumbers.push(arr[i] % 10000);
    renderSlip();
  });
  document.getElementById('btnCover1D').addEventListener('click', () => {
    const prefix = Math.floor(getReelNumber() / 10) * 10;
    slipNumbers = Array.from({ length: 10 }, (_, d) => prefix + d);
    renderSlip();
    setStatus(`Loaded ${fmt4D(prefix)}–${fmt4D(prefix + 9)}: covers all 10 last digits (guaranteed ≥ 15 SGD 1D win)!`);
  });
  document.getElementById('btnClearSlip').addEventListener('click', () => {
    slipNumbers = [];
    renderSlip();
  });
  document.getElementById('btnBuyTickets').addEventListener('click', buySlipTicketsTx);
  document.getElementById('btnTriggerDraw').addEventListener('click', triggerDrawTx);

  document.getElementById('btnFaucetTopup').addEventListener('click', async () => {
    if (busyTx) return;
    busyTx = true;
    try {
      const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Quantum 4D Jackpot' });
      setStatus('Dispensing +1,000 SGD-FIAT from Institutional Faucet…');
      await claimTestSgdInternal(idRec.identityAddr, 1000n);
      setStatus('✓ Credited +1,000 SGD-FIAT!');
      await refreshAll();
    } catch (err) {
      setStatus(err?.message || String(err), true);
    } finally {
      busyTx = false;
    }
  });

  document.getElementById('btnCryptoSpec').addEventListener('click', () => {
    document.getElementById('specModal').style.display = 'flex';
  });
  document.getElementById('btnCloseSpec').addEventListener('click', () => {
    document.getElementById('specModal').style.display = 'none';
  });
  document.getElementById('btnCloseProof').addEventListener('click', () => {
    document.getElementById('proofModal').style.display = 'none';
  });

  renderSlip();
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  manifestCache = manifest;
  const fallbackAddr = manifest?.quantumLottery?.contractAddr;
  if (fallbackAddr) {
    await selectLotteryInstance(fallbackAddr);
    unifiedHdr?.refresh?.();
  }

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'QUANTUM_LOTTERY',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => lotteryAddr || '',
    onSelectInstance: async (inst) => {
      await selectLotteryInstance(inst.primaryAddr);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
