# TacticMesh brand artwork

Created for TacticMesh by Wert Qas on 2026-10-06 using the built-in imagegen tool. These original generated assets contain fictional, unbranded footballers and no real club marks. The source images are kept in `originals/`; runtime derivatives are prepared by the product build workstream. The assets include the project's [MIT licence](LICENSE). The game credits [Wert Qas](https://www.youtube.com/@wertqas9269).

Selected originals:

- `originals/tacticmesh-logo.png`: 2172 × 724, horizontal logo with dark navy backing.
- `originals/tacticmesh-icon.png`: 1254 × 1254, matching emblem for favicon and app icons.
- `originals/tacticmesh-hero.png`: 1672 × 941, stadium key art with room for separately rendered home-screen copy.

The first transparent logo draft was discarded after visual review revealed rough edges. The final logo is the cleaned, opaque version. Logo and icon generations used that draft as an identity reference. The hero was generated without a reference image. Prompts are recorded below verbatim; no CLI/API fallback was used.

## Final logo prompt

```text
Use case: precise-object-edit.
Edit target: supplied TacticMesh horizontal logo.
Primary request: preserve exactly the emblem design, horizontal layout, letter shapes and correct word "TacticMesh", but redraw it as immaculate flat brand artwork. Replace all grunge, grain, edge artifacts and irregular holes with smooth clean solid fills and precision anti-aliased edges. Make the emblem a uniform mint #9cf0c8, the wordmark uniform off-white #f2f5fa, and the entire background solid dark navy #080c14. Preserve the intentional geometric gaps in the emblem and natural letter counters. All filled letter strokes must be uninterrupted. No texture, metal, shading, bevel, scratches, distressing, glow, shadow or extra decoration. Keep small safe margins and wide horizontal proportions. Production-quality clean raster logo, no added text.
```

## Favicon prompt

```text
Use case: logo-brand.
Reference image: supplied TacticMesh logo; preserve its distinct emblem identity.
Asset type: square browser favicon/app icon for TacticMesh.
Primary request: isolate and simplify ONLY the mint football-panel and three-node passing-path emblem from the reference into a bold, immaculate tiny-icon design. No wordmark and no text.
Composition: one centered compact mint emblem, about 78% of the square canvas, generous symmetric safe margins.
Colors: uniform pale mint #9cf0c8 on a completely uniform opaque very dark navy #080c14 square background.
Style: crisp flat geometric raster art, thick solid shapes, clean smooth edges. Preserve the original overall six-sided football silhouette and three joined tactical arms/nodes but make narrow gaps broad enough to survive at 16x16 pixels. Strong small-scale readability.
Constraints: no grain, noise, distress, gradients, bevel, shadow, glow, background imagery, extra border, typography or watermark. Original TacticMesh identity only.
```

## Hero prompt

```text
Use case: stylized-concept.
Asset type: wide cinematic home-screen hero art for TacticMesh, an open-source football simulation with a premium console-style interface.
Primary request: an original atmospheric football stadium scene that turns tactical passing routes into a subtle luminous mesh.
Scene: a meticulously marked association-football pitch in a vast night stadium, low oblique elevated camera angle, floodlights through soft haze, simplified small footballers in original unbranded red and blue kits, coherent positions and one football.
Composition: wide landscape around 16:9. On the right half, a beautiful pitch perspective and players create the focal point. The left 45% is quiet very dark navy negative space for separately rendered UI heading and buttons. Preserve useful focal details within a central safe crop for small screens.
Style: premium stylized 3D game key art, rich restrained lighting, visually clear pitch, mint tactical paths and a few glowing nodes discretely integrated above the grass, no HUD or interface panels.
Color palette: deep navy #080c14 and #111a28, natural dark emerald turf, pale mint #9cf0c8 highlights, warm-white floodlights, small red and blue player accents.
Constraints: absolutely no text, letters, typography, logo, watermark, real-person likeness, branded kits, sponsors or club crests. Association football only. Art should feel like a game one can play, not a dashboard, technical diagram, abstract network or sci-fi combat. Strong but restrained contrast, no busy details behind the left-side UI copy.
```
