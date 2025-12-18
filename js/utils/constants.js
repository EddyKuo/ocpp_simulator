/**
 * OCPP 1.6 常數定義
 */

// OCPP-J Message Types
export const MessageType = {
    CALL: 2,
    CALL_RESULT: 3,
    CALL_ERROR: 4
};

// Connector 狀態
export const ChargePointStatus = {
    AVAILABLE: 'Available',
    PREPARING: 'Preparing',
    CHARGING: 'Charging',
    SUSPENDED_EV: 'SuspendedEV',
    SUSPENDED_EVSE: 'SuspendedEVSE',
    FINISHING: 'Finishing',
    RESERVED: 'Reserved',
    UNAVAILABLE: 'Unavailable',
    FAULTED: 'Faulted'
};

// WebSocket 連線狀態
export const ConnectionStatus = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected'
};

// OCPP Error Codes
export const OCPPErrorCode = {
    NOT_IMPLEMENTED: 'NotImplemented',
    NOT_SUPPORTED: 'NotSupported',
    INTERNAL_ERROR: 'InternalError',
    PROTOCOL_ERROR: 'ProtocolError',
    SECURITY_ERROR: 'SecurityError',
    FORMATION_VIOLATION: 'FormationViolation',
    PROPERTY_CONSTRAINT_VIOLATION: 'PropertyConstraintViolation',
    OCCURRENCE_CONSTRAINT_VIOLATION: 'OccurrenceConstraintViolation',
    TYPE_CONSTRAINT_VIOLATION: 'TypeConstraintViolation',
    GENERIC_ERROR: 'GenericError'
};

// ChargePointErrorCode (for StatusNotification)
export const ChargePointErrorCode = {
    CONNECTOR_LOCK_FAILURE: 'ConnectorLockFailure',
    EV_COMMUNICATION_ERROR: 'EVCommunicationError',
    GROUND_FAILURE: 'GroundFailure',
    HIGH_TEMPERATURE: 'HighTemperature',
    INTERNAL_ERROR: 'InternalError',
    LOCAL_LIST_CONFLICT: 'LocalListConflict',
    NO_ERROR: 'NoError',
    OTHER_ERROR: 'OtherError',
    OVER_CURRENT_FAILURE: 'OverCurrentFailure',
    OVER_VOLTAGE: 'OverVoltage',
    POWER_METER_FAILURE: 'PowerMeterFailure',
    POWER_SWITCH_FAILURE: 'PowerSwitchFailure',
    READER_FAILURE: 'ReaderFailure',
    RESET_FAILURE: 'ResetFailure',
    UNDER_VOLTAGE: 'UnderVoltage',
    WEAK_SIGNAL: 'WeakSignal'
};

// Authorization Status
export const AuthorizationStatus = {
    ACCEPTED: 'Accepted',
    BLOCKED: 'Blocked',
    EXPIRED: 'Expired',
    INVALID: 'Invalid',
    CONCURRENT_TX: 'ConcurrentTx'
};

// Stop Transaction Reason
export const StopReason = {
    EMERGENCY_STOP: 'EmergencyStop',
    EV_DISCONNECTED: 'EVDisconnected',
    HARD_RESET: 'HardReset',
    LOCAL: 'Local',
    OTHER: 'Other',
    POWER_LOSS: 'PowerLoss',
    REBOOT: 'Reboot',
    REMOTE: 'Remote',
    SOFT_RESET: 'SoftReset',
    UNLOCK_COMMAND: 'UnlockCommand',
    DE_AUTHORIZED: 'DeAuthorized'
};

// BootNotification Status
export const RegistrationStatus = {
    ACCEPTED: 'Accepted',
    PENDING: 'Pending',
    REJECTED: 'Rejected'
};

// Reset Type
export const ResetType = {
    HARD: 'Hard',
    SOFT: 'Soft'
};

// Availability Type
export const AvailabilityType = {
    OPERATIVE: 'Operative',
    INOPERATIVE: 'Inoperative'
};

// Unlock Status
export const UnlockStatus = {
    UNLOCKED: 'Unlocked',
    UNLOCK_FAILED: 'UnlockFailed',
    NOT_SUPPORTED: 'NotSupported'
};

// Configuration Status
export const ConfigurationStatus = {
    ACCEPTED: 'Accepted',
    REJECTED: 'Rejected',
    REBOOT_REQUIRED: 'RebootRequired',
    NOT_SUPPORTED: 'NotSupported'
};

// Firmware Status
export const FirmwareStatus = {
    DOWNLOADED: 'Downloaded',
    DOWNLOAD_FAILED: 'DownloadFailed',
    DOWNLOADING: 'Downloading',
    IDLE: 'Idle',
    INSTALLATION_FAILED: 'InstallationFailed',
    INSTALLED: 'Installed',
    INSTALLING: 'Installing'
};

// Diagnostics Status
export const DiagnosticsStatus = {
    IDLE: 'Idle',
    UPLOADED: 'Uploaded',
    UPLOAD_FAILED: 'UploadFailed',
    UPLOADING: 'Uploading'
};

// Trigger Message Status
export const TriggerMessageStatus = {
    ACCEPTED: 'Accepted',
    REJECTED: 'Rejected',
    NOT_IMPLEMENTED: 'NotImplemented'
};

// Measurand
export const Measurand = {
    ENERGY_ACTIVE_IMPORT_REGISTER: 'Energy.Active.Import.Register',
    POWER_ACTIVE_IMPORT: 'Power.Active.Import',
    CURRENT_IMPORT: 'Current.Import',
    VOLTAGE: 'Voltage',
    SOC: 'SoC',
    TEMPERATURE: 'Temperature'
};

// Default Configuration Keys
export const DefaultConfiguration = {
    HeartbeatInterval: { key: 'HeartbeatInterval', value: '60', readonly: false },
    ConnectionTimeOut: { key: 'ConnectionTimeOut', value: '60', readonly: false },
    MeterValueSampleInterval: { key: 'MeterValueSampleInterval', value: '30', readonly: false },
    ClockAlignedDataInterval: { key: 'ClockAlignedDataInterval', value: '0', readonly: false },
    NumberOfConnectors: { key: 'NumberOfConnectors', value: '1', readonly: true },
    SupportedFeatureProfiles: {
        key: 'SupportedFeatureProfiles',
        value: 'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
        readonly: true
    },
    AuthorizeRemoteTxRequests: { key: 'AuthorizeRemoteTxRequests', value: 'true', readonly: false },
    LocalPreAuthorize: { key: 'LocalPreAuthorize', value: 'false', readonly: false },
    LocalAuthorizeOffline: { key: 'LocalAuthorizeOffline', value: 'true', readonly: false },
    StopTransactionOnInvalidId: { key: 'StopTransactionOnInvalidId', value: 'true', readonly: false },
    StopTransactionOnEVSideDisconnect: { key: 'StopTransactionOnEVSideDisconnect', value: 'true', readonly: false },
    MeterValuesSampledData: { key: 'MeterValuesSampledData', value: 'Energy.Active.Import.Register,Power.Active.Import', readonly: false },
    LocalAuthListEnabled: { key: 'LocalAuthListEnabled', value: 'true', readonly: false },
    LocalAuthListMaxLength: { key: 'LocalAuthListMaxLength', value: '100', readonly: true }
};
