/**
 * ChargePoint - 充電樁核心 Class
 * 每個實例代表一個獨立的充電樁
 */
import { eventBus, Events } from './EventBus.js';
import { OCPPProtocol } from './OCPPProtocol.js';
import {
    MessageType,
    ChargePointStatus,
    ConnectionStatus,
    ChargePointErrorCode,
    DefaultConfiguration,
    RegistrationStatus,
    OCPPErrorCode,
    ResetType,
    ConfigurationStatus,
    UnlockStatus,
    AvailabilityType,
    TriggerMessageStatus,
    FirmwareStatus,
    DiagnosticsStatus
} from '../utils/constants.js';
import { formatTimestamp, delay, randomInt, randomFloat } from '../utils/helpers.js';

export class ChargePoint {
    /**
     * @param {string} id - 充電樁 ID
     * @param {string} serverUrl - OCPP Server URL
     * @param {Object} options - 選項
     */
    constructor(id, serverUrl, options = {}) {

        this.id = id;
        this.url = serverUrl;
        this.ws = null;
        this.connectionStatus = ConnectionStatus.DISCONNECTED;

        // 交易資訊 (必須在 _initConnectors 之前初始化)
        this.transactions = new Map(); // connectorId -> transactionId
        this.meterValues = new Map(); // connectorId -> current Wh

        // 連接器狀態 (connectorId 0 = 整個 CP)
        this.connectorCount = options.connectorCount || 1;
        this.connectors = new Map();
        this._initConnectors();

        // 配置
        this.configuration = new Map();
        this._initConfiguration();

        // 充電設定檔
        this.chargingProfiles = [];

        // 本地授權列表
        this.localAuthList = new Map();
        this.localAuthListVersion = 0;

        // 預約
        this.reservations = new Map(); // connectorId -> reservation

        // Pending requests (等待 Server 回應)
        this.pendingRequests = new Map(); // messageId -> {resolve, reject, timeout, action}
        this.requestTimeout = 30000; // 30 秒

        // Heartbeat
        this.heartbeatInterval = null;
        this.heartbeatIntervalMs = 60000;

        // MeterValue - Sampled
        this.meterValueInterval = null;

        // MeterValue - Clock-Aligned
        this.clockAlignedTimeout = null;
        this.clockAlignedInterval = null;

        // 交易追蹤 (用於 transactionData)
        this.transactionStartTime = new Map(); // connectorId -> startTime
        this.transactionMeterData = new Map(); // connectorId -> [{timestamp, sampledValue}]

        // 廠商資訊
        this.vendor = options.vendor || 'OCPP Simulator';
        this.model = options.model || 'Virtual CP';
        this.serialNumber = options.serialNumber || `SN-${id}`;
        this.firmwareVersion = options.firmwareVersion || '1.0.0';

        // 韌體與診斷狀態
        this.firmwareStatus = FirmwareStatus.IDLE;
        this.diagnosticsStatus = DiagnosticsStatus.IDLE;

        // 綁定方法
        this._onOpen = this._onOpen.bind(this);
        this._onClose = this._onClose.bind(this);
        this._onError = this._onError.bind(this);
        this._onMessage = this._onMessage.bind(this);
    }

    // ==================== 初始化 ====================

    _initConnectors() {
        // connectorId 0 = 整個 CP
        this.connectors.set(0, {
            status: ChargePointStatus.AVAILABLE,
            errorCode: ChargePointErrorCode.NO_ERROR
        });

        // 實際連接器
        for (let i = 1; i <= this.connectorCount; i++) {
            this.connectors.set(i, {
                status: ChargePointStatus.AVAILABLE,
                errorCode: ChargePointErrorCode.NO_ERROR
            });
            this.meterValues.set(i, 0);
        }
    }

    _initConfiguration() {
        Object.values(DefaultConfiguration).forEach(config => {
            if (config && config.key) {
                this.configuration.set(config.key, {
                    key: config.key,
                    value: config.value,
                    readonly: config.readonly
                });
            }
        });
        // 更新連接器數量
        this.configuration.set('NumberOfConnectors', {
            key: 'NumberOfConnectors',
            value: String(this.connectorCount),
            readonly: true
        });
    }

