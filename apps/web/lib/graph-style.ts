export type GraphColor = {
  fill: string;
  marker: string;
  accent: string;
  badge: string;
  border: string;
  line?: string;
  label?: string;
};

export const GRAPH_COLORS: GraphColor[] = [
  { fill: 'rgba(14,116,144,0.24)', marker: '#155e75', accent: '#67e8f9', badge: '#155e75', border: 'rgba(103,232,249,0.36)', line: '#0e7490', label: '#67e8f9' },
  { fill: 'rgba(109,40,217,0.24)', marker: '#581c87', accent: '#c4b5fd', badge: '#581c87', border: 'rgba(196,181,253,0.36)', line: '#6d28d9', label: '#c4b5fd' },
  { fill: 'rgba(22,101,52,0.24)', marker: '#14532d', accent: '#86efac', badge: '#14532d', border: 'rgba(134,239,172,0.34)', line: '#166534', label: '#86efac' },
  { fill: 'rgba(190,24,93,0.24)', marker: '#9d174d', accent: '#f9a8d4', badge: '#9d174d', border: 'rgba(249,168,212,0.34)', line: '#be185d', label: '#f9a8d4' },
  { fill: 'rgba(180,83,9,0.24)', marker: '#92400e', accent: '#fcd34d', badge: '#92400e', border: 'rgba(252,211,77,0.34)', line: '#b45309', label: '#fcd34d' },
];

export const isHexColor = (value?: string) => (
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
);

const hexToRgb = (hex: string) => {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const mix = (channel: number, target: number, amount: number) => (
  Math.round(channel + (target - channel) * amount)
);

const mixHex = (hex: string, target: 0 | 255, amount: number) => {
  const rgb = hexToRgb(hex);
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => mix(channel, target, amount).toString(16).padStart(2, '0'))
    .join('')}`;
};

const rgba = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const getGraphColor = (graph: { color?: string } | undefined, index: number): GraphColor => {
  const fallback = GRAPH_COLORS[index % GRAPH_COLORS.length];
  if (!isHexColor(graph?.color)) return fallback;

  const color = graph!.color!;
  const accent = mixHex(color, 255, 0.52);
  const marker = mixHex(color, 0, 0.18);

  return {
    fill: rgba(color, 0.24),
    marker,
    accent,
    badge: marker,
    border: rgba(accent, 0.36),
    line: color,
    label: accent,
  };
};

export const getGraphShortLabel = (graph: { label?: string; shortLabel?: string } | undefined, fallback = 'Graph') => (
  graph?.shortLabel?.trim() || graph?.label?.trim() || fallback
);

export const getDefaultGraphShortLabel = (label: string, takenShortLabels: Iterable<string> = []) => {
  const normalizedTakenShortLabels = new Set(
    [...takenShortLabels].map(shortLabel => shortLabel.trim().toUpperCase()).filter(Boolean)
  );
  const normalizedLabel = label.trim();
  const firstLetter = normalizedLabel.charAt(0).toUpperCase() || 'G';

  return normalizedTakenShortLabels.has(firstLetter)
    ? (normalizedLabel.slice(0, 2).toUpperCase() || firstLetter)
    : firstLetter;
};

export const getGraphDisplayLabel = (graph: { label?: string; shortLabel?: string } | undefined, fallback = 'Graph') => {
  return graph?.label?.trim() || fallback;
};
