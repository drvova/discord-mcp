import { useState, useEffect } from "react";
import { fetchGuilds, fetchChannelStructure } from "@/api/discord";
import type { DiscordGuild, ChannelStructure } from "@/types";

export function useDiscord() {
    const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
    const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
    const [channelStructure, setChannelStructure] =
        useState<ChannelStructure | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadGuilds();
    }, []);

    useEffect(() => {
        if (selectedGuildId) {
            loadChannelStructure(selectedGuildId);
        }
    }, [selectedGuildId]);

    const loadGuilds = async () => {
        try {
            setLoading(true);
            const data = await fetchGuilds();
            setGuilds(data);
            if (data.length > 0 && !selectedGuildId) {
                setSelectedGuildId(data[0].id);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load guilds");
        } finally {
            setLoading(false);
        }
    };

    const loadChannelStructure = async (guildId: string) => {
        try {
            const data = await fetchChannelStructure(guildId);
            setChannelStructure(data);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load channel structure",
            );
        }
    };

    const refresh = () => {
        loadGuilds();
        if (selectedGuildId) {
            loadChannelStructure(selectedGuildId);
        }
    };

    return {
        guilds,
        selectedGuildId,
        setSelectedGuildId,
        channelStructure,
        loading,
        error,
        refresh,
    };
}
