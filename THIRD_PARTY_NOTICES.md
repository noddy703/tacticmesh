# TacticMesh notices

Original application, engine, documentation, procedural portrait/crest artwork and local tools are distributed under the root MIT licence. Created by Wert Qas: https://www.youtube.com/@wertqas9269. The full MIT notice is embedded in standalone HTML.

The browser runtime has no third-party library, external font or remote image dependency. System fonts, browser APIs and Node built-ins are supplied by the user's environment. The original PRNG, SHA-256 and bounded DEFLATE implementations do not imply affiliation with other software.

The optional source-development and CLI image-decoding dependency is pinned to **Sharp 0.35.5** in package-lock.json. Sharp is Apache-2.0; exact notices are retained under `licenses/`. Its installed native packages include libvips and other libraries with their own licences, including LGPL-3.0-or-later. The source archive does not redistribute native binaries or node_modules; `npm ci` obtains the pinned dependency packages with their included notices. Preserved notices:

- `licenses/sharp-Apache-2.0.txt`
- `licenses/sharp-native-Apache-2.0.txt`
- `licenses/sharp-libvips-bundled-notices.md` (native dependency licence table and source references)
- `licenses/detect-libc-Apache-2.0.txt`
- `licenses/semver-ISC.txt`
- `licenses/img-colour-MIT.md`

Original fictional roster examples declare CC0-1.0 in their pack manifests. Procedural SVG portraits and initials crests are original application output; the portrait-pack fixture rasterizes those original assets. Imported SVG is rejected. Imported content retains its author-supplied licences and attribution; unknown declarations remain unknown. The software MIT licence does not relicense imported data or assets.

Brand bitmap generation, exact prompts and derivative files are documented in `assets/brand/README.md`; generated source artwork is preserved in `assets/brand/originals/`. Creator attribution and branding are distinct from imported-pack provenance. No pre-existing notices were removed.
