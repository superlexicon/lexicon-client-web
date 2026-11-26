/**
 * SuperLexicon Realtime Event-Sourced IAS / IFRS Accounting Ledger (`/accounting.html`)
 *
 * Architecture:
 * 1. Hydrates ONCE from `getRealtimeAnchorState()` (+ initial `getJournalSlice`) at `anchorBlock`.
 * 2. Streams freshly emitted `IfrsJournalPosted`, `IfrsSubledgerUpdated`, `IfrsFiscalPeriodClosed`,
 *    and `AssetLedger.Credited/Debited` logs over WebSocket (`slxWatchChainApp`) with ZERO RPC polling.
 * 3. Runs a bit-exact `BigInt` mirror of `hps_sdk::ifrs` (`compile_statements` + linear block-tick
 *    accruals on `newHeads`) to graphically render live Balance Sheet, P&L, and Cash Flow statements.
 */

import {
  SlxInstSession,
  GOV_CONSTANTS,
  ZERO_ADDR,
  encodeAbi,
  decodeUintWord,
  decodeLastMatchSummaryHex,
  decodeBestBidAskHex,
  decodeBlockMatchedLog,
  readU64BE,
  shortAddr,
  fmtNum,
  escapeHtml,
} from './slx-inst-suite.js';
import { fetchRegisteredHfsByType } from './slx-hfs-registry.js';
import {
  DEFAULT_VALUATION_PARAMS,
  computeTriangulatedValuation,
  buildValuationSensitivityGrid,
} from './ifrs-valuation.js';
import {
  FRIENDLY_COA,
  GL_SCENARIO_BLUEPRINTS,
  renderHumanBlueprintHtml,
  translateLiveJournalEntry,
  describePostingLineEffect,
} from './ifrs-human-gl.js';
import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  randomBytes,
  u16BEBytes,
  u64BEBytes,
  keccak256Bytes,
  keccak256Hex,
  slxWatchChainApp,
  readOnChainIdentityEncryptionKeys,
  CONF_CAT_IDS,
  CONF_CAT_KIND,
  CONF_ROLLUP_MODE,
  CONF_MIN_PADDED_SLOTS,
  ED25519_BASEPOINT_BYTES,
  ED25519_L,
  leBytesToBigInt,
  scalarToLeBytes32,
  encodePeriodTagBytes32,
  deriveEd25519Keypair,
  deriveIdentityEncryptionKeys,
  resolveIdentityEncryptionKeys,
  deriveCompanyAuditKeypair,
  deriveCategoryPeriodSubkey,
  wrapSecretForRecipientSecp,
  unwrapSecretWithPrivKey,
  encryptJsonForRecipientSecp,
  decryptJsonWithPrivKey,
  encryptJsonWithSubkey,
  decryptJsonWithSubkey,
  heEncryptU64,
  decryptElGamalU24,
  proveEd25519Schnorr,
  proveHeSumEqualsU64,
  verifyHeSumEqualsU64,
  computeConfidentialBatchTag,
  buildConfidentialPayableBatchTx,
  buildConfidentialReceivableProposal,
  buildStealthCosignTx,
  buildConfidentialEpochRollupTx,
  buildSpendOrRedeemShieldedNoteTx,
  decodeConfidentialCategoriesHex,
  decodeConfidentialBatchesSliceHex,
  decodeConfidentialReceivablesSliceHex,
  decodeShieldedNotesSliceHex,
  decodeAuditorGrantsSliceHex,
  decodeIas24InsidersHex,
} from '@superlexicon/sdk';

// 32-Slot Canonical Chart of Accounts (`normalSide`: 0 = Debit, 1 = Credit)
const COA_META = [
  { code: '1010', name: 'Cash & Bank Equivalents', std: 'IAS 7', normalSide: 0 },
  { code: '1100', name: 'Trade Receivables', std: 'IFRS 15', normalSide: 0 },
  { code: '1190', name: 'Allowance for Expected Credit Losses', std: 'IFRS 9', normalSide: 1, contra: true },
  { code: '1200', name: 'Merchandise Inventory (Moving WAC)', std: 'IAS 2', normalSide: 0 },
  { code: '1800', name: 'Future Contract Receivables (Unbilled Backlog)', std: 'IFRS 15', normalSide: 0 },
  { code: '1500', name: 'Property, Plant & Equipment (Cost)', std: 'IAS 16', normalSide: 0 },
  { code: '1590', name: 'Accumulated Depreciation — PPE', std: 'IAS 16', normalSide: 1, contra: true },
  { code: '1600', name: 'Right-of-Use Lease Assets (PV)', std: 'IFRS 16', normalSide: 0 },
  { code: '1690', name: 'Accumulated Amortization — ROU', std: 'IFRS 16', normalSide: 1, contra: true },
  { code: '1700', name: 'Finite Intangible Assets (Cost)', std: 'IAS 38', normalSide: 0 },
  { code: '1790', name: 'Accumulated Amortization — Intangibles', std: 'IAS 38', normalSide: 1, contra: true },
  { code: '2010', name: 'Trade Payables', std: 'IAS 1', normalSide: 1 },
  { code: '2100', name: 'Accrued Employee Benefits & Payroll', std: 'IAS 19', normalSide: 1 },
  { code: '2200', name: 'Current Income Tax Payable', std: 'IAS 12', normalSide: 1 },
  { code: '2300', name: 'Contract Liabilities (Deferred Revenue)', std: 'IFRS 15', normalSide: 1 },
  { code: '2400', name: 'Dividends Payable', std: 'IAS 32', normalSide: 1 },
  { code: '2500', name: 'Lease Liabilities (Present Value)', std: 'IFRS 16', normalSide: 1 },
  { code: '2600', name: 'Term Debt & Borrowings (Amortized Cost)', std: 'IFRS 9', normalSide: 1 },
  { code: '2900', name: 'Unattributed Cash Deposit Suspense', std: 'IAS 7', normalSide: 1 },
  { code: '3000', name: 'Issued Share Capital (Par)', std: 'IAS 32', normalSide: 1 },
  { code: '3010', name: 'Share Premium (APIC)', std: 'IAS 32', normalSide: 1 },
  { code: '3200', name: 'Treasury Shares at Cost', std: 'IAS 32', normalSide: 0, contra: true },
  { code: '3300', name: 'Share-Based Payment Reserve', std: 'IFRS 2', normalSide: 1 },
  { code: '3400', name: 'Retained Earnings / (Deficit)', std: 'IAS 1', normalSide: 1 },
  { code: '4000', name: "Operating Revenue (Arm's-Length)", std: 'IFRS 15', normalSide: 1, nominal: true },
  { code: '4050', name: 'Related-Party Revenue (Segregated)', std: 'IAS 24', normalSide: 1, nominal: true },
  { code: '4090', name: 'Sales Returns & Allowances', std: 'IFRS 15', normalSide: 0, contra: true, nominal: true },
  { code: '5010', name: 'Cost of Goods Sold & NRV Write-Downs', std: 'IAS 2', normalSide: 0, nominal: true },
  { code: '6100', name: 'Employee Benefits & Share-Based Comp', std: 'IAS 19/IFRS 2', normalSide: 0, nominal: true },
  { code: '6300', name: 'Depreciation & Amortization Expense', std: 'IAS 16/38/16', normalSide: 0, nominal: true },
  { code: '6400', name: 'Operating Expenses (R&D/S&M/G&A) & ECL', std: 'IAS 1/IFRS 9', normalSide: 0, nominal: true },
  { code: '7000', name: 'Net Finance Interest, Disposal & Tax', std: 'IFRS 9/IAS 12', normalSide: 0, nominal: true },
];

const STD_LABELS = {
  1: 'IAS 1',
  2: 'IAS 2 WAC',
  3: 'IAS 7 Suspense',
  4: 'IAS 12 Tax',
  5: 'IAS 16 PPE',
  6: 'IAS 19 Payroll',
  7: 'IAS 24 Related',
  8: 'IAS 32 Equity',
  9: 'IAS 38 Intang.',
  10: 'IFRS 2 ESOP',
  11: 'IFRS 9 Debt/ECL',
  12: 'IFRS 15 Rev.',
  13: 'IFRS 16 Lease',
};

const CF_LABELS = {
  0: 'Non-Cash',
  1: 'CFO (Oper.)',
  2: 'CFI (Invest.)',
  3: 'CFF (Financ.)',
};

const ASSET_CLASS_NAMES = {
  1: 'IT Hardware (IAS 16, 200–50k blks)',
  2: 'Machinery (IAS 16, 500–150k blks)',
  3: 'Facility (IAS 16, 2k–500k blks)',
  4: 'Finite Software/IP (IAS 38, Res=0)',
};

// Canonical Keccak-256 Event Topics emitted by `accounting_ledger.wasm` & `asset_ledger.wasm`
const TOPIC_JOURNAL_POSTED = keccak256Hex(
  utf8ToBytes('IfrsJournalPosted(uint64,address,bytes32,bytes)')
).toLowerCase();
const TOPIC_JOURNAL_LEGACY = keccak256Hex(
  utf8ToBytes('IfrsJournalPosted(uint64,uint64,uint64,address,uint64)')
).toLowerCase();
const TOPIC_SUBLEDGER_UPDATED = keccak256Hex(
  utf8ToBytes('IfrsSubledgerUpdated(uint64,bytes32,bytes)')
).toLowerCase();
const TOPIC_PERIOD_CLOSED = keccak256Hex(
  utf8ToBytes('IfrsFiscalPeriodClosed(uint64,int64,uint64,address)')
).toLowerCase();
const TOPIC_BANK_CREDITED = keccak256Hex(
  utf8ToBytes('Credited(address,uint64,uint64)')
).toLowerCase();
const TOPIC_BANK_DEBITED = keccak256Hex(
  utf8ToBytes('Debited(address,uint64,uint64)')
).toLowerCase();
const TOPIC_CONF_BATCH_POSTED = keccak256Hex(
  utf8ToBytes('IfrsConfidentialBatchPosted(uint64,bytes32,bytes32,uint64)')
).toLowerCase();
const TOPIC_CONF_REC_UPDATED = keccak256Hex(
  utf8ToBytes('IfrsConfidentialReceivableUpdated(uint64,bytes32,uint64,uint64)')
).toLowerCase();
const TOPIC_SHIELDED_NOTE_MINTED = keccak256Hex(
  utf8ToBytes('ShieldedNoteMinted(uint64,bytes32,bytes32,bytes16)')
).toLowerCase();
const TOPIC_SHIELDED_NOTE_SPENT = keccak256Hex(
  utf8ToBytes('ShieldedNoteSpent(bytes32,uint64,uint64,address)')
).toLowerCase();
const TOPIC_AUDIT_EPOCH_ROTATED = keccak256Hex(
  utf8ToBytes('AuditEpochRotated(uint64,bytes32,address)')
).toLowerCase();
const TOPIC_AUDITOR_KEY_GRANTED = keccak256Hex(
  utf8ToBytes('AuditorCategoryKeyGranted(uint64,uint64,bytes32,bytes32,address)')
).toLowerCase();

const ANCHOR_HEADER_BYTES = 272;
const FLASH_TTL_MS = 4800;

function readU32BE(b, off) {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function readI64BE(b, off) {
  const hi = (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
  const lo = ((b[off + 4] << 24) | (b[off + 5] << 16) | (b[off + 6] << 8) | b[off + 7]) >>> 0;
  return Number((BigInt(hi) << 32n) | BigInt(lo));
}

function fmtSigned(n) {
  if (n < 0) return `(${fmtNum(Math.abs(n))})`;
  return fmtNum(n);
}

function fmtCompact(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${fmtNum(Math.round(abs))}`;
}

// ============================================================================
// Exact BigInt Mirrors of `hps_sdk::ifrs` Accrual & Statement Formulas
// ============================================================================

function computeLinearDepreciation(cost, residual, usefulLifeBlocks, acquiredBlock, currentBlock) {
  if (usefulLifeBlocks <= 0 || currentBlock <= acquiredBlock || cost <= residual) return 0;
  const dep = BigInt(cost - residual);
  const life = BigInt(usefulLifeBlocks);
  const elapsed = BigInt(Math.min(currentBlock - acquiredBlock, usefulLifeBlocks));
  if (elapsed === life) return Number(dep);
  return Number((dep * elapsed) / life);
}

function computeLinearDeferredEarned(totalAmount, startBlock, durationBlocks, currentBlock) {
  if (durationBlocks <= 0 || currentBlock <= startBlock) return 0;
  const tot = BigInt(totalAmount);
  const dur = BigInt(durationBlocks);
  const elapsed = BigInt(Math.min(currentBlock - startBlock, durationBlocks));
  if (elapsed === dur) return Number(tot);
  return Number((tot * elapsed) / dur);
}

function computeInvoiceEclAmount(openAmount, dueBlock, currentBlock) {
  if (openAmount <= 0) return 0;
  const overdue = Math.max(0, currentBlock - dueBlock);
  const bps = overdue === 0 ? 100n : overdue <= 200 ? 1000n : overdue <= 1000 ? 5000n : 10000n;
  return Number((BigInt(openAmount) * bps) / 10000n);
}

// ============================================================================
// Shared Binary Row Decoders (Identical for Anchor Snapshot & Event Logs)
// ============================================================================

function decodeInvSkuWire(b, pos = 0) {
  return {
    skuId: bytesToHex(b.slice(pos, pos + 32)).toLowerCase(),
    unitsOnHand: readU64BE(b, pos + 32),
    carryingCost: readU64BE(b, pos + 40),
    totalUnitsSold: readU64BE(b, pos + 48),
  };
}

function decodeAssetWire(b, pos = 0) {
  return {
    assetId: readU64BE(b, pos),
    assetClass: b[pos + 8],
    disposed: b[pos + 9] === 1,
    cost: readU64BE(b, pos + 16),
    residual: readU64BE(b, pos + 24),
    usefulLifeBlocks: readU64BE(b, pos + 32),
    acquiredBlock: readU64BE(b, pos + 40),
    postedDepr: readU64BE(b, pos + 48),
    liveDepr: readU64BE(b, pos + 56),
  };
}

function decodeLeaseWire(b, pos = 0, stride = 96) {
  return {
    leaseId: readU64BE(b, pos),
    lessor: bytesToHex(b.slice(pos + 8, pos + 28)).toLowerCase(),
    status: b[pos + 28],
    initialPv: readU64BE(b, pos + 32),
    remLiability: readU64BE(b, pos + 40),
    periodicPayment: readU64BE(b, pos + 48),
    rateBps: readU64BE(b, pos + 56),
    totalPeriods: readU32BE(b, pos + 64),
    paidPeriods: readU32BE(b, pos + 68),
    periodBlocks: readU64BE(b, pos + 72),
    startBlock: readU64BE(b, pos + 80),
    postedAmort: stride >= 96 ? readU64BE(b, pos + 88) : 0,
  };
}

function decodeDefWire(b, pos = 0) {
  return {
    contractId: readU64BE(b, pos),
    customer: bytesToHex(b.slice(pos + 8, pos + 28)).toLowerCase(),
    isRelated: b[pos + 28] === 1,
    totalAmount: readU64BE(b, pos + 32),
    postedEarned: readU64BE(b, pos + 40),
    liveEarned: readU64BE(b, pos + 48),
    startBlock: readU64BE(b, pos + 56),
    durationBlocks: readU64BE(b, pos + 64),
    planTag: bytesToUtf8(b.slice(pos + 72, pos + 80)).replace(/\0/g, '') || 'SAAS',
  };
}

function decodeInvoiceWire(b, pos = 0) {
  return {
    invoiceId: readU64BE(b, pos),
    buyer: bytesToHex(b.slice(pos + 8, pos + 28)).toLowerCase(),
    status: b[pos + 28],
    originalAmount: readU64BE(b, pos + 32),
    openAmount: readU64BE(b, pos + 40),
    liveEcl: readU64BE(b, pos + 48),
    issuedBlock: readU64BE(b, pos + 56),
    dueBlock: readU64BE(b, pos + 64),
  };
}

function decodeLoanWire(b, pos = 0) {
  return {
    loanId: readU64BE(b, pos),
    lender: bytesToHex(b.slice(pos + 8, pos + 28)).toLowerCase(),
    status: b[pos + 28],
    initialPrincipal: readU64BE(b, pos + 32),
    remPrincipal: readU64BE(b, pos + 40),
    rateBps: readU64BE(b, pos + 48),
    startBlock: readU64BE(b, pos + 56),
  };
}

function decodeSvcWire(b, pos = 0) {
  return {
    contractId: readU64BE(b, pos),
    client: bytesToHex(b.slice(pos + 8, pos + 28)).toLowerCase(),
    status: b[pos + 28],
    monthlyAmount: readU64BE(b, pos + 32),
    totalMonths: readU32BE(b, pos + 40),
    billedMonths: readU32BE(b, pos + 44),
    monthBlocks: readU64BE(b, pos + 48),
    startBlock: readU64BE(b, pos + 56),
    lastInvoiceId: readU64BE(b, pos + 64),
    contractTag:
      bytesToUtf8(b.slice(pos + 72, pos + 96)).replace(/\0/g, '').trim() || 'SVC-CONTRACT',
  };
}

function decodeSchedulesBlock(b, startOffset, counts, leaseStride = 96) {
  const [cInv, cAst, cLse, cDef, cAr, cLn, cSvc = 0] = counts;
  let pos = startOffset;
  const inv = new Map();
  for (let i = 0; i < cInv && pos + 56 <= b.length; i++, pos += 56) {
    const r = decodeInvSkuWire(b, pos);
    inv.set(r.skuId, r);
  }
  const assets = new Map();
  for (let i = 0; i < cAst && pos + 64 <= b.length; i++, pos += 64) {
    const r = decodeAssetWire(b, pos);
    assets.set(r.assetId, r);
  }
  const leases = new Map();
  for (let i = 0; i < cLse && pos + leaseStride <= b.length; i++, pos += leaseStride) {
    const r = decodeLeaseWire(b, pos, leaseStride);
    leases.set(r.leaseId, r);
  }
  const def = new Map();
  for (let i = 0; i < cDef && pos + 80 <= b.length; i++, pos += 80) {
    const r = decodeDefWire(b, pos);
    def.set(r.contractId, r);
  }
  const ar = new Map();
  for (let i = 0; i < cAr && pos + 72 <= b.length; i++, pos += 72) {
    const r = decodeInvoiceWire(b, pos);
    ar.set(r.invoiceId, r);
  }
  const loans = new Map();
  for (let i = 0; i < cLn && pos + 64 <= b.length; i++, pos += 64) {
    const r = decodeLoanWire(b, pos);
    loans.set(r.loanId, r);
  }
  const svc = new Map();
  if (cSvc > 0) {
    for (let i = 0; i < cSvc && pos + 96 <= b.length; i++, pos += 96) {
      const r = decodeSvcWire(b, pos);
      if (r.contractId > 0) svc.set(r.contractId, r);
    }
  } else {
    while (pos + 96 <= b.length) {
      const r = decodeSvcWire(b, pos);
      if (r.contractId > 0) svc.set(r.contractId, r);
      pos += 96;
    }
  }
  return { inv, assets, leases, def, ar, loans, svc };
}

function decodeAnchorStateHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < ANCHOR_HEADER_BYTES + 32 * 16) return null;

  const rawTotals = [];
  for (let c = 0; c < 32; c++) {
    const base = ANCHOR_HEADER_BYTES + c * 16;
    rawTotals.push({
      dr: readU64BE(b, base),
      cr: readU64BE(b, base + 8),
    });
  }

  const counts = [
    readU32BE(b, 244),
    readU32BE(b, 248),
    readU32BE(b, 252),
    readU32BE(b, 256),
    readU32BE(b, 260),
    readU32BE(b, 264),
    readU32BE(b, 268),
  ];
  const schedules = decodeSchedulesBlock(b, ANCHOR_HEADER_BYTES + 32 * 16, counts, 96);

  return {
    eventSourced: true,
    fiscalPeriod: readU64BE(b, 0),
    periodStartBlock: readU64BE(b, 8),
    lastClosedBlock: readU64BE(b, 16),
    anchorBlock: readU64BE(b, 24),
    currentBlock: readU64BE(b, 24),
    anchorJournalCount: readU64BE(b, 32),
    journalCount: readU64BE(b, 32),
    actualBankBalance: readU64BE(b, 40),
    baseFlags: readU64BE(b, 48),
    cfoNet: readI64BE(b, 56),
    cfiNet: readI64BE(b, 64),
    cffNet: readI64BE(b, 72),
    cfoIn: readU64BE(b, 80),
    cfoOut: readU64BE(b, 88),
    cfiIn: readU64BE(b, 96),
    cfiOut: readU64BE(b, 104),
    cffIn: readU64BE(b, 112),
    cffOut: readU64BE(b, 120),
    rpTxCount: readU64BE(b, 128),
    rpInflow: readU64BE(b, 136),
    rpOutflow: readU64BE(b, 144),
    opexRnd: readU64BE(b, 152),
    opexSm: readU64BE(b, 160),
    opexGa: readU64BE(b, 168),
    skuSaleCount: readU64BE(b, 176),
    corporateCharter: bytesToHex(b.slice(184, 204)).toLowerCase(),
    operatingBankLedger: bytesToHex(b.slice(204, 224)).toLowerCase(),
    treasuryIdentity: bytesToHex(b.slice(224, 244)).toLowerCase(),
    rawTotals,
    schedules,
  };
}

function decodeStatementsHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 640) return null;
  const balances = [];
  for (let i = 0; i < 32; i++) balances.push(readI64BE(b, 296 + i * 8));
  return {
    fiscalPeriod: readU64BE(b, 0),
    periodStartBlock: readU64BE(b, 8),
    lastClosedBlock: readU64BE(b, 16),
    asOfBlock: readU64BE(b, 24),
    journalCount: readU64BE(b, 32),
    actualBankBalance: readU64BE(b, 40),
    bookedCash1010: readU64BE(b, 48),
    unattributedBankInflow: readU64BE(b, 56),
    bankCustodyShortfall: readU64BE(b, 64),
    flags: readU64BE(b, 72),
    cfoNet: readI64BE(b, 80),
    cfiNet: readI64BE(b, 88),
    cffNet: readI64BE(b, 96),
    cfoIn: Math.max(0, readI64BE(b, 80)),
    cfoOut: Math.max(0, -readI64BE(b, 80)),
    cfiIn: Math.max(0, readI64BE(b, 88)),
    cfiOut: Math.max(0, -readI64BE(b, 88)),
    cffIn: Math.max(0, readI64BE(b, 96)),
    cffOut: Math.max(0, -readI64BE(b, 96)),
    rpTxCount: readU64BE(b, 104),
    rpInflow: readU64BE(b, 112),
    rpOutflow: readU64BE(b, 120),
    opexRnd: readU64BE(b, 128),
    opexSm: readU64BE(b, 136),
    opexGa: readU64BE(b, 144),
    unpostedDa: readU64BE(b, 152),
    unpostedDef: readU64BE(b, 160),
    targetEcl: readU64BE(b, 168),
    skuSaleCount: readU64BE(b, 176),
    totalCurrentAssets: readI64BE(b, 184),
    totalNonCurrentAssets: readI64BE(b, 192),
    totalAssets: readI64BE(b, 200),
    totalCurrentLiabilities: readI64BE(b, 208),
    totalNonCurrentLiabilities: readI64BE(b, 216),
    totalLiabilities: readI64BE(b, 224),
    totalEquity: readI64BE(b, 232),
    grossRevArmsLength: readI64BE(b, 240),
    grossRevRelatedParty: readI64BE(b, 248),
    netRevenue: readI64BE(b, 256),
    grossProfit: readI64BE(b, 264),
    ebit: readI64BE(b, 272),
    netIncome: readI64BE(b, 280),
    distributableProfit: readI64BE(b, 288),
    balances,
    corporateCharter: bytesToHex(b.slice(552, 572)).toLowerCase(),
    operatingBankLedger: bytesToHex(b.slice(572, 592)).toLowerCase(),
    treasuryIdentity: bytesToHex(b.slice(592, 612)).toLowerCase(),
  };
}

function decodeJournalSliceHex(hex) {
  if (!hex || hex === '0x') return { total: 0, entries: [] };
  const b = hexToBytes(hex);
  if (b.length < 16) return { total: 0, entries: [] };
  const total = readU64BE(b, 0);
  const count = readU64BE(b, 8);
  const entries = [];
  if (count === 0) return { total, entries };

  const rem = b.length - 16;
  const stride = rem >= count * 140 ? 140 : 112;
  let pos = 16;
  for (let i = 0; i < count && pos + stride <= b.length; i++, pos += stride) {
    const maxL = stride === 140 ? 8 : 6;
    const lineCnt = Math.min(maxL, b[pos + 19]);
    const linesBase = stride === 140 ? pos + 60 : pos + 48;
    const lines = [];
    for (let l = 0; l < lineCnt; l++) {
      const lb = linesBase + l * 10;
      lines.push({
        account: b[lb],
        side: b[lb + 1],
        amount: readU64BE(b, lb + 2),
      });
    }
    const cashDelta =
      stride === 140
        ? readI64BE(b, pos + 48)
        : lines.reduce(
            (acc, ln) => (ln.account === 0 ? acc + (ln.side === 0 ? ln.amount : -ln.amount) : acc),
            0
          );
    const memoSlice = stride === 140 ? b.slice(pos + 56, pos + 60) : b.slice(pos + 108, pos + 112);
    entries.push({
      entryId: readU64BE(b, pos),
      blockNumber: readU64BE(b, pos + 8),
      period: b[pos + 16],
      standardTag: b[pos + 17],
      cfClass: b[pos + 18],
      counterparty: bytesToHex(b.slice(pos + 20, pos + 40)).toLowerCase(),
      totalDebit: readU64BE(b, pos + 40),
      cashDelta,
      lines,
      memo: bytesToUtf8(memoSlice).replace(/\0/g, ''),
    });
  }
  return { total, entries };
}

// ============================================================================
// Pure Client-Side Statement Compiler (`compileStatementsFromStore`)
// ============================================================================

function compileFromTotalsAndStore(rawTotals, store, atBlock) {
  const dr = rawTotals.map((t) => t.dr);
  const cr = rawTotals.map((t) => t.cr);

  let unpostedPpeDepr = 0;
  let unpostedIntangAmort = 0;
  for (const a of store.schedules.assets.values()) {
    if (!a.disposed) {
      const cum = computeLinearDepreciation(
        a.cost,
        a.residual,
        a.usefulLifeBlocks,
        a.acquiredBlock,
        atBlock
      );
      a.liveDepr = cum;
      const delta = Math.max(0, cum - a.postedDepr);
      if (a.assetClass === 4) unpostedIntangAmort += delta;
      else unpostedPpeDepr += delta;
    } else {
      a.liveDepr = a.postedDepr;
    }
  }

  let unpostedRouAmort = 0;
  for (const ls of store.schedules.leases.values()) {
    if (ls.status === 2) {
      const cum = computeLinearDepreciation(
        ls.initialPv,
        0,
        ls.totalPeriods * ls.periodBlocks,
        ls.startBlock,
        atBlock
      );
      unpostedRouAmort += Math.max(0, cum - (ls.postedAmort || 0));
    }
  }

  let unpostedDefArms = 0;
  let unpostedDefRel = 0;
  for (const dc of store.schedules.def.values()) {
    const cum = computeLinearDeferredEarned(
      dc.totalAmount,
      dc.startBlock,
      dc.durationBlocks,
      atBlock
    );
    dc.liveEarned = cum;
    const delta = Math.max(0, cum - dc.postedEarned);
    if (dc.isRelated) unpostedDefRel += delta;
    else unpostedDefArms += delta;
  }

  let targetEcl = 0;
  for (const inv of store.schedules.ar.values()) {
    if (inv.status === 2 && inv.openAmount > 0) {
      const ecl = computeInvoiceEclAmount(inv.openAmount, inv.dueBlock, atBlock);
      inv.liveEcl = ecl;
      targetEcl += ecl;
    } else {
      inv.liveEcl = 0;
    }
  }

  const bookedCash = Math.max(0, dr[0] - cr[0]);
  const unattributedBankInflow =
    store.actualBankBalance > bookedCash ? store.actualBankBalance - bookedCash : 0;
  const bankCustodyShortfall =
    store.actualBankBalance < bookedCash ? bookedCash - store.actualBankBalance : 0;

  const totalUnpostedDa = unpostedPpeDepr + unpostedRouAmort + unpostedIntangAmort;
  if (totalUnpostedDa > 0) {
    dr[29] += totalUnpostedDa;
    cr[6] += unpostedPpeDepr;
    cr[8] += unpostedRouAmort;
    cr[10] += unpostedIntangAmort;
  }
  if (unpostedDefArms > 0) {
    dr[14] += unpostedDefArms;
    cr[24] += unpostedDefArms;
  }
  if (unpostedDefRel > 0) {
    dr[14] += unpostedDefRel;
    cr[25] += unpostedDefRel;
  }

  const curEcl = cr[2] - dr[2];
  if (targetEcl > curEcl) {
    const diff = targetEcl - curEcl;
    dr[30] += diff;
    cr[2] += diff;
  } else if (targetEcl < curEcl) {
    const diff = curEcl - targetEcl;
    dr[2] += diff;
    cr[30] += diff;
  }

  if (unattributedBankInflow > 0) {
    dr[0] += unattributedBankInflow;
    cr[18] += unattributedBankInflow;
  }

  const balances = COA_META.map((m, idx) =>
    m.normalSide === 0 ? dr[idx] - cr[idx] : cr[idx] - dr[idx]
  );

  const totalCurrentAssets = balances[0] + balances[1] - balances[2] + balances[3];
  const totalNonCurrentAssets =
    balances[4] + balances[5] - balances[6] + balances[7] - balances[8] + balances[9] - balances[10];
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

  const totalCurrentLiabilities =
    balances[11] + balances[12] + balances[13] + balances[14] + balances[15] + balances[18];
  const totalNonCurrentLiabilities = balances[16] + balances[17];
  const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;

  const grossRevArmsLength = balances[24];
  const grossRevRelatedParty = balances[25];
  const netRevenue = grossRevArmsLength + grossRevRelatedParty - balances[26];
  const grossProfit = netRevenue - balances[27];
  const ebit = grossProfit - balances[28] - balances[29] - balances[30];
  const netIncome = ebit - balances[31];

  const closedRetained = balances[23];
  const treasuryShares = balances[21];
  const distributableProfit = closedRetained + netIncome - treasuryShares;
  const totalEquity =
    balances[19] + balances[20] - treasuryShares + balances[22] + closedRetained + netIncome;

  const eqBalanced = totalAssets === totalLiabilities + totalEquity;
  const custodyClean = bankCustodyShortfall === 0;
  let flags = store.baseFlags & ~0b11;
  if (eqBalanced) flags |= 1;
  if (custodyClean) flags |= 2;

  return {
    fiscalPeriod: store.fiscalPeriod,
    periodStartBlock: store.periodStartBlock,
    lastClosedBlock: store.lastClosedBlock,
    asOfBlock: atBlock,
    journalCount: store.journalCount,
    actualBankBalance: store.actualBankBalance,
    bookedCash1010: bookedCash,
    unattributedBankInflow,
    bankCustodyShortfall,
    flags,
    cfoNet: store.cfoNet,
    cfiNet: store.cfiNet,
    cffNet: store.cffNet,
    cfoIn: store.cfoIn,
    cfoOut: store.cfoOut,
    cfiIn: store.cfiIn,
    cfiOut: store.cfiOut,
    cffIn: store.cffIn,
    cffOut: store.cffOut,
    rpTxCount: store.rpTxCount,
    rpInflow: store.rpInflow,
    rpOutflow: store.rpOutflow,
    opexRnd: store.opexRnd,
    opexSm: store.opexSm,
    opexGa: store.opexGa,
    unpostedDa: totalUnpostedDa,
    unpostedDef: unpostedDefArms + unpostedDefRel,
    targetEcl,
    skuSaleCount: store.skuSaleCount,
    totalCurrentAssets,
    totalNonCurrentAssets,
    totalAssets,
    totalCurrentLiabilities,
    totalNonCurrentLiabilities,
    totalLiabilities,
    totalEquity,
    grossRevArmsLength,
    grossRevRelatedParty,
    netRevenue,
    grossProfit,
    ebit,
    netIncome,
    distributableProfit,
    balances,
    corporateCharter: store.corporateCharter,
    operatingBankLedger: store.operatingBankLedger,
    treasuryIdentity: store.treasuryIdentity,
  };
}

function computeIntrinsicEqForStmt(st) {
  if (!st) return 0;
  return (
    computeTriangulatedValuation(st, state.marketCtx, state.valParams)?.composite.equityValue || 0
  );
}

function buildSeedTrajectoryFromJournal(store, ascendingEntries) {
  if (!ascendingEntries.length) {
    const cur = compileFromTotalsAndStore(store.rawTotals, store, store.currentBlock);
    return [
      {
        label: `#${store.currentBlock}`,
        tag: 'ANCHOR',
        block: store.currentBlock,
        assets: cur.totalAssets,
        equity: cur.totalEquity,
        cash: cur.actualBankBalance,
        revenue: cur.netRevenue,
        profit: cur.netIncome,
        intrinsic: computeIntrinsicEqForStmt(cur),
        _stmtSnap: cur,
      },
    ];
  }

  // Walk backward from anchor `rawTotals` across the fetched journal slice (within same period)
  const samePeriod = ascendingEntries.filter((e) => e.period === store.fiscalPeriod);
  const snapshotsRev = [];
  let work = store.rawTotals.map((t) => ({ dr: t.dr, cr: t.cr }));
  let workBank = store.actualBankBalance;

  for (let i = samePeriod.length - 1; i >= 0; i--) {
    const j = samePeriod[i];
    const tempStore = { ...store, actualBankBalance: Math.max(0, workBank) };
    const st = compileFromTotalsAndStore(work, tempStore, j.blockNumber);
    snapshotsRev.push({
      label: `J#${j.entryId}`,
      tag: j.memo || 'JRNL',
      block: j.blockNumber,
      assets: st.totalAssets,
      equity: st.totalEquity,
      cash: Math.max(0, workBank),
      revenue: st.netRevenue,
      profit: st.netIncome,
      intrinsic: computeIntrinsicEqForStmt(st),
      _stmtSnap: st,
    });
    work = work.map((t) => ({ dr: t.dr, cr: t.cr }));
    for (const ln of j.lines) {
      if (ln.side === 0) work[ln.account].dr = Math.max(0, work[ln.account].dr - ln.amount);
      else work[ln.account].cr = Math.max(0, work[ln.account].cr - ln.amount);
    }
    workBank -= j.cashDelta || 0;
  }

  const pts = snapshotsRev.reverse();
  const liveNow = compileFromTotalsAndStore(store.rawTotals, store, store.currentBlock);
  if (
    pts.length === 0 ||
    pts[pts.length - 1].block < store.currentBlock ||
    pts[pts.length - 1].profit !== liveNow.netIncome
  ) {
    pts.push({
      label: `#${store.currentBlock}`,
      tag: 'LIVE',
      block: store.currentBlock,
      assets: liveNow.totalAssets,
      equity: liveNow.totalEquity,
      cash: liveNow.actualBankBalance,
      revenue: liveNow.netRevenue,
      profit: liveNow.netIncome,
      intrinsic: computeIntrinsicEqForStmt(liveNow),
      _stmtSnap: liveNow,
    });
  }
  return pts.slice(-28);
}

