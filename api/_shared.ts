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
0. 执行口令：用一句话写清最终摆放命令，格式为“把产品沙发放在/替换到【画面方位/坐标范围】的【最合理可放区名称】，主坐面朝向【目标墙/电视/会客中心】，原家具处理为【替换/保留/移走/轻微调整】，禁止放在【本图关键禁放区】。”如果房间原图已有沙发/座椅，必须先评估原座位区是否最合理；如果不是，也要说明为什么选择另一个更合理区域。
1. 房间骨架锁定：说明电视/媒体墙、窗户/窗帘、门洞/阳台门、固定柜体、墙角、地面透视、主要通道分别在画面什么方位；不确定就写“不明确”，不要臆造。
2. 产品体量判断：根据产品图判断沙发是单人/双人/三人/多人/L形/躺位/组合模块，大致长宽比例、主坐面、靠背侧、扶手侧；只识别产品图中清晰存在的抱枕/靠包/装饰件，不要臆造文字、Logo、商标、标签、刺绣或图案。
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
10. 近景机位：相机如何靠近已合理落位的产品沙发拍扶手、坐垫、靠背、缝线和材质；可以自然裁切局部，但不能把完整沙发巨大化后重新摆到窗前/房间中央/通道，也不能把原家具当成混乱背景。
11. 绝对禁止的错误结果：明确写出本图最容易出错的 3-5 种摆法，必须包含“把产品沙发新增到原沙发前方/通道/房间中央，导致空间拥堵或双主沙发冲突”和“为了电商正面图把沙发实际坐向转成朝镜头而背离电视/茶几”。

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
  - 如果电视/媒体墙在画面左侧墙，电视所在左半区和电视下方/旁边贴墙区全部 0 分；产品沙发中心应在画面右半部或右下/下方观看区，主坐面朝左/左上看电视。
  - 如果电视/媒体墙在画面右侧墙，电视所在右半区和电视下方/旁边贴墙区全部 0 分；产品沙发中心应在画面左半部或左下/下方观看区，主坐面朝右/右上看电视。
  - 如果电视/媒体墙在画面后墙/上方背景墙，电视所在后墙同侧贴墙区和电视下方全部 0 分；产品沙发中心应在画面下方前景观看区，主坐面朝后墙/上方看电视。
  - 如果电视/媒体墙在画面前景/下方近处，电视所在前景同侧区全部 0 分；产品沙发中心应在画面上方/中后方观看区，主坐面朝前景/下方看电视。
  - 只要沙发背靠或贴近电视所在墙、位于电视下方、位于电视旁边同墙贴墙区、或主坐面没有朝向电视，这个候选区必须淘汰。
- 如果房间没有明确观看墙，选择最稳定、最开阔、不会挡光挡路的地面区域，优先与地毯/茶几/原座位区形成会客关系。
- 大沙发应有稳定家具落位：优先靠墙、靠原座位区、靠地毯/茶几后侧或清晰会客边界。除非原房间就是岛式沙发布局且四周通道充足，否则不要把大沙发孤立放在画面中央或前景。
- 物理坐向与拍摄角度必须分开：沙发主坐面朝向电视/茶几/会客中心；相机可以从正面、侧面或斜侧拍，但不能为了看到商品正面而旋转沙发，使它背离电视/茶几或挡住动线。
- 体量控制：按房间透视决定沙发真实尺寸，不能因为中景/近景把完整大沙发放大到占据房间主要通道；中景通过相机靠近和裁切实现，物理落点和尺寸不变。
- 远景/中景/近景共用同一个“唯一锁定落点”，只能改变相机位置、焦段、高度、景深和裁切，不能改变房间构造，也不能重新选择沙发位置。
- 拍摄角度不固定，可以正面、侧面、背侧或斜侧；角度只服务于远景/中景/近景区分和产品展示，不能改变唯一锁定落点。
- 当商品展示角度与合理落位冲突时，优先合理落位；通过相机移动、焦段、裁切和景深来展示商品。
- 产品纯净度：最终图不能新增产品参考图中没有的文字、Logo、品牌名、商标、图案、刺绣、标签、徽章或额外抱枕；房间图中的装饰文字、画作、抱枕图案和临时摆件不能转移到产品沙发上。
`,
    },
    { text: '【房间参考图】请以这张图作为唯一空间结构来源。' },
    { inlineData: { data: roomData, mimeType: roomMimeType } },
  ];

  if (productData && productMimeType) {
    parts.push(
      { text: '【沙发产品参考图】只用于判断沙发体量、朝向展示需求和大致形态；除非产品图中清晰存在，否则不要新增任何文字、Logo、品牌名、商标、图案、刺绣、标签或额外抱枕；不要采用其中的房间背景。' },
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
- 必须把沙发本体与背景隔离。墙面文字、标题、价格、标签、海报字、房间家具、地毯、茶几、灯具、柜体、摆件、水印、界面按钮都不是产品本体。
- 只记录图片中清晰可见的事实；不确定就写“不确定/未见”，不要脑补。
- 如果产品图里没有抱枕、靠包、毯子、印花、Logo、文字、标签或装饰件，必须明确写“未见，最终图禁止新增”。

只输出中文结构化文本，不要写寒暄，不要生成图片。必须按以下标题输出：
1. 产品身份一句话：用一句话说明这是一件什么沙发，以及最终图必须保持“同一件商品”。
2. 不可变整体轮廓：沙发长宽高比例、座位数量/模块数量、整体宽窄厚薄、靠背高度、顶部线条、底部落地方式。
3. 不可变结构：扶手位置和形状、靠背结构、坐垫/座包分割、缝线/拼接、凹陷/扣点/褶皱、腿部/底座、左右对称或不对称关系。
4. 不可变材质颜色：主色、明暗层次、面料/皮革质感、纹理颗粒、光泽、软硬和厚重感。
5. 可见附属物：只列沙发本体上真实存在的抱枕、靠包、毯子、图案、文字、Logo、标签；没有就逐项写“未见，最终图禁止新增”。
6. 必须忽略的非产品信息：列出产品图中的背景、墙面文字、空间装饰、其他家具或界面元素，说明最终图不能把这些复制到沙发或房间里。
7. 绝对禁止改动：写出最容易被模型改错的 5-8 项，例如改变颜色、改扶手、改靠背、改坐垫数量、加抱枕、加文字/Logo、换成相似款、简化纹理等。
8. 最终硬约束口令：一句话，格式为“生成时只允许改变房间、光线透视适配和摄影角度；沙发本体必须与产品参考图的轮廓、结构、颜色、材质、模块和细节完全一致，禁止新增产品图没有的任何信息。”
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
