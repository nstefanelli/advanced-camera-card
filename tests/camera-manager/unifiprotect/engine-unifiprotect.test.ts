import { describe, expect, it, vi } from 'vitest';
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
import {
  CameraManagerRequestCache,
  Engine,
  QueryResultsType,
} from '../../../src/camera-manager/types';
import { StateWatcher } from '../../../src/card-controller/hass/state-watcher';
import { BrowseMediaWalker } from '../../../src/ha/browse-media/walker';
import { EntityRegistryManager } from '../../../src/ha/registry/entity/types';
import { ResolvedMediaCache } from '../../../src/ha/resolved-media';
import { createHASS, createCameraConfig } from '../../test-utils';

// =========================
// Engine instantiation tests
// =========================

describe('UnifiProtectCameraManagerEngine', () => {
  it('should return the correct engine type', () => {
    const engine = new UnifiProtectCameraManagerEngine(
      mock<EntityRegistryManager>(),
      mock<StateWatcher>(),
      mock<BrowseMediaWalker>(),
      new ResolvedMediaCache(),
      new CameraManagerRequestCache(),
    );
    expect(engine.getEngineType()).toBe(Engine.UnifiProtect);
  });

  it('should return camera metadata with engineIcon', () => {
    const engine = new UnifiProtectCameraManagerEngine(
      mock<EntityRegistryManager>(),
      mock<StateWatcher>(),
      mock<BrowseMediaWalker>(),
      new ResolvedMediaCache(),
      new CameraManagerRequestCache(),
    );
    const hass = createHASS();
    const config = createCameraConfig({ camera_entity: 'camera.front_door' });
    const metadata = engine.getCameraMetadata(hass, config);
    expect(metadata.engineIcon).toBe('unifiprotect');
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
