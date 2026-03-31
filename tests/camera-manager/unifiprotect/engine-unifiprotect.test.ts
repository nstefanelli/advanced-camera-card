import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mock } from 'vitest-mock-extended';
import {
  UnifiProtectCameraManagerEngine,
  UnifiProtectQueryResultsClassifier,
} from '../../../src/camera-manager/unifiprotect/engine-unifiprotect';
import {
  parseMediaSourceId,
  buildMediaSourceId,
} from '../../../src/camera-manager/unifiprotect/metadata';
import { UnifiProtectEventQueryResults } from '../../../src/camera-manager/unifiprotect/types';
import { CameraManagerStore } from '../../../src/camera-manager/store';
import {
  CameraManagerRequestCache,
  Engine,
  EventQuery,
  QueryResultsType,
  QueryReturnType,
  QueryType,
} from '../../../src/camera-manager/types';
import { StateWatcher } from '../../../src/card-controller/hass/state-watcher';
import { BrowseMedia, browseMediaSchema } from '../../../src/ha/browse-media/types';
import { BrowseMediaWalker } from '../../../src/ha/browse-media/walker';
import { EntityRegistryManager } from '../../../src/ha/registry/entity/types';
import { ResolvedMediaCache } from '../../../src/ha/resolved-media';
import { homeAssistantWSRequest } from '../../../src/ha/ws-request';
import { EntityRegistryManagerMock } from '../../ha/registry/entity/mock';
import {
  createInitializedCamera,
  createCameraConfig,
  createHASS,
  createRegistryEntity,
  createStore,
} from '../../test-utils';

vi.mock('../../../src/ha/ws-request');

// Sample browse media response for a Protect camera's motion events.
const TEST_MOTION_EVENTS: BrowseMedia = {
  title: 'Front Door - Motion Events',
  media_class: 'channel',
  media_content_type: 'playlist',
  media_content_id:
    'media-source://unifiprotect/nvr001:browse:cam001:motion:recent:30',
  children_media_class: 'video',
  can_play: false,
  can_expand: true,
  thumbnail: null,
  children: [
    {
      title: '2024-11-05T21:23:53.000Z',
      media_class: 'video',
      media_content_type: 'video',
      media_content_id:
        'media-source://unifiprotect/nvr001:event:evt001',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: '/api/unifiprotect/thumbnail/nvr001/evt001',
    },
    {
      title: '2024-11-05T21:29:05.000Z',
      media_class: 'video',
      media_content_type: 'video',
      media_content_id:
        'media-source://unifiprotect/nvr001:event:evt002',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: '/api/unifiprotect/thumbnail/nvr001/evt002',
    },
    {
      title: '2024-11-05T22:04:49.000Z',
      media_class: 'video',
      media_content_type: 'video',
      media_content_id:
        'media-source://unifiprotect/nvr001:event:evt003',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: '/api/unifiprotect/thumbnail/nvr001/evt003',
    },
  ],
};

// Sample browse media response for smart detection events.
const TEST_SMART_EVENTS: BrowseMedia = {
  title: 'Front Door - Smart Events',
  media_class: 'channel',
  media_content_type: 'playlist',
  media_content_id:
    'media-source://unifiprotect/nvr001:browse:cam001:smart:recent:30',
  children_media_class: 'video',
  can_play: false,
  can_expand: true,
  thumbnail: null,
  children: [
    {
      title: '2024-11-05T21:35:05.000Z',
      media_class: 'video',
      media_content_type: 'video',
      media_content_id:
        'media-source://unifiprotect/nvr001:event:evt004',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: '/api/unifiprotect/thumbnail/nvr001/evt004',
    },
  ],
};

const createEngine = (options?: {
  browseMediaManager?: BrowseMediaWalker;
  entityRegistryManager?: EntityRegistryManager;
}): UnifiProtectCameraManagerEngine => {
  return new UnifiProtectCameraManagerEngine(
    options?.entityRegistryManager ?? new EntityRegistryManagerMock(),
    mock<StateWatcher>(),
    options?.browseMediaManager ?? new BrowseMediaWalker(),
    new ResolvedMediaCache(),
    new CameraManagerRequestCache(),
  );
};

const cameraEntity = createRegistryEntity({
  entity_id: 'camera.front_door',
  unique_id: 'cam001_high',
  platform: 'unifiprotect',
  config_entry_id: 'nvr001',
});

