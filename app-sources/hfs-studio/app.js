/**
 * HFS WONDERLAB STUDIO (`app-sources/hfs-studio/app.js` — SuperLexicon HFS #30)
 *
 * Kid-Friendly & Creator Visual Block-to-WASM Development Environment:
 *  - Snap together colorful Scratch-inspired Memory Boxes, Guard Conditions, Action Blocks,
 *    and Victory Goals — or remix 6 one-click starter blueprints (Cyber-Pet, Class Forest,
 *    Pizza Vote, Space Miner, Boss Raid, Blank Canvas).
 *  - Compiles visual rules directly in the browser (`< 2 ms`, zero server!) into a genuine,
 *    `WebAssembly.validate()`-verified Lexicon `wasm32` Halt-Free Subroutine (`~1.7 KiB`).
 *  - Executes that exact compiled `.wasm` binary live inside the Tablet Test Playground,
 *    shows the equivalent `hps_sdk` Rust code side-by-side, and deploys in 1 click to
 *    Subnet 1 (`0x0100` WASM + `0x0101` Gzipped UI Bundle + `AppStore` listing at `$0.00` gas)!
 */

import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  keccak256Hex,
  selectorBytes,
  encodeAbi,
  shortHex,
  ZERO_ADDR,
  APP_EXEC_MODE,
  APP_CATEGORIES,
  SlxWalletManager,
  SlxClient,
  AppStoreClient,
  SlxPersonalAppContainer,
  compressAppUiBundle,
  buildSandboxedIframeSrcdoc,
  getDefaultNodeWsUrl,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader, registerSlxUseCaseDocs } from '@superlexicon/sdk/ui';
import { mountSlxGameGuide } from '@superlexicon/sdk/ui/game-guide';

// ---------------------------------------------------------------------------
// Inline Field Guide & Architecture Spec
// ---------------------------------------------------------------------------

const STUDIO_MANUAL_SPEC = {
  icon: '🛠️',
  title: 'HFS WonderLab — Kid & Creator App Builder Guide',
  accent: '#a855f7',
  tagline:
    'Design your own blockchain game, virtual pet, or classroom poll using colorful snap-blocks — then launch a real WebAssembly Halt-Free Subroutine on Subnet 1 in one click!',
  welcomePrimaryLabel: '✨ Start Building My First HFS App!',
  quickSteps: [
    {
      num: '1',
      title: 'Pick a Starter Idea & Customize Look',
      body: 'Choose Cyber-Pet, Class Forest, Pizza Poll, Space Miner, or Boss Raid—then pick your App Icon, Mascot Emoji, and Color Theme!',
    },
    {
      num: '2',
      title: 'Snap Together Memory Boxes & Action Rules',
      body: 'Create up to 4 on-chain variables (Personal or Shared Multiplayer!) and up to 6 Action Buttons with Guard locks and +/- rules.',
    },
    {
      num: '3',
      title: 'Test in the Tablet & Rocket-Launch to Subnet 1!',
      body: 'Test your actual compiled WebAssembly in the live tablet preview, peek at the Rust code, and click 🚀 Deploy to Subnet 1 ($0 Gas)!',
    },
  ],
  tabs: {
    quickstart: `
      <div class="slx-gg-hero">
        <div class="slx-gg-hero-title">🧩 How Do Blocks Become a Real Blockchain App?</div>
        <p>
          Every app on SuperLexicon has two parts:
          <strong>1) Brain (<code>.wasm</code> Halt-Free Subroutine)</strong> stored in <code>0x0100</code>, and
          <strong>2) Face (<code>.html.gz</code> Animated UI)</strong> stored in <code>0x0101</code>.
          WonderLab compiles your blocks into BOTH right inside your browser!
        </p>
      </div>
      <div class="slx-gg-steps-grid">
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">👤 vs 🌍</span>
          <h4>Personal vs. Shared Memory</h4>
          <p><strong>👤 Personal</strong> gives each player their own pet/score. <strong>🌍 Shared</strong> lets your whole class grow one forest or battle one boss together!</p>
        </div>
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">🔒 GUARDS</span>
          <h4>Smart Rule Locks</h4>
          <p>Add a green Guard lock like <em>"Require Energy &ge; 15"</em> so players must rest or recharge before using big moves!</p>
        </div>
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">♾️ HALT-FREE</span>
          <h4>Guaranteed Safe</h4>
          <p>Because your blocks have no infinite loops and clamp every number between Min and Max, your subroutine can never freeze!</p>
        </div>
      </div>
    `,
    controls: `
      <div class="slx-gg-card">
        <h4>🎮 Testing vs. Live Subnet 1 Deployment</h4>
        <ul>
          <li><strong>🧪 Tablet Test Playground:</strong> Runs your real compiled <code>.wasm</code> binary in browser memory so you can experiment freely before publishing.</li>
          <li><strong>🚀 Deploy to Subnet 1 ($0 Gas):</strong> Uploads your <code>.wasm</code> to <code>0x0100</code>, spawns a live HFS contract, uploads your compressed UI to <code>0x0101</code>, and lists your app in the App Store!</li>
        </ul>
      </div>
    `,
    onchain: `
      <div class="slx-gg-card">
        <h4>⚙️ Zero-Server Browser-to-WASM32 Compiler</h4>
        <ul>
          <li>Emits pure MVP WebAssembly 1.0 machine code (<code>~1.7 KiB</code>) importing Lexicon host syscalls (<code>host_state_get</code>, <code>host_state_set</code>, <code>host_emit_event</code>, <code>host_get_code_hash</code>) and validating client-side via <code>WebAssembly.validate()</code>.</li>
        </ul>
      </div>
    `,
  },
};

