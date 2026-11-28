/**
 * HALTFREE ECOSYSTEM (`app-sources/haltfree-ecosystem/app.js` — SuperLexicon HFS #29)
 *
 * Educational Closed-Loop Permaculture, Polyculture Aquaculture & Biospheric Simulation Game:
 *  - 4 Progressive Arenas starting with the 2,400-Year-Old "Infinite Food" System
 *    (Chinese Mulberry-Dyke Carp Polyculture / Sangji Yutang, 475 BCE).
 *  - Live 60-FPS HTML5 `<canvas>` animated cross-section simulation reacting instantaneously
 *    to every plant, fish, symbiont, and microbe choice across 6 interlocking ecological niches.
 *  - On-Chain Halt-Free Subroutine (`haltfree_ecosystem.wasm`) verifies 12-season closed-loop
 *    stability, awards 1–3 Mastery Stars to the player's `Identity` HFS, and updates the
 *    Subnet 1 Eco-Scholar Hall of Fame at `$0.00` gas.
 */

import {
  hexToBytes,
  bytesToHex,
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
// Self-Contained Inline Use-Case Architecture & Field Manual (Zero SDK Redeploy!)
// ---------------------------------------------------------------------------

const HALTFREE_MANUAL_SPEC = {
  icon: '🌿',
  title: 'Haltfree Ecosystem — Closed-Loop Ecology Field Guide',
  accent: '#10b981',
  tagline:
    'Discover how ancient permaculture farmers and future space engineers build "Infinite Food" ecosystems that never run out of nutrients, never choke on waste, and never halt!',
  welcomePrimaryLabel: '🐟 Explore the 2,400-Year-Old Pond',
  quickSteps: [
    {
      num: '1',
      title: 'Pick an Arena (Start with Level 1: Mulberry-Dyke Pond)',
      body: 'Start in 475 BCE China with the famous 2,400-year-old "Infinite Food" pond—then unlock the Aztec Chinampa Canal, Solar Aquaponics Dome, and Martian Biosphere!',
    },
    {
      num: '2',
      title: 'Fill All 6 Ecological Niches & Watch the Live Animation',
      body: 'Every plant, insect, fish depth-layer, and microbe turns another creature’s waste into food! Watch the 60-FPS pond cross-section react immediately as you click.',
    },
    {
      num: '3',
      title: 'Achieve a Halt-Free 12-Season Loop & Seal Your Badge',
      body: 'When Oxygen, Clarity, and Fertility stay balanced for 12 seasons with ZERO external feed, click ♾️ Verify & Seal Loop ($0 Gas) to earn 3 Stars on your Identity HFS!',
    },
  ],
  tabs: {
    quickstart: `
      <div class="slx-gg-hero">
        <div class="slx-gg-hero-title">♾️ What Makes an Ecosystem "Halt-Free"?</div>
        <p>
          In computer science, a <strong>Halt-Free Subroutine</strong> never freezes or crashes because every resource is bounded.
          In nature, a <strong>Closed-Loop Polyculture Ecosystem</strong> never collapses ("halts") because <strong>every waste product becomes food for the next species</strong>—powered only by sunlight and rain!
        </p>
      </div>
      <div class="slx-gg-steps-grid">
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">RULE 1</span>
          <h4>🌞 Zero External Feed Debt</h4>
          <p>Dumping diesel fish pellets or chemical fertilizers breaks the closed loop and pollutes the water with toxic ammonia!</p>
        </div>
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">RULE 2</span>
          <h4>🐟 Every Water Layer Has a Job</h4>
          <p>Surface fish eat plants, mid-water filter fish clean up microscopic algae so oxygen stays high, and bottom fish stir nutrient mud!</p>
        </div>
        <div class="slx-gg-step-card">
          <span class="slx-gg-step-num">RULE 3</span>
          <h4>🔄 Close the Nutrient Circle</h4>
          <p>Returning rich bottom pond silt (or worm compost) back to the shoreline trees completes the perpetual food loop!</p>
        </div>
      </div>
    `,
    controls: `
      <div class="slx-gg-card">
        <h4>🎮 Reading the Animated Simulation &amp; 4 Vital Gauges</h4>
        <ul>
          <li><strong>🫧 Oxygen (Keep &gt; 36%):</strong> Produced by healthy plants/algae and surface aeration; crashes if overcrowding or runaway algae blooms suffocate the water at night!</li>
          <li><strong>💎 Water / Air Clarity (Keep &gt; 24%):</strong> Drops into green "pea-soup" eutrophication if plankton grow without filter-feeding animals like <em>Silver Carp</em> or <em>Bighead Carp</em>.</li>
          <li><strong>🌱 Soil &amp; Silt Fertility (Keep &gt; 26%):</strong> Drops when crops harvest nutrients without decomposers, nitrogen-fixing beans, or pond-mud recycling returning minerals to the roots.</li>
          <li><strong>🧪 Cleanliness / Toxicity (Keep Ammonia &lt; 55%):</strong> Rises from rotting bottom sludge, pesticides, or un-nitrified fish waste.</li>
        </ul>
      </div>
    `,
    reference: `
      <div class="slx-gg-card">
        <h4>📜 The Real 2,400-Year-Old "Infinite Food" System (<em>Sangji Yutang</em>)</h4>
        <ul>
          <li>Documented since Fan Li&rsquo;s 475 BCE <em>Classic of Fish Culture</em> and perfected in the Pearl River Delta&rsquo;s <strong>Mulberry-Dyke Fish Ponds</strong>, farmers combined <strong>Mulberry Trees + Silkworms + 4 Carp Species</strong> at different water depths.</li>
          <li>Mulberry leaves fed silkworms; silkworm droppings &amp; grass fed <strong>Grass Carp</strong>; Grass Carp waste grew phytoplankton for <strong>Silver Carp</strong> and zooplankton for <strong>Bighead Carp</strong>; <strong>Black/Common Carp</strong> aerated the bottom mud, which fertilized the Mulberry dyke!</li>
          <li>Modern industrial monoculture rules and chemical pesticide quotas displaced or prohibited integrated livestock-pond dykes in many regions because pesticides kill silkworms &amp; fish—making monoculture farms dependent on imported synthetic fertilizer and commercial feed!</li>
        </ul>
      </div>
    `,
    onchain: `
      <div class="slx-gg-card">
        <h4>⛓️ Deterministic 12-Season WASM Ecology Verifier (<code>haltfree_ecosystem.wasm</code>)</h4>
        <ul>
          <li><strong>11.4 KiB Halt-Free Subroutine:</strong> Simulates 12 coupled seasonal cycles on Subnet 1, diagnoses exact ecological halt modes, verifies your sovereign <code>Identity</code> HFS, and records your Eco-Scholar Stars &amp; Yield permanently at <strong>$0.00 gas</strong>.</li>
        </ul>
      </div>
    `,
  },
};

registerSlxUseCaseDocs('haltfree-ecosystem', {
  hasGameGuide: true,
  description: {
    icon: '🌿',
    title: 'Haltfree Ecosystem — Closed-Loop Ecology & Permaculture Simulator',
    href: '/haltfree-ecosystem.html',
    tagline:
      'Interactive 60-FPS animated science & permaculture simulator teaching children how 2,400-year-old Chinese polyculture ponds, Aztec chinampas, aquaponics, and Martian biodomes achieve perpetual zero-waste food loops.',
    featurePills: [
      { label: '11.4 KiB Halt-Free WASM Verifier', tone: 'emerald' },
      { label: '60-FPS Procedural Canvas Simulation', tone: 'cyan' },
      { label: '4 Historical-to-Space Arenas', tone: 'amber' },
      { label: '0x0101 Zero-Redeploy UI + Artwork', tone: 'violet' },
      { label: 'Verified Identity HFS Passport', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🌿 Biological Halt-Freedom Meets Computational Halt-Freedom</div>
          <p>
            <strong>Haltfree Ecosystem</strong> teaches systems biology through live cause-and-effect simulation rather than rote quizzes:
            just as a SuperLexicon Halt-Free Subroutine executes deterministically within bounded resources without deadlocking,
            a closed-loop polyculture ecosystem runs indefinitely on sunlight and rain without exhausting soil fertility or choking on ammonia waste.
          </p>
        </div>
      `,
      primitives: `
        <div class="slx-ucd-card">
          <h4>🔬 Coupled Trophic-Balance State Machine</h4>
          <ul>
            <li>Simulates <strong>Oxygen</strong>, <strong>Micro-Algae / Clarity</strong>, <strong>Soil/Silt Fertility</strong>, <strong>Ammonia Toxicity</strong>, and <strong>Seasonal Yield</strong> across 12 seasons across <code>4,096</code> possible niche combinations per arena.</li>
            <li>Entire animated app + 4 arena illustrations live in <code>UI_BUNDLE_STORE</code> (<code>0x0101</code>) with zero static web-server coupling.</li>
          </ul>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead><tr><th>Component</th><th>Role</th></tr></thead>
          <tbody>
            <tr><td><code>haltfree_ecosystem.wasm</code> (<code>11.4 KiB</code>)</td><td>12-season coupled trophic verifier, Identity HFS gate, and Eco-Scholar Hall of Fame.</td></tr>
            <tr><td><code>0x0101</code> UI + Media Store</td><td>Serves the 60-FPS Canvas simulator + 4 storybook cross-section illustrations directly from validator nodes.</td></tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-card">
          <h4>✅ Verifiable Learning Outcomes</h4>
          <ul>
            <li>Every 3-star badge on the Hall of Fame proves the student discovered a self-sustaining closed-loop configuration verified on Layer 1.</li>
          </ul>
        </div>
      `,
    },
  },
});

// ---------------------------------------------------------------------------
// Exact Ecological Matrix & 4 Arena Definitions (1:1 Match with Rust WASM!)
// ---------------------------------------------------------------------------

const HALT_NONE = 0;
const HALT_EUTROPHICATION = 1;
const HALT_HYPOXIA = 2;
const HALT_AMMONIA_TOXICITY = 3;
const HALT_TROPHIC_PREDATION = 4;
const HALT_NUTRIENT_STARVATION = 5;
const HALT_EXTERNAL_DEPENDENCY = 6;

const F_NONE = 0;
const F_PREDATOR = 1 << 0;
const F_EXTERNAL = 1 << 1;
const F_LETHAL = 1 << 2;

const eff = (dO2, dAlg, dFert, dTox, dYield, flags = F_NONE) => ({
  dO2,
  dAlg,
  dFert,
  dTox,
  dYield,
  flags,
});

const ECOLOGY_MATRIX = [
  // Arena 0: 2,400-Year-Old Mulberry-Dyke Carp Polyculture ([2, 1, 3, 1, 2, 3])
  [
    [eff(-2, 3, -5, 3, 0), eff(1, 0, -4, 4, 2), eff(3, 0, -4, -2, 18), eff(-3, 8, -7, 18, 8, F_LETHAL)],
    [eff(0, -1, -2, 0, 0), eff(0, 3, 3, 1, 18), eff(-2, 4, -8, 5, 0, F_PREDATOR), eff(-3, 9, 4, 9, 14, F_EXTERNAL)],
    [eff(-2, 6, -1, 1, 0), eff(-1, 6, -2, 3, 3, F_PREDATOR), eff(-9, 7, 1, 8, 6), eff(1, 5, 3, 2, 18)],
    [eff(-4, 9, 0, 2, 0), eff(4, -8, 0, -1, 16), eff(-6, -6, -4, 19, 0, F_LETHAL), eff(-4, 5, 0, 3, 4, F_PREDATOR)],
    [eff(-2, 4, -1, 3, 0), eff(-2, 5, -2, 3, 3, F_PREDATOR), eff(1, -4, 1, -1, 16), eff(-3, 3, 0, 7, 0)],
    [eff(-5, 4, -6, 10, 0), eff(-1, 2, -8, 5, 2), eff(1, -1, -10, -1, 4, F_EXTERNAL), eff(2, 0, 9, -7, 20)],
  ],
  // Arena 1: Aztec Chinampa & Axolotl Floating Canal ([1, 3, 1, 2, 3, 1])
  [
    [eff(-3, 5, -6, 4, 0), eff(3, -1, 2, -2, 14), eff(0, 1, -6, 6, 3), eff(-2, 3, -5, 4, 0, F_EXTERNAL)],
    [eff(1, 1, -8, 1, 8), eff(0, 2, -10, 3, 5), eff(-2, 6, -6, 18, 9, F_LETHAL), eff(2, 0, 4, -1, 24)],
    [eff(-2, 6, -2, 2, 0), eff(3, -4, 3, -2, 14), eff(-11, 8, 0, 5, 0), eff(-8, 2, -4, 17, 0, F_LETHAL)],
    [eff(-1, 5, -1, 2, 0), eff(-3, 6, -5, 5, 6), eff(1, -4, 1, -1, 16), eff(-2, 5, -2, 4, 2, F_PREDATOR)],
    [eff(-1, 2, -2, 3, 0), eff(-2, 3, -3, 6, 0, F_PREDATOR), eff(-4, -5, -6, 18, 0, F_LETHAL), eff(2, -2, 1, -2, 16)],
    [eff(-5, 5, -7, 9, 0), eff(2, -3, 6, -6, 22), eff(-3, 10, 4, 9, 14, F_EXTERNAL), eff(-5, 2, -6, 8, 2)],
  ],
  // Arena 2: Solar Aquaponics & Nitrification Bio-Dome ([2, 1, 3, 1, 2, 2])
  [
    [eff(1, -1, -9, -2, 0), eff(-4, 2, -5, 14, 0), eff(-2, 2, 5, 4, 20), eff(-12, 7, 6, 15, 10)],
    [eff(-6, 5, 1, 11, 2), eff(1, -2, 5, -4, 16), eff(-4, -4, -8, 20, 0, F_LETHAL), eff(0, 0, -9, -1, 0, F_EXTERNAL)],
    [eff(0, 2, -3, 10, 0), eff(-7, 4, 0, 9, 0), eff(0, -1, -4, 11, 0), eff(2, -3, 4, -9, 16)],
    [eff(-1, 7, 2, 6, 0), eff(3, -5, -2, -4, 24), eff(1, 3, -7, 3, 2), eff(-1, 6, 0, 7, 0)],
    [eff(-8, 4, -1, 3, 0), eff(4, 1, 0, 5, 8, F_EXTERNAL), eff(7, -1, 1, -1, 16), eff(-14, 6, 1, 6, 0, F_LETHAL)],
    [eff(1, 0, -8, 0, 4, F_EXTERNAL), eff(-3, 1, -9, 16, 0, F_LETHAL), eff(2, -1, 4, -2, 18), eff(-4, -2, -7, 15, 0, F_LETHAL)],
  ],
  // Arena 3: Sealed Martian Biospheric Habitat BIOS-IV ([3, 1, 2, 2, 2, 1])
  [
    [eff(-10, 0, -2, 4, 0), eff(-9, 0, -1, 3, 2), eff(-15, 2, 0, 18, 0, F_LETHAL), eff(7, -3, 2, -3, 18)],
    [eff(-4, 1, -5, 2, 0), eff(4, -1, -1, -2, 26), eff(2, 0, -8, 0, 2), eff(2, 0, -4, 0, 2)],
    [eff(-1, 3, -3, 2, 2), eff(-12, 6, 2, 11, 10), eff(2, -3, 3, -2, 18), eff(-5, 2, -6, 5, 0, F_PREDATOR)],
    [eff(-2, 1, -9, 4, 0), eff(-13, 0, -3, 15, 0, F_LETHAL), eff(-1, -1, 6, -4, 20), eff(-3, 0, -10, 0, 0, F_EXTERNAL)],
    [eff(-2, 5, -3, 6, 0), eff(-2, 2, -6, 12, 0), eff(2, -2, 2, -4, 14), eff(1, 0, 0, 0, 8, F_EXTERNAL)],
    [eff(-5, 2, -8, 22, 0, F_LETHAL), eff(1, -1, 5, -3, 16), eff(0, 1, -7, 2, 2), eff(-1, 2, -6, 4, 0)],
  ],
];

export const ARENAS = [
  {
    id: 0,
    levelLabel: 'Level 1 · Beginner ★☆☆☆',
    era: '475 BCE · PEARL RIVER DELTA, CHINA',
    shortName: 'Mulberry-Dyke Pond',
    title: '🐟 The 2,400-Year-Old “Infinite Food” Mulberry-Dyke Pond',
    thumb: '/assets/haltfree-ecosystem/arena_0.jpg',
    story:
      '<strong>Historical Discovery:</strong> Engineered over 2,400 years ago (<em>Sangji Yutang</em>), Chinese farmers linked shoreline trees, silk-spinning insects, and <strong>four distinct depth-layered carp species</strong> into a zero-feed, zero-waste food machine—later displaced where modern pesticide &amp; single-crop rules banned integrated dyke ponds! Can you rediscover the exact 6-part loop?',
    starterSlots: [2, 0, 3, 0, 0, 0], // Starts partially built (Mulberry + Grass Carp, missing filter fish & mud loop!) so kids immediately see an Algae Bloom to solve!
    slots: [
      {
        zone: '1 · Shore Dyke Bank',
        title: 'Shoreline Plant',
        question: 'Which tree stabilizes the dyke, feeds silk insects, and drinks pond-mud nutrients?',
        options: [
          { icon: '🪨', name: 'Bare Clay Bank', sub: 'Erodes mud into water' },
          { icon: '🌲', name: 'Pine Conifers', sub: 'Acidic needles, non-edible' },
          { icon: '🌳', name: 'Mulberry Trees', sub: 'Sweet leaves, berries & deep roots' },
          { icon: '🌽', name: 'Pesticide Corn', sub: 'High yield, chemical runoff' },
        ],
      },
      {
        zone: '2 · Tree Canopy Shed',
        title: 'Canopy Symbiont',
        question: 'What turns tree leaves into silk AND gentle organic plankton food?',
        options: [
          { icon: '🏚️', name: 'Empty Shed', sub: 'Leaves go unused' },
          { icon: '🐛', name: 'Silkworm Colony', sub: 'Spins silk + drops rich frass' },
          { icon: '🦗', name: 'Swarming Locusts', sub: 'Strips canopy bare' },
          { icon: '⛽', name: 'Diesel Pellet Feeder', sub: 'Imported commercial feed' },
        ],
      },
      {
        zone: '3 · Surface (0–0.5m)',
        title: 'Top-Water Swimmer',
        question: 'Who munches dyke grass & duckweed so their droppings fertilize plankton?',
        options: [
          { icon: '💧', name: 'Empty Surface', sub: 'Duckweed blocks sunlight' },
          { icon: '🐍', name: 'Snakehead Predator', sub: 'Hunts smaller pond fish' },
          { icon: '🎏', name: 'Overcrowded Koi', sub: 'Uses heavy surface oxygen' },
          { icon: '🐟', name: 'Grass Carp + Duckweed', sub: 'Herbivore surface grazer' },
        ],
      },
      {
        zone: '4 · Upper-Mid (0.5–1.5m)',
        title: 'Green-Algae Filter',
        question: 'Who uses ultra-fine gill rakers to filter microscopic green phytoplankton?',
        options: [
          { icon: '🟢', name: 'No Filter Fish', sub: 'Algae grows unchecked' },
          { icon: '🥈', name: 'Silver Carp', sub: 'Living phytoplankton sieve' },
          { icon: '🧪', name: 'Copper Algicide Drip', sub: 'Poisons algae chemically' },
          { icon: '🎣', name: 'Carnivorous Trout', sub: 'Needs cold rushing rivers' },
        ],
      },
      {
        zone: '5 · Lower-Mid (1.5–2.5m)',
        title: 'Zooplankton Filter',
        question: 'Who cruises mid-deep water filtering tiny golden zooplankton & flocs?',
        options: [
          { icon: '🟡', name: 'Empty Mid-Deep', sub: 'Zooplankton wasted' },
          { icon: '🦈', name: 'Northern Pike', sub: 'Ambush fish predator' },
          { icon: '🥇', name: 'Bighead Carp', sub: 'Gentle zooplankton filterer' },
          { icon: '🦐', name: 'Saltwater Krill', sub: 'Cannot survive freshwater' },
        ],
      },
      {
        zone: '6 · Pond Floor & Loop',
        title: 'Benthic & Mud Cycle',
        question: 'How do we clean bottom snails/sludge AND feed the shoreline trees forever?',
        options: [
          { icon: '💩', name: 'Leave Bottom Sludge', sub: 'Rots into toxic ammonia' },
          { icon: '🧱', name: 'Concrete Pond Liner', sub: 'Blocks natural silt cycle' },
          { icon: '🌊', name: 'Flush to River', sub: 'Wastes all pond nutrients' },
          { icon: '♻️', name: 'Black/Common Carp + Silt-to-Dyke', sub: 'Cleans floor & fertilizes trees!' },
        ],
      },
    ],
  },
  {
    id: 1,
    levelLabel: 'Level 2 · Intermediate ★★☆☆',
    era: '1150 CE · LAKE XOCHIMILCO, MEXICO',
    shortName: 'Aztec Chinampa',
    title: '🦎 Floating Chinampa Island & Axolotl Canal',
    thumb: '/assets/haltfree-ecosystem/arena_1.jpg',
    story:
      '<strong>Wetland Agro-Ecology:</strong> Aztec engineers wove floating reed gardens (<em>Chinampas</em>) yielding <strong>7 harvests a year</strong>! Can you combine living willow root-walls, nitrogen-fixing companion crops, and crystal-clean habitat for the endangered <strong>Axolotl</strong>?',
    starterSlots: [0, 0, 0, 0, 3, 0],
    slots: [
      {
        zone: '1 · Island Perimeter',
        title: 'Living Root Wall',
        question: 'What anchors the floating soil bed without poisoning the canal?',
        options: [
          { icon: '🌊', name: 'Unanchored Mud', sub: 'Washes into canal' },
          { icon: '🌿', name: 'Ahuejote Willow Trees', sub: 'Deep aquatic root basket' },
          { icon: '🍂', name: 'Eucalyptus Trees', sub: 'Inhibits nearby crops' },
          { icon: '🔩', name: 'Corroding Sheet Metal', sub: 'External rust & barrier' },
        ],
      },
      {
        zone: '2 · Island Crop Bed',
        title: 'Companion Crops',
        question: 'Which crop guild fixes its own nitrogen from the air and shades the soil?',
        options: [
          { icon: '🌾', name: 'Single-Crop Wheat', sub: 'Depletes soil nitrogen' },
          { icon: '☁️', name: 'Monocrop Cotton', sub: 'Heavy nutrient drain' },
          { icon: '🍅', name: 'Sprayed Tomatoes', sub: 'Pesticide harms amphibians' },
          { icon: '🌽', name: 'Three Sisters (Corn+Beans+Squash)', sub: 'Beans fix N2, squash mulches!' },
        ],
      },
      {
        zone: '3 · Canal Surface',
        title: 'Aquatic Plant Mat',
        question: 'Which gentle water fern fixes nitrogen & shelters baby fish without choking O2?',
        options: [
          { icon: '💧', name: 'Bare Canal Water', sub: 'Sun bakes algae blooms' },
          { icon: '🍀', name: 'Azolla Fern & Duckweed', sub: 'Oxygenates & fixes nitrogen' },
          { icon: '🌺', name: 'Invasive Water Hyacinth', sub: 'Blankets & suffocates canal' },
          { icon: '🛢️', name: 'Mosquito Oil Film', sub: 'Blocks surface oxygen!' },
        ],
      },
      {
        zone: '4 · Canal Mid-Water',
        title: 'Native Canal Grazer',
        question: 'Which native species grazes algae gently without tearing up Chinampa roots?',
        options: [
          { icon: '🫧', name: 'Empty Canal', sub: 'Detritus builds up' },
          { icon: '🐟', name: 'Invasive Bottom Carp', sub: 'Tears up willow & reed roots!' },
          { icon: '🦞', name: 'Native Acocil Crayfish & Charales', sub: 'Gentle native clean-up crew' },
          { icon: '🦷', name: 'Piranha Pack', sub: 'Hunts canal wildlife' },
        ],
      },
      {
        zone: '5 · Bio-Indicator',
        title: 'Amphibian Guardian',
        question: 'Which beloved Xochimilco guardian eats insect pests in crystal-clean water?',
        options: [
          { icon: '🚫', name: 'No Amphibians', sub: 'Crop pests multiply' },
          { icon: '🐸', name: 'Invasive Cane Toads', sub: 'Toxic to local wildlife' },
          { icon: '🧼', name: 'Chlorine Dosing Pump', sub: 'Sterilizes living canal' },
          { icon: '🦎', name: 'Axolotl & Tree Frogs', sub: 'Thrives in pure bio-filtered water!' },
        ],
      },
      {
        zone: '6 · Fertility Return',
        title: 'Canal-to-Soil Loop',
        question: 'How did Chinampa farmers replenish topsoil before every planting?',
        options: [
          { icon: '⏳', name: 'Let Canal Muck Sink', sub: 'Island soil starves' },
          { icon: '🚣', name: 'Scoop Canal Muck + Tule Reeds', sub: 'Bio-filters water & feeds crops!' },
          { icon: '🧪', name: 'Synthetic NPK Fertilizer', sub: 'Algae runoff kills Axolotls!' },
          { icon: '🔥', name: 'Burn Crop Stalks', sub: 'Loses nitrogen into smoke' },
        ],
      },
    ],
  },
  {
    id: 2,
    levelLabel: 'Level 3 · Advanced ★★★☆',
    era: 'MODERN · URBAN CLOSED-LOOP DOME',
    shortName: 'Solar Aquaponics',
    title: '🔬 Solar Aquaponics & Microbial Nitrification Bio-Dome',
    thumb: '/assets/haltfree-ecosystem/arena_2.jpg',
    story:
      '<strong>Microbial Chemistry Challenge:</strong> Fish breathe out ammonia (<code>NH3</code>), which is toxic! You must engineer the invisible <strong>3-step microbial bridge</strong> that converts fish waste into sweet strawberries &amp; crisp greens using 90% less water than soil farms!',
    starterSlots: [2, 0, 0, 1, 0, 2],
    slots: [
      {
        zone: '1 · Recirculating Tank',
        title: 'Aquaculture Stocking',
        question: 'Choose a freshwater fish & density that generates steady, manageable nutrients:',
        options: [
          { icon: '🪣', name: 'Empty Water Tank', sub: 'Zero nutrients for plants!' },
          { icon: '🐟', name: 'Ocean Bluefin Tuna', sub: 'Wrong salinity & huge O2 need' },
          { icon: '🐠', name: 'Balanced Nile Tilapia School', sub: 'Hardy freshwater nutrient source' },
          { icon: '🐡', name: '5x Overcrowded Catfish Jam', sub: 'Massive O2 crash & NH3 spike!' },
        ],
      },
      {
        zone: '2 · Solids Separator',
        title: 'Mineralization Bed',
        question: 'What breaks down solid fish waste before it clogs & rots plant roots?',
        options: [
          { icon: '💩', name: 'Pump Raw Sludge to Roots', sub: 'Coats roots & causes root rot!' },
          { icon: '🪱', name: 'Swirl Clarifier + Red Worms', sub: 'Turns solids into trace minerals!' },
          { icon: '🧴', name: 'Chlorine Bleach Filter', sub: 'Kills beneficial bacteria & fish!' },
          { icon: '🚽', name: 'Flush Solids to Sewer', sub: 'Loses minerals & water' },
        ],
      },
      {
        zone: '3 · Bio-Reactor Media',
        title: 'Nitrifying Microbes',
        question: 'Who converts toxic Ammonia (NH3) -> Nitrite (NO2-) -> Plant-Food Nitrate (NO3-)?',
        options: [
          { icon: '🔮', name: 'Sterile Smooth Marbles', sub: 'Too little surface for microbes' },
          { icon: '🦠', name: 'Stagnant Swamp Mud', sub: 'Zero-oxygen sour gas' },
          { icon: '🟣', name: 'UV Sterilizer on Media', sub: 'Zaps nitrifying bacteria!' },
          { icon: '🧬', name: 'Clay Pebbles + Nitrosomonas/Nitrobacter', sub: 'Converts toxic NH3 into safe NO3-!' },
        ],
      },
      {
        zone: '4 · Hydroponic Channels',
        title: 'Nutrient-Uptake Crops',
        question: 'Which plants drink up Nitrate (NO3-) so purified water returns safely to fish?',
        options: [
          { icon: '🛶', name: 'Empty Foam Rafts', sub: 'Nitrates & algae accumulate' },
          { icon: '🍓', name: 'Basil, Lettuce & Strawberries', sub: 'Fast nitrate uptake + high harvest!' },
          { icon: '🌳', name: 'Slow Oak Saplings', sub: 'Roots crack rafts, slow uptake' },
          { icon: '🪴', name: 'Plastic Decor Plants', sub: 'Zero biological filtration!' },
        ],
      },
      {
        zone: '5 · Dissolved O2 & Fruit',
        title: 'Aeration & Pollination',
        question: 'Fish roots AND nitrifying bacteria all breathe O2—plus strawberry flowers need help!',
        options: [
          { icon: '😴', name: 'Still Un-Aerated Water', sub: 'Fish & bacteria suffocate!' },
          { icon: '⛽', name: 'Diesel Air Compressor', sub: 'Fumes & external fuel' },
          { icon: '☀️', name: 'Solar Venturi + Bumblebees', sub: 'Clean O2 bubbles + berry pollination!' },
          { icon: '🫧', name: 'Pure CO2 Tank Bubbler', sub: 'Carbonic acid suffocates fish!' },
        ],
      },
      {
        zone: '6 · Sump & pH Loop',
        title: 'Water & Mineral Buffer',
        question: 'Nitrification slowly makes water acidic—how do we close the water & mineral loop?',
        options: [
          { icon: '🚰', name: 'One-Way City Tap Drain', sub: 'Not closed-loop!' },
          { icon: '🧂', name: 'Dump Table Salt (NaCl)', sub: 'Wilts strawberries & greens!' },
          { icon: '🐚', name: 'Recirc Sump + Eggshell/Kelp Buffer', sub: 'Balances pH, Ca & K naturally!' },
          { icon: '🧪', name: 'Sulfuric Acid Wash', sub: 'Crashes pH!' },
        ],
      },
    ],
  },
  {
    id: 3,
    levelLabel: 'Level 4 · Master ★★★★',
    era: '2084 CE · JEZERO CRATER, MARS',
    shortName: 'Mars Biodome',
    title: '🚀 Sealed Martian Biospheric Habitat (“BIOS-IV”)',
    thumb: '/assets/haltfree-ecosystem/arena_3.jpg',
    story:
      '<strong>Ultimate Space-Science Challenge:</strong> Inspired by real <em>Biosphere 2</em> &amp; ESA MELiSSA research! Inside a sealed dome on Mars, <strong>nothing comes in and nothing goes out</strong>. Balance crew <code>O2 / CO2</code>, toxic Martian dust washing, and 100% waste recycling!',
    starterSlots: [0, 1, 0, 0, 2, 0],
    slots: [
      {
        zone: '1 · Atmospheric O2 Core',
        title: 'Primary O2 Generator',
        question: 'What scrubs crew CO2 fastest while avoiding Biosphere 2’s concrete O2 trap?',
        options: [
          { icon: '😮‍💨', name: 'No O2 Bioreactor', sub: 'Crew CO2 rises rapidly!' },
          { icon: '🧱', name: 'Uncured Bare Concrete', sub: 'Absorbs O2 into CaCO3 (Biosphere 2 bug!)' },
          { icon: '🔥', name: 'Coal Heater', sub: 'Burns O2 & poisons air!' },
          { icon: '🧪', name: 'Spirulina Algae Columns', sub: 'Ultra-fast O2 + edible protein!' },
        ],
      },
      {
        zone: '2 · Agricultural Terraces',
        title: 'Calorie & Starch Guild',
        question: 'Which compact crops feed astronauts best per square meter of sunlight?',
        options: [
          { icon: '🪨', name: 'Empty Terraces', sub: 'Starvation!' },
          { icon: '🍠', name: 'Sweet Potato, Dwarf Wheat & Soy', sub: 'Complete calories + edible leaves!' },
          { icon: '🌲', name: 'Giant Sequoia Trees', sub: 'Takes 80 years & hits glass roof' },
          { icon: '⛳', name: ' ornamental Golf Turf', sub: 'Humans cannot digest grass!' },
        ],
      },
      {
        zone: '3 · Pollination & Micro-Pond',
        title: 'Protein & Flower Guild',
        question: 'How do we pollinate soy/crops AND grow fast aquatic protein without methane spikes?',
        options: [
          { icon: '🚫', name: 'No Pollinators', sub: 'Poor fruiting yield' },
          { icon: '🐄', name: 'Indoor Cattle Herd', sub: 'Consumes 10x O2 & spikes methane!' },
          { icon: '🐝', name: 'Docile Mason Bees + Duckweed Pond', sub: 'Pollinates + doubles protein every 48h!' },
          { icon: '🐜', name: 'Wood-Eating Termites', sub: 'Methane + eats habitat seals' },
        ],
      },
      {
        zone: '4 · Bioregenerative Waste',
        title: 'Inedible Stalk Decomposer',
        question: 'Half of wheat/potato plants are stems & husks—how do we unlock their carbon & nutrients?',
        options: [
          { icon: '🗑️', name: 'Seal Stems in Plastic Bags', sub: 'Locks carbon out of the loop!' },
          { icon: '🔥', name: 'Burn Stems Indoors', sub: 'Consumes O2 & fills dome with smoke!' },
          { icon: '🍄', name: 'Oyster Mushrooms + Soldier Fly Larvae', sub: 'Turns tough stalks into food & compost!' },
          { icon: '🚀', name: 'Jettison Out Airlock', sub: 'Permanent nutrient & water loss!' },
        ],
      },
      {
        zone: '5 · Hydrological Loop',
        title: 'Water Purification',
        question: 'How do we recycle 100% of crew greywater and plant humidity into pure drinking water?',
        options: [
          { icon: '💨', name: 'Uncollected Humidity', sub: 'Dome fogs & roots dry out' },
          { icon: '🛢️', name: 'Brine Sump Pit', sub: 'Salts build up in water' },
          { icon: '💧', name: 'Dome Leaf Condenser + Reed Root-Bed', sub: 'Distills pure transpired water!' },
          { icon: '🛰️', name: 'Earth Resupply Ice Rockets', sub: 'Breaks closed-loop independence!' },
        ],
      },
      {
        zone: '6 · Martian Regolith Prep',
        title: 'Soil Detox & Humus',
        question: 'Raw Mars dirt contains toxic perchlorate salts (ClO4-)—how do we make living soil?',
        options: [
          { icon: '☄️', name: 'Raw Unwashed Mars Dust', sub: 'Toxic perchlorates poison crops!' },
          { icon: '🌱', name: 'Washed Regolith + Biochar & Worm Humus', sub: 'Clean mineral soil with microbe sponge!' },
          { icon: '🏖️', name: 'Sterile Quartz Sand', sub: 'Holds zero nutrients or water' },
          { icon: '🛡️', name: 'Epoxy Floor Only', sub: 'No root microbiome buffer' },
        ],
      },
    ],
  },
];

const HALT_DIAGNOSES = {
  [HALT_NONE]: {
    badge: '♾️ HALT-FREE INFINITE LOOP!',
    tone: 'win',
    explain:
      'Bravo, Eco-Engineer! Every waste stream feeds another organism—your ecosystem ran all <strong>12 seasons</strong> with sparkling clarity, rich fertility, abundant oxygen, and <strong>zero external feed</strong>! Click <strong>♾️ Verify &amp; Seal Loop</strong> to mint your Stars on Subnet 1!',
  },
  [HALT_EUTROPHICATION]: {
    badge: '🟢 HALTED: ALGAE BLOOM (Eutrophication)',
    tone: 'warn',
    explain:
      '<strong>Science Clue:</strong> Microscopic green algae multiplied faster than anything could eat them, turning the water into pea-soup and crashing nighttime oxygen! <em>Tip:</em> Add a filter-feeding species (or nutrient-absorbing plants) to polish the water column.',
  },
  [HALT_HYPOXIA]: {
    badge: '🫧 HALTED: LOW OXYGEN (Hypoxia)',
    tone: 'warn',
    explain:
      '<strong>Science Clue:</strong> Oxygen dropped below 36%! Either the tank/pond is overcrowded, surface weeds are blocking gas exchange, or you need photosynthetic oxygen producers / solar aeration.',
  },
  [HALT_AMMONIA_TOXICITY]: {
    badge: '🧪 HALTED: TOXIC BUILDUP (Ammonia / Chemicals)',
    tone: 'warn',
    explain:
      '<strong>Science Clue:</strong> Toxic waste or harsh chemicals (pesticides, raw un-cycled sludge, bleach, or unwashed Martian perchlorates) poisoned the food web! Use living bio-filters, worms, nitrifying microbes, or benthic silt recycling instead.',
  },
  [HALT_TROPHIC_PREDATION]: {
    badge: '🦈 HALTED: FOOD-WEB COLLAPSE (Predator / Pest)',
    tone: 'warn',
    explain:
      '<strong>Science Clue:</strong> A top predator or destructive pest (like Snakehead, Pike, Locusts, or Termites) wiped out the peaceful herbivores &amp; filter-feeders keeping your loop balanced!',
  },
  [HALT_NUTRIENT_STARVATION]: {
    badge: '🍂 HALTED: NUTRIENT LOOP BROKEN (Starvation)',
    tone: 'warn',
    explain:
      '<strong>Science Clue:</strong> Nutrients leaked out or stayed trapped at the bottom instead of cycling back to plant roots! Make sure decomposers or pond-silt dredging return minerals to your crops.',
  },
  [HALT_EXTERNAL_DEPENDENCY]: {
    badge: '⛽ NOT CLOSED-LOOP: EXTERNAL SUPPLY DEBT',
    tone: 'warn',
    explain:
      '<strong>Science Clue:</strong> Your system survived, automatic halt avoided—<em>but</em> it relied on imported diesel feed, chemical NPK, one-way tap drains, or resupply rockets! Replace external inputs with biological symbionts to achieve true Infinite Food!',
  },
};

// ---------------------------------------------------------------------------
// Local 12-Season Simulator (Exact 1:1 Mirror of `haltfree_ecosystem.wasm`)
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function simulateLocal12Seasons(arenaId, slots) {
  let oxygen = 74;
  let algae = 24;
  let fertility = 68;
  let toxicity = 12;
  let totalYield = 0;

  let sumO2 = -4;
  let sumAlg = 4;
  let sumFert = -6;
  let sumTox = 5;
  let baseYield = 0;
  let allFlags = 0;

  for (let s = 0; s < 6; s++) {
    const opt = clamp(slots[s] || 0, 0, 3);
    const ef = ECOLOGY_MATRIX[arenaId][s][opt];
    sumO2 += ef.dO2;
    sumAlg += ef.dAlg;
    sumFert += ef.dFert;
    sumTox += ef.dTox;
    baseYield += ef.dYield;
    allFlags |= ef.flags;
  }

  if (arenaId === 0 && slots[1] === 1 && slots[0] !== 2) {
    sumFert -= 5;
    baseYield = Math.max(0, baseYield - 16);
  }

  const timeline = [
    { season: 0, oxygen, clarity: 100 - algae, fertility, toxicity, totalYield: 0, haltReason: HALT_NONE },
  ];

  let season = 0;
  let haltReason = HALT_NONE;

  while (season < 12) {
    season += 1;
    oxygen = clamp(oxygen + sumO2, 0, 100);
    algae = clamp(algae + sumAlg, 5, 100);
    fertility = clamp(fertility + sumFert, 0, 100);
    toxicity = clamp(toxicity + sumTox, 0, 100);

    if (algae > 62) {
      oxygen = clamp(oxygen - Math.trunc((algae - 58) / 2), 0, 100);
    }
    if ((allFlags & F_PREDATOR) !== 0 && season >= 3) {
      fertility = clamp(fertility - 5, 0, 100);
      toxicity = clamp(toxicity + 5, 0, 100);
    }

    if ((allFlags & F_LETHAL) !== 0 && toxicity >= 45) {
      haltReason = HALT_AMMONIA_TOXICITY;
    } else if (toxicity >= 55) {
      haltReason = HALT_AMMONIA_TOXICITY;
    } else if ((allFlags & F_PREDATOR) !== 0 && season >= 5) {
      haltReason = HALT_TROPHIC_PREDATION;
    } else if (algae >= 76) {
      haltReason = HALT_EUTROPHICATION;
    } else if (oxygen <= 36) {
      haltReason = HALT_HYPOXIA;
    } else if (fertility <= 26) {
      haltReason = HALT_NUTRIENT_STARVATION;
    }

    if (haltReason !== HALT_NONE) {
      timeline.push({
        season,
        oxygen,
        clarity: 100 - algae,
        fertility,
        toxicity,
        totalYield,
        haltReason,
      });
      break;
    }

    const clarityNow = Math.max(0, 100 - algae);
    const healthMult = clamp(Math.trunc((oxygen + clarityNow + fertility) / 3), 40, 110);
    const harvest = Math.trunc((baseYield * healthMult) / 100);
    totalYield += harvest;
    timeline.push({
      season,
      oxygen,
      clarity: clarityNow,
      fertility,
      toxicity,
      totalYield,
      haltReason: HALT_NONE,
    });
  }

  if (haltReason === HALT_NONE && (allFlags & F_EXTERNAL) !== 0) {
    haltReason = HALT_EXTERNAL_DEPENDENCY;
  }
  if (haltReason === HALT_NONE && totalYield < 700) {
    haltReason = HALT_NUTRIENT_STARVATION;
  }

  const finalClarity = clamp(100 - algae, 0, 100);
  const isHaltFree = haltReason === HALT_NONE && season === 12;
  const stars = !isHaltFree
    ? 0
    : totalYield >= 1080 && oxygen >= 82 && finalClarity >= 72 && toxicity <= 15
    ? 3
    : totalYield >= 880
    ? 2
    : 1;

  return {
    isHaltFree,
    haltReason,
    seasonsSurvived: season,
    stars,
    oxygen,
    clarity: finalClarity,
    fertility,
    toxicity,
    totalYield,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Live Runtime State & On-Chain Sync
// ---------------------------------------------------------------------------

const rpcUrl = getDefaultNodeWsUrl();
const wallet = new SlxWalletManager();
const slxClient = new SlxClient(rpcUrl);

let contractAddr = '';
let currentArena = 0;
let arenaChoices = ARENAS.map((a) => [...a.starterSlots]);
let onChainOverview = null;
let txBusy = false;
let stopWatcher = null;
let heGuide = null;
const nickCache = new Map();

// 12-Season Animated Playback Scrubber State
let playbackActive = false;
let playbackStartMs = 0;
let playbackStepIdx = -1;

function showToast(msg) {
  const el = document.getElementById('heToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('is-visible'), 3600);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeOverviewHex(hexStr) {
  const b = hexToBytes(hexStr);
  if (!b || b.length < 82 || b[0] !== 1) return null;
  const leaderCnt = b[1];
  const logCnt = b[2];
  const blockNumber = Number(readU64BE(b, 4));

  const pb = b.subarray(12, 82);
  const viewer = {
    identity: bytesToHex(pb.subarray(0, 20)).toLowerCase(),
    solvedMask: pb[20],
    lastArena: pb[21],
    lastHaltReason: pb[22],
    lastSeasons: pb[23],
    attempts: readU16BE(pb, 24),
    bestStars: [pb[26], pb[27], pb[28], pb[29]],
    bestYield: [
      readU16BE(pb, 30),
      readU16BE(pb, 32),
      readU16BE(pb, 34),
      readU16BE(pb, 36),
    ],
  };

  let pos = 82;
  const leaders = [];
  for (let i = 0; i < leaderCnt && pos + 28 <= b.length; i++) {
    leaders.push({
      identity: bytesToHex(b.subarray(pos, pos + 20)).toLowerCase(),
      solvedMask: b[pos + 20],
      totalStars: b[pos + 21],
      totalYield: readU32BE(b, pos + 22),
      attempts: readU16BE(b, pos + 26),
    });
    pos += 28;
  }

  const logs = [];
  for (let i = 0; i < logCnt && pos + 28 <= b.length; i++) {
    logs.push({
      identity: bytesToHex(b.subarray(pos, pos + 20)).toLowerCase(),
      arenaId: b[pos + 20],
      haltReason: b[pos + 21],
      stars: b[pos + 22],
      seasons: b[pos + 23],
      yieldAmt: readU16BE(b, pos + 24),
    });
    pos += 28;
  }

  return { blockNumber, viewer, leaders, logs };
}

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

async function refreshOnChainState() {
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
      onChainOverview = decodeOverviewHex(hex);
      if (onChainOverview) {
        const addrs = [
          ...onChainOverview.leaders.map((x) => x.identity),
          ...onChainOverview.logs.map((x) => x.identity),
        ];
        hydrateScholarNicks(addrs);
      }
    }
  } catch (_) {}
  renderAllUI();
}

async function sealEcosystemOnChain() {
  if (txBusy) return;
  if (!contractAddr) {
    showToast('⚠ Sanctuary HFS contract not configured yet.');
    return;
  }

  // Trigger animated 12-season time-lapse while sealing!
  start12SeasonPlayback();

  let idRec;
  try {
    idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl,
      appName: 'Haltfree Ecosystem',
    });
  } catch (err) {
    showToast(`⚠ Identity HFS required: ${err?.message || err}`);
    return;
  }
  if (!idRec?.identityAddr || idRec.identityAddr === ZERO_ADDR) {
    showToast('⚠ Deploy your Identity HFS first to earn Eco-Scholar Stars!');
    return;
  }

  txBusy = true;
  renderAllUI();
  try {
    const slotBytes = new Uint8Array(arenaChoices[currentArena]);
    const uniqTargets = Array.from(
      new Set([contractAddr, idRec.identityAddr].map((x) => x.toLowerCase()))
    );
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: encodeAbi('submitEcosystem(uint64,address,bytes)', [
        ['uint64', BigInt(currentArena)],
        ['address', idRec.identityAddr],
        ['bytes', slotBytes],
      ]),
      gasLimit: 4_500_000n,
      extraTargets: uniqTargets,
      label: `submitEcosystem(Arena #${currentArena + 1})`,
    });
    await refreshOnChainState();
    const sim = simulateLocal12Seasons(currentArena, arenaChoices[currentArena]);
    if (sim.isHaltFree) {
      showToast(`🎉 ♾️ HALT-FREE INFINITE LOOP VERIFIED! Earned ${'⭐'.repeat(sim.stars)} (${sim.totalYield} Harvest)!`);
    } else {
      showToast(`🔬 Experiment logged on Subnet 1 — check the Diagnostic Clue to close the loop!`);
    }
  } catch (err) {
    showToast(`⚠ ${err?.message || err}`);
  } finally {
    txBusy = false;
    renderAllUI();
  }
}

// ---------------------------------------------------------------------------
// 60-FPS Procedural HTML5 `<canvas>` Living Ecosystem Simulation Engine
// ---------------------------------------------------------------------------

const swimmers = [];
const particles = [];
for (let i = 0; i < 28; i++) {
  swimmers.push({
    id: i,
    x: 280 + ((i * 73) % 640),
    y: 180 + ((i * 47) % 270),
    vx: (i % 2 === 0 ? 1 : -1) * (24 + (i % 5) * 7),
    phase: i * 1.1,
    band: i % 4,
  });
}
for (let i = 0; i < 55; i++) {
  particles.push({
    x: (i * 97) % 960,
    y: (i * 53) % 500,
    s: 1.5 + (i % 4),
    t: (i * 0.17) % 1,
    kind: i % 4,
  });
}

function start12SeasonPlayback() {
  playbackActive = true;
  playbackStartMs = performance.now();
  playbackStepIdx = 0;
}

function getDisplayedSimSnapshot(nowMs) {
  const full = simulateLocal12Seasons(currentArena, arenaChoices[currentArena]);
  if (!playbackActive) {
    return { full, cur: full.timeline[full.timeline.length - 1], stepSeason: full.seasonsSurvived };
  }
  const elapsed = Math.max(0, nowMs - playbackStartMs);
  const idx = Math.max(0, Math.min(full.timeline.length - 1, Math.floor(elapsed / 320)));
  if (idx >= full.timeline.length - 1 && elapsed > (full.timeline.length + 1) * 320) {
    playbackActive = false;
  }
  if (idx !== playbackStepIdx) {
    playbackStepIdx = idx;
    renderVitalsAndDiagnosis(full, full.timeline[idx]);
  }
  return { full, cur: full.timeline[idx], stepSeason: full.timeline[idx].season };
}

function drawFish(ctx, x, y, dir, scale, bodyColor, finColor, t, gasping = false, isAxolotl = false) {
  ctx.save();
  ctx.translate(x, y);
  if (dir < 0) ctx.scale(-1, 1);
  if (gasping) ctx.rotate(-0.38);
  ctx.scale(scale, scale);

  const wag = Math.sin(t * 7.5) * 4.5;

  // Tail fin
  ctx.fillStyle = finColor;
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(-25, -8 + wag);
  ctx.lineTo(-22, 0 + wag * 0.4);
  ctx.lineTo(-25, 8 + wag);
  ctx.closePath();
  ctx.fill();

  // Dorsal & Pectoral fins
  ctx.beginPath();
  ctx.moveTo(-4, -7);
  ctx.quadraticCurveTo(2, -14, 7, -6);
  ctx.fill();

  // Body ellipse
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Axolotl feathery external gills!
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

  // Eye
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
  ctx.quadraticCurveTo(x + sway * 0.4, y - 38, x + sway, y - 72);
  ctx.stroke();

  const blobs = [
    [x - 24 + sway, y - 76, 24],
    [x + 22 + sway, y - 74, 23],
    [x + sway, y - 94, 28],
    [x - 8 + sway, y - 64, 22],
  ];
  ctx.fillStyle = canopyColor;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hasBerries) {
    ctx.fillStyle = '#a855f7';
    for (const [dx, dy] of [[-18, -74], [12, -84], [-4, -98], [20, -68]]) {
      ctx.beginPath();
      ctx.arc(x + dx + sway, y + dy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (hasCocoons) {
    ctx.fillStyle = '#fefce8';
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1;
    for (const [dx, dy] of [[-12, -66], [8, -72], [-2, -86], [16, -80]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx + sway, y + dy, 4.5, 3, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawWaterColor(clarity, toxicity) {
  // High clarity -> sparkling turquoise-cyan; low clarity -> murky pea-soup green; high toxicity -> brown-red!
  const algaeFactor = clamp((75 - clarity) / 55, 0, 1);
  const toxFactor = clamp((toxicity - 25) / 45, 0, 1);
  const r = Math.round(12 + algaeFactor * 38 + toxFactor * 95);
  const g = Math.round(118 + algaeFactor * 52 - toxFactor * 45);
  const b = Math.round(148 - algaeFactor * 95 - toxFactor * 70);
  return { top: `rgba(${r}, ${g}, ${b}, 0.84)`, deep: `rgba(${Math.max(4, r - 8)}, ${Math.max(24, g - 58)}, ${Math.max(18, b - 62)}, 0.96)` };
}

let lastFrameMs = performance.now();

function renderCanvasLoop(nowMs) {
  const canvas = document.getElementById('ecoCanvas');
  if (!canvas) {
    requestAnimationFrame(renderCanvasLoop);
    return;
  }
  const dt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  const t = nowMs / 1000;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const { full, cur, stepSeason } = getDisplayedSimSnapshot(nowMs);
  const slots = arenaChoices[currentArena];
  const wc = drawWaterColor(cur.clarity, cur.toxicity);

  // Update Season Clock Pill & Status Overlay
  const clk = document.getElementById('lblSeasonClock');
  if (clk) {
    clk.textContent = playbackActive
      ? `🎬 Simulating Season ${stepSeason} / 12…`
      : `🌱 12-Season Equilibrium (${full.isHaltFree ? '♾️ Halt-Free!' : `Halts S${full.seasonsSurvived}`})`;
  }
  const banner = document.getElementById('canvasStatusBanner');
  if (banner) {
    if (full.isHaltFree) {
      banner.className = 'he-canvas-banner is-infinite';
      banner.textContent = `♾️ INFINITE FOOD LOOP ACTIVE · ${'⭐'.repeat(full.stars)} (${full.totalYield} Harvest)`;
    } else {
      banner.className = 'he-canvas-banner is-halted';
      banner.textContent = HALT_DIAGNOSES[full.haltReason]?.badge || '⚠ Ecosystem Halted';
    }
  }

  // 1. Sky Backdrop by Arena
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  if (currentArena === 3) {
    skyGrad.addColorStop(0, '#7c2d12');
    skyGrad.addColorStop(1, '#fdba74');
  } else if (currentArena === 2) {
    skyGrad.addColorStop(0, '#0c4a6e');
    skyGrad.addColorStop(1, '#bae6fd');
  } else {
    skyGrad.addColorStop(0, '#0ea5e9');
    skyGrad.addColorStop(1, '#fef3c7');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Glowing Sun
  const sunX = currentArena === 3 ? 810 : 720;
  const sunGrad = ctx.createRadialGradient(sunX, 62, 6, sunX, 62, 68);
  sunGrad.addColorStop(0, '#fef08a');
  sunGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(sunX, 62, 68, 0, Math.PI * 2);
  ctx.fill();

  // =========================================================================
  // ARENA-SPECIFIC CROSS-SECTION GEOMETRY & ORGANISMS
  // =========================================================================
  if (currentArena === 0) {
    // Distant Pearl River Misty Hills
    ctx.fillStyle = 'rgba(21, 128, 61, 0.28)';
    ctx.beginPath();
    ctx.moveTo(220, 165);
    ctx.quadraticCurveTo(450, 95, 660, 155);
    ctx.quadraticCurveTo(820, 105, 960, 148);
    ctx.lineTo(960, 180);
    ctx.lineTo(220, 180);
    ctx.fill();

    // Pond Water Column (`x: 240..960, y: 140..380`)
    const wGrad = ctx.createLinearGradient(0, 140, 0, 385);
    wGrad.addColorStop(0, wc.top);
    wGrad.addColorStop(1, wc.deep);
    ctx.fillStyle = wGrad;
    ctx.beginPath();
    ctx.moveTo(235, 142);
    for (let wx = 235; wx <= W; wx += 24) {
      ctx.lineTo(wx, 141 + Math.sin(wx * 0.03 + t * 2.6) * 3.0);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(235, H);
    ctx.closePath();
    ctx.fill();

    // Volumetric Sunbeams in Clear Water
    if (cur.clarity > 45) {
      ctx.save();
      ctx.globalAlpha = ((cur.clarity - 40) / 60) * 0.16;
      ctx.fillStyle = '#fef9c3';
      for (const bx of [380, 560, 740]) {
        ctx.beginPath();
        ctx.moveTo(bx, 142);
        ctx.lineTo(bx + 55, 142);
        ctx.lineTo(bx - 20 + Math.sin(t + bx) * 12, 372);
        ctx.lineTo(bx - 85 + Math.sin(t + bx) * 12, 372);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Left Earthen Dyke & Pond Floor Cross-Section
    const soilHealthy = cur.fertility > 55;
    ctx.fillStyle = soilHealthy ? '#5c3a21' : '#78716c';
    ctx.beginPath();
    ctx.moveTo(0, 122);
    ctx.lineTo(242, 134);
    ctx.quadraticCurveTo(285, 260, 315, 368);
    ctx.lineTo(960, 374);
    ctx.lineTo(960, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Lush Grass Cap on Dyke
    ctx.fillStyle = soilHealthy ? '#22c55e' : '#a3a380';
    ctx.fillRect(0, 116, 244, 13);

    // Slot 0: Shore Dyke Plant
    if (slots[0] === 2) {
      drawTree(ctx, 75, 120, soilHealthy ? '#16a34a' : '#84cc16', '#713f12', t, true, slots[1] === 1);
      drawTree(ctx, 172, 124, soilHealthy ? '#15803d' : '#65a30d', '#713f12', t + 1.2, true, slots[1] === 1);
    } else if (slots[0] === 1) {
      drawTree(ctx, 118, 122, '#064e3b', '#451a03', t, false, false);
    } else if (slots[0] === 3) {
      ctx.fillStyle = '#eab308';
      for (let cx = 30; cx < 210; cx += 28) ctx.fillRect(cx, 78, 6, 42);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.fillRect(225, 132, 45, 18);
    }

    // Slot 2: Duckweed Pads on Surface when Grass Carp + Duckweed active
    if (slots[2] === 3 || slots[2] === 0) {
      ctx.fillStyle = '#4ade80';
      const padCnt = slots[2] === 0 ? 18 : 7;
      for (let p = 0; p < padCnt; p++) {
        const px = 275 + p * 36 + Math.sin(t * 1.5 + p) * 4;
        ctx.beginPath();
        ctx.ellipse(px, 142, 11, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Depth Zone Labels on Right Edge
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.fillText('0.0–0.5m Surface', 828, 168);
    ctx.fillText('0.5–1.5m Phyto', 828, 226);
    ctx.fillText('1.5–2.5m Zoopl.', 828, 286);
    ctx.fillText('2.5–3.5m Benthic', 828, 348);

    // Swim 4 Depth-Stratified Guilds!
    const gasping = cur.oxygen <= 42;
    for (const sw of swimmers) {
      sw.x += sw.vx * dt;
      if (sw.x < 305) { sw.x = 305; sw.vx = Math.abs(sw.vx); }
      if (sw.x > 915) { sw.x = 915; sw.vx = -Math.abs(sw.vx); }

      if (sw.band === 0 && slots[2] > 0) {
        const col = slots[2] === 3 ? '#86efac' : slots[2] === 1 ? '#f43f5e' : '#fb923c';
        drawFish(ctx, sw.x, 168 + Math.sin(t * 2 + sw.phase) * 7, sw.vx, 0.92, col, '#fef08a', t + sw.phase, gasping);
      } else if (sw.band === 1 && slots[3] === 1) {
        drawFish(ctx, sw.x, 226 + Math.sin(t * 1.8 + sw.phase) * 9, sw.vx, 0.88, '#e2e8f0', '#94a3b8', t + sw.phase, gasping);
      } else if (sw.band === 2 && (slots[4] === 2 || slots[4] === 1)) {
        const col = slots[4] === 2 ? '#fbbf24' : '#ef4444';
        drawFish(ctx, sw.x, 286 + Math.sin(t * 1.6 + sw.phase) * 9, sw.vx, 1.0, col, '#d97706', t + sw.phase, gasping);
      } else if (sw.band === 3 && slots[5] === 3) {
        drawFish(ctx, sw.x, 344 + Math.sin(t * 1.4 + sw.phase) * 5, sw.vx, 0.96, '#78716c', '#a8a29e', t + sw.phase, gasping);
      }
    }
  } else if (currentArena === 1) {
    // Arena 1: Aztec Chinampa Floating Island (`x: 270..690`) + Turquoise Canal
    const wGrad = ctx.createLinearGradient(0, 155, 0, H);
    wGrad.addColorStop(0, wc.top);
    wGrad.addColorStop(1, wc.deep);
    ctx.fillStyle = wGrad;
    ctx.fillRect(0, 155, W, H - 155);

    ctx.fillStyle = '#5c3a21';
    ctx.beginPath();
    ctx.roundRect(275, 138, 410, 78, 18);
    ctx.fill();
    ctx.fillStyle = cur.fertility > 55 ? '#22c55e' : '#a3a380';
    ctx.fillRect(282, 132, 396, 12);

    if (slots[0] === 1) {
      drawTree(ctx, 298, 136, '#4ade80', '#78350f', t);
      drawTree(ctx, 662, 136, '#4ade80', '#78350f', t + 1.5);
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.55)';
      ctx.lineWidth = 2;
      for (let rx = 290; rx <= 670; rx += 22) {
        ctx.beginPath();
        ctx.moveTo(rx, 214);
        ctx.quadraticCurveTo(rx + Math.sin(t * 2 + rx) * 6, 260, rx, 298);
        ctx.stroke();
      }
    }

    if (slots[1] === 3) {
      for (let cx = 365; cx <= 595; cx += 46) {
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx, 134);
        ctx.lineTo(cx + Math.sin(t * 2 + cx) * 3, 72);
        ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.ellipse(cx + 5, 100, 4, 9, 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(cx + 18, 130, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const gasping = cur.oxygen <= 42;
    for (const sw of swimmers) {
      sw.x = ((sw.x + sw.vx * dt + W) % (W - 80)) + 40;
      if (sw.band <= 1 && slots[4] === 3) {
        drawFish(ctx, sw.x, 315 + (sw.id % 3) * 20 + Math.sin(t * 2 + sw.phase) * 5, sw.vx, 1.0, '#fbcfe8', '#f472b6', t + sw.phase, gasping, true);
      } else if (sw.band >= 2 && slots[3] === 2) {
        drawFish(ctx, sw.x, 245 + Math.sin(t * 2.5 + sw.phase) * 8, sw.vx, 0.72, '#bae6fd', '#38bdf8', t + sw.phase, gasping);
      }
    }
  } else if (currentArena === 2) {
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H + 110, 540, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 345, W, 55);

    ctx.fillStyle = wc.top;
    ctx.fillRect(55, 145, 250, 200);
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 3;
    ctx.strokeRect(55, 138, 250, 207);

    ctx.fillStyle = slots[2] === 3 ? '#78350f' : '#475569';
    ctx.fillRect(350, 195, 195, 100);
    ctx.strokeStyle = '#38bdf8';
    ctx.strokeRect(350, 195, 195, 100);
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = '#fef08a';
    ctx.fillText(slots[2] === 3 ? '🦠 NH3 ➔ NO2- ➔ NO3-' : '⚠ Bio-Filter Uncycled', 368, 186);

    ctx.fillStyle = wc.top;
    ctx.fillRect(585, 230, 330, 115);
    ctx.strokeStyle = '#34d399';
    ctx.strokeRect(585, 230, 330, 115);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(595, 222, 310, 10);

    if (slots[3] === 1) {
      for (let lx = 618; lx <= 885; lx += 38) {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(lx, 212 + Math.sin(t * 2 + lx) * 2, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(lx + 7, 217, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (slots[0] === 2 || slots[0] === 3) {
      const cnt = slots[0] === 3 ? 18 : 8;
      for (let i = 0; i < cnt; i++) {
        const sw = swimmers[i];
        const fx = 85 + ((sw.x + i * 29) % 190);
        const fy = 172 + (i % 5) * 30 + Math.sin(t * 2.5 + i) * 5;
        drawFish(ctx, fx, fy, sw.vx, 0.82, '#93c5fd', '#38bdf8', t + i, cur.oxygen <= 42);
      }
    }
  } else {
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(0, 320, W, 80);

    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 355, 355, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = cur.oxygen > 55 ? 'rgba(14, 165, 233, 0.22)' : 'rgba(127, 29, 29, 0.34)';
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    if (slots[0] === 3) {
      for (const cx of [255, 305, 355]) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.82)';
        ctx.fillRect(cx, 145, 28, 180);
        ctx.strokeStyle = '#a7f3d0';
        ctx.strokeRect(cx, 145, 28, 180);
      }
    }

    ctx.fillStyle = slots[5] === 1 ? '#422006' : '#b45309';
    ctx.fillRect(420, 275, 280, 50);
    if (slots[1] === 1) {
      for (let wx = 435; wx <= 685; wx += 18) {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(wx, 240 + Math.sin(t * 2 + wx) * 2, 4, 35);
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(wx + 2, 272, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (slots[3] === 2) {
      ctx.fillStyle = '#fef3c7';
      for (const mx of [175, 198, 220]) {
        ctx.beginPath();
        ctx.arc(mx, 312, 9, Math.PI, 0);
        ctx.fill();
      }
    }
    if (slots[2] === 2) {
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.ellipse(755, 320, 62, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const p of particles) {
    p.t = (p.t + dt * 0.24) % 1;
    if (cur.oxygen > 45 && p.kind <= 1) {
      ctx.fillStyle = 'rgba(186, 230, 253, 0.55)';
      const bx = 280 + (p.x % 620);
      const by = 355 - p.t * 205;
      ctx.beginPath();
      ctx.arc(bx, by, p.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (full.isHaltFree) {
    ctx.save();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.58)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 42;
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.54, 320, 125, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (let k = 0; k < 8; k++) {
      const ang = t * 1.4 + (k * Math.PI) / 4;
      const ox = W * 0.5 + Math.cos(ang) * 320;
      const oy = H * 0.54 + Math.sin(ang) * 125;
      ctx.fillStyle = k % 2 === 0 ? '#fde047' : '#34d399';
      ctx.beginPath();
      ctx.arc(ox, oy, 5.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  requestAnimationFrame(renderCanvasLoop);
}

// ---------------------------------------------------------------------------
// DOM Rendering: Arena Cards, 6 Niche Builders, Vitals, Passport & Hall of Fame
// ---------------------------------------------------------------------------

function renderArenaSelector() {
  const mount = document.getElementById('arenaSelectorMount');
  if (!mount) return;
  const bestStars = onChainOverview?.viewer?.bestStars || [0, 0, 0, 0];

  mount.innerHTML = ARENAS.map((a) => {
    const stars = bestStars[a.id] || 0;
    const starBadge = stars > 0 ? '⭐'.repeat(stars) : '☆☆☆';
    return `
      <button type="button" class="he-arena-card ${currentArena === a.id ? 'is-active' : ''}" data-arena-id="${a.id}">
        <img src="${a.thumb}" alt="${escapeHtml(a.shortName)}" class="he-arena-thumb" />
        <div class="he-arena-meta">
          <div class="he-arena-lvl">
            <span>Lv.${a.id + 1}</span>
            <span>${starBadge}</span>
          </div>
          <div class="he-arena-name">${escapeHtml(a.shortName)}</div>
          <div class="he-arena-sub">${escapeHtml(a.era.split('·')[0])}</div>
        </div>
      </button>
    `;
  }).join('');

  const active = ARENAS[currentArena];
  document.getElementById('lblArenaEra').textContent = active.era;
  document.getElementById('lblArenaTitle').textContent = active.title;
  document.getElementById('arenaStoryMount').innerHTML = `
    <img src="${active.thumb}" alt="${escapeHtml(active.shortName)}" class="he-history-img" />
    <div>${active.story}</div>
  `;
}

function renderNicheSlots() {
  const mount = document.getElementById('slotsGridMount');
  if (!mount) return;
  const active = ARENAS[currentArena];
  const picks = arenaChoices[currentArena];

  mount.innerHTML = active.slots
    .map(
      (sl, sIdx) => `
      <div class="he-slot-card">
        <div class="he-slot-hdr">
          <span class="he-slot-zone mono">${escapeHtml(sl.zone)}</span>
        </div>
        <div class="he-slot-title">${escapeHtml(sl.title)}</div>
        <div class="he-slot-question">${escapeHtml(sl.question)}</div>
        <div class="he-opt-list">
          ${sl.options
            .map(
              (opt, oIdx) => `
            <button type="button"
              class="he-opt-btn ${picks[sIdx] === oIdx ? 'is-selected' : ''}"
              data-slot-idx="${sIdx}"
              data-opt-idx="${oIdx}">
              <div>
                <span>${opt.icon} ${escapeHtml(opt.name)}</span>
                <span class="he-opt-sub">${escapeHtml(opt.sub)}</span>
              </div>
              <span class="mono" style="font-size:0.75rem;">${picks[sIdx] === oIdx ? '✓' : '○'}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `
    )
    .join('');
}

function renderVitalsAndDiagnosis(fullSim, curSnap) {
  const vMount = document.getElementById('vitalsMount');
  const dMount = document.getElementById('diagnosisBox');
  const yLbl = document.getElementById('lblTotalYield');
  if (!vMount || !dMount) return;

  const snap = curSnap || fullSim;
  if (yLbl) yLbl.textContent = `🧺 ${snap.totalYield} Harvest`;

  const bars = [
    { label: '🫧 Oxygen Balance', val: snap.oxygen, color: 'linear-gradient(90deg,#0ea5e9,#38bdf8)', ok: snap.oxygen > 36 },
    { label: '💎 Water / Air Clarity', val: snap.clarity, color: 'linear-gradient(90deg,#06b6d4,#2dd4bf)', ok: snap.clarity > 24 },
    { label: '🌱 Soil & Silt Fertility', val: snap.fertility, color: 'linear-gradient(90deg,#22c55e,#84cc16)', ok: snap.fertility > 26 },
    { label: '🛡️ Cleanliness (Low Toxin)', val: Math.max(0, 100 - snap.toxicity), color: 'linear-gradient(90deg,#a855f7,#ec4899)', ok: snap.toxicity < 55 },
  ];

  vMount.innerHTML = bars
    .map(
      (b) => `
      <div class="he-vital-row">
        <div class="he-vital-top">
          <span>${b.label}</span>
          <span class="mono" style="color:${b.ok ? '#6ee7b7' : '#fda4af'};">${b.val}%</span>
        </div>
        <div class="he-vital-track">
          <div class="he-vital-fill" style="width:${b.val}%;background:${b.color};"></div>
        </div>
      </div>
    `
    )
    .join('');

  const diag = HALT_DIAGNOSES[fullSim.haltReason] || HALT_DIAGNOSES[HALT_NUTRIENT_STARVATION];
  dMount.className = `he-diagnosis-box ${diag.tone === 'win' ? 'is-win' : 'is-warn'}`;
  dMount.innerHTML = `
    <div style="font-weight:800;margin-bottom:4px;">${diag.badge}</div>
    <div>${diag.explain}</div>
  `;

  if (fullSim.isHaltFree) {
    heGuide?.updateCoach({
      pill: '♾️ LOOP COMPLETE!',
      tone: 'action',
      html: `All 12 seasons balanced at <strong>${fullSim.totalYield} Harvest</strong>! Click <strong>♾️ Verify &amp; Seal Loop</strong> to record your ${'⭐'.repeat(fullSim.stars)} badge on Subnet 1!`,
      actionLabel: '♾️ Seal on Subnet 1',
      onAction: () => sealEcosystemOnChain(),
    });
  } else {
    heGuide?.updateCoach({
      pill: `🔬 ARENA ${currentArena + 1}`,
      tone: 'info',
      html: `Experiment with the <strong>6 ecological niches</strong> below until all 12 seasons run without halting!`,
    });
  }
}

function renderSidebar() {
  const fullSim = simulateLocal12Seasons(currentArena, arenaChoices[currentArena]);
  renderVitalsAndDiagnosis(fullSim, fullSim);

  const sealBtn = document.getElementById('btnSealOnChain');
  if (sealBtn) {
    sealBtn.disabled = txBusy;
    sealBtn.textContent = txBusy ? '⛓️ Sealing on Subnet 1…' : '♾️ Verify & Seal Loop ($0 Gas)';
  }

  const vw = onChainOverview?.viewer;
  const totalStars = vw ? vw.bestStars.reduce((a, b) => a + b, 0) : 0;
  document.getElementById('lblTotalStars').textContent = `⭐ ${totalStars} / 12`;

  const rankTitle =
    totalStars >= 12
      ? '🌟 Grand Halt-Free Ecologist'
      : totalStars >= 6
      ? '🔬 Closed-Loop Bio-Engineer'
      : totalStars >= 3
      ? '🐟 Master of Sangji Yutang'
      : '🌱 Permaculture Explorer';

  document.getElementById('passportMount').innerHTML = `
    <div style="font-weight:800;color:#fde68a;">${rankTitle}</div>
    <div class="he-badge-grid">
      ${ARENAS.map((a) => {
        const solved = vw && (vw.solvedMask & (1 << a.id)) !== 0;
        const st = vw ? vw.bestStars[a.id] : 0;
        return `
          <div class="he-mini-badge ${solved ? 'solved' : ''}">
            <div style="font-weight:800;">${escapeHtml(a.shortName)}</div>
            <div class="mono" style="color:${solved ? '#6ee7b7' : '#94a3b8'};">
              ${solved ? `${'⭐'.repeat(st)} · ${vw.bestYield[a.id]} Yield` : 'Unsolved'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

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
    : `<div class="he-muted">Seal your first Halt-Free pond loop to appear on the Hall of Fame!</div>`;

  const logs = onChainOverview?.logs || [];
  document.getElementById('logsMount').innerHTML = logs.length
    ? [...logs]
        .reverse()
        .map((lg) => {
          const aName = ARENAS[lg.arenaId]?.shortName || 'Arena';
          const badge = lg.haltReason === 0 ? `♾️ ${'⭐'.repeat(lg.stars)}` : `S${lg.seasons} Halt`;
          return `
            <div class="he-row-item">
              <span>${escapeHtml(formatScholarName(lg.identity))} · ${escapeHtml(aName)}</span>
              <span class="mono" style="color:${lg.haltReason === 0 ? '#6ee7b7' : '#fda4af'};">${badge}</span>
            </div>
          `;
        })
        .join('')
    : `<div class="he-muted">Recent field experiments will stream here live.</div>`;
}

function renderAllUI() {
  renderArenaSelector();
  renderNicheSlots();
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Event Wiring & Boot
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById('btnClearSlots')?.addEventListener('click', () => {
    arenaChoices[currentArena] = [0, 0, 0, 0, 0, 0];
    playbackActive = false;
    renderAllUI();
  });

  document.getElementById('btnReplayAnim')?.addEventListener('click', () => {
    start12SeasonPlayback();
  });

  document.getElementById('btnSealOnChain')?.addEventListener('click', () => {
    sealEcosystemOnChain();
  });

  document.addEventListener('click', (ev) => {
    const arenaBtn = ev.target.closest('[data-arena-id]');
    if (arenaBtn) {
      currentArena = Number(arenaBtn.getAttribute('data-arena-id'));
      playbackActive = false;
      renderAllUI();
      return;
    }

    const optBtn = ev.target.closest('[data-slot-idx]');
    if (optBtn) {
      const sIdx = Number(optBtn.getAttribute('data-slot-idx'));
      const oIdx = Number(optBtn.getAttribute('data-opt-idx'));
      arenaChoices[currentArena][sIdx] = oIdx;
      playbackActive = false;
      renderAllUI();
    }
  });
}

async function selectSanctuaryInstance(addr) {
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  contractAddr = (addr || '').toLowerCase();
  await refreshOnChainState();
  if (contractAddr) {
    stopWatcher = slxWatchChainApp({
      rpcUrl,
      contractAddresses: [contractAddr],
      onRefresh: () => refreshOnChainState(),
    });
  }
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'haltfree-ecosystem',
    title: 'Haltfree Ecosystem',
    subtitle: '2,400-Year-Old Closed-Loop Aquaculture, Aztec Chinampas, Aquaponics & Mars Biodome • $0.00 Gas',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => contractAddr || '',
    getContractLabel: () => 'HaltfreeEcosystem',
    onWalletSwitch: () => refreshOnChainState(),
    extraElements: [document.getElementById('btnHowToPlay')],
  });

  bindEvents();

  heGuide = mountSlxGameGuide({
    gameId: 'haltfree-ecosystem',
    manualSpec: HALTFREE_MANUAL_SPEC,
    headerBtnEl: document.getElementById('btnHowToPlay'),
    welcomeMountEl: document.getElementById('heWelcomeMount'),
    coachMountEl: document.getElementById('heCoachMount'),
    onWelcomePrimaryAction: () => start12SeasonPlayback(),
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
