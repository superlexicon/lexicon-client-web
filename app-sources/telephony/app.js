/**
 * EtherCall — Serverless WebRTC Voice, HD Video & 6-Peer Mesh Rooms (`app-sources/telephony/app.js`)
 *
 * Pure use-case UI controller: all reusable WebRTC, secp256k1 ECDH + Gzip SDP/ICE envelope codecs,
 * DTLS-SRTP Identity verification, and `webrtc_signal.wasm` ABI bindings live in `@superlexicon/sdk`.
 */

import {
  SlxWalletManager,
  getDefaultNodeWsUrl,
  shortAddr,
  shortHex,
  ZERO_ADDR,
  ZERO_BYTES32,
  readOnChainIdentityNickname,
  slxWatchChainApp,
} from '@superlexicon/sdk';
import {
  DEFAULT_SUBNET1_WEBRTC_HUB,
  RTC_AVAILABILITY,
  RTC_MEDIA_KIND,
  RTC_CALL_STATUS,
  RTC_ROOM_SIGNAL_TYPE,
  WebRtcSignalClient,
  SlxWebRtcPeerSession,
  buildRtcIceServers,
  deriveRtcSignalingKeys,
  decompressSecp256k1Compressed33,
  sealRtcSignalEnvelope,
  openRtcSignalEnvelope,
  acquireCallMediaStream,
  attachStreamToVideoElement,
  stopCallMediaStream,
  createCallRingtoneController,
  createLocalLoopbackPair,
} from '@superlexicon/sdk/webrtc';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';

const CUSTOM_ICE_STORAGE_KEY = 'slx_rtc_custom_ice_v1';

const wallet = new SlxWalletManager();
const rpcUrl = getDefaultNodeWsUrl();
const rtcClient = new WebRtcSignalClient({ rpcUrl, hubAddr: DEFAULT_SUBNET1_WEBRTC_HUB });
const ringtone = createCallRingtoneController();
const nickCache = new Map();

let hubAddr = DEFAULT_SUBNET1_WEBRTC_HUB;
let hubOverview = null;
let directoryProfiles = [];
let recentCalls = [];
let roomsList = [];
let stopWatcher = null;
let syncInFlight = false;
let syncQueued = false;
let callSetupBusy = false;

// Active 1:1 Call / Loopback State
let activeStageTab = 'direct'; // 'direct' | 'rooms'
let localStream = null;
let previewOnly = false;
let activeCallId = 0;
let activeCallMeta = null;
let peerSession = null;
let loopbackHandle = null;
let appliedCallerIceBatches = 0;
let appliedCalleeIceBatches = 0;
let answerApplied = false;
let micMuted = false;
let camMuted = false;
let callConnectedAt = 0;
let statsInterval = null;
let ringingCallMeta = null;
const dismissedCallIds = new Set();

// Active Multi-Peer Mesh Room State
let joinedRoomId = 0;
let activeRoomState = null;
const meshPeers = new Map(); // peerIdentity -> { session, lastHandledSeq, offerSent, answerApplied }

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(msg, isErr = false) {
  const el = document.getElementById('txStatusMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? '#fb7185' : '#93c5fd';
}

function getActiveIceServers() {
  const inp = document.getElementById('inpCustomIceServers');
  const spec = inp ? inp.value.trim() : '';
  return buildRtcIceServers(spec);
}

function getMyIdentityOrEoa() {
  const idRec = wallet.getIdentityRecord?.();
  return (idRec?.identityAddr || wallet.keypair?.address || '').toLowerCase();
}

async function resolveDisplayName(addr) {
  const low = String(addr || '').toLowerCase();
  if (!low || low === ZERO_ADDR) return 'Unknown';
  const prof = directoryProfiles.find((p) => p.identity === low);
  if (prof?.displayLabel) return prof.displayLabel;
  if (nickCache.has(low)) return nickCache.get(low);
  try {
    const nick = await readOnChainIdentityNickname(rpcUrl, low);
    const label = nick ? `${nick} (${shortAddr(low)})` : shortAddr(low);
    nickCache.set(low, label);
    return label;
  } catch {
    return shortAddr(low);
  }
}

function appendChatBubble({ sender, text, mine = false, ts = Date.now() }) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const empty = box.querySelector('.ec-empty');
  if (empty) empty.remove();

  const timeStr = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const div = document.createElement('div');
  div.className = `ec-chat-msg${mine ? ' mine' : ''}`;
  div.innerHTML = `<div class="ec-chat-meta mono">${esc(sender)} • ${esc(timeStr)}</div><div>${esc(text)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function updateInspector({
  envelopeLabel,
  cipherLabel,
  callerFp,
  calleeFp,
  mitmStatus,
  mitmOk = true,
} = {}) {
  const hubEl = document.getElementById('insHubAddr');
  if (hubEl) hubEl.textContent = shortAddr(hubAddr);
  if (envelopeLabel !== undefined) {
    document.getElementById('insEnvelopeSize').textContent = envelopeLabel;
  }
  if (cipherLabel !== undefined) {
    document.getElementById('insCipherMode').textContent = cipherLabel;
  }
  if (callerFp !== undefined) {
    document.getElementById('insCallerFp').textContent =
      callerFp && callerFp !== ZERO_BYTES32 ? shortHex(callerFp, 8, 6) : '—';
  }
  if (calleeFp !== undefined) {
    document.getElementById('insCalleeFp').textContent =
      calleeFp && calleeFp !== ZERO_BYTES32 ? shortHex(calleeFp, 8, 6) : '—';
  }
  if (mitmStatus !== undefined) {
    const mEl = document.getElementById('insMitmStatus');
    mEl.textContent = mitmStatus;
    mEl.style.color = mitmOk ? '#6ee7b7' : '#fb7185';
  }
}

function checkSecureOriginBanner() {
  const banner = document.getElementById('insecureOriginBanner');
  if (!banner) return;
  const insecure =
    typeof window !== 'undefined' &&
    (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia);
  if (insecure) {
    document.getElementById('insecureOriginText').textContent = window.location.origin;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

async function populateMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const vSel = document.getElementById('selVideoDevice');
    const aSel = document.getElementById('selAudioDevice');
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const mics = devices.filter((d) => d.kind === 'audioinput');

    if (cams.length > 0 && vSel) {
      const prev = vSel.value;
      vSel.innerHTML =
        `<option value="">📷 Default Camera</option>` +
        cams
          .map((c, i) => `<option value="${esc(c.deviceId)}">📷 ${esc(c.label || `Camera #${i + 1}`)}</option>`)
          .join('');
      vSel.value = prev;
    }
    if (mics.length > 0 && aSel) {
      const prev = aSel.value;
      aSel.innerHTML =
        `<option value="">🎙️ Default Microphone</option>` +
        mics
          .map((m, i) => `<option value="${esc(m.deviceId)}">🎙️ ${esc(m.label || `Mic #${i + 1}`)}</option>`)
          .join('');
      aSel.value = prev;
    }
  } catch {
    // ignore permission-gated device labels
  }
}

async function ensureLocalStream(mediaKind = RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback = true } = {}) {
  const wantVideo = mediaKind !== RTC_MEDIA_KIND.VOICE;
  if (localStream && !previewOnly) {
    const hasVid = localStream.getVideoTracks().length > 0;
    if (!wantVideo || hasVid) return localStream;
  }
  if (localStream) {
    stopCallMediaStream(localStream);
    localStream = null;
  }
  const forceSynthetic = Boolean(document.getElementById('chkForceSynthetic')?.checked);
  const videoDeviceId = document.getElementById('selVideoDevice')?.value || '';
  const audioDeviceId = document.getElementById('selAudioDevice')?.value || '';
  const idRec = wallet.getIdentityRecord?.();
  const label = idRec?.nickname || shortAddr(getMyIdentityOrEoa());

  const res = await acquireCallMediaStream({
    mediaKind,
    audioDeviceId,
    videoDeviceId,
    forceSynthetic,
    allowSyntheticFallback,
    syntheticLabel: label,
  });
  localStream = res.stream;
  previewOnly = false;

  const lv = document.getElementById('localVideo');
  await attachStreamToVideoElement(lv, localStream, { muted: true });
  const tag = document.getElementById('localPipTag');
  if (tag) {
    tag.textContent = res.isSynthetic
      ? 'You (Sim Feed)'
      : localStream.getVideoTracks().length > 0
        ? 'You (Live Cam)'
        : 'You (Mic Only)';
  }
  if (res.fallbackReason) {
    setStatus(
      res.isSynthetic
        ? `⚠️ Hardware camera/mic busy or unavailable (${res.fallbackReason}) — connected using Simulated Stream.`
        : `ℹ️ ${res.fallbackReason}`
    );
  }
  await populateMediaDevices();
  return localStream;
}

let activePeerDisplayName = '';

function maybeRevealRemoteVideo() {
  const rv = document.getElementById('remoteVideo');
  const overlay = document.getElementById('stageCenterOverlay');
  if (!rv || !overlay) return;
  const activeSess = peerSession || loopbackHandle?.callerSession;
  const pc = activeSess?.pc;
  const iceLive =
    pc?.connectionState === 'connected' ||
    pc?.iceConnectionState === 'connected' ||
    pc?.iceConnectionState === 'completed';
  const hasActiveVideoTrack = Boolean(
    activeSess?.remoteStream?.getVideoTracks?.().some((t) => t.readyState === 'live' && !t.muted)
  );
  if (rv.videoWidth > 0 || (iceLive && hasActiveVideoTrack)) {
    overlay.classList.add('hidden');
  }
}

function bindRemoteVideoStream(remStream) {
  const rv = document.getElementById('remoteVideo');
  const unmuteBtn = document.getElementById('btnUnmuteRemote');
  if (!rv || !remStream) return;

  rv.onresize = () => maybeRevealRemoteVideo();
  rv.onloadeddata = () => maybeRevealRemoteVideo();
  attachStreamToVideoElement(rv, remStream, {
    muted: false,
    onAutoplayMuted: () => {
      if (unmuteBtn) unmuteBtn.style.display = 'inline-flex';
    },
  }).then(() => {
    maybeRevealRemoteVideo();
  });
}

function syncLiveConnectionBadges({ connectionState, iceConnectionState } = {}) {
  const pc = peerSession?.pc;
  const conn = connectionState || pc?.connectionState || '';
  const ice = iceConnectionState || pc?.iceConnectionState || '';
  const isConnected =
    conn === 'connected' || ice === 'connected' || ice === 'completed';
  const isFailed = conn === 'failed' || ice === 'failed';
  const peerTxt = activePeerDisplayName || 'Peer';

  if (isConnected) {
    document.getElementById('hudCallState').textContent = '🟢 Connected (P2P)';
    document.getElementById('stageHeadline').textContent = `Connected with ${peerTxt}`;
    document.getElementById('stageSubline').textContent =
      activeCallMeta?.mediaKind === RTC_MEDIA_KIND.VOICE
        ? '🎙️ Encrypted P2P DTLS-SRTP Voice Call Live'
        : '📹 Direct P2P DTLS-SRTP Video & Audio Live';
    maybeRevealRemoteVideo();
    return;
  }

  if (isFailed) {
    document.getElementById('hudCallState').textContent = '🔴 NAT / Firewall Blocked';
    document.getElementById('stageCenterOverlay')?.classList.remove('hidden');
    document.getElementById('stageHeadline').textContent = '⚠️ Direct P2P Path Blocked by NAT';
    document.getElementById('stageSubline').textContent =
      'Connect both devices to Wi-Fi, or add a TURN relay under "🌐 Optional Custom TURN / NAT Relay" on the left.';
    setStatus(
      '⚠️ Direct P2P UDP path blocked by symmetric NAT/firewall (e.g. 5G CGNAT). Connect on Wi-Fi or configure a TURN relay on the left.',
      true
    );
    return;
  }

  if (answerApplied && activeCallId) {
    document.getElementById('hudCallState').textContent = `🟡 Handshaking ICE (#${activeCallId})…`;
    document.getElementById('stageHeadline').textContent = `Connecting P2P Media with ${peerTxt}…`;
    document.getElementById('stageSubline').textContent =
      'DTLS-SRTP verified on Subnet 1 — negotiating direct UDP/STUN media path…';
  } else if (activeCallId && !answerApplied) {
    document.getElementById('hudCallState').textContent = `🔔 Ringing #${activeCallId}`;
  } else if (conn || ice) {
    document.getElementById('hudCallState').textContent = `🟡 ${conn || ice}`;
  }
}

