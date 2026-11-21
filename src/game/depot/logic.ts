import type { busColors } from './stages';

export type DepotColor = keyof typeof busColors;
export type DepotLayout = 'compact' | 'promenade';
export const CURRENT_FLEET_VERSION = 4;
export type DepotFleetVersion = 1 | 2 | 3 | typeof CURRENT_FLEET_VERSION;
export type DepotQueueMode = 'left-first' | 'alternating';
export type BusPhase = 'parked' | 'driving' | 'boarding' | 'leaving' | 'gone';
export type Point = { x: number; y: number };
export type DepotPose = Point & { angle: number };
type Waypoint = Point & { distance: number };

export interface DepotBus extends DepotPose {
  id: string;
  color: DepotColor;
  blind: boolean;
  length: number;
  width: number;
  capacity: number;
  boarded: number;
  phase: BusPhase;
  bay: number | null;
  route: Waypoint[];
  traveled: number;
}

export interface DepotPassenger {
  id: number;
  color: DepotColor;
  carrier: number;
  busId: string | null;
  walking: number;
  boardingTrip?: { start: number; arrival: number };
  from: Point;
}

interface QueueAdmission {
  id: number;
  carrier: number;
  from: number;
  start: number;
  join: number;
}

export interface DepotState {
  layout: DepotLayout;
  queueMode: DepotQueueMode;
  fleetVersion: DepotFleetVersion;
  level: number;
  status: 'playing' | 'won' | 'lost';
  buses: DepotBus[];
  passengers: DepotPassenger[];
  queue: DepotColor[];
  lineOffset: number;
  rightLineOffset: number;
  entering: QueueAdmission[];
  elapsed: number;
  beltTime: number;
  steadyBelt?: { elapsed: number; beltTime: number };
  acceleratedFrames: number;
  totalPassengers: number;
  boardedCount: number;
}

export const BAY_X = [100, 200, 300] as const;
export const BAY_Y = 265;
const bays = {
  compact: { xs: [41, 94, 147, 200, 253, 306, 359] as readonly number[], y: 314, angle: -40 },
  promenade: { xs: BAY_X as readonly number[], y: BAY_Y, angle: 0 },
};
export function bayGeometry(layout: DepotLayout) {
  return bays[layout];
}
const roads = {
  compact: { left: 13, right: 387, top: 350, bottom: 663 },
  promenade: { left: 16, right: 384, top: 322, bottom: 712 },
};
const WALK_DURATION = 0.54;
const SIMULATION_SECONDS_PER_SECOND = 2.5;
// Durations on the simulation clock for a 280 ms walk and 50 ms between seats in live play.
const MIN_BOARDING_WALK = 0.28 * SIMULATION_SECONDS_PER_SECOND;
const SEAT_INTERVAL = 0.05 * SIMULATION_SECONDS_PER_SECOND;
const LEGACY_BUS_SPEED = 305;
const BUS_SPEED = LEGACY_BUS_SPEED * 1.6;
const PREVIOUS_BOARDING_PACE = 2.75;
const FRAME_RATE = 60;
const BELT_SPEED = 86;
export const BELT_LANES = 4;
const rowGap = { compact: 9.3, promenade: 12 };

function beltGeometry(
  width: number,
  height: number,
  bottom: number,
  radius: number,
  rows: number,
  mergeX: number,
) {
  const straight = width - 2 * radius;
  const side = height - 2 * radius;
  const arc = (Math.PI * radius) / 2;
  const halfLap = straight + arc * 2 + side;
  const leftCenter = 200 - straight / 2;
  const rightCenter = 200 + straight / 2;
  return {
    radius,
    straight,
    side,
    arc,
    halfLap,
    lap: 2 * halfLap,
    leftCenter,
    rightCenter,
    bottom,
    top: bottom - height,
    rows,
    capacity: rows * BELT_LANES,
    entrance: halfLap + rightCenter - mergeX,
  };
}
const belts = {
  compact: beltGeometry(178, 75, 252, 36, 42, 200),
  promenade: beltGeometry(310, 125, 210, 45, 72, 195),
};
export function beltCapacity(layout: DepotLayout) {
  return belts[layout].capacity;
}

