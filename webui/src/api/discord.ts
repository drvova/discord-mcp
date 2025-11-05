import type { DiscordGuild, ChannelStructure } from "@/types";

export async function fetchGuilds(): Promise<DiscordGuild[]> {
    const response = await fetch("/api/discord/guilds");
    if (!response.ok) throw new Error("Failed to fetch guilds");
    return response.json();
}

export async function fetchChannelStructure(
    guildId: string,
): Promise<ChannelStructure> {
    const response = await fetch(
        `/api/discord/guilds/${guildId}/channel-structure`,
    );
    if (!response.ok) throw new Error("Failed to fetch channel structure");
    return response.json();
}

export async function fetchGuildInfo(guildId: string): Promise<string> {
    const response = await fetch(`/api/discord/guilds/${guildId}/info`);
    if (!response.ok) throw new Error("Failed to fetch guild info");
    const data = await response.json();
    return data.info;
}
