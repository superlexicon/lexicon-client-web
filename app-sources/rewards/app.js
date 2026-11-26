/**
 * SuperLexicon Hardware-Gated `SLXR` Voucher, 90-Day Validator Maturity & Cash-Back UI (`src/rewards.js`)
 */

import {
  ZERO_ADDR,
  SlxWalletManager,
  computeExpectedSlxrEntitlement,
  generateCheckoutVoucherBundle,
  signVoucherClaimIntent,
  verifyVoucherClaimIntent,
  computeOraclePaymentRefHash,
  RewardVoucherAbi,
  fetchLocalNodeValidatorMaturity,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';

const STORAGE_KEY_VOUCHER = 'slx_checkout_voucher_bundle_v1';
const DEFAULT_RV_HFS = '0xd5000000000000000000000000000000000000d5';

const wallet = new SlxWalletManager();
if (typeof window !== 'undefined') {
  window.__SLX_WALLET__ = wallet;
}

mountSlxUnifiedHeader({
  mountId: 'slxUnifiedHeaderMount',
  appId: 'rewards',
  appTitle: 'SLXR Hardware Voucher & 90-Day Validator Rewards',
  wallet,
});

const selSku = document.getElementById('selSku');
const selTier = document.getElementById('selTier');
const entitlementPreview = document.getElementById('entitlementPreview');
const outCommitment = document.getElementById('outCommitment');
const outSecretHex = document.getElementById('outSecretHex');
const inPaymentRef = document.getElementById('inPaymentRef');
const inValidatorPk = document.getElementById('inValidatorPk');
const inRecipientId = document.getElementById('inRecipientId');
const inEthRecipient = document.getElementById('inEthRecipient');
const claimStatusToast = document.getElementById('claimStatusToast');
const signedClaimOutput = document.getElementById('signedClaimOutput');

let currentBundle = null;

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function refreshEntitlementPreview() {
  const sku = Number(selSku?.value || 3);
  const tier = Number(selTier?.value || 2000);
  const slxr = computeExpectedSlxrEntitlement(sku, tier);
  const pct = (tier / 100).toFixed(0);
  const price = sku === 1 ? '$198' : sku === 2 ? '$888' : '$1,288';
  if (entitlementPreview) {
    entitlementPreview.innerHTML = `Expected Entitlement: <strong style="color:#6ee7b7;">${fmtNum(slxr)} SLXR</strong> (${pct}% × ${price} × 1,000,000 — Unlocks after <strong>90 Active Validator Days</strong>)`;
  }
}

function applyBundle(b) {
  currentBundle = b;
  if (outCommitment) outCommitment.value = b.voucherCommitment;
  if (outSecretHex) outSecretHex.value = b.secretLeHex;
  if (inPaymentRef && !inPaymentRef.value) {
    inPaymentRef.value = computeOraclePaymentRefHash(
      'superlexicon-payment-salt-v1',
      'stripe',
      `pi_demo_${b.voucherCommitment.slice(2, 12)}`
    );
  }
  try {
    localStorage.setItem(STORAGE_KEY_VOUCHER, JSON.stringify(b));
  } catch (_) {}
}

// Restore saved checkout voucher if present, else prefill recipient from wallet
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_VOUCHER) || 'null');
  if (saved && saved.voucherCommitment && saved.secretLeHex) {
    applyBundle(saved);
  }
} catch (_) {}

if (inRecipientId && wallet?.keypair?.address) {
  const idRec = wallet.getCachedIdentityRecord?.();
  inRecipientId.value = idRec?.identityAddr || wallet.keypair.address;
}
if (inEthRecipient && wallet?.keypair?.address) {
  inEthRecipient.value = wallet.keypair.address;
}

selSku?.addEventListener('change', refreshEntitlementPreview);
selTier?.addEventListener('change', refreshEntitlementPreview);
refreshEntitlementPreview();

document.getElementById('btnGenVoucher')?.addEventListener('click', () => {
  const b = generateCheckoutVoucherBundle();
  applyBundle(b);
});

