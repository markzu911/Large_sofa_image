import {
  fetchWithTimeout,
  getRequestBody,
  isBlockedHostname,
  readJsonResponse,
  SAAS_ORIGIN,
  sendJson,
} from './_shared';

export const config = {
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  try {
    const body = await getRequestBody(req);
    const actualUrl = body.targetUrl || body.url;

    if (!actualUrl) {
      return sendJson(res, 200, { success: true, message: 'Proxy endpoint active' });
    }

    const parsedTarget = new URL(actualUrl);
    const allowedOrigins = new Set([new URL(SAAS_ORIGIN).origin]);
    if (!allowedOrigins.has(parsedTarget.origin) || isBlockedHostname(parsedTarget.hostname)) {
      return sendJson(res, 403, { success: false, error: 'Proxy target is not allowed' });
    }

    const proxyRes = await fetchWithTimeout(actualUrl, {
      method: req.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(body) : undefined,
    }, 30000, '代理请求');
    const data = await readJsonResponse(proxyRes, '代理请求');
    return sendJson(res, proxyRes.status, data);
  } catch (err: any) {
    return sendJson(res, 500, { success: false, error: err.message || 'Proxy request failed' });
  }
}
