import { memo } from 'react';
import blindBus from './art/bus-blind.webp';
import blueBus from './art/bus-blue.webp';
import coralBus from './art/bus-coral.webp';
import indigoBus from './art/bus-indigo.webp';
import mintBus from './art/bus-mint.webp';
import orangeBus from './art/bus-orange.webp';
import purpleBus from './art/bus-purple.webp';
import whiteBus from './art/bus-white.webp';
import yellowBus from './art/bus-yellow.webp';
import type { DepotColor } from './logic';
import { blindPaint, busColors, compactPaints } from './stages';

const busSprites: Record<string, string> = {
  [busColors.coral.paint]: coralBus,
  [busColors.orange.paint]: orangeBus,
  [busColors.yellow.paint]: yellowBus,
  [busColors.mint.paint]: mintBus,
  [busColors.blue.paint]: blueBus,
  [busColors.indigo.paint]: indigoBus,
  [busColors.purple.paint]: purpleBus,
  [busColors.white.paint]: whiteBus,
  [blindPaint.paint]: blindBus,
};

const compactSprites = import.meta.glob<string>('./art/compact/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const roofArrow =
  'M-7-2.1h6V-5q0-1 1-.4l6 4.6q.8.7 0 1.4l-6 4.6q-1 .6-1-.4V2.1h-6q-.8 0-.8-.8v-2.6q0-.8.8-.8Z';
const fleetSprites = import.meta.glob<string>('./art/fleet/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const CompactCar = memo(function CompactCar({
  color,
  length,
  width,
  heading,
}: {
  color: DepotColor | 'blind';
  length: number;
  width: number;
  heading: number;
}) {
  return (
    <g data-bus-art="" transform={busArtTransform(heading)} pointerEvents="none">
      <image
        href={compactSprites[`./art/compact/${color}-${length >= 40 ? 'long' : 'short'}.webp`]}
        preserveAspectRatio="none"
        x={-length / 2}
        y={-width / 2}
        width={length}
        height={width}
      />
      <g transform={`translate(${-length * 0.075} ${-width * 0.09})`}>
        <path
          d={roofArrow}
          fill="#fff"
          stroke="#263247"
          strokeWidth="1.45"
          strokeLinejoin="round"
          paintOrder="stroke fill"
        />
        {color === 'blind' && (
          <text x="-10" y="2.4" className="depot-bus-mark">
            ?
          </text>
        )}
      </g>
    </g>
  );
});

export const CapacityCar = memo(function CapacityCar({
  color,
  length,
  width,
  heading,
  capacity,
  parked,
}: {
  color: DepotColor | 'blind';
  length: number;
  width: number;
  heading: number;
  capacity: number;
  parked: boolean;
}) {
  return (
    <>
      <g data-bus-art="" transform={busArtTransform(heading)} pointerEvents="none">
        <image
          href={fleetSprites[`./art/fleet/${color}-${capacity}.webp`]}
          x={-length / 2}
          y={-width / 2}
          width={length}
          height={width}
          preserveAspectRatio="none"
        />
        <path
          d={roofArrow}
          transform={`translate(${length * 0.105} ${-width * 0.105}) scale(.82)`}
          fill="white"
          stroke="#243448"
          strokeWidth="1.65"
          strokeLinejoin="round"
          paintOrder="stroke fill"
        />
      </g>
      {parked && (
        <g transform={`translate(${-length * 0.24} 0) rotate(${-heading})`} pointerEvents="none">
          <rect x="-6.4" y="-4.7" width="12.8" height="9.4" rx="2.3" fill="#233249" fillOpacity=".93" />
          <text className="depot-roof-seats" textAnchor="middle" y="2.9">
            {capacity}
          </text>
        </g>
      )}
      {color === 'blind' && (
        <g transform={`translate(${length * 0.3} ${-width * 0.19}) rotate(${-heading})`} pointerEvents="none">
          <text className="depot-blind-mark" textAnchor="middle" y="2.8">
            ?
          </text>
        </g>
      )}
    </>
  );
});

function tone(color: string, target: readonly number[], amount: number) {
  const rgb = [1, 3, 5].map((start, i) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16);
    return Math.round(channel + (target[i] - channel) * amount);
  });
  return `rgb(${rgb.join(', ')})`;
}

export function DepotPiecePaint({ compact = false }: { compact?: boolean }) {
  return (
    <defs>
      {Object.keys(busColors).map((name) => {
        const key = name as DepotColor;
        const paint = compact ? compactPaints[key] : busColors[key].paint;
        const id = paint.slice(1);
        const rim = tone(paint, [18, 30, 49], 0.36);
        return (
          <g key={id}>
            <radialGradient id={`depot-head-${id}`} cx=".36" cy=".29" r=".75">
              <stop stopColor={tone(paint, [255, 249, 225], 0.34)} />
              <stop offset=".41" stopColor={tone(paint, [255, 254, 235], 0.1)} />
              <stop offset=".72" stopColor={paint} />
              <stop offset="1" stopColor={rim} />
            </radialGradient>
            <linearGradient id={`depot-body-${id}`} x1=".1" y1="0" x2=".9" y2="1">
              <stop stopColor={tone(paint, [255, 245, 225], 0.12)} />
              <stop offset=".48" stopColor={paint} />
              <stop offset="1" stopColor={rim} />
            </linearGradient>
          </g>
        );
      })}
    </defs>
  );
}

export function busArtTransform(headingDeg: number): string {
  return Math.cos((headingDeg * Math.PI) / 180) < -0.001 ? 'scale(1 -1)' : 'scale(1 1)';
}

export const DepotBus = memo(function DepotBus({
  color,
  length,
  headingDeg = 0,
}: {
  color: string;
  length: number;
  headingDeg?: number;
}) {
  const width = length * 1.05;
  return (
    <g data-bus-art="" transform={busArtTransform(headingDeg)} pointerEvents="none">
      <image
        href={busSprites[color] ?? blindBus}
        x={-width / 2}
        y="-18"
        width={width}
        height="38"
        preserveAspectRatio="none"
      />
    </g>
  );
});

export const DepotPassenger = memo(function DepotPassenger({ color }: { color: string }) {
  const id = color.slice(1);
  const body = `url(#depot-body-${id})`;
  return (
    <g pointerEvents="none">
      <ellipse cx=".65" cy=".25" rx="3.7" ry="1.25" fill="#293b43" opacity=".25" />
      <path
        d="m-1.55-3.2-.8 2.35q-.15.55.46.62h.66m2.25-3 .65 1.85q.15.36.8.28"
        stroke={body}
        strokeWidth="1.72"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M-2.2-6.2q-1.15.6-1.9 2.45t.1 2.13q.78.2 1.76-1.47-.16 1.47.38 1.82 2.13.92 4.02-.21.64-.4.27-1.87.95 1.08 1.53.6.54-.42.04-1.67L2.5-6.24Z"
        fill={body}
      />
      <ellipse cx="-.25" cy="-3.78" rx="2.35" ry="1.3" fill={tone(color, [28, 38, 56], 0.22)} />
      <path
        d="M4.62-7.87c0 2.47-1.85 4.03-4.49 4.06-2.74.04-4.76-1.46-4.8-4.02-.04-2.51 1.75-4.34 4.61-4.37 2.81-.02 4.68 1.69 4.68 4.33Z"
        fill={`url(#depot-head-${id})`}
      />
    </g>
  );
});
