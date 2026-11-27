#!/usr/bin/env python3
"""
SuperLexicon Content-Addressed HFS App Bundle Packer (`scripts/pack-app-bundles.py`)

Packages all 12 core SuperLexicon HFS use-case UIs (`accounting`, `charter`, `dex`, `commerce`,
`crowdfunding`, `rewards`, `ballot`, `social`, `battleship`, `cipher-noir`, `hegemony`, `lottery`)
plus 3 community sandboxed starter apps (`rf-micro-poll`, `mesh-repeater-wall`, `hfs-bounty-splits`)
into deterministic `gzip` single-file HTML bundles (`public/app-bundles/<slug>.html.gz`), computes
exact Ethereum/Lexicon `Keccak-256` (`0x01` domain separator) `uiHash` digests, writes
`public/app-bundles/manifest.json`, and emits lightweight Universal Host Runner stubs for
`/<slug>.html` so every use-case UI runs dynamically through the HFS App Store architecture.
"""

import gzip
import io
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP_SOURCES_DIR = ROOT / "app-sources"
OUT_BUNDLES_DIR = ROOT / "public" / "app-bundles"
CONTRACTS_DIR = ROOT / "public" / "contracts"
SRC_DIR = ROOT / "src"

# ---------------------------------------------------------------------------
# Exact Pure-Python Keccak-256 (Ethereum / SuperLexicon 0x01 Domain Byte)
# ---------------------------------------------------------------------------
_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44]
_PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1]
_MASK64 = 0xFFFFFFFFFFFFFFFF


def _rotl64(x: int, n: int) -> int:
    return ((x << n) | (x >> (64 - n))) & _MASK64


def _keccak_f1600(st: list[int]) -> None:
    for r in range(24):
        bc = [st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20] for i in range(5)]
        for i in range(5):
            t = bc[(i + 4) % 5] ^ _rotl64(bc[(i + 1) % 5], 1)
            for j in range(0, 25, 5):
                st[j + i] ^= t
        t = st[1]
        for i in range(24):
            j = _PILN[i]
            st[j], t = _rotl64(t, _ROTC[i]), st[j]
        for j in range(0, 25, 5):
            row = st[j : j + 5]
            for i in range(5):
                st[j + i] ^= ((~row[(i + 1) % 5]) & _MASK64) & row[(i + 2) % 5]
        st[0] ^= _RC[r]


def keccak256_hex(data: bytes) -> str:
    st = [0] * 25
    rate = 136
    mv = memoryview(data)
    off = 0
    while off + rate <= len(mv):
        blk = mv[off : off + rate]
        for lane in range(17):
            st[lane] ^= int.from_bytes(blk[lane * 8 : (lane + 1) * 8], "little")
        _keccak_f1600(st)
        off += rate
    rem = bytearray(rate)
    tail = mv[off:]
    rem[: len(tail)] = tail
    rem[len(tail)] ^= 0x01
    rem[rate - 1] ^= 0x80
    for lane in range(17):
        st[lane] ^= int.from_bytes(rem[lane * 8 : (lane + 1) * 8], "little")
    _keccak_f1600(st)
    out = bytearray(32)
    for lane in range(4):
        out[lane * 8 : (lane + 1) * 8] = st[lane].to_bytes(8, "little")
    return "0x" + out.hex()


assert (
    keccak256_hex(b"")
    == "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
), "Keccak-256 self-test failed"


