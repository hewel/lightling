/**
 * Since we may use only one offscreen document, this is a root document,
 * that include another ones as iframes
 */

import { startLocalRuntime } from '@/app/Background/startLocalRuntime';
import { ConfigStorage, ObservableAsyncStorage } from '@/app/ConfigStorage/ConfigStorage';
import { defaultConfig } from '@/config';
import { createPromiseWithControls } from '@/lib/utils/createPromiseWithControls';
import { addRequestHandler, backgroundRuntimeReadyAction } from '@/requests/utils';

import { themeUpdate } from '../../requests/offscreen/theme';

const runtimeReady = createPromiseWithControls();
addRequestHandler(backgroundRuntimeReadyAction, () => runtimeReady.promise);
const createOffscreenWorker = () => {
  const workerIframe = document.createElement('iframe', {});
  workerIframe.src = '/pages/offscreen-documents/worker/worker.html';
  // We set `allow-same-origin` here, to let iframe use extension API for messaging, instead of message with parent with postMessage and just forward messages with extension api here.

  // This iframe contain only trusted code, so we should not have any problems
  workerIframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
  document.body.appendChild(workerIframe);
};

const setupThemeListener = () => {
  const lightThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
  lightThemeQuery.addEventListener('change', (evt) => {
    themeUpdate({ isLight: evt.matches });
  });

  themeUpdate({ isLight: lightThemeQuery.matches });
};

document.addEventListener('DOMContentLoaded', async () => {
  createOffscreenWorker();
  setupThemeListener();

  try {
    const config = new ObservableAsyncStorage(new ConfigStorage(defaultConfig));
    await startLocalRuntime(config);
    runtimeReady.resolve();
  } catch (error) {
    runtimeReady.reject(error);
    throw error;
  }
});
