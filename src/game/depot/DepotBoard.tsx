import { memo, type Ref, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import {
  busArtTransform,
  CapacityCar,
  CompactCar,
  DepotBus,
  DepotPassenger,
  DepotPiecePaint,
} from './DepotPieces';
import { DepotScenery } from './DepotScenery';
import {
  busPose,
  type DepotColor,
  type DepotPose,
  type DepotState,
  isBlindBus,
  passengerPose,
  queuePoses,
} from './logic';
import { blindPaint, busColors, compactPaints } from './stages';

export interface BoardHandle {
  paint: (game: DepotState) => void;
}
interface BoardProps {
  ref: Ref<BoardHandle>;
  state: DepotState;
  live: () => DepotState;
  active: boolean;
  reduced: boolean;
  running: boolean;
  highlight?: string;
  rejected?: string;
  onSelect: (id: string) => void;
}

function PassengerArt({ color, id }: { color: DepotColor; id: number }) {
  return (
    <>
      <use href={`#walker-${color}`} />
      {id % 20 === 1 && (
        <text className="depot-passenger-mark" x=".2" y="-8.5">
          {busColors[color].mark}
        </text>
      )}
    </>
  );
}

export const DepotBoard = memo(function DepotBoard({
  ref,
  state,
  live,
  active,
  reduced,
  running,
  highlight,
  rejected,
  onSelect,
}: BoardProps) {
  const root = useRef<SVGSVGElement>(null);
  const buses = useRef(new Map<string, SVGGElement>());
  const busArt = useRef(new Map<string, SVGGElement>());
  const people = useRef(new Map<number, SVGGElement>());
  const lastLine = useRef<DepotState | null>(null);
  const compact = state.layout === 'compact';
  const capacityFleet = compact && state.fleetVersion >= 2;
  const queued = queuePoses(state);

  function paint(game: DepotState, forceQueue = false) {
    for (const bus of game.buses) {
      if (bus.phase === 'parked' || bus.phase === 'gone') continue;
      const pose = busPose(game, bus);
      busArt.current.get(bus.id)?.setAttribute('transform', busArtTransform(pose.angle - 90));
      buses.current
        .get(bus.id)
        ?.setAttribute(
          'transform',
          `translate(${pose.x.toFixed(2)} ${pose.y.toFixed(2)}) rotate(${(pose.angle - 90).toFixed(1)})`,
        );
    }
    function placePerson(id: number, pose: DepotPose, bob: number) {
      const facing = Math.sin((pose.angle * Math.PI) / 180) < -0.1 ? -1 : 1;
      people.current
        .get(id)
        ?.setAttribute(
          'transform',
          `translate(${pose.x.toFixed(2)} ${(pose.y + bob).toFixed(2)}) scale(${facing} 1)`,
        );
    }
    const last = lastLine.current;
    if (
      forceQueue ||
      game.queue !== last?.queue ||
      game.lineOffset !== last.lineOffset ||
      game.rightLineOffset !== last.rightLineOffset ||
      game.entering.length > 0
    ) {
      for (const p of queuePoses(game))
        placePerson(p.id, p, p.moving && !reduced ? Math.sin(game.beltTime * 8 + p.id) * 0.35 : 0);
    }
    lastLine.current = game;
    for (const p of game.passengers) {
      placePerson(
        p.id,
        passengerPose(game, p),
        reduced ? 0 : Math.sin(game.beltTime * 8 + p.id * 1.8) * 0.35,
      );
    }
  }

  useImperativeHandle(ref, () => ({ paint }));
  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    buses.current = new Map(
      [...svg.querySelectorAll<SVGGElement>('[data-vehicle-id]')].map((g) => [g.dataset.vehicleId ?? '', g]),
    );
    busArt.current.clear();
    for (const [id, group] of buses.current) {
      const art = group.querySelector<SVGGElement>('[data-bus-art]');
      if (art) busArt.current.set(id, art);
    }
    people.current = new Map(
      [...svg.querySelectorAll<SVGGElement>('[data-passenger-id], [data-queue-passenger-id]')].map((g) => [
        Number(g.dataset.passengerId ?? g.dataset.queuePassengerId),
        g,
      ]),
    );
    paint(live(), true);
  });

  return (
    <svg ref={root} className="depot-board" viewBox="0 0 400 760" aria-label="해안 정류장" role="application">
      <DepotPiecePaint compact={compact} />
      <defs>
        {Object.entries(busColors).map(([key, color]) => (
          <g key={key} id={`walker-${key}`} transform={compact ? 'scale(1.5)' : undefined}>
            <DepotPassenger color={compact ? compactPaints[key as DepotColor] : color.paint} />
          </g>
        ))}
      </defs>
      <DepotScenery running={running && !reduced} layout={state.layout} />
      {state.buses
        .filter((bus) => bus.phase !== 'gone')
        .map((bus) => {
          const parked = bus.phase === 'parked';
          const pose = busPose(state, bus);
          const masked = isBlindBus(state, bus);
          const color = masked ? blindPaint : busColors[bus.color];
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: Parked SVG groups become keyboard-operable buttons until dispatched.
            <g
              key={bus.id}
              data-vehicle-id={bus.id}
              data-phase={bus.phase}
              data-capacity={bus.capacity}
              data-color={masked ? 'blind' : bus.color}
              pointerEvents={parked ? undefined : 'none'}
              transform={`translate(${pose.x} ${pose.y}) rotate(${pose.angle - 90})`}
              className={`depot-vehicle ${parked ? 'parked' : ''} ${highlight === bus.id ? 'suggested' : ''} ${rejected === bus.id ? 'rejected' : ''}`}
              role={parked ? 'button' : undefined}
              tabIndex={active && parked ? 0 : undefined}
              aria-label={
                parked ? `${color.name} ${capacityFleet ? `${bus.capacity}인승 ` : ''}버스 출차` : undefined
              }
              onClick={active && parked ? () => onSelect(bus.id) : undefined}
              onKeyDown={
                active && parked
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(bus.id);
                      }
                    }
                  : undefined
              }
            >
              <rect
                className="vehicle-hit"
                x={-bus.length / 2 - 2}
                y={compact ? -bus.width / 2 - 1 : -22}
                width={bus.length + 4}
                height={compact ? bus.width + 2 : 44}
                rx="13"
                fill="transparent"
              />
              <rect
                className="vehicle-ring"
                x={-bus.length / 2 - 3}
                y={compact ? -bus.width / 2 - 1 : -18}
                width={bus.length + 6}
                height={compact ? bus.width + 2 : 37}
                rx="11"
              />
              {capacityFleet ? (
                <CapacityCar
                  color={masked ? 'blind' : bus.color}
                  length={bus.length}
                  width={bus.width}
                  heading={pose.angle - 90}
                  capacity={bus.capacity}
                  parked={parked}
                />
              ) : compact ? (
                <CompactCar
                  color={masked ? 'blind' : bus.color}
                  length={bus.length}
                  width={bus.width}
                  heading={pose.angle - 90}
                />
              ) : (
                <>
                  <DepotBus color={color.paint} length={bus.length} headingDeg={pose.angle - 90} />
                  <text className={`depot-bus-mark${masked ? ' blind' : ''}`} x={-bus.length / 2 + 9} y="-.5">
                    {color.mark}
                  </text>
                </>
              )}
            </g>
          );
        })}
      {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: The SVG group is a single non-interactive illustration. */}
      <g
        role="img"
        aria-label="승객 대기 통로"
        aria-description={`${state.queue.length}명 대기 중`}
        pointerEvents="none"
      >
        {(compact ? (['left', 'right'] as const) : (['left'] as const)).map((side) => (
          <g key={side} data-queue-side={side}>
            {queued
              .filter((p) => !compact || p.side === side)
              .sort((a, b) => a.y - b.y)
              .map((p) => (
                <g key={p.id} data-queue-passenger-id={p.id}>
                  <PassengerArt color={p.color} id={p.id} />
                </g>
              ))}
          </g>
        ))}
      </g>
      {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: Announce the moving crowd once, instead of each sprite. */}
      <g role="img" aria-label="정류장을 순환하는 승객">
        {state.passengers
          .map((p) => ({ p, y: passengerPose(state, p).y }))
          .sort((a, b) => a.y - b.y)
          .map(({ p }) => (
            <g key={p.id} data-passenger-id={p.id} pointerEvents="none">
              <PassengerArt color={p.color} id={p.id} />
            </g>
          ))}
      </g>
      {state.buses
        .filter((bus) => bus.phase === 'boarding')
        .map((bus) => {
          const { x, y } = busPose(state, bus);
          return (
            <g
              key={bus.id}
              className="depot-load"
              transform={`translate(${x} ${y + 23})`}
              pointerEvents="none"
            >
              <rect
                x="-15"
                y="-7"
                width="30"
                height="14"
                rx="5"
                style={compact ? { fill: compactPaints[bus.color] } : undefined}
              />
              <text textAnchor="middle" y="3.2" className={compact ? 'compact-load-label' : undefined}>
                {bus.boarded}/{bus.capacity}
              </text>
            </g>
          );
        })}
    </svg>
  );
});
