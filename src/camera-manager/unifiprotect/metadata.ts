import { UnifiProtectEventType, UnifiProtectMediaSourceId } from './types';

const MEDIA_SOURCE_PREFIX = 'media-source://unifiprotect/';
const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  'motion',
  'smart',
  'ring',
  'audio',
]);
const DEFAULT_DAYS = 30;

/**
 * Parse a UniFi Protect media-source URI into its component parts.
 *
 * Expected format:
 *   media-source://unifiprotect/{nvrId}:browse:{cameraId}:{eventType}:recent:{days}
 *
 * @returns Parsed components, or null if the URI is invalid.
 */
export function parseMediaSourceId(uri: string): UnifiProtectMediaSourceId | null {
  if (!uri.startsWith(MEDIA_SOURCE_PREFIX)) {
    return null;
  }

  const path = uri.slice(MEDIA_SOURCE_PREFIX.length);
  const parts = path.split(':');

  // Expect exactly 6 segments: nvrId, "browse", cameraId, eventType, "recent", days
  if (parts.length !== 6) {
    return null;
  }

  const [nvrId, browse, cameraId, eventType, timeRange, daysStr] = parts;

  if (browse !== 'browse') {
    return null;
  }

  if (!VALID_EVENT_TYPES.has(eventType)) {
    return null;
  }

  const days = Number(daysStr);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }

  if (!nvrId || !cameraId) {
    return null;
  }

  return {
    nvrId,
    cameraId,
    eventType: eventType as UnifiProtectEventType,
    timeRange,
    days,
  };
}

/**
 * Build a UniFi Protect media-source URI from component parts.
 *
 * @param nvrId - The NVR device ID.
 * @param cameraId - The camera device ID.
 * @param eventType - The event type to browse.
 * @param days - Number of days to look back (default: 30).
 * @returns A fully-formed media-source URI.
 */
export function buildMediaSourceId(
  nvrId: string,
  cameraId: string,
  eventType: UnifiProtectEventType,
  days: number = DEFAULT_DAYS,
): string {
  return `${MEDIA_SOURCE_PREFIX}${nvrId}:browse:${cameraId}:${eventType}:recent:${days}`;
}
