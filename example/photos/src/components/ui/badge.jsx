/* eslint-disable react-refresh/only-export-components -- shadcn-style variants */
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/40',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[#3B82F6]/20 text-[#93C5FD] hover:bg-[#3B82F6]/30',
        outline: 'border-white/20 text-slate-300',
        accent:
          'border-orange-500/30 bg-orange-500/10 text-orange-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
