import browser from 'webextension-polyfill';

import { isBackgroundContext } from '.';

describe('isBackgroundContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('ignores non-string background paths returned by Firefox', () => {
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({
      background: {
        scripts: ['background/scripts.js'],
        service_worker: null,
      },
    } as unknown as ReturnType<typeof browser.runtime.getManifest>);
    vi.spyOn(browser.runtime, 'getURL').mockImplementation((path) => {
      if (typeof path !== 'string') {
        throw new TypeError('Incorrect argument types for runtime.getURL.');
      }

      return String(new URL(path, location.href));
    });

    expect(isBackgroundContext()).toBe(true);
  });
});
