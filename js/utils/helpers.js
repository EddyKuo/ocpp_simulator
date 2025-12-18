/**
 * 工具函數
 */

/**
 * 產生 UUID (使用瀏覽器原生 API)
 * @returns {string}
 */
export function generateUUID() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 產生短 UUID (用於 OCPP message ID)
 * @returns {string}
 */
export function generateMessageId() {
    return generateUUID().substring(0, 8);
}

/**
 * 格式化 ISO 8601 時間戳記
 * @param {Date} date 
 * @returns {string}
 */
export function formatTimestamp(date = new Date()) {
    return date.toISOString();
}

/**
 * 格式化顯示用時間
 * @param {Date} date 
 * @returns {string}
 */
export function formatDisplayTime(date = new Date()) {
    return new Intl.DateTimeFormat('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date);
}

/**
 * 格式化顯示用日期時間
 * @param {Date} date 
 * @returns {string}
 */
export function formatDisplayDateTime(date = new Date()) {
    return new Intl.DateTimeFormat('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date);
}

/**
 * 延遲執行
 * @param {number} ms - 毫秒
 * @returns {Promise}
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 深拷貝物件
 * @param {*} obj 
 * @returns {*}
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 產生隨機整數
 * @param {number} min 
 * @param {number} max 
 * @returns {number}
 */
export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 產生隨機浮點數
 * @param {number} min 
 * @param {number} max 
 * @param {number} decimals 
 * @returns {number}
 */
export function randomFloat(min, max, decimals = 2) {
    const value = Math.random() * (max - min) + min;
    return parseFloat(value.toFixed(decimals));
}

/**
 * 格式化 JSON (用於 Log 顯示)
 * @param {*} data 
 * @returns {string}
 */
export function formatJSON(data) {
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
}

/**
 * 安全解析 JSON
 * @param {string} str 
 * @returns {*}
 */
export function safeJSONParse(str) {
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}

/**
 * 建立防抖函數
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 建立節流函數
 * @param {Function} func 
 * @param {number} limit 
 * @returns {Function}
 */
export function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