// ============================================================================
// Application State & DOM Handles
// ============================================================================

const state = {
  busy: false,
  store: null, // AccountingStreamStore (live event-sourced state)
  stmt: null,
  sched: { inv: [], assets: [], leases: [], def: [], ar: [], loans: [], svc: [] },
  journal: [],
  trajectory: [],
  activeSeries: new Set(['assets', 'cash', 'revenue']),
  liveEvents: [],
  liveEventsCount: 0,
  blockAccrualTicks: 0,
  rpcPollsAfterAnchor: 0,
  seenLogKeys: new Set(),
  flashByAccount: new Map(), // coaIdx -> { delta, ts }
  parityStatus: 'Hydrating anchor…',
  myFiat: 0,
  myVerifiedIdentity: '',
  myIsDirector: false,
  myIsFinanceOfficer: false,
  myIsShareholder: false,
  consoleTab: 'sub',
  schedTab: 'svc',
  skuNames: new Map(),
  consoleRenderedForTab: '',
  marketCtx: {
    totalShares: 0,
    shareTicker: 'CORP-EQ',
    shareLedger: '',
    dexAddress: '',
    dexPrice: 0,
    dexBestBid: 0,
    dexBestAsk: 0,
    lastMatchBlock: 0,
  },
  valParams: { ...DEFAULT_VALUATION_PARAMS },
  valuation: null,
  kineticFx: true,
  humanJournal: true,
  hglTab: 'b2b_bulk',
  workspaceTab: 'statements',
  showZeroRows: false,
  showDiag: false,
  conf: {
    confLedgerAddr: '',
    directorCount: 0,
    auditEpoch: 0,
    auditPubKeys: new Map(), // epoch -> pub32Hex
    unwrappedAuditSecrets: new Map(), // epoch -> Uint8Array(32)
    auditorSubkeys: new Map(), // `${catLow}:${periodLow}` -> Uint8Array(32)
    auditorGrantLabels: [],
    categories: [],
    batches: [],
    receivables: [],
    shieldedPoolSupply: 0,
    shieldedNotes: [],
    ias24Insiders: [],
    myPayslipsAndNotes: [],
    myStealthContracts: [],
    previewPublic: false,
    feedTab: 'batches',
    composeTab: 'payroll',
    composeRenderedKey: '',
    payrollRows: [
      { recipient: '', amount: 18500, memo: 'Base + Security Clearance' },
      { recipient: '', amount: 14200, memo: 'Systems Engineering' },
    ],
  },
};

const el = {
  banner: document.getElementById('accBanner'),
  bannerText: document.getElementById('accBannerText'),
  bannerClose: document.getElementById('accBannerClose'),
  pillSummaryStatus: document.getElementById('pillSummaryStatus'),
  pillEquation: document.getElementById('pillEquation'),
  pillCustody: document.getElementById('pillCustody'),
  pillVirgin: document.getElementById('pillVirgin'),
  pillCodeHash: document.getElementById('pillCodeHash'),
  btnToggleKinetic: document.getElementById('btnToggleKinetic'),
  btnToggleDiag: document.getElementById('btnToggleDiag'),
  techDiagDrawer: document.getElementById('techDiagDrawer'),
  accWorkspaceTabs: document.getElementById('accWorkspaceTabs'),
  btnToggleZeroRows: document.getElementById('btnToggleZeroRows'),
  btnVerifyParity: document.getElementById('btnVerifyParity'),
  btnReanchor: document.getElementById('btnReanchor'),
  btnTopUpFiat: document.getElementById('btnTopUpFiat'),
  btnCrankAccruals: document.getElementById('btnCrankAccruals'),
  streamDot: document.getElementById('streamDot'),
  streamModeLabel: document.getElementById('streamModeLabel'),
  streamAnchorMeta: document.getElementById('streamAnchorMeta'),
  streamEventsMeta: document.getElementById('streamEventsMeta'),
  streamParityMeta: document.getElementById('streamParityMeta'),
  liveEventTicker: document.getElementById('liveEventTicker'),
  kpiCardAssets: document.getElementById('kpiCardAssets'),
  kpiCardLiabEq: document.getElementById('kpiCardLiabEq'),
  kpiCardRev: document.getElementById('kpiCardRev'),
  kpiCardProfit: document.getElementById('kpiCardProfit'),
  kpiCardCash: document.getElementById('kpiCardCash'),
  kpiAssets: document.getElementById('kpiAssets'),
  kpiAssetsSub: document.getElementById('kpiAssetsSub'),
  kpiLiabEq: document.getElementById('kpiLiabEq'),
  kpiLiabEqSub: document.getElementById('kpiLiabEqSub'),
  kpiArmsRev: document.getElementById('kpiArmsRev'),
  kpiRpRevSub: document.getElementById('kpiRpRevSub'),
  kpiNetIncome: document.getElementById('kpiNetIncome'),
  kpiDistributable: document.getElementById('kpiDistributable'),
  kpiBankCash: document.getElementById('kpiBankCash'),
  kpiSuspenseSub: document.getElementById('kpiSuspenseSub'),
  kpiPeriod: document.getElementById('kpiPeriod'),
  kpiJournalCnt: document.getElementById('kpiJournalCnt'),
  trajSubMeta: document.getElementById('trajSubMeta'),
  trajSeriesToggles: document.getElementById('trajSeriesToggles'),
  trajectoryChartMount: document.getElementById('trajectoryChartMount'),
  bsAsOfMeta: document.getElementById('bsAsOfMeta'),
  plPeriodMeta: document.getElementById('plPeriodMeta'),
  cfCustodyMeta: document.getElementById('cfCustodyMeta'),
  bsGraphicMount: document.getElementById('bsGraphicMount'),
  plGraphicMount: document.getElementById('plGraphicMount'),
  cfGraphicMount: document.getElementById('cfGraphicMount'),
  balanceSheetTable: document.getElementById('balanceSheetTable'),
  incomeStmtTable: document.getElementById('incomeStmtTable'),
  cashFlowTable: document.getElementById('cashFlowTable'),
  valRegimeBadge: document.getElementById('valRegimeBadge'),
  valIas24Badge: document.getElementById('valIas24Badge'),
  valMarketLinkBtn: document.getElementById('valMarketLinkBtn'),
  valKpiIntrinsicCard: document.getElementById('valKpiIntrinsicCard'),
  valKpiShareCard: document.getElementById('valKpiShareCard'),
  valKpiMarketCard: document.getElementById('valKpiMarketCard'),
  valKpiSignalCard: document.getElementById('valKpiSignalCard'),
  valKpiIntrinsicEq: document.getElementById('valKpiIntrinsicEq'),
  valKpiIntrinsicSub: document.getElementById('valKpiIntrinsicSub'),
  valKpiIntrinsicSh: document.getElementById('valKpiIntrinsicSh'),
  valKpiSharesSub: document.getElementById('valKpiSharesSub'),
  valKpiDexPx: document.getElementById('valKpiDexPx'),
  valKpiDexSub: document.getElementById('valKpiDexSub'),
  valKpiSignal: document.getElementById('valKpiSignal'),
  valKpiRatiosSub: document.getElementById('valKpiRatiosSub'),
  valWeightsLegend: document.getElementById('valWeightsLegend'),
  valFootballSvgMount: document.getElementById('valFootballSvgMount'),
  btnResetValParams: document.getElementById('btnResetValParams'),
  lblValWacc: document.getElementById('lblValWacc'),
  rngValWacc: document.getElementById('rngValWacc'),
  lblValGrowth: document.getElementById('lblValGrowth'),
  rngValGrowth: document.getElementById('rngValGrowth'),
  lblValBlocksYr: document.getElementById('lblValBlocksYr'),
  rngValBlocksYr: document.getElementById('rngValBlocksYr'),
  valSensitivityMount: document.getElementById('valSensitivityMount'),
  valDriversStrip: document.getElementById('valDriversStrip'),
  myRoleAndFiatMeta: document.getElementById('myRoleAndFiatMeta'),
  consoleTabs: document.getElementById('consoleTabs'),
  consolePane: document.getElementById('consolePane'),
  schedTabs: document.getElementById('schedTabs'),
  schedTable: document.getElementById('schedTable'),
  hglScenarioTabs: document.getElementById('hglScenarioTabs'),
  hglBlueprintMount: document.getElementById('hglBlueprintMount'),
  btnToggleHumanJournal: document.getElementById('btnToggleHumanJournal'),
  journalFeedMeta: document.getElementById('journalFeedMeta'),
  journalScrollWrap: document.getElementById('journalScrollWrap'),
  journalTbody: document.getElementById('journalTbody'),
  confRollupSection: document.getElementById('confRollupSection'),
  confHeroSub: document.getElementById('confHeroSub'),
  confViewerRoleBadge: document.getElementById('confViewerRoleBadge'),
  confShieldedPoolBadge: document.getElementById('confShieldedPoolBadge'),
  btnTogglePublicPreview: document.getElementById('btnTogglePublicPreview'),
  confCategoryGrid: document.getElementById('confCategoryGrid'),
  myConfidentialCard: document.getElementById('myConfidentialCard'),
  myConfidentialMount: document.getElementById('myConfidentialMount'),
  confFeedMeta: document.getElementById('confFeedMeta'),
  confFeedTabs: document.getElementById('confFeedTabs'),
  confFeedScrollWrap: document.getElementById('confFeedScrollWrap'),
  confFeedTable: document.getElementById('confFeedTable'),
  confOfficerBookingCard: document.getElementById('confOfficerBookingCard'),
  confComposeTabs: document.getElementById('confComposeTabs'),
  confComposeMount: document.getElementById('confComposeMount'),
};

function showBanner(html, kind = 'info') {
  el.banner.className = `inst-banner show ${kind}`;
  el.bannerText.innerHTML = html;
}
el.bannerClose?.addEventListener('click', () => el.banner.classList.remove('show'));

let accWatcher = null;
let hydrateInFlight = null;

const session = new SlxInstSession({
  activePage: 'accounting',
  title: 'SuperLexicon Realtime IFRS Accounting Ledger',
  subtitle: 'Event-Sourced Graphical Balance Sheet, P&L & Cash Flows • Virgin Treasury Custody',
  appTitle: 'Realtime IFRS Accounting Ledger — Graphical Statements & Event Stream',
  onRefresh: async () => {
    // Called on initial boot, wallet switch, or HfsRegistry company switch -> re-anchor cleanly!
    await hydrateAnchorSnapshot();
  },
  onIdentityLabelsUpdated: () => {
    if (state.stmt) renderAll();
  },
  onSelectHfsEntry: async () => {
    state.consoleRenderedForTab = '';
  },
});

function wrapExec(target, innerHex) {
  return encodeAbi('execute(address,bytes)', [
    ['address', target],
    ['bytes', hexToBytes(innerHex)],
  ]);
}

function syncSchedulesArraysFromStore() {
  if (!state.store) return;
  const sc = state.store.schedules;
  state.sched = {
    inv: Array.from(sc.inv.values()),
    assets: Array.from(sc.assets.values()).sort((a, b) => a.assetId - b.assetId),
    leases: Array.from(sc.leases.values()).sort((a, b) => a.leaseId - b.leaseId),
    def: Array.from(sc.def.values()).sort((a, b) => a.contractId - b.contractId),
    ar: Array.from(sc.ar.values()).sort((a, b) => a.invoiceId - b.invoiceId),
    loans: Array.from(sc.loans.values()).sort((a, b) => a.loanId - b.loanId),
    svc: Array.from((sc.svc || new Map()).values()).sort((a, b) => a.contractId - b.contractId),
  };
}

function pushTrajectoryPoint(label, tag, block) {
  const s = state.stmt;
  if (!s) return;
  const last = state.trajectory[state.trajectory.length - 1];
  if (
    last &&
    last.block === block &&
    last.tag === tag &&
    last.assets === s.totalAssets &&
    last.profit === s.netIncome &&
    last.cash === s.actualBankBalance
  ) {
    return;
  }
  state.trajectory.push({
    label,
    tag,
    block,
    assets: s.totalAssets,
    equity: s.totalEquity,
    cash: s.actualBankBalance,
    revenue: s.netRevenue,
    profit: s.netIncome,
    intrinsic: computeIntrinsicEqForStmt(s),
    _stmtSnap: s,
  });
  if (state.trajectory.length > 36) state.trajectory.shift();
}

function decodeAbiStringSimple(hex, fallback = 'CORP-EQ') {
  if (!hex || hex === '0x') return fallback;
  const b = hexToBytes(hex);
  if (b.length >= 64) {
    const len = readU64BE(b, 56);
    if (len > 0 && 64 + len <= b.length) {
      const s = bytesToUtf8(b.slice(64, 64 + len)).replace(/\0/g, '').trim();
      if (s) return s;
    }
  }
  return fallback;
}

async function hydrateMarketValuationContext(corporateCharter) {
  const chr = (corporateCharter || '').toLowerCase();
  const nextCtx = {
    totalShares: 0,
    shareTicker: 'CORP-EQ',
    shareLedger: '',
    dexAddress: '',
    dexPrice: 0,
    dexBestBid: 0,
    dexBestAsk: 0,
    lastMatchBlock: 0,
  };
  if (!chr || chr === ZERO_ADDR || !session.online) {
    state.marketCtx = nextCtx;
    state.myVerifiedIdentity = '';
    state.myIsDirector = false;
    state.myIsFinanceOfficer = false;
    state.myIsShareholder = false;
    return;
  }

  try {
    const myLow = await session.verifyMyIdentityBinding();
    state.myVerifiedIdentity = myLow || '';

    const [totHex, clsCntHex, dirHex, cfoHex, accRoleHex, vpHex] = await Promise.all([
      session
        .ethCall(chr, encodeAbi('convertedCommonTotals(address)', [['address', ZERO_ADDR]]))
        .catch(() => '0x'),
      session.ethCall(chr, encodeAbi('shareClassCount()')).catch(() => '0x0'),
      myLow
        ? session
            .ethCall(chr, encodeAbi('hasRole(bytes32,address)', [['bytes32', GOV_CONSTANTS.ROLE_DIRECTOR], ['address', myLow]]))
            .catch(() => '0x0')
        : Promise.resolve('0x0'),
      myLow
        ? session
            .ethCall(chr, encodeAbi('hasRole(bytes32,address)', [['bytes32', GOV_CONSTANTS.ROLE_TREASURY_MANAGER], ['address', myLow]]))
            .catch(() => '0x0')
        : Promise.resolve('0x0'),
      myLow
        ? session
            .ethCall(chr, encodeAbi('hasRole(bytes32,address)', [['bytes32', GOV_CONSTANTS.ROLE_CHIEF_ACCOUNTANT], ['address', myLow]]))
            .catch(() => '0x0')
        : Promise.resolve('0x0'),
      myLow
        ? session
            .ethCall(chr, encodeAbi('shareholderVotingPower(address)', [['address', myLow]]))
            .catch(() => '0x')
        : Promise.resolve('0x'),
    ]);
    const isDir = Boolean(myLow && decodeUintWord(dirHex) === 1);
    const isCfo = Boolean(myLow && decodeUintWord(cfoHex) === 1);
    const isChiefAcc = Boolean(myLow && decodeUintWord(accRoleHex) === 1);
    const vpBytes = hexToBytes(vpHex);
    const voterPower = vpBytes.length >= 64 ? readU64BE(vpBytes, 56) : 0;
    state.myIsDirector = isDir;
    state.myIsFinanceOfficer = Boolean(isDir || isCfo || isChiefAcc);
    state.myIsShareholder = Boolean(myLow && voterPower > 0);
    if (!state.myIsFinanceOfficer && ['ops', 'bilat', 'close'].includes(state.consoleTab)) {
      state.consoleTab = 'sub';
    }
    const totBytes = hexToBytes(totHex);
    if (totBytes.length >= 64) {
      nextCtx.totalShares = readU64BE(totBytes, 56);
    }
    const clsCnt = decodeUintWord(clsCntHex);
    if (clsCnt > 0) {
      const clsHex = await session
        .ethCall(chr, encodeAbi('getShareClass(uint64)', [['uint64', 0]]))
        .catch(() => '0x');
      const cb = hexToBytes(clsHex);
      if (cb.length >= 32) {
        nextCtx.shareLedger = bytesToHex(cb.slice(12, 32)).toLowerCase();
      }
    }
    if (nextCtx.shareLedger && nextCtx.shareLedger !== ZERO_ADDR) {
      const [symHex, supHex] = await Promise.all([
        session.ethCall(nextCtx.shareLedger, encodeAbi('symbol()')).catch(() => '0x'),
        nextCtx.totalShares === 0
          ? session.ethCall(nextCtx.shareLedger, encodeAbi('totalOutstanding()')).catch(() => '0x0')
          : Promise.resolve('0x0'),
      ]);
      nextCtx.shareTicker = decodeAbiStringSimple(symHex, 'CORP-EQ');
      if (nextCtx.totalShares === 0) {
        nextCtx.totalShares = decodeUintWord(supHex);
      }
    }

    // Resolve live DexClob market for this Charter's equity class (if publicly listed)
    const baseCharter = (session.baseInst?.corporateCharter || '').toLowerCase();
    if (chr === baseCharter && session.baseInst?.dexClob) {
      nextCtx.dexAddress = session.baseInst.dexClob.toLowerCase();
      if (!nextCtx.shareTicker || nextCtx.shareTicker === 'CORP-EQ') {
        nextCtx.shareTicker = 'NVDAX-EQ';
      }
    } else if (nextCtx.shareLedger && session.manifest?.hfsRegistry) {
      const dexListings = await fetchRegisteredHfsByType('DEX_CLOB', {
        rpcUrl: session.rpcUrl,
        registryAddr: session.manifest.hfsRegistry,
      }).catch(() => []);
      const matchedDex = dexListings.find(
        (it) => (it.meta?.shareLedger || '').toLowerCase() === nextCtx.shareLedger
      );
      if (matchedDex?.primaryAddr) {
        nextCtx.dexAddress = matchedDex.primaryAddr.toLowerCase();
      }
    }

    if (nextCtx.dexAddress) {
      const [sumHex, bestHex] = await Promise.all([
        session.ethCall(nextCtx.dexAddress, encodeAbi('lastMatchSummary()')).catch(() => '0x'),
        session.ethCall(nextCtx.dexAddress, encodeAbi('bestBidAndAsk()')).catch(() => '0x'),
      ]);
      const sum = decodeLastMatchSummaryHex(sumHex);
      const best = decodeBestBidAskHex(bestHex);
      nextCtx.dexBestBid = best.bestBid;
      nextCtx.dexBestAsk = best.bestAsk;
      nextCtx.lastMatchBlock = sum.lastMatchBlock;
      nextCtx.dexPrice =
        sum.clearingPrice ||
        (best.bestBid > 0 && best.bestAsk > 0
          ? Math.round((best.bestBid + best.bestAsk) / 2)
          : best.bestBid || best.bestAsk || 0);
    }
  } catch (e) {
    console.warn('Market valuation context warning:', e);
  }
  state.marketCtx = nextCtx;
}

function pushLiveEventPill(pill) {
  state.liveEvents.unshift({ ...pill, ts: Date.now() });
  if (state.liveEvents.length > 14) state.liveEvents.pop();
}

function pulseKpiCard(cardEl, tone = 'pos') {
  if (!cardEl || !state.kineticFx) return;
  const cls =
    tone === 'neg'
      ? 'ifrs-kpi-flash-neg'
      : tone === 'cyan'
        ? 'ifrs-kpi-flash-cyan'
        : 'ifrs-kpi-flash';
  cardEl.classList.remove('ifrs-kpi-flash', 'ifrs-kpi-flash-neg', 'ifrs-kpi-flash-cyan');
  void cardEl.offsetWidth;
  cardEl.classList.add(cls);
}

// ============================================================================
// Tactical Kinetic Financial Telemetry (Rolling Counters, +100K/-10K HUD & 60fps SVG)
// ============================================================================

const SVG_POPUP_TTL_MS = 2500;
const numericTweenMap = new WeakMap();
const prevCardMetrics = new Map();
let lastKineticStmt = null;
let lastKineticValEq = null;
let stmtTween = null;
let valEqTween = null;
let svgPopups = [];
let kineticRafId = 0;

function cubicOut(t) {
  const inv = 1 - Math.min(1, Math.max(0, t));
  return 1 - inv * inv * inv;
}

function fmtDeltaHud(delta, suffix = '') {
  const abs = Math.abs(delta);
  const sign = delta >= 0 ? '+' : '−';
  let mag;
  if (abs >= 1_000_000) mag = `${(abs / 1_000_000).toFixed(2)}M`;
  else if (abs >= 100_000) mag = `${Math.round(abs / 1_000)}K`;
  else if (abs >= 1_000) mag = `${(abs / 1_000).toFixed(1)}K`;
  else mag = fmtNum(Math.round(abs));
  return `${sign}${mag}${suffix ? ` ${suffix}` : ''}`;
}

function resetKineticBaseline() {
  prevCardMetrics.clear();
  lastKineticStmt = null;
  lastKineticValEq = null;
  stmtTween = null;
  valEqTween = null;
  svgPopups = [];
  if (kineticRafId) {
    cancelAnimationFrame(kineticRafId);
    kineticRafId = 0;
  }
}

function animateNumericNode(elNode, targetVal, fmtFn) {
  if (!elNode) return;
  const existing = numericTweenMap.get(elNode);
  if (!state.kineticFx || !existing || !Number.isFinite(existing.current)) {
    if (existing?.rafId) cancelAnimationFrame(existing.rafId);
    numericTweenMap.set(elNode, { current: targetVal, rafId: 0 });
    elNode.textContent = fmtFn(targetVal);
    return;
  }
  if (Math.abs(targetVal - existing.current) < 0.005) {
    elNode.textContent = fmtFn(targetVal);
    existing.current = targetVal;
    return;
  }
  if (existing.rafId) cancelAnimationFrame(existing.rafId);
  const fromVal = existing.current;
  const startTs = performance.now();
  const dur = 620;
  const step = (now) => {
    const t = Math.min(1, (now - startTs) / dur);
    const cur = fromVal + (targetVal - fromVal) * cubicOut(t);
    existing.current = cur;
    elNode.textContent = fmtFn(t >= 1 ? targetVal : cur);
    if (t < 1) {
      existing.rafId = requestAnimationFrame(step);
    } else {
      existing.current = targetVal;
      existing.rafId = 0;
    }
  };
  existing.rafId = requestAnimationFrame(step);
}

function trackCardDelta(key, cardEl, nextVal, opts = {}) {
  if (!Number.isFinite(nextVal)) return;
  const hasPrev = prevCardMetrics.has(key);
  const prev = prevCardMetrics.get(key);
  prevCardMetrics.set(key, nextVal);
  if (!hasPrev || !state.kineticFx || !cardEl) return;
  const delta = nextVal - prev;
  if (Math.abs(delta) < (opts.minDelta ?? 1)) return;

  const tone = opts.tone || (delta >= 0 ? 'pos' : 'neg');
  pulseKpiCard(cardEl, tone);

  const existingFloats = cardEl.querySelectorAll('.inst-hud-float');
  const stackIdx = Math.min(2, existingFloats.length);
  const badge = document.createElement('span');
  badge.className = `inst-hud-float ${tone}`;
  badge.style.top = `${6 + stackIdx * 21}px`;
  const arrow = tone === 'cyan' ? '◆' : delta >= 0 ? '▲' : '▼';
  const txt = opts.formatDelta ? opts.formatDelta(delta) : fmtDeltaHud(delta, opts.suffix || 'SGD');
  badge.textContent = `${arrow} ${txt}`;
  badge.addEventListener('animationend', () => badge.remove());
  cardEl.appendChild(badge);
}

function pushSvgPopup(chart, key, delta, opts = {}) {
  if (!state.kineticFx || Math.abs(delta) < (opts.minDelta ?? 50)) return;
  const now = performance.now();
  const existing = svgPopups.find(
    (p) => p.chart === chart && p.key === key && now - p.ts < 380
  );
  if (existing) {
    existing.delta += delta;
    existing.ts = now;
    if (opts.prefix) existing.prefix = opts.prefix;
    return;
  }
  svgPopups.push({
    chart,
    key,
    delta,
    tone: opts.tone || (delta >= 0 ? 'pos' : 'neg'),
    prefix: opts.prefix || '',
    ts: now,
  });
  if (svgPopups.length > 24) svgPopups.shift();
}

function renderSvgHudBadge(cx, baseY, pop, now, minX = 32, maxX = 328) {
  const age = Math.max(0, now - pop.ts);
  if (age >= SVG_POPUP_TTL_MS) return '';
  const p = age / SVG_POPUP_TTL_MS;
  const lift = 23 * (1 - Math.pow(1 - p, 2.3));
  const opacity =
    p < 0.1 ? p / 0.1 : p > 0.72 ? Math.max(0, 1 - (p - 0.72) / 0.28) : 1;
  const arrow = pop.tone === 'cyan' ? '◆' : pop.delta >= 0 ? '▲' : '▼';
  const txt = `${arrow} ${pop.prefix}${fmtDeltaHud(pop.delta)}`;
  const boxW = Math.max(50, txt.length * 6.2 + 12);
  const xMid = Math.max(minX + boxW / 2, Math.min(maxX - boxW / 2, cx));
  const yMid = Math.max(13, baseY - 9 - lift);
  const palette =
    pop.tone === 'cyan'
      ? { bg: 'rgba(8,42,66,0.95)', bd: '#22d3ee', fg: '#67e8f9' }
      : pop.tone === 'neg'
        ? { bg: 'rgba(58,12,26,0.95)', bd: '#fb7185', fg: '#fda4af' }
        : { bg: 'rgba(6,46,36,0.95)', bd: '#34d399', fg: '#6ee7b7' };
  return `
    <g opacity="${opacity.toFixed(2)}" pointer-events="none">
      <rect x="${(xMid - boxW / 2).toFixed(1)}" y="${(yMid - 8.5).toFixed(1)}" width="${boxW.toFixed(1)}" height="16.5" rx="4.5" fill="${palette.bg}" stroke="${palette.bd}" stroke-width="1.2" />
      <text x="${xMid.toFixed(1)}" y="${(yMid + 3).toFixed(1)}" text-anchor="middle" fill="${palette.fg}" font-family="JetBrains Mono,monospace" font-size="9.2" font-weight="800">${escapeHtml(txt)}</text>
    </g>
  `;
}

function lerpNum(a, b, w) {
  return (a || 0) + ((b || 0) - (a || 0)) * w;
}

function getDisplayStmt(now = performance.now()) {
  if (!state.stmt) return null;
  if (!state.kineticFx || !stmtTween) return state.stmt;
  const t = Math.min(1, Math.max(0, (now - stmtTween.startTs) / stmtTween.duration));
  if (t >= 1) return state.stmt;
  const w = cubicOut(t);
  const a = stmtTween.from;
  const b = stmtTween.to;
  return {
    ...b,
    actualBankBalance: Math.round(lerpNum(a.actualBankBalance, b.actualBankBalance, w)),
    bookedCash1010: Math.round(lerpNum(a.bookedCash1010, b.bookedCash1010, w)),
    unattributedBankInflow: Math.round(lerpNum(a.unattributedBankInflow, b.unattributedBankInflow, w)),
    cfoNet: Math.round(lerpNum(a.cfoNet, b.cfoNet, w)),
    cfiNet: Math.round(lerpNum(a.cfiNet, b.cfiNet, w)),
    cffNet: Math.round(lerpNum(a.cffNet, b.cffNet, w)),
    cfoIn: Math.round(lerpNum(a.cfoIn, b.cfoIn, w)),
    cfoOut: Math.round(lerpNum(a.cfoOut, b.cfoOut, w)),
    cfiIn: Math.round(lerpNum(a.cfiIn, b.cfiIn, w)),
    cfiOut: Math.round(lerpNum(a.cfiOut, b.cfiOut, w)),
    cffIn: Math.round(lerpNum(a.cffIn, b.cffIn, w)),
    cffOut: Math.round(lerpNum(a.cffOut, b.cffOut, w)),
    totalCurrentAssets: Math.round(lerpNum(a.totalCurrentAssets, b.totalCurrentAssets, w)),
    totalNonCurrentAssets: Math.round(lerpNum(a.totalNonCurrentAssets, b.totalNonCurrentAssets, w)),
    totalAssets: Math.round(lerpNum(a.totalAssets, b.totalAssets, w)),
    totalCurrentLiabilities: Math.round(lerpNum(a.totalCurrentLiabilities, b.totalCurrentLiabilities, w)),
    totalNonCurrentLiabilities: Math.round(lerpNum(a.totalNonCurrentLiabilities, b.totalNonCurrentLiabilities, w)),
    totalLiabilities: Math.round(lerpNum(a.totalLiabilities, b.totalLiabilities, w)),
    totalEquity: Math.round(lerpNum(a.totalEquity, b.totalEquity, w)),
    netRevenue: Math.round(lerpNum(a.netRevenue, b.netRevenue, w)),
    grossProfit: Math.round(lerpNum(a.grossProfit, b.grossProfit, w)),
    ebit: Math.round(lerpNum(a.ebit, b.ebit, w)),
    netIncome: Math.round(lerpNum(a.netIncome, b.netIncome, w)),
    balances: b.balances.map((bv, i) => Math.round(lerpNum(a.balances?.[i], bv, w))),
  };
}

function ensureKineticChartLoop() {
  if (kineticRafId || !state.kineticFx) return;
  const tick = (now) => {
    svgPopups = svgPopups.filter((p) => now - p.ts < SVG_POPUP_TTL_MS);
    const tweenActive = stmtTween && now - stmtTween.startTs < stmtTween.duration;
    const valTweenActive = valEqTween && now - valEqTween.startTs < valEqTween.duration;
    const disp = getDisplayStmt(now);
    if (disp) {
      renderTrajectoryChart(now);
      renderBalanceSheetGraphic(disp, now);
      renderProfitLossGraphic(disp, now);
      renderCashFlowGraphic(disp, now);
    }
    if (state.valuation && (valTweenActive || svgPopups.some((p) => p.chart === 'val'))) {
      renderFootballFieldSvg(state.valuation, now);
    }
    if (tweenActive || valTweenActive || svgPopups.length > 0) {
      kineticRafId = requestAnimationFrame(tick);
    } else {
      stmtTween = null;
      valEqTween = null;
      kineticRafId = 0;
    }
  };
  kineticRafId = requestAnimationFrame(tick);
}

function recordKineticStmtDelta(nextStmt) {
  if (!nextStmt) return;
  const prev = lastKineticStmt;
  if (!prev || !state.kineticFx || prev.fiscalPeriod !== nextStmt.fiscalPeriod) {
    lastKineticStmt = nextStmt;
    return;
  }
  const now = performance.now();
  const pb = prev.balances;
  const nb = nextStmt.balances;

  // Balance Sheet bar deltas
  const bsChecks = [
    ['1010 Cash', Math.max(0, nb[0]) - Math.max(0, pb[0]), null],
    ['1100 Net AR', Math.max(0, nb[1] - nb[2]) - Math.max(0, pb[1] - pb[2]), null],
    ['1200 WAC Inv', Math.max(0, nb[3]) - Math.max(0, pb[3]), null],
    ['1800 Backlog AR', Math.max(0, nb[4]) - Math.max(0, pb[4]), 'cyan'],
    ['Net PPE', Math.max(0, nb[5] - nb[6]) - Math.max(0, pb[5] - pb[6]), null],
    ['Net ROU', Math.max(0, nb[7] - nb[8]) - Math.max(0, pb[7] - pb[8]), null],
    ['Net Intang.', Math.max(0, nb[9] - nb[10]) - Math.max(0, pb[9] - pb[10]), null],
    ['Curr. Liab', nextStmt.totalCurrentLiabilities - prev.totalCurrentLiabilities, null],
    ['Leases & Debt', nextStmt.totalNonCurrentLiabilities - prev.totalNonCurrentLiabilities, null],
    ['Retained + P&L', nb[23] + nextStmt.netIncome - (pb[23] + prev.netIncome), null],
  ];
  let anyMoved = false;
  for (const [k, d, tone] of bsChecks) {
    if (Math.abs(d) >= 80) {
      pushSvgPopup('bs', k, d, { tone });
      anyMoved = true;
    }
  }

  // P&L Waterfall bar deltas
  const dRev = nextStmt.netRevenue - prev.netRevenue;
  const dCogs = -(nb[27] - pb[27]);
  const dOpex = -(nb[28] + nb[29] + nb[30] - (pb[28] + pb[29] + pb[30]));
  const dNi = nextStmt.netIncome - prev.netIncome;
  if (Math.abs(dRev) >= 80) { pushSvgPopup('pl', 'Net Rev', dRev); anyMoved = true; }
  if (Math.abs(dCogs) >= 80) { pushSvgPopup('pl', '−COGS', dCogs, { tone: 'neg' }); anyMoved = true; }
  if (Math.abs(dOpex) >= 80) { pushSvgPopup('pl', '−OpEx/DA', dOpex, { tone: 'neg' }); anyMoved = true; }
  if (Math.abs(dNi) >= 80) { pushSvgPopup('pl', 'Net P&L', dNi); anyMoved = true; }

  // Cash Flow Bridge bar deltas
  const dCfo = nextStmt.cfoNet - prev.cfoNet;
  const dCfi = nextStmt.cfiNet - prev.cfiNet;
  const dCff = nextStmt.cffNet - prev.cffNet;
  const dBank = nextStmt.actualBankBalance - prev.actualBankBalance;
  if (Math.abs(dCfo) >= 80) { pushSvgPopup('cf', 'CFO', dCfo); anyMoved = true; }
  if (Math.abs(dCfi) >= 80) { pushSvgPopup('cf', 'CFI', dCfi); anyMoved = true; }
  if (Math.abs(dCff) >= 80) { pushSvgPopup('cf', 'CFF', dCff); anyMoved = true; }
  if (Math.abs(dBank) >= 80) { pushSvgPopup('cf', 'Vault Cash', dBank); anyMoved = true; }

  // Trajectory Tip Hero Callout
  const dAssets = nextStmt.totalAssets - prev.totalAssets;
  if (Math.abs(dRev) >= 200) {
    pushSvgPopup('traj', 'tip', dRev, { prefix: 'REV ' });
  } else if (Math.abs(dBank) >= 200) {
    pushSvgPopup('traj', 'tip', dBank, { prefix: 'CASH ' });
  } else if (Math.abs(dAssets) >= 200) {
    pushSvgPopup('traj', 'tip', dAssets, { prefix: 'ASSETS ', tone: nb[4] > pb[4] ? 'cyan' : undefined });
  }

  if (anyMoved || dAssets !== 0 || dNi !== 0 || dBank !== 0) {
    const curDisp = getDisplayStmt(now) || prev;
    stmtTween = { from: curDisp, to: nextStmt, startTs: now, duration: 540 };
    ensureKineticChartLoop();
  }
  lastKineticStmt = nextStmt;
}

