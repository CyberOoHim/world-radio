import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Full-bleed SVG for Apple Touch Icon (180x180) and PWA Icons (192x192, 512x512)
const fullBleedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Apple Signature Radiant Green Gradient Background -->
    <linearGradient id="appleBg" x1="15%" y1="0%" x2="85%" y2="100%">
      <stop offset="0%" stop-color="#30D158"/>
      <stop offset="28%" stop-color="#10B981"/>
      <stop offset="65%" stop-color="#047857"/>
      <stop offset="100%" stop-color="#022C22"/>
    </linearGradient>

    <!-- Ambient Specular Glass Light -->
    <radialGradient id="topSheen" cx="50%" cy="0%" r="70%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>

    <!-- Translucent Frosted Glass Fill for Globe -->
    <linearGradient id="glassSphere" x1="20%" y1="10%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.28"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.04"/>
    </linearGradient>

    <!-- Glass Rim Stroke -->
    <linearGradient id="glassRim" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.9"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.15"/>
    </linearGradient>

    <!-- Beacon Glow in Mint-Gold / Luminous Emerald -->
    <radialGradient id="beaconGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="35%" stop-color="#E6FFFA"/>
      <stop offset="70%" stop-color="#34D399" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#059669" stop-opacity="0"/>
    </radialGradient>

    <!-- Smooth Drop Shadow for elements -->
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#021E17" flood-opacity="0.45"/>
    </filter>
  </defs>

  <!-- Full-bleed background -->
  <rect width="512" height="512" fill="url(#appleBg)"/>
  <rect width="512" height="512" fill="url(#topSheen)"/>

  <!-- Iconic Apple Graphic Content Group -->
  <g filter="url(#softShadow)">
    <!-- Radiating Radio Waves from Antenna Tip (cx=256, cy=124) -->
    <!-- Inner Broadcast Arcs -->
    <path d="M 212 108 A 48 48 0 0 0 212 140" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>
    <path d="M 300 108 A 48 48 0 0 1 300 140" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>

    <!-- Middle Broadcast Arcs -->
    <path d="M 176 92 A 86 86 0 0 0 176 156" fill="none" stroke="#FFFFFF" stroke-width="11" stroke-linecap="round" stroke-opacity="0.88"/>
    <path d="M 336 92 A 86 86 0 0 1 336 156" fill="none" stroke="#FFFFFF" stroke-width="11" stroke-linecap="round" stroke-opacity="0.88"/>

    <!-- Outer Broadcast Arcs -->
    <path d="M 140 76 A 126 126 0 0 0 140 172" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-opacity="0.65"/>
    <path d="M 372 76 A 126 126 0 0 1 372 172" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-opacity="0.65"/>

    <!-- Radio Mast / Antenna Stem -->
    <line x1="256" y1="188" x2="256" y2="134" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>
    
    <!-- Luminous Antenna Beacon -->
    <circle cx="256" cy="124" r="22" fill="url(#beaconGlow)"/>
    <circle cx="256" cy="124" r="9" fill="#FFFFFF"/>

    <!-- The World Sphere / Globe -->
    <circle cx="256" cy="300" r="112" fill="url(#glassSphere)" stroke="url(#glassRim)" stroke-width="9"/>

    <!-- Latitude curves -->
    <line x1="148" y1="300" x2="364" y2="300" stroke="#FFFFFF" stroke-width="7" stroke-opacity="0.65"/>
    <path d="M 172 250 Q 256 270 340 250" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-opacity="0.5"/>
    <path d="M 172 350 Q 256 330 340 350" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-opacity="0.5"/>

    <!-- Central Longitude Ellipse -->
    <ellipse cx="256" cy="300" rx="50" ry="112" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-opacity="0.65"/>

    <!-- Central Soundwave Equalizer Bars (Live Radio Signature) -->
    <!-- Background pill badge for high contrast & clarity -->
    <rect x="206" y="268" width="100" height="64" rx="20" fill="#02241C" fill-opacity="0.65"/>
    <!-- 5 Audio Wave Bars -->
    <rect x="219" y="286" width="7" height="28" rx="3.5" fill="#FFFFFF"/>
    <rect x="233" y="277" width="7" height="46" rx="3.5" fill="#FFFFFF"/>
    <rect x="247" y="272" width="7" height="56" rx="3.5" fill="#FFFFFF"/>
    <rect x="261" y="280" width="7" height="40" rx="3.5" fill="#FFFFFF"/>
    <rect x="275" y="288" width="7" height="24" rx="3.5" fill="#FFFFFF"/>
  </g>
