import {
  Children,
  isValidElement,
  type ElementType,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
} from 'react';
import * as AstryxButtonModule from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';

const AstryxButton = AstryxButtonModule.Button;
type AstryxButtonProps = AstryxButtonModule.ButtonProps;

export const defaultProps = {
  as: 'button',
};

type LegacyButtonView = 'action' | 'clear' | 'default' | 'pseudo';
type LegacyButtonSize = 's' | 'm' | 'l';
type LegacyButtonWidth = AstryxButtonProps['width'] | 'max';
type IconProvider = ReactNode | ((className: string) => ReactNode);

export interface IButtonProps extends Omit<
  AstryxButtonProps,
  | 'as'
  | 'children'
  | 'endContent'
  | 'href'
  | 'icon'
  | 'isDisabled'
  | 'label'
  | 'onClick'
  | 'ref'
  | 'size'
  | 'type'
  | 'variant'
  | 'width'
> {
  as?: ElementType;
  addonAfter?: ReactNode;
  addonBefore?: ReactNode;
  children?: ReactNode;
  content?: 'icon';
  disabled?: boolean;
  icon?: IconProvider;
  iconLeft?: IconProvider;
  iconRight?: IconProvider;
  innerRef?: Ref<HTMLButtonElement | HTMLAnchorElement>;
  onClick?: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  onPress?: (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
  preventFocusOnPress?: boolean;
  pressAnimation?: boolean;
  raw?: boolean;
  size?: LegacyButtonSize;
  title?: string;
  type?: 'button' | 'link' | 'reset' | 'submit';
  url?: string;
  view?: LegacyButtonView;
  width?: LegacyButtonWidth;
}

const variants: Record<LegacyButtonView, AstryxButtonProps['variant']> = {
  action: 'primary',
  clear: 'ghost',
  default: 'secondary',
  pseudo: 'ghost',
};

const sizes: Record<LegacyButtonSize, NonNullable<AstryxButtonProps['size']>> = {
  s: 'sm',
  m: 'md',
  l: 'lg',
};

function hasTextContent(content: ReactNode): boolean {
  return Children.toArray(content).some((child) => {
    if (typeof child === 'string' || typeof child === 'number') return true;
    return isValidElement<{ children?: ReactNode }>(child)
      ? hasTextContent(child.props.children)
      : false;
  });
}

function getIcon(icon: IconProvider | undefined): ReactNode {
  return typeof icon === 'function' ? icon('astryx-button-icon') : icon;
}

function getLabel({ children, title, ...props }: IButtonProps): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }

  return title ?? props['aria-label'] ?? 'Action';
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref !== undefined && ref !== null) {
    ref.current = value;
  }
}

/**
 * Compatibility adapter for the extension's legacy Button API.
 *
 * New surfaces should prefer Astryx Button or IconButton directly. This keeps
 * existing callers working while translating their legacy view, size, press,
 * and link props to Astryx's accessible controls.
 */
export function Button({
  addonAfter,
  addonBefore,
  as: renderAs,
  children,
  content,
  disabled = false,
  icon,
  iconLeft,
  iconRight,
  innerRef,
  onClick,
  onMouseDown,
  onPress,
  preventFocusOnPress = false,
  pressAnimation: _pressAnimation,
  raw: _raw,
  size = 'm',
  title,
  type = 'button',
  url,
  view = 'default',
  width,
  ...props
}: IButtonProps) {
  const label = getLabel({ children, title, ...props });
  const leadingIcon = getIcon(iconLeft ?? icon);
  const trailingIcon = getIcon(iconRight);
  const isIconOnly =
    content === 'icon' ||
    ((leadingIcon !== undefined ||
      trailingIcon !== undefined ||
      children !== undefined) &&
      !hasTextContent(children));
  const isLink = type === 'link' || renderAs === 'a' || url !== undefined;
  const handleClick: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement> = (
    event,
  ) => {
    onClick?.(event);
    if (!event.defaultPrevented) onPress?.(event);
  };
  const handleMouseDown: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (preventFocusOnPress) event.preventDefault();
    onMouseDown?.(event);
  };
  const visibleContent =
    addonBefore === undefined && addonAfter === undefined
      ? children
      : [addonBefore, children, addonAfter];
  const commonProps = {
    ...props,
    className: props.className,
    isDisabled: disabled,
    label,
    size: sizes[size],
    style: props.style,
    tooltip: title,
    variant: variants[view],
    width: width === 'max' ? '100%' : width,
  };

  if (isLink) {
    const iconOnlyContent = leadingIcon ?? trailingIcon ?? children;

    return (
      <AstryxButton
        {...commonProps}
        as={typeof renderAs === 'string' ? undefined : renderAs}
        href={url}
        icon={isIconOnly ? iconOnlyContent : leadingIcon}
        isIconOnly={isIconOnly}
        endContent={isIconOnly ? undefined : trailingIcon}
        onClick={handleClick}
        ref={(element) => assignRef(innerRef, element)}
      >
        {isIconOnly ? undefined : visibleContent}
      </AstryxButton>
    );
  }

  if (isIconOnly) {
    return (
      <IconButton
        {...commonProps}
        icon={leadingIcon ?? children}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        ref={(element) => assignRef(innerRef, element)}
        type={type}
      />
    );
  }

  return (
    <AstryxButton
      {...commonProps}
      endContent={trailingIcon}
      icon={leadingIcon}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      ref={(element) => assignRef(innerRef, element)}
      type={type}
    >
      {visibleContent}
    </AstryxButton>
  );
}
