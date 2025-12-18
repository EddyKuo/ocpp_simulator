/**
 * OCPP 1.6 Simulator - Application Entry Point
 */
import { CPManager } from './core/CPManager.js';
import { eventBus, Events } from './core/EventBus.js';
import { ConnectionStatus, ChargePointStatus } from './utils/constants.js';
import { formatDisplayTime, formatJSON, safeJSONParse } from './utils/helpers.js';

// ==================== DOM Elements ====================
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Sidebar
const cpList = $('#cp-list');
const btnAddCP = $('#btn-add-cp');
const btnConnectAll = $('#btn-connect-all');
const btnDisconnectAll = $('#btn-disconnect-all');
const statsTotal = $('#stats-total');
const statsConnected = $('#stats-connected');
const statsCharging = $('#stats-charging');

// Main Panel
const cpTitle = $('#cp-title');
const cpStatus = $('#cp-status');
const cpInfoRow = $('#cp-info-row');
const cpUrl = $('#cp-url');
const cpConnectors = $('#cp-connectors');
const controlPanel = $('#control-panel');
const connectorList = $('#connector-list');
const selectConnector = $('#select-connector');
const inputIdTag = $('#input-idtag');
const meterEnergy = $('#meter-energy');
const meterTxId = $('#meter-txid');
const meterPower = $('#meter-power');
const meterVoltage = $('#meter-voltage');
const meterCurrent = $('#meter-current');

// Chart
const chargingChartCanvas = $('#charging-chart');

// Buttons
const btnConnect = $('#btn-connect');
const btnDisconnect = $('#btn-disconnect');
const btnHeartbeat = $('#btn-heartbeat');
const btnBoot = $('#btn-boot');
const btnAuthorize = $('#btn-authorize');
const btnPlug = $('#btn-plug');
const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const btnMeterValues = $('#btn-meter-values');

// Log
const logContent = $('#log-content');
const logFilterDirection = $('#log-filter-direction');
const btnExportLog = $('#btn-export-log');
const btnClearLog = $('#btn-clear-log');

// Modals
const modalAddCP = $('#modal-add-cp');
const formAddCP = $('#form-add-cp');
const btnModalCancel = $('#btn-modal-cancel');
const modalConfirmDelete = $('#modal-confirm-delete');
const deleteCpId = $('#delete-cp-id');
const btnDeleteCancel = $('#btn-delete-cancel');
const btnDeleteConfirm = $('#btn-delete-confirm');

// ==================== State ====================
const cpManager = CPManager.getInstance();
let logEntries = [];
let pendingDeleteId = null;

// Chart state
let chargingChart = null;
const MAX_CHART_POINTS = 30;
const chartData = {
    labels: [],
    power: [],
    voltage: [],
    current: []
};

