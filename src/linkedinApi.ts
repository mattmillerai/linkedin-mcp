import { loadConfig } from './config.js';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import type { TokenResponse, UserInfoResponse, ShareResult } from './types.js';

const config = loadConfig();
// ensure tokenStore.json is loaded from project root regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokenFile = path.join(__dirname, '..', 'tokenStore.json');

let storedAccessToken: string | null = null;
let storedUserId: string | null = null;
let storedRefreshToken: string | null = null;
let storedExpiresAt = 0;

export async function loadTokenData(): Promise<void> {
    try {
        const content = await fs.readFile(tokenFile, 'utf-8');
        const { userId, accessToken, refreshToken, expiresAt } = JSON.parse(content);
        storedUserId = userId;
        storedAccessToken = accessToken;
        storedRefreshToken = refreshToken;
        storedExpiresAt = expiresAt;
    } catch {
    }
}

export function storeTokenData(userId: string, tokenData: TokenResponse) {
    storedUserId = userId;
    storedAccessToken = tokenData.access_token;
    storedRefreshToken = tokenData.refresh_token;
    storedExpiresAt = Date.now() + tokenData.expires_in * 1000;
    console.error(`Stored token for user URN: urn:li:person:${storedUserId}`);
    fs.writeFile(
        tokenFile,
        JSON.stringify({
            userId,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: storedExpiresAt
        }),
        'utf-8'
    )
        .then(() => console.error(`Token saved to ${tokenFile}`))
        .catch(err => console.error('Error saving token:', err));
}

export { storedAccessToken, storedUserId };

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: config.linkedinClientId,
        client_secret: config.linkedinClientSecret,
        redirect_uri: config.linkedinRedirectUri,
    });

    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
    if (!response.ok) throw new Error(`Access token request failed: ${response.statusText}`);
    return (await response.json()) as TokenResponse;
}

export async function getUserInfo(accessToken: string): Promise<UserInfoResponse> {
    const response = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Get user info failed: ${response.statusText}`);
    return (await response.json()) as UserInfoResponse;
}

export async function sharePost(
    accessToken: string,
    userId: string,
    text: string
): Promise<ShareResult> {
    if (Date.now() >= storedExpiresAt) {
        console.error('Access token expired, refreshing...');
        await refreshAccessToken();
    }
    const tokenToUse = storedAccessToken!;

    const postBody = {
        author: `urn:li:person:${userId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'NONE',
            },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${tokenToUse}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
    });
    if (!response.ok) {
        const errorData = await response.text();
        console.error('Share Post Error:', response.status, errorData);
        throw new Error(`Share post failed: ${response.statusText} - ${errorData}`);
    }
    return { success: true, postId: response.headers.get('x-restli-id') };
}

