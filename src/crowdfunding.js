/**
 * SuperLexicon Board-Resolution-Activated Pre-Order Crowdfunding & IFRS Growth Budget UI (`src/crowdfunding.js`)
 *
 * Connected directly to the selected company's `AccountingLedger` -> `CorporateCharter` -> `Authorization`
 * (`POLICY_BOARD_RESOLUTION`):
 *
 *  - Step 1 (`proposeCampaign` + `initCharterAuth`): Locks campaign & stretch-budget terms in
 *    `STATE_PENDING_BOARD_RESOLUTION (1)` and triggers a `CorporateCharter` Board Resolution.
 *  - Step 2 (`approve` / `approveAndFinalize`): Directors deliberate and sign quorum on `Authorization`
 *    (any pre-order attempt prior to Board activation reverts with `ERR_AWAITING_BOARD_ACTIVATION = -26`).
 *  - Step 3 (`activateCrowdfundingCampaign` / `activateCampaign`): Consumes the passed Board Resolution
 *    and sets `STATE_LIVE (2)` on `Crowdfunding` HFS (`deadlineBlock = activatedAtBlock + durationBlocks`).
 *  - Step 4 (`finalizeCampaign` + `disburseUnlockedBudgetLine` OR `claimFullRefund`):
 *      * Goal met -> sweeps escrowed cash into `AccountingLedger` (`Dr 1010 Cash / Cr 2300 Contract
 *        Liabilities — IFRS 15`) and unlocks governed IFRS growth budget line items.
 *      * Goal missed -> `STATE_FAILED_REFUNDABLE (4)`: $0 charged on card holds and 100% escrow refunded.
 */

import {
  SlxInstSession,
  GOV_CONSTANTS,
  ZERO_ADDR,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
  shortAddr,
  fmtNum,
} from './slx-inst-suite.js';
import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  keccak256Hex,
  generateCheckoutVoucherBundle,
  computeExpectedSlxrEntitlement,
  CROWDFUNDING_MODE,
  CROWDFUNDING_STATE,
  PLEDGE_STATUS,
  GROWTH_BUDGET_CATEGORY_META,
  CrowdfundingAbi,
  AccountingCrowdfundingAbi,
  decodeCampaignSummaryHex,
  decodeBudgetTiersHex,
  decodeRewardSkusHex,
} from '@superlexicon/sdk';

const BYTECODE_STORE_ADDR = '0x0000000000000000000000000000000000000100';
const STORAGE_CF_MAP_KEY = 'slx_crowdfunding_campaigns_v2';
const STORAGE_CHARTER_RES_KEY = 'slx_gamified_charter_resolutions_v2';

const DEFAULT_REWARD_SKUS = [
  { skuIndex: 0, skuCode: 1, name: 'SLX-L1 USB/LoRa Mesh Node', unitPrice: 149, maxUnits: 2000, voucherTierBps: 15_000, soldUnits: 0 },
  { skuIndex: 1, skuCode: 2, name: 'SLX-V1 Handheld Validator', unitPrice: 299, maxUnits: 2000, voucherTierBps: 15_000, soldUnits: 0 },
  { skuIndex: 2, skuCode: 3, name: 'SLX-G1 HaLow + LoRa Gateway', unitPrice: 499, maxUnits: 1000, voucherTierBps: 15_000, soldUnits: 0 },
];

function defaultBudgetTiersForMode(mode, baseTarget = 150_000) {
  if (mode !== CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET) {
    return [
      {
        tierIndex: 0,
        threshold: baseTarget,
        budgetAllocation: Math.round(baseTarget * 0.8),
        ifrsCategory: 1,
        title: 'Base 500-Unit MOQ & Injection Tooling',
        spent: 0,
        unlocked: false,
      },
    ];
  }
  return [
    {
      tierIndex: 0,
      threshold: baseTarget,
      budgetAllocation: Math.round(baseTarget * 0.8),
      ifrsCategory: 1,
      title: 'Base 500-Unit MOQ & Injection Tooling',
      spent: 0,
      unlocked: false,
    },
    {
      tierIndex: 1,
      threshold: Math.max(baseTarget * 2, 300_000),
      budgetAllocation: 90_000,
      ifrsCategory: 4,
      title: 'FCC / CE / TELEC Global RF Certifications',
      spent: 0,
      unlocked: false,
    },
    {
      tierIndex: 2,
      threshold: Math.max(baseTarget * 4, 600_000),
      budgetAllocation: 180_000,
      ifrsCategory: 3,
      title: 'Automated High-Speed SMT & Shielding Line',
      spent: 0,
      unlocked: false,
    },
    {
      tierIndex: 3,
      threshold: Math.max(baseTarget * 6, 1_000_000),
      budgetAllocation: 250_000,
      ifrsCategory: 5,
      title: 'Global LoRa/HaLow Repeater Seed Fleet',
      spent: 0,
      unlocked: false,
    },
  ];
}

const companyCtx = {
  companyName: 'Nvidya Systems Pte. Ltd.',
  accountingLedger: ZERO_ADDR,
  corporateCharter: ZERO_ADDR,
  fiatLedger: ZERO_ADDR,
  treasuryIdentity: ZERO_ADDR,
  charterState: 2,
  directors: [], // [{ addr, label, consented }]
  myIsDirector: false,
  supportsAccountingCfActivate: false,
};

let activeBundle = generateCheckoutVoucherBundle();
let busy = false;

function createDraftState(mode = CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET) {
  return {
    isOnChain: false,
    crowdfundingAddr: '',
    boardAuthAddr: '',
    escrowIdentity: '',
    mode,
    state: CROWDFUNDING_STATE.UNINITIALIZED, // 0=Draft, 1=PENDING_BOARD_RESOLUTION, 2=LIVE, 3=SETTLED_SUCCEEDED, 4=FAILED_REFUNDABLE
    boardAuthStatus: 0, // 0=not created, 1=pending quorum, 2=finalized/passed, 4=consumed/enacted
    signedDirectors: new Set(),
    requiredBoardWeight: 1,
    accumBoardWeight: 0,
    title: 'SuperLexicon Wave 1 Hardware',
    baseTarget: 150_000,
    durationBlocks: 600,
    activatedAtBlock: 0,
    deadlineBlock: 0,
    currentBlock: 1_200,
    sweptToIfrs2300: 0,
    specHash: '0x' + '00'.repeat(32),
    activateActionHash: '0x' + '00'.repeat(32),
    skus: DEFAULT_REWARD_SKUS.map((s) => ({ ...s })),
    tiers: defaultBudgetTiersForMode(mode, 150_000),
    pledges: [],
    lastCalldataLabel: 'Step 1 Draft — Crowdfunding.proposeCampaign(...)',
    lastCalldataHex: '',
  };
}

let app = createDraftState(CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET);

