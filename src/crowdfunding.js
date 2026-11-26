/**
 * SuperLexicon Milestone Crowdfunding & Stretch-Goal Corporate Growth Budget UI (`src/crowdfunding.js`)
 *
 * Interactive client & deterministic simulator for `crowdfunding.wasm` (HPS #26):
 *  - Mode 1 (`SINGLE_HARD_CAP`): Hard-caps pre-orders at `baseTarget`; if missed at deadline, no-one is charged.
 *  - Mode 2 (`SINGLE_ALL_OR_NOTHING`): Minimum target all-or-nothing, uncapped pre-orders above target.
 *  - Mode 3 (`MULTI_TIER_GROWTH_BUDGET`): Stretch goals automatically unlock ring-fenced line items in the
 *    company's codified IFRS growth budget (`1020-MOQ`, `6300-CERT`, `1600-CAPEX`, `6200-GROWTH`, `6100-RND`).
 */

import {
  SlxWalletManager,
  keccak256Hex,
  utf8ToBytes,
  bytesToHex,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  generateCheckoutVoucherBundle,
  computeExpectedSlxrEntitlement,
  CROWDFUNDING_MODE,
  CROWDFUNDING_STATE,
  PLEDGE_STATUS,
  GROWTH_BUDGET_CATEGORY_META,
  CrowdfundingAbi,
  decodeCampaignSummaryHex,
  decodeBudgetTiersHex,
  decodeRewardSkusHex,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';

const wallet = new SlxWalletManager();
if (typeof window !== 'undefined') {
  window.__SLX_WALLET__ = wallet;
}

mountSlxUnifiedHeader({
  mountContainer: document.getElementById('slxUnifiedHeaderMount'),
  activeAppId: 'crowdfunding',
  title: 'Milestone Crowdfunding & Corporate Growth Budget HFS',
  subtitle: 'All-or-Nothing Pre-Order Escrow • Hard-Cap MOQ Protection • Auto-Unlocked IFRS Growth Budget Tiers',
  wallet,
});

const DEFAULT_REWARD_SKUS = [
  { skuIndex: 0, skuCode: 1, name: 'SLX-L1 USB/LoRa Mesh Node', unitPriceUsd: 149, maxUnits: 2000, voucherTierBps: 15_000, soldUnits: 0 },
  { skuIndex: 1, skuCode: 2, name: 'SLX-V1 Handheld Validator', unitPriceUsd: 299, maxUnits: 2000, voucherTierBps: 15_000, soldUnits: 0 },
  { skuIndex: 2, skuCode: 3, name: 'SLX-G1 HaLow + LoRa Gateway', unitPriceUsd: 499, maxUnits: 1000, voucherTierBps: 15_000, soldUnits: 0 },
];

function defaultBudgetTiersForMode(mode) {
  if (mode !== CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET) {
    return [
      {
        tierIndex: 0,
        thresholdUsd: 150_000,
        budgetAllocationUsd: 120_000,
        ifrsCategory: 1,
        title: 'Base 500-Unit MOQ & Injection Tooling',
        spentUsd: 0,
        unlocked: false,
      },
    ];
  }
  return [
    {
      tierIndex: 0,
      thresholdUsd: 150_000,
      budgetAllocationUsd: 120_000,
      ifrsCategory: 1,
      title: 'Base 500-Unit MOQ & Injection Tooling',
      spentUsd: 0,
      unlocked: false,
    },
    {
      tierIndex: 1,
      thresholdUsd: 300_000,
      budgetAllocationUsd: 90_000,
      ifrsCategory: 4,
      title: 'FCC / CE / TELEC Global RF Certifications',
      spentUsd: 0,
      unlocked: false,
    },
    {
      tierIndex: 2,
      thresholdUsd: 600_000,
      budgetAllocationUsd: 180_000,
      ifrsCategory: 3,
      title: 'Automated High-Speed SMT & Shielding Line',
      spentUsd: 0,
      unlocked: false,
    },
    {
      tierIndex: 3,
      thresholdUsd: 1_000_000,
      budgetAllocationUsd: 250_000,
      ifrsCategory: 5,
      title: 'Global LoRa/HaLow Repeater Seed Fleet',
      spentUsd: 0,
      unlocked: false,
    },
  ];
}

let activeBundle = generateCheckoutVoucherBundle();
let sim = createFreshCampaign(CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET);

function createFreshCampaign(mode) {
  return {
    mode,
    state: CROWDFUNDING_STATE.ACTIVE,
    baseTargetUsd: 150_000,
    currentBlock: 1_200,
    deadlineBlock: 50_000,
    skus: DEFAULT_REWARD_SKUS.map((s) => ({ ...s })),
    tiers: defaultBudgetTiersForMode(mode),
    pledges: [],
    lastCalldataLabel: 'Crowdfunding.initialize(...)',
    lastCalldataHex: '',
  };
}

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

function recomputeDerived() {
  let totalCommittedUsd = 0;
  let totalEscrowedUsd = 0;
  let totalHoldUsd = 0;
  let totalCapturedUsd = 0;

  for (const p of sim.pledges) {
    if (p.status === PLEDGE_STATUS.REFUNDED_OR_VOIDED) continue;
    totalCommittedUsd += p.amountUsd;
    if (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN) totalEscrowedUsd += p.amountUsd;
    if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) totalHoldUsd += p.amountUsd;
    if (p.status === PLEDGE_STATUS.FINALIZED_CAPTURED) totalCapturedUsd += p.amountUsd;
  }

  for (const t of sim.tiers) {
    if (totalCommittedUsd >= t.thresholdUsd && sim.state !== CROWDFUNDING_STATE.FAILED_REFUNDABLE) {
      t.unlocked = true;
    }
  }

  const totalUnlockedBudgetUsd = sim.tiers
    .filter((t) => t.unlocked)
    .reduce((acc, t) => acc + t.budgetAllocationUsd, 0);
  const totalSpentBudgetUsd = sim.tiers.reduce((acc, t) => acc + t.spentUsd, 0);
  const realizedCashUsd = totalEscrowedUsd + totalCapturedUsd;

  return {
    totalCommittedUsd,
    totalEscrowedUsd,
    totalHoldUsd,
    totalCapturedUsd,
    realizedCashUsd,
    totalUnlockedBudgetUsd,
    totalSpentBudgetUsd,
  };
}

