// Keeps a tenant's brand colour usable. White text sits on the primary colour, so a colour too light
// for that is darkened until it reaches WCAG 3:1; in the dark theme a colour too dark to show against
// the dark surface is lightened until it reaches 3:1 against it (the two limits overlap, so both hold).
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (a) => `#${a.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const DARK_SURFACE_LUM = 0.012; // about #1a1a1a

export const safePrimaryColor = (hex, fallback = '#244c64', dark = false) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return fallback;
  let c = rgb(hex);
  for (let i = 0; i < 40 && 1.05 / (lum(c) + 0.05) < 3; i++) c = c.map((v) => v * 0.9);
  if (dark) for (let i = 0; i < 40 && (lum(c) + 0.05) / (DARK_SURFACE_LUM + 0.05) < 3 && 1.05 / (lum(c) + 0.05) > 3.05; i++) c = c.map((v) => v + (255 - v) * 0.08 + 2);
  return toHex(c);
};

/** Apply the brand colour to the page now and whenever the theme is switched. Returns a cleanup. */
export const applyBrandColor = (hex) => {
  const root = document.documentElement;
  const run = () => root.style.setProperty('--color-primary', safePrimaryColor(hex, '#244c64', root.getAttribute('data-theme') === 'dark'));
  run();
  const mo = new MutationObserver(run);
  mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
export default safePrimaryColor;
