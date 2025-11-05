export interface DiscordChannel {
    id: string;
    name: string;
    type: string;
    categoryId?: string;
    position?: number;
}

export interface DiscordCategory {
    id: string;
    name: string;
    channels: DiscordChannel[];
    position?: number;
}

export interface DiscordGuild {
    id: string;
    name: string;
    memberCount: number;
    channelCount: number;
    createdAt: string;
    icon?: string;
}

export interface DiscordMember {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    nickname?: string;
    roles: string[];
}

export interface DiscordRole {
    id: string;
    name: string;
    color: string;
    position: number;
    permissions: string;
}

export interface ChannelStructure {
    categories: DiscordCategory[];
    uncategorizedChannels: DiscordChannel[];
}

export interface DiscordEmoji {
    id: string;
    name: string;
    animated: boolean;
    url: string;
    usage: string;
    creator?: string;
}

export interface DiscordSticker {
    id: string;
    name: string;
    description: string;
    tags: string;
    format: number;
    url: string;
    creator?: string;
}

export interface TenorGif {
    id: string;
    title: string;
    url: string;
    preview: string;
    width: number;
    height: number;
}
