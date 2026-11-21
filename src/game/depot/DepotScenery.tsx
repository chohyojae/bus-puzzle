import { memo } from 'react';
import station from './art/station.webp';
import { bayGeometry, type DepotLayout, QUEUE_PATHS } from './logic';

const ring =
  'M147 177H253A36 36 0 0 1 289 213V216A36 36 0 0 1 253 252H147A36 36 0 0 1 111 216V213A36 36 0 0 1 147 177Z';
const route = QUEUE_PATHS.compact + ring;
const gateRamp = 'M185 251H215V268Q215 276 218 280Q220 285 223 289H177Q180 285 182 280Q185 275 185 268Z';
const platform = 'M-5 287Q11 287 23 284Q33 281 43 281H357Q367 281 377 284Q389 287 405 287V352H-5Z';

function CompactPaint() {
  return (
    <defs>
      <linearGradient id="depot-concourse" x1="0" y1="0" x2=".69" y2="1">
        <stop stopColor="#dce5e9" />
        <stop offset=".62" stopColor="#d0dae0" />
        <stop offset="1" stopColor="#c4cfd6" />
      </linearGradient>
      <linearGradient id="depot-carpark" x1=".02" y1="0" x2=".88" y2="1">
        <stop stopColor="#cfd8e8" />
        <stop offset=".55" stopColor="#c8d2e2" />
        <stop offset="1" stopColor="#bbc8dc" />
      </linearGradient>
      <linearGradient id="depot-rail-fascia" x1="0" y1="0" x2=".18" y2="1">
        <stop stopColor="#c3cdd8" />
        <stop offset=".68" stopColor="#b4bfcc" />
        <stop offset="1" stopColor="#8d9cad" />
      </linearGradient>
      <linearGradient
        id="depot-moving-surface"
        x1="84"
        y1="-16"
        x2="291"
        y2="252"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#63738f" />
        <stop offset=".58" stopColor="#5a6b89" />
        <stop offset="1" stopColor="#50617d" />
      </linearGradient>
      <linearGradient id="depot-gate-ramp" x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#536581" stopOpacity="0" />
        <stop offset=".28" stopColor="#8293a7" />
        <stop offset=".61" stopColor="#c8d2dd" />
        <stop offset=".79" stopColor="#d8dee5" />
        <stop offset="1" stopColor="#6d7d98" />
      </linearGradient>
      <linearGradient id="depot-bay-apron" x1="0" y1="0" x2=".45" y2="1">
        <stop stopColor="#697a98" />
        <stop offset=".72" stopColor="#71809c" />
        <stop offset="1" stopColor="#657490" />
      </linearGradient>
      <radialGradient id="depot-planter-leaves" cx=".35" cy=".24" r=".82">
        <stop stopColor="#b7d982" />
        <stop offset=".5" stopColor="#8bb860" />
        <stop offset="1" stopColor="#5f8a58" />
      </radialGradient>
      <pattern id="depot-plaza-fleck" patternUnits="userSpaceOnUse" width="43" height="37">
        <path
          d="M8 6h1m19 13h1.5m-13 12h.7"
          stroke="#8098ac"
          opacity=".32"
          strokeWidth=".7"
          strokeLinecap="round"
        />
        <path
          d="M3 23h2m29-15h1.4m-13 26h1.3"
          stroke="white"
          opacity=".64"
          strokeWidth=".65"
          strokeLinecap="round"
        />
      </pattern>
      <g id="depot-ferry-lamp">
        <ellipse cx="2.7" cy="1.5" rx="5" ry="1.65" fill="#52687c" opacity=".22" />
        <ellipse cy=".6" rx="2.6" ry="1.15" fill="#6a8291" />
        <path d="M0 0v-14q0-1 1.3-1h5.8" fill="none" stroke="#718997" strokeWidth="1.15" />
        <path d="M.1-14.9h6.9" stroke="#aec2ca" strokeWidth=".55" />
        <rect x="5.2" y="-15.9" width="4.9" height="1.8" rx=".65" fill="#758e9a" />
        <path d="M6-14.4h3.4" stroke="#f7e5ab" strokeWidth=".64" />
      </g>
      <g id="depot-platform-tree">
        <ellipse cx="2" cy="2.5" rx="6.3" ry="2.3" fill="#627783" opacity=".19" />
        <path d="M-4-1.7h8l-.6 3.5q-3.4 1.6-6.7-.1Z" fill="#92a4a9" />
        <ellipse cy="-1.6" rx="4.1" ry="1.8" fill="#e6e8df" />
        <ellipse cy="-1.55" rx="3.5" ry="1.4" fill="#77856e" />
        <path d="M0-1v-4" stroke="#8f8165" strokeWidth="1.1" />
        <path
          d="M-3.5-4.5q-1.1-1.8.4-4 .4-2.3 2.5-3.4 2.5-.3 3.4 2.9 1.3 2.2.9 4-.5 2.4-3.3 2.4-3.2.2-3.9-1.9Z"
          fill="url(#depot-planter-leaves)"
        />
      </g>
    </defs>
  );
}

function TrackStroke({
  surface,
  width,
  offset = 0,
  opacity = 1,
}: {
  surface: string;
  width: number;
  offset?: number;
  opacity?: number;
}) {
  return (
    <g
      transform={offset ? `translate(0 ${offset})` : undefined}
      fill="none"
      stroke={surface}
      strokeLinejoin="round"
      opacity={opacity}
    >
      <path d={route} strokeWidth={width} />
    </g>
  );
}

