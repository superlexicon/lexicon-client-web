/**
 * SuperLexicon Gamified CorporateCharter Command Bridge (`/charter.html`)
 *
 * Implements the full constitutional & corporate-actions lifecycle on Subnet 1:
 *  1. Sovereign Incorporation Wizard with shared Phantom Fleet AI Identities as Directors & Shareholders.
 *  2. Auto-created First Shareholder Resolution (`activateCharter`) with live block-by-block AI co-signing.
 *  3. Constitutional Enactment (`PENDING_RATIFICATION` -> `ACTIVE`) unlocking gamified Corporate Actions:
 *     - Appoint / Fire Directors (`addDirector` / `removeDirector`)
 *     - Board Resolutions for C-Suite Officers (`CEO`, `COO`, `CTO`, `CFO`, `CPO` via `grantRole` / `revokeRole`)
 *     - Raise Share Capital (`issueAsset`)
 *     - Share-Backed Futures Underwriting & MEV-Proof `DexClob` Attachment
 *  4. Auto-generated Formal Legal Resolution Templates with live Director & Shareholder placeholders.
 *  5. Live Reactive 3-Tier Organization Chart updated automatically on `DirectorAdded/Removed` & `RoleGranted/Revoked`.
 *  6. Realtime Reactive Capitalization Table (SVG Donut + animated delta badges on `AssetIssued` & `Auction*Filled`).
 *  7. Interactive 3-Step Restricted Share Transfer Call-Auction Arena (Window 1 Bids -> Window 2 Co-Sale -> Window 3 ROFR -> Pro-Rata Clearing).
 *  8. 60-FPS asymptotic client-side in-flight animations, terminal block snaps & celebratory particle bursts.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  randomBytes,
  keccak256Hex,
  signLexiconTx,
  slxWatchChainApp,
  slxSubscribeLogs,
  createSingleFlightRefresh,
  fetchRegisteredHolders,
  isTerminalAuthStatus,
  readOnChainIdentityEncryptionKeys,
  CONF_CAT_IDS,
  encodePeriodTagBytes32,
  deriveCompanyAuditKeypair,
  deriveCategoryPeriodSubkey,
  wrapSecretForRecipientSecp,
  unwrapSecretWithPrivKey,
  decodeAuditorGrantsSliceHex,
  SlxSocialAbi,
  decodeSocialMessagesHex,
  SUBGROUP_ALL_MEMBERS_SLUG,
  SUBGROUP_DEVELOPERS_SLUG,
  SOVEREIGN_SUPERLEXICON_CHARTER_SPEC,
  isConfusableSuperlexiconName,
  companyGroupChannelHash,
  CharterSocialAbi,
  decodeCompanySocialOverviewHex,
} from '@superlexicon/sdk';
import {
  SlxInstSession,
  GOV_CONSTANTS,
  HFS_EVENT_TOPICS,
  ZERO_ADDR,
  u16BEBytes,
  u64BEBytes,
  readU64BE,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
  encodeClassLabelBytes32,
  decodeBytes32LabelHex,
  decodeVotingPowerHex,
  decodeAuctionDeadlinesHex,
  decodeAuctionOrdersRawHex,
  decodeFuturesAllowanceHex,
  decodeLastAuctionSettlementHex,
  decodeHfsEventLog,
  roleDisplayName,
  shortAddr,
  fmtNum,
  escapeHtml,
} from '@superlexicon/sdk/inst-suite';
import {
  deployNewCorporateCharterHfs,
  HfsRegistryAbi,
  setUrlHfsParam,
} from '@superlexicon/sdk/hfs-deployers';

const STORAGE_RES_KEY = 'slx_gamified_charter_resolutions_v2';
const STORAGE_AUC_KEY = 'slx_gamified_charter_auctions_v2';
const STORAGE_ISS_KEY = 'slx_gamified_charter_issuance_v5';
const STORAGE_PREF_KEY = 'slx_gamified_charter_share_classes_v4';

const EXEC_SEAT_SPECS = [
  { key: 'ROLE_CEO', short: 'CEO', title: 'Chief Executive Officer', icon: '👑', roleId: GOV_CONSTANTS.ROLE_CEO },
  { key: 'ROLE_COO', short: 'COO', title: 'Chief Operating Officer', icon: '⚙️', roleId: GOV_CONSTANTS.ROLE_COO },
  { key: 'ROLE_CTO', short: 'CTO', title: 'Chief Technology Officer', icon: '🧠', roleId: GOV_CONSTANTS.ROLE_CTO },
  { key: 'ROLE_TREASURY_MANAGER', short: 'CFO', title: 'Chief Financial Officer', icon: '🏦', roleId: GOV_CONSTANTS.ROLE_TREASURY_MANAGER },
  { key: 'ROLE_PRODUCT_MANAGER', short: 'CPO', title: 'Chief Product Officer', icon: '📦', roleId: GOV_CONSTANTS.ROLE_PRODUCT_MANAGER },
];

const DONUT_COLORS = ['#38bdf8', '#10b981', '#f59e0b', '#a78bfa', '#f43f5e', '#2dd4bf', '#fb7185', '#60a5fa'];

const SERVICE_CONTRACT_PRESETS = {
  'DEF-MOD-FLRC-C2': {
    code: 'DEF-MOD-FLRC-C2',
    title: 'Ministry of Defence: Tactical Anti-Jamming FLRC Mesh & Post-Quantum C2 Subnet',
    monthly: 180000,
    months: 12,
    monthBlocks: 35,
    clientPoolIdx: 5,
  },
  'ENG-ASIC-RF-NRE': {
    code: 'ENG-ASIC-RF-NRE',
    title: 'Custom Dual-Band RF + RISC-V SoC Engineering & Firmware NRE',
    monthly: 125000,
    months: 9,
    monthBlocks: 42,
    clientPoolIdx: 6,
  },
  'INF-GRID-SCADA': {
    code: 'INF-GRID-SCADA',
    title: 'National Power & Water Authority: Air-Gapped Critical Infrastructure SCADA Mesh',
    monthly: 95000,
    months: 12,
    monthBlocks: 48,
    clientPoolIdx: 7,
  },
  'MAR-PORT-DVP-NET': {
    code: 'MAR-PORT-DVP-NET',
    title: 'Autonomous Maritime Port & Strait Logistics Offline DvP Mesh',
    monthly: 85000,
    months: 8,
    monthBlocks: 36,
    clientPoolIdx: 3,
  },
  'GOV-CBDC-RADIO': {
    code: 'GOV-CBDC-RADIO',
    title: 'Sovereign Central Bank Disaster-Resilient Offline Radio CBDC Rail',
    monthly: 135000,
    months: 10,
    monthBlocks: 40,
    clientPoolIdx: 4,
  },
};

function encodeSvcTagBytes32(codeStr) {
  const b = new Uint8Array(32);
  b.set(utf8ToBytes(String(codeStr || 'DEF-MOD-FLRC-C2').trim()).slice(0, 24), 0);
  return bytesToHex(b);
}

// ---------------------------------------------------------------------------
// Reactive Application State
// ---------------------------------------------------------------------------

const state = {
  activeTab: 'issuance',
  capToolExpanded: true,
  busy: false,
  phase1Loaded: false,
  initialLoadComplete: false,
  prevCharterAddr: '',
  prevCharterState: 0,
  charterState: 0, // 0=uninit, 1=PENDING_RATIFICATION, 2=ACTIVE
  activatedBlock: 0,
  directorCount: 0,
  totalShares: 0,
  totalConvertedCommon: 0,
  totalVotingPower: 0,
  requiredSuperVotes: 0,
  myShares: 0,
  myConvertedCommon: 0,
  myVotes: 0,
  myCash: 0,
  myHasSignedSha: false,
  myVerifiedIdentity: '',
  myIsDirector: false,
  myNeedsDirectorConsent: false,
  myIsShareholder: false,
  myIsOfficer: false,
  myHasEsopGrant: false,
  myCanGovern: false,
  myIsAssociated: false,
  auditGov: {
    epoch: 0,
    auditPkHex: '',
    unwrappedAuditSk: null,
    grants: [],
    renderedKey: '',
  },

  shareClasses: [], // [{ ledger, symbol, votesPerShare, convNumer, convDenom, convMult, supply }]
  directors: [], // [{ addr, label, isMe, isAi, avatar, consented }]
  pendingDirectors: [], // [{ addr, label, isMe, isAi, avatar }] (post-activation addDirector awaiting consent)
  execSeats: [], // [{ key, short, title, icon, roleId, holders: [{ addr, label, avatar }] }]
  capRows: [], // [{ addr, label, shares, convCommon, votes, holdings, cash, pct, roles: [], isMe, isAi, avatar }]
  prevSharesByAddr: new Map(),
  capDeltas: new Map(), // addr -> { delta, expiresAt }
  orgFlashes: new Map(), // key -> { kind: 'add'|'remove', expiresAt }

  firstRes: null, // live enriched First Shareholder Resolution
  resolutions: [], // live enriched Shareholder & Board Resolutions
  forceAiCompleteSet: new Set(),
  aiSigningBusy: false,
  lastAiSignAt: 0,
  aiInFlightByEoa: new Map(),

  // Action Studio / Legal Library
  selectedActionKind: 'appointExec',
  legalBookOpen: true,
  templateMode: 'hydrated', // 'hydrated' | 'raw'
  resFilter: 'open', // 'open' = Current Live Actions | 'done' = Executed Past Actions
  treasuryAccount: ZERO_ADDR,
  supportsIssuanceAuction: false,
  supportsV4Governance: false,

  // Master ESOP Programmes & Employee Option Grants
  esopSupported: false,
  esopDueCount: 0,
  esopLastSweepBlock: 0,
  esopPrograms: [],
  esopGrants: [],
  esopDraftSchedule: [
    { blockOffset: 2, amount: 1500 },
    { blockOffset: 5, amount: 1500 },
    { blockOffset: 8, amount: 2000 },
  ],

  // 5-Step Share Issuance Arena
  activeIssuanceAddr: '',
  issuanceRound: null,

  // 3-Step Share Transfer Call-Auction Arena
  activeAuctionAddr: '',
  auctionStatus: 0,
  auctionDeadlines: { step1Dl: 0, step2Dl: 0, step3Dl: 0, overallDl: 0 },
  auctionOrders: [],
  auctionStep1Bids: 0,
  auctionFailedBids: false,
  auctionEscrowCash: 0,
  lastSettlement: { clearingPrice: 0, matchedQty: 0, buyDemand: 0, sellSupply: 0 },
  guidedPlan: null, // { authAddr, userSellQty, userSellPrice, win1Done, win2UserDone, win2AiDone, win3AiDone, settledDone }
  auctionBusy: false,

  // Futures & Attached DEX
  futuresLedger: ZERO_ADDR,
  futuresPct: 0,
  futuresAllowance: { convertedCommon: 0, maxAllowance: 0, alreadyUnderwritten: 0, remainingAllowance: 0, companyCap: 0 },
  myFuturesBal: 0,
  attachedDex: ZERO_ADDR,
  futuresDexBest: { bestBid: 0, bestAsk: 0 },

  // Live On-Chain Event Stream
  lastLogScanBlock: 0,
  seenLogUids: new Set(),
  eventLogs: [], // newest first

  // Incorporation Modal Draft
  incDraftAi: [],
  incDraftExt: [], // [{ identityAddr, isDirector, isShareholder, shares }]
};

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  sparkLayer: $('chrSparkLayer'),
  inflightWrap: $('chrInflightWrap'),
  inflightText: $('chrInflightText'),
  inflightPct: $('chrInflightPct'),
  inflightFill: $('chrInflightFill'),
  banner: $('chrBanner'),
  bannerText: $('chrBannerText'),
  bannerClose: $('chrBannerClose'),
  bootLoader: $('chrBootLoader'),
  bootStageText: $('chrBootStageText'),
  bootSubText: $('chrBootSubText'),
  bootPct: $('chrBootPct'),
  bootProgressFill: $('chrBootProgressFill'),

  heroBar: $('chrHeroBar'),
  heroCompanyName: $('heroCompanyName'),
  heroShareTicker: $('heroShareTicker'),
  heroStateOrb: $('heroStateOrb'),
  heroQuestSteps: $('heroQuestSteps'),
  btnFaucetCash: $('btnFaucetCash'),
  btnOpenIncorporate: $('btnOpenIncorporate'),
  myCompanyRoleBar: $('myCompanyRoleBar'),

  kpiCharterState: $('kpiCharterState'),
  kpiCharterAddr: $('kpiCharterAddr'),
  kpiDirectorCount: $('kpiDirectorCount'),
  kpiExecSummary: $('kpiExecSummary'),
  kpiTotalShares: $('kpiTotalShares'),
  kpiSuperThreshold: $('kpiSuperThreshold'),
  kpiMyVotes: $('kpiMyVotes'),
  kpiMySharePct: $('kpiMySharePct'),
  kpiFuturesCap: $('kpiFuturesCap'),
  kpiAttachedDex: $('kpiAttachedDex'),

  ratifySpotlight: $('ratifySpotlight'),
  ratifyAuthBadge: $('ratifyAuthBadge'),
  ratifyDirConsentLabel: $('ratifyDirConsentLabel'),
  ratifyDirectorChips: $('ratifyDirectorChips'),
  ratifyAiStatusText: $('ratifyAiStatusText'),
  ratifyVotesLabel: $('ratifyVotesLabel'),
  ratifyQuorumFill: $('ratifyQuorumFill'),
  ratifySignerChips: $('ratifySignerChips'),
  ratifyScrollBox: $('ratifyScrollBox'),
  ratifyHintText: $('ratifyHintText'),
  btnToggleRatifyScroll: $('btnToggleRatifyScroll'),
  btnTestInactiveGuard: $('btnTestInactiveGuard'),
  btnSignDirectorConsent: $('btnSignDirectorConsent'),
  btnForceAiRatify: $('btnForceAiRatify'),
  btnSignAndRatify: $('btnSignAndRatify'),

  tabsNav: $('chrTabs'),
  sectionNav: $('chrSectionNav'),
  btnToggleCapTool: $('btnToggleCapTool'),
  shareClassesTbody: $('shareClassesTbody'),
  selCapSplitClass: $('selCapSplitClass'),
  selCapSplitMode: $('selCapSplitMode'),
  inpCapSplitRatio: $('inpCapSplitRatio'),
  btnQuickProposeSplit: $('btnQuickProposeSplit'),
  selCapBuybackClass: $('selCapBuybackClass'),
  selCapBuybackSeller: $('selCapBuybackSeller'),
  inpCapBuybackQty: $('inpCapBuybackQty'),
  inpCapBuybackPx: $('inpCapBuybackPx'),
  btnQuickProposeBuyback: $('btnQuickProposeBuyback'),
  ongoingResolutionsCard: $('ongoingResolutionsCard'),
  relLinkAccounting: $('relLinkAccounting'),
  relMetaAccounting: $('relMetaAccounting'),
  relLinkCommerce: $('relLinkCommerce'),
  relMetaCommerce: $('relMetaCommerce'),
  relLinkDex: $('relLinkDex'),
  relMetaDex: $('relMetaDex'),
  relMetaSuite: $('relMetaSuite'),
  nextStepSpotlight: $('nextStepSpotlight'),
  tabBadgeResolutions: $('tabBadgeResolutions'),
  tabBadgeIssuance: $('tabBadgeIssuance'),
  tabBadgeTransfer: $('tabBadgeTransfer'),
  tabBadgeEsop: $('tabBadgeEsop'),
  resFilterBar: $('resFilterBar'),
  studioPlainExplainer: $('studioPlainExplainer'),
  orgChartMount: $('orgChartMount'),
  btnQuickAppointExec: $('btnQuickAppointExec'),
  capTableHero: $('capTableHero'),
  capTableTbody: $('capTableTbody'),
  btnQuickIssuanceArena: $('btnQuickIssuanceArena'),
  btnQuickEsopTab: $('btnQuickEsopTab'),
  btnQuickTransferArena: $('btnQuickTransferArena'),
  resolutionsGrid: $('resolutionsGrid'),
  btnJumpNewResolution: $('btnJumpNewResolution'),

  actionsLockedNotice: $('actionsLockedNotice'),
  actionsObserverNotice: $('actionsObserverNotice'),
  legalLibraryShelfWrap: $('legalLibraryShelfWrap'),
  legalDocumentDesk: $('legalDocumentDesk'),
  openVolumeTitle: $('openVolumeTitle'),
  btnCloseLegalBook: $('btnCloseLegalBook'),
  studioPolicyBadge: $('studioPolicyBadge'),
  actionTypePicker: $('actionTypePicker'),
  actionComposerForm: $('actionComposerForm'),
  fieldExecRoleWrap: $('fieldExecRoleWrap'),
  selExecRole: $('selExecRole'),
  fieldActionShareClassWrap: $('fieldActionShareClassWrap'),
  selActionShareClass: $('selActionShareClass'),
  fieldTargetIdentityWrap: $('fieldTargetIdentityWrap'),
  lblTargetIdentity: $('lblTargetIdentity'),
  selTargetIdentity: $('selTargetIdentity'),
  fieldCustomTargetWrap: $('fieldCustomTargetWrap'),
  inpCustomTargetIdentity: $('inpCustomTargetIdentity'),
  fieldEquityFinancingWrap: $('fieldEquityFinancingWrap'),
  selIssueAssetClass: $('selIssueAssetClass'),
  fieldIssueCustomClassWrap: $('fieldIssueCustomClassWrap'),
  inpIssueCustomClassName: $('inpIssueCustomClassName'),
  inpIssueConversionRate: $('inpIssueConversionRate'),
  inpIssueMinRaise: $('inpIssueMinRaise'),
  inpIssueMaxOwnershipPct: $('inpIssueMaxOwnershipPct'),
  equityDerivedEconomicsBox: $('equityDerivedEconomicsBox'),
  fieldServiceContractWrap: $('fieldServiceContractWrap'),
  selSvcPreset: $('selSvcPreset'),
  inpSvcCode: $('inpSvcCode'),
  inpSvcMonthly: $('inpSvcMonthly'),
  inpSvcMonths: $('inpSvcMonths'),
  inpSvcMonthBlocks: $('inpSvcMonthBlocks'),
  svcDerivedSummaryBox: $('svcDerivedSummaryBox'),

  selActiveIssuanceRound: $('selActiveIssuanceRound'),
  issuanceUnavailableNotice: $('issuanceUnavailableNotice'),
  issuanceLaunchReadonlyNotice: $('issuanceLaunchReadonlyNotice'),
  formLaunchIssuanceRound: $('formLaunchIssuanceRound'),
  selArenaIssAsset: $('selArenaIssAsset'),
  fieldArenaIssClassNameWrap: $('fieldArenaIssClassNameWrap'),
  inpArenaIssClassName: $('inpArenaIssClassName'),
  inpArenaIssConv: $('inpArenaIssConv'),
  inpArenaIssRaise: $('inpArenaIssRaise'),
  inpArenaIssMaxOwn: $('inpArenaIssMaxOwn'),
  issArenaDerivedSummary: $('issArenaDerivedSummary'),
  btnArenaTestZeroBidIssuance: $('btnArenaTestZeroBidIssuance'),
  btnLaunchIssuanceRound: $('btnLaunchIssuanceRound'),
  issuanceStepper: $('issuanceStepper'),
  issClockLabel: $('issClockLabel'),
  issBlockReadout: $('issBlockReadout'),
  issWindowProgressFill: $('issWindowProgressFill'),
  issDeadlinesSub: $('issDeadlinesSub'),
  issEscrowBalance: $('issEscrowBalance'),
  issEscrowSub: $('issEscrowSub'),
  issProjectedClearing: $('issProjectedClearing'),
  issProjectedRule: $('issProjectedRule'),
  issColStep1: $('issColStep1'),
  issColStep2: $('issColStep2'),
  issColStep3: $('issColStep3'),
  issBadgeStep1: $('issBadgeStep1'),
  issBadgeStep2: $('issBadgeStep2'),
  issBadgeStep3: $('issBadgeStep3'),
  issStep1QuorumBox: $('issStep1QuorumBox'),
  btnVoteIssuanceStep1: $('btnVoteIssuanceStep1'),
  issStep1ReadonlyNote: $('issStep1ReadonlyNote'),
  inpIssStep2Qty: $('inpIssStep2Qty'),
  inpIssStep2Price: $('inpIssStep2Price'),
  btnPlaceIssStep2Bid: $('btnPlaceIssStep2Bid'),
  issOrdersStep2: $('issOrdersStep2'),
  issStep3RofrRow: $('issStep3RofrRow'),
  issStep3ReadonlyNote: $('issStep3ReadonlyNote'),
  inpIssStep3Qty: $('inpIssStep3Qty'),
  inpIssStep3Price: $('inpIssStep3Price'),
  btnPlaceIssStep3Rofr: $('btnPlaceIssStep3Rofr'),
  issOrdersStep3: $('issOrdersStep3'),
  issAllocStatusText: $('issAllocStatusText'),
  btnRefundFailedIssuanceArena: $('btnRefundFailedIssuanceArena'),
  btnPreviewIssuanceSha: $('btnPreviewIssuanceSha'),
  btnSignIssuanceShaClaim: $('btnSignIssuanceShaClaim'),
  issAllotmentsTableWrap: $('issAllotmentsTableWrap'),
  issuanceEventLogs: $('issuanceEventLogs'),
  fieldShareAmountWrap: $('fieldShareAmountWrap'),
  inpStudioShareAmount: $('inpStudioShareAmount'),
  fieldIssuePriceWrap: $('fieldIssuePriceWrap'),
  inpStudioIssueMinPrice: $('inpStudioIssueMinPrice'),
  btnTestZeroBidIssuance: $('btnTestZeroBidIssuance'),
  studioIssueModeHint: $('studioIssueModeHint'),
  fieldBuybackWrap: $('fieldBuybackWrap'),
  inpBuybackShares: $('inpBuybackShares'),
  inpBuybackPrice: $('inpBuybackPrice'),
  fieldSplitRatioWrap: $('fieldSplitRatioWrap'),
  lblSplitRatio: $('lblSplitRatio'),
  inpSplitRatio: $('inpSplitRatio'),
  fieldFuturesPctWrap: $('fieldFuturesPctWrap'),
  inpStudioFuturesPct: $('inpStudioFuturesPct'),
  chkAutoAiCosign: $('chkAutoAiCosign'),
  btnDeployActionRes: $('btnDeployActionRes'),
  btnTplModeHydrated: $('btnTplModeHydrated'),
  btnTplModeRaw: $('btnTplModeRaw'),
  studioTemplateBox: $('studioTemplateBox'),

  esopUnavailableNotice: $('esopUnavailableNotice'),
  esopProgReadonlyNote: $('esopProgReadonlyNote'),
  formCreateEsopProg: $('formCreateEsopProg'),
  selEsopAssetClass: $('selEsopAssetClass'),
  inpEsopConvRate: $('inpEsopConvRate'),
  inpEsopAuthShares: $('inpEsopAuthShares'),
  inpEsopStrikePrice: $('inpEsopStrikePrice'),
  btnProposeEsopProg: $('btnProposeEsopProg'),
  esopProgramsList: $('esopProgramsList'),
  esopGrantReadonlyNote: $('esopGrantReadonlyNote'),
  formAwardEsopOptions: $('formAwardEsopOptions'),
  selGrantProgram: $('selGrantProgram'),
  selGrantCliffPreset: $('selGrantCliffPreset'),
  selGrantEmployee: $('selGrantEmployee'),
  fieldGrantCustomEmpWrap: $('fieldGrantCustomEmpWrap'),
  inpGrantCustomEmployee: $('inpGrantCustomEmployee'),
  btnPresetRapidEsopSchedule: $('btnPresetRapidEsopSchedule'),
  btnAddEsopTranche: $('btnAddEsopTranche'),
  esopScheduleRows: $('esopScheduleRows'),
  btnProposeEsopGrant: $('btnProposeEsopGrant'),
  esopDueBadge: $('esopDueBadge'),
  esopLastSweepBadge: $('esopLastSweepBadge'),
  esopGrantsList: $('esopGrantsList'),

  chkAuctionAiPeers: $('chkAuctionAiPeers'),
  btnNewAuctionInstance: $('btnNewAuctionInstance'),
  auctionUnavailableNotice: $('auctionUnavailableNotice'),
  auctionStepper: $('auctionStepper'),
  aucClockLabel: $('aucClockLabel'),
  aucBlockReadout: $('aucBlockReadout'),
  aucWindowProgressFill: $('aucWindowProgressFill'),
  aucDeadlinesSub: $('aucDeadlinesSub'),
  aucEscrowBalance: $('aucEscrowBalance'),
  aucEscrowSub: $('aucEscrowSub'),
  aucProjectedClearing: $('aucProjectedClearing'),
  aucProjectedRule: $('aucProjectedRule'),
  splitsReadonlyNotice: $('splitsReadonlyNotice'),
  splitsActionsGrid: $('splitsActionsGrid'),
  guidedShareSaleCard: $('guidedShareSaleCard'),
  inpGuidedSellQty: $('inpGuidedSellQty'),
  inpGuidedSellPrice: $('inpGuidedSellPrice'),
  btnLaunchGuidedTransfer: $('btnLaunchGuidedTransfer'),
  aucColWin1: $('aucColWin1'),
  aucColWin2: $('aucColWin2'),
  aucColWin3: $('aucColWin3'),
  aucBadgeWin1: $('aucBadgeWin1'),
  aucBadgeWin2: $('aucBadgeWin2'),
  aucBadgeWin3: $('aucBadgeWin3'),
  inpWin1Qty: $('inpWin1Qty'),
  inpWin1Price: $('inpWin1Price'),
  btnPlaceWin1Bid: $('btnPlaceWin1Bid'),
  aucOrdersWin1: $('aucOrdersWin1'),
  aucWin2SellRow: $('aucWin2SellRow'),
  aucWin2ReadonlyNote: $('aucWin2ReadonlyNote'),
  inpWin2Qty: $('inpWin2Qty'),
  inpWin2Price: $('inpWin2Price'),
  btnPlaceWin2Sell: $('btnPlaceWin2Sell'),
  aucOrdersWin2: $('aucOrdersWin2'),
  aucWin3RofrRow: $('aucWin3RofrRow'),
  aucWin3ReadonlyNote: $('aucWin3ReadonlyNote'),
  inpWin3Qty: $('inpWin3Qty'),
  inpWin3Price: $('inpWin3Price'),
  btnPlaceWin3Rofr: $('btnPlaceWin3Rofr'),
  aucOrdersWin3: $('aucOrdersWin3'),
  aucSettleStatusText: $('aucSettleStatusText'),
  btnRefundFailedAuction: $('btnRefundFailedAuction'),
  btnTestAuctionGuard: $('btnTestAuctionGuard'),
  btnSettleAuction: $('btnSettleAuction'),
  auctionEventLogs: $('auctionEventLogs'),

  futStatusBadge: $('futStatusBadge'),
  futMetricsBox: $('futMetricsBox'),
  futReadonlyNote: $('futReadonlyNote'),
  futStep1AuthBox: $('futStep1AuthBox'),
  futStep2MintBox: $('futStep2MintBox'),
  inpFutAuthPct: $('inpFutAuthPct'),
  btnQuickAuthorizeFutures: $('btnQuickAuthorizeFutures'),
  inpUnderwriteQty: $('inpUnderwriteQty'),
  btnUnderwriteFutures: $('btnUnderwriteFutures'),
  btnCloseFutures: $('btnCloseFutures'),
  futDexBadge: $('futDexBadge'),
  futDexPanel: $('futDexPanel'),

  eventCountBadge: $('eventCountBadge'),
  liveEventFeed: $('liveEventFeed'),

  incorpModal: $('incorpModal'),
  btnCloseIncorp: $('btnCloseIncorp'),
  btnCancelIncorp: $('btnCancelIncorp'),
  incorpForm: $('incorpForm'),
  inpIncName: $('inpIncName'),
  inpIncTicker: $('inpIncTicker'),
  inpIncMyShares: $('inpIncMyShares'),
  inpIncWinBlocks: $('inpIncWinBlocks'),
  incCapSplitSummary: $('incCapSplitSummary'),
  incCapPreviewBar: $('incCapPreviewBar'),
  aiFoundersGrid: $('aiFoundersGrid'),
  inpExtIdentityAddr: $('inpExtIdentityAddr'),
  chkExtIsDir: $('chkExtIsDir'),
  chkExtIsSh: $('chkExtIsSh'),
  inpExtShares: $('inpExtShares'),
  btnAddExtParticipant: $('btnAddExtParticipant'),
  extParticipantsList: $('extParticipantsList'),
  incorpStatusBox: $('incorpStatusBox'),
  btnSubmitIncorp: $('btnSubmitIncorp'),

  scrollModal: $('scrollModal'),
  scrollModalTitle: $('scrollModalTitle'),
  scrollModalBody: $('scrollModalBody'),
  btnCloseScrollModal: $('btnCloseScrollModal'),
};

// ---------------------------------------------------------------------------
// 60-FPS In-Flight Animation, Particle Spark Bursts & Persistence Helpers
// ---------------------------------------------------------------------------

let _inflightRaf = 0;
let _inflightStart = 0;

function startInflightAnim(text) {
  cancelAnimationFrame(_inflightRaf);
  _inflightStart = performance.now();
  el.inflightText.textContent = text || '⚡ Broadcasting HFS transaction to Subnet 1…';
  el.inflightFill.style.width = '4%';
  el.inflightPct.textContent = '4%';
  el.inflightWrap.classList.add('active');

  const frame = (now) => {
    const dt = Math.max(0, now - _inflightStart);
    const pct = Math.min(88, Math.round(88 * (1 - Math.exp(-dt / 1750))));
    el.inflightFill.style.width = `${pct}%`;
    el.inflightPct.textContent = `${pct}%`;
    _inflightRaf = requestAnimationFrame(frame);
  };
  _inflightRaf = requestAnimationFrame(frame);
}

function finishInflightAnim(doneText = '✓ Confirmed in Subnet 1 Block!') {
  cancelAnimationFrame(_inflightRaf);
  el.inflightText.textContent = doneText;
  el.inflightFill.style.width = '100%';
  el.inflightPct.textContent = '100%';
  setTimeout(() => {
    el.inflightWrap.classList.remove('active');
  }, 650);
}

function setBootProgress(pct, stageText, subText) {
  session?.bootLoader?.setStage(pct, stageText, subText);
}

function completeBootLoader(doneText = '✓ Corporate Charter Synchronized with Subnet 1') {
  session?.bootLoader?.complete(
    doneText,
    `Live WebSocket stream active • Block #${fmtNum(session.blockNumber)}`
  );
}

function triggerSparkBurst(palette = ['#34d399', '#38bdf8', '#fbbf24', '#a78bfa']) {
  if (!el.sparkLayer) return;
  const cx = window.innerWidth * 0.5;
  const cy = Math.min(260, window.innerHeight * 0.32);
  for (let i = 0; i < 28; i++) {
    const sp = document.createElement('div');
    sp.className = 'chr-spark';
    const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.35;
    const dist = 70 + Math.random() * 190;
    sp.style.left = `${cx + (Math.random() - 0.5) * 120}px`;
    sp.style.top = `${cy + (Math.random() - 0.5) * 40}px`;
    sp.style.background = palette[i % palette.length];
    sp.style.boxShadow = `0 0 10px ${palette[i % palette.length]}`;
    sp.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    sp.style.setProperty('--ty', `${Math.sin(angle) * dist - 30}px`);
    el.sparkLayer.appendChild(sp);
    setTimeout(() => sp.remove(), 1000);
  }
}

function showBanner(html, kind = 'info') {
  el.banner.className = `inst-banner show ${kind}`;
  el.bannerText.innerHTML = html;
}
el.bannerClose?.addEventListener('click', () => el.banner.classList.remove('show'));

function loadSavedResolutions(chrAddr) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_RES_KEY) || '{}');
    return map[(chrAddr || '').toLowerCase()] || [];
  } catch (_) {
    return [];
  }
}

function saveResolutionRecord(chrAddr, rec) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_RES_KEY) || '{}');
    const k = (chrAddr || '').toLowerCase();
    const list = (map[k] || []).filter((x) => x.authAddr.toLowerCase() !== rec.authAddr.toLowerCase());
    map[k] = [rec, ...list];
    localStorage.setItem(STORAGE_RES_KEY, JSON.stringify(map));
  } catch (_) {}
}

function loadSavedAuctionAddr(chrAddr) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_AUC_KEY) || '{}');
    return map[(chrAddr || '').toLowerCase()] || '';
  } catch (_) {
    return '';
  }
}

function saveAuctionAddr(chrAddr, authAddr) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_AUC_KEY) || '{}');
    map[(chrAddr || '').toLowerCase()] = (authAddr || '').toLowerCase();
    localStorage.setItem(STORAGE_AUC_KEY, JSON.stringify(map));
  } catch (_) {}
}

function loadSavedIssuanceAddr(chrAddr) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_ISS_KEY) || '{}');
    return map[(chrAddr || '').toLowerCase()] || '';
  } catch (_) {
    return '';
  }
}

function saveIssuanceAddr(chrAddr, authAddr) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_ISS_KEY) || '{}');
    map[(chrAddr || '').toLowerCase()] = (authAddr || '').toLowerCase();
    localStorage.setItem(STORAGE_ISS_KEY, JSON.stringify(map));
  } catch (_) {}
}

function loadSavedPreferredLedgers(chrAddr) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_PREF_KEY) || '{}');
    return map[(chrAddr || '').toLowerCase()] || {};
  } catch (_) {
    return {};
  }
}

function savePreferredLedger(chrAddr, classKey, ledgerAddr, symbol, convRate) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_PREF_KEY) || '{}');
    const k = (chrAddr || '').toLowerCase();
    map[k] = {
      ...(map[k] || {}),
      [classKey]: { ledger: (ledgerAddr || '').toLowerCase(), symbol, convRate: Number(convRate || 1) },
    };
    localStorage.setItem(STORAGE_PREF_KEY, JSON.stringify(map));
  } catch (_) {}
}

const CAP_TAB_IDS = ['issuance', 'transfer', 'esop', 'splits', 'futures'];

function syncCapActionPanels() {
  if (!state.myIsShareholder && state.activeTab === 'splits') {
    state.activeTab = state.issuanceRound ? 'issuance' : 'transfer';
  }
  document.querySelectorAll('#chrTabs .chr-tab-btn').forEach((b) => {
    const tabKey = b.getAttribute('data-tab');
    if (tabKey === 'splits') {
      b.style.display = state.myIsShareholder ? 'inline-flex' : 'none';
    }
    b.classList.toggle(
      'active',
      state.capToolExpanded && tabKey === state.activeTab
    );
  });
  for (const id of CAP_TAB_IDS) {
    const p = $(`panel-${id}`);
    if (p) {
      p.style.display = state.capToolExpanded && id === state.activeTab ? 'flex' : 'none';
    }
  }
  if (el.btnToggleCapTool) {
    el.btnToggleCapTool.textContent = state.capToolExpanded
      ? 'Hide Action Tool ▴'
      : 'Show Action Tool ▾';
  }
  if (el.btnQuickIssuanceArena) {
    const showIssQuick = state.myIsShareholder || Boolean(state.issuanceRound);
    el.btnQuickIssuanceArena.style.display = showIssQuick ? 'inline-flex' : 'none';
    el.btnQuickIssuanceArena.textContent = state.myIsShareholder
      ? '💰 Raise Capital'
      : '💰 Live Funding Round';
  }
  if (el.btnQuickTransferArena) {
    el.btnQuickTransferArena.textContent = state.myIsShareholder
      ? '🔄 Buy / Sell Shares'
      : '🔄 Bid on Shares';
  }
  if (el.btnQuickEsopTab) {
    el.btnQuickEsopTab.textContent =
      state.myCanGovern || state.myHasEsopGrant ? '🎓 Employee Options' : '🎓 Option Pools';
  }
}

function switchTab(tabId, opts = { scroll: true }) {
  if (CAP_TAB_IDS.includes(tabId)) {
    state.activeTab = tabId;
    state.capToolExpanded = true;
    syncCapActionPanels();
    if (tabId === 'issuance') {
      populateIssuanceArenaDropdowns();
      renderIssuanceArenaDerived();
      renderIssuanceArena();
    } else if (tabId === 'esop') {
      populateEsopDropdowns();
      renderEsopScheduleDraft();
      renderEsopTab();
    } else if (tabId === 'splits') {
      populateCapSplitsAndBuybacks();
    }
    if (opts?.scroll !== false) {
      $('capActionsWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }

  if (tabId === 'actions') {
    state.legalBookOpen = true;
    populateActionShareClassDropdown();
    populateStudioIssueAssetDropdown();
    populateActionTargetDropdown();
    renderActionStudioState();
    renderEquityDerivedEconomics();
    renderStudioTemplatePreview();
    if (opts?.scroll !== false) {
      $('sec-corporate-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }

  if (tabId === 'overview') {
    state.resFilter = 'open';
    renderResolutionsGrid();
    if (opts?.scroll !== false) {
      (el.ongoingResolutionsCard || $('sec-corporate-actions'))?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }
}

el.tabsNav?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (btn) switchTab(btn.getAttribute('data-tab'), { scroll: false });
});

el.btnToggleCapTool?.addEventListener('click', () => {
  state.capToolExpanded = !state.capToolExpanded;
  syncCapActionPanels();
});

el.sectionNav?.addEventListener('click', (e) => {
  const link = e.target.closest('[data-jump-sec]');
  if (!link) return;
  e.preventDefault();
  const secId = link.getAttribute('data-jump-sec');
  el.sectionNav.querySelectorAll('.chr-jump-btn').forEach((b) => {
    b.classList.toggle('active', b === link);
  });
  $(secId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------------------
// Live Session (All AI Identities are operated strictly on the backend by `tx-load-sim`!)
// ---------------------------------------------------------------------------

const refreshCharterWorld = createSingleFlightRefresh(_runRefreshCharterWorldInner);

const session = new SlxInstSession({
  activePage: 'charter',
  title: 'SuperLexicon CorporateCharter — Boardroom Command',
  subtitle: 'corporate_charter.wasm + share_capital.wasm + authorization.wasm • Gamified Governance & 3-Step ROFR',
  appTitle: 'CorporateCharter — Gamified Governance & Equity Suite',
  bootLoaderElement: el.bootLoader,
  autoCompleteBootLoader: false,
  onRefresh: refreshCharterWorld,
  onIdentityLabelsUpdated: () => {
    if (state.phase1Loaded) renderEverything();
  },
  onBootStage: ({ stage, blockNumber }) => {
    if (stage === 'connected' && !state.phase1Loaded) {
      setBootProgress(
        34,
        `1/3 Connected to Subnet 1 (Block #${fmtNum(blockNumber)}) — Reading Charter & Share Classes…`,
        'Querying Board seats, C-Suite roles, and registered ShareLedgers in parallel'
      );
    } else if (stage === 'reconnecting' && !state.phase1Loaded) {
      setBootProgress(
        14,
        'Reconnecting to Subnet 1 WebSocket validator…',
        'Retrying live connection automatically'
      );
    }
  },
  onCustomDeployClick: () => openIncorpModal(),
  onTxReceipt: (rcpt) => ingestReceiptLogs(rcpt),
});

function avatarForAddr(addr) {
  const low = (addr || '').toLowerCase();
  if (session.myIdentityAddr && low === session.myIdentityAddr.toLowerCase()) return '🧑‍✈️';
  const ai = (session.aiPersonas || []).find((p) => p.identityAddr === low);
  if (ai) return ai.avatar;
  return '🏛️';
}

function companyNameStr() {
  return session.inst?.companyName || session.activeHfsEntry?.label || 'Nvidya Systems Pte. Ltd. [SIM-BOT]';
}

function shareTickerStr() {
  return session.inst?.shareTicker || session.activeHfsEntry?.meta?.sym || 'NVDAX-EQ';
}

function isBaseLegacyCharter() {
  const cur = (session.inst?.corporateCharter || '').toLowerCase();
  const base = (session.baseInst?.corporateCharter || '').toLowerCase();
  return Boolean(cur && cur === base);
}

function isSimManagedCharter() {
  const cur = (session.inst?.corporateCharter || '').toLowerCase();
  if (!cur) return false;
  const base = (session.baseInst?.corporateCharter || '').toLowerCase();
  const sec = (session.manifest?.ifrsAccounting?.secondaryCompany?.corporateCharter || '').toLowerCase();
  return cur === base || (Boolean(sec) && cur === sec);
}

function activeVerifiedIdentityLow() {
  const syncVerified = session.getVerifiedIdentityAddr();
  if (!syncVerified || syncVerified !== state.myVerifiedIdentity) return '';
  return state.myVerifiedIdentity;
}

function isActionBoardOnly(kind) {
  return kind === 'appointExec' || kind === 'revokeExec' || kind === 'serviceContract';
}

function canProposeActionKind(kind) {
  if (!activeVerifiedIdentityLow()) return false;
  return isActionBoardOnly(kind) ? state.myIsDirector : state.myIsShareholder;
}

function getResolutionStandingForMe(r) {
  const myLow = activeVerifiedIdentityLow();
  const isDir = Boolean(myLow && state.myIsDirector);
  const isSh = Boolean(myLow && state.myIsShareholder && state.myVotes > 0);
  const canVote = r.isBoard ? isDir : isSh;
  const isMsIss = r.isEquityFinancing && r.issPhase >= 1;
  const blk = session.blockNumber;
  const inStage0Bids =
    r.isIssuanceAuction &&
    !r.failedBidsStage &&
    r.status === 1 &&
    (r.currentStage === 0 || (r.step1Dl > 0 && blk <= r.step1Dl));

  if (isMsIss) {
    if (r.issPhase === 1 && !r.failedBidsStage) {
      if (isSh && !r.mySigned) {
        return {
          canVote,
          canActNow: true,
          btnText: '✍️ Vote Step 1 Shareholder Resolution (≥75%)',
          readonlyBadgeHtml: '',
        };
      }
      if (isSh && r.mySigned) {
        return {
          canVote,
          canActNow: false,
          btnText: '',
          readonlyBadgeHtml: '<span class="inst-badge green">✓ Your Vote Recorded</span>',
        };
      }
    }
    return { canVote, canActNow: false, btnText: '', readonlyBadgeHtml: '' };
  }

  if (r.failedBidsStage || inStage0Bids || (r.status !== 1 && r.status !== 2)) {
    return { canVote, canActNow: false, btnText: '', readonlyBadgeHtml: '' };
  }

  if (r.status === 2) {
    const canEnact =
      isDir || isSh || Boolean(myLow && r.execKind === 'activateCharter' && state.myNeedsDirectorConsent);
    return {
      canVote,
      canActNow: canEnact,
      btnText: r.isIssuanceAuction
        ? '⚡ Settle & Allocate Subscribed Shares'
        : '⚡ Execute Finalized Resolution',
      readonlyBadgeHtml: '',
    };
  }

  // r.status === 1 (Collecting votes)
  if (canVote && !r.mySigned) {
    const btnText = r.isEquityFinancing
      ? "✍️ Sign Shareholders' Agreement & Finalize"
      : r.isIssuanceAuction
        ? '✍️ Sign Stage 1 Vote & Settle Issuance'
        : r.isBoard
          ? '✍️ Sign Board Vote & Execute'
          : '✍️ Sign Shareholder Vote & Execute';
    return { canVote, canActNow: true, btnText, readonlyBadgeHtml: '' };
  }

  if (r.weight >= r.reqWeight && (isDir || isSh)) {
    return {
      canVote,
      canActNow: true,
      btnText: r.isIssuanceAuction
        ? '⚡ Finalize & Settle Share Allocation'
        : '⚡ Finalize & Execute Resolution',
      readonlyBadgeHtml: '',
    };
  }

  if (canVote && r.mySigned) {
    return {
      canVote,
      canActNow: false,
      btnText: '',
      readonlyBadgeHtml: '<span class="inst-badge green">✓ You Signed — Awaiting Quorum</span>',
    };
  }

  return {
    canVote,
    canActNow: false,
    btnText: '',
    readonlyBadgeHtml:
      isDir || isSh
        ? r.isBoard
          ? '<span class="inst-badge">🔒 Board Directors Only</span>'
          : '<span class="inst-badge">🔒 Shareholders Only</span>'
        : '',
  };
}

// ---------------------------------------------------------------------------
// Event Log Ingestion & Reactive UI Triggers
// ---------------------------------------------------------------------------

let charterWatcher = null;
let charterAuctionSub = null;

function ingestRawLogList(logs, { suppressFx = false } = {}) {
  if (!Array.isArray(logs) || !logs.length) return;
  let addedAny = false;
  for (const lg of logs) {
    const decoded = decodeHfsEventLog(lg, (a) => session.labelForIdentity(a));
    if (!decoded || state.seenLogUids.has(decoded.uid)) continue;
    state.seenLogUids.add(decoded.uid);
    state.eventLogs.unshift(decoded);
    addedAny = true;

    if (suppressFx || lg.isBackfill) continue;

    // Trigger reactive visual flashes on Org Chart & Cap Table!
    if (decoded.kind === 'CharterActivated') {
      triggerSparkBurst(['#10b981', '#fbbf24', '#38bdf8', '#a78bfa']);
    } else if (decoded.kind === 'DirectorAdded' && decoded.subjectAddr) {
      state.orgFlashes.set(`dir:${decoded.subjectAddr}`, { kind: 'add', expiresAt: Date.now() + 2600 });
      triggerSparkBurst(['#38bdf8', '#10b981']);
    } else if (decoded.kind === 'DirectorConsented' && decoded.subjectAddr) {
      state.orgFlashes.set(`dir:${decoded.subjectAddr}`, { kind: 'add', expiresAt: Date.now() + 2600 });
      triggerSparkBurst(['#34d399', '#38bdf8', '#fbbf24']);
    } else if (decoded.kind === 'DirectorPendingConsent' && decoded.subjectAddr) {
      state.orgFlashes.set(`dir:${decoded.subjectAddr}`, { kind: 'add', expiresAt: Date.now() + 2600 });
    } else if (decoded.kind === 'DirectorRemoved' && decoded.subjectAddr) {
      state.orgFlashes.set(`dir:${decoded.subjectAddr}`, { kind: 'remove', expiresAt: Date.now() + 2600 });
    } else if (decoded.kind === 'RoleGranted' && decoded.roleId) {
      state.orgFlashes.set(`role:${decoded.roleId}`, { kind: 'add', expiresAt: Date.now() + 2600 });
      triggerSparkBurst(['#fbbf24', '#10b981', '#38bdf8']);
    } else if (decoded.kind === 'RoleRevoked' && decoded.roleId) {
      state.orgFlashes.set(`role:${decoded.roleId}`, { kind: 'remove', expiresAt: Date.now() + 2600 });
    } else if (
      (decoded.kind === 'AssetIssued' ||
        decoded.kind === 'IssuanceSharesClaimed' ||
        decoded.kind === 'AuctionBuyerFilled' ||
        decoded.kind === 'AuctionSellerFilled') &&
      decoded.subjectAddr &&
      decoded.delta
    ) {
      state.capDeltas.set(decoded.subjectAddr.toLowerCase(), {
        delta: decoded.delta,
        expiresAt: Date.now() + 6500,
      });
      if (decoded.kind === 'AssetIssued' || decoded.kind === 'IssuanceSharesClaimed') {
        triggerSparkBurst(['#10b981', '#38bdf8']);
      }
    } else if (decoded.kind === 'AuctionTransferSettled' || decoded.kind === 'IssuanceAllocationDetermined') {
      triggerSparkBurst(['#10b981', '#fbbf24', '#38bdf8']);
    }
  }
  if (addedAny) {
    state.eventLogs.sort((a, b) => b.blk - a.blk);
    if (state.eventLogs.length > 80) state.eventLogs.length = 80;
    renderEventFeeds();
  }
}

function ingestReceiptLogs(rcpt) {
  if (rcpt && Array.isArray(rcpt.logs)) {
    ingestRawLogList(rcpt.logs);
  }
}

function getCharterWatchAddresses() {
  if (!session.inst?.corporateCharter) return [];
  return Array.from(
    new Set(
      [
        session.inst.corporateCharter,
        session.inst.shareLedger,
        session.inst.shareCapital,
        session.inst.firstResolutionAuth,
        state.activeAuctionAddr,
        state.activeIssuanceAddr,
        state.futuresLedger !== ZERO_ADDR ? state.futuresLedger : '',
        ...state.shareClasses.map((c) => c.ledger),
        ...state.esopPrograms.flatMap((p) => [p.optionLedger, p.underlyingLedger]),
        ...state.resolutions.slice(0, 6).map((r) => r.authAddr),
      ]
        .filter(Boolean)
        .map((a) => a.toLowerCase())
    )
  ).slice(0, 14);
}

// ---------------------------------------------------------------------------
// Auto-Generated Formal Corporate Resolution Template Engine (Req #4)
// ---------------------------------------------------------------------------

function buildResolutionTemplate(spec, mode = 'hydrated') {
  const tok = (placeholder, val) =>
    mode === 'raw'
      ? `<span class="tpl-raw">{{${escapeHtml(placeholder)}}}</span>`
      : `<span class="tpl-token">${escapeHtml(String(val ?? '—'))}</span>`;

  const comp = companyNameStr();
  const chrAddr = shortAddr(session.inst?.corporateCharter || '');
  const ticker = shareTickerStr();
  const blk = fmtNum(session.blockNumber || 0);
  const dirRoster =
    state.directors.map((d) => d.label).join('; ') || 'Founding Board of Directors';
  const shRoster =
    state.capRows
      .filter((r) => r.shares > 0)
      .map((r) => `${r.label} (${fmtNum(r.shares)} ${ticker}, ${r.pct}%)`)
      .join('; ') || 'Registered Founding Shareholders';
  const totSh = fmtNum(state.totalShares);
  const supVotes = fmtNum(state.requiredSuperVotes || Math.ceil((state.totalShares * 75) / 100));
  const targetName = spec.targetAddr ? session.labelForIdentity(spec.targetAddr) : 'Designated Identity';
  const targetShort = shortAddr(spec.targetAddr || '');
  const authTag = spec.authAddr ? shortAddr(spec.authAddr) : 'PENDING_DEPLOYMENT';

  if (spec.execKind === 'activateCharter') {
    return [
      `========================================================================`,
      `FIRST SHAREHOLDER SPECIAL RESOLUTION — CONSTITUTIONAL RATIFICATION`,
      `Company: ${tok('COMPANY_NAME', comp)}`,
      `CorporateCharter HFS: ${tok('CHARTER_HFS_ADDR', chrAddr)}  |  Auth HFS: ${tok('AUTH_HFS_ADDR', authTag)}`,
      `Reference Block: #${tok('BLOCK_HEIGHT', blk)}  |  Quorum: ≥75% Shareholder Super-Majority (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `1. FOUNDING SHAREHOLDERS REGISTER (${tok('SHARE_TICKER', ticker)}):`,
      `   ${tok('SHAREHOLDER_ROSTER', shRoster)}`,
      ``,
      `2. INITIAL BOARD OF DIRECTORS:`,
      `   ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      ``,
      `IT IS HEREBY RESOLVED AS A SPECIAL CONSTITUTIONAL RESOLUTION THAT:`,
      `  (a) The CorporateCharter Haltproof Subroutine deployed at ${tok('CHARTER_HFS_ADDR', chrAddr)}`,
      `      together with its pre-defined C-Suite organs, Share Class (${tok('SHARE_TICKER', ticker)}),`,
      `      and 3-Step Pre-Emptive Share Transfer Call-Auction Bylaws be RATIFIED; and`,
      `  (b) Upon execution of activateCharter(${tok('AUTH_HFS_ADDR', authTag)}), the Company's`,
      `      constitutional state shall transition from PENDING_RATIFICATION to ACTIVE.`,
    ].join('\n');
  }

  if (spec.execKind === 'addDirector') {
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — APPOINTMENT OF DIRECTOR`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Charter: ${tok('CHARTER_HFS_ADDR', chrAddr)}`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} / ${tok('TOTAL_SHARES', totSh)} ${tok('SHARE_TICKER', ticker)})`,
      `========================================================================`,
      ``,
      `CURRENT BOARD OF DIRECTORS: ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      `VOTING SHAREHOLDERS: ${tok('SHAREHOLDER_ROSTER', shRoster)}`,
      ``,
      `IT IS HEREBY RESOLVED THAT:`,
      `  1. ${tok('NOMINEE_DIRECTOR_NAME', targetName)} (Identity HFS ${tok('NOMINEE_IDENTITY_ADDR', targetShort)})`,
      `     be and is hereby appointed as an Active Director of ${tok('COMPANY_NAME', comp)};`,
      `  2. CorporateCharter.addDirector(${tok('NOMINEE_IDENTITY_ADDR', targetShort)}, ${tok('AUTH_HFS_ADDR', authTag)})`,
      `     shall update ROLE_DIRECTOR and immediately reflect on the Corporate Organization Chart.`,
    ].join('\n');
  }

  if (spec.execKind === 'removeDirector') {
    const remaining =
      state.directors
        .filter((d) => d.addr.toLowerCase() !== (spec.targetAddr || '').toLowerCase())
        .map((d) => d.label)
        .join('; ') || 'Continuing Board Members';
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — REMOVAL OF DIRECTOR FROM OFFICE`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Charter: ${tok('CHARTER_HFS_ADDR', chrAddr)}`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `VOTING SHAREHOLDERS: ${tok('SHAREHOLDER_ROSTER', shRoster)}`,
      ``,
      `IT IS HEREBY RESOLVED THAT:`,
      `  1. ${tok('OUTGOING_DIRECTOR_NAME', targetName)} (Identity HFS ${tok('OUTGOING_DIRECTOR_ADDR', targetShort)})`,
      `     be and is hereby REMOVED from the Board of Directors effective immediately;`,
      `  2. All ROLE_DIRECTOR signatory weights held by ${tok('OUTGOING_DIRECTOR_NAME', targetName)} are revoked,`,
      `     leaving Continuing Directors: ${tok('CONTINUING_DIRECTORS', remaining)}.`,
    ].join('\n');
  }

  if (spec.execKind === 'crowdfundingCampaign') {
    const cfAddr = shortAddr(spec.crowdfundingHps || spec.targetHps);
    const accAddr = shortAddr(spec.accountingLedger);
    const cfMode =
      spec.campaignMode === 1
        ? 'MODE 1 — Single Hard-Cap All-or-Nothing'
        : spec.campaignMode === 2
        ? 'MODE 2 — Single Target Flexible All-or-Nothing'
        : 'MODE 3 — Multi-Tier Stretch-Goal IFRS Growth Budget';
    const baseTgt = fmtNum(spec.baseTarget || 150000);
    const durBlks = fmtNum(spec.durationBlocks || 400);
    return [
      `========================================================================`,
      `BOARD OF DIRECTORS RESOLUTION — PRE-ORDER CROWDFUNDING & GROWTH BUDGET`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Governance Policy: POLICY_BOARD_RESOLUTION`,
      `Active Board Signatories: ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      `========================================================================`,
      ``,
      `1. LINKED IFRS ACCOUNTING LEDGER & CROWDFUNDING HFS:`,
      `   • AccountingLedger HFS: ${tok('ACCOUNTING_LEDGER', accAddr)}`,
      `   • Crowdfunding HFS:     ${tok('CROWDFUNDING_HFS', cfAddr)} (State: PENDING_BOARD_RESOLUTION)`,
      `   • Campaign Mode:        ${tok('CAMPAIGN_MODE', cfMode)}`,
      `   • Base Target & Window: ${tok('BASE_TARGET', baseTgt)} SGD/USD over ${tok('DURATION_BLOCKS', durBlks)} blocks from enactment`,
      ``,
      `IT IS HEREBY RESOLVED BY THE BOARD OF DIRECTORS THAT:`,
      `  (a) Crowdfunding.activateCampaign(${tok('AUTH_HFS_ADDR', authTag)}) be enacted to transition ${tok('CROWDFUNDING_HFS', cfAddr)} into STATE_LIVE (2);`,
      `  (b) If the base target (${tok('BASE_TARGET', baseTgt)}) is not met by the deadline block, no customer card holds shall be captured and 100% of escrowed pre-orders shall be refundable;`,
      `  (c) Upon reaching target, settled pre-order proceeds shall sweep into Account 2300 (Contract Liabilities — IFRS 15) on AccountingLedger ${tok('ACCOUNTING_LEDGER', accAddr)} and unlock the codified Stretch-Goal Growth Budget tiers.`,
    ].join('\n');
  }

  if (spec.execKind === 'serviceContract') {
    const scCode = String(spec.svcCode || 'DEF-MOD-FLRC-C2').trim().slice(0, 24);
    const scMo = Number(spec.svcMonthly || 180000);
    const scTerm = Number(spec.svcMonths || 12);
    const scBlks = Number(spec.svcMonthBlocks || 35);
    const scTotal = fmtNum(scMo * scTerm);
    const presetInfo = SERVICE_CONTRACT_PRESETS[scCode];
    return [
      `========================================================================`,
      `BOARD OF DIRECTORS RESOLUTION — SOVEREIGN / B2B MULTI-MONTH SERVICE CONTRACT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Governance Policy: POLICY_BOARD_RESOLUTION`,
      `Active Board Signatories: ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      `========================================================================`,
      ``,
      `1. CLIENT COUNTERPARTY (ARM'S-LENGTH IAS 24 VERIFIED):`,
      `   ${tok('CLIENT_IDENTITY_NAME', targetName)} (${tok('CLIENT_IDENTITY_ADDR', targetShort)})`,
      ``,
      `2. ENGAGEMENT & MONTHLY MILESTONE PAYMENT SCHEDULE:`,
      `   • Contract Code: ${tok('CONTRACT_CODE', scCode)}${presetInfo ? ` — ${presetInfo.title}` : ''}`,
      `   • Monthly Milestone Fee: ${tok('MONTHLY_FEE_SGD', fmtNum(scMo))} SGD / month × ${tok('TERM_MONTHS', fmtNum(scTerm))} months (every ${tok('MONTH_BLOCKS', fmtNum(scBlks))} blocks)`,
      `   • Total Contract Backlog Value: ${tok('TOTAL_CONTRACT_VALUE_SGD', scTotal)} SGD`,
      ``,
      `IT IS HEREBY RESOLVED BY THE BOARD OF DIRECTORS THAT:`,
      `  (a) AccountingLedger.proposeServiceContract(${tok('CLIENT_IDENTITY_ADDR', targetShort)}, "${tok('CONTRACT_CODE', scCode)}", ${tok('MONTHLY_FEE_SGD', fmtNum(scMo))}, ${tok('TERM_MONTHS', fmtNum(scTerm))}, ${tok('MONTH_BLOCKS', fmtNum(scBlks))}, ${tok('AUTH_HFS_ADDR', authTag)}) be ratified;`,
      `  (b) Upon bilateral Client Identity co-signature (coSignServiceContract), ${tok('TOTAL_CONTRACT_VALUE_SGD', scTotal)} SGD shall be recognized in Account 1800 (Future Contract Receivables — IFRS 15) matched against Account 2300 (Contract Obligations);`,
      `  (c) Each monthly invoice shall reclassify ${tok('MONTHLY_FEE_SGD', fmtNum(scMo))} SGD to Account 1100 (Current Trade Receivables) + Account 4000 (Operating Revenue), converting to Account 1010 (Current Cash) upon Bank Oracle settlement.`,
    ].join('\n');
  }

  if (spec.execKind === 'grantRole' || spec.execKind === 'appointExec') {
    const rTitle = roleDisplayName(spec.roleId);
    return [
      `========================================================================`,
      `BOARD OF DIRECTORS RESOLUTION IN WRITING — EXECUTIVE APPOINTMENT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Governance Policy: POLICY_BOARD_RESOLUTION`,
      `Active Board Signatories: ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      `========================================================================`,
      ``,
      `WHEREAS the Board of Directors wishes to fill a key executive office under the Charter:`,
      ``,
      `IT IS HEREBY RESOLVED BY THE BOARD OF DIRECTORS THAT:`,
      `  1. ${tok('APPOINTEE_NAME', targetName)} (Identity HFS ${tok('APPOINTEE_ADDR', targetShort)})`,
      `     is hereby appointed as ${tok('EXECUTIVE_TITLE', rTitle)} (${tok('ROLE_KEY', spec.roleName || 'EXEC_ROLE')});`,
      `  2. CorporateCharter.grantRole(${tok('ROLE_KEY', spec.roleName || 'EXEC_ROLE')}, ${tok('APPOINTEE_ADDR', targetShort)}, ${tok('AUTH_HFS_ADDR', authTag)})`,
      `     shall emit RoleGranted and update the live Corporate Organization Chart.`,
    ].join('\n');
  }

  if (spec.execKind === 'revokeRole' || spec.execKind === 'revokeExec') {
    const rTitle = roleDisplayName(spec.roleId);
    return [
      `========================================================================`,
      `BOARD OF DIRECTORS RESOLUTION — REVOCATION OF EXECUTIVE OFFICE`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Active Board: ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED BY THE BOARD OF DIRECTORS THAT:`,
      `  1. The appointment of ${tok('OFFICER_NAME', targetName)} (${tok('OFFICER_ADDR', targetShort)})`,
      `     as ${tok('EXECUTIVE_TITLE', rTitle)} be and is hereby terminated &amp; revoked;`,
      `  2. CorporateCharter.revokeRole(...) shall immediately vacate the seat on the Organization Chart.`,
    ].join('\n');
  }

  if (spec.execKind === 'issueShares' || spec.execKind === 'issueSharesAuction') {
    const amt = Number(spec.issueAmount || 15000);
    const minPx = Number(spec.minIssuePrice || 100);
    const postTotal = fmtNum(state.totalShares + amt);
    if (spec.execKind === 'issueSharesAuction' || state.supportsIssuanceAuction) {
      return [
        `========================================================================`,
        `SHAREHOLDER SPECIAL RESOLUTION — BIDS-GATED CAPITAL RAISE &amp; BOOKBUILDING`,
        `Company: ${tok('COMPANY_NAME', comp)}  |  Share Class: ${tok('SHARE_TICKER', ticker)}`,
        `Policy: POLICY_SHARE_ISSUANCE_AUCTION (Stage 0 Bids ≥1 Mandatory → Stage 1 ≥75% Vote)`,
        `========================================================================`,
        ``,
        `PRE-MONEY SHAREHOLDERS (${tok('PRE_TOTAL_SHARES', totSh)} ${tok('SHARE_TICKER', ticker)}):`,
        `  ${tok('SHAREHOLDER_ROSTER', shRoster)}`,
        ``,
        `IT IS HEREBY RESOLVED THAT:`,
        `  1. STAGE 0 (BIDS STAGE — MANDATORY ≥1 BID GATE): Investor Subscription Bids are`,
        `     solicited up to ${tok('MAX_NEW_SHARES', fmtNum(amt))} new ${tok('SHARE_TICKER', ticker)} shares at a floor of`,
        `     ${tok('MIN_ISSUE_PRICE', fmtNum(minPx) + ' SGD/share')} (cash escrowed in ShareCapital). If 0 active`,
        `     bids exist when Stage 0 expires, the process fails &amp; CorporateCharter rejects (-97);`,
        `  2. STAGE 1 (PRE-EMPTIVE &amp; ≥75% SUPER-MAJORITY): Existing shareholders may exercise`,
        `     Pre-Emptive Subscription Bids and ratify by ≥75% Super-Majority (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes);`,
        `  3. ENACTMENT: Clears at single price P* ≥ ${tok('MIN_ISSUE_PRICE', fmtNum(minPx) + ' SGD')}, pro-rates if`,
        `     oversubscribed (up to ${tok('POST_TOTAL_SHARES', postTotal)} ${tok('SHARE_TICKER', ticker)}), and sweeps proceeds to Treasury.`,
      ].join('\n');
    }
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — CAPITAL RAISE &amp; SHARE ALLOTMENT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Share Class: ${tok('SHARE_TICKER', ticker)}`,
      `Quorum Required: ≥75% Super-Majority (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `PRE-MONEY SHAREHOLDERS (${tok('PRE_TOTAL_SHARES', totSh)} ${tok('SHARE_TICKER', ticker)}):`,
      `  ${tok('SHAREHOLDER_ROSTER', shRoster)}`,
      ``,
      `IT IS HEREBY RESOLVED THAT:`,
      `  1. The Company allot and issue +${tok('ISSUE_AMOUNT', fmtNum(amt))} new ${tok('SHARE_TICKER', ticker)} shares`,
      `     to ${tok('SUBSCRIBER_NAME', targetName)} (Identity HFS ${tok('SUBSCRIBER_ADDR', targetShort)});`,
      `  2. Post-allotment issued share capital shall stand at ${tok('POST_TOTAL_SHARES', postTotal)} ${tok('SHARE_TICKER', ticker)},`,
      `     reactively updating the Company's on-chain Capitalization Table upon AssetIssued.`,
    ].join('\n');
  }

  if (spec.execKind === 'equityFinancing') {
    const clsName =
      spec.classLabel ||
      (spec.assetClassKey === 'COMMON' || spec.eqClassCode === 0
        ? 'Common Shares'
        : spec.customClassName || 'Preferred Shares');
    const convRate = Math.max(1, Number(spec.conversionRate || spec.eqConvRate || 1));
    const minRaise = Number(spec.minRaiseAmount || spec.eqMinRaise || 1000000);
    const maxOwnPct =
      spec.maxOwnershipPct !== undefined
        ? Number(spec.maxOwnershipPct)
        : Number(spec.eqMaxOwnBps || 2000) / 100;
    const derived = computeDerivedEquityFinancingTerms({
      preMoneyCommon: Number(spec.preMoneyCommon || state.totalConvertedCommon || state.totalShares || 100000),
      conversionRate: convRate,
      minRaiseAmount: minRaise,
      maxOwnershipBps: Math.round(maxOwnPct * 100),
    });
    const tShares = Number(spec.targetShares || derived.targetShares);
    const oPrice = Number(spec.offerPrice || derived.offerPrice);
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — 5-STEP NEW SHARE ISSUANCE ROUND`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Charter: ${tok('CHARTER_HFS_ADDR', chrAddr)}`,
      `Offered Security: ${tok('ASSET_CLASS', clsName)}  |  Conversion &amp; Votes/Share: ${tok('CONVERSION_RATE', convRate + 'x Common')}`,
      `========================================================================`,
      ``,
      `1. OFFERING PARAMETERS &amp; DERIVED SHARE COUNT:`,
      `   • Pre-Money Converted Common Capital: ${tok('PRE_MONEY_COMMON', fmtNum(derived.preMoneyCommon) + ' Common Eq.')}`,
      `   • Target Funding to Raise:            ${tok('TARGET_RAISE_SGD', fmtNum(minRaise) + ' SGD')}`,
      `   • Max Post-Money Ownership Offered:   ${tok('MAX_OWNERSHIP_PCT', maxOwnPct.toFixed(2) + '%')}`,
      `   • Exact New Shares to Issue:          ${tok('TARGET_SHARES', fmtNum(tShares) + ' shares')} (= ${tok('CONV_VOTES', fmtNum(tShares * convRate))} Common Eq. / Votes)`,
      `   • Derived Minimum Offer Price:        ${tok('OFFER_PRICE_SGD', fmtNum(oPrice) + ' SGD/share')}`,
      ``,
      `2. FIVE-STEP CONSTITUTIONAL ISSUANCE LIFECYCLE:`,
      `   • STEP 1 — SHAREHOLDER RESOLUTION (≥75% SUPER-MAJORITY): Existing shareholders (${tok('SHAREHOLDER_ROSTER', shRoster)})`,
      `     approve this offering (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes) to open the timed Bidding &amp; ROFR windows.`,
      `   • STEP 2 — PROSPECTIVE INVESTOR BIDDING: Investors place escrowed bids ≥ ${tok('OFFER_PRICE_SGD', fmtNum(oPrice) + ' SGD')}.`,
      `     If 0 bids are placed before Step 2 closes, the round FAILS (-97).`,
      `   • STEP 3 — EXISTING SHAREHOLDERS' RIGHT OF FIRST REFUSAL (ROFR): Existing shareholders may`,
      `     exercise pre-emptive ROFR subscriptions matching the round clearing price.`,
      `   • STEP 4 — ROFR-PRIORITY &amp; PRO-RATA ALLOCATION: ROFR orders are prioritized 100% first;`,
      `     remaining shares up to ${tok('TARGET_SHARES', fmtNum(tShares))} go to Step 2 Bidders (pro-rated if oversubscribed).`,
      `   • STEP 5 — SHAREHOLDERS' AGREEMENT (SHA) &amp; CAP-TABLE MINT: New shareholders sign the Company's`,
      `     Shareholders' Agreement on ShareCapital to receive ${tok('ASSET_CLASS', clsName)} in their name automatically.`,
    ].join('\n');
  }

  if (spec.execKind === 'shareBuyback') {
    const sh = Number(spec.buybackShares || 5000);
    const px = Number(spec.buybackPrice || 110);
    const clsSym = spec.classSymbol || ticker;
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — SHARE BUYBACK &amp; CAPITAL CANCELLATION`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Target Class: ${tok('SHARE_CLASS', clsSym)}`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED AS A SPECIAL RESOLUTION THAT:`,
      `  1. Pursuant to ShareCapital.executeShareBuyback, the Company repurchase and cancel`,
      `     -${tok('BUYBACK_SHARES', fmtNum(sh))} ${tok('SHARE_CLASS', clsSym)} shares held by ${tok('SELLER_NAME', targetName)} (${tok('SELLER_ADDR', targetShort)})`,
      `     at ${tok('BUYBACK_PRICE', fmtNum(px) + ' SGD/share')} (Total consideration: ${tok('BUYBACK_TOTAL_SGD', fmtNum(sh * px) + ' SGD')});`,
      `  2. Said repurchased shares shall be retired immediately on AssetLedger, increasing`,
      `     continuing shareholders' pro-rata ownership on the Capitalization Table.`,
    ].join('\n');
  }

  if (spec.execKind === 'shareSplit') {
    const mult = Math.max(2, Number(spec.splitRatio || 2));
    const clsSym = spec.classSymbol || ticker;
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — ${tok('SPLIT_RATIO', mult + '-FOR-1')} FORWARD SHARE SPLIT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Target Class: ${tok('SHARE_CLASS', clsSym)}`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED AS A SPECIAL RESOLUTION THAT:`,
      `  1. Every 1 issued ${tok('SHARE_CLASS', clsSym)} share be subdivided into ${tok('SPLIT_MULTIPLIER', mult)} shares`,
      `     (${tok('SPLIT_RATIO', mult + '-for-1')} forward split) across all registered holders on AssetLedger;`,
      `  2. Proportional voting and ownership percentages remain invariant across all holders.`,
    ].join('\n');
  }

  if (spec.execKind === 'reverseShareSplit') {
    const div = Math.max(2, Number(spec.splitRatio || 2));
    const clsSym = spec.classSymbol || ticker;
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — 1-FOR-${tok('REVERSE_DIVISOR', div)} REVERSE SHARE SPLIT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Target Class: ${tok('SHARE_CLASS', clsSym)}`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED AS A SPECIAL RESOLUTION THAT:`,
      `  1. Every ${tok('REVERSE_DIVISOR', div)} issued ${tok('SHARE_CLASS', clsSym)} shares be consolidated into 1 share`,
      `     (1-for-${tok('REVERSE_DIVISOR', div)} reverse share split) across all registered holders on AssetLedger;`,
      `  2. Issued share capital and Capitalization Table balances shall update atomically.`,
    ].join('\n');
  }

  if (spec.execKind === 'createEsopProgram') {
    const authSh = Number(spec.esopAuthShares || 15000);
    const exPx = Number(spec.esopStrikePrice ?? 25);
    const conv = Number(spec.esopConvRate || 1);
    const optSym = spec.optionSymbol || `${ticker.replace(/-EQ$/, '')}-OPT`;
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — MASTER EMPLOYEE SHARE OPTION PROGRAMME`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Option Ledger: ${tok('OPTION_LEDGER_SYM', optSym)} (${shortAddr(spec.optionLedger || '')})`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED AS A SPECIAL RESOLUTION THAT:`,
      `  1. A Master ESOP Programme is established authorizing up to ${tok('AUTHORIZED_OPTIONS', fmtNum(authSh))} options`,
      `     convertible into ${tok('UNDERLYING_CLASS', spec.underlyingSymbol || ticker)} (${tok('CONV_RATE', conv + 'x Common/Votes')})`,
      `     at an Exercise Price of ${tok('STRIKE_PRICE', fmtNum(exPx) + ' SGD/share')};`,
      `  2. Dedicated Option AssetLedger ${tok('OPTION_LEDGER_ADDR', shortAddr(spec.optionLedger || ''))} shall track all periodic`,
      `     vesting issuances and option exercises under this Master ESOP Agreement.`,
    ].join('\n');
  }

  if (spec.execKind === 'awardEmployeeOptions') {
    return [
      `========================================================================`,
      `BOARD OF DIRECTORS RESOLUTION — EMPLOYEE OPTION AWARD &amp; VESTING SCHEDULE`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Policy: POLICY_BOARD_RESOLUTION`,
      `Active Board Signatories: ${tok('DIRECTOR_ROSTER', dirRoster)}`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED BY THE BOARD OF DIRECTORS THAT:`,
      `  1. Under Master ESOP Programme #${tok('PROGRAM_ID', spec.esopProgramId ?? 0)}, ${tok('EMPLOYEE_NAME', targetName)}`,
      `     (${tok('EMPLOYEE_ADDR', targetShort)}) is awarded ${tok('TOTAL_OPTIONS', fmtNum(spec.esopTotalAward || 0))} options`,
      `     subject to an exercise cliff at Block #${tok('CLIFF_BLOCK', fmtNum(spec.esopCliffBlock || 0))};`,
      `  2. ShareCapital.processDueEsopIssuances() shall periodically mint vested option tranches`,
      `     onto the Master ESOP Option AssetLedger as each scheduled tranche falls due.`,
    ].join('\n');
  }

  if (spec.execKind === 'setTreasury') {
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — DESIGNATE COMPANY TREASURY ACCOUNT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  Charter: ${tok('CHARTER_HFS_ADDR', chrAddr)}`,
      `Quorum Required: ≥75% Voting Capital (${tok('SUPER_MAJORITY_VOTES', supVotes)} votes)`,
      `========================================================================`,
      ``,
      `IT IS HEREBY RESOLVED AS A SPECIAL RESOLUTION THAT:`,
      `  1. Pursuant to CorporateCharter.setTreasuryAccount, the Company's official Treasury`,
      `     Identity Account is designated as ${tok('TREASURY_NAME', targetName)} (${tok('TREASURY_ADDR', targetShort)});`,
      `  2. All primary share issuance proceeds, ESOP option exercise payments, and voluntary`,
      `     share buyback disbursements on ShareCapital shall route through said Treasury Account.`,
    ].join('\n');
  }

  if (spec.execKind === 'authorizeFutures') {
    const pct = Number(spec.futuresPct || 20);
    const cap = fmtNum(Math.floor(((state.totalConvertedCommon || state.totalShares) * pct) / 100));
    return [
      `========================================================================`,
      `SHAREHOLDER SPECIAL RESOLUTION — SHARE-BACKED FUTURES &amp; DEX ATTACHMENT`,
      `Company: ${tok('COMPANY_NAME', comp)}  |  ShareCapital HFS: ${tok('SHARE_CAPITAL_ADDR', shortAddr(session.inst?.shareCapital || ''))}`,
      `========================================================================`,
      ``,
      `ELIGIBLE UNDERWRITING SHAREHOLDERS: ${tok('SHAREHOLDER_ROSTER', shRoster)}`,
      ``,
      `IT IS HEREBY RESOLVED THAT:`,
      `  1. Shareholders are authorized to underwrite futures contracts up to ${tok('UNDERWRITE_PCT', pct + '%')}`,
      `     of converted common shares (Company Cap = ${tok('MAX_FUTURES_CAP', cap)} units);`,
      `  2. An MEV-proof Discrete-Time FIFO Central Limit Orderbook (DexClob) may be attached`,
      `     to the Futures AssetLedger for live secondary trading.`,
    ].join('\n');
  }

  return `CORPORATE RESOLUTION — ${escapeHtml(spec.title || comp)}`;
}

function computeDerivedEquityFinancingTerms({
  preMoneyCommon,
  conversionRate,
  minRaiseAmount,
  maxOwnershipBps,
}) {
  const pre = Math.max(1, Math.floor(Number(preMoneyCommon) || 100000));
  const conv = Math.max(1, Math.floor(Number(conversionRate) || 1));
  const minRaise = Math.max(1, Math.floor(Number(minRaiseAmount) || 1000));
  const bps = Math.max(1, Math.min(9900, Math.floor(Number(maxOwnershipBps) || 2000)));
  const numer = BigInt(pre) * BigInt(bps);
  const denom = BigInt(10000 - bps) * BigInt(conv);
  const targetShares = Math.max(1, Number(numer / denom));
  const offerPrice = Math.max(1, Math.ceil(minRaise / targetShares));
  const newCommonEq = targetShares * conv;
  const postCommonEq = pre + newCommonEq;
  const actualOwnPct = ((newCommonEq / postCommonEq) * 100).toFixed(2);
  return {
    preMoneyCommon: pre,
    conversionRate: conv,
    minRaiseAmount: minRaise,
    maxOwnershipBps: bps,
    targetShares,
    offerPrice,
    newCommonEq,
    postCommonEq,
    actualOwnPct,
  };
}

function buildShareSubscriptionAgreementHtml(r, ssaHashHex = '') {
  const clsLabel =
    r.eqClassCode === 1 ? 'Preferred Series A' : r.eqClassCode === 2 ? 'Preferred Series B' : 'Common Shares';
  return [
    `========================================================================`,
    `SHARE SUBSCRIPTION AGREEMENT (SSA) — INVESTOR BINDING COMMITMENT`,
    `Issuer: ${escapeHtml(companyNameStr())} (Charter ${shortAddr(session.inst?.corporateCharter)})`,
    `Authorization HFS: ${shortAddr(r.authAddr)}  |  SSA Hash: ${escapeHtml(ssaHashHex || r.ssaHash || 'on-chain')}`,
    `========================================================================`,
    ``,
    `1. OFFERED SECURITY: ${clsLabel} (${r.eqConvRate || 1}x Common Conversion &amp; ${r.eqConvRate || 1} Vote(s)/Share)`,
    `2. TOTAL SHARES OFFERED: ${fmtNum(r.targetShares || r.maxNewShares)} shares (Minimum Offer Price: ${fmtNum(r.offerPrice || r.minIssuePrice)} SGD/sh)`,
    `3. SUBSCRIPTION ESCROW: Subscriber's cash consideration is locked atomically in ShareCapital.`,
    `4. MINIMUM SUBSCRIPTION CONDITION (-97): If aggregate valid subscriptions at or above`,
    `   ${fmtNum(r.offerPrice || r.minIssuePrice)} SGD/sh are less than ${fmtNum(r.targetShares || r.maxNewShares)} shares when Step 1 expires,`,
    `   this financing automatically terminates and escrowed funds are 100% refundable.`,
    `5. OVERSUBSCRIPTION PRO-RATA: If bids strictly above ${fmtNum(r.offerPrice || r.minIssuePrice)} SGD/sh exceed`,
    `   ${fmtNum(r.targetShares || r.maxNewShares)} shares, clearing occurs at the lowest bid price among those`,
    `   above-offer bids and pro-rates exact ${fmtNum(r.targetShares || r.maxNewShares)} shares.`,
  ].join('\n');
}

function buildShareholdersAgreementHtml(shaHashHex = '') {
  return [
    `========================================================================`,
    `SHAREHOLDERS' AGREEMENT (SHA) — GOVERNANCE, ROFR &amp; CAP-TABLE ADHERENCE`,
    `Company: ${escapeHtml(companyNameStr())}  |  Charter HFS: ${shortAddr(session.inst?.corporateCharter)}`,
    `Canonical SHA Hash: ${escapeHtml(shaHashHex || 'compute_sha_doc_hash(charter)')}`,
    `========================================================================`,
    ``,
    `BY EXECUTING THIS SHAREHOLDERS' AGREEMENT ON-CHAIN, THE SIGNATORY AGREES:`,
    `  1. Pre-Emptive Rights &amp; 3-Step Restricted ROFR Call-Auction Bylaws apply to all share transfers;`,
    `  2. Multi-class voting power and conversion ratios registered in CorporateCharter govern`,
    `     all ≥75% Special Resolutions (Equity Financings, Splits, Buybacks, Master ESOPs);`,
    `  3. First-time shareholders (including Investors and Option-Exercising Employees) are`,
    `     bound by this Shareholders' Agreement upon share allotment onto the Capitalization Table.`,
  ].join('\n');
}

function buildEsopExerciseLetterHtml(prog, grant, amount, letterHashHex = '') {
  return [
    `========================================================================`,
    `EMPLOYEE SHARE OPTION EXERCISE NOTICE &amp; SUBSCRIPTION LETTER`,
    `Company: ${escapeHtml(companyNameStr())}  |  Master ESOP #${prog.programId} (Grant #${grant.grantId})`,
    `Exercise Letter Hash: ${escapeHtml(letterHashHex || 'on-chain')}`,
    `========================================================================`,
    ``,
    `  • Employee Identity:     ${escapeHtml(session.labelForIdentity(grant.employee))} (${shortAddr(grant.employee)})`,
    `  • Options Exercised:     ${fmtNum(amount)} options (burned on ${escapeHtml(prog.optionSymbol)} ${shortAddr(prog.optionLedger)})`,
    `  • Underlying Shares:     +${fmtNum(amount)} ${escapeHtml(prog.underlyingSymbol)} (${prog.conversionRate}x Common/Votes)`,
    `  • Strike Payment:        ${fmtNum(amount)} × ${fmtNum(prog.exercisePrice)} SGD = ${fmtNum(amount * prog.exercisePrice)} SGD`,
    `  • Cliff Verification:    Current Block #${fmtNum(session.blockNumber)} ≥ Cliff Block #${fmtNum(grant.cliffBlock)} ✓`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Core World Polling: Charter, Org Chart, Cap Table, Resolutions, Auction, Futures
// ---------------------------------------------------------------------------

async function fetchRoleMembers(chrAddr, roleId) {
  try {
    const cnt = decodeUintWord(
      await session.ethCall(chrAddr, encodeAbi('roleMemberCount(bytes32)', [['bytes32', roleId]]))
    );
    if (cnt === 0) return [];
    const addrs = await Promise.all(
      Array.from({ length: Math.min(cnt, 24) }, (_, idx) =>
        session
          .ethCall(chrAddr, encodeAbi('roleMemberAt(bytes32,uint64)', [['bytes32', roleId], ['uint64', idx]]))
          .then(decodeAddrWord)
          .catch(() => ZERO_ADDR)
      )
    );
    return addrs.filter((a) => a && a !== ZERO_ADDR);
  } catch (_) {
    return [];
  }
}

function decodeAbiStringHex(hex, fallback = '') {
  if (!hex || hex === '0x') return fallback;
  const b = hexToBytes(hex);
  if (b.length >= 64) {
    const len = readU64BE(b, 56);
    if (len > 0 && 64 + len <= b.length) {
      return bytesToUtf8(b.slice(64, 64 + len)) || fallback;
    }
  }
  return fallback;
}

function decodeAbiBytesHex(hex) {
  if (!hex || hex === '0x') return new Uint8Array(0);
  const b = hexToBytes(hex);
  if (b.length >= 64) {
    const len = readU64BE(b, 56);
    if (64 + len <= b.length) {
      return b.slice(64, 64 + len);
    }
  }
  return b;
}

async function fetchRegisteredShareClasses(chr, shareLed) {
  const defaultTicker = shareTickerStr();
  try {
    const cnt = decodeUintWord(await session.ethCall(chr, encodeAbi('shareClassCount()')).catch(() => '0x0'));
    if (cnt > 0) {
      const cacheKey = `shareClasses:${chr}:${cnt}`;
      const metaList = await session.callCache.getOrComputeImmutable(
        cacheKey,
        async () => {
          const specs = await Promise.all(
            Array.from({ length: Math.min(cnt, 8) }, (_, idx) =>
              session
                .ethCall(chr, encodeAbi('getShareClass(uint64)', [['uint64', idx]]))
                .then((hex) => {
                  const b = hexToBytes(hex);
                  if (b.length < 128) return null;
                  const ledger = bytesToHex(b.slice(12, 32)).toLowerCase();
                  const votesPerShare = readU64BE(b, 56) || 1;
                  const convNumer = readU64BE(b, 88) || 1;
                  const convDenom = Math.max(1, readU64BE(b, 120) || 1);
                  return { ledger, votesPerShare, convNumer, convDenom };
                })
                .catch(() => null)
            )
          );
          const valid = specs.filter((s) => s && s.ledger && s.ledger !== ZERO_ADDR);
          if (!valid.length) return [];
          return Promise.all(
            valid.map(async (s, i) => {
              const [symHex, lblHex] = await Promise.all([
                session.callCache.callAbiImmutable(s.ledger, 'symbol()').catch(() => '0x'),
                session
                  .ethCall(chr, encodeAbi('shareClassLabel(address)', [['address', s.ledger]]))
                  .catch(() => '0x'),
              ]);
              const rawSym = decodeAbiStringHex(symHex, i === 0 ? defaultTicker : `PREF-${i}`);
              const customLabel = decodeBytes32LabelHex(lblHex, '');
              const symbol = customLabel && i > 0 ? customLabel : rawSym;
              const tickerOnly = rawSym;
              const convMult = Number(((BigInt(s.convNumer) * 100n) / BigInt(s.convDenom))) / 100;
              return { ...s, symbol, tickerOnly, classLabel: customLabel || symbol, convMult };
            })
          );
        },
        (list) => Array.isArray(list) && list.length > 0
      );

      if (metaList && metaList.length > 0) {
        const supplies = await Promise.all(
          metaList.map((m) =>
            session
              .ethCall(m.ledger, encodeAbi('totalOutstanding()'))
              .then(decodeUintWord)
              .catch(() => 0)
          )
        );
        return metaList.map((m, i) => ({ ...m, supply: supplies[i] || 0 }));
      }
    }
  } catch (_) {}

  const supHex = await session.ethCall(shareLed, encodeAbi('totalOutstanding()')).catch(() => '0x0');
  return [
    {
      ledger: shareLed.toLowerCase(),
      symbol: defaultTicker,
      votesPerShare: 1,
      convNumer: 1,
      convDenom: 1,
      convMult: 1,
      supply: decodeUintWord(supHex),
    },
  ];
}

function fetchLedgerRegisteredHolders(ledgerAddr) {
  return fetchRegisteredHolders(session.rpcUrl, ledgerAddr, {
    limit: 32,
    callFn: (to, data) => session.ethCall(to, data),
  });
}

async function _runRefreshCharterWorldInner(meta = null) {
  if (!session.online || !session.inst?.corporateCharter) {
    if (state.phase1Loaded) {
      renderEverything();
    } else {
      setBootProgress(
        14,
        'Connecting to Subnet 1 WebSocket validator…',
        'Waiting for live node handshake'
      );
    }
    return;
  }

  const chr = session.inst.corporateCharter.toLowerCase();
  const shareLed = session.inst.shareLedger;
  const bankLed = session.inst.fiatLedger;

  // Reset per-charter transient trackers when switching companies
  if (state.prevCharterAddr !== chr) {
    const isSwitch = Boolean(state.prevCharterAddr);
    state.prevCharterAddr = chr;
    state.prevCharterState = 0;
    state.phase1Loaded = false;
    state.initialLoadComplete = false;
    state.myVerifiedIdentity = '';
    state.myIsDirector = false;
    state.myNeedsDirectorConsent = false;
    state.myIsShareholder = false;
    state.myIsOfficer = false;
    state.myHasEsopGrant = false;
    state.myCanGovern = false;
    state.myIsAssociated = false;
    session.callCache.clearEphemeral();
    state.prevSharesByAddr.clear();
    state.capDeltas.clear();
    state.orgFlashes.clear();
    state.eventLogs = [];
    state.seenLogUids.clear();
    state.lastLogScanBlock = 0;
    state.activeAuctionAddr = loadSavedAuctionAddr(chr);
    state.activeIssuanceAddr = loadSavedIssuanceAddr(chr);
    state.issuanceRound = null;
    state.guidedPlan = null;
    if (isSwitch) {
      setBootProgress(
        28,
        `Switching to ${companyNameStr()} (${shortAddr(chr)})…`,
        'Loading Organization Chart, Multi-Class Cap Table & Legal Register'
      );
    }
    charterWatcher?.refreshFilter?.();
    charterAuctionSub?.refreshFilter?.();
  }

  try {
    const [blkHex, stHex, actBlkHex, dirCntHex, shaHashHex, classes] = await Promise.all([
      meta && meta.blockNumber > 0 ? Promise.resolve(null) : session.rpcCall('eth_blockNumber'),
      session.ethCall(chr, encodeAbi('state()')),
      session.ethCall(chr, encodeAbi('activatedAtBlock()')).catch(() => '0x0'),
      session.ethCall(chr, encodeAbi('directorCount()')),
      session.ethCall(chr, encodeAbi('shaDocumentHash()')).catch(() => '0x'),
      fetchRegisteredShareClasses(chr, shareLed),
    ]);

    session.blockNumber =
      meta && meta.blockNumber > 0 ? meta.blockNumber : Number(BigInt(blkHex));
    session.setNetStatus(`Subnet 1 Live • Block #${fmtNum(session.blockNumber)}`, true);

    state.supportsV4Governance = Boolean(shaHashHex && shaHashHex.length >= 66 && !/^0x0+$/.test(shaHashHex));
    state.shareClasses = classes;

    const nextState = decodeUintWord(stHex);
    if (state.prevCharterState === 1 && nextState === 2) {
      triggerSparkBurst(['#10b981', '#fbbf24', '#38bdf8', '#a78bfa']);
    }
    state.prevCharterState = nextState;
    state.charterState = nextState;
    state.activatedBlock = decodeUintWord(actBlkHex);
    state.directorCount = decodeUintWord(dirCntHex);

    const commonCls = classes[0];
    state.totalShares = commonCls ? commonCls.supply : 0;
    state.totalConvertedCommon = classes.reduce(
      (acc, c) => acc + Math.floor((c.supply * c.convNumer) / Math.max(1, c.convDenom)),
      0
    );
    state.totalVotingPower = classes.reduce(
      (acc, c) => acc + Math.floor((c.supply * c.convNumer * c.votesPerShare) / Math.max(1, c.convDenom)),
      0
    );
    state.requiredSuperVotes = Math.max(1, Math.ceil((state.totalVotingPower * 75) / 100));

    // 1. Fetch Live Directors & C-Suite Role Members on-chain + Registered Holders + Verified User Identity
    const [verifiedMyLow, dirMembers, shMembers, classHolderLists, ...execMemberLists] = await Promise.all([
      session.verifyMyIdentityBinding(),
      fetchRoleMembers(chr, GOV_CONSTANTS.ROLE_DIRECTOR),
      fetchRoleMembers(chr, GOV_CONSTANTS.ROLE_SHAREHOLDER),
      Promise.all(classes.map((c) => fetchLedgerRegisteredHolders(c.ledger))),
      ...EXEC_SEAT_SPECS.map((s) => fetchRoleMembers(chr, s.roleId)),
    ]);

    let activeDirAddrs = dirMembers;
    if (activeDirAddrs.length === 0 && isBaseLegacyCharter()) {
      const legacyActors = (session.inst.actors || []).filter((a) =>
        ['founder', 'director2', 'candDir3'].includes(a.key)
      );
      const checks = await Promise.all(
        legacyActors.map((a) =>
          session
            .ethCall(chr, encodeAbi('isDirector(address)', [['address', a.identityAddr]]))
            .then((h) => (decodeUintWord(h) === 1 ? a.identityAddr.toLowerCase() : ''))
        )
      );
      activeDirAddrs = checks.filter(Boolean);
    }

    const myLow = verifiedMyLow || '';
    state.myVerifiedIdentity = myLow;

    const [dirConsentFlags, pendingDirCnt] = await Promise.all([
      Promise.all(
        activeDirAddrs.map((addr) =>
          session
            .ethCall(chr, encodeAbi('hasDirectorConsented(address)', [['address', addr]]))
            .then((h) => decodeUintWord(h) === 1)
            .catch(() => true)
        )
      ),
      session
        .ethCall(chr, encodeAbi('pendingDirectorCount()'))
        .then(decodeUintWord)
        .catch(() => 0),
    ]);

    let pendingDirAddrs = [];
    if (pendingDirCnt > 0) {
      const pAddrs = await Promise.all(
        Array.from({ length: Math.min(pendingDirCnt, 16) }, (_, idx) =>
          session
            .ethCall(chr, encodeAbi('pendingDirectorAt(uint64)', [['uint64', idx]]))
            .then(decodeAddrWord)
            .catch(() => ZERO_ADDR)
        )
      );
      pendingDirAddrs = pAddrs.filter((a) => a && a !== ZERO_ADDR);
    }

    state.directors = activeDirAddrs.map((addr, idx) => ({
      addr,
      label: session.labelForIdentity(addr),
      isMe: addr === myLow,
      isAi: (session.aiPersonas || []).some((p) => p.identityAddr === addr),
      avatar: avatarForAddr(addr),
      consented: Boolean(dirConsentFlags[idx]),
    }));

    state.pendingDirectors = pendingDirAddrs.map((addr) => ({
      addr,
      label: session.labelForIdentity(addr),
      isMe: addr === myLow,
      isAi: (session.aiPersonas || []).some((p) => p.identityAddr === addr),
      avatar: avatarForAddr(addr),
    }));

    const myActiveDirObj = state.directors.find((d) => d.addr === myLow);
    state.myIsDirector = Boolean(myActiveDirObj && (state.charterState === 2 || myActiveDirObj.consented));
    state.myNeedsDirectorConsent = Boolean(
      myLow &&
        ((state.charterState === 1 && myActiveDirObj && !myActiveDirObj.consented) ||
          state.pendingDirectors.some((p) => p.addr === myLow))
    );

    state.execSeats = EXEC_SEAT_SPECS.map((spec, idx) => ({
      ...spec,
      holders: (execMemberLists[idx] || []).map((addr) => ({
        addr,
        label: session.labelForIdentity(addr),
        avatar: avatarForAddr(addr),
      })),
    }));
    state.myIsOfficer = Boolean(
      myLow && state.execSeats.some((s) => s.holders.some((h) => h.addr === myLow))
    );

    // 2. Build Multi-Class Cap Table Stakeholder Set (pruned to actual role/share holders + wallet)
    const candidateSet = new Set([
      ...activeDirAddrs,
      ...pendingDirAddrs,
      ...execMemberLists.flat(),
      ...shMembers,
      ...classHolderLists.flat(),
      ...state.esopGrants.map((g) => g.employee),
      ...(myLow ? [myLow] : []),
    ]);
    if (isBaseLegacyCharter()) {
      for (const a of session.inst.actors || []) {
        if (a.identityAddr && ['founder', 'director2', 'faucet', 'merchantRev', 'candDir3', 'candCfo'].includes(a.key)) {
          candidateSet.add(a.identityAddr.toLowerCase());
        }
      }
    }
    for (const ev of state.eventLogs) {
      if (ev.subjectAddr && ev.subjectAddr !== ZERO_ADDR) candidateSet.add(ev.subjectAddr.toLowerCase());
    }

    const candidateAddrs = Array.from(candidateSet).filter((a) => a && a !== ZERO_ADDR);
    const [perClassBals, cashBals] = await Promise.all([
      Promise.all(
        classes.map((cls) =>
          Promise.all(candidateAddrs.map((a) => session.getLedgerBalance(cls.ledger, a).catch(() => 0)))
        )
      ),
      Promise.all(candidateAddrs.map((a) => session.getLedgerBalance(bankLed, a).catch(() => 0))),
    ]);

    const rows = [];
    candidateAddrs.forEach((addr, idx) => {
      const holdings = [];
      let convCommon = 0;
      let votes = 0;
      classes.forEach((cls, cIdx) => {
        const rawShares = perClassBals[cIdx]?.[idx] || 0;
        if (rawShares > 0) {
          const cc = Math.floor((rawShares * cls.convNumer) / Math.max(1, cls.convDenom));
          const vp = Math.floor((rawShares * cls.convNumer * cls.votesPerShare) / Math.max(1, cls.convDenom));
          convCommon += cc;
          votes += vp;
          holdings.push({
            ledger: cls.ledger,
            symbol: cls.symbol,
            rawShares,
            convCommon: cc,
            votes: vp,
            convMult: cls.convMult,
          });
        }
      });

      const commonOnlyShares = perClassBals[0]?.[idx] || 0;
      const cash = cashBals[idx] || 0;
      const prev = state.prevSharesByAddr.get(addr);
      if (prev !== undefined && prev !== convCommon) {
        state.capDeltas.set(addr, { delta: convCommon - prev, expiresAt: Date.now() + 6500 });
      }
      state.prevSharesByAddr.set(addr, convCommon);

      const roles = [];
      const dirEntry = state.directors.find((d) => d.addr === addr);
      if (dirEntry) {
        roles.push(state.charterState === 1 && !dirEntry.consented ? 'Director (Pending Consent)' : 'Director');
      } else if (state.pendingDirectors.some((p) => p.addr === addr)) {
        roles.push('Director (Pending Consent)');
      }
      for (const seat of state.execSeats) {
        if (seat.holders.some((h) => h.addr === addr)) roles.push(seat.short);
      }

      if (convCommon > 0 || roles.length > 0) {
        const pct =
          state.totalConvertedCommon > 0
            ? ((convCommon / state.totalConvertedCommon) * 100).toFixed(1)
            : '0.0';
        rows.push({
          addr,
          label: session.labelForIdentity(addr),
          shares: convCommon, // converted common equivalent for voting & donut
          commonOnlyShares,
          convCommon,
          votes,
          holdings,
          cash,
          pct,
          roles,
          isMe: addr === myLow,
          isAi: (session.aiPersonas || []).some((p) => p.identityAddr === addr),
          avatar: avatarForAddr(addr),
        });
      }
    });

    rows.sort((a, b) => b.convCommon - a.convCommon || b.roles.length - a.roles.length);
    state.capRows = rows;

    const myIdx = myLow ? candidateAddrs.indexOf(myLow) : -1;
    const [treasHex, vpHex, myShaHex, permHex] = await Promise.all([
      session.ethCall(chr, encodeAbi('treasuryAccount()')).catch(() => ZERO_ADDR),
      myLow
        ? session.ethCall(chr, encodeAbi('shareholderVotingPower(address)', [['address', myLow]])).catch(() => '0x')
        : Promise.resolve('0x'),
      myLow && state.supportsV4Governance
        ? session
            .ethCall(chr, encodeAbi('hasSignedShareholdersAgreement(address)', [['address', myLow]]))
            .catch(() => '0x0')
        : Promise.resolve('0x0'),
      session
        .ethCall(shareLed, encodeAbi('getPermission(bytes32)', [['bytes32', GOV_CONSTANTS.ACTION_ISSUE]]))
        .catch(() => '0x'),
    ]);

    try {
      const tAddr = decodeAddrWord(treasHex);
      if (tAddr && tAddr !== ZERO_ADDR) {
        state.treasuryAccount = tAddr;
      } else if (session.inst?.shareCapital) {
        const scTrHex = await session
          .ethCall(session.inst.shareCapital, encodeAbi('treasuryRecipient()'))
          .catch(() => ZERO_ADDR);
        state.treasuryAccount = decodeAddrWord(scTrHex);
      } else {
        state.treasuryAccount = ZERO_ADDR;
      }
    } catch (_) {
      state.treasuryAccount = ZERO_ADDR;
    }

    if (myLow) {
      const vp = decodeVotingPowerHex(vpHex);
      const myCapRow = state.capRows.find((r) => r.addr === myLow);
      const classConv = myCapRow ? myCapRow.convCommon : 0;
      const classVotes = myCapRow ? myCapRow.votes : 0;
      state.myVotes = Math.max(vp.voterPower, classVotes);
      state.myConvertedCommon = Math.max(vp.voterCommon, classConv);
      state.myShares = myIdx >= 0 ? perClassBals[0]?.[myIdx] || 0 : 0;
      state.myCash = myIdx >= 0 ? cashBals[myIdx] || 0 : 0;
      state.myHasSignedSha = decodeUintWord(myShaHex) === 1;
      if (vp.requiredSuperPower > 0) state.requiredSuperVotes = vp.requiredSuperPower;
      if (vp.totalPower > 0) state.totalVotingPower = vp.totalPower;
    } else {
      state.myVotes = 0;
      state.myConvertedCommon = 0;
      state.myShares = 0;
      state.myCash = 0;
      state.myHasSignedSha = false;
    }
    state.myIsShareholder = Boolean(
      myLow && (state.myShares > 0 || state.myConvertedCommon > 0 || state.myVotes > 0)
    );
    state.myCanGovern = Boolean(state.myIsDirector || state.myIsShareholder);
    state.myIsAssociated = Boolean(
      state.myCanGovern || state.myNeedsDirectorConsent || state.myIsOfficer || state.myHasEsopGrant
    );
    if (!state.initialLoadComplete && !state.myIsAssociated) {
      state.capToolExpanded = false;
    } else if (!state.initialLoadComplete && state.myIsAssociated) {
      state.capToolExpanded = true;
    }

    // Check whether ShareLedger binds ACTION_ISSUE to POLICY_SHARE_ISSUANCE_AUCTION
    try {
      const cleanPerm = (permHex || '').replace(/^0x/, '').toLowerCase();
      const issuePolHex = cleanPerm.length >= 192 ? '0x' + cleanPerm.slice(128, 192) : '';
      state.supportsIssuanceAuction =
        Boolean(session.inst?.shareCapital) &&
        issuePolHex === GOV_CONSTANTS.POLICY_SHARE_ISSUANCE_AUCTION.toLowerCase();
    } catch (_) {
      state.supportsIssuanceAuction = false;
    }

    // Phase-1 Progressive Fast Paint: Render Header, Vital Signs, Org Chart & Cap Table immediately!
    state.phase1Loaded = true;
    if (!state.initialLoadComplete) {
      setBootProgress(
        72,
        '2/3 Organization Chart & Cap Table Ready — Syncing Legal Register, ESOP & Auctions…',
        `Loaded ${state.directors.length} Director(s) & ${state.capRows.length} Stakeholder(s) • Hydrating corporate resolutions`
      );
      syncCapActionPanels();
      renderHeroAndKpis();
      renderMyCompanyRoleBar();
      renderOrgChart();
      renderCapTable();
      renderShareClassesDetails();
      populateCapSplitsAndBuybacks();
      renderActionStudioState();
      renderRelatedMatters();
    }

    // 3, 4 & 5. Query First Resolution, Saved/Sample Resolutions, ESOP, Futures & Auction Arena IN PARALLEL
    const firstAuth = (session.inst.firstResolutionAuth || '').toLowerCase();
    const rawList = [
      ...loadSavedResolutions(chr),
      ...(isBaseLegacyCharter() ? session.inst.sampleResolutions || [] : []),
    ];
    const dedupMap = new Map();
    for (const r of rawList) {
      if (r?.authAddr) {
        const lowA = r.authAddr.toLowerCase();
        if (lowA !== firstAuth) dedupMap.set(lowA, r);
      }
    }

    const [firstResObj, otherEnrichedList] = await Promise.all([
      firstAuth && firstAuth !== ZERO_ADDR
        ? queryEnrichedResolution(
            {
              id: 'res_0001_ratify',
              authAddr: firstAuth,
              title: `Resolution #0001: Ratify & Activate ${companyNameStr()}`,
              summary: `Constitutional First Shareholder Resolution transitioning CorporateCharter from PENDING_RATIFICATION to ACTIVE.`,
              category: 'First Shareholder Resolution',
              policyId: GOV_CONSTANTS.POLICY_FIRST_SHAREHOLDER_RESOLUTION,
              targetHps: chr,
              execKind: 'activateCharter',
              targetAddr: chr,
            },
            state.charterState === 1
          )
        : Promise.resolve(null),
      Promise.all(
        Array.from(dedupMap.values()).map((r) =>
          queryEnrichedResolution(
            {
              ...r,
              targetAddr: r.targetAddr || r.execSubjectAddr || chr,
            },
            false
          )
        )
      ),
      refreshEsopState(),
      refreshFuturesAndDexState(),
      refreshAuctionArenaState(),
      refreshAuditGovState(),
      refreshCompanySocialState(),
    ]);

    state.firstRes = firstResObj;
    state.resolutions =
      firstResObj && state.charterState === 2
        ? [...otherEnrichedList, firstResObj]
        : otherEnrichedList;
    state.myHasEsopGrant = Boolean(
      myLow && state.esopGrants.some((g) => g.employee === myLow)
    );
    state.myIsAssociated = Boolean(
      state.myCanGovern || state.myNeedsDirectorConsent || state.myIsOfficer || state.myHasEsopGrant
    );

    await refreshIssuanceArenaState();
    charterWatcher?.refreshFilter?.();

    const wasInitial = !state.initialLoadComplete;
    state.initialLoadComplete = true;
    renderEverything();
    if (wasInitial) {
      completeBootLoader('✓ Corporate Charter Synchronized with Subnet 1');
    }

    // 6. Drive User-Wallet Guided Share Transfer Steps (AI Identities bid & co-sign strictly from the backend Rust simulator!)
    tickGuidedAuctionOrchestrator().catch(() => {});
  } catch (err) {
    console.warn('Charter world refresh warning:', err);
  }
}

async function queryEnrichedResolution(r, includePerSignerChecks = false) {
  const auth = r.authAddr.toLowerCase();
  const resCacheKey = `terminalAuth:${auth}`;
  if (!includePerSignerChecks && session.callCache.hasFrozen(resCacheKey)) {
    const cached = session.callCache.getFrozen(resCacheKey);
    const reqW = cached.isBoard ? Math.max(1, state.directorCount) : Math.max(1, state.requiredSuperVotes);
    return { ...cached, ...r, targetHps: cached.targetHps || r.targetHps, reqWeight: reqW };
  }

  const isBoard =
    (r.policyId || '').toLowerCase() === GOV_CONSTANTS.POLICY_BOARD_RESOLUTION.toLowerCase();
  const isIssuanceAuction =
    r.execKind === 'issueSharesAuction' ||
    r.execKind === 'equityFinancing' ||
    (r.policyId || '').toLowerCase() === GOV_CONSTANTS.POLICY_SHARE_ISSUANCE_AUCTION.toLowerCase();

  const myVerifiedLow = activeVerifiedIdentityLow();
  const [issPhaseHex, statusHex, weight0Hex, weight1Hex, readyHex, myAppHex, myShaAuthHex] =
    await Promise.all([
      isIssuanceAuction
        ? session.ethCall(auth, encodeAbi('issuancePhase()')).catch(() => '0x0')
        : Promise.resolve('0x0'),
      session.ethCall(auth, encodeAbi('status()')),
      session.ethCall(auth, encodeAbi('stageWeight(uint64)', [['uint64', 0]])),
      isIssuanceAuction
        ? session.ethCall(auth, encodeAbi('stageWeight(uint64)', [['uint64', 1]])).catch(() => '0x0')
        : Promise.resolve('0x0'),
      session.ethCall(auth, encodeAbi('isReadyToConsume()')),
      myVerifiedLow
        ? session.ethCall(myVerifiedLow, encodeAbi('hasApprovedAuth(address)', [['address', auth]]))
        : Promise.resolve('0x0'),
      isIssuanceAuction && myVerifiedLow
        ? session
            .ethCall(auth, encodeAbi('hasSignedShareholdersAgreement(address)', [['address', myVerifiedLow]]))
            .catch(() => '0x0')
        : Promise.resolve('0x0'),
    ]);

  const issPhase = isIssuanceAuction ? decodeUintWord(issPhaseHex) : 0;
  const weightHex = isIssuanceAuction && issPhase === 0 ? weight1Hex : weight0Hex;

  let currentStage = 0;
  let step1Dl = 0;
  let step2Dl = 0;
  let activeStep1Bids = 0;
  let failedBidsStage = false;
  let maxNewShares = Number(r.issueAmount || r.targetShares || 0);
  let minIssuePrice = Number(r.minIssuePrice || r.offerPrice || 100);
  let issuanceOrders = [];
  let isEquityFinancing = r.execKind === 'equityFinancing';
  let eqClassCode = Number(r.eqClassCode || 0);
  let eqConvRate = Number(r.eqConvRate || r.conversionRate || 1);
  let eqMinRaise = Number(r.eqMinRaise || r.minRaiseAmount || 0);
  let eqMaxOwnBps = Number(r.eqMaxOwnBps || 2000);
  let classLabel = r.classLabel || '';
  let projectedClearingPrice = minIssuePrice;
  let targetShares = maxNewShares;
  let offerPrice = minIssuePrice;
  let preMoneyCommon = state.totalConvertedCommon || state.totalShares;
  let subscribedAtOrAboveOffer = 0;
  let ssaHash = '';
  let shaHash = '';
  let allocSummary = null;
  let myPendingShaAllot = null;

  if (isIssuanceAuction) {
    try {
      const sc = session.inst?.shareCapital;
      const [
        stgHex,
        dlHex,
        bidsHex,
        failHex,
        termsHex,
        eqTermsHex,
        lblHex,
        projPxHex,
        ssaHex,
        shaHex,
        ordHex,
        tgtHex,
        allocSumHex,
        myAllotHex,
      ] = await Promise.all([
        session.ethCall(auth, encodeAbi('currentStage()')),
        session.ethCall(auth, encodeAbi('auctionDeadlines()')),
        session.ethCall(auth, encodeAbi('activeStep1BidCount()')),
        session.ethCall(auth, encodeAbi('hasFailedBidsStage()')),
        session.ethCall(auth, encodeAbi('issuanceTerms()')),
        session.ethCall(auth, encodeAbi('equityFinancingTerms()')).catch(() => '0x'),
        session.ethCall(auth, encodeAbi('issuanceClassLabel()')).catch(() => '0x'),
        session.ethCall(auth, encodeAbi('projectedIssuanceClearingPrice()')).catch(() => '0x0'),
        session.ethCall(auth, encodeAbi('ssaTemplateHash()')).catch(() => '0x'),
        session.ethCall(auth, encodeAbi('shaTemplateHash()')).catch(() => '0x'),
        session.ethCall(auth, encodeAbi('getOrdersRaw()')),
        session.ethCall(auth, encodeAbi('targetHps()')).catch(() => '0x'),
        sc
          ? session
              .ethCall(sc, encodeAbi('issuanceAllocationSummary(address)', [['address', auth]]))
              .catch(() => '0x')
          : Promise.resolve('0x'),
        sc && myVerifiedLow
          ? session
              .ethCall(
                sc,
                encodeAbi('pendingShaAllotmentOf(address,address)', [
                  ['address', auth],
                  ['address', myVerifiedLow],
                ])
              )
              .catch(() => '0x')
          : Promise.resolve('0x'),
      ]);
      currentStage = decodeUintWord(stgHex);
      const dls = decodeAuctionDeadlinesHex(dlHex);
      step1Dl = dls.step1Dl;
      step2Dl = dls.step2Dl;
      activeStep1Bids = decodeUintWord(bidsHex);
      failedBidsStage = decodeUintWord(failHex) === 1 || issPhase === 9;
      issuanceOrders = decodeAuctionOrdersRawHex(ordHex);
      classLabel = decodeBytes32LabelHex(lblHex, classLabel);
      if (ssaHex && ssaHex.length >= 66) ssaHash = ssaHex.slice(0, 66);
      if (shaHex && shaHex.length >= 66) shaHash = shaHex.slice(0, 66);
      const boundTgt = decodeAddrWord(tgtHex);
      if (boundTgt && boundTgt !== ZERO_ADDR) {
        r = { ...r, targetHps: boundTgt, targetShareLedger: boundTgt };
      }
      const tb = hexToBytes(termsHex);
      if (tb.length >= 64) {
        const mx = readU64BE(tb, 24);
        const mp = readU64BE(tb, 56);
        if (mx > 0) maxNewShares = mx;
        if (mp > 0) minIssuePrice = mp;
      }
      const eb = hexToBytes(eqTermsHex);
      if (eb.length >= 288 && readU64BE(eb, 24) === 1) {
        isEquityFinancing = true;
        eqClassCode = readU64BE(eb, 56);
        eqConvRate = Math.max(1, readU64BE(eb, 88));
        eqMinRaise = readU64BE(eb, 120);
        eqMaxOwnBps = readU64BE(eb, 152);
        targetShares = readU64BE(eb, 184) || maxNewShares;
        offerPrice = readU64BE(eb, 216) || minIssuePrice;
        preMoneyCommon = readU64BE(eb, 248) || preMoneyCommon;
        subscribedAtOrAboveOffer = readU64BE(eb, 280);
        maxNewShares = targetShares;
        minIssuePrice = offerPrice;
      } else {
        targetShares = maxNewShares;
        offerPrice = minIssuePrice;
        subscribedAtOrAboveOffer = issuanceOrders
          .filter((o) => (o.side === 1 || o.side === 3) && o.price >= offerPrice)
          .reduce((s, o) => s + o.quantity, 0);
      }
      projectedClearingPrice = decodeUintWord(projPxHex) || offerPrice;

      const sb = hexToBytes(allocSumHex);
      if (sb.length >= 8 * 32 && sb[31] === 1) {
        allocSummary = {
          determined: true,
          shareLedger: bytesToHex(sb.slice(32 + 12, 64)).toLowerCase(),
          targetShares: readU64BE(sb, 2 * 32 + 24),
          clearingPrice: readU64BE(sb, 3 * 32 + 24),
          rofrAllocated: readU64BE(sb, 4 * 32 + 24),
          biddersAllocated: readU64BE(sb, 5 * 32 + 24),
          allotmentCount: readU64BE(sb, 6 * 32 + 24),
          pendingShaCount: readU64BE(sb, 7 * 32 + 24),
        };
      }
      const mb = hexToBytes(myAllotHex);
      if (mb.length >= 5 * 32) {
        const sh = readU64BE(mb, 24);
        if (sh > 0) {
          myPendingShaAllot = {
            shares: sh,
            clearingPrice: readU64BE(mb, 32 + 24),
            shareLedger: bytesToHex(mb.slice(64 + 12, 96)).toLowerCase(),
            isRofr: mb[96 + 31] === 1,
            claimed: mb[128 + 31] === 1,
          };
        }
      }
    } catch (_) {}
  }

  let signers = [];
  if (
    includePerSignerChecks ||
    (decodeUintWord(statusHex) === 1 && !failedBidsStage && (!isIssuanceAuction || issPhase <= 1))
  ) {
    const pool = isBoard
      ? state.directors.map((d) => ({ addr: d.addr, label: d.label, avatar: d.avatar, weight: 1 }))
      : state.capRows
          .filter((c) => c.votes > 0)
          .map((c) => ({ addr: c.addr, label: c.label, avatar: c.avatar, weight: c.votes }));
    const flags = await Promise.all(
      pool.map(async (p) => {
        const app = await session
          .ethCall(p.addr, encodeAbi('hasApprovedAuth(address)', [['address', auth]]))
          .then((h) => decodeUintWord(h) === 1)
          .catch(() => false);
        if (app) return true;
        if (isEquityFinancing && issPhase === 0) {
          return session
            .ethCall(auth, encodeAbi('hasSignedShareholdersAgreement(address)', [['address', p.addr]]))
            .then((h) => decodeUintWord(h) === 1)
            .catch(() => false);
        }
        return false;
      })
    );
    signers = pool.map((p, idx) => ({ ...p, signed: flags[idx] }));
  }

  const reqWeight = isBoard ? Math.max(1, state.directorCount) : Math.max(1, state.requiredSuperVotes);
  const statusNum = decodeUintWord(statusHex);
  const enrichedObj = {
    ...r,
    isBoard,
    isIssuanceAuction,
    isEquityFinancing,
    issPhase,
    classLabel,
    projectedClearingPrice,
    allocSummary,
    myPendingShaAllot,
    eqClassCode,
    eqConvRate,
    eqMinRaise,
    eqMaxOwnBps,
    targetShares,
    offerPrice,
    preMoneyCommon,
    subscribedAtOrAboveOffer,
    ssaHash,
    shaHash,
    status: statusNum,
    weight: decodeUintWord(weightHex),
    reqWeight,
    ready: decodeUintWord(readyHex) === 1,
    mySigned: decodeUintWord(myAppHex) === 1 || (isIssuanceAuction && issPhase === 0 && decodeUintWord(myShaAuthHex) === 1),
    currentStage,
    step1Dl,
    step2Dl,
    activeStep1Bids,
    failedBidsStage,
    maxNewShares,
    minIssuePrice,
    issuanceOrders,
    signers,
  };

  if (
    !includePerSignerChecks &&
    isTerminalAuthStatus(statusNum, {
      failedBidsStage,
      pendingClaims: allocSummary?.pendingShaCount || 0,
    })
  ) {
    await session.callCache.getOrComputeImmutable(resCacheKey, async () => enrichedObj, () => true);
  }
  return enrichedObj;
}

async function refreshIssuanceArenaState() {
  const sc = session.inst?.shareCapital;
  const rounds = state.resolutions.filter(
    (r) => r.isEquityFinancing || r.isIssuanceAuction
  );
  if (!rounds.length) {
    state.issuanceRound = null;
    return;
  }
  let chosen = rounds.find(
    (r) => r.authAddr.toLowerCase() === (state.activeIssuanceAddr || '').toLowerCase()
  );
  if (!chosen) {
    chosen = rounds[0];
    state.activeIssuanceAddr = chosen.authAddr.toLowerCase();
    if (session.inst?.corporateCharter) {
      saveIssuanceAddr(session.inst.corporateCharter, state.activeIssuanceAddr);
    }
  }
  const auth = chosen.authAddr.toLowerCase();
  let escrowCash = 0;
  let allotments = [];
  if (sc) {
    try {
      escrowCash = decodeUintWord(
        await session
          .ethCall(sc, encodeAbi('escrowedCashOf(address)', [['address', auth]]))
          .catch(() => '0x0')
      );
      if (chosen.allocSummary?.determined && chosen.allocSummary.allotmentCount > 0) {
        allotments = (
          await Promise.all(
            Array.from({ length: Math.min(chosen.allocSummary.allotmentCount, 32) }, (_, idx) =>
              session
                .ethCall(
                  sc,
                  encodeAbi('getIssuanceAllotment(address,uint64)', [
                    ['address', auth],
                    ['uint64', idx],
                  ])
                )
                .then((hex) => {
                  const b = hexToBytes(hex);
                  if (b.length < 6 * 32) return null;
                  return {
                    idx,
                    investor: bytesToHex(b.slice(12, 32)).toLowerCase(),
                    shareLedger: bytesToHex(b.slice(32 + 12, 64)).toLowerCase(),
                    shares: readU64BE(b, 64 + 24),
                    clearingPrice: readU64BE(b, 96 + 24),
                    isRofr: b[128 + 31] === 1,
                    claimed: b[160 + 31] === 1,
                  };
                })
                .catch(() => null)
            )
          )
        ).filter(Boolean);
      }
    } catch (_) {}
  }
  state.issuanceRound = {
    ...chosen,
    escrowCash,
    allotments,
  };
}

async function refreshEsopState() {
  const sc = session.inst?.shareCapital;
  if (!sc || !state.supportsV4Governance) {
    state.esopSupported = false;
    state.esopDueCount = 0;
    state.esopPrograms = [];
    state.esopGrants = [];
    return;
  }
  try {
    const [pCntHex, gCntHex, dueHex, lastSwHex] = await Promise.all([
      session.ethCall(sc, encodeAbi('esopProgramCount()')),
      session.ethCall(sc, encodeAbi('esopGrantCount()')),
      session.ethCall(sc, encodeAbi('dueEsopIssuanceCount()')),
      session.ethCall(sc, encodeAbi('lastEsopSweepBlock()')).catch(() => '0x0'),
    ]);
    state.esopSupported = true;
    const pCnt = decodeUintWord(pCntHex);
    const gCnt = decodeUintWord(gCntHex);
    state.esopDueCount = decodeUintWord(dueHex);
    state.esopLastSweepBlock = decodeUintWord(lastSwHex);

    const programs = await Promise.all(
      Array.from({ length: Math.min(pCnt, 16) }, async (_, pid) => {
        const rawHex = await session.ethCall(sc, encodeAbi('getEsopProgram(uint64)', [['uint64', pid]]));
        const b = hexToBytes(rawHex);
        if (b.length < 288) return null;
        const optionLedger = bytesToHex(b.slice(12, 32)).toLowerCase();
        const underlyingLedger = bytesToHex(b.slice(44, 64)).toLowerCase();
        const [optSymHex, undSymHex] = await Promise.all([
          session.ethCall(optionLedger, encodeAbi('symbol()')).catch(() => '0x'),
          session.ethCall(underlyingLedger, encodeAbi('symbol()')).catch(() => '0x'),
        ]);
        return {
          programId: pid,
          optionLedger,
          optionSymbol: decodeAbiStringHex(optSymHex, `ESOP-${pid}`),
          underlyingLedger,
          underlyingSymbol: decodeAbiStringHex(undSymHex, shareTickerStr()),
          classCode: readU64BE(b, 88),
          conversionRate: readU64BE(b, 120) || 1,
          authorizedShares: readU64BE(b, 152),
          exercisePrice: readU64BE(b, 184),
          committedShares: readU64BE(b, 216),
          issuedOptions: readU64BE(b, 248),
          exercisedOptions: readU64BE(b, 280),
        };
      })
    );
    state.esopPrograms = programs.filter(Boolean);

    const grants = await Promise.all(
      Array.from({ length: Math.min(gCnt, 32) }, async (_, gid) => {
        const [gHex, sHex] = await Promise.all([
          session.ethCall(sc, encodeAbi('getEsopGrant(uint64)', [['uint64', gid]])),
          session.ethCall(sc, encodeAbi('getEsopGrantScheduleRaw(uint64)', [['uint64', gid]])),
        ]);
        const gb = hexToBytes(gHex);
        if (gb.length < 256) return null;
        const programId = readU64BE(gb, 24);
        const employee = bytesToHex(gb.slice(44, 64)).toLowerCase();
        const cliffBlock = readU64BE(gb, 88);
        const cliffTimestamp = readU64BE(gb, 120);
        const totalAwarded = readU64BE(gb, 152);
        const issuedOptions = readU64BE(gb, 184);
        const exercisedOptions = readU64BE(gb, 216);
        const trancheCount = readU64BE(gb, 248);

        const sb = decodeAbiBytesHex(sHex);
        const tranches = [];
        if (sb.length >= 2) {
          const n = (sb[0] << 8) | sb[1];
          for (let t = 0; t < n && 2 + (t + 1) * 25 <= sb.length; t++) {
            const off = 2 + t * 25;
            tranches.push({
              idx: t,
              issued: sb[off] === 1,
              dueBlock: readU64BE(sb, off + 1),
              dueTimestamp: readU64BE(sb, off + 9),
              amount: readU64BE(sb, off + 17),
            });
          }
        }

        const prog = state.esopPrograms.find((p) => p.programId === programId);
        const [optBal, empShaHex] = await Promise.all([
          prog ? session.getLedgerBalance(prog.optionLedger, employee).catch(() => 0) : Promise.resolve(0),
          session
            .ethCall(session.inst.corporateCharter, encodeAbi('hasSignedShareholdersAgreement(address)', [['address', employee]]))
            .catch(() => '0x0'),
        ]);
        const empCapRow = state.capRows.find((r) => r.addr === employee);
        const empConvCommon = empCapRow ? empCapRow.convCommon : 0;
        const empSignedSha = decodeUintWord(empShaHex) === 1;

        return {
          grantId: gid,
          programId,
          employee,
          employeeLabel: session.labelForIdentity(employee),
          cliffBlock,
          cliffTimestamp,
          totalAwarded,
          issuedOptions,
          exercisedOptions,
          exercisableNow: Math.max(0, Math.min(optBal, issuedOptions - exercisedOptions)),
          optionWalletBal: optBal,
          trancheCount,
          tranches,
          cliffPassed: session.blockNumber >= cliffBlock,
          isFirstTimeShareholder: empConvCommon === 0 && !empSignedSha,
        };
      })
    );
    state.esopGrants = grants.filter(Boolean);
  } catch (err) {
    console.warn('ESOP refresh note:', err.message);
  }
}

async function refreshFuturesAndDexState() {
  const sc = session.inst?.shareCapital;
  if (!sc) {
    state.futuresLedger = ZERO_ADDR;
    state.futuresPct = 0;
    state.attachedDex = ZERO_ADDR;
    return;
  }
  try {
    const [futLedHex, pctHex] = await Promise.all([
      session.ethCall(sc, encodeAbi('futuresLedger()')),
      session.ethCall(sc, encodeAbi('futuresUnderwritePct()')),
    ]);
    state.futuresLedger = decodeAddrWord(futLedHex);
    state.futuresPct = decodeUintWord(pctHex);

    if (session.myIdentityAddr) {
      const alwHex = await session.ethCall(
        sc,
        encodeAbi('futuresAllowanceOf(address)', [['address', session.myIdentityAddr]])
      );
      state.futuresAllowance = decodeFuturesAllowanceHex(alwHex);
    }

    if (state.futuresLedger && state.futuresLedger !== ZERO_ADDR) {
      const [dexHex, myFutBal] = await Promise.all([
        session.ethCall(state.futuresLedger, encodeAbi('attachedDex()')),
        session.myIdentityAddr
          ? session.getLedgerBalance(state.futuresLedger, session.myIdentityAddr)
          : Promise.resolve(0),
      ]);
      state.attachedDex = decodeAddrWord(dexHex);
      state.myFuturesBal = myFutBal;

      if (state.attachedDex && state.attachedDex !== ZERO_ADDR) {
        const bestHex = await session
          .ethCall(state.attachedDex, encodeAbi('bestBidAndAsk()'))
          .catch(() => '0x');
        const b = hexToBytes(bestHex);
        if (b.length >= 64) {
          let bb = 0n;
          let ba = 0n;
          for (let i = 0; i < 8; i++) {
            bb = (bb << 8n) | BigInt(b[24 + i] || 0);
            ba = (ba << 8n) | BigInt(b[56 + i] || 0);
          }
          state.futuresDexBest = { bestBid: Number(bb), bestAsk: Number(ba) };
        }
      }
    } else {
      state.attachedDex = ZERO_ADDR;
      state.myFuturesBal = 0;
    }
  } catch (_) {}
}

async function refreshAuctionArenaState() {
  const sc = session.inst?.shareCapital;
  const shareLed = session.inst?.shareLedger;
  if (!sc || !shareLed) return;

  try {
    const lastHex = await session
      .ethCall(shareLed, encodeAbi('lastAuctionSettlement()'))
      .catch(() => '0x');
    state.lastSettlement = decodeLastAuctionSettlementHex(lastHex);
  } catch (_) {}

  if (!state.activeAuctionAddr && session.blockNumber > 0 && !charterAuctionSub?.isConnected?.()) {
    // Auto-discover any recently initialized Share Transfer Auction for this company's ShareLedger!
    const shareTopic = '0x000000000000000000000000' + shareLed.toLowerCase().replace(/^0x/, '');
    try {
      const fromB = Math.max(1, session.blockNumber - 2);
      const logs = await session.rpcCall('eth_getLogs', [
        {
          fromBlock: '0x' + fromB.toString(16),
          toBlock: '0x' + session.blockNumber.toString(16),
          topics: [
            HFS_EVENT_TOPICS.AUTH_INITIALIZED,
            shareTopic,
            GOV_CONSTANTS.POLICY_SHARE_TRANSFER_AUCTION,
          ],
        },
      ]);
      if (Array.isArray(logs) && logs.length > 0) {
        const latestAuth = (logs[logs.length - 1].address || '').toLowerCase();
        if (latestAuth) {
          state.activeAuctionAddr = latestAuth;
          saveAuctionAddr(session.inst.corporateCharter, latestAuth);
        }
      }
    } catch (_) {}
  }

  if (!state.activeAuctionAddr) {
    state.auctionStatus = 0;
    state.auctionOrders = [];
    state.auctionStep1Bids = 0;
    state.auctionFailedBids = false;
    state.auctionEscrowCash = 0;
    return;
  }

  try {
    const auth = state.activeAuctionAddr;
    const [stHex, dlHex, ordHex, escHex, bidsHex, failHex] = await Promise.all([
      session.ethCall(auth, encodeAbi('status()')),
      session.ethCall(auth, encodeAbi('auctionDeadlines()')),
      session.ethCall(auth, encodeAbi('getOrdersRaw()')),
      session.ethCall(sc, encodeAbi('escrowedCashOf(address)', [['address', auth]])),
      session.ethCall(auth, encodeAbi('activeStep1BidCount()')).catch(() => '0x0'),
      session.ethCall(auth, encodeAbi('hasFailedBidsStage()')).catch(() => '0x0'),
    ]);
    state.auctionStatus = decodeUintWord(stHex);
    state.auctionDeadlines = decodeAuctionDeadlinesHex(dlHex);
    state.auctionOrders = decodeAuctionOrdersRawHex(ordHex);
    state.auctionEscrowCash = decodeUintWord(escHex);
    const activeWin1Count = state.auctionOrders.filter((o) => o.side === 1 && o.quantity > 0).length;
    state.auctionStep1Bids = Math.max(decodeUintWord(bidsHex), activeWin1Count);
    state.auctionFailedBids =
      decodeUintWord(failHex) === 1 ||
      (state.auctionDeadlines.step1Dl > 0 &&
        session.blockNumber > state.auctionDeadlines.step1Dl &&
        state.auctionStep1Bids === 0);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Guided 3-Step Share Transfer Call-Auction Orchestrator (User Wallet Steps Only — Backend `tx-load-sim` Drives AI Bids!)
// ---------------------------------------------------------------------------

function currentAuctionWindowStage() {
  if (!state.activeAuctionAddr || state.auctionStatus === 0) return 0;
  if (state.auctionStatus === 4) return 5; // Settled & Consumed
  if (state.auctionFailedBids) return -1; // Failed Bids Stage (0 active bids before Window 1 deadline -> -97)
  if (state.auctionStatus === 3) return -2; // Expired without settlement
  const dl = state.auctionDeadlines;
  const blk = session.blockNumber;
  if (!dl.step1Dl || dl.step1Dl === 0) return 1;
  if (blk <= dl.step1Dl) return 1; // Window 1 Live (Bids Stage — >= 1 Bid Mandatory!)
  if (blk <= dl.step2Dl) return 2; // Window 2 Live (Shareholder Co-Sale)
  if (blk <= dl.step3Dl) return 3; // Window 3 Live (Non-Seller ROFR)
  return 4; // Ready for Pro-Rata Settlement!
}

function computeProjectedClearing(orders) {
  const buys = orders.filter((o) => o.side === 1 || o.side === 3);
  const sells = orders.filter((o) => o.side === 2);
  if (!buys.length || !sells.length) return null;

  const prices = Array.from(new Set([...buys.map((b) => b.price), ...sells.map((s) => s.price)])).sort(
    (a, b) => a - b
  );
  let bestVol = 0;
  let bestPart = 0;
  let minP = 0;
  let maxP = 0;
  let bestD = 0;
  let bestS = 0;

  for (const p of prices) {
    const d = buys.filter((b) => b.price >= p).reduce((acc, x) => acc + x.quantity, 0);
    const s = sells.filter((sl) => sl.price <= p).reduce((acc, x) => acc + x.quantity, 0);
    const vol = Math.min(d, s);
    if (vol > 0) {
      const part = d + s;
      if (vol > bestVol || (vol === bestVol && part > bestPart)) {
        bestVol = vol;
        bestPart = part;
        minP = p;
        maxP = p;
        bestD = d;
        bestS = s;
      } else if (vol === bestVol && part === bestPart) {
        maxP = p;
      }
    }
  }
  if (bestVol === 0) return null;
  const pStar = bestD > bestS ? maxP : bestS > bestD ? minP : Math.floor((minP + maxP) / 2);
  const rule =
    bestS > bestD
      ? 'Supply > Demand: Sellers pro-rated by existing shareholding %'
      : bestD > bestS
        ? 'Demand > Supply: Buyers pro-rated by bid quantity'
        : 'Exact Equilibrium: 100% fill on crossing orders';
  return { pStar, matchedVol: bestVol, demand: bestD, supply: bestS, rule };
}

async function tickGuidedAuctionOrchestrator() {
  const plan = state.guidedPlan;
  if (!plan || state.auctionBusy || !session.inst?.shareCapital) return;
  if (!state.activeAuctionAddr || state.activeAuctionAddr.toLowerCase() !== plan.authAddr.toLowerCase()) {
    return;
  }

  const sc = session.inst.shareCapital;
  const shareLed = session.inst.shareLedger;
  const auth = plan.authAddr;
  const winStage = currentAuctionWindowStage();

  state.auctionBusy = true;
  try {
    // Window 1 Buyer Bids & Window 3 ROFR Bids are placed strictly on the backend by the Rust `tx-load-sim` AI Engine!

    // Window 2: Submit the Human User's queued Sell Offer using their own wallet
    if (winStage === 2 && !plan.win2UserDone) {
      plan.win2UserDone = true;
      if (state.myShares > 0) {
        const offerQty = Math.min(state.myShares, plan.userSellQty);
        startInflightAnim(`Window 2 Open: Submitting your Sell Offer (${fmtNum(offerQty)} @ ${plan.userSellPrice} SGD)…`);
        await session.sendAsMyIdentity(
          encodeAbi('placeSellOrderViaShareCapital(address,address,uint64,uint64)', [
            ['address', sc],
            ['address', auth],
            ['uint64', plan.userSellPrice],
            ['uint64', offerQty],
          ]),
          'Window2.placeSellOrder(You)',
          'ShareCapital',
          [sc, auth, shareLed]
        );
        finishInflightAnim('✓ Window 2 Shareholder Sell Offer recorded!');
      }
      await refreshCharterWorld();
      return;
    }

    // Stage 4: Settle once Window 3 closes!
    if (winStage === 4 && !plan.settledDone) {
      plan.settledDone = true;
      startInflightAnim('Step 4: Settling Single-Price Pro-Rata Call Auction & Updating Cap Table…');
      await session.sendAsMyIdentity(
        encodeAbi('settleAuctionViaShareCapital(address,address,address)', [
          ['address', sc],
          ['address', shareLed],
          ['address', auth],
        ]),
        'settleShareTransferAuction',
        'ShareCapital',
        [sc, shareLed, auth, session.inst.fiatLedger]
      );
      finishInflightAnim('🏆 Call Auction Settled & Cap Table Updated!');
      state.guidedPlan = null;
      await refreshCharterWorld();
      showBanner(
        `🏆 <strong>3-Step Share Transfer Call Auction Settled!</strong> Cleared <strong>${fmtNum(state.lastSettlement.matchedQty)} ${escapeHtml(shareTickerStr())}</strong> @ <strong>${fmtNum(state.lastSettlement.clearingPrice)} SGD</strong> — check the reactive Capitalization Table &amp; Event Logs!`,
        'ok'
      );
    }
  } catch (e) {
    console.warn('Guided auction step note:', e.message);
  } finally {
    state.auctionBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Rendering: Hero, Ratification Spotlight, Org Chart, Cap Table, Resolutions, Arena, Futures
// ---------------------------------------------------------------------------

function renderEverything() {
  syncCapActionPanels();
  renderHeroAndKpis();
  renderMyCompanyRoleBar();
  renderActionCenterAndBadges();
  renderRatificationSpotlight();
  renderOrgChart();
  renderCapTable();
  renderShareClassesDetails();
  populateCapSplitsAndBuybacks();
  renderResolutionsGrid();
  renderActionStudioState();
  renderIssuanceArena();
  renderEsopTab();
  renderAuctionArena();
  renderFuturesAndDex();
  renderRelatedMatters();
  renderSovereignEntityBanner();
  renderCompanySocialSection();
  renderEventFeeds();
}

function renderHeroAndKpis() {
  const ticker = shareTickerStr();
  el.heroCompanyName.textContent = companyNameStr();
  el.heroShareTicker.textContent =
    state.shareClasses.length > 1
      ? `${ticker} (+${state.shareClasses.length - 1} Pref)`
      : ticker;

  if (session.inst?.corporateCharter) {
    el.kpiCharterAddr.textContent = `Charter ${shortAddr(session.inst.corporateCharter)}`;
  }

  const isPending = state.charterState === 1;
  const isActive = state.charterState === 2;

  el.heroBar.className = `chr-hero-bar ${isPending ? 'ratifying' : 'active-seal'}`;
  if (isPending) {
    el.heroStateOrb.className = 'chr-state-orb pending';
    el.heroStateOrb.textContent = '⏳ PENDING ACTIVATION';
    el.kpiCharterState.textContent = 'Awaiting Activation';
    el.kpiCharterState.style.color = '#fbbf24';
  } else if (isActive) {
    el.heroStateOrb.className = 'chr-state-orb active';
    el.heroStateOrb.textContent = `✓ ACTIVE COMPANY${state.activatedBlock ? ` (Blk #${fmtNum(state.activatedBlock)})` : ''}`;
    el.kpiCharterState.textContent = 'Active & Ratified';
    el.kpiCharterState.style.color = '#6ee7b7';
  } else {
    el.heroStateOrb.className = 'chr-state-orb pending';
    el.heroStateOrb.textContent = 'Connecting…';
    el.kpiCharterState.textContent = 'Connecting…';
  }

  el.heroQuestSteps.innerHTML = `
    <span class="chr-quest-step done">1. Incorporated ✓</span>
    <span style="color:var(--txt-2);">──▶</span>
    <span class="chr-quest-step ${isPending ? 'current' : isActive ? 'done' : ''}">
      2. Activated by Directors &amp; ≥75% Shareholders ${isActive ? '✓' : '(In Progress…)'}
    </span>
    <span style="color:var(--txt-2);">──▶</span>
    <span class="chr-quest-step ${isActive ? 'done' : ''}">
      3. Fundraising, Share Sales &amp; Options ${isActive ? 'Ready ✓' : '🔒'}
    </span>
  `;

  const filledExecs = state.execSeats.filter((s) => s.holders.length > 0).length;
  const pendCnt = state.pendingDirectors.length;
  el.kpiDirectorCount.textContent = pendCnt > 0
    ? `${state.directorCount} Directors (+${pendCnt} Pending)`
    : `${state.directorCount} Director${state.directorCount === 1 ? '' : 's'}`;
  el.kpiExecSummary.textContent = `${filledExecs} / ${state.execSeats.length} Executive Roles Filled`;

  const totConv = state.totalConvertedCommon || state.totalShares;
  el.kpiTotalShares.textContent =
    state.shareClasses.length > 1
      ? `${fmtNum(totConv)} Voting Shares (${state.shareClasses.length} Classes)`
      : `${fmtNum(state.totalShares)} ${ticker}`;
  el.kpiSuperThreshold.textContent = `≥75% Approval = ${fmtNum(state.requiredSuperVotes)} votes`;

  const myConv = state.myConvertedCommon || state.myShares;
  const myPct = totConv > 0 ? ((myConv / totConv) * 100).toFixed(1) : '0.0';
  el.kpiMyVotes.textContent = `${myPct}% Stake (${fmtNum(state.myVotes)} votes)`;
  el.kpiMySharePct.textContent = session.myIdentityAddr
    ? `${fmtNum(state.myCash)} SGD available`
    : 'Connect or incorporate to participate';

  const treasShort =
    state.treasuryAccount && state.treasuryAccount !== ZERO_ADDR
      ? `Treasury: ${session.labelForIdentity(state.treasuryAccount).split('·')[0].trim()}`
      : 'No Futures Exchange yet';
  if (state.futuresLedger && state.futuresLedger !== ZERO_ADDR && state.futuresPct > 0) {
    el.kpiFuturesCap.textContent = `${state.futuresPct}% Futures (${fmtNum(state.futuresAllowance.companyCap)})`;
    el.kpiFuturesCap.style.color = '#6ee7b7';
    el.kpiAttachedDex.innerHTML =
      state.attachedDex && state.attachedDex !== ZERO_ADDR
        ? `<a href="/dex.html?hfs=${state.attachedDex}" style="color:#38bdf8;font-weight:700;">Open Futures Exchange ↗</a>`
        : `${treasShort} • Ready to attach DEX`;
  } else {
    el.kpiFuturesCap.textContent = 'Futures Not Enabled';
    el.kpiFuturesCap.style.color = '#94a3b8';
    el.kpiAttachedDex.textContent = treasShort;
  }
}

function renderActionCenterAndBadges() {
  // 1. Live Navigation Tab Badges
  const openRes = state.resolutions.filter(
    (r) => !r.failedBidsStage && (r.status === 1 || r.status === 2) && !(r.isEquityFinancing && r.issPhase >= 2)
  );
  if (el.tabBadgeResolutions) {
    if (openRes.length > 0) {
      el.tabBadgeResolutions.style.display = 'inline-flex';
      el.tabBadgeResolutions.className = 'chr-tab-pill live';
      el.tabBadgeResolutions.textContent = `${openRes.length} Open`;
    } else {
      el.tabBadgeResolutions.style.display = 'none';
    }
  }

  const rd = state.issuanceRound;
  const issPh = rd ? rd.issPhase || (rd.failedBidsStage ? 9 : rd.status === 4 ? 5 : 0) : 0;
  const issPendSha = rd?.allocSummary ? rd.allocSummary.pendingShaCount : 0;
  const issLive = rd && issPh >= 1 && issPh <= 5 && !(issPh === 5 && rd.allocSummary && issPendSha === 0);
  if (el.tabBadgeIssuance) {
    if (issLive) {
      el.tabBadgeIssuance.style.display = 'inline-flex';
      el.tabBadgeIssuance.className = 'chr-tab-pill live';
      el.tabBadgeIssuance.textContent = `Step ${issPh}/5`;
    } else {
      el.tabBadgeIssuance.style.display = 'none';
    }
  }

  const aucStg = currentAuctionWindowStage();
  if (el.tabBadgeTransfer) {
    if (aucStg >= 1 && aucStg <= 4) {
      el.tabBadgeTransfer.style.display = 'inline-flex';
      el.tabBadgeTransfer.className = 'chr-tab-pill live';
      el.tabBadgeTransfer.textContent = aucStg === 4 ? 'Settle' : `Win ${aucStg}/3`;
    } else {
      el.tabBadgeTransfer.style.display = 'none';
    }
  }

  if (el.tabBadgeEsop) {
    if (state.esopDueCount > 0 || state.esopGrants.length > 0) {
      el.tabBadgeEsop.style.display = 'inline-flex';
      el.tabBadgeEsop.className = state.esopDueCount > 0 ? 'chr-tab-pill live' : 'chr-tab-pill';
      el.tabBadgeEsop.textContent =
        state.esopDueCount > 0 ? `${state.esopDueCount} Vesting` : `${state.esopGrants.length}`;
    } else {
      el.tabBadgeEsop.style.display = 'none';
    }
  }

  // 2. Plain-English Guided Next-Step Card (`#nextStepSpotlight`)
  if (!el.nextStepSpotlight) return;
  el.nextStepSpotlight.style.display = 'flex';
  const myPendingClaim = state.resolutions.find(
    (r) => r.myPendingShaAllot && !r.myPendingShaAllot.claimed && r.issPhase === 5
  );

  if (state.myNeedsDirectorConsent) {
    el.nextStepSpotlight.className = 'chr-next-step-card urgent';
    el.nextStepSpotlight.innerHTML = `
      <div>
        <span class="inst-badge amber">⚡ ACTION NEEDED FROM YOU</span>
        <div style="font-size:13.5px;font-weight:800;color:#fef3c7;margin-top:6px;">
          Accept Your Board of Directors Seat
        </div>
        <div style="font-size:11.5px;color:#fde68a;margin-top:3px;line-height:1.45;">
          You were appointed as a Director. Sign your acceptance to activate your seat on the Board.
        </div>
      </div>
      <button type="button" class="inst-btn emerald sm" data-trigger-director-consent="1" style="align-self:flex-start;">
        ✍️ Sign Director Consent Now
      </button>
    `;
    return;
  }

  if (state.charterState === 1) {
    if (state.myCanGovern || state.myNeedsDirectorConsent) {
      el.nextStepSpotlight.className = 'chr-next-step-card urgent';
      el.nextStepSpotlight.innerHTML = `
        <div>
          <span class="inst-badge amber">⏳ STEP 1 OF COMPANY SETUP</span>
          <div style="font-size:13.5px;font-weight:800;color:#fef3c7;margin-top:6px;">
            Activate Your Company Charter Below
          </div>
          <div style="font-size:11.5px;color:#fde68a;margin-top:3px;line-height:1.45;">
            Your company is newly incorporated. Complete the yellow Activation Checklist right below to unlock all features.
          </div>
        </div>
        <button type="button" class="inst-btn emerald sm" data-scroll-to-ratify="1" style="align-self:flex-start;">
          👇 Jump to Activation Checklist
        </button>
      `;
    } else {
      el.nextStepSpotlight.style.display = 'none';
    }
    return;
  }

  if (myPendingClaim) {
    const sh = myPendingClaim.myPendingShaAllot.shares;
    const cls = myPendingClaim.classLabel || 'Shares';
    el.nextStepSpotlight.className = 'chr-next-step-card urgent';
    el.nextStepSpotlight.innerHTML = `
      <div>
        <span class="inst-badge amber">🎉 SHARES READY TO CLAIM</span>
        <div style="font-size:13.5px;font-weight:800;color:#fef3c7;margin-top:6px;">
          Sign Agreement to Receive +${fmtNum(sh)} ${escapeHtml(cls)}
        </div>
        <div style="font-size:11.5px;color:#fde68a;margin-top:3px;line-height:1.45;">
          Your fundraising allotment is ready! Sign the Shareholders' Agreement to mint the shares in your name.
        </div>
      </div>
      <button type="button" class="inst-btn emerald sm" data-claim-issuance-sha="${myPendingClaim.authAddr}" style="align-self:flex-start;">
        ✍️ Sign Agreement &amp; Claim Shares
      </button>
    `;
    return;
  }

  if (issLive && rd) {
    const stepNames = {
      1: 'Step 1: Shareholders voting on funding round (≥75%)',
      2: 'Step 2: Open for Investor Bids in protected escrow',
      3: 'Step 3: Open for Existing Shareholder First Refusal (ROFR)',
      4: 'Step 4: Calculating fair ROFR & pro-rata allocations…',
      5: `Step 5: Waiting for ${issPendSha} new investor(s) to sign Shareholders' Agreement`,
    };
    el.nextStepSpotlight.className = 'chr-next-step-card urgent';
    el.nextStepSpotlight.innerHTML = `
      <div>
        <span class="inst-badge cyan">💰 LIVE FUNDING ROUND (STEP ${issPh}/5)</span>
        <div style="font-size:13.5px;font-weight:800;color:#f8fafc;margin-top:6px;">
          ${escapeHtml(rd.classLabel || 'Share Issuance')} Round in Progress
        </div>
        <div style="font-size:11.5px;color:#bae6fd;margin-top:3px;line-height:1.45;">
          ${escapeHtml(stepNames[issPh] || 'Funding round active')}
        </div>
      </div>
      <button type="button" class="inst-btn primary sm" data-quick-workflow="fundraise" style="align-self:flex-start;">
        💰 Open Funding Round →
      </button>
    `;
    return;
  }

  if (aucStg >= 1 && aucStg <= 4) {
    const winNames = {
      1: 'Window 1: Open for Buyer Bids',
      2: 'Window 2: Open for Shareholder Sell Offers',
      3: 'Window 3: Open for Existing Shareholder ROFR',
      4: 'All 3 Windows Closed — Ready to Settle Sale!',
    };
    el.nextStepSpotlight.className = 'chr-next-step-card urgent';
    el.nextStepSpotlight.innerHTML = `
      <div>
        <span class="inst-badge cyan">🔄 LIVE SHARE SALE</span>
        <div style="font-size:13.5px;font-weight:800;color:#f8fafc;margin-top:6px;">
          ${escapeHtml(winNames[aucStg] || 'Share Sale Active')}
        </div>
        <div style="font-size:11.5px;color:#bae6fd;margin-top:3px;line-height:1.45;">
          Escrowed cash: ${fmtNum(state.auctionEscrowCash)} SGD • Click below to participate or settle.
        </div>
      </div>
      <button type="button" class="inst-btn primary sm" data-quick-workflow="secondary" style="align-self:flex-start;">
        🔄 Open Share Sale →
      </button>
    `;
    return;
  }

  const actionableRes = openRes.filter((r) => getResolutionStandingForMe(r).canActNow);
  if (actionableRes.length > 0) {
    const topR = actionableRes[0];
    const stInfo = getResolutionStandingForMe(topR);
    el.nextStepSpotlight.className = 'chr-next-step-card urgent';
    el.nextStepSpotlight.innerHTML = `
      <div>
        <span class="inst-badge amber">🗳️ ${actionableRes.length} RESOLUTION${actionableRes.length === 1 ? '' : 'S'} AWAITING YOUR ACTION</span>
        <div style="font-size:13px;font-weight:800;color:#fef3c7;margin-top:6px;">
          ${escapeHtml(topR.title)}
        </div>
        <div style="font-size:11.5px;color:#fde68a;margin-top:3px;line-height:1.45;">
          Votes: ${fmtNum(topR.weight)} / ${fmtNum(topR.reqWeight)} • Click to sign with your verified ${topR.isBoard ? 'Director' : 'Shareholder'} wallet.
        </div>
      </div>
      <button type="button" class="inst-btn emerald sm" data-sign-exec="${topR.authAddr}" style="align-self:flex-start;">
        ${stInfo.btnText || '✍️ Sign &amp; Enact Resolution'}
      </button>
    `;
    return;
  }

  el.nextStepSpotlight.style.display = 'none';
}

function renderMyCompanyRoleBar() {
  const simManaged = isSimManagedCharter();
  const autoAiLbl = el.chkAutoAiCosign?.closest('label');
  if (autoAiLbl) autoAiLbl.style.display = simManaged && state.myCanGovern ? 'flex' : 'none';
  const aucAiLbl = el.chkAuctionAiPeers?.closest('label');
  if (aucAiLbl) aucAiLbl.style.display = simManaged && state.myIsShareholder ? 'flex' : 'none';
  if (!el.myCompanyRoleBar) return;
  const myId = activeVerifiedIdentityLow();
  const myEoa = (session.wallet?.keypair?.address || '').toLowerCase();
  const comp = escapeHtml(companyNameStr());
  const creatorTag = escapeHtml(session.activeHfsEntry?.creatorTag || 'another Founder');
  const totConv = Math.max(1, state.totalConvertedCommon || state.totalShares || 1);
  const myConv = state.myConvertedCommon || state.myShares;
  const myPctNum = (myConv / totConv) * 100;
  const copyBtn = myId
    ? `<button type="button" class="inst-btn sm" data-copy-my-identity="${myId}" title="${myId}">📋 Copy My Identity (${shortAddr(myId)})</button>`
    : '';

  if (state.myNeedsDirectorConsent) {
    el.myCompanyRoleBar.style.display = 'flex';
    el.myCompanyRoleBar.style.borderColor = 'rgba(245,158,11,0.65)';
    el.myCompanyRoleBar.style.background = 'linear-gradient(135deg, rgba(120,53,15,0.42), rgba(15,23,42,0.92))';
    el.myCompanyRoleBar.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:3px;max-width:740px;">
        <strong style="font-size:13px;color:#fef3c7;">
          ✍️ Action Required: Pending Your Personal Consent to Act as Director!
        </strong>
        <span style="font-size:11.5px;color:#fde68a;line-height:1.45;">
          Someone named your Identity (<code>${shortAddr(myId)}</code>) to the Board of Directors of <strong>${comp}</strong>.
          ${
            state.charterState === 1
              ? 'Constitutional law blocks this company from becoming <code>ACTIVE</code> until every named Initial Director signs personal consent!'
              : 'Your Board seat remains in <code>PENDING CONSENT</code> until you sign <code>consentToDirectorship()</code>!'
          }
        </span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" class="inst-btn emerald" data-trigger-director-consent="1">
          ✍️ Sign My Consent to Act as Director
        </button>
        ${copyBtn}
      </div>
    `;
    return;
  }

  if (!state.myIsAssociated) {
    el.myCompanyRoleBar.style.display = 'flex';
    el.myCompanyRoleBar.style.borderColor = 'rgba(56,189,248,0.42)';
    el.myCompanyRoleBar.style.background = 'linear-gradient(135deg, rgba(14,165,233,0.14), rgba(16,185,129,0.1))';
    el.myCompanyRoleBar.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:3px;max-width:740px;">
        <strong style="font-size:13px;color:#e0f2fe;">
          👀 Read-Only View: ${comp} (Created by ${creatorTag})
        </strong>
        <span style="font-size:11.5px;color:var(--txt-1);line-height:1.45;">
          Your wallet keypair (<code>${myEoa ? shortAddr(myEoa) : 'unconnected'}</code>) &amp; Identity (${
            myId ? `<code>${shortAddr(myId)}</code>` : 'not yet deployed'
          }) is not a Director or Shareholder of this company, so governance proposal &amp; signing controls are hidden. Click <strong>Incorporate New Company</strong> to launch your own sovereign <code>CorporateCharter</code>!
        </span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" class="inst-btn emerald" data-open-incorp-quick="1">
          🏛️ + Create Your Own CorporateCharter
        </button>
        ${copyBtn}
      </div>
    `;
    return;
  }

  if (!state.myIsDirector && state.myIsShareholder && myPctNum < 25) {
    el.myCompanyRoleBar.style.display = 'flex';
    el.myCompanyRoleBar.style.borderColor = 'rgba(167,139,250,0.42)';
    el.myCompanyRoleBar.style.background = 'rgba(30,20,58,0.42)';
    el.myCompanyRoleBar.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:3px;max-width:740px;">
        <strong style="font-size:12.5px;color:#ede9fe;">
          📊 Your Verified Standing: Minority Shareholder (${myPctNum.toFixed(1)}% Equity • Non-Director)
        </strong>
        <span style="font-size:11.5px;color:#ddd6fe;line-height:1.45;">
          Shareholder resolution proposals &amp; voting buttons are enabled for your wallet; Board-only actions remain reserved for active Directors.
        </span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${copyBtn}
      </div>
    `;
    return;
  }

  const myOfficerTitles = state.execSeats
    .filter((s) => s.holders.some((h) => h.addr === myId))
    .map((s) => s.short);

  el.myCompanyRoleBar.style.display = 'flex';
  el.myCompanyRoleBar.style.borderColor = 'rgba(16,185,129,0.35)';
  el.myCompanyRoleBar.style.background = 'rgba(6,40,32,0.36)';
  el.myCompanyRoleBar.innerHTML = `
    <div style="font-size:12px;color:#d1fae5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <strong>🧑‍✈️ Your Verified Standing in ${comp}:</strong>
      ${state.myIsDirector ? '<span class="inst-badge cyan">Active Director ✓</span>' : ''}
      ${state.myIsShareholder ? `<span class="inst-badge green">${fmtNum(myConv)} ${escapeHtml(shareTickerStr())} (${myPctNum.toFixed(1)}% • ${fmtNum(state.myVotes)} votes)</span>` : ''}
      ${myOfficerTitles.map((t) => `<span class="inst-badge amber">${escapeHtml(t)} Officer</span>`).join('')}
      ${state.myHasEsopGrant ? '<span class="inst-badge cyan">ESOP Option Grantee</span>' : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      ${copyBtn}
    </div>
  `;
}

function renderRatificationSpotlight() {
  if (state.charterState !== 1 || !state.firstRes) {
    el.ratifySpotlight.style.display = 'none';
    return;
  }
  el.ratifySpotlight.style.display = 'flex';
  const r = state.firstRes;
  el.ratifyAuthBadge.textContent = `Auth HFS: ${shortAddr(r.authAddr)}`;
  if (el.btnTestInactiveGuard) {
    el.btnTestInactiveGuard.style.display = state.myIsAssociated ? 'inline-flex' : 'none';
  }

  // 1. Render Initial Directors' Personal Consent Checklist (100% Required!)
  const consentedDirs = state.directors.filter((d) => d.consented);
  const unconsentedDirs = state.directors.filter((d) => !d.consented);
  const allDirsConsented = unconsentedDirs.length === 0;
  if (el.ratifyDirConsentLabel) {
    el.ratifyDirConsentLabel.textContent = allDirsConsented
      ? `✓ ${consentedDirs.length} / ${state.directors.length} Directors Consented (100%)`
      : `⏳ ${consentedDirs.length} / ${state.directors.length} Consented (${unconsentedDirs.length} Pending Signature)`;
    el.ratifyDirConsentLabel.style.color = allDirsConsented ? '#6ee7b7' : '#fbbf24';
  }
  if (el.ratifyDirectorChips) {
    el.ratifyDirectorChips.innerHTML = state.directors
      .map(
        (d) => `
        <div class="chr-signer-chip ${d.consented ? 'signed' : ''}">
          <span>${d.avatar}</span>
          <strong>${escapeHtml(d.label)}</strong>
          <span>${d.consented ? '✓ CONSENTED' : '⏳ Pending Director Consent'}</span>
        </div>
      `
      )
      .join('');
  }
  if (el.btnSignDirectorConsent) {
    el.btnSignDirectorConsent.style.display = state.myNeedsDirectorConsent ? 'inline-flex' : 'none';
  }

  // 2. Render Shareholder Super-Majority Votes (≥75% Required)
  const pct = state.totalShares > 0 ? Math.min(100, (r.weight / state.totalShares) * 100) : 0;
  el.ratifyVotesLabel.textContent = `${fmtNum(r.weight)} / ${fmtNum(state.totalShares)} votes (${pct.toFixed(1)}% • Need ≥75.0%)`;
  el.ratifyQuorumFill.style.width = `${pct.toFixed(1)}%`;

  const unsignedAi = (r.signers || []).filter(
    (s) => !s.signed && (session.aiPersonas || []).some((p) => p.identityAddr === s.addr)
  );
  if (el.btnForceAiRatify) el.btnForceAiRatify.style.display = 'none';
  if (r.status === 2 || r.weight >= r.reqWeight) {
    el.ratifyAiStatusText.textContent = allDirsConsented
      ? '🎯 ≥75% Shareholder Quorum + 100% Director Consent Complete! Ready to enact!'
      : `🗳️ ≥75% Shareholder Quorum Reached — awaiting ${unconsentedDirs.map((d) => d.label.split('·')[0].trim()).join(', ')} Director Consent!`;
  } else if (isSimManagedCharter() && unsignedAi.length > 0 && state.myIsShareholder && !r.mySigned) {
    const nextW = r.weight + unsignedAi[0].weight;
    if (nextW >= r.reqWeight) {
      el.ratifyAiStatusText.textContent = `🤖 Backend AI Shareholders signed ${pct.toFixed(1)}% — holding final AI vote so YOU cast the deciding Founder signature!`;
    } else {
      el.ratifyAiStatusText.textContent = `🤖 Backend AI Co-Founders reviewing & signing live on Subnet 1 (${unsignedAi.length} remaining)…`;
    }
  } else {
    el.ratifyAiStatusText.textContent = '🗳️ Shareholder Super-Majority Ratification (≥75% Votes Required)';
  }

  el.ratifySignerChips.innerHTML = (r.signers || [])
    .map((s) => {
      const sPct = state.totalShares > 0 ? ((s.weight / state.totalShares) * 100).toFixed(1) : '0.0';
      return `
        <div class="chr-signer-chip ${s.signed ? 'signed' : ''}">
          <span>${s.avatar}</span>
          <strong>${escapeHtml(s.label)}</strong>
          <span>(${sPct}%)</span>
          <span>${s.signed ? '✓ SIGNED' : '⏳ Pending'}</span>
        </div>
      `;
    })
    .join('');

  el.ratifyScrollBox.innerHTML = buildResolutionTemplate(
    { execKind: 'activateCharter', authAddr: r.authAddr },
    'hydrated'
  );

  const ratifyStanding = getResolutionStandingForMe(r);
  const otherUnconsentedDirs = unconsentedDirs.filter((d) => !d.isMe);
  if (!state.myCanGovern && !state.myNeedsDirectorConsent) {
    el.ratifyHintText.textContent =
      '👀 Read-Only View: Waiting for this company\'s Initial Directors & Founding Shareholders to complete activation.';
  } else if (otherUnconsentedDirs.length > 0 && (r.status === 2 || r.mySigned || !state.myIsShareholder)) {
    el.ratifyHintText.textContent = `🔒 Waiting for ${otherUnconsentedDirs.map((d) => d.label.split('·')[0].trim()).join(', ')} to sign Director Consent before Charter can activate (-96).`;
  } else {
    el.ratifyHintText.innerHTML =
      'Once all Initial Directors consent + ≥75% Shareholders ratify, enact <code>activateCharter(authObj)</code>!';
  }

  if (el.btnSignAndRatify) {
    if (ratifyStanding.canActNow) {
      el.btnSignAndRatify.style.display = 'inline-flex';
      el.btnSignAndRatify.textContent =
        r.status === 2
          ? allDirsConsented
            ? '⚖️ Enact Finalized Resolution & Activate Charter!'
            : '🔒 Enact Charter (Awaiting All Directors\' Consent)'
          : r.mySigned
            ? '⚡ Finalize Quorum & Activate Charter!'
            : '✍️ Sign Shareholder Vote & Activate Charter!';
    } else {
      el.btnSignAndRatify.style.display = 'none';
    }
  }
}

function renderOrgChart() {
  if (!state.phase1Loaded) return;
  if (el.btnQuickAppointExec) {
    if (state.myCanGovern) {
      el.btnQuickAppointExec.style.display = 'inline-flex';
      el.btnQuickAppointExec.textContent =
        state.myIsDirector && state.myIsShareholder
          ? '+ Appoint Director or Executive →'
          : state.myIsDirector
            ? '+ Appoint Executive Officer →'
            : '+ Elect / Remove Director →';
    } else {
      el.btnQuickAppointExec.style.display = 'none';
    }
  }
  const now = Date.now();
  const shCount = state.capRows.filter((r) => r.shares > 0).length;

  const activeDirHtml = state.directors.map((d) => {
    const fl = state.orgFlashes.get(`dir:${d.addr}`);
    const flCls = fl && fl.expiresAt > now ? (fl.kind === 'add' ? 'flash-add' : 'flash-remove') : '';
    const canFire = state.charterState === 2 && state.directors.length > 1 && state.myIsShareholder;
    const awaitingInitConsent = state.charterState === 1 && !d.consented;
    return `
      <div class="org-node director ${flCls}" style="${awaitingInitConsent ? 'border-style:dashed;border-color:rgba(245,158,11,0.65);' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span class="inst-badge ${awaitingInitConsent ? 'amber' : 'cyan'}">${
            awaitingInitConsent ? '⏳ PENDING CONSENT' : 'DIRECTOR ✓'
          }</span>
          ${
            canFire
              ? `<button type="button" class="inst-btn sm rose" data-quick-fire-dir="${d.addr}" style="padding:2px 6px;font-size:10px;" title="Propose Shareholder Resolution to fire this Director">🔥 Fire</button>`
              : awaitingInitConsent && d.isMe && state.myNeedsDirectorConsent
                ? `<button type="button" class="inst-btn sm emerald" data-trigger-director-consent="1" style="padding:2px 7px;font-size:10px;">✍️ Sign Consent</button>`
                : ''
          }
        </div>
        <div style="font-size:13px;font-weight:800;color:#f8fafc;margin-top:2px;">
          ${d.avatar} ${escapeHtml(d.label)}
        </div>
        <div style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">
          ID ${shortAddr(d.addr)}
        </div>
      </div>
    `;
  });

  const pendingDirHtml = state.pendingDirectors.map((p) => {
    const fl = state.orgFlashes.get(`dir:${p.addr}`);
    const flCls = fl && fl.expiresAt > now ? 'flash-add' : '';
    return `
      <div class="org-node director ${flCls}" style="border-style:dashed;border-color:rgba(245,158,11,0.72);background:rgba(120,53,15,0.22);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span class="inst-badge amber">⏳ AWAITING CONSENT</span>
          ${
            p.isMe && state.myNeedsDirectorConsent
              ? `<button type="button" class="inst-btn sm emerald" data-trigger-director-consent="1" style="padding:2px 7px;font-size:10px;">✍️ Accept Seat</button>`
              : !p.isMe && state.myIsShareholder
                ? `<button type="button" class="inst-btn sm rose" data-quick-fire-dir="${p.addr}" style="padding:2px 6px;font-size:10px;" title="Revoke pending nomination">✕</button>`
                : ''
          }
        </div>
        <div style="font-size:13px;font-weight:800;color:#fef3c7;margin-top:2px;">
          ${p.avatar} ${escapeHtml(p.label)}
        </div>
        <div style="font-size:10px;font-family:var(--mono);color:#fcd34d;">
          Elected by ≥75% • Needs Director Signature
        </div>
      </div>
    `;
  });

  const allDirHtml = [...activeDirHtml, ...pendingDirHtml];
  const dirCards = allDirHtml.length
    ? allDirHtml.join('')
    : `<div style="font-size:12px;color:var(--txt-2);">Loading Board of Directors…</div>`;

  const execCards = state.execSeats
    .map((seat) => {
      const fl = state.orgFlashes.get(`role:${seat.roleId.toLowerCase()}`);
      const flCls = fl && fl.expiresAt > now ? (fl.kind === 'add' ? 'flash-add' : 'flash-remove') : '';
      const primary = seat.holders[0];
      if (primary) {
        return `
          <div class="org-node exec-filled ${flCls}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
              <span class="inst-badge green">${seat.icon} ${escapeHtml(seat.short)}</span>
              ${
                state.charterState === 2 && state.myIsDirector
                  ? `<button type="button" class="inst-btn sm" data-quick-revoke-exec="${seat.key}" data-holder="${primary.addr}" style="padding:2px 6px;font-size:9.5px;" title="Board Resolution to dismiss officer">✕</button>`
                  : ''
              }
            </div>
            <div style="font-size:12.5px;font-weight:800;color:#ecfdf5;">
              ${primary.avatar} ${escapeHtml(primary.label)}
            </div>
            <div style="font-size:10px;color:#6ee7b7;font-family:var(--mono);">
              ${escapeHtml(seat.title)}
            </div>
          </div>
        `;
      }
      if (state.myIsDirector) {
        return `
          <div class="org-node exec-vacant ${flCls}" data-quick-appoint-role="${seat.key}" title="Click to draft a Board Resolution appointing ${escapeHtml(seat.short)}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="inst-badge amber">${seat.icon} ${escapeHtml(seat.short)}</span>
              <span style="font-size:10px;color:#fcd34d;font-family:var(--mono);">VACANT</span>
            </div>
            <div style="font-size:11.5px;font-weight:700;color:var(--txt-1);">
              + Appoint ${escapeHtml(seat.short)}
            </div>
            <div style="font-size:10px;color:var(--txt-2);">
              Board Resolution
            </div>
          </div>
        `;
      }
      return `
        <div class="org-node exec-vacant ${flCls}" style="cursor:default;opacity:0.76;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="inst-badge amber">${seat.icon} ${escapeHtml(seat.short)}</span>
            <span style="font-size:10px;color:#fcd34d;font-family:var(--mono);">VACANT</span>
          </div>
          <div style="font-size:11.5px;font-weight:600;color:var(--txt-2);">
            No Officer Appointed
          </div>
          <div style="font-size:10px;color:var(--txt-2);">
            Appointed by Board
          </div>
        </div>
      `;
    })
    .join('');

  el.orgChartMount.innerHTML = `
    <div class="org-tier-label">Tier 1 • Sovereign Shareholder Franchise</div>
    <div class="org-node" style="max-width:360px;text-align:center;align-items:center;border-color:rgba(167,139,250,0.45);background:rgba(30,20,58,0.5);">
      <div style="font-size:12.5px;font-weight:800;color:#ede9fe;">
        🗳️ ${shCount} Voting Shareholder(s) • ${fmtNum(state.totalShares)} ${escapeHtml(shareTickerStr())}
      </div>
      <div style="font-size:10.5px;font-family:var(--mono);color:#c4b5fd;">
        Elects &amp; Removes Directors (≥75% Super-Majority)
      </div>
    </div>
    <div class="org-tier-connector"></div>
    <div class="org-hbar"></div>
    <div class="org-tier-label">Tier 2 • Board of Directors (ROLE_DIRECTOR)</div>
    <div class="org-nodes-row">${dirCards}</div>
    <div class="org-tier-connector"></div>
    <div class="org-hbar"></div>
    <div class="org-tier-label">Tier 3 • Executive C-Suite Officers (Appointed by Board Resolution)</div>
    <div class="org-nodes-row">${execCards}</div>
  `;
}

function renderCapTable() {
  if (!state.phase1Loaded) return;
  const ticker = shareTickerStr();
  const totConv = state.totalConvertedCommon || state.totalShares;
  const holders = state.capRows.filter((r) => r.convCommon > 0);

  // Build SVG Donut Ring
  const R = 36;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = holders.map((h, idx) => {
    const frac = totConv > 0 ? h.convCommon / totConv : 0;
    const len = frac * C;
    const color = DONUT_COLORS[idx % DONUT_COLORS.length];
    const seg = `<circle cx="46" cy="46" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 46 46)" />`;
    offset += len;
    return seg;
  });

  const classPills = state.shareClasses
    .map(
      (c, i) =>
        `<span class="inst-badge ${i === 0 ? 'green' : 'cyan'}" title="AssetLedger ${c.ledger}">${escapeHtml(c.symbol)}: ${fmtNum(c.supply)} sh (${c.convMult}x)</span>`
    )
    .join(' ');

  el.capTableHero.innerHTML = `
    <svg width="92" height="92" viewBox="0 0 92 92" style="flex-shrink:0;">
      <circle cx="46" cy="46" r="${R}" fill="none" stroke="rgba(148,163,184,0.15)" stroke-width="12" />
      ${arcs.join('')}
      <text x="46" y="44" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="800" font-family="JetBrains Mono">${holders.length}</text>
      <text x="46" y="56" text-anchor="middle" fill="#94a3b8" font-size="8.5" font-family="JetBrains Mono">Holders</text>
    </svg>
    <div style="display:flex;flex-direction:column;gap:5px;flex:1;">
      <div style="font-size:13px;font-weight:800;color:#f8fafc;">
        ${fmtNum(totConv)} Converted Common Eq. (${state.shareClasses.length} Share Class${state.shareClasses.length === 1 ? '' : 'es'})
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;">
        ${classPills}
        ${state.esopPrograms.length > 0 ? `<span class="inst-badge amber">🎓 ${state.esopPrograms.length} ESOP Pool(s)</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">
        ${holders
          .slice(0, 5)
          .map(
            (h, idx) => `
            <span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-family:var(--mono);color:var(--txt-1);">
              <span style="width:8px;height:8px;border-radius:50%;background:${DONUT_COLORS[idx % DONUT_COLORS.length]};"></span>
              ${escapeHtml(h.label.split('·')[0].trim())} ${h.pct}%
            </span>
          `
          )
          .join('')}
      </div>
    </div>
  `;

  const now = Date.now();
  el.capTableTbody.innerHTML = state.capRows.length
    ? state.capRows
        .map((r, idx) => {
          const color = DONUT_COLORS[idx % DONUT_COLORS.length];
          const dl = state.capDeltas.get(r.addr);
          const hasDelta = dl && dl.expiresAt > now && dl.delta !== 0;
          const rowCls = hasDelta ? (dl.delta > 0 ? 'cap-row-flash-gain' : 'cap-row-flash-loss') : '';
          const deltaHtml = hasDelta
            ? `<span class="cap-delta-pill ${dl.delta > 0 ? 'up' : 'down'}">${dl.delta > 0 ? `+${fmtNum(dl.delta)} ▲` : `${fmtNum(dl.delta)} ▼`}</span>`
            : '';
          const roleBadges = r.roles.length
            ? r.roles.map((rl) => `<span class="inst-badge ${rl === 'Director' ? 'cyan' : 'green'}">${escapeHtml(rl)}</span>`).join(' ')
            : `<span style="color:var(--txt-2);font-size:10.5px;">Shareholder</span>`;
          const holdingsHtml =
            r.holdings && r.holdings.length
              ? r.holdings
                  .map(
                    (h) =>
                      `<span class="inst-badge ${h.convMult > 1 ? 'cyan' : 'green'}" style="margin-right:3px;">${fmtNum(h.rawShares)} ${escapeHtml(h.symbol)}${h.convMult > 1 ? ` (${h.convMult}x)` : ''}</span>`
                  )
                  .join('')
              : `<span style="color:var(--txt-2);">0 ${escapeHtml(ticker)}</span>`;

          return `
            <tr class="${rowCls}">
              <td style="font-weight:700;color:#f8fafc;">
                ${r.avatar} ${escapeHtml(r.label)}
              </td>
              <td>${roleBadges}</td>
              <td>${holdingsHtml} ${deltaHtml}</td>
              <td style="font-weight:800;color:#e2e8f0;font-family:var(--mono);">
                ${fmtNum(r.convCommon)}
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:8px;">
                  <div class="cap-bar-track" style="flex:1;">
                    <div class="cap-bar-fill" style="width:${Math.min(100, Number(r.pct))}%;background:${color};"></div>
                  </div>
                  <span style="min-width:42px;text-align:right;font-weight:700;">${r.pct}%</span>
                </div>
              </td>
              <td style="color:#6ee7b7;">${fmtNum(r.cash)}</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="6" style="color:var(--txt-2);">Loading Cap Table…</td></tr>`;
}

function renderShareClassesDetails() {
  if (!el.shareClassesTbody || !state.phase1Loaded) return;
  const totConv = Math.max(1, state.totalConvertedCommon || state.totalShares || 1);
  const classes = state.shareClasses.length
    ? state.shareClasses
    : [
        {
          ledger: session.inst?.shareLedger || ZERO_ADDR,
          symbol: shareTickerStr(),
          votesPerShare: 1,
          convNumer: 1,
          convDenom: 1,
          convMult: 1,
          supply: state.totalShares,
        },
      ];

  const classRowsHtml = classes.map((cls, idx) => {
    const isCommon = idx === 0;
    const convEq = Math.floor((cls.supply * (cls.convNumer || 1)) / Math.max(1, cls.convDenom || 1));
    const shareOfCap = ((convEq / totConv) * 100).toFixed(1);
    const voteStr = `${cls.convMult}× Common Conversion • ${cls.votesPerShare * cls.convMult} Vote(s) / sh`;
    const condBadges = isCommon
      ? `<div style="display:flex;flex-wrap:wrap;gap:5px;">
           <span class="inst-badge cyan">≥75% Pre-Emptive Issuance</span>
           <span class="inst-badge amber">3-Step Call Auction + Co-Sale + ROFR</span>
           <span class="inst-badge green">Mandatory SHA</span>
         </div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:5px;">
           <span class="inst-badge cyan">${cls.convMult}× Senior Conversion</span>
           <span class="inst-badge amber">Shareholder ROFR Protected</span>
           <span class="inst-badge green">SHA-Bound Allotment</span>
         </div>`;

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="inst-badge ${isCommon ? 'green' : 'cyan'}">${isCommon ? 'Common Equity' : 'Preferred Equity'}</span>
            <strong style="color:#f8fafc;">${escapeHtml(cls.symbol)}</strong>
          </div>
        </td>
        <td style="font-family:var(--mono);font-size:11.5px;color:#93c5fd;">
          ${cls.ledger && cls.ledger !== ZERO_ADDR ? shortAddr(cls.ledger) : '—'}
        </td>
        <td style="font-family:var(--mono);font-weight:700;">
          ${fmtNum(cls.supply)} sh <span style="color:var(--txt-2);font-weight:500;">(${shareOfCap}%)</span>
        </td>
        <td style="font-size:12px;color:#e2e8f0;">${escapeHtml(voteStr)}</td>
        <td>${condBadges}</td>
      </tr>
    `;
  });

  const esopRowsHtml = state.esopPrograms.map((p) => {
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="inst-badge amber">Employee Options</span>
            <strong style="color:#f8fafc;">${escapeHtml(p.optionSymbol)}</strong>
          </div>
        </td>
        <td style="font-family:var(--mono);font-size:11.5px;color:#93c5fd;">
          ${shortAddr(p.optionLedger)}
        </td>
        <td style="font-family:var(--mono);font-weight:700;">
          ${fmtNum(p.issuedOptions)} vested / ${fmtNum(p.authorizedShares)} pool
        </td>
        <td style="font-size:12px;color:#e2e8f0;">
          Non-voting until exercised • Strike: <strong>${fmtNum(p.exercisePrice)} SGD/sh</strong> → ${escapeHtml(p.underlyingSymbol)}
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            <span class="inst-badge amber">Cliff Block Lock</span>
            <span class="inst-badge cyan">Auto-Vesting Tranches</span>
            <span class="inst-badge green">Exercise Letter + SHA</span>
          </div>
        </td>
      </tr>
    `;
  });

  const futActive = state.futuresLedger && state.futuresLedger !== ZERO_ADDR && state.futuresPct > 0;
  const futRowHtml = `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="inst-badge ${futActive ? 'cyan' : ''}">Share Derivative</span>
          <strong style="color:#f8fafc;">Share-Backed Futures</strong>
        </div>
      </td>
      <td style="font-family:var(--mono);font-size:11.5px;color:#93c5fd;">
        ${futActive ? shortAddr(state.futuresLedger) : 'Not Deployed'}
      </td>
      <td style="font-family:var(--mono);font-weight:700;">
        ${futActive ? `Cap: ${state.futuresPct}% (${fmtNum(state.futuresAllowance.companyCap)} max)` : '0 (Disabled)'}
      </td>
      <td style="font-size:12px;color:#e2e8f0;">
        Non-voting • Backed 1:1 by locked Common Shares
      </td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          <span class="inst-badge cyan">≥75% Cap Authorization</span>
          <span class="inst-badge ${futActive ? 'green' : ''}">Underlying Shares Locked Until Burned</span>
        </div>
      </td>
    </tr>
  `;

  el.shareClassesTbody.innerHTML = [...classRowsHtml, ...esopRowsHtml, futRowHtml].join('');
}

function populateCapSplitsAndBuybacks() {
  if (el.splitsReadonlyNotice) {
    el.splitsReadonlyNotice.style.display = state.myIsShareholder ? 'none' : 'block';
  }
  if (el.splitsActionsGrid) {
    el.splitsActionsGrid.style.display = state.myIsShareholder ? 'grid' : 'none';
  }
  if (!state.myIsShareholder) return;
  const classes = state.shareClasses.length
    ? state.shareClasses
    : [
        {
          ledger: session.inst?.shareLedger || '',
          symbol: shareTickerStr(),
          supply: state.totalShares,
          convMult: 1,
        },
      ];
  const classOpts = classes
    .map(
      (c) =>
        `<option value="${c.ledger}">${escapeHtml(c.symbol)} — ${fmtNum(c.supply)} issued (${c.convMult}×)</option>`
    )
    .join('');

  if (el.selCapSplitClass) {
    const prev = el.selCapSplitClass.value;
    el.selCapSplitClass.innerHTML = classOpts;
    if (prev && classes.some((c) => c.ledger === prev)) el.selCapSplitClass.value = prev;
  }

  if (el.selCapBuybackClass) {
    const prev = el.selCapBuybackClass.value;
    el.selCapBuybackClass.innerHTML = classOpts;
    if (prev && classes.some((c) => c.ledger === prev)) el.selCapBuybackClass.value = prev;
  }

  if (el.selCapBuybackSeller) {
    const pickedLedger = (el.selCapBuybackClass?.value || classes[0]?.ledger || '').toLowerCase();
    const prevSeller = el.selCapBuybackSeller.value;
    const holders = state.capRows.filter((r) =>
      pickedLedger
        ? (r.holdings || []).some((h) => h.ledger === pickedLedger && h.rawShares > 0)
        : r.convCommon > 0
    );
    el.selCapBuybackSeller.innerHTML = holders.length
      ? holders
          .map((h) => {
            const clsHold = (h.holdings || []).find((x) => x.ledger === pickedLedger);
            const bal = clsHold ? clsHold.rawShares : h.convCommon;
            const sym = clsHold ? clsHold.symbol : shareTickerStr();
            return `<option value="${h.addr}">${escapeHtml(`${h.avatar} ${h.label} (${fmtNum(bal)} ${sym})`)}</option>`;
          })
          .join('')
      : `<option value="">No shareholders with balance in selected class</option>`;
    if (prevSeller && holders.some((h) => h.addr === prevSeller)) {
      el.selCapBuybackSeller.value = prevSeller;
    }
  }
}

function renderRelatedMatters() {
  const inst = session.inst || {};
  if (el.relMetaAccounting && inst.accountingLedger) {
    el.relMetaAccounting.textContent = `Accounting ${shortAddr(inst.accountingLedger)}`;
  }
  if (el.relMetaCommerce && inst.productLedger) {
    el.relMetaCommerce.textContent = `Products ${shortAddr(inst.productLedger)}`;
  }
  const activeDex =
    state.attachedDex && state.attachedDex !== ZERO_ADDR ? state.attachedDex : inst.dexClob;
  if (el.relMetaDex && activeDex) {
    el.relMetaDex.textContent = `DEX ${shortAddr(activeDex)}`;
  }
  if (el.relLinkDex && activeDex) {
    el.relLinkDex.href =
      state.attachedDex && state.attachedDex !== ZERO_ADDR
        ? `/dex.html?hfs=${state.attachedDex}`
        : '/dex.html';
  }
  if (el.relMetaSuite && session.manifest?.hfsRegistry) {
    el.relMetaSuite.textContent = `Registry ${shortAddr(session.manifest.hfsRegistry)}`;
  }
  renderCharterAuditGovernance();
}

function renderResolutionsGrid() {
  if (!state.initialLoadComplete) return;
  const isOngoing = (r) =>
    !r.failedBidsStage &&
    (r.status === 1 || r.status === 2) &&
    !(r.isEquityFinancing && r.issPhase === 5 && r.allocSummary && r.allocSummary.pendingShaCount === 0);
  const ongoingCount = state.resolutions.filter(isOngoing).length;
  const pastCount = state.resolutions.filter((r) => !isOngoing(r)).length;

  if (el.resFilterBar) {
    el.resFilterBar.querySelectorAll('[data-res-filter]').forEach((b) => {
      const f = b.getAttribute('data-res-filter');
      b.classList.toggle('active', f === state.resFilter);
      if (f === 'open') b.textContent = `🟢 Current Live Actions (${ongoingCount})`;
      else if (f === 'done') b.textContent = `📜 Executed Past Actions (${pastCount})`;
    });
  }

  const filteredRes = state.resolutions.filter((r) =>
    state.resFilter === 'done' ? !isOngoing(r) : isOngoing(r)
  );

      if (!filteredRes.length) {
    el.resolutionsGrid.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:24px 16px !important;color:var(--txt-2);font-size:13px;">
          ${
            state.charterState === 1
              ? 'Complete the <strong>Company Activation Checklist</strong> at the top first to unlock corporate actions.'
              : state.resFilter === 'open'
                ? `${
                    state.myCanGovern
                      ? 'No live corporate actions awaiting signatures right now — choose any volume on the <strong>Corporate Legal Library</strong> shelf above to issue one'
                      : 'No live corporate actions awaiting signatures right now'
                  }${
                    pastCount > 0
                      ? `, or <button type="button" class="inst-btn sm" data-res-filter="done" style="margin-left:6px;">📜 View ${pastCount} Executed Past Action${pastCount === 1 ? '' : 's'}</button>`
                      : '.'
                  }`
                : 'No executed past corporate actions recorded yet.'
          }
        </td>
      </tr>
    `;
    return;
  }

  el.resolutionsGrid.innerHTML = filteredRes
    .map((r) => {
      const blk = session.blockNumber;
      const inStage0Bids =
        r.isIssuanceAuction &&
        !r.failedBidsStage &&
        r.status === 1 &&
        (r.currentStage === 0 || (r.step1Dl > 0 && blk <= r.step1Dl));

      const eqTarget = r.targetShares || r.maxNewShares || 1;
      const eqOfferPx = r.offerPrice || r.minIssuePrice || 1;
      const eqSubQty = r.subscribedAtOrAboveOffer || 0;
      const strictAboveOrders = (r.issuanceOrders || []).filter((o) => o.side === 1 && o.price > eqOfferPx);
      const strictAboveQty = strictAboveOrders.reduce((s, o) => s + o.quantity, 0);
      const isOversubscribed = r.isEquityFinancing && strictAboveQty > eqTarget;
      const lowestAboveBidPx = strictAboveOrders.length
        ? Math.min(...strictAboveOrders.map((o) => o.price))
        : eqOfferPx;

      const pctBar =
        r.status === 4
          ? 100
          : r.failedBidsStage
            ? 0
            : inStage0Bids
              ? r.isEquityFinancing
                ? Math.min(48, Math.round((eqSubQty / Math.max(1, eqTarget)) * 48))
                : Math.min(48, r.activeStep1Bids > 0 ? 45 : 15)
              : Math.min(100, Math.round((r.weight / Math.max(1, r.reqWeight)) * 100));

      let statusBadge = `<span class="inst-badge amber">SIGNING LIVE (${fmtNum(r.weight)}/${fmtNum(r.reqWeight)})</span>`;
      if (r.failedBidsStage) {
        statusBadge = r.isEquityFinancing
          ? `<span class="inst-badge red">🚫 FAILED — UNDER-SUBSCRIBED (${fmtNum(eqSubQty)}/${fmtNum(eqTarget)}, -97)</span>`
          : `<span class="inst-badge red">🚫 FAILED — 0 BIDS IN BIDS STAGE (-97)</span>`;
      } else if (inStage0Bids) {
        statusBadge = r.isEquityFinancing
          ? `<span class="inst-badge ${eqSubQty >= eqTarget ? 'green' : 'amber'}">STEP 1 SSA BIDS (${fmtNum(eqSubQty)}/${fmtNum(eqTarget)} sh)</span>`
          : `<span class="inst-badge ${r.activeStep1Bids > 0 ? 'green' : 'amber'}">STAGE 0 BIDS (${r.activeStep1Bids} Bid${r.activeStep1Bids === 1 ? '' : 's'})</span>`;
      } else if (r.status === 2) {
        statusBadge = `<span class="inst-badge cyan">FINALIZED — READY TO ENACT</span>`;
      } else if (r.status === 4) {
        statusBadge = `<span class="inst-badge green">✓ ENACTED &amp; CONSUMED</span>`;
      } else if (r.status === 3) {
        statusBadge = `<span class="inst-badge red">EXPIRED</span>`;
      }

      const myStanding = getResolutionStandingForMe(r);
      const myLow = activeVerifiedIdentityLow();
      const canRefundIss =
        state.myCanGovern ||
        Boolean(myLow && (r.issuanceOrders || []).some((o) => o.trader === myLow));

      let issuanceStrip = '';
      if (r.isEquityFinancing && r.issPhase >= 1) {
        const clsTag = escapeHtml(
          r.classLabel ||
            (r.eqClassCode === 0 ? 'Common Shares' : `Preferred (${r.eqConvRate}x)`)
        );
        const ph = r.issPhase;
        const sum = r.allocSummary;
        const myAllot = r.myPendingShaAllot;
        let stepDesc = '';
        if (ph === 9 || r.failedBidsStage) {
          statusBadge = `<span class="inst-badge red">🚫 FAILED — 0 BIDS / SHORTFALL (-97)</span>`;
          stepDesc = `<strong style="color:#fca5a5;">🚫 Issuance Failed (-97):</strong> Zero bids in Step 2 or total demand &lt; ${fmtNum(eqTarget)} ${clsTag} — rejected by <code>CorporateCharter</code>.`;
        } else if (ph === 1) {
          statusBadge = `<span class="inst-badge amber">STEP 1/5: ≥75% RESOLUTION (${fmtNum(r.weight)}/${fmtNum(r.reqWeight)})</span>`;
          stepDesc = `<strong>1️⃣ Step 1 (Shareholder Resolution ≥75%):</strong> Voting to authorize <strong>${fmtNum(eqTarget)} ${clsTag}</strong> @ ≥ ${fmtNum(eqOfferPx)} SGD.`;
        } else if (ph === 2) {
          const rem = Math.max(0, r.step1Dl - blk);
          statusBadge = `<span class="inst-badge cyan">STEP 2/5: INVESTOR BIDDING (${r.activeStep1Bids} Bid${r.activeStep1Bids === 1 ? '' : 's'})</span>`;
          stepDesc = `<strong>2️⃣ Step 2 (Prospective Investor Bidding):</strong> ${rem} blk(s) left (#${fmtNum(r.step1Dl)}) • ${r.activeStep1Bids} bidder(s) placed so far (≥1 required!).`;
        } else if (ph === 3) {
          const rem = Math.max(0, r.step2Dl - blk);
          statusBadge = `<span class="inst-badge green">STEP 3/5: SHAREHOLDER ROFR (${rem} blk)</span>`;
          stepDesc = `<strong>3️⃣ Step 3 (Existing Shareholder ROFR):</strong> ${rem} blk(s) left (#${fmtNum(r.step2Dl)}) • Existing shareholders prioritized 100% @ P* = ${fmtNum(r.projectedClearingPrice)} SGD!`;
        } else if (ph === 4) {
          statusBadge = `<span class="inst-badge cyan">STEP 4/5: DETERMINING ALLOCATION…</span>`;
          stepDesc = `<strong>4️⃣ Step 4 (ROFR Priority &amp; Pro-Rata Allocation):</strong> Simulator periodic runner executing <code>determineIssuanceAllocation</code>…`;
        } else if (ph === 5) {
          const pend = sum ? sum.pendingShaCount : 0;
          statusBadge =
            pend > 0
              ? `<span class="inst-badge amber">STEP 5/5: AWAITING ${pend} SHA SIGNATURE(S)</span>`
              : `<span class="inst-badge green">✓ ALL 5 STEPS COMPLETE — CAP TABLE UPDATED!</span>`;
          stepDesc = sum
            ? `<strong>5️⃣ Step 5 (SHA &amp; Mint):</strong> Cleared <strong>${fmtNum(sum.targetShares)} ${clsTag} @ ${fmtNum(sum.clearingPrice)} SGD</strong> (ROFR: ${fmtNum(sum.rofrAllocated)}, Bidders: ${fmtNum(sum.biddersAllocated)}) • ${pend > 0 ? `<strong>${pend} new shareholder(s) awaiting SHA signature!</strong>` : '<strong style="color:#6ee7b7;">All shares minted on Cap Table!</strong>'}`
            : `<strong>5️⃣ Step 5:</strong> Allocation determined on ShareCapital.`;
        }
        issuanceStrip = `
          <div style="padding:9px 10px;border-radius:9px;background:rgba(14,165,233,0.13);border:1px solid rgba(56,189,248,0.42);font-size:11px;color:#e0f2fe;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>${stepDesc}</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${
                myAllot && !myAllot.claimed
                  ? `<button type="button" class="inst-btn sm emerald" data-claim-issuance-sha="${r.authAddr}">✍️ Sign SHA &amp; Claim ${fmtNum(myAllot.shares)} sh</button>`
                  : ''
              }
              <button type="button" class="inst-btn sm primary" data-open-issuance-arena="${r.authAddr}">💰 Open 5-Step Arena →</button>
            </div>
          </div>
        `;
      } else if (r.isEquityFinancing) {
        const clsTag =
          r.eqClassCode === 1
            ? `Preferred A (${r.eqConvRate}x)`
            : r.eqClassCode === 2
              ? `Preferred B (${r.eqConvRate}x)`
              : 'Common (1x)';
        if (r.failedBidsStage) {
          issuanceStrip = `
            <div style="padding:8px 10px;border-radius:9px;background:rgba(127,29,29,0.42);border:1px solid rgba(248,113,113,0.55);font-size:11px;color:#fecaca;line-height:1.45;display:flex;flex-direction:column;gap:6px;">
              <div>
                <strong>🚫 Financing Failed (-97 Shortfall):</strong> Step 1 closed at Block #${fmtNum(r.step1Dl)} with <strong>${fmtNum(eqSubQty)} / ${fmtNum(eqTarget)} ${escapeHtml(clsTag)}</strong> subscribed at ≥ ${fmtNum(eqOfferPx)} SGD. Blocked from Step 2 &amp; rejected by <code>CorporateCharter.validateCapitalProcessAuth</code>!
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${canRefundIss ? `<button type="button" class="inst-btn sm rose" data-refund-issuance="${r.authAddr}">↩️ Refund Escrowed Cash</button>` : ''}
              </div>
            </div>
          `;
        } else if (inStage0Bids) {
          const rem0 = Math.max(0, r.step1Dl - blk);
          issuanceStrip = `
            <div style="padding:9px 10px;border-radius:9px;background:rgba(14,165,233,0.14);border:1px solid rgba(56,189,248,0.42);font-size:11px;color:#e0f2fe;display:flex;flex-direction:column;gap:7px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <span>
                  <strong>1️⃣ Step 1 (Investor SSA + Buy Orders):</strong> ${rem0} blk(s) left (#${fmtNum(r.step1Dl)}) • Offer <strong>${fmtNum(eqTarget)} ${escapeHtml(clsTag)} @ ≥ ${fmtNum(eqOfferPx)} SGD</strong>
                </span>
                <span style="color:${eqSubQty >= eqTarget ? '#6ee7b7' : '#fcd34d'};font-weight:800;">
                  ${
                    isOversubscribed
                      ? `🔥 Oversubscribed (${fmtNum(strictAboveQty)} sh > ${fmtNum(eqOfferPx)} SGD → Lowest Bid P*=${fmtNum(lowestAboveBidPx)} SGD Pro-Rata!)`
                      : eqSubQty >= eqTarget
                        ? `✓ Full Target Subscribed (${fmtNum(eqSubQty)}/${fmtNum(eqTarget)} sh)`
                        : `⏳ Subscribed: ${fmtNum(eqSubQty)} / ${fmtNum(eqTarget)} sh (Full target req!)`
                  }
                </span>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <input class="inst-input" type="number" min="1" value="${Math.max(100, Math.ceil(eqTarget * 0.25))}" id="inpSubQty_${r.authAddr}" style="width:92px;padding:4px 7px;font-size:11px;" title="Subscription Shares" />
                <span style="font-family:var(--mono);font-size:10.5px;">sh @</span>
                <input class="inst-input" type="number" min="${eqOfferPx}" value="${eqOfferPx + 4}" id="inpSubPx_${r.authAddr}" style="width:80px;padding:4px 7px;font-size:11px;" title="Bid Price (≥ Offer Price)" />
                <span style="font-family:var(--mono);font-size:10.5px;">SGD</span>
                <button type="button" class="inst-btn sm primary" data-sub-eqf="${r.authAddr}" data-offer-px="${eqOfferPx}">
                  ✍️ Sign SSA &amp; Place Buy Order
                </button>
                <button type="button" class="inst-btn sm" data-view-ssa="${r.authAddr}">📄 SSA</button>
              </div>
            </div>
          `;
        } else if (r.status === 1 || r.status === 2) {
          const rem1 = Math.max(0, r.step2Dl - blk);
          issuanceStrip = `
            <div style="padding:9px 10px;border-radius:9px;background:rgba(6,40,32,0.48);border:1px solid rgba(16,185,129,0.42);font-size:11px;color:#d1fae5;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <span>
                <strong>2️⃣ Step 2 (Shareholders' Agreement Ratification):</strong> ${rem1} blk(s) left (#${fmtNum(r.step2Dl)}) •
                ${
                  isOversubscribed
                    ? `Oversubscribed → Clearing at lowest >offer bid <strong>${fmtNum(lowestAboveBidPx)} SGD</strong> pro-rata for exact <strong>${fmtNum(eqTarget)} ${escapeHtml(clsTag)}</strong>!`
                    : `Clearing <strong>${fmtNum(eqTarget)} ${escapeHtml(clsTag)}</strong> onto Cap Table!`
                }
              </span>
              <button type="button" class="inst-btn sm cyan" data-view-sha="${r.authAddr}">📄 View SHA</button>
            </div>
          `;
        }
      } else if (r.isIssuanceAuction) {
        if (r.failedBidsStage) {
          issuanceStrip = `
            <div style="padding:8px 10px;border-radius:9px;background:rgba(127,29,29,0.42);border:1px solid rgba(248,113,113,0.55);font-size:11px;color:#fecaca;line-height:1.45;">
              <strong>🚫 Process Failed (ERR_NO_BIDS_IN_STAGE = -97):</strong> Stage 0 expired at Block #${fmtNum(r.step1Dl)} with <strong>0 Subscription Bids</strong> (Floor: ${fmtNum(r.minIssuePrice)} SGD). Locked from Stage 1 voting &amp; rejected by <code>CorporateCharter.validateCapitalProcessAuth</code>!
            </div>
          `;
        } else if (inStage0Bids) {
          const rem0 = Math.max(0, r.step1Dl - blk);
          issuanceStrip = `
            <div style="padding:8px 10px;border-radius:9px;background:rgba(14,165,233,0.14);border:1px solid rgba(56,189,248,0.42);font-size:11px;color:#e0f2fe;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <span>
                <strong>1️⃣ Stage 0 (Bids Stage):</strong> ${rem0} blk(s) left (#${fmtNum(r.step1Dl)}) •
                ${
                  r.activeStep1Bids > 0
                    ? `<strong style="color:#6ee7b7;">✓ ${r.activeStep1Bids} Bid(s) Placed (Gate Met!)</strong>`
                    : `<strong style="color:#fcd34d;">⚠️ ≥1 Bid Required Before #${fmtNum(r.step1Dl)}!</strong>`
                }
              </span>
              <button type="button" class="inst-btn sm primary" data-bid-issuance="${r.authAddr}" data-min-px="${r.minIssuePrice}">
                💵 Bid @ ${fmtNum(r.minIssuePrice + 5)} SGD
              </button>
            </div>
          `;
        } else if (r.status === 1 || r.status === 2) {
          const rem1 = Math.max(0, r.step2Dl - blk);
          issuanceStrip = `
            <div style="padding:8px 10px;border-radius:9px;background:rgba(6,40,32,0.45);border:1px solid rgba(16,185,129,0.42);font-size:11px;color:#d1fae5;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <span>
                <strong>2️⃣ Stage 1 Unlocked (✓ ${r.activeStep1Bids} Stage-0 Bid${r.activeStep1Bids === 1 ? '' : 's'}):</strong> Pre-Emptive Rights &amp; ≥75% Vote (${rem1} blk(s) left, #${fmtNum(r.step2Dl)})
              </span>
              ${
                state.myVotes > 0 && r.status === 1 && rem1 > 0
                  ? `<button type="button" class="inst-btn sm faucet" data-bid-issuance="${r.authAddr}" data-min-px="${r.minIssuePrice + 8}">🛡️ Pre-Emptive Bid</button>`
                  : ''
              }
            </div>
          `;
        }
      }

      const signerMini = (r.signers || []).length && !inStage0Bids && !r.failedBidsStage
        ? `<div style="display:flex;flex-wrap:wrap;gap:5px;">${r.signers
            .map(
              (s) =>
                `<span class="inst-badge ${s.signed ? 'green' : 'amber'}" style="font-size:9.5px;">${s.avatar} ${escapeHtml(
                  s.label.split('·')[0].trim()
                )} ${s.signed ? '✓' : '…'}</span>`
            )
            .join('')}</div>`
        : '';

      const quorumText = inStage0Bids
        ? r.isEquityFinancing
          ? `Subscribed: ${fmtNum(eqSubQty)} / ${fmtNum(eqTarget)} sh`
          : `Stage 0 Bids: ${r.activeStep1Bids} (≥1 req)`
        : `${fmtNum(r.weight)} / ${fmtNum(r.reqWeight)} votes (${pctBar}%)`;

      const actionCellHtml = myStanding.canActNow
        ? `<button type="button" class="inst-btn sm emerald" data-sign-exec="${r.authAddr}">${myStanding.btnText}</button>`
        : myStanding.readonlyBadgeHtml
          ? myStanding.readonlyBadgeHtml
          : r.failedBidsStage
            ? `<div style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                 <span class="inst-badge red">🚫 Rejected (-97)</span>
                 ${state.myCanGovern ? `<button type="button" class="inst-btn sm" data-test-revert="${r.authAddr}">🧪 Verify</button>` : ''}
               </div>`
            : inStage0Bids
              ? `<span class="inst-badge cyan">⏳ Collecting Bids (#${fmtNum(r.step1Dl)})</span>`
              : r.status === 3
                ? `<span class="inst-badge red">⏰ Expired</span>`
                : statusBadge;

      return `
        <tr>
          <td>
            <div style="font-weight:800;font-size:13.5px;color:#f8fafc;margin-bottom:3px;">
              ${escapeHtml(r.title)}
            </div>
            <div style="font-size:12px;color:var(--txt-2);line-height:1.42;">
              ${escapeHtml(r.summary)}
            </div>
            ${issuanceStrip ? `<div style="margin-top:8px;">${issuanceStrip}</div>` : ''}
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-start;">
              <span class="inst-badge ${r.isBoard ? 'green' : 'cyan'}">${escapeHtml(
                r.category || (r.isBoard ? 'Board Vote' : '≥75% Shareholders')
              )}</span>
              <span style="font-family:var(--mono);font-size:11px;color:var(--txt-2);">
                HFS ${shortAddr(r.authAddr)}
              </span>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:#cbd5e1;">
                <span>${escapeHtml(quorumText)}</span>
              </div>
              <div class="res-progress-track">
                <div class="res-progress-fill" style="width:${pctBar}%;"></div>
              </div>
              ${signerMini}
            </div>
          </td>
          <td>
            <button type="button" class="inst-btn sm" data-view-scroll="${r.authAddr}">
              📄 Read Doc
            </button>
          </td>
          <td style="text-align:right;">
            ${actionCellHtml}
          </td>
        </tr>
      `;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Action Studio & Formal Resolution Composer (Tab 2) + ESOP Tab (Tab 5)
// ---------------------------------------------------------------------------

function populateActionShareClassDropdown() {
  if (!el.selActionShareClass) return;
  const prev = el.selActionShareClass.value;
  const classes = state.shareClasses.length
    ? state.shareClasses
    : [{ ledger: session.inst?.shareLedger || '', symbol: shareTickerStr(), supply: state.totalShares, convMult: 1 }];
  el.selActionShareClass.innerHTML = classes
    .map(
      (c) =>
        `<option value="${c.ledger}">${escapeHtml(c.symbol)} — ${fmtNum(c.supply)} issued (${c.convMult}x Common/Votes)</option>`
    )
    .join('');
  if (prev && classes.some((c) => c.ledger === prev)) {
    el.selActionShareClass.value = prev;
  }
}

function populateActionTargetDropdown() {
  const kind = state.selectedActionKind;
  let options = [];

  if (kind === 'removeDirector') {
    options = [
      ...state.directors.map((d) => ({ addr: d.addr, label: `${d.avatar} ${d.label} (Active Director)` })),
      ...state.pendingDirectors.map((p) => ({ addr: p.addr, label: `${p.avatar} ${p.label} (Pending Consent)` })),
    ];
  } else if (kind === 'shareBuyback') {
    const selectedLed = (el.selActionShareClass?.value || session.inst?.shareLedger || '').toLowerCase();
    options = state.capRows
      .map((r) => {
        const h = (r.holdings || []).find((x) => x.ledger === selectedLed);
        return h && h.rawShares > 0
          ? { addr: r.addr, label: `${r.avatar} ${r.label} (${fmtNum(h.rawShares)} ${h.symbol})` }
          : null;
      })
      .filter(Boolean);
    options.push({ addr: '__custom__', label: '➕ External Shareholder Identity HFS Address (0x…)' });
  } else if (kind === 'revokeExec') {
    const roleKey = el.selExecRole.value;
    const seat = state.execSeats.find((s) => s.key === roleKey);
    options = (seat?.holders || []).map((h) => ({ addr: h.addr, label: `${h.avatar} ${h.label} (${seat.short})` }));
  } else if (kind === 'addDirector') {
    const dirSet = new Set([
      ...state.directors.map((d) => d.addr),
      ...state.pendingDirectors.map((p) => p.addr),
    ]);
    const pool = [
      ...(session.myIdentityAddr ? [{ addr: session.myIdentityAddr.toLowerCase(), label: session.labelForIdentity(session.myIdentityAddr) }] : []),
      ...(session.aiPersonas || []).map((p) => ({ addr: p.identityAddr, label: `${p.avatar} ${p.displayLabel} — ${p.roleBio}` })),
      ...(isBaseLegacyCharter()
        ? (session.inst?.actors || [])
            .filter((a) => a.key === 'candDir3')
            .map((a) => ({ addr: a.identityAddr.toLowerCase(), label: a.name }))
        : []),
    ];
    options = [
      ...pool.filter((x) => !dirSet.has(x.addr)),
      { addr: '__custom__', label: '➕ External Human Identity HFS Address (0x…)' },
    ];
  } else if (kind === 'serviceContract') {
    const insiderSet = new Set([
      ...state.directors.map((d) => d.addr.toLowerCase()),
      ...state.capRows
        .filter((r) => state.totalConvertedCommon > 0 && r.convCommon * 20 >= state.totalConvertedCommon)
        .map((r) => r.addr.toLowerCase()),
    ]);
    const poolIds = session.inst?.userOnboardingPool || [];
    const clientLabels = {
      5: '🛡️ Ministry of Defence — Tactical C2 Procurement',
      6: '🔬 Semtech / RISC-V Sovereign ASIC Partner',
      7: '⚡ National Power & Water SCADA Authority',
      3: '⚓ Maritime Port Autonomous DvP Authority',
      4: '🏦 Sovereign Central Bank CBDC Taskforce',
    };
    const presetClients = [5, 6, 7, 3, 4]
      .filter((idx) => poolIds[idx] && !insiderSet.has(poolIds[idx].toLowerCase()))
      .map((idx) => ({
        addr: poolIds[idx].toLowerCase(),
        label: `${clientLabels[idx]} (${shortAddr(poolIds[idx])})`,
      }));
    const myLow = (session.myIdentityAddr || '').toLowerCase();
    options = [
      ...presetClients,
      ...(myLow && !insiderSet.has(myLow)
        ? [{ addr: myLow, label: `🧑‍✈️ ${session.labelForIdentity(myLow)} (Arm's-Length Client — Co-Sign with Your Wallet)` }]
        : []),
      { addr: '__custom__', label: '➕ External Arm\'s-Length Client Identity Address (0x…)' },
    ];
  } else {
    const pool = [
      ...(session.myIdentityAddr ? [{ addr: session.myIdentityAddr.toLowerCase(), label: `🧑‍✈️ ${session.labelForIdentity(session.myIdentityAddr)}` }] : []),
      ...(session.aiPersonas || []).map((p) => ({ addr: p.identityAddr, label: `${p.avatar} ${p.displayLabel} (${p.defaultExec} Specialty)` })),
      { addr: '__custom__', label: '➕ External Human Identity HFS Address (0x…)' },
    ];
    options = pool;
  }

  const prev = el.selTargetIdentity.value;
  el.selTargetIdentity.innerHTML = options.length
    ? options.map((o) => `<option value="${o.addr}">${escapeHtml(o.label)}</option>`).join('')
    : `<option value="">No eligible candidate available</option>`;
  if (prev && options.some((o) => o.addr === prev)) {
    el.selTargetIdentity.value = prev;
  }
  if (el.fieldCustomTargetWrap) {
    el.fieldCustomTargetWrap.style.display = el.selTargetIdentity.value === '__custom__' ? 'flex' : 'none';
  }
}

function resolveSelectedStudioTarget() {
  const sel = el.selTargetIdentity?.value || '';
  if (sel === '__custom__') {
    return (el.inpCustomTargetIdentity?.value || '').trim().toLowerCase();
  }
  return sel || session.myIdentityAddr || '';
}

function populateStudioIssueAssetDropdown() {
  if (!el.selIssueAssetClass) return;
  const prev = el.selIssueAssetClass.value;
  const existingPrefs = state.shareClasses.filter((_, i) => i > 0);
  el.selIssueAssetClass.innerHTML = [
    `<option value="COMMON">Existing Common Shares (${escapeHtml(shareTickerStr())} • 1x Common &amp; Votes)</option>`,
    ...existingPrefs.map(
      (c) =>
        `<option value="${c.ledger}">Existing ${escapeHtml(c.symbol)} (${c.convMult}x Common &amp; Votes)</option>`
    ),
    `<option value="CUSTOM_PREFERRED">➕ New Preferred Shares (Custom Name: Pref A, B, X, Z…)</option>`,
  ].join('');
  if (prev && Array.from(el.selIssueAssetClass.options).some((o) => o.value === prev)) {
    el.selIssueAssetClass.value = prev;
  }
}

function renderEquityDerivedEconomics() {
  if (!el.equityDerivedEconomicsBox) return;
  const clsKey = el.selIssueAssetClass?.value || 'COMMON';
  const existingObj = state.shareClasses.find((c) => c.ledger === clsKey);
  if (el.fieldIssueCustomClassWrap) {
    el.fieldIssueCustomClassWrap.style.display = clsKey === 'CUSTOM_PREFERRED' ? 'flex' : 'none';
  }
  if (el.inpIssueConversionRate) {
    if (clsKey === 'COMMON') {
      el.inpIssueConversionRate.value = '1';
      el.inpIssueConversionRate.disabled = true;
    } else if (existingObj) {
      el.inpIssueConversionRate.value = String(Math.max(1, Math.round(existingObj.convMult)));
      el.inpIssueConversionRate.disabled = true;
    } else {
      el.inpIssueConversionRate.disabled = false;
      if (Number(el.inpIssueConversionRate.value) < 1) el.inpIssueConversionRate.value = '1';
    }
  }
  const convRate =
    clsKey === 'COMMON'
      ? 1
      : existingObj
        ? Math.max(1, Math.round(existingObj.convMult))
        : Math.max(1, Math.floor(Number(el.inpIssueConversionRate?.value) || 1));
  const minRaise = Math.max(1000, Math.floor(Number(el.inpIssueMinRaise?.value) || 1000000));
  const maxOwnPct = Math.max(0.5, Math.min(90, Number(el.inpIssueMaxOwnershipPct?.value) || 20));
  const derived = computeDerivedEquityFinancingTerms({
    preMoneyCommon: state.totalConvertedCommon || state.totalShares || 100000,
    conversionRate: convRate,
    minRaiseAmount: minRaise,
    maxOwnershipBps: Math.round(maxOwnPct * 100),
  });
  const labelPreview =
    clsKey === 'COMMON'
      ? 'Common Shares'
      : existingObj
        ? existingObj.symbol
        : (el.inpIssueCustomClassName?.value || 'Preferred A').trim();
  el.equityDerivedEconomicsBox.innerHTML = `
    <div>📐 <strong>Derived 5-Step Offering (${escapeHtml(labelPreview)})</strong> • Pre-Money: ${fmtNum(derived.preMoneyCommon)} Common Eq.:</div>
    <div>• Exact New Shares to Issue: <strong style="color:#6ee7b7;">${fmtNum(derived.targetShares)} shares</strong> (= ${fmtNum(derived.newCommonEq)} Common Eq. &amp; Votes • ${derived.actualOwnPct}% post-money)</div>
    <div>• Minimum Offer Price / Share: <strong style="color:#7dd3fc;">${fmtNum(derived.offerPrice)} SGD / share</strong> (Target Raise: ${fmtNum(minRaise)} SGD)</div>
  `;
}

function renderSvcDerivedSummary() {
  if (!el.svcDerivedSummaryBox) return;
  const code = String(el.inpSvcCode?.value || 'DEF-MOD-FLRC-C2').trim() || 'DEF-MOD-FLRC-C2';
  const mo = Math.max(1000, Math.floor(Number(el.inpSvcMonthly?.value) || 180000));
  const term = Math.max(2, Math.min(120, Math.floor(Number(el.inpSvcMonths?.value) || 12)));
  const blks = Math.max(10, Math.floor(Number(el.inpSvcMonthBlocks?.value) || 35));
  const totalVal = mo * term;
  el.svcDerivedSummaryBox.innerHTML = `
    <div>🛡️ <strong>3-Stage Constitutional &amp; IFRS 15 Lifecycle (${escapeHtml(code)})</strong>:</div>
    <div>• <strong>Stage 1 (Signing):</strong> Books <strong style="color:#22d3ee;">+${fmtNum(totalVal)} SGD</strong> in <code>1800 Future Contract Receivables</code> &amp; immediately lifts live DCF/EBO Valuation!</div>
    <div>• <strong>Stage 2 (Every ${fmtNum(blks)} blks):</strong> Generates <strong style="color:#fbbf24;">${fmtNum(mo)} SGD/mo</strong> <code>1100 Current Receivable</code> invoice + <code>4000 Operating Revenue</code></div>
    <div>• <strong>Stage 3 (Bank Oracle):</strong> Settles <strong style="color:#6ee7b7;">+${fmtNum(mo)} SGD/mo</strong> into <code>1010 Current Cash</code> + Operating Cash Flow (<code>CFO</code>)</div>
  `;
}

function renderActionStudioState() {
  if (el.btnJumpNewResolution) {
    el.btnJumpNewResolution.style.display = state.myCanGovern ? 'inline-flex' : 'none';
  }
  if (!state.myCanGovern) {
    if (el.legalLibraryShelfWrap) el.legalLibraryShelfWrap.style.display = 'none';
    if (el.legalDocumentDesk) el.legalDocumentDesk.hidden = true;
    if (el.actionsLockedNotice) el.actionsLockedNotice.style.display = 'none';
    if (el.actionsObserverNotice) {
      el.actionsObserverNotice.style.display = 'block';
      el.actionsObserverNotice.innerHTML = `
        👀 <strong>Read-Only Corporate Actions Register:</strong> Your wallet keypair &amp; Identity is not a registered Director or Shareholder of <strong>${escapeHtml(companyNameStr())}</strong>, so drafting &amp; signing corporate resolutions is hidden. You can inspect all live and historical resolutions below and read their full legal texts.
      `;
    }
    return;
  }

  if (el.actionsObserverNotice) {
    el.actionsObserverNotice.style.display = 'none';
  }
  if (el.legalLibraryShelfWrap) {
    el.legalLibraryShelfWrap.style.display = 'block';
  }

  // Ensure selectedActionKind matches a volume this user actually has standing to propose
  if (!canProposeActionKind(state.selectedActionKind)) {
    state.selectedActionKind = state.myIsDirector ? 'appointExec' : 'addDirector';
  }

  populateActionShareClassDropdown();
  if (el.selTargetIdentity && el.selTargetIdentity.options.length <= 1) {
    populateActionTargetDropdown();
  }
  if (el.legalDocumentDesk) {
    el.legalDocumentDesk.hidden = !state.legalBookOpen;
  }
  const kind = state.selectedActionKind;
  if (el.actionTypePicker) {
    el.actionTypePicker.querySelectorAll('.action-pick-card').forEach((c) => {
      const cardKind = c.getAttribute('data-action-kind');
      const allowed = canProposeActionKind(cardKind);
      c.style.display = allowed ? '' : 'none';
      const match = allowed && state.legalBookOpen && cardKind === kind;
      c.classList.toggle('selected', match);
      if (match && el.openVolumeTitle && c.getAttribute('data-book-title')) {
        el.openVolumeTitle.textContent = c.getAttribute('data-book-title');
      }
    });
  }
  const locked = state.charterState === 1;
  el.actionsLockedNotice.style.display = locked ? 'flex' : 'none';
  el.btnDeployActionRes.disabled = locked || state.busy || !canProposeActionKind(kind);
  const isBoard = kind === 'appointExec' || kind === 'revokeExec' || kind === 'serviceContract';
  const useV4Equity = kind === 'issueShares' && state.supportsV4Governance && state.supportsIssuanceAuction;
  const useV3Issuance = kind === 'issueShares' && !useV4Equity && state.supportsIssuanceAuction;
  const needsShareClassPicker =
    kind === 'shareBuyback' || kind === 'shareSplit' || kind === 'reverseShareSplit';
  const needsTargetIdentity =
    kind === 'appointExec' ||
    kind === 'revokeExec' ||
    kind === 'addDirector' ||
    kind === 'removeDirector' ||
    kind === 'shareBuyback' ||
    kind === 'setTreasury' ||
    kind === 'serviceContract' ||
    (kind === 'issueShares' && !useV4Equity && !useV3Issuance);

  el.studioPolicyBadge.textContent = isBoard
    ? 'Board Vote'
    : useV4Equity
      ? '5-Step Funding (≥75%)'
      : useV3Issuance
        ? 'Bids + ≥75% Vote'
        : '≥75% Shareholder Vote';
  el.studioPolicyBadge.className = `inst-badge ${isBoard ? 'green' : 'cyan'}`;

  if (el.lblTargetIdentity) {
    const lblMap = {
      appointExec: 'Who are you appointing?',
      revokeExec: 'Which executive are you removing?',
      addDirector: 'Who are you nominating to the Board?',
      removeDirector: 'Which Director are you removing?',
      shareBuyback: 'Shareholder selling shares back (voluntary)',
      setTreasury: 'New Company Treasury Account',
      serviceContract: 'Arm\'s-Length Client Counterparty (IAS 24 Verified — Insiders Blocked)',
    };
    el.lblTargetIdentity.textContent = lblMap[kind] || 'Select Person or Account';
  }

  if (el.studioPlainExplainer) {
    const expMap = {
      appointExec:
        '<strong>Who approves:</strong> Board of Directors. <strong>What happens:</strong> Assigns a C-Suite role (CEO, COO, CTO, CFO, or CPO) and updates the Leadership Chart immediately.',
      revokeExec:
        '<strong>Who approves:</strong> Board of Directors. <strong>What happens:</strong> Removes the selected executive title while keeping their shares intact.',
      addDirector:
        '<strong>Who approves:</strong> ≥75% Shareholders + the new Director\'s personal consent. <strong>What happens:</strong> Adds a voting member to the Board of Directors.',
      removeDirector:
        '<strong>Who approves:</strong> ≥75% Shareholders. <strong>What happens:</strong> Removes the selected person from the Board of Directors immediately upon enactment.',
      shareSplit:
        '<strong>Who approves:</strong> ≥75% Shareholders. <strong>What happens:</strong> Multiplies every shareholder\'s shares N-for-1 while keeping everyone\'s ownership % identical.',
      reverseShareSplit:
        '<strong>Who approves:</strong> ≥75% Shareholders. <strong>Minority protection:</strong> Every shareholder\'s balance must divide evenly by N so no minority holder is wiped out.',
      shareBuyback:
        '<strong>Who approves:</strong> ≥75% Shareholders + <strong>voluntary consent from the selling shareholder</strong>. <strong>What happens:</strong> Company Treasury pays SGD (≥ 1 SGD/sh) and retires the shares.',
      setTreasury:
        '<strong>Who approves:</strong> ≥75% Shareholders. <strong>What happens:</strong> Designates the official Company Treasury account for fundraising proceeds, ESOP exercises, and buybacks.',
      authorizeFutures:
        '<strong>Who approves:</strong> ≥75% Shareholders. <strong>What happens:</strong> Allows shareholders to mint tradeable futures up to the chosen % of their common shares.',
      serviceContract:
        '<strong>Who approves:</strong> Board of Directors + <strong>Client Counterparty Co-Signature</strong> (<code>IAS 24</code> blocks insiders). <strong>What happens:</strong> Credits full contract value to <code>1800 Future Contract Receivables</code> on <code>AccountingLedger</code>, then bills monthly into <code>1100 Current Receivables</code> &rarr; <code>1010 Current Cash</code>.',
      issueShares:
        '<strong>Who approves:</strong> ≥75% Shareholders. <strong>What happens:</strong> Launches a 5-step capital raise with investor escrow, shareholder ROFR priority, and SHA signing.',
    };
    el.studioPlainExplainer.innerHTML = expMap[kind] || expMap.appointExec;
  }

  el.fieldExecRoleWrap.style.display = kind === 'appointExec' || kind === 'revokeExec' ? 'flex' : 'none';
  if (el.fieldServiceContractWrap) {
    el.fieldServiceContractWrap.style.display = kind === 'serviceContract' ? 'flex' : 'none';
  }
  if (el.fieldActionShareClassWrap) {
    el.fieldActionShareClassWrap.style.display = needsShareClassPicker ? 'flex' : 'none';
  }
  el.fieldTargetIdentityWrap.style.display = needsTargetIdentity ? 'flex' : 'none';
  if (el.fieldCustomTargetWrap && !needsTargetIdentity) {
    el.fieldCustomTargetWrap.style.display = 'none';
  }
  if (el.fieldEquityFinancingWrap) {
    el.fieldEquityFinancingWrap.style.display = useV4Equity ? 'flex' : 'none';
  }
  el.fieldShareAmountWrap.style.display =
    kind === 'issueShares' && !useV4Equity ? 'flex' : 'none';
  if (el.fieldIssuePriceWrap) {
    el.fieldIssuePriceWrap.style.display = useV3Issuance ? 'flex' : 'none';
  }
  if (el.fieldBuybackWrap) {
    el.fieldBuybackWrap.style.display = kind === 'shareBuyback' ? 'grid' : 'none';
  }
  if (el.fieldSplitRatioWrap) {
    el.fieldSplitRatioWrap.style.display =
      kind === 'shareSplit' || kind === 'reverseShareSplit' ? 'flex' : 'none';
    if (el.lblSplitRatio) {
      el.lblSplitRatio.textContent =
        kind === 'reverseShareSplit'
          ? 'Reverse Share Split Consolidation Divisor (1-for-N)'
          : 'Forward Share Split Multiplier (N-for-1)';
    }
  }
  el.fieldFuturesPctWrap.style.display = kind === 'authorizeFutures' ? 'flex' : 'none';

  if (useV4Equity) renderEquityDerivedEconomics();
  if (kind === 'serviceContract') renderSvcDerivedSummary();
  renderStudioTemplatePreview();
}

function renderStudioTemplatePreview() {
  const kind = state.selectedActionKind;
  const roleKey = el.selExecRole?.value || 'ROLE_CEO';
  const roleId = GOV_CONSTANTS[roleKey] || GOV_CONSTANTS.ROLE_CEO;
  const targetAddr = resolveSelectedStudioTarget();
  const issueAmount = Number(el.inpStudioShareAmount?.value || 15000);
  const minIssuePrice = Number(el.inpStudioIssueMinPrice?.value || 100);
  const futuresPct = Number(el.inpStudioFuturesPct?.value || 20);
  const assetClassKey = el.selIssueAssetClass?.value || 'COMMON';
  const existingIssueObj = state.shareClasses.find((c) => c.ledger === assetClassKey);
  const customClassName = existingIssueObj
    ? existingIssueObj.symbol
    : (el.inpIssueCustomClassName?.value || 'Preferred A').trim();
  const conversionRate =
    assetClassKey === 'COMMON'
      ? 1
      : existingIssueObj
        ? Math.max(1, Math.round(existingIssueObj.convMult))
        : Number(el.inpIssueConversionRate?.value || 1);
  const minRaiseAmount = Number(el.inpIssueMinRaise?.value || 1000000);
  const maxOwnershipPct = Number(el.inpIssueMaxOwnershipPct?.value || 20);
  const buybackShares = Number(el.inpBuybackShares?.value || 5000);
  const buybackPrice = Number(el.inpBuybackPrice?.value || 110);
  const splitRatio = Number(el.inpSplitRatio?.value || 2);
  const selectedClassObj = state.shareClasses.find((c) => c.ledger === el.selActionShareClass?.value);

  const execMap = {
    appointExec: 'grantRole',
    revokeExec: 'revokeRole',
    addDirector: 'addDirector',
    removeDirector: 'removeDirector',
    issueShares:
      state.supportsV4Governance && state.supportsIssuanceAuction
        ? 'equityFinancing'
        : state.supportsIssuanceAuction
          ? 'issueSharesAuction'
          : 'issueShares',
    shareBuyback: 'shareBuyback',
    shareSplit: 'shareSplit',
    reverseShareSplit: 'reverseShareSplit',
    setTreasury: 'setTreasury',
    authorizeFutures: 'authorizeFutures',
    serviceContract: 'serviceContract',
  };
  el.studioTemplateBox.innerHTML = buildResolutionTemplate(
    {
      execKind: execMap[kind] || kind,
      roleId,
      roleName: roleKey,
      targetAddr,
      issueAmount,
      minIssuePrice,
      futuresPct,
      assetClassKey,
      customClassName,
      conversionRate,
      minRaiseAmount,
      maxOwnershipPct,
      buybackShares,
      buybackPrice,
      splitRatio,
      svcCode: el.inpSvcCode?.value || 'DEF-MOD-FLRC-C2',
      svcMonthly: Number(el.inpSvcMonthly?.value || 180000),
      svcMonths: Number(el.inpSvcMonths?.value || 12),
      svcMonthBlocks: Number(el.inpSvcMonthBlocks?.value || 35),
      classSymbol: selectedClassObj?.symbol || shareTickerStr(),
    },
    state.templateMode
  );
}

function populateEsopDropdowns() {
  if (el.selEsopAssetClass) {
    const prevCls = el.selEsopAssetClass.value;
    const existingPrefs = state.shareClasses.filter((_, i) => i > 0);
    el.selEsopAssetClass.innerHTML = [
      `<option value="COMMON">Common Shares (${escapeHtml(shareTickerStr())} • 1x Common &amp; Votes)</option>`,
      ...existingPrefs.map(
        (c) =>
          `<option value="${c.ledger}">${escapeHtml(c.symbol)} (${c.convMult}x Common &amp; Votes)</option>`
      ),
      `<option value="PREFERRED_A">Preferred Series A</option>`,
      `<option value="PREFERRED_B">Preferred Series B</option>`,
    ].join('');
    if (prevCls && Array.from(el.selEsopAssetClass.options).some((o) => o.value === prevCls)) {
      el.selEsopAssetClass.value = prevCls;
    }
  }
  if (el.selGrantProgram) {
    const prevP = el.selGrantProgram.value;
    el.selGrantProgram.innerHTML = state.esopPrograms.length
      ? state.esopPrograms
          .map(
            (p) =>
              `<option value="${p.programId}">ESOP #${p.programId}: ${escapeHtml(p.optionSymbol)} → ${escapeHtml(p.underlyingSymbol)} (${fmtNum(p.authorizedShares - p.committedShares)} avail @ ${fmtNum(p.exercisePrice)} SGD)</option>`
          )
          .join('')
      : `<option value="">Enact a Master ESOP Programme on the left first</option>`;
    if (prevP && state.esopPrograms.some((p) => String(p.programId) === prevP)) {
      el.selGrantProgram.value = prevP;
    }
  }

  if (el.selGrantEmployee) {
    const prevE = el.selGrantEmployee.value;
    const opts = [
      ...(session.myIdentityAddr
        ? [{ addr: session.myIdentityAddr.toLowerCase(), label: `🧑‍✈️ ${session.labelForIdentity(session.myIdentityAddr)} (You)` }]
        : []),
      ...(session.aiPersonas || []).map((p) => ({
        addr: p.identityAddr,
        label: `${p.avatar} ${p.displayLabel} (${state.capRows.some((r) => r.addr === p.identityAddr && r.convCommon > 0) ? 'Existing Shareholder' : 'First-Time Shareholder → Needs SHA'})`,
      })),
      { addr: '__custom__', label: '➕ External Employee Identity HFS Address (0x…)' },
    ];
    el.selGrantEmployee.innerHTML = opts
      .map((o) => `<option value="${o.addr}">${escapeHtml(o.label)}</option>`)
      .join('');
    if (prevE && opts.some((o) => o.addr === prevE)) {
      el.selGrantEmployee.value = prevE;
    }
    if (el.fieldGrantCustomEmpWrap) {
      el.fieldGrantCustomEmpWrap.style.display =
        el.selGrantEmployee.value === '__custom__' ? 'flex' : 'none';
    }
  }
}

function renderEsopScheduleDraft() {
  if (!el.esopScheduleRows) return;
  el.esopScheduleRows.innerHTML = state.esopDraftSchedule
    .map(
      (row, idx) => `
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">+${idx + 1}:</span>
          <input class="inst-input" type="number" min="1" step="1" value="${row.blockOffset}" data-esop-blk="${idx}" style="padding:5px 7px;font-size:11.5px;" />
          <span style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">blks</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <input class="inst-input" type="number" min="1" step="100" value="${row.amount}" data-esop-amt="${idx}" style="padding:5px 7px;font-size:11.5px;" />
          <span style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">opts</span>
        </div>
        ${
          state.esopDraftSchedule.length > 1
            ? `<button type="button" class="inst-btn sm rose" data-rm-esop-tranche="${idx}" style="padding:3px 7px;">✕</button>`
            : `<span></span>`
        }
      </div>
    `
    )
    .join('');
}

function renderEsopTab() {
  if (!el.esopProgramsList) return;
  const okV4 = state.esopSupported && state.charterState === 2;
  if (el.esopUnavailableNotice) {
    el.esopUnavailableNotice.style.display = state.supportsV4Governance ? 'none' : 'flex';
  }
  if (el.formCreateEsopProg) {
    el.formCreateEsopProg.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.esopProgReadonlyNote) {
    el.esopProgReadonlyNote.style.display = state.myIsShareholder ? 'none' : 'block';
  }
  if (el.formAwardEsopOptions) {
    el.formAwardEsopOptions.style.display = state.myIsDirector ? 'flex' : 'none';
  }
  if (el.esopGrantReadonlyNote) {
    el.esopGrantReadonlyNote.style.display = state.myIsDirector ? 'none' : 'block';
  }
  if (el.btnProposeEsopProg) {
    el.btnProposeEsopProg.disabled = !okV4 || !state.myIsShareholder || state.busy;
  }
  if (el.btnProposeEsopGrant) {
    el.btnProposeEsopGrant.disabled =
      !okV4 || !state.myIsDirector || state.esopPrograms.length === 0 || state.busy;
  }

  if (el.esopDueBadge) {
    el.esopDueBadge.textContent =
      state.esopDueCount > 0
        ? `⚡ ${state.esopDueCount} Tranche(s) Due (Simulator Sweeping…)`
        : '✓ 0 Tranches Due';
    el.esopDueBadge.className = `inst-badge ${state.esopDueCount > 0 ? 'amber' : 'green'}`;
  }
  if (el.esopLastSweepBadge) {
    el.esopLastSweepBadge.textContent = state.esopLastSweepBlock
      ? `🤖 Simulator Auto-Sweep • Last Sweep #${fmtNum(state.esopLastSweepBlock)}`
      : '🤖 Simulator Auto-Sweep • 1x/Block Guard';
  }

  if (state.activeTab === 'esop') {
    populateEsopDropdowns();
    if (!el.esopScheduleRows.children.length) renderEsopScheduleDraft();
  }

  el.esopProgramsList.innerHTML = state.esopPrograms.length
    ? state.esopPrograms
        .map((p) => {
          const pctUsed =
            p.authorizedShares > 0 ? Math.min(100, Math.round((p.committedShares / p.authorizedShares) * 100)) : 0;
          return `
            <div style="padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.86);border:1px solid var(--line);display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <strong style="font-size:12.5px;color:#f8fafc;">🎓 ESOP #${p.programId} • ${escapeHtml(p.optionSymbol)} → ${escapeHtml(p.underlyingSymbol)} (${p.conversionRate}x)</strong>
                <span class="inst-badge cyan">Strike: ${fmtNum(p.exercisePrice)} SGD</span>
              </div>
              <div style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">
                Option AssetLedger: ${shortAddr(p.optionLedger)} • Underlying: ${shortAddr(p.underlyingLedger)}
              </div>
              <div style="font-size:11px;font-family:var(--mono);color:#a7f3d0;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                <span>Authorized: ${fmtNum(p.authorizedShares)}</span>
                <span>Awarded: ${fmtNum(p.committedShares)}</span>
                <span>Issued: ${fmtNum(p.issuedOptions)}</span>
                <span>Exercised: ${fmtNum(p.exercisedOptions)}</span>
              </div>
              <div class="res-progress-track"><div class="res-progress-fill" style="width:${pctUsed}%;"></div></div>
            </div>
          `;
        })
        .join('')
    : `<div style="padding:12px;border-radius:10px;border:1px dashed var(--line);font-size:12px;color:var(--txt-2);">No Master ESOP Programmes enacted yet — propose one above via ≥75% Shareholder Resolution!</div>`;

  const myLow = activeVerifiedIdentityLow();
  el.esopGrantsList.innerHTML = state.esopGrants.length
    ? state.esopGrants
        .map((g) => {
          const prog = state.esopPrograms.find((p) => p.programId === g.programId);
          const isMine = Boolean(myLow && g.employee === myLow);
          const trancheBadges = g.tranches
            .map((t) => {
              const dueNow = !t.issued && session.blockNumber >= t.dueBlock;
              return `<span class="inst-badge ${t.issued ? 'green' : dueNow ? 'amber' : 'cyan'}" style="font-size:9.5px;">#${t.idx + 1}: ${fmtNum(t.amount)} @ Blk #${fmtNum(t.dueBlock)} ${t.issued ? '✓ Issued' : dueNow ? '⚡ Due!' : '⏳'}</span>`;
            })
            .join(' ');
          return `
            <div style="padding:12px 14px;border-radius:12px;background:rgba(7,13,26,0.85);border:1px solid ${isMine ? 'rgba(56,189,248,0.5)' : 'var(--line)'};display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <strong style="font-size:13px;color:#f8fafc;">${avatarForAddr(g.employee)} ${escapeHtml(g.employeeLabel)} • Grant #${g.grantId}</strong>
                <span class="inst-badge ${g.cliffPassed ? 'green' : 'amber'}">${
                  g.cliffPassed
                    ? `🔓 Cliff Passed (#${fmtNum(g.cliffBlock)})`
                    : `🔒 Cliff @ #${fmtNum(g.cliffBlock)} (${Math.max(0, g.cliffBlock - session.blockNumber)} blks)`
                }</span>
              </div>
              <div style="font-size:11px;font-family:var(--mono);color:var(--txt-2);">
                ESOP #${g.programId} (${escapeHtml(prog?.optionSymbol || 'OPT')} @ ${fmtNum(prog?.exercisePrice || 0)} SGD) • Awarded: <strong>${fmtNum(g.totalAwarded)}</strong> • Vested/Issued: <strong style="color:#6ee7b7;">${fmtNum(g.issuedOptions)}</strong> • Exercised: <strong>${fmtNum(g.exercisedOptions)}</strong>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:5px;">${trancheBadges}</div>
              ${
                g.isFirstTimeShareholder
                  ? `<div style="font-size:10.5px;color:#fde68a;font-family:var(--mono);">📜 First-Time Shareholder: Exercising requires signing the <strong>Shareholders' Agreement (SHA)</strong> along with the Exercise Letter (-99 if omitted).</div>`
                  : `<div style="font-size:10.5px;color:#a7f3d0;font-family:var(--mono);">✓ Existing / SHA-Bound Shareholder: Only Exercise Letter signature required.</div>`
              }
              ${
                isMine
                  ? `
                  <div style="display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:1px solid var(--line);">
                    ${
                      g.isFirstTimeShareholder
                        ? `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#fef3c7;cursor:pointer;">
                             <input type="checkbox" id="chkExSha_${g.grantId}" checked />
                             Co-sign Company Shareholders' Agreement (First-Time Shareholder Requirement)
                           </label>`
                        : ''
                    }
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                      <input class="inst-input" type="number" min="1" max="${Math.max(1, g.exercisableNow)}" value="${Math.max(100, g.exercisableNow || 500)}" id="inpExAmt_${g.grantId}" style="width:95px;padding:4px 7px;font-size:11.5px;" />
                      <button type="button" class="inst-btn sm emerald" data-exercise-grant="${g.grantId}" ${!g.cliffPassed || g.exercisableNow === 0 ? 'disabled' : ''}>
                        🚀 Sign Exercise Letter &amp; Convert to Shares
                      </button>
                      <button type="button" class="inst-btn sm" data-preview-ex-letter="${g.grantId}">📄 Letter</button>
                      <button type="button" class="inst-btn sm" data-test-esop-guard="${g.grantId}" title="Test Cliff (-98) or Missing SHA (-99) Wasmtime guard">🧪 Guard</button>
                    </div>
                  </div>
                `
                  : ''
              }
            </div>
          `;
        })
        .join('')
    : `<div style="grid-column:1/-1;padding:16px;border-radius:11px;border:1px dashed var(--line);font-size:12px;color:var(--txt-2);text-align:center;">No Employee Option Awards enacted yet — pass a Board Resolution in Card 2 above to schedule periodic option tranches!</div>`;
}

el.actionTypePicker?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action-kind]');
  if (!card) return;
  const picked = card.getAttribute('data-action-kind');
  if (picked === 'issueShares' && state.supportsV4Governance && state.supportsIssuanceAuction) {
    switchTab('issuance');
    showBanner(
      '💰 Switched to the guided <strong>Raise Capital (5-Step)</strong> wizard — configure your share class &amp; target raise below!',
      'info'
    );
    return;
  }
  state.selectedActionKind = picked;
  state.legalBookOpen = true;
  populateActionTargetDropdown();
  renderActionStudioState();
});

el.btnCloseLegalBook?.addEventListener('click', () => {
  state.legalBookOpen = false;
  renderActionStudioState();
});

el.selExecRole?.addEventListener('change', () => {
  populateActionTargetDropdown();
  renderStudioTemplatePreview();
});
el.selActionShareClass?.addEventListener('change', () => {
  populateActionTargetDropdown();
  renderStudioTemplatePreview();
});
el.selTargetIdentity?.addEventListener('change', () => {
  if (el.fieldCustomTargetWrap) {
    el.fieldCustomTargetWrap.style.display = el.selTargetIdentity.value === '__custom__' ? 'flex' : 'none';
  }
  renderStudioTemplatePreview();
});
el.selIssueAssetClass?.addEventListener('change', () => {
  const cls = el.selIssueAssetClass.value;
  const existingObj = state.shareClasses.find((c) => c.ledger === cls);
  if (el.inpIssueConversionRate) {
    if (cls === 'COMMON') {
      el.inpIssueConversionRate.value = '1';
      el.inpIssueConversionRate.disabled = true;
    } else if (existingObj) {
      el.inpIssueConversionRate.value = String(Math.max(1, Math.round(existingObj.convMult)));
      el.inpIssueConversionRate.disabled = true;
    } else {
      el.inpIssueConversionRate.value = '1';
      el.inpIssueConversionRate.disabled = false;
    }
  }
  renderEquityDerivedEconomics();
  renderStudioTemplatePreview();
});
el.inpIssueCustomClassName?.addEventListener('input', () => {
  renderEquityDerivedEconomics();
  renderStudioTemplatePreview();
});
el.inpIssueConversionRate?.addEventListener('input', () => {
  renderEquityDerivedEconomics();
  renderStudioTemplatePreview();
});
el.inpIssueMinRaise?.addEventListener('input', () => {
  renderEquityDerivedEconomics();
  renderStudioTemplatePreview();
});
el.inpIssueMaxOwnershipPct?.addEventListener('input', () => {
  renderEquityDerivedEconomics();
  renderStudioTemplatePreview();
});
el.inpBuybackShares?.addEventListener('input', renderStudioTemplatePreview);
el.inpBuybackPrice?.addEventListener('input', renderStudioTemplatePreview);
el.inpSplitRatio?.addEventListener('input', renderStudioTemplatePreview);
el.inpCustomTargetIdentity?.addEventListener('input', renderStudioTemplatePreview);
el.inpStudioShareAmount?.addEventListener('input', renderStudioTemplatePreview);
el.inpStudioIssueMinPrice?.addEventListener('input', renderStudioTemplatePreview);
el.inpStudioFuturesPct?.addEventListener('input', renderStudioTemplatePreview);

el.btnTplModeHydrated?.addEventListener('click', () => {
  state.templateMode = 'hydrated';
  el.btnTplModeHydrated.className = 'inst-btn sm cyan';
  el.btnTplModeRaw.className = 'inst-btn sm';
  renderStudioTemplatePreview();
});
el.btnTplModeRaw?.addEventListener('click', () => {
  state.templateMode = 'raw';
  el.btnTplModeRaw.className = 'inst-btn sm cyan';
  el.btnTplModeHydrated.className = 'inst-btn sm';
  renderStudioTemplatePreview();
});

// ---------------------------------------------------------------------------
// Rendering: 5-Step Share Issuance Arena (Tab 2B), 3-Step Transfer Arena & Futures
// ---------------------------------------------------------------------------

function populateIssuanceArenaDropdowns() {
  if (el.selArenaIssAsset) {
    const prev = el.selArenaIssAsset.value;
    const existingPrefs = state.shareClasses.filter((_, i) => i > 0);
    el.selArenaIssAsset.innerHTML = [
      `<option value="CUSTOM_PREFERRED">➕ New Preferred Shares (Custom Name)</option>`,
      `<option value="COMMON">Existing Common Shares (${escapeHtml(shareTickerStr())} • 1x)</option>`,
      ...existingPrefs.map(
        (c) => `<option value="${c.ledger}">Existing ${escapeHtml(c.symbol)} (${c.convMult}x)</option>`
      ),
    ].join('');
    if (prev && Array.from(el.selArenaIssAsset.options).some((o) => o.value === prev)) {
      el.selArenaIssAsset.value = prev;
    }
  }

  if (el.selActiveIssuanceRound) {
    const rounds = state.resolutions.filter((r) => r.isEquityFinancing || r.isIssuanceAuction);
    if (!rounds.length) {
      el.selActiveIssuanceRound.innerHTML = `<option value="">No Issuance Rounds Yet</option>`;
      el.selActiveIssuanceRound.disabled = true;
    } else {
      el.selActiveIssuanceRound.disabled = false;
      el.selActiveIssuanceRound.innerHTML = rounds
        .map((r) => {
          const ph = r.issPhase || 0;
          const phTxt =
            ph === 1
              ? 'Step 1 Vote'
              : ph === 2
                ? 'Step 2 Bids'
                : ph === 3
                  ? 'Step 3 ROFR'
                  : ph === 4
                    ? 'Step 4 Alloc'
                    : ph === 5
                      ? 'Step 5 SHA'
                      : ph === 9 || r.failedBidsStage
                        ? 'Failed (-97)'
                        : 'Active';
          return `<option value="${r.authAddr.toLowerCase()}" ${
            r.authAddr.toLowerCase() === (state.activeIssuanceAddr || '').toLowerCase() ? 'selected' : ''
          }>${escapeHtml(r.classLabel || r.category || 'Issuance')} (${shortAddr(r.authAddr)} • ${phTxt})</option>`;
        })
        .join('');
    }
  }
}

function renderIssuanceArenaDerived() {
  if (!el.issArenaDerivedSummary) return;
  const mode = el.selArenaIssAsset?.value || 'CUSTOM_PREFERRED';
  const existingObj = state.shareClasses.find((c) => c.ledger === mode);
  if (el.fieldArenaIssClassNameWrap) {
    el.fieldArenaIssClassNameWrap.style.display = mode === 'CUSTOM_PREFERRED' ? 'flex' : 'none';
  }
  if (el.inpArenaIssConv) {
    if (mode === 'COMMON') {
      el.inpArenaIssConv.value = '1';
      el.inpArenaIssConv.disabled = true;
    } else if (existingObj) {
      el.inpArenaIssConv.value = String(Math.max(1, Math.round(existingObj.convMult)));
      el.inpArenaIssConv.disabled = true;
    } else {
      el.inpArenaIssConv.disabled = false;
      if (Number(el.inpArenaIssConv.value) < 1) el.inpArenaIssConv.value = '1';
    }
  }
  const convRate =
    mode === 'COMMON'
      ? 1
      : existingObj
        ? Math.max(1, Math.round(existingObj.convMult))
        : Math.max(1, Math.floor(Number(el.inpArenaIssConv?.value) || 1));
  const minRaise = Math.max(1000, Math.floor(Number(el.inpArenaIssRaise?.value) || 1000000));
  const maxOwnPct = Math.max(0.5, Math.min(90, Number(el.inpArenaIssMaxOwn?.value) || 20));
  const clsName =
    mode === 'COMMON'
      ? `Common (${shareTickerStr()})`
      : existingObj
        ? existingObj.symbol
        : (el.inpArenaIssClassName?.value || 'Preferred X').trim();
  const derived = computeDerivedEquityFinancingTerms({
    preMoneyCommon: state.totalConvertedCommon || state.totalShares || 100000,
    conversionRate: convRate,
    minRaiseAmount: minRaise,
    maxOwnershipBps: Math.round(maxOwnPct * 100),
  });
  el.issArenaDerivedSummary.innerHTML = `📐 Pre-Money: <strong>${fmtNum(derived.preMoneyCommon)} Common Eq.</strong> • Issuing <strong style="color:#6ee7b7;">${fmtNum(derived.targetShares)} ${escapeHtml(clsName)}</strong> (${convRate}x = ${fmtNum(derived.newCommonEq)} Votes, <strong>${derived.actualOwnPct}%</strong> post-money) @ Floor <strong style="color:#7dd3fc;">${fmtNum(derived.offerPrice)} SGD/sh</strong>`;
}

function renderIssuanceArena() {
  if (!el.issuanceStepper) return;
  const okV5 = Boolean(session.inst?.shareCapital) && state.supportsV4Governance;
  if (el.issuanceUnavailableNotice) {
    el.issuanceUnavailableNotice.style.display = okV5 || isBaseLegacyCharter() === false ? 'none' : 'flex';
  }
  if (el.formLaunchIssuanceRound) {
    el.formLaunchIssuanceRound.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.issuanceLaunchReadonlyNotice) {
    el.issuanceLaunchReadonlyNotice.style.display = state.myIsShareholder ? 'none' : 'block';
  }
  if (el.btnLaunchIssuanceRound) {
    el.btnLaunchIssuanceRound.disabled = !okV5 || !state.myIsShareholder || state.charterState !== 2 || state.busy;
  }
  if (el.btnArenaTestZeroBidIssuance) {
    el.btnArenaTestZeroBidIssuance.style.display = state.myIsShareholder ? 'inline-flex' : 'none';
    el.btnArenaTestZeroBidIssuance.disabled = !okV5 || !state.myIsShareholder || state.charterState !== 2 || state.busy;
  }
  if (el.issStep3RofrRow) {
    el.issStep3RofrRow.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.issStep3ReadonlyNote) {
    el.issStep3ReadonlyNote.style.display = state.myIsShareholder ? 'none' : 'block';
  }

  populateIssuanceArenaDropdowns();
  renderIssuanceArenaDerived();

  const blk = session.blockNumber;
  el.issBlockReadout.textContent = `Current Block #${fmtNum(blk)}`;

  const rd = state.issuanceRound;
  const ph = rd ? rd.issPhase || (rd.failedBidsStage ? 9 : rd.status === 4 ? 5 : 2) : 0;
  const sum = rd?.allocSummary || null;
  const pendSha = sum ? sum.pendingShaCount : 0;
  const allComplete = ph === 5 && sum && pendSha === 0;
  const clsName = rd
    ? rd.classLabel || (rd.eqClassCode === 0 ? 'Common Shares' : `Preferred (${rd.eqConvRate}x)`)
    : 'Share Class';

  const steps = [
    {
      n: 1,
      title: 'Step 1: Shareholder Resolution',
      sub: rd ? `${fmtNum(rd.weight)} / ${fmtNum(rd.reqWeight)} votes (≥75%)` : '≥75% Super-Majority',
    },
    {
      n: 2,
      title: 'Step 2: Investor Bidding',
      sub: ph === 9 ? '🚫 Failed (0 Bids / Shortfall)' : rd ? `${rd.activeStep1Bids} Active Bid(s)` : '≥1 Bidder Required',
    },
    {
      n: 3,
      title: 'Step 3: Shareholder ROFR',
      sub: 'Existing Holders Prioritized',
    },
    {
      n: 4,
      title: 'Step 4: Pro-Rata Allocation',
      sub: sum ? `ROFR ${fmtNum(sum.rofrAllocated)} + Bid ${fmtNum(sum.biddersAllocated)}` : 'Simulator Auto-Runner',
    },
    {
      n: 5,
      title: 'Step 5: Sign SHA & Mint',
      sub: allComplete
        ? '✓ Cap Table Updated!'
        : sum
          ? `${pendSha} New Holder(s) Pending SHA`
          : 'New Shareholders Sign SHA',
    },
  ];

  el.issuanceStepper.innerHTML = steps
    .map((s) => {
      const failed = ph === 9 && (s.n === 2 || s.n === 4);
      const done =
        !failed &&
        ((s.n < ph && ph !== 9) ||
          (s.n === 4 && ph === 5) ||
          (s.n === 5 && allComplete));
      const active =
        !failed &&
        !done &&
        ((s.n === ph && ph >= 1 && ph <= 4) || (s.n === 5 && ph === 5 && !allComplete));
      return `
        <div class="auc-step-card ${done ? 'done' : active ? 'active' : ''}" style="${failed ? 'border-color:rgba(248,113,113,0.65);background:rgba(127,29,29,0.35);' : ''}">
          <div style="font-size:11.5px;font-weight:800;color:${failed ? '#fca5a5' : done ? '#6ee7b7' : active ? '#7dd3fc' : 'var(--txt-1)'};">
            ${failed ? '🚫 ' : done ? '✓ ' : active ? '⚡ ' : ''}${escapeHtml(s.title)}
          </div>
          <div style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">${escapeHtml(s.sub)}</div>
        </div>
      `;
    })
    .join('');

  if (!rd) {
    el.issClockLabel.textContent = state.myIsShareholder
      ? 'No Issuance Round Active — Configure & Launch Step 1 Above!'
      : 'No Active Share Issuance Round on This Company';
    el.issClockLabel.style.color = '#7dd3fc';
    el.issWindowProgressFill.style.width = '0%';
    el.issEscrowBalance.textContent = '0 SGD';
    el.issProjectedClearing.textContent = '—';
    el.issProjectedRule.textContent = 'ROFR Prioritized → Remainder Pro-Rata';
    el.issStep1QuorumBox.innerHTML = `<div style="font-size:11px;color:var(--txt-2);">${
      state.myIsShareholder
        ? 'Launch an offering above to open the Step 1 Shareholder Resolution.'
        : 'Awaiting a ≥75% Shareholder Resolution to open an offering.'
    }</div>`;
    el.issOrdersStep2.innerHTML = `<div style="font-size:11px;color:var(--txt-2);">Unlocks automatically once Step 1 ≥75% passes.</div>`;
    el.issOrdersStep3.innerHTML = `<div style="font-size:11px;color:var(--txt-2);">Unlocks after Step 2 closes with ≥1 bidder.</div>`;
    el.issAllotmentsTableWrap.innerHTML = '';
    if (el.btnVoteIssuanceStep1) el.btnVoteIssuanceStep1.style.display = 'none';
    if (el.issStep1ReadonlyNote) {
      el.issStep1ReadonlyNote.style.display = state.myIsShareholder ? 'none' : 'block';
    }
    el.btnPlaceIssStep2Bid.disabled = true;
    el.btnPlaceIssStep3Rofr.disabled = true;
    el.btnSignIssuanceShaClaim.style.display = 'none';
    el.btnRefundFailedIssuanceArena.style.display = 'none';
    return;
  }

  el.issEscrowBalance.textContent = `${fmtNum(rd.escrowCash || 0)} SGD`;
  const targetSh = rd.targetShares || rd.maxNewShares || 0;
  const offerPx = rd.offerPrice || rd.minIssuePrice || 1;
  const pStar = sum ? sum.clearingPrice : rd.projectedClearingPrice || offerPx;

  if (ph === 9) {
    el.issClockLabel.textContent = `🚫 ROUND FAILED (-97) — Zero Bidders in Step 2 or Total Demand < ${fmtNum(targetSh)} ${clsName}`;
    el.issClockLabel.style.color = '#fca5a5';
    el.issWindowProgressFill.style.width = '100%';
    el.issProjectedClearing.textContent = 'FAILED (-97)';
    el.issProjectedRule.textContent = 'Rejected by CorporateCharter';
  } else if (ph === 1) {
    el.issClockLabel.textContent = `🗳️ STEP 1 LIVE — Shareholder Resolution (${fmtNum(rd.weight)} / ${fmtNum(rd.reqWeight)} votes) for ${fmtNum(targetSh)} ${clsName}`;
    el.issClockLabel.style.color = '#c4b5fd';
    el.issWindowProgressFill.style.width = '20%';
    el.issProjectedClearing.textContent = `≥ ${fmtNum(offerPx)} SGD × ${fmtNum(targetSh)}`;
    el.issProjectedRule.textContent = `${clsName} (${rd.eqConvRate}x Common/Votes)`;
  } else if (ph === 2) {
    const rem = Math.max(0, rd.step1Dl - blk);
    el.issClockLabel.textContent = `🟢 STEP 2 LIVE — Investor Bidding (${rd.activeStep1Bids} Bid${rd.activeStep1Bids === 1 ? '' : 's'} • ≥1 Req) • ${rem} blk(s) left (#${fmtNum(rd.step1Dl)})`;
    el.issClockLabel.style.color = '#7dd3fc';
    el.issWindowProgressFill.style.width = '42%';
    el.issProjectedClearing.textContent = `${fmtNum(pStar)} SGD × ${fmtNum(targetSh)}`;
    el.issProjectedRule.textContent = `Subscribed so far: ${fmtNum(rd.subscribedAtOrAboveOffer)} / ${fmtNum(targetSh)} sh`;
  } else if (ph === 3) {
    const rem = Math.max(0, rd.step2Dl - blk);
    el.issClockLabel.textContent = `🛡️ STEP 3 LIVE — Existing Shareholder ROFR • ${rem} blk(s) left (closes #${fmtNum(rd.step2Dl)})`;
    el.issClockLabel.style.color = '#6ee7b7';
    el.issWindowProgressFill.style.width = '68%';
    el.issProjectedClearing.textContent = `${fmtNum(pStar)} SGD × ${fmtNum(targetSh)}`;
    el.issProjectedRule.textContent = `ROFR Prioritized 100% @ P* = ${fmtNum(pStar)} SGD`;
  } else if (ph === 4) {
    el.issClockLabel.textContent = `⚙️ STEP 4 LIVE — Simulator Determining ROFR-Priority & Pro-Rata Allocation…`;
    el.issClockLabel.style.color = '#38bdf8';
    el.issWindowProgressFill.style.width = '85%';
    el.issProjectedClearing.textContent = `${fmtNum(pStar)} SGD × ${fmtNum(targetSh)}`;
    el.issProjectedRule.textContent = `ShareCapital.determineIssuanceAllocation()`;
  } else {
    el.issClockLabel.textContent = allComplete
      ? `🏆 ALL 5 STEPS COMPLETE — Minted ${fmtNum(targetSh)} ${clsName} @ ${fmtNum(pStar)} SGD onto Cap Table!`
      : `✍️ STEP 5 LIVE — Awaiting ${pendSha} New Shareholder(s) to Sign SHA & Claim ${clsName}!`;
    el.issClockLabel.style.color = '#6ee7b7';
    el.issWindowProgressFill.style.width = allComplete ? '100%' : '92%';
    el.issProjectedClearing.textContent = `${fmtNum(pStar)} SGD × ${fmtNum(targetSh)}`;
    el.issProjectedRule.textContent = sum
      ? `ROFR: ${fmtNum(sum.rofrAllocated)} sh • Bidders: ${fmtNum(sum.biddersAllocated)} sh`
      : 'Cleared on ShareCapital';
  }

  if (rd.step1Dl > 0) {
    el.issDeadlinesSub.textContent = `Auth ${shortAddr(rd.authAddr)} • Step 2 Bidding ≤ #${fmtNum(rd.step1Dl)} • Step 3 ROFR ≤ #${fmtNum(rd.step2Dl)} • Target: ${fmtNum(targetSh)} ${clsName}`;
  } else {
    el.issDeadlinesSub.textContent = `Auth ${shortAddr(rd.authAddr)} • Pass Step 1 (≥75% Vote) to start Step 2 Bidding & Step 3 ROFR clocks!`;
  }

  el.issColStep1.classList.toggle('live-window', ph === 1);
  el.issColStep1.classList.toggle('step-done', ph > 1 && ph !== 9);
  el.issColStep1.classList.toggle('step-locked', ph === 0);

  el.issColStep2.classList.toggle('live-window', ph === 2);
  el.issColStep2.classList.toggle('step-done', ph > 2 && ph !== 9);
  el.issColStep2.classList.toggle('step-locked', ph < 2);

  el.issColStep3.classList.toggle('live-window', ph === 3);
  el.issColStep3.classList.toggle('step-done', ph > 3 && ph !== 9);
  el.issColStep3.classList.toggle('step-locked', ph < 3);
  el.issBadgeStep1.textContent = ph === 1 ? `LIVE (${fmtNum(rd.weight)}/${fmtNum(rd.reqWeight)})` : ph > 1 ? 'Passed ✓' : 'Waiting';
  el.issBadgeStep2.textContent =
    ph === 9 ? 'FAILED (-97)' : ph === 2 ? `LIVE (${rd.activeStep1Bids} Bid)` : ph > 2 ? `Closed (${rd.activeStep1Bids})` : 'Locked';
  el.issBadgeStep3.textContent =
    ph === 9 ? 'Blocked (-97)' : ph === 3 ? 'LIVE NOW' : ph > 3 ? 'Closed' : 'After Step 2';

  const qPct = Math.min(100, ph > 1 && ph !== 9 ? 100 : Math.round((rd.weight / Math.max(1, rd.reqWeight)) * 100));
  const chips = (rd.signers || [])
    .map(
      (s) =>
        `<span class="inst-badge ${s.signed ? 'green' : 'amber'}" style="font-size:9.5px;">${s.avatar} ${escapeHtml(
          s.label.split('·')[0].trim()
        )} ${s.signed ? '✓' : '…'}</span>`
    )
    .join(' ');
  el.issStep1QuorumBox.innerHTML = `
    <div style="font-size:11px;font-family:var(--mono);color:#e2e8f0;display:flex;justify-content:space-between;">
      <span>Offering: <strong>${fmtNum(targetSh)} ${escapeHtml(clsName)}</strong></span>
      <span>${qPct}% Quorum</span>
    </div>
    <div class="res-progress-track"><div class="res-progress-fill" style="width:${qPct}%;"></div></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;">${chips || '<span style="font-size:10.5px;color:var(--txt-2);">Step 1 ≥75% Super-Majority passed ✓</span>'}</div>
  `;
  if (el.btnVoteIssuanceStep1) {
    el.btnVoteIssuanceStep1.style.display = state.myIsShareholder ? 'inline-flex' : 'none';
    el.btnVoteIssuanceStep1.disabled = ph !== 1 || rd.mySigned || !state.myIsShareholder || state.busy;
    el.btnVoteIssuanceStep1.textContent =
      ph > 1 && ph !== 9
        ? '✓ Step 1 Resolution Passed'
        : rd.mySigned
          ? '✓ Your Vote Recorded'
          : '✍️ Vote & Pass Step 1 Resolution';
  }
  if (el.issStep1ReadonlyNote) {
    el.issStep1ReadonlyNote.style.display = state.myIsShareholder ? 'none' : 'block';
  }

  const myLow = activeVerifiedIdentityLow();
  const renderIssOrders = (sideCode, canCancel) => {
    const items = (rd.issuanceOrders || []).filter((o) => o.side === sideCode);
    if (!items.length) {
      return `<div style="font-size:11px;color:var(--txt-2);padding:6px 0;">No orders placed in this step yet.</div>`;
    }
    return items
      .map(
        (o) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(15,23,42,0.85);border:1px solid var(--line);font-size:11px;font-family:var(--mono);">
          <div>
            <div style="color:#f8fafc;font-weight:700;">${avatarForAddr(o.trader)} ${escapeHtml(session.labelForIdentity(o.trader).split('·')[0].trim())}</div>
            <div style="color:#6ee7b7;">${fmtNum(o.quantity)} sh @ ${fmtNum(o.price)} SGD</div>
          </div>
          ${
            canCancel && myLow && o.trader === myLow
              ? `<button type="button" class="inst-btn sm rose" data-cancel-iss-order="${o.index}">Cancel</button>`
              : `<span style="color:var(--txt-2);">#${o.index}</span>`
          }
        </div>
      `
      )
      .join('');
  };

  el.issOrdersStep2.innerHTML = renderIssOrders(1, ph === 2);
  el.issOrdersStep3.innerHTML = renderIssOrders(3, ph === 3);
  el.btnPlaceIssStep2Bid.disabled = ph !== 2 || state.busy;
  el.btnPlaceIssStep3Rofr.disabled = ph !== 3 || !state.myIsShareholder || state.busy;

  if (ph === 2 && el.inpIssStep2Price && Number(el.inpIssStep2Price.value) < offerPx) {
    el.inpIssStep2Price.value = String(offerPx + 4);
  }
  if (ph === 3 && el.inpIssStep3Price && Number(el.inpIssStep3Price.value) < pStar) {
    el.inpIssStep3Price.value = String(pStar);
  }

  const myAllot = rd.myPendingShaAllot;
  if (el.btnSignIssuanceShaClaim) {
    if (ph === 5 && myAllot && !myAllot.claimed) {
      el.btnSignIssuanceShaClaim.style.display = 'inline-flex';
      el.btnSignIssuanceShaClaim.disabled = state.busy;
      el.btnSignIssuanceShaClaim.textContent = `✍️ Sign SHA & Claim ${fmtNum(myAllot.shares)} ${clsName} (@ ${fmtNum(myAllot.clearingPrice)} SGD)`;
    } else {
      el.btnSignIssuanceShaClaim.style.display = 'none';
    }
  }
  if (el.btnRefundFailedIssuanceArena) {
    const canRefundArena =
      state.myCanGovern ||
      Boolean(myLow && (rd.issuanceOrders || []).some((o) => o.trader === myLow));
    el.btnRefundFailedIssuanceArena.style.display =
      (ph === 9 || rd.status === 3) && (rd.escrowCash || 0) > 0 && canRefundArena
        ? 'inline-flex'
        : 'none';
  }

  if (sum && (rd.allotments || []).length > 0) {
    el.issAllocStatusText.innerHTML = `Cleared <strong>${fmtNum(sum.targetShares)} ${escapeHtml(clsName)}</strong> @ <strong>${fmtNum(sum.clearingPrice)} SGD/sh</strong> • ROFR Priority: <strong>${fmtNum(sum.rofrAllocated)} sh</strong> • Step 2 Bidders Pro-Rata: <strong>${fmtNum(sum.biddersAllocated)} sh</strong> • ${
      sum.pendingShaCount > 0
        ? `<strong style="color:#fde68a;">${sum.pendingShaCount} new shareholder(s) awaiting Step 5 SHA signature!</strong>`
        : `<strong style="color:#6ee7b7;">All shares minted &amp; Cap Table updated!</strong>`
    }`;
    el.issAllotmentsTableWrap.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="inst-table">
          <thead>
            <tr>
              <th>Allotted Investor</th>
              <th>Priority Tier</th>
              <th>Allocated Shares</th>
              <th>Clearing Price</th>
              <th>Total Consideration</th>
              <th>Step 5 SHA &amp; Cap-Table Status</th>
            </tr>
          </thead>
          <tbody>
            ${rd.allotments
              .map(
                (a) => `
                <tr>
                  <td style="font-weight:700;color:#f8fafc;">${avatarForAddr(a.investor)} ${escapeHtml(session.labelForIdentity(a.investor))}</td>
                  <td><span class="inst-badge ${a.isRofr ? 'green' : 'cyan'}">${a.isRofr ? '🛡️ Step 3 ROFR (100% Priority)' : '💵 Step 2 Bidder (Pro-Rata)'}</span></td>
                  <td style="font-family:var(--mono);font-weight:800;color:#6ee7b7;">+${fmtNum(a.shares)} ${escapeHtml(clsName)}</td>
                  <td style="font-family:var(--mono);">${fmtNum(a.clearingPrice)} SGD</td>
                  <td style="font-family:var(--mono);">${fmtNum(a.shares * a.clearingPrice)} SGD</td>
                  <td>${
                    a.claimed
                      ? `<span class="inst-badge green">✓ SHA Signed &amp; Minted on Cap Table</span>`
                      : `<span class="inst-badge amber">⏳ Locked — Awaiting SHA Signature</span>`
                  }</td>
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    el.issAllotmentsTableWrap.innerHTML = '';
  }
}

function renderAuctionArena() {
  const hasSc = Boolean(session.inst?.shareCapital);
  el.auctionUnavailableNotice.style.display = hasSc ? 'none' : 'flex';
  if (el.guidedShareSaleCard) {
    el.guidedShareSaleCard.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.aucWin2SellRow) {
    el.aucWin2SellRow.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.aucWin2ReadonlyNote) {
    el.aucWin2ReadonlyNote.style.display = state.myIsShareholder ? 'none' : 'block';
  }
  if (el.aucWin3RofrRow) {
    el.aucWin3RofrRow.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.aucWin3ReadonlyNote) {
    el.aucWin3ReadonlyNote.style.display = state.myIsShareholder ? 'none' : 'block';
  }
  if (el.btnTestAuctionGuard) {
    el.btnTestAuctionGuard.style.display = state.myCanGovern ? 'inline-flex' : 'none';
  }
  if (el.btnNewAuctionInstance) {
    el.btnNewAuctionInstance.textContent = state.myIsShareholder
      ? '➕ Start Empty Sale Window'
      : '➕ Open Buyer Bid Window';
  }
  el.btnLaunchGuidedTransfer.disabled = !hasSc || !state.myIsShareholder || state.charterState !== 2 || state.busy;
  el.btnNewAuctionInstance.disabled = !hasSc || state.charterState !== 2 || state.busy;

  const stg = currentAuctionWindowStage();
  const steps = [
    { n: 0, title: 'Step 0: Spawn Auth', sub: state.activeAuctionAddr ? shortAddr(state.activeAuctionAddr) : 'initTransferAuction' },
    { n: 1, title: 'Window 1: Buyer Bids (≥1 Req)', sub: stg === -1 ? '🚫 Failed: 0 Bids!' : `${state.auctionStep1Bids} Active Bid(s)` },
    { n: 2, title: 'Window 2: Shareholder Sell', sub: 'Tag-along / Co-Sale Offers' },
    { n: 3, title: 'Window 3: ROFR Pre-Emption', sub: 'Non-Selling Holders Only' },
    { n: 4, title: 'Step 4: Pro-Rata Clearing', sub: stg === 5 ? '✓ Settled on Cap Table!' : 'Single Clearing Price P*' },
  ];

  el.auctionStepper.innerHTML = steps
    .map((s) => {
      const done = (s.n === 0 && (stg >= 1 || stg < 0)) || (s.n > 0 && stg > s.n);
      const active = (s.n === 1 && stg === 1) || (s.n === 2 && stg === 2) || (s.n === 3 && stg === 3) || (s.n === 4 && stg === 4);
      const failed = s.n === 1 && stg === -1;
      return `
        <div class="auc-step-card ${done ? 'done' : active ? 'active' : ''}" style="${failed ? 'border-color:rgba(248,113,113,0.65);background:rgba(127,29,29,0.35);' : ''}">
          <div style="font-size:11.5px;font-weight:800;color:${failed ? '#fca5a5' : done ? '#6ee7b7' : active ? '#7dd3fc' : 'var(--txt-1)'};">
            ${failed ? '🚫 ' : done ? '✓ ' : active ? '⚡ ' : ''}${escapeHtml(s.title)}
          </div>
          <div style="font-size:10.5px;font-family:var(--mono);color:var(--txt-2);">${escapeHtml(s.sub)}</div>
        </div>
      `;
    })
    .join('');

  const dl = state.auctionDeadlines;
  const blk = session.blockNumber;
  el.aucBlockReadout.textContent = `Current Block #${fmtNum(blk)}`;

  if (stg === 0) {
    el.aucClockLabel.textContent = 'No Active Auction — Click Trigger Full Run or Spawn New';
    el.aucClockLabel.style.color = '#7dd3fc';
    el.aucWindowProgressFill.style.width = '0%';
  } else if (stg === -1) {
    el.aucClockLabel.textContent = `🚫 PROCESS FAILED — 0 Bids in Window 1 Before #${fmtNum(dl.step1Dl)} (Rejected by CorporateCharter -97)`;
    el.aucClockLabel.style.color = '#fca5a5';
    el.aucWindowProgressFill.style.width = '100%';
  } else if (stg === -2) {
    el.aucClockLabel.textContent = `⏰ AUCTION EXPIRED — Refund Escrowed Buyer Cash if Any`;
    el.aucClockLabel.style.color = '#fcd34d';
    el.aucWindowProgressFill.style.width = '100%';
  } else if (stg === 1 && !dl.step1Dl) {
    el.aucClockLabel.textContent = `Auction ${shortAddr(state.activeAuctionAddr)} Ready — Place Buyer Bid!`;
    el.aucClockLabel.style.color = '#7dd3fc';
    el.aucWindowProgressFill.style.width = '12%';
  } else if (stg === 1) {
    const rem = Math.max(0, dl.step1Dl - blk);
    el.aucClockLabel.textContent = `🟢 WINDOW 1 LIVE (${state.auctionStep1Bids} Bid${state.auctionStep1Bids === 1 ? '' : 's'} • ≥1 Req) • ${rem} blk(s) left (#${fmtNum(dl.step1Dl)})`;
    el.aucClockLabel.style.color = '#7dd3fc';
    el.aucWindowProgressFill.style.width = '30%';
  } else if (stg === 2) {
    const rem = Math.max(0, dl.step2Dl - blk);
    el.aucClockLabel.textContent = `🟡 WINDOW 2 LIVE (Shareholder Co-Sale) • ${rem} block(s) left (closes #${fmtNum(dl.step2Dl)})`;
    el.aucClockLabel.style.color = '#fcd34d';
    el.aucWindowProgressFill.style.width = '58%';
  } else if (stg === 3) {
    const rem = Math.max(0, dl.step3Dl - blk);
    el.aucClockLabel.textContent = `🛡️ WINDOW 3 LIVE (Non-Seller ROFR) • ${rem} block(s) left (closes #${fmtNum(dl.step3Dl)})`;
    el.aucClockLabel.style.color = '#6ee7b7';
    el.aucWindowProgressFill.style.width = '84%';
  } else if (stg === 4) {
    el.aucClockLabel.textContent = `⚡ ALL 3 WINDOWS COMPLETE — Ready to Settle Pro-Rata Clearing!`;
    el.aucClockLabel.style.color = '#6ee7b7';
    el.aucWindowProgressFill.style.width = '96%';
  } else {
    el.aucClockLabel.textContent = `🏆 SETTLED & CONSUMED — Last Clearing: ${fmtNum(state.lastSettlement.matchedQty)} @ ${fmtNum(state.lastSettlement.clearingPrice)} SGD`;
    el.aucClockLabel.style.color = '#6ee7b7';
    el.aucWindowProgressFill.style.width = '100%';
  }

  if (dl.step1Dl > 0) {
    el.aucDeadlinesSub.textContent = `Win 1 (≥1 Bid Req) ≤ #${fmtNum(dl.step1Dl)} • Win 2 ≤ #${fmtNum(dl.step2Dl)} • Win 3 (ROFR) ≤ #${fmtNum(dl.step3Dl)}`;
  }

  el.aucEscrowBalance.textContent = `${fmtNum(state.auctionEscrowCash)} SGD`;
  const proj = computeProjectedClearing(state.auctionOrders);
  if (stg === -1) {
    el.aucProjectedClearing.textContent = 'FAILED (0 Bids)';
    el.aucProjectedRule.textContent = 'Rejected by CorporateCharter (-97)';
  } else if (proj) {
    el.aucProjectedClearing.textContent = `${fmtNum(proj.pStar)} SGD × ${fmtNum(proj.matchedVol)}`;
    el.aucProjectedRule.textContent = proj.rule;
  } else if (state.lastSettlement.matchedQty > 0 && stg === 5) {
    el.aucProjectedClearing.textContent = `${fmtNum(state.lastSettlement.clearingPrice)} SGD × ${fmtNum(state.lastSettlement.matchedQty)}`;
    el.aucProjectedRule.textContent = `Cleared Demand ${fmtNum(state.lastSettlement.buyDemand)} vs Supply ${fmtNum(state.lastSettlement.sellSupply)}`;
  } else {
    el.aucProjectedClearing.textContent = 'Awaiting Crossing Orders';
    el.aucProjectedRule.textContent = 'Maximizes min(Demand, Supply)';
  }

  el.aucColWin1.classList.toggle('live-window', stg === 1);
  el.aucColWin1.classList.toggle('step-done', stg > 1);
  el.aucColWin1.classList.toggle('step-locked', stg === 0);

  el.aucColWin2.classList.toggle('live-window', stg === 2);
  el.aucColWin2.classList.toggle('step-done', stg > 2);
  el.aucColWin2.classList.toggle('step-locked', stg < 2);

  el.aucColWin3.classList.toggle('live-window', stg === 3);
  el.aucColWin3.classList.toggle('step-done', stg > 3);
  el.aucColWin3.classList.toggle('step-locked', stg < 3);
  el.aucBadgeWin1.textContent =
    stg === -1 ? 'FAILED (0 Bids)' : stg === 1 ? `LIVE (${state.auctionStep1Bids} Bid)` : stg > 1 ? `Passed (${state.auctionStep1Bids})` : 'Ready';
  el.aucBadgeWin2.textContent = stg === -1 ? 'Blocked (-97)' : stg === 2 ? 'LIVE NOW' : stg > 2 ? 'Closed' : 'After Win 1';
  el.aucBadgeWin3.textContent = stg === -1 ? 'Blocked (-97)' : stg === 3 ? 'LIVE NOW' : stg > 3 ? 'Closed' : 'After Win 2';

  const myLow = activeVerifiedIdentityLow();
  const renderOrderList = (sideCode, canCancelNow) => {
    const items = state.auctionOrders.filter((o) => o.side === sideCode);
    if (!items.length) {
      return `<div style="font-size:11px;color:var(--txt-2);padding:6px 0;">No orders in this window yet.</div>`;
    }
    return items
      .map(
        (o) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(15,23,42,0.85);border:1px solid var(--line);font-size:11px;font-family:var(--mono);">
          <div>
            <div style="color:#f8fafc;font-weight:700;">${avatarForAddr(o.trader)} ${escapeHtml(session.labelForIdentity(o.trader).split('·')[0].trim())}</div>
            <div style="color:#6ee7b7;">${fmtNum(o.quantity)} sh @ ${fmtNum(o.price)} SGD</div>
          </div>
          ${
            canCancelNow && myLow && o.trader === myLow
              ? `<button type="button" class="inst-btn sm rose" data-cancel-auc-order="${o.index}">Cancel</button>`
              : `<span style="color:var(--txt-2);">#${o.index}</span>`
          }
        </div>
      `
      )
      .join('');
  };

  el.aucOrdersWin1.innerHTML = renderOrderList(1, stg === 1);
  el.aucOrdersWin2.innerHTML = renderOrderList(2, false);
  el.aucOrdersWin3.innerHTML = renderOrderList(3, stg === 3);

  const isAuctionParticipantOrInsider =
    state.myCanGovern ||
    Boolean(myLow && state.auctionOrders.some((o) => o.trader === myLow));
  if (el.btnSettleAuction) {
    el.btnSettleAuction.style.display = isAuctionParticipantOrInsider ? 'inline-flex' : 'none';
    el.btnSettleAuction.disabled = stg !== 4 || state.busy;
  }
  if (el.btnRefundFailedAuction) {
    el.btnRefundFailedAuction.style.display =
      (stg === -1 || stg === -2 || state.auctionStatus === 3) &&
      state.auctionEscrowCash > 0 &&
      isAuctionParticipantOrInsider
        ? 'inline-flex'
        : 'none';
  }
}

function renderFuturesAndDex() {
  const sc = session.inst?.shareCapital;
  const hasFut = state.futuresLedger && state.futuresLedger !== ZERO_ADDR && state.futuresPct > 0;
  el.futStatusBadge.textContent = hasFut ? `ACTIVE (${state.futuresPct}% Cap)` : sc ? 'Awaiting Resolution' : 'Incorporate Company First';
  el.futStatusBadge.className = `inst-badge ${hasFut ? 'green' : 'amber'}`;

  const alw = state.futuresAllowance;
  el.futMetricsBox.innerHTML = `
    <div style="padding:10px 12px;border-radius:10px;background:rgba(7,13,26,0.8);border:1px solid var(--line);">
      <div style="font-size:10px;color:var(--txt-2);font-family:var(--mono);">YOUR MAX ALLOWANCE</div>
      <div style="font-size:17px;font-weight:800;font-family:var(--mono);color:#7dd3fc;">${fmtNum(alw.maxAllowance)} FUT</div>
      <div style="font-size:10.5px;color:var(--txt-2);">${state.futuresPct}% of ${fmtNum(alw.convertedCommon)} shares</div>
    </div>
    <div style="padding:10px 12px;border-radius:10px;background:rgba(7,13,26,0.8);border:1px solid var(--line);">
      <div style="font-size:10px;color:var(--txt-2);font-family:var(--mono);">OPEN / WALLET BALANCE</div>
      <div style="font-size:17px;font-weight:800;font-family:var(--mono);color:#6ee7b7;">${fmtNum(state.myFuturesBal)} FUT</div>
      <div style="font-size:10.5px;color:var(--txt-2);">Remaining cap: ${fmtNum(alw.remainingAllowance)}</div>
    </div>
  `;

  const canUseFutMint = state.myIsShareholder || state.myFuturesBal > 0;
  if (el.futReadonlyNote) {
    el.futReadonlyNote.style.display = !state.myIsShareholder && state.myFuturesBal === 0 ? 'block' : 'none';
  }
  if (el.futStep1AuthBox) {
    el.futStep1AuthBox.style.display = state.myIsShareholder ? 'flex' : 'none';
  }
  if (el.futStep2MintBox) {
    el.futStep2MintBox.style.display = canUseFutMint ? 'flex' : 'none';
  }
  el.btnUnderwriteFutures.style.display = state.myIsShareholder ? 'inline-flex' : 'none';
  el.btnUnderwriteFutures.disabled = !hasFut || !state.myIsShareholder || state.busy;
  el.btnCloseFutures.style.display = state.myFuturesBal > 0 ? 'inline-flex' : 'none';
  el.btnCloseFutures.disabled = !hasFut || state.myFuturesBal === 0 || state.busy;
  el.btnQuickAuthorizeFutures.disabled = !sc || !state.myIsShareholder || state.charterState !== 2 || state.busy;

  const hasDex = state.attachedDex && state.attachedDex !== ZERO_ADDR;
  el.futDexBadge.textContent = hasDex ? `Attached (${shortAddr(state.attachedDex)})` : 'Not Attached';
  el.futDexBadge.className = `inst-badge ${hasDex ? 'green' : 'amber'}`;

  if (!hasFut) {
    el.futDexPanel.innerHTML = `
      <div style="padding:16px;border-radius:11px;border:1px dashed var(--line);color:var(--txt-2);font-size:12px;">
        ${
          state.myIsShareholder
            ? 'Complete <strong>Step 1 (Authorize Futures Underwriting)</strong> on the left first — then attach a dedicated <code>dex_clob.wasm</code> matching engine with 1 click!'
            : 'Shareholders of this company have not enabled a Share-Backed Futures facility yet.'
        }
      </div>
    `;
  } else if (!hasDex) {
    el.futDexPanel.innerHTML = state.myCanGovern
      ? `
        <div style="font-size:12.5px;color:var(--txt-1);line-height:1.5;">
          Futures Ledger <code>${shortAddr(state.futuresLedger)}</code> is live! Deploy &amp; attach an MEV-proof <strong>Two-Tier AVL Central Limit Orderbook (<code>dex_clob.wasm</code>)</strong> and register it in <code>HfsRegistry</code>:
        </div>
        <button type="button" class="inst-btn emerald" id="btnAttachFuturesDex" style="padding:11px 16px;font-size:13px;">
          📈 Deploy &amp; Attach DEX CLOB to Futures Ledger
        </button>
      `
      : `
        <div style="padding:16px;border-radius:11px;border:1px dashed var(--line);color:var(--txt-2);font-size:12px;">
          Futures Ledger <code>${shortAddr(state.futuresLedger)}</code> is authorized (${state.futuresPct}% cap), awaiting DEX CLOB attachment by a company Director or Shareholder.
        </div>
      `;
  } else {
    el.futDexPanel.innerHTML = `
      <div style="padding:12px 14px;border-radius:11px;background:rgba(6,40,32,0.55);border:1px solid rgba(16,185,129,0.45);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:12.5px;font-weight:800;color:#a7f3d0;">✓ DEX CLOB Attached (${shortAddr(state.attachedDex)})</div>
          <div style="font-size:11px;font-family:var(--mono);color:var(--txt-2);">
            Top of Book: Bid ${state.futuresDexBest.bestBid || '—'} × Ask ${state.futuresDexBest.bestAsk || '—'} SGD
          </div>
        </div>
        <a class="inst-btn emerald sm" href="/dex.html?hfs=${state.attachedDex}">
          ↗ Open Full Futures Orderbook in DEX App
        </a>
      </div>
      ${
        state.myIsShareholder || state.myFuturesBal > 0
          ? `
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input class="inst-input" id="inpFutAskQty" type="number" min="10" value="250" style="width:105px;" />
              <span style="font-size:11px;font-family:var(--mono);color:var(--txt-2);">FUT @</span>
              <input class="inst-input" id="inpFutAskPrice" type="number" min="1" value="45" style="width:90px;" />
              <span style="font-size:11px;font-family:var(--mono);color:var(--txt-2);">SGD</span>
              <button type="button" class="inst-btn primary sm" id="btnQuickListFuturesAsk">
                🔴 List Underwritten Futures on DEX
              </button>
            </div>
          `
          : ''
      }
    `;
  }
}

function renderEventItemHtml(ev) {
  return `
    <div class="chr-event-item">
      <span style="font-size:17px;line-height:1.1;">${ev.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="font-size:12px;color:#f8fafc;">${escapeHtml(ev.title)}</strong>
          <span class="inst-badge ${ev.badge}">Blk #${fmtNum(ev.blk)} • ${escapeHtml(ev.kind)}</span>
        </div>
        <div style="font-size:11px;color:var(--txt-2);font-family:var(--mono);margin-top:2px;">
          ${escapeHtml(ev.detail)} ${ev.txHash ? `• tx ${ev.txHash.slice(0, 10)}…` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderEventFeeds() {
  el.eventCountBadge.textContent = `${state.eventLogs.length} events`;
  el.liveEventFeed.innerHTML = state.eventLogs.length
    ? state.eventLogs.slice(0, 25).map(renderEventItemHtml).join('')
    : `<div style="font-size:12px;color:var(--txt-2);padding:8px;">Waiting for CorporateCharter, Authorization, ShareCapital &amp; AssetLedger event logs…</div>`;

  const aucLogs = state.eventLogs.filter((e) => e.category === 'auction' || e.category === 'captable');
  if (el.auctionEventLogs) {
    el.auctionEventLogs.innerHTML = aucLogs.length
      ? aucLogs.slice(0, 20).map(renderEventItemHtml).join('')
      : `<div style="font-size:12px;color:var(--txt-2);padding:8px;">Launch a Share Transfer above to stream Window 1, Window 2, Window 3 (ROFR) &amp; Pro-Rata Settlement logs here!</div>`;
  }

  const issLogs = state.eventLogs.filter(
    (e) => e.category === 'issuance' || e.category === 'resolution' || e.category === 'captable' || e.category === 'auction'
  );
  if (el.issuanceEventLogs) {
    el.issuanceEventLogs.innerHTML = issLogs.length
      ? issLogs.slice(0, 20).map(renderEventItemHtml).join('')
      : `<div style="font-size:12px;color:var(--txt-2);padding:8px;">Launch a 5-Step Share Issuance Round above to stream Step 1 Resolution, Step 2 Bidding, Step 3 ROFR, Step 4 Pro-Rata Allocation &amp; Step 5 SHA Mint logs here!</div>`;
  }
}

// ---------------------------------------------------------------------------
// Execution Calldata Builder & Resolution Enactment
// ---------------------------------------------------------------------------

function buildResolutionExecCalldata(r) {
  const chr = session.inst.corporateCharter;
  const sc = session.inst.shareCapital;
  const subj = r.targetAddr || r.execSubjectAddr;
  if (r.execKind === 'activateCharter') {
    return encodeAbi('activateCharter(address,address)', [
      ['address', chr],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'addDirector') {
    return encodeAbi('addDirector(address,address,address)', [
      ['address', chr],
      ['address', subj],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'removeDirector') {
    return encodeAbi('removeDirector(address,address,address)', [
      ['address', chr],
      ['address', subj],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'grantRole') {
    return encodeAbi('grantRole(address,bytes32,address,address)', [
      ['address', chr],
      ['bytes32', r.roleId],
      ['address', subj],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'revokeRole') {
    return encodeAbi('revokeRole(address,bytes32,address,address)', [
      ['address', chr],
      ['bytes32', r.roleId],
      ['address', subj],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'issueSharesAuction' || r.execKind === 'equityFinancing') {
    const targetLed = r.targetShareLedger || r.targetHps || session.inst.shareLedger;
    const inner = encodeAbi('settleShareIssuance(address,address)', [
      ['address', targetLed],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', sc],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'shareBuyback') {
    const inner = encodeAbi('executeShareBuyback(address,address,uint64,uint64,address)', [
      ['address', r.shareClassLedger || session.inst.shareLedger],
      ['address', subj],
      ['uint64', r.buybackShares],
      ['uint64', r.buybackPrice],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', sc],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'shareSplit') {
    const inner = encodeAbi('executeShareSplit(address,uint64,address)', [
      ['address', r.shareClassLedger || session.inst.shareLedger],
      ['uint64', r.splitRatio],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', sc],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'reverseShareSplit') {
    const inner = encodeAbi('executeReverseShareSplit(address,uint64,address)', [
      ['address', r.shareClassLedger || session.inst.shareLedger],
      ['uint64', r.splitRatio],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', sc],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'createEsopProgram') {
    const inner = encodeAbi('createEsopProgram(address,address,uint64,uint64,uint64,uint64,address)', [
      ['address', r.optionLedger],
      ['address', r.underlyingLedger],
      ['uint64', r.esopClassCode],
      ['uint64', r.esopConvRate],
      ['uint64', r.esopAuthShares],
      ['uint64', r.esopStrikePrice],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', sc],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'awardEmployeeOptions') {
    const inner = encodeAbi('awardEmployeeOptions(uint64,address,uint64,uint64,bytes,address)', [
      ['uint64', r.esopProgramId],
      ['address', subj],
      ['uint64', r.esopCliffBlock],
      ['uint64', r.esopCliffTimestamp || 0],
      ['bytes', hexToBytes(r.esopScheduleHex)],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', sc],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'issueShares') {
    return encodeAbi('issueAsset(address,address,uint64,address)', [
      ['address', session.inst.shareLedger],
      ['address', subj],
      ['uint64', r.issueAmount],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'setTreasury') {
    const inner = encodeAbi('setTreasuryAccount(address,address)', [
      ['address', subj],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', chr],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'authorizeFutures') {
    return encodeAbi('authorizeFuturesUnderwriting(address,address,uint64,address)', [
      ['address', sc],
      ['address', r.futuresLedger],
      ['uint64', r.futuresPct],
      ['address', r.authAddr],
    ]);
  }
  if (r.execKind === 'crowdfundingCampaign') {
    if (r.viaAccountingActivate && r.accountingLedger) {
      const inner = encodeAbi('activateCrowdfundingCampaign(address,address)', [
        ['address', r.crowdfundingHps || r.targetHps],
        ['address', r.authAddr],
      ]);
      return encodeAbi('execute(address,bytes)', [
        ['address', r.accountingLedger],
        ['bytes', hexToBytes(inner)],
      ]);
    }
    const inner = encodeAbi('activateCampaign(address)', [['address', r.authAddr]]);
    return encodeAbi('execute(address,bytes)', [
      ['address', r.crowdfundingHps || r.targetHps],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  if (r.execKind === 'serviceContract') {
    const inner = encodeAbi('proposeServiceContract(address,bytes32,uint64,uint64,uint64,address)', [
      ['address', subj],
      ['bytes32', r.svcTagHex || encodeSvcTagBytes32(r.svcCode || 'DEF-MOD-FLRC-C2')],
      ['uint64', r.svcMonthly || 180000],
      ['uint64', r.svcMonths || 12],
      ['uint64', r.svcMonthBlocks || 35],
      ['address', r.authAddr],
    ]);
    return encodeAbi('execute(address,bytes)', [
      ['address', r.targetHps],
      ['bytes', hexToBytes(inner)],
    ]);
  }
  throw new Error(`Unsupported resolution execKind: ${r.execKind}`);
}

async function signMyDirectorConsent() {
  if (state.busy || !session.inst?.corporateCharter) return;
  if (!state.myNeedsDirectorConsent || !activeVerifiedIdentityLow()) {
    showBanner(
      '🔒 Your verified wallet Identity is not pending Director consent on this CorporateCharter.',
      'err'
    );
    return;
  }
  state.busy = true;
  try {
    const myId = await session.ensureMyIdentity((m) => startInflightAnim(m));
    const chr = session.inst.corporateCharter;
    startInflightAnim(`Signing personal Consent to Act as Director (${shortAddr(myId)})…`);
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', chr],
        ['bytes', hexToBytes(encodeAbi('consentToDirectorship()'))],
      ]),
      'consentToDirectorship()',
      'CorporateCharter',
      [chr]
    );
    await session.wallet
      .setHfsAssociation({
        hfsAddr: chr,
        typeName: 'CORPORATE_CHARTER',
        status: 2,
        label: companyNameStr(),
        rpcUrl: session.rpcUrl,
      })
      .catch(() => {});
    finishInflightAnim('✍️ Personal Director Consent Recorded & Company Whitelisted!');
    triggerSparkBurst(['#34d399', '#38bdf8', '#fbbf24']);
    await refreshCharterWorld();
    showBanner(
      state.charterState === 1
        ? `✅ <strong>Director Consent Signed!</strong> Your personal consent is recorded on-chain — once ≥75% Shareholders &amp; all Initial Directors consent, enact Resolution #0001 to activate the Charter!`
        : `✅ <strong>Director Consent Signed &amp; Board Seat Activated!</strong> You are now an Active Director on the Corporate Organization Chart!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Director consent failed');
    showBanner(`🚫 Director consent error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
}

async function signAndEnactResolution(r) {
  if (!r || state.busy) return;
  if (r.failedBidsStage) {
    showBanner(
      `🚫 <strong>Capital Process Rejected (-97)!</strong> Step 2 closed with 0 bidders or total demand fell short — <code>CorporateCharter.validateCapitalProcessAuth</code> rejects enactment!`,
      'err'
    );
    return;
  }
  if (r.isEquityFinancing && r.issPhase >= 2) {
    state.activeIssuanceAddr = r.authAddr.toLowerCase();
    if (session.inst?.corporateCharter) {
      saveIssuanceAddr(session.inst.corporateCharter, state.activeIssuanceAddr);
    }
    switchTab('issuance');
    await refreshCharterWorld();
    return;
  }
  const standing = getResolutionStandingForMe(r);
  if (!standing.canActNow) {
    showBanner(
      `🔒 <strong>Standing Required:</strong> Only verified ${
        r.isBoard ? 'Board Directors' : 'Shareholders'
      } of <strong>${escapeHtml(companyNameStr())}</strong> can sign or enact this resolution.`,
      'err'
    );
    return;
  }
  if (
    r.isIssuanceAuction &&
    (!r.issPhase || r.issPhase === 0) &&
    r.status === 1 &&
    (r.currentStage === 0 || (r.step1Dl > 0 && session.blockNumber <= r.step1Dl))
  ) {
    showBanner(
      `⏳ <strong>Bids Stage Still Counting Down!</strong> Investor Buy Orders close at Block #${fmtNum(
        r.step1Dl
      )}!`,
      'info'
    );
    return;
  }
  state.busy = true;
  try {
    const myId = await session.ensureMyIdentity((m) => startInflightAnim(m));
    const chr = session.inst.corporateCharter;
    const allClassLedgers = state.shareClasses.map((c) => c.ledger);

    // If enacting activateCharter and current user is an unconsented Initial Director, record personal consent too!
    if (r.execKind === 'activateCharter' && state.myNeedsDirectorConsent) {
      startInflightAnim('Step 1/2: Signing your personal Consent to Act as Initial Director…');
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', chr],
          ['bytes', hexToBytes(encodeAbi('consentToDirectorship()'))],
        ]),
        'consentToDirectorship()',
        'CorporateCharter',
        [chr]
      );
    }

    if (r.status === 1) {
      const myExpectedWeight = r.isBoard ? (state.myIsDirector ? 1 : 0) : state.myVotes;
      if (!r.mySigned && myExpectedWeight > 0) {
        if (r.isEquityFinancing && (!r.issPhase || r.issPhase === 0)) {
          const shaHex =
            r.shaHash ||
            (await session.ethCall(r.authAddr, encodeAbi('shaTemplateHash()'))).slice(0, 66);
          const fnSig =
            r.weight + myExpectedWeight >= r.reqWeight
              ? 'signShareholdersAgreementAndFinalize(bytes32)'
              : 'signShareholdersAgreement(bytes32)';
          startInflightAnim(`Signing Shareholders' Agreement (${shortAddr(r.authAddr)})…`);
          await session.sendAsMyIdentity(
            encodeAbi('execute(address,bytes)', [
              ['address', r.authAddr],
              ['bytes', hexToBytes(encodeAbi(fnSig, [['bytes32', shaHex]]))],
            ]),
            fnSig.split('(')[0],
            'Authorization',
            [r.authAddr, chr, r.targetHps, ...allClassLedgers]
          );
        } else if (r.weight + myExpectedWeight >= r.reqWeight) {
          startInflightAnim(`Signing approveAndFinalizeAuth(${shortAddr(r.authAddr)}) with your wallet…`);
          await session.sendAsMyIdentity(
            encodeAbi('approveAndFinalizeAuth(address)', [['address', r.authAddr]]),
            'approveAndFinalizeAuth',
            'Authorization',
            [r.authAddr, chr, r.targetHps, ...allClassLedgers]
          );
        } else {
          startInflightAnim(`Recording your vote approveAuth(${shortAddr(r.authAddr)})…`);
          await session.sendAsMyIdentity(
            encodeAbi('approveAuth(address)', [['address', r.authAddr]]),
            'approveAuth',
            'Authorization',
            [r.authAddr, chr, r.targetHps, ...allClassLedgers]
          );
        }
      } else if (r.weight >= r.reqWeight && !(r.isEquityFinancing && r.issPhase >= 1)) {
        startInflightAnim(`Finalizing threshold-approved Authorization ${shortAddr(r.authAddr)}…`);
        await session.sendAsMyIdentity(
          encodeAbi('finalizeAuth(address)', [['address', r.authAddr]]),
          'finalizeAuth',
          'Authorization',
          [r.authAddr, chr, r.targetHps, ...allClassLedgers]
        );
      }
    }

    if (r.isEquityFinancing && r.issPhase >= 1) {
      state.activeIssuanceAddr = r.authAddr.toLowerCase();
      saveIssuanceAddr(chr, state.activeIssuanceAddr);
      await refreshCharterWorld();
      const updated = state.resolutions.find(
        (x) => x.authAddr.toLowerCase() === r.authAddr.toLowerCase()
      );
      if (updated && updated.issPhase >= 2) {
        finishInflightAnim('🎉 Step 1 Resolution Passed (≥75%) → Step 2 Investor Bidding Now LIVE!');
        triggerSparkBurst(['#34d399', '#38bdf8', '#fbbf24']);
        switchTab('issuance');
        showBanner(
          isSimManagedCharter()
            ? `🚀 <strong>Step 1 Shareholder Resolution Passed (≥75%)!</strong> The round automatically entered <strong>Step 2 (Prospective Investor Bidding)</strong> — watch AI Investors bid &amp; Step 3 ROFR open next!`
            : `🚀 <strong>Step 1 Shareholder Resolution Passed (≥75%)!</strong> The round automatically entered <strong>Step 2 (Prospective Investor Bidding)</strong> — prospective investors can now submit bids before Step 3 ROFR opens!`,
          'ok'
        );
      } else {
        finishInflightAnim('✓ Step 1 Vote Recorded — Waiting for ≥75% Shareholder Quorum…');
        showBanner(
          `✍️ Your Step 1 Shareholder Resolution vote is recorded! Once ≥75% quorum passes, Step 2 Investor Bidding opens automatically.`,
          'info'
        );
      }
      return;
    }

    // Re-check ready state before target consumption
    const readyNow =
      decodeUintWord(await session.ethCall(r.authAddr, encodeAbi('isReadyToConsume()'))) === 1;
    if (!readyNow) {
      finishInflightAnim('✓ Signature recorded! Waiting for remaining co-signers to reach quorum…');
      await refreshCharterWorld();
      showBanner(
        `✍️ Your signature is recorded on-chain! Waiting for remaining co-signers to complete quorum.`,
        'info'
      );
      return;
    }

    if (r.execKind === 'activateCharter') {
      const missingDirs = decodeUintWord(
        await session.ethCall(chr, encodeAbi('unconsentedDirectorCount()')).catch(() => '0x0')
      );
      if (missingDirs > 0) {
        finishInflightAnim('🗳️ ≥75% Shareholder Quorum Finalized — Awaiting Initial Director Consent!');
        await refreshCharterWorld();
        const names = state.directors
          .filter((d) => !d.consented)
          .map((d) => d.label)
          .join(', ');
        showBanner(
          `🔒 <strong>Shareholder Super-Majority Finalized, but Company Remains Pending Director Consent!</strong> Constitutional guard (<code>-96</code>) requires <strong>${escapeHtml(
            names || `${missingDirs} named Initial Director(s)`
          )}</strong> to sign <code>consentToDirectorship()</code> before the CorporateCharter can activate!`,
          'info'
        );
        return;
      }
    }

    startInflightAnim(`Enacting ${r.execKind} & consuming one-time Authorization HFS…`);
    const enactTargets = Array.from(
      new Set(
        [
          chr,
          r.authAddr,
          r.targetHps,
          r.targetShareLedger,
          r.shareClassLedger,
          r.optionLedger,
          r.underlyingLedger,
          r.futuresLedger,
          r.targetAddr || myId,
          session.inst.shareCapital,
          session.inst.shareLedger,
          session.inst.fiatLedger,
          session.inst.merchantRevenueIdentity,
          session.inst.dexEscrowIdentity,
          ...allClassLedgers,
          ...(r.issuanceOrders || []).map((o) => o.trader),
        ].filter((a) => a && a !== ZERO_ADDR)
      )
    );
    await session.sendAsMyIdentity(
      buildResolutionExecCalldata(r),
      r.execKind,
      'CorporateCharter',
      enactTargets
    );

    if (r.execKind === 'serviceContract' && r.targetHps) {
      // Read assigned service contract ID from AccountingLedger (`counts[6] - 1`) and co-sign if Client is AI pool or You!
      try {
        const stmtHex = await session.ethCall(r.targetHps, encodeAbi('getFinancialStatements()'));
        const sb = hexToBytes(stmtHex);
        if (sb.length >= 640) {
          const svcCnt =
            ((sb[636] << 24) | (sb[637] << 16) | (sb[638] << 8) | sb[639]) >>> 0;
          if (svcCnt > 0) {
            const svcId = svcCnt - 1;
            const clientLow = (r.targetAddr || '').toLowerCase();
            const cosignInner = encodeAbi('coSignServiceContract(uint64)', [['uint64', svcId]]);
            const cosignOuter = encodeAbi('execute(address,bytes)', [
              ['address', r.targetHps],
              ['bytes', hexToBytes(cosignInner)],
            ]);
            if (clientLow === (myId || '').toLowerCase()) {
              startInflightAnim(`Stage 1B: Co-signing Service Contract #${svcId} with your Client Wallet…`);
              await session.sendAsMyIdentity(
                cosignOuter,
                `coSignServiceContract(#${svcId})`,
                'AccountingLedger',
                [r.targetHps, chr, clientLow]
              );
            }
          }
        }
      } catch (csErr) {
        console.warn('Service contract auto-cosign note:', csErr);
      }
      const totalVal = fmtNum(Number(r.svcMonthly || 0) * Number(r.svcMonths || 0));
      finishInflightAnim(`🛡️ Contract ${r.svcCode} Ratified (+${totalVal} SGD Backlog)!`);
      triggerSparkBurst(['#22d3ee', '#10b981', '#fbbf24']);
      await refreshCharterWorld();
      showBanner(
        `✅ <strong>${escapeHtml(r.title)} Ratified!</strong> Upon Client co-signature, <strong>+${totalVal} SGD</strong> books into <code>1800 Future Contract Receivables</code> on <code>AccountingLedger</code>! <a href="/accounting.html?hfs=${r.targetHps}" style="color:#6ee7b7;text-decoration:underline;font-weight:800;">Open Realtime Balance Sheet &amp; DCF Valuation ↗</a>`,
        'ok'
      );
      return;
    }

    finishInflightAnim(`🏛️ ${r.title} Enacted!`);
    triggerSparkBurst();
    await refreshCharterWorld();
    showBanner(
      `✅ <strong>${escapeHtml(r.title)} Enacted on Subnet 1!</strong> Capitalization Table / Organization Chart / ESOP state updated reactively.`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Transaction reverted or cancelled');
    await refreshCharterWorld();
    showBanner(`🚫 Governance error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
    renderActionStudioState();
  }
}

// Verify C-Suite role is defined on CorporateCharter before proposing grantRole
async function ensureRoleDefinedIfNeeded(roleId, roleName) {
  const chr = session.inst.corporateCharter;
  const defined =
    decodeUintWord(await session.ethCall(chr, encodeAbi('isRoleDefined(bytes32)', [['bytes32', roleId]]))) === 1;
  if (!defined) {
    throw new Error(`Role ${roleName} is not defined on this CorporateCharter yet.`);
  }
}

// ---------------------------------------------------------------------------
// Proposing Any Corporate Action Resolution (Tab 2 & Quick Org-Chart Triggers)
// ---------------------------------------------------------------------------

function deriveTickerFromClassName(baseSym, labelStr) {
  const clean = String(labelStr || 'Preferred A').trim();
  const m = clean.match(/preferred\s+([a-z0-9]+)/i);
  const suffix = m
    ? `P${m[1].toUpperCase().slice(0, 4)}`
    : clean
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 5) || 'PREF';
  return `${baseSym}-${suffix}`.slice(0, 14);
}

async function ensureShareClassLedger(classKey, convRate, customClassName = '') {
  const chr = session.inst.corporateCharter.toLowerCase();
  const baseSym = shareTickerStr().replace(/-EQ$/, '').slice(0, 8);
  if (classKey === 'COMMON') {
    return {
      ledger: session.inst.shareLedger.toLowerCase(),
      symbol: shareTickerStr(),
      classLabel: 'Common',
      classCode: 0,
      convRate: 1,
    };
  }

  // 1. Direct existing ShareClass ledger address (`0x...`) selected from dropdown
  if (/^0x[0-9a-f]{40}$/i.test(classKey)) {
    const found = state.shareClasses.find((c) => c.ledger === classKey.toLowerCase());
    if (found) {
      return {
        ledger: found.ledger,
        symbol: found.symbol,
        classLabel: found.classLabel || found.symbol,
        classCode: found.ledger === session.inst.shareLedger.toLowerCase() ? 0 : 3,
        convRate: Math.max(1, Math.round(found.convMult)),
      };
    }
  }

  const classLabel =
    classKey === 'PREFERRED_A'
      ? 'Preferred A'
      : classKey === 'PREFERRED_B'
        ? 'Preferred B'
        : String(customClassName || 'Preferred A')
            .trim()
            .slice(0, 28) || 'Preferred A';
  const classCode =
    classLabel.toLowerCase() === 'preferred a'
      ? 1
      : classLabel.toLowerCase() === 'preferred b'
        ? 2
        : 3;
  const targetSym = deriveTickerFromClassName(baseSym, classLabel);
  const normKey = `PREF:${classLabel.toUpperCase()}`;

  // 2. Reuse if already registered on CorporateCharter by label or ticker
  const existingOnChain = state.shareClasses.find(
    (c, idx) =>
      idx > 0 &&
      ((c.classLabel || '').toUpperCase() === classLabel.toUpperCase() ||
        c.symbol.toUpperCase() === classLabel.toUpperCase() ||
        (c.tickerOnly || c.symbol).toUpperCase() === targetSym.toUpperCase())
  );
  if (existingOnChain) {
    return {
      ledger: existingOnChain.ledger,
      symbol: existingOnChain.symbol,
      classLabel: existingOnChain.classLabel || classLabel,
      classCode,
      convRate: Math.max(1, Math.round(existingOnChain.convMult)),
    };
  }

  // 3. Reuse if already deployed & saved locally for this Charter
  const savedMap = loadSavedPreferredLedgers(chr);
  const savedEntry = savedMap[normKey] || savedMap[classKey];
  if (savedEntry?.ledger) {
    const chk = decodeAddrWord(
      await session.ethCall(savedEntry.ledger, encodeAbi('associatedCharter()')).catch(() => ZERO_ADDR)
    );
    if (chk === chr) {
      return {
        ledger: savedEntry.ledger,
        symbol: classLabel,
        classLabel,
        classCode,
        convRate: Math.max(1, Number(convRate || savedEntry.convRate || 1)),
      };
    }
  }

  // 4. Instantiate & initialize a fresh pinned Preferred Share AssetLedger
  startInflightAnim(`Deploying pinned ${classLabel} (${targetSym}) Preferred Share AssetLedger…`);
  const prefRcpt = await session.sendRawSigned({
    privateKey: session.wallet.keypair.privateKey,
    to: null,
    dataHex: session.codeHashes.asset_ledger,
    label: `instantiate(${targetSym})`,
    contractLabel: `AssetLedger(${classLabel})`,
    gasLimit: 4_800_000n,
  });
  const prefLedger = prefRcpt.contractAddress.toLowerCase();

  const packPerm = (act, con, pol) =>
    concatBytes(hexToBytes(act).slice(0, 32), hexToBytes(con).slice(-20), hexToBytes(pol).slice(0, 32));
  const prefPerms = concatBytes(
    packPerm(GOV_CONSTANTS.ACTION_SUPER, chr, GOV_CONSTANTS.POLICY_SUPER_GOVERNANCE),
    packPerm(GOV_CONSTANTS.ACTION_ISSUE, chr, GOV_CONSTANTS.POLICY_SHARE_ISSUANCE_AUCTION),
    packPerm(GOV_CONSTANTS.ACTION_CANCEL, chr, GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY),
    packPerm(GOV_CONSTANTS.ACTION_TRANSFER, chr, GOV_CONSTANTS.POLICY_SHARE_TRANSFER_AUCTION),
    packPerm(GOV_CONSTANTS.ACTION_APPROVE, ZERO_ADDR, GOV_CONSTANTS.POLICY_HOLDER_SELF)
  );
  await session.sendAsMyIdentity(
    encodeAbi('execute(address,bytes)', [
      ['address', prefLedger],
      [
        'bytes',
        hexToBytes(
          encodeAbi('initialize(address,string,uint64,bytes,bytes)', [
            ['address', session.inst.registry],
            ['string', targetSym],
            ['uint64', 0],
            ['bytes', new Uint8Array(0)],
            ['bytes', prefPerms],
          ])
        ),
      ],
    ]),
    `initialize(${targetSym})`,
    `AssetLedger(${classLabel})`,
    [prefLedger, chr]
  );

  savePreferredLedger(chr, normKey, prefLedger, classLabel, convRate);
  return {
    ledger: prefLedger,
    symbol: classLabel,
    classLabel,
    classCode,
    convRate: Math.max(1, Number(convRate || 1)),
  };
}

async function deployPinnedOptionLedger(chr, optSym) {
  startInflightAnim(`Deploying dedicated ESOP Option AssetLedger (${optSym})…`);
  const optRcpt = await session.sendRawSigned({
    privateKey: session.wallet.keypair.privateKey,
    to: null,
    dataHex: session.codeHashes.asset_ledger,
    label: `instantiate(${optSym})`,
    contractLabel: `AssetLedger(${optSym})`,
    gasLimit: 4_800_000n,
  });
  const optLedger = optRcpt.contractAddress.toLowerCase();
  const packPerm = (act, con, pol) =>
    concatBytes(hexToBytes(act).slice(0, 32), hexToBytes(con).slice(-20), hexToBytes(pol).slice(0, 32));
  const optPerms = concatBytes(
    packPerm(GOV_CONSTANTS.ACTION_SUPER, chr, GOV_CONSTANTS.POLICY_SUPER_GOVERNANCE),
    packPerm(GOV_CONSTANTS.ACTION_ISSUE, chr, GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY),
    packPerm(GOV_CONSTANTS.ACTION_CANCEL, chr, GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY),
    packPerm(GOV_CONSTANTS.ACTION_TRANSFER, chr, GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY),
    packPerm(GOV_CONSTANTS.ACTION_APPROVE, ZERO_ADDR, GOV_CONSTANTS.POLICY_HOLDER_SELF)
  );
  await session.sendAsMyIdentity(
    encodeAbi('execute(address,bytes)', [
      ['address', optLedger],
      [
        'bytes',
        hexToBytes(
          encodeAbi('initialize(address,string,uint64,bytes,bytes)', [
            ['address', session.inst.registry],
            ['string', optSym],
            ['uint64', 0],
            ['bytes', new Uint8Array(0)],
            ['bytes', optPerms],
          ])
        ),
      ],
    ]),
    `initialize(${optSym})`,
    `AssetLedger(${optSym})`,
    [optLedger, chr]
  );
  return optLedger;
}

async function deployActionResolution({
  kind,
  roleKey = 'ROLE_CEO',
  targetAddr = '',
  issueAmount = 15000,
  minIssuePrice = 100,
  assetClassKey = 'COMMON',
  customClassName = 'Preferred A',
  conversionRate = 1,
  minRaiseAmount = 1000000,
  maxOwnershipPct = 20,
  shareClassLedger = '',
  buybackShares = 5000,
  buybackPrice = 110,
  splitRatio = 2,
  futuresPct = 20,
  svcCode = 'DEF-MOD-FLRC-C2',
  svcMonthly = 180000,
  svcMonths = 12,
  svcMonthBlocks = 35,
}) {
  if (state.busy) return;
  if (!canProposeActionKind(kind)) {
    showBanner(
      `🔒 <strong>Standing Required:</strong> Only verified ${
        isActionBoardOnly(kind) ? 'Board Directors' : 'Shareholders'
      } of <strong>${escapeHtml(companyNameStr())}</strong> can propose this corporate action.`,
      'err'
    );
    return;
  }
  if (state.charterState !== 2) {
    showBanner(
      '🔒 Pass &amp; enact <strong>Resolution #0001 (First Shareholder Resolution)</strong> first to transition the Charter to <code>ACTIVE</code>!',
      'err'
    );
    return;
  }
  state.busy = true;
  el.btnDeployActionRes.disabled = true;
  const origBtnTxt = el.btnDeployActionRes.textContent;
  el.btnDeployActionRes.textContent = '⏳ Deploying Authorization HFS on Subnet 1…';

  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    const chr = session.inst.corporateCharter;
    const shareLed = session.inst.shareLedger;
    const sc = session.inst.shareCapital;
    const roleId = GOV_CONSTANTS[roleKey] || GOV_CONSTANTS.ROLE_CEO;

    let targetHps = chr;
    let policyId = GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY;
    let actionHashHex = '';
    let execKind = kind;
    let title = '';
    let summary = '';
    let category = 'Shareholder Resolution';
    let deployedFuturesLedger = '';
    let targetShareLedger = shareClassLedger || shareLed;
    let eqClassCode = 0;
    let eqClassLabel = 'Common';
    let eqConvRate = 1;
    let eqMaxOwnBps = Math.max(1, Math.min(9900, Math.round(maxOwnershipPct * 100)));

    if (kind === 'appointExec') {
      await ensureRoleDefinedIfNeeded(roleId, roleKey);
      execKind = 'grantRole';
      policyId = GOV_CONSTANTS.POLICY_BOARD_RESOLUTION;
      category = 'Board Resolution • C-Suite';
      actionHashHex = await session.ethCall(
        chr,
        encodeAbi('hashGrantRole(bytes32,address)', [
          ['bytes32', roleId],
          ['address', targetAddr],
        ])
      );
      title = `Board Resolution: Appoint ${session.labelForIdentity(targetAddr).split('·')[0].trim()} as ${roleKey.replace('ROLE_', '')}`;
      summary = `Appoints ${session.labelForIdentity(targetAddr)} to ${roleDisplayName(roleId)} on the Organization Chart.`;
    } else if (kind === 'revokeExec') {
      execKind = 'revokeRole';
      policyId = GOV_CONSTANTS.POLICY_BOARD_RESOLUTION;
      category = 'Board Resolution • Dismissal';
      actionHashHex = await session.ethCall(
        chr,
        encodeAbi('hashRevokeRole(bytes32,address)', [
          ['bytes32', roleId],
          ['address', targetAddr],
        ])
      );
      title = `Board Resolution: Dismiss ${session.labelForIdentity(targetAddr).split('·')[0].trim()} (${roleKey.replace('ROLE_', '')})`;
      summary = `Revokes ${roleDisplayName(roleId)} from ${session.labelForIdentity(targetAddr)}.`;
    } else if (kind === 'addDirector') {
      actionHashHex = await session.ethCall(
        chr,
        encodeAbi('hashAddDirector(address)', [['address', targetAddr]])
      );
      category = 'Board Expansion (≥75%)';
      title = `Shareholder Resolution: Appoint ${session.labelForIdentity(targetAddr).split('·')[0].trim()} as Director`;
      summary = `Adds ${session.labelForIdentity(targetAddr)} to the Board of Directors (ROLE_DIRECTOR).`;
    } else if (kind === 'removeDirector') {
      actionHashHex = await session.ethCall(
        chr,
        encodeAbi('hashRemoveDirector(address)', [['address', targetAddr]])
      );
      category = 'Director Removal (≥75%)';
      title = `Shareholder Resolution: Remove Director ${session.labelForIdentity(targetAddr).split('·')[0].trim()}`;
      summary = `Fires ${session.labelForIdentity(targetAddr)} from the Board of Directors & revokes ROLE_DIRECTOR.`;
    } else if (kind === 'issueShares' && state.supportsV4Governance && state.supportsIssuanceAuction) {
      execKind = 'equityFinancing';
      const clsInfo = await ensureShareClassLedger(assetClassKey, conversionRate, customClassName);
      targetShareLedger = clsInfo.ledger;
      targetHps = clsInfo.ledger;
      eqClassCode = clsInfo.classCode;
      eqClassLabel = clsInfo.classLabel || clsInfo.symbol;
      eqConvRate = clsInfo.convRate;
      policyId = GOV_CONSTANTS.POLICY_SHARE_ISSUANCE_AUCTION;
      const derived = computeDerivedEquityFinancingTerms({
        preMoneyCommon: state.totalConvertedCommon || state.totalShares || 100000,
        conversionRate: eqConvRate,
        minRaiseAmount,
        maxOwnershipBps: eqMaxOwnBps,
      });
      issueAmount = derived.targetShares;
      minIssuePrice = derived.offerPrice;
      category = `5-Step Issuance • ${eqClassLabel} (${eqConvRate}x)`;
      title =
        derived.offerPrice >= 500000
          ? `0-Bid Fail Test (-97): Offer ${fmtNum(derived.targetShares)} ${eqClassLabel} @ ${fmtNum(derived.offerPrice)} SGD`
          : `5-Step Share Issuance: ${fmtNum(derived.targetShares)} ${eqClassLabel} (${eqConvRate}x) @ ≥${fmtNum(derived.offerPrice)} SGD`;
      summary =
        derived.offerPrice >= 500000
          ? `Unmarketable Raise (${fmtNum(minRaiseAmount)} SGD → ${fmtNum(derived.offerPrice)} SGD/sh) so Step 2 expires with 0 bids — verifying CorporateCharter rejection (-97)!`
          : `Target Raise ${fmtNum(minRaiseAmount)} SGD • Max ${maxOwnershipPct}% Ownership → Step 1 ≥75% Vote → Step 2 Investor Bids → Step 3 Shareholder ROFR → Step 4 ROFR-Priority & Pro-Rata → Step 5 Sign SHA!`;
    } else if (kind === 'issueShares' && state.supportsIssuanceAuction) {
      execKind = 'issueSharesAuction';
      targetHps = shareLed;
      policyId = GOV_CONSTANTS.POLICY_SHARE_ISSUANCE_AUCTION;
      category = 'Bids-Gated Capital Raise';
      title =
        minIssuePrice >= 500000
          ? `0-Bid Expiry Guard Test: Offer ${fmtNum(issueAmount)} ${shareTickerStr()} @ ${fmtNum(minIssuePrice)} SGD`
          : `Capital Raise: Offer up to +${fmtNum(issueAmount)} ${shareTickerStr()} (Floor ${fmtNum(minIssuePrice)} SGD)`;
      summary =
        minIssuePrice >= 500000
          ? `Unmarketable floor (${fmtNum(minIssuePrice)} SGD) so 0 bids arrive before Stage 0 deadline — demonstrating ERR_NO_BIDS_IN_STAGE (-97) CorporateCharter rejection!`
          : `Stage 0 solicits Investor Subscription Bids (≥1 Bid Mandatory before deadline) → Stage 1 Pre-Emptive Rights + ≥75% Shareholder Super-Majority → Pro-Rata Allotment.`;
    } else if (kind === 'issueShares') {
      targetHps = shareLed;
      actionHashHex = await session.ethCall(
        shareLed,
        encodeAbi('hashIssue(address,uint64)', [
          ['address', targetAddr],
          ['uint64', issueAmount],
        ])
      );
      category = 'Capital Raise (≥75%)';
      title = `Capital Raise: Issue +${fmtNum(issueAmount)} ${shareTickerStr()} to ${session.labelForIdentity(targetAddr).split('·')[0].trim()}`;
      summary = `Mints +${fmtNum(issueAmount)} voting shares to ${session.labelForIdentity(targetAddr)}, diluting/updating the Cap Table.`;
    } else if (kind === 'shareBuyback') {
      if (!sc || !state.supportsV4Governance) {
        throw new Error('Incorporate a v4 Company to execute on-chain Share Buybacks!');
      }
      targetHps = sc;
      const clsObj = state.shareClasses.find((c) => c.ledger === targetShareLedger);
      const clsSym = clsObj?.symbol || shareTickerStr();
      actionHashHex = await session.ethCall(
        sc,
        encodeAbi('hashExecuteShareBuyback(address,address,uint64,uint64)', [
          ['address', targetShareLedger],
          ['address', targetAddr],
          ['uint64', buybackShares],
          ['uint64', buybackPrice],
        ])
      );
      category = 'Share Buyback (≥75%)';
      title = `Share Buyback: Retire -${fmtNum(buybackShares)} ${clsSym} from ${session.labelForIdentity(targetAddr).split('·')[0].trim()} @ ${fmtNum(buybackPrice)} SGD`;
      summary = `Pays ${fmtNum(buybackShares * buybackPrice)} SGD from Treasury and cancels -${fmtNum(buybackShares)} ${clsSym} shares on the Capitalization Table.`;
    } else if (kind === 'shareSplit') {
      if (!sc || !state.supportsV4Governance) {
        throw new Error('Incorporate a v4 Company to execute Forward Share Splits!');
      }
      targetHps = sc;
      const clsObj = state.shareClasses.find((c) => c.ledger === targetShareLedger);
      const clsSym = clsObj?.symbol || shareTickerStr();
      actionHashHex = await session.ethCall(
        sc,
        encodeAbi('hashExecuteShareSplit(address,uint64)', [
          ['address', targetShareLedger],
          ['uint64', splitRatio],
        ])
      );
      category = 'Forward Share Split (≥75%)';
      title = `Forward Share Split: ${splitRatio}-for-1 on ${clsSym}`;
      summary = `Subdivides every 1 ${clsSym} share into ${splitRatio} shares across all holders on AssetLedger while preserving ownership %.`;
    } else if (kind === 'reverseShareSplit') {
      if (!sc || !state.supportsV4Governance) {
        throw new Error('Incorporate a v4 Company to execute Reverse Share Splits!');
      }
      targetHps = sc;
      const clsObj = state.shareClasses.find((c) => c.ledger === targetShareLedger);
      const clsSym = clsObj?.symbol || shareTickerStr();
      actionHashHex = await session.ethCall(
        sc,
        encodeAbi('hashExecuteReverseShareSplit(address,uint64)', [
          ['address', targetShareLedger],
          ['uint64', splitRatio],
        ])
      );
      category = 'Reverse Share Split (≥75%)';
      title = `Reverse Share Split: 1-for-${splitRatio} Consolidation on ${clsSym}`;
      summary = `Consolidates every ${splitRatio} ${clsSym} shares into 1 share across all holders on AssetLedger.`;
    } else if (kind === 'setTreasury') {
      targetHps = chr;
      policyId = GOV_CONSTANTS.POLICY_SUPER_GOVERNANCE;
      actionHashHex = await session.ethCall(
        chr,
        encodeAbi('hashSetTreasuryAccount(address)', [['address', targetAddr]])
      );
      category = 'Treasury Account (≥75%)';
      title = `Designate Company Treasury: ${session.labelForIdentity(targetAddr).split('·')[0].trim()}`;
      summary = `Sets ${session.labelForIdentity(targetAddr)} (${shortAddr(targetAddr)}) as the Company's official Treasury Account on CorporateCharter.`;
    } else if (kind === 'authorizeFutures') {
      if (!sc) {
        throw new Error('Incorporate a new Company first to use ShareCapital futures underwriting!');
      }
      const futSym = `${shareTickerStr().replace(/-EQ$/, '')}-FUT`.slice(0, 14);
      startInflightAnim(`Step 1/2: Instantiating pinned ${futSym} Futures AssetLedger…`);
      const futRcpt = await session.sendRawSigned({
        privateKey: session.wallet.keypair.privateKey,
        to: null,
        dataHex: session.codeHashes.asset_ledger,
        label: `instantiate(${futSym})`,
        contractLabel: 'AssetLedger(Futures)',
        gasLimit: 4_800_000n,
      });
      deployedFuturesLedger = futRcpt.contractAddress.toLowerCase();

      const packPerm = (act, con, pol) =>
        concatBytes(hexToBytes(act).slice(0, 32), hexToBytes(con).slice(-20), hexToBytes(pol).slice(0, 32));
      const futPerms = concatBytes(
        packPerm(GOV_CONSTANTS.ACTION_SUPER, chr, GOV_CONSTANTS.POLICY_SUPER_GOVERNANCE),
        packPerm(GOV_CONSTANTS.ACTION_ISSUE, chr, GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY),
        packPerm(GOV_CONSTANTS.ACTION_CANCEL, chr, GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY),
        packPerm(GOV_CONSTANTS.ACTION_TRANSFER, ZERO_ADDR, GOV_CONSTANTS.POLICY_HOLDER_SELF),
        packPerm(GOV_CONSTANTS.ACTION_APPROVE, ZERO_ADDR, GOV_CONSTANTS.POLICY_HOLDER_SELF)
      );
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', deployedFuturesLedger],
          [
            'bytes',
            hexToBytes(
              encodeAbi('initialize(address,string,uint64,bytes,bytes)', [
                ['address', session.inst.registry],
                ['string', futSym],
                ['uint64', 0],
                ['bytes', new Uint8Array(0)],
                ['bytes', futPerms],
              ])
            ),
          ],
        ]),
        `initialize(${futSym})`,
        'AssetLedger(Futures)',
        [deployedFuturesLedger, chr]
      );

      targetHps = sc;
      actionHashHex = await session.ethCall(
        targetHps,
        encodeAbi('hashAuthorizeFuturesUnderwriting(address,uint64)', [
          ['address', deployedFuturesLedger],
          ['uint64', futuresPct],
        ])
      );
      category = 'Futures Underwriting (≥75%)';
      title = `Authorize ${futuresPct}% Share-Backed Futures (${futSym})`;
      summary = `Authorizes shareholders to mint ${futSym} futures up to ${futuresPct}% of common equity via ShareCapital.`;
    } else if (kind === 'serviceContract') {
      const chrAccHex = await session
        .ethCall(chr, encodeAbi('accountingLedger()'))
        .catch(() => '0x');
      const resolvedAcc =
        decodeAddrWord(chrAccHex) !== ZERO_ADDR
          ? decodeAddrWord(chrAccHex)
          : (session.inst.accountingLedger || '').toLowerCase();
      if (!resolvedAcc || resolvedAcc === ZERO_ADDR) {
        throw new Error('No AccountingLedger linked to this CorporateCharter yet!');
      }
      targetHps = resolvedAcc;
      policyId = GOV_CONSTANTS.POLICY_BOARD_RESOLUTION;
      const cleanCode = String(svcCode || 'DEF-MOD-FLRC-C2').trim().slice(0, 24) || 'DEF-MOD-FLRC-C2';
      const tagHex = encodeSvcTagBytes32(cleanCode);
      actionHashHex = await session.ethCall(
        targetHps,
        encodeAbi('hashProposeServiceContract(address,bytes32,uint64,uint64,uint64)', [
          ['address', targetAddr],
          ['bytes32', tagHex],
          ['uint64', svcMonthly],
          ['uint64', svcMonths],
          ['uint64', svcMonthBlocks],
        ])
      );
      const totalVal = svcMonthly * svcMonths;
      category = 'Board Resolution • Defense / B2B Contract';
      title = `Sign Contract ${cleanCode}: ${fmtNum(svcMonthly)} SGD/mo × ${svcMonths}m (${fmtNum(totalVal)} SGD)`;
      summary = `Ratifies multi-month engagement with ${session.labelForIdentity(targetAddr).split('·')[0].trim()} → credits +${fmtNum(totalVal)} SGD into 1800 Future Contract Receivables upon Client co-signature.`;
    }

    startInflightAnim(`Deploying one-time Authorization HFS for "${title}"…`);
    const authRcpt = await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: null,
      dataHex: session.codeHashes.authorization,
      label: 'instantiate(Authorization)',
      contractLabel: 'Authorization',
      gasLimit: 4_800_000n,
    });
    const newAuth = authRcpt.contractAddress.toLowerCase();

    if (execKind === 'equityFinancing') {
      startInflightAnim(`Initializing 5-Step Share Issuance (${eqClassLabel}) — Step 1 Shareholder Resolution on ${shortAddr(newAuth)}…`);
      const innerInit = encodeAbi(
        'initializeShareIssuanceRound(address,address,address,uint64,bytes32,uint64,uint64,uint64)',
        [
          ['address', session.inst.registry],
          ['address', chr],
          ['address', targetShareLedger],
          ['uint64', eqClassCode],
          ['bytes32', encodeClassLabelBytes32(eqClassLabel)],
          ['uint64', eqConvRate],
          ['uint64', minRaiseAmount],
          ['uint64', eqMaxOwnBps],
        ]
      );
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', newAuth],
          ['bytes', hexToBytes(innerInit)],
        ]),
        'initializeShareIssuanceRound',
        'Authorization',
        [newAuth, chr, targetShareLedger, ...state.shareClasses.map((c) => c.ledger)]
      );
    } else if (execKind === 'issueSharesAuction') {
      startInflightAnim(`Starting Stage 0 Bids Countdown on ${shortAddr(newAuth)}…`);
      const innerInit = encodeAbi('initializeShareIssuance(address,address,address,uint64,uint64)', [
        ['address', session.inst.registry],
        ['address', chr],
        ['address', shareLed],
        ['uint64', issueAmount],
        ['uint64', minIssuePrice],
      ]);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', newAuth],
          ['bytes', hexToBytes(innerInit)],
        ]),
        'initializeShareIssuance',
        'Authorization',
        [newAuth, chr, shareLed]
      );
    } else {
      if (targetHps.toLowerCase() === chr.toLowerCase() && policyId !== GOV_CONSTANTS.POLICY_BOARD_RESOLUTION) {
        const selMap = {
          addDirector: 'addDirector(address,address)',
          removeDirector: 'removeDirector(address,address)',
          setTreasury: 'setTreasuryAccount(address,address)',
        };
        if (selMap[execKind]) {
          const cfgPol = await session.ethCall(
            chr,
            encodeAbi('getFunctionAuth(address,bytes4)', [
              ['address', chr],
              ['bytes4', keccak256Hex(utf8ToBytes(selMap[execKind])).slice(0, 10)],
            ])
          );
          if (cfgPol && !/^0x0+$/.test(cfgPol)) policyId = cfgPol.slice(0, 66);
        }
      }

      startInflightAnim(`Binding Authorization ${shortAddr(newAuth)} to CorporateCharter policy…`);
      await session.sendAsMyIdentity(
        encodeAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
          ['address', newAuth],
          ['address', session.inst.registry],
          ['address', chr],
          ['address', targetHps],
          ['bytes32', policyId],
          ['bytes32', actionHashHex],
        ]),
        'initCharterAuth',
        'Authorization',
        [newAuth, chr, targetHps, ...state.shareClasses.map((c) => c.ledger)]
      );
    }

    saveResolutionRecord(chr, {
      id: `res_${Date.now()}`,
      authAddr: newAuth,
      title,
      summary,
      category,
      policyId,
      targetHps,
      targetShareLedger,
      shareClassLedger: targetShareLedger,
      actionHash: actionHashHex,
      execKind,
      roleId,
      roleName: roleKey,
      targetAddr,
      execSubjectAddr: targetAddr,
      issueAmount,
      minIssuePrice,
      eqClassCode,
      classLabel: eqClassLabel,
      eqConvRate,
      eqMinRaise: minRaiseAmount,
      eqMaxOwnBps,
      buybackShares,
      buybackPrice,
      splitRatio,
      futuresLedger: deployedFuturesLedger,
      futuresPct,
      svcCode: String(svcCode || 'DEF-MOD-FLRC-C2').trim().slice(0, 24),
      svcTagHex: encodeSvcTagBytes32(svcCode),
      svcMonthly,
      svcMonths,
      svcMonthBlocks,
    });

    if (execKind === 'equityFinancing') {
      state.activeIssuanceAddr = newAuth;
      saveIssuanceAddr(chr, newAuth);
    }

    finishInflightAnim('✓ Resolution Deployed!');
    switchTab(execKind === 'equityFinancing' ? 'issuance' : 'overview');
    await refreshCharterWorld();
    showBanner(
      execKind === 'equityFinancing'
        ? minIssuePrice >= 500000
          ? `🛡️ <strong>5-Step 0-Bid Failure Test Launched (<code>${shortAddr(newAuth)}</code>)!</strong> Pass Step 1 (≥75% Vote) — then watch Step 2 expire with 0 bids and fail with <code>ERR_NO_BIDS_IN_STAGE (-97)</code>!`
          : isSimManagedCharter()
            ? `💰 <strong>5-Step Share Issuance Round Launched (${escapeHtml(eqClassLabel)} • <code>${shortAddr(newAuth)}</code>)!</strong> AI Shareholders are co-signing <strong>Step 1 (≥75% Resolution)</strong> now — vote to open Step 2 Investor Bidding &amp; Step 3 ROFR!`
            : `💰 <strong>5-Step Share Issuance Round Launched (${escapeHtml(eqClassLabel)} • <code>${shortAddr(newAuth)}</code>)!</strong> Sign <strong>Step 1 (≥75% Resolution)</strong> to open Step 2 Investor Bidding &amp; Step 3 ROFR!`
        : execKind === 'issueSharesAuction'
          ? `💰 <strong>Bids-Gated Share Issuance Launched (<code>${shortAddr(newAuth)}</code>)!</strong>`
          : isSimManagedCharter()
            ? `📜 <strong>${escapeHtml(title)}</strong> deployed at <code>${shortAddr(newAuth)}</code>! Watch AI Directors/Shareholders sign live on the card below, then click <strong>Sign with Wallet &amp; Execute</strong>!`
            : `📜 <strong>${escapeHtml(title)}</strong> deployed at <code>${shortAddr(newAuth)}</code>! Collect required Director/Shareholder signatures in the register below, then click <strong>Sign &amp; Execute</strong>!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Proposal failed');
    showBanner(`🚫 Proposal error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
    el.btnDeployActionRes.textContent = origBtnTxt;
    el.btnDeployActionRes.disabled = state.charterState !== 2;
  }
}

el.actionComposerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const kind = state.selectedActionKind;
  const isAuctionIssuance = kind === 'issueShares' && state.supportsIssuanceAuction;
  const needsTarget =
    kind === 'appointExec' ||
    kind === 'revokeExec' ||
    kind === 'addDirector' ||
    kind === 'removeDirector' ||
    kind === 'shareBuyback' ||
    kind === 'setTreasury' ||
    kind === 'serviceContract' ||
    (kind === 'issueShares' && !isAuctionIssuance);
  const targetAddr = resolveSelectedStudioTarget();
  if (needsTarget && !/^0x[0-9a-f]{40}$/i.test(targetAddr)) {
    showBanner('🚫 Please select or enter a valid 20-byte Identity address (0x…)', 'err');
    return;
  }
  const assetClassKey = el.selIssueAssetClass?.value || 'COMMON';
  const existingIssueObj = state.shareClasses.find((c) => c.ledger === assetClassKey);
  const customClassName = existingIssueObj
    ? existingIssueObj.symbol
    : (el.inpIssueCustomClassName?.value || 'Preferred A').trim();
  await deployActionResolution({
    kind,
    roleKey: el.selExecRole.value,
    targetAddr: targetAddr || session.myIdentityAddr || '',
    issueAmount: Math.max(100, Math.floor(Number(el.inpStudioShareAmount?.value) || 15000)),
    minIssuePrice: Math.max(1, Math.floor(Number(el.inpStudioIssueMinPrice?.value) || 100)),
    assetClassKey,
    customClassName,
    conversionRate:
      assetClassKey === 'COMMON'
        ? 1
        : existingIssueObj
          ? Math.max(1, Math.round(existingIssueObj.convMult))
          : Math.max(1, Math.floor(Number(el.inpIssueConversionRate?.value) || 1)),
    minRaiseAmount: Math.max(1000, Math.floor(Number(el.inpIssueMinRaise?.value) || 1000000)),
    maxOwnershipPct: Math.max(0.5, Math.min(90, Number(el.inpIssueMaxOwnershipPct?.value) || 20)),
    shareClassLedger: el.selActionShareClass?.value || session.inst?.shareLedger || '',
    buybackShares: Math.max(1, Math.floor(Number(el.inpBuybackShares?.value) || 5000)),
    buybackPrice: Math.max(1, Math.floor(Number(el.inpBuybackPrice?.value) || 110)),
    splitRatio: Math.max(2, Math.min(100, Math.floor(Number(el.inpSplitRatio?.value) || 2))),
    futuresPct: Math.max(1, Math.min(100, Math.floor(Number(el.inpStudioFuturesPct.value) || 20))),
    svcCode: (el.inpSvcCode?.value || 'DEF-MOD-FLRC-C2').trim().slice(0, 24),
    svcMonthly: Math.max(1000, Math.floor(Number(el.inpSvcMonthly?.value) || 180000)),
    svcMonths: Math.max(2, Math.min(120, Math.floor(Number(el.inpSvcMonths?.value) || 12))),
    svcMonthBlocks: Math.max(10, Math.min(100000, Math.floor(Number(el.inpSvcMonthBlocks?.value) || 35))),
  });
});

el.selSvcPreset?.addEventListener('change', () => {
  const preset = SERVICE_CONTRACT_PRESETS[el.selSvcPreset.value];
  if (preset) {
    if (el.inpSvcCode) el.inpSvcCode.value = preset.code;
    if (el.inpSvcMonthly) el.inpSvcMonthly.value = String(preset.monthly);
    if (el.inpSvcMonths) el.inpSvcMonths.value = String(preset.months);
    if (el.inpSvcMonthBlocks) el.inpSvcMonthBlocks.value = String(preset.monthBlocks);
    const poolAddr = session.inst?.userOnboardingPool?.[preset.clientPoolIdx]?.toLowerCase();
    if (poolAddr && el.selTargetIdentity && Array.from(el.selTargetIdentity.options).some((o) => o.value === poolAddr)) {
      el.selTargetIdentity.value = poolAddr;
    }
  }
  renderSvcDerivedSummary();
  renderStudioTemplatePreview();
});
for (const svcInp of [el.inpSvcCode, el.inpSvcMonthly, el.inpSvcMonths, el.inpSvcMonthBlocks]) {
  svcInp?.addEventListener('input', () => {
    renderSvcDerivedSummary();
    renderStudioTemplatePreview();
  });
}

el.btnTestZeroBidIssuance?.addEventListener('click', async () => {
  if (state.supportsV4Governance && state.supportsIssuanceAuction) {
    const assetClassKey = el.selIssueAssetClass?.value || 'COMMON';
    const existingObj = state.shareClasses.find((c) => c.ledger === assetClassKey);
    await deployActionResolution({
      kind: 'issueShares',
      assetClassKey,
      customClassName: existingObj ? existingObj.symbol : (el.inpIssueCustomClassName?.value || 'Preferred X').trim(),
      conversionRate:
        assetClassKey === 'COMMON'
          ? 1
          : existingObj
            ? Math.max(1, Math.round(existingObj.convMult))
            : Math.max(1, Math.floor(Number(el.inpIssueConversionRate?.value) || 1)),
      minRaiseAmount: 999999999999,
      maxOwnershipPct: 10,
    });
    return;
  }
  if (el.inpStudioIssueMinPrice) el.inpStudioIssueMinPrice.value = '999999';
  renderStudioTemplatePreview();
  await deployActionResolution({
    kind: 'issueShares',
    targetAddr: session.myIdentityAddr || '',
    issueAmount: Math.max(100, Math.floor(Number(el.inpStudioShareAmount?.value) || 5000)),
    minIssuePrice: 999999,
  });
});

// ---------------------------------------------------------------------------
// Tab 5: Master ESOP Programmes, Board Option Grants, Periodic Sweep & Exercise
// ---------------------------------------------------------------------------

el.selEsopAssetClass?.addEventListener('change', () => {
  const cls = el.selEsopAssetClass.value;
  const existingObj = state.shareClasses.find((c) => c.ledger === cls);
  if (el.inpEsopConvRate) {
    if (cls === 'COMMON') {
      el.inpEsopConvRate.value = '1';
      el.inpEsopConvRate.disabled = true;
    } else if (existingObj) {
      el.inpEsopConvRate.value = String(Math.max(1, Math.round(existingObj.convMult)));
      el.inpEsopConvRate.disabled = true;
    } else {
      el.inpEsopConvRate.value = cls === 'PREFERRED_B' ? '3' : '2';
      el.inpEsopConvRate.disabled = false;
    }
  }
});

el.selGrantEmployee?.addEventListener('change', () => {
  if (el.fieldGrantCustomEmpWrap) {
    el.fieldGrantCustomEmpWrap.style.display =
      el.selGrantEmployee.value === '__custom__' ? 'flex' : 'none';
  }
});

el.btnAddEsopTranche?.addEventListener('click', () => {
  if (state.esopDraftSchedule.length >= 12) return;
  const last = state.esopDraftSchedule[state.esopDraftSchedule.length - 1] || { blockOffset: 4, amount: 1000 };
  state.esopDraftSchedule.push({ blockOffset: last.blockOffset + 4, amount: last.amount });
  renderEsopScheduleDraft();
});

el.btnPresetRapidEsopSchedule?.addEventListener('click', () => {
  state.esopDraftSchedule = [
    { blockOffset: 2, amount: 1500 },
    { blockOffset: 5, amount: 1500 },
    { blockOffset: 8, amount: 2000 },
  ];
  renderEsopScheduleDraft();
});

el.esopScheduleRows?.addEventListener('input', (e) => {
  const bIdx = e.target.getAttribute('data-esop-blk');
  if (bIdx !== null && state.esopDraftSchedule[Number(bIdx)]) {
    state.esopDraftSchedule[Number(bIdx)].blockOffset = Math.max(1, Math.floor(Number(e.target.value) || 1));
    return;
  }
  const aIdx = e.target.getAttribute('data-esop-amt');
  if (aIdx !== null && state.esopDraftSchedule[Number(aIdx)]) {
    state.esopDraftSchedule[Number(aIdx)].amount = Math.max(1, Math.floor(Number(e.target.value) || 100));
  }
});

el.esopScheduleRows?.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm-esop-tranche]');
  if (rm && state.esopDraftSchedule.length > 1) {
    state.esopDraftSchedule.splice(Number(rm.getAttribute('data-rm-esop-tranche')), 1);
    renderEsopScheduleDraft();
  }
});

el.formCreateEsopProg?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy || !state.supportsV4Governance || !session.inst?.shareCapital) return;
  if (!state.myIsShareholder || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only verified Shareholders of this company can propose a Master ESOP Pool.', 'err');
    return;
  }
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    const chr = session.inst.corporateCharter;
    const sc = session.inst.shareCapital;
    const clsKey = el.selEsopAssetClass?.value || 'COMMON';
    const convRate = clsKey === 'COMMON' ? 1 : Math.max(1, Math.floor(Number(el.inpEsopConvRate?.value) || 2));
    const authShares = Math.max(100, Math.floor(Number(el.inpEsopAuthShares?.value) || 15000));
    const strikePrice = Math.max(0, Math.floor(Number(el.inpEsopStrikePrice?.value) ?? 25));

    const undInfo = await ensureShareClassLedger(clsKey, convRate);
    const optNum = state.esopPrograms.length + 1;
    const optSym = `${shareTickerStr().replace(/-EQ$/, '').slice(0, 8)}-OPT${optNum}`;
    const optionLedger = await deployPinnedOptionLedger(chr, optSym);

    const actionHashHex = await session.ethCall(
      sc,
      encodeAbi('hashCreateEsopProgram(address,address,uint64,uint64,uint64,uint64)', [
        ['address', optionLedger],
        ['address', undInfo.ledger],
        ['uint64', undInfo.classCode],
        ['uint64', undInfo.convRate],
        ['uint64', authShares],
        ['uint64', strikePrice],
      ])
    );

    startInflightAnim(`Deploying ≥75% Shareholder Resolution for Master ESOP (${optSym})…`);
    const authRcpt = await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: null,
      dataHex: session.codeHashes.authorization,
      label: `instantiate(Auth:MasterESOP:${optSym})`,
      contractLabel: 'Authorization',
      gasLimit: 4_800_000n,
    });
    const newAuth = authRcpt.contractAddress.toLowerCase();

    await session.sendAsMyIdentity(
      encodeAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
        ['address', newAuth],
        ['address', session.inst.registry],
        ['address', chr],
        ['address', sc],
        ['bytes32', GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY],
        ['bytes32', actionHashHex],
      ]),
      'initCharterAuth(MasterESOP)',
      'Authorization',
      [newAuth, chr, sc, ...state.shareClasses.map((c) => c.ledger)]
    );

    const title = `Master ESOP Programme (${optSym}): ${fmtNum(authShares)} Options → ${undInfo.symbol} @ ${fmtNum(strikePrice)} SGD`;
    saveResolutionRecord(chr, {
      id: `res_${Date.now()}`,
      authAddr: newAuth,
      title,
      summary: `Authorizes ${fmtNum(authShares)} employee options on dedicated Option AssetLedger ${shortAddr(optionLedger)} convertible into ${undInfo.symbol} (${undInfo.convRate}x) at ${fmtNum(strikePrice)} SGD strike.`,
      category: 'Master ESOP (≥75%)',
      policyId: GOV_CONSTANTS.POLICY_SHAREHOLDER_SUPERMAJORITY,
      targetHps: sc,
      actionHash: actionHashHex,
      execKind: 'createEsopProgram',
      optionLedger,
      optionSymbol: optSym,
      underlyingLedger: undInfo.ledger,
      underlyingSymbol: undInfo.symbol,
      esopClassCode: undInfo.classCode,
      esopConvRate: undInfo.convRate,
      esopAuthShares: authShares,
      esopStrikePrice: strikePrice,
    });

    finishInflightAnim('✓ Master ESOP Resolution Deployed!');
    switchTab('overview');
    await refreshCharterWorld();
    showBanner(
      isSimManagedCharter()
        ? `🎓 <strong>Master ESOP Resolution Deployed (<code>${shortAddr(newAuth)}</code>)!</strong> Dedicated Option Ledger <code>${shortAddr(optionLedger)}</code> (${escapeHtml(optSym)}) is ready — watch AI Shareholders co-sign, then click <strong>Sign with Wallet &amp; Execute</strong>!`
        : `🎓 <strong>Master ESOP Resolution Deployed (<code>${shortAddr(newAuth)}</code>)!</strong> Dedicated Option Ledger <code>${shortAddr(optionLedger)}</code> (${escapeHtml(optSym)}) is ready — click <strong>Sign &amp; Execute</strong> once ≥75% Shareholder approval is met!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Master ESOP proposal failed');
    showBanner(`🚫 Master ESOP error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.formAwardEsopOptions?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy || !state.esopPrograms.length || !session.inst?.shareCapital) return;
  if (!state.myIsDirector || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only verified Board Directors of this company can propose Employee Option Grants.', 'err');
    return;
  }
  const programId = Number(el.selGrantProgram?.value || 0);
  const empSel = el.selGrantEmployee?.value || '';
  const employee =
    empSel === '__custom__'
      ? (el.inpGrantCustomEmployee?.value || '').trim().toLowerCase()
      : empSel.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/i.test(employee)) {
    showBanner('🚫 Enter a valid 20-byte Employee Identity HFS address (0x…)', 'err');
    return;
  }

  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    const chr = session.inst.corporateCharter;
    const sc = session.inst.shareCapital;
    const curBlk = Number(BigInt(await session.rpcCall('eth_blockNumber')));
    const cliffOffset = Math.max(0, Math.floor(Number(el.selGrantCliffPreset?.value) || 0));
    const cliffBlock = curBlk + cliffOffset;
    const cliffTimestamp = Math.floor(Date.now() / 1000) + cliffOffset * 6;

    const chunks = [u16BEBytes(state.esopDraftSchedule.length)];
    let totalAward = 0;
    for (const row of state.esopDraftSchedule) {
      const dueBlk = curBlk + Math.max(1, Number(row.blockOffset || 1));
      const dueTs = Math.floor(Date.now() / 1000) + Math.max(1, Number(row.blockOffset || 1)) * 6;
      const amt = Math.max(1, Number(row.amount || 100));
      totalAward += amt;
      chunks.push(u64BEBytes(dueBlk), u64BEBytes(dueTs), u64BEBytes(amt));
    }
    const scheduleBlob = concatBytes(...chunks);
    const scheduleHex = bytesToHex(scheduleBlob);

    const actionHashHex = await session.ethCall(
      sc,
      encodeAbi('hashAwardEmployeeOptions(uint64,address,uint64,uint64,bytes)', [
        ['uint64', programId],
        ['address', employee],
        ['uint64', cliffBlock],
        ['uint64', cliffTimestamp],
        ['bytes', scheduleBlob],
      ])
    );

    startInflightAnim(`Deploying Board Resolution to award ${fmtNum(totalAward)} options…`);
    const authRcpt = await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: null,
      dataHex: session.codeHashes.authorization,
      label: `instantiate(Auth:AwardESOP)`,
      contractLabel: 'Authorization',
      gasLimit: 4_800_000n,
    });
    const newAuth = authRcpt.contractAddress.toLowerCase();

    await session.sendAsMyIdentity(
      encodeAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
        ['address', newAuth],
        ['address', session.inst.registry],
        ['address', chr],
        ['address', sc],
        ['bytes32', GOV_CONSTANTS.POLICY_BOARD_RESOLUTION],
        ['bytes32', actionHashHex],
      ]),
      'initCharterAuth(AwardESOP)',
      'Authorization',
      [newAuth, chr, sc]
    );

    const empName = session.labelForIdentity(employee).split('·')[0].trim();
    const title = `Board Resolution: Award ${fmtNum(totalAward)} ESOP #${programId} Options to ${empName}`;
    saveResolutionRecord(chr, {
      id: `res_${Date.now()}`,
      authAddr: newAuth,
      title,
      summary: `Awards ${fmtNum(totalAward)} options across ${state.esopDraftSchedule.length} scheduled tranche(s) with Cliff Block #${fmtNum(cliffBlock)}.`,
      category: 'Board • ESOP Award',
      policyId: GOV_CONSTANTS.POLICY_BOARD_RESOLUTION,
      targetHps: sc,
      actionHash: actionHashHex,
      execKind: 'awardEmployeeOptions',
      targetAddr: employee,
      execSubjectAddr: employee,
      esopProgramId: programId,
      esopCliffBlock: cliffBlock,
      esopCliffTimestamp: cliffTimestamp,
      esopScheduleHex: scheduleHex,
      esopTotalAward: totalAward,
    });

    finishInflightAnim('✓ Board Option Award Resolution Deployed!');
    switchTab('overview');
    await refreshCharterWorld();
    showBanner(
      isSimManagedCharter()
        ? `🎖️ <strong>Board Option Award Deployed (<code>${shortAddr(newAuth)}</code>)!</strong> Watch AI Directors co-sign, then click <strong>Sign with Wallet &amp; Execute</strong> to start periodic vesting!`
        : `🎖️ <strong>Board Option Award Deployed (<code>${shortAddr(newAuth)}</code>)!</strong> Click <strong>Sign &amp; Execute</strong> once Board approval is complete to start periodic vesting!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Option award failed');
    showBanner(`🚫 Option award error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

// ---------------------------------------------------------------------------
// Founders' Table Incorporation Modal (Req #1 & #2)
// ---------------------------------------------------------------------------

function initIncDraftIfNeeded() {
  if (state.incDraftAi.length) return;
  const personas = session.aiPersonas || [];
  state.incDraftAi = personas.map((p, idx) => ({
    idx,
    identityAddr: p.identityAddr,
    nickname: p.nickname,
    displayLabel: p.displayLabel,
    avatar: p.avatar,
    roleBio: p.roleBio,
    isDirector: false,
    isShareholder: false,
    shares: 10000,
  }));
}

function renderIncorpModalState() {
  initIncDraftIfNeeded();
  const myShares = Math.max(0, Math.floor(Number(el.inpIncMyShares.value) || 0));
  const aiTotal = state.incDraftAi
    .filter((a) => a.isShareholder)
    .reduce((s, a) => s + Math.max(0, Math.floor(Number(a.shares) || 0)), 0);
  const extTotal = state.incDraftExt
    .filter((x) => x.isShareholder)
    .reduce((s, x) => s + Math.max(0, Math.floor(Number(x.shares) || 0)), 0);
  const total = Math.max(1, myShares + aiTotal + extTotal);
  const myPct = ((myShares / total) * 100).toFixed(1);
  const aiPct = ((aiTotal / total) * 100).toFixed(1);
  const extPct = ((extTotal / total) * 100).toFixed(1);

  el.incCapSplitSummary.textContent = `You: ${myPct}% (${fmtNum(myShares)}) • AI: ${aiPct}% (${fmtNum(aiTotal)})${
    extTotal > 0 ? ` • External: ${extPct}% (${fmtNum(extTotal)})` : ''
  } • Quorum ≥75% = ${fmtNum(Math.ceil((total * 75) / 100))}`;

  const segments = [
    `<div style="width:${myPct}%;background:#38bdf8;" title="You (${myPct}%)"></div>`,
    ...state.incDraftAi
      .filter((a) => a.isShareholder && a.shares > 0)
      .map((a, idx) => {
        const p = ((a.shares / total) * 100).toFixed(1);
        return `<div style="width:${p}%;background:${DONUT_COLORS[(idx + 1) % DONUT_COLORS.length]};" title="${escapeHtml(a.nickname)} (${p}%)"></div>`;
      }),
    ...state.incDraftExt
      .filter((x) => x.isShareholder && x.shares > 0)
      .map((x) => {
        const p = ((x.shares / total) * 100).toFixed(1);
        return `<div style="width:${p}%;background:#fbbf24;" title="External ${shortAddr(x.identityAddr)} (${p}%)"></div>`;
      }),
  ];
  el.incCapPreviewBar.innerHTML = segments.join('');

  el.aiFoundersGrid.innerHTML = state.incDraftAi
    .map(
      (a, idx) => `
      <div class="ai-founder-card ${a.isDirector || a.isShareholder ? 'selected' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:13px;color:#f8fafc;">${a.avatar} ${escapeHtml(a.displayLabel)}</strong>
          <span class="inst-badge cyan">AI ID</span>
        </div>
        <div style="font-size:10.5px;color:var(--txt-2);">${escapeHtml(a.roleBio)}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:11.5px;">
          <label style="display:flex;align-items:center;gap:5px;opacity:0.48;cursor:not-allowed;" title="Simulator bots do not sign Director Consent on real user-incorporated companies">
            <input type="checkbox" data-inc-dir="${idx}" disabled />
            Director (Real IDs only)
          </label>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
            <input type="checkbox" data-inc-sh="${idx}" ${a.isShareholder ? 'checked' : ''} />
            Passive Shareholder
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <input class="inst-input" type="number" min="0" step="1000" value="${a.shares}" data-inc-shares="${idx}" ${
            a.isShareholder ? '' : 'disabled'
          } style="padding:5px 8px;font-size:12px;" />
          <span style="font-size:11px;font-family:var(--mono);color:var(--txt-2);">shares</span>
        </div>
      </div>
    `
    )
    .join('');

  if (el.extParticipantsList) {
    el.extParticipantsList.innerHTML = state.incDraftExt.length
      ? state.incDraftExt
          .map(
            (x, idx) => `
            <span class="chr-signer-chip signed" style="gap:6px;">
              <strong>👤 ${escapeHtml(session.labelForIdentity(x.identityAddr))}</strong>
              <span>(${shortAddr(x.identityAddr)})</span>
              ${x.isDirector ? '<span class="inst-badge amber">Director (Needs Consent)</span>' : ''}
              ${x.isShareholder ? `<span class="inst-badge green">${fmtNum(x.shares)} sh</span>` : ''}
              <button type="button" class="inst-btn sm rose" data-rm-ext-inc="${idx}" style="padding:1px 6px;">✕</button>
            </span>
          `
          )
          .join('')
      : `<span style="font-size:11px;color:var(--txt-2);">No external human participants added (optional).</span>`;
  }
}

function openIncorpModal() {
  state.incDraftAi = [];
  state.incDraftExt = [];
  renderIncorpModalState();
  el.incorpStatusBox.style.display = 'none';
  el.btnSubmitIncorp.disabled = false;
  el.incorpModal.classList.add('open');
}

function closeIncorpModal() {
  el.incorpModal.classList.remove('open');
}

el.btnOpenIncorporate?.addEventListener('click', openIncorpModal);
el.btnCloseIncorp?.addEventListener('click', closeIncorpModal);
el.btnCancelIncorp?.addEventListener('click', closeIncorpModal);
el.incorpModal?.addEventListener('click', closeIncorpModal);
el.inpIncMyShares?.addEventListener('input', renderIncorpModalState);
el.inpIncName?.addEventListener('input', () => {
  const raw = (el.inpIncName?.value || '').trim();
  const guardBox = $('incorpNameGuardNotice');
  const blocked = isConfusableSuperlexiconName(raw);
  if (guardBox) {
    if (blocked) {
      guardBox.style.display = 'block';
      guardBox.innerHTML =
        '🚫 <strong>Protocol-Reserved Entity Name (-110 / -25):</strong> <code>Superlexicon Pte. Ltd.</code> (Singapore) and all confusable/homoglyph variants are cast in stone at the protocol level and cannot be incorporated by third parties.';
    } else {
      guardBox.style.display = 'none';
    }
  }
  if (el.btnSubmitIncorp) el.btnSubmitIncorp.disabled = blocked || state.busy;
});

el.btnAddExtParticipant?.addEventListener('click', () => {
  const addr = (el.inpExtIdentityAddr?.value || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    showBanner('🚫 Enter a valid 20-byte Identity HFS address (0x…)', 'err');
    return;
  }
  const isDirector = Boolean(el.chkExtIsDir?.checked);
  const isShareholder = Boolean(el.chkExtIsSh?.checked);
  const shares = isShareholder ? Math.max(100, Math.floor(Number(el.inpExtShares?.value) || 5000)) : 0;
  if (!isDirector && !isShareholder) {
    showBanner('🚫 Select Director and/or Shareholder for the invited Identity.', 'err');
    return;
  }
  state.incDraftExt = [
    ...state.incDraftExt.filter((x) => x.identityAddr !== addr),
    { identityAddr: addr, isDirector, isShareholder, shares },
  ];
  if (el.inpExtIdentityAddr) el.inpExtIdentityAddr.value = '';
  renderIncorpModalState();
});

el.extParticipantsList?.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm-ext-inc]');
  if (rm) {
    const idx = Number(rm.getAttribute('data-rm-ext-inc'));
    state.incDraftExt.splice(idx, 1);
    renderIncorpModalState();
  }
});

el.aiFoundersGrid?.addEventListener('change', (e) => {
  const dIdx = e.target.getAttribute('data-inc-dir');
  if (dIdx !== null) {
    state.incDraftAi[Number(dIdx)].isDirector = e.target.checked;
    renderIncorpModalState();
    return;
  }
  const sIdx = e.target.getAttribute('data-inc-sh');
  if (sIdx !== null) {
    state.incDraftAi[Number(sIdx)].isShareholder = e.target.checked;
    renderIncorpModalState();
  }
});

el.aiFoundersGrid?.addEventListener('input', (e) => {
  const shIdx = e.target.getAttribute('data-inc-shares');
  if (shIdx !== null) {
    state.incDraftAi[Number(shIdx)].shares = Math.max(0, Math.floor(Number(e.target.value) || 0));
    renderIncorpModalState();
  }
});

el.incorpForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy) return;
  state.busy = true;
  el.btnSubmitIncorp.disabled = true;
  el.incorpStatusBox.style.display = 'block';

  try {
    const companyName = el.inpIncName.value.trim();
    const ticker = el.inpIncTicker.value.trim().toUpperCase();
    const userShares = Math.max(1000, Math.floor(Number(el.inpIncMyShares.value) || 40000));
    const auctionWindowBlocks = Math.max(3, Math.min(20, Math.floor(Number(el.inpIncWinBlocks.value) || 6)));

    startInflightAnim(`Incorporating ${companyName} on Subnet 1…`);
    const created = await deployNewCorporateCharterHfs({
      wallet: session.wallet,
      companyName,
      ticker,
      userShares,
      aiSelections: [...state.incDraftAi, ...state.incDraftExt],
      auctionWindowBlocks,
      rpcUrl: session.rpcUrl,
      onStatus: (msg) => {
        el.incorpStatusBox.textContent = `⏳ ${msg}`;
        startInflightAnim(msg);
      },
    });

    finishInflightAnim(`🏛️ ${companyName} Incorporated in PENDING_RATIFICATION!`);
    closeIncorpModal();
    setUrlHfsParam(created.primaryAddr);
    await session.hfsDropdown?.refreshList({ selectKey: created.selectionKey });
    await session.applySelectedHfsEntry(created);
    switchTab('overview');
    triggerSparkBurst(['#fbbf24', '#38bdf8', '#10b981']);
    showBanner(
      `🚀 <strong>${escapeHtml(companyName)} Incorporated!</strong> Resolution #0001 (First Shareholder Resolution) is ready — accept your Director seat and click <strong>Vote Yes &amp; Activate Company Charter</strong> above!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Incorporation failed');
    el.incorpStatusBox.textContent = `🚫 ${err.message}`;
    el.btnSubmitIncorp.disabled = false;
  } finally {
    state.busy = false;
  }
});

// ---------------------------------------------------------------------------
// Interactive Click & Button Handlers Across All Tabs
// ---------------------------------------------------------------------------

el.btnToggleRatifyScroll?.addEventListener('click', () => {
  const open = el.ratifyScrollBox.style.display !== 'none';
  el.ratifyScrollBox.style.display = open ? 'none' : 'block';
});

el.btnSignDirectorConsent?.addEventListener('click', () => {
  signMyDirectorConsent();
});

el.btnSignAndRatify?.addEventListener('click', () => {
  if (state.firstRes) signAndEnactResolution(state.firstRes);
});

el.btnTestInactiveGuard?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.corporateCharter) return;
  state.busy = true;
  try {
    const myId = await session.ensureMyIdentity();
    startInflightAnim('Testing Wasmtime ERR_CHARTER_NOT_ACTIVE (-91) guard…');
    await session.sendAsMyIdentity(
      encodeAbi('grantRole(address,bytes32,address,address)', [
        ['address', session.inst.corporateCharter],
        ['bytes32', GOV_CONSTANTS.ROLE_CEO],
        ['address', myId],
        ['address', state.firstRes?.authAddr || myId],
      ]),
      'guardCheck:preRatification',
      'CorporateCharter'
    );
  } catch (err) {
    finishInflightAnim('🛡️ Pre-Ratification Guard Verified!');
    showBanner(
      `🛡️ <strong>Verified Constitutional Guard (-91)!</strong> Wasmtime rejected executing corporate mutations before the First Shareholder Resolution activates the Charter (${escapeHtml(err.message)}).`,
      'ok'
    );
  } finally {
    state.busy = false;
  }
});

el.btnFaucetCash?.addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  try {
    startInflightAnim('Crediting +50,000 SGD cash to your Identity HFS…');
    await session.requestFiatTopUp(50000);
    finishInflightAnim('💧 +50,000 SGD Credited!');
    await refreshCharterWorld();
    showBanner(`✅ Credited <strong>+50,000 SGD</strong> to your verified Identity HFS!`, 'ok');
  } catch (err) {
    finishInflightAnim('⚠ Top-up failed');
    showBanner(`🚫 Cash faucet error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnQuickAppointExec?.addEventListener('click', () => switchTab('actions'));
el.btnJumpNewResolution?.addEventListener('click', () => switchTab('actions'));
el.btnQuickIssuanceArena?.addEventListener('click', () => switchTab('issuance'));
el.btnQuickEsopTab?.addEventListener('click', () => switchTab('esop'));
el.btnQuickTransferArena?.addEventListener('click', () => switchTab('transfer'));

// 5-Step Share Issuance Arena Controls
el.selArenaIssAsset?.addEventListener('change', renderIssuanceArenaDerived);
el.inpArenaIssClassName?.addEventListener('input', renderIssuanceArenaDerived);
el.inpArenaIssConv?.addEventListener('input', renderIssuanceArenaDerived);
el.inpArenaIssRaise?.addEventListener('input', renderIssuanceArenaDerived);
el.inpArenaIssMaxOwn?.addEventListener('input', renderIssuanceArenaDerived);

el.selActiveIssuanceRound?.addEventListener('change', async () => {
  const addr = (el.selActiveIssuanceRound.value || '').toLowerCase();
  if (addr) {
    state.activeIssuanceAddr = addr;
    if (session.inst?.corporateCharter) {
      saveIssuanceAddr(session.inst.corporateCharter, addr);
    }
    await refreshCharterWorld();
  }
});

el.formLaunchIssuanceRound?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = el.selArenaIssAsset?.value || 'CUSTOM_PREFERRED';
  const existingObj = state.shareClasses.find((c) => c.ledger === mode);
  const customClassName = existingObj
    ? existingObj.symbol
    : (el.inpArenaIssClassName?.value || 'Preferred X').trim();
  const convRate =
    mode === 'COMMON'
      ? 1
      : existingObj
        ? Math.max(1, Math.round(existingObj.convMult))
        : Math.max(1, Math.floor(Number(el.inpArenaIssConv?.value) || 1));
  const minRaiseAmount = Math.max(1000, Math.floor(Number(el.inpArenaIssRaise?.value) || 1000000));
  const maxOwnershipPct = Math.max(0.5, Math.min(90, Number(el.inpArenaIssMaxOwn?.value) || 20));
  await deployActionResolution({
    kind: 'issueShares',
    assetClassKey: mode,
    customClassName,
    conversionRate: convRate,
    minRaiseAmount,
    maxOwnershipPct,
  });
});

el.btnArenaTestZeroBidIssuance?.addEventListener('click', async () => {
  const mode = el.selArenaIssAsset?.value || 'CUSTOM_PREFERRED';
  const existingObj = state.shareClasses.find((c) => c.ledger === mode);
  await deployActionResolution({
    kind: 'issueShares',
    assetClassKey: mode,
    customClassName: existingObj ? existingObj.symbol : (el.inpArenaIssClassName?.value || 'Preferred X').trim(),
    conversionRate:
      mode === 'COMMON'
        ? 1
        : existingObj
          ? Math.max(1, Math.round(existingObj.convMult))
          : Math.max(1, Math.floor(Number(el.inpArenaIssConv?.value) || 1)),
    minRaiseAmount: 999999999999,
    maxOwnershipPct: 10,
  });
});

el.btnVoteIssuanceStep1?.addEventListener('click', async () => {
  if (state.issuanceRound) {
    await signAndEnactResolution(state.issuanceRound);
  }
});

async function placeIssuanceArenaOrder(isRofr) {
  const rd = state.issuanceRound;
  if (!rd || state.busy || !session.inst?.shareCapital) return;
  if (isRofr && (!state.myIsShareholder || !activeVerifiedIdentityLow())) {
    showBanner('🔒 Only existing Shareholders of this company can exercise Step 3 ROFR.', 'err');
    return;
  }
  const qty = Math.max(
    1,
    Math.floor(Number((isRofr ? el.inpIssStep3Qty : el.inpIssStep2Qty)?.value) || 2000)
  );
  const minPx = isRofr ? rd.projectedClearingPrice || rd.offerPrice || 1 : rd.offerPrice || 1;
  const px = Math.max(
    minPx,
    Math.floor(Number((isRofr ? el.inpIssStep3Price : el.inpIssStep2Price)?.value) || minPx)
  );
  const totalCash = qty * px;
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    if (state.myCash < totalCash) {
      startInflightAnim(`Crediting +${fmtNum(totalCash - state.myCash + 20000)} SGD so escrow clears…`);
      await session.requestFiatTopUp(totalCash - state.myCash + 20000);
    }
    startInflightAnim(
      isRofr
        ? `Exercising Step 3 Shareholder ROFR (${fmtNum(qty)} sh @ ${fmtNum(px)} SGD)…`
        : `Placing Step 2 Investor Buy Bid (${fmtNum(qty)} sh @ ${fmtNum(px)} SGD)…`
    );
    const targets = [
      session.inst.corporateCharter,
      session.inst.shareCapital,
      rd.authAddr,
      rd.targetShareLedger || rd.targetHps || session.inst.shareLedger,
      session.inst.fiatLedger,
      session.inst.dexEscrowIdentity,
      ...state.shareClasses.map((c) => c.ledger),
    ].filter(Boolean);
    await session.sendAsMyIdentity(
      encodeAbi('placeBuyOrderViaShareCapital(address,address,uint64,uint64)', [
        ['address', session.inst.shareCapital],
        ['address', rd.authAddr],
        ['uint64', px],
        ['uint64', qty],
      ]),
      isRofr ? 'Issuance.Step3ROFR' : 'Issuance.Step2Bid',
      'ShareCapital',
      targets
    );
    finishInflightAnim(isRofr ? '🛡️ Step 3 ROFR Order Escrowed!' : '💵 Step 2 Investor Bid Escrowed!');
    triggerSparkBurst(['#38bdf8', '#10b981']);
    await refreshCharterWorld();
    showBanner(
      isRofr
        ? `✅ <strong>Step 3 Shareholder ROFR Exercised!</strong> Escrowed <strong>${fmtNum(qty)} shares @ ${fmtNum(px)} SGD</strong> — ROFR orders receive 100% priority in Step 4!`
        : `✅ <strong>Step 2 Investor Bid Placed!</strong> Escrowed <strong>${fmtNum(qty)} shares @ ${fmtNum(px)} SGD</strong> (${fmtNum(totalCash)} SGD)!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Order reverted');
    showBanner(`🚫 Issuance order error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
}

el.btnPlaceIssStep2Bid?.addEventListener('click', () => placeIssuanceArenaOrder(false));
el.btnPlaceIssStep3Rofr?.addEventListener('click', () => placeIssuanceArenaOrder(true));

async function claimMyIssuanceShaShares(authAddrRaw) {
  const authAddr = (authAddrRaw || state.issuanceRound?.authAddr || '').toLowerCase();
  if (!authAddr || state.busy || !session.inst?.shareCapital) return;
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    const chr = session.inst.corporateCharter;
    const sc = session.inst.shareCapital;
    const [shaHex, treasHex] = await Promise.all([
      session.ethCall(chr, encodeAbi('shaDocumentHash()')),
      session.ethCall(sc, encodeAbi('treasuryRecipient()')).catch(() => ZERO_ADDR),
    ]);
    const treasuryAddr = decodeAddrWord(treasHex);
    const rd =
      state.resolutions.find((x) => x.authAddr.toLowerCase() === authAddr) || state.issuanceRound;
    const targetLed = rd?.targetShareLedger || rd?.targetHps || session.inst.shareLedger;
    startInflightAnim(
      "Step 5: Signing Company Shareholders' Agreement (SHA) & claiming allotted shares onto Cap Table…"
    );
    const inner = encodeAbi('signShareholdersAgreementAndClaimShares(address,bytes32)', [
      ['address', authAddr],
      ['bytes32', shaHex.slice(0, 66)],
    ]);
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', sc],
        ['bytes', hexToBytes(inner)],
      ]),
      'signShareholdersAgreementAndClaimShares',
      'ShareCapital',
      [
        chr,
        sc,
        authAddr,
        targetLed,
        session.inst.fiatLedger,
        session.inst.dexEscrowIdentity,
        treasuryAddr !== ZERO_ADDR ? treasuryAddr : '',
        ...state.shareClasses.map((c) => c.ledger),
      ].filter(Boolean)
    );
    finishInflightAnim('🎉 SHA Signed & Shares Minted in Your Name on Cap Table!');
    triggerSparkBurst(['#10b981', '#fbbf24', '#38bdf8', '#a78bfa']);
    await refreshCharterWorld();
    showBanner(
      `🎉 <strong>Shareholders' Agreement Signed &amp; Shares Minted!</strong> Your allotted shares are now registered in your name and the Capitalization Table has updated automatically!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ SHA claim reverted');
    showBanner(`🚫 SHA claim error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
}

el.btnSignIssuanceShaClaim?.addEventListener('click', () => claimMyIssuanceShaShares());
el.btnPreviewIssuanceSha?.addEventListener('click', async () => {
  const chr = session.inst?.corporateCharter;
  const shaHex = chr
    ? await session.ethCall(chr, encodeAbi('shaDocumentHash()')).catch(() => '')
    : '';
  el.scrollModalTitle.textContent = `📄 Shareholders' Agreement (SHA)`;
  el.scrollModalBody.innerHTML = buildShareholdersAgreementHtml(shaHex.slice(0, 66));
  el.scrollModal.classList.add('open');
});
el.btnRefundFailedIssuanceArena?.addEventListener('click', async () => {
  if (!state.issuanceRound || state.busy || !session.inst?.shareCapital) return;
  const authAddr = state.issuanceRound.authAddr.toLowerCase();
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    startInflightAnim('Refunding escrowed cash from failed issuance round…');
    const inner = encodeAbi('refundFailedAuction(address)', [['address', authAddr]]);
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', session.inst.shareCapital],
        ['bytes', hexToBytes(inner)],
      ]),
      'refundFailedAuction',
      'ShareCapital',
      [
        session.inst.shareCapital,
        authAddr,
        session.inst.fiatLedger,
        session.inst.dexEscrowIdentity,
        ...(state.issuanceRound.issuanceOrders || []).map((o) => o.trader),
      ].filter(Boolean)
    );
    finishInflightAnim('↩️ Issuance Escrow Refunded!');
    await refreshCharterWorld();
    showBanner('✅ Refunded all escrowed cash from the failed issuance round!', 'ok');
  } catch (err) {
    finishInflightAnim('⚠ Refund reverted');
    showBanner(`🚫 Refund error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnCloseScrollModal?.addEventListener('click', () => el.scrollModal.classList.remove('open'));
el.scrollModal?.addEventListener('click', () => el.scrollModal.classList.remove('open'));

// Global delegated clicks (Org chart nodes, Resolution cards, Director consent, Copy Identity, Auction cancel, Futures DEX)
document.addEventListener('click', async (e) => {
  const quickWfBtn = e.target.closest('[data-quick-workflow]');
  if (quickWfBtn) {
    const wf = quickWfBtn.getAttribute('data-quick-workflow');
    if (wf === 'leadership') {
      switchTab('actions');
    } else if (wf === 'fundraise') {
      switchTab('issuance');
    } else if (wf === 'secondary') {
      switchTab('transfer');
    } else if (wf === 'esop') {
      switchTab('esop');
    } else if (wf === 'serviceContract') {
      state.selectedActionKind = 'serviceContract';
      document.querySelectorAll('#actionTypePicker .action-pick-card').forEach((c) => {
        c.classList.toggle('selected', c.getAttribute('data-action-kind') === 'serviceContract');
      });
      switchTab('actions');
      populateActionTargetDropdown();
      renderActionStudioState();
    }
    return;
  }

  const resFilterBtn = e.target.closest('[data-res-filter]');
  if (resFilterBtn) {
    state.resFilter = resFilterBtn.getAttribute('data-res-filter') || 'open';
    renderResolutionsGrid();
    return;
  }

  if (e.target.closest('[data-scroll-to-ratify]')) {
    el.ratifySpotlight?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const arenaPrefBtn = e.target.closest('[data-arena-pref-preset]');
  if (arenaPrefBtn && el.inpArenaIssClassName) {
    el.inpArenaIssClassName.value = arenaPrefBtn.getAttribute('data-arena-pref-preset');
    if (el.selArenaIssAsset) el.selArenaIssAsset.value = 'CUSTOM_PREFERRED';
    renderIssuanceArenaDerived();
    return;
  }

  const studioPrefBtn = e.target.closest('[data-studio-pref-preset]');
  if (studioPrefBtn && el.inpIssueCustomClassName) {
    el.inpIssueCustomClassName.value = studioPrefBtn.getAttribute('data-studio-pref-preset');
    if (el.selIssueAssetClass) el.selIssueAssetClass.value = 'CUSTOM_PREFERRED';
    renderEquityDerivedEconomics();
    renderStudioTemplatePreview();
    return;
  }

  const openIssArenaBtn = e.target.closest('[data-open-issuance-arena]');
  if (openIssArenaBtn) {
    const addr = openIssArenaBtn.getAttribute('data-open-issuance-arena').toLowerCase();
    state.activeIssuanceAddr = addr;
    if (session.inst?.corporateCharter) {
      saveIssuanceAddr(session.inst.corporateCharter, addr);
    }
    switchTab('issuance');
    await refreshCharterWorld();
    return;
  }

  const claimIssShaBtn = e.target.closest('[data-claim-issuance-sha]');
  if (claimIssShaBtn) {
    await claimMyIssuanceShaShares(claimIssShaBtn.getAttribute('data-claim-issuance-sha'));
    return;
  }

  const cancelIssOrdBtn = e.target.closest('[data-cancel-iss-order]');
  if (cancelIssOrdBtn && state.issuanceRound && !state.busy && session.inst?.shareCapital) {
    const ordIdx = Number(cancelIssOrdBtn.getAttribute('data-cancel-iss-order'));
    state.busy = true;
    try {
      await session.ensureMyIdentity((m) => startInflightAnim(m));
      startInflightAnim(`Cancelling order #${ordIdx} & refunding escrowed cash…`);
      await session.sendAsMyIdentity(
        encodeAbi('cancelBuyOrderViaShareCapital(address,address,uint64)', [
          ['address', session.inst.shareCapital],
          ['address', state.issuanceRound.authAddr],
          ['uint64', ordIdx],
        ]),
        'cancelBuyOrderViaShareCapital',
        'ShareCapital',
        [
          session.inst.corporateCharter,
          session.inst.shareCapital,
          state.issuanceRound.authAddr,
          session.inst.fiatLedger,
          session.inst.dexEscrowIdentity,
        ].filter(Boolean)
      );
      finishInflightAnim('↩️ Order Cancelled & Escrow Refunded!');
      await refreshCharterWorld();
    } catch (err) {
      finishInflightAnim('⚠ Cancel reverted');
      showBanner(`🚫 Cancel error: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  if (e.target.closest('[data-trigger-director-consent]')) {
    await signMyDirectorConsent();
    return;
  }

  if (e.target.closest('[data-open-incorp-quick]')) {
    openIncorpModal();
    return;
  }

  const copyBtn = e.target.closest('[data-copy-my-identity]');
  if (copyBtn) {
    const idAddr = copyBtn.getAttribute('data-copy-my-identity');
    if (idAddr && navigator.clipboard) {
      await navigator.clipboard.writeText(idAddr).catch(() => {});
      showBanner(`📋 Copied your verified Identity HFS address: <code>${escapeHtml(idAddr)}</code>`, 'ok');
    }
    return;
  }
  const vacExec = e.target.closest('[data-quick-appoint-role]');
  if (vacExec) {
    const roleKey = vacExec.getAttribute('data-quick-appoint-role');
    state.selectedActionKind = 'appointExec';
    el.actionTypePicker?.querySelectorAll('.action-pick-card').forEach((c) => {
      c.classList.toggle('selected', c.getAttribute('data-action-kind') === 'appointExec');
    });
    if (el.selExecRole) el.selExecRole.value = roleKey;
    switchTab('actions');
    renderActionStudioState();
    return;
  }

  const revExec = e.target.closest('[data-quick-revoke-exec]');
  if (revExec) {
    const roleKey = revExec.getAttribute('data-quick-revoke-exec');
    const holder = revExec.getAttribute('data-holder');
    state.selectedActionKind = 'revokeExec';
    el.actionTypePicker?.querySelectorAll('.action-pick-card').forEach((c) => {
      c.classList.toggle('selected', c.getAttribute('data-action-kind') === 'revokeExec');
    });
    if (el.selExecRole) el.selExecRole.value = roleKey;
    switchTab('actions');
    populateActionTargetDropdown();
    if (holder && el.selTargetIdentity) el.selTargetIdentity.value = holder;
    renderActionStudioState();
    return;
  }

  const fireDir = e.target.closest('[data-quick-fire-dir]');
  if (fireDir) {
    const dirAddr = fireDir.getAttribute('data-quick-fire-dir');
    state.selectedActionKind = 'removeDirector';
    el.actionTypePicker?.querySelectorAll('.action-pick-card').forEach((c) => {
      c.classList.toggle('selected', c.getAttribute('data-action-kind') === 'removeDirector');
    });
    switchTab('actions');
    populateActionTargetDropdown();
    if (dirAddr && el.selTargetIdentity) el.selTargetIdentity.value = dirAddr;
    renderActionStudioState();
    return;
  }

  const signExecBtn = e.target.closest('[data-sign-exec]');
  if (signExecBtn) {
    const addr = signExecBtn.getAttribute('data-sign-exec').toLowerCase();
    const r = state.resolutions.find((x) => x.authAddr.toLowerCase() === addr);
    if (r) await signAndEnactResolution(r);
    return;
  }

  const viewScrollBtn = e.target.closest('[data-view-scroll]');
  if (viewScrollBtn) {
    const addr = viewScrollBtn.getAttribute('data-view-scroll').toLowerCase();
    const r = state.resolutions.find((x) => x.authAddr.toLowerCase() === addr);
    if (r) {
      el.scrollModalTitle.textContent = `📜 ${r.title}`;
      el.scrollModalBody.innerHTML = buildResolutionTemplate(r, 'hydrated');
      el.scrollModal.classList.add('open');
    }
    return;
  }

  const viewSsaBtn = e.target.closest('[data-view-ssa]');
  if (viewSsaBtn) {
    const addr = viewSsaBtn.getAttribute('data-view-ssa').toLowerCase();
    const r = state.resolutions.find((x) => x.authAddr.toLowerCase() === addr);
    if (r) {
      el.scrollModalTitle.textContent = `📄 Share Subscription Agreement (SSA)`;
      el.scrollModalBody.innerHTML = buildShareSubscriptionAgreementHtml(r, r.ssaHash);
      el.scrollModal.classList.add('open');
    }
    return;
  }

  const viewShaBtn = e.target.closest('[data-view-sha]');
  if (viewShaBtn) {
    const addr = viewShaBtn.getAttribute('data-view-sha').toLowerCase();
    const r = state.resolutions.find((x) => x.authAddr.toLowerCase() === addr);
    el.scrollModalTitle.textContent = `📄 Shareholders' Agreement (SHA)`;
    el.scrollModalBody.innerHTML = buildShareholdersAgreementHtml(r?.shaHash || '');
    el.scrollModal.classList.add('open');
    return;
  }

  const subEqfBtn = e.target.closest('[data-sub-eqf]');
  if (subEqfBtn && !state.busy && session.inst?.shareCapital) {
    const authAddr = subEqfBtn.getAttribute('data-sub-eqf').toLowerCase();
    const offerPx = Math.max(1, Number(subEqfBtn.getAttribute('data-offer-px') || 1));
    const qtyEl = document.getElementById(`inpSubQty_${authAddr}`);
    const pxEl = document.getElementById(`inpSubPx_${authAddr}`);
    const qty = Math.max(1, Math.floor(Number(qtyEl?.value) || 500));
    const px = Math.max(offerPx, Math.floor(Number(pxEl?.value) || offerPx + 2));
    state.busy = true;
    try {
      await session.ensureMyIdentity((m) => startInflightAnim(m));
      const ssaHashHex = (await session.ethCall(authAddr, encodeAbi('ssaTemplateHash()'))).slice(0, 66);
      startInflightAnim(`Signing Share Subscription Agreement & escrowing ${fmtNum(qty)} sh @ ${fmtNum(px)} SGD…`);
      const inner = encodeAbi('placeSubscriptionOrder(address,uint64,uint64,bytes32)', [
        ['address', authAddr],
        ['uint64', px],
        ['uint64', qty],
        ['bytes32', ssaHashHex],
      ]);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', session.inst.shareCapital],
          ['bytes', hexToBytes(inner)],
        ]),
        'placeSubscriptionOrder',
        'ShareCapital',
        [
          session.inst.corporateCharter,
          session.inst.shareCapital,
          authAddr,
          session.inst.fiatLedger,
          session.inst.dexEscrowIdentity,
        ].filter(Boolean)
      );
      finishInflightAnim('✍️ SSA Signed & Subscription Buy Order Escrowed!');
      triggerSparkBurst(['#38bdf8', '#10b981']);
      await refreshCharterWorld();
      showBanner(
        `✅ Signed <strong>Share Subscription Agreement</strong> &amp; escrowed <strong>${fmtNum(qty)} shares @ ${fmtNum(px)} SGD</strong> (${fmtNum(qty * px)} SGD)!`,
        'ok'
      );
    } catch (err) {
      finishInflightAnim('⚠ Subscription order reverted');
      showBanner(`🚫 SSA Subscription error: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  const refundIssBtn = e.target.closest('[data-refund-issuance]');
  if (refundIssBtn && !state.busy && session.inst?.shareCapital) {
    const authAddr = refundIssBtn.getAttribute('data-refund-issuance').toLowerCase();
    state.busy = true;
    try {
      await session.ensureMyIdentity((m) => startInflightAnim(m));
      const r = state.resolutions.find((x) => x.authAddr.toLowerCase() === authAddr);
      startInflightAnim('Refunding escrowed investor cash from under-subscribed financing…');
      const inner = encodeAbi('refundFailedAuction(address)', [['address', authAddr]]);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', session.inst.shareCapital],
          ['bytes', hexToBytes(inner)],
        ]),
        'refundFailedAuction',
        'ShareCapital',
        [
          session.inst.shareCapital,
          authAddr,
          session.inst.fiatLedger,
          session.inst.dexEscrowIdentity,
          ...(r?.issuanceOrders || []).map((o) => o.trader),
        ].filter(Boolean)
      );
      finishInflightAnim('↩️ Investor Escrow Refunded!');
      await refreshCharterWorld();
      showBanner('✅ Refunded all escrowed investor cash from the under-subscribed financing!', 'ok');
    } catch (err) {
      finishInflightAnim('⚠ Refund reverted');
      showBanner(`🚫 Refund error: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  const previewExBtn = e.target.closest('[data-preview-ex-letter]');
  if (previewExBtn && session.inst?.shareCapital) {
    const gid = Number(previewExBtn.getAttribute('data-preview-ex-letter'));
    const g = state.esopGrants.find((x) => x.grantId === gid);
    const prog = g && state.esopPrograms.find((p) => p.programId === g.programId);
    if (g && prog) {
      const amt = Math.max(1, Math.floor(Number(document.getElementById(`inpExAmt_${gid}`)?.value) || g.exercisableNow || 100));
      const letterHex = await session
        .ethCall(
          session.inst.shareCapital,
          encodeAbi('expectedExerciseLetterHash(uint64,uint64,address,uint64)', [
            ['uint64', prog.programId],
            ['uint64', gid],
            ['address', g.employee],
            ['uint64', amt],
          ])
        )
        .catch(() => '');
      el.scrollModalTitle.textContent = `📄 Employee Option Exercise Letter${g.isFirstTimeShareholder ? " + Shareholders' Agreement" : ''}`;
      el.scrollModalBody.innerHTML =
        buildEsopExerciseLetterHtml(prog, g, amt, letterHex.slice(0, 66)) +
        (g.isFirstTimeShareholder ? '\n\n' + buildShareholdersAgreementHtml('') : '');
      el.scrollModal.classList.add('open');
    }
    return;
  }

  const exGrantBtn = e.target.closest('[data-exercise-grant]');
  if (exGrantBtn && !state.busy && session.inst?.shareCapital) {
    const gid = Number(exGrantBtn.getAttribute('data-exercise-grant'));
    const g = state.esopGrants.find((x) => x.grantId === gid);
    const prog = g && state.esopPrograms.find((p) => p.programId === g.programId);
    if (!g || !prog) return;
    const amt = Math.max(1, Math.floor(Number(document.getElementById(`inpExAmt_${gid}`)?.value) || g.exercisableNow));
    const chkSha = document.getElementById(`chkExSha_${gid}`);
    if (g.isFirstTimeShareholder && chkSha && !chkSha.checked) {
      showBanner(
        `🚫 <strong>First-Time Shareholder Requirement (-99):</strong> Because this is your first time becoming a shareholder, you must co-sign the <strong>Shareholders' Agreement</strong> along with the Exercise Letter!`,
        'err'
      );
      return;
    }

    state.busy = true;
    try {
      const myId = await session.ensureMyIdentity((m) => startInflightAnim(m));
      const chr = session.inst.corporateCharter;
      const sc = session.inst.shareCapital;
      const [letterHex, shaHex, treasHex] = await Promise.all([
        session.ethCall(
          sc,
          encodeAbi('expectedExerciseLetterHash(uint64,uint64,address,uint64)', [
            ['uint64', prog.programId],
            ['uint64', gid],
            ['address', myId],
            ['uint64', amt],
          ])
        ),
        g.isFirstTimeShareholder ? session.ethCall(chr, encodeAbi('shaDocumentHash()')) : Promise.resolve('0x' + '0'.repeat(64)),
        session.ethCall(sc, encodeAbi('treasuryRecipient()')).catch(() => ZERO_ADDR),
      ]);
      const treasuryAddr = decodeAddrWord(treasHex);
      startInflightAnim(
        `Exercising ${fmtNum(amt)} options${g.isFirstTimeShareholder ? " (with Shareholders' Agreement)" : ''} → +${fmtNum(amt)} ${prog.underlyingSymbol}…`
      );
      const inner = encodeAbi('exerciseEmployeeOptions(uint64,uint64,uint64,bytes32,bytes32)', [
        ['uint64', prog.programId],
        ['uint64', gid],
        ['uint64', amt],
        ['bytes32', letterHex.slice(0, 66)],
        ['bytes32', shaHex.slice(0, 66)],
      ]);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', sc],
          ['bytes', hexToBytes(inner)],
        ]),
        'exerciseEmployeeOptions',
        'ShareCapital',
        [
          chr,
          sc,
          prog.optionLedger,
          prog.underlyingLedger,
          session.inst.fiatLedger,
          treasuryAddr !== ZERO_ADDR ? treasuryAddr : '',
          ...state.shareClasses.map((c) => c.ledger),
        ].filter(Boolean)
      );
      finishInflightAnim(`🚀 Exercised ${fmtNum(amt)} Options → +${fmtNum(amt)} ${prog.underlyingSymbol}!`);
      triggerSparkBurst(['#10b981', '#38bdf8', '#fbbf24']);
      await refreshCharterWorld();
      showBanner(
        `🎉 <strong>Options Exercised!</strong> Burned ${fmtNum(amt)} ${escapeHtml(prog.optionSymbol)} and minted <strong>+${fmtNum(amt)} ${escapeHtml(prog.underlyingSymbol)}</strong> onto the Capitalization Table!`,
        'ok'
      );
    } catch (err) {
      finishInflightAnim('⚠ Option exercise reverted');
      showBanner(`🚫 Option exercise error: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  const testEsopGuardBtn = e.target.closest('[data-test-esop-guard]');
  if (testEsopGuardBtn && !state.busy && session.inst?.shareCapital) {
    const gid = Number(testEsopGuardBtn.getAttribute('data-test-esop-guard'));
    const g = state.esopGrants.find((x) => x.grantId === gid);
    const prog = g && state.esopPrograms.find((p) => p.programId === g.programId);
    if (!g || !prog) return;
    state.busy = true;
    const testingCliff = !g.cliffPassed;
    try {
      const myId = await session.ensureMyIdentity();
      const sc = session.inst.shareCapital;
      const letterHex = await session.ethCall(
        sc,
        encodeAbi('expectedExerciseLetterHash(uint64,uint64,address,uint64)', [
          ['uint64', prog.programId],
          ['uint64', gid],
          ['address', myId],
          ['uint64', 1],
        ])
      );
      startInflightAnim(
        testingCliff
          ? 'Testing Wasmtime ERR_ESOP_CLIFF_NOT_PASSED (-98) guard…'
          : 'Testing Wasmtime ERR_SHA_SIGNATURE_REQUIRED (-99) / unvested guard…'
      );
      const inner = encodeAbi('exerciseEmployeeOptions(uint64,uint64,uint64,bytes32,bytes32)', [
        ['uint64', prog.programId],
        ['uint64', gid],
        ['uint64', Math.max(1, g.exercisableNow || 1)],
        ['bytes32', letterHex.slice(0, 66)],
        ['bytes32', '0x' + '0'.repeat(64)], // omit SHA hash intentionally!
      ]);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', sc],
          ['bytes', hexToBytes(inner)],
        ]),
        'guardCheck:exerciseEmployeeOptions',
        'ShareCapital',
        [session.inst.corporateCharter, sc, prog.optionLedger, prog.underlyingLedger, ...state.shareClasses.map((c) => c.ledger)]
      );
    } catch (err) {
      finishInflightAnim('🛡️ ESOP On-Chain Guard Verified!');
      showBanner(
        testingCliff
          ? `🛡️ <strong>Verified Cliff Guard (-98)!</strong> Wasmtime blocked option exercise prior to Cliff Block #${fmtNum(g.cliffBlock)} (${escapeHtml(err.message)}).`
          : `🛡️ <strong>Verified ESOP Exercise / First-Time SHA Guard (-99)!</strong> Wasmtime rejected exercising without required Shareholders' Agreement signature or vested balance (${escapeHtml(err.message)}).`,
        'ok'
      );
    } finally {
      state.busy = false;
    }
    return;
  }

  const bidIssuanceBtn = e.target.closest('[data-bid-issuance]');
  if (bidIssuanceBtn && !state.busy && session.inst?.shareCapital) {
    const authAddr = bidIssuanceBtn.getAttribute('data-bid-issuance').toLowerCase();
    const px = Math.max(1, Number(bidIssuanceBtn.getAttribute('data-min-px') || 105));
    const qty = 1000;
    state.busy = true;
    try {
      await session.ensureMyIdentity((m) => startInflightAnim(m));
      startInflightAnim(`Placing Subscription Bid (${fmtNum(qty)} sh @ ${fmtNum(px)} SGD) & escrowing cash…`);
      await session.sendAsMyIdentity(
        encodeAbi('placeBuyOrderViaShareCapital(address,address,uint64,uint64)', [
          ['address', session.inst.shareCapital],
          ['address', authAddr],
          ['uint64', px],
          ['uint64', qty],
        ]),
        'Issuance.placeSubscriptionBid',
        'ShareCapital',
        [session.inst.shareCapital, authAddr, session.inst.fiatLedger]
      );
      finishInflightAnim('💵 Subscription Bid Escrowed on ShareCapital!');
      await refreshCharterWorld();
      showBanner(
        `✅ Escrowed Subscription Bid for <strong>${fmtNum(qty)} ${escapeHtml(shareTickerStr())} @ ${fmtNum(px)} SGD</strong>!`,
        'ok'
      );
    } catch (err) {
      finishInflightAnim('⚠ Subscription bid reverted');
      showBanner(`🚫 Subscription bid error: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  const testRevBtn = e.target.closest('[data-test-revert]');
  if (testRevBtn && !state.busy) {
    const addr = testRevBtn.getAttribute('data-test-revert').toLowerCase();
    const r = state.resolutions.find((x) => x.authAddr.toLowerCase() === addr);
    if (!r) return;
    state.busy = true;
    try {
      await session.ensureMyIdentity();
      startInflightAnim(
        r.failedBidsStage
          ? `Verifying CorporateCharter ERR_NO_BIDS_IN_STAGE (-97) rejection on ${shortAddr(r.authAddr)}…`
          : `Testing Wasmtime guard on ${shortAddr(r.authAddr)}…`
      );
      await session.sendAsMyIdentity(
        buildResolutionExecCalldata(r),
        `guardCheck:${r.execKind}`,
        'CorporateCharter',
        [r.authAddr, r.targetHps, ...(session.inst.shareCapital ? [session.inst.shareCapital] : [])]
      );
    } catch (err) {
      finishInflightAnim('🛡️ On-Chain Wasmtime Guard Verified!');
      showBanner(
        r.failedBidsStage
          ? `🛡️ <strong>Verified CorporateCharter 0-Bid Rejection (-97)!</strong> Because 0 bids were placed before Stage 0 expired, <code>CorporateCharter.validateCapitalProcessAuth</code> &amp; <code>ShareCapital</code> rejected enactment (${escapeHtml(err.message)}).`
          : `🛡️ <strong>Verified On-Chain Revert!</strong> Wasmtime blocked ${
              r.status === 4 ? 'replaying a consumed one-time Authorization (-68)' : 'executing below threshold quorum / wrong stage'
            } (${escapeHtml(err.message)}).`,
        'ok'
      );
    } finally {
      state.busy = false;
    }
    return;
  }

  const cancelOrdBtn = e.target.closest('[data-cancel-auc-order]');
  if (cancelOrdBtn && !state.busy && state.activeAuctionAddr) {
    const idx = Number(cancelOrdBtn.getAttribute('data-cancel-auc-order'));
    state.busy = true;
    try {
      startInflightAnim(`Cancelling Buy Order #${idx} & refunding ShareEscrow…`);
      await session.sendAsMyIdentity(
        encodeAbi('cancelBuyOrderViaShareCapital(address,address,uint64)', [
          ['address', session.inst.shareCapital],
          ['address', state.activeAuctionAddr],
          ['uint64', idx],
        ]),
        `cancelBuyOrder(#${idx})`,
        'ShareCapital',
        [session.inst.shareCapital, state.activeAuctionAddr]
      );
      finishInflightAnim('↩️ Buy Order Cancelled & Refunded!');
      await refreshCharterWorld();
    } catch (err) {
      finishInflightAnim('⚠ Cancel reverted');
      showBanner(`🚫 Cancel failed: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  if (e.target.closest('#btnAttachFuturesDex')) {
    await deployAndAttachFuturesDex();
    return;
  }

  if (e.target.closest('#btnQuickListFuturesAsk')) {
    await quickListFuturesOnDex();
  }
});

// ---------------------------------------------------------------------------
// 3-Step Share Transfer Arena Button Handlers
// ---------------------------------------------------------------------------

async function spawnFreshAuctionAuth() {
  await session.ensureMyIdentity((m) => startInflightAnim(m));
  startInflightAnim('Instantiating 3-Step Share Transfer Call-Auction HFS…');
  const rcpt = await session.sendRawSigned({
    privateKey: session.wallet.keypair.privateKey,
    to: null,
    dataHex: session.codeHashes.authorization,
    label: 'instantiate(TransferAuction)',
    contractLabel: 'Authorization',
    gasLimit: 4_800_000n,
  });
  const authAddr = rcpt.contractAddress.toLowerCase();

  startInflightAnim(`Initializing POLICY_SHARE_TRANSFER_AUCTION on ${shortAddr(authAddr)}…`);
  await session.sendAsMyIdentity(
    encodeAbi('initTransferAuction(address,address,address,address)', [
      ['address', authAddr],
      ['address', session.inst.registry],
      ['address', session.inst.corporateCharter],
      ['address', session.inst.shareLedger],
    ]),
    'initTransferAuction',
    'Authorization',
    [authAddr]
  );
  state.activeAuctionAddr = authAddr;
  saveAuctionAddr(session.inst.corporateCharter, authAddr);
  finishInflightAnim('✓ Transfer Auction HFS Ready!');
  return authAddr;
}

el.btnNewAuctionInstance?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.shareCapital) return;
  state.busy = true;
  try {
    state.guidedPlan = null;
    const addr = await spawnFreshAuctionAuth();
    await refreshCharterWorld();
    showBanner(
      `🚀 Spawned fresh Transfer Auction HFS (<code>${shortAddr(addr)}</code>)! Subnet 1 AI Identities automatically detect new Share Sales and place staggered Window 1 Buyer Bids — watch Window 1 fill, then offer your shares in Window 2!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Failed to spawn auction');
    showBanner(`🚫 Auction error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnLaunchGuidedTransfer?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.shareCapital) return;
  if (!state.myIsShareholder || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only existing Shareholders holding company shares can launch a Guided Share Sale.', 'err');
    return;
  }
  const qty = Math.max(100, Math.floor(Number(el.inpGuidedSellQty.value) || 5000));
  const px = Math.max(1, Math.floor(Number(el.inpGuidedSellPrice.value) || 100));

  state.busy = true;
  try {
    const authAddr = await spawnFreshAuctionAuth();
    state.guidedPlan = {
      authAddr,
      userSellQty: qty,
      userSellPrice: px,
      win1Done: false,
      win2UserDone: false,
      win2AiDone: false,
      win3AiDone: false,
      settledDone: false,
    };
    await refreshCharterWorld();
    showBanner(
      `🎮 <strong>Guided Share Transfer Started!</strong> Watch Window 1 Buyer Bids → Window 2 Shareholder Co-Sale → Window 3 ROFR → Single-Price Pro-Rata Settlement unfold live!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ Guided launch failed');
    showBanner(`🚫 Guided transfer error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnPlaceWin1Bid?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.shareCapital) return;
  state.busy = true;
  try {
    if (!state.activeAuctionAddr || state.auctionStatus !== 1 || state.auctionFailedBids) {
      await spawnFreshAuctionAuth();
    }
    const qty = Math.max(1, Math.floor(Number(el.inpWin1Qty.value) || 4000));
    const px = Math.max(1, Math.floor(Number(el.inpWin1Price.value) || 105));
    startInflightAnim(`Placing Window 1 Buyer Bid (${fmtNum(qty)} @ ${px} SGD) & escrowing cash…`);
    await session.sendAsMyIdentity(
      encodeAbi('placeBuyOrderViaShareCapital(address,address,uint64,uint64)', [
        ['address', session.inst.shareCapital],
        ['address', state.activeAuctionAddr],
        ['uint64', px],
        ['uint64', qty],
      ]),
      'Window1.placeBuyOrder',
      'ShareCapital',
      [session.inst.shareCapital, state.activeAuctionAddr]
    );
    finishInflightAnim('💵 Window 1 Bid Escrowed!');
    await refreshCharterWorld();
  } catch (err) {
    finishInflightAnim('⚠ Bid reverted');
    showBanner(`🚫 Window 1 Bid error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnPlaceWin2Sell?.addEventListener('click', async () => {
  if (state.busy || !state.activeAuctionAddr || !session.inst?.shareCapital) return;
  if (!state.myIsShareholder || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only existing Shareholders can submit Window 2 Sell Offers.', 'err');
    return;
  }
  state.busy = true;
  try {
    const qty = Math.max(1, Math.floor(Number(el.inpWin2Qty.value) || 5000));
    const px = Math.max(1, Math.floor(Number(el.inpWin2Price.value) || 100));
    startInflightAnim(`Placing Window 2 Shareholder Sell Offer (${fmtNum(qty)} @ ${px} SGD)…`);
    await session.sendAsMyIdentity(
      encodeAbi('placeSellOrderViaShareCapital(address,address,uint64,uint64)', [
        ['address', session.inst.shareCapital],
        ['address', state.activeAuctionAddr],
        ['uint64', px],
        ['uint64', qty],
      ]),
      'Window2.placeSellOrder',
      'ShareCapital',
      [session.inst.shareCapital, state.activeAuctionAddr]
    );
    finishInflightAnim('🏷️ Window 2 Sell Offer Placed!');
    await refreshCharterWorld();
  } catch (err) {
    finishInflightAnim('⚠ Sell offer reverted');
    showBanner(`🚫 Window 2 Sell error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnPlaceWin3Rofr?.addEventListener('click', async () => {
  if (state.busy || !state.activeAuctionAddr || !session.inst?.shareCapital) return;
  if (!state.myIsShareholder || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only existing Shareholders can exercise Window 3 ROFR.', 'err');
    return;
  }
  state.busy = true;
  try {
    const qty = Math.max(1, Math.floor(Number(el.inpWin3Qty.value) || 3000));
    const px = Math.max(1, Math.floor(Number(el.inpWin3Price.value) || 110));
    startInflightAnim(`Exercising Window 3 ROFR Pre-Emptive Bid (${fmtNum(qty)} @ ${px} SGD)…`);
    await session.sendAsMyIdentity(
      encodeAbi('placeBuyOrderViaShareCapital(address,address,uint64,uint64)', [
        ['address', session.inst.shareCapital],
        ['address', state.activeAuctionAddr],
        ['uint64', px],
        ['uint64', qty],
      ]),
      'Window3.ROFRBuyOrder',
      'ShareCapital',
      [session.inst.shareCapital, state.activeAuctionAddr]
    );
    finishInflightAnim('🛡️ Window 3 ROFR Bid Escrowed!');
    await refreshCharterWorld();
  } catch (err) {
    finishInflightAnim('⚠ ROFR bid reverted');
    showBanner(`🚫 Window 3 ROFR error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnSettleAuction?.addEventListener('click', async () => {
  if (state.busy || !state.activeAuctionAddr || !session.inst?.shareCapital) return;
  state.busy = true;
  try {
    startInflightAnim('Settling 3-Step Call Auction & disbursing ShareEscrow…');
    await session.sendAsMyIdentity(
      encodeAbi('settleAuctionViaShareCapital(address,address,address)', [
        ['address', session.inst.shareCapital],
        ['address', session.inst.shareLedger],
        ['address', state.activeAuctionAddr],
      ]),
      'settleShareTransferAuction',
      'ShareCapital',
      [session.inst.shareCapital, session.inst.shareLedger, state.activeAuctionAddr]
    );
    finishInflightAnim('🏆 Auction Settled & Cap Table Updated!');
    await refreshCharterWorld();
  } catch (err) {
    finishInflightAnim('⚠ Settlement reverted');
    showBanner(`🚫 Settlement error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnRefundFailedAuction?.addEventListener('click', async () => {
  if (state.busy || !state.activeAuctionAddr || !session.inst?.shareCapital) return;
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    startInflightAnim('Refunding escrowed buyer cash from expired/failed auction…');
    const inner = encodeAbi('refundFailedAuction(address)', [['address', state.activeAuctionAddr]]);
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', session.inst.shareCapital],
        ['bytes', hexToBytes(inner)],
      ]),
      'refundFailedAuction',
      'ShareCapital',
      [session.inst.shareCapital, state.activeAuctionAddr, session.inst.fiatLedger]
    );
    finishInflightAnim('↩️ Escrowed Cash Refunded to Bidders!');
    await refreshCharterWorld();
    showBanner('✅ Refunded all escrowed buyer cash from the expired auction back to bidders!', 'ok');
  } catch (err) {
    finishInflightAnim('⚠ Refund reverted');
    showBanner(`🚫 Refund error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnTestAuctionGuard?.addEventListener('click', async () => {
  if (state.busy || !state.activeAuctionAddr || !session.inst?.shareCapital) return;
  state.busy = true;
  const stg = currentAuctionWindowStage();
  try {
    startInflightAnim(
      stg === -1
        ? 'Testing CorporateCharter ERR_NO_BIDS_IN_STAGE (-97) rejection…'
        : 'Testing HFS Call-Auction Step/ROFR Guard…'
    );
    if (stg === 1) {
      await session.sendAsMyIdentity(
        encodeAbi('placeSellOrderViaShareCapital(address,address,uint64,uint64)', [
          ['address', session.inst.shareCapital],
          ['address', state.activeAuctionAddr],
          ['uint64', 100],
          ['uint64', 100],
        ]),
        'guardCheck:sellInWindow1',
        'ShareCapital'
      );
    } else {
      await session.sendAsMyIdentity(
        encodeAbi('settleAuctionViaShareCapital(address,address,address)', [
          ['address', session.inst.shareCapital],
          ['address', session.inst.shareLedger],
          ['address', state.activeAuctionAddr],
        ]),
        'guardCheck:prematureOrZeroBidSettle',
        'ShareCapital',
        [session.inst.corporateCharter, session.inst.shareCapital, session.inst.shareLedger, state.activeAuctionAddr]
      );
    }
  } catch (err) {
    finishInflightAnim('🛡️ Call-Auction Guard Verified!');
    showBanner(
      stg === -1
        ? `🛡️ <strong>Verified CorporateCharter 0-Bid Rejection (-97)!</strong> Because 0 bids arrived in Window 1 before expiry, <code>CorporateCharter.validateCapitalProcessAuth</code> &amp; <code>ShareCapital</code> rejected enactment (${escapeHtml(err.message)}).`
        : `🛡️ <strong>Verified Call-Auction Window Guard!</strong> Wasmtime rejected out-of-window / replay auction execution (${escapeHtml(err.message)}).`,
      'ok'
    );
  } finally {
    state.busy = false;
  }
});

// ---------------------------------------------------------------------------
// Futures Underwriting & DEX CLOB Attachment Handlers (Tab 4)
// ---------------------------------------------------------------------------

el.selCapBuybackClass?.addEventListener('change', () => {
  populateCapSplitsAndBuybacks();
});

el.btnQuickProposeSplit?.addEventListener('click', async () => {
  const mode = el.selCapSplitMode?.value || 'shareSplit';
  const ratio = Math.max(2, Math.min(100, Math.floor(Number(el.inpCapSplitRatio?.value) || 2)));
  const clsLedger = el.selCapSplitClass?.value || session.inst?.shareLedger || '';
  await deployActionResolution({
    kind: mode,
    shareClassLedger: clsLedger,
    splitRatio: ratio,
  });
});

el.btnQuickProposeBuyback?.addEventListener('click', async () => {
  const clsLedger = el.selCapBuybackClass?.value || session.inst?.shareLedger || '';
  const seller = el.selCapBuybackSeller?.value || session.myIdentityAddr || '';
  const shares = Math.max(1, Math.floor(Number(el.inpCapBuybackQty?.value) || 5000));
  const price = Math.max(1, Math.floor(Number(el.inpCapBuybackPx?.value) || 110));
  if (!seller) {
    showBanner('⚠️ Select a shareholder with a positive balance in that share class.', 'err');
    return;
  }
  await deployActionResolution({
    kind: 'shareBuyback',
    shareClassLedger: clsLedger,
    targetAddr: seller,
    buybackShares: shares,
    buybackPrice: price,
  });
});

el.btnQuickAuthorizeFutures?.addEventListener('click', async () => {
  const pct = Math.max(1, Math.min(100, Math.floor(Number(el.inpFutAuthPct.value) || 20)));
  await deployActionResolution({ kind: 'authorizeFutures', futuresPct: pct });
});

el.btnUnderwriteFutures?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.shareCapital) return;
  if (!state.myIsShareholder || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only existing Shareholders can mint share-backed futures.', 'err');
    return;
  }
  const qty = Math.max(1, Math.floor(Number(el.inpUnderwriteQty.value) || 1000));
  state.busy = true;
  try {
    startInflightAnim(`Underwriting (minting) +${fmtNum(qty)} share-backed futures…`);
    await session.sendAsMyIdentity(
      encodeAbi('underwriteFutures(address,uint64)', [
        ['address', session.inst.shareCapital],
        ['uint64', qty],
      ]),
      `underwriteFutures(+${qty})`,
      'ShareCapital',
      [session.inst.shareCapital, state.futuresLedger]
    );
    finishInflightAnim(`⚡ Minted +${fmtNum(qty)} Futures!`);
    triggerSparkBurst(['#a78bfa', '#38bdf8', '#10b981']);
    await refreshCharterWorld();
    showBanner(`✅ Underwrote <strong>+${fmtNum(qty)} Futures</strong> against your Common Equity holding!`, 'ok');
  } catch (err) {
    finishInflightAnim('⚠ Underwrite reverted');
    showBanner(`🚫 Futures underwriting error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

el.btnCloseFutures?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.shareCapital) return;
  const qty = Math.min(state.myFuturesBal, Math.max(1, Math.floor(Number(el.inpUnderwriteQty.value) || 500)));
  if (qty <= 0) return;
  state.busy = true;
  try {
    startInflightAnim(`Closing (burning) -${fmtNum(qty)} futures & restoring allowance…`);
    await session.sendAsMyIdentity(
      encodeAbi('closeUnderwrittenFutures(address,uint64)', [
        ['address', session.inst.shareCapital],
        ['uint64', qty],
      ]),
      `closeUnderwrittenFutures(-${qty})`,
      'ShareCapital',
      [session.inst.shareCapital, state.futuresLedger]
    );
    finishInflightAnim(`🔥 Closed ${fmtNum(qty)} Futures!`);
    await refreshCharterWorld();
    showBanner(`✅ Closed <strong>${fmtNum(qty)} Futures</strong> and restored underwriting allowance!`, 'ok');
  } catch (err) {
    finishInflightAnim('⚠ Close reverted');
    showBanner(`🚫 Close futures error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

async function deployAndAttachFuturesDex() {
  if (state.busy || !state.futuresLedger || state.futuresLedger === ZERO_ADDR) return;
  if (!state.myCanGovern || !activeVerifiedIdentityLow()) {
    showBanner('🔒 Only verified Directors or Shareholders of this company can attach a Futures DEX.', 'err');
    return;
  }
  state.busy = true;
  try {
    const myId = await session.ensureMyIdentity((m) => startInflightAnim(m));
    const futSym = `${shareTickerStr().replace(/-EQ$/, '')}-FUT`.slice(0, 14);
    let quoteLedger = session.inst.fiatLedger;

    // Check if quoteLedger already has another DEX attached; if so, deploy dedicated quote ledger
    const existingQuoteDex = decodeAddrWord(
      await session.ethCall(quoteLedger, encodeAbi('attachedDex()')).catch(() => ZERO_ADDR)
    );
    if (existingQuoteDex !== ZERO_ADDR || (session.inst.shareCapital && session.inst.shareCapital !== ZERO_ADDR)) {
      startInflightAnim('Deploying dedicated SGD-FIAT Settlement Ledger for Futures DEX…');
      const qRcpt = await session.sendRawSigned({
        privateKey: session.wallet.keypair.privateKey,
        to: null,
        dataHex: session.codeHashes.asset_ledger,
        label: 'instantiate(FuturesQuoteCash)',
        gasLimit: 4_800_000n,
      });
      quoteLedger = qRcpt.contractAddress.toLowerCase();
      const u64BE = (v) => {
        const b = new Uint8Array(8);
        let x = BigInt(v);
        for (let i = 7; i >= 0; i--) {
          b[i] = Number(x & 0xffn);
          x >>= 8n;
        }
        return b;
      };
      const packAlloc = (a, amt) => concatBytes(hexToBytes(a).slice(-20), u64BE(amt));
      const packPerm = (act, con, pol) =>
        concatBytes(hexToBytes(act).slice(0, 32), hexToBytes(con).slice(-20), hexToBytes(pol).slice(0, 32));
      const oraclePol = bytesToHex(concatBytes(utf8ToBytes('HPS_ORACLE_V'), hexToBytes(myId).slice(-20)));
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', quoteLedger],
          [
            'bytes',
            hexToBytes(
              encodeAbi('initialize(address,string,uint64,bytes,bytes)', [
                ['address', session.inst.registry],
                ['string', 'SGD-FIAT'],
                ['uint64', 0],
                ['bytes', concatBytes(packAlloc(session.inst.faucetIdentity, 50_000_000n), packAlloc(myId, 500_000n))],
                [
                  'bytes',
                  concatBytes(
                    packPerm(GOV_CONSTANTS.ACTION_SUPER, ZERO_ADDR, oraclePol),
                    packPerm(GOV_CONSTANTS.ACTION_ISSUE, ZERO_ADDR, oraclePol),
                    packPerm(GOV_CONSTANTS.ACTION_CANCEL, ZERO_ADDR, oraclePol),
                    packPerm(GOV_CONSTANTS.ACTION_TRANSFER, ZERO_ADDR, GOV_CONSTANTS.POLICY_HOLDER_SELF),
                    packPerm(GOV_CONSTANTS.ACTION_APPROVE, ZERO_ADDR, GOV_CONSTANTS.POLICY_HOLDER_SELF)
                  ),
                ],
              ])
            ),
          ],
        ]),
        'initFuturesQuoteLedger',
        'AssetLedger',
        [quoteLedger]
      );
    }

    startInflightAnim(`Step 1/3: Instantiating MEV-Proof dex_clob.wasm for ${futSym}…`);
    const dexRcpt = await session.sendRawSigned({
      privateKey: session.wallet.keypair.privateKey,
      to: null,
      dataHex: session.codeHashes.dex_clob,
      label: `instantiate(DexClob:${futSym})`,
      contractLabel: 'DexClob',
      gasLimit: 4_800_000n,
    });
    const newDex = dexRcpt.contractAddress.toLowerCase();

    startInflightAnim(`Step 2/3: Initializing DexClob & attaching to ${futSym} + Cash Ledgers…`);
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', newDex],
        [
          'bytes',
          hexToBytes(
            encodeAbi('initialize(address,address,address,address)', [
              ['address', session.inst.registry],
              ['address', state.futuresLedger],
              ['address', quoteLedger],
              ['address', session.inst.dexEscrowIdentity],
            ])
          ),
        ],
      ]),
      'DexClob.initialize',
      'DexClob',
      [newDex, state.futuresLedger, quoteLedger, session.inst.dexEscrowIdentity]
    );

    await session.sendAsMyIdentity(
      encodeAbi('setAttachedDex(address,address,address)', [
        ['address', state.futuresLedger],
        ['address', newDex],
        ['address', ZERO_ADDR],
      ]),
      'setAttachedDex(Futures)',
      'AssetLedger(Futures)',
      [state.futuresLedger, newDex]
    );

    await session.sendAsMyIdentity(
      encodeAbi('setAttachedDex(address,address,address)', [
        ['address', quoteLedger],
        ['address', newDex],
        ['address', ZERO_ADDR],
      ]),
      'setAttachedDex(Cash)',
      'AssetLedger(Cash)',
      [quoteLedger, newDex]
    );

    // Register in HfsRegistry so `/dex.html?hfs=<newDex>` loads it seamlessly!
    if (session.manifest?.hfsRegistry) {
      startInflightAnim(`Step 3/3: Registering ${futSym} / SGD-CASH market in Global HfsRegistry…`);
      const label = `${futSym} / SGD-CASH Futures CLOB`;
      const meta = {
        pair: `${futSym} / SGD-CASH`,
        baseSymbol: futSym,
        quoteSymbol: 'SGD-CASH',
        shareLedger: state.futuresLedger,
        fiatLedger: quoteLedger,
        dexEscrowIdentity: session.inst.dexEscrowIdentity,
      };
      await session.sendRawSigned({
        privateKey: session.wallet.keypair.privateKey,
        to: session.manifest.hfsRegistry,
        dataHex: HfsRegistryAbi.registerInstance('DEX_CLOB', newDex, myId, label, meta),
        label: `registerInstance(DEX_CLOB, ${futSym})`,
        contractLabel: 'HfsRegistry',
        extraTargets: [session.manifest.hfsRegistry, newDex, myId],
      });
    }

    // Backend Rust `tx-load-sim` DEX Market-Maker Engine automatically discovers registered `DEX_CLOB`
    // instances in `HfsRegistry` and maintains multi-level Bid & Ask ladders + `dexMatchBlock`!
    finishInflightAnim(`📈 ${futSym} DEX CLOB Attached & Live!`);
    triggerSparkBurst(['#10b981', '#38bdf8', '#fbbf24']);
    await refreshCharterWorld();
    showBanner(
      `📈 <strong>MEV-Proof DEX CLOB (${shortAddr(newDex)}) Attached to ${escapeHtml(futSym)}!</strong> Underwrite futures on the left, list them right here, or click <strong>Open Full Futures Orderbook in DEX App</strong>!`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ DEX attachment failed');
    showBanner(`🚫 Attach DEX error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
}

async function quickListFuturesOnDex() {
  if (state.busy || !state.attachedDex || state.attachedDex === ZERO_ADDR) return;
  const qty = Math.max(1, Math.floor(Number($('inpFutAskQty')?.value || 250)));
  const px = Math.max(1, Math.floor(Number($('inpFutAskPrice')?.value || 45)));
  state.busy = true;
  try {
    if (state.myFuturesBal < qty) {
      startInflightAnim(`Auto-underwriting +${fmtNum(qty)} futures first…`);
      await session.sendAsMyIdentity(
        encodeAbi('underwriteFutures(address,uint64)', [
          ['address', session.inst.shareCapital],
          ['uint64', qty],
        ]),
        `underwriteFutures(+${qty})`,
        'ShareCapital',
        [session.inst.shareCapital, state.futuresLedger]
      );
    }
    startInflightAnim(`Placing SELL Ask (${fmtNum(qty)} FUT @ ${px} SGD) on attached DEX CLOB…`);
    await session.sendAsMyIdentity(
      encodeAbi('dexPlaceAsk(address,uint64,uint64)', [
        ['address', state.attachedDex],
        ['uint64', px],
        ['uint64', qty],
      ]),
      `dexPlaceAsk(${qty}@${px})`,
      'DexClob',
      [state.attachedDex, state.futuresLedger, session.inst.dexEscrowIdentity]
    );
    finishInflightAnim('✓ Futures Listed on Attached DEX!');
    await refreshCharterWorld();
    showBanner(
      `✅ Listed <strong>${fmtNum(qty)} Futures @ ${px} SGD</strong> on attached DEX CLOB! <a href="/dex.html?hfs=${state.attachedDex}" style="text-decoration:underline;font-weight:800;">Open DEX Market ↗</a>`,
      'ok'
    );
  } catch (err) {
    finishInflightAnim('⚠ DEX Ask failed');
    showBanner(`🚫 DEX Ask error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
}

// ---------------------------------------------------------------------------
// Confidential Accounting Audit Key Epoch & Scoped Auditor Viewing Keys
// ---------------------------------------------------------------------------

const STORAGE_AUDIT_PENDING_KEY = 'slx_charter_pending_audit_payloads_v1';

function loadPendingAuditPayloads(chrAddr) {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIT_PENDING_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[(chrAddr || '').toLowerCase()] || [];
  } catch (_) {
    return [];
  }
}

function savePendingAuditPayloads(chrAddr, list) {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIT_PENDING_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[(chrAddr || '').toLowerCase()] = list;
    localStorage.setItem(STORAGE_AUDIT_PENDING_KEY, JSON.stringify(map));
  } catch (_) {}
}

function auditCatLabel(catIdHex) {
  const low = (catIdHex || '').toLowerCase();
  if (low === CONF_CAT_IDS.PAYROLL.toLowerCase()) return 'Monthly Salaries & Payroll';
  if (low === CONF_CAT_IDS.DEFENSE_B2B.toLowerCase()) return 'B2B Defense Contracts (Epoch)';
  if (low === CONF_CAT_IDS.DEFENSE_LIVE.toLowerCase()) return 'B2B Defense (Counterparty-Shielded)';
  if (low === CONF_CAT_IDS.TRADE_AR.toLowerCase()) return 'Confidential Enterprise AR';
  if (low === CONF_CAT_IDS.VENDOR_OPEX.toLowerCase()) return 'Confidential Vendor & R&D OpEx';
  return `${catIdHex.slice(0, 10)}…`;
}

async function refreshAuditGovState() {
  const chr = session.inst?.corporateCharter;
  if (!chr || !session.online) return;
  try {
    const [stHex, grantsHex] = await Promise.all([
      session.ethCall(chr, encodeAbi('getAuditEpochState()')).catch(() => '0x'),
      session
        .ethCall(chr, encodeAbi('getAuditorGrantsSlice(uint64,uint64)', [['uint64', 0], ['uint64', 20]]))
        .catch(() => '0x'),
    ]);
    const b = hexToBytes(stHex);
    if (b.length >= 48) {
      state.auditGov.epoch = Number(readU64BE(b, 0));
      state.auditGov.auditPkHex = state.auditGov.epoch > 0 ? bytesToHex(b.slice(8, 40), true) : '';
    } else {
      state.auditGov.epoch = 0;
      state.auditGov.auditPkHex = '';
    }
    state.auditGov.grants = decodeAuditorGrantsSliceHex(grantsHex).items;

    state.auditGov.unwrappedAuditSk = null;
    const myLow = activeVerifiedIdentityLow();
    const myPriv = session.wallet?.keypair?.privateKey || '';
    if (myLow && myPriv && state.auditGov.epoch > 0 && (state.myIsDirector || state.myIsOfficer)) {
      const envHex = await session
        .ethCall(
          chr,
          encodeAbi('getOfficerAuditEnvelope(uint64,address)', [
            ['uint64', state.auditGov.epoch],
            ['address', myLow],
          ])
        )
        .catch(() => '0x');
      const envBytes = hexToBytes(envHex);
      if (envBytes.length > 80) {
        const sk = unwrapSecretWithPrivKey(envBytes, myPriv, 'SLX_AUDIT_WRAP');
        if (sk && sk.length === 32) {
          state.auditGov.unwrappedAuditSk = sk;
        }
      }
    }
  } catch (_) {}
}

function renderCharterAuditGovernance(force = false) {
  const mount = document.getElementById('chrAuditMount');
  const linkBtn = document.getElementById('chrLinkConfRollups');
  if (!mount) return;
  if (linkBtn) {
    const acc = state.accountingLedger && state.accountingLedger !== ZERO_ADDR
      ? state.accountingLedger
      : session.inst?.accountingLedger || '';
    linkBtn.href = acc ? `/accounting.html?hfs=${acc}#confidential` : '/accounting.html#confidential';
  }

  const ag = state.auditGov;
  const chr = session.inst?.corporateCharter || '';
  const pendingList = loadPendingAuditPayloads(chr);
  const canManage = Boolean(state.myIsDirector || state.myIsOfficer);
  const keyStr = `${chr}:${ag.epoch}:${Boolean(ag.unwrappedAuditSk)}:${ag.grants.length}:${ag.grants.filter((g) => g.revoked).length}:${canManage}:${state.directors.length}:${pendingList.length}`;
  if (!force && ag.renderedKey === keyStr) return;
  ag.renderedKey = keyStr;

  const statusChip =
    ag.epoch > 0
      ? `<span class="inst-badge green">ACTIVE • EPOCH #${ag.epoch}</span>`
      : '<span class="inst-badge amber">UNINITIALIZED (EPOCH #0)</span>';
  const unwrapChip = ag.unwrappedAuditSk
    ? '<span class="inst-badge cyan">🔓 Your Officer Audit Key Unwrapped</span>'
    : canManage && ag.epoch > 0
      ? '<span class="inst-badge amber">🔒 Request Officer Key-Wrap from Co-Director</span>'
      : '';

  const candidateMap = new Map();
  for (const p of session.aiPersonas || []) {
    if (p.identityAddr) candidateMap.set(p.identityAddr.toLowerCase(), p.displayLabel || p.nickname);
  }
  for (const d of session.dexDesks || []) {
    if (d.identityAddr) candidateMap.set(d.identityAddr.toLowerCase(), d.displayLabel || d.nickname);
  }
  for (const a of session.inst?.actors || []) {
    if (a.identityAddr) candidateMap.set(a.identityAddr.toLowerCase(), a.name || a.handle);
  }
  if (session.myIdentityAddr) {
    candidateMap.set(
      session.myIdentityAddr.toLowerCase(),
      `Me (${session.myIdentityHandle || shortAddr(session.myIdentityAddr)})`
    );
  }
  const auditorOpts = Array.from(candidateMap.entries())
    .map(([addr, lbl]) => `<option value="${addr}">${escapeHtml(lbl)}</option>`)
    .join('');

  const officerPool = Array.from(
    new Set([
      ...state.directors.map((d) => d.addr),
      ...state.execSeats
        .filter((s) => s.key === 'ROLE_TREASURY_MANAGER' || s.key === 'ROLE_CHIEF_ACCOUNTANT')
        .flatMap((s) => s.holders.map((h) => h.addr)),
    ])
  );
  const officerOpts = officerPool
    .map((addr) => `<option value="${addr}">${escapeHtml(session.labelForIdentity(addr))}</option>`)
    .join('');

  const pendingHtml = pendingList.length
    ? pendingList
        .map(
          (p, idx) => `
          <div style="padding:8px 11px;border-radius:9px;background:rgba(14,165,233,0.12);border:1px solid rgba(56,189,248,0.38);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;">
            <span>⏳ <strong>${escapeHtml(p.title)}</strong> (Board Auth <code>${shortAddr(p.authAddr)}</code>)</span>
            <button type="button" class="inst-btn sm emerald" data-enact-pending-audit="${idx}">⚡ Co-Sign &amp; Enact</button>
          </div>`
        )
        .join('')
    : '';

  const grantsHtml = ag.grants.length
    ? `
      <div style="overflow-x:auto;">
        <table class="inst-table">
          <thead>
            <tr>
              <th>Grant</th>
              <th>External Auditor</th>
              <th>Scoped Category &amp; Period</th>
              <th>Epoch</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${ag.grants
              .map(
                (g) => `
              <tr>
                <td style="font-family:var(--mono);">#${g.grantId}</td>
                <td>${escapeHtml(session.labelForIdentity(g.auditorIdentity))}</td>
                <td><strong>${escapeHtml(auditCatLabel(g.categoryId))}</strong> • <code>${escapeHtml(g.periodLabel)}</code></td>
                <td style="font-family:var(--mono);">Ep #${g.epoch}</td>
                <td>${g.revoked ? '<span class="inst-badge red">REVOKED</span>' : '<span class="inst-badge green">ACTIVE SUBKEY</span>'}</td>
                <td>
                  ${
                    !g.revoked && state.myIsDirector
                      ? `<button type="button" class="inst-btn sm" data-revoke-aud-grant="${g.grantId}">🚫 Revoke</button>`
                      : '—'
                  }
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`
    : `<div style="font-size:12px;color:var(--txt-2);">No External Auditor viewing subkeys granted yet.</div>`;

  mount.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.72);border:1px solid var(--line);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${statusChip}
        ${unwrapChip}
        ${ag.auditPkHex ? `<span style="font-family:var(--mono);font-size:11.5px;color:#94a3b8;">Y_audit: ${ag.auditPkHex.slice(0, 18)}…</span>` : ''}
      </div>
      ${
        canManage
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="inst-btn sm primary" id="btnInitOrRotateAuditKey">
                ${ag.epoch === 0 ? '🔐 Initialize Epoch #1 CompanyAuditKey' : `🔄 Rotate Audit Key → Epoch #${ag.epoch + 1} (Forward Secrecy)`}
              </button>
            </div>`
          : ''
      }
    </div>
    ${pendingHtml}
    ${
      canManage && ag.unwrappedAuditSk
        ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;">
          <div style="padding:11px 13px;border-radius:10px;background:rgba(7,13,26,0.62);border:1px solid var(--line);display:flex;flex-direction:column;gap:8px;">
            <strong style="font-size:12.5px;color:#6ee7b7;">🔍 Grant Scoped External Auditor Viewing Subkey</strong>
            <div style="font-size:11.5px;color:var(--txt-2);">Wraps ONLY the deterministic <code>KDF(sk_audit, Category, Period)</code> subkey — zero access to other categories or periods.</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <select class="inst-input" id="selChrAudRecipient">${auditorOpts}</select>
              <input class="inst-input" type="text" id="inpChrAudPeriod" value="FY2026-M11" placeholder="Period Tag (e.g. FY2026-M11)" />
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <select class="inst-input" id="selChrAudCategory" style="flex:1;">
                <option value="${CONF_CAT_IDS.PAYROLL}">Monthly Salaries &amp; Payroll</option>
                <option value="${CONF_CAT_IDS.DEFENSE_B2B}">B2B Defense Contracts (Epoch)</option>
                <option value="${CONF_CAT_IDS.DEFENSE_LIVE}">B2B Defense (Counterparty-Shielded)</option>
                <option value="${CONF_CAT_IDS.TRADE_AR}">Confidential Enterprise AR</option>
                <option value="${CONF_CAT_IDS.VENDOR_OPEX}">Confidential Vendor &amp; R&amp;D OpEx</option>
              </select>
              <button type="button" class="inst-btn sm emerald" id="btnGrantAuditorKey">Grant Subkey</button>
            </div>
          </div>

          <div style="padding:11px 13px;border-radius:10px;background:rgba(7,13,26,0.62);border:1px solid var(--line);display:flex;flex-direction:column;gap:8px;">
            <strong style="font-size:12.5px;color:#7dd3fc;">🔑 Seal Audit Key Envelope for Appointed Officer</strong>
            <div style="font-size:11.5px;color:var(--txt-2);">Provisions Epoch #${ag.epoch} ECDH envelope for a newly elected Director or CFO without rotating the epoch.</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:auto;">
              <select class="inst-input" id="selChrWrapOfficer" style="flex:1;">${officerOpts}</select>
              <button type="button" class="inst-btn sm primary" id="btnSealOfficerAuditWrap">Seal Officer Envelope</button>
            </div>
          </div>
        </div>`
        : ''
    }
    ${grantsHtml}
  `;
}

async function createAndMaybeFinalizeBoardAuth(chrAddr, actionHashHex, label) {
  const chAuth = session.codeHashes?.authorization;
  if (!chAuth) throw new Error('Missing authorization.wasm codeHash');
  const rDep = await session.sendRawSigned({
    privateKey: session.wallet.keypair.privateKey,
    to: null,
    dataHex: chAuth,
    label: `deploy(Auth:${label})`,
    contractLabel: 'Authorization',
    gasLimit: 4_800_000n,
  });
  const authAddr = rDep.contractAddress.toLowerCase();
  await session.sendAsMyIdentity(
    encodeAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
      ['address', authAddr],
      ['address', session.inst.registry],
      ['address', chrAddr],
      ['address', chrAddr],
      ['bytes32', GOV_CONSTANTS.POLICY_BOARD_RESOLUTION],
      ['bytes32', actionHashHex],
    ]),
    `initCharterAuth(${label})`,
    'Authorization',
    [chrAddr, authAddr],
    7_500_000n
  );
  if (state.myIsDirector) {
    await session.sendAsMyIdentity(
      encodeAbi('approveAndFinalizeAuth(address)', [['address', authAddr]]),
      `approveStage(${label})`,
      'Authorization',
      [chrAddr, authAddr],
      6_500_000n
    );
  }
  const stHex = await session.ethCall(authAddr, encodeAbi('status()')).catch(() => '0x0');
  return { authAddr, finalized: decodeUintWord(stHex) === 2 };
}

document.getElementById('chrAuditMount')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || state.busy || !session.inst?.corporateCharter) return;
  const chr = session.inst.corporateCharter.toLowerCase();

  state.busy = true;
  try {
    const myId = await session.ensureMyIdentity((m) => startInflightAnim(m));
    await session.ensureMyIdentityEncryptionKeys();

    if (btn.id === 'btnInitOrRotateAuditKey') {
      const nextEpoch = state.auditGov.epoch + 1;
      startInflightAnim(`Generating Epoch #${nextEpoch} Ed25519 CompanyAuditKey & wrapping to active Officers…`);
      const officerAddrs = Array.from(
        new Set([
          myId,
          ...state.directors.map((d) => d.addr),
          ...state.execSeats
            .filter((s) => s.key === 'ROLE_TREASURY_MANAGER' || s.key === 'ROLE_CHIEF_ACCOUNTANT')
            .flatMap((s) => s.holders.map((h) => h.addr)),
        ])
      );
      const auditKp = deriveCompanyAuditKeypair(randomBytes(32), chr, nextEpoch);
      const wrapEntries = [];
      for (const offAddr of officerAddrs) {
        const keys = await readOnChainIdentityEncryptionKeys(session.rpcUrl, offAddr);
        if (!keys) continue;
        const env = wrapSecretForRecipientSecp(
          auditKp.secretLeBytes32,
          keys.secpPub64Bytes,
          'SLX_AUDIT_WRAP'
        );
        wrapEntries.push(concatBytes(hexToBytes(offAddr).slice(-20), u16BEBytes(env.length), env));
      }
      if (!wrapEntries.length) {
        throw new Error('No active officers have registered Identity v3 encryptionKeys() yet.');
      }
      const wrapsBlob = concatBytes(u16BEBytes(wrapEntries.length), ...wrapEntries);

      if (state.auditGov.epoch === 0) {
        const inner = encodeAbi('initOrRotateAuditEpoch(bytes32,bytes,address)', [
          ['bytes32', auditKp.pub32Hex],
          ['bytes', wrapsBlob],
          ['address', ZERO_ADDR],
        ]);
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [['address', chr], ['bytes', hexToBytes(inner)]]),
          `initOrRotateAuditEpoch(#1)`,
          'CorporateCharter',
          [chr, ...officerAddrs],
          7_500_000n
        );
        finishInflightAnim('🔐 Epoch #1 CompanyAuditKey Initialized!');
        await refreshCharterWorld();
        showBanner(`✅ Initialized <strong>Epoch #1 CompanyAuditKey</strong> wrapped to ${wrapEntries.length} active officer(s)!`, 'ok');
      } else {
        const ahHex = await session.ethCall(
          chr,
          encodeAbi('hashRotateAuditEpoch(bytes32,bytes)', [
            ['bytes32', auditKp.pub32Hex],
            ['bytes', wrapsBlob],
          ])
        );
        const { authAddr, finalized } = await createAndMaybeFinalizeBoardAuth(
          chr,
          ahHex,
          `RotateAuditEpoch#${nextEpoch}`
        );
        const inner = encodeAbi('initOrRotateAuditEpoch(bytes32,bytes,address)', [
          ['bytes32', auditKp.pub32Hex],
          ['bytes', wrapsBlob],
          ['address', authAddr],
        ]);
        if (finalized) {
          await session.sendAsMyIdentity(
            encodeAbi('execute(address,bytes)', [['address', chr], ['bytes', hexToBytes(inner)]]),
            `initOrRotateAuditEpoch(#${nextEpoch})`,
            'CorporateCharter',
            [chr, authAddr, ...officerAddrs],
            8_000_000n
          );
          finishInflightAnim(`🔄 Rotated to Epoch #${nextEpoch}!`);
          await refreshCharterWorld();
          showBanner(
            `✅ Rotated <strong>CompanyAuditKey → Epoch #${nextEpoch}</strong>! Dismissed officers have zero access to new confidential batches (forward secrecy enforced).`,
            'ok'
          );
        } else {
          const list = loadPendingAuditPayloads(chr);
          list.push({
            title: `Rotate CompanyAuditKey → Epoch #${nextEpoch}`,
            authAddr,
            innerHex: inner,
            extraTargets: [chr, authAddr, ...officerAddrs],
          });
          savePendingAuditPayloads(chr, list);
          finishInflightAnim('⏳ Board Resolution Created!');
          renderCharterAuditGovernance(true);
          showBanner(
            `⏳ Board Resolution <code>${shortAddr(authAddr)}</code> created & signed by you. Once remaining Director(s) sign, click <strong>⚡ Co-Sign &amp; Enact</strong>!`,
            'info'
          );
        }
      }
    } else if (btn.id === 'btnSealOfficerAuditWrap') {
      if (!state.auditGov.unwrappedAuditSk) throw new Error('Unwrapped Officer Audit Key required');
      const targetOfficer = (document.getElementById('selChrWrapOfficer')?.value || '').toLowerCase();
      const keys = await readOnChainIdentityEncryptionKeys(session.rpcUrl, targetOfficer);
      if (!keys) throw new Error('Selected officer has not set Identity v3 encryptionKeys() yet.');
      startInflightAnim(`Sealing Epoch #${state.auditGov.epoch} Audit Key envelope for ${session.labelForIdentity(targetOfficer)}…`);
      const env = wrapSecretForRecipientSecp(
        state.auditGov.unwrappedAuditSk,
        keys.secpPub64Bytes,
        'SLX_AUDIT_WRAP'
      );
      const inner = encodeAbi('wrapAuditKeyForOfficer(uint64,address,bytes)', [
        ['uint64', state.auditGov.epoch],
        ['address', targetOfficer],
        ['bytes', env],
      ]);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [['address', chr], ['bytes', hexToBytes(inner)]]),
        'wrapAuditKeyForOfficer()',
        'CorporateCharter',
        [chr, targetOfficer],
        6_000_000n
      );
      finishInflightAnim('🔑 Officer Envelope Sealed!');
      await refreshCharterWorld();
      showBanner(`✅ Sealed Epoch #${state.auditGov.epoch} Audit Key envelope for <strong>${escapeHtml(session.labelForIdentity(targetOfficer))}</strong>!`, 'ok');
    } else if (btn.id === 'btnGrantAuditorKey') {
      if (!state.auditGov.unwrappedAuditSk) throw new Error('Unwrapped Officer Audit Key required');
      const auditorAddr = (document.getElementById('selChrAudRecipient')?.value || '').toLowerCase();
      const catHex = document.getElementById('selChrAudCategory')?.value || CONF_CAT_IDS.PAYROLL;
      const periodStr = (document.getElementById('inpChrAudPeriod')?.value || 'FY2026-M11').trim();
      const periodHex = bytesToHex(encodePeriodTagBytes32(periodStr), true);

      if (auditorAddr === myId) await session.ensureMyIdentityEncryptionKeys();
      const audKeys = await readOnChainIdentityEncryptionKeys(session.rpcUrl, auditorAddr);
      if (!audKeys) {
        throw new Error('Selected External Auditor Identity has not registered v3 encryptionKeys() yet.');
      }

      startInflightAnim(`Deriving scoped KDF subkey (${auditCatLabel(catHex)} • ${periodStr}) & wrapping for Auditor…`);
      const subkey32 = deriveCategoryPeriodSubkey(state.auditGov.unwrappedAuditSk, catHex, periodHex);
      const env = wrapSecretForRecipientSecp(subkey32, audKeys.secpPub64Bytes, 'SLX_AUDITOR_GRANT');

      const ahHex = await session.ethCall(
        chr,
        encodeAbi('hashGrantAuditorCategoryKey(uint64,bytes32,bytes32,address,bytes)', [
          ['uint64', state.auditGov.epoch],
          ['bytes32', catHex],
          ['bytes32', periodHex],
          ['address', auditorAddr],
          ['bytes', env],
        ])
      );
      const { authAddr, finalized } = await createAndMaybeFinalizeBoardAuth(
        chr,
        ahHex,
        'GrantAuditorSubkey'
      );
      const inner = encodeAbi(
        'grantAuditorCategoryKey(uint64,bytes32,bytes32,address,bytes,address)',
        [
          ['uint64', state.auditGov.epoch],
          ['bytes32', catHex],
          ['bytes32', periodHex],
          ['address', auditorAddr],
          ['bytes', env],
          ['address', authAddr],
        ]
      );
      if (finalized) {
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [['address', chr], ['bytes', hexToBytes(inner)]]),
          'grantAuditorCategoryKey()',
          'CorporateCharter',
          [chr, authAddr, auditorAddr],
          7_800_000n
        );
        finishInflightAnim('🔍 Scoped Auditor Subkey Granted!');
        await refreshCharterWorld();
        showBanner(
          `✅ Granted scoped viewing key for <strong>${escapeHtml(auditCatLabel(catHex))} (${escapeHtml(periodStr)})</strong> to ${escapeHtml(session.labelForIdentity(auditorAddr))}!`,
          'ok'
        );
      } else {
        const list = loadPendingAuditPayloads(chr);
        list.push({
          title: `Grant Scoped Subkey (${auditCatLabel(catHex)} • ${periodStr}) → ${session.labelForIdentity(auditorAddr)}`,
          authAddr,
          innerHex: inner,
          extraTargets: [chr, authAddr, auditorAddr],
        });
        savePendingAuditPayloads(chr, list);
        finishInflightAnim('⏳ Auditor Grant Resolution Created!');
        renderCharterAuditGovernance(true);
        showBanner(
          `⏳ Board Resolution <code>${shortAddr(authAddr)}</code> created. Once co-director(s) sign, click <strong>⚡ Co-Sign &amp; Enact</strong>!`,
          'info'
        );
      }
    } else if (btn.dataset.revokeAudGrant !== undefined) {
      const gid = Number(btn.dataset.revokeAudGrant);
      startInflightAnim(`Creating Board Resolution to revoke Auditor Viewing Key #${gid}…`);
      const ahBytes = concatBytes(
        utf8ToBytes('HPS_ACTION_V1'),
        hexToBytes(chr).slice(-20),
        hexToBytes(GOV_CONSTANTS.ACTION_GRANT_AUDITOR_KEY).slice(0, 32),
        u64BEBytes(gid),
        u64BEBytes(1)
      );
      const ahHex = keccak256Hex(ahBytes);
      const { authAddr, finalized } = await createAndMaybeFinalizeBoardAuth(
        chr,
        ahHex,
        `RevokeAuditorKey#${gid}`
      );
      const inner = encodeAbi('revokeAuditorCategoryKey(uint64,address)', [
        ['uint64', gid],
        ['address', authAddr],
      ]);
      if (finalized) {
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [['address', chr], ['bytes', hexToBytes(inner)]]),
          `revokeAuditorCategoryKey(#${gid})`,
          'CorporateCharter',
          [chr, authAddr],
          7_200_000n
        );
        finishInflightAnim('🚫 Auditor Grant Revoked!');
        await refreshCharterWorld();
        showBanner(`✅ Revoked External Auditor Viewing Key #${gid}!`, 'ok');
      } else {
        const list = loadPendingAuditPayloads(chr);
        list.push({
          title: `Revoke External Auditor Viewing Key #${gid}`,
          authAddr,
          innerHex: inner,
          extraTargets: [chr, authAddr],
        });
        savePendingAuditPayloads(chr, list);
        finishInflightAnim('⏳ Revocation Resolution Created!');
        renderCharterAuditGovernance(true);
      }
    } else if (btn.dataset.enactPendingAudit !== undefined) {
      const idx = Number(btn.dataset.enactPendingAudit);
      const list = loadPendingAuditPayloads(chr);
      const item = list[idx];
      if (!item) return;
      startInflightAnim(`Co-signing & enacting ${item.title}…`);
      const stBefore = decodeUintWord(
        await session.ethCall(item.authAddr, encodeAbi('status()')).catch(() => '0x0')
      );
      if (stBefore === 1 && state.myIsDirector) {
        await session.sendAsMyIdentity(
          encodeAbi('approveAndFinalizeAuth(address)', [['address', item.authAddr]]),
          'approveAndFinalizeAuth()',
          'Authorization',
          item.extraTargets,
          6_500_000n
        );
      }
      const stAfter = decodeUintWord(
        await session.ethCall(item.authAddr, encodeAbi('status()')).catch(() => '0x0')
      );
      if (stAfter !== 2) {
        finishInflightAnim('⏳ Still awaiting remaining Director(s)');
        showBanner('⏳ Signed! At least one additional Director signature is still required to reach Board quorum.', 'info');
        return;
      }
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [['address', chr], ['bytes', hexToBytes(item.innerHex)]]),
        item.title,
        'CorporateCharter',
        item.extraTargets,
        8_200_000n
      );
      list.splice(idx, 1);
      savePendingAuditPayloads(chr, list);
      finishInflightAnim('✓ Enacted!');
      await refreshCharterWorld();
      showBanner(`✅ Enacted <strong>${escapeHtml(item.title)}</strong> on CorporateCharter!`, 'ok');
    }
  } catch (err) {
    finishInflightAnim('⚠ Audit governance error');
    showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

// ---------------------------------------------------------------------------
// Cast-in-Stone `Superlexicon Pte. Ltd.` Banner + Automatic Company Social &
// Director-Managed Social Sub-Groups (`Superlexicon · Developers`)
// ---------------------------------------------------------------------------

state.corpSocial = {
  overview: null,
  activeSlug: SUBGROUP_ALL_MEMBERS_SLUG,
  messages: [],
};

function resolveCharterMessagingAddr() {
  const fromOv = state.corpSocial?.overview?.messagingHps;
  if (fromOv && fromOv !== ZERO_ADDR) return fromOv;
  return (
    session.manifest?.fleetSocial?.messaging ||
    session.manifest?.commonsRf?.messaging ||
    ''
  ).toLowerCase();
}

async function refreshCompanySocialState() {
  const chr = session.inst?.corporateCharter?.toLowerCase();
  if (!chr) return;
  const myId = activeVerifiedIdentityLow() || ZERO_ADDR;
  let overview = null;
  try {
    const rawHex = await session.ethCall(chr, CharterSocialAbi.getCompanySocialOverview(myId));
    overview = decodeCompanySocialOverviewHex(rawHex);
  } catch (_) {
    overview = null;
  }

  if (!overview) {
    const fallbackMembers = Array.from(
      new Set([
        ...(state.directors || []).map((d) => (typeof d === 'string' ? d : d.addr || '')).filter(Boolean),
        ...(state.capRows || []).map((r) => r.addr).filter(Boolean),
      ])
    ).map((a) => a.toLowerCase());
    overview = {
      isSovereign: false,
      viewerInAllMembers: Boolean(myId !== ZERO_ADDR && fallbackMembers.includes(myId)),
      viewerIsActiveDirector: Boolean(state.myIsDirector && !state.myNeedsDirectorConsent),
      charterState: state.charterState || 0,
      legalName: companyNameStr(),
      jurisdiction: 'Singapore',
      registrationId: '',
      messagingHps: resolveCharterMessagingAddr(),
      allMembersChannelHash: companyGroupChannelHash(chr, SUBGROUP_ALL_MEMBERS_SLUG),
      allMembers: fallbackMembers,
      subgroups: [],
    };
  }

  state.corpSocial.overview = overview;
  const validSlugs = new Set([
    SUBGROUP_ALL_MEMBERS_SLUG,
    ...(overview.subgroups || []).map((g) => g.slug),
  ]);
  if (!validSlugs.has(state.corpSocial.activeSlug)) {
    state.corpSocial.activeSlug = SUBGROUP_ALL_MEMBERS_SLUG;
  }

  const activeChan =
    state.corpSocial.activeSlug === SUBGROUP_ALL_MEMBERS_SLUG
      ? overview.allMembersChannelHash
      : overview.subgroups.find((g) => g.slug === state.corpSocial.activeSlug)?.channelHash ||
        companyGroupChannelHash(chr, state.corpSocial.activeSlug);

  const msgAddr =
    overview.messagingHps && overview.messagingHps !== ZERO_ADDR
      ? overview.messagingHps
      : resolveCharterMessagingAddr();

  if (msgAddr && activeChan) {
    try {
      const mHex = await session.ethCall(msgAddr, SlxSocialAbi.getRecentMessages(activeChan, 28));
      state.corpSocial.messages = decodeSocialMessagesHex(mHex);
    } catch (_) {
      state.corpSocial.messages = [];
    }
  } else {
    state.corpSocial.messages = [];
  }
}

function renderSovereignEntityBanner() {
  const box = $('sovereignEntityBanner');
  if (!box) return;
  const ov = state.corpSocial?.overview;
  const chr = session.inst?.corporateCharter || '';
  const spec = SOVEREIGN_SUPERLEXICON_CHARTER_SPEC;

  if (ov?.isSovereign) {
    box.style.borderColor = 'rgba(52,211,153,0.6)';
    box.style.background = 'linear-gradient(135deg,rgba(6,78,59,0.52),rgba(15,23,42,0.94))';
    box.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="inst-badge green">🏛️ CAST-IN-STONE PROTOCOL ROOT</span>
          <strong style="color:#ecfdf5;font-size:13px;">${escapeHtml(spec.legalName)} (${escapeHtml(ov.jurisdiction || 'Singapore')}${ov.registrationId ? ` • UEN ${escapeHtml(ov.registrationId)}` : ''})</strong>
        </div>
        <div style="color:#cbd5e1;font-size:11.5px;">
          Directors: <strong>Manogaran Thanabalan</strong> &amp; <strong>Sarah Jean Rodrigues</strong> &bull; Sole Shareholder: <strong>Manogaran Thanabalan</strong> (<code>100,000 SLX-ORD</code> &bull; <code>100%</code>) &bull; Protected against lookalike/homoglyph imposters across all HFS &amp; RPC layers.
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${
          ov.viewerIsActiveDirector && !ov.registrationId
            ? `<button type="button" class="inst-btn sm emerald" id="btnStampAcraUen">🇸🇬 Stamp Singapore ACRA UEN</button>`
            : ''
        }
        <a href="#sec-company-social" class="inst-btn sm primary" style="text-decoration:none;">💬 Developers &amp; Company Groups →</a>
      </div>
    `;
    $('btnStampAcraUen')?.addEventListener('click', async () => {
      const uen = window.prompt('Enter official Singapore ACRA UEN for Superlexicon Pte. Ltd.:', '');
      if (!uen || !uen.trim()) return;
      try {
        state.busy = true;
        startInflightAnim(`Stamping Singapore ACRA UEN (${uen.trim()}) on sovereign Charter…`);
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [
            ['address', chr],
            ['bytes', hexToBytes(CharterSocialAbi.setRegistrationId(uen.trim()))],
          ]),
          'setRegistrationId(string)',
          'CorporateCharter',
          [chr]
        );
        finishInflightAnim('✓ Singapore ACRA UEN stamped in stone!');
        await refreshCharterWorld();
      } catch (err) {
        finishInflightAnim('⚠ Could not stamp UEN');
        showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
      } finally {
        state.busy = false;
      }
    });
  } else {
    box.style.borderColor = 'rgba(251,191,36,0.38)';
    box.style.background = 'linear-gradient(135deg,rgba(30,41,59,0.88),rgba(15,23,42,0.94))';
    box.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="inst-badge amber">⚠ SELF-ASSERTED ENTITY CHARTER</span>
          <span style="font-family:var(--mono);font-size:11px;color:#93c5fd;">Verify Charter Address: <code>${escapeHtml(shortAddr(chr))}</code></span>
        </div>
        <div style="color:#cbd5e1;font-size:11.5px;">
          User-created charters are self-asserted unless bank/registry attested. Protocol root <strong>Superlexicon Pte. Ltd.</strong> (Singapore; Directors: <strong>Manogaran Thanabalan</strong> &amp; <strong>Sarah Jean Rodrigues</strong>; <code>100,000</code> shares) is cast in stone and all confusable names are blocked at protocol level.
        </div>
      </div>
      <a href="#sec-company-social" class="inst-btn sm" style="text-decoration:none;">💬 Company Social Group →</a>
    `;
  }
}

function renderCompanySocialSection() {
  const listEl = $('corpSocialGroupsList');
  const memBox = $('corpSubgroupMembersBox');
  const dirBox = $('corpDirectorSubgroupAdmin');
  const feedEl = $('corpSocialMessagesFeed');
  const badgeEl = $('corpSocialCountBadge');
  const titleEl = $('corpActiveChatTitle');
  const metaEl = $('corpActiveChatMeta');
  if (!listEl || !memBox || !feedEl) return;

  const ov = state.corpSocial?.overview;
  if (!ov) return;

  const isDir = Boolean(ov.viewerIsActiveDirector || (state.myIsDirector && !state.myNeedsDirectorConsent));
  if (dirBox) dirBox.style.display = isDir ? 'flex' : 'none';

  const compLabel = ov.legalName || companyNameStr();
  const groups = [
    {
      slug: SUBGROUP_ALL_MEMBERS_SLUG,
      label: `${compLabel} · All Members`,
      isAuto: true,
      isDevGate: false,
      memberCount: ov.allMembers.length,
      members: ov.allMembers,
      viewerIsMember: ov.viewerInAllMembers || state.myIsDirector || state.myIsShareholder,
      channelHash: ov.allMembersChannelHash,
    },
    ...(ov.subgroups || []).map((g) => ({
      ...g,
      isAuto: false,
      isDevGate: g.slug === SUBGROUP_DEVELOPERS_SLUG,
      memberCount: g.members.length,
    })),
  ];

  if (badgeEl) badgeEl.textContent = `${groups.length} ${groups.length === 1 ? 'Group' : 'Groups'}`;

  listEl.innerHTML = groups
    .map((g) => {
      const sel = g.slug === state.corpSocial.activeSlug;
      return `
        <button type="button" data-select-sgrp="${g.slug}" style="text-align:left;padding:9px 11px;border-radius:10px;border:1px solid ${
          sel ? 'rgba(56,189,248,0.7)' : 'rgba(51,65,85,0.7)'
        };background:${sel ? 'rgba(14,116,144,0.24)' : 'rgba(15,23,42,0.75)'};color:#f8fafc;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <strong style="font-size:12.5px;">${g.isAuto ? '🏛️ ' : g.isDevGate ? '🧩 ' : '👥 '}${escapeHtml(g.label)}</strong>
            <span style="font-size:10.5px;font-family:var(--mono);color:#94a3b8;">
              ${g.isAuto ? 'Auto-enrolled on Charter creation' : g.isDevGate ? 'App Store & Web RPC Publisher Gate' : 'Director-managed sub-group'}
            </span>
          </div>
          <span class="inst-badge ${g.viewerIsMember ? 'green' : 'cyan'}">${g.memberCount} mbrs</span>
        </button>
      `;
    })
    .join('');

  const activeGroup = groups.find((g) => g.slug === state.corpSocial.activeSlug) || groups[0];
  if (titleEl) titleEl.textContent = activeGroup.label;
  if (metaEl) {
    metaEl.innerHTML = `Channel <code>${escapeHtml(shortAddr(activeGroup.channelHash))}</code> &bull; ${
      activeGroup.viewerIsMember
        ? '<span style="color:#6ee7b7;">✓ You are a member (instant chat active)</span>'
        : '<span style="color:#fcd34d;">🔒 Membership required to post</span>'
    }`;
  }

  const memberPills = (activeGroup.members || [])
    .map((addr) => {
      const label = session.identityLabel ? session.identityLabel(addr) : shortAddr(addr);
      const rmBtn =
        !activeGroup.isAuto && isDir
          ? `<button type="button" data-rm-sgrp-mem="${addr}" title="Remove from sub-group" style="margin-left:5px;background:none;border:none;color:#fca5a5;cursor:pointer;font-weight:800;">✕</button>`
          : '';
      return `<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:rgba(30,41,59,0.9);border:1px solid rgba(71,85,105,0.65);font-size:11px;font-family:var(--mono);color:#e2e8f0;">${escapeHtml(label)}${rmBtn}</span>`;
    })
    .join(' ');

  memBox.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
      <strong style="color:#cbd5e1;">Members (${activeGroup.members.length})</strong>
      <span style="font-family:var(--mono);font-size:10.5px;color:#94a3b8;">${
        activeGroup.isAuto ? 'Synced from Board, Roles & Cap Table' : 'Managed by Company Directors'
      }</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;">${memberPills || '<span style="font-size:11px;color:#94a3b8;">No members yet</span>'}</div>
    ${
      !activeGroup.isAuto && isDir
        ? `
      <div style="display:flex;gap:6px;margin-top:4px;">
        <input class="inst-input" id="inpAddSubgroupMemberAddr" type="text" placeholder="Add member Identity HFS (0x…)" style="flex:1;padding:6px 9px;font-size:11.5px;" />
        <button type="button" class="inst-btn sm emerald" id="btnAddSubgroupMember">+ Add</button>
      </div>
    `
        : ''
    }
  `;

  const msgs = state.corpSocial.messages || [];
  if (!msgs.length) {
    feedEl.innerHTML = `
      <div style="padding:24px 14px;text-align:center;color:#94a3b8;font-size:12px;border:1px dashed rgba(71,85,105,0.55);border-radius:10px;">
        💬 <strong>${escapeHtml(activeGroup.label)}</strong> is live on-chain! All enrolled company members can message each other here and in CommonsRF Social immediately without manual RF handshakes.
      </div>
    `;
  } else {
    feedEl.innerHTML = msgs
      .map((m) => {
        const who = session.identityLabel ? session.identityLabel(m.authorAddr) : shortAddr(m.authorAddr);
        return `
          <div style="padding:8px 11px;border-radius:10px;background:rgba(15,23,42,0.82);border:1px solid rgba(51,65,85,0.68);">
            <div style="display:flex;justify-content:space-between;font-size:10.5px;font-family:var(--mono);color:#7dd3fc;margin-bottom:3px;">
              <strong>${escapeHtml(who)}</strong>
              <span style="color:#64748b;">Blk #${fmtNum(m.block)}</span>
            </div>
            <div style="font-size:12.5px;color:#f1f5f9;line-height:1.45;">${escapeHtml(m.text)}</div>
          </div>
        `;
      })
      .join('');
    feedEl.scrollTop = feedEl.scrollHeight;
  }
}

$('corpSocialGroupsList')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-select-sgrp]');
  if (!btn) return;
  state.corpSocial.activeSlug = btn.getAttribute('data-select-sgrp');
  await refreshCompanySocialState();
  renderCompanySocialSection();
});

$('btnPresetDevSubgroup')?.addEventListener('click', () => {
  const slugIn = $('inpNewSubgroupSlug');
  const lblIn = $('inpNewSubgroupLabel');
  if (slugIn) slugIn.value = 'developers';
  if (lblIn) {
    lblIn.value = state.corpSocial?.overview?.isSovereign
      ? 'Superlexicon · Developers'
      : `${companyNameStr().slice(0, 36)} · Developers`;
  }
});

$('btnSyncCorpSocial')?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.corporateCharter) return;
  const chr = session.inst.corporateCharter;
  const msgAddr = resolveCharterMessagingAddr();
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    startInflightAnim('Syncing Company Social Group & Messaging controller…');
    const ov = state.corpSocial?.overview;
    const inner =
      !ov?.legalName && msgAddr
        ? CharterSocialAbi.configureEntityAndSocial({
            legalName: companyNameStr(),
            jurisdiction: 'Singapore',
            registrationId: '',
            hfsRegistry: session.manifest?.hfsRegistry || ZERO_ADDR,
            messagingHps: msgAddr,
          })
        : CharterSocialAbi.syncCompanySocialGroup();
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', chr],
        ['bytes', hexToBytes(inner)],
      ]),
      'syncCompanySocialGroup()',
      'CorporateCharter',
      [chr, ...(msgAddr ? [msgAddr] : []), ...(state.capRows || []).map((r) => r.addr)]
    );
    finishInflightAnim('✓ Company Social Group synced!');
    await refreshCharterWorld();
  } catch (err) {
    finishInflightAnim('⚠ Sync note');
    showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

$('btnCreateSubgroup')?.addEventListener('click', async () => {
  if (state.busy || !session.inst?.corporateCharter) return;
  const slugStr = ($('inpNewSubgroupSlug')?.value || '').trim();
  const labelStr = ($('inpNewSubgroupLabel')?.value || '').trim();
  if (!slugStr || !labelStr) {
    showBanner('🚫 Enter both a sub-group slug (e.g. developers) and a label.', 'err');
    return;
  }
  if (!state.corpSocial?.overview?.isSovereign && isConfusableSuperlexiconName(labelStr)) {
    showBanner(
      '🚫 Only the cast-in-stone Superlexicon Pte. Ltd. charter can create a subgroup named Superlexicon.',
      'err'
    );
    return;
  }
  const chr = session.inst.corporateCharter;
  const msgAddr = resolveCharterMessagingAddr();
  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    if (!state.corpSocial?.overview?.messagingHps || state.corpSocial.overview.messagingHps === ZERO_ADDR) {
      if (msgAddr) {
        startInflightAnim('Step 1/2: Linking Messaging HFS to CorporateCharter…');
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [
            ['address', chr],
            [
              'bytes',
              hexToBytes(
                CharterSocialAbi.configureEntityAndSocial({
                  legalName: state.corpSocial?.overview?.legalName || companyNameStr(),
                  jurisdiction: state.corpSocial?.overview?.jurisdiction || 'Singapore',
                  registrationId: state.corpSocial?.overview?.registrationId || '',
                  hfsRegistry: session.manifest?.hfsRegistry || ZERO_ADDR,
                  messagingHps: msgAddr,
                })
              ),
            ],
          ]),
          'configureEntityAndSocial',
          'CorporateCharter',
          [chr, msgAddr]
        );
      }
    }
    startInflightAnim(`Creating company sub-group "${labelStr}" on-chain…`);
    const initialDirectors = (state.directors || [])
      .map((d) => (typeof d === 'string' ? d : d.addr || ''))
      .filter(Boolean);
    const cd = CharterSocialAbi.createCompanySubgroup({
      subgroupSlug: slugStr,
      label: labelStr,
      initialMembers: initialDirectors,
    });
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', chr],
        ['bytes', hexToBytes(cd)],
      ]),
      `createCompanySubgroup(${slugStr})`,
      'CorporateCharter',
      [chr, ...(msgAddr ? [msgAddr] : []), ...initialDirectors]
    );
    finishInflightAnim(`✓ Sub-group "${labelStr}" created!`);
    if ($('inpNewSubgroupSlug')) $('inpNewSubgroupSlug').value = '';
    if ($('inpNewSubgroupLabel')) $('inpNewSubgroupLabel').value = '';
    await refreshCharterWorld();
  } catch (err) {
    finishInflightAnim('⚠ Sub-group creation failed');
    showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
});

$('corpSubgroupMembersBox')?.addEventListener('click', async (ev) => {
  if (state.busy || !session.inst?.corporateCharter) return;
  const chr = session.inst.corporateCharter;
  const slug = state.corpSocial.activeSlug;

  const addBtn = ev.target.closest('#btnAddSubgroupMember');
  if (addBtn) {
    const memberAddr = ($('inpAddSubgroupMemberAddr')?.value || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(memberAddr)) {
      showBanner('🚫 Enter a valid 20-byte Identity HFS address (0x…).', 'err');
      return;
    }
    state.busy = true;
    try {
      await session.ensureMyIdentity((m) => startInflightAnim(m));
      startInflightAnim(`Adding ${shortAddr(memberAddr)} to sub-group…`);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', chr],
          ['bytes', hexToBytes(CharterSocialAbi.addSubgroupMember(slug, memberAddr))],
        ]),
        'addSubgroupMember',
        'CorporateCharter',
        [chr, memberAddr]
      );
      finishInflightAnim('✓ Member added to company sub-group!');
      await refreshCharterWorld();
    } catch (err) {
      finishInflightAnim('⚠ Add member failed');
      showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
    return;
  }

  const rmBtn = ev.target.closest('[data-rm-sgrp-mem]');
  if (rmBtn) {
    const memberAddr = rmBtn.getAttribute('data-rm-sgrp-mem');
    state.busy = true;
    try {
      await session.ensureMyIdentity((m) => startInflightAnim(m));
      startInflightAnim(`Removing ${shortAddr(memberAddr)} from sub-group…`);
      await session.sendAsMyIdentity(
        encodeAbi('execute(address,bytes)', [
          ['address', chr],
          ['bytes', hexToBytes(CharterSocialAbi.removeSubgroupMember(slug, memberAddr))],
        ]),
        'removeSubgroupMember',
        'CorporateCharter',
        [chr, memberAddr]
      );
      finishInflightAnim('✓ Member removed from sub-group');
      await refreshCharterWorld();
    } catch (err) {
      finishInflightAnim('⚠ Remove member failed');
      showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
  }
});

async function sendCompanyGroupChatMessage() {
  if (state.busy || !session.inst?.corporateCharter) return;
  const input = $('inpCorpSocialMsg');
  const text = (input?.value || '').trim();
  if (!text) return;
  const chr = session.inst.corporateCharter;
  const msgAddr = resolveCharterMessagingAddr();
  const slug =
    state.corpSocial.activeSlug === SUBGROUP_ALL_MEMBERS_SLUG
      ? '0x' + '00'.repeat(32)
      : state.corpSocial.activeSlug;

  state.busy = true;
  try {
    await session.ensureMyIdentity((m) => startInflightAnim(m));
    if (!state.corpSocial?.overview?.messagingHps || state.corpSocial.overview.messagingHps === ZERO_ADDR) {
      if (msgAddr) {
        await session.sendAsMyIdentity(
          encodeAbi('execute(address,bytes)', [
            ['address', chr],
            [
              'bytes',
              hexToBytes(
                CharterSocialAbi.configureEntityAndSocial({
                  legalName: state.corpSocial?.overview?.legalName || companyNameStr(),
                  jurisdiction: state.corpSocial?.overview?.jurisdiction || 'Singapore',
                  registrationId: state.corpSocial?.overview?.registrationId || '',
                  hfsRegistry: session.manifest?.hfsRegistry || ZERO_ADDR,
                  messagingHps: msgAddr,
                })
              ),
            ],
          ]),
          'configureEntityAndSocial',
          'CorporateCharter',
          [chr, msgAddr]
        );
      }
    }
    startInflightAnim('Posting message to Corporate Social Group…');
    await session.sendAsMyIdentity(
      encodeAbi('execute(address,bytes)', [
        ['address', chr],
        ['bytes', hexToBytes(CharterSocialAbi.postCompanyGroupMessage(slug, text))],
      ]),
      'postCompanyGroupMessage',
      'CorporateCharter',
      [chr, ...(msgAddr ? [msgAddr] : [])]
    );
    if (input) input.value = '';
    finishInflightAnim('✓ Message delivered to company group!');
    await refreshCompanySocialState();
    renderCompanySocialSection();
  } catch (err) {
    finishInflightAnim('⚠ Message rejected');
    showBanner(`🚫 ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
  }
}

$('btnSendCorpSocialMsg')?.addEventListener('click', sendCompanyGroupChatMessage);
$('inpCorpSocialMsg')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    sendCompanyGroupChatMessage();
  }
});

// ---------------------------------------------------------------------------
// Boot & Real-Time WebSocket `eth_subscribe` Chain Stream
// ---------------------------------------------------------------------------

await session.boot();
{
  const reqAction = new URLSearchParams(window.location.search).get('action');
  if (reqAction === 'serviceContract') {
    state.selectedActionKind = 'serviceContract';
    document.querySelectorAll('#actionTypePicker .action-pick-card').forEach((c) => {
      c.classList.toggle('selected', c.getAttribute('data-action-kind') === 'serviceContract');
    });
    switchTab('actions');
    populateActionTargetDropdown();
    renderActionStudioState();
  }
}
charterWatcher = slxWatchChainApp({
  rpcUrl: () => session.rpcUrl,
  filter: () => ({ address: getCharterWatchAddresses() }),
  onLog: (lg) => {
    ingestRawLogList([lg], { suppressFx: Boolean(lg.isBackfill) });
  },
  onRefresh: (meta) => refreshCharterWorld(meta),
});
charterAuctionSub = slxSubscribeLogs(
  () => session.rpcUrl,
  () => {
    const shareLed = session.inst?.shareLedger;
    if (!shareLed) return { address: [] };
    const shareTopic = '0x000000000000000000000000' + shareLed.toLowerCase().replace(/^0x/, '');
    return {
      topics: [
        HFS_EVENT_TOPICS.AUTH_INITIALIZED,
        shareTopic,
        GOV_CONSTANTS.POLICY_SHARE_TRANSFER_AUCTION,
      ],
    };
  },
  (lg) => {
    const latestAuth = String(lg.address || '').toLowerCase();
    if (latestAuth && session.inst?.corporateCharter && state.activeAuctionAddr !== latestAuth) {
      state.activeAuctionAddr = latestAuth;
      saveAuctionAddr(session.inst.corporateCharter, latestAuth);
      charterWatcher?.refreshFilter?.();
      if (!lg.isBackfill) {
        charterWatcher?.triggerRefresh?.({ source: 'auctionDiscovered', blockNumber: lg.blockNumberNum });
      }
    }
  }
);
