import * as React from "react"
import { cn } from "@/lib/utils"

export interface PromptInputProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  onSubmit?: (value: string) => void
}

const PromptInput = React.forwardRef<HTMLTextAreaElement, PromptInputProps>(
  ({ className, onSubmit, onKeyDown, ...props }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const combinedRef = ref || textareaRef

    // Auto-resize functionality
    React.useEffect(() => {
      const textarea = typeof combinedRef === 'function' ? null : combinedRef.current
      if (textarea) {
        textarea.style.height = 'auto'
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
      }
    }, [props.value, combinedRef])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle Enter to submit (Shift+Enter for new line)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const value = e.currentTarget.value.trim()
        if (value && onSubmit) {
          onSubmit(value)
        }
      }

      // Call custom onKeyDown if provided
      if (onKeyDown) {
        onKeyDown(e)
      }
    }

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget
      target.style.height = 'auto'
      target.style.height = Math.min(target.scrollHeight, 200) + 'px'
    }

    return (
      <textarea
        className={cn(
          "flex min-h-[60px] max-h-[200px] w-full rounded-xl border-2 border-input bg-background px-4 py-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 resize-none transition-all",
          className
        )}
        ref={combinedRef}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        rows={1}
        {...props}
      />
    )
  }
)

PromptInput.displayName = "PromptInput"

export { PromptInput }