const createPopulatedEngine = (): UnifiProtectCameraManagerEngine => {
  const entityRegistryManager = new EntityRegistryManagerMock([cameraEntity]);
  return createEngine({ entityRegistryManager });
};

const createStoreWithProtectCamera = async (
  engine: UnifiProtectCameraManagerEngine,
): Promise<CameraManagerStore> => {
  const store = new CameraManagerStore();
  const camera = await engine.createCamera(
    createHASS(),
    createCameraConfig({ camera_entity: 'camera.front_door', id: 'front_door' }),
  );
  store.addCamera(camera);
  return store;
};

// =========================
// Engine instantiation tests
// =========================

describe('UnifiProtectCameraManagerEngine', () => {
  it('should return the correct engine type', () => {
    const engine = createEngine();
    expect(engine.getEngineType()).toBe(Engine.UnifiProtect);
  });

  it('should return camera metadata with engineIcon', () => {
    const engine = createEngine();
    const hass = createHASS();
    const config = createCameraConfig({ camera_entity: 'camera.front_door' });
    const metadata = engine.getCameraMetadata(hass, config);
    expect(metadata.engineIcon).toBe('unifiprotect');
  });

  it('should create camera as EntityCamera', async () => {
    const engine = createPopulatedEngine();
    const config = createCameraConfig({
      camera_entity: 'camera.front_door',
    });
    const camera = await engine.createCamera(createHASS(), config);
    expect(camera.getConfig()).toBe(config);
    expect(camera.getEngine()).toBe(engine);
  });
});

// ========================================
// Query results classifier tests
// ========================================

describe('UnifiProtectQueryResultsClassifier', () => {
  it('should identify UniFi Protect event query results', () => {
    const results: UnifiProtectEventQueryResults = {
      type: QueryResultsType.Event,
      engine: Engine.UnifiProtect,
      browseMedia: [],
    };
    expect(
      UnifiProtectQueryResultsClassifier.isUnifiProtectEventQueryResults(results),
    ).toBe(true);
  });

  it('should reject non-UniFi Protect results', () => {
    const results = {
      type: QueryResultsType.Event,
      engine: Engine.Reolink,
    };
    expect(
      UnifiProtectQueryResultsClassifier.isUnifiProtectEventQueryResults(results),
    ).toBe(false);
  });

  it('should reject non-event results', () => {
    const results = {
      type: QueryResultsType.Recording,
      engine: Engine.UnifiProtect,
    };
    expect(
      UnifiProtectQueryResultsClassifier.isUnifiProtectEventQueryResults(results),
    ).toBe(false);
  });
});

// ========================================
// parseMediaSourceId tests
// ========================================

describe('parseMediaSourceId', () => {
  it('should parse a valid motion URI', () => {
    const uri =
      'media-source://unifiprotect/abc123:browse:cam456:motion:recent:30';
    const result = parseMediaSourceId(uri);
    expect(result).toEqual({
      nvrId: 'abc123',
      cameraId: 'cam456',
      eventType: 'motion',
      timeRange: 'recent',
      days: 30,
    });
  });

  it('should parse a valid smart URI', () => {
    const uri =
      'media-source://unifiprotect/nvr-001:browse:cam-002:smart:recent:7';
    const result = parseMediaSourceId(uri);
    expect(result).toEqual({
      nvrId: 'nvr-001',
      cameraId: 'cam-002',
      eventType: 'smart',
      timeRange: 'recent',
      days: 7,
    });
  });

  it('should parse a valid ring URI', () => {
    const uri =
      'media-source://unifiprotect/nvr1:browse:doorbell1:ring:recent:14';
    const result = parseMediaSourceId(uri);
    expect(result).toEqual({
      nvrId: 'nvr1',
      cameraId: 'doorbell1',
      eventType: 'ring',
      timeRange: 'recent',
      days: 14,
    });
  });

  it('should parse a valid audio URI', () => {
    const uri =
      'media-source://unifiprotect/nvr1:browse:cam1:audio:recent:1';
    const result = parseMediaSourceId(uri);
    expect(result).toEqual({
      nvrId: 'nvr1',
      cameraId: 'cam1',
      eventType: 'audio',
      timeRange: 'recent',
      days: 1,
    });
  });

  it('should return null for a non-unifiprotect URI', () => {
    const uri = 'media-source://reolink/CAM|abc|0';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for an empty string', () => {
    expect(parseMediaSourceId('')).toBeNull();
  });

  it('should return null for a URI with wrong segment count', () => {
    const uri = 'media-source://unifiprotect/abc123:browse:cam456:motion';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with invalid "browse" keyword', () => {
    const uri =
      'media-source://unifiprotect/abc123:list:cam456:motion:recent:30';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with invalid event type', () => {
    const uri =
      'media-source://unifiprotect/abc123:browse:cam456:unknown:recent:30';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with non-numeric days', () => {
    const uri =
      'media-source://unifiprotect/abc123:browse:cam456:motion:recent:abc';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with zero days', () => {
    const uri =
      'media-source://unifiprotect/abc123:browse:cam456:motion:recent:0';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with negative days', () => {
    const uri =
      'media-source://unifiprotect/abc123:browse:cam456:motion:recent:-5';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with empty nvrId', () => {
    const uri = 'media-source://unifiprotect/:browse:cam456:motion:recent:30';
    expect(parseMediaSourceId(uri)).toBeNull();
  });

  it('should return null for a URI with empty cameraId', () => {
    const uri = 'media-source://unifiprotect/abc123:browse::motion:recent:30';
    expect(parseMediaSourceId(uri)).toBeNull();
  });
});