function refreshInitCalldata() {
  sim.lastCalldataLabel = 'Crowdfunding.initialize(...)';
  sim.lastCalldataHex = CrowdfundingAbi.initialize({
    admin: wallet.address || '0x1111111111111111111111111111111111111111',
    bankingOracle: '0x2222222222222222222222222222222222222222',
    campaignMode: sim.mode,
    baseTargetMicros: sim.baseTargetUsd * 1_000_000,
    deadlineBlock: sim.deadlineBlock,
    title: 'SuperLexicon Wave 1 Hardware',
    rewardSkus: sim.skus.map((s) => ({
      skuCode: s.skuCode,
      unitPriceMicros: s.unitPriceUsd * 1_000_000,
      maxUnits: s.maxUnits,
      voucherTierBps: s.voucherTierBps,
      name: s.name,
    })),
    budgetTiers: sim.tiers.map((t) => ({
      thresholdMicros: t.thresholdUsd * 1_000_000,
      budgetAllocationMicros: t.budgetAllocationUsd * 1_000_000,
      ifrsCategory: t.ifrsCategory,
      title: t.title,
    })),
  });
}

function renderAll() {
  const d = recomputeDerived();

  // Mode tabs
  document.querySelectorAll('.cf-mode-tab').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.mode) === sim.mode);
  });

  // State pill
  const pill = document.getElementById('cfStatePill');
  if (sim.state === CROWDFUNDING_STATE.ACTIVE) {
    pill.className = 'cf-badge cf-badge-ok mono';
    pill.textContent =
      sim.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP
        ? '🟢 ACTIVE • HARD-CAP ($150K MAX)'
        : '🟢 CAMPAIGN ACTIVE';
  } else if (sim.state === CROWDFUNDING_STATE.SUCCEEDED) {
    pill.className = 'cf-badge cf-badge-ok mono';
    pill.textContent = '🏆 SUCCEEDED • GROWTH BUDGET UNLOCKED';
  } else {
    pill.className = 'cf-badge cf-badge-void mono';
    pill.textContent = '🛡️ TARGET MISSED • NO-ONE CHARGED (100% REFUNDABLE)';
  }

  // KPIs
  const pctOfBase = ((d.totalCommittedUsd / sim.baseTargetUsd) * 100).toFixed(1);
  document.getElementById('kpiCommitted').textContent = fmtUsd(d.totalCommittedUsd);
  document.getElementById('kpiCommittedSub').textContent =
    sim.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP
      ? `Hard Cap: ${fmtUsd(sim.baseTargetUsd)} (${pctOfBase}% filled)`
      : `Base Target: ${fmtUsd(sim.baseTargetUsd)} (${pctOfBase}%)`;

  document.getElementById('kpiRailSplit').textContent = `${fmtUsd(d.realizedCashUsd)} / ${fmtUsd(d.totalHoldUsd)}`;
  document.getElementById('kpiRailSub').textContent = `Realized Escrow+Bank vs. Uncharged Card Holds`;

  const unlCount = sim.tiers.filter((t) => t.unlocked).length;
  document.getElementById('kpiBudgetUnlocked').textContent = fmtUsd(d.totalUnlockedBudgetUsd);
  document.getElementById('kpiBudgetSub').textContent = `${unlCount} / ${sim.tiers.length} budget lines unlocked • ${fmtUsd(d.totalSpentBudgetUsd)} spent`;

  document.getElementById('kpiDeadline').textContent = `Blk #${sim.currentBlock.toLocaleString()} / #${sim.deadlineBlock.toLocaleString()}`;
  document.getElementById('kpiBackersSub').textContent = `${sim.pledges.length} pre-order pledge(s) recorded`;

  // Thermometer
  const maxAxisUsd = Math.max(
    sim.baseTargetUsd,
    ...sim.tiers.map((t) => t.thresholdUsd),
    d.totalCommittedUsd || 1
  );
  const fillPct = Math.min(100, (d.totalCommittedUsd / maxAxisUsd) * 100);
  document.getElementById('thermoFill').style.width = `${fillPct}%`;

  const pinsHost = document.getElementById('thermoPins');
  pinsHost.innerHTML = sim.tiers
    .map((t, idx) => {
      const leftPct = Math.min(97, Math.max(3, (t.thresholdUsd / maxAxisUsd) * 100));
      return `<div class="cf-pin ${t.unlocked ? 'unlocked' : ''}" style="left:${leftPct}%;">
        <span>${t.unlocked ? '🔓' : '🔒'} T${idx}: ${fmtUsd(t.thresholdUsd)}</span>
        <span style="font-size:0.6rem;opacity:0.85;">+${fmtUsd(t.budgetAllocationUsd)} budget</span>
      </div>`;
    })
    .join('');

  // SKU Selector & Preview
  const selSku = document.getElementById('selRewardSku');
  const prevSkuVal = selSku.value || '1';
  selSku.innerHTML = sim.skus
    .map(
      (s) =>
        `<option value="${s.skuIndex}">${s.name} — $${s.unitPriceUsd} (${s.soldUnits}/${s.maxUnits} reserved)</option>`
    )
    .join('');
  if ([...selSku.options].some((o) => o.value === prevSkuVal)) selSku.value = prevSkuVal;
  renderOrderPreview();

  // Corporate Growth Budget Table
  const tbody = document.getElementById('budgetTiersTbody');
  tbody.innerHTML = sim.tiers
    .map((t) => {
      const meta = GROWTH_BUDGET_CATEGORY_META[t.ifrsCategory] || GROWTH_BUDGET_CATEGORY_META[1];
      const rem = t.unlocked ? Math.max(0, t.budgetAllocationUsd - t.spentUsd) : 0;
      return `<tr>
        <td><strong>Tier ${t.tierIndex}</strong><br/><span style="color:#94a3b8;">@ ${fmtUsd(t.thresholdUsd)}</span></td>
        <td><strong>${t.title}</strong><br/><span style="color:#64748b;font-size:0.66rem;">Remaining: ${fmtUsd(rem)}</span></td>
        <td><span class="cf-badge cf-badge-lock">${meta.code}</span></td>
        <td>${fmtUsd(t.budgetAllocationUsd)}</td>
        <td>${fmtUsd(t.spentUsd)}</td>
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
  selDisb.innerHTML = sim.tiers
    .map(
      (t) =>
        `<option value="${t.tierIndex}">Tier ${t.tierIndex} (${t.unlocked ? 'UNLOCKED' : 'LOCKED'}): ${t.title} — Avail ${fmtUsd(
          t.unlocked ? t.budgetAllocationUsd - t.spentUsd : 0
        )}</option>`
    )
    .join('');
  if ([...selDisb.options].some((o) => o.value === prevDisb)) selDisb.value = prevDisb;

  // Pledges Table
  document.getElementById('pledgeSummaryTag').textContent = `${sim.pledges.length} Pledge(s)`;
  const plgBody = document.getElementById('pledgesTbody');
  if (!sim.pledges.length) {
    plgBody.innerHTML = `<tr><td colspan="6" style="color:#64748b;text-align:center;padding:18px;">No pre-orders yet — submit a hardware pledge on the left or click "Simulate Backer Wave".</td></tr>`;
  } else {
    plgBody.innerHTML = sim.pledges
      .slice()
      .reverse()
      .map((p) => {
        const sku = sim.skus[p.skuIndex];
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
          sim.state === CROWDFUNDING_STATE.FAILED_REFUNDABLE &&
          (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN || p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE)
        ) {
          actionHtml = `<button type="button" class="cf-btn cf-btn-rose" style="padding:4px 8px;font-size:0.66rem;" data-refund-id="${p.id}">↩ Refund / Void</button>`;
        } else if (
          sim.state === CROWDFUNDING_STATE.SUCCEEDED &&
          (p.status === PLEDGE_STATUS.ESCROWED_ONCHAIN || p.status === PLEDGE_STATUS.FINALIZED_CAPTURED) &&
          !p.voucherIssued
        ) {
          actionHtml = `<button type="button" class="cf-btn cf-btn-emerald" style="padding:4px 8px;font-size:0.66rem;" data-voucher-id="${p.id}">🎁 Issue SLXR Voucher</button>`;
        } else if (p.voucherIssued) {
          actionHtml = `<span style="color:#6ee7b7;font-size:0.68rem;">✓ Voucher Issued</span>`;
        }

        return `<tr>
          <td>#${p.id}</td>
          <td>${sku ? sku.name.split(' ')[0] : 'SKU'} × ${p.quantity}</td>
          <td>${fmtUsd(p.amountUsd)}</td>
          <td>${p.railLabel}</td>
          <td>${badge}</td>
          <td>${actionHtml}</td>
        </tr>`;
      })
      .join('');
  }

  // Calldata Box
  document.getElementById('lastCalldataBox').innerHTML =
    `<strong style="color:#7dd3fc;">${sim.lastCalldataLabel}</strong><br/>` +
    `<span>${sim.lastCalldataHex}</span>`;
}

function renderOrderPreview() {
  const skuIdx = Number(document.getElementById('selRewardSku').value || 0);
  const qty = Math.max(1, Number(document.getElementById('inQty').value || 1));
  const rail = document.getElementById('selPaymentRail').value;
  const sku = sim.skus[skuIdx] || sim.skus[0];
  const totalUsd = sku.unitPriceUsd * qty;
  const slxr = computeExpectedSlxrEntitlement(sku.skuCode, sku.voucherTierBps, totalUsd);

  const railNote =
    rail === 'onchain_escrow'
      ? 'Escrowed inside Crowdfunding HFS ($0.00 gas); 100% trustlessly refundable if target missed.'
      : 'Card / bank pre-authorization hold via banking-oracle — $0.00 charged unless campaign hits target!';

  document.getElementById('orderCalcBox').innerHTML =
    `Order Total: <strong style="color:#f8fafc;">${fmtUsd(totalUsd)} USD</strong> (${qty} × $${sku.unitPriceUsd})<br/>` +
    `90-Day Validator Reward: <strong style="color:#6ee7b7;">${slxr.toLocaleString()} SLXR</strong> (150% Early-Bird)<br/>` +
    `Blinded Commitment: <span style="color:#93c5fd;">${activeBundle.voucherCommitment.slice(0, 26)}…</span><br/>` +
    `<span style="color:#fde68a;">${railNote}</span>`;
}

function submitPledge(skuIdx, qty, rail) {
  if (sim.state !== CROWDFUNDING_STATE.ACTIVE) {
    showToast('ERR_CAMPAIGN_NOT_ACTIVE (-20): Campaign is already finalized.', 'err');
    return;
  }
  const sku = sim.skus[skuIdx];
  if (sku.soldUnits + qty > sku.maxUnits) {
    showToast(`ERR_SKU_SOLD_OUT (-32): Exceeds ${sku.maxUnits} max units for ${sku.name}.`, 'err');
    return;
  }
  const amountUsd = sku.unitPriceUsd * qty;
  const dBefore = recomputeDerived();

  if (
    sim.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP &&
    dBefore.totalCommittedUsd + amountUsd > sim.baseTargetUsd
  ) {
    showToast(
      `ERR_TARGET_CAP_EXCEEDED (-31): Hard-Cap Mode strictly blocks pre-orders above ${fmtUsd(
        sim.baseTargetUsd
      )} (remaining capacity: ${fmtUsd(sim.baseTargetUsd - dBefore.totalCommittedUsd)}).`,
      'err'
    );
    return;
  }

  const prevUnlocked = sim.tiers.filter((t) => t.unlocked).length;
  sku.soldUnits += qty;
  const id = sim.pledges.length + 1;
  const isOnChain = rail === 'onchain_escrow';
  const refHash = keccak256Hex(utf8ToBytes(`pledge:${id}:${Date.now()}`));

  sim.pledges.push({
    id,
    skuIndex: skuIdx,
    quantity: qty,
    amountUsd,
    railLabel:
      rail === 'onchain_escrow'
        ? 'On-Chain Escrow'
        : rail === 'ocbc_paynow'
        ? 'OCBC PayNow Hold'
        : 'Card Pre-Auth Hold',
    status: isOnChain ? PLEDGE_STATUS.ESCROWED_ONCHAIN : PLEDGE_STATUS.PREAUTH_HOLD_ORACLE,
    paymentRefHash: refHash,
    voucherCommitment: activeBundle.voucherCommitment,
    voucherIssued: false,
  });

  if (isOnChain) {
    sim.lastCalldataLabel = `Crowdfunding.pledgeOnChain(sku=${skuIdx}, qty=${qty})`;
    sim.lastCalldataHex = CrowdfundingAbi.pledgeOnChain({
      skuIndex: skuIdx,
      quantity: qty,
      voucherCommitment: activeBundle.voucherCommitment,
    });
  } else {
    sim.lastCalldataLabel = `Crowdfunding.recordOraclePreorderHold(sku=${skuIdx}, qty=${qty})`;
    sim.lastCalldataHex = CrowdfundingAbi.recordOraclePreorderHold({
      paymentRefHash: refHash,
      skuIndex: skuIdx,
      quantity: qty,
      voucherCommitment: activeBundle.voucherCommitment,
    });
  }

  const dAfter = recomputeDerived();
  const nowUnlocked = sim.tiers.filter((t) => t.unlocked).length;
  if (nowUnlocked > prevUnlocked) {
    const newest = sim.tiers.filter((t) => t.unlocked).slice(-1)[0];
    showToast(
      `🎉 Pledge #${id} (${fmtUsd(amountUsd)}) UNLOCKED Stretch Tier ${newest.tierIndex}: "${newest.title}" (+${fmtUsd(
        newest.budgetAllocationUsd
      )} corporate growth budget)!`,
      'ok'
    );
  } else {
    showToast(
      `Recorded Pre-Order #${id} (${fmtUsd(amountUsd)}) — Total Committed: ${fmtUsd(dAfter.totalCommittedUsd)}.`,
      'ok'
    );
  }
  renderAll();
}