function fmtUsd(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function showToast(msg, tone = 'info') {
  const el = document.getElementById('globalToast');
  if (!el) return;
  el.style.display = 'block';
  if (tone === 'err') {
    el.style.borderColor = 'rgba(244,63,94,0.65)';
    el.style.background = 'rgba(225,29,72,0.18)';
    el.style.color = '#fecdd3';
  } else if (tone === 'ok') {
    el.style.borderColor = 'rgba(52,211,153,0.65)';
    el.style.background = 'rgba(16,185,129,0.18)';
    el.style.color = '#d1fae5';
  } else {
    el.style.borderColor = 'rgba(56,189,248,0.5)';
    el.style.background = 'rgba(14,165,233,0.16)';
    el.style.color = '#e0f2fe';
  }
  el.textContent = msg;
}

function loadSavedCampaignForLedger(accAddr) {
  if (!accAddr || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_CF_MAP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[accAddr.toLowerCase()] || null;
  } catch (_) {
    return null;
  }
}

function saveCampaignForLedger(accAddr, record) {
  if (!accAddr || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_CF_MAP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[accAddr.toLowerCase()] = record;
    localStorage.setItem(STORAGE_CF_MAP_KEY, JSON.stringify(map));
  } catch (_) {}
}

function registerResolutionInCharterStore(chrAddr, resEntry) {
  if (!chrAddr || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_CHARTER_RES_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const key = chrAddr.toLowerCase();
    const list = Array.isArray(all[key]) ? all[key] : [];
    const filtered = list.filter((x) => (x.authAddr || '').toLowerCase() !== resEntry.authAddr.toLowerCase());
    filtered.unshift(resEntry);
    all[key] = filtered;
    localStorage.setItem(STORAGE_CHARTER_RES_KEY, JSON.stringify(all));
  } catch (_) {}
}

const session = new SlxInstSession({
  activePage: 'crowdfunding',
  title: 'Board-Activated Crowdfunding & IFRS Growth Budget HFS',
  subtitle: 'AccountingLedger ⟷ CorporateCharter (BOARD_RESOLUTION) ⟷ Crowdfunding (#26)',
  appTitle: 'Crowdfunding & IFRS Growth Budget',
  onRefresh: async () => {
    await hydrateCompanyAndLiveCampaign();
  },
});

async function hydrateCompanyAndLiveCampaign() {
  if (session.blockNumber > 0) {
    app.currentBlock = session.blockNumber;
  }
  const inst = session.inst;
  if (inst && session.online) {
    companyCtx.companyName = inst.companyName || 'Nvidya Systems Pte. Ltd.';
    companyCtx.accountingLedger = (inst.accountingLedger || ZERO_ADDR).toLowerCase();
    companyCtx.fiatLedger = (inst.fiatLedger || ZERO_ADDR).toLowerCase();
    companyCtx.treasuryIdentity = (inst.treasuryIdentity || ZERO_ADDR).toLowerCase();

    if (companyCtx.accountingLedger && companyCtx.accountingLedger !== ZERO_ADDR) {
      try {
        const [chrHex, bankHex, treasHex, cfProbeHex] = await Promise.all([
          session.ethCall(companyCtx.accountingLedger, encodeAbi('associatedCharter()')),
          session.ethCall(companyCtx.accountingLedger, encodeAbi('operatingBankLedger()')).catch(() => '0x'),
          session.ethCall(companyCtx.accountingLedger, encodeAbi('treasuryIdentity()')).catch(() => '0x'),
          session
            .ethCall(companyCtx.accountingLedger, AccountingCrowdfundingAbi.crowdfundingCampaignCount())
            .catch(() => null),
        ]);
        const chrAddr = decodeAddrWord(chrHex);
        if (chrAddr && chrAddr !== ZERO_ADDR) companyCtx.corporateCharter = chrAddr;
        else if (inst.corporateCharter) companyCtx.corporateCharter = inst.corporateCharter.toLowerCase();

        const bkAddr = decodeAddrWord(bankHex);
        if (bkAddr && bkAddr !== ZERO_ADDR) companyCtx.fiatLedger = bkAddr;
        const trAddr = decodeAddrWord(treasHex);
        if (trAddr && trAddr !== ZERO_ADDR) companyCtx.treasuryIdentity = trAddr;
        companyCtx.supportsAccountingCfActivate = Boolean(cfProbeHex && cfProbeHex !== '0x');
      } catch (_) {
        companyCtx.corporateCharter = (inst.corporateCharter || ZERO_ADDR).toLowerCase();
      }
    } else {
      companyCtx.corporateCharter = (inst.corporateCharter || ZERO_ADDR).toLowerCase();
    }

    // Hydrate Board of Directors from CorporateCharter
    if (companyCtx.corporateCharter && companyCtx.corporateCharter !== ZERO_ADDR) {
      try {
        const [stHex, dCntHex] = await Promise.all([
          session.ethCall(companyCtx.corporateCharter, encodeAbi('state()')),
          session.ethCall(companyCtx.corporateCharter, encodeAbi('directorCount()')),
        ]);
        companyCtx.charterState = decodeUintWord(stHex);
        const dCnt = Math.min(12, decodeUintWord(dCntHex));
        const dirs = [];
        for (let i = 0; i < dCnt; i++) {
          const dHex = await session.ethCall(
            companyCtx.corporateCharter,
            encodeAbi('directorAt(uint64)', [['uint64', i]])
          );
          const dAddr = decodeAddrWord(dHex);
          if (dAddr && dAddr !== ZERO_ADDR) {
            dirs.push({
              addr: dAddr,
              label: session.labelForIdentity(dAddr) || shortAddr(dAddr),
            });
          }
        }
        companyCtx.directors = dirs;
        const myId = (session.myIdentityAddr || '').toLowerCase();
        companyCtx.myIsDirector = Boolean(myId && dirs.some((d) => d.addr.toLowerCase() === myId));
      } catch (_) {}
    }

    // Auto-attach saved on-chain Crowdfunding HFS for this AccountingLedger if present
    const saved = loadSavedCampaignForLedger(companyCtx.accountingLedger);
    if (saved?.crowdfundingAddr && (!app.crowdfundingAddr || app.isOnChain)) {
      await syncFromOnChainCampaign(saved.crowdfundingAddr, { quiet: true, savedMeta: saved });
    }
  }

  if (!companyCtx.directors.length) {
    companyCtx.directors = [
      { addr: '0xd1000000000000000000000000000000000000d1', label: 'Founder Director #1' },
      { addr: '0xd2000000000000000000000000000000000000d2', label: 'Independent Director #2' },
    ];
  }

  refreshProposalCalldataPreview();
  renderAll();
}

async function syncFromOnChainCampaign(cfAddr, { quiet = false, savedMeta = null } = {}) {
  if (!cfAddr || !session.online) return false;
  try {
    const sumHex = await session.ethCall(cfAddr, CrowdfundingAbi.getCampaignSummary());
    if (!sumHex || sumHex === '0x' || sumHex.length < 642) {
      if (!quiet) showToast(`No initialized Crowdfunding HFS found at ${cfAddr}.`, 'err');
      return false;
    }
    const sum = decodeCampaignSummaryHex(sumHex);
    const [tiersHex, skusHex] = await Promise.all([
      session.ethCall(cfAddr, CrowdfundingAbi.getBudgetTiers()),
      session.ethCall(cfAddr, CrowdfundingAbi.getRewardSkus()),
    ]);

    app.isOnChain = true;
    app.crowdfundingAddr = cfAddr.toLowerCase();
    app.boardAuthAddr =
      sum.boardResolutionAuth !== ZERO_ADDR
        ? sum.boardResolutionAuth
        : (savedMeta?.boardAuthAddr || '').toLowerCase();
    app.escrowIdentity = sum.escrowIdentity !== ZERO_ADDR ? sum.escrowIdentity : '';
    app.state = sum.state;
    app.mode = sum.mode;
    app.title = sum.title || app.title;
    app.baseTarget = sum.baseTarget;
    app.durationBlocks = sum.durationBlocks;
    app.activatedAtBlock = sum.activatedAtBlock;
    app.deadlineBlock = sum.deadlineBlock;
    app.specHash = sum.specHash;
    app.activateActionHash = sum.activateActionHash;
    app.sweptToIfrs2300 = sum.sweptToTreasury ? sum.totalEscrowedOnChain : 0;
    app.tiers = decodeBudgetTiersHex(tiersHex);
    app.skus = decodeRewardSkusHex(skusHex);
    document.getElementById('inCrowdfundAddr').value = app.crowdfundingAddr;

    // Query live Authorization status & director signatures
    if (app.boardAuthAddr && app.boardAuthAddr !== ZERO_ADDR) {
      try {
        const [auStHex, wHex] = await Promise.all([
          session.ethCall(app.boardAuthAddr, encodeAbi('status()')),
          session.ethCall(app.boardAuthAddr, encodeAbi('stageWeight(uint64)', [['uint64', 0]])).catch(() => '0x'),
        ]);
        app.boardAuthStatus = decodeUintWord(auStHex);
        const wb = hexToBytes(wHex);
        if (wb.length >= 64) {
          app.accumBoardWeight = Number(BigInt(bytesToHex(wb.slice(0, 32))));
          const reqW = Number(BigInt(bytesToHex(wb.slice(32, 64))));
          app.requiredBoardWeight = reqW > 1_000_000 ? companyCtx.directors.length : Math.max(1, reqW);
        }
        const signed = new Set();
        for (const d of companyCtx.directors) {
          const apprHex = await session
            .ethCall(
              app.boardAuthAddr,
              encodeAbi('hasApproved(uint64,address)', [
                ['uint64', 0],
                ['address', d.addr],
              ])
            )
            .catch(() => '0x');
          if (decodeUintWord(apprHex) === 1) signed.add(d.addr.toLowerCase());
        }
        app.signedDirectors = signed;
      } catch (_) {}
    }

    // Hydrate pledges
    const pledges = [];
    const maxP = Math.min(32, sum.pledgeCount);
    for (let pid = 1; pid <= maxP; pid++) {
      try {
        const pHex = await session.ethCall(cfAddr, CrowdfundingAbi.getPledge(pid));
        const pb = hexToBytes(pHex);
        if (pb.length >= 128) {
          const rail = pb[56];
          const status = pb[57];
          const vIssued = pb[58] === 1;
          let amt = 0n;
          for (let k = 0; k < 8; k++) amt = (amt << 8n) | BigInt(pb[48 + k]);
          let qty = 0n;
          for (let k = 0; k < 8; k++) qty = (qty << 8n) | BigInt(pb[40 + k]);
          let skuIdx = 0n;
          for (let k = 0; k < 8; k++) skuIdx = (skuIdx << 8n) | BigInt(pb[32 + k]);
          pledges.push({
            id: pid,
            skuIndex: Number(skuIdx),
            quantity: Number(qty),
            amount: Number(amt),
            railLabel: rail === 1 ? 'On-Chain Escrow' : 'Oracle Card/Bank Hold',
            status,
            voucherIssued: vIssued,
          });
        }
      } catch (_) {}
    }
    app.pledges = pledges;

    if (!quiet) {
      showToast(
        `📡 Synced live on-chain Crowdfunding HFS "${app.title}" (State=${app.state}, Committed=${fmtUsd(
          sum.totalCommitted
        )})!`,
        'ok'
      );
    }
    renderAll();
    return true;
  } catch (err) {
    if (!quiet) showToast(`Sync note: ${err.message || err}`, 'err');
    return false;
  }
}

function recomputeDerived() {
  let totalCommitted = 0;
  let totalEscrowed = 0;
  let totalHold = 0;
  let totalCaptured = 0;

  for (const p of app.pledges) {
    if (p.status === PLEDGE_STATUS.REFUNDED_OR_VOIDED) continue;
    totalCommitted += p.amount;
    if (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN) totalEscrowed += p.amount;
    if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) totalHold += p.amount;
    if (p.status === PLEDGE_STATUS.FINALIZED_CAPTURED) totalCaptured += p.amount;
  }

  if (app.state === CROWDFUNDING_STATE.LIVE || app.state === CROWDFUNDING_STATE.SETTLED_SUCCEEDED) {
    for (const t of app.tiers) {
      if (totalCommitted >= t.threshold) t.unlocked = true;
    }
  } else if (app.state === CROWDFUNDING_STATE.FAILED_REFUNDABLE) {
    for (const t of app.tiers) t.unlocked = false;
  }

  const totalUnlockedBudget = app.tiers
    .filter((t) => t.unlocked)
    .reduce((acc, t) => acc + t.budgetAllocation, 0);
  const totalSpentBudget = app.tiers.reduce((acc, t) => acc + t.spent, 0);
  const realizedCash = totalEscrowed + totalCaptured;

  return {
    totalCommitted,
    totalEscrowed,
    totalHold,
    totalCaptured,
    realizedCash,
    totalUnlockedBudget,
    totalSpentBudget,
  };
}

function refreshProposalCalldataPreview() {
  if (app.state !== CROWDFUNDING_STATE.UNINITIALIZED) return;
  app.lastCalldataLabel = 'Step 1 Calldata — Crowdfunding.proposeCampaign(accountingLedger, …)';
  app.lastCalldataHex = CrowdfundingAbi.proposeCampaign({
    accountingLedger:
      companyCtx.accountingLedger !== ZERO_ADDR
        ? companyCtx.accountingLedger
        : '0xac000000000000000000000000000000000000ac',
    escrowIdentity: ZERO_ADDR,
    bankingOracle: '0x2222222222222222222222222222222222222222',
    campaignMode: app.mode,
    baseTarget: app.baseTarget,
    durationBlocks: app.durationBlocks,
    title: app.title,
    rewardSkus: app.skus,
    budgetTiers: app.tiers,
  });
}