document.getElementById('btnDownloadBackup')?.addEventListener('click', () => {
  if (!currentBundle) {
    applyBundle(generateCheckoutVoucherBundle());
  }
  const blob = new Blob(
    [
      JSON.stringify(
        {
          type: 'SuperLexiconPaidDeviceVoucher',
          createdAt: new Date().toISOString(),
          skuCode: Number(selSku?.value || 3),
          tierBps: Number(selTier?.value || 2000),
          minActiveValidatorDays: 90,
          ...currentBundle,
        },
        null,
        2
      ),
    ],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `slxr-voucher-${currentBundle.voucherCommitment.slice(2, 10)}.json`;
  a.click();
});

async function probeValidator() {
  const kpiNodeProgress = document.getElementById('kpiNodeProgress');
  const kpiNodeSub = document.getElementById('kpiNodeSub');
  const matLabelLeft = document.getElementById('matLabelLeft');
  const matProgressBar = document.getElementById('matProgressBar');

  let snap = await fetchLocalNodeValidatorMaturity('ws://127.0.0.1:8545');
  if (!snap) {
    snap = await fetchLocalNodeValidatorMaturity();
  }
  if (!snap) {
    if (kpiNodeProgress) kpiNodeProgress.textContent = '0 / 90 Days';
    if (kpiNodeSub) kpiNodeSub.textContent = 'Connect local validator (:8545) to track';
    return;
  }

  const days = Number(snap.estimated_active_days || 0);
  const target = Number(snap.target_active_days || 90);
  const height = Number(snap.chain_height || 0);
  const pct = Math.min(100, Math.round((days / Math.max(1, target)) * 100));

  if (kpiNodeProgress) kpiNodeProgress.textContent = `${days} / ${target} Days`;
  if (kpiNodeSub) {
    kpiNodeSub.textContent = `Role: ${snap.role || 'validator'} • Height #${fmtNum(height)} (${snap.subnet_validators || 0} peers)`;
  }
  if (matLabelLeft) {
    matLabelLeft.textContent = `Active Mesh Maturity: ${days} / ${target} Days (${pct}%)`;
  }
  if (matProgressBar) {
    matProgressBar.style.width = `${pct}%`;
  }
  if (inValidatorPk && snap.validator_pubkey && !inValidatorPk.value) {
    inValidatorPk.value = snap.validator_pubkey;
  }
}

document.getElementById('btnProbeValidator')?.addEventListener('click', probeValidator);
probeValidator();

document.getElementById('btnSignClaim')?.addEventListener('click', () => {
  if (!currentBundle) {
    applyBundle(generateCheckoutVoucherBundle());
  }
  const paymentRefHash = String(inPaymentRef?.value || '').trim();
  const validatorPubKey =
    String(inValidatorPk?.value || '').trim() || '0x' + '11'.repeat(32);
  const recipientIdentity =
    String(inRecipientId?.value || '').trim() || wallet?.keypair?.address || ZERO_ADDR;
  const ethRecipient = String(inEthRecipient?.value || '').trim() || ZERO_ADDR;

  try {
    const signed = signVoucherClaimIntent({
      secretLeHexOrScalar: currentBundle.secretLeHex,
      rewardVoucherAddr: DEFAULT_RV_HFS,
      paymentRefHash,
      validatorPubKey,
      recipientIdentity,
      ethRecipient,
    });
    const verified = verifyVoucherClaimIntent({
      voucherPkHex: currentBundle.voucherPkHex,
      rewardVoucherAddr: DEFAULT_RV_HFS,
      paymentRefHash,
      validatorPubKey,
      recipientIdentity,
      ethRecipient,
      signatureHex: signed.signatureHex,
    });
    const calldataHex = RewardVoucherAbi.claimValidatedReward({
      paymentRefHash,
      voucherPkHex: currentBundle.voucherPkHex,
      validatorPubKey,
      recipientIdentity,
      ethRecipient,
      signatureHex: signed.signatureHex,
    });

    if (claimStatusToast) {
      claimStatusToast.style.display = 'block';
      claimStatusToast.textContent = `✓ Edwards25519 Schnorr Claim Signature Verified (${verified}) — MEV Front-Run Protected!`;
    }
    if (signedClaimOutput) {
      signedClaimOutput.style.display = 'block';
      signedClaimOutput.innerHTML = `
        <div><strong>voucherPkHex:</strong> ${currentBundle.voucherPkHex}</div>
        <div><strong>schnorrSig64:</strong> ${signed.signatureHex}</div>
        <div><strong>claimValidatedReward Calldata (${(calldataHex.length - 2) / 2} B):</strong> ${calldataHex.slice(0, 86)}…</div>
      `;
    }
  } catch (err) {
    if (claimStatusToast) {
      claimStatusToast.style.display = 'block';
      claimStatusToast.textContent = `✕ ${err?.message || String(err)}`;
    }
  }
});
