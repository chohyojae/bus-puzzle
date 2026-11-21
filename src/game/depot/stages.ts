export const stops = [
  { id: 'depot-lighthouse', name: '등대 선착장' },
  { id: 'depot-wave', name: '파도길 정류장' },
  { id: 'depot-sunset', name: '노을 부두' },
] as const;

export const busColors = {
  coral: { paint: '#ee634d', name: '빨간색', mark: '●' },
  blue: { paint: '#388fe9', name: '파란색', mark: '◆' },
  yellow: { paint: '#f5b931', name: '노란색', mark: '★' },
  mint: { paint: '#48ae71', name: '초록색', mark: '▲' },
  purple: { paint: '#a275c7', name: '보라색', mark: '✚' },
  orange: { paint: '#f78a32', name: '주황색', mark: '■' },
  indigo: { paint: '#3845a4', name: '남색', mark: '☾' },
  white: { paint: '#f6f2df', name: '흰색', mark: '✿' },
  sky: { paint: '#62d8ee', name: '하늘색', mark: '☀' },
  gray: { paint: '#96938f', name: '회색', mark: '⬟' },
} as const;
export const blindPaint = { paint: '#32353e', name: '블라인드', mark: '?' } as const;

export const compactPaints = {
  coral: '#f03931',
  orange: '#ff870b',
  yellow: '#ffc40b',
  mint: '#21c844',
  blue: '#148afa',
  indigo: '#3934b6',
  purple: '#ac24eb',
  white: '#e9edf1',
  sky: '#54def3',
  gray: '#92918d',
} as const;
