/**
 * CIPHER NOIR: SYNDICATE SABOTAGE (`cipher-noir.js` — HFS #16)
 *
 * 100% Arbiter-Free, Zero-Trusted-Setup Zero-Knowledge & Threshold Espionage Deduction on Subnet 1:
 * - 2-Party Verifiable ElGamal Co-Shuffle (`submitInitialShuffle` + `coShuffleAndDeal`) verified on-chain
 *   via 16-gate `Bulletproofs` R1CS grand-product permutation proofs (`host_bp_verify_r1cs`).
 * - 5-Validator Threshold ElGamal Case Vault (`vrf-beacon`) + DDH-Blinded Private Hand Delivery.
 * - Cheat-Proof `passAlibiCheck` (`672` B `Bulletproofs` R1CS non-membership proof) & `transmitAlibiProof`
 *   (`352` B 1-of-3 Disjunctive Schnorr + ElGamal whisper proof).
 * - 2-Party Non-Zero Co-Blinded 1-Bit `fileIndictment` leaking strictly 0 bits on false guesses!
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  encodeAbi,
  eventTopic,
  decodeUintWord,
  decodeAddrWord,
  shortAddr,
  ZERO_ADDR,
  SlxClient,
  SlxWalletManager,
  SlxHfsCache,
  getDefaultNodeWsUrl,
  readOnChainIdentityNickname,
  slxWatchChainApp,
  NOIR_PHASES,
  bpPedersenCommitU64,
  deriveNoirSeatSecrets,
  decryptNoirHandCards,
  proveNoirInitialShuffle,
  proveNoirPassAlibi,
  proveNoirWhisperOr3,
  decryptNoirWhisper,
  computeNoirIndictmentDelta0,
  proveNoirIndictmentBlind,
  decodeNoirCaseState,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';
import { mountSlxGameGuide } from '@superlexicon/sdk/ui/game-guide';

// ---------------------------------------------------------------------------
// 18 Original Sabotage Dossiers & Facility Topology
// ---------------------------------------------------------------------------

const {
  LOBBY: PHASE_LOBBY,
  SHUFFLING: PHASE_SHUFFLING,
  DEALING: PHASE_DEALING,
  ACTIVE: PHASE_ACTIVE,
  PROBE_PENDING: PHASE_PROBE_PENDING,
  INDICTMENT_SHIELDING: PHASE_INDICTMENT_SHIELDING,
  INDICTMENT_DECRYPTING: PHASE_INDICTMENT_DECRYPTING,
  UNVEILING_VAULT: PHASE_UNVEILING_VAULT,
  SOLVED: PHASE_SOLVED,
} = NOIR_PHASES;

const DOSSIERS = [
  // 0..4 Syndicate Operatives
  { id: 0, cat: 'Operative', name: 'Cipher Vex', role: 'Signal Ghost', color: '#22d3ee' },
  { id: 1, cat: 'Operative', name: 'Director Kestrel', role: 'Treasury Insider', color: '#f59e0b' },
  { id: 2, cat: 'Operative', name: 'Dr. Lyra Vance', role: 'Quantum Architect', color: '#a855f7' },
  { id: 3, cat: 'Operative', name: 'Broker Rook', role: 'Dark-Pool Fixer', color: '#10b981' },
  { id: 4, cat: 'Operative', name: 'Envoy Sable', role: 'Diplomatic Courier', color: '#f43f5e' },

  // 5..9 Sabotage Exploits
  { id: 5, cat: 'Exploit', name: 'Zero-Day Firmware' },
  { id: 6, cat: 'Exploit', name: 'Cryo-Key Siphon' },
  { id: 7, cat: 'Exploit', name: 'EMP Micro-Pulse' },
  { id: 8, cat: 'Exploit', name: 'Forged Quorum Token' },
  { id: 9, cat: 'Exploit', name: 'Laser Side-Channel' },

  // 10..17 Clearinghouse Facility Sectors (2x4 Blueprint + 2 Quantum Transit Tubes)
  { id: 10, cat: 'Sector', name: 'Cryo-Server Core', tubeTo: 17 },
  { id: 11, cat: 'Sector', name: 'Validator Rotunda', tubeTo: null },
  { id: 12, cat: 'Sector', name: 'Fiber Splice Lab', tubeTo: null },
  { id: 13, cat: 'Sector', name: 'Diplomatic Atrium', tubeTo: 14 },
  { id: 14, cat: 'Sector', name: 'Faraday Vault', tubeTo: 13 },
  { id: 15, cat: 'Sector', name: 'Dark-Pool Desk', tubeTo: null },
  { id: 16, cat: 'Sector', name: 'Substation Alpha', tubeTo: null },
  { id: 17, cat: 'Sector', name: 'Helipad Airlock', tubeTo: 10 },
];

const SEAT_COLORS = ['#22d3ee', '#f59e0b', '#a855f7', '#10b981', '#f43f5e'];
const SEAT_CALLSIGNS = ['Vex', 'Kestrel', 'Vance', 'Rook', 'Sable'];
const VAULT_SEAL_IMG = '/assets/cipher-noir/vault_seal.jpg';

function dossierImg(id) {
  if (id == null || id < 0 || id > 17) return VAULT_SEAL_IMG;
  return `/assets/cipher-noir/card_${String(id).padStart(2, '0')}.jpg`;
}

function isSectorReachable(fromSec, toSec, wasPulled) {
  if (fromSec < 10 || fromSec > 17 || toSec < 10 || toSec > 17) return false;
  if (fromSec === toSec) return Boolean(wasPulled);
  if (
    (fromSec === 10 && toSec === 17) ||
    (fromSec === 17 && toSec === 10) ||
    (fromSec === 13 && toSec === 14) ||
    (fromSec === 14 && toSec === 13)
  ) {
    return true;
  }
  const ia = fromSec - 10;
  const ib = toSec - 10;
  const dr = Math.abs(Math.floor(ia / 4) - Math.floor(ib / 4));
  const dc = Math.abs((ia % 4) - (ib % 4));
  return dr + dc <= 2;
}

const TOPICS = {
  CASE_OPENED: eventTopic('CaseOpened(bytes32,address,uint64)'),
  SEAT_CLAIMED: eventTopic('SeatClaimed(bytes32,address,uint64,uint64)'),
  DECK_SHUFFLED: eventTopic('DeckShuffled(bytes32,address,uint64)'),
  VAULT_SEALED: eventTopic('VaultSealed(bytes32,bytes32,uint64)'),
  PROBE_SUBMITTED: eventTopic('ProbeSubmitted(bytes32,uint64,uint64,uint64,uint64,uint64,uint64)'),
  ALIBI_PASSED: eventTopic('AlibiPassed(bytes32,uint64,uint64,uint64)'),
  ALIBI_TRANSMITTED: eventTopic('AlibiTransmitted(bytes32,uint64,uint64,uint64,bytes32,bytes32)'),
  INDICTMENT_FILED: eventTopic('IndictmentFiled(bytes32,address,uint64,uint64,uint64,uint64)'),
  INDICTMENT_REFUTED: eventTopic('IndictmentRefuted(bytes32,uint64,uint64)'),
  CASE_SOLVED: eventTopic('CaseSolved(bytes32,address,uint64,uint64,uint64,uint64)'),
};

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Live Client State
// ---------------------------------------------------------------------------

const rpcUrl = getDefaultNodeWsUrl();
const slxClient = new SlxClient({ rpcUrl });
const wallet = new SlxWalletManager();

let contractAddr = null;
let vrfBeaconAddr = null;
let activeCaseId = null;
let caseState = null;
let latestBlock = 0;
let watcherHandle = null;
let txBusy = false;

const nicknameCache = new Map();
const seenLogKeys = new Set();
const manualNotes = new Map();

let mySeatSecrets = null;
let myDecryptedHand = []; // [{ slot, dossierId, verified }]
let decryptedWhispers = new Map(); // probeIdx -> { dossierId, slot, fromSeat, verified }

function getMySeat() {
  if (!caseState) return -1;
  const myEoa = wallet.keypair.address.toLowerCase();
  const s = caseState.seats.find((x) => x.occupied !== 0 && x.eoa === myEoa);
  return s ? s.seat : -1;
}

function seatLabel(seatIdx) {
  if (seatIdx == null || seatIdx >= 5) return 'Unknown';
  const st = caseState?.seats?.[seatIdx];
  if (st?.identityAddr && st.identityAddr !== ZERO_ADDR && nicknameCache.has(st.identityAddr)) {
    return nicknameCache.get(st.identityAddr);
  }
  if (st?.occupied === 0) return `Open (${SEAT_CALLSIGNS[seatIdx]})`;
  return `${SEAT_CALLSIGNS[seatIdx]}·${shortAddr(st?.eoa || '')}`;
}

async function hydrateSeatNicknames(seats) {
  let changed = false;
  await Promise.all(
    seats.map(async (st) => {
      if (!st.identityAddr || st.identityAddr === ZERO_ADDR || nicknameCache.has(st.identityAddr)) return;
      const nick = await readOnChainIdentityNickname(rpcUrl, st.identityAddr).catch(() => null);
      if (nick) {
        nicknameCache.set(st.identityAddr, nick);
        changed = true;
      }
    })
  );
  if (changed) renderAll();
}

// ---------------------------------------------------------------------------
// Local DDH Hand Decryption, Pedersen Commitment Check & 1-of-3 ZK Whispers
// ---------------------------------------------------------------------------

function decryptLocalSecrets() {
  mySeatSecrets = null;
  myDecryptedHand = [];
  decryptedWhispers = new Map();
  if (!caseState || !activeCaseId) return;

  const mySeat = getMySeat();
  if (mySeat < 0) return;

  try {
    mySeatSecrets = deriveNoirSeatSecrets(
      wallet.keypair.privateKey,
      activeCaseId,
      wallet.keypair.address,
      caseState.hdr.epochPk
    );
  } catch (err) {
    console.warn('[CipherNoir] deriveNoirSeatSecrets warning:', err);
    return;
  }

  if (caseState.hdr.phase < PHASE_ACTIVE) return;

  const seatRec = caseState.seats[mySeat];

  // 1. Recover our 3 private Dossiers from DDH-blinded points `M'_{s,0..2}` & verify `V_{s,k}`!
  try {
    const recovered = decryptNoirHandCards(
      seatRec.blindedDecrypts,
      mySeatSecrets.uSk,
      caseState.hdr.epochPk
    );
    for (const item of recovered) {
      const expectedV = bpPedersenCommitU64(item.dossierId, mySeatSecrets.wSk[item.slot]);
      const verified = bytesEqual(expectedV, seatRec.handCommits[item.slot]);
      myDecryptedHand.push({
        slot: item.slot,
        dossierId: item.dossierId,
        verified,
      });
    }
  } catch (err) {
    console.warn('[CipherNoir] DDH hand decrypt warning:', err);
  }

  // 2. Decrypt any 1-of-3 ZK ElGamal Whispers where WE were `proberSeat` (or recall our own whisper!)
  for (const entry of caseState.logs) {
    if (entry.status !== 1 || entry.disproverSeat >= 5) continue;
    if (entry.proberSeat === mySeat) {
      const dossierId = decryptNoirWhisper(entry.whisperCt, mySeatSecrets.edSk);
      if (dossierId != null && dossierId < 18) {
        decryptedWhispers.set(entry.probeIdx, {
          dossierId,
          slot: entry.disproverSlot,
          fromSeat: entry.disproverSeat,
          verified: true, // Verified on-chain by 1-of-3 Disjunctive Schnorr/ElGamal proof!
        });
      }
    } else if (entry.disproverSeat === mySeat) {
      const own = myDecryptedHand.find((h) => h.slot === entry.disproverSlot);
      if (own) {
        decryptedWhispers.set(entry.probeIdx, {
          dossierId: own.dossierId,
          slot: own.slot,
          fromSeat: mySeat,
          verified: true,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Live WebSocket Feed
// ---------------------------------------------------------------------------

function pushFeed(html, cls = '') {
  const el = document.getElementById('forensicFeed');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `noir-feed-item ${cls}`.trim();
  div.innerHTML = html;
  el.prepend(div);
  while (el.children.length > 45) el.removeChild(el.lastChild);
}

function handleNoirLog(log) {
  if (!log?.topics?.length) return;
  const key = `${log.transactionHash || ''}:${log.logIndex || ''}:${log.topics[0]}:${log.data || ''}`;
  if (seenLogKeys.has(key)) return;
  seenLogKeys.add(key);

  const t0 = String(log.topics[0]).toLowerCase();
  const d = log.data || '0x';

  if (t0 === TOPICS.DECK_SHUFFLED) {
    const step = decodeUintWord(d, 0);
    pushFeed(
      `🔀 <strong>ZK Deck Shuffle #${step}/2 Verified!</strong> 16-gate <code>Bulletproofs</code> R1CS grand-product proof accepted on-chain.`,
      'whisper'
    );
  } else if (t0 === TOPICS.VAULT_SEALED) {
    pushFeed(
      `🔒 <strong>Threshold Vault Sealed &amp; 15 DDH Hands Dealt!</strong> Zero Arbiter — nobody knows the 3 Vault cards.`,
      'whisper'
    );
  } else if (t0 === TOPICS.PROBE_SUBMITTED) {
    const pidx = decodeUintWord(d, 0);
    const prober = decodeUintWord(d, 1);
    const op = decodeUintWord(d, 2);
    const exp = decodeUintWord(d, 3);
    const sec = decodeUintWord(d, 4);
    pushFeed(
      `<strong>[P#${pidx + 1}]</strong> <span style="color:${SEAT_COLORS[prober % 5]}">${seatLabel(prober)}</span> probed <strong>${DOSSIERS[op]?.name}</strong> + <strong>${DOSSIERS[exp]?.name}</strong> in <strong>${DOSSIERS[sec]?.name}</strong>`
    );
  } else if (t0 === TOPICS.ALIBI_PASSED) {
    const pidx = decodeUintWord(d, 0);
    const seat = decodeUintWord(d, 1);
    const next = decodeUintWord(d, 2);
    pushFeed(
      `[P#${pidx + 1}] ${seatLabel(seat)} verified <code>Bulletproofs R1CS</code> <em>No Alibi Match</em>${next === 255 ? ' — <strong>UNREFUTED AROUND TABLE!</strong>' : ''}`
    );
  } else if (t0 === TOPICS.ALIBI_TRANSMITTED) {
    const pidx = decodeUintWord(d, 0);
    const resp = decodeUintWord(d, 1);
    const prober = decodeUintWord(d, 2);
    pushFeed(
      `🔐 <strong>[P#${pidx + 1}]</strong> ${seatLabel(resp)} verified a 352B <code>1-of-3 ZK</code> ElGamal Alibi Whisper to ${seatLabel(prober)}!`,
      'whisper'
    );
  } else if (t0 === TOPICS.INDICTMENT_REFUTED) {
    const seat = decodeUintWord(d, 0);
    pushFeed(
      `⚠️ ${seatLabel(seat)}&rsquo;s Indictment failed 1-bit Threshold Zero-Check (0 partial bits leaked) — clearance revoked!`
    );
  } else if (t0 === TOPICS.CASE_SOLVED) {
    const winSeat = decodeUintWord(d, 0);
    const op = decodeUintWord(d, 1);
    const exp = decodeUintWord(d, 2);
    const sec = decodeUintWord(d, 3);
    pushFeed(
      `🏆 <strong>THRESHOLD VAULT UNSEALED!</strong> ${winSeat < 5 ? seatLabel(winSeat) + ' solved it:' : 'Solution:'} <strong>${DOSSIERS[op]?.name}</strong> used <strong>${DOSSIERS[exp]?.name}</strong> in <strong>${DOSSIERS[sec]?.name}</strong>!`,
      'solved'
    );
  }
}

// ---------------------------------------------------------------------------
// Auto-Deduction Matrix Computation
// ---------------------------------------------------------------------------

function buildDeductionModel() {
  const holderByDossier = new Map();
  const passSet = new Set();

  const mySeat = getMySeat();
  for (const h of myDecryptedHand) {
    holderByDossier.set(h.dossierId, mySeat);
  }
  if (caseState) {
    for (const entry of caseState.logs) {
      for (let s = 0; s < 5; s++) {
        if (((entry.passMask >>> s) & 1) !== 0) {
          passSet.add(`${entry.operative}:${s}`);
          passSet.add(`${entry.exploit}:${s}`);
          passSet.add(`${entry.sector}:${s}`);
        }
      }
      const w = decryptedWhispers.get(entry.probeIdx);
      if (w) {
        holderByDossier.set(w.dossierId, w.fromSeat);
      }
    }
  }
  return { holderByDossier, passSet };
}

// ---------------------------------------------------------------------------
// UI Rendering
// ---------------------------------------------------------------------------

function renderPhaseAndResponder() {
  const titleEl = document.getElementById('phaseTitle');
  const descEl = document.getElementById('phaseDesc');
  const actEl = document.getElementById('phaseActions');
  const respBar = document.getElementById('responderAlert');
  const indictBtn = document.getElementById('btnOpenIndictModal');

  respBar.style.display = 'none';
  actEl.innerHTML = '';

  if (!caseState) return;
  const { hdr, seats } = caseState;
  const mySeat = getMySeat();
  const isMyActiveTurn =
    hdr.phase === PHASE_ACTIVE && mySeat >= 0 && hdr.turnSeat === mySeat && !seats[mySeat].revoked;

  indictBtn.style.display =
    mySeat >= 0 && !seats[mySeat].revoked && hdr.phase === PHASE_ACTIVE ? 'inline-block' : 'none';

  if (hdr.phase === PHASE_LOBBY) {
    const seatedHumans = seats.filter((s) => s.occupied === 1).length;
    titleEl.textContent = `STAGE 1 — ZERO-KNOWLEDGE BRIEFING LOBBY (${seatedHumans}/5 Human Seats Claimed)`;
    if (mySeat >= 0) {
      descEl.innerHTML = `You claimed <strong>Seat #${mySeat} (${DOSSIERS[mySeat].name})</strong> with verified <code>Edwards25519</code> DDH/Pedersen PoKs! Click <strong>ZK Shuffle &amp; Deal Now</strong> to launch the 2-party co-shuffle.`;
      actEl.innerHTML = `<button id="btnDealNow" class="noir-btn noir-btn-emerald" ${txBusy ? 'disabled' : ''}>${txBusy ? '⏳ Proving ZK Shuffle…' : '🔀 ZK Shuffle &amp; Deal Now'}</button>`;
      document.getElementById('btnDealNow').addEventListener('click', requestDealTx);
    } else {
      descEl.textContent =
        'Claim an Operative Seat below — zero trusted Arbiter: you & an independent Operative co-shuffle the 18 Dossiers under the 5-Validator Threshold Key!';
      actEl.innerHTML = `
        <button id="btnJoinAndDeal" class="noir-btn noir-btn-emerald" ${txBusy ? 'disabled' : ''}>${txBusy ? '⏳ Proving ZK Shuffle…' : '⚡ Join, Co-Shuffle &amp; Deal'}</button>
        <button id="btnClaimSeat" class="noir-btn noir-btn-primary" ${txBusy ? 'disabled' : ''} title="Wait in lobby so friends can claim seats before shuffling">👥 Join Lobby</button>
      `;
      document.getElementById('btnJoinAndDeal').addEventListener('click', () => claimSeatTx(0, true));
      document.getElementById('btnClaimSeat').addEventListener('click', () => claimSeatTx(0, false));
    }
  } else if (hdr.phase === PHASE_SHUFFLING) {
    titleEl.textContent = `🔀 STAGE 1B — 2-PARTY BULLETPROOFS CO-SHUFFLE (1/2 Verified)`;
    descEl.innerHTML = `Shuffle #1 verified on-chain via 16-gate <code>Bulletproofs R1CS</code> — independent co-shuffler permuting &amp; re-randomizing under Epoch #${hdr.epochId} next block!`;
    actEl.innerHTML = `<span class="noir-badge noir-badge-emerald mono">⏳ Co-Shuffling 18 Threshold Ciphertexts…</span>`;
  } else if (hdr.phase === PHASE_DEALING) {
    titleEl.textContent = `🔑 STAGE 1C — 5-VALIDATOR THRESHOLD DDH HAND DEAL (${hdr.dealFulfilledMask === 0 ? '0' : '1'}/2 Batches)`;
    descEl.innerHTML = `3 Vault Dossiers sealed under 4-of-5 Threshold ElGamal; validators fulfilling DDH-blinded hand shares <code>M'<sub>s,k</sub></code>…`;
    actEl.innerHTML = `<span class="noir-badge noir-badge-emerald mono">⏳ Validators Fulfilling DDH Hand Shares…</span>`;
  } else if (hdr.phase === PHASE_ACTIVE) {
    if (isMyActiveTurn) {
      titleEl.textContent = `🎯 YOUR TURN — ${seatLabel(mySeat).toUpperCase()}`;
      descEl.textContent =
        'Click a cyan-highlighted reachable Facility Sector below to run a 3-Vector Forensic Probe, or click ⚖️ File Indictment if you cracked the Vault!';
    } else {
      titleEl.textContent = `STAGE 2 — ACTIVE INVESTIGATION (Turn: ${seatLabel(hdr.turnSeat)})`;
      descEl.innerHTML =
        mySeat < 0
          ? `Spectating Arbiter-Free Threshold Case (Vault <code>${hdr.vaultHashHex.slice(0, 12)}…</code>, Epoch #${hdr.epochId}). Click <strong>↻ New Case</strong> anytime to play!`
          : `Waiting for <strong>${seatLabel(hdr.turnSeat)}</strong> to submit a Forensic Probe…`;
    }
  } else if (hdr.phase === PHASE_PROBE_PENDING) {
    titleEl.textContent = `📡 FORENSIC PROBE #${hdr.probeCount} IN PROGRESS`;
    descEl.innerHTML = `<strong>${seatLabel(hdr.proberSeat)}</strong> probed <strong>[${DOSSIERS[hdr.probeOperative]?.name}, ${DOSSIERS[hdr.probeExploit]?.name}, ${DOSSIERS[hdr.probeSector]?.name}]</strong> → awaiting ZK Alibi Proof from <strong>${seatLabel(hdr.responderSeat)}</strong>.`;

    if (mySeat >= 0 && hdr.responderSeat === mySeat) {
      const matching = myDecryptedHand.filter(
        (h) =>
          h.dossierId === hdr.probeOperative ||
          h.dossierId === hdr.probeExploit ||
          h.dossierId === hdr.probeSector
      );
      respBar.style.display = 'flex';
      if (matching.length === 0) {
        respBar.innerHTML = `
          <div>
            <strong style="color:#f0abfc;">🔔 BULLETPROOFS R1CS NON-MEMBERSHIP PROOF REQUIRED</strong>
            <div style="font-size:0.73rem;color:#e2e8f0;">Prove in Zero Knowledge (<code>&prod;(c<sub>k</sub> - p<sub>m</sub>) &middot; inv = 1</code>) that none of your 3 committed cards match.</div>
          </div>
          <button id="btnPassAlibi" class="noir-btn noir-btn-primary" ${txBusy ? 'disabled' : ''}>${txBusy ? '⏳ Proving R1CS…' : '📭 Prove No Match (Bulletproofs)'}</button>
        `;
        document.getElementById('btnPassAlibi').addEventListener('click', passAlibiTx);
      } else {
        respBar.innerHTML = `
          <div>
            <strong style="color:#6ee7b7;">🔐 1-OF-3 ZK VERIFIABLE ALIBI WHISPER REQUIRED</strong>
            <div style="font-size:0.73rem;color:#e2e8f0;">Choose 1 matching Dossier to prove &amp; ElGamal-encrypt exclusively to <strong>${seatLabel(hdr.proberSeat)}</strong>:</div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            ${matching
              .map(
                (m) =>
                  `<button class="noir-btn noir-btn-emerald" ${txBusy ? 'disabled' : ''} data-whisper-slot="${m.slot}" style="display:inline-flex;align-items:center;gap:6px;"><img src="${dossierImg(m.dossierId)}" alt="" style="width:20px;height:26px;object-fit:cover;border-radius:3px;" />🔐 ZK Whisper "${DOSSIERS[m.dossierId].name}"</button>`
              )
              .join('')}
          </div>
        `;
        respBar.querySelectorAll('[data-whisper-slot]').forEach((btn) => {
          btn.addEventListener('click', () =>
            transmitWhisperTx(Number(btn.getAttribute('data-whisper-slot')))
          );
        });
      }
    }
  } else if (
    hdr.phase === PHASE_INDICTMENT_SHIELDING ||
    hdr.phase === PHASE_INDICTMENT_DECRYPTING ||
    hdr.phase === PHASE_UNVEILING_VAULT
  ) {
    titleEl.textContent =
      hdr.phase === PHASE_INDICTMENT_SHIELDING
        ? `⚖️ CO-BLINDING INDICTMENT (2-Party Non-Zero Scalar Shield)…`
        : hdr.phase === PHASE_UNVEILING_VAULT
        ? `🔓 ALL CLEARANCES REVOKED — 5 VALIDATORS UNVEILING VAULT…`
        : `⚖️ 5-VALIDATOR 1-BIT THRESHOLD ZERO-CHECK IN PROGRESS…`;
    descEl.innerHTML = `<strong>${seatLabel(hdr.indictSeat)}</strong> indicted <strong>[${DOSSIERS[hdr.indictOperative]?.name}, ${DOSSIERS[hdr.indictExploit]?.name}, ${DOSSIERS[hdr.indictSector]?.name}]</strong> — resolving with 0-bit partial leakage!`;
  } else if (hdr.phase === PHASE_SOLVED) {
    const winTxt =
      hdr.winnerSeat < 5
        ? `Solved by ${seatLabel(hdr.winnerSeat)}!`
        : 'All clearances revoked — Threshold Vault unveiled:';
    titleEl.textContent = `🏆 THRESHOLD CASE VAULT UNSEALED ON-CHAIN — ${winTxt}`;
    descEl.innerHTML = `Culprit: <strong style="color:#fbbf24;">${DOSSIERS[hdr.solOperative]?.name}</strong> • Exploit: <strong style="color:#fbbf24;">${DOSSIERS[hdr.solExploit]?.name}</strong> • Sector: <strong style="color:#fbbf24;">${DOSSIERS[hdr.solSector]?.name}</strong>`;
    actEl.innerHTML = `<button id="btnPlayAgainSolved" class="noir-btn noir-btn-amber" ${txBusy ? 'disabled' : ''}>↻ Start Next Mystery</button>`;
    document.getElementById('btnPlayAgainSolved').addEventListener('click', openAndClaimFreshCaseTx);
  }

  const trioEl = document.getElementById('vaultTrioMount');
  if (trioEl) {
    if (hdr.phase === PHASE_SOLVED) {
      trioEl.innerHTML = [hdr.solOperative, hdr.solExploit, hdr.solSector]
        .map(
          (id) => `
          <div class="noir-vault-slot solved" title="Unsealed Vault: ${DOSSIERS[id]?.name || ''}">
            <img src="${dossierImg(id)}" alt="${DOSSIERS[id]?.name || ''}" />
            <div class="noir-vault-slot-lbl mono">${DOSSIERS[id]?.name || ''}</div>
          </div>`
        )
        .join('');
    } else if (hdr.phase === PHASE_PROBE_PENDING) {
      trioEl.innerHTML = [hdr.probeOperative, hdr.probeExploit, hdr.probeSector]
        .map(
          (id) => `
          <div class="noir-vault-slot probe-live" title="Active Probe: ${DOSSIERS[id]?.name || ''}">
            <img src="${dossierImg(id)}" alt="${DOSSIERS[id]?.name || ''}" />
            <div class="noir-vault-slot-lbl mono">${DOSSIERS[id]?.name || ''}</div>
          </div>`
        )
        .join('');
    } else {
      trioEl.innerHTML = ['? OPERATIVE', '? EXPLOIT', '? SECTOR']
        .map(
          (lbl) => `
          <div class="noir-vault-slot" title="4-of-5 Threshold ElGamal Vault (${hdr.vaultHashHex})">
            <img src="${VAULT_SEAL_IMG}" alt="${lbl}" />
            <div class="noir-vault-slot-lbl mono">${lbl}</div>
          </div>`
        )
        .join('');
    }
  }
}

function renderBlueprintAndControls(deduction) {
  if (!caseState) return;
  const { hdr, seats } = caseState;
  const mySeat = getMySeat();
  const myRec = mySeat >= 0 ? seats[mySeat] : null;
  const canProbe =
    hdr.phase === PHASE_ACTIVE && mySeat >= 0 && hdr.turnSeat === mySeat && !myRec.revoked;

  const selSecEl = document.getElementById('selProbeSector');
  const currentSelectedSec = Number(selSecEl.value) || 10;

  const opOpts = [0, 1, 2, 3, 4]
    .map((id) => {
      const elim = deduction.holderByDossier.has(id);
      return `<option value="${id}">${elim ? '✓ ' : '🎯 '}${DOSSIERS[id].name}</option>`;
    })
    .join('');
  const expOpts = [5, 6, 7, 8, 9]
    .map((id) => {
      const elim = deduction.holderByDossier.has(id);
      return `<option value="${id}">${elim ? '✓ ' : '🎯 '}${DOSSIERS[id].name}</option>`;
    })
    .join('');

  const prevOp = document.getElementById('selProbeOperative').value;
  const prevExp = document.getElementById('selProbeExploit').value;
  document.getElementById('selProbeOperative').innerHTML = opOpts;
  document.getElementById('selProbeExploit').innerHTML = expOpts;
  if (prevOp !== '') document.getElementById('selProbeOperative').value = prevOp;
  if (prevExp !== '') document.getElementById('selProbeExploit').value = prevExp;

  const reachList = [];
  for (let sc = 10; sc <= 17; sc++) {
    const ok = myRec ? isSectorReachable(myRec.sectorId, sc, myRec.pulled) : true;
    if (ok) reachList.push(sc);
  }
  selSecEl.innerHTML = reachList
    .map((sc) => {
      const elim = deduction.holderByDossier.has(sc);
      return `<option value="${sc}">${elim ? '✓ ' : '🎯 '}${DOSSIERS[sc].name}</option>`;
    })
    .join('');
  if (reachList.includes(currentSelectedSec)) {
    selSecEl.value = String(currentSelectedSec);
  }

  document.getElementById('probeTurnTag').textContent = canProbe
    ? '🟢 Your Turn to Probe!'
    : hdr.phase < PHASE_ACTIVE
    ? 'Co-Shuffle / Deal'
    : `Turn: ${seatLabel(hdr.turnSeat)}`;
  document.getElementById('btnSubmitProbe').disabled = txBusy || !canProbe;

  const updateProbeCardPreview = () => {
    const pEl = document.getElementById('probePreviewCards');
    if (!pEl) return;
    const ids = [
      Number(document.getElementById('selProbeOperative').value || 0),
      Number(document.getElementById('selProbeExploit').value || 5),
      Number(selSecEl.value || 10),
    ];
    pEl.innerHTML = ids
      .map(
        (id) => `
        <div class="noir-mini-card">
          <img src="${dossierImg(id)}" alt="${DOSSIERS[id]?.name || ''}" />
          <div class="noir-mini-card-cap">${DOSSIERS[id]?.name || ''}</div>
        </div>`
      )
      .join('');
  };
  updateProbeCardPreview();
  document.getElementById('selProbeOperative').onchange = updateProbeCardPreview;
  document.getElementById('selProbeExploit').onchange = updateProbeCardPreview;
  selSecEl.onchange = updateProbeCardPreview;

  const grid = document.getElementById('sectorGrid');
  let gHtml = '';
  for (let sc = 10; sc <= 17; sc++) {
    const d = DOSSIERS[sc];
    const reachable = myRec ? isSectorReachable(myRec.sectorId, sc, myRec.pulled) : false;
    const isSel = Number(selSecEl.value) === sc && canProbe;
    const isElim = deduction.holderByDossier.has(sc);
    const occupants = seats.filter((s) => s.occupied !== 0 && s.sectorId === sc);

    gHtml += `
      <div class="noir-sector-card ${canProbe && reachable ? 'reachable' : ''} ${isSel ? 'selected' : ''} ${isElim ? 'eliminated' : ''}" data-sec="${sc}" style="background-image:url('${dossierImg(sc)}');">
        <div>
          <div class="noir-sector-top">
            <span class="noir-sector-name">${d.name}</span>
            ${d.tubeTo ? `<span class="noir-tube-tag mono">⇄ ${DOSSIERS[d.tubeTo].name.split(' ')[0]}</span>` : ''}
          </div>
          <div class="mono" style="font-size:0.61rem;color:${isElim ? '#6ee7b7' : '#fde68a'};margin-top:2px;text-shadow:0 1px 3px #000;">
            ${isElim ? `✓ Cleared (${seatLabel(deduction.holderByDossier.get(sc))})` : '🎯 Uneliminated'}
          </div>
        </div>
        <div class="noir-pawns-wrap">
          ${occupants
            .map(
              (o) =>
                `<span class="noir-pawn" style="color:${SEAT_COLORS[o.seat]}"><img src="${dossierImg(o.seat)}" alt="" />${o.seat === mySeat ? '★' : ''}${SEAT_CALLSIGNS[o.seat]}</span>`
            )
            .join('')}
        </div>
      </div>
    `;
  }
  grid.innerHTML = gHtml;
  grid.querySelectorAll('.noir-sector-card').forEach((card) => {
    card.addEventListener('click', () => {
      const sc = Number(card.getAttribute('data-sec'));
      if (reachList.includes(sc)) {
        selSecEl.value = String(sc);
        renderBlueprintAndControls(deduction);
      }
    });
  });

  const handEl = document.getElementById('myHandCards');
  const badgeEl = document.getElementById('handCryptoBadge');
  if (mySeat < 0 || hdr.phase < PHASE_ACTIVE) {
    badgeEl.textContent =
      mySeat < 0
        ? 'Spectator Mode'
        : hdr.phase === PHASE_LOBBY
        ? 'DDH Blinds Ready'
        : 'Threshold Dealing…';
    handEl.innerHTML = [0, 1, 2]
      .map(
        (idx) => `
        <div class="noir-dossier-card">
          <img class="noir-dossier-art" src="${VAULT_SEAL_IMG}" alt="Encrypted Dossier" />
          <div class="noir-dossier-top"><span class="noir-dossier-cat mono">SEALED #${idx + 1}</span></div>
          <div class="noir-dossier-bottom">
            <span class="noir-dossier-title">${mySeat < 0 ? 'Join to Deal' : 'Co-Shuffling'}</span>
            <span class="noir-dossier-proof mono" style="color:#94a3b8;">🔒 DDH + Pedersen</span>
          </div>
        </div>`
      )
      .join('');
  } else {
    const allVerified = myDecryptedHand.length === 3 && myDecryptedHand.every((x) => x.verified);
    badgeEl.textContent = allVerified ? '🔒 DDH + Pedersen 3/3 OK' : 'Decrypting…';
    handEl.innerHTML = myDecryptedHand
      .map((h) => {
        const d = DOSSIERS[h.dossierId];
        const catCls = `cat-${d.cat.toLowerCase()}`;
        return `
          <div class="noir-dossier-card ${catCls}">
            <img class="noir-dossier-art" src="${dossierImg(h.dossierId)}" alt="${d.name}" />
            <div class="noir-dossier-top">
              <span class="noir-dossier-cat mono">${d.cat}</span>
            </div>
            <div class="noir-dossier-bottom">
              <span class="noir-dossier-title">${d.name}</span>
              <span class="noir-dossier-proof mono">${h.verified ? '✓ Pedersen V_k OK' : '⚠ Mismatch'}</span>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function renderDeductionMatrix(deduction) {
  const tbl = document.getElementById('deductionTable');
  if (!tbl || !caseState) return;

  const { holderByDossier, passSet } = deduction;
  const clearedCount = holderByDossier.size;
  document.getElementById('deductionSummary').textContent = `${clearedCount}/15 Cleared`;

  let html = `
    <thead>
      <tr>
        <th>Dossier</th>
        ${[0, 1, 2, 3, 4]
          .map(
            (s) =>
              `<th style="color:${SEAT_COLORS[s]}" title="${seatLabel(s)}">${SEAT_CALLSIGNS[s][0]}${s === getMySeat() ? '★' : ''}</th>`
          )
          .join('')}
      </tr>
    </thead>
    <tbody>
  `;

  const groups = [
    ['OPERATIVES (1 IN VAULT)', 0, 4],
    ['SABOTAGE EXPLOITS (1 IN VAULT)', 5, 9],
    ['FACILITY SECTORS (1 IN VAULT)', 10, 17],
  ];

  for (const [title, start, end] of groups) {
    html += `<tr class="cat-row"><td colspan="6">${title}</td></tr>`;
    const unelimInGroup = [];
    for (let id = start; id <= end; id++) {
      if (!holderByDossier.has(id)) unelimInGroup.push(id);
    }
    for (let id = start; id <= end; id++) {
      const heldBy = holderByDossier.get(id);
      const isPrime = heldBy == null && unelimInGroup.length === 1;
      html += `<tr class="${heldBy != null ? 'eliminated-row' : ''} ${isPrime ? 'prime-suspect' : ''}">`;
      html += `<td><img class="noir-matrix-thumb" src="${dossierImg(id)}" alt="" />${isPrime ? '🎯 ' : ''}${DOSSIERS[id].name}</td>`;
      for (let s = 0; s < 5; s++) {
        let cell = '·';
        let cls = '';
        if (heldBy != null) {
          if (heldBy === s) {
            cell = '✓';
            cls = 'noir-cell-held';
          } else {
            cell = '✕';
            cls = 'noir-cell-pass';
          }
        } else if (passSet.has(`${id}:${s}`)) {
          cell = '✕';
          cls = 'noir-cell-pass';
        } else if (manualNotes.get(`${id}:${s}`)) {
          cell = manualNotes.get(`${id}:${s}`);
        }
        html += `<td class="${cls}" data-note="${id}:${s}" style="cursor:pointer;">${cell}</td>`;
      }
      html += `</tr>`;
    }
  }
  html += `</tbody>`;
  tbl.innerHTML = html;

  tbl.querySelectorAll('[data-note]').forEach((td) => {
    td.addEventListener('click', () => {
      const k = td.getAttribute('data-note');
      if (manualNotes.get(k) === '?') manualNotes.delete(k);
      else manualNotes.set(k, '?');
      renderDeductionMatrix(deduction);
    });
  });
}

let noirGuide = null;

function updateNoirCoach(deduction) {
  if (!noirGuide || !caseState) return;
  const { hdr, seats } = caseState;
  const mySeat = getMySeat();
  const myRec = mySeat >= 0 ? seats[mySeat] : null;

  const remOps = [0, 1, 2, 3, 4].filter((id) => !deduction.holderByDossier.has(id));
  const remExps = [5, 6, 7, 8, 9].filter((id) => !deduction.holderByDossier.has(id));
  const remSecs = [10, 11, 12, 13, 14, 15, 16, 17].filter((id) => !deduction.holderByDossier.has(id));
  const solvedLocally = remOps.length === 1 && remExps.length === 1 && remSecs.length === 1;

  if (hdr.phase === PHASE_SOLVED) {
    noirGuide.updateCoach({
      pill: '🏆 CASE CLOSED',
      tone: 'action',
      html: `Threshold Vault unsealed: <strong>${DOSSIERS[hdr.solOperative]?.name}</strong> used <strong>${DOSSIERS[hdr.solExploit]?.name}</strong> in <strong>${DOSSIERS[hdr.solSector]?.name}</strong>! Ready for a brand-new co-shuffled mystery?`,
      actionLabel: '↻ Start Next Mystery',
      onAction: () => openAndClaimFreshCaseTx(),
    });
    return;
  }

  if (hdr.phase === PHASE_LOBBY) {
    if (mySeat < 0) {
      noirGuide.updateCoach({
        pill: 'STEP 1 OF 3 • CO-SHUFFLE & JOIN',
        tone: 'urgent',
        html: '<strong>Claim an Operative Seat!</strong> Your browser generates a 16-gate <code>Bulletproofs R1CS</code> deck shuffle under the 5-Validator Threshold Key — nobody knows the Vault!',
        actionLabel: '⚡ Join, Co-Shuffle & Deal',
        onAction: () => claimSeatTx(0, true),
      });
    } else {
      noirGuide.updateCoach({
        pill: '⏳ SEATED IN LOBBY',
        tone: 'action',
        html: `You hold <strong>${seatLabel(mySeat)}</strong>. Wait for friends or kick off the 2-party ZK Co-Shuffle immediately!`,
      });
    }
    return;
  }

  if (hdr.phase === PHASE_SHUFFLING || hdr.phase === PHASE_DEALING) {
    noirGuide.updateCoach({
      pill: '🔀 THRESHOLD DEAL CEREMONY',
      tone: 'info',
      html: 'Independent co-shuffler &amp; 5 Subnet 1 validators are sealing the Case Vault and delivering DDH-blinded hand shares (~2s)…',
    });
    return;
  }

  if (mySeat < 0) {
    noirGuide.updateCoach({
      pill: '👀 SPECTATING CASE',
      tone: 'info',
      html: 'This Arbiter-Free ZK investigation is underway. Watch the live Bulletproofs wire, or open a fresh Sabotage Case to jump into Seat #1!',
      actionLabel: '↻ New Case & Play',
      onAction: () => openAndClaimFreshCaseTx(),
    });
    return;
  }

  if (myRec && myRec.revoked) {
    noirGuide.updateCoach({
      pill: '⚠️ CLEARANCE REVOKED',
      tone: 'target',
      html: 'Your prior indictment failed the 1-bit Threshold Zero-Check — you must still answer ZK Alibi checks when probed, or start a fresh case anytime.',
      actionLabel: '↻ Fresh Case',
      onAction: () => openAndClaimFreshCaseTx(),
    });
    return;
  }

  if (hdr.phase === PHASE_PROBE_PENDING && hdr.responderSeat === mySeat) {
    noirGuide.updateCoach({
      pill: '🔔 YOUR ZK PROOF NEEDED',
      tone: 'urgent',
      html: `<strong>${seatLabel(hdr.proberSeat)}</strong> probed your seat! Submit a <strong>1-of-3 ZK Whisper</strong> or a <strong>Bulletproofs R1CS No-Match Proof</strong> below.`,
    });
    return;
  }

  if (solvedLocally && (hdr.phase === PHASE_ACTIVE || hdr.phase === PHASE_PROBE_PENDING)) {
    noirGuide.updateCoach({
      pill: '🎯 VAULT CRACKED!',
      tone: 'urgent',
      html: `<strong>All 15 Alibis eliminated!</strong> Vault must be <strong>${DOSSIERS[remOps[0]].name}</strong> + <strong>${DOSSIERS[remExps[0]].name}</strong> + <strong>${DOSSIERS[remSecs[0]].name}</strong>!`,
      actionLabel: '⚖️ File Winning Indictment',
      onAction: () => {
        document.getElementById('selIndictOperative').value = String(remOps[0]);
        document.getElementById('selIndictExploit').value = String(remExps[0]);
        document.getElementById('selIndictSector').value = String(remSecs[0]);
        openIndictmentModal();
      },
    });
    return;
  }

  if (hdr.phase === PHASE_ACTIVE && hdr.turnSeat === mySeat) {
    noirGuide.updateCoach({
      pill: '🟢 YOUR TURN TO PROBE',
      tone: 'action',
      html: '<strong>1)</strong> Click a glowing <strong>Reachable Sector</strong> below &bull; <strong>2)</strong> Pick a Suspect &amp; Exploit (<code>🎯</code> = un-cleared) &bull; <strong>3)</strong> Click <strong>📡 Transmit Probe</strong>!',
      actionLabel: '📡 Transmit Probe',
      onAction: () => submitProbeTx(),
    });
    return;
  }

  noirGuide.updateCoach({
    pill: '📓 OBSERVE & DEDUCE',
    tone: 'info',
    html: `Waiting on <strong>${seatLabel(hdr.phase === PHASE_PROBE_PENDING ? hdr.responderSeat : hdr.turnSeat)}</strong>. Study the <strong>Deduction Matrix</strong> on the right (<code>${deduction.holderByDossier.size}/15</code> Alibis cleared so far).`,
  });
}

function renderAll() {
  if (!caseState) return;
  decryptLocalSecrets();
  const deduction = buildDeductionModel();
  renderPhaseAndResponder();
  renderBlueprintAndControls(deduction);
  renderDeductionMatrix(deduction);
  updateNoirCoach(deduction);
}

// ---------------------------------------------------------------------------
// On-Chain Reads & Zero-Knowledge Transactions
// ---------------------------------------------------------------------------

async function fetchActiveBeaconEpochPk() {
  if (!vrfBeaconAddr && contractAddr) {
    const bHex = await slxClient.callAbi(contractAddr, 'getVrfBeacon()', []).catch(() => null);
    if (bHex && bHex.length >= 66) {
      const a = decodeAddrWord(bHex, 0);
      if (a && a !== ZERO_ADDR) vrfBeaconAddr = a.toLowerCase();
    }
  }
  if (vrfBeaconAddr) {
    const epHex = await slxClient.callAbi(vrfBeaconAddr, 'getActiveEpochKey()', []);
    const epBytes = hexToBytes(epHex);
    if (epBytes.length >= 48) {
      return epBytes.slice(16, 48);
    }
  }
  if (caseState?.hdr?.epochPk?.length === 32) {
    return caseState.hdr.epochPk;
  }
  throw new Error('Active VRF Beacon Threshold Epoch key unavailable');
}

async function refreshCaseState() {
  if (!contractAddr) return;
  try {
    const cidHex = await slxClient.callAbi(contractAddr, 'getActiveCaseId()', []);
    if (cidHex && cidHex.length >= 66 && cidHex !== '0x' + '0'.repeat(64)) {
      const nextCid = cidHex.slice(0, 66).toLowerCase();
      if (activeCaseId !== nextCid) {
        activeCaseId = nextCid;
        manualNotes.clear();
      }
    }
    if (!activeCaseId) return;

    const rawHex = await slxClient.callAbi(contractAddr, 'getCaseState(bytes32)', [
      ['bytes32', activeCaseId],
    ]);
    const decoded = decodeNoirCaseState(rawHex);
    if (decoded) {
      caseState = decoded;
      renderAll();
      hydrateSeatNicknames(decoded.seats);
    }
  } catch (err) {
    console.warn('[CipherNoir] refreshCaseState warning:', err);
  }
}

async function sendNoirTx({ data, fnLabel, gasLimit = 4_500_000n, extraTargets = [] }) {
  const targets = [
    contractAddr,
    ...(vrfBeaconAddr ? [vrfBeaconAddr] : []),
    ...extraTargets,
  ].filter(Boolean);
  const res = await slxClient.sendAndConfirm({
    privateKey: wallet.keypair.privateKey,
    to: contractAddr,
    data,
    gasLimit,
    extraTargets: targets,
    label: fnLabel,
  });
  wallet.recordExternalRpcTx({
    txHash: res.txHash,
    rawTx: res.rawTx,
    from: res.senderAddr,
    to: contractAddr,
    contractLabel: 'CipherNoir',
    fnLabel,
    dataHex: data,
    blockNumber: Number(res.receipt?.blockNumber || 0),
    nonce: Number(res.nonce),
  });
  watcherHandle?.markReceiptSeen?.(res.receipt);
  return res;
}

async function claimSeatTx(preferredSeat = 0, dealNow = false) {
  if (txBusy || !contractAddr || !activeCaseId || !caseState) return;
  txBusy = true;
  renderAll();
  try {
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Cipher Noir' });
    const epochPk = caseState.hdr.epochPk;
    const secrets = deriveNoirSeatSecrets(
      wallet.keypair.privateKey,
      activeCaseId,
      wallet.keypair.address,
      epochPk
    );

    if (dealNow) {
      pushFeed(
        `⚡ Generating 16-gate <code>Bulletproofs R1CS</code> Deck Shuffle #1 &amp; claiming Seat…`,
        'whisper'
      );
      const shuf1 = proveNoirInitialShuffle(activeCaseId, epochPk);
      await sendNoirTx({
        fnLabel: 'openAndClaimCase',
        gasLimit: 6_500_000n,
        data: encodeAbi('openAndClaimCase(bytes32,uint64,address,bytes,uint64,bytes)', [
          ['bytes32', activeCaseId],
          ['uint64', preferredSeat],
          ['address', idRec?.identityAddr || ZERO_ADDR],
          ['bytes', secrets.seatKeyBlob],
          ['uint64', 1],
          ['bytes', shuf1],
        ]),
      });
    } else {
      pushFeed(`🕵️ Claiming Operative Seat with DDH/Pedersen Blinding PoKs…`, 'whisper');
      await sendNoirTx({
        fnLabel: 'claimOperativeSeat',
        gasLimit: 4_000_000n,
        data: encodeAbi('claimOperativeSeat(bytes32,uint64,address,bytes)', [
          ['bytes32', activeCaseId],
          ['uint64', preferredSeat],
          ['address', idRec?.identityAddr || ZERO_ADDR],
          ['bytes', secrets.seatKeyBlob],
        ]),
      });
    }
    await refreshCaseState();
  } catch (err) {
    pushFeed(`⚠️ Seat claim failed: ${err.message || err}`);
    await refreshCaseState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function openAndClaimFreshCaseTx() {
  if (txBusy || !contractAddr) return;
  txBusy = true;
  renderAll();
  try {
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Cipher Noir' });
    const epochPk = await fetchActiveBeaconEpochPk();
    const newCid = bytesToHex(concatBytes(utf8ToBytes('NOIR_CASE_'), randomBytes(22)));
    const secrets = deriveNoirSeatSecrets(
      wallet.keypair.privateKey,
      newCid,
      wallet.keypair.address,
      epochPk
    );
    pushFeed(
      `🔄 Opening Arbiter-Free Case &amp; proving 16-gate <code>Bulletproofs R1CS</code> Shuffle #1…`,
      'whisper'
    );
    const shuf1 = proveNoirInitialShuffle(newCid, epochPk);
    await sendNoirTx({
      fnLabel: 'openAndClaimCase',
      gasLimit: 6_800_000n,
      data: encodeAbi('openAndClaimCase(bytes32,uint64,address,bytes,uint64,bytes)', [
        ['bytes32', newCid],
        ['uint64', 0],
        ['address', idRec?.identityAddr || ZERO_ADDR],
        ['bytes', secrets.seatKeyBlob],
        ['uint64', 1],
        ['bytes', shuf1],
      ]),
    });
    activeCaseId = newCid.toLowerCase();
    manualNotes.clear();
    await refreshCaseState();
  } catch (err) {
    pushFeed(`⚠️ Could not open fresh case: ${err.message || err}`);
    await refreshCaseState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function requestDealTx() {
  if (txBusy || !contractAddr || !activeCaseId || !caseState) return;
  txBusy = true;
  renderAll();
  try {
    await refreshCaseState();
    if (caseState && caseState.hdr.phase >= PHASE_SHUFFLING) {
      pushFeed(`🔀 Co-Shuffle &amp; Threshold Deal ceremony already underway!`, 'whisper');
      return;
    }
    pushFeed(`🔀 Proving 16-gate <code>Bulletproofs R1CS</code> Deck Shuffle #1…`, 'whisper');
    const shuf1 = proveNoirInitialShuffle(activeCaseId, caseState.hdr.epochPk);
    await sendNoirTx({
      fnLabel: 'submitInitialShuffle',
      gasLimit: 6_000_000n,
      data: encodeAbi('submitInitialShuffle(bytes32,bytes)', [
        ['bytes32', activeCaseId],
        ['bytes', shuf1],
      ]),
    });
    await refreshCaseState();
  } catch (err) {
    await refreshCaseState();
    if (!caseState || caseState.hdr.phase === PHASE_LOBBY) {
      pushFeed(`⚠️ Shuffle start warning: ${err.message || err}`);
    }
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function submitProbeTx() {
  if (txBusy || !contractAddr || !activeCaseId) return;
  const op = Number(document.getElementById('selProbeOperative').value);
  const exp = Number(document.getElementById('selProbeExploit').value);
  const sec = Number(document.getElementById('selProbeSector').value);

  txBusy = true;
  renderAll();
  try {
    await sendNoirTx({
      fnLabel: 'submitForensicProbe',
      gasLimit: 3_000_000n,
      data: encodeAbi('submitForensicProbe(bytes32,uint64,uint64,uint64)', [
        ['bytes32', activeCaseId],
        ['uint64', op],
        ['uint64', exp],
        ['uint64', sec],
      ]),
    });
    await refreshCaseState();
  } catch (err) {
    pushFeed(`⚠️ Probe rejected: ${err.message || err}`);
    await refreshCaseState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function passAlibiTx() {
  if (txBusy || !contractAddr || !activeCaseId || !caseState || !mySeatSecrets) return;
  txBusy = true;
  renderAll();
  try {
    const mySeat = getMySeat();
    const curProbeIdx = Math.max(0, caseState.hdr.probeCount - 1);
    const cards3 = [0, 1, 2].map(
      (slot) => myDecryptedHand.find((h) => h.slot === slot)?.dossierId ?? 255
    );
    const r1csProof = proveNoirPassAlibi({
      caseId: activeCaseId,
      probeIdx: curProbeIdx,
      responderSeat: mySeat,
      cards3,
      wSk3: mySeatSecrets.wSk,
      probes3: [
        caseState.hdr.probeOperative,
        caseState.hdr.probeExploit,
        caseState.hdr.probeSector,
      ],
    });
    await sendNoirTx({
      fnLabel: 'passAlibiCheck',
      gasLimit: 3_500_000n,
      data: encodeAbi('passAlibiCheck(bytes32,bytes)', [
        ['bytes32', activeCaseId],
        ['bytes', r1csProof],
      ]),
    });
    await refreshCaseState();
  } catch (err) {
    pushFeed(`⚠️ Bulletproofs R1CS pass rejected: ${err.message || err}`);
    await refreshCaseState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function transmitWhisperTx(slotIdx) {
  if (txBusy || !contractAddr || !activeCaseId || !caseState || !mySeatSecrets) return;
  const card = myDecryptedHand.find((h) => h.slot === slotIdx);
  if (!card) return;

  const mySeat = getMySeat();
  const proberSeat = caseState.hdr.proberSeat;
  const proberRec = caseState.seats[proberSeat];
  const curProbeIdx = Math.max(0, caseState.hdr.probeCount - 1);

  txBusy = true;
  renderAll();
  try {
    const whisperProof = proveNoirWhisperOr3({
      caseId: activeCaseId,
      probeIdx: curProbeIdx,
      responderSeat: mySeat,
      proberSeat,
      slotIdx,
      card: card.dossierId,
      wBlind: mySeatSecrets.wSk[slotIdx],
      proberEdPk: proberRec.edPk,
      probes3: [
        caseState.hdr.probeOperative,
        caseState.hdr.probeExploit,
        caseState.hdr.probeSector,
      ],
    });
    await sendNoirTx({
      fnLabel: 'transmitAlibiProof',
      gasLimit: 3_500_000n,
      data: encodeAbi('transmitAlibiProof(bytes32,uint64,bytes)', [
        ['bytes32', activeCaseId],
        ['uint64', slotIdx],
        ['bytes', whisperProof],
      ]),
    });
    await refreshCaseState();
  } catch (err) {
    pushFeed(`⚠️ ZK Whisper failed: ${err.message || err}`);
    await refreshCaseState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

function openIndictmentModal() {
  if (!caseState) return;
  const { holderByDossier } = buildDeductionModel();

  const fillSelect = (elId, start, end) => {
    const el = document.getElementById(elId);
    let best = start;
    el.innerHTML = '';
    for (let id = start; id <= end; id++) {
      const held = holderByDossier.has(id);
      if (!held && holderByDossier.has(best)) best = id;
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = `${held ? '✕ Cleared: ' : '🎯 Suspect: '}${DOSSIERS[id].name}`;
      el.appendChild(opt);
    }
    el.value = String(best);
  };

  fillSelect('selIndictOperative', 0, 4);
  fillSelect('selIndictExploit', 5, 9);
  fillSelect('selIndictSector', 10, 17);

  const renderIndictPreview = () => {
    const box = document.getElementById('indictPreviewCards');
    if (!box) return;
    const ids = [
      Number(document.getElementById('selIndictOperative').value),
      Number(document.getElementById('selIndictExploit').value),
      Number(document.getElementById('selIndictSector').value),
    ];
    box.innerHTML = ids
      .map(
        (id) => `
        <div class="noir-mini-card">
          <img src="${dossierImg(id)}" alt="${DOSSIERS[id]?.name || ''}" />
          <div class="noir-mini-card-cap">${DOSSIERS[id]?.name || ''}</div>
        </div>`
      )
      .join('');
  };
  renderIndictPreview();
  document.getElementById('selIndictOperative').onchange = renderIndictPreview;
  document.getElementById('selIndictExploit').onchange = renderIndictPreview;
  document.getElementById('selIndictSector').onchange = renderIndictPreview;

  document.getElementById('indictModal').style.display = 'flex';
}

async function confirmIndictmentTx() {
  if (txBusy || !contractAddr || !activeCaseId || !caseState) return;
  const op = Number(document.getElementById('selIndictOperative').value);
  const exp = Number(document.getElementById('selIndictExploit').value);
  const sec = Number(document.getElementById('selIndictSector').value);
  document.getElementById('indictModal').style.display = 'none';

  txBusy = true;
  renderAll();
  try {
    pushFeed(
      `⚖️ Shielding Formal Indictment: <strong>[${DOSSIERS[op].name}, ${DOSSIERS[exp].name}, ${DOSSIERS[sec].name}]</strong>…`,
      'solved'
    );
    const delta0 = computeNoirIndictmentDelta0(
      activeCaseId,
      caseState.hdr.vaultCiphertexts,
      [op, exp, sec]
    );
    const blind1 = proveNoirIndictmentBlind({
      caseId: activeCaseId,
      stepTag: 1,
      epochPk: caseState.hdr.epochPk,
      deltaIn64: delta0,
    });
    await sendNoirTx({
      fnLabel: 'fileIndictment',
      gasLimit: 3_600_000n,
      data: encodeAbi('fileIndictment(bytes32,uint64,uint64,uint64,bytes)', [
        ['bytes32', activeCaseId],
        ['uint64', op],
        ['uint64', exp],
        ['uint64', sec],
        ['bytes', blind1],
      ]),
    });
    await refreshCaseState();
  } catch (err) {
    pushFeed(`⚠️ Indictment failed: ${err.message || err}`);
    await refreshCaseState();
  } finally {
    txBusy = false;
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// Real-Time WebSocket Subscription & Bootstrap
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
    onLog: (lg) => handleNoirLog(lg),
    onRefresh: async () => {
      await refreshCaseState();
    },
  });
}

async function selectTribunal(addr, fallbackCaseId) {
  contractAddr = String(addr || '').toLowerCase();
  vrfBeaconAddr = null;
  activeCaseId = fallbackCaseId ? String(fallbackCaseId).toLowerCase() : null;
  seenLogKeys.clear();
  manualNotes.clear();
  document.getElementById('forensicFeed').innerHTML = '';
  pushFeed(`📡 Connected to Arbiter-Free ZK Cipher Noir Tribunal <strong>${shortAddr(contractAddr)}</strong>.`);
  fetchActiveBeaconEpochPk().catch(() => {});
  bindLiveWatcher();
  await refreshCaseState();
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'cipher-noir',
    title: 'Cipher Noir: Syndicate Sabotage',
    subtitle:
      'Bulletproofs R1CS • 5-Validator Threshold Vault • DDH-Blinded Hands • 1-of-3 ZK Whispers • Zero Arbiter',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => contractAddr || '',
    getContractLabel: () => 'Cipher Noir',
    onWalletSwitch: () => refreshCaseState(),
    getAppPeers: () =>
      (caseState?.seats || [])
        .filter((st) => st?.occupied !== 0 && st?.identityAddr && st.identityAddr !== ZERO_ADDR)
        .map((st) => ({
          identityAddr: st.identityAddr,
          label: seatLabel(st.seat),
          role: `Tribunal Seat #${st.seat + 1} (${SEAT_CALLSIGNS[st.seat]})`,
        })),
    extraElements: [
      document.getElementById('btnFreshMystery'),
      document.getElementById('btnOpenIndictModal'),
      document.getElementById('btnNoirRules'),
    ],
  });

  document.getElementById('btnFreshMystery').addEventListener('click', openAndClaimFreshCaseTx);
  document.getElementById('btnSubmitProbe').addEventListener('click', submitProbeTx);
  document.getElementById('btnOpenIndictModal').addEventListener('click', openIndictmentModal);
  document.getElementById('btnCloseIndict').addEventListener('click', () => {
    document.getElementById('indictModal').style.display = 'none';
  });
  document.getElementById('btnCancelIndict').addEventListener('click', () => {
    document.getElementById('indictModal').style.display = 'none';
  });
  document.getElementById('btnConfirmIndict').addEventListener('click', confirmIndictmentTx);
  noirGuide = mountSlxGameGuide({
    gameId: 'cipher-noir',
    headerBtnEl: document.getElementById('btnNoirRules'),
    welcomeMountEl: document.getElementById('noirWelcomeMount'),
    coachMountEl: document.getElementById('noirCoachMount'),
    onWelcomePrimaryAction: () => {
      if (caseState?.hdr?.phase === PHASE_LOBBY && getMySeat() < 0) {
        claimSeatTx(0, true);
      }
    },
  });

  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  vrfBeaconAddr =
    manifest?.cipherNoir?.vrfBeaconAddr?.toLowerCase() ||
    manifest?.secretBallot?.vrfBeacon?.toLowerCase() ||
    null;
  const fallbackAddr = manifest?.cipherNoir?.contractAddr;
  const fallbackCid = manifest?.cipherNoir?.caseId;

  if (fallbackAddr) {
    await selectTribunal(fallbackAddr, fallbackCid);
    unifiedHdr?.refresh?.();
  }

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'CIPHER_NOIR',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => contractAddr || '',
    onSelectInstance: async (inst) => {
      await selectTribunal(inst.primaryAddr, inst.meta?.caseId || fallbackCid);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