// Wire Event Listeners
document.querySelectorAll('.cf-mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const m = Number(btn.dataset.mode);
    sim = createFreshCampaign(m);
    refreshInitCalldata();
    showToast(
      m === CROWDFUNDING_MODE.SINGLE_HARD_CAP
        ? 'Switched to Mode 1: Single-Target Hard-Cap ($150,000 max; excess pre-orders rejected; no-one charged if missed).'
        : m === CROWDFUNDING_MODE.SINGLE_ALL_OR_NOTHING
        ? 'Switched to Mode 2: Single Minimum Target ($150,000 all-or-nothing; uncapped pre-orders above goal).'
        : 'Switched to Mode 3: Multi-Tier Stretch Targets ($150k → $300k → $600k → $1.0M auto-unlocking company growth budget lines).',
      'info'
    );
    renderAll();
  });
});

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
  if (sim.mode === CROWDFUNDING_MODE.SINGLE_HARD_CAP) {
    const d = recomputeDerived();
    const rem = sim.baseTargetUsd - d.totalCommittedUsd;
    if (rem <= 0) {
      showToast('ERR_TARGET_CAP_EXCEEDED (-31): Hard-Cap target ($150,000) is already 100% full!', 'err');
      return;
    }
    const unitPrice = sim.skus[1].unitPriceUsd;
    const maxUnitsFit = Math.max(1, Math.floor(Math.min(75_000, rem) / unitPrice));
    submitPledge(1, maxUnitsFit, 'oracle_card_hold');
  } else {
    // 250 x $499 = $124,750 wave
    submitPledge(2, 250, 'onchain_escrow');
  }
});

