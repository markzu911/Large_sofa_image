import { GoogleGenAI } from '@google/genai';

export const MAX_INPUT_IMAGE_BYTES = 2 * 1024 * 1024;
export const AI_GENERATION_TIMEOUT_MS = Number(process.env.AI_GENERATION_TIMEOUT_MS || 32000);
export const SAAS_SHORT_TIMEOUT_MS = Number(process.env.SAAS_SHORT_TIMEOUT_MS || 8000);
export const SAAS_UPLOAD_TIMEOUT_MS = 120000;
export const SAAS_SAVE_TIMEOUT_MS = Number(process.env.SAAS_SAVE_TIMEOUT_MS || 18000);
export const SAAS_ORIGIN = normalizeSaasUrl(process.env.SAAS_ORIGIN || 'http://aibigtree.com');

const TRANSIENT_ERROR_PATTERN = /503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout|Timeout|high demand/i;
let aiClient: GoogleGenAI | null = null;

export type SaasInfo = {
  userId?: string | null;
  toolId?: string | null;
  apiBaseUrl?: string;
  launchUrl?: string;
  verifyUrl?: string;
  consumeUrl?: string;
  uploadTokenUrl?: string;
  uploadCommitUrl?: string;
};

export function getSaasUrl(saasInfo: SaasInfo | undefined, specificUrl: keyof SaasInfo, defaultPath: string) {
  const directUrl = saasInfo?.[specificUrl];
  if (typeof directUrl === 'string' && directUrl.trim()) {
    return normalizeSaasUrl(directUrl);
  }

  let origin = normalizeSaasUrl(saasInfo?.apiBaseUrl || SAAS_ORIGIN);
  if (!saasInfo?.apiBaseUrl && saasInfo?.consumeUrl) {
    try {
      origin = new URL(normalizeSaasUrl(saasInfo.consumeUrl)).origin;
    } catch {}
  }

  return normalizeSaasUrl(origin + defaultPath);
}

function normalizeSaasUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, '');
  try {
    const url = new URL(trimmed);
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'aibigtree.com' || url.hostname === 'www.aibigtree.com')
    ) {
      url.protocol = 'http:';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

export async function getRequestBody(req: any) {
  if (req.body) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body);
    }
    return req.body;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function sendJson(res: any, statusCode: number, payload: any) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function getGeminiClient() {
  if (!aiClient) {
    const apiKey = (process.env.GEMINI_API_KEY_NEXT || process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.endsWith('.local')
  ) {
    return true;
  }
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^169\.254\./.test(normalized)) {
    return true;
  }
  if (/^192\.168\./.test(normalized)) {
    return true;
  }
  const private172 = normalized.match(/^172\.(\d+)\./);
  return !!private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31;
}

export async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number, stepName: string) {
  try {
    return await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'large-sofa-image-tool',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const message = err?.message || String(err);
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(message);
    if (isTimeout) {
      throw new Error(`${stepName}超时(${Math.round(timeoutMs / 1000)}s)，请稍后重试`);
    }
    const cause = err?.cause ? `；原因: ${err.cause?.message || err.cause}` : '';
    throw new Error(`${stepName}网络请求失败: ${message}${cause}`);
  }
}

export async function readJsonResponse(res: Response, fallbackLabel: string) {
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${fallbackLabel}接口解析失败: ${text.slice(0, 300)}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.message || data.error || `${fallbackLabel}失败, 状态码: ${res.status}`);
  }
  return data;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 2, delayMs = 1200): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt += 1;
      const message = err?.message || String(err);
      if (attempt > retries || !TRANSIENT_ERROR_PATTERN.test(message)) {
        throw err;
      }
      const waitMs = delayMs * Math.pow(2, attempt - 1) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export async function getBase64FromUrlOrData(input: string): Promise<{ data: string; mimeType: string }> {
  if (input.startsWith('data:')) {
    const matches = input.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      const byteSize = Buffer.byteLength(matches[2], 'base64');
      if (byteSize > MAX_INPUT_IMAGE_BYTES) {
        throw new Error(`图片超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 限制`);
      }
      return { mimeType: matches[1], data: matches[2] };
    }
    throw new Error('Invalid base64 data URL format');
  }

  const parsedUrl = new URL(input);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http/https image URLs are allowed');
  }
  if (isBlockedHostname(parsedUrl.hostname)) {
    throw new Error('Private or local image URLs are not allowed');
  }

  const response = await fetchWithTimeout(input, {}, 20000, '下载参考图');
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL did not return an image (${contentType})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`远程图片超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 限制`);
  }
  return {
    mimeType: contentType,
    data: buffer.toString('base64'),
  };
}

export async function verifyBeforeGenerate(userId: string, toolId: string, saasInfo?: SaasInfo) {
  const res = await fetchWithTimeout(getSaasUrl(saasInfo, 'verifyUrl', '/api/tool/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId }),
  }, SAAS_SHORT_TIMEOUT_MS, '积分校验');
  return readJsonResponse(res, '积分校验');
}

