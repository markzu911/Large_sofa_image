import { GoogleGenAI } from '@google/genai';
import { deflateSync } from 'node:zlib';

export const MAX_INPUT_IMAGE_BYTES = 2 * 1024 * 1024;
export const AI_GENERATION_TIMEOUT_MS = Number(process.env.AI_GENERATION_TIMEOUT_MS || 32000);
export const SAAS_SHORT_TIMEOUT_MS = Number(process.env.SAAS_SHORT_TIMEOUT_MS || 8000);
export const SAAS_UPLOAD_TIMEOUT_MS = Number(process.env.SAAS_UPLOAD_TIMEOUT_MS || 45000);
export const SAAS_ORIGIN = normalizeSaasUrl(process.env.SAAS_ORIGIN || 'http://aibigtree.com');

const TRANSIENT_ERROR_PATTERN = /503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout|Timeout|high demand/i;
let aiClient: GoogleGenAI | null = null;

type SaasSaveStep = 'consume' | 'upload-token' | 'oss-upload' | 'upload-commit';

export type PlacementBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  reason?: string;
};

export type PlacementGuide = {
  tvWall: 'left' | 'right' | 'back' | 'front' | 'none' | 'unknown';
  targetZone: PlacementBox;
  forbiddenZones: PlacementBox[];
  facing: 'left' | 'right' | 'up' | 'down' | 'left-up' | 'right-up';
  instruction: string;
};

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
    throw new Error(data.errorMessage || data.message || data.error || `${fallbackLabel}失败, 状态码: ${res.status}`);
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
  if (data.success === false || data.savedToRecords === false) {
    throw new Error(data.errorMessage || data.message || data.error || '确认入库失败');
  }
  return data;
}

async function runSaasSaveStep<T>(step: SaasSaveStep, label: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err: any) {
    const error = new Error(`${label}失败: ${err.message || err}`) as Error & { saveStep?: SaasSaveStep };
    error.saveStep = step;
    throw error;
  }
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

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function normalizePlacementBox(box: PlacementBox): PlacementBox {
  const xMin = clampPercent(Math.min(box.xMin, box.xMax));
  const xMax = clampPercent(Math.max(box.xMin, box.xMax));
  const yMin = clampPercent(Math.min(box.yMin, box.yMax));
  const yMax = clampPercent(Math.max(box.yMin, box.yMax));
  return {
    ...box,
    xMin,
    xMax,
    yMin,
    yMax,
  };
}

function detectTvWallFromPlan(plan: string): PlacementGuide['tvWall'] {
  const compact = plan.replace(/\s+/g, '');
  const focused = compact.match(/(?:房间骨架锁定|电视观看关系|唯一锁定落点)(.{0,420})/)?.[1] || compact.slice(0, 900);
  if (/(电视|媒体墙|观看墙)[^。；，,]*(画面左|左侧墙|左墙|左侧)/.test(focused)) return 'left';
  if (/(电视|媒体墙|观看墙)[^。；，,]*(画面右|右侧墙|右墙|右侧)/.test(focused)) return 'right';
  if (/(电视|媒体墙|观看墙)[^。；，,]*(后墙|上方|背景墙|正前方墙|主背景墙)/.test(focused)) return 'back';
  if (/(电视|媒体墙|观看墙)[^。；，,]*(前景|下方近处|画面下方)/.test(focused)) return 'front';
  if (/无明确电视|电视.*不明确|媒体墙.*不明确/.test(focused)) return 'none';
  return 'unknown';
}

function parsePlacementGuideJsonFromPlan(plan: string): PlacementGuide | null {
  const jsonMatch = plan.match(/GUIDE_JSON\s*[:：]\s*(\{[^\n]+\})/i);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    const tvWall = ['left', 'right', 'back', 'front', 'none', 'unknown'].includes(parsed.tvWall)
      ? parsed.tvWall
      : 'unknown';
    const facing = ['left', 'right', 'up', 'down', 'left-up', 'right-up'].includes(parsed.facing)
      ? parsed.facing
      : 'left';
    const targetZone = parsed.targetZone && typeof parsed.targetZone === 'object'
      ? normalizePlacementBox({
          xMin: Number(parsed.targetZone.xMin),
          yMin: Number(parsed.targetZone.yMin),
          xMax: Number(parsed.targetZone.xMax),
          yMax: Number(parsed.targetZone.yMax),
          reason: parsed.targetZone.reason || 'GUIDE_JSON 目标区',
        })
      : null;
    if (!targetZone || [targetZone.xMin, targetZone.xMax, targetZone.yMin, targetZone.yMax].some(Number.isNaN)) {
      return null;
    }
    const forbiddenZones = Array.isArray(parsed.forbiddenZones)
      ? parsed.forbiddenZones
          .map((zone: any) => normalizePlacementBox({
            xMin: Number(zone.xMin),
            yMin: Number(zone.yMin),
            xMax: Number(zone.xMax),
            yMax: Number(zone.yMax),
            reason: zone.reason || 'GUIDE_JSON 禁放区',
          }))
          .filter((zone: PlacementBox) => ![zone.xMin, zone.xMax, zone.yMin, zone.yMax].some(Number.isNaN))
      : [];

    return {
      tvWall,
      targetZone,
      forbiddenZones,
      facing,
      instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim()
        ? parsed.instruction.trim()
        : '严格执行 GUIDE_JSON 中的目标区、禁放区和朝向。',
    };
  } catch {
    return null;
  }
}

