/**
 * OCPP-J Protocol 處理
 * 負責 WebSocket 訊息的封包與解析
 */
import { MessageType, OCPPErrorCode } from '../utils/constants.js';
import { generateMessageId } from '../utils/helpers.js';

export class OCPPProtocol {
    /**
     * 建立 CALL 訊息 (CP 發起請求)
     * @param {string} action - OCPP Action 名稱
     * @param {Object} payload - 請求內容
     * @returns {{message: string, messageId: string}}
     */
    static createCall(action, payload = {}) {
        const messageId = generateMessageId();
        const message = JSON.stringify([
            MessageType.CALL,
            messageId,
            action,
            payload
        ]);
        return { message, messageId };
    }

    /**
     * 建立 CALLRESULT 訊息 (回應 Server 請求)
     * @param {string} messageId - 原始請求的 messageId
     * @param {Object} payload - 回應內容
     * @returns {string}
     */
    static createCallResult(messageId, payload = {}) {
        return JSON.stringify([
            MessageType.CALL_RESULT,
            messageId,
            payload
        ]);
    }

    /**
     * 建立 CALLERROR 訊息 (回應錯誤)
     * @param {string} messageId - 原始請求的 messageId
     * @param {string} errorCode - 錯誤碼
     * @param {string} errorDescription - 錯誤描述
     * @param {Object} errorDetails - 錯誤詳情
     * @returns {string}
     */
    static createCallError(messageId, errorCode, errorDescription = '', errorDetails = {}) {
        return JSON.stringify([
            MessageType.CALL_ERROR,
            messageId,
            errorCode,
            errorDescription,
            errorDetails
        ]);
    }

    /**
     * 解析收到的訊息
     * @param {string} rawMessage - 原始 JSON 字串
     * @returns {{type: number, messageId: string, action?: string, payload?: Object, errorCode?: string, errorDescription?: string, errorDetails?: Object} | null}
     */
    static parseMessage(rawMessage) {
        try {
            const parsed = JSON.parse(rawMessage);

            if (!Array.isArray(parsed) || parsed.length < 3) {
                console.error('Invalid OCPP message format');
                return null;
            }

            const type = parsed[0];
            const messageId = parsed[1];

            switch (type) {
                case MessageType.CALL:
                    // [2, messageId, action, payload]
                    if (parsed.length < 4) return null;
                    return {
                        type,
                        messageId,
                        action: parsed[2],
                        payload: parsed[3] || {}
                    };

                case MessageType.CALL_RESULT:
                    // [3, messageId, payload]
                    return {
                        type,
                        messageId,
                        payload: parsed[2] || {}
                    };

                case MessageType.CALL_ERROR:
                    // [4, messageId, errorCode, errorDescription, errorDetails]
                    return {
                        type,
                        messageId,
                        errorCode: parsed[2] || OCPPErrorCode.GENERIC_ERROR,
                        errorDescription: parsed[3] || '',
                        errorDetails: parsed[4] || {}
                    };

                default:
                    console.error('Unknown message type:', type);
                    return null;
            }
        } catch (error) {
            console.error('Failed to parse OCPP message:', error);
            return null;
        }
    }

    /**
     * 驗證 Action 名稱是否有效
     * @param {string} action 
     * @returns {boolean}
     */
    static isValidAction(action) {
        const validActions = [
            // CP -> Server
            'Authorize',
            'BootNotification',
            'DataTransfer',
            'DiagnosticsStatusNotification',
            'FirmwareStatusNotification',
            'Heartbeat',
            'MeterValues',
            'StartTransaction',
            'StatusNotification',
            'StopTransaction',
            // Server -> CP
            'CancelReservation',
            'ChangeAvailability',
            'ChangeConfiguration',
            'ClearCache',
            'ClearChargingProfile',
            'GetCompositeSchedule',
            'GetConfiguration',
            'GetDiagnostics',
            'GetLocalListVersion',
            'RemoteStartTransaction',
            'RemoteStopTransaction',
            'ReserveNow',
            'Reset',
            'SendLocalList',
            'SetChargingProfile',
            'TriggerMessage',
            'UnlockConnector',
            'UpdateFirmware'
        ];
        return validActions.includes(action);
    }
}
