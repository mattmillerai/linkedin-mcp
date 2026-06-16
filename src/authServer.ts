import express from 'express';
import session from 'express-session';
import { randomUUID } from 'crypto';
import { loadConfig } from './config.js';
import { exchangeCodeForToken, getUserInfo, storeTokenData } from './linkedinApi.js';

const config = loadConfig();
const app = express();

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// 1. Initiate OAuth flow
app.get('/auth/linkedin', (req, res) => {
  const state = randomUUID();
  // @ts-ignore
  req.session.oauthState = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.linkedinClientId,
    redirect_uri: config.linkedinRedirectUri,
    state,
    scope: 'openid profile email w_member_social',
  });
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  console.log('Redirecting to:', authUrl);
  res.redirect(authUrl);
});

// 2. Callback endpoint
app.get('/auth/linkedin/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  // @ts-ignore
  const savedState = req.session.oauthState;
  // @ts-ignore
  delete req.session.oauthState;

  // Surface errors LinkedIn returns via the redirect (e.g. unauthorized_scope_error,
  // user_cancelled_login) instead of masking them as "Missing authorization code".
  if (error) {
    console.error('LinkedIn OAuth error:', error, '-', error_description);
    return res
      .status(400)
      .send(`LinkedIn authorization failed: ${error} — ${error_description || '(no description)'}`);
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing authorization code');
  }
  if (!state || state !== savedState) {
    return res.status(400).send('Invalid state parameter');
  }

  try {
    const tokenData = await exchangeCodeForToken(code as string);
    const userInfo = await getUserInfo(tokenData.access_token);
    console.log(`Storing token for user: ${userInfo.sub}`);
    storeTokenData(userInfo.sub, tokenData);
    res.send('Authentication successful! You can close this tab.');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed.');
  }
});

app.listen(config.authPort, () => {
  console.log(`OAuth callback server listening on http://localhost:${config.authPort}`);
});
