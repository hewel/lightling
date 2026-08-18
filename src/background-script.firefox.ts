import { App } from './app';

// Infrastructure: keep the heavy persistent-page runtime in an async chunk;
// Chromium loads the same module in its offscreen document instead.
void App.main(async (config) => {
  const { startLocalRuntime } = await import('./app/Background/startLocalRuntime');
  await startLocalRuntime(config);
});
