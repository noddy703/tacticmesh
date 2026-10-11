# RC1 creator-branding update

TacticMesh is created by [Energen Games](https://www.youtube.com/@energengames), previously Wert Qas. The game name and the existing [itch.io](https://noddy703.itch.io/tacticmesh) and [GitHub](https://github.com/noddy703/tacticmesh) URLs remain unchanged.

This follow-up updates the visible game footer, About dialog, scorecard credit, agent manifest, creator guide, README and package metadata. It changes no simulation behavior, schema or browser storage key. Original copyright notices and fictional starter-pack provenance remain intact.

The football engine remains `engine-4994949ed88c0595`, core `core-d9aca92dd03969f8`. The application fingerprint changes because the scorecard credit is embedded in its JavaScript. Existing engine checkpoints remain compatible.

The original [v0.1.0-rc1 release](https://github.com/noddy703/tacticmesh/releases/tag/v0.1.0-rc1) and its files remain available as the rollback build. To revert the public browser build, replace its existing itch.io playable upload with the original RC1 `tacticmesh-itch-web.zip`; do not change the project slug or clear browser storage. The current downloads have their own SHA256SUMS.

The [original limitations](RC1.md) still apply, including unresolved football balance and untested physical phones and Safari. Branding checks do not establish new gameplay acceptance.

## Verification

The branding build is `tf-ceb58e10483599ce`. The 11 October 2026 release check passed all 52 registered test programs and the nine Product/build checks, then prepared all five distributables. The engine and core fingerprints match RC1. Hosted branding verification is recorded separately in the deployment record.