document.getElementById('btnFinalizeSuccess').addEventListener('click', () => {
  const d = recomputeDerived();
  if (d.totalCommittedUsd < sim.baseTargetUsd) {
    showToast(
      `Cannot finalize as SUCCEEDED yet: ${fmtUsd(d.totalCommittedUsd)} committed < ${fmtUsd(
        sim.baseTargetUsd
      )} Base Target!`,
      'err'
    );
    return;
  }
  sim.state = CROWDFUNDING_STATE.SUCCEEDED;
  for (const p of sim.pledges) {
    if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) {
      p.status = PLEDGE_STATUS.FINALIZED_CAPTURED;
    }
  }
  sim.lastCalldataLabel = 'Crowdfunding.finalizeCampaign()';
  sim.lastCalldataHex = CrowdfundingAbi.finalizeCampaign();
  const dAfter = recomputeDerived();
  showToast(
    `🏆 Campaign SUCCEEDED! Captured all pre-auth holds via banking-oracle and unlocked ${fmtUsd(
      dAfter.totalUnlockedBudgetUsd
    )} across ${sim.tiers.filter((t) => t.unlocked).length} corporate growth budget lines.`,
    'ok'
  );
  renderAll();
});

document.getElementById('btnSimMissedDeadline').addEventListener('click', () => {
  const d = recomputeDerived();
  if (d.totalCommittedUsd >= sim.baseTargetUsd) {
    showToast(
      `Target (${fmtUsd(sim.baseTargetUsd)}) is already met (${fmtUsd(
        d.totalCommittedUsd
      )})! Click Reset first to test a below-target missed deadline.`,
      'info'
    );
    return;
  }
  sim.currentBlock = sim.deadlineBlock + 1;
  sim.state = CROWDFUNDING_STATE.FAILED_REFUNDABLE;
  for (const p of sim.pledges) {
    if (p.status === PLEDGE_STATUS.PREAUTH_HOLD_ORACLE) {
      p.status = PLEDGE_STATUS.REFUNDED_OR_VOIDED;
    }
  }
  sim.lastCalldataLabel = 'Crowdfunding.finalizeCampaign() -> STATE_FAILED_REFUNDABLE';
  sim.lastCalldataHex = CrowdfundingAbi.finalizeCampaign();
  showToast(
    `🛡️ Deadline passed below ${fmtUsd(
      sim.baseTargetUsd
    )} target: ZERO credit cards were charged (all holds voided) and 100% of on-chain escrow is now refundable!`,
    'err'
  );
  renderAll();
});

