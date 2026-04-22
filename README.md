# TriadMind Core

TriadMind Core 鏄妸鈥滈《鐐逛笁鍏冩硶鈥濊惤鍦颁负宸ョ▼宸ュ叿閾剧殑鏍稿績寮曟搸銆?
瀹冧笉瑕佹眰妯″瀷鐩存帴鍐欎唬鐮侊紝鑰屾槸寮哄埗鍏堝畬鎴愶細

```text
闇€姹?-> Macro-Split锛堟寕杞界偣 + 宸﹀彸鍒嗘敮锛?-> Meso-Split锛堝瓙鍔熻兘 / 绫?/ 鏁版嵁绠￠亾锛?-> Micro-Split锛堝睘鎬?/ 鐘舵€?/ 鏂规硶 / 濂戠害锛?-> draft-protocol.json
-> visualizer.html 瀹℃牳
-> apply 楠ㄦ灦钀藉湴
-> implementation-handoff.md 浜岄樁娈靛疄鐜?```

## Core Principles

- `椤剁偣`锛氫竴涓彲鐢ㄥ姛鑳斤紝鏄乏鍙冲垎鏀殑閫昏緫灏佽
- `宸﹀垎鏀痐锛氬姩鎬佹紨鍖栵紝鍔ㄤ綔銆佹柟娉曘€佹祦绋嬨€佸瓙鍔熻兘鎵ц
- `鍙冲垎鏀痐锛氶潤鎬佺ǔ瀹氾紝灞炴€с€佺姸鎬併€侀厤缃€佸绾︺€佺紪鎺?- `reuse -> modify -> create_child`锛氭案杩滃厛澶嶇敤锛屽啀鏈€灏忎慨鏀癸紝鏈€鍚庢墠瑁傚彉鏂板彾鑺傜偣

## Current Capabilities

