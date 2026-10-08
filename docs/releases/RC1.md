# TacticMesh RC1

A free football simulation sandbox by [Wert Qas](https://www.youtube.com/@wertqas9269), shared for the channel's 10-subscriber special. Import teams, explore a matchup, run a cup or build your own project from the MIT source.

## Availability

**RC1 is public.** The browser game, source repository and build video are public. The [RC1 prerelease](https://github.com/noddy703/tacticmesh/releases/tag/v0.1.0-rc1) was published on 7 October 2026 at 23:05:29 GMT−4 (8 October at 03:05:29 UTC), targeting the exact source commit recorded below.

- [Browser game and downloads](https://noddy703.itch.io/tacticmesh)
- [Source repository](https://github.com/noddy703/tacticmesh)
- [RC1 release and downloads](https://github.com/noddy703/tacticmesh/releases/tag/v0.1.0-rc1)
- [Community](https://noddy703.itch.io/tacticmesh/community)
- [Watch the build video](https://youtu.be/vDwGZy7pa1M)

## Play

1. Open the browser game and choose **Run game**. Start with the fictional Redbridge FC and Ashford Athletic teams or import a permitted team pack.
2. Choose lineups, formations and tactics, then watch or fast-simulate a match. Both paths use the same football engine. You can also run a 4-, 8- or 16-team knockout cup.
3. Inspect reports, select a player for their match card, or use Theatre and Fullscreen for a larger view. Exports include results, player CSV, scorecards and backups.

The browser game runs on your device without a TacticMesh account, subscription or paid AI call. Closing the tab stops its simulation. Export a backup before clearing browser storage or moving devices. Reports from incompatible engines remain readable, but their checkpoints cannot continue.

The separate `tacticmesh-offline.html` is the prepared offline edition. Its file bytes were verified; actual offline execution in a named browser has not yet been confirmed for this release. Physical phones and Safari are also unverified.

## Make and share a team pack

1. In **Teams → Import teams → Create with AI**, download the contract kit and copy the prompt.
2. Attach the kit to your own assistant and request a compatible JSON/ZIP. TacticMesh does not call an external AI service itself.
3. **Check pack → review the preview → Import teams**. Check the rosters, warnings, defaults, images and permissions before importing.
4. Export your pack, publish its download on your own itch.io page, then share that normal page link in the discussion board. Importing locally does not publish a pack.

[Pack guide](../PACKS.md) · [Welcome](https://itch.io/t/7078325/start-here-welcome-to-tacticmesh) · [Publishing guide](https://itch.io/t/7078332/share-a-team-pack-publishing-guide-and-template) · [Pack directory](https://itch.io/t/7078334/community-pack-directory-and-useful-links)

Share only data and images you may redistribute. Generated or estimated attributes are simulator inputs, not official ratings. A listing, a tested import and permission to bundle a pack are separate decisions. No community packs have been listed yet.

## Develop

The source uses Node 20.9 or newer:

```sh
npm ci
npm run build
```

The lockfile pins the image-validation dependency. The browser build has no npm runtime dependency. To validate a pack from the source checkout:

```sh
node tools/tacticmesh-cli.mjs validate --pack ./agents/v1/examples/two-team-pack.json
```

Use `npm run product-test` for the Product contracts and `npm run release-check` for the registered release checks. See [contributing](../../CONTRIBUTING.md), [architecture](../ARCHITECTURE.md), [support](../../SUPPORT.md), [license](../../LICENSE) and [third-party notices](../../THIRD_PARTY_NOTICES.md).

Original software is MIT licensed. Pack data, portraits and other content retain their separate rights. Development used AI-assisted coding. Direct-control, career and multiplayer games would require additional development; they are not bundled modes or a stable SDK promise.

## Exact RC1 identity

| Item | Value |
|---|---|
| Frozen source commit | `7e687ed3a52256a74ba28b5fe5a91aaf0f9ece2a` |
| Release tag | [`v0.1.0-rc1`](https://github.com/noddy703/tacticmesh/releases/tag/v0.1.0-rc1), published prerelease |
| Application | `tf-136f19c256623e45` |
| Engine | `engine-4994949ed88c0595` |
| Core | `core-d9aca92dd03969f8` |
| Pack format | `tacticmesh-pack` 1.0.0 |

The source ZIP contains 183 files and matches this frozen commit's prepared source tree. Later documentation commits on `main` do not change the identity of that release or its artifacts.

| Download | Purpose | Bytes | SHA-256 |
|---|---|---:|---|
| `tacticmesh-itch-web.zip` | Hosted playable package | 39,912,856 | `8d8b52c0de1c294a67ecc182cdb713637e428edadb8a40c5110734b53954ee60` |
| `tacticmesh-offline.html` | Prepared offline edition | 1,715,302 | `2c6799b7f2ca115dd8aa8edc5c006cd12674c539ff807fa9cf7e42e936531f6a` |
| `tacticmesh-source.zip` | Exact release source | 23,319,158 | `34202f0a6b1ae5c76c067bc25f9d51bc32869dd69ea4276e861178d24d1585e6` |
| `tacticmesh-agent-kit.zip` | Contracts, prompt and pack validator | 136,821 | `d72355e8ce7481b05d53ef949cf26bdc3abd154b8478b2cd85c5b139177595b8` |
| `tacticmesh-pack-starters.zip` | Fictional starter examples | 693,331 | `3800f8ea4ecb0c4973c22f829ca128c3504e5e205cd6053481ff39b3b4647407` |
| `SHA256SUMS` | Checksums for the five artifacts | 454 | `443d1f638c2442b2a093d6ea9aab99103a7252964632e4180e244d78f55b89af` |

## What was checked

Recorded on 7 October 2026:

- The local release gate passed 61 programs: 52 core and nine Product/build checks. A clean source reconstruction reproduced seven generated HTML pages exactly; its Unicode ZIP regression passed.
- In Chrome on macOS, hosted demo/cup completion and persistence, valid JSON/image imports, invalid rejection, prompt copying, Theatre/player cards, fullscreen entry and fallback, scrolling and a nonzero checkpoint were checked.
- Actual report JSON, CSV, scorecard PNG, contract kit and backup downloads were validated. Separate source/offline/kit/starter downloads matched the prepared files exactly.
- A backup restored successfully in a separate hosted test library; reports, cup, portrait and checkpoint persisted after reload. This was not a replacement of an existing player library.
- Narrow layouts were checked through Chrome emulation. This is not physical-device testing.

These are scoped results. Publication is confirmed; an anonymous play/download verification pass is not claimed by this document. Actual audible sound, offline execution, forced Worker fallback, storage-denial/failure and a drawn knockout fixture's extra-time/penalties remain unverified. Physical mobile/Safari, broad accessibility/stability and 10,000 full-regulation matches are also unperformed.

## Football limitations

**RC1 remains on scoring/chance-volume HOLD.** The selected six-match sample produced 30 goals, 222 shots and 562 minutes. It is an early model to experiment with, not a calibrated predictor of real fixtures. Player performance reports are simulator outputs, not official player ability ratings.

This selected engine does not include the later sterile-possession diagnostic, physical referee/dropped-ball interaction or formation-lab ball placement. Conventional shots on target and saves are unavailable in the current report model. See [known limitations](../KNOWN_LIMITATIONS.md).

Corrections should use a new version with recorded provenance. Published tags and historical artifacts should retain their original identities.