document.getElementById('btnResetCampaign').addEventListener('click', () => {
  activeBundle = generateCheckoutVoucherBundle();
  sim = createFreshCampaign(sim.mode);
  refreshInitCalldata();
  showToast('Campaign state reset.', 'info');
  renderAll();
});

document.getElementById('btnAddStretchTier').addEventListener('click', () => {
  if (sim.mode !== CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET) {
    showToast('Switch to Mode 3 (Multi-Tier Stretch Growth Budget) to add stretch budget tiers.', 'err');
    return;
  }
  const targetUsd = Number(document.getElementById('inNewTierTarget').value || 0);
  const allocUsd = Number(document.getElementById('inNewTierAlloc').value || 0);
  const cat = Number(document.getElementById('selNewTierCat').value || 2);
  const title = document.getElementById('inNewTierTitle').value.trim() || 'Custom Growth Line';
  const lastTier = sim.tiers[sim.tiers.length - 1];
  const cumAlloc = sim.tiers.reduce((a, t) => a + t.budgetAllocationUsd, 0) + allocUsd;

  if (targetUsd <= lastTier.thresholdUsd) {
    showToast(`Stretch target must exceed previous tier (${fmtUsd(lastTier.thresholdUsd)}).`, 'err');
    return;
  }
  if (allocUsd <= 0 || cumAlloc > targetUsd) {
    showToast(`Cumulative budget (${fmtUsd(cumAlloc)}) cannot exceed stretch target (${fmtUsd(targetUsd)}).`, 'err');
    return;
  }

  sim.tiers.push({
    tierIndex: sim.tiers.length,
    thresholdUsd: targetUsd,
    budgetAllocationUsd: allocUsd,
    ifrsCategory: cat,
    title,
    spentUsd: 0,
    unlocked: false,
  });
  refreshInitCalldata();
  showToast(`Added Stretch Tier ${sim.tiers.length - 1} (${fmtUsd(targetUsd)} -> +${fmtUsd(allocUsd)} "${title}").`, 'ok');
  renderAll();
});

