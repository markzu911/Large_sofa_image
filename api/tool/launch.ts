import { getRequestBody, launchTool, sendJson } from '../_shared';

export const config = {
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, errorMessage: 'Method not allowed' });
  }

  try {
    const { userId, toolId } = await getRequestBody(req);

    if (!userId || !toolId) {
      return sendJson(res, 200, {
        success: true,
        data: {
          user: {
            id: 'mock_user_123',
            name: '试用体验账号',
            enterprise: '系统演示环境',
            integral: 999,
            role: 1,
          },
          tool: {
            id: 'mock_tool_456',
            name: '沙发智能空间生图系统',
            integral: 10,
            status: 'active',
          },
        },
      });
    }

    const data = await launchTool(userId, toolId);
    return sendJson(res, 200, data);
  } catch (err: any) {
    return sendJson(res, 200, {
      success: true,
      data: {
        user: {
          id: 'mock_user_123',
          name: '预览调试用户',
          enterprise: '系统演示环境',
          integral: 500,
          role: 1,
        },
        tool: {
          id: 'mock_tool_456',
          name: '沙发智能空间生图系统',
          integral: 10,
          status: 'active',
        },
      },
      warning: err.message || 'SaaS launch failed, using preview fallback',
    });
  }
}
