import { BrowseMediaMetadata, RichBrowseMedia } from '../../ha/browse-media/types';
import { Engine, EventQueryResults } from '../types';

// UniFi Protect event types available in the media source.
export type UnifiProtectEventType = 'motion' | 'smart' | 'ring' | 'audio';

// Parsed components of a UniFi Protect media-source URI.
export interface UnifiProtectMediaSourceId {
  nvrId: string;
  cameraId: string;
  eventType: UnifiProtectEventType;
  timeRange: string;
  days: number;
}

// ======================================
// UniFi Protect concrete query results
// ======================================

export interface UnifiProtectEventQueryResults extends EventQueryResults {
  engine: Engine.UnifiProtect;
  browseMedia: RichBrowseMedia<BrowseMediaMetadata>[];
}