- 涓ユ牸鍗忚鏍￠獙锛氬熀浜?`zod` 鏍￠獙 `draft-protocol.json`
- 缃俊搴﹀畧鍗細鏀寔 `protocol.minConfidence` / `protocol.requireConfidence`
- 鍥捐氨寮忓鏍革細`visualizer.html` 宸叉敼涓虹煡璇嗗浘璋遍鏍硷紝绐佸嚭鏂板彾鑺傜偣鍜屾柊澧炶繛绾?- 澧為噺鍚屾锛氬熀浜庢枃浠跺搱甯岀紦瀛橈紝鍙湪婧愮爜鍙樺寲鏃堕噸寤?`triad-map.json`
- 鎸佺画鐩戝惉锛歚watch` 妯″紡鎸佺画鍚屾鎷撴墤
- Always-on 瑙勫垯锛氳嚜鍔ㄥ啓鍏?`.triadmind/agent-rules.md`銆乣AGENTS.md`銆乣.cursor/rules/triadmind.mdc`
- 杩愯鏃惰嚜鎰堣剼鎵嬫灦锛氳繍琛岄敊璇?-> 鑺傜偣鏄犲皠 -> 涓夊厓璇婃柇 -> 淇鍗忚鎻愮ず璇?- 瀹夊叏蹇収锛歚apply` 鍓嶅悗鍙仛鏈湴鍥炴粴淇濇姢
- 閫傞厤鍣ㄦ灦鏋勶細`adapterRegistry + LanguageAdapter + polyglotAdapter` 宸茬ǔ瀹氭帴鍏?`javascript / python / go / rust / cpp / java`
- 缁熶竴 Tree-sitter 璺緞锛歚typescript / javascript / python / go / rust / cpp / java` 鍧囬粯璁よ蛋鍚屼竴濂?Tree-sitter AST 鎶藉彇閾捐矾
- 鍏煎鍥為€€锛歚native` 瑙ｆ瀽鍣ㄤ粎浣滀负鏄惧紡閰嶇疆鐨勫吋瀹硅矾寰勪繚鐣欙紝涓嶅啀浣滀负榛樿宸ヤ笟璺緞
- Ghost State Scanner锛歚typescriptParser.ts` 涓?`treeSitterParser.ts` 浼氭壂鎻?TypeScript / JavaScript / Python / Go / Rust / C++ / Java 鐨勬柟娉曚綋涓庡嚱鏁颁綋锛屾妸鏈€氳繃鍏ュ弬浼犲叆鐨勯殣寮忎緷璧栬拷鍔犲埌 `fission.demand`
- 閫氱敤 Ghost 鍐呮牳锛歚treeSitterGhostScanner.ts` 鎻愪緵璺ㄨ瑷€ Tree-sitter `Node.type / Node.text / Cursor` 鎵弿鏍稿績锛岃В鏋愬櫒鍙礋璐ｆ妸 Ghost 寮曠敤鏄犲皠鎴愯瑷€绾х被鍨?- 鏈湴 import 瑙ｆ瀽鍗囩骇锛歍ree-sitter 璺緞鐜板湪浼氫紭鍏堣В鏋愬伐浣滃尯鍐呭彲钀藉湴鐨勬湰鍦板鍏ワ紝鍐嶆妸瀵煎叆绗﹀彿鏄犲皠鍒扮湡瀹炵被鍨嬶紝鑰屼笉鏄彧闈犲悕绉扮寽娴?- 鍙皟鐢ㄧ被鍨嬫帹鏂崌绾э細瑙ｆ瀽鍣ㄤ細涓洪《灞傚嚱鏁?/ 鏂规硶璁板綍杩斿洖绫诲瀷鍏冧俊鎭紝鐢ㄤ簬鍙橀噺鍒濆鍖栥€佽皟鐢ㄨ〃杈惧紡鍜岃法鏂囦欢缁戝畾鐨勪簩娆℃帹鏂?- Ghost 鏍囩鍒嗙骇锛氫細杈撳嚭 `[Ghost:Read]`銆乣[Ghost:Write]`銆乣[Ghost:ReadWrite]`锛岃鐩?`this.xxx` / `self.xxx` / Go receiver 瀛楁 / C++-Java 绫诲瓧娈点€佸鍏ュ崟渚嬩笌妯″潡绾у閮ㄥ彉閲?- 榛樿璺緞鐢熸晥锛氬嵆浣块」鐩繚鎸?`tree-sitter` 浣滀负榛樿瑙ｆ瀽鍣紝涔熶細鎻愬彇 TypeScript / JavaScript / Python 鐨勯殣寮忕姸鎬佷緷璧?
## Minimal Workflow

鍦ㄧ洰鏍囬」鐩牴鐩綍鎵ц锛?
```bash
npm run triad:init
npm run triad:pipeline -- "浣犵殑闇€姹?
npm run triad:plan
npm run triad:apply
npm run triad:handoff
```

鎺ㄨ崘鎶?`.triadmind/master-prompt.md` 鍙戠粰褰撳墠瀵硅瘽涓殑澶фā鍨嬶紝璁╁畠鍏堝畬鎴愬崗璁鍒掞紝鍐嶈繘鍏ュ疄鐜般€?
## Install As CLI

鍙戝竷鍒?npm 鍚庯紝鐩爣椤圭洰鍙互杩欐牱瀹夎锛?
```bash
npm install -D triadmind-core
```

瀹夎鍚庡彲鐩存帴浣跨敤锛?
```bash
npx triadmind init
npx triadmind invoke -d "@triadmind 浣犵殑闇€姹?
npx triadmind invoke --apply
```

涔熷彲浠ュ湪鐩爣椤圭洰 `package.json` 涓厤缃剼鏈細

```json
{
  "scripts": {
    "triad:init": "triadmind init",
    "triad:invoke": "triadmind invoke",
    "triad:apply": "triadmind invoke --apply",
    "triad:sync": "triadmind sync",
    "triad:self": "triadmind self"
  }
}
```

