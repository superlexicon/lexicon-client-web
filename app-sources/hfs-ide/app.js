/**
 * SuperLexicon HFS Full-Stack Studio IDE (`app-sources/hfs-ide/app.js`)
 *
 * - Real `#![no_std]` Rust (`hps-sdk`) Smart Contract Editor + `cargo hps studio` sub-second compiler client
 * - Exact In-Browser `WebAssembly` HFS Sandbox VM (`BrowserHfsVm`) matching `WasmtimeAdapter` memory & host imports
 * - Automatic Contract <-> Frontend Integration: parses `hps_entry!` & `event_topic()` live to inject `window.HFS`
 * - Interactive Remix-style ABI Workbench, Live WorldState KV Inspector, and Decoded Event / Console Stream
 * - Deterministic RFC 1952 `.html.gz` bundler + 1-Click Subnet 1 `BYTECODE_STORE` / `0x0101` / `AppStore` publisher
 */

const hostSdk = globalThis.__SLX_HOST_MODULES__?.['@superlexicon/sdk'] || null;
const hostUi = globalThis.__SLX_HOST_MODULES__?.['@superlexicon/sdk/ui'] || null;

const STARTER_TEMPLATES = {
  "counter-pro": {
    "slug": "counter-pro",
    "title": "Atomic Counter & Scoreboard",
    "icon": "⚡",
    "category": 6,
    "version": "1.0.0",
    "summary": "Zero-server atomic bucket counter & per-Identity contribution tracker built with Rust hps-sdk.",
    "rustSource": "#![cfg_attr(target_arch = \"wasm32\", no_std)]\n#![cfg_attr(target_arch = \"wasm32\", no_main)]\n\nuse hps_sdk::abi::CalldataReader;\nuse hps_sdk::storage::KeyBuilder;\nuse hps_sdk::{context, event_topic, events, hps_entry, ret, storage};\n\nconst COUNT_UPDATED: [u8; 32] = event_topic(\"CountUpdated(bytes32,address,uint64)\");\n\nhps_entry! {\n    \"increment(bytes32,uint64)\"     => handle_increment,\n    \"resetBucket(bytes32)\"          => handle_reset,\n    \"getCount(bytes32)\"             => handle_get_count,\n    \"getUserTotal(address)\"         => handle_get_user_total,\n}\n\nfn handle_increment(args: &CalldataReader) -> Result<(), i32> {\n    let bucket = args.bytes32(0).ok_or(-3)?;\n    let delta = args.u64(1).ok_or(-3)?;\n    if delta == 0 || delta > 1_000_000 {\n        return Err(-10);\n    }\n    let sender = context::msg_sender();\n\n    let bucket_key = KeyBuilder::<48>::new().push(b\"cnt:\").push(&bucket);\n    let next_val = storage::get_u64(bucket_key.as_slice()).saturating_add(delta);\n    storage::set_u64(bucket_key.as_slice(), next_val);\n\n    let user_key = KeyBuilder::<32>::new().push(b\"usr:\").push(&sender);\n    let user_val = storage::get_u64(user_key.as_slice()).saturating_add(delta);\n    storage::set_u64(user_key.as_slice(), user_val);\n\n    let mut data = [0u8; 64];\n    data[12..32].copy_from_slice(&sender);\n    data[56..64].copy_from_slice(&next_val.to_be_bytes());\n    events::emit(&[COUNT_UPDATED, bucket], &data);\n\n    ret::write_u64_word(next_val);\n    Ok(())\n}\n\nfn handle_reset(args: &CalldataReader) -> Result<(), i32> {\n    let bucket = args.bytes32(0).ok_or(-3)?;\n    let bucket_key = KeyBuilder::<48>::new().push(b\"cnt:\").push(&bucket);\n    storage::set_u64(bucket_key.as_slice(), 0);\n    ret::write_u64_word(0);\n    Ok(())\n}\n\nfn handle_get_count(args: &CalldataReader) -> Result<(), i32> {\n    let bucket = args.bytes32(0).ok_or(-3)?;\n    let bucket_key = KeyBuilder::<48>::new().push(b\"cnt:\").push(&bucket);\n    ret::write_u64_word(storage::get_u64(bucket_key.as_slice()));\n    Ok(())\n}\n\nfn handle_get_user_total(args: &CalldataReader) -> Result<(), i32> {\n    let account = args.address(0).ok_or(-3)?;\n    let user_key = KeyBuilder::<32>::new().push(b\"usr:\").push(&account);\n    ret::write_u64_word(storage::get_u64(user_key.as_slice()));\n    Ok(())\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    use hps_sdk::{mock, selector};\n\n    #[test]\n    fn increments_bucket_and_tracks_user_total() {\n        mock::reset();\n        mock::set_sender([0xA1; 20]);\n\n        let mut cd = Vec::new();\n        cd.extend_from_slice(&selector(\"increment(bytes32,uint64)\"));\n        cd.extend_from_slice(&[0x11; 32]);\n        let mut w = [0u8; 32];\n        w[24..32].copy_from_slice(&7u64.to_be_bytes());\n        cd.extend_from_slice(&w);\n        assert_eq!(dispatch_calldata(&cd), 0);\n\n        let mut q = Vec::new();\n        q.extend_from_slice(&selector(\"getCount(bytes32)\"));\n        q.extend_from_slice(&[0x11; 32]);\n        assert_eq!(dispatch_calldata(&q), 0);\n        let out = mock::take_return_data();\n        assert_eq!(&out[24..32], &7u64.to_be_bytes());\n    }\n}\n",
    "wasmBase64": "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",
    "codeHash": "0x8460bee4b9047b8d8354c754684cbf13f9bdbf77c47d2718b36b3b7493514f90",
    "optimizedSize": 3210,
    "rawSize": 3246,
    "abi": {
      "events": [
        {
          "constantName": "COUNT_UPDATED",
          "inputs": [
            {
              "kind": "bytes32",
              "name": "field0"
            },
            {
              "kind": "address",
              "name": "field1"
            },
            {
              "kind": "uint64",
              "name": "field2"
            }
          ],
          "name": "CountUpdated",
          "signature": "CountUpdated(bytes32,address,uint64)",
          "topic0": "0x1d93131162e9be7e6b7f8240c93f00e296ec18b3c87669020764423dfd251043"
        }
      ],
      "functions": [
        {
          "handler": "handle_increment",
          "inputs": [
            {
              "kind": "bytes32",
              "name": "bucket"
            },
            {
              "kind": "uint64",
              "name": "delta"
            }
          ],
          "mutability": "nonpayable",
          "name": "increment",
          "returnHint": "uint64",
          "selector": "0xa1dd250a",
          "signature": "increment(bytes32,uint64)"
        },
        {
          "handler": "handle_reset",
          "inputs": [
            {
              "kind": "bytes32",
              "name": "bucket"
            }
          ],
          "mutability": "nonpayable",
          "name": "resetBucket",
          "returnHint": "uint64",
          "selector": "0xd4b87cf2",
          "signature": "resetBucket(bytes32)"
        },
        {
          "handler": "handle_get_count",
          "inputs": [
            {
              "kind": "bytes32",
              "name": "bucket"
            }
          ],
          "mutability": "view",
          "name": "getCount",
          "returnHint": "uint64",
          "selector": "0xc9d6fee9",
          "signature": "getCount(bytes32)"
        },
        {
          "handler": "handle_get_user_total",
          "inputs": [
            {
              "kind": "address",
              "name": "account"
            }
          ],
          "mutability": "view",
          "name": "getUserTotal",
          "returnHint": "uint64",
          "selector": "0x0daaffbc",
          "signature": "getUserTotal(address)"
        }
      ]
    },
    "indexHtml": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <title>Atomic Counter & Scoreboard</title>\n  <link rel=\"stylesheet\" href=\"./styles.css\" />\n</head>\n<body>\n  <div class=\"card\">\n    <div class=\"top-row\">\n      <span class=\"pill\">⚡ Zero-Server Rust HFS • $0.00 Gas</span>\n      <span id=\"actorBadge\" class=\"mono muted\">Connecting…</span>\n    </div>\n    <h2>Atomic Counter &amp; Contributor Ledger</h2>\n    <p class=\"muted\">Every click executes <code>increment(bytes32,uint64)</code> in WASM and updates WorldState KV.</p>\n\n    <div class=\"stats-grid\">\n      <div class=\"stat-box\">\n        <div class=\"stat-lbl\">GLOBAL BUCKET COUNT</div>\n        <div id=\"valGlobal\" class=\"stat-num sky\">0</div>\n      </div>\n      <div class=\"stat-box\">\n        <div class=\"stat-lbl\">YOUR CONTRIBUTIONS</div>\n        <div id=\"valMine\" class=\"stat-num emerald\">0</div>\n      </div>\n    </div>\n\n    <div class=\"controls\">\n      <input id=\"inDelta\" type=\"number\" min=\"1\" max=\"1000\" value=\"5\" />\n      <button id=\"btnInc\" type=\"button\" class=\"btn-primary\">+ Increment</button>\n      <button id=\"btnReset\" type=\"button\" class=\"btn-ghost\">Reset Bucket</button>\n    </div>\n\n    <div id=\"txStatus\" class=\"mono status-line\">Ready.</div>\n  </div>\n  <script type=\"module\" src=\"./app.js\"></script>\n</body>\n</html>",
    "stylesCss": "* { box-sizing: border-box; }\nbody {\n  margin: 0;\n  padding: 20px;\n  background: radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 50%), #050b16;\n  color: #f8fafc;\n  font-family: Inter, system-ui, sans-serif;\n}\n.mono { font-family: ui-monospace, monospace; }\n.muted { color: #94a3b8; font-size: 13px; margin: 4px 0 14px; }\n.card {\n  max-width: 620px;\n  margin: 0 auto;\n  padding: 22px;\n  border-radius: 16px;\n  background: rgba(10, 19, 36, 0.94);\n  border: 1px solid rgba(56, 189, 248, 0.38);\n  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);\n}\n.top-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }\n.pill {\n  padding: 3px 10px;\n  border-radius: 999px;\n  background: rgba(16, 185, 129, 0.16);\n  border: 1px solid rgba(52, 211, 153, 0.48);\n  color: #6ee7b7;\n  font-size: 11px;\n  font-weight: 700;\n}\nh2 { margin: 12px 0 4px; font-size: 20px; }\n.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }\n.stat-box {\n  padding: 14px;\n  border-radius: 12px;\n  background: #040914;\n  border: 1px solid rgba(51, 65, 85, 0.85);\n}\n.stat-lbl { font-size: 10px; font-weight: 800; color: #64748b; letter-spacing: 0.06em; }\n.stat-num { font-size: 30px; font-weight: 900; margin-top: 4px; }\n.sky { color: #38bdf8; }\n.emerald { color: #34d399; }\n.controls { display: flex; gap: 8px; flex-wrap: wrap; }\ninput {\n  width: 110px;\n  padding: 9px 12px;\n  border-radius: 9px;\n  border: 1px solid #334155;\n  background: #02060f;\n  color: #fff;\n  font-size: 14px;\n  font-weight: 700;\n}\nbutton {\n  padding: 9px 15px;\n  border-radius: 9px;\n  font-weight: 800;\n  cursor: pointer;\n  border: 1px solid transparent;\n}\n.btn-primary { background: #0ea5e9; color: #020617; flex: 1; }\n.btn-primary:hover { background: #38bdf8; }\n.btn-ghost { background: rgba(30, 41, 59, 0.8); border-color: #475569; color: #cbd5e1; }\n.status-line { margin-top: 14px; font-size: 12px; color: #7dd3fc; }",
    "appJs": "const BUCKET = HFS.bytes32FromText('global-main');\n\nasync function refresh() {\n  const ctx = await HFS.getContext();\n  document.getElementById('actorBadge').textContent =\n    `${ctx.user.nickname} (Blk #${ctx.blockNumber})`;\n\n  const globalCount = await HFS.views.getCount(BUCKET);\n  const myTotal = await HFS.views.getUserTotal(ctx.actorAddr);\n\n  document.getElementById('valGlobal').textContent = globalCount.toString();\n  document.getElementById('valMine').textContent = myTotal.toString();\n}\n\ndocument.getElementById('btnInc').addEventListener('click', async () => {\n  const delta = Number(document.getElementById('inDelta').value || 1);\n  const statusEl = document.getElementById('txStatus');\n  try {\n    statusEl.textContent = 'Submitting HFS transaction…';\n    const rcpt = await HFS.tx.increment(BUCKET, delta);\n    const ev = rcpt.decodedEvents[0];\n    statusEl.textContent = ev\n      ? `✓ ${ev.name} emitted in Blk #${rcpt.blockNumber} (new total: ${ev.words[1]})`\n      : `✓ Confirmed (${String(rcpt.txHash).slice(0, 12)}…)`;\n    await refresh();\n  } catch (err) {\n    statusEl.textContent = '⚠ ' + err.message;\n  }\n});\n\ndocument.getElementById('btnReset').addEventListener('click', async () => {\n  const statusEl = document.getElementById('txStatus');\n  try {\n    await HFS.tx.resetBucket(BUCKET);\n    statusEl.textContent = '✓ Bucket reset to 0.';\n    await refresh();\n  } catch (err) {\n    statusEl.textContent = '⚠ ' + err.message;\n  }\n});\n\nrefresh();\n"
  },
  "mesh-board": {
    "slug": "mesh-board",
    "title": "Mesh Guestbook & Bulletin Wall",
    "icon": "💬",
    "category": 4,
    "version": "1.0.0",
    "summary": "On-chain UTF-8 bulletin wall storing author Identity, block height, and messages in HFS WorldState.",
    "rustSource": "#![cfg_attr(target_arch = \"wasm32\", no_std)]\n#![cfg_attr(target_arch = \"wasm32\", no_main)]\n\nuse hps_sdk::abi::CalldataReader;\nuse hps_sdk::storage::KeyBuilder;\nuse hps_sdk::{context, event_topic, events, hps_entry, ret, storage};\n\nconst NOTE_POSTED: [u8; 32] = event_topic(\"NotePosted(uint64,address,uint64)\");\nconst MAX_NOTE_BYTES: usize = 280;\n\nhps_entry! {\n    \"postNote(string)\"       => handle_post_note,\n    \"totalNotes()\"           => handle_total_notes,\n    \"getNoteAuthor(uint64)\"  => handle_get_author,\n    \"getNoteBlock(uint64)\"   => handle_get_block,\n    \"getNoteText(uint64)\"    => handle_get_text,\n}\n\nfn handle_post_note(args: &CalldataReader) -> Result<(), i32> {\n    let text = args.dynamic_bytes(0).ok_or(-3)?;\n    if text.is_empty() || text.len() > MAX_NOTE_BYTES {\n        return Err(-11);\n    }\n    let sender = context::msg_sender();\n    let blk = context::block_number();\n    let idx = storage::get_u64(b\"notes:count\");\n\n    let author_key = KeyBuilder::<24>::new().push(b\"na:\").push_u64_be(idx);\n    let block_key = KeyBuilder::<24>::new().push(b\"nb:\").push_u64_be(idx);\n    let text_key = KeyBuilder::<24>::new().push(b\"nt:\").push_u64_be(idx);\n\n    storage::set_address(author_key.as_slice(), &sender);\n    storage::set_u64(block_key.as_slice(), blk);\n    storage::set(text_key.as_slice(), text);\n    storage::set_u64(b\"notes:count\", idx + 1);\n\n    let mut ev_data = [0u8; 96];\n    ev_data[24..32].copy_from_slice(&idx.to_be_bytes());\n    ev_data[44..64].copy_from_slice(&sender);\n    ev_data[88..96].copy_from_slice(&blk.to_be_bytes());\n    events::emit(&[NOTE_POSTED], &ev_data);\n\n    ret::write_u64_word(idx);\n    Ok(())\n}\n\nfn handle_total_notes(_args: &CalldataReader) -> Result<(), i32> {\n    ret::write_u64_word(storage::get_u64(b\"notes:count\"));\n    Ok(())\n}\n\nfn handle_get_author(args: &CalldataReader) -> Result<(), i32> {\n    let index = args.u64(0).ok_or(-3)?;\n    let author_key = KeyBuilder::<24>::new().push(b\"na:\").push_u64_be(index);\n    let addr = storage::get_address(author_key.as_slice()).unwrap_or([0u8; 20]);\n    ret::write_address(&addr);\n    Ok(())\n}\n\nfn handle_get_block(args: &CalldataReader) -> Result<(), i32> {\n    let index = args.u64(0).ok_or(-3)?;\n    let block_key = KeyBuilder::<24>::new().push(b\"nb:\").push_u64_be(index);\n    ret::write_u64_word(storage::get_u64(block_key.as_slice()));\n    Ok(())\n}\n\nfn handle_get_text(args: &CalldataReader) -> Result<(), i32> {\n    let index = args.u64(0).ok_or(-3)?;\n    let text_key = KeyBuilder::<24>::new().push(b\"nt:\").push_u64_be(index);\n    let mut buf = [0u8; MAX_NOTE_BYTES];\n    let len = storage::get_into(text_key.as_slice(), &mut buf).unwrap_or(0);\n    ret::write_abi_bytes(&buf[..len.min(MAX_NOTE_BYTES)]);\n    Ok(())\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    use hps_sdk::{mock, selector};\n\n    #[test]\n    fn posts_and_reads_guestbook_note() {\n        mock::reset();\n        mock::set_sender([0xB2; 20]);\n        mock::set_block_number(42);\n\n        let msg = b\"Hello Halt-Free Mesh!\";\n        let mut cd = Vec::new();\n        cd.extend_from_slice(&selector(\"postNote(string)\"));\n        let mut off = [0u8; 32];\n        off[31] = 0x20;\n        let mut len = [0u8; 32];\n        len[24..32].copy_from_slice(&(msg.len() as u64).to_be_bytes());\n        let mut padded = [0u8; 32];\n        padded[..msg.len()].copy_from_slice(msg);\n        cd.extend_from_slice(&off);\n        cd.extend_from_slice(&len);\n        cd.extend_from_slice(&padded);\n\n        assert_eq!(dispatch_calldata(&cd), 0);\n        assert_eq!(storage::get_u64(b\"notes:count\"), 1);\n    }\n}\n",
    "wasmBase64": "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IBCMgICAACACKAIcIQQgAigCGCEHIAIgBUI4hiAFQoD+A4NCKIaEIAVCgID8B4NCGIYgBUKAgID4D4NCCIaEhCAFQgiIQoCAgPgPgyAFQhiIQoCA/AeDhCAFQiiIQoD+A4MgBUI4iISEhDcDyAEgByAEIAJByAFqQQgQiYCAgAAgAkEQaiACQegBakEsQcAAEIyAgIAAIAIoAhAgAigCFCACQeAAakEUEImAgIAAIAJBCGogAkHoAWpB2ABB4AAQjICAgAAgAigCDCEEIAIoAgghByACIAY3A8gBIAcgBCACQcgBakEIEImAgIAAQQBBACkArIDAgAA3A5iAGEEAQQApAKSAwIAANwOQgBhBAEEAKQCcgMCAADcDiIAYQQBBACkAlIDAgAA3A4CAGEGAgBhBICACQegBakHgABCEgICAACAFEJKAgIAADAcLQYaAwIAAQQsQkICAgAAQkoCAgAAMAwsgAkHoAWpBhIAEIAQQjoCAgAAgAikD6AFCAVINBCACKQPwASEFQQAhAyACQQA2AoACIAJCADcD+AEgAkIANwPwASACQgA3A+gBIAJByAFqIAJB6AFqQZGAwIAAQQMQh4CAgAAgAkGsAWogAkHIAWogBRCGgICAACACQcAAaiACQawBahCKgICAACACKAJEIQQgAigCQCEHIAJBADYC2AEgAkIANwPQASACQgA3A8gBIAJBOGogByAEIAJByAFqQRQQk4CAgAACQCACKAI4IAIoAjxBFEZxIgRBAUcNACACIAIoAtgBNgD5ASACIAIpA9ABNwDxASACIAIpA8gBNwDpAQsgAkEANgLYASACQgA3A9ABIAJCADcDyAEgAiACQegBakEBaiACQcgBaiAEGyIEKQAAIgU3A5ABIAIgBCkACCIGNwOYASACIAQoABAiBDYCoAFBAEEgNgKAgBxBAEIANwKEgBwgAiAENgKEAiACIAY3AvwBQQAgAikDgAI3ApyAHCACIAU3AvQBQQAgAikD+AE3ApSAHCACQQA2AvABQQAgAikD8AE3AoyAHAwFCyACQegBakGEgAQgBBCOgICAACACKQPoAUIBUg0DIAIpA/ABIQVBACEDIAJBADYCgAIgAkIANwP4ASACQgA3A/ABIAJCADcD6AEgAkHIAWogAkHoAWpBg4DAgABBAxCHgICAACACQegBaiACQcgBaiAFEIaAgIAAIAJByABqIAJB6AFqEIqAgIAAIAIoAkggAigCTBCQgICAABCSgICAAAwECyACQegBakGEgAQgBBCOgICAACACKQPoAUIBUg0CIAIpA/ABIQUgAkEANgKAAiACQgA3A/gBIAJCADcD8AEgAkIANwPoASACQcgBaiACQegBakGAgMCAAEEDEIeAgIAAIAJBrAFqIAJByAFqIAUQhoCAgAAgAkHoAWpBAEGYAvwLACACQdgAaiACQawBahCKgICAACACQdAAaiACKAJYIAIoAlwgAkHoAWpBmAIQk4CAgABBACACKAJUIgNBmAIgA0GYAkkbQQAgAigCUEEBcRsiA0EAIANrQR9xakHAAGoiBDYCgIAcAkAgBEUNAEGEgBxBACAE/AsAC0EAQSA6AKOAHEEAIAOtIgVCOIYgBUKA/gODQiiGhCAFQoCA/AeDQhiGIAVCgICA+A+DQgiGhIQ3AryAHCADRQ0AIANFDQBBxIAcIAJB6AFqIAP8CgAAC0EAIQMMAgsgByAJIAQQi4CAgAAAC0F9IQMLIAJBgARqJICAgIAAIAMLhAEBAX5CACEDAkAgAkEgSQ0AIAEQj4CAgAANACAAIAEpABgiA0I4hiADQoD+A4NCKIaEIANCgID8B4NCGIYgA0KAgID4D4NCCIaEhCADQgiIQoCAgPgPgyADQhiIQoCA/AeDhCADQiiIQoD+A4MgA0I4iISEhDcDCEIBIQMLIAAgAzcDAAsVACAAQbSAwIAAQRgQloCAgABBAEcLYwIBfwF+I4CAgIAAQRBrIgIkgICAgAAgAkIANwMIIAIgACABIAJBCGpBCBCTgICAACACKAIEIQEgAikDCCEDIAIoAgAhACACQRBqJICAgIAAIANCACABQQdLG0IAIABBAXEbCzgBAX8jgICAgABBEGsiAySAgICAACADIAI3AwggACABIANBCGpBCBCDgICAACADQRBqJICAgIAAC+EBAQF/I4CAgIAAQTBrIgEkgICAgAAgAUIANwMgIAFCADcDGCABQgA3AxAgAUIANwMIIAEgAEI4hiAAQoD+A4NCKIaEIABCgID8B4NCGIYgAEKAgID4D4NCCIaEhCAAQgiIQoCAgPgPgyAAQhiIQoCA/AeDhCAAQiiIQoD+A4MgAEI4iISEhDcDKCABQSBqQQggAUEoakEIEImAgIAAQQBBIDYCgIAcQQAgASkDIDcCnIAcQQAgASkDGDcClIAcQQAgASkDEDcCjIAcQQAgASkDCDcChIAcIAFBMGokgICAgAALTwACQAJAIAEgAhCFgICAACICQQFODQBBACEEDAELAkAgBCACIAQgAkkbIgRFDQAgA0GAgBAgBPwKAAALQQEhBAsgACACNgIEIAAgBDYCAAsDAAALCQAQlICAgAAAC0oBA39BACEDAkAgAkUNAAJAA0AgAC0AACIEIAEtAAAiBUcNASAAQQFqIQAgAUEBaiEBIAJBf2oiAkUNAgwACwsgBCAFayEDCyADCws9AQBBgIDAAAs0bnQ6bmI6bm90ZXM6Y291bnRuYToU8nHAp4hIltsGImaOCLilVBMCU5sX+oaraw2dj3IcuQ==",
    "codeHash": "0x555fbc5a0936a80267dac796b3bc5d8910b54419245eea06844c9891abb62e22",
    "optimizedSize": 3898,
    "rawSize": 3922,
    "abi": {
      "events": [
        {
          "constantName": "NOTE_POSTED",
          "inputs": [
            {
              "kind": "uint64",
              "name": "field0"
            },
            {
              "kind": "address",
              "name": "field1"
            },
            {
              "kind": "uint64",
              "name": "field2"
            }
          ],
          "name": "NotePosted",
          "signature": "NotePosted(uint64,address,uint64)",
          "topic0": "0x14f271c0a7884896db0622668e08b8a5541302539b17fa86ab6b0d9d8f721cb9"
        }
      ],
      "functions": [
        {
          "handler": "handle_post_note",
          "inputs": [
            {
              "kind": "string",
              "name": "text"
            }
          ],
          "mutability": "nonpayable",
          "name": "postNote",
          "returnHint": "uint64",
          "selector": "0x70b40273",
          "signature": "postNote(string)"
        },
        {
          "handler": "handle_total_notes",
          "inputs": [],
          "mutability": "view",
          "name": "totalNotes",
          "returnHint": "uint64",
          "selector": "0xc1bbf4c1",
          "signature": "totalNotes()"
        },
        {
          "handler": "handle_get_author",
          "inputs": [
            {
              "kind": "uint64",
              "name": "index"
            }
          ],
          "mutability": "view",
          "name": "getNoteAuthor",
          "returnHint": "address",
          "selector": "0x0c314ffb",
          "signature": "getNoteAuthor(uint64)"
        },
        {
          "handler": "handle_get_block",
          "inputs": [
            {
              "kind": "uint64",
              "name": "index"
            }
          ],
          "mutability": "view",
          "name": "getNoteBlock",
          "returnHint": "uint64",
          "selector": "0x6c15baba",
          "signature": "getNoteBlock(uint64)"
        },
        {
          "handler": "handle_get_text",
          "inputs": [
            {
              "kind": "uint64",
              "name": "index"
            }
          ],
          "mutability": "view",
          "name": "getNoteText",
          "returnHint": "bytes",
          "selector": "0xbdce0fe9",
          "signature": "getNoteText(uint64)"
        }
      ]
    },
    "indexHtml": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <title>Mesh Guestbook & Bulletin Wall</title>\n  <link rel=\"stylesheet\" href=\"./styles.css\" />\n</head>\n<body>\n  <div class=\"wrap\">\n    <div class=\"hdr\">\n      <div>\n        <span class=\"badge\">💬 Zero-DB On-Chain Bulletin HFS</span>\n        <h2>Mesh Guestbook Wall</h2>\n      </div>\n      <div id=\"whoLine\" class=\"mono sub\"></div>\n    </div>\n\n    <div class=\"composer\">\n      <input id=\"inMessage\" type=\"text\" maxlength=\"240\" placeholder=\"Write a permanent mesh note (up to 240 chars)…\" />\n      <button id=\"btnPost\" type=\"button\">Post ($0 Gas)</button>\n    </div>\n    <div id=\"msgStatus\" class=\"mono status\"></div>\n\n    <div id=\"notesFeed\" class=\"feed\"></div>\n  </div>\n  <script type=\"module\" src=\"./app.js\"></script>\n</body>\n</html>",
    "stylesCss": "* { box-sizing: border-box; }\nbody { margin: 0; padding: 18px; background: #050b16; color: #f8fafc; font-family: Inter, system-ui, sans-serif; }\n.mono { font-family: ui-monospace, monospace; }\n.wrap { max-width: 640px; margin: 0 auto; }\n.hdr { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }\n.badge { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(14,165,233,0.18); border: 1px solid rgba(56,189,248,0.45); color: #7dd3fc; }\nh2 { margin: 8px 0 0; font-size: 20px; }\n.sub { font-size: 12px; color: #94a3b8; }\n.composer { display: flex; gap: 8px; }\ninput {\n  flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #334155;\n  background: #091326; color: #f8fafc; font-size: 13px;\n}\nbutton {\n  padding: 10px 16px; border-radius: 10px; border: none;\n  background: linear-gradient(135deg, #10b981, #0284c7); color: #fff; font-weight: 800; cursor: pointer;\n}\n.status { font-size: 12px; color: #6ee7b7; margin: 8px 0 12px; min-height: 16px; }\n.feed { display: flex; flex-direction: column; gap: 9px; }\n.note {\n  padding: 12px 14px; border-radius: 12px; background: #0a152a;\n  border: 1px solid rgba(51, 65, 85, 0.85);\n}\n.note-meta { display: flex; justify-content: space-between; font-size: 11px; color: #7dd3fc; margin-bottom: 5px; }\n.note-body { font-size: 14px; color: #f1f5f9; line-height: 1.45; }",
    "appJs": "async function renderWall() {\n  const ctx = await HFS.getContext();\n  document.getElementById('whoLine').textContent = `Posting as ${ctx.user.nickname}`;\n\n  const total = Number(await HFS.views.totalNotes());\n  const feed = document.getElementById('notesFeed');\n  if (total === 0) {\n    feed.innerHTML = '<div class=\"note\"><div class=\"note-body\" style=\"color:#94a3b8;\">No notes yet — post the genesis message above!</div></div>';\n    return;\n  }\n\n  const cards = [];\n  const start = Math.max(0, total - 15);\n  for (let i = total - 1; i >= start; i--) {\n    const [author, blk, text] = await Promise.all([\n      HFS.views.getNoteAuthor(i),\n      HFS.views.getNoteBlock(i),\n      HFS.views.getNoteText(i),\n    ]);\n    const shortAuthor = author.slice(0, 8) + '…' + author.slice(-4);\n    const safeText = String(text).replace(/</g, '&lt;');\n    cards.push(`\n      <div class=\"note\">\n        <div class=\"note-meta mono\">\n          <span>#${i} • ${shortAuthor}</span>\n          <span>Block #${blk}</span>\n        </div>\n        <div class=\"note-body\">${safeText}</div>\n      </div>\n    `);\n  }\n  feed.innerHTML = cards.join('');\n}\n\ndocument.getElementById('btnPost').addEventListener('click', async () => {\n  const input = document.getElementById('inMessage');\n  const text = input.value.trim();\n  if (!text) return;\n  const st = document.getElementById('msgStatus');\n  try {\n    st.textContent = 'Sealing note in HFS WorldState…';\n    await HFS.tx.postNote(text);\n    input.value = '';\n    st.textContent = '✓ Note sealed!';\n    await renderWall();\n  } catch (err) {\n    st.textContent = '⚠ ' + err.message;\n  }\n});\n\nrenderWall();\n"
  },
  "pledge-vault": {
    "slug": "pledge-vault",
    "title": "Milestone Pledge & Treasury Vault",
    "icon": "🏦",
    "category": 3,
    "version": "1.0.0",
    "summary": "Escrow pledge vault enforcing checked integer arithmetic, backer balances, and funding goal progress.",
    "rustSource": "#![cfg_attr(target_arch = \"wasm32\", no_std)]\n#![cfg_attr(target_arch = \"wasm32\", no_main)]\n\nuse hps_sdk::abi::CalldataReader;\nuse hps_sdk::storage::KeyBuilder;\nuse hps_sdk::{context, event_topic, events, hps_entry, ret, storage};\n\nconst VAULT_EVENT: [u8; 32] = event_topic(\"VaultUpdated(address,uint64,uint64)\");\n\nhps_entry! {\n    \"setGoal(uint64)\"            => handle_set_goal,\n    \"pledge(uint64)\"             => handle_pledge,\n    \"withdraw(uint64)\"           => handle_withdraw,\n    \"getGoal()\"                  => handle_get_goal,\n    \"getTotalPledged()\"          => handle_get_total,\n    \"getBackerPledge(address)\"   => handle_get_backer,\n}\n\nfn ensure_default_goal() -> u64 {\n    let g = storage::get_u64(b\"vault:goal\");\n    if g == 0 { 1000 } else { g }\n}\n\nfn handle_set_goal(args: &CalldataReader) -> Result<(), i32> {\n    let target = args.u64(0).ok_or(-3)?;\n    if target == 0 {\n        return Err(-12);\n    }\n    let sender = context::msg_sender();\n    if let Some(org) = storage::get_address(b\"vault:org\") {\n        if org != sender {\n            return Err(-40);\n        }\n    } else {\n        storage::set_address(b\"vault:org\", &sender);\n    }\n    storage::set_u64(b\"vault:goal\", target);\n    ret::write_u64_word(target);\n    Ok(())\n}\n\nfn handle_pledge(args: &CalldataReader) -> Result<(), i32> {\n    let amount = args.u64(0).ok_or(-3)?;\n    if amount == 0 {\n        return Err(-13);\n    }\n    let sender = context::msg_sender();\n    let key = KeyBuilder::<32>::new().push(b\"plg:\").push(&sender);\n    let my_next = storage::get_u64(key.as_slice()).saturating_add(amount);\n    let total_next = storage::get_u64(b\"vault:total\").saturating_add(amount);\n\n    storage::set_u64(key.as_slice(), my_next);\n    storage::set_u64(b\"vault:total\", total_next);\n\n    let mut data = [0u8; 96];\n    data[12..32].copy_from_slice(&sender);\n    data[56..64].copy_from_slice(&my_next.to_be_bytes());\n    data[88..96].copy_from_slice(&total_next.to_be_bytes());\n    events::emit(&[VAULT_EVENT], &data);\n\n    ret::write_u64_word(total_next);\n    Ok(())\n}\n\nfn handle_withdraw(args: &CalldataReader) -> Result<(), i32> {\n    let amount = args.u64(0).ok_or(-3)?;\n    let sender = context::msg_sender();\n    let key = KeyBuilder::<32>::new().push(b\"plg:\").push(&sender);\n    let cur = storage::get_u64(key.as_slice());\n    let next_bal = cur.checked_sub(amount).ok_or(-21)?;\n    let next_total = storage::get_u64(b\"vault:total\").saturating_sub(amount);\n\n    storage::set_u64(key.as_slice(), next_bal);\n    storage::set_u64(b\"vault:total\", next_total);\n\n    let mut data = [0u8; 96];\n    data[12..32].copy_from_slice(&sender);\n    data[56..64].copy_from_slice(&next_bal.to_be_bytes());\n    data[88..96].copy_from_slice(&next_total.to_be_bytes());\n    events::emit(&[VAULT_EVENT], &data);\n\n    ret::write_u64_word(next_bal);\n    Ok(())\n}\n\nfn handle_get_goal(_args: &CalldataReader) -> Result<(), i32> {\n    ret::write_u64_word(ensure_default_goal());\n    Ok(())\n}\n\nfn handle_get_total(_args: &CalldataReader) -> Result<(), i32> {\n    ret::write_u64_word(storage::get_u64(b\"vault:total\"));\n    Ok(())\n}\n\nfn handle_get_backer(args: &CalldataReader) -> Result<(), i32> {\n    let backer = args.address(0).ok_or(-3)?;\n    let key = KeyBuilder::<32>::new().push(b\"plg:\").push(&backer);\n    ret::write_u64_word(storage::get_u64(key.as_slice()));\n    Ok(())\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    use hps_sdk::{mock, selector};\n\n    #[test]\n    fn enforces_checked_sub_on_withdraw() {\n        mock::reset();\n        mock::set_sender([0xC3; 20]);\n        let mut p = Vec::from(selector(\"pledge(uint64)\"));\n        let mut w = [0u8; 32];\n        w[24..32].copy_from_slice(&100u64.to_be_bytes());\n        p.extend_from_slice(&w);\n        assert_eq!(dispatch_calldata(&p), 0);\n\n        let mut bad = Vec::from(selector(\"withdraw(uint64)\"));\n        w[24..32].copy_from_slice(&250u64.to_be_bytes());\n        bad.extend_from_slice(&w);\n        assert_eq!(dispatch_calldata(&bad), -21);\n    }\n}\n",
    "wasmBase64": "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",
    "codeHash": "0x21fc8b1431f0451ab7b26519260343a567ec67be1a94c5a25c542460565702f7",
    "optimizedSize": 3461,
    "rawSize": 3497,
    "abi": {
      "events": [
        {
          "constantName": "VAULT_EVENT",
          "inputs": [
            {
              "kind": "address",
              "name": "field0"
            },
            {
              "kind": "uint64",
              "name": "field1"
            },
            {
              "kind": "uint64",
              "name": "field2"
            }
          ],
          "name": "VaultUpdated",
          "signature": "VaultUpdated(address,uint64,uint64)",
          "topic0": "0x2da1f953b72256e994c5ddf9ba2bfab6d7d4121304e87d02611339cc9d9a41f4"
        }
      ],
      "functions": [
        {
          "handler": "handle_set_goal",
          "inputs": [
            {
              "kind": "uint64",
              "name": "target"
            }
          ],
          "mutability": "nonpayable",
          "name": "setGoal",
          "returnHint": "uint64",
          "selector": "0xf12c633d",
          "signature": "setGoal(uint64)"
        },
        {
          "handler": "handle_pledge",
          "inputs": [
            {
              "kind": "uint64",
              "name": "amount"
            }
          ],
          "mutability": "nonpayable",
          "name": "pledge",
          "returnHint": "uint64",
          "selector": "0x66e98dc6",
          "signature": "pledge(uint64)"
        },
        {
          "handler": "handle_withdraw",
          "inputs": [
            {
              "kind": "uint64",
              "name": "amount"
            }
          ],
          "mutability": "nonpayable",
          "name": "withdraw",
          "returnHint": "uint64",
          "selector": "0x750f0acc",
          "signature": "withdraw(uint64)"
        },
        {
          "handler": "handle_get_goal",
          "inputs": [],
          "mutability": "view",
          "name": "getGoal",
          "returnHint": "uint64",
          "selector": "0xb97a7d24",
          "signature": "getGoal()"
        },
        {
          "handler": "handle_get_total",
          "inputs": [],
          "mutability": "view",
          "name": "getTotalPledged",
          "returnHint": "uint64",
          "selector": "0x04b19a0c",
          "signature": "getTotalPledged()"
        },
        {
          "handler": "handle_get_backer",
          "inputs": [
            {
              "kind": "address",
              "name": "backer"
            }
          ],
          "mutability": "view",
          "name": "getBackerPledge",
          "returnHint": "uint64",
          "selector": "0xb61affcb",
          "signature": "getBackerPledge(address)"
        }
      ]
    },
    "indexHtml": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <title>Milestone Pledge Vault</title>\n  <link rel=\"stylesheet\" href=\"./styles.css\" />\n</head>\n<body>\n  <div class=\"vault-card\">\n    <span class=\"tag mono\">🏦 Checked-Arithmetic Escrow HFS</span>\n    <h2>Community Hardware Milestone Vault</h2>\n    <div id=\"callerTag\" class=\"mono muted\"></div>\n\n    <div class=\"meter-wrap\">\n      <div class=\"meter-labels mono\">\n        <span>Raised: <strong id=\"lblRaised\">0</strong> units</span>\n        <span>Goal: <strong id=\"lblGoal\">1000</strong> units (<span id=\"lblPct\">0</span>%)</span>\n      </div>\n      <div class=\"bar\"><div id=\"barFill\" class=\"fill\" style=\"width:0%\"></div></div>\n    </div>\n\n    <div class=\"my-box mono\">\n      Your Active Pledge Balance: <strong id=\"lblMyBal\" style=\"color:#34d399;\">0</strong> units\n    </div>\n\n    <div class=\"row\">\n      <input id=\"inAmt\" type=\"number\" min=\"1\" value=\"150\" />\n      <button id=\"btnPledge\" class=\"btn-em\" type=\"button\">+ Pledge</button>\n      <button id=\"btnWithdraw\" class=\"btn-rose\" type=\"button\">− Withdraw</button>\n    </div>\n\n    <div class=\"row\" style=\"margin-top:10px;\">\n      <input id=\"inNewGoal\" type=\"number\" min=\"100\" value=\"1500\" />\n      <button id=\"btnSetGoal\" class=\"btn-sky\" type=\"button\">Set Target Goal (Organizer)</button>\n    </div>\n\n    <div id=\"vaultLog\" class=\"mono log\">Ready.</div>\n  </div>\n  <script type=\"module\" src=\"./app.js\"></script>\n</body>\n</html>",
    "stylesCss": "* { box-sizing: border-box; }\nbody { margin: 0; padding: 20px; background: #050b16; color: #f8fafc; font-family: Inter, system-ui, sans-serif; }\n.mono { font-family: ui-monospace, monospace; }\n.vault-card {\n  max-width: 600px; margin: 0 auto; padding: 22px; border-radius: 16px;\n  background: #0a1428; border: 1px solid rgba(52, 211, 153, 0.4);\n}\n.tag { padding: 3px 9px; border-radius: 999px; font-size: 11px; background: rgba(16,185,129,0.16); color: #6ee7b7; border: 1px solid rgba(52,211,153,0.45); }\nh2 { margin: 10px 0 4px; font-size: 19px; }\n.muted { font-size: 12px; color: #94a3b8; margin-bottom: 14px; }\n.meter-wrap { background: #040914; padding: 14px; border-radius: 12px; border: 1px solid #1e293b; }\n.meter-labels { display: flex; justify-content: space-between; font-size: 12px; color: #cbd5e1; margin-bottom: 8px; }\n.bar { height: 12px; border-radius: 999px; background: #1e293b; overflow: hidden; }\n.fill { height: 100%; background: linear-gradient(90deg, #10b981, #38bdf8); transition: width 0.25s ease; }\n.my-box { margin: 12px 0; padding: 10px 12px; border-radius: 9px; background: rgba(15, 23, 42, 0.8); font-size: 12.5px; }\n.row { display: flex; gap: 8px; flex-wrap: wrap; }\ninput { width: 130px; padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; background: #02060f; color: #fff; font-weight: 700; }\nbutton { padding: 8px 14px; border-radius: 8px; border: none; font-weight: 800; cursor: pointer; font-size: 12.5px; }\n.btn-em { background: #10b981; color: #022c22; flex: 1; }\n.btn-rose { background: rgba(244, 63, 94, 0.22); color: #fecdd3; border: 1px solid rgba(244, 63, 94, 0.5); }\n.btn-sky { background: rgba(14, 165, 233, 0.22); color: #bae6fd; border: 1px solid rgba(56, 189, 248, 0.5); flex: 1; }\n.log { margin-top: 12px; font-size: 12px; color: #7dd3fc; }",
    "appJs": "async function syncVault() {\n  const ctx = await HFS.getContext();\n  document.getElementById('callerTag').textContent = `Active Backer: ${ctx.user.nickname}`;\n\n  const [goal, total, myBal] = await Promise.all([\n    HFS.views.getGoal(),\n    HFS.views.getTotalPledged(),\n    HFS.views.getBackerPledge(ctx.actorAddr),\n  ]);\n  const g = Number(goal) || 1000;\n  const t = Number(total);\n  const pct = Math.min(100, Math.round((t * 100) / g));\n\n  document.getElementById('lblGoal').textContent = g.toString();\n  document.getElementById('lblRaised').textContent = t.toString();\n  document.getElementById('lblPct').textContent = pct.toString();\n  document.getElementById('barFill').style.width = pct + '%';\n  document.getElementById('lblMyBal').textContent = myBal.toString();\n}\n\ndocument.getElementById('btnPledge').addEventListener('click', async () => {\n  const amt = Number(document.getElementById('inAmt').value || 0);\n  const log = document.getElementById('vaultLog');\n  try {\n    await HFS.tx.pledge(amt);\n    log.textContent = `✓ Pledged +${amt} units!`;\n    await syncVault();\n  } catch (e) {\n    log.textContent = '⚠ ' + e.message;\n  }\n});\n\ndocument.getElementById('btnWithdraw').addEventListener('click', async () => {\n  const amt = Number(document.getElementById('inAmt').value || 0);\n  const log = document.getElementById('vaultLog');\n  try {\n    await HFS.tx.withdraw(amt);\n    log.textContent = `✓ Withdrew ${amt} units.`;\n    await syncVault();\n  } catch (e) {\n    log.textContent = '⚠ Revert (-21 checked_sub guard): ' + e.message;\n  }\n});\n\ndocument.getElementById('btnSetGoal').addEventListener('click', async () => {\n  const target = Number(document.getElementById('inNewGoal').value || 1000);\n  const log = document.getElementById('vaultLog');\n  try {\n    await HFS.tx.setGoal(target);\n    log.textContent = `✓ Updated vault goal to ${target} units.`;\n    await syncVault();\n  } catch (e) {\n    log.textContent = '⚠ Organizer check (-40): ' + e.message;\n  }\n});\n\nsyncVault();\n"
  },
  "math-duel": {
    "slug": "math-duel",
    "title": "Prime Congruence Duel (Mod p)",
    "icon": "🧮",
    "category": 5,
    "version": "1.0.0",
    "summary": "Educational finite-field clock arithmetic game: solve Keccak-seeded prime congruences (a*x + b ≡ target mod p) on-chain!",
    "rustSource": "#![cfg_attr(target_arch = \"wasm32\", no_std)]\n#![cfg_attr(target_arch = \"wasm32\", no_main)]\n\nuse hps_sdk::abi::CalldataReader;\nuse hps_sdk::keccak::keccak256;\nuse hps_sdk::storage::KeyBuilder;\nuse hps_sdk::{context, event_topic, events, hps_entry, ret, storage};\n\nconst PUZZLE_RESOLVED: [u8; 32] = event_topic(\"PuzzleResolved(address,uint64,uint64,uint64)\");\n\nhps_entry! {\n    \"newChallenge(uint64)\"     => handle_new_challenge,\n    \"submitAnswer(uint64)\"     => handle_submit_answer,\n    \"getPlayerState(address)\"  => handle_get_player_state,\n}\n\nfn player_key(tag: &[u8; 4], player: &[u8; 20]) -> KeyBuilder<24> {\n    KeyBuilder::<24>::new().push(tag).push(player)\n}\n\nfn handle_new_challenge(args: &CalldataReader) -> Result<(), i32> {\n    let difficulty = args.u64(0).unwrap_or(1).clamp(1, 3);\n    let player = context::msg_sender();\n    let blk = context::block_number();\n    let nonce = storage::get_u64(player_key(b\"nnc:\", &player).as_slice()).wrapping_add(1);\n    storage::set_u64(player_key(b\"nnc:\", &player).as_slice(), nonce);\n\n    let mut seed_in = [0u8; 44];\n    seed_in[0..20].copy_from_slice(&player);\n    seed_in[20..28].copy_from_slice(&blk.to_be_bytes());\n    seed_in[28..36].copy_from_slice(&nonce.to_be_bytes());\n    seed_in[36..44].copy_from_slice(&difficulty.to_be_bytes());\n    let h = keccak256(&seed_in);\n\n    let modulus: u64 = match difficulty {\n        1 => 13,\n        2 => 29,\n        _ => 53,\n    };\n    let a = (h[0] as u64 % (modulus - 1)) + 1; // 1..m-1 (coprime since m is prime!)\n    let secret_x = h[1] as u64 % modulus;\n    let b = h[2] as u64 % modulus;\n    let target = (a * secret_x + b) % modulus;\n\n    let mut packed = [0u8; 32];\n    packed[0..8].copy_from_slice(&a.to_be_bytes());\n    packed[8..16].copy_from_slice(&b.to_be_bytes());\n    packed[16..24].copy_from_slice(&modulus.to_be_bytes());\n    packed[24..32].copy_from_slice(&target.to_be_bytes());\n    storage::set(player_key(b\"puz:\", &player).as_slice(), &packed);\n\n    ret::write(&packed);\n    Ok(())\n}\n\nfn handle_submit_answer(args: &CalldataReader) -> Result<(), i32> {\n    let guess_x = args.u64(0).ok_or(-3)?;\n    let player = context::msg_sender();\n    let mut packed = [0u8; 32];\n    if storage::get_into(player_key(b\"puz:\", &player).as_slice(), &mut packed) != Some(32) {\n        return Err(-15);\n    }\n    let a = u64::from_be_bytes(packed[0..8].try_into().unwrap());\n    let b = u64::from_be_bytes(packed[8..16].try_into().unwrap());\n    let modulus = u64::from_be_bytes(packed[16..24].try_into().unwrap());\n    let target = u64::from_be_bytes(packed[24..32].try_into().unwrap());\n    if modulus == 0 {\n        return Err(-15);\n    }\n\n    let lhs = (a.saturating_mul(guess_x % modulus).saturating_add(b)) % modulus;\n    let solved = if lhs == target { 1u64 } else { 0u64 };\n\n    let streak_k = player_key(b\"stk:\", &player);\n    let score_k = player_key(b\"scr:\", &player);\n    let next_streak = if solved == 1 {\n        storage::get_u64(streak_k.as_slice()) + 1\n    } else {\n        0\n    };\n    let next_score = if solved == 1 {\n        storage::get_u64(score_k.as_slice()) + 10 * next_streak\n    } else {\n        storage::get_u64(score_k.as_slice())\n    };\n    storage::set_u64(streak_k.as_slice(), next_streak);\n    storage::set_u64(score_k.as_slice(), next_score);\n\n    let mut ev = [0u8; 128];\n    ev[12..32].copy_from_slice(&player);\n    ev[56..64].copy_from_slice(&solved.to_be_bytes());\n    ev[88..96].copy_from_slice(&next_score.to_be_bytes());\n    ev[120..128].copy_from_slice(&next_streak.to_be_bytes());\n    events::emit(&[PUZZLE_RESOLVED], &ev);\n\n    ret::write_u64_word(solved);\n    Ok(())\n}\n\nfn handle_get_player_state(args: &CalldataReader) -> Result<(), i32> {\n    let player = args.address(0).ok_or(-3)?;\n    let mut puz = [0u8; 32];\n    let has_puz = storage::get_into(player_key(b\"puz:\", &player).as_slice(), &mut puz) == Some(32);\n    let (a, b, m, t) = if has_puz {\n        (\n            u64::from_be_bytes(puz[0..8].try_into().unwrap()),\n            u64::from_be_bytes(puz[8..16].try_into().unwrap()),\n            u64::from_be_bytes(puz[16..24].try_into().unwrap()),\n            u64::from_be_bytes(puz[24..32].try_into().unwrap()),\n        )\n    } else {\n        (3, 5, 13, 11)\n    };\n    let score = storage::get_u64(player_key(b\"scr:\", &player).as_slice());\n    let streak = storage::get_u64(player_key(b\"stk:\", &player).as_slice());\n\n    let mut out = [0u8; 192];\n    for (i, v) in [a, b, m, t, score, streak].into_iter().enumerate() {\n        out[i * 32 + 24..(i + 1) * 32].copy_from_slice(&v.to_be_bytes());\n    }\n    ret::write(&out);\n    Ok(())\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    use hps_sdk::{mock, selector};\n\n    #[test]\n    fn generates_and_solves_prime_congruence() {\n        mock::reset();\n        mock::set_sender([0xD4; 20]);\n        mock::set_block_number(9);\n\n        let mut cd = Vec::from(selector(\"newChallenge(uint64)\"));\n        let mut w = [0u8; 32];\n        w[31] = 1;\n        cd.extend_from_slice(&w);\n        assert_eq!(dispatch_calldata(&cd), 0);\n        let puz = mock::take_return_data();\n        let a = u64::from_be_bytes(puz[0..8].try_into().unwrap());\n        let b = u64::from_be_bytes(puz[8..16].try_into().unwrap());\n        let m = u64::from_be_bytes(puz[16..24].try_into().unwrap());\n        let target = u64::from_be_bytes(puz[24..32].try_into().unwrap());\n\n        let x = (0..m).find(|&cand| (a * cand + b) % m == target).unwrap();\n        let mut ans = Vec::from(selector(\"submitAnswer(uint64)\"));\n        w[24..32].copy_from_slice(&x.to_be_bytes());\n        ans.extend_from_slice(&w);\n        assert_eq!(dispatch_calldata(&ans), 0);\n        let res = mock::take_return_data();\n        assert_eq!(res[31], 1);\n    }\n}\n",
    "wasmBase64": "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AigCzAEhCCACKALIASEJIAIgB0I4hiAHQoD+A4NCKIaEIAdCgID8B4NCGIYgB0KAgID4D4NCCIaEhCAHQgiIQoCAgPgPgyAHQhiIQoCA/AeDhCAHQiiIQoD+A4MgB0I4iISEhDcDyAQgCSAIIAJByARqQQgQiYCAgAAgA0EgaiEDIARBCGohBAwACwtBACEDQQBBwAE2AoCAHEGEgBwgAkHIAmpBwAH8CgAADAELQX0hAwsgAkHQBGokgICAgAAgAwuMAQEBfkIAIQMCQCACQSBJDQAgAUGwgMCAAEEYEJqAgIAADQAgACABKQAYIgNCOIYgA0KA/gODQiiGhCADQoCA/AeDQhiGIANCgICA+A+DQgiGhIQgA0IIiEKAgID4D4MgA0IYiEKAgPwHg4QgA0IoiEKA/gODIANCOIiEhIQ3AwhCASEDCyAAIAM3AwALMABBgIAIEISAgIAAIABBACgCkIAINgAQIABBACkDiIAINwAIIABBACkDgIAINwAAC2MCAX8BfiOAgICAAEEQayICJICAgIAAIAJCADcDCCACIAAgASACQQhqQQgQlYCAgAAgAigCBCEBIAIpAwghAyACKAIAIQAgAkEQaiSAgICAACADQgAgAUEHSxtCACAAQQFxGws4AQF/I4CAgIAAQRBrIgMkgICAgAAgAyACNwMIIAAgASADQQhqQQgQgoCAgAAgA0EQaiSAgICAAAvnAgECfyOAgICAAEGgBGsiAiSAgICAAEEAIQMgAkEIakEAQcgB/AsAIAJB0AFqQQBBiAH8CwADQAJAIANBLEcNACACIAItAPwBQQFzOgD8ASACIAItANcCQYABczoA1wJBACEDAkADQAJAIANBiAFHDQAgAkHYAmogAkEIahCZgICAACACQQhqIAJB2AJqQcgB/AoAACAAQgA3ABggAEIANwAQIABCADcACCAAQgA3AABBACEBA0AgAUEERg0DIAIgAkEIaiABQQN0aikDADcD2AJBACEDA0ACQCADQQhHDQAgAEEIaiEAIAFBAWohAQwCCyAAIANqIAJB2AJqIANqLQAAOgAAIANBAWohAwwACwsLIAJBCGogA2oiASABKQMAIAJB0AFqIANqKQAAhTcDACADQQhqIQMMAAsLIAJBoARqJICAgIAADwsgAkHQAWogA2ogASADai0AADoAACADQQFqIQMMAAsLTwACQAJAIAEgAhCFgICAACICQQFODQBBACEEDAELAkAgBCACIAQgAkkbIgRFDQAgA0GAgBAgBPwKAAALQQEhBAsgACACNgIEIAAgBDYCAAsDAAALCQAQloCAgAAACwkAEJaAgIAAAAvOBQQFfwF+BH8BfiOAgICAAEHQAGsiAiSAgICAAEEAIQMCQANAIANBGEYNASACQQBBKPwLAEFYIQQDQAJAIAQNAEEAIQUgASEGA0ACQAJAAkACQCAFQQVHDQAgASkDCCEHQaB/IQQDQAJAIAQNAEEAIQZBGSEIIAEhCQNAIAZBGEsNBEEAIQQgAkEoakEAQSj8CwAgAkEoaiEKIAkhBQNAAkAgBEEFRw0AQQAhCiAGIQVBACEEA0ACQCAEQShHDQAgCUEoaiEJIAhBe2ohCCAGQQVqIQYMBAsCQCAKIAhGDQAgCSAEaiILIAspAwAgAkEoakFoQRAgCkECSxsgBGpqKQMAIAJBKGpBACAKQQFqIgsgCkEERhtBA3RqKQMAQn+Fg4U3AwAgBUEBaiEFIARBCGohBCALIQoMAQsLIAVBGRCXgICAAAALIAYgBGoiC0FnakUNBiAKIAUpAwA3AwAgBUEIaiEFIApBCGohCiAEQQFqIQQMAAsLCyABIARB+ILAgABqKAIAQQN0aiIKKQMAIQwgCiAHIARB2IPAgABqNQIAiTcDACAEQQRqIQQgDCEHDAALC0EAIQQgAkEAIAVBAWoiCSAFQQRGG0EDdGopAwBCAYkgAiAFQX9qQQQgBRtBA3RqKQMAhSEHIAYhCgNAIARBGEsNAwJAIAUgBGoiC0EYSw0AIAogByAKKQMAhTcDACAKQShqIQogBEEFaiEEDAELCyALQRkQl4CAgAAACyABIAEpAwAgA0EDdCkD2IDAgACFNwMAIANBAWohAwwFCyALQRkQl4CAgAAACyAGQQhqIQYgCSEFDAALCyACIARqQShqIAEgBGoiCkHQAGopAwAgCkEoaikDAIUgCkH4AGopAwCFIApBoAFqKQMAhSAKQcgBaikDAIU3AwAgBEEIaiEEDAALCwsgACABQcgB/AoAACACQdAAaiSAgICAAAtKAQN/QQAhAwJAIAJFDQACQANAIAAtAAAiBCABLQAAIgVHDQEgAEEBaiEAIAFBAWohASACQX9qIgJFDQIMAAsLIAQgBWshAwsgAwtuAQZ+IAAgA0L/////D4MiBSABQv////8PgyIGfiIHIANCIIgiCCAGfiIGIAUgAUIgiCIJfnwiBUIghnwiCjcDACAAIAggCX4gBSAGVK1CIIYgBUIgiIR8IAogB1StfCAEIAF+IAMgAn58fDcDCAsL3wMBAEGAgMAAC9UDbm5jOnB1ejpzdGs6c2NyOlQ+YWL/mTAFtURtbQJnjiFEDHimhbDuOSNEa15wsxO7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAgoAAAAAAAACKgAAAAAAAgACAAIAAAACAi4AAAAAAAAABAACAAAAAAIGAAIAAAACACYAAAAAAAICKAAAAAAAAAIgAAAAAAAAACYAAgAAAAAAKAACAAAAAAIuAAIAAAAAAiwAAAAAAAICJgAAAAAAAgAOAAAAAAACAAoAAAAAAAICAAAAAAAAAgAqAAAAAAAAACgAAgAAAAICBgACAAAAAgICAAAAAAACAAQAAgAAAAAAIgACAAAAAgAoAAAAHAAAACwAAABEAAAASAAAAAwAAAAUAAAAQAAAACAAAABUAAAAYAAAABAAAAA8AAAAXAAAAEwAAAA0AAAAMAAAAAgAAABQAAAAOAAAAFgAAAAkAAAAGAAAAAQAAAAEAAAADAAAABgAAAAoAAAAPAAAAFQAAABwAAAAkAAAALQAAADcAAAACAAAADgAAABsAAAApAAAAOAAAAAgAAAAZAAAAKwAAAD4AAAASAAAAJwAAAD0AAAAUAAAALA==",
    "codeHash": "0x6b5d1e118604bca1be9a2d618a53dc3e1081f5c01de248edc176b5581c8dea43",
    "optimizedSize": 6895,
    "rawSize": 6898,
    "abi": {
      "events": [
        {
          "constantName": "PUZZLE_RESOLVED",
          "inputs": [
            {
              "kind": "address",
              "name": "field0"
            },
            {
              "kind": "uint64",
              "name": "field1"
            },
            {
              "kind": "uint64",
              "name": "field2"
            },
            {
              "kind": "uint64",
              "name": "field3"
            }
          ],
          "name": "PuzzleResolved",
          "signature": "PuzzleResolved(address,uint64,uint64,uint64)",
          "topic0": "0x543e6162ff993005b5446d6d02678e21440c78a685b0ee3923446b5e70b313bb"
        }
      ],
      "functions": [
        {
          "handler": "handle_new_challenge",
          "inputs": [
            {
              "kind": "uint64",
              "name": "difficulty"
            }
          ],
          "mutability": "nonpayable",
          "name": "newChallenge",
          "returnHint": "bytes",
          "selector": "0x7edc0038",
          "signature": "newChallenge(uint64)"
        },
        {
          "handler": "handle_submit_answer",
          "inputs": [
            {
              "kind": "uint64",
              "name": "guess_x"
            }
          ],
          "mutability": "nonpayable",
          "name": "submitAnswer",
          "returnHint": "uint64",
          "selector": "0x2e08f2fa",
          "signature": "submitAnswer(uint64)"
        },
        {
          "handler": "handle_get_player_state",
          "inputs": [
            {
              "kind": "address",
              "name": "player"
            }
          ],
          "mutability": "view",
          "name": "getPlayerState",
          "returnHint": "bytes",
          "selector": "0xc01ca43f",
          "signature": "getPlayerState(address)"
        }
      ]
    },
    "indexHtml": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <title>Prime Congruence Duel</title>\n  <link rel=\"stylesheet\" href=\"./styles.css\" />\n</head>\n<body>\n  <div class=\"arena\">\n    <div class=\"top\">\n      <span class=\"pill mono\">🧮 Finite-Field Math &amp; Keccak HFS</span>\n      <span id=\"scoreHud\" class=\"mono hud\">Score: 0 • Streak: 0</span>\n    </div>\n\n    <div class=\"eq-box mono\" id=\"equationBox\">(3 · x + 5) mod 13 ≡ 11</div>\n\n    <div class=\"canvas-row\">\n      <canvas id=\"clockCanvas\" width=\"230\" height=\"230\"></canvas>\n      <div class=\"controls-col\">\n        <label class=\"mono lbl\">Test Candidate x (0 .. p−1): <strong id=\"lblCandidate\">0</strong></label>\n        <input id=\"rngX\" type=\"range\" min=\"0\" max=\"12\" value=\"0\" />\n        <div id=\"liveCheck\" class=\"mono preview-residue\">Residue: —</div>\n\n        <div class=\"btn-row\">\n          <button id=\"btnSubmit\" type=\"button\" class=\"btn-solve\">⚡ Verify Answer On-Chain</button>\n        </div>\n        <div class=\"btn-row\">\n          <button data-diff=\"1\" class=\"btn-lvl\">Mod 13</button>\n          <button data-diff=\"2\" class=\"btn-lvl\">Mod 29</button>\n          <button data-diff=\"3\" class=\"btn-lvl\">Mod 53</button>\n        </div>\n        <div id=\"duelStatus\" class=\"mono status\">Roll a challenge or slide x until the clock hand hits gold!</div>\n      </div>\n    </div>\n  </div>\n  <script type=\"module\" src=\"./app.js\"></script>\n</body>\n</html>",
    "stylesCss": "* { box-sizing: border-box; }\nbody { margin: 0; padding: 16px; background: #040915; color: #f8fafc; font-family: Inter, system-ui, sans-serif; }\n.mono { font-family: ui-monospace, monospace; }\n.arena { max-width: 650px; margin: 0 auto; padding: 18px; border-radius: 16px; background: #091326; border: 1px solid rgba(167,139,250,0.45); }\n.top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }\n.pill { padding: 3px 9px; border-radius: 999px; font-size: 11px; background: rgba(139,92,246,0.2); color: #ddd6fe; border: 1px solid rgba(167,139,250,0.5); }\n.hud { font-size: 13px; color: #fde68a; font-weight: 800; }\n.eq-box {\n  margin: 12px 0; padding: 12px; border-radius: 10px; background: #030711;\n  border: 1px solid #334155; text-align: center; font-size: 20px; font-weight: 900; color: #38bdf8;\n}\n.canvas-row { display: grid; grid-template-columns: 230px 1fr; gap: 16px; align-items: center; }\n@media (max-width: 560px) { .canvas-row { grid-template-columns: 1fr; justify-items: center; } }\ncanvas { background: #040a18; border-radius: 50%; border: 1px solid rgba(56,189,248,0.3); }\n.controls-col { width: 100%; display: flex; flex-direction: column; gap: 9px; }\n.lbl { font-size: 12px; color: #cbd5e1; }\ninput[type=\"range\"] { width: 100%; accent-color: #38bdf8; }\n.preview-residue { font-size: 13px; color: #6ee7b7; }\n.btn-row { display: flex; gap: 6px; }\nbutton { padding: 8px 12px; border-radius: 8px; border: none; font-weight: 800; cursor: pointer; font-family: inherit; }\n.btn-solve { width: 100%; background: linear-gradient(135deg, #8b5cf6, #0ea5e9); color: #fff; }\n.btn-lvl { flex: 1; background: #1e293b; color: #cbd5e1; border: 1px solid #475569; font-size: 12px; }\n.status { font-size: 11.5px; color: #93c5fd; line-height: 1.4; }",
    "appJs": "let puzzle = { a: 3, b: 5, m: 13, target: 11, score: 0, streak: 0 };\n\nfunction drawClock(guessX) {\n  const cv = document.getElementById('clockCanvas');\n  const ctx = cv.getContext('2d');\n  ctx.clearRect(0, 0, 230, 230);\n  const cx = 115, cy = 115, r = 88;\n  const residue = (puzzle.a * guessX + puzzle.b) % puzzle.m;\n\n  for (let i = 0; i < puzzle.m; i++) {\n    const ang = (i / puzzle.m) * Math.PI * 2 - Math.PI / 2;\n    const x = cx + Math.cos(ang) * r;\n    const y = cy + Math.sin(ang) * r;\n    ctx.beginPath();\n    ctx.arc(x, y, i === puzzle.target ? 9 : 4, 0, Math.PI * 2);\n    ctx.fillStyle = i === puzzle.target ? '#fbbf24' : i === residue ? '#34d399' : '#334155';\n    ctx.fill();\n    if (puzzle.m <= 29) {\n      ctx.fillStyle = '#94a3b8';\n      ctx.font = '10px monospace';\n      ctx.textAlign = 'center';\n      ctx.fillText(String(i), cx + Math.cos(ang) * (r + 15), cy + Math.sin(ang) * (r + 15) + 3);\n    }\n  }\n\n  const resAng = (residue / puzzle.m) * Math.PI * 2 - Math.PI / 2;\n  ctx.beginPath();\n  ctx.moveTo(cx, cy);\n  ctx.lineTo(cx + Math.cos(resAng) * (r - 8), cy + Math.sin(resAng) * (r - 8));\n  ctx.strokeStyle = residue === puzzle.target ? '#34d399' : '#38bdf8';\n  ctx.lineWidth = 3;\n  ctx.stroke();\n\n  document.getElementById('liveCheck').textContent =\n    `(${puzzle.a}·${guessX} + ${puzzle.b}) mod ${puzzle.m} = ${residue} ${residue === puzzle.target ? '✓ MATCH!' : '(target ' + puzzle.target + ')'}`;\n}\n\nasync function syncState() {\n  const ctx = await HFS.getContext();\n  const raw = await HFS.call.getPlayerState(ctx.actorAddr);\n  const words = HFS.words(raw);\n  if (words.length >= 6) {\n    puzzle = {\n      a: Number(words[0]),\n      b: Number(words[1]),\n      m: Number(words[2]) || 13,\n      target: Number(words[3]),\n      score: Number(words[4]),\n      streak: Number(words[5]),\n    };\n  }\n  document.getElementById('equationBox').textContent =\n    `(${puzzle.a} · x + ${puzzle.b}) mod ${puzzle.m} ≡ ${puzzle.target}`;\n  document.getElementById('scoreHud').textContent =\n    `Score: ${puzzle.score} • 🔥 Streak: ${puzzle.streak}`;\n  const rng = document.getElementById('rngX');\n  rng.max = String(puzzle.m - 1);\n  if (Number(rng.value) >= puzzle.m) rng.value = '0';\n  document.getElementById('lblCandidate').textContent = rng.value;\n  drawClock(Number(rng.value));\n}\n\ndocument.getElementById('rngX').addEventListener('input', (ev) => {\n  const x = Number(ev.target.value);\n  document.getElementById('lblCandidate').textContent = String(x);\n  drawClock(x);\n});\n\ndocument.getElementById('btnSubmit').addEventListener('click', async () => {\n  const x = Number(document.getElementById('rngX').value);\n  const st = document.getElementById('duelStatus');\n  try {\n    const rcpt = await HFS.tx.submitAnswer(x);\n    const ev = rcpt.decodedEvents[0];\n    const won = ev && Number(ev.words[1]) === 1;\n    st.textContent = won\n      ? `🎉 Congruence verified on-chain! Score: ${ev.words[2]}`\n      : '✗ Residue mismatch — streak reset. Try another x or roll a new challenge!';\n    await syncState();\n  } catch (e) {\n    st.textContent = '⚠ Roll a new challenge first (' + e.message + ')';\n  }\n});\n\ndocument.querySelectorAll('[data-diff]').forEach((btn) => {\n  btn.addEventListener('click', async () => {\n    const diff = Number(btn.getAttribute('data-diff'));\n    const st = document.getElementById('duelStatus');\n    st.textContent = 'Seeding prime congruence via Keccak-256…';\n    await HFS.tx.newChallenge(diff);\n    st.textContent = '✓ New challenge generated on-chain!';\n    await syncState();\n  });\n});\n\n(async () => {\n  await HFS.tx.newChallenge(1).catch(() => {});\n  await syncState();\n})();\n"
  }
};