// ==================== Initialization ====================
function init() {
    setupEventListeners();
    setupEventBusListeners();
    renderCPList();
    updateStats();
    initChargingChart();

    // 如果有已存在的 CP，自動選取第一個
    if (cpManager.chargePoints.size > 0) {
        const firstCP = cpManager.chargePoints.keys().next().value;
        cpManager.selectChargePoint(firstCP);
    }
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Add CP Modal
    btnAddCP.addEventListener('click', () => showModal(modalAddCP));
    btnModalCancel.addEventListener('click', () => hideModal(modalAddCP));
    modalAddCP.querySelector('.modal-overlay').addEventListener('click', () => hideModal(modalAddCP));

    formAddCP.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(formAddCP);
        const cpId = formData.get('cpId').trim();
        const serverUrl = formData.get('serverUrl').trim();
        const connectorCount = parseInt(formData.get('connectorCount')) || 1;

        if (!cpId || !serverUrl) {
            alert('請填寫所有必填欄位');
            return;
        }

        try {
            cpManager.addChargePoint(cpId, serverUrl, { connectorCount });
            hideModal(modalAddCP);
            formAddCP.reset();
            formAddCP.querySelector('[name="serverUrl"]').value = 'ws://localhost:9000/ocpp';
        } catch (error) {
            alert(error.message);
        }
    });

    // Delete Modal
    btnDeleteCancel.addEventListener('click', () => hideModal(modalConfirmDelete));
    modalConfirmDelete.querySelector('.modal-overlay').addEventListener('click', () => hideModal(modalConfirmDelete));
    btnDeleteConfirm.addEventListener('click', () => {
        if (pendingDeleteId) {
            cpManager.removeChargePoint(pendingDeleteId);
            pendingDeleteId = null;
        }
        hideModal(modalConfirmDelete);
    });

    // Sidebar Actions
    btnConnectAll.addEventListener('click', () => cpManager.connectAll());
    btnDisconnectAll.addEventListener('click', () => cpManager.disconnectAll());

    // Clear Storage Button
    const btnClearStorage = $('#btn-clear-storage');
    if (btnClearStorage) {
        btnClearStorage.addEventListener('click', () => {
            if (confirm('確定要清除所有資料嗎？這將刪除所有充電樁配置。')) {
                cpManager.clearStorage();
                location.reload();
            }
        });
    }

    // Main Panel Buttons
    btnConnect.addEventListener('click', () => {
        const cp = cpManager.getSelectedChargePoint();
        if (cp) cp.connect();
    });

    btnDisconnect.addEventListener('click', () => {
        const cp = cpManager.getSelectedChargePoint();
        if (cp) cp.disconnect();
    });

    btnHeartbeat.addEventListener('click', () => {
        const cp = cpManager.getSelectedChargePoint();
        if (cp && cp.isConnected()) cp.sendHeartbeat();
    });

    btnBoot.addEventListener('click', () => {
        const cp = cpManager.getSelectedChargePoint();
        if (cp && cp.isConnected()) cp.sendBootNotification();
    });

    btnAuthorize.addEventListener('click', async () => {
        const cp = cpManager.getSelectedChargePoint();
        const idTag = inputIdTag.value.trim();
        if (cp && cp.isConnected() && idTag) {
            await cp.sendAuthorize(idTag);
        }
    });

    btnPlug.addEventListener('click', () => {
        const cp = cpManager.getSelectedChargePoint();
        const connectorId = parseInt(selectConnector.value);
        if (cp && cp.isConnected()) {
            const connector = cp.connectors.get(connectorId);
            if (!connector) return;

            // 根據當前狀態切換
            switch (connector.status) {
                case ChargePointStatus.AVAILABLE:
                    // 插槍：Available → Preparing
                    cp._setConnectorStatus(connectorId, ChargePointStatus.PREPARING);
                    btnPlug.textContent = '🔌 拔槍';
                    break;

                case ChargePointStatus.PREPARING:
                    // 拔槍（未開始充電）：Preparing → Available
                    cp._setConnectorStatus(connectorId, ChargePointStatus.AVAILABLE);
                    btnPlug.textContent = '🔌 插槍';
                    break;

                case ChargePointStatus.CHARGING:
                case ChargePointStatus.SUSPENDED_EV:
                case ChargePointStatus.SUSPENDED_EVSE:
                    // 充電中不能直接拔槍，需要先停止交易
                    alert('請先停止充電再拔槍');
                    break;

                case ChargePointStatus.FINISHING:
                    // 結束中：Finishing → Available (模擬拔槍)
                    cp._setConnectorStatus(connectorId, ChargePointStatus.AVAILABLE);
                    btnPlug.textContent = '🔌 插槍';
                    break;

                default:
                    // 其他狀態不允許操作
                    break;
            }
        }
    });

    btnStart.addEventListener('click', async () => {
        const cp = cpManager.getSelectedChargePoint();
        const connectorId = parseInt(selectConnector.value);
        const idTag = inputIdTag.value.trim();
        if (cp && cp.isConnected() && idTag) {
            await cp.sendStartTransaction(connectorId, idTag);
        }
    });

    btnStop.addEventListener('click', async () => {
        const cp = cpManager.getSelectedChargePoint();
        const connectorId = parseInt(selectConnector.value);
        if (cp && cp.isConnected()) {
            await cp.sendStopTransaction(connectorId);
        }
    });

    btnMeterValues.addEventListener('click', () => {
        const cp = cpManager.getSelectedChargePoint();
        const connectorId = parseInt(selectConnector.value);
        if (cp && cp.isConnected()) {
            cp.sendMeterValues(connectorId);
        }
    });

    // Log Actions
    logFilterDirection.addEventListener('change', () => renderLog());
    btnClearLog.addEventListener('click', () => {
        logEntries = [];
        renderLog();
    });
    btnExportLog.addEventListener('click', exportLog);
}

