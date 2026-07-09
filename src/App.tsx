'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Sparkles,
  Download,
  RefreshCw,
  AlertCircle,
  Camera,
  Trash2,
  Monitor,
  Check,
  Compass,
  Send,
  MessageCircle,
  Bot,
  UserRound,
  Image as ImageIcon,
  Home as HomeIcon,
  ArrowRight,
  Wand2,
  Settings,
  Images,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type WorkspaceMode = 'HOME' | 'STANDARD' | 'CHAT';
type ChatActionType =
  | 'uploadProduct'
  | 'uploadRoom'
  | 'generate'
  | 'shot'
  | 'resolution'
  | 'prompt';
type ChatGeneration = {
  status: 'loading' | 'success' | 'error' | 'pending';
  title?: string;
  image?: string | null;
  error?: string;
  note?: string;
  shot?: 'far' | 'medium' | 'close';
  resolution?: '1K' | '2K' | '4K' | '8K';
};
type ChatAction = {
  type: ChatActionType;
  label: string;
  value?: string;
  description?: string;
  prompt?: string;
};
type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  image?: string | null;
  images?: string[];
  actions?: ChatAction[];
  generation?: ChatGeneration;
  imageCategory?: 'product' | 'room';
};

type SaasInfo = {
  userId?: string | null;
  toolId?: string | null;
  context?: string;
  prompt?: string[];
  apiBaseUrl?: string;
  launchUrl?: string;
  verifyUrl?: string;
  consumeUrl?: string;
  uploadTokenUrl?: string;
  uploadCommitUrl?: string;
};

const SHOT_PRESETS = [
  {
    id: 'far',
    name: '空间俯拍全景 (远景)',
    height: '1.8米高角度俯拍',
    angle: '广角镜头向下 30度俯拍',
    scale: 0.38,
    description: '广角视野，重点展现沙发在全屋硬装、地毯与灯光下的整体空间协同美感。',
    promptGuide: '广角全景镜头，高位俯视30度视角。捕捉整个客厅的深远空间和豪华软装布局。沙发完整呈现在地毯和画面正中心，与周围植物、壁炉形成和谐的整体空间透视。具有极高品质的空间摄影感。'
  },
  {
    id: 'medium',
    name: '视平斜角半景 (中景)',
    height: '1.2米标准视平',
    angle: '斜侧 45度角三维透视',
    scale: 0.55,
    description: '商业经典摄影视角，完美兼顾沙发的立体形态轮廓与背景墙体线条。',
    promptGuide: '视平线中焦摄影镜头，正面45度倾斜角空间透视。沙发占据画面黄金比例位置，精确展现沙发整体材质轮廓、背垫与扶手细节，背景深度虚化适度。'
  },
  {
    id: 'close',
    name: '局部仰位特写 (近景)',
    height: '0.8米低空仰位',
    angle: '低仰角斜侧微距特写',
    scale: 0.72,
    description: '大光圈虚化，极致突出沙发的皮质细纹、布艺经纬与细腻车缝缝隙。',
    promptGuide: '低角度仰视微距镜头，大光圈浅景深。极近距离刻画沙发的局部细节和高超缝纫车线。焦点聚集在沙发皮革天然纹路、褶皱阴影及质感材质，背景完美虚化。'
  }
] as const;

const CHAT_WELCOME_ACTIONS: ChatAction[] = [
  { type: 'uploadProduct', label: '上传沙发图', description: '锁定款式、材质和比例' },
  { type: 'uploadRoom', label: '上传房间图', description: '锁定空间、光影和透视' },
  {
    type: 'prompt',
    label: '现代奶油风主图',
    description: '直接套用高转化电商构图',
    prompt: '生成现代奶油风客厅沙发电商主图，午后自然光，沙发在画面中心，地毯接触阴影真实，整体高级干净。',
  },
  {
    type: 'prompt',
    label: '微距材质特写',
    description: '突出皮纹/布纹/缝线',
    prompt: '生成沙发材质微距特写图，强调面料纹理、车缝细节、褶皱和柔和侧光，背景自然虚化。',
  },
];

const getChatId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getSaasInfoKey = (info: SaasInfo) =>
  [
    info.apiBaseUrl,
    info.launchUrl,
    info.verifyUrl,
    info.consumeUrl,
    info.uploadTokenUrl,
    info.uploadCommitUrl,
  ].filter(Boolean).join('|');

