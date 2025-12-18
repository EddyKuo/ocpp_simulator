# OCPP 1.6 J 充電樁模擬器 (OCPP 1.6 Simulator)

這是一個純前端實作的 OCPP 1.6 J (JSON) 充電樁模擬器，無需後端伺服器即可運行於瀏覽器中。它支援多充電樁管理、完整的充電流程模擬、智慧充電 (Smart Charging)、韌體管理以及即時數據可視化。

## ✨ 主要功能

### 1. 核心充電功能 (Core Profile)
- **多充電樁管理**：可建立、刪除、切換多個模擬充電樁。
- **基本操作**：
  - `BootNotification` (開機通知)
  - `Heartbeat` (心跳包)
  - `StatusNotification` (狀態通知)
  - `Authorize` (RFID 認證)
  - `StartTransaction` / `StopTransaction` (開始/停止交易)
  - `MeterValues` (電表數值回報)
- **主動回報機制**：
  - 支援 `MeterValueSampleInterval` (週期性採樣)
  - 支援 `ClockAlignedDataInterval` (整點對齊採樣)
  - 交易結束時回報完整 `transactionData`。

### 2. 進階功能
- **Smart Charging (智慧充電)**：
  - 模擬 `SetChargingProfile` 功率限制。
  - 支援 `TxDefaultProfile` 與 `TxProfile`優先權邏輯。
  - 根據限制自動計算即時充電功率、電壓與電流。
- **Remote Control (遠端控制)**：
  - `RemoteStart` / `RemoteStop` (遠端啟動/停止)
  - `Reset` (重置)
  - `UnlockConnector` (解鎖槍頭)
  - `ChangeConfiguration` / `GetConfiguration` (配置管理)
- **Firmware Management (韌體管理)**：
  - 模擬韌體更新流程 (`UpdateFirmware`) 與狀態回報。
  - 診斷日誌上傳模擬 (`GetDiagnostics`)。
- **Local Auth List (本地白名單)**：
  - 支援版本管理與白名單更新。
- **Reservation (預約)**：
  - 支援 `ReserveNow` 與 `CancelReservation`。

### 3. 可視化界面
- **即時圖表**：使用 Chart.js 繪製即時充電曲線 (功率/電壓/電流)。
- **詳細儀表板**：顯示即時電量 (Wh)、功率 (kW)、電壓 (V)、電流 (A)。
- **WebSocket 日誌**：即時顯示 TX/RX 訊息，支援篩選與匯出。
- **直覺操作**：視覺化「插槍/拔槍」按鈕與狀態指示燈。

---

## 🚀 使用方法

### 啟動模擬器
由於專案使用 ES Modules，需要透過 HTTP Server 運行 (不能直接打開 HTML 檔案)。

**使用 Python (推薦):**
```bash
python -m http.server 8000
```
然後在瀏覽器開啟 `http://localhost:8000`。

### 操作流程
1. **新增充電樁**：點擊左側「+」，輸入 ID (例如 `CP001`) 與 Server URL。
2. **連線**：點擊「連線」按鈕連接到 OCPP Server。
3. **準備充電**：
   - 選擇連接器 (Connector 1)。
   - 點擊「🔌 插槍」 (狀態變為 Preparing)。
   - 輸入 ID Tag (例如 `TEST001`) 並點擊「刷卡」。
4. **開始充電**：
   - 點擊「開始充電」。
   - 觀察下方圖表與數值變化。
5. **停止充電**：
   - 點擊「停止充電」。
   - 點擊「🔌 拔槍」恢復空閒狀態。

---

## 🏗️ 程式架構

專案採用原生 JavaScript (ES6+) 開發，無須編譯打包工具。

### 目錄結構
```
ocpp_simulator/
├── js/
│   ├── app.js               # 程式進入點，處理 UI 邏輯與 DOM 操作
│   ├── core/
│   │   ├── ChargePoint.js   # 核心類別，實作 OCPP 協議與充電邏輯
│   │   ├── CPManager.js     # 單例模式，管理多個 ChargePoint 實例
│   │   ├── EventBus.js      # 發布/訂閱模式的事件系統
│   │   └── OCPPProtocol.js  # 處理 OCPP 訊息封裝與解析
│   └── utils/
│       ├── constants.js     # 定義 OCPP 狀態、錯誤碼與預設配置
│       └── helpers.js       # 通用工具函數 (時間格式化、UUID 等)
├── css/                     # 樣式檔案 (main, panel, sidebar, log)
├── index.html               # 主頁面
└── README.md                # 專案說明文件
```

### 核心邏輯
- **ChargePoint.js** 是模擬器的核心，負責維護狀態機、處理 WebSocket 通訊、執行 OCPP 指令邏輯。
- **EventBus** 用於解耦 UI 與核心邏輯，當核心狀態改變時 (如收到訊息、狀態變更)，發送事件通知 `app.js` 更新界面。
- **CPManager** 負責將充電樁配置持久化到 `localStorage`，重新整理頁面後資料不會丟失。

---

## 📊 數據模擬細節

模擬器內建物理模擬邏輯：
- **電壓 (Voltage)**：模擬 230V ±10% 的隨機波動。
- **功率 (Power)**：
  - 預設 7kW。
  - 若收到 `SetChargingProfile`，會根據 Profile 限制動態調整。
- **電流 (Current)**：根據 $I = P / V$ 自動計算。
- **電量 (Energy)**：根據時間積分累計，精確計算 Wh。

---

## 🛠️ 開發與除錯

- **瀏覽器 Console**：程式內建詳細的 `console.log`，可追蹤詳細執行流程。
- **Log 面板**：介面右側提供完整的 OCPP 訊息日誌，支援 JSON 高亮顯示，方便查看 Protocol 細節。
