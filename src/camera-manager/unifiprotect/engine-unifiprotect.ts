import { add } from 'date-fns';
import { orderBy } from 'lodash-es';
import { StateWatcherSubscriptionInterface } from '../../card-controller/hass/state-watcher';
import { CameraConfig } from '../../config/schema/cameras';
import { getViewMediaFromBrowseMediaArray } from '../../ha/browse-media/browse-media-to-view-media';
import { sortMostRecentFirst } from '../../ha/browse-media/sort';
import {
  BROWSE_MEDIA_CACHE_SECONDS,
  BrowseMedia,
  BrowseMediaCache,
  BrowseMediaMetadata,
  MEDIA_CLASS_VIDEO,
  RichBrowseMedia,
} from '../../ha/browse-media/types';
import { BrowseMediaWalker } from '../../ha/browse-media/walker';
import { isMediaWithinDates } from '../../ha/browse-media/within-dates';
import { EntityRegistryManager } from '../../ha/registry/entity/types';
import { ResolvedMediaCache } from '../../ha/resolved-media';
import { HomeAssistant } from '../../ha/types';
import { allPromises, formatDate, isValidDate } from '../../utils/basic';
import { ViewMedia } from '../../view/item';
import { BrowseMediaCameraManagerEngine } from '../browse-media/engine-browse-media';
import { Camera } from '../camera';
import { CAMERA_MANAGER_ENGINE_EVENT_LIMIT_DEFAULT } from '../engine';
import { EntityCamera } from '../entity-camera';
import { CameraManagerReadOnlyConfigStore } from '../store';
import {
  CameraEventCallback,
  CameraManagerCameraMetadata,
  CameraManagerRequestCache,
  Engine,
  EngineOptions,
  EventQuery,
  EventQueryResults,
  EventQueryResultsMap,
  MediaMetadataQuery,
  MediaMetadataQueryResults,
  MediaMetadataQueryResultsMap,
  QueryResults,
  QueryResultsType,
  QueryReturnType,
} from '../types';
import { buildMediaSourceId } from './metadata';
import { UnifiProtectEventQueryResults, UnifiProtectEventType } from './types';

// Event types to query when browsing Protect media.
const EVENT_TYPES_TO_QUERY: readonly UnifiProtectEventType[] = [
  'motion',
  'smart',
] as const;

// Default number of days to look back for events.
const DEFAULT_EVENT_DAYS = 30;

export class UnifiProtectQueryResultsClassifier {
  public static isUnifiProtectEventQueryResults(
    results: QueryResults,
  ): results is UnifiProtectEventQueryResults {
    return (
      results.engine === Engine.UnifiProtect && results.type === QueryResultsType.Event
    );
  }
}

export class UnifiProtectCameraManagerEngine extends BrowseMediaCameraManagerEngine {
  protected _cache = new BrowseMediaCache<BrowseMediaMetadata>();

  public constructor(
    entityRegistryManager: EntityRegistryManager,
    stateWatcher: StateWatcherSubscriptionInterface,
    browseMediaManager: BrowseMediaWalker,
    resolvedMediaCache: ResolvedMediaCache,
    requestCache: CameraManagerRequestCache,
    eventCallback?: CameraEventCallback,
  ) {
    super(
      entityRegistryManager,
      stateWatcher,
      browseMediaManager,
      resolvedMediaCache,
      requestCache,
      eventCallback,
    );
  }

  public getEngineType(): Engine {
    return Engine.UnifiProtect;
  }

  /**
   * Extract the Protect camera device ID from a unique_id.
   *
   * UniFi Protect entity unique_ids typically follow the pattern:
   *   {camera_device_id}_{entity_suffix}
   * e.g., "AABBCCDDEEFF_high" or "AABBCCDDEEFF_medium"
   *
   * @returns The camera device ID, or null if it cannot be parsed.
   */
  protected _getCameraDeviceIdFromUniqueId(uniqueId: string): string | null {
    const match = uniqueId.match(/^(?<deviceId>[^_]+)_/);
    return match?.groups?.deviceId ?? null;
  }

