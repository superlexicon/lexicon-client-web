/**
 * Reusable Embedded Decentralized App Store (`src/embedded-app-directory.js`)
 *
 * Apple App Store / iOS + GNOME Software (Flathub) inspired storefront mounted on:
 *  - Slide 5 of `superlexicon-slides` (`#slxEmbeddedAppDirectoryMount[data-mode="slide5"]`)
 *  - Root Launchpad of `lexicon-client-web` (`#slxEmbeddedAppDirectoryMount[data-mode="hub"]`)
 *
 * Hydrates live from `/app-bundles/manifest.json` + local Studio overrides + Subnet 1 `AppStore` HFS,
 * lets users `GET` (install & cache `keccak256`-verified on-chain UI bundles into `SlxPersonalAppContainer`),
 * and launches both Verified Host HFS suites and Zero-Trust Sandboxed community apps with 0 servers.
 */

import {
  APP_CATEGORIES,
  APP_EXEC_MODE,
  ZERO_BYTES32,
  getDefaultNodeWsUrl,
  AppStoreClient,
  SlxUiBundleCache,
  SlxPersonalAppContainer,
  loadLocalPublishedApps,
  cacheCatalogManifestLocal,
  getCachedCatalogManifestLocal,
} from '@superlexicon/sdk';
import { openSlxUseCaseDescription, USECASE_DESCRIPTIONS } from '@superlexicon/sdk/ui';

const ICON_GRADIENTS = {
  telephony: 'linear-gradient(145deg, #38bdf8 0%, #2563eb 55%, #4f46e5 100%)',
  accounting: 'linear-gradient(145deg, #34d399 0%, #059669 55%, #0f766e 100%)',
  charter: 'linear-gradient(145deg, #818cf8 0%, #4f46e5 58%, #312e81 100%)',
  dex: 'linear-gradient(145deg, #a78bfa 0%, #7c3aed 56%, #4c1d95 100%)',
  commerce: 'linear-gradient(145deg, #fbbf24 0%, #d97706 58%, #9a3412 100%)',
  crowdfunding: 'linear-gradient(145deg, #fb7185 0%, #e11d48 58%, #9f1239 100%)',
  rewards: 'linear-gradient(145deg, #facc15 0%, #ca8a04 58%, #854d0e 100%)',
  ballot: 'linear-gradient(145deg, #2dd4bf 0%, #0d9488 58%, #115e59 100%)',
  social: 'linear-gradient(145deg, #22d3ee 0%, #0284c7 58%, #075985 100%)',
  battleship: 'linear-gradient(145deg, #38bdf8 0%, #0369a1 54%, #0f172a 100%)',
  'cipher-noir': 'linear-gradient(145deg, #c084fc 0%, #7e22ce 55%, #1e1b4b 100%)',
  hegemony: 'linear-gradient(145deg, #f43f5e 0%, #be123c 55%, #4c0519 100%)',
  lottery: 'linear-gradient(145deg, #fbbf24 0%, #f97316 58%, #c2410c 100%)',
  'rf-micro-poll': 'linear-gradient(145deg, #2dd4bf 0%, #0284c7 100%)',
  'mesh-repeater-wall': 'linear-gradient(145deg, #60a5fa 0%, #4338ca 100%)',
  'hfs-bounty-splits': 'linear-gradient(145deg, #34d399 0%, #047857 100%)',
};

