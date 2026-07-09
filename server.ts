import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// Load environment variables
dotenv.config();

// Initialize Gemini SDK lazily to avoid crashing if GEMINI_API_KEY is missing on startup
let aiClient: GoogleGenAI | null = null;

const MAX_INPUT_IMAGE_BYTES = 15 * 1024 * 1024;
const AI_GENERATION_TIMEOUT_MS = 120000;
const SAAS_SHORT_TIMEOUT_MS = 30000;
const SAAS_UPLOAD_TIMEOUT_MS = 120000;
const TRANSIENT_ERROR_PATTERN = /503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout|Timeout|high demand/i;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Utility to convert remote URL or local base64 input into standard base64 for Gemini
async function getBase64FromUrlOrData(input: string): Promise<{ data: string; mimeType: string }> {
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
  
  // Fetch remote image and convert to base64
  try {
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
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_INPUT_IMAGE_BYTES) {
      throw new Error(`远程图片超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 限制`);
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
  } catch (error: any) {
    throw new Error(`Failed to download reference image: ${error.message || error}`);
  }
}

const SAAS_ORIGIN = process.env.SAAS_ORIGIN || 'https://aibigtree.com';

function isBlockedHostname(hostname: string) {
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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number, stepName: string) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const message = err?.message || String(err);
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(message);
    if (isTimeout) {
      throw new Error(`${stepName}超时(${Math.round(timeoutMs / 1000)}s)，请稍后重试`);
    }
    throw err;
  }
}

async function readJsonResponse(res: Response, fallbackLabel: string) {
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 2, delayMs = 1200): Promise<T> {
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
      console.warn(`Transient Gemini/SaaS error (attempt ${attempt}/${retries}): ${message}. Retrying in ${Math.round(waitMs)}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function verifyBeforeGenerate(userId: string, toolId: string) {
  const res = await fetchWithTimeout(`${SAAS_ORIGIN}/api/tool/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  }, SAAS_SHORT_TIMEOUT_MS, '积分校验');
  return readJsonResponse(res, '积分校验');
}

async function consumePoints(userId: string, toolId: string) {
  const res = await fetchWithTimeout(`${SAAS_ORIGIN}/api/tool/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  }, SAAS_SHORT_TIMEOUT_MS, '扣费');
  return readJsonResponse(res, '扣费');
}

async function getDirectToken(userId: string, toolId: string, fileSize: number) {
  const res = await fetchWithTimeout(`${SAAS_ORIGIN}/api/upload/direct-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      mimeType: 'image/png',
      fileName: 'result.png',
      fileSize
    })
  }, SAAS_SHORT_TIMEOUT_MS, '获取直传Token');
  return readJsonResponse(res, '获取直传Token');
}

async function uploadToOss(uploadUrl: string, method: string, headers: any, imageBuffer: Buffer) {
  const res = await fetchWithTimeout(uploadUrl, {
    method: method || 'PUT',
    headers: {
      ...headers,
      'Content-Type': headers?.['Content-Type'] || headers?.['content-type'] || 'image/png',
    },
    body: imageBuffer
  }, SAAS_UPLOAD_TIMEOUT_MS, 'OSS直传图片');
  if (!res.ok) {
    throw new Error(`OSS直传图片失败, 状态码: ${res.status}`);
  }
}