export async function shareLink(
    accessToken: string,
    userId: string,
    text: string,
    url: string
): Promise<ShareResult> {
    if (Date.now() >= storedExpiresAt) {
        console.error('Access token expired, refreshing...');
        await refreshAccessToken();
    }
    const tokenToUse = storedAccessToken!;

    const postBody = {
        author: `urn:li:person:${userId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'ARTICLE',
                media: [{ status: 'READY', originalUrl: url }],
            },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${tokenToUse}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
    });
    if (!response.ok) {
        const errorData = await response.text();
        console.error('Share Link Error:', response.status, errorData);
        throw new Error(`Share link failed: ${response.statusText} - ${errorData}`);
    }
    return { success: true, postId: response.headers.get('x-restli-id') };
}

export async function addComment(
    accessToken: string,
    userId: string,
    objectUrn: string,
    text: string
): Promise<{ success: boolean; commentId?: string | null }> {
    if (Date.now() >= storedExpiresAt) {
        console.error('Access token expired, refreshing...');
        await refreshAccessToken();
    }
    const tokenToUse = storedAccessToken!;

    const commentBody = {
        actor: `urn:li:person:${userId}`,
        object: objectUrn,
        message: { text },
    };

    // The post URN must be URL-encoded into the path (e.g. urn:li:share:123 -> urn%3Ali%3Ashare%3A123).
    const response = await fetch(
        `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(objectUrn)}/comments`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenToUse}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify(commentBody),
        }
    );
    if (!response.ok) {
        const errorData = await response.text();
        console.error('Add Comment Error:', response.status, errorData);
        throw new Error(`Add comment failed: ${response.statusText} - ${errorData}`);
    }
    const data = (await response.json().catch(() => ({} as any))) as any;
    return {
        success: true,
        commentId: data?.['$URN'] ?? data?.id ?? response.headers.get('x-restli-id'),
    };
}

async function loadImage(source: string): Promise<{ data: Buffer; contentType: string }> {
    if (/^https?:\/\//i.test(source)) {
        const res = await fetch(source, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; linkedin-mcp/1.0)' },
        });
        if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const data = Buffer.from(await res.arrayBuffer());
        return { data, contentType };
    }
    const data = await fs.readFile(source);
    const ext = source.split('.').pop()?.toLowerCase();
    const contentType =
        ext === 'png' ? 'image/png'
        : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
        : 'image/jpeg';
    return { data, contentType };
}

// Uploads an image (local path or http(s) URL) and returns its digitalmediaAsset URN.
// LinkedIn flow: registerUpload -> PUT the binary to the returned uploadUrl.
export async function uploadImage(
    accessToken: string,
    userId: string,
    source: string
): Promise<string> {
    if (Date.now() >= storedExpiresAt) {
        console.error('Access token expired, refreshing...');
        await refreshAccessToken();
    }
    const tokenToUse = storedAccessToken!;
    const { data, contentType } = await loadImage(source);

    const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${tokenToUse}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
            registerUploadRequest: {
                recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                owner: `urn:li:person:${userId}`,
                serviceRelationships: [
                    { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
                ],
            },
        }),
    });
    if (!registerRes.ok) {
        const e = await registerRes.text();
        throw new Error(`registerUpload failed: ${registerRes.statusText} - ${e}`);
    }
    const reg = (await registerRes.json()) as any;
    const uploadUrl =
        reg?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']
            ?.uploadUrl;
    const asset = reg?.value?.asset as string;
    if (!uploadUrl || !asset) {
        throw new Error(`registerUpload returned unexpected shape: ${JSON.stringify(reg)}`);
    }

    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tokenToUse}`, 'Content-Type': contentType },
        body: data,
    });
    if (!uploadRes.ok) {
        const e = await uploadRes.text();
        throw new Error(`Image binary upload failed: ${uploadRes.statusText} - ${e}`);
    }
    return asset;
}

export async function shareImage(
    accessToken: string,
    userId: string,
    text: string,
    assetUrn: string,
    altText?: string
): Promise<ShareResult> {
    if (Date.now() >= storedExpiresAt) {
        console.error('Access token expired, refreshing...');
        await refreshAccessToken();
    }
    const tokenToUse = storedAccessToken!;

    const postBody = {
        author: `urn:li:person:${userId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'IMAGE',
                media: [
                    {
                        status: 'READY',
                        media: assetUrn,
                        ...(altText ? { description: { text: altText } } : {}),
                    },
                ],
            },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${tokenToUse}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
    });
    if (!response.ok) {
        const errorData = await response.text();
        console.error('Share Image Error:', response.status, errorData);
        throw new Error(`Share image failed: ${response.statusText} - ${errorData}`);
    }
    return { success: true, postId: response.headers.get('x-restli-id') };
}

export async function refreshAccessToken(): Promise<void> {
    if (!storedRefreshToken) throw new Error('No refresh token available');
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: storedRefreshToken,
        client_id: config.linkedinClientId,
        client_secret: config.linkedinClientSecret,
    });
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
    if (!response.ok) throw new Error(`Token refresh failed: ${response.statusText}`);
    const tokenData = (await response.json()) as TokenResponse;
    storedAccessToken = tokenData.access_token;
    storedRefreshToken = tokenData.refresh_token;
    storedExpiresAt = Date.now() + tokenData.expires_in * 1000;
    await fs.writeFile(
        tokenFile,
        JSON.stringify({
            userId: storedUserId,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: storedExpiresAt
        }),
        'utf-8'
    );
    console.error('Refreshed access token');
}
