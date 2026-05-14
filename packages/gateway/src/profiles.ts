import {
  DeviceProfile,
  EdgeTransport,
  GatewayDeviceCredential,
  IngressSecurityMode,
} from './types';

/** Conservative transport/security defaults for common edge device families. */
export const DEVICE_PROFILE_DEFAULTS: Record<
  DeviceProfile,
  {
    readonly transports: readonly EdgeTransport[];
    readonly securityModes: readonly IngressSecurityMode[];
  }
> = {
  RASPBERRY_PI: {
    transports: ['wifi_http', 'mqtt', 'websocket', 'serial', 'ble'],
    securityModes: ['ED25519', 'HMAC_SHA256', 'AES_256_GCM'],
  },
  ESP32: {
    transports: ['wifi_http', 'mqtt', 'esp_now', 'ble'],
    securityModes: ['HMAC_SHA256', 'AES_256_GCM'],
  },
  ESP8266: {
    transports: ['wifi_http', 'mqtt'],
    securityModes: ['HMAC_SHA256'],
  },
  ARDUINO: {
    transports: ['serial', 'lora'],
    securityModes: ['HMAC_SHA256', 'AES_256_GCM', 'OPEN_BROADCAST'],
  },
  LORA_NODE: {
    transports: ['lora'],
    securityModes: ['AES_256_GCM', 'HMAC_SHA256', 'OPEN_BROADCAST'],
  },
  GENERIC_GATEWAY: {
    transports: ['wifi_http', 'mqtt', 'websocket', 'serial', 'lora', 'broadcast_udp'],
    securityModes: ['ED25519', 'HMAC_SHA256', 'AES_256_GCM'],
  },
};

/** Creates a device credential record using profile defaults plus caller-supplied keys. */
export function createGatewayCredential(
  deviceId: string,
  profile: DeviceProfile,
  keys: {
    readonly hmacSecret?: string;
    readonly aesKey?: string;
    readonly publicKeyPem?: string;
    readonly tags?: readonly string[];
  } = {},
): GatewayDeviceCredential {
  const defaults = DEVICE_PROFILE_DEFAULTS[profile];
  return {
    deviceId,
    profile,
    allowedTransports: defaults.transports,
    allowedSecurityModes: defaults.securityModes,
    ...withoutUndefined(keys),
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  ) as Partial<T>;
}