function extractTargetBoxFromPlan(plan: string): PlacementBox | null {
  const targetSection = plan.match(/(?:唯一锁定落点|执行口令)([\s\S]{0,900})/)?.[1] || plan;
  const xThenY = targetSection.match(/X\s*[=≈约:：]*\s*(\d{1,3})(?:\.\d+)?\s*[%％]\s*(?:-|~|至|到|—|–)\s*(\d{1,3})(?:\.\d+)?\s*[%％][\s\S]{0,120}?Y\s*[=≈约:：]*\s*(\d{1,3})(?:\.\d+)?\s*[%％]\s*(?:-|~|至|到|—|–)\s*(\d{1,3})(?:\.\d+)?\s*[%％]/i);
  if (xThenY) {
    return normalizePlacementBox({
      xMin: Number(xThenY[1]),
      xMax: Number(xThenY[2]),
      yMin: Number(xThenY[3]),
      yMax: Number(xThenY[4]),
      reason: '落位方案中的唯一锁定坐标',
    });
  }

  const yThenX = targetSection.match(/Y\s*[=≈约:：]*\s*(\d{1,3})(?:\.\d+)?\s*[%％]\s*(?:-|~|至|到|—|–)\s*(\d{1,3})(?:\.\d+)?\s*[%％][\s\S]{0,120}?X\s*[=≈约:：]*\s*(\d{1,3})(?:\.\d+)?\s*[%％]\s*(?:-|~|至|到|—|–)\s*(\d{1,3})(?:\.\d+)?\s*[%％]/i);
  if (yThenX) {
    return normalizePlacementBox({
      yMin: Number(yThenX[1]),
      yMax: Number(yThenX[2]),
      xMin: Number(yThenX[3]),
      xMax: Number(yThenX[4]),
      reason: '落位方案中的唯一锁定坐标',
    });
  }

  return null;
}

function fallbackGuideByTvWall(tvWall: PlacementGuide['tvWall']): Pick<PlacementGuide, 'targetZone' | 'forbiddenZones' | 'facing' | 'instruction'> | null {
  if (tvWall === 'left') {
    return {
      targetZone: { xMin: 60, yMin: 46, xMax: 94, yMax: 84, reason: '左墙电视的对侧/斜对侧观看区' },
      forbiddenZones: [{ xMin: 0, yMin: 0, xMax: 58, yMax: 100, reason: '左墙电视同侧、电视下方和电视旁边区域禁放' }],
      facing: 'left',
      instruction: '电视在画面左侧墙：沙发主体必须远离左墙电视，整体落在右半部/右下/中下观看区，主坐面朝左或左上看电视；沙发任何主要体量都不能压到左半区。',
    };
  }
  if (tvWall === 'right') {
    return {
      targetZone: { xMin: 6, yMin: 46, xMax: 40, yMax: 84, reason: '右墙电视的对侧/斜对侧观看区' },
      forbiddenZones: [{ xMin: 42, yMin: 0, xMax: 100, yMax: 100, reason: '右墙电视同侧、电视下方和电视旁边区域禁放' }],
      facing: 'right',
      instruction: '电视在画面右侧墙：沙发主体必须远离右墙电视，整体落在左半部/左下/中下观看区，主坐面朝右或右上看电视；沙发任何主要体量都不能压到右半区。',
    };
  }
  if (tvWall === 'back') {
    return {
      targetZone: { xMin: 18, yMin: 58, xMax: 82, yMax: 90, reason: '后墙电视的前景观看区' },
      forbiddenZones: [{ xMin: 0, yMin: 0, xMax: 100, yMax: 42, reason: '后墙电视同侧和电视下方区域禁放' }],
      facing: 'up',
      instruction: '电视在画面后墙/上方背景墙：沙发主体必须落在下方观看区，主坐面朝后墙或上方看电视。',
    };
  }
  if (tvWall === 'front') {
    return {
      targetZone: { xMin: 18, yMin: 10, xMax: 82, yMax: 46, reason: '前景电视的中后方观看区' },
      forbiddenZones: [{ xMin: 0, yMin: 54, xMax: 100, yMax: 100, reason: '前景电视同侧区域禁放' }],
      facing: 'down',
      instruction: '电视在画面前景/下方：沙发主体必须落在中后方观看区，主坐面朝前景或下方看电视。',
    };
  }
  return null;
}

