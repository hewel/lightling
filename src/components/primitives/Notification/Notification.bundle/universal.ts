import { createElement, FC, ReactNode } from 'react';
import { Banner, BannerProps } from '@astryxdesign/core/Banner';

import {
	notificationTypeDefaultStatus,
	NotificationTypeDefault,
} from '../_type/Notification_type_default';

export interface INotificationProps
	extends NotificationTypeDefault, Omit<BannerProps, 'children' | 'status' | 'title'> {
	children: ReactNode;
}

export const Notification: FC<INotificationProps> = ({
	children,
	type: _type = 'default',
	...props
}) =>
	createElement(Banner, {
		...props,
		status: notificationTypeDefaultStatus,
		title: children,
	});