function ChatGenerationLoadingCard({ generation }: { generation: ChatGeneration }) {
  const [progress, setProgress] = useState(8);
  const shotName = SHOT_PRESETS.find((preset) => preset.id === generation.shot)?.name || '自由构图';
  const steps = [
    '解析对话需求、参考图和电商构图目标...',
    '锁定沙发款式、比例、材质纹理与关键细节...',
    '匹配空间透视、接触阴影和自然光照方向...',
    '执行高端家居摄影级画面渲染与清晰度校准...',
  ];
  const currentStep = progress < 28 ? 0 : progress < 58 ? 1 : progress < 84 ? 2 : 3;

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((value) => {
        if (value < 28) return Math.min(28, value + Math.floor(Math.random() * 5) + 2);
        if (value < 58) return Math.min(58, value + Math.floor(Math.random() * 4) + 1);
        if (value < 84) return Math.min(84, value + Math.floor(Math.random() * 3) + 1);
        if (value < 97) return Math.min(97, value + 0.6);
        return value;
      });
    }, 520);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-3 w-full max-w-[34rem] rounded-2xl border border-[#E8E3D9] bg-white p-5 shadow-[0_14px_34px_rgba(44,41,38,0.08)] space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#FAF8F5] flex items-center justify-center text-[#B8975A] shrink-0">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="font-serif font-bold text-[#1F1D1B] leading-tight">
              {generation.title || 'AI 对话生图生成中'}
            </p>
            <p className="text-xs text-[#78716C] mt-1">{shotName}</p>
          </div>
        </div>
        <span className="rounded-full bg-[#FAF6EE] px-3 py-1.5 text-xs font-bold text-[#B8975A] shrink-0">
          {generation.resolution || '2K'}
        </span>
      </div>

      <div className="rounded-xl bg-[#FAF8F5] border border-[#E8E3D9] p-4 grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="text-[#78716C] mb-1">镜头景别</p>
          <p className="font-bold text-[#2C2926]">{shotName}</p>
        </div>
        <div>
          <p className="text-[#78716C] mb-1">输出清晰度</p>
          <p className="font-bold text-[#2C2926]">{generation.resolution || '2K'}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] font-bold">
          <span className="text-[#78716C]">整体渲染进度</span>
          <span className="text-[#B8975A]">{Math.floor(progress)}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[#E8E3D9] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#2E2B28] transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="space-y-2 pt-1">
          {steps.map((stepText, stepIndex) => {
            const isCompleted = stepIndex < currentStep;
            const isActive = stepIndex === currentStep;
            return (
              <div key={stepText} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 w-4 h-4 rounded-full border border-[#E8E3D9] flex items-center justify-center shrink-0 bg-white">
                  {isCompleted ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : isActive ? (
                    <span className="w-2 h-2 rounded-full bg-[#B8975A] animate-pulse" />
                  ) : null}
                </span>
                <span className={isCompleted ? 'text-[#78716C] line-through' : isActive ? 'text-[#2C2926] font-bold' : 'text-[#78716C]'}>
                  {stepText}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChatGenerationResultCard({
  generation,
  onUse,
}: {
  generation: ChatGeneration;
  onUse: (image: string) => void;
}) {
  if (!generation.image) return null;
  return (
    <div className="mt-3 w-full max-w-[34rem] rounded-2xl border border-[#E8E3D9] bg-white p-4 shadow-[0_14px_34px_rgba(44,41,38,0.08)] space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-serif font-bold text-[#1F1D1B]">生成结果</p>
          <p className="text-xs text-[#78716C] mt-1">{generation.note || '图片已生成在对话中。'}</p>
        </div>
        <span className="rounded-full bg-[#FAF6EE] px-3 py-1.5 text-[11px] font-bold text-[#B8975A] shrink-0">
          {generation.resolution || '2K'}
        </span>
      </div>
      <div className="rounded-xl overflow-hidden border border-[#E8E3D9] bg-[#F5F2EB]">
        <img src={generation.image} alt="Chat generated sofa result" className="w-full max-h-[420px] object-contain" />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onUse(generation.image!)}
          className="px-3 py-2 rounded-lg border border-[#E8E3D9] text-xs font-bold text-[#2C2926] hover:bg-[#FAF8F5] flex items-center gap-1.5"
        >
          <Camera className="w-3.5 h-3.5 text-[#B8975A]" />
          放到预览区
        </button>
        <a
          href={generation.image}
          download="chat-sofa-result.png"
          className="px-3 py-2 rounded-lg bg-[#2E2B28] text-xs font-bold text-white hover:bg-[#403B37] flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5 text-[#B8975A]" />
          下载
        </a>
      </div>
    </div>
  );
}

const getDataUrlByteSize = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
};

const readApiResponse = async (response: Response, fallbackLabel: string) => {
  const text = await response.text();
  let data: any = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const message = response.status === 504
      ? `${fallbackLabel}超过平台网关等待时间，请先用 1K 清晰度重试，或稍后再试。`
      : `${fallbackLabel}返回了非 JSON 响应，状态码: ${response.status}`;
    return {
      success: false,
      errorMessage: message,
      raw: text.slice(0, 300),
    };
  }

  if (!response.ok && data.success !== false) {
    return {
      ...data,
      success: false,
      errorMessage: data.errorMessage || data.error || data.message || `${fallbackLabel}失败，状态码: ${response.status}`,
    };
  }

  return data;
};

const compressImage = (dataUrl: string, maxDim = 1280, quality = 0.82, maxBytes = 900 * 1024): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      // Fill with solid white to avoid black background for transparent PNGs converted to JPEG
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      ctx.drawImage(img, 0, 0, width, height);
      let currentCanvas = canvas;
      let currentQuality = quality;
      let compressed = currentCanvas.toDataURL('image/jpeg', currentQuality);

      for (let attempt = 0; attempt < 12 && getDataUrlByteSize(compressed) > maxBytes; attempt++) {
        if (currentQuality > 0.48) {
          currentQuality = Math.max(0.48, currentQuality - 0.08);
          compressed = currentCanvas.toDataURL('image/jpeg', currentQuality);
          continue;
        }

        const longestSide = Math.max(currentCanvas.width, currentCanvas.height);
        if (longestSide <= 720) break;

        const scale = Math.max(720 / longestSide, 0.84);
        const nextWidth = Math.max(1, Math.round(currentCanvas.width * scale));
        const nextHeight = Math.max(1, Math.round(currentCanvas.height * scale));
        if (nextWidth === currentCanvas.width && nextHeight === currentCanvas.height) break;

        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = nextWidth;
        scaledCanvas.height = nextHeight;
        const scaledCtx = scaledCanvas.getContext('2d');
        if (!scaledCtx) break;
        scaledCtx.fillStyle = '#FFFFFF';
        scaledCtx.fillRect(0, 0, nextWidth, nextHeight);
        scaledCtx.drawImage(currentCanvas, 0, 0, nextWidth, nextHeight);
        currentCanvas = scaledCanvas;
        currentQuality = 0.74;
        compressed = currentCanvas.toDataURL('image/jpeg', currentQuality);
      }

      resolve(compressed);
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
  });
};

export default function App() {
  // SaaS States
  const [userId, setUserId] = useState<string | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [saasInfo, setSaasInfo] = useState<SaasInfo>({});
  const [userInfo, setUserInfo] = useState<any>(null);
  const [toolInfo, setToolInfo] = useState<any>(null);

  useEffect(() => {
    // 1. Read from URL query params
    const params = new URLSearchParams(window.location.search);
    const urlUserId = params.get('userId');
    const urlToolId = params.get('toolId');
    if (urlUserId) setUserId(urlUserId);
    if (urlToolId) setToolId(urlToolId);
    if (urlUserId || urlToolId) {
      setSaasInfo((prev) => ({
        ...prev,
        userId: urlUserId || prev.userId,
        toolId: urlToolId || prev.toolId,
      }));
    }

    // 2. Listen to SAAS_INIT message
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAAS_INIT') {
        const {
          userId: msgUserId,
          toolId: msgToolId,
          context,
          prompt,
          apiBaseUrl,
          launchUrl,
          verifyUrl,
          consumeUrl,
          uploadTokenUrl,
          uploadCommitUrl,
        } = event.data;
        if (msgUserId) setUserId(msgUserId);
        if (msgToolId) setToolId(msgToolId);
        setSaasInfo({
          userId: msgUserId || null,
          toolId: msgToolId || null,
          context: context && context !== 'null' && context !== 'undefined' ? context : '',
          prompt: Array.isArray(prompt)
            ? prompt.filter((item: unknown) => typeof item === 'string' && item !== 'null' && item !== 'undefined')
            : [],
          apiBaseUrl,
          launchUrl,
          verifyUrl,
          consumeUrl,
          uploadTokenUrl,
          uploadCommitUrl,
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Fetch tool and user info on mount if we have IDs
  useEffect(() => {
    if (!userId || !toolId) return;

    const fetchLaunchInfo = async () => {
      try {
        const res = await fetch('/api/tool/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, toolId, saasInfo: { ...saasInfo, userId, toolId } })
        });
        const data = await readApiResponse(res, '启动工具');
        if (data.success && data.data) {
          setUserInfo(data.data.user);
          setToolInfo(data.data.tool);
        }
      } catch (err) {
        console.error('Failed to launch SaaS info', err);
      }
    };

    fetchLaunchInfo();
  }, [userId, toolId, getSaasInfoKey(saasInfo)]);

  // Image Upload States
  const [productImage, setProductImage] = useState<string | null>(null);
  const [productName, setProductName] = useState<string>('');

  const [roomImage, setRoomImage] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string>('');

  // Simplified parameters: Distance (Far, Medium, Close) & Resolution (1K, 2K, 4K, 8K)
  const [distance, setDistance] = useState<'far' | 'medium' | 'close'>('medium');
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K' | '8K'>('1K');

  // UI Flow States
  const [generating, setGenerating] = useState<boolean>(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('HOME');

  // Chat generation states
  const [chatInput, setChatInput] = useState<string>('');
  const [chatGenerating, setChatGenerating] = useState<boolean>(false);
  const [chatBrief, setChatBrief] = useState<string>('');
  const [chatShot, setChatShot] = useState<'far' | 'medium' | 'close'>('medium');
  const [chatResolution, setChatResolution] = useState<'1K' | '2K' | '4K' | '8K'>('1K');
  const chatProductInputRef = useRef<HTMLInputElement | null>(null);
  const chatRoomInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: getChatId(),
      role: 'assistant',
      content: '选择一个快捷入口，或直接描述你想要的沙发电商图。我会按常规生图逻辑保留商品细节，也支持自由对话补充要求。',
      actions: CHAT_WELCOME_ACTIONS,
    },
  ]);

  // Dynamic loading and progress states
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [activeLogs, setActiveLogs] = useState<string[]>([]);
  const logTerminalEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll terminal logs automatically to the bottom
  useEffect(() => {
    if (logTerminalEndRef.current) {
      logTerminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeLogs]);

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, chatGenerating]);

  // Drag states for sofa position previewing
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sofaX, setSofaX] = useState<number>(0.5);
  const [sofaY, setSofaY] = useState<number>(0.65);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Get dynamic scale value depending on Shot Distance selection
  const getScaleByDistance = () => {
    const preset = SHOT_PRESETS.find((p) => p.id === distance);
    return preset ? preset.scale : 0.55;
  };

  // Render Interactive Canvas Preview when both images are uploaded
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas first
    canvas.width = 800;
    canvas.height = 600;
    ctx.clearRect(0, 0, 800, 600);

    // If room image is loaded, draw it
    if (roomImage) {
      const roomImg = new Image();
      if (!roomImage.startsWith('data:')) {
        roomImg.crossOrigin = 'anonymous';
      }
      roomImg.src = roomImage;
      roomImg.onload = () => {
        const rRatio = roomImg.width / roomImg.height;
        const cRatio = 800 / 600;
        let drawW = 800;
        let drawH = 600;
        let sx = 0;
        let sy = 0;

        if (rRatio > cRatio) {
          drawW = 600 * rRatio;
          sx = (800 - drawW) / 2;
        } else {
          drawH = 800 / rRatio;
          sy = (600 - drawH) / 2;
        }
        ctx.drawImage(roomImg, sx, sy, drawW, drawH);

        // Draw elegant subtle perspective grid
        ctx.strokeStyle = 'rgba(184, 151, 90, 0.25)';
        ctx.lineWidth = 1;
        const vpY = 600 * 0.42;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(400, vpY);
          ctx.lineTo(400 + i * 250, 600);
          ctx.stroke();
        }
        for (let j = 1; j <= 5; j++) {
          ctx.beginPath();
          const gy = vpY + (600 - vpY) * (j / 5) * (j / 5);
          ctx.moveTo(0, gy);
          ctx.lineTo(800, gy);
          ctx.stroke();
        }

        // Draw Sofa Overlay if product image is loaded
        if (productImage) {
          const sofaImg = new Image();
          if (!productImage.startsWith('data:')) {
            sofaImg.crossOrigin = 'anonymous';
          }
          sofaImg.src = productImage;
          sofaImg.onload = () => {
            const sW = sofaImg.width || 1;
            const sH = sofaImg.height || 1;
            const scale = getScaleByDistance();
            const displayW = 800 * scale;
            const displayH = displayW * (sH / sW);

            const px = 800 * sofaX;
            const py = 600 * sofaY;

            ctx.save();
            // Draw contact shadow underneath
            ctx.save();
            const r0 = 2;
            const r1 = displayW * 0.52;
            if (isFinite(px) && isFinite(py) && isFinite(displayW) && isFinite(displayH) && r0 > 0 && r1 > 0) {
              try {
                const shadowGrad = ctx.createRadialGradient(px, py + displayH / 2.3, r0, px, py + displayH / 2.3, r1);
                shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
                shadowGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0.25)');
                shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = shadowGrad;
                ctx.translate(px, py + displayH / 2.3);
                ctx.scale(1, 0.18);
                ctx.beginPath();
                ctx.arc(0, 0, r1, 0, Math.PI * 2);
                ctx.fill();
              } catch (e) {
                console.warn('Failed to draw radial gradient shadow:', e);
              }
            }
            ctx.restore();

            // Draw the sofa image
            ctx.drawImage(sofaImg, px - displayW / 2, py - displayH / 2, displayW, displayH);

            // Elegantly highlight frame
            ctx.strokeStyle = 'rgba(184, 151, 90, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px - displayW / 2 - 3, py - displayH / 2 - 3, displayW + 6, displayH + 6);

            // Anchor center point
            ctx.fillStyle = '#b8975a';
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          };
        }
      };
    } else {
      // Draw placeholder when no room image is provided
      ctx.fillStyle = '#F5F2EB';
      ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#78716C';
      ctx.font = '16px "Cormorant Garamond", serif';
      ctx.textAlign = 'center';
      ctx.fillText('请在左侧上传【产品参考图】与【房间参考图】以开启空间对齐预览', 400, 300);
    }
  }, [productImage, roomImage, distance, sofaX, sofaY]);

  // Drag-and-drop position handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!roomImage || !productImage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setIsDragging(true);
    setDragStart({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const dx = x - dragStart.x;
    const dy = y - dragStart.y;

    setSofaX((prev) => Math.min(Math.max(prev + dx, 0.15), 0.85));
    setSofaY((prev) => Math.min(Math.max(prev + dy, 0.35), 0.85));
    setDragStart({ x, y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Base64 file loaders
  const handleSofaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          const original = event.target.result as string;
          const compressed = await compressImage(original, 1600);
          setProductImage(compressed);
          setProductName(file.name);
          setResultImage(null); // Reset result on new upload
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRoomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          const original = event.target.result as string;
          const compressed = await compressImage(original, 1600);
          setRoomImage(compressed);
          setRoomName(file.name);
          setResultImage(null); // Reset result on new upload
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Submit and synthesize
  const handleSynthesis = async () => {
    if (!productImage || !roomImage) {
      setErrorMessage('请先上传【产品参考图】与【房间参考图】');
      return;
    }

    setGenerating(true);
    setErrorMessage(null);
    setResultImage(null);

    // Initialize timers and logs
    setElapsedTime(0);
    setProgressPercent(0);
    setActiveLogs(['[系统] 🚀 启动空间对齐数字孪生合成引擎...']);

    const currentPreset = SHOT_PRESETS.find(p => p.id === distance) || SHOT_PRESETS[1];
    const startTime = Date.now();

    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setElapsedTime(elapsed);

      // Asymptotic non-linear progress curve approaching 98%
      const percent = Math.min(98, Math.floor(100 * (1 - Math.exp(-elapsed / 7.5))));
      setProgressPercent(percent);

      // Generate context-rich logs dynamically based on elapsed seconds
      setActiveLogs((prev) => {
        const logs = [...prev];
        const addLog = (logStr: string) => {
          if (!logs.includes(logStr)) {
            logs.push(logStr);
          }
        };

        if (elapsed >= 0.6) {
          addLog(`[识别] 🔍 提取【产品参考图】透视轴。当前定位：X=${(sofaX * 100).toFixed(0)}%, Y=${(sofaY * 100).toFixed(0)}%`);
        }
        if (elapsed >= 1.6) {
          addLog(`[透视] 📐 校准【房间参考图】透视消失线，开始匹配镜头高度 ${currentPreset.height}`);
        }
        if (elapsed >= 3.0) {
          addLog(`[光照] ☀️ 测算原始房间采光漫反射，渲染沙发表面 3D 环境光遮挡 (Ambient Occlusion)`);
        }
        if (elapsed >= 4.8) {
          addLog(`[阴影] 🕸️ 烘焙地面接触硬/软双重阴影，适配当前选择的：${currentPreset.angle}`);
        }
        if (elapsed >= 6.8) {
          addLog(`[重绘] 🧬 触发 Imagen-3.1-Image 深度合成算子进行全局光影和纹理重塑...`);
        }
        if (elapsed >= 9.2) {
          addLog(`[质感] ✨ 还原产品原本细节特征：100% 严密保留缝线、材质纹理与固有轮廓...`);
        }
        if (elapsed >= 11.5) {
          addLog(`[超分] 🔍 进行 ${resolution} 超高解析度画面去噪与边缘像素柔和防锯齿重塑...`);
        }
        if (elapsed >= 14.0) {
          addLog(`[SaaS] 💾 检验工具 SaaS 调用权限，正在向云端对象存储 (OSS) 同步合成缓存记录...`);
        }
        if (elapsed >= 16.5) {
          addLog(`[校验] 🔄 图像色彩空间对齐，匹配白平衡色温并准备渲染预览大图...`);
        }
        return logs;
      });
    }, 100);

    try {
      const requestPayload = {
        userId,
        toolId,
        saasInfo: {
          ...saasInfo,
          userId,
          toolId,
        },
        productImage,
        roomImage,
        angle: currentPreset.angle,
        height: currentPreset.height,
        lighting: '高端柔和自然漫射光',
        aspectRatio: '4:3',
        imageSize: resolution,
        customPrompt: `${currentPreset.promptGuide} 高清还原等级: ${resolution}。`
      };

      // Attempt to call the custom specific endpoint first to avoid global SaaS platform interceptors/conflicts on '/api/generate'
      let response;
      try {
        console.log('Sending generation request to /api/generate-sofa...');
        response = await fetch('/api/generate-sofa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });

        if (response.status === 404) {
          console.warn('Endpoint /api/generate-sofa returned 404, falling back to standard /api/generate...');
          response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
          });
        }
      } catch (fetchErr) {
        console.warn('Failed to fetch from /api/generate-sofa, falling back to standard /api/generate...', fetchErr);
        response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
      }

      const data = await readApiResponse(response, '空间对齐生图');
      clearInterval(timer);

      if (data.success && data.image) {
        setProgressPercent(100);
        setActiveLogs(prev => [...prev, `[完成] 🎉 空间深度摄影合成成功！图片数据打包回传完毕。`]);
        
        // Wait a small moment to let user appreciate the 100% complete state
        await new Promise(r => setTimeout(r, 450));
        setResultImage(data.image);
        if (data.warning) {
          setErrorMessage(data.warning);
        }
      } else if (data.generatedPreview) {
        setProgressPercent(100);
        setActiveLogs(prev => [...prev, `[错误] 云端图片已生成，但 SaaS 保存/入库失败，结果未交付。`]);
        await new Promise(r => setTimeout(r, 350));
        setResultImage(null);
        setErrorMessage(data.errorMessage || '图片已生成，但未保存到 SaaS 图片库。请稍后重试。');
      } else {
        setProgressPercent(100);
        setActiveLogs(prev => [...prev, `[错误] 云端生图失败，未生成可交付图片。`]);
        setResultImage(null);
        if (data.isKeyError) {
          setErrorMessage('Google AI Studio API 密钥未配置或无权限，请检查 Vercel 环境变量 GEMINI_API_KEY。');
        } else {
          setErrorMessage(data.errorMessage || data.error || '云端生图失败，未生成可交付图片。');
        }
      }
    } catch (err: any) {
      clearInterval(timer);
      console.error(err);
      setProgressPercent(100);
      setActiveLogs(prev => [...prev, `[错误] 请求失败，未生成可交付图片。`]);
      setResultImage(null);
      setErrorMessage(err.message || '请求失败，请检查 Vercel API 日志和环境变量。');
    } finally {
      setGenerating(false);
    }
  };

  const addChatMessage = (message: Omit<ChatMessage, 'id'>) => {
    const id = getChatId();
    setChatMessages((prev) => [...prev, { id, ...message }]);
    return id;
  };

  const updateChatMessage = (id: string, patch: Partial<ChatMessage>) => {
    setChatMessages((prev) => prev.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  };

  const getNextStepActions = (): ChatAction[] => [
    { type: 'generate', label: '开始生成', description: '按当前对话和参考图出图' },
    { type: 'uploadProduct', label: productImage ? '更换沙发图' : '上传沙发图', description: '作为商品最高优先级参考' },
    { type: 'uploadRoom', label: roomImage ? '更换房间图' : '上传房间图', description: '锁定空间结构与光影' },
    { type: 'shot', label: '切换近景特写', value: 'close', description: '突出材质纹理和缝线' },
    { type: 'shot', label: '切换中景主图', value: 'medium', description: '适合电商首图展示' },
    { type: 'resolution', label: '切换 4K', value: '4K', description: '提高输出清晰度参数' },
  ];

  const resetChat = () => {
    setChatMessages([
      {
        id: getChatId(),
        role: 'assistant',
        content: '选择一个快捷入口，或直接描述你想要的沙发电商图。我会按常规生图逻辑保留商品细节，也支持自由对话补充要求。',
        actions: CHAT_WELCOME_ACTIONS,
      },
    ]);
    setChatInput('');
    setChatBrief('');
    setChatShot('medium');
    setChatResolution('2K');
    setChatGenerating(false);
  };

  const handleChatProductUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (!event.target?.result) return;
      const compressed = await compressImage(event.target.result as string, 1600);
      setProductImage(compressed);
      setProductName(file.name);
      setResultImage(null);
      addChatMessage({
        role: 'user',
        content: productImage ? '已替换沙发商品参考图' : '已上传沙发商品参考图',
        images: [compressed],
        imageCategory: 'product',
      });
      addChatMessage({
        role: 'assistant',
        content: '收到沙发图。生成时我会优先保留款式、比例、颜色、材质纹理、缝线和扶手/靠背结构。',
        actions: getNextStepActions(),
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleChatRoomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (!event.target?.result) return;
      const compressed = await compressImage(event.target.result as string, 1600);
      setRoomImage(compressed);
      setRoomName(file.name);
      setResultImage(null);
      addChatMessage({
        role: 'user',
        content: roomImage ? '已替换房间场景参考图' : '已上传房间场景参考图',
        images: [compressed],
        imageCategory: 'room',
      });
      addChatMessage({
        role: 'assistant',
        content: '收到房间图。生成时我会参考空间结构、地面墙面、光线方向、镜头透视和整体氛围。',
        actions: getNextStepActions(),
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const runChatGeneration = async (promptOverride?: string) => {
    const activePrompt = (promptOverride || chatBrief || chatInput).trim();
    if (!activePrompt && !productImage && !roomImage) {
      addChatMessage({
        role: 'assistant',
        content: '先描述你想要什么画面，或者上传沙发图/房间图。我可以从纯文字开始，也可以结合参考图生成。',
        actions: CHAT_WELCOME_ACTIONS,
      });
      return;
    }

    setErrorMessage(null);
    setChatGenerating(true);
    const loadingId = addChatMessage({
      role: 'assistant',
      content: '',
      generation: {
        status: 'loading',
        title: 'AI 对话生图生成中',
        shot: chatShot,
        resolution: chatResolution,
        note: '正在按对话要求和参考图生成...',
      },
    });

    try {
      const activePreset = SHOT_PRESETS.find((preset) => preset.id === chatShot) || SHOT_PRESETS[1];
      const response = await fetch('/api/chat-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          toolId,
          saasInfo: {
            ...saasInfo,
            userId,
            toolId,
          },
          prompt: `${activePrompt || '生成高端沙发电商场景图'}\n镜头要求：${activePreset.name}，${activePreset.promptGuide}`,
          productImage,
          roomImage,
          aspectRatio: '4:3',
          imageSize: chatResolution,
          history: chatMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = await readApiResponse(response, '对话生图');
      if (data.success && data.image) {
        updateChatMessage(loadingId, {
          content: '',
          generation: {
            status: 'success',
            title: '生成完成',
            image: data.image,
            shot: chatShot,
            resolution: chatResolution,
            note: data.modelUsed ? `模型: ${data.modelUsed}` : '图片已生成在对话中。',
          },
          actions: [
            { type: 'generate', label: '再生成一版', description: '保留当前设置重新出图' },
            { type: 'shot', label: '改成近景', value: 'close', description: '更突出材质细节' },
            { type: 'shot', label: '改成远景', value: 'far', description: '展示完整空间氛围' },
          ],
        });
        setResultImage(data.image);
      } else if (data.generatedPreview) {
        updateChatMessage(loadingId, {
          content: '',
          generation: {
            status: 'error',
            error: data.errorMessage || '图片已生成，但 SaaS 保存失败，结果未交付。请稍后重试。',
          },
          actions: [{ type: 'generate', label: '重新生成并保存' }],
        });
        setResultImage(null);
        setErrorMessage(data.errorMessage || '图片已生成，但未保存到 SaaS 图片库。');
      } else {
        throw new Error(data.errorMessage || data.error || `对话生图失败，状态码: ${response.status}`);
      }
    } catch (err: any) {
      updateChatMessage(loadingId, {
        content: '',
        generation: {
          status: 'error',
          error: err.message || '对话生图失败，请稍后重试。',
        },
        actions: [
          { type: 'generate', label: '重试生成' },
          { type: 'uploadProduct', label: '更换沙发图' },
          { type: 'uploadRoom', label: '更换房间图' },
        ],
      });
      setErrorMessage(err.message || '对话生图失败，请稍后重试。');
    } finally {
      setChatGenerating(false);
    }
  };

  const handleChatSubmit = async (e?: React.FormEvent, overridePrompt?: string) => {
    if (e) e.preventDefault();
    const text = (overridePrompt ?? chatInput).trim();
    if (!text || chatGenerating) return;

    setChatInput('');
    setChatBrief(text);
    addChatMessage({ role: 'user', content: text });

    const wantsDirectGenerate = /生成|出图|做图|渲染|generate/i.test(text);
    if (wantsDirectGenerate) {
      addChatMessage({
        role: 'assistant',
        content: '我已整理你的需求，将按常规生图逻辑执行：保留商品细节、匹配空间透视与真实接触阴影。',
        actions: getNextStepActions(),
      });
      await runChatGeneration(text);
      return;
    }

    addChatMessage({
      role: 'assistant',
      content: '已记录你的画面要求。你可以继续补充描述，也可以点击下方卡片上传参考图、切换镜头或直接生成。',
      actions: getNextStepActions(),
    });
  };

  const handleChatAction = async (action: ChatAction) => {
    if (chatGenerating) return;

    if (action.prompt) {
      await handleChatSubmit(undefined, action.prompt);
      return;
    }
    if (action.type === 'uploadProduct') {
      chatProductInputRef.current?.click();
      return;
    }
    if (action.type === 'uploadRoom') {
      chatRoomInputRef.current?.click();
      return;
    }
    if (action.type === 'shot' && action.value) {
      const nextShot = action.value as 'far' | 'medium' | 'close';
      setChatShot(nextShot);
      setDistance(nextShot);
      const preset = SHOT_PRESETS.find((item) => item.id === nextShot);
      addChatMessage({
        role: 'user',
        content: `切换镜头：${preset?.name || action.label}`,
      });
      addChatMessage({
        role: 'assistant',
        content: `镜头已切换为 ${preset?.name || action.label}。`,
        actions: getNextStepActions(),
      });
      return;
    }
    if (action.type === 'resolution' && action.value) {
      const nextResolution = action.value as '1K' | '2K' | '4K' | '8K';
      setChatResolution(nextResolution);
      setResolution(nextResolution);
      addChatMessage({ role: 'user', content: `输出清晰度：${nextResolution}` });
      addChatMessage({
        role: 'assistant',
        content: `清晰度已切换为 ${nextResolution}。`,
        actions: getNextStepActions(),
      });
      return;
    }
    if (action.type === 'generate') {
      await runChatGeneration();
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `沙发生图_${resolution}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#FAF8F5] text-[#2C2926] font-sans flex flex-col">
      {/* Premium Header */}
      <header className="border-b border-[#E8E3D9] bg-white px-8 py-5 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-[#2E2B28] text-[#FAF8F5] rounded-xl shadow-inner">
            <Compass className="w-6 h-6 animate-pulse text-[#B8975A]" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1F1D1B] flex items-center gap-2.5">
              沙发智能空间生图系统
            </h1>
            <p className="text-xs text-[#78716C] mt-0.5 font-sans">高清晰度空间合成与光影对齐工具</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {workspaceMode !== 'HOME' && (
            <button
              onClick={() => setWorkspaceMode('HOME')}
              className="px-3 py-2 rounded-xl border border-[#E8E3D9] bg-[#FAF8F5] text-xs font-bold text-[#78716C] hover:text-[#2C2926] hover:bg-white transition-all flex items-center gap-1.5"
            >
              <HomeIcon className="w-3.5 h-3.5" />
              入口
            </button>
          )}

          {workspaceMode === 'STANDARD' && (
            <div className="hidden md:flex items-center gap-2 text-xs font-bold text-[#78716C]">
              <ArrowRight className="w-3.5 h-3.5 text-[#B8975A]" />
              <span className="text-[#2C2926]">常规空间合成</span>
              <button
                onClick={() => {
                  setResultImage(null);
                  setErrorMessage(null);
                }}
                className="ml-2 px-3 py-2 rounded-xl border border-[#E8E3D9] hover:bg-[#FAF8F5] transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重置结果
              </button>
            </div>
          )}

          {workspaceMode === 'CHAT' && (
            <div className="hidden md:flex items-center gap-2 text-xs font-bold text-[#78716C]">
              <ArrowRight className="w-3.5 h-3.5 text-[#B8975A]" />
              <span className="text-[#2C2926]">AI 对话生图</span>
              <button
                onClick={resetChat}
                className="ml-2 px-3 py-2 rounded-xl border border-[#E8E3D9] hover:bg-[#FAF8F5] transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重置对话
              </button>
            </div>
          )}

          {/* Elegant SaaS info badges */}
          {userInfo && (
            <div className="flex items-center gap-3 bg-[#FAF6EE] border border-[#B8975A]/20 px-4 py-2 rounded-xl text-xs shadow-sm">
              <span className="text-[#2C2926] font-medium">{userInfo.name || 'SaaS用户'} ({userInfo.enterprise || '试用版'})</span>
              <span className="text-[#E8E3D9]">|</span>
              <span className="text-[#B8975A] font-bold">积分余额: {userInfo.integral ?? 0}</span>
              {toolInfo?.integral && (
                <>
                  <span className="text-[#E8E3D9]">|</span>
                  <span className="text-[#78716C]">消耗: {toolInfo.integral} 积分/次</span>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {workspaceMode === 'HOME' ? (
        <main className="flex-1 overflow-y-auto p-6 md:p-10 flex items-center justify-center">
          <motion.div
            key="home"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-6xl"
          >
            <div className="mb-10">
              <p className="text-xs uppercase tracking-[0.28em] text-[#B8975A] font-bold mb-4">
                Choose Creation Mode
              </p>
              <h2 className="font-serif text-4xl md:text-5xl font-bold text-[#1F1D1B] mb-4">
                选择沙发生图入口
              </h2>
              <p className="text-[#78716C] max-w-2xl leading-relaxed">
                常规空间合成保留原有上传、拖拽定位、镜头景别和一键生成流程；AI 对话生图支持自由描述、快捷卡片、上传参考图和对话内生成结果。
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <button
                onClick={() => setWorkspaceMode('STANDARD')}
                className="group text-left bg-white rounded-2xl p-8 md:p-10 border border-[#E8E3D9] shadow-sm hover:-translate-y-1 hover:shadow-xl transition-all"
              >
                <div className="w-14 h-14 rounded-xl bg-[#FAF8F5] border border-[#E8E3D9] flex items-center justify-center mb-8">
                  <Camera className="w-6 h-6 text-[#B8975A]" />
                </div>
                <div className="flex items-end justify-between gap-6">
                  <div>
                    <h3 className="font-serif text-3xl font-bold text-[#1F1D1B] mb-3">
                      常规空间合成
                    </h3>
                    <p className="text-[#78716C] leading-relaxed">
                      上传沙发图和房间图，拖拽确定摆放位置，选择远景/中景/近景与清晰度，一键生成电商级空间摄影图。
                    </p>
                  </div>
                  <ArrowRight className="w-6 h-6 shrink-0 text-[#B8975A] group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              <button
                onClick={() => setWorkspaceMode('CHAT')}
                className="group text-left bg-[#2E2B28] text-white rounded-2xl p-8 md:p-10 border border-[#2E2B28] shadow-sm hover:-translate-y-1 hover:shadow-xl transition-all"
              >
                <div className="w-14 h-14 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center mb-8">
                  <MessageCircle className="w-6 h-6 text-[#B8975A]" />
                </div>
                <div className="flex items-end justify-between gap-6">
                  <div>
                    <h3 className="font-serif text-3xl font-bold mb-3">
                      AI 对话生图
                    </h3>
                    <p className="text-white/70 leading-relaxed">
                      像聊天一样上传沙发/房间图、选择卡片、切换镜头和清晰度，也可以直接自由描述画面需求并在对话里生成图片。
                    </p>
                  </div>
                  <ArrowRight className="w-6 h-6 shrink-0 text-[#B8975A] group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>
          </motion.div>
        </main>
      ) : (
      /* Main Grid Workspace */
      <div className={`flex-1 grid grid-cols-1 overflow-hidden h-[calc(100vh-81px)] ${
        workspaceMode === 'CHAT' ? 'lg:grid-cols-1' : 'lg:grid-cols-12'
      }`}>
        
        {/* Left Control Panel (4 Columns) */}
        <div className={`${workspaceMode === 'CHAT' ? 'hidden' : 'lg:col-span-5 xl:col-span-4'} border-r border-[#E8E3D9] overflow-y-auto p-6 bg-white flex flex-col justify-between gap-6 shadow-sm`}>
          <div className="space-y-6">
            
            {/* Box 1: Product Upload */}
            <div className="space-y-2.5">
              <h3 className="font-serif text-base font-bold text-[#1F1D1B] flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#FAF8F5] border border-[#E8E3D9] text-[#B8975A] flex items-center justify-center text-xs font-serif font-bold">1</span>
                产品参考图
              </h3>

              {!productImage ? (
                <label className="border-2 border-dashed border-[#E8E3D9] hover:border-[#B8975A] transition-all rounded-xl p-6 flex flex-col items-center justify-center gap-2.5 cursor-pointer bg-[#FAF8F5] min-h-[140px] group">
                  <div className="p-3 bg-white rounded-lg shadow-sm border border-[#E8E3D9] group-hover:scale-105 transition-transform">
                    <Upload className="w-5 h-5 text-[#B8975A]" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-semibold text-[#1F1D1B]">上传沙发图片</p>
                    <p className="text-[10px] text-[#78716C] mt-1">支持常见图片格式（如 JPG, PNG, WebP），最大支持 20MB（通过前端压缩上传）</p>
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleSofaUpload} />
                </label>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-[#E8E3D9] bg-[#FAF8F5] p-3 flex items-center gap-3">
                  <img src={productImage} alt="Uploaded product" className="w-16 h-16 rounded-lg object-cover border border-[#E8E3D9]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#1F1D1B] truncate">{productName || '已上传产品图片'}</p>
                    <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1 mt-0.5">
                      <Check className="w-3 h-3" /> 读取成功
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setProductImage(null);
                      setProductName('');
                    }}
                    className="p-1.5 text-[#78716C] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="移除图片"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Box 2: Room Upload */}
            <div className="space-y-2.5">
              <h3 className="font-serif text-base font-bold text-[#1F1D1B] flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#FAF8F5] border border-[#E8E3D9] text-[#B8975A] flex items-center justify-center text-xs font-serif font-bold">2</span>
                房间参考图
              </h3>

              {!roomImage ? (
                <label className="border-2 border-dashed border-[#E8E3D9] hover:border-[#B8975A] transition-all rounded-xl p-6 flex flex-col items-center justify-center gap-2.5 cursor-pointer bg-[#FAF8F5] min-h-[140px] group">
                  <div className="p-3 bg-white rounded-lg shadow-sm border border-[#E8E3D9] group-hover:scale-105 transition-transform">
                    <Upload className="w-5 h-5 text-[#B8975A]" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-semibold text-[#1F1D1B]">上传客厅图片</p>
                    <p className="text-[10px] text-[#78716C] mt-1">支持常见图片格式（如 JPG, PNG, WebP），最大支持 20MB（通过前端压缩上传）</p>
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleRoomUpload} />
                </label>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-[#E8E3D9] bg-[#FAF8F5] p-3 flex items-center gap-3">
                  <img src={roomImage} alt="Uploaded room" className="w-16 h-16 rounded-lg object-cover border border-[#E8E3D9]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#1F1D1B] truncate">{roomName || '已上传房间图片'}</p>
                    <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1 mt-0.5">
                      <Check className="w-3 h-3" /> 读取成功
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setRoomImage(null);
                      setRoomName('');
                    }}
                    className="p-1.5 text-[#78716C] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="移除图片"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Box 3: Camera Lens & Shot Presets */}
            <div className="pt-4 border-t border-[#E8E3D9] space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#1F1D1B] mb-2.5 uppercase tracking-wide flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-[#B8975A]" />
                  相机镜头与构图景别
                </label>
                <div className="space-y-2">
                  {SHOT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setDistance(preset.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex gap-3 items-start ${
                        distance === preset.id
                          ? 'border-[#B8975A] bg-[#FAF6EE] ring-1 ring-[#B8975A]/30 shadow-sm'
                          : 'border-stone-200 hover:border-stone-300 bg-white hover:bg-stone-50'
                      }`}
                    >
                      <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                        distance === preset.id ? 'bg-[#B8975A]/10 text-[#B8975A]' : 'bg-stone-100 text-[#78716C]'
                      }`}>
                        {preset.id === 'far' && <Compass className="w-4 h-4" />}
                        {preset.id === 'medium' && <Monitor className="w-4 h-4" />}
                        {preset.id === 'close' && <Sparkles className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-1">
                          <span className={`text-xs font-bold ${distance === preset.id ? 'text-[#B8975A]' : 'text-stone-800'}`}>
                            {preset.name}
                          </span>
                          <span className="text-[9px] text-[#78716C] font-mono shrink-0 bg-stone-100 px-1 rounded">
                            {preset.height.split(' ')[0]}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#78716C] mt-1 leading-relaxed">
                          {preset.description}
                        </p>
                        <div className="mt-2 flex gap-1.5 items-center flex-wrap">
                          <span className="text-[9px] bg-white border border-stone-200 text-stone-600 px-1.5 py-0.5 rounded font-mono">
                            视角: {preset.angle}
                          </span>
                          <span className="text-[9px] bg-white border border-stone-200 text-stone-600 px-1.5 py-0.5 rounded font-mono">
                            画幅比例: {(preset.scale * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Box 4: Resolution Select */}
              <div className="pt-2">
                <label className="block text-xs font-bold text-[#1F1D1B] mb-2 uppercase tracking-wide">
                  输出分辨率
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['1K', '2K', '4K', '8K'] as const).map((resOpt) => (
                    <button
                      key={resOpt}
                      onClick={() => setResolution(resOpt)}
                      className={`py-2 text-center rounded-lg border text-xs font-mono font-medium transition-all cursor-pointer ${
                        resolution === resOpt
                          ? 'border-[#B8975A] bg-[#FAF6EE] text-[#B8975A] font-bold shadow-sm'
                          : 'border-stone-200 hover:border-stone-300 text-[#5C564F]'
                      }`}
                    >
                      {resOpt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* Synthesis Action Button */}
          <div className="pt-4 border-t border-[#E8E3D9]">
            <button
              onClick={handleSynthesis}
              disabled={generating || !productImage || !roomImage}
              className="w-full py-3.5 bg-[#2E2B28] hover:bg-[#403B37] disabled:bg-stone-200 disabled:text-stone-400 text-white font-serif text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer font-bold tracking-wide"
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-[#B8975A]" />
                  正在融合空间...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#B8975A]" />
                  开始空间合成
                </>
              )}
            </button>
          </div>

        </div>

        {/* Right Stage Panel (7 Columns) */}
        <div className={`${workspaceMode === 'CHAT' ? 'col-span-1' : 'lg:col-span-7 xl:col-span-8'} bg-[#FAF8F5] p-6 flex flex-col justify-between overflow-hidden`}>
          
          {/* Output label */}
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-[#B8975A]" />
              <span className="font-serif text-base font-bold text-[#1F1D1B]">
                {resultImage ? '空间摄影合成图' : '空间对齐与布局预览'}
              </span>
            </div>

            {resultImage && (
              <button
                onClick={() => setResultImage(null)}
                className="text-xs bg-white text-stone-700 px-3 py-1 rounded-md border border-stone-200 hover:bg-[#FAF8F5] flex items-center gap-1.5 font-medium transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 重新调整
              </button>
            )}
          </div>

          {/* System status banner */}
          <AnimatePresence>
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="mb-3 bg-[#FAF5EC] border border-[#E9DCC8] p-3 rounded-lg text-xs text-[#7C5A2B] flex items-start gap-2 shadow-sm"
              >
                <AlertCircle className="w-4 h-4 text-[#B8975A] shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">系统提示:</span> {errorMessage}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {workspaceMode === 'CHAT' ? (
            <div className="flex-1 bg-white rounded-2xl border border-[#E8E3D9] overflow-hidden shadow-sm flex flex-col min-h-0">
              <input ref={chatProductInputRef} type="file" accept="image/*" className="hidden" onChange={handleChatProductUpload} />
              <input ref={chatRoomInputRef} type="file" accept="image/*" className="hidden" onChange={handleChatRoomUpload} />
              <div className="px-5 py-4 border-b border-[#E8E3D9] flex items-center justify-between bg-[#FAF8F5]">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#2E2B28] text-[#B8975A] flex items-center justify-center">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-serif font-bold text-[#1F1D1B]">AI 对话生图</h3>
                    <p className="text-[10px] text-[#78716C]">
                      {productImage || roomImage ? '已连接左侧参考图，可直接描述画面需求' : '可纯文字生成，也可先上传参考图'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#78716C]">
                  <span className="bg-white border border-[#E8E3D9] px-2 py-1 rounded-md flex items-center gap-1">
                    <Camera className="w-3 h-3 text-[#B8975A]" />
                    {SHOT_PRESETS.find((preset) => preset.id === chatShot)?.name || '中景'}
                  </span>
                  <span className="bg-white border border-[#E8E3D9] px-2 py-1 rounded-md flex items-center gap-1">
                    <Settings className="w-3 h-3 text-[#B8975A]" />
                    {chatResolution}
                  </span>
                  {productImage && (
                    <span className="bg-white border border-[#E8E3D9] px-2 py-1 rounded-md flex items-center gap-1">
                      <ImageIcon className="w-3 h-3 text-[#B8975A]" /> 商品图
                    </span>
                  )}
                  {roomImage && (
                    <span className="bg-white border border-[#E8E3D9] px-2 py-1 rounded-md flex items-center gap-1">
                      <ImageIcon className="w-3 h-3 text-[#B8975A]" /> 房间图
                    </span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#FAF8F5]">
                {chatMessages.map((message, index) => {
                  const isLatestAssistant =
                    message.role === 'assistant' &&
                    index === chatMessages.map((item) => item.role).lastIndexOf('assistant');
                  const shouldShowActions =
                    !!message.actions?.length &&
                    (message.id === chatMessages[0]?.id || isLatestAssistant);

                  return (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-lg bg-[#2E2B28] text-[#B8975A] flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}
                    <div className={`max-w-[78%] ${message.role === 'user' ? 'order-1' : ''}`}>
                      <div
                        className={`rounded-xl px-4 py-3 text-xs leading-relaxed border shadow-sm ${
                          message.role === 'user'
                            ? 'bg-[#2E2B28] text-white border-[#2E2B28]'
                            : 'bg-white text-[#2C2926] border-[#E8E3D9]'
                        }`}
                      >
                        {message.content}
                      </div>

                      {message.images && message.images.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {message.images.map((img, idx) => (
                            <div key={`${message.id}-${idx}`} className="w-28 aspect-square rounded-xl overflow-hidden border border-[#E8E3D9] bg-white">
                              <img src={img} alt="Chat reference" className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      )}

                      {message.generation?.status === 'loading' && (
                        <ChatGenerationLoadingCard generation={message.generation} />
                      )}
                      {message.generation?.status === 'success' && (
                        <ChatGenerationResultCard
                          generation={message.generation}
                          onUse={(image) => {
                            setResultImage(image);
                            setWorkspaceMode('STANDARD');
                          }}
                        />
                      )}
                      {message.generation?.status === 'error' && (
                        <div className="mt-3 w-full max-w-[34rem] rounded-xl border border-red-100 bg-red-50 p-4 text-xs text-red-600">
                          {message.generation.error || '生成失败，请重试。'}
                        </div>
                      )}
                      {message.image && !message.generation && (
                        <div className="mt-2 bg-white border border-[#E8E3D9] rounded-xl p-2 shadow-sm">
                          <img
                            src={message.image}
                            alt="Chat generated result"
                            className="max-h-[360px] w-full object-contain rounded-lg bg-[#F5F2EB]"
                          />
                          <div className="mt-2 flex justify-end">
                            <button
                              onClick={() => {
                                setResultImage(message.image || null);
                                setWorkspaceMode('STANDARD');
                              }}
                              className="text-[10px] font-bold text-[#B8975A] hover:text-[#2E2B28] flex items-center gap-1"
                            >
                              <Camera className="w-3 h-3" />
                              放到预览区
                            </button>
                          </div>
                        </div>
                      )}

                      {shouldShowActions && message.actions && (
                        <div className="mt-3 w-full max-w-[38rem] rounded-2xl border border-[#E8E3D9] bg-white/80 p-3 shadow-sm">
                          <div className="mb-2.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Wand2 className="w-3.5 h-3.5 text-[#B8975A]" />
                              <span className="text-[11px] font-bold text-[#78716C]">
                                {message.id === chatMessages[0]?.id ? '快捷入口' : '下一步操作'}
                              </span>
                            </div>
                            <span className="text-[10px] text-[#78716C]">
                              也可以继续自由输入
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {message.actions.map((action, actionIndex) => (
                              <button
                                key={`${message.id}-${action.type}-${action.value || actionIndex}`}
                                onClick={() => handleChatAction(action)}
                                disabled={chatGenerating}
                                className="min-h-[4.25rem] text-left rounded-xl border border-[#E8E3D9] bg-white px-3 py-2.5 hover:border-[#B8975A]/60 hover:bg-[#FAF8F5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <span className="flex items-start gap-2">
                                  <span className="mt-0.5 w-7 h-7 rounded-lg bg-[#FAF8F5] border border-[#E8E3D9] flex items-center justify-center shrink-0 text-[#B8975A]">
                                    {action.type === 'uploadProduct' && <Images className="w-3.5 h-3.5" />}
                                    {action.type === 'uploadRoom' && <ImageIcon className="w-3.5 h-3.5" />}
                                    {action.type === 'generate' && <Sparkles className="w-3.5 h-3.5" />}
                                    {action.type === 'shot' && <Camera className="w-3.5 h-3.5" />}
                                    {action.type === 'resolution' && <Settings className="w-3.5 h-3.5" />}
                                    {action.type === 'prompt' && <Wand2 className="w-3.5 h-3.5" />}
                                  </span>
                                  <span>
                                    <span className="text-[13px] font-bold block text-[#2C2926]">{action.label}</span>
                                    {action.description && (
                                      <span className="text-[11px] leading-snug text-[#78716C] mt-0.5 block">{action.description}</span>
                                    )}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <div className="w-8 h-8 rounded-lg bg-[#B8975A] text-white flex items-center justify-center shrink-0 order-2">
                        <UserRound className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  );
                })}

                {chatGenerating && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#2E2B28] text-[#B8975A] flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-white border border-[#E8E3D9] rounded-xl px-4 py-3 text-xs text-[#78716C] shadow-sm flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#B8975A]" />
                      正在理解对话并生成图片...
                    </div>
                  </div>
                )}
                <div ref={chatScrollRef} />
              </div>

              <div className="border-t border-[#E8E3D9] p-4 bg-white">
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => chatProductInputRef.current?.click()}
                    className="w-11 rounded-xl border border-[#E8E3D9] bg-[#FAF8F5] text-[#B8975A] hover:bg-white flex items-center justify-center transition-colors"
                    title="上传沙发图"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => chatRoomInputRef.current?.click()}
                    className="w-11 rounded-xl border border-[#E8E3D9] bg-[#FAF8F5] text-[#B8975A] hover:bg-white flex items-center justify-center transition-colors"
                    title="上传房间图"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleChatSubmit();
                      }
                    }}
                    placeholder="例如：把这张沙发放进现代奶油风客厅，午后自然光，横版电商主图，地毯接触阴影真实..."
                    className="flex-1 resize-none min-h-[48px] max-h-28 rounded-xl border border-[#E8E3D9] bg-[#FAF8F5] px-3 py-2 text-xs text-[#2C2926] outline-none focus:border-[#B8975A] focus:ring-2 focus:ring-[#B8975A]/10"
                    disabled={chatGenerating}
                  />
                  <button
                    type="submit"
                    disabled={chatGenerating || !chatInput.trim()}
                    className="w-12 rounded-xl bg-[#2E2B28] hover:bg-[#403B37] disabled:bg-stone-200 text-white flex items-center justify-center transition-colors"
                    title="发送"
                  >
                    {chatGenerating ? <RefreshCw className="w-4 h-4 animate-spin text-[#B8975A]" /> : <Send className="w-4 h-4 text-[#B8975A]" />}
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <>
              {/* Workspace Viewer Stage */}
              <div className="flex-1 bg-[#F5F2EB] rounded-2xl border border-[#E8E3D9] flex items-center justify-center p-4 overflow-hidden relative shadow-inner">
            
            <AnimatePresence mode="wait">
              {generating ? (
                // Deluxe Camera-Aligned Generator Loader
                <motion.div
                  key="loader"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-[#1C1A18] z-30 flex flex-col items-center justify-center text-[#FAF8F5] p-6 md:p-8"
                >
                  <div className="max-w-xl w-full text-center space-y-6">
                    {/* Spinning Camera Icon Accent */}
                    <div className="relative w-16 h-16 mx-auto">
                      <div className="absolute inset-0 rounded-full border-2 border-[#B8975A]/20"></div>
                      <div className="absolute inset-0 rounded-full border-2 border-t-[#B8975A] animate-spin"></div>
                      <Camera className="w-5 h-5 text-[#B8975A] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>

                    {/* Progress Header and Time */}
                    <div className="space-y-1.5">
                      <h4 className="font-serif text-lg tracking-wider text-[#FAF8F5]">沙发空间多模态对齐中</h4>
                      <div className="flex justify-center items-center gap-3 text-xs text-[#E8E3D9]/70 font-mono">
                        <span className="bg-[#B8975A]/20 text-[#B8975A] px-2 py-0.5 rounded-md border border-[#B8975A]/30">
                          {distance === 'far' ? '广角全景' : distance === 'close' ? '微距特写' : '标准半景'}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin text-emerald-500" />
                          已运行: <span className="text-emerald-400 font-bold">{elapsedTime.toFixed(1)}s</span>
                        </span>
                      </div>
                    </div>

                    {/* Dynamic Percentage Meter */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs font-mono text-[#E8E3D9]/60">
                        <span>多源材质图层融合</span>
                        <span className="text-[#B8975A] font-bold text-sm">{progressPercent}%</span>
                      </div>
                      <div className="w-full bg-[#2E2B28] h-2.5 rounded-full overflow-hidden border border-[#403B37] p-[2px]">
                        <div
                          className="bg-gradient-to-r from-[#B8975A] to-[#E9DCC8] h-full rounded-full transition-all duration-100 ease-out"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Deluxe Log Stream Terminal */}
                    <div className="w-full text-left bg-black/50 border border-[#2E2B28] rounded-xl p-4 font-mono text-[11px] leading-relaxed text-[#D6D3D1] space-y-1.5 h-44 overflow-y-auto scrollbar-none">
                      {activeLogs.map((log, idx) => (
                        <div key={idx} className="flex gap-2 items-start animate-fade-in">
                          <span className="text-[#B8975A] select-none shrink-0">&gt;</span>
                          <span className={log.includes('[完成]') || log.includes('[完成] ') ? 'text-emerald-400 font-bold' : log.includes('[系统]') ? 'text-blue-400' : 'text-[#D6D3D1]'}>
                            {log}
                          </span>
                        </div>
                      ))}
                      {/* Active Cursor */}
                      <div className="flex gap-2 items-center text-[#B8975A]">
                        <span>&gt;</span>
                        <span className="inline-block w-1.5 h-3 bg-white/70 animate-pulse" />
                      </div>
                      <div ref={logTerminalEndRef} />
                    </div>

                    <p className="text-[10px] text-[#78716C]">
                      * 基于 Imagen-3.1-Image 神经网络与物理阴影对齐模型，还原 100% 材质纹理
                    </p>
                  </div>
                </motion.div>
              ) : resultImage ? (
                // Beautifully compiled image display
                <motion.div
                  key="result"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full flex items-center justify-center relative"
                >
                  <div className="relative max-w-full max-h-full rounded-xl overflow-hidden shadow-2xl border-4 border-white bg-white flex items-center justify-center">
                    <img
                      src={resultImage}
                      alt="Synthesized Sofa Scene"
                      className="max-w-full max-h-[62vh] object-contain"
                    />

                    <div className="absolute top-4 left-4 bg-black/75 backdrop-blur text-white px-3 py-1 text-[11px] rounded-full flex items-center gap-1.5 font-medium border border-white/10">
                      <Sparkles className="w-3 h-3 text-[#B8975A]" />
                      {resolution} 极高解析度渲染
                    </div>

                    <div className="absolute bottom-4 right-4">
                      <button
                        onClick={handleDownload}
                        className="bg-black/90 hover:bg-black text-white px-5 py-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-xl transition-all cursor-pointer font-serif tracking-wide border border-white/10"
                      >
                        <Download className="w-4 h-4 text-[#B8975A]" /> 下载高清原稿
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                // Interactive Preview Stage
                <motion.div
                  key="canvas"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full flex flex-col items-center justify-center relative"
                >
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    className={`max-w-full max-h-[62vh] rounded-xl shadow-xl border border-[#E8E3D9] bg-white transition-shadow duration-200 ${
                      productImage && roomImage ? 'cursor-grab active:cursor-grabbing hover:shadow-2xl' : ''
                    }`}
                  />

                  {/* Positioning instruction label overlay */}
                  {productImage && roomImage && (
                    <div className="absolute bottom-6 left-6 right-6 pointer-events-none flex justify-center">
                      <span className="bg-black/75 backdrop-blur text-[#FAF8F5] text-[10px] px-3.5 py-1.5 rounded-full shadow-lg border border-white/10 flex items-center gap-1.5">
                        <Monitor className="w-3 h-3 text-[#B8975A]" /> 拖动画面中的沙发调节摆放位置
                      </span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

              </div>

              {/* Footer constraints */}
              <div className="mt-4 flex items-center justify-between text-[11px] text-[#78716C] bg-white border border-[#E8E3D9] p-3.5 rounded-xl shadow-sm font-sans">
                <span className="flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-emerald-600 font-bold" />
                  已启用智能对齐与物理重力接触阴影计算
                </span>
                <span className="flex items-center gap-1 font-serif text-stone-700 italic">
                  Space Synthesis Studio
                </span>
              </div>
            </>
          )}

        </div>

      </div>
      )}
    </div>
  );
}