function buildBoardResolutionScrollText() {
  const modeStr =
    app.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP
      ? `MODE 1 — Single-Target Hard-Cap (${fmtUsd(app.baseTarget)} ceiling; missed = $0 charged)`
      : app.mode === CROWDFUNDING_MODE.SINGLE_ALL_OR_NOTHING
      ? `MODE 2 — Single Minimum Target (${fmtUsd(app.baseTarget)} all-or-nothing; uncapped above goal)`
      : `MODE 3 — Multi-Tier Stretch-Goal IFRS Growth Budget (${app.tiers.length} ascending budget lines)`;
  const accTag =
    companyCtx.accountingLedger !== ZERO_ADDR ? shortAddr(companyCtx.accountingLedger) : '0xac00..00ac';
  const chrTag =
    companyCtx.corporateCharter !== ZERO_ADDR ? shortAddr(companyCtx.corporateCharter) : '0xc000..00c0';
  const cfTag = app.crowdfundingAddr ? shortAddr(app.crowdfundingAddr) : '<Pending Step 1 Deploy>';
  const authTag = app.boardAuthAddr ? shortAddr(app.boardAuthAddr) : '<Pending Step 1 Trigger>';
  const tierLines = app.tiers
    .map((t, idx) => {
      const meta = GROWTH_BUDGET_CATEGORY_META[t.ifrsCategory] || GROWTH_BUDGET_CATEGORY_META[1];
      return `     • Tier ${idx} (@ ${fmtUsd(t.threshold)}): Unlock ${fmtUsd(t.budgetAllocation)} → [${meta.code}] ${t.title}`;
    })
    .join('\n');

  return [
    `========================================================================`,
    `BOARD OF DIRECTORS RESOLUTION — PRE-ORDER CROWDFUNDING & GROWTH BUDGET`,
    `Company: ${companyCtx.companyName}  |  Charter: ${chrTag}  |  Policy: BOARD_RESOLUTION`,
    `========================================================================`,
    `1. LINKED IFRS ACCOUNTING LEDGER & CROWDFUNDING SUBROUTINE:`,
    `   • AccountingLedger HFS: ${accTag} (sweeps settled pre-orders -> 2300 Contract Liabilities)`,
    `   • Crowdfunding HFS:     ${cfTag}  |  Board Auth HFS: ${authTag}`,
    `   • Campaign Title:       "${app.title}"`,
    `   • Structure & Window:   ${modeStr} • ${fmtNum(app.durationBlocks)} blocks post-activation`,
    ``,
    `2. CODIFIED STRETCH-GOAL CORPORATE GROWTH BUDGET SCHEDULE:`,
    tierLines,
    ``,
    `IT IS HEREBY RESOLVED BY THE BOARD OF DIRECTORS THAT:`,
    `  (a) Upon quorum approval of ${authTag}, enacting this resolution transitions ${cfTag} from`,
    `      STATE_PENDING_BOARD_RESOLUTION (1) -> STATE_LIVE (2) and starts the ${fmtNum(app.durationBlocks)}-block window;`,
    `  (b) If ${fmtUsd(app.baseTarget)} is not reached by deadlineBlock, ZERO customer card holds shall be`,
    `      captured and 100% of on-chain escrowed pre-orders shall be refundable;`,
    `  (c) Upon reaching target, settled pre-order proceeds shall sweep into Account 2300 (Contract`,
    `      Liabilities — IFRS 15) on AccountingLedger ${accTag} and unlock the achieved budget tiers.`,
  ].join('\n');
}