registerSlxUseCaseDocs('hfs-studio', {
  hasGameGuide: true,
  description: {
    icon: '🛠️',
    title: 'HFS WonderLab Studio — Visual Block-to-WASM App IDE',
    href: '/hfs-studio.html',
    tagline:
      'Browser-native visual no-code / low-code IDE compiling Scratch-style logic blocks into deterministic wasm32 Halt-Free Subroutines and 0x0101 UI bundles with 1-click Subnet 1 deployment.',
    featurePills: [
      { label: 'In-Browser WASM32 Compiler (~1.7 KiB)', tone: 'emerald' },
      { label: 'Scratch-Style Visual Rule Blocks', tone: 'violet' },
      { label: 'Live WASM Tablet Simulator', tone: 'cyan' },
      { label: 'Live Rust hps_sdk Code Peek', tone: 'amber' },
      { label: '1-Click 0x0100 + 0x0101 Publish', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛠️ Democratizing Halt-Free Subroutine Creation</div>
          <p>
            <strong>HFS WonderLab Studio</strong> lets children, classrooms, and creators author and deploy real
            on-chain applications from any browser without installing Rust, CLI toolchains, or cloud servers.
          </p>
        </div>
      `,
      primitives: `
        <div class="slx-ucd-card">
          <h4>⚙️ Direct Block-to-WASM32 Bytecode Synthesis</h4>
          <ul>
            <li>Compiles up to 4 per-player or shared-world <code>i64</code> state slots, bounded arithmetic effects, atomic guard reverts (<code>Err(-10)</code>), Identity HFS verification (<code>Err(-40)</code>), and indexed <code>ActionExecuted</code> events into ~1.7 KiB of native <code>wasm32</code>.</li>
          </ul>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead><tr><th>Artifact</th><th>Destination</th></tr></thead>
          <tbody>
            <tr><td>Compiled <code>.wasm</code> (<code>~1.7 KiB</code>)</td><td>Uploaded to <code>BYTECODE_STORE</code> (<code>0x0100</code>) &amp; instantiated on Subnet 1.</td></tr>
            <tr><td>Animated <code>.html.gz</code> (<code>~3.4 KiB</code>)</td><td>Uploaded to <code>UI_BUNDLE_STORE</code> (<code>0x0101</code>) &amp; registered in <code>AppStore</code>.</td></tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-card">
          <h4>✅ Zero-Trust Sandbox Execution</h4>
          <ul>
            <li>Published community apps run inside capability-scoped sandboxed iframes (<code>APP_EXEC_MODE.SANDBOX_IFRAME</code>) communicating exclusively via <code>window.slx</code>.</li>
          </ul>
        </div>
      `,
    },
  },
});

// ---------------------------------------------------------------------------
// Visual Themes, Emoji Palettes & 6 Starter Blueprints
// ---------------------------------------------------------------------------

const APP_ICONS = ['🐾', '🌱', '🍕', '🚀', '🐉', '🦄', '🤖', '🦖', '🎮', '🧁', '🌈', '⚡', '🏆', '🐠', '🧪', '🎨'];
const MASCOT_EMOJIS = ['🐹', '🐣', '🦄', '🐉', '🤖', '🦖', '🦊', '🐙', '🌳', '🛸', '🍕', '💎'];

const COLOR_THEMES = {
  emerald: { name: '🌿 Emerald Lagoon', bg1: '#051923', bg2: '#072f28', accent: '#10b981', glow: '#34d399', card: '#0b2530' },
  cyber: { name: '⚡ Cyber Neon', bg1: '#070b1e', bg2: '#0f1738', accent: '#0ea5e9', glow: '#38bdf8', card: '#111c3a' },
  sunset: { name: '🍭 Candy Sunset', bg1: '#1f091d', bg2: '#2d1220', accent: '#f43f5e', glow: '#fb7185', card: '#2b1228' },
  violet: { name: '🔮 Cosmic Violet', bg1: '#110826', bg2: '#1e1040', accent: '#a855f7', glow: '#c084fc', card: '#1c1238' },
  solar: { name: '☀️ Solar Gold', bg1: '#1c1204', bg2: '#291b06', accent: '#f59e0b', glow: '#fbbf24', card: '#261a09' },
};

const STAGE_MODES = [
  { id: 'mascot', icon: '🐾', label: 'Bouncing Mascot' },
  { id: 'garden', icon: '🌱', label: 'Growing World' },
  { id: 'poll', icon: '📊', label: 'Live Poll Race' },
  { id: 'boss', icon: '⚔️', label: 'Boss Raid' },
];

const STARTER_BLUEPRINTS = [
  {
    id: 'cyber-pet',
    icon: '🐾',
    title: 'Cyber-Hamster Sanctuary',
    sub: 'Feed, play & evolve your pet!',
    project: {
      slug: 'cyber-hamster-pet',
      title: 'Cyber-Hamster Sanctuary',
      icon: '🐾',
      mascot: '🐹',
      theme: 'emerald',
      stageMode: 'mascot',
      category: 5,
      requireIdentity: true,
      summary: 'Adopt an on-chain Cyber-Hamster! Balance snacks, naps, and fetch to evolve your pet to 100 Happiness!',
      variables: [
        { icon: '🍎', name: 'Fullness', initial: 60, min: 0, max: 100, shared: false },
        { icon: '⚡', name: 'Energy', initial: 75, min: 0, max: 100, shared: false },
        { icon: '💖', name: 'Happiness', initial: 45, min: 0, max: 100, shared: false },
        { icon: '🍪', name: 'Class Treat Jar', initial: 10, min: 0, max: 999, shared: true },
      ],
      actions: [
        {
          icon: '🌻',
          label: 'Feed Sunflower Snack',
          points: 15,
          guard: { enabled: false, varIdx: 0, op: '>=', value: 0 },
          effects: [
            { varIdx: 0, op: 'add', amount: 25 },
            { varIdx: 1, op: 'add', amount: 10 },
            { varIdx: 3, op: 'add', amount: 1 },
          ],
        },
        {
          icon: '🎾',
          label: 'Play Super Fetch',
          points: 25,
          guard: { enabled: true, varIdx: 1, op: '>=', value: 20 },
          effects: [
            { varIdx: 2, op: 'add', amount: 25 },
            { varIdx: 1, op: 'sub', amount: 20 },
            { varIdx: 0, op: 'sub', amount: 10 },
          ],
        },
        {
          icon: '😴',
          label: 'Cozy Wheel Nap',
          points: 10,
          guard: { enabled: false, varIdx: 1, op: '>=', value: 0 },
          effects: [
            { varIdx: 1, op: 'add', amount: 40 },
            { varIdx: 0, op: 'sub', amount: 10 },
          ],
        },
        {
          icon: '👑',
          label: 'Golden Evolution!',
          points: 100,
          guard: { enabled: true, varIdx: 2, op: '>=', value: 80 },
          effects: [
            { varIdx: 2, op: 'set', amount: 100 },
            { varIdx: 1, op: 'set', amount: 100 },
          ],
        },
      ],
      goal: { varIdx: 2, op: '>=', target: 100, banner: '🎉 GOLDEN HAMSTER EVOLVED! Best Pet Trainer!' },
    },
  },
  {
    id: 'class-forest',
    icon: '🌱',
    title: 'Class Magic Forest',
    sub: 'Shared multiplayer eco-world!',
    project: {
      slug: 'class-magic-forest',
      title: 'Class Magic Forest',
      icon: '🌱',
      mascot: '🌳',
      theme: 'emerald',
      stageMode: 'garden',
      category: 5,
      requireIdentity: true,
      summary: 'Multiplayer classroom forest! Every student plants trees, collects rainwater, and attracts honeybees together on Subnet 1!',
      variables: [
        { icon: '🌳', name: 'Living Trees', initial: 4, min: 0, max: 50, shared: true },
        { icon: '💧', name: 'Rainwater Tank', initial: 50, min: 0, max: 100, shared: true },
        { icon: '🐝', name: 'Pollinator Bees', initial: 15, min: 0, max: 100, shared: true },
        { icon: '🍎', name: 'Fruit Harvest', initial: 0, min: 0, max: 500, shared: true },
      ],
      actions: [
        {
          icon: '🌧️',
          label: 'Catch Raincloud',
          points: 10,
          guard: { enabled: false, varIdx: 1, op: '>=', value: 0 },
          effects: [{ varIdx: 1, op: 'add', amount: 30 }],
        },
        {
          icon: '🌱',
          label: 'Plant Magic Sapling',
          points: 25,
          guard: { enabled: true, varIdx: 1, op: '>=', value: 15 },
          effects: [
            { varIdx: 0, op: 'add', amount: 2 },
            { varIdx: 1, op: 'sub', amount: 15 },
            { varIdx: 2, op: 'add', amount: 6 },
          ],
        },
        {
          icon: '🌸',
          label: 'Plant Wildflowers',
          points: 20,
          guard: { enabled: false, varIdx: 2, op: '>=', value: 0 },
          effects: [
            { varIdx: 2, op: 'add', amount: 15 },
            { varIdx: 3, op: 'add', amount: 10 },
          ],
        },
        {
          icon: '🧺',
          label: 'Big Orchard Harvest',
          points: 50,
          guard: { enabled: true, varIdx: 0, op: '>=', value: 10 },
          effects: [
            { varIdx: 3, op: 'add', amount: 35 },
            { varIdx: 1, op: 'sub', amount: 10 },
          ],
        },
      ],
      goal: { varIdx: 0, op: '>=', target: 20, banner: '🌲 ENCHANTED FOREST COMPLETE! 20 Living Trees!' },
    },
  },
  {
    id: 'pizza-vote',
    icon: '🍕',
    title: 'Class Party Poll',
    sub: 'Live animated vote race!',
    project: {
      slug: 'friday-party-poll',
      title: 'Friday Class Party Poll',
      icon: '🍕',
      mascot: '🍕',
      theme: 'solar',
      stageMode: 'poll',
      category: 4,
      requireIdentity: true,
      summary: 'Vote on Subnet 1 for Friday’s classroom treat and watch the live bar-race update across everyone’s screen!',
      variables: [
        { icon: '🍕', name: 'Cheese Pizza', initial: 2, min: 0, max: 500, shared: true },
        { icon: '🌮', name: 'Crispy Tacos', initial: 2, min: 0, max: 500, shared: true },
        { icon: '🍦', name: 'Ice Cream Sundae', initial: 2, min: 0, max: 500, shared: true },
        { icon: '🧁', name: 'Rainbow Cupcakes', initial: 2, min: 0, max: 500, shared: true },
      ],
      actions: [
        {
          icon: '🍕',
          label: 'Vote Cheese Pizza!',
          points: 10,
          guard: { enabled: false, varIdx: 0, op: '>=', value: 0 },
          effects: [{ varIdx: 0, op: 'add', amount: 1 }],
        },
        {
          icon: '🌮',
          label: 'Vote Crispy Tacos!',
          points: 10,
          guard: { enabled: false, varIdx: 1, op: '>=', value: 0 },
          effects: [{ varIdx: 1, op: 'add', amount: 1 }],
        },
        {
          icon: '🍦',
          label: 'Vote Ice Cream!',
          points: 10,
          guard: { enabled: false, varIdx: 2, op: '>=', value: 0 },
          effects: [{ varIdx: 2, op: 'add', amount: 1 }],
        },
        {
          icon: '🧁',
          label: 'Vote Cupcakes!',
          points: 10,
          guard: { enabled: false, varIdx: 3, op: '>=', value: 0 },
          effects: [{ varIdx: 3, op: 'add', amount: 1 }],
        },
      ],
      goal: { varIdx: 0, op: '>=', target: 10, banner: '🏆 10 VOTES REACHED! Party Winner Crowned!' },
    },
  },
  {
    id: 'space-miner',
    icon: '🚀',
    title: 'Star-Crystal Miner',
    sub: 'Mine asteroids & manage fuel!',
    project: {
      slug: 'star-crystal-miner',
      title: 'Star-Crystal Asteroid Miner',
      icon: '🚀',
      mascot: '🛸',
      theme: 'cyber',
      stageMode: 'mascot',
      category: 5,
      requireIdentity: true,
      summary: 'Pilot a deep-space mining pod! Balance solar laser fuel and hull shields to collect 100 Star-Crystals!',
      variables: [
        { icon: '💎', name: 'Star-Crystals', initial: 0, min: 0, max: 200, shared: false },
        { icon: '🔋', name: 'Laser Battery', initial: 80, min: 0, max: 100, shared: false },
        { icon: '🛡️', name: 'Hull Shield', initial: 90, min: 0, max: 100, shared: false },
        { icon: '🌌', name: 'Fleet Vault', initial: 0, min: 0, max: 5000, shared: true },
      ],
      actions: [
        {
          icon: '⛏️',
          label: 'Drill Crystal Asteroid',
          points: 25,
          guard: { enabled: true, varIdx: 1, op: '>=', value: 20 },
          effects: [
            { varIdx: 0, op: 'add', amount: 30 },
            { varIdx: 1, op: 'sub', amount: 20 },
            { varIdx: 2, op: 'sub', amount: 10 },
          ],
        },
        {
          icon: '☀️',
          label: 'Unfold Solar Sails',
          points: 10,
          guard: { enabled: false, varIdx: 1, op: '>=', value: 0 },
          effects: [{ varIdx: 1, op: 'add', amount: 45 }],
        },
        {
          icon: '🔧',
          label: 'Nano-Bot Hull Repair',
          points: 15,
          guard: { enabled: true, varIdx: 1, op: '>=', value: 15 },
          effects: [
            { varIdx: 2, op: 'add', amount: 35 },
            { varIdx: 1, op: 'sub', amount: 15 },
          ],
        },
        {
          icon: '🛸',
          label: 'Beam Crystals to Mothership',
          points: 60,
          guard: { enabled: true, varIdx: 0, op: '>=', value: 50 },
          effects: [
            { varIdx: 3, op: 'add', amount: 50 },
            { varIdx: 0, op: 'add', amount: 20 },
          ],
        },
      ],
      goal: { varIdx: 0, op: '>=', target: 100, banner: '🚀 100 STAR-CRYSTALS MINED! Ace Star-Captain!' },
    },
  },
  {
    id: 'dragon-boss',
    icon: '🐉',
    title: 'Co-Op Dragon Raid',
    sub: 'Team up to drop Boss HP to 0!',
    project: {
      slug: 'coop-dragon-raid',
      title: 'Co-Op Lava Dragon Raid',
      icon: '🐉',
      mascot: '🐉',
      theme: 'sunset',
      stageMode: 'boss',
      category: 5,
      requireIdentity: true,
      summary: 'Cooperative multiplayer raid! Charge your mana and team up to bring the Shared Lava Dragon down from 300 HP to 0!',
      variables: [
        { icon: '🐉', name: 'Dragon Boss HP', initial: 300, min: 0, max: 300, shared: true },
        { icon: '🔮', name: 'Hero Mana', initial: 60, min: 0, max: 100, shared: false },
        { icon: '⚡', name: 'Team Combo Charge', initial: 10, min: 0, max: 100, shared: true },
        { icon: '🛡️', name: 'Party Shield', initial: 80, min: 0, max: 100, shared: true },
      ],
      actions: [
        {
          icon: '❄️',
          label: 'Cast Ice Bolt',
          points: 25,
          guard: { enabled: true, varIdx: 1, op: '>=', value: 15 },
          effects: [
            { varIdx: 0, op: 'sub', amount: 45 },
            { varIdx: 1, op: 'sub', amount: 15 },
            { varIdx: 2, op: 'add', amount: 20 },
          ],
        },
        {
          icon: '🧪',
          label: 'Drink Mana Potion',
          points: 10,
          guard: { enabled: false, varIdx: 1, op: '>=', value: 0 },
          effects: [
            { varIdx: 1, op: 'add', amount: 45 },
            { varIdx: 3, op: 'add', amount: 15 },
          ],
        },
        {
          icon: '🌟',
          label: 'Ultimate Team Meteor!',
          points: 90,
          guard: { enabled: true, varIdx: 2, op: '>=', value: 40 },
          effects: [
            { varIdx: 0, op: 'sub', amount: 120 },
            { varIdx: 2, op: 'sub', amount: 40 },
          ],
        },
        {
          icon: '🔄',
          label: 'Summon New Dragon (Respawn)',
          points: 5,
          guard: { enabled: true, varIdx: 0, op: '<=', value: 0 },
          effects: [{ varIdx: 0, op: 'set', amount: 300 }],
        },
      ],
      goal: { varIdx: 0, op: '<=', target: 0, banner: '🏆 LAVA DRAGON DEFEATED! Victory Treasure Unlocked!' },
    },
  },
  {
    id: 'blank',
    icon: '✨',
    title: 'Blank WonderApp',
    sub: 'Invent your own from scratch!',
    project: {
      slug: 'my-wonder-app',
      title: 'My First HFS WonderApp',
      icon: '🦄',
      mascot: '🦄',
      theme: 'violet',
      stageMode: 'mascot',
      category: 5,
      requireIdentity: true,
      summary: 'A custom Halt-Free Subroutine app built with visual blocks in HFS WonderLab!',
      variables: [
        { icon: '⭐', name: 'Magic Stars', initial: 10, min: 0, max: 100, shared: false },
        { icon: '⚡', name: 'Spark Power', initial: 50, min: 0, max: 100, shared: false },
      ],
      actions: [
        {
          icon: '✨',
          label: 'Gather Starlight',
          points: 15,
          guard: { enabled: false, varIdx: 0, op: '>=', value: 0 },
          effects: [
            { varIdx: 0, op: 'add', amount: 20 },
            { varIdx: 1, op: 'add', amount: 10 },
          ],
        },
        {
          icon: '🌈',
          label: 'Rainbow Boost!',
          points: 40,
          guard: { enabled: true, varIdx: 1, op: '>=', value: 30 },
          effects: [
            { varIdx: 0, op: 'add', amount: 35 },
            { varIdx: 1, op: 'sub', amount: 30 },
          ],
        },
      ],
      goal: { varIdx: 0, op: '>=', target: 100, banner: '🌈 100 MAGIC STARS! You Built a Blockchain Game!' },
    },
  },
];

// ---------------------------------------------------------------------------
// Pure-Browser `wasm32` Halt-Free Subroutine Bytecode Compiler (`~1.7 KiB`)
// ---------------------------------------------------------------------------

function uleb(val) {
  let n = Number(val) >>> 0;
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

function sleb32(val) {
  let n = val | 0;
  const out = [];
  while (true) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

function sleb64(val) {
  let n = BigInt(val);
  const out = [];
  while (true) {
    const b = Number(n & 0x7fn);
    n >>= 7n;
    if ((n === 0n && (b & 0x40) === 0) || (n === -1n && (b & 0x40) !== 0)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

const i32c = (v) => [0x41, ...sleb32(v)];
const i64c = (v) => [0x42, ...sleb64(v)];

function encodeStr(s) {
  const b = Array.from(utf8ToBytes(s));
  return [...uleb(b.length), ...b];
}

function encodeSection(secId, payloadBytes) {
  return [secId, ...uleb(payloadBytes.length), ...payloadBytes];
}

function encodeFuncType(params, results) {
  return [0x60, ...uleb(params.length), ...params, ...uleb(results.length), ...results];
}

function encodeFuncBody(localsGroups, instrBytes) {
  const body = [
    ...uleb(localsGroups.length),
    ...localsGroups.flatMap(([cnt, typ]) => [...uleb(cnt), typ]),
    ...instrBytes,
    0x0b,
  ];
  return [...uleb(body.length), ...body];
}

function selToI32(sig) {
  const b = selectorBytes(sig);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) | 0;
}

const I32 = 0x7f;
const I64 = 0x7e;

export const TOPIC_STUDIO_ACTION = keccak256Hex(
  utf8ToBytes('ActionExecuted(address,bytes)')
).toLowerCase();

export function compileStudioProjectToWasm(project) {
  const rawVars = (project.variables || []).slice(0, 4);
  const varCount = Math.max(1, Math.min(4, rawVars.length || 1));
  const vars = [0, 1, 2, 3].map((i) => {
    const v = rawVars[i] || { initial: 0, min: 0, max: 100, shared: false };
    const min = BigInt(Math.round(Number(v.min ?? 0)));
    const max = BigInt(Math.max(Number(min), Math.round(Number(v.max ?? 100))));
    const init = BigInt(Math.max(Number(min), Math.min(Number(max), Math.round(Number(v.initial ?? 0)))));
    return { init, min, max, shared: Boolean(v.shared) ? 1 : 0 };
  });

  const actions = (project.actions || []).slice(0, 6).map((a) => ({
    points: BigInt(Math.max(0, Math.round(Number(a.points ?? 10)))),
    hasGuard: Boolean(a.guard && a.guard.enabled),
    guardVar: Math.max(0, Math.min(varCount - 1, Number(a.guard?.varIdx ?? 0))),
    guardOp: a.guard?.op === '<=' ? '<=' : '>=',
    guardVal: BigInt(Math.round(Number(a.guard?.value ?? 0))),
    effects: (a.effects || []).slice(0, 4).map((e) => ({
      varIdx: Math.max(0, Math.min(varCount - 1, Number(e.varIdx ?? 0))),
      op: e.op === 'sub' ? 'sub' : e.op === 'set' ? 'set' : 'add',
      amount: BigInt(Math.round(Number(e.amount ?? 10))),
    })),
  }));

  const goal = {
    varIdx: Math.max(0, Math.min(varCount - 1, Number(project.goal?.varIdx ?? 0))),
    op: project.goal?.op === '<=' ? '<=' : '>=',
    target: BigInt(Math.round(Number(project.goal?.target ?? 100))),
  };

  const requireIdentity = project.requireIdentity !== false;
  const slugSaltHex = keccak256Hex(utf8ToBytes(`${project.slug || 'app'}:${project.title || ''}`));
  const saltByte = parseInt(slugSaltHex.slice(2, 4), 16) & 0xff;

  const SEL_GET_STATE = selToI32('getState(address)');
  const SEL_RUN_ACTION = selToI32('runAction(uint64)');
  const SEL_RESET = selToI32('resetMyState()');

  const types = [
    encodeFuncType([I32, I32], [I32]), // 0: host_state_get, host_get_code_hash, main
    encodeFuncType([I32, I32, I32, I32], []), // 1: host_state_set, host_emit_event
    encodeFuncType([I32], [I32]), // 2: get_calldata, $read_be32
    encodeFuncType([I32], []), // 3: get_msg_sender, get_block_number
    encodeFuncType([I32, I32, I64], [I64]), // 4: $load_var
    encodeFuncType([I32, I32, I64], []), // 5: $save_var
    encodeFuncType([I64, I64, I64], [I64]), // 6: $clamp64
    encodeFuncType([I32, I64], []), // 7: $write_be64
    encodeFuncType([I64, I64, I64, I64, I64, I64, I32, I32], [I32]), // 8: $finish_snapshot
  ];
  const secTypes = encodeSection(1, [...uleb(types.length), ...types.flat()]);

  // Imports 0..6
  const impSpecs = [
    ['host_state_get', 0], // 0
    ['host_state_set', 1], // 1
    ['get_calldata', 2], // 2
    ['get_msg_sender', 3], // 3
    ['get_block_number', 3], // 4
    ['host_emit_event', 1], // 5
    ['host_get_code_hash', 0], // 6
  ];
  const secImports = encodeSection(2, [
    ...uleb(impSpecs.length),
    ...impSpecs.flatMap(([name, tIdx]) => [...encodeStr('env'), ...encodeStr(name), 0x00, ...uleb(tIdx)]),
  ]);

  // Internal Functions 7..13 (7=$read_be32, 8=$write_be64, 9=$clamp64, 10=$load_var, 11=$save_var, 12=$finish, 13=main)
  const funcTypeIdxs = [2, 7, 6, 4, 5, 8, 0];
  const secFuncs = encodeSection(3, [...uleb(funcTypeIdxs.length), ...funcTypeIdxs]);
  const secMem = encodeSection(5, [0x01, 0x01, ...uleb(32), ...uleb(32)]);
  const secExports = encodeSection(7, [
    ...uleb(2),
    ...encodeStr('memory'), 0x02, ...uleb(0),
    ...encodeStr('main'), 0x00, ...uleb(13),
  ]);

  const copy20 = (srcPtr, dstPtr) => [
    ...i32c(dstPtr), ...i32c(srcPtr), 0x29, 0x00, 0x00, 0x37, 0x00, 0x00,
    ...i32c(dstPtr + 8), ...i32c(srcPtr + 8), 0x29, 0x00, 0x00, 0x37, 0x00, 0x00,
    ...i32c(dstPtr + 16), ...i32c(srcPtr + 16), 0x28, 0x00, 0x00, 0x36, 0x00, 0x00,
  ];

  // Func 7: $read_be32
  const fReadBe32 = encodeFuncBody([], [
    0x20, 0x00, 0x2d, 0x00, 0x00, ...i32c(24), 0x74,
    0x20, 0x00, 0x2d, 0x00, 0x01, ...i32c(16), 0x74, 0x72,
    0x20, 0x00, 0x2d, 0x00, 0x02, ...i32c(8), 0x74, 0x72,
    0x20, 0x00, 0x2d, 0x00, 0x03, 0x72,
  ]);

  // Func 8: $write_be64
  const fWriteBe64 = encodeFuncBody(
    [],
    [0, 1, 2, 3, 4, 5, 6, 7].flatMap((bIdx) => [
      0x20, 0x00,
      0x20, 0x01,
      ...i64c((7 - bIdx) * 8),
      0x88,
      0x3d, 0x00, ...uleb(bIdx),
    ])
  );

  // Func 9: $clamp64
  const fClamp64 = encodeFuncBody([], [
    0x20, 0x00, 0x20, 0x01, 0x53,
    0x04, I64, 0x20, 0x01, 0x05, 0x20, 0x00, 0x0b,
    0x22, 0x00,
    0x20, 0x02, 0x55,
    0x04, I64, 0x20, 0x02, 0x05, 0x20, 0x00, 0x0b,
  ]);

  const buildKeyInstructions = [
    ...i32c(0x30000), ...i32c(0x3a6b), 0x3b, 0x00, 0x00,
    ...i32c(0x30002), 0x20, 0x01, 0x3a, 0x00, 0x00,
    ...i32c(0x30003), 0x20, 0x00, 0x3a, 0x00, 0x00,
    0x20, 0x01,
    0x04, I32,
    ...i32c(4),
    0x05,
    ...copy20(0x20000, 0x30004),
    ...i32c(24),
    0x0b,
    0x21, 0x03,
  ];

  // Func 10: $load_var
  const fLoadVar = encodeFuncBody([[1, I32]], [
    ...buildKeyInstructions,
    ...i32c(0x30000), 0x20, 0x03, 0x10, ...uleb(0),
    ...i32c(8), 0x4e,
    0x04, I64,
    ...i32c(0x40000), 0x29, 0x00, 0x00,
    0x05,
    0x20, 0x02,
    0x0b,
  ]);

  // Func 11: $save_var
  const fSaveVar = encodeFuncBody([[1, I32]], [
    ...buildKeyInstructions,
    ...i32c(0x00810), 0x20, 0x02, 0x37, 0x00, 0x00,
    ...i32c(0x30000), 0x20, 0x03, ...i32c(0x00810), ...i32c(8), 0x10, ...uleb(1),
  ]);

  // Func 12: $finish_snapshot
  const goalCmpOpcode = goal.op === '<=' ? 0x57 : 0x59;
  const fFinish = encodeFuncBody([[1, I32]], [
    ...i32c(0x50000), 0x20, 0x00, 0x10, ...uleb(8),
    ...i32c(0x50008), 0x20, 0x01, 0x10, ...uleb(8),
    ...i32c(0x50010), 0x20, 0x02, 0x10, ...uleb(8),
    ...i32c(0x50018), 0x20, 0x03, 0x10, ...uleb(8),
    ...i32c(0x50020), 0x20, 0x04, 0x10, ...uleb(8),
    ...i32c(0x50028), 0x20, 0x05, 0x10, ...uleb(8),
    ...i32c(0x00800), 0x10, ...uleb(4),
    ...i32c(0x50030), ...i32c(0x00800), 0x29, 0x00, 0x00, 0x37, 0x00, 0x00,
    0x20, ...uleb(goal.varIdx), ...i64c(goal.target), goalCmpOpcode, 0x21, 0x08,
    ...i32c(0x50038), ...i32c(1), 0x3a, 0x00, 0x00,
    ...i32c(0x50039), ...i32c(varCount), 0x3a, 0x00, 0x00,
    ...i32c(0x5003a), ...i32c(actions.length), 0x3a, 0x00, 0x00,
    ...i32c(0x5003b), 0x20, 0x08, 0x3a, 0x00, 0x00,
    ...i32c(0x5003c), 0x20, 0x06, 0x3a, 0x00, 0x00,
    ...i32c(0x5003d), ...i32c(goal.varIdx), 0x3a, 0x00, 0x00,
    ...i32c(0x5003e), ...i32c(requireIdentity ? 1 : 0), 0x3a, 0x00, 0x00,
    ...i32c(0x5003f), ...i32c(saltByte), 0x3a, 0x00, 0x00,
    0x20, 0x07,
    0x04, 0x40,
    ...i32c(0x60020), ...i64c(0), 0x37, 0x00, 0x00,
    ...i32c(0x60028), ...i32c(0), 0x36, 0x00, 0x00,
    ...copy20(0x20000, 0x6002c),
    ...i32c(0x60000), ...i32c(64), ...i32c(0x50000), ...i32c(64), 0x10, ...uleb(5),
    0x0b,
    ...i32c(0x70000), ...i32c(64), 0x36, 0x00, 0x00,
    ...[0, 8, 16, 24, 32, 40, 48, 56].flatMap((off) => [
      ...i32c(0x70004 + off),
      ...i32c(0x50000 + off),
      0x29, 0x00, 0x00,
      0x37, 0x00, 0x00,
    ]),
    ...i32c(64),
  ]);

  const loadAllStateIntoLocals = [
    ...i32c(0), ...i32c(vars[0].shared), ...i64c(vars[0].init), 0x10, ...uleb(10), 0x21, 5,
    ...i32c(1), ...i32c(vars[1].shared), ...i64c(vars[1].init), 0x10, ...uleb(10), 0x21, 6,
    ...i32c(2), ...i32c(vars[2].shared), ...i64c(vars[2].init), 0x10, ...uleb(10), 0x21, 7,
    ...i32c(3), ...i32c(vars[3].shared), ...i64c(vars[3].init), 0x10, ...uleb(10), 0x21, 8,
    ...i32c(100), ...i32c(0), ...i64c(0), 0x10, ...uleb(10), 0x21, 9,
    ...i32c(101), ...i32c(1), ...i64c(0), 0x10, ...uleb(10), 0x21, 10,
  ];

  // Optional Layer-1 Identity HFS Contract Gate (`host_get_code_hash(msg.sender) == 1` -> else Err(-40)!)
  const identityGateInstructions = requireIdentity
    ? [
        ...copy20(0x20000, 0x20040),
        ...i32c(0x20040), ...i32c(0x20060), 0x10, ...uleb(6), // call host_get_code_hash
        ...i32c(1), 0x47, // i32.ne 1
        0x04, 0x40, ...i32c(-40), 0x0f, 0x0b, // return -40!
      ]
    : [];

  const actionBranches = actions.flatMap((act, k) => {
    const guardCode = act.hasGuard
      ? [
          0x20, ...uleb(5 + act.guardVar),
          ...i64c(act.guardVal),
          act.guardOp === '<=' ? 0x55 : 0x53,
          0x04, 0x40, ...i32c(-10), 0x0f, 0x0b,
        ]
      : [];

    const effectsCode = act.effects.flatMap((ef) => {
      const locIdx = 5 + ef.varIdx;
      const vSpec = vars[ef.varIdx];
      const mathExpr =
        ef.op === 'set'
          ? [...i64c(ef.amount)]
          : ef.op === 'sub'
          ? [0x20, ...uleb(locIdx), ...i64c(ef.amount), 0x7d]
          : [0x20, ...uleb(locIdx), ...i64c(ef.amount), 0x7c];
      return [
        ...mathExpr,
        ...i64c(vSpec.min),
        ...i64c(vSpec.max),
        0x10, ...uleb(9), // $clamp64
        0x21, ...uleb(locIdx),
      ];
    });

    const saveModifiedVars = [0, 1, 2, 3].flatMap((vi) => [
      ...i32c(vi),
      ...i32c(vars[vi].shared),
      0x20, ...uleb(5 + vi),
      0x10, ...uleb(11), // $save_var
    ]);

    return [
      0x20, 4, ...i32c(k), 0x46,
      0x04, 0x40,
      ...guardCode,
      ...effectsCode,
      ...saveModifiedVars,
      0x20, 9, ...i64c(act.points), 0x7c, 0x21, 9,
      ...i32c(100), ...i32c(0), 0x20, 9, 0x10, ...uleb(11),
      0x20, 10, ...i64c(1), 0x7c, 0x21, 10,
      ...i32c(101), ...i32c(1), 0x20, 10, 0x10, ...uleb(11),
      0x20, 5, 0x20, 6, 0x20, 7, 0x20, 8, 0x20, 9, 0x20, 10,
      ...i32c(k), ...i32c(1), 0x10, ...uleb(12), 0x0f,
      0x0b,
    ];
  });

  const resetPerPlayerVars = [0, 1, 2, 3].flatMap((vi) =>
    vars[vi].shared
      ? []
      : [
          ...i64c(vars[vi].init), 0x21, ...uleb(5 + vi),
          ...i32c(vi), ...i32c(0), 0x20, ...uleb(5 + vi), 0x10, ...uleb(11),
        ]
  );

  // Func 13: main
  const fMain = encodeFuncBody(
    [
      [3, I32],
      [6, I64],
    ],
    [
      ...i32c(0x10000), 0x10, ...uleb(2), 0x22, 2,
      ...i32c(4), 0x48, 0x04, 0x40, ...i32c(-1), 0x0f, 0x0b,
      ...i32c(0x10000), 0x10, ...uleb(7), 0x21, 3,

      // getState(address)
      0x20, 3, ...i32c(SEL_GET_STATE), 0x46,
      0x04, 0x40,
      0x20, 2, ...i32c(36), 0x4e,
      0x04, 0x40,
      ...copy20(0x10010, 0x20000),
      0x05,
      ...i32c(0x20000), 0x10, ...uleb(3),
      0x0b,
      ...loadAllStateIntoLocals,
      0x20, 5, 0x20, 6, 0x20, 7, 0x20, 8, 0x20, 9, 0x20, 10,
      ...i32c(255), ...i32c(0), 0x10, ...uleb(12), 0x0f,
      0x0b,

      // runAction(uint64)
      0x20, 3, ...i32c(SEL_RUN_ACTION), 0x46,
      0x04, 0x40,
      0x20, 2, ...i32c(36), 0x48, 0x04, 0x40, ...i32c(-2), 0x0f, 0x0b,
      ...i32c(0x20000), 0x10, ...uleb(3),
      ...identityGateInstructions,
      ...i32c(0x10020), 0x10, ...uleb(7), 0x21, 4,
      ...loadAllStateIntoLocals,
      ...actionBranches,
      ...i32c(-11), 0x0f,
      0x0b,

      // resetMyState()
      0x20, 3, ...i32c(SEL_RESET), 0x46,
      0x04, 0x40,
      ...i32c(0x20000), 0x10, ...uleb(3),
      ...identityGateInstructions,
      ...loadAllStateIntoLocals,
      ...resetPerPlayerVars,
      ...i64c(0), 0x21, 9,
      ...i32c(100), ...i32c(0), ...i64c(0), 0x10, ...uleb(11),
      0x20, 10, ...i64c(1), 0x7c, 0x21, 10,
      ...i32c(101), ...i32c(1), 0x20, 10, 0x10, ...uleb(11),
      0x20, 5, 0x20, 6, 0x20, 7, 0x20, 8, 0x20, 9, 0x20, 10,
      ...i32c(254), ...i32c(1), 0x10, ...uleb(12), 0x0f,
      0x0b,

      ...i32c(-2),
    ]
  );

  const bodies = [fReadBe32, fWriteBe64, fClamp64, fLoadVar, fSaveVar, fFinish, fMain];
  const secCode = encodeSection(10, [...uleb(bodies.length), ...bodies.flat()]);

  const topicBytes = Array.from(hexToBytes(TOPIC_STUDIO_ACTION));
  const secData = encodeSection(11, [
    0x01,
    0x00,
    ...i32c(0x60000), 0x0b,
    ...uleb(32),
    ...topicBytes,
  ]);

  const wasm = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...secTypes,
    ...secImports,
    ...secFuncs,
    ...secMem,
    ...secExports,
    ...secCode,
    ...secData,
  ]);

  if (!WebAssembly.validate(wasm)) {
    throw new Error('WASM validation failed');
  }
  return wasm;
}

// ---------------------------------------------------------------------------
// Educational Rust `hps_sdk` Code Generator (Live Peek Tab!)
// ---------------------------------------------------------------------------

function generateRustHfsPreview(project) {
  const vars = project.variables || [];
  const acts = project.actions || [];
  const g = project.goal || { varIdx: 0, op: '>=', target: 100 };
  const gVar = vars[g.varIdx]?.name || 'Var0';

  const varComments = vars
    .map(
      (v, i) =>
        `// Slot ${i}: ${v.icon} ${v.name} (init=${v.initial}, min=${v.min}, max=${v.max}, scope=${
          v.shared ? 'SharedWorld' : 'PerPlayer'
        })`
    )
    .join('\n');

  const actArms = acts
    .map((a, idx) => {
      const guardLine =
        a.guard && a.guard.enabled
          ? `        if v[${a.guard.varIdx}] ${a.guard.op === '<=' ? '>' : '<'} ${a.guard.value} { return Err(-10); // Guard lock! }\n`
          : '';
      const effLines = (a.effects || [])
        .map((e) => {
          const vn = `v[${e.varIdx}]`;
          const lim = vars[e.varIdx] || { min: 0, max: 100 };
          const expr =
            e.op === 'set'
              ? `${e.amount}`
              : e.op === 'sub'
              ? `${vn} - ${e.amount}`
              : `${vn} + ${e.amount}`;
          return `        ${vn} = (${expr}).clamp(${lim.min}, ${lim.max});`;
        })
        .join('\n');
      return `      ${idx} => { // ${a.icon} ${a.label}\n${guardLine}${effLines}\n        score += ${a.points};\n      }`;
    })
    .join('\n');

  return `//! Auto-Generated Halt-Free Subroutine: ${project.title} (${project.slug})
#![cfg_attr(target_arch = "wasm32", no_std)]
use hps_sdk::{context, events, hps_entry, ret, storage};

${varComments}

hps_entry! {
    "getState(address)" => handle_get_state,
    "runAction(uint64)" => handle_run_action,
    "resetMyState()"    => handle_reset_my_state,
}

fn handle_run_action(args: &hps_sdk::abi::CalldataReader) -> Result<i32, i32> {
    let caller = context::msg_sender();${
      project.requireIdentity !== false
        ? '\n    if context::code_hash_of(&caller).is_none() { return Err(-40); // Require Identity HFS! }'
        : ''
    }
    let action_id = args.u64(0).ok_or(-2)?;
    let (mut v, mut score, mut txs) = load_state(&caller);

    match action_id {
${actArms}
      _ => return Err(-11),
    }

    txs += 1;
    let goal_reached = v[${g.varIdx}] ${g.op} ${g.target}; // Goal on ${gVar}
    let snap = save_and_pack(&caller, &v, score, txs, goal_reached);
    events::emit(&[EV_ACTION_EXECUTED, addr_topic(&caller)], &snap);
    ret::write(&snap);
    Ok(64)
}`;
}

// ---------------------------------------------------------------------------
// Self-Contained Animated App HTML Generator (`generateDeployedAppHtml`)
// ---------------------------------------------------------------------------

function generateDeployedAppHtml(project) {
  const th = COLOR_THEMES[project.theme] || COLOR_THEMES.emerald;
  const specJson = JSON.stringify({
    slug: project.slug,
    title: project.title,
    icon: project.icon,
    mascot: project.mascot || project.icon || '🐾',
    stageMode: project.stageMode || 'mascot',
    summary: project.summary || '',
    variables: (project.variables || []).slice(0, 4),
    actions: (project.actions || []).slice(0, 6),
    goal: project.goal || { varIdx: 0, op: '>=', target: 100, banner: '🎉 GOAL REACHED!' },
    topicAction: TOPIC_STUDIO_ACTION,
  }).replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(project.icon)} ${escapeHtml(project.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 14px; min-height: 100vh;
      background: linear-gradient(160deg, ${th.bg1} 0%, ${th.bg2} 100%);
      color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;
    }
    .app-wrap { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 11px; }
    .hdr {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
      padding: 11px 14px; border-radius: 14px; background: ${th.card};
      border: 1.5px solid ${th.accent}66;
    }
    .title { font-size: 1.08rem; font-weight: 900; display: flex; align-items: center; gap: 8px; }
    .pill {
      padding: 4px 10px; border-radius: 999px; font-family: monospace; font-size: 0.74rem; font-weight: 800;
      background: rgba(0,0,0,0.38); border: 1px solid ${th.glow}88; color: #fff;
    }
    .stage-box {
      position: relative; border-radius: 15px; overflow: hidden;
      border: 1.5px solid ${th.glow}66; background: #030914;
    }
    canvas { display: block; width: 100%; height: auto; aspect-ratio: 760 / 230; }
    .win-banner {
      display: none; padding: 9px 14px; border-radius: 12px; font-weight: 900; text-align: center;
      background: linear-gradient(90deg, #059669, #d97706); border: 1.5px solid #fde047; color: #fff;
      font-size: 0.88rem; box-shadow: 0 0 22px rgba(250,204,21,0.45);
    }
    .vars-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 8px; }
    .var-card {
      padding: 9px 11px; border-radius: 12px; background: ${th.card};
      border: 1px solid rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 5px;
    }
    .var-top { display: flex; justify-content: space-between; align-items: center; font-size: 0.77rem; font-weight: 800; }
    .scope-tag { font-size: 0.62rem; opacity: 0.78; font-family: monospace; }
    .bar-bg { height: 8px; border-radius: 999px; background: rgba(0,0,0,0.45); overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, ${th.accent}, ${th.glow}); transition: width 0.45s ease; }
    .acts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 9px; }
    .act-btn {
      padding: 11px 12px; border-radius: 12px; border: 1.5px solid ${th.glow}77;
      background: rgba(10, 20, 38, 0.86); color: #fff; font-family: inherit; text-align: left;
      cursor: pointer; transition: transform 0.12s ease, border-color 0.12s ease;
      display: flex; flex-direction: column; gap: 4px;
    }
    .act-btn:hover:not(:disabled) { transform: translateY(-2px); border-color: #fde047; background: rgba(18, 34, 60, 0.95); }
    .act-btn:disabled { opacity: 0.48; cursor: not-allowed; }
    .act-lbl { font-size: 0.85rem; font-weight: 900; }
    .act-sub { font-size: 0.69rem; color: #cbd5e1; font-family: monospace; }
    .foot {
      display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 8px 11px; border-radius: 10px; background: rgba(0,0,0,0.35); font-family: monospace; font-size: 0.7rem; color: #94a3b8;
    }
    .mini-btn {
      padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25);
      background: rgba(255,255,255,0.08); color: #e2e8f0; font-family: monospace; font-size: 0.7rem; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="app-wrap">
    <div class="hdr">
      <div>
        <div class="title"><span>${escapeHtml(project.icon)}</span><span>${escapeHtml(project.title)}</span></div>
        <div style="font-size:0.74rem;color:#cbd5e1;margin-top:2px;">${escapeHtml(project.summary || '')}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span class="pill" id="scorePill">🏅 0 pts</span>
        <span class="pill" id="txPill">⛓️ 0 Txs</span>
      </div>
    </div>

    <div class="win-banner" id="winBanner"></div>

    <div class="stage-box">
      <canvas id="stageCanvas" width="760" height="230"></canvas>
    </div>

    <div class="vars-grid" id="varsMount"></div>
    <div class="acts-grid" id="actsMount"></div>

    <div class="foot">
      <span id="statusLine">⛓️ Connecting to Halt-Free Subroutine…</span>
      <button type="button" class="mini-btn" id="btnReset">↺ Reset My State</button>
    </div>
  </div>

  <script>
    const SPEC = ${specJson};
    let state = {
      vars: SPEC.variables.map(v => v.initial),
      score: 0,
      txs: 0,
      blk: 0,
      goalHit: 0,
      busy: false
    };
    let viewerAddr = '0x0000000000000000000000000000000000000000';
    let bounceUntil = 0;
    const popups = [];
    const confetti = [];

    function hexToU8(h) {
      const s = String(h || '').replace(/^0x/, '');
      if (s.length < 2) return new Uint8Array(0);
      const out = new Uint8Array(s.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    function readI64BE(u8, off) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      return Number(dv.getBigInt64(off, false));
    }

    function applySnapBytes(u8, triggerFx) {
      if (!u8 || u8.length < 64) return false;
      state.vars = SPEC.variables.map((_, i) => readI64BE(u8, i * 8));
      state.score = readI64BE(u8, 32);
      state.txs = readI64BE(u8, 40);
      state.blk = readI64BE(u8, 48);
      const wasGoal = state.goalHit;
      state.goalHit = u8[59];
      if (triggerFx) {
        bounceUntil = performance.now() + 900;
        if (state.goalHit && !wasGoal) {
          for (let i = 0; i < 42; i++) {
            confetti.push({
              x: 380 + (Math.random() - 0.5) * 260,
              y: 110,
              vx: (Math.random() - 0.5) * 220,
              vy: -90 - Math.random() * 130,
              c: ['#fde047','#34d399','#38bdf8','#fb7185','#c084fc'][i % 5],
              born: performance.now()
            });
          }
        }
      }
      renderUi();
      return true;
    }

    async function refreshFromHfs() {
      if (!window.slx) return;
      try {
        const ctx = await window.slx.getContext();
        viewerAddr = ctx.user?.identityAddr || ctx.user?.eoa || viewerAddr;
        const hex = await window.slx.callContract('getState(address)', [['address', viewerAddr]]);
        if (hex && hex !== '0x') {
          applySnapBytes(hexToU8(hex), false);
          document.getElementById('statusLine').textContent =
            '✓ Synced HFS State (' + (ctx.user?.nickname || 'Explorer') + ')';
        }
      } catch (e) {
        document.getElementById('statusLine').textContent = '🌱 Ready — click an action button below!';
      }
    }

    async function triggerAction(idx) {
      if (state.busy || !window.slx) return;
      const act = SPEC.actions[idx];
      if (act.guard && act.guard.enabled) {
        const curV = state.vars[act.guard.varIdx] ?? 0;
        const ok = act.guard.op === '<=' ? curV <= act.guard.value : curV >= act.guard.value;
        if (!ok) {
          const vn = SPEC.variables[act.guard.varIdx]?.name || 'Stat';
          popups.push({ text: '🔒 Need ' + vn + ' ' + act.guard.op + ' ' + act.guard.value + '!', c: '#fda4af', born: performance.now() });
          document.getElementById('statusLine').textContent = '🔒 Guard lock: Need ' + vn + ' ' + act.guard.op + ' ' + act.guard.value;
          return;
        }
      }
      state.busy = true;
      renderUi();
      document.getElementById('statusLine').textContent = '⛓️ Confirming "' + act.label + '" on Subnet 1…';
      try {
        const res = await window.slx.sendTransaction({
          fnSig: 'runAction(uint64)',
          args: [['uint64', idx]],
          summary: act.icon + ' ' + act.label
        });
        let appliedFromEvent = false;
        if (Array.isArray(res?.logs)) {
          const hit = res.logs.find(l => String(l.topics?.[0] || '').toLowerCase() === SPEC.topicAction);
          if (hit?.data) appliedFromEvent = applySnapBytes(hexToU8(hit.data), true);
        }
        if (!appliedFromEvent) {
          await refreshFromHfs();
          bounceUntil = performance.now() + 900;
        }
        popups.push({ text: act.icon + ' +' + act.points + ' pts!', c: '#fde047', born: performance.now() });
        document.getElementById('statusLine').textContent =
          '✓ Confirmed @ Blk #' + (res.blockNumber || state.blk) + ' (Emitted ActionExecuted)';
      } catch (e) {
        document.getElementById('statusLine').textContent = '⚠ ' + (e.message || e);
      } finally {
        state.busy = false;
        renderUi();
      }
    }

    document.getElementById('btnReset').onclick = async () => {
      if (state.busy || !window.slx) return;
      state.busy = true;
      renderUi();
      try {
        const res = await window.slx.sendTransaction({ fnSig: 'resetMyState()', args: [], summary: 'Reset personal state' });
        if (Array.isArray(res?.logs)) {
          const hit = res.logs.find(l => String(l.topics?.[0] || '').toLowerCase() === SPEC.topicAction);
          if (hit?.data) applySnapBytes(hexToU8(hit.data), true);
        } else {
          await refreshFromHfs();
        }
        document.getElementById('statusLine').textContent = '↺ Personal state reset on-chain!';
      } catch (e) {
        document.getElementById('statusLine').textContent = '⚠ ' + (e.message || e);
      } finally {
        state.busy = false;
        renderUi();
      }
    };

    function renderUi() {
      document.getElementById('scorePill').textContent = '🏅 ' + state.score + ' pts';
      document.getElementById('txPill').textContent = '⛓️ ' + state.txs + ' Txs';
      const wb = document.getElementById('winBanner');
      wb.style.display = state.goalHit ? 'block' : 'none';
      wb.textContent = SPEC.goal.banner || '🎉 VICTORY GOAL ACHIEVED!';

      document.getElementById('varsMount').innerHTML = SPEC.variables.map((v, i) => {
        const val = state.vars[i] ?? v.initial;
        const span = Math.max(1, (v.max ?? 100) - (v.min ?? 0));
        const pct = Math.max(0, Math.min(100, Math.round(((val - (v.min ?? 0)) / span) * 100)));
        return '<div class="var-card">' +
          '<div class="var-top"><span>' + v.icon + ' ' + v.name + '</span><span>' + val + '</span></div>' +
          '<div class="bar-bg"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="scope-tag">' + (v.shared ? '🌍 Shared World' : '👤 Personal') + ' · [' + v.min + '..' + v.max + ']</div>' +
        '</div>';
      }).join('');

      document.getElementById('actsMount').innerHTML = SPEC.actions.map((a, i) => {
        const gTxt = a.guard && a.guard.enabled
          ? '🔒 ' + (SPEC.variables[a.guard.varIdx]?.icon || '') + a.guard.op + a.guard.value + ' · '
          : '';
        const effTxt = (a.effects || []).map(e => {
          const vi = SPEC.variables[e.varIdx]?.icon || '';
          return vi + (e.op === 'sub' ? '-' : e.op === 'set' ? '=' : '+') + e.amount;
        }).join(' ');
        return '<button type="button" class="act-btn" ' + (state.busy ? 'disabled' : '') + ' onclick="triggerAction(' + i + ')">' +
          '<span class="act-lbl">' + a.icon + ' ' + a.label + '</span>' +
          '<span class="act-sub">' + gTxt + effTxt + ' (+' + a.points + ' pts)</span>' +
        '</button>';
      }).join('');
    }
    window.triggerAction = triggerAction;

    // 60-FPS Animated Stage Canvas
    let lastMs = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - lastMs) / 1000);
      lastMs = now;
      const t = now / 1000;
      const cv = document.getElementById('stageCanvas');
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;

      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '${th.bg1}');
      grad.addColorStop(1, '${th.bg2}');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Twinkling stars / particles
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (let i = 0; i < 18; i++) {
        const sx = (i * 97 + t * 14) % W;
        const sy = 20 + ((i * 43) % (H - 55));
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5 + (i % 2), 0, Math.PI * 2);
        ctx.fill();
      }

      const bounce = now < bounceUntil ? Math.abs(Math.sin(t * 18)) * 22 : Math.sin(t * 3) * 6;

      if (SPEC.stageMode === 'poll') {
        const maxV = Math.max(1, ...state.vars);
        SPEC.variables.forEach((v, idx) => {
          const val = state.vars[idx] ?? 0;
          const bw = Math.max(28, ((W - 220) * val) / maxV);
          const y = 26 + idx * 47;
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.fillRect(160, y, W - 200, 32);
          ctx.fillStyle = ['#34d399','#38bdf8','#fbbf24','#fb7185'][idx % 4];
          ctx.fillRect(160, y, bw, 32);
          ctx.font = 'bold 14px sans-serif';
          ctx.fillStyle = '#fff';
          ctx.fillText(v.icon + ' ' + v.name.slice(0, 14), 18, y + 21);
          ctx.fillText(String(val), 168 + bw, y + 21);
        });
      } else if (SPEC.stageMode === 'garden') {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
        ctx.fillRect(0, H - 42, W, 42);
        const count = Math.max(1, Math.min(28, Number(state.vars[0] || 1)));
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < count; i++) {
          const gx = 48 + ((i * 67) % (W - 96));
          const gy = H - 36 - (i % 3) * 14 + Math.sin(t * 2.5 + i) * 3;
          ctx.fillText(SPEC.mascot, gx, gy);
        }
        ctx.textAlign = 'left';
      } else if (SPEC.stageMode === 'boss') {
        const hp = Math.max(0, state.vars[0] ?? 0);
        const maxHp = Math.max(1, SPEC.variables[0]?.max || 300);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(180, 22, 400, 18);
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(180, 22, 400 * Math.min(1, hp / maxHp), 18);
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('BOSS HP: ' + hp + ' / ' + maxHp, 380, 35);
        ctx.font = hp <= 0 ? '54px sans-serif' : '74px sans-serif';
        ctx.fillText(hp <= 0 ? '🏆' : SPEC.mascot, 380, 148 - bounce);
        ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.ellipse(W / 2, 186, 85, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '76px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.goalHit ? '👑' : SPEC.mascot, W / 2, 162 - bounce);
        ctx.textAlign = 'left';
      }

      // Confetti & Popups
      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        if (now - p.born > 2600) { confetti.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 210 * dt;
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, 7, 7);
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        const age = (now - p.born) / 1800;
        if (age >= 1) { popups.splice(i, 1); continue; }
        ctx.globalAlpha = 1 - age;
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = p.c;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, W / 2, 76 - age * 38);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(loop);
    }

    renderUi();
    requestAnimationFrame(loop);
    refreshFromHfs();
    if (window.slx?.onNewBlock) {
      window.slx.onNewBlock(() => { if (!state.busy) refreshFromHfs(); });
    }
  <\/script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// In-Browser WASM Virtual Host (Powers the Live Tablet Test Playground!)
