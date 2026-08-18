import { getMessage } from '../../lib/language';
import { renderPage } from '../../lib/renderPage';

import { OptionsPage } from './layout/OptionsPage';

renderPage({
	PageComponent: OptionsPage,
	title: getMessage('settings_pageTitle'),
});
