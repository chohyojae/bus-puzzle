import type { Direction } from '../../content/round-schema';

export interface Pose {
  row: number;
  col: number;
  direction: Direction;
}
export interface PlatformVehicle {
  vehicleId: string;
  boardedCount: number;
  arrivalOrder: number;
}
export interface GameState {
  engineVersion: 1;
  parkingVehicleIds: string[];
  vehiclePoseById: Record<string, Pose>;
  platformSlots: (PlatformVehicle | null)[];
  passengerIndex: number;
  moveCount: number;
  nextArrivalOrder: number;
  dispatchHistory: string[];
  logicalTick: number;
  mechanicState: Record<string, Record<string, number | string | boolean>>;
  revealedVehicleIds: string[];
}
export type Move = { type: 'dispatch'; vehicleId: string };
export type MoveRejection = 'not-parked' | 'blocked-path' | 'platform-full' | 'round-finished';
export type Outcome = 'playing' | 'won' | 'lost';
export type GameEvent =
  | { type: 'vehicle-dispatched'; vehicleId: string; slotIndex: number }
  | {
      type: 'passenger-boarded';
      vehicleId: string;
      passengerIndex: number;
      boardedCount: number;
      slotIndex: number;
    }
  | { type: 'vehicle-departed'; vehicleId: string; slotIndex: number }
  | { type: 'round-won' }
  | { type: 'round-lost' };
export interface TransitionResult {
  nextState: GameState;
  events: GameEvent[];
  rejection?: MoveRejection;
}