// ---------------------------------------------------------------------------

class InMemoryWasmSandboxHost {
  constructor(wasmBytes) {
    this.kv = new Map();
    this.blockNumber = 1;
    this.lastEvents = [];
    this.calldata = new Uint8Array(0);
    this.sender = hexToBytes('0x1111111111111111111111111111111111111111');
    this.memory = null;

    const mod = new WebAssembly.Module(wasmBytes);
    this.instance = new WebAssembly.Instance(mod, {
      env: {
        host_state_get: (kPtr, kLen) => {
          const mem = new Uint8Array(this.memory.buffer);
          const keyHex = bytesToHex(mem.subarray(kPtr, kPtr + kLen));
          const val = this.kv.get(keyHex);
          if (!val) return 0;
          mem.set(val, 0x40000);
          return val.length;
        },
        host_state_set: (kPtr, kLen, vPtr, vLen) => {
          const mem = new Uint8Array(this.memory.buffer);
          const keyHex = bytesToHex(mem.subarray(kPtr, kPtr + kLen));
          if (vLen <= 0) this.kv.delete(keyHex);
          else this.kv.set(keyHex, mem.slice(vPtr, vPtr + vLen));
        },
        get_calldata: (bufPtr) => {
          const mem = new Uint8Array(this.memory.buffer);
          mem.set(this.calldata, bufPtr);
          return this.calldata.length;
        },
        get_msg_sender: (bufPtr) => {
          const mem = new Uint8Array(this.memory.buffer);
          mem.set(this.sender, bufPtr);
        },
        get_block_number: (bufPtr) => {
          const dv = new DataView(this.memory.buffer);
          dv.setBigUint64(bufPtr, BigInt(this.blockNumber), false);
        },
        host_emit_event: (tPtr, tLen, dPtr, dLen) => {
          const mem = new Uint8Array(this.memory.buffer);
          const topics = [];
          for (let off = 0; off + 32 <= tLen; off += 32) {
            topics.push(bytesToHex(mem.slice(tPtr + off, tPtr + off + 32)).toLowerCase());
          }
          const data = bytesToHex(mem.slice(dPtr, dPtr + dLen));
          this.lastEvents.push({ topics, data });
        },
        host_get_code_hash: (_addrPtr, outPtr) => {
          // Simulate player's deployed Identity HFS contract having non-zero codeHash!
          const mem = new Uint8Array(this.memory.buffer);
          mem.fill(0xab, outPtr, outPtr + 32);
          return 1;
        },
      },
    });
    this.memory = this.instance.exports.memory;
  }

