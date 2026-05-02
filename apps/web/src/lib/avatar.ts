// Deterministic avatar color + initials from agent slug/ens
const PALETTE = [
  ["#4f46e5", "#818cf8"], // indigo
  ["#0891b2", "#67e8f9"], // cyan
  ["#059669", "#6ee7b7"], // emerald
  ["#d97706", "#fcd34d"], // amber
  ["#dc2626", "#fca5a5"], // red
  ["#7c3aed", "#c4b5fd"], // violet
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColors(slug: string): { bg: string; text: string } {
  const pair = PALETTE[hashStr(slug) % PALETTE.length];
  return { bg: pair[0], text: pair[1] };
}

export function initials(slug: string): string {
  return slug.slice(0, 2).toUpperCase();
}