// ==================== EventBus Listeners ====================
function setupEventBusListeners() {
    eventBus.on(Events.CP_ADDED, () => {
        renderCPList();
        updateStats();
    });

    eventBus.on(Events.CP_REMOVED, () => {
        renderCPList();
        updateStats();
    });

    eventBus.on(Events.CP_SELECTED, ({ cpId, cp }) => {
        renderCPList();
        updateMainPanel(cp);
    });

    eventBus.on(Events.WS_CONNECTING, ({ cpId }) => {
        updateCPItemStatus(cpId, 'connecting');
        if (cpManager.selectedCPId === cpId) {
            updateConnectionStatus('connecting');
        }
    });

    eventBus.on(Events.WS_CONNECTED, ({ cpId }) => {
        updateCPItemStatus(cpId, 'connected');
        updateStats();
        if (cpManager.selectedCPId === cpId) {
            updateConnectionStatus('connected');
        }
    });

    eventBus.on(Events.WS_DISCONNECTED, ({ cpId }) => {
        updateCPItemStatus(cpId, 'disconnected');
        updateStats();
        if (cpManager.selectedCPId === cpId) {
            updateConnectionStatus('disconnected');
        }
    });

    eventBus.on(Events.CONNECTOR_STATE_CHANGED, ({ cpId, connectorId, status }) => {
        if (cpManager.selectedCPId === cpId) {
            renderConnectors();
            // 同步更新插槍按鈕文字
            updatePlugButtonText(status);
        }
        // 更新 CP 列表中的狀態
        if (status === ChargePointStatus.CHARGING) {
            updateCPItemStatus(cpId, 'charging');
        } else {
            const cp = cpManager.getChargePoint(cpId);
            if (cp && cp.isConnected() && !cp.hasActiveTransaction()) {
                updateCPItemStatus(cpId, 'connected');
            }
        }
        updateStats();
    });

    eventBus.on(Events.TRANSACTION_STARTED, ({ cpId, connectorId, transactionId }) => {
        if (cpManager.selectedCPId === cpId) {
            meterTxId.textContent = transactionId;
            renderConnectors();
            // 清除圖表資料開始新的充電session
            clearChartData();
        }
        updateStats();
    });

    eventBus.on(Events.TRANSACTION_STOPPED, ({ cpId, connectorId, meterStop }) => {
        if (cpManager.selectedCPId === cpId) {
            meterEnergy.textContent = `${meterStop} Wh`;
            meterTxId.textContent = '--';
            renderConnectors();
        }
        updateStats();
    });

    eventBus.on(Events.METER_VALUES_SENT, ({ cpId, connectorId, energy, power, voltage, current }) => {
        if (cpManager.selectedCPId === cpId) {
            // 更新電量顯示
            meterEnergy.textContent = `${energy} Wh`;
            // 更新圖表
            updateChartData(power, voltage, current);
        }
    });

    eventBus.on(Events.LOG_ENTRY, (entry) => {
        addLogEntry(entry);
    });
}

