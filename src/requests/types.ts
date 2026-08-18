import type { ObservableStore } from '@/lib/store';

// NOTE: probably should make factory builder which control update props and rebuild factories which require changed props
import type { Background } from '../app/Background';
import type { ObservableAsyncStorage } from '../app/ConfigStorage/ConfigStorage';
import type { PageTranslationContext } from '../app/ContentScript/PageTranslationContext';
import type { AppConfigType } from '../types/runtime';

export type RequestHandlerFactoryProps = {
  config: ObservableAsyncStorage<AppConfigType>;
  backgroundContext: Background;
};

export type RequestHandlerFactory<T = RequestHandlerFactoryProps> = (
  props: T,
) => () => void;

export type ClientRequestHandlerFactoryProps = {
  $config: ObservableStore<AppConfigType>;
  pageTranslationContext: PageTranslationContext;
};

export type ClientRequestHandlerFactory = (
  props: ClientRequestHandlerFactoryProps,
) => () => void;
