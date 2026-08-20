import type { EventPayload } from '.';

export const telemetry = {
  track: (_eventName: string, _props?: EventPayload) => undefined,
};
