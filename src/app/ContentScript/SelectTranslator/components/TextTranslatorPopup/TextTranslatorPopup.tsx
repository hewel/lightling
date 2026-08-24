import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';

import { Modal } from '@/components/primitives/Modal/Modal.bundle/desktop';
import { Popup } from '@/components/primitives/Popup/Popup';
import { isMobileBrowser } from '@/lib/browser';
import LogoElement from '@/res/logo-icon.svg';

import {
  TextTranslator,
  TextTranslatorComponentProps,
} from './TextTranslator/TextTranslator';
import { fixPosToPreventOverflow } from './TextTranslatorPopup.utils/fixPosToPreventOverflow';

const styles = stylex.create({
  root: {
    pointerEvents: 'all',
  },
  desktop: {
    position: 'absolute',
  },
  grabbing: {
    cursor: 'grabbing',
  },
  translateButton: {
    display: 'block',
    opacity: {
      default: 0.7,
      ':hover': 1,
    },
    width: '1.5rem',
    height: '1.5rem',
  },
  mobileTable: {
    maxWidth: '100%',
  },
  mobileContent: {
    display: 'block',
  },
});

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
  draggablePopup?: boolean;
  closeHandler: () => void;
}

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
  draggablePopup = false,
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

  const isMobile = useMemo(() => isMobileBrowser(), []);

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    updateHook();
  }, [dragOffset, updateHook]);

  const cursorRef = useRef<HTMLDivElement>(null);
  const cursorStyle: React.CSSProperties = useMemo(() => {
    const { left, top } = fixPosToPreventOverflow(x + dragOffset.x, y + dragOffset.y);

    return {
      position: 'absolute',
      left: left + 'px',
      top: top + 'px',
      width: '0px',
      height: '0px',
      pointerEvents: 'none',
      visibility: 'hidden',
    };
  }, [x, y, dragOffset]);

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

  const handlePointerDown = useCallback(
    (evt: React.PointerEvent<HTMLDivElement>) => {
      if (!draggablePopup || !translating || isMobile || evt.button !== 0) {
        return;
      }

      const target =
        evt.target instanceof Element
          ? evt.target
          : (evt.target as Node | null)?.parentElement;
      if (!target) return;

      if (
        target.closest(
          'button, a, input, textarea, select, [role="button"], [role="option"], [role="listbox"], [contenteditable="true"], p, svg',
        )
      ) {
        return;
      }

      dragOriginRef.current = {
        x: evt.clientX - dragOffset.x,
        y: evt.clientY - dragOffset.y,
      };
      setIsDragging(true);
      containerRef.current?.setPointerCapture(evt.pointerId);
      evt.preventDefault();
    },
    [draggablePopup, translating, isMobile, dragOffset.x, dragOffset.y],
  );

  const handlePointerMove = useCallback((evt: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current) return;

    setDragOffset({
      x: evt.clientX - dragOriginRef.current.x,
      y: evt.clientY - dragOriginRef.current.y,
    });
  }, []);

  const handlePointerUp = useCallback((evt: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current) return;

    dragOriginRef.current = null;
    setIsDragging(false);
    if (containerRef.current?.hasPointerCapture(evt.pointerId)) {
      containerRef.current.releasePointerCapture(evt.pointerId);
    }
  }, []);

  const handlePointerCancel = useCallback((evt: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current) return;

    dragOriginRef.current = null;
    setIsDragging(false);
    if (containerRef.current?.hasPointerCapture(evt.pointerId)) {
      containerRef.current.releasePointerCapture(evt.pointerId);
    }
  }, []);

  const content = (
    <div
      tabIndex={0}
      ref={containerRef}
      {...stylex.props(isDragging && styles.grabbing)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
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
          <LogoElement {...stylex.props(styles.translateButton)} />
        </div>
      )}
    </div>
  );

  // Mobile view
  if (isMobile && translating) {
    return (
      <div {...stylex.props(styles.root)}>
        <Modal
          view="default"
          visible
          preventBodyScroll
          zIndex={zIndex}
          tableXstyle={styles.mobileTable}
          contentXstyle={styles.mobileContent}
        >
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
      <div {...stylex.props(styles.root, styles.desktop)}>
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
