# Third-party notices

Notable dependencies and copied source components. Everything listed must be free / open-source.

| Item | License | Notes |
|---|---|---|
| React, Vite, TypeScript | MIT / Apache-2.0 | Core stack |
| Tailwind CSS v4 | MIT | Styling |
| shadcn/ui (source copied into `src/components/ui`) | MIT | Base components |
| Motion | MIT | Animation |
| Geist font (`@fontsource-variable/geist`) | OFL-1.1 | Typography |
| Fraunces font (`@fontsource-variable/fraunces`, optical-size cut) | OFL-1.1 | Display headlines only |
| Lucide icons | ISC | Icons |
| Componentry `magnetic-dock` (src/components/ui/magnetic-dock.tsx) | MIT | Imports changed from framer-motion to motion/react; colors converted to theme tokens |
| Cult UI `halo-button` (src/components/ui/halo-button.tsx) | MIT | Depends on @base-ui/react (MIT); gradient recolored to the green palette |
| Aceternity UI `spotlight` (src/components/ui/spotlight.tsx) | Free component (Aceternity free tier) | Keyframes added in src/index.css; only free-tier items are used |
| @base-ui/react | MIT | Button primitive used by halo-button |
| Componentry `infinite-image-field` (src/components/ui/infinite-image-field.tsx) | MIT | Patched: self-hosted photos, pointer/touch idle drift, reduced-motion + off-screen pause, neighbour-safe tiling |
| Componentry `pixel-canvas` (src/components/ui/pixel-canvas.tsx) | MIT | Patched: stable green palette, sleeps when idle, reduced-motion, new `trackParent` prop |
| Componentry `scroll-based-velocity` (src/components/ui/scroll-based-velocity.tsx) | MIT | Patched: motion/react instead of framer-motion, wheel/swipe input for a non-scrolling hero, real skew, reduced-motion, separate second-row text/style, aria-label |

## Photography

Photos in `public/photos/field-01..10.webp` are from Unsplash, used under the [Unsplash License](https://unsplash.com/license) (free to use, no attribution required). Resized/recompressed to 400x560 WebP. Source photo IDs:
1506905925346-21bda4d32df4, 1469474968028-56623f02e42e, 1433086966358-54859d0ed716, 1501854140801-50d01698950b, 1464822759023-fed622ff2c3b, 1500534314209-a25ddb2bd429, 1440342359743-84fcb8c21f21, 1511884642898-4c92249e20b6, 1448375240586-882707db888b, 1542273917363-3b1817f69a2d.
Unsplash+ (premium) images are NOT used. A pink/purple galaxy image from the component's defaults was dropped for palette reasons.

