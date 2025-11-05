import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageSquare, Users, Hash, Settings, RefreshCw } from "lucide-react";

interface QuickActionsProps {
    guildId: string | null;
    onAction: (action: string, guildId: string) => void;
    onRefresh: () => void;
}

export function QuickActions({
    guildId,
    onAction,
    onRefresh,
}: QuickActionsProps) {
    const actions = [
        {
            icon: MessageSquare,
            label: "Send Message",
            action: "send_message",
            description: "Send a message to a channel",
        },
        {
            icon: Hash,
            label: "List Channels",
            action: "list_channels",
            description: "View all server channels",
        },
        {
            icon: Users,
            label: "Server Info",
            action: "server_info",
            description: "Get server statistics",
        },
        {
            icon: Settings,
            label: "Manage Server",
            action: "manage",
            description: "Server management options",
        },
    ];

    return (
        <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Quick Actions</h3>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onRefresh}
                    title="Refresh"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {actions.map((item) => {
                    const Icon = item.icon;
                    return (
                        <Button
                            key={item.action}
                            variant="outline"
                            size="sm"
                            className="h-auto flex-col gap-1.5 py-3"
                            onClick={() =>
                                guildId && onAction(item.action, guildId)
                            }
                            disabled={!guildId}
                            title={item.description}
                        >
                            <Icon className="h-4 w-4" />
                            <span className="text-xs">{item.label}</span>
                        </Button>
                    );
                })}
            </div>
        </Card>
    );
}