  invoke(calldataHex, isWrite = false) {
    this.calldata = hexToBytes(calldataHex);
    this.lastEvents = [];
    if (isWrite) this.blockNumber += 1;
    const rc = this.instance.exports.main(0, 0);
    if (rc < 0) {
      throw new Error(`HFS Guard / Revert (code ${rc})`);
    }
    const dv = new DataView(this.memory.buffer);
    const retLen = dv.getUint32(0x70000, true);
    const retBytes = new Uint8Array(this.memory.buffer, 0x70004, retLen);
    return {
      returnHex: bytesToHex(retBytes),
      logs: [...this.lastEvents],
      blockNumber: this.blockNumber,
    };
  }
}

// ---------------------------------------------------------------------------
// Studio Runtime State & UI Rendering
// ---------------------------------------------------------------------------

const rpcUrl = getDefaultNodeWsUrl();
const wallet = new SlxWalletManager();
const slxClient = new SlxClient(rpcUrl);
const storeClient = new AppStoreClient({ rpcUrl });

let activeTemplateId = 'cyber-pet';
let activeStep = 'look'; // 'look' | 'vars' | 'actions' | 'code'
let activeCodeTab = 'rust'; // 'rust' | 'wasm' | 'html'
let project = JSON.parse(JSON.stringify(STARTER_BLUEPRINTS[0].project));