  /**
   * Parse a UniFi Protect event title into metadata.
   *
   * Protect event titles are typically of the form:
   *   "2024-01-15T10:30:45+00:00" (ISO 8601)
   *   or "2024/01/15 10:30:45"
   *   or just a descriptive label like "Person detected"
   *
   * The media_content_id may contain event identifiers.
   */
  protected _protectEventMetadataGenerator(
    cameraID: string,
    media: BrowseMedia,
  ): BrowseMediaMetadata | null {
    if (media.media_class !== MEDIA_CLASS_VIDEO && !media.can_play) {
      return null;
    }

    // Try to parse the title as a date. Protect event titles may be ISO
    // timestamps or other date formats.
    const startDate = new Date(media.title);
    if (isValidDate(startDate)) {
      return {
        cameraID: cameraID,
        startDate: startDate,
        endDate: startDate,
      };
    }

    // If the title is not a parseable date, we still include the media but
    // without date metadata (it won't match date-range queries).
    return null;
  }

  public async createCamera(
    hass: HomeAssistant,
    cameraConfig: CameraConfig,
  ): Promise<Camera> {
    const camera = new EntityCamera(cameraConfig, this, {
      eventCallback: this._eventCallback,
    });
    return await camera.initialize({
      entityRegistryManager: this._entityRegistryManager,
      hass,
      stateWatcher: this._stateWatcher,
    });
  }

  /**
   * Build media-source URIs for a camera's events.
   */
  protected _getMediaSourceTargets(
    configEntryId: string,
    cameraDeviceId: string,
    days: number = DEFAULT_EVENT_DAYS,
  ): string[] {
    return EVENT_TYPES_TO_QUERY.map((eventType) =>
      buildMediaSourceId(configEntryId, cameraDeviceId, eventType, days),
    );
  }

  public async getEvents(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: EventQuery,
    engineOptions?: EngineOptions,
  ): Promise<EventQueryResultsMap | null> {
    // UniFi Protect does not support these query types.
    if (
      query.favorite ||
      query.tags?.size ||
      query.what?.size ||
      query.where?.size ||
      query.hasSnapshot
    ) {
      return null;
    }

    const output: EventQueryResultsMap = new Map();
    const getEventsForCamera = async (cameraID: string): Promise<void> => {
      const perCameraQuery = { ...query, cameraIDs: new Set([cameraID]) };
      const cachedResult =
        engineOptions?.useCache ?? true ? this._requestCache.get(perCameraQuery) : null;
      if (cachedResult) {
        output.set(perCameraQuery, cachedResult as EventQueryResults);
        return;
      }

      const camera = store.getCamera(cameraID);
      let media: RichBrowseMedia<BrowseMediaMetadata>[] = [];

      if (camera && camera instanceof EntityCamera) {
        const entity = camera.getEntity();
        const configEntryId = entity?.config_entry_id;
        const uniqueId = entity?.unique_id ? String(entity.unique_id) : null;
        const cameraDeviceId = uniqueId
          ? this._getCameraDeviceIdFromUniqueId(uniqueId)
          : null;

        if (configEntryId && cameraDeviceId) {
          const targets = this._getMediaSourceTargets(configEntryId, cameraDeviceId);
          const limit =
            perCameraQuery.limit ?? CAMERA_MANAGER_ENGINE_EVENT_LIMIT_DEFAULT;

          media = await this._browseMediaWalker.walk(
            hass,
            [
              {
                targets: targets,
                metadataGenerator: (
                  item: BrowseMedia,
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  _parent?: RichBrowseMedia<BrowseMediaMetadata>,
                ) => this._protectEventMetadataGenerator(cameraID, item),
                earlyExit: (items) => items.length >= limit,
                matcher: (item: RichBrowseMedia<BrowseMediaMetadata>) =>
                  !item.can_expand &&
                  isMediaWithinDates(item, perCameraQuery.start, perCameraQuery.end),
                sorter: (items: RichBrowseMedia<BrowseMediaMetadata>[]) =>
                  sortMostRecentFirst(items),
              },
            ],
            {
              ...(engineOptions?.useCache !== false && { cache: this._cache }),
            },
          );
        }
      }

      // Sort by most recent then slice at the query limit.
      const limit = perCameraQuery.limit ?? CAMERA_MANAGER_ENGINE_EVENT_LIMIT_DEFAULT;
      const sortedMedia = orderBy(
        media,
        (item: RichBrowseMedia<BrowseMediaMetadata>) => item._metadata?.startDate,
        'desc',
      ).slice(0, limit);

      const result: UnifiProtectEventQueryResults = {
        type: QueryResultsType.Event,
        engine: Engine.UnifiProtect,
        browseMedia: sortedMedia,
      };

      if (engineOptions?.useCache ?? true) {
        this._requestCache.set(
          perCameraQuery,
          { ...result, cached: true },
          result.expiry,
        );
      }
      output.set(perCameraQuery, result);
    };

    await allPromises(query.cameraIDs, (cameraID) => getEventsForCamera(cameraID));
    return output;
  }