def deterministic_gzip(raw_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as gz:
        gz.write(raw_bytes)
    return buf.getvalue()


CORE_APPS = [
    {
        "slug": "accounting",
        "title": "IFRS & Confidential Accounting",
        "icon": "📒",
        "category": 2,
        "version": "2.4.0",
        "summary": "Double-entry IAS/IFRS financial statements, ElGamal homomorphic category balances, and Bulletproof range proofs.",
        "wasmKey": "accounting_ledger",
        "wasmFile": "accounting_ledger.wasm",
        "instKey": "accountingLedger",
        "hasCss": True,
    },
    {
        "slug": "charter",
        "title": "CorporateCharter Governance",
        "icon": "🏛️",
        "category": 2,
        "version": "2.4.0",
        "summary": "Statutory corporate constitution, multi-stage board quorums, share issuance, and 3-window ROFR/Tag-Along auctions.",
        "wasmKey": "corporate_charter",
        "wasmFile": "corporate_charter.wasm",
        "instKey": "corporateCharter",
        "hasCss": False,
    },
    {
        "slug": "dex",
        "title": "DEX Central Limit Book",
        "icon": "📈",
        "category": 1,
        "version": "2.3.0",
        "summary": "16-market multi-asset Central Limit Order Book (CLOB) with discrete-time batch matching and equity/fiat settlement.",
        "wasmKey": "dex_clob",
        "wasmFile": "dex_clob.wasm",
        "instKey": "dexClob",
        "hasCss": False,
    },
    {
        "slug": "commerce",
        "title": "E-Commerce & B2B Storefront",
        "icon": "🛒",
        "category": 3,
        "version": "2.2.0",
        "summary": "On-chain ProductLedger retail & B2B bulk catalog with atomic double-entry IFRS revenue & COGS posting.",
        "wasmKey": "product_ledger",
        "wasmFile": "product_ledger.wasm",
        "instKey": "productLedger",
        "hasCss": False,
    },
    {
        "slug": "crowdfunding",
        "title": "Hardware Pre-Order Crowdfunding",
        "icon": "🚀",
        "category": 3,
        "version": "2.5.0",
        "summary": "Board-activated hardware pre-orders with Airwallex credit-auth holds, Identity HFS shipping profiles, and IFRS stretch budgets.",
        "wasmKey": "crowdfunding",
        "wasmFile": "crowdfunding.wasm",
        "instKey": "",
        "hasCss": False,
    },
    {
        "slug": "rewards",
        "title": "SLXR 90-Day Hardware Vouchers",
        "icon": "🎁",
        "category": 3,
        "version": "2.1.0",
        "summary": "Blinded pre-order SLXR reward vouchers, 90-day active RF validator heartbeat gate, and cash-back redemption pool.",
        "wasmKey": "reward_voucher",
        "wasmFile": "",
        "instKey": "",
        "hasCss": False,
    },
    {
        "slug": "ballot",
        "title": "CipherVote Secret Ballot",
        "icon": "🗳️",
        "category": 2,
        "version": "2.2.0",
        "summary": "Threshold ElGamal homomorphic encrypted tallying and zero-knowledge 1-hot ballot validity proofs.",
        "wasmKey": "secret_ballot",
        "wasmFile": "secret_ballot.wasm",
        "instKey": "",
        "hasCss": True,
    },
    {
        "slug": "social",
        "title": "CommonsRF Social & Guilds",
        "icon": "📡",
        "category": 4,
        "version": "2.3.0",
        "summary": "Mutual-handshake ECIES encrypted messaging, multi-topic radio community feeds, events, and guild governance.",
        "wasmKey": "social_charter",
        "wasmFile": "social_charter.wasm",
        "instKey": "",
        "hasCss": True,
    },
    {
        "slug": "battleship",
        "title": "Phantom Fleet Naval Arena",
        "icon": "⚓",
        "category": 5,
        "version": "2.3.0",
        "summary": "Real-time 100-player naval warfare on deterministic Haltproof WASM subroutines with live fleet comms.",
        "wasmKey": "battleship",
        "wasmFile": "battleship.wasm",
        "instKey": "",
        "hasCss": True,
    },
    {
        "slug": "cipher-noir",
        "title": "Cipher Noir ZK Deduction",
        "icon": "🔐",
        "category": 5,
        "version": "2.2.0",
        "summary": "Arbiter-free mental poker and zero-knowledge cryptographic espionage deduction at the Geneva Clearinghouse.",
        "wasmKey": "cipher_noir",
        "wasmFile": "cipher-noir.wasm",
        "instKey": "",
        "hasCss": True,
    },
    {
        "slug": "hegemony",
        "title": "Fractured Hegemony",
        "icon": "⬢",
        "category": 5,
        "version": "2.2.0",
        "summary": "Simultaneous commit-reveal global grand strategy and verifiable cross-bloc diplomacy.",
        "wasmKey": "hegemony",
        "wasmFile": "hegemony.wasm",
        "instKey": "",
        "hasCss": True,
    },
    {
        "slug": "lottery",
        "title": "Quantum 4D Threshold-VRF Jackpot",
        "icon": "🎰",
        "category": 5,
        "version": "2.2.0",
        "summary": "Provably fair 4D jackpot powered by validator-quorum Edwards25519 Chaum-Pedersen DLEQ + Lagrange threshold VRF.",
        "wasmKey": "lottery",
        "wasmFile": "lottery.wasm",
        "instKey": "",
        "hasCss": True,
    },
]

COMMUNITY_SANDBOX_APPS = [
    {
        "slug": "rf-micro-poll",
        "title": "RF Mesh Pulse Poll",
        "icon": "📊",
        "category": 6,
        "version": "1.0.0",
        "summary": "Zero-trust sandboxed iframe app: live community RF channel & feature poll using window.slx Identity signing.",
        "html": """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>RF Mesh Pulse Poll</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; background: #050b16; color: #f8fafc; font-family: system-ui, sans-serif; }
    .card { max-width: 720px; margin: 0 auto; background: #0a1428; border: 1px solid rgba(56,189,248,0.4); border-radius: 14px; padding: 20px; }
    .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; background: rgba(16,185,129,0.2); border: 1px solid rgba(52,211,153,0.5); color: #6ee7b7; font-family: monospace; font-size: 11px; font-weight: 700; }
    .opt { margin-top: 10px; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(71,85,105,0.75); background: #060d1b; display: flex; flex-direction: column; gap: 6px; }
    .bar { height: 8px; border-radius: 999px; background: #1e293b; overflow: hidden; }
    .fill { height: 100%; background: linear-gradient(90deg, #0ea5e9, #10b981); transition: width 0.25s; }
    button { padding: 7px 13px; border-radius: 8px; border: 1px solid rgba(56,189,248,0.6); background: rgba(14,165,233,0.22); color: #e0f2fe; font-weight: 700; cursor: pointer; font-family: monospace; font-size: 12px; }
    button:hover { background: rgba(14,165,233,0.38); }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <span class="pill">🛡️ Sandboxed Iframe App • window.slx Bridge</span>
      <span id="ctxInfo" style="font-family:monospace;font-size:12px;color:#94a3b8;">Connecting to Host…</span>
    </div>
    <h2 style="margin:12px 0 4px;">📊 Next Community HFS Subroutine Priority?</h2>
    <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;">Cast a signed vote via your Host Identity HFS — zero private keys exposed to this iframe.</p>
    <div id="optionsList"></div>
    <div id="logBox" style="margin-top:14px;font-family:monospace;font-size:12px;color:#7dd3fc;"></div>
  </div>
  <script>
    const OPTIONS = [
      { id: 'mesh-map', label: '🗺️ Live LoRa / LR2021 SNR Coverage Heatmap HFS' },
      { id: 'dao-bounty', label: '⚡ Milestone Hardware Firmware Bounty Escrow HFS' },
      { id: 'p2p-swap', label: '🔄 Atomic Over-the-Air Offline Voucher Swap HFS' },
      { id: 'chess-zk', label: '♟️ Fog-of-War Zero-Knowledge Blitz Chess HFS' }
    ];
    let votes = { 'mesh-map': 14, 'dao-bounty': 11, 'p2p-swap': 9, 'chess-zk': 7 };
    let userTag = 'Guest';

    async function init() {
      if (window.slx) {
        const ctx = await window.slx.getContext();
        userTag = ctx.user.nickname + ' · ' + ctx.user.tag4;
        document.getElementById('ctxInfo').textContent = 'Connected as ' + userTag + ' (Blk #' + ctx.blockNumber + ')';
        const saved = await window.slx.getAppStorage('votes_v1');
        if (saved) votes = saved;
      }
      render();
    }

    function render() {
      const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1;
      document.getElementById('optionsList').innerHTML = OPTIONS.map(o => {
        const count = votes[o.id] || 0;
        const pct = ((count / total) * 100).toFixed(1);
        return '<div class="opt">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
            '<strong style="font-size:13.5px;">' + o.label + '</strong>' +
            '<button onclick="castVote(\\'' + o.id + '\\')">Vote (' + count + ' • ' + pct + '%)</button>' +
          '</div>' +
          '<div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
      }).join('');
    }

    window.castVote = async function(optId) {
      const log = document.getElementById('logBox');
      try {
        log.textContent = '⏳ Requesting Host Wallet signature via window.slx.sendTransaction…';
        const res = await window.slx.sendTransaction({
          fnSig: 'vote(string)',
          args: [['string', optId]],
          summary: 'Cast community poll vote for "' + optId + '"'
        });
        votes[optId] = (votes[optId] || 0) + 1;
        await window.slx.setAppStorage('votes_v1', votes);
        log.textContent = '✓ Vote recorded by ' + userTag + ' • txHash: ' + String(res.txHash).slice(0, 18) + '…';
        render();
      } catch (err) {
        log.textContent = '⚠ ' + err.message;
      }
    };

    init();
  </script>
</body>
</html>""",
    },
    {
        "slug": "mesh-repeater-wall",
        "title": "Mesh Repeater Beacon Wall",
        "icon": "📻",
        "category": 4,
        "version": "1.0.0",
        "summary": "Zero-trust sandboxed iframe app: post off-grid SNR & frequency status beacons signed with your Identity nickname.",
        "html": """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Mesh Repeater Beacon Wall</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; background: #040914; color: #f8fafc; font-family: system-ui, sans-serif; }
    .wrap { max-width: 740px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
    .box { background: #091326; border: 1px solid rgba(52,211,153,0.4); border-radius: 14px; padding: 16px; }
    input, select { padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; background: #030712; color: #f8fafc; font-family: monospace; font-size: 12.5px; }
    button { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(52,211,153,0.65); background: rgba(16,185,129,0.22); color: #d1fae5; font-family: monospace; font-weight: 700; cursor: pointer; }
    .beacon { padding: 10px 12px; border-radius: 10px; background: #050b18; border: 1px solid rgba(56,189,248,0.28); margin-top: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="box">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong style="color:#6ee7b7;font-family:monospace;font-size:12px;">📻 LR2021 REPEATER BEACON LOG (SANDBOXED APP)</strong>
        <span id="who" style="font-family:monospace;font-size:12px;color:#94a3b8;">Loading…</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 130px auto;gap:8px;margin-top:12px;">
        <input id="msgIn" placeholder="e.g. Clear 917.2 MHz LOS across Marina Bay (+11.4 dB SNR)" />
        <select id="bandIn">
          <option>915 MHz FLRC</option>
          <option>868 MHz SAW</option>
          <option>2.4 GHz LoRa</option>
        </select>
        <button onclick="postBeacon()">📡 Broadcast</button>
      </div>
      <div id="statusLine" style="margin-top:8px;font-family:monospace;font-size:11.5px;color:#7dd3fc;"></div>
    </div>
    <div class="box">
      <strong style="font-size:13px;color:#bae6fd;">Recent Verified Field Beacons</strong>
      <div id="feed"></div>
    </div>
  </div>
  <script>
    let beacons = [
      { author: 'NodeOp_SG · 9f2a', band: '915 MHz FLRC', text: 'Dual-Wio Dongle locked onto Subnet 1 State Carousel @ 142 TPS.', ts: 'Genesis' },
      { author: 'AlpineRelay · 4c18', band: '868 MHz SAW', text: 'SF2485E +33 dBm SAW filter holding -41 dBm cross-band floor.', ts: 'Genesis' }
    ];
    let me = 'Operator';
    async function boot() {
      if (window.slx) {
        const ctx = await window.slx.getContext();
        me = ctx.user.nickname + ' · ' + ctx.user.tag4;
        document.getElementById('who').textContent = me;
        const saved = await window.slx.getAppStorage('beacons_v1');
        if (Array.isArray(saved) && saved.length) beacons = saved;
      }
      render();
    }
    function render() {
      document.getElementById('feed').innerHTML = beacons.map(b =>
        '<div class="beacon">' +
          '<div style="display:flex;justify-content:space-between;font-family:monospace;font-size:11.5px;color:#6ee7b7;">' +
            '<span>' + b.author + ' • [' + b.band + ']</span><span>' + b.ts + '</span>' +
          '</div>' +
          '<div style="margin-top:4px;color:#e2e8f0;">' + b.text.replace(/</g, '&lt;') + '</div>' +
        '</div>'
      ).join('');
    }
    window.postBeacon = async function() {
      const inp = document.getElementById('msgIn');
      const band = document.getElementById('bandIn').value;
      const text = inp.value.trim();
      if (!text) return;
      const st = document.getElementById('statusLine');
      try {
        st.textContent = '⏳ Signing beacon via Host Identity HFS…';
        const res = await window.slx.sendTransaction({
          fnSig: 'postBeacon(string,string)',
          args: [['string', band], ['string', text]],
          summary: 'Broadcast RF repeater status (' + band + ')'
        });
        beacons.unshift({ author: me, band, text, ts: new Date().toLocaleTimeString() });
        await window.slx.setAppStorage('beacons_v1', beacons.slice(0, 25));
        inp.value = '';
        st.textContent = '✓ Broadcast confirmed (' + String(res.txHash).slice(0, 16) + '…)';
        render();
      } catch (e) {
        st.textContent = '⚠ ' + e.message;
      }
    };
    boot();
  </script>
</body>
</html>""",
    },
    {
        "slug": "hfs-bounty-splits",
        "title": "HFS R&D Bounty Splits",
        "icon": "🧮",
        "category": 6,
        "version": "1.0.0",
        "summary": "Zero-trust sandboxed iframe app: coordinate contributor R&D bounty splits & dispatch milestone payouts.",
        "html": """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>HFS R&D Bounty Splits</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; background: #050a14; color: #f8fafc; font-family: system-ui, sans-serif; }
    .card { max-width: 720px; margin: 0 auto; background: #0a1324; border: 1px solid rgba(251,191,36,0.42); border-radius: 14px; padding: 18px; }
    input { padding: 7px 10px; border-radius: 8px; border: 1px solid #334155; background: #030712; color: #f8fafc; font-family: monospace; font-size: 12px; width: 100%; }
    button { padding: 8px 13px; border-radius: 8px; border: 1px solid rgba(251,191,36,0.65); background: rgba(245,158,11,0.2); color: #fef3c7; font-family: monospace; font-weight: 700; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-family: monospace; font-size: 12.5px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong style="color:#fde68a;font-family:monospace;font-size:12px;">🧮 ANTI-DATACENTER R&amp;D BOUNTY SPLITTER</strong>
      <span id="hdrUser" style="font-family:monospace;font-size:12px;color:#94a3b8;">Sandboxed Guest</span>
    </div>
    <h2 style="margin:10px 0 4px;">Open-Source Subroutine Grant Pool: $25,000</h2>
    <p style="margin:0 0 12px;font-size:13px;color:#94a3b8;">Add contributor splits and execute deterministic settlement via Host Wallet confirmation.</p>
    <div style="display:grid;grid-template-columns:1.4fr 0.8fr auto;gap:8px;">
      <input id="recIn" placeholder="Contributor handle or 0x… Identity" />
      <input id="bpsIn" type="number" min="5" max="100" value="25" placeholder="Share %" />
      <button onclick="addSplit()">+ Add Recipient</button>
    </div>
    <table>
      <thead><tr><th>Contributor</th><th>Share %</th><th>Payout (USD)</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <span id="msg" style="font-family:monospace;font-size:12px;color:#6ee7b7;">Ready</span>
      <button onclick="settlePool()">⚡ Sign &amp; Execute Split</button>
    </div>
  </div>
  <script>
    const POOL = 25000;
    let splits = [
      { who: 'RustWasmCore · 7a12', pct: 50 },
      { who: 'RfSawFilterLab · 3e09', pct: 30 },
      { who: 'ZkBulletproofs · 8b44', pct: 20 }
    ];
    async function init() {
      if (window.slx) {
        const ctx = await window.slx.getContext();
        document.getElementById('hdrUser').textContent = ctx.user.nickname + ' · ' + ctx.user.tag4;
        const s = await window.slx.getAppStorage('splits_v1');
        if (Array.isArray(s) && s.length) splits = s;
      }
      render();
    }
    function render() {
      document.getElementById('rows').innerHTML = splits.map(s =>
        '<tr><td>' + s.who.replace(/</g, '&lt;') + '</td><td>' + s.pct + '%</td><td>$' + Math.round(POOL * s.pct / 100).toLocaleString() + '</td></tr>'
      ).join('');
    }
    window.addSplit = async function() {
      const who = document.getElementById('recIn').value.trim();
      const pct = Math.max(1, Math.min(100, Number(document.getElementById('bpsIn').value || 10)));
      if (!who) return;
      splits.push({ who, pct });
      if (window.slx) await window.slx.setAppStorage('splits_v1', splits);
      document.getElementById('recIn').value = '';
      render();
    };
    window.settlePool = async function() {
      const msg = document.getElementById('msg');
      try {
        msg.textContent = '⏳ Awaiting Host Wallet approval…';
        const res = await window.slx.sendTransaction({
          fnSig: 'executeBountySplit(uint64)',
          args: [['uint64', POOL]],
          summary: 'Settle $25,000 R&D Bounty Split across ' + splits.length + ' contributors'
        });
        msg.textContent = '✓ Split executed (' + String(res.txHash).slice(0, 16) + '…)';
      } catch (e) {
        msg.textContent = '⚠ ' + e.message;
      }
    };
    init();
  </script>
</body>
</html>""",
    },
]


def migrate_sources_if_needed() -> None:
    """
    Moves the 12 core use-case UIs (`<slug>.html`, `src/<slug>.js`, and optional `src/<slug>.css`)
    into `app-sources/<slug>/` on first run (idempotent on subsequent runs!).
    """
    APP_SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    for spec in CORE_APPS:
        slug = spec["slug"]
        dest_dir = APP_SOURCES_DIR / slug
        dest_dir.mkdir(parents=True, exist_ok=True)

        root_html = ROOT / f"{slug}.html"
        src_js = SRC_DIR / f"{slug}.js"
        src_css = SRC_DIR / f"{slug}.css"

        target_html = dest_dir / "app.html"
        target_js = dest_dir / "app.js"
        target_css = dest_dir / "app.css"

        # Copy root_html -> app-sources/<slug>/app.html ONLY if root_html is not already a Host Stub
        if root_html.exists():
            txt = root_html.read_text()
            if "data-slx-app-slug=" not in txt:
                target_html.write_text(txt)

        if src_js.exists():
            shutil.move(str(src_js), str(target_js))

        if spec["hasCss"] and src_css.exists():
            shutil.move(str(src_css), str(target_css))

    for cspec in COMMUNITY_SANDBOX_APPS:
        cdir = APP_SOURCES_DIR / cspec["slug"]
        cdir.mkdir(parents=True, exist_ok=True)
        chtml = cdir / "app.html"
        if not chtml.exists():
            chtml.write_text(cspec["html"])


def build_self_contained_core_html(spec: dict) -> str:
    slug = spec["slug"]
    sdir = APP_SOURCES_DIR / slug
    raw_html = (sdir / "app.html").read_text()
    raw_js = (sdir / "app.js").read_text()
    raw_css = (sdir / "app.css").read_text() if (sdir / "app.css").exists() else ""

    # Strip external local stylesheet links (`/src/...css`) and external `<script src="/src/...">` tags
    cleaned = re.sub(
        r'\s*<link[^>]+href=["\']/src/[^"\']+\.css["\'][^>]*/?>',
        "",
        raw_html,
        flags=re.I,
    )
    cleaned = re.sub(
        r'\s*<script[^>]+src=["\']/src/[^"\']+\.js["\'][^>]*>\s*</script>',
        "",
        cleaned,
        flags=re.I,
    )

    # Escape accidental `</style` or `</script` inside embedded CSS/JS safely if needed
    if raw_css:
        style_block = f'\n  <style data-slx-bundle-css="{slug}">\n{raw_css}\n  </style>\n'
        cleaned = re.sub(r"</head>", lambda _: style_block + "</head>", cleaned, count=1, flags=re.I)

    # Note: In JS, escape literal `</script>` inside string literals if any exist (`<\/script>`)
    safe_js = re.sub(r"</script>", r"<\/script>", raw_js, flags=re.I)
    script_block = f'\n  <script type="module" data-slx-bundle-entry="{slug}">\n{safe_js}\n  </script>\n'
    cleaned = re.sub(r"</body>", lambda _: script_block + "</body>", cleaned, count=1, flags=re.I)
    return cleaned


def emit_host_stub_html(slug: str, title: str, icon: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{icon} {title} — SuperLexicon HFS App</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/src/slx-wallet.css" />
  <link rel="stylesheet" href="/src/slx-inst.css" />
</head>
<body data-slx-app-slug="{slug}" style="margin:0;min-height:100vh;background:#050a14;color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif;">
  <script type="module" src="/src/app-host-boot.js"></script>
</body>
</html>
"""


def main() -> None:
    migrate_sources_if_needed()
    OUT_BUNDLES_DIR.mkdir(parents=True, exist_ok=True)

    deploy_json = json.loads((CONTRACTS_DIR / "subnet1-deployments.json").read_text())
    code_hashes = deploy_json.get("codeHashes", {})
    inst = deploy_json.get("institutional", {})

    manifest_apps = []
    app_id_seq = 1

    # 1. Pack all 12 Core System HFS Apps + write Universal Host Stubs to `/<slug>.html`
    for spec in CORE_APPS:
        slug = spec["slug"]
        full_html = build_self_contained_core_html(spec)
        raw_bytes = full_html.encode("utf-8")
        gz_bytes = deterministic_gzip(raw_bytes)
        ui_hash = keccak256_hex(gz_bytes)
        slug_id = keccak256_hex(slug.encode("utf-8"))

        wasm_hash = code_hashes.get(spec["wasmKey"], "")
        if not wasm_hash and spec["wasmFile"] and (CONTRACTS_DIR / spec["wasmFile"]).exists():
            wasm_hash = keccak256_hex((CONTRACTS_DIR / spec["wasmFile"]).read_bytes())
        if not wasm_hash:
            wasm_hash = "0x" + "00" * 32

        default_hfs = inst.get(spec["instKey"], "") if spec["instKey"] else ""
        if not default_hfs:
            default_hfs = "0x" + "00" * 20

        out_gz = OUT_BUNDLES_DIR / f"{slug}.html.gz"
        out_gz.write_bytes(gz_bytes)

        # Replace static `/<slug>.html` with lightweight Universal Host Runner Stub!
        (ROOT / f"{slug}.html").write_text(emit_host_stub_html(slug, spec["title"], spec["icon"]))

        chunks = (len(gz_bytes) + 32767) // 32768
        manifest_apps.append(
            {
                "appId": app_id_seq,
                "slug": slug,
                "slugId": slug_id,
                "title": spec["title"],
                "summary": spec["summary"],
                "icon": spec["icon"],
                "category": spec["category"],
                "version": spec["version"],
                "execMode": 1,  # VERIFIED_HOST
                "uiHash": ui_hash,
                "uncompressedLen": len(raw_bytes),
                "compressedLen": len(gz_bytes),
                "chunkCount": chunks,
                "bundleUrl": f"/app-bundles/{slug}.html.gz",
                "route": f"/{slug}.html",
                "wasmCodeHash": wasm_hash.lower(),
                "defaultHfsAddr": default_hfs.lower(),
                "publisherLabel": "SuperLexicon Core · HFS",
                "isSystemCore": True,
            }
        )
        print(
            f"[CORE #{app_id_seq:02d}] {slug:14s} | raw={len(raw_bytes)/1024:6.1f} KiB -> gzip={len(gz_bytes)/1024:5.1f} KiB ({chunks} chunk) | uiHash={ui_hash[:18]}…"
        )
        app_id_seq += 1

    # 2. Pack the 3 Zero-Trust Sandboxed Community Starter Apps
    for cspec in COMMUNITY_SANDBOX_APPS:
        slug = cspec["slug"]
        full_html = (APP_SOURCES_DIR / slug / "app.html").read_text()
        raw_bytes = full_html.encode("utf-8")
        gz_bytes = deterministic_gzip(raw_bytes)
        ui_hash = keccak256_hex(gz_bytes)
        slug_id = keccak256_hex(slug.encode("utf-8"))

        out_gz = OUT_BUNDLES_DIR / f"{slug}.html.gz"
        out_gz.write_bytes(gz_bytes)

        chunks = (len(gz_bytes) + 32767) // 32768
        manifest_apps.append(
            {
                "appId": app_id_seq,
                "slug": slug,
                "slugId": slug_id,
                "title": cspec["title"],
                "summary": cspec["summary"],
                "icon": cspec["icon"],
                "category": cspec["category"],
                "version": cspec["version"],
                "execMode": 0,  # SANDBOX_IFRAME
                "uiHash": ui_hash,
                "uncompressedLen": len(raw_bytes),
                "compressedLen": len(gz_bytes),
                "chunkCount": chunks,
                "bundleUrl": f"/app-bundles/{slug}.html.gz",
                "route": f"/apps.html?run={slug}",
                "wasmCodeHash": "0x" + "00" * 32,
                "defaultHfsAddr": "0x" + "00" * 20,
                "publisherLabel": "Community Sandbox · HFS",
                "isSystemCore": False,
            }
        )
        print(
            f"[SBOX #{app_id_seq:02d}] {slug:14s} | raw={len(raw_bytes)/1024:6.1f} KiB -> gzip={len(gz_bytes)/1024:5.1f} KiB ({chunks} chunk) | uiHash={ui_hash[:18]}…"
        )
        app_id_seq += 1

    manifest_obj = {
        "schema": "SuperLexicon-HFS-AppStore-Catalog-v1",
        "appStoreCodeHash": "0xee9d0de546e867f3a564e67cca86ea8988b965246b240eb93c9c2fc83ee90646",
        "chunkSizeBytes": 32768,
        "apps": manifest_apps,
    }
    (OUT_BUNDLES_DIR / "manifest.json").write_text(json.dumps(manifest_obj, indent=2) + "\n")
    print(f"\n✓ Packed {len(manifest_apps)} HFS App Store UI bundles into {OUT_BUNDLES_DIR}")


if __name__ == "__main__":
    main()
