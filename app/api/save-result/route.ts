import {
  SAAS_SAVE_TIMEOUT_MS,
  saveGeneratedImageToSaas,
  withTimeout,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

function parseGeneratedImage(input: string, mimeTypeFromBody?: string) {
  if (input.startsWith('data:')) {
    const matches = input.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('生成图片数据格式错误');
    }
    return {
      mimeType: matches[1],
      generatedBase64: matches[2],
    };
  }

  return {
    mimeType: mimeTypeFromBody || 'image/png',
    generatedBase64: input,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {userId, toolId, saasInfo, image, generatedBase64, mimeType} = body;
    const imageInput = image || generatedBase64;

    if (!userId || !toolId) {
      return Response.json({success: false, errorMessage: '缺少 userId 或 toolId'}, {status: 400});
    }

    if (!imageInput || typeof imageInput !== 'string') {
      return Response.json({success: false, errorMessage: '缺少待保存的生成图片'}, {status: 400});
    }

    const parsed = parseGeneratedImage(imageInput, mimeType);
    const savedImage = await withTimeout(
      saveGeneratedImageToSaas({
        userId,
        toolId,
        generatedBase64: parsed.generatedBase64,
        mimeType: parsed.mimeType,
        saasInfo,
      }),
      SAAS_SAVE_TIMEOUT_MS,
      `SaaS保存超时(${Math.round(SAAS_SAVE_TIMEOUT_MS / 1000)}s)，请稍后重试`
    );

    return Response.json({
      success: true,
      savedToSaas: true,
      ...savedImage,
    });
  } catch (err: any) {
    return Response.json({
      success: false,
      savedToSaas: false,
      errorMessage: err.message || 'SaaS保存失败',
    }, {status: 502});
  }
}
