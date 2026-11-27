/**
 * EtherCall v2 — Serverless WebRTC 1:1 Calls, Discord Persistent Channels & P2P Broadcast Stage
 * (`app-sources/telephony/app.js`)
 *
 * Pure use-case UI controller: all reusable WebRTC, secp256k1 ECDH + Gzip SDP/ICE envelope codecs,
 * DTLS-SRTP Identity verification, WebAudio voice-activity monitors, and `webrtc_signal.wasm` v2
 * ABI bindings live in `@superlexicon/sdk`.
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
  RTC_CHANNEL_KIND,
  RTC_CHANNEL_MEDIA_FLAGS,
  RTC_BROADCAST_ROLE,
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
  createAudioLevelMonitor,
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
let channelsList = [];
let broadcastsList = [];
let stopWatcher = null;
let reactivePollTimer = null;
let syncInFlight = false;
let syncQueued = false;
let callSetupBusy = false;
let autoPublishedOnce = false;

// Active Stage Tab: 'direct' | 'channels' | 'broadcast'
let activeStageTab = 'direct';

// ============================================================================
// State 1: 1:1 Direct Call / Loopback
// ============================================================================
let localStream = null;
let previewOnly = false;
let activeCallId = 0;
let activeCallMeta = null;
let activePeerDisplayName = '';
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

// ============================================================================
// State 2: Discord-Style Persistent Voice/Video Channels
// ============================================================================
let guildFilterAddr = '';
let guildFilterName = '';
let joinedChannelId = 0;
let activeChannelState = null;
let channelStream = null;
let chanMicMuted = false;
let chanDeafened = false;
let chanVideoOn = false;
let chanScreenOn = false;
let channelReconcileBusy = false;
const channelPeers = new Map(); // peerId -> { session, lastHandledSeq, offerSent, answerApplied, audioMonitor }
let myChannelAudioMonitor = null;
const speakingPeers = new Set(); // identityAddr

// ============================================================================
// State 3: Serverless K-ary P2P Fanout-Tree Live Broadcast & Stage
// ============================================================================
let activeBroadcastId = 0;
let activeBroadcastState = null;
let amBroadcastHost = false;
let hostBroadcastStream = null;
let viewerInboundStream = null;
let stageLocalStream = null;
let bcastMicMuted = false;
let handRaised = false;
let bcastReconcileBusy = false;
let upstreamParentId = '';
let upstreamSession = null;
let upstreamLastSeq = 0;
const downstreamChildren = new Map(); // childId -> { session, offerSent, lastAnswerSeq }
const stageMeshPeers = new Map(); // speakerId -> { session, lastHandledSeq, offerSent, answerApplied }
const seenBcastChatIds = new Set();

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

function resolveCachedLabelSync(addr) {
  const low = String(addr || '').toLowerCase();
  if (!low || low === ZERO_ADDR) return 'Unknown';
  const prof = directoryProfiles.find((p) => p.identity === low);
  if (prof?.displayLabel) return prof.displayLabel;
  if (nickCache.has(low)) return nickCache.get(low);
  return shortAddr(low);
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

async function lookupPeerPub64(identityAddr) {
  const low = String(identityAddr || '').toLowerCase();
  const cached = directoryProfiles.find((p) => p.identity === low);
  if (cached?.pub64) return cached.pub64;
  try {
    const prof = await rtcClient.getPeerProfile(low);
    return prof?.pub64 || null;
  } catch {
    return null;
  }
}

function appendChatBubble({ sender, text, mine = false, ts = Date.now() }) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const empty = box.querySelector('.ec-empty');
  if (empty) empty.remove();

  const timeStr = new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

/**
 * Synchronously blesses a `<video>` element during the user's click gesture (`📹`, `✅ Accept`,
 * `Join Channel`, `▶️ Watch`) so Safari / iOS WebKit allows unmuted remote audio+video playback.
 */
function preBlessVideoElement(domId = 'remoteVideo') {
  const v = document.getElementById(domId);
  if (!v) return;
  v._slxAutoplayMuted = false;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.muted = false;
  try {
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // ignore empty media probe
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

async function acquireConfiguredMedia(mediaKind = RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback = true } = {}) {
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
  if (res.fallbackReason) {
    setStatus(
      res.isSynthetic
        ? `⚠️ Hardware camera/mic busy or unavailable (${res.fallbackReason}) — using Simulated Stream.`
        : `ℹ️ ${res.fallbackReason}`
    );
  }
  await populateMediaDevices();
  return res;
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
  const res = await acquireConfiguredMedia(mediaKind, { allowSyntheticFallback });
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
  return localStream;
}

// ============================================================================
// 1. Presence Directory & Auto-Publish on v2 Hub
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
      } else {
        badge.textContent = myProf.availabilityLabel;
        badge.className = `ec-pill-mini${myProf.availability === 1 ? ' online' : ''}`;
      }
      const inp = document.getElementById('inpDisplayLabel');
      if (inp && !inp.value && myProf.displayLabel) inp.value = myProf.displayLabel;
    } else {
      badge.textContent = 'Unpublished';
      badge.className = 'ec-pill-mini';
    }
  }
}

async function ensureMyProfilePublishedSilently() {
  if (autoPublishedOnce) return;
  const idRec = wallet.getIdentityRecord?.();
  if (!idRec?.identityAddr || !wallet.keypair?.privateKey) return;
  const myId = idRec.identityAddr.toLowerCase();
  const sigKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
  const existing = directoryProfiles.find((p) => p.identity === myId);
  if (
    existing &&
    existing.compressedPub33 &&
    existing.compressedPub33.toLowerCase() === sigKeys.compressedPubKey.toLowerCase()
  ) {
    autoPublishedOnce = true;
    return;
  }
  autoPublishedOnce = true;
  try {
    await rtcClient.registerProfile({
      wallet,
      identityAddr: myId,
      availability: RTC_AVAILABILITY.ONLINE,
      displayLabel: idRec.nickname || shortAddr(myId),
      stunHint: 'LAN + Public STUN',
    });
  } catch {
    // non-fatal if Identity is still confirming
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
    autoPublishedOnce = true;
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
// 2. 1:1 Direct Calls & Loopback Verification
// ============================================================================

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
  const isConnected = conn === 'connected' || ice === 'connected' || ice === 'completed';
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

    const elapsedSec =
      callConnectedAt > 0 ? Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000)) : 0;
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
    rv._slxTrackSetKey = '';
    rv.srcObject = null;
    rv._slxTrackSig = '';
  }
  const unmuteBtn = document.getElementById('btnUnmuteRemote');
  if (unmuteBtn) unmuteBtn.style.display = 'none';

  if (!previewOnly) {
    const lv = document.getElementById('localVideo');
    if (lv) {
      lv._slxTrackSetKey = '';
      lv.srcObject = null;
      lv._slxTrackSig = '';
    }
    document.getElementById('localPipTag').textContent = 'You (Preview Off)';
  }

  document.getElementById('stageCenterOverlay').classList.remove('hidden');
  document.getElementById('stageHeadline').textContent = headline;
  document.getElementById('stageSubline').textContent =
    subline ||
    'Dial any Subnet 1 Identity on the left, drop into a 🎧 Discord Channel, or start a 📡 Live Broadcast!';
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
    // non-fatal
  }
}

async function placeCallTx(rawPeerAddr, mediaKind = RTC_MEDIA_KIND.VIDEO) {
  if (callSetupBusy) return;
  const callee = String(rawPeerAddr || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(callee)) {
    setStatus('Enter a valid 20-byte 0x… peer Identity address to dial.', true);
    return;
  }

  preBlessVideoElement('remoteVideo');
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
    const peerPub64 = await lookupPeerPub64(callee);

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
  preBlessVideoElement('remoteVideo');
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
      : await lookupPeerPub64(session.caller);

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
    if (!openedAns?.payload?.sdp) {
      setStatus('⚠️ Could not decrypt Callee Answer envelope.', true);
      return;
    }
    answerApplied = true;
    try {
      await peerSession.applyBundledAnswer(openedAns.payload, sess.calleeDtlsFp);
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
    } catch (ansErr) {
      answerApplied = false;
      setStatus(ansErr?.message || String(ansErr), true);
      throw ansErr;
    }
  }

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

async function runLoopbackSelfTest() {
  if (callSetupBusy) return;
  preBlessVideoElement('remoteVideo');
  callSetupBusy = true;
  try {
    setStageTab('direct');
    cleanupDirectCallUi('Starting Loopback Verification…');
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
    cleanupDirectCallUi('⚠️ Loopback Failed', err?.message || String(err));
    setStatus(err?.message || String(err), true);
  } finally {
    callSetupBusy = false;
  }
}

// ============================================================================
// 3. Discord-Style Persistent Voice, Video & Screen-Share Channels
// ============================================================================

function computeMyChannelMediaFlags() {
  let flags = 0;
  if (chanMicMuted) flags |= RTC_CHANNEL_MEDIA_FLAGS.MIC_MUTED;
  if (chanDeafened) flags |= RTC_CHANNEL_MEDIA_FLAGS.DEAFENED;
  if (chanVideoOn) flags |= RTC_CHANNEL_MEDIA_FLAGS.VIDEO_ON;
  if (chanScreenOn) flags |= RTC_CHANNEL_MEDIA_FLAGS.SCREEN_ON;
  return flags;
}

