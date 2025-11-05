import type {
    DiscordGuild,
    ChannelStructure,
    DiscordEmoji,
    DiscordSticker,
} from "@/types";

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

export async function fetchEmojis(guildId: string): Promise<DiscordEmoji[]> {
    const response = await fetch(`/api/discord/guilds/${guildId}/emojis`);
    if (!response.ok) throw new Error("Failed to fetch emojis");
    return response.json();
}

export async function fetchStickers(
    guildId: string,
): Promise<DiscordSticker[]> {
    const response = await fetch(`/api/discord/guilds/${guildId}/stickers`);
    if (!response.ok) throw new Error("Failed to fetch stickers");
    return response.json();
}

export async function searchTenorGifs(
    query: string,
): Promise<import("@/types").TenorGif[]> {
    const response = await fetch(
        `/api/tenor/search?q=${encodeURIComponent(query)}&limit=30`,
    );
    if (!response.ok) throw new Error("Failed to search GIFs");
    return response.json();
}

export async function fetchFeaturedGifs(): Promise<
    import("@/types").TenorGif[]
> {
    const response = await fetch("/api/tenor/featured?limit=30");
    if (!response.ok) throw new Error("Failed to fetch featured GIFs");
    return response.json();
}