// ========================================
// buildMediaSourceId tests
// ========================================

describe('buildMediaSourceId', () => {
  it('should build a basic URI', () => {
    const uri = buildMediaSourceId('nvr1', 'cam1', 'motion', 30);
    expect(uri).toBe(
      'media-source://unifiprotect/nvr1:browse:cam1:motion:recent:30',
    );
  });

  it('should use default days parameter of 30', () => {
    const uri = buildMediaSourceId('nvr1', 'cam1', 'smart');
    expect(uri).toBe(
      'media-source://unifiprotect/nvr1:browse:cam1:smart:recent:30',
    );
  });

  it('should build a URI with custom days', () => {
    const uri = buildMediaSourceId('nvr1', 'cam1', 'ring', 7);
    expect(uri).toBe(
      'media-source://unifiprotect/nvr1:browse:cam1:ring:recent:7',
    );
  });

  it('should round-trip through parseMediaSourceId', () => {
    const uri = buildMediaSourceId('abc-123', 'def-456', 'audio', 14);
    const parsed = parseMediaSourceId(uri);
    expect(parsed).toEqual({
      nvrId: 'abc-123',
      cameraId: 'def-456',
      eventType: 'audio',
      timeRange: 'recent',
      days: 14,
    });
  });
});

// ========================================
// getEvents tests
// ========================================

