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
  deriveRtcSignalingKeys,
  decompressSecp256k1Compressed33,
  sealRtcSignalEnvelope,
  openRtcSignalEnvelope,
  acquireCallMediaStream,
  stopCallMediaStream,
  createCallRingtoneController,
  createLocalLoopbackPair,
} from '@superlexicon/sdk/webrtc';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';

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
const meshPeers = new Map(); // peerIdentity -> { session, lastHandledSeq, offerSent }

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
    if (cams.length === 0 && mics.length === 0) {
      const chk = document.getElementById('chkForceSynthetic');
      if (chk) chk.checked = true;
    }
  } catch {
    // ignore permission-gated device labels
  }
}

async function ensureLocalStream(mediaKind = RTC_MEDIA_KIND.VIDEO) {
  if (localStream && !previewOnly) return localStream;
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
    syntheticLabel: label,
  });
  localStream = res.stream;
  previewOnly = false;

  const lv = document.getElementById('localVideo');
  if (lv) lv.srcObject = localStream;
  const tag = document.getElementById('localPipTag');
  if (tag) tag.textContent = res.isSynthetic ? 'You (Sim Feed)' : 'You (Live Cam)';
  await populateMediaDevices();
  return localStream;
}

function startStatsLoop() {
  stopStatsLoop();
  callConnectedAt = Date.now();
  const timerEl = document.getElementById('hudCallTimer');
  if (timerEl) timerEl.style.display = 'inline-flex';

  statsInterval = setInterval(async () => {
    const activeSess = peerSession || loopbackHandle?.callerSession;
    if (!activeSess) return;

    if (callConnectedAt > 0 && timerEl) {
      const sec = Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000));
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
    }

    const st = await activeSess.pollStats();
    const kbUp = (st.bytesSent / 1024).toFixed(1);
    const kbDown = (st.bytesReceived / 1024).toFixed(1);
    const rttTxt = st.rttMs !== null ? `${st.rttMs} ms RTT` : 'LAN Direct';
    document.getElementById('hudRtcStats').textContent =
      `⚡ ${rttTxt} • ${st.localCandidateType}/${st.protocol} • ↑ ${kbUp} KB ↓ ${kbDown} KB`;

    const dc = activeSess.dataChannel;
    const dcBadge = document.getElementById('dcStateBadge');
    if (dcBadge) {
      const open = dc?.readyState === 'open';
      dcBadge.textContent = open ? '🟢 P2P Open (0ms)' : st.connectionState;
      dcBadge.className = `ec-pill-mini${open ? ' online' : ''}`;
    }
  }, 1200);
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
  appliedCallerIceBatches = 0;
  appliedCalleeIceBatches = 0;
  answerApplied = false;
  micMuted = false;
  camMuted = false;

  const rv = document.getElementById('remoteVideo');
  if (rv) rv.srcObject = null;
  if (!previewOnly) {
    const lv = document.getElementById('localVideo');
    if (lv) lv.srcObject = null;
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
// 1. Publish Presence & Directory Rendering
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
      badge.textContent = myProf.availabilityLabel;
      badge.className = `ec-pill-mini${myProf.availability === 1 ? ' online' : ''}`;
      const inp = document.getElementById('inpDisplayLabel');
      if (inp && !inp.value && myProf.displayLabel) inp.value = myProf.displayLabel;
    } else {
      badge.textContent = 'Unpublished';
      badge.className = 'ec-pill-mini';
    }
  }
}

async function publishPresenceTx() {
  try {
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
  }
}

