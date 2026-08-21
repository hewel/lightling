import * as IDB from 'idb';

import type { TranslationMemoryEntry } from '@/lib/pageTranslation/protocol';

interface PageTranslationMemoryDB extends IDB.DBSchema {
  entries: {
    key: string;
    value: TranslationMemoryEntry;
    indexes: {
      lastUsedAt: number;
    };
  };
}

export class PageTranslationMemory {
  public static clearPersistent(): Promise<void> {
    return IDB.deleteDB('pageTranslationMemory');
  }

  private readonly session = new Map<string, TranslationMemoryEntry>();
  private dbPromise: Promise<IDB.IDBPDatabase<PageTranslationMemoryDB>> | null = null;

  constructor(private readonly sessionLimit = 1000) {}

  private getDB(): Promise<IDB.IDBPDatabase<PageTranslationMemoryDB>> {
    if (this.dbPromise === null) {
      const pending = IDB.openDB<PageTranslationMemoryDB>('pageTranslationMemory', 1, {
        upgrade(db) {
          const entries = db.createObjectStore('entries', { keyPath: 'key' });
          entries.createIndex('lastUsedAt', 'lastUsedAt');
        },
      }).catch((error) => {
        if (this.dbPromise === pending) this.dbPromise = null;
        throw error;
      });
      this.dbPromise = pending;
    }
    return this.dbPromise;
  }

  private remember(entry: TranslationMemoryEntry): void {
    this.session.delete(entry.key);
    this.session.set(entry.key, entry);
    while (this.session.size > this.sessionLimit) {
      const oldest = this.session.keys().next().value;
      if (oldest === undefined) break;
      this.session.delete(oldest);
    }
  }

  public async get(key: string): Promise<TranslationMemoryEntry | null> {
    const sessionEntry = this.session.get(key);
    if (sessionEntry !== undefined) {
      const touched = { ...sessionEntry, lastUsedAt: Date.now() };
      this.remember(touched);
      return touched;
    }

    const db = await this.getDB();
    const entry = await db.get('entries', key);
    if (entry === undefined) return null;
    const touched = { ...entry, lastUsedAt: Date.now() };
    this.remember(touched);
    void db.put('entries', touched);
    return touched;
  }

  public async set(entry: TranslationMemoryEntry): Promise<void> {
    this.remember(entry);
    const db = await this.getDB();
    await db.put('entries', entry);
  }

  public clearSession(): void {
    this.session.clear();
  }
  public async close(): Promise<void> {
    const pending = this.dbPromise;
    this.dbPromise = null;
    if (pending !== null) (await pending).close();
  }
}
