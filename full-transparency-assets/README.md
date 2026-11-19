# Full Transparency visual asset pack

## Import into Next.js

1. Copy **public/full-transparency/** into your repository's **public/**.
2. Merge **app/** into your existing App Router directory (**app/** or **src/app/**). The Open Graph image and alt text use the file-based convention. Choose the SVG icon or ICO favicon if you want one browser icon declaration. Keep existing metadata where it applies.
3. Import **design/tokens.css** from your global stylesheet or root layout. The **--ft-** prefix scopes the custom property names. The JSON file provides the same values for other tooling.
4. Merge the following into the root layout metadata. Set metadataBase to the deployed site's canonical origin.

~~~ts
export const metadata = {
  manifest: '/full-transparency/pwa/manifest.webmanifest',
  icons: { apple: '/full-transparency/pwa/apple-touch-icon.png' },
}
~~~

The manifest assumes deployment at the domain root. For a base path, adjust the manifest scope, start URL, icon URLs and asset references. The splash PNGs suit loading screens or explicitly configured Apple startup images. Installability and offline behavior depend on the app setup.

## Page artwork

| Surface | WebP stem | Placement |
| --- | --- | --- |
| Homepage | hero | Left-aligned headline with illustration at right |
| /plans | plans | Banner above calendar and list |
| /history | history | Above published, generalized location history |
| /admin/map | geofence | Above the private geofence settings |

Each stem has 768px and 1600px variants at /full-transparency/art/. Use srcSet with width descriptors, or use the 1600px source with Next.js Image and a suitable sizes prop. Apply an empty alt to decorative images. Preserve the full frame when practical. On narrow screens, place copy above the artwork.

## Brand and interface

- Use the primary logo on light surfaces, reverse on navy, stacked in square placements and mono for single-ink use. The SVG wordmarks use Arial with a sans-serif fallback.
- Inline the 24-unit SVG icons to inherit currentColor. External SVG images render with black strokes. Give icon-only controls accessible names.
- Use DM Sans for display and Inter for UI text, with system fallbacks. Font binaries are optional app dependencies.
- Use white text on blue or jade and navy on pale surfaces. Pair status colours with labels. Apply the focus token as a visible outline on light surfaces.

The map artwork depicts fictional geography and includes no addresses, coordinates or personal location data. The prior chat supplied written design descriptions. Those descriptions guided this pack.

The asset manifest lists files, dimensions and SHA-256 hashes. Image generation prompts are in **design/artwork-prompts.md**.
