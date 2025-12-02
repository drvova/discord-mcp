# Messaging Workflow

## Actions via `discord_execute`

| Action | Description | Required Params |
|--------|-------------|-----------------|
| send | Send a message | channelId, content |
| edit | Edit a message | channelId, messageId, content |
| delete | Delete a message | channelId, messageId |
| bulk_delete | Delete multiple messages | channelId, messageIds[] |
| pin | Pin a message | channelId, messageId |
| unpin | Unpin a message | channelId, messageId |
| react | Add reaction | channelId, messageId, emoji |
| unreact | Remove reaction | channelId, messageId, emoji |
| crosspost | Crosspost to followers | channelId, messageId |

## Queries via `discord_query`

| Resource | Filters | Description |
|----------|---------|-------------|
| messages | channelId, limit, before, after | Get message history |
| pinned_messages | channelId | Get pinned messages |
| attachments | channelId, messageId | Get message attachments |

## Examples

### Send with embed
```json
{
  "operation": "message",
  "action": "send",
  "params": {
    "channelId": "123456789",
    "content": "Check this out!",
    "embed": {
      "title": "Announcement",
      "description": "Important update",
      "color": 0x5865F2
    }
  }
}
```

### Send with buttons
```json
{
  "operation": "message",
  "action": "send",
  "params": {
    "channelId": "123456789",
    "content": "Choose an option:",
    "components": [{
      "type": "button",
      "label": "Accept",
      "style": "primary",
      "customId": "accept_btn"
    }]
  }
}
```

### Bulk delete recent messages
```json
{
  "operation": "message",
  "action": "bulk_delete",
  "params": {
    "channelId": "123456789",
    "messageIds": ["msg1", "msg2", "msg3"]
  }
}
```

### Query message history
```json
{
  "resource": "messages",
  "filters": {
    "channelId": "123456789",
    "limit": 100,
    "before": "last_message_id"
  }
}
```

## Private Messages

For DMs, use operation `dm` instead of `message`:

```json
{
  "operation": "dm",
  "action": "send",
  "params": {
    "userId": "user_id_here",
    "content": "Hello via DM!"
  }
}
```
