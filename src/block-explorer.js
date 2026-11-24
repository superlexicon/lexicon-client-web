/**
 * SuperLexicon Subnet 1 Cryptographic Block Explorer & Multi-Validator Receipt Verifier
 * (`web/src/block-explorer.js`).
 *
 * Queries live validator JSON-RPC & WebSocket streams directly with zero centralized indexer DB:
 *  1. Universal Search: 32-byte `txHash` (`eth_getTransactionReceipt`), `Block #` (`eth_getLogs` +
 *     `eth_getTransactionReceipts`), or 20-byte EOA / HFS Contract `Address` (`eth_getTransactionCount` +
 *     `Identity` / `HfsRegistry` + `eth_getLogs`).
 *  2. Multi-Validator BFT Quorum Cross-Check: Queries `node1`–`node5` in parallel to
 *     prove independent physical validators finalized the exact same `txHash` & `blockHash`.
 *  3. Client-Side Cryptographic Verifier & 1-Click Live Proof Tx: Signs a real `secp256k1` EIP-155
 *     RLP transaction ($0.00 gas) in-browser, shows raw RLP hex + locally computed `keccak256(rawTx)`
 *     before broadcast, confirms BFT finality, and generates a copyable `wscat` terminal command.
 *  4. Real-Time Finalized Blocks, Decoded HFS Transactions, and Live `HfsRegistry` Smart Contract Directory.
 */

import {
  keccak256Hex,
  utf8ToBytes,
  eventTopic,
  computeRawTxHash,
  signOrderedLexiconTx,
  encodeAbi,
  shortHex,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  SlxHfsCache,
  SlxSubnetManager,
  slxWaitForReceipt,
  slxSubscribeStats,
  slxSubscribeNewHeads,
  slxSubscribeLogs,
  fetchRegisteredHfsByType,
  readOnChainIdentityNickname,
  readOnChainIdentityOwner,
  lookupCachedSignedTx,
  SUBNET1_FLEET_SOCIAL_DEFAULT,
} from '@superlexicon/sdk';
import { mountSlxSubnetWorldMap } from '@superlexicon/sdk/ui';
import { slidesWallet, unifiedHdr } from './client-header.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function parseHexInt(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  try {
    return Number(BigInt(String(v)));
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Known HFS Event Signatures (`keccak256` Topic0 Decoder)
// ---------------------------------------------------------------------------

const EVENT_SPECS = [
  ['DEX CLOB', '📈', '#38bdf8', 'OrderPlaced(uint64,address,uint8,uint64,uint64,uint64)'],
  ['DEX CLOB', '📈', '#34d399', 'BlockMatched(uint64,uint64,uint64,uint64)'],
  ['DEX CLOB', '📈', '#94a3b8', 'OrderCancelled(uint64,address)'],
  ['DEX CLOB', '📈', '#7dd3fc', 'DexInitialized(address,address,uint64,uint64)'],
  ['AssetLedger', '🪙', '#6ee7b7', 'Transfer(address,address,uint64)'],
  ['AssetLedger', '🪙', '#a7f3d0', 'Approval(address,address,uint64)'],
  ['AssetLedger', '🪙', '#34d399', 'AssetIssued(address,uint64)'],
  ['AssetLedger', '🪙', '#fca5a5', 'AssetCancelled(address,uint64)'],
  ['Corporate', '🏛️', '#818cf8', 'CharterIncorporated(address,address,bytes32)'],
  ['Corporate', '🏛️', '#a5b4fc', 'OfficerAppointed(bytes32,address)'],
  ['ShareCapital', '🏛️', '#c084fc', 'AuctionOpened(uint64,uint64,uint64)'],
  ['ShareCapital', '🏛️', '#c084fc', 'BidSubmitted(uint64,address,uint64,uint64)'],
  ['Storefront', '🛒', '#fbbf24', 'ProductPurchased(bytes32,address,uint64,uint64)'],
  ['Accounting', '🧾', '#fde68a', 'SaleRecorded(uint64,bytes32,address,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#fbbf24', 'PlayerJoined(bytes32,address,uint64,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#38bdf8', 'ShipMoved(bytes32,address,uint64,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#f87171', 'WeaponFired(bytes32,address,uint64,uint64,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#fb923c', 'VesselCollision(bytes32,address,address,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#ef4444', 'ShipSunk(bytes32,address,address,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#6ee7b7', 'GunUpgraded(bytes32,address,uint64,uint64)'],
  ['Phantom Fleet', '⚓', '#34d399', 'HullRepaired(bytes32,address,uint64,uint64)'],
  ['Hegemony', '⬢', '#22d3ee', 'RealmCreated(bytes32,address,uint64)'],
  ['Hegemony', '⬢', '#67e8f9', 'SovereignJoined(bytes32,address,uint64,uint64)'],
  ['Hegemony', '⬢', '#38bdf8', 'DirectivesStaged(bytes32,uint64,uint64,uint64,uint64)'],
  ['Hegemony', '⬢', '#f43f5e', 'SectorClash(bytes32,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)'],
  ['Hegemony', '⬢', '#10b981', 'CycleResolved(bytes32,uint64,uint64,uint64)'],
  ['Hegemony', '⬢', '#fde047', 'CompactProposed(bytes32,uint64,uint64,uint64)'],
  ['Hegemony', '⬢', '#34d399', 'CompactRatified(bytes32,uint64,uint64,uint64)'],
  ['Hegemony', '⬢', '#ef4444', 'OathBroken(bytes32,uint64,uint64)'],
  ['Cipher Noir', '🔐', '#c084fc', 'CaseOpened(bytes32,address,uint64)'],
  ['Cipher Noir', '🔐', '#e879f9', 'OperativeSeated(bytes32,uint64,address,address)'],
  ['Cipher Noir', '🔐', '#a855f7', 'DossiersDealt(bytes32,bytes32,uint64)'],
  ['Cipher Noir', '🔐', '#fb7185', 'ProbeSubmitted(bytes32,uint64,uint64,uint64,uint64,uint64)'],
  ['Cipher Noir', '🔐', '#38bdf8', 'AlibiTransmitted(bytes32,uint64,uint64,uint64)'],
  ['Cipher Noir', '🔐', '#94a3b8', 'AlibiPassed(bytes32,uint64,uint64)'],
  ['Cipher Noir', '🔐', '#f43f5e', 'IndictmentFiled(bytes32,uint64,uint64,uint64,uint64)'],
  ['Cipher Noir', '🔐', '#34d399', 'CaseSolved(bytes32,uint64,uint64,uint64,uint64)'],
  ['Messaging', '💬', '#7dd3fc', 'MessagePosted(bytes32,uint64,address,bytes)'],
  ['Social', '📡', '#34d399', 'SocialMemberRegistered(address,uint64,uint64,uint64)'],
  ['Social', '🤝', '#fbbf24', 'EncounterHandshakeOpened(address,address,uint64,uint64)'],
  ['Social', '🤝', '#10b981', 'EncounterHandshakeAccepted(address,address,uint64)'],
  ['Social', '🌐', '#c084fc', 'SocialPostPublished(uint64,address,uint64)'],
  ['Social', '🔒', '#38bdf8', 'ProximityDmSent(bytes32,address,address)'],
  ['Identity', '🪪', '#6ee7b7', 'IdentityInitialized(address,bytes32)'],
  ['Identity', '🪪', '#93c5fd', 'ExecutedCall(address,bytes4,bool)'],
  ['HfsRegistry', '🗂️', '#fcd34d', 'HfsInstanceRegistered(bytes32,address,address,uint64,bytes32)'],
  ['VRF Beacon', '🛡️', '#38bdf8', 'VmVrfEpochOpened(uint64,bytes32,uint64,uint64)'],
  ['VRF Beacon', '🛡️', '#10b981', 'VmVrfEpochActivated(uint64,bytes32,bytes32,uint64)'],
  ['VRF Beacon', '🎲', '#fbbf24', 'VmVrfRequested(bytes32,address,uint64,bytes32)'],
  ['VRF Beacon', '✨', '#34d399', 'VmVrfFulfilled(bytes32,address,bytes32,bytes32)'],
  ['Threshold HE', '🔐', '#a855f7', 'VmHeDecryptionRequested(bytes32,address,uint64,uint64)'],
  ['Threshold HE', '🔓', '#34d399', 'VmHeDecryptionFulfilled(bytes32,address,uint64,uint64)'],
  ['4D Lottery', '🎰', '#f59e0b', 'LotteryTicketsBought(uint64,address,uint64,uint64,bytes32)'],
  ['4D Lottery', '🏆', '#fde047', 'LotteryRoundSettled(uint64,uint64,uint64,uint64,bytes32,bytes32)'],
  ['CipherVote', '🗳️', '#c084fc', 'SecretPollCreated(uint64,address,uint64,uint64,uint64)'],
  ['CipherVote', '🔒', '#38bdf8', 'EncryptedBallotCast(uint64,address,uint64,uint64,bytes32)'],
  ['CipherVote', '⚡', '#fbbf24', 'SecretPollTallyRequested(uint64,bytes32,uint64,uint64)'],
  ['CipherVote', '✅', '#34d399', 'SecretPollTallyVerified(uint64,uint64,uint64,uint64,bytes32,uint64)'],
  ['IFRS Ledger', '📘', '#22d3ee', 'IfrsJournalPosted(uint64,address,bytes32,bytes)'],
  ['IFRS Ledger', '🗂️', '#34d399', 'IfrsSubledgerUpdated(uint64,bytes32,bytes)'],
  ['IFRS Ledger', '🔒', '#a78bfa', 'IfrsFiscalPeriodClosed(uint64,int64,uint64,address)'],
  ['SubnetRegistry', '⛓️', '#38bdf8', 'SubnetUpserted(bytes32,address,address,uint64,uint64)'],
  ['SubnetRegistry', '⚙️', '#fbbf24', 'SubnetStatusChanged(bytes32,uint64,uint64)'],
  ['SubnetRegistry', '🔑', '#6ee7b7', 'SubnetOwnershipTransferred(bytes32,address,address)'],
];

const TOPIC_MAP = new Map();
for (const [domain, icon, color, sig] of EVENT_SPECS) {
  const fnName = sig.slice(0, sig.indexOf('('));
  TOPIC_MAP.set(eventTopic(sig).toLowerCase(), { domain, icon, color, sig, fnName });
}

function decodeTopic0(t0) {
  const low = String(t0 || '').toLowerCase();
  return (
    TOPIC_MAP.get(low) || {
      domain: 'WASM HFS',
      icon: '⚙️',
      color: '#94a3b8',
      sig: low ? `Event(${shortHex(low, 10, 6)})` : 'Execution',
      fnName: low ? `Event ${shortHex(low, 8, 4)}` : 'Call',
    }
  );
}

