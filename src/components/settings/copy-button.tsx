"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label = "Copy", size = "xs", className }: { value: string; label?: string; size?: "xs" | "sm" | "icon-xs" | "icon-sm"; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the text and copy it manually");
    }
  }
  const iconOnly = size.startsWith("icon");
  return (
    <Button type="button" variant="outline" size={size} onClick={copy} aria-label={label} className={className}>
      {copied ? <Check className="text-success" /> : <Copy />}
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  );
}