// ==================== UI Renderers ====================
function renderCPList() {
    cpList.innerHTML = '';

    if (cpManager.chargePoints.size === 0) {
        cpList.innerHTML = `
            <div class="cp-list-empty">
                <div class="cp-list-empty-icon">🔌</div>
                <div class="cp-list-empty-text">尚無充電樁<br>點擊 + 新增</div>
            </div>
        `;
        return;
    }

    cpManager.chargePoints.forEach((cp, id) => {
        const li = document.createElement('li');
        li.className = 'cp-item';
        if (cpManager.selectedCPId === id) {
            li.classList.add('selected');
        }

        let statusClass = 'disconnected';
        if (cp.connectionStatus === ConnectionStatus.CONNECTED) {
            statusClass = cp.hasActiveTransaction() ? 'charging' : 'connected';
        } else if (cp.connectionStatus === ConnectionStatus.CONNECTING) {
            statusClass = 'connecting';
        }

        li.innerHTML = `
            <div class="cp-item-status ${statusClass}"></div>
            <div class="cp-item-info">
                <div class="cp-item-id">${id}</div>
                <div class="cp-item-url">${cp.url}</div>
            </div>
            <div class="cp-item-actions">
                <button class="cp-item-btn delete" title="刪除" data-id="${id}">✕</button>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (!e.target.classList.contains('cp-item-btn')) {
                cpManager.selectChargePoint(id);
            }
        });

        li.querySelector('.cp-item-btn.delete').addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteConfirm(id);
        });

        cpList.appendChild(li);
    });
}

function updateCPItemStatus(cpId, status) {
    const item = cpList.querySelector(`[data-id="${cpId}"]`)?.closest('.cp-item');
    if (item) {
        const statusEl = item.querySelector('.cp-item-status');
        statusEl.className = `cp-item-status ${status}`;
    }
}

function updateMainPanel(cp) {
    if (!cp) {
        cpTitle.textContent = '請選擇或新增充電樁';
        cpStatus.className = 'status-badge status-disconnected';
        cpStatus.textContent = '未連線';
        cpInfoRow.style.display = 'none';
        controlPanel.style.display = 'none';
        return;
    }

    cpTitle.textContent = cp.id;
    cpInfoRow.style.display = 'flex';
    cpUrl.textContent = `🌐 ${cp.url}`;
    cpConnectors.textContent = `🔌 ${cp.connectorCount} 連接器`;
    controlPanel.style.display = 'block';

    updateConnectionStatus(cp.connectionStatus);
    updateConnectorSelect(cp);
    renderConnectors();
    updateMeterDisplay(cp);
}

function updateConnectionStatus(status) {
    cpStatus.className = 'status-badge';
    switch (status) {
        case ConnectionStatus.CONNECTED:
        case 'connected':
            cpStatus.classList.add('status-connected');
            cpStatus.textContent = '已連線';
            break;
        case ConnectionStatus.CONNECTING:
        case 'connecting':
            cpStatus.classList.add('status-connecting');
            cpStatus.textContent = '連線中...';
            break;
        default:
            cpStatus.classList.add('status-disconnected');
            cpStatus.textContent = '未連線';
    }
}

function updateConnectorSelect(cp) {
    selectConnector.innerHTML = '';
    for (let i = 1; i <= cp.connectorCount; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Connector ${i}`;
        selectConnector.appendChild(option);
    }
}

function renderConnectors() {
    const cp = cpManager.getSelectedChargePoint();
    if (!cp) return;

    connectorList.innerHTML = '';

    for (let i = 1; i <= cp.connectorCount; i++) {
        const connector = cp.connectors.get(i);
        const status = connector?.status || ChargePointStatus.AVAILABLE;
        const statusLower = status.toLowerCase();

        const card = document.createElement('div');
        card.className = 'connector-card';
        card.innerHTML = `
            <div class="connector-icon">🔌</div>
            <div class="connector-info">
                <div class="connector-id">Connector ${i}</div>
                <div class="connector-status ${statusLower}">${status}</div>
            </div>
        `;

        connectorList.appendChild(card);
    }
}

function updateMeterDisplay(cp) {
    if (!cp) return;

    const connectorId = parseInt(selectConnector.value) || 1;
    const energy = cp.meterValues.get(connectorId) || 0;
    const txId = cp.transactions.get(connectorId);

    meterEnergy.textContent = `${energy} Wh`;
    meterTxId.textContent = txId || '--';
}

function updateStats() {
    const stats = cpManager.getStats();
    statsTotal.textContent = `${stats.total} 總計`;
    statsConnected.textContent = `${stats.connected} 連線`;
    statsCharging.textContent = `${stats.charging} 充電中`;
}

function updatePlugButtonText(status) {
    switch (status) {
        case ChargePointStatus.AVAILABLE:
            btnPlug.textContent = '🔌 插槍';
            break;
        case ChargePointStatus.PREPARING:
        case ChargePointStatus.CHARGING:
        case ChargePointStatus.SUSPENDED_EV:
        case ChargePointStatus.SUSPENDED_EVSE:
        case ChargePointStatus.FINISHING:
            btnPlug.textContent = '🔌 拔槍';
            break;
        default:
            btnPlug.textContent = '🔌 插槍';
    }
}

// ==================== Log ====================
function addLogEntry(entry) {
    logEntries.push(entry);

    // 限制日誌數量
    if (logEntries.length > 1000) {
        logEntries = logEntries.slice(-500);
    }

    renderLog();
}

function renderLog() {
    const filter = logFilterDirection.value;
    const selectedCPId = cpManager.selectedCPId;

    // 過濾日誌
    let filtered = logEntries;

    // 依 CP 過濾 (只顯示當前選中的 CP)
    // if (selectedCPId) {
    //     filtered = filtered.filter(e => e.cpId === selectedCPId);
    // }

    // 依類型過濾
    if (filter !== 'all') {
        filtered = filtered.filter(e => e.level === filter);
    }

    // 只顯示最近 200 條
    filtered = filtered.slice(-200);

    if (filtered.length === 0) {
        logContent.innerHTML = '<div class="log-empty">尚無日誌記錄</div>';
        return;
    }

    logContent.innerHTML = filtered.map(entry => {
        const time = formatDisplayTime(entry.timestamp);
        const isMessage = entry.level === 'tx' || entry.level === 'rx';
        let message = entry.message;

        // 嘗試格式化 JSON
        if (isMessage) {
            const parsed = safeJSONParse(message);
            if (parsed) {
                message = formatJSONWithHighlight(parsed);
            }
        }

        return `
            <div class="log-entry ${isMessage ? 'expandable' : ''}">
                <span class="log-time">${time}</span>
                <span class="log-cp">${entry.cpId}</span>
                <span class="log-type ${entry.level}">${entry.level}</span>
                <span class="log-message">${message}</span>
            </div>
        `;
    }).join('');

    // 滾動到底部
    logContent.scrollTop = logContent.scrollHeight;

    // 點擊展開
    logContent.querySelectorAll('.log-entry.expandable').forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('expanded');
        });
    });
}