export function createPlacementGuideFromPlan(placementPlan: string): PlacementGuide | null {
  if (!placementPlan || placementPlan.startsWith('空间落位分析未单独返回')) return null;

  const parsedGuide = parsePlacementGuideJsonFromPlan(placementPlan);
  const tvWall = parsedGuide?.tvWall || detectTvWallFromPlan(placementPlan);
  const fallback = fallbackGuideByTvWall(tvWall);
  const parsedTarget = parsedGuide?.targetZone || extractTargetBoxFromPlan(placementPlan);
  let targetZone = parsedTarget || fallback?.targetZone;
  let forbiddenZones = parsedGuide?.forbiddenZones?.length ? parsedGuide.forbiddenZones : (fallback?.forbiddenZones || []);
  let facing = parsedGuide?.facing || fallback?.facing || 'left';
  let instruction = parsedGuide?.instruction || fallback?.instruction || '根据绿色目标区放置沙发主体，避开红色禁放区，主坐面朝向房间会客中心。';

  if (!targetZone) return null;

  targetZone = normalizePlacementBox(targetZone);
  if (tvWall === 'left' && (targetZone.xMin < 58 || (targetZone.xMin + targetZone.xMax) / 2 < 66) && fallback) {
    targetZone = fallback.targetZone;
    forbiddenZones = fallback.forbiddenZones;
    facing = fallback.facing;
    instruction = fallback.instruction;
  }
  if (tvWall === 'right' && (targetZone.xMax > 42 || (targetZone.xMin + targetZone.xMax) / 2 > 34) && fallback) {
    targetZone = fallback.targetZone;
    forbiddenZones = fallback.forbiddenZones;
    facing = fallback.facing;
    instruction = fallback.instruction;
  }
  if (tvWall === 'back' && targetZone.yMin < 50 && fallback) {
    targetZone = fallback.targetZone;
    forbiddenZones = fallback.forbiddenZones;
    facing = fallback.facing;
    instruction = fallback.instruction;
  }
  if (tvWall === 'front' && targetZone.yMax > 50 && fallback) {
    targetZone = fallback.targetZone;
    forbiddenZones = fallback.forbiddenZones;
    facing = fallback.facing;
    instruction = fallback.instruction;
  }

  return {
    tvWall,
    targetZone: normalizePlacementBox(targetZone),
    forbiddenZones: forbiddenZones.map(normalizePlacementBox),
    facing,
    instruction,
  };
}

export function describePlacementGuideForPrompt(guide: PlacementGuide, shotName?: string) {
  const isCloseShot = /近景|特写|细节/.test(shotName || '');
  const lock = {
    tvWall: guide.tvWall,
    targetZone: guide.targetZone,
    forbiddenZones: guide.forbiddenZones,
    facing: guide.facing,
  };
  return `
【POSITION_LOCK_JSON - 最高优先级坐标锁】
${JSON.stringify(lock)}
执行方式：
1. 这是最终生图必须遵守的机器坐标锁，所有百分比均基于房间参考图画面，X 从左到右，Y 从上到下。
2. 产品沙发中心和主体主要体量必须落在 targetZone 内；任何主体主要体量不能进入 forbiddenZones。
3. facing 是沙发主坐面/开口侧朝向，不是相机朝向。
4. 远景/中景/近景共用同一个 targetZone 和 facing，不能每个景别重新找地方。
5. ${guide.instruction}
${isCloseShot ? '6. 当前是近景/细节：最终画面可以裁切 targetZone 内已落位沙发的局部，但不能把完整沙发搬离 targetZone，也不能让背景暗示沙发位于 forbiddenZones。' : ''}
`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

function drawPlacementRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  box: PlacementBox,
  color: [number, number, number],
  alpha: number,
) {
  const x0 = Math.max(0, Math.min(width - 1, Math.round((box.xMin / 100) * width)));
  const x1 = Math.max(0, Math.min(width, Math.round((box.xMax / 100) * width)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round((box.yMin / 100) * height)));
  const y1 = Math.max(0, Math.min(height, Math.round((box.yMax / 100) * height)));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = (y * width + x) * 4;
      pixels[idx] = Math.round(pixels[idx] * (1 - alpha) + color[0] * alpha);
      pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - alpha) + color[1] * alpha);
      pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - alpha) + color[2] * alpha);
      pixels[idx + 3] = 255;
    }
  }
}

function drawPlacementLine(
  pixels: Uint8Array,
  width: number,
  height: number,
  start: [number, number],
  end: [number, number],
  color: [number, number, number],
  thickness: number,
) {
  const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), 1);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const cx = Math.round(start[0] + (end[0] - start[0]) * t);
    const cy = Math.round(start[1] + (end[1] - start[1]) * t);
    for (let yy = -thickness; yy <= thickness; yy += 1) {
      for (let xx = -thickness; xx <= thickness; xx += 1) {
        const x = cx + xx;
        const y = cy + yy;
        if (x < 0 || x >= width || y < 0 || y >= height || xx * xx + yy * yy > thickness * thickness) continue;
        const idx = (y * width + x) * 4;
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 255;
      }
    }
  }
}

