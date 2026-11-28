/**
 * JONES IN THE BLOCKCHAIN (`app-sources/jones/app.js` — SuperLexicon HFS #24 v2.0)
 *
 * Cyberpunk 1–4 player life-simulation & career/education strategy game
 * inspired by the classic *Jones in the Fast Lane*, suitable for all ages:
 *  - Full 16:9 Illustrated Cyberpunk City Map (`/assets/jones/town_center.jpg`)
 *    with 12 overlaid interactive neon venue hitboxes + central Holo-Terminal.
 *  - 4 Simultaneous Victory Pillars (100% Wealth, Vibe/Happiness, Neural Education & Career).
 *  - Zero-Fatigue 60-Hour Weekly Chrono-Planner (`submitWeekPlan` commits up to 32 ops in 1 block at $0.00 gas).
 *  - On-Chain Identity HFS required & verified (`is_authorized_for_identity`) for Solo & Crew/Family PvP boards.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  encodeAbi,
  readU16BE,
  readU32BE,
  readU64BE,
  shortAddr,
  shortHex,
  ZERO_ADDR,
  SlxClient,
  SlxWalletManager,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  readOnChainIdentityNickname,
  slxWatchChainApp,
} from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountHfsRegistryDropdown } from '@superlexicon/sdk/hfs-deployers';
import { mountSlxGameGuide } from '@superlexicon/sdk/ui/game-guide';

// ---------------------------------------------------------------------------
// Protocol Constants (Exact match to `examples/jones-blockchain/src/main.rs`)
// ---------------------------------------------------------------------------

const PHASE_LOBBY = 1;
const PHASE_ACTIVE = 2;
const PHASE_FINISHED = 3;

const NUM_BUILDINGS = 12;
const CREDITS_PER_DEGREE = 10;
const MAX_PLAN_STEPS = 32;

const OP_MOVE = 1;
const OP_WORK = 2;
const OP_STUDY = 3;
const OP_APPLY_JOB = 4;
const OP_ASK_RAISE = 5;
const OP_BUY_FOOD = 6;
const OP_BUY_CLOTHES = 7;
const OP_BUY_APPLIANCE = 8;
const OP_BANK_DEPOSIT = 9;
const OP_BANK_WITHDRAW = 10;
const OP_BUY_STOCK = 11;
const OP_SELL_STOCK = 12;
const OP_PAY_RENT = 13;
const OP_SWITCH_APT = 14;
const OP_RELAX = 15;
const OP_REPAIR_PAWN = 16;

const DEFAULT_GAME_ID =
  '0x4a4f4e45535f53554e4e5956414c455f424f4152445f30310000000000000000';

const BOT_PROFILES = {
  1: { name: 'Jones', title: 'Cyber-Rival All-Rounder', icon: '🕶️', art: '/assets/jones/rival_jones.jpg' },
  2: { name: 'Penny Hodl', title: 'Cryo-Vault Quant Bot', icon: '🐷', art: '/assets/jones/keeper_bank.jpg' },
  3: { name: 'Sunny Wheeler', title: 'Hover-Scooter & Diner Runner', icon: '🛴', art: '/assets/jones/keeper_burgers.jpg' },
};

// Exact measured percentage bounding boxes overlaid onto `/assets/jones/town_center.jpg` (1536x864, 16:9)
export const BUILDINGS = [
  {
    id: 0,
    icon: '🏙️',
    name: 'Pod-Hab Towers',
    sub: 'Neon Pods & LeSecurity Spire',
    neon: '#22d3ee',
    glow: 'rgba(34, 211, 238, 0.34)',
    box: { left: 4.3, top: 2.2, width: 25.0, height: 27.2 },
    art: '/assets/jones/rival_jones.jpg',
    keeperName: 'Pod-Hab Concierge AI',
    quote: '“Welcome back to your capsule! Catch a 6-hour cryo-nap or stream Holo-Stereo TV to recharge your Vibe!”',
  },
  {
    id: 1,
    icon: '🍔',
    name: 'Byte-Burgers',
    sub: 'Synth-Burgers, Shakes & Diner Shifts',
    neon: '#fb7185',
    glow: 'rgba(251, 113, 133, 0.34)',
    box: { left: 31.8, top: 2.2, width: 17.6, height: 27.2 },
    art: '/assets/jones/keeper_burgers.jpg',
    keeperName: 'Synth-Chef Mel @ Byte-Burgers',
    quote: '“Four robo-arms, zero waiting! Sizzling neon double-burgers and pink synth-shakes—no Cryo-Fridge required!”',
  },
  {
    id: 2,
    icon: '⚡',
    name: 'Z-Mart Bazaar',
    sub: '15%-Off Refurb Tech & Cyber-Lotto',
    neon: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.34)',
    box: { left: 51.8, top: 2.2, width: 19.2, height: 27.2 },
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Flash-Sale Drone @ Z-Mart',
    quote: '“Neon beacon specials! Refurbished Cryo-Fridges, Pulse-Ovens & Holo-TVs at 15% off, plus Sector Jackpot tickets!”',
  },
  {
    id: 3,
    icon: '🧥',
    name: 'ChromaThreads',
    sub: 'LED Hoodies, Blazers & Exec Chrome',
    neon: '#e879f9',
    glow: 'rgba(232, 121, 249, 0.36)',
    box: { left: 73.6, top: 2.2, width: 22.0, height: 27.2 },
    art: '/assets/jones/keeper_clothing.jpg',
    keeperName: 'Stylist Nova @ ChromaThreads',
    quote: '“Upgrade your silhouette! Smart LED Blazers unlock Cryo-Bank & Foundry engineering, and Exec Chrome opens the C-Suite.”',
  },
  {
    id: 4,
    icon: '🤖',
    name: 'Socket City Lab',
    sub: 'Cyberdeck, Hover-Scooter & Cryo-Gear',
    neon: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.34)',
    box: { left: 74.8, top: 30.2, width: 20.8, height: 19.2 },
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Tinkerer Gus @ Socket City',
    quote: '“A Neural Cyberdeck PC doubles University study speed AND mines $25/wk! A Hover-Scooter cuts street travel in half!”',
  },
  {
    id: 5,
    icon: '🎓',
    name: 'Haltproof Cyber-U.',
    sub: '4 Neural Degrees (10 Credits Each)',
    neon: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.36)',
    box: { left: 75.2, top: 50.2, width: 20.6, height: 19.2 },
    art: '/assets/jones/keeper_university.jpg',
    keeperName: 'Dean Ada-9 @ Haltproof Cyber-U.',
    quote: '“Data-crystals never depreciate! Earn 10 credits per degree—or graduate in just 5 sessions with a Cyberdeck PC!”',
  },
  {
    id: 6,
    icon: '💼',
    name: 'Job Guild Tower',
    sub: '12 Cyber-Careers & Pay Raises',
    neon: '#10b981',
    glow: 'rgba(16, 185, 129, 0.36)',
    box: { left: 75.5, top: 70.0, width: 20.2, height: 26.2 },
    art: '/assets/jones/keeper_employment.jpg',
    keeperName: 'Neural Career Guild Dispatch',
    quote: '“Ready to climb the grid? Match your Degrees, Experience, and ChromaThreads tier to unlock top-paying roles!”',
  },
  {
    id: 7,
    icon: '⚙️',
    name: 'SLX Foundry',
    sub: 'Quantum Silicon & Wasm Engineering',
    neon: '#f97316',
    glow: 'rgba(249, 115, 22, 0.36)',
    box: { left: 52.0, top: 67.6, width: 20.2, height: 28.6 },
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Foreman Torque @ SLX Foundry',
    quote: '“From Reactor Sweeper up to Chief Wasm Architect—clock a 6-hour shift in the plasma bays and stack credits!”',
  },
  {
    id: 8,
    icon: '🏦',
    name: 'Cryo-Bank Vault',
    sub: '2%/wk Yield & 3 Cyber-Equities',
    neon: '#facc15',
    glow: 'rgba(250, 204, 21, 0.34)',
    box: { left: 29.8, top: 66.4, width: 18.8, height: 29.8 },
    art: '/assets/jones/keeper_bank.jpg',
    keeperName: 'Broker Unit-7 @ Consensus Cryo-Bank',
    quote: '“Vault deposits earn 2% compound yield every weekend—and Glitch-Sam can NEVER swipe credits behind our laser grid!”',
  },
  {
    id: 9,
    icon: '🍏',
    name: 'BioFresh Dome',
    sub: '1, 2 & 4-Week Hydroponic Rations',
    neon: '#4ade80',
    glow: 'rgba(74, 222, 128, 0.34)',
    box: { left: 4.5, top: 70.0, width: 22.2, height: 26.2 },
    art: '/assets/jones/keeper_market.jpg',
    keeperName: 'Grocer Kai @ BioFresh Hydro-Dome',
    quote: '“Crisp cyber-apples and nutrient loaves! Own a Cryo-Fridge for 2-week crates or a Sub-Zero Freezer for 4-week bulk packs!”',
  },
  {
    id: 10,
    icon: '🌸',
    name: 'Neon Commons',
    sub: 'Hab-Lease, Spire Upgrade & Zen Park',
    neon: '#f472b6',
    glow: 'rgba(244, 114, 182, 0.34)',
    box: { left: 4.2, top: 50.2, width: 23.2, height: 19.2 },
    art: '/assets/jones/keeper_clothing.jpg',
    keeperName: 'Sakura Rooftop & Hab-Lease Kiosk',
    quote: '“Settle monthly hab-rent, upgrade to bandit-proof LeSecurity Spire, or chill under the neon cherry blossoms (+4 Vibe, $0)!”',
  },
  {
    id: 11,
    icon: '🔧',
    name: 'Glitch-Pawn Lab',
    sub: 'Tune Broken Tech or Instant Creds',
    neon: '#c084fc',
    glow: 'rgba(192, 132, 252, 0.36)',
    box: { left: 4.5, top: 30.0, width: 23.0, height: 19.4 },
    art: '/assets/jones/bandit_sam.jpg',
    keeperName: 'Patchwork Pix @ Glitch-Pawn',
    quote: '“Power surge fry a circuit over the weekend? I’ll re-solder any rig for $55—or buy used cyber-gear for 55% instant cash!”',
  },
];

export const DEGREES = [
  { id: 0, icon: '💠', name: 'Junior Cyber-Diploma', reqText: 'Open to all runners', unlocks: 'Shift Lead, Supply Buyer, Adv. Neural Degrees' },
  { id: 1, icon: '⚡', name: 'Cybernetics & Wasm Eng.', reqText: 'Open to all runners', unlocks: 'Cyberdeck Bench Tech, Foundry Engineer' },
  { id: 2, icon: '📊', name: 'DeFi & Ledger Systems', reqText: 'Open to all runners', unlocks: 'Cryo-Bank Teller, Quant Analyst' },
  { id: 3, icon: '🧬', name: 'Consensus Architecture', reqText: 'Requires Jr. Diploma + (Cybernetics or DeFi)', unlocks: 'Chief Wasm Architect, Cryo-Bank President' },
];

export const APPLIANCES = [
  { id: 0, icon: '🧊', name: 'Cryo-Fridge', basePrice: 320, hap: 5, perk: 'Stores up to 2 weeks of BioFresh hydro-groceries' },
  { id: 1, icon: '❄️', name: 'Sub-Zero Freezer', basePrice: 280, hap: 5, perk: 'Requires Cryo-Fridge · Stores up to 6 weeks of bulk rations' },
  { id: 2, icon: '⚡', name: 'Pulse-Wave Oven', basePrice: 220, hap: 4, perk: '+4 Bonus Chrono-Hours EVERY week (64h weekly budget!)' },
  { id: 3, icon: '📺', name: 'Holo-Stereo Wall', basePrice: 360, hap: 8, perk: '+8 Vibe & upgrades Pod-Hab Chill to +5 Vibe' },
  { id: 4, icon: '💻', name: 'Neural Cyberdeck PC', basePrice: 540, hap: 8, perk: '2x Cyber-U. Study Speed (+2 credits) & +$25/wk node tips!' },
  { id: 5, icon: '🛴', name: 'Neon Hover-Scooter', basePrice: 420, hap: 6, perk: 'Cuts city block travel time in half (1h per step instead of 2h!)' },
];

export const JOBS = [
  { id: 1, title: 'Synth-Grill Cook', workplace: 1, baseWage: 8, dress: 1, reqDegMask: 0, anyAdv: false, reqExp: 0, reqDep: 0, rank: 1 },
  { id: 2, title: 'Cargo Drone Loader', workplace: 2, baseWage: 9, dress: 1, reqDegMask: 0, anyAdv: false, reqExp: 0, reqDep: 0, rank: 1 },
  { id: 3, title: 'Reactor Sweeper', workplace: 7, baseWage: 10, dress: 1, reqDegMask: 0, anyAdv: false, reqExp: 4, reqDep: 15, rank: 2 },
  { id: 4, title: 'Diner Shift Lead', workplace: 1, baseWage: 13, dress: 1, reqDegMask: 0b0001, anyAdv: false, reqExp: 10, reqDep: 20, rank: 3 },
  { id: 5, title: 'Cyberdeck Bench Tech', workplace: 4, baseWage: 16, dress: 1, reqDegMask: 0b0010, anyAdv: false, reqExp: 12, reqDep: 25, rank: 4 },
  { id: 6, title: 'Bazaar Supply Buyer', workplace: 2, baseWage: 17, dress: 2, reqDegMask: 0b0001, anyAdv: false, reqExp: 14, reqDep: 25, rank: 4 },
  { id: 7, title: 'Cryo-Vault Teller', workplace: 8, baseWage: 20, dress: 2, reqDegMask: 0b0100, anyAdv: false, reqExp: 18, reqDep: 30, rank: 5 },
  { id: 8, title: 'Foundry Mecha Eng.', workplace: 7, baseWage: 24, dress: 2, reqDegMask: 0b0011, anyAdv: false, reqExp: 24, reqDep: 35, rank: 6 },
  { id: 9, title: 'Cyber-U. Adjunct', workplace: 5, baseWage: 27, dress: 2, reqDegMask: 0b0001, anyAdv: true, reqExp: 30, reqDep: 40, rank: 7 },
  { id: 10, title: 'DeFi Quant Analyst', workplace: 8, baseWage: 32, dress: 3, reqDegMask: 0b0101, anyAdv: false, reqExp: 36, reqDep: 45, rank: 8 },
  { id: 11, title: 'Chief Wasm Architect', workplace: 7, baseWage: 38, dress: 3, reqDegMask: 0b1011, anyAdv: false, reqExp: 44, reqDep: 50, rank: 9 },
  { id: 12, title: 'Cryo-Bank President', workplace: 8, baseWage: 45, dress: 3, reqDegMask: 0b1111, anyAdv: false, reqExp: 52, reqDep: 55, rank: 10 },
];

const STOCK_NAMES = [
  { id: 0, sym: 'CRYO-TB', name: 'Sector Treasury Bonds', risk: 'Low-Vol Yield' },
  { id: 1, sym: 'BYTE-BG', name: 'Byte-Burger SynthCorp', risk: 'Mid-Cap Growth' },
  { id: 2, sym: 'Q-WASM', name: 'Quantum Wasm Foundry', risk: 'High-Beta Tech' },
];

const DRESS_NAMES = ['Frayed Streetwear', 'Neon Street Hoodie', 'Smart LED Blazer', 'Exec Chrome Suit'];

const WEEKEND_HEADLINES = {
  1: { icon: '🌃', text: 'cruised the neon skyways over a chill cyberpunk weekend.', thumb: '/assets/jones/town_center.jpg' },
  2: { icon: '🕶️', text: 'got packet-skimmed outside Pod-Hab by Glitch-Sam! Unbanked cash lost:', thumb: '/assets/jones/bandit_sam.jpg' },
  3: { icon: '🛡️', text: 'watched LeSecurity Spire’s laser-turret bounce Glitch-Sam! (+2 Vibe)', thumb: '/assets/jones/bandit_sam.jpg' },
  4: { icon: '🍜', text: 'ran out of rations! Ordered drone-drop synth-noodles (-4 Vibe):', thumb: '/assets/jones/keeper_burgers.jpg' },
  5: { icon: '🥬', text: 'had uncooled BioFresh greens wilt! Pick up a Cryo-Fridge!', thumb: '/assets/jones/keeper_market.jpg' },
  6: { icon: '💠', text: 'received an encrypted cred-drop from Aunt Millie on the Lunar Relay!', thumb: '/assets/jones/rival_jones.jpg' },
  7: { icon: '🎸', text: 'won Best Synth-Track at the Neon Commons Rooftop Jam! (+3 Vibe)', thumb: '/assets/jones/keeper_clothing.jpg' },
  8: { icon: '🏦', text: 'collected a $60 Subnet Validator Staking Rebate!', thumb: '/assets/jones/keeper_bank.jpg' },
  9: { icon: '🔧', text: 'blew a plasma fuse during a grid surge—visit Glitch-Pawn to tune it!', thumb: '/assets/jones/keeper_tech.jpg' },
  10: { icon: '💻', text: 'mined +$25 passive weekend relay rewards on their Cyberdeck PC!', thumb: '/assets/jones/keeper_tech.jpg' },
  11: { icon: '🏙️', text: 'auto-settled monthly Neo-Sector hab-lease:', thumb: '/assets/jones/town_center.jpg' },
  12: { icon: '🏆', text: 'MAXED 100% ACROSS ALL FOUR PILLARS & RULED NEO-SECTOR!', thumb: '/assets/jones/rival_jones.jpg' },
};

// ---------------------------------------------------------------------------
// Live Runtime State
// ---------------------------------------------------------------------------

const rpcUrl = getDefaultNodeWsUrl();
const wallet = new SlxWalletManager();
const slxClient = new SlxClient(rpcUrl);

let contractAddr = '';
let activeGameId = DEFAULT_GAME_ID;
let gameState = null;
let directoryGames = [];
let selectedBuilding = null; // null = Full Map Overview, 0..11 = Venue Holo-Terminal
let plannedSteps = []; // array of { op, arg, label }
let selectedPreset = 0;
let selectedBots = 1;
let txBusy = false;
let stopWatcher = null;
let jbGuide = null;
let bootReadyResolve = null;
const bootReadyPromise = new Promise((res) => {
  bootReadyResolve = res;
});
const nickCache = new Map();

// ---------------------------------------------------------------------------
// Pure Helpers & Client-Side 60-Hour Week Simulator
// ---------------------------------------------------------------------------

function ringDistance(a, b) {
  const ca = ((a % NUM_BUILDINGS) + NUM_BUILDINGS) % NUM_BUILDINGS;
  const cb = ((b % NUM_BUILDINGS) + NUM_BUILDINGS) % NUM_BUILDINGS;
  const diff = Math.abs(ca - cb);
  return Math.min(diff, NUM_BUILDINGS - diff);
}

function scaledPrice(base, econIdx) {
  return Math.max(1, Math.floor((base * (econIdx || 100)) / 100));
}

function getJob(jobId) {
  return JOBS.find((j) => j.id === jobId) || null;
}

function hasWorkingApp(seat, appId) {
  const bit = 1 << appId;
  return (seat.appliancesMask & bit) !== 0 && (seat.appliancesBrokenMask & bit) === 0;
}

function effectiveClothesTier(seat) {
  return seat.clothesWeeks === 0 ? 0 : seat.clothesTier;
}

function qualifiesForJob(seat, job) {
  if (!job) return false;
  if ((seat.degreesMask & job.reqDegMask) !== job.reqDegMask) return false;
  if (job.anyAdv && (seat.degreesMask & 0b0110) === 0) return false;
  if (seat.experience < job.reqExp || seat.dependability < job.reqDep) return false;
  if (effectiveClothesTier(seat) < job.dress) return false;
  return true;
}

function qualifiesForDegree(seat, degId) {
  if ((seat.degreesMask & (1 << degId)) !== 0) return false;
  if (degId === 3) {
    return (seat.degreesMask & 0b0001) !== 0 && (seat.degreesMask & 0b0110) !== 0;
  }
  return true;
}

function computeGoalPcts(seat, game) {
  const prices = game.stockPrices;
  const portVal =
    seat.stocks[0] * prices[0] + seat.stocks[1] * prices[1] + seat.stocks[2] * prices[2];
  const netW = Math.max(0, seat.cash + seat.savings + portVal - seat.rentDebt);
  let eduCreds = 0;
  for (let d = 0; d < 4; d++) {
    eduCreds += (seat.degreesMask & (1 << d)) !== 0 ? 10 : Math.min(9, seat.studyCredits[d]);
  }
  const jb = getJob(seat.jobId);
  const careerPts =
    (jb ? jb.rank * 7 : 0) +
    Math.floor(Math.min(100, seat.dependability) / 5) +
    Math.floor(Math.min(100, seat.experience) / 5);

  return {
    netWealth: netW,
    eduCreds,
    careerPts,
    pcts: [
      Math.min(100, Math.floor((netW * 100) / Math.max(100, game.wealthGoal))),
      Math.min(100, Math.floor((seat.happiness * 100) / Math.max(10, game.hapGoal))),
      Math.min(100, Math.floor((eduCreds * 100) / Math.max(10, game.eduGoal))),
      Math.min(100, Math.floor((careerPts * 100) / Math.max(10, game.careerGoal))),
    ],
  };
}

function cloneSeat(s) {
  return {
    ...s,
    studyCredits: [...s.studyCredits],
    stocks: [...s.stocks],
    raiseAskedThisWeek: s.raiseAskedThisWeek || 0,
  };
}

function simulateLocalPlan(baseSeat, game, steps) {
  const s = cloneSeat(baseSeat);
  const econ = game.economyIndex || 100;

  for (const st of steps) {
    const { op, arg } = st;
    if (op === OP_MOVE) {
      const target = arg % NUM_BUILDINGS;
      if (s.location === target) continue;
      const cost = ringDistance(s.location, target) * (hasWorkingApp(s, 5) ? 1 : 2);
      if (s.hoursLeft >= cost) {
        s.hoursLeft -= cost;
        s.location = target;
      }
    } else if (op === OP_WORK) {
      const jb = getJob(s.jobId);
      if (!jb || s.location !== jb.workplace || effectiveClothesTier(s) < jb.dress) continue;
      const shifts = Math.max(1, Math.min(10, arg));
      for (let k = 0; k < shifts; k++) {
        if (s.hoursLeft < 6) break;
        s.hoursLeft -= 6;
        const pay = scaledPrice(Math.max(s.hourlyWage, jb.baseWage) * 6, econ);
        s.cash += pay;
        s.experience = Math.min(100, s.experience + 2);
        s.dependability = Math.min(100, s.dependability + 2);
      }
    } else if (op === OP_STUDY) {
      if (s.location !== 5 || !qualifiesForDegree(s, arg)) continue;
      const tuition = scaledPrice(45, econ);
      if (s.hoursLeft < 6 || s.cash < tuition) continue;
      s.hoursLeft -= 6;
      s.cash -= tuition;
      const gain = hasWorkingApp(s, 4) ? 2 : 1;
      const next = s.studyCredits[arg] + gain;
      if (next >= CREDITS_PER_DEGREE) {
        s.studyCredits[arg] = CREDITS_PER_DEGREE;
        s.degreesMask |= 1 << arg;
        s.happiness += 8;
      } else {
        s.studyCredits[arg] = next;
        s.happiness += 1;
      }
    } else if (op === OP_APPLY_JOB) {
      if (s.location !== 6 || s.hoursLeft < 4) continue;
      const jb = getJob(arg);
      if (!jb) continue;
      s.hoursLeft -= 4;
      if (qualifiesForJob(s, jb)) {
        const prev = getJob(s.jobId);
        if (!prev || jb.rank > prev.rank) s.happiness += 3;
        s.jobId = arg;
        s.hourlyWage = jb.baseWage;
      }
    } else if (op === OP_ASK_RAISE) {
      if (s.location !== 6 || !s.jobId || s.raiseAskedThisWeek || s.hoursLeft < 4) continue;
      s.hoursLeft -= 4;
      s.raiseAskedThisWeek = 1;
      const jb = getJob(s.jobId);
      if (jb && s.dependability >= 55 && s.hourlyWage < jb.baseWage + 12) {
        s.hourlyWage = Math.min(jb.baseWage + 12, s.hourlyWage + 2);
        s.happiness += 2;
      }
    } else if (op === OP_BUY_FOOD) {
      if (s.hoursLeft < 2) continue;
      const table = {
        '1:0': [15, 1, 2, false, false],
        '1:1': [28, 2, 4, false, false],
        '9:2': [22, 1, 1, false, false],
        '9:3': [38, 2, 2, true, false],
        '9:4': [68, 4, 4, true, true],
      };
      const row = table[`${s.location}:${arg}`];
      if (!row) continue;
      if (row[3] && !hasWorkingApp(s, 0)) continue;
      if (row[4] && !hasWorkingApp(s, 1)) continue;
      const p = scaledPrice(row[0], econ);
      if (s.cash >= p) {
        s.cash -= p;
        s.hoursLeft -= 2;
        s.foodWeeks = Math.min(8, s.foodWeeks + row[1]);
        s.happiness += row[2];
      }
    } else if (op === OP_BUY_CLOTHES) {
      if (s.hoursLeft < 2) continue;
      if (s.location === 2 && arg === 1) {
        const p = scaledPrice(35, econ);
        if (s.cash >= p) {
          s.cash -= p;
          s.hoursLeft -= 2;
          s.clothesTier = Math.max(s.clothesTier, 1);
          s.clothesWeeks = Math.max(s.clothesWeeks, 5);
          s.happiness += 1;
        }
      } else if (s.location === 3) {
        const map = { 1: [45, 6, 1], 2: [95, 7, 3], 3: [195, 8, 6] };
        const spec = map[arg];
        if (!spec) continue;
        const p = scaledPrice(spec[0], econ);
        if (s.cash >= p) {
          s.cash -= p;
          s.hoursLeft -= 2;
          if (arg >= s.clothesTier || s.clothesWeeks === 0) s.clothesTier = arg;
          s.clothesWeeks = Math.max(s.clothesWeeks, spec[1]);
          s.happiness += spec[2];
        }
      }
    } else if (op === OP_BUY_APPLIANCE) {
      const app = APPLIANCES[arg];
      if (!app || s.hoursLeft < 2) continue;
      if (arg === 1 && (s.appliancesMask & 1) === 0) continue;
      let base = 0;
      if (s.location === 4) base = app.basePrice;
      else if (s.location === 2 && (arg === 0 || arg === 2 || arg === 3)) base = Math.floor((app.basePrice * 85) / 100);
      else continue;
      const bit = 1 << arg;
      if ((s.appliancesMask & bit) !== 0 && (s.appliancesBrokenMask & bit) === 0) continue;
      const p = scaledPrice(base, econ);
      if (s.cash >= p) {
        s.cash -= p;
        s.hoursLeft -= 2;
        const first = (s.appliancesMask & bit) === 0;
        s.appliancesMask |= bit;
        s.appliancesBrokenMask &= ~bit;
        s.happiness += first ? app.hap : 2;
      }
    } else if (op === OP_BANK_DEPOSIT) {
      if (s.location !== 8 || s.hoursLeft < 1) continue;
      const amt = arg === 0 ? Math.max(0, s.cash - 40) : Math.min(s.cash, arg * 50);
      if (amt > 0) {
        s.hoursLeft -= 1;
        s.cash -= amt;
        s.savings += amt;
      }
    } else if (op === OP_BANK_WITHDRAW) {
      if (s.location !== 8 || s.hoursLeft < 1) continue;
      const amt = arg === 0 ? s.savings : Math.min(s.savings, arg * 50);
      if (amt > 0) {
        s.hoursLeft -= 1;
        s.savings -= amt;
        s.cash += amt;
      }
    } else if (op === OP_BUY_STOCK) {
      if (s.location !== 8 || s.hoursLeft < 1) continue;
      const sid = (arg >> 4) & 0x0f;
      const qty = Math.max(1, arg & 0x0f);
      if (sid >= 3) continue;
      const cost = game.stockPrices[sid] * qty;
      if (s.cash >= cost) {
        s.hoursLeft -= 1;
        s.cash -= cost;
        s.stocks[sid] += qty;
      }
    } else if (op === OP_SELL_STOCK) {
      if (s.location !== 8 || s.hoursLeft < 1) continue;
      const sid = (arg >> 4) & 0x0f;
      if (sid >= 3 || s.stocks[sid] <= 0) continue;
      const rawQ = arg & 0x0f;
      const qty = rawQ === 0 ? s.stocks[sid] : Math.min(s.stocks[sid], rawQ);
      s.hoursLeft -= 1;
      s.stocks[sid] -= qty;
      s.cash += game.stockPrices[sid] * qty;
    } else if (op === OP_PAY_RENT) {
      if (s.location !== 10 || s.hoursLeft < 2 || s.rentDebt <= 0 || s.cash <= 0) continue;
      const pay = Math.min(s.rentDebt, s.cash);
      s.hoursLeft -= 2;
      s.cash -= pay;
      s.rentDebt -= pay;
      if (s.rentDebt === 0) {
        s.dependability = Math.min(100, s.dependability + 2);
        s.happiness += 2;
      }
    } else if (op === OP_SWITCH_APT) {
      if (s.location !== 10 || s.hoursLeft < 4) continue;
      if (arg === 1 && s.aptTier !== 1) {
        const dep = scaledPrice(340, econ);
        if (s.cash >= dep && s.rentDebt === 0) {
          s.hoursLeft -= 4;
          s.cash -= dep;
          s.aptTier = 1;
          s.happiness += 6;
        }
      }
    } else if (op === OP_RELAX) {
      if (s.location === 0 && arg === 0 && s.hoursLeft >= 6) {
        s.hoursLeft -= 6;
        s.happiness += hasWorkingApp(s, 3) ? 5 : 3;
      } else if (s.location === 10 && arg === 1 && s.hoursLeft >= 6) {
        s.hoursLeft -= 6;
        s.happiness += 4;
      } else if (s.location === 2 && arg === 2 && s.hoursLeft >= 2) {
        const tk = scaledPrice(15, econ);
        if (s.cash >= tk) {
          s.hoursLeft -= 2;
          s.cash -= tk;
          s.happiness += 3;
        }
      }
    } else if (op === OP_REPAIR_PAWN) {
      if (s.location !== 11 || s.hoursLeft < 3) continue;
      const mode = (arg >> 4) & 0x0f;
      const appId = arg & 0x0f;
      const app = APPLIANCES[appId];
      if (!app) continue;
      const bit = 1 << appId;
      if (mode === 0) {
        const c = scaledPrice(55, econ);
        if ((s.appliancesBrokenMask & bit) !== 0 && s.cash >= c) {
          s.hoursLeft -= 3;
          s.cash -= c;
          s.appliancesBrokenMask &= ~bit;
          s.happiness += 2;
        }
      } else if (mode === 1 && (s.appliancesMask & bit) !== 0) {
        const refund = scaledPrice(Math.floor((app.basePrice * 55) / 100), econ);
        s.hoursLeft -= 3;
        s.appliancesMask &= ~bit;
        s.appliancesBrokenMask &= ~bit;
        s.cash += refund;
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Binary Snapshot Decoder (`getGameState` & `listGames`)
// ---------------------------------------------------------------------------

function readI16BE(bytes, off) {
  const u = readU16BE(bytes, off);
  return u >= 0x8000 ? u - 0x10000 : u;
}

function decodeGameSnapshotHex(hexStr) {
  const b = hexToBytes(hexStr);
  if (!b || b.length < 36 || b[0] !== 1) return null;

  const seatCount = b[2];
  const logCount = b[7];
  const trendRaw = b[6];
  const economyTrend = trendRaw > 127 ? trendRaw - 256 : trendRaw;

  const out = {
    phase: b[1],
    seatCount,
    turnSeat: b[3],
    winnerSeat: b[4],
    viewerSeat: b[5],
    economyTrend,
    logCount,
    weekNumber: readU16BE(b, 8),
    economyIndex: readU16BE(b, 10),
    wealthGoal: readU32BE(b, 12),
    hapGoal: readU16BE(b, 16),
    eduGoal: readU16BE(b, 18),
    careerGoal: readU16BE(b, 20),
    stockPrices: [readU16BE(b, 22), readU16BE(b, 24), readU16BE(b, 26)],
    currentBlock: Number(readU64BE(b, 28)),
    seats: [],
    logs: [],
  };

  let pos = 36;
  for (let i = 0; i < seatCount && pos + 92 <= b.length; i++) {
    const eoa = bytesToHex(b.subarray(pos, pos + 20)).toLowerCase();
    const identity = bytesToHex(b.subarray(pos + 20, pos + 40)).toLowerCase();
    out.seats.push({
      seatIdx: i,
      eoa,
      identity,
      isBot: b[pos + 40],
      location: b[pos + 41],
      hoursLeft: b[pos + 42],
      maxHours: b[pos + 43],
      cash: readU32BE(b, pos + 44),
      savings: readU32BE(b, pos + 48),
      rentDebt: readU32BE(b, pos + 52),
      netWealth: readU32BE(b, pos + 56),
      happiness: readU16BE(b, pos + 60),
      dependability: b[pos + 62],
      experience: b[pos + 63],
      jobId: b[pos + 64],
      hourlyWage: readU16BE(b, pos + 65),
      aptTier: b[pos + 67],
      clothesTier: b[pos + 68],
      clothesWeeks: b[pos + 69],
      foodWeeks: b[pos + 70],
      degreesMask: b[pos + 71],
      studyCredits: [b[pos + 72], b[pos + 73], b[pos + 74], b[pos + 75]],
      appliancesMask: b[pos + 76],
      appliancesBrokenMask: b[pos + 77],
      stocks: [readU16BE(b, pos + 78), readU16BE(b, pos + 80), readU16BE(b, pos + 82)],
      goalPcts: [b[pos + 84], b[pos + 85], b[pos + 86], b[pos + 87]],
      lastWeekendEvent: b[pos + 88],
      lastWeekendDelta: readI16BE(b, pos + 89),
      wins: b[pos + 91],
    });
    pos += 92;
  }

  for (let l = 0; l < logCount && pos + 8 <= b.length; l++) {
    out.logs.push({
      week: readU16BE(b, pos),
      seat: b[pos + 2],
      eventId: b[pos + 3],
      delta: readI16BE(b, pos + 4),
      aux: readU16BE(b, pos + 6),
    });
    pos += 8;
  }

  return out;
}

function decodeGamesListHex(hexStr) {
  const b = hexToBytes(hexStr);
  if (!b || b.length < 1) return [];
  const cnt = b[0];
  const list = [];
  let pos = 1;
  for (let i = 0; i < cnt && pos + 40 <= b.length; i++) {
    list.push({
      gameId: bytesToHex(b.subarray(pos, pos + 32)),
      phase: b[pos + 32],
      seatCount: b[pos + 33],
      humanCount: b[pos + 34],
      turnSeat: b[pos + 35],
      weekNumber: readU16BE(b, pos + 36),
      wealthGoal: readU16BE(b, pos + 38) * 100,
    });
    pos += 40;
  }
  return list;
}

// ---------------------------------------------------------------------------
// RPC Sync & Strict Identity-Gated Transactions
// ---------------------------------------------------------------------------

function showToast(msg) {
  const el = document.getElementById('jbToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('is-visible'), 3600);
}

function seatDisplayName(seat) {
  if (!seat) return 'Runner';
  if (seat.isBot > 0) {
    const bp = BOT_PROFILES[seat.isBot] || BOT_PROFILES[1];
    return `${bp.icon} ${bp.name}`;
  }
  const nick = nickCache.get(seat.identity);
  if (nick) return `⚡ @${nick}`;
  return `⚡ ${shortAddr(seat.eoa)}`;
}

async function hydrateNicknames(seats) {
  for (const s of seats) {
    if (s.isBot === 0 && s.identity && s.identity !== ZERO_ADDR && !nickCache.has(s.identity)) {
      nickCache.set(s.identity, '');
      readOnChainIdentityNickname(rpcUrl, s.identity)
        .then((n) => {
          if (n) {
            nickCache.set(s.identity, n);
            renderAll();
          }
        })
        .catch(() => {});
    }
  }
}

async function refreshGameState() {
  if (!contractAddr) {
    renderAll();
    return;
  }
  try {
    const myEoa = wallet.keypair?.address || ZERO_ADDR;
    const [stateHex, listHex] = await Promise.all([
      slxNodeRpc(rpcUrl, 'eth_call', [
        {
          to: contractAddr,
          data: encodeAbi('getGameState(bytes32,address)', [
            ['bytes32', activeGameId],
            ['address', myEoa],
          ]),
        },
        'latest',
      ]),
      slxNodeRpc(rpcUrl, 'eth_call', [
        {
          to: contractAddr,
          data: encodeAbi('listGames()', []),
        },
        'latest',
      ]),
    ]);

    const nextState = stateHex && stateHex !== '0x' ? decodeGameSnapshotHex(stateHex) : null;
    directoryGames = listHex && listHex !== '0x' ? decodeGamesListHex(listHex) : [];

    if (
      nextState &&
      gameState &&
      (nextState.weekNumber !== gameState.weekNumber || nextState.turnSeat !== gameState.turnSeat)
    ) {
      plannedSteps = [];
    }
    gameState = nextState;
    if (gameState?.seats) hydrateNicknames(gameState.seats);
  } catch (_) {
    // Keep last state on transient WS reconnect
  }
  renderAll();
}

async function ensurePlayerIdentity() {
  try {
    const idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl,
      appName: 'Jones in the Blockchain',
    });
    if (!idRec?.identityAddr || idRec.identityAddr === ZERO_ADDR) {
      showToast('⚠ Please deploy your Identity HFS first to play Jones in the Blockchain.');
      return null;
    }
    return idRec;
  } catch (err) {
    showToast(`⚠ Identity HFS required: ${err?.message || err}`);
    return null;
  }
}

async function sendJonesTx(label, calldataHex, extraTargets = [], preverifiedIdRec = null) {
  if (txBusy) return false;
  if (!contractAddr) await bootReadyPromise;
  if (!contractAddr) {
    showToast('⚠ Neo-Sector HFS contract not configured.');
    return false;
  }
  const idRec = preverifiedIdRec || (await ensurePlayerIdentity());
  if (!idRec?.identityAddr || idRec.identityAddr === ZERO_ADDR) return false;

  txBusy = true;
  renderAll();
  try {
    const uniqTargets = Array.from(
      new Set([contractAddr, idRec.identityAddr, ...extraTargets].filter(Boolean).map((a) => a.toLowerCase()))
    );
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: calldataHex,
      gasLimit: 5_000_000n,
      extraTargets: uniqTargets,
      label,
    });
    await refreshGameState();
    return true;
  } catch (err) {
    showToast(`⚠ ${err?.message || err}`);
    await refreshGameState();
    return false;
  } finally {
    txBusy = false;
    renderAll();
  }
}

async function startSoloGameTx(preset = 0, botCount = 1) {
  const idRec = await ensurePlayerIdentity();
  if (!idRec) return;

  const newGid = bytesToHex(concatBytes(utf8ToBytes('JONES_SOLO'), randomBytes(22)));
  activeGameId = newGid;
  plannedSteps = [];
  selectedBuilding = null;

  showToast('⚡ Jacking into Neo-Sector & syncing your 60-hour chrono-watch…');
  const ok = await sendJonesTx(
    'quickStartSolo',
    encodeAbi('quickStartSolo(bytes32,address,uint64,uint64)', [
      ['bytes32', newGid],
      ['address', idRec.identityAddr],
      ['uint64', BigInt(botCount)],
      ['uint64', BigInt(preset)],
    ]),
    [],
    idRec
  );
  if (ok) {
    closeModal('soloModal');
    showToast('🎉 Week 1 Live! Click Job Guild Tower (bottom-right) to grab your first gig!');
  }
}

async function createLobbyGameTx(preset = 1) {
  const idRec = await ensurePlayerIdentity();
  if (!idRec) return;

  const goalsByPreset = {
    0: [2500n, 40n, 20n, 35n],
    1: [5000n, 65n, 30n, 60n],
    2: [10000n, 100n, 40n, 90n],
  };
  const [w, h, e, c] = goalsByPreset[preset] || goalsByPreset[1];
  const newGid = bytesToHex(concatBytes(utf8ToBytes('JONES_PVP_'), randomBytes(22)));
  activeGameId = newGid;
  plannedSteps = [];

  const ok = await sendJonesTx(
    'createGame',
    encodeAbi('createGame(bytes32,address,uint64,uint64,uint64,uint64)', [
      ['bytes32', newGid],
      ['address', idRec.identityAddr],
      ['uint64', w],
      ['uint64', h],
      ['uint64', e],
      ['uint64', c],
    ]),
    [],
    idRec
  );
  if (ok) showToast('🌐 Open Crew Lobby created! Friends can join or you can launch anytime.');
}

async function joinLobbyGameTx(gid) {
  const idRec = await ensurePlayerIdentity();
  if (!idRec) return;
  activeGameId = gid;
  plannedSteps = [];
  const ok = await sendJonesTx(
    'joinGame',
    encodeAbi('joinGame(bytes32,address)', [
      ['bytes32', gid],
      ['address', idRec.identityAddr],
    ]),
    [],
    idRec
  );
  if (ok) {
    closeModal('lobbyModal');
    showToast('🙋 Jacked into Neo-Sector Board!');
  }
}

async function startLobbyGameTx(gid, fillToSeats = 2) {
  const idRec = await ensurePlayerIdentity();
  if (!idRec) return;
  activeGameId = gid;
  const ok = await sendJonesTx(
    'startGame',
    encodeAbi('startGame(bytes32,uint64)', [
      ['bytes32', gid],
      ['uint64', BigInt(fillToSeats)],
    ]),
    [],
    idRec
  );
  if (ok) {
    closeModal('lobbyModal');
    showToast('⚡ Neo-Sector Week 1 has begun!');
  }
}

async function submitWeekPlanTx() {
  const idRec = await ensurePlayerIdentity();
  if (!idRec) return;

  const flatBytes = new Uint8Array(plannedSteps.length * 2);
  for (let i = 0; i < plannedSteps.length; i++) {
    flatBytes[i * 2] = plannedSteps[i].op & 0xff;
    flatBytes[i * 2 + 1] = plannedSteps[i].arg & 0xff;
  }

  showToast('🌙 Committing 60h Week Plan & rolling Rival Jones’s turn…');
  const ok = await sendJonesTx(
    'submitWeekPlan',
    encodeAbi('submitWeekPlan(bytes32,bytes)', [
      ['bytes32', activeGameId],
      ['bytes', flatBytes],
    ]),
    [],
    idRec
  );
  if (ok) {
    plannedSteps = [];
    selectedBuilding = null;
  }
}

async function rematchTx() {
  const idRec = await ensurePlayerIdentity();
  if (!idRec) return;
  plannedSteps = [];
  await sendJonesTx(
    'rematchGame',
    encodeAbi('rematchGame(bytes32,uint64)', [
      ['bytes32', activeGameId],
      ['uint64', BigInt(selectedPreset)],
    ]),
    [],
    idRec
  );
}

// ---------------------------------------------------------------------------
// Local Week Step Queueing (Auto-Commute + Action at 0ms!)
// ---------------------------------------------------------------------------

function getActivePreview() {
  if (!gameState || gameState.viewerSeat === 0xff) return { baseMe: null, simMe: null, isMyTurn: false };
  const baseMe = gameState.seats[gameState.viewerSeat] || null;
  const isMyTurn =
    gameState.phase === PHASE_ACTIVE &&
    baseMe !== null &&
    gameState.turnSeat === gameState.viewerSeat;
  const simMe = baseMe ? simulateLocalPlan(baseMe, gameState, isMyTurn ? plannedSteps : []) : null;
  return { baseMe, simMe, isMyTurn };
}

function queueBuildingAction(targetBuilding, op, arg, label) {
  const { baseMe, simMe, isMyTurn } = getActivePreview();
  if (!isMyTurn || !simMe || txBusy) {
    showToast('⏱️ Launch a run vs. Jones or wait for your turn to queue ops!');
    return;
  }

  const nextSteps = [...plannedSteps];
  if (simMe.location !== targetBuilding) {
    if (nextSteps.length + 1 > MAX_PLAN_STEPS) {
      showToast('⚠ Weekly op limit (32 steps) reached—click Commit Week!');
      return;
    }
    const moveIcon = hasWorkingApp(simMe, 5) ? '🛴' : '🚶';
    nextSteps.push({
      op: OP_MOVE,
      arg: targetBuilding,
      label: `${moveIcon}→${BUILDINGS[targetBuilding].icon}`,
    });
  }

  if (op !== OP_MOVE) {
    if (nextSteps.length + 1 > MAX_PLAN_STEPS) {
      showToast('⚠ Weekly op limit (32 steps) reached—click Commit Week!');
      return;
    }
    nextSteps.push({ op, arg, label });
  }

  const afterSim = simulateLocalPlan(baseMe, gameState, nextSteps);
  if (
    afterSim.hoursLeft === simMe.hoursLeft &&
    afterSim.cash === simMe.cash &&
    afterSim.savings === simMe.savings &&
    afterSim.location === simMe.location &&
    afterSim.jobId === simMe.jobId &&
    afterSim.happiness === simMe.happiness
  ) {
    showToast('⚠ Not enough chrono-hours, cash, or prerequisites for that op!');
    return;
  }

  plannedSteps = nextSteps;
  renderAll();
}

// ---------------------------------------------------------------------------
// Rendering Engine: Full Illustrated Map + Overlaid Venue Hitboxes + Holo-Terminal
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAll() {
  renderTopRibbon();
  renderVenueHotspots();
  renderCenterHoloLayer();
  renderPlannerBar();
  renderSidebar();
  renderLobbyDirectory();
}

function renderTopRibbon() {
  const wkEl = document.getElementById('hudWeek');
  const econEl = document.getElementById('hudEconomyChip');
  const turnEl = document.getElementById('hudTurnBadge');
  if (!gameState) {
    if (wkEl) wkEl.textContent = '1';
    if (econEl) econEl.textContent = '🌐 Neo-Sector Ready';
    if (turnEl) turnEl.textContent = contractAddr ? 'Click ⚡ Play vs. Jones to jack in!' : 'Syncing…';
    return;
  }

  wkEl.textContent = String(gameState.weekNumber);
  const idx = gameState.economyIndex;
  const arrow = gameState.economyTrend > 0 ? '↗' : gameState.economyTrend < 0 ? '↘' : '→';
  const pulse = idx >= 108 ? '🔥 Bull Surge' : idx <= 92 ? '⚡ Discount Dip' : '🌐 Cyber-Index';
  econEl.textContent = `${pulse} ${idx}% ${arrow}`;

  if (gameState.phase === PHASE_LOBBY) {
    turnEl.textContent = `🌐 Crew Lobby (${gameState.seatCount}/4 Runners)`;
    jbGuide?.updateCoach({
      pill: '🌐 CREW LOBBY',
      tone: 'action',
      html: 'Share this Neo-Sector board with friends/family, or click <strong>⚡ Start Now</strong> to fill empty seats with Rival Jones!',
    });
  } else if (gameState.phase === PHASE_FINISHED) {
    const winSeat = gameState.seats[gameState.winnerSeat];
    turnEl.textContent = `🏆 Winner: ${seatDisplayName(winSeat)}!`;
    jbGuide?.updateCoach({
      pill: '🏆 SECTOR LEGEND!',
      tone: 'action',
      html: `<strong>${escapeHtml(seatDisplayName(winSeat))}</strong> hit 100% across Wealth, Vibe, Neural Education &amp; Career!`,
      actionLabel: '🔄 Rematch',
      onAction: () => rematchTx(),
    });
  } else if (gameState.viewerSeat === gameState.turnSeat) {
    turnEl.textContent = txBusy ? '⛓️ Sealing Week on Subnet 1…' : '🟢 Your 60-Hour Chrono-Week!';
    const { simMe } = getActivePreview();
    if (simMe && simMe.jobId === 0) {
      jbGuide?.updateCoach({
        pill: '💼 OP #1',
        tone: 'action',
        html: 'Click <strong>💼 Job Guild Tower</strong> (bottom-right on map) to land your first gig, work 6h shifts, and grab a Synth-Burger!',
        actionLabel: '💼 Open Job Guild',
        onAction: () => {
          selectedBuilding = 6;
          renderAll();
        },
      });
    } else if (simMe && simMe.foodWeeks === 0) {
      jbGuide?.updateCoach({
        pill: '🍔 RATIONS ALERT',
        tone: 'urgent',
        html: `You have <strong>0 weeks of food</strong>! Click <strong>🍔 Byte-Burgers</strong> (top-left-center) or <strong>🍏 BioFresh Dome</strong> before committing your week!`,
        actionLabel: '🍔 Byte-Burgers',
        onAction: () => {
          selectedBuilding = 1;
          renderAll();
        },
      });
    } else if (simMe) {
      jbGuide?.updateCoach({
        pill: `⏱️ ${simMe.hoursLeft}H LEFT`,
        tone: 'action',
        html: `Click venues on the neon map to work 6h shifts, study at <strong>🎓 Haltproof Cyber-U.</strong>, vault cash at <strong>🏦 Cryo-Bank</strong>, then commit your week!`,
        actionLabel: '🌙 Commit Week',
        onAction: () => submitWeekPlanTx(),
      });
    }
  } else if (gameState.viewerSeat === 0xff) {
    turnEl.textContent = '👀 Live Neo-Sector Feed — Click ⚡ Play vs. Jones!';
    jbGuide?.updateCoach({
      pill: '⚡ NEO-SECTOR LIVE',
      tone: 'action',
      html: 'Click any glowing venue directly on the cyberpunk city map to explore—or click <strong>⚡ Play vs. Jones</strong> to start your own run at $0.00 gas!',
      actionLabel: '⚡ Play vs. Jones',
      onAction: () => openModal('soloModal'),
    });
  } else {
    const active = gameState.seats[gameState.turnSeat];
    turnEl.textContent = `⏱️ Waiting on ${seatDisplayName(active)}`;
    jbGuide?.updateCoach({
      pill: '🌐 CREW TURN',
      tone: 'info',
      html: `Waiting for <strong>${escapeHtml(seatDisplayName(active))}</strong> to commit Week ${gameState.weekNumber}.`,
    });
  }
}

function renderVenueHotspots() {
  const layer = document.getElementById('venueHotspotsLayer');
  if (!layer) return;

  const { simMe, isMyTurn } = getActivePreview();
  const curLoc = simMe ? simMe.location : 0;
  const hasScooter = simMe ? hasWorkingApp(simMe, 5) : false;
  const myJob = simMe ? getJob(simMe.jobId) : null;

  layer.innerHTML = BUILDINGS.map((b) => {
    const dist = ringDistance(curLoc, b.id);
    const hrs = dist * (hasScooter ? 1 : 2);
    const isHere = Boolean(simMe && curLoc === b.id);
    const isSel = selectedBuilding === b.id;

    const pawnsHtml = [];
    if (gameState?.seats) {
      for (const s of gameState.seats) {
        const sLoc =
          isMyTurn && s.seatIdx === gameState.viewerSeat && simMe ? simMe.location : s.location;
        if (sLoc === b.id) {
          if (s.seatIdx === gameState.viewerSeat) {
            pawnsHtml.push(`<span class="jb-pawn">⚡ YOU</span>`);
          } else {
            const label = s.isBot > 0 ? BOT_PROFILES[s.isBot]?.name || 'Bot' : shortAddr(s.eoa);
            pawnsHtml.push(`<span class="jb-pawn rival">${escapeHtml(label)}</span>`);
          }
        }
      }
    }

    const travelBadge = isHere
      ? `<span class="jb-hotspot-travel here">📍 HERE</span>`
      : `<span class="jb-hotspot-travel mono">${hasScooter ? '🛴' : '🚶'}${hrs}h</span>`;

    const jobBadge =
      myJob && myJob.workplace === b.id ? `<span class="jb-work-tag">💼 WORK</span>` : '';

    return `
      <button
        type="button"
        class="jb-venue-hotspot ${isSel ? 'is-selected' : ''} ${isHere ? 'is-here' : ''}"
        data-building-id="${b.id}"
        title="${escapeHtml(b.name)} — ${escapeHtml(b.sub)}"
        style="left:${b.box.left}%;top:${b.box.top}%;width:${b.box.width}%;height:${b.box.height}%;--v-neon:${b.neon};--v-border:${b.neon}99;--v-glow:${b.glow};">
        <div class="jb-hotspot-top">
          <div class="jb-pawns-row">${pawnsHtml.join('')}</div>
          <div class="jb-hotspot-badges">
            ${jobBadge}
            ${travelBadge}
          </div>
        </div>
        <div class="jb-hotspot-plate">
          <span class="jb-hotspot-title">${b.icon} ${escapeHtml(b.name)}</span>
          <span class="jb-hotspot-cta mono">${isSel ? '✕' : '▸'}</span>
        </div>
      </button>
    `;
  }).join('');
}

function buildInteriorActions(bId, simMe, econ, isMyTurn) {
  const actions = [];
  const disabledBase = !isMyTurn || !simMe || txBusy;
  const curLoc = simMe ? simMe.location : 0;
  const hasScooter = simMe ? hasWorkingApp(simMe, 5) : false;
  const walkHrs = curLoc === bId ? 0 : ringDistance(curLoc, bId) * (hasScooter ? 1 : 2);
  const walkNote = walkHrs > 0 ? ` (+${walkHrs}h transit)` : '';

  const myJob = simMe ? getJob(simMe.jobId) : null;
  if (myJob && myJob.workplace === bId) {
    const shiftPay = scaledPrice(Math.max(simMe.hourlyWage, myJob.baseWage) * 6, econ);
    const dressOk = effectiveClothesTier(simMe) >= myJob.dress;
    const can1 = !disabledBase && dressOk && simMe.hoursLeft >= walkHrs + 6;
    const can3 = !disabledBase && dressOk && simMe.hoursLeft >= walkHrs + 18;
    actions.push({
      op: OP_WORK,
      arg: 1,
      label: `💼 Work 1 Shift (${myJob.title})`,
      cost: `+$${shiftPay} · 6h${walkNote}`,
      desc: dressOk
        ? `+2 Exp, +2 Dependability ($${Math.max(simMe.hourlyWage, myJob.baseWage)}/hr)`
        : `⚠ Requires ${DRESS_NAMES[myJob.dress]} from ChromaThreads!`,
      disabled: !can1,
    });
    actions.push({
      op: OP_WORK,
      arg: 3,
      label: `⚡ Work 3 Shifts (18h Grind)`,
      cost: `+$${shiftPay * 3} · 18h${walkNote}`,
      desc: `Triple shift payout! +6 Exp, +6 Dependability.`,
      disabled: !can3,
    });
  }

  if (bId === 0) {
    const tvBonus = simMe && hasWorkingApp(simMe, 3);
    actions.push({
      op: OP_RELAX,
      arg: 0,
      label: tvBonus ? '📺 Stream Holo-Stereo Wall & Chill' : '🛌 Cryo-Pod Power Nap',
      cost: `$0 · 6h${walkNote}`,
      desc: tvBonus ? 'Recharges Vibe by +5!' : 'Recharges Vibe by +3 (get a Holo-Stereo Wall for +5!).',
      disabled: disabledBase || simMe.hoursLeft < walkHrs + 6,
    });
  } else if (bId === 1) {
    const pMeal = scaledPrice(15, econ);
    const pShake = scaledPrice(28, econ);
    actions.push({
      op: OP_BUY_FOOD,
      arg: 0,
      label: '🍔 Neon Synth-Burger Combo',
      cost: `$${pMeal} · 2h${walkNote}`,
      desc: '+1 Week Food & +2 Vibe (no Cryo-Fridge needed!).',
      disabled: disabledBase || simMe.cash < pMeal || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_FOOD,
      arg: 1,
      label: '🥤 Double Cyber-Burger & Pink Shake',
      cost: `$${pShake} · 2h${walkNote}`,
      desc: '+2 Weeks Food & +4 Vibe! Diner favorite!',
      disabled: disabledBase || simMe.cash < pShake || simMe.hoursLeft < walkHrs + 2,
    });
  } else if (bId === 2) {
    const pClothes = scaledPrice(35, econ);
    const pRaffle = scaledPrice(15, econ);
    actions.push({
      op: OP_RELAX,
      arg: 2,
      label: '🎟️ Sector Cyber-Lotto & Arcade',
      cost: `$${pRaffle} · 2h${walkNote}`,
      desc: '+3 Vibe + 1-in-8 shot at an instant $200 Jackpot!',
      disabled: disabledBase || simMe.cash < pRaffle || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_CLOTHES,
      arg: 1,
      label: '👕 Off-Rack Neon Tee',
      cost: `$${pClothes} · 2h${walkNote}`,
      desc: 'Refreshes Tier-1 Streetwear to 5 weeks +1 Vibe.',
      disabled: disabledBase || simMe.cash < pClothes || simMe.hoursLeft < walkHrs + 2,
    });
    for (const appId of [0, 2, 3]) {
      const app = APPLIANCES[appId];
      const discPrice = scaledPrice(Math.floor((app.basePrice * 85) / 100), econ);
      const ownedOk = simMe && hasWorkingApp(simMe, appId);
      actions.push({
        op: OP_BUY_APPLIANCE,
        arg: appId,
        label: `${app.icon} Refurb ${app.name} (15% Off)`,
        cost: ownedOk ? 'OWNED ✓' : `$${discPrice} · 2h${walkNote}`,
        desc: app.perk,
        disabled: disabledBase || ownedOk || simMe.cash < discPrice || simMe.hoursLeft < walkHrs + 2,
      });
    }
  } else if (bId === 3) {
    const outfits = [
      { tier: 1, icon: '👕', name: 'Neon Street Hoodie', base: 45, wks: 6, hap: 1 },
      { tier: 2, icon: '🧥', name: 'Smart LED Career Blazer', base: 95, wks: 7, hap: 3 },
      { tier: 3, icon: '🎩', name: 'Tailored Exec Chrome Suit', base: 195, wks: 8, hap: 6 },
    ];
    for (const o of outfits) {
      const p = scaledPrice(o.base, econ);
      actions.push({
        op: OP_BUY_CLOTHES,
        arg: o.tier,
        label: `${o.icon} ${o.name} (Tier ${o.tier})`,
        cost: `$${p} · 2h${walkNote}`,
        desc: `Lasts ${o.wks} weeks · +${o.hap} Vibe.`,
        disabled: disabledBase || simMe.cash < p || simMe.hoursLeft < walkHrs + 2,
      });
    }
  } else if (bId === 4) {
    for (const app of APPLIANCES) {
      const p = scaledPrice(app.basePrice, econ);
      const owned = simMe && hasWorkingApp(simMe, app.id);
      const needsFridge = app.id === 1 && simMe && (simMe.appliancesMask & 1) === 0;
      actions.push({
        op: OP_BUY_APPLIANCE,
        arg: app.id,
        label: `${app.icon} ${app.name}`,
        cost: owned ? 'OWNED ✓' : `$${p} · 2h${walkNote}`,
        desc: needsFridge ? '⚠ Requires Cryo-Fridge first!' : `${app.perk} (+${app.hap} Vibe)`,
        disabled: disabledBase || owned || needsFridge || simMe.cash < p || simMe.hoursLeft < walkHrs + 2,
      });
    }
  } else if (bId === 5) {
    const tuition = scaledPrice(45, econ);
    const hasPc = simMe && hasWorkingApp(simMe, 4);
    for (const deg of DEGREES) {
      const grad = simMe && (simMe.degreesMask & (1 << deg.id)) !== 0;
      const creds = simMe ? simMe.studyCredits[deg.id] : 0;
      const qual = simMe && qualifiesForDegree(simMe, deg.id);
      actions.push({
        op: OP_STUDY,
        arg: deg.id,
        label: `${deg.icon} ${deg.name} (${grad ? '10/10 🎓' : `${creds}/10`})`,
        cost: grad ? 'CERTIFIED ✓' : `$${tuition} · 6h${walkNote}`,
        desc: grad
          ? `Completed! Unlocks: ${deg.unlocks}`
          : !qual
          ? `🔒 ${deg.reqText}`
          : `+${hasPc ? 2 : 1} Neural Credit${hasPc ? 's (💻 Cyberdeck 2x!)' : ''} · Unlocks: ${deg.unlocks}`,
        disabled: disabledBase || !qual || simMe.cash < tuition || simMe.hoursLeft < walkHrs + 6,
      });
    }
  } else if (bId === 6) {
    if (simMe && simMe.jobId > 0) {
      actions.push({
        op: OP_ASK_RAISE,
        arg: 0,
        label: '📈 Negotiate +$2/hr Guild Raise',
        cost: `4h${walkNote}`,
        desc:
          simMe.dependability >= 55
            ? 'Dependability 55+ verified — approves +$2/hr & +2 Vibe!'
            : `Requires 55+ Dependability (currently ${simMe.dependability}) to approve.`,
        disabled:
          disabledBase ||
          simMe.raiseAskedThisWeek > 0 ||
          simMe.dependability < 55 ||
          simMe.hoursLeft < walkHrs + 4,
      });
    }
    for (const jb of JOBS) {
      const isCur = simMe && simMe.jobId === jb.id;
      const qual = simMe && qualifiesForJob(simMe, jb);
      const wpName = BUILDINGS[jb.workplace].name;
      actions.push({
        op: OP_APPLY_JOB,
        arg: jb.id,
        label: `${isCur ? '✅ ' : qual ? '🟢 ' : '🔒 '}${jb.title} ($${jb.baseWage}/hr)`,
        cost: isCur ? 'ACTIVE GIG' : `4h${walkNote}`,
        desc: `@ ${wpName} · Req: Exp ${jb.reqExp}, Dep ${jb.reqDep}, ${DRESS_NAMES[jb.dress]}`,
        disabled: disabledBase || isCur || !qual || simMe.hoursLeft < walkHrs + 4,
      });
    }
  } else if (bId === 7) {
    if (!myJob || myJob.workplace !== 7) {
      actions.push({
        op: OP_MOVE,
        arg: 6,
        label: '💼 Open Job Guild Tower to Apply Here',
        cost: 'Jump',
        desc: 'SLX Foundry roles pay $10–$38/hr (Reactor Sweeper, Mecha Eng., Chief Wasm Architect)!',
        disabled: false,
      });
    }
  } else if (bId === 8) {
    actions.push({
      op: OP_BANK_DEPOSIT,
      arg: 2,
      label: '🔐 Vault $100 into Cryo-Savings (2%/wk)',
      cost: `1h${walkNote}`,
      desc: 'Compounds +2% every weekend & 100% immune to Glitch-Sam!',
      disabled: disabledBase || simMe.cash < 100 || simMe.hoursLeft < walkHrs + 1,
    });
    actions.push({
      op: OP_BANK_DEPOSIT,
      arg: 0,
      label: '🛡️ Sweep All Spare Cash (Keep $40)',
      cost: `1h${walkNote}`,
      desc: 'Locks all pocket cash above $40 inside the laser-grid vault.',
      disabled: disabledBase || simMe.cash <= 40 || simMe.hoursLeft < walkHrs + 1,
    });
    actions.push({
      op: OP_BANK_WITHDRAW,
      arg: 2,
      label: '💵 Withdraw $100 from Cryo-Vault',
      cost: `1h${walkNote}`,
      desc: `Vault Balance: $${simMe ? simMe.savings : 0}`,
      disabled: disabledBase || simMe.savings <= 0 || simMe.hoursLeft < walkHrs + 1,
    });
    for (const st of STOCK_NAMES) {
      const price = gameState ? gameState.stockPrices[st.id] : 100;
      const owned = simMe ? simMe.stocks[st.id] : 0;
      actions.push({
        op: OP_BUY_STOCK,
        arg: (st.id << 4) | 1,
        label: `📈 Buy 1 ${st.sym} (Own: ${owned})`,
        cost: `$${price} · 1h${walkNote}`,
        desc: `${st.name} · ${st.risk}`,
        disabled: disabledBase || simMe.cash < price || simMe.hoursLeft < walkHrs + 1,
      });
      if (owned > 0) {
        actions.push({
          op: OP_SELL_STOCK,
          arg: (st.id << 4) | 0,
          label: `💰 Sell All ${owned} ${st.sym}`,
          cost: `+$${price * owned} · 1h${walkNote}`,
          desc: `Liquidates ${st.sym} shares to pocket cash.`,
          disabled: disabledBase || simMe.hoursLeft < walkHrs + 1,
        });
      }
    }
  } else if (bId === 9) {
    const p1 = scaledPrice(22, econ);
    const p2 = scaledPrice(38, econ);
    const p4 = scaledPrice(68, econ);
    const hasFridge = simMe && hasWorkingApp(simMe, 0);
    const hasFreezer = simMe && hasWorkingApp(simMe, 1);
    actions.push({
      op: OP_BUY_FOOD,
      arg: 2,
      label: '🥖 1-Week Hydro-Harvest Basket',
      cost: `$${p1} · 2h${walkNote}`,
      desc: '+1 Week Food & +1 Vibe.',
      disabled: disabledBase || simMe.cash < p1 || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_FOOD,
      arg: 3,
      label: '🍏 2-Week Cryo-Fridge Crate',
      cost: `$${p2} · 2h${walkNote}`,
      desc: hasFridge ? '+2 Weeks Food & +2 Vibe!' : '🔒 Requires working Cryo-Fridge!',
      disabled: disabledBase || !hasFridge || simMe.cash < p2 || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_FOOD,
      arg: 4,
      label: '❄️ 4-Week Sub-Zero Bulk Chest',
      cost: `$${p4} · 2h${walkNote}`,
      desc:
        hasFridge && hasFreezer
          ? '+4 Weeks Food & +4 Vibe! Massive chrono-saver!'
          : '🔒 Requires Cryo-Fridge + Sub-Zero Freezer!',
      disabled:
        disabledBase || !hasFridge || !hasFreezer || simMe.cash < p4 || simMe.hoursLeft < walkHrs + 2,
    });
  } else if (bId === 10) {
    actions.push({
      op: OP_RELAX,
      arg: 1,
      label: '🌸 Neon Sakura Park Synth-Concert',
      cost: `FREE · 6h${walkNote}`,
      desc: '+4 Vibe for $0! Chill beneath the holographic cherry blossoms.',
      disabled: disabledBase || simMe.hoursLeft < walkHrs + 6,
    });
    if (simMe && simMe.rentDebt > 0) {
      actions.push({
        op: OP_PAY_RENT,
        arg: 0,
        label: `🧾 Settle Hab-Rent Arrears ($${simMe.rentDebt})`,
        cost: `2h${walkNote}`,
        desc: 'Clears hab-lease debt (+2 Dependability, +2 Vibe).',
        disabled: disabledBase || simMe.cash <= 0 || simMe.hoursLeft < walkHrs + 2,
      });
    }
    const condoDep = scaledPrice(340, econ);
    const inCondo = simMe && simMe.aptTier === 1;
    actions.push({
      op: OP_SWITCH_APT,
      arg: 1,
      label: inCondo ? '🏢 LeSecurity Penthouse Active ✓' : '🏢 Upgrade to LeSecurity Spire',
      cost: inCondo ? 'ACTIVE' : `$${condoDep} · 4h${walkNote}`,
      desc: '100% Glitch-Sam proof + grants +2 Penthouse Vibe EVERY weekend!',
      disabled:
        disabledBase || inCondo || simMe.rentDebt > 0 || simMe.cash < condoDep || simMe.hoursLeft < walkHrs + 4,
    });
  } else if (bId === 11) {
    for (const app of APPLIANCES) {
      const bit = 1 << app.id;
      const owned = simMe && (simMe.appliancesMask & bit) !== 0;
      const broken = simMe && (simMe.appliancesBrokenMask & bit) !== 0;
      if (broken) {
        const repCost = scaledPrice(55, econ);
        actions.push({
          op: OP_REPAIR_PAWN,
          arg: app.id,
          label: `🔧 Re-Solder ${app.name}`,
          cost: `$${repCost} · 3h${walkNote}`,
          desc: 'Restores full hardware perk & +2 Vibe.',
          disabled: disabledBase || simMe.cash < repCost || simMe.hoursLeft < walkHrs + 3,
        });
      } else if (owned) {
        const refund = scaledPrice(Math.floor((app.basePrice * 55) / 100), econ);
        actions.push({
          op: OP_REPAIR_PAWN,
          arg: (1 << 4) | app.id,
          label: `🏷️ Pawn ${app.name} for Instant Creds`,
          cost: `+$${refund} · 3h${walkNote}`,
          desc: 'Emergency liquidity if you need fast cash.',
          disabled: disabledBase || simMe.hoursLeft < walkHrs + 3,
        });
      }
    }
    if (actions.length === 0) {
      actions.push({
        op: OP_MOVE,
        arg: 4,
        label: '🤖 Browse Cyberdecks at Socket City Lab',
        cost: 'Jump',
        desc: 'All your cyber-gear is running at 100%—check out Socket City!',
        disabled: false,
      });
    }
  }

  return actions;
}

function renderCenterHoloLayer() {
  const stage = document.getElementById('centerHoloLayer');
  if (!stage) return;

  const { simMe, isMyTurn } = getActivePreview();
  const econ = gameState?.economyIndex || 100;

  // 1) Active Venue Cyberpunk Holo-Terminal Overlay (when a venue hitbox 0..11 is clicked!)
  if (selectedBuilding !== null && BUILDINGS[selectedBuilding]) {
    const b = BUILDINGS[selectedBuilding];
    const actions = buildInteriorActions(selectedBuilding, simMe, econ, isMyTurn);
    const curLoc = simMe ? simMe.location : 0;
    const hasScooter = simMe ? hasWorkingApp(simMe, 5) : false;
    const walkHrs = curLoc === selectedBuilding ? 0 : ringDistance(curLoc, selectedBuilding) * (hasScooter ? 1 : 2);

    stage.innerHTML = `
      <div class="jb-holo-terminal" style="--v-neon:${b.neon};--v-glow:${b.glow};">
        <div class="jb-shop-hdr">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span style="font-size:1.3rem;">${b.icon}</span>
            <div style="min-width:0;">
              <div style="font-weight:900;font-size:0.88rem;color:${b.neon};letter-spacing:0.02em;">${escapeHtml(b.name)}</div>
              <div style="font-size:0.68rem;color:#94a3b8;">${escapeHtml(b.keeperName)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
            ${
              isMyTurn && walkHrs > 0
                ? `<button type="button" class="jb-btn jb-btn-xs jb-btn-cyan" data-q-op="${OP_MOVE}" data-q-arg="${selectedBuilding}" data-q-b="${selectedBuilding}" data-q-lbl="${hasScooter ? '🛴' : '🚶'}→${b.icon}">${hasScooter ? '🛴' : '🚶'} Go Here (${walkHrs}h)</button>`
                : ''
            }
            <button type="button" class="jb-btn jb-btn-xs" id="btnBackToPlaza">✕ Map</button>
          </div>
        </div>

        <div class="jb-shop-keeper-row">
          <img src="${b.art}" alt="${escapeHtml(b.keeperName)}" class="jb-keeper-img" />
          <div class="jb-speech-bubble">${escapeHtml(b.quote)}</div>
        </div>

        <div class="jb-shop-actions">
          ${actions
            .map(
              (a) => `
            <button type="button" class="jb-act-btn"
              data-q-b="${selectedBuilding}"
              data-q-op="${a.op}"
              data-q-arg="${a.arg}"
              data-q-lbl="${escapeHtml(a.label.slice(0, 18))}"
              ${a.disabled ? 'disabled' : ''}>
              <div class="jb-act-top">
                <span>${escapeHtml(a.label)}</span>
                <span class="jb-act-cost">${escapeHtml(a.cost)}</span>
              </div>
              <div class="jb-act-desc">${escapeHtml(a.desc)}</div>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `;
    return;
  }

  // 2) Victory Celebration Dock
  if (gameState && gameState.phase === PHASE_FINISHED) {
    const winner = gameState.seats[gameState.winnerSeat];
    stage.innerHTML = `
      <div class="jb-plaza-dock is-banner">
        <div style="font-size:0.9rem;font-weight:900;color:#fde047;">
          🏆 ${escapeHtml(seatDisplayName(winner))} Maxed All 4 Pillars in Week ${gameState.weekNumber}!
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;">
          <button type="button" class="jb-btn jb-btn-cyber jb-btn-xs" id="btnStageRematch">🔄 Rematch Board</button>
          <button type="button" class="jb-btn jb-btn-cyan jb-btn-xs" id="btnStageNewSolo">⚡ New Run vs. Jones</button>
        </div>
      </div>
    `;
    return;
  }

  // 3) Open Crew/Family Lobby Dock
  if (gameState && gameState.phase === PHASE_LOBBY) {
    const amHost = gameState.viewerSeat === 0;
    const amSeated = gameState.viewerSeat !== 0xff;
    stage.innerHTML = `
      <div class="jb-plaza-dock is-banner">
        <div style="font-size:0.84rem;font-weight:800;color:#67e8f9;">
          🌐 Neo-Sector Crew Lobby (${gameState.seatCount}/4 Runners) · Goal $${gameState.wealthGoal.toLocaleString()}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${
            !amSeated
              ? `<button type="button" class="jb-btn jb-btn-emerald jb-btn-xs" id="btnStageJoinCurrent">🙋 Join Board</button>`
              : ''
          }
          ${
            amHost
              ? `<button type="button" class="jb-btn jb-btn-cyber jb-btn-xs" id="btnStageStartWithJones">⚡ Start (Fill w/ Jones)</button>`
              : ''
          }
          ${
            amHost && gameState.seatCount >= 2
              ? `<button type="button" class="jb-btn jb-btn-emerald jb-btn-xs" id="btnStageStartHumansOnly">👥 Start ${gameState.seatCount}P PvP</button>`
              : ''
          }
          <button type="button" class="jb-btn jb-btn-xs" id="btnStageNewSolo">🕶️ Solo vs. Jones</button>
        </div>
      </div>
    `;
    return;
  }

  // 4) Default Compact Courtyard HUD Dock (leaves the Holographic Clocktower Fountain unobstructed!)
  if (!gameState || gameState.viewerSeat === 0xff) {
    stage.innerHTML = `
      <div class="jb-plaza-dock">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span style="font-size:0.78rem;font-weight:800;color:#67e8f9;">⚡ Click any neon building on the map—or jack in!</span>
          <div style="display:flex;gap:6px;">
            <button type="button" class="jb-btn jb-btn-cyber jb-btn-xs" id="btnStageQuickPlay">⚡ Quick Run vs. Jones</button>
            <button type="button" class="jb-btn jb-btn-cyan jb-btn-xs" id="btnStageChoosePace">⚙️ Pace</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  stage.innerHTML = `
    <div class="jb-plaza-dock">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:0.74rem;">
        <span style="font-weight:800;color:#a5f3fc;">
          ⚡ Wk ${gameState.weekNumber} · 💵 $${simMe.cash.toLocaleString()} · ${simMe.foodWeeks > 0 ? `🍔 ${simMe.foodWeeks}wk ✓` : '⚠ Need Food!'}
        </span>
        <span style="color:#cbd5e1;font-size:0.68rem;">Click any glowing building hitbox to queue ops!</span>
      </div>
    </div>
  `;
}

function renderPlannerBar() {
  const { simMe, isMyTurn } = getActivePreview();
  const hrsLeft = simMe ? simMe.hoursLeft : 60;
  const hrsMax = simMe ? simMe.maxHours : 60;

  document.getElementById('lblHoursLeft').textContent = String(hrsLeft);
  document.getElementById('lblHoursMax').textContent = String(hrsMax);
  const pct = Math.max(0, Math.min(100, Math.round((hrsLeft / Math.max(1, hrsMax)) * 100)));
  document.getElementById('barHoursFill').style.width = `${pct}%`;

  const sumEl = document.getElementById('lblPlanSummary');
  const pillsEl = document.getElementById('planPillsRow');
  const undoBtn = document.getElementById('btnUndoStep');
  const resetBtn = document.getElementById('btnResetWeek');
  const finishBtn = document.getElementById('btnFinishWeek');

  if (plannedSteps.length === 0) {
    sumEl.textContent = isMyTurn
      ? 'Queued Ops (0): Click any neon venue directly on the city map above to plan your 60-hour week!'
      : 'Chrono-Planner: Jack into a Solo or Crew board to activate your 60-hour weekly budget.';
    pillsEl.innerHTML = '';
  } else {
    const foodWarn = simMe && simMe.foodWeeks === 0 ? ' · ⚠ Grab rations!' : ' · 🍔 Rations OK ✓';
    sumEl.textContent = `Queued Ops (${plannedSteps.length}/${MAX_PLAN_STEPS})${foodWarn}`;
    pillsEl.innerHTML = plannedSteps
      .map((s, idx) => `<span class="jb-step-pill">${idx + 1}. ${escapeHtml(s.label)}</span>`)
      .join('');
  }

  undoBtn.disabled = !isMyTurn || txBusy || plannedSteps.length === 0;
  resetBtn.disabled = !isMyTurn || txBusy || plannedSteps.length === 0;
  finishBtn.disabled = !isMyTurn || txBusy;
  finishBtn.textContent = txBusy
    ? '⛓️ Sealing Week…'
    : `🌙 Commit Week ${gameState ? gameState.weekNumber : 1} & Roll Feed!`;
}

function renderSidebar() {
  const { simMe } = getActivePreview();
  const goalsMount = document.getElementById('myGoalsMount');
  const statsMount = document.getElementById('myStatsMount');
  const rivalsMount = document.getElementById('rivalsMount');
  const gazetteMount = document.getElementById('gazetteMount');

  if (!gameState || !simMe) {
    document.getElementById('lblNetWealth').textContent = '$240 Start';
    goalsMount.innerHTML = `<div style="font-size:0.76rem;color:#94a3b8;">Click <strong>⚡ Play vs. Jones</strong> above to deploy your Identity HFS &amp; track your 4 Cyberpunk Pillars!</div>`;
    statsMount.innerHTML = '';
  } else {
    const calc = computeGoalPcts(simMe, gameState);
    document.getElementById('lblNetWealth').textContent = `$${calc.netWealth.toLocaleString()} Net`;

    const pillars = [
      { label: `💰 Wealth ($${calc.netWealth.toLocaleString()} / $${gameState.wealthGoal.toLocaleString()})`, pct: calc.pcts[0], color: 'linear-gradient(90deg,#f59e0b,#fde047)' },
      { label: `⚡ Vibe (${simMe.happiness} / ${gameState.hapGoal})`, pct: calc.pcts[1], color: 'linear-gradient(90deg,#ec4899,#e879f9)' },
      { label: `🎓 Neural Edu (${(calc.eduCreds / 10).toFixed(1)} / ${(gameState.eduGoal / 10).toFixed(0)} Deg)`, pct: calc.pcts[2], color: 'linear-gradient(90deg,#6366f1,#22d3ee)' },
      { label: `💼 Career (${calc.careerPts} / ${gameState.careerGoal} pts)`, pct: calc.pcts[3], color: 'linear-gradient(90deg,#10b981,#34d399)' },
    ];

    goalsMount.innerHTML = pillars
      .map(
        (p) => `
        <div class="jb-goal-row">
          <div class="jb-goal-top">
            <span>${escapeHtml(p.label)}</span>
            <span class="mono" style="color:${p.pct >= 100 ? '#6ee7b7' : '#67e8f9'};">${p.pct}%</span>
          </div>
          <div class="jb-goal-track">
            <div class="jb-goal-fill" style="width:${p.pct}%;background:${p.color};"></div>
          </div>
        </div>
      `
      )
      .join('');

    const jb = getJob(simMe.jobId);
    const ownedApps = APPLIANCES.filter((a) => (simMe.appliancesMask & (1 << a.id)) !== 0)
      .map((a) => `${a.icon}${(simMe.appliancesBrokenMask & (1 << a.id)) !== 0 ? '🔧' : ''}`)
      .join(' ');

    statsMount.innerHTML = `
      <div class="jb-stat-box"><span>💵 Cash / 🏦 Vault</span><strong class="mono">$${simMe.cash} / $${simMe.savings}</strong></div>
      <div class="jb-stat-box"><span>💼 Active Gig</span><strong>${jb ? `${escapeHtml(jb.title)} ($${Math.max(simMe.hourlyWage, jb.baseWage)}/h)` : 'Freelance / None'}</strong></div>
      <div class="jb-stat-box"><span>🍔 Rations / 🏙️ Hab</span><strong>${simMe.foodWeeks} wk · ${simMe.aptTier === 1 ? 'LeSecurity' : 'Pod-Hab'}${simMe.rentDebt > 0 ? ` (-$${simMe.rentDebt})` : ''}</strong></div>
      <div class="jb-stat-box"><span>🧥 Threads / 🤖 Rig</span><strong>${DRESS_NAMES[effectiveClothesTier(simMe)].split(' ')[0]} · ${ownedApps || 'None'}</strong></div>
    `;
  }

  // Rivals List
  if (!gameState || !gameState.seats.length) {
    rivalsMount.innerHTML = `
      <div class="jb-rival-card">
        <img src="/assets/jones/rival_jones.jpg" alt="Jones" class="jb-rival-avatar" />
        <div>
          <div style="font-weight:800;font-size:0.8rem;color:#67e8f9;">🕶️ Rival “Jones”</div>
          <div style="font-size:0.7rem;color:#94a3b8;">Waiting at the Holographic Clocktower with his cyber-chronometer!</div>
        </div>
      </div>
    `;
  } else {
    document.getElementById('lblSeatCount').textContent = `${gameState.seatCount} Runners`;
    const others = gameState.seats.filter((s) => s.seatIdx !== gameState.viewerSeat);
    rivalsMount.innerHTML = others
      .map((s) => {
        const bp = BOT_PROFILES[s.isBot] || { art: '/assets/jones/rival_jones.jpg' };
        const sj = getJob(s.jobId);
        const vBuilding = BUILDINGS[s.location] || BUILDINGS[0];
        return `
          <div class="jb-rival-card">
            <img src="${bp.art}" alt="Runner" class="jb-rival-avatar" />
            <div>
              <div style="display:flex;justify-content:space-between;gap:6px;font-size:0.75rem;font-weight:800;">
                <span>${escapeHtml(seatDisplayName(s))}</span>
                <span class="mono" style="color:#67e8f9;">$${s.netWealth.toLocaleString()}</span>
              </div>
              <div style="font-size:0.66rem;color:#94a3b8;">
                ${sj ? escapeHtml(sj.title) : 'Unassigned'} · ${vBuilding.icon} ${escapeHtml(vBuilding.name)}
              </div>
              <div class="jb-mini-pillars">
                <span class="jb-mini-pil">💰${s.goalPcts[0]}%</span>
                <span class="jb-mini-pil">⚡${s.goalPcts[1]}%</span>
                <span class="jb-mini-pil">🎓${s.goalPcts[2]}%</span>
                <span class="jb-mini-pil">💼${s.goalPcts[3]}%</span>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Weekend Net-Feed
  if (!gameState || !gameState.logs.length) {
    gazetteMount.innerHTML = `<div style="font-size:0.73rem;color:#94a3b8;">Sector Net-Feed dispatches appear here after every 60-hour week!</div>`;
  } else {
    const rev = [...gameState.logs].reverse();
    gazetteMount.innerHTML = rev
      .map((lg) => {
        const seat = gameState.seats[lg.seat];
        const meta = WEEKEND_HEADLINES[lg.eventId] || WEEKEND_HEADLINES[1];
        const deltaBadge =
          lg.delta !== 0
            ? ` <strong class="mono" style="color:${lg.delta > 0 ? '#6ee7b7' : '#fda4af'};">(${lg.delta > 0 ? '+' : ''}${lg.delta})</strong>`
            : '';
        return `
          <div class="jb-gazette-item">
            <img src="${meta.thumb}" alt="" class="jb-gazette-thumb" />
            <div>
              <span class="mono" style="color:#22d3ee;font-weight:800;">Wk ${lg.week}:</span>
              <strong>${escapeHtml(seatDisplayName(seat))}</strong> ${escapeHtml(meta.text)}${deltaBadge}
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function renderLobbyDirectory() {
  const mount = document.getElementById('gamesDirectoryMount');
  if (!mount) return;
  if (!directoryGames.length) {
    mount.innerHTML = `<div style="font-size:0.76rem;color:#94a3b8;">No boards listed yet on this Sector HFS—open one above!</div>`;
    return;
  }
  mount.innerHTML = directoryGames
    .slice()
    .reverse()
    .map((g) => {
      const phaseTxt =
        g.phase === PHASE_LOBBY ? '🟢 Open Lobby' : g.phase === PHASE_ACTIVE ? `⚡ Week ${g.weekNumber}` : '🏆 Finished';
      const isCur = g.gameId.toLowerCase() === activeGameId.toLowerCase();
      return `
        <div class="jb-dir-row">
          <div>
            <div class="mono" style="font-weight:800;color:#f8fafc;">${shortHex(g.gameId)} ${isCur ? '(Viewing)' : ''}</div>
            <div style="font-size:0.69rem;color:#94a3b8;">
              ${phaseTxt} · ${g.seatCount} Seats (${g.humanCount} Human) · Goal $${g.wealthGoal.toLocaleString()}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="jb-btn jb-btn-xs" data-view-game="${g.gameId}">👁 View</button>
            ${
              g.phase === PHASE_LOBBY && g.seatCount < 4
                ? `<button type="button" class="jb-btn jb-btn-xs jb-btn-emerald" data-join-game="${g.gameId}">🙋 Join</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');
}

function renderCatalogModal() {
  const mount = document.getElementById('catalogBodyMount');
  if (!mount) return;
  mount.innerHTML = `
    <div class="jb-field-label">💼 All 12 Neo-Sector Cyber-Careers</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px;">
      ${JOBS.map(
        (j) => `
        <div class="jb-stat-box">
          <span>Rank ${j.rank} · ${BUILDINGS[j.workplace].icon} ${escapeHtml(BUILDINGS[j.workplace].name)}</span>
          <strong>${escapeHtml(j.title)} — $${j.baseWage}/hr ($${j.baseWage * 6}/shift)</strong>
          <div style="font-size:0.66rem;color:#94a3b8;">Threads: ${DRESS_NAMES[j.dress]} · Exp ${j.reqExp} · Dep ${j.reqDep}</div>
        </div>
      `
      ).join('')}
    </div>
    <div class="jb-field-label" style="margin-top:8px;">🤖 6 Socket City Upgrades (Z-Mart Bazaar sells Refurb Cryo-Fridge/Oven/Holo-Wall at 15% off!)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px;">
      ${APPLIANCES.map(
        (a) => `
        <div class="jb-stat-box">
          <span>Base $${a.basePrice} · +${a.hap} Vibe</span>
          <strong>${a.icon} ${escapeHtml(a.name)}</strong>
          <div style="font-size:0.66rem;color:#cbd5e1;">${escapeHtml(a.perk)}</div>
        </div>
      `
      ).join('')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// DOM Event Wiring & Boot
// ---------------------------------------------------------------------------

function openModal(id) {
  document.getElementById(id)?.classList.add('is-open');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('is-open');
}

function bindEvents() {
  document.getElementById('btnNewSoloModal')?.addEventListener('click', () => openModal('soloModal'));
  document.getElementById('btnOpenLobbyModal')?.addEventListener('click', () => {
    refreshGameState();
    openModal('lobbyModal');
  });
  document.getElementById('btnOpenCatalogModal')?.addEventListener('click', () => {
    renderCatalogModal();
    openModal('catalogModal');
  });

  document.getElementById('btnUndoStep')?.addEventListener('click', () => {
    plannedSteps.pop();
    renderAll();
  });
  document.getElementById('btnResetWeek')?.addEventListener('click', () => {
    plannedSteps = [];
    renderAll();
  });
  document.getElementById('btnFinishWeek')?.addEventListener('click', () => submitWeekPlanTx());
  document.getElementById('btnConfirmSoloStart')?.addEventListener('click', () =>
    startSoloGameTx(selectedPreset, selectedBots)
  );
  document.getElementById('btnCreateLobbyGame')?.addEventListener('click', () => {
    const preset = Number(document.getElementById('selLobbyPreset')?.value || 1);
    createLobbyGameTx(preset);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && selectedBuilding !== null) {
      selectedBuilding = null;
      renderAll();
    }
  });

  document.getElementById('cyberMapCanvas')?.addEventListener('click', (ev) => {
    if (ev.target.id === 'cyberMapCanvas' && selectedBuilding !== null) {
      selectedBuilding = null;
      renderAll();
    }
  });

  document.addEventListener('click', (ev) => {
    const closeEl = ev.target.closest('[data-close]');
    if (closeEl) {
      closeModal(closeEl.getAttribute('data-close'));
      return;
    }

    const presetEl = ev.target.closest('[data-preset]');
    if (presetEl) {
      selectedPreset = Number(presetEl.getAttribute('data-preset'));
      document
        .querySelectorAll('#soloPresetGrid .jb-preset-card')
        .forEach((el) => el.classList.toggle('is-selected', el === presetEl));
      return;
    }

    const botEl = ev.target.closest('[data-bots]');
    if (botEl) {
      selectedBots = Number(botEl.getAttribute('data-bots'));
      document
        .querySelectorAll('#soloBotCountRow .jb-chip-btn')
        .forEach((el) => el.classList.toggle('is-selected', el === botEl));
      return;
    }

    const tileEl = ev.target.closest('[data-building-id]');
    if (tileEl) {
      const clickedId = Number(tileEl.getAttribute('data-building-id'));
      selectedBuilding = selectedBuilding === clickedId ? null : clickedId;
      renderAll();
      return;
    }

    if (ev.target.closest('#btnBackToPlaza')) {
      selectedBuilding = null;
      renderAll();
      return;
    }

    if (ev.target.closest('#btnStageQuickPlay')) {
      startSoloGameTx(0, 1);
      return;
    }
    if (ev.target.closest('#btnStageChoosePace') || ev.target.closest('#btnStageNewSolo')) {
      openModal('soloModal');
      return;
    }
    if (ev.target.closest('#btnStageRematch')) {
      rematchTx();
      return;
    }
    if (ev.target.closest('#btnStageJoinCurrent')) {
      joinLobbyGameTx(activeGameId);
      return;
    }
    if (ev.target.closest('#btnStageStartWithJones')) {
      startLobbyGameTx(activeGameId, Math.max(2, (gameState?.seatCount || 1) + 1));
      return;
    }
    if (ev.target.closest('#btnStageStartHumansOnly')) {
      startLobbyGameTx(activeGameId, gameState?.seatCount || 2);
      return;
    }

    const qBtn = ev.target.closest('[data-q-op]');
    if (qBtn && !qBtn.disabled) {
      const bId = Number(qBtn.getAttribute('data-q-b'));
      const op = Number(qBtn.getAttribute('data-q-op'));
      const arg = Number(qBtn.getAttribute('data-q-arg'));
      const lbl = qBtn.getAttribute('data-q-lbl') || 'Op';
      if (op === OP_MOVE && arg !== bId) {
        selectedBuilding = arg;
        renderAll();
        return;
      }
      queueBuildingAction(bId, op, arg, lbl);
      return;
    }

    const viewBtn = ev.target.closest('[data-view-game]');
    if (viewBtn) {
      activeGameId = viewBtn.getAttribute('data-view-game');
      plannedSteps = [];
      closeModal('lobbyModal');
      refreshGameState();
      return;
    }

    const joinBtn = ev.target.closest('[data-join-game]');
    if (joinBtn) {
      joinLobbyGameTx(joinBtn.getAttribute('data-join-game'));
    }
  });
}

async function selectTownInstance(addr, gameIdHint) {
  if (stopWatcher) {
    stopWatcher();
    stopWatcher = null;
  }
  contractAddr = (addr || '').toLowerCase();
  if (gameIdHint) activeGameId = gameIdHint;
  await refreshGameState();

  if (contractAddr) {
    stopWatcher = slxWatchChainApp({
      rpcUrl,
      contractAddresses: [contractAddr],
      onRefresh: () => refreshGameState(),
    });
  }
}

async function boot() {
  const unifiedHdr = mountSlxUnifiedHeader({
    mountContainer: document.getElementById('slxUnifiedHeaderMount'),
    wallet,
    activeAppId: 'jones',
    title: 'Jones in the Blockchain',
    subtitle: 'Cyberpunk 1–4 Player Career, Cyber-U. & Life-Sim Board Game • 60-Hour Chrono-Weeks • $0.00 Gas',
    rpcUrlFn: () => rpcUrl,
    getContractAddr: () => contractAddr || '',
    getContractLabel: () => 'JonesBlockchain',
    onWalletSwitch: () => {
      plannedSteps = [];
      refreshGameState();
    },
    extraElements: [document.getElementById('btnHowToPlay')],
  });

  bindEvents();

  jbGuide = mountSlxGameGuide({
    gameId: 'jones',
    headerBtnEl: document.getElementById('btnHowToPlay'),
    welcomeMountEl: document.getElementById('jbWelcomeMount'),
    coachMountEl: document.getElementById('jbCoachMount'),
    onWelcomePrimaryAction: () => startSoloGameTx(0, 1),
  });

  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const fallbackAddr = manifest?.jonesBlockchain?.contractAddr || '';
  const fallbackGid = manifest?.jonesBlockchain?.defaultGameId || DEFAULT_GAME_ID;

  if (fallbackAddr) {
    await selectTownInstance(fallbackAddr, fallbackGid);
    unifiedHdr?.refresh?.();
  } else {
    renderAll();
  }
  bootReadyResolve?.();

  mountHfsRegistryDropdown({
    mountContainer: unifiedHdr?.contextSlot,
    wallet,
    typeName: 'JONES_BLOCKCHAIN',
    rpcUrlFn: () => rpcUrl,
    getCurrentPrimaryAddr: () => contractAddr || '',
    onSelectInstance: async (inst) => {
      await selectTownInstance(inst.primaryAddr, inst.meta?.gameId || fallbackGid);
      unifiedHdr?.refresh?.();
    },
  });
}

boot();