document.getElementById('btnDisburseBudget').addEventListener('click', () => {
  if (sim.state !== CROWDFUNDING_STATE.SUCCEEDED) {
    showToast(
      'ERR_CAMPAIGN_NOT_SUCCEEDED (-24): Finalize a successful campaign before disbursing company growth budget lines!',
      'err'
    );
    return;
  }
  const tierIdx = Number(document.getElementById('selDisburseTier').value || 0);
  const amountUsd = Number(document.getElementById('inDisburseUsd').value || 0);
  const vendor = document.getElementById('inVendorAddr').value.trim();
  const tier = sim.tiers[tierIdx];

  if (!tier || !tier.unlocked) {
    showToast(
      `ERR_BUDGET_TIER_LOCKED (-40): Stretch Tier ${tierIdx} ("${tier?.title}") was NOT reached — funds are locked!`,
      'err'
    );
    return;
  }
  if (amountUsd <= 0 || tier.spentUsd + amountUsd > tier.budgetAllocationUsd) {
    showToast(
      `ERR_BUDGET_LINE_EXCEEDED (-41): Requested ${fmtUsd(amountUsd)} exceeds Tier ${tierIdx} remaining budget (${fmtUsd(
        tier.budgetAllocationUsd - tier.spentUsd
      )})!`,
      'err'
    );
    return;
  }
  const d = recomputeDerived();
  if (d.totalSpentBudgetUsd + amountUsd > d.realizedCashUsd) {
    showToast('ERR_INSUFFICIENT_REALIZED_CASH (-42): Exceeds realized cash in escrow!', 'err');
    return;
  }

  tier.spentUsd += amountUsd;
  const expRef = keccak256Hex(utf8ToBytes(`DISB:${tierIdx}:${Date.now()}`));
  sim.lastCalldataLabel = `Crowdfunding.disburseUnlockedBudgetLine(tier=${tierIdx}, usd=${amountUsd})`;
  sim.lastCalldataHex = CrowdfundingAbi.disburseUnlockedBudgetLine({
    tierIndex: tierIdx,
    vendorIdentity: vendor,
    amountMicros: Math.round(amountUsd * 1_000_000),
    expenseRefHash: expRef,
  });
  showToast(
    `✅ Disbursed ${fmtUsd(amountUsd)} from Tier ${tierIdx} ("${tier.title}") to vendor ${vendor.slice(0, 10)}…`,
    'ok'
  );
  renderAll();
});