鏈粨搴撳彂甯冨墠妫€鏌ワ細

```bash
npm run typecheck
npm run build
npm pack --dry-run
```

姝ｅ紡鍙戝竷锛?
```bash
npm login
npm publish --access public
```

## Generated Files

TriadMind 浼氬湪鐩爣椤圭洰鐢熸垚 `.triadmind/` 宸ヤ綔鍖猴細

- `triad.md`锛氶《鐐逛笁鍏冩硶瑙勮寖
- `config.json`锛氭灦鏋勩€佽В鏋愬櫒銆佸崗璁€佽繍琛屾椂鑷剤閰嶇疆
- `triad-map.json`锛氬綋鍓嶉」鐩嫇鎵戝浘
- `draft-protocol.json`锛氬緟瀹℃牳鎷撴墤鍗囩骇鍗忚
- `visualizer.html`锛氱煡璇嗗浘璋卞紡瀹℃牳椤甸潰
- `master-prompt.md`锛氱粺涓€鎬绘彁绀鸿瘝
- `protocol-task.md`锛氬崗璁瓙浠诲姟鎻愮ず璇?- `multi-pass-pipeline.md`锛氬杞帹婕旀彁绀鸿瘝
- `implementation-prompt.md`锛氬疄鐜板墠鎬绘彁绀鸿瘝
- `implementation-handoff.md`锛氶鏋惰惤鍦板悗鐨勫疄鐜版彁绀鸿瘝
- `healing-report.json`锛氳繍琛屾椂閿欒璇婃柇鎶ュ憡
- `healing-prompt.md`锛氳繍琛屾椂鑷剤鎻愮ず璇?- `cache/sync-manifest.json`锛氬閲忓悓姝ョ紦瀛?- `snapshots/`锛氬畨鍏ㄥ揩鐓?
## Commands

鍦?`triadmind-core` 浠撳簱涓細

```bash
npm run init
npm run invoke -- -d "@triadmind 浣犵殑闇€姹?
npm run pipeline -- "浣犵殑闇€姹?
npm run protocol -- "浣犵殑闇€姹?
npm run auto -- "浣犵殑闇€姹?
npm run plan
npm run apply
npm run handoff
npm run sync
npm run watch
npm run rules
npm run self
npm run heal -- --message "TypeError: ..."
npm run adapters
npm run snapshot -- "before-change"
npm run snapshots
npm run rollback -- "<snapshot-id>"
```

## Silent Invoke

濡傛灉浣犲笇鏈?AI 鍔╂墜鍦ㄧ湅鍒?`@triadmind` 鍚庨潤榛樿皟鐢?TriadMind锛屽彲缁熶竴浣跨敤锛?
```bash
npm run invoke -- -d "@triadmind 浣犵殑闇€姹?
```

璇ュ懡浠や細鑷姩锛?
- 鍒锋柊 `.triadmind/triad.md`銆乣master-prompt.md`銆乣implementation-prompt.md`
- 鍐欏叆鏈€鏂伴渶姹傚埌 `.triadmind/latest-demand.txt`
- 鍑嗗 Macro / Meso / Micro / Protocol 鎵€闇€鏂囦欢
- 璁?AI 鍔╂墜鍥寸粫 `.triadmind/implementation-prompt.md` 闈欓粯瀹屾垚鍗忚瑙勫垝

褰?AI 宸插皢瀹屾暣鍗忚钀界洏鍒?`.triadmind/draft-protocol.json` 鍚庯紝鍐嶆墽琛岋細

```bash
npm run invoke -- --apply
```

瀹冧細闈欓粯瀹屾垚锛?
- 鏍￠獙 `draft-protocol.json`
- 鐢熸垚 `.triadmind/visualizer.html`
- 鎵ц `apply`
- 鍒锋柊 `triad-map.json`
- 鐢熸垚 `.triadmind/implementation-handoff.md`