function handlePeerConnectionState(stateObj) {
  syncLiveConnectionBadges(stateObj);
}

function startStatsLoop() {
  stopStatsLoop();
  callConnectedAt = Date.now();
  const timerEl = document.getElementById('hudCallTimer');
  if (timerEl) timerEl.style.display = 'inline-flex';

  statsInterval = setInterval(async () => {
    const activeSess = peerSession || loopbackHandle?.callerSession;
    if (!activeSess) return;

    const elapsedSec = callConnectedAt > 0 ? Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000)) : 0;
    if (callConnectedAt > 0 && timerEl) {
      const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const ss = String(elapsedSec % 60).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
    }

    const st = await activeSess.pollStats();
    const kbUp = (st.bytesSent / 1024).toFixed(1);
    const kbDown = (st.bytesReceived / 1024).toFixed(1);
    const rttTxt = st.rttMs !== null ? `${st.rttMs} ms RTT` : st.iceConnectionState || 'ICE probing';
    document.getElementById('hudRtcStats').textContent =
      `⚡ ${rttTxt} • ${st.localCandidateType}/${st.protocol} • ↑ ${kbUp} KB ↓ ${kbDown} KB`;

    maybeRevealRemoteVideo();
    if (!loopbackHandle) {
      syncLiveConnectionBadges({
        connectionState: st.connectionState,
        iceConnectionState: st.iceConnectionState,
      });
      if (
        answerApplied &&
        elapsedSec >= 12 &&
        st.connectionState !== 'connected' &&
        st.iceConnectionState !== 'connected' &&
        st.iceConnectionState !== 'completed' &&
        st.bytesReceived === 0
      ) {
        document.getElementById('stageSubline').textContent =
          'Still probing UDP… If one device is on 4G/5G cellular (CGNAT), switch to Wi-Fi or add a TURN relay on the left.';
      }
    }

    const dc = activeSess.dataChannel;
    const dcBadge = document.getElementById('dcStateBadge');
    if (dcBadge) {
      const open = dc?.readyState === 'open';
      dcBadge.textContent = open ? '🟢 P2P Open (0ms)' : st.connectionState;
      dcBadge.className = `ec-pill-mini${open ? ' online' : ''}`;
    }
  }, 1000);
}

function stopStatsLoop() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  const timerEl = document.getElementById('hudCallTimer');
  if (timerEl) timerEl.style.display = 'none';
}