export async function consumePoints(userId: string, toolId: string, saasInfo?: SaasInfo) {
  const res = await fetchWithTimeout(getSaasUrl(saasInfo, 'consumeUrl', '/api/tool/consume'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId }),
  }, SAAS_SHORT_TIMEOUT_MS, '扣费');
  return readJsonResponse(res, '扣费');
}

export async function launchTool(userId: string, toolId: string, saasInfo?: SaasInfo) {
  const res = await fetchWithTimeout(getSaasUrl(saasInfo, 'launchUrl', '/api/tool/launch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId }),
  }, SAAS_SHORT_TIMEOUT_MS, '启动工具');
  return readJsonResponse(res, '启动工具');
}

async function getDirectToken(userId: string, toolId: string, fileSize: number, mimeType: string, saasInfo?: SaasInfo) {
  const res = await fetchWithTimeout(getSaasUrl(saasInfo, 'uploadTokenUrl', '/api/upload/direct-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      mimeType,
      fileName: mimeType === 'image/jpeg' ? 'result.jpg' : 'result.png',
      fileSize,
    }),
  }, SAAS_SHORT_TIMEOUT_MS, '获取直传Token');
  return readJsonResponse(res, '获取直传Token');
}

async function uploadToOss(uploadUrl: string, method: string, headers: any, imageBuffer: Buffer, mimeType: string) {
  const res = await fetchWithTimeout(uploadUrl, {
    method: method || 'PUT',
    headers: {
      ...headers,
      'Content-Type': headers?.['Content-Type'] || headers?.['content-type'] || mimeType,
    },
    body: imageBuffer,
  }, SAAS_UPLOAD_TIMEOUT_MS, 'OSS直传图片');
  if (!res.ok) {
    throw new Error(`OSS直传图片失败, 状态码: ${res.status}`);
  }
}

async function commitUpload(userId: string, toolId: string, objectKey: string, fileSize: number, saasInfo?: SaasInfo) {
  const res = await fetchWithTimeout(getSaasUrl(saasInfo, 'uploadCommitUrl', '/api/upload/commit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      objectKey,
      fileSize,
    }),
  }, SAAS_SHORT_TIMEOUT_MS, '提交入库');
  const data = await readJsonResponse(res, '提交入库');
  if (data.success === false || !data.savedToRecords) {
    throw new Error(data.message || data.error || '确认入库失败');
  }
  return data;
}

export async function generateImageWithGemini({
  parts,
  aspectRatio = '4:3',
  imageSize = '1K',
  preferredModels = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'],
}: {
  parts: any[];
  aspectRatio?: string;
  imageSize?: string;
  preferredModels?: string[];
}) {
  let lastError: any;

  for (const modelName of preferredModels) {
    try {
      const client = getGeminiClient();
      const response = await retryWithBackoff(() => withTimeout(
        client.models.generateContent({
          model: modelName,
          contents: { parts },
          config: {
            imageConfig: {
              aspectRatio: aspectRatio as any,
              imageSize: imageSize as any,
            },
          },
        }),
        AI_GENERATION_TIMEOUT_MS,
        `AI 生成超时(${Math.round(AI_GENERATION_TIMEOUT_MS / 1000)}s)，请稍后重试`
      ), 0);

      let generatedBase64: string | null = null;
      let mimeType = 'image/png';
      let infoText = '';

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          generatedBase64 = part.inlineData.data;
          mimeType = part.inlineData.mimeType || mimeType;
          break;
        }
        if (part.text) {
          infoText += `${part.text}\n`;
        }
      }

      if (!generatedBase64) {
        throw new Error('模型响应成功，但未包含生成的图像数据。');
      }

      return {
        generatedBase64,
        mimeType,
        modelUsed: modelName,
        infoText: infoText.trim(),
      };
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('模型生成失败');
}

export async function saveGeneratedImageToSaas({
  userId,
  toolId,
  generatedBase64,
  mimeType,
  saasInfo,
}: {
  userId: string;
  toolId: string;
  generatedBase64: string;
  mimeType: string;
  saasInfo?: SaasInfo;
}) {
  await consumePoints(userId, toolId, saasInfo);

  const imageBuffer = Buffer.from(generatedBase64, 'base64');
  const fileSize = imageBuffer.length;
  const tokenData = await getDirectToken(userId, toolId, fileSize, mimeType, saasInfo);
  await uploadToOss(tokenData.uploadUrl, tokenData.method, tokenData.headers, imageBuffer, mimeType);
  const commitData = await commitUpload(userId, toolId, tokenData.objectKey, fileSize, saasInfo);

  return {
    image: commitData.image?.url || commitData.url || `data:${mimeType};base64,${generatedBase64}`,
    recordId: commitData.image?.recordId || commitData.recordId,
    url: commitData.image?.url || commitData.url,
    fileName: commitData.image?.fileName || commitData.fileName,
    fileSize,
  };
}
