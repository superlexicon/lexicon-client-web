/**
 * TransitDEX — Multi-Regime Discrete-Time All-Or-Nothing (AON) Ride Service Futures Exchange
 * (`app-sources/rides/app.js`, SuperLexicon HFS)
 *
 * Implements:
 *  - Single-Metro 6-Regime Price-Sorted Order Books (`CBD`, `Fringe`, `Changi`, `Remote`, `Jurong`, `Heartland`)
 *  - Meter-at-Pickup (`Q_billed = L_trip` Only) + All-Or-Nothing (`L_pickup + L_trip <= d.max_distance`)
 *  - Resting-Maker Clearing Rate + Clean Rate vs. Statutory Toll Pass-Through Invoice
 *  - Physically-Settled Service Futures Escrow (released only when Customer signs `completeRide`)
 */

import {
  ZERO_ADDR,
  shortAddr,
  SlxWalletManager,
  getDefaultNodeWsUrl,
  slxNodeRpc,
  readOnChainIdentityNickname,
  slxWatchChainApp,
  SG_REGIMES,
  SG_LANDMARKS,
  RIDE_ORDER_STATUS,
  RIDE_FUTURES_STATUS,
  RIDE_MAKER_SIDE,
  RIDE_EXCHANGE_TOPICS,
  RideExchangeAbi,
  RideExchangeClient,
  classifySgRegime,
  computeRoadDistanceM,
  computeTripFareCeilCents,
  computeDefaultSgTollCents,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';

// Map viewport bounds covering all of Singapore Island, Sentosa & Tuas (920 x 500 SVG)
const MAP_BOUNDS = {
  minLon: 103.605,
  maxLon: 104.035,
  minLat: 1.232,
  maxLat: 1.462,
  w: 920,
  h: 500,
};

// Realistic simplified Singapore Mainland + Sentosa + Jurong Island coastline coordinates (lon, lat)
const SG_MAINLAND_RING = [
  [103.622, 1.262],
  [103.616, 1.312],
  [103.638, 1.345],
  [103.666, 1.398],
  [103.702, 1.434],
  [103.758, 1.448],
  [103.805, 1.454],
  [103.852, 1.444],
  [103.884, 1.422],
  [103.914, 1.414],
  [103.962, 1.392],
  [104.008, 1.378],
  [104.018, 1.344],
  [103.992, 1.318],
  [103.942, 1.306],
  [103.888, 1.294],
  [103.864, 1.274],
  [103.834, 1.265],
  [103.788, 1.276],
  [103.742, 1.296],
  [103.694, 1.298],
  [103.652, 1.288],
  [103.636, 1.244],
];

const SG_SENTOSA_RING = [
  [103.809, 1.259],
  [103.826, 1.261],
  [103.839, 1.249],
  [103.829, 1.241],
  [103.812, 1.247],
];

const SG_JURONG_ISLAND_RING = [
  [103.666, 1.278],
  [103.715, 1.282],
  [103.726, 1.262],
  [103.684, 1.253],
  [103.661, 1.264],
];

function projectGeo(lat, lon) {
  const x = ((lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon)) * MAP_BOUNDS.w;
  const y =
    MAP_BOUNDS.h -
    ((lat - MAP_BOUNDS.minLat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) * MAP_BOUNDS.h;
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
}

function unprojectSvg(svgX, svgY) {
  const lon = MAP_BOUNDS.minLon + (svgX / MAP_BOUNDS.w) * (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon);
  const lat =
    MAP_BOUNDS.minLat + ((MAP_BOUNDS.h - svgY) / MAP_BOUNDS.h) * (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat);
  return {
    lat: Number(Math.max(1.236, Math.min(1.456, lat)).toFixed(5)),
    lon: Number(Math.max(103.612, Math.min(104.025, lon)).toFixed(5)),
  };
}

function ringToPath(ring) {
  return (
    ring
      .map(([lon, lat], idx) => {
        const [x, y] = projectGeo(lat, lon);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ') + ' Z'
  );
}

function fmtSgd(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function fmtKm(meters) {
  return `${(Number(meters || 0) / 1000).toFixed(1)} km`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const wallet = new SlxWalletManager({ storagePrefix: 'slx_wallet' });
let rpcUrl = getDefaultNodeWsUrl();
const rxClient = new RideExchangeClient({ rpcUrlFn: () => rpcUrl });

const nickCache = new Map();

const state = {
  busy: false,
  selectedRegime: -1, // -1 = All 6 Regimes
  ticketMode: 'rider', // 'rider' | 'driver'
  mapClickMode: 'from', // 'from' | 'to' | 'driver'
  fromCoord: { lat: SG_LANDMARKS[0].lat, lon: SG_LANDMARKS[0].lon, label: SG_LANDMARKS[0].label },
  toCoord: { lat: SG_LANDMARKS[7].lat, lon: SG_LANDMARKS[7].lon, label: SG_LANDMARKS[7].label },
  driverCoord: { lat: SG_LANDMARKS[1].lat, lon: SG_LANDMARKS[1].lon, label: SG_LANDMARKS[1].label },
  destMask: 0x3f,
  snap: null,
  autoClearAfterBlock: 0,
  autoClearBusy: false,
};

function showBanner(html, tone = 'info') {
  const el = document.getElementById('rxBanner');
  if (!el) return;
  el.className = `rx-banner ${tone}`;
  el.innerHTML = html;
  el.style.display = 'block';
}

function resolveDisplayTag(identityAddr) {
  if (!identityAddr || identityAddr === ZERO_ADDR) return '—';
  const k = identityAddr.toLowerCase();
  if (nickCache.has(k)) return nickCache.get(k);
  const fallback = shortAddr(k);
  nickCache.set(k, fallback);
  readOnChainIdentityNickname(rpcUrl, k)
    .then((nick) => {
      if (nick) {
        nickCache.set(k, `${nick} · ${k.slice(2, 6)}`);
        renderTablesAndActivePosition();
      }
    })
    .catch(() => {});
  return fallback;
}

function getTollCents(origRegime, destRegime) {
  const mat = state.snap?.overview?.tollMatrix;
  if (mat && mat[origRegime] && typeof mat[origRegime][destRegime] === 'number') {
    return mat[origRegime][destRegime];
  }
  return computeDefaultSgTollCents(origRegime, destRegime);
}

function findBestFeasibleAskForRoute(fromLat, fromLon, toLat, toLon, maxPickupM) {
  const asks = state.snap?.asks || [];
  const origReg = classifySgRegime(fromLat, fromLon);
  const destReg = classifySgRegime(toLat, toLon);
  const tripM = computeRoadDistanceM(fromLat, fromLon, toLat, toLon);
  let best = null;

  for (const a of asks) {
    if (a.regime !== origReg && !a.crossBorder) continue;
    if ((a.destMask & (1 << destReg)) === 0) continue;
    const pickupM = computeRoadDistanceM(a.lat, a.lon, fromLat, fromLon);
    if (pickupM > maxPickupM || pickupM > a.maxPickupM) continue;
    if (pickupM + tripM > a.maxDistanceM) continue;
    const effCents = a.askPerKmCents + (destReg === 3 ? a.remoteBasisCents : 0);
    if (
      !best ||
      effCents < best.effCents ||
      (effCents === best.effCents && pickupM < best.pickupM)
    ) {
      best = { ask: a, effCents, pickupM, tripM };
    }
  }
  return best;
}

function populateLandmarkSelects() {
  const optsHtml =
    SG_LANDMARKS.map((lm) => {
      const reg = SG_REGIMES[lm.regime];
      return `<option value="${lm.id}">${reg.icon} [${reg.code}] ${escapeHtml(lm.label)}</option>`;
    }).join('') + `<option value="__custom__">📍 Map Custom Pin</option>`;

  const sFrom = document.getElementById('selRiderFrom');
  const sTo = document.getElementById('selRiderTo');
  const sDrv = document.getElementById('selDriverLoc');
  sFrom.innerHTML = optsHtml;
  sTo.innerHTML = optsHtml;
  sDrv.innerHTML = optsHtml;

  sFrom.value = 'mbs';
  sTo.value = 'changi_t3';
  sDrv.value = 'raffles';

  const maskWrap = document.getElementById('driverDestMaskGroup');
  maskWrap.innerHTML = SG_REGIMES.map(
    (r) => `
      <label class="rx-dest-chip">
        <input type="checkbox" data-dest-bit="${r.id}" checked />
        <span>${r.icon} ${r.code}</span>
      </label>
    `
  ).join('');
}

function updateTicketPreviews() {
  const origReg = classifySgRegime(state.fromCoord.lat, state.fromCoord.lon);
  const destReg = classifySgRegime(state.toCoord.lat, state.toCoord.lon);
  const drvReg = classifySgRegime(state.driverCoord.lat, state.driverCoord.lon);

  const rOrig = SG_REGIMES[origReg];
  const rDest = SG_REGIMES[destReg];
  const rDrv = SG_REGIMES[drvReg];

  document.getElementById('lblRiderFromMeta').textContent =
    `${rOrig.icon} ${rOrig.shortLabel} (${state.fromCoord.lat.toFixed(4)}, ${state.fromCoord.lon.toFixed(4)})`;
  document.getElementById('lblRiderToMeta').textContent =
    `${rDest.icon} ${rDest.shortLabel} (${state.toCoord.lat.toFixed(4)}, ${state.toCoord.lon.toFixed(4)})`;
  document.getElementById('lblDriverLocMeta').textContent =
    `${rDrv.icon} ${rDrv.shortLabel} (${state.driverCoord.lat.toFixed(4)}, ${state.driverCoord.lon.toFixed(4)})`;

  const tripM = computeRoadDistanceM(
    state.fromCoord.lat,
    state.fromCoord.lon,
    state.toCoord.lat,
    state.toCoord.lon
  );
  const maxPickupM = Math.round(Number(document.getElementById('inpRiderMaxPickupKm').value || 4.5) * 1000);
  const bidPerKmCents = Math.round(Number(document.getElementById('inpBidPerKm').value || 1.8) * 100);
  const tollCents = getTollCents(origReg, destReg);
  const cleanMaxCents = computeTripFareCeilCents(bidPerKmCents, tripM);
  const totalEscrowCents = cleanMaxCents + tollCents;

  const bestFeasible = findBestFeasibleAskForRoute(
    state.fromCoord.lat,
    state.fromCoord.lon,
    state.toCoord.lat,
    state.toCoord.lon,
    maxPickupM
  );

  document.getElementById('riderRouteMetrics').innerHTML = `
    <div>
      <div style="color:#94a3b8;font-size:10px;">METERED TRIP (Q_billed)</div>
      <div style="font-weight:800;color:#f8fafc;">${fmtKm(tripM)}</div>
    </div>
    <div>
      <div style="color:#94a3b8;font-size:10px;">REGIME CORRIDOR</div>
      <div style="font-weight:800;color:#7dd3fc;">${rOrig.code} &rarr; ${rDest.code}</div>
    </div>
    <div>
      <div style="color:#94a3b8;font-size:10px;">BEST AON ASK IN RANGE</div>
      <div style="font-weight:800;color:${bestFeasible ? '#34d399' : '#fbbf24'};">
        ${bestFeasible ? `${fmtSgd(bestFeasible.effCents)}/km (${fmtKm(bestFeasible.pickupM)} away)` : 'No car in range yet'}
      </div>
    </div>
  `;

  const makerPreviewTxt =
    bestFeasible && bidPerKmCents >= bestFeasible.effCents
      ? `Crosses resting car @ <strong>${fmtSgd(bestFeasible.effCents)}/km</strong> &rarr; Est. Maker Total <strong>${fmtSgd(computeTripFareCeilCents(bestFeasible.effCents, tripM) + tollCents)}</strong> (excess refunded on match!)`
      : `Rests in <strong>${rOrig.shortLabel}</strong> Bid Book until crossed by an AON car`;

  document.getElementById('riderInvoiceBox').innerHTML = `
    <div class="rx-inv-line">
      <span>Clean Max Fare (${fmtKm(tripM)} &times; ${fmtSgd(bidPerKmCents)}/km, 0m pickup billed)</span>
      <strong>${fmtSgd(cleanMaxCents)}</strong>
    </div>
    <div class="rx-inv-line">
      <span>Statutory Toll Pass-Through (${rOrig.code} &rarr; ${rDest.code})</span>
      <strong>${fmtSgd(tollCents)}</strong>
    </div>
    <div class="rx-inv-total">
      <span>Upfront Futures Margin Escrow</span>
      <span>${fmtSgd(totalEscrowCents)} SGD</span>
    </div>
    <div style="font-size:10.5px;color:#93c5fd;margin-top:2px;">${makerPreviewTxt}</div>
  `;

  renderSingaporeRadarSvg();
}

function renderKpisAndRegimeStrip() {
  const ov = state.snap?.overview;
  const myId = wallet.getIdentityRecord()?.identityAddr?.toLowerCase() || '';

  document.getElementById('kpiMetroName').textContent = ov?.metroName || 'Singapore Metro';
  document.getElementById('kpiExchAddr').textContent = state.snap?.exchangeAddr
    ? `HFS ${shortAddr(state.snap.exchangeAddr)} • Quote ${shortAddr(ov?.quoteLedger || '')}`
    : 'Not deployed';

  document.getElementById('kpiMyBalance').textContent = `${fmtSgd(state.snap?.myBalanceCents || 0)} SGD`;
  document.getElementById('kpiMyIdentity').textContent = myId
    ? `Identity ${resolveDisplayTag(myId)}`
    : 'No Identity HFS yet';

  const asks = state.snap?.asks || [];
  const bids = state.snap?.bids || [];
  const pendingCnt =
    asks.filter((a) => a.status === RIDE_ORDER_STATUS.PENDING).length +
    bids.filter((b) => b.status === RIDE_ORDER_STATUS.PENDING).length;

  document.getElementById('kpiLockedEscrow').textContent = `${fmtSgd(ov?.lockedEscrowCents || 0)} SGD`;
  document.getElementById('kpiBookCounts').textContent =
    `${bids.length} Bids • ${asks.length} Cars${pendingCnt ? ` (+${pendingCnt} intake)` : ''}`;

  document.getElementById('kpiSettledVol').textContent = `${fmtSgd(ov?.settledVolumeCents || 0)} SGD`;
  document.getElementById('kpiFuturesStats').textContent =
    `${ov?.settledFuturesCount || 0} Delivered / ${ov?.totalFutures || 0} Matched`;

  // 6-Regime Strip (+ "All 6" tile)
  const allActive = state.selectedRegime === -1 ? 'active' : '';
  let stripHtml = `
    <button type="button" class="rx-reg-tile ${allActive}" data-select-regime="-1">
      <div class="rx-reg-top">
        <span>🌐 ALL REGIMES</span>
        <span class="mono" style="color:#38bdf8;">6 BOOKS</span>
      </div>
      <div class="rx-reg-rates">${bids.length}B &times; ${asks.length}A</div>
      <div class="rx-reg-meta">Metro-wide AON Pool</div>
    </button>
  `;

  for (const r of SG_REGIMES) {
    const rs = ov?.regimes?.[r.id] || {
      bidCount: 0,
      askCount: 0,
      pendingCount: 0,
      bestBidPerKmCents: 0,
      bestAskPerKmCents: 0,
      lastClearingPerKmCents: 0,
    };
    const bb = rs.bestBidPerKmCents ? fmtSgd(rs.bestBidPerKmCents) : '—';
    const ba = rs.bestAskPerKmCents ? fmtSgd(rs.bestAskPerKmCents) : '—';
    const cls = state.selectedRegime === r.id ? 'active' : '';
    stripHtml += `
      <button type="button" class="rx-reg-tile ${cls}" data-select-regime="${r.id}">
        <div class="rx-reg-top">
          <span>${r.icon} ${escapeHtml(r.shortLabel)}</span>
          <span style="color:${r.color};font-size:10px;">${r.code}</span>
        </div>
        <div class="rx-reg-rates">
          <span class="rx-emerald">${bb}</span>
          <span style="color:#64748b;">&times;</span>
          <span class="rx-rose">${ba}</span>
        </div>
        <div class="rx-reg-meta">
          ${rs.bidCount}B / ${rs.askCount}A${rs.pendingCount ? ` • +${rs.pendingCount}P` : ''}
        </div>
      </button>
    `;
  }
  document.getElementById('regimeTickerStrip').innerHTML = stripHtml;

  const badge = document.getElementById('lblSelectedRegimeBadge');
  badge.textContent =
    state.selectedRegime === -1
      ? 'ALL 6 REGIMES'
      : `${SG_REGIMES[state.selectedRegime].icon} ${SG_REGIMES[state.selectedRegime].name.toUpperCase()}`;

  // Toggle "Cancel My Active Driver Ask" button visibility
  const cancelAskBtn = document.getElementById('btnCancelMyAsk');
  if (cancelAskBtn) {
    cancelAskBtn.style.display = state.snap?.actor?.activeAskId ? 'block' : 'none';
  }
}

function renderSingaporeRadarSvg() {
  const svg = document.getElementById('sgRadarSvg');
  if (!svg) return;

  const parts = [];
  // Ocean background & tactical graticule
  parts.push(`<rect x="0" y="0" width="${MAP_BOUNDS.w}" height="${MAP_BOUNDS.h}" fill="#030814" />`);
  for (let lon = 103.65; lon <= 104.01; lon += 0.05) {
    const [x] = projectGeo(1.3, lon);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${MAP_BOUNDS.h}" stroke="rgba(30,58,138,0.22)" stroke-width="1" />`);
  }
  for (let lat = 1.25; lat <= 1.45; lat += 0.05) {
    const [, y] = projectGeo(lat, 103.8);
    parts.push(`<line x1="0" y1="${y}" x2="${MAP_BOUNDS.w}" y2="${y}" stroke="rgba(30,58,138,0.22)" stroke-width="1" />`);
  }

  // Landmasses
  parts.push(
    `<path d="${ringToPath(SG_MAINLAND_RING)}" fill="#0d1b30" stroke="rgba(56,189,248,0.35)" stroke-width="1.6" />`,
    `<path d="${ringToPath(SG_SENTOSA_RING)}" fill="#12233d" stroke="rgba(244,63,94,0.45)" stroke-width="1.2" />`,
    `<path d="${ringToPath(SG_JURONG_ISLAND_RING)}" fill="#102038" stroke="rgba(244,63,94,0.35)" stroke-width="1.2" />`
  );

  // Translucent Price Regime Boxes & Callout Labels
  for (const r of SG_REGIMES) {
    const [x1, y1] = projectGeo(r.box.maxLat, r.box.minLon);
    const [x2, y2] = projectGeo(r.box.minLat, r.box.maxLon);
    const rw = Math.max(24, x2 - x1);
    const rh = Math.max(18, y2 - y1);
    const isSel = state.selectedRegime === r.id;
    parts.push(
      `<rect x="${x1}" y="${y1}" width="${rw}" height="${rh}" rx="8" fill="${r.color}" fill-opacity="${isSel ? '0.16' : '0.06'}" stroke="${r.color}" stroke-opacity="${isSel ? '0.85' : '0.32'}" stroke-dasharray="4,4" stroke-width="${isSel ? '1.8' : '1'}" />`
    );
    const [cx, cy] = projectGeo(r.center.lat, r.center.lon);
    const rs = state.snap?.overview?.regimes?.[r.id];
    const askTxt = rs?.bestAskPerKmCents ? `${fmtSgd(rs.bestAskPerKmCents)}/km` : '—';
    parts.push(
      `<g transform="translate(${cx},${cy - 14})" pointer-events="none">
        <rect x="-46" y="-10" width="92" height="17" rx="5" fill="rgba(4,9,20,0.82)" stroke="${r.color}" stroke-opacity="0.55" />
        <text x="0" y="2" text-anchor="middle" fill="${r.color}" font-family="JetBrains Mono,monospace" font-size="9.5" font-weight="800">${r.code} ${askTxt}</text>
      </g>`
    );
  }

  // Open Customer Bid Route Vectors
  for (const b of state.snap?.bids || []) {
    if (state.selectedRegime !== -1 && b.origRegime !== state.selectedRegime) continue;
    const [x1, y1] = projectGeo(b.fromLat, b.fromLon);
    const [x2, y2] = projectGeo(b.toLat, b.toLon);
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#38bdf8" stroke-opacity="0.65" stroke-width="1.8" stroke-dasharray="5,4" />`,
      `<circle cx="${x1}" cy="${y1}" r="5.5" fill="#0ea5e9" stroke="#e0f2fe" stroke-width="1.3" data-tip="Customer Bid #${b.orderId}: ${fmtSgd(b.bidPerKmCents)}/km • ${fmtKm(b.tripM)} • Escrow ${fmtSgd(b.escrowedCents)}" />`
    );
  }

  // Active Matched / In-Progress Ride Futures Vectors
  for (const f of state.snap?.futures || []) {
    if (f.status !== RIDE_FUTURES_STATUS.MATCHED && f.status !== RIDE_FUTURES_STATUS.IN_PROGRESS) {
      continue;
    }
    const [dx, dy] = projectGeo(f.driverStartLat, f.driverStartLon);
    const [px, py] = projectGeo(f.fromLat, f.fromLon);
    const [tx, ty] = projectGeo(f.toLat, f.toLon);
    parts.push(
      `<line x1="${dx}" y1="${dy}" x2="${px}" y2="${py}" stroke="#fbbf24" stroke-opacity="0.7" stroke-width="1.5" stroke-dasharray="3,3" />`,
      `<line x1="${px}" y1="${py}" x2="${tx}" y2="${ty}" stroke="#fbbf24" stroke-width="2.4" />`,
      `<circle cx="${px}" cy="${py}" r="5" fill="#fbbf24" stroke="#050b16" stroke-width="1.5" data-tip="Futures #${f.futuresId} (${f.status === 2 ? 'IN PROGRESS' : 'EN ROUTE'}): ${fmtSgd(f.clearingRateCents)}/km • Locked ${fmtSgd(f.totalCents)}" />`
    );
  }

  // Landmark Pins (clickable!)
  for (const lm of SG_LANDMARKS) {
    const [x, y] = projectGeo(lm.lat, lm.lon);
    parts.push(
      `<g class="rx-lm-pin" data-lm-id="${lm.id}" style="cursor:pointer;" data-tip="${escapeHtml(lm.label)} (${SG_REGIMES[lm.regime].shortLabel})">
        <circle cx="${x}" cy="${y}" r="3.4" fill="#94a3b8" stroke="#0f172a" stroke-width="1" />
      </g>`
    );
  }

  // Idle Driver Cars (`Ask` Orders)
  const myId = wallet.getIdentityRecord()?.identityAddr?.toLowerCase() || '';
  for (const a of state.snap?.asks || []) {
    if (state.selectedRegime !== -1 && a.regime !== state.selectedRegime) continue;
    const [x, y] = projectGeo(a.lat, a.lon);
    const isMine = myId && a.driverIdentity === myId;
    const fill = isMine ? '#fbbf24' : a.status === RIDE_ORDER_STATUS.PENDING ? '#a855f7' : '#10b981';
    parts.push(
      `<g transform="translate(${x},${y})" style="cursor:pointer;" data-pick-ask-rate="${(a.askPerKmCents / 100).toFixed(2)}" data-tip="Car #${a.orderId} (${resolveDisplayTag(a.driverIdentity)}): Ask ${fmtSgd(a.askPerKmCents)}/km • Max Range ${fmtKm(a.maxDistanceM)} • Max Approach ${fmtKm(a.maxPickupM)}">
        <circle r="8" fill="${fill}" fill-opacity="0.22" stroke="${fill}" stroke-width="1.5" />
        <circle r="4" fill="${fill}" />
      </g>`
    );
  }

  // Selected Ticket Route Overlay (Rider Mode vs Driver Mode)
  if (state.ticketMode === 'rider') {
    const [fx, fy] = projectGeo(state.fromCoord.lat, state.fromCoord.lon);
    const [tx, ty] = projectGeo(state.toCoord.lat, state.toCoord.lon);
    parts.push(
      `<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="#c084fc" stroke-width="2.6" stroke-dasharray="6,4" />`,
      `<g transform="translate(${fx},${fy})" pointer-events="none">
        <circle r="7.5" fill="#a855f7" stroke="#ffffff" stroke-width="2" />
        <text y="-11" text-anchor="middle" fill="#e9d5ff" font-family="JetBrains Mono,monospace" font-size="10" font-weight="800">FROM</text>
      </g>`,
      `<g transform="translate(${tx},${ty})" pointer-events="none">
        <circle r="7.5" fill="#ec4899" stroke="#ffffff" stroke-width="2" />
        <text y="-11" text-anchor="middle" fill="#fbcfe8" font-family="JetBrains Mono,monospace" font-size="10" font-weight="800">TO</text>
      </g>`
    );
  } else {
    const [dx, dy] = projectGeo(state.driverCoord.lat, state.driverCoord.lon);
    parts.push(
      `<g transform="translate(${dx},${dy})" pointer-events="none">
        <circle r="11" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="2" />
        <circle r="4.5" fill="#fbbf24" />
        <text y="-14" text-anchor="middle" fill="#fde68a" font-family="JetBrains Mono,monospace" font-size="10" font-weight="800">MY CAR</text>
      </g>`
    );
  }

  svg.innerHTML = parts.join('');
}

function renderTablesAndActivePosition() {
  const myId = wallet.getIdentityRecord()?.identityAddr?.toLowerCase() || '';
  const asks = state.snap?.asks || [];
  const bids = state.snap?.bids || [];
  const futures = state.snap?.futures || [];
  const actor = state.snap?.actor || {};

  // 1. Active User Position / Service Futures Settlement Card
  const activeWrap = document.getElementById('myActiveFuturesWrap');
  const myFutId = actor.activeRiderFuturesId || actor.activeDriverFuturesId || 0;
  const myFut = myFutId ? futures.find((f) => f.futuresId === myFutId) : null;
  const myBid = actor.activeBidId ? bids.find((b) => b.orderId === actor.activeBidId) : null;

  if (myFut && (myFut.status === RIDE_FUTURES_STATUS.MATCHED || myFut.status === RIDE_FUTURES_STATUS.IN_PROGRESS)) {
    const iAmRider = myId && myFut.riderIdentity === myId;
    const origR = SG_REGIMES[myFut.origRegime] || SG_REGIMES[0];
    const destR = SG_REGIMES[myFut.destRegime] || SG_REGIMES[0];
    const stBadge =
      myFut.status === RIDE_FUTURES_STATUS.IN_PROGRESS
        ? `<span class="rx-badge-cyan">🚕 METER RUNNING (IN PROGRESS)</span>`
        : `<span class="rx-badge-amber">🔒 MATCHED — ESCROW LOCKED (DRIVER EN ROUTE)</span>`;

    activeWrap.style.display = 'block';
    activeWrap.innerHTML = `
      <div class="rx-active-fut-card">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong class="mono" style="font-size:13.5px;color:#6ee7b7;">📜 Service Futures Contract #${myFut.futuresId}</strong>
            ${stBadge}
            <span class="mono" style="font-size:11.5px;color:#cbd5e1;">
              ${origR.icon} ${origR.code} &rarr; ${destR.icon} ${destR.code} • Metered Trip <strong>${fmtKm(myFut.tripM)}</strong> (Unbilled Approach ${fmtKm(myFut.pickupM)})
            </span>
          </div>
          <div class="mono" style="font-size:12px;color:#e2e8f0;margin-top:5px;">
            Resting-Maker Rate: <strong>${fmtSgd(myFut.clearingRateCents)}/km</strong> (${myFut.makerSide === RIDE_MAKER_SIDE.DRIVER ? 'Driver Maker' : 'Rider Maker'})
            • Clean Fare <strong>${fmtSgd(myFut.cleanFareCents)}</strong> + Toll <strong>${fmtSgd(myFut.tollCents)}</strong>
            = Escrowed <strong>${fmtSgd(myFut.totalCents)} SGD</strong>
          </div>
          <div class="mono" style="font-size:11px;color:#94a3b8;margin-top:3px;">
            Passenger: ${escapeHtml(resolveDisplayTag(myFut.riderIdentity))} • Driver: ${escapeHtml(resolveDisplayTag(myFut.driverIdentity))}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${
            myFut.status === RIDE_FUTURES_STATUS.MATCHED
              ? `<button type="button" class="rx-btn rx-btn-cyan" data-confirm-pickup="${myFut.futuresId}">🚕 Confirm Boarding</button>`
              : ''
          }
          ${
            iAmRider
              ? `<button type="button" class="rx-btn rx-btn-emerald" data-complete-ride="${myFut.futuresId}">✅ Complete Ride &amp; Release ${fmtSgd(myFut.totalCents)} to Driver</button>`
              : `<span class="mono" style="font-size:11px;color:#fde68a;align-self:center;">⏳ Awaiting Passenger completeRide() signature to release ${fmtSgd(myFut.totalCents)}</span>`
          }
          ${
            myFut.status === RIDE_FUTURES_STATUS.MATCHED
              ? `<button type="button" class="rx-btn rx-btn-ghost" data-cancel-futures="${myFut.futuresId}">✕ Cancel</button>`
              : ''
          }
        </div>
      </div>
    `;
  } else if (myBid) {
    activeWrap.style.display = 'block';
    activeWrap.innerHTML = `
      <div class="rx-active-fut-card" style="border-color:rgba(56,189,248,0.55);">
        <div class="mono" style="font-size:12px;">
          <strong style="color:#7dd3fc;">🙋 Your Open Ride Bid #${myBid.orderId}</strong>
          (${myBid.status === RIDE_ORDER_STATUS.PENDING ? '⏳ Next-Block Intake' : '🟢 Active in Orderbook'}) •
          ${SG_REGIMES[myBid.origRegime]?.code} &rarr; ${SG_REGIMES[myBid.destRegime]?.code} (${fmtKm(myBid.tripM)}) @
          <strong>${fmtSgd(myBid.bidPerKmCents)}/km</strong> • Escrowed <strong>${fmtSgd(myBid.escrowedCents)}</strong>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="rx-btn rx-btn-amber" id="btnInlineMatchNow">⚡ Run matchBlock()</button>
          <button type="button" class="rx-btn rx-btn-ghost" data-cancel-bid="${myBid.orderId}">✕ Cancel &amp; Refund</button>
        </div>
      </div>
    `;
  } else {
    activeWrap.style.display = 'none';
    activeWrap.innerHTML = '';
  }

  // 2. Bids Table (Sorted `bidPerKmCents DESC`, `seniorityBlock ASC`)
  const filtBids = bids
    .filter((b) => state.selectedRegime === -1 || b.origRegime === state.selectedRegime)
    .slice()
    .sort((a, b) => b.bidPerKmCents - a.bidPerKmCents || a.seniorityBlock - b.seniorityBlock);

  document.getElementById('tbodyBids').innerHTML = filtBids.length
    ? filtBids
        .map((b) => {
          const orig = SG_REGIMES[b.origRegime] || SG_REGIMES[0];
          const dest = SG_REGIMES[b.destRegime] || SG_REGIMES[0];
          const isMine = myId && b.riderIdentity === myId;
          const pTag =
            b.status === RIDE_ORDER_STATUS.PENDING
              ? `<span style="color:#fbbf24;">⏳P</span>`
              : `<span style="color:#64748b;">#${b.seniorityBlock}</span>`;
          return `
            <tr>
              <td class="rx-emerald" style="font-weight:800;">${fmtSgd(b.bidPerKmCents)}/km</td>
              <td>${orig.icon}${orig.code}&rarr;${dest.code} (${fmtKm(b.tripM)})</td>
              <td>${fmtSgd(b.escrowedCents)}</td>
              <td>
                ${escapeHtml(resolveDisplayTag(b.riderIdentity))} ${pTag}
                ${isMine ? `<button type="button" class="rx-btn rx-btn-xs rx-btn-ghost" data-cancel-bid="${b.orderId}">✕</button>` : ''}
              </td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="4" style="color:#64748b;text-align:center;padding:18px;">No resting Rider Bids in selected regime</td></tr>`;

  // 3. Asks Table (Sorted `askPerKmCents ASC`, `seniorityBlock ASC`)
  const filtAsks = asks
    .filter((a) => state.selectedRegime === -1 || a.regime === state.selectedRegime)
    .slice()
    .sort((a, b) => a.askPerKmCents - b.askPerKmCents || a.seniorityBlock - b.seniorityBlock);

  document.getElementById('tbodyAsks').innerHTML = filtAsks.length
    ? filtAsks
        .map((a) => {
          const reg = SG_REGIMES[a.regime] || SG_REGIMES[0];
          const pTag =
            a.status === RIDE_ORDER_STATUS.PENDING
              ? `<span style="color:#fbbf24;">⏳P</span>`
              : `<span style="color:#64748b;">#${a.seniorityBlock}</span>`;
          return `
            <tr style="cursor:pointer;" data-pick-ask-rate="${(a.askPerKmCents / 100).toFixed(2)}" title="Click to copy Ask $/km into Bid Ticket">
              <td class="rx-rose" style="font-weight:800;">
                ${fmtSgd(a.askPerKmCents)}/km
                ${a.remoteBasisCents ? `<div style="font-size:9.5px;color:#94a3b8;">+${fmtSgd(a.remoteBasisCents)} REM</div>` : ''}
              </td>
              <td>${reg.icon}${reg.code} • &le;${fmtKm(a.maxDistanceM)}</td>
              <td>&le;${fmtKm(a.maxPickupM)}</td>
              <td>${escapeHtml(resolveDisplayTag(a.driverIdentity))} ${pTag}</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="4" style="color:#64748b;text-align:center;padding:18px;">No idle Driver Asks in selected regime</td></tr>`;

  // 4. Service Futures Tape
  document.getElementById('lblFuturesCountBadge').textContent =
    `${state.snap?.totalFutures || futures.length} Contracts`;

  document.getElementById('tbodyFutures').innerHTML = futures.length
    ? futures
        .map((f) => {
          const orig = SG_REGIMES[f.origRegime] || SG_REGIMES[0];
          const dest = SG_REGIMES[f.destRegime] || SG_REGIMES[0];
          const iAmRider = myId && f.riderIdentity === myId;
          let statusHtml = '';
          if (f.status === RIDE_FUTURES_STATUS.SETTLED) {
            statusHtml = `<span class="rx-emerald">✅ Settled (#${f.settledBlock})</span>`;
          } else if (f.status === RIDE_FUTURES_STATUS.CANCELLED) {
            statusHtml = `<span style="color:#94a3b8;">✕ Cancelled</span>`;
          } else if (iAmRider) {
            statusHtml = `<button type="button" class="rx-btn rx-btn-xs rx-btn-emerald" data-complete-ride="${f.futuresId}">✅ Complete &amp; Pay</button>`;
          } else {
            statusHtml = `<span class="rx-amber">${f.status === RIDE_FUTURES_STATUS.IN_PROGRESS ? '🚕 In Progress' : '🔒 Escrowed'}</span>`;
          }

          return `
            <tr>
              <td>#${f.futuresId}</td>
              <td>
                <div>${orig.icon}${orig.code}&rarr;${dest.icon}${dest.code} (${fmtKm(f.tripM)})</div>
                <div style="font-size:10px;color:#94a3b8;">
                  🙋 ${escapeHtml(resolveDisplayTag(f.riderIdentity))} &harr; 🚖 ${escapeHtml(resolveDisplayTag(f.driverIdentity))}
                </div>
              </td>
              <td>
                <div style="font-weight:800;">${fmtSgd(f.clearingRateCents)}/km</div>
                <div style="font-size:9.5px;color:#94a3b8;">
                  ${f.makerSide === RIDE_MAKER_SIDE.DRIVER ? 'Driver Maker' : 'Rider Maker'}
                </div>
              </td>
              <td>
                <div><strong>${fmtSgd(f.totalCents)}</strong></div>
                <div style="font-size:9.5px;color:#94a3b8;">${fmtSgd(f.cleanFareCents)} + ${fmtSgd(f.tollCents)} toll</div>
              </td>
              <td>${statusHtml}</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="5" style="color:#64748b;text-align:center;padding:18px;">No Ride Futures contracts matched yet</td></tr>`;
}

async function refreshAll(meta = null) {
  try {
    const myId = wallet.getIdentityRecord()?.identityAddr || '';
    const snap = await rxClient.fetchFullState(myId);
    if (snap) {
      state.snap = snap;
    }
    renderKpisAndRegimeStrip();
    renderTablesAndActivePosition();
    updateTicketPreviews();

    // Auto-run discrete-time `matchBlock()` as soon as the chain advances past our newly submitted order's block!
    const headBlk = Number(meta?.blockNumber || 0);
    if (
      state.autoClearAfterBlock > 0 &&
      !state.autoClearBusy &&
      headBlk > state.autoClearAfterBlock
    ) {
      state.autoClearBusy = true;
      const targetBlk = state.autoClearAfterBlock;
      state.autoClearAfterBlock = 0;
      rxClient
        .triggerMatchBlock(wallet)
        .then(async () => {
          const fresh = await rxClient.fetchFullState(wallet.getIdentityRecord()?.identityAddr || '');
          if (fresh) state.snap = fresh;
          renderKpisAndRegimeStrip();
          renderTablesAndActivePosition();
          updateTicketPreviews();
          showBanner(
            `⚡ Discrete-Time Batch Cleared after Block #${targetBlk}! Check your Order / Service Futures status below.`,
            'ok'
          );
        })
        .catch(() => {})
        .finally(() => {
          state.autoClearBusy = false;
        });
    }
  } catch (_) {}
}

function bindEvents() {
  // Ticket Mode Tabs
  document.getElementById('tabRiderMode').addEventListener('click', () => {
    state.ticketMode = 'rider';
    document.getElementById('tabRiderMode').classList.add('active');
    document.getElementById('tabDriverMode').classList.remove('active');
    document.getElementById('formRiderBid').style.display = 'flex';
    document.getElementById('formDriverAsk').style.display = 'none';
    renderSingaporeRadarSvg();
  });

  document.getElementById('tabDriverMode').addEventListener('click', () => {
    state.ticketMode = 'driver';
    document.getElementById('tabDriverMode').classList.add('active');
    document.getElementById('tabRiderMode').classList.remove('active');
    document.getElementById('formDriverAsk').style.display = 'flex';
    document.getElementById('formRiderBid').style.display = 'none';
    state.mapClickMode = 'driver';
    document.querySelectorAll('[data-map-click-mode]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-map-click-mode') === 'driver');
    });
    renderSingaporeRadarSvg();
  });

  // Landmark Selectors
  document.getElementById('selRiderFrom').addEventListener('change', (e) => {
    const lm = SG_LANDMARKS.find((x) => x.id === e.target.value);
    if (lm) {
      state.fromCoord = { lat: lm.lat, lon: lm.lon, label: lm.label };
      updateTicketPreviews();
    }
  });
  document.getElementById('selRiderTo').addEventListener('change', (e) => {
    const lm = SG_LANDMARKS.find((x) => x.id === e.target.value);
    if (lm) {
      state.toCoord = { lat: lm.lat, lon: lm.lon, label: lm.label };
      updateTicketPreviews();
    }
  });
  document.getElementById('selDriverLoc').addEventListener('change', (e) => {
    const lm = SG_LANDMARKS.find((x) => x.id === e.target.value);
    if (lm) {
      state.driverCoord = { lat: lm.lat, lon: lm.lon, label: lm.label };
      updateTicketPreviews();
    }
  });

  document.getElementById('btnSwapRoute').addEventListener('click', () => {
    const tmp = state.fromCoord;
    state.fromCoord = state.toCoord;
    state.toCoord = tmp;
    const sf = document.getElementById('selRiderFrom');
    const st = document.getElementById('selRiderTo');
    const sv = sf.value;
    sf.value = st.value;
    st.value = sv;
    updateTicketPreviews();
  });

  document.getElementById('inpBidPerKm').addEventListener('input', updateTicketPreviews);
  document.getElementById('inpRiderMaxPickupKm').addEventListener('input', updateTicketPreviews);

  document.getElementById('btnBidCrossBest').addEventListener('click', () => {
    const maxPk = Math.round(Number(document.getElementById('inpRiderMaxPickupKm').value || 4.5) * 1000);
    const best = findBestFeasibleAskForRoute(
      state.fromCoord.lat,
      state.fromCoord.lon,
      state.toCoord.lat,
      state.toCoord.lon,
      maxPk
    );
    if (best) {
      document.getElementById('inpBidPerKm').value = (best.effCents / 100).toFixed(2);
      updateTicketPreviews();
    }
  });

  document.getElementById('btnBidPlus15').addEventListener('click', () => {
    const cur = Number(document.getElementById('inpBidPerKm').value || 1.8);
    document.getElementById('inpBidPerKm').value = (cur * 1.15).toFixed(2);
    updateTicketPreviews();
  });

  // Destination Regime Mask Checkboxes
  document.getElementById('driverDestMaskGroup').addEventListener('change', () => {
    let m = 0;
    document.querySelectorAll('[data-dest-bit]').forEach((cb) => {
      if (cb.checked) m |= 1 << Number(cb.getAttribute('data-dest-bit'));
    });
    state.destMask = m || 0x3f;
  });

  // Interactive SVG Map Clicks & Hover Tooltips
  const svg = document.getElementById('sgRadarSvg');
  const tip = document.getElementById('mapHoverTooltip');
  svg.addEventListener('mousemove', (ev) => {
    const tEl = ev.target.closest('[data-tip]');
    if (!tEl) {
      tip.style.display = 'none';
      return;
    }
    const rect = svg.getBoundingClientRect();
    tip.textContent = tEl.getAttribute('data-tip');
    tip.style.left = `${Math.min(rect.width - 220, Math.max(8, ev.clientX - rect.left + 12))}px`;
    tip.style.top = `${Math.max(8, ev.clientY - rect.top - 28)}px`;
    tip.style.display = 'block';
  });
  svg.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
  });

  svg.addEventListener('click', (ev) => {
    const askHit = ev.target.closest('[data-pick-ask-rate]');
    if (askHit) {
      document.getElementById('inpBidPerKm').value = askHit.getAttribute('data-pick-ask-rate');
      updateTicketPreviews();
      return;
    }
    const lmHit = ev.target.closest('[data-lm-id]');
    let chosen;
    let selId = '__custom__';
    if (lmHit) {
      const lm = SG_LANDMARKS.find((x) => x.id === lmHit.getAttribute('data-lm-id'));
      if (lm) {
        chosen = { lat: lm.lat, lon: lm.lon, label: lm.label };
        selId = lm.id;
      }
    } else {
      const rect = svg.getBoundingClientRect();
      const sx = ((ev.clientX - rect.left) / rect.width) * MAP_BOUNDS.w;
      const sy = ((ev.clientY - rect.top) / rect.height) * MAP_BOUNDS.h;
      const c = unprojectSvg(sx, sy);
      chosen = { lat: c.lat, lon: c.lon, label: 'Custom Pin' };
    }
    if (!chosen) return;

    if (state.mapClickMode === 'from') {
      state.fromCoord = chosen;
      document.getElementById('selRiderFrom').value = selId;
    } else if (state.mapClickMode === 'to') {
      state.toCoord = chosen;
      document.getElementById('selRiderTo').value = selId;
    } else {
      state.driverCoord = chosen;
      document.getElementById('selDriverLoc').value = selId;
    }
    updateTicketPreviews();
  });

  // Claim +$250 Demo Margin
  document.getElementById('btnClaimMargin').addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      showBanner('⏳ Deploying/verifying Identity HFS & claiming +$250.00 SGD-RIDE margin…', 'info');
      await rxClient.executeViaIdentity(wallet, RideExchangeAbi.claimDemoMargin());
      await refreshAll();
      showBanner('✅ Credited +$250.00 SGD-RIDE into your verified Identity HFS!', 'ok');
    } catch (err) {
      showBanner(`🚫 Margin top-up failed: ${escapeHtml(err.message || err)}`, 'err');
    } finally {
      state.busy = false;
    }
  });

  // Manual `matchBlock()`
  document.getElementById('btnMatchBlock').addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      showBanner('⏳ Executing discrete-time Multi-Regime matchBlock()…', 'info');
      await rxClient.triggerMatchBlock(wallet);
      await refreshAll();
      showBanner('✅ Discrete-time batch cleared across all 6 Singapore Price Regimes!', 'ok');
    } catch (err) {
      showBanner(`⚠ ${escapeHtml(err.message || err)}`, 'err');
    } finally {
      state.busy = false;
    }
  });

  // Submit Customer Ride Bid
  document.getElementById('formRiderBid').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (state.busy) return;
    state.busy = true;
    try {
      const bidPerKmCents = Math.round(Number(document.getElementById('inpBidPerKm').value || 1.8) * 100);
      const maxPickupM = Math.round(Number(document.getElementById('inpRiderMaxPickupKm').value || 4.5) * 1000);
      const origReg = classifySgRegime(state.fromCoord.lat, state.fromCoord.lon);
      const destReg = classifySgRegime(state.toCoord.lat, state.toCoord.lon);
      const tripM = computeRoadDistanceM(
        state.fromCoord.lat,
        state.fromCoord.lon,
        state.toCoord.lat,
        state.toCoord.lon
      );
      const neededCents = computeTripFareCeilCents(bidPerKmCents, tripM) + getTollCents(origReg, destReg);

      const idRec = await wallet.ensureIdentityWithPrompt({
        rpcUrl,
        appName: 'TransitDEX Ride Futures',
      });
      await refreshAll();

      if ((state.snap?.myBalanceCents || 0) < neededCents && document.getElementById('chkAutoTopUp').checked) {
        showBanner('💧 Auto-claiming +$250.00 SGD-RIDE Demo Margin for your Identity HFS…', 'info');
        await rxClient.executeViaIdentity(wallet, RideExchangeAbi.claimDemoMargin());
      }

      showBanner(
        `⏳ Escrowing ${fmtSgd(neededCents)} SGD & posting Ride Bid (${fmtKm(tripM)} @ ${fmtSgd(bidPerKmCents)}/km)…`,
        'info'
      );
      const { receipt } = await rxClient.executeViaIdentity(
        wallet,
        RideExchangeAbi.postRiderBid({
          fromLat: state.fromCoord.lat,
          fromLon: state.fromCoord.lon,
          toLat: state.toCoord.lat,
          toLon: state.toCoord.lon,
          bidPerKmCents,
          maxPickupM,
        })
      );
      const ordBlk = Number(BigInt(receipt.blockNumber));
      state.autoClearAfterBlock = ordBlk;
      await refreshAll();
      showBanner(
        `✅ Ride Bid posted in Block #${ordBlk} (${fmtSgd(neededCents)} escrowed)! Auto-clearing on Block #${ordBlk + 1} (or click ⚡ Clear Batch)…`,
        'ok'
      );
      void idRec;
    } catch (err) {
      showBanner(`🚫 Ride Bid failed: ${escapeHtml(err.message || err)}`, 'err');
    } finally {
      state.busy = false;
    }
  });

  // Submit / Update Driver Ask
  document.getElementById('formDriverAsk').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (state.busy) return;
    state.busy = true;
    try {
      const askPerKmCents = Math.round(Number(document.getElementById('inpAskPerKm').value || 1.35) * 100);
      const maxDistanceM = Math.round(Number(document.getElementById('inpDriverMaxDistKm').value || 28) * 1000);
      const maxPickupM = Math.round(Number(document.getElementById('inpDriverMaxPickupKm').value || 4.5) * 1000);
      const remoteBasisCents = Math.round(Number(document.getElementById('inpRemoteBasis').value || 0.45) * 100);
      const crossBorder = document.getElementById('chkCrossBorder').checked;

      showBanner(
        `⏳ Listing Driver Ask (${fmtSgd(askPerKmCents)}/km, Max Range ${fmtKm(maxDistanceM)}) via Identity HFS…`,
        'info'
      );
      const { receipt } = await rxClient.executeViaIdentity(
        wallet,
        RideExchangeAbi.upsertDriverAsk({
          lat: state.driverCoord.lat,
          lon: state.driverCoord.lon,
          askPerKmCents,
          maxDistanceM,
          maxPickupM,
          destMask: state.destMask,
          remoteBasisCents,
          crossBorder,
        })
      );
      const ordBlk = Number(BigInt(receipt.blockNumber));
      state.autoClearAfterBlock = ordBlk;
      await refreshAll();
      showBanner(
        `✅ Driver Ask posted in Block #${ordBlk}! Auto-ingesting into ${SG_REGIMES[classifySgRegime(state.driverCoord.lat, state.driverCoord.lon)].shortLabel} AskBook on Block #${ordBlk + 1}…`,
        'ok'
      );
    } catch (err) {
      showBanner(`🚫 Driver Ask failed: ${escapeHtml(err.message || err)}`, 'err');
    } finally {
      state.busy = false;
    }
  });

  // O(1) Driver GPS Heartbeat
  document.getElementById('btnDriverGpsPing').addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      showBanner('⏳ Sending O(1) updateDriverLocation() (preserving queue seniority)…', 'info');
      await rxClient.executeViaIdentity(
        wallet,
        RideExchangeAbi.updateDriverLocation(state.driverCoord.lat, state.driverCoord.lon)
      );
      await refreshAll();
      showBanner('✅ Vehicle GPS updated in O(1) with seniority_block preserved!', 'ok');
    } catch (err) {
      showBanner(`🚫 GPS update failed (list an active Driver Ask first): ${escapeHtml(err.message || err)}`, 'err');
    } finally {
      state.busy = false;
    }
  });

  // Cancel Driver Ask
  document.getElementById('btnCancelMyAsk').addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      showBanner('⏳ Cancelling active Driver Ask in O(1)…', 'info');
      await rxClient.executeViaIdentity(wallet, RideExchangeAbi.cancelDriverAsk());
      await refreshAll();
      showBanner('✅ Driver Ask removed from book.', 'ok');
    } catch (err) {
      showBanner(`🚫 Cancel failed: ${escapeHtml(err.message || err)}`, 'err');
    } finally {
      state.busy = false;
    }
  });

  // Delegated clicks (Regime Filter, Map Mode, Futures Actions, Cancel Bid)
  document.addEventListener('click', async (ev) => {
    const modeBtn = ev.target.closest('[data-map-click-mode]');
    if (modeBtn) {
      state.mapClickMode = modeBtn.getAttribute('data-map-click-mode');
      document.querySelectorAll('[data-map-click-mode]').forEach((b) => {
        b.classList.toggle('active', b === modeBtn);
      });
      return;
    }

    const regBtn = ev.target.closest('[data-select-regime]');
    if (regBtn) {
      state.selectedRegime = Number(regBtn.getAttribute('data-select-regime'));
      renderKpisAndRegimeStrip();
      renderTablesAndActivePosition();
      renderSingaporeRadarSvg();
      return;
    }

    const askRow = ev.target.closest('[data-pick-ask-rate]');
    if (askRow && !ev.target.closest('svg')) {
      document.getElementById('inpBidPerKm').value = askRow.getAttribute('data-pick-ask-rate');
      updateTicketPreviews();
      return;
    }

    if (ev.target.closest('#btnInlineMatchNow')) {
      document.getElementById('btnMatchBlock').click();
      return;
    }

    const cancelBidBtn = ev.target.closest('[data-cancel-bid]');
    if (cancelBidBtn && !state.busy) {
      state.busy = true;
      const oid = Number(cancelBidBtn.getAttribute('data-cancel-bid'));
      try {
        showBanner(`⏳ Cancelling Ride Bid #${oid} & refunding escrowed SGD-RIDE…`, 'info');
        await rxClient.executeViaIdentity(wallet, RideExchangeAbi.cancelRiderBid(oid));
        await refreshAll();
        showBanner(`✅ Ride Bid #${oid} cancelled — 100% of escrowed margin refunded!`, 'ok');
      } catch (err) {
        showBanner(`🚫 Cancel failed: ${escapeHtml(err.message || err)}`, 'err');
      } finally {
        state.busy = false;
      }
      return;
    }

    const pickupBtn = ev.target.closest('[data-confirm-pickup]');
    if (pickupBtn && !state.busy) {
      state.busy = true;
      const fid = Number(pickupBtn.getAttribute('data-confirm-pickup'));
      try {
        showBanner(`⏳ Confirming passenger boarding on Futures #${fid}…`, 'info');
        await rxClient.executeViaIdentity(wallet, RideExchangeAbi.confirmPickup(fid));
        await refreshAll();
        showBanner(`🚕 Futures #${fid} marked IN PROGRESS — meter running on customer trip!`, 'ok');
      } catch (err) {
        showBanner(`🚫 Pickup confirmation failed: ${escapeHtml(err.message || err)}`, 'err');
      } finally {
        state.busy = false;
      }
      return;
    }

    const compBtn = ev.target.closest('[data-complete-ride]');
    if (compBtn && !state.busy) {
      state.busy = true;
      const fid = Number(compBtn.getAttribute('data-complete-ride'));
      const fut = (state.snap?.futures || []).find((x) => x.futuresId === fid);
      try {
        showBanner(`⏳ Signing physical delivery receipt completeRide(#${fid}) & releasing escrow to Driver…`, 'info');
        await rxClient.executeViaIdentity(wallet, RideExchangeAbi.completeRide(fid), {
          extraIdentityTargets: fut?.driverIdentity ? [fut.driverIdentity] : [],
        });
        await refreshAll();
        showBanner(
          `🎉 Service Futures #${fid} physically settled! Escrowed ${fut ? fmtSgd(fut.totalCents) : ''} SGD released into Driver's Identity HFS!`,
          'ok'
        );
      } catch (err) {
        showBanner(`🚫 Settlement failed: ${escapeHtml(err.message || err)}`, 'err');
      } finally {
        state.busy = false;
      }
      return;
    }

    const canFutBtn = ev.target.closest('[data-cancel-futures]');
    if (canFutBtn && !state.busy) {
      state.busy = true;
      const fid = Number(canFutBtn.getAttribute('data-cancel-futures'));
      try {
        showBanner(`⏳ Cancelling pre-pickup Futures #${fid}…`, 'info');
        await rxClient.executeViaIdentity(wallet, RideExchangeAbi.cancelRideFutures(fid));
        await refreshAll();
        showBanner(`✅ Futures #${fid} cancelled and margin settled.`, 'ok');
      } catch (err) {
        showBanner(`🚫 Cancel failed: ${escapeHtml(err.message || err)}`, 'err');
      } finally {
        state.busy = false;
      }
    }
  });
}

