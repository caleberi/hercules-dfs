import * as React from 'react';
import { cn } from '@/lib/utils';

const Progress = React.forwardRef(({ className, value = 0, ...props }, ref) => (
  <div
    ref={ref}
    role="progressbar"
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={100}
    className={cn(
      'relative h-2 w-full overflow-hidden rounded-full bg-white/10',
      className
    )}
    {...props}
  >
    <div
      className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#60A5FA] transition-all duration-300"
      style={{
        width: `${Math.min(100, Math.max(0, typeof value === 'number' ? value : 0))}%`,
      }}
    />
  </div>
));
Progress.displayName = 'Progress';

export { Progress };
