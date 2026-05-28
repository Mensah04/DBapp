const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, 'Public', 'icons');

// Create directory if it doesn't exist
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

sizes.forEach(size => {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#10b981"/>
    <text x="50%" y="50%" text-anchor="middle" dy="0.3em" fill="white" font-size="${size/2.5}" font-family="Arial, sans-serif">✝</text>
  </svg>`;
  
  const filePath = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(filePath, svgContent);
  console.log(`Created ${filePath}`);
});

console.log('✅ All SVG icons generated successfully!');