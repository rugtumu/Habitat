'use strict';

function rgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Expected a six-digit colour, got ' + hex);
  return hex.slice(1).match(/../g).map(pair => parseInt(pair, 16));
}

function luminance(color) {
  const [r, g, b] = (Array.isArray(color) ? color : rgb(color)).map(channel => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

module.exports = { contrast, rgb };