  public generateMediaFromEvents(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: EventQuery,
    results: QueryReturnType<EventQuery>,
  ): ViewMedia[] | null {
    if (!UnifiProtectQueryResultsClassifier.isUnifiProtectEventQueryResults(results)) {
      return null;
    }
    return getViewMediaFromBrowseMediaArray(results.browseMedia);
  }

  public async getMediaMetadata(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: MediaMetadataQuery,
    engineOptions?: EngineOptions,
  ): Promise<MediaMetadataQueryResultsMap | null> {
    const output: MediaMetadataQueryResultsMap = new Map();
    const cachedResult =
      engineOptions?.useCache ?? true ? this._requestCache.get(query) : null;

    if (cachedResult) {
      output.set(query, cachedResult as MediaMetadataQueryResults);
      return output;
    }

    const days: Set<string> = new Set();
    const getDaysForCamera = async (cameraID: string): Promise<void> => {
      const camera = store.getCamera(cameraID);
      if (!camera || !(camera instanceof EntityCamera)) {
        return;
      }
      const entity = camera.getEntity();
      const configEntryId = entity?.config_entry_id;
      const uniqueId = entity?.unique_id ? String(entity.unique_id) : null;
      const cameraDeviceId = uniqueId
        ? this._getCameraDeviceIdFromUniqueId(uniqueId)
        : null;

      if (!configEntryId || !cameraDeviceId) {
        return;
      }

      const targets = this._getMediaSourceTargets(configEntryId, cameraDeviceId);

      // Walk the browse media to collect events (which contain date info).
      const media = await this._browseMediaWalker.walk(
        hass,
        [
          {
            targets: targets,
            metadataGenerator: (
              item: BrowseMedia,
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              _parent?: RichBrowseMedia<BrowseMediaMetadata>,
            ) => this._protectEventMetadataGenerator(cameraID, item),
            matcher: (item: RichBrowseMedia<BrowseMediaMetadata>) =>
              !item.can_expand && !!item._metadata?.startDate,
          },
        ],
        {
          ...(engineOptions?.useCache !== false && { cache: this._cache }),
        },
      );

      for (const event of media ?? []) {
        if (event._metadata?.startDate) {
          days.add(formatDate(event._metadata.startDate));
        }
      }
    };

    await allPromises(query.cameraIDs, (cameraID) => getDaysForCamera(cameraID));

    const result: MediaMetadataQueryResults = {
      type: QueryResultsType.MediaMetadata,
      engine: Engine.UnifiProtect,
      metadata: {
        ...(days.size && { days: days }),
      },
      expiry: add(new Date(), { seconds: BROWSE_MEDIA_CACHE_SECONDS }),
      cached: false,
    };

    if (engineOptions?.useCache ?? true) {
      this._requestCache.set(query, { ...result, cached: true }, result.expiry);
    }
    output.set(query, result);
    return output;
  }

  public getCameraMetadata(
    hass: HomeAssistant,
    cameraConfig: CameraConfig,
  ): CameraManagerCameraMetadata {
    return {
      ...super.getCameraMetadata(hass, cameraConfig),
      engineIcon: 'unifiprotect',
    };
  }
}