// ============================================================================
// Step 1: One-Time Anchor Snapshot Hydration (`getRealtimeAnchorState`)
// ============================================================================

async function hydrateAnchorSnapshot() {
  if (hydrateInFlight) return hydrateInFlight;
  hydrateInFlight = (async () => {
    if (!session.online || !session.inst?.accountingLedger) {
      renderAll();
      return;
    }
    for (const p of session.inst.products || []) {
      state.skuNames.set(p.skuId.toLowerCase(), p.name);
    }

    const acc = session.inst.accountingLedger.toLowerCase();
    try {
      const anchorHex = await session
        .ethCall(acc, encodeAbi('getRealtimeAnchorState()'))
        .catch(() => '0x');
      const parsedAnchor = decodeAnchorStateHex(anchorHex);

      if (parsedAnchor) {
        state.store = parsedAnchor;
        session.blockNumber = parsedAnchor.currentBlock;
        session.setNetStatus(
          `Subnet 1 Live • Event-Sourced @ Block #${fmtNum(parsedAnchor.currentBlock)}`,
          true
        );

        const jFrom = Math.max(0, parsedAnchor.journalCount - 20);
        const bankAddr = parsedAnchor.operatingBankLedger || session.inst.fiatLedger;
        const [jHex, myBal] = await Promise.all([
          session.ethCall(
            acc,
            encodeAbi('getJournalSlice(uint64,uint64)', [
              ['uint64', jFrom],
              ['uint64', 20],
            ])
          ),
          session.myIdentityAddr
            ? session.getLedgerBalance(bankAddr, session.myIdentityAddr)
            : Promise.resolve(0),
        ]);

        const jSlice = decodeJournalSliceHex(jHex);
        state.journal = jSlice.entries.slice().reverse();
        state.myFiat = myBal;
        state.liveEventsCount = 0;
        state.blockAccrualTicks = 0;
        state.rpcPollsAfterAnchor = 0;
        state.seenLogKeys.clear();
        state.flashByAccount.clear();
        resetKineticBaseline();

        state.stmt = compileFromTotalsAndStore(
          parsedAnchor.rawTotals,
          parsedAnchor,
          parsedAnchor.currentBlock
        );
        await hydrateMarketValuationContext(parsedAnchor.corporateCharter);
        syncSchedulesArraysFromStore();
        state.trajectory = buildSeedTrajectoryFromJournal(parsedAnchor, jSlice.entries);
        state.parityStatus = `Anchored @ #${fmtNum(parsedAnchor.anchorBlock)} (J#${parsedAnchor.anchorJournalCount})`;
        await hydrateConfidentialState();
      } else {
        // Fallback for older pre-event-sourced v1 ledger instances
        state.store = null;
        const [stmtHex, schedHex] = await Promise.all([
          session.ethCall(acc, encodeAbi('getFinancialStatements()')),
          session.ethCall(acc, encodeAbi('getSchedulesSnapshot()')),
        ]);
        const stmt = decodeStatementsHex(stmtHex);
        state.stmt = stmt;
        if (stmt) {
          session.blockNumber = stmt.asOfBlock;
          await hydrateMarketValuationContext(stmt.corporateCharter);
          const b = hexToBytes(schedHex);
          if (b.length >= 24) {
            const counts = [0, 4, 8, 12, 16, 20].map((o) => readU32BE(b, o));
            const maps = decodeSchedulesBlock(b, 24, counts, 88);
            state.sched = {
              inv: Array.from(maps.inv.values()),
              assets: Array.from(maps.assets.values()),
              leases: Array.from(maps.leases.values()),
              def: Array.from(maps.def.values()),
              ar: Array.from(maps.ar.values()),
              loans: Array.from(maps.loans.values()),
              svc: Array.from((maps.svc || new Map()).values()),
            };
          }
          state.trajectory = [
            {
              label: `#${stmt.asOfBlock}`,
              tag: 'SNAP',
              block: stmt.asOfBlock,
              assets: stmt.totalAssets,
              equity: stmt.totalEquity,
              cash: stmt.actualBankBalance,
              revenue: stmt.netRevenue,
              profit: stmt.netIncome,
              intrinsic: computeIntrinsicEqForStmt(stmt),
              _stmtSnap: stmt,
            },
          ];
          state.parityStatus = 'Legacy v1 Snapshot Mode';
        }
      }

      accWatcher?.refreshFilter?.();
      renderAll(true);
    } catch (err) {
      console.warn('IFRS anchor hydration warning:', err);
    } finally {
      hydrateInFlight = null;
    }
  })();
  return hydrateInFlight;
}

// ============================================================================
// Step 2: Zero-RPC Realtime WebSocket Event-Log & Block-Header Reducers
// ============================================================================

function handleIncomingLog(log) {
  const store = state.store;
  if (!store) {
    if (!log.isBackfill) hydrateAnchorSnapshot();
    return;
  }

  const logKey = `${log.txHash || ''}:${log.logIndex ?? ''}:${log.topics?.[0] || ''}`;
  if (log.txHash && state.seenLogKeys.has(logKey)) return;
  if (log.txHash) state.seenLogKeys.add(logKey);

  const emitter = (log.address || '').toLowerCase();
  const accAddr = (session.inst?.accountingLedger || '').toLowerCase();
  const bankAddr = (store.operatingBankLedger || '').toLowerCase();
  const t0 = (log.topics?.[0] || '').toLowerCase();

  // 1. Live Treasury & User Bank Balance Updates from `AssetLedger` (`Credited` / `Debited`)
  if (emitter === bankAddr && (t0 === TOPIC_BANK_CREDITED || t0 === TOPIC_BANK_DEBITED)) {
    const holderTopic = (log.topics?.[1] || '').toLowerCase();
    const holder = holderTopic.length >= 42 ? `0x${holderTopic.slice(-40)}` : '';
    const d = hexToBytes(log.data || '0x');
    if (d.length >= 16) {
      const amount = readU64BE(d, 0);
      const nextBal = readU64BE(d, 8);
      const isCredit = t0 === TOPIC_BANK_CREDITED;
      if (
        holder === store.treasuryIdentity &&
        (log.blockNumberNum > store.anchorBlock || !log.isBackfill)
      ) {
        if (store.actualBankBalance !== nextBal) {
          store.actualBankBalance = nextBal;
          store.currentBlock = Math.max(store.currentBlock, log.blockNumberNum || store.currentBlock);
          state.liveEventsCount += 1;
          pushLiveEventPill({
            badge: isCredit ? 'BANK +IN' : 'BANK −OUT',
            summary: `Treasury Vault ${isCredit ? '+' : '−'}${fmtNum(amount)} → ${fmtNum(nextBal)} SGD`,
            block: store.currentBlock,
          });
          state.stmt = compileFromTotalsAndStore(store.rawTotals, store, store.currentBlock);
          pushTrajectoryPoint(`#${store.currentBlock}`, isCredit ? 'CASH+' : 'CASH-', store.currentBlock);
          pulseKpiCard(el.kpiCardCash);
          renderAll();
        }
      }
      if (session.myIdentityAddr && holder === session.myIdentityAddr.toLowerCase()) {
        state.myFiat = nextBal;
        renderTelemetryAndHeader();
      }
    }
    return;
  }

  // 1B. Live On-Chain DEX Clearing Price Updates (`DexClob.BlockMatched`) — Zero-Poll Market Cap!
  const dexAddr = (state.marketCtx?.dexAddress || '').toLowerCase();
  if (
    dexAddr &&
    emitter === dexAddr &&
    t0 === GOV_CONSTANTS.TOPIC_BLOCK_MATCHED.toLowerCase()
  ) {
    const m = decodeBlockMatchedLog(log);
    if (m && m.price > 0 && (!log.isBackfill || m.block >= (state.marketCtx.lastMatchBlock || 0))) {
      const prevPx = state.marketCtx.dexPrice;
      state.marketCtx.dexPrice = m.price;
      state.marketCtx.lastMatchBlock = m.block;
      if (!log.isBackfill && m.price !== prevPx) {
        state.liveEventsCount += 1;
        pushLiveEventPill({
          badge: `DEX P* ${fmtNum(m.price)} SGD`,
          summary: `${state.marketCtx.shareTicker} cleared ${fmtNum(m.volume)} sh @ ${fmtNum(m.price)} SGD`,
          block: m.block,
        });
        pulseKpiCard(el.valKpiMarketCard);
        pulseKpiCard(el.valKpiSignalCard);
      }
      renderTelemetryAndHeader();
      renderValuationStudio();
    }
    return;
  }

  if (emitter === bankAddr && (t0 === TOPIC_SHIELDED_NOTE_MINTED || t0 === TOPIC_SHIELDED_NOTE_SPENT)) {
    if (!log.isBackfill) {
      state.liveEventsCount += 1;
      pushLiveEventPill({
        badge: t0 === TOPIC_SHIELDED_NOTE_MINTED ? '🔒 SHD +NOTE' : '🕵️ SHD SPENT',
        summary:
          t0 === TOPIC_SHIELDED_NOTE_MINTED
            ? 'Shielded SGD-FIAT commitment minted into pool'
            : 'Nullifier consumed on Shielded Note Pool ($0-gas ZK proof)',
        block: log.blockNumberNum || store.currentBlock,
      });
      hydrateConfidentialState().then(() => renderConfidentialWorkspace());
    }
    return;
  }

  const confAddr = (state.conf.confLedgerAddr || session.inst?.confidentialLedger || '').toLowerCase();
  const chrAddr = (store.corporateCharter || session.inst?.corporateCharter || '').toLowerCase();
  if (
    (confAddr && emitter === confAddr && (t0 === TOPIC_CONF_BATCH_POSTED || t0 === TOPIC_CONF_REC_UPDATED)) ||
    (chrAddr && emitter === chrAddr && (t0 === TOPIC_AUDIT_EPOCH_ROTATED || t0 === TOPIC_AUDITOR_KEY_GRANTED))
  ) {
    if (!log.isBackfill) {
      state.liveEventsCount += 1;
      pushLiveEventPill({
        badge:
          t0 === TOPIC_CONF_BATCH_POSTED
            ? '🔒 ZK ROLL-UP'
            : t0 === TOPIC_CONF_REC_UPDATED
              ? '🛡️ STEALTH AR'
              : '🔐 AUDIT KEY',
        summary:
          t0 === TOPIC_CONF_BATCH_POSTED
            ? 'Verified Confidential Category Roll-Up Batch committed'
            : t0 === TOPIC_CONF_REC_UPDATED
              ? 'Shielded Defense / B2B Receivable updated'
              : 'Charter Audit Key Epoch / Viewing Grant updated',
        block: log.blockNumberNum || store.currentBlock,
      });
      hydrateConfidentialState().then(() => {
        renderConfidentialWorkspace();
        if (state.schedTab === 'conf') renderSchedules();
      });
    }
    return;
  }

  if (emitter !== accAddr) return;

  // 2. Legacy v1 fallback if an older contract emitted the 5-arg topic
  if (t0 === TOPIC_JOURNAL_LEGACY) {
    if (!log.isBackfill) hydrateAnchorSnapshot();
    return;
  }

  // 3. `IfrsJournalPosted(uint64,address,bytes32,bytes)` — Full Double-Entry Delta!
  if (t0 === TOPIC_JOURNAL_POSTED && (log.topics?.length || 0) >= 4) {
    const t1 = hexToBytes(log.topics[1]);
    const t2 = hexToBytes(log.topics[2]);
    const meta = hexToBytes(log.topics[3]);
    const entryId = readU64BE(t1, 24);

    if (entryId <= store.journalCount) return; // Already in anchor snapshot!
    if (entryId > store.journalCount + 1) {
      // Gap on reconnect -> re-anchor cleanly
      hydrateAnchorSnapshot();
      return;
    }

    const counterparty = bytesToHex(t2.slice(12, 32)).toLowerCase();
    const period = meta[0];
    const standardTag = meta[1];
    const cfClass = meta[2];
    const lineCnt = meta[3];
    const memo = bytesToUtf8(meta.slice(4, 8)).replace(/\0/g, '') || 'IFRS';
    const blk = readU64BE(meta, 8) || log.blockNumberNum || store.currentBlock;
    const totalDebit = readU64BE(meta, 16);
    const cashDelta = readI64BE(meta, 24);

    const dataBytes = hexToBytes(log.data || '0x');
    const lines = [];
    const nowTs = Date.now();
    for (let l = 0; l < lineCnt && l * 10 + 10 <= dataBytes.length; l++) {
      const off = l * 10;
      const account = dataBytes[off];
      const side = dataBytes[off + 1];
      const amount = readU64BE(dataBytes, off + 2);
      lines.push({ account, side, amount });
      if (account < 32) {
        if (side === 0) store.rawTotals[account].dr += amount;
        else store.rawTotals[account].cr += amount;
        const normalSign = COA_META[account].normalSide === side ? 1 : -1;
        state.flashByAccount.set(account, { delta: normalSign * amount, ts: nowTs });
      }
    }

    if (cashDelta !== 0) {
      const mag = Math.abs(cashDelta);
      if (cfClass === 1) {
        store.cfoNet += cashDelta;
        if (cashDelta > 0) store.cfoIn += mag;
        else store.cfoOut += mag;
      } else if (cfClass === 2) {
        store.cfiNet += cashDelta;
        if (cashDelta > 0) store.cfiIn += mag;
        else store.cfiOut += mag;
      } else if (cfClass === 3) {
        store.cffNet += cashDelta;
        if (cashDelta > 0) store.cffIn += mag;
        else store.cffOut += mag;
      }
    }

    store.journalCount = entryId;
    store.fiscalPeriod = Math.max(store.fiscalPeriod, period);
    store.currentBlock = Math.max(store.currentBlock, blk);
    session.blockNumber = store.currentBlock;
    state.liveEventsCount += 1;

    const jEntry = {
      entryId,
      blockNumber: blk,
      period,
      standardTag,
      cfClass,
      counterparty,
      totalDebit,
      cashDelta,
      lines,
      memo,
    };
    state.journal.unshift(jEntry);
    if (state.journal.length > 24) state.journal.pop();

    const lineSummary = lines
      .slice(0, 2)
      .map((ln) => `${ln.side === 0 ? 'Dr' : 'Cr'} ${COA_META[ln.account]?.code || ln.account} ${fmtNum(ln.amount)}`)
      .join(' / ');
    pushLiveEventPill({
      badge: `J#${entryId} ${memo}`,
      summary: `${STD_LABELS[standardTag] || 'IFRS'} • ${lineSummary}`,
      block: blk,
    });

    state.stmt = compileFromTotalsAndStore(store.rawTotals, store, store.currentBlock);
    syncSchedulesArraysFromStore();
    pushTrajectoryPoint(`J#${entryId}`, memo, store.currentBlock);

    pulseKpiCard(el.kpiCardAssets);
    pulseKpiCard(el.kpiCardLiabEq);
    if (lines.some((l) => l.account === 24 || l.account === 25)) pulseKpiCard(el.kpiCardRev);
    if (lines.some((l) => l.account >= 24)) pulseKpiCard(el.kpiCardProfit);
    if (cashDelta !== 0) pulseKpiCard(el.kpiCardCash);

    renderAll();
    setTimeout(() => renderStatements(), FLASH_TTL_MS + 120);
    return;
  }

  // 4. `IfrsSubledgerUpdated(uint64,bytes32,bytes)` — Full Idempotent Schedule Row Upsert!
  if (t0 === TOPIC_SUBLEDGER_UPDATED && (log.topics?.length || 0) >= 3) {
    if (log.isBackfill && (log.blockNumberNum || 0) < store.anchorBlock) return;
    const kind = readU64BE(hexToBytes(log.topics[1]), 24);
    const d = hexToBytes(log.data || '0x');

    if (kind === 1 && d.length >= 56) {
      const r = decodeInvSkuWire(d, 0);
      store.schedules.inv.set(r.skuId, r);
    } else if (kind === 2 && d.length >= 64) {
      const r = decodeAssetWire(d, 0);
      store.schedules.assets.set(r.assetId, r);
    } else if (kind === 3 && d.length >= 96) {
      const r = decodeLeaseWire(d, 0, 96);
      store.schedules.leases.set(r.leaseId, r);
    } else if (kind === 4 && d.length >= 80) {
      const r = decodeDefWire(d, 0);
      store.schedules.def.set(r.contractId, r);
    } else if (kind === 5 && d.length >= 72) {
      const r = decodeInvoiceWire(d, 0);
      store.schedules.ar.set(r.invoiceId, r);
    } else if (kind === 6 && d.length >= 64) {
      const r = decodeLoanWire(d, 0);
      store.schedules.loans.set(r.loanId, r);
    } else if (kind === 7 && d.length >= 56) {
      store.rpTxCount = readU64BE(d, 0);
      store.rpInflow = readU64BE(d, 8);
      store.rpOutflow = readU64BE(d, 16);
      store.opexRnd = readU64BE(d, 24);
      store.opexSm = readU64BE(d, 32);
      store.opexGa = readU64BE(d, 40);
      store.skuSaleCount = readU64BE(d, 48);
    } else if (kind === 8 && d.length >= 96) {
      const r = decodeSvcWire(d, 0);
      if (!store.schedules.svc) store.schedules.svc = new Map();
      store.schedules.svc.set(r.contractId, r);
    }

    if (!log.isBackfill) {
      state.liveEventsCount += 1;
      const kindNames = {
        1: 'IAS 2 WAC SKU',
        2: 'IAS 16/38 Asset',
        3: 'IFRS 16 Lease',
        4: 'IFRS 15 Subscription',
        5: 'IFRS 9 Invoice',
        6: 'IFRS 9 Loan',
        7: 'IAS 24 / OpEx Meta',
        8: 'IFRS 15 Service Contract',
      };
      let summaryTxt = `Updated ${kindNames[kind] || 'Schedule'} @ #${fmtNum(log.blockNumberNum || store.currentBlock)}`;
      if (kind === 8 && d.length >= 96) {
        const r = decodeSvcWire(d, 0);
        const stWord =
          r.status === 1
            ? 'BOARD PROPOSED'
            : r.status === 2
              ? r.billedMonths === 0
                ? `SIGNED BACKLOG (${fmtCompact(r.monthlyAmount * r.totalMonths)} SGD)`
                : `MILESTONE ${r.billedMonths}/${r.totalMonths} BILLED`
              : 'COMPLETED';
        summaryTxt = `${r.contractTag}: ${stWord}`;
      }
      pushLiveEventPill({
        badge: kind === 8 ? 'DEFENSE / B2B' : 'SUBLEDGER',
        summary: summaryTxt,
        block: log.blockNumberNum || store.currentBlock,
      });
    }

    state.stmt = compileFromTotalsAndStore(store.rawTotals, store, store.currentBlock);
    syncSchedulesArraysFromStore();
    renderAll();
    return;
  }

  // 5. `IfrsFiscalPeriodClosed(uint64,int64,uint64,address)`
  if (t0 === TOPIC_PERIOD_CLOSED) {
    const d = hexToBytes(log.data || '0x');
    if (d.length >= 24) {
      const closedPeriod = readU64BE(d, 0);
      if (closedPeriod < store.fiscalPeriod) return;
      const closedBlk = readU64BE(d, 16);

      let netCrOverDr = 0;
      for (let idx = 24; idx < 32; idx++) {
        netCrOverDr += store.rawTotals[idx].cr - store.rawTotals[idx].dr;
        store.rawTotals[idx] = { dr: 0, cr: 0 };
      }
      if (netCrOverDr >= 0) store.rawTotals[23].cr += netCrOverDr;
      else store.rawTotals[23].dr += Math.abs(netCrOverDr);

      store.fiscalPeriod = closedPeriod + 1;
      store.lastClosedBlock = closedBlk;
      store.periodStartBlock = closedBlk;
      store.currentBlock = Math.max(store.currentBlock, closedBlk);
      store.opexRnd = 0;
      store.opexSm = 0;
      store.opexGa = 0;
      state.liveEventsCount += 1;

      pushLiveEventPill({
        badge: `CLOSE P#${closedPeriod}`,
        summary: `Rolled Net Income into 3400 Retained Earnings → Period #${store.fiscalPeriod}`,
        block: closedBlk,
      });
      state.stmt = compileFromTotalsAndStore(store.rawTotals, store, store.currentBlock);
      pushTrajectoryPoint(`P#${store.fiscalPeriod}`, 'CLOS', store.currentBlock);
      renderAll();
    }
  }
}

function handleIncomingHead(head) {
  const blk = head?.blockNumberNum || 0;
  if (!blk) return;
  session.blockNumber = blk;
  session.setNetStatus(`Subnet 1 Live • Event-Sourced @ Block #${fmtNum(blk)}`, true);

  const store = state.store;
  if (!store || blk <= store.currentBlock) return;

  const prevDa = state.stmt?.unpostedDa || 0;
  const prevDef = state.stmt?.unpostedDef || 0;
  const prevEcl = state.stmt?.targetEcl || 0;

  store.currentBlock = blk;
  state.stmt = compileFromTotalsAndStore(store.rawTotals, store, blk);
  syncSchedulesArraysFromStore();

  const moved =
    state.stmt.unpostedDa !== prevDa ||
    state.stmt.unpostedDef !== prevDef ||
    state.stmt.targetEcl !== prevEcl;
  if (moved) {
    state.blockAccrualTicks += 1;
    pushTrajectoryPoint(`#${blk}`, 'ACCR', blk);
  }
  renderAll();
}

// ============================================================================
// Step 3: On-Demand Cryptographic Parity Check vs On-Chain `eth_call`
// ============================================================================

async function verifyParityAgainstChain() {
  if (!state.store || !session.inst?.accountingLedger) return;
  try {
    el.btnVerifyParity.disabled = true;
    const acc = session.inst.accountingLedger;
    const onChainHex = await session.ethCall(acc, encodeAbi('getFinancialStatements()'));
    state.rpcPollsAfterAnchor += 1;
    const chainStmt = decodeStatementsHex(onChainHex);
    if (!chainStmt) throw new Error('Empty statement frame');

    // Recompile local event-sourced state at the exact `chainStmt.asOfBlock`
    const localAtSameBlk = compileFromTotalsAndStore(
      state.store.rawTotals,
      state.store,
      chainStmt.asOfBlock
    );

    let mismatches = 0;
    for (let i = 0; i < 32; i++) {
      if (localAtSameBlk.balances[i] !== chainStmt.balances[i]) mismatches++;
    }
    if (
      mismatches === 0 &&
      localAtSameBlk.totalAssets === chainStmt.totalAssets &&
      localAtSameBlk.netIncome === chainStmt.netIncome
    ) {
      state.parityStatus = `✓ 32/32 CoA Exact Parity @ #${fmtNum(chainStmt.asOfBlock)} (Δ = 0 SGD)`;
      showBanner(
        `✅ <strong>Zero-Drift Proof Verified @ Block #${fmtNum(chainStmt.asOfBlock)}:</strong> All 32 event-sourced CoA accounts, Balance Sheet (<code>${fmtNum(chainStmt.totalAssets)} SGD</code>), and Net Profit (<code>${fmtSigned(chainStmt.netIncome)} SGD</code>) match on-chain Wasmtime storage with <strong>Δ = 0 SGD</strong>!`,
        'ok'
      );
    } else {
      state.parityStatus = `Re-anchoring (${mismatches} in-flight block delta)…`;
      await hydrateAnchorSnapshot();
    }
    renderTelemetryAndHeader();
  } catch (err) {
    showBanner(`⚠ Parity check error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    el.btnVerifyParity.disabled = false;
  }
}

// ============================================================================
// Step 4: Graphical SVG Statement Visualizers (Realtime Animated)
// ============================================================================

function renderTrajectoryChart(now = performance.now()) {
  const pts = state.trajectory;
  if (!el.trajectoryChartMount) return;
  if (!pts.length) {
    el.trajectoryChartMount.innerHTML =
      '<div style="padding:48px;text-align:center;color:#64748b;font-family:var(--mono);font-size:12px;">Hydrating anchor state &amp; realtime trajectory…</div>';
    return;
  }

  // Smoothly interpolate the newest point while `stmtTween` is active!
  const dispLast = getDisplayStmt(now);
  const tweenActive = stmtTween && now - stmtTween.startTs < stmtTween.duration;
  const effectivePts =
    tweenActive && dispLast && pts.length > 0
      ? [
          ...pts.slice(0, -1),
          {
            ...pts[pts.length - 1],
            assets: dispLast.totalAssets,
            equity: dispLast.totalEquity,
            cash: dispLast.actualBankBalance,
            revenue: dispLast.netRevenue,
            profit: dispLast.netIncome,
          },
        ]
      : pts;

  const seriesDefs = [
    { key: 'assets', label: 'Assets', color: '#38bdf8' },
    { key: 'equity', label: 'Equity', color: '#a78bfa' },
    { key: 'cash', label: 'Cash', color: '#34d399' },
    { key: 'revenue', label: 'Revenue', color: '#fbbf24' },
    { key: 'profit', label: 'Net Profit', color: '#fb7185' },
    { key: 'intrinsic', label: 'Intrinsic V*', color: '#22d3ee' },
  ].filter((s) => state.activeSeries.has(s.key));

  const W = 980;
  const H = 212;
  const padL = 62;
  const padR = 112;
  const padT = 18;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let minV = 0;
  let maxV = 1000;
  for (const p of effectivePts) {
    for (const s of seriesDefs) {
      const v = p[s.key] ?? 0;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  const span = Math.max(1, maxV - minV) * 1.12;
  const yMax = minV + span;
  const yMin = minV < 0 ? minV * 1.1 : 0;
  const yRange = Math.max(1, yMax - yMin);

  const xAt = (i) =>
    effectivePts.length === 1 ? padL + plotW / 2 : padL + (i / (effectivePts.length - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - yMin) / yRange) * plotH;

  const gridTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const val = yMin + f * yRange;
    const y = yAt(val);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(51,65,85,0.45)" stroke-dasharray="3 4" />
      <text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="#64748b" font-family="JetBrains Mono,monospace" font-size="9.5">${fmtCompact(val)}</text>
    `;
  });

  const zeroLine =
    yMin < 0
      ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${W - padR}" y2="${yAt(0).toFixed(1)}" stroke="rgba(148,163,184,0.55)" stroke-width="1" />`
      : '';

  let tipX = xAt(effectivePts.length - 1);
  let tipTopY = H;

  const pathsHtml = seriesDefs
    .map((s, sIdx) => {
      const coords = effectivePts.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p[s.key] ?? 0).toFixed(1)}`);
      const dLine =
        effectivePts.length === 1
          ? `M ${padL},${yAt(effectivePts[0][s.key] ?? 0).toFixed(1)} L ${W - padR},${yAt(effectivePts[0][s.key] ?? 0).toFixed(1)}`
          : `M ${coords.join(' L ')}`;
      const lastPt = effectivePts[effectivePts.length - 1];
      const lx = xAt(effectivePts.length - 1);
      const ly = yAt(lastPt[s.key] ?? 0);
      if (ly < tipTopY) tipTopY = ly;
      const areaD =
        sIdx === 0 && effectivePts.length > 1
          ? `${dLine} L ${xAt(effectivePts.length - 1).toFixed(1)},${yAt(Math.max(0, yMin)).toFixed(1)} L ${xAt(0).toFixed(1)},${yAt(Math.max(0, yMin)).toFixed(1)} Z`
          : '';
      const sonar =
        state.kineticFx && sIdx === 0
          ? `<circle class="ifrs-sonar-ring" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5" fill="none" stroke="${s.color}" stroke-width="1.6" />`
          : '';
      return `
        ${areaD ? `<path d="${areaD}" fill="url(#trajGrad0)" opacity="0.22" />` : ''}
        <path d="${dLine}" fill="none" stroke="${s.color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
        ${sonar}
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${s.color}" stroke="#020617" stroke-width="1.5" />
        <text x="${W - padR + 8}" y="${Math.min(H - 10, Math.max(12, ly + 3.5)).toFixed(1)}" fill="${s.color}" font-family="JetBrains Mono,monospace" font-size="10" font-weight="700">
          ${fmtCompact(lastPt[s.key] ?? 0)}
        </text>
      `;
    })
    .join('');

  const tipPopSvg = svgPopups
    .filter((p) => p.chart === 'traj')
    .map((p) => renderSvgHudBadge(tipX - 38, Math.max(32, tipTopY), p, now, padL + 10, W - padR - 10))
    .join('');

  const xLabels = effectivePts
    .map((p, i) => {
      const step = Math.max(1, Math.ceil(effectivePts.length / 8));
      if (i !== 0 && i !== effectivePts.length - 1 && i % step !== 0) return '';
      const x = xAt(i);
      return `
        <g>
          <line x1="${x.toFixed(1)}" y1="${padT + plotH}" x2="${x.toFixed(1)}" y2="${padT + plotH + 4}" stroke="#475569" />
          <text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#94a3b8" font-family="JetBrains Mono,monospace" font-size="9.5">${escapeHtml(p.label)} (${escapeHtml(p.tag)})</text>
        </g>
      `;
    })
    .join('');

  el.trajectoryChartMount.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="trajGrad0" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${gridTicks.join('')}
      ${zeroLine}
      ${pathsHtml}
      ${xLabels}
      ${tipPopSvg}
    </svg>
  `;
}

function renderBalanceSheetGraphic(s, now = performance.now()) {
  if (!el.bsGraphicMount || !s) return;
  const b = s.balances;

  const assetSlices = [
    { label: '1010 Cash', val: Math.max(0, b[0]), color: '#34d399', accs: [0] },
    { label: '1100 Net AR', val: Math.max(0, b[1] - b[2]), color: '#38bdf8', accs: [1, 2] },
    { label: '1200 WAC Inv', val: Math.max(0, b[3]), color: '#fbbf24', accs: [3] },
    { label: '1800 Backlog AR', val: Math.max(0, b[4]), color: '#22d3ee', accs: [4] },
    { label: 'Net PPE', val: Math.max(0, b[5] - b[6]), color: '#60a5fa', accs: [5, 6] },
    { label: 'Net ROU', val: Math.max(0, b[7] - b[8]), color: '#818cf8', accs: [7, 8] },
    { label: 'Net Intang.', val: Math.max(0, b[9] - b[10]), color: '#c084fc', accs: [9, 10] },
  ].filter((x) => x.val > 0);

  const liabEqSlices = [
    {
      label: 'Curr. Liab',
      val: Math.max(0, s.totalCurrentLiabilities),
      color: '#fb7185',
      accs: [11, 12, 13, 14, 15, 18],
    },
    {
      label: 'Leases & Debt',
      val: Math.max(0, s.totalNonCurrentLiabilities),
      color: '#f97316',
      accs: [16, 17],
    },
    {
      label: 'Paid-In Cap',
      val: Math.max(0, b[19] + b[20] - b[21] + b[22]),
      color: '#a78bfa',
      accs: [19, 20, 21, 22],
    },
    {
      label: 'Retained + P&L',
      val: Math.max(0, b[23] + s.netIncome),
      color: '#2dd4bf',
      accs: [23, 24, 25, 27, 28, 29, 30, 31],
    },
  ].filter((x) => x.val > 0);

  const nowTs = Date.now();
  const isFlashing = (accs) =>
    accs.some((idx) => {
      const f = state.flashByAccount.get(idx);
      return f && nowTs - f.ts < FLASH_TTL_MS;
    });

  const W = 360;
  const H = 205;
  const topY = 30;
  const botY = 178;
  const maxH = botY - topY;
  const scaleMax = Math.max(1, s.totalAssets, s.totalLiabilities + s.totalEquity);
  const popAnchorByKey = new Map();

  const buildStack = (slices, x, colW) => {
    let curBottom = botY;
    return slices
      .map((sl) => {
        const h = Math.max(3, (sl.val / scaleMax) * maxH);
        const y = curBottom - h;
        curBottom = y;
        popAnchorByKey.set(sl.label, { cx: x + colW / 2, y: y + h * 0.35 });
        const pulse = isFlashing(sl.accs) ? 'ifrs-viz-pulse' : '';
        const showTxt = h >= 17;
        return `
          <g class="${pulse}">
            <rect class="ifrs-viz-bar" x="${x}" y="${y.toFixed(1)}" width="${colW}" height="${Math.max(1, h - 1.2).toFixed(1)}" rx="4" fill="${sl.color}" fill-opacity="0.86" />
            ${
              showTxt
                ? `<text x="${x + colW / 2}" y="${(y + h / 2 + 3.5).toFixed(1)}" text-anchor="middle" fill="#020617" font-family="JetBrains Mono,monospace" font-size="9.5" font-weight="800">${escapeHtml(sl.label)} ${fmtCompact(sl.val)}</text>`
                : ''
            }
          </g>
        `;
      })
      .join('');
  };

  const leftTowerSvg = buildStack(assetSlices, 42, 112);
  const rightTowerSvg = buildStack(liabEqSlices, 206, 112);
  const bsPopupsSvg = svgPopups
    .filter((p) => p.chart === 'bs')
    .map((p) => {
      const anc = popAnchorByKey.get(p.key) || { cx: p.key.includes('Liab') || p.key.includes('Retained') ? 262 : 98, y: 74 };
      return renderSvgHudBadge(anc.cx, anc.y, p, now, 10, W - 10);
    })
    .join('');

  const eqY = botY - (s.totalAssets / scaleMax) * maxH;
  const deficitNote =
    b[23] + s.netIncome < 0
      ? `<text x="${W / 2}" y="${H - 4}" text-anchor="middle" fill="#fda4af" font-family="JetBrains Mono,monospace" font-size="9.5">Accum. Deficit: ${fmtSigned(b[23] + s.netIncome)} SGD</text>`
      : `<text x="${W / 2}" y="${H - 4}" text-anchor="middle" fill="#6ee7b7" font-family="JetBrains Mono,monospace" font-size="9.5">✓ Assets (${fmtCompact(s.totalAssets)}) ≡ Liab + Eq (${fmtCompact(s.totalLiabilities + s.totalEquity)})</text>`;

  el.bsGraphicMount.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <line x1="28" y1="${eqY.toFixed(1)}" x2="${W - 28}" y2="${eqY.toFixed(1)}" stroke="#34d399" stroke-width="1.4" stroke-dasharray="4 3" />
      <text x="98" y="18" text-anchor="middle" fill="#e2e8f0" font-family="JetBrains Mono,monospace" font-size="10.5" font-weight="800">ASSETS (${fmtCompact(s.totalAssets)})</text>
      <text x="262" y="18" text-anchor="middle" fill="#e2e8f0" font-family="JetBrains Mono,monospace" font-size="10.5" font-weight="800">LIAB + EQ (${fmtCompact(s.totalLiabilities + s.totalEquity)})</text>
      <line x1="24" y1="${botY}" x2="${W - 24}" y2="${botY}" stroke="#475569" stroke-width="1.2" />
      ${leftTowerSvg}
      ${rightTowerSvg}
      ${deficitNote}
      ${bsPopupsSvg}
    </svg>
  `;
}