function formatJSONWithHighlight(obj) {
    const json = JSON.stringify(obj, null, 2);
    return json
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
        .replace(/: (\d+)/g, ': <span class="json-number">$1</span>')
        .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
        .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

function exportLog() {
    const content = logEntries.map(e => {
        const time = formatDisplayTime(e.timestamp);
        return `[${time}] [${e.cpId}] [${e.level.toUpperCase()}] ${e.message}`;
    }).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocpp-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== Modals ====================
function showModal(modal) {
    modal.classList.remove('hidden');
}

function hideModal(modal) {
    modal.classList.add('hidden');
}

function showDeleteConfirm(cpId) {
    pendingDeleteId = cpId;
    deleteCpId.textContent = cpId;
    showModal(modalConfirmDelete);
}

// ==================== Charging Chart ====================
function initChargingChart() {
    if (!chargingChartCanvas) return;

    const ctx = chargingChartCanvas.getContext('2d');
    chargingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: '功率 (kW)',
                    data: chartData.power,
                    borderColor: '#fbbf24',
                    backgroundColor: 'rgba(251, 191, 36, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: '電壓 (V)',
                    data: chartData.voltage,
                    borderColor: '#60a5fa',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y1'
                },
                {
                    label: '電流 (A)',
                    data: chartData.current,
                    borderColor: '#34d399',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 300
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 6
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'kW / A',
                        color: 'rgba(255, 255, 255, 0.7)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)'
                    },
                    min: 0
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'V',
                        color: 'rgba(255, 255, 255, 0.7)'
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)'
                    },
                    min: 200,
                    max: 260
                }
            }
        }
    });
}

function updateChartData(power, voltage, current) {
    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    // 加入新資料
    chartData.labels.push(timeLabel);
    chartData.power.push(power);
    chartData.voltage.push(voltage);
    chartData.current.push(current);

    // 限制資料點數量
    if (chartData.labels.length > MAX_CHART_POINTS) {
        chartData.labels.shift();
        chartData.power.shift();
        chartData.voltage.shift();
        chartData.current.shift();
    }

    // 更新圖表
    if (chargingChart) {
        chargingChart.update('none');
    }

    // 更新 meter display
    if (meterPower) meterPower.textContent = `${power.toFixed(2)} kW`;
    if (meterVoltage) meterVoltage.textContent = `${voltage.toFixed(1)} V`;
    if (meterCurrent) meterCurrent.textContent = `${current.toFixed(1)} A`;
}

function clearChartData() {
    chartData.labels.length = 0;
    chartData.power.length = 0;
    chartData.voltage.length = 0;
    chartData.current.length = 0;

    if (chargingChart) {
        chargingChart.update('none');
    }

    // 清除 meter display
    if (meterPower) meterPower.textContent = '0 kW';
    if (meterVoltage) meterVoltage.textContent = '0 V';
    if (meterCurrent) meterCurrent.textContent = '0 A';
}

// ==================== Start ====================
document.addEventListener('DOMContentLoaded', init);