function renderAll() {
  const d = recomputeDerived();

  // Header links
  const chrHref =
    companyCtx.corporateCharter !== ZERO_ADDR
      ? `/charter.html?hfs=${encodeURIComponent(companyCtx.corporateCharter)}`
      : '/charter.html';
  const accHref =
    companyCtx.accountingLedger !== ZERO_ADDR
      ? `/accounting.html?hfs=${encodeURIComponent(companyCtx.accountingLedger)}`
      : '/accounting.html';
  document.getElementById('lnkOpenCharter').href = chrHref;
  document.getElementById('lnkCharterInline').href = chrHref;
  document.getElementById('lnkOpenAccounting').href = accHref;
  document.getElementById('lnkAccInline').href = accHref;

  // 4-Contract Linkage Strip
  document.getElementById('lblCompanyName').textContent = companyCtx.companyName;
  document.getElementById('lblAccAddr').textContent =
    companyCtx.accountingLedger !== ZERO_ADDR ? shortAddr(companyCtx.accountingLedger) : 'Sandbox IFRS Ledger';
  document.getElementById('lblCharterInfo').textContent = `Board (${companyCtx.directors.length} Director${
    companyCtx.directors.length === 1 ? '' : 's'
  })`;
  document.getElementById('lblCharterAddr').textContent =
    companyCtx.corporateCharter !== ZERO_ADDR ? shortAddr(companyCtx.corporateCharter) : 'Sandbox Charter';
  document.getElementById('lblBoardCharterShort').textContent =
    companyCtx.corporateCharter !== ZERO_ADDR ? shortAddr(companyCtx.corporateCharter) : 'CorporateCharter';

  const tagAuth = document.getElementById('tagBoardAuthState');
  if (app.boardAuthStatus === 0) {
    tagAuth.className = 'cf-badge cf-badge-lock';
    tagAuth.textContent = 'NOT TRIGGERED';
    document.getElementById('lblBoardAuthAddr').textContent = 'Created at Step 1';
  } else if (app.boardAuthStatus === 1) {
    tagAuth.className = 'cf-badge cf-badge-hold';
    tagAuth.textContent = `VOTING (${app.accumBoardWeight}/${app.requiredBoardWeight})`;
    document.getElementById('lblBoardAuthAddr').textContent = shortAddr(app.boardAuthAddr);
  } else if (app.boardAuthStatus === 2) {
    tagAuth.className = 'cf-badge cf-badge-ok';
    tagAuth.textContent = 'PASSED • READY TO ENACT';
    document.getElementById('lblBoardAuthAddr').textContent = shortAddr(app.boardAuthAddr);
  } else {
    tagAuth.className = 'cf-badge cf-badge-ok';
    tagAuth.textContent = 'CONSUMED & ENACTED';
    document.getElementById('lblBoardAuthAddr').textContent = shortAddr(app.boardAuthAddr);
  }

  const tagCf = document.getElementById('tagCfHfsState');
  const pill = document.getElementById('cfStatePill');
  document.getElementById('lblCfTitle').textContent = app.title;
  document.getElementById('lblCfAddr').textContent = app.crowdfundingAddr
    ? shortAddr(app.crowdfundingAddr)
    : 'Awaiting Step 1';
  document.getElementById('lblCfExecMode').textContent = app.isOnChain ? '⛓️ Live Subnet 1' : '🧪 Guided Sandbox';

  if (app.state === CROWDFUNDING_STATE.UNINITIALIZED) {
    tagCf.className = 'cf-badge cf-badge-lock';
    tagCf.textContent = '0 • DRAFT';
    pill.className = 'cf-badge cf-badge-sky mono';
    pill.textContent = '📝 STEP 1: SPECIFY CAMPAIGN & TRIGGER BOARD RESOLUTION';
  } else if (app.state === CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION) {
    tagCf.className = 'cf-badge cf-badge-hold';
    tagCf.textContent = '1 • PENDING_BOARD_RESOLUTION';
    pill.className = 'cf-badge cf-badge-hold mono';
    pill.textContent =
      app.boardAuthStatus === 2
        ? '✅ BOARD PASSED → CLICK STEP 3 TO ACTIVATE LIVE'
        : '⚖️ STEP 2: AWAITING BOARD OF DIRECTORS QUORUM';
  } else if (app.state === CROWDFUNDING_STATE.LIVE) {
    tagCf.className = 'cf-badge cf-badge-ok';
    tagCf.textContent = '2 • STATE_LIVE';
    pill.className = 'cf-badge cf-badge-ok mono';
    pill.textContent = '🟢 STEP 3: CAMPAIGN LIVE (BOARD ENACTED)';
  } else if (app.state === CROWDFUNDING_STATE.SETTLED_SUCCEEDED) {
    tagCf.className = 'cf-badge cf-badge-ok';
    tagCf.textContent = '3 • SETTLED_SUCCEEDED';
    pill.className = 'cf-badge cf-badge-ok mono';
    pill.textContent = '🏆 STEP 4: SWEPT TO IFRS 2300 & GROWTH BUDGET UNLOCKED';
  } else {
    tagCf.className = 'cf-badge cf-badge-void';
    tagCf.textContent = '4 • FAILED_REFUNDABLE';
    pill.className = 'cf-badge cf-badge-void mono';
    pill.textContent = '🛡️ STEP 4: TARGET MISSED • $0 CHARGED (100% REFUNDABLE)';
  }

  // 4-Step Pipeline Highlighting
  const setStepUi = (n, cls, tagTxt) => {
    const c = document.getElementById(`stepCard${n}`);
    const t = document.getElementById(`stepTag${n}`);
    c.className = `cf-step ${cls}`;
    t.textContent = tagTxt;
  };
  if (app.state === CROWDFUNDING_STATE.UNINITIALIZED) {
    setStepUi(1, 'current', 'ACTIVE');
    setStepUi(2, '', 'LOCKED');
    setStepUi(3, '', 'LOCKED');
    setStepUi(4, '', 'LOCKED');
  } else if (app.state === CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION) {
    setStepUi(1, 'done', '✓ TRIGGERED');
    if (app.boardAuthStatus === 2) {
      setStepUi(2, 'done', '✓ PASSED');
      setStepUi(3, 'current', 'READY TO ENACT');
    } else {
      setStepUi(2, 'current', `${app.accumBoardWeight}/${app.requiredBoardWeight} SIGNED`);
      setStepUi(3, '', 'AWAITING QUORUM');
    }
    setStepUi(4, '', 'LOCKED');
  } else if (app.state === CROWDFUNDING_STATE.LIVE) {
    setStepUi(1, 'done', '✓ TRIGGERED');
    setStepUi(2, 'done', '✓ PASSED');
    setStepUi(3, 'current', '🟢 STATE_LIVE');
    setStepUi(4, '', d.totalCommitted >= app.baseTarget ? 'READY TO SETTLE' : 'AWAITING GOAL');
  } else {
    setStepUi(1, 'done', '✓ TRIGGERED');
    setStepUi(2, 'done', '✓ PASSED');
    setStepUi(3, 'done', '✓ COMPLETED');
    setStepUi(
      4,
      'done',
      app.state === CROWDFUNDING_STATE.SETTLED_SUCCEEDED ? '✓ SWEPT TO 2300' : '↩ 100% REFUNDABLE'
    );
  }

  // Mode Tabs
  document.querySelectorAll('.cf-mode-tab').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.mode) === app.mode);
    btn.disabled = app.state !== CROWDFUNDING_STATE.UNINITIALIZED;
  });
  document.getElementById('inCampTitle').disabled = app.state !== CROWDFUNDING_STATE.UNINITIALIZED;
  document.getElementById('inBaseTarget').disabled = app.state !== CROWDFUNDING_STATE.UNINITIALIZED;
  document.getElementById('inDurationBlocks').disabled = app.state !== CROWDFUNDING_STATE.UNINITIALIZED;
  document.getElementById('btnProposeOnChain').disabled =
    busy || app.state !== CROWDFUNDING_STATE.UNINITIALIZED;
  document.getElementById('btnProposeSandbox').disabled =
    busy || app.state !== CROWDFUNDING_STATE.UNINITIALIZED;

  // Board Roster & Resolution Controls
  const dirBox = document.getElementById('directorsRosterBox');
  dirBox.innerHTML = companyCtx.directors
    .map((dir) => {
      const signed = app.signedDirectors.has(dir.addr.toLowerCase()) || app.boardAuthStatus === 4;
      return `<div class="cf-dir-chip ${signed ? 'signed' : ''}">
        <span>${signed ? '✅' : '⏳'}</span>
        <span>${dir.label}</span>
        <span style="opacity:0.7;">(${shortAddr(dir.addr)})</span>
      </div>`;
    })
    .join('');

  const qBadge = document.getElementById('boardQuorumBadge');
  if (app.state === CROWDFUNDING_STATE.UNINITIALIZED) {
    qBadge.className = 'cf-badge cf-badge-lock';
    qBadge.textContent = 'Awaiting Step 1';
  } else if (app.state === CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION && app.boardAuthStatus < 2) {
    qBadge.className = 'cf-badge cf-badge-hold';
    qBadge.textContent = `Quorum: ${app.accumBoardWeight} / ${app.requiredBoardWeight} Director(s)`;
  } else if (app.state === CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION && app.boardAuthStatus === 2) {
    qBadge.className = 'cf-badge cf-badge-ok';
    qBadge.textContent = `Quorum Passed (${app.accumBoardWeight}/${app.requiredBoardWeight}) • Ready to Activate!`;
  } else {
    qBadge.className = 'cf-badge cf-badge-ok';
    qBadge.textContent = 'Enacted → STATE_LIVE';
  }

  document.getElementById('formalResolutionBox').textContent = buildBoardResolutionScrollText();

  document.getElementById('btnSignBoardRes').disabled =
    busy || app.state !== CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION || app.boardAuthStatus >= 2;
  document.getElementById('btnActivateLive').disabled =
    busy || app.state !== CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION || app.boardAuthStatus !== 2;
  document.getElementById('btnTestPreLiveGuard').disabled =
    busy || app.state !== CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION;

  // Checkout & Live Controls Gating
  const isLive = app.state === CROWDFUNDING_STATE.LIVE;
  const chkTag = document.getElementById('checkoutGateTag');
  if (isLive) {
    chkTag.className = 'cf-badge cf-badge-ok';
    chkTag.textContent = '🟢 STATE_LIVE • PRE-ORDERS OPEN';
  } else if (app.state === CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION) {
    chkTag.className = 'cf-badge cf-badge-hold';
    chkTag.textContent = '🔒 BLOCKED UNTIL BOARD ENACTS (-26)';
  } else {
    chkTag.className = 'cf-badge cf-badge-lock';
    chkTag.textContent = '🔒 LOCKED UNTIL STEP 3 LIVE';
  }

  document.getElementById('btnSubmitPledge').disabled = busy || !isLive;
  document.getElementById('btnSimWave').disabled = busy || !isLive;
  document.getElementById('btnFinalizeSuccess').disabled = busy || !isLive;
  document.getElementById('btnSimMissedDeadline').disabled = busy || !isLive;
  document.getElementById('btnDisburseBudget').disabled =
    busy || app.state !== CROWDFUNDING_STATE.SETTLED_SUCCEEDED;

  // KPIs
  const pct = app.baseTarget > 0 ? ((d.totalCommitted / app.baseTarget) * 100).toFixed(1) : '0.0';
  document.getElementById('kpiCommitted').textContent = fmtUsd(d.totalCommitted);
  document.getElementById('kpiCommittedSub').textContent =
    app.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP
      ? `Hard Cap: ${fmtUsd(app.baseTarget)} (${pct}% filled)`
      : `Base Target: ${fmtUsd(app.baseTarget)} (${pct}%)`;

  document.getElementById('kpiRailSplit').textContent = `${fmtUsd(d.realizedCash)} / ${fmtUsd(d.totalHold)}`;
  document.getElementById('kpiRailSub').textContent = 'Realized Cash vs. Uncharged Card Holds';

  const unlCnt = app.tiers.filter((t) => t.unlocked).length;
  document.getElementById('kpiBudgetUnlocked').textContent = fmtUsd(d.totalUnlockedBudget);
  document.getElementById('kpiBudgetSub').textContent = `${unlCnt} / ${app.tiers.length} IFRS budget lines unlocked • ${fmtUsd(
    d.totalSpentBudget
  )} spent`;

  if (app.activatedAtBlock > 0) {
    document.getElementById('kpiDeadline').textContent = `Blk #${fmtNum(app.currentBlock)} / #${fmtNum(
      app.deadlineBlock
    )}`;
    document.getElementById('kpiBackersSub').textContent = `Enacted @ #${fmtNum(
      app.activatedAtBlock
    )} • ${app.pledges.length} pledge(s)`;
  } else {
    document.getElementById('kpiDeadline').textContent = `${fmtNum(app.durationBlocks)} Blks Post-Board`;
    document.getElementById('kpiBackersSub').textContent = 'Clock starts only when Board Resolution activates!';
  }

  const sweepBadge = document.getElementById('ifrsSweepBadge');
  if (app.state === CROWDFUNDING_STATE.SETTLED_SUCCEEDED) {
    sweepBadge.className = 'cf-badge cf-badge-ok';
    sweepBadge.textContent = `2300 Contract Liabilities: ${fmtUsd(d.realizedCash)} Booked`;
  } else {
    sweepBadge.className = 'cf-badge cf-badge-lock';
    sweepBadge.textContent = '2300 Contract Liabilities: $0 (Sweeps on Step 4)';
  }

  // Thermometer
  const maxAxis = Math.max(app.baseTarget, ...app.tiers.map((t) => t.threshold), d.totalCommitted || 1);
  document.getElementById('thermoFill').style.width = `${Math.min(100, (d.totalCommitted / maxAxis) * 100)}%`;
  document.getElementById('thermoPins').innerHTML = app.tiers
    .map((t, idx) => {
      const leftPct = Math.min(97, Math.max(3, (t.threshold / maxAxis) * 100));
      return `<div class="cf-pin ${t.unlocked ? 'unlocked' : ''}" style="left:${leftPct}%;">
        <span>${t.unlocked ? '🔓' : '🔒'} T${idx}: ${fmtUsd(t.threshold)}</span>
        <span style="font-size:0.6rem;opacity:0.85;">+${fmtUsd(t.budgetAllocation)} IFRS</span>
      </div>`;
    })
    .join('');

  // SKU Selector
  const selSku = document.getElementById('selRewardSku');
  const prevSku = selSku.value || '1';
  selSku.innerHTML = app.skus
    .map(
      (s) =>
        `<option value="${s.skuIndex}">${s.name} — $${s.unitPrice} (${s.soldUnits}/${s.maxUnits} reserved)</option>`
    )
    .join('');
  if ([...selSku.options].some((o) => o.value === prevSku)) selSku.value = prevSku;
  renderOrderPreview();

  // Budget Tiers Table
  document.getElementById('budgetTiersTbody').innerHTML = app.tiers
    .map((t) => {
      const meta = GROWTH_BUDGET_CATEGORY_META[t.ifrsCategory] || GROWTH_BUDGET_CATEGORY_META[1];
      const rem = t.unlocked ? Math.max(0, t.budgetAllocation - t.spent) : 0;
      return `<tr>
        <td><strong>Tier ${t.tierIndex}</strong><br/><span style="color:#94a3b8;">@ ${fmtUsd(t.threshold)}</span></td>
        <td><strong>${t.title}</strong><br/><span style="color:#64748b;font-size:0.66rem;">Remaining: ${fmtUsd(rem)}</span></td>
        <td><span class="cf-badge cf-badge-sky">${meta.code}</span><br/><span style="font-size:0.62rem;color:#94a3b8;">${meta.ifrsAccount}</span></td>
        <td>${fmtUsd(t.budgetAllocation)}</td>
        <td>${fmtUsd(t.spent)}</td>
        <td>${
          t.unlocked
            ? '<span class="cf-badge cf-badge-ok">🔓 UNLOCKED</span>'
            : '<span class="cf-badge cf-badge-lock">🔒 LOCKED</span>'
        }</td>
      </tr>`;
    })
    .join('');

  const selDisb = document.getElementById('selDisburseTier');
  const prevDisb = selDisb.value || '0';
  selDisb.innerHTML = app.tiers
    .map(
      (t) =>
        `<option value="${t.tierIndex}">Tier ${t.tierIndex} (${t.unlocked ? 'UNLOCKED' : 'LOCKED'}): ${
          t.title
        } — Avail ${fmtUsd(t.unlocked ? t.budgetAllocation - t.spent : 0)}</option>`
    )
    .join('');
  if ([...selDisb.options].some((o) => o.value === prevDisb)) selDisb.value = prevDisb;

  // Pledges Table
  document.getElementById('pledgeSummaryTag').textContent = `${app.pledges.length} Pledge(s)`;
  const plgBody = document.getElementById('pledgesTbody');
  if (!app.pledges.length) {
    plgBody.innerHTML = `<tr><td colspan="6" style="color:#64748b;text-align:center;padding:16px;">${
      isLive
        ? 'Campaign is STATE_LIVE — commit a hardware pre-order on the left or click "Simulate Backer Wave".'
        : 'Pre-orders are locked until Step 1 (Proposal) → Step 2 (Board Vote) → Step 3 (Activate Resolution → LIVE) complete!'
    }</td></tr>`;
  } else {
    plgBody.innerHTML = app.pledges
      .slice()
      .reverse()
      .map((p) => {
        const sku = app.skus[p.skuIndex];
        let badge = '';
        if (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN) {
          badge = '<span class="cf-badge cf-badge-ok">ESCROWED L1</span>';
        } else if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) {
          badge = '<span class="cf-badge cf-badge-hold">CARD HOLD ($0 CHARGED)</span>';
        } else if (p.status === PLEDGE_STATUS.FINALIZED_CAPTURED) {
          badge = '<span class="cf-badge cf-badge-ok">BANK CAPTURED</span>';
        } else {
          badge = '<span class="cf-badge cf-badge-void">VOIDED / 100% REFUNDED</span>';
        }

        let actionHtml = '—';
        if (
          app.state === CROWDFUNDING_STATE.FAILED_REFUNDABLE &&
          (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN || p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE)
        ) {
          actionHtml = `<button type="button" class="cf-btn cf-btn-rose" style="padding:4px 8px;font-size:0.65rem;" data-refund-id="${p.id}">↩ Refund / Void</button>`;
        } else if (
          app.state === CROWDFUNDING_STATE.SETTLED_SUCCEEDED &&
          (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN || p.status === PLEDGE_STATUS.FINALIZED_CAPTURED) &&
          !p.voucherIssued
        ) {
          actionHtml = `<button type="button" class="cf-btn cf-btn-emerald" style="padding:4px 8px;font-size:0.65rem;" data-voucher-id="${p.id}">🎁 Issue SLXR Voucher</button>`;
        } else if (p.voucherIssued) {
          actionHtml = `<span style="color:#6ee7b7;font-size:0.67rem;">✓ Voucher Issued</span>`;
        }

        return `<tr>
          <td>#${p.id}</td>
          <td>${sku ? sku.name.split(' ')[0] : 'SKU'} × ${p.quantity}</td>
          <td>${fmtUsd(p.amount)}</td>
          <td>${p.railLabel}</td>
          <td>${badge}</td>
          <td>${actionHtml}</td>
        </tr>`;
      })
      .join('');
  }

  document.getElementById('lastCalldataBox').innerHTML =
    `<strong style="color:#7dd3fc;">${app.lastCalldataLabel}</strong><br/>` +
    `<span>${app.lastCalldataHex}</span>`;
}

