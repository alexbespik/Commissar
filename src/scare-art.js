// The screamer illustration: an original, grim officer drawn as layered SVG (low-key green light, brass, fog, gothic
// arches). No franchise emblems: the badge is a plain laurel wreath around a flame. Static markup only: no user or page
// data goes in here (the caption is set with textContent elsewhere).
// kind 'point': an armoured glove comes at you, finger out. kind 'shoot': a pistol aimed at you, with flash and cracks.

export function scareSVG(kind) {
  const hand = kind === 'shoot' ? PISTOL : POINT;
  const wrinkles = [ // forehead, crow's feet, folds, jowls: the face is old and hard
    'M168 196 Q200 190 232 196', 'M172 204 Q200 199 228 204',
    'M150 238 Q144 244 146 252', 'M250 238 Q256 244 254 252', 'M152 246 Q147 252 150 260', 'M248 246 Q253 252 250 260',
    'M178 258 Q170 282 176 304', 'M222 258 Q230 282 224 304', 'M174 268 Q166 290 172 310', 'M226 268 Q234 290 228 310',
    'M160 300 Q166 322 186 334', 'M240 300 Q234 322 214 334', 'M186 318 Q200 322 214 318',
  ].map((d) => `<path d="${d}" stroke="#1d1a14" stroke-width="1.6" fill="none" opacity=".75"/>`).join('');
  return `
<svg viewBox="0 0 400 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The Commissar ${kind === 'shoot' ? 'aiming a pistol at you' : 'pointing at you'}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="80%">
      <stop offset="0" stop-color="#1e2a24"/><stop offset=".45" stop-color="#120f0c"/><stop offset="1" stop-color="#050404"/>
    </radialGradient>
    <linearGradient id="arch" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2a1a12"/><stop offset=".5" stop-color="#6b4a32"/><stop offset="1" stop-color="#2a1a12"/>
    </linearGradient>
    <radialGradient id="fogG" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#3fae8a" stop-opacity=".55"/><stop offset="1" stop-color="#3fae8a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="coat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#26241f"/><stop offset=".6" stop-color="#14120f"/><stop offset="1" stop-color="#070605"/>
    </linearGradient>
    <linearGradient id="brassPlate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8d7a52"/><stop offset=".35" stop-color="#5d4c2f"/><stop offset=".7" stop-color="#3a2e1b"/><stop offset="1" stop-color="#1c160c"/>
    </linearGradient>
    <radialGradient id="brass" cx="35%" cy="30%" r="75%">
      <stop offset="0" stop-color="#d8c08a"/><stop offset=".45" stop-color="#8a6f3c"/><stop offset="1" stop-color="#3b2c12"/>
    </radialGradient>
    <radialGradient id="skin" cx="45%" cy="55%" r="65%">
      <stop offset="0" stop-color="#8f8a76"/><stop offset=".5" stop-color="#5f5c4d"/><stop offset="1" stop-color="#23221b"/>
    </radialGradient>
    <linearGradient id="brimShadow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity=".95"/><stop offset=".5" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="capCrown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a1a1a"/><stop offset=".6" stop-color="#3a0f10"/><stop offset="1" stop-color="#1c0708"/>
    </linearGradient>
    <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3a2a"/><stop offset=".3" stop-color="#140f0a"/><stop offset="1" stop-color="#030202"/>
    </linearGradient>
    <linearGradient id="rimTeal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5fe0b0" stop-opacity=".7"/><stop offset="1" stop-color="#5fe0b0" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="glove" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4a3c2c"/><stop offset=".5" stop-color="#1e1812"/><stop offset="1" stop-color="#080605"/>
    </linearGradient>
    <radialGradient id="steel" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#b9b3a2"/><stop offset=".4" stop-color="#6c6556"/><stop offset="1" stop-color="#1d1a14"/>
    </radialGradient>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="smoke" x="-50%" y="-50%" width="200%" height="200%">
      <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="11"/>
      <feDisplacementMap in="SourceGraphic" scale="40"/><feGaussianBlur stdDeviation="7"/>
    </filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="1" seed="5"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .08 0"/></filter>
  </defs>

  <!-- a gothic hall in the dark -->
  <rect class="bg" width="400" height="480" fill="url(#bg)"/>
  <g class="hall" opacity=".55">
    <path d="M14 480 L14 120 Q50 40 86 120 L86 480 Z" fill="url(#arch)" opacity=".45"/>
    <path d="M314 480 L314 120 Q350 40 386 120 L386 480 Z" fill="url(#arch)" opacity=".45"/>
    <g stroke="#a07a52" stroke-width="2" opacity=".5">
      <path d="M30 470 V130 M44 470 V100 M56 470 V100 M70 470 V130"/>
      <path d="M330 470 V130 M344 470 V100 M356 470 V100 M370 470 V130"/>
    </g>
  </g>
  <g class="fog" filter="url(#smoke)">
    <ellipse cx="200" cy="170" rx="150" ry="120" fill="url(#fogG)"/>
    <ellipse cx="110" cy="330" rx="90" ry="60" fill="url(#fogG)" opacity=".6"/>
  </g>

  <g class="figure">
    <!-- coat, epaulettes with fringe, teal rim light from the fog -->
    <path d="M10 480 C20 388 64 344 128 330 L200 322 L272 330 C336 344 380 388 390 480 Z" fill="url(#coat)"/>
    <path d="M64 352 L150 330 L156 352 L76 378 Z" fill="url(#brassPlate)"/>
    <path d="M336 352 L250 330 L244 352 L324 378 Z" fill="url(#brassPlate)"/>
    <path d="M64 352 L150 330 M336 352 L250 330" stroke="url(#rimTeal)" stroke-width="5"/>
    <g stroke="#6d5634" stroke-width="2" opacity=".85">
      <path d="M78 378 v16 M86 375 v17 M94 372 v18 M102 369 v18 M110 366 v18 M118 363 v18 M126 360 v17 M134 357 v16"/>
      <path d="M322 378 v16 M314 375 v17 M306 372 v18 M298 369 v18 M290 366 v18 M282 363 v18 M274 360 v17 M266 357 v16"/>
    </g>
    <!-- brass cuirass with ribs -->
    <path d="M140 352 L260 352 L270 450 L200 470 L130 450 Z" fill="url(#brassPlate)"/>
    <g stroke="#2a2012" stroke-width="2.4" opacity=".9">
      <path d="M160 372 L156 448 M176 370 L174 456 M192 370 L192 462 M208 370 L208 462 M224 370 L226 456 M240 372 L244 448"/>
    </g>
    <path d="M144 360 L256 360" stroke="#b49a63" stroke-width="2" opacity=".6"/>
    <circle cx="150" cy="370" r="3" fill="url(#brass)"/><circle cx="250" cy="370" r="3" fill="url(#brass)"/>
    <circle cx="146" cy="430" r="3" fill="url(#brass)"/><circle cx="254" cy="430" r="3" fill="url(#brass)"/>
    <!-- maroon sash with a plain brass medallion -->
    <path d="M120 452 C170 470 230 470 280 452 L284 480 L116 480 Z" fill="#4a1012"/>
    <circle cx="200" cy="468" r="9" fill="url(#brass)"/>
    <!-- high maroon collar -->
    <path d="M160 318 L200 352 L240 318 L252 344 L200 372 L148 344 Z" fill="#3a0f10"/>
    <path d="M160 318 L200 352 L240 318" stroke="#6a2022" stroke-width="2.5" fill="none"/>

    <!-- neck and an old, gaunt face -->
    <path d="M178 290 L178 330 L200 346 L222 330 L222 290 Z" fill="#3a382e"/>
    <path d="M146 176 C142 250 160 312 200 334 C240 312 258 250 254 176 Z" fill="url(#skin)"/>
    <path d="M146 176 C142 250 160 312 200 334 C176 306 160 256 160 176 Z" fill="#000" opacity=".35"/>
    <path d="M150 250 C160 286 176 306 200 318 C180 294 168 270 164 244 Z" fill="#15140f" opacity=".55"/>
    <path d="M250 250 C240 286 224 306 200 318 C220 294 232 270 236 244 Z" fill="#15140f" opacity=".45"/>
    <!-- the nose: a long hard ridge -->
    <path d="M200 214 C197 240 192 262 190 274 C196 282 206 282 212 274 C208 262 203 240 200 214 Z" fill="#706b58" opacity=".7"/>
    <path d="M190 274 C196 282 206 282 212 274" stroke="#14130e" stroke-width="2" fill="none"/>
    ${wrinkles}
    <!-- the mouth: thin, turned down -->
    <path d="M176 302 Q200 296 224 304" stroke="#0e0d0a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M178 296 Q170 300 172 308 M222 296 Q230 300 228 308" stroke="#0e0d0a" stroke-width="2" fill="none" opacity=".8"/>
    <!-- brim shadow, deep sockets, cold eyes; one eye scarred and clouded -->
    <rect x="138" y="168" width="124" height="86" fill="url(#brimShadow)"/>
    <ellipse cx="174" cy="226" rx="17" ry="10" fill="#050504"/><ellipse cx="226" cy="226" rx="17" ry="10" fill="#050504"/>
    <g class="eyes">
      <ellipse cx="174" cy="227" rx="4.5" ry="2" fill="#6e6a58" opacity=".7"/><circle cx="175" cy="226.4" r="1.1" fill="#f4f1e2"/>
      <ellipse cx="226" cy="227" rx="4.5" ry="2" fill="#9a9a90" opacity=".55"/>
      <ellipse cx="226" cy="227" rx="10" ry="6" fill="#c8f0de" opacity=".07" filter="url(#glow)"/>
    </g>
    <path d="M222 196 L230 222 L224 252 L230 268" stroke="#9c9682" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M224 197 L232 222 L226 252 L232 268" stroke="#1d1a14" stroke-width="1.2" fill="none" opacity=".8"/>
    <path d="M156 212 L192 220" stroke="#0b0a08" stroke-width="7" stroke-linecap="round"/>
    <path d="M244 212 L208 220" stroke="#0b0a08" stroke-width="7" stroke-linecap="round"/>

    <!-- maroon peaked cap: tall front, black visor, brass wreath badge -->
    <path d="M130 168 L96 112 C120 92 160 70 200 64 C240 70 280 92 304 112 L270 168 Z" fill="url(#capCrown)"/>
    <path d="M96 112 C120 92 160 70 200 64 C240 70 280 92 304 112" stroke="#7a2a2a" stroke-width="3" fill="none" opacity=".8"/>
    <path d="M96 112 L130 168 L142 168 L112 112 Z" fill="#5fe0b0" opacity=".12"/>
    <rect x="128" y="146" width="144" height="22" fill="#24090a"/>
    <rect x="128" y="146" width="144" height="3" fill="#8f6a3a" opacity=".55"/>
    <path d="M102 184 C138 164 262 164 298 184 C292 198 270 202 200 198 C130 202 108 198 102 184 Z" fill="url(#visor)"/>
    <path d="M122 176 C160 166 240 166 278 176" stroke="#9a8460" stroke-width="2" fill="none" opacity=".5"/>
    <g transform="translate(200 122)" fill="url(#brass)">
      <ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(-150)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(-128)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(-106)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(-84)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(-62)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(-40)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(30)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(52)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(74)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(96)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(118)"/><ellipse cx="0" cy="-20" rx="3.2" ry="7" transform="rotate(140)"/>
      <circle r="13" fill="#1d1408" stroke="url(#brass)" stroke-width="2.5"/>
      <path d="M0 -10 C6 -4 6 3 0 9 C-6 3 -6 -4 0 -10 Z"/>
    </g>
  </g>

  <g class="hand">${hand}</g>
  <g class="fx"></g>
  <rect width="400" height="480" filter="url(#grain)" opacity=".9" pointer-events="none"/>
  <rect width="400" height="480" fill="none" stroke="#000" stroke-width="70" opacity=".65" style="filter:blur(22px)"/>
</svg>`;
}

