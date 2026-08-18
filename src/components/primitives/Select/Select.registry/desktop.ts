import { Button } from 'react-elegant-ui/esm/components/Button/Button.bundle/desktop';
import { Icon } from 'react-elegant-ui/esm/components/Icon/Icon.bundle/desktop';
import { Menu } from 'react-elegant-ui/esm/components/Menu/Menu.bundle/desktop';
import { SelectList } from 'react-elegant-ui/esm/components/Select/List/Select-List';
import { SelectPopup } from 'react-elegant-ui/esm/components/Select/Popup/Select-Popup';
import { cnSelect } from 'react-elegant-ui/esm/components/Select/Select@desktop';
import { SelectTrigger } from 'react-elegant-ui/esm/components/Select/Trigger/Select-Trigger';
import { withDefaultProps } from 'react-elegant-ui/esm/hocs/withDefaultProps';
import { Registry } from 'react-elegant-ui/esm/lib/di';
import { size } from '@floating-ui/react';

import { Popup } from '../../Popup/Popup';

export const regObjects = {
	Trigger: SelectTrigger,
	Button: withDefaultProps(Button, {
		view: 'default',
		size: 'm',
	}),
	Icon: withDefaultProps(Icon, {
		glyph: 'unfold-more',
		size: 's',
	}),
	PopupComponent: withDefaultProps(Popup, {
		middleware: [
			size({
				padding: 16,
				apply({ availableHeight, elements, rects }) {
					elements.floating.style.minWidth = `${rects.reference.width}px`;
					elements.floating.style.maxHeight = `${Math.max(availableHeight, 200)}px`;
				},
			}),
		],
		view: 'default',
	}),
	Popup: SelectPopup,
	Menu: withDefaultProps(Menu, {
		size: 'm',
		isRenderHidden: true,
	}),
	List: SelectList,
};

export const SelectDesktopRegistry = new Registry({ id: cnSelect() }).fill(regObjects);