function drawPlacementArrow(pixels: Uint8Array, width: number, height: number, guide: PlacementGuide) {
  const box = guide.targetZone;
  const x0 = Math.round((box.xMin / 100) * width);
  const x1 = Math.round((box.xMax / 100) * width);
  const y0 = Math.round((box.yMin / 100) * height);
  const y1 = Math.round((box.yMax / 100) * height);
  const center: [number, number] = [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
  const insetX = Math.max(20, Math.round((x1 - x0) * 0.16));
  const insetY = Math.max(20, Math.round((y1 - y0) * 0.16));
  const end: [number, number] =
    guide.facing === 'right'
      ? [x1 - insetX, center[1]]
      : guide.facing === 'up'
      ? [center[0], y0 + insetY]
      : guide.facing === 'down'
      ? [center[0], y1 - insetY]
      : guide.facing === 'left-up'
      ? [x0 + insetX, y0 + insetY]
      : guide.facing === 'right-up'
      ? [x1 - insetX, y0 + insetY]
      : [x0 + insetX, center[1]];

  drawPlacementLine(pixels, width, height, center, end, [20, 112, 74], 7);
  const dx = end[0] - center[0];
  const dy = end[1] - center[1];
  const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const ux = dx / len;
  const uy = dy / len;
  const head = 30;
  const half = 18;
  const p1: [number, number] = [
    Math.round(end[0] - ux * head - uy * half),
    Math.round(end[1] - uy * head + ux * half),
  ];
  const p2: [number, number] = [
    Math.round(end[0] - ux * head + uy * half),
    Math.round(end[1] - uy * head - ux * half),
  ];
  drawPlacementLine(pixels, width, height, p1, end, [20, 112, 74], 7);
  drawPlacementLine(pixels, width, height, p2, end, [20, 112, 74], 7);
}

export function renderPlacementGuidePngBase64(guide: PlacementGuide, width = 1024, height = 768) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 245;
    pixels[i + 1] = 241;
    pixels[i + 2] = 232;
    pixels[i + 3] = 255;
  }

  for (const zone of guide.forbiddenZones) {
    drawPlacementRect(pixels, width, height, zone, [220, 54, 48], 0.42);
  }
  drawPlacementRect(pixels, width, height, guide.targetZone, [50, 190, 112], 0.54);
  drawPlacementArrow(pixels, width, height, guide);

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, rowStart + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

