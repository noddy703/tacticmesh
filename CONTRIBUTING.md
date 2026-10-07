# Contributing

Use Node 20.9+ and `npm ci`; build with `npm run build`. Validate a local pack with `node tools/tacticmesh-cli.mjs validate --pack ./agents/v1/examples/two-team-pack.json`. Run the checks relevant to your change; use `npm run product-test` for Product contracts and `npm run release-check` before proposing a release.

Keep fixes narrow and explain the reproduced problem, resulting behavior and actual validation. Include the engine/app identity, browser/device and a minimal permitted pack or seed when useful. Discuss substantial engine changes before implementation. Preserve watched/fast engine parity, explicit import preview, immutable historical reports and license notices.

Documentation, reproducible bug reports, accessibility fixes and original fictional packs are welcome. Direct-control, careers and other modes belong to separately scoped development or forks. Do not commit credentials, browser profiles, local user data, personal images, internal agent logs or generated release archives. Share only content you may redistribute.
