export function readPwaIcon(file, size) {
  return new Promise((resolve, reject) => {
    if (!file || file.type !== 'image/png' || file.size > 512 * 1024) { reject(new Error('Choose a PNG image up to 512 KB.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the icon. Try another PNG.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('This file is not a readable PNG image.'));
      image.onload = () => image.naturalWidth === size && image.naturalHeight === size
        ? resolve(reader.result) : reject(new Error(`Choose an icon exactly ${size} x ${size} pixels.`));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function buildPwaManifest(settings, domainKey, apiBase) {
  const origin = new URL(settings.start_url).origin;
  return {
    id: `${origin}/`, name: settings.name, short_name: settings.short_name,
    start_url: settings.start_url, scope: `${origin}/`, display: 'standalone',
    theme_color: settings.theme_color, background_color: settings.background_color,
    prefer_related_applications: false,
    icons: [192, 512].map(size => ({ src: `${apiBase}/api/pwa/${encodeURIComponent(domainKey)}/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  };
}

export function downloadManifest(manifest) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/manifest+json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'push-pwa-manifest.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