export async function generatePlacementPlanWithGemini({
  roomData,
  roomMimeType,
  productData,
  productMimeType,
  shotName,
  cameraSpec,
}: {
  roomData: string;
  roomMimeType: string;
  productData?: string;
  productMimeType?: string;
  shotName?: string;
  cameraSpec?: string;
}) {
  const client = getGeminiClient();
  const parts: any[] = [
    {
      text: `
你是一位严格的室内设计空间规划师。请先分析【房间参考图】的真实结构，再为【沙发产品】确定一个唯一、固定、可执行的落位方案。

输入边界必须绝对清楚：
- 【房间参考图】是唯一空间来源，也是最终图的底片视角来源。只从它读取墙体、窗户、门洞、电视/媒体墙、固定柜体、地面透视、光线、原家具和通道；必须保持原相机方向和墙体方位，不能重拍房间。
- 【沙发产品参考图】只用于判断沙发本体的体量、模块、靠背/坐面/扶手方向和真实占地。不要把产品图里的客厅布局、茶几、玩偶/摆件、灯、柜体、地毯、墙面、窗帘、餐桌、画作、文字、水印或任何非沙发物体当作可复制内容。
- 产品图里的拍摄角度不是最终房间里的摆放角度。可以把同一件沙发以新的摄影角度呈现，但沙发本体结构不变，主坐面必须服务于房间里的电视/茶几/会客中心。
- 落位只看房间参考图。不要因为产品图原本放在某面柜前、某张茶几旁或某盏灯下，就在目标房间复制那套关系。
- 房间相机方向硬锁定：如果房间图中电视在左墙，最终所有远景/中景/近景都必须仍能判断电视属于左墙，不能把电视变成后墙/中间背景墙；窗户、窗帘、边柜和墙角也不能互换方位。

只输出中文结构化方案，不生成图片，不要写寒暄。必须按以下标题输出：
0. 执行口令：用一句话写清最终摆放命令，格式为“把产品沙发放在/替换到【画面方位/坐标范围】的【最合理可放区名称】，主坐面朝向【目标墙/电视/会客中心】，原家具处理为【替换/保留/移走/轻微调整】，禁止放在【本图关键禁放区】。”如果房间原图已有沙发/座椅，必须先评估原座位区是否最合理；如果不是，也要说明为什么选择另一个更合理区域。
1. 房间骨架锁定：说明电视/媒体墙、窗户/窗帘、门洞/阳台门、固定柜体、墙角、地面透视、主要通道分别在画面什么方位；不确定就写“不明确”，不要臆造。
2. 产品体量判断：根据产品图只判断沙发本体是单人/双人/三人/多人/L形/躺位/组合模块，大致长宽比例、主坐面、靠背侧、扶手侧、躺位/贵妃位方向；只识别清晰固定在沙发本体上的真实附属件。茶几、玩偶/摆件、灯、柜体、地毯、墙面、窗帘、餐桌、画作、文字、水印全部写入“非产品，禁止复制”。
3. 电视观看关系：如果有电视/媒体墙，必须写清“电视所在墙/同侧贴墙区/电视下方/遮挡电视屏幕区域”为 0 分禁放区，并写清“电视对侧或斜对侧的观看区”为优先可放区；如果没有电视/媒体墙，写“无明确电视观看关系”。
4. 可替换对象：房间里哪些原有可移动家具可以被商品沙发替换、移走、保留或轻微调整；如果存在原沙发/座椅/贵妃椅/休闲椅/会客主座，必须明确它的位置、朝向、占地区域，并判断“替换原座位区”还是“另选更合理区域”。如果保留原家具，必须保证产品沙发与它形成合理会客关系，不拥挤、不挡通道、不像随机多放一张。
5. 候选区打分：必须列出至少 4 个候选区域并打分 0-10，例如“原座位区/电视对侧观看区/地毯或茶几后侧/侧墙开阔区/窗前区域/画面中央或前景/门洞通道”。每个候选区必须说明：
   - 是否有稳定靠墙、靠地毯、靠茶几或会客中心关系。
   - 主坐面是否能朝向电视/茶几/会客中心，而不是单纯朝向镜头。
   - 是否挡窗、挡门、挡电视、挡固定柜体或堵主要通道。
   - 是否会和原沙发/座椅形成拥挤、双主沙发冲突或“前后两排沙发”。
   - 是否符合产品大沙发的真实尺寸和房间透视。
   - 如果候选区位于电视所在墙同侧、电视下方、电视旁边贴墙区、电视屏幕正下/正侧，必须打 0 分，不能作为最终落点。
6. 禁入边界：逐条列出本图不能放沙发的区域，尤其是窗户/窗帘主体前、门洞、通道、电视所在墙同侧贴墙区、电视下方、会遮挡电视屏幕的位置、固定柜体前、墙体开口、过窄或非地面的区域。
7. 唯一锁定落点：只给一个最终落点。必须同时写：
   - 画面方位，例如“原沙发所在区域/原座位区/地毯后侧/电视墙对侧/侧墙开阔可放区”。如果原图已有沙发/座椅，这里必须说明是否替换原座位区；如果不替换，必须说明另一个区域为什么更合理。
   - 大致归一化坐标范围，例如“沙发中心约 X=35%-55%, Y=62%-78%”，这里的 Y 指画面从上到下。
   - 沙发底部/四脚/底座应贴合哪一块地面透视线。
   - 主坐面朝向，例如“朝向画面左侧电视墙/斜朝主背景墙/朝向茶几会客中心”。
   - 原家具处理要求，例如“替换原沙发/保留原单椅/移走茶几/轻微调整边几”；如果选择新增到其他区域，必须说明与原沙发、茶几、电视、通道的关系，不能新增到原沙发前方或房间中央造成拥堵。
8. 远景机位：相机如何后退展示空间，沙发占比小但仍在同一锁定落点。
9. 中景机位：相机如何靠近成为电商主图，沙发占比适中但仍在同一锁定落点；不能为了主图把沙发旋转朝向镜头或拉到画面前景。
10. 近景机位：相机如何靠近已合理落位的产品沙发拍扶手、坐垫、靠背、缝线和材质；近景必须是局部裁切，不能展示完整沙发全貌，不能把完整沙发巨大化后重新摆到窗前/房间中央/通道，也不能把原家具当成混乱背景。
11. 绝对禁止的错误结果：明确写出本图最容易出错的 3-5 种摆法，必须包含“把产品沙发新增到原沙发前方/通道/房间中央，导致空间拥堵或双主沙发冲突”和“为了电商正面图把沙发实际坐向转成朝镜头而背离电视/茶几”。
12. 非产品阻断清单：列出产品图中出现但不属于沙发本体的所有物件，并写明“最终图不得复制这些物件；最终房间物件只能来自房间参考图或合理保留/移走房间原家具”。
13. GUIDE_JSON：最后单独输出一行严格 JSON，不要 Markdown，格式必须完全如下：
GUIDE_JSON: {"tvWall":"left|right|back|front|none|unknown","targetZone":{"xMin":0,"yMin":0,"xMax":0,"yMax":0,"reason":"最终沙发主体目标区"},"forbiddenZones":[{"xMin":0,"yMin":0,"xMax":0,"yMax":0,"reason":"禁放原因"}],"facing":"left|right|up|down|left-up|right-up","instruction":"一句话执行指令"}

GUIDE_JSON 填写规则：
- 如果电视在画面左侧墙：tvWall 必须是 "left"，targetZone 必须在右半部，建议 xMin>=60, xMax<=94, yMin=46-55, yMax=78-86；forbiddenZones 必须包含 xMin=0,yMin=0,xMax=58,yMax=100；facing 必须是 "left" 或 "left-up"。
- 如果电视在画面右侧墙：tvWall 必须是 "right"，targetZone 必须在左半部，建议 xMin>=6, xMax<=40, yMin=46-55, yMax=78-86；forbiddenZones 必须包含 xMin=42,yMin=0,xMax=100,yMax=100；facing 必须是 "right" 或 "right-up"。
- 如果电视在画面后墙/上方背景墙：tvWall 必须是 "back"，targetZone 应在下方观看区，forbiddenZones 包含后墙电视下方区域；facing 使用 "up"。
- 如果没有明确电视墙，也必须输出最稳定的家具目标区和禁放区，tvWall 用 "none" 或 "unknown"。

决策规则：
- 优先级：如果房间参考图已有沙发、座椅、贵妃位或明确会客座位，原座位区是最高优先候选区；当它仍是最合理的位置时，用产品沙发替换原座位区，保持墙体依靠关系、主坐面朝向、与茶几/地毯/电视/通道的关系。
- 更合理区域规则：如果房间中存在比原座位区更合理的可放区域，可以不替换原家具，但必须满足：真实地面足够、靠墙/靠地毯/靠会客区关系成立、主坐面朝向合理、不挡窗/门/电视/通道/固定柜体，并且与原沙发或原座椅不会形成拥挤冲突。
- 原家具处理规则：原家具不是一定删除，也不是一定保留。选择替换时要移除原家具；选择新增到更合理区域时，可保留原家具作为配套座位，但产品沙发必须有明确功能位置，不能像随机摆在原沙发前方、画面中心或通道里。
- 先锁定不可移动结构，再找真实地面可放区，最后决定沙发落点和机位；不能先把沙发居中再反推房间。
- 沙发必须落在地面可承载区域，不能占用窗户/窗帘主体、门洞、主要通道、电视所在墙同侧贴墙区、电视下方、遮挡电视屏幕的位置、固定柜体前、墙体开口或明显过窄区域。
- 如果大窗/落地窗/窗帘是主要采光面，窗前可见空地不能因为“看起来空”就默认当作沙发区；除非原图本来有不挡窗主体的座位区，否则要保留窗前采光和通行，优先选择原座位区、地毯/茶几会客区、观看墙对侧或侧下方开阔地。
- 如果房间已有原沙发/座椅/地毯/茶几会客区，优先在同一会客逻辑区域内选择最合理位置：可以替换原座位家具，也可以在更合理的空位新增，但必须保持与电视/茶几/地毯/通道的真实室内设计关系；不能把商品放到原沙发前方另起一排或堵住动线。
- 如果房间有电视/媒体墙/壁炉墙/主观看墙，沙发必须在观看墙对侧或斜对侧的可用地面，主坐面朝向它或斜向它；不能放在电视所在墙同侧、电视下方或电视旁边贴墙区，不能面向窗户而背离观看墙。
- TV 几何硬约束：
  - 如果电视/媒体墙在画面左侧墙，电视所在左侧 58% 区域和电视下方/旁边贴墙区全部 0 分；产品沙发主体和主要体量必须避开 X<58% 的电视同侧区，优先在 X=60%-94%、Y=46%-84% 的右半部/右下/中下观看区，主坐面朝左/左上看电视。
  - 如果电视/媒体墙在画面右侧墙，电视所在右侧 58% 区域和电视下方/旁边贴墙区全部 0 分；产品沙发主体和主要体量必须避开 X>42% 的电视同侧区，优先在 X=6%-40%、Y=46%-84% 的左半部/左下/中下观看区，主坐面朝右/右上看电视。
  - 如果电视/媒体墙在画面后墙/上方背景墙，电视所在后墙同侧贴墙区和电视下方全部 0 分；产品沙发中心应在画面下方前景观看区，通常 Y=58%-86%，主坐面朝后墙/上方看电视。
  - 如果电视/媒体墙在画面前景/下方近处，电视所在前景同侧区全部 0 分；产品沙发中心应在画面上方/中后方观看区，通常 Y=18%-48%，主坐面朝前景/下方看电视。
  - 只要沙发背靠或贴近电视所在墙、位于电视下方、位于电视旁边同墙贴墙区、或主坐面没有朝向电视，这个候选区必须淘汰。
- 如果房间没有明确观看墙，选择最稳定、最开阔、不会挡光挡路的地面区域，优先与地毯/茶几/原座位区形成会客关系。
- 大沙发应有稳定家具落位：优先靠墙、靠原座位区、靠地毯/茶几后侧或清晰会客边界。除非原房间就是岛式沙发布局且四周通道充足，否则不要把大沙发孤立放在画面中央或前景。
- 物理坐向与拍摄角度必须分开：沙发主坐面朝向电视/茶几/会客中心；相机可以从正面、侧面或斜侧拍，但不能为了看到商品正面而旋转沙发，使它背离电视/茶几或挡住动线。
- 体量控制：按房间透视决定沙发真实尺寸，不能因为中景/近景把完整大沙发放大到占据房间主要通道；中景通过相机靠近和裁切实现，物理落点和尺寸不变。
- 远景/中景/近景共用同一个“唯一锁定落点”，只能改变相机位置、焦段、高度、景深和裁切，不能改变房间构造，也不能重新选择沙发位置。
- 拍摄角度不固定，可以正面、侧面、背侧或斜侧；角度只服务于远景/中景/近景区分和产品展示，不能改变唯一锁定落点。
- 镜头角度自由低于房间底片锁定：可以推近、裁切和微调焦段，但不能改变房间参考图的相机方向、墙体方位、电视所在墙、窗户和固定柜体位置。
- 物理落位必须与景别无关：当前请求是远景、中景还是近景，都必须输出同一个适用于所有景别的 targetZone；景别只能改变最终画面的裁切和主体占比，不能改变 targetZone。
- 近景不是完整沙发主图。近景必须裁掉一部分沙发边界，只看局部材质、扶手、坐垫、靠背、缝线或接触阴影；如果画面里能看见完整沙发全貌并占满前景，视为错误。
- 当商品展示角度与合理落位冲突时，优先合理落位；通过相机移动、焦段、裁切和景深来展示商品。
- 产品纯净度：最终图不能新增产品参考图中没有的文字、Logo、品牌名、商标、图案、刺绣、标签、徽章或额外抱枕；房间图中的装饰文字、画作、抱枕图案和临时摆件不能转移到产品沙发上。
- 产品图非沙发物件绝不参与落位：产品图里的茶几、玩偶/公仔、灯、墙柜、地毯、餐桌、画作、背景墙、窗帘、装饰摆件、水印和界面元素，都不是空间参考，不能被带到目标房间，也不能作为“产品配套”一起移动。
`,
    },
    { text: '【房间参考图】请以这张图作为唯一空间结构来源。' },
    { inlineData: { data: roomData, mimeType: roomMimeType } },
  ];

  if (productData && productMimeType) {
    parts.push(
      { text: '【沙发产品参考图】只用于判断沙发本体体量、模块、靠背/坐面/扶手方向和真实占地；必须把沙发本体与背景隔离。茶几、玩偶/公仔、灯、柜体、地毯、墙面、窗帘、餐桌、画作、文字、水印和其他物体全部不是产品，也不是空间参考，最终图禁止复制。' },
      { inlineData: { data: productData, mimeType: productMimeType } },
    );
  }

  const response = await retryWithBackoff(() => withTimeout(
    client.models.generateContent({
      model: process.env.GEMINI_PLACEMENT_MODEL || 'gemini-2.5-flash',
      contents: { parts },
      config: {
        responseMimeType: 'text/plain',
      },
    }),
    Number(process.env.PLACEMENT_ANALYSIS_TIMEOUT_MS || 18000),
    '空间落位分析超时，请稍后重试'
  ), 1);

  const directText = typeof response.text === 'string' ? response.text.trim() : '';
  if (directText) return directText;

  const partText = (response.candidates?.[0]?.content?.parts || [])
    .map((part: any) => part.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!partText) {
    throw new Error('空间落位分析未返回文本方案');
  }
  return partText;
}