document.getElementById('pledgesTbody').addEventListener('click', (e) => {
  const refBtn = e.target.closest('[data-refund-id]');
  if (refBtn) {
    const id = Number(refBtn.dataset.refundId);
    const p = sim.pledges.find((x) => x.id === id);
    if (p) {
      p.status = PLEDGE_STATUS.REFUNDED_OR_VOIDED;
      sim.lastCalldataLabel = `Crowdfunding.claimFullRefund(pledgeId=${id})`;
      sim.lastCalldataHex = CrowdfundingAbi.claimFullRefund(id);
      showToast(`↩ Refunded 100% (${fmtUsd(p.amountUsd)}) on Pledge #${id}.`, 'ok');
      renderAll();
    }
    return;
  }

  const vchBtn = e.target.closest('[data-voucher-id]');
  if (vchBtn) {
    const id = Number(vchBtn.dataset.voucherId);
    const p = sim.pledges.find((x) => x.id === id);
    if (p) {
      p.voucherIssued = true;
      sim.lastCalldataLabel = `Crowdfunding.issueBackerVoucher(pledgeId=${id})`;
      sim.lastCalldataHex = CrowdfundingAbi.issueBackerVoucher(id);
      showToast(`🎁 Issued blinded 90-day SLXR PaidVoucher on RewardVoucher HFS for Pledge #${id}!`, 'ok');
      renderAll();
    }
  }
});