鍦ㄦ帴鍏ラ」鐩腑锛屽懡浠ら€氬父甯?`triad:` 鍓嶇紑锛屼緥濡傦細

```bash
npm run triad:init
npm run triad:sync -- --force
npm run triad:watch
npm run triad:rules
npm run triad:heal -- --message "TypeError: ..."
```

## Protocol Hard Constraints

TriadMind 浼氬湪 `plan` / `apply` 鍓嶆嫤鎴潪娉曞崗璁細

- `actions` 涓嶈兘涓虹┖
- 鍙厑璁?`reuse` / `modify` / `create_child`
- `reuse.nodeId` 蹇呴』宸插瓨鍦?- `modify.nodeId` 蹇呴』宸插瓨鍦?- `modify` 鍙兘鍗囩骇 `demand` / `answer`锛屼笉鑳界鏀硅妭鐐规牳蹇冭亴璐?- `create_child.parentNodeId` 蹇呴』宸插瓨鍦?- `create_child.node.nodeId` 蹇呴』鏄叏鏂拌妭鐐?- 閲嶅鐩爣鑺傜偣鎴栭噸澶嶅姩浣滀細琚嫤鎴?- 濡傚惎鐢ㄧ疆淇″害瀹堝崼锛屼綆浜庨槇鍊肩殑鍔ㄤ綔浼氳鎷掔粷

## Config Example

`.triadmind/config.json`锛?
```json
{
  "schemaVersion": "1.1",
  "architecture": {
    "language": "typescript",
    "parserEngine": "tree-sitter",
    "adapter": "@triadmind/plugin-ts"
  },
  "parser": {
    "excludePatterns": ["node_modules", ".triadmind"],
    "includeUntaggedExports": true,
    "jsDocTags": {
      "triadNode": "TriadNode",
      "leftBranch": "LeftBranch",
      "rightBranch": "RightBranch"
    }
  },
  "protocol": {
    "minConfidence": 0.6,
    "requireConfidence": false
  },
  "runtimeHealing": {
    "enabled": true,
    "maxAutoRetries": 3,
    "requireHumanApprovalForContractChanges": true,
    "snapshotStrategy": "manual"
  }
}
```

## Cross-Language Direction

褰撳墠绋冲畾閫傞厤鍣ㄥ叏閮ㄩ粯璁よ蛋缁熶竴 Tree-sitter AST 璺緞锛?
- `typescript` + `tree-sitter`
- `javascript` + `tree-sitter`
- `python` + `tree-sitter`
- `go` + `tree-sitter`
- `rust` + `tree-sitter`
- `cpp` + `tree-sitter`
- `java` + `tree-sitter`

褰撳墠浠ｇ爜杈圭晫锛?
- `languageAdapter.ts`锛氬畾涔夎法璇█ `LanguageAdapter` 濂戠害
- `adapterRegistry.ts`锛氱淮鎶ら€傞厤鍣ㄦ敞鍐岃〃锛屽苟鎸?`.triadmind/config.json` 鍔ㄦ€佽矾鐢?- `typescriptAdapter.ts`锛氬皝瑁?TypeScript 鐨勬嫇鎵戣В鏋愪笌鍗忚钀藉湴鑳藉姏
- `polyglotAdapter.ts`锛氬皝瑁?JavaScript / Python / Go / Rust / C++ / Java 鐨勬嫇鎵戣В鏋愪笌鍗忚钀藉湴鑳藉姏
- `treeSitterParser.ts`锛氱粺涓€ Tree-sitter AST 鍏ュ彛锛岃礋璐ｅ璇█鍑芥暟銆佺被鏂规硶銆佸弬鏁般€佽繑鍥炲€兼娊鍙栵紝骞朵负 TypeScript / JavaScript / Python / Go / Rust / C++ / Java 琛ュ厖 Ghost State Scanner
- `treeSitterGhostScanner.ts`锛氳瑷€鏃犲叧 Ghost State Scanner锛岀粺涓€鏀堕泦鍙傛暟銆佸眬閮ㄥ彉閲忋€佹爣璇嗙寮曠敤鍜?`this/self` 鐘舵€佽闂?- `typescriptParser.ts`锛歍ypeScript 鍘熺敓 AST 鎷撴墤鎶藉彇瀹炵幇锛屽寘鍚?Ghost State Scanner 闅愬紡渚濊禆鎵弿
- `typescriptGenerator.ts`锛歍ypeScript 楠ㄦ灦浠ｇ爜鐢熸垚瀹炵幇
- `analyzer.ts`锛氱函 JSON 鎷撴墤鍒嗘瀽鍐呮牳锛岃礋璐?blast radius銆乧ycle detection銆乼opological drift 涓?renormalization protocol 鐢熸垚锛屼笉渚濊禆浠讳綍 AST 瑙ｆ瀽鍣?- `parser.ts` / `generator.ts`锛氱函璋冨害鍣紝涓嶅啀鐩存帴缁戝畾 `ts-morph`

