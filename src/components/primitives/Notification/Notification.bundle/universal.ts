import { createElement, FC } from 'react';
import { compose, composeU, ExtractProps } from 'react-elegant-ui/lib/compose';

import { withModNotificationTypeDefault } from '../_type/Notification_type_default';
import { Notification as BaseNotification } from '../Notification';

const ComposedNotification = compose(composeU(withModNotificationTypeDefault))(
	BaseNotification,
);

export type INotificationProps = ExtractProps<typeof ComposedNotification>;

export const Notification: FC<INotificationProps> = ({ type = 'default', ...props }) =>
	createElement(ComposedNotification, { ...props, type });
