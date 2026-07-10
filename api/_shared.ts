import { GoogleGenAI } from '@google/genai';

export const MAX_INPUT_IMAGE_BYTES = 2 * 1024 * 1024;
export const AI_GENERATION_TIMEOUT_MS = Number(process.env.AI_GENERATION_TIMEOUT_MS || 32000);
export const SAAS_SHORT_TIMEOUT_MS = Number(process.env.SAAS_SHORT_TIMEOUT_MS || 8000);
export const SAAS_UPLOAD_TIMEOUT_MS = Number(process.env.SAAS_UPLOAD_TIMEOUT_MS || 45000);
export const SAAS_ORIGIN = normalizeSaasUrl(process.env.SAAS_ORIGIN || 'http://aibigtree.com');

const TRANSIENT_ERROR_PATTERN = /503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout|Timeout|high demand/i;
let aiClient: GoogleGenAI | null = null;

type SaasSaveStep = 'consume' | 'upload-token' | 'oss-upload' | 'upload-commit';

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

只输出中文结构化方案，不生成图片，不要写寒暄。必须按以下标题输出：
0. 执行口令：用一句话写清最终摆放命令，格式为“把沙发放在【画面方位/坐标范围】的【可放区名称】，主坐面朝向【目标墙/电视/会客中心】，禁止放在【本图关键禁放区】。”
1. 房间骨架锁定：说明电视/媒体墙、窗户/窗帘、门洞/阳台门、固定柜体、墙角、地面透视、主要通道分别在画面什么方位；不确定就写“不明确”，不要臆造。
2. 产品体量判断：根据产品图判断沙发是单人/双人/三人/多人/L形/躺位/组合模块，大致长宽比例、主坐面、靠背侧、扶手侧。
3. 电视观看关系：如果有电视/媒体墙，必须写清“电视所在墙/同侧贴墙区/电视下方/遮挡电视屏幕区域”为禁放区，并写清“电视对侧或斜对侧的观看区”为优先可放区；如果没有电视/媒体墙，写“无明确电视观看关系”。
4. 可替换对象：房间里哪些原有可移动家具可以被商品沙发替换或移走；哪些结构和固定家具绝对不能动。
5. 禁入边界：逐条列出本图不能放沙发的区域，尤其是窗户/窗帘主体前、门洞、通道、电视所在墙同侧贴墙区、电视下方、会遮挡电视屏幕的位置、固定柜体前、墙体开口、过窄或非地面的区域。
6. 唯一锁定落点：只给一个最终落点。必须同时写：
   - 画面方位，例如“画面下方偏右的开放地面/原座位区/地毯后侧/电视墙对侧”。
   - 大致归一化坐标范围，例如“沙发中心约 X=35%-55%, Y=62%-78%”，这里的 Y 指画面从上到下。
   - 沙发底部/四脚/底座应贴合哪一块地面透视线。
   - 主坐面朝向，例如“朝向画面左侧电视墙/斜朝主背景墙/朝向茶几会客中心”。
7. 远景机位：相机如何后退展示空间，沙发占比小但仍在同一锁定落点。
8. 中景机位：相机如何靠近成为电商主图，沙发占比适中但仍在同一锁定落点。
9. 近景机位：相机如何靠近已落位沙发拍扶手、坐垫、靠背、缝线和材质；可以自然裁切局部，但不能把完整沙发巨大化后重新摆到窗前/房间中央/通道。
10. 绝对禁止的错误结果：明确写出本图最容易出错的 3-5 种摆法。

决策规则：
- 先锁定不可移动结构，再找真实地面可放区，最后决定沙发落点和机位；不能先把沙发居中再反推房间。
- 沙发必须落在地面可承载区域，不能占用窗户/窗帘主体、门洞、主要通道、电视所在墙同侧贴墙区、电视下方、遮挡电视屏幕的位置、固定柜体前、墙体开口或明显过窄区域。
- 如果大窗/落地窗/窗帘是主要采光面，窗前可见空地不能因为“看起来空”就默认当作沙发区；除非原图本来有不挡窗主体的座位区，否则要保留窗前采光和通行，优先选择原座位区、地毯/茶几会客区、观看墙对侧或侧下方开阔地。
- 如果房间已有原沙发/座椅/地毯/茶几会客区，优先用商品沙发替换原座位家具或落在同一会客逻辑区域。
- 如果房间有电视/媒体墙/壁炉墙/主观看墙，沙发必须在观看墙对侧或斜对侧的可用地面，主坐面朝向它或斜向它；不能放在电视所在墙同侧、电视下方或电视旁边贴墙区，不能面向窗户而背离观看墙。
- 如果电视/媒体墙在画面左侧墙，优先在画面右半部或右下/下方开阔地选择观看区，主坐面朝左；如果电视/媒体墙在画面右侧墙，优先在画面左半部或左下/下方开阔地选择观看区，主坐面朝右；如果电视/媒体墙在画面后墙，优先在画面下方前景可用地面选择观看区，主坐面朝后墙。
- 如果房间没有明确观看墙，选择最稳定、最开阔、不会挡光挡路的地面区域，优先与地毯/茶几/原座位区形成会客关系。
- 远景/中景/近景共用同一个“唯一锁定落点”，只能改变相机位置、焦段、高度、景深和裁切，不能改变房间构造，也不能重新选择沙发位置。
- 当商品展示角度与合理落位冲突时，优先合理落位；通过相机从正面、侧面、背侧或斜侧移动来展示商品。
`,
    },
    { text: '【房间参考图】请以这张图作为唯一空间结构来源。' },
    { inlineData: { data: roomData, mimeType: roomMimeType } },
  ];

  if (productData && productMimeType) {
    parts.push(
      { text: '【沙发产品参考图】只用于判断沙发体量、朝向展示需求和大致形态，不要采用其中的房间背景。' },
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