const MAX_LEXICON_BYTECODE_BYTES = 110_000;
const STORAGE_COMPILER_URL_KEY = 'slx_hps_studio_compiler_url_v1';

// ---------------------------------------------------------------------------
// 1. Self-Contained Keccak-256 & Binary/ABI Helpers (works both hosted & standalone)
// ---------------------------------------------------------------------------

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const KECCAK_PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const MASK64 = 0xffffffffffffffffn;

function rotl64(x, s) {
  const n = BigInt(s);
  return ((x << n) | (x >> (64n - n))) & MASK64;
}

function keccakF1600(st) {
  const bc = new Array(5);
  for (let r = 0; r < 24; r++) {
    for (let i = 0; i < 5; i++) {
      bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) st[j + i] ^= t;
    }
    let t = st[1];
    for (let i = 0; i < 24; i++) {
      const j = KECCAK_PILN[i];
      const next = st[j];
      st[j] = rotl64(t, KECCAK_ROTC[i]);
      t = next;
    }
    for (let j = 0; j < 25; j += 5) {
      const r0 = st[j], r1 = st[j + 1], r2 = st[j + 2], r3 = st[j + 3], r4 = st[j + 4];
      st[j] ^= (~r1 & MASK64) & r2;
      st[j + 1] ^= (~r2 & MASK64) & r3;
      st[j + 2] ^= (~r3 & MASK64) & r4;
      st[j + 3] ^= (~r4 & MASK64) & r0;
      st[j + 4] ^= (~r0 & MASK64) & r1;
    }
    st[0] ^= KECCAK_RC[r];
  }
}