export const FEEDER_PATHS = {
  left: 'M 62 -16 V 150 C 62 190 111 180 111 214.5',
  right: 'M 338 -16 V 150 C 338 190 289 180 289 214.5',
} as const;
export const QUEUE_PATHS = {
  compact: `${FEEDER_PATHS.left} ${FEEDER_PATHS.right}`,
  promenade: 'M 55 58 Q 65 54 78 54 H 200 A 15.5 15.5 0 0 1 200 85 H 195',
} as const;
function feederCurve(t: number) {
  const u = 1 - t;
  return {
    x: 62 * (u * u * u + 3 * u * u * t) + 111 * (3 * u * t * t + t * t * t),
    y: 150 * u * u * u + 3 * 190 * u * u * t + 3 * 180 * u * t * t + 214.5 * t * t * t,
    dx: 294 * u * t,
    dy: 120 * u * u - 60 * u * t + 103.5 * t * t,
  };
}
const feederSamples: number[] = [166];
for (let i = 1; i <= 32; i++) {
  const a = feederCurve((i - 1) / 32);
  const b = feederCurve(i / 32);
  feederSamples.push(feederSamples[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
}
const APPROACH_CURVE = 23.45;
const APPROACH_STRAIGHT = 122;
const APPROACH_TURN = Math.PI * 15.5;
const lineLengths = {
  compact: feederSamples[32],
  promenade: APPROACH_CURVE + APPROACH_STRAIGHT + APPROACH_TURN + 5,
};
const RAD = Math.PI / 180;

type BusSpec = [color: DepotColor, x: number, y: number, angle: number, capacity: number];
type Level = { buses: BusSpec[]; order: number[]; blind?: boolean };

const levels: Level[] = [
  {
    buses: [
      ['blue', 82, 411, -25, 32],
      ['coral', 185, 403, 90, 32],
      ['yellow', 294, 407, 35, 32],
      ['coral', 77, 500, -72, 32],
      ['blue', 170, 488, 0, 40],
      ['coral', 272, 493, 90, 32],
      ['yellow', 83, 581, -72, 32],
      ['yellow', 172, 578, -90, 32],
      ['blue', 266, 574, 0, 32],
      ['yellow', 107, 657, 90, 32],
      ['coral', 207, 655, 208, 32],
      ['yellow', 312, 648, 68, 32],
    ],
    order: [0, 2, 1, 11, 4, 3, 6, 5, 10, 7, 8, 9],
  },
  {
    buses: [
      ['coral', 77, 397, 90, 32],
      ['yellow', 173, 394, -31, 32],
      ['orange', 265, 400, 62, 40],
      ['mint', 317, 470, 180, 32],
      ['blue', 80, 476, 180, 32],
      ['coral', 171, 482, 52, 32],
      ['blue', 249, 492, -10, 32],
      ['orange', 89, 562, 130, 32],
      ['mint', 171, 572, -16, 40],
      ['yellow', 265, 574, -90, 32],
      ['mint', 82, 654, -90, 32],
      ['coral', 176, 655, -90, 32],
      ['orange', 268, 651, 90, 32],
    ],
    order: [1, 2, 0, 10, 11, 12, 3, 5, 6, 8, 7, 4, 9],
  },
  {
    buses: [
      ['mint', 82, 398, -36, 32],
      ['blue', 168, 401, 90, 40],
      ['yellow', 255, 401, 90, 32],
      ['coral', 325, 408, 0, 32],
      ['purple', 76, 475, 0, 32],
      ['orange', 158, 487, -90, 32],
      ['indigo', 246, 484, 20, 32],
      ['white', 318, 493, 180, 32],
      ['yellow', 81, 563, 90, 32],
      ['purple', 169, 562, 90, 32],
      ['coral', 257, 573, -15, 32],
      ['blue', 87, 653, 213, 32],
      ['yellow', 175, 650, -90, 40],
      ['white', 273, 651, 62, 32],
    ],
    order: [3, 2, 4, 5, 6, 10, 9, 8, 12, 0, 1, 11, 13, 7],
    blind: true,
  },
];
export const LEVEL_COUNT = levels.length;

const previousPalettes: DepotColor[][] = [
  ['blue', 'yellow', 'coral'],
  ['blue', 'yellow', 'coral', 'mint', 'orange'],
  ['blue', 'yellow', 'coral', 'mint', 'orange', 'purple', 'indigo', 'white'],
];
const fleetColors: DepotColor[] = [
  'blue',
  'yellow',
  'coral',
  'sky',
  'gray',
  'mint',
  'orange',
  'purple',
  'indigo',
  'white',
];
const compactPalettes = [5, 8, 10].map((count) => fleetColors.slice(0, count));
const previousShapes = [
  { length: 36, width: 27, capacity: 16 },
  { length: 41, width: 29, capacity: 20 },
  { length: 47, width: 30, capacity: 24 },
];
const currentShapes = [
  { length: 36, width: 27, capacity: 16 },
  { length: 39, width: 28, capacity: 24 },
  { length: 43, width: 29, capacity: 32 },
  { length: 47, width: 30, capacity: 48 },
];
function makeCompactFleet(stage: number, version: DepotFleetVersion) {
  const shapes = version === 1 ? previousShapes : currentShapes;
  const model = (size: number, variation: number) =>
    version === 1 ? size : size === 0 ? 0 : size === 2 ? 3 : 1 + (variation % 2);
  const buses: DepotBus[] = [];
  const palette = (version < 3 ? previousPalettes : compactPalettes)[stage];
  const add = (x: number, y: number, angle: number, color: DepotColor, shape: number) => {
    buses.push({
      id: `bus-${buses.length + 1}`,
      color,
      x,
      y,
      angle,
      ...shapes[shape],
      blind: stage === 2,
      boarded: 0,
      phase: 'parked',
      bay: null,
      route: [],
      traveled: 0,
    });
  };
  for (let side = 0; side < 2; side++) {
    for (let row = 0; row < 8; row++) {
      const index = side * 8 + row;
      const color =
        row % 2 === 0
          ? palette[(row / 2 + side) % 2]
          : palette[2 + (Math.floor(index / 2) % (palette.length - 2))];
      const shape = row % 2 === 0 ? 2 - ((row / 2) % 2) : (index + stage) % 3;
      const corner = version >= 4 && row === 0;
      const angle = corner ? 55 : 90;
      add(
        side ? 351 : 49,
        corner ? 380 : 389 + row * 32,
        side ? angle : -angle,
        color,
        model(shape, row + side + stage),
      );
    }
  }
  const rowCenters = version >= 4 ? [375, 417, 459, 510, 561, 612, 663] : [389, 433, 476, 520, 563, 607, 650];
  for (const [row, y] of rowCenters.entries()) {
    // Keep neighboring bodies close and leave the extra width as one alley,
    // so consecutive rows can interlock instead of reading as separate icons.
    const count = row % 2 === 0 ? 6 : 5;
    const diagonalRow = version >= 4 && (row === 3 || row === 5);
    const cars = Array.from({ length: count }, (_, col) => {
      const across = (row * 3 + col * 2 + stage) % 5 < 2;
      const angle = across ? (col < count / 2 ? -90 : 90) : 0;
      const size = across ? (row + col + stage) % 3 : row % 2 === 0 ? 1 + ((col + stage) % 2) : 0;
      const shape = model(size, row + col + stage);
      const footprint = across ? shapes[shape].length : shapes[shape].width;
      return { angle, shape, footprint };
    });
    const packed = cars.reduce((sum, car) => sum + car.footprint, 0) + (count - 1) * 3.5;
    const spare = Math.max(0, 244 - packed);
    const alley = (row + stage) % count;
    let left = 78 + spare * 0.15;
    for (const [col, car] of cars.entries()) {
      if (col === alley) left += spare * 0.7;
      add(
        diagonalRow ? 108 + 46 * col : left + car.footprint / 2,
        y,
        diagonalRow ? (row === 3 ? -45 : 45) : car.angle,
        palette[(row * 3 + col + stage) % palette.length],
        car.shape,
      );
      left += car.footprint + 3.5;
    }
  }
  add(49, 645, -90, palette[1], model(1, stage));
  add(351, 645, 90, palette[0], 0);
  // Build a service order from the real exit constraints, starting with the accessible outer rows.
  const blockers = buses.map((bus) =>
    buses.flatMap((other, i) =>
      other !== bus && hitsOnExit(bus, other, other, laneExit('compact', bus).t) ? [i] : [],
    ),
  );
  const priority = [0, 2, 4, 6, 8, 10, 12, 14];
  for (let i = 0; i < buses.length - 16; i++) {
    if (i < 8) priority.push(2 * i + 1);
    priority.push(16 + i);
  }
  const remaining = new Set(priority);
  const order: number[] = [];
  while (remaining.size) {
    const next = priority.find((i) => remaining.has(i) && blockers[i].every((j) => !remaining.has(j)));
    if (next === undefined) throw new Error('주차장에서 출차할 수 없는 차량 배치입니다.');
    remaining.delete(next);
    order.push(next);
  }
  return { buses, order };
}
const compactRounds = {
  1: [0, 1, 2].map((stage) => makeCompactFleet(stage, 1)),
  2: [0, 1, 2].map((stage) => makeCompactFleet(stage, 2)),
  3: [0, 1, 2].map((stage) => makeCompactFleet(stage, 3)),
  4: [0, 1, 2].map((stage) => makeCompactFleet(stage, 4)),
};
function serviceOrder(index: number, layout: DepotLayout, version: DepotFleetVersion) {
  return layout === 'compact' ? compactRounds[version][index].order : levels[index].order;
}

type PassengerGroup = [color: DepotColor, seats: number];

const previousOpening: PassengerGroup[] = [
  ['blue', 12],
  ['yellow', 32],
  ['blue', 12],
  ['yellow', 40],
  ['blue', 8],
  ['yellow', 64],
  ['coral', 16],
  ['yellow', 16],
  ['blue', 16],
];

function openingGroups(stage: number): PassengerGroup[] {
  // The opening loop has 32 blue and 48 yellow riders. Distribute the remaining
  // rows among the other unlocked colors, keeping groups four passengers wide.
  const colors = compactPalettes[stage].slice(2);
  const rows = (beltCapacity('compact') - 32 - 48) / BELT_LANES;
  const groups = colors.map<PassengerGroup>((color, i) => [
    color,
    (Math.floor(rows / colors.length) + Number(i < rows % colors.length)) * BELT_LANES,
  ]);
  const middle = Math.ceil(groups.length / 2);
  return [
    ['blue', 12],
    ['yellow', 24],
    ...groups.slice(0, middle),
    ['blue', 12],
    ['yellow', 24],
    ...groups.slice(middle),
    ['blue', 8],
    // The final 16 blue riders wait beyond the 32 spaces freed by the first coach.
    ['yellow', 32],
    ['blue', 16],
  ];
}

function passengerSequence(buses: DepotBus[], order: number[], version: DepotFleetVersion, stage: number) {
  if (version === 1) return order.flatMap((i) => Array<DepotColor>(buses[i].capacity).fill(buses[i].color));
  const opening = version === 2 ? previousOpening : openingGroups(stage);
  const queue: DepotColor[] = [];
  const used = new Map<DepotColor, number>();
  for (const [color, seats] of opening) {
    queue.push(...Array<DepotColor>(seats).fill(color));
    used.set(color, (used.get(color) ?? 0) + seats);
  }
  let following: DepotColor[] = [];
  for (const i of order) {
    const { color, capacity } = buses[i];
    const allocated = Math.min(used.get(color) ?? 0, capacity);
    used.set(color, (used.get(color) ?? 0) - allocated);
    const seats = capacity - allocated;
    if (!seats) continue;
    const first = capacity === 48 ? Math.min(seats, 24) : seats;
    queue.push(...Array<DepotColor>(first).fill(color), ...following);
    following = Array<DepotColor>(seats - first).fill(color);
  }
  queue.push(...following);
  return queue;
}

export function createDepot(
  level = 1,
  layout: DepotLayout = 'compact',
  queueMode: DepotQueueMode = 'left-first',
  fleetVersion: DepotFleetVersion = CURRENT_FLEET_VERSION,
  steadyBelt = true,
): DepotState {
  const index = Number.isInteger(level) && level >= 1 && level <= levels.length ? level - 1 : 0;
  const definition = levels[index];
  const buses =
    layout === 'compact'
      ? compactRounds[fleetVersion][index].buses.map((bus) => ({ ...bus, route: [] }))
      : definition.buses.map<DepotBus>(([color, x, y, angle, capacity], idx) => ({
          id: `bus-${idx + 1}`,
          color,
          blind: definition.blind === true,
          x,
          y,
          angle,
          capacity,
          length: capacity === 40 ? 77 : 67,
          width: 32,
          boarded: 0,
          phase: 'parked',
          bay: null,
          route: [],
          traveled: 0,
        }));
  const version = layout === 'compact' ? fleetVersion : 1;
  const queue = passengerSequence(buses, serviceOrder(index, layout, version), version, index);
  const totalPassengers = queue.length;
  const passengers = queue.splice(0, beltCapacity(layout)).map((color, i) => newPassenger(i, color, i));
  return {
    layout,
    queueMode: layout === 'compact' ? queueMode : 'alternating',
    fleetVersion: version,
    level: index + 1,
    status: 'playing',
    elapsed: 0,
    beltTime: 0,
    steadyBelt: steadyBelt ? { elapsed: 0, beltTime: 0 } : undefined,
    acceleratedFrames: 0,
    buses,
    queue,
    lineOffset: 0,
    rightLineOffset: 0,
    entering: [],
    passengers,
    totalPassengers,
    boardedCount: 0,
  };
}

function newPassenger(id: number, color: DepotColor, carrier: number): DepotPassenger {
  return { id, color, carrier, busId: null, walking: 0, from: { x: 0, y: 0 } };
}

// Four passengers travel abreast in each row, including around the bends.
function beltDistance(layout: DepotLayout, carrier: number, time: number) {
  const { lap, rows } = belts[layout];
  return (Math.floor(carrier / BELT_LANES) * (lap / rows) + BELT_SPEED * time) % lap;
}

// The first half starts on the bottom straight and ends at the top right.
// Reflecting it across the center gives the return journey.
function beltPose(layout: DepotLayout, distance: number, lane: number): DepotPose {
  const { halfLap, straight, side, arc, radius, leftCenter, rightCenter, bottom, top } = belts[layout];
  const second = distance >= halfLap;
  const d = distance % halfLap;
  let x: number;
  let y: number;
  let angle: number;
  const offsetRadius = radius + lane;
  if (d < straight) {
    x = leftCenter + d;
    y = bottom + lane;
    angle = 90;
  } else if (d < straight + arc) {
    const theta = Math.PI / 2 - (d - straight) / radius;
    x = rightCenter + offsetRadius * Math.cos(theta);
    y = bottom - radius + offsetRadius * Math.sin(theta);
    angle = theta / RAD;
  } else if (d < straight + arc + side) {
    x = rightCenter + offsetRadius;
    y = bottom - radius - (d - straight - arc);
    angle = 0;
  } else {
    const theta = -(d - straight - arc - side) / radius;
    x = rightCenter + offsetRadius * Math.cos(theta);
    y = top + radius + offsetRadius * Math.sin(theta);
    angle = theta / RAD;
  }
  return second ? { x: 400 - x, y: bottom + top - y, angle: angle + 180 } : { x, y, angle };
}

function laneOf(layout: DepotLayout, carrier: number) {
  return ((carrier % BELT_LANES) - 1.5) * (layout === 'compact' ? 10.5 : 7.5);
}

type FeederSide = 'left' | 'right';
function rightFrontId(state: DepotState) {
  const belt = beltCapacity(state.layout);
  const waitingRows = (state.totalPassengers - belt) / BELT_LANES;
  return belt + Math.round(waitingRows / 2) * BELT_LANES;
}

function sideOf(state: DepotState, id: number): FeederSide {
  if (state.layout === 'promenade') return 'left';
  if (state.queueMode === 'left-first') return id < rightFrontId(state) ? 'left' : 'right';
  const row = Math.floor((id - beltCapacity(state.layout)) / BELT_LANES);
  return Math.floor(row / 4) % 2 === 1 ? 'right' : 'left';
}

export function activeQueueSide(state: DepotState): FeederSide | null {
  return state.queue.length ? sideOf(state, state.totalPassengers - state.queue.length) : null;
}

function waitingDistance(state: DepotState, offset: number, id: number) {
  const { layout, queueMode } = state;
  const stop = lineLengths[layout] - 21;
  const row = Math.floor((id - beltCapacity(layout)) / BELT_LANES);
  let localRow = row;
  if (layout === 'compact') {
    if (queueMode === 'alternating') localRow = Math.floor(row / 8) * 4 + (row % 4);
    else if (id >= rightFrontId(state)) localRow = Math.floor((id - rightFrontId(state)) / BELT_LANES);
  }
  return Math.min(stop, stop + offset - localRow * rowGap[layout]);
}

function linePose(layout: DepotLayout, distance: number, lane: number, side: FeederSide): DepotPose {
  if (layout === 'compact') {
    let x = 62,
      y = distance - 16,
      dx = 0,
      dy = 1;
    if (distance > 166) {
      const j = feederSamples.findIndex((d) => d >= distance);
      const i = j < 1 ? 32 : j;
      const t = (i - 1 + (distance - feederSamples[i - 1]) / (feederSamples[i] - feederSamples[i - 1])) / 32;
      ({ x, y, dx, dy } = feederCurve(Math.min(t, 1)));
    }
    const size = Math.hypot(dx, dy);
    x -= (dy * lane) / size;
    y += (dx * lane) / size;
    const sign = side === 'right' ? -1 : 1;
    return { x: side === 'right' ? 400 - x : x, y, angle: Math.atan2(dx * sign, -dy) / RAD };
  }
  const APPROACH_LENGTH = lineLengths.promenade;
  let x: number;
  let y: number;
  let dx: number;
  let dy: number;
  if (distance < APPROACH_CURVE) {
    const t = distance / APPROACH_CURVE;
    const u = 1 - t;
    x = u * u * 55 + 2 * u * t * 65 + t * t * 78;
    y = u * u * 58 + 2 * u * t * 54 + t * t * 54;
    dx = 2 * u * 10 + 2 * t * 13;
    dy = -8 * u;
  } else if (distance < APPROACH_CURVE + APPROACH_STRAIGHT) {
    x = 78 + distance - APPROACH_CURVE;
    y = 54;
    dx = 1;
    dy = 0;
  } else if (distance < APPROACH_LENGTH - 5) {
    const t = (distance - APPROACH_CURVE - APPROACH_STRAIGHT) / 15.5 - Math.PI / 2;
    x = 200 + 15.5 * Math.cos(t);
    y = 69.5 + 15.5 * Math.sin(t);
    dx = -Math.sin(t);
    dy = Math.cos(t);
  } else {
    x = 195 + APPROACH_LENGTH - distance;
    y = 85;
    dx = -1;
    dy = 0;
  }
  const magnitude = Math.hypot(dx, dy);
  return { x: x - (dy * lane) / magnitude, y: y + (dx * lane) / magnitude, angle: Math.atan2(dx, -dy) / RAD };
}

function targetOffset(state: DepotState, admitted: number, side: FeederSide) {
  const { layout, queueMode } = state;
  const rows = Math.floor(admitted / BELT_LANES);
  if (layout === 'promenade') return rows * rowGap[layout];
  if (queueMode === 'left-first') {
    const leftRows = (rightFrontId(state) - beltCapacity(layout)) / BELT_LANES;
    const advanced = side === 'left' ? Math.min(rows, leftRows) : Math.max(0, rows - leftRows);
    return advanced * rowGap[layout];
  }
  const remainder = rows % 8;
  const sideRows = side === 'left' ? Math.min(4, remainder) : Math.max(0, remainder - 4);
  return (Math.floor(rows / 8) * 4 + sideRows) * rowGap[layout];
}

export function restoreLeftFirstQueue(state: DepotState): DepotState {
  if (state.layout !== 'compact' || state.queueMode === 'left-first') return state;
  const next: DepotState = { ...state, queueMode: 'left-first', entering: [] };
  const admitted = next.totalPassengers - next.queue.length - beltCapacity(next.layout);
  return {
    ...next,
    lineOffset: targetOffset(next, admitted, 'left'),
    rightLineOffset: targetOffset(next, admitted, 'right'),
  };
}

function approachOffset(state: DepotState, side: FeederSide = 'left') {
  const admitted =
    state.totalPassengers - state.queue.length - beltCapacity(state.layout) + state.entering.length;
  return targetOffset(state, admitted, side);
}
function lineClosing(state: DepotState) {
  return (
    state.lineOffset < approachOffset(state) ||
    (state.layout === 'compact' && state.rightLineOffset < approachOffset(state, 'right'))
  );
}

export function queuePoses(state: DepotState) {
  const head = state.totalPassengers - state.queue.length;
  const poses: (DepotPose & { id: number; color: DepotColor; moving: boolean; side: FeederSide })[] = [];

  for (let i = 0; i < state.queue.length; i++) {
    const id = head + i;
    const admission = state.entering[i];
    const side = sideOf(state, id);
    const offset = side === 'left' ? state.lineOffset : state.rightLineOffset;
    let distance = waitingDistance(state, offset, id);
    let lane = laneOf(state.layout, id);
    if (admission) {
      const t = Math.max(
        0,
        Math.min(1, (state.beltTime - admission.start) / (admission.join - admission.start)),
      );
      distance = admission.from + (lineLengths[state.layout] - admission.from) * t;
      lane += (laneOf(state.layout, admission.carrier) - lane) * t;
    }
    if (distance < 0) {
      if (state.queueMode === 'left-first') {
        if (side === 'right') break;
        i = rightFrontId(state) - head - 1;
        continue;
      }
      if (state.layout === 'promenade' || i > poses.length + 8 * BELT_LANES) break;
      continue;
    }
    poses.push({
      id,
      color: state.queue[i],
      ...linePose(state.layout, distance, lane, side),
      side,
      moving: !!admission || offset < approachOffset(state, side),
    });
  }
  return poses;
}

export function isBlindBus(state: DepotState, bus: DepotBus) {
  return bus.blind && bus.phase === 'parked' && getBlockers(state, bus.id).length > 0;
}

export function passengerPose(state: DepotState, p: DepotPassenger): DepotPose {
  if (p.busId === null)
    return beltPose(
      state.layout,
      beltDistance(state.layout, p.carrier, state.beltTime),
      laneOf(state.layout, p.carrier),
    );
  const bus = state.buses.find((b) => b.id === p.busId);
  const bay = bayGeometry(state.layout);
  const target = { x: bay.xs[bus?.bay ?? 0] + (state.layout === 'compact' ? 7 : 14), y: bay.y - 9 };
  const fraction = Math.min(1, p.walking / WALK_DURATION);
  let from = p.from;
  let to = target;
  let t = fraction;
  if (state.layout === 'compact') {
    const gate = { x: 200 + laneOf(state.layout, p.carrier) * 0.2, y: 270 };
    const a = Math.hypot(gate.x - from.x, gate.y - from.y);
    const b = Math.hypot(to.x - gate.x, to.y - gate.y);
    const progress = fraction * (a + b);
    if (progress <= a) {
      to = gate;
      t = progress / a;
    } else {
      from = gate;
      t = (progress - a) / b;
    }
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { x: from.x + dx * t, y: from.y + dy * t, angle: Math.atan2(dx, -dy) / RAD };
}

function forward(angle: number): Point {
  return { x: Math.sin(angle * RAD), y: -Math.cos(angle * RAD) };
}

function laneExit(layout: DepotLayout, p: DepotPose) {
  const ROAD = roads[layout];
  const v = forward(p.angle);
  const tx = Math.abs(v.x) < 1e-8 ? Infinity : ((v.x > 0 ? ROAD.right : ROAD.left) - p.x) / v.x;
  const ty = Math.abs(v.y) < 1e-8 ? Infinity : ((v.y > 0 ? ROAD.bottom : ROAD.top) - p.y) / v.y;
  const t = Math.min(tx, ty);
  return { x: p.x + v.x * t, y: p.y + v.y * t, t, side: tx < ty ? 'side' : v.y < 0 ? 'top' : 'bottom' };
}

function dot(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y;
}

// Intersect the time intervals in which two oriented rectangles overlap on each separating axis.
function hitsOnExit(bus: DepotBus, other: DepotBus, pose: DepotPose, limit: number): boolean {
  const dir = forward(bus.angle);
  const right = { x: -dir.y, y: dir.x };
  const otherDir = forward(pose.angle);
  const otherRight = { x: -otherDir.y, y: otherDir.x };
  const offset = { x: pose.x - bus.x, y: pose.y - bus.y };
  let entry = 0;
  let exit = limit;
  for (const axis of [dir, right, otherDir, otherRight]) {
    const gap = dot(offset, axis);
    const speed = dot(dir, axis);
    const reach =
      (bus.length * Math.abs(dot(dir, axis)) +
        bus.width * Math.abs(dot(right, axis)) +
        other.length * Math.abs(dot(otherDir, axis)) +
        other.width * Math.abs(dot(otherRight, axis))) /
      2;
    if (Math.abs(speed) < 1e-8) {
      if (Math.abs(gap) >= reach) return false;
      continue;
    }
    const a = (gap - reach) / speed;
    const b = (gap + reach) / speed;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry >= exit) return false;
  }
  return true;
}

export function getBlockers(state: DepotState, id: string): string[] {
  const bus = state.buses.find((v) => v.id === id);
  if (bus?.phase !== 'parked') return [];
  const limit = laneExit(state.layout, bus).t;
  return state.buses
    .filter((other) => {
      if (other.id === id) return false;
      if (other.phase === 'parked') return hitsOnExit(bus, other, other, limit);
      if (other.phase !== 'driving' || other.traveled >= laneExit(state.layout, other).t) return false;
      return hitsOnExit(bus, other, busPose(state, other), limit);
    })
    .map((v) => v.id);
}

function freeBay(state: DepotState) {
  return bayGeometry(state.layout).xs.findIndex((_, i) => !state.buses.some((bus) => bus.bay === i));
}

function roundedRoute(points: Point[]): Waypoint[] {
  const clean = points.filter(
    (p, i) => !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.001,
  );
  const path: Waypoint[] = [];
  const add = (p: Point) => {
    const last = path.at(-1);
    const gap = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0;
    if (!last || gap > 0.001) path.push({ x: p.x, y: p.y, distance: (last?.distance ?? 0) + gap });
  };
  add(clean[0]);
  for (let i = 1; i + 1 < clean.length; i++) {
    const corner = clean[i];
    const before = clean[i - 1];
    const after = clean[i + 1];
    const a = Math.hypot(corner.x - before.x, corner.y - before.y);
    const b = Math.hypot(after.x - corner.x, after.y - corner.y);
    const radius = Math.min(20, a / 2, b / 2);
    const start = {
      x: corner.x + ((before.x - corner.x) * radius) / a,
      y: corner.y + ((before.y - corner.y) * radius) / a,
    };
    const end = {
      x: corner.x + ((after.x - corner.x) * radius) / b,
      y: corner.y + ((after.y - corner.y) * radius) / b,
    };
    add(start);
    for (let step = 1; step <= 6; step++) {
      const t = step / 6;
      const u = 1 - t;
      add({
        x: u * u * start.x + 2 * u * t * corner.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * corner.y + t * t * end.y,
      });
    }
  }
  add(clean[clean.length - 1]);
  return path;
}

function routeToBay(layout: DepotLayout, bus: DepotBus, bay: number) {
  const ROAD = roads[layout];
  const station = bayGeometry(layout);
  const exit = laneExit(layout, bus);
  const points: Point[] = [bus, exit];
  if (exit.side === 'bottom') {
    const side = exit.x < 200 ? ROAD.left : ROAD.right;
    points.push({ x: side, y: ROAD.bottom }, { x: side, y: ROAD.top });
  } else if (exit.side === 'side') {
    points.push({ x: exit.x, y: ROAD.top });
  }
  const approachX = station.xs[bay] - (ROAD.top - station.y) * Math.tan(station.angle * RAD);
  points.push({ x: approachX, y: ROAD.top }, { x: station.xs[bay], y: station.y });
  return roundedRoute(points);
}

export function busPose(state: DepotState, bus: DepotBus): DepotPose {
  if (bus.phase === 'parked') return { x: bus.x, y: bus.y, angle: bus.angle };
  if (bus.phase === 'boarding') {
    const { xs, y, angle } = bayGeometry(state.layout);
    return { x: xs[bus.bay ?? 0], y, angle };
  }
  const path = bus.route;
  if (!path.length) return { x: bus.x, y: bus.y, angle: bus.angle };
  const index = path.findIndex((p) => p.distance > bus.traveled);
  const next = path[index < 0 ? path.length - 1 : index];
  const prev = path[index < 0 ? path.length - 2 : Math.max(index - 1, 0)];
  const fraction = Math.min(1, (bus.traveled - prev.distance) / (next.distance - prev.distance || 1));
  return {
    x: prev.x + (next.x - prev.x) * fraction,
    y: prev.y + (next.y - prev.y) * fraction,
    angle: Math.atan2(next.x - prev.x, prev.y - next.y) / RAD,
  };
}

export function recommendBus(state: DepotState): string | undefined {
  if (state.status !== 'playing' || freeBay(state) < 0) return;
  const waiting = state.passengers.filter((p) => p.busId === null).map((p) => p.color);
  waiting.push(...state.queue.slice(0, beltCapacity(state.layout) - waiting.length));
  const available = serviceOrder(state.level - 1, state.layout, state.fleetVersion)
    .map((i) => state.buses[i])
    .filter((bus) => bus.phase === 'parked' && getBlockers(state, bus.id).length === 0);
  if (state.fleetVersion >= 2 && state.buses.every((bus) => bus.phase === 'parked')) return available[0]?.id;
  const canFill = available.find((bus) => {
    const reserved = state.buses
      .filter((b) => b.bay !== null && b.color === bus.color)
      .reduce((seats, b) => seats + b.capacity - b.boarded, 0);
    const walking = state.passengers.filter((p) => p.busId && p.color === bus.color).length;
    return waiting.filter((color) => color === bus.color).length + walking >= bus.capacity + reserved;
  });
  if (canFill) return canFill.id;
  // If an active bus can still make progress it may release a bay or admit the next group.
  if (canAdvance(state)) return;
  return available[0]?.id;
}

export interface DispatchResult {
  state: DepotState;
  reason?: 'blocked' | 'full' | 'unavailable';
  blockerId?: string;
}
export function dispatchBus(state: DepotState, id: string): DispatchResult {
  const bus = state.buses.find((v) => v.id === id);
  if (state.status !== 'playing' || !bus || bus.phase !== 'parked') return { state, reason: 'unavailable' };
  const [blockerId] = getBlockers(state, id);
  if (blockerId) return { state, reason: 'blocked', blockerId };
  const bay = freeBay(state);
  if (bay < 0) return { state, reason: 'full' };
  const updated: DepotBus = {
    ...bus,
    bay,
    phase: 'driving',
    route: routeToBay(state.layout, bus, bay),
    traveled: 0,
  };
  return { state: { ...state, buses: state.buses.map((b) => (b.id === id ? updated : b)) } };
}

function crosses(before: number, after: number, distance: number) {
  return after >= before ? before < distance && distance <= after : before < distance || distance <= after;
}

function departedRoute(layout: DepotLayout, bay: number) {
  if (layout === 'compact') {
    const x = bays.compact.xs[bay];
    return roundedRoute([
      { x, y: bays.compact.y },
      { x: x - 30, y: 278 },
      { x: 440, y: 278 },
    ]);
  }
  return roundedRoute([
    { x: BAY_X[bay], y: BAY_Y },
    { x: BAY_X[bay], y: 228 },
    { x: 450, y: 228 },
  ]);
}

function canAdvance(state: DepotState) {
  const { buses, passengers, queue } = state;
  if (
    state.entering.length ||
    (queue.length && (passengers.length < beltCapacity(state.layout) || lineClosing(state)))
  )
    return true;
  const boardingColors = new Set<DepotColor>();
  for (const bus of buses) {
    if (bus.phase === 'driving' || bus.phase === 'leaving') return true;
    if (bus.phase === 'boarding') boardingColors.add(bus.color);
  }
  return boardingColors.size > 0 && passengers.some((p) => p.busId !== null || boardingColors.has(p.color));
}

// Reserve the next real gap a short walk before it reaches the merge. The same
// passenger ID then transfers from the waiting line to that exact belt position.
function advanceQueue(state: DepotState, passengers: DepotPassenger[], before: number, elapsed: number) {
  const { queue } = state;
  if (
    !queue.length ||
    (!state.entering.length &&
      passengers.length === beltCapacity(state.layout) &&
      !lineClosing(state) &&
      passengers.every((p) => p.busId === null))
  ) {
    return {
      queue,
      entering: state.entering,
      lineOffset: state.lineOffset,
      rightLineOffset: state.rightLineOffset,
    };
  }
  const entering = [...state.entering];
  const occupied = new Set(passengers.filter((p) => p.busId === null).map((p) => p.carrier));
  for (const admission of entering) occupied.add(admission.carrier);
  const { lap, entrance, capacity, straight, arc, halfLap } = belts[state.layout];
  const firstId = state.totalPassengers - queue.length;
  const candidates = (side: FeederSide) => {
    const gate =
      state.layout === 'promenade'
        ? entrance
        : straight + arc + belts.compact.side / 2 + (side === 'left' ? halfLap : 0);
    const result: { carrier: number; wait: number }[] = [];
    for (let carrier = 0; carrier < capacity; carrier++) {
      if (occupied.has(carrier)) continue;
      const wait = ((gate - beltDistance(state.layout, carrier, before) + lap) % lap) / BELT_SPEED;
      if (wait > 0 && wait <= 0.62) result.push({ carrier, wait });
    }
    return result.sort((a, b) => a.wait - b.wait || a.carrier - b.carrier);
  };
  const active = activeQueueSide(state);
  const ordered = state.queueMode === 'left-first';
  const left = !ordered || active === 'left' ? candidates('left') : [];
  const right = state.layout === 'compact' && (!ordered || active === 'right') ? candidates('right') : [];
  while (entering.length < queue.length) {
    const id = firstId + entering.length;
    const side = sideOf(state, id);
    const list = side === 'left' ? left : right;
    const option = list.shift();
    if (!option) break;
    const { carrier, wait } = option;
    if (occupied.has(carrier)) continue;
    const join = before + wait;
    if (join + 1e-7 < (entering.at(-1)?.join ?? 0)) continue;
    const offset = side === 'left' ? state.lineOffset : state.rightLineOffset;
    const from = waitingDistance(state, offset, id);
    if (lineLengths[state.layout] - from > wait * 120) continue;
    entering.push({ id, from, carrier, start: before, join });
    occupied.add(carrier);
  }
  const admitted = firstId - capacity + entering.length;
  const walk = 97 * (elapsed - before);
  const lineOffset = Math.min(targetOffset(state, admitted, 'left'), state.lineOffset + walk);
  const rightLineOffset =
    state.layout === 'compact'
      ? Math.min(targetOffset(state, admitted, 'right'), state.rightLineOffset + walk)
      : 0;
  let transferred = 0;
  for (const admission of entering) {
    if (admission.join > elapsed + 1e-9) break;
    passengers.push(newPassenger(admission.id, queue[transferred], admission.carrier));
    transferred++;
  }
  return {
    queue: transferred ? queue.slice(transferred) : queue,
    entering: entering.slice(transferred),
    lineOffset,
    rightLineOffset,
  };
}

function hasBoardingRiders(state: DepotState) {
  const boarding = state.buses.filter((bus) => bus.phase === 'boarding');
  return (
    boarding.length > 0 &&
    state.passengers.some((p) => p.busId !== null || boarding.some((bus) => bus.color === p.color))
  );
}

export function startSteadyBelt(state: DepotState): DepotState {
  if (state.steadyBelt) return state;
  return { ...state, steadyBelt: { elapsed: state.elapsed, beltTime: state.beltTime } };
}

function beltTimeAt(state: DepotState, elapsed: number, acceleratedFrames = state.acceleratedFrames) {
  const origin = state.steadyBelt;
  if (origin && elapsed >= origin.elapsed)
    return origin.beltTime + (elapsed - origin.elapsed) / SIMULATION_SECONDS_PER_SECOND;
  // Reproduce past inputs, including the last partial frame before a save was upgraded.
  return elapsed + (acceleratedFrames / FRAME_RATE) * (PREVIOUS_BOARDING_PACE - 1);
}

function step(
  state: DepotState,
  before: number,
  elapsed: number,
  legacy: boolean,
  spacedBoarding: boolean,
): DepotState {
  const delta = elapsed - before;
  const accelerating = !state.steadyBelt && !legacy && hasBoardingRiders(state);
  const acceleratedFrames = state.acceleratedFrames + Number(accelerating);
  const beltBefore = beltTimeAt(state, before);
  const beltTime = beltTimeAt(state, elapsed, acceleratedFrames);
  const buses = state.buses.map((bus) => {
    if (bus.phase !== 'driving' && bus.phase !== 'leaving') return bus;
    const traveled = bus.traveled + (legacy ? LEGACY_BUS_SPEED : BUS_SPEED) * delta;
    if (traveled < bus.route[bus.route.length - 1].distance) return { ...bus, traveled };
    return bus.phase === 'driving'
      ? { ...bus, traveled, phase: 'boarding' as const }
      : { ...bus, traveled, phase: 'gone' as const, bay: null };
  });
  const passengers: DepotPassenger[] = [];
  let boardedCount = state.boardedCount;
  const reserved = new Map<string, number>();
  const lastArrival = new Map<string, number>();
  for (const p of state.passengers) {
    if (!p.busId) continue;
    reserved.set(p.busId, (reserved.get(p.busId) ?? 0) + 1);
    if (p.boardingTrip) {
      lastArrival.set(p.busId, Math.max(lastArrival.get(p.busId) ?? 0, p.boardingTrip.arrival));
    }
  }

  const stops = buses.flatMap((bus) =>
    bus.phase === 'boarding' && bus.bay !== null
      ? [
          {
            bus,
            distance: state.layout === 'compact' ? belts.compact.straight / 2 : BAY_X[bus.bay] - 90,
            available: bus.capacity - bus.boarded - (reserved.get(bus.id) ?? 0),
          },
        ]
      : [],
  );
  for (const p of state.passengers) {
    if (p.busId) {
      const trip = p.boardingTrip;
      const walking = trip
        ? WALK_DURATION * Math.min(1, (elapsed - trip.start) / (trip.arrival - trip.start))
        : p.walking + (state.steadyBelt ? delta * PREVIOUS_BOARDING_PACE : beltTime - beltBefore);
      if (walking < WALK_DURATION) passengers.push({ ...p, walking });
      else {
        const i = buses.findIndex((bus) => bus.id === p.busId);
        const bus = buses[i];
        const boarded = bus.boarded + 1;
        buses[i] =
          boarded === bus.capacity && bus.bay !== null
            ? { ...bus, boarded, phase: 'leaving', route: departedRoute(state.layout, bus.bay), traveled: 0 }
            : { ...bus, boarded };
        boardedCount++;
      }
      continue;
    }
    const a = beltDistance(state.layout, p.carrier, beltBefore);
    const b = beltDistance(state.layout, p.carrier, beltTime);
    const stop = stops.find((s) => s.available > 0 && s.bus.color === p.color && crosses(a, b, s.distance));
    if (stop) {
      stop.available--;
      const from = beltPose(state.layout, stop.distance, laneOf(state.layout, p.carrier));
      const walking = { ...p, busId: stop.bus.id, from, walking: 0 };
      if (spacedBoarding) {
        const arrival = Math.max(
          elapsed + MIN_BOARDING_WALK,
          (lastArrival.get(stop.bus.id) ?? 0) + SEAT_INTERVAL,
        );
        walking.boardingTrip = { start: elapsed, arrival };
        lastArrival.set(stop.bus.id, arrival);
      }
      passengers.push(walking);
    } else passengers.push(p);
  }
  const next = {
    ...state,
    buses,
    passengers,
    elapsed,
    beltTime,
    acceleratedFrames,
    ...advanceQueue(state, passengers, beltBefore, beltTime),
    boardedCount,
  };
  if (buses.every((b) => b.phase === 'gone')) next.status = 'won';
  else if (
    !canAdvance(next) &&
    (freeBay(next) < 0 ||
      !buses.some((bus) => bus.phase === 'parked' && getBlockers(next, bus.id).length === 0))
  ) {
    next.status = 'lost';
  }
  return next;
}

export function tickDepot(
  state: DepotState,
  seconds: number,
  {
    legacy = false,
    previousBoarding = false,
    previousBelt = false,
  }: { legacy?: boolean; previousBoarding?: boolean; previousBelt?: boolean } = {},
): DepotState {
  if (!Number.isFinite(seconds) || seconds <= 0 || state.status !== 'playing') return state;
  const target = state.elapsed + seconds;
  // The same clock boundaries drive live play and checkpoint history replay.
  // Draw passenger motion at the true elapsed time, even between simulation steps.
  let frame = Math.floor(state.elapsed * FRAME_RATE + 1e-8);
  const end = Math.floor(target * FRAME_RATE + 1e-8);
  const historical = legacy || previousBoarding || previousBelt;
  let next = historical ? state : startSteadyBelt(state);
  if (historical && next.steadyBelt) next = { ...next, steadyBelt: undefined };
  if (canAdvance(state)) {
    while (frame < end && next.status === 'playing') {
      next = step(next, frame / FRAME_RATE, (frame + 1) / FRAME_RATE, legacy, !legacy && !previousBoarding);
      frame++;
      if (frame % FRAME_RATE === 0 && !canAdvance(next)) break;
    }
  }
  if (next.status !== 'playing') return next;
  const remainder = Math.max(0, target - end / FRAME_RATE);
  const fractionalBoost =
    historical && !legacy && hasBoardingRiders(next) ? remainder * (PREVIOUS_BOARDING_PACE - 1) : 0;
  return {
    ...next,
    elapsed: target,
    beltTime: beltTimeAt(next, target) + fractionalBoost,
  };
}

export function tickLiveDepot(state: DepotState, realSeconds: number): DepotState {
  return tickDepot(state, realSeconds * SIMULATION_SECONDS_PER_SECOND);
}