function cleanupDirectCallUi(headline = 'Serverless WebRTC Ready', subline = '') {
  stopStatsLoop();
  ringtone.stop();
  if (peerSession) {
    peerSession.close();
    peerSession = null;
  }
  if (loopbackHandle) {
    loopbackHandle.cleanup();
    loopbackHandle = null;
  }
  if (localStream && !previewOnly) {
    stopCallMediaStream(localStream);
    localStream = null;
  }
  activeCallId = 0;
  activeCallMeta = null;
  activePeerDisplayName = '';
  appliedCallerIceBatches = 0;
  appliedCalleeIceBatches = 0;
  answerApplied = false;
  micMuted = false;
  camMuted = false;

  const rv = document.getElementById('remoteVideo');
  if (rv) {
    rv.onresize = null;
    rv.onloadeddata = null;
    rv._slxAutoplayMuted = false;
    rv.srcObject = null;
    rv._slxTrackSig = '';
  }
  const unmuteBtn = document.getElementById('btnUnmuteRemote');
  if (unmuteBtn) unmuteBtn.style.display = 'none';

  if (!previewOnly) {
    const lv = document.getElementById('localVideo');
    if (lv) {
      lv.srcObject = null;
      lv._slxTrackSig = '';
    }
    document.getElementById('localPipTag').textContent = 'You (Preview Off)';
  }

  document.getElementById('stageCenterOverlay').classList.remove('hidden');
  document.getElementById('stageHeadline').textContent = headline;
  document.getElementById('stageSubline').textContent =
    subline || 'Dial any Subnet 1 Identity on the left — or click 🧪 Loopback Test for solo P2P verification.';
  document.getElementById('hudCallState').textContent = '⚪ Idle';
  document.getElementById('hudDtlsBadge').style.display = 'none';
  document.getElementById('hudRtcStats').textContent = 'P2P Media: Standby • 0 Cloud Relays';
  document.getElementById('btnHangup').disabled = true;
  document.getElementById('dcStateBadge').textContent = 'Standby';
  document.getElementById('dcStateBadge').className = 'ec-pill-mini';
  document.getElementById('btnToggleMic').textContent = '🎙️ Mic On';
  document.getElementById('btnToggleMic').classList.remove('muted');
  document.getElementById('btnToggleCam').textContent = '📹 Cam On';
  document.getElementById('btnToggleCam').classList.remove('muted');
}

// ============================================================================
// 1. Publish Presence & Non-Destructive Directory Rendering
// ============================================================================

function renderMyKeyPreview() {
  const myId = getMyIdentityOrEoa();
  if (!wallet.keypair?.privateKey) return;
  const sigKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
  const el = document.getElementById('mySignalKeyPreview');
  if (el) {
    el.textContent = `E2EE Key: ${shortHex(sigKeys.compressedPubKey, 10, 8)}`;
  }

  const myProf = directoryProfiles.find((p) => p.identity === myId);
  const badge = document.getElementById('myPresenceBadge');
  if (badge) {
    if (myProf) {
      const keyMatch =
        !myProf.compressedPub33 ||
        myProf.compressedPub33.toLowerCase() === sigKeys.compressedPubKey.toLowerCase();
      if (!keyMatch) {
        badge.textContent = '⚠️ Republish Key';
        badge.className = 'ec-pill-mini';
        badge.title = 'This browser wallet differs from the E2EE key published on-chain — click Publish Presence to sync.';
      } else {
        badge.textContent = myProf.availabilityLabel;
        badge.className = `ec-pill-mini${myProf.availability === 1 ? ' online' : ''}`;
        badge.title = '';
      }
      const inp = document.getElementById('inpDisplayLabel');
      if (inp && !inp.value && myProf.displayLabel) inp.value = myProf.displayLabel;
    } else {
      badge.textContent = 'Unpublished';
      badge.className = 'ec-pill-mini';
      badge.title = '';
    }
  }
}