function keccak256Bytes(input) {
  const data = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  const st = new Array(25).fill(0n);
  const rate = 136;
  let off = 0;
  const readLaneLE = (buf, base) => {
    let v = 0n;
    for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(buf[base + k]);
    return v;
  };
  while (off + rate <= data.length) {
    for (let i = 0; i < 17; i++) st[i] ^= readLaneLE(data, off + i * 8);
    keccakF1600(st);
    off += rate;
  }
  const rem = new Uint8Array(rate);
  rem.set(data.subarray(off));
  rem[data.length - off] ^= 0x01;
  rem[rate - 1] ^= 0x80;
  for (let i = 0; i < 17; i++) st[i] ^= readLaneLE(rem, i * 8);
  keccakF1600(st);
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = st[i];
    for (let k = 0; k < 8; k++) {
      out[i * 8 + k] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

function bytesToHex(bytes, withPrefix = true) {
  let s = withPrefix ? '0x' : '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim().replace(/^0x/i, '');
  if (!clean) return new Uint8Array(0);
  const padded = clean.length % 2 === 1 ? '0' + clean : clean;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function keccak256Hex(data) {
  return hostSdk?.keccak256Hex ? hostSdk.keccak256Hex(data) : bytesToHex(keccak256Bytes(data));
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function shortHex(h, lead = 8, tail = 6) {
  const s = String(h || '');
  if (s.length <= lead + tail + 2) return s || '—';
  return s.slice(0, lead + 2) + '…' + s.slice(-tail);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

function encodeLocalAbi(fnSig, typedArgs = []) {
  if (hostSdk?.encodeAbi) {
    try {
      return hostSdk.encodeAbi(fnSig, typedArgs);
    } catch (_) {}
  }
  const sel = keccak256Bytes(fnSig).subarray(0, 4);
  const heads = [];
  const tails = [];
  const headSize = typedArgs.length * 32;
  let tailOffset = headSize;

  for (const [rawKind, val] of typedArgs) {
    const kind = String(rawKind || '').trim().toLowerCase();
    const word = new Uint8Array(32);
    if (kind === 'string' || kind === 'bytes') {
      const payload =
        kind === 'string'
          ? new TextEncoder().encode(String(val ?? ''))
          : val instanceof Uint8Array
          ? val
          : String(val || '').startsWith('0x')
          ? hexToBytes(val)
          : new TextEncoder().encode(String(val ?? ''));
      let offBig = BigInt(tailOffset);
      for (let k = 31; k >= 24; k--) {
        word[k] = Number(offBig & 0xffn);
        offBig >>= 8n;
      }
      heads.push(word);

      const lenWord = new Uint8Array(32);
      let lenBig = BigInt(payload.length);
      for (let k = 31; k >= 24; k--) {
        lenWord[k] = Number(lenBig & 0xffn);
        lenBig >>= 8n;
      }
      const paddedLen = Math.ceil(payload.length / 32) * 32;
      const body = new Uint8Array(paddedLen);
      body.set(payload);
      tails.push(lenWord, body);
      tailOffset += 32 + paddedLen;
    } else if (kind === 'address') {
      const b = hexToBytes(val);
      word.set(b.subarray(Math.max(0, b.length - 20)), 32 - Math.min(20, b.length));
      heads.push(word);
    } else if (kind === 'bytes32') {
      const s = String(val ?? '');
      const b = s.startsWith('0x') ? hexToBytes(s) : new TextEncoder().encode(s);
      word.set(b.subarray(0, 32));
      heads.push(word);
    } else if (kind === 'bytes4') {
      const b = hexToBytes(val);
      word.set(b.subarray(0, 4), 0);
      heads.push(word);
    } else if (kind === 'bool') {
      word[31] = val === true || val === 'true' || val === '1' || val === 1 ? 1 : 0;
      heads.push(word);
    } else {
      let n = BigInt(val || 0);
      if (n < 0n) n = (1n << 256n) + n;
      for (let k = 31; k >= 0; k--) {
        word[k] = Number(n & 0xffn);
        n >>= 8n;
      }
      heads.push(word);
    }
  }
  return bytesToHex(concatBytes(sel, ...heads, ...tails));
}

// ---------------------------------------------------------------------------
// 2. Client-Side Rust `hps_entry!` & `event_topic()` Live Parser
// ---------------------------------------------------------------------------

function stripRustCommentsJs(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function parseRustHpsAbiClient(rustSource) {
  const clean = stripRustCommentsJs(rustSource);
  const functions = [];
  const events = [];

  const entryMatch = clean.match(/hps_entry!\s*\{([\s\S]*?)\}/);
  if (entryMatch) {
    const block = entryMatch[1];
    const pairRe = /"([^"]+)"\s*=>\s*([A-Za-z0-9_:]+)/g;
    let m;
    while ((m = pairRe.exec(block)) !== null) {
      const sig = m[1].trim();
      const handler = m[2].trim();
      const open = sig.indexOf('(');
      const close = sig.lastIndexOf(')');
      if (open <= 0 || close < open) continue;
      const name = sig.slice(0, open).trim();
      const inside = sig.slice(open + 1, close).trim();
      const types = inside ? inside.split(',').map((t) => t.trim()).filter(Boolean) : [];
      const selector = bytesToHex(keccak256Bytes(sig).subarray(0, 4));

      const shortHandler = handler.split('::').pop();
      const fnIdx = clean.indexOf('fn ' + shortHandler);
      let fnBody = '';
      if (fnIdx >= 0) {
        const bStart = clean.indexOf('{', fnIdx);
        if (bStart >= 0) {
          let depth = 0;
          for (let i = bStart; i < clean.length; i++) {
            if (clean[i] === '{') depth++;
            else if (clean[i] === '}') {
              depth--;
              if (depth === 0) {
                fnBody = clean.slice(bStart, i + 1);
                break;
              }
            }
          }
        }
      }

      const paramNames = {};
      const letRe = /let\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=[^;]*?\.(?:u64|u256_be|address|bytes32|word|bool|bytes4|dynamic_bytes)\((\d+)\)/g;
      let lm;
      while ((lm = letRe.exec(fnBody)) !== null) {
        const idx = Number(lm[2]);
        if (!lm[1].startsWith('_') && !(idx in paramNames)) paramNames[idx] = lm[1];
      }

      const inputs = types.map((kind, i) => ({
        name: paramNames[i] || `arg${i}`,
        kind,
      }));

      const mutates = /storage::set|events::emit|host_state_set|host_emit_event/.test(fnBody);
      const viewByName = /^(get|is|has|can|total|read|query|list|resolve|preview|count|balance|owner$|admin$|version$|abiversion$)/i.test(name);
      const mutability = mutates ? 'nonpayable' : viewByName || /ret::write/.test(fnBody) ? 'view' : 'nonpayable';

      let returnHint = 'void';
      if (fnBody.includes('ret::write_u64_word')) returnHint = 'uint64';
      else if (fnBody.includes('ret::write_bool')) returnHint = 'bool';
      else if (fnBody.includes('ret::write_address')) returnHint = 'address';
      else if (fnBody.includes('ret::write_abi_bytes')) returnHint = 'bytes';
      else if (fnBody.includes('ret::write_word')) returnHint = 'bytes32';
      else if (fnBody.includes('ret::write(')) returnHint = 'bytes';

      functions.push({ signature: sig, name, handler, selector, mutability, returnHint, inputs });
    }
  }

  const evRe = /(?:const\s+([A-Z0-9_]+)\s*:\s*\[u8;\s*32\]\s*=\s*)?event_topic\(\s*"([^"]+)"\s*\)/g;
  let em;
  while ((em = evRe.exec(clean)) !== null) {
    const constantName = em[1] || '';
    const sig = em[2].trim();
    const open = sig.indexOf('(');
    const close = sig.lastIndexOf(')');
    if (open <= 0 || close < open) continue;
    const name = sig.slice(0, open).trim();
    const inside = sig.slice(open + 1, close).trim();
    const types = inside ? inside.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const topic0 = bytesToHex(keccak256Bytes(sig));
    events.push({
      signature: sig,
      name,
      constantName,
      topic0,
      inputs: types.map((kind, i) => ({ name: `field${i}`, kind })),
    });
  }

  return { functions, events };
}

// ---------------------------------------------------------------------------
// 3. Auto-Generated `window.HFS` Client SDK (Injected into Preview & Bundles)
// ---------------------------------------------------------------------------

function generateAutoBridgeJs(abi) {
  const fns = abi?.functions || [];
  const evs = abi?.events || [];

  const fnSpecsJson = JSON.stringify(
    fns.map((f) => ({
      name: f.name,
      sig: f.signature,
      mutability: f.mutability,
      returnHint: f.returnHint,
      inputs: f.inputs,
    }))
  );
  const evSpecsJson = JSON.stringify(
    evs.map((e) => ({
      name: e.name,
      sig: e.signature,
      topic0: e.topic0.toLowerCase(),
    }))
  );

  return `/* Auto-Generated by SuperLexicon HFS Studio IDE from src/main.rs */
(function () {
  const FN_SPECS = ${fnSpecsJson};
  const EV_SPECS = ${evSpecsJson};
  const EV_BY_TOPIC = Object.fromEntries(EV_SPECS.map((e) => [e.topic0, e]));

  function hexToBytesLocal(h) {
    const c = String(h || '').replace(/^0x/i, '');
    if (!c) return new Uint8Array(0);
    const p = c.length % 2 ? '0' + c : c;
    const out = new Uint8Array(p.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(p.slice(i * 2, i * 2 + 2), 16) || 0;
    return out;
  }

  function decodeU64Word(hex) {
    const b = hexToBytesLocal(hex);
    if (b.length === 0) return 0n;
    const slice = b.length >= 32 ? b.subarray(24, 32) : b.subarray(Math.max(0, b.length - 8));
    let v = 0n;
    for (const byte of slice) v = (v << 8n) | BigInt(byte);
    return v;
  }

  function decodeAddressWord(hex) {
    const b = hexToBytesLocal(hex);
    if (b.length < 20) return '0x' + '00'.repeat(20);
    const slice = b.length >= 32 ? b.subarray(12, 32) : b.subarray(b.length - 20);
    return '0x' + Array.from(slice, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function decodeUtf8AbiBytes(hex) {
    const b = hexToBytesLocal(hex);
    if (b.length >= 64 && b[31] === 0x20) {
      let len = 0;
      for (let i = 56; i < 64; i++) len = (len << 8) | b[i];
      return new TextDecoder().decode(b.subarray(64, 64 + len));
    }
    return new TextDecoder().decode(b);
  }

  function splitWords(hex) {
    const b = hexToBytesLocal(hex);
    const words = [];
    for (let off = 0; off + 32 <= b.length; off += 32) {
      let v = 0n;
      for (let i = 24; i < 32; i++) v = (v << 8n) | BigInt(b[off + i]);
      words.push(v);
    }
    return words;
  }

  function bytes32FromText(str) {
    const raw = new TextEncoder().encode(String(str || ''));
    const buf = new Uint8Array(32);
    buf.set(raw.subarray(0, 32));
    return '0x' + Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function decodeByHint(hex, hint) {
    if (!hex || hex === '0x') return hint === 'uint64' ? 0n : hint === 'bool' ? false : '';
    if (hint === 'uint64') return decodeU64Word(hex);
    if (hint === 'bool') return decodeU64Word(hex) !== 0n;
    if (hint === 'address') return decodeAddressWord(hex);
    if (hint === 'bytes') return decodeUtf8AbiBytes(hex);
    return hex;
  }

  function decodeEvents(receipt) {
    const logs = receipt?.logs || [];
    return logs.map((log) => {
      const t0 = String(log.topics?.[0] || '').toLowerCase();
      const spec = EV_BY_TOPIC[t0];
      return {
        name: spec ? spec.name : 'UnknownEvent',
        signature: spec ? spec.signature : t0,
        topics: log.topics || [],
        data: log.data || '0x',
        words: splitWords(log.data || '0x'),
      };
    });
  }

  const callMap = {};
  const viewsMap = {};
  const txMap = {};

  for (const fn of FN_SPECS) {
    const packArgs = (userArgs) =>
      fn.inputs.map((inp, idx) => [inp.kind, userArgs[idx]]);

    callMap[fn.name] = async (...userArgs) => {
      return window.slx.callContract(fn.sig, packArgs(userArgs));
    };
    viewsMap[fn.name] = async (...userArgs) => {
      const hex = await window.slx.callContract(fn.sig, packArgs(userArgs));
      return decodeByHint(hex, fn.returnHint);
    };
    txMap[fn.name] = async (...userArgs) => {
      const rcpt = await window.slx.sendTransaction({
        fnSig: fn.sig,
        args: packArgs(userArgs),
        summary: fn.name + '(' + userArgs.map((x) => String(x).slice(0, 18)).join(', ') + ')',
      });
      return Object.assign({}, rcpt, { decodedEvents: decodeEvents(rcpt) });
    };
  }

  window.HFS = {
    abi: { functions: FN_SPECS, events: EV_SPECS },
    getContext: async () => {
      const ctx = await window.slx.getContext();
      ctx.actorAddr = ctx.user?.identityAddr || ctx.user?.eoa || '0x' + '00'.repeat(20);
      return ctx;
    },
    call: callMap,
    views: viewsMap,
    tx: txMap,
    decodeEvents,
    u64: decodeU64Word,
    num: (h) => Number(decodeU64Word(h)),
    bool: (h) => decodeU64Word(h) !== 0n,
    addr: decodeAddressWord,
    utf8: decodeUtf8AbiBytes,
    words: splitWords,
    bytes32FromText,
  };
})();`;
}

// ---------------------------------------------------------------------------
// 4. In-Browser `WebAssembly` HFS Sandbox VM (`BrowserHfsVm`)
// ---------------------------------------------------------------------------

const VM_PERSONAS = [
  {
    nickname: '@Alice',
    tag4: 'a11c',
    eoa: '0xa11ce00000000000000000000000000000000001',
    identityAddr: '0x1d0000000000000000000000000000000000a11c',
  },
  {
    nickname: '@Bob',
    tag4: 'b0b2',
    eoa: '0xb0b0000000000000000000000000000000000002',
    identityAddr: '0x1d0000000000000000000000000000000000b0b2',
  },
  {
    nickname: '@Charlie',
    tag4: 'c0c3',
    eoa: '0xc0c0000000000000000000000000000000000003',
    identityAddr: '0x1d0000000000000000000000000000000000c0c3',
  },
];

const SIM_SELF_ADDR = '0x7f00000000000000000000000000000000004f51';
const SIM_IDENTITY_CODE_HASH = keccak256Bytes('SIMULATED_IDENTITY_HFS_V1');
const SEL_OWNER = bytesToHex(keccak256Bytes('owner()').subarray(0, 4));
const SEL_IS_DELEGATE = bytesToHex(keccak256Bytes('isDelegate(address)').subarray(0, 4));

class BrowserHfsVm {
  constructor() {
    this.wasmBytes = null;
    this.compiledModule = null;
    this.codeHashBytes = new Uint8Array(32);
    this.storage = new Map(); // hexKey -> Uint8Array
    this.blockNumber = 1n;
    this.personaIndex = 0;
    this.txCounter = 1;
  }

  async loadWasm(wasmBytes) {
    this.wasmBytes = wasmBytes;
    this.codeHashBytes = keccak256Bytes(wasmBytes);
    this.compiledModule = await WebAssembly.compile(wasmBytes);
  }

  resetState() {
    this.storage.clear();
    this.blockNumber = 1n;
  }

  getActivePersona() {
    return VM_PERSONAS[this.personaIndex] || VM_PERSONAS[0];
  }

  explainErrorCode(rc) {
    const map = {
      [-1]: 'Calldata shorter than 4-byte function selector (-1)',
      [-2]: 'Unknown 4-byte function selector (-2)',
      [-3]: 'Invalid or missing ABI calldata argument (-3)',
      [-21]: 'Arithmetic underflow / insufficient balance (-21)',
      [-40]: 'Unauthorized caller / Identity check failed (-40)',
    };
    return map[rc] || `HFS subroutine returned error code ${rc}`;
  }

  async execute({ calldataHex, isStatic = false, senderAddr = null }) {
    if (!this.compiledModule) {
      throw new Error('No compiled .wasm loaded in Local WASM VM.');
    }
    const t0 = performance.now();
    const persona = this.getActivePersona();
    const effectiveSender = hexToBytes(senderAddr || persona.identityAddr);
    const selfBytes = hexToBytes(SIM_SELF_ADDR);
    const calldata = hexToBytes(calldataHex);

    // Snapshot storage for atomic rollback on view or revert
    const workingState = new Map();
    for (const [k, v] of this.storage.entries()) {
      workingState.set(k, new Uint8Array(v));
    }
    const emittedLogs = [];

    let memRef = null;
    const u8 = () => new Uint8Array(memRef.buffer);

    const envImports = {
      host_state_get: (keyPtr, keyLen) => {
        if (keyLen <= 0) return 0;
        const mem = u8();
        const kHex = bytesToHex(mem.subarray(keyPtr, keyPtr + keyLen), false);
        const val = workingState.get(kHex);
        if (!val || val.length === 0) return 0;
        const n = Math.min(val.length, 0x10000);
        mem.set(val.subarray(0, n), 0x40000); // VAL_BUF = 0x40000
        return val.length;
      },
      host_state_exists: (keyPtr, keyLen) => {
        if (keyLen <= 0) return 0;
        const mem = u8();
        const kHex = bytesToHex(mem.subarray(keyPtr, keyPtr + keyLen), false);
        const val = workingState.get(kHex);
        return val && val.length > 0 ? 1 : 0;
      },
      host_state_set: (keyPtr, keyLen, valPtr, valLen) => {
        if (keyLen <= 0) return;
        const mem = u8();
        const kHex = bytesToHex(mem.subarray(keyPtr, keyPtr + keyLen), false);
        if (valLen <= 0) {
          workingState.delete(kHex);
        } else {
          workingState.set(kHex, new Uint8Array(mem.subarray(valPtr, valPtr + valLen)));
        }
      },
      get_calldata: (bufPtr) => {
        const mem = u8();
        const n = Math.min(calldata.length, 0x10000);
        mem.set(calldata.subarray(0, n), bufPtr);
        return calldata.length;
      },
      get_msg_sender: (bufPtr) => {
        u8().set(effectiveSender.subarray(0, 20), bufPtr);
      },
      get_self_address: (bufPtr) => {
        u8().set(selfBytes.subarray(0, 20), bufPtr);
      },
      host_get_code_hash: (addrPtr, outPtr) => {
        const mem = u8();
        const addrHex = bytesToHex(mem.subarray(addrPtr, addrPtr + 20)).toLowerCase();
        if (addrHex === SIM_SELF_ADDR.toLowerCase()) {
          mem.set(this.codeHashBytes, outPtr);
          return 1;
        }
        const hitPersona = VM_PERSONAS.find((p) => p.identityAddr.toLowerCase() === addrHex);
        if (hitPersona) {
          mem.set(SIM_IDENTITY_CODE_HASH, outPtr);
          return 1;
        }
        return 0;
      },
      get_block_number: (bufPtr) => {
        const mem = u8();
        let b = this.blockNumber;
        for (let k = 7; k >= 0; k--) {
          mem[bufPtr + k] = Number(b & 0xffn);
          b >>= 8n;
        }
      },
      host_emit_event: (topicsPtr, topicsBytesLen, dataPtr, dataLen) => {
        const mem = u8();
        const topicCount = Math.min(4, Math.floor(Math.max(0, topicsBytesLen) / 32));
        const topics = [];
        for (let i = 0; i < topicCount; i++) {
          topics.push(bytesToHex(mem.subarray(topicsPtr + i * 32, topicsPtr + (i + 1) * 32)));
        }
        const data = dataLen > 0 ? bytesToHex(mem.subarray(dataPtr, dataPtr + dataLen)) : '0x';
        emittedLogs.push({ address: SIM_SELF_ADDR, topics, data });
      },
      host_call_contract: (targetPtr, cdPtr, cdLen, retPtr, retCap) => {
        const mem = u8();
        const targetHex = bytesToHex(mem.subarray(targetPtr, targetPtr + 20)).toLowerCase();
        const subCd = mem.subarray(cdPtr, cdPtr + Math.max(0, cdLen));
        const subSel = subCd.length >= 4 ? bytesToHex(subCd.subarray(0, 4)).toLowerCase() : '';

        // Built-in simulated Identity HFS responder for @Alice, @Bob, @Charlie
        const idOwner = VM_PERSONAS.find((p) => p.identityAddr.toLowerCase() === targetHex);
        if (idOwner) {
          if (subSel === SEL_OWNER.toLowerCase()) {
            const word = new Uint8Array(32);
            word.set(hexToBytes(idOwner.eoa), 12);
            const n = Math.min(32, retCap);
            mem.set(word.subarray(0, n), retPtr);
            return n;
          }
          if (subSel === SEL_IS_DELEGATE.toLowerCase()) {
            const word = new Uint8Array(32);
            const queried = subCd.length >= 36 ? bytesToHex(subCd.subarray(16, 36)).toLowerCase() : '';
            word[31] = queried === idOwner.eoa.toLowerCase() ? 1 : 0;
            const n = Math.min(32, retCap);
            mem.set(word.subarray(0, n), retPtr);
            return n;
          }
        }
        return -404;
      },
      host_active_validators: () => 4,
      host_vrf_verify_deal: () => 1,
      host_vrf_verify_dispute: () => 1,
      host_vrf_derive_epoch_keys: () => 1,
      host_vrf_verify_share: () => 1,
      host_vrf_lagrange_combine: () => 1,
      host_ec_elgamal_lincomb: () => 1,
      host_ec_dleq_verify: () => 1,
      host_he_add_ciphertexts: () => 1,
      host_he_scale_ciphertext: () => 1,
      host_he_verify_zero_or_one: () => 1,
      host_he_verify_pok: () => 1,
      host_he_verify_decryption_share: () => 1,
      host_he_lagrange_decrypt: () => 1,
      host_bp_verify_range_u64: () => 1,
      host_bp_verify_r1cs: () => 1,
    };

    const instance = await WebAssembly.instantiate(this.compiledModule, { env: envImports });
    memRef = instance.exports.memory;

    let rc = 0;
    try {
      rc = instance.exports.main(0, 0);
    } catch (trapErr) {
      throw new Error(`WASM Trap (panic / unreachable): ${trapErr.message || trapErr}`);
    }

    const elapsedMs = +(performance.now() - t0).toFixed(2);
    if (rc < 0) {
      throw new Error(this.explainErrorCode(rc));
    }

    const mem = u8();
    const view = new DataView(memRef.buffer);
    const retLen = Math.min(view.getUint32(0x70000, true), 0x80000 - 4);
    const retHex = retLen > 0 ? bytesToHex(mem.subarray(0x70004, 0x70004 + retLen)) : '0x';

    if (!isStatic) {
      this.storage = workingState;
      this.blockNumber += 1n;
    }

    const txHash = keccak256Hex(`localvm:${this.txCounter++}:${Date.now()}:${calldataHex}`);
    return {
      rc,
      returnHex: retHex,
      logs: emittedLogs,
      txHash,
      blockNumber: Number(this.blockNumber),
      elapsedMs,
    };
  }
}

// ---------------------------------------------------------------------------
// 5. IDE Application State
// ---------------------------------------------------------------------------

const vm = new BrowserHfsVm();
const wallet = hostSdk?.SlxWalletManager ? new hostSdk.SlxWalletManager() : null;
const rpcUrl = hostSdk?.getDefaultNodeWsUrl ? hostSdk.getDefaultNodeWsUrl() : 'ws://192.168.50.93:8545';
const storeClient = hostSdk?.AppStoreClient ? new hostSdk.AppStoreClient({ rpcUrl }) : null;

const state = {
  activeFile: 'main.rs',
  files: {
    'main.rs': '',
    'index.html': '',
    'styles.css': '',
    'app.js': '',
    'app.json': '',
    'bridge.js': '',
  },
  wasmBytes: null,
  codeHash: '',
  rawWasmSize: 0,
  abi: { functions: [], events: [] },
  diagnostics: [],
  compilerUrl: '',
  compilerOnline: false,
  compilerSandbox: false,
  rustcVersion: '',
  workspaceExamples: [],
  execMode: 'local-vm', // 'local-vm' | 'subnet1'
  liveHfsAddr: '',
  activeInspTab: 'abi',
  logs: [],
  packedBundle: null,
  liveBridgeHandle: null,
  sandboxKv: {},
};

// ---------------------------------------------------------------------------
// 6. Syntax Highlighter & Editor Sync
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightCodeLine(line, lang) {
  if (!line) return ' ';
  if (lang === 'rust') {
    const cmtIdx = line.indexOf('//');
    const codePart = cmtIdx >= 0 ? line.slice(0, cmtIdx) : line;
    const cmtPart = cmtIdx >= 0 ? line.slice(cmtIdx) : '';
    let h = escapeHtml(codePart);
    h = h.replace(/"(?:\\.|[^"\\])*"/g, '<span class="tok-str">$&</span>');
    h = h.replace(/#!?\[[^\]]*\]/g, '<span class="tok-attr">$&</span>');
    h = h.replace(/\b([a-z_][a-z0-9_]*!)/g, '<span class="tok-mac">$1</span>');
    h = h.replace(
      /\b(fn|pub|let|mut|const|static|use|mod|struct|enum|impl|trait|match|if|else|for|in|while|loop|return|true|false|as|ref|super|crate|where|unsafe|extern)\b/g,
      '<span class="tok-kw">$1</span>'
    );
    h = h.replace(
      /\b(u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|bool|str|Result|Option|Ok|Err|Some|None|Vec|CalldataReader|KeyBuilder)\b/g,
      '<span class="tok-ty">$1</span>'
    );
    h = h.replace(/\b(0x[0-9a-fA-F_]+|\d[0-9_]*(?:u64|u32|usize|i32)?)\b/g, '<span class="tok-num">$1</span>');
    if (cmtPart) h += '<span class="tok-cmt">' + escapeHtml(cmtPart) + '</span>';
    return h;
  }
  if (lang === 'js') {
    const cmtIdx = line.indexOf('//');
    const codePart = cmtIdx >= 0 ? line.slice(0, cmtIdx) : line;
    const cmtPart = cmtIdx >= 0 ? line.slice(cmtIdx) : '';
    let h = escapeHtml(codePart);
    h = h.replace(/(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/g, '<span class="tok-str">$&</span>');
    h = h.replace(
      /\b(const|let|var|async|await|function|return|if|else|for|of|in|try|catch|new|import|from|export|true|false|null)\b/g,
      '<span class="tok-kw">$1</span>'
    );
    h = h.replace(/\b(HFS|window|document|BigInt|Number|String|Promise)\b/g, '<span class="tok-ty">$1</span>');
    if (cmtPart) h += '<span class="tok-cmt">' + escapeHtml(cmtPart) + '</span>';
    return h;
  }
  let h = escapeHtml(line);
  h = h.replace(/"(?:\\.|[^"\\])*"/g, '<span class="tok-str">$&</span>');
  h = h.replace(/(&lt;\/?[a-zA-Z0-9-]+|&gt;)/g, '<span class="tok-kw">$1</span>');
  return h;
}

function getLangForFile(file) {
  if (file === 'main.rs') return 'rust';
  if (file === 'app.js' || file === 'bridge.js') return 'js';
  return 'html';
}

function renderEditorChrome() {
  const code = state.files[state.activeFile] || '';
  const lines = code.split('\n');
  const lang = getLangForFile(state.activeFile);

  const diagByLine = new Map();
  if (state.activeFile === 'main.rs') {
    for (const d of state.diagnostics) {
      if (!diagByLine.has(d.line) || d.level === 'error') {
        diagByLine.set(d.line, d);
      }
    }
  }

  const gutterHtml = [];
  const hiHtml = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const d = diagByLine.get(ln);
    const cls = d ? (d.level === 'error' ? ' err' : ' warn') : '';
    const tip = d ? ` title="${escapeHtml(d.message)}"` : '';
    gutterHtml.push(`<div class="ide-gutter-line${cls}"${tip}>${ln}</div>`);
    const rendered = highlightCodeLine(lines[i], lang);
    hiHtml.push(d?.level === 'error' ? `<span class="line-err-bg">${rendered}</span>` : rendered);
  }

  document.getElementById('codeGutter').innerHTML = gutterHtml.join('');
  document.getElementById('codeHighlight').innerHTML = hiHtml.join('\n') + '\n ';
}

function switchEditorTab(file) {
  state.activeFile = file;
  document.querySelectorAll('#fileTabBar .ide-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.file === file);
  });
  const ta = document.getElementById('codeInput');
  ta.readOnly = file === 'bridge.js';
  ta.value = state.files[file] || '';
  renderEditorChrome();
  renderSnippetBar();
}

function insertAtCursor(snippet) {
  const ta = document.getElementById('codeInput');
  if (ta.readOnly) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const next = ta.value.slice(0, start) + snippet + ta.value.slice(end);
  ta.value = next;
  state.files[state.activeFile] = next;
  const caret = start + snippet.length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  onEditorSourceMutated();
}

const RUST_SNIPPETS = [
  {
    label: '+ View Handler',
    code: `\nfn handle_my_view(args: &CalldataReader) -> Result<(), i32> {\n    let key = args.bytes32(0).ok_or(-3)?;\n    ret::write_u64_word(storage::get_u64(&key));\n    Ok(())\n}\n`,
  },
  {
    label: '+ Write Handler',
    code: `\nfn handle_my_action(args: &CalldataReader) -> Result<(), i32> {\n    let amount = args.u64(0).ok_or(-3)?;\n    let sender = context::msg_sender();\n    let key = KeyBuilder::<32>::new().push(b"bal:").push(&sender);\n    let next = storage::get_u64(key.as_slice()).saturating_add(amount);\n    storage::set_u64(key.as_slice(), next);\n    ret::write_u64_word(next);\n    Ok(())\n}\n`,
  },
  {
    label: '+ Event Topic',
    code: `const MY_EVENT: [u8; 32] = event_topic("Updated(address,uint64)");\n`,
  },
  {
    label: '+ Emit Event',
    code: `    let mut ev = [0u8; 64];\n    ev[12..32].copy_from_slice(&sender);\n    ev[56..64].copy_from_slice(&next.to_be_bytes());\n    events::emit(&[MY_EVENT], &ev);\n`,
  },
  {
    label: '+ #[test] Mock',
    code: `\n#[test]\nfn custom_subroutine_test() {\n    mock::reset();\n    mock::set_sender([0xAA; 20]);\n    assert_eq!(storage::get_u64(b"test"), 0);\n}\n`,
  },
];

function renderSnippetBar() {
  const bar = document.getElementById('snippetBar');
  if (state.activeFile === 'main.rs') {
    bar.innerHTML =
      '<span class="ide-snip-lbl">RUST HPS-SDK:</span>' +
      RUST_SNIPPETS.map(
        (s, idx) => `<button type="button" class="ide-chip" data-rust-snip="${idx}">${s.label}</button>`
      ).join('');
    bar.querySelectorAll('[data-rust-snip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        insertAtCursor(RUST_SNIPPETS[Number(btn.dataset.rustSnip)].code);
      });
    });
    return;
  }

  if (state.activeFile === 'app.js') {
    const fns = state.abi?.functions || [];
    const chips = fns.map((f, idx) => {
      const argList = f.inputs.map((inp) => inp.name).join(', ');
      const isView = f.mutability === 'view';
      const cls = isView ? 'ide-chip' : 'ide-chip ide-chip-tx';
      const prefix = isView ? 'HFS.views' : 'HFS.tx';
      return `<button type="button" class="${cls}" data-js-fn="${idx}" title="Insert ${prefix}.${f.name}(${argList})">${isView ? '🔍' : '⚡'} ${prefix}.${f.name}(${argList})</button>`;
    });
    chips.push(
      '<button type="button" class="ide-chip ide-chip-violet" data-js-ctx="1">👤 await HFS.getContext()</button>'
    );
    bar.innerHTML = '<span class="ide-snip-lbl">AUTO-WIRED HFS CALLS:</span>' + chips.join('');
    bar.querySelectorAll('[data-js-fn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fn = fns[Number(btn.dataset.jsFn)];
        const sampleArgs = fn.inputs
          .map((inp) => {
            if (inp.kind === 'address') return 'ctx.actorAddr';
            if (inp.kind === 'bytes32') return "HFS.bytes32FromText('key')";
            if (inp.kind === 'string') return "'hello'";
            if (inp.kind === 'bool') return 'true';
            return '1';
          })
          .join(', ');
        if (fn.mutability === 'view') {
          insertAtCursor(`const ${fn.name}Res = await HFS.views.${fn.name}(${sampleArgs});\n`);
        } else {
          insertAtCursor(`const rcpt = await HFS.tx.${fn.name}(${sampleArgs});\n`);
        }
      });
    });
    bar.querySelector('[data-js-ctx]')?.addEventListener('click', () => {
      insertAtCursor('const ctx = await HFS.getContext();\n');
    });
    return;
  }

  if (state.activeFile === 'bridge.js') {
    bar.innerHTML =
      '<span class="ide-snip-lbl">AUTO-GENERATED FROM src/main.rs (auto-injected before ui/app.js):</span>' +
      '<button type="button" class="ide-chip ide-chip-violet" id="btnCopyBridgeCode">📋 Copy SDK Source</button>';
    document.getElementById('btnCopyBridgeCode')?.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(state.files['bridge.js'] || '');
      showToast('Copied auto-generated window.HFS SDK to clipboard.');
    });
    return;
  }

  bar.innerHTML =
    '<span class="ide-snip-lbl">ZERO-SERVER BUNDLE:</span>' +
    '<span style="font-size:0.65rem;color:#94a3b8;">Press <code>Ctrl/Cmd + Enter</code> to hot-reload live preview • <code>Ctrl/Cmd + B</code> to compile Rust</span>';
}

