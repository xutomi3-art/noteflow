import { useState, useRef, useEffect } from 'react';
import { X, Bug, Sparkles, ImagePlus, Loader2 } from 'lucide-react';
import { api } from '@/services/api';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [type, setType] = useState<'bug' | 'wish'>('bug');
  const [content, setContent] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setType('bug');
      setContent('');
      setScreenshot(null);
      setIsSubmitting(false);
      setShowSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await api.submitFeedback(type, content.trim(), screenshot || undefined);
      setShowSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch {
      // Keep modal open on error
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg p-6 relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {showSuccess ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">&#10024;</div>
            <h3 className="text-lg font-semibold text-slate-900">Thanks for your feedback!</h3>
            <p className="text-sm text-slate-500 mt-1">We'll review it soon.</p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900 mb-5">Report Bug & Make a Wish</h2>

            {/* Type selector */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setType('bug')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                  type === 'bug'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Bug className="w-4 h-4" />
                Bug
              </button>
              <button
                onClick={() => setType('wish')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                  type === 'wish'
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                Wish
              </button>
            </div>

            {/* Content textarea */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={type === 'bug' ? 'Describe the bug you encountered...' : 'Describe your wish or feature request...'}
              className="w-full h-32 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 outline-none resize-none transition-all focus:border-[#5b8c15] focus:ring-2 focus:ring-[#5b8c15]/20"
              autoFocus
            />

            {/* Screenshot input */}
            <div className="mt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setScreenshot(file);
                  e.target.value = '';
                }}
              />
              {screenshot ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl text-sm">
                  <ImagePlus className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="flex-1 truncate text-slate-700">{screenshot.name}</span>
                  <button
                    onClick={() => setScreenshot(null)}
                    className="text-slate-400 hover:text-slate-600 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                  <ImagePlus className="w-4 h-4" />
                  Attach screenshot (optional)
                </button>
              )}
            </div>

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              className="w-full mt-5 bg-[#5b8c15] text-white py-2.5 rounded-xl font-semibold hover:bg-[#4a7311] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </span>
              ) : (
                'Submit Feedback'
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