// an armoured glove coming at you, index finger out
const POINT = `
  <g>
    <path d="M410 480 C392 420 372 380 344 352 L300 384 C318 412 340 452 352 480 Z" fill="url(#coat)"/>
    <path d="M344 352 L300 384 L292 372 L334 340 Z" fill="url(#brassPlate)"/>
    <path d="M334 300 C356 296 376 314 374 338 C372 362 348 380 322 378 C296 376 280 356 284 334 C288 312 312 302 334 300 Z" fill="url(#glove)"/>
    <path d="M290 322 C300 310 322 306 338 310" stroke="#8a7350" stroke-width="3" fill="none" opacity=".75"/>
    <path d="M300 342 C306 336 316 336 322 342 M312 356 C318 350 328 350 334 356 M324 368 C330 362 340 362 346 368" stroke="#050403" stroke-width="3" fill="none"/>
    <path d="M298 322 C264 302 218 282 170 270 C152 266 138 280 144 298 C152 318 178 324 202 328 C238 334 270 340 292 346 Z" fill="url(#glove)"/>
    <path d="M298 322 C264 302 218 282 170 270" stroke="#8a7350" stroke-width="3" fill="none" opacity=".8"/>
    <path d="M228 292 C232 302 234 314 232 326 M190 282 C194 294 196 306 194 318" stroke="#050403" stroke-width="2.5" fill="none"/>
    <ellipse cx="158" cy="292" rx="20" ry="24" fill="#120e0a"/>
    <ellipse cx="152" cy="284" rx="7" ry="5" fill="#b49a63" opacity=".4"/>
  </g>`;

// a pistol aimed at you: the muzzle is the nearest thing
const PISTOL = `
  <g transform="translate(250 300)">
    <path d="M100 180 C80 140 70 100 74 70 L136 60 C144 100 144 140 136 180 Z" fill="url(#coat)"/>
    <path d="M74 70 L136 60 L132 82 L76 90 Z" fill="url(#brassPlate)"/>
    <ellipse cx="104" cy="44" rx="54" ry="46" fill="url(#glove)"/>
    <rect x="20" y="-40" width="110" height="70" rx="10" fill="#2a261e"/>
    <rect x="20" y="-40" width="110" height="10" rx="5" fill="#9a8a68" opacity=".5"/>
    <g class="muzzle" transform="translate(48 -6)">
      <circle r="46" fill="url(#steel)"/>
      <circle r="34" fill="#2a261e"/>
      <circle r="24" fill="#030202"/>
      <circle cx="-14" cy="-16" r="8" fill="#fff" opacity=".3"/>
    </g>
  </g>`;