function updateSpeakingHighlight(identityAddr, isSpeaking) {
  const low = String(identityAddr || '').toLowerCase();
  if (isSpeaking) speakingPeers.add(low);
  else speakingPeers.delete(low);

  const cleanId = low.replace(/[^a-z0-9]/gi, '');
  const tile = document.getElementById(`meshTile_${cleanId}`);
  if (tile) tile.classList.toggle('speaking', isSpeaking);
  document.querySelectorAll(`[data-occ-avatar="${low}"]`).forEach((el) => {
    el.classList.toggle('speaking', isSpeaking);
  });
}

function syncDiscordControlButtons() {
  const inChan = joinedChannelId > 0;
  const bMute = document.getElementById('btnChanMute');
  const bDeaf = document.getElementById('btnChanDeafen');
  const bVid = document.getElementById('btnChanVideo');
  const bScr = document.getElementById('btnChanScreen');
  const bDisc = document.getElementById('btnChanDisconnect');
  const bar = document.getElementById('discordVoiceConnectedBar');

  for (const b of [bMute, bDeaf, bVid, bScr, bDisc]) {
    if (b) b.disabled = !inChan;
  }
  if (bar) {
    bar.style.display = inChan ? 'flex' : 'none';
    if (inChan && activeChannelState) {
      document.getElementById('discordConnChannelName').textContent = `#${activeChannelState.name}`;
    }
  }
  if (bMute) {
    bMute.textContent = chanMicMuted ? '🔇 Unmute Mic' : '🎙️ Mic On';
    bMute.classList.toggle('muted', chanMicMuted);
  }
  if (bDeaf) {
    bDeaf.textContent = chanDeafened ? '🔇 Undeafen' : '🎧 Audio On';
    bDeaf.classList.toggle('muted', chanDeafened);
  }
  if (bVid) {
    bVid.textContent = chanVideoOn ? '📹 Cam On' : '📷 Enable Cam';
    bVid.classList.toggle('muted', !chanVideoOn && inChan);
  }
  if (bScr) {
    bScr.textContent = chanScreenOn ? '🖥️ Sharing Screen' : '🖥️ Share Screen';
  }
}

