# Webnook Command Builder

Render-ready Node/Express app for block-style Webnook commands.

Message example: when someone says hello, reply hello.
Time example: at 01:30, say a chosen message.

## Render
Use this repository as a Render Web Service. Build: npm install. Start: npm start.

## Webhook
POST /webhook/main with JSON like {"message":"hello","user":"Sam"}.
The response contains matching replies.

## Persistence
This starter stores rules in memory, so they reset on restart. Add Render Postgres later for persistent rules.