describe('getEvents', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('should get no event for unsupported features', () => {
    it.each([
      ['with favorite', { favorite: true }],
      ['with tags', { tags: new Set(['gate']) }],
      ['with what', { what: new Set(['car']) }],
      ['with where', { where: new Set(['office']) }],
      ['with hasSnapshot', { hasSnapshot: true }],
    ])('%s', async (_name: string, query: Partial<EventQuery>) => {
      const engine = createEngine();
      expect(
        await engine.getEvents(createHASS(), createStore(), {
          ...query,
          cameraIDs: new Set(['front_door']),
          type: QueryType.Event,
        }),
      ).toBeNull();
    });
  });

  it('should get events successfully without cache', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    // The engine queries both motion and smart event types.
    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce(TEST_MOTION_EVENTS)
      .mockResolvedValueOnce(TEST_SMART_EVENTS);

    const events = await engine.getEvents(
      createHASS(),
      store,
      {
        type: QueryType.Event,
        cameraIDs: new Set(['front_door']),
        start: new Date('2024-11-05T21:00:00.000Z'),
        end: new Date('2024-11-05T22:00:00.000Z'),
      },
      {
        useCache: false,
      },
    );

    expect(events).toBeTruthy();
    const entries = Array.from(events!.entries());
    expect(entries.length).toBe(1);

    const [resultQuery, resultData] = entries[0];
    expect(resultQuery.type).toBe('event-query');
    expect(resultData.engine).toBe('unifiprotect');
    expect(resultData.type).toBe('event-results');

    // Should have events from both motion and smart queries that fall within range.
    const browseMedia = (resultData as UnifiProtectEventQueryResults).browseMedia;
    expect(browseMedia.length).toBeGreaterThan(0);

    // All returned events should have metadata with dates.
    for (const media of browseMedia) {
      expect(media._metadata).toBeTruthy();
      expect(media._metadata?.cameraID).toBe('front_door');
      expect(media._metadata?.startDate).toBeInstanceOf(Date);
    }
  });

  it('should cache event requests', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce(TEST_MOTION_EVENTS)
      .mockResolvedValueOnce(TEST_SMART_EVENTS);

    for (let i = 0; i < 10; i++) {
      await engine.getEvents(
        createHASS(),
        store,
        {
          type: QueryType.Event,
          cameraIDs: new Set(['front_door']),
          start: new Date('2024-11-05T21:00:00.000Z'),
          end: new Date('2024-11-05T22:00:00.000Z'),
        },
        {
          useCache: true,
        },
      );
    }

    // Should only call WS request twice (once for motion, once for smart),
    // then use cache for subsequent calls.
    expect(homeAssistantWSRequest).toHaveBeenCalledTimes(2);
  });

  it('should request correct media source URIs', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce(TEST_MOTION_EVENTS)
      .mockResolvedValueOnce(TEST_SMART_EVENTS);

    const hass = createHASS();
    await engine.getEvents(
      hass,
      store,
      {
        type: QueryType.Event,
        cameraIDs: new Set(['front_door']),
      },
      { useCache: false },
    );

    // Should request motion events.
    expect(homeAssistantWSRequest).toHaveBeenCalledWith(
      hass,
      browseMediaSchema,
      expect.objectContaining({
        media_content_id:
          'media-source://unifiprotect/nvr001:browse:cam001:motion:recent:30',
      }),
    );

    // Should request smart events.
    expect(homeAssistantWSRequest).toHaveBeenCalledWith(
      hass,
      browseMediaSchema,
      expect.objectContaining({
        media_content_id:
          'media-source://unifiprotect/nvr001:browse:cam001:smart:recent:30',
      }),
    );
  });

  it('should return empty results for non-EntityCamera', async () => {
    const engine = createPopulatedEngine();

    const store = new CameraManagerStore();
    store.addCamera(
      await createInitializedCamera(
        createCameraConfig({ id: 'front_door' }),
        engine,
      ),
    );

    const events = await engine.getEvents(createHASS(), store, {
      type: QueryType.Event,
      cameraIDs: new Set(['front_door']),
    });

    expect(events).toEqual(
      new Map([
        [
          {
            cameraIDs: new Set(['front_door']),
            type: 'event-query',
          },
          {
            browseMedia: [],
            engine: 'unifiprotect',
            type: 'event-results',
          },
        ],
      ]),
    );
  });

  it('should return empty results for camera without config_entry_id', async () => {
    const entity = createRegistryEntity({
      entity_id: 'camera.front_door',
      unique_id: 'cam001_high',
      platform: 'unifiprotect',
      config_entry_id: null,
    });
    const entityRegistryManager = new EntityRegistryManagerMock([entity]);
    const engine = createEngine({ entityRegistryManager });
    const store = await createStoreWithProtectCamera(engine);

    const events = await engine.getEvents(createHASS(), store, {
      type: QueryType.Event,
      cameraIDs: new Set(['front_door']),
    });

    expect(events).toEqual(
      new Map([
        [
          {
            cameraIDs: new Set(['front_door']),
            type: 'event-query',
          },
          {
            browseMedia: [],
            engine: 'unifiprotect',
            type: 'event-results',
          },
        ],
      ]),
    );
  });

  it('should return empty results for camera without unique_id', async () => {
    const entity = createRegistryEntity({
      entity_id: 'camera.front_door',
      platform: 'unifiprotect',
      config_entry_id: 'nvr001',
      // No unique_id provided.
    });
    const entityRegistryManager = new EntityRegistryManagerMock([entity]);
    const engine = createEngine({ entityRegistryManager });
    const store = await createStoreWithProtectCamera(engine);

    const events = await engine.getEvents(createHASS(), store, {
      type: QueryType.Event,
      cameraIDs: new Set(['front_door']),
    });

    expect(events).toEqual(
      new Map([
        [
          {
            cameraIDs: new Set(['front_door']),
            type: 'event-query',
          },
          {
            browseMedia: [],
            engine: 'unifiprotect',
            type: 'event-results',
          },
        ],
      ]),
    );
  });

  it('should handle empty browse media results', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce({
        ...TEST_MOTION_EVENTS,
        children: [],
      })
      .mockResolvedValueOnce({
        ...TEST_SMART_EVENTS,
        children: [],
      });

    const events = await engine.getEvents(
      createHASS(),
      store,
      {
        type: QueryType.Event,
        cameraIDs: new Set(['front_door']),
      },
      { useCache: false },
    );

    expect(events).toEqual(
      new Map([
        [
          {
            cameraIDs: new Set(['front_door']),
            type: 'event-query',
          },
          {
            browseMedia: [],
            engine: 'unifiprotect',
            type: 'event-results',
          },
        ],
      ]),
    );
  });

  it('should ignore events with unparseable titles', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce({
        ...TEST_MOTION_EVENTS,
        children: [
          {
            title: 'INVALID_DATE_STRING',
            media_class: 'video',
            media_content_type: 'video',
            media_content_id: 'media-source://unifiprotect/nvr001:event:evtbad',
            children_media_class: null,
            can_play: true,
            can_expand: false,
            thumbnail: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...TEST_SMART_EVENTS,
        children: [],
      });

    const events = await engine.getEvents(
      createHASS(),
      store,
      {
        type: QueryType.Event,
        cameraIDs: new Set(['front_door']),
      },
      { useCache: false },
    );

    // Events with unparseable titles get null metadata, and since
    // isMediaWithinDates requires startDate/endDate, they won't match.
    const browseMedia = (
      Array.from(events!.values())[0] as UnifiProtectEventQueryResults
    ).browseMedia;
    expect(browseMedia.length).toBe(0);
  });

  it('should sort events by most recent first', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce(TEST_MOTION_EVENTS)
      .mockResolvedValueOnce({
        ...TEST_SMART_EVENTS,
        children: [],
      });

    const events = await engine.getEvents(
      createHASS(),
      store,
      {
        type: QueryType.Event,
        cameraIDs: new Set(['front_door']),
      },
      { useCache: false },
    );

    const browseMedia = (
      Array.from(events!.values())[0] as UnifiProtectEventQueryResults
    ).browseMedia;

    // Verify descending order.
    for (let i = 0; i < browseMedia.length - 1; i++) {
      const current = browseMedia[i]._metadata?.startDate?.getTime() ?? 0;
      const next = browseMedia[i + 1]._metadata?.startDate?.getTime() ?? 0;
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });
});