export async function generateProductIdentityWithGemini({
  productData,
  productMimeType,
}: {
  productData: string;
  productMimeType: string;
}) {
  const client = getGeminiClient();
  const parts: any[] = [
    {
      text: `
你是一位极其严格的商品视觉身份分析师。请只分析【沙发产品参考图】里的沙发本体，输出供后续 AI 生图 100% 还原同一件商品使用的“产品身份指纹”。

核心原则：
- 产品参考图不是风格参考，而是唯一商品外观来源。后续生成必须是同一件沙发，不是相似款、同类款、重设计款或更好看的改款。
- 必须把沙发本体与背景隔离。墙面文字、标题、价格、标签、海报字、房间家具、地毯、茶几、灯具、柜体、餐桌、窗帘、画作、玩偶/公仔、摆件、水印、界面按钮都不是产品本体。
- 如果产品图是生活场景照，只把“沙发本体像素”当产品。产品周围的茶几、玩偶/公仔、灯、墙柜、餐桌、地毯、画作、绿植、窗帘和房间布局全部是拍摄环境，最终图禁止复制到新房间。
- 产品图的拍摄角度不是最终摆放角度。最终可以从正面、侧面、背侧或斜侧拍摄同一件沙发，但不得改变其轮廓、模块、靠背/坐面/扶手、材质颜色和细节。
- 只记录图片中清晰可见的事实；不确定就写“不确定/未见”，不要脑补。
- 如果产品图里没有抱枕、靠包、毯子、印花、Logo、文字、标签或装饰件，必须明确写“未见，最终图禁止新增”。

只输出中文结构化文本，不要写寒暄，不要生成图片。必须按以下标题输出：
1. 产品身份一句话：用一句话说明这是一件什么沙发，以及最终图必须保持“同一件商品”。
2. 不可变整体轮廓：沙发长宽高比例、座位数量/模块数量、整体宽窄厚薄、靠背高度、顶部线条、底部落地方式。
3. 不可变结构：扶手位置和形状、靠背结构、坐垫/座包分割、缝线/拼接、凹陷/扣点/褶皱、腿部/底座、左右对称或不对称关系。
4. 不可变坐向指纹：判断靠背侧、主坐面/开口侧、扶手侧、长轴方向、贵妃/躺位方向；说明后续落位时可以改变摄影角度，但主坐面必须朝向目标房间里的电视/茶几/会客中心。
5. 不可变材质颜色：主色、明暗层次、面料/皮革质感、纹理颗粒、光泽、软硬和厚重感。
6. 可见附属物：只列沙发本体上真实存在且固定属于产品的抱枕、靠包、毯子、图案、文字、Logo、标签；没有就逐项写“未见，最终图禁止新增”。放在茶几、地面、柜子或灯上的物体不算附属物。
7. 必须忽略的非产品信息：列出产品图中的背景、墙面文字、空间装饰、其他家具或界面元素，尤其是茶几、玩偶/公仔、落地灯/吊灯、墙柜/柜体、地毯、餐桌、画作、窗帘、绿植、摆件、水印，说明最终图不能把这些复制到沙发或房间里。
8. 产品边界口令：用一句话说明“只抠取沙发本体，非沙发物件全部视为透明背景，不得随产品一起迁移”。
9. 绝对禁止改动：写出最容易被模型改错的 5-8 项，例如改变颜色、改扶手、改靠背、改坐垫数量、加抱枕、加文字/Logo、换成相似款、简化纹理、复制产品图茶几/玩偶/灯/柜体等。
10. 最终硬约束口令：一句话，格式为“生成时只允许改变目标房间光线透视适配和摄影角度；沙发本体必须与产品参考图的轮廓、结构、颜色、材质、模块和细节完全一致，禁止新增产品图没有的任何信息，禁止复制产品图里的非沙发物件。”
`,
    },
    { text: '【沙发产品参考图】只分析沙发本体，背景文字和空间不是商品。' },
    { inlineData: { data: productData, mimeType: productMimeType } },
  ];

  const response = await retryWithBackoff(() => withTimeout(
    client.models.generateContent({
      model: process.env.GEMINI_PRODUCT_IDENTITY_MODEL || process.env.GEMINI_PLACEMENT_MODEL || 'gemini-2.5-flash',
      contents: { parts },
      config: {
        responseMimeType: 'text/plain',
      },
    }),
    Number(process.env.PRODUCT_IDENTITY_TIMEOUT_MS || 18000),
    '商品身份分析超时，请稍后重试'
  ), 1);

  const directText = typeof response.text === 'string' ? response.text.trim() : '';
  if (directText) return directText;

  const partText = (response.candidates?.[0]?.content?.parts || [])
    .map((part: any) => part.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!partText) {
    throw new Error('商品身份分析未返回文本方案');
  }
  return partText;
}

