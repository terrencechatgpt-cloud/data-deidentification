# 藥廠文件去識別化工具

[![CI & Deploy](https://github.com/terrencechatgpt-cloud/data-deidentification/actions/workflows/deploy.yml/badge.svg)](https://github.com/terrencechatgpt-cloud/data-deidentification/actions/workflows/deploy.yml)
[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-2f6fed?logo=github)](https://deanlin.net/data-deidentification/)
[![Tests](https://img.shields.io/badge/tests-243%20passing-2e9e5b)](#測試與品質)
![Client-side only](https://img.shields.io/badge/privacy-100%25%20client--side-8e44ad)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

**在瀏覽器裡完成、資料不出電腦的藥廠文件去識別化工具。** 適用於公文、合約、財務數據、供應商資料與臨床研究文件。上傳 PDF / Word / Excel / TXT / Markdown 或直接貼上文字，自動偵測一般個資、財務識別資訊，以及受試者編號、病歷號、試驗編號、研究中心、藥品批號與產品／化合物代碼；以符合原始格式的方式預覽、人工覆核後，下載去識別化文件與 CSV 編碼對照表，日後可憑編碼表完整還原。

🔗 **線上使用：<https://deanlin.net/data-deidentification/>**

<p align="center">
  <img src="docs/screenshots/02-preview.png" alt="去識別化預覽：Word 合約書以頁面方式呈現，敏感資訊以遮罩顯示" width="880">
</p>

---

## 目錄

- [為什麼需要這個工具](#為什麼需要這個工具)
- [功能特色](#功能特色)
- [隱私與安全設計](#隱私與安全設計)
- [快速開始](#快速開始)
- [操作流程](#操作流程)
  - [步驟 1：上傳文件或貼上文字](#步驟-1上傳文件或貼上文字)
  - [步驟 2：檢視自動偵測結果](#步驟-2檢視自動偵測結果)
  - [步驟 3：查看原文與輸出標記](#步驟-3查看原文與輸出標記)
  - [步驟 4：人工調整](#步驟-4人工調整取消誤判整批取消種類新增漏抓)
  - [步驟 5：下載去識別化文件與編碼表](#步驟-5下載去識別化文件與編碼表)
  - [步驟 6：管理偵測規則](#步驟-6管理偵測規則)
  - [步驟 7：用編碼表還原](#步驟-7用編碼表還原)
- [支援格式與限制](#支援格式與限制)
- [偵測規則](#偵測規則)
- [輸出格式：標記與編碼表](#輸出格式標記與編碼表)
- [範例檔下載與體驗](#範例檔下載與體驗)
- [開發](#開發)
- [測試與品質](#測試與品質)
- [專案結構](#專案結構)
- [部署](#部署)
- [授權](#授權)
- [關於作者](#關於作者)

---

## 適用範圍

藥廠內部文件往往同時包含直接個資、可間接識別個人的欄位，以及不宜交給外部服務的業務識別資訊。這個版本把常見情境納入預設規則：

| 文件情境 | 優先檢查的內容 |
|------|------|
| 公文、會議紀錄、簽呈 | 姓名、職稱、聯絡方式、機關／公司、日期、文件編號 |
| 合約、採購、供應商文件 | 簽署人、地址、統編、銀行帳號、發票／單據號碼、合約／採購編號 |
| 財務報表、付款資料 | 銀行／匯款帳號、信用卡號、財務金額（含還款／付款）、發票／單據號碼、公司與人員識別資訊 |
| 臨床試驗、醫療與安全性資料 | 姓名、受試者／個案編號、病歷／就診號、試驗編號、研究中心、日期 |
| 研發、生產與品質文件 | 產品／化合物代碼、藥品批號／批次、供應商、合約與內部編號 |

財務金額、日期、批號、產品代碼與試驗編號可能是分析所需欄位，也可能是機密或準識別資訊；工具會標示它們，但不替使用者決定是否應移除，必須依資料共享目的與公司 SOP 覆核。

## 為什麼需要這個工具

把合約、報價單、客戶清單交給第三方（外包廠商、AI 服務、研究單位）之前，需要先拿掉個資；但一般做法要嘛把檔案上傳到不知名的網站，要嘛用取代功能手動塗改、事後無法還原。這個工具的取捨是：

| 需求 | 做法 |
|------|------|
| 資料不能外流 | 純前端、可離線、可自架靜態網站；沒有任何後端 |
| 要能還原 | 每筆敏感資訊換成唯一編碼，CSV 編碼表是還原憑證 |
| 要保留檔案格式 | Word／Excel 直接改寫文字節點，樣式表格不動；PDF 依原座標重建 |
| 規則不可能完美 | 自動偵測只是建議：預覽、逐筆或整批取消、圈選新增，全部在同一個畫面完成 |

## 功能特色

- **多格式輸入**：`.pdf`（含文字層或掃描影像 OCR）、`.docx`、`.xlsx`、`.txt`、`.md`，或直接貼上文字；一次最多 10 個檔案混合處理。
- **格式感知預覽**：Word 顯示段落／標題／表格／頁首頁尾，Excel 顯示工作表格線，PDF 逐頁依原始座標排版；可切換純文字檢視。
- **可讀的遮罩**：預覽以 `王OO`、`0912-***-678`、`A12******9`、`築夢**股份有限公司` 呈現，滑鼠停留顯示原文與實際輸出標記。
- **人工覆核**：點擊標記確認取消、點擊種類整批取消、圈選文字手動新增、清單定位。
- **藥廠情境規則**：除一般個資外，內建受試者／個案編號、病歷／就診號、試驗／研究編號、研究中心、藥品批號／批次、產品／化合物代碼、合約／採購編號與日期。
- **財務資料規則**：可在欄位語境下偵測銀行／匯款帳號、信用卡號、還款／付款／收入／支出／成本／預算／單價／總額／稅額等財務金額，並偵測台灣格式發票號碼；無財務欄位標籤的一般數字不會直接視為金額，降低誤判。
- **二十一種內建類別**：一般個資、財務識別資訊與藥廠文件識別資訊；規則可停用，自訂規則以 RegExp 新增並即時測試。
- **可還原**：同一類別下完全相同的值共用同一個隨機編碼（手動新增亦同）；上傳去識別化文件＋CSV 即可完整還原，缺漏的編碼會列出警告。
- **打包輸出**：多檔時一鍵打包 ZIP（每個檔案的去識別化檔＋編碼表＋對照清單）。

## 隱私與安全設計

- **所有處理都在瀏覽器內完成**。文件內容、敏感值與編碼表不會經由網路傳送到任何伺服器；一般文字型文件載入頁面後即可離線使用，掃描影像 PDF 的 OCR 首次使用需先下載繁中／英文語言模型。
- 掃描影像 PDF 會先在瀏覽器內以 `tesseract.js` OCR，來源影像不會放入輸出 PDF；若公司內網封鎖語言模型下載來源，需先允許該模型資產或改用已含文字層的 PDF。
- 瀏覽器只會儲存「偵測規則設定」（localStorage）；文件內容與編碼表不落地。
- 編碼是 `crypto.getRandomValues` 產生的 6 位十六進位隨機碼，與原文無數學關聯，無法由編碼反推原始值。
- **輸出檔案內不殘留原始敏感文字**：
  - PDF 採「文字重建」而非白框覆蓋（覆蓋法的底層文字仍可被複製出來）；
  - Excel 會清空不再被任何儲存格引用的共用字串（`sharedStrings.xml`）；
  - Word 直接改寫文字節點，跨 run 拆散的值也會整段取代。
- 尚未下載結果就關閉或重新整理頁面時會提醒。
- **編碼表 (`*.mapping.csv`) 是還原的唯一憑證，本身即為敏感檔案，請妥善保管。**
- **這不是法規或 GxP 合規判定器**：Excel 未帶財務欄位語境的數值、公式結果、註解、隱藏內容，PDF 的附件、部分中繼資料與 OCR 誤認／漏辨內容可能仍含敏感資訊；交付前仍需依公司 SOP 做逐頁、逐工作表檢查。

## 快速開始

**直接使用**：開啟 <https://deanlin.net/data-deidentification/>，拖入檔案即可；沒有檔案的話，頁面下方有「用範例體驗」，一鍵載入 Word／PDF／Excel／TXT 範例（見[範例檔下載與體驗](#範例檔下載與體驗)）。

**本機執行**：

```bash
git clone https://github.com/terrencechatgpt-cloud/data-deidentification.git
cd data-deidentification
npm install
npm run dev        # http://localhost:5173
```

**自行部署**：`npm run build` 產出的 `dist/` 是純靜態站台，放到任何靜態空間（GitHub Pages、S3、Nginx、內網檔案伺服器）即可；也可直接以檔案方式開啟 `dist/index.html`。

## 操作流程

以下截圖由 `npm run screenshots` 自動產生（`docs/screenshots/`），紅框編號對應說明。範例文件皆為虛構資料。

### 步驟 1：上傳文件或貼上文字

![上傳](docs/screenshots/01-upload.png)

1. 三個頁籤：**去識別化**（主要流程）、**偵測規則**（管理規則）、**還原**（用編碼表復原）。
2. 把公文、合約、財務或研究文件拖進虛線區或點擊選擇。支援 `.pdf`（含文字層或掃描影像 OCR）、`.docx`、`.xlsx`、`.txt`、`.md`，單檔 20 MB 以內。
3. 或直接把文字（信件、對話紀錄、報表內容）貼在文字框，
4. 按「開始去識別化」（或 Ctrl/⌘+Enter）。貼上的文字以純文字處理，結果可下載為 `.txt`，也可用「複製去識別化文字」一鍵複製。

可以一次選擇多個檔案（格式可混合，**最多 10 個**）：

![批量處理](docs/screenshots/02a-batch.png)

1. 左側檔案面板列出所有檔案、格式與偵測筆數，
2. 點擊即切換預覽與編輯的檔案（每個檔案各自有獨立的偵測結果與編碼表），
3. 「＋ 加入檔案」可再補檔案（含貼上的文字），× 可移除，
4. 「打包下載全部」把每個檔案的去識別化檔與編碼表連同 `清單.csv`（對照表）打包成一個 ZIP。

### 步驟 2：檢視自動偵測結果

![預覽](docs/screenshots/02-preview.png)

1. **去識別化種類**：每種底色代表一個種類（包括姓名、受試者編號、病歷號、試驗編號、銀行帳號、批號、產品代碼等），後面的數字是偵測到的筆數。**點擊種類可整批取消**該種類的去識別化（顯示刪除線），再點一次復原。
2. **預覽區**：依檔案格式呈現——Word 顯示段落、標題、表格與頁首頁尾（如上圖的 4 頁合約書），敏感資訊以遮罩樣式顯示（`王OO`、`0912-***-678`、`A12******9`、`築夢**股份有限公司`…），一眼看懂被遮的是哪種資訊。
3. **展開偵測清單**：清單預設收合；展開後列出每一筆的類別、原文與遮罩，點擊任一筆會捲動到預覽中的位置並閃爍強調。
4. **重新偵測**（規則變更後重跑，手動新增的項目會保留）／**換一個檔案**／**下載**按鈕都在上方工具列。

Excel 以工作表格線呈現，可切換工作表（下圖 1、2），右上角可切換「純文字檢視」（3）：

![Excel 預覽](docs/screenshots/02b-preview-xlsx.png)

PDF 依原始座標逐頁排版（下圖 1 頁碼、2 頁面），表格與版面與原檔一致：

![PDF 預覽](docs/screenshots/02c-preview-pdf.png)

### 步驟 3：查看原文與輸出標記

![Tooltip](docs/screenshots/03-tooltip.png)

1. 滑鼠移到任何標記上，tooltip 顯示「類別｜原文｜輸出標記」。
2. 勾選「顯示實際輸出標記」可把預覽切換成下載檔案中真正的樣子，例如 `[姓名:a3f9c2]`。

### 步驟 4：人工調整（取消誤判、整批取消種類、新增漏抓）

![點擊標記確認取消](docs/screenshots/04-click-cancel.png)

1. 點擊預覽中任何一個已去識別化的標記，
2. 會跳出確認視窗顯示類別、原文、遮罩與輸出標記；按「取消去識別化」即恢復原文（已取消的項目再點一次可「加回」）。

![整批取消與清單](docs/screenshots/04b-category-list.png)

1. 點擊上方種類（例如「市話」）可整批取消，種類顯示刪除線；再點一次全部復原。
2. 被取消的項目在預覽中恢復原文並以紅色虛線標示。
3. 展開偵測清單可逐筆檢視，
4. 清單中的 **取消／加回** 按鈕同樣可切換單筆。

![圈選新增](docs/screenshots/04c-add.png)

1. 在預覽中用滑鼠圈選任何文字，會跳出浮動視窗：選擇類別後按「新增為去識別化項目」，該段文字即被加入（若與既有項目重疊會提示）。

### 步驟 5：下載去識別化文件與編碼表

![下載](docs/screenshots/05-download.png)

1. 工具列右側的 **下載去識別化文件**（格式與上傳相同，檔名加 `.deid`）與 **下載編碼表 (CSV)**（檔名 `*.mapping.csv`）。兩者都下載前，關閉或重新整理頁面會跳出提醒。
2. 編碼表是還原的唯一憑證；PDF／Excel／Word 的格式限制會顯示在工具列下方。

### 步驟 6：管理偵測規則

![偵測規則](docs/screenshots/06-patterns.png)

1. 規則清單：所有內建與自訂規則的名稱、類別、正規表達式、範例、來源。
2. 勾選框可個別啟用／停用（內建規則不可修改或刪除）。
3. 新增自訂規則：名稱、類別、規則（JavaScript RegExp）、範例；無效的規則會即時顯示錯誤並拒絕儲存。
4. 在「測試文字」貼上樣本即時看到命中結果。設定只存在你的瀏覽器，重新整理後仍保留。
5. 不知道規則怎麼寫？按 **填入範例** 會用預設的「員工編號」規則填滿表單並立即顯示命中結果，改幾個字就能變成自己的規則。
6. 滑鼠停在 **複製 AI 提示詞** 上可預覽提示詞，點一下即複製；貼給 ChatGPT／Claude／Gemini 並補上你要偵測的格式與例子，就能拿到可直接貼回的規則。

### 步驟 7：用編碼表還原

![還原](docs/screenshots/07-restore.png)

1. 上傳去識別化文件與對應的 CSV 編碼表（順序不拘，兩者齊全即自動還原）。
2. 顯示已還原筆數；點「下載還原文件」取得同格式的還原檔（檔名加 `.restored`）。
3. 若文件中有編碼在 CSV 找不到，會列出無法還原的編碼並保留原標記。
4. 還原預覽：被換回的原文以綠色標示。

## 支援格式與限制

| 格式 | 輸入 | 輸出 | 限制 |
|------|------|------|------|
| TXT / Markdown / 貼上文字 | ✅ | 同格式 | — |
| Word | 僅 `.docx` | `.docx`，樣式／表格／頁首頁尾完整保留 | 不支援舊版 `.doc`；文字方塊、註解可能未涵蓋 |
| Excel | 僅 `.xlsx` | `.xlsx`，儲存格樣式與工作表結構保留；被取代的儲存格改為 inline string，公式儲存格維持原樣，未再引用的共用字串會清空 | 帶財務欄位語境的數值型金額也會處理；無標籤數值、公式結果、工作表名稱、註解不在範圍 |
| PDF | 文字層或掃描影像 | `.pdf`，文字依原座標重建，內嵌 Noto Sans TC 子集 | 掃描影像先在瀏覽器內以繁中／英文 OCR；圖片、圖形、原字型不保留，OCR 結果需人工校對 |

其他：單檔上限 20 MB、單次最多 10 個檔案；還原一次處理一份；一般個資規則以台灣格式為主，藥廠編號與財務金額規則以常見英數前綴與欄位語境為主。中文姓名、地址、財務金額、日期、批號與產品代碼無法以規則做到零誤判／零漏抓，請務必在預覽中人工覆核。

## 偵測規則

| 類別 | 內建規則 | 精確度設計 |
|------|----------|------------|
| 姓名 | 常見姓氏（含複姓）＋ 1–2 字名 | 先以後綴語境（先生、表示、於…）判斷，否則退回排除虛詞的雙字比對；停用詞表（高雄、方法…）；「甲方／乙方／雙方」的「方」不視為姓氏 |
| 身分證 | `[A-Z][12]\d{8}` | 檢核碼驗證，錯誤者不命中 |
| 手機 | `09xx-xxx-xxx`、`0912345678`、`+886-9xx…` | 前後不得緊鄰數字 |
| 市話 | `(02)2712-3456`、`02-27123456`、`0227123456`… | 無分隔形式依區碼要求精確位數，8 位數統編不會被誤判為市話 |
| 地址 | 縣市＋鄉鎮市區＋路街段巷弄號樓 | 縣市名為錨點，避免吃到前面的句子 |
| 電子郵件 | 標準格式 | — |
| 公司／組織 | 以「股份有限公司、有限公司、企業社、事務所、診所、基金會…」結尾 | 排除「本／該／貴公司」與前置虛詞 |
| 統一編號 | 8 位數 | 統一編號檢核碼（2023 年新制含舊制例外） |
| 銀行／匯款帳號 | 10–16 位數 | 需在附近文字看到銀行、匯款、收款或帳號等語境，避免把一般數字當帳號 |
| 信用卡號 | 16 位數，可含空白／連字號 | 需在附近文字看到信用卡或卡號等語境 |
| 發票／單據號碼 | 2 個英文字母＋8 位數 | 常見台灣發票字軌格式 |
| 財務金額 | 有財務欄位語境的數字，可含千分位與小數 | 需看到還款、付款、收入、支出、成本、預算、單價、總額、稅額、應收／應付等語境；一般數字不會直接命中 |
| 合約／採購編號 | 常見 `CON-`、`PO-`、`PR-`、`SC-` 等前綴 | 企業自有編碼請再新增自訂規則 |
| 日期／出生日期 | 西元或民國日期 | 會影響時間序列或財務分析，需依用途人工決定 |
| 受試者／個案編號 | `SUBJ-`、`PT-`、`PATIENT-` 等前綴 | 支援英數與分段編號 |
| 病歷／就診號 | 6–12 位數 | 需在附近文字看到病歷號、病歷編號或就診號 |
| 試驗／研究編號 | `NCT`、`PROT-`、`STUDY-`、`TRIAL-` 等格式 | 研究識別資訊 |
| 醫院／研究中心 | 醫院、醫學中心、研究中心、臨床試驗中心 | 以名稱後綴判斷，請覆核機構名稱邊界 |
| 藥品批號／批次 | `LOT-`、`BATCH-` 或批號欄位 | 可能需要保留以追溯批次，請依用途確認 |
| 產品／化合物代碼 | `ABX-`、`CMPD-`、`API-` 等前綴 | 企業自有前綴請用自訂規則補足 |
| 內部／供應商編號 | `STAFF-`、`VENDOR-`、`CUST-`、`FIN-` 等常見前綴 | 也可用「識別碼」類別新增企業自有 RegExp，例如 `EMP-\d{6}`、`MRN-\d{4}-\d{5}` |

命中重疊時較長者優先。所有規則都在「偵測規則」頁籤公開可檢視、可停用。

## 輸出格式：標記與編碼表

- 文件中每筆敏感資訊以 `[類別:編碼]` 取代，例如 `[姓名:a3f9c2]`；編碼為 6 位小寫十六進位。
- **同一類別下完全相同的值共用同一個編碼**：`王小明` 在文件中出現三次，會全部變成同一個 `[姓名:a3f9c2]`，編碼表只列一列。自動偵測與手動新增走同一套規則，圈選新增的文字若與既有項目的類別、內容完全相同，就沿用既有編碼。
- 值有任何差異（大小寫、空白、標點）或類別不同，就是不同編碼；編碼以單一文件為範圍，不同檔案之間不共用。
- 編碼表為 UTF-8（含 BOM）、RFC 4180 的 CSV，Excel 可直接開啟：

  ```csv
  code,category,original
  a3f9c2,姓名,王小明
  7b21e8,受試者編號,SUBJ-TAIWAN-001
  c882d1,藥品批號,LOT-ABX-240901
  ```

- 還原時以 `code` 查表；文件中查無的編碼保留原標記並列出警告。格式契約見 `specs/001-doc-deidentify/contracts/`。

## 範例檔下載與體驗

想先試試看？直接下載下面的範例（全部為程式產生的**虛構資料**，姓名、公司、地址、電話、證號均非真人），或在網頁的「沒有檔案？用範例體驗」區塊按「載入體驗」一鍵送進處理：

| 範例 | 格式 | 內容 | 下載 |
|------|------|------|------|
| 委外服務契約書 | Word | 4 頁契約：立契約書人、十二條條款、附件表格、簽署欄（含頁首頁尾） | [contract.docx](https://deanlin.net/data-deidentification/samples/contract.docx) |
| 委外服務契約書 | PDF | 同一份契約的 PDF 版本 | [contract.pdf](https://deanlin.net/data-deidentification/samples/contract.pdf) |
| 報價單 | Word | 3 頁報價單：客戶資料、20 項明細（跨頁表格）、聯絡窗口、簽回欄 | [quotation.docx](https://deanlin.net/data-deidentification/samples/quotation.docx) |
| 報價單 | PDF | 同一份報價單的 PDF 版本 | [quotation.pdf](https://deanlin.net/data-deidentification/samples/quotation.pdf) |
| 客戶資料 | Excel | 60 筆客戶＋聯絡紀錄 30 筆＋業務窗口，三個工作表 | [customers.xlsx](https://deanlin.net/data-deidentification/samples/customers.xlsx) |
| 客服信件 | TXT | 客服回覆信與引用的原始來信 | [support-email.txt](https://deanlin.net/data-deidentification/samples/support-email.txt) |
| 專案會議紀錄 | Markdown | 出席者、決議表格、待辦清單 | [meeting-notes.md](https://deanlin.net/data-deidentification/samples/meeting-notes.md) |
| 還原體驗 | Word + CSV | 已去識別化的契約書與其編碼表（在「還原」頁籤載入） | [contract.deid.docx](https://deanlin.net/data-deidentification/samples/contract.deid.docx)、[contract.mapping.csv](https://deanlin.net/data-deidentification/samples/contract.mapping.csv) |

更多情境（人工調整、錯誤 CSV、自訂規則、格式邊界）的範例在 `examples/`，說明見 [examples/README.md](examples/README.md)；`npm run examples` 可重新產生全部範例。

## 開發

需求：Node.js 20+（建議 22）。

```bash
npm install
npm run dev          # 開發伺服器 http://localhost:5173
npm test             # Vitest：單元 + round-trip 整合測試
npm run build        # 型別檢查 + 產出 dist/
npm run preview      # 試跑 dist/（http://localhost:4173）
npm run fixtures     # 重新產生 tests/fixtures 的 docx/xlsx/pdf
npm run examples     # 重新產生 examples/
npm run screenshots  # 重新產生 docs/screenshots/（需先 build + preview；使用本機 Chrome）
npm run og           # 重新產生 public/og.png（社群分享圖，使用本機 Chrome）
```

本專案以 [spec-kit](https://github.com/github/spec-kit) 的規格驅動流程開發：`specs/001-doc-deidentify/` 內有規格（spec）、研究決策（research）、實作計畫（plan）、資料模型、契約與任務清單；`.specify/memory/constitution.md` 是專案憲章（純前端零外傳、可還原、人工覆核必經、規則透明）。

## 測試與品質

- **243 個自動化測試**（22 個檔案）：涵蓋一般個資、財務文件與藥廠臨床／品質文件規則的命中／不命中樣本、身分證與統編檢核碼、編碼唯一性、CSV round-trip、偵測重疊裁決與人工增刪、規則設定持久化、遮罩格式、預覽渲染、TXT／DOCX／XLSX／PDF 的「去識別化 → 還原」逐字元 round-trip、真實案例（多頁合約書／報價單、60 筆客戶資料）的偵測完整性（身分證／Email／手機 100%）、批量打包與 Excel 財務數值／公式保留。
- **輸出零殘留**的回歸測試：Excel 共用字串、PDF 原始位元組、Word 各 part 皆確認不含任何原始敏感值。
- 端對端驗證紀錄：`specs/001-doc-deidentify/checklists/e2e-validation.md`。
- CI：每次 push 到 `main` 跑測試與建置，通過後自動部署 GitHub Pages。

## 專案結構

```text
src/
├── core/        偵測規則、偵測引擎、編碼、CSV、遮罩、還原、規則設定
├── formats/     txt/md、docx、xlsx、pdf 解析與產出、TTF 稀疏子集、批量打包
└── ui/          三個頁籤、格式感知預覽、共用元件
tests/           unit / integration / fixtures / helpers
examples/        各情境範例檔（虛構資料）
scripts/         範例產生器（文件模型 → docx/pdf）、截圖腳本
specs/           spec-kit 規格、計畫、任務、契約、驗證紀錄
public/fonts/    Noto Sans TC（PDF 輸出用）
```

技術：TypeScript + Vite（無 UI 框架）、`pdfjs-dist`（PDF 文字擷取與頁面渲染）、`tesseract.js`（瀏覽器內繁中／英文 OCR）、`pdf-lib` + `@pdf-lib/fontkit`（PDF 輸出）、`jszip`（.docx / .xlsx / ZIP）、Vitest；截圖腳本使用 `puppeteer-core` 驅動本機 Chrome。

## 部署

`.github/workflows/deploy.yml`：push 到 `main` → `npm ci` → `npm test` → `npm run build` → 部署 `dist/` 到 GitHub Pages。Vite 設定 `base: './'`，所以在任何子路徑（如 `/data-deidentification/`）或以檔案方式開啟都能運作。

SEO／AEO／GEO：`index.html` 內含 description、canonical、Open Graph／Twitter Card（`public/og.png`）、JSON-LD（`WebSite`、`WebPage`、`WebApplication`、`SoftwareSourceCode`、`FAQPage` 與作者 `Person`），以及一段靜態的「關於／使用方式／支援格式／常見問題」內容：不需要 JavaScript 就能被搜尋引擎與 AI 爬蟲讀到，載入後收進頁尾「常見問題」開啟的彈窗（FAQ 的 JSON-LD 與頁面文字須保持一致）。`public/robots.txt` 與給 LLM 讀的站台摘要 `public/llms.txt` 隨站台部署；`public/sitemap.xml` 的 `__BUILD_DATE__` 佔位由 `vite.config.ts` 在建置時換成當天日期作為 `lastmod`。

## 授權

- 字型 `public/fonts/NotoSansTC-Regular.ttf`：Noto Sans TC，© Google，[SIL Open Font License 1.1](https://openfontlicense.org/)。PDF 輸出時以自製的「稀疏子集」只內嵌用到的字形（`src/formats/ttf-subset.ts`，保留原始 glyph ID）；不使用 pdf-lib 內建 subset，因其對大型 CJK 字型的輸出在 macOS 預覽程式會顯示亂碼。
- 本專案以 [MIT License](LICENSE) 授權。
- 範例文件中的人名、公司、地址、電話、證號皆為程式產生的虛構資料。

## 關於作者

Dean Lin — 歡迎追蹤與交流：

| 平台 | 連結 |
|------|------|
| Medium | <https://medium.com/@dean-lin> |
| Facebook | <https://www.facebook.com/deanlinbao> |
| Threads | <https://www.threads.com/@deanlin5288> |
| YouTube | <https://www.youtube.com/@dlcorner> |
| GitHub | <https://github.com/terrencechatgpt-cloud> |

如果這個工具對你有幫助，歡迎給個 ⭐，或在社群上分享使用心得。
