# A-CSM 資料集倫理聲明（RZV-257）

本聲明適用於 A-CSM 研究專案在 `test-data/` 下使用、轉換、驗證與保存的測試資料。目的在於確保所有資料資產均有明確授權審查、去識別化控制與研究用途邊界。

## 1. 使用原則

- 僅將資料用於 A-CSM 的防禦性研究、品質驗證與基準測試。
- 不把原始資料集視為可自由再散布的素材；是否可商用、可再發佈，完全依各資料集授權條款決定。
- 含真實使用者對話或個資欄位的資料，必須先經 A-CSM `DEID` 流程處理，再進入後續轉換與評測。
- 攻擊、越獄、毒性與安全資料集僅限防禦評估，不得用於擴散繞過技巧。

## 2. 風險分類

### 真實對話與使用者軌跡

- 代表資料：`LMSYS-Chat-1M`、`WildChat`
- 主要風險：可能含真實使用者輸入、時間戳、IP 或其他行為軌跡
- 控制措施：
  - 原始檔保留於本地外接資料庫
  - 轉換前先套用 `DEID`
  - 報告與 trace 中只保留遮罩後內容與摘要欄位

### 安全 / 越獄 / 毒性資料

- 代表資料：`JailbreakBench`、`WildGuardMix`、`Aegis 2.0`、`PolyGuard`
- 主要風險：可能包含攻擊 prompt、仇恨內容、自傷或違規請求
- 控制措施：
  - 僅作為 Event / TAG / Safety 防護驗證
  - 不將原始攻擊文本公開轉貼到非必要文件
  - 在報告中以規則命中與統計摘要為主

### 個資與去識別化資料

- 代表資料：`SPY`、內部 `PII seed corpus`
- 主要風險：雖有合成資料，但仍需避免與真實格式混用而外流
- 控制措施：
  - 僅保留測試必要欄位
  - 驗證 `email / phone / ipv4 / tw_national_id / credit_card / query_secret`
  - 僅輸出替換後結果與 detector 統計

### 授權不明或限制性資料

- 代表資料：`TweetEval`、`MTEB STSBenchmark`、`RefChecker`、`CiteCheck`、`CNIMA`
- 控制措施：
  - 在授權未釐清前，不進入公開釋出材料
  - 若後續任務需正式下載或轉換，必須先依工單規則再確認

## 3. 儲存與存取

- 測試資料統一保存於 `$ACSM_DATA_ROOT`（預設 `./data`）下的子目錄：
  - `<DATA_ROOT>/raw`
  - `<DATA_ROOT>/converted`
  - `<DATA_ROOT>/quality`
  - `<DATA_ROOT>/ground-truth`
  - `<DATA_ROOT>/reports`
- 專案工作樹僅透過 symlink 或環境變數指向外部資料目錄，不在 repo 內複製大型原始資料。
- 所有合規審查結果與後續 QA 報告必須留下 audit trail。

## 4. 法規與治理

- 涉及個資時，以最小化、去識別化與本地處理為原則。
- 研究過程需同時考量 GDPR 與台灣個人資料保護法的基本精神：
  - 資料最小化
  - 用途限定
  - 避免未授權再識別
- 若資料授權為 `NC` 或授權未明，預設不可納入商業或公開釋出流程。

## 5. 參考依據

- A-CSM 去識別化流程文件：`docs/deid-pipeline.md`
- RZV-257 合規審查報告：`<DATA_ROOT>/reports/rzv-257/`
- 各資料集官方來源與授權欄位：詳見 `RZV-257_dataset_license_audit.json` 與 `RZV-257_dataset_license_audit.md`