function renderOrderPreview() {
  const skuIdx = Number(document.getElementById('selRewardSku').value || 0);
  const qty = Math.max(1, Number(document.getElementById('inQty').value || 1));
  const rail = document.getElementById('selPaymentRail').value;
  const sku = app.skus[skuIdx] || app.skus[0];
  const total = sku.unitPrice * qty;
  const slxr = computeExpectedSlxrEntitlement(sku.skuCode, sku.voucherTierBps, total);

  const railNote =
    rail === 'onchain_escrow'
      ? 'Escrowed on Subnet 1 ($0.00 gas); sweeps to AccountingLedger 2300 ONLY if goal met, otherwise 100% refundable.'
      : 'Card / PayNow pre-authorization hold via banking-oracle — $0.00 charged unless campaign hits target!';

  document.getElementById('orderCalcBox').innerHTML =
    `Order Total: <strong style="color:#f8fafc;">${fmtUsd(total)}</strong> (${qty} × $${sku.unitPrice})<br/>` +
    `90-Day Validator Reward: <strong style="color:#6ee7b7;">${slxr.toLocaleString()} SLXR</strong> (150% Early-Bird)<br/>` +
    `Blinded Commitment: <span style="color:#93c5fd;">${activeBundle.voucherCommitment.slice(0, 26)}…</span><br/>` +
    `<span style="color:#fde68a;">${railNote}</span>`;
}

function syncInputsIntoDraft() {
  if (app.state !== CROWDFUNDING_STATE.UNINITIALIZED) return;
  const newTitle = document.getElementById('inCampTitle').value.trim() || 'SuperLexicon Wave 1 Hardware';
  const newTarget = Math.max(1_000, Math.round(Number(document.getElementById('inBaseTarget').value || 150_000)));
  const newDur = Math.max(20, Math.round(Number(document.getElementById('inDurationBlocks').value || 600)));
  app.title = newTitle;
  if (newTarget !== app.baseTarget) {
    app.baseTarget = newTarget;
    app.tiers = defaultBudgetTiersForMode(app.mode, newTarget);
  }
  app.durationBlocks = newDur;
  refreshProposalCalldataPreview();
  renderAll();
}