async function renderDirectoryAndRecents() {
  const myId = getMyIdentityOrEoa();
  const dirEl = document.getElementById('peerDirectoryList');
  if (dirEl) {
    const others = directoryProfiles.filter((p) => p.identity !== myId);
    if (directoryProfiles.length === 0) {
      dirEl.innerHTML = `<div class="ec-empty">No peers published yet — click “Publish E2EE Presence” above!</div>`;
    } else {
      const listToShow = others.length > 0 ? others : directoryProfiles;
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

      dirEl.querySelectorAll('[data-dial-voice]').forEach((btn) => {
        btn.addEventListener('click', () => placeCallTx(btn.getAttribute('data-dial-voice'), RTC_MEDIA_KIND.VOICE));
      });
      dirEl.querySelectorAll('[data-dial-video]').forEach((btn) => {
        btn.addEventListener('click', () => placeCallTx(btn.getAttribute('data-dial-video'), RTC_MEDIA_KIND.VIDEO));
      });
    }
  }

  const recEl = document.getElementById('recentCallsList');
  if (recEl) {
    if (!recentCalls.length) {
      recEl.innerHTML = `<div class="ec-empty">No recent calls for this Identity.</div>`;
    } else {
      const rows = await Promise.all(
        recentCalls.slice(0, 8).map(async (c) => {
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
      recEl.querySelectorAll('[data-redial]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-redial');
          const kind = Number(btn.getAttribute('data-kind')) || RTC_MEDIA_KIND.VIDEO;
          placeCallTx(target, kind);
        });
      });
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
  const callee = String(rawPeerAddr || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(callee)) {
    setStatus('Enter a valid 20-byte 0x… peer Identity address to dial.', true);
    return;
  }

  try {
    cleanupDirectCallUi('Preparing Encrypted Call…', 'Acquiring camera/microphone & gathering ICE candidates…');
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    if (myId === callee) {
      setStatus('Cannot dial your own Identity — use 🧪 Loopback Test or open an Incognito tab!', true);
      cleanupDirectCallUi();
      return;
    }

    const stream = await ensureLocalStream(mediaKind);
    const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);
    const peerProfile = await rtcClient.getPeerProfile(callee);
    const peerPub64 = peerProfile?.pub64 || null;

    peerSession = new SlxWebRtcPeerSession({
      localStream: stream,
      isInitiator: true,
      onRemoteStream: (remStream) => {
        const rv = document.getElementById('remoteVideo');
        if (rv) rv.srcObject = remStream;
        if (mediaKind !== RTC_MEDIA_KIND.VOICE) {
          document.getElementById('stageCenterOverlay').classList.add('hidden');
        }
      },
      onTrickleCandidates: (batch) => {
        if (activeCallId) sendTrickleBatchOnChain(activeCallId, myId, batch, peerPub64);
      },
      onConnectionState: ({ connectionState }) => {
        document.getElementById('hudCallState').textContent = `🟢 ${connectionState}`;
      },
      onDataMessage: (msg) => {
        appendChatBubble({ sender: msg.sender || shortAddr(callee), text: msg.text, mine: false, ts: msg.ts });
      },
    });

    setStatus('Gathering local host/STUN ICE & sealing SDP Offer…');
    const offerBundle = await peerSession.createBundledOffer({ iceWaitMs: 900 });
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

    setStatus(`Ringing ${shortAddr(callee)} on Subnet 1 (${sealedOffer.wireBytes} B Offer)…`);
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

    const peerName = await resolveDisplayName(callee);
    document.getElementById('hudCallState').textContent = `🔔 Ringing #${callId}`;
    document.getElementById('stageHeadline').textContent = `Calling ${peerName}…`;
    document.getElementById('stageSubline').textContent =
      `Waiting for ${shortAddr(callee)} to accept on-chain • DTLS Fingerprint pinned.`;
    document.getElementById('btnHangup').disabled = false;

    updateInspector({
      envelopeLabel: `${sealedOffer.rawJsonBytes} B → ${sealedOffer.wireBytes} B`,
      cipherLabel: sealedOffer.encrypted ? 'secp256k1 ECDH + Gzip' : 'Gzip + DTLS Pinned',
      callerFp: offerBundle.dtlsFp,
      calleeFp: ZERO_BYTES32,
      mitmStatus: 'Awaiting Callee DTLS-256…',
    });

    setStatus(`🔔 Call #${callId} ringing ${peerName} — waiting for Answer…`);
    startStatsLoop();
  } catch (err) {
    cleanupDirectCallUi();
    setStatus(err?.message || String(err), true);
  }
}