async function publishPresenceTx() {
  const btn = document.getElementById('btnPublishPresence');
  try {
    if (btn) btn.disabled = true;
    setStatus('Confirming Identity & publishing secp256k1 WebRTC signaling key…');
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const labelInput = document.getElementById('inpDisplayLabel')?.value.trim();
    const displayLabel = labelInput || idRec?.nickname || shortAddr(myId);
    const availability = Number(document.getElementById('selAvailability')?.value ?? RTC_AVAILABILITY.ONLINE);

    await rtcClient.registerProfile({
      wallet,
      identityAddr: myId,
      availability,
      displayLabel,
      stunHint: 'LAN + Public STUN',
    });
    setStatus(`✅ Published E2EE WebRTC profile (${displayLabel}) on ${shortAddr(hubAddr)}!`);
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function renderDirectoryAndRecents() {
  const myId = getMyIdentityOrEoa();
  const dirEl = document.getElementById('peerDirectoryList');
  if (dirEl) {
    const others = directoryProfiles.filter((p) => p.identity !== myId);
    const listToShow = others.length > 0 ? others : directoryProfiles;
    const dirSig =
      myId +
      '::' +
      listToShow.map((p) => `${p.identity}:${p.availability}:${p.displayLabel}:${p.hasE2eeKey}`).join('|');

    if (dirEl.dataset.renderSig !== dirSig) {
      dirEl.dataset.renderSig = dirSig;
      if (directoryProfiles.length === 0) {
        dirEl.innerHTML = `<div class="ec-empty">No peers published yet — click “Publish E2EE Presence” above!</div>`;
      } else {
        dirEl.innerHTML = listToShow
          .map((p) => {
            const isMe = p.identity === myId;
            const name = p.displayLabel || shortAddr(p.identity);
            return `
              <div class="ec-peer-row">
                <div class="ec-peer-info">
                  <div class="ec-peer-name">
                    <span class="ec-dot ec-dot-${p.availability}"></span>
                    <span>${esc(name)}${isMe ? ' (You)' : ''}</span>
                  </div>
                  <div class="ec-peer-sub mono">
                    ${esc(shortAddr(p.identity))} • ${p.hasE2eeKey ? '🔒 E2EE' : 'Plain'}
                  </div>
                </div>
                <div class="ec-peer-btns">
                  ${
                    isMe
                      ? `<span class="ec-pill-mini online">Published</span>`
                      : `<button type="button" class="ec-btn ec-btn-cyan ec-btn-xs" data-dial-voice="${esc(p.identity)}" title="Voice Call">🎙️</button>
                         <button type="button" class="ec-btn ec-btn-emerald ec-btn-xs" data-dial-video="${esc(p.identity)}" title="HD Video Call">📹</button>`
                  }
                </div>
              </div>
            `;
          })
          .join('');
      }
    }
  }

  const recEl = document.getElementById('recentCallsList');
  if (recEl) {
    const slice = recentCalls.slice(0, 8);
    const recSig =
      myId + '::' + slice.map((c) => `${c.callId}:${c.status}:${c.mediaKind}:${c.updatedBlock}`).join('|');
    if (recEl.dataset.renderSig !== recSig) {
      recEl.dataset.renderSig = recSig;
      if (!slice.length) {
        recEl.innerHTML = `<div class="ec-empty">No recent calls for this Identity.</div>`;
      } else {
        const rows = await Promise.all(
          slice.map(async (c) => {
            const outbound = c.caller === myId;
            const peerAddr = outbound ? c.callee : c.caller;
            const peerName = await resolveDisplayName(peerAddr);
            return `
              <div class="ec-peer-row">
                <div class="ec-peer-info">
                  <div class="ec-peer-name">
                    <span>${outbound ? '↗' : '↙'} #${c.callId} ${esc(peerName)}</span>
                  </div>
                  <div class="ec-peer-sub mono">${esc(c.mediaLabel)} • ${esc(c.statusLabel)}</div>
                </div>
                <button type="button" class="ec-btn ec-btn-xs" data-redial="${esc(peerAddr)}" data-kind="${c.mediaKind}">Redial</button>
              </div>
            `;
          })
        );
        recEl.innerHTML = rows.join('');
      }
    }
  }
}

// ============================================================================
// 2. 1:1 Outgoing & Incoming WebRTC Call Flows
// ============================================================================

async function sendTrickleBatchOnChain(callId, myId, candidates, recipientPub64) {
  if (!callId || !candidates.length) return;
  try {
    const sealed = await sealRtcSignalEnvelope(
      { v: 1, type: 'ice', candidates, ts: Date.now() },
      { recipientPub64 }
    );
    await rtcClient.appendIceBatch({
      wallet,
      callId,
      actorIdentity: myId,
      iceEnvelopeBytes: sealed.bytes,
    });
  } catch {
    // non-fatal if call already closed or batch cap reached
  }
}

async function placeCallTx(rawPeerAddr, mediaKind = RTC_MEDIA_KIND.VIDEO) {
  if (callSetupBusy) return;
  const callee = String(rawPeerAddr || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(callee)) {
    setStatus('Enter a valid 20-byte 0x… peer Identity address to dial.', true);
    return;
  }

  callSetupBusy = true;
  try {
    setStageTab('direct');
    cleanupDirectCallUi('Preparing Encrypted Call…', '1/3 Verifying Identity & requesting Camera/Microphone…');
    document.getElementById('hudCallState').textContent = '🟡 Dialing…';
    setStatus('1/3 Verifying Identity & requesting Camera/Microphone…');

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    if (myId === callee) {
      const selfMsg = 'Cannot dial your own Identity — click 🧪 Loopback Test or open a second browser/device!';
      cleanupDirectCallUi('Cannot Dial Own Identity', selfMsg);
      setStatus(selfMsg, true);
      return;
    }

    const stream = await ensureLocalStream(mediaKind, { allowSyntheticFallback: true });
    const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
    const peerProfile = await rtcClient.getPeerProfile(callee);
    const peerPub64 = peerProfile?.pub64 || null;

    peerSession = new SlxWebRtcPeerSession({
      iceServers: getActiveIceServers(),
      localStream: stream,
      isInitiator: true,
      onRemoteStream: (remStream) => bindRemoteVideoStream(remStream),
      onTrickleCandidates: (batch) => {
        if (activeCallId) sendTrickleBatchOnChain(activeCallId, myId, batch, peerPub64);
      },
      onConnectionState: handlePeerConnectionState,
      onDataMessage: (msg) => {
        appendChatBubble({ sender: msg.sender || shortAddr(callee), text: msg.text, mine: false, ts: msg.ts });
      },
    });

    document.getElementById('stageSubline').textContent =
      '2/3 Gathering host + STUN ICE candidates & sealing secp256k1 ECDH + Gzip SDP Offer…';
    setStatus('2/3 Gathering host + STUN ICE candidates & sealing E2EE SDP Offer…');
    const offerBundle = await peerSession.createBundledOffer({ iceWaitMs: 2200 });
    const sealedOffer = await sealRtcSignalEnvelope(
      {
        v: 1,
        type: 'offer',
        sdp: offerBundle.sdp,
        candidates: offerBundle.candidates,
        senderPub33: myKeys.compressedPubKey,
        senderLabel: idRec?.nickname || shortAddr(myId),
        ts: Date.now(),
      },
      { recipientPub64: peerPub64 }
    );

    document.getElementById('stageSubline').textContent =
      `3/3 Submitting On-Chain Ring (${sealedOffer.wireBytes} B E2EE Offer, ${offerBundle.candidates.length} ICE) to Subnet 1…`;
    setStatus(`3/3 Ringing ${shortAddr(callee)} on Subnet 1 (${sealedOffer.wireBytes} B Offer, ${offerBundle.candidates.length} ICE)…`);
    const { callId } = await rtcClient.placeCall({
      wallet,
      callerIdentity: myId,
      calleeIdentity: callee,
      mediaKind,
      callerDtlsFp: offerBundle.dtlsFp,
      offerEnvelopeBytes: sealedOffer.bytes,
    });

    activeCallId = callId;
    answerApplied = false;
    appliedCalleeIceBatches = 0;
    // Now unlock trickle dispatch so any late candidates gathered during block confirmation flush cleanly!
    peerSession.enableTrickleDispatch();

    const peerName = await resolveDisplayName(callee);
    activePeerDisplayName = peerName;
    document.getElementById('hudCallState').textContent = `🔔 Ringing #${callId}`;
    document.getElementById('stageHeadline').textContent = `Calling ${peerName}…`;
    document.getElementById('stageSubline').textContent =
      `Waiting for ${peerName} (${shortAddr(callee)}) to click "✅ Accept" • DTLS-SRTP Pinned.`;
    document.getElementById('btnHangup').disabled = false;

    updateInspector({
      envelopeLabel: `${sealedOffer.rawJsonBytes} B → ${sealedOffer.wireBytes} B (${offerBundle.candidates.length} ICE)`,
      cipherLabel: sealedOffer.encrypted ? 'secp256k1 ECDH + Gzip' : 'Gzip + DTLS Pinned',
      callerFp: offerBundle.dtlsFp,
      calleeFp: ZERO_BYTES32,
      mitmStatus: 'Awaiting Callee DTLS-256…',
    });

    setStatus(`🔔 Call #${callId} ringing ${peerName} — waiting for Answer on Subnet 1…`);
    startStatsLoop();
    await syncState();
  } catch (err) {
    const errMsg = err?.message || String(err);
    cleanupDirectCallUi('⚠️ Call Setup Failed', errMsg);
    setStatus(errMsg, true);
  } finally {
    callSetupBusy = false;
  }
}

async function acceptIncomingCallTx(acceptMediaKind) {
  if (!ringingCallMeta || callSetupBusy) return;
  callSetupBusy = true;
  const callId = ringingCallMeta.callId;
  ringtone.stop();
  document.getElementById('incomingCallBanner').style.display = 'none';

  try {
    setStageTab('direct');
    cleanupDirectCallUi('Answering Incoming Call…', `1/3 Opening Call #${callId} Offer & verifying Caller DTLS-SRTP…`);
    document.getElementById('hudCallState').textContent = '🟡 Answering…';
    setStatus(`1/3 Opening Call #${callId} Offer & verifying Caller DTLS-SRTP fingerprint…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);

    const session = await rtcClient.getCallSession(callId);
    if (!session || session.status !== RTC_CALL_STATUS.RINGING) {
      cleanupDirectCallUi('Call No Longer Ringing', `Call #${callId} was canceled or already answered.`);
      setStatus(`Call #${callId} is no longer ringing.`, true);
      ringingCallMeta = null;
      return;
    }

    const openedOffer = await openRtcSignalEnvelope(session.offerEnvelope, {
      signalPrivHex: myKeys.signalPrivHex,
    });
    if (!openedOffer?.payload?.sdp) {
      throw new Error(
        'Could not decrypt Offer envelope — click "📡 Publish E2EE Presence" on this device so your active browser wallet matches your on-chain E2EE key.'
      );
    }

    const callerPub64 = openedOffer.payload.senderPub33
      ? decompressSecp256k1Compressed33(openedOffer.payload.senderPub33)
      : (await rtcClient.getPeerProfile(session.caller))?.pub64 || null;

    document.getElementById('stageSubline').textContent =
      `2/3 Acquiring Camera/Mic & gathering ICE candidates for Call #${callId}…`;
    setStatus(`2/3 Acquiring Camera/Mic & gathering ICE candidates for Call #${callId}…`);
    const stream = await ensureLocalStream(acceptMediaKind, { allowSyntheticFallback: true });
    peerSession = new SlxWebRtcPeerSession({
      iceServers: getActiveIceServers(),
      localStream: stream,
      isInitiator: false,
      onRemoteStream: (remStream) => bindRemoteVideoStream(remStream),
      onTrickleCandidates: (batch) => {
        if (activeCallId) sendTrickleBatchOnChain(activeCallId, myId, batch, callerPub64);
      },
      onConnectionState: handlePeerConnectionState,
      onDataMessage: (msg) => {
        appendChatBubble({
          sender: msg.sender || shortAddr(session.caller),
          text: msg.text,
          mine: false,
          ts: msg.ts,
        });
      },
    });

    const answerBundle = await peerSession.acceptOfferAndCreateBundledAnswer(
      openedOffer.payload,
      session.callerDtlsFp,
      { iceWaitMs: 2200 }
    );

    // Apply any already-trickled caller ICE batches
    for (let i = 0; i < session.callerIceBatches.length; i++) {
      const iceEnv = await openRtcSignalEnvelope(session.callerIceBatches[i], {
        signalPrivHex: myKeys.signalPrivHex,
      });
      if (iceEnv?.payload?.candidates) {
        await peerSession.applyRemoteCandidates(iceEnv.payload.candidates);
      }
    }
    appliedCallerIceBatches = session.callerIceBatches.length;

    const sealedAnswer = await sealRtcSignalEnvelope(
      {
        v: 1,
        type: 'answer',
        sdp: answerBundle.sdp,
        candidates: answerBundle.candidates,
        senderPub33: myKeys.compressedPubKey,
        ts: Date.now(),
      },
      { recipientPub64: callerPub64 }
    );

    document.getElementById('stageSubline').textContent =
      `3/3 Submitting encrypted SDP Answer (${sealedAnswer.wireBytes} B, ${answerBundle.candidates.length} ICE) to Subnet 1…`;
    setStatus(`3/3 Submitting encrypted SDP Answer (${sealedAnswer.wireBytes} B, ${answerBundle.candidates.length} ICE)…`);
    await rtcClient.answerCall({
      wallet,
      callId,
      calleeIdentity: myId,
      calleeDtlsFp: answerBundle.dtlsFp,
      answerEnvelopeBytes: sealedAnswer.bytes,
    });

    activeCallId = callId;
    activeCallMeta = session;
    activePeerDisplayName = await resolveDisplayName(session.caller);
    answerApplied = true;
    ringingCallMeta = null;
    peerSession.enableTrickleDispatch();

    document.getElementById('hudDtlsBadge').style.display = 'inline-flex';
    document.getElementById('btnHangup').disabled = false;
    syncLiveConnectionBadges();

    updateInspector({
      envelopeLabel: `${sealedAnswer.rawJsonBytes} B → ${sealedAnswer.wireBytes} B (${answerBundle.candidates.length} ICE)`,
      cipherLabel: sealedAnswer.encrypted ? 'secp256k1 ECDH + Gzip' : 'Gzip + DTLS Pinned',
      callerFp: session.callerDtlsFp,
      calleeFp: answerBundle.dtlsFp,
      mitmStatus: '✅ Verified (Zero-CA Match)',
      mitmOk: true,
    });

    setStatus(`🟢 Answered Call #${callId} — establishing P2P DTLS-SRTP stream!`);
    startStatsLoop();
  } catch (err) {
    const errMsg = err?.message || String(err);
    cleanupDirectCallUi('⚠️ Could Not Answer Call', errMsg);
    setStatus(errMsg, true);
  } finally {
    callSetupBusy = false;
  }
}

async function declineIncomingCallTx() {
  if (!ringingCallMeta) return;
  const callId = ringingCallMeta.callId;
  dismissedCallIds.add(callId);
  ringtone.stop();
  document.getElementById('incomingCallBanner').style.display = 'none';
  try {
    const myId = getMyIdentityOrEoa();
    await rtcClient.endCall({ wallet, callId, actorIdentity: myId, reasonCode: 2 });
    ringingCallMeta = null;
    setStatus(`Declined incoming Call #${callId}.`);
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function hangupActiveCallTx() {
  if (loopbackHandle) {
    cleanupDirectCallUi('Loopback Session Ended', 'Click 🧪 Loopback Test anytime or dial a live Subnet 1 peer.');
    setStatus('Closed local P2P loopback verification session.');
    return;
  }
  const cid = activeCallId;
  cleanupDirectCallUi('Call Ended');
  if (!cid) return;
  try {
    const myId = getMyIdentityOrEoa();
    await rtcClient.endCall({ wallet, callId: cid, actorIdentity: myId, reasonCode: 1 });
    setStatus(`📴 Ended Call #${cid} on Subnet 1.`);
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function reconcileActiveDirectCall() {
  if (!activeCallId || !peerSession) return;
  const myId = getMyIdentityOrEoa();
  const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
  const sess = await rtcClient.getCallSession(activeCallId);
  if (!sess) return;
  activeCallMeta = sess;

  if (
    sess.status === RTC_CALL_STATUS.DECLINED ||
    sess.status === RTC_CALL_STATUS.CANCELED ||
    sess.status === RTC_CALL_STATUS.ENDED
  ) {
    cleanupDirectCallUi(`Call #${sess.callId} ${sess.statusLabel}`);
    setStatus(`Call #${sess.callId} ended (${sess.statusLabel}).`);
    return;
  }

  const amCaller = sess.caller === myId;
  if (amCaller && sess.status === RTC_CALL_STATUS.ACTIVE && !answerApplied && sess.answerEnvelope.length > 0) {
    const openedAns = await openRtcSignalEnvelope(sess.answerEnvelope, {
      signalPrivHex: myKeys.signalPrivHex,
    });
    if (openedAns?.payload?.sdp) {
      await peerSession.applyBundledAnswer(openedAns.payload, sess.calleeDtlsFp);
      answerApplied = true;
      const calleeName = await resolveDisplayName(sess.callee);
      activePeerDisplayName = calleeName;
      callConnectedAt = Date.now();
      document.getElementById('hudDtlsBadge').style.display = 'inline-flex';
      syncLiveConnectionBadges();
      updateInspector({
        callerFp: sess.callerDtlsFp,
        calleeFp: sess.calleeDtlsFp,
        mitmStatus: '✅ Verified (Zero-CA Match)',
        mitmOk: true,
      });
      setStatus(`🟢 ${calleeName} answered Call #${sess.callId} — completing P2P DTLS-SRTP handshake!`);
    }
  }

  // Apply new remote trickle ICE batches
  if (amCaller && sess.calleeIceBatches.length > appliedCalleeIceBatches) {
    for (let i = appliedCalleeIceBatches; i < sess.calleeIceBatches.length; i++) {
      const env = await openRtcSignalEnvelope(sess.calleeIceBatches[i], {
        signalPrivHex: myKeys.signalPrivHex,
      });
      if (env?.payload?.candidates) await peerSession.applyRemoteCandidates(env.payload.candidates);
    }
    appliedCalleeIceBatches = sess.calleeIceBatches.length;
  } else if (!amCaller && sess.callerIceBatches.length > appliedCallerIceBatches) {
    for (let i = appliedCallerIceBatches; i < sess.callerIceBatches.length; i++) {
      const env = await openRtcSignalEnvelope(sess.callerIceBatches[i], {
        signalPrivHex: myKeys.signalPrivHex,
      });
      if (env?.payload?.candidates) await peerSession.applyRemoteCandidates(env.payload.candidates);
    }
    appliedCallerIceBatches = sess.callerIceBatches.length;
  }
}

async function detectIncomingRingingCalls() {
  if (activeCallId || loopbackHandle || callSetupBusy) return;
  const myId = getMyIdentityOrEoa();
  if (!myId) return;

  const curBlk = Number(hubOverview?.currentBlock || 0);
  const incoming = recentCalls.find(
    (c) =>
      c.callee === myId &&
      c.status === RTC_CALL_STATUS.RINGING &&
      !dismissedCallIds.has(c.callId) &&
      (!curBlk || !c.createdBlock || curBlk - c.createdBlock <= 90)
  );

  const banner = document.getElementById('incomingCallBanner');
  if (!incoming) {
    if (ringingCallMeta) {
      ringingCallMeta = null;
      ringtone.stop();
      if (banner) banner.style.display = 'none';
      cleanupDirectCallUi();
    }
    return;
  }

  ringingCallMeta = incoming;
  const callerName = await resolveDisplayName(incoming.caller);
  document.getElementById('incomingCallerTitle').textContent =
    `Incoming ${incoming.mediaLabel} from ${callerName} (#${incoming.callId})`;
  document.getElementById('incomingCallerMeta').textContent =
    `Caller Identity: ${shortAddr(incoming.caller)} • On-Chain DTLS-256: ${shortHex(incoming.callerDtlsFp, 8, 6)}`;
  document.getElementById('hudCallState').textContent = `🔔 Incoming #${incoming.callId}`;
  document.getElementById('stageHeadline').textContent = `🔔 Incoming ${incoming.mediaLabel} from ${callerName}`;
  document.getElementById('stageSubline').textContent =
    `Click "✅ Accept Video" or "🎙️ Voice Only" in the glowing green banner above!`;
  if (banner) banner.style.display = 'flex';
  ringtone.start();
}

// ============================================================================
// 3. 1-Click Local P2P Loopback Self-Test
// ============================================================================

async function runLoopbackSelfTest() {
  if (callSetupBusy) return;
  callSetupBusy = true;
  try {
    setStageTab('direct');
    cleanupDirectCallUi('Starting Loopback Verification…');
    // Loopback self-test allows synthetic fallback if running without hardware cam/HTTPS
    const stream = await ensureLocalStream(RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback: true });
    const myId = getMyIdentityOrEoa();

    loopbackHandle = await createLocalLoopbackPair({
      localStream: stream,
      callerWalletPrivHex: wallet.keypair.privateKey,
      callerIdentity: myId || '0x00000000000000000000000000000000000a11ce',
      onRemoteStream: (remStream) => bindRemoteVideoStream(remStream),
      onDataMessage: (msg) => {
        appendChatBubble({ sender: msg.sender || 'Loopback Peer', text: msg.text, mine: false, ts: msg.ts });
      },
      onStep: (txt) => setStatus(txt),
    });

    const t = loopbackHandle.telemetry;
    document.getElementById('hudCallState').textContent = '🧪 Loopback P2P Live';
    document.getElementById('hudDtlsBadge').style.display = 'inline-flex';
    document.getElementById('btnHangup').disabled = false;

    updateInspector({
      envelopeLabel: `${t.offerRawBytes} B → ${t.offerWireBytes} B (-${Math.round((1 - t.offerWireBytes / t.offerRawBytes) * 100)}%)`,
      cipherLabel: 'secp256k1 ECDH + Gzip (Verified)',
      callerFp: t.callerDtlsFp,
      calleeFp: t.calleeDtlsFp,
      mitmStatus: '✅ Dual DTLS-SRTP Verified',
      mitmOk: true,
    });

    startStatsLoop();
  } catch (err) {
    cleanupDirectCallUi();
    setStatus(err?.message || String(err), true);
  } finally {
    callSetupBusy = false;
  }
}

// ============================================================================
// 4. Multi-Peer Mesh Conference Rooms (Up to 6 Peers)
// ============================================================================

function renderRoomsList() {
  const box = document.getElementById('roomsList');
  if (!box) return;
  const sig = `${joinedRoomId}::` + roomsList.map((r) => `${r.roomId}:${r.peerCount}:${r.status}`).join('|');
  if (box.dataset.renderSig === sig) return;
  box.dataset.renderSig = sig;

  if (!roomsList.length) {
    box.innerHTML = `<div class="ec-empty">No conference rooms created yet.</div>`;
    return;
  }
  box.innerHTML = roomsList
    .map((rm) => {
      const isJoined = rm.roomId === joinedRoomId;
      return `
        <div class="ec-peer-row">
          <div class="ec-peer-info">
            <div class="ec-peer-name">#${rm.roomId} ${esc(rm.title)}</div>
            <div class="ec-peer-sub mono">${rm.peerCount}/6 peers • ${esc(rm.mediaLabel)}</div>
          </div>
          <button type="button" class="ec-btn ${isJoined ? 'ec-btn-emerald' : 'ec-btn-cyan'} ec-btn-xs" data-join-room="${rm.roomId}">
            ${isJoined ? 'Joined' : 'Join'}
          </button>
        </div>
      `;
    })
    .join('');
}

function cleanupAllMeshPeers() {
  for (const [, entry] of meshPeers) {
    entry.session?.close();
  }
  meshPeers.clear();
  const grid = document.getElementById('meshVideoGrid');
  if (grid) {
    grid.innerHTML = `<div class="ec-empty">When you join a room, pairwise P2P WebRTC streams with up to 6 participants appear here automatically.</div>`;
  }
}

function ensureMeshTile(peerId, labelText, streamObj, isSelf = false) {
  const grid = document.getElementById('meshVideoGrid');
  if (!grid) return;
  const empty = grid.querySelector('.ec-empty');
  if (empty) empty.remove();

  const domId = `meshTile_${peerId.replace(/[^a-z0-9]/gi, '')}`;
  let tile = document.getElementById(domId);
  if (!tile) {
    tile = document.createElement('div');
    tile.id = domId;
    tile.className = 'ec-mesh-tile';
    tile.innerHTML = `<video autoplay playsinline ${isSelf ? 'muted' : ''}></video><span class="ec-mesh-label mono"></span>`;
    grid.appendChild(tile);
  }
  const vid = tile.querySelector('video');
  attachStreamToVideoElement(vid, streamObj, { muted: isSelf });
  tile.querySelector('.ec-mesh-label').textContent = labelText;
}

async function createRoomTx() {
  const title = document.getElementById('inpRoomTitle')?.value.trim();
  if (!title) {
    setStatus('Enter a conference room title first.', true);
    return;
  }
  try {
    setStatus(`Creating 6-peer mesh conference room "${title}"…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const mediaKind = Number(document.getElementById('selRoomMedia')?.value || RTC_MEDIA_KIND.VIDEO);
    const stream = await ensureLocalStream(mediaKind, { allowSyntheticFallback: true });

    const probe = new SlxWebRtcPeerSession({ iceServers: [], localStream: stream, isInitiator: true });
    const probeOffer = await probe.createBundledOffer({ iceWaitMs: 120 });
    probe.close();

    const { roomId } = await rtcClient.createRoom({
      wallet,
      hostIdentity: myId,
      title,
      mediaKind,
      e2eeRequired: true,
      hostDtlsFp: probeOffer.dtlsFp,
    });
    document.getElementById('inpRoomTitle').value = '';
    joinedRoomId = roomId;
    document.getElementById('btnLeaveRoom').style.display = 'inline-flex';
    ensureMeshTile(myId, `You (${shortAddr(myId)})`, stream, true);
    setStatus(`✅ Created & joined Mesh Room #${roomId} ("${title}")!`);
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function joinMeshRoomTx(roomId) {
  if (!roomId) return;
  try {
    cleanupAllMeshPeers();
    setStatus(`Joining Mesh Conference Room #${roomId}…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const rm = await rtcClient.getRoomState(roomId);
    if (!rm || !rm.isOpen) throw new Error('Room is closed or does not exist.');

    const stream = await ensureLocalStream(rm.mediaKind, { allowSyntheticFallback: true });
    const probe = new SlxWebRtcPeerSession({ iceServers: [], localStream: stream, isInitiator: true });
    const probeOffer = await probe.createBundledOffer({ iceWaitMs: 120 });
    probe.close();

    await rtcClient.joinRoom({
      wallet,
      roomId,
      peerIdentity: myId,
      dtlsFp: probeOffer.dtlsFp,
    });
    joinedRoomId = roomId;
    document.getElementById('btnLeaveRoom').style.display = 'inline-flex';
    ensureMeshTile(myId, `You (${shortAddr(myId)})`, stream, true);
    setStatus(`✅ Joined Mesh Room #${roomId} — negotiating pairwise P2P streams…`);
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function leaveMeshRoomTx() {
  const rid = joinedRoomId;
  joinedRoomId = 0;
  activeRoomState = null;
  cleanupAllMeshPeers();
  document.getElementById('btnLeaveRoom').style.display = 'none';
  document.getElementById('activeRoomHeader').textContent = 'Select or create a room to join up to 6 peers';
  if (!rid) return;
  try {
    const myId = getMyIdentityOrEoa();
    await rtcClient.leaveRoom({ wallet, roomId: rid, peerIdentity: myId });
    setStatus(`Left Mesh Room #${rid}.`);
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function reconcileActiveMeshRoom() {
  if (!joinedRoomId) return;
  const myId = getMyIdentityOrEoa();
  const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
  const rm = await rtcClient.getRoomState(joinedRoomId);
  if (!rm || !rm.isOpen) return;
  activeRoomState = rm;

  document.getElementById('activeRoomHeader').textContent =
    `🏛️ Room #${rm.roomId}: ${rm.title} (${rm.peerCount}/6 peers)`;

  const stream = await ensureLocalStream(rm.mediaKind, { allowSyntheticFallback: true });
  ensureMeshTile(myId, `You (${shortAddr(myId)})`, stream, true);

  for (const peer of rm.peers) {
    if (peer.identity === myId) continue;
    const peerId = peer.identity;
    let entry = meshPeers.get(peerId);
    const amInitiator = myId < peerId;
    const peerProf =
      directoryProfiles.find((p) => p.identity === peerId) ||
      (await rtcClient.getPeerProfile(peerId).catch(() => null));
    const peerPub64 = peerProf?.pub64 || null;

    if (!entry) {
      const peerLabel = await resolveDisplayName(peerId);
      const sess = new SlxWebRtcPeerSession({
        iceServers: getActiveIceServers(),
        localStream: stream,
        isInitiator: amInitiator,
        onRemoteStream: (remStream) => {
          ensureMeshTile(peerId, peerLabel, remStream, false);
        },
        onDataMessage: (msg) => {
          appendChatBubble({ sender: msg.sender || peerLabel, text: msg.text, mine: false, ts: msg.ts });
        },
      });
      entry = { session: sess, lastHandledSeq: 0, offerSent: false, answerApplied: false, peerDtlsFp: peer.dtlsFp };
      meshPeers.set(peerId, entry);
    }

    if (amInitiator && !entry.offerSent) {
      entry.offerSent = true;
      const offer = await entry.session.createBundledOffer({ iceWaitMs: 2000 });
      const env = await sealRtcSignalEnvelope(
        {
          v: 1,
          type: 'offer',
          sdp: offer.sdp,
          candidates: offer.candidates,
          senderPub33: myKeys.compressedPubKey,
          dtlsFp: offer.dtlsFp,
          ts: Date.now(),
        },
        { recipientPub64: peerPub64 }
      );
      await rtcClient.postRoomSignal({
        wallet,
        roomId: joinedRoomId,
        fromIdentity: myId,
        toIdentity: peerId,
        signalType: RTC_ROOM_SIGNAL_TYPE.OFFER_WITH_ICE,
        envelopeBytes: env.bytes,
      });
    }

    const inbound = await rtcClient.getPairSignal(joinedRoomId, peerId, myId);
    if (inbound && inbound.seq > entry.lastHandledSeq) {
      entry.lastHandledSeq = inbound.seq;
      const opened = await openRtcSignalEnvelope(inbound.envelope, {
        signalPrivHex: myKeys.signalPrivHex,
      });
      const pay = opened?.payload;
      if (pay?.type === 'offer' && !amInitiator) {
        const expectedFp = pay.dtlsFp || peer.dtlsFp;
        const ans = await entry.session.acceptOfferAndCreateBundledAnswer(pay, expectedFp, { iceWaitMs: 2000 });
        const replyPub64 = pay.senderPub33
          ? decompressSecp256k1Compressed33(pay.senderPub33)
          : peerPub64;
        const sealedAns = await sealRtcSignalEnvelope(
          {
            v: 1,
            type: 'answer',
            sdp: ans.sdp,
            candidates: ans.candidates,
            senderPub33: myKeys.compressedPubKey,
            dtlsFp: ans.dtlsFp,
            ts: Date.now(),
          },
          { recipientPub64: replyPub64 }
        );
        await rtcClient.postRoomSignal({
          wallet,
          roomId: joinedRoomId,
          fromIdentity: myId,
          toIdentity: peerId,
          signalType: RTC_ROOM_SIGNAL_TYPE.ANSWER_WITH_ICE,
          envelopeBytes: sealedAns.bytes,
        });
      } else if (pay?.type === 'answer' && amInitiator && !entry.answerApplied) {
        const expectedFp = pay.dtlsFp || peer.dtlsFp;
        await entry.session.applyBundledAnswer(pay, expectedFp);
        entry.answerApplied = true;
      }
    }
  }
}

// ============================================================================
// 5. Re-Queued Single-Flight Synchronization & Delegated Boot Wiring
// ============================================================================

async function syncState() {
  if (syncInFlight) {
    syncQueued = true;
    return;
  }
  syncInFlight = true;
  try {
    hubOverview = await rtcClient.getOverview();
    document.getElementById('statProfiles').textContent = String(hubOverview.totalProfiles);
    document.getElementById('statCalls').textContent = String(hubOverview.totalCalls);
    document.getElementById('statRooms').textContent = String(hubOverview.totalRooms);
    updateInspector();

    const dirRes = await rtcClient.getDirectory(0, 32);
    directoryProfiles = dirRes.profiles || [];
    renderMyKeyPreview();

    const myId = getMyIdentityOrEoa();
    if (myId) {
      recentCalls = await rtcClient.getRecentCalls(myId);
    }
    await renderDirectoryAndRecents();

    const rmSlice = await rtcClient.getRooms(0, 20);
    roomsList = rmSlice.rooms || [];
    renderRoomsList();

    await detectIncomingRingingCalls();
    await reconcileActiveDirectCall();
    await reconcileActiveMeshRoom();
  } catch (err) {
    console.warn('[EtherCall syncState]', err);
  } finally {
    syncInFlight = false;
    if (syncQueued) {
      syncQueued = false;
      syncState();
    }
  }
}

async function selectHub(nextAddr) {
  if (!nextAddr) return;
  hubAddr = nextAddr.toLowerCase();
  rtcClient.setHubAddress(hubAddr);
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  await syncState();
  stopWatcher = slxWatchChainApp({
    rpcUrlFn: () => rpcUrl,
    contractAddresses: () => [hubAddr].filter(Boolean),
    onNewBlock: () => syncState(),
    onContractLog: () => syncState(),
    pollIntervalMs: 3500,
  });
}

function setStageTab(tab) {
  activeStageTab = tab;
  document.getElementById('tabBtnDirect').classList.toggle('active', tab === 'direct');
  document.getElementById('tabBtnRooms').classList.toggle('active', tab === 'rooms');
  document.getElementById('stageDirectPane').style.display = tab === 'direct' ? 'flex' : 'none';
  document.getElementById('stageRoomsPane').style.display = tab === 'rooms' ? 'flex' : 'none';
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'telephony',
    title: 'EtherCall — WebRTC Voice & Video',
    subtitle:
      'Halt-Free Signaling (webrtc_signal.wasm) • Identity-Pinned DTLS-SRTP • secp256k1 ECDH Envelopes • $0 Gas',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => hubAddr || '',
    getContractLabel: () => 'Subnet 1 EtherCall Signaling Hub',
    onWalletSwitch: () => syncState(),
    extraElements: [document.getElementById('btnHeaderLoopback')],
  });

  checkSecureOriginBanner();

  const savedIce = localStorage.getItem(CUSTOM_ICE_STORAGE_KEY) || '';
  const iceInp = document.getElementById('inpCustomIceServers');
  if (iceInp) {
    iceInp.value = savedIce;
    iceInp.addEventListener('change', () => {
      localStorage.setItem(CUSTOM_ICE_STORAGE_KEY, iceInp.value.trim());
    });
  }

  document.getElementById('btnEnableSimFromBanner')?.addEventListener('click', () => {
    const chk = document.getElementById('chkForceSynthetic');
    if (chk) chk.checked = true;
    document.getElementById('insecureOriginBanner').style.display = 'none';
    setStatus('🧪 Enabled Simulated Radar Camera & Tone — ready to place calls!');
  });

  document.getElementById('btnUnmuteRemote')?.addEventListener('click', () => {
    const rv = document.getElementById('remoteVideo');
    if (rv) {
      rv._slxAutoplayMuted = false;
      rv.muted = false;
      rv.play().catch(() => {});
    }
    document.getElementById('btnUnmuteRemote').style.display = 'none';
  });

  // Delegated click listeners (immune to background sync updates!)
  document.getElementById('peerDirectoryList').addEventListener('click', (ev) => {
    const voiceBtn = ev.target.closest('[data-dial-voice]');
    if (voiceBtn) {
      placeCallTx(voiceBtn.getAttribute('data-dial-voice'), RTC_MEDIA_KIND.VOICE);
      return;
    }
    const videoBtn = ev.target.closest('[data-dial-video]');
    if (videoBtn) {
      placeCallTx(videoBtn.getAttribute('data-dial-video'), RTC_MEDIA_KIND.VIDEO);
    }
  });

  document.getElementById('recentCallsList').addEventListener('click', (ev) => {
    const redialBtn = ev.target.closest('[data-redial]');
    if (redialBtn) {
      const target = redialBtn.getAttribute('data-redial');
      const kind = Number(redialBtn.getAttribute('data-kind')) || RTC_MEDIA_KIND.VIDEO;
      placeCallTx(target, kind);
    }
  });

  document.getElementById('roomsList').addEventListener('click', (ev) => {
    const joinBtn = ev.target.closest('[data-join-room]');
    if (joinBtn) {
      joinMeshRoomTx(Number(joinBtn.getAttribute('data-join-room')));
    }
  });

  document.getElementById('tabBtnDirect').addEventListener('click', () => setStageTab('direct'));
  document.getElementById('tabBtnRooms').addEventListener('click', () => setStageTab('rooms'));

  document.getElementById('btnPublishPresence').addEventListener('click', publishPresenceTx);
  document.getElementById('btnRefreshDir').addEventListener('click', syncState);
  document.getElementById('btnRefreshRooms').addEventListener('click', syncState);

  document.getElementById('btnDialVoice').addEventListener('click', () => {
    placeCallTx(document.getElementById('inpDialIdentity').value, RTC_MEDIA_KIND.VOICE);
  });
  document.getElementById('btnDialVideo').addEventListener('click', () => {
    placeCallTx(document.getElementById('inpDialIdentity').value, RTC_MEDIA_KIND.VIDEO);
  });

  document.getElementById('btnAcceptVideo').addEventListener('click', () =>
    acceptIncomingCallTx(RTC_MEDIA_KIND.VIDEO)
  );
  document.getElementById('btnAcceptVoice').addEventListener('click', () =>
    acceptIncomingCallTx(RTC_MEDIA_KIND.VOICE)
  );
  document.getElementById('btnDeclineCall').addEventListener('click', declineIncomingCallTx);

  document.getElementById('btnHeaderLoopback').addEventListener('click', runLoopbackSelfTest);
  document.getElementById('btnLoopbackStage').addEventListener('click', runLoopbackSelfTest);
  document.getElementById('btnHangup').addEventListener('click', hangupActiveCallTx);

  document.getElementById('btnPreviewCam').addEventListener('click', async () => {
    try {
      if (localStream && previewOnly) {
        stopCallMediaStream(localStream);
        localStream = null;
        previewOnly = false;
        document.getElementById('localVideo').srcObject = null;
        document.getElementById('localPipTag').textContent = 'You (Preview Off)';
        return;
      }
      await ensureLocalStream(RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback: false });
      previewOnly = !activeCallId && !loopbackHandle;
    } catch (err) {
      setStatus(err?.message || String(err), true);
    }
  });

  document.getElementById('btnToggleMic').addEventListener('click', () => {
    if (!localStream) return;
    micMuted = !micMuted;
    for (const tr of localStream.getAudioTracks()) tr.enabled = !micMuted;
    const btn = document.getElementById('btnToggleMic');
    btn.textContent = micMuted ? '🔇 Mic Muted' : '🎙️ Mic On';
    btn.classList.toggle('muted', micMuted);
  });

  document.getElementById('btnToggleCam').addEventListener('click', () => {
    if (!localStream) return;
    camMuted = !camMuted;
    for (const tr of localStream.getVideoTracks()) tr.enabled = !camMuted;
    const btn = document.getElementById('btnToggleCam');
    btn.textContent = camMuted ? '🚫 Cam Off' : '📹 Cam On';
    btn.classList.toggle('muted', camMuted);
  });

  document.getElementById('btnShareScreen').addEventListener('click', async () => {
    try {
      const res = await acquireCallMediaStream({ mediaKind: RTC_MEDIA_KIND.SCREEN });
      const screenTrack = res.stream.getVideoTracks()[0];
      if (!screenTrack) return;
      const activeSess = peerSession || loopbackHandle?.callerSession;
      if (activeSess) {
        await activeSess.replaceVideoTrack(screenTrack);
      }
      await attachStreamToVideoElement(document.getElementById('localVideo'), res.stream, { muted: true });
      document.getElementById('localPipTag').textContent = 'You (Screen)';
      setStatus('🖥️ Sharing screen over P2P DTLS-SRTP track!');
      screenTrack.onended = async () => {
        if (localStream && localStream.getVideoTracks()[0] && activeSess) {
          await activeSess.replaceVideoTrack(localStream.getVideoTracks()[0]);
          await attachStreamToVideoElement(document.getElementById('localVideo'), localStream, { muted: true });
          document.getElementById('localPipTag').textContent = 'You (Cam)';
        }
      };
    } catch (err) {
      setStatus(err?.message || 'Screen share canceled', true);
    }
  });

  document.getElementById('chatForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const inp = document.getElementById('inpChatMsg');
    const text = inp.value.trim();
    if (!text) return;
    const senderLabel = wallet.getIdentityRecord?.()?.nickname || shortAddr(getMyIdentityOrEoa());

    let sent = false;
    const activeSess = peerSession || loopbackHandle?.callerSession;
    if (activeSess && activeSess.sendChatMessage(text, senderLabel)) {
      sent = true;
    }
    for (const [, entry] of meshPeers) {
      if (entry.session?.sendChatMessage(text, senderLabel)) sent = true;
    }

    if (!sent) {
      setStatus('Start a call or click 🧪 Loopback Test first to open the 0ms P2P DataChannel!', true);
      return;
    }
    inp.value = '';
    appendChatBubble({ sender: `${senderLabel} (You)`, text, mine: true });
  });

  document.getElementById('btnCreateRoom').addEventListener('click', createRoomTx);
  document.getElementById('btnLeaveRoom').addEventListener('click', leaveMeshRoomTx);

  await populateMediaDevices();
  const resolved = await rtcClient.resolveHubAddress();
  await selectHub(resolved);
  unifiedHdr?.refresh?.();

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'WEBRTC_SIGNAL',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => hubAddr || '',
    onSelectInstance: async (inst) => {
      await selectHub(inst.primaryAddr);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
