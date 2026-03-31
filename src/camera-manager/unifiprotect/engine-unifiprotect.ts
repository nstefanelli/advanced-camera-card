import { StateWatcherSubscriptionInterface } from '../../card-controller/hass/state-watcher';
import { CameraConfig } from '../../config/schema/cameras';
import { BrowseMediaMetadata, BrowseMediaCache } from '../../ha/browse-media/types';
import { BrowseMediaWalker } from '../../ha/browse-media/walker';
import { EntityRegistryManager } from '../../ha/registry/entity/types';
import { ResolvedMediaCache } from '../../ha/resolved-media';
import { HomeAssistant } from '../../ha/types';
import { Camera } from '../camera';
import { BrowseMediaCameraManagerEngine } from '../browse-media/engine-browse-media';
import { CameraManagerReadOnlyConfigStore } from '../store';
import {
  CameraEventCallback,
  CameraManagerCameraMetadata,
  CameraManagerRequestCache,
  Engine,
  EngineOptions,
  EventQuery,
  EventQueryResultsMap,
  MediaMetadataQuery,
  MediaMetadataQueryResultsMap,
  QueryResults,
  QueryResultsType,
  QueryReturnType,
} from '../types';
import { UnifiProtectEventQueryResults } from './types';

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

  public async createCamera(
    _hass: HomeAssistant,
    cameraConfig: CameraConfig,
  ): Promise<Camera> {
    // TODO: Implement UnifiProtectCamera class in a future task.
    return await new Camera(cameraConfig, this, {
      eventCallback: this._eventCallback,
    }).initialize({
      hass: _hass,
      stateWatcher: this._stateWatcher,
    });
  }

  public async getEvents(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: EventQuery,
    _engineOptions?: EngineOptions,
  ): Promise<EventQueryResultsMap | null> {
    // TODO: Implement event browsing via UniFi Protect media source in a future task.
    return null;
  }

  public generateMediaFromEvents(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: EventQuery,
    results: QueryReturnType<EventQuery>,
  ): null {
    // TODO: Implement media generation from Protect events in a future task.
    return null;
  }

  public async getMediaMetadata(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: MediaMetadataQuery,
    _engineOptions?: EngineOptions,
  ): Promise<MediaMetadataQueryResultsMap | null> {
    // TODO: Implement media metadata retrieval in a future task.
    return null;
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
