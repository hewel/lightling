import { getMessage } from '../../lib/language';
import { renderPage } from '../../lib/renderPage';

import { HistoryPage } from './layout/HistoryPage';

renderPage({
	PageComponent: HistoryPage,
	title: getMessage('history_pageTitle'),
});