### CLI lifecycle guard

- `triadmind plan` now computes contract-graph blast radius warnings before review
- `triadmind apply` now dispatches by detected project language instead of hard-wiring a single generator path
- `triadmind init` / `triadmind apply` now run `detectTopologicalDrift` after topology refresh and fail fast on degraded results
- `triadmind renormalize` now detects strongly connected components and writes `.triadmind/renormalize-protocol.json` for language-agnostic macro-node refactoring
- `visualizer.html` now auto-loads `.triadmind/renormalize-protocol.json` and overlays macro nodes, absorb edges, and renormalization summaries

澶氳瑷€娉涘寲鐨勬€濊矾鏄細

```text
璇█浠ｇ爜 -> Tree-sitter AST -> Triad-IR -> protocol -> adapter -> 楠ㄦ灦
```

褰撳墠宸ョ▼杈圭晫锛?
- 鎵€鏈夋敮鎸佽瑷€鐨?`init / sync / invoke --apply / apply` 鍧囧凡缁熶竴鍒?Tree-sitter 鎷撴墤瑙ｆ瀽璺緞
- `native` 浠呯敤浜庡吋瀹规棫椤圭洰鎴栬皟璇曪紝涓嶅缓璁綔涓烘柊椤圭洰榛樿閰嶇疆
- 浠ｇ爜鐢熸垚浠嶇敱鍚勮瑷€ adapter 璐熻矗锛岃В鏋愪晶宸蹭粠璇█涓撳睘鎵弿鍗囩骇涓虹粺涓€ AST 璇箟鎶藉彇
- TypeScript 鍦?`native` 涓?`tree-sitter` 涓ゆ潯瑙ｆ瀽璺緞涓嬮兘浼氬惎鐢?Ghost State Scanner
- JavaScript 鍦?`tree-sitter` 璺緞涓嬩細鍚敤 Ghost State Scanner锛岃鐩?class method銆乪xport function銆乪xport arrow function锛屽苟澶嶇敤 TypeScript 鐨勮皟鐢ㄨ〃杈惧紡绫诲瀷鎺ㄦ柇
- Python 鍦?`tree-sitter` 璺緞涓嬩細鍚敤 Ghost State Scanner锛岃鐩?class method銆乵odule function銆乣self.xxx`銆佹ā鍧楃骇鐘舵€併€乣import as` / `from ... import ... as ...` 缁戝畾
- Go 鍦?`tree-sitter` 璺緞涓嬩細鍚敤 Ghost State Scanner锛岃鐩?method receiver 瀛楁銆佸寘瀵煎叆鍒悕銆佹ā鍧楃骇 `var/const`銆侀《灞傚嚱鏁颁緷璧栦笌鏈枃浠跺嚱鏁拌繑鍥炵被鍨嬫帹鏂?- Rust 鍦?`tree-sitter` 璺緞涓嬩細鍚敤 Ghost State Scanner锛岃鐩?`self.xxx`銆乣use` 瀵煎叆銆乣static/const`銆乣impl` 鏂规硶涓殑闅愬紡鐘舵€佽闂紝骞朵繚鐣欐湰鍦?crate 璺緞瑙ｆ瀽閽╁瓙
- C++ 鍦?`tree-sitter` 璺緞涓嬩細鍚敤 Ghost State Scanner锛岃鐩?class/struct 瀛楁銆佸叏灞€瀵硅薄銆乮nline method銆侀《灞傚嚱鏁帮紝浠ュ強鏈湴 `#include "..."` 澶存枃浠剁鍙疯В鏋?- Java 鍦?`tree-sitter` 璺緞涓嬩細鍚敤 Ghost State Scanner锛岃鐩?`this.xxx`銆佺被瀛楁銆侀潤鎬佸瓧娈点€佹柟娉曚綋鍐呯殑闅愬紡瀵硅薄渚濊禆锛屼互鍙婂熀浜?`package/import` 鐨勫伐浣滃尯绗﹀彿瑙ｆ瀽
- `tree-sitter` 璺緞涓嬩細瀵?`this.xxx`銆佺浉瀵瑰鍏ョ粦瀹氥€佹ā鍧楃骇澶栭儴鍙橀噺鍋氳娉曠骇绫诲瀷鎺ㄦ柇