// ---------------------------------------------------------------------------
// 7. Live Sandboxed Preview Iframe +Deterministic `.html.gz` Bundler
// ---------------------------------------------------------------------------

const GUEST_SHIM = `<script>
(function () {
  let seq = 1;
  const pending = new Map();
  window.addEventListener('message', function (ev) {
    const m = ev.data;
    if (!m || m.__slxBridge !== 'host->guest') return;
    if (m.type === 'response' && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
    }
  });
  function ask(method, params) {
    return new Promise(function (resolve, reject) {
      const id = seq++;
      pending.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({ __slxBridge: 'guest->host', id: id, method: method, params: params || {} }, '*');
    });
  }
  window.slx = {
    version: '1.0.0',
    getContext: function () { return ask('getContext', {}); },
    ethCall: function (to, data) { return ask('ethCall', { to: to, data: data }); },
    callContract: function (fnSig, args, to) { return ask('callContract', { fnSig: fnSig, args: args || [], to: to }); },
    encodeAbi: function (fnSig, args) { return ask('encodeAbi', { fnSig: fnSig, args: args || [] }); },
    sendTransaction: function (opts) { return ask('sendTransaction', opts || {}); },
    resolveIdentity: function (addr) { return ask('resolveIdentity', { address: addr }); },
    getAppStorage: function (k) { return ask('getAppStorage', { key: k }); },
    setAppStorage: function (k, v) { return ask('setAppStorage', { key: k, value: v }); },
    onNewBlock: function () { return function () {}; }
  };

  function fwd(level, args) {
    try {
      const text = Array.from(args).map(function (a) {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      }).join(' ');
      window.parent.postMessage({ __ideConsole: true, level: level, message: text }, '*');
    } catch (_) {}
  }
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  console.log = function () { fwd('log', arguments); origLog.apply(console, arguments); };
  console.warn = function () { fwd('warn', arguments); origWarn.apply(console, arguments); };
  console.error = function () { fwd('error', arguments); origErr.apply(console, arguments); };
  window.addEventListener('error', function (e) { fwd('error', [e.message + ' (line ' + e.lineno + ')']); });
  window.addEventListener('unhandledrejection', function (e) { fwd('error', ['Unhandled Promise: ' + (e.reason && e.reason.message || e.reason)]); });
})();
<\/script>`;

