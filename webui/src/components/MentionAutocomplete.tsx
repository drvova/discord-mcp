import { useEffect, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hash, User, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MentionOption {
    type: "channel" | "user" | "role";
    id: string;
    name: string;
    displayName?: string;
}

interface MentionAutocompleteProps {
    options: MentionOption[];
    position: { top: number; left: number };
    onSelect: (option: MentionOption) => void;
    onClose: () => void;
    filter?: string;
}

export function MentionAutocomplete({
    options,
    position,
    onSelect,
    onClose,
    filter = "",
}: MentionAutocompleteProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const filteredOptions = filter
        ? options.filter((opt) =>
              opt.name.toLowerCase().includes(filter.toLowerCase())
          )
        : options;

    useEffect(() => {
        setSelectedIndex(0);
    }, [filter]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((prev) =>
                        Math.min(prev + 1, filteredOptions.length - 1)
                    );
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (filteredOptions[selectedIndex]) {
                        onSelect(filteredOptions[selectedIndex]);
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    onClose();
                    break;
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [selectedIndex, filteredOptions, onSelect, onClose]);

    useEffect(() => {
        if (listRef.current) {
            const selectedElement = listRef.current.children[
                selectedIndex
            ] as HTMLElement;
            selectedElement?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            });
        }
    }, [selectedIndex]);

    if (filteredOptions.length === 0) {
        return null;
    }

    return (
        <Card
            className="absolute z-50 w-64 shadow-lg border-2"
            style={{
                top: position.top,
                left: position.left,
            }}
        >
            <ScrollArea className="max-h-64">
                <div ref={listRef} className="p-1">
                    {filteredOptions.map((option, index) => (
                        <button
                            key={`${option.type}-${option.id}`}
                            onClick={() => onSelect(option)}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2 text-sm rounded text-left transition-colors",
                                index === selectedIndex
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-accent"
                            )}
                        >
                            {option.type === "channel" && (
                                <Hash className="h-4 w-4 flex-shrink-0" />
                            )}
                            {option.type === "user" && (
                                <User className="h-4 w-4 flex-shrink-0" />
                            )}
                            {option.type === "role" && (
                                <AtSign className="h-4 w-4 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="truncate font-medium">
                                    {option.displayName || option.name}
                                </div>
                                {option.displayName && (
                                    <div className="truncate text-xs opacity-70">
                                        @{option.name}
                                    </div>
                                )}
                            </div>
                            <span className="text-xs opacity-50">
                                {option.type}
                            </span>
                        </button>
                    ))}
                </div>
            </ScrollArea>
        </Card>
    );
}
