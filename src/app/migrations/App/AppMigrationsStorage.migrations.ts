import { Schema } from 'effect';
import browser from 'webextension-polyfill';

import { createMigrationTask } from '@/lib/migrations/createMigrationTask';
import { decodeStruct, NonNaNNumber } from '@/lib/types';

export const migrationsForMigrationsStorage = createMigrationTask([
  {
    version: 1,
    async migrate() {
      const browserStorageKey = 'migrationsInfo';
      const { [browserStorageKey]: rawData } =
        await browser.storage.local.get(browserStorageKey);

      const legacyStructure = Schema.Struct({
        appConfig: NonNaNNumber,
        autoTranslateDB: NonNaNNumber,
        storageVersions: Schema.Record(Schema.String, NonNaNNumber),
      });

      // Verify data
      const codec = decodeStruct(legacyStructure, rawData);
      if (codec.errors !== null) return;

      const legacyData = codec.data;

      // Pick storages
      const newData = {
        version: 1,
        dataVersions: {
          ...legacyData.storageVersions,
          autoTranslationPreferences: legacyData.autoTranslateDB,
        },
      };

      await browser.storage.local.set({ [browserStorageKey]: newData });
    },
  },
]);
