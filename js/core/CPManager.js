/**
 * CPManager - 充電樁管理器 (Singleton)
 * 管理所有 ChargePoint 實例的生命週期
 */
import { ChargePoint } from './ChargePoint.js';
import { eventBus, Events } from './EventBus.js';
import { ConnectionStatus } from '../utils/constants.js';

export class CPManager {
    static #instance = null;

    static getInstance() {
        if (!CPManager.#instance) {
            CPManager.#instance = new CPManager();
        }
        return CPManager.#instance;
    }

    constructor() {
        if (CPManager.#instance) {
            throw new Error('Use CPManager.getInstance()');
        }
        this.chargePoints = new Map(); // cpId -> ChargePoint
        this.selectedCPId = null;

        // 從 localStorage 載入之前儲存的 CP
        this._loadFromStorage();
    }

    // ==================== CP 管理 ====================

    /**
     * 新增充電樁
     * @param {string} id 
     * @param {string} serverUrl 
     * @param {Object} options 
     * @returns {ChargePoint}
     */
    addChargePoint(id, serverUrl, options = {}) {
        if (this.chargePoints.has(id)) {
            throw new Error(`ChargePoint ${id} already exists`);
        }

        const cp = new ChargePoint(id, serverUrl, options);
        this.chargePoints.set(id, cp);

        // 儲存到 localStorage
        this._saveToStorage();

        eventBus.emit(Events.CP_ADDED, { cpId: id, cp });

        // 如果是第一個 CP，自動選取
        if (this.chargePoints.size === 1) {
            this.selectChargePoint(id);
        }

        return cp;
    }

    /**
     * 移除充電樁
     * @param {string} id 
     */
    removeChargePoint(id) {
        const cp = this.chargePoints.get(id);
        if (cp) {
            cp.disconnect();
            this.chargePoints.delete(id);
            this._saveToStorage();

            eventBus.emit(Events.CP_REMOVED, { cpId: id });

            // 如果移除的是當前選取的 CP，選取另一個
            if (this.selectedCPId === id) {
                const nextCP = this.chargePoints.keys().next().value;
                this.selectChargePoint(nextCP || null);
            }
        }
    }

    /**
     * 取得充電樁
     * @param {string} id 
     * @returns {ChargePoint | undefined}
     */
    getChargePoint(id) {
        return this.chargePoints.get(id);
    }

    /**
     * 取得所有充電樁
     * @returns {Map<string, ChargePoint>}
     */
    getAllChargePoints() {
        return this.chargePoints;
    }

    /**
     * 取得當前選取的充電樁
     * @returns {ChargePoint | null}
     */
    getSelectedChargePoint() {
        if (!this.selectedCPId) return null;
        return this.chargePoints.get(this.selectedCPId) || null;
    }

    /**
     * 選取充電樁
     * @param {string | null} id 
     */
    selectChargePoint(id) {
        this.selectedCPId = id;
        eventBus.emit(Events.CP_SELECTED, {
            cpId: id,
            cp: id ? this.chargePoints.get(id) : null
        });
    }

    // ==================== 批量操作 ====================

    /**
     * 連線所有充電樁
     */
    connectAll() {
        this.chargePoints.forEach(cp => {
            if (cp.connectionStatus !== ConnectionStatus.CONNECTED) {
                cp.connect();
            }
        });
    }

    /**
     * 斷線所有充電樁
     */
    disconnectAll() {
        this.chargePoints.forEach(cp => {
            cp.disconnect();
        });
    }

    /**
     * 發送 Heartbeat 到所有已連線的充電樁
     */
    sendHeartbeatAll() {
        this.chargePoints.forEach(cp => {
            if (cp.isConnected()) {
                cp.sendHeartbeat();
            }
        });
    }

    /**
     * 取得統計資訊
     * @returns {Object}
     */
    getStats() {
        let connected = 0;
        let charging = 0;
        let total = this.chargePoints.size;

        this.chargePoints.forEach(cp => {
            if (cp.isConnected()) connected++;
            if (cp.hasActiveTransaction()) charging++;
        });

        return { total, connected, charging };
    }

    // ==================== 持久化 ====================

    _saveToStorage() {
        const data = [];
        this.chargePoints.forEach((cp, id) => {
            data.push({
                id: cp.id,
                url: cp.url,
                connectorCount: cp.connectorCount,
                vendor: cp.vendor,
                model: cp.model
            });
        });
        localStorage.setItem('ocpp_chargepoints', JSON.stringify(data));
    }

    _loadFromStorage() {
        try {
            const data = localStorage.getItem('ocpp_chargepoints');
            if (data) {
                const cpList = JSON.parse(data);
                if (Array.isArray(cpList)) {
                    cpList.forEach(cpData => {
                        // 驗證資料完整性
                        if (cpData && cpData.id && cpData.url) {
                            try {
                                const cp = new ChargePoint(cpData.id, cpData.url, {
                                    connectorCount: cpData.connectorCount || 1,
                                    vendor: cpData.vendor,
                                    model: cpData.model
                                });
                                this.chargePoints.set(cpData.id, cp);
                            } catch (cpError) {
                                console.error(`Failed to create ChargePoint ${cpData.id}:`, cpError);
                            }
                        }
                    });
                }

                // 選取第一個 CP
                if (this.chargePoints.size > 0) {
                    this.selectedCPId = this.chargePoints.keys().next().value;
                }
            }
        } catch (error) {
            console.error('Failed to load charge points from storage:', error);
            // 清除損壞的資料
            localStorage.removeItem('ocpp_chargepoints');
        }
    }

    /**
     * 清除所有儲存的資料
     */
    clearStorage() {
        localStorage.removeItem('ocpp_chargepoints');
        this.chargePoints.forEach(cp => cp.disconnect());
        this.chargePoints.clear();
        this.selectedCPId = null;
    }
}