</svg>`;

// 2. Squircle Favicon SVG for browser tabs, bookmarks, and PWA icon
const squircleFaviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Apple Signature Radiant Green Gradient -->
    <linearGradient id="appleFavBg" x1="15%" y1="0%" x2="85%" y2="100%">
      <stop offset="0%" stop-color="#30D158"/>
      <stop offset="28%" stop-color="#10B981"/>
      <stop offset="65%" stop-color="#047857"/>
      <stop offset="100%" stop-color="#022C22"/>
    </linearGradient>

    <!-- Top Rim Specular Stroke -->
    <linearGradient id="rimStroke" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.6"/>
      <stop offset="10%" stop-color="#FFFFFF" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.05"/>
    </linearGradient>

    <!-- Beacon Glow in Mint-Gold / Luminous Emerald -->
    <radialGradient id="favBeaconGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="35%" stop-color="#E6FFFA"/>
      <stop offset="70%" stop-color="#34D399" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#059669" stop-opacity="0"/>
    </radialGradient>

    <!-- Shadow for Tab Floating -->
    <filter id="squircleShadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.4"/>
    </filter>

    <clipPath id="squircleClip">
      <rect x="16" y="16" width="480" height="480" rx="108" ry="108"/>
    </clipPath>
  </defs>

  <!-- Container Squircle with Apple Curvature & Subtle Border -->
  <g filter="url(#squircleShadow)">
    <rect x="16" y="16" width="480" height="480" rx="108" ry="108" fill="url(#appleFavBg)"/>
    <rect x="16" y="16" width="480" height="480" rx="108" ry="108" fill="none" stroke="url(#rimStroke)" stroke-width="4"/>
  </g>

  <!-- Clip inner content for pristine corners -->
  <g clip-path="url(#squircleClip)">
    <!-- Diagonal Subtle Sheen -->
    <path d="M 16 16 L 496 16 L 16 380 Z" fill="#FFFFFF" fill-opacity="0.08"/>

    <!-- Radiating Radio Waves from Antenna Tip (cx=256, cy=126) -->
    <!-- Inner Broadcast Arcs -->
    <path d="M 210 108 A 50 50 0 0 0 210 144" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>
    <path d="M 302 108 A 50 50 0 0 1 302 144" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>

    <!-- Middle Broadcast Arcs -->
    <path d="M 172 90 A 90 90 0 0 0 172 162" fill="none" stroke="#FFFFFF" stroke-width="13" stroke-linecap="round" stroke-opacity="0.9"/>
    <path d="M 340 90 A 90 90 0 0 1 340 162" fill="none" stroke="#FFFFFF" stroke-width="13" stroke-linecap="round" stroke-opacity="0.9"/>

    <!-- Outer Broadcast Arcs -->
    <path d="M 134 72 A 132 132 0 0 0 134 180" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-opacity="0.7"/>
    <path d="M 378 72 A 132 132 0 0 1 378 180" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-opacity="0.7"/>

    <!-- Radio Mast / Antenna Stem -->
    <line x1="256" y1="190" x2="256" y2="136" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>
    
    <!-- Luminous Antenna Beacon -->
    <circle cx="256" cy="126" r="24" fill="url(#favBeaconGlow)"/>
    <circle cx="256" cy="126" r="10" fill="#FFFFFF"/>

    <!-- The World Sphere / Globe -->
    <circle cx="256" cy="304" r="110" fill="#FFFFFF" fill-opacity="0.14" stroke="#FFFFFF" stroke-width="11"/>

    <!-- Latitude curves -->
    <line x1="150" y1="304" x2="362" y2="304" stroke="#FFFFFF" stroke-width="8.5" stroke-opacity="0.75"/>
    <path d="M 174 254 Q 256 274 338 254" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-opacity="0.6"/>
    <path d="M 174 354 Q 256 334 338 354" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-opacity="0.6"/>

    <!-- Central Longitude Ellipse -->
    <ellipse cx="256" cy="304" rx="52" ry="110" fill="none" stroke="#FFFFFF" stroke-width="8.5" stroke-opacity="0.75"/>

    <!-- Central Soundwave Equalizer Bars -->
    <rect x="204" y="270" width="104" height="68" rx="22" fill="#02241C" fill-opacity="0.65"/>
    <!-- 5 Audio Wave Bars -->
    <rect x="218" y="288" width="7.5" height="32" rx="3.75" fill="#FFFFFF"/>
    <rect x="232" y="278" width="7.5" height="52" rx="3.75" fill="#FFFFFF"/>
    <rect x="246" y="274" width="7.5" height="60" rx="3.75" fill="#FFFFFF"/>
    <rect x="260" y="282" width="7.5" height="44" rx="3.75" fill="#FFFFFF"/>
    <rect x="274" y="290" width="7.5" height="28" rx="3.75" fill="#FFFFFF"/>
  </g>
</svg>`;

const publicDir = path.join(__dirname, '..', 'public');

// Write favicon.svg
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), squircleFaviconSvg.trim());
console.log('Wrote public/favicon.svg');

// Render PNGs using Resvg
function renderPng(svgStr, width, height, outPath) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: 'width', value: width }
  });
  const pngData = resvg.render().asPng();
  fs.writeFileSync(outPath, pngData);
  console.log(`Rendered ${path.basename(outPath)} (${width}x${height}) - ${pngData.length} bytes`);
}

// 1. icon-512.png (512x512) - PWA maskable icon
renderPng(fullBleedSvg, 512, 512, path.join(publicDir, 'icon-512.png'));

// 2. icon-192.png (192x192) - PWA maskable icon
renderPng(fullBleedSvg, 192, 192, path.join(publicDir, 'icon-192.png'));

// 3. apple-touch-icon.png (180x180) - iOS Apple touch icon
renderPng(fullBleedSvg, 180, 180, path.join(publicDir, 'apple-touch-icon.png'));

// 4. favicon-32x32.png (32x32) - high-DPI favicon
renderPng(squircleFaviconSvg, 32, 32, path.join(publicDir, 'favicon-32x32.png'));

// 5. favicon-16x16.png (16x16) - standard favicon
renderPng(squircleFaviconSvg, 16, 16, path.join(publicDir, 'favicon-16x16.png'));

// 6. Generate favicon.ico containing 16x16, 32x32, 48x48
const tmp48 = path.join('/tmp', 'fav-48.png');
renderPng(squircleFaviconSvg, 48, 48, tmp48);
const fav16 = path.join(publicDir, 'favicon-16x16.png');
const fav32 = path.join(publicDir, 'favicon-32x32.png');
const favIco = path.join(publicDir, 'favicon.ico');

execSync(`convert "${fav16}" "${fav32}" "${tmp48}" "${favIco}"`);
console.log(`Generated public/favicon.ico with multi-resolution`);
