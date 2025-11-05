import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, X } from "lucide-react";
import { ChannelList, QuickActions } from "@/components/discord";
import type { DiscordGuild, DiscordChannel } from "@/types";
import { cn } from "@/lib/utils";

interface DiscordPanelProps {
    guilds: DiscordGuild[];
    selectedGuildId: string | null;
    selectedChannelId?: string | null;
    onSelectGuild: (guildId: string) => void;
    channelStructure: {
        categories: any[];
        uncategorizedChannels: any[];
    } | null;
    loading: boolean;
    isOpen: boolean;
    onClose: () => void;
    onQuickAction: (action: string, guildId: string) => void;
    onChannelClick: (channel: DiscordChannel) => void;
    onRefresh: () => void;
}

export function DiscordPanel({
    guilds,
    selectedGuildId,
    selectedChannelId,
    onSelectGuild,
    channelStructure,
    loading,
    isOpen,
    onClose,
    onQuickAction,
    onChannelClick,
    onRefresh,
}: DiscordPanelProps) {
    const selectedGuild = guilds.find((g) => g.id === selectedGuildId);

    return (
        <>
            {isOpen && (
                <div
                    className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
                    onClick={onClose}
                />
            )}

            <div
                className={cn(
                    "fixed lg:relative inset-y-0 right-0 z-50 w-80 bg-muted/40 border-l flex flex-col transition-transform lg:translate-x-0",
                    isOpen ? "translate-x-0" : "translate-x-full",
                )}
            >
                <div className="p-4 border-b space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Server className="h-4 w-4 text-primary" />
                            <span className="font-semibold text-base">
                                Discord Server
                            </span>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={onClose}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    {guilds.length > 1 && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                                Select Server
                            </label>
                            <select
                                value={selectedGuildId || ""}
                                onChange={(e) => onSelectGuild(e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-background border rounded-lg"
                            >
                                {guilds.map((guild) => (
                                    <option key={guild.id} value={guild.id}>
                                        {guild.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {selectedGuild && guilds.length === 1 && (
                        <Card className="p-3">
                            <div className="space-y-1">
                                <h3 className="font-semibold text-sm">
                                    {selectedGuild.name}
                                </h3>
                                <div className="text-xs text-muted-foreground space-y-0.5">
                                    <div>
                                        Members: {selectedGuild.memberCount}
                                    </div>
                                    <div>
                                        Channels: {selectedGuild.channelCount}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>

                <ScrollArea className="flex-1 px-4">
                    <div className="py-4 space-y-4">
                        <QuickActions
                            guildId={selectedGuildId}
                            onAction={onQuickAction}
                            onRefresh={onRefresh}
                        />

                        <div className="space-y-2">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">
                                Channels
                            </h3>

                            {loading ? (
                                <div className="text-center py-8 text-sm text-muted-foreground">
                                    Loading channels...
                                </div>
                            ) : channelStructure ? (
                                <ChannelList
                                    categories={channelStructure.categories}
                                    uncategorized={
                                        channelStructure.uncategorizedChannels
                                    }
                                    onChannelClick={onChannelClick}
                                    selectedChannelId={selectedChannelId}
                                />
                            ) : (
                                <div className="text-center py-8 text-sm text-muted-foreground">
                                    No channels found
                                </div>
                            )}
                        </div>
                    </div>
                </ScrollArea>
            </div>
        </>
    );
}
