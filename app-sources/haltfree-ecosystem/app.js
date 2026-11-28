/**
 * HALTFREE ECOSYSTEM v2.0 (`app-sources/haltfree-ecosystem/app.js` — SuperLexicon HFS #29)
 *
 * Turn-Based On-Chain Closed-Loop Permaculture, Polyculture Aquaculture & Biospheric Game:
 *  - 100% On-Chain Execution: Zero offline/client-only simulation! Every expedition start
 *    (`startRun`) and seasonal turn (`playRound`, Seasons 1..8) submits a `$0.00`-gas transaction
 *    to `haltfree_ecosystem.wasm` on Subnet 1.
 *  - Event-Driven 60-FPS `<canvas>` Rendering: When a Subnet 1 block confirms, the UI extracts
 *    the emitted `RunStarted` / `RoundResolved` HFS event payload directly from `receipt.logs`,
 *    then animates new organisms splashing into the ecosystem, seasonal weather hazards, symbiosis
 *    combos, vital gauge deltas, and Infinite-Loop mastery!
 */

import {
  hexToBytes,
  bytesToHex,
  keccak256Hex,
  encodeAbi,
  readU16BE,
  readU32BE,
  readU64BE,
  shortAddr,
  ZERO_ADDR,
  SlxClient,
  SlxWalletManager,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  readOnChainIdentityNickname,
  slxWatchChainApp,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader, registerSlxUseCaseDocs } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';
import { mountSlxGameGuide } from '@superlexicon/sdk/ui/game-guide';

// ---------------------------------------------------------------------------
// Self-Contained Inline Field Guide & Architecture Docs
// ---------------------------------------------------------------------------

const HALTFREE_MANUAL_SPEC = {
  icon: '🌿',
  title: 'Haltfree Ecosystem — Turn-Based On-Chain Ecology Guide',
  accent: '#10b981',
  tagline:
    'Build a living 2,400-year-old "Infinite Food" ecosystem one season at a time on Subnet 1 ($0.00 gas)—each confirmed block emits the next ecological season!',
  welcomePrimaryLabel: '🚀 Launch Season 1 Expedition',
  quickSteps: [
    {
      num: '1',
      title: 'Start an 8-Season Expedition on Subnet 1',
      body: 'Choose an Arena (start with Level 1: 475 BCE Mulberry-Dyke Carp Pond) and launch your live on-chain Sanctuary Expedition with your Identity HFS.',
    },
    {
      num: '2',
      title: 'Play 1 Tactical Eco-Action Per Season',
      body: 'Each round (Seasons 1–8), read the Weather Forecast and either stock a species in one of the 6 Ecological Zones OR trigger a Seasonal Steward move (Dredge Silt, Bio-Aerate, or Autonomous Loop).',
    },
    {
      num: '3',
      title: 'Watch Confirmed HFS Events Bring Your Pond to Life',
      body: 'When the block confirms, haltfree_ecosystem.wasm emits RoundResolved—animating new fish, trees, weather shields, Symbiosis Combos, and 2× Hands-Free Infinite-Loop harvests!',
    },
  ],
  tabs: {
    quickstart: `
      <div class="slx-gg-hero">
        <div class="slx-gg-hero-title">♾️ Turn-by-Turn Closed-Loop Strategy</div>
        <p>
          Every round is a real season stored inside <code>haltfree_ecosystem.wasm</code> on Subnet 1.
          Build your food web in smart ecological order (Producers &rarr; Symbionts &rarr; Filter Fish &rarr; Benthic Recyclers),
          avoid chemical shortcut traps, and once all <strong>6/6 Loop Links</strong> are active, play
          <strong>♾️ Autonomous Hands-Off Season</strong> in Seasons 7 &amp; 8 to prove your ecosystem sustains itself forever!
        </p>
      </div>
      <div class="slx-gg-steps-grid">
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">SEASONS 1–6</span>
          <h4>🌱 Build Trophic Symbiosis</h4>
          <p>Stock Mulberry Trees before Silkworms, and stock Silver &amp; Bighead Carp before Algae Surges hit to score Symbiosis Combos!</p>
        </div>
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">WEATHER</span>
          <h4>🌧️ Read the Forecast</h4>
          <p>Shoreline tree roots turn Monsoon Downpours into bonus fertility, while Bamboo Bio-Aeration saves low-oxygen ponds in Heatwaves!</p>
        </div>
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">SEASONS 7–8</span>
          <h4>♾️ Hands-Free 2&times; Harvest</h4>
          <p>With all 6 Closed-Loop guilds active and zero chemical shortcuts, run Hands-Off Autonomous Seasons for 2&times; Harvest &amp; 3 Stars!</p>
        </div>
      </div>
    `,
    controls: `
      <div class="slx-gg-card">
        <h4>📊 Keep All 4 Vitals Above 0% Across All 8 Seasons</h4>
        <ul>
          <li><strong>🫧 Oxygen Balance:</strong> Produced by aquatic plants, microalgae reactors, and splash aeration. Plunges during Heatwaves or fish overcrowding!</li>
          <li><strong>💎 Water / Air Clarity:</strong> Protected by filter-feeding guilds (<em>Silver Carp</em>, <em>Bighead Carp</em>, <em>Strawberries</em>) and shoreline root banks.</li>
          <li><strong>🌱 Soil &amp; Silt Fertility:</strong> Replenished by Silkworm frass, nitrogen-fixing <em>Three Sisters</em>/<em>Azolla</em>, mushrooms, and benthic silt cycling.</li>
          <li><strong>🛡️ Cleanliness (Low Toxin):</strong> Chemical pesticides, diesel feed pellets, bleach, or unwashed Mars perchlorates build persistent <em>Toxin Debt</em> that corrodes Cleanliness every round!</li>
        </ul>
      </div>
    `,
    reference: `
      <div class="slx-gg-card">
        <h4>📜 The Real 2,400-Year-Old "Infinite Food" System (<em>Sangji Yutang</em>)</h4>
        <ul>
          <li>Documented since Fan Li&rsquo;s 475 BCE <em>Classic of Fish Culture</em>, Pearl River Delta farmers combined <strong>Mulberry Trees + Silkworms + 4 Depth-Layered Carp Species</strong>.</li>
          <li>Mulberry leaves fed silkworms; silkworm frass &amp; dyke grass fed <strong>Grass Carp</strong>; Grass Carp waste grew phytoplankton for <strong>Silver Carp</strong> and zooplankton for <strong>Bighead Carp</strong>; <strong>Black/Common Carp</strong> stirred bottom silt that farmers scooped back onto Mulberry roots!</li>
        </ul>
      </div>
    `,
    onchain: `
      <div class="slx-gg-card">
        <h4>⛓️ 100% On-Chain Turn State Machine (<code>haltfree_ecosystem.wasm</code>)</h4>
        <ul>
          <li><strong>Zero Offline Preview:</strong> Every round calls <code>playRound(identity, actionKind, target, choice)</code> on Subnet 1 and renders directly from the emitted <code>RoundResolved(address,bytes)</code> HFS event log.</li>
        </ul>
      </div>
    `,
  },
};