function composeInlinedBundleHtml({ includeGuestShim = false } = {}) {
  const rawHtml = state.files['index.html'] || '';
  const safeCss = (state.files['styles.css'] || '').replace(/<\/style/gi, '<\\/style');
  const safeBridge = (state.files['bridge.js'] || '').replace(/<\/script/gi, '<\\/script');
  const safeJs = (state.files['app.js'] || '').replace(/<\/script/gi, '<\\/script');

  let html = rawHtml;
  const styleBlock = `<style>\n${safeCss}\n</style>`;
  if (/<link[^>]+href=["']\.?\/?styles\.css["'][^>]*>/i.test(html)) {
    html = html.replace(/<link[^>]+href=["']\.?\/?styles\.css["'][^>]*>/i, () => styleBlock);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, () => `${styleBlock}\n</head>`);
  } else {
    html = styleBlock + '\n' + html;
  }

  if (includeGuestShim) {
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${GUEST_SHIM}`);
    } else {
      html = GUEST_SHIM + '\n' + html;
    }
  }

  const combinedScripts = `<script>\n${safeBridge}\n<\/script>\n<script type="module">\n${safeJs}\n<\/script>`;
  if (/<script[^>]+src=["']\.?\/?app\.js["'][^>]*>\s*<\/script>/i.test(html)) {
    html = html.replace(/<script[^>]+src=["']\.?\/?app\.js["'][^>]*>\s*<\/script>/i, () => combinedScripts);
  } else if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, () => `${combinedScripts}\n</body>`);
  } else {
    html += '\n' + combinedScripts;
  }
  return html;
}

async function gzipDeterministicBrowser(utf8String) {
  const raw = new TextEncoder().encode(utf8String);
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(raw);
    writer.close();
    const gzBuf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    if (gzBuf.length >= 10 && gzBuf[0] === 0x1f && gzBuf[1] === 0x8b) {
      // Normalize mtime=0 and OS=255 per RFC 1952
      gzBuf[4] = 0; gzBuf[5] = 0; gzBuf[6] = 0; gzBuf[7] = 0;
      gzBuf[9] = 255;
    }
    return { raw, gzBytes: gzBuf, uiHash: keccak256Hex(gzBuf) };
  }
  return { raw, gzBytes: raw, uiHash: keccak256Hex(raw) };
}

async function refreshBundleMetrics() {
  const cleanBundleHtml = composeInlinedBundleHtml({ includeGuestShim: false });
  const packed = await gzipDeterministicBrowser(cleanBundleHtml);
  state.packedBundle = {
    html: cleanBundleHtml,
    rawLen: packed.raw.length,
    gzBytes: packed.gzBytes,
    compressedLen: packed.gzBytes.length,
    uiHash: packed.uiHash,
  };
  const kb = (packed.gzBytes.length / 1024).toFixed(1);
  const el = document.getElementById('lblBundleSize');
  if (el) {
    el.textContent = `📦 ${kb} KiB gz`;
    el.title = `Deterministic UI Bundle: ${kb} KiB gzip (${(packed.raw.length / 1024).toFixed(1)} KiB HTML) • uiHash ${packed.uiHash}`;
  }
}

function reloadPreviewIframe() {
  const iframe = document.getElementById('previewIframe');
  if (!iframe) return;

  if (state.liveBridgeHandle) {
    state.liveBridgeHandle.destroy();
    state.liveBridgeHandle = null;
  }

  if (state.execMode === 'subnet1' && hostSdk?.attachSandboxedAppBridge && wallet) {
    const appCfg = parseAppJsonSafe();
    const targetAddr = document.getElementById('inLiveHfsAddr').value.trim() || state.liveHfsAddr;
    state.liveBridgeHandle = hostSdk.attachSandboxedAppBridge({
      iframeEl: iframe,
      appMeta: {
        slug: appCfg.slug || 'ide-preview',
        title: appCfg.title || 'IDE Live Preview',
        version: appCfg.version || '1.0.0',
        wasmCodeHash: state.codeHash,
        defaultHfsAddr: targetAddr,
        activeInstanceAddr: targetAddr,
      },
      wallet,
      rpcUrl,
    });
  }

  iframe.srcdoc = composeInlinedBundleHtml({ includeGuestShim: true });
  refreshBundleMetrics();
}

// Handle messages from the Preview Iframe in Local WASM VM mode + Console Forwarding
window.addEventListener('message', async (ev) => {
  const iframe = document.getElementById('previewIframe');
  if (!iframe || ev.source !== iframe.contentWindow) return;
  const data = ev.data;
  if (!data) return;

  if (data.__ideConsole) {
    pushLogEntry(
      data.level === 'error' ? 'err' : 'console',
      `[UI ${data.level}] ${data.message}`
    );
    return;
  }

  if (state.execMode !== 'local-vm') return;
  if (data.__slxBridge !== 'guest->host') return;

  const reply = (result, error = null) => {
    iframe.contentWindow?.postMessage(
      { __slxBridge: 'host->guest', type: 'response', id: data.id, result, error },
      '*'
    );
  };

  try {
    const { method, params = {} } = data;
    const persona = vm.getActivePersona();
    const appCfg = parseAppJsonSafe();

    if (method === 'getContext') {
      reply({
        appId: 0,
        slug: appCfg.slug || 'local-vm-app',
        title: appCfg.title || 'Local WASM App',
        version: appCfg.version || '1.0.0',
        wasmCodeHash: state.codeHash,
        instanceAddr: SIM_SELF_ADDR,
        rpcUrl: 'wasm://browser-hfs-vm',
        blockNumber: Number(vm.blockNumber),
        user: {
          eoa: persona.eoa,
          tag4: persona.tag4,
          identityAddr: persona.identityAddr,
          nickname: persona.nickname,
        },
      });
      return;
    }

    if (method === 'encodeAbi') {
      reply(encodeLocalAbi(params.fnSig, params.args || []));
      return;
    }

    if (method === 'callContract' || method === 'ethCall') {
      const cd =
        method === 'callContract'
          ? encodeLocalAbi(params.fnSig, params.args || [])
          : params.data || '0x';
      const out = await vm.execute({ calldataHex: cd, isStatic: true });
      reply(out.returnHex);
      return;
    }

    if (method === 'sendTransaction') {
      const cd = params.data || (params.fnSig ? encodeLocalAbi(params.fnSig, params.args || []) : '0x');
      const out = await vm.execute({ calldataHex: cd, isStatic: false });
      document.getElementById('lblVmBlock').textContent = String(out.blockNumber);
      pushLogEntry(
        'tx',
        `⚡ ${persona.nickname} -> ${params.fnSig || cd.slice(0, 10)} (Blk #${out.blockNumber}, ${out.elapsedMs}ms)`
      );
      recordDecodedEvents(out.logs, out.blockNumber);
      renderWorldStateTable();
      reply({
        txHash: out.txHash,
        status: '0x1',
        blockNumber: out.blockNumber,
        logs: out.logs,
      });
      return;
    }

    if (method === 'resolveIdentity') {
      const addr = String(params.address || '').toLowerCase();
      const hit = VM_PERSONAS.find(
        (p) => p.identityAddr.toLowerCase() === addr || p.eoa.toLowerCase() === addr
      );
      reply({ address: addr, nickname: hit ? hit.nickname : shortHex(addr) });
      return;
    }

    if (method === 'getAppStorage') {
      reply(state.sandboxKv[params.key] ?? null);
      return;
    }

    if (method === 'setAppStorage') {
      state.sandboxKv[params.key] = params.value;
      reply(true);
      return;
    }

    reply(null, 'Unsupported method: ' + method);
  } catch (err) {
    pushLogEntry('err', `[VM Revert] ${err.message || err}`);
    reply(null, err.message || String(err));
  }
});

// ---------------------------------------------------------------------------
// 8. ABI Workbench, WorldState KV Table & Event Log Renderers
// ---------------------------------------------------------------------------

function pushLogEntry(kind, text) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  state.logs.unshift({ kind, text, ts });
  if (state.logs.length > 120) state.logs.length = 120;
  renderLogsPane();
}

