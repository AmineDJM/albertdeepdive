import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        brand: "bg-brand text-white shadow-xs hover:bg-brand/90",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline: "border border-border bg-card shadow-xs hover:bg-muted hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-[>svg]:px-1.5",
        sm: "h-7 gap-1 rounded-md px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-10 rounded-full px-5 text-sm has-[>svg]:px-4",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-xs": "size-6 rounded-sm",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean }) {
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button data-slot="button" className={cn(buttonVariants({ variant, size, className }))} disabled={props.disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