function renderProfitLossGraphic(s, now = performance.now()) {
  if (!el.plGraphicMount || !s) return;
  const b = s.balances;
  const cogs = b[27];
  const opExAll = b[28] + b[29] + b[30];
  const finTax = b[31];

  // Waterfall steps: `[label, startVal, endVal, isSubtotal, color]`
  const steps = [
    { label: 'Net Rev', from: 0, to: s.netRevenue, sub: true, color: '#38bdf8' },
    { label: '−COGS', from: s.netRevenue, to: s.grossProfit, sub: false, color: '#fb7185' },
    { label: 'Gross', from: 0, to: s.grossProfit, sub: true, color: '#2dd4bf' },
    { label: '−OpEx/DA', from: s.grossProfit, to: s.ebit, sub: false, color: '#f97316' },
    { label: '−Fin/Tax', from: s.ebit, to: s.netIncome, sub: false, color: '#f43f5e' },
    {
      label: 'Net P&L',
      from: 0,
      to: s.netIncome,
      sub: true,
      color: s.netIncome >= 0 ? '#34d399' : '#fb7185',
    },
  ];

  const W = 360;
  const H = 176;
  const topY = 22;
  const botY = 152;
  const plotH = botY - topY;

  let minV = 0;
  let maxV = 100;
  for (const st of steps) {
    minV = Math.min(minV, st.from, st.to);
    maxV = Math.max(maxV, st.from, st.to);
  }
  const pad = Math.max(50, (maxV - minV) * 0.14);
  const hi = maxV + pad;
  const lo = minV < 0 ? minV - pad * 0.6 : 0;
  const range = Math.max(1, hi - lo);
  const yOf = (v) => botY - ((v - lo) / range) * plotH;
  const zeroY = yOf(0);

  const slotW = (W - 24) / steps.length;
  const barW = slotW * 0.66;
  const plAnchors = new Map();

  const barsSvg = steps
    .map((st, idx) => {
      const x = 12 + idx * slotW + (slotW - barW) / 2;
      const y1 = yOf(st.from);
      const y2 = yOf(st.to);
      const rectY = Math.min(y1, y2);
      const rectH = Math.max(3, Math.abs(y2 - y1));
      plAnchors.set(st.label, { cx: x + barW / 2, y: rectY });
      const valShown = st.sub ? st.to : st.to - st.from;
      const bridge =
        idx < steps.length - 1
          ? `<line x1="${(x + barW).toFixed(1)}" y1="${y2.toFixed(1)}" x2="${(12 + (idx + 1) * slotW + (slotW - barW) / 2).toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(148,163,184,0.45)" stroke-dasharray="2 2" />`
          : '';
      return `
        ${bridge}
        <rect class="ifrs-viz-bar" x="${x.toFixed(1)}" y="${rectY.toFixed(1)}" width="${barW.toFixed(1)}" height="${rectH.toFixed(1)}" rx="3.5" fill="${st.color}" fill-opacity="${st.sub ? '0.92' : '0.78'}" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(11, rectY - 4).toFixed(1)}" text-anchor="middle" fill="#e2e8f0" font-family="JetBrains Mono,monospace" font-size="8.8" font-weight="700">${fmtCompact(valShown)}</text>
        <text x="${(x + barW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#94a3b8" font-family="JetBrains Mono,monospace" font-size="8.8">${st.label}</text>
      `;
    })
    .join('');

  const plPopupsSvg = svgPopups
    .filter((p) => p.chart === 'pl')
    .map((p) => {
      const anc = plAnchors.get(p.key);
      return anc ? renderSvgHudBadge(anc.cx, anc.y - 6, p, now, 10, W - 10) : '';
    })
    .join('');

  const gmPct = s.netRevenue > 0 ? ((s.grossProfit / s.netRevenue) * 100).toFixed(1) : '0.0';
  const ebitPct = s.netRevenue > 0 ? ((s.ebit / s.netRevenue) * 100).toFixed(1) : '0.0';
  const netPct = s.netRevenue > 0 ? ((s.netIncome / s.netRevenue) * 100).toFixed(1) : '0.0';
  void cogs;
  void opExAll;
  void finTax;

  el.plGraphicMount.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <line x1="12" y1="${zeroY.toFixed(1)}" x2="${W - 12}" y2="${zeroY.toFixed(1)}" stroke="#475569" stroke-width="1.1" />
      ${barsSvg}
      ${plPopupsSvg}
    </svg>
    <div class="ifrs-margin-strip">
      <span>Gross Margin: <strong style="color:#2dd4bf;">${gmPct}%</strong></span>
      <span>EBIT: <strong style="color:#38bdf8;">${ebitPct}%</strong></span>
      <span>Net Margin: <strong style="color:${s.netIncome >= 0 ? '#6ee7b7' : '#fda4af'};">${netPct}%</strong></span>
    </div>
  `;
}

function renderCashFlowGraphic(s, now = performance.now()) {
  if (!el.cfGraphicMount || !s) return;
  const c1 = s.cfoNet;
  const c2 = c1 + s.cfiNet;
  const c3 = c2 + s.cffNet;
  const c4 = c3 + s.unattributedBankInflow;

  const steps = [
    { label: 'CFO', from: 0, to: c1, val: s.cfoNet, sub: false, color: s.cfoNet >= 0 ? '#34d399' : '#fb7185' },
    { label: 'CFI', from: c1, to: c2, val: s.cfiNet, sub: false, color: s.cfiNet >= 0 ? '#38bdf8' : '#f97316' },
    { label: 'CFF', from: c2, to: c3, val: s.cffNet, sub: false, color: s.cffNet >= 0 ? '#a78bfa' : '#f43f5e' },
    { label: '2900 Susp', from: c3, to: c4, val: s.unattributedBankInflow, sub: false, color: '#fbbf24' },
    { label: 'Vault Cash', from: 0, to: s.actualBankBalance, val: s.actualBankBalance, sub: true, color: '#10b981' },
  ];

  const W = 360;
  const H = 148;
  const topY = 20;
  const botY = 126;
  const plotH = botY - topY;

  let minV = 0;
  let maxV = 100;
  for (const st of steps) {
    minV = Math.min(minV, st.from, st.to);
    maxV = Math.max(maxV, st.from, st.to);
  }
  const pad = Math.max(50, (maxV - minV) * 0.15);
  const hi = maxV + pad;
  const lo = minV < 0 ? minV - pad * 0.5 : 0;
  const range = Math.max(1, hi - lo);
  const yOf = (v) => botY - ((v - lo) / range) * plotH;
  const zeroY = yOf(0);

  const slotW = (W - 24) / steps.length;
  const barW = slotW * 0.64;
  const cfAnchors = new Map();

  const barsSvg = steps
    .map((st, idx) => {
      const x = 12 + idx * slotW + (slotW - barW) / 2;
      const y1 = yOf(st.from);
      const y2 = yOf(st.to);
      const rectY = Math.min(y1, y2);
      const rectH = Math.max(3, Math.abs(y2 - y1));
      cfAnchors.set(st.label, { cx: x + barW / 2, y: rectY });
      const bridge =
        idx < steps.length - 1
          ? `<line x1="${(x + barW).toFixed(1)}" y1="${y2.toFixed(1)}" x2="${(12 + (idx + 1) * slotW + (slotW - barW) / 2).toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(148,163,184,0.45)" stroke-dasharray="2 2" />`
          : '';
      return `
        ${bridge}
        <rect class="ifrs-viz-bar" x="${x.toFixed(1)}" y="${rectY.toFixed(1)}" width="${barW.toFixed(1)}" height="${rectH.toFixed(1)}" rx="3.5" fill="${st.color}" fill-opacity="${st.sub ? '0.95' : '0.8'}" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(11, rectY - 4).toFixed(1)}" text-anchor="middle" fill="#e2e8f0" font-family="JetBrains Mono,monospace" font-size="8.8" font-weight="700">${fmtCompact(st.val)}</text>
        <text x="${(x + barW / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" fill="#94a3b8" font-family="JetBrains Mono,monospace" font-size="8.8">${st.label}</text>
      `;
    })
    .join('');

  const cfPopupsSvg = svgPopups
    .filter((p) => p.chart === 'cf')
    .map((p) => {
      const anc = cfAnchors.get(p.key);
      return anc ? renderSvgHudBadge(anc.cx, anc.y - 5, p, now, 10, W - 10) : '';
    })
    .join('');

  const grossMax = Math.max(1, s.cfoIn + s.cfoOut, s.cfiIn + s.cfiOut, s.cffIn + s.cffOut);
  const splitRow = (lbl, inn, out) => {
    const wIn = ((inn / grossMax) * 100).toFixed(1);
    const wOut = ((out / grossMax) * 100).toFixed(1);
    return `
      <div class="ifrs-cf-split-row">
        <strong style="color:#cbd5e1;">${lbl}</strong>
        <div class="ifrs-cf-dual-track">
          <div style="width:${wIn}%;background:#34d399;"></div>
          <div style="width:${wOut}%;background:#fb7185;"></div>
        </div>
        <span style="color:#94a3b8;">+${fmtCompact(inn)} / −${fmtCompact(out)}</span>
      </div>
    `;
  };

  el.cfGraphicMount.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <line x1="12" y1="${zeroY.toFixed(1)}" x2="${W - 12}" y2="${zeroY.toFixed(1)}" stroke="#475569" stroke-width="1.1" />
      ${barsSvg}
      ${cfPopupsSvg}
    </svg>
    <div class="ifrs-cf-split-grid">
      ${splitRow('CFO', s.cfoIn || 0, s.cfoOut || 0)}
      ${splitRow('CFI', s.cfiIn || 0, s.cfiOut || 0)}
      ${splitRow('CFF', s.cffIn || 0, s.cffOut || 0)}
    </div>
  `;
}

// ============================================================================
// Step 5: Telemetry Ribbon & Tabular Statement Renderers
// ============================================================================

function renderTelemetryAndHeader() {
  const store = state.store;
  const s = state.stmt;
  if (el.streamDot) {
    el.streamDot.className = `ifrs-live-dot ${store ? '' : 'warn'}`;
  }
  if (el.streamModeLabel) {
    el.streamModeLabel.textContent = store
      ? 'EVENT-SOURCED REALTIME STREAM'
      : 'SNAPSHOT FALLBACK MODE';
  }
  if (el.streamAnchorMeta && store) {
    el.streamAnchorMeta.textContent = `Anchor #${fmtNum(store.anchorBlock)} (J#${store.anchorJournalCount}) → Head #${fmtNum(store.currentBlock)}`;
  }
  if (el.streamEventsMeta) {
    el.streamEventsMeta.textContent = `+${fmtNum(state.liveEventsCount)} Live Event Logs • ${fmtNum(state.blockAccrualTicks)} Accrual Ticks • ${state.rpcPollsAfterAnchor} Polls`;
  }
  if (el.streamParityMeta) {
    el.streamParityMeta.textContent = state.parityStatus;
  }
  if (el.liveEventTicker) {
    if (state.liveEvents.length) {
      const now = Date.now();
      el.liveEventTicker.innerHTML = state.liveEvents
        .map(
          (ev) => `
          <span class="ifrs-ev-pill ${now - ev.ts < 6000 ? 'fresh' : ''}">
            <strong style="color:#7dd3fc;">⚡ ${escapeHtml(ev.badge)}</strong>
            <span>${escapeHtml(ev.summary)}</span>
          </span>
        `
        )
        .join('');
    }
  }
  if (s && el.myRoleAndFiatMeta) {
    const roleTag = state.myIsFinanceOfficer
      ? 'CFO / Board Officer ✓'
      : state.myIsShareholder
        ? 'Shareholder (Read-Only Treasury)'
        : 'External Observer';
    el.myRoleAndFiatMeta.textContent = state.myVerifiedIdentity
      ? `${roleTag} • My Cash (${shortAddr(s.operatingBankLedger)}): ${fmtNum(state.myFiat)} SGD`
      : 'External Observer • Connect / Top-Up to bind Identity';
  }
}

function renderRow(idx, val, _scaleDenom, opts = {}) {
  const m = COA_META[idx];
  const friendly = FRIENDLY_COA[idx]?.short || m.name;
  const isContra = Boolean(m.contra || opts.contra);

  const fl = state.flashByAccount.get(idx);
  const isFresh = fl && Date.now() - fl.ts < FLASH_TTL_MS;

  if (val === 0 && !state.showZeroRows && !isFresh && !opts.alwaysShow) {
    return '';
  }

  const display = isContra ? (val === 0 ? '0' : `(${fmtNum(Math.abs(val))})`) : fmtSigned(val);
  const rowCls = isFresh ? (fl.delta >= 0 ? 'row-flash-pos' : 'row-flash-neg') : '';
  const deltaHtml = isFresh
    ? `<span class="ifrs-delta-badge ${fl.delta >= 0 ? 'pos' : 'neg'}">${fl.delta >= 0 ? '+' : '−'}${fmtNum(Math.abs(fl.delta))}</span>`
    : '';

  return `
    <tr class="${rowCls}" title="${escapeHtml(`${m.code} • ${m.name} (${m.std})`)}">
      <td class="${isContra ? 'ifrs-contra' : ''}">
        <span class="ifrs-code">${m.code}</span>${escapeHtml(friendly)}
      </td>
      <td class="num ${isContra ? 'ifrs-contra' : ''}">
        ${deltaHtml}<span>${display}</span>
      </td>
    </tr>
  `;
}

function fmtSharePx(px) {
  if (px === null || px === undefined || !Number.isFinite(px)) return '—';
  if (px >= 100) return `${px.toFixed(1)} SGD`;
  return `${px.toFixed(2)} SGD`;
}

function renderFootballFieldSvg(val, now = performance.now()) {
  if (!el.valFootballSvgMount || !val) return;
  const lenses = val.lenses;
  const W = 770;
  const rowH = 44;
  const padT = 32;
  const padB = 26;
  const H = padT + lenses.length * rowH + padB;
  const padL = 186;
  const padR = 148;
  const plotW = W - padL - padR;

  const valW =
    valEqTween && state.kineticFx && now - valEqTween.startTs < valEqTween.duration
      ? cubicOut((now - valEqTween.startTs) / valEqTween.duration)
      : 1;
  const dispCompEq =
    valW < 1
      ? Math.round(lerpNum(valEqTween.fromEq, val.composite.equityValue, valW))
      : val.composite.equityValue;

  let rawMin = Infinity;
  let rawMax = 1000;
  for (const ln of lenses) {
    rawMin = Math.min(rawMin, ln.low, ln.equity);
    rawMax = Math.max(rawMax, ln.high, ln.equity);
  }
  rawMax = Math.max(rawMax, dispCompEq, val.composite.equityValue);
  if (val.market.marketCap) rawMax = Math.max(rawMax, val.market.marketCap);

  // Adaptive zoom: zoom in when all lenses cluster tightly (e.g. Meridian pre-revenue), else anchor at 0
  const xMin = rawMin > 0.45 * rawMax ? Math.floor(rawMin * 0.72) : 0;
  const xMax = Math.max(xMin + 100, Math.ceil(rawMax * 1.1));
  const xSpan = Math.max(1, xMax - xMin);
  const xOf = (v) => padL + Math.max(0, Math.min(1, (v - xMin) / xSpan)) * plotW;

  const gridTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = xMin + f * xSpan;
    const x = padL + f * plotW;
    return `
      <line x1="${x.toFixed(1)}" y1="${padT - 4}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="rgba(51,65,85,0.48)" stroke-dasharray="3 3" />
      <text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-family="JetBrains Mono,monospace" font-size="9.5">${fmtCompact(v)}</text>
    `;
  });

  const rowsSvg = lenses
    .map((ln, idx) => {
      const cy = padT + idx * rowH + rowH * 0.5;
      const xLo = xOf(ln.low);
      const xHi = xOf(ln.high);
      const xMid = xOf(ln.equity);
      const barW = Math.max(8, xHi - xLo);
      const barX = Math.min(xLo, xMid - 4);
      const wtTag =
        ln.weightPct !== null
          ? ln.weightPct > 0
            ? `${ln.weightPct}% wt`
            : 'floor'
          : 'LIVE P*';
      const shTxt =
        ln.sharePrice !== null ? `${fmtSharePx(ln.sharePrice)}/sh` : `${fmtCompact(ln.equity)} SGD`;
      const subEqTxt =
        ln.sharePrice !== null ? `${fmtCompact(ln.equity)} SGD` : 'Unshared Charter';

      return `
        <g>
          <rect x="6" y="${(cy - 18).toFixed(1)}" width="${W - 12}" height="36" rx="6" fill="${idx % 2 === 0 ? 'rgba(15,23,42,0.46)' : 'rgba(15,23,42,0.18)'}" />
          <text x="12" y="${(cy - 3).toFixed(1)}" fill="#e2e8f0" font-family="JetBrains Mono,monospace" font-size="10.5" font-weight="700">${escapeHtml(ln.shortLabel)}</text>
          <text x="12" y="${(cy + 11).toFixed(1)}" fill="${ln.color}" font-family="JetBrains Mono,monospace" font-size="9" font-weight="600">[${wtTag}] ${escapeHtml(ln.formulaNote.slice(0, 26))}</text>

          <line x1="${xLo.toFixed(1)}" y1="${(cy - 6).toFixed(1)}" x2="${xLo.toFixed(1)}" y2="${(cy + 6).toFixed(1)}" stroke="${ln.color}" stroke-width="1.5" />
          <line x1="${xHi.toFixed(1)}" y1="${(cy - 6).toFixed(1)}" x2="${xHi.toFixed(1)}" y2="${(cy + 6).toFixed(1)}" stroke="${ln.color}" stroke-width="1.5" />
          <rect class="ifrs-viz-bar" x="${barX.toFixed(1)}" y="${(cy - 8).toFixed(1)}" width="${barW.toFixed(1)}" height="16" rx="4.5" fill="${ln.color}" fill-opacity="0.28" stroke="${ln.color}" stroke-width="1.4" />
          <polygon points="${xMid.toFixed(1)},${(cy - 6.5).toFixed(1)} ${(xMid + 6).toFixed(1)},${cy.toFixed(1)} ${xMid.toFixed(1)},${(cy + 6.5).toFixed(1)} ${(xMid - 6).toFixed(1)},${cy.toFixed(1)}" fill="${ln.color}" stroke="#020617" stroke-width="1.2" />

          <text x="${W - 12}" y="${(cy - 2).toFixed(1)}" text-anchor="end" fill="#f8fafc" font-family="JetBrains Mono,monospace" font-size="10.8" font-weight="800">${escapeHtml(shTxt)}</text>
          <text x="${W - 12}" y="${(cy + 11).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-family="JetBrains Mono,monospace" font-size="9.2">${escapeHtml(subEqTxt)}</text>
        </g>
      `;
    })
    .join('');

  const xComp = xOf(dispCompEq);
  const compBannerTxt =
    val.composite.sharePrice !== null
      ? `V* ${fmtSharePx(val.composite.sharePrice)}/sh`
      : `V* ${fmtCompact(dispCompEq)}`;

  let mktPinSvg = '';
  if (val.market.hasMarketPrice && val.market.marketCap) {
    const xMkt = xOf(val.market.marketCap);
    // Offset label slightly if V* and DEX P* are very close horizontally
    const mktLabelY = Math.abs(xMkt - xComp) < 92 ? H - padB - 4 : 15;
    mktPinSvg = `
      <line x1="${xMkt.toFixed(1)}" y1="${padT - 8}" x2="${xMkt.toFixed(1)}" y2="${H - padB}" stroke="#fb7185" stroke-width="1.8" stroke-dasharray="4 3" />
      <text x="${Math.min(W - padR - 4, Math.max(padL + 4, xMkt)).toFixed(1)}" y="${mktLabelY}" text-anchor="middle" fill="#fda4af" font-family="JetBrains Mono,monospace" font-size="9.5" font-weight="800">DEX P* ${fmtNum(val.market.dexPrice)} SGD</text>
    `;
  }

  const valPopupsSvg = svgPopups
    .filter((p) => p.chart === 'val')
    .map((p) => renderSvgHudBadge(xComp, padT + 26, p, now, padL + 8, W - padR - 8))
    .join('');

  el.valFootballSvgMount.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      ${gridTicks.join('')}
      ${rowsSvg}
      <line x1="${xComp.toFixed(1)}" y1="${padT - 10}" x2="${xComp.toFixed(1)}" y2="${H - padB}" stroke="#22d3ee" stroke-width="2.2" stroke-dasharray="5 3" />
      <rect x="${Math.min(W - padR - 58, Math.max(padL - 10, xComp - 56)).toFixed(1)}" y="4" width="112" height="17" rx="4" fill="rgba(8,47,73,0.95)" stroke="#22d3ee" stroke-width="1.1" />
      <text x="${Math.min(W - padR - 2, Math.max(padL + 46, xComp)).toFixed(1)}" y="15.5" text-anchor="middle" fill="#67e8f9" font-family="JetBrains Mono,monospace" font-size="9.5" font-weight="800">${escapeHtml(compBannerTxt)}</text>
      ${mktPinSvg}
      ${valPopupsSvg}
    </svg>
  `;
}

function renderValuationStudio() {
  const s = state.stmt;
  if (!s || !el.valKpiIntrinsicEq) return;

  const val = computeTriangulatedValuation(s, state.marketCtx, state.valParams);
  state.valuation = val;
  if (!val) return;

  const f = val.fundamentals;
  const m = val.market;
  const c = val.composite;
  const r = val.ratios;

  if (lastKineticValEq !== null && state.kineticFx) {
    const dVal = c.equityValue - lastKineticValEq;
    if (Math.abs(dVal) >= 250) {
      pushSvgPopup('val', 'comp', dVal, {
        prefix: 'V* ',
        tone: dVal >= 0 ? 'cyan' : 'neg',
      });
      valEqTween = {
        fromEq: lastKineticValEq,
        toEq: c.equityValue,
        startTs: performance.now(),
        duration: 560,
      };
      ensureKineticChartLoop();
    }
  }
  lastKineticValEq = c.equityValue;

  if (el.valRegimeBadge) {
    el.valRegimeBadge.textContent = `${c.regime} (${f.rawElapsedBlocks} blks)`;
  }
  if (el.valIas24Badge) {
    if (f.relatedPartyRevStripped > 0) {
      el.valIas24Badge.className = 'ifrs-stream-chip amber';
      el.valIas24Badge.textContent = `⚠ IAS 24 Stripped ${fmtNum(f.relatedPartyRevStripped)} SGD Wash Rev`;
    } else {
      el.valIas24Badge.className = 'ifrs-stream-chip emerald';
      el.valIas24Badge.textContent = '✓ IAS 24 Clean (0 Wash Rev)';
    }
  }
  if (el.valMarketLinkBtn) {
    if (m.dexAddress) {
      el.valMarketLinkBtn.href = `/dex.html?hfs=${encodeURIComponent(m.dexAddress)}`;
      el.valMarketLinkBtn.textContent = `📈 Trade ${m.shareTicker} on DEX →`;
    } else if (s.corporateCharter && s.corporateCharter !== ZERO_ADDR) {
      el.valMarketLinkBtn.href = `/charter.html?hfs=${encodeURIComponent(s.corporateCharter)}`;
      el.valMarketLinkBtn.textContent = `🏛️ Open ${m.shareTicker} Charter →`;
    }
  }

  animateNumericNode(el.valKpiIntrinsicEq, c.equityValue, (v) => `${fmtNum(Math.round(v))} SGD`);
  trackCardDelta('valEq', el.valKpiIntrinsicCard, c.equityValue, {
    minDelta: 150,
    tone: 'cyan',
    suffix: 'V*',
  });
  el.valKpiIntrinsicSub.textContent = `EV ${fmtCompact(c.enterpriseValue)} • Net Cash ${f.netCash >= 0 ? '+' : ''}${fmtCompact(f.netCash)} SGD`;

  if (c.sharePrice !== null) {
    animateNumericNode(el.valKpiIntrinsicSh, c.sharePrice, (v) => `${fmtSharePx(v)} / sh`);
    trackCardDelta('valSh', el.valKpiShareCard, c.sharePrice, {
      minDelta: 0.05,
      tone: 'cyan',
      formatDelta: (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}/sh`,
    });
  } else {
    el.valKpiIntrinsicSh.textContent = '—';
  }
  el.valKpiSharesSub.textContent =
    m.totalShares > 0
      ? `${fmtNum(m.totalShares)} ${m.shareTicker} Diluted Shares`
      : 'Unregistered Share Count';

  if (m.hasMarketPrice) {
    animateNumericNode(el.valKpiDexPx, m.dexPrice, (v) => `${fmtNum(Math.round(v))} SGD / sh`);
    trackCardDelta('dexPx', el.valKpiMarketCard, m.dexPrice, {
      minDelta: 1,
      formatDelta: (d) => `${d >= 0 ? '+' : '−'}${fmtNum(Math.round(Math.abs(d)))} SGD/sh`,
    });
    el.valKpiDexSub.textContent = `Mkt Cap ${fmtCompact(m.marketCap)} SGD • Bid ${m.dexBestBid || '—'} × Ask ${m.dexBestAsk || '—'}`;
  } else {
    el.valKpiDexPx.textContent = 'Unlisted Charter';
    el.valKpiDexSub.textContent =
      m.totalShares > 0
        ? `Private Cap Table (${fmtNum(m.totalShares)} ${m.shareTicker})`
        : 'No attached DexClob market';
  }

  if (m.premiumDiscountPct !== null) {
    const sign = m.premiumDiscountPct > 0 ? '+' : '';
    const color =
      m.signalClass === 'emerald'
        ? '#34d399'
        : m.signalClass === 'amber'
          ? '#fbbf24'
          : '#6ee7b7';
    el.valKpiSignal.style.color = color;
    el.valKpiSignal.textContent = `${sign}${m.premiumDiscountPct.toFixed(1)}% (${m.valuationSignal})`;
  } else {
    el.valKpiSignal.style.color = '#7dd3fc';
    el.valKpiSignal.textContent = 'IFRS INTRINSIC ONLY';
  }

  const pbStr = r.impliedPB !== null ? `${r.impliedPB.toFixed(1)}×` : '—';
  const evArrStr = r.impliedEvArr !== null ? `${r.impliedEvArr.toFixed(1)}×` : '—';
  const evEbStr = r.impliedEvEbitda !== null ? `${r.impliedEvEbitda.toFixed(1)}×` : '—';
  el.valKpiRatiosSub.textContent = `P/B ${pbStr} • EV/ARR ${evArrStr} • EV/EBITDA ${evEbStr}`;

  if (el.valWeightsLegend) {
    const w = c.weights;
    const parts = [];
    if (w.nav > 0) parts.push(`NAV ${Math.round(w.nav * 100)}%`);
    if (w.ebo > 0) parts.push(`EBO ${Math.round(w.ebo * 100)}%`);
    if (w.dcf > 0) parts.push(`DCF ${Math.round(w.dcf * 100)}%`);
    if (w.multiples > 0) parts.push(`Multiples ${Math.round(w.multiples * 100)}%`);
    el.valWeightsLegend.textContent = `Blend: ${parts.join(' • ')}`;
  }

  if (el.lblValWacc) {
    el.lblValWacc.textContent = `${val.params.waccPct.toFixed(1)}% (rₑ ${val.params.costOfEquityPct.toFixed(1)}%)`;
  }
  if (el.lblValGrowth) {
    el.lblValGrowth.textContent = `${val.params.terminalGrowthPct.toFixed(1)}%`;
  }
  if (el.lblValBlocksYr) {
    el.lblValBlocksYr.textContent = `${fmtNum(val.params.blocksPerYear)} blks/yr`;
  }

  renderFootballFieldSvg(val);

  // Render 3x3 WACC x g Sensitivity Matrix
  if (el.valSensitivityMount) {
    const grid = buildValuationSensitivityGrid(s, state.marketCtx, state.valParams);
    const hdrCols = grid.gSteps.map((g) => `<th>g=${g.toFixed(1)}%</th>`).join('');
    const bodyRows = grid.rows
      .map(
        (rw) => `
        <tr>
          <th>WACC ${rw.waccPct.toFixed(1)}%</th>
          ${rw.cells
            .map((cell) => {
              const txt =
                cell.sharePrice !== null
                  ? fmtSharePx(cell.sharePrice)
                  : fmtCompact(cell.equityValue);
              const tone =
                m.hasMarketPrice && cell.sharePrice !== null
                  ? cell.sharePrice >= m.dexPrice
                    ? 'color:#6ee7b7;'
                    : 'color:#fde68a;'
                  : 'color:#cbd5e1;';
              return `<td class="${cell.isCenter ? 'center-cell' : ''}" style="${cell.isCenter ? '' : tone}">${escapeHtml(txt)}</td>`;
            })
            .join('')}
        </tr>
      `
      )
      .join('');
    el.valSensitivityMount.innerHTML = `
      <table class="ifrs-sens-table">
        <thead><tr><th>WACC \\ g</th>${hdrCols}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }

  if (el.valDriversStrip) {
    el.valDriversStrip.innerHTML = `
      <div><span>Clean ARR (4000):</span><strong>${fmtCompact(f.annualizedArmsRev)} SGD/yr</strong></div>
      <div><span>Signed Backlog (1800):</span><strong style="color:#22d3ee;">${fmtCompact(f.futureContractBacklog || 0)} SGD (PV +${fmtCompact(f.pvSignedBacklog || 0)})</strong></div>
      <div><span>Gross Margin:</span><strong>${f.grossMarginPct.toFixed(1)}%</strong></div>
      <div><span>Clean EBITDA:</span><strong>${fmtCompact(f.annualizedCleanEbitda)} SGD/yr</strong></div>
      <div><span>Maint. FCFF (post-17%):</span><strong>${fmtCompact(f.annualizedFcff)} SGD/yr</strong></div>
      <div><span>Clean ROE (Ann.):</span><strong>${f.annualizedRoePct.toFixed(1)}%</strong></div>
    `;
  }
}

function renderStatements() {
  renderTelemetryAndHeader();
  const s = state.stmt;
  if (!s) {
    el.balanceSheetTable.innerHTML = '<tr><td>Connecting to Subnet 1 IFRS Ledger…</td></tr>';
    return;
  }
  const b = s.balances;
  const eqOk = (s.flags & 1) !== 0;
  const custOk = (s.flags & 2) !== 0;
  const virgOk = (s.flags & 4) !== 0;
  const regOk = (s.flags & 8) !== 0;

  if (el.pillSummaryStatus) {
    const allGood = eqOk && custOk;
    el.pillSummaryStatus.className = `ifrs-pill ${allGood ? 'ok' : 'bad'}`;
    el.pillSummaryStatus.textContent = allGood
      ? '✓ Books Balanced & Bank Cash Verified'
      : '⚠ Accounting / Custody Check Needed';
  }

  el.pillEquation.className = `ifrs-pill ${eqOk ? 'ok' : 'bad'}`;
  el.pillEquation.textContent = eqOk
    ? '✓ IAS 1: Assets ≡ Liabilities + Equity'
    : '⚠ Equation Imbalance';

  el.pillCustody.className = `ifrs-pill ${custOk ? 'ok' : 'bad'}`;
  el.pillCustody.textContent = custOk
    ? `✓ IAS 7: Bank (${fmtNum(s.actualBankBalance)}) ≡ 1010 + Suspense`
    : `⚠ Custody Shortfall (${fmtNum(s.bankCustodyShortfall)} SGD)`;

  el.pillVirgin.className = `ifrs-pill ${virgOk ? 'ok' : 'warn'}`;
  el.pillVirgin.textContent = virgOk
    ? `✓ Virgin Treasury (${shortAddr(s.treasuryIdentity)})`
    : 'Treasury Custody';

  el.pillCodeHash.className = `ifrs-pill ${regOk ? 'ok' : 'warn'}`;
  el.pillCodeHash.textContent = regOk
    ? '✓ HfsRegistry Module Gate Active'
    : '✓ VM code_hash Deduplicated';

  animateNumericNode(el.kpiAssets, s.totalAssets, (v) => `${fmtSigned(Math.round(v))} SGD`);
  trackCardDelta('kpiAssets', el.kpiCardAssets, s.totalAssets, { minDelta: 100 });
  el.kpiAssetsSub.textContent = `Current ${fmtSigned(s.totalCurrentAssets)} • Long-Term ${fmtSigned(s.totalNonCurrentAssets)}`;

  animateNumericNode(
    el.kpiLiabEq,
    s.totalLiabilities + s.totalEquity,
    (v) => `${fmtSigned(Math.round(v))} SGD`
  );
  trackCardDelta('kpiLiabEq', el.kpiCardLiabEq, s.totalLiabilities + s.totalEquity, { minDelta: 100 });
  el.kpiLiabEqSub.textContent = `Liab ${fmtSigned(s.totalLiabilities)} • Eq ${fmtSigned(s.totalEquity)}`;

  animateNumericNode(el.kpiArmsRev, s.grossRevArmsLength, (v) => `${fmtSigned(Math.round(v))} SGD`);
  trackCardDelta('kpiArmsRev', el.kpiCardRev, s.grossRevArmsLength, { minDelta: 50, suffix: 'REV' });
  el.kpiRpRevSub.textContent =
    s.grossRevRelatedParty > 0
      ? `Related-Party (excluded): ${fmtSigned(s.grossRevRelatedParty)} SGD`
      : "Arm's-length customer sales";

  animateNumericNode(el.kpiNetIncome, s.netIncome, (v) => `${fmtSigned(Math.round(v))} SGD`);
  trackCardDelta('kpiNetIncome', el.kpiCardProfit, s.netIncome, { minDelta: 50, suffix: 'P&L' });
  el.kpiDistributable.textContent = `Distributable: ${fmtSigned(Math.max(0, s.distributableProfit))} SGD`;

  animateNumericNode(el.kpiBankCash, s.actualBankBalance, (v) => `${fmtNum(Math.round(v))} SGD`);
  trackCardDelta('kpiBankCash', el.kpiCardCash, s.actualBankBalance, { minDelta: 50, suffix: 'CASH' });
  el.kpiSuspenseSub.textContent =
    s.unattributedBankInflow > 0
      ? `Quarantined: ${fmtNum(s.unattributedBankInflow)} SGD`
      : 'Verified Treasury Custody';
  el.kpiPeriod.textContent = `Period #${s.fiscalPeriod}`;
  el.kpiJournalCnt.textContent = `${fmtNum(s.journalCount)} batches`;

  el.bsAsOfMeta.textContent = `Block #${fmtNum(s.asOfBlock)}`;
  el.plPeriodMeta.textContent = `Fiscal Period #${s.fiscalPeriod}`;
  el.cfCustodyMeta.textContent = `Verified Bank Balance`;

  // Trigger 60fps chart morphing + in-graph +100K/-10K HUD popups on live statement changes!
  recordKineticStmtDelta(s);
  const dispStmt = getDisplayStmt();

  // Render all 4 Realtime Graphical Canvases + 5-Lens Corporate Valuation Studio!
  renderTrajectoryChart();
  renderBalanceSheetGraphic(dispStmt);
  renderProfitLossGraphic(dispStmt);
  renderCashFlowGraphic(dispStmt);
  renderValuationStudio();

  const bsScale = Math.max(1, s.totalAssets);
  const plScale = Math.max(1, s.netRevenue, Math.abs(s.netIncome), b[27] + b[28] + b[29] + b[30]);

  // 1. Clean Balance Sheet Table
  el.balanceSheetTable.innerHTML = `
    <tr><td colspan="2" class="ifrs-stmt-sec">Current Assets</td></tr>
    ${[0, 1, 2, 3].map((i) => renderRow(i, b[i], bsScale, { alwaysShow: i === 0 })).join('')}
    <tr class="ifrs-stmt-total"><td>Total Current Assets</td><td class="num">${fmtSigned(s.totalCurrentAssets)}</td></tr>
    <tr><td colspan="2" class="ifrs-stmt-sec">Long-Term Assets &amp; Backlog</td></tr>
    ${[4, 5, 6, 7, 8, 9, 10].map((i) => renderRow(i, b[i], bsScale)).join('')}
    <tr class="ifrs-stmt-total"><td>Total Long-Term Assets</td><td class="num">${fmtSigned(s.totalNonCurrentAssets)}</td></tr>
    <tr class="ifrs-stmt-total"><td>TOTAL ASSETS</td><td class="num" style="color:#6ee7b7;">${fmtSigned(s.totalAssets)}</td></tr>
    <tr><td colspan="2" class="ifrs-stmt-sec">Liabilities (What We Owe)</td></tr>
    ${[11, 12, 13, 14, 15, 18, 16, 17].map((i) => renderRow(i, b[i], bsScale)).join('')}
    <tr class="ifrs-stmt-total"><td>Total Liabilities</td><td class="num">${fmtSigned(s.totalLiabilities)}</td></tr>
    <tr><td colspan="2" class="ifrs-stmt-sec">Shareholders' Equity</td></tr>
    ${[19, 20, 21, 22, 23].map((i) => renderRow(i, b[i], bsScale)).join('')}
    <tr><td><span class="ifrs-code">P&amp;L</span>Current Period Profit</td><td class="num">${fmtSigned(s.netIncome)}</td></tr>
    <tr class="ifrs-stmt-total"><td>Total Equity</td><td class="num">${fmtSigned(s.totalEquity)}</td></tr>
    <tr class="ifrs-stmt-total"><td>LIABILITIES + EQUITY</td><td class="num" style="color:#6ee7b7;">${fmtSigned(s.totalLiabilities + s.totalEquity)}</td></tr>
  `;

  // 2. Clean Profit & Loss Table
  el.incomeStmtTable.innerHTML = `
    <tr><td colspan="2" class="ifrs-stmt-sec">Revenue</td></tr>
    ${renderRow(24, b[24], plScale, { alwaysShow: true })}
    ${renderRow(25, b[25], plScale)}
    ${renderRow(26, b[26], plScale)}
    <tr class="ifrs-stmt-total"><td>Net Revenue</td><td class="num">${fmtSigned(s.netRevenue)}</td></tr>
    ${renderRow(27, b[27], plScale, { contra: true, alwaysShow: true })}
    <tr class="ifrs-stmt-total"><td>Gross Profit</td><td class="num">${fmtSigned(s.grossProfit)}</td></tr>
    <tr><td colspan="2" class="ifrs-stmt-sec">Operating Costs</td></tr>
    ${renderRow(28, b[28], plScale, { contra: true })}
    ${renderRow(29, b[29], plScale, { contra: true })}
    ${renderRow(30, b[30], plScale, { contra: true })}
    <tr class="ifrs-stmt-total"><td>Operating Profit (EBIT)</td><td class="num">${fmtSigned(s.ebit)}</td></tr>
    ${renderRow(31, b[31], plScale, { contra: b[31] >= 0 })}
    <tr class="ifrs-stmt-total"><td>NET PROFIT</td><td class="num" style="color:${s.netIncome >= 0 ? '#6ee7b7' : '#fca5a5'};">${fmtSigned(s.netIncome)}</td></tr>
  `;

  // 3. Clean Cash Flow & Bank Custody Table
  const netCf = s.cfoNet + s.cfiNet + s.cffNet;
  el.cashFlowTable.innerHTML = `
    <tr><td colspan="2" class="ifrs-stmt-sec">Cash Movement by Activity</td></tr>
    <tr><td>Operating Cash Flow (Customers &amp; Suppliers)</td><td class="num">${fmtSigned(s.cfoNet)}</td></tr>
    <tr><td>Investing Cash Flow (Equipment &amp; IP)</td><td class="num">${fmtSigned(s.cfiNet)}</td></tr>
    <tr><td>Financing Cash Flow (Shares, Loans &amp; Dividends)</td><td class="num">${fmtSigned(s.cffNet)}</td></tr>
    <tr class="ifrs-stmt-total"><td>Net Cash Change</td><td class="num">${fmtSigned(netCf)}</td></tr>
    <tr><td colspan="2" class="ifrs-stmt-sec">Bank Custody Check</td></tr>
    <tr><td>Recorded Cash in Bank (1010)</td><td class="num">${fmtNum(s.bookedCash1010)} SGD</td></tr>
    ${s.unattributedBankInflow > 0 || state.showZeroRows ? `<tr><td>Unverified Quarantine (2900)</td><td class="num">${fmtNum(s.unattributedBankInflow)} SGD</td></tr>` : ''}
    <tr class="ifrs-stmt-total"><td>Actual On-Chain Bank Balance</td><td class="num" style="color:#6ee7b7;">${fmtNum(s.actualBankBalance)} SGD</td></tr>
  `;
}