let latestArtifacts = {
  wasmBytes: new Uint8Array(0),
  wasmCodeHash: '',
  htmlSource: '',
  gzBytes: new Uint8Array(0),
  uiHash: '',
};
let simHost = null;
let simBridgeListener = null;
let deployBusy = false;
let lastPublishedMeta = null;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const el = document.getElementById('wsToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('is-visible'), 4000);
}

function slugify(str) {
  return String(str || 'my-app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38) || 'my-app';
}

async function recompileAndRefreshSimulator({ reloadIframe = true } = {}) {
  try {
    const wasmBytes = compileStudioProjectToWasm(project);
    const wasmCodeHash = keccak256Hex(wasmBytes);
    const htmlSource = generateDeployedAppHtml(project);
    const packed = await compressAppUiBundle(htmlSource);

    latestArtifacts = {
      wasmBytes,
      wasmCodeHash,
      htmlSource,
      gzBytes: packed.bytes,
      uiHash: packed.uiHash,
    };

    document.getElementById('lblCompilerBadge').textContent =
      `⚙️ WASM VALID ✓ · ${(wasmBytes.length / 1024).toFixed(2)} KiB WASM + ${(packed.compressedLen / 1024).toFixed(1)} KiB UI`;
    document.getElementById('compilerHashesMount').innerHTML = `
      <span>🦀 wasmHash: <strong style="color:#7dd3fc;">${shortHex(wasmCodeHash, 8, 6)}</strong></span>
      <span>•</span>
      <span>🎨 uiHash: <strong style="color:#6ee7b7;">${shortHex(packed.uiHash, 8, 6)}</strong></span>
      <span>•</span>
      <span>📡 1 Radio Chunk · $0.00 Gas</span>
    `;

    if (reloadIframe) {
      mountLiveTabletSimulator();
    }
    if (activeStep === 'code') {
      renderBuilderPanel();
    }
  } catch (err) {
    showToast(`Compiler check: ${err.message || err}`);
  }
}

function mountLiveTabletSimulator() {
  const iframe = document.getElementById('studioPreviewIframe');
  if (!iframe || !latestArtifacts.wasmBytes.length) return;

  simHost = new InMemoryWasmSandboxHost(latestArtifacts.wasmBytes);
  document.getElementById('lblTabletUrl').textContent = `🧪 WASM Playground · /${project.slug}.html`;

  if (simBridgeListener) {
    window.removeEventListener('message', simBridgeListener);
  }

  simBridgeListener = (ev) => {
    if (ev.source !== iframe.contentWindow) return;
    const msg = ev.data;
    if (!msg || msg.__slxBridge !== 'guest->host') return;
    const { id, method, params = {} } = msg;
    const reply = (result, error = null) => {
      iframe.contentWindow?.postMessage(
        { __slxBridge: 'host->guest', type: 'response', id, result, error },
        '*'
      );
    };

    try {
      if (method === 'getContext') {
        const idRec = wallet.getIdentityRecord();
        reply({
          slug: project.slug,
          title: project.title,
          user: {
            eoa: '0x1111111111111111111111111111111111111111',
            identityAddr: '0x1111111111111111111111111111111111111111',
            nickname: idRec?.nickname || 'YoungCreator',
          },
        });
        return;
      }
      if (method === 'callContract') {
        const cd = encodeAbi(params.fnSig, params.args || []);
        const out = simHost.invoke(cd, false);
        reply(out.returnHex);
        return;
      }
      if (method === 'sendTransaction') {
        const cd = params.data || encodeAbi(params.fnSig, params.args || []);
        const out = simHost.invoke(cd, true);
        reply({
          txHash: keccak256Hex(utf8ToBytes(`sim:${Date.now()}`)),
          status: '0x1',
          blockNumber: out.blockNumber,
          logs: out.logs,
        });
        return;
      }
      reply(null);
    } catch (err) {
      reply(null, err.message || String(err));
    }
  };

  window.addEventListener('message', simBridgeListener);
  iframe.srcdoc = buildSandboxedIframeSrcdoc(latestArtifacts.htmlSource);
}

// ---------------------------------------------------------------------------
// Builder UI Panels (Steps 1..4)
// ---------------------------------------------------------------------------

function renderTemplatePills() {
  const mount = document.getElementById('templatePillsMount');
  if (!mount) return;
  mount.innerHTML = STARTER_BLUEPRINTS.map(
    (tpl) => `
    <button type="button" class="ws-tpl-card ${activeTemplateId === tpl.id ? 'is-selected' : ''}" data-tpl-id="${tpl.id}">
      <span class="ws-tpl-icon">${tpl.icon}</span>
      <div style="min-width:0;">
        <div class="ws-tpl-title">${escapeHtml(tpl.title)}</div>
        <div class="ws-tpl-sub">${escapeHtml(tpl.sub)}</div>
      </div>
    </button>
  `
  ).join('');
}

function renderStepTabs() {
  document.querySelectorAll('#builderStepTabs .ws-step-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.step === activeStep);
  });
}