function renderDiscordChannelsSidebar() {
  const box = document.getElementById('discordChannelsList');
  if (!box) return;

  const visibleChannels = guildFilterAddr
    ? channelsList.filter(
        (c) => c.guildAddr === guildFilterAddr || c.guildAddr === ZERO_ADDR
      )
    : channelsList;

  const totalOccupants = channelsList.reduce((acc, c) => acc + (c.peerCount || 0), 0);
  const cntEl = document.getElementById('tabChannelsCount');
  if (cntEl) cntEl.textContent = String(totalOccupants || channelsList.length);

  const sig =
    `${joinedChannelId}::${guildFilterAddr}::` +
    visibleChannels
      .map(
        (c) =>
          `${c.channelId}:${c.name}:${c.peerCount}:` +
          c.peers.map((p) => `${p.identity}:${p.mediaFlags}`).join(',')
      )
      .join('|');
  if (box.dataset.renderSig === sig) return;
  box.dataset.renderSig = sig;

  if (!visibleChannels.length) {
    box.innerHTML = `<div class="ec-empty">No channels created yet — create one above!</div>`;
    return;
  }

  box.innerHTML = visibleChannels
    .map((ch) => {
      const isJoined = ch.channelId === joinedChannelId;
      const icon = ch.channelKind === 1 ? '🔊' : ch.channelKind === 3 ? '🏛️' : '📹';
      const occRows = ch.peers
        .map((p) => {
          const pName = resolveCachedLabelSync(p.identity);
          const initials = pName.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'ID';
          const spk = speakingPeers.has(p.identity) ? ' speaking' : '';
          const flags = [
            p.micMuted ? '🔇' : '🎙️',
            p.deafened ? '🔕' : '',
            p.videoOn ? '📹' : '',
            p.screenOn ? '🖥️' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `
            <div class="ec-chan-occ-row">
              <div class="ec-occ-left">
                <span class="ec-occ-avatar${spk}" data-occ-avatar="${esc(p.identity)}">${esc(initials)}</span>
                <span>${esc(pName)}</span>
              </div>
              <span class="ec-occ-flags">${flags}</span>
            </div>
          `;
        })
        .join('');

      return `
        <div class="ec-chan-block${isJoined ? ' joined' : ''}">
          <div class="ec-chan-row" data-join-channel="${ch.channelId}">
            <span class="ec-chan-title">${icon} ${esc(ch.name)}</span>
            <span class="ec-pill-mini${isJoined ? ' online' : ''}">${isJoined ? 'Joined' : `${ch.peerCount}/8`}</span>
          </div>
          ${occRows ? `<div class="ec-chan-occupants">${occRows}</div>` : ''}
        </div>
      `;
    })
    .join('');
}

function ensureChannelTile(peerId, labelText, streamObj, isSelf = false) {
  const grid = document.getElementById('channelVideoGrid');
  if (!grid) return;
  const empty = grid.querySelector('.ec-empty');
  if (empty) empty.remove();

  const cleanId = peerId.toLowerCase().replace(/[^a-z0-9]/gi, '');
  const domId = `meshTile_${cleanId}`;
  let tile = document.getElementById(domId);
  if (!tile) {
    tile = document.createElement('div');
    tile.id = domId;
    tile.className = `ec-mesh-tile${speakingPeers.has(peerId.toLowerCase()) ? ' speaking' : ''}`;
    tile.innerHTML = `<video autoplay playsinline ${isSelf ? 'muted' : ''}></video><span class="ec-mesh-label mono"></span>`;
    grid.appendChild(tile);
  }
  const vid = tile.querySelector('video');
  attachStreamToVideoElement(vid, streamObj, { muted: isSelf || chanDeafened });
  tile.querySelector('.ec-mesh-label').textContent = labelText;
}

function cleanupChannelConnections() {
  if (myChannelAudioMonitor) {
    myChannelAudioMonitor.stop();
    myChannelAudioMonitor = null;
  }
  for (const [, entry] of channelPeers) {
    entry.audioMonitor?.stop();
    entry.session?.close();
  }
  channelPeers.clear();
  speakingPeers.clear();
  if (channelStream) {
    stopCallMediaStream(channelStream);
    channelStream = null;
  }
  chanMicMuted = false;
  chanDeafened = false;
  chanVideoOn = false;
  chanScreenOn = false;
  const grid = document.getElementById('channelVideoGrid');
  if (grid) {
    grid.innerHTML = `<div class="ec-empty">Click any <strong>🔊 Voice</strong> or <strong>📹 Video</strong> channel on the left to join immediately! Green rings light up around whoever is speaking.</div>`;
  }
  syncDiscordControlButtons();
}

async function createDiscordChannelTx() {
  const nameInp = document.getElementById('inpChannelName');
  const topicInp = document.getElementById('inpChannelTopic');
  const rawName = (nameInp?.value || '').trim().replace(/^#+/, '');
  if (!rawName) {
    setStatus('Enter a Discord channel name first (e.g. validator-war-room).', true);
    return;
  }
  try {
    setStatus(`Creating persistent Discord channel "#${rawName}" on Subnet 1…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall Channels' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const channelKind = Number(document.getElementById('selChannelKind')?.value || RTC_CHANNEL_KIND.VIDEO);

    const { channelId } = await rtcClient.createChannel({
      wallet,
      creatorIdentity: myId,
      guildAddr: guildFilterAddr || ZERO_ADDR,
      channelKind,
      name: rawName,
      topic: (topicInp?.value || '').trim(),
    });
    if (nameInp) nameInp.value = '';
    if (topicInp) topicInp.value = '';
    setStatus(`✅ Created persistent channel #${rawName} (ID #${channelId})!`);
    await syncState();
    if (channelId) {
      await joinDiscordChannelTx(channelId);
    }
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function joinDiscordChannelTx(channelId) {
  if (!channelId || channelId === joinedChannelId) return;
  try {
    if (joinedChannelId) {
      await leaveDiscordChannelTx({ silent: true });
    }
    setStageTab('channels');
    const targetCh =
      channelsList.find((c) => c.channelId === channelId) ||
      (await rtcClient.getChannelState(channelId));
    if (!targetCh) throw new Error('Channel not found.');

    setStatus(`Joining #${targetCh.name}…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall Channels' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();

    const wantVideo = targetCh.channelKind !== RTC_CHANNEL_KIND.VOICE;
    const mediaRes = await acquireConfiguredMedia(
      wantVideo ? RTC_MEDIA_KIND.VIDEO : RTC_MEDIA_KIND.VOICE,
      { allowSyntheticFallback: true }
    );
    channelStream = mediaRes.stream;
    chanVideoOn = channelStream.getVideoTracks().length > 0;
    chanMicMuted = false;
    chanDeafened = false;
    chanScreenOn = false;

    myChannelAudioMonitor = createAudioLevelMonitor(channelStream, {
      onSpeakingChange: (spk) => updateSpeakingHighlight(myId, spk),
    });

    await rtcClient.joinChannel({
      wallet,
      channelId,
      peerIdentity: myId,
      dtlsFp: ZERO_BYTES32,
      mediaFlags: computeMyChannelMediaFlags(),
    });

    joinedChannelId = channelId;
    activeChannelState = targetCh;
    ensureChannelTile(myId, `You (${idRec?.nickname || shortAddr(myId)})`, channelStream, true);
    document.getElementById('activeChannelTitle').textContent = `🔊 #${targetCh.name}`;
    document.getElementById('activeChannelTopic').textContent =
      targetCh.topic || 'Connected over Serverless P2P Mesh • Zero ringing, instant drop-in';
    syncDiscordControlButtons();
    setStatus(`🟢 Joined #${targetCh.name} — negotiating P2P mesh with channel peers!`);
    await syncState();
  } catch (err) {
    cleanupChannelConnections();
    setStatus(err?.message || String(err), true);
  }
}

async function leaveDiscordChannelTx({ silent = false } = {}) {
  const cid = joinedChannelId;
  joinedChannelId = 0;
  activeChannelState = null;
  cleanupChannelConnections();
  document.getElementById('activeChannelTitle').textContent =
    'Select any channel on the left to drop in instantly';
  document.getElementById('activeChannelTopic').textContent =
    'Persistent channels stay open 24/7 with zero ringing — speak, share camera, or stream 1080p screens.';
  document.getElementById('activeChannelPeerBadge').textContent = 'Standby';
  if (!cid) return;
  try {
    const myId = getMyIdentityOrEoa();
    await rtcClient.leaveChannel({ wallet, channelId: cid, peerIdentity: myId });
    if (!silent) {
      setStatus(`Disconnected from channel #${cid} (channel remains open 24/7).`);
      await syncState();
    }
  } catch (err) {
    if (!silent) setStatus(err?.message || String(err), true);
  }
}

async function reconcileActiveDiscordChannel() {
  if (!joinedChannelId || !channelStream || channelReconcileBusy) return;
  channelReconcileBusy = true;
  try {
    const myId = getMyIdentityOrEoa();
    const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
    const ch = await rtcClient.getChannelState(joinedChannelId);
    if (!ch) return;
    activeChannelState = ch;

    document.getElementById('activeChannelTitle').textContent = `🔊 #${ch.name}`;
    document.getElementById('activeChannelPeerBadge').textContent = `${ch.peerCount}/8 Connected`;
    document.getElementById('activeChannelPeerBadge').className = 'ec-pill-mini online';

    const myNick = wallet.getIdentityRecord?.()?.nickname || shortAddr(myId);
    ensureChannelTile(myId, `You (${myNick})`, channelStream, true);

    const activeIds = new Set(ch.peers.map((p) => p.identity));
    // Prune peers who left the channel
    for (const [pid, entry] of channelPeers.entries()) {
      if (!activeIds.has(pid)) {
        entry.audioMonitor?.stop();
        entry.session?.close();
        channelPeers.delete(pid);
        speakingPeers.delete(pid);
        const cleanId = pid.replace(/[^a-z0-9]/gi, '');
        document.getElementById(`meshTile_${cleanId}`)?.remove();
      }
    }

    let anyDcOpen = false;
    for (const peer of ch.peers) {
      if (peer.identity === myId) continue;
      const peerId = peer.identity;
      const peerLabel = await resolveDisplayName(peerId);
      const amInitiator = myId < peerId;
      const peerPub64 = await lookupPeerPub64(peerId);

      let entry = channelPeers.get(peerId);
      if (
        entry &&
        (entry.session?.pc?.connectionState === 'closed' ||
          entry.session?.pc?.connectionState === 'failed')
      ) {
        entry.audioMonitor?.stop();
        entry.session?.close();
        channelPeers.delete(peerId);
        entry = null;
      }

      if (!entry) {
        const createPeerSess = () =>
          new SlxWebRtcPeerSession({
            iceServers: getActiveIceServers(),
            localStream: channelStream,
            isInitiator: amInitiator,
            onRemoteStream: (remStream) => {
              ensureChannelTile(peerId, peerLabel, remStream, false);
              if (entry && !entry.audioMonitor && remStream.getAudioTracks().length > 0) {
                entry.audioMonitor = createAudioLevelMonitor(remStream, {
                  onSpeakingChange: (spk) => updateSpeakingHighlight(peerId, spk),
                });
              }
            },
            onDataMessage: (msg) => {
              appendChatBubble({
                sender: msg.sender || peerLabel,
                text: msg.text,
                mine: false,
                ts: msg.ts,
              });
            },
          });

        entry = {
          session: createPeerSess(),
          recreateSession: createPeerSess,
          lastHandledSeq: 0,
          offerSent: false,
          answerApplied: false,
          audioMonitor: null,
        };
        channelPeers.set(peerId, entry);
      }

      if (amInitiator && !entry.offerSent) {
        entry.offerSent = true;
        const offer = await entry.session.createBundledOffer({ iceWaitMs: 1800 });
        const env = await sealRtcSignalEnvelope(
          {
            v: 2,
            type: 'offer',
            sdp: offer.sdp,
            candidates: offer.candidates,
            senderPub33: myKeys.compressedPubKey,
            ts: Date.now(),
          },
          { recipientPub64: peerPub64 }
        );
        await rtcClient.postChannelSignal({
          wallet,
          channelId: joinedChannelId,
          fromIdentity: myId,
          toIdentity: peerId,
          signalType: RTC_ROOM_SIGNAL_TYPE.OFFER_WITH_ICE,
          senderDtlsFp: offer.dtlsFp,
          envelopeBytes: env.bytes,
        });
      }

      const inbound = await rtcClient.getChannelPairSignal(joinedChannelId, peerId, myId);
      if (inbound && inbound.seq > entry.lastHandledSeq) {
        entry.lastHandledSeq = inbound.seq;
        const opened = await openRtcSignalEnvelope(inbound.envelope, {
          signalPrivHex: myKeys.signalPrivHex,
        });
        const pay = opened?.payload;
        if (pay?.type === 'offer' && !amInitiator) {
          if (entry.session.pc.signalingState !== 'stable' || entry.session.pc.remoteDescription) {
            entry.audioMonitor?.stop();
            entry.audioMonitor = null;
            entry.session.close();
            entry.session = entry.recreateSession();
          }
          const ans = await entry.session.acceptOfferAndCreateBundledAnswer(
            pay,
            inbound.senderDtlsFp,
            { iceWaitMs: 1800 }
          );
          const replyPub64 = pay.senderPub33
            ? decompressSecp256k1Compressed33(pay.senderPub33)
            : peerPub64;
          const sealedAns = await sealRtcSignalEnvelope(
            {
              v: 2,
              type: 'answer',
              sdp: ans.sdp,
              candidates: ans.candidates,
              senderPub33: myKeys.compressedPubKey,
              ts: Date.now(),
            },
            { recipientPub64: replyPub64 }
          );
          await rtcClient.postChannelSignal({
            wallet,
            channelId: joinedChannelId,
            fromIdentity: myId,
            toIdentity: peerId,
            signalType: RTC_ROOM_SIGNAL_TYPE.ANSWER_WITH_ICE,
            senderDtlsFp: ans.dtlsFp,
            envelopeBytes: sealedAns.bytes,
          });
        } else if (pay?.type === 'answer' && amInitiator) {
          await entry.session.applyBundledAnswer(pay, inbound.senderDtlsFp);
          entry.answerApplied = true;
        }
      }

      if (entry.session?.dataChannel?.readyState === 'open') {
        anyDcOpen = true;
      }
    }

    const dcBadge = document.getElementById('dcStateBadge');
    if (dcBadge && activeStageTab === 'channels') {
      dcBadge.textContent = anyDcOpen ? '🟢 Mesh Open (0ms)' : `${ch.peerCount} in Channel`;
      dcBadge.className = `ec-pill-mini${anyDcOpen ? ' online' : ''}`;
    }
  } finally {
    channelReconcileBusy = false;
  }
}

// ============================================================================
// 4. Serverless K-ary P2P Fanout-Tree Live Broadcast & Discord Stage
// ============================================================================

function syncBroadcastControls() {
  const inStream = activeBroadcastId > 0;
  const bHand = document.getElementById('btnBcastRaiseHand');
  const bMute = document.getElementById('btnBcastMuteMic');
  const bScr = document.getElementById('btnBcastSwitchScreen');
  const bRep = document.getElementById('btnBcastReparent');
  const bLeave = document.getElementById('btnBcastLeaveOrEnd');
  const bStage = document.getElementById('btnBcastJoinStageMedia');

  const myId = getMyIdentityOrEoa();
  const myNode = activeBroadcastState?.nodes?.find((n) => n.identity === myId && n.active);
  const isSpeaker = myNode?.role === RTC_BROADCAST_ROLE.SPEAKER;
  const canSpeak = amBroadcastHost || Boolean(stageLocalStream);

  if (bHand) {
    bHand.disabled = !inStream || amBroadcastHost || isSpeaker;
    bHand.textContent = handRaised ? '🙌 Lower Hand' : '✋ Raise Hand';
  }
  if (bStage) {
    bStage.style.display = inStream && isSpeaker && !stageLocalStream ? 'inline-flex' : 'none';
  }
  if (bMute) {
    bMute.disabled = !inStream || !canSpeak;
    bMute.textContent = bcastMicMuted ? '🔇 Mic Muted' : '🎙️ Mic On';
    bMute.classList.toggle('muted', bcastMicMuted);
  }
  if (bScr) {
    bScr.disabled = !inStream || !amBroadcastHost;
  }
  if (bRep) {
    bRep.disabled = !inStream || amBroadcastHost;
  }
  if (bLeave) {
    bLeave.disabled = !inStream;
    bLeave.textContent = amBroadcastHost ? '⏹️ End Broadcast' : '📴 Leave Stream';
  }
}

function renderBroadcastsList() {
  const box = document.getElementById('broadcastsList');
  const liveDot = document.getElementById('tabBroadcastLiveDot');
  const liveStreams = broadcastsList.filter((b) => b.isLive);
  if (liveDot) {
    liveDot.style.display = liveStreams.length > 0 ? 'inline-flex' : 'none';
  }
  if (!box) return;

  const sig =
    `${activeBroadcastId}::` +
    broadcastsList.map((b) => `${b.streamId}:${b.status}:${b.activeCount}:${b.peakViewers}`).join('|');
  if (box.dataset.renderSig === sig) return;
  box.dataset.renderSig = sig;

  if (!liveStreams.length) {
    box.innerHTML = `<div class="ec-empty">No live broadcasts right now — click <strong>🔴 Go Live</strong> above!</div>`;
    return;
  }

  box.innerHTML = liveStreams
    .map((b) => {
      const isJoined = b.streamId === activeBroadcastId;
      const hostLabel = resolveCachedLabelSync(b.host);
      return `
        <div class="ec-peer-row">
          <div class="ec-peer-info">
            <div class="ec-peer-name">
              <span class="ec-dot ec-dot-3"></span>
              <span>#${b.streamId} ${esc(b.title)}</span>
            </div>
            <div class="ec-peer-sub mono">
              Host: ${esc(hostLabel)} • 👁️ ${b.viewerCount} watching (K=${b.fanoutK})
            </div>
          </div>
          <button type="button" class="ec-btn ${isJoined ? 'ec-btn-emerald' : 'ec-btn-rose'} ec-btn-xs" data-watch-stream="${b.streamId}">
            ${isJoined ? 'Live' : '▶️ Watch'}
          </button>
        </div>
      `;
    })
    .join('');
}

function renderBroadcastTreeInspector(bcast) {
  const box = document.getElementById('broadcastTreeList');
  const depthBadge = document.getElementById('bcastTreeDepthBadge');
  if (!box) return;
  if (!bcast || !Array.isArray(bcast.nodes)) {
    box.innerHTML = `<div class="ec-empty">Join or host a stream to inspect real-time P2P relay hops &amp; raised hands.</div>`;
    if (depthBadge) depthBadge.textContent = 'Tier 0';
    return;
  }

  if (depthBadge) {
    depthBadge.textContent = `Max Tier ${bcast.maxDepth} (K=${bcast.fanoutK})`;
  }

  const myId = getMyIdentityOrEoa();
  const activeNodes = bcast.nodes.filter((n) => n.active);
  box.innerHTML = activeNodes
    .map((n) => {
      const indent = '&nbsp;&nbsp;'.repeat(Math.min(4, n.tierDepth));
      const name = resolveCachedLabelSync(n.identity);
      const isHostNode = n.role === RTC_BROADCAST_ROLE.HOST;
      const isMe = n.identity === myId;
      const roleIcon =
        n.role === RTC_BROADCAST_ROLE.HOST
          ? '📡'
          : n.role === RTC_BROADCAST_ROLE.SPEAKER
            ? '🎤'
            : n.role === RTC_BROADCAST_ROLE.HAND_RAISED
              ? '✋'
              : '🌳';
      let hostAction = '';
      if (amBroadcastHost && !isHostNode) {
        if (n.role === RTC_BROADCAST_ROLE.SPEAKER) {
          hostAction = `<button type="button" class="ec-btn ec-btn-xs" data-demote-speaker="${esc(n.identity)}">Demote</button>`;
        } else {
          hostAction = `<button type="button" class="ec-btn ec-btn-emerald ec-btn-xs" data-promote-speaker="${esc(n.identity)}">🎤 Stage</button>`;
        }
      }
      return `
        <div class="ec-tree-node${isHostNode ? ' host' : ''}${isMe ? ' me' : ''}">
          <span>${indent}${roleIcon} T${n.tierDepth} ${esc(name)}${isMe ? ' (You)' : ''} <small>(${n.activeChildren}/${bcast.fanoutK})</small></span>
          ${hostAction}
        </div>
      `;
    })
    .join('');
}

function forwardBroadcastChatPacket(pkt, excludeChannel = null) {
  if (!pkt || !pkt.msgId || seenBcastChatIds.has(pkt.msgId)) return;
  seenBcastChatIds.add(pkt.msgId);
  const raw = JSON.stringify(pkt);

  if (upstreamSession?.dataChannel && upstreamSession.dataChannel !== excludeChannel) {
    if (upstreamSession.dataChannel.readyState === 'open') {
      try {
        upstreamSession.dataChannel.send(raw);
      } catch {
        // ignore
      }
    }
  }
  for (const [, child] of downstreamChildren) {
    const ch = child.session?.dataChannel;
    if (ch && ch !== excludeChannel && ch.readyState === 'open') {
      try {
        ch.send(raw);
      } catch {
        // ignore
      }
    }
  }
}

function handleInboundBroadcastChat(msg, sourceChannel) {
  if (!msg || !msg.text) return;
  const pkt = {
    msgId: msg.msgId || `${msg.sender || 'peer'}_${msg.ts || Date.now()}`,
    sender: msg.sender || 'Viewer',
    text: msg.text,
    ts: msg.ts || Date.now(),
  };
  if (seenBcastChatIds.has(pkt.msgId)) return;
  appendChatBubble({ sender: pkt.sender, text: pkt.text, mine: false, ts: pkt.ts });
  forwardBroadcastChatPacket(pkt, sourceChannel);
}

function cleanupBroadcastSession() {
  if (upstreamSession) {
    upstreamSession.close();
    upstreamSession = null;
  }
  for (const [, child] of downstreamChildren) {
    child.session?.close();
  }
  downstreamChildren.clear();
  for (const [, sp] of stageMeshPeers) {
    sp.audioMonitor?.stop();
    sp.session?.close();
  }
  stageMeshPeers.clear();
  if (hostBroadcastStream) {
    stopCallMediaStream(hostBroadcastStream);
    hostBroadcastStream = null;
  }
  if (stageLocalStream) {
    stopCallMediaStream(stageLocalStream);
    stageLocalStream = null;
  }
  viewerInboundStream = null;
  activeBroadcastId = 0;
  activeBroadcastState = null;
  amBroadcastHost = false;
  bcastMicMuted = false;
  handRaised = false;
  upstreamParentId = '';
  upstreamLastSeq = 0;

  const bv = document.getElementById('broadcastVideo');
  if (bv) {
    bv.onresize = null;
    bv.onloadeddata = null;
    bv._slxAutoplayMuted = false;
    bv._slxTrackSetKey = '';
    bv.srcObject = null;
  }
  document.getElementById('btnUnmuteBroadcast').style.display = 'none';
  document.getElementById('bcastCenterOverlay')?.classList.remove('hidden');
  document.getElementById('bcastHeadline').textContent = 'Serverless P2P Live Broadcasting';
  document.getElementById('bcastSubline').textContent =
    'Click 🔴 Go Live above to stream video, audio, or your screen — or click ▶️ Watch on any live stream with 0 camera/mic prompts!';
  document.getElementById('hudBcastBadge').textContent = '⚪ Offline';
  document.getElementById('hudBcastViewers').textContent = '👁️ 0 watching';
  document.getElementById('hudBcastTier').style.display = 'none';
  document.getElementById('hudBcastStats').textContent = 'K-ary WebRTC Relay Tree • 0 Media Servers';
  const strip = document.getElementById('stageSpeakersStrip');
  if (strip) {
    strip.innerHTML = '';
    strip.style.display = 'none';
  }
  renderBroadcastTreeInspector(null);
  syncBroadcastControls();
}

async function startLiveBroadcastTx() {
  const titleInp = document.getElementById('inpBroadcastTitle');
  const title = (titleInp?.value || '').trim() || 'Live Subnet 1 Broadcast';
  preBlessVideoElement('broadcastVideo');
  try {
    if (activeBroadcastId) {
      await leaveOrEndBroadcastTx({ silent: true });
    }
    setStageTab('broadcast');
    setStatus(`Acquiring broadcast source & launching P2P Fanout Tree stream "${title}"…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall Broadcast' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const mediaKind = Number(document.getElementById('selBroadcastMedia')?.value || RTC_MEDIA_KIND.VIDEO);
    const fanoutK = Number(document.getElementById('selBroadcastFanout')?.value || 4);

    const mediaRes = await acquireConfiguredMedia(mediaKind, { allowSyntheticFallback: true });
    hostBroadcastStream = mediaRes.stream;
    amBroadcastHost = true;
    bcastMicMuted = false;

    const bv = document.getElementById('broadcastVideo');
    await attachStreamToVideoElement(bv, hostBroadcastStream, { muted: true });
    if (hostBroadcastStream.getVideoTracks().length > 0) {
      document.getElementById('bcastCenterOverlay')?.classList.add('hidden');
    } else {
      document.getElementById('bcastHeadline').textContent = `🎙️ Live Audio Stage: ${title}`;
      document.getElementById('bcastSubline').textContent = 'Broadcasting encrypted Opus audio down the K-ary P2P tree!';
    }

    const { streamId } = await rtcClient.createBroadcast({
      wallet,
      hostIdentity: myId,
      guildAddr: guildFilterAddr || ZERO_ADDR,
      mediaKind,
      fanoutK,
      hostDtlsFp: ZERO_BYTES32,
      title,
    });

    activeBroadcastId = streamId;
    if (titleInp) titleInp.value = '';
    document.getElementById('hudBcastBadge').textContent = `🔴 LIVE #${streamId} (Host)`;
    document.getElementById('hudBcastTier').style.display = 'inline-flex';
    document.getElementById('hudBcastTier').textContent = `📡 Root (K=${fanoutK})`;
    syncBroadcastControls();
    setStatus(`🔴 Live Broadcast #${streamId} active! Viewers attach automatically in a K=${fanoutK} P2P fanout tree.`);
    await syncState();
  } catch (err) {
    cleanupBroadcastSession();
    setStatus(err?.message || String(err), true);
  }
}

async function watchBroadcastTx(streamId) {
  if (!streamId || streamId === activeBroadcastId) return;
  preBlessVideoElement('broadcastVideo');
  try {
    if (activeBroadcastId) {
      await leaveOrEndBroadcastTx({ silent: true });
    }
    setStageTab('broadcast');
    cleanupBroadcastSession();
    document.getElementById('bcastHeadline').textContent = `Joining Stream #${streamId}…`;
    document.getElementById('bcastSubline').textContent =
      'Requesting P2P relay slot from webrtc_signal.wasm (0 camera/mic permissions needed)…';
    setStatus(`Joining Live Broadcast #${streamId}…`);

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall Broadcast' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();

    await rtcClient.joinBroadcast({
      wallet,
      streamId,
      viewerIdentity: myId,
      viewerDtlsFp: ZERO_BYTES32,
    });

    activeBroadcastId = streamId;
    amBroadcastHost = false;
    document.getElementById('hudBcastBadge').textContent = `🟡 Connecting Stream #${streamId}…`;
    syncBroadcastControls();
    setStatus(`✅ Assigned P2P tree slot on Stream #${streamId} — waiting for upstream relay Offer…`);
    await syncState();
  } catch (err) {
    cleanupBroadcastSession();
    setStatus(err?.message || String(err), true);
  }
}

async function reparentBroadcastViewerTx() {
  if (!activeBroadcastId || amBroadcastHost) return;
  try {
    const myId = getMyIdentityOrEoa();
    setStatus('Switching to a fresh upstream P2P relay parent on Subnet 1…');
    if (upstreamSession) {
      upstreamSession.close();
      upstreamSession = null;
    }
    upstreamParentId = '';
    upstreamLastSeq = 0;
    await rtcClient.reparentViewer({ wallet, streamId: activeBroadcastId, viewerIdentity: myId });
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function toggleRaiseHandTx() {
  if (!activeBroadcastId || amBroadcastHost) return;
  try {
    const myId = getMyIdentityOrEoa();
    const next = !handRaised;
    await rtcClient.setHandRaised({ wallet, streamId: activeBroadcastId, viewerIdentity: myId, raised: next });
    handRaised = next;
    syncBroadcastControls();
    setStatus(next ? '✋ Raised hand — Host can invite you onto the Stage!' : 'Lowered hand.');
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function setStageSpeakerRoleTx(targetIdentity, promote) {
  if (!activeBroadcastId || !amBroadcastHost) return;
  try {
    const myId = getMyIdentityOrEoa();
    await rtcClient.setStageRole({
      wallet,
      streamId: activeBroadcastId,
      hostIdentity: myId,
      targetIdentity,
      role: promote ? RTC_BROADCAST_ROLE.SPEAKER : RTC_BROADCAST_ROLE.VIEWER,
    });
    setStatus(
      promote
        ? `🎤 Invited ${shortAddr(targetIdentity)} onto the Stage!`
        : `Moved ${shortAddr(targetIdentity)} back to Audience.`
    );
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function enablePromotedStageMediaTx() {
  if (!activeBroadcastId || amBroadcastHost || stageLocalStream) return;
  try {
    const res = await acquireConfiguredMedia(RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback: true });
    stageLocalStream = res.stream;
    syncBroadcastControls();
    setStatus('🎤 Stage Microphone & Camera active — meshing live with Broadcast Host!');
    await syncState();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function leaveOrEndBroadcastTx({ silent = false } = {}) {
  const sid = activeBroadcastId;
  const wasHost = amBroadcastHost;
  cleanupBroadcastSession();
  if (!sid) return;
  try {
    const myId = getMyIdentityOrEoa();
    if (wasHost) {
      await rtcClient.endBroadcast({ wallet, streamId: sid, hostIdentity: myId });
    } else {
      await rtcClient.leaveBroadcast({ wallet, streamId: sid, peerIdentity: myId });
    }
    if (!silent) {
      setStatus(wasHost ? `⏹️ Ended Live Broadcast #${sid}.` : `Left Live Broadcast #${sid}.`);
      await syncState();
    }
  } catch (err) {
    if (!silent) setStatus(err?.message || String(err), true);
  }
}

function ensureStageSpeakerTile(peerId, labelText, streamObj, isSelf = false) {
  const strip = document.getElementById('stageSpeakersStrip');
  if (!strip) return;
  strip.style.display = 'grid';
  const cleanId = peerId.toLowerCase().replace(/[^a-z0-9]/gi, '');
  const domId = `meshTile_stage_${cleanId}`;
  let tile = document.getElementById(domId);
  if (!tile) {
    tile = document.createElement('div');
    tile.id = domId;
    tile.className = 'ec-mesh-tile';
    tile.innerHTML = `<video autoplay playsinline ${isSelf ? 'muted' : ''}></video><span class="ec-mesh-label mono"></span>`;
    strip.appendChild(tile);
  }
  attachStreamToVideoElement(tile.querySelector('video'), streamObj, { muted: isSelf });
  tile.querySelector('.ec-mesh-label').textContent = `🎤 ${labelText}`;
}

async function reconcileActiveBroadcast() {
  if (!activeBroadcastId || bcastReconcileBusy) return;
  bcastReconcileBusy = true;
  try {
    const myId = getMyIdentityOrEoa();
    const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
    const bcast = await rtcClient.getBroadcastState(activeBroadcastId);
    if (!bcast || !bcast.isLive) {
      cleanupBroadcastSession();
      setStatus(`Stream ended by broadcaster.`);
      return;
    }
    activeBroadcastState = bcast;
    renderBroadcastTreeInspector(bcast);

    document.getElementById('hudBcastViewers').textContent =
      `👁️ ${bcast.viewerCount} watching (Peak ${Math.max(0, bcast.peakViewers - 1)})`;

    const myNode = bcast.nodes.find((n) => n.identity === myId && n.active);
    if (myNode && !amBroadcastHost) {
      handRaised = myNode.role === RTC_BROADCAST_ROLE.HAND_RAISED;
      document.getElementById('hudBcastTier').style.display = 'inline-flex';
      document.getElementById('hudBcastTier').textContent =
        `🌳 Tier ${myNode.tierDepth} • Relaying ${myNode.activeChildren}/${bcast.fanoutK}`;
    }
    syncBroadcastControls();

    // 1. Viewer Upstream Connection (Parent -> Me) + Self-Healing Reparenting
    if (!amBroadcastHost && myNode && myNode.parentIdentity && myNode.parentIdentity !== ZERO_ADDR) {
      const parentNode = bcast.nodes.find(
        (n) => n.identity === myNode.parentIdentity && n.active
      );
      if (!parentNode) {
        // Upstream relay peer closed their tab — automatically self-heal to an active parent!
        await reparentBroadcastViewerTx();
        return;
      }

      if (upstreamParentId !== myNode.parentIdentity) {
        if (upstreamSession) {
          upstreamSession.close();
          upstreamSession = null;
        }
        upstreamParentId = myNode.parentIdentity;
        upstreamLastSeq = 0;
      }

      const inbound = await rtcClient.getBroadcastPairSignal(
        activeBroadcastId,
        upstreamParentId,
        myId
      );
      if (inbound && inbound.seq > upstreamLastSeq) {
        upstreamLastSeq = inbound.seq;
        const opened = await openRtcSignalEnvelope(inbound.envelope, {
          signalPrivHex: myKeys.signalPrivHex,
        });
        const pay = opened?.payload;
        if (pay?.type === 'offer') {
          if (upstreamSession) upstreamSession.close();
          upstreamSession = new SlxWebRtcPeerSession({
            iceServers: getActiveIceServers(),
            localStream: null,
            isInitiator: false,
            onRemoteStream: (remStream) => {
              viewerInboundStream = remStream;
              const bv = document.getElementById('broadcastVideo');
              const unmuteBtn = document.getElementById('btnUnmuteBroadcast');
              const revealBcast = () => {
                if (
                  bv.videoWidth > 0 ||
                  remStream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted)
                ) {
                  document.getElementById('bcastCenterOverlay')?.classList.add('hidden');
                } else if (bcast.mediaKind === RTC_MEDIA_KIND.VOICE) {
                  document.getElementById('bcastHeadline').textContent = `🎙️ ${bcast.title}`;
                  document.getElementById('bcastSubline').textContent =
                    `Connected via Tier ${myNode.tierDepth} P2P Relay (${shortAddr(upstreamParentId)})`;
                }
              };
              bv.onresize = revealBcast;
              bv.onloadeddata = revealBcast;
              attachStreamToVideoElement(bv, remStream, {
                muted: false,
                onAutoplayMuted: () => {
                  if (unmuteBtn) unmuteBtn.style.display = 'inline-flex';
                },
              }).then(revealBcast);
            },
            onConnectionState: ({ connectionState, iceConnectionState }) => {
              const st = connectionState || iceConnectionState;
              if (st === 'connected' || iceConnectionState === 'completed') {
                document.getElementById('hudBcastBadge').textContent = `🔴 LIVE #${bcast.streamId}`;
              } else if (st === 'failed') {
                reparentBroadcastViewerTx();
              }
            },
            onDataMessage: (msg) => handleInboundBroadcastChat(msg, upstreamSession?.dataChannel),
          });

          const ans = await upstreamSession.acceptOfferAndCreateBundledAnswer(
            pay,
            inbound.senderDtlsFp,
            { iceWaitMs: 1800 }
          );
          const parentPub64 = pay.senderPub33
            ? decompressSecp256k1Compressed33(pay.senderPub33)
            : await lookupPeerPub64(upstreamParentId);
          const sealedAns = await sealRtcSignalEnvelope(
            {
              v: 2,
              type: 'answer',
              sdp: ans.sdp,
              candidates: ans.candidates,
              senderPub33: myKeys.compressedPubKey,
              ts: Date.now(),
            },
            { recipientPub64: parentPub64 }
          );
          await rtcClient.postBroadcastSignal({
            wallet,
            streamId: activeBroadcastId,
            fromIdentity: myId,
            toIdentity: upstreamParentId,
            signalType: RTC_ROOM_SIGNAL_TYPE.ANSWER_WITH_ICE,
            senderDtlsFp: ans.dtlsFp,
            envelopeBytes: sealedAns.bytes,
          });
          setStatus(
            `🟢 Connected to Stream #${activeBroadcastId} via P2P Parent ${shortAddr(upstreamParentId)} (Tier ${myNode.tierDepth})!`
          );
        }
      }

      if (upstreamSession) {
        const st = await upstreamSession.pollStats();
        document.getElementById('hudBcastStats').textContent =
          `⚡ Tier ${myNode.tierDepth} Hop • ↓ ${(st.bytesReceived / 1024).toFixed(1)} KB • Relaying to ${myNode.activeChildren} children`;
      }
    }

    // 2. Downstream Fanout Relay (Me -> My Assigned Tree Children!)
    // Works identically whether I am Tier-0 Host OR a Tier-1/Tier-2 Viewer forwarding `viewerInboundStream`!
    const relayStream = amBroadcastHost ? hostBroadcastStream : viewerInboundStream;
    const relayReady = amBroadcastHost
      ? Boolean(relayStream && relayStream.getTracks().length > 0)
      : Boolean(
          relayStream &&
            (bcast.mediaKind === RTC_MEDIA_KIND.VOICE
              ? relayStream.getAudioTracks().length > 0
              : relayStream.getVideoTracks().length > 0)
        );
    if (relayReady) {
      const assignedChildren = bcast.nodes.filter(
        (n) => n.active && n.parentIdentity === myId && n.identity !== myId
      );
      const activeChildSet = new Set(assignedChildren.map((c) => c.identity));
      for (const [cid, entry] of downstreamChildren.entries()) {
        if (!activeChildSet.has(cid)) {
          entry.session?.close();
          downstreamChildren.delete(cid);
        }
      }

      for (const child of assignedChildren) {
        let entry = downstreamChildren.get(child.identity);
        if (!entry) {
          const sess = new SlxWebRtcPeerSession({
            iceServers: getActiveIceServers(),
            localStream: relayStream,
            isInitiator: true,
            onDataMessage: (msg) => handleInboundBroadcastChat(msg, sess.dataChannel),
          });
          entry = { session: sess, offerSent: false, lastAnswerSeq: 0 };
          downstreamChildren.set(child.identity, entry);
        }

        if (!entry.offerSent) {
          entry.offerSent = true;
          const offer = await entry.session.createBundledOffer({ iceWaitMs: 1800 });
          const childPub64 = await lookupPeerPub64(child.identity);
          const sealedOffer = await sealRtcSignalEnvelope(
            {
              v: 2,
              type: 'offer',
              sdp: offer.sdp,
              candidates: offer.candidates,
              senderPub33: myKeys.compressedPubKey,
              ts: Date.now(),
            },
            { recipientPub64: childPub64 }
          );
          await rtcClient.postBroadcastSignal({
            wallet,
            streamId: activeBroadcastId,
            fromIdentity: myId,
            toIdentity: child.identity,
            signalType: RTC_ROOM_SIGNAL_TYPE.OFFER_WITH_ICE,
            senderDtlsFp: offer.dtlsFp,
            envelopeBytes: sealedOffer.bytes,
          });
        }

        const childAns = await rtcClient.getBroadcastPairSignal(
          activeBroadcastId,
          child.identity,
          myId
        );
        if (childAns && childAns.seq > entry.lastAnswerSeq) {
          entry.lastAnswerSeq = childAns.seq;
          const opened = await openRtcSignalEnvelope(childAns.envelope, {
            signalPrivHex: myKeys.signalPrivHex,
          });
          if (opened?.payload?.type === 'answer') {
            await entry.session.applyBundledAnswer(opened.payload, childAns.senderDtlsFp);
          }
        }
      }

      if (amBroadcastHost) {
        document.getElementById('hudBcastStats').textContent =
          `📡 Root Broadcaster • Uploading to ${assignedChildren.length}/${bcast.fanoutK} Tier-1 Relays • Total Audience: ${bcast.viewerCount}`;
      }
    }

    // 3. Promoted Stage Co-Speaker Mesh (Promoted Speakers -> Host Live Audio/Video Strip)
    if (!amBroadcastHost && stageLocalStream && myNode?.role !== RTC_BROADCAST_ROLE.SPEAKER) {
      stopCallMediaStream(stageLocalStream);
      stageLocalStream = null;
      for (const [, sp] of stageMeshPeers) {
        sp.audioMonitor?.stop();
        sp.session?.close();
      }
      stageMeshPeers.clear();
      const strip = document.getElementById('stageSpeakersStrip');
      if (strip) {
        strip.innerHTML = '';
        strip.style.display = 'none';
      }
      syncBroadcastControls();
    }

    if (amBroadcastHost) {
      const activeSpeakers = bcast.nodes.filter(
        (n) => n.active && n.role === RTC_BROADCAST_ROLE.SPEAKER && n.identity !== myId
      );
      const speakerSet = new Set(activeSpeakers.map((s) => s.identity));
      for (const [sid, sp] of stageMeshPeers.entries()) {
        if (!speakerSet.has(sid)) {
          sp.audioMonitor?.stop();
          sp.session?.close();
          stageMeshPeers.delete(sid);
          const cleanId = sid.toLowerCase().replace(/[^a-z0-9]/gi, '');
          document.getElementById(`meshTile_stage_${cleanId}`)?.remove();
        }
      }
      const strip = document.getElementById('stageSpeakersStrip');
      if (strip && strip.children.length === 0) {
        strip.style.display = 'none';
      }

      for (const spkNode of activeSpeakers) {
        const spkId = spkNode.identity;
        const label = await resolveDisplayName(spkId);
        let sp = stageMeshPeers.get(spkId);
        if (!sp) {
          sp = { session: null, lastOfferSeq: 0, audioMonitor: null };
          stageMeshPeers.set(spkId, sp);
        }
        const sig = await rtcClient.getBroadcastPairSignal(activeBroadcastId, spkId, myId);
        if (sig && sig.seq > sp.lastOfferSeq) {
          const opened = await openRtcSignalEnvelope(sig.envelope, {
            signalPrivHex: myKeys.signalPrivHex,
          });
          if (opened?.payload?.type === 'stage_offer') {
            sp.lastOfferSeq = sig.seq;
            sp.audioMonitor?.stop();
            sp.session?.close();
            sp.session = new SlxWebRtcPeerSession({
              iceServers: getActiveIceServers(),
              localStream: null,
              isInitiator: false,
              onRemoteStream: (remStream) => {
                ensureStageSpeakerTile(spkId, label, remStream, false);
                if (!sp.audioMonitor && remStream.getAudioTracks().length > 0) {
                  sp.audioMonitor = createAudioLevelMonitor(remStream, {
                    onSpeakingChange: (speaking) => {
                      const cleanId = spkId.toLowerCase().replace(/[^a-z0-9]/gi, '');
                      document
                        .getElementById(`meshTile_stage_${cleanId}`)
                        ?.classList.toggle('speaking', speaking);
                    },
                  });
                }
              },
            });
            const ans = await sp.session.acceptOfferAndCreateBundledAnswer(
              opened.payload,
              sig.senderDtlsFp,
              { iceWaitMs: 1800 }
            );
            const spkPub64 = opened.payload.senderPub33
              ? decompressSecp256k1Compressed33(opened.payload.senderPub33)
              : await lookupPeerPub64(spkId);
            const sealedAns = await sealRtcSignalEnvelope(
              {
                v: 2,
                type: 'stage_answer',
                sdp: ans.sdp,
                candidates: ans.candidates,
                senderPub33: myKeys.compressedPubKey,
                ts: Date.now(),
              },
              { recipientPub64: spkPub64 }
            );
            await rtcClient.postBroadcastSignal({
              wallet,
              streamId: activeBroadcastId,
              fromIdentity: myId,
              toIdentity: spkId,
              signalType: RTC_ROOM_SIGNAL_TYPE.ANSWER_WITH_ICE,
              senderDtlsFp: ans.dtlsFp,
              envelopeBytes: sealedAns.bytes,
            });
          }
        }
      }
    } else if (stageLocalStream && myNode?.role === RTC_BROADCAST_ROLE.SPEAKER) {
      ensureStageSpeakerTile(myId, 'You (On Stage)', stageLocalStream, true);
      const hostId = bcast.host;
      // Wait for initial Tier-1 viewer handshake if Host is also our direct tree parent
      const parentTreeReady =
        upstreamParentId !== hostId ||
        upstreamSession?.pc?.connectionState === 'connected' ||
        upstreamSession?.pc?.iceConnectionState === 'connected' ||
        upstreamSession?.pc?.iceConnectionState === 'completed';

      if (parentTreeReady && hostId && hostId !== myId) {
        let sp = stageMeshPeers.get(hostId);
        if (!sp) {
          const sess = new SlxWebRtcPeerSession({
            iceServers: getActiveIceServers(),
            localStream: stageLocalStream,
            isInitiator: true,
          });
          sp = { session: sess, offerSent: false, lastAnsSeq: 0, audioMonitor: null };
          stageMeshPeers.set(hostId, sp);
        }
        if (!sp.offerSent) {
          sp.offerSent = true;
          const offer = await sp.session.createBundledOffer({ iceWaitMs: 1800 });
          const hostPub64 = await lookupPeerPub64(hostId);
          const sealedOffer = await sealRtcSignalEnvelope(
            {
              v: 2,
              type: 'stage_offer',
              sdp: offer.sdp,
              candidates: offer.candidates,
              senderPub33: myKeys.compressedPubKey,
              ts: Date.now(),
            },
            { recipientPub64: hostPub64 }
          );
          await rtcClient.postBroadcastSignal({
            wallet,
            streamId: activeBroadcastId,
            fromIdentity: myId,
            toIdentity: hostId,
            signalType: RTC_ROOM_SIGNAL_TYPE.OFFER_WITH_ICE,
            senderDtlsFp: offer.dtlsFp,
            envelopeBytes: sealedOffer.bytes,
          });
        }
        const hostAns = await rtcClient.getBroadcastPairSignal(activeBroadcastId, hostId, myId);
        if (hostAns && hostAns.seq > sp.lastAnsSeq) {
          const opened = await openRtcSignalEnvelope(hostAns.envelope, {
            signalPrivHex: myKeys.signalPrivHex,
          });
          if (opened?.payload?.type === 'stage_answer') {
            sp.lastAnsSeq = hostAns.seq;
            await sp.session.applyBundledAnswer(opened.payload, hostAns.senderDtlsFp);
          }
        }
      }
    }

    const dcBadge = document.getElementById('dcStateBadge');
    if (dcBadge && activeStageTab === 'broadcast') {
      const treeDcOpen =
        upstreamSession?.dataChannel?.readyState === 'open' ||
        Array.from(downstreamChildren.values()).some(
          (c) => c.session?.dataChannel?.readyState === 'open'
        );
      dcBadge.textContent = treeDcOpen
        ? '🟢 Tree Chat Live (0ms)'
        : amBroadcastHost
          ? '📡 Ready for Viewers'
          : '🟡 Connecting Tree…';
      dcBadge.className = `ec-pill-mini${treeDcOpen ? ' online' : ''}`;
    }
  } finally {
    bcastReconcileBusy = false;
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
    document.getElementById('statChannels').textContent = String(hubOverview.totalChannels ?? 0);
    document.getElementById('statBroadcasts').textContent = String(hubOverview.totalBroadcasts ?? 0);
    updateInspector();

    const dirRes = await rtcClient.getDirectory(0, 32);
    directoryProfiles = dirRes.profiles || [];
    renderMyKeyPreview();
    ensureMyProfilePublishedSilently();

    const myId = getMyIdentityOrEoa();
    if (myId) {
      recentCalls = await rtcClient.getRecentCalls(myId);
    }
    await renderDirectoryAndRecents();

    const [chSlice, bcSlice] = await Promise.all([
      rtcClient.getChannels(0, 32).catch(() => ({ channels: [] })),
      rtcClient.getBroadcasts(0, 24).catch(() => ({ broadcasts: [] })),
    ]);
    channelsList = chSlice.channels || [];
    broadcastsList = bcSlice.broadcasts || [];
    renderDiscordChannelsSidebar();
    renderBroadcastsList();

    await detectIncomingRingingCalls();
    await reconcileActiveDirectCall();
    await reconcileActiveDiscordChannel();
    await reconcileActiveBroadcast();
  } catch (err) {
    console.warn('[EtherCall v2 syncState]', err);
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
    if (typeof stopWatcher === 'function') stopWatcher();
    else stopWatcher.unsubscribe?.();
    stopWatcher = null;
  }
  if (reactivePollTimer) {
    clearInterval(reactivePollTimer);
    reactivePollTimer = null;
  }
  await syncState();

  stopWatcher = slxWatchChainApp({
    rpcUrl: () => rpcUrl,
    filter: () => (hubAddr ? { address: hubAddr } : null),
    onHead: () => syncState(),
    onLog: () => syncState(),
    onRefresh: () => syncState(),
    offlineFallbackMs: 3500,
    sortBackfill: false,
  });

  reactivePollTimer = setInterval(() => {
    if (typeof document === 'undefined' || !document.hidden) {
      syncState();
    }
  }, 1800);
}

function setStageTab(tab) {
  activeStageTab = tab;
  document.getElementById('tabBtnDirect').classList.toggle('active', tab === 'direct');
  document.getElementById('tabBtnChannels').classList.toggle('active', tab === 'channels');
  document.getElementById('tabBtnBroadcast').classList.toggle('active', tab === 'broadcast');

  document.getElementById('stageDirectPane').style.display = tab === 'direct' ? 'flex' : 'none';
  document.getElementById('stageChannelsPane').style.display = tab === 'channels' ? 'flex' : 'none';
  document.getElementById('stageBroadcastPane').style.display = tab === 'broadcast' ? 'flex' : 'none';

  const chatTitle = document.getElementById('chatPanelTitle');
  if (chatTitle) {
    chatTitle.textContent =
      tab === 'channels'
        ? '💬 Channel Mesh Chat (0ms)'
        : tab === 'broadcast'
          ? '💬 Live Stream Tree Chat (0ms)'
          : '💬 0ms P2P DataChannel Chat';
  }
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'telephony',
    title: 'EtherCall — Calls, Discord Channels & Broadcasts',
    subtitle:
      'Halt-Free Signaling v2 (webrtc_signal.wasm) • Persistent Channels • K-ary P2P Broadcast Tree • $0 Gas',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => hubAddr || '',
    getContractLabel: () => 'Subnet 1 EtherCall v2 Hub',
    onWalletSwitch: () => {
      autoPublishedOnce = false;
      syncState();
    },
    extraElements: [document.getElementById('btnHeaderLoopback')],
  });

  checkSecureOriginBanner();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncState();
  });

  // Check URL query deep-links (e.g. from CommonsRF Social Guilds: `?tab=channels&guild=0x...&name=...`)
  const qp = new URLSearchParams(window.location.search);
  const reqTab = qp.get('tab');
  const reqGuild = qp.get('guild');
  const reqName = qp.get('name');
  if (reqGuild && /^0x[0-9a-fA-F]{40}$/.test(reqGuild)) {
    guildFilterAddr = reqGuild.toLowerCase();
    guildFilterName = reqName || shortAddr(guildFilterAddr);
    const gBanner = document.getElementById('guildFilterBanner');
    if (gBanner) {
      document.getElementById('guildFilterLabel').textContent = `🏛️ Guild Channel Scope: ${guildFilterName}`;
      gBanner.style.display = 'flex';
    }
    const chInp = document.getElementById('inpChannelName');
    if (chInp && reqName) chInp.value = reqName;
  }
  if (reqTab === 'channels' || reqTab === 'broadcast' || reqTab === 'direct') {
    setStageTab(reqTab);
  } else if (guildFilterAddr) {
    setStageTab('channels');
  }

  document.getElementById('btnClearGuildFilter')?.addEventListener('click', () => {
    guildFilterAddr = '';
    guildFilterName = '';
    document.getElementById('guildFilterBanner').style.display = 'none';
    renderDiscordChannelsSidebar();
  });

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
    setStatus('🧪 Enabled Simulated Radar Camera & Tone — ready to call, join channels, or broadcast!');
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

  document.getElementById('btnUnmuteBroadcast')?.addEventListener('click', () => {
    const bv = document.getElementById('broadcastVideo');
    if (bv) {
      bv._slxAutoplayMuted = false;
      bv.muted = false;
      bv.play().catch(() => {});
    }
    document.getElementById('btnUnmuteBroadcast').style.display = 'none';
  });

  // Delegated click listeners
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

  document.getElementById('discordChannelsList').addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-join-channel]');
    if (row) {
      joinDiscordChannelTx(Number(row.getAttribute('data-join-channel')));
    }
  });

  document.getElementById('broadcastsList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-watch-stream]');
    if (btn) {
      watchBroadcastTx(Number(btn.getAttribute('data-watch-stream')));
    }
  });

  document.getElementById('broadcastTreeList').addEventListener('click', (ev) => {
    const prom = ev.target.closest('[data-promote-speaker]');
    if (prom) {
      setStageSpeakerRoleTx(prom.getAttribute('data-promote-speaker'), true);
      return;
    }
    const dem = ev.target.closest('[data-demote-speaker]');
    if (dem) {
      setStageSpeakerRoleTx(dem.getAttribute('data-demote-speaker'), false);
    }
  });

  // Stage Tabs
  document.getElementById('tabBtnDirect').addEventListener('click', () => setStageTab('direct'));
  document.getElementById('tabBtnChannels').addEventListener('click', () => setStageTab('channels'));
  document.getElementById('tabBtnBroadcast').addEventListener('click', () => setStageTab('broadcast'));

  // Presence & 1:1 Direct Calls
  document.getElementById('btnPublishPresence').addEventListener('click', publishPresenceTx);
  document.getElementById('btnRefreshDir').addEventListener('click', syncState);
  document.getElementById('btnRefreshChannels').addEventListener('click', syncState);
  document.getElementById('btnRefreshBroadcasts').addEventListener('click', syncState);

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
      await ensureLocalStream(RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback: true });
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

  // Discord Channels Controls
  document.getElementById('btnCreateChannel').addEventListener('click', createDiscordChannelTx);
  document.getElementById('btnChanDisconnect').addEventListener('click', () => leaveDiscordChannelTx());
  document.getElementById('btnLeaveChannelQuick').addEventListener('click', () => leaveDiscordChannelTx());

  document.getElementById('btnChanMute').addEventListener('click', async () => {
    if (!channelStream || !joinedChannelId) return;
    chanMicMuted = !chanMicMuted;
    for (const tr of channelStream.getAudioTracks()) tr.enabled = !chanMicMuted;
    syncDiscordControlButtons();
    rtcClient
      .updateChannelMedia({
        wallet,
        channelId: joinedChannelId,
        peerIdentity: getMyIdentityOrEoa(),
        mediaFlags: computeMyChannelMediaFlags(),
      })
      .then(() => syncState())
      .catch(() => {});
  });

  document.getElementById('btnChanDeafen').addEventListener('click', async () => {
    if (!joinedChannelId) return;
    chanDeafened = !chanDeafened;
    if (chanDeafened) {
      chanMicMuted = true;
      if (channelStream) {
        for (const tr of channelStream.getAudioTracks()) tr.enabled = false;
      }
    }
    document.querySelectorAll('#channelVideoGrid video').forEach((v) => {
      if (!v.parentElement?.id?.includes(getMyIdentityOrEoa().replace(/[^a-z0-9]/gi, ''))) {
        v.muted = chanDeafened;
      }
    });
    syncDiscordControlButtons();
    rtcClient
      .updateChannelMedia({
        wallet,
        channelId: joinedChannelId,
        peerIdentity: getMyIdentityOrEoa(),
        mediaFlags: computeMyChannelMediaFlags(),
      })
      .then(() => syncState())
      .catch(() => {});
  });

  document.getElementById('btnChanVideo').addEventListener('click', async () => {
    if (!channelStream || !joinedChannelId) return;
    const existingVid = channelStream.getVideoTracks()[0];
    if (existingVid) {
      chanVideoOn = !chanVideoOn;
      existingVid.enabled = chanVideoOn;
    } else {
      const camRes = await acquireConfiguredMedia(RTC_MEDIA_KIND.VIDEO, { allowSyntheticFallback: true });
      const newVid = camRes.stream.getVideoTracks()[0];
      if (newVid) {
        channelStream.addTrack(newVid);
        for (const [, entry] of channelPeers) {
          await entry.session?.replaceVideoTrack(newVid);
        }
        const myId = getMyIdentityOrEoa();
        ensureChannelTile(myId, `You (${shortAddr(myId)})`, channelStream, true);
        chanVideoOn = true;
      }
    }
    syncDiscordControlButtons();
    rtcClient
      .updateChannelMedia({
        wallet,
        channelId: joinedChannelId,
        peerIdentity: getMyIdentityOrEoa(),
        mediaFlags: computeMyChannelMediaFlags(),
      })
      .then(() => syncState())
      .catch(() => {});
  });

  document.getElementById('btnChanScreen').addEventListener('click', async () => {
    if (!joinedChannelId) return;
    try {
      const res = await acquireCallMediaStream({ mediaKind: RTC_MEDIA_KIND.SCREEN });
      const screenTrack = res.stream.getVideoTracks()[0];
      if (!screenTrack) return;
      for (const [, entry] of channelPeers) {
        await entry.session?.replaceVideoTrack(screenTrack);
      }
      const myId = getMyIdentityOrEoa();
      ensureChannelTile(myId, `You (Screen Share)`, res.stream, true);
      chanScreenOn = true;
      syncDiscordControlButtons();
      rtcClient
        .updateChannelMedia({
          wallet,
          channelId: joinedChannelId,
          peerIdentity: myId,
          mediaFlags: computeMyChannelMediaFlags(),
        })
        .catch(() => {});
      screenTrack.onended = async () => {
        chanScreenOn = false;
        const camTrack = channelStream?.getVideoTracks()?.[0] || null;
        for (const [, entry] of channelPeers) {
          await entry.session?.replaceVideoTrack(camTrack);
        }
        if (channelStream) ensureChannelTile(myId, `You (${shortAddr(myId)})`, channelStream, true);
        syncDiscordControlButtons();
        rtcClient
          .updateChannelMedia({
            wallet,
            channelId: joinedChannelId,
            peerIdentity: myId,
            mediaFlags: computeMyChannelMediaFlags(),
          })
          .catch(() => {});
      };
    } catch (err) {
      setStatus(err?.message || 'Screen share canceled', true);
    }
  });

  // Broadcast & Stage Controls
  document.getElementById('btnStartBroadcast').addEventListener('click', startLiveBroadcastTx);
  document.getElementById('btnBcastRaiseHand').addEventListener('click', toggleRaiseHandTx);
  document.getElementById('btnBcastJoinStageMedia').addEventListener('click', enablePromotedStageMediaTx);
  document.getElementById('btnBcastReparent').addEventListener('click', reparentBroadcastViewerTx);
  document.getElementById('btnBcastLeaveOrEnd').addEventListener('click', () => leaveOrEndBroadcastTx());

  document.getElementById('btnBcastMuteMic').addEventListener('click', () => {
    const targetStream = amBroadcastHost ? hostBroadcastStream : stageLocalStream;
    if (!targetStream) return;
    bcastMicMuted = !bcastMicMuted;
    for (const tr of targetStream.getAudioTracks()) tr.enabled = !bcastMicMuted;
    syncBroadcastControls();
  });

  document.getElementById('btnBcastSwitchScreen').addEventListener('click', async () => {
    if (!amBroadcastHost || !hostBroadcastStream) return;
    try {
      const res = await acquireCallMediaStream({ mediaKind: RTC_MEDIA_KIND.SCREEN });
      const scrTrack = res.stream.getVideoTracks()[0];
      if (!scrTrack) return;
      for (const [, child] of downstreamChildren) {
        await child.session?.replaceVideoTrack(scrTrack);
      }
      await attachStreamToVideoElement(document.getElementById('broadcastVideo'), res.stream, { muted: true });
      document.getElementById('bcastCenterOverlay')?.classList.add('hidden');
      setStatus('🖥️ Broadcasting live screen share down the K-ary P2P tree!');
      scrTrack.onended = async () => {
        const camTrack = hostBroadcastStream?.getVideoTracks()?.[0] || null;
        if (camTrack) {
          for (const [, child] of downstreamChildren) {
            await child.session?.replaceVideoTrack(camTrack);
          }
          await attachStreamToVideoElement(document.getElementById('broadcastVideo'), hostBroadcastStream, {
            muted: true,
          });
        }
      };
    } catch (err) {
      setStatus(err?.message || 'Screen share canceled', true);
    }
  });

  // Unified P2P DataChannel Chat (1:1 Direct | Channel Mesh | Broadcast Tree Flood!)
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
    for (const [, entry] of channelPeers) {
      if (entry.session?.sendChatMessage(text, senderLabel)) sent = true;
    }
    if (activeBroadcastId) {
      const pkt = {
        msgId: `${getMyIdentityOrEoa()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sender: senderLabel,
        text,
        ts: Date.now(),
      };
      forwardBroadcastChatPacket(pkt, null);
      sent = true;
    }

    if (!sent) {
      setStatus('Start a call, join a Discord channel, or open a Live Broadcast first!', true);
      return;
    }
    inp.value = '';
    appendChatBubble({ sender: `${senderLabel} (You)`, text, mine: true });
  });

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
