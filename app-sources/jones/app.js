/**
 * JONES IN THE BLOCKCHAIN (`app-sources/jones/app.js` — SuperLexicon HFS #24)
 *
 * Cozy, slow-paced, family-friendly 1–4 player life-simulation & career/education strategy
 * inspired by the classic early-PC game *Jones in the Fast Lane*:
 *  - 12-Building Sunnyvale Perimeter Ring Board + Illustrated Shopkeeper Stage.
 *  - 4 Simultaneous Victory Pillars (100% Wealth, Happiness, Education & Career).
 *  - Zero-Fatigue 60-Hour Weekly Pocket-Watch Planner (`submitWeekPlan` commits up to 32 steps in 1 block at $0.00 gas).
 *  - Solo vs. Rival "Jones" (+ Penny Hodl & Sunny Wheeler) OR multi-session Family/Friends PvP boards.
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
  1: { name: 'Jones', title: 'Cool All-Rounder Rival', icon: '🕶️', art: '/assets/jones/rival_jones.jpg' },
  2: { name: 'Penny Hodl', title: 'Thrifty Investor Bot', icon: '🐷', art: '/assets/jones/keeper_bank.jpg' },
  3: { name: 'Sunny Wheeler', title: 'Scooter & Diner Enthusiast', icon: '🛴', art: '/assets/jones/keeper_burgers.jpg' },
};

export const BUILDINGS = [
  {
    id: 0,
    icon: '🏠',
    name: 'Apartments',
    sub: 'Shady Acres & LeSecurity Condo',
    awning: 'linear-gradient(90deg, #38bdf8, #818cf8)',
    art: '/assets/jones/town_center.jpg',
    keeperName: 'Home Sweet Home',
    quote: '“Kick off your shoes! Take a cozy 6-hour nap or watch Stereo TV to recharge your Happiness.”',
  },
  {
    id: 1,
    icon: '🍔',
    name: 'Burger Bytes',
    sub: 'Fast Meals, Shakes & Entry Jobs',
    awning: 'linear-gradient(90deg, #ef4444, #f59e0b)',
    art: '/assets/jones/keeper_burgers.jpg',
    keeperName: 'Chef Mel @ Burger Bytes',
    quote: '“Welcome to Burger Bytes! Hot double-cheeseburgers, frosty shakes, and zero Fridge required!”',
  },
  {
    id: 2,
    icon: '🏷️',
    name: 'Z-Mart Depot',
    sub: '15%-Off Appliances & Raffle',
    awning: 'linear-gradient(90deg, #f59e0b, #eab308)',
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Bargain Counter @ Z-Mart',
    quote: '“Blue-light specials every day! Refurbished Fridges, Microwaves & TVs at 15% off, plus Town Raffle tickets!”',
  },
  {
    id: 3,
    icon: '👔',
    name: 'CryptoThreads',
    sub: 'Casual, Smart & Executive Suits',
    awning: 'linear-gradient(90deg, #ec4899, #a855f7)',
    art: '/assets/jones/keeper_clothing.jpg',
    keeperName: 'Tailor Leo @ CryptoThreads',
    quote: '“Dress for the career you want! Smart Blazers unlock Bank & Engineering roles, and Executive Suits open the C-Suite.”',
  },
  {
    id: 4,
    icon: '🤖',
    name: 'Socket City Tech',
    sub: 'Fridge, PC, Scooter & Microwave',
    awning: 'linear-gradient(90deg, #06b6d4, #3b82f6)',
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Gizmo Gus @ Socket City',
    quote: '“A Home Computer doubles your University study speed AND earns $25/wk! An E-Scooter cuts walking time in half!”',
  },
  {
    id: 5,
    icon: '🎓',
    name: 'Haltproof Univ.',
    sub: '4 Degrees (10 Credits Each)',
    awning: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
    art: '/assets/jones/keeper_university.jpg',
    keeperName: 'Professor Ada @ Haltproof U.',
    quote: '“Knowledge compounds forever! Complete 10 credits per degree—or just 5 lectures if you study with a Home Computer!”',
  },
  {
    id: 6,
    icon: '💼',
    name: 'Employment Office',
    sub: '12 Town Careers & Raises',
    awning: 'linear-gradient(90deg, #10b981, #14b8a6)',
    art: '/assets/jones/keeper_employment.jpg',
    keeperName: 'Counselor Clara',
    quote: '“Looking to move up in the world? Let’s match your Degrees, Experience, and Wardrobe to a higher-paying career!”',
  },
  {
    id: 7,
    icon: '⚙️',
    name: 'SLX Foundry',
    sub: 'Industrial & Wasm Engineering',
    awning: 'linear-gradient(90deg, #f97316, #ea580c)',
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Foreman Torque @ Foundry',
    quote: '“From Custodian all the way to Chief Wasm Architect—clock in a 6-hour shift and build serious career experience!”',
  },
  {
    id: 8,
    icon: '🏦',
    name: 'Consensus Bank',
    sub: '2%/wk Savings & 3 Town Stocks',
    awning: 'linear-gradient(90deg, #059669, #10b981)',
    art: '/assets/jones/keeper_bank.jpg',
    keeperName: 'Barnaby @ First Consensus Bank',
    quote: '“Savings earn 2% compound interest every weekend—and Sneaky Sam can NEVER touch money inside our golden vault!”',
  },
  {
    id: 9,
    icon: '🍎',
    name: 'FreshBlock Market',
    sub: 'Healthy 1, 2 & 4-Week Groceries',
    awning: 'linear-gradient(90deg, #22c55e, #84cc16)',
    art: '/assets/jones/keeper_market.jpg',
    keeperName: 'Grocer Gus @ FreshBlock',
    quote: '“Fresh apples, warm baguettes, and farm milk! Bring a Fridge for 2-week crates or a Freezer for 4-week bulk savings!”',
  },
  {
    id: 10,
    icon: '🌳',
    name: 'Rent & Commons',
    sub: 'Monthly Rent, Condo & Picnic',
    awning: 'linear-gradient(90deg, #14b8a6, #0ea5e9)',
    art: '/assets/jones/town_center.jpg',
    keeperName: 'Sunnyvale Civic & Leasing Office',
    quote: '“Pay monthly rent, upgrade to bandit-proof LeSecurity Condo, or enjoy a free 6-hour Sunnyvale Park Picnic (+4 Happiness)!”',
  },
  {
    id: 11,
    icon: '🔧',
    name: 'Pawn & Repair',
    sub: 'Fix Gadgets or Emergency Cash',
    awning: 'linear-gradient(90deg, #a855f7, #ec4899)',
    art: '/assets/jones/keeper_tech.jpg',
    keeperName: 'Tinker Tess @ Repair Shop',
    quote: '“Appliance acting up after the weekend? I’ll tune it right up for $55—or buy used gear for 55% instant cash!”',
  },
];

export const DEGREES = [
  { id: 0, icon: '📜', name: 'Junior College Diploma', reqText: 'Open to all', unlocks: 'Shift Supervisor, Assistant Buyer, Adv. Degrees' },
  { id: 1, icon: '🔌', name: 'Electronics & Wasm Eng.', reqText: 'Open to all', unlocks: 'Gadget Bench Tech, Assembly Engineer' },
  { id: 2, icon: '📊', name: 'Business & Ledger Admin.', reqText: 'Open to all', unlocks: 'Bank Teller, Investment Analyst' },
  { id: 3, icon: '🏛️', name: 'Protocol Architecture', reqText: 'Requires Jr. College + (Electronics or Business)', unlocks: 'Chief Wasm Architect, Bank President' },
];

export const APPLIANCES = [
  { id: 0, icon: '🧊', name: 'Refrigerator', basePrice: 320, hap: 5, perk: 'Stores up to 2 weeks of FreshBlock groceries' },
  { id: 1, icon: '❄️', name: 'Deep Freezer', basePrice: 280, hap: 5, perk: 'Requires Fridge · Stores up to 6 weeks of bulk food' },
  { id: 2, icon: '🍿', name: 'Microwave Oven', basePrice: 220, hap: 4, perk: '+4 Bonus Hours EVERY week (64h weekly clock!)' },
  { id: 3, icon: '📺', name: 'Color Stereo TV', basePrice: 360, hap: 8, perk: '+8 Happiness & boosts Home Relax to +5 Hap' },
  { id: 4, icon: '💻', name: 'Home Computer', basePrice: 540, hap: 8, perk: '2x University Study Speed (+2 credits) & +$25/wk tips!' },
  { id: 5, icon: '🛴', name: 'Electric Scooter', basePrice: 420, hap: 6, perk: 'Cuts town travel cost in half (1h per step instead of 2h!)' },
];

export const JOBS = [
  { id: 1, title: 'Fry Cook', workplace: 1, baseWage: 8, dress: 1, reqDegMask: 0, anyAdv: false, reqExp: 0, reqDep: 0, rank: 1 },
  { id: 2, title: 'Stock Clerk', workplace: 2, baseWage: 9, dress: 1, reqDegMask: 0, anyAdv: false, reqExp: 0, reqDep: 0, rank: 1 },
  { id: 3, title: 'Foundry Custodian', workplace: 7, baseWage: 10, dress: 1, reqDegMask: 0, anyAdv: false, reqExp: 4, reqDep: 15, rank: 2 },
  { id: 4, title: 'Shift Supervisor', workplace: 1, baseWage: 13, dress: 1, reqDegMask: 0b0001, anyAdv: false, reqExp: 10, reqDep: 20, rank: 3 },
  { id: 5, title: 'Gadget Bench Tech', workplace: 4, baseWage: 16, dress: 1, reqDegMask: 0b0010, anyAdv: false, reqExp: 12, reqDep: 25, rank: 4 },
  { id: 6, title: 'Assistant Buyer', workplace: 2, baseWage: 17, dress: 2, reqDegMask: 0b0001, anyAdv: false, reqExp: 14, reqDep: 25, rank: 4 },
  { id: 7, title: 'Bank Ledger Teller', workplace: 8, baseWage: 20, dress: 2, reqDegMask: 0b0100, anyAdv: false, reqExp: 18, reqDep: 30, rank: 5 },
  { id: 8, title: 'Assembly Engineer', workplace: 7, baseWage: 24, dress: 2, reqDegMask: 0b0011, anyAdv: false, reqExp: 24, reqDep: 35, rank: 6 },
  { id: 9, title: 'Adjunct Lecturer', workplace: 5, baseWage: 27, dress: 2, reqDegMask: 0b0001, anyAdv: true, reqExp: 30, reqDep: 40, rank: 7 },
  { id: 10, title: 'Investment Analyst', workplace: 8, baseWage: 32, dress: 3, reqDegMask: 0b0101, anyAdv: false, reqExp: 36, reqDep: 45, rank: 8 },
  { id: 11, title: 'Chief Wasm Architect', workplace: 7, baseWage: 38, dress: 3, reqDegMask: 0b1011, anyAdv: false, reqExp: 44, reqDep: 50, rank: 9 },
  { id: 12, title: 'Bank President', workplace: 8, baseWage: 45, dress: 3, reqDegMask: 0b1111, anyAdv: false, reqExp: 52, reqDep: 55, rank: 10 },
];

const STOCK_NAMES = [
  { id: 0, sym: 'T-BILLS', name: 'Sunnyvale T-Bills', risk: 'Safe Steady Bond' },
  { id: 1, sym: 'BURGER', name: 'Burger Bytes Corp', risk: 'Consumer Growth' },
  { id: 2, sym: 'Q-CHIP', name: 'QuantumChip Foundry', risk: 'High-Tech Swing' },
];

const DRESS_NAMES = ['Tattered Clothes', 'Casual Wear', 'Smart Dress', 'Executive Suit'];

const WEEKEND_HEADLINES = {
  1: { icon: '☀️', text: 'enjoyed a peaceful, sunny weekend around town.', thumb: '/assets/jones/town_center.jpg' },
  2: { icon: '🦝', text: 'got visited at Shady Acres by Sneaky Sam! Unbanked pocket cash swiped:', thumb: '/assets/jones/bandit_sam.jpg' },
  3: { icon: '🛡️', text: 'watched LeSecurity Condo’s robo-doorman bounce Sneaky Sam! (+2 Hap)', thumb: '/assets/jones/bandit_sam.jpg' },
  4: { icon: '🥪', text: 'forgot groceries! Ordered emergency corner sandwiches (-4 Hap):', thumb: '/assets/jones/keeper_burgers.jpg' },
  5: { icon: '🥛', text: 'had extra unrefrigerated groceries spoil over the weekend! Buy a Fridge!', thumb: '/assets/jones/keeper_market.jpg' },
  6: { icon: '💌', text: 'received a cheerful birthday card & cash gift from Aunt Millie!', thumb: '/assets/jones/town_center.jpg' },
  7: { icon: '🎈', text: 'won Best Pie at the Sunnyvale Neighborhood Block Party! (+3 Hap)', thumb: '/assets/jones/town_center.jpg' },
  8: { icon: '🏦', text: 'received a $60 Civic Consensus Dividend Rebate!', thumb: '/assets/jones/keeper_bank.jpg' },
  9: { icon: '🔧', text: 'had an appliance fuse hiccup—visit Pawn & Repair to tune it up!', thumb: '/assets/jones/keeper_tech.jpg' },
  10: { icon: '💻', text: 'earned +$25 passive weekend node tips from their Home Computer!', thumb: '/assets/jones/keeper_tech.jpg' },
  11: { icon: '🏠', text: 'settled monthly Sunnyvale apartment rent:', thumb: '/assets/jones/town_center.jpg' },
  12: { icon: '🏆', text: 'REACHED 100% IN ALL FOUR LIFE PILLARS & WON SUNNYVALE!', thumb: '/assets/jones/rival_jones.jpg' },
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
let selectedBuilding = null; // null = Sunnyvale Plaza overview, 0..11 = Building interior
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
// RPC Sync & Identity-Gated Transactions
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
  if (!seat) return 'Townsperson';
  if (seat.isBot > 0) {
    const bp = BOT_PROFILES[seat.isBot] || BOT_PROFILES[1];
    return `${bp.icon} ${bp.name}`;
  }
  const nick = nickCache.get(seat.identity);
  if (nick) return `🧑 @${nick}`;
  return `🧑 ${shortAddr(seat.eoa)}`;
}

async function hydrateNicknames(seats) {
  let changed = false;
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
  if (changed) renderAll();
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

    // If our current week advanced or turn changed on-chain, clear local planned steps cleanly
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

async function sendJonesTx(label, calldataHex) {
  if (txBusy) return false;
  if (!contractAddr) await bootReadyPromise;
  if (!contractAddr) {
    showToast('⚠ Sunnyvale Town HFS contract not configured.');
    return false;
  }
  txBusy = true;
  renderAll();
  try {
    await slxClient.sendAndConfirm({
      privateKey: wallet.keypair.privateKey,
      to: contractAddr,
      data: calldataHex,
      gasLimit: 5_000_000n,
      extraTargets: [contractAddr],
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

  // Always allocate a fresh unique board ID when starting a new Solo game so existing boards stay preserved!
  const newGid = bytesToHex(concatBytes(utf8ToBytes('JONES_SOLO'), randomBytes(22)));
  activeGameId = newGid;
  plannedSteps = [];
  selectedBuilding = null;

  showToast('☀️ Moving into Sunnyvale & winding your 60-hour pocket watch…');
  const ok = await sendJonesTx(
    'quickStartSolo',
    encodeAbi('quickStartSolo(bytes32,address,uint64,uint64)', [
      ['bytes32', newGid],
      ['address', idRec.identityAddr],
      ['uint64', BigInt(botCount)],
      ['uint64', BigInt(preset)],
    ])
  );
  if (ok) {
    closeModal('soloModal');
    showToast('🎉 Welcome to Week 1! Click Employment Office to grab your first job!');
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
    ])
  );
  if (ok) showToast('🏡 Open Family Lobby created! Friends can join or you can start anytime.');
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
    ])
  );
  if (ok) {
    closeModal('lobbyModal');
    showToast('🙋 Joined Sunnyvale Board!');
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
    ])
  );
  if (ok) {
    closeModal('lobbyModal');
    showToast('☀️ Sunnyvale Week 1 has begun!');
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

  showToast('🌙 Rolling the weekend gazette & Rival Jones’s turn…');
  const ok = await sendJonesTx(
    'submitWeekPlan',
    encodeAbi('submitWeekPlan(bytes32,bytes)', [
      ['bytes32', activeGameId],
      ['bytes', flatBytes],
    ])
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
    ])
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
    showToast('🕰️ Start a game or wait for your turn to plan your week!');
    return;
  }

  const nextSteps = [...plannedSteps];
  if (simMe.location !== targetBuilding) {
    if (nextSteps.length + 1 > MAX_PLAN_STEPS) {
      showToast('⚠ Weekly step limit (32 actions) reached—click Finish Week!');
      return;
    }
    nextSteps.push({
      op: OP_MOVE,
      arg: targetBuilding,
      label: `🚶→${BUILDINGS[targetBuilding].icon}`,
    });
  }

  if (op !== OP_MOVE) {
    if (nextSteps.length + 1 > MAX_PLAN_STEPS) {
      showToast('⚠ Weekly step limit (32 actions) reached—click Finish Week!');
      return;
    }
    nextSteps.push({ op, arg, label });
  }

  // Verify the simulated step actually succeeded (had enough hours/cash)
  const afterSim = simulateLocalPlan(baseMe, gameState, nextSteps);
  if (
    afterSim.hoursLeft === simMe.hoursLeft &&
    afterSim.cash === simMe.cash &&
    afterSim.savings === simMe.savings &&
    afterSim.location === simMe.location &&
    afterSim.jobId === simMe.jobId &&
    afterSim.happiness === simMe.happiness
  ) {
    showToast('⚠ Not enough hours, cash, or prerequisites for that action!');
    return;
  }

  plannedSteps = nextSteps;
  renderAll();
}

// ---------------------------------------------------------------------------
// Rendering Engine: 12-Tile Perimeter Board, Shop Stage, 4 Pillars & Gazette
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
  renderPerimeterTiles();
  renderCenterStage();
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
    if (econEl) econEl.textContent = '☀️ Sunnyvale Ready';
    if (turnEl) turnEl.textContent = contractAddr ? 'Click ☀️ Play vs. Jones to begin!' : 'Connecting…';
    return;
  }

  wkEl.textContent = String(gameState.weekNumber);
  const idx = gameState.economyIndex;
  const arrow = gameState.economyTrend > 0 ? '↗' : gameState.economyTrend < 0 ? '↘' : '→';
  const weather = idx >= 108 ? '☀️ Boom' : idx <= 92 ? '🌧️ Bargain Dip' : '🌤️ Steady';
  econEl.textContent = `${weather} ${idx}% ${arrow}`;

  if (gameState.phase === PHASE_LOBBY) {
    turnEl.textContent = `🏡 Open Lobby (${gameState.seatCount}/4 Seats)`;
    jbGuide?.updateCoach({
      pill: '🏡 FAMILY LOBBY',
      tone: 'action',
      html: 'Share this Sunnyvale board with family &amp; friends, or click <strong>☀️ Start Now</strong> to fill empty seats with Jones!',
    });
  } else if (gameState.phase === PHASE_FINISHED) {
    const winSeat = gameState.seats[gameState.winnerSeat];
    turnEl.textContent = `🏆 Winner: ${seatDisplayName(winSeat)}!`;
    jbGuide?.updateCoach({
      pill: '🏆 VICTORY!',
      tone: 'action',
      html: `<strong>${escapeHtml(seatDisplayName(winSeat))}</strong> reached 100% across Wealth, Happiness, Education &amp; Career!`,
      actionLabel: '🔄 Play Again',
      onAction: () => rematchTx(),
    });
  } else if (gameState.viewerSeat === gameState.turnSeat) {
    turnEl.textContent = txBusy ? '⛓️ Sealing Week on Subnet 1…' : '🟢 Your 60-Hour Week!';
    const { simMe } = getActivePreview();
    if (simMe && simMe.jobId === 0) {
      jbGuide?.updateCoach({
        pill: '💼 STEP 1',
        tone: 'action',
        html: 'Click <strong>💼 Employment Office</strong> to grab your first job (Fry Cook or Stock Clerk), then work shifts &amp; grab a meal!',
        actionLabel: '💼 Go to Employment',
        onAction: () => {
          selectedBuilding = 6;
          renderAll();
        },
      });
    } else if (simMe && simMe.foodWeeks === 0) {
      jbGuide?.updateCoach({
        pill: '🍔 DINNER REMINDER',
        tone: 'urgent',
        html: `You have <strong>0 weeks of food</strong> stored! Visit <strong>🍔 Burger Bytes</strong> or <strong>🍎 FreshBlock Market</strong> before Friday night!`,
        actionLabel: '🍔 Burger Bytes',
        onAction: () => {
          selectedBuilding = 1;
          renderAll();
        },
      });
    } else if (simMe) {
      jbGuide?.updateCoach({
        pill: `🕰️ ${simMe.hoursLeft}H LEFT`,
        tone: 'action',
        html: `Work 6h shifts, attend a lecture at <strong>🎓 Haltproof Univ.</strong>, deposit cash at <strong>🏦 Bank</strong>, or seal your week!`,
        actionLabel: '🌙 Finish Week',
        onAction: () => submitWeekPlanTx(),
      });
    }
  } else if (gameState.viewerSeat === 0xff) {
    turnEl.textContent = '👀 Spectating Sunnyvale — Click ☀️ Play vs. Jones!';
    jbGuide?.updateCoach({
      pill: '☀️ WELCOME TO SUNNYVALE',
      tone: 'action',
      html: 'Live Week 3 showcase board in progress! Click <strong>☀️ Play vs. Jones</strong> to start your own cozy career at $0.00 gas.',
      actionLabel: '☀️ Play vs. Jones',
      onAction: () => openModal('soloModal'),
    });
  } else {
    const active = gameState.seats[gameState.turnSeat];
    turnEl.textContent = `🕰️ Waiting on ${seatDisplayName(active)}`;
    jbGuide?.updateCoach({
      pill: '🕰️ FAMILY TURN',
      tone: 'info',
      html: `Waiting for <strong>${escapeHtml(seatDisplayName(active))}</strong> to finish Week ${gameState.weekNumber}.`,
    });
  }
}

function renderPerimeterTiles() {
  const { simMe, isMyTurn } = getActivePreview();
  const curLoc = simMe ? simMe.location : 0;
  const hasScooter = simMe ? hasWorkingApp(simMe, 5) : false;
  const myJob = simMe ? getJob(simMe.jobId) : null;

  for (let i = 0; i < NUM_BUILDINGS; i++) {
    const mount = document.getElementById(`tileMount${i}`);
    if (!mount) continue;
    const b = BUILDINGS[i];
    const dist = ringDistance(curLoc, i);
    const hrs = dist * (hasScooter ? 1 : 2);
    const isHere = simMe && curLoc === i;
    const isSel = selectedBuilding === i;

    const pawnsHtml = [];
    if (gameState?.seats) {
      for (const s of gameState.seats) {
        const sLoc =
          isMyTurn && s.seatIdx === gameState.viewerSeat && simMe ? simMe.location : s.location;
        if (sLoc === i) {
          if (s.seatIdx === gameState.viewerSeat) {
            pawnsHtml.push(`<span class="jb-pawn">⭐ You</span>`);
          } else {
            const label = s.isBot > 0 ? BOT_PROFILES[s.isBot]?.name || 'Bot' : shortAddr(s.eoa);
            pawnsHtml.push(`<span class="jb-pawn rival">${escapeHtml(label)}</span>`);
          }
        }
      }
    }

    const travelBadge = isHere
      ? `<span class="jb-tile-travel here">📍 HERE</span>`
      : `<span class="jb-tile-travel mono">${hasScooter ? '🛴' : '🚶'} ${hrs}h</span>`;

    const jobBadge =
      myJob && myJob.workplace === i ? `<span class="jb-work-tag">💼 WORK</span>` : '';

    mount.innerHTML = `
      <button type="button" class="jb-tile ${isSel ? 'is-selected' : ''} ${isHere ? 'is-here' : ''}" data-building-id="${i}">
        <div class="jb-tile-awning" style="background: ${b.awning};"></div>
        <div class="jb-tile-inner">
          <div class="jb-tile-top">
            <span class="jb-tile-icon">${b.icon}</span>
            ${travelBadge}
          </div>
          <div>
            <div class="jb-tile-name">${escapeHtml(b.name)}</div>
            <div class="jb-tile-sub">${escapeHtml(b.sub)}</div>
          </div>
          <div class="jb-tile-footer">
            <div class="jb-pawns-row">${pawnsHtml.join('')}</div>
            ${jobBadge}
          </div>
        </div>
      </button>
    `;
  }
}

function buildInteriorActions(bId, simMe, econ, isMyTurn) {
  const actions = [];
  const disabledBase = !isMyTurn || !simMe || txBusy;
  const curLoc = simMe ? simMe.location : 0;
  const hasScooter = simMe ? hasWorkingApp(simMe, 5) : false;
  const walkHrs = curLoc === bId ? 0 : ringDistance(curLoc, bId) * (hasScooter ? 1 : 2);
  const walkNote = walkHrs > 0 ? ` (+${walkHrs}h travel)` : '';

  // If workplace of player's current job, always surface a prominent "Work 6h Shift" button right at the top!
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
        ? `+2 Experience, +2 Dependability ($${Math.max(simMe.hourlyWage, myJob.baseWage)}/hr)`
        : `⚠ Requires ${DRESS_NAMES[myJob.dress]} from CryptoThreads!`,
      disabled: !can1,
    });
    actions.push({
      op: OP_WORK,
      arg: 3,
      label: `⚡ Work 3 Shifts (18h Block)`,
      cost: `+$${shiftPay * 3} · 18h${walkNote}`,
      desc: `Full productive workday! +6 Experience, +6 Dependability.`,
      disabled: !can3,
    });
  }

  if (bId === 0) {
    const tvBonus = simMe && hasWorkingApp(simMe, 3);
    actions.push({
      op: OP_RELAX,
      arg: 0,
      label: tvBonus ? '📺 Watch Color Stereo TV & Chill' : '🛋️ Cozy Afternoon Nap at Home',
      cost: `$0 · 6h${walkNote}`,
      desc: tvBonus ? 'Boosts Happiness by +5!' : 'Boosts Happiness by +3 (get a Stereo TV for +5!).',
      disabled: disabledBase || simMe.hoursLeft < walkHrs + 6,
    });
  } else if (bId === 1) {
    const pMeal = scaledPrice(15, econ);
    const pShake = scaledPrice(28, econ);
    actions.push({
      op: OP_BUY_FOOD,
      arg: 0,
      label: '🍔 Cheeseburger Value Meal',
      cost: `$${pMeal} · 2h${walkNote}`,
      desc: '+1 Week Food & +2 Happiness (no Fridge needed!).',
      disabled: disabledBase || simMe.cash < pMeal || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_FOOD,
      arg: 1,
      label: '🥤 Double Burger & Strawberry Shake Feast',
      cost: `$${pShake} · 2h${walkNote}`,
      desc: '+2 Weeks Food & +4 Happiness! Treat yourself!',
      disabled: disabledBase || simMe.cash < pShake || simMe.hoursLeft < walkHrs + 2,
    });
  } else if (bId === 2) {
    const pClothes = scaledPrice(35, econ);
    const pRaffle = scaledPrice(15, econ);
    actions.push({
      op: OP_RELAX,
      arg: 2,
      label: '🎟️ Sunnyvale Raffle Ticket & Boardgame',
      cost: `$${pRaffle} · 2h${walkNote}`,
      desc: '+3 Happiness + 1-in-8 shot at an instant $200 Raffle Jackpot!',
      disabled: disabledBase || simMe.cash < pRaffle || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_CLOTHES,
      arg: 1,
      label: '👕 Bargain Casual Outfit',
      cost: `$${pClothes} · 2h${walkNote}`,
      desc: 'Refreshes Casual Wear to 5 weeks +1 Happiness.',
      disabled: disabledBase || simMe.cash < pClothes || simMe.hoursLeft < walkHrs + 2,
    });
    for (const appId of [0, 2, 3]) {
      const app = APPLIANCES[appId];
      const discPrice = scaledPrice(Math.floor((app.basePrice * 85) / 100), econ);
      const ownedOk = simMe && hasWorkingApp(simMe, appId);
      actions.push({
        op: OP_BUY_APPLIANCE,
        arg: appId,
        label: `${app.icon} Refurb ${app.name} (15% Off!)`,
        cost: ownedOk ? 'OWNED ✓' : `$${discPrice} · 2h${walkNote}`,
        desc: app.perk,
        disabled: disabledBase || ownedOk || simMe.cash < discPrice || simMe.hoursLeft < walkHrs + 2,
      });
    }
  } else if (bId === 3) {
    const outfits = [
      { tier: 1, icon: '👕', name: 'Crisp Casual Hoodie', base: 45, wks: 6, hap: 1 },
      { tier: 2, icon: '🧥', name: 'Smart Career Blazer', base: 95, wks: 7, hap: 3 },
      { tier: 3, icon: '🎩', name: 'Tailored Executive Suit', base: 195, wks: 8, hap: 6 },
    ];
    for (const o of outfits) {
      const p = scaledPrice(o.base, econ);
      actions.push({
        op: OP_BUY_CLOTHES,
        arg: o.tier,
        label: `${o.icon} ${o.name} (Tier ${o.tier})`,
        cost: `$${p} · 2h${walkNote}`,
        desc: `Lasts ${o.wks} weeks · +${o.hap} Happiness.`,
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
        desc: needsFridge ? '⚠ Buy a Refrigerator first!' : `${app.perk} (+${app.hap} Hap)`,
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
        cost: grad ? 'GRADUATED ✓' : `$${tuition} · 6h${walkNote}`,
        desc: grad
          ? `Completed! Unlocks: ${deg.unlocks}`
          : !qual
          ? `🔒 ${deg.reqText}`
          : `+${hasPc ? 2 : 1} Study Credit${hasPc ? 's (💻 PC 2x Boost!)' : ''} · Unlocks: ${deg.unlocks}`,
        disabled: disabledBase || !qual || simMe.cash < tuition || simMe.hoursLeft < walkHrs + 6,
      });
    }
  } else if (bId === 6) {
    if (simMe && simMe.jobId > 0) {
      actions.push({
        op: OP_ASK_RAISE,
        arg: 0,
        label: '📈 Negotiate +$2/hr Pay Raise',
        cost: `4h${walkNote}`,
        desc:
          simMe.dependability >= 55
            ? 'Your Dependability is 55+ — Counselor Clara will approve +$2/hr & +2 Happiness!'
            : `Requires 55+ Dependability (currently ${simMe.dependability}) to succeed.`,
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
        cost: isCur ? 'CURRENT JOB' : `4h${walkNote}`,
        desc: `At ${wpName} · Req: Exp ${jb.reqExp}, Dep ${jb.reqDep}, ${DRESS_NAMES[jb.dress]}`,
        disabled: disabledBase || isCur || !qual || simMe.hoursLeft < walkHrs + 4,
      });
    }
  } else if (bId === 7) {
    if (!myJob || myJob.workplace !== 7) {
      actions.push({
        op: OP_MOVE,
        arg: 6,
        label: '💼 Visit Employment Office to Apply Here',
        cost: 'Shortcut',
        desc: 'Foundry careers pay $10–$38/hr (Custodian, Assembly Engineer, Chief Wasm Architect)!',
        disabled: disabledBase,
      });
    }
  } else if (bId === 8) {
    actions.push({
      op: OP_BANK_DEPOSIT,
      arg: 2,
      label: '🐷 Deposit $100 into Savings (2%/wk)',
      cost: `1h${walkNote}`,
      desc: 'Earns 2% compound interest every weekend & 100% safe from Sneaky Sam!',
      disabled: disabledBase || simMe.cash < 100 || simMe.hoursLeft < walkHrs + 1,
    });
    actions.push({
      op: OP_BANK_DEPOSIT,
      arg: 0,
      label: '🔐 Deposit All Spare Cash (Keep $40)',
      cost: `1h${walkNote}`,
      desc: 'Sweeps pocket cash above $40 safely into your Vault Savings.',
      disabled: disabledBase || simMe.cash <= 40 || simMe.hoursLeft < walkHrs + 1,
    });
    actions.push({
      op: OP_BANK_WITHDRAW,
      arg: 2,
      label: '💵 Withdraw $100 from Savings',
      cost: `1h${walkNote}`,
      desc: `Current Vault Savings: $${simMe ? simMe.savings : 0}`,
      disabled: disabledBase || simMe.savings <= 0 || simMe.hoursLeft < walkHrs + 1,
    });
    for (const st of STOCK_NAMES) {
      const price = gameState ? gameState.stockPrices[st.id] : 100;
      const owned = simMe ? simMe.stocks[st.id] : 0;
      actions.push({
        op: OP_BUY_STOCK,
        arg: (st.id << 4) | 1,
        label: `📈 Buy 1 ${st.sym} Share (Own: ${owned})`,
        cost: `$${price} · 1h${walkNote}`,
        desc: `${st.name} · ${st.risk}`,
        disabled: disabledBase || simMe.cash < price || simMe.hoursLeft < walkHrs + 1,
      });
      if (owned > 0) {
        actions.push({
          op: OP_SELL_STOCK,
          arg: (st.id << 4) | 0,
          label: `💰 Sell All ${owned} ${st.sym} Shares`,
          cost: `+$${price * owned} · 1h${walkNote}`,
          desc: `Liquidates ${st.sym} position to pocket cash.`,
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
      label: '🥖 1-Week Fresh Grocery Basket',
      cost: `$${p1} · 2h${walkNote}`,
      desc: '+1 Week Food & +1 Happiness.',
      disabled: disabledBase || simMe.cash < p1 || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_FOOD,
      arg: 3,
      label: '🍎 2-Week Refrigerator Crate',
      cost: `$${p2} · 2h${walkNote}`,
      desc: hasFridge ? '+2 Weeks Food & +2 Happiness!' : '🔒 Requires a working Refrigerator!',
      disabled: disabledBase || !hasFridge || simMe.cash < p2 || simMe.hoursLeft < walkHrs + 2,
    });
    actions.push({
      op: OP_BUY_FOOD,
      arg: 4,
      label: '❄️ 4-Week Bulk Freezer Chest',
      cost: `$${p4} · 2h${walkNote}`,
      desc:
        hasFridge && hasFreezer
          ? '+4 Weeks Food & +4 Happiness! Huge time & money saver!'
          : '🔒 Requires both Refrigerator + Deep Freezer!',
      disabled:
        disabledBase || !hasFridge || !hasFreezer || simMe.cash < p4 || simMe.hoursLeft < walkHrs + 2,
    });
  } else if (bId === 10) {
    actions.push({
      op: OP_RELAX,
      arg: 1,
      label: '🧺 Sunnyvale Plaza Picnic & Concert',
      cost: `FREE · 6h${walkNote}`,
      desc: '+4 Happiness for $0! Everyone in town is welcome!',
      disabled: disabledBase || simMe.hoursLeft < walkHrs + 6,
    });
    if (simMe && simMe.rentDebt > 0) {
      actions.push({
        op: OP_PAY_RENT,
        arg: 0,
        label: `🧾 Pay Rent Arrears ($${simMe.rentDebt})`,
        cost: `2h${walkNote}`,
        desc: 'Clears rent balance (+2 Dependability, +2 Happiness).',
        disabled: disabledBase || simMe.cash <= 0 || simMe.hoursLeft < walkHrs + 2,
      });
    }
    const condoDep = scaledPrice(340, econ);
    const inCondo = simMe && simMe.aptTier === 1;
    actions.push({
      op: OP_SWITCH_APT,
      arg: 1,
      label: inCondo ? '🏢 Living at LeSecurity Condo ✓' : '🏢 Upgrade to LeSecurity Condo',
      cost: inCondo ? 'ACTIVE' : `$${condoDep} · 4h${walkNote}`,
      desc: '100% Sneaky Sam proof + grants +2 cozy Happiness EVERY weekend!',
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
          label: `🔧 Repair ${app.name}`,
          cost: `$${repCost} · 3h${walkNote}`,
          desc: 'Restores full perk & +2 Happiness.',
          disabled: disabledBase || simMe.cash < repCost || simMe.hoursLeft < walkHrs + 3,
        });
      } else if (owned) {
        const refund = scaledPrice(Math.floor((app.basePrice * 55) / 100), econ);
        actions.push({
          op: OP_REPAIR_PAWN,
          arg: (1 << 4) | app.id,
          label: `🏷️ Pawn ${app.name} for Cash`,
          cost: `+$${refund} · 3h${walkNote}`,
          desc: 'Emergency cash option if you ever run short.',
          disabled: disabledBase || simMe.hoursLeft < walkHrs + 3,
        });
      }
    }
    if (actions.length === 0) {
      actions.push({
        op: OP_MOVE,
        arg: 4,
        label: '🤖 Browse New Gadgets at Socket City',
        cost: 'Info',
        desc: 'You have no broken or pawnable appliances right now!',
        disabled: disabledBase,
      });
    }
  }

  return actions;
}

function renderCenterStage() {
  const stage = document.getElementById('centerStage');
  if (!stage) return;

  const { simMe, isMyTurn } = getActivePreview();
  const econ = gameState?.economyIndex || 100;

  // Victory Celebration View if game finished!
  if (gameState && gameState.phase === PHASE_FINISHED && selectedBuilding === null) {
    const winner = gameState.seats[gameState.winnerSeat];
    stage.innerHTML = `
      <div class="jb-plaza-hero" style="background-image: url('/assets/jones/town_center.jpg');">
        <div class="jb-plaza-overlay">
          <div style="font-size:1.05rem;font-weight:900;color:#fde047;">
            🏆 ${escapeHtml(seatDisplayName(winner))} Reached 100% Across All Four Pillars in Week ${gameState.weekNumber}!
          </div>
          <p style="margin:0;font-size:0.8rem;color:#e2e8f0;line-height:1.45;">
            Wealth, Happiness, University Education, and Career—all mastered! Play another round on this board or start a fresh Sunnyvale challenge.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
            <button type="button" class="jb-btn jb-btn-gold" id="btnStageRematch">🔄 Play Again on This Board</button>
            <button type="button" class="jb-btn jb-btn-sky" id="btnStageNewSolo">☀️ New Game vs. Jones</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Open Lobby View if waiting for players
  if (gameState && gameState.phase === PHASE_LOBBY && selectedBuilding === null) {
    const amHost = gameState.viewerSeat === 0;
    const amSeated = gameState.viewerSeat !== 0xff;
    stage.innerHTML = `
      <div class="jb-plaza-hero" style="background-image: url('/assets/jones/town_center.jpg');">
        <div class="jb-plaza-overlay">
          <div style="font-size:1rem;font-weight:800;color:#fde68a;">
            🏡 Sunnyvale Family &amp; Friends Lobby (${gameState.seatCount} / 4 Human Seats Joined)
          </div>
          <p style="margin:0;font-size:0.79rem;color:#cbd5e1;line-height:1.45;">
            Targets: <strong>$${gameState.wealthGoal.toLocaleString()}</strong> Wealth · <strong>${gameState.hapGoal}</strong> Happiness · <strong>${gameState.eduGoal / 10}</strong> Degrees · <strong>${gameState.careerGoal}</strong> Career Pts.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
            ${
              !amSeated
                ? `<button type="button" class="jb-btn jb-btn-emerald" id="btnStageJoinCurrent">🙋 Join This Town Board</button>`
                : ''
            }
            ${
              amHost
                ? `<button type="button" class="jb-btn jb-btn-gold" id="btnStageStartWithJones">☀️ Start Now (Fill to 2 w/ Jones)</button>`
                : ''
            }
            ${
              amHost && gameState.seatCount >= 2
                ? `<button type="button" class="jb-btn jb-btn-emerald" id="btnStageStartHumansOnly">👨‍👩‍👧‍👦 Start Pure Human PvP (${gameState.seatCount}P)</button>`
                : ''
            }
            <button type="button" class="jb-btn" id="btnStageNewSolo">⚡ Or Instant Solo vs. Jones</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Building Interior Counter View when a tile `0..11` is selected!
  if (selectedBuilding !== null && BUILDINGS[selectedBuilding]) {
    const b = BUILDINGS[selectedBuilding];
    const actions = buildInteriorActions(selectedBuilding, simMe, econ, isMyTurn);
    const curLoc = simMe ? simMe.location : 0;
    const walkHrs =
      curLoc === selectedBuilding
        ? 0
        : ringDistance(curLoc, selectedBuilding) * (simMe && hasWorkingApp(simMe, 5) ? 1 : 2);

    stage.innerHTML = `
      <div class="jb-shop-view">
        <div class="jb-shop-hdr">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.35rem;">${b.icon}</span>
            <div>
              <div style="font-weight:800;font-size:0.92rem;color:#fef08a;">${escapeHtml(b.name)}</div>
              <div style="font-size:0.7rem;color:#94a3b8;">${escapeHtml(b.keeperName)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${
              isMyTurn && walkHrs > 0
                ? `<button type="button" class="jb-btn jb-btn-xs jb-btn-sky" data-q-op="${OP_MOVE}" data-q-arg="${selectedBuilding}" data-q-b="${selectedBuilding}" data-q-lbl="🚶→${b.icon}">🚶 Walk Here (${walkHrs}h)</button>`
                : ''
            }
            <button type="button" class="jb-btn jb-btn-xs" id="btnBackToPlaza">🌳 Town Plaza</button>
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

  // Default Sunnyvale Plaza Overview
  const promptHtml =
    !gameState || gameState.viewerSeat === 0xff
      ? `
        <div style="font-size:1.02rem;font-weight:800;color:#fef08a;">☀️ Welcome to Sunnyvale — Keep Up With Jones!</div>
        <p style="margin:0;font-size:0.8rem;color:#e2e8f0;line-height:1.45;">
          Stroll around the 12-building town ring, study at <strong>Haltproof University</strong>, climb <strong>12 careers</strong>, furnish your apartment, and reach <strong>100%</strong> in Wealth, Happiness, Education &amp; Career!
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          <button type="button" class="jb-btn jb-btn-gold" id="btnStageQuickPlay">☀️ Start Quick Game vs. Jones ($0 Gas)</button>
          <button type="button" class="jb-btn jb-btn-sky" id="btnStageChoosePace">⚙️ Choose Pace &amp; Rivals</button>
        </div>
      `
      : `
        <div style="font-size:0.98rem;font-weight:800;color:#fef08a;">
          ☀️ Week ${gameState.weekNumber} in Sunnyvale · Cash: $${simMe.cash.toLocaleString()} · Food: ${simMe.foodWeeks > 0 ? `${simMe.foodWeeks} wk ✓` : '⚠ Grab a meal!'}
        </div>
        <p style="margin:0;font-size:0.79rem;color:#cbd5e1;line-height:1.45;">
          Click any of the <strong>12 storefronts</strong> around the border to step inside! Your actions queue at <strong>0ms</strong> on your 60-hour watch—then click <strong>🌙 Finish Week</strong> to seal the whole week in 1 block.
        </p>
      `;

  stage.innerHTML = `
    <div class="jb-plaza-hero" style="background-image: url('/assets/jones/town_center.jpg');">
      <div class="jb-plaza-overlay">${promptHtml}</div>
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
      ? 'Planned Steps (0): Click any storefront around Sunnyvale to plan your 60-hour week!'
      : 'Weekly Planner: Start or join a Sunnyvale board to wind your pocket watch.';
    pillsEl.innerHTML = '';
  } else {
    const foodWarn = simMe && simMe.foodWeeks === 0 ? ' · ⚠ Don’t forget food!' : ' · 🍔 Fed ✓';
    sumEl.textContent = `Planned Steps (${plannedSteps.length}/${MAX_PLAN_STEPS})${foodWarn}`;
    pillsEl.innerHTML = plannedSteps
      .map((s, idx) => `<span class="jb-step-pill">${idx + 1}. ${escapeHtml(s.label)}</span>`)
      .join('');
  }

  undoBtn.disabled = !isMyTurn || txBusy || plannedSteps.length === 0;
  resetBtn.disabled = !isMyTurn || txBusy || plannedSteps.length === 0;
  finishBtn.disabled = !isMyTurn || txBusy;
  finishBtn.textContent = txBusy
    ? '⛓️ Sealing Week…'
    : `🌙 Finish Week ${gameState ? gameState.weekNumber : 1} & Roll Weekend!`;
}

function renderSidebar() {
  const { simMe } = getActivePreview();
  const goalsMount = document.getElementById('myGoalsMount');
  const statsMount = document.getElementById('myStatsMount');
  const rivalsMount = document.getElementById('rivalsMount');
  const gazetteMount = document.getElementById('gazetteMount');

  if (!gameState || !simMe) {
    document.getElementById('lblNetWealth').textContent = '$240 Start';
    goalsMount.innerHTML = `<div style="font-size:0.77rem;color:#94a3b8;">Click <strong>☀️ Play vs. Jones</strong> above to move into Sunnyvale and track your 4 Life Pillars!</div>`;
    statsMount.innerHTML = '';
  } else {
    const calc = computeGoalPcts(simMe, gameState);
    document.getElementById('lblNetWealth').textContent = `$${calc.netWealth.toLocaleString()} Net`;

    const pillars = [
      { label: `💰 Wealth ($${calc.netWealth.toLocaleString()} / $${gameState.wealthGoal.toLocaleString()})`, pct: calc.pcts[0], color: 'linear-gradient(90deg,#f59e0b,#fde047)' },
      { label: `😊 Happiness (${simMe.happiness} / ${gameState.hapGoal})`, pct: calc.pcts[1], color: 'linear-gradient(90deg,#ec4899,#fb7185)' },
      { label: `🎓 Education (${(calc.eduCreds / 10).toFixed(1)} / ${(gameState.eduGoal / 10).toFixed(0)} Deg)`, pct: calc.pcts[2], color: 'linear-gradient(90deg,#6366f1,#38bdf8)' },
      { label: `💼 Career (${calc.careerPts} / ${gameState.careerGoal} pts)`, pct: calc.pcts[3], color: 'linear-gradient(90deg,#10b981,#34d399)' },
    ];

    goalsMount.innerHTML = pillars
      .map(
        (p) => `
        <div class="jb-goal-row">
          <div class="jb-goal-top">
            <span>${escapeHtml(p.label)}</span>
            <span class="mono" style="color:${p.pct >= 100 ? '#6ee7b7' : '#fde68a'};">${p.pct}%</span>
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
      <div class="jb-stat-box"><span>💵 Cash / 🏦 Bank</span><strong class="mono">$${simMe.cash} / $${simMe.savings}</strong></div>
      <div class="jb-stat-box"><span>💼 Current Job</span><strong>${jb ? `${escapeHtml(jb.title)} ($${Math.max(simMe.hourlyWage, jb.baseWage)}/h)` : 'Unemployed'}</strong></div>
      <div class="jb-stat-box"><span>🍔 Food / 🏠 Home</span><strong>${simMe.foodWeeks} wk · ${simMe.aptTier === 1 ? 'LeSecurity' : 'Shady Acres'}${simMe.rentDebt > 0 ? ` (-$${simMe.rentDebt})` : ''}</strong></div>
      <div class="jb-stat-box"><span>👔 Outfit / 🤖 Tech</span><strong>${DRESS_NAMES[effectiveClothesTier(simMe)].split(' ')[0]} · ${ownedApps || 'None'}</strong></div>
    `;
  }

  // Rivals List
  if (!gameState || !gameState.seats.length) {
    rivalsMount.innerHTML = `
      <div class="jb-rival-card">
        <img src="/assets/jones/rival_jones.jpg" alt="Jones" class="jb-rival-avatar" />
        <div>
          <div style="font-weight:800;font-size:0.8rem;color:#fef08a;">🕶️ Rival “Jones”</div>
          <div style="font-size:0.7rem;color:#94a3b8;">Waiting at Sunnyvale Plaza with his golden pocket watch!</div>
        </div>
      </div>
    `;
  } else {
    document.getElementById('lblSeatCount').textContent = `${gameState.seatCount} Seats`;
    const others = gameState.seats.filter((s) => s.seatIdx !== gameState.viewerSeat);
    rivalsMount.innerHTML = others
      .map((s) => {
        const bp = BOT_PROFILES[s.isBot] || { art: '/assets/jones/town_center.jpg' };
        const sj = getJob(s.jobId);
        return `
          <div class="jb-rival-card">
            <img src="${bp.art}" alt="Seat" class="jb-rival-avatar" />
            <div>
              <div style="display:flex;justify-content:space-between;gap:6px;font-size:0.76rem;font-weight:800;">
                <span>${escapeHtml(seatDisplayName(s))}</span>
                <span class="mono" style="color:#7dd3fc;">$${s.netWealth.toLocaleString()}</span>
              </div>
              <div style="font-size:0.67rem;color:#94a3b8;">
                ${sj ? escapeHtml(sj.title) : 'Job Hunting'} · ${s.degreesMask.toString(2).replace(/0/g, '').length} Deg
              </div>
              <div class="jb-mini-pillars">
                <span class="jb-mini-pil">💰${s.goalPcts[0]}%</span>
                <span class="jb-mini-pil">😊${s.goalPcts[1]}%</span>
                <span class="jb-mini-pil">🎓${s.goalPcts[2]}%</span>
                <span class="jb-mini-pil">💼${s.goalPcts[3]}%</span>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Weekend Gazette
  if (!gameState || !gameState.logs.length) {
    gazetteMount.innerHTML = `<div style="font-size:0.74rem;color:#94a3b8;">Weekend headlines appear here at the end of every 60-hour week!</div>`;
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
              <span class="mono" style="color:#fbbf24;font-weight:800;">Wk ${lg.week}:</span>
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
    mount.innerHTML = `<div style="font-size:0.76rem;color:#94a3b8;">No boards listed yet on this HFS—create one above!</div>`;
    return;
  }
  mount.innerHTML = directoryGames
    .slice()
    .reverse()
    .map((g) => {
      const phaseTxt =
        g.phase === PHASE_LOBBY ? '🟢 Open Lobby' : g.phase === PHASE_ACTIVE ? `🕰️ Week ${g.weekNumber}` : '🏆 Finished';
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
    <div class="jb-field-label">💼 All 12 Progressive Sunnyvale Careers</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px;">
      ${JOBS.map(
        (j) => `
        <div class="jb-stat-box">
          <span>Rank ${j.rank} · ${BUILDINGS[j.workplace].icon} ${escapeHtml(BUILDINGS[j.workplace].name)}</span>
          <strong>${escapeHtml(j.title)} — $${j.baseWage}/hr ($${j.baseWage * 6}/shift)</strong>
          <div style="font-size:0.66rem;color:#94a3b8;">Outfit: ${DRESS_NAMES[j.dress]} · Exp ${j.reqExp} · Dep ${j.reqDep}</div>
        </div>
      `
      ).join('')}
    </div>
    <div class="jb-field-label" style="margin-top:8px;">🤖 6 Socket City Appliances (Z-Mart sells Refurb Fridge/Microwave/TV at 15% off!)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px;">
      ${APPLIANCES.map(
        (a) => `
        <div class="jb-stat-box">
          <span>Base $${a.basePrice} · +${a.hap} Happiness</span>
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
      selectedBuilding = Number(tileEl.getAttribute('data-building-id'));
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
      const lbl = qBtn.getAttribute('data-q-lbl') || 'Step';
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
    subtitle: 'Cozy 1–4 Player Career, University & Life-Sim Board Game • 60-Hour Weeks • $0.00 Gas',
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
