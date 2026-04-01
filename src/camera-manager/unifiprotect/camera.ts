import { CapabilitiesRaw } from '../../types';
import { EntityCamera, EntityCameraInitializationOptions } from '../entity-camera';

export type UnifiProtectCameraInitializationOptions = EntityCameraInitializationOptions;

export class UnifiProtectCamera extends EntityCamera {
  protected async _getRawCapabilities(
    options: UnifiProtectCameraInitializationOptions,
  ): Promise<CapabilitiesRaw> {
    return {
      ...(await super._getRawCapabilities(options)),
      clips: true,
      snapshots: true,
    };
  }
}
