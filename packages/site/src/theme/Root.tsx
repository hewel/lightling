import { analyticsContext } from '../components/Analytics/useAnalyticsContext';

const disabledAnalytics = {
  trackEvent: () => undefined,
};

export default function Root({ children }) {
  return (
    <analyticsContext.Provider value={disabledAnalytics}>
      {children}
    </analyticsContext.Provider>
  );
}