// ========================================
// generateMediaFromEvents tests
// ========================================

describe('generateMediaFromEvents', () => {
  it('should generate media successfully', () => {
    const query: EventQuery = {
      type: QueryType.Event,
      cameraIDs: new Set(['front_door']),
      start: new Date('2024-11-05T21:00:00.000Z'),
      end: new Date('2024-11-05T22:00:00.000Z'),
    };

    const results: UnifiProtectEventQueryResults = {
      browseMedia: [
        {
          _metadata: {
            cameraID: 'front_door',
            endDate: new Date('2024-11-05T21:23:53.000Z'),
            startDate: new Date('2024-11-05T21:23:53.000Z'),
          },
          can_expand: false,
          can_play: true,
          children_media_class: null,
          media_class: 'video',
          media_content_id:
            'media-source://unifiprotect/nvr001:event:evt001',
          media_content_type: 'video',
          thumbnail: '/api/unifiprotect/thumbnail/nvr001/evt001',
          title: '2024-11-05T21:23:53.000Z',
        },
      ],
      engine: Engine.UnifiProtect,
      type: QueryResultsType.Event,
    };

    const store = new CameraManagerStore();
    const engine = createEngine();
    const media = engine.generateMediaFromEvents(
      createHASS(),
      store,
      query,
      results,
    );
    expect(media?.length).toBe(1);
    expect(media?.[0].getCameraID()).toBe('front_door');
    expect(media?.[0].getStartTime()).toEqual(
      new Date('2024-11-05T21:23:53.000Z'),
    );
    expect(media?.[0].getContentID()).toBe(
      'media-source://unifiprotect/nvr001:event:evt001',
    );
  });

  it('should reject non-unifiprotect results', () => {
    const query: EventQuery = {
      type: QueryType.Event,
      cameraIDs: new Set(['front_door']),
    };

    const results: QueryReturnType<EventQuery> = {
      engine: Engine.Frigate,
      type: QueryResultsType.Event,
    };

    const store = new CameraManagerStore();
    const engine = createEngine();
    const media = engine.generateMediaFromEvents(
      createHASS(),
      store,
      query,
      results,
    );
    expect(media).toBeNull();
  });

  it('should handle empty browse media array', () => {
    const query: EventQuery = {
      type: QueryType.Event,
      cameraIDs: new Set(['front_door']),
    };

    const results: UnifiProtectEventQueryResults = {
      browseMedia: [],
      engine: Engine.UnifiProtect,
      type: QueryResultsType.Event,
    };

    const store = new CameraManagerStore();
    const engine = createEngine();
    const media = engine.generateMediaFromEvents(
      createHASS(),
      store,
      query,
      results,
    );
    expect(media).toEqual([]);
  });
});