async function acceptIncomingCallTx(acceptMediaKind) {
  if (!ringingCallMeta) return;
  const callId = ringingCallMeta.callId;
  ringtone.stop();
  document.getElementById('incomingCallBanner').style.display = 'none';

  try {
    setStatus(`Opening Call #${callId} Offer & verifying Caller DTLS-SRTP fingerprint…`);
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'EtherCall WebRTC' });
    const myId = (idRec?.identityAddr || wallet.keypair.address).toLowerCase();
    const myKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, myId);

    const session = await rtcClient.getCallSession(callId);
    if (!session || session.status !== RTC_CALL_STATUS.RINGING) {
      setStatus(`Call #${callId} is no longer ringing.`, true);
      ringingCallMeta = null;
      return;
    }

    const openedOffer = await openRtcSignalEnvelope(session.offerEnvelope, {
      signalPrivHex: myKeys.signalPrivHex,
    });
    if (!openedOffer?.payload?.sdp) {
      throw new Error('Could not decrypt Offer envelope — ensure your E2EE profile matches this Identity.');
    }

    const callerPub64 = openedOffer.payload.senderPub33
      ? decompressSecp256k1Compressed33(openedOffer.payload.senderPub33)
      : (await rtcClient.getPeerProfile(session.caller))?.pub64 || null;

    const stream = await ensureLocalStream(acceptMediaKind);
    peerSession = new SlxWebRtcPeerSession({
      localStream: stream,
      isInitiator: false,
      onRemoteStream: (remStream) => {
        const rv = document.getElementById('remoteVideo');
        if (rv) rv.srcObject = remStream;
        if (acceptMediaKind !== RTC_MEDIA_KIND.VOICE) {
          document.getElementById('stageCenterOverlay').classList.add('hidden');
        }
      },
      onTrickleCandidates: (batch) => {
        if (activeCallId) sendTrickleBatchOnChain(activeCallId, myId, batch, callerPub64);
      },
      onConnectionState: ({ connectionState }) => {
        document.getElementById('hudCallState').textContent = `🟢 ${connectionState}`;
      },
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
      { iceWaitMs: 900 }
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

    setStatus(`Submitting encrypted SDP Answer (${sealedAnswer.wireBytes} B) for Call #${callId}…`);
    await rtcClient.answerCall({
      wallet,
      callId,
      calleeIdentity: myId,
      calleeDtlsFp: answerBundle.dtlsFp,
      answerEnvelopeBytes: sealedAnswer.bytes,
    });

    activeCallId = callId;
    activeCallMeta = session;
    answerApplied = true;
    ringingCallMeta = null;

    document.getElementById('hudCallState').textContent = `🟢 Call #${callId} Active`;
    document.getElementById('hudDtlsBadge').style.display = 'inline-flex';
    document.getElementById('btnHangup').disabled = false;
    document.getElementById('stageHeadline').textContent =
      `Connected with ${await resolveDisplayName(session.caller)}`;
    document.getElementById('stageSubline').textContent = 'Direct DTLS-SRTP Voice Stream Active';

    updateInspector({
      envelopeLabel: `${sealedAnswer.rawJsonBytes} B → ${sealedAnswer.wireBytes} B`,
      cipherLabel: sealedAnswer.encrypted ? 'secp256k1 ECDH + Gzip' : 'Gzip + DTLS Pinned',
      callerFp: session.callerDtlsFp,
      calleeFp: answerBundle.dtlsFp,
      mitmStatus: '✅ Verified (Zero-CA Match)',
      mitmOk: true,
    });

    setStatus(`🟢 Connected P2P with ${shortAddr(session.caller)} — DTLS-SRTP verified!`);
    startStatsLoop();
  } catch (err) {
    cleanupDirectCallUi();
    setStatus(err?.message || String(err), true);
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
      document.getElementById('hudCallState').textContent = `🟢 Call #${sess.callId} Active`;
      document.getElementById('hudDtlsBadge').style.display = 'inline-flex';
      updateInspector({
        callerFp: sess.callerDtlsFp,
        calleeFp: sess.calleeDtlsFp,
        mitmStatus: '✅ Verified (Zero-CA Match)',
        mitmOk: true,
      });
      setStatus(`🟢 Peer accepted Call #${sess.callId} — P2P DTLS-SRTP media live!`);
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
  if (activeCallId || loopbackHandle) return;
  const myId = getMyIdentityOrEoa();
  if (!myId) return;

  const incoming = recentCalls.find(
    (c) =>
      c.callee === myId &&
      c.status === RTC_CALL_STATUS.RINGING &&
      !dismissedCallIds.has(c.callId)
  );

  const banner = document.getElementById('incomingCallBanner');
  if (!incoming) {
    if (ringingCallMeta) {
      ringingCallMeta = null;
      ringtone.stop();
      if (banner) banner.style.display = 'none';
    }
    return;
  }

  ringingCallMeta = incoming;
  const callerName = await resolveDisplayName(incoming.caller);
  document.getElementById('incomingCallerTitle').textContent =
    `Incoming ${incoming.mediaLabel} from ${callerName} (#${incoming.callId})`;
  document.getElementById('incomingCallerMeta').textContent =
    `Caller Identity: ${shortAddr(incoming.caller)} • On-Chain DTLS-256: ${shortHex(incoming.callerDtlsFp, 8, 6)}`;
  if (banner) banner.style.display = 'flex';
  ringtone.start();
}

// ============================================================================
// 3. 1-Click Local P2P Loopback Self-Test
// ============================================================================

async function runLoopbackSelfTest() {
  try {
    setStageTab('direct');
    cleanupDirectCallUi('Starting Loopback Verification…');
    const stream = await ensureLocalStream(RTC_MEDIA_KIND.VIDEO);
    const myId = getMyIdentityOrEoa();

    loopbackHandle = await createLocalLoopbackPair({
      localStream: stream,
      callerWalletPrivHex: wallet.keypair.privateKey,
      callerIdentity: myId || '0x00000000000000000000000000000000000a11ce',
      onRemoteStream: (remStream) => {
        const rv = document.getElementById('remoteVideo');
        if (rv) rv.srcObject = remStream;
        document.getElementById('stageCenterOverlay').classList.add('hidden');
      },
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
  }
}

// ============================================================================
// 4. Multi-Peer Mesh Conference Rooms (Up to 6 Peers)
// ============================================================================

function renderRoomsList() {
  const box = document.getElementById('roomsList');
  if (!box) return;
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

  box.querySelectorAll('[data-join-room]').forEach((btn) => {
    btn.addEventListener('click', () => joinMeshRoomTx(Number(btn.getAttribute('data-join-room'))));
  });
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
  if (vid && vid.srcObject !== streamObj) vid.srcObject = streamObj;
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
    const stream = await ensureLocalStream(mediaKind);

    // Probe local DTLS fingerprint once for room membership entry
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

    const stream = await ensureLocalStream(rm.mediaKind);
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
  const rm = await rtcClient.getRoomState(joinedRoomId);
  if (!rm || !rm.isOpen) return;
  activeRoomState = rm;

  document.getElementById('activeRoomHeader').textContent =
    `🏛️ Room #${rm.roomId}: ${rm.title} (${rm.peerCount}/6 peers)`;

  const stream = await ensureLocalStream(rm.mediaKind);
  ensureMeshTile(myId, `You (${shortAddr(myId)})`, stream, true);

  for (const peer of rm.peers) {
    if (peer.identity === myId) continue;
    const peerId = peer.identity;
    let entry = meshPeers.get(peerId);
    const amInitiator = myId < peerId;

    if (!entry) {
      const peerLabel = await resolveDisplayName(peerId);
      const sess = new SlxWebRtcPeerSession({
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
      const offer = await entry.session.createBundledOffer({ iceWaitMs: 750 });
      const env = await sealRtcSignalEnvelope({
        v: 1,
        type: 'offer',
        sdp: offer.sdp,
        candidates: offer.candidates,
        dtlsFp: offer.dtlsFp,
        ts: Date.now(),
      });
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
      const opened = await openRtcSignalEnvelope(inbound.envelope);
      const pay = opened?.payload;
      if (pay?.type === 'offer' && !amInitiator) {
        const expectedFp = pay.dtlsFp || peer.dtlsFp;
        const ans = await entry.session.acceptOfferAndCreateBundledAnswer(pay, expectedFp, { iceWaitMs: 750 });
        const sealedAns = await sealRtcSignalEnvelope({
          v: 1,
          type: 'answer',
          sdp: ans.sdp,
          candidates: ans.candidates,
          dtlsFp: ans.dtlsFp,
          ts: Date.now(),
        });
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
// 5. Synchronization & Boot Wiring
// ============================================================================

async function syncState() {
  if (syncInFlight) return;
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
  } catch {
    // node reconnecting
  } finally {
    syncInFlight = false;
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
    pollIntervalMs: 3000,
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
    if (localStream && previewOnly) {
      stopCallMediaStream(localStream);
      localStream = null;
      previewOnly = false;
      document.getElementById('localVideo').srcObject = null;
      document.getElementById('localPipTag').textContent = 'You (Preview Off)';
      return;
    }
    await ensureLocalStream(RTC_MEDIA_KIND.VIDEO);
    previewOnly = !activeCallId && !loopbackHandle;
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
      document.getElementById('localVideo').srcObject = res.stream;
      document.getElementById('localPipTag').textContent = 'You (Screen)';
      setStatus('🖥️ Sharing screen over P2P DTLS-SRTP track!');
      screenTrack.onended = async () => {
        if (localStream && localStream.getVideoTracks()[0] && activeSess) {
          await activeSess.replaceVideoTrack(localStream.getVideoTracks()[0]);
          document.getElementById('localVideo').srcObject = localStream;
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