function renderSchedules() {
  const sc = state.sched;
  const tab = state.schedTab;
  if (tab === 'svc') {
    const curBlk = state.stmt?.asOfBlock || session.blockNumber || 0;
    const svcList = sc.svc || [];
    el.schedTable.innerHTML = `
      <thead><tr><th>Contract</th><th>Engagement Tag</th><th>Client Counterparty</th><th>Monthly Schedule</th><th>Milestones Billed</th><th>1800 Backlog AR</th><th>3-Stage Lifecycle Action</th></tr></thead>
      <tbody>${
        svcList.length
          ? svcList
              .map((c) => {
                const totalVal = c.monthlyAmount * c.totalMonths;
                const remBacklog = Math.max(0, c.totalMonths - c.billedMonths) * c.monthlyAmount;
                const nextDueBlk = c.startBlock + (c.billedMonths + 1) * c.monthBlocks;
                const isDue = c.status === 2 && c.billedMonths < c.totalMonths && curBlk >= nextDueBlk;
                const myLow = session.getVerifiedIdentityAddr() || '';
                const isClient = Boolean(myLow && myLow === c.client);
                const isDefense = c.contractTag.startsWith('DEF-') || c.contractTag.startsWith('GOV-');
                const openInv =
                  c.lastInvoiceId > 0
                    ? state.store?.schedules?.ar?.get(c.lastInvoiceId)
                    : null;
                const canPayOpenInv =
                  openInv &&
                  openInv.status === 2 &&
                  openInv.openAmount > 0 &&
                  Boolean(myLow && (myLow === openInv.buyer || state.myIsFinanceOfficer));
                const stBadge =
                  c.status === 1
                    ? '<span class="inst-badge amber">STAGE 1 • AWAITING CO-SIGN</span>'
                    : c.status === 2
                      ? `<span class="inst-badge green">ACTIVE (${c.billedMonths}/${c.totalMonths} mos)</span>`
                      : '<span class="inst-badge">COMPLETED</span>';
                return `<tr>
                  <td style="font-family:var(--mono);font-weight:800;">#${c.contractId}</td>
                  <td>
                    <strong><code>${escapeHtml(c.contractTag)}</code></strong>
                    ${isDefense ? '<span class="inst-badge amber" style="margin-left:4px;">DEFENSE / SOVEREIGN</span>' : '<span class="inst-badge" style="margin-left:4px;">B2B R&amp;D</span>'}
                  </td>
                  <td>${escapeHtml(session.labelForIdentity(c.client))}</td>
                  <td style="font-family:var(--mono);">${fmtNum(c.monthlyAmount)} SGD/mo × ${c.totalMonths}m <span style="color:var(--txt-2);">(${fmtCompact(totalVal)} total)</span></td>
                  <td>${stBadge} <span style="font-size:11px;color:#94a3b8;font-family:var(--mono);">every ${fmtNum(c.monthBlocks)} blks</span></td>
                  <td style="font-family:var(--mono);font-weight:800;color:#22d3ee;">${fmtNum(remBacklog)} SGD</td>
                  <td style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                    ${c.status === 1 && isClient ? `<button class="inst-btn sm emerald" data-cosign-svc="${c.contractId}">✍️ Co-Sign Contract</button>` : ''}
                    ${c.status === 1 && !isClient ? '<span style="font-size:11px;color:#fcd34d;">Pending Client Signature</span>' : ''}
                    ${isDue && state.myIsFinanceOfficer ? `<button class="inst-btn sm emerald" data-bill-svc="${c.contractId}">🧾 Bill Month #${c.billedMonths + 1} (${fmtCompact(c.monthlyAmount)} SGD)</button>` : ''}
                    ${c.status === 2 && (!isDue || !state.myIsFinanceOfficer) && c.billedMonths < c.totalMonths ? `<span style="font-size:11px;color:#94a3b8;font-family:var(--mono);">${isDue ? '⚡ Milestone Due' : `⏳ Next @ #${fmtNum(nextDueBlk)}`}</span>` : ''}
                    ${canPayOpenInv ? `<button class="inst-btn sm primary" data-pay-inv="${openInv.invoiceId}" data-amt="${openInv.openAmount}">🏦 Settle Inv #${openInv.invoiceId} (${fmtCompact(openInv.openAmount)} SGD)</button>` : ''}
                  </td>
                </tr>`;
              })
              .join('')
          : '<tr><td colspan="7" style="text-align:center;color:var(--txt-2);">No multi-month Defense / B2B service contracts yet — sign one in <a href="/charter.html?action=serviceContract" style="color:#38bdf8;">CorporateCharter</a>!</td></tr>'
      }</tbody>`;
  } else if (tab === 'assets') {
    el.schedTable.innerHTML = `
      <thead><tr><th>ID</th><th>Class &amp; Standard</th><th>Cost</th><th>Residual</th><th>Useful Life</th><th>Live Accum. Depr.</th><th>Net Carrying Value</th></tr></thead>
      <tbody>${
        sc.assets.length
          ? sc.assets
              .map(
                (a) => `<tr>
                <td>#${a.assetId}</td>
                <td>${escapeHtml(ASSET_CLASS_NAMES[a.assetClass] || `Class ${a.assetClass}`)} ${a.disposed ? '<span class="inst-badge red">DISPOSED</span>' : ''}</td>
                <td>${fmtNum(a.cost)} SGD</td>
                <td>${fmtNum(a.residual)} SGD</td>
                <td>${fmtNum(a.usefulLifeBlocks)} blks (acq #${fmtNum(a.acquiredBlock)})</td>
                <td>(${fmtNum(a.liveDepr)}) SGD</td>
                <td style="font-weight:800;color:#6ee7b7;">${a.disposed ? '0' : fmtNum(Math.max(0, a.cost - a.liveDepr))} SGD</td>
              </tr>`
              )
              .join('')
          : '<tr><td colspan="7" style="text-align:center;color:var(--txt-2);">No capitalized IAS 16 / 38 assets yet.</td></tr>'
      }</tbody>`;
  } else if (tab === 'inv') {
    el.schedTable.innerHTML = `
      <thead><tr><th>SKU</th><th>Units On Hand</th><th>Carrying Cost (IAS 2)</th><th>Moving WAC / Unit</th><th>Cumulative Sold</th></tr></thead>
      <tbody>${
        sc.inv.length
          ? sc.inv
              .map((r) => {
                const wac = r.unitsOnHand > 0 ? Math.floor(r.carryingCost / r.unitsOnHand) : 0;
                const nm = state.skuNames.get(r.skuId) || shortAddr(r.skuId);
                return `<tr>
                  <td><strong>${escapeHtml(nm)}</strong> <span style="color:var(--txt-2);font-family:var(--mono);">${r.skuId.slice(0, 10)}…</span></td>
                  <td>${fmtNum(r.unitsOnHand)}</td>
                  <td>${fmtNum(r.carryingCost)} SGD</td>
                  <td>${fmtNum(wac)} SGD/unit</td>
                  <td>${fmtNum(r.totalUnitsSold)}</td>
                </tr>`;
              })
              .join('')
          : '<tr><td colspan="5" style="text-align:center;color:var(--txt-2);">No IAS 2 inventory SKUs tracked yet.</td></tr>'
      }</tbody>`;
  } else if (tab === 'leases') {
    el.schedTable.innerHTML = `
      <thead><tr><th>Lease</th><th>Lessor</th><th>Status</th><th>Initial ROU PV</th><th>Rem. Liability</th><th>Installment &amp; Rate</th><th>Action</th></tr></thead>
      <tbody>${
        sc.leases.length
          ? sc.leases
              .map((l) => {
                const stBadge =
                  l.status === 1
                    ? '<span class="inst-badge amber">AWAITING LESSOR</span>'
                    : l.status === 2
                    ? '<span class="inst-badge green">ACTIVE ROU</span>'
                    : '<span class="inst-badge">COMPLETED</span>';
                const myLow = session.getVerifiedIdentityAddr() || '';
                const canAccept = l.status === 1 && Boolean(myLow && myLow === l.lessor);
                return `<tr>
                  <td>#${l.leaseId}</td>
                  <td>${escapeHtml(session.labelForIdentity(l.lessor))}</td>
                  <td>${stBadge}</td>
                  <td>${fmtNum(l.initialPv)} SGD</td>
                  <td>${fmtNum(l.remLiability)} SGD</td>
                  <td>${fmtNum(l.periodicPayment)} SGD × ${l.paidPeriods}/${l.totalPeriods} @ ${(l.rateBps / 100).toFixed(2)}%</td>
                  <td>
                    ${canAccept ? `<button class="inst-btn sm emerald" data-accept-lease="${l.leaseId}">✓ Accept as Lessor</button>` : ''}
                    ${l.status === 2 && state.myIsFinanceOfficer ? `<button class="inst-btn sm primary" data-pay-lease="${l.leaseId}">Pay Installment</button>` : ''}
                  </td>
                </tr>`;
              })
              .join('')
          : '<tr><td colspan="7" style="text-align:center;color:var(--txt-2);">No IFRS 16 leases recorded yet.</td></tr>'
      }</tbody>`;
  } else if (tab === 'def') {
    el.schedTable.innerHTML = `
      <thead><tr><th>Contract</th><th>Customer</th><th>Plan</th><th>Upfront Cash</th><th>Live Earned (IFRS 15)</th><th>Remaining Deferred (2300)</th></tr></thead>
      <tbody>${
        sc.def.length
          ? sc.def
              .map(
                (d) => `<tr>
                <td>#${d.contractId}</td>
                <td>${escapeHtml(session.labelForIdentity(d.customer))} ${d.isRelated ? '<span class="inst-badge amber">IAS 24</span>' : ''}</td>
                <td><code>${escapeHtml(d.planTag)}</code> (${fmtNum(d.durationBlocks)} blks)</td>
                <td>${fmtNum(d.totalAmount)} SGD</td>
                <td style="color:#6ee7b7;">${fmtNum(d.liveEarned)} SGD</td>
                <td>${fmtNum(Math.max(0, d.totalAmount - d.liveEarned))} SGD</td>
              </tr>`
              )
              .join('')
          : '<tr><td colspan="6" style="text-align:center;color:var(--txt-2);">No IFRS 15 deferred subscription contracts yet.</td></tr>'
      }</tbody>`;
  } else if (tab === 'ar') {
    el.schedTable.innerHTML = `
      <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Original</th><th>Open AR (1100)</th><th>Aging ECL (1190)</th><th>Action</th></tr></thead>
      <tbody>${
        sc.ar.length
          ? sc.ar
              .map((inv) => {
                const st =
                  inv.status === 1
                    ? '<span class="inst-badge amber">OFFERED (0 REV)</span>'
                    : inv.status === 2
                    ? `<span class="inst-badge green">OPEN (due #${fmtNum(inv.dueBlock)})</span>`
                    : '<span class="inst-badge">PAID</span>';
                const myLow = session.getVerifiedIdentityAddr() || '';
                const isBuyer = Boolean(myLow && myLow === inv.buyer);
                return `<tr>
                  <td>#${inv.invoiceId}</td>
                  <td>${escapeHtml(session.labelForIdentity(inv.buyer))}</td>
                  <td>${st}</td>
                  <td>${fmtNum(inv.originalAmount)} SGD</td>
                  <td>${fmtNum(inv.openAmount)} SGD</td>
                  <td>(${fmtNum(inv.liveEcl)}) SGD</td>
                  <td>
                    ${inv.status === 1 && isBuyer ? `<button class="inst-btn sm emerald" data-accept-inv="${inv.invoiceId}">✓ Co-Accept Invoice</button>` : ''}
                    ${inv.status === 2 && (isBuyer || state.myIsFinanceOfficer) ? `<button class="inst-btn sm primary" data-pay-inv="${inv.invoiceId}" data-amt="${inv.openAmount}">Pay ${fmtNum(inv.openAmount)} SGD</button>` : ''}
                  </td>
                </tr>`;
              })
              .join('')
          : '<tr><td colspan="7" style="text-align:center;color:var(--txt-2);">No credit invoices yet.</td></tr>'
      }</tbody>`;
  } else if (tab === 'conf') {
    const cats = state.conf.categories || [];
    el.schedTable.innerHTML = `
      <thead><tr><th>Shielded Category</th><th>Roll-Up Timing Mode</th><th>Min Slots</th><th>Batches</th><th>Public Total Posted</th><th>Active Backlog / Open AR·AP</th><th>Settled Cash</th><th>Details</th></tr></thead>
      <tbody>${
        cats.length
          ? cats
              .map((c) => {
                const modeLbl =
                  c.mode === CONF_ROLLUP_MODE.LIVE_COUNTERPARTY_SHIELDED
                    ? '<span class="inst-badge cyan">MODE 2 • LIVE COUNTERPARTY-SHIELDED</span>'
                    : '<span class="inst-badge green">MODE 1 • BATCH / EPOCH ROLL-UP</span>';
                return `<tr>
                  <td><strong>🔒 ${escapeHtml(c.label)}</strong></td>
                  <td>${modeLbl}</td>
                  <td style="font-family:var(--mono);">≥ ${c.minSlots} slots</td>
                  <td style="font-family:var(--mono);">${fmtNum(c.batchCount)}</td>
                  <td style="font-family:var(--mono);font-weight:800;color:#6ee7b7;">${fmtNum(c.totalPosted)} SGD</td>
                  <td style="font-family:var(--mono);color:#38bdf8;">${fmtNum(c.activeBacklog + c.openArOrAp)} SGD</td>
                  <td style="font-family:var(--mono);">${fmtNum(c.settledCash)} SGD</td>
                  <td><button type="button" class="inst-btn sm primary" data-jump-conf="1">Open Roll-Up Studio →</button></td>
                </tr>`;
              })
              .join('')
          : '<tr><td colspan="8" style="text-align:center;color:var(--txt-2);">No ConfidentialLedger attached to this company yet.</td></tr>'
      }</tbody>`;
  } else if (tab === 'loans') {
    el.schedTable.innerHTML = `
      <thead><tr><th>Loan</th><th>Lender</th><th>Status</th><th>Principal</th><th>Remaining (2600)</th><th>Rate</th><th>Action</th></tr></thead>
      <tbody>${
        sc.loans.length
          ? sc.loans
              .map((ln) => {
                const myLow = session.getVerifiedIdentityAddr() || '';
                const isLender = Boolean(myLow && myLow === ln.lender);
                return `<tr>
                  <td>#${ln.loanId}</td>
                  <td>${escapeHtml(session.labelForIdentity(ln.lender))}</td>
                  <td>${ln.status === 1 ? '<span class="inst-badge amber">PROPOSED</span>' : ln.status === 2 ? '<span class="inst-badge green">ACTIVE</span>' : '<span class="inst-badge">REPAID</span>'}</td>
                  <td>${fmtNum(ln.initialPrincipal)} SGD</td>
                  <td>${fmtNum(ln.remPrincipal)} SGD</td>
                  <td>${(ln.rateBps / 100).toFixed(2)}%</td>
                  <td>${ln.status === 1 && isLender ? `<button class="inst-btn sm emerald" data-fund-loan="${ln.loanId}" data-amt="${ln.initialPrincipal}">Fund ${fmtNum(ln.initialPrincipal)} SGD</button>` : ''}</td>
                </tr>`;
              })
              .join('')
          : '<tr><td colspan="7" style="text-align:center;color:var(--txt-2);">No IFRS 9 term loans yet.</td></tr>'
      }</tbody>`;
  }
}

function renderHumanGlGuide() {
  if (!el.hglScenarioTabs || !el.hglBlueprintMount) return;
  el.hglScenarioTabs.innerHTML = GL_SCENARIO_BLUEPRINTS.map(
    (bp) =>
      `<button type="button" class="ifrs-tab-btn ${bp.id === state.hglTab ? 'active' : ''}" data-hgl-tab="${escapeHtml(bp.id)}">${escapeHtml(bp.tabLabel)}</button>`
  ).join('');
  const activeBp =
    GL_SCENARIO_BLUEPRINTS.find((bp) => bp.id === state.hglTab) || GL_SCENARIO_BLUEPRINTS[0];
  if (activeBp) {
    el.hglBlueprintMount.innerHTML = renderHumanBlueprintHtml(activeBp);
  }
}

function fitJournalViewportToThreeEntries() {
  const wrap = el.journalScrollWrap;
  if (!wrap || !el.journalTbody) return;
  const rows = el.journalTbody.querySelectorAll('tr');
  if (rows.length <= 3) {
    wrap.style.maxHeight = '336px';
    return;
  }
  const thead = wrap.querySelector('thead');
  const headH = thead ? thead.offsetHeight : 0;
  const r0 = rows[0].offsetHeight;
  const r1 = rows[1].offsetHeight;
  const r2 = rows[2].offsetHeight;
  if (headH > 0 && r0 > 0 && r1 > 0 && r2 > 0) {
    wrap.style.maxHeight = `${headH + r0 + r1 + r2 + 2}px`;
  }
}

function fitConfFeedViewportToThreeRows() {
  const wrap = el.confFeedScrollWrap;
  if (!wrap || !el.confFeedTable) return;
  const rows = el.confFeedTable.querySelectorAll('tbody > tr');
  const take = Math.min(3, rows.length);
  if (take === 0) {
    wrap.style.maxHeight = '196px';
    return;
  }
  const thead = el.confFeedTable.querySelector('thead');
  const headH = thead ? thead.offsetHeight : 0;
  let bodyH = 0;
  for (let i = 0; i < take; i++) {
    bodyH += rows[i].offsetHeight;
  }
  if (headH > 0 && bodyH > 0) {
    wrap.style.maxHeight = `${headH + bodyH + 2}px`;
  } else {
    wrap.style.maxHeight = '196px';
  }
}

function renderJournal() {
  const s = state.stmt;
  el.journalFeedMeta.textContent = s
    ? `Showing ${state.journal.length} most recent of ${fmtNum(s.journalCount)} entries (scroll for more)`
    : '0 entries';
  el.journalTbody.innerHTML = state.journal.length
    ? state.journal
        .map((j) => {
          const partyName = session.labelForIdentity(j.counterparty);
          const story = translateLiveJournalEntry(j, partyName);
          const whatHtml = state.humanJournal
            ? `<div class="hgl-jstory-title">${story.icon} ${escapeHtml(story.title)}</div>
               <div class="hgl-jstory-sub">${escapeHtml(story.explanation)}</div>
               <div style="font-size:11px;color:#64748b;margin-top:3px;">With: ${escapeHtml(partyName)}</div>`
            : `<div style="font-weight:700;color:#f1f5f9;">${escapeHtml(STD_LABELS[j.standardTag] || `STD ${j.standardTag}`)} • ${escapeHtml(CF_LABELS[j.cfClass] || 'Non-Cash')}</div>
               <div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">${escapeHtml(partyName)}</div>`;

          const linesHtml = j.lines
            .map((ln) => {
              const m = COA_META[ln.account] || { code: '????', name: `Acct ${ln.account}` };
              const friendly = FRIENDLY_COA[ln.account]?.short || m.name;
              const sideTxt = ln.side === 0 ? 'Dr' : 'Cr';
              const eff = state.humanJournal
                ? describePostingLineEffect(ln.account, ln.side)
                : null;
              const effPill = eff
                ? ` <span class="hgl-eff-pill ${eff.tone}" title="${escapeHtml(eff.verb)}">${escapeHtml(eff.pill)}</span>`
                : '';
              const acctName = state.humanJournal ? friendly : m.name;
              return `<div class="ifrs-jline ${ln.side === 1 ? 'cr' : ''}">
                <span><strong style="color:${ln.side === 0 ? '#7dd3fc' : '#c4b5fd'};font-family:var(--mono);">${sideTxt}</strong> <span style="color:#64748b;font-family:var(--mono);font-size:11px;">${m.code}</span> ${escapeHtml(acctName)}${effPill}</span>
                <span style="font-family:var(--mono);font-weight:700;">${fmtNum(ln.amount)} SGD</span>
              </div>`;
            })
            .join('');
          return `
            <tr>
              <td>
                <div style="font-family:var(--mono);font-weight:800;color:#f8fafc;">#${j.entryId}</div>
                <div style="font-family:var(--mono);font-size:11px;color:#64748b;">Blk #${fmtNum(j.blockNumber)}</div>
              </td>
              <td>${whatHtml}</td>
              <td>${linesHtml}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:800;color:#6ee7b7;white-space:nowrap;">${fmtNum(j.totalDebit)} SGD</td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--txt-2);">No journal entries posted yet.</td></tr>';
  fitJournalViewportToThreeEntries();
}

function renderConsole(force = false) {
  if (!state.myIsFinanceOfficer && ['ops', 'bilat', 'close'].includes(state.consoleTab)) {
    state.consoleTab = 'sub';
  }
  if (el.consoleTabs) {
    for (const b of el.consoleTabs.querySelectorAll('[data-ctab]')) {
      const ctab = b.getAttribute('data-ctab');
      const officerOnly = ctab === 'ops' || ctab === 'bilat' || ctab === 'close';
      b.style.display = officerOnly && !state.myIsFinanceOfficer ? 'none' : '';
      b.classList.toggle('active', ctab === state.consoleTab);
    }
  }
  const svcKeyPart = (state.sched.svc || [])
    .map((c) => `${c.contractId}:${c.status}:${c.billedMonths}`)
    .join(',');
  const key = `${state.consoleTab}:${state.myVerifiedIdentity}:${state.myIsFinanceOfficer}:${state.myIsDirector}:${(session.aiPersonas || []).length}:${svcKeyPart}`;
  if (!force && state.consoleRenderedForTab === key) {
    const lbl = document.getElementById('lblMaxDiv');
    if (lbl && state.stmt) {
      lbl.textContent = `Dividend (Max Realized: ${fmtNum(Math.max(0, state.stmt.distributableProfit))} SGD)`;
    }
    return;
  }
  state.consoleRenderedForTab = key;

  const peerOptions = (session.aiPersonas || [])
    .map(
      (p) =>
        `<option value="${p.identityAddr}">${escapeHtml(p.displayLabel || p.nickname)}</option>`
    )
    .join('');

  if (state.consoleTab === 'svc') {
    const curBlk = state.stmt?.asOfBlock || session.blockNumber || 0;
    const activeContracts = (state.sched.svc || []).filter(
      (c) => c.status === 2 && c.billedMonths < c.totalMonths
    );
    const totalBacklog = activeContracts.reduce(
      (acc, c) => acc + Math.max(0, c.totalMonths - c.billedMonths) * c.monthlyAmount,
      0
    );
    const svcOptions = activeContracts.length
      ? activeContracts
          .map((c) => {
            const nextDue = c.startBlock + (c.billedMonths + 1) * c.monthBlocks;
            const dueTag = curBlk >= nextDue ? 'DUE NOW' : `due @ #${fmtNum(nextDue)}`;
            return `<option value="${c.contractId}">#${c.contractId} ${escapeHtml(c.contractTag)} — ${fmtNum(c.monthlyAmount)} SGD/mo (${c.billedMonths}/${c.totalMonths} billed • ${dueTag})</option>`;
          })
          .join('')
      : '<option value="">No active unbilled contracts — ratify one in CorporateCharter</option>';

    el.consolePane.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border-radius:8px;background:rgba(8,47,73,0.45);border:1px solid rgba(34,211,238,0.28);font-size:11.5px;color:#cbd5e1;">
          <div>
            <strong style="color:#67e8f9;">3-Stage Defense &amp; B2B Service Lifecycle (IFRS 15 / IFRS 9 / IAS 7):</strong>
            <span style="margin-left:6px;">① Sign in Charter → <code>1800 Future Receivables</code> (${fmtNum(totalBacklog)} SGD active)</span>
            <span style="margin-left:8px;">② Monthly Milestone → <code>1100 Current AR + 4000 Revenue</code></span>
            <span style="margin-left:8px;">③ Bank Oracle Settlement → <code>1010 Current Cash + CFO</code></span>
          </div>
          ${state.myIsDirector ? '<a class="inst-btn sm primary" href="/charter.html?action=serviceContract">🏛️ Ratify New Defense / B2B Contract in Charter →</a>' : ''}
        </div>
        <div class="ifrs-form-grid">
          <div class="ifrs-field" style="grid-column:span 2;">
            <label>Active Multi-Month Service Contract</label>
            <select class="inst-input" id="inSvcContractId">${svcOptions}</select>
          </div>
          ${
            state.myIsFinanceOfficer
              ? `<button class="inst-btn emerald" id="btnBillSvcMonth" ${activeContracts.length ? '' : 'disabled'}>🧾 Generate Monthly Invoice (1800 → 1100 Current AR)</button>`
              : '<span style="font-size:11.5px;color:#94a3b8;align-self:center;font-family:var(--mono);">🔒 Invoice issuance reserved for Company CFO / Directors</span>'
          }
          <button class="inst-btn primary" id="btnCrankSvcAll">⚡ Crank All Due Milestones &amp; Accruals</button>
        </div>
      </div>
    `;
  } else if (state.consoleTab === 'sub') {
    const cfHref = `/crowdfunding.html${
      session.inst?.accountingLedger ? `?hfs=${encodeURIComponent(session.inst.accountingLedger)}` : ''
    }`;
    el.consolePane.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border-radius:8px;background:rgba(6,78,59,0.34);border:1px solid rgba(52,211,153,0.38);font-size:11.5px;color:#cbd5e1;">
          <div>
            <strong style="color:#6ee7b7;">Board-Activated Pre-Order Crowdfunding &amp; Stretch-Goal Growth Budget (IFRS 15):</strong>
            <span style="margin-left:6px;">① Draft Campaign → Triggers <code>BOARD_RESOLUTION</code> on Charter</span>
            <span style="margin-left:8px;">② Enact → Sets <code>Crowdfunding = LIVE</code></span>
            <span style="margin-left:8px;">③ Settle → Sweeps into <code>2300 Contract Liabilities</code> &amp; unlocks IFRS Growth Budget</span>
          </div>
          <a class="inst-btn sm emerald" href="${cfHref}">🚀 Launch / Manage Pre-Order Crowdfunding →</a>
        </div>
        <div class="ifrs-form-grid">
          <div class="ifrs-field">
            <label>Plan Code</label>
            <input class="inst-input" id="inSubPlan" value="SLX-MESH-ENT" maxlength="8" />
          </div>
          <div class="ifrs-field">
            <label>Duration (Blocks, ≥ 20)</label>
            <input class="inst-input" type="number" id="inSubBlks" value="120" min="20" />
          </div>
          <div class="ifrs-field">
            <label>Upfront Subscription (SGD)</label>
            <input class="inst-input" type="number" id="inSubAmt" value="6000" min="100" />
          </div>
          <button class="inst-btn emerald" id="btnExecSub">⚡ Pay &amp; Book IFRS 15 Deferred Subscription</button>
        </div>
      </div>
    `;
  } else if (state.consoleTab === 'ops') {
    el.consolePane.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="ifrs-form-grid">
          <div class="ifrs-field">
            <label>Vendor / Employee Identity</label>
            <select class="inst-input" id="inOpsPayee">${peerOptions}</select>
          </div>
          <div class="ifrs-field">
            <label>IAS 16 / 38 Asset Class</label>
            <select class="inst-input" id="inCapClass">
              <option value="1">1 — IT Hardware (IAS 16)</option>
              <option value="2">2 — Machinery (IAS 16)</option>
              <option value="3">3 — Facility (IAS 16)</option>
              <option value="4">4 — Finite Software/IP (IAS 38, Res=0)</option>
            </select>
          </div>
          <div class="ifrs-field">
            <label>CapEx Cost (≥ 1,000 SGD)</label>
            <input class="inst-input" type="number" id="inCapCost" value="24000" min="100" />
          </div>
          <div class="ifrs-field">
            <label>Useful Life (Blocks)</label>
            <input class="inst-input" type="number" id="inCapLife" value="1200" min="50" />
          </div>
          <button class="inst-btn primary" id="btnExecCapex">🏗️ Acquire Capital Asset (CFI)</button>
        </div>
        <div class="ifrs-form-grid" style="border-top:1px solid var(--line);padding-top:10px;">
          <div class="ifrs-field">
            <label>OpEx Category (IAS 1)</label>
            <select class="inst-input" id="inOpexCat">
              <option value="1">1 — R&amp;D Expense</option>
              <option value="2">2 — Sales &amp; Marketing</option>
              <option value="3">3 — General &amp; Admin</option>
            </select>
          </div>
          <div class="ifrs-field">
            <label>Amount (SGD)</label>
            <input class="inst-input" type="number" id="inOpexAmt" value="4500" min="10" />
          </div>
          <button class="inst-btn primary" id="btnExecOpex">🧾 Disburse Cash OpEx (CFO)</button>
          <button class="inst-btn emerald" id="btnExecPayroll">👥 Run Cash Payroll (IAS 19)</button>
        </div>
      </div>
    `;
  } else if (state.consoleTab === 'bilat') {
    el.consolePane.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="ifrs-form-grid">
          <div class="ifrs-field">
            <label>Counterparty Identity</label>
            <select class="inst-input" id="inBilatParty">
              ${session.myIdentityAddr ? `<option value="${session.myIdentityAddr}">Me (${escapeHtml(session.myIdentityHandle)})</option>` : ''}
              ${peerOptions}
            </select>
          </div>
          <div class="ifrs-field">
            <label>Invoice / Lease / Loan Amount (SGD)</label>
            <input class="inst-input" type="number" id="inBilatAmt" value="8000" min="100" />
          </div>
          <div class="ifrs-field">
            <label>Due / Period Blocks</label>
            <input class="inst-input" type="number" id="inBilatBlks" value="80" min="10" />
          </div>
          <button class="inst-btn primary" id="btnIssueInv">📄 Issue Credit Invoice (IFRS 15)</button>
          <button class="inst-btn emerald" id="btnPropLease">🏢 Propose 4-Period ROU Lease (IFRS 16)</button>
        </div>
      </div>
    `;
  } else if (state.consoleTab === 'close') {
    const dist = Math.max(0, state.stmt?.distributableProfit || 0);
    el.consolePane.innerHTML = `
      <div class="ifrs-form-grid">
        <div class="ifrs-field">
          <label>Dividend Recipient</label>
          <select class="inst-input" id="inDivTo">
            ${session.myIdentityAddr ? `<option value="${session.myIdentityAddr}">Me (${escapeHtml(session.myIdentityHandle)})</option>` : ''}
            ${peerOptions}
          </select>
        </div>
        <div class="ifrs-field">
          <label id="lblMaxDiv">Dividend (Max Realized: ${fmtNum(dist)} SGD)</label>
          <input class="inst-input" type="number" id="inDivAmt" value="${Math.min(2500, dist || 1000)}" min="1" />
        </div>
        <button class="inst-btn emerald" id="btnPayDiv">💎 Pay Realized-Profit Dividend (IAS 32)</button>
        <button class="inst-btn primary" id="btnClosePeriod">🔒 Close Fiscal Period &amp; Roll Retained Earnings</button>
      </div>
    `;
  }
}

