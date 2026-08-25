import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import styles from './Button.module.css';

const VARIANT_CLASS = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
};

const SIZE_CLASS = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
};

export default function Button({
  variant = 'primary',
  size = 'md',
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  loading = false,
  fullWidth = false,
  href,
  className = '',
  children,
  disabled,
  ...rest
}) {
  const classes = [
    styles.button,
    VARIANT_CLASS[variant] || styles.primary,
    SIZE_CLASS[size] || styles.md,
    fullWidth ? styles.fullWidth : '',
    className,
  ].filter(Boolean).join(' ');

  const content = (
    <>
      {loading ? <Loader2 size={16} className={styles.spinner} aria-hidden="true" /> : LeftIcon ? <LeftIcon size={16} aria-hidden="true" /> : null}
      <span>{children}</span>
      {!loading && RightIcon ? <RightIcon size={16} aria-hidden="true" /> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-disabled={disabled}>
        {content}
      </Link>
    );
  }

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {content}
    </button>
  );
}
