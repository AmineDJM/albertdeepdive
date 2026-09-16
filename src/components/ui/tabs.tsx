"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-3", className)} {...props} />;
}

function TabsList({ className, variant = "default", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: "default" | "underline" }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        variant === "default"
          ? "inline-flex h-8 w-fit items-center justify-center rounded-md bg-muted p-0.5 text-muted-foreground"
          : "inline-flex h-9 w-full items-center justify-start gap-4 border-b border-border text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent px-2.5 text-[13px] font-medium transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=underline]/tabs:rounded-none",
        "[[data-variant=underline]_&]:h-9 [[data-variant=underline]_&]:flex-none [[data-variant=underline]_&]:rounded-none [[data-variant=underline]_&]:border-0 [[data-variant=underline]_&]:border-b-2 [[data-variant=underline]_&]:px-0.5 [[data-variant=underline]_&]:data-[state=active]:border-brand [[data-variant=underline]_&]:data-[state=active]:bg-transparent [[data-variant=underline]_&]:data-[state=active]:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
