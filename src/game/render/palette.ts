import type { Color } from '../../content/round-schema';
export const palette: Record<Color, { hex: string; value: number; symbol: string; name: string }> = {
  red: { hex: '#ff7f7c', value: 0xff7f7c, symbol: '●', name: '빨강' },
  blue: { hex: '#65bbf5', value: 0x65bbf5, symbol: '◆', name: '파랑' },
  yellow: { hex: '#f8cb5c', value: 0xf8cb5c, symbol: '▲', name: '노랑' },
  green: { hex: '#65e4b6', value: 0x65e4b6, symbol: '✚', name: '초록' },
};
export const directionLabels = { up: '위', right: '오른쪽', down: '아래', left: '왼쪽' };