function CompactScenery({ running }: { running: boolean }) {
  const bay = bayGeometry('compact');
  return (
    <g>
      <CompactPaint />
      <rect width="400" height="760" fill="url(#depot-carpark)" />
      <rect width="400" height="289" fill="url(#depot-concourse)" />
      <g fill="none" stroke="#94a9b3" strokeWidth=".75" opacity=".32">
        <path d="M-6 49h415M-6 126h415M-6 204h415M26 0l-6 276M154 0l-2 268M273 0l5 268M378 0l8 276" />
      </g>
      <rect width="400" height="283" fill="url(#depot-plaza-fleck)" opacity=".37" />
      <TrackStroke surface="#718498" width={55.6} offset={3.4} opacity={0.25} />
      <TrackStroke surface="url(#depot-rail-fascia)" width={54.7} offset={1.7} />
      <TrackStroke surface="#f6f8fa" width={54.1} />
      <TrackStroke surface="#ced9e3" width={51.9} />
      <TrackStroke surface="#52647d" width={50.1} />
      <TrackStroke surface="url(#depot-moving-surface)" width={49.1} />
      <rect x="131" y="197" width="138" height="37" rx="12" fill="url(#depot-moving-surface)" />
      <path
        d={ring}
        fill="none"
        stroke="#a2b3c4"
        opacity=".13"
        strokeDasharray=".65 7.8"
        strokeWidth="48.2"
      />
      <ellipse cx="200" cy="215.8" rx="65.5" ry="16" fill="#3c5068" opacity=".48" />
      <ellipse cx="200" cy="214.2" rx="65.5" ry="16.2" fill="#a2b4c3" />
      <ellipse
        cx="200"
        cy="213"
        rx="64.3"
        ry="14.8"
        fill="url(#depot-concourse)"
        stroke="#f0f5f7"
        strokeWidth="1.3"
      />
      <g
        className="depot-walk-marks"
        style={{ animationPlayState: running ? 'running' : 'paused' }}
        fill="none"
        stroke="#d2dbe4"
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".6"
      >
        <path d="M161 250l2.2 2-2.2 2m3.6-4 2.2 2-2.2 2M239 175l-2.2 2 2.2 2m-3.6-4-2.2 2 2.2 2" />
      </g>
      <use href="#depot-ferry-lamp" transform="translate(17 269)" />
      <use href="#depot-ferry-lamp" transform="translate(383 269) scale(-1 1)" />
      <use href="#depot-platform-tree" transform="translate(8 279)" />
      <use href="#depot-platform-tree" transform="translate(392 279)" />
      <path d={platform} fill="#8b9ab1" transform="translate(0 3.7)" opacity=".39" />
      <path d={platform} fill="#9baac0" transform="translate(0 2.2)" />
      <path d={platform} fill="#f1f4f6" />
      <path
        d="M-3 290q14-.6 26-3.4 10-3 21-3h312q11 0 21 3 13 3 26 3.4v57.3H-3Z"
        fill="url(#depot-bay-apron)"
      />
      <path d={gateRamp} fill="url(#depot-gate-ramp)" />
      <path
        d="M183.7 274q-1.4 7.2-6.7 13.5m39.3-13.5q1.4 7.2 6.7 13.5"
        fill="none"
        stroke="#cbd5df"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M182.5 278q-1.8 5.6-5.5 9.5m40.5-9.5q1.8 5.6 5.5 9.5"
        fill="none"
        stroke="#f6f8fa"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M0 347.5h400" stroke="#4e607e" strokeWidth="1" opacity=".55" />
      <path d="M0 350.2h400" stroke="#fff" strokeOpacity=".74" strokeWidth="1" />
      {bay.xs.map((x, index) => (
        <g key={x} data-bay-index={index} transform={`translate(${x} ${bay.y}) rotate(${bay.angle})`}>
          <rect x="-15.3" y="-25.6" width="30.6" height="51.2" rx="6.1" fill="#596984" fillOpacity=".3" />
          <rect
            x="-15.3"
            y="-25.6"
            width="30.6"
            height="51.2"
            rx="6.1"
            fill="none"
            stroke="#425778"
            strokeOpacity=".65"
            strokeWidth="1.65"
            transform="translate(.2 .65)"
          />
          <rect
            x="-15.3"
            y="-25.6"
            width="30.6"
            height="51.2"
            rx="6.1"
            fill="none"
            stroke="#eef1f8"
            strokeWidth="1.25"
            strokeDasharray="4.4 3.4"
            strokeLinecap="round"
          />
        </g>
      ))}
    </g>
  );
}

export const DepotScenery = memo(function DepotScenery({
  running = true,
  layout = 'compact',
}: {
  running?: boolean;
  layout?: DepotLayout;
}) {
  if (layout === 'compact')
    return (
      <g pointerEvents="none">
        <CompactScenery running={running} />
      </g>
    );
  return (
    <g pointerEvents="none">
      <image href={station} width="400" height="760" preserveAspectRatio="none" />
      <g
        className="depot-walk-marks"
        style={{ animationPlayState: running ? 'running' : 'paused' }}
        fill="none"
        stroke="#fff4d1"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {[118, 216, 292].map((x) => (
          <path key={x} d={`M${x} 207l3 3-3 3m4-6 3 3-3 3`} />
        ))}
      </g>
      <g fill="#fff0ce" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="10">
        {bayGeometry('promenade').xs.map((x, index) => (
          <text key={x} x={x} y="313" data-bay-index={index}>
            {index + 1}
          </text>
        ))}
      </g>
    </g>
  );
});