async function commitUpload(userId: string, toolId: string, objectKey: string, fileSize: number) {
  const res = await fetchWithTimeout(`${SAAS_ORIGIN}/api/upload/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      objectKey,
      fileSize
    })
  }, SAAS_SHORT_TIMEOUT_MS, '提交入库');
  const data = await readJsonResponse(res, '提交入库');
  if (!res.ok || data.success === false || !data.savedToRecords) {
    throw new Error(data.message || data.error || `确认入库失败, 状态码: ${res.status}`);
  }
  return data;
}

async function generateImageWithGemini({
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
      ));

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
      console.warn(`Image model ${modelName} failed:`, err?.message || err);
    }
  }

  throw lastError || new Error('模型生成失败');
}

async function saveGeneratedImageToSaas({
  userId,
  toolId,
  generatedBase64,
  mimeType,
}: {
  userId: string;
  toolId: string;
  generatedBase64: string;
  mimeType: string;
}) {
  await consumePoints(userId, toolId);

  const imageBuffer = Buffer.from(generatedBase64, 'base64');
  const fileSize = imageBuffer.length;
  const tokenData = await getDirectToken(userId, toolId, fileSize);
  await uploadToOss(tokenData.uploadUrl, tokenData.method, tokenData.headers, imageBuffer);
  const commitData = await commitUpload(userId, toolId, tokenData.objectKey, fileSize);

  return {
    image: commitData.image?.url || commitData.url || `data:${mimeType};base64,${generatedBase64}`,
    recordId: commitData.image?.recordId || commitData.recordId,
    url: commitData.image?.url || commitData.url,
    fileName: commitData.image?.fileName || commitData.fileName,
    fileSize,
  };
}

async function startServer() {
  const app = express();
  
  // Increase payload limit to support large base64 uploads (up to 20MB)
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true }));

  // Request logger middleware to assist in tracking incoming SaaS proxy requests
  app.use((req, res, next) => {
    console.log(`[Express Request] ${req.method} ${req.path}`);
    next();
  });

  // API Route: Generic Proxy to support 20mb payload limit and proxying to external APIs
  app.all('/api/proxy', async (req, res) => {
    try {
      const { targetUrl, url } = req.body || {};
      const actualUrl = targetUrl || url;
      if (!actualUrl) {
        return res.json({ success: true, message: 'Proxy endpoint active with 20mb limit' });
      }
      const parsedTarget = new URL(actualUrl);
      const allowedOrigins = new Set([
        new URL(SAAS_ORIGIN).origin,
      ]);
      if (!allowedOrigins.has(parsedTarget.origin) || isBlockedHostname(parsedTarget.hostname)) {
        return res.status(403).json({ success: false, error: 'Proxy target is not allowed' });
      }
      const proxyRes = await fetchWithTimeout(actualUrl, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          ...req.headers as any,
          host: new URL(actualUrl).host,
        },
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      }, SAAS_SHORT_TIMEOUT_MS, '代理请求');
      const data = await readJsonResponse(proxyRes, '代理请求');
      res.status(proxyRes.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Route: Launch SaaS integration
  app.post('/api/tool/launch', async (req, res) => {
    try {
      const { userId, toolId } = req.body;
      
      if (!userId || !toolId) {
        // Return standard mock data in preview/local sandbox
        return res.json({
          success: true,
          data: {
            user: {
              id: 'mock_user_123',
              name: '试用体验账号',
              enterprise: '常州设计美学工作室',
              integral: 999,
              role: 1
            },
            tool: {
              id: 'mock_tool_456',
              name: '沙发智能空间生图系统',
              integral: 10,
              status: 'active'
            }
          }
        });
      }

      console.log(`Proxying launch request to SaaS: user ${userId}, tool ${toolId}`);
      const saasRes = await fetch(`${SAAS_ORIGIN}/api/tool/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, toolId })
      });
      
      const text = await saasRes.text();
      let saasData;
      try {
        saasData = JSON.parse(text);
      } catch (e) {
        return res.status(saasRes.status).json({ success: false, error: text || 'SaaS Launch Response Error' });
      }

      return res.status(saasRes.status).json(saasData);
    } catch (err: any) {
      console.error('Launch proxy failed, using fallback:', err);
      return res.json({
        success: true,
        data: {
          user: {
            id: 'mock_user_123',
            name: '预览调试用户',
            enterprise: '系统演示环境',
            integral: 500,
            role: 1
          },
          tool: {
            id: 'mock_tool_456',
            name: '沙发智能空间生图系统',
            integral: 10,
            status: 'active'
          }
        }
      });
    }
  });

  // API Route: Generate Sofa Scene (Dual-endpoint registration to bypass SaaS proxy conflicts)
  app.post(['/api/generate', '/api/generate-sofa'], async (req, res) => {
    try {
      console.log(`[Express API Hit] Path matched: ${req.path}`);
      const {
        userId,
        toolId,
        productImage,
        roomImage,
        angle = '45度侧切正面',
        height = '1.2米',
        lighting = '柔和自然光',
        aspectRatio = '4:3',
        imageSize = '1K',
        customPrompt = '',
      } = req.body;

      if (!productImage || !roomImage) {
        return res.status(400).json({ error: '请上传或选择产品参考图与房间参考图' });
      }

      console.log('--- Generative Sofa Scene Request ---');
      console.log(`User: ${userId}, Tool: ${toolId}`);
      console.log(`Angle: ${angle}, Height: ${height}, Lighting: ${lighting}, Aspect Ratio: ${aspectRatio}`);

      // If SaaS info is provided and not mock, execute points validation first
      const isSaaS = userId && toolId && !userId.startsWith('mock_');
      if (isSaaS) {
        try {
          console.log('Validating points on SaaS platform for user:', userId);
          await verifyBeforeGenerate(userId, toolId);
          console.log('SaaS point verification passed!');
        } catch (verifyErr: any) {
          console.error('SaaS Point Verification Failed:', verifyErr);
          return res.status(400).json({ error: verifyErr.message || '积分校验失败，无法开始生成' });
        }
      }

      // Prepare image parts
      let productPart;
      let roomPart;
      try {
        const prodData = await getBase64FromUrlOrData(productImage);
        productPart = {
          inlineData: {
            data: prodData.data,
            mimeType: prodData.mimeType,
          },
        };

        const rData = await getBase64FromUrlOrData(roomImage);
        roomPart = {
          inlineData: {
            data: rData.data,
            mimeType: rData.mimeType,
          },
        };
      } catch (err: any) {
        console.error('Image processing error:', err);
        return res.status(400).json({ error: `图像预处理失败: ${err.message}` });
      }

      // Format custom settings in the prompt
      const promptText = `
你是一位极其严谨的专业家居电商摄影师和空间合成专家。
你的任务是将提供的【产品参考图】（第一张沙发）完美、无缝地融入到【房间参考图】（第二张客厅/房间空间）中。

请严格遵守以下还原与合成逻辑：

【产品还原逻辑 - 绝对最高优先级】
1. 必须完全保留并严密还原【产品参考图】中沙发的全部造型与物理特征：
   - 整体款式、轮廓造型、座位数量必须100%一致。
   - 扶手设计和结构、靠背高度、倾斜角度。
   - 缝线走向、褶皱痕迹、坐垫数量和厚度。
   - 布料或皮革的真实材质纹理与原本的颜色。
   - 腿部结构（无论是金属、木质还是隐藏式底座）。
2. 绝对不允许对沙发进行款式改装或合并其他设计。

【房间融合逻辑 - 真实摄影棚质感】
1. 【房间参考图】仅用于提供背景空间框架、墙面颜色、地面材质、光线方向、窗户布局、其他既有家具风格和整体氛围。
2. 将沙发摆放在房间中合理的地面位置，保持完美的透视比例与空间深度，看起来像是一开始就摆在那里。
3. 必须生成沙发的真实接触阴影（Contact Shadows）和投射阴影。沙发与地面、地毯的接触边缘应有非常细腻的暗部过渡和光线折射，绝不能有生硬抠图感。
4. 沙发本身的受光方向、高光、阴影必须与房间参考图中的光源方向完全吻合。
5. 针对沙发在当前场景中，融合调整为以下设置：
   - 生成视角: ${angle}。
   - 镜头高度: ${height}。
   - 环境光线: ${lighting}。
   ${customPrompt ? `- 附加氛围描述: ${customPrompt}` : ''}

【生成镜头与画面要求】
1. 构图：沙发完整入镜，作为绝对画面主体，占据中景位置。后景显示房间的部分墙面、窗户、盆栽、地毯等，形成和谐、高端、通透的样板间视觉。
2. 画质：高端电商主图级别，照片级真实摄影，8K极清晰细节，真实阴影，真实比例，单张完整照片。
3. 限制：画面中绝对不能出现任何文字、水印、额外品牌LOGO、人物（不能有模特坐在沙发上）、多图拼接、分屏、漫画插画风格，必须是单张高精度实景摄影作品。

请生成最终合成后的单张实景照片。
`;

      try {
        console.log('Sending request to Gemini image models...');
        const { generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
          parts: [
            { text: '【产品参考图】必须优先还原此沙发的款式、比例、材质、颜色和细节。' },
            productPart,
            { text: '【房间参考图】仅用于空间结构、光线、地面、墙面和整体氛围参考。' },
            roomPart,
            { text: promptText },
          ],
          aspectRatio,
          imageSize,
        });

          console.log('Successfully generated image via Gemini!');
          
          if (isSaaS) {
            try {
              console.log('SaaS Active: Consuming points, uploading result, and committing record...');
              const savedImage = await saveGeneratedImageToSaas({
                userId,
                toolId,
                generatedBase64,
                mimeType,
              });
              console.log('SaaS Active: Full SaaS integration pipeline completed successfully!');
              return res.json({
                success: true,
                ...savedImage,
                modelUsed,
                info: infoText.trim(),
              });
            } catch (saasErr: any) {
              console.error('SaaS Active: Integration pipeline failed downstream of Gemini generation:', saasErr);
              return res.status(502).json({
                success: false,
                errorMessage: `生图成功，但SaaS保存失败，结果未入库: ${saasErr.message || saasErr}`,
                generatedPreview: `data:${mimeType};base64,${generatedBase64}`,
                modelUsed,
              });
            }
          }

          // Standalone preview / sandbox mode
          return res.json({
            success: true,
            image: `data:${mimeType};base64,${generatedBase64}`,
            modelUsed,
            info: infoText.trim(),
          });

      } catch (geminiError: any) {
        console.error('Gemini direct API call failed:', geminiError);
        
        // Return structured error information and offer simulated fallback if key is missing/unauthorized
        const isKeyError = !process.env.GEMINI_API_KEY || 
                           geminiError.message?.includes('API_KEY') || 
                           geminiError.message?.includes('API key') ||
                           geminiError.status === 403 ||
                           geminiError.status === 401;

        return res.json({
          success: false,
          isKeyError,
          errorMessage: geminiError.message || '模型生成失败，请确认您的 API Key 具有相应权限。',
          fallbackMessage: '已自动为您启动“智能摄影棚数字孪生仿真合成”技术为您呈现场景预览。',
        });
      }

    } catch (outerError: any) {
      console.error('Outer handler error:', outerError);
      res.status(500).json({ error: outerError.message || '服务器内部错误' });
    }
  });

  // API Route: Chat-driven image generation
  app.post('/api/chat-generate', async (req, res) => {
    try {
      const {
        userId,
        toolId,
        prompt,
        productImage,
        roomImage,
        aspectRatio = '4:3',
        imageSize = '1K',
        history = [],
      } = req.body || {};

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ success: false, errorMessage: '请输入对话生图需求' });
      }

      const isSaaS = userId && toolId && !String(userId).startsWith('mock_');
      if (isSaaS) {
        try {
          await verifyBeforeGenerate(userId, toolId);
        } catch (verifyErr: any) {
          return res.status(400).json({ success: false, errorMessage: verifyErr.message || '积分校验失败，无法开始生成' });
        }
      }

      const parts: any[] = [];
      if (productImage) {
        const productData = await getBase64FromUrlOrData(productImage);
        parts.push({ text: '【沙发/商品参考图】最高优先级：保留款式、轮廓、颜色、材质纹理、缝线和结构比例。' });
        parts.push({
          inlineData: {
            data: productData.data,
            mimeType: productData.mimeType,
          },
        });
      }

      if (roomImage) {
        const roomData = await getBase64FromUrlOrData(roomImage);
        parts.push({ text: '【房间/场景参考图】用于空间结构、地面墙面、光线方向、镜头透视和整体氛围参考。' });
        parts.push({
          inlineData: {
            data: roomData.data,
            mimeType: roomData.mimeType,
          },
        });
      }

      const compactHistory = Array.isArray(history)
        ? history
            .filter((item: any) => item?.role && item?.content)
            .slice(-6)
            .map((item: any) => `${item.role === 'assistant' ? '助手' : '用户'}: ${String(item.content).slice(0, 500)}`)
            .join('\n')
        : '';

      const chatPrompt = `
你是一位专业家居电商图像导演，正在根据用户的对话生成单张高质量沙发/家居电商图片。

【对话上下文】
${compactHistory || '无'}

【用户最新需求】
${prompt.trim()}

【必须遵守】
1. 输出必须是一张完整、连续、真实摄影风格的单张图片，不要拼图、分屏、海报文字、水印、LOGO 或界面截图。
2. 如果提供了沙发/商品参考图，必须优先严格还原商品款式、颜色、材质、比例和关键细节，不要擅自改款。
3. 如果提供了房间/场景参考图，场景只用于空间、光线、风格和透视参考；需要让商品自然融入并生成真实接触阴影。
4. 如果用户只用文字描述，就按文字生成高端家居电商摄影图，构图干净、主体明确、可直接用于商品展示。
5. 光影、比例、透视、地面接触关系必须真实，避免悬浮感、抠图感和塑料质感。
`;

      parts.push({ text: chatPrompt });

      const { generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
        parts,
        aspectRatio,
        imageSize,
      });

      if (isSaaS) {
        try {
          const savedImage = await saveGeneratedImageToSaas({
            userId,
            toolId,
            generatedBase64,
            mimeType,
          });
          return res.json({
            success: true,
            ...savedImage,
            modelUsed,
            info: infoText,
          });
        } catch (saasErr: any) {
          return res.status(502).json({
            success: false,
            errorMessage: `生图成功，但SaaS保存失败，结果未入库: ${saasErr.message || saasErr}`,
            generatedPreview: `data:${mimeType};base64,${generatedBase64}`,
            modelUsed,
          });
        }
      }

      return res.json({
        success: true,
        image: `data:${mimeType};base64,${generatedBase64}`,
        modelUsed,
        info: infoText,
      });
    } catch (err: any) {
      console.error('Chat generation failed:', err);
      const isKeyError = !process.env.GEMINI_API_KEY ||
                         err.message?.includes('API_KEY') ||
                         err.message?.includes('API key') ||
                         err.status === 403 ||
                         err.status === 401;
      return res.status(500).json({
        success: false,
        isKeyError,
        errorMessage: err.message || '对话生图失败',
      });
    }
  });

  // Serve static files in production / set up dev server middleware
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Setup Vite in middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