function renderBuilderPanel() {
  const panel = document.getElementById('builderPanelMount');
  if (!panel) return;

  if (activeStep === 'look') {
    panel.innerHTML = `
      <div class="ws-block ws-block-purple">
        <div class="ws-block-hdr">
          <div class="ws-block-title">🎨 App Identity &amp; Icon</div>
          <span class="ws-muted mono">Stored in AppStore on Subnet 1</span>
        </div>

        <div class="ws-field-grid">
          <label class="ws-label">
            <span>App Name</span>
            <input type="text" class="ws-in" id="inProjTitle" maxlength="44" value="${escapeHtml(project.title)}" />
          </label>
          <label class="ws-label">
            <span>URL Slug (e.g. /${escapeHtml(project.slug)}.html)</span>
            <input type="text" class="ws-in mono" id="inProjSlug" maxlength="38" value="${escapeHtml(project.slug)}" />
          </label>
        </div>

        <label class="ws-label">
          <span>Short Description (What does your app do?)</span>
          <input type="text" class="ws-in" id="inProjSummary" maxlength="140" value="${escapeHtml(project.summary)}" />
        </label>

        <div class="ws-label">
          <span>Pick App Store Icon</span>
          <div class="ws-emoji-grid">
            ${APP_ICONS.map(
              (em) =>
                `<button type="button" class="ws-emoji-btn ${project.icon === em ? 'is-picked' : ''}" data-pick-icon="${em}">${em}</button>`
            ).join('')}
          </div>
        </div>
      </div>

      <div class="ws-block ws-block-purple">
        <div class="ws-block-hdr">
          <div class="ws-block-title">🎬 Animated Stage Mode, Mascot &amp; Color Theme</div>
        </div>

        <div class="ws-label">
          <span>Animated Canvas Style</span>
          <div class="ws-stage-modes">
            ${STAGE_MODES.map(
              (sm) => `
              <button type="button" class="ws-choice-pill ${project.stageMode === sm.id ? 'is-picked' : ''}" data-pick-stage="${sm.id}">
                ${sm.icon} ${escapeHtml(sm.label)}
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div class="ws-label">
          <span>Stage Mascot / World Character</span>
          <div class="ws-emoji-grid">
            ${MASCOT_EMOJIS.map(
              (em) =>
                `<button type="button" class="ws-emoji-btn ${project.mascot === em ? 'is-picked' : ''}" data-pick-mascot="${em}">${em}</button>`
            ).join('')}
          </div>
        </div>

        <div class="ws-label">
          <span>Color Palette</span>
          <div class="ws-theme-pills" style="grid-template-columns:repeat(5,minmax(0,1fr));">
            ${Object.entries(COLOR_THEMES)
              .map(
                ([k, th]) => `
              <button type="button" class="ws-choice-pill ${project.theme === k ? 'is-picked' : ''}" data-pick-theme="${k}">
                ${escapeHtml(th.name)}
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <label class="ws-snap-row" style="cursor:pointer;">
          <input type="checkbox" id="chkRequireIdentity" ${project.requireIdentity !== false ? 'checked' : ''} />
          <span>🛡️ <strong>Require Verified Identity HFS Pass</strong> (Compiles Layer-1 <code>Err(-40)</code> anti-bot check into your WASM!)</span>
        </label>
      </div>
    `;
    return;
  }

  if (activeStep === 'vars') {
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <strong style="font-size:0.92rem;">📦 On-Chain Memory Boxes (${project.variables.length} / 4)</strong>
          <div class="ws-muted">Choose <strong>👤 Personal</strong> for individual pets/inventories, or <strong>🌍 Shared</strong> so everyone plays together!</div>
        </div>
        ${
          project.variables.length < 4
            ? `<button type="button" class="ws-btn ws-btn-add" id="btnAddVar">➕ Add Memory Box</button>`
            : ''
        }
      </div>

      ${project.variables
        .map(
          (v, idx) => `
        <div class="ws-block ws-block-blue">
          <div class="ws-block-hdr">
            <div class="ws-block-title">📦 Memory Box #${idx + 1}</div>
            ${
              project.variables.length > 1
                ? `<button type="button" class="ws-btn ws-btn-xs ws-btn-danger" data-del-var="${idx}">🗑 Remove</button>`
                : ''
            }
          </div>
          <div class="ws-snap-row">
            <span>Icon</span>
            <input type="text" class="ws-in ws-in-icon" maxlength="4" value="${escapeHtml(v.icon)}" data-var-field="icon" data-var-idx="${idx}" />
            <span>Name</span>
            <input type="text" class="ws-in" style="width:165px;" maxlength="24" value="${escapeHtml(v.name)}" data-var-field="name" data-var-idx="${idx}" />
            <span>Starts at</span>
            <input type="number" class="ws-in ws-in-sm" value="${v.initial}" data-var-field="initial" data-var-idx="${idx}" />
            <span>Min</span>
            <input type="number" class="ws-in ws-in-sm" value="${v.min}" data-var-field="min" data-var-idx="${idx}" />
            <span>Max</span>
            <input type="number" class="ws-in ws-in-sm" value="${v.max}" data-var-field="max" data-var-idx="${idx}" />
            <select class="ws-sel" data-var-field="shared" data-var-idx="${idx}">
              <option value="0" ${!v.shared ? 'selected' : ''}>👤 Each Player's Own</option>
              <option value="1" ${v.shared ? 'selected' : ''}>🌍 Shared Multiplayer</option>
            </select>
          </div>
        </div>
      `
        )
        .join('')}
    `;
    return;
  }

  if (activeStep === 'actions') {
    const varOptionsHtml = (selectedIdx) =>
      project.variables
        .map(
          (v, vi) =>
            `<option value="${vi}" ${Number(selectedIdx) === vi ? 'selected' : ''}>${escapeHtml(v.icon)} ${escapeHtml(v.name)}</option>`
        )
        .join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <strong style="font-size:0.92rem;">⚡ On-Chain Action Buttons (${project.actions.length} / 6)</strong>
          <div class="ws-muted">Every click sends a real <code>runAction</code> transaction to your WASM subroutine on Subnet 1!</div>
        </div>
        ${
          project.actions.length < 6
            ? `<button type="button" class="ws-btn ws-btn-add" id="btnAddAction">➕ Add Action Button</button>`
            : ''
        }
      </div>

      ${project.actions
        .map(
          (a, aIdx) => `
        <div class="ws-block ws-block-amber">
          <div class="ws-block-hdr">
            <div class="ws-block-title">⚡ Button #${aIdx + 1}: ${escapeHtml(a.icon)} ${escapeHtml(a.label)}</div>
            ${
              project.actions.length > 1
                ? `<button type="button" class="ws-btn ws-btn-xs ws-btn-danger" data-del-act="${aIdx}">🗑 Remove</button>`
                : ''
            }
          </div>

          <div class="ws-snap-row">
            <span>Button Emoji</span>
            <input type="text" class="ws-in ws-in-icon" maxlength="4" value="${escapeHtml(a.icon)}" data-act-field="icon" data-act-idx="${aIdx}" />
            <span>Label</span>
            <input type="text" class="ws-in" style="width:195px;" maxlength="28" value="${escapeHtml(a.label)}" data-act-field="label" data-act-idx="${aIdx}" />
            <span>🏅 Points</span>
            <input type="number" class="ws-in ws-in-sm" min="0" max="1000" value="${a.points}" data-act-field="points" data-act-idx="${aIdx}" />
          </div>

          <!-- Green Guard Condition Snap-Block -->
          <div class="ws-snap-row ws-snap-guard">
            <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" ${a.guard?.enabled ? 'checked' : ''} data-guard-field="enabled" data-act-idx="${aIdx}" />
              <span>🔒 Only allow if</span>
            </label>
            <select class="ws-sel" data-guard-field="varIdx" data-act-idx="${aIdx}">
              ${varOptionsHtml(a.guard?.varIdx ?? 0)}
            </select>
            <select class="ws-sel" data-guard-field="op" data-act-idx="${aIdx}">
              <option value=">=" ${a.guard?.op !== '<=' ? 'selected' : ''}>is at least (&ge;)</option>
              <option value="<=" ${a.guard?.op === '<=' ? 'selected' : ''}>is at most (&le;)</option>
            </select>
            <input type="number" class="ws-in ws-in-sm" value="${a.guard?.value ?? 15}" data-guard-field="value" data-act-idx="${aIdx}" />
          </div>

          <!-- Orange Effect Snap-Blocks -->
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${(a.effects || [])
              .map(
                (ef, eIdx) => `
              <div class="ws-snap-row ws-snap-effect">
                <span>👉 Then</span>
                <select class="ws-sel" data-eff-field="op" data-act-idx="${aIdx}" data-eff-idx="${eIdx}">
                  <option value="add" ${ef.op === 'add' ? 'selected' : ''}>➕ Increase</option>
                  <option value="sub" ${ef.op === 'sub' ? 'selected' : ''}>➖ Decrease</option>
                  <option value="set" ${ef.op === 'set' ? 'selected' : ''}>🎯 Set Exactly To</option>
                </select>
                <select class="ws-sel" data-eff-field="varIdx" data-act-idx="${aIdx}" data-eff-idx="${eIdx}">
                  ${varOptionsHtml(ef.varIdx)}
                </select>
                <span>by</span>
                <input type="number" class="ws-in ws-in-sm" value="${ef.amount}" data-eff-field="amount" data-act-idx="${aIdx}" data-eff-idx="${eIdx}" />
                ${
                  a.effects.length > 1
                    ? `<button type="button" class="ws-btn ws-btn-xs ws-btn-danger" data-del-eff="${eIdx}" data-act-idx="${aIdx}">✕</button>`
                    : ''
                }
              </div>
            `
              )
              .join('')}
            ${
              (a.effects || []).length < 4
                ? `<div><button type="button" class="ws-btn ws-btn-xs ws-btn-add" data-add-eff="${aIdx}">➕ Add Another Effect</button></div>`
                : ''
            }
          </div>
        </div>
      `
        )
        .join('')}
    `;
    return;
  }

  // Step 4: Goal & Code Peek!
  const varOptionsHtml = project.variables
    .map(
      (v, vi) =>
        `<option value="${vi}" ${Number(project.goal?.varIdx) === vi ? 'selected' : ''}>${escapeHtml(v.icon)} ${escapeHtml(v.name)}</option>`
    )
    .join('');

  let codePreviewText = '';
  if (activeCodeTab === 'rust') {
    codePreviewText = generateRustHfsPreview(project);
  } else if (activeCodeTab === 'wasm') {
    const hexStr = bytesToHex(latestArtifacts.wasmBytes, false);
    const lines = [];
    for (let i = 0; i < Math.min(hexStr.length, 1024); i += 64) {
      lines.push(`0x${(i / 2).toString(16).padStart(4, '0')}: ${hexStr.slice(i, i + 64).match(/.{1,4}/g).join(' ')}`);
    }
    codePreviewText =
      `// Validated Native WebAssembly 1.0 Halt-Free Subroutine Binary\n` +
      `// Total Size   : ${latestArtifacts.wasmBytes.length} bytes (${(latestArtifacts.wasmBytes.length / 1024).toFixed(2)} KiB)\n` +
      `// wasmCodeHash : ${latestArtifacts.wasmCodeHash}\n` +
      `// Exports      : memory (32 pages = 2 MiB), main(i32, i32) -> i32\n` +
      `// Imports      : env.{host_state_get, host_state_set, get_calldata, get_msg_sender, get_block_number, host_emit_event, host_get_code_hash}\n\n` +
      lines.join('\n') +
      (hexStr.length > 1024 ? `\n… (+${latestArtifacts.wasmBytes.length - 512} bytes)` : '');
  } else {
    codePreviewText = latestArtifacts.htmlSource;
  }

  panel.innerHTML = `
    <div class="ws-block ws-block-emerald">
      <div class="ws-block-hdr">
        <div class="ws-block-title">🏆 Victory &amp; Confetti Fireworks Goal</div>
      </div>
      <div class="ws-snap-row">
        <span>🎉 Celebrate Victory when</span>
        <select class="ws-sel" id="selGoalVar">${varOptionsHtml}</select>
        <select class="ws-sel" id="selGoalOp">
          <option value=">=" ${project.goal?.op !== '<=' ? 'selected' : ''}>reaches at least (&ge;)</option>
          <option value="<=" ${project.goal?.op === '<=' ? 'selected' : ''}>drops to (&le;)</option>
        </select>
        <input type="number" class="ws-in ws-in-sm" id="inGoalTarget" value="${project.goal?.target ?? 100}" />
      </div>
      <label class="ws-label">
        <span>Victory Banner Message</span>
        <input type="text" class="ws-in" id="inGoalBanner" maxlength="80" value="${escapeHtml(project.goal?.banner || '🎉 VICTORY!')}" />
      </label>
    </div>

    <div class="ws-block ws-block-blue">
      <div class="ws-block-hdr">
        <div class="ws-block-title">🔍 Peek Inside the Blockchain (Learn Real Code!)</div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="ws-btn ws-btn-xs" id="btnDlWasm">⬇ Download .wasm</button>
          <button type="button" class="ws-btn ws-btn-xs" id="btnDlGz">⬇ Download .html.gz</button>
        </div>
      </div>
      <div class="ws-code-tabs">
        <button type="button" class="ws-btn ws-btn-xs ${activeCodeTab === 'rust' ? 'ws-btn-add' : ''}" data-code-tab="rust">🦀 Equivalent Rust HFS</button>
        <button type="button" class="ws-btn ws-btn-xs ${activeCodeTab === 'wasm' ? 'ws-btn-add' : ''}" data-code-tab="wasm">⚙️ Compiled WASM (${latestArtifacts.wasmBytes.length} B)</button>
        <button type="button" class="ws-btn ws-btn-xs ${activeCodeTab === 'html' ? 'ws-btn-add' : ''}" data-code-tab="html">📄 Generated HTML UI</button>
      </div>
      <pre class="ws-code-pre mono">${escapeHtml(codePreviewText)}</pre>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 1-Click Subnet 1 Rocket Deployment (`0x0100` WASM + `0x0101` UI + `AppStore`)
// ---------------------------------------------------------------------------

function renderLaunchProgress(steps) {
  const box = document.getElementById('launchStepsBox');
  if (!box) return;
  box.style.display = 'flex';
  box.innerHTML = steps
    .map(
      (s) =>
        `<div class="mono" style="color:${s.done ? '#6ee7b7' : s.active ? '#7dd3fc' : '#64748b'};">` +
        `${s.done ? '✓' : s.active ? '⏳' : '○'} ${escapeHtml(s.text)}</div>`
    )
    .join('');
}

async function deployProjectToSubnet1() {
  if (deployBusy) return;
  project.slug = slugify(project.slug || project.title);
  await recompileAndRefreshSimulator({ reloadIframe: false });

  if (!latestArtifacts.wasmBytes.length || !latestArtifacts.gzBytes.length) {
    showToast('⚠ Compiler artifacts not ready yet.');
    return;
  }

  deployBusy = true;
  const btn = document.getElementById('btnDeployToSubnet');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🚀 Launching to Subnet 1…';
  }
  document.getElementById('deployedSuccessBox').style.display = 'none';

  const progress = [
    { text: `Step 1/4: Compiled ${latestArtifacts.wasmBytes.length}B Halt-Free WASM (${shortHex(latestArtifacts.wasmCodeHash)})`, done: true, active: false },
    { text: 'Step 2/4: Verifying Creator Identity HFS Pass…', done: false, active: true },
    { text: 'Step 3/4: Uploading WASM (0x0100), Instantiating HFS & Sealing UI (0x0101)…', done: false, active: false },
    { text: 'Step 4/4: Publishing App to Subnet 1 Decentralized AppStore…', done: false, active: false },
  ];
  renderLaunchProgress(progress);

  try {
    await wallet.ensureIdentityWithPrompt({
      rpcUrl,
      appName: 'HFS WonderLab Publisher',
    });
    progress[1].done = true;
    progress[1].active = false;
    progress[2].active = true;
    renderLaunchProgress(progress);

    const published = await storeClient.publishApp({
      wallet,
      slug: project.slug,
      title: project.title,
      summary: project.summary,
      icon: project.icon,
      version: '1.0.0',
      category: project.category || 5,
      execMode: APP_EXEC_MODE.SANDBOX_IFRAME,
      gzBytes: latestArtifacts.gzBytes,
      htmlSource: latestArtifacts.htmlSource,
      wasmBytes: latestArtifacts.wasmBytes,
      wasmCodeHash: latestArtifacts.wasmCodeHash,
      deployInstance: true,
      onStatus: (msg) => {
        if (msg.includes('AppStore')) {
          progress[2].done = true;
          progress[2].active = false;
          progress[3].active = true;
          renderLaunchProgress(progress);
        }
        showToast(`⛓️ ${msg}`);
      },
    });

    progress[2].done = true;
    progress[3].done = true;
    progress[3].active = false;
    renderLaunchProgress(progress);

    await SlxPersonalAppContainer.installApp(published, { storeClient, cacheHtml: false }).catch(() => {});
    lastPublishedMeta = published;

    const playHref = `/apps.html?run=${encodeURIComponent(published.slug)}`;
    const cleanRoute = `/${encodeURIComponent(published.slug)}.html`;
    const okBox = document.getElementById('deployedSuccessBox');
    okBox.style.display = 'flex';
    okBox.innerHTML = `
      <div style="font-weight:900;font-size:0.9rem;color:#ecfdf5;">
        🎉 "${escapeHtml(published.title)}" Is LIVE on Subnet 1!
      </div>
      <div class="mono" style="font-size:0.7rem;color:#a7f3d0;line-height:1.5;">
        HFS Contract : <strong>${published.defaultHfsAddr}</strong><br/>
        WASM (0x0100): ${shortHex(published.wasmCodeHash, 10, 8)}<br/>
        UI   (0x0101): ${shortHex(published.uiHash, 10, 8)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:2px;">
        <a href="${playHref}" class="ws-rocket-btn" style="padding:8px 14px;font-size:0.79rem;text-decoration:none;">
          🎮 Play My Live Blockchain App! →
        </a>
        <a href="${cleanRoute}" target="_blank" rel="noopener" class="ws-btn ws-btn-xs">
          🔗 Open ${escapeHtml(cleanRoute)} ↗
        </a>
      </div>
    `;
    showToast(`🎉 Deployed "${published.title}" to Subnet 1 @ ${shortHex(published.defaultHfsAddr)}!`);
  } catch (err) {
    showToast(`⚠ Deploy error: ${err?.message || err}`);
  } finally {
    deployBusy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Deploy to Subnet 1 ($0 Gas)';
    }
  }
}

// ---------------------------------------------------------------------------
// Event Delegation & Boot
// ---------------------------------------------------------------------------

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindEvents() {
  document.getElementById('btnDeployToSubnet')?.addEventListener('click', () => {
    deployProjectToSubnet1();
  });

  document.getElementById('btnResetSim')?.addEventListener('click', () => {
    mountLiveTabletSimulator();
    showToast('↺ Tablet Test Playground reset!');
  });

  document.addEventListener('click', async (ev) => {
    const tplBtn = ev.target.closest('[data-tpl-id]');
    if (tplBtn) {
      const id = tplBtn.getAttribute('data-tpl-id');
      const found = STARTER_BLUEPRINTS.find((t) => t.id === id);
      if (found) {
        activeTemplateId = id;
        project = JSON.parse(JSON.stringify(found.project));
        // Add random 3-digit suffix on remix so multiple kids don't collide on slug!
        const rand3 = Math.floor(100 + Math.random() * 900);
        project.slug = `${found.project.slug}-${rand3}`;
        document.getElementById('deployedSuccessBox').style.display = 'none';
        document.getElementById('launchStepsBox').style.display = 'none';
        renderTemplatePills();
        renderBuilderPanel();
        await recompileAndRefreshSimulator();
      }
      return;
    }

    const stepBtn = ev.target.closest('[data-step]');
    if (stepBtn) {
      activeStep = stepBtn.getAttribute('data-step');
      renderStepTabs();
      renderBuilderPanel();
      return;
    }

    const iconBtn = ev.target.closest('[data-pick-icon]');
    if (iconBtn) {
      project.icon = iconBtn.getAttribute('data-pick-icon');
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const mascotBtn = ev.target.closest('[data-pick-mascot]');
    if (mascotBtn) {
      project.mascot = mascotBtn.getAttribute('data-pick-mascot');
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const stageBtn = ev.target.closest('[data-pick-stage]');
    if (stageBtn) {
      project.stageMode = stageBtn.getAttribute('data-pick-stage');
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const themeBtn = ev.target.closest('[data-pick-theme]');
    if (themeBtn) {
      project.theme = themeBtn.getAttribute('data-pick-theme');
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    if (ev.target.closest('#btnAddVar') && project.variables.length < 4) {
      project.variables.push({ icon: '✨', name: `Stat ${project.variables.length + 1}`, initial: 25, min: 0, max: 100, shared: false });
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const delVar = ev.target.closest('[data-del-var]');
    if (delVar && project.variables.length > 1) {
      const idx = Number(delVar.getAttribute('data-del-var'));
      project.variables.splice(idx, 1);
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    if (ev.target.closest('#btnAddAction') && project.actions.length < 6) {
      project.actions.push({
        icon: '⚡',
        label: `New Action ${project.actions.length + 1}`,
        points: 15,
        guard: { enabled: false, varIdx: 0, op: '>=', value: 10 },
        effects: [{ varIdx: 0, op: 'add', amount: 15 }],
      });
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const delAct = ev.target.closest('[data-del-act]');
    if (delAct && project.actions.length > 1) {
      project.actions.splice(Number(delAct.getAttribute('data-del-act')), 1);
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const addEff = ev.target.closest('[data-add-eff]');
    if (addEff) {
      const aIdx = Number(addEff.getAttribute('data-add-eff'));
      project.actions[aIdx].effects.push({ varIdx: 0, op: 'add', amount: 10 });
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    const delEff = ev.target.closest('[data-del-eff]');
    if (delEff) {
      const aIdx = Number(delEff.getAttribute('data-act-idx'));
      const eIdx = Number(delEff.getAttribute('data-del-eff'));
      if (project.actions[aIdx].effects.length > 1) {
        project.actions[aIdx].effects.splice(eIdx, 1);
        renderBuilderPanel();
        await recompileAndRefreshSimulator();
      }
      return;
    }

    const codeTab = ev.target.closest('[data-code-tab]');
    if (codeTab) {
      activeCodeTab = codeTab.getAttribute('data-code-tab');
      renderBuilderPanel();
      return;
    }

    if (ev.target.closest('#btnDlWasm')) {
      downloadBytes(latestArtifacts.wasmBytes, `${project.slug}.wasm`, 'application/wasm');
      return;
    }
    if (ev.target.closest('#btnDlGz')) {
      downloadBytes(latestArtifacts.gzBytes, `${project.slug}.html.gz`, 'application/gzip');
    }
  });

  document.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'inProjTitle') {
      project.title = t.value.trim() || 'My HFS App';
      project.slug = slugify(project.title) + '-' + Math.floor(100 + Math.random() * 900);
      const slugIn = document.getElementById('inProjSlug');
      if (slugIn) slugIn.value = project.slug;
      await recompileAndRefreshSimulator();
      return;
    }
    if (t.id === 'inProjSlug') {
      project.slug = slugify(t.value);
      t.value = project.slug;
      await recompileAndRefreshSimulator();
      return;
    }
    if (t.id === 'inProjSummary') {
      project.summary = t.value;
      await recompileAndRefreshSimulator();
      return;
    }
    if (t.id === 'chkRequireIdentity') {
      project.requireIdentity = t.checked;
      await recompileAndRefreshSimulator();
      return;
    }

    if (t.hasAttribute('data-var-field')) {
      const idx = Number(t.getAttribute('data-var-idx'));
      const f = t.getAttribute('data-var-field');
      const v = project.variables[idx];
      if (!v) return;
      if (f === 'icon' || f === 'name') v[f] = t.value;
      else if (f === 'shared') v.shared = t.value === '1';
      else v[f] = Number(t.value || 0);
      await recompileAndRefreshSimulator();
      return;
    }

    if (t.hasAttribute('data-act-field')) {
      const idx = Number(t.getAttribute('data-act-idx'));
      const f = t.getAttribute('data-act-field');
      const a = project.actions[idx];
      if (!a) return;
      if (f === 'points') a.points = Math.max(0, Number(t.value || 0));
      else a[f] = t.value;
      renderBuilderPanel();
      await recompileAndRefreshSimulator();
      return;
    }

    if (t.hasAttribute('data-guard-field')) {
      const idx = Number(t.getAttribute('data-act-idx'));
      const f = t.getAttribute('data-guard-field');
      const g = (project.actions[idx].guard = project.actions[idx].guard || { enabled: false, varIdx: 0, op: '>=', value: 10 });
      if (f === 'enabled') g.enabled = t.checked;
      else if (f === 'op') g.op = t.value;
      else g[f] = Number(t.value || 0);
      await recompileAndRefreshSimulator();
      return;
    }

    if (t.hasAttribute('data-eff-field')) {
      const aIdx = Number(t.getAttribute('data-act-idx'));
      const eIdx = Number(t.getAttribute('data-eff-idx'));
      const f = t.getAttribute('data-eff-field');
      const ef = project.actions[aIdx]?.effects?.[eIdx];
      if (!ef) return;
      if (f === 'op') ef.op = t.value;
      else ef[f] = Number(t.value || 0);
      await recompileAndRefreshSimulator();
      return;
    }

    if (t.id === 'selGoalVar') {
      project.goal.varIdx = Number(t.value || 0);
      await recompileAndRefreshSimulator();
      return;
    }
    if (t.id === 'selGoalOp') {
      project.goal.op = t.value;
      await recompileAndRefreshSimulator();
      return;
    }
    if (t.id === 'inGoalTarget') {
      project.goal.target = Number(t.value || 0);
      await recompileAndRefreshSimulator();
      return;
    }
    if (t.id === 'inGoalBanner') {
      project.goal.banner = t.value;
      await recompileAndRefreshSimulator();
    }
  });
}

async function boot() {
  mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    client: slxClient,
    activeAppId: 'hfs-studio',
    title: 'HFS WonderLab Studio',
    subtitle: 'Visual Block-to-WASM App Builder for Kids, Classrooms & Creators • $0.00 Gas',
    rpcUrlFn: () => rpcUrl,
    extraElements: [document.getElementById('btnStudioGuide')],
  });

  project.slug = `${project.slug}-${Math.floor(100 + Math.random() * 900)}`;

  mountSlxGameGuide({
    gameId: 'hfs-studio',
    manualSpec: STUDIO_MANUAL_SPEC,
    headerBtnEl: document.getElementById('btnStudioGuide'),
    welcomeMountEl: document.getElementById('wsWelcomeMount'),
    coachMountEl: document.getElementById('wsCoachMount'),
  });

  renderTemplatePills();
  renderStepTabs();
  renderBuilderPanel();
  bindEvents();
  await recompileAndRefreshSimulator();
}

boot();