document.getElementById('btnSyncLiveRpc').addEventListener('click', async () => {
  const addr = document.getElementById('inCrowdfundAddr').value.trim();
  try {
    const rpcUrl = getDefaultNodeWsUrl();
    const sumHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: addr, data: CrowdfundingAbi.getCampaignSummary() },
      'latest',
    ]);
    if (!sumHex || sumHex === '0x' || sumHex.length < 450) {
      showToast(`No initialized Crowdfunding HFS found at ${addr} on ${rpcUrl} (running local deterministic mode).`, 'info');
      return;
    }
    const summary = decodeCampaignSummaryHex(sumHex);
    const tiersHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: addr, data: CrowdfundingAbi.getBudgetTiers() },
      'latest',
    ]);
    const skusHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: addr, data: CrowdfundingAbi.getRewardSkus() },
      'latest',
    ]);
    sim.mode = summary.mode;
    sim.state = summary.state;
    sim.baseTargetUsd = summary.baseTargetUsd;
    sim.deadlineBlock = summary.deadlineBlock;
    sim.tiers = decodeBudgetTiersHex(tiersHex);
    sim.skus = decodeRewardSkusHex(skusHex);
    showToast(`📡 Synced live Crowdfunding HFS "${summary.title}" (${fmtUsd(summary.totalCommittedUsd)} committed)!`, 'ok');
    renderAll();
  } catch (err) {
    showToast(`RPC query note: ${err.message || err} (local interactive simulator active).`, 'info');
  }
});

refreshInitCalldata();
renderAll();
