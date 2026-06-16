# LinkedIn MCP Server

A Model Context Protocol (MCP) server using the TypeScript SDK for LinkedIn integration. Allows an AI agent (e.g. Claude) to authenticate with LinkedIn and share posts or links, and add comments — including a first comment posted automatically with a share (the recommended place for links, which LinkedIn reach-penalizes in the post body).

## Prerequisites

- Node.js (>=18) and npm
- LinkedIn Developer App:
  - Create an app at https://www.linkedin.com/developers/apps
  - Under "Products", add **Sign In with LinkedIn** (OpenID Connect) and **Share on LinkedIn**
  - **Authorized Redirect URI** must match `.env`: `http://localhost:8000/auth/linkedin/callback`
  - Copy your **Client ID** and **Client Secret** into `.env`

## Setup

```bash
git clone <repo_url>
cd linkedin-mcp
npm install
```

Create a `.env` in project root with:

```env
SESSION_SECRET=your-session-secret
AUTH_PORT=8000          # OAuth callback server port
HTTP_PORT=8001          # HTTP/SSE server port
LINKEDIN_CLIENT_ID=your-client-id
LINKEDIN_CLIENT_SECRET=your-client-secret
LINKEDIN_REDIRECT_URI=http://localhost:8000/auth/linkedin/callback
```

## Running

1. **OAuth Callback Server** (must stay running):
   ```bash
   npm run dev:auth
   ```

2. **MCP Server**:
   - Via Claude Desktop:
     ```bash
     claude-desktop
     ```
   - Or manually:
     ```bash
     npm run dev
     ```
   - This starts stdio transport + HTTP+SSE server.

3. **Inspector UI**:
   ```bash
   npm run build
   npx @modelcontextprotocol/inspector node build/server.js
   ```
   - Open the Inspector in browser → **Tools**
   - Use `linkedin-share-post` or `linkedin-share-link` tools.

## Testing

1. Visit `http://localhost:8000/auth/linkedin` in browser → complete LinkedIn login.
2. Confirm “Authentication successful!”.
3. In Inspector, run sample post/link tools.
4. Verify content on your LinkedIn profile.

## Claude Desktop Integration

1. Run `npm run dev:auth`
2. Visit `http://localhost:8000/auth/linkedin` in browser → complete LinkedIn login.
3. Confirm “Authentication successful!”. A token file should be generated. Do not close this terminal.
4. Open Claude Desktop and verify the tools are listed

Configure your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/absolute/path/to/linkedin-mcp/build/server.js"],
      "transport": "http",
      "url": "http://localhost:8001",
      "sseEndpoint": "/stream",
      "httpEndpoint": "/message",
      "env": {
        "SESSION_SECRET": "your-session-secret",
        "AUTH_PORT": "8000",
        "HTTP_PORT": "8001",
        "LINKEDIN_CLIENT_ID": "your-client-id",
        "LINKEDIN_CLIENT_SECRET": "your-client-secret",
        "LINKEDIN_REDIRECT_URI": "http://localhost:8000/auth/linkedin/callback"
      }
    }
  },
  "globalShortcut": "Ctrl+Space"
}
```
(You can find this file from Claude Desktop by going to settings > developer > edit config)

Save and **restart Claude Desktop** to apply changes.

## Limitations & Roadmap

Known constraints in the current implementation:

- **Personal profile only.** Posts are authored as `urn:li:person:<id>` via the `w_member_social`
  scope. Posting to an organization / company page requires the `w_organization_social` scope, a
  `urn:li:organization:<id>` author, and access to LinkedIn's Community Management API (a separate,
  heavier approval). Not yet supported.
- **Immediate publish only.** Each tool call posts right away. There is no scheduling/queue — to run
  scheduled "drops," wrap the MCP call in an external scheduler (cron, a GitHub Action, etc.).
- **Uses the legacy `/v2/ugcPosts` endpoint.** Still functional, but LinkedIn has deprecated it in
  favor of the versioned `/rest/posts` Posts API (requires a `LinkedIn-Version` header). Migration is
  a TODO — left as-is until it can be tested against a live developer app.
- **No media uploads.** Text and link shares only; image/video assets are not implemented.
- **Single-user token store.** Credentials are persisted to a local `tokenStore.json`; there is no
  multi-account support.

### Refresh tokens

The token refresh path (`refreshAccessToken`) requires your LinkedIn app to issue refresh tokens
(enable "programmatic refresh tokens"). If your app only returns short-lived access tokens, you'll
need to re-run the `/auth/linkedin` flow when the token expires.
