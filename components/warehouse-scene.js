/**
 * warehouse-scene.js
 * Standalone animated warehouse illustration for NexusKPI menu header.
 * Creates an SVG animation with 4 scenes: Recibo, Inventario, Picking, Carga & Embarque.
 * No external dependencies. Call WarehouseScene.init(containerId) to mount.
 */
(function (global) {
  'use strict';

  const WarehouseScene = {

    /* ─── Public API ──────────────────────────────────────────── */
    init(containerId) {
      const host = document.getElementById(containerId);
      if (!host) return;

      const svg = this._buildSVG();
      host.innerHTML = '';
      host.appendChild(svg);
      this._startAnimations(svg);
    },

    /* ─── SVG Builder ─────────────────────────────────────────── */
    _buildSVG() {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 900 160');
      svg.setAttribute('xmlns', ns);
      svg.style.cssText = 'width:100%;height:100%;overflow:visible;';
      svg.setAttribute('aria-label', 'Animación Cadena Logística');

      svg.innerHTML = `
      <defs>
        <style>
          .ws-floor { fill: rgba(0,212,255,0.04); stroke: rgba(0,212,255,0.12); stroke-width:1; }
          .ws-wall  { fill: rgba(13,20,32,0.6); stroke: rgba(0,212,255,0.1); stroke-width:1; }
          .ws-box   { fill: #1a3a5c; stroke: #00D4FF; stroke-width:1.2; rx:2; }
          .ws-box-dark { fill: #0f2744; stroke: rgba(0,212,255,0.5); stroke-width:1; }
          .ws-skin  { fill: #E8C49A; }
          .ws-shirt { fill: #0077CC; }
          .ws-pants { fill: #1a2a3e; }
          .ws-hair  { fill: #3a2010; }
          .ws-truck { fill: #1e3a55; stroke: #00D4FF; stroke-width:1.2; }
          .ws-wheel { fill: #0a1520; stroke: rgba(0,212,255,0.6); stroke-width:1.2; }
          .ws-label { font-family: 'Syne', 'Arial', sans-serif; font-size: 7px; font-weight:700;
                      letter-spacing:.08em; text-transform:uppercase; }
          .ws-scene-label { font-family: 'Syne', 'Arial', sans-serif; font-size: 6.5px; font-weight:700;
                            letter-spacing:.12em; text-transform:uppercase; fill: rgba(0,212,255,0.55); }
          .ws-glow  { filter: drop-shadow(0 0 3px rgba(0,212,255,0.7)); }
          .ws-scanbeam { stroke:#00FF88; stroke-width:1.5; stroke-linecap:round; opacity:0; }
          .ws-divider { stroke: rgba(0,212,255,0.08); stroke-width:1; stroke-dasharray:3,4; }

          /* ── Keyframes ── */
          @keyframes ws-bob    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
          @keyframes ws-walk   { 0%,100%{transform:translateX(0)} 50%{transform:translateX(2px)} }
          @keyframes ws-arm-r  { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(-18deg)} }
          @keyframes ws-arm-l  { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(14deg)} }
          @keyframes ws-box-fall{ 0%{transform:translateY(-18px);opacity:0} 80%{opacity:1} 100%{transform:translateY(0);opacity:1} }
          @keyframes ws-truck-in{ 0%{transform:translateX(60px);opacity:0} 100%{transform:translateX(0);opacity:1} }
          @keyframes ws-scan   { 0%,100%{opacity:0} 30%,70%{opacity:0.85} }
          @keyframes ws-cursor { 0%,100%{opacity:1} 50%{opacity:0} }
          @keyframes ws-type   { 0%{clip-path:inset(0 100% 0 0)} 100%{clip-path:inset(0 0% 0 0)} }
          @keyframes ws-door-open{ 0%,100%{transform:scaleX(1)} 50%{transform:scaleX(0.15)} }
          @keyframes ws-float  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
          @keyframes ws-pulse  { 0%,100%{opacity:0.4} 50%{opacity:1} }
          @keyframes ws-shimmer{ 0%{opacity:0.3} 50%{opacity:0.9} 100%{opacity:0.3} }
          @keyframes ws-leg-l  { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(10deg)} }
          @keyframes ws-leg-r  { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(-10deg)} }
          @keyframes ws-conveyor{ 0%{stroke-dashoffset:0} 100%{stroke-dashoffset:-20} }
          @keyframes ws-boxship{ 0%{transform:translateX(0)} 100%{transform:translateX(-12px)} }
        </style>
        <linearGradient id="ws-floor-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,212,255,0.06)"/>
          <stop offset="100%" stop-color="rgba(0,212,255,0.01)"/>
        </linearGradient>
        <linearGradient id="ws-box-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1a4a70"/>
          <stop offset="100%" stop-color="#0a1e33"/>
        </linearGradient>
        <linearGradient id="ws-truck-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#1a3a5a"/>
          <stop offset="100%" stop-color="#0d1f30"/>
        </linearGradient>
        <filter id="ws-glow-filter">
          <feGaussianBlur stdDeviation="1.5" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>

      <!-- ═══ BACKGROUND FLOOR ═══ -->
      <rect x="0" y="120" width="900" height="40" fill="url(#ws-floor-grad)" rx="2"/>
      <line x1="0" y1="120" x2="900" y2="120" stroke="rgba(0,212,255,0.12)" stroke-width="0.8"/>

      <!-- Scene dividers -->
      <line class="ws-divider" x1="220" y1="10" x2="220" y2="148"/>
      <line class="ws-divider" x1="450" y1="10" x2="450" y2="148"/>
      <line class="ws-divider" x1="670" y1="10" x2="670" y2="148"/>

      <!-- ═══ SCENE 1: RECIBO — worker unloading truck ═══ -->
      <g id="ws-scene1">
        <text class="ws-scene-label" x="110" y="12" text-anchor="middle">① Recibo</text>

        <!-- Truck body -->
        <g id="ws-truck1" style="animation:ws-truck-in 1s 0.2s cubic-bezier(.34,1.56,.64,1) both">
          <!-- Trailer -->
          <rect x="8" y="72" width="88" height="46" fill="url(#ws-truck-grad)" stroke="#00D4FF" stroke-width="1.2" rx="2"/>
          <!-- Cab -->
          <rect x="96" y="84" width="38" height="34" fill="#1e3a55" stroke="#00D4FF" stroke-width="1.2" rx="2"/>
          <!-- Window -->
          <rect x="100" y="87" width="28" height="16" fill="rgba(0,212,255,0.15)" stroke="rgba(0,212,255,0.4)" stroke-width="0.8" rx="1"/>
          <!-- Cab front slope -->
          <path d="M134 84 L140 88 L140 118 L134 118Z" fill="#162c44" stroke="#00D4FF" stroke-width="0.8"/>
          <!-- Wheels -->
          <circle cx="30" cy="119" r="8" class="ws-wheel"/>
          <circle cx="30" cy="119" r="4" fill="rgba(0,212,255,0.2)"/>
          <circle cx="70" cy="119" r="8" class="ws-wheel"/>
          <circle cx="70" cy="119" r="4" fill="rgba(0,212,255,0.2)"/>
          <circle cx="118" cy="119" r="7" class="ws-wheel"/>
          <circle cx="118" cy="119" r="3.5" fill="rgba(0,212,255,0.2)"/>
          <!-- Truck door open -->
          <rect id="ws-truck-door" x="8" y="72" width="12" height="46" fill="#0a1e33" stroke="rgba(0,212,255,0.6)" stroke-width="1" style="transform-origin:20px 72px; animation:ws-door-open 3s 1s ease-in-out infinite"/>
          <!-- Boxes inside truck -->
          <rect x="22" y="85" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
          <rect x="40" y="85" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
          <rect x="58" y="85" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
          <rect x="31" y="99" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
          <rect x="49" y="99" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
          <!-- Headlights -->
          <rect x="138" y="90" width="4" height="5" fill="rgba(255,220,60,0.8)" rx="1" style="animation:ws-pulse 1.5s ease-in-out infinite"/>
          <rect x="138" y="102" width="4" height="4" fill="rgba(255,80,60,0.6)" rx="1"/>
        </g>

        <!-- Falling box (being unloaded) -->
        <g id="ws-falling-box" style="animation:ws-float 1.8s 0.5s ease-in-out infinite">
          <rect x="153" y="86" width="18" height="16" fill="url(#ws-box-grad)" stroke="#00D4FF" stroke-width="1.2" rx="1.5" class="ws-glow"/>
          <!-- Box cross lines -->
          <line x1="153" y1="94" x2="171" y2="94" stroke="rgba(0,212,255,0.4)" stroke-width="0.6"/>
          <line x1="162" y1="86" x2="162" y2="102" stroke="rgba(0,212,255,0.4)" stroke-width="0.6"/>
        </g>

        <!-- Stack of boxes on floor -->
        <rect x="168" y="104" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
        <rect x="170" y="92" width="14" height="12" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.6)" stroke-width="0.8" rx="1"/>
        <rect x="172" y="82" width="12" height="10" fill="url(#ws-box-grad)" stroke="#00D4FF" stroke-width="0.8" rx="1"/>

        <!-- Worker 1 (unloader) -->
        <g id="ws-worker1" style="animation:ws-bob 1.6s ease-in-out infinite">
          <!-- Legs -->
          <rect x="185" y="107" width="5" height="13" fill="#1a2a3e" rx="2" style="transform-origin:185px 107px; animation:ws-leg-l 0.8s ease-in-out infinite"/>
          <rect x="191" y="107" width="5" height="13" fill="#1a2a3e" rx="2" style="transform-origin:196px 107px; animation:ws-leg-r 0.8s ease-in-out infinite"/>
          <!-- Body -->
          <rect x="183" y="93" width="15" height="15" fill="#0077CC" rx="3"/>
          <!-- Head -->
          <circle cx="190" cy="87" r="6.5" fill="#E8C49A"/>
          <!-- Hair -->
          <path d="M183.5 84 Q190 79 196.5 84" fill="#3a2010"/>
          <!-- Helmet/hard hat -->
          <ellipse cx="190" cy="81.5" rx="7" ry="4" fill="#FFB020" opacity="0.9"/>
          <!-- Arms carrying box -->
          <rect id="ws-arm1-l" x="178" y="96" width="6" height="3" fill="#E8C49A" rx="1.5" style="transform-origin:183px 97px; animation:ws-arm-l 0.8s ease-in-out infinite"/>
          <rect id="ws-arm1-r" x="197" y="96" width="6" height="3" fill="#E8C49A" rx="1.5" style="transform-origin:197px 97px; animation:ws-arm-r 0.8s ease-in-out infinite"/>
          <!-- Eyes -->
          <circle cx="187" cy="87" r="1" fill="#3a2010"/>
          <circle cx="193" cy="87" r="1" fill="#3a2010"/>
        </g>
      </g>

      <!-- ═══ SCENE 2: INVENTARIO — worker at computer/shelves ═══ -->
      <g id="ws-scene2">
        <text class="ws-scene-label" x="335" y="12" text-anchor="middle">② Inventario</text>

        <!-- Shelving unit -->
        <rect x="230" y="55" width="60" height="65" fill="rgba(13,20,32,0.8)" stroke="rgba(0,212,255,0.2)" stroke-width="1" rx="2"/>
        <!-- Shelf levels -->
        <line x1="230" y1="75" x2="290" y2="75" stroke="rgba(0,212,255,0.25)" stroke-width="1.2"/>
        <line x1="230" y1="95" x2="290" y2="95" stroke="rgba(0,212,255,0.25)" stroke-width="1.2"/>
        <line x1="230" y1="115" x2="290" y2="115" stroke="rgba(0,212,255,0.25)" stroke-width="1.2"/>
        <!-- Boxes on shelves -->
        <rect x="233" y="61" width="11" height="13" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="246" y="61" width="11" height="13" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="259" y="61" width="11" height="13" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="272" y="63" width="11" height="11" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>

        <rect x="233" y="80" width="14" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="249" y="80" width="11" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="262" y="82" width="11" height="12" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>

        <rect x="233" y="100" width="11" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="246" y="100" width="14" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="262" y="100" width="11" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>

        <!-- Desk -->
        <rect x="305" y="108" width="55" height="4" fill="#1a3a5c" stroke="rgba(0,212,255,0.3)" stroke-width="0.8" rx="1"/>
        <rect x="308" y="112" width="4" height="8" fill="#1a3a5c" rx="1"/>
        <rect x="352" y="112" width="4" height="8" fill="#1a3a5c" rx="1"/>

        <!-- Monitor -->
        <rect x="316" y="86" width="32" height="22" fill="#0d1420" stroke="#00D4FF" stroke-width="1.2" rx="2"/>
        <rect x="318" y="88" width="28" height="18" fill="rgba(0,212,255,0.08)" rx="1"/>
        <!-- Screen content (animated text lines) -->
        <rect x="320" y="90" width="16" height="1.5" fill="rgba(0,212,255,0.6)" rx="0.5" style="animation:ws-shimmer 1.2s 0s ease-in-out infinite"/>
        <rect x="320" y="93" width="22" height="1.5" fill="rgba(0,255,136,0.5)" rx="0.5" style="animation:ws-shimmer 1.2s 0.2s ease-in-out infinite"/>
        <rect x="320" y="96" width="14" height="1.5" fill="rgba(0,212,255,0.5)" rx="0.5" style="animation:ws-shimmer 1.2s 0.4s ease-in-out infinite"/>
        <rect x="320" y="99" width="20" height="1.5" fill="rgba(0,255,136,0.4)" rx="0.5" style="animation:ws-shimmer 1.2s 0.6s ease-in-out infinite"/>
        <rect x="320" y="102" width="18" height="1.5" fill="rgba(0,212,255,0.4)" rx="0.5" style="animation:ws-shimmer 1.2s 0.3s ease-in-out infinite"/>
        <!-- Cursor blink -->
        <rect x="340" y="102" width="1.5" height="3" fill="#00D4FF" style="animation:ws-cursor 0.7s step-end infinite"/>
        <!-- Monitor stand -->
        <rect x="329" y="108" width="5" height="3" fill="#1a3a5c" rx="0.5"/>
        <rect x="325" y="111" width="13" height="2" fill="#1a3a5c" rx="0.5"/>

        <!-- Keyboard -->
        <rect x="315" y="111" width="28" height="4" fill="#111c2e" stroke="rgba(0,212,255,0.2)" stroke-width="0.8" rx="1"/>
        <rect x="317" y="112" width="3" height="2" fill="rgba(0,212,255,0.15)" rx="0.3"/>
        <rect x="321" y="112" width="3" height="2" fill="rgba(0,212,255,0.15)" rx="0.3"/>
        <rect x="325" y="112" width="3" height="2" fill="rgba(0,212,255,0.15)" rx="0.3"/>
        <rect x="329" y="112" width="3" height="2" fill="rgba(0,212,255,0.15)" rx="0.3"/>
        <rect x="333" y="112" width="3" height="2" fill="rgba(0,212,255,0.15)" rx="0.3"/>
        <rect x="337" y="112" width="3" height="2" fill="rgba(0,212,255,0.15)" rx="0.3"/>

        <!-- Worker 2 (inventory clerk, seated) -->
        <g id="ws-worker2" style="animation:ws-bob 2s 0.3s ease-in-out infinite">
          <!-- Chair -->
          <rect x="350" y="113" width="14" height="2" fill="#0a1520" rx="1"/>
          <rect x="356" y="115" width="3" height="5" fill="#0a1520" rx="1"/>
          <!-- Body seated -->
          <rect x="349" y="100" width="14" height="13" fill="#7B2FFF" rx="3"/>
          <!-- Head -->
          <circle cx="356" cy="94" r="6" fill="#E8C49A"/>
          <!-- Hair -->
          <path d="M350 91 Q356 86.5 362 91" fill="#5a3010"/>
          <!-- Arms typing -->
          <rect x="342" y="107" width="8" height="3" fill="#E8C49A" rx="1.5" style="transform-origin:349px 108px; animation:ws-arm-r 0.4s ease-in-out infinite"/>
          <rect x="362" y="107" width="8" height="3" fill="#E8C49A" rx="1.5" style="transform-origin:362px 108px; animation:ws-arm-l 0.4s ease-in-out infinite"/>
          <!-- Eyes (focused on screen) -->
          <circle cx="353" cy="94" r="1" fill="#3a2010"/>
          <circle cx="359" cy="94" r="1" fill="#3a2010"/>
          <!-- Glasses -->
          <rect x="350" y="92.5" width="6" height="4" fill="none" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1.5"/>
          <rect x="357" y="92.5" width="6" height="4" fill="none" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1.5"/>
          <line x1="356" y1="94.5" x2="357" y2="94.5" stroke="rgba(0,212,255,0.5)" stroke-width="0.8"/>
        </g>

        <!-- Clipboard with checklist -->
        <g style="animation:ws-float 2.5s ease-in-out infinite">
          <rect x="292" y="88" width="14" height="19" fill="#1a3a5c" stroke="rgba(0,212,255,0.4)" stroke-width="0.8" rx="1"/>
          <rect x="295" y="84" width="8" height="5" fill="#111c2e" stroke="rgba(0,212,255,0.3)" stroke-width="0.7" rx="1"/>
          <line x1="294" y1="93" x2="303" y2="93" stroke="rgba(0,255,136,0.6)" stroke-width="0.8"/>
          <line x1="294" y1="97" x2="303" y2="97" stroke="rgba(0,255,136,0.6)" stroke-width="0.8"/>
          <line x1="294" y1="101" x2="299" y2="101" stroke="rgba(0,212,255,0.4)" stroke-width="0.8"/>
          <text x="292.5" y="92.5" fill="rgba(0,255,136,0.8)" font-size="3.5">✓</text>
          <text x="292.5" y="96.5" fill="rgba(0,255,136,0.8)" font-size="3.5">✓</text>
          <text x="292.5" y="100.5" fill="rgba(0,212,255,0.5)" font-size="3.5">○</text>
        </g>
      </g>

      <!-- ═══ SCENE 3: PICKING — worker scanning with gun ═══ -->
      <g id="ws-scene3">
        <text class="ws-scene-label" x="560" y="12" text-anchor="middle">③ Picking</text>

        <!-- Shelving unit right -->
        <rect x="458" y="55" width="55" height="65" fill="rgba(13,20,32,0.8)" stroke="rgba(0,212,255,0.2)" stroke-width="1" rx="2"/>
        <line x1="458" y1="75" x2="513" y2="75" stroke="rgba(0,212,255,0.25)" stroke-width="1.2"/>
        <line x1="458" y1="95" x2="513" y2="95" stroke="rgba(0,212,255,0.25)" stroke-width="1.2"/>
        <line x1="458" y1="115" x2="513" y2="115" stroke="rgba(0,212,255,0.25)" stroke-width="1.2"/>
        <!-- Boxes on shelves 3 -->
        <rect x="461" y="61" width="12" height="13" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="475" y="61" width="11" height="13" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="488" y="63" width="12" height="11" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="461" y="80" width="12" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <!-- highlighted box being picked -->
        <rect x="475" y="80" width="14" height="14" fill="rgba(0,255,136,0.15)" stroke="#00FF88" stroke-width="1.2" rx="1" style="animation:ws-pulse 1s ease-in-out infinite"/>
        <rect x="488" y="80" width="12" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="461" y="100" width="12" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="475" y="100" width="11" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
        <rect x="488" y="100" width="12" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>

        <!-- Picking cart/trolley -->
        <g id="ws-cart" style="animation:ws-walk 1.2s 0.5s ease-in-out infinite">
          <rect x="530" y="94" width="28" height="26" fill="rgba(13,20,32,0.9)" stroke="rgba(0,212,255,0.4)" stroke-width="1" rx="2"/>
          <!-- Cart shelves -->
          <line x1="530" y1="104" x2="558" y2="104" stroke="rgba(0,212,255,0.3)" stroke-width="0.8"/>
          <line x1="530" y1="114" x2="558" y2="114" stroke="rgba(0,212,255,0.3)" stroke-width="0.8"/>
          <!-- Cart wheels -->
          <circle cx="536" cy="122" r="3.5" class="ws-wheel"/>
          <circle cx="552" cy="122" r="3.5" class="ws-wheel"/>
          <!-- Box on cart -->
          <rect x="533" y="96" width="11" height="8" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
          <rect x="546" y="96" width="10" height="8" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
          <rect x="533" y="105" width="11" height="9" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
          <!-- Cart handle -->
          <rect x="556" y="87" width="3" height="10" fill="#1a3a5c" stroke="rgba(0,212,255,0.3)" stroke-width="0.7" rx="1"/>
          <rect x="553" y="86" width="9" height="3" fill="#1a3a5c" stroke="rgba(0,212,255,0.3)" stroke-width="0.7" rx="1"/>
        </g>

        <!-- Worker 3 (picker with scanner) -->
        <g id="ws-worker3" style="animation:ws-bob 1.4s 0.7s ease-in-out infinite">
          <!-- Legs -->
          <rect x="583" y="107" width="5" height="13" fill="#1a2a3e" rx="2" style="transform-origin:583px 107px; animation:ws-leg-l 0.7s ease-in-out infinite"/>
          <rect x="589" y="107" width="5" height="13" fill="#1a2a3e" rx="2" style="transform-origin:594px 107px; animation:ws-leg-r 0.7s ease-in-out infinite"/>
          <!-- Body -->
          <rect x="581" y="92" width="15" height="16" fill="#00A36C" rx="3"/>
          <!-- Vest accent -->
          <rect x="584" y="92" width="9" height="16" fill="rgba(0,255,136,0.12)" rx="1"/>
          <!-- Head -->
          <circle cx="588" cy="86" r="6.5" fill="#C9956A"/>
          <!-- Hair -->
          <path d="M581.5 83 Q588 78 594.5 83" fill="#2a1505"/>
          <!-- Hard hat -->
          <ellipse cx="588" cy="80.5" rx="7" ry="4" fill="#00D4FF" opacity="0.9"/>
          <!-- Eyes -->
          <circle cx="585.5" cy="86" r="1" fill="#2a1505"/>
          <circle cx="591" cy="86" r="1" fill="#2a1505"/>
          <!-- Left arm holding scanner gun -->
          <rect x="566" y="96" width="16" height="3" fill="#C9956A" rx="1.5" style="transform-origin:581px 97px; animation:ws-arm-l 0.35s ease-in-out infinite"/>
          <!-- Scanner gun -->
          <rect x="554" y="92" width="14" height="8" fill="#1a3a5c" stroke="#00D4FF" stroke-width="1" rx="2"/>
          <rect x="558" y="100" width="6" height="5" fill="#1a3a5c" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" rx="1"/>
          <rect x="556" y="93" width="8" height="3" fill="rgba(0,212,255,0.15)" rx="1"/>
          <!-- Scan beam -->
          <line class="ws-scanbeam" x1="554" y1="96" x2="494" y2="87" style="animation:ws-scan 1.2s ease-in-out infinite"/>
          <!-- Right arm -->
          <rect x="596" y="96" width="7" height="3" fill="#C9956A" rx="1.5" style="transform-origin:596px 97px; animation:ws-arm-r 0.7s ease-in-out infinite"/>
        </g>

        <!-- Scan confirmed badge -->
        <g style="animation:ws-pulse 1.2s ease-in-out infinite">
          <rect x="476" y="75" width="14" height="7" fill="rgba(0,255,136,0.15)" stroke="#00FF88" stroke-width="0.8" rx="1.5"/>
          <text x="483" y="80.5" text-anchor="middle" font-family="Syne,Arial,sans-serif" font-size="4.5" fill="#00FF88">✓ OK</text>
        </g>
      </g>

      <!-- ═══ SCENE 4: CARGA & EMBARQUE — loading truck, door closing ═══ -->
      <g id="ws-scene4">
        <text class="ws-scene-label" x="785" y="12" text-anchor="middle">④ Despacho</text>

        <!-- Delivery truck (rear view perspective) -->
        <g id="ws-truck2">
          <!-- Truck body rear -->
          <rect x="690" y="62" width="100" height="57" fill="url(#ws-truck-grad)" stroke="#00D4FF" stroke-width="1.2" rx="2"/>
          <!-- Truck rear opening / cargo door -->
          <rect id="ws-cargo-door" x="695" y="65" width="90" height="48" fill="#0d1a2a" stroke="rgba(0,212,255,0.4)" stroke-width="0.8" rx="1"/>
          <!-- Boxes inside truck stacked -->
          <g style="animation:ws-boxship 2s ease-in-out infinite alternate">
            <rect x="698" y="70" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="716" y="70" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="734" y="70" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="752" y="70" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="770" y="72" width="15" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="698" y="86" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="716" y="86" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="734" y="86" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="752" y="86" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="770" y="86" width="15" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="698" y="102" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="716" y="102" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
            <rect x="734" y="102" width="16" height="14" fill="url(#ws-box-grad)" stroke="rgba(0,212,255,0.5)" stroke-width="0.7" rx="1"/>
          </g>
          <!-- Truck rear door closing animation -->
          <rect id="ws-rear-door-top" x="690" y="62" width="100" height="4" fill="#1e3a55" stroke="#00D4FF" stroke-width="1" style="transform-origin:740px 62px; animation:ws-door-close-top 4s 1s ease-in-out infinite"/>
          <rect id="ws-rear-door-bot" x="690" y="115" width="100" height="4" fill="#1e3a55" stroke="#00D4FF" stroke-width="1" style="transform-origin:740px 119px; animation:ws-door-close-bot 4s 1s ease-in-out infinite"/>
          <!-- Door hinges -->
          <rect x="790" y="64" width="5" height="54" fill="rgba(0,212,255,0.08)" stroke="rgba(0,212,255,0.3)" stroke-width="0.8" rx="1"/>
          <!-- Latch -->
          <circle cx="695" cy="92" r="3" fill="#1a3a5c" stroke="#00D4FF" stroke-width="0.8" style="animation:ws-pulse 2s ease-in-out infinite"/>
          <!-- Rear lights -->
          <rect x="792" y="66" width="5" height="8" fill="rgba(255,60,60,0.7)" rx="1" style="animation:ws-pulse 1s ease-in-out infinite"/>
          <rect x="792" y="109" width="5" height="8" fill="rgba(255,60,60,0.7)" rx="1" style="animation:ws-pulse 1s 0.5s ease-in-out infinite"/>
          <!-- Wheels -->
          <circle cx="710" cy="122" r="8" class="ws-wheel"/>
          <circle cx="710" cy="122" r="4" fill="rgba(0,212,255,0.2)"/>
          <circle cx="770" cy="122" r="8" class="ws-wheel"/>
          <circle cx="770" cy="122" r="4" fill="rgba(0,212,255,0.2)"/>
        </g>

        <!-- Worker 4 (loading, standing) -->
        <g id="ws-worker4" style="animation:ws-bob 1.5s 0.2s ease-in-out infinite">
          <!-- Legs -->
          <rect x="838" y="107" width="5" height="13" fill="#1a2a3e" rx="2" style="transform-origin:838px 107px; animation:ws-leg-l 0.75s 0.1s ease-in-out infinite"/>
          <rect x="844" y="107" width="5" height="13" fill="#1a2a3e" rx="2" style="transform-origin:849px 107px; animation:ws-leg-r 0.75s 0.1s ease-in-out infinite"/>
          <!-- Body -->
          <rect x="836" y="93" width="16" height="15" fill="#CC3300" rx="3"/>
          <!-- Head -->
          <circle cx="844" cy="87" r="6.5" fill="#D4A574"/>
          <!-- Hair -->
          <path d="M837.5 84 Q844 79 850.5 84" fill="#1a0a00"/>
          <!-- Hard hat -->
          <ellipse cx="844" cy="80.5" rx="7" ry="4" fill="#FFB020" opacity="0.9"/>
          <!-- Eyes -->
          <circle cx="841" cy="87" r="1" fill="#1a0a00"/>
          <circle cx="847" cy="87" r="1" fill="#1a0a00"/>
          <!-- Arms pushing box -->
          <rect x="821" y="97" width="16" height="3" fill="#D4A574" rx="1.5" style="transform-origin:836px 98px; animation:ws-arm-l 0.75s 0.1s ease-in-out infinite"/>
          <rect x="852" y="97" width="7" height="3" fill="#D4A574" rx="1.5" style="transform-origin:852px 98px; animation:ws-arm-r 0.75s 0.1s ease-in-out infinite"/>
          <!-- Box being pushed -->
          <g style="animation:ws-float 1.5s ease-in-out infinite">
            <rect x="806" y="88" width="18" height="16" fill="url(#ws-box-grad)" stroke="#00D4FF" stroke-width="1.2" rx="1.5" class="ws-glow"/>
            <line x1="806" y1="96" x2="824" y2="96" stroke="rgba(0,212,255,0.4)" stroke-width="0.6"/>
            <line x1="815" y1="88" x2="815" y2="104" stroke="rgba(0,212,255,0.4)" stroke-width="0.6"/>
          </g>
        </g>

        <!-- Departure arrow / motion lines -->
        <g style="animation:ws-pulse 1.5s ease-in-out infinite">
          <line x1="870" y1="90" x2="885" y2="90" stroke="rgba(0,212,255,0.6)" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="874" y1="85" x2="885" y2="90" stroke="rgba(0,212,255,0.6)" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="874" y1="95" x2="885" y2="90" stroke="rgba(0,212,255,0.6)" stroke-width="1.5" stroke-linecap="round"/>
        </g>
        <!-- Motion speed lines behind truck -->
        <g style="animation:ws-shimmer 0.8s ease-in-out infinite">
          <line x1="678" y1="85" x2="690" y2="85" stroke="rgba(0,212,255,0.3)" stroke-width="1" stroke-linecap="round"/>
          <line x1="676" y1="92" x2="690" y2="92" stroke="rgba(0,212,255,0.25)" stroke-width="0.8" stroke-linecap="round"/>
          <line x1="680" y1="99" x2="690" y2="99" stroke="rgba(0,212,255,0.2)" stroke-width="0.7" stroke-linecap="round"/>
        </g>
      </g>

      <!-- ═══ CONNECTING CONVEYOR BELT (subtle) ═══ -->
      <line x1="220" y1="135" x2="450" y2="135" stroke="rgba(0,212,255,0.15)" stroke-width="3" stroke-dasharray="8,4" style="animation:ws-conveyor 0.8s linear infinite"/>
      <line x1="450" y1="135" x2="670" y2="135" stroke="rgba(0,212,255,0.12)" stroke-width="3" stroke-dasharray="8,4" style="animation:ws-conveyor 0.8s 0.3s linear infinite"/>
      `;

      // Add closing door keyframes dynamically
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = `
        @keyframes ws-door-close-top { 0%,40%{transform:scaleY(1)} 60%,80%{transform:scaleY(8)} 100%{transform:scaleY(1)} }
        @keyframes ws-door-close-bot { 0%,40%{transform:scaleY(1)} 60%,80%{transform:scaleY(-7)} 100%{transform:scaleY(1)} }
      `;
      svg.querySelector('defs').appendChild(style);

      return svg;
    },

    /* ─── Interactive Tooltips ────────────────────────────────── */
    _startAnimations(svg) {
      const tooltips = [
        { id: 'ws-scene1', label: 'Recibo · KPI-REC-001' },
        { id: 'ws-scene2', label: 'Inventario · KPI-INV-002' },
        { id: 'ws-scene3', label: 'Picking · KPI-DES-003' },
        { id: 'ws-scene4', label: 'Despacho · KPI-DES-005' },
      ];

      tooltips.forEach(({ id, label }) => {
        const g = svg.getElementById(id);
        if (!g) return;
        g.style.cursor = 'pointer';
        g.setAttribute('tabindex', '0');
        g.addEventListener('mouseenter', () => {
          g.style.filter = 'brightness(1.2)';
        });
        g.addEventListener('mouseleave', () => {
          g.style.filter = '';
        });
        g.addEventListener('click', () => {
          // Pulse effect on click
          g.style.transition = 'filter 0.15s';
          g.style.filter = 'brightness(1.6) drop-shadow(0 0 6px rgba(0,212,255,0.8))';
          setTimeout(() => { g.style.filter = ''; }, 300);
        });
      });
    }
  };

  global.WarehouseScene = WarehouseScene;
})(window);
