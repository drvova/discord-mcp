import { Card } from "@/components/ui/card";
import { Bot } from "lucide-react";

const EXAMPLES = [
    { title: "List Channels", description: "Show me all channels in my Discord server" },
    { title: "Send Messages", description: "Send a message to #general channel" },
    { title: "Server Info", description: "Get server statistics and member count" },
    { title: "Manage Roles", description: "Create or assign roles to members" },
];

export function EmptyState() {
    return (
        <div className="flex-1 flex items-center justify-center p-8 bg-muted/20">
            <div className="max-w-3xl w-full space-y-12">
                <div className="text-center space-y-4">
                    <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
                        <Bot className="h-8 w-8 text-primary" />
                    </div>
                    <h1 className="text-5xl font-bold tracking-tight">
                        Discord MCP
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-md mx-auto">
                        Manage your Discord server with natural language commands
                    </p>
                </div>

                <div className="space-y-4">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide text-center">
                        Try asking
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {EXAMPLES.map((example) => (
                            <Card
                                key={example.title}
                                className="p-5 cursor-pointer hover:bg-accent hover:border-primary/50 hover:shadow-md transition-all duration-200 group"
                            >
                                <h3 className="font-semibold text-base mb-2 group-hover:text-primary transition-colors">
                                    {example.title}
                                </h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {example.description}
                                </p>
                            </Card>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
