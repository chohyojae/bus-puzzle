import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const palette = { red: '#ff7f7c', blue: '#65bbf5', yellow: '#f8cb5c', green: '#65e4b6' };
const symbols = { red: '●', blue: '◆', yellow: '▲', green: '✚' };
const paths = {
  red: '<circle cx="40" cy="60" r="4"/>',
  blue: '<path d="m40 55 5 5-5 5-5-5Z"/>',
  yellow: '<path d="m40 55 5 9H35Z"/>',
  green: '<path d="M38 55h4v3h3v4h-3v3h-4v-3h-3v-4h3Z"/>',
};
await mkdir('src/content/shared-assets', { recursive: true });
for (const [color, hex] of Object.entries(palette)) {
  const bus = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="88" viewBox="0 0 80 88"><title>버스</title><rect x="9" y="21" width="10" height="17" rx="4" fill="#081323"/><rect x="61" y="21" width="10" height="17" rx="4" fill="#081323"/><rect x="9" y="61" width="10" height="17" rx="4" fill="#081323"/><rect x="61" y="61" width="10" height="17" rx="4" fill="#081323"/><rect x="16" y="8" width="48" height="76" rx="15" fill="#081323" opacity=".35"/><rect x="16" y="4" width="48" height="76" rx="15" fill="${hex}" stroke="#0c1b2c" stroke-width="2.5"/><path d="M25 13h30v11c-9 3-21 3-30 0Z" fill="#193347"/><rect x="26" y="70" width="28" height="4" rx="2" fill="#10243a" opacity=".4"/><path d="M40 49V33m-7 7 7-7 7 7" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><g fill="#112d40" opacity=".8">${paths[color as keyof typeof paths]}</g><path d="M21 29v29" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".24"/></svg>`;
  await writeFile(`src/content/shared-assets/bus-${color}.svg`, bus);
}
const icon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Bus Puzzle</title><rect width="512" height="512" rx="112" fill="#101b2e"/><rect x="112" y="136" width="288" height="226" rx="62" fill="#65e4b6"/><rect x="138" y="177" width="38" height="119" rx="12" fill="#193347"/><rect x="192" y="177" width="67" height="85" rx="10" fill="#193347"/><rect x="275" y="177" width="67" height="85" rx="10" fill="#193347"/><rect x="359" y="177" width="17" height="119" rx="8" fill="#193347"/><circle cx="179" cy="354" r="29" fill="#081323"/><circle cx="333" cy="354" r="29" fill="#081323"/><path d="M223 308h64" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>';
await writeFile('public/icons/icon.svg', icon);
for (const size of [180, 192, 512])
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${size === 180 ? 'apple-touch-icon' : `icon-${size}`}.png`);

const buses = [
  ['red', 67, 287, 90],
  ['green', 325, 287, 180],
  ['blue', 582, 287, -90],
  ['yellow', 195, 403, -90],
  ['red', 453, 403, 90],
  ['blue', 67, 520, 0],
  ['green', 325, 520, 90],
  ['yellow', 582, 520, 180],
  ['red', 453, 635, 0],
];
const defs = await Promise.all(
  Object.keys(palette).map(async (color) => {
    const svg = await Bun.file(`src/content/shared-assets/bus-${color}.svg`).text();
    return `<g id="bus-${color}">${svg.replace(/<svg[^>]+>/, '').replace('</svg>', '')}</g>`;
  }),
);
const passengers = Object.entries(palette).flatMap(([color, hex], i) =>
  Array.from({ length: i === 3 ? 2 : 3 }, (_, j) => {
    const x = 112 + i * 131 + j * 30;
    return `<g transform="translate(${x} 72)"><rect x="-10" y="10" width="20" height="19" rx="6" fill="${hex}"/><circle cy="4" r="10" fill="${hex}"/><text y="24" text-anchor="middle" fill="#18334a" font-size="11" font-family="sans-serif">${symbols[color as keyof typeof symbols]}</text></g>`;
  }),
);
const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="760" viewBox="0 0 760 760"><title>버스 주차장</title><defs>${defs.join('')}</defs><g transform="translate(40 16)"><rect x="0" y="16" width="680" height="710" rx="36" fill="#060e1d" opacity=".3"/><rect width="680" height="710" rx="36" fill="#e1e9f3"/><rect x="10" y="10" width="660" height="690" rx="28" fill="#263850"/><rect x="40" y="55" width="600" height="95" rx="47" fill="none" stroke="#60758f" stroke-width="20"/><rect x="40" y="55" width="600" height="95" rx="47" fill="none" stroke="#b1c6df" stroke-width="2" stroke-dasharray="14 15"/>${passengers.join('')}<rect x="128" y="113" width="160" height="74" rx="18" fill="#263850" stroke="#c0d1e6" stroke-width="3"/><rect x="381" y="113" width="160" height="74" rx="18" fill="#263850" stroke="#c0d1e6" stroke-width="3"/><g fill="#8ea6c1" font-size="17" font-family="sans-serif" text-anchor="middle"><text x="208" y="159">P</text><text x="461" y="159">P</text></g><rect x="26" y="216" width="628" height="468" rx="18" fill="#1d2d44" stroke="#68809e" stroke-width="3"/>${[1, 2, 3, 4].map((i) => `<path d="M${26 + i * 125.6} 216v468" stroke="#435a77" stroke-width="2"/>`).join('')}${[1, 2, 3].map((i) => `<path d="M26 ${216 + i * 117}h628" stroke="#435a77" stroke-width="2"/>`).join('')}${buses.map(([color, x, y, rotation]) => `<g transform="translate(${x} ${y}) rotate(${rotation}) translate(-40 -44)"><use href="#bus-${color}"/></g>`).join('')}</g><g fill="#65a86f"><circle cx="58" cy="38" r="28"/><circle cx="30" cy="53" r="26"/><circle cx="81" cy="61" r="22"/><circle cx="712" cy="686" r="32"/><circle cx="678" cy="710" r="23"/><circle cx="735" cy="715" r="20"/></g></svg>`;
await writeFile('src/content/shared-assets/home-board.svg', hero);
