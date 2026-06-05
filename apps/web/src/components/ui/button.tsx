import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  default:
    'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:bg-slate-300 disabled:text-white disabled:shadow-none',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  outline:
    'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

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