const STORE_CSS = `
.slx-store-win {
  --st-bg: #0c1220;
  --st-side: rgba(16, 24, 42, 0.88);
  --st-card: rgba(20, 30, 52, 0.72);
  --st-card-hover: rgba(28, 41, 69, 0.92);
  --st-border: rgba(255, 255, 255, 0.09);
  --st-divider: rgba(255, 255, 255, 0.07);
  --st-text: #f8fafc;
  --st-muted: #94a3b8;
  --st-subtle: #64748b;
  --st-input: rgba(6, 11, 22, 0.78);
  --st-nav-active: rgba(10, 132, 255, 0.2);
  --st-nav-active-text: #7cc4ff;
  --st-get-bg: rgba(10, 132, 255, 0.18);
  --st-get-text: #5eb5ff;
  --st-get-hover: #0a84ff;
  --st-open-bg: #0a84ff;
  --st-open-text: #ffffff;
  --st-dock: rgba(15, 23, 42, 0.78);

  border-radius: 20px;
  border: 1px solid var(--st-border);
  background: var(--st-bg);
  color: var(--st-text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 24px 56px rgba(2, 6, 23, 0.48);
  overflow: hidden;
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
}

body.theme-light .slx-store-win {
  --st-bg: #f5f5f7;
  --st-side: rgba(235, 237, 242, 0.92);
  --st-card: #ffffff;
  --st-card-hover: #ffffff;
  --st-border: rgba(15, 23, 42, 0.11);
  --st-divider: rgba(15, 23, 42, 0.08);
  --st-text: #1d1d1f;
  --st-muted: #515154;
  --st-subtle: #86868b;
  --st-input: #ffffff;
  --st-nav-active: rgba(0, 113, 227, 0.13);
  --st-nav-active-text: #0066cc;
  --st-get-bg: rgba(0, 113, 227, 0.11);
  --st-get-text: #0066cc;
  --st-get-hover: #0071e3;
  --st-open-bg: #0071e3;
  --st-open-text: #ffffff;
  --st-dock: rgba(255, 255, 255, 0.88);
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.09);
}

/* Frosted Sidebar */
.slx-store-side {
  background: var(--st-side);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid var(--st-divider);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
}

.slx-store-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 2px;
}
.slx-store-dots {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.slx-store-dots span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
}
.slx-store-search-wrap {
  position: relative;
  margin-top: 8px;
}
.slx-store-search-ic {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  opacity: 0.6;
  pointer-events: none;
}
.slx-store-search {
  width: 100%;
  padding: 7px 10px 7px 29px;
  border-radius: 9px;
  border: 1px solid var(--st-border);
  background: var(--st-input);
  color: var(--st-text);
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.slx-store-search:focus {
  border-color: #0a84ff;
  box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.2);
}

.slx-store-nav-lbl {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--st-subtle);
  padding: 10px 8px 4px;
}
.slx-store-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.slx-store-nav-btn {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--st-text);
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 12.8px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.13s ease, color 0.13s ease;
}
.slx-store-nav-btn:hover {
  background: rgba(148, 163, 184, 0.12);
}
.slx-store-nav-btn.active {
  background: var(--st-nav-active);
  color: var(--st-nav-active-text);
  font-weight: 700;
}
.slx-store-nav-cnt {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--st-subtle);
  background: rgba(148, 163, 184, 0.14);
  padding: 1px 6px;
  border-radius: 999px;
}
.slx-store-nav-btn.active .slx-store-nav-cnt {
  color: var(--st-nav-active-text);
  background: rgba(10, 132, 255, 0.18);
}

.slx-store-dev-box {
  border-radius: 13px;
  border: 1px solid var(--st-border);
  background: var(--st-card);
  padding: 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.slx-store-submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, #0a84ff 0%, #2563eb 100%);
  color: #ffffff !important;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 4px 14px rgba(10, 132, 255, 0.32);
  transition: transform 0.13s ease, filter 0.13s ease;
}
.slx-store-submit-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}

/* Main Canvas */
.slx-store-main {
  padding: 18px 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
.slx-store-main.slide-scroll {
  max-height: 640px;
  overflow-y: auto;
  scrollbar-width: thin;
}

/* Top Bar & Installed Dock */
.slx-store-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--st-divider);
}
.slx-store-heading {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.slx-store-sub {
  font-size: 12px;
  color: var(--st-muted);
  margin-top: 2px;
}

.slx-store-dock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 9px 13px;
  border-radius: 14px;
  border: 1px solid var(--st-border);
  background: var(--st-dock);
  backdrop-filter: blur(14px);
}
.slx-store-dock-icons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.slx-dock-app {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 9px 4px 5px;
  border-radius: 11px;
  border: 1px solid var(--st-border);
  background: var(--st-card);
  color: var(--st-text);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.14s ease, border-color 0.14s ease;
}
.slx-dock-app:hover {
  transform: translateY(-2px);
  border-color: #0a84ff;
}
.slx-dock-sq {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.35);
}

/* Featured Hero Spotlights (Apple App Store / Flathub Banner Style) */
.slx-store-heroes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.slx-hero-card {
  position: relative;
  border-radius: 18px;
  padding: 18px 20px;
  color: #ffffff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 158px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 12px 28px rgba(2, 6, 23, 0.28);
  text-decoration: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}
.slx-hero-card:hover {
  transform: translateY(-2px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32), 0 16px 34px rgba(2, 6, 23, 0.38);
}
.slx-hero-lexicall {
  background:
    radial-gradient(circle at 88% 18%, rgba(56, 189, 248, 0.42) 0%, transparent 52%),
    linear-gradient(135deg, #0f172a 0%, #1e3a8a 52%, #312e81 100%);
}
.slx-hero-ifrs {
  background:
    radial-gradient(circle at 88% 18%, rgba(52, 211, 153, 0.38) 0%, transparent 52%),
    linear-gradient(135deg, #062822 0%, #065f46 54%, #115e59 100%);
}
.slx-hero-eyebrow {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.78);
}
.slx-hero-title {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.015em;
  margin-top: 3px;
  line-height: 1.2;
}
.slx-hero-desc {
  font-size: 12.2px;
  color: rgba(255, 255, 255, 0.86);
  line-height: 1.4;
  margin-top: 4px;
  max-width: 44ch;
}
.slx-hero-foot {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.slx-hero-pill {
  padding: 5px 15px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  color: #0f172a;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

/* Section Headers & 2-Column iOS/Flathub App Rows */
.slx-store-sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slx-store-sec-hdr {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}
.slx-store-sec-title {
  font-size: 15.5px;
  font-weight: 800;
  letter-spacing: -0.015em;
}
.slx-store-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

/* Individual App Row Card */
.slx-app-row {
  border-radius: 15px;
  border: 1px solid var(--st-border);
  background: var(--st-card);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease;
}
.slx-app-row:hover {
  background: var(--st-card-hover);
  border-color: rgba(10, 132, 255, 0.38);
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(2, 6, 23, 0.12);
}
.slx-app-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
  text-decoration: none;
  color: inherit;
}

/* 3D Glossy Squircle Icon */
.slx-squircle {
  width: 52px;
  height: 52px;
  border-radius: 13px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  box-shadow:
    inset 0 1.5px 1px rgba(255, 255, 255, 0.42),
    inset 0 -1.5px 2px rgba(0, 0, 0, 0.22),
    0 6px 14px rgba(2, 6, 23, 0.26);
}

.slx-app-meta {
  min-width: 0;
  flex: 1;
}
.slx-app-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.slx-app-title {
  font-size: 13.8px;
  font-weight: 700;
  line-height: 1.22;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slx-app-verified {
  color: #38bdf8;
  font-size: 11px;
  flex-shrink: 0;
}
.slx-app-sbox-tag {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.35);
  flex-shrink: 0;
}
body.theme-light .slx-app-sbox-tag {
  color: #b45309;
}
.slx-app-desc {
  font-size: 11.8px;
  color: var(--st-muted);
  line-height: 1.34;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.slx-app-submeta {
  font-size: 10.5px;
  color: var(--st-subtle);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Apple / Flathub Compact Right Action Stack */
.slx-app-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  min-width: 68px;
}
.slx-app-subactions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
}
.slx-subact-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--st-nav-active-text);
  font-size: 10.2px;
  font-weight: 700;
  cursor: pointer;
  opacity: 0.9;
}
.slx-subact-btn:hover:not(:disabled) {
  opacity: 1;
  text-decoration: underline;
}
.slx-subact-btn.installed {
  color: #34d399;
}
body.theme-light .slx-subact-btn.installed {
  color: #059669;
}
.slx-pill-open {
  padding: 6px 15px;
  border-radius: 999px;
  background: var(--st-open-bg);
  color: var(--st-open-text) !important;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: filter 0.13s ease, transform 0.13s ease;
}
.slx-pill-open:hover {
  filter: brightness(1.1);
  transform: scale(1.02);
}
.slx-pill-get {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--st-get-bg);
  color: var(--st-get-text);
  border: none;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.slx-pill-get:hover:not(:disabled) {
  background: var(--st-get-hover);
  color: #ffffff;
}
.slx-pill-get:disabled {
  opacity: 0.55;
  cursor: default;
}
.slx-pill-info {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--st-border);
  background: transparent;
  color: var(--st-muted);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.13s ease, color 0.13s ease;
}
.slx-pill-info:hover {
  border-color: #0a84ff;
  color: var(--st-text);
}

/* Responsive Collapse */
@media (max-width: 920px) {
  .slx-store-win {
    grid-template-columns: 1fr;
  }
  .slx-store-side {
    border-right: none;
    border-bottom: 1px solid var(--st-divider);
    padding: 12px 14px;
    gap: 10px;
  }
  .slx-store-nav {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .slx-store-nav-btn {
    width: auto;
    white-space: nowrap;
  }
  .slx-store-nav-lbl {
    display: none;
  }
  .slx-store-heroes,
  .slx-store-grid {
    grid-template-columns: 1fr;
  }
}
`;

