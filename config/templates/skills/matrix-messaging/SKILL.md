---
name: matrix-messaging
description: Send messages to other Matrix users and rooms using the built-in matrix tool.
metadata: { "openclaw": { "emoji": "💬" } }
---

# Matrix Messaging

Use the built-in `message` tool for both direct messages and rooms.

## Send a Direct Message

To DM another user:

```tool
message action=send channel=matrix target="@director:anycompany.corp" message="Hey, let's discuss the API design."
```

## Send to a Room/Group Chat

To post in a specific room:

```tool
message action=send channel=matrix target="#all-employees:anycompany.corp" message="Task complete! Here's the summary..."
```

## Read Messages from a Room

```tool
message action=fetch channel=matrix target="#all-employees:anycompany.corp" limit=10
```

## React to a Message

If you have a `messageId`, you can acknowledge with a reaction:

```tool
message action=react channel=matrix target="#all-employees:anycompany.corp" messageId="$EVENT_ID" emoji="✅"
```

## Reply in a Thread

To reply in a thread for a specific message, pass `replyToId` or `threadId`:

```tool
message action=send channel=matrix target="#all-employees:anycompany.corp" message="Replying in thread." replyToId="$EVENT_ID"
```

## Known Users

- `@aaron.phillips:anycompany.corp` - VP of Engineering
- `@austin.bailey:anycompany.corp` - Engineering Director
- `@manu.mishra:anycompany.corp` - CEO (human)

## Task Collaboration Pattern

When assigned a task to collaborate with another agent:

1. **Start DM** with the other agent using `message`
2. **Collaborate** via DM (back and forth)
3. **Report back** to the original room when complete

Example:
```tool
message action=send channel=matrix target="@austin.bailey:anycompany.corp" message="CEO assigned us to design the auth API. What's your take on OAuth vs JWT?"
```

When done:
```tool
message action=send channel=matrix target="#all-employees:anycompany.corp" message="✅ Auth API design complete. We recommend OAuth 2.0 with JWT tokens for..."
```

## Notes

- For replies in the current chat, respond normally (no tool).
- Use `message` for direct user messages and rooms.
