import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-400',
  ghost: 'bg-transparent text-neutral-700 hover:bg-neutral-100',
  outline: 'border border-neutral-200 bg-transparent text-neutral-900 hover:bg-neutral-100',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

const baseClasses =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 disabled:pointer-events-none';

/**
 * Class-string helper for composing button-shaped elements (e.g. shadcn
 * AlertDialogAction). Mirrors the canonical `buttonVariants` from
 * shadcn/ui but uses our own variant table.
 */
export function buttonVariants({
  variant = 'default',
  size = 'default',
}: { variant?: ButtonProps['variant']; size?: ButtonProps['size'] } = {}): string {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size]);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';