// ---------------------------------------------------------------------------
// Step 1A: Live On-Chain Subnet 1 Deployment & Board Resolution Trigger
// ---------------------------------------------------------------------------
async function proposeCampaignOnChain() {
  if (busy) return;
  syncInputsIntoDraft();

  if (!session.online || companyCtx.accountingLedger === ZERO_ADDR || companyCtx.corporateCharter === ZERO_ADDR) {
    showToast(
      'Subnet 1 RPC not connected yet — launching Guided Sandbox mode instead (or connect to Subnet 1)!',
      'info'
    );
    proposeCampaignSandbox();
    return;
  }

  busy = true;
  renderAll();
  try {
    const myId = await session.ensureMyIdentity((m) => showToast(m, 'info'));
    if (!companyCtx.myIsDirector) {
      throw new Error(
        `Your wallet Identity (${shortAddr(myId)}) is not a Board Director of ${
          companyCtx.companyName
        }. Click "+ New" in the top IFRS Ledger selector to incorporate your own 1-Founder company in 3 blocks, or click "Trigger Board Resolution (Guided Sandbox)"!`
      );
    }

    showToast('Step 1.1: Uploading crowdfunding.wasm (40 KB) to Subnet 1 BYTECODE_STORE…', 'info');
    let resp = await fetch('/contracts/crowdfunding.wasm', { cache: 'no-store' });
    if (!resp.ok) resp = await fetch('/public/contracts/crowdfunding.wasm', { cache: 'no-store' });
    if (!resp.ok) throw new Error('Could not fetch /contracts/crowdfunding.wasm');
    const wasmBytes = new Uint8Array(await resp.arrayBuffer());
    const cfCodeHash = keccak256Hex(wasmBytes);

    await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: BYTECODE_STORE_ADDR,
      dataHex: cfCodeHash + bytesToHex(wasmBytes, false),
      label: 'storeBytecode(crowdfunding.wasm)',
      contractLabel: 'BytecodeStore',
      gasLimit: 9_000_000n,
    });

    showToast('Step 1.2: Instantiating Crowdfunding HFS + Board Resolution Authorization HFS…', 'info');
    const cfRcpt = await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: null,
      dataHex: cfCodeHash,
      label: 'instantiate(Crowdfunding)',
      contractLabel: 'Crowdfunding',
      gasLimit: 4_800_000n,
    });
    const newCfAddr = cfRcpt.contractAddress.toLowerCase();

    const authCodeHash = session.codeHashes?.authorization;
    if (!authCodeHash) throw new Error('Missing authorization.wasm codeHash in Subnet 1 manifest');
    const authRcpt = await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: null,
      dataHex: authCodeHash,
      label: 'instantiate(Authorization)',
      contractLabel: 'Authorization',
      gasLimit: 4_800_000n,
    });
    const newAuthAddr = authRcpt.contractAddress.toLowerCase();

    showToast(
      `Step 1.3: Linking Crowdfunding (${shortAddr(newCfAddr)}) -> AccountingLedger (${shortAddr(
        companyCtx.accountingLedger
      )}) -> CorporateCharter…`,
      'info'
    );
    const propInner = CrowdfundingAbi.proposeCampaign({
      accountingLedger: companyCtx.accountingLedger,
      escrowIdentity: ZERO_ADDR,
      rewardVoucherHfs: ZERO_ADDR,
      bankingOracle: myId,
      campaignMode: app.mode,
      baseTarget: app.baseTarget,
      durationBlocks: app.durationBlocks,
      title: app.title,
      rewardSkus: app.skus,
      budgetTiers: app.tiers,
    });
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', newCfAddr],
        ['bytes', hexToBytes(propInner)],
      ]),
      'Crowdfunding.proposeCampaign',
      'Crowdfunding',
      [newCfAddr, companyCtx.accountingLedger, companyCtx.corporateCharter]
    );

    // Fetch deterministic activation hash & initialize Board Resolution Authorization on CorporateCharter
    const useAccAct = companyCtx.supportsAccountingCfActivate;
    let actHashHex = '';
    let targetForAuth = newCfAddr;
    if (useAccAct) {
      const spHex = await session.ethCall(newCfAddr, CrowdfundingAbi.specHash());
      actHashHex = await session.ethCall(
        companyCtx.accountingLedger,
        AccountingCrowdfundingAbi.hashActivateCrowdfundingCampaign(newCfAddr, spHex.slice(0, 66))
      );
      targetForAuth = companyCtx.accountingLedger;
    } else {
      actHashHex = await session.ethCall(newCfAddr, CrowdfundingAbi.hashActivateCampaign());
      targetForAuth = newCfAddr;
    }

    showToast(
      `Step 1.4: Triggering BOARD_RESOLUTION (${shortAddr(newAuthAddr)}) on CorporateCharter…`,
      'info'
    );
    await session.sendAsMyIdentity(
      encodeAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
        ['address', newAuthAddr],
        ['address', session.inst.registry],
        ['address', companyCtx.corporateCharter],
        ['address', targetForAuth],
        ['bytes32', GOV_CONSTANTS.POLICY_BOARD_RESOLUTION],
        ['bytes32', actHashHex.slice(0, 66)],
      ]),
      'initCharterAuth(BOARD_RESOLUTION)',
      'Authorization',
      [newAuthAddr, companyCtx.corporateCharter, targetForAuth]
    );

    const bindInner = CrowdfundingAbi.bindBoardResolution(newAuthAddr);
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', newCfAddr],
        ['bytes', hexToBytes(bindInner)],
      ]),
      'Crowdfunding.bindBoardResolution',
      'Crowdfunding',
      [newCfAddr, newAuthAddr, companyCtx.corporateCharter]
    );

    const savedRec = {
      crowdfundingAddr: newCfAddr,
      boardAuthAddr: newAuthAddr,
      viaAccountingActivate: useAccAct,
    };
    saveCampaignForLedger(companyCtx.accountingLedger, savedRec);

    registerResolutionInCharterStore(companyCtx.corporateCharter, {
      id: `cf_res_${Date.now()}`,
      authAddr: newAuthAddr,
      title: `Board Resolution: Activate Crowdfunding "${app.title}" (${fmtUsd(app.baseTarget)})`,
      summary: `Transitions Crowdfunding HFS ${shortAddr(newCfAddr)} (linked to AccountingLedger ${shortAddr(
        companyCtx.accountingLedger
      )}) into STATE_LIVE (${app.durationBlocks} blocks) and ratifies ${app.tiers.length} IFRS stretch budget tier(s).`,
      category: 'Board Resolution • Pre-Order Crowdfunding',
      policyId: GOV_CONSTANTS.POLICY_BOARD_RESOLUTION,
      targetHps: targetForAuth,
      actionHash: actHashHex.slice(0, 66),
      execKind: 'crowdfundingCampaign',
      crowdfundingHps: newCfAddr,
      accountingLedger: companyCtx.accountingLedger,
      viaAccountingActivate: useAccAct,
      campaignMode: app.mode,
      baseTarget: app.baseTarget,
      durationBlocks: app.durationBlocks,
    });

    await syncFromOnChainCampaign(newCfAddr, { quiet: true, savedMeta: savedRec });
    showToast(
      `📜 Step 1 Complete on Subnet 1! Crowdfunding ${shortAddr(
        newCfAddr
      )} is in STATE_PENDING_BOARD_RESOLUTION (1) and Board Resolution ${shortAddr(
        newAuthAddr
      )} is live on CorporateCharter! Proceed to Step 2 to sign.`,
      'ok'
    );
  } catch (err) {
    showToast(`On-chain Step 1 note: ${err.message || err}`, 'err');
  } finally {
    busy = false;
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// Step 1B: Guided Sandbox Board Resolution Trigger
// ---------------------------------------------------------------------------
function proposeCampaignSandbox() {
  syncInputsIntoDraft();
  const nonceSeed = Date.now().toString();
  app.isOnChain = false;
  app.crowdfundingAddr = '0x' + keccak256Hex(utf8ToBytes('cf:' + nonceSeed)).slice(26);
  app.boardAuthAddr = '0x' + keccak256Hex(utf8ToBytes('auth:' + nonceSeed)).slice(26);
  app.specHash = keccak256Hex(utf8ToBytes(`spec:${app.title}:${app.mode}:${app.baseTarget}`));
  app.activateActionHash = keccak256Hex(utf8ToBytes(`act:${app.crowdfundingAddr}:${app.specHash}`));
  app.state = CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION;
  app.boardAuthStatus = 1;
  app.signedDirectors = new Set();
  app.accumBoardWeight = 0;
  app.requiredBoardWeight = Math.max(1, Math.ceil(companyCtx.directors.length / 2));
  document.getElementById('inCrowdfundAddr').value = app.crowdfundingAddr;

  app.lastCalldataLabel = `Step 1 Triggered — Crowdfunding.proposeCampaign + bindBoardResolution(${shortAddr(
    app.boardAuthAddr
  )})`;
  app.lastCalldataHex = CrowdfundingAbi.bindBoardResolution(app.boardAuthAddr);

  showToast(
    `📜 Step 1 Complete! Campaign locked in STATE_PENDING_BOARD_RESOLUTION (1) linked to AccountingLedger -> CorporateCharter, and Board Resolution ${shortAddr(
      app.boardAuthAddr
    )} triggered! Now sign as Director(s) in Step 2 (or test the -26 guard).`,
    'ok'
  );
  renderAll();
}

// ---------------------------------------------------------------------------
// Step 2: Board of Directors Quorum Signing & Pre-Activation Guard (-26) Test
// ---------------------------------------------------------------------------
async function signBoardResolutionStep2() {
  if (busy || app.state !== CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION) return;

  if (app.isOnChain && session.online) {
    busy = true;
    renderAll();
    try {
      await session.ensureMyIdentity((m) => showToast(m, 'info'));
      showToast(`Signing Board Resolution ${shortAddr(app.boardAuthAddr)} on CorporateCharter…`, 'info');
      await session.sendAsMyIdentity(
        encodeAbi('approveAndFinalizeAuth(address)', [['address', app.boardAuthAddr]]),
        'approveAndFinalizeAuth(BOARD_RESOLUTION)',
        'Authorization',
        [app.boardAuthAddr, companyCtx.corporateCharter]
      );
      await syncFromOnChainCampaign(app.crowdfundingAddr, { quiet: true });
      showToast(
        app.boardAuthStatus === 2
          ? `✅ Board Quorum Reached on ${shortAddr(
              app.boardAuthAddr
            )}! Click "Step 3: Enact Passed Resolution → Set Campaign LIVE" to open pre-orders!`
          : `✍️ Director signature recorded (${app.accumBoardWeight}/${app.requiredBoardWeight})! Awaiting remaining Board signatory.`,
        'ok'
      );
    } catch (err) {
      showToast(`Board signature error: ${err.message || err}`, 'err');
    } finally {
      busy = false;
      renderAll();
    }
    return;
  }

  // Sandbox signing
  const nextUnsigned = companyCtx.directors.find((d) => !app.signedDirectors.has(d.addr.toLowerCase()));
  if (nextUnsigned) {
    app.signedDirectors.add(nextUnsigned.addr.toLowerCase());
    app.accumBoardWeight = app.signedDirectors.size;
  }
  if (app.accumBoardWeight >= app.requiredBoardWeight) {
    app.boardAuthStatus = 2;
    app.lastCalldataLabel = `Step 2 Passed — Authorization.approveAndFinalize() on ${shortAddr(app.boardAuthAddr)}`;
    app.lastCalldataHex = encodeAbi('approveAndFinalizeAuth(address)', [['address', app.boardAuthAddr]]);
    showToast(
      `✅ Step 2 Board Quorum Reached (${app.accumBoardWeight}/${app.requiredBoardWeight} Directors signed)! Now click "Step 3: Enact Passed Resolution → Set Campaign LIVE"!`,
      'ok'
    );
  } else {
    showToast(
      `✍️ Signed by ${nextUnsigned?.label || 'Director'} (${app.accumBoardWeight}/${
        app.requiredBoardWeight
      }) — click Sign again for next Director to reach quorum.`,
      'info'
    );
  }
  renderAll();
}

async function testPreActivationGuard() {
  if (app.state !== CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION) return;
  const cd = CrowdfundingAbi.pledgeOnChain({
    skuIndex: 0,
    quantity: 1,
    voucherCommitment: activeBundle.voucherCommitment,
  });
  app.lastCalldataLabel = 'Guard Check — Crowdfunding.pledgeOnChain(...) BEFORE Board Enactment';
  app.lastCalldataHex = cd;

  if (app.isOnChain && session.online) {
    busy = true;
    renderAll();
    try {
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', app.crowdfundingAddr],
          ['bytes', hexToBytes(cd)],
        ]),
        'guardCheck:pledgeBeforeBoardActivation',
        'Crowdfunding',
        [app.crowdfundingAddr]
      );
    } catch (err) {
      showToast(
        `🛡️ Verified Wasmtime Guard (-26 ERR_AWAITING_BOARD_ACTIVATION)! Crowdfunding HFS rejected pre-orders prior to Board Resolution enactment (${err.message}).`,
        'ok'
      );
    } finally {
      busy = false;
      renderAll();
    }
    return;
  }

  showToast(
    '🛡️ Verified Guard ERR_AWAITING_BOARD_ACTIVATION (-26): Crowdfunding HFS is in STATE_PENDING_BOARD_RESOLUTION (1) and blocks all pre-orders until the Board Resolution is enacted in Step 3!',
    'ok'
  );
  renderAll();
}

// ---------------------------------------------------------------------------
// Step 3: Enact Passed Board Resolution -> Transition Crowdfunding to STATE_LIVE (2)
// ---------------------------------------------------------------------------
async function activatePassedResolutionStep3() {
  if (busy || app.state !== CROWDFUNDING_STATE.PENDING_BOARD_RESOLUTION || app.boardAuthStatus !== 2) return;

  if (app.isOnChain && session.online) {
    busy = true;
    renderAll();
    try {
      await session.ensureMyIdentity((m) => showToast(m, 'info'));
      const saved = loadSavedCampaignForLedger(companyCtx.accountingLedger);
      if (saved?.viaAccountingActivate) {
        showToast(
          `Enacting Board Resolution via AccountingLedger.activateCrowdfundingCampaign(${shortAddr(
            app.crowdfundingAddr
          )}, ${shortAddr(app.boardAuthAddr)})…`,
          'info'
        );
        const inner = AccountingCrowdfundingAbi.activateCrowdfundingCampaign(
          app.crowdfundingAddr,
          app.boardAuthAddr
        );
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [
            ['address', companyCtx.accountingLedger],
            ['bytes', hexToBytes(inner)],
          ]),
          'AccountingLedger.activateCrowdfundingCampaign',
          'AccountingLedger',
          [companyCtx.accountingLedger, companyCtx.corporateCharter, app.crowdfundingAddr, app.boardAuthAddr]
        );
      } else {
        showToast(
          `Enacting Board Resolution via Crowdfunding.activateCampaign(${shortAddr(app.boardAuthAddr)})…`,
          'info'
        );
        const inner = CrowdfundingAbi.activateCampaign(app.boardAuthAddr);
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [
            ['address', app.crowdfundingAddr],
            ['bytes', hexToBytes(inner)],
          ]),
          'Crowdfunding.activateCampaign',
          'Crowdfunding',
          [app.crowdfundingAddr, companyCtx.corporateCharter, app.boardAuthAddr]
        );
      }
      await syncFromOnChainCampaign(app.crowdfundingAddr, { quiet: true, savedMeta: saved });
      showToast(
        `🟢 Step 3 Enacted on Subnet 1! Board Authorization consumed and Crowdfunding HFS is now STATE_LIVE (2) through Block #${fmtNum(
          app.deadlineBlock
        )}!`,
        'ok'
      );
    } catch (err) {
      showToast(`Activation error: ${err.message || err}`, 'err');
    } finally {
      busy = false;
      renderAll();
    }
    return;
  }

  // Sandbox activation
  app.boardAuthStatus = 4; // CONSUMED
  app.state = CROWDFUNDING_STATE.LIVE;
  app.activatedAtBlock = app.currentBlock;
  app.deadlineBlock = app.activatedAtBlock + app.durationBlocks;
  app.lastCalldataLabel = `Step 3 Enacted — AccountingLedger.activateCrowdfundingCampaign(${shortAddr(
    app.crowdfundingAddr
  )}, ${shortAddr(app.boardAuthAddr)}) -> STATE_LIVE (2)`;
  app.lastCalldataHex = AccountingCrowdfundingAbi.activateCrowdfundingCampaign(
    app.crowdfundingAddr,
    app.boardAuthAddr
  );
  showToast(
    `🟢 Step 3 Enacted! Consumed Board Resolution ${shortAddr(
      app.boardAuthAddr
    )} and transitioned Crowdfunding HFS to STATE_LIVE (2) (Window: Block #${fmtNum(
      app.activatedAtBlock
    )} → #${fmtNum(app.deadlineBlock)})! Pre-orders are now open.`,
    'ok'
  );
  renderAll();
}