function renderAll(forceConsole = false) {
  renderStatements();
  renderSchedules();
  renderJournal();
  renderConsole(forceConsole);
  renderConfidentialWorkspace(forceConsole);
}

// ============================================================================
// UI Event Listeners & Interactive Booking Actions
// ============================================================================

el.trajSeriesToggles?.addEventListener('click', (ev) => {
  const pill = ev.target.closest('[data-series]');
  if (!pill) return;
  const key = pill.dataset.series;
  if (state.activeSeries.has(key) && state.activeSeries.size > 1) {
    state.activeSeries.delete(key);
    pill.classList.remove('active');
  } else {
    state.activeSeries.add(key);
    pill.classList.add('active');
  }
  renderTrajectoryChart();
});

function syncWorkspaceView(fromHash = false) {
  if (fromHash) {
    const h = (window.location.hash || '').toLowerCase();
    if (h.includes('humangl')) state.workspaceTab = 'ledger';
    else if (h.includes('valuation')) state.workspaceTab = 'valuation';
    else if (h.includes('conf')) state.workspaceTab = 'confidential';
    else if (h.includes('ops') || h.includes('sched')) state.workspaceTab = 'ops';
  }
  if (el.accWorkspaceTabs) {
    for (const b of el.accWorkspaceTabs.querySelectorAll('[data-wtab]')) {
      b.classList.toggle('active', b.dataset.wtab === state.workspaceTab);
    }
  }
  for (const sec of document.querySelectorAll('[data-wview]')) {
    const show =
      state.workspaceTab === 'all' || sec.getAttribute('data-wview') === state.workspaceTab;
    sec.hidden = !show;
  }
  if (state.workspaceTab === 'ledger' || state.workspaceTab === 'all') {
    fitJournalViewportToThreeEntries();
  }
  if (state.workspaceTab === 'confidential' || state.workspaceTab === 'all') {
    fitConfFeedViewportToThreeRows();
  }
}

el.accWorkspaceTabs?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-wtab]');
  if (!btn) return;
  state.workspaceTab = btn.dataset.wtab || 'statements';
  syncWorkspaceView(false);
});

window.addEventListener('hashchange', () => syncWorkspaceView(true));
window.addEventListener('resize', () => {
  fitJournalViewportToThreeEntries();
  fitConfFeedViewportToThreeRows();
});

el.btnToggleDiag?.addEventListener('click', () => {
  state.showDiag = !state.showDiag;
  if (el.techDiagDrawer) el.techDiagDrawer.hidden = !state.showDiag;
  el.btnToggleDiag.classList.toggle('primary', state.showDiag);
});

el.btnToggleZeroRows?.addEventListener('click', () => {
  state.showZeroRows = !state.showZeroRows;
  el.btnToggleZeroRows.textContent = state.showZeroRows
    ? 'Hide $0 Accounts'
    : 'Show $0 Accounts';
  el.btnToggleZeroRows.classList.toggle('primary', state.showZeroRows);
  renderStatements();
});

el.btnToggleKinetic?.addEventListener('click', () => {
  state.kineticFx = !state.kineticFx;
  if (!state.kineticFx) {
    svgPopups = [];
    stmtTween = null;
    valEqTween = null;
    if (kineticRafId) {
      cancelAnimationFrame(kineticRafId);
      kineticRafId = 0;
    }
  }
  el.btnToggleKinetic.textContent = state.kineticFx ? '⚡ FX: ON' : '⚡ FX: OFF';
  el.btnToggleKinetic.classList.toggle('emerald', state.kineticFx);
  renderStatements();
});

el.btnVerifyParity?.addEventListener('click', () => verifyParityAgainstChain());
el.btnReanchor?.addEventListener('click', () => hydrateAnchorSnapshot());

function syncTrajectoryIntrinsicsAndValuation() {
  for (const pt of state.trajectory) {
    if (pt._stmtSnap) {
      pt.intrinsic = computeIntrinsicEqForStmt(pt._stmtSnap);
    }
  }
  renderValuationStudio();
  if (state.activeSeries.has('intrinsic')) {
    renderTrajectoryChart();
  }
}

el.rngValWacc?.addEventListener('input', () => {
  const nextWacc = Number(el.rngValWacc.value) || DEFAULT_VALUATION_PARAMS.waccPct;
  state.valParams.waccPct = nextWacc;
  if (state.valParams.terminalGrowthPct > nextWacc - 2.0) {
    state.valParams.terminalGrowthPct = Math.max(0, nextWacc - 2.0);
    if (el.rngValGrowth) el.rngValGrowth.value = String(state.valParams.terminalGrowthPct);
  }
  syncTrajectoryIntrinsicsAndValuation();
});

el.rngValGrowth?.addEventListener('input', () => {
  const maxG = Math.max(0, state.valParams.waccPct - 2.0);
  const rawG = Number(el.rngValGrowth.value) || 0;
  const clampedG = Math.min(maxG, rawG);
  state.valParams.terminalGrowthPct = clampedG;
  if (rawG !== clampedG && el.rngValGrowth) el.rngValGrowth.value = String(clampedG);
  syncTrajectoryIntrinsicsAndValuation();
});

el.rngValBlocksYr?.addEventListener('input', () => {
  state.valParams.blocksPerYear =
    Number(el.rngValBlocksYr.value) || DEFAULT_VALUATION_PARAMS.blocksPerYear;
  syncTrajectoryIntrinsicsAndValuation();
});

el.btnResetValParams?.addEventListener('click', () => {
  state.valParams = { ...DEFAULT_VALUATION_PARAMS };
  if (el.rngValWacc) el.rngValWacc.value = String(state.valParams.waccPct);
  if (el.rngValGrowth) el.rngValGrowth.value = String(state.valParams.terminalGrowthPct);
  if (el.rngValBlocksYr) el.rngValBlocksYr.value = String(state.valParams.blocksPerYear);
  syncTrajectoryIntrinsicsAndValuation();
});

el.consoleTabs?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-ctab]');
  if (!btn) return;
  state.consoleTab = btn.dataset.ctab;
  for (const b of el.consoleTabs.querySelectorAll('.ifrs-tab-btn')) {
    b.classList.toggle('active', b === btn);
  }
  renderConsole(true);
});

el.schedTabs?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-stab]');
  if (!btn) return;
  state.schedTab = btn.dataset.stab;
  for (const b of el.schedTabs.querySelectorAll('.ifrs-tab-btn')) {
    b.classList.toggle('active', b === btn);
  }
  renderSchedules();
});

el.hglScenarioTabs?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-hgl-tab]');
  if (!btn) return;
  state.hglTab = btn.dataset.hglTab;
  renderHumanGlGuide();
});

el.btnToggleHumanJournal?.addEventListener('click', () => {
  state.humanJournal = !state.humanJournal;
  el.btnToggleHumanJournal.textContent = state.humanJournal
    ? '📖 Plain-English Mode: ON'
    : '🧾 Raw Codes Mode: ON';
  el.btnToggleHumanJournal.classList.toggle('emerald', state.humanJournal);
  renderJournal();
});