function recordDecodedEvents(logs, blockNumber) {
  if (!logs?.length) return;
  const evByTopic = new Map(
    (state.abi?.events || []).map((e) => [e.topic0.toLowerCase(), e])
  );
  for (const log of logs) {
    const t0 = String(log.topics?.[0] || '').toLowerCase();
    const spec = evByTopic.get(t0);
    const dataBytes = hexToBytes(log.data || '0x');
    const words = [];
    for (let off = 0; off + 32 <= dataBytes.length; off += 32) {
      let v = 0n;
      for (let i = 24; i < 32; i++) v = (v << 8n) | BigInt(dataBytes[off + i]);
      words.push(v.toString());
    }
    const title = spec ? spec.signature : shortHex(t0);
    pushLogEntry(
      'ev',
      `📡 Event ${title} @ Blk #${blockNumber} • topics=${log.topics.length} • u64_words=[${words.join(', ')}]`
    );
  }
}

function renderLogsPane() {
  document.getElementById('cntLogs').textContent = String(state.logs.length);
  const el = document.getElementById('inspLogs');
  if (!state.logs.length) {
    el.innerHTML = '<div style="color:#64748b;font-size:0.7rem;padding:8px;">No events or console logs recorded yet.</div>';
    return;
  }
  el.innerHTML = state.logs
    .map(
      (item) =>
        `<div class="log-entry ${item.kind}"><span style="color:#64748b;">[${item.ts}]</span> ${escapeHtml(item.text)}</div>`
    )
    .join('');
}