## Runtime Self-Healing

杩愯鏃舵姤閿欏悗锛?
```bash
npm run triad:heal -- --message "TypeError: Cannot read properties of undefined"
```

鎴栨妸閿欒鍐欏叆 `.triadmind/runtime-error.log` 鍚庢墽琛岋細

```bash
npm run triad:heal
```

褰撳墠鑷剤閾捐矾锛?
```text
閿欒鏃ュ織
-> Trace-to-Node 鑺傜偣鏄犲皠
-> left/right/contract/topology 褰掑洜
-> analyzer.ts contract graph blast radius 鍒嗘瀽
-> healing-prompt.md
-> LLM 鐢熸垚 repair protocol
-> plan / apply
```

## Always-On Rules

鎵ц锛?
```bash
npm run triad:rules
```

浼氳嚜鍔ㄧ敓鎴愶細

- `.triadmind/agent-rules.md`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

杩欐牱 AI 鍔╂墜鍦ㄥ疄鐜板墠浼氬厛璇诲彇鎷撴墤鍥俱€侀厤缃拰鎬绘彁绀鸿瘝锛岃€屼笉鏄洿鎺ヨ烦杩涗唬鐮併€?
## Self Bootstrap

TriadMind Core 鍙互鐢ㄨ嚜宸辩殑瑙勫垯鎻忚堪鑷繁锛?
```bash
cd triadmind-core
npm run self
```

璇ュ懡浠や細鐢熸垚锛?
- `.triadmind/self-bootstrap.md`
- `.triadmind/self-bootstrap-protocol.json`
- `.triadmind/draft-protocol.json`
- `.triadmind/visualizer.html`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

杩欒〃绀?TriadMind 鑷韩涔熻绾冲叆鍚屼竴濂?`triad-map -> protocol -> visualizer -> rules` 闂幆銆?
## Validation

寮€鍙戞椂鎺ㄨ崘鑷冲皯楠岃瘉锛?
```bash
cd triadmind-core && npm run typecheck
cd ../microflow-ts && npm run triad:sync -- --force
cd ../microflow-ts && npm run triad:rules
```

## Verified Regression

鍦ㄥ畬鎴愯嚜涓鹃噸鏋勫悗锛孴riadMind Core 宸插仛杩囦竴杞姛鑳藉洖褰掗獙璇侊紝纭鈥滆兘鑷妇鈥濅笖鈥滃師鍔熻兘鏈け鏁堚€濄€?
### Core Commands