function injectStoreStyles() {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('slx-emb-dir-styles');
  if (existing) existing.remove();
  const st = document.createElement('style');
  st.id = 'slx-emb-dir-styles';
  st.textContent = STORE_CSS;
  document.head.appendChild(st);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSquircleStyle(slug) {
  const bg =
    ICON_GRADIENTS[slug] || 'linear-gradient(145deg, #38bdf8 0%, #6366f1 100%)';
  return `background:${bg};`;
}

export function mountEmbeddedAppDirectory(
  hostEl,
  { rpcUrlFn = () => getDefaultNodeWsUrl() } = {}
) {
  if (!hostEl || typeof document === 'undefined') return null;
  injectStoreStyles();

  const mode = hostEl.getAttribute('data-mode') || 'hub';
  const isSlideMode = mode === 'slide5';
  const storeClient = new AppStoreClient({ rpcUrl: rpcUrlFn() });

  const state = {
    apps: getCachedCatalogManifestLocal()?.apps || [],
    selectedCat: 0, // 0 = Discover, -1 = Installed, 1..6 = APP_CATEGORIES
    query: '',
    installingSlugs: new Set(),
    toastMsg: '',
  };

  hostEl.innerHTML = `
    <div class="slx-store-win">
      <!-- Left macOS / GNOME Software Frosted Sidebar -->
      <aside class="slx-store-side">
        <div>
          <div class="slx-store-brand">
            <div class="slx-store-dots" aria-hidden="true">
              <span style="background:#ff5f57;"></span>
              <span style="background:#febc2e;"></span>
              <span style="background:#28c840;"></span>
            </div>
            <span style="font-size:10.5px;font-weight:700;color:var(--st-subtle);">app_store.wasm</span>
          </div>

          <div class="slx-store-search-wrap">
            <span class="slx-store-search-ic">🔍</span>
            <input type="search" class="slx-store-search" data-ed="search" placeholder="Search apps…" />
          </div>

          <div class="slx-store-nav" style="margin-top:10px;" data-ed="primaryNav"></div>
          <div class="slx-store-nav-lbl">Categories</div>
          <div class="slx-store-nav" data-ed="catNav"></div>
        </div>

        <div class="slx-store-dev-box">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
            <span style="font-size:11.5px;font-weight:700;">Authorized Devs</span>
            <span data-ed="cachePill" style="font-size:10px;font-weight:700;color:#34d399;">⚡ 0 cached</span>
          </div>
          <div style="font-size:11px;color:var(--st-muted);line-height:1.35;">
            Ship zero-server WASM + UI apps with 0% platform tax.
          </div>
          <a href="/apps.html?create=1" class="slx-store-submit-btn">＋ Submit App</a>
          <div style="display:flex;justify-content:space-between;padding-top:2px;font-size:11px;">
            <a href="/apps.html" style="color:var(--st-nav-active-text);text-decoration:none;font-weight:600;">Full Store ↗</a>
            <a href="https://github.com/superlexicon/haltproof-subroutines" target="_blank" rel="noopener" style="color:var(--st-nav-active-text);text-decoration:none;font-weight:600;" title="Build .wasm HFS &amp; .html.gz bundles with cargo-hps">HFS Repo ↗</a>
            <button type="button" data-ed="archBtn" style="background:none;border:none;padding:0;color:var(--st-muted);font-size:11px;font-weight:600;cursor:pointer;">Spec</button>
          </div>
        </div>
      </aside>

      <!-- Right Storefront Canvas -->
      <div class="slx-store-main ${isSlideMode ? 'slide-scroll' : ''}">
        <div class="slx-store-topbar">
          <div>
            <div class="slx-store-heading" data-ed="heading">Discover</div>
            <div class="slx-store-sub" data-ed="subheading">On-chain apps served directly from your local node — zero databases, zero EC2, zero web servers.</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <a href="https://github.com/superlexicon" target="_blank" rel="noopener" class="slx-pill-get" style="text-decoration:none;" title="Explore all 8 public SuperLexicon repositories on GitHub">GitHub ↗</a>
            <a href="/apps.html" class="slx-pill-get" style="text-decoration:none;">Open App Center ↗</a>
          </div>
        </div>

        <div data-ed="dockWrap"></div>
        <div data-ed="body" style="display:flex;flex-direction:column;gap:18px;"></div>
      </div>
    </div>
  `;

  const refs = {
    search: hostEl.querySelector('[data-ed="search"]'),
    primaryNav: hostEl.querySelector('[data-ed="primaryNav"]'),
    catNav: hostEl.querySelector('[data-ed="catNav"]'),
    cachePill: hostEl.querySelector('[data-ed="cachePill"]'),
    archBtn: hostEl.querySelector('[data-ed="archBtn"]'),
    heading: hostEl.querySelector('[data-ed="heading"]'),
    subheading: hostEl.querySelector('[data-ed="subheading"]'),
    dockWrap: hostEl.querySelector('[data-ed="dockWrap"]'),
    body: hostEl.querySelector('[data-ed="body"]'),
  };

  const getAppHref = (a) =>
    a.route ||
    (a.execMode === APP_EXEC_MODE.VERIFIED_HOST || a.isSystemCore
      ? `/${a.slug}.html`
      : `/apps.html?run=${encodeURIComponent(a.slug)}`);

  const renderAppRow = (a) => {
    const cat = APP_CATEGORIES[a.category] || APP_CATEGORIES[6];
    const isInstalled = SlxPersonalAppContainer.isInstalled(a.slug);
    const isCached = SlxUiBundleCache.isCachedSync(a.uiHash);
    const isInstalling = state.installingSlugs.has(a.slug);
    const isSandbox = a.execMode === APP_EXEC_MODE.SANDBOX_IFRAME && !a.isSystemCore;
    const kbLabel = a.compressedLen ? `${Math.max(1, Math.round(a.compressedLen / 1024))} KB on-chain` : 'On-chain UI';
    const href = getAppHref(a);
    const hasDoc = Boolean(USECASE_DESCRIPTIONS[a.slug]);

    const cleanTitle = String(a.title || '').includes('—')
      ? String(a.title).split('—')[0].trim()
      : String(a.title || '');

    return `
      <article class="slx-app-row">
        <a href="${esc(href)}" class="slx-app-left" title="Launch ${esc(a.title)}">
          <div class="slx-squircle" style="${getSquircleStyle(a.slug)}">${esc(a.icon || '🧩')}</div>
          <div class="slx-app-meta">
            <div class="slx-app-title-row">
              <span class="slx-app-title">${esc(cleanTitle)}</span>
              ${
                isSandbox
                  ? `<span class="slx-app-sbox-tag">Sandbox</span>`
                  : `<span class="slx-app-verified" title="Code-Hash Pinned Halt-Free Subroutine">✓</span>`
              }
            </div>
            <div class="slx-app-desc">${esc(a.summary || '')}</div>
            <div class="slx-app-submeta">
              <span>${esc(cat.shortLabel || cat.label)}</span>
              <span>•</span>
              <span>${esc(kbLabel)}</span>
              ${isCached ? `<span>•</span><span style="color:#34d399;font-weight:700;">⚡ Cached</span>` : ''}
            </div>
          </div>
        </a>

        <div class="slx-app-actions">
          <a href="${esc(href)}" class="slx-pill-open">OPEN</a>
          <div class="slx-app-subactions">
            ${
              isInstalling
                ? `<span style="color:var(--st-subtle);">Saving…</span>`
                : isInstalled
                ? `<button type="button" class="slx-subact-btn installed" data-ed-uninstall="${esc(a.slug)}" title="Pinned in Personal Container (click to remove)">✓ Saved</button>`
                : `<button type="button" class="slx-subact-btn" data-ed-install="${esc(a.slug)}" title="Download &amp; pin verified on-chain UI bundle locally">＋ Get</button>`
            }
            ${
              hasDoc
                ? `<span style="color:var(--st-subtle);">·</span><button type="button" class="slx-subact-btn" data-ed-doc="${esc(a.slug)}" title="Architecture &amp; HFS Spec" style="color:var(--st-muted);">Spec</button>`
                : ''
            }
          </div>
        </div>
      </article>
    `;
  };

  const renderHeroSpotlights = () => `
    <div class="slx-store-heroes">
      <a href="/telephony.html" class="slx-hero-card slx-hero-lexicall">
        <div>
          <div class="slx-hero-eyebrow">Featured Release • P2P Comms</div>
          <div class="slx-hero-title">LexiCall — Calls, Lounges &amp; Live Stage</div>
          <div class="slx-hero-desc">1:1 HD video calls, persistent 24/7 Discord channels &amp; K-ary P2P live broadcasts with zero SFU servers.</div>
        </div>
        <div class="slx-hero-foot">
          <div style="display:flex;align-items:center;gap:9px;">
            <span class="slx-dock-sq" style="${getSquircleStyle('telephony')}">📹</span>
            <span style="font-size:11.5px;font-weight:600;color:rgba(255,255,255,0.88);">webrtc_signal.wasm • 33 KB UI</span>
          </div>
          <span class="slx-hero-pill">OPEN</span>
        </div>
      </a>

      <a href="/accounting.html" class="slx-hero-card slx-hero-ifrs">
        <div>
          <div class="slx-hero-eyebrow">Essential Suite • Enterprise ZK</div>
          <div class="slx-hero-title">Confidential IFRS &amp; Zero-MEV DEX</div>
          <div class="slx-hero-desc">Double-entry IAS/IFRS financial statements with homomorphic ElGamal &amp; Bulletproofs privacy at $0 gas.</div>
        </div>
        <div class="slx-hero-foot">
          <div style="display:flex;align-items:center;gap:9px;">
            <span class="slx-dock-sq" style="${getSquircleStyle('accounting')}">📒</span>
            <span style="font-size:11.5px;font-weight:600;color:rgba(255,255,255,0.88);">confidential_ledger.wasm • 66 KB UI</span>
          </div>
          <span class="slx-hero-pill">OPEN</span>
        </div>
      </a>
    </div>
  `;

  const renderAll = () => {
    const installed = SlxPersonalAppContainer.listInstalled();
    const cacheStats = SlxUiBundleCache.getCacheStats();
    const gzKb = Math.round(cacheStats.totalCompressedBytes / 1024);

    if (refs.cachePill) {
      refs.cachePill.textContent =
        cacheStats.count > 0 ? `⚡ ${cacheStats.count} (${gzKb} KB)` : '⚡ Ready';
    }

    // Counts per category
    const counts = {};
    for (const a of state.apps) {
      const cid = Number(a.category || 6);
      counts[cid] = (counts[cid] || 0) + 1;
    }

    if (refs.primaryNav) {
      const prim = [
        { id: 0, icon: '✨', label: 'Discover', cnt: state.apps.length },
        { id: -1, icon: '📦', label: 'Installed', cnt: installed.length },
      ];
      refs.primaryNav.innerHTML = prim
        .map(
          (p) => `
          <button type="button" class="slx-store-nav-btn ${state.selectedCat === p.id ? 'active' : ''}" data-ed-cat="${p.id}">
            <span style="display:inline-flex;align-items:center;gap:8px;"><span>${p.icon}</span><span>${esc(p.label)}</span></span>
            <span class="slx-store-nav-cnt">${p.cnt}</span>
          </button>`
        )
        .join('');
    }

    if (refs.catNav) {
      refs.catNav.innerHTML = Object.values(APP_CATEGORIES)
        .map(
          (c) => `
          <button type="button" class="slx-store-nav-btn ${state.selectedCat === c.id ? 'active' : ''}" data-ed-cat="${c.id}">
            <span style="display:inline-flex;align-items:center;gap:8px;"><span>${c.icon}</span><span>${esc(c.shortLabel || c.label)}</span></span>
            <span class="slx-store-nav-cnt">${counts[c.id] || 0}</span>
          </button>`
        )
        .join('');
    }

    // Dynamic Heading
    if (refs.heading && refs.subheading) {
      if (state.selectedCat === 0) {
        refs.heading.textContent = 'Discover';
        refs.subheading.textContent =
          'Every app below runs with 0 databases, 0 backend servers & 0 web hosts — UI bundles load straight from chain.';
      } else if (state.selectedCat === -1) {
        refs.heading.textContent = 'Installed Apps';
        refs.subheading.textContent =
          'Pinned in your Personal App Container with locally cached keccak256-verified UI bundles for instant offline launch.';
      } else {
        const catObj = APP_CATEGORIES[state.selectedCat];
        refs.heading.textContent = catObj ? `${catObj.icon} ${catObj.label}` : 'Apps';
        refs.subheading.textContent = catObj?.description || '';
      }
    }

    // Installed Dock Bar (shown when user has pinned apps)
    if (refs.dockWrap) {
      if (installed.length > 0 && state.selectedCat !== -1) {
        refs.dockWrap.innerHTML = `
          <div class="slx-store-dock">
            <div class="slx-store-dock-icons">
              <span style="font-size:11px;font-weight:700;color:var(--st-muted);margin-right:2px;">My Dock:</span>
              ${installed
                .map((app) => {
                  const href = getAppHref(app);
                  return `<a href="${esc(href)}" class="slx-dock-app">
                    <span class="slx-dock-sq" style="${getSquircleStyle(app.slug)}">${esc(app.icon || '🧩')}</span>
                    <span>${esc(app.title.split('—')[0].trim())}</span>
                  </a>`;
                })
                .join('')}
            </div>
            ${
              state.toastMsg
                ? `<span style="font-size:11px;font-weight:600;color:#34d399;">${esc(state.toastMsg)}</span>`
                : `<button type="button" data-ed-cat="-1" style="background:none;border:none;color:var(--st-nav-active-text);font-size:11.5px;font-weight:700;cursor:pointer;">Manage (${installed.length}) →</button>`
            }
          </div>
        `;
      } else {
        refs.dockWrap.innerHTML = '';
      }
    }

    if (!refs.body) return;
    if (!state.apps.length) {
      refs.body.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:var(--st-muted);">Loading on-chain App Store…</div>`;
      return;
    }

    const q = state.query.trim().toLowerCase();
    const sourceList =
      state.selectedCat === -1
        ? installed.map((inst) => state.apps.find((a) => a.slug === inst.slug) || inst)
        : state.apps;

    const filtered = sourceList.filter((a) => {
      if (state.selectedCat > 0 && Number(a.category || 6) !== state.selectedCat) return false;
      if (!q) return true;
      const catLabel = APP_CATEGORIES[a.category]?.label || '';
      return (
        String(a.title || '').toLowerCase().includes(q) ||
        String(a.slug || '').toLowerCase().includes(q) ||
        String(a.summary || '').toLowerCase().includes(q) ||
        catLabel.toLowerCase().includes(q)
      );
    });

    if (state.selectedCat === -1 && !filtered.length) {
      refs.body.innerHTML = `
        <div style="padding:32px 20px;border-radius:16px;border:1px dashed var(--st-border);text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;">
          <div style="font-size:28px;">📦</div>
          <div style="font-size:15px;font-weight:700;">Your Personal App Container is Empty</div>
          <div style="font-size:12.5px;color:var(--st-muted);max-width:46ch;">Tap <strong>GET</strong> on any app to verify and cache its compressed on-chain UI bundle locally for instant, offline-ready launching.</div>
          <button type="button" class="slx-pill-open" data-ed-cat="0" style="margin-top:4px;">Browse Apps</button>
        </div>
      `;
      return;
    }

    if (state.selectedCat === 0 && !q) {
      const catBlocks = Object.values(APP_CATEGORIES)
        .map((cat) => {
          const items = filtered.filter((a) => Number(a.category || 6) === cat.id);
          if (!items.length) return '';
          return `
            <section class="slx-store-sec">
              <div class="slx-store-sec-hdr">
                <div class="slx-store-sec-title">${cat.icon} ${esc(cat.label)}</div>
                <button type="button" data-ed-cat="${cat.id}" style="background:none;border:none;color:var(--st-nav-active-text);font-size:12px;font-weight:600;cursor:pointer;">See All (${items.length})</button>
              </div>
              <div class="slx-store-grid">
                ${items.map(renderAppRow).join('')}
              </div>
            </section>
          `;
        })
        .filter(Boolean)
        .join('');

      refs.body.innerHTML = renderHeroSpotlights() + catBlocks;
    } else {
      refs.body.innerHTML = filtered.length
        ? `<div class="slx-store-grid">${filtered.map(renderAppRow).join('')}</div>`
        : `<div style="padding:28px;text-align:center;font-size:13px;color:var(--st-muted);">No apps matching “${esc(state.query)}”.</div>`;
    }
  };

  const hydrateCatalog = async () => {
    try {
      const resp = await fetch('/app-bundles/manifest.json', { cache: 'no-cache' });
      const genesis = resp.ok ? await resp.json() : { apps: state.apps };
      const bySlug = new Map();
      const bySlugId = new Map();
      for (const g of genesis.apps || []) {
        const c = { ...g, source: 'genesis-cas' };
        bySlug.set(g.slug, c);
        if (g.slugId) bySlugId.set(g.slugId.toLowerCase(), c);
      }
      for (const loc of loadLocalPublishedApps()) {
        const key = String(loc.slug || '').toLowerCase();
        const prev = bySlug.get(key) || {};
        const merged = { ...prev, ...loc };
        bySlug.set(key, merged);
        if (merged.slugId) bySlugId.set(merged.slugId.toLowerCase(), merged);
      }
      storeClient.rpcUrl = rpcUrlFn();
      const storeAddr = await storeClient.resolveStoreAddress().catch(() => '');
      if (storeAddr) {
        const onChain = await storeClient.fetchOnChainApps().catch(() => []);
        for (const oc of onChain) {
          const existing = bySlugId.get(String(oc.slugId || '').toLowerCase());
          if (existing) {
            Object.assign(existing, {
              appId: oc.appId,
              title: oc.title || existing.title,
              summary: oc.summary || existing.summary,
              icon: oc.icon || existing.icon,
              version: oc.version || existing.version,
              category: oc.category || existing.category,
              uiHash: oc.uiHash,
              source: 'onchain',
            });
          } else {
            const syn = `app-${oc.appId}`;
            bySlug.set(syn, { ...oc, slug: syn, route: `/apps.html?run=${syn}`, source: 'onchain' });
          }
        }
      }
      state.apps = Array.from(bySlug.values());
      cacheCatalogManifestLocal({ apps: state.apps });
      SlxPersonalAppContainer.syncCatalogMetadata(state.apps);
      renderAll();
    } catch (_) {
      renderAll();
    }
  };

  refs.archBtn?.addEventListener('click', () => {
    openSlxUseCaseDescription('apps', 'codification', { currentPageAppId: isSlideMode ? 'deck' : 'apps' });
  });

  refs.search?.addEventListener('input', (ev) => {
    state.query = ev.currentTarget.value || '';
    renderAll();
  });

  hostEl.addEventListener('click', async (ev) => {
    const catBtn = ev.target.closest('[data-ed-cat]');
    if (catBtn) {
      state.selectedCat = Number(catBtn.getAttribute('data-ed-cat'));
      renderAll();
      return;
    }
    const docBtn = ev.target.closest('[data-ed-doc]');
    if (docBtn) {
      openSlxUseCaseDescription(docBtn.getAttribute('data-ed-doc'), 'codification', {
        currentPageAppId: isSlideMode ? 'deck' : 'apps',
      });
      return;
    }
    const instBtn = ev.target.closest('[data-ed-install]');
    if (instBtn) {
      const slug = instBtn.getAttribute('data-ed-install');
      const appMeta = state.apps.find((a) => a.slug === slug);
      if (!appMeta || state.installingSlugs.has(slug)) return;
      state.installingSlugs.add(slug);
      renderAll();
      try {
        storeClient.rpcUrl = rpcUrlFn();
        await SlxPersonalAppContainer.installApp(appMeta, { storeClient });
        state.toastMsg = `✓ Installed "${appMeta.title.split('—')[0].trim()}"`;
      } catch (err) {
        state.toastMsg = `⚠ ${err.message || err}`;
      } finally {
        state.installingSlugs.delete(slug);
        renderAll();
      }
      return;
    }
    const uninstBtn = ev.target.closest('[data-ed-uninstall]');
    if (uninstBtn) {
      const slug = uninstBtn.getAttribute('data-ed-uninstall');
      await SlxPersonalAppContainer.uninstallApp(slug);
      state.toastMsg = '';
      renderAll();
    }
  });

  const unsub = SlxPersonalAppContainer.onChange(() => renderAll());
  renderAll();
  hydrateCatalog();

  return {
    refresh: hydrateCatalog,
    destroy: () => unsub(),
  };
}