function formatKeyPreview(hexKey) {
  const bytes = hexToBytes(hexKey);
  let ascii = '';
  let printable = 0;
  for (let i = 0; i < Math.min(bytes.length, 16); i++) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) {
      ascii += String.fromCharCode(b);
      printable++;
    } else {
      break;
    }
  }
  const restHex = bytesToHex(bytes.subarray(ascii.length));
  return printable >= 2
    ? `<strong>"${escapeHtml(ascii)}"</strong> + ${shortHex(restHex, 6, 4)}`
    : shortHex('0x' + hexKey, 10, 6);
}

function formatValPreview(bytes) {
  const parts = [];
  if (bytes.length === 8) {
    let le = 0n;
    for (let i = 7; i >= 0; i--) le = (le << 8n) | BigInt(bytes[i]);
    parts.push(`u64_le=${le}`);
  }
  if (bytes.length === 20) {
    parts.push(`addr=${shortHex(bytesToHex(bytes), 6, 4)}`);
  }
  const printable = Array.from(bytes).every((b) => (b >= 32 && b <= 126) || b === 10);
  if (printable && bytes.length > 0) {
    parts.push(`utf8="${escapeHtml(new TextDecoder().decode(bytes))}"`);
  }
  parts.push(shortHex(bytesToHex(bytes), 10, 6));
  return parts.join(' • ');
}

function renderWorldStateTable() {
  const entries = Array.from(vm.storage.entries());
  document.getElementById('cntStateKeys').textContent = String(entries.length);
  const el = document.getElementById('inspState');
  if (!entries.length) {
    el.innerHTML =
      '<div class="mono" style="color:#64748b;font-size:0.7rem;padding:8px;">Local WASM VM WorldState is empty — send a transaction from the UI or ABI Workbench to populate slots.</div>';
    return;
  }

  const rows = entries
    .map(
      ([kHex, val]) => `
      <tr>
        <td class="mono">${formatKeyPreview(kHex)}</td>
        <td class="mono">${val.length} B</td>
        <td class="mono kv-hex">${formatValPreview(val)}</td>
      </tr>`
    )
    .join('');

  el.innerHTML = `
    <table class="kv-table">
      <thead><tr><th>Key Slot</th><th>Len</th><th>Decoded / Raw Value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function defaultPlaceholderForType(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'address') return vm.getActivePersona().identityAddr;
  if (k === 'bytes32') return '0x' + '11'.repeat(32);
  if (k === 'bool') return 'true';
  if (k === 'string') return 'Hello HFS!';
  if (k === 'bytes') return '0x1234';
  return '1';
}

function formatDecodedReturn(hex, hint) {
  if (!hex || hex === '0x') return '0x (empty / void)';
  const b = hexToBytes(hex);
  const parts = [];
  if (b.length >= 32 && (hint === 'uint64' || b.length === 32)) {
    let u = 0n;
    for (let i = 24; i < 32; i++) u = (u << 8n) | BigInt(b[i]);
    parts.push(`u64: ${u}`);
  }
  if (hint === 'address' && b.length >= 32) {
    parts.push(`addr: ${bytesToHex(b.subarray(12, 32))}`);
  }
  if (b.length >= 64 && b[31] === 0x20) {
    let len = 0;
    for (let i = 56; i < 64; i++) len = (len << 8) | b[i];
    const slice = b.subarray(64, 64 + len);
    parts.push(`utf8: "${new TextDecoder().decode(slice)}"`);
  }
  parts.push(`raw (${b.length}B): ${shortHex(hex, 14, 8)}`);
  return parts.join('  |  ');
}

function renderAbiWorkbench() {
  const fns = state.abi?.functions || [];
  document.getElementById('cntAbiFns').textContent = String(fns.length);
  const mount = document.getElementById('inspAbi');
  if (!fns.length) {
    mount.innerHTML =
      '<div class="mono" style="color:#64748b;font-size:0.7rem;padding:8px;">Declare endpoints inside <code>hps_entry! { ... }</code> in <code>src/main.rs</code> to populate the interactive ABI Workbench.</div>';
    return;
  }

  mount.innerHTML =
    '<div class="abi-grid">' +
    fns
      .map((fn, idx) => {
        const isView = fn.mutability === 'view';
        const inputsHtml = fn.inputs
          .map(
            (inp, aIdx) => `
            <input
              type="text"
              class="abi-arg-input mono"
              data-fn-arg="${idx}:${aIdx}"
              placeholder="${escapeHtml(inp.name)}: ${escapeHtml(inp.kind)}"
              value="${escapeHtml(defaultPlaceholderForType(inp.kind))}"
            />`
          )
          .join('');
        return `
        <div class="abi-fn-card mono">
          <div class="abi-fn-head">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="abi-badge ${isView ? 'view' : 'tx'}">${isView ? 'VIEW' : 'TX'}</span>
              <strong style="color:#f8fafc;font-size:0.72rem;">${escapeHtml(fn.signature)}</strong>
              <span style="color:#64748b;font-size:0.63rem;">${fn.selector}</span>
            </div>
            <button type="button" class="ide-btn ${isView ? 'ide-btn-sky' : 'ide-btn-emerald'} mono" data-invoke-fn="${idx}" style="padding:3px 10px;font-size:0.66rem;">
              ${isView ? '🔍 Call' : '⚡ Transact'}
            </button>
          </div>
          ${inputsHtml ? `<div class="abi-inputs-row">${inputsHtml}</div>` : ''}
          <div id="abiOut_${idx}" class="abi-result-box" hidden></div>
        </div>`;
      })
      .join('') +
    '</div>';

  mount.querySelectorAll('[data-invoke-fn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.invokeFn);
      const fn = fns[idx];
      const outBox = document.getElementById(`abiOut_${idx}`);
      outBox.hidden = false;
      outBox.className = 'abi-result-box';
      outBox.textContent = 'Executing…';

      try {
        const typedArgs = fn.inputs.map((inp, aIdx) => {
          const el = mount.querySelector(`[data-fn-arg="${idx}:${aIdx}"]`);
          const rawVal = el ? el.value.trim() : '';
          return [inp.kind, rawVal];
        });
        const cd = encodeLocalAbi(fn.signature, typedArgs);
        const isView = fn.mutability === 'view';

        if (state.execMode === 'local-vm') {
          const res = await vm.execute({ calldataHex: cd, isStatic: isView });
          if (!isView) {
            document.getElementById('lblVmBlock').textContent = String(res.blockNumber);
            recordDecodedEvents(res.logs, res.blockNumber);
            renderWorldStateTable();
            reloadPreviewIframe();
          }
          outBox.textContent = `✓ (${res.elapsedMs}ms) ${formatDecodedReturn(res.returnHex, fn.returnHint)}`;
        } else {
          const target = document.getElementById('inLiveHfsAddr').value.trim() || state.liveHfsAddr;
          if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
            throw new Error('Deploy or enter a 0x… Subnet 1 HFS address first.');
          }
          if (!hostSdk) throw new Error('Host SDK required for live Subnet 1 RPC.');
          if (isView) {
            const retHex = await hostSdk.slxNodeRpc(rpcUrl, 'eth_call', [{ to: target, data: cd }, 'latest']);
            outBox.textContent = `✓ Subnet 1: ${formatDecodedReturn(retHex, fn.returnHint)}`;
          } else {
            const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'HFS Studio Workbench' });
            const eoa = wallet.keypair.address;
            const nonce = BigInt(await hostSdk.slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [eoa, 'latest']));
            const txData = hostSdk.encodeAbi('execute(address,bytes)', [
              ['address', target],
              ['bytes', hexToBytes(cd)],
            ]);
            const signed = hostSdk.signOrderedLexiconTx({
              privateKey: wallet.keypair.privateKey,
              nonce,
              to: idRec.identityAddr,
              data: txData,
              gasLimit: 6_000_000n,
              extraTargets: [idRec.identityAddr, target],
            });
            const txHash = await hostSdk.slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
            const rcpt = await hostSdk.slxWaitForReceipt((m, p) => hostSdk.slxNodeRpc(rpcUrl, m, p), txHash);
            recordDecodedEvents(rcpt.logs || [], Number(BigInt(rcpt.blockNumber || 0)));
            reloadPreviewIframe();
            outBox.textContent = `✓ Confirmed in Subnet 1 Blk #${Number(BigInt(rcpt.blockNumber || 0))} (${shortHex(txHash)})`;
          }
        }
      } catch (err) {
        outBox.className = 'abi-result-box err';
        outBox.textContent = '⚠ ' + (err.message || err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 9. Compiler Daemon (`cargo hps studio`) Discovery, Compile & Unit Tests
// ---------------------------------------------------------------------------

function parseAppJsonSafe() {
  try {
    return JSON.parse(state.files['app.json'] || '{}');
  } catch (_) {
    return { slug: 'my-hfs-app', title: 'My HFS App', version: '1.0.0', category: 6, icon: '⚡', summary: '' };
  }
}

function updateWasmHud({ elapsedMs = null, ok = true, note = '' } = {}) {
  const wasmLen = state.wasmBytes ? state.wasmBytes.length : 0;
  const kb = wasmLen ? (wasmLen / 1024).toFixed(1) + 'K' : '—';
  document.getElementById('badgeWasmSize').textContent = kb;

  const badge = document.getElementById('lblBuildBadge');
  badge.className = ok ? 'ide-pill ide-pill-ok' : 'ide-pill ide-pill-err';
  badge.textContent = ok
    ? elapsedMs !== null
      ? `✓ Built in ${elapsedMs}ms`
      : '✓ WASM Ready'
    : '✗ Build Error';

  document.getElementById('lblWasmBudget').textContent = wasmLen
    ? `Bytecode: ${(wasmLen / 1024).toFixed(1)} KiB / ${(MAX_LEXICON_BYTECODE_BYTES / 1024).toFixed(1)} KiB RF Cap`
    : 'Bytecode: —';
  document.getElementById('lblCodeHash').textContent = state.codeHash
    ? `codeHash: ${shortHex(state.codeHash, 8, 6)}`
    : 'codeHash: —';

  const body = document.getElementById('diagBody');
  if (!state.diagnostics.length) {
    body.innerHTML = `<div style="color:#6ee7b7;">${escapeHtml(
      note || `✓ Validated WebAssembly module (${wasmLen} bytes, memory >= 16 pages, exports main & memory).`
    )}</div>`;
  } else {
    body.classList.remove('collapsed');
    body.innerHTML = state.diagnostics
      .map(
        (d, i) => `
        <div class="ide-diag-item ${d.level}" data-diag-idx="${i}">
          <strong>[${d.level.toUpperCase()}] Line ${d.line}:${d.column}</strong> — ${escapeHtml(d.message)}
        </div>`
      )
      .join('');
    body.querySelectorAll('[data-diag-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const d = state.diagnostics[Number(el.dataset.diagIdx)];
        if (state.activeFile !== 'main.rs') switchEditorTab('main.rs');
        jumpToLine(d.line);
      });
    });
  }
}

function jumpToLine(lineNum) {
  const ta = document.getElementById('codeInput');
  const lines = ta.value.split('\n');
  let pos = 0;
  for (let i = 0; i < Math.min(lineNum - 1, lines.length); i++) {
    pos += lines[i].length + 1;
  }
  const lineLen = (lines[lineNum - 1] || '').length;
  ta.focus();
  ta.setSelectionRange(pos, pos + lineLen);
  const scrollWrap = document.getElementById('editorScrollWrap');
  scrollWrap.scrollTop = Math.max(0, (lineNum - 4) * 20);
}

async function probeCompilerDaemon(preferredUrl = '') {
  const saved = localStorage.getItem(STORAGE_COMPILER_URL_KEY) || '';
  const candidates = [];
  if (preferredUrl) candidates.push(preferredUrl.replace(/\/+$/, ''));
  if (saved) candidates.push(saved.replace(/\/+$/, ''));
  if (window.location.port === '4770') candidates.push(window.location.origin);
  candidates.push(`${window.location.origin}/hps-studio-api`);
  if (window.location.hostname && window.location.hostname !== '127.0.0.1') {
    candidates.push(`http://${window.location.hostname}:4770`);
  }
  candidates.push('http://127.0.0.1:4770');

  const unique = Array.from(new Set(candidates.filter(Boolean)));
  for (const base of unique) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1400);
      const r = await fetch(`${base}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.ok && j.service === 'cargo-hps-studio') {
        state.compilerUrl = base;
        state.compilerOnline = true;
        state.compilerSandbox = Boolean(j.sandbox);
        state.rustcVersion = j.rustcVersion || 'rustc';
        localStorage.setItem(STORAGE_COMPILER_URL_KEY, base);
        updateCompilerPillUi();
        await fetchWorkspaceExamplesList();
        return true;
      }
    } catch (_) {}
  }

  state.compilerOnline = false;
  updateCompilerPillUi();
  return false;
}

function updateCompilerPillUi() {
  const dot = document.getElementById('compilerDot');
  const txt = document.getElementById('compilerStatusText');
  const saveBtn = document.getElementById('btnSaveLocal');
  if (state.compilerOnline) {
    dot.classList.add('online');
    txt.textContent = state.compilerSandbox
      ? 'rustc Connected (Sandbox)'
      : 'rustc Connected (Local)';
    saveBtn.hidden = state.compilerSandbox;
  } else {
    dot.classList.remove('online');
    txt.textContent = 'VM Mode (Connect rustc ▾)';
    saveBtn.hidden = true;
  }
}

async function fetchWorkspaceExamplesList() {
  if (!state.compilerOnline || !state.compilerUrl) return;
  try {
    const r = await fetch(`${state.compilerUrl}/api/examples`);
    const j = await r.json();
    if (j?.ok && Array.isArray(j.examples) && j.examples.length > 0) {
      state.workspaceExamples = j.examples;
      const grp = document.getElementById('optGroupWorkspace');
      grp.hidden = false;
      grp.innerHTML = j.examples
        .map(
          (ex) =>
            `<option value="ex:${escapeHtml(ex.name)}">🦀 examples/${escapeHtml(ex.name)} (${
              ex.wasmBytes ? (ex.wasmBytes / 1024).toFixed(1) + 'K' : 'src'
            })</option>`
        )
        .join('');
    }
  } catch (_) {}
}

async function compileCurrentRust() {
  const btn = document.getElementById('btnCompileRust');
  if (!state.compilerOnline) {
    const connected = await probeCompilerDaemon();
    if (!connected) {
      document.getElementById('inCompilerUrl').value = state.compilerUrl || 'http://127.0.0.1:4770';
      document.getElementById('modalCompiler').hidden = false;
      showToast('Start "cargo hps studio" to recompile edited Rust source.', 'warn');
      return false;
    }
  }

  btn.disabled = true;
  btn.textContent = '⏳ Compiling…';
  try {
    const appCfg = parseAppJsonSafe();
    const r = await fetch(`${state.compilerUrl}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: appCfg.slug || 'hfs_app',
        rustSource: state.files['main.rs'],
        stripCustomSections: true,
      }),
    });
    const res = await r.json();
    state.diagnostics = res.diagnostics || [];

    if (!res.ok || !res.wasmBase64) {
      renderEditorChrome();
      updateWasmHud({ ok: false, note: res.error || 'Compilation failed.' });
      showToast('Rust compilation failed — see highlighted error line.', 'err');
      return false;
    }

    const wasmBytes = base64ToBytes(res.wasmBase64);
    state.wasmBytes = wasmBytes;
    state.codeHash = res.codeHash;
    state.rawWasmSize = res.rawSize;
    state.abi = res.abi || parseRustHpsAbiClient(state.files['main.rs']);
    state.files['bridge.js'] = generateAutoBridgeJs(state.abi);

    await vm.loadWasm(wasmBytes);
    renderEditorChrome();
    renderSnippetBar();
    renderAbiWorkbench();
    updateWasmHud({ elapsedMs: res.elapsedMs, ok: true });
    reloadPreviewIframe();
    pushLogEntry(
      'tx',
      `🦀 Compiled Rust -> ${wasmBytes.length}B .wasm in ${res.elapsedMs}ms (codeHash ${shortHex(res.codeHash)})`
    );
    showToast(`✓ Compiled .wasm (${(wasmBytes.length / 1024).toFixed(1)} KiB) in ${res.elapsedMs}ms!`);
    return true;
  } catch (err) {
    showToast('Compiler connection error: ' + (err.message || err), 'err');
    state.compilerOnline = false;
    updateCompilerPillUi();
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Compile Rust';
  }
}