// ========================================
// getMediaMetadata tests
// ========================================

describe('getMediaMetadata', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-11-17T15:06:00'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get media metadata successfully', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce(TEST_MOTION_EVENTS)
      .mockResolvedValueOnce(TEST_SMART_EVENTS);

    const metadata = await engine.getMediaMetadata(
      createHASS(),
      store,
      {
        type: QueryType.MediaMetadata,
        cameraIDs: new Set(['front_door']),
      },
      { useCache: false },
    );

    expect(metadata).toBeTruthy();
    const entries = Array.from(metadata!.entries());
    expect(entries.length).toBe(1);

    const [, resultData] = entries[0];
    expect(resultData.engine).toBe('unifiprotect');
    expect(resultData.type).toBe('media-metadata-results');
    expect(resultData.metadata.days).toBeTruthy();
    expect(resultData.metadata.days?.has('2024-11-05')).toBe(true);
  });

  it('should cache media metadata', async () => {
    const engine = createPopulatedEngine();
    const store = await createStoreWithProtectCamera(engine);

    vi.mocked(homeAssistantWSRequest)
      .mockResolvedValueOnce(TEST_MOTION_EVENTS)
      .mockResolvedValueOnce(TEST_SMART_EVENTS);

    for (let i = 0; i < 10; i++) {
      await engine.getMediaMetadata(
        createHASS(),
        store,
        {
          type: QueryType.MediaMetadata,
          cameraIDs: new Set(['front_door']),
        },
        { useCache: true },
      );
    }

    expect(homeAssistantWSRequest).toHaveBeenCalledTimes(2);
  });

  it('should return empty metadata for non-EntityCamera', async () => {
    const engine = createPopulatedEngine();

    const store = new CameraManagerStore();
    store.addCamera(
      await createInitializedCamera(
        createCameraConfig({ id: 'front_door' }),
        engine,
      ),
    );

    const metadata = await engine.getMediaMetadata(createHASS(), store, {
      type: QueryType.MediaMetadata,
      cameraIDs: new Set(['front_door']),
    });

    expect(metadata).toEqual(
      new Map([
        [
          {
            cameraIDs: new Set(['front_door']),
            type: 'media-metadata',
          },
          {
            cached: false,
            engine: 'unifiprotect',
            expiry: new Date('2024-11-17T15:07:00'),
            metadata: {},
            type: 'media-metadata-results',
          },
        ],
      ]),
    );
  });

  it('should return empty metadata for camera without config_entry_id', async () => {
    const entity = createRegistryEntity({
      entity_id: 'camera.front_door',
      unique_id: 'cam001_high',
      platform: 'unifiprotect',
      config_entry_id: null,
    });
    const entityRegistryManager = new EntityRegistryManagerMock([entity]);
    const engine = createEngine({ entityRegistryManager });
    const store = await createStoreWithProtectCamera(engine);

    const metadata = await engine.getMediaMetadata(createHASS(), store, {
      type: QueryType.MediaMetadata,
      cameraIDs: new Set(['front_door']),
    });

    expect(metadata).toEqual(
      new Map([
        [
          {
            cameraIDs: new Set(['front_door']),
            type: 'media-metadata',
          },
          {
            cached: false,
            engine: 'unifiprotect',
            expiry: new Date('2024-11-17T15:07:00'),
            metadata: {},
            type: 'media-metadata-results',
          },
        ],
      ]),
    );
  });
});
