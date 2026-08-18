import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@bem-react/classname';

import { Modal } from '@/components/primitives/Modal/Modal.bundle/desktop';
import { Popup } from '@/components/primitives/Popup/Popup';
import { isMobileBrowser } from '@/lib/browser';
import LogoElement from '@/res/logo-icon.svg';

import {
	TextTranslator,
	TextTranslatorComponentProps,
} from './TextTranslator/TextTranslator';
import { fixPosToPreventOverflow } from './TextTranslatorPopup.utils/fixPosToPreventOverflow';

import './TextTranslatorPopup.css';

export interface TextTranslatorPopupProps extends Omit<
	TextTranslatorComponentProps,
	'updatePopup'
> {
	x: number;
	y: number;
	timeoutForHideButton?: number;
	zIndex?: number;
	quickTranslate?: boolean;
	focusOnTranslateButton?: boolean;

	closeHandler: () => void;
}

const cnTextTranslatorPopup = cn('TextTranslatorPopup');

const isActivationKey = (code: string) =>
	code === 'Enter' || code === 'NumpadEnter' || code === 'Space';

// TODO: split styles
export const TextTranslatorPopup: FC<TextTranslatorPopupProps> = ({
	x,
	y,
	zIndex,
	timeoutForHideButton,
	quickTranslate = false,
	focusOnTranslateButton = false,
	...props
}) => {
	const { closeHandler } = props;

	const [translating, setTranslating] = useState(quickTranslate);

	const doTranslate = useCallback(() => {
		if (!translating) {
			setTranslating(true);
		}
	}, [translating]);

	const isUnmount = useRef(false);
	const autoCloseTimeout = useRef<number | null>(null);

	const toggleAutoclose = useCallback(
		(enable: boolean) => {
			const isEnabled = autoCloseTimeout.current !== null;

			// Skip if same state
			if (enable === isEnabled) return;

			// Clear timeout
			if (autoCloseTimeout.current !== null) {
				window.clearTimeout(autoCloseTimeout.current);
				autoCloseTimeout.current = null;
			}

			if (enable) {
				if (timeoutForHideButton !== undefined && timeoutForHideButton > 0) {
					autoCloseTimeout.current = window.setTimeout(() => {
						if (!isUnmount.current) {
							closeHandler();
						}
					}, timeoutForHideButton);
				}
			}
		},
		[closeHandler, timeoutForHideButton],
	);

	// Init
	useEffect(() => {
		// Enable hide button by timeout if not already translating
		if (!translating) {
			toggleAutoclose(true);
		}

		return () => {
			isUnmount.current = true;
		};
		// oxlint-disable-next-line react/exhaustive-deps
	}, []);

	useEffect(() => {
		if (translating) {
			toggleAutoclose(false);
		}
	}, [toggleAutoclose, translating]);

	const updateRef = useRef<() => void | null>(null);
	const updateHook = useCallback(() => {
		if (updateRef.current) {
			updateRef.current();
		}
	}, []);

	const cursorRef = useRef<HTMLDivElement>(null);
	const cursorStyle: React.CSSProperties = useMemo(() => {
		const { left, top } = fixPosToPreventOverflow(x, y);

		return {
			position: 'absolute',
			left: left + 'px',
			top: top + 'px',
			width: '0px',
			height: '0px',
			pointerEvents: 'none',
			visibility: 'hidden',
		};
	}, [x, y]);

	// Focus on translate button or root node by change `translating` state
	const containerRef = useRef<HTMLDivElement>(null);
	const translateButtonRef = useRef<HTMLDivElement>(null);

	const focusTranslateButton = useCallback(() => {
		if (!translateButtonRef.current) return false;

		const btn = translateButtonRef.current;
		btn.focus();

		// Focus again after loading
		const focusAfterLoad = () => {
			btn.focus();
			btn.removeEventListener('load', focusAfterLoad);
		};

		btn.addEventListener('load', focusAfterLoad);

		return true;
	}, []);

	const focusRootContainer = useCallback(() => {
		if (!containerRef.current) return false;

		containerRef.current.focus();

		return true;
	}, []);

	// Components after render will change position and size,
	// we wait it and update state
	const [isComponentLoaded, setIsComponentLoaded] = useState(false);
	useEffect(() => {
		// Wait 1 frame after render
		requestAnimationFrame(() => {
			setIsComponentLoaded(true);
		});
	}, []);

	// Focus by load component and by change state
	useEffect(() => {
		// Skip if component did not load
		if (!isComponentLoaded) return;

		if (translating) {
			focusRootContainer();
		} else if (focusOnTranslateButton) {
			// Focus on button right after selection
			focusTranslateButton();
		}
	}, [
		isComponentLoaded,
		translating,
		focusOnTranslateButton,
		focusRootContainer,
		focusTranslateButton,
	]);

	const isMobile = useMemo(() => isMobileBrowser(), []);

	const content = (
		<div tabIndex={0} ref={containerRef}>
			{translating ? (
				<TextTranslator {...props} updatePopup={updateHook} />
			) : (
				<div
					tabIndex={0}
					ref={translateButtonRef}
					onKeyDown={(evt) => {
						if (isActivationKey(evt.code)) {
							evt.preventDefault();
							doTranslate();
						}
					}}
					onClick={doTranslate}
					onMouseOver={() => {
						toggleAutoclose(false);
					}}
					onMouseLeave={() => {
						toggleAutoclose(true);
					}}
				>
					<LogoElement className={cnTextTranslatorPopup('TranslateButton')} />
				</div>
			)}
		</div>
	);

	// Mobile view
	if (isMobile && translating) {
		return (
			<div className={cnTextTranslatorPopup({ mobile: true })}>
				<Modal view="default" visible preventBodyScroll zIndex={zIndex}>
					{content}
				</Modal>
			</div>
		);
	}

	// Render div on the coordinates as cursor and attach popup to it
	// We use real component instead virtual because require behavior of `position: absolute` instead `fixed`
	// and implement this logic for virtual component is harder than use real component
	return (
		<>
			{/* Render cursor */}
			<div style={cursorStyle} ref={cursorRef} />

			{/* Render popup attached to cursor */}
			<div className={cnTextTranslatorPopup()}>
				<Popup
					target="anchor"
					anchor={cursorRef}
					visible={true}
					zIndex={zIndex}
					hideWhenDetached={false}
					onClose={closeHandler}
					view={translating ? 'default' : undefined}
					UNSTABLE_updatePosition={updateRef}
				>
					{content}
				</Popup>
			</div>
		</>
	);
};