// ---------------------------------------------------------------------------
// Step 3 Live Pre-Order Execution & Step 4 Settlement / Budget Disbursement
// ---------------------------------------------------------------------------
async function submitPledge(skuIdx, qty, rail) {
  if (app.state !== CROWDFUNDING_STATE.LIVE) {
    showToast('ERR_CAMPAIGN_NOT_LIVE (-20): Campaign must be in STATE_LIVE (2).', 'err');
    return;
  }
  const sku = app.skus[skuIdx];
  if (sku.soldUnits + qty > sku.maxUnits) {
    showToast(`ERR_SKU_SOLD_OUT (-32): Exceeds ${sku.maxUnits} max units for ${sku.name}.`, 'err');
    return;
  }
  const amount = sku.unitPrice * qty;
  const dBefore = recomputeDerived();
  if (
    app.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP &&
    dBefore.totalCommitted + amount > app.baseTarget
  ) {
    showToast(
      `ERR_TARGET_CAP_EXCEEDED (-31): Hard-Cap Mode strictly blocks pre-orders above ${fmtUsd(
        app.baseTarget
      )} (remaining capacity: ${fmtUsd(app.baseTarget - dBefore.totalCommitted)}).`,
      'err'
    );
    return;
  }

  const refHash = keccak256Hex(utf8ToBytes(`pledge:${Date.now()}:${Math.random()}`));
  const isOnChainEscrow = rail === 'onchain_escrow';

  if (app.isOnChain && session.online) {
    busy = true;
    renderAll();
    try {
      await session.ensureMyIdentity((m) => showToast(m, 'info'));
      const inner = isOnChainEscrow
        ? CrowdfundingAbi.pledgeOnChain({
            skuIndex: skuIdx,
            quantity: qty,
            voucherCommitment: activeBundle.voucherCommitment,
          })
        : CrowdfundingAbi.recordOraclePreorderHold({
            paymentRefHash: refHash,
            skuIndex: skuIdx,
            quantity: qty,
            voucherCommitment: activeBundle.voucherCommitment,
          });
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', app.crowdfundingAddr],
          ['bytes', hexToBytes(inner)],
        ]),
        isOnChainEscrow ? 'Crowdfunding.pledgeOnChain' : 'Crowdfunding.recordOraclePreorderHold',
        'Crowdfunding',
        [app.crowdfundingAddr]
      );
      await syncFromOnChainCampaign(app.crowdfundingAddr, { quiet: true });
      showToast(`✅ Recorded on-chain pre-order (${fmtUsd(amount)}) on Subnet 1!`, 'ok');
    } catch (err) {
      showToast(`Pre-order error: ${err.message || err}`, 'err');
    } finally {
      busy = false;
      renderAll();
    }
    return;
  }

  const prevUnlocked = app.tiers.filter((t) => t.unlocked).length;
  sku.soldUnits += qty;
  const id = app.pledges.length + 1;
  app.pledges.push({
    id,
    skuIndex: skuIdx,
    quantity: qty,
    amount,
    railLabel:
      rail === 'onchain_escrow'
        ? 'On-Chain Escrow'
        : rail === 'ocbc_paynow'
        ? 'OCBC PayNow Hold'
        : 'Card Pre-Auth Hold',
    status: isOnChainEscrow ? PLEDGE_STATUS.ESCROWED_ONCHAIN : PLEDGE_STATUS.PREAUTH_HOLD_ORACLE,
    paymentRefHash: refHash,
    voucherCommitment: activeBundle.voucherCommitment,
    voucherIssued: false,
  });

  app.lastCalldataLabel = isOnChainEscrow
    ? `Crowdfunding.pledgeOnChain(sku=${skuIdx}, qty=${qty})`
    : `Crowdfunding.recordOraclePreorderHold(sku=${skuIdx}, qty=${qty})`;
  app.lastCalldataHex = isOnChainEscrow
    ? CrowdfundingAbi.pledgeOnChain({
        skuIndex: skuIdx,
        quantity: qty,
        voucherCommitment: activeBundle.voucherCommitment,
      })
    : CrowdfundingAbi.recordOraclePreorderHold({
        paymentRefHash: refHash,
        skuIndex: skuIdx,
        quantity: qty,
        voucherCommitment: activeBundle.voucherCommitment,
      });

  const dAfter = recomputeDerived();
  const nowUnlocked = app.tiers.filter((t) => t.unlocked).length;
  if (nowUnlocked > prevUnlocked) {
    const newest = app.tiers.filter((t) => t.unlocked).slice(-1)[0];
    showToast(
      `🎉 Pre-Order #${id} (${fmtUsd(amount)}) UNLOCKED Stretch Tier ${newest.tierIndex}: "${
        newest.title
      }" (+${fmtUsd(newest.budgetAllocation)} in company IFRS growth budget)!`,
      'ok'
    );
  } else {
    showToast(
      `Recorded Pre-Order #${id} (${fmtUsd(amount)}) — Total Committed: ${fmtUsd(dAfter.totalCommitted)}.`,
      'ok'
    );
  }
  renderAll();
}

// Event Listeners
document.querySelectorAll('.cf-mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (app.state !== CROWDFUNDING_STATE.UNINITIALIZED) return;
    const m = Number(btn.dataset.mode);
    app.mode = m;
    app.tiers = defaultBudgetTiersForMode(m, app.baseTarget);
    refreshProposalCalldataPreview();
    renderAll();
  });
});

document.getElementById('inCampTitle').addEventListener('input', syncInputsIntoDraft);
document.getElementById('inBaseTarget').addEventListener('input', syncInputsIntoDraft);
document.getElementById('inDurationBlocks').addEventListener('input', syncInputsIntoDraft);

document.getElementById('btnResetDraft').addEventListener('click', () => {
  activeBundle = generateCheckoutVoucherBundle();
  app = createDraftState(app.mode);
  if (session.blockNumber > 0) app.currentBlock = session.blockNumber;
  refreshProposalCalldataPreview();
  showToast('Reset to Step 1 Draft — configure campaign details and trigger a fresh Board Resolution.', 'info');
  renderAll();
});

document.getElementById('btnProposeOnChain').addEventListener('click', proposeCampaignOnChain);
document.getElementById('btnProposeSandbox').addEventListener('click', proposeCampaignSandbox);
document.getElementById('btnSignBoardRes').addEventListener('click', signBoardResolutionStep2);
document.getElementById('btnTestPreLiveGuard').addEventListener('click', testPreActivationGuard);
document.getElementById('btnActivateLive').addEventListener('click', activatePassedResolutionStep3);

document.getElementById('selRewardSku').addEventListener('change', renderOrderPreview);
document.getElementById('inQty').addEventListener('input', renderOrderPreview);
document.getElementById('selPaymentRail').addEventListener('change', renderOrderPreview);

document.getElementById('btnSubmitPledge').addEventListener('click', () => {
  const skuIdx = Number(document.getElementById('selRewardSku').value || 0);
  const qty = Math.max(1, Number(document.getElementById('inQty').value || 1));
  const rail = document.getElementById('selPaymentRail').value;
  submitPledge(skuIdx, qty, rail);
});

document.getElementById('btnDownloadVoucher').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(activeBundle, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `slxr-crowdfund-voucher-${activeBundle.voucherCommitment.slice(2, 10)}.json`;
  a.click();
  showToast('Downloaded blinded SLXR voucher secret bundle locally.', 'ok');
});

document.getElementById('btnSimWave').addEventListener('click', () => {
  if (app.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP) {
    const d = recomputeDerived();
    const rem = app.baseTarget - d.totalCommitted;
    if (rem <= 0) {
      showToast(`ERR_TARGET_CAP_EXCEEDED (-31): Hard-Cap target (${fmtUsd(app.baseTarget)}) is 100% full!`, 'err');
      return;
    }
    const unitPrice = app.skus[1].unitPrice;
    const maxFit = Math.max(1, Math.floor(Math.min(75_000, rem) / unitPrice));
    submitPledge(1, maxFit, 'oracle_card_hold');
  } else {
    submitPledge(2, 250, 'oracle_card_hold'); // 250 x $499 = $124,750
  }
});

