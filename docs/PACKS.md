# Team packs

**Create → Validate → Preview → Import.** Start from [the real pack guide](../agents/v1/create-pack.md), [schema](../agents/v1/pack.schema.json), [attributes](../agents/v1/attributes.json), [formations](../agents/v1/formations.json) and [examples](../agents/v1/examples/two-team-pack.json). Format: `tacticmesh-pack`, version `1.0.0`.

For AI assistance, open Teams → Import teams → Create with AI, download the kit, copy the prompt and attach the kit to your own assistant. Request the finished compatible JSON/ZIP rather than a description. Check the returned file in-game, review errors/warnings, defaults, roster and images, then explicitly import. The kit uses local relative files; it is not an itch CDN API or remote simulation service.

For full source-checkout validation: `node tools/tacticmesh-cli.mjs validate --pack ./pack.json`. For the extracted standalone agent kit: `node tools/validate-pack.cjs --pack ./pack.json`. Node 20.9+ is required; install its pinned image decoder with `npm ci` when validating image ZIPs. In-game checking remains the direct path for players.

Packs contain data and permitted PNG/JPEG/WebP images, not scripts/plugins. Declare data provenance and image licenses. Generated/estimated attributes are simulator inputs, not official ratings. Keep sensible image sizes and obey the validator’s actual limits.

To share: export the pack, publish the download on your own itch.io page, then post its normal page link in TacticMesh’s discussion board. Visitors download and import locally. Listing, import testing and permission-cleared bundling are separate decisions; a download link does not grant redistribution permission.

The structural lineup contract requires 11 distinct source player IDs with exactly one goalkeeper in the first slot; remaining slots cannot select a goalkeeper. Choose plausible outfield roles and formation fit as the pack creator. That fit is a creation responsibility, not a claim that the compiler rejects every unsuitable outfield choice.