export async function saveGeneratedImageToSaas({
  userId,
  toolId,
  generatedBase64,
  mimeType,
  saasInfo,
  skipConsume = false,
}: {
  userId: string;
  toolId: string;
  generatedBase64: string;
  mimeType: string;
  saasInfo?: SaasInfo;
  skipConsume?: boolean;
}) {
  if (!skipConsume) {
    await runSaasSaveStep('consume', '扣费', () => consumePoints(userId, toolId, saasInfo));
  }

  const imageBuffer = Buffer.from(generatedBase64, 'base64');
  const fileSize = imageBuffer.length;
  const tokenData = await runSaasSaveStep('upload-token', '获取上传凭证', () =>
    getDirectToken(userId, toolId, fileSize, mimeType, saasInfo)
  );
  await runSaasSaveStep('oss-upload', 'OSS上传', () =>
    uploadToOss(tokenData.uploadUrl, tokenData.method, tokenData.headers, imageBuffer, mimeType)
  );
  const commitData = await runSaasSaveStep('upload-commit', '图片入库', () =>
    commitUpload(userId, toolId, tokenData.objectKey, fileSize, saasInfo)
  );

  return {
    image: commitData.image?.url || commitData.url || `data:${mimeType};base64,${generatedBase64}`,
    recordId: commitData.image?.recordId || commitData.recordId,
    url: commitData.image?.url || commitData.url,
    fileName: commitData.image?.fileName || commitData.fileName,
    fileSize,
  };
}