document.getElementById('btnFinalizeSuccess').addEventListener('click', async () => {
  const d = recomputeDerived();
  if (d.totalCommitted < app.baseTarget) {
    showToast(
      `Cannot settle as SUCCEEDED yet: ${fmtUsd(d.totalCommitted)} committed < ${fmtUsd(
        app.baseTarget
      )} Base Target!`,
      'err'
    );
    return;
  }

  if (app.isOnChain && session.online) {
    busy = true;
    renderAll();
    try {
      const finInner = CrowdfundingAbi.finalizeCampaign();
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', app.crowdfundingAddr],
          ['bytes', hexToBytes(finInner)],
        ]),
        'Crowdfunding.finalizeCampaign',
        'Crowdfunding',
        [app.crowdfundingAddr, companyCtx.accountingLedger]
      );
      for (const p of app.pledges) {
        if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) {
          const capInner = CrowdfundingAbi.confirmOracleHoldCaptured(p.id);
          await session.sendAsMyIdentity(
            encodeAbi('execute(address,bytes)', [
              ['address', app.crowdfundingAddr],
              ['bytes', hexToBytes(capInner)],
            ]),
            `confirmOracleHoldCaptured(#${p.id})`,
            'Crowdfunding',
            [app.crowdfundingAddr]
          );
        }
      }
      await syncFromOnChainCampaign(app.crowdfundingAddr, { quiet: true });
      showToast(
        `🏆 Campaign Settled on Subnet 1! Proceeds swept to AccountingLedger (2300 Contract Liabilities) & ${
          app.tiers.filter((t) => t.unlocked).length
        } IFRS budget tiers unlocked!`,
        'ok'
      );
    } catch (err) {
      showToast(`Finalize error: ${err.message || err}`, 'err');
    } finally {
      busy = false;
      renderAll();
    }
    return;
  }

  app.state = CROWDFUNDING_STATE.SETTLED_SUCCEEDED;
  for (const p of app.pledges) {
    if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) {
      p.status = PLEDGE_STATUS.FINALIZED_CAPTURED;
    }
  }
  const dAfter = recomputeDerived();
  app.sweptToIfrs2300 = dAfter.realizedCash;
  app.lastCalldataLabel =
    'Step 4A — Crowdfunding.finalizeCampaign() -> Sweeps Dr 1010 Cash / Cr 2300 Contract Liabilities on AccountingLedger';
  app.lastCalldataHex = CrowdfundingAbi.finalizeCampaign();
  showToast(
    `🏆 Step 4A Complete! Captured pre-auth holds, swept ${fmtUsd(
      dAfter.realizedCash
    )} into AccountingLedger Account 2300 (Contract Liabilities — IFRS 15), and unlocked ${fmtUsd(
      dAfter.totalUnlockedBudget
    )} across ${app.tiers.filter((t) => t.unlocked).length} corporate growth budget line(s)!`,
    'ok'
  );
  renderAll();
});

document.getElementById('btnSimMissedDeadline').addEventListener('click', () => {
  const d = recomputeDerived();
  if (d.totalCommitted >= app.baseTarget) {
    showToast(
      `Target (${fmtUsd(app.baseTarget)}) is already met (${fmtUsd(
        d.totalCommitted
      )})! Click "New Campaign Draft" to test a below-target missed deadline.`,
      'info'
    );
    return;
  }
  app.currentBlock = app.deadlineBlock + 1;
  app.state = CROWDFUNDING_STATE.FAILED_REFUNDABLE;
  for (const p of app.pledges) {
    if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) {
      p.status = PLEDGE_STATUS.REFUNDED_OR_VOIDED;
    }
  }
  app.lastCalldataLabel = 'Step 4B — Crowdfunding.finalizeCampaign() -> STATE_FAILED_REFUNDABLE (4)';
  app.lastCalldataHex = CrowdfundingAbi.finalizeCampaign();
  showToast(
    `🛡️ Deadline passed below ${fmtUsd(
      app.baseTarget
    )} target: ZERO credit cards were charged (holds voided), $0 touched AccountingLedger, and 100% of on-chain escrow is refundable!`,
    'err'
  );
  renderAll();
});

document.getElementById('btnAddStretchTier').addEventListener('click', () => {
  if (app.state !== CROWDFUNDING_STATE.UNINITIALIZED) {
    showToast('Budget tiers are locked once the Board Resolution is triggered!', 'err');
    return;
  }
  if (app.mode !== CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET) {
    showToast('Select Mode 3 (Stretch Budget) to append multi-tier IFRS budget line items.', 'err');
    return;
  }
  const target = Math.round(Number(document.getElementById('inNewTierTarget').value || 0));
  const alloc = Math.round(Number(document.getElementById('inNewTierAlloc').value || 0));
  const cat = Number(document.getElementById('selNewTierCat').value || 2);
  const title = document.getElementById('inNewTierTitle').value.trim() || 'Custom Growth Line';
  const last = app.tiers[app.tiers.length - 1];
  const cumAlloc = app.tiers.reduce((a, t) => a + t.budgetAllocation, 0) + alloc;

  if (target <= last.threshold) {
    showToast(`Stretch target must exceed previous tier (${fmtUsd(last.threshold)}).`, 'err');
    return;
  }
  if (alloc <= 0 || cumAlloc > target) {
    showToast(`Cumulative budget (${fmtUsd(cumAlloc)}) cannot exceed stretch target (${fmtUsd(target)}).`, 'err');
    return;
  }

  app.tiers.push({
    tierIndex: app.tiers.length,
    threshold: target,
    budgetAllocation: alloc,
    ifrsCategory: cat,
    title,
    spent: 0,
    unlocked: false,
  });
  refreshProposalCalldataPreview();
  showToast(`Appended Stretch Tier ${app.tiers.length - 1} (@ ${fmtUsd(target)} -> +${fmtUsd(alloc)} "${title}").`, 'ok');
  renderAll();
});

document.getElementById('btnDisburseBudget').addEventListener('click', async () => {
  if (app.state !== CROWDFUNDING_STATE.SETTLED_SUCCEEDED) {
    showToast('ERR_CAMPAIGN_NOT_SUCCEEDED (-24): Settle campaign first!', 'err');
    return;
  }
  const tierIdx = Number(document.getElementById('selDisburseTier').value || 0);
  const amount = Math.round(Number(document.getElementById('inDisburseUsd').value || 0));
  const vendor = document.getElementById('inVendorAddr').value.trim();
  const tier = app.tiers[tierIdx];

  if (!tier || !tier.unlocked) {
    showToast(
      `ERR_BUDGET_TIER_LOCKED (-40): Stretch Tier ${tierIdx} ("${tier?.title}") was NOT reached — budget line remains locked!`,
      'err'
    );
    return;
  }
  if (amount <= 0 || tier.spent + amount > tier.budgetAllocation) {
    showToast(
      `ERR_BUDGET_LINE_EXCEEDED (-41): Requested ${fmtUsd(amount)} exceeds Tier ${tierIdx} remaining allocation (${fmtUsd(
        tier.budgetAllocation - tier.spent
      )})!`,
      'err'
    );
    return;
  }
  const d = recomputeDerived();
  if (d.totalSpentBudget + amount > d.realizedCash) {
    showToast('ERR_INSUFFICIENT_REALIZED_CASH (-42): Exceeds realized cash pool!', 'err');
    return;
  }

  const expRef = keccak256Hex(utf8ToBytes(`DISB:${tierIdx}:${Date.now()}`));
  const cd = CrowdfundingAbi.disburseUnlockedBudgetLine({
    tierIndex: tierIdx,
    vendorIdentity: vendor,
    amount,
    expenseRefHash: expRef,
    authHps: ZERO_ADDR,
  });

  if (app.isOnChain && session.online) {
    busy = true;
    renderAll();
    try {
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', app.crowdfundingAddr],
          ['bytes', hexToBytes(cd)],
        ]),
        'Crowdfunding.disburseUnlockedBudgetLine',
        'Crowdfunding',
        [app.crowdfundingAddr, companyCtx.accountingLedger, vendor]
      );
      await syncFromOnChainCampaign(app.crowdfundingAddr, { quiet: true });
      showToast(`✅ Disbursed ${fmtUsd(amount)} from Tier ${tierIdx} on Subnet 1!`, 'ok');
    } catch (err) {
      showToast(`Disbursement error: ${err.message || err}`, 'err');
    } finally {
      busy = false;
      renderAll();
    }
    return;
  }

  tier.spent += amount;
  const meta = GROWTH_BUDGET_CATEGORY_META[tier.ifrsCategory] || GROWTH_BUDGET_CATEGORY_META[1];
  app.lastCalldataLabel = `Crowdfunding.disburseUnlockedBudgetLine(tier=${tierIdx}, amt=${amount}) -> AccountingLedger [${meta.code}]`;
  app.lastCalldataHex = cd;
  showToast(
    `✅ Disbursed ${fmtUsd(amount)} from unlocked Tier ${tierIdx} ("${tier.title}") -> posted [${
      meta.ifrsAccount
    }] on AccountingLedger!`,
    'ok'
  );
  renderAll();
});

document.getElementById('pledgesTbody').addEventListener('click', async (e) => {
  const refBtn = e.target.closest('[data-refund-id]');
  if (refBtn) {
    const id = Number(refBtn.dataset.refundId);
    const p = app.pledges.find((x) => x.id === id);
    if (p) {
      p.status = PLEDGE_STATUS.REFUNDED_OR_VOIDED;
      app.lastCalldataLabel = `Crowdfunding.claimFullRefund(pledgeId=${id})`;
      app.lastCalldataHex = CrowdfundingAbi.claimFullRefund(id);
      showToast(`↩ Refunded 100% (${fmtUsd(p.amount)}) on Pledge #${id}.`, 'ok');
      renderAll();
    }
    return;
  }

  const vchBtn = e.target.closest('[data-voucher-id]');
  if (vchBtn) {
    const id = Number(vchBtn.dataset.voucherId);
    const p = app.pledges.find((x) => x.id === id);
    if (p) {
      p.voucherIssued = true;
      app.lastCalldataLabel = `Crowdfunding.issueBackerVoucher(pledgeId=${id})`;
      app.lastCalldataHex = CrowdfundingAbi.issueBackerVoucher(id);
      showToast(`🎁 Issued blinded 90-day SLXR PaidVoucher on RewardVoucher HFS for Pledge #${id}!`, 'ok');
      renderAll();
    }
  }
});

document.getElementById('btnSyncLiveRpc').addEventListener('click', async () => {
  const addr = document.getElementById('inCrowdfundAddr').value.trim();
  if (!addr) {
    showToast('Enter a deployed Crowdfunding HFS address (or run Step 1 On-Chain Deploy).', 'info');
    return;
  }
  await syncFromOnChainCampaign(addr, { quiet: false });
});

refreshProposalCalldataPreview();
renderAll();
await session.boot();