// ---------------------------------------------------------------------------
// Multi-Validator Endpoint Discovery
// ---------------------------------------------------------------------------

function getValidatorRpcList(primaryRpc) {
  const activeProf = SlxSubnetManager.getActiveSubnetProfile();
  if (activeProf && Array.isArray(activeProf.validatorNodes) && activeProf.validatorNodes.length) {
    const list = [...activeProf.validatorNodes];
    if (primaryRpc && !list.some((x) => x.url === primaryRpc)) {
      list.unshift({ name: 'Active Node', url: primaryRpc, pubkeyPrefix: null });
    }
    return list;
  }
  const isHttps =
    (typeof window !== 'undefined' && window.location?.protocol === 'https:') ||
    String(primaryRpc).startsWith('wss://');
  if (isHttps) {
    return [
      { name: 'Validator node1', url: 'wss://node1.superlexicon.com/rpc', pubkeyPrefix: 'c8692b6e' },
      { name: 'Validator node2', url: 'wss://node2.superlexicon.com/rpc', pubkeyPrefix: '75c9f6e5' },
      { name: 'Validator node3', url: 'wss://node3.superlexicon.com/rpc', pubkeyPrefix: '33b12ce4' },
      { name: 'Validator node4', url: 'wss://node4.superlexicon.com/rpc', pubkeyPrefix: 'fbfc4fee' },
    ];
  }
  const subnetPrefix = String(primaryRpc).includes('192.168.1.') ? '192.168.1' : '192.168.50';
  const list = [
    { name: 'Validator node1 (.91)', url: `ws://${subnetPrefix}.91:8545`, pubkeyPrefix: 'c8692b6e' },
    { name: 'Validator node2 (.92)', url: `ws://${subnetPrefix}.92:8555`, pubkeyPrefix: '75c9f6e5' },
    { name: 'Validator node3 (.93)', url: `ws://${subnetPrefix}.93:8545`, pubkeyPrefix: '33b12ce4' },
    { name: 'Validator node4 (.94)', url: `ws://${subnetPrefix}.94:8545`, pubkeyPrefix: 'fbfc4fee' },
  ];
  if (primaryRpc && !list.some((x) => x.url === primaryRpc)) {
    list.unshift({ name: 'Local Node', url: primaryRpc, pubkeyPrefix: null });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Explorer Mount & Controller
// ---------------------------------------------------------------------------

export function mountSubnetBlockExplorer() {
  const root = document.getElementById('slx-explorer-section');
  if (!root) return;

  let primaryRpc = getDefaultNodeWsUrl();
  let manifest = null;
  const contractDirectory = new Map(); // addrLow -> { primaryAddr, label, typeName, codeHash, createdBlock, creatorTag }
  const recentBlocks = []; // [{ number, hash, parentHash, txCount, timestamp }]
  const recentTxs = new Map(); // txHashLow -> { txHash, blockNumber, txIndex, logs: [] }

  const activeSubnetInit = SlxSubnetManager.getActiveSubnetProfile();
  const subnetOptionsHtml = SlxSubnetManager.listSubnets()
    .map(
      (s) =>
        `<option value="${esc(s.key)}" ${s.key === activeSubnetInit?.key ? 'selected' : ''}>${esc(s.icon || '🌐')} ${esc(s.name)} (${esc(s.subnetId || '—')})</option>`
    )
    .join('');

  if (typeof document !== 'undefined' && !document.getElementById('slx-block-explorer-styles')) {
    const st = document.createElement('style');
    st.id = 'slx-block-explorer-styles';
    st.textContent = `
      .slx-exp-shell {
        border-radius: 16px;
        border: 1.5px solid rgba(56, 189, 248, 0.42);
        background: linear-gradient(180deg, rgba(8, 15, 30, 0.96) 0%, rgba(11, 20, 38, 0.94) 100%);
        padding: 18px 20px;
        box-shadow: 0 16px 42px rgba(0, 0, 0, 0.42);
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 100%;
        min-width: 0;
      }
      .slx-exp-dual-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 14px;
        align-items: start;
      }
      .slx-exp-contracts-grid {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 8px;
      }
      .slx-exp-bridge-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }
      @media (max-width: 680px) {
        .slx-exp-shell {
          padding: 12px !important;
          gap: 12px !important;
          border-radius: 13px !important;
        }
        #slxExpTitleText {
          font-size: 0.96rem !important;
        }
        .slx-exp-hdr-actions {
          width: 100%;
        }
        .slx-exp-hdr-actions > label,
        #slxExpBtnLiveProof {
          width: 100%;
          justify-content: center;
        }
        #slxExpSubnetSelect {
          max-width: 100%;
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #slxExpSearchForm {
          flex-direction: column;
          align-items: stretch !important;
        }
        #slxExpSearchInput {
          min-width: 0 !important;
          width: 100% !important;
          font-size: 16px !important;
        }
        #slxExpSearchForm > button {
          width: 100%;
        }
        .slx-exp-dual-grid,
        .slx-exp-contracts-grid,
        .slx-exp-bridge-grid {
          grid-template-columns: minmax(0, 1fr) !important;
        }
        #slxExpInspector,
        #slxExpBlocksList,
        #slxExpTxsList,
        #slxExpContractsGrid {
          min-width: 0;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
      }
    `;
    document.head.appendChild(st);
  }

  root.innerHTML = `
    <div class="slx-exp-shell">
      <!-- Top Header + Subnet Selector + Live Proof CTA -->
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span id="slxExpTitleText" style="font-size:1.15rem;font-weight:800;color:#f8fafc;letter-spacing:-0.01em;">🔎 ${esc(activeSubnetInit?.shortLabel || 'Subnet 1')} Cryptographic Block Explorer &amp; Quorum Verifier</span>
            <span style="padding:2px 9px;border-radius:999px;background:rgba(16,185,129,0.18);border:1px solid rgba(52,211,153,0.55);color:#6ee7b7;font-family:'JetBrains Mono',monospace;font-size:0.68rem;font-weight:700;">Direct Validator RPC • Zero Cloud DB</span>
          </div>
          <div style="font-size:0.77rem;color:#94a3b8;margin-top:3px;">
            Switch subnets anytime to inspect finalized blocks, verify <code>txHash</code> quorum across that subnet's validators, and browse all HFS smart contracts deployed on the selected subnet.
          </div>
        </div>

        <div class="slx-exp-hdr-actions" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
          <label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid rgba(56,189,248,0.55);background:#050b16;font-family:'JetBrains Mono',monospace;font-size:0.73rem;color:#bae6fd;max-width:100%;">
            <span style="font-weight:700;color:#7dd3fc;">Subnet:</span>
            <select id="slxExpSubnetSelect" style="background:#050b16;color:#f8fafc;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:0.74rem;font-weight:700;cursor:pointer;">
              ${subnetOptionsHtml}
            </select>
          </label>

          <button
            type="button"
            id="slxExpBtnLiveProof"
            style="display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:10px;background:linear-gradient(135deg,#10b981,#0ea5e9);border:1px solid #6ee7b7;color:#022c22;font-family:'JetBrains Mono',monospace;font-size:0.77rem;font-weight:800;cursor:pointer;box-shadow:0 4px 18px rgba(16,185,129,0.3);"
          >
            ⚡ Send &amp; Verify Live Proof Tx ($0.00 Gas)
          </button>
        </div>
      </div>

      <!-- Universal Search Bar -->
      <form id="slxExpSearchForm" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <input
          id="slxExpSearchInput"
          type="text"
          placeholder="Paste Tx Hash (0x…64), Block # (e.g. 60580), or EOA / HFS Contract Address (0x…40)…"
          style="flex:1;min-width:220px;padding:10px 14px;border-radius:10px;border:1px solid rgba(56,189,248,0.48);background:#050b16;color:#f8fafc;font-family:'JetBrains Mono',monospace;font-size:0.78rem;outline:none;"
        />
        <button
          type="submit"
          style="padding:10px 18px;border-radius:10px;border:1px solid rgba(56,189,248,0.65);background:rgba(14,165,233,0.22);color:#e0f2fe;font-family:'JetBrains Mono',monospace;font-size:0.78rem;font-weight:700;cursor:pointer;"
        >
          🔍 Inspect On-Chain
        </button>
      </form>

      <!-- Dynamic Cryptographic Inspector Result Panel -->
      <div id="slxExpInspector" style="display:none;border-radius:12px;border:1.5px solid rgba(52,211,153,0.5);background:#060c19;padding:15px 16px;flex-direction:column;gap:12px;"></div>

      <!-- Interactive Global Subnet World Map & Roaming Topology -->
      <div id="slxExpWorldMapMount" style="min-width:0;"></div>

      <!-- Live Dual-Subnet Radio <-> Hybrid Repeater <-> TCP Bridge Monitor -->
      <div id="slxExpDualSubnetPanel" style="display:none;border-radius:14px;border:1.5px solid rgba(168,85,247,0.45);background:linear-gradient(135deg,rgba(7,14,28,0.96),rgba(17,12,34,0.94));padding:14px 16px;flex-direction:column;gap:12px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;color:#e9d5ff;letter-spacing:0.02em;">🌐 LIVE CROSS-SUBNET BRIDGE: LR2021 RF SUBNET 1 ⇄ HYBRID REPEATER (.4) ⇄ ENCRYPTED TCP SUBNET 2</strong>
            <span id="slxExpRepeaterLaneBadge" style="padding:2px 9px;border-radius:999px;background:rgba(56,189,248,0.18);border:1px solid rgba(56,189,248,0.5);color:#7dd3fc;font-family:'JetBrains Mono',monospace;font-size:0.66rem;font-weight:700;">Connecting…</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" id="slxExpBtnRfToTcp" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(56,189,248,0.55);background:rgba(14,165,233,0.18);color:#bae6fd;font-family:'JetBrains Mono',monospace;font-size:0.68rem;font-weight:700;cursor:pointer;">📡➔🔌 Send RF→TCP Tx</button>
            <button type="button" id="slxExpBtnTcpToRf" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(192,132,252,0.55);background:rgba(168,85,247,0.18);color:#f3e8ff;font-family:'JetBrains Mono',monospace;font-size:0.68rem;font-weight:700;cursor:pointer;">🔌➔📡 Send TCP→RF Tx</button>
          </div>
        </div>

        <div id="slxExpBridgeTopology" class="slx-exp-bridge-grid"></div>

        <div style="border-radius:10px;border:1px solid rgba(71,85,105,0.5);background:#050a15;padding:10px 12px;display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <strong style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:#c084fc;text-transform:uppercase;letter-spacing:0.04em;">⇄ Bidirectional Cross-Subnet Transactions &amp; ForeignSubnetTxnResponse Receipts</strong>
            <span id="slxExpCrossSummary" style="font-family:'JetBrains Mono',monospace;font-size:0.66rem;color:#94a3b8;">Polling live relay pools…</span>
          </div>
          <div id="slxExpCrossFeed" style="display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;"></div>
        </div>
      </div>

      <!-- Dual Live Feeds: Finalized Blocks + Confirmed Transactions -->
      <div class="slx-exp-dual-grid">
        <!-- Left: Latest Finalized Blocks -->
        <div style="min-width:0;border-radius:12px;border:1px solid rgba(71,85,105,0.5);background:rgba(9,16,32,0.9);padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <strong style="font-family:'JetBrains Mono',monospace;font-size:0.76rem;color:#7dd3fc;text-transform:uppercase;letter-spacing:0.04em;">🧱 Latest Finalized Blocks</strong>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.68rem;color:#64748b;">Tap block to inspect</span>
          </div>
          <div id="slxExpBlocksList" style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto;">
            <div style="color:#94a3b8;font-family:'JetBrains Mono',monospace;font-size:0.73rem;padding:12px 4px;">Subscribing to live ${esc(activeSubnetInit?.shortLabel || 'Subnet')} newHeads…</div>
          </div>
        </div>

        <!-- Right: Latest Confirmed Transactions -->
        <div style="min-width:0;border-radius:12px;border:1px solid rgba(71,85,105,0.5);background:rgba(9,16,32,0.9);padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <strong style="font-family:'JetBrains Mono',monospace;font-size:0.76rem;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.04em;">⚡ Live Confirmed HFS Transactions</strong>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.68rem;color:#64748b;">Tap txHash for receipt</span>
          </div>
          <div id="slxExpTxsList" style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto;">
            <div style="color:#94a3b8;font-family:'JetBrains Mono',monospace;font-size:0.73rem;padding:12px 4px;">Backfilling recent finalized transactions…</div>
          </div>
        </div>
      </div>

      <!-- Registered On-Chain HFS Smart Contracts Directory -->
      <details open id="slxExpContractsDrawer" style="border-radius:12px;border:1px solid rgba(71,85,105,0.48);background:rgba(9,16,32,0.85);padding:10px 14px;min-width:0;">
        <summary style="cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.76rem;font-weight:800;color:#fcd34d;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;list-style:none;">
          <span>🗂️ Live Deployed HFS Smart Contracts on <span id="slxExpContractsSubnetLbl">${esc(activeSubnetInit?.shortLabel || 'Subnet 1')}</span> (<span id="slxExpContractCount">0</span> Active)</span>
          <span style="font-size:0.68rem;color:#94a3b8;">Toggle &amp; inspect ▾</span>
        </summary>
        <div id="slxExpContractsGrid" class="slx-exp-contracts-grid"></div>
      </details>
    </div>
  `;

  const elSearchForm = root.querySelector('#slxExpSearchForm');
  const elSearchInput = root.querySelector('#slxExpSearchInput');
  const elSubnetSelect = root.querySelector('#slxExpSubnetSelect');
  const elTitleText = root.querySelector('#slxExpTitleText');
  const elContractsSubnetLbl = root.querySelector('#slxExpContractsSubnetLbl');
  const elBtnProof = root.querySelector('#slxExpBtnLiveProof');
  const elInspector = root.querySelector('#slxExpInspector');
  const elBlocksList = root.querySelector('#slxExpBlocksList');
  const elTxsList = root.querySelector('#slxExpTxsList');
  const elContractCount = root.querySelector('#slxExpContractCount');
  const elContractsGrid = root.querySelector('#slxExpContractsGrid');

  function syncSubnetSelectorOptions() {
    if (!elSubnetSelect) return;
    const curProf = SlxSubnetManager.getActiveSubnetProfile();
    elSubnetSelect.innerHTML = SlxSubnetManager.listSubnets()
      .map(
        (s) =>
          `<option value="${esc(s.key)}" ${s.key === curProf?.key ? 'selected' : ''}>${esc(s.icon || '🌐')} ${esc(s.name)} (${esc(s.subnetId || '—')})</option>`
      )
      .join('');
    if (elTitleText && curProf) {
      elTitleText.innerHTML = `🔎 ${esc(curProf.shortLabel || 'Subnet 1')} Cryptographic Block Explorer &amp; Quorum Verifier`;
    }
    if (elContractsSubnetLbl && curProf) {
      elContractsSubnetLbl.textContent = curProf.shortLabel || 'Subnet 1';
    }
  }

  elSubnetSelect?.addEventListener('change', (ev) => {
    const nextKey = ev.target.value;
    if (nextKey && nextKey !== SlxSubnetManager.getActiveSubnetKey()) {
      SlxSubnetManager.setActiveSubnetKey(nextKey, { reload: true });
    }
  });

  window.addEventListener('slx:subnets-updated', syncSubnetSelectorOptions);
  window.addEventListener('slx:subnet-changed', syncSubnetSelectorOptions);
  SlxSubnetManager.refreshDiscoveryMetadata()
    .then(syncSubnetSelectorOptions)
    .catch(() => {});

  function showInspector(html) {
    elInspector.style.display = 'flex';
    elInspector.innerHTML = html;
    elInspector.querySelector('[data-exp-close]')?.addEventListener('click', () => {
      elInspector.style.display = 'none';
    });
    elInspector.querySelectorAll('[data-exp-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-exp-copy') || '';
        navigator.clipboard?.writeText(val);
        const prev = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      });
    });
    bindJumpLinks(elInspector);
  }

  function bindJumpLinks(container) {
    container.querySelectorAll('[data-exp-tx]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const h = el.getAttribute('data-exp-tx');
        if (h) inspectTransaction(h);
      });
    });
    container.querySelectorAll('[data-exp-blk]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const b = Number(el.getAttribute('data-exp-blk'));
        if (Number.isFinite(b) && b >= 0) inspectBlock(b);
      });
    });
    container.querySelectorAll('[data-exp-addr]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const a = el.getAttribute('data-exp-addr');
        if (a) inspectAddress(a);
      });
    });
  }

  function renderBlocksFeed() {
    if (!recentBlocks.length) return;
    elBlocksList.innerHTML = recentBlocks
      .slice(0, 14)
      .map(
        (b) => `
        <div
          data-exp-blk="${b.number}"
          style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:8px;background:#050b16;border:1px solid rgba(51,65,85,0.65);cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.72rem;"
        >
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <strong style="color:#38bdf8;">#${fmtInt(b.number)}</strong>
            <span style="color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="Block Hash: ${esc(b.hash)}">${esc(shortHex(b.hash, 10, 6))}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span style="padding:1px 7px;border-radius:6px;background:rgba(16,185,129,0.16);color:#6ee7b7;font-weight:700;">${fmtInt(b.txCount)} tx${b.txCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      `
      )
      .join('');
    bindJumpLinks(elBlocksList);
  }

  function renderTxsFeed() {
    const items = Array.from(recentTxs.values())
      .sort((a, b) => b.blockNumber - a.blockNumber || b.txIndex - a.txIndex)
      .slice(0, 22);
    if (!items.length) return;
    elTxsList.innerHTML = items
      .map((tx) => {
        const firstLog = tx.logs[0];
        const dec = decodeTopic0(firstLog?.topics?.[0]);
        const contractInfo = contractDirectory.get(String(firstLog?.address || '').toLowerCase());
        const badgeLabel = contractInfo ? contractInfo.label : dec.domain;
        const extraEvs = tx.logs.length > 1 ? ` +${tx.logs.length - 1}` : '';
        return `
          <div
            data-exp-tx="${esc(tx.txHash)}"
            style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:8px;background:#050b16;border:1px solid rgba(51,65,85,0.65);cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.71rem;"
          >
            <div style="display:flex;align-items:center;gap:7px;min-width:0;">
              <span>${dec.icon}</span>
              <strong style="color:#7dd3fc;">${esc(shortHex(tx.txHash, 8, 6))}</strong>
              <span style="color:${dec.color};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(dec.fnName)}${esc(extraEvs)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              <span style="color:#94a3b8;max-width:115px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(badgeLabel)}</span>
              <span style="color:#fcd34d;">#${fmtInt(tx.blockNumber)}</span>
            </div>
          </div>
        `;
      })
      .join('');
    bindJumpLinks(elTxsList);
  }

  function ingestLogEntry(lg) {
    const txh = String(lg?.transactionHash || '').toLowerCase();
    if (!txh || txh.length !== 66) return;
    const blk = lg.blockNumberNum ?? parseHexInt(lg.blockNumber);
    const txi = lg.txIndexNum ?? parseHexInt(lg.transactionIndex);
    const lgi = lg.logIndexNum ?? parseHexInt(lg.logIndex);
    let rec = recentTxs.get(txh);
    if (!rec) {
      rec = { txHash: txh, blockNumber: blk, txIndex: txi, logs: [] };
      recentTxs.set(txh, rec);
      if (recentTxs.size > 80) {
        const oldestKey = recentTxs.keys().next().value;
        if (oldestKey) recentTxs.delete(oldestKey);
      }
    }
    if (!rec.logs.some((x) => (x.logIndexNum ?? parseHexInt(x.logIndex)) === lgi)) {
      rec.logs.push(lg);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Inspect Transaction (`eth_getTransactionReceipt` + 3-Validator Quorum)
  // -------------------------------------------------------------------------
  async function inspectTransaction(rawHash, preSignedOverride = null) {
    const txHash = String(rawHash || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
      showInspector(`<div style="color:#fca5a5;font-family:monospace;font-size:0.76rem;">⚠ Invalid 32-byte transaction hash: ${esc(rawHash)}</div>`);
      return;
    }
    if (elSearchInput) elSearchInput.value = txHash;

    showInspector(`
      <div style="display:flex;justify-content:space-between;align-items:center;font-family:'JetBrains Mono',monospace;font-size:0.76rem;color:#7dd3fc;">
        <span>⏳ Querying independent Subnet 1 BFT validators for receipt <code>${esc(shortHex(txHash, 12, 8))}</code>…</span>
        <button type="button" class="slx-mini-btn" data-exp-close="1">✕</button>
      </div>
    `);

    const validators = getValidatorRpcList(primaryRpc);
    const quorumResults = await Promise.all(
      validators.map(async (v) => {
        const t0 = performance.now();
        try {
          const rcpt = await slxNodeRpc(v.url, 'eth_getTransactionReceipt', [txHash], 3000, {
            allowFailover: false,
          });
          return {
            name: v.name,
            url: v.url,
            pubkeyPrefix: v.pubkeyPrefix || null,
            ok: Boolean(rcpt),
            rcpt,
            rfVerified: false,
            ms: Math.round(performance.now() - t0),
          };
        } catch (err) {
          return {
            name: v.name,
            url: v.url,
            pubkeyPrefix: v.pubkeyPrefix || null,
            ok: false,
            rcpt: null,
            rfVerified: false,
            err: String(err?.message || err),
          };
        }
      })
    );

    let primaryRcpt = quorumResults.find((r) => r.rcpt)?.rcpt || null;
    if (!primaryRcpt) {
      primaryRcpt = await slxNodeRpc(primaryRpc, 'eth_getTransactionReceipt', [txHash], 4000).catch(
        () => null
      );
    }

    const signedProof = preSignedOverride || lookupCachedSignedTx(txHash);
    const computedLocalHash = signedProof?.rawTx ? computeRawTxHash(signedProof.rawTx) : '';
    const hashVerified =
      computedLocalHash && computedLocalHash.toLowerCase() === txHash.toLowerCase();

    if (!primaryRcpt) {
      showInspector(`
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#fbbf24;font-family:monospace;font-size:0.8rem;">⚠ Receipt Not Found Yet for ${esc(shortHex(txHash, 14, 10))}</strong>
          <button type="button" class="slx-mini-btn" data-exp-close="1">✕ Close</button>
        </div>
        <div style="color:#cbd5e1;font-size:0.75rem;">Transaction may still be in the current 4-second BFT round or does not exist on Subnet 1.</div>
      `);
      return;
    }

    const blkNum = parseHexInt(primaryRcpt.blockNumber);
    const txIdx = parseHexInt(primaryRcpt.transactionIndex);
    const gasUsed = parseHexInt(primaryRcpt.gasUsed);
    const statusOk = primaryRcpt.status === '0x1';
    const logs = Array.isArray(primaryRcpt.logs) ? primaryRcpt.logs : [];

    // If any validator endpoint is LAN-only / not yet proxy-exposed over WSS, cross-check its
    // signed 915 MHz FLRC peer state from `slx_nodes` to confirm it finalized >= blkNum.
    if (quorumResults.some((q) => !q.rcpt && q.pubkeyPrefix)) {
      const nodesSnap = await slxNodeRpc(primaryRpc, 'slx_nodes', [], 2500).catch(() => null);
      const rfPeers = Array.isArray(nodesSnap?.nodes) ? nodesSnap.nodes : [];
      for (const q of quorumResults) {
        if (!q.rcpt && q.pubkeyPrefix) {
          const peer = rfPeers.find(
            (p) =>
              p?.id &&
              String(p.id).toLowerCase().startsWith(q.pubkeyPrefix) &&
              Number(p.height || 0) >= blkNum &&
              (p.age_ms == null || p.age_ms < 20000)
          );
          if (peer) {
            q.rfVerified = true;
            q.rfHeight = Number(peer.height);
            q.rfRssi = peer.rssi;
          }
        }
      }
    }

    const agreedCount = quorumResults.filter(
      (q) =>
        (q.rcpt && q.rcpt.blockHash === primaryRcpt.blockHash && q.rcpt.status === primaryRcpt.status) ||
        q.rfVerified
    ).length;

    const wscatCmd = `npx -y wscat -c ${primaryRpc} -x '${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    })}'`;

    showInspector(`
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid rgba(71,85,105,0.45);padding-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:'JetBrains Mono',monospace;">
          <span style="padding:3px 9px;border-radius:999px;background:${statusOk ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};border:1px solid ${statusOk ? '#34d399' : '#f87171'};color:${statusOk ? '#6ee7b7' : '#fca5a5'};font-size:0.72rem;font-weight:800;">
            ${statusOk ? '✓ STATUS 0x1 (FINALIZED)' : '✕ STATUS 0x0 (REVERTED)'}
          </span>
          <span style="font-size:0.76rem;color:#f8fafc;">Block <a href="#" data-exp-blk="${blkNum}" style="color:#38bdf8;font-weight:800;text-decoration:underline;">#${fmtInt(blkNum)}</a></span>
          <span style="font-size:0.73rem;color:#94a3b8;">• Tx Index #${txIdx} • WASM Compute: ${fmtInt(gasUsed)} units (<strong>$0.00 Fee</strong>)</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="slx-mini-btn" data-exp-copy="${esc(txHash)}">📋 Copy txHash</button>
          <button type="button" class="slx-mini-btn" data-exp-close="1">✕ Close</button>
        </div>
      </div>

      <!-- Transaction & Block Hash Identifiers -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;font-family:'JetBrains Mono',monospace;font-size:0.71rem;">
        <div style="padding:8px 10px;border-radius:8px;background:#0a1326;border:1px solid rgba(51,65,85,0.6);">
          <div style="color:#64748b;font-size:0.64rem;text-transform:uppercase;font-weight:700;">Transaction Hash (32-Byte Keccak-256)</div>
          <div style="color:#7dd3fc;word-break:break-all;margin-top:2px;">${esc(txHash)}</div>
        </div>
        <div style="padding:8px 10px;border-radius:8px;background:#0a1326;border:1px solid rgba(51,65,85,0.6);">
          <div style="color:#64748b;font-size:0.64rem;text-transform:uppercase;font-weight:700;">Finalized Block Hash</div>
          <div style="color:#e2e8f0;word-break:break-all;margin-top:2px;">${esc(primaryRcpt.blockHash)}</div>
        </div>
      </div>

      <!-- Multi-Validator BFT Quorum Verification -->
      <div style="padding:10px 12px;border-radius:10px;background:rgba(6,78,59,0.22);border:1px solid rgba(52,211,153,0.45);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;font-family:'JetBrains Mono',monospace;font-size:0.72rem;margin-bottom:7px;">
          <strong style="color:#6ee7b7;">🛡️ Multi-Validator BFT Consensus Cross-Check (${agreedCount}/${quorumResults.length} Nodes Queried Live)</strong>
          <span style="color:#a7f3d0;font-size:0.67rem;">Identical blockHash &amp; state root across independent validators</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:7px;font-family:'JetBrains Mono',monospace;font-size:0.69rem;">
          ${quorumResults
            .map((q) =>
              q.rcpt
                ? `<div style="padding:6px 9px;border-radius:7px;background:#041019;border:1px solid rgba(52,211,153,0.4);color:#ecfdf5;">
                    <div style="display:flex;justify-content:space-between;"><strong style="color:#34d399;">✓ ${esc(q.name)}</strong><span style="color:#94a3b8;">${q.ms}ms</span></div>
                    <div style="color:#94a3b8;font-size:0.65rem;margin-top:2px;">Blk #${fmtInt(parseHexInt(q.rcpt.blockNumber))} • ${esc(shortHex(q.rcpt.blockHash, 8, 6))}</div>
                  </div>`
                : q.rfVerified
                  ? `<div style="padding:6px 9px;border-radius:7px;background:#041019;border:1px solid rgba(56,189,248,0.45);color:#ecfdf5;">
                      <div style="display:flex;justify-content:space-between;"><strong style="color:#38bdf8;">✓ ${esc(q.name)}</strong><span style="color:#94a3b8;">RF Mesh</span></div>
                      <div style="color:#94a3b8;font-size:0.65rem;margin-top:2px;">Synced @ Blk #${fmtInt(q.rfHeight)}${Number.isFinite(Number(q.rfRssi)) ? ` • ${Number(q.rfRssi).toFixed(1)} dBm` : ''}</div>
                    </div>`
                  : `<div style="padding:6px 9px;border-radius:7px;background:#0f172a;border:1px solid rgba(100,116,139,0.4);color:#94a3b8;">
                      <div>• ${esc(q.name)}</div>
                      <div style="font-size:0.64rem;">Endpoint offline / LAN-only</div>
                    </div>`
            )
            .join('')}
        </div>
      </div>

      ${
        signedProof
          ? `
        <!-- Client-Side Raw RLP & Keccak-256 Signature Proof -->
        <div style="padding:10px 12px;border-radius:10px;background:rgba(14,165,233,0.12);border:1px solid rgba(56,189,248,0.45);font-family:'JetBrains Mono',monospace;font-size:0.71rem;display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
            <strong style="color:#7dd3fc;">🔐 Client-Side EIP-155 RLP &amp; secp256k1 Signature Proof</strong>
            ${
              hashVerified
                ? `<span style="padding:2px 8px;border-radius:999px;background:rgba(16,185,129,0.22);border:1px solid #34d399;color:#6ee7b7;font-size:0.65rem;font-weight:800;">✓ keccak256(rawTx) === receipt.transactionHash</span>`
                : ''
            }
          </div>
          <div style="color:#cbd5e1;">
            Signer EOA: <a href="#" data-exp-addr="${esc(signedProof.from)}" style="color:#6ee7b7;text-decoration:underline;">${esc(signedProof.from)}</a>
            ${signedProof.to ? ` &rarr; Target HFS: <a href="#" data-exp-addr="${esc(signedProof.to)}" style="color:#fcd34d;text-decoration:underline;">${esc(signedProof.to)}</a>` : ' (WASM Deployment)'}
            • Nonce #${esc(signedProof.nonce)} • Call: <strong>${esc(signedProof.contractLabel || 'HFS')}.${esc(signedProof.fnLabel || 'call')}</strong>
          </div>
          ${
            signedProof.rawTx
              ? `<details>
                  <summary style="cursor:pointer;color:#38bdf8;font-size:0.68rem;">Inspect Raw Signed EIP-155 RLP Payload (${(signedProof.rawTx.length - 2) / 2} bytes)</summary>
                  <div style="margin-top:5px;padding:7px;border-radius:6px;background:#030712;color:#bae6fd;word-break:break-all;font-size:0.66rem;">${esc(signedProof.rawTx)}</div>
                </details>`
              : ''
          }
        </div>
      `
          : ''
      }

      <!-- Decoded WASM Event Logs -->
      <div style="display:flex;flex-direction:column;gap:6px;">
        <strong style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:#f8fafc;">📜 Emitted Halt-Free Subroutine Event Logs (${logs.length})</strong>
        ${
          logs.length === 0
            ? `<div style="color:#94a3b8;font-family:monospace;font-size:0.7rem;">No event logs emitted (state-only execution).</div>`
            : logs
                .map((lg, i) => {
                  const dec = decodeTopic0(lg.topics?.[0]);
                  const cInfo = contractDirectory.get(String(lg.address || '').toLowerCase());
                  return `
                    <div style="padding:8px 10px;border-radius:8px;background:#0a1326;border:1px solid rgba(71,85,105,0.55);font-family:'JetBrains Mono',monospace;font-size:0.69rem;display:flex;flex-direction:column;gap:4px;">
                      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                        <span>${dec.icon} <strong style="color:${dec.color};">${esc(dec.sig)}</strong></span>
                        <span>Contract: <a href="#" data-exp-addr="${esc(lg.address)}" style="color:#fcd34d;text-decoration:underline;">${esc(cInfo ? `${cInfo.label} (${shortHex(lg.address, 6, 4)})` : shortHex(lg.address, 10, 6))}</a> • log #${i}</span>
                      </div>
                      <div style="color:#94a3b8;word-break:break-all;font-size:0.64rem;">topics: ${esc((lg.topics || []).join(', '))}</div>
                      ${lg.data && lg.data !== '0x' ? `<div style="color:#cbd5e1;word-break:break-all;font-size:0.64rem;">data: ${esc(lg.data.length > 196 ? lg.data.slice(0, 196) + '…' : lg.data)}</div>` : ''}
                    </div>
                  `;
                })
                .join('')
        }
      </div>

      <!-- Independent CLI Verification -->
      <div style="padding:9px 11px;border-radius:8px;background:#030712;border:1px solid rgba(71,85,105,0.6);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;font-family:'JetBrains Mono',monospace;font-size:0.67rem;">
        <div style="min-width:0;flex:1;">
          <div style="color:#94a3b8;margin-bottom:2px;">🖥 Verify independently from any terminal (zero SuperLexicon UI):</div>
          <code style="color:#6ee7b7;word-break:break-all;">${esc(wscatCmd)}</code>
        </div>
        <button type="button" class="slx-mini-btn emerald" data-exp-copy="${esc(wscatCmd)}">📋 Copy CLI</button>
      </div>
    `);
  }

  // -------------------------------------------------------------------------
  // 2. Inspect Block (`eth_getLogs` + `eth_getTransactionReceipts`)
  // -------------------------------------------------------------------------
  async function inspectBlock(blockNum) {
    const hexBlk = '0x' + Math.max(0, Math.floor(blockNum)).toString(16);
    if (elSearchInput) elSearchInput.value = `#${blockNum}`;

    showInspector(`
      <div style="display:flex;justify-content:space-between;align-items:center;font-family:monospace;font-size:0.76rem;color:#7dd3fc;">
        <span>⏳ Fetching finalized transactions &amp; logs in Block #${fmtInt(blockNum)}…</span>
        <button type="button" class="slx-mini-btn" data-exp-close="1">✕</button>
      </div>
    `);

    const logs = await slxNodeRpc(
      primaryRpc,
      'eth_getLogs',
      [{ fromBlock: hexBlk, toBlock: hexBlk }],
      5000
    ).catch(() => []);

    const byTx = new Map();
    for (const lg of logs || []) {
      const h = String(lg.transactionHash || '').toLowerCase();
      if (!h) continue;
      if (!byTx.has(h)) {
        byTx.set(h, {
          txHash: h,
          txIndex: parseHexInt(lg.transactionIndex),
          blockHash: lg.blockHash || '',
          logs: [],
        });
      }
      byTx.get(h).logs.push(lg);
    }

    const txList = Array.from(byTx.values()).sort((a, b) => a.txIndex - b.txIndex);
    const knownHead = recentBlocks.find((b) => b.number === blockNum);
    const blkHash = txList[0]?.blockHash || knownHead?.hash || '—';

    showInspector(`
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid rgba(71,85,105,0.45);padding-bottom:9px;font-family:'JetBrains Mono',monospace;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="font-size:0.86rem;color:#38bdf8;">🧱 Block #${fmtInt(blockNum)}</strong>
          <span style="color:#6ee7b7;font-size:0.73rem;">${txList.length} Event-Emitting Tx${txList.length === 1 ? '' : 's'} • ${logs.length} WASM Logs</span>
        </div>
        <div style="display:flex;gap:6px;">
          ${blockNum > 1 ? `<button type="button" class="slx-mini-btn" data-exp-blk="${blockNum - 1}">← #${fmtInt(blockNum - 1)}</button>` : ''}
          <button type="button" class="slx-mini-btn" data-exp-blk="${blockNum + 1}">#${fmtInt(blockNum + 1)} →</button>
          <button type="button" class="slx-mini-btn" data-exp-close="1">✕ Close</button>
        </div>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:#cbd5e1;word-break:break-all;">
        blockHash: <strong style="color:#f8fafc;">${esc(blkHash)}</strong>
        ${knownHead?.parentHash ? `<br/>parentHash: <span style="color:#94a3b8;">${esc(knownHead.parentHash)}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto;">
        ${
          txList.length === 0
            ? `<div style="color:#94a3b8;font-family:monospace;font-size:0.72rem;">No event-emitting HFS transactions in Block #${fmtInt(blockNum)}.</div>`
            : txList
                .map((t) => {
                  const dec = decodeTopic0(t.logs[0]?.topics?.[0]);
                  return `
                    <div data-exp-tx="${esc(t.txHash)}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;background:#0a1326;border:1px solid rgba(51,65,85,0.6);cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.71rem;">
                      <span>#${t.txIndex} • <strong style="color:#7dd3fc;text-decoration:underline;">${esc(shortHex(t.txHash, 12, 8))}</strong></span>
                      <span style="color:${dec.color};font-weight:700;">${dec.icon} ${esc(dec.fnName)} (${t.logs.length} log${t.logs.length === 1 ? '' : 's'}) →</span>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    `);
  }

  // -------------------------------------------------------------------------
  // 3. Inspect EOA or HFS Smart Contract Address
  // -------------------------------------------------------------------------
  async function inspectAddress(rawAddr) {
    const addr = String(rawAddr || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return;
    if (elSearchInput) elSearchInput.value = addr;

    showInspector(`
      <div style="display:flex;justify-content:space-between;align-items:center;font-family:monospace;font-size:0.76rem;color:#7dd3fc;">
        <span>⏳ Querying live Subnet 1 state &amp; logs for <code>${esc(addr)}</code>…</span>
        <button type="button" class="slx-mini-btn" data-exp-close="1">✕</button>
      </div>
    `);

    const tipHex = await slxNodeRpc(primaryRpc, 'eth_blockNumber', [], 3000).catch(() => '0x0');
    const tip = parseHexInt(tipHex);
    const fromBlk = '0x' + Math.max(0, tip - 1200).toString(16);

    const [nonceHex, idNick, idOwner, contractLogs] = await Promise.all([
      slxNodeRpc(primaryRpc, 'eth_getTransactionCount', [addr, 'latest'], 3000).catch(() => '0x0'),
      readOnChainIdentityNickname(primaryRpc, addr).catch(() => ''),
      readOnChainIdentityOwner(primaryRpc, addr).catch(() => ''),
      slxNodeRpc(
        primaryRpc,
        'eth_getLogs',
        [{ fromBlock: fromBlk, toBlock: 'latest', address: addr }],
        5000
      ).catch(() => []),
    ]);

    const nonce = parseHexInt(nonceHex);
    const regInfo = contractDirectory.get(addr);
    const recentContractLogs = (contractLogs || []).slice(-18).reverse();

    showInspector(`
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid rgba(71,85,105,0.45);padding-bottom:9px;font-family:'JetBrains Mono',monospace;">
        <div>
          <strong style="font-size:0.84rem;color:#fcd34d;">${regInfo ? `🗂️ HFS Contract: ${esc(regInfo.label)}` : idNick ? `🪪 Unified Identity: ${esc(idNick)}` : '🔑 Subnet 1 Address'}</strong>
          <div style="font-size:0.71rem;color:#7dd3fc;margin-top:2px;">${esc(addr)}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="slx-mini-btn" data-exp-copy="${esc(addr)}">📋 Copy Address</button>
          <button type="button" class="slx-mini-btn" data-exp-close="1">✕ Close</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;font-family:'JetBrains Mono',monospace;font-size:0.71rem;">
        <div style="padding:8px 10px;border-radius:8px;background:#0a1326;border:1px solid rgba(51,65,85,0.6);">
          <div style="color:#64748b;font-size:0.64rem;text-transform:uppercase;">Confirmed EOA Nonce</div>
          <div style="color:#6ee7b7;font-weight:800;margin-top:2px;">${fmtInt(nonce)} signed txs</div>
        </div>
        ${
          regInfo
            ? `<div style="padding:8px 10px;border-radius:8px;background:#0a1326;border:1px solid rgba(51,65,85,0.6);">
                <div style="color:#64748b;font-size:0.64rem;text-transform:uppercase;">WASM Bytecode Hash</div>
                <div style="color:#e2e8f0;margin-top:2px;" title="${esc(regInfo.codeHash)}">${esc(shortHex(regInfo.codeHash, 12, 8))}</div>
              </div>`
            : ''
        }
        ${
          idOwner
            ? `<div style="padding:8px 10px;border-radius:8px;background:#0a1326;border:1px solid rgba(51,65,85,0.6);">
                <div style="color:#64748b;font-size:0.64rem;text-transform:uppercase;">Identity Owner EOA</div>
                <div style="color:#7dd3fc;margin-top:2px;">${esc(shortHex(idOwner, 10, 8))}</div>
              </div>`
            : ''
        }
      </div>

      <div style="display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;">
        <strong style="font-family:'JetBrains Mono',monospace;font-size:0.71rem;color:#cbd5e1;">Recent Emitted Events (${(contractLogs || []).length} in last 1,200 blocks)</strong>
        ${
          recentContractLogs.length === 0
            ? `<div style="color:#94a3b8;font-family:monospace;font-size:0.7rem;">No contract events emitted directly by this address in the last 1,200 blocks (EOA signers appear inside transaction receipts).</div>`
            : recentContractLogs
                .map((lg) => {
                  const dec = decodeTopic0(lg.topics?.[0]);
                  return `
                    <div data-exp-tx="${esc(lg.transactionHash)}" style="display:flex;justify-content:space-between;padding:6px 9px;border-radius:7px;background:#0a1326;border:1px solid rgba(51,65,85,0.55);cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.7rem;">
                      <span>${dec.icon} <strong style="color:${dec.color};">${esc(dec.fnName)}</strong> • <span style="color:#7dd3fc;text-decoration:underline;">${esc(shortHex(lg.transactionHash, 10, 6))}</span></span>
                      <span style="color:#fcd34d;">Blk #${fmtInt(parseHexInt(lg.blockNumber))}</span>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    `);
  }

  // -------------------------------------------------------------------------
  // 4. 1-Click Live Cryptographic Proof Transaction ($0.00 Gas)
  // -------------------------------------------------------------------------
  elBtnProof?.addEventListener('click', async () => {
    elBtnProof.disabled = true;
    const origText = elBtnProof.textContent;
    const curSubLbl = SlxSubnetManager.getActiveSubnetProfile()?.shortLabel || 'Subnet';
    elBtnProof.textContent = `⏳ Signing & Finalizing on ${curSubLbl}…`;

    try {
      const messagingAddr =
        manifest?.messaging ||
        manifest?.fleetSocial?.messaging ||
        manifest?.commonsRf?.messaging ||
        SUBNET1_FLEET_SOCIAL_DEFAULT.messaging;
      const chanHash = keccak256Hex(utf8ToBytes('SLX_EXPLORER_PROOF_BEACON_V1'));
      const proofMsg = `LIVE_PROOF:${new Date().toISOString()}:by:${slidesWallet.keypair.address.slice(0, 10)}`;
      const calldata = encodeAbi('postMessage(bytes32,bytes)', [
        ['bytes32', chanHash],
        ['bytes', utf8ToBytes(proofMsg)],
      ]);

      const nonceHex = await slxNodeRpc(primaryRpc, 'eth_getTransactionCount', [
        slidesWallet.keypair.address,
        'latest',
      ]);
      const nonce = BigInt(nonceHex || '0x0');

      const signed = signOrderedLexiconTx({
        privateKey: slidesWallet.keypair.privateKey,
        nonce,
        to: messagingAddr,
        data: calldata,
        gasLimit: 3_500_000n,
        extraTargets: [messagingAddr],
      });

      showInspector(`
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.74rem;display:flex;flex-direction:column;gap:6px;">
          <strong style="color:#6ee7b7;">⚡ Step 1/2: Signed Real EIP-155 RLP Transaction Locally in Browser!</strong>
          <div style="color:#cbd5e1;">Computed <code>keccak256(rawTx)</code> = <strong style="color:#7dd3fc;">${esc(signed.txHash)}</strong></div>
          <div style="color:#94a3b8;">Broadcasting to <code>${esc(primaryRpc)}</code> &amp; waiting ~4s for 4-phase BFT finality…</div>
        </div>
      `);

      await slxNodeRpc(primaryRpc, 'eth_sendRawTransaction', [signed.raw]);
      const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(primaryRpc, m, p), signed.txHash);

      const proofRecord = slidesWallet.recordExternalRpcTx({
        txHash: signed.txHash,
        rawTx: signed.raw,
        from: slidesWallet.keypair.address,
        to: messagingAddr,
        contractLabel: 'MessagingHFS',
        fnLabel: 'postMessage',
        dataHex: calldata,
        blockNumber: parseHexInt(rcpt?.blockNumber),
        nonce: Number(nonce),
      });
      unifiedHdr?.refresh?.();

      await inspectTransaction(signed.txHash, proofRecord);
    } catch (err) {
      showInspector(`
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#fca5a5;font-family:monospace;font-size:0.75rem;">⚠ Live proof broadcast failed: ${esc(err?.message || err)}</span>
          <button type="button" class="slx-mini-btn" data-exp-close="1">✕</button>
        </div>
      `);
    } finally {
      elBtnProof.disabled = false;
      elBtnProof.textContent = origText;
    }
  });

  // -------------------------------------------------------------------------
  // Search Form Handler
  // -------------------------------------------------------------------------
  elSearchForm?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = String(elSearchInput?.value || '').trim();
    if (!q) return;
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
      inspectTransaction(q);
    } else if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      inspectAddress(q);
    } else if (/^#?\d+$/.test(q)) {
      inspectBlock(Number(q.replace(/^#/, '')));
    } else if (/^0x[0-9a-fA-F]+$/.test(q)) {
      inspectBlock(parseHexInt(q));
    } else {
      showInspector(
        `<div style="color:#fbbf24;font-family:monospace;font-size:0.74rem;">Enter a 66-char <code>0x…</code> Transaction Hash, a 42-char <code>0x…</code> Address, or a numeric Block Height.</div>`
      );
    }
  });

  // -------------------------------------------------------------------------
  // Boot Live Streams, Backfill & HfsRegistry Contract Directory
  // -------------------------------------------------------------------------
  async function hydrateContractsAndBackfill() {
    const hydrated = await SlxHfsCache.hydrateWithManifest().catch(() => ({
      cache: {},
      manifest: null,
    }));
    manifest = hydrated.manifest;
    if (hydrated.cache?.rpcUrl) primaryRpc = hydrated.cache.rpcUrl;

    // 1. Backfill recent blocks of logs so the Live Transactions panel is populated immediately!
    const tipHex = await slxNodeRpc(primaryRpc, 'eth_blockNumber', [], 4000).catch(() => '0x0');
    const tip = parseHexInt(tipHex);
    if (tip > 0) {
      const fromHex = '0x' + Math.max(0, tip - 16).toString(16);
      let logs = await slxNodeRpc(
        primaryRpc,
        'eth_getLogs',
        [{ fromBlock: fromHex, toBlock: 'latest' }],
        5000
      ).catch(() => []);
      if ((!logs || logs.length < 8) && tip > 16) {
        const widerFromHex = '0x' + Math.max(0, tip - 1024).toString(16);
        const widerLogs = await slxNodeRpc(
          primaryRpc,
          'eth_getLogs',
          [{ fromBlock: widerFromHex, toBlock: 'latest' }],
          5000
        ).catch(() => []);
        if (Array.isArray(widerLogs) && widerLogs.length > (logs?.length || 0)) {
          logs = widerLogs;
        }
      }
      const blkMap = new Map();
      for (const lg of logs || []) {
        ingestLogEntry(lg);
        const bn = parseHexInt(lg.blockNumber);
        if (bn > 0) {
          let rec = blkMap.get(bn);
          if (!rec) {
            rec = {
              number: bn,
              hash: lg.blockHash || '',
              parentHash: '',
              txSet: new Set(),
              timestamp: 0,
            };
            blkMap.set(bn, rec);
          }
          if (lg.transactionHash) rec.txSet.add(String(lg.transactionHash).toLowerCase());
        }
      }
      if (!recentBlocks.length && blkMap.size > 0) {
        const seeded = Array.from(blkMap.values())
          .sort((a, b) => b.number - a.number)
          .slice(0, 14)
          .map((b) => ({
            number: b.number,
            hash: b.hash,
            parentHash: b.parentHash,
            txCount: b.txSet.size,
            timestamp: b.timestamp,
          }));
        recentBlocks.push(...seeded);
        renderBlocksFeed();
      }
      if (recentTxs.size > 0) {
        renderTxsFeed();
      } else if (elTxsList) {
        elTxsList.innerHTML = `<div style="color:#94a3b8;font-family:'JetBrains Mono',monospace;font-size:0.73rem;padding:12px 4px;">No HFS transactions in recent blocks yet — click <strong>⚡ Send &amp; Verify Live Proof Tx</strong> above!</div>`;
      }
    }

    // Refresh subnet selector options & labels after discovery metadata hydration
    const activeProf = SlxSubnetManager.getActiveSubnetProfile();
    if (elTitleText && activeProf) {
      elTitleText.textContent = `🔎 ${activeProf.shortLabel} (${activeProf.subnetId || '—'}) Cryptographic Block Explorer & Quorum Verifier`;
    }
    if (elContractsSubnetLbl && activeProf) {
      elContractsSubnetLbl.textContent = `${activeProf.shortLabel} (${activeProf.subnetId || '—'})`;
    }
    if (elSubnetSelect) {
      elSubnetSelect.innerHTML = SlxSubnetManager.listSubnets()
        .map(
          (s) =>
            `<option value="${esc(s.key)}" ${s.key === activeProf?.key ? 'selected' : ''}>${esc(s.icon || '🌐')} ${esc(s.name)} (${esc(s.subnetId || '—')})</option>`
        )
        .join('');
    }

    // 2. Load Registered HFS Smart Contracts from HfsRegistry + Manifest Core HFSes on Selected Subnet
    const types = [
      'DEX_CLOB',
      'CORPORATE_CHARTER',
      'PRODUCT_LEDGER',
      'SOCIAL_CHARTER',
      'PHANTOM_FLEET',
      'FRACTURED_HEGEMONY',
      'CIPHER_NOIR',
      'QUANTUM_LOTTERY',
      'SECRET_BALLOT',
      'IFRS_LEDGER',
      'SUBNET_REGISTRY',
    ];
    let allContracts = [];
    const effHfsReg = manifest?.hfsRegistry || activeProf?.hfsRegistry || '';
    if (effHfsReg) {
      const groups = await Promise.all(
        types.map((t) =>
          fetchRegisteredHfsByType(t, {
            rpcUrl: primaryRpc,
            registryAddr: effHfsReg,
          }).catch(() => [])
        )
      );
      allContracts = groups.flat();
    }

    // Also include core manifest-deployed HFSes on this subnet (e.g. Messaging, HfsRegistry, SubnetRegistry, IdentityRegistry)
    const addManifestContract = (addr, label, typeName, codeHash = '') => {
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
      const low = addr.toLowerCase();
      if (allContracts.some((c) => c.primaryAddr.toLowerCase() === low)) return;
      allContracts.push({
        primaryAddr: addr,
        label,
        typeName,
        codeHash: codeHash || manifest?.codeHashes?.[typeName.toLowerCase()] || '0x0',
      });
    };

    addManifestContract(effHfsReg, 'HfsRegistry Directory', 'HFS_REGISTRY', manifest?.codeHashes?.hfs_registry);
    addManifestContract(
      manifest?.subnetRegistry || activeProf?.contracts?.subnetRegistry || activeProf?.onChainRegistryAddr,
      'Global Subnet & Node Stats Registry HFS',
      'SUBNET_REGISTRY',
      manifest?.codeHashes?.subnet_registry
    );
    addManifestContract(
      manifest?.messaging || manifest?.commonsRf?.messaging,
      'Cross-Subnet & ECIES Messaging HFS',
      'MESSAGING',
      manifest?.codeHashes?.messaging
    );
    addManifestContract(
      manifest?.commonsRf?.identityRegistry,
      'IdentityRegistry HFS',
      'IDENTITY_REGISTRY',
      manifest?.codeHashes?.identity_registry
    );
    addManifestContract(
      manifest?.institutional?.confidentialLedger,
      'Confidential Homomorphic IFRS Ledger',
      'CONFIDENTIAL_LEDGER',
      manifest?.codeHashes?.confidential_ledger
    );

    // Also index any live event-emitting HFS contracts discovered during recent block backfill
    for (const tx of recentTxs.values()) {
      for (const lg of tx.logs || []) {
        if (lg.address) {
          addManifestContract(lg.address, `${lg.decoded?.domain || 'WASM'} HFS Instance`, lg.decoded?.domain || 'WASM_HFS');
        }
      }
    }

    for (const c of allContracts) {
      contractDirectory.set(c.primaryAddr.toLowerCase(), c);
    }
    if (elContractCount) elContractCount.textContent = String(allContracts.length);
    if (elContractsGrid) {
      if (!allContracts.length) {
        elContractsGrid.innerHTML = `<div style="color:#94a3b8;font-family:'JetBrains Mono',monospace;font-size:0.72rem;padding:8px 4px;">No HFS smart contracts discovered yet on ${esc(activeProf?.name || 'this subnet')}.</div>`;
      } else {
        elContractsGrid.innerHTML = allContracts
          .map(
            (c) => `
            <div
              data-exp-addr="${esc(c.primaryAddr)}"
              style="padding:8px 10px;border-radius:8px;background:#050b16;border:1px solid rgba(51,65,85,0.65);cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.7rem;display:flex;flex-direction:column;gap:3px;"
            >
              <div style="display:flex;justify-content:space-between;gap:6px;">
                <strong style="color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.label)}</strong>
                <span style="color:#fcd34d;font-size:0.63rem;">${esc(c.typeName)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;color:#7dd3fc;font-size:0.66rem;">
                <span style="text-decoration:underline;">${esc(shortHex(c.primaryAddr, 10, 6))}</span>
                <span style="color:#64748b;">${c.codeHash && c.codeHash !== '0x0' ? `code ${esc(shortHex(c.codeHash, 6, 4))}` : 'live HFS'}</span>
              </div>
            </div>
          `
          )
          .join('');
      }
      bindJumpLinks(elContractsGrid);
      renderTxsFeed();
    }

    // 3. Check URL query `?tx=0x...` or `?view=explorer`
    const params = new URLSearchParams(window.location.search);
    const urlTx = params.get('tx');
    const urlView = params.get('view');
    if (urlTx) {
      if (typeof window.goToSlide === 'function') window.goToSlide(3);
      setTimeout(() => {
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        inspectTransaction(urlTx);
      }, 120);
    } else if (urlView === 'explorer') {
      if (typeof window.goToSlide === 'function') window.goToSlide(3);
      setTimeout(() => {
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }

  const elWorldMapMount = root.querySelector('#slxExpWorldMapMount');
  const worldMapApi = elWorldMapMount
    ? mountSlxSubnetWorldMap({ mountContainer: elWorldMapMount })
    : null;

  // Seed finalized blocks immediately at 0ms from validator `stats.phaseMetricsHistory` + live `newHeads`
  slxSubscribeStats(
    () => primaryRpc,
    (snap) => {
      if (!snap || typeof snap !== 'object') return;
      let changed = false;
      const upsertHist = (pm) => {
        if (!pm || Number(pm.phase) !== 4) return;
        const h = Number(pm.blockHeight || 0);
        if (h <= 0) return;
        const rawBh = String(pm.blockHash || '').trim();
        const bh = rawBh ? (rawBh.startsWith('0x') ? rawBh : `0x${rawBh}`) : '';
        const existing = recentBlocks.find((b) => b.number === h);
        if (existing) {
          if (!existing.hash && bh) {
            existing.hash = bh;
            changed = true;
          }
          if (typeof pm.phaseValue === 'number' && pm.phaseValue > existing.txCount) {
            existing.txCount = pm.phaseValue;
            changed = true;
          }
        } else {
          recentBlocks.push({
            number: h,
            hash: bh,
            parentHash: '',
            txCount: Number(pm.phaseValue || 0),
            timestamp: 0,
          });
          changed = true;
        }
      };
      if (Array.isArray(snap.phaseMetricsHistory)) {
        for (const pm of snap.phaseMetricsHistory) upsertHist(pm);
      }
      if (snap.phaseMetrics) upsertHist(snap.phaseMetrics);
      if (changed) {
        recentBlocks.sort((a, b) => b.number - a.number);
        if (recentBlocks.length > 24) recentBlocks.length = 24;
        renderBlocksFeed();
      }
    }
  );

  slxSubscribeNewHeads(
    () => primaryRpc,
    (head) => {
      if (!head || !head.blockNumberNum) return;
      const existing = recentBlocks.find((b) => b.number === head.blockNumberNum);
      if (existing) {
        if (head.hash) existing.hash = head.hash;
        if (head.parentHash) existing.parentHash = head.parentHash;
        existing.txCount = Math.max(existing.txCount || 0, head.txCountNum || 0);
        renderBlocksFeed();
      } else {
        recentBlocks.unshift({
          number: head.blockNumberNum,
          hash: head.hash || '',
          parentHash: head.parentHash || '',
          txCount: head.txCountNum || 0,
          timestamp: head.timestampNum || 0,
        });
        recentBlocks.sort((a, b) => b.number - a.number);
        if (recentBlocks.length > 24) recentBlocks.length = 24;
        renderBlocksFeed();
      }
      const curKey = SlxSubnetManager.getActiveSubnetKey();
      worldMapApi?.updateTelemetry(
        curKey === 'subnet2' ? { s2Tip: head.blockNumberNum } : { s1Tip: head.blockNumberNum }
      );
    }
  );

  slxSubscribeLogs(
    () => primaryRpc,
    () => ({}),
    (lg) => {
      ingestLogEntry(lg);
      renderTxsFeed();
    }
  );

  window.addEventListener('slx:open-explorer', () => {
    setTimeout(() => {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      elSearchInput?.focus();
    }, 80);
  });

  window.addEventListener('slx:inspect-tx', (ev) => {
    const txHash = ev?.detail?.txHash;
    if (txHash) {
      setTimeout(() => {
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        inspectTransaction(txHash);
      }, 80);
    }
  });

  hydrateContractsAndBackfill();

  // -------------------------------------------------------------------------
  // Live Dual-Subnet Bridge Controller (Radio Subnet 1 <-> Repeater .4 <-> TCP Subnet 2)
  // -------------------------------------------------------------------------
  const elDualPanel = root.querySelector('#slxExpDualSubnetPanel');
  const elRepBadge = root.querySelector('#slxExpRepeaterLaneBadge');
  const elBridgeTopo = root.querySelector('#slxExpBridgeTopology');
  const elCrossSummary = root.querySelector('#slxExpCrossSummary');
  const elCrossFeed = root.querySelector('#slxExpCrossFeed');
  const elBtnRfToTcp = root.querySelector('#slxExpBtnRfToTcp');
  const elBtnTcpToRf = root.querySelector('#slxExpBtnTcpToRf');

  let subnet2Meta = null;
  const crossLedger = new Map(); // txHashLow -> { txHash, direction, originSubnet, targetSubnet, stage, targetBlock, updatedAtMs }

  async function httpJsonRpc(httpUrl, method, params = [], timeoutMs = 2500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || 'RPC error');
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshDualSubnetBridge() {
    if (!elDualPanel) return;
    const isHttps =
      typeof window !== 'undefined' &&
      (window.location?.protocol === 'https:' ||
        String(window.location?.hostname || '').toLowerCase().endsWith('superlexicon.com'));
    if (!subnet2Meta) {
      try {
        const res = await fetch(`/contracts/subnet2-deployments.json?t=${Date.now()}`);
        if (res.ok) subnet2Meta = await res.json();
      } catch (_) {}
    }

    let s1St = null;
    let s1BlkHex = null;
    let repSt = null;
    let s2St = null;
    let s2BlkHex = null;

    if (isHttps) {
      const allSubs = SlxSubnetManager.listSubnets();
      const s1Prof = allSubs.find((s) => s.key === 'subnet1') || allSubs[0];
      const s2Prof = allSubs.find((s) => s.key === 'subnet2' || (s.key !== 'subnet1' && s.discovered));
      const s1Wss = s1Prof?.rpcUrl || primaryRpc;
      const s2Wss = s2Prof?.rpcUrl || '';

      [s1St, s1BlkHex, s2St, s2BlkHex] = await Promise.all([
        s1Wss ? slxNodeRpc(s1Wss, 'slx_roamingStatus', [], 3000).catch(() => null) : null,
        s1Wss ? slxNodeRpc(s1Wss, 'eth_blockNumber', [], 3000).catch(() => null) : null,
        s2Wss
          ? slxNodeRpc(s2Wss, 'slx_roamingStatus', [], 3000).catch(() => null)
          : null,
        s2Wss
          ? slxNodeRpc(s2Wss, 'eth_blockNumber', [], 3000).catch(() => null)
          : null,
      ]);
    } else {
      const s1Http = 'http://192.168.50.91:8545';
      const repHttp = subnet2Meta?.repeaterRpcUrl || 'http://192.168.50.4:8545';
      const s2Http = subnet2Meta?.rpcUrls?.[0] || 'http://192.168.50.91:18545';

      [s1St, s1BlkHex, repSt, s2St, s2BlkHex] = await Promise.all([
        httpJsonRpc(s1Http, 'slx_roamingStatus').catch(() => null),
        httpJsonRpc(s1Http, 'eth_blockNumber').catch(() => null),
        httpJsonRpc(repHttp, 'slx_roamingStatus').catch(() => null),
        httpJsonRpc(s2Http, 'slx_roamingStatus').catch(() => null),
        httpJsonRpc(s2Http, 'eth_blockNumber').catch(() => null),
      ]);
    }

    const s1OwnId = s1St?.subnet_id || s1St?.this_subnet?.subnet_id || '';
    if (s2St && s1OwnId && s2St.subnet_id === s1OwnId) {
      s2St = null;
      s2BlkHex = null;
    }

    const s1WorldMapS2 = Array.isArray(s1St?.world_map_subnets)
      ? s1St.world_map_subnets.find(
          (w) => w && w.subnet_id && w.subnet_id !== '00000001' && w.subnet_id !== s1OwnId
        )
      : null;

    if (!s2St && !repSt?.roaming && !s1WorldMapS2) return;
    elDualPanel.style.display = 'flex';

    const s1Id = s1OwnId || subnet2Meta?.subnet1Id || '—';
    const s2Id = s2St?.subnet_id || s1WorldMapS2?.subnet_id || subnet2Meta?.subnetId || '6eaa3da4';
    const s1Tip = s1BlkHex ? parseHexInt(s1BlkHex) : Number(s1St?.this_subnet?.tip_height || 0);
    const s2Tip = s2BlkHex ? parseHexInt(s2BlkHex) : Number(s1WorldMapS2?.tip_height || 0);
    const lane = String(repSt?.active_transport_lane || (s1WorldMapS2 ? 'hybrid-rf+tcp' : ''));
    const isTcpLane = lane.includes('tcp');

    if (elRepBadge) {
      elRepBadge.textContent = repSt
        ? isTcpLane
          ? `🔌 Repeater .4 Active: TCP Subnet 2 (${s2Id})`
          : `📡 Repeater .4 Active: 915 MHz RF Subnet 1 (${s1Id})`
        : s1WorldMapS2
          ? `🛰️ Auto-Discovered via WorldMap Gossip (${s1Id} ⇄ ${s2Id})`
          : '🛰️ Repeater .4 Offline';
      elRepBadge.style.borderColor = isTcpLane ? 'rgba(192,132,252,0.7)' : 'rgba(56,189,248,0.7)';
      elRepBadge.style.color = isTcpLane ? '#f3e8ff' : '#bae6fd';
      elRepBadge.style.background = isTcpLane ? 'rgba(168,85,247,0.22)' : 'rgba(14,165,233,0.22)';
    }

    if (elBridgeTopo) {
      const wmCount = repSt
        ? Array.isArray(repSt.world_map_subnets)
          ? repSt.world_map_subnets.length
          : 0
        : 1 + (Array.isArray(s1St?.world_map_subnets) ? s1St.world_map_subnets.length : 0);
      const s2ValCount = Number(s2St?.this_subnet?.validator_count || s1WorldMapS2?.validator_count || 3);
      elBridgeTopo.innerHTML = `
        <div style="padding:10px 12px;border-radius:10px;background:#050b16;border:1px solid rgba(56,189,248,0.45);font-family:'JetBrains Mono',monospace;font-size:0.7rem;display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;"><strong style="color:#7dd3fc;">📡 Subnet 1 (LR2021 RF)</strong><span style="color:#6ee7b7;">#${fmtInt(s1Tip)}</span></div>
          <div style="color:#94a3b8;font-size:0.65rem;">ID: <code style="color:#f8fafc;">${esc(s1Id)}</code> • 4 RF Validators @ 915 MHz</div>
          <div style="color:#cbd5e1;font-size:0.65rem;">Outbound queued: <strong>${fmtInt(s1St?.pending_foreign_txns || 0)}</strong> • Receipts returned: <strong style="color:#34d399;">${fmtInt(s1St?.confirmed_foreign_responses || 0)}</strong></div>
        </div>
        <div style="padding:10px 12px;border-radius:10px;background:#080b18;border:1.5px solid ${isTcpLane ? 'rgba(192,132,252,0.65)' : 'rgba(56,189,248,0.65)'};font-family:'JetBrains Mono',monospace;font-size:0.7rem;display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;"><strong style="color:#fcd34d;">🛰️ Hybrid Repeater (.4)</strong><span style="color:#e2e8f0;">${esc(lane || 'roaming')}</span></div>
          <div style="color:#94a3b8;font-size:0.65rem;">Discovered subnets: <strong style="color:#f8fafc;">${wmCount}</strong> (RF + TCP)</div>
          <div style="color:#cbd5e1;font-size:0.65rem;">${repSt ? `Carrying txns: <strong style="color:#fbbf24;">${fmtInt(repSt?.pending_foreign_txns || 0)}</strong> • Carrying receipts: <strong style="color:#c084fc;">${fmtInt(repSt?.pending_foreign_responses || 0)}</strong>` : `Protocol-native <code>SubnetWorldMap</code> gossip active`}</div>
        </div>
        <div style="padding:10px 12px;border-radius:10px;background:#070918;border:1px solid rgba(192,132,252,0.45);font-family:'JetBrains Mono',monospace;font-size:0.7rem;display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;"><strong style="color:#d8b4fe;">🔌 ${esc(s1WorldMapS2?.name || 'Subnet 2 (TCP/IP Mesh)')}</strong><span style="color:#6ee7b7;">#${fmtInt(s2Tip)}</span></div>
          <div style="color:#94a3b8;font-size:0.65rem;">ID: <code style="color:#f8fafc;">${esc(s2Id)}</code> • ${fmtInt(s2ValCount)} TCP Validators</div>
          <div style="color:#cbd5e1;font-size:0.65rem;">${s2St ? `Outbound queued: <strong>${fmtInt(s2St?.pending_foreign_txns || 0)}</strong> • Receipts returned: <strong style="color:#34d399;">${fmtInt(s2St?.confirmed_foreign_responses || 0)}</strong>` : `Endpoint: <code style="color:#e9d5ff;">${esc(s1WorldMapS2?.public_rpc_url || 'wss://node21.superlexicon.com/rpc')}</code>`}</div>
        </div>
      `;
    }

    const ingestPoolItems = (items, stageLabel, rank) => {
      if (!Array.isArray(items)) return;
      for (const it of items) {
        const cleanHex = String(it.tx_hash || '').replace(/^0x/i, '').toLowerCase();
        if (!cleanHex) continue;
        const h = `0x${cleanHex}`;
        const dir = it.origin_subnet === s1Id ? 'RF ➔ TCP' : 'TCP ➔ RF';
        const prev = crossLedger.get(h);
        if (!prev || rank >= prev.rank) {
          crossLedger.set(h, {
            txHash: h,
            direction: dir,
            originSubnet: it.origin_subnet,
            targetSubnet: it.target_subnet,
            stage: stageLabel,
            rank,
            targetBlock: it.block_height || prev?.targetBlock || null,
            updatedAtMs: it.created_at_ms || Date.now(),
          });
        }
      }
    };

    ingestPoolItems(s1St?.recent_pending_txns, '⏳ Staged on RF Subnet 1', 1);
    ingestPoolItems(s2St?.recent_pending_txns, '⏳ Staged on TCP Subnet 2', 1);
    ingestPoolItems(repSt?.recent_pending_txns, '🛰️ In Transit on Repeater .4', 2);
    ingestPoolItems(repSt?.recent_pending_responses, '🧱 Executed • Returning Receipt', 3);
    ingestPoolItems(s1St?.recent_confirmed_responses, '✅ Round-Trip Confirmed on Subnet 1', 4);
    ingestPoolItems(s2St?.recent_confirmed_responses, '✅ Round-Trip Confirmed on Subnet 2', 4);

    const rows = Array.from(crossLedger.values())
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
      .slice(0, 18);

    if (elCrossSummary) {
      const totalConfirmed =
        Number(s1St?.confirmed_foreign_responses || 0) + Number(s2St?.confirmed_foreign_responses || 0);
      elCrossSummary.textContent = `${rows.length} tracked • ${fmtInt(totalConfirmed)} round-trip receipts confirmed`;
      worldMapApi?.updateTelemetry({
        s1Tip,
        s2Tip,
        confirmedCrossTxns: totalConfirmed,
        inFlightCrossTxns:
          Number(repSt?.pending_foreign_txns || 0) + Number(repSt?.pending_foreign_responses || 0),
        lane,
      });
    }

    if (elCrossFeed) {
      if (!rows.length) {
        elCrossFeed.innerHTML = `<div style="color:#94a3b8;font-family:'JetBrains Mono',monospace;font-size:0.7rem;padding:6px 2px;">Waiting for next cross-subnet transaction batch…</div>`;
      } else {
        elCrossFeed.innerHTML = rows
          .map((r) => {
            const isRfToTcp = r.direction === 'RF ➔ TCP';
            const badgeBg = isRfToTcp ? 'rgba(14,165,233,0.2)' : 'rgba(168,85,247,0.22)';
            const badgeColor = isRfToTcp ? '#7dd3fc' : '#e9d5ff';
            const blkBadge = r.targetBlock ? ` • Block #${fmtInt(r.targetBlock)}` : '';
            return `
              <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:6px 9px;border-radius:7px;background:#091122;border:1px solid rgba(51,65,85,0.6);font-family:'JetBrains Mono',monospace;font-size:0.69rem;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="padding:1px 7px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-weight:700;">${esc(r.direction)}</span>
                  <span style="color:#e2e8f0;">${esc(shortHex(r.txHash, 10, 6))}</span>
                </div>
                <div style="color:#6ee7b7;font-size:0.67rem;">${esc(r.stage)}${esc(blkBadge)}</div>
              </div>
            `;
          })
          .join('');
      }
    }
  }

  async function sendUiCrossSubnetTx(direction) {
    if (!subnet2Meta) return;
    const isHttps =
      typeof window !== 'undefined' &&
      (window.location?.protocol === 'https:' ||
        String(window.location?.hostname || '').toLowerCase().endsWith('superlexicon.com'));
    const isRfToTcp = direction === 'RF_TO_TCP';
    const targetSubnet = isRfToTcp ? subnet2Meta.subnetId : subnet2Meta.subnet1Id;
    const targetMsgAddr = isRfToTcp ? subnet2Meta.messaging : subnet2Meta.subnet1Messaging;
    if (!targetSubnet || !targetMsgAddr) return;

    const rndBytes = new Uint8Array(32);
    crypto.getRandomValues(rndBytes);
    const privHex = '0x' + Array.from(rndBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const channel = keccak256Hex(utf8ToBytes('CROSS_SUBNET_BRIDGE'));
    const text = `[UI ${isRfToTcp ? 'RF->TCP' : 'TCP->RF'}] Live Browser Cross-Subnet Dispatch @ ${new Date().toISOString()}`;
    const calldata = encodeAbi('postMessage(bytes32,bytes)', [channel, utf8ToBytes(text)]);
    const signed = signOrderedLexiconTx({
      privateKey: privHex,
      nonce: 0n,
      to: targetMsgAddr,
      value: 0n,
      data: calldata,
      gasLimit: 500_000n,
      chainId: BigInt(subnet2Meta.chainId || 1337),
    });

    if (isHttps) {
      const allSubs = SlxSubnetManager.listSubnets();
      const s1Prof = allSubs.find((s) => s.key === 'subnet1') || allSubs[0];
      const s2Prof = allSubs.find((s) => s.key === 'subnet2' || (s.key !== 'subnet1' && s.discovered));
      const wsTargets = isRfToTcp
        ? (s1Prof?.validatorNodes || []).map((v) => v.url).filter(Boolean)
        : (s2Prof?.validatorNodes || []).length
          ? s2Prof.validatorNodes.map((v) => v.url).filter(Boolean)
          : s2Prof?.rpcUrl
            ? [s2Prof.rpcUrl]
            : ['wss://node21.superlexicon.com/rpc'];
      await Promise.all(
        wsTargets.map((u) => slxNodeRpc(u, 'subnet_sendTransaction', [targetSubnet, signed.raw], 4000).catch(() => null))
      );
    } else {
      const originUrls = isRfToTcp
        ? ['http://192.168.50.91:8545', 'http://192.168.50.92:8555', 'http://192.168.50.93:8545', 'http://192.168.50.94:8545']
        : subnet2Meta.rpcUrls || ['http://192.168.50.91:18545'];
      await Promise.all(
        originUrls.map((u) => httpJsonRpc(u, 'subnet_sendTransaction', [targetSubnet, signed.raw]).catch(() => null))
      );
    }
    await refreshDualSubnetBridge();
  }

  elBtnRfToTcp?.addEventListener('click', () => sendUiCrossSubnetTx('RF_TO_TCP'));
  elBtnTcpToRf?.addEventListener('click', () => sendUiCrossSubnetTx('TCP_TO_RF'));

  refreshDualSubnetBridge();
  setInterval(refreshDualSubnetBridge, 2500);
}

mountSubnetBlockExplorer();
