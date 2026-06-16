// Publish a LinkedIn post from a JSON content file.
//
// Usage:
//   op run --account <acct> --env-file=.env -- node scripts/post.mjs <content.json>
//
// content.json shape (body required; the rest optional):
//   {
//     "body": "post text",
//     "firstComment": "comment posted immediately (put links here — body links are throttled)",
//     "image": "local path or http(s) URL of an image to attach natively (best reach + a visual)",
//     "imageAlt": "alt text for the image",
//     "url": "link to share as a preview card (use INSTEAD of image; body links are throttled)"
//   }
// Precedence: image > url > text-only.
//
// Requires `npm run build` first (imports the compiled API from ../build).
import { readFile } from 'fs/promises';
import {
  loadTokenData,
  sharePost,
  shareLink,
  shareImage,
  uploadImage,
  addComment,
  storedAccessToken,
  storedUserId,
} from '../build/linkedinApi.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/post.mjs <content.json>');
  process.exit(1);
}

const { body, url, image, imageAlt, firstComment } = JSON.parse(await readFile(file, 'utf-8'));
if (!body) {
  console.error('content.json must include a non-empty "body"');
  process.exit(1);
}

await loadTokenData();
if (!storedAccessToken || !storedUserId) {
  console.error('RESULT: NOT_AUTHENTICATED (run the OAuth flow first)');
  process.exit(1);
}

let result;
if (image) {
  console.error('Uploading image...');
  const asset = await uploadImage(storedAccessToken, storedUserId, image);
  console.error('RESULT: IMAGE_UPLOADED asset=' + asset);
  console.error('Publishing image post...');
  result = await shareImage(storedAccessToken, storedUserId, body, asset, imageAlt);
} else if (url) {
  console.error('Publishing link post...');
  result = await shareLink(storedAccessToken, storedUserId, body, url);
} else {
  console.error('Publishing text post...');
  result = await sharePost(storedAccessToken, storedUserId, body);
}
console.error('RESULT: POST_PUBLISHED post_urn=' + result.postId);

if (firstComment) {
  try {
    const c = await addComment(storedAccessToken, storedUserId, result.postId, firstComment);
    console.error('RESULT: COMMENT_ADDED ' + JSON.stringify(c));
  } catch (e) {
    console.error('RESULT: COMMENT_FAILED ' + e.message);
    console.error('(The post itself is live; only the first comment failed.)');
  }
}
