
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
    Hand, 
    Brush, 
    Eraser, 
    Square, 
    Undo2, 
    ImagePlus, 
    Sparkles, 
    ArrowRight,
    Upload,
    X,
    LogOut,
    Keyboard,
    Minus,
    Plus,
    Loader2,
    Image as ImageIcon,
    AlignCenter,
    Download,
    Server,
    ChevronDown
} from 'lucide-react';
import { Tooltip } from './Tooltip';
import { editImageQwen } from '../services/hfService';
import { editImageGitee } from '../services/giteeService';
import { editImageMS } from '../services/msService';
import { ProviderOption } from '../types';
import { PROVIDER_OPTIONS } from '../constants';

interface ImageEditorProps {
    t: any;
    provider: ProviderOption;
    setProvider: (p: ProviderOption) => void;
    onOpenSettings: () => void;
}

type ToolType = 'select' | 'move' | 'brush' | 'eraser' | 'rect';

export const ImageEditor: React.FC<ImageEditorProps> = ({ t, provider, setProvider, onOpenSettings }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const snapshotRef = useRef<ImageData | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Core State
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [history, setHistory] = useState<ImageData[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // UI State
    const [isDragOver, setIsDragOver] = useState(false);
    const [showExitDialog, setShowExitDialog] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showProviderMenu, setShowProviderMenu] = useState(false);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

    // Tool State
    const [activeTool, setActiveTool] = useState<ToolType>('move');
    const [systemColor, setSystemColor] = useState<string>('#60A5FA'); // Default Light Blue (blue-400)
    
    // Transform State
    const [scale, setScale] = useState<number>(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 });
    const [startPosition, setStartPosition] = useState({ x: 0, y: 0 });

    // AI Command State
    const [command, setCommand] = useState('');
    const [attachedImages, setAttachedImages] = useState<string[]>([]);

    // Determine Platform for Shortcuts
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const MOD_KEY = isMac ? 'Cmd' : 'Alt'; 

    // --- History Management ---
    
    const saveToHistory = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        const imageData = ctx.getImageData(0, 0, width, height);
        // If we are in the middle of history, discard future states
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(imageData);
        
        // Limit history size to 20
        if (newHistory.length > 20) {
            newHistory.shift();
        } else {
            setHistoryIndex(newHistory.length - 1);
        }
        setHistory(newHistory);
    };

    const handleUndo = useCallback(() => {
        if (historyIndex > 0 && canvasRef.current) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.putImageData(history[newIndex], 0, 0);
            }
        }
    }, [history, historyIndex]);

    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1 && canvasRef.current) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.putImageData(history[newIndex], 0, 0);
            }
        }
    }, [history, historyIndex]);

    // --- Image Loading Logic ---

    const processFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                const img = new Image();
                // Ensure cross-origin handling for subsequent canvas operations
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    setImage(img);
                    
                    if (canvasRef.current && containerRef.current) {
                         canvasRef.current.width = img.width;
                         canvasRef.current.height = img.height;
                         
                         const ctx = canvasRef.current.getContext('2d');
                         if (ctx) {
                             // Clear canvas (drawing layer)
                             ctx.clearRect(0, 0, img.width, img.height);
                             
                             // Initialize history with empty/transparent state
                             const initialData = ctx.getImageData(0, 0, img.width, img.height);
                             setHistory([initialData]); 
                             setHistoryIndex(0);
                         }

                         // Calculate Scale to Fit
                         const { width: contW, height: contH } = containerRef.current.getBoundingClientRect();
                         
                         const scaleH = contH / img.height;
                         const scaleW = contW / img.width;
                         
                         // Fit to container (Contain)
                         const newScale = Math.min(scaleH, scaleW);
                         
                         setScale(newScale);

                         // Center Image using the new scale
                         // Formula: (ContainerDim - ImageDim * Scale) / 2
                         setOffset({
                             x: (contW - img.width * newScale) / 2,
                             y: (contH - img.height * newScale) / 2
                         });
                    }
                };
                img.src = event.target.result as string;
            }
        };
        reader.readAsDataURL(file);
    }, []);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
            // Clear input so same file can be selected again
            e.target.value = '';
        }
    };

    const handleExit = () => {
        setImage(null);
        setHistory([]);
        setHistoryIndex(-1);
        setCommand('');
        setAttachedImages([]);
        setScale(1);
        setOffset({ x: 0, y: 0 });
        setShowExitDialog(false);
    };

    // --- Zoom Helpers ---
    const zoomIn = useCallback(() => {
        if (!containerRef.current) return;
        const newScale = Math.min(scale * 1.1, 10);
        setScale(newScale);
    }, [scale]);

    const zoomOut = useCallback(() => {
        if (!containerRef.current) return;
        const newScale = Math.max(scale * 0.9, 0.1);
        setScale(newScale);
    }, [scale]);

    const zoomReset = useCallback(() => {
        if (image && containerRef.current) {
             const { width: contW, height: contH } = containerRef.current.getBoundingClientRect();
             const scaleH = contH / image.height;
             const scaleW = contW / image.width;
             const newScale = Math.min(scaleH, scaleW);
             setScale(newScale);
             setOffset({
                 x: (contW - image.width * newScale) / 2,
                 y: (contH - image.height * newScale) / 2
             });
        } else {
            setScale(1);
            setOffset({ x: 0, y: 0 });
        }
    }, [image]);

    // Centering without changing scale
    const handleCenterView = () => {
        if (image && containerRef.current) {
            const { width: contW, height: contH } = containerRef.current.getBoundingClientRect();
            setOffset({
                x: (contW - image.width * scale) / 2,
                y: (contH - image.height * scale) / 2
            });
        }
        setContextMenu(null);
    };

    // --- Keyboard Shortcuts ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMod = isMac ? e.metaKey : e.altKey;
            
            // Allow typing in text inputs without triggering shortcuts
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    // Generate logic handled by button or specific handler
                }
                return;
            }

            if (e.key === 'Escape') {
                if (contextMenu) setContextMenu(null);
                else if (showShortcuts) setShowShortcuts(false);
                else if (showExitDialog) setShowExitDialog(false);
                else if (image) setShowExitDialog(true);
                return;
            }

            const key = e.key.toLowerCase();

            // Mod+ Shortcuts
            if (isMod) {
                switch(key) {
                    case '0':
                        e.preventDefault();
                        zoomReset();
                        break;
                    case 'z':
                        e.preventDefault();
                        if (e.shiftKey) handleRedo();
                        else handleUndo();
                        break;
                }
            } 
            
            // Single Key or Shift Shortcuts (No Mod needed or handled above)
            switch(e.key) {
                case '+':
                case '=': // Often = is the same key as +
                    if (!isMod) { // Zoom in can be just +
                         e.preventDefault();
                         zoomIn();
                    }
                    break;
                case '-':
                    if (!isMod) { // Zoom out can be just -
                         e.preventDefault();
                         zoomOut();
                    }
                    break;
                case '0':
                    if (!isMod) {
                        e.preventDefault();
                        setActiveTool(prev => prev === 'move' ? 'select' : 'move');
                    }
                    break;
                case 'm':
                case 'M':
                    if (!isMod) {
                         e.preventDefault();
                         setActiveTool(prev => prev === 'move' ? 'select' : 'move');
                    }
                    break;
                case 'd':
                case 'D':
                case '1':
                    if (!isMod) {
                        e.preventDefault();
                        setActiveTool('brush');
                    }
                    break;
                case 'r':
                case 'R':
                case '2':
                    if (!isMod) {
                        e.preventDefault();
                        setActiveTool('rect');
                    }
                    break;
                case 'e':
                case '3':
                    if (!isMod) {
                        e.preventDefault();
                        setActiveTool('eraser');
                    }
                    break;
                case 'c':
                case 'C':
                case '5':
                     if (!isMod) {
                        e.preventDefault();
                        const colorInput = document.getElementById('editor-color-picker');
                        if (colorInput) (colorInput as HTMLElement).click();
                     }
                     break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMac, zoomIn, zoomOut, zoomReset, handleUndo, handleRedo, image, showExitDialog, showShortcuts, contextMenu]);

    // Drag & Drop Handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    // Global Paste Handler
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (e.clipboardData && e.clipboardData.files.length > 0) {
                const file = e.clipboardData.files[0];
                if (file.type.startsWith('image/')) {
                    e.preventDefault();
                    processFile(file);
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [processFile]);

    // --- Drawing Logic ---

    const getCanvasCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

        return {
            x: (clientX - rect.left) * (canvasRef.current.width / rect.width),
            y: (clientY - rect.top) * (canvasRef.current.height / rect.height)
        };
    };

    // Helper to get visual line width based on current scale
    const getDynamicLineWidth = (baseSize: number) => {
        return baseSize / scale;
    };

    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (contextMenu) setContextMenu(null);
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const coords = getCanvasCoordinates(e);

        if (activeTool === 'move') {
            setIsDragging(true);
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
            setLastPosition({ x: clientX, y: clientY });
        } else if (['brush', 'eraser', 'rect'].includes(activeTool)) {
            setIsDrawing(true);
            
            // Common settings
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (activeTool === 'brush') {
                ctx.globalCompositeOperation = 'source-over';
                ctx.lineWidth = getDynamicLineWidth(2); 
                ctx.strokeStyle = systemColor;
                ctx.beginPath();
                ctx.moveTo(coords.x, coords.y);
            } else if (activeTool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = getDynamicLineWidth(4); 
                ctx.beginPath();
                ctx.moveTo(coords.x, coords.y);
            } else if (activeTool === 'rect') {
                ctx.globalCompositeOperation = 'source-over';
                ctx.lineWidth = getDynamicLineWidth(2);
                ctx.strokeStyle = systemColor;
                setStartPosition(coords);
                // Save snapshot for drag preview
                snapshotRef.current = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!canvasRef.current) return;
        
        if (isDragging && activeTool === 'move') {
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
            
            const dx = clientX - lastPosition.x;
            const dy = clientY - lastPosition.y;
            
            setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setLastPosition({ x: clientX, y: clientY });
        } else if (isDrawing) {
             const ctx = canvasRef.current.getContext('2d');
             if (!ctx) return;
             
             const coords = getCanvasCoordinates(e);

             if (['brush', 'eraser'].includes(activeTool)) {
                 ctx.lineTo(coords.x, coords.y);
                 ctx.stroke();
             } else if (activeTool === 'rect' && snapshotRef.current) {
                 // Restore snapshot to clear previous rect frame
                 ctx.putImageData(snapshotRef.current, 0, 0);
                 
                 const width = coords.x - startPosition.x;
                 const height = coords.y - startPosition.y;
                 ctx.strokeRect(startPosition.x, startPosition.y, width, height);
             }
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        if (isDrawing) {
            setIsDrawing(false);
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx && canvasRef.current) {
                if (['brush', 'eraser'].includes(activeTool)) {
                     ctx.closePath();
                }
                // Save state after any drawing operation
                ctx.globalCompositeOperation = 'source-over'; // Reset
                saveToHistory(ctx, canvasRef.current.width, canvasRef.current.height);
                snapshotRef.current = null;
            }
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault(); 
        e.stopPropagation(); // Stop propagation to prevent browser scaling
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        const newScale = Math.min(Math.max(0.1, scale * delta), 10);

        // Calculate new offset to maintain center focus
        // newOffset = center - (center - oldOffset) * (newScale / oldScale)
        const newOffsetX = cx - (cx - offset.x) * (newScale / scale);
        const newOffsetY = cy - (cy - offset.y) * (newScale / scale);

        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        if (image) {
            setContextMenu({ x: e.clientX, y: e.clientY });
        }
    };

    // --- Utility: Convert to Blob ---
    
    const urlToBlob = async (url: string): Promise<Blob> => {
        const response = await fetch(url);
        return await response.blob();
    };

    const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas conversion failed'));
            }, 'image/png');
        });
    };

    const dataURLToBlob = (dataurl: string): Blob => {
        const arr = dataurl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while(n--){
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], {type:mime});
    };

    // --- Dimension Constraints (Multiples of 8) ---
    const scaleToConstraints = (w: number, h: number, maxVal: number = 1024) => {
        let width = w;
        let height = h;
        const MAX = maxVal;
        const MIN = 256;

        // Scale down if too large
        if (width > MAX || height > MAX) {
            const ratio = Math.min(MAX / width, MAX / height);
            width = Math.floor(width * ratio);
            height = Math.floor(height * ratio);
        }
        // Ensure not too small
        if (width < MIN || height < MIN) {
            const ratio = Math.max(MIN / width, MIN / height);
            width = Math.ceil(width * ratio);
            height = Math.ceil(height * ratio);
        }

        // Snap to nearest multiple of 8 and clamp
        const normalize = (v: number) => Math.min(MAX, Math.max(MIN, Math.floor(v / 8) * 8));
        
        return { 
            width: normalize(width), 
            height: normalize(height) 
        };
    };

    // --- Command Bar Attachment ---
    const handleRefImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            if (attachedImages.length >= 3) return;
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                if (event.target?.result) {
                    setAttachedImages(prev => [...prev, event.target!.result as string]);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const removeAttachedImage = (index: number) => {
        setAttachedImages(prev => prev.filter((_, i) => i !== index));
    };

    // --- Generation Logic ---

    const getMergedLayer = (): HTMLCanvasElement | null => {
        if (!image || !canvasRef.current) return null;
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        
        // Draw background
        ctx.drawImage(image, 0, 0);
        // Draw drawing layer (canvasRef)
        ctx.drawImage(canvasRef.current, 0, 0);
        
        return canvas;
    }

    const handleGenerate = async () => {
        if (!image || !command.trim()) return;
        setIsGenerating(true);
        try {
            // Dimension constraints (Multiples of 8)
            const maxDimension = 1024;
            const { width: normalizedWidth, height: normalizedHeight } = scaleToConstraints(image.naturalWidth, image.naturalHeight, maxDimension);
            
            const hasDrawings = historyIndex > 0;
            const imageBlobs: Blob[] = [];
            let promptSuffix = `\n${t.prompt_original_image}`;
            let currentImageIndexInAPI = 1;

            const originalBlob = await urlToBlob(image.src);
            imageBlobs.push(originalBlob);

            if (hasDrawings) {
                const mergedCanvas = getMergedLayer();
                if (mergedCanvas) {
                    const mergedBlob = await canvasToBlob(mergedCanvas);
                    imageBlobs.push(mergedBlob);
                    currentImageIndexInAPI++;
                    const editLayerDesc = t.prompt_edit_layer.replace('{n}', currentImageIndexInAPI.toString());
                    promptSuffix += `\n${editLayerDesc}`;
                }
            }

            for (let i = 0; i < attachedImages.length; i++) {
                const refBlob = dataURLToBlob(attachedImages[i]);
                imageBlobs.push(refBlob);
                currentImageIndexInAPI++;
                const refNumInUI = i + 1;
                const refDesc = t.prompt_ref_image.replace('{n}', currentImageIndexInAPI.toString()).replace('{i}', refNumInUI.toString());
                promptSuffix += `\n${refDesc}`;
            }

            const finalPrompt = command + promptSuffix;
            
            let result;
            if (provider === 'gitee') {
                result = await editImageGitee(imageBlobs, finalPrompt);
            } else if (provider === 'modelscope') {
                result = await editImageMS(imageBlobs, finalPrompt);
            } else {
                result = await editImageQwen(imageBlobs, finalPrompt, normalizedWidth, normalizedHeight);
            }

            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            if (provider === 'modelscope') {
                const link = document.createElement('a');
                link.href = result.url;
                if (isMobile) link.target = '_blank';
                link.download = `edited_image_${Date.now()}.png`;
                link.click();
            } else {
                const response = await fetch(result.url)
                if (!response.ok) {
                    throw new Error(`Failed to fetch generated image from ${result.url}: ${response.statusText}`);
                }
                const blob = await response.blob()
                const fileName = `edited_image_${Date.now()}.png`

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
                            return; // Success, shared
                        } catch (e: any) {
                            if (e.name !== 'AbortError') console.warn("Share failed", e);
                            if (e.name === 'AbortError') {
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
            }
            
            handleExit();
            setIsGenerating(false);
        } catch (e: any) {
            console.error(e);
            setIsGenerating(false);
            
            // Check for missing token errors and open settings
            const errorMsg = e.message || "";
            if (errorMsg.includes("token_required") || errorMsg.includes("credit") || errorMsg.includes("quota") || errorMsg.includes("token_exhausted")) {
                onOpenSettings();
            }
            
            alert((t as any)[e.message] || e.message || "Generation failed");
        }
    };

    const handleDownloadExport = async () => {
        const merged = getMergedLayer();
        if (merged) {
            const dataUrl = merged.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `peinture-edit-${Date.now()}.png`;
            link.click();
        }
        setContextMenu(null);
    };

    const drawingTools = [
        { id: 'brush', icon: Brush, label: t.tool_brush, shortcut: '1' },
        { id: 'rect', icon: Square, label: t.tool_rect, shortcut: '2' },
        { id: 'eraser', icon: Eraser, label: t.tool_eraser, shortcut: '3' },
    ];

    const shortcutsList = [
        { label: t.sc_send, combos: [['Shift', 'Enter']] },
        { label: t.sc_zoom_in, combos: [['+']] },
        { label: t.sc_zoom_out, combos: [['-']] },
        { label: t.sc_reset_view, combos: [[MOD_KEY, '0']] },
        { label: t.sc_move, combos: [['M'], ['0']] },
        { label: t.sc_draw, combos: [['D'], ['1']] },
        { label: t.sc_rect, combos: [['R'], ['2']] },
        { label: t.sc_eraser, combos: [['E'], ['3']] },
        { label: t.sc_undo, combos: [[MOD_KEY, 'Z']] }, 
        { label: t.sc_redo, combos: [[MOD_KEY, 'Shift', 'Z']] },
        { label: t.sc_color, combos: [['C'], ['5']] },
        { label: t.sc_exit, combos: [['ESC']] },
    ];

    return (
        <div className="w-full h-full flex flex-grow flex-col md:max-w-7xl md:mx-auto relative animate-in fade-in duration-300">
            {/* Main Editor Area */}
            <div 
                ref={containerRef}
                onContextMenu={handleContextMenu}
                className="flex-1 w-full relative overflow-hidden bg-[#0D0B14] cursor-crosshair rounded-none border-none md:rounded-xl md:border md:border-white/5"
                style={{ 
                    backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)',
                    backgroundSize: '20px 20px'
                }}
            >
                {/* Upload CTA - Only visible when no image */}
                {!image && (
                    <div 
                        className="absolute z-40 inset-0 flex flex-col items-center justify-center p-6 md:p-12"
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        <div className="w-full max-w-lg space-y-4">
                            <label className={`cursor-pointer group flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl transition-all duration-300 animate-in zoom-in-95 ${
                                isDragOver 
                                ? 'border-purple-500 bg-purple-500/10 scale-105' 
                                : 'border-white/20 bg-white/[0.02] hover:bg-white/[0.05] hover:border-purple-500/50'
                            }`}>
                                <input 
                                    ref={fileInputRef}
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={handleImageUpload}
                                />
                                <div className="mb-6 p-5 rounded-full bg-white/5 group-hover:bg-purple-500/20 group-hover:scale-110 transition-all duration-300 shadow-lg">
                                    <Upload className={`w-10 h-10 transition-colors ${isDragOver ? 'text-purple-400' : 'text-white/40 group-hover:text-purple-400'}`} />
                                </div>
                                <p className="text-white/60 font-medium text-lg group-hover:text-white/90 transition-colors">{t.upload_image_cta}</p>
                                <div className="mt-2 flex items-center gap-2 text-white/30 text-sm font-mono">
                                    <span>JPG, PNG, WebP</span>
                                    <span className="w-1 h-1 rounded-full bg-white/20"></span>
                                </div>
                            </label>

                            {/* Provider Switcher Dropdown in Upload Area */}
                            <div className="relative">
                                <button 
                                    onClick={() => setShowProviderMenu(!showProviderMenu)}
                                    className="w-1/2 mx-auto flex items-center justify-between px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all text-sm font-medium group/provider"
                                >
                                    <div className="flex items-center gap-3">
                                        <Server className="w-4 h-4 text-purple-400 group-hover/provider:scale-110 transition-transform" />
                                        <span>{PROVIDER_OPTIONS.find(o => o.value === provider)?.label}</span>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showProviderMenu ? 'rotate-180' : ''}`} />
                                </button>
                                
                                {showProviderMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowProviderMenu(false)} />
                                        <div className="absolute top-full left-1/4 w-1/2 mx-auto mt-2 bg-[#1A1625] border border-white/10 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                                            {PROVIDER_OPTIONS.map((opt) => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => {
                                                        setProvider(opt.value as ProviderOption);
                                                        setShowProviderMenu(false);
                                                    }}
                                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${opt.value === provider ? 'bg-purple-600/20 text-purple-400 font-bold' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
                                                >
                                                    <span className="truncate">{opt.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Content Layer - Only visible when image exists */}
                <div 
                    className={`absolute inset-0 origin-top-left touch-none transition-opacity duration-300 ${image ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={handleMouseDown}
                    onTouchMove={handleMouseMove}
                    onTouchEnd={handleMouseUp}
                    onWheel={handleWheel}
                >
                    {/* Background Original Image */}
                    {image && (
                        <img 
                            src={image.src} 
                            alt="Background Layer"
                            className="absolute top-0 left-0 pointer-events-none select-none shadow-2xl"
                            style={{ width: image.width, height: image.height, maxWidth: 'none' }}
                            draggable={false}
                        />
                    )}
                    
                    {/* Transparent Drawing Canvas */}
                    <canvas 
                        ref={canvasRef}
                        className={`relative z-10 ${activeTool === 'move' ? 'cursor-grab active:cursor-grabbing' : (activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair')}`}
                    />
                </div>

                {/* Context Menu (Glassmorphism) */}
                {contextMenu && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
                        <div 
                            className="fixed z-50 min-w-[160px] bg-black/60 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl p-1 animate-in fade-in zoom-in-95 duration-150"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                        >
                            <button 
                                onClick={() => { setContextMenu(null); fileInputRef.current?.click(); }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors text-left group"
                            >
                                <ImageIcon className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                                {t.menu_replace}
                            </button>
                            <button 
                                onClick={handleCenterView}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors text-left group"
                            >
                                <AlignCenter className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
                                {t.menu_center}
                            </button>
                            <button 
                                onClick={handleDownloadExport}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors text-left group"
                            >
                                <Download className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
                                {t.menu_download}
                            </button>
                            <div className="h-px bg-white/10 my-1 mx-1" />
                            <button 
                                onClick={() => { setContextMenu(null); setShowExitDialog(true); }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-left group"
                            >
                                <LogOut className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
                                {t.menu_exit}
                            </button>
                        </div>
                    </>
                )}

                {/* Zoom Indicator (Bottom Left) */}
                {image && (
                    <div className="absolute bottom-6 left-6 hidden md:flex items-center gap-1 bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-white/70 shadow-lg z-20">
                        <Tooltip content={t.sc_zoom_out}>
                            <button 
                                onClick={zoomOut}
                                className="p-2 hover:bg-white/10 hover:text-white transition-colors rounded-s-full"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                        </Tooltip>
                        
                        <Tooltip content={t.sc_reset_view}>
                            <button 
                                onClick={zoomReset}
                                className="p-2 text-xs font-mono min-w-[3rem] text-center outline-none select-none hover:bg-white/10 hover:text-white transition-colors"
                            >
                                {Math.round(scale * 100)}%
                            </button>
                        </Tooltip>

                        <Tooltip content={t.sc_zoom_in}>
                            <button 
                                onClick={zoomIn}
                                className="p-2 hover:bg-white/10 hover:text-white transition-colors rounded-e-full"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </Tooltip>
                    </div>
                )}

                {/* Shortcuts Help (Bottom Right) */}
                <div className="absolute bottom-6 right-6 hidden md:block z-20">
                    <Tooltip content={t.shortcuts_title} position="left">
                        <button 
                            onClick={() => setShowShortcuts(true)}
                            className="p-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors shadow-lg"
                        >
                            <Keyboard className="w-5 h-5" />
                        </button>
                    </Tooltip>
                </div>

                {/* Floating Top Toolbar */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-30 max-w-[95vw]">
                    {/* Move Tool */}
                    <Tooltip content={activeTool === 'move' ? t.tool_select : t.tool_move} position="bottom">
                        <button
                            onClick={() => setActiveTool(activeTool === 'move' ? 'select' : 'move')}
                            className={`p-2 rounded-xl transition-all ${
                                activeTool === 'move' 
                                ? 'bg-purple-600 text-white shadow-lg' 
                                : 'text-white/60 hover:text-white hover:bg-white/10'
                            }`}
                        >
                            <Hand className="w-5 h-5" />
                        </button>
                    </Tooltip>

                    <div className="w-px h-5 bg-white/10 mx-1" />

                    {/* Drawing Tools */}
                    {drawingTools.map((tool) => {
                        const Icon = tool.icon;
                        return (
                            <Tooltip key={tool.id} content={tool.label} position="bottom">
                                <button
                                    onClick={() => setActiveTool(tool.id as ToolType)}
                                    className={`p-2 rounded-xl transition-all ${
                                        activeTool === tool.id 
                                        ? 'bg-purple-600 text-white shadow-lg' 
                                        : 'text-white/60 hover:text-white hover:bg-white/10'
                                    }`}
                                >
                                    <Icon className="w-5 h-5" />
                                </button>
                            </Tooltip>
                        );
                    })}
                    
                    <div className="w-px h-5 bg-white/10 mx-1" />
                    
                    {/* Undo */}
                    <Tooltip content={t.tool_undo} position="bottom">
                        <button 
                            onClick={handleUndo} 
                            disabled={historyIndex <= 0}
                            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed group"
                        >
                            <Undo2 className="w-5 h-5" />
                        </button>
                    </Tooltip>

                    {/* Color Picker */}
                    <Tooltip content={t.tool_color} position="bottom">
                        <label className="cursor-pointer block relative">
                            <input 
                                id="editor-color-picker"
                                type="color" 
                                value={systemColor} 
                                onChange={(e) => setSystemColor(e.target.value)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <div className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                                <div 
                                    className="w-5 h-5 rounded-full border-2 border-white/20 shadow-sm" 
                                    style={{ backgroundColor: systemColor }}
                                ></div>
                            </div>
                        </label>
                    </Tooltip>

                    <div className="w-px h-5 bg-white/10 mx-1" />
                    
                    <Tooltip content={t.tool_exit} position="bottom">
                         <button 
                            onClick={() => setShowExitDialog(true)}
                            className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                        >
                            <LogOut className="w-5 h-5" />
                        </button>
                    </Tooltip>
                </div>

                {/* Floating Bottom AI Command Bar */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-30 select-none">
                    <div className="relative flex items-center h-14 pl-2 pr-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl shadow-black/40 ring-1 ring-white/5">
                        
                        {/* Attach Reference Images */}
                        <div className="flex items-center mr-2">
                             {attachedImages.map((img, idx) => (
                                <Tooltip key={idx} content={t.ref_image_n.replace('{n}', (idx + 1).toString())}>
                                    <div 
                                        className={`relative w-8 h-8 rounded-full overflow-hidden border border-purple-500/50 group flex-shrink-0 bg-[#0D0B14] ${idx > 0 ? '-ml-3' : ''}`} 
                                        style={{ zIndex: 10 + idx }}
                                    >
                                        <div className="w-full h-full relative">
                                            <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                                            <button 
                                                onClick={() => removeAttachedImage(idx)}
                                                className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-3 h-3 text-white" />
                                            </button>
                                        </div>
                                    </div>
                                </Tooltip>
                             ))}
                             
                             {attachedImages.length < 3 && (
                                <div className={`relative flex-shrink-0 ${attachedImages.length > 0 ? 'ml-2' : ''}`} style={{ zIndex: 20 }}>
                                    <input 
                                        type="file" 
                                        id="cmd-image-upload" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={handleRefImageSelect}
                                    />
                                    <Tooltip content={t.upload_ref_image}>
                                        <label 
                                            htmlFor="cmd-image-upload"
                                            className="flex items-center justify-center w-8 h-8 rounded-full cursor-pointer transition-all hover:bg-white/10 text-white/50 border border-white/5 hover:border-white/20 hover:text-white"
                                        >
                                            <ImagePlus className="w-4 h-4" />
                                        </label>
                                    </Tooltip>
                                </div>
                             )}
                        </div>

                        {/* Sparkles Icon */}
                        <div className="hidden md:flex items-center justify-center w-6 h-full text-purple-500/80 mr-1">
                            <Sparkles className="w-4 h-4" />
                        </div>

                        {/* Text Input */}
                        <input
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleGenerate();
                                }
                            }}
                            placeholder={t.editor_placeholder}
                            disabled={isGenerating}
                            className="flex-1 bg-transparent border-0 text-white placeholder:text-white/30 focus:ring-0 h-full text-sm font-medium px-0 min-w-0 disabled:opacity-50"
                        />

                        {/* Generate Button with smooth transition to circular loading state */}
                        <button 
                            onClick={handleGenerate}
                            disabled={isGenerating || !image || !command.trim()}
                            className={`
                                flex items-center justify-center gap-1.5 transition-all duration-500 ease-in-out
                                generate-button-gradient text-white font-bold shadow-lg shadow-purple-900/20 active:scale-95 ml-2
                                disabled:grayscale disabled:opacity-50
                                ${isGenerating 
                                    ? 'w-11 h-11 rounded-full p-0 flex-shrink-0' 
                                    : 'px-4 py-2 rounded-full flex-shrink-0'
                                }
                            `}
                        >
                            {isGenerating ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <span className="whitespace-nowrap text-sm">{t.editor_generate}</span>
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Exit Dialog Modal */}
            {showExitDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#1A1625] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-white mb-2">{t.exit_dialog_title}</h3>
                        <p className="text-white/60 text-sm mb-6">{t.exit_dialog_desc}</p>
                        <div className="flex justify-end gap-3">
                            <button 
                                onClick={() => setShowExitDialog(false)}
                                className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium"
                            >
                                {t.cancel}
                            </button>
                            <button 
                                onClick={handleExit}
                                className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors text-sm font-medium"
                            >
                                {t.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shortcuts Dialog Modal */}
            {showShortcuts && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setShowShortcuts(false)}
                >
                    <div 
                        className="bg-[#1A1625] border border-white/10 rounded-2xl p-4 max-w-xl w-full shadow-2xl animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Keyboard className="w-5 h-5 text-purple-400" />
                                {t.shortcuts_title}
                            </h3>
                            <button onClick={() => setShowShortcuts(false)} className="text-white/40 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                            {shortcutsList.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm group">
                                    <span className="text-white/60 group-hover:text-white/80 transition-colors">{item.label}</span>
                                    <div className="flex items-center gap-2">
                                        {item.combos.map((combo, comboIdx) => (
                                            <React.Fragment key={comboIdx}>
                                                {comboIdx > 0 && <span className="text-white/30 text-xs">{t.or_conjunction}</span>}
                                                <div className="flex gap-1">
                                                    {combo.map((key, kIdx) => (
                                                        <span key={kIdx} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 font-mono text-xs text-white/80 min-w-[20px] text-center">
                                                            {key}
                                                        </span>
                                                    ))}
                                                </div>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