async function runUnitTests() {
  if (!state.compilerOnline) {
    const ok = await probeCompilerDaemon();
    if (!ok) {
      document.getElementById('modalCompiler').hidden = false;
      return;
    }
  }
  const btn = document.getElementById('btnRunTests');
  btn.disabled = true;
  btn.textContent = '⏳ Testing…';
  try {
    const r = await fetch(`${state.compilerUrl}/api/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rustSource: state.files['main.rs'] }),
    });
    const res = await r.json();
    const diagBody = document.getElementById('diagBody');
    diagBody.classList.remove('collapsed');

    if (res.sandboxRestricted) {
      diagBody.innerHTML = `<div class="ide-diag-item warning">${escapeHtml(res.error)}</div>`;
      showToast('Native #[test] runner requires local mode ("cargo hps studio").', 'warn');
      return;
    }

    const summary = res.ok
      ? `✓ Unit Tests Passed: ${res.passed} ok, ${res.failed} failed (${res.elapsedMs}ms)`
      : `✗ Unit Tests Failed (${res.failed || 1} failed)`;
    diagBody.innerHTML = `
      <div class="ide-diag-item ${res.ok ? '' : 'error'}"><strong>${escapeHtml(summary)}</strong></div>
      <pre style="margin:4px 0 0;white-space:pre-wrap;color:#94a3b8;">${escapeHtml(
        (res.stdout || '') + (res.stderr && !res.ok ? '\n' + res.stderr : '')
      )}</pre>
    `;
    pushLogEntry(res.ok ? 'tx' : 'err', `🧪 ${summary}`);
    showToast(summary, res.ok ? 'ok' : 'err');
  } catch (err) {
    showToast('Test runner error: ' + (err.message || err), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '🧪 Unit Tests';
  }
}

// ---------------------------------------------------------------------------
// 10. Loading Starter Templates, Workspace Examples & Importing .wasm
// ---------------------------------------------------------------------------

async function loadStarterTemplate(slug) {
  const tpl = STARTER_TEMPLATES[slug];
  if (!tpl) return;

  state.diagnostics = [];
  state.abi = tpl.abi || parseRustHpsAbiClient(tpl.rustSource);
  state.files['main.rs'] = tpl.rustSource;
  state.files['index.html'] = tpl.indexHtml;
  state.files['styles.css'] = tpl.stylesCss;
  state.files['app.js'] = tpl.appJs;
  state.files['app.json'] = JSON.stringify(
    {
      slug: tpl.slug,
      title: tpl.title,
      version: tpl.version,
      category: tpl.category,
      icon: tpl.icon,
      summary: tpl.summary,
    },
    null,
    2
  );
  state.files['bridge.js'] = generateAutoBridgeJs(state.abi);

  const wasmBytes = base64ToBytes(tpl.wasmBase64);
  state.wasmBytes = wasmBytes;
  state.codeHash = tpl.codeHash;
  state.rawWasmSize = tpl.rawSize;

  vm.resetState();
  await vm.loadWasm(wasmBytes);
  document.getElementById('lblVmBlock').textContent = String(vm.blockNumber);

  switchEditorTab(state.activeFile);
  renderAbiWorkbench();
  renderWorldStateTable();
  updateWasmHud({ ok: true });
  reloadPreviewIframe();
}

async function loadWorkspaceExampleFromDaemon(name) {
  if (!state.compilerOnline) return;
  try {
    const r = await fetch(`${state.compilerUrl}/api/example?name=${encodeURIComponent(name)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed loading example');

    state.diagnostics = [];
    state.files['main.rs'] = j.rustSource;
    state.abi = j.abi || parseRustHpsAbiClient(j.rustSource);
    state.files['bridge.js'] = generateAutoBridgeJs(state.abi);
    state.files['app.json'] = JSON.stringify(
      {
        slug: j.name,
        title: j.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        version: '1.0.0',
        category: 6,
        icon: '🦀',
        summary: `Custom UI workspace wired to examples/${j.name}/src/main.rs`,
      },
      null,
      2
    );

    const fnListHtml = (state.abi.functions || [])
      .slice(0, 6)
      .map((f) => `<li><code>${escapeHtml(f.signature)}</code> (${f.selector})</li>`)
      .join('');
    state.files['index.html'] = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><link rel="stylesheet" href="./styles.css" /></head>
<body>
  <div class="box">
    <h3>🦀 ${escapeHtml(j.name)} — Custom Frontend Harness</h3>
    <p id="who" style="color:#94a3b8;font-family:monospace;font-size:12px;"></p>
    <ul style="font-size:12.5px;color:#bae6fd;line-height:1.6;">${fnListHtml}</ul>
    <p style="font-size:12px;color:#6ee7b7;">Use the <strong>⚡ ui/app.js</strong> tab chips or <strong>🎛️ ABI Workbench</strong> below to invoke any method!</p>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>`;
    state.files['styles.css'] = `body { margin:0; padding:18px; background:#050b16; color:#f8fafc; font-family:system-ui,sans-serif; }
.box { max-width:620px; margin:0 auto; padding:18px; border-radius:14px; background:#0a152a; border:1px solid rgba(56,189,248,0.4); }`;
    state.files['app.js'] = `const ctx = await HFS.getContext();
document.getElementById('who').textContent = 'Connected as ' + ctx.user.nickname + ' | HFS methods: ' + HFS.abi.functions.length;
`;

    if (j.wasmBase64) {
      const wb = base64ToBytes(j.wasmBase64);
      state.wasmBytes = wb;
      state.codeHash = j.codeHash;
      vm.resetState();
      await vm.loadWasm(wb);
      updateWasmHud({ ok: true, note: `Loaded pre-built dist/${name.replace(/-/g, '_')}.wasm (${wb.length} bytes).` });
    } else {
      await compileCurrentRust();
    }

    switchEditorTab('main.rs');
    renderAbiWorkbench();
    renderWorldStateTable();
    reloadPreviewIframe();
    showToast(`Loaded workspace crate examples/${name}!`);
  } catch (err) {
    showToast('Load example error: ' + (err.message || err), 'err');
  }
}

let _previewDebounce = null;
function onEditorSourceMutated() {
  if (state.activeFile === 'main.rs') {
    state.abi = parseRustHpsAbiClient(state.files['main.rs']);
    state.files['bridge.js'] = generateAutoBridgeJs(state.abi);
    renderAbiWorkbench();
  }
  renderEditorChrome();

  if (state.activeFile === 'index.html' || state.activeFile === 'styles.css' || state.activeFile === 'app.js') {
    clearTimeout(_previewDebounce);
    _previewDebounce = setTimeout(() => {
      reloadPreviewIframe();
    }, 420);
  }
}

// ---------------------------------------------------------------------------
// 11. Subnet 1 Deployment & AppStore Publishing + Artifact Downloads
// ---------------------------------------------------------------------------

function showToast(msg, kind = 'ok') {
  const el = document.getElementById('ideToast');
  if (!el) return;
  el.hidden = false;
  el.style.borderColor =
    kind === 'err'
      ? 'rgba(244,63,94,0.7)'
      : kind === 'warn'
      ? 'rgba(251,191,36,0.7)'
      : 'rgba(56,189,248,0.65)';
  el.textContent = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, 4200);
}

function downloadBlob(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function openDeployModal() {
  await refreshBundleMetrics();
  const cfg = parseAppJsonSafe();
  document.getElementById('inPubSlug').value = cfg.slug || 'my-hfs-app';
  document.getElementById('inPubTitle').value = cfg.title || 'My HFS App';
  document.getElementById('inPubIcon').value = cfg.icon || '⚡';
  document.getElementById('inPubVersion').value = cfg.version || '1.0.0';
  document.getElementById('inPubCategory').value = String(cfg.category || 6);
  document.getElementById('inPubSummary').value = cfg.summary || '';
  document.getElementById('inPubExistingHfs').value = state.liveHfsAddr || '';

  const wasmKb = state.wasmBytes ? (state.wasmBytes.length / 1024).toFixed(1) : '0';
  const gzKb = state.packedBundle ? (state.packedBundle.compressedLen / 1024).toFixed(1) : '0';
  document.getElementById('deployArtifactSummary').innerHTML = `
    <div>🦀 <strong>HFS Bytecode:</strong> ${wasmKb} KiB <code>.wasm</code> • <code>codeHash = ${shortHex(state.codeHash, 10, 8)}</code></div>
    <div>📦 <strong>Deterministic UI Bundle:</strong> ${gzKb} KiB <code>.html.gz</code> (includes auto-generated <code>window.HFS</code> SDK) • <code>uiHash = ${shortHex(state.packedBundle?.uiHash || '', 10, 8)}</code></div>
  `;
  document.getElementById('deployProgressBox').textContent = 'Ready to deploy to Subnet 1.';
  document.getElementById('modalDeploy').hidden = false;
}

async function deployWasmInstanceOnly() {
  const logEl = document.getElementById('deployProgressBox');
  if (!hostSdk || !wallet) {
    logEl.textContent = '⚠ Open /hfs-ide.html inside the SuperLexicon Web Client to sign Subnet 1 transactions with your Host Wallet.';
    return;
  }
  if (!state.wasmBytes?.length) {
    logEl.textContent = '⚠ Compile or import a .wasm binary first.';
    return;
  }

  try {
    await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'HFS Studio Deployer' });
    const myEoa = wallet.keypair.address;
    const myPriv = wallet.keypair.privateKey;
    const codeHash = keccak256Hex(state.wasmBytes);

    logEl.textContent = `[1/2] Uploading ${(state.wasmBytes.length / 1024).toFixed(1)} KiB WASM to BYTECODE_STORE…`;
    const n1 = BigInt(await hostSdk.slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const s1 = hostSdk.signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: n1,
      to: hostSdk.BYTECODE_STORE_ADDRESS,
      data: codeHash + bytesToHex(state.wasmBytes, false),
      gasLimit: 9_000_000n,
    });
    const h1 = await hostSdk.slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s1.raw]);
    await hostSdk.slxWaitForReceipt((m, p) => hostSdk.slxNodeRpc(rpcUrl, m, p), h1);

    logEl.textContent = '[2/2] Instantiating fresh HFS subroutine instance on Subnet 1…';
    const n2 = BigInt(await hostSdk.slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const predicted = hostSdk.computeCreateAddress(myEoa, n2).toLowerCase();
    const s2 = hostSdk.signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: n2,
      to: null,
      data: codeHash,
      gasLimit: 4_800_000n,
      extraTargets: [predicted],
    });
    const h2 = await hostSdk.slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s2.raw]);
    const r2 = await hostSdk.slxWaitForReceipt((m, p) => hostSdk.slxNodeRpc(rpcUrl, m, p), h2);
    const deployedAddr = (r2.contractAddress || predicted).toLowerCase();

    state.liveHfsAddr = deployedAddr;
    document.getElementById('inLiveHfsAddr').value = deployedAddr;
    document.getElementById('inPubExistingHfs').value = deployedAddr;
    setExecutionMode('subnet1');
    logEl.innerHTML = `✅ Deployed live HFS at <code>${deployedAddr}</code> (Blk #${Number(BigInt(r2.blockNumber || 0))})! Preview switched to <strong>Subnet 1</strong>.`;
    pushLogEntry('tx', `⛓️ Deployed HFS instance on Subnet 1 -> ${deployedAddr}`);
    showToast(`Deployed HFS at ${shortHex(deployedAddr)}!`);
  } catch (err) {
    logEl.textContent = '⚠ Deploy error: ' + (err.message || err);
  }
}

async function publishFullAppToStore() {
  const logEl = document.getElementById('deployProgressBox');
  if (!storeClient || !wallet) {
    logEl.textContent = '⚠ Open /hfs-ide.html inside the SuperLexicon Web Client to publish to Subnet 1 AppStore.';
    return;
  }
  await refreshBundleMetrics();

  const slug = document.getElementById('inPubSlug').value.trim();
  const title = document.getElementById('inPubTitle').value.trim();
  const icon = document.getElementById('inPubIcon').value.trim() || '⚡';
  const version = document.getElementById('inPubVersion').value.trim() || '1.0.0';
  const category = Number(document.getElementById('inPubCategory').value || 6);
  const summary = document.getElementById('inPubSummary').value.trim();
  const existingHfs = document.getElementById('inPubExistingHfs').value.trim();

  try {
    const saved = await storeClient.publishApp({
      wallet,
      slug,
      title,
      summary,
      icon,
      version,
      category,
      execMode: hostSdk.APP_EXEC_MODE.SANDBOX_IFRAME,
      gzBytes: state.packedBundle.gzBytes,
      htmlSource: state.packedBundle.html,
      wasmBytes: state.wasmBytes,
      wasmCodeHash: state.codeHash,
      defaultHfsAddr: existingHfs || undefined,
      deployInstance: !existingHfs,
      onStatus: (msg) => {
        logEl.textContent = '⏳ ' + msg;
      },
    });

    if (saved.defaultHfsAddr) {
      state.liveHfsAddr = saved.defaultHfsAddr;
      document.getElementById('inLiveHfsAddr').value = saved.defaultHfsAddr;
    }
    logEl.innerHTML = `🎉 Published <strong>${escapeHtml(saved.title)}</strong> (<code>#${saved.appId || 'local'}</code>) • HFS <code>${shortHex(saved.defaultHfsAddr)}</code> • <a href="/apps.html?run=${encodeURIComponent(saved.slug)}" target="_blank" style="color:#6ee7b7;font-weight:800;">▶ Launch in App Store ↗</a>`;
    pushLogEntry('tx', `🚀 Published "${saved.title}" (${saved.slug}) to Subnet 1 AppStore!`);
    showToast(`Published "${saved.title}" to AppStore!`);
  } catch (err) {
    logEl.textContent = '⚠ Publish error: ' + (err.message || err);
  }
}

function setExecutionMode(mode) {
  state.execMode = mode;
  const isLocal = mode === 'local-vm';
  document.getElementById('btnModeLocalVm').classList.toggle('active', isLocal);
  document.getElementById('btnModeLiveChain').classList.toggle('active', !isLocal);
  document.getElementById('vmControlsGroup').hidden = !isLocal;
  document.getElementById('liveChainTargetGroup').hidden = isLocal;

  const badge = document.getElementById('previewTargetBadge');
  badge.className = isLocal ? 'ide-pill ide-pill-cyan' : 'ide-pill ide-pill-ok';
  badge.textContent = isLocal ? '🧪 Local WASM VM' : '⛓️ Live Subnet 1';
  reloadPreviewIframe();
}

// ---------------------------------------------------------------------------
// 12. Bootstrapping & Event Listeners
// ---------------------------------------------------------------------------

function bindUiEvents() {
  const ta = document.getElementById('codeInput');
  const scrollWrap = document.getElementById('editorScrollWrap');
  const gutter = document.getElementById('codeGutter');

  scrollWrap.addEventListener('scroll', () => {
    gutter.scrollTop = scrollWrap.scrollTop;
  });

  ta.addEventListener('input', () => {
    state.files[state.activeFile] = ta.value;
    onEditorSourceMutated();
  });

  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      insertAtCursor('    ');
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      compileCurrentRust();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'Enter' || ev.key.toLowerCase() === 's')) {
      ev.preventDefault();
      if (state.activeFile === 'main.rs' && state.compilerOnline) {
        compileCurrentRust();
      } else {
        reloadPreviewIframe();
        showToast('Reloaded live UI preview.');
      }
    }
  });

  document.querySelectorAll('#fileTabBar .ide-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchEditorTab(btn.dataset.file));
  });

  document.getElementById('selTemplate').addEventListener('change', async (ev) => {
    const val = ev.target.value;
    if (val.startsWith('tpl:')) {
      await loadStarterTemplate(val.slice(4));
    } else if (val.startsWith('ex:')) {
      await loadWorkspaceExampleFromDaemon(val.slice(3));
    }
  });

  document.getElementById('btnCompileRust').addEventListener('click', compileCurrentRust);
  document.getElementById('btnRunTests').addEventListener('click', runUnitTests);

  document.getElementById('btnModeLocalVm').addEventListener('click', () => setExecutionMode('local-vm'));
  document.getElementById('btnModeLiveChain').addEventListener('click', () => setExecutionMode('subnet1'));

  document.querySelectorAll('[data-set-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-set-layout');
      document.getElementById('ideShell').setAttribute('data-layout', mode);
      document.querySelectorAll('[data-set-layout]').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
    });
  });

  document.querySelectorAll('.ide-insp-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.insp;
      state.activeInspTab = tab;
      document.querySelectorAll('.ide-insp-tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('inspAbi').classList.toggle('active', tab === 'abi');
      document.getElementById('inspState').classList.toggle('active', tab === 'state');
      document.getElementById('inspLogs').classList.toggle('active', tab === 'logs');
    });
  });

  document.getElementById('selVmPersona').addEventListener('change', (ev) => {
    vm.personaIndex = Number(ev.target.value) || 0;
    renderAbiWorkbench();
    reloadPreviewIframe();
  });

  document.getElementById('btnVmNextBlock').addEventListener('click', () => {
    vm.blockNumber += 1n;
    document.getElementById('lblVmBlock').textContent = String(vm.blockNumber);
    reloadPreviewIframe();
  });

  document.getElementById('btnVmReset').addEventListener('click', () => {
    vm.resetState();
    state.sandboxKv = {};
    document.getElementById('lblVmBlock').textContent = String(vm.blockNumber);
    renderWorldStateTable();
    reloadPreviewIframe();
    pushLogEntry('tx', '↺ Reset Local WASM VM WorldState & block counter.');
  });

  document.getElementById('btnReloadPreview').addEventListener('click', () => {
    reloadPreviewIframe();
    showToast('Reloaded live preview.');
  });

  document.getElementById('btnClearLogs').addEventListener('click', () => {
    state.logs = [];
    renderLogsPane();
  });

  document.getElementById('btnToggleDiagBody').addEventListener('click', () => {
    document.getElementById('diagBody').classList.toggle('collapsed');
  });

  document.getElementById('btnImportWasm').addEventListener('click', () => {
    document.getElementById('inWasmFile').click();
  });

  document.getElementById('inWasmFile').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
        throw new Error('Not a valid WebAssembly (.wasm) binary.');
      }
      state.wasmBytes = bytes;
      state.codeHash = keccak256Hex(bytes);
      await vm.loadWasm(bytes);
      updateWasmHud({ ok: true, note: `Imported ${file.name} (${bytes.length} bytes) into Local WASM VM.` });
      reloadPreviewIframe();
      showToast(`Loaded ${file.name} (${(bytes.length / 1024).toFixed(1)} KiB)!`);
    } catch (err) {
      showToast(err.message || String(err), 'err');
    }
    ev.target.value = '';
  });

  document.getElementById('btnDownloadArtifacts').addEventListener('click', async () => {
    await refreshBundleMetrics();
    const cfg = parseAppJsonSafe();
    const slug = (cfg.slug || 'my-hfs-app').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (state.wasmBytes?.length) {
      downloadBlob(state.wasmBytes, `${slug.replace(/-/g, '_')}.wasm`, 'application/wasm');
    }
    if (state.packedBundle?.gzBytes) {
      downloadBlob(state.packedBundle.gzBytes, `${slug}.html.gz`, 'application/gzip');
    }
    showToast(`Exported ${slug}.wasm + ${slug}.html.gz!`);
  });

  document.getElementById('btnSaveLocal').addEventListener('click', async () => {
    if (!state.compilerOnline || state.compilerSandbox) return;
    const cfg = parseAppJsonSafe();
    try {
      const r = await fetch(`${state.compilerUrl}/api/save-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: cfg.slug || 'my-hfs-app',
          title: cfg.title || 'My HFS App',
          version: cfg.version || '1.0.0',
          category: Number(cfg.category || 6),
          icon: cfg.icon || '⚡',
          summary: cfg.summary || '',
          rustSource: state.files['main.rs'],
          indexHtml: state.files['index.html'],
          stylesCss: state.files['styles.css'],
          appJs: state.files['app.js'],
          autoBridgeJs: state.files['bridge.js'],
          wasmBase64: state.wasmBytes ? bytesToBase64(state.wasmBytes) : null,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Save failed');
      pushLogEntry('tx', `💾 Saved Cargo + UI project to ${j.projectDir}`);
      showToast(`Saved project to ${j.projectDir}!`);
    } catch (err) {
      showToast('Save error: ' + (err.message || err), 'err');
    }
  });

  document.getElementById('btnCompilerStatus').addEventListener('click', () => {
    document.getElementById('inCompilerUrl').value = state.compilerUrl || 'http://127.0.0.1:4770';
    document.getElementById('compilerModalStatus').textContent = state.compilerOnline
      ? `✓ Connected to ${state.compilerUrl} (${state.rustcVersion})`
      : 'Not connected — run cargo hps studio and click Connect.';
    document.getElementById('modalCompiler').hidden = false;
  });

  document.getElementById('btnConnectCompiler').addEventListener('click', async () => {
    const url = document.getElementById('inCompilerUrl').value.trim();
    const note = document.getElementById('compilerModalStatus');
    note.textContent = 'Connecting…';
    const ok = await probeCompilerDaemon(url);
    note.textContent = ok
      ? `✓ Connected to ${state.compilerUrl} (${state.rustcVersion})!`
      : `✗ Could not reach ${url}/api/health — ensure cargo hps studio is running.`;
  });

  document.getElementById('btnOpenDeployModal').addEventListener('click', openDeployModal);
  document.getElementById('btnDeployHfsOnly').addEventListener('click', deployWasmInstanceOnly);
  document.getElementById('btnPublishFullApp').addEventListener('click', publishFullAppToStore);

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.getAttribute('data-close-modal')).hidden = true;
    });
  });
}

async function bootIde() {
  if (hostUi?.mountSlxUnifiedHeader && wallet) {
    try {
      const client = hostSdk?.SlxClient ? new hostSdk.SlxClient(rpcUrl) : null;
      hostUi.mountSlxUnifiedHeader({
        mountContainer: document.getElementById('slxUnifiedHeaderMount'),
        activeAppId: 'hfs-ide',
        wallet,
        client,
        title: '🛠️ HFS Studio IDE',
        subtitle: 'Rust #![no_std] Smart Contracts • Local WASM VM • Auto-UI Bridge',
      });
    } catch (_) {}
  }

  bindUiEvents();
  await loadStarterTemplate('counter-pro');
  renderLogsPane();
  await probeCompilerDaemon();
}

bootIde();
