import { Hash, Volume2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { DiscordCategory, DiscordChannel } from "@/types";
import { cn } from "@/lib/utils";

interface ChannelListProps {
    categories: DiscordCategory[];
    uncategorized: DiscordChannel[];
    onChannelClick?: (channel: DiscordChannel) => void;
}

export function ChannelList({
    categories,
    uncategorized,
    onChannelClick,
}: ChannelListProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
        new Set(categories.map((c) => c.id)),
    );

    const toggleCategory = (categoryId: string) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);
            next.has(categoryId) ? next.delete(categoryId) : next.add(categoryId);
            return next;
        });
    };

    return (
        <div className="space-y-1">
            {categories.map((category) => (
                <div key={category.id}>
                    <button
                        onClick={() => toggleCategory(category.id)}
                        className="w-full flex items-center gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wide"
                    >
                        {expandedCategories.has(category.id) ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronRight className="h-3 w-3" />
                        )}
                        {category.name}
                    </button>
                    {expandedCategories.has(category.id) && (
                        <div className="space-y-0.5">
                            {category.channels.map((channel) => (
                                <ChannelItem
                                    key={channel.id}
                                    channel={channel}
                                    onClick={onChannelClick}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {uncategorized.length > 0 && (
                <div className="space-y-0.5">
                    {uncategorized.map((channel) => (
                        <ChannelItem
                            key={channel.id}
                            channel={channel}
                            onClick={onChannelClick}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ChannelItem({
    channel,
    onClick,
}: {
    channel: DiscordChannel;
    onClick?: (channel: DiscordChannel) => void;
}) {
    return (
        <button
            onClick={() => onClick?.(channel)}
            className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent/50 text-left group",
                "text-muted-foreground hover:text-foreground transition-colors",
            )}
            title={`Channel ID: ${channel.id}`}
        >
            {channel.type === "Voice" ? (
                <Volume2 className="h-4 w-4 flex-shrink-0" />
            ) : (
                <Hash className="h-4 w-4 flex-shrink-0" />
            )}
            <span className="truncate">{channel.name}</span>
        </button>
    );
}
