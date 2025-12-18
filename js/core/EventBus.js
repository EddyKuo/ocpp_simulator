/**
 * EventBus - 簡易事件系統
 * 用於 CP 狀態變更、Log 訊息等事件的發布訂閱
 */
export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * 訂閱事件
     * @param {string} event - 事件名稱
     * @param {Function} callback - 回調函數
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * 取消訂閱
     * @param {string} event - 事件名稱
     * @param {Function} callback - 回調函數
     */
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * 發布事件
     * @param {string} event - 事件名稱
     * @param {*} data - 事件資料
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (error) {
                console.error(`EventBus error in ${event}:`, error);
            }
        });
    }

    /**
     * 一次性訂閱（觸發後自動取消）
     * @param {string} event - 事件名稱
     * @param {Function} callback - 回調函數
     */
    once(event, callback) {
        const wrapper = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        this.on(event, wrapper);
    }
}

// 全域事件匯流排
export const eventBus = new EventBus();

// 事件名稱常數
export const Events = {
    // CP 生命週期
    CP_ADDED: 'cp:added',
    CP_REMOVED: 'cp:removed',
    CP_SELECTED: 'cp:selected',

    // 連線狀態
    WS_CONNECTING: 'ws:connecting',
    WS_CONNECTED: 'ws:connected',
    WS_DISCONNECTED: 'ws:disconnected',
    WS_ERROR: 'ws:error',

    // OCPP 訊息
    OCPP_MESSAGE_SENT: 'ocpp:sent',
    OCPP_MESSAGE_RECEIVED: 'ocpp:received',

    // CP 狀態
    CP_STATE_CHANGED: 'cp:stateChanged',
    CONNECTOR_STATE_CHANGED: 'connector:stateChanged',
    TRANSACTION_STARTED: 'transaction:started',
    TRANSACTION_STOPPED: 'transaction:stopped',
    METER_VALUES_SENT: 'meterValues:sent',

    // Log
    LOG_ENTRY: 'log:entry'
};
