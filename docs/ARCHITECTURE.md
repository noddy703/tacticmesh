# Architecture

`src/core.js` and `src/world.js` hold fixed-step state and world lifecycle. `intelligence.js`, `tactics.js`, `physics.js` and `rules.js` implement player choices, positioning, motion/contact and match law. `analysis.js` and `telemetry.js` expose shared analysis and diagnostics.

Product modules handle validated immutable team data, local import/storage, simulation orchestration, cups and reports. `product-ui.js` presents Play/Teams/Results; renderer/camera/audio/UI modules supply the match view. The pack-creation helper supplies local documentation and a prompt, with no AI network call.

`tools/build.cjs` embeds modules/styles into offline HTML and copies static documentation. Watched and accelerated execution share the football engine. App fingerprint includes presentation; engine/core fingerprints identify causal source. Reports keep their original identities. Reuse requires the MIT and separate content licenses; this is not a stable general-purpose SDK commitment.
