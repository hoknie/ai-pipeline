# Changelog

Every notable change of aip. Sections are written by `scripts/changelog.sh` from the
Conventional Commits between release tags; the release on GitHub carries the section of its tag.
The versions follow [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-11-21

### Features

- **AIP-460:** Show project color dot in queue project filter ([9ce65fa](https://github.com/hoknie/ai-pipeline/commit/9ce65faaa57aa7b6f816a925762334dd797d3f4e))
- **AIP-458:** Add default provider for global and project scope ([ff88588](https://github.com/hoknie/ai-pipeline/commit/ff88588d5aad320f248ad51c06fd72fc0f1b3579))
- **AIP-457:** Move attachments below task body and default editor to md ([045a5d0](https://github.com/hoknie/ai-pipeline/commit/045a5d0589c9435276ce93b3a529ff8f8950bb7f))
- **AIP-455:** Make allowed_users optional and suggest recent senders ([d8faf2b](https://github.com/hoknie/ai-pipeline/commit/d8faf2b5f550cd2b59e055ce45106fe77a3e4f26))
- **AIP-454:** Add integrations catalog with per-kind pages ([3bfefce](https://github.com/hoknie/ai-pipeline/commit/3bfefce0293d6cee20508a19167432fc93adc572))
- **AIP-453:** Add human-readable labels to integrations panel ([ba5e805](https://github.com/hoknie/ai-pipeline/commit/ba5e805c4886bdeec7ad325f43f0dc97e7c23340))
- **AIP-451:** Move integrations to settings with tabs for hooks and services ([1466460](https://github.com/hoknie/ai-pipeline/commit/146646001a3042d1cebc9c48a8da9218baff1644))
- Updated double tasks ([e88af1b](https://github.com/hoknie/ai-pipeline/commit/e88af1bd1ad94f7e7f060b894f50b1543a4aa9fc))
- **AIP-449:** Link aip projects to service registry projects ([9dcc57b](https://github.com/hoknie/ai-pipeline/commit/9dcc57ba9d2c867efb22605494e0cfc3cabcc398))
- **AIP-448:** Add registry skill refs, pinning and skills command ([f1c7112](https://github.com/hoknie/ai-pipeline/commit/f1c7112725ed29c7a0ac06ed602a7d973da48a0f))
- **AIP-431:** Add outgoing webhooks notification channel ([1018cfa](https://github.com/hoknie/ai-pipeline/commit/1018cfa58220c7442c3b2c8e04019a7b592f7758))
- **AIP-447:** Add service-registry connection integration ([3b7f7be](https://github.com/hoknie/ai-pipeline/commit/3b7f7be5a7217ee6bad9378e1adab867dc2ac9bf))
- **AIP-430:** Add slack bot notifications adapter ([b832632](https://github.com/hoknie/ai-pipeline/commit/b8326323e06e537ae1baf642c993c898168f23e7))
- **AIP-445:** Add notifications feature and telegram bot adapter ([cac88ce](https://github.com/hoknie/ai-pipeline/commit/cac88ce5cd830a3d412d620bf94a2632cf0356b3))
- **AIP-443:** Add remote push and branch-mode delivery ([9bebadc](https://github.com/hoknie/ai-pipeline/commit/9bebadc2bce8b8ee6b3f076cc5397c9c4e4b5477))
- **AIP-442:** Add author stats, author filters and panel author display ([f17ffb5](https://github.com/hoknie/ai-pipeline/commit/f17ffb5b39f6bdb351620d439212863682cea8df))
- **AIP-441:** Add ABAC access feature with presets, access.yaml and guards ([82aedfb](https://github.com/hoknie/ai-pipeline/commit/82aedfbe6cdfdb549285b0cb63e9bd2445d46e8d))
- **AIP-440:** Implement authorship and audit log ([c90fd96](https://github.com/hoknie/ai-pipeline/commit/c90fd963137dd88ca62107f8b9a91ca6c52e04b9))
- **AIP-439:** Add saml sso login with replay protection ([701eaea](https://github.com/hoknie/ai-pipeline/commit/701eaea0023d21c00611a6a19c2038c5d10797a0))
- Moved events to ws ([d7b3417](https://github.com/hoknie/ai-pipeline/commit/d7b3417a9f3595b4fff74d4f1f6e0779d05ab472))
- **AIP-438:** Add oidc sso login keyed by iss and sub ([2583ec9](https://github.com/hoknie/ai-pipeline/commit/2583ec9bde95ef9d0160a806abc5075517645f01))
- **AIP-444:** Lay out runtimes settings like swarm providers ([94997cc](https://github.com/hoknie/ai-pipeline/commit/94997cc216cac665521bf337eeeff780aa0f03d3))
- **AIP-437:** Add server mode with user accounts, tokens and remote CLI/MCP over HTTP ([595a555](https://github.com/hoknie/ai-pipeline/commit/595a555ac8fb3cbcb1acb5460a3db5db20ddf959))
- **AIP-406:** Add connection registry, secret storage and inbound event ports ([b26cd3a](https://github.com/hoknie/ai-pipeline/commit/b26cd3af88f6e655fc58a64ed3f0ef3969545c63))
- **AIP-436:** Make skip steps a select in create task form ([d08a85b](https://github.com/hoknie/ai-pipeline/commit/d08a85ba7837b61411a8e6156cf035d68d46c880))
- **AIP-435:** Show all projects' pipelines read-only in panel ([c1d0303](https://github.com/hoknie/ai-pipeline/commit/c1d0303cc824bbb33f23aa55fe412e1f6fa7cd7c))
- **AIP-434:** Make skip steps a multiselect in task form ([6bfd91b](https://github.com/hoknie/ai-pipeline/commit/6bfd91ba807b62d2a6bb645e1533e2f318998bc6))

### Fixes

- **AIP-459:** Show global queue note instead of endless skeleton ([4dd11b2](https://github.com/hoknie/ai-pipeline/commit/4dd11b2f57b6f78835abd9bfcc111b7b6b751959))
- **AIP-456:** Keep action errors visible on integrations page ([55986a5](https://github.com/hoknie/ai-pipeline/commit/55986a5c803b6eb0da735df373e6d5c98c474e16))
- Restore the check gate ([11184f4](https://github.com/hoknie/ai-pipeline/commit/11184f43f694afd3123904ff24dafe158fa67967))
- **AIP-446:** Stack project level label under name in config picker ([2df606b](https://github.com/hoknie/ai-pipeline/commit/2df606b7b03df573900ba197b1ed8e8c0970b24b))
- **cli:** Print the queue of a daemon that sends no author ([b1688b4](https://github.com/hoknie/ai-pipeline/commit/b1688b4a91dcfcf09a1d94db3cdd5a4b77761ae0))
- **AIP-433:** Hide level toggle in all-projects specialist preview ([c4f452e](https://github.com/hoknie/ai-pipeline/commit/c4f452e16611c7dfda23fa11d38f832e4ba0a223))

[Full diff](https://github.com/hoknie/ai-pipeline/compare/v0.4.0...v0.5.0)

## [0.4.0] - 2026-11-17

### Features

- Updated global spec view ([802881d](https://github.com/hoknie/ai-pipeline/commit/802881d5622a8a6c5577214533de5a3d0f9cbfe6))
- **AIP-423:** Allow dismissing returned run notice and keep its own task ([39b349e](https://github.com/hoknie/ai-pipeline/commit/39b349e311294aab629fc100b0911dc1e9377fb0))
- Take the commit message from the author's reply when it sends no report ([5c82913](https://github.com/hoknie/ai-pipeline/commit/5c8291325cede485e1ea4e34323164991dcf6357))
- **AIP-428:** Polish task creation form and properties sidebar ([f032a07](https://github.com/hoknie/ai-pipeline/commit/f032a07bb05b3c9696909b6490cd5324115be0d5))
- **AIP-425:** Remove beta badge from observers menu ([42528c9](https://github.com/hoknie/ai-pipeline/commit/42528c9e5a869c1f16adc21dacc5b04147f3fbd5))
- **AIP-421:** Group specialists and pipelines by project in all-projects view ([1b56a50](https://github.com/hoknie/ai-pipeline/commit/1b56a509ad1c4d70b4e4a7c596d3c0bc562911a0))
- Task num to delivery payload ([7758733](https://github.com/hoknie/ai-pipeline/commit/77587338f717aa5db1988f75b4353a102d099d93))
- Updated providers and make swarm page ([75b522e](https://github.com/hoknie/ai-pipeline/commit/75b522ea777bf57e479265bd5e5ae1cd95b7c333))
- Added providers ([84001e5](https://github.com/hoknie/ai-pipeline/commit/84001e50c17fee164e8fc422f0518a6a09dd36ed))
- Added bulk tags remove method ([141512d](https://github.com/hoknie/ai-pipeline/commit/141512dc639183a7782d217b01e774710ad70730))
- Added more runtimes - codex, kilo, cline, copilot ([2192686](https://github.com/hoknie/ai-pipeline/commit/21926867c5bc64eecb0fd7114bd43a5805fa2c97))
- Added change tier by_provider to task ([d59c65a](https://github.com/hoknie/ai-pipeline/commit/d59c65a5b0ed3512d50647909fda260139332a8d))
- Added tier by_provider to task ([e278851](https://github.com/hoknie/ai-pipeline/commit/e278851033a03ca0b0c7ea00f7f7f84b2c660c88))
- Added tier by_provider ([fa624b9](https://github.com/hoknie/ai-pipeline/commit/fa624b95178fa3a395eb4cfeda439513b57e26c9))
- Normalized tests locales ([6c1fcc1](https://github.com/hoknie/ai-pipeline/commit/6c1fcc14efe3f8857b1d88a6b687e1b5a928fde2))

### Fixes

- Updated broken test ([a149244](https://github.com/hoknie/ai-pipeline/commit/a149244da085651869a262f1f2ce775ab6ade7b2))
- **AIP-424:** Allow editing blocked-by link of returned task ([ccac3b6](https://github.com/hoknie/ai-pipeline/commit/ccac3b6ef2de29b73bc8c70d16e046813192bf1e))
- **AIP-432:** Trim all-projects specialists list and restore config preview ([5347b86](https://github.com/hoknie/ai-pipeline/commit/5347b86c3ca950a31a503999e262913cdb454d3e))
- **AIP-422:** Add back button to providers page ([4131c97](https://github.com/hoknie/ai-pipeline/commit/4131c970e33e0e732dba23f0e89b367ea3d1c8b2))
- **AIP-414:** Match all selected tags in take filter ([faf105f](https://github.com/hoknie/ai-pipeline/commit/faf105f97e7286d4354a28e4df1d0d20939765f5))

### Changes

- **AIP-427:** Tidy provider page and drop duplicate label ([b22d3fb](https://github.com/hoknie/ai-pipeline/commit/b22d3fba076e981fe436f2d262b442c64c9df43f))

### Other

- **build:** Bump version ([1b17a1a](https://github.com/hoknie/ai-pipeline/commit/1b17a1a0747d13e3ac634c5a2b98ea272ba264c6))

[Full diff](https://github.com/hoknie/ai-pipeline/compare/v0.3.1...v0.4.0)

## [0.3.1] - 2026-11-16

### Features

- Updated runtime pool ([37e1ba7](https://github.com/hoknie/ai-pipeline/commit/37e1ba7afd48d4baf272d53f9b64782ccbc1ae12))
- Updated tag prj color in global queue ([e8c9864](https://github.com/hoknie/ai-pipeline/commit/e8c9864de1ced39779ca52d361f437e3816f4bf9))
- Moved hotkeys to ctrl ([67af44a](https://github.com/hoknie/ai-pipeline/commit/67af44a4be89f06b254d5aa3fb0ab260c1019fa7))

### Other

- **build:** Bump version ([7d3fb35](https://github.com/hoknie/ai-pipeline/commit/7d3fb35ee901cb4225cc90cba38ee423c2733387))

[Full diff](https://github.com/hoknie/ai-pipeline/compare/v0.3.0...v0.3.1)

## [0.3.0] - 2026-11-15

### Features

- Updated global queue ([fdd3df6](https://github.com/hoknie/ai-pipeline/commit/fdd3df671a52e8e77390b545f28db457b527a5af))
- Added runtime pools, updated stats ([016a51e](https://github.com/hoknie/ai-pipeline/commit/016a51e9c5495313d2f05da98f92988851431196))
- Added relations for tasks in web ui ([da0272f](https://github.com/hoknie/ai-pipeline/commit/da0272f53106bc725cb54464d9b6680321653a2f))
- Added relations for tasks ([2943cbb](https://github.com/hoknie/ai-pipeline/commit/2943cbb1733762fafde4404fbf551db39be6a76f))
- Updated global queue view ([228b22e](https://github.com/hoknie/ai-pipeline/commit/228b22e9ed6476e09850c71ec12fada669543825))
- Updated form for cross task ([3006928](https://github.com/hoknie/ai-pipeline/commit/30069289b1e5187dba99ae700115ba4a5c5e6e09))
- Removed tokens cost ([7694f75](https://github.com/hoknie/ai-pipeline/commit/7694f7574aff877e2d1bbb20867a22a5553d5277))
- Added names to stats ([ba8ffd8](https://github.com/hoknie/ai-pipeline/commit/ba8ffd8a283876b0d895bc1c123f601b58a72b2a))
- Added global queue and cross project tasks ([5bd612f](https://github.com/hoknie/ai-pipeline/commit/5bd612f6175824f8a99007fcb75e6f9754af9c63))
- Added runtime configuration ([fc4bf7a](https://github.com/hoknie/ai-pipeline/commit/fc4bf7a0ec68e7cf69f632db90a9f8e91f524237))
- Added attaches to task ([7e1df10](https://github.com/hoknie/ai-pipeline/commit/7e1df106342a08c268fb46d5c4a8c839cb9c2cc9))
- Added full size new task page ([a79f9fa](https://github.com/hoknie/ai-pipeline/commit/a79f9fa0a2c90f3c8ec97fe47c55fd7228a053da))
- Added segmentation by models to stats ([6544d37](https://github.com/hoknie/ai-pipeline/commit/6544d37ab59f2b58ea5304b2f9dce713de53a728))
- Added script highlight ([7ea6424](https://github.com/hoknie/ai-pipeline/commit/7ea64246ca103151ee086d17106d816c02d3b901))
- Added pipeline variant ([7b148a1](https://github.com/hoknie/ai-pipeline/commit/7b148a1c47036fd35a5d381735954c41c0ec7d92))

### Fixes

- Updated variant on task change ([96121f6](https://github.com/hoknie/ai-pipeline/commit/96121f6a7afd67b1ed4941aab914cee62fcf1bd0))

### Other

- **build:** Bump version ([2adda18](https://github.com/hoknie/ai-pipeline/commit/2adda18dbc1e37e4f199d6df6854ca3697f51321))

[Full diff](https://github.com/hoknie/ai-pipeline/compare/v0.2.1...v0.3.0)

## [0.2.1] - 2026-11-13

### Features

- Added queue filters for runs ([683ff3b](https://github.com/hoknie/ai-pipeline/commit/683ff3b81e1ff25515d36ac00289bf4d9fae0763))
- Added mcp servers for agents (isolated env) ([8751797](https://github.com/hoknie/ai-pipeline/commit/87517975db54f3781295ac9fb69afecd3370a9d1))
- Removed unnecessary buttons in runs ([1c8c9e4](https://github.com/hoknie/ai-pipeline/commit/1c8c9e43ae2948520f2af60da6249c66e768ac0f))
- Added cancel auto delivery on run ([acc77d8](https://github.com/hoknie/ai-pipeline/commit/acc77d88c4e0185311a862b380d45562355b2f2f))

### Fixes

- Added deny for observer repair failed runs ([e6d524c](https://github.com/hoknie/ai-pipeline/commit/e6d524c4de4faa5c7a729a0b14e6334f911d8d8e))
- Removed bug with sticky block in stats ([c248686](https://github.com/hoknie/ai-pipeline/commit/c248686e6903cf822974a2ef3373d49c9aa67b92))

### Build and CI

- Bump version ([43cc30f](https://github.com/hoknie/ai-pipeline/commit/43cc30fa4dc3c2fd93234e9b11976545ab6b7160))

[Full diff](https://github.com/hoknie/ai-pipeline/compare/v0.2.0...v0.2.1)

## [0.2.0] - 2026-11-12

### Features

- Updated tests ([eec28c3](https://github.com/hoknie/ai-pipeline/commit/eec28c36484f014f5be3468cc21b61bf984ad94c))
- Updated follow button ([462dc6d](https://github.com/hoknie/ai-pipeline/commit/462dc6ddc56a4ae00bcc81173fa79119f794f020))
- Labeled slugs ([3c28553](https://github.com/hoknie/ai-pipeline/commit/3c285530a6a02a842c21a61d9001060852a039e0))
- Added follow button ([7683fca](https://github.com/hoknie/ai-pipeline/commit/7683fca47abde870f7973ca6d37b1e434073fa10))
- Updated query for runs load ([ae89d51](https://github.com/hoknie/ai-pipeline/commit/ae89d512a497d2a39f89b58709a7ca4b10e4d935))
- Added spec name everywhere ([73047f4](https://github.com/hoknie/ai-pipeline/commit/73047f4605c3acc533d80cf73f073e309fbea263))
- Added mcp run show tool ([34c4d48](https://github.com/hoknie/ai-pipeline/commit/34c4d48e428135474e3cebd1d039d5335653d8de))
- Added enable flag for runtimes ([591998d](https://github.com/hoknie/ai-pipeline/commit/591998dac8dd5f8f3fd68266fe0f4083c551f405))
- Added model list load in select ([f4dfd6e](https://github.com/hoknie/ai-pipeline/commit/f4dfd6e5db22d075deecf41094539b6c51269edb))
- Added stage status and deny edit system stage from project ([aae0636](https://github.com/hoknie/ai-pipeline/commit/aae06367c79c9d5440ab69646895644cee42c06f))
- Added stats dashboard (alpha) ([5615162](https://github.com/hoknie/ai-pipeline/commit/561516280ae9def2548b1c2976776cab7cfdf5fc))
- Added stage on run uncompleted status ([a7ce99e](https://github.com/hoknie/ai-pipeline/commit/a7ce99e3a6d1985abc91b5d86a537687b961f1c1))
- Removed prj delete button ([7cc7233](https://github.com/hoknie/ai-pipeline/commit/7cc7233613374bbef458df5320765376ed6042b6))
- Init stats ([1c12997](https://github.com/hoknie/ai-pipeline/commit/1c129973ef628ee98ee9f40b9f4876e63dd07509))
- Moved topology to pipeline ([7a80945](https://github.com/hoknie/ai-pipeline/commit/7a8094569f6cdfbf74dcf764a570fe8b7d7b91eb))
- Updated header menu ([190f78f](https://github.com/hoknie/ai-pipeline/commit/190f78fee5d4881352a907111f7da59ccff20581))
- Updated actions view ([b5c8bc5](https://github.com/hoknie/ai-pipeline/commit/b5c8bc57e57d8bf7615b09b0667139dfded2f8fd))
- Updated pipeline scheme ([4241cbb](https://github.com/hoknie/ai-pipeline/commit/4241cbb58dfe4d942c3f9ad9339d7b246e1dcbe2))
- Added network settings and cmd multi support ([eac433b](https://github.com/hoknie/ai-pipeline/commit/eac433bc22c5160f740a39f82ca45075acf27cb5))
- Updated filters ([5052c23](https://github.com/hoknie/ai-pipeline/commit/5052c2377737f34212462e0ee4b0b05a9707ef0f))
- Disallow human auto answers for direct mode ([6a1616b](https://github.com/hoknie/ai-pipeline/commit/6a1616b6e51f6b6c31ef54d204fc9fa6e70ed4ea))

### Fixes

- Updated status display in queue ([5138400](https://github.com/hoknie/ai-pipeline/commit/513840060d238d06cc9538cf6fda6ecda423143b))
- Removed space between headers in background procs ([310d1d3](https://github.com/hoknie/ai-pipeline/commit/310d1d35d9ac6504a53159d5f5c298d4e0655d8a))
- Updated stats link ([a8cd347](https://github.com/hoknie/ai-pipeline/commit/a8cd347af3bc63669fd7aad1a1d9f2fd46342624))
- Updated chain select in observer ([12196a2](https://github.com/hoknie/ai-pipeline/commit/12196a2cf9ca6f6a0732ca0cc7d92a1ec8227535))

### Other

- Updated changelog and release arch name ([a498b66](https://github.com/hoknie/ai-pipeline/commit/a498b668d7e4d9fc3f46837a8ed9765b7ee3ddd8))

[Full diff](https://github.com/hoknie/ai-pipeline/compare/v0.1.0...v0.2.0)

## [0.1.0] - 2026-11-10

### Features

- History updated ([92f41e2](https://github.com/hoknie/ai-pipeline/commit/92f41e2a9ba3cec651ca0565bc4d05e8392bb04d))
- Added observer history ([25b4b32](https://github.com/hoknie/ai-pipeline/commit/25b4b32485a32d3a092df473e0ff7e213ed3fb00))
- Added project controls ([f936259](https://github.com/hoknie/ai-pipeline/commit/f9362591207ed73ccd1b6237568835a182d30887))
- Updated tokens calc ([1cfbeb9](https://github.com/hoknie/ai-pipeline/commit/1cfbeb9ecd949898c7f695c9be3dfcb4e4167ccb))
- Added runtime chains ([eff441a](https://github.com/hoknie/ai-pipeline/commit/eff441a7a278fa2d1e8555a79a3a7df4c37c3291))
- Added agy runtime ([d5daf44](https://github.com/hoknie/ai-pipeline/commit/d5daf4478fcc15a528a1a7796d89be6f8e818f0d))
- Updated tests ([921cc63](https://github.com/hoknie/ai-pipeline/commit/921cc63f94e47662cfce03ca9d28886b18f4f465))
- Small refactoring (pt 5) ([1723da4](https://github.com/hoknie/ai-pipeline/commit/1723da43fcc2a7e70ea7f491eb8ff3702419c732))
- Small refactoring (pt 4) ([ca743f5](https://github.com/hoknie/ai-pipeline/commit/ca743f57d2f61218eb4795850f2cac0400afca0d))
- Small refactoring (pt 3) ([ceaa081](https://github.com/hoknie/ai-pipeline/commit/ceaa081be2b0dc7ad99975f796ed87846963495f))
- Small refactoring (pt 2) ([3bf4ab1](https://github.com/hoknie/ai-pipeline/commit/3bf4ab1d2f86ec8cd609205ae40b11831110cdab))
- Small refactoring ([604d6ce](https://github.com/hoknie/ai-pipeline/commit/604d6ceee9c64bdfef8925864da299d6df1ef591))
- Updated pipeline and notifications ([f8dc373](https://github.com/hoknie/ai-pipeline/commit/f8dc373529283eccf91b5d40b6d05f1362062321))
- Added observer, actions in pipe, ([6389fc0](https://github.com/hoknie/ai-pipeline/commit/6389fc04ed4f1e6e4fbe8d5fded81f1e33617bc3))
- Updated pipeline import, added tags for pipelines, updated ui for tasks and queue ([97a1e24](https://github.com/hoknie/ai-pipeline/commit/97a1e240a35bc5d152382a76495eabb667124502))
- Updated run filters ([7a049d9](https://github.com/hoknie/ai-pipeline/commit/7a049d9efe09c724139dff77a6117ab126694c8f))
- Added mcp to specialist ([10fe6df](https://github.com/hoknie/ai-pipeline/commit/10fe6dff585fea7ea2d252526f6a27f598147a15))
- Added stop demon only, changed max executor logic, updated tags, added artifacts and other ([59580b7](https://github.com/hoknie/ai-pipeline/commit/59580b74df521002030542cdf62283f1c9ffd8ca))
- Updated delivery mark ([44f5312](https://github.com/hoknie/ai-pipeline/commit/44f5312323e82ee161e49761b94c46d79743137f))
- Show time for msg in journal ([dd4e3b7](https://github.com/hoknie/ai-pipeline/commit/dd4e3b73cf8addd7a76a3080aa219dfe1d4edc67))
- Updated background procs ([95c3c24](https://github.com/hoknie/ai-pipeline/commit/95c3c24184ee37bbe4bb00651f847ea5ff364410))
- Added diff show and spec data ([4081228](https://github.com/hoknie/ai-pipeline/commit/4081228f7c9ea0bd377966185a4ae890ab3eb003))
- Updated tests for ci ([e48c8c2](https://github.com/hoknie/ai-pipeline/commit/e48c8c2aa1ef60f0f19d168dd196895fb2ec842e))
- Updated test and cli ([69f8c6d](https://github.com/hoknie/ai-pipeline/commit/69f8c6df17d9b2092ab5f5aa72900ae79b4200df))
- Updated test ([523c7a0](https://github.com/hoknie/ai-pipeline/commit/523c7a03349df55b08f0d4950b192cde67eefbdc))
- Added attempts for questions ([734f1d6](https://github.com/hoknie/ai-pipeline/commit/734f1d6dadc73e66deee46edb91b7624f71a8060))
- Added parent link for tasks ([62e5717](https://github.com/hoknie/ai-pipeline/commit/62e57170da406d83ed2d32a6fd3ca339dd4b7dab))
- Updated cancel task ([45fae3e](https://github.com/hoknie/ai-pipeline/commit/45fae3ebcfebc463684cb426e1634f1d56fecd01))
- Updated auto-answer and freeze ([957964c](https://github.com/hoknie/ai-pipeline/commit/957964c696010043ae6408b252ca0fb4e6c7281a))
- Added auto-answer ([ca26a35](https://github.com/hoknie/ai-pipeline/commit/ca26a358c8971bfd389740ff1c496ecb24b25ad8))
- Added freeze mode ([2fcf2c1](https://github.com/hoknie/ai-pipeline/commit/2fcf2c14b44ca703ad358e53b100ca13eeef74a6))
- Updated task list ([90c57c5](https://github.com/hoknie/ai-pipeline/commit/90c57c5b733bcc65a1ea571d5f1d961353d10022))
- Added pause and updated settings page ([23a5421](https://github.com/hoknie/ai-pipeline/commit/23a5421170cede03833b48b13093af03594551eb))
- Speed up tests (#1) ([8f04e21](https://github.com/hoknie/ai-pipeline/commit/8f04e211fdacda21e4423f10f4e4fc9231a20169))
- Updated ui ([4126d68](https://github.com/hoknie/ai-pipeline/commit/4126d681a57febd0a2f55e7bc12e4231ef5dd5df))
- Updated settings page, added proc list to footer ([5e8acb5](https://github.com/hoknie/ai-pipeline/commit/5e8acb5e1b54028d857b3cd642774906ba7c7d5e))
- Added retry button for task with fresh state ([621fba7](https://github.com/hoknie/ai-pipeline/commit/621fba7c83356e5bda796b516cd11d6d164176a9))
- Added support for cancel broken task ([de449e5](https://github.com/hoknie/ai-pipeline/commit/de449e5219024611bd485557f4c61ced3466d3bb))
- Redesigned steps skip ([b79761d](https://github.com/hoknie/ai-pipeline/commit/b79761dcd82215fd8b10490306cf382fe148e814))
- Updated task open by id ([282231f](https://github.com/hoknie/ai-pipeline/commit/282231f0bdc02467d0abea79c442d0ffd2005099))
- Added task num, settings page ([2db0e57](https://github.com/hoknie/ai-pipeline/commit/2db0e575cc9e93851c30e5c7965fb0cc3a85df33))
- Updated footer ([e1e792b](https://github.com/hoknie/ai-pipeline/commit/e1e792b56bd21235ddac9a4a2c2e0092ddec8255))
- Updated task create ([ab53efc](https://github.com/hoknie/ai-pipeline/commit/ab53efcfc4d3f70f483cac6844d0a856c92e63c7))
- Added runtime settings ([1058a19](https://github.com/hoknie/ai-pipeline/commit/1058a1916817fe150eebdff2a3ac4453598054d2))
- Task removed from run list if task was requeue ([1941511](https://github.com/hoknie/ai-pipeline/commit/19415112d726809c02e4bd7638979cf99fb55c6a))
- Speed up tests ([26bc1c1](https://github.com/hoknie/ai-pipeline/commit/26bc1c11319feedf86f5e6fd2e9d018bd0870479))
- Removed from run list queue texts ([4b80102](https://github.com/hoknie/ai-pipeline/commit/4b801024cd4dd87438d2d62dc47cfdcb1fdbab6b))
- Added skip stage btn ([a76758a](https://github.com/hoknie/ai-pipeline/commit/a76758a614a9f2cf2aeb3cf5d10dae9bd131922d))
- Added usage info and wait status for stage ([4c744ca](https://github.com/hoknie/ai-pipeline/commit/4c744ca3879cb6867f6bd40f64b711c51e954437))
- Queue task can skip now, ui improved ([9df2d05](https://github.com/hoknie/ai-pipeline/commit/9df2d050c41b60f0c86ec0d2fea2d6293cdf92d6))
- Updated queue settings ([d367170](https://github.com/hoknie/ai-pipeline/commit/d3671703892cae305275075c285264011c1f6e9e))
- Added system stages ([fbddcc6](https://github.com/hoknie/ai-pipeline/commit/fbddcc619445791a6e1e27f517c8f05c6c0967ac))
- Updated queue related task name ([4560a94](https://github.com/hoknie/ai-pipeline/commit/4560a944dff9159f8f4e25c7540c92c1a6f46eaf))
- Updated ui for task type ([fbba0c6](https://github.com/hoknie/ai-pipeline/commit/fbba0c6f33782f40d60c724dc1dd71cd1cd952dd))
- Updated run log for progress msg ([3f9496a](https://github.com/hoknie/ai-pipeline/commit/3f9496ae81f874b469b5fc944a6584496eb3d116))
- Move settings queue to left side and added autopilot and skip stages ([6970ce6](https://github.com/hoknie/ai-pipeline/commit/6970ce6e1c2ec85b8ce344b052188b037f14bc55))
- Ui updated ([5b6ace3](https://github.com/hoknie/ai-pipeline/commit/5b6ace3eefecd955a5cb50e7d5124b63bfb1eef8))
- Added queue relations ([4135f5a](https://github.com/hoknie/ai-pipeline/commit/4135f5a84ca6996addbb3e2d3f62b628233f73aa))
- Added task progress by step ([4840e9d](https://github.com/hoknie/ai-pipeline/commit/4840e9db2dac67d6e8de9a989a6cf7734cc1ecd2))
- Updated queue ([721e278](https://github.com/hoknie/ai-pipeline/commit/721e27879e86a5212a3cdaefb614860cc8f5e8c1))
- Added install and tags ([3383375](https://github.com/hoknie/ai-pipeline/commit/338337559b6a46f71fdc39643b8d7eab9cd344de))

### Fixes

- Updated release wf ([fd29031](https://github.com/hoknie/ai-pipeline/commit/fd2903198fdae9e935cfc1dcbc6096587960acf1))
- Updated release script ([5e2cdfa](https://github.com/hoknie/ai-pipeline/commit/5e2cdfaa87cdbbd74ca79b16c052a0a0ef9dc3aa))
- Updated skip step in ui ([c490e5a](https://github.com/hoknie/ai-pipeline/commit/c490e5a77af813fb0510102f2345e3d17a87d33f))
- Updated test ([2c220f2](https://github.com/hoknie/ai-pipeline/commit/2c220f272ec98c603a0c9ef7a2928d27c468d389))
- Cost now shop up too ([93b6084](https://github.com/hoknie/ai-pipeline/commit/93b60842852048034d6a8269d7ae15a9b454bf2e))
- Updated cancel on limit and added ability to return in queue ([6878f3b](https://github.com/hoknie/ai-pipeline/commit/6878f3b291912d4fa9785f503402a60338c86b29))
- Updated long resovle from endless checks ([0e3cb7f](https://github.com/hoknie/ai-pipeline/commit/0e3cb7f5a96ebf2efb44daf930d2a746380942f8))

### Other

- **ci:** Added gh workflow and changelog ([f08d328](https://github.com/hoknie/ai-pipeline/commit/f08d328f30f7350e43f9697a3019568e4b3f7b55))
- **docs:** Renew docs ([1e4d2b1](https://github.com/hoknie/ai-pipeline/commit/1e4d2b1e6d8225c823a924bc5e677861fd4f1554))
- Init ([260a9b6](https://github.com/hoknie/ai-pipeline/commit/260a9b6b9fb9659b733f94d7357d0f6e84eb206e))
