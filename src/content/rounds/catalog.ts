import { parseRound, validateCatalog } from '../round-schema';

const modules = import.meta.glob<unknown>('./*/round.json', { eager: true, import: 'default' });
const assets = import.meta.glob<string>('./*/assets/**/*.{svg,png,webp,jpg,jpeg,ogg,mp3}', {
  eager: true,
  query: '?url',
  import: 'default',
});
export const rounds = validateCatalog(
  Object.entries(modules).map(([path, data]) => {
    const round = parseRound(data);
    if (path !== `./${round.id}/round.json`) throw new Error(`라운드 경로와 ID 불일치: ${path}`);
    for (const asset of Object.values(round.assets))
      if (!assets[`./${round.id}/${asset.slice(2)}`])
        throw new Error(`라운드 에셋 없음: ${round.id}/${asset}`);
    return round;
  }),
);
export function roundDecoration(id: string) {
  return assets[`./${id}/assets/decoration.svg`];
}