registerSlxUseCaseDocs('haltfree-ecosystem', {
  hasGameGuide: true,
  description: {
    icon: '🌿',
    title: 'Haltfree Ecosystem — Turn-Based On-Chain Closed-Loop Ecology Game',
    href: '/haltfree-ecosystem.html',
    tagline:
      'Turn-based 60-FPS animated science & permaculture game where every seasonal action executes on Subnet 1 and renders live from emitted HFS events.',
    featurePills: [
      { label: '17.5 KiB Turn-Based HFS Engine', tone: 'emerald' },
      { label: 'Event-Driven 60-FPS Canvas', tone: 'cyan' },
      { label: '8-Season Weather & Combo Tactics', tone: 'amber' },
      { label: '0x0101 On-Chain UI + Artwork', tone: 'violet' },
      { label: 'Identity HFS XP & Badges', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🌿 Every Round Is a Confirmed On-Chain Season</div>
          <p>
            <strong>Haltfree Ecosystem v2.0</strong> runs its entire trophic food-web state machine on Subnet 1:
            players select one ecological action per season, confirm the zero-gas transaction, and watch the living
            cross-section animate the exact <code>RoundResolved</code> payload emitted by <code>haltfree_ecosystem.wasm</code>.
          </p>
        </div>
      `,
      primitives: `
        <div class="slx-ucd-card">
          <h4>🔬 On-Chain Trophic Couplings, Weather Entropy &amp; Symbiosis Combos</h4>
          <ul>
            <li>Simulates 8 seasonal rounds with block-derived weather forecasts, persistent chemical toxin debt, trophic guilds, and 6 unlockable Eco-Scholar badges.</li>
          </ul>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead><tr><th>Component</th><th>Role</th></tr></thead>
          <tbody>
            <tr><td><code>haltfree_ecosystem.wasm</code> (<code>17.5 KiB</code>)</td><td>Turn-by-turn ecosystem state machine, <code>RunStarted</code> / <code>RoundResolved</code> event emitter, and Hall of Fame.</td></tr>
            <tr><td><code>0x0101</code> UI + Media Store</td><td>Serves the 60-FPS Canvas game + 4 custom arena illustrations directly from Subnet 1 validators.</td></tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-card">
          <h4>✅ Verifiable Learning &amp; Autonomous Loop Proof</h4>
          <ul>
            <li>Players prove true closed-loop self-sufficiency by running hands-off autonomous seasons once all 6 permaculture guilds are active on-chain.</li>
          </ul>
        </div>
      `,
    },
  },
});

// ---------------------------------------------------------------------------
// Protocol Constants & Descriptive Catalog (Rules Execute 100% On-Chain!)
// ---------------------------------------------------------------------------

const STATUS_NONE = 0;
const STATUS_ACTIVE = 1;
const STATUS_HALTED = 2;
const STATUS_VICTORY = 3;

const TOPIC_RUN_STARTED = keccak256Hex(new TextEncoder().encode('RunStarted(address,bytes)')).toLowerCase();
const TOPIC_ROUND_RESOLVED = keccak256Hex(new TextEncoder().encode('RoundResolved(address,bytes)')).toLowerCase();

const SEASON_LABELS = [
  'S1 🌱',
  'S2 ☀️',
  'S3 🍂',
  'S4 ❄️',
  'S5 🌱',
  'S6 ☀️',
  'S7 🍂',
  'S8 🏆',
];

const WEATHER_META = [
  { icon: '☀️', name: 'Gentle Sun', tip: 'Balanced warmth — great season to plant producers or symbionts!' },
  { icon: '🌿', name: 'Warm Algae Surge', tip: 'Algae blooms fast! Stock Zone 4 Filter Guilds to turn algae into bonus harvest!' },
  { icon: '🌧️', name: 'Monsoon Downpour', tip: 'Erodes bare mud! Zone 1 Deep Root Trees turn rain into a +30 Harvest Shield!' },
  { icon: '🌡️', name: 'Mid-Summer Heatwave', tip: 'Warm water holds less O2! Surface plants, Venturi aerators, or Bio-Aerate help!' },
  { icon: '🍂', name: 'Crisp Harvest Breeze', tip: 'Cool oxygen-rich breeze — boosts harvest yield for every active Loop Guild!' },
  { icon: '🌪️', name: 'Solar Dust Dimming', tip: 'Reduced sunlight drops O2! Photobioreactors or Bio-Aeration keep oxygen steady!' },
];

const COMBO_META = {
  0: null,
  1: { badge: '⚡ CANOPY SYMBIOSIS!', color: '#fde047', text: 'Shoreline plants & canopy symbionts are feeding each other!' },
  2: { badge: '🌊 MULTI-DEPTH WATER GUILD!', color: '#38bdf8', text: 'All water layers are filtering algae & plankton in harmony!' },
  3: { badge: '♻️ BENTHIC SILT-TO-ROOT LOOP!', color: '#34d399', text: 'Bottom nutrients are cycling right back into shoreline roots!' },
  4: { badge: '🛡️ MONSOON ROOT-SHIELD!', color: '#6ee7b7', text: 'Deep shoreline tree roots blocked erosion and drank up the rain!' },
  5: { badge: '🐟 ALGAE-BLOOM FEAST!', color: '#2dd4bf', text: 'Filter-feeders turned the warm algae surge into crystal water & fish growth!' },
  6: { badge: '🌟 ALL 6/6 LOOP LINKS ACTIVE!', color: '#fbbf24', text: 'Complete closed-loop ecosystem! Play ♾️ Autonomous Loop next for 2× Harvest!' },
  7: { badge: '♾️ AUTONOMOUS INFINITE LOOP ×2!', color: '#fde047', text: 'Zero human input, zero feed, 2× Harvest — true 2,400-year self-sustainability!' },
  8: { badge: '🚑 EMERGENCY STEWARD RESCUE!', color: '#a5f3fc', text: 'Timely ecological stewardship saved your stressed sanctuary from collapse!' },
};

const HALT_DIAGNOSES = {
  0: {
    badge: '♾️ CLOSED-LOOP EQUILIBRIUM',
    explain: 'Every waste stream feeds another living guild — powered purely by sunlight and rain!',
  },
  1: {
    badge: '🟢 HALTED: EUTROPHICATION (Algal Chokehold)',
    explain: 'Unfiltered algae turned the water into murky green soup! Stock Zone 4/5 filter-feeders (Silver & Bighead Carp, Crayfish, or Hydroponic Greens) earlier next run.',
  },
  2: {
    badge: '🫧 HALTED: HYPOXIA (Oxygen Crash)',
    explain: 'Dissolved O2 hit 0%! Avoid suffocating pests (Water Hyacinth, Mosquito Oil, Overcrowded Koi) and use Duckweed, Spirulina, or Bamboo Bio-Aeration during Heatwaves.',
  },
  3: {
    badge: '🧪 HALTED: TOXIC BUILDUP (Ammonia / Chemicals)',
    explain: 'Pesticides, diesel feed, bleach, or unwashed Martian perchlorates poisoned the food web! Use living bio-filters, worms, nitrifying microbes, and benthic silt cycling.',
  },
  4: {
    badge: '🦈 HALTED: TROPHIC PREDATION COLLAPSE',
    explain: 'Apex predators or locust swarms devoured the workers that keep the ecosystem clean! Stick to gentle herbivore & filter-feeding polyculture guilds.',
  },
  5: {
    badge: '🍂 HALTED: NUTRIENT STARVATION',
    explain: 'Crops drained all fertility because nutrients were flushed away or locked behind concrete instead of recycled back to the roots!',
  },
  6: {
    badge: '⛽ HALTED: EXTERNAL SUPPLY DEPENDENCY',
    explain: 'You survived Round 8, but relied on imported fuel/chemical shortcuts instead of a self-sustaining Closed-Loop Ecosystem!',
  },
};

const BADGE_META = [
  { bit: 1 << 0, icon: '🐛', name: 'Master Fan Li’s Heir', tip: 'Win Arena 1 with 6/6 Sangji Yutang links' },
  { bit: 1 << 1, icon: '🦎', name: 'Axolotl Guardian', tip: 'Win Arena 2 with Cleanliness ≥ 75%' },
  { bit: 1 << 2, icon: '🧬', name: 'Nitrogen Alchemist', tip: 'Win Arena 3 with 0 Toxin Debt' },
  { bit: 1 << 3, icon: '🚀', name: 'Mars Bio-Pioneer', tip: 'Survive all 8 seasons on Mars BIOS-IV' },
  { bit: 1 << 4, icon: '♾️', name: 'Hands-Free Master', tip: 'Execute a 6/6 Autonomous Closed-Loop Season' },
  { bit: 1 << 5, icon: '👑', name: 'Grand Permaculturist', tip: 'Earn all 12 / 12 Mastery Stars' },
];

const STEWARD_ACTIONS = [
  {
    target: 1,
    icon: '🚣',
    name: 'Dredge & Cycle Silt to Roots',
    tag: 'Steward Care',
    desc: 'Scoop rich benthic pond muck onto shoreline roots (+22% Cleanliness, +22% Fertility, scrubs Toxin Debt & +35 Harvest).',
  },
  {
    target: 2,
    icon: '🌬️',
    name: 'Splash-Wheel Bio-Aeration',
    tag: 'O2 Rescue',
    desc: 'Churn fresh dissolved oxygen through the water column (+28% O2, +12% Clarity — ideal before or during a Summer Heatwave!).',
  },
  {
    target: 3,
    icon: '♾️',
    name: 'Autonomous Hands-Off Season',
    tag: '2× Loop Bonus!',
    desc: 'Add ZERO outside inputs! When all 6/6 Closed-Loop Guilds are active with 0 shortcuts, proves Infinite Food & doubles Season Harvest (×2 + 130)!',
  },
];

export const ARENAS = [
  {
    id: 0,
    era: '475 BCE · PEARL RIVER DELTA, CHINA',
    shortName: 'Mulberry-Dyke Pond',
    title: '🐟 The 2,400-Year-Old “Infinite Food” Mulberry-Dyke Pond',
    thumb: '/assets/haltfree-ecosystem/arena_0.jpg',
    optimalVisualCheck: [2, 1, 3, 1, 2, 3],
    story:
      '<strong>Level 1 (Beginner ★☆☆☆):</strong> Engineered over 2,400 years ago (<em>Sangji Yutang</em>), Chinese farmers linked shoreline trees, silk-spinning caterpillars, and <strong>four depth-layered carp species</strong> into a zero-feed food loop. Stock the 6 niches across Seasons 1–6, then run hands-free!',
    zones: [
      {
        short: 'Shore Dyke',
        question: 'Zone 1 (Shoreline Dyke): Which shoreline plant anchors mud during Monsoons AND feeds canopy insects?',
        choices: [
          { val: 1, icon: '🌲', name: 'Pine Conifers', tag: 'Acidic Needles', desc: 'Holds bank soil, but pine needles turn water acidic and feed zero silkworms.' },
          { val: 2, icon: '🌳', name: 'Mulberry Trees', tag: 'Deep Roots + Leaves', desc: 'Anchors dyke against Monsoons, drops sweet berries, and grows lush leaves for Silkworms!' },
          { val: 3, icon: '🌽', name: 'Pesticide Cash-Corn', tag: '⚠️ Chemical Trap', desc: 'Big one-season harvest spike (+72), but chemical pesticide runoff builds toxic debt!' },
        ],
      },
      {
        short: 'Canopy Shed',
        question: 'Zone 2 (Tree Canopy): What turns tree leaves into prized silk AND rich organic plankton food?',
        choices: [
          { val: 1, icon: '🐛', name: 'Silkworm Colony', tag: 'Silk + Frass Loop', desc: 'Eats Mulberry leaves, spins silk, and drops gentle organic frass that fertilizes pond plankton!' },
          { val: 2, icon: '🦗', name: 'Locust Swarm', tag: '❌ Defoliator', desc: 'Quick protein harvest, but strips shoreline foliage faster than trees recover!' },
          { val: 3, icon: '⛽', name: 'Diesel Pellet Feeder', tag: '⚠️ External Feed', desc: 'Dumps imported commercial fish pellets — boosts yield briefly but spikes ammonia debt!' },
        ],
      },
      {
        short: 'Surface 0–0.5m',
        question: 'Zone 3 (Surface Water): Who grazes dyke grass & duckweed so their waste gently feeds mid-water plankton?',
        choices: [
          { val: 1, icon: '🐍', name: 'Snakehead Predator', tag: '❌ Fish Hunter', desc: 'High market value, but devours your gentle filter-feeding carp in other depths!' },
          { val: 2, icon: '🎏', name: 'Overcrowded Prize Koi', tag: 'Heavy O2 Drain', desc: 'Colorful ornamental school that consumes heavy surface oxygen without grazing grass.' },
          { val: 3, icon: '🐟', name: 'Grass Carp & Duckweed', tag: 'Surface Herbivore', desc: 'Duckweed oxygenates water while Grass Carp munch grass clippings & feed pond plankton!' },
        ],
      },
      {
        short: 'Phyto 0.5–1.5m',
        question: 'Zone 4 (Upper-Mid Water): Who uses microscopic gill rakers to filter green phytoplankton blooms?',
        choices: [
          { val: 1, icon: '🥈', name: 'Silver Carp', tag: 'Phytoplankton Sieve', desc: 'Living microalgae filter that keeps water crystal-clear and feasts on Warm Algae Surges!' },
          { val: 2, icon: '🧪', name: 'Copper Algicide Drip', tag: '⚠️ Toxin Trap', desc: 'Kills green algae chemically, poisoning pond cleanliness and starving the food web!' },
          { val: 3, icon: '🎣', name: 'Cold-River Trout', tag: 'Wrong Habitat', desc: 'Needs icy mountain rapids — gasps for oxygen in warm subtropical ponds.' },
        ],
      },
      {
        short: 'Zoopl. 1.5–2.5m',
        question: 'Zone 5 (Lower-Mid Water): Who cruises deeper water filtering tiny golden zooplankton & suspended flocs?',
        choices: [
          { val: 1, icon: '🦈', name: 'Northern Pike', tag: '❌ Ambush Predator', desc: 'Hunts mid-water carp guilds and disrupts trophic balance!' },
          { val: 2, icon: '🥇', name: 'Bighead Carp', tag: 'Zooplankton Filter', desc: 'Gentle filter-feeder partnering with Silver Carp to polish mid-deep water into food!' },
          { val: 3, icon: '🦐', name: 'Saltwater Krill', tag: 'Wrong Salinity', desc: 'Marine crustaceans cannot survive freshwater ponds and decay on the floor.' },
        ],
      },
      {
        short: 'Benthic Floor',
        question: 'Zone 6 (Pond Floor & Mud Loop): How do we clean bottom detritus AND fertilize the Mulberry trees forever?',
        choices: [
          { val: 1, icon: '🧱', name: 'Concrete Pond Liner', tag: 'Breaks Soil Loop', desc: 'Blocks mud turbidity, but severs natural mineral exchange and traps rotting sludge.' },
          { val: 2, icon: '🌊', name: 'River Flush Gate', tag: '⚠️ Open-Loop Loss', desc: 'Washes away bottom sludge, but flushes all precious pond nutrients into the river!' },
          { val: 3, icon: '♻️', name: 'Black Carp + Silt-to-Dyke', tag: 'Closes 2,400-Yr Loop', desc: 'Eats bottom snails/detritus & cycles rich pond silt back onto Mulberry tree roots!' },
        ],
      },
    ],
  },
  {
    id: 1,
    era: '1150 CE · LAKE XOCHIMILCO, MEXICO',
    shortName: 'Aztec Chinampa',
    title: '🦎 Floating Chinampa Island & Axolotl Canal',
    thumb: '/assets/haltfree-ecosystem/arena_1.jpg',
    optimalVisualCheck: [1, 3, 1, 2, 3, 1],
    story:
      '<strong>Level 2 (Intermediate ★★☆☆):</strong> Aztec agro-engineers wove floating reed islands yielding <strong>7 harvests a year</strong> alongside endangered <strong>Axolotls</strong>! Keep Cleanliness high — amphibians hate chemical runoff!',
    zones: [
      {
        short: 'Root Wall',
        question: 'Zone 1 (Island Perimeter): What anchors the floating garden soil without polluting the canal?',
        choices: [
          { val: 1, icon: '🌿', name: 'Ahuejote Willow Trees', tag: 'Living Root Basket', desc: 'Woven aquatic roots anchor the Chinampa against Monsoons and shelter baby fish!' },
          { val: 2, icon: '🍂', name: 'Eucalyptus Trees', tag: 'Inhibits Crops', desc: 'Oily fallen leaves suppress companion vegetables and lower soil fertility.' },
          { val: 3, icon: '🔩', name: 'Sheet-Metal Bulkhead', tag: '⚠️ Rust Runoff', desc: 'Corrodes in lake water and blocks natural root bio-filtration.' },
        ],
      },
      {
        short: 'Crop Bed',
        question: 'Zone 2 (Island Crop Bed): Which crop guild fixes nitrogen from thin air and mulches moisture?',
        choices: [
          { val: 1, icon: '🌾', name: 'Monocrop Wheat', tag: 'Drains Nitrogen', desc: 'Single-grain planting rapidly exhausts Chinampa topsoil.' },
          { val: 2, icon: '🍅', name: 'Pesticide Tomatoes', tag: '⚠️ Amphibian Poison', desc: 'High short-term harvest, but chemical spray harms sensitive Axolotl gills!' },
          { val: 3, icon: '🌽', name: 'Three Sisters Polyculture', tag: 'Corn + Beans + Squash', desc: 'Beans fix atmospheric N2 on corn stalks while broad squash leaves shade the soil!' },
        ],
      },
      {
        short: 'Canal Top',
        question: 'Zone 3 (Canal Surface): Which native floating fern fixes nitrogen without choking surface oxygen?',
        choices: [
          { val: 1, icon: '🍀', name: 'Azolla Fern & Duckweed', tag: 'O2 + Bio-Nitrogen', desc: 'Oxygenates canal water, shades out bad algae, and fixes nitrogen naturally!' },
          { val: 2, icon: '🌺', name: 'Invasive Water Hyacinth', tag: '❌ O2 Chokehold', desc: 'Dense mat blocks sunlight and drains dissolved oxygen toward 0%!' },
          { val: 3, icon: '🛢️', name: 'Mosquito Oil Film', tag: '⚠️ Suffocates Canal', desc: 'Seals the water surface so oxygen cannot enter!' },
        ],
      },
      {
        short: 'Mid-Canal',
        question: 'Zone 4 (Mid-Canal): Which native species cleans canal detritus without uprooting Chinampa walls?',
        choices: [
          { val: 1, icon: '🐟', name: 'Invasive Bottom Carp', tag: 'Stirs Mud', desc: 'Tears up tender willow roots and clouds the turquoise canal!' },
          { val: 2, icon: '🦞', name: 'Acocil Crayfish & Charales', tag: 'Native Cleaners', desc: 'Gentle native Xochimilco crustaceans & silversides that polish canal clarity!' },
          { val: 3, icon: '🦷', name: 'Piranha Pack', tag: '❌ Predator', desc: 'Attacks native canal wildlife and collapses biodiversity!' },
        ],
      },
      {
        short: 'Bio-Guardian',
        question: 'Zone 5 (Amphibian Niche): Which beloved Xochimilco guardian eats crop pests in pure water?',
        choices: [
          { val: 1, icon: '🐸', name: 'Invasive Cane Toads', tag: '❌ Toxic Glands', desc: 'Poisons local predators and disrupts wetland balance.' },
          { val: 2, icon: '🧼', name: 'Chlorine Dosing Pump', tag: '⚠️ Sterilizer Trap', desc: 'Kills bacteria and burns sensitive amphibian skin!' },
          { val: 3, icon: '🦎', name: 'Axolotl & Tree Frogs', tag: 'Pure-Water Guardian', desc: 'Thrives in clean bio-filtered canals and controls insect pests naturally!' },
        ],
      },
      {
        short: 'Muck Loop',
        question: 'Zone 6 (Fertility Return): How did Chinampa farmers renew topsoil before every planting?',
        choices: [
          { val: 1, icon: '🚣', name: 'Scoop Canal Muck + Tule Reeds', tag: 'Closes Chinampa Loop', desc: 'Tule reeds scrub toxins while nutrient-rich bottom muck renews Three Sisters soil!' },
          { val: 2, icon: '🧪', name: 'Synthetic NPK Fertilizer', tag: '⚠️ Runoff Bloom', desc: 'Spikes crop yield once, then leaches ammonia & triggers suffocating blooms!' },
          { val: 3, icon: '🔥', name: 'Burn Crop Stalks', tag: 'Loses Nitrogen', desc: 'Sends valuable organic nitrogen up in smoke.' },
        ],
      },
    ],
  },
  {
    id: 2,
    era: 'MODERN · URBAN SOLAR BIO-DOME',
    shortName: 'Solar Aquaponics',
    title: '🔬 Solar Aquaponics & Microbial Nitrification Bio-Dome',
    thumb: '/assets/haltfree-ecosystem/arena_2.jpg',
    optimalVisualCheck: [2, 1, 3, 1, 2, 2],
    story:
      '<strong>Level 3 (Advanced ★★★☆):</strong> Fish exhale toxic ammonia (<code>NH3</code>)! Engineer the <strong>microbial nitrification bridge</strong> (<code>NH3 &rarr; NO2- &rarr; NO3-</code>) so fish waste grows sweet strawberries using 90% less water!',
    zones: [
      {
        short: 'Fish Tank',
        question: 'Zone 1 (Recirculating Tank): Choose a freshwater fish school that generates steady nutrients:',
        choices: [
          { val: 1, icon: '🐟', name: 'Ocean Bluefin Tuna', tag: 'Saltwater Mismatch', desc: 'Requires ocean salinity and massive oxygen!' },
          { val: 2, icon: '🐠', name: 'Balanced Nile Tilapia', tag: 'Freshwater Nutrient Hub', desc: 'Hardy freshwater school providing steady ammonia for your bio-reactor!' },
          { val: 3, icon: '🐡', name: '5× Overcrowded Catfish', tag: '⚠️ Ammonia Overload', desc: 'Crashes dissolved oxygen and floods the tank with toxic ammonia!' },
        ],
      },
      {
        short: 'Solids Bed',
        question: 'Zone 2 (Solids Separator): What turns solid fish waste into soluble trace minerals?',
        choices: [
          { val: 1, icon: '🪱', name: 'Swirl Clarifier + Red Worms', tag: 'Vermi-Mineralizer', desc: 'Keeps plant roots clean while worms unlock iron, calcium & trace minerals!' },
          { val: 2, icon: '🧴', name: 'Chlorine Bleach Filter', tag: '⚠️ Kills Microbes', desc: 'Wipes out your beneficial nitrifying bacteria and harms fish!' },
          { val: 3, icon: '🚽', name: 'Open Sewer Flush', tag: '⚠️ Open-Loop Loss', desc: 'Dumps water and minerals down the city drain.' },
        ],
      },
      {
        short: 'Bio-Reactor',
        question: 'Zone 3 (Bio-Media): Who converts toxic Ammonia (NH3) into safe Plant-Food Nitrate (NO3-)?',
        choices: [
          { val: 1, icon: '🔮', name: 'Stagnant Swamp Mud', tag: 'Anaerobic Sour Gas', desc: 'Clogs water flow and starves oxygen-loving bacteria.' },
          { val: 2, icon: '🟣', name: 'UV Sterilizer on Media', tag: 'Zaps Good Bacteria', desc: 'Irradiating the bio-bed kills Nitrosomonas & Nitrobacter!' },
          { val: 3, icon: '🧬', name: 'Clay Pebbles + Nitrifying Microbes', tag: 'NH3 ➔ NO2- ➔ NO3-', desc: 'Porous expanded clay houses billions of Nitrosomonas & Nitrobacter microbes!' },
        ],
      },
      {
        short: 'Grow Rafts',
        question: 'Zone 4 (Hydroponic Channels): Which crops drink up Nitrate so purified water returns to fish?',
        choices: [
          { val: 1, icon: '🍓', name: 'Basil, Lettuce & Strawberries', tag: 'Fast Nitrate Sponge', desc: 'Drinks up NO3- rapidly into crisp greens & berries, returning sparkling water!' },
          { val: 2, icon: '🌳', name: 'Slow Oak Saplings', tag: 'Too Slow', desc: 'Woody roots crack rafts and absorb nitrates far too slowly.' },
          { val: 3, icon: '🪴', name: 'Plastic Decor Plants', tag: 'Zero Uptake', desc: 'Looks green, filters nothing!' },
        ],
      },
      {
        short: 'O2 & Bees',
        question: 'Zone 5 (Aeration & Pollination): Fish, roots, and bacteria all breathe O2 — plus berry blossoms need pollinators!',
        choices: [
          { val: 1, icon: '⛽', name: 'Diesel Air Compressor', tag: '⚠️ Soot & Fuel', desc: 'Adds bubbles, but exhaust fumes contaminate the greenhouse.' },
          { val: 2, icon: '☀️', name: 'Solar Venturi + Bumblebees', tag: 'Clean O2 + Berries', desc: 'Solar micro-bubbles supercharge O2 while gentle bumblebees pollinate strawberries!' },
          { val: 3, icon: '🫧', name: 'Pure CO2 Tank Bubbler', tag: 'Suffocates Fish', desc: 'Turns water acidic and drives dissolved O2 down!' },
        ],
      },
      {
        short: 'Sump Buffer',
        question: 'Zone 6 (pH & Mineral Loop): Nitrification slowly acidifies water — how do we buffer pH naturally?',
        choices: [
          { val: 1, icon: '🧂', name: 'Table Salt (NaCl) Dump', tag: 'Wilts Crops', desc: 'Sodium chloride dehydrates strawberry & lettuce roots!' },
          { val: 2, icon: '🐚', name: 'Recirc Sump + Eggshell/Kelp', tag: 'Closes Mineral Loop', desc: 'Crushed shells & kelp gently balance pH, calcium & potassium with zero waste!' },
          { val: 3, icon: '🧪', name: 'Sulfuric Acid Wash', tag: '⚠️ pH Crash', desc: 'Burns plant roots and bio-filters!' },
        ],
      },
    ],
  },
  {
    id: 3,
    era: '2084 CE · JEZERO CRATER, MARS',
    shortName: 'Mars Biodome',
    title: '🚀 Sealed Martian Biospheric Habitat (“BIOS-IV”)',
    thumb: '/assets/haltfree-ecosystem/arena_3.jpg',
    optimalVisualCheck: [3, 1, 2, 2, 2, 1],
    story:
      '<strong>Level 4 (Master ★★★★):</strong> 225 million km from Earth inside a sealed dome! Survive Martian Dust Dimming, scrub <code>CO2</code> into <code>O2</code>, digest inedible crop stalks, and detoxify native Mars perchlorate salts!',
    zones: [
      {
        short: 'O2 Reactor',
        question: 'Zone 1 (Atmosphere Core): What scrubs crew CO2 into abundant O2 and complete protein every sol?',
        choices: [
          { val: 1, icon: '🕯️', name: 'Chemical O2 Candles', tag: '⚠️ Non-Renewable', desc: 'Burns finite chlorate canisters and leaves chemical residue.' },
          { val: 2, icon: '🌵', name: 'Slow Desert Cacti', tag: 'Low O2 Output', desc: 'Produces far too little oxygen for a sealed habitat.' },
          { val: 3, icon: '🧪', name: 'Spirulina Photobioreactor', tag: 'Rapid O2 + Protein', desc: 'Glowing emerald microalgae columns pump out O2 even during Dust Dimming!' },
        ],
      },
      {
        short: 'Aqua-Pod',
        question: 'Zone 2 (Aquatic Mini-Loop): Which compact water loop fixes nitrogen and purifies greywater?',
        choices: [
          { val: 1, icon: '🐟', name: 'Azolla Pond + Medaka/Loach', tag: 'Zero-G Hardy Guild', desc: 'Fast-growing Azolla fixes nitrogen while hardy small fish recycle nutrients!' },
          { val: 2, icon: '🦈', name: 'Giant Tank Sharks', tag: '❌ O2 Collapse', desc: 'Drains dome oxygen reserves almost immediately!' },
          { val: 3, icon: '🚱', name: 'Stagnant Greywater Tank', tag: 'Anaerobic Slime', desc: 'Fouls dome air and water clarity.' },
        ],
      },
      {
        short: 'Crop Terrace',
        question: 'Zone 3 (Calorie Terrace): Which crop trio balances carbs, nitrogen-fixing protein, and oxygen?',
        choices: [
          { val: 1, icon: '🌴', name: 'Thirsty Almond Orchard', tag: 'Years Too Slow', desc: 'Uses huge water reserves before bearing nuts.' },
          { val: 2, icon: '🌾', name: 'Dwarf Wheat, Sweet Potato & Soy', tag: 'Complete Space Crops', desc: 'High harvest calories, edible leaves, and nitrogen-fixing soybean roots!' },
          { val: 3, icon: '🍬', name: 'Sugar Cane Monocrop', tag: 'Depletes Minerals', desc: 'Pure sugar without protein or fats; drains soil fast.' },
        ],
      },
      {
        short: 'Stalk Digest',
        question: 'Zone 4 (Lignin Recycler): Half of wheat & soy biomass is inedible straw — how do we unlock its nutrients?',
        choices: [
          { val: 1, icon: '🔥', name: 'Incinerator Furnace', tag: 'Burns Precious O2!', desc: 'Consumes breathable dome oxygen and fills air with soot!' },
          { val: 2, icon: '🍄', name: 'Oyster Mushrooms + Worms', tag: 'Straw ➔ Food + Humus', desc: 'Fungi digest tough straw into savory mushrooms & rich living soil!' },
          { val: 3, icon: '🗑️', name: 'Jettison Out Airlock', tag: '⚠️ Loses Carbon', desc: 'Throws irreplaceable carbon and nitrogen into space forever!' },
        ],
      },
      {
        short: 'Water Recovery',
        question: 'Zone 5 (Moisture & Waste): How do we recover 99% of evaporated plant mist and organic scraps?',
        choices: [
          { val: 1, icon: '💩', name: 'Unprocessed Holding Tank', tag: 'Methane & Ammonia', desc: 'Rots into toxic gas inside the sealed habitat.' },
          { val: 2, icon: '🪰', name: 'Soldier-Fly + Mist Condenser', tag: '99% Pure H2O Loop', desc: 'Condenses pure drinking water from leaf mist while larvae turn scraps into fish feed!' },
          { val: 3, icon: '☢️', name: 'Caustic Lye Boil', tag: '⚠️ Chemical Vapor', desc: 'Corrosive chemical waste damages dome cleanliness.' },
        ],
      },
      {
        short: 'Mars Soil',
        question: 'Zone 6 (Regolith Detox): Martian dust contains toxic Perchlorate (ClO4-) — how do we make living soil?',
        choices: [
          { val: 1, icon: '🦠', name: 'Perchlorate Bacteria + Mycorrhizae', tag: 'ClO4- ➔ Cl- + O2!', desc: 'Specialized microbes eat toxic perchlorate into harmless salt + extra oxygen!' },
          { val: 2, icon: '🪨', name: 'Raw Unwashed Mars Dust', tag: 'Perchlorate Poison', desc: 'Poisons crop roots and crashes dome Cleanliness!' },
          { val: 3, icon: '🚀', name: 'Wait for Earth Resupply', tag: '⚠️ Not Closed-Loop', desc: 'Depends on cargo rockets instead of Martian self-sufficiency!' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Live Runtime State (Strictly Driven by Subnet 1 HFS Storage & Events!)
// ---------------------------------------------------------------------------

const rpcUrl = getDefaultNodeWsUrl();
const wallet = new SlxWalletManager();
const slxClient = new SlxClient(rpcUrl);

let contractAddr = '';
let selectedArena = 0;
let focusedTab = 0; // 0..5 = Ecological Zones 1..6; 6 = Tactical Steward Actions
let pendingAction = { actionKind: 0, target: 0, choice: 2 }; // Highlighted card before committing tx

let onChainOverview = null;
let liveRun = null; // Decoded 64-byte RoundSnapshot from HFS event / storage
let txBusy = false;
let txPhaseLabel = '';
let stopWatcher = null;
let heGuide = null;
const nickCache = new Map();
const sessionEventFeed = []; // Confirmed receipt logs from this session

// Canvas visual FX triggered when an HFS event resolves
const swimmers = [];
const particles = [];
const floatingPopups = [];
const splashRings = [];
let eventCelebrationUntil = 0;

for (let i = 0; i < 28; i++) {
  swimmers.push({
    id: i,
    x: 280 + ((i * 73) % 640),
    y: 170 + ((i * 47) % 200),
    vx: (i % 2 === 0 ? 1 : -1) * (24 + (i % 5) * 7),
    phase: i * 1.1,
    band: i % 4,
  });
}
for (let i = 0; i < 64; i++) {
  particles.push({
    x: (i * 97) % 960,
    y: (i * 53) % 380,
    s: 1.5 + (i % 4),
    t: (i * 0.17) % 1,
    kind: i % 4,
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function showToast(msg) {
  const el = document.getElementById('heToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('is-visible'), 4000);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pushCanvasPopup(text, color = '#fde047', x = 520, y = 185) {
  floatingPopups.push({
    text,
    color,
    x,
    y,
    bornMs: performance.now(),
    ttlMs: 3200,
  });
}

function pushSplashRing(x = 520, y = 165, color = '#67e8f9') {
  splashRings.push({
    x,
    y,
    color,
    bornMs: performance.now(),
    ttlMs: 1400,
  });
}

// ---------------------------------------------------------------------------
// Wire Decoders (`RoundSnapshot` 64B & `getOverview` v2)
// ---------------------------------------------------------------------------

function decodeRunSnapshotBytes(b) {
  if (!b || b.length < 64 || b[0] !== 2) return null;
  return {
    status: b[1],
    arenaId: b[2],
    round: b[3],
    lastRoundPlayed: b[4],
    maxRounds: b[5] || 8,
    slots: [b[6], b[7], b[8], b[9], b[10], b[11]],
    o2: b[12],
    clarity: b[13],
    fertility: b[14],
    cleanliness: b[15],
    prevO2: b[16],
    prevClarity: b[17],
    prevFertility: b[18],
    prevCleanliness: b[19],
    weatherApplied: b[20],
    upcomingWeather: b[21],
    lastActionKind: b[22],
    lastActionTarget: b[23],
    lastActionChoice: b[24],
    comboId: b[25],
    haltReason: b[26],
    loopLinks: b[27],
    starsEarned: b[28],
    comboStreak: b[29],
    autonomousCycles: b[30],
    toxinDebt: b[31],
    lastYield: readU32BE(b, 32),
    totalHarvest: readU32BE(b, 36),
    xpGained: readU32BE(b, 40),
    runNumber: readU32BE(b, 44),
    badgesUnlockedNow: b[48],
    shortcutCount: b[49],
  };
}

function decodeOverviewHex(hexStr) {
  const b = hexToBytes(hexStr);
  if (!b || b.length < 120 || b[0] !== 2) return null;

  const leaderCnt = b[1];
  const logCnt = b[2];
  const blockNumber = Number(readU64BE(b, 4));
  const globalRuns = readU32BE(b, 12);

  const pb = b.subarray(16, 56);
  const viewer = {
    identity: bytesToHex(pb.subarray(0, 20)).toLowerCase(),
    bestStars: [pb[20], pb[21], pb[22], pb[23]],
    bestYield: [
      readU16BE(pb, 24),
      readU16BE(pb, 26),
      readU16BE(pb, 28),
      readU16BE(pb, 30),
    ],
    totalXp: readU32BE(pb, 32),
    runsStarted: readU16BE(pb, 36),
    badges: pb[38],
    solvedMask: pb[39] & 0x0f,
    bestStreak: (pb[39] >> 4) & 0x0f,
  };

  const runSnap = decodeRunSnapshotBytes(b.subarray(56, 120));

  let pos = 120;
  const leaders = [];
  for (let i = 0; i < leaderCnt && pos + 28 <= b.length; i++) {
    leaders.push({
      identity: bytesToHex(b.subarray(pos, pos + 20)).toLowerCase(),
      totalStars: b[pos + 20],
      solvedMask: b[pos + 21],
      badges: b[pos + 22],
      bestStreak: b[pos + 23],
      totalYield: readU32BE(b, pos + 24),
    });
    pos += 28;
  }

  const logs = [];
  for (let i = 0; i < logCnt && pos + 28 <= b.length; i++) {
    logs.push({
      identity: bytesToHex(b.subarray(pos, pos + 20)).toLowerCase(),
      arenaId: b[pos + 20],
      status: b[pos + 21],
      haltReason: b[pos + 22],
      stars: b[pos + 23],
      round: b[pos + 24],
      loopLinks: b[pos + 25],
      harvest: readU16BE(b, pos + 26),
    });
    pos += 28;
  }

  return { blockNumber, globalRuns, viewer, runSnap, leaders, logs };
}

function extractEmittedSnapshotFromReceipt(receipt) {
  if (!receipt || !Array.isArray(receipt.logs)) return null;
  for (const lg of receipt.logs) {
    const t0 = String(lg.topics?.[0] || '').toLowerCase();
    if (t0 === TOPIC_RUN_STARTED || t0 === TOPIC_ROUND_RESOLVED) {
      const raw = hexToBytes(lg.data || '0x');
      const snap = decodeRunSnapshotBytes(raw);
      if (snap) {
        return {
          eventName: t0 === TOPIC_RUN_STARTED ? 'RunStarted' : 'RoundResolved',
          snap,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Smart Selection Helpers (Auto-Focus Next Unstocked Niche After Each Round!)
// ---------------------------------------------------------------------------

function syncDefaultPendingActionForTab() {
  if (focusedTab >= 0 && focusedTab < 6) {
    const curInstalled = isRunMatchingSelectedArena() ? liveRun.slots[focusedTab] : 0;
    const choices = ARENAS[selectedArena].zones[focusedTab].choices;
    // Default highlight first non-installed option so clicking Execute makes progress
    const pick = choices.find((c) => c.val !== curInstalled) || choices[0];
    pendingAction = { actionKind: 0, target: focusedTab, choice: pick.val };
  } else {
    // Steward tab: if 6/6 loop complete, highlight Autonomous Loop (3); else Dredge Silt (1)
    const isFullLoop = isRunMatchingSelectedArena() && liveRun.loopLinks === 6 && liveRun.shortcutCount === 0;
    pendingAction = { actionKind: 1, target: isFullLoop ? 3 : 1, choice: 0 };
  }
}

function autoAdvanceTabFromConfirmedRun(snap) {
  if (!snap || snap.status !== STATUS_ACTIVE) return;
  const firstEmpty = snap.slots.findIndex((v) => v === 0);
  if (firstEmpty >= 0) {
    focusedTab = firstEmpty;
  } else {
    focusedTab = 6; // All 6 zones stocked -> focus Steward & Autonomous Loop tab!
  }
  syncDefaultPendingActionForTab();
}

function isRunMatchingSelectedArena() {
  return Boolean(liveRun && liveRun.status !== STATUS_NONE && liveRun.arenaId === selectedArena);
}

// ---------------------------------------------------------------------------
// On-Chain Read & Write Actions (100% HFS Transaction Driven!)
// ---------------------------------------------------------------------------

function formatScholarName(identityAddr) {
  if (!identityAddr || identityAddr === ZERO_ADDR) return 'Explorer';
  const cached = nickCache.get(identityAddr);
  if (cached) return `@${cached}`;
  return shortAddr(identityAddr);
}

function hydrateScholarNicks(addrs) {
  for (const addr of addrs) {
    if (!addr || addr === ZERO_ADDR || nickCache.has(addr)) continue;
    nickCache.set(addr, '');
    readOnChainIdentityNickname(rpcUrl, addr)
      .then((n) => {
        if (n) {
          nickCache.set(addr, n);
          renderSidebar();
        }
      })
      .catch(() => {});
  }
}

async function refreshOnChainState(adoptActiveArena = false) {
  if (!contractAddr) {
    renderAllUI();
    return;
  }
  try {
    const myId = wallet.getIdentityRecord()?.identityAddr || ZERO_ADDR;
    const hex = await slxNodeRpc(rpcUrl, 'eth_call', [
      {
        to: contractAddr,
        data: encodeAbi('getOverview(address)', [['address', myId]]),
      },
      'latest',
    ]);
    if (hex && hex !== '0x') {
      const parsed = decodeOverviewHex(hex);
      if (parsed) {
        onChainOverview = parsed;
        if (parsed.runSnap && parsed.runSnap.status !== STATUS_NONE) {
          const hadNoRun = !liveRun || liveRun.status === STATUS_NONE;
          liveRun = parsed.runSnap;
          if (adoptActiveArena || (hadNoRun && liveRun.status === STATUS_ACTIVE)) {
            selectedArena = liveRun.arenaId;
            autoAdvanceTabFromConfirmedRun(liveRun);
          }
        }
        hydrateScholarNicks([
          ...parsed.leaders.map((x) => x.identity),
          ...parsed.logs.map((x) => x.identity),
        ]);
      }
    }
  } catch (_) {}
  renderAllUI();
}

async function ensurePlayerIdentity() {
  const idRec = await wallet.ensureIdentityWithPrompt({
    rpcUrl,
    appName: 'Haltfree Ecosystem',
  });
  if (!idRec?.identityAddr || idRec.identityAddr === ZERO_ADDR) {
    throw new Error('Deploy your Identity HFS first to play on Subnet 1!');
  }
  return idRec.identityAddr.toLowerCase();
}

async function startExpeditionOnChain(arenaId = selectedArena) {
  if (txBusy) return;
  if (!contractAddr) {
    showToast('⚠ Sanctuary HFS contract not connected yet.');
    return;
  }

  let identityAddr;
  try {
    identityAddr = await ensurePlayerIdentity();
  } catch (err) {
    showToast(`⚠ Identity HFS required: ${err?.message || err}`);
    return;
  }

  txBusy = true;
  txPhaseLabel = `Launching Arena ${arenaId + 1} Expedition on Subnet 1…`;
  renderAllUI();

  try {
    const uniqTargets = Array.from(new Set([contractAddr, identityAddr]));
    const { txHash, receipt } = await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: encodeAbi('startRun(uint64,address)', [
        ['uint64', BigInt(arenaId)],
        ['address', identityAddr],
      ]),
      gasLimit: 4_500_000n,
      extraTargets: uniqTargets,
      label: `startRun(Arena #${arenaId + 1})`,
    });

    const emitted = extractEmittedSnapshotFromReceipt(receipt);
    if (emitted?.snap) {
      liveRun = emitted.snap;
      selectedArena = liveRun.arenaId;
      focusedTab = 0;
      syncDefaultPendingActionForTab();
      const blk = Number(BigInt(receipt.blockNumber || 0));
      sessionEventFeed.unshift({
        blk,
        txHash,
        eventName: emitted.eventName,
        summary: `Expedition #${liveRun.runNumber} started (${ARENAS[selectedArena].shortName})`,
        tone: 'cyan',
      });
      pushSplashRing(480, 165, '#34d399');
      pushCanvasPopup(`🌱 SEASON 1 READY · ${WEATHER_META[liveRun.upcomingWeather]?.name || 'Sunny'}!`, '#6ee7b7', 480, 175);
      showToast(`🚀 Expedition #${liveRun.runNumber} live at Blk #${blk}! Pick your Season 1 Action!`);
    }
    await refreshOnChainState(false);
  } catch (err) {
    showToast(`⚠ ${err?.message || err}`);
  } finally {
    txBusy = false;
    txPhaseLabel = '';
    renderAllUI();
  }
}

async function playRoundActionOnChain() {
  if (txBusy) return;
  if (!contractAddr) {
    showToast('⚠ Sanctuary HFS contract not connected yet.');
    return;
  }

  // If no active run in this arena (or previous run ended), start a fresh expedition!
  if (!isRunMatchingSelectedArena() || liveRun.status !== STATUS_ACTIVE) {
    await startExpeditionOnChain(selectedArena);
    return;
  }

  let identityAddr;
  try {
    identityAddr = await ensurePlayerIdentity();
  } catch (err) {
    showToast(`⚠ Identity HFS required: ${err?.message || err}`);
    return;
  }

  const playingSeason = liveRun.round;
  const { actionKind, target, choice } = pendingAction;

  txBusy = true;
  txPhaseLabel = `Sealing Season ${playingSeason}/8 Action on Subnet 1…`;
  renderAllUI();

  try {
    const uniqTargets = Array.from(new Set([contractAddr, identityAddr]));
    const { txHash, receipt } = await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: encodeAbi('playRound(address,uint64,uint64,uint64)', [
        ['address', identityAddr],
        ['uint64', BigInt(actionKind)],
        ['uint64', BigInt(target)],
        ['uint64', BigInt(choice)],
      ]),
      gasLimit: 5_000_000n,
      extraTargets: uniqTargets,
      label: `playRound(S${playingSeason})`,
    });

    const emitted = extractEmittedSnapshotFromReceipt(receipt);
    if (emitted?.snap) {
      const snap = emitted.snap;
      liveRun = snap;
      const blk = Number(BigInt(receipt.blockNumber || 0));

      // Trigger rich visual celebration on `<canvas>` strictly from the emitted HFS payload!
      const splashX = actionKind === 0 ? 180 + target * 125 : 520;
      const splashY = actionKind === 0 && target === 0 ? 125 : 185 + ((target % 3) * 45);
      pushSplashRing(splashX, splashY, snap.status === STATUS_HALTED ? '#fb7185' : '#38bdf8');

      if (snap.status === STATUS_HALTED) {
        const diag = HALT_DIAGNOSES[snap.haltReason] || HALT_DIAGNOSES[5];
        pushCanvasPopup(diag.badge, '#fda4af', 480, 175);
        sessionEventFeed.unshift({
          blk,
          txHash,
          eventName: 'RoundResolved',
          summary: `S${snap.lastRoundPlayed} HALTED (${diag.badge.replace(/^[^\s]+\s/, '')})`,
          tone: 'rose',
        });
        showToast(`${diag.badge} — Read the Science Clue & launch a new expedition!`);
      } else {
        pushCanvasPopup(`+${snap.lastYield} 🧺 Season ${snap.lastRoundPlayed} Harvest!`, '#fde047', 490, 195);
        const comboInfo = COMBO_META[snap.comboId];
        if (comboInfo) {
          eventCelebrationUntil = performance.now() + 2800;
          pushCanvasPopup(comboInfo.badge, comboInfo.color, 490, 148);
        }
        if (snap.status === STATUS_VICTORY) {
          eventCelebrationUntil = performance.now() + 5000;
          pushCanvasPopup(
            `🏆 VICTORY · ${'⭐'.repeat(snap.starsEarned)} (${snap.totalHarvest} Harvest · +${snap.xpGained} XP)!`,
            '#6ee7b7',
            480,
            112
          );
          showToast(
            `🎉 8-Season Expedition Complete! Earned ${'⭐'.repeat(snap.starsEarned)} & ${snap.totalHarvest} Harvest!`
          );
        } else {
          autoAdvanceTabFromConfirmedRun(snap);
        }

        sessionEventFeed.unshift({
          blk,
          txHash,
          eventName: 'RoundResolved',
          summary:
            snap.status === STATUS_VICTORY
              ? `S8 VICTORY ${'⭐'.repeat(snap.starsEarned)} · 🧺${snap.totalHarvest}`
              : `S${snap.lastRoundPlayed} ${WEATHER_META[snap.weatherApplied]?.icon || ''} +${snap.lastYield} 🧺 (Loop ${snap.loopLinks}/6)`,
          tone: 'emerald',
        });
      }
    }

    await refreshOnChainState(false);
  } catch (err) {
    showToast(`⚠ ${err?.message || err}`);
  } finally {
    txBusy = false;
    txPhaseLabel = '';
    renderAllUI();
  }
}

