import * as React from "react"

import { cn } from "@/lib/utils"

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[100px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