    // ==================== WebSocket 連線 ====================

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this._log('warn', 'Already connected');
            return;
        }

        this.connectionStatus = ConnectionStatus.CONNECTING;
        eventBus.emit(Events.WS_CONNECTING, { cpId: this.id });

        try {
            // OCPP 1.6 WebSocket URL 格式: ws://server/ocpp/CPID
            const wsUrl = this.url.endsWith('/')
                ? `${this.url}${this.id}`
                : `${this.url}/${this.id}`;

            this._log('info', `Connecting to ${wsUrl}`);
            this.ws = new WebSocket(wsUrl, 'ocpp1.6');

            this.ws.onopen = this._onOpen;
            this.ws.onclose = this._onClose;
            this.ws.onerror = this._onError;
            this.ws.onmessage = this._onMessage;
        } catch (error) {
            this._log('error', `Connection failed: ${error.message}`);
            this.connectionStatus = ConnectionStatus.DISCONNECTED;
            eventBus.emit(Events.WS_ERROR, { cpId: this.id, error });
        }
    }

    disconnect() {
        this._stopHeartbeat();
        this._stopMeterValueSampling();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        eventBus.emit(Events.WS_DISCONNECTED, { cpId: this.id });
        this._log('info', 'Disconnected');
    }

    _onOpen() {
        this.connectionStatus = ConnectionStatus.CONNECTED;
        this._log('info', 'WebSocket connected');
        eventBus.emit(Events.WS_CONNECTED, { cpId: this.id });

        // 連線後自動發送 BootNotification
        this.sendBootNotification();
    }

    _onClose(event) {
        this._stopHeartbeat();
        this._stopMeterValueSampling();
        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        this._log('info', `WebSocket closed: ${event.code} ${event.reason}`);
        eventBus.emit(Events.WS_DISCONNECTED, { cpId: this.id, code: event.code, reason: event.reason });

        // 清理 pending requests
        this.pendingRequests.forEach((req, msgId) => {
            clearTimeout(req.timeout);
            req.reject(new Error('Connection closed'));
        });
        this.pendingRequests.clear();
    }

    _onError(error) {
        this._log('error', `WebSocket error: ${error.message || 'Unknown error'}`);
        eventBus.emit(Events.WS_ERROR, { cpId: this.id, error });
    }

    _onMessage(event) {
        const rawMessage = event.data;
        this._log('rx', rawMessage);

        const parsed = OCPPProtocol.parseMessage(rawMessage);
        if (!parsed) {
            this._log('error', 'Failed to parse message');
            return;
        }

        switch (parsed.type) {
            case MessageType.CALL:
                this._handleCall(parsed.messageId, parsed.action, parsed.payload);
                break;
            case MessageType.CALL_RESULT:
                this._handleCallResult(parsed.messageId, parsed.payload);
                break;
            case MessageType.CALL_ERROR:
                this._handleCallError(parsed.messageId, parsed.errorCode, parsed.errorDescription, parsed.errorDetails);
                break;
        }
    }

    // ==================== 訊息發送 ====================

    _send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }
        this.ws.send(message);
        this._log('tx', message);
    }

    /**
     * 發送 CALL 請求並等待回應
     * @param {string} action 
     * @param {Object} payload 
     * @returns {Promise<Object>}
     */
    async _sendRequest(action, payload = {}) {
        const { message, messageId } = OCPPProtocol.createCall(action, payload);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new Error(`Request timeout: ${action}`));
            }, this.requestTimeout);

            this.pendingRequests.set(messageId, {
                resolve,
                reject,
                timeout,
                action
            });

            try {
                this._send(message);
            } catch (error) {
                clearTimeout(timeout);
                this.pendingRequests.delete(messageId);
                reject(error);
            }
        });
    }

    /**
     * 發送 CALLRESULT 回應
     * @param {string} messageId 
     * @param {Object} payload 
     */
    _sendResponse(messageId, payload = {}) {
        const message = OCPPProtocol.createCallResult(messageId, payload);
        this._send(message);
    }

    /**
     * 發送 CALLERROR 回應
     * @param {string} messageId 
     * @param {string} errorCode 
     * @param {string} errorDescription 
     */
    _sendError(messageId, errorCode, errorDescription = '') {
        const message = OCPPProtocol.createCallError(messageId, errorCode, errorDescription);
        this._send(message);
    }

    // ==================== 訊息處理 ====================

    _handleCallResult(messageId, payload) {
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(messageId);
            pending.resolve(payload);
        } else {
            this._log('warn', `Unexpected CallResult for messageId: ${messageId}`);
        }
    }

    _handleCallError(messageId, errorCode, errorDescription, errorDetails) {
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(messageId);
            pending.reject(new Error(`${errorCode}: ${errorDescription}`));
        } else {
            this._log('warn', `Unexpected CallError for messageId: ${messageId}`);
        }
    }

    _handleCall(messageId, action, payload) {
        this._log('info', `Received ${action}`);

        // 根據 action 路由到對應的 handler
        const handlerName = `handle${action}`;
        if (typeof this[handlerName] === 'function') {
            try {
                this[handlerName](payload, messageId);
            } catch (error) {
                this._log('error', `Error handling ${action}: ${error.message}`);
                this._sendError(messageId, OCPPErrorCode.INTERNAL_ERROR, error.message);
            }
        } else {
            this._log('warn', `No handler for action: ${action}`);
            this._sendError(messageId, OCPPErrorCode.NOT_IMPLEMENTED, `Action ${action} not implemented`);
        }
    }

    // ==================== CP -> Server 訊息 ====================

    async sendBootNotification() {
        try {
            const payload = {
                chargePointVendor: this.vendor,
                chargePointModel: this.model,
                chargePointSerialNumber: this.serialNumber,
                firmwareVersion: this.firmwareVersion,
                meterType: 'Virtual Meter',
                meterSerialNumber: `MTR-${this.id}`
            };

            const response = await this._sendRequest('BootNotification', payload);

            if (response.status === RegistrationStatus.ACCEPTED) {
                this._log('info', 'BootNotification accepted');

                // 設定 heartbeat interval（OCPP spec 要求必須為正整數）
                if (response.interval > 0) {
                    this.heartbeatIntervalMs = response.interval * 1000;
                    this.configuration.set('HeartbeatInterval', {
                        key: 'HeartbeatInterval',
                        value: String(response.interval),
                        readonly: false
                    });
                }

                this._startHeartbeat();

                // 發送所有連接器的初始狀態
                for (let i = 0; i <= this.connectorCount; i++) {
                    await this.sendStatusNotification(i);
                }
            } else {
                this._log('warn', `BootNotification ${response.status}`);
            }

            return response;
        } catch (error) {
            this._log('error', `BootNotification failed: ${error.message}`);
            throw error;
        }
    }

    async sendHeartbeat() {
        try {
            const response = await this._sendRequest('Heartbeat', {});
            this._log('info', `Heartbeat response: ${response.currentTime}`);
            return response;
        } catch (error) {
            this._log('error', `Heartbeat failed: ${error.message}`);
            throw error;
        }
    }

    async sendStatusNotification(connectorId, status = null, errorCode = null) {
        const connector = this.connectors.get(connectorId);
        if (!connector) return;

        const payload = {
            connectorId,
            errorCode: errorCode || connector.errorCode,
            status: status || connector.status,
            timestamp: formatTimestamp()
        };

        try {
            await this._sendRequest('StatusNotification', payload);
            this._log('info', `StatusNotification sent for connector ${connectorId}: ${payload.status}`);
        } catch (error) {
            this._log('error', `StatusNotification failed: ${error.message}`);
        }
    }

    async sendAuthorize(idTag) {
        try {
            const response = await this._sendRequest('Authorize', { idTag });
            this._log('info', `Authorize response: ${response.idTagInfo?.status}`);
            return response;
        } catch (error) {
            this._log('error', `Authorize failed: ${error.message}`);
            throw error;
        }
    }

    async sendStartTransaction(connectorId, idTag, reservationId = null) {
        const meterStart = this.meterValues.get(connectorId) || 0;

        const payload = {
            connectorId,
            idTag,
            meterStart,
            timestamp: formatTimestamp()
        };

        if (reservationId !== null) {
            payload.reservationId = reservationId;
        }

        try {
            const response = await this._sendRequest('StartTransaction', payload);

            if (response.idTagInfo?.status === 'Accepted') {
                this.transactions.set(connectorId, response.transactionId);
                this._setConnectorStatus(connectorId, ChargePointStatus.CHARGING);

                // 記錄交易開始時間並初始化 meterData
                this.transactionStartTime.set(connectorId, new Date());
                this.transactionMeterData.set(connectorId, []);

                // 啟動 Sampled MeterValues
                this._startMeterValueSampling(connectorId);

                // 啟動 Clock-Aligned MeterValues
                this._startClockAlignedSampling(connectorId);

                eventBus.emit(Events.TRANSACTION_STARTED, {
                    cpId: this.id,
                    connectorId,
                    transactionId: response.transactionId
                });

                this._log('info', `Transaction started: ${response.transactionId}`);
            }

            return response;
        } catch (error) {
            this._log('error', `StartTransaction failed: ${error.message}`);
            throw error;
        }
    }

    async sendStopTransaction(connectorId, reason = 'Local', idTag = null) {
        const transactionId = this.transactions.get(connectorId);
        if (!transactionId) {
            this._log('warn', `No active transaction for connector ${connectorId}`);
            return null;
        }

        const meterStop = this.meterValues.get(connectorId) || 0;

        const payload = {
            meterStop,
            timestamp: formatTimestamp(),
            transactionId,
            reason
        };

        if (idTag) {
            payload.idTag = idTag;
        }

        // 加入 transactionData (交易期間的所有 MeterValues)
        const meterData = this.transactionMeterData.get(connectorId);
        if (meterData && meterData.length > 0) {
            payload.transactionData = meterData;
            this._log('info', `Including ${meterData.length} meter samples in transactionData`);
        }

        try {
            const response = await this._sendRequest('StopTransaction', payload);

            // 清理交易追蹤資料
            this.transactions.delete(connectorId);
            this.transactionStartTime.delete(connectorId);
            this.transactionMeterData.delete(connectorId);

            // 停止 MeterValue 採樣
            this._stopMeterValueSampling();
            this._stopClockAlignedSampling();

            this._setConnectorStatus(connectorId, ChargePointStatus.FINISHING);

            // 短暫延遲後變回 Available
            setTimeout(() => {
                this._setConnectorStatus(connectorId, ChargePointStatus.AVAILABLE);
            }, 2000);

            eventBus.emit(Events.TRANSACTION_STOPPED, {
                cpId: this.id,
                connectorId,
                transactionId,
                meterStop
            });

            this._log('info', `Transaction stopped: ${transactionId}`);
            return response;
        } catch (error) {
            this._log('error', `StopTransaction failed: ${error.message}`);
            throw error;
        }
    }

    async sendMeterValues(connectorId, transactionId = null, powerLimitKw = null, context = 'Sample.Periodic') {
        const currentWh = this.meterValues.get(connectorId) || 0;
        const txId = transactionId || this.transactions.get(connectorId);

        // 使用傳入的功率限制，或預設 7 kW
        const powerKw = powerLimitKw || this._getActiveChargingLimit(connectorId);
        // 計算對應的電流 (假設 230V)
        const voltage = randomFloat(228, 232, 1);
        const current = (powerKw * 1000) / voltage;

        const timestamp = formatTimestamp();

        const sampledValue = [
            {
                value: String(currentWh),
                measurand: 'Energy.Active.Import.Register',
                unit: 'Wh',
                context
            },
            {
                value: String(randomFloat(powerKw * 0.95, powerKw * 1.05, 2)),
                measurand: 'Power.Active.Import',
                unit: 'kW',
                context
            },
            {
                value: String(voltage),
                measurand: 'Voltage',
                unit: 'V',
                context
            },
            {
                value: String(randomFloat(current * 0.95, current * 1.05, 1)),
                measurand: 'Current.Import',
                unit: 'A',
                context
            }
        ];

        const meterValue = { timestamp, sampledValue };

        const payload = {
            connectorId,
            meterValue: [meterValue]
        };

        if (txId) {
            payload.transactionId = txId;

            // 記錄到 transactionData 供 StopTransaction 使用
            const meterData = this.transactionMeterData.get(connectorId);
            if (meterData) {
                meterData.push(meterValue);
            }
        }

        // 立即發送事件給 UI 更新圖表 (不等待 server 回應)
        eventBus.emit(Events.METER_VALUES_SENT, {
            cpId: this.id,
            connectorId,
            energy: currentWh,
            power: powerKw,
            voltage,
            current
        });

        try {
            await this._sendRequest('MeterValues', payload);
            this._log('info', `MeterValues sent [${context}]: ${currentWh} Wh, ${powerKw.toFixed(1)} kW`);
        } catch (error) {
            this._log('error', `MeterValues failed: ${error.message}`);
        }
    }

    async sendDataTransfer(vendorId, messageId = null, data = null) {
        const payload = { vendorId };
        if (messageId) payload.messageId = messageId;
        if (data) payload.data = typeof data === 'string' ? data : JSON.stringify(data);

        try {
            const response = await this._sendRequest('DataTransfer', payload);
            return response;
        } catch (error) {
            this._log('error', `DataTransfer failed: ${error.message}`);
            throw error;
        }
    }

    async sendFirmwareStatusNotification(status) {
        this.firmwareStatus = status;
        try {
            await this._sendRequest('FirmwareStatusNotification', { status });
            this._log('info', `FirmwareStatusNotification: ${status}`);
        } catch (error) {
            this._log('error', `FirmwareStatusNotification failed: ${error.message}`);
        }
    }

    async sendDiagnosticsStatusNotification(status) {
        this.diagnosticsStatus = status;
        try {
            await this._sendRequest('DiagnosticsStatusNotification', { status });
            this._log('info', `DiagnosticsStatusNotification: ${status}`);
        } catch (error) {
            this._log('error', `DiagnosticsStatusNotification failed: ${error.message}`);
        }
    }

    // ==================== Server -> CP Handlers ====================

    handleReset(payload, messageId) {
        const { type } = payload;
        this._sendResponse(messageId, { status: 'Accepted' });
        this._log('info', `Reset ${type} accepted`);

        setTimeout(async () => {
            if (type === ResetType.HARD) {
                // Hard reset: 斷線後重連
                this.disconnect();
                await delay(2000);
                this.connect();
            } else {
                // Soft reset: 重新發 BootNotification
                await this.sendBootNotification();
            }
        }, 1000);
    }

    handleRemoteStartTransaction(payload, messageId) {
        const { idTag, connectorId, chargingProfile } = payload;
        const targetConnector = connectorId || 1;

        const connector = this.connectors.get(targetConnector);
        if (!connector || connector.status !== ChargePointStatus.AVAILABLE) {
            this._sendResponse(messageId, { status: 'Rejected' });
            return;
        }

        this._sendResponse(messageId, { status: 'Accepted' });

        // 如果有 chargingProfile，儲存它
        if (chargingProfile) {
            this.chargingProfiles.push(chargingProfile);
        }

        // 執行啟動流程
        this._setConnectorStatus(targetConnector, ChargePointStatus.PREPARING);
        setTimeout(() => {
            this.sendStartTransaction(targetConnector, idTag);
        }, 1000);
    }

    handleRemoteStopTransaction(payload, messageId) {
        const { transactionId } = payload;

        // 找到對應的連接器
        let targetConnector = null;
        for (const [connId, txId] of this.transactions.entries()) {
            if (txId === transactionId) {
                targetConnector = connId;
                break;
            }
        }

        if (!targetConnector) {
            this._sendResponse(messageId, { status: 'Rejected' });
            return;
        }

        this._sendResponse(messageId, { status: 'Accepted' });
        this.sendStopTransaction(targetConnector, 'Remote');
    }

    handleUnlockConnector(payload, messageId) {
        const { connectorId } = payload;

        if (!this.connectors.has(connectorId)) {
            this._sendResponse(messageId, { status: UnlockStatus.NOT_SUPPORTED });
            return;
        }

        // 模擬解鎖成功
        this._sendResponse(messageId, { status: UnlockStatus.UNLOCKED });
        this._log('info', `Connector ${connectorId} unlocked`);
    }

    handleGetConfiguration(payload, messageId) {
        const { key } = payload;
        const configurationKey = [];
        const unknownKey = [];

        if (key && key.length > 0) {
            key.forEach(k => {
                const config = this.configuration.get(k);
                if (config) {
                    configurationKey.push(config);
                } else {
                    unknownKey.push(k);
                }
            });
        } else {
            // 返回全部
            this.configuration.forEach(config => {
                configurationKey.push(config);
            });
        }

        this._sendResponse(messageId, { configurationKey, unknownKey });
    }

    handleChangeConfiguration(payload, messageId) {
        const { key, value } = payload;
        const config = this.configuration.get(key);

        if (!config) {
            this._sendResponse(messageId, { status: ConfigurationStatus.NOT_SUPPORTED });
            return;
        }

        if (config.readonly) {
            this._sendResponse(messageId, { status: ConfigurationStatus.REJECTED });
            return;
        }

        config.value = value;
        this.configuration.set(key, config);

        // 特殊處理：HeartbeatInterval
        if (key === 'HeartbeatInterval') {
            this.heartbeatIntervalMs = parseInt(value) * 1000;
            this._startHeartbeat(); // 重啟
        }

        this._sendResponse(messageId, { status: ConfigurationStatus.ACCEPTED });
        this._log('info', `Configuration changed: ${key} = ${value}`);
    }

    handleChangeAvailability(payload, messageId) {
        const { connectorId, type } = payload;

        if (connectorId !== 0 && !this.connectors.has(connectorId)) {
            this._sendResponse(messageId, { status: 'Rejected' });
            return;
        }

        const newStatus = type === AvailabilityType.OPERATIVE
            ? ChargePointStatus.AVAILABLE
            : ChargePointStatus.UNAVAILABLE;

        if (connectorId === 0) {
            // 變更所有連接器
            for (let i = 1; i <= this.connectorCount; i++) {
                this._setConnectorStatus(i, newStatus);
            }
        } else {
            this._setConnectorStatus(connectorId, newStatus);
        }

        this._sendResponse(messageId, { status: 'Accepted' });
    }

    handleTriggerMessage(payload, messageId) {
        const { requestedMessage, connectorId } = payload;

        switch (requestedMessage) {
            case 'BootNotification':
                this._sendResponse(messageId, { status: TriggerMessageStatus.ACCEPTED });
                this.sendBootNotification();
                break;
            case 'Heartbeat':
                this._sendResponse(messageId, { status: TriggerMessageStatus.ACCEPTED });
                this.sendHeartbeat();
                break;
            case 'StatusNotification':
                this._sendResponse(messageId, { status: TriggerMessageStatus.ACCEPTED });
                this.sendStatusNotification(connectorId || 1);
                break;
            case 'MeterValues':
                this._sendResponse(messageId, { status: TriggerMessageStatus.ACCEPTED });
                this.sendMeterValues(connectorId || 1);
                break;
            case 'FirmwareStatusNotification':
                this._sendResponse(messageId, { status: TriggerMessageStatus.ACCEPTED });
                this.sendFirmwareStatusNotification(this.firmwareStatus);
                break;
            case 'DiagnosticsStatusNotification':
                this._sendResponse(messageId, { status: TriggerMessageStatus.ACCEPTED });
                this.sendDiagnosticsStatusNotification(this.diagnosticsStatus);
                break;
            default:
                this._sendResponse(messageId, { status: TriggerMessageStatus.NOT_IMPLEMENTED });
        }
    }

    handleClearCache(payload, messageId) {
        this.localAuthList.clear();
        this._sendResponse(messageId, { status: 'Accepted' });
        this._log('info', 'Cache cleared');
    }

    handleDataTransfer(payload, messageId) {
        const { vendorId, messageId: msgId, data } = payload;
        this._log('info', `DataTransfer received from ${vendorId}`);
        this._sendResponse(messageId, { status: 'Accepted' });
    }

    // ==================== Smart Charging Handlers ====================

    handleSetChargingProfile(payload, messageId) {
        const { connectorId, csChargingProfiles } = payload;

        if (connectorId !== 0 && !this.connectors.has(connectorId)) {
            this._sendResponse(messageId, { status: 'Rejected' });
            return;
        }

        // 儲存 charging profile
        const existingIndex = this.chargingProfiles.findIndex(
            p => p.chargingProfileId === csChargingProfiles.chargingProfileId
        );

        if (existingIndex >= 0) {
            this.chargingProfiles[existingIndex] = {
                ...csChargingProfiles,
                connectorId
            };
        } else {
            this.chargingProfiles.push({
                ...csChargingProfiles,
                connectorId
            });
        }

        this._sendResponse(messageId, { status: 'Accepted' });
        this._log('info', `ChargingProfile ${csChargingProfiles.chargingProfileId} set for connector ${connectorId}`);
    }

    handleClearChargingProfile(payload, messageId) {
        const { id, connectorId, chargingProfilePurpose, stackLevel } = payload;
        let cleared = false;

        this.chargingProfiles = this.chargingProfiles.filter(profile => {
            let shouldRemove = true;

            if (id !== undefined && profile.chargingProfileId !== id) {
                shouldRemove = false;
            }
            if (connectorId !== undefined && profile.connectorId !== connectorId) {
                shouldRemove = false;
            }
            if (chargingProfilePurpose && profile.chargingProfilePurpose !== chargingProfilePurpose) {
                shouldRemove = false;
            }
            if (stackLevel !== undefined && profile.stackLevel !== stackLevel) {
                shouldRemove = false;
            }

            if (shouldRemove) cleared = true;
            return !shouldRemove;
        });

        this._sendResponse(messageId, { status: cleared ? 'Accepted' : 'Unknown' });
        this._log('info', `ClearChargingProfile: ${cleared ? 'profiles cleared' : 'no matching profiles'}`);
    }

    handleGetCompositeSchedule(payload, messageId) {
        const { connectorId, duration, chargingRateUnit } = payload;

        // 返回簡化的 composite schedule
        const schedule = {
            status: 'Accepted',
            connectorId,
            scheduleStart: formatTimestamp(),
            chargingSchedule: {
                duration,
                chargingRateUnit: chargingRateUnit || 'W',
                chargingSchedulePeriod: [
                    { startPeriod: 0, limit: 32000 } // 32 kW
                ]
            }
        };

        this._sendResponse(messageId, schedule);
        this._log('info', `GetCompositeSchedule for connector ${connectorId}`);
    }

    // ==================== Firmware Management Handlers ====================

    handleUpdateFirmware(payload, messageId) {
        const { location, retrieveDate, retries, retryInterval } = payload;

        this._sendResponse(messageId, {});
        this._log('info', `UpdateFirmware scheduled: ${location}`);

        // 模擬韌體更新流程
        const scheduleTime = new Date(retrieveDate).getTime() - Date.now();
        const startDelay = Math.max(scheduleTime, 1000);

        setTimeout(async () => {
            await this.sendFirmwareStatusNotification(FirmwareStatus.DOWNLOADING);
            await delay(3000);
            await this.sendFirmwareStatusNotification(FirmwareStatus.DOWNLOADED);
            await delay(1000);
            await this.sendFirmwareStatusNotification(FirmwareStatus.INSTALLING);
            await delay(3000);
            await this.sendFirmwareStatusNotification(FirmwareStatus.INSTALLED);
        }, startDelay);
    }

    handleGetDiagnostics(payload, messageId) {
        const { location, startTime, stopTime, retries, retryInterval } = payload;

        const fileName = `diagnostics_${this.id}_${Date.now()}.log`;
        this._sendResponse(messageId, { fileName });
        this._log('info', `GetDiagnostics: uploading to ${location}`);

        // 模擬診斷上傳流程
        setTimeout(async () => {
            await this.sendDiagnosticsStatusNotification(DiagnosticsStatus.UPLOADING);
            await delay(2000);
            await this.sendDiagnosticsStatusNotification(DiagnosticsStatus.UPLOADED);
        }, 1000);
    }

    // ==================== Local Auth List Handlers ====================

    handleGetLocalListVersion(payload, messageId) {
        this._sendResponse(messageId, { listVersion: this.localAuthListVersion });
        this._log('info', `GetLocalListVersion: ${this.localAuthListVersion}`);
    }

    handleSendLocalList(payload, messageId) {
        const { listVersion, localAuthorizationList, updateType } = payload;

        if (updateType === 'Full') {
            this.localAuthList.clear();
        }

        if (localAuthorizationList) {
            localAuthorizationList.forEach(item => {
                if (item.idTagInfo) {
                    this.localAuthList.set(item.idTag, item.idTagInfo);
                } else {
                    // 如果沒有 idTagInfo，從列表中刪除
                    this.localAuthList.delete(item.idTag);
                }
            });
        }

        this.localAuthListVersion = listVersion;
        this._sendResponse(messageId, { status: 'Accepted' });
        this._log('info', `SendLocalList: version ${listVersion}, type ${updateType}, size ${this.localAuthList.size}`);
    }

    // ==================== Reservation Handlers ====================

    handleReserveNow(payload, messageId) {
        const { connectorId, expiryDate, idTag, parentIdTag, reservationId } = payload;

        // 檢查連接器
        const connector = this.connectors.get(connectorId);
        if (!connector) {
            this._sendResponse(messageId, { status: 'Rejected' });
            return;
        }

        // 檢查連接器是否可預約
        if (connector.status !== ChargePointStatus.AVAILABLE) {
            this._sendResponse(messageId, { status: 'Occupied' });
            return;
        }

        // 檢查是否已有預約
        if (this.reservations.has(connectorId)) {
            this._sendResponse(messageId, { status: 'Rejected' });
            return;
        }

        // 建立預約
        this.reservations.set(connectorId, {
            reservationId,
            idTag,
            parentIdTag,
            expiryDate: new Date(expiryDate)
        });

        this._setConnectorStatus(connectorId, ChargePointStatus.RESERVED);
        this._sendResponse(messageId, { status: 'Accepted' });
        this._log('info', `Reservation ${reservationId} created for connector ${connectorId}`);

        // 設定過期計時器
        const expiryTime = new Date(expiryDate).getTime() - Date.now();
        if (expiryTime > 0) {
            setTimeout(() => {
                if (this.reservations.has(connectorId)) {
                    const reservation = this.reservations.get(connectorId);
                    if (reservation.reservationId === reservationId) {
                        this.reservations.delete(connectorId);
                        this._setConnectorStatus(connectorId, ChargePointStatus.AVAILABLE);
                        this._log('info', `Reservation ${reservationId} expired`);
                    }
                }
            }, expiryTime);
        }
    }

    handleCancelReservation(payload, messageId) {
        const { reservationId } = payload;

        // 找到對應的預約
        let found = false;
        for (const [connectorId, reservation] of this.reservations.entries()) {
            if (reservation.reservationId === reservationId) {
                this.reservations.delete(connectorId);
                this._setConnectorStatus(connectorId, ChargePointStatus.AVAILABLE);
                found = true;
                this._log('info', `Reservation ${reservationId} cancelled`);
                break;
            }
        }

        this._sendResponse(messageId, { status: found ? 'Accepted' : 'Rejected' });
    }

    // ==================== 內部方法 ====================

    _setConnectorStatus(connectorId, status, errorCode = ChargePointErrorCode.NO_ERROR) {
        const connector = this.connectors.get(connectorId);
        if (connector) {
            const oldStatus = connector.status;
            connector.status = status;
            connector.errorCode = errorCode;

            if (oldStatus !== status) {
                this.sendStatusNotification(connectorId, status, errorCode);
                eventBus.emit(Events.CONNECTOR_STATE_CHANGED, {
                    cpId: this.id,
                    connectorId,
                    status,
                    oldStatus
                });
            }
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, this.heartbeatIntervalMs);
        this._log('info', `Heartbeat started (interval: ${this.heartbeatIntervalMs / 1000}s)`);
    }

    _stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    _startMeterValueSampling(connectorId) {
        this._stopMeterValueSampling();

        const intervalConfig = this.configuration.get('MeterValueSampleInterval');
        const intervalSec = intervalConfig ? parseInt(intervalConfig.value) : 30;

        // 定義發送 MeterValues 的函數
        const sendSample = () => {
            // 取得當前有效的充電限制 (kW)
            const powerLimitKw = this._getActiveChargingLimit(connectorId);

            // 根據限制計算電量增加量 (Wh)
            // 增量 = 功率(kW) * 時間(小時) * 1000 = 功率(W) * 時間(秒) / 3600
            const baseIncrement = (powerLimitKw * 1000 * intervalSec) / 3600;
            // 加入 ±10% 隨機波動
            const variation = baseIncrement * (0.9 + Math.random() * 0.2);
            const increment = Math.round(variation);

            const currentWh = this.meterValues.get(connectorId) || 0;
            this.meterValues.set(connectorId, currentWh + increment);

            this.sendMeterValues(connectorId, null, powerLimitKw);

            this._log('info', `Charging at ${powerLimitKw.toFixed(1)} kW (limit applied)`);
        };

        // 立即發送第一次 MeterValues
        sendSample();

        // 設定週期性發送
        this.meterValueInterval = setInterval(sendSample, intervalSec * 1000);

        this._log('info', `MeterValue sampling started (interval: ${intervalSec}s)`);
    }

    _stopMeterValueSampling() {
        if (this.meterValueInterval) {
            clearInterval(this.meterValueInterval);
            this.meterValueInterval = null;
        }
    }

    /**
     * 啟動 Clock-Aligned MeterValue 採樣
     * 在時間對齊點 (如 :00, :15, :30, :45) 發送 MeterValues
     */
    _startClockAlignedSampling(connectorId) {
        this._stopClockAlignedSampling();

        const intervalConfig = this.configuration.get('ClockAlignedDataInterval');
        const intervalSec = intervalConfig ? parseInt(intervalConfig.value) : 0;

        // 如果間隔為 0，不啟動 clock-aligned 採樣
        if (intervalSec <= 0) {
            return;
        }

        // 計算到下一個對齊時間點的延遲
        const now = new Date();
        const secondsIntoInterval = (now.getMinutes() * 60 + now.getSeconds()) % intervalSec;
        const delayToNext = (intervalSec - secondsIntoInterval) * 1000;

        // 先設定一次性計時器到達下一個對齊點
        this.clockAlignedTimeout = setTimeout(() => {
            this.clockAlignedTimeout = null;

            // 發送 Clock-Aligned MeterValues
            this.sendMeterValues(connectorId, null, null, 'Sample.Clock');

            // 然後啟動週期性採樣
            this.clockAlignedInterval = setInterval(() => {
                this.sendMeterValues(connectorId, null, null, 'Sample.Clock');
            }, intervalSec * 1000);
        }, delayToNext);

        this._log('info', `Clock-aligned sampling scheduled (interval: ${intervalSec}s, next in ${(delayToNext / 1000).toFixed(0)}s)`);
    }

    _stopClockAlignedSampling() {
        if (this.clockAlignedTimeout) {
            clearTimeout(this.clockAlignedTimeout);
            this.clockAlignedTimeout = null;
        }
        if (this.clockAlignedInterval) {
            clearInterval(this.clockAlignedInterval);
            this.clockAlignedInterval = null;
        }
    }

    /**
     * 取得當前有效的充電功率限制 (kW)
     * 根據 ChargingProfile 的優先順序計算
     * @param {number} connectorId 
     * @returns {number} 功率限制 (kW)
     */
    _getActiveChargingLimit(connectorId) {
        const DEFAULT_POWER_KW = 7; // 預設 7 kW
        const MAX_POWER_KW = 22; // 最大 22 kW

        // 取得適用於此連接器的 profiles
        const applicableProfiles = this.chargingProfiles.filter(profile => {
            // connectorId 0 表示適用於所有連接器
            return profile.connectorId === 0 || profile.connectorId === connectorId;
        });

        if (applicableProfiles.length === 0) {
            return DEFAULT_POWER_KW;
        }

        // 按 stackLevel 排序 (高優先)，相同 stackLevel 則後設定的優先
        applicableProfiles.sort((a, b) => {
            if (b.stackLevel !== a.stackLevel) {
                return b.stackLevel - a.stackLevel;
            }
            return 0;
        });

        // 取最高優先的 profile
        const activeProfile = applicableProfiles[0];
        const schedule = activeProfile.chargingSchedule;

        if (!schedule || !schedule.chargingSchedulePeriod || schedule.chargingSchedulePeriod.length === 0) {
            return DEFAULT_POWER_KW;
        }

        // 計算當前時間在 schedule 中的位置
        const now = new Date();
        let scheduleStart = now;

        if (schedule.startSchedule) {
            scheduleStart = new Date(schedule.startSchedule);
        } else if (activeProfile.chargingProfileKind === 'Relative') {
            // Relative profile: 從交易開始計算
            // 這裡簡化處理，使用 profile 設定時間
            scheduleStart = new Date();
        }

        const elapsedSeconds = Math.floor((now.getTime() - scheduleStart.getTime()) / 1000);

        // 找到當前適用的 period
        let currentLimit = schedule.chargingSchedulePeriod[0].limit;
        for (const period of schedule.chargingSchedulePeriod) {
            if (elapsedSeconds >= period.startPeriod) {
                currentLimit = period.limit;
            } else {
                break;
            }
        }

        // 轉換為 kW (limit 可能是 A 或 W)
        let powerKw;
        if (schedule.chargingRateUnit === 'A') {
            // 假設 230V 單相
            powerKw = (currentLimit * 230) / 1000;
        } else {
            // W
            powerKw = currentLimit / 1000;
        }

        // 限制在合理範圍內
        return Math.min(Math.max(powerKw, 0), MAX_POWER_KW);
    }

    _log(level, message) {
        const entry = {
            timestamp: new Date(),
            cpId: this.id,
            level,
            message
        };
        eventBus.emit(Events.LOG_ENTRY, entry);

        if (level === 'tx' || level === 'rx') {
            eventBus.emit(level === 'tx' ? Events.OCPP_MESSAGE_SENT : Events.OCPP_MESSAGE_RECEIVED, {
                cpId: this.id,
                message
            });
        }
    }

    // ==================== 公開 API ====================

    getStatus() {
        return {
            id: this.id,
            url: this.url,
            connectionStatus: this.connectionStatus,
            connectors: Object.fromEntries(this.connectors),
            transactions: Object.fromEntries(this.transactions),
            meterValues: Object.fromEntries(this.meterValues)
        };
    }

    getConnectorStatus(connectorId) {
        return this.connectors.get(connectorId);
    }

    isConnected() {
        return this.connectionStatus === ConnectionStatus.CONNECTED;
    }

    hasActiveTransaction(connectorId = null) {
        if (connectorId !== null) {
            return this.transactions.has(connectorId);
        }
        return this.transactions.size > 0;
    }
}
