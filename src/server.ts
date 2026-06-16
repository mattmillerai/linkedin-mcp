import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { loadConfig } from './config.js';
import { storedAccessToken, storedUserId, sharePost, shareLink, shareImage, uploadImage, addComment, loadTokenData } from './linkedinApi.js';
import { z } from 'zod';

console.error('▶ cwd:', process.cwd(), 'argv:', process.argv);

async function main() {
  console.error('Starting LinkedIn MCP Server...');
  const config = loadConfig();
  await loadTokenData(); // initialize stored credentials from file

  const server = new McpServer(
    { name: 'linkedin-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.tool(
    'linkedin-share-post',
    'Shares a text post to LinkedIn. Optionally adds a first comment (the recommended place for links, which LinkedIn reach-penalizes in the post body).',
    {
      text: z.string().min(1).describe('The content of the post to share.'),
      firstComment: z
        .string()
        .optional()
        .describe(
          'Optional comment posted immediately on the new post. Put links (blog URL, careers, etc.) here — links in the post body get reach-throttled.'
        ),
    },
    async ({ text, firstComment }) => {
      await loadTokenData();
      if (!storedAccessToken || !storedUserId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Authentication required. Please visit http://localhost:${config.authPort}/auth/linkedin in your browser.`,
            },
          ],
        };
      }
      try {
        const result = await sharePost(storedAccessToken, storedUserId, text);
        let commentNote = '';
        if (firstComment && result.postId) {
          try {
            await addComment(storedAccessToken, storedUserId, result.postId, firstComment);
            commentNote = ' First comment added.';
          } catch (e: any) {
            commentNote = ` (Post published, but the first comment failed: ${e.message})`;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Post shared successfully!${result.postId ? ` (Post ID: ${result.postId})` : ''}${commentNote}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to share post: ${error.message}` }],
        };
      }
    }
  );

  server.tool(
    'linkedin-share-link',
    'Shares a link with commentary to LinkedIn (renders a preview card). Note: a link in the post body is reach-throttled; for a blog share prefer linkedin-share-post with the link in firstComment. Optionally adds a first comment here too.',
    {
      text: z.string().min(1).describe('The commentary text to accompany the link.'),
      url: z.string().url().describe('The URL of the link to share.'),
      firstComment: z
        .string()
        .optional()
        .describe('Optional comment posted immediately on the new post.'),
    },
    async ({ text, url, firstComment }) => {
      await loadTokenData();
      if (!storedAccessToken || !storedUserId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Authentication required. Please visit http://localhost:${config.authPort}/auth/linkedin in your browser.`,
            },
          ],
        };
      }
      try {
        const result = await shareLink(storedAccessToken, storedUserId, text, url);
        let commentNote = '';
        if (firstComment && result.postId) {
          try {
            await addComment(storedAccessToken, storedUserId, result.postId, firstComment);
            commentNote = ' First comment added.';
          } catch (e: any) {
            commentNote = ` (Post published, but the first comment failed: ${e.message})`;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Link shared successfully!${result.postId ? ` (Post ID: ${result.postId})` : ''}${commentNote}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to share link: ${error.message}` }],
        };
      }
    }
  );

  server.tool(
    'linkedin-share-image',
    'Shares a post with a natively-uploaded image (from a URL). Image posts get better reach than body-link posts and show a visual — put any link in firstComment.',
    {
      text: z.string().min(1).describe('The post text.'),
      imageUrl: z.string().url().describe('URL of the image to download and attach natively to the post.'),
      imageAlt: z.string().optional().describe('Alt text for the image (accessibility).'),
      firstComment: z
        .string()
        .optional()
        .describe('Optional comment posted immediately on the new post — the recommended place for links.'),
    },
    async ({ text, imageUrl, imageAlt, firstComment }) => {
      await loadTokenData();
      if (!storedAccessToken || !storedUserId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Authentication required. Please visit http://localhost:${config.authPort}/auth/linkedin in your browser.`,
            },
          ],
        };
      }
      try {
        const asset = await uploadImage(storedAccessToken, storedUserId, imageUrl);
        const result = await shareImage(storedAccessToken, storedUserId, text, asset, imageAlt);
        let commentNote = '';
        if (firstComment && result.postId) {
          try {
            await addComment(storedAccessToken, storedUserId, result.postId, firstComment);
            commentNote = ' First comment added.';
          } catch (e: any) {
            commentNote = ` (Post published, but the first comment failed: ${e.message})`;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Image post shared successfully!${result.postId ? ` (Post ID: ${result.postId})` : ''}${commentNote}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to share image post: ${error.message}` }],
        };
      }
    }
  );

  server.tool(
    'linkedin-add-comment',
    'Adds a comment to an existing LinkedIn post (by its URN).',
    {
      postUrn: z
        .string()
        .min(1)
        .describe(
          'The post URN to comment on, e.g. urn:li:share:123 or urn:li:ugcPost:123 (returned as "Post ID" when sharing).'
        ),
      text: z.string().min(1).describe('The comment text.'),
    },
    async ({ postUrn, text }) => {
      await loadTokenData();
      if (!storedAccessToken || !storedUserId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Authentication required. Please visit http://localhost:${config.authPort}/auth/linkedin in your browser.`,
            },
          ],
        };
      }
      try {
        const result = await addComment(storedAccessToken, storedUserId, postUrn, text);
        return {
          content: [
            {
              type: 'text',
              text: `Comment added successfully!${result.commentId ? ` (Comment ID: ${result.commentId})` : ''}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to add comment: ${error.message}` }],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.error('LinkedIn MCP Server connected via stdio.');
  } catch (e: any) {
    console.error('Failed to connect MCP server:', e);
    process.exit(1);
  }

  // HTTP+SSE transport for Claude Desktop
  const app = express();
  app.use(express.json());
  const transports: Record<string, SSEServerTransport> = {};
  app.get('/stream', async (req, res) => {
    const transport = new SSEServerTransport('/message', res);
    transports[transport.sessionId] = transport;
    res.on('close', () => delete transports[transport.sessionId]);
    // Connect MCP server (handles SSE handshake internally)
    await server.connect(transport);
  });
  app.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (!transport) {
      res.status(400).send('No transport found for sessionId');
      return;
    }
    // Handle incoming POST JSON-RPC using SDK method
    await transport.handlePostMessage(req as any, res as any, req.body);
  });
  app
    .listen(config.httpPort, () => {
      console.error(`HTTP/SSE server listening on http://localhost:${config.httpPort}`);
    })
    .on('error', (err: NodeJS.ErrnoException) => {
      // The HTTP/SSE transport is optional; the primary transport is stdio.
      // Don't let a busy port (e.g. the auth server already on this port)
      // take down the whole MCP server.
      if (err.code === 'EADDRINUSE') {
        console.error(
          `HTTP/SSE port ${config.httpPort} is already in use; continuing with stdio transport only. ` +
            `Set HTTP_PORT to a free port to enable HTTP/SSE.`
        );
      } else {
        console.error('HTTP/SSE server error:', err);
      }
    });
} // close main()

main();