el.btnTopUpFiat?.addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  try {
    await session.requestFiatTopUp(25000, (m) => showBanner(escapeHtml(m), 'info'));
    showBanner('✅ Credited +25,000 SGD to your Identity HFS (updated via AssetLedger.Credited log)!', 'ok');
  } catch (e) {
    showBanner(`⚠ ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnCrankAccruals?.addEventListener('click', async () => {
  if (state.busy || !state.stmt) return;
  state.busy = true;
  try {
    showBanner('Posting due IAS 16/38 depreciation, IFRS 16 ROU, IFRS 15 deferred revenue & IFRS 9 ECL…', 'info');
    const acc = session.inst.accountingLedger;
    const rcpt = await session.sendAsMyIdentity(
      wrapExec(acc, encodeAbi('processPeriodicAccruals()')),
      'processPeriodicAccruals()',
      'AccountingLedger',
      [acc, state.stmt.operatingBankLedger, state.stmt.treasuryIdentity],
      8_500_000n
    );
    for (const lg of rcpt?.logs || []) handleIncomingLog({ ...lg, blockNumberNum: Number(BigInt(rcpt.blockNumber || 0)), txHash: rcpt.transactionHash, isBackfill: false });
    showBanner('✅ Periodic accruals committed — streamed directly via IfrsJournalPosted & IfrsSubledgerUpdated!', 'ok');
  } catch (e) {
    showBanner(`⚠ ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

function ingestReceiptLogsImmediately(rcpt) {
  if (!rcpt?.logs) return;
  const blk = rcpt.blockNumber ? Number(BigInt(rcpt.blockNumber)) : session.blockNumber;
  for (let i = 0; i < rcpt.logs.length; i++) {
    const lg = rcpt.logs[i];
    handleIncomingLog({
      address: lg.address,
      topics: lg.topics,
      data: lg.data,
      blockNumberNum: blk,
      txHash: rcpt.transactionHash,
      logIndex: lg.logIndex ?? i,
      isBackfill: false,
    });
  }
}

el.consolePane?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || state.busy || !state.stmt) return;
  const acc = session.inst.accountingLedger;
  const bank = state.stmt.operatingBankLedger;
  const treas = state.stmt.treasuryIdentity;
  const chr = state.stmt.corporateCharter;
  const targets = [acc, bank, treas, chr, session.manifest?.hfsRegistry].filter(Boolean);

  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => showBanner(escapeHtml(m), 'info'));
    if (btn.id === 'btnBillSvcMonth') {
      const cid = Number(document.getElementById('inSvcContractId')?.value || 0);
      if (!cid) throw new Error('Select an active multi-month service contract');
      showBanner(`Generating monthly milestone invoice on Service Contract #${cid} (1800 Future AR → 1100 Current AR + 4000 Revenue)…`, 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('billServiceContractMonth(uint64)', [['uint64', cid]])),
        `billServiceContractMonth(#${cid})`,
        'AccountingLedger',
        targets,
        8_800_000n
      );
      state.schedTab = 'ar';
      ingestReceiptLogsImmediately(rcpt);
      renderSchedules();
      showBanner(`✅ Billed monthly milestone for Contract #${cid}! Reclassified 1800 Future AR → 1100 Current AR + 4000 Revenue (settle invoice in IFRS 9 Receivables!).`, 'ok');
    } else if (btn.id === 'btnCrankSvcAll') {
      showBanner('Sweeping all due monthly Defense/B2B service milestones, IAS 16/38 depreciation & IFRS 9 ECL…', 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('processPeriodicAccruals()')),
        'processPeriodicAccruals()',
        'AccountingLedger',
        targets,
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner('✅ Swept all due monthly contract milestones & periodic accruals!', 'ok');
    } else if (btn.id === 'btnExecSub') {
      const planStr = document.getElementById('inSubPlan').value || 'SLX-SAAS';
      const blks = Math.max(1, Number(document.getElementById('inSubBlks').value) || 120);
      const amt = Math.max(1, Number(document.getElementById('inSubAmt').value) || 6000);
      if (state.myFiat < amt && bank.toLowerCase() === session.inst.fiatLedger.toLowerCase()) {
        await session.requestFiatTopUp(amt + 5000, (m) => showBanner(escapeHtml(m), 'info'));
      }
      showBanner(`Transferring ${fmtNum(amt)} SGD to Virgin Treasury & booking IFRS 15 Contract Liability…`, 'info');
      const r1 = await session.sendAsMyIdentity(
        encodeAbi('transferBankBalance(address,address,uint64)', [
          ['address', bank],
          ['address', treas],
          ['uint64', amt],
        ]),
        `paySubscription(${amt} SGD)`,
        'AssetLedger',
        targets,
        5_500_000n
      );
      ingestReceiptLogsImmediately(r1);

      const planHex = keccak256Hex(utf8ToBytes(planStr));
      const padPlan = new Uint8Array(32);
      padPlan.set(utf8ToBytes(planStr).slice(0, 8), 0);
      const r2 = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('purchaseSubscription(bytes32,uint64,uint64)', [
            ['bytes32', bytesToHex(padPlan) || planHex],
            ['uint64', blks],
            ['uint64', amt],
          ])
        ),
        'purchaseSubscription()',
        'AccountingLedger',
        targets,
        8_500_000n
      );
      ingestReceiptLogsImmediately(r2);
      showBanner(`✅ Streamed IfrsJournalPosted: +${fmtNum(amt)} SGD into 2300 Contract Liabilities (recognizing linearly over ${fmtNum(blks)} blocks)!`, 'ok');
    } else if (btn.id === 'btnExecCapex') {
      const vendor = document.getElementById('inOpsPayee').value;
      const cls = Number(document.getElementById('inCapClass').value) || 1;
      const cost = Number(document.getElementById('inCapCost').value) || 24000;
      const life = Number(document.getElementById('inCapLife').value) || 1200;
      showBanner(`Executing atomic IAS 16/38 CapEx (${fmtNum(cost)} SGD) + Treasury disbursement…`, 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi(
            'acquireCapitalAsset(address,uint64,uint64,uint64,uint64,bool,bytes32,address)',
            [
              ['address', vendor],
              ['uint64', cls],
              ['uint64', cost],
              ['uint64', 0],
              ['uint64', life],
              ['bool', true],
              ['bytes32', keccak256Hex(utf8ToBytes(`CAPEX_${Date.now()}`))],
              ['address', ZERO_ADDR],
            ]
          )
        ),
        'acquireCapitalAsset()',
        'AccountingLedger',
        [...targets, vendor],
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Capitalized ${fmtNum(cost)} SGD asset — Balance Sheet & CFI Waterfall updated via event logs!`, 'ok');
    } else if (btn.id === 'btnExecOpex') {
      const vendor = document.getElementById('inOpsPayee').value;
      const cat = Number(document.getElementById('inOpexCat').value) || 1;
      const amt = Number(document.getElementById('inOpexAmt').value) || 4500;
      showBanner(`Disbursing ${fmtNum(amt)} SGD OpEx from Virgin Treasury…`, 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('payOperatingExpense(address,uint64,uint64,bool,bytes32,address)', [
            ['address', vendor],
            ['uint64', cat],
            ['uint64', amt],
            ['bool', true],
            ['bytes32', keccak256Hex(utf8ToBytes(`OPEX_${Date.now()}`))],
            ['address', ZERO_ADDR],
          ])
        ),
        'payOperatingExpense()',
        'AccountingLedger',
        [...targets, vendor],
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Disbursed ${fmtNum(amt)} SGD OpEx — P&L & CFO Waterfall updated live from event logs!`, 'ok');
    } else if (btn.id === 'btnExecPayroll') {
      const emp = document.getElementById('inOpsPayee').value;
      const amt = Number(document.getElementById('inOpexAmt').value) || 4500;
      showBanner(`Running IAS 19 Cash Payroll (${fmtNum(amt)} SGD)…`, 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('bookPayrollRun(address,uint64,bool,bytes32,address)', [
            ['address', emp],
            ['uint64', amt],
            ['bool', true],
            ['bytes32', keccak256Hex(utf8ToBytes(`PAY_${Date.now()}`))],
            ['address', ZERO_ADDR],
          ])
        ),
        'bookPayrollRun()',
        'AccountingLedger',
        [...targets, emp],
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Paid ${fmtNum(amt)} SGD IAS 19 Payroll — streamed directly into P&L & Cash Flow!`, 'ok');
    } else if (btn.id === 'btnIssueInv') {
      const buyer = document.getElementById('inBilatParty').value;
      const amt = Number(document.getElementById('inBilatAmt').value) || 8000;
      const due = Number(document.getElementById('inBilatBlks').value) || 80;
      showBanner('Issuing bilateral credit invoice offer (0 revenue until buyer co-accepts)…', 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('issueCreditInvoice(address,bytes32,uint64,uint64,uint64,address)', [
            ['address', buyer],
            ['bytes32', '0x' + '00'.repeat(32)],
            ['uint64', 0],
            ['uint64', amt],
            ['uint64', due],
            ['address', ZERO_ADDR],
          ])
        ),
        'issueCreditInvoice()',
        'AccountingLedger',
        [...targets, buyer],
        9_000_000n
      );
      state.schedTab = 'ar';
      ingestReceiptLogsImmediately(rcpt);
      renderSchedules();
      showBanner('✅ Credit invoice offered via IfrsSubledgerUpdated! Revenue stays 0 until Customer Identity co-accepts.', 'ok');
    } else if (btn.id === 'btnPropLease') {
      const lessor = document.getElementById('inBilatParty').value;
      const pmt = Number(document.getElementById('inBilatAmt').value) || 8000;
      const pBlks = Math.max(10, Number(document.getElementById('inBilatBlks').value) || 80);
      showBanner('Proposing bilateral IFRS 16 Right-of-Use Lease…', 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('proposeLease(address,uint64,uint64,uint64,uint64,address)', [
            ['address', lessor],
            ['uint64', pmt],
            ['uint64', 4],
            ['uint64', pBlks],
            ['uint64', 200],
            ['address', ZERO_ADDR],
          ])
        ),
        'proposeLease()',
        'AccountingLedger',
        [...targets, lessor],
        9_000_000n
      );
      state.schedTab = 'leases';
      ingestReceiptLogsImmediately(rcpt);
      renderSchedules();
      showBanner('✅ IFRS 16 Lease proposed! Switch to ROU Leases tab for Lessor co-acceptance.', 'ok');
    } else if (btn.id === 'btnPayDiv') {
      const to = document.getElementById('inDivTo').value;
      const amt = Number(document.getElementById('inDivAmt').value) || 1000;
      showBanner(`Sweeping accruals & verifying IAS 32 realized profit ≥ ${fmtNum(amt)} SGD…`, 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('payDividend(address,uint64,address)', [
            ['address', to],
            ['uint64', amt],
            ['address', ZERO_ADDR],
          ])
        ),
        'payDividend()',
        'AccountingLedger',
        [...targets, to],
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Disbursed ${fmtNum(amt)} SGD realized-profit dividend — Equity & CFF updated via event stream!`, 'ok');
    } else if (btn.id === 'btnClosePeriod') {
      showBanner('Sweeping accruals & closing fiscal period into 3400 Retained Earnings…', 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('closeFiscalPeriod(address)', [['address', ZERO_ADDR]])),
        'closeFiscalPeriod()',
        'AccountingLedger',
        targets,
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner('✅ Fiscal period closed via IfrsFiscalPeriodClosed — nominal accounts rolled into Retained Earnings!', 'ok');
    }
  } catch (e) {
    showBanner(`⚠ IFRS Guardrail Enforced: ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.schedTable?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || state.busy || !state.stmt) return;
  if (btn.dataset.jumpConf !== undefined) {
    state.workspaceTab = 'confidential';
    syncWorkspaceView(false);
    return;
  }
  const acc = session.inst.accountingLedger;
  const bank = state.stmt.operatingBankLedger;
  const treas = state.stmt.treasuryIdentity;
  const targets = [acc, bank, treas, state.stmt.corporateCharter].filter(Boolean);

  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => showBanner(escapeHtml(m), 'info'));
    if (btn.dataset.cosignSvc !== undefined) {
      const id = Number(btn.dataset.cosignSvc);
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('coSignServiceContract(uint64)', [['uint64', id]])),
        `coSignServiceContract(#${id})`,
        'AccountingLedger',
        targets,
        8_800_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Co-signed Service Contract #${id}! Full backlog credited to 1800 Future Contract Receivables & Intrinsic Valuation V* updated!`, 'ok');
    } else if (btn.dataset.billSvc !== undefined) {
      const id = Number(btn.dataset.billSvc);
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('billServiceContractMonth(uint64)', [['uint64', id]])),
        `billServiceContractMonth(#${id})`,
        'AccountingLedger',
        targets,
        8_800_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Generated monthly milestone invoice for Service Contract #${id} (1800 Future AR → 1100 Current AR + 4000 Revenue)!`, 'ok');
    } else if (btn.dataset.acceptLease !== undefined) {
      const id = Number(btn.dataset.acceptLease);
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('acceptAndCommenceLease(uint64)', [['uint64', id]])),
        `acceptAndCommenceLease(#${id})`,
        'AccountingLedger',
        targets,
        8_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Lease #${id} co-accepted! Capitalized onto 1600 ROU Asset & 2500 Lease Liability via event stream.`, 'ok');
    } else if (btn.dataset.payLease !== undefined) {
      const id = Number(btn.dataset.payLease);
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('payLeaseInstallment(uint64,address)', [
            ['uint64', id],
            ['address', ZERO_ADDR],
          ])
        ),
        `payLeaseInstallment(#${id})`,
        'AccountingLedger',
        targets,
        9_000_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Lease #${id} installment disbursed — CFF & P&L updated live!`, 'ok');
    } else if (btn.dataset.acceptInv !== undefined) {
      const id = Number(btn.dataset.acceptInv);
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('acceptCreditInvoice(uint64)', [['uint64', id]])),
        `acceptCreditInvoice(#${id})`,
        'AccountingLedger',
        targets,
        8_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      showBanner(`✅ Invoice #${id} co-accepted! 1100 Trade Receivables & 4000 Revenue streamed live.`, 'ok');
    } else if (btn.dataset.payInv !== undefined) {
      const id = Number(btn.dataset.payInv);
      const amt = Number(btn.dataset.amt);
      if (state.myFiat < amt && bank.toLowerCase() === session.inst.fiatLedger.toLowerCase()) {
        await session.requestFiatTopUp(amt + 25000, (m) => showBanner(escapeHtml(m), 'info'));
      }
      const r1 = await session.sendAsMyIdentity(
        encodeAbi('transferBankBalance(address,address,uint64)', [
          ['address', bank],
          ['address', treas],
          ['uint64', amt],
        ]),
        `payInvoiceBank(#${id})`,
        'AssetLedger',
        targets,
        5_500_000n
      );
      ingestReceiptLogsImmediately(r1);
      const r2 = await session.sendAsMyIdentity(
        wrapExec(
          acc,
          encodeAbi('settleCreditInvoice(uint64,uint64)', [
            ['uint64', id],
            ['uint64', amt],
          ])
        ),
        `settleCreditInvoice(#${id})`,
        'AccountingLedger',
        targets,
        8_500_000n
      );
      ingestReceiptLogsImmediately(r2);
      showBanner(`✅ Collected ${fmtNum(amt)} SGD on Invoice #${id} into Virgin Treasury!`, 'ok');
    } else if (btn.dataset.fundLoan !== undefined) {
      const id = Number(btn.dataset.fundLoan);
      const amt = Number(btn.dataset.amt);
      const r1 = await session.sendAsMyIdentity(
        encodeAbi('transferBankBalance(address,address,uint64)', [
          ['address', bank],
          ['address', treas],
          ['uint64', amt],
        ]),
        `fundLoanBank(#${id})`,
        'AssetLedger',
        targets,
        5_500_000n
      );
      ingestReceiptLogsImmediately(r1);
      const r2 = await session.sendAsMyIdentity(
        wrapExec(acc, encodeAbi('fundTermLoan(uint64)', [['uint64', id]])),
        `fundTermLoan(#${id})`,
        'AccountingLedger',
        targets,
        8_500_000n
      );
      ingestReceiptLogsImmediately(r2);
      showBanner(`✅ Funded Term Loan #${id} (${fmtNum(amt)} SGD) at Amortized Cost (IFRS 9)!`, 'ok');
    }
  } catch (e) {
    showBanner(`⚠ ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

// ============================================================================
// Confidential Category Roll-Ups & Shielded Settlement Engine (View 5)
// ============================================================================

function decodeAddrWordLocal(hex) {
  if (!hex || hex.length < 42) return ZERO_ADDR;
  return '0x' + hex.slice(-40).toLowerCase();
}

function deriveSharedRecPayKey32(claimLockHex, rBacklogHex) {
  return keccak256Bytes(
    concatBytes(
      utf8ToBytes('SLX_REC_PAY_KEY_V1:'),
      hexToBytes(claimLockHex),
      hexToBytes(rBacklogHex)
    )
  );
}

function resolveCategoryLabel(catIdHex) {
  const low = (catIdHex || '').toLowerCase();
  const hit = state.conf.categories.find((c) => c.categoryId.toLowerCase() === low);
  if (hit) return hit.label;
  if (low === CONF_CAT_IDS.PAYROLL.toLowerCase()) return 'Monthly Salaries & Payroll';
  if (low === CONF_CAT_IDS.DEFENSE_B2B.toLowerCase()) return 'B2B Defense Contracts (Epoch)';
  if (low === CONF_CAT_IDS.DEFENSE_LIVE.toLowerCase()) return 'B2B Defense (Counterparty-Shielded)';
  if (low === CONF_CAT_IDS.TRADE_AR.toLowerCase()) return 'Confidential Enterprise AR';
  if (low === CONF_CAT_IDS.VENDOR_OPEX.toLowerCase()) return 'Confidential Vendor & R&D OpEx';
  return `Category ${catIdHex.slice(0, 10)}…`;
}

function resolveSubkeyForRecord(epoch, categoryIdHex, periodHex) {
  if (state.conf.previewPublic) return null;
  const auditSk = state.conf.unwrappedAuditSecrets.get(Number(epoch));
  if (auditSk) {
    return {
      subkey: deriveCategoryPeriodSubkey(auditSk, categoryIdHex, periodHex),
      source: 'OFFICER',
    };
  }
  const grantKey = `${String(categoryIdHex).toLowerCase()}:${String(periodHex).toLowerCase()}`;
  const audSub = state.conf.auditorSubkeys.get(grantKey);
  if (audSub) {
    return { subkey: audSub, source: 'AUDITOR' };
  }
  return null;
}

function verifyBatchZkProofInBrowser(b) {
  try {
    if (b.batchType === 4) {
      return b.sumDleq64?.length === 64;
    }
    const auditPk = state.conf.auditPubKeys.get(b.auditEpoch);
    if (!auditPk || !b.cSum64 || !b.sumDleq64) return false;
    const accAddr = session.inst?.accountingLedger || '';
    const treasAddr = state.stmt?.treasuryIdentity || session.inst?.treasuryIdentity || '';
    const confAddr = state.conf.confLedgerAddr || '';
    if (b.batchType === 1) {
      const batchTag32 = computeConfidentialBatchTag(confAddr, b.batchId);
      const sumCtx = concatBytes(
        utf8ToBytes('SLX_CONF_BSUM_1:'),
        hexToBytes(accAddr).slice(-20),
        hexToBytes(treasAddr).slice(-20),
        batchTag32,
        u64BEBytes(b.totalAmount)
      );
      return verifyHeSumEqualsU64(auditPk, b.cSum64, b.totalAmount, sumCtx, b.sumDleq64);
    }
    if (b.batchType === 2 && (!b.rawSlotsBlob || b.rawSlotsBlob.length === 0)) {
      const cSumHex = bytesToHex(b.cSum64, false);
      const matchingRec = state.conf.receivables.find(
        (r) => bytesToHex(r.cBacklog64, false) === cSumHex
      );
      if (!matchingRec) return true;
      const liveCtx = concatBytes(
        utf8ToBytes('SLX_CONF_RLIV_1:'),
        hexToBytes(confAddr).slice(-20),
        u64BEBytes(matchingRec.recId),
        u64BEBytes(b.totalAmount)
      );
      return verifyHeSumEqualsU64(auditPk, b.cSum64, b.totalAmount, liveCtx, b.sumDleq64);
    }
    if (b.batchType === 2 || b.batchType === 3) {
      const sumTag = utf8ToBytes(b.batchType === 3 ? 'SLX_CONF_BILS_1:' : 'SLX_CONF_ESUM_1:');
      const sumCtx = concatBytes(
        sumTag,
        hexToBytes(confAddr).slice(-20),
        hexToBytes(b.categoryId),
        hexToBytes(b.periodHex),
        u64BEBytes(b.batchId),
        u64BEBytes(b.totalAmount)
      );
      return verifyHeSumEqualsU64(auditPk, b.cSum64, b.totalAmount, sumCtx, b.sumDleq64);
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function hydrateConfidentialState() {
  if (!session.online || !session.inst?.accountingLedger) return;
  const acc = session.inst.accountingLedger.toLowerCase();
  const chr = (state.stmt?.corporateCharter || session.inst?.corporateCharter || '').toLowerCase();
  const bank = (state.stmt?.operatingBankLedger || session.inst?.fiatLedger || '').toLowerCase();

  let confAddr = (session.inst?.confidentialLedger || '').toLowerCase();
  if (!confAddr || confAddr === ZERO_ADDR) {
    const cfHex = await session.ethCall(acc, encodeAbi('confidentialLedger()')).catch(() => '0x');
    const resolved = decodeAddrWordLocal(cfHex);
    if (resolved && resolved !== ZERO_ADDR) {
      confAddr = resolved;
      session.inst.confidentialLedger = resolved;
    }
  }
  state.conf.confLedgerAddr = confAddr && confAddr !== ZERO_ADDR ? confAddr : '';

  const [
    catsHex,
    batchesHex,
    recsHex,
    auditStateHex,
    dirCntHex,
    grantsHex,
    insidersHex,
    shdSupHex,
    shdCntHex,
  ] = await Promise.all([
    state.conf.confLedgerAddr
      ? session.ethCall(state.conf.confLedgerAddr, encodeAbi('getConfidentialCategories()')).catch(() => '0x')
      : Promise.resolve('0x'),
    state.conf.confLedgerAddr
      ? session
          .ethCall(
            state.conf.confLedgerAddr,
            encodeAbi('getConfidentialBatchesSlice(uint64,uint64)', [
              ['uint64', 0],
              ['uint64', 24],
            ])
          )
          .catch(() => '0x')
      : Promise.resolve('0x'),
    state.conf.confLedgerAddr
      ? session
          .ethCall(
            state.conf.confLedgerAddr,
            encodeAbi('getConfidentialReceivablesSlice(uint64,uint64)', [
              ['uint64', 0],
              ['uint64', 24],
            ])
          )
          .catch(() => '0x')
      : Promise.resolve('0x'),
    chr && chr !== ZERO_ADDR
      ? session.ethCall(chr, encodeAbi('getAuditEpochState()')).catch(() => '0x')
      : Promise.resolve('0x'),
    chr && chr !== ZERO_ADDR
      ? session.ethCall(chr, encodeAbi('directorCount()')).catch(() => '0x0')
      : Promise.resolve('0x0'),
    chr && chr !== ZERO_ADDR
      ? session
          .ethCall(chr, encodeAbi('getAuditorGrantsSlice(uint64,uint64)', [['uint64', 0], ['uint64', 20]]))
          .catch(() => '0x')
      : Promise.resolve('0x'),
    chr && chr !== ZERO_ADDR
      ? session.ethCall(chr, encodeAbi('getIas24InsiderEdPubKeys()')).catch(() => '0x')
      : Promise.resolve('0x'),
    bank && bank !== ZERO_ADDR
      ? session.ethCall(bank, encodeAbi('shieldedPoolSupply()')).catch(() => '0x0')
      : Promise.resolve('0x0'),
    bank && bank !== ZERO_ADDR
      ? session.ethCall(bank, encodeAbi('shieldedNoteCount()')).catch(() => '0x0')
      : Promise.resolve('0x0'),
  ]);

  state.conf.categories = decodeConfidentialCategoriesHex(catsHex);
  state.conf.batches = decodeConfidentialBatchesSliceHex(batchesHex).items.slice().reverse();
  state.conf.receivables = decodeConfidentialReceivablesSliceHex(recsHex).items.slice().reverse();
  state.conf.directorCount = decodeUintWord(dirCntHex);
  state.conf.ias24Insiders = decodeIas24InsidersHex(insidersHex);
  state.conf.shieldedPoolSupply = decodeUintWord(shdSupHex);

  const shdTotal = decodeUintWord(shdCntHex);
  if (shdTotal > 0 && bank && bank !== ZERO_ADDR) {
    const fromN = Math.max(0, shdTotal - 40);
    const notesHex = await session
      .ethCall(
        bank,
        encodeAbi('getShieldedNotesSlice(uint64,uint64)', [
          ['uint64', fromN],
          ['uint64', 40],
        ])
      )
      .catch(() => '0x');
    state.conf.shieldedNotes = decodeShieldedNotesSliceHex(notesHex).items;
  } else {
    state.conf.shieldedNotes = [];
  }

  const audBytes = hexToBytes(auditStateHex);
  state.conf.auditPubKeys.clear();
  state.conf.unwrappedAuditSecrets.clear();
  state.conf.auditorSubkeys.clear();
  state.conf.auditorGrantLabels = [];

  if (audBytes.length >= 48) {
    const curEpoch = Number(readU64BE(audBytes, 0));
    const curPkHex = bytesToHex(audBytes.slice(8, 40), true);
    state.conf.auditEpoch = curEpoch;
    if (curEpoch > 0) {
      state.conf.auditPubKeys.set(curEpoch, curPkHex);
      if (curEpoch > 1 && chr) {
        const prevEpochs = [];
        for (let e = 1; e < curEpoch; e++) prevEpochs.push(e);
        const prevPks = await Promise.all(
          prevEpochs.map((e) =>
            session.ethCall(chr, encodeAbi('getAuditPubKey(uint64)', [['uint64', e]])).catch(() => '0x')
          )
        );
        prevEpochs.forEach((e, idx) => {
          const b = hexToBytes(prevPks[idx]);
          if (b.length === 32 && !b.every((x) => x === 0)) {
            state.conf.auditPubKeys.set(e, bytesToHex(b, true));
          }
        });
      }
    }
  } else {
    state.conf.auditEpoch = 0;
  }

  const myLow = session.getVerifiedIdentityAddr();
  const rawDevPriv = session.wallet?.keypair?.privateKey || '';
  const resolvedIdKeys =
    myLow && rawDevPriv
      ? await resolveIdentityEncryptionKeys(session.rpcUrl, rawDevPriv, myLow).catch(() => null)
      : null;
  const myPriv = resolvedIdKeys?.secpPrivHex || rawDevPriv;

  // Unwrap Officer `CompanyAuditKey` envelopes (for all epochs this officer was granted)
  if (myLow && myPriv && state.myIsFinanceOfficer && state.conf.auditEpoch > 0 && chr) {
    const epochs = [];
    for (let e = 1; e <= state.conf.auditEpoch; e++) epochs.push(e);
    const envHexes = await Promise.all(
      epochs.map((e) =>
        session
          .ethCall(
            chr,
            encodeAbi('getOfficerAuditEnvelope(uint64,address)', [
              ['uint64', e],
              ['address', myLow],
            ])
          )
          .catch(() => '0x')
      )
    );
    epochs.forEach((e, idx) => {
      const envBytes = hexToBytes(envHexes[idx]);
      if (envBytes.length > 80) {
        const sk = unwrapSecretWithPrivKey(envBytes, myPriv, 'SLX_AUDIT_WRAP');
        if (sk && sk.length === 32) {
          state.conf.unwrappedAuditSecrets.set(e, sk);
        }
      }
    });
  }

  // Unwrap Scoped External Auditor `(Category, Period)` subkeys granted to `myLow`
  const grants = decodeAuditorGrantsSliceHex(grantsHex).items;
  if (myLow && myPriv && grants.length) {
    for (const g of grants) {
      if (!g.revoked && g.auditorIdentity === myLow && g.envelope?.length > 80) {
        const subkey = unwrapSecretWithPrivKey(g.envelope, myPriv, 'SLX_AUDITOR_GRANT');
        if (subkey && subkey.length === 32) {
          const k = `${g.categoryId.toLowerCase()}:${g.periodHex.toLowerCase()}`;
          state.conf.auditorSubkeys.set(k, subkey);
          state.conf.auditorGrantLabels.push(`${resolveCategoryLabel(g.categoryId)} (${g.periodLabel})`);
        }
      }
    }
  }

  // Scan personal ECDH payslip / shielded note envelopes & blinded defense client envelopes
  const myNotes = [];
  const myContracts = [];
  if (myPriv) {
    for (const n of state.conf.shieldedNotes) {
      if (!n.envelope || n.envelope.length <= 80) continue;
      const dec = decryptJsonWithPrivKey(n.envelope, myPriv, 'SLX_CONF_LINE_V1');
      if (dec && dec.claimSkHex && Number(dec.amt) > 0) {
        myNotes.push({
          ...n,
          amt: Number(dec.amt),
          memo: dec.memo || (dec.t === 'CHANGE_NOTE_V1' ? 'Shielded Split Change Note' : 'Shielded Payout'),
          periodLabel: dec.per || 'Shielded Pool',
          categoryLabel: dec.cat ? resolveCategoryLabel(dec.cat) : 'Shielded SGD-FIAT Note',
          rHex: dec.rHex,
          claimSkHex: dec.claimSkHex,
        });
      }
    }
    for (const r of state.conf.receivables) {
      if (!r.clientEnvelope || r.clientEnvelope.length <= 80) continue;
      const dec = decryptJsonWithPrivKey(r.clientEnvelope, myPriv, 'SLX_CONF_LINE_V1');
      if (dec && dec.rhoHex) {
        myContracts.push({
          ...r,
          decrypted: dec,
        });
      }
    }
  }
  state.conf.myPayslipsAndNotes = myNotes.sort((a, b) => b.noteId - a.noteId);
  state.conf.myStealthContracts = myContracts.sort((a, b) => b.recId - a.recId);

  // Seed default payroll recipient rows from company actors/personas if empty
  if (state.conf.payrollRows.every((r) => !r.recipient)) {
    const pool = [
      ...(session.aiPersonas || []).map((p) => p.identityAddr),
      ...(session.inst?.actors || []).map((a) => a.identityAddr),
    ].filter(Boolean);
    if (pool[0]) state.conf.payrollRows[0].recipient = pool[0].toLowerCase();
    if (pool[1]) state.conf.payrollRows[1].recipient = pool[1].toLowerCase();
  }
}

function renderConfidentialWorkspace(forceCompose = false) {
  if (!el.confRollupSection) return;
  const cf = state.conf;
  const hasOfficerKey = cf.unwrappedAuditSecrets.size > 0;
  const hasAuditorKey = cf.auditorSubkeys.size > 0;

  // Header Badges & Preview Public View Toggle
  if (el.confShieldedPoolBadge) {
    el.confShieldedPoolBadge.textContent = `Shielded Note Pool: ${fmtNum(cf.shieldedPoolSupply)} SGD (${cf.shieldedNotes.filter((n) => !n.spent).length} active notes)`;
  }
  if (el.btnTogglePublicPreview) {
    const canPreview = hasOfficerKey || hasAuditorKey;
    el.btnTogglePublicPreview.style.display = canPreview ? '' : 'none';
    el.btnTogglePublicPreview.textContent = cf.previewPublic
      ? '👁️ Preview Public View: ON (Showing Masked Roll-Ups)'
      : '👁️ Preview Public View: OFF';
    el.btnTogglePublicPreview.classList.toggle('primary', cf.previewPublic);
  }
  if (el.confViewerRoleBadge) {
    if (cf.previewPublic) {
      el.confViewerRoleBadge.className = 'ifrs-stream-chip amber';
      el.confViewerRoleBadge.textContent = '👁️ Public / Shareholder Simulation Mode';
    } else if (hasOfficerKey) {
      el.confViewerRoleBadge.className = 'ifrs-stream-chip emerald';
      el.confViewerRoleBadge.textContent = `🔓 Officer Audit Key Unwrapped (Epoch #${cf.auditEpoch})`;
    } else if (hasAuditorKey) {
      el.confViewerRoleBadge.className = 'ifrs-stream-chip cyan';
      el.confViewerRoleBadge.textContent = `🔍 Scoped External Auditor (${cf.auditorGrantLabels.length} Grant${cf.auditorGrantLabels.length === 1 ? '' : 's'})`;
    } else if (state.myIsShareholder) {
      el.confViewerRoleBadge.className = 'ifrs-stream-chip cyan';
      el.confViewerRoleBadge.textContent = '📊 Shareholder Roll-Up View (Line Breakdown Shielded)';
    } else {
      el.confViewerRoleBadge.className = 'ifrs-stream-chip cyan';
      el.confViewerRoleBadge.textContent = '🌐 Public ZK-Verified Roll-Up View';
    }
  }

  // 1. Category Roll-Up Summary Grid
  if (el.confCategoryGrid) {
    if (!cf.confLedgerAddr || !cf.categories.length) {
      el.confCategoryGrid.innerHTML = `
        <div class="ifrs-empty-hint" style="grid-column:1/-1;padding:18px;text-align:center;color:var(--txt-2);">
          No <code>ConfidentialLedger</code> module is attached to this company yet. Select a flagship company or incorporate a new IFRS suite to use Confidential Category Roll-Ups.
        </div>`;
    } else {
      el.confCategoryGrid.innerHTML = cf.categories
        .map((c) => {
          const isLiveMode = c.mode === CONF_ROLLUP_MODE.LIVE_COUNTERPARTY_SHIELDED;
          const modeTxt = isLiveMode
            ? 'Mode 2 • Live Total (Counterparty Shielded)'
            : `Mode 1 • Batch / Epoch Roll-Up (≥${c.minSlots} Padded Slots)`;
          const isReceivable =
            c.kind === CONF_CAT_KIND.DEFENSE_B2B || c.kind === CONF_CAT_KIND.TRADE_AR;
          const subLine = isReceivable
            ? `Unbilled Backlog (1800): ${fmtNum(c.activeBacklog)} • Open AR (1100): ${fmtNum(c.openArOrAp)} • Swept Cash: ${fmtNum(c.settledCash)} SGD`
            : `Settled Shielded Cash: ${fmtNum(c.settledCash)} • Open Accrued Liability: ${fmtNum(c.openArOrAp)} SGD`;
          return `
            <div class="ifrs-conf-cat-card">
              <div class="ifrs-conf-cat-top">
                <div class="ifrs-conf-cat-title">🔒 ${escapeHtml(c.label)}</div>
                <span class="inst-badge ${isLiveMode ? 'cyan' : 'green'}">${c.batchCount} Roll-Up${c.batchCount === 1 ? '' : 's'}</span>
              </div>
              <div class="ifrs-conf-cat-val">${fmtNum(c.totalPosted)} <span style="font-size:12px;color:#94a3b8;font-weight:600;">SGD</span></div>
              <div class="ifrs-conf-cat-sub">${escapeHtml(modeTxt)}</div>
              <div class="ifrs-conf-cat-sub" style="color:#cbd5e1;">${escapeHtml(subLine)}</div>
            </div>
          `;
        })
        .join('');
    }
  }

  // 2. Personal Payslips, Shielded Notes & Blinded Stealth Contracts Card
  const hasPersonal =
    !cf.previewPublic && (cf.myPayslipsAndNotes.length > 0 || cf.myStealthContracts.length > 0);
  if (el.myConfidentialCard && el.myConfidentialMount) {
    el.myConfidentialCard.style.display = hasPersonal ? '' : 'none';
    if (hasPersonal) {
      const notesHtml = cf.myPayslipsAndNotes
        .map((n) => {
          const stBadge = n.spent
            ? '<span class="inst-badge">SPENT / REDEEMED</span>'
            : '<span class="inst-badge green">UNSPENT SHIELDED NOTE</span>';
          return `
            <div class="ifrs-conf-note-row">
              <div>
                <div style="font-weight:800;color:#f8fafc;font-size:13.5px;">
                  💵 Note #${n.noteId} • <span style="color:#6ee7b7;font-family:var(--mono);">${fmtNum(n.amt)} SGD</span>
                  <span style="margin-left:6px;">${stBadge}</span>
                </div>
                <div style="font-size:12px;color:#94a3b8;margin-top:3px;">
                  ${escapeHtml(n.categoryLabel)} (${escapeHtml(n.periodLabel)}) • Memo: <strong>${escapeHtml(n.memo)}</strong> • Blk #${fmtNum(n.createdBlock)}
                </div>
              </div>
              ${
                !n.spent
                  ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                      <input type="number" class="inst-input" id="inRedeemAmt_${n.noteId}" value="${n.amt}" min="1" max="${n.amt}" style="width:118px;padding:5px 8px;font-size:12px;" title="Enter full amount or smaller amount to keep shielded change note" />
                      <button type="button" class="inst-btn sm emerald" data-redeem-note="${n.noteId}">🕵️ Withdraw SGD ($0-Gas Ephemeral EOA)</button>
                    </div>`
                  : ''
              }
            </div>
          `;
        })
        .join('');

      const contractsHtml = cf.myStealthContracts
        .map((r) => {
          const d = r.decrypted;
          const totalVal = Number(d.monthlyAmount) * Number(d.totalMonths);
          const catMeta = cf.categories.find(
            (c) => c.categoryId.toLowerCase() === r.categoryId.toLowerCase()
          );
          const isMode2 = catMeta?.mode === CONF_ROLLUP_MODE.LIVE_COUNTERPARTY_SHIELDED;
          const stBadge =
            r.status === 1
              ? '<span class="inst-badge amber">STAGE 1B • AWAITING MY STEALTH CO-SIGN</span>'
              : r.status === 2
                ? '<span class="inst-badge cyan">CO-SIGNED • STAGED FOR EPOCH FLUSH</span>'
                : r.status === 3
                  ? `<span class="inst-badge green">ACTIVE (${r.billedMonths}/${r.totalMonths} mos billed)</span>`
                  : '<span class="inst-badge">BILLED / ACTIVE AR</span>';
          return `
            <div class="ifrs-conf-note-row">
              <div>
                <div style="font-weight:800;color:#f8fafc;font-size:13.5px;">
                  🛡️ Stealth Contract #${r.recId}: ${escapeHtml(d.title || 'Confidential B2B Agreement')}
                  <span style="margin-left:6px;">${stBadge}</span>
                </div>
                <div style="font-size:12px;color:#94a3b8;margin-top:3px;">
                  ${fmtNum(d.monthlyAmount)} SGD/mo × ${d.totalMonths} mos (${fmtNum(totalVal)} SGD total) • Blinded PK <code>${r.blindedClientPk32Hex.slice(0, 12)}…</code>
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${
                  r.status === 1
                    ? `<button type="button" class="inst-btn sm emerald" data-stealth-cosign="${r.recId}" data-mode2="${isMode2 ? '1' : '0'}">✍️ Stealth Co-Sign + IAS 24 Proof ($0-Gas EOA)</button>`
                    : `<button type="button" class="inst-btn sm primary" data-pay-conf-rec="${r.recId}">🔒 Deposit Shielded Milestone (${fmtNum(d.monthlyAmount)} SGD)</button>`
                }
              </div>
            </div>
          `;
        })
        .join('');

      el.myConfidentialMount.innerHTML = `<div class="ifrs-conf-personal-grid">${notesHtml}${contractsHtml}</div>`;
    }
  }

  // 3. Verified Confidential Batches & Shielded Receivables Table
  if (el.confFeedTabs) {
    for (const b of el.confFeedTabs.querySelectorAll('[data-cftab]')) {
      b.classList.toggle('active', b.dataset.cftab === cf.feedTab);
    }
  }
  if (el.confFeedTable) {
    if (cf.feedTab === 'batches') {
      if (el.confFeedMeta) {
        el.confFeedMeta.textContent = `${cf.batches.length} verified category roll-up batch(es) • Audit Epoch #${cf.auditEpoch || 0}`;
      }
      el.confFeedTable.innerHTML = `
        <thead>
          <tr>
            <th>Batch &amp; GL</th>
            <th>Category &amp; Period</th>
            <th>Roll-Up Type &amp; Slots</th>
            <th>Public Verified Total</th>
            <th>Cryptographic Soundness</th>
            <th>Confidential Line Breakdown (Role-Adaptive)</th>
          </tr>
        </thead>
        <tbody>${
          cf.batches.length
            ? cf.batches
                .map((b) => {
                  const zkOk = verifyBatchZkProofInBrowser(b);
                  const zkBadge = zkOk
                    ? '<span class="ifrs-conf-zk-pill">✓ ZK Sum &amp; u24 Range Verified</span>'
                    : '<span class="inst-badge red">Proof Check Failed</span>';
                  const typeLbl =
                    b.batchType === 1
                      ? b.isPaid
                        ? 'Shielded Pool Cash Batch'
                        : 'Accrued Payable Batch (Unpaid)'
                      : b.batchType === 2
                        ? b.rawSlotsBlob?.length
                          ? 'Epoch Backlog Roll-Up (1800/2300)'
                          : 'Live Counterparty-Shielded Roll-Up'
                        : b.batchType === 3
                          ? 'Epoch Milestone Billing (1100/4000)'
                          : 'Shielded Receivable Cash Sweep (1010)';

                  const subInfo = resolveSubkeyForRecord(b.auditEpoch, b.categoryId, b.periodHex);
                  let breakdownHtml = '';
                  if (subInfo && b.auditCipher?.length > 28) {
                    const dec = decryptJsonWithSubkey(
                      subInfo.subkey,
                      b.auditCipher,
                      'SLX_CONF_AUDIT_V1'
                    );
                    if (dec && Array.isArray(dec.lines)) {
                      const srcTag =
                        subInfo.source === 'AUDITOR'
                          ? '🔍 Decrypted via Scoped Auditor Subkey'
                          : `🔓 Decrypted via Officer Audit Key (Epoch #${b.auditEpoch})`;
                      const padNote =
                        dec.paddedSlots > dec.realCount
                          ? ` + ${dec.paddedSlots - dec.realCount} zero-value dummy commitment(s)`
                          : '';
                      breakdownHtml = `
                        <div class="ifrs-conf-decrypted-box">
                          <div style="font-size:10.5px;font-weight:700;color:#6ee7b7;margin-bottom:4px;">${escapeHtml(srcTag)}${escapeHtml(padNote)}</div>
                          ${dec.lines
                            .map((ln) => {
                              const who = ln.recipient
                                ? session.labelForIdentity(ln.recipient)
                                : ln.label || `Contract #${ln.recId}`;
                              return `<div class="ifrs-conf-line-item">
                                <span><strong>${escapeHtml(who)}</strong>${ln.memo ? ` <span style="color:#94a3b8;">(${escapeHtml(ln.memo)})</span>` : ''}</span>
                                <span style="font-family:var(--mono);font-weight:700;color:#f8fafc;">${fmtNum(ln.amount)} SGD</span>
                              </div>`;
                            })
                            .join('')}
                        </div>
                      `;
                    }
                  }
                  if (!breakdownHtml) {
                    breakdownHtml = `<span class="ifrs-conf-redacted">🔒 ${b.slotCount} Padded ElGamal Slots Encrypted (Sum = ${fmtNum(b.totalAmount)} SGD)</span>`;
                  }
                  const settleBtn =
                    b.batchType === 1 && !b.isPaid && state.myIsFinanceOfficer && !cf.previewPublic
                      ? `<div style="margin-top:6px;"><button type="button" class="inst-btn sm emerald" data-settle-conf-batch="${b.batchId}">💸 Fund Shielded Pool &amp; Settle Payable</button></div>`
                      : '';
                  return `
                    <tr>
                      <td style="font-family:var(--mono);">
                        <strong>Batch #${b.batchId}</strong>
                        <div style="font-size:11px;color:#64748b;">J#${b.journalId} • Blk #${fmtNum(b.blockNumber)}</div>
                      </td>
                      <td>
                        <strong>${escapeHtml(resolveCategoryLabel(b.categoryId))}</strong>
                        <div style="font-size:11px;color:#94a3b8;font-family:var(--mono);">Period: ${escapeHtml(b.periodLabel)} • Ep #${b.auditEpoch}</div>
                      </td>
                      <td>
                        <div>${escapeHtml(typeLbl)}</div>
                        <div style="font-size:11px;color:#94a3b8;font-family:var(--mono);">${b.slotCount} encrypted slot(s)</div>
                      </td>
                      <td style="font-family:var(--mono);font-weight:800;color:#6ee7b7;white-space:nowrap;">${fmtNum(b.totalAmount)} SGD</td>
                      <td>${zkBadge}</td>
                      <td>${breakdownHtml}${settleBtn}</td>
                    </tr>
                  `;
                })
                .join('')
            : '<tr><td colspan="6" style="text-align:center;color:var(--txt-2);">No confidential roll-up batches posted yet.</td></tr>'
        }</tbody>`;
    } else {
      if (el.confFeedMeta) {
        el.confFeedMeta.textContent = `${cf.receivables.length} shielded bilateral receivable commitment(s) • IAS 24 Insider Non-Membership Enforced`;
      }
      el.confFeedTable.innerHTML = `
        <thead>
          <tr>
            <th>Rec #</th>
            <th>Category &amp; Period</th>
            <th>Status &amp; Schedule</th>
            <th>Stealth Counterparty Commitment</th>
            <th>Decrypted Contract Terms (Officer / Scoped Auditor Only)</th>
          </tr>
        </thead>
        <tbody>${
          cf.receivables.length
            ? cf.receivables
                .map((r) => {
                  const stBadge =
                    r.status === 1
                      ? '<span class="inst-badge amber">STAGE 1B • AWAITING STEALTH CO-SIGN</span>'
                      : r.status === 2
                        ? '<span class="inst-badge cyan">STAGED (HIDDEN UNTIL EPOCH FLUSH)</span>'
                        : r.status === 3
                          ? `<span class="inst-badge green">ACTIVE BACKLOG (${r.billedMonths}/${r.totalMonths} mos)</span>`
                          : '<span class="inst-badge">BILLED / OPEN AR</span>';
                  const subInfo = resolveSubkeyForRecord(r.auditEpoch, r.categoryId, r.periodHex);
                  let termsHtml = '';
                  if (subInfo && r.auditEnvelope?.length > 28) {
                    const dec = decryptJsonWithSubkey(
                      subInfo.subkey,
                      r.auditEnvelope,
                      'SLX_CONF_AUDIT_V1'
                    );
                    if (dec) {
                      const clientLbl = dec.client
                        ? session.labelForIdentity(dec.client)
                        : dec.clientLabel || 'External Client';
                      termsHtml = `
                        <div class="ifrs-conf-decrypted-box">
                          <div style="font-weight:700;color:#f8fafc;">${escapeHtml(dec.title || 'Classified Contract')} — ${escapeHtml(clientLbl)}</div>
                          <div style="font-size:11.5px;color:#6ee7b7;font-family:var(--mono);margin-top:2px;">
                            ${fmtNum(dec.monthlyAmount)} SGD/mo × ${dec.totalMonths} mos = ${fmtNum(dec.backlogTotal)} SGD Backlog
                          </div>
                        </div>
                      `;
                    }
                  }
                  if (!termsHtml) {
                    const auditSk = !cf.previewPublic
                      ? cf.unwrappedAuditSecrets.get(r.auditEpoch)
                      : null;
                    const elgamalMo = auditSk ? decryptElGamalU24(auditSk, r.cMonthly64) : null;
                    termsHtml =
                      elgamalMo !== null
                        ? `<div class="ifrs-conf-decrypted-box">🔓 ElGamal BSGS Decrypted: <strong>${fmtNum(elgamalMo)} SGD/mo × ${r.totalMonths} mos</strong></div>`
                        : `<span class="ifrs-conf-redacted">🔒 Encrypted ElGamal Commitment <code>${bytesToHex(r.cBacklog64.slice(0, 8), true)}…</code></span>`;
                  }
                  return `
                    <tr>
                      <td style="font-family:var(--mono);font-weight:800;">#${r.recId}</td>
                      <td>
                        <strong>${escapeHtml(resolveCategoryLabel(r.categoryId))}</strong>
                        <div style="font-size:11px;color:#94a3b8;font-family:var(--mono);">${escapeHtml(r.periodLabel)} • Ep #${r.auditEpoch}</div>
                      </td>
                      <td>
                        ${stBadge}
                        <div style="font-size:11px;color:#94a3b8;font-family:var(--mono);margin-top:2px;">${r.totalMonths} mos × ${fmtNum(r.monthBlocks)} blks</div>
                      </td>
                      <td>
                        <span class="ifrs-conf-zk-pill">✓ IAS 24 Non-Insider</span>
                        <div style="font-size:11px;color:#64748b;font-family:var(--mono);margin-top:3px;">P_blind: ${r.blindedClientPk32Hex.slice(0, 14)}…</div>
                      </td>
                      <td>${termsHtml}</td>
                    </tr>
                  `;
                })
                .join('')
            : '<tr><td colspan="5" style="text-align:center;color:var(--txt-2);">No shielded receivable commitments proposed yet.</td></tr>'
        }</tbody>`;
    }
    fitConfFeedViewportToThreeRows();
  }

  // 4. Officer Confidential Booking & Epoch Roll-Up Studio
  if (el.confOfficerBookingCard && el.confComposeMount) {
    const showOfficerStudio = Boolean(state.myIsFinanceOfficer && cf.confLedgerAddr && !cf.previewPublic);
    el.confOfficerBookingCard.style.display = showOfficerStudio ? '' : 'none';
    if (!showOfficerStudio) return;

    for (const b of el.confComposeTabs?.querySelectorAll('[data-cctab]') || []) {
      b.classList.toggle('active', b.dataset.cctab === cf.composeTab);
    }

    const stagedCnt = cf.receivables.filter((r) => r.status === 2).length;
    const activeCnt = cf.receivables.filter((r) => r.status === 3 && r.billedMonths < r.totalMonths).length;
    const renderKey = `${cf.composeTab}:${cf.payrollRows.length}:${session.myIdentityAddr}:${cf.auditEpoch}:${stagedCnt}:${activeCnt}:${cf.shieldedNotes.filter((n) => !n.spent).length}`;
    if (!forceCompose && cf.composeRenderedKey === renderKey) return;
    cf.composeRenderedKey = renderKey;

    const candidateMap = new Map();
    if (session.myIdentityAddr) {
      candidateMap.set(
        session.myIdentityAddr.toLowerCase(),
        `Me (${session.myIdentityHandle || shortAddr(session.myIdentityAddr)})`
      );
    }
    for (const p of session.aiPersonas || []) {
      if (p.identityAddr) candidateMap.set(p.identityAddr.toLowerCase(), p.displayLabel || p.nickname);
    }
    for (const d of session.dexDesks || []) {
      if (d.identityAddr) candidateMap.set(d.identityAddr.toLowerCase(), d.displayLabel || d.nickname);
    }
    for (const a of session.inst?.actors || []) {
      if (a.identityAddr) candidateMap.set(a.identityAddr.toLowerCase(), a.name || a.handle);
    }

    if (cf.composeTab === 'payroll') {
      const rowsHtml = cf.payrollRows
        .map((row, idx) => {
          const opts = Array.from(candidateMap.entries())
            .map(
              ([addr, lbl]) =>
                `<option value="${addr}" ${row.recipient === addr ? 'selected' : ''}>${escapeHtml(lbl)}</option>`
            )
            .join('');
          return `
            <div class="ifrs-conf-compose-row" data-prow-idx="${idx}">
              <select class="inst-input conf-prow-recip">${opts}</select>
              <input type="number" class="inst-input conf-prow-amt" value="${Number(row.amount || 10000)}" min="1" max="16777215" placeholder="SGD Amount" />
              <input type="text" class="inst-input conf-prow-memo" value="${escapeHtml(row.memo || '')}" placeholder="Encrypted Line Memo (e.g. Base + Bonus)" />
              ${
                cf.payrollRows.length > 1
                  ? `<button type="button" class="inst-btn sm" data-del-prow="${idx}">✕</button>`
                  : `<span style="font-size:11px;color:#64748b;font-family:var(--mono);">Slot #1</span>`
              }
            </div>
          `;
        })
        .join('');

      el.confComposeMount.innerHTML = `
        <div class="ifrs-form-grid" style="margin-bottom:10px;">
          <div class="ifrs-field">
            <label>Payable / Expense Roll-Up Category</label>
            <select class="inst-input" id="inConfPayCat">
              <option value="${CONF_CAT_IDS.PAYROLL}">Monthly Salaries &amp; Payroll (6100 / 2100 / 1010)</option>
              <option value="${CONF_CAT_IDS.VENDOR_OPEX}">Confidential Vendor &amp; R&amp;D OpEx (6400 / 2010 / 1010)</option>
            </select>
          </div>
          <div class="ifrs-field">
            <label>Period Tag (KDF Subkey Scope)</label>
            <input type="text" class="inst-input" id="inConfPayPeriod" value="FY2026-M11" maxlength="28" />
          </div>
          <div class="ifrs-field">
            <label>Settlement Mode</label>
            <select class="inst-input" id="inConfPayPaid">
              <option value="1">Fund Shielded SGD-FIAT Pool Immediately (1010 Cash Lump Sum)</option>
              <option value="0">Accrue Liability Now (2100 / 2010) — Fund Shielded Pool Later</option>
            </select>
          </div>
        </div>
        <div class="ifrs-conf-compose-rows" id="confPayrollRowsWrap">${rowsHtml}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">
          <button type="button" class="inst-btn sm" id="btnAddConfPayRow">+ Add Recipient Line</button>
          <button type="button" class="inst-btn emerald" id="btnPostConfPayroll">🔒 Prove u24 Ranges &amp; Post Confidential Batch (Auto-Pads ≥4 Slots)</button>
        </div>
      `;
    } else {
      const insiderSet = new Set(cf.ias24Insiders.map((x) => x.identity.toLowerCase()));
      const extCandidates = Array.from(candidateMap.entries()).filter(
        ([addr]) => !insiderSet.has(addr)
      );
      const clientOpts = (extCandidates.length ? extCandidates : Array.from(candidateMap.entries()))
        .map(([addr, lbl]) => {
          const isIns = insiderSet.has(addr);
          return `<option value="${addr}">${escapeHtml(lbl)}${isIns ? ' [IAS 24 Insider — Blocked]' : ' [External Arm\'s-Length ✓]'}</option>`;
        })
        .join('');

      el.confComposeMount.innerHTML = `
        <div class="ifrs-form-grid">
          <div class="ifrs-field">
            <label>Receivable Roll-Up Category &amp; Timing Mode</label>
            <select class="inst-input" id="inConfRecCat">
              <option value="${CONF_CAT_IDS.DEFENSE_B2B}">Mode 1: B2B Defense Contracts — Epoch Roll-Up (Hides Amount + Client)</option>
              <option value="${CONF_CAT_IDS.DEFENSE_LIVE}">Mode 2: B2B Defense — Live Total (Counterparty-Shielded)</option>
              <option value="${CONF_CAT_IDS.TRADE_AR}">Mode 1: Confidential Enterprise AR — Epoch Roll-Up</option>
            </select>
          </div>
          <div class="ifrs-field">
            <label>External Arm's-Length Client Identity</label>
            <select class="inst-input" id="inConfRecClient">${clientOpts}</select>
          </div>
          <div class="ifrs-field">
            <label>Encrypted Contract Title</label>
            <input type="text" class="inst-input" id="inConfRecTitle" value="Autonomous Defense Telemetry Suite" maxlength="48" />
          </div>
          <div class="ifrs-field">
            <label>Monthly Milestone (SGD)</label>
            <input type="number" class="inst-input" id="inConfRecMonthly" value="25000" min="100" max="2000000" />
          </div>
          <div class="ifrs-field">
            <label>Total Months (1–60)</label>
            <input type="number" class="inst-input" id="inConfRecMonths" value="6" min="1" max="60" />
          </div>
          <div class="ifrs-field">
            <label>Blocks / Month &amp; Period Tag</label>
            <div style="display:flex;gap:6px;">
              <input type="number" class="inst-input" id="inConfRecBlks" value="15" min="10" style="width:88px;" />
              <input type="text" class="inst-input" id="inConfRecPeriod" value="FY2026-Q4" maxlength="24" />
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;">
          <button type="button" class="inst-btn primary" id="btnProposeConfRec">🛡️ Propose Blinded Receivable Commitment</button>
          <button type="button" class="inst-btn emerald" id="btnFlushConfEpoch" ${stagedCnt === 0 ? 'disabled' : ''}>📦 Flush Epoch Roll-Up (${stagedCnt} Staged)</button>
          <button type="button" class="inst-btn" id="btnBillConfEpoch" ${activeCnt === 0 ? 'disabled' : ''}>🧾 Bill Due Category Epoch (${activeCnt} Active)</button>
          <button type="button" class="inst-btn" id="btnSweepConfCash">🏦 Sweep Shielded Receivable Cash → Treasury</button>
        </div>
      `;
    }
  }
}

function syncPayrollRowsFromDom() {
  const wrap = document.getElementById('confPayrollRowsWrap');
  if (!wrap) return;
  const rows = [];
  for (const rEl of wrap.querySelectorAll('.ifrs-conf-compose-row')) {
    rows.push({
      recipient: (rEl.querySelector('.conf-prow-recip')?.value || '').toLowerCase(),
      amount: Math.max(1, Number(rEl.querySelector('.conf-prow-amt')?.value || 0)),
      memo: rEl.querySelector('.conf-prow-memo')?.value || '',
    });
  }
  if (rows.length) state.conf.payrollRows = rows;
}

el.btnTogglePublicPreview?.addEventListener('click', () => {
  state.conf.previewPublic = !state.conf.previewPublic;
  renderConfidentialWorkspace(true);
});

el.confFeedTabs?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-cftab]');
  if (!btn) return;
  state.conf.feedTab = btn.dataset.cftab || 'batches';
  renderConfidentialWorkspace(false);
});

el.confComposeTabs?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-cctab]');
  if (!btn) return;
  syncPayrollRowsFromDom();
  state.conf.composeTab = btn.dataset.cctab || 'payroll';
  renderConfidentialWorkspace(true);
});

el.myConfidentialMount?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || state.busy) return;
  const bank = state.stmt?.operatingBankLedger || session.inst?.fiatLedger;
  const confAddr = state.conf.confLedgerAddr;

  state.busy = true;
  try {
    if (btn.dataset.redeemNote !== undefined) {
      const nid = Number(btn.dataset.redeemNote);
      const note = state.conf.myPayslipsAndNotes.find((n) => n.noteId === nid);
      if (!note) throw new Error('Shielded note metadata not found');
      const amtInput = document.getElementById(`inRedeemAmt_${nid}`);
      const redeemAmt = Math.min(note.amt, Math.max(1, Math.floor(Number(amtInput?.value || note.amt))));
      const myId = await session.ensureMyIdentity((m) => showBanner(escapeHtml(m), 'info'));
      const myKeys = await session.ensureMyIdentityEncryptionKeys();

      showBanner(
        redeemAmt < note.amt
          ? `Generating u24 range proof to withdraw ${fmtNum(redeemAmt)} SGD & mint ${fmtNum(note.amt - redeemAmt)} SGD shielded change note via $0-gas ephemeral EOA…`
          : `Generating ZK nullifier & Schnorr proof to withdraw ${fmtNum(redeemAmt)} SGD via $0-gas ephemeral EOA…`,
        'info'
      );

      const built = buildSpendOrRedeemShieldedNoteTx({
        bankLedgerAddr: bank,
        noteId: note.noteId,
        noteAmount: note.amt,
        noteRScalar: note.rHex,
        claimSecretScalarOrHex: note.claimSkHex,
        auditPub32Hex: note.auditPkHex,
        publicRedeemAmt: redeemAmt,
        publicRecipient: myId,
        ownerSecpPub64Hex: myKeys.secpPub64Hex,
      });

      const rcpt = await session.sendEphemeralZeroGasTx({
        to: bank,
        dataHex: built.calldata,
        label: `spendOrRedeemShieldedNote(#${note.noteId})`,
        contractLabel: 'AssetLedger(ShieldedPool)',
        extraTargets: [bank, myId],
        gasLimit: 9_500_000n,
      });
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderConfidentialWorkspace(true);
      showBanner(
        redeemAmt < note.amt
          ? `✅ Withdrew +${fmtNum(redeemAmt)} SGD via fresh $0-gas ephemeral EOA and minted a new ${fmtNum(built.changeAmount)} SGD shielded change note!`
          : `✅ Redeemed +${fmtNum(redeemAmt)} SGD from Shielded Pool via fresh $0-gas ephemeral EOA!`,
        'ok'
      );
    } else if (btn.dataset.stealthCosign !== undefined) {
      const recId = Number(btn.dataset.stealthCosign);
      const isMode2 = btn.dataset.mode2 === '1';
      const rec = state.conf.myStealthContracts.find((r) => r.recId === recId);
      if (!rec) throw new Error('Stealth receivable record not found');
      const myId = await session.ensureMyIdentity((m) => showBanner(escapeHtml(m), 'info'));
      const myKeys = await resolveIdentityEncryptionKeys(
        session.rpcUrl,
        session.wallet.keypair.privateKey,
        myId
      );
      const d = rec.decrypted;
      const totalVal = Number(d.monthlyAmount) * Number(d.totalMonths);
      const auditPk = state.conf.auditPubKeys.get(rec.auditEpoch);

      showBanner(
        `Proving Stealth Schnorr Co-Signature + IAS 24 Insider Non-Membership (${state.conf.ias24Insiders.length} Charter insiders) & broadcasting via $0-gas ephemeral EOA…`,
        'info'
      );
      const calldata = buildStealthCosignTx({
        confLedgerAddr: confAddr,
        recId,
        cBacklog64: rec.cBacklog64,
        stealthH32Hex: rec.stealthH32Hex,
        clientEdSecretScalar: myKeys.edSecretScalar,
        clientEdPub32Hex: myKeys.edPub32Hex,
        rhoScalar: leBytesToBigInt(hexToBytes(d.rhoHex)),
        insiderEdPubs: state.conf.ias24Insiders.map((x) => x.edPub32Bytes),
        isLiveMode2: isMode2,
        publicLiveTotal: totalVal,
        auditPub32Hex: auditPk,
        rBacklogScalar: leBytesToBigInt(hexToBytes(d.rBacklogHex)),
      });

      const rcpt = await session.sendEphemeralZeroGasTx({
        to: confAddr,
        dataHex: calldata,
        label: `stealthCosignConfidentialReceivable(#${recId})`,
        contractLabel: 'ConfidentialLedger',
        extraTargets: [
          confAddr,
          ...(state.stmt?.corporateCharter ? [state.stmt.corporateCharter] : []),
          ...(session.inst?.shareLedger ? [session.inst.shareLedger] : []),
          ...state.conf.ias24Insiders.map((x) => x.identity || x.identityAddr),
        ],
        gasLimit: 9_500_000n,
      });
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderConfidentialWorkspace(true);
      showBanner(
        isMode2
          ? `✅ Stealth co-signed Contract #${recId} from a $0-gas ephemeral EOA! Public category total updated while your counterparty identity stays 100% blinded.`
          : `✅ Stealth co-signed Contract #${recId} from a $0-gas ephemeral EOA! Staged privately until the next Category Epoch Flush.`,
        'ok'
      );
    } else if (btn.dataset.payConfRec !== undefined) {
      const recId = Number(btn.dataset.payConfRec);
      const rec = state.conf.myStealthContracts.find((r) => r.recId === recId);
      if (!rec) throw new Error('Stealth receivable record not found');
      const d = rec.decrypted;
      const amt = Number(d.monthlyAmount);
      const myId = await session.ensureMyIdentity((m) => showBanner(escapeHtml(m), 'info'));
      if (state.myFiat < amt && bank.toLowerCase() === session.inst.fiatLedger.toLowerCase()) {
        await session.requestFiatTopUp(amt + 25000, (m) => showBanner(escapeHtml(m), 'info'));
      }
      const auditPk =
        state.conf.auditPubKeys.get(state.conf.auditEpoch) ||
        state.conf.auditPubKeys.get(rec.auditEpoch);
      if (!auditPk) throw new Error('Company Audit Public Key not initialized');

      showBanner(
        `Minting ${fmtNum(amt)} SGD Shielded Payment Note locked to Contract #${recId}'s one-time stealth lock…`,
        'info'
      );
      const { ct64, rScalar } = heEncryptU64(auditPk, amt);
      const mintCtx = concatBytes(
        utf8ToBytes('SLX_SHD_MINT1_V1:'),
        hexToBytes(bank).slice(-20),
        hexToBytes(myId).slice(-20),
        u64BEBytes(amt),
        hexToBytes(d.claimLockHex)
      );
      const dleq64 = proveHeSumEqualsU64(auditPk, rScalar, mintCtx);
      const sharedPayKey = deriveSharedRecPayKey32(d.claimLockHex, d.rBacklogHex);
      const payCipher = encryptJsonWithSubkey(
        sharedPayKey,
        {
          t: 'REC_MILESTONE_PAY_V1',
          recId,
          amt,
          rHex: bytesToHex(scalarToLeBytes32(rScalar), true),
        },
        'SLX_CONF_AUDIT_V1'
      );

      const mintCd = encodeAbi(
        'mintShieldedNote(address,uint64,bytes32,bytes32,bytes,bytes,bytes,address)',
        [
          ['address', myId],
          ['uint64', amt],
          ['bytes32', auditPk],
          ['bytes32', d.claimLockHex],
          ['bytes', ct64],
          ['bytes', dleq64],
          ['bytes', payCipher],
          ['address', ZERO_ADDR],
        ]
      );
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(bank, mintCd),
        `mintShieldedNote(${amt} SGD)`,
        'AssetLedger(ShieldedPool)',
        [bank],
        7_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderConfidentialWorkspace(true);
      showBanner(
        `✅ Deposited ${fmtNum(amt)} SGD into the Shielded Note Pool for Contract #${recId} — ready for Officer lump-sum category cash sweep!`,
        'ok'
      );
    }
  } catch (e) {
    showBanner(`⚠ ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.confFeedTable?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-settle-conf-batch]');
  if (!btn || state.busy) return;
  const batchId = Number(btn.dataset.settleConfBatch);
  const confAddr = state.conf.confLedgerAddr;
  const acc = session.inst.accountingLedger;
  const bank = state.stmt?.operatingBankLedger || session.inst.fiatLedger;
  const treas = state.stmt?.treasuryIdentity || session.inst.treasuryIdentity;
  state.busy = true;
  try {
    showBanner(`Settling Accrued Confidential Batch #${batchId} into Shielded SGD-FIAT Pool…`, 'info');
    const rcpt = await session.sendAsMyIdentity(
      wrapExec(
        confAddr,
        encodeAbi('settleAccruedConfidentialBatch(uint64,address)', [
          ['uint64', batchId],
          ['address', ZERO_ADDR],
        ])
      ),
      `settleAccruedConfidentialBatch(#${batchId})`,
      'ConfidentialLedger',
      [confAddr, acc, bank, treas],
      9_200_000n
    );
    ingestReceiptLogsImmediately(rcpt);
    await hydrateConfidentialState();
    renderAll(true);
    showBanner(`✅ Settled Batch #${batchId}! Single lump sum debited from Virgin Treasury into individual Shielded Notes.`, 'ok');
  } catch (e) {
    showBanner(`⚠ ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

async function ensureCompanyAuditEpochAndConfLink() {
  const acc = session.inst.accountingLedger;
  const chr = state.stmt?.corporateCharter || session.inst.corporateCharter;
  const confAddr = state.conf.confLedgerAddr;
  const myId = await session.ensureMyIdentity();
  const myKeys = await session.ensureMyIdentityEncryptionKeys();

  const curLinkedHex = await session.ethCall(acc, encodeAbi('confidentialLedger()')).catch(() => '0x');
  if (decodeAddrWordLocal(curLinkedHex) === ZERO_ADDR && confAddr) {
    await session.sendAsMyIdentity(
      wrapExec(
        acc,
        encodeAbi('setConfidentialLedger(address,address)', [
          ['address', confAddr],
          ['address', ZERO_ADDR],
        ])
      ),
      'setConfidentialLedger()',
      'AccountingLedger',
      [acc, confAddr, chr],
      6_000_000n
    );
  }

  if (state.conf.auditEpoch === 0) {
    showBanner('Initializing Epoch #1 CompanyAuditKey on CorporateCharter…', 'info');
    const auditKp = deriveCompanyAuditKeypair(randomBytes(32), chr, 1);
    const wrap = wrapSecretForRecipientSecp(
      auditKp.secretLeBytes32,
      myKeys.secpPub64Bytes,
      'SLX_AUDIT_WRAP'
    );
    const wrapsBlob = concatBytes(
      u16BEBytes(1),
      hexToBytes(myId).slice(-20),
      u16BEBytes(wrap.length),
      wrap
    );
    await session.sendAsMyIdentity(
      wrapExec(
        chr,
        encodeAbi('initOrRotateAuditEpoch(bytes32,bytes,address)', [
          ['bytes32', auditKp.pub32Hex],
          ['bytes', wrapsBlob],
          ['address', ZERO_ADDR],
        ])
      ),
      'initOrRotateAuditEpoch(#1)',
      'CorporateCharter',
      [chr, myId],
      6_500_000n
    );
    await hydrateConfidentialState();
  }
}

el.confComposeMount?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || state.busy) return;

  if (btn.id === 'btnAddConfPayRow') {
    syncPayrollRowsFromDom();
    if (state.conf.payrollRows.length >= 8) {
      showBanner('Maximum 8 line recipients per batch (padded up to 10 total slots).', 'info');
      return;
    }
    const fallbackRecip =
      state.conf.payrollRows[0]?.recipient ||
      session.aiPersonas?.[0]?.identityAddr ||
      session.myIdentityAddr ||
      '';
    state.conf.payrollRows.push({
      recipient: fallbackRecip,
      amount: 9500,
      memo: 'Confidential Line Item',
    });
    renderConfidentialWorkspace(true);
    return;
  }
  if (btn.dataset.delProw !== undefined) {
    syncPayrollRowsFromDom();
    const idx = Number(btn.dataset.delProw);
    if (state.conf.payrollRows.length > 1) {
      state.conf.payrollRows.splice(idx, 1);
      renderConfidentialWorkspace(true);
    }
    return;
  }

  const acc = session.inst.accountingLedger;
  const confAddr = state.conf.confLedgerAddr;
  const chr = state.stmt?.corporateCharter || session.inst.corporateCharter;
  const bank = state.stmt?.operatingBankLedger || session.inst.fiatLedger;
  const treas = state.stmt?.treasuryIdentity || session.inst.treasuryIdentity;
  const targets = [acc, confAddr, chr, bank, treas, session.manifest?.hfsRegistry].filter(Boolean);

  state.busy = true;
  try {
    await ensureCompanyAuditEpochAndConfLink();
    const ep = state.conf.auditEpoch;
    const auditPk = state.conf.auditPubKeys.get(ep);
    const auditSk = state.conf.unwrappedAuditSecrets.get(ep);
    if (!auditPk) throw new Error('Active CompanyAuditKey public key missing on CorporateCharter');

    if (btn.id === 'btnPostConfPayroll') {
      syncPayrollRowsFromDom();
      const catHex = document.getElementById('inConfPayCat')?.value || CONF_CAT_IDS.PAYROLL;
      const periodStr = (document.getElementById('inConfPayPeriod')?.value || 'FY2026-M11').trim();
      const isPaidNow = document.getElementById('inConfPayPaid')?.value !== '0';

      showBanner(
        `Reading recipient v3 encryption keys & proving 24-bit non-negative ZK range proofs (≥${CONF_MIN_PADDED_SLOTS} padded slots)…`,
        'info'
      );
      const items = [];
      for (const r of state.conf.payrollRows) {
        if (!r.recipient || r.amount <= 0) continue;
        if (
          session.myIdentityAddr &&
          r.recipient.toLowerCase() === session.myIdentityAddr.toLowerCase()
        ) {
          await session.ensureMyIdentityEncryptionKeys();
        }
        const keys = await readOnChainIdentityEncryptionKeys(session.rpcUrl, r.recipient);
        items.push({
          recipientIdentity: r.recipient,
          recipientLabel: session.labelForIdentity(r.recipient),
          recipientSecpPub64Hex: keys?.secpPub64Hex || null,
          amount: Math.floor(Number(r.amount)),
          memo: r.memo || 'Payroll / OpEx',
        });
      }
      if (!items.length) throw new Error('Add at least one recipient line item');

      const nextBatchHex = await session.ethCall(
        confAddr,
        encodeAbi('getConfidentialBatchesSlice(uint64,uint64)', [
          ['uint64', 0],
          ['uint64', 1],
        ])
      );
      const nextBatchId = decodeConfidentialBatchesSliceHex(nextBatchHex).total;
      const subkey = auditSk ? deriveCategoryPeriodSubkey(auditSk, catHex, periodStr) : null;

      const built = buildConfidentialPayableBatchTx({
        confLedgerAddr: confAddr,
        accountingLedgerAddr: acc,
        treasuryIdentityAddr: treas,
        batchId: nextBatchId,
        categoryIdHex: catHex,
        periodLabel: periodStr,
        auditPub32Hex: auditPk,
        subkey32: subkey,
        isPaidNow,
        items,
        minSlots: CONF_MIN_PADDED_SLOTS,
        authObj: ZERO_ADDR,
      });

      const rcpt = await session.sendAsMyIdentity(
        wrapExec(confAddr, built.calldata),
        `postConfidentialPayableBatch(${built.slotCount} slots, ${built.totalAmount} SGD)`,
        'ConfidentialLedger',
        [...targets, ...items.map((x) => x.recipientIdentity)],
        9_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderAll(true);
      showBanner(
        `✅ Posted ZK-Verified Confidential Batch #${nextBatchId} (${fmtNum(built.totalAmount)} SGD across ${built.slotCount} padded slots)! Individual payslips encrypted; public GL updated cleanly.`,
        'ok'
      );
    } else if (btn.id === 'btnProposeConfRec') {
      const catHex = document.getElementById('inConfRecCat')?.value || CONF_CAT_IDS.DEFENSE_B2B;
      const clientAddr = (document.getElementById('inConfRecClient')?.value || '').toLowerCase();
      const title = (document.getElementById('inConfRecTitle')?.value || 'Defense Milestone Contract').trim();
      const monthlyAmount = Math.max(100, Math.floor(Number(document.getElementById('inConfRecMonthly')?.value || 25000)));
      const totalMonths = Math.max(1, Math.min(60, Math.floor(Number(document.getElementById('inConfRecMonths')?.value || 6))));
      const monthBlocks = Math.max(5, Math.floor(Number(document.getElementById('inConfRecBlks')?.value || 15)));
      const periodStr = (document.getElementById('inConfRecPeriod')?.value || 'FY2026-Q4').trim();

      if (
        session.myIdentityAddr &&
        clientAddr === session.myIdentityAddr.toLowerCase()
      ) {
        await session.ensureMyIdentityEncryptionKeys();
      }
      const clientKeys = await readOnChainIdentityEncryptionKeys(session.rpcUrl, clientAddr);
      if (!clientKeys) {
        throw new Error(
          `Selected counterparty (${session.labelForIdentity(clientAddr)}) has not registered v3 encryptionKeys() on its Identity HFS yet.`
        );
      }

      const recSliceHex = await session.ethCall(
        confAddr,
        encodeAbi('getConfidentialReceivablesSlice(uint64,uint64)', [
          ['uint64', 0],
          ['uint64', 1],
        ])
      );
      const nextRecId = decodeConfidentialReceivablesSliceHex(recSliceHex).total;
      const subkey = auditSk ? deriveCategoryPeriodSubkey(auditSk, catHex, periodStr) : null;

      showBanner(
        'Generating u24 milestone range proof, blinded counterparty commitment & IAS 24 Insider Non-Membership check…',
        'info'
      );
      const prop = buildConfidentialReceivableProposal({
        confLedgerAddr: confAddr,
        recId: nextRecId,
        categoryIdHex: catHex,
        periodLabel: periodStr,
        monthlyAmount,
        totalMonths,
        monthBlocks,
        auditPub32Hex: auditPk,
        subkey32: subkey,
        clientIdentityAddr: clientAddr,
        clientLabel: session.labelForIdentity(clientAddr),
        clientEdPub32Hex: clientKeys.edPub32Hex,
        clientSecpPub64Hex: clientKeys.secpPub64Hex,
        contractTitle: title,
        insiderEdPubs: state.conf.ias24Insiders.map((x) => x.edPub32Bytes),
        authObj: ZERO_ADDR,
      });

      let authAddr = ZERO_ADDR;
      if (state.conf.directorCount > 1) {
        const chAuth = session.codeHashes?.authorization;
        if (!chAuth) throw new Error('Missing authorization codeHash for multi-director Board Resolution');
        showBanner('Multi-director Charter detected: deploying & approving Board Authorization…', 'info');
        const actionHashHex = await session.ethCall(confAddr, prop.actionHashCalldata);
        const rDep = await session.sendRawSigned({
          privateKey: session.wallet.keypair.privateKey,
          to: null,
          dataHex: chAuth,
          label: 'deploy(Authorization)',
          contractLabel: 'Authorization',
          gasLimit: 4_800_000n,
        });
        authAddr = rDep.contractAddress.toLowerCase();
        await session.sendAsMyIdentity(
          encodeAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
            ['address', authAddr],
            ['address', session.inst.registry],
            ['address', confAddr],
            ['address', chr],
            ['bytes32', GOV_CONSTANTS.POLICY_BOARD_RESOLUTION],
            ['bytes32', actionHashHex],
          ]),
          'initCharterAuth(CONFIDENTIAL_RECEIVABLE)',
          'Authorization',
          [...targets, authAddr],
          7_500_000n
        );
        await session.sendAsMyIdentity(
          encodeAbi('approveAndFinalizeAuth(address)', [['address', authAddr]]),
          'approveStage(BoardResolution)',
          'Authorization',
          [...targets, authAddr],
          6_500_000n
        );
        const stHex = await session.ethCall(authAddr, encodeAbi('status()')).catch(() => '0x0');
        if (decodeUintWord(stHex) !== 2) {
          showBanner(
            `⏳ Board Resolution <code>${shortAddr(authAddr)}</code> created & signed (1/${state.conf.directorCount} Directors). Have remaining Director(s) approve in CorporateCharter to finalize!`,
            'info'
          );
          return;
        }
      }

      const rcpt = await session.sendAsMyIdentity(
        wrapExec(confAddr, prop.buildCalldata(authAddr)),
        `proposeConfidentialReceivable(#${nextRecId})`,
        'ConfidentialLedger',
        [...targets, authAddr],
        9_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderConfidentialWorkspace(true);
      showBanner(
        `✅ Proposed Blinded Receivable #${nextRecId}! Revenue stays 0 until the external counterparty stealth co-signs from a $0-gas ephemeral EOA.`,
        'ok'
      );
    } else if (btn.id === 'btnFlushConfEpoch' || btn.id === 'btnBillConfEpoch') {
      const isBilling = btn.id === 'btnBillConfEpoch';
      if (!auditSk) throw new Error('Officer CompanyAuditKey required to aggregate & prove category epoch roll-up');
      const candidates = state.conf.receivables.filter((r) =>
        isBilling ? r.status === 3 && r.billedMonths < r.totalMonths : r.status === 2
      );
      if (!candidates.length) throw new Error('No eligible confidential receivables ready for this epoch action');

      const targetCat = candidates[0].categoryId;
      const targetEpoch = candidates[0].auditEpoch;
      const sameGroup = candidates
        .filter((r) => r.categoryId === targetCat && r.auditEpoch === targetEpoch)
        .slice(0, 6);

      const entries = [];
      const curBlk = state.store?.currentBlock || session.blockNumber;
      for (const r of sameGroup) {
        if (isBilling) {
          const nextDue = r.startBlock + (r.billedMonths + 1) * r.monthBlocks;
          if (curBlk < nextDue) continue;
        }
        const sub = deriveCategoryPeriodSubkey(
          state.conf.unwrappedAuditSecrets.get(r.auditEpoch) || auditSk,
          r.categoryId,
          r.periodHex
        );
        const dec = decryptJsonWithSubkey(sub, r.auditEnvelope, 'SLX_CONF_AUDIT_V1');
        if (!dec) continue;
        entries.push({
          recId: r.recId,
          amount: isBilling ? Number(dec.monthlyAmount) : Number(dec.backlogTotal),
          rScalar: isBilling ? dec.rMonthlyHex : dec.rBacklogHex,
          label: dec.title || `Contract #${r.recId}`,
        });
      }
      if (!entries.length) {
        throw new Error(
          isBilling
            ? 'No active confidential contracts have reached their next monthly milestone block yet.'
            : 'Could not decrypt staged receivable audit envelopes with current Officer key.'
        );
      }

      const periodStr = (document.getElementById('inConfRecPeriod')?.value || sameGroup[0].periodLabel || 'FY2026-Q4').trim();
      const nextBatchHex = await session.ethCall(
        confAddr,
        encodeAbi('getConfidentialBatchesSlice(uint64,uint64)', [
          ['uint64', 0],
          ['uint64', 1],
        ])
      );
      const nextBatchId = decodeConfidentialBatchesSliceHex(nextBatchHex).total;
      const outSubkey = deriveCategoryPeriodSubkey(
        state.conf.unwrappedAuditSecrets.get(targetEpoch) || auditSk,
        targetCat,
        periodStr
      );

      showBanner(
        `Padding ${entries.length} contract(s) to ≥${CONF_MIN_PADDED_SLOTS} slots with zero-value u24 range proofs & proving category sum conservation…`,
        'info'
      );
      const built = buildConfidentialEpochRollupTx({
        isBilling,
        confLedgerAddr: confAddr,
        batchId: nextBatchId,
        categoryIdHex: targetCat,
        periodLabel: periodStr,
        auditPub32Hex: state.conf.auditPubKeys.get(targetEpoch) || auditPk,
        subkey32: outSubkey,
        entries,
        minSlots: CONF_MIN_PADDED_SLOTS,
        authObj: ZERO_ADDR,
      });

      const rcpt = await session.sendAsMyIdentity(
        wrapExec(confAddr, built.calldata),
        isBilling
          ? `billConfidentialCategoryEpoch(${built.publicTotal} SGD)`
          : `flushConfidentialReceivableEpoch(${built.publicTotal} SGD)`,
        'ConfidentialLedger',
        targets,
        9_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderAll(true);
      showBanner(
        isBilling
          ? `✅ Billed ${fmtNum(built.publicTotal)} SGD across ${entries.length} contract(s) (${built.slotCount} padded slots) → 1100 Trade AR & 4000 Revenue!`
          : `✅ Flushed Epoch Roll-Up: +${fmtNum(built.publicTotal)} SGD into 1800 Unbilled Backlog (${built.slotCount} padded slots, zero counterparty leakage)!`,
        'ok'
      );
    } else if (btn.id === 'btnSweepConfCash') {
      if (!auditSk) throw new Error('Officer CompanyAuditKey required to sweep shielded receivable notes');
      // Match unspent shielded notes against decrypted company receivable `claimLockHex`s
      const lockMap = new Map();
      for (const r of state.conf.receivables) {
        const sk = state.conf.unwrappedAuditSecrets.get(r.auditEpoch);
        if (!sk || !r.auditEnvelope?.length) continue;
        const sub = deriveCategoryPeriodSubkey(sk, r.categoryId, r.periodHex);
        const dec = decryptJsonWithSubkey(sub, r.auditEnvelope, 'SLX_CONF_AUDIT_V1');
        if (dec?.claimSkHex && dec?.rBacklogHex) {
          lockMap.set(r.claimLockHex.toLowerCase(), {
            rec: r,
            claimSkHex: dec.claimSkHex,
            sharedPayKey: deriveSharedRecPayKey32(r.claimLockHex, dec.rBacklogHex),
          });
        }
      }
      const sweepItems = [];
      for (const n of state.conf.shieldedNotes) {
        if (n.spent || n.auditPkHex.toLowerCase() !== auditPk.toLowerCase()) continue;
        const match = lockMap.get(n.claimLockHex.toLowerCase());
        if (!match || !n.envelope?.length) continue;
        const payDec = decryptJsonWithSubkey(match.sharedPayKey, n.envelope, 'SLX_CONF_AUDIT_V1');
        if (payDec && Number(payDec.amt) > 0 && payDec.rHex) {
          sweepItems.push({
            noteId: n.noteId,
            amt: Number(payDec.amt),
            rScalar: leBytesToBigInt(hexToBytes(payDec.rHex)),
            claimSkScalar: leBytesToBigInt(hexToBytes(match.claimSkHex)),
            categoryId: match.rec.categoryId,
            periodHex: match.rec.periodHex,
          });
        }
      }
      if (!sweepItems.length) {
        throw new Error('No unspent client milestone notes found in the Shielded Pool for this company yet.');
      }
      const catId = sweepItems[0].categoryId;
      const grp = sweepItems.filter((x) => x.categoryId === catId).slice(0, 8);
      const totalSweep = grp.reduce((s, x) => s + x.amt, 0);
      const noteIdsBlob = concatBytes(...grp.map((x) => u64BEBytes(x.noteId)));
      const sigChunks = [];
      let rSum = 0n;
      for (const item of grp) {
        const spCtx = concatBytes(
          utf8ToBytes('SLX_SHD_SWSP_V1:'),
          hexToBytes(bank).slice(-20),
          u64BEBytes(item.noteId),
          u64BEBytes(totalSweep),
          hexToBytes(treas).slice(-20)
        );
        sigChunks.push(proveEd25519Schnorr(item.claimSkScalar, ED25519_BASEPOINT_BYTES, spCtx));
        rSum = (rSum + item.rScalar) % ED25519_L;
      }
      const sumCtx = concatBytes(
        utf8ToBytes('SLX_SHD_SWSUM_V1:'),
        hexToBytes(bank).slice(-20),
        hexToBytes(treas).slice(-20),
        u64BEBytes(totalSweep),
        keccak256Bytes(noteIdsBlob)
      );
      const sumDleq = proveHeSumEqualsU64(auditPk, rSum, sumCtx);
      const sweepCd = encodeAbi(
        'sweepConfidentialCategoryCash(bytes32,bytes32,uint64,bytes,bytes,address)',
        [
          ['bytes32', catId],
          ['bytes32', grp[0].periodHex],
          ['uint64', totalSweep],
          ['bytes', noteIdsBlob],
          ['bytes', concatBytes(...sigChunks, sumDleq)],
          ['address', ZERO_ADDR],
        ]
      );
      showBanner(`Sweeping ${grp.length} shielded payment note(s) (${fmtNum(totalSweep)} SGD lump sum) into Virgin Treasury…`, 'info');
      const rcpt = await session.sendAsMyIdentity(
        wrapExec(confAddr, sweepCd),
        `sweepConfidentialCategoryCash(${totalSweep} SGD)`,
        'ConfidentialLedger',
        targets,
        9_500_000n
      );
      ingestReceiptLogsImmediately(rcpt);
      await hydrateConfidentialState();
      renderAll(true);
      showBanner(`✅ Swept +${fmtNum(totalSweep)} SGD from Shielded Pool into Virgin Treasury (1010 Cash / 1100 Trade AR)!`, 'ok');
    }
  } catch (e) {
    showBanner(`⚠ ${escapeHtml(e.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

// ============================================================================
// Boot Session, Hydrate Anchor Snapshot & Subscribe to Live WebSocket Logs
// ============================================================================

syncWorkspaceView(true);
renderHumanGlGuide();
await session.boot();
await hydrateAnchorSnapshot();

accWatcher = slxWatchChainApp({
  rpcUrl: () => session.rpcUrl,
  filter: () => {
    const addrs = [
      session.inst?.accountingLedger,
      state.conf?.confLedgerAddr || session.inst?.confidentialLedger,
      state.store?.corporateCharter || session.inst?.corporateCharter,
      state.store?.operatingBankLedger || session.inst?.fiatLedger,
      state.marketCtx?.dexAddress,
    ].filter(Boolean);
    const anchorBlk = state.store?.anchorBlock || 0;
    return {
      address: Array.from(new Set(addrs.map((a) => a.toLowerCase()))),
      ...(anchorBlk > 0 ? { fromBlock: `0x${anchorBlk.toString(16)}` } : {}),
    };
  },
  onHead: (head) => handleIncomingHead(head),
  onLog: (log) => handleIncomingLog(log),
  // Zero `onRefresh` polling while WebSocket is connected — only re-anchor if WS went offline!
  onRefresh: async (meta) => {
    if (meta?.source === 'offlineFallback') {
      await hydrateAnchorSnapshot();
    }
  },
});
