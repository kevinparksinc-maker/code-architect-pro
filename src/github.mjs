// Public repositories only. No arbitrary fetch URLs, user-supplied auth or git execution.
import { MAX_ZIP_BYTES } from './zip.mjs';
const MATCH = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:\/tree\/([^?#]+))?\/?$/;
export function parseRepo(input) {
  if (typeof input !== 'string') throw new Error('Enter owner/repository or a public GitHub URL');
  const match = input.trim().match(MATCH);
  if (!match || match[1].startsWith('.') || match[2].startsWith('.') || match[2] === '..') throw new Error('Only public github.com owner/repository URLs are supported');
  const [, owner, rawRepo, rawRef] = match, repo = rawRepo.replace(/\.git$/, '');
  if (!repo) throw new Error('Repository name required');
  const ref = rawRef ? decodeURIComponent(rawRef).replace(/^\/+|\/+$/g, '') : '';
  if (ref && (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..') || ref.startsWith('-'))) throw new Error('Invalid branch/ref');
  return { owner, repo, ref };
}
export async function downloadPublicRepo(input, fetcher = fetch) {
  const { owner, repo, ref } = parseRepo(input);
  const url = `https://api.github.com/repos/${owner}/${repo}/zipball${ref ? '/' + ref.split('/').map(encodeURIComponent).join('/') : ''}`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    let current = url, response;
    for (let i = 0; i < 4; i++) {
      response = await fetcher(current, { redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CodeArchitectEngine/0.1', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw new Error('GitHub redirect did not provide a location');
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !['codeload.github.com', 'api.github.com'].includes(next.hostname)) throw new Error('Untrusted GitHub download redirect');
      current = next.href;
    }
    if (!response?.ok) throw new Error(`GitHub returned HTTP ${response?.status || 'error'} (public repository and rate limits required)`);
    let parts = [], received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > MAX_ZIP_BYTES) throw new Error('GitHub archive is larger than 32 MB');
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  } finally { clearTimeout(timer); }
}