// ---------------------------------------------------------------------------
// 60-FPS Procedural `<canvas>` Living Cross-Section (Driven 100% by `liveRun`!)
// ---------------------------------------------------------------------------

function getDisplayedStateForCanvas() {
  if (isRunMatchingSelectedArena()) {
    return liveRun;
  }
  // Unstarted wild degraded baseline preview of the selected Arena (zero simulation!)
  const baseVitals = [
    [68, 62, 52, 70],
    [62, 58, 48, 64],
    [58, 62, 44, 58],
    [54, 58, 42, 52],
  ][selectedArena];
  return {
    status: STATUS_NONE,
    arenaId: selectedArena,
    round: 0,
    lastRoundPlayed: 0,
    slots: [0, 0, 0, 0, 0, 0],
    o2: baseVitals[0],
    clarity: baseVitals[1],
    fertility: baseVitals[2],
    cleanliness: baseVitals[3],
    weatherApplied: 0,
    upcomingWeather: 0,
    loopLinks: 0,
    shortcutCount: 0,
    starsEarned: 0,
    totalHarvest: 0,
    haltReason: 0,
  };
}

function drawFish(ctx, x, y, dir, scale, bodyColor, finColor, t, gasping = false, isAxolotl = false) {
  ctx.save();
  ctx.translate(x, y);
  if (dir < 0) ctx.scale(-1, 1);
  if (gasping) ctx.rotate(-0.38);
  ctx.scale(scale, scale);

  const wag = Math.sin(t * 7.5) * 4.5;
  ctx.fillStyle = finColor;
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(-25, -8 + wag);
  ctx.lineTo(-22, wag * 0.4);
  ctx.lineTo(-25, 8 + wag);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-4, -7);
  ctx.quadraticCurveTo(2, -14, 7, -6);
  ctx.fill();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isAxolotl) {
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    for (const dy of [-5, -2, 2]) {
      ctx.beginPath();
      ctx.moveTo(7, dy);
      ctx.lineTo(4, dy - 5);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(10, -2, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(10.7, -2, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTree(ctx, x, y, canopyColor, trunkColor, t, hasBerries = false, hasCocoons = false) {
  const sway = Math.sin(t * 1.8 + x * 0.02) * 3.5;
  ctx.strokeStyle = trunkColor;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + sway * 0.4, y - 36, x + sway, y - 68);
  ctx.stroke();

  const blobs = [
    [x - 22 + sway, y - 72, 22],
    [x + 20 + sway, y - 70, 21],
    [x + sway, y - 88, 26],
    [x - 7 + sway, y - 60, 20],
  ];
  ctx.fillStyle = canopyColor;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hasBerries) {
    ctx.fillStyle = '#a855f7';
    for (const [dx, dy] of [[-16, -70], [11, -80], [-4, -92], [18, -65]]) {
      ctx.beginPath();
      ctx.arc(x + dx + sway, y + dy, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (hasCocoons) {
    ctx.fillStyle = '#fefce8';
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1;
    for (const [dx, dy] of [[-11, -62], [8, -68], [-2, -82], [15, -76]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx + sway, y + dy, 4.3, 2.8, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawWaterColor(clarity, cleanliness) {
  const algaeFactor = clamp((72 - clarity) / 55, 0, 1);
  const toxFactor = clamp((65 - cleanliness) / 55, 0, 1);
  const r = Math.round(12 + algaeFactor * 38 + toxFactor * 95);
  const g = Math.round(122 + algaeFactor * 52 - toxFactor * 48);
  const b = Math.round(154 - algaeFactor * 95 - toxFactor * 74);
  return {
    top: `rgba(${r}, ${g}, ${b}, 0.85)`,
    deep: `rgba(${Math.max(4, r - 8)}, ${Math.max(22, g - 58)}, ${Math.max(18, b - 62)}, 0.96)`,
  };
}

let lastFrameMs = performance.now();

function renderCanvasLoop(nowMs) {
  const canvas = document.getElementById('ecoCanvas');
  if (!canvas) {
    requestAnimationFrame(renderCanvasLoop);
    return;
  }
  const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
  lastFrameMs = nowMs;
  const t = nowMs / 1000;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const snap = getDisplayedStateForCanvas();
  const slots = snap.slots;
  const wc = drawWaterColor(snap.clarity, snap.cleanliness);
  const activeWeather = snap.lastRoundPlayed > 0 ? snap.weatherApplied : snap.upcomingWeather;

  // Update top-right Canvas Status Pill
  const banner = document.getElementById('canvasStatusBanner');
  if (banner) {
    if (snap.status === STATUS_NONE) {
      banner.className = 'he-canvas-banner is-active';
      banner.textContent = '🌱 Wild Unmanaged Sanctuary · Launch Expedition to Play';
    } else if (snap.status === STATUS_VICTORY) {
      banner.className = 'he-canvas-banner is-infinite';
      banner.textContent = `🏆 VICTORY · ${'⭐'.repeat(snap.starsEarned)} · 🧺 ${snap.totalHarvest} Harvest`;
    } else if (snap.status === STATUS_HALTED) {
      banner.className = 'he-canvas-banner is-halted';
      banner.textContent = HALT_DIAGNOSES[snap.haltReason]?.badge || '⚠ Ecosystem Halted';
    } else if (snap.loopLinks === 6 && snap.shortcutCount === 0) {
      banner.className = 'he-canvas-banner is-infinite';
      banner.textContent = `♾️ 6/6 INFINITE LOOP ACTIVE · Season ${snap.round}/8`;
    } else {
      banner.className = 'he-canvas-banner is-active';
      banner.textContent = `⛓️ Season ${snap.round}/8 · Loop ${snap.loopLinks}/6 · 🧺 ${snap.totalHarvest}`;
    }
  }

  // 1. Sky Backdrop (reacts to Arena & Weather!)
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.44);
  if (selectedArena === 3) {
    skyGrad.addColorStop(0, activeWeather === 5 ? '#451a03' : '#7c2d12');
    skyGrad.addColorStop(1, activeWeather === 5 ? '#b45309' : '#fdba74');
  } else if (activeWeather === 2) {
    skyGrad.addColorStop(0, '#1e293b');
    skyGrad.addColorStop(1, '#64748b');
  } else if (selectedArena === 2) {
    skyGrad.addColorStop(0, '#0c4a6e');
    skyGrad.addColorStop(1, '#bae6fd');
  } else {
    skyGrad.addColorStop(0, '#0ea5e9');
    skyGrad.addColorStop(1, '#fef3c7');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Sun / Heatwave Glow
  const sunX = selectedArena === 3 ? 810 : 720;
  const sunRadius = activeWeather === 3 ? 86 : 64;
  const sunGrad = ctx.createRadialGradient(sunX, 58, 6, sunX, 58, sunRadius);
  sunGrad.addColorStop(0, activeWeather === 3 ? '#fde047' : '#fef08a');
  sunGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(sunX, 58, sunRadius, 0, Math.PI * 2);
  ctx.fill();

  // 2. Arena-Specific Living Cross-Section
  if (selectedArena === 0) {
    // Distant Pearl River Hills
    ctx.fillStyle = 'rgba(21, 128, 61, 0.28)';
    ctx.beginPath();
    ctx.moveTo(220, 138);
    ctx.quadraticCurveTo(450, 78, 660, 132);
    ctx.quadraticCurveTo(820, 88, 960, 126);
    ctx.lineTo(960, 152);
    ctx.lineTo(220, 152);
    ctx.fill();

    // Pond Water Column (`x: 235..960, y: 122..330`)
    const wGrad = ctx.createLinearGradient(0, 122, 0, 320);
    wGrad.addColorStop(0, wc.top);
    wGrad.addColorStop(1, wc.deep);
    ctx.fillStyle = wGrad;
    ctx.beginPath();
    ctx.moveTo(235, 124);
    for (let wx = 235; wx <= W; wx += 24) {
      ctx.lineTo(wx, 123 + Math.sin(wx * 0.03 + t * 2.6) * 2.8);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(235, H);
    ctx.closePath();
    ctx.fill();

    if (snap.clarity > 45) {
      ctx.save();
      ctx.globalAlpha = ((snap.clarity - 40) / 60) * 0.16;
      ctx.fillStyle = '#fef9c3';
      for (const bx of [380, 560, 740]) {
        ctx.beginPath();
        ctx.moveTo(bx, 124);
        ctx.lineTo(bx + 50, 124);
        ctx.lineTo(bx - 16 + Math.sin(t + bx) * 10, 312);
        ctx.lineTo(bx - 74 + Math.sin(t + bx) * 10, 312);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Left Earthen Dyke & Pond Floor
    const soilHealthy = snap.fertility > 52;
    ctx.fillStyle = soilHealthy ? '#5c3a21' : '#78716c';
    ctx.beginPath();
    ctx.moveTo(0, 108);
    ctx.lineTo(242, 118);
    ctx.quadraticCurveTo(285, 222, 315, 310);
    ctx.lineTo(960, 315);
    ctx.lineTo(960, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = soilHealthy ? '#22c55e' : '#a3a380';
    ctx.fillRect(0, 102, 244, 11);

    // Zone 0: Shoreline Dyke Plant
    if (slots[0] === 2) {
      drawTree(ctx, 74, 106, soilHealthy ? '#16a34a' : '#84cc16', '#713f12', t, true, slots[1] === 1);
      drawTree(ctx, 170, 110, soilHealthy ? '#15803d' : '#65a30d', '#713f12', t + 1.2, true, slots[1] === 1);
    } else if (slots[0] === 1) {
      drawTree(ctx, 118, 108, '#064e3b', '#451a03', t, false, false);
    } else if (slots[0] === 3) {
      ctx.fillStyle = '#eab308';
      for (let cx = 28; cx < 210; cx += 28) ctx.fillRect(cx, 66, 6, 40);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.fillRect(225, 116, 45, 15);
    }

    // Zone 2: Duckweed Pads on Surface when Grass Carp & Duckweed stocked
    if (slots[2] === 3) {
      ctx.fillStyle = '#4ade80';
      for (let p = 0; p < 8; p++) {
        const px = 278 + p * 44 + Math.sin(t * 1.5 + p) * 4;
        ctx.beginPath();
        ctx.ellipse(px, 124, 11, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4 Water Depth Labels
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.fillText('Z3 · 0–0.5m Surface', 808, 148);
    ctx.fillText('Z4 · 0.5–1.5m Phyto', 808, 194);
    ctx.fillText('Z5 · 1.5–2.5m Zoopl.', 808, 242);
    ctx.fillText('Z6 · 2.5–3.5m Benthic', 808, 290);

    const gasping = snap.o2 <= 32;
    for (const sw of swimmers) {
      sw.x += sw.vx * dt;
      if (sw.x < 305) {
        sw.x = 305;
        sw.vx = Math.abs(sw.vx);
      }
      if (sw.x > 795) {
        sw.x = 795;
        sw.vx = -Math.abs(sw.vx);
      }

      if (sw.band === 0 && slots[2] > 0) {
        const col = slots[2] === 3 ? '#86efac' : slots[2] === 1 ? '#f43f5e' : '#fb923c';
        drawFish(ctx, sw.x, 146 + Math.sin(t * 2 + sw.phase) * 5, sw.vx, 0.88, col, '#fef08a', t + sw.phase, gasping);
      } else if (sw.band === 1 && (slots[3] === 1 || slots[3] === 3)) {
        const col = slots[3] === 1 ? '#e2e8f0' : '#93c5fd';
        drawFish(ctx, sw.x, 192 + Math.sin(t * 1.8 + sw.phase) * 7, sw.vx, 0.86, col, '#94a3b8', t + sw.phase, gasping);
      } else if (sw.band === 2 && (slots[4] === 2 || slots[4] === 1)) {
        const col = slots[4] === 2 ? '#fbbf24' : '#ef4444';
        drawFish(ctx, sw.x, 240 + Math.sin(t * 1.6 + sw.phase) * 7, sw.vx, 0.94, col, '#d97706', t + sw.phase, gasping);
      } else if (sw.band === 3 && slots[5] === 3) {
        drawFish(ctx, sw.x, 288 + Math.sin(t * 1.4 + sw.phase) * 4, sw.vx, 0.92, '#a8a29e', '#d6d3d1', t + sw.phase, gasping);
      }
    }
  } else if (selectedArena === 1) {
    const wGrad = ctx.createLinearGradient(0, 134, 0, H);
    wGrad.addColorStop(0, wc.top);
    wGrad.addColorStop(1, wc.deep);
    ctx.fillStyle = wGrad;
    ctx.fillRect(0, 134, W, H - 134);

    ctx.fillStyle = '#5c3a21';
    ctx.beginPath();
    ctx.roundRect(275, 120, 410, 68, 16);
    ctx.fill();
    ctx.fillStyle = snap.fertility > 52 ? '#22c55e' : '#a3a380';
    ctx.fillRect(282, 114, 396, 10);

    if (slots[0] === 1) {
      drawTree(ctx, 298, 118, '#4ade80', '#78350f', t);
      drawTree(ctx, 662, 118, '#4ade80', '#78350f', t + 1.5);
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.55)';
      ctx.lineWidth = 2;
      for (let rx = 290; rx <= 670; rx += 22) {
        ctx.beginPath();
        ctx.moveTo(rx, 186);
        ctx.quadraticCurveTo(rx + Math.sin(t * 2 + rx) * 6, 224, rx, 255);
        ctx.stroke();
      }
    }

    if (slots[1] === 3) {
      for (let cx = 365; cx <= 595; cx += 46) {
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx, 116);
        ctx.lineTo(cx + Math.sin(t * 2 + cx) * 3, 60);
        ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.ellipse(cx + 5, 86, 4, 8, 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(cx + 18, 112, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (slots[2] === 1 || slots[2] === 2) {
      ctx.fillStyle = slots[2] === 1 ? '#4ade80' : '#15803d';
      const cnt = slots[2] === 2 ? 20 : 8;
      for (let i = 0; i < cnt; i++) {
        ctx.beginPath();
        ctx.ellipse(45 + i * 44, 136, 14, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const gasping = snap.o2 <= 32;
    for (const sw of swimmers) {
      sw.x = ((sw.x + sw.vx * dt + W) % (W - 80)) + 40;
      if (sw.band <= 1 && slots[4] === 3) {
        drawFish(ctx, sw.x, 268 + (sw.id % 3) * 14 + Math.sin(t * 2 + sw.phase) * 4, sw.vx, 0.96, '#fbcfe8', '#f472b6', t + sw.phase, gasping, true);
      } else if (sw.band >= 2 && (slots[3] === 2 || slots[3] === 1)) {
        const col = slots[3] === 2 ? '#bae6fd' : '#ca8a04';
        drawFish(ctx, sw.x, 212 + Math.sin(t * 2.5 + sw.phase) * 7, sw.vx, 0.72, col, '#38bdf8', t + sw.phase, gasping);
      }
    }
  } else if (selectedArena === 2) {
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H + 130, 540, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 292, W, 38);

    ctx.fillStyle = wc.top;
    ctx.fillRect(55, 124, 250, 168);
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 3;
    ctx.strokeRect(55, 118, 250, 174);

    ctx.fillStyle = slots[2] === 3 ? '#78350f' : '#475569';
    ctx.fillRect(350, 168, 195, 84);
    ctx.strokeStyle = '#38bdf8';
    ctx.strokeRect(350, 168, 195, 84);
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = '#fef08a';
    ctx.fillText(slots[2] === 3 ? '🧬 NH3 ➔ NO2- ➔ NO3-' : '⚠ Bio-Media Uncycled', 368, 158);

    ctx.fillStyle = wc.top;
    ctx.fillRect(585, 196, 330, 96);
    ctx.strokeStyle = '#34d399';
    ctx.strokeRect(585, 196, 330, 96);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(595, 188, 310, 8);

    if (slots[3] === 1) {
      for (let lx = 618; lx <= 885; lx += 38) {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(lx, 178 + Math.sin(t * 2 + lx) * 2, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(lx + 7, 183, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (slots[0] > 0) {
      const cnt = slots[0] === 3 ? 16 : 8;
      for (let i = 0; i < cnt; i++) {
        const sw = swimmers[i];
        const fx = 85 + ((sw.x + i * 29) % 190);
        const fy = 145 + (i % 5) * 24 + Math.sin(t * 2.5 + i) * 4;
        drawFish(ctx, fx, fy, sw.vx, 0.8, '#93c5fd', '#38bdf8', t + i, snap.o2 <= 32);
      }
    }
  } else {
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(0, 272, W, 58);

    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 302, 300, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = snap.o2 > 45 ? 'rgba(14, 165, 233, 0.22)' : 'rgba(127, 29, 29, 0.34)';
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    if (slots[0] === 3) {
      for (const cx of [255, 305, 355]) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.84)';
        ctx.fillRect(cx, 126, 28, 150);
        ctx.strokeStyle = '#a7f3d0';
        ctx.strokeRect(cx, 126, 28, 150);
      }
    }

    ctx.fillStyle = slots[5] === 1 ? '#422006' : '#b45309';
    ctx.fillRect(420, 232, 280, 44);
    if (slots[2] === 2) {
      for (let wx = 435; wx <= 685; wx += 18) {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(wx, 200 + Math.sin(t * 2 + wx) * 2, 4, 32);
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(wx + 2, 230, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (slots[3] === 2) {
      ctx.fillStyle = '#fef3c7';
      for (const mx of [185, 208, 230]) {
        ctx.beginPath();
        ctx.arc(mx, 268, 8.5, Math.PI, 0);
        ctx.fill();
      }
    }
    if (slots[1] === 1) {
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.ellipse(740, 274, 55, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Weather & Oxygen Bubble Particles
  for (const p of particles) {
    p.t = (p.t + dt * (activeWeather === 2 ? 0.95 : 0.25)) % 1;
    if (activeWeather === 2 && selectedArena <= 1) {
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
      ctx.lineWidth = 1.4;
      const rx = (p.x + p.t * 90) % W;
      const ry = p.t * H;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 6, ry + 14);
      ctx.stroke();
    } else if (snap.o2 > 42 && p.kind <= 1) {
      ctx.fillStyle = 'rgba(186, 230, 253, 0.55)';
      const bx = 270 + (p.x % 630);
      const by = 302 - p.t * 168;
      ctx.beginPath();
      ctx.arc(bx, by, p.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 4. Glowing 6/6 Closed-Loop Nutrient Arc!
  if ((snap.loopLinks === 6 && snap.shortcutCount === 0) || nowMs < eventCelebrationUntil) {
    ctx.save();
    ctx.strokeStyle = snap.loopLinks === 6 ? 'rgba(52, 211, 153, 0.65)' : 'rgba(250, 204, 21, 0.45)';
    ctx.lineWidth = 3.2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 46;
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.54, 315, 102, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (let k = 0; k < 8; k++) {
      const ang = t * 1.5 + (k * Math.PI) / 4;
      const ox = W * 0.5 + Math.cos(ang) * 315;
      const oy = H * 0.54 + Math.sin(ang) * 102;
      ctx.fillStyle = k % 2 === 0 ? '#fde047' : '#34d399';
      ctx.beginPath();
      ctx.arc(ox, oy, 5.0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Splash Rings & Floating HFS Event Result Popups
  for (let i = splashRings.length - 1; i >= 0; i--) {
    const sr = splashRings[i];
    const age = (nowMs - sr.bornMs) / sr.ttlMs;
    if (age >= 1) {
      splashRings.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = sr.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(sr.x, sr.y, 12 + age * 75, 5 + age * 26, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  for (let i = floatingPopups.length - 1; i >= 0; i--) {
    const fp = floatingPopups[i];
    const age = (nowMs - fp.bornMs) / fp.ttlMs;
    if (age >= 1) {
      floatingPopups.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = age < 0.75 ? 1 : (1 - age) / 0.25;
    const py = fp.y - age * 46;
    ctx.font = '900 15px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(fp.text).width;
    ctx.fillStyle = 'rgba(4, 18, 30, 0.86)';
    ctx.strokeStyle = fp.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(fp.x - tw / 2 - 13, py - 16, tw + 26, 26, 999);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = fp.color;
    ctx.fillText(fp.text, fp.x - tw / 2, py + 2);
    ctx.restore();
  }

  requestAnimationFrame(renderCanvasLoop);
}

// ---------------------------------------------------------------------------
// DOM Rendering: Arena Strip, 8-Season Track, Turn Deck, Vitals & Passport
// ---------------------------------------------------------------------------

function renderArenaSelector() {
  const mount = document.getElementById('arenaSelectorMount');
  if (!mount) return;
  const bestStars = onChainOverview?.viewer?.bestStars || [0, 0, 0, 0];

  mount.innerHTML = ARENAS.map((a) => {
    const stars = bestStars[a.id] || 0;
    const starBadge = stars > 0 ? '⭐'.repeat(stars) : '☆☆☆';
    const hasLiveHere = liveRun && liveRun.status === STATUS_ACTIVE && liveRun.arenaId === a.id;
    return `
      <button type="button" class="he-arena-card ${selectedArena === a.id ? 'is-active' : ''}" data-arena-id="${a.id}">
        <img src="${a.thumb}" alt="${escapeHtml(a.shortName)}" class="he-arena-thumb" />
        <div class="he-arena-meta">
          <div class="he-arena-lvl">
            <span>Lv.${a.id + 1}${hasLiveHere ? ' · LIVE' : ''}</span>
            <span>${starBadge}</span>
          </div>
          <div class="he-arena-name">${escapeHtml(a.shortName)}</div>
          <div class="he-arena-sub">${escapeHtml(a.era.split('·')[0])}</div>
        </div>
      </button>
    `;
  }).join('');

  const active = ARENAS[selectedArena];
  document.getElementById('lblArenaEra').textContent = active.era;
  document.getElementById('lblArenaTitle').textContent = active.title;
  document.getElementById('arenaStoryMount').innerHTML = `
    <img src="${active.thumb}" alt="${escapeHtml(active.shortName)}" class="he-history-img" />
    <div>${active.story}</div>
  `;
}

function renderTimelineAndHud() {
  const inArena = isRunMatchingSelectedArena();
  const snap = inArena ? liveRun : null;

  const loopEl = document.getElementById('lblLoopRing');
  const streakEl = document.getElementById('lblStreakChip');
  const startBtn = document.getElementById('btnStartOrResetRun');
  const txOv = document.getElementById('canvasTxOverlay');

  if (txOv) {
    txOv.style.display = txBusy ? 'flex' : 'none';
    if (txBusy) {
      document.getElementById('lblTxPhaseTitle').textContent = `⛓️ ${txPhaseLabel}`;
    }
  }

  const loopLinks = snap ? snap.loopLinks : 0;
  if (loopEl) {
    loopEl.textContent = `♾️ Loop ${loopLinks}/6`;
    loopEl.className = `he-hud-chip he-chip-loop mono ${loopLinks === 6 && snap?.shortcutCount === 0 ? 'is-full' : ''}`;
  }
  if (streakEl) {
    streakEl.textContent = `🔥 Streak ${snap ? snap.comboStreak : 0}`;
  }
  if (startBtn) {
    startBtn.disabled = txBusy;
    startBtn.textContent =
      snap && snap.status === STATUS_ACTIVE ? '↺ Restart Expedition ($0 Gas)' : '🚀 New Expedition ($0 Gas)';
  }

  // 8-Season Track
  const stepsMount = document.getElementById('seasonStepsMount');
  if (stepsMount) {
    stepsMount.innerHTML = SEASON_LABELS.map((lbl, idx) => {
      const sNum = idx + 1;
      let cls = '';
      let icon = '○';
      if (snap) {
        if (snap.status === STATUS_VICTORY || sNum <= snap.lastRoundPlayed) {
          if (snap.status === STATUS_HALTED && sNum === snap.lastRoundPlayed) {
            cls = 'is-halted';
            icon = '✖';
          } else {
            cls = 'is-done';
            icon = '✓';
          }
        } else if (snap.status === STATUS_ACTIVE && sNum === snap.round) {
          cls = 'is-current';
          icon = '▶';
        }
      }
      return `<span class="he-s-node mono ${cls}">${icon} ${escapeHtml(lbl)}</span>`;
    }).join('');
  }

  // Forecast Pill
  const fcMount = document.getElementById('forecastBannerMount');
  if (fcMount) {
    if (!snap || snap.status === STATUS_NONE) {
      fcMount.innerHTML = `☀️ Click <strong>Start Season 1 Expedition</strong> to begin your live 8-season run on Subnet 1!`;
    } else if (snap.status === STATUS_VICTORY) {
      fcMount.innerHTML = `🏆 All 8 Seasons Balanced (${'⭐'.repeat(snap.starsEarned)} · 🧺 ${snap.totalHarvest} Harvest)! Try the next Arena or beat your high score!`;
    } else if (snap.status === STATUS_HALTED) {
      fcMount.innerHTML = `🔬 Expedition halted on Season ${snap.lastRoundPlayed} — click <strong>New Expedition</strong> to apply what you learned!`;
    } else {
      const wm = WEATHER_META[snap.upcomingWeather] || WEATHER_META[0];
      fcMount.innerHTML = `${wm.icon} <strong>Season ${snap.round} Forecast — ${escapeHtml(wm.name)}:</strong> ${escapeHtml(wm.tip)}`;
    }
  }
}

function renderCommandDeck() {
  const inArena = isRunMatchingSelectedArena();
  const snap = inArena ? liveRun : null;
  const activeArena = ARENAS[selectedArena];

  const badgeEl = document.getElementById('lblDeckRoundBadge');
  const promptEl = document.getElementById('lblDeckPrompt');
  const execBtn = document.getElementById('btnExecuteRoundAction');
  const tabsMount = document.getElementById('zoneTabsMount');
  const qMount = document.getElementById('zoneQuestionMount');
  const cardsMount = document.getElementById('actionCardsMount');

  const isActiveRun = Boolean(snap && snap.status === STATUS_ACTIVE);

  if (!isActiveRun) {
    badgeEl.textContent = snap?.status === STATUS_VICTORY ? 'VICTORY ACHIEVED' : snap?.status === STATUS_HALTED ? 'ECOSYSTEM HALTED' : 'EXPEDITION STANDBY';
    promptEl.textContent =
      snap?.status === STATUS_VICTORY
        ? `Bravo! You earned ${'⭐'.repeat(snap.starsEarned)} (${snap.totalHarvest} Harvest). Launch a new expedition or advance to Level ${Math.min(4, selectedArena + 2)}!`
        : snap?.status === STATUS_HALTED
        ? `Halted at Season ${snap.lastRoundPlayed} — launch a fresh 8-season expedition on Subnet 1 to test a better food web!`
        : `Start your 8-Season Expedition in ${activeArena.shortName} — each round confirms on Subnet 1!`;
    execBtn.disabled = txBusy;
    execBtn.textContent = txBusy ? '⛓️ Confirming on Subnet 1…' : `🚀 Start Season 1 Expedition ($0 Gas)`;
  } else {
    badgeEl.textContent = `SEASON ${snap.round} OF 8`;
    let chosenLabel = '';
    if (pendingAction.actionKind === 0) {
      const ch = activeArena.zones[pendingAction.target]?.choices.find((c) => c.val === pendingAction.choice);
      chosenLabel = ch ? `${ch.icon} ${ch.name}` : 'Select an Action';
    } else {
      const st = STEWARD_ACTIONS.find((s) => s.target === pendingAction.target);
      chosenLabel = st ? `${st.icon} ${st.name}` : 'Steward Action';
    }
    promptEl.textContent = `Selected Move: ${chosenLabel}`;
    execBtn.disabled = txBusy;
    execBtn.textContent = txBusy
      ? '⛓️ Sealing Season on Subnet 1…'
      : `⚡ Commit Season ${snap.round} Action ($0 Gas)`;
  }

  // Render 6 Zone Tabs + 1 Steward Tab
  const zoneTabsHtml = activeArena.zones
    .map((z, idx) => {
      const curChoiceVal = snap ? snap.slots[idx] : 0;
      const curChoice = z.choices.find((c) => c.val === curChoiceVal);
      const statusSym = curChoice ? curChoice.icon : '○';
      return `
        <button type="button"
          class="he-zone-tab ${focusedTab === idx ? 'is-focused' : ''} ${curChoice ? 'is-stocked' : ''}"
          data-focus-tab="${idx}">
          <span class="he-zone-tab-top mono"><span>Z${idx + 1}</span><span>${statusSym}</span></span>
          <span class="he-zone-tab-name">${escapeHtml(z.short)}</span>
        </button>
      `;
    })
    .join('');

  const stewardTabHtml = `
    <button type="button"
      class="he-zone-tab ${focusedTab === 6 ? 'is-focused' : ''} ${snap?.loopLinks === 6 ? 'is-stocked' : ''}"
      data-focus-tab="6">
      <span class="he-zone-tab-top mono"><span>CARE</span><span>${snap?.loopLinks === 6 ? '♾️' : '🛠️'}</span></span>
      <span class="he-zone-tab-name">Steward &amp; Loop</span>
    </button>
  `;
  tabsMount.innerHTML = zoneTabsHtml + stewardTabHtml;

  // Render 3 Action Cards for Focused Tab
  if (focusedTab >= 0 && focusedTab < 6) {
    const z = activeArena.zones[focusedTab];
    const installedVal = snap ? snap.slots[focusedTab] : 0;
    qMount.innerHTML = `🔬 <strong>${escapeHtml(z.question)}</strong>`;
    cardsMount.innerHTML = z.choices
      .map((c) => {
        const isPicked = pendingAction.actionKind === 0 && pendingAction.target === focusedTab && pendingAction.choice === c.val;
        const isInstalled = installedVal === c.val;
        return `
          <button type="button"
            class="he-act-card ${isPicked ? 'is-picked' : ''} ${isInstalled ? 'is-installed' : ''}"
            data-act-kind="0"
            data-act-target="${focusedTab}"
            data-act-choice="${c.val}">
            <div>
              <div class="he-act-top">
                <span class="he-act-icon">${c.icon}</span>
                <span class="he-act-tag mono ${isInstalled ? 'installed' : ''}">
                  ${isInstalled ? '✓ Active in Pond' : escapeHtml(c.tag)}
                </span>
              </div>
              <div class="he-act-title" style="margin-top:6px;">${escapeHtml(c.name)}</div>
              <div class="he-act-desc" style="margin-top:4px;">${escapeHtml(c.desc)}</div>
            </div>
            <div class="mono" style="font-size:0.71rem;color:${isPicked ? '#6ee7b7' : '#94a3b8'};">
              ${isPicked ? '▶ Selected for This Season' : 'Click to Select'}
            </div>
          </button>
        `;
      })
      .join('');
  } else {
    qMount.innerHTML = `🛠️ <strong>Seasonal Stewardship &amp; Autonomous Loop Verification:</strong> Clean silt, boost O2 during Heatwaves, or prove your 6/6 Closed Loop runs hands-free for 2&times; Harvest!`;
    cardsMount.innerHTML = STEWARD_ACTIONS.map((s) => {
      const isPicked = pendingAction.actionKind === 1 && pendingAction.target === s.target;
      return `
        <button type="button"
          class="he-act-card ${isPicked ? 'is-picked' : ''}"
          data-act-kind="1"
          data-act-target="${s.target}"
          data-act-choice="0">
          <div>
            <div class="he-act-top">
              <span class="he-act-icon">${s.icon}</span>
              <span class="he-act-tag mono">${escapeHtml(s.tag)}</span>
            </div>
            <div class="he-act-title" style="margin-top:6px;">${escapeHtml(s.name)}</div>
            <div class="he-act-desc" style="margin-top:4px;">${escapeHtml(s.desc)}</div>
          </div>
          <div class="mono" style="font-size:0.71rem;color:${isPicked ? '#6ee7b7' : '#94a3b8'};">
            ${isPicked ? '▶ Selected for This Season' : 'Click to Select'}
          </div>
        </button>
      `;
    }).join('');
  }
}

function formatDeltaBadge(cur, prev, showDelta) {
  if (!showDelta) return '';
  const d = cur - prev;
  if (d === 0) return '';
  return d > 0
    ? `<span class="he-delta-pos mono">+${d}%</span>`
    : `<span class="he-delta-neg mono">${d}%</span>`;
}

function renderSidebar() {
  const snap = getDisplayedStateForCanvas();
  const hasPlayedRound = isRunMatchingSelectedArena() && snap.lastRoundPlayed > 0;

  document.getElementById('lblTotalYield').textContent = `🧺 ${snap.totalHarvest} Harvest`;

  const bars = [
    { label: '🫧 Oxygen Balance', val: snap.o2, prev: snap.prevO2 ?? snap.o2, color: 'linear-gradient(90deg,#0ea5e9,#38bdf8)', ok: snap.o2 > 32 },
    { label: '💎 Water / Air Clarity', val: snap.clarity, prev: snap.prevClarity ?? snap.clarity, color: 'linear-gradient(90deg,#06b6d4,#2dd4bf)', ok: snap.clarity > 26 },
    { label: '🌱 Soil & Silt Fertility', val: snap.fertility, prev: snap.prevFertility ?? snap.fertility, color: 'linear-gradient(90deg,#22c55e,#84cc16)', ok: snap.fertility > 26 },
    { label: '🛡️ Cleanliness (Low Toxin)', val: snap.cleanliness, prev: snap.prevCleanliness ?? snap.cleanliness, color: 'linear-gradient(90deg,#a855f7,#ec4899)', ok: snap.cleanliness > 32 },
  ];

  document.getElementById('vitalsMount').innerHTML =
    bars
      .map(
        (b) => `
      <div class="he-vital-row">
        <div class="he-vital-top">
          <span>${b.label}</span>
          <span class="mono" style="color:${b.ok ? '#6ee7b7' : '#fda4af'};">
            ${b.val}%${formatDeltaBadge(b.val, b.prev, hasPlayedRound)}
          </span>
        </div>
        <div class="he-vital-track">
          <div class="he-vital-fill" style="width:${b.val}%;background:${b.color};"></div>
        </div>
      </div>
    `
      )
      .join('') +
    (snap.toxinDebt > 0
      ? `<div class="mono" style="font-size:0.71rem;color:#fda4af;margin-top:2px;">⚠ Latent Chemical/Toxin Debt: ${snap.toxinDebt}% (scrub with Benthic Silt/Bio-Filters!)</div>`
      : '');

  // Last Emitted HFS Event & Science Clue Box
  const evBox = document.getElementById('lastEventBox');
  if (snap.status === STATUS_HALTED) {
    const diag = HALT_DIAGNOSES[snap.haltReason] || HALT_DIAGNOSES[5];
    evBox.className = 'he-diagnosis-box is-halt';
    evBox.innerHTML = `<div style="font-weight:800;margin-bottom:4px;">${diag.badge}</div><div><strong>Science Clue:</strong> ${diag.explain}</div>`;
  } else if (snap.status === STATUS_VICTORY) {
    evBox.className = 'he-diagnosis-box is-win';
    evBox.innerHTML = `<div style="font-weight:800;margin-bottom:4px;">🏆 EXPEDITION VICTORY · ${'⭐'.repeat(snap.starsEarned)}</div><div>Confirmed by <code>haltfree_ecosystem.wasm</code>! Total Harvest: <strong>${snap.totalHarvest}</strong> (+${snap.xpGained} Eco-XP).</div>`;
  } else if (hasPlayedRound) {
    const combo = COMBO_META[snap.comboId];
    const wm = WEATHER_META[snap.weatherApplied] || WEATHER_META[0];
    evBox.className = `he-diagnosis-box ${combo ? 'is-win' : ''}`;
    evBox.innerHTML = `
      <div style="font-weight:800;margin-bottom:3px;">
        ⛓️ Season ${snap.lastRoundPlayed} Emitted (${wm.icon} ${escapeHtml(wm.name)}) · +${snap.lastYield} 🧺
      </div>
      <div>${combo ? `<strong>${combo.badge}</strong> ${escapeHtml(combo.text)}` : 'Vitals updated on Subnet 1 — check the forecast and pick your next move!'}</div>
    `;
  } else {
    evBox.className = 'he-diagnosis-box';
    evBox.innerHTML = `<strong>⛓️ Pure On-Chain Gameplay:</strong> Each season submits your chosen move to Subnet 1 and renders the emitted <code>RoundResolved</code> event once confirmed!`;
  }

  // Coach Banner
  if (snap.status === STATUS_ACTIVE && snap.loopLinks === 6 && snap.shortcutCount === 0) {
    heGuide?.updateCoach({
      pill: '♾️ 6/6 LOOP READY!',
      tone: 'action',
      html: `All 6 Closed-Loop Guilds are active! Play <strong>♾️ Autonomous Hands-Off Season</strong> in the <em>Steward &amp; Loop</em> tab for a <strong>2&times; Harvest Multiplier</strong>!`,
      actionLabel: '♾️ Run Hands-Off Season',
      onAction: () => {
        focusedTab = 6;
        pendingAction = { actionKind: 1, target: 3, choice: 0 };
        playRoundActionOnChain();
      },
    });
  } else if (!isRunMatchingSelectedArena() || snap.status !== STATUS_ACTIVE) {
    heGuide?.updateCoach({
      pill: `🌿 ARENA ${selectedArena + 1}`,
      tone: 'action',
      html: `Ready to engineer <strong>${escapeHtml(ARENAS[selectedArena].shortName)}</strong>? Launch an 8-season on-chain expedition at <strong>$0.00 gas</strong>!`,
      actionLabel: '🚀 Start Season 1',
      onAction: () => startExpeditionOnChain(selectedArena),
    });
  } else {
    heGuide?.updateCoach({
      pill: `⛓️ SEASON ${snap.round}/8`,
      tone: 'info',
      html: `Choose 1 species or stewardship move below, then click <strong>Commit Season ${snap.round} Action</strong> to advance on Subnet 1!`,
    });
  }

  // Eco-Scholar Passport & Unlockable Badges
  const vw = onChainOverview?.viewer;
  const totalStars = vw ? vw.bestStars.reduce((a, b) => a + b, 0) : 0;
  const totalXp = vw ? vw.totalXp : 0;
  const badgesMask = vw ? vw.badges : 0;
  document.getElementById('lblTotalStars').textContent = `⭐ ${totalStars} / 12 · ${totalXp} XP`;

  const rankTitle =
    totalStars >= 12
      ? '👑 Grand Halt-Free Permaculturist'
      : totalStars >= 6
      ? '🔬 Closed-Loop Bio-Engineer'
      : totalStars >= 3
      ? '🐟 Master of Sangji Yutang'
      : '🌱 Permaculture Apprentice';

  document.getElementById('passportMount').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:800;color:#fde68a;font-size:0.8rem;">${rankTitle}</span>
      <span class="mono he-muted">Best Streak: 🔥${vw ? vw.bestStreak : 0}</span>
    </div>
    <div class="he-badge-grid">
      ${ARENAS.map((a) => {
        const solved = vw && (vw.solvedMask & (1 << a.id)) !== 0;
        const st = vw ? vw.bestStars[a.id] : 0;
        return `
          <div class="he-mini-badge ${solved ? 'solved' : ''}">
            <div style="font-weight:800;">${escapeHtml(a.shortName)}</div>
            <div class="mono" style="color:${solved ? '#6ee7b7' : '#94a3b8'};">
              ${solved ? `${'⭐'.repeat(st)} · 🧺${vw.bestYield[a.id]}` : 'Unsolved'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="he-ach-strip">
      ${BADGE_META.map((bm) => {
        const has = (badgesMask & bm.bit) !== 0;
        return `<span class="he-ach-pill ${has ? 'unlocked' : ''}" title="${escapeHtml(bm.tip)}">${bm.icon} ${escapeHtml(bm.name)}</span>`;
      }).join('')}
    </div>
  `;

  // Hall of Fame
  const leaders = onChainOverview?.leaders || [];
  document.getElementById('leaderboardMount').innerHTML = leaders.length
    ? leaders
        .map(
          (l, idx) => `
        <div class="he-row-item">
          <span><strong>#${idx + 1}</strong> ${escapeHtml(formatScholarName(l.identity))}</span>
          <span class="mono" style="color:#fde68a;">⭐${l.totalStars} · 🧺${l.totalYield}</span>
        </div>
      `
        )
        .join('')
    : `<div class="he-muted">Complete an 8-season expedition on Subnet 1 to claim #1!</div>`;

  // Live HFS Event Feed (Session Receipt Events + Global Completed Logs)
  const feedRows = [
    ...sessionEventFeed.slice(0, 6).map(
      (ev) => `
      <div class="he-row-item">
        <span><strong class="mono" style="color:#67e8f9;">#${ev.blk}</strong> ${escapeHtml(ev.summary)}</span>
        <span class="mono" style="color:#6ee7b7;">${escapeHtml(ev.eventName)}</span>
      </div>
    `
    ),
    ...(onChainOverview?.logs || [])
      .slice()
      .reverse()
      .map((lg) => {
        const aName = ARENAS[lg.arenaId]?.shortName || 'Arena';
        const outcome = lg.status === STATUS_VICTORY ? `${'⭐'.repeat(lg.stars)} 🧺${lg.harvest}` : `S${lg.round} Halt`;
        return `
          <div class="he-row-item">
            <span>${escapeHtml(formatScholarName(lg.identity))} · ${escapeHtml(aName)}</span>
            <span class="mono" style="color:${lg.status === STATUS_VICTORY ? '#6ee7b7' : '#fda4af'};">${outcome}</span>
          </div>
        `;
      }),
  ];
  document.getElementById('logsMount').innerHTML = feedRows.length
    ? feedRows.slice(0, 12).join('')
    : `<div class="he-muted">Confirmed RunStarted &amp; RoundResolved HFS events stream here live.</div>`;
}

function renderAllUI() {
  renderArenaSelector();
  renderTimelineAndHud();
  renderCommandDeck();
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Event Wiring & Boot
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById('btnStartOrResetRun')?.addEventListener('click', () => {
    startExpeditionOnChain(selectedArena);
  });

  document.getElementById('btnExecuteRoundAction')?.addEventListener('click', () => {
    playRoundActionOnChain();
  });

  document.addEventListener('click', (ev) => {
    const arenaBtn = ev.target.closest('[data-arena-id]');
    if (arenaBtn && !txBusy) {
      selectedArena = Number(arenaBtn.getAttribute('data-arena-id'));
      if (isRunMatchingSelectedArena() && liveRun.status === STATUS_ACTIVE) {
        autoAdvanceTabFromConfirmedRun(liveRun);
      } else {
        focusedTab = 0;
        syncDefaultPendingActionForTab();
      }
      renderAllUI();
      return;
    }

    const tabBtn = ev.target.closest('[data-focus-tab]');
    if (tabBtn && !txBusy) {
      focusedTab = Number(tabBtn.getAttribute('data-focus-tab'));
      syncDefaultPendingActionForTab();
      renderCommandDeck();
      return;
    }

    const actCard = ev.target.closest('[data-act-kind]');
    if (actCard && !txBusy) {
      pendingAction = {
        actionKind: Number(actCard.getAttribute('data-act-kind')),
        target: Number(actCard.getAttribute('data-act-target')),
        choice: Number(actCard.getAttribute('data-act-choice')),
      };
      renderCommandDeck();
    }
  });
}

async function selectSanctuaryInstance(addr) {
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  contractAddr = (addr || '').toLowerCase();
  await refreshOnChainState(true);
  if (contractAddr) {
    stopWatcher = slxWatchChainApp({
      rpcUrl,
      contractAddresses: [contractAddr],
      onRefresh: () => refreshOnChainState(false),
    });
  }
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'haltfree-ecosystem',
    title: 'Haltfree Ecosystem',
    subtitle: 'Turn-Based On-Chain Closed-Loop Permaculture & Biospherics • $0.00 Gas',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => contractAddr || '',
    getContractLabel: () => 'HaltfreeEcosystem',
    onWalletSwitch: () => refreshOnChainState(true),
    extraElements: [document.getElementById('btnHowToPlay')],
  });

  syncDefaultPendingActionForTab();
  bindEvents();

  heGuide = mountSlxGameGuide({
    gameId: 'haltfree-ecosystem',
    manualSpec: HALTFREE_MANUAL_SPEC,
    headerBtnEl: document.getElementById('btnHowToPlay'),
    welcomeMountEl: document.getElementById('heWelcomeMount'),
    coachMountEl: document.getElementById('heCoachMount'),
    onWelcomePrimaryAction: () => startExpeditionOnChain(selectedArena),
  });

  renderAllUI();
  requestAnimationFrame(renderCanvasLoop);

  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const mountedDefault =
    typeof globalThis !== 'undefined' && globalThis.__SLX_MOUNTED_APP__?.defaultHfsAddr
      ? globalThis.__SLX_MOUNTED_APP__.defaultHfsAddr
      : '';
  const fallbackAddr =
    (mountedDefault && mountedDefault !== ZERO_ADDR ? mountedDefault : '') ||
    manifest?.haltfreeEcosystem?.contractAddr ||
    '';

  if (fallbackAddr) {
    await selectSanctuaryInstance(fallbackAddr);
    unifiedHdr?.refresh?.();
  }

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'HALTFREE_ECOSYSTEM',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => contractAddr || '',
    onSelectInstance: async (inst) => {
      await selectSanctuaryInstance(inst.primaryAddr);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