async function boot() {
  populateLandmarkSelects();
  bindEvents();

  const headerApi = mountSlxUnifiedHeader({
    mountEl: document.getElementById('slxUnifiedHeaderMount'),
    currentAppId: 'rides',
    title: 'TransitDEX — Ride Service Futures',
    subtitle: '6-Regime Discrete-Time AON Orderbook & Physical Delivery Escrow',
    wallet,
    onEndpointChange: (newRpc) => {
      rpcUrl = newRpc;
      refreshAll();
    },
    onWalletChange: () => {
      refreshAll();
    },
  });

  if (headerApi?.contextSlotEl) {
    mountHfsRegistryDropdown({
      container: headerApi.contextSlotEl,
      typeName: 'RIDE_EXCHANGE',
      wallet,
      rpcUrlFn: () => rpcUrl,
      onSelect: (entry) => {
        if (entry?.primaryAddr) {
          rxClient.exchangeAddr = entry.primaryAddr.toLowerCase();
          rxClient.overview = null;
          refreshAll();
        }
      },
    });
  }

  updateTicketPreviews();
  await refreshAll();

  slxWatchChainApp({
    rpcUrl: () => rpcUrl,
    filter: {
      topics: [
        [
          RIDE_EXCHANGE_TOPICS.DRIVER_ASK_POSTED,
          RIDE_EXCHANGE_TOPICS.DRIVER_LOC_UPDATED,
          RIDE_EXCHANGE_TOPICS.RIDER_BID_POSTED,
          RIDE_EXCHANGE_TOPICS.ORDER_CANCELLED,
          RIDE_EXCHANGE_TOPICS.RIDE_MATCHED,
          RIDE_EXCHANGE_TOPICS.RIDE_PICKUP,
          RIDE_EXCHANGE_TOPICS.RIDE_COMPLETED,
          RIDE_EXCHANGE_TOPICS.RIDE_CANCELLED,
          RIDE_EXCHANGE_TOPICS.BLOCK_MATCHED,
        ],
      ],
    },
    onRefresh: (meta) => refreshAll(meta),
  });
}

boot();
