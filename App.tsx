
import React, { useState, useEffect, useRef } from 'react';
import { generateImage, optimizePrompt, upscaler, createVideoTaskHF } from './services/hfService';
import { generateGiteeImage, optimizePromptGitee, createVideoTask, getGiteeTaskStatus } from './services/giteeService';
import { generateMSImage, optimizePromptMS } from './services/msService';
import { translatePrompt } from './services/utils';
import { GeneratedImage, AspectRatioOption, ModelOption, ProviderOption } from './types';
import { HistoryGallery } from './components/HistoryGallery';
import { SettingsModal } from './components/SettingsModal';
import { FAQModal } from './components/FAQModal';
import { translations, Language } from './translations';
import { ImageEditor } from './components/ImageEditor';
import { Header, AppView } from './components/Header';
import {
  Sparkles,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { getModelConfig, getGuidanceScaleConfig, FLUX_MODELS, HF_MODEL_OPTIONS, GITEE_MODEL_OPTIONS, MS_MODEL_OPTIONS } from './constants';
import { PromptInput } from './components/PromptInput';
import { ControlPanel } from './components/ControlPanel';
import { PreviewStage } from './components/PreviewStage';
import { ImageToolbar } from './components/ImageToolbar';
import { Tooltip } from './components/Tooltip';

export default function App() {
  // Language Initialization
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    if (saved === 'en' || saved === 'zh') return saved;
    const browserLang = navigator.language.toLowerCase();
    return browserLang.startsWith('zh') ? 'zh' : 'en';
  });
  
  const t = translations[lang];

  // Navigation State
  const [currentView, setCurrentView] = useState<AppView>('creation');

  // Dynamic Aspect Ratio Options based on language
  const aspectRatioOptions = [
    { value: '1:1', label: t.ar_square },
    { value: '9:16', label: t.ar_photo_9_16 },
    { value: '16:9', label: t.ar_movie },
    { value: '3:4', label: t.ar_portrait_3_4 },
    { value: '4:3', label: t.ar_landscape_4_3 },
    { value: '3:2', label: t.ar_portrait_3_2 },
    { value: '2:3', label: t.ar_landscape_2_3 },
  ];

  const [prompt, setPrompt] = useState<string>('');

  // --- Persistence Logic Start ---
  
  const [provider, setProvider] = useState<ProviderOption>(() => {
    if (typeof localStorage === 'undefined') return 'huggingface';
    const saved = localStorage.getItem('app_provider') as ProviderOption;
    return ['huggingface', 'gitee', 'modelscope'].includes(saved) ? saved : 'huggingface';
  });

  const [model, setModel] = useState<ModelOption>(() => {
    let effectiveProvider: ProviderOption = 'huggingface';
    if (typeof localStorage !== 'undefined') {
        const savedProvider = localStorage.getItem('app_provider') as ProviderOption;
        if (['huggingface', 'gitee', 'modelscope'].includes(savedProvider)) {
            effectiveProvider = savedProvider;
        }
    }

    const savedModel = typeof localStorage !== 'undefined' ? localStorage.getItem('app_model') : null;
    
    let options;
    if (effectiveProvider === 'gitee') options = GITEE_MODEL_OPTIONS;
    else if (effectiveProvider === 'modelscope') options = MS_MODEL_OPTIONS;
    else options = HF_MODEL_OPTIONS;

    const isValid = options.some(o => o.value === savedModel);
    if (isValid && savedModel) return savedModel as ModelOption;
    
    return options[0].value as ModelOption;
  });

  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_aspect_ratio') : null;
    // Basic validation could be added, but relying on stored string is generally safe with fallback
    return (saved as AspectRatioOption) || '1:1';
  });

  const [enableHD, setEnableHD] = useState<boolean>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_enable_hd') : null;
    return saved === 'true';
  });

  // Effects to save settings
  useEffect(() => {
    localStorage.setItem('app_provider', provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem('app_model', model);
  }, [model]);

  useEffect(() => {
    localStorage.setItem('app_aspect_ratio', aspectRatio);
  }, [aspectRatio]);

  useEffect(() => {
    localStorage.setItem('app_enable_hd', String(enableHD));
  }, [enableHD]);

  // --- Persistence Logic End ---

  const [seed, setSeed] = useState<string>(''); 
  const [steps, setSteps] = useState<number>(9);
  const [guidanceScale, setGuidanceScale] = useState<number>(3.5);
  const [autoTranslate, setAutoTranslate] = useState<boolean>(false);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isUpscaling, setIsUpscaling] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Transition state for upscaling
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [tempUpscaledImage, setTempUpscaledImage] = useState<string | null>(null);
  
  // Video State
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);

  // Initialize history from localStorage with expiration check (delete older than 1 day)
  const [history, setHistory] = useState<GeneratedImage[]>(() => {
    try {
      const saved = localStorage.getItem('ai_image_gen_history');
      if (!saved) return [];
      
      const parsedHistory: GeneratedImage[] = JSON.parse(saved);
      const now = Date.now();
      const oneDayInMs = 24 * 60 * 60 * 1000;
      
      // Filter out images older than 1 day
      return parsedHistory.filter(img => (now - img.timestamp) < oneDayInMs);
    } catch (e) {
      console.error("Failed to load history", e);
      return [];
    }
  });

  const [error, setError] = useState<string | null>(null);
  
  // New state for Info Popover
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number, height: number } | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);

  // Settings State
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  // FAQ State
  const [showFAQ, setShowFAQ] = useState<boolean>(false);

  // Use refs for polling to avoid stale closures and constant interval resetting
  const historyRef = useRef(history);
  const currentImageRef = useRef(currentImage);

  // Sync refs with state
  useEffect(() => {
      historyRef.current = history;
  }, [history]);

  useEffect(() => {
      currentImageRef.current = currentImage;
  }, [currentImage]);

  // Handle initialization/reset of model when switching to creation view
  useEffect(() => {
    if (currentView === 'creation') {
        let options;
        if (provider === 'gitee') options = GITEE_MODEL_OPTIONS;
        else if (provider === 'modelscope') options = MS_MODEL_OPTIONS;
        else options = HF_MODEL_OPTIONS;

        const isValid = options.some(o => o.value === model);
        if (!isValid) {
            const defaultModel = options[0].value as ModelOption;
            setModel(defaultModel);
            
            // Force parameter update for the new default model
            const config = getModelConfig(provider, defaultModel);
            setSteps(config.default);
            const gsConfig = getGuidanceScaleConfig(defaultModel, provider);
            if (gsConfig) setGuidanceScale(gsConfig.default);
        }
    }
  }, [currentView, provider, model]);

  // Robust Polling for Video Tasks
  useEffect(() => {
    const pollInterval = setInterval(async () => {
        // Use refs to check condition without adding dependencies
        const currentHist = historyRef.current;
        const pendingVideos = currentHist.filter(img => 
            img.videoStatus === 'generating' && 
            img.videoTaskId && 
            img.videoProvider === 'gitee'
        );
        
        if (pendingVideos.length === 0) return;

        // Fetch updates in parallel
        const updates = await Promise.all(pendingVideos.map(async (img) => {
            if (!img.videoTaskId) return null;
            try {
                const result = await getGiteeTaskStatus(img.videoTaskId);
                if (result.status === 'success' || result.status === 'failed') {
                    return { id: img.id, ...result };
                }
                return null;
            } catch (e) {
                console.error("Failed to poll task", img.videoTaskId, e);
                return null;
            }
        }));

        const validUpdates = updates.filter(u => u !== null) as {id: string, status: string, videoUrl?: string, error?: string}[];

        if (validUpdates.length > 0) {
            setHistory(prev => prev.map(item => {
                const update = validUpdates.find(u => u.id === item.id);
                if (!update) return item;

                if (update.status === 'success' && update.videoUrl) {
                    return { ...item, videoStatus: 'success', videoUrl: update.videoUrl };
                } else if (update.status === 'failed') {
                    const failMsg = update.error || 'Video generation failed';
                    return { ...item, videoStatus: 'failed', videoError: failMsg };
                }
                return item;
            }));

            // Sync currentImage if it's the one currently being viewed
            const currImg = currentImageRef.current;
            if (currImg) {
                const relevantUpdate = validUpdates.find(u => u.id === currImg.id);
                if (relevantUpdate) {
                     if (relevantUpdate.status === 'success' && relevantUpdate.videoUrl) {
                        setCurrentImage(prev => prev ? { ...prev, videoStatus: 'success', videoUrl: relevantUpdate.videoUrl } : null);
                        setIsLiveMode(true);
                     } else if (relevantUpdate.status === 'failed') {
                        setCurrentImage(prev => prev ? { ...prev, videoStatus: 'failed', videoError: relevantUpdate.error || 'Video generation failed' } : null);
                        setError(relevantUpdate.error || 'Video generation failed');
                     }
                }
            }
        }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(pollInterval);
  }, []); // Empty dependency array ensures interval doesn't reset on render


  // Language Persistence
  useEffect(() => {
    localStorage.setItem('app_language', lang);
  }, [lang]);

  // Image History Persistence
  useEffect(() => {
    localStorage.setItem('ai_image_gen_history', JSON.stringify(history));
  }, [history]);

  // Update steps and guidance scale when model/provider changes
  useEffect(() => {
      const config = getModelConfig(provider, model);
      setSteps(config.default);

      const gsConfig = getGuidanceScaleConfig(model, provider);
      if (gsConfig) {
          setGuidanceScale(gsConfig.default);
      }
  }, [provider, model]);

  // Handle Auto Translate default state based on model
  useEffect(() => {
    if (FLUX_MODELS.includes(model)) {
        setAutoTranslate(true);
    } else {
        setAutoTranslate(false);
    }
  }, [model]);

  // Initial Selection Effect
  useEffect(() => {
    if (!currentImage && history.length > 0) {
      const firstImg = history[0];
      setCurrentImage(firstImg);
      if (firstImg.videoUrl && firstImg.videoStatus === 'success') {
          setIsLiveMode(true);
      }
    }
  }, [history.length]); 

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
        if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    setElapsedTime(0);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
        setElapsedTime((Date.now() - startTime) / 1000);
    }, 100);
    return startTime;
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const addToPromptHistory = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    // Read current history from session storage
    let currentHistory: string[] = [];
    try {
        const saved = sessionStorage.getItem('prompt_history');
        currentHistory = saved ? JSON.parse(saved) : [];
    } catch (e) {}

    // Update
    const filtered = currentHistory.filter(p => p !== trimmed);
    const newHistory = [trimmed, ...filtered].slice(0, 50);

    // Save
    sessionStorage.setItem('prompt_history', JSON.stringify(newHistory));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    addToPromptHistory(prompt);

    setIsLoading(true);
    setError(null);
    setShowInfo(false); 
    setImageDimensions(null);
    setIsComparing(false);
    setTempUpscaledImage(null);
    setIsLiveMode(false);
    
    let finalPrompt = prompt;

    // Handle Auto Translate
    if (autoTranslate) {
        setIsTranslating(true);
        try {
            finalPrompt = await translatePrompt(prompt);
            setPrompt(finalPrompt); // Update UI with translated text
        } catch (err: any) {
            console.error("Translation failed", err);
        } finally {
            setIsTranslating(false);
        }
    }

    const startTime = startTimer();

    try {
      const seedNumber = seed.trim() === '' ? undefined : parseInt(seed, 10);
      const gsConfig = getGuidanceScaleConfig(model, provider);
      const currentGuidanceScale = gsConfig ? guidanceScale : undefined;

      let result;

      if (provider === 'gitee') {
         result = await generateGiteeImage(model, finalPrompt, aspectRatio, seedNumber, steps, enableHD, currentGuidanceScale);
      } else if (provider === 'modelscope') {
         result = await generateMSImage(model, finalPrompt, aspectRatio, seedNumber, steps, enableHD, currentGuidanceScale);
      } else {
         result = await generateImage(model, finalPrompt, aspectRatio, seedNumber, enableHD, steps, currentGuidanceScale);
      }
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      const newImage = { 
          ...result, 
          duration, 
          provider, 
          guidanceScale: currentGuidanceScale 
      };
      
      setCurrentImage(newImage);
      setHistory(prev => [newImage, ...prev]);
    } catch (err: any) {
      const errorMessage = (t as any)[err.message] || err.message || t.generationFailed;
      setError(errorMessage);
    } finally {
      stopTimer();
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setPrompt('');
    if (provider === 'gitee') {
        setModel(GITEE_MODEL_OPTIONS[0].value as ModelOption);
    } else if (provider === 'modelscope') {
        setModel(MS_MODEL_OPTIONS[0].value as ModelOption);
    } else {
        setModel(HF_MODEL_OPTIONS[0].value as ModelOption);
    }
    setAspectRatio('1:1');
    setSeed('');
    const config = getModelConfig(provider, model);
    setSteps(config.default);
    setEnableHD(false);
    setCurrentImage(null);
    setIsComparing(false);
    setTempUpscaledImage(null);
    setIsLiveMode(false);
    setError(null);
  };

  const handleUpscale = async () => {
    if (!currentImage || isUpscaling) return;
    setIsUpscaling(true);
    setError(null);
    try {
        const { url: newUrl } = await upscaler(currentImage.url);
        setTempUpscaledImage(newUrl);
        setIsComparing(true);
    } catch (err: any) {
        setTempUpscaledImage(null);
        const errorMessage = (t as any)[err.message] || err.message || t.error_upscale_failed;
        setError(errorMessage);
    } finally {
        setIsUpscaling(false);
    }
  };

  const handleApplyUpscale = () => {
    if (!currentImage || !tempUpscaledImage) return;
    const updatedImage = { 
        ...currentImage, 
        url: tempUpscaledImage, 
        isUpscaled: true 
    };
    setCurrentImage(updatedImage);
    setHistory(prev => prev.map(img => 
        img.id === updatedImage.id ? updatedImage : img
    ));
    setIsComparing(false);
    setTempUpscaledImage(null);
  };

  const handleCancelUpscale = () => {
    setIsComparing(false);
    setTempUpscaledImage(null);
  };

  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) return;
    addToPromptHistory(prompt);
    setIsOptimizing(true);
    setError(null);
    try {
        let optimized = '';
        if (provider === 'gitee') {
             optimized = await optimizePromptGitee(prompt, lang);
        } else if (provider === 'modelscope') {
             optimized = await optimizePromptMS(prompt, lang);
        } else {
             optimized = await optimizePrompt(prompt, lang);
        }
        setPrompt(optimized);
    } catch (err: any) {
        console.error("Optimization failed", err);
        const errorMessage = (t as any)[err.message] || err.message || t.error_prompt_optimization_failed;
        setError(errorMessage);
    } finally {
        setIsOptimizing(false);
    }
  };

  const handleHistorySelect = (image: GeneratedImage) => {
    setCurrentImage(image);
    setShowInfo(false); 
    setImageDimensions(null); 
    setIsComparing(false);
    setTempUpscaledImage(null);
    // Automatically switch to Live Mode if video is available
    if (image.videoUrl && image.videoStatus === 'success') {
        setIsLiveMode(true);
    } else {
        setIsLiveMode(false);
    }
    setError(null);
  };

  const handleDelete = () => {
    if (!currentImage) return;
    const newHistory = history.filter(img => img.id !== currentImage.id);
    setHistory(newHistory);
    
    setShowInfo(false);
    setIsComparing(false);
    setTempUpscaledImage(null);
    setError(null);

    if (newHistory.length > 0) {
      const nextImg = newHistory[0];
      setCurrentImage(nextImg);
      if (nextImg.videoUrl && nextImg.videoStatus === 'success') {
          setIsLiveMode(true);
      } else {
          setIsLiveMode(false);
      }
    } else {
      setCurrentImage(null);
      setIsLiveMode(false);
    }
  };

  const handleToggleBlur = () => {
    if (!currentImage) return;
    const newStatus = !currentImage.isBlurred;
    const updatedImage = { ...currentImage, isBlurred: newStatus };
    setCurrentImage(updatedImage);
    setHistory(prev => prev.map(img => 
      img.id === currentImage.id ? updatedImage : img
    ));
  };

  const handleCopyPrompt = async () => {
    if (!currentImage?.prompt) return;
    try {
      await navigator.clipboard.writeText(currentImage.prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleLiveClick = async () => {
      if (!currentImage) return;

      // 2. If already generating, do nothing
      if (currentImage.videoStatus === 'generating') return;

      // 3. Start Generation
      let width = imageDimensions?.width || 1024;
      let height = imageDimensions?.height || 1024;

      // Resolution scaling logic (Specific to Gitee)
      if (provider === 'gitee') {
          // Enforce 720p (Short edge 720px)
          const imgAspectRatio = width / height;
          if (width >= height) {
              // Landscape or Square: Set Height to 720
              height = 720;
              width = Math.round(height * imgAspectRatio);
          } else {
              // Portrait: Set Width to 720
              width = 720;
              height = Math.round(width / imgAspectRatio);
          }

          // Ensure even numbers (common requirement for video encoding)
          if (width % 2 !== 0) width -= 1;
          if (height % 2 !== 0) height -= 1;
      }

      try {
          // Capture the provider being used for video generation
          const currentVideoProvider = provider;

          const loadingImage = { 
              ...currentImage, 
              videoStatus: 'generating',
              videoProvider: currentVideoProvider 
          } as GeneratedImage;

          setCurrentImage(loadingImage);
          setHistory(prev => prev.map(img => img.id === loadingImage.id ? loadingImage : img));

          if (currentVideoProvider === 'gitee') {
              // Gitee: Create Task and let polling handle it
              // Prompt is fetched from settings inside the service
              const taskId = await createVideoTask(currentImage.url, width, height);
              const taskedImage = { ...loadingImage, videoTaskId: taskId } as GeneratedImage;
              setCurrentImage(taskedImage);
              setHistory(prev => prev.map(img => img.id === taskedImage.id ? taskedImage : img));
          } else if (currentVideoProvider === 'huggingface') {
              // HF: Create Task handles the waiting internally (Long Connection)
              // Prompt is fetched from settings inside the service
              const videoUrl = await createVideoTaskHF(currentImage.url, currentImage.seed);
              // Success
              const successImage = { ...loadingImage, videoStatus: 'success', videoUrl } as GeneratedImage;
              setHistory(prev => prev.map(img => img.id === successImage.id ? successImage : img));
              // Update current if user hasn't switched away
              setCurrentImage(prev => (prev && prev.id === successImage.id) ? successImage : prev);
              
              if (currentImageRef.current?.id === successImage.id) {
                  setIsLiveMode(true);
              }
          }

      } catch (e: any) {
          console.error("Video Generation Failed", e);
          const failedImage = { ...currentImage, videoStatus: 'failed', videoError: e.message } as GeneratedImage;
          setCurrentImage(prev => (prev && prev.id === failedImage.id) ? failedImage : prev);
          setHistory(prev => prev.map(img => img.id === failedImage.id ? failedImage : img));
          setError(t.liveError);
      }
  };

  const handleDownload = async (imageUrl: string, fileName: string) => {
    // If Live mode is active and we have a video URL, download that instead
    if (isLiveMode && currentImage?.videoUrl) {
        imageUrl = currentImage.videoUrl;
        fileName = fileName.replace(/\.(png|jpg|webp)$/, '') + '.mp4';
    }

    if (isDownloading) return;
    setIsDownloading(true);

    try {
      // 1. Fetch blob (handles CORS if server allows, and Data URLs)
      let response: Response;
      try {
          response = await fetch(imageUrl, { mode: 'cors' });
          if (!response.ok) throw new Error('Network response was not ok');
      } catch (e) {
          console.warn("Fetch failed, trying fallback");
          // Last resort: Open URL directly.
          window.open(imageUrl, '_blank');
          setIsDownloading(false);
          return;
      }
      
      let blob = await response.blob();

      // 2. Convert WebP to PNG if needed (Only for images)
      if (blob.type.startsWith('image') && (blob.type === 'image/webp' || imageUrl.includes('.webp'))) {
          try {
             // Create a temp image to draw to canvas
             const img = new Image();
             img.crossOrigin = "Anonymous";
             const blobUrl = URL.createObjectURL(blob);
             
             await new Promise((resolve, reject) => {
                 img.onload = resolve;
                 img.onerror = reject;
                 img.src = blobUrl;
             });
             
             const canvas = document.createElement('canvas');
             canvas.width = img.naturalWidth;
             canvas.height = img.naturalHeight;
             const ctx = canvas.getContext('2d');
             if (ctx) {
                 ctx.drawImage(img, 0, 0);
                 const pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                 if (pngBlob) {
                     blob = pngBlob;
                     fileName = fileName.replace(/\.webp$/i, '.png');
                     if (!fileName.endsWith('.png')) fileName += '.png';
                 }
             }
             URL.revokeObjectURL(blobUrl);
          } catch (e) {
              console.warn("Conversion failed, using original blob", e);
          }
      }

      // Ensure extension matches blob type if missing
      if (!fileName.includes('.')) {
          const type = blob.type.split('/')[1] || 'png';
          fileName = `${fileName}.${type}`;
      }

      // 3. Mobile Strategy: Web Share API (Primary for iOS/Mobile)
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (isMobile) {
          const file = new File([blob], fileName, { type: blob.type });
          
          const nav = navigator as any;
          const canShare = nav.canShare && nav.canShare({ files: [file] });

          if (canShare) {
              try {
                  await nav.share({
                      files: [file],
                      title: 'Peinture AI Asset',
                  });
                  setIsDownloading(false);
                  return; // Success, shared
              } catch (e: any) {
                  if (e.name !== 'AbortError') console.warn("Share failed", e);
                  if (e.name === 'AbortError') {
                      setIsDownloading(false);
                      return; // User cancelled
                  }
                  // If share failed (not cancelled), fall through to anchor method
              }
          }
      }

      // 4. Desktop/Fallback Strategy: Anchor Download
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      if (isMobile) link.target = '_blank';
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);

    } catch (e) {
      console.error("Download failed", e);
      window.open(imageUrl, '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  const isWorking = isLoading;
  const isLiveGenerating = currentImage?.videoStatus === 'generating';
  
  // Toolbar Visibility Logic:
  // Hide if:
  // 1. Image generation is working (isLoading/isWorking)
  // 2. Video generation is working (isLiveGenerating)
  // So we ONLY hide if isWorking (main image gen).
  const shouldHideToolbar = isWorking; 

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-gradient-brilliant">
      <div className="flex h-full grow flex-col">
        {/* Header Component */}
        <Header 
            currentView={currentView}
            setCurrentView={setCurrentView}
            onOpenSettings={() => setShowSettings(true)}
            onOpenFAQ={() => setShowFAQ(true)}
            t={t}
        />

        {/* Main Content Area */}
        {currentView === 'creation' ? (
            <main className="w-full max-w-7xl flex-1 flex flex-col-reverse md:items-stretch md:mx-auto md:flex-row gap-4 md:gap-6 px-4 md:px-8 pb-4 md:pb-8 pt-4 md:pt-6 animate-in fade-in duration-300">
            
                {/* Left Column: Controls */}
                <aside className="w-full md:max-w-sm flex-shrink-0 flex flex-col gap-4 md:gap-6">
                    <div className="flex-grow space-y-4 md:space-y-6">
                    <div className="relative z-10 bg-black/20 p-4 md:p-6 rounded-xl backdrop-blur-xl border border-white/10 flex flex-col gap-4 md:gap-6 shadow-2xl shadow-black/20">
                        
                        {/* Prompt Input Component */}
                        <PromptInput 
                            prompt={prompt}
                            setPrompt={setPrompt}
                            isOptimizing={isOptimizing}
                            onOptimize={handleOptimizePrompt}
                            isTranslating={isTranslating}
                            autoTranslate={autoTranslate}
                            setAutoTranslate={setAutoTranslate}
                            t={t}
                            addToPromptHistory={addToPromptHistory}
                        />

                        {/* Control Panel Component */}
                        <ControlPanel 
                            provider={provider}
                            setProvider={setProvider}
                            model={model}
                            setModel={setModel}
                            aspectRatio={aspectRatio}
                            setAspectRatio={setAspectRatio}
                            steps={steps}
                            setSteps={setSteps}
                            guidanceScale={guidanceScale}
                            setGuidanceScale={setGuidanceScale}
                            seed={seed}
                            setSeed={setSeed}
                            enableHD={enableHD}
                            setEnableHD={setEnableHD}
                            t={t}
                            aspectRatioOptions={aspectRatioOptions}
                        />
                    </div>

                    {/* Generate Button & Reset Button */}
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={handleGenerate}
                            disabled={isWorking || !prompt.trim() || isTranslating}
                            className="group relative flex-1 flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-xl h-12 px-4 text-white text-lg font-bold leading-normal tracking-[0.015em] transition-all shadow-lg shadow-purple-900/40 generate-button-gradient hover:shadow-purple-700/50 disabled:opacity-70 disabled:cursor-not-allowed disabled:grayscale"
                        >
                            {isLoading || isTranslating ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="animate-spin w-5 h-5" />
                                <span>{isTranslating ? t.translating : t.dreaming}</span>
                            </div>
                            ) : (
                            <span className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 group-hover:animate-pulse" />
                                <span className="truncate">{t.generate}</span>
                            </span>
                            )}
                        </button>

                        {currentImage && (
                            <Tooltip content={t.reset}>
                                <button 
                                    onClick={handleReset}
                                    className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all shadow-lg active:scale-95"
                                >
                                    <RotateCcw className="w-5 h-5" />
                                </button>
                            </Tooltip>
                        )}
                    </div>

                    </div>
                </aside>

                {/* Right Column: Preview & Gallery */}
                <div className="flex-1 flex flex-col flex-grow overflow-x-hidden">
                    
                    {/* Main Preview Area */}
                    <div className="relative group w-full">
                        <PreviewStage 
                            currentImage={currentImage}
                            isWorking={isWorking}
                            isTranslating={isTranslating}
                            elapsedTime={elapsedTime}
                            error={error}
                            onCloseError={() => setError(null)}
                            isComparing={isComparing}
                            tempUpscaledImage={tempUpscaledImage}
                            showInfo={showInfo}
                            setShowInfo={setShowInfo}
                            imageDimensions={imageDimensions}
                            setImageDimensions={setImageDimensions}
                            t={t}
                            copiedPrompt={copiedPrompt}
                            handleCopyPrompt={handleCopyPrompt}
                            isLiveMode={isLiveMode}
                            onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
                        >
                        {/* No children passed as toolbar is moved out */}
                        </PreviewStage>

                        {!shouldHideToolbar && (
                            <ImageToolbar 
                                currentImage={currentImage}
                                isComparing={isComparing}
                                showInfo={showInfo}
                                setShowInfo={setShowInfo}
                                isUpscaling={isUpscaling}
                                isDownloading={isDownloading}
                                handleUpscale={handleUpscale}
                                handleToggleBlur={handleToggleBlur}
                                handleDownload={() => currentImage && handleDownload(currentImage.url, `generated-${currentImage.id}`)}
                                handleDelete={handleDelete}
                                handleCancelUpscale={handleCancelUpscale}
                                handleApplyUpscale={handleApplyUpscale}
                                t={t}
                                isLiveMode={isLiveMode}
                                onLiveClick={handleLiveClick}
                                isLiveGenerating={isLiveGenerating}
                                provider={provider}
                            />
                        )}
                    </div>

                    {/* Gallery Strip */}
                    <HistoryGallery 
                        images={history} 
                        onSelect={handleHistorySelect} 
                        selectedId={currentImage?.id}
                    />

                </div>
            </main>
        ) : (
            <main className="w-full flex-1 flex flex-col items-center justify-center md:p-4">
                <ImageEditor 
                  t={t} 
                  provider={provider} 
                  setProvider={setProvider} 
                  onOpenSettings={() => setShowSettings(true)} 
                />
            </main>
        )}
        
        {/* Settings Modal */}
        <SettingsModal 
            isOpen={showSettings} 
            onClose={() => setShowSettings(false)} 
            lang={lang}
            setLang={setLang}
            t={t}
            provider={provider}
        />

        {/* FAQ Modal */}
        <FAQModal 
            isOpen={showFAQ}
            onClose={() => setShowFAQ(false)}
            t={t}
        />
      </div>
    </div>
  );
}
