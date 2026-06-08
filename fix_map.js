const fs = require('fs');

let css = fs.readFileSync('src/index.css', 'utf8');
css = css.replace(/filter: brightness\(0.32\) contrast\(1.4\) saturate\(0.18\) sepia\(0.2\) hue-rotate\(185deg\);/, '');
fs.writeFileSync('src/index.css', css);

let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(
  "L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {",
  "L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {"
);
app = app.replace(
  "<div ref={mapRef} style={{ width: '100%', height: '100%' }} />",
  "<div ref={mapRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }} />"
);
fs.writeFileSync('src/App.tsx', app);