鍦?`triadmind-core` 鏍圭洰褰曞凡楠岃瘉閫氳繃锛?
```bash
npm run typecheck
npm run adapters
npm run self
npm run sync
npm run rules
npm run heal -- --message "TypeError: Cannot read properties of undefined at runParser (...)"
npm run plan -- --no-open --apply
```

楠岃瘉缁撴灉锛?
- `typecheck` 閫氳繃
- `self` 鍙噸鏂扮敓鎴?`.triadmind/self-bootstrap.md`
- `sync` 鍙閲忓悓姝?`triad-map.json`
- `rules` 鍙噸鏂扮敓鎴?`AGENTS.md` 涓?Cursor 瑙勫垯
- `heal` 鍙敓鎴?`healing-report.json` 涓?`healing-prompt.md`
- `plan --apply` 鍙蛋瀹屾暣瀹℃牳涓庡崗璁墽琛屾祦绋?
### E2E Apply Test

杩樹娇鐢ㄤ竴涓渶灏?TypeScript 涓存椂椤圭洰鍋氫簡鐪熷疄 E2E 楠岃瘉锛?
1. 鍏堣繍琛?`init`
2. 鍐欏叆涓€涓?`create_child` 鍗忚
3. 鎵ц `plan --no-open --apply`
4. 纭鏂伴鏋舵枃浠惰鐢熸垚
5. 鍐嶅啓鍏ヤ竴涓?`modify` 鍗忚
6. 鍐嶆鎵ц `plan --no-open --apply`
7. 纭鍑芥暟绛惧悕琚洿鏂?
瀹為檯楠岃瘉鍒扮殑琛屼负锛?
- `create_child` 鑳芥柊澧?`CsvExporter.exportState`
- `modify` 鑳芥洿鏂板凡瀛樺湪鑺傜偣鐨勫弬鏁扮鍚?- 褰?`modify` 璇曞浘鏀瑰彉鑺傜偣鏍稿績鑱岃矗 `problem` 鏃讹紝浼氳鍗忚瀹堝崼姝ｇ‘鎷︽埅
- TypeScript 鍘熺敓瑙ｆ瀽璺緞鍙瘑鍒?`this.xxx`銆佸鍏ュ崟渚嬨€佹ā鍧楃骇澶栭儴鍙橀噺锛屽苟灏嗗叾杩藉姞鍒?`fission.demand`

杩欒鏄庡綋鍓嶇増鏈湪瀹屾垚 `workflow / bootstrap / protocol / generator / healing` 鐨勫乏鍙冲垎鏀噸鏋勫悗锛屼互涓嬫牳蹇冭兘鍔涗粛鐒跺彲鐢細

- 鎷撴墤鎵弿
- 鍗忚鏍￠獙
- 鍥捐氨瀹℃牳
- 楠ㄦ灦鐢熸垚
- 鍗忚淇敼
- 杩愯鏃惰嚜鎰堟彁绀鸿瘝鐢熸垚

濡傛灉浣犺鍦ㄦ柊鐜閲嶆柊澶嶉獙锛屾帹鑽愭渶灏忛『搴忥細

```bash
npm install
npm run typecheck
npm run self
npm run heal -- --message "TypeError: Cannot read properties of undefined at runParser (...)"
```

## Project Status

TriadMind 姝ｄ粠鈥滄彁绀鸿瘝鎵嬪唽鈥濆崌绾т负鈥滄灦鏋勭紪璇戝櫒鈥濓細

- Prompt 绾︽潫 -> Schema 纭害鏉?- 浜哄伐鍚屾 -> 澧為噺鍚屾 / watch
- 鎵嬪姩鎻愰啋 -> Always-on 瑙勫垯
- TypeScript 鍗曡绉?-> 閫傞厤鍣?+ Tree-sitter 娉涘寲
- 浜嬪悗淇?Bug -> 鎷撴墤鎰熺煡鑷剤

濡傛灉浣犺鐪嬪畬鏁磋惤鍦颁娇鐢ㄦ柟寮忥紝璇疯 `triadmind-core/user guide.md`銆?
