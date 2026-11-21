import type { RoundDefinition } from '../../content/round-schema';
import type { GameState, Pose } from './types';

export const directionDelta = { up: [-1, 0], right: [0, 1], down: [1, 0], left: [0, -1] } as const;
export function getVehiclePose(state: GameState, _round: RoundDefinition, id: string): Pose {
  const pose = state.vehiclePoseById[id];
  if (!pose) throw new Error(`차량 pose 없음: ${id}`);
  return pose;
}

// The head is the foremost cell; longer footprints extend opposite the heading.
export function getVehicleFootprint(state: GameState, round: RoundDefinition, id: string) {
  const vehicle = round.vehicles.find((v) => v.id === id);
  if (!vehicle) throw new Error(`차량 정의 없음: ${id}`);
  const pose = getVehiclePose(state, round, id);
  const [dr, dc] = directionDelta[pose.direction];
  return Array.from({ length: vehicle.length }, (_, i) => ({
    row: pose.row - dr * i,
    col: pose.col - dc * i,
  }));
}

export function getOccupancy(state: GameState, round: RoundDefinition): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of state.parkingVehicleIds) {
    for (const cell of getVehicleFootprint(state, round, id)) map.set(`${cell.row},${cell.col}`, id);
  }
  // Future active tunnel occupants / environment cells are added here.
  return map;
}

export function getDispatchPath(state: GameState, round: RoundDefinition, id: string) {
  const pose = getVehiclePose(state, round, id);
  const [dr, dc] = directionDelta[pose.direction];
  const cells: { row: number; col: number }[] = [];
  let row = pose.row + dr;
  let col = pose.col + dc;
  while (row >= 0 && col >= 0 && row < round.grid.rows && col < round.grid.cols) {
    cells.push({ row, col });
    row += dr;
    col += dc;
  }
  return cells;
}

export function getBlockers(state: GameState, round: RoundDefinition, id: string): string[] {
  const occupancy = getOccupancy(state, round);
  return [
    ...new Set(
      getDispatchPath(state, round, id).flatMap((cell) => {
        const occupant = occupancy.get(`${cell.row},${cell.col}`);
        return occupant && occupant !== id ? [occupant] : [];
      }),
    ),
  ];
}

export function isVehicleColorRevealed(state: GameState, _round: RoundDefinition, id: string) {
  return state.revealedVehicleIds.includes(id);
}
