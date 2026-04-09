import { create } from "zustand";
import { api } from "../../services/api";

function getAccessToken(): string {
  // Try api instance first, fall back to localStorage
  return api.getToken() || localStorage.getItem("access_token") || "";
}

export interface Utterance {
  speaker_id: string;
  text: string;
  start_time_ms: number;
  end_time_ms: number;
  is_final: boolean;
  sequence: number;
  provider?: string;
  wall_time?: string;  // Beijing time HH:MM:SS
}

export const ASR_PROVIDERS = ['qwen3'] as const;
export const ASR_LABELS: Record<string, string> = {
  qwen3: 'Qwen3-ASR',
};

export interface Meeting {
  id: string;
  notebook_id: string;
  status: "recording" | "paused" | "ended" | "failed";
  speaker_map: Record<string, string>;
  title: string | null;
  source_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

interface MeetingState {
  activeMeeting: Meeting | null;
  utterances: Utterance[];
  isRecording: boolean;
  isPaused: boolean;
  speakerMap: Record<string, string>;
  duration: number; // seconds elapsed
  error: string | null;

  // Internal refs (not serialized)
  _ws: WebSocket | null;
  _audioContext: AudioContext | null;
  _mediaStream: MediaStream | null;
  _workletNode: AudioWorkletNode | null;
  _durationInterval: ReturnType<typeof setInterval> | null;
  _autoEndTimeout: ReturnType<typeof setTimeout> | null;
  _pingInterval: ReturnType<typeof setInterval> | null;
  _pausedAt: number | null; // timestamp when paused due to navigation

  startMeeting: (notebookId: string) => Promise<void>;
  resumeExistingMeeting: (notebookId: string, meeting: Meeting) => Promise<void>;
  pauseMeeting: () => void;
  resumeMeeting: () => void;
  /** Pause recording when user leaves the notebook page */
  pauseOnLeave: () => void;
  /** Resume recording when user returns to the notebook page */
  resumeOnReturn: () => boolean;
  endMeeting: () => Promise<{ source_id: string } | null>;
  renameSpeaker: (speakerId: string, name: string) => void;
  reset: () => void;
}

const BASE_URL = typeof window !== "undefined" ? window.location.origin : "";

export const useMeetingStore = create<MeetingState>((set, get) => ({
  activeMeeting: null,
  utterances: [],
  isRecording: false,
  isPaused: false,
  speakerMap: {},
  duration: 0,
  error: null,
  _ws: null,
  _audioContext: null,
  _mediaStream: null,
  _workletNode: null,
  _durationInterval: null,
  _autoEndTimeout: null,
  _pingInterval: null,
  _pausedAt: null,

  startMeeting: async (notebookId: string) => {
    try {
      // 1. Create meeting via REST
      const res = await fetch(`${BASE_URL}/api/notebooks/${notebookId}/meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken()}`,
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create meeting");
      }
      const meeting: Meeting = await res.json();

      // 2. Request mic — echoCancellation OFF so external audio (TV/speakers) is captured
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
        },
      });

      // 3. AudioContext at 16kHz — no manual downsampling needed
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      let worklet: AudioWorkletNode | null = null;

      // 4. Open WebSocket first (audio setup sends data to it)
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = getAccessToken();
      const wsUrl = `${wsProtocol}//${window.location.host}/api/notebooks/${notebookId}/meetings/${meeting.id}/audio?token=${token}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      // 5. Audio processing — prefer AudioWorklet, fallback to ScriptProcessor
      const sendAudio = (data: ArrayBuffer) => {
        if (ws.readyState === WebSocket.OPEN && !get().isPaused) {
          ws.send(data);
        }
      };

      ws.onopen = async () => {
        try {
          await audioCtx.audioWorklet.addModule("/pcm-capture-processor.js");
          worklet = new AudioWorkletNode(audioCtx, "pcm-capture-processor");
          worklet.port.onmessage = (e: MessageEvent) => sendAudio(e.data);
          source.connect(worklet);
          worklet.connect(audioCtx.destination);
        } catch {
          // Fallback: ScriptProcessor (deprecated but universal)
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (ev: AudioProcessingEvent) => {
            const float32 = ev.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            sendAudio(int16.buffer);
          };
          source.connect(processor);
          processor.connect(audioCtx.destination);
        }
      };

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data === "string") {
          const msg = JSON.parse(e.data);
          if (msg.type === "utterance") {
            const utt: Utterance = {
              speaker_id: msg.speaker_id,
              text: msg.text,
              start_time_ms: msg.start_time_ms,
              end_time_ms: msg.end_time_ms,
              is_final: msg.is_final,
              sequence: msg.sequence,
              provider: msg.provider || "firered",
              wall_time: msg.wall_time || "",
            };
            set((s) => {
              const updated = [...s.utterances];

              if (utt.is_final && utt.sequence > 0) {
                // LLM rewrite or ASR final — find by sequence and replace in-place
                const idx = updated.findIndex((u) => u.sequence === utt.sequence);
                if (idx >= 0) {
                  updated[idx] = utt;
                  return { utterances: updated };
                }
                // No existing entry — insert at correct position by sequence order
                const insertIdx = updated.findIndex((u) => u.sequence > utt.sequence);
                if (insertIdx >= 0) {
                  updated.splice(insertIdx, 0, utt);
                  return { utterances: updated };
                }
                return { utterances: [...updated, utt] };
              }

              if (!utt.is_final && utt.text === "...") {
                // "..." indicator — replace existing "..." or append
                const hasIndicator = updated.some((u) => !u.is_final && u.text === "...");
                if (hasIndicator) return { utterances: updated };
                return { utterances: [...updated, utt] };
              }

              if (!utt.is_final) {
                // Non-final ASR result — just append, keep everything
                return { utterances: [...updated, utt] };
              }

              // Regular final without sequence — remove "..." then append
              const cleaned = updated.filter((u) => u.text !== "...");
              return { utterances: [...cleaned, utt] };
            });

            // Track new speakers
            if (!get().speakerMap[msg.speaker_id]) {
              set((s) => ({
                speakerMap: {
                  ...s.speakerMap,
                  [msg.speaker_id]: msg.speaker_id.replace("_", " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                },
              }));
            }
          } else if (msg.type === "error") {
            set({ error: msg.message });
          }
        }
      };

      ws.onerror = () => set({ error: "WebSocket connection error" });
      ws.onclose = () => set({ isRecording: false });

      // 6. Start duration timer
      const interval = setInterval(() => {
        if (!get().isPaused) {
          set((s) => ({ duration: s.duration + 1 }));
        }
      }, 1000);

      set({
        activeMeeting: meeting,
        isRecording: true,
        isPaused: false,
        utterances: [],
        speakerMap: {},
        duration: 0,
        error: null,
        _ws: ws,
        _audioContext: audioCtx,
        _mediaStream: stream,
        _workletNode: worklet,
        _durationInterval: interval,
      });
    } catch (e: any) {
      set({ error: e.message || "Failed to start meeting" });
      throw e;
    }
  },

  resumeExistingMeeting: async (notebookId: string, meeting: Meeting) => {
    try {
      // 1. Fetch existing utterances
      const uttRes = await fetch(`${BASE_URL}/api/notebooks/${notebookId}/meetings/${meeting.id}/utterances`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      const existingUtterances: Utterance[] = uttRes.ok ? await uttRes.json() : [];

      // 2. Request mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: false, noiseSuppression: true },
      });

      // 3. AudioContext at 16kHz
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);

      // 4. WebSocket
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = getAccessToken();
      const wsUrl = `${wsProtocol}//${window.location.host}/api/notebooks/${notebookId}/meetings/${meeting.id}/audio?token=${token}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      const sendAudio = (data: ArrayBuffer) => {
        if (ws.readyState === WebSocket.OPEN && !get().isPaused) ws.send(data);
      };

      ws.onopen = async () => {
        try {
          await audioCtx.audioWorklet.addModule("/pcm-capture-processor.js");
          const worklet = new AudioWorkletNode(audioCtx, "pcm-capture-processor");
          worklet.port.onmessage = (e: MessageEvent) => sendAudio(e.data);
          source.connect(worklet);
          worklet.connect(audioCtx.destination);
        } catch {
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (ev: AudioProcessingEvent) => {
            const float32 = ev.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            sendAudio(int16.buffer);
          };
          source.connect(processor);
          processor.connect(audioCtx.destination);
        }
      };

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data === "string") {
          const msg = JSON.parse(e.data);
          if (msg.type === "utterance") {
            const utt: Utterance = {
              speaker_id: msg.speaker_id, text: msg.text,
              start_time_ms: msg.start_time_ms, end_time_ms: msg.end_time_ms,
              is_final: msg.is_final, sequence: msg.sequence,
              provider: msg.provider || "firered2s",
              wall_time: msg.wall_time || "",
            };
            set((s) => {
              const updated = [...s.utterances];

              if (utt.is_final && utt.sequence > 0) {
                const idx = updated.findIndex((u) => u.sequence === utt.sequence);
                if (idx >= 0) {
                  updated[idx] = utt;
                  return { utterances: updated };
                }
                const insertIdx = updated.findIndex((u) => u.sequence > utt.sequence);
                if (insertIdx >= 0) {
                  updated.splice(insertIdx, 0, utt);
                  return { utterances: updated };
                }
                return { utterances: [...updated, utt] };
              }

              if (!utt.is_final && utt.text === "...") {
                const hasIndicator = updated.some((u) => !u.is_final && u.text === "...");
                if (hasIndicator) return { utterances: updated };
                return { utterances: [...updated, utt] };
              }

              if (!utt.is_final) {
                return { utterances: [...updated, utt] };
              }

              const cleaned = updated.filter((u) => u.text !== "...");
              return { utterances: [...cleaned, utt] };
            });
            if (!get().speakerMap[msg.speaker_id]) {
              set((s) => ({ speakerMap: { ...s.speakerMap, [msg.speaker_id]: msg.speaker_id.replace("_", " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) } }));
            }
          }
        }
      };
      ws.onerror = () => set({ error: "WebSocket connection error" });
      ws.onclose = () => set({ isRecording: false });

      // Calculate elapsed duration
      const startedAt = new Date(meeting.started_at).getTime();
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);

      const interval = setInterval(() => {
        if (!get().isPaused) set((s) => ({ duration: s.duration + 1 }));
      }, 1000);

      set({
        activeMeeting: meeting,
        isRecording: true,
        isPaused: false,
        utterances: existingUtterances,
        speakerMap: meeting.speaker_map || {},
        duration: elapsed,
        error: null,
        _ws: ws, _audioContext: audioCtx, _mediaStream: stream, _workletNode: null, _durationInterval: interval,
      });
    } catch (e: any) {
      set({ error: e.message || "Failed to resume meeting" });
      throw e;
    }
  },

  pauseMeeting: () => {
    const { _ws } = get();
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: "pause" }));
    }
    set({ isPaused: true });
  },

  resumeMeeting: () => {
    const { _ws } = get();
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: "resume" }));
    }
    set({ isPaused: false });
  },

  pauseOnLeave: () => {
    const { isRecording, isPaused, _ws, _autoEndTimeout, _pingInterval } = get();
    if (!isRecording || isPaused) return;

    // Pause the recording
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: "pause" }));
    }
    set({ isPaused: true, _pausedAt: Date.now() });

    // Start ping keepalive to prevent Nginx proxy_read_timeout during pause
    if (_pingInterval) clearInterval(_pingInterval);
    const ping = setInterval(() => {
      const ws = get()._ws;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000); // every 30s

    // Auto-end after 5 minutes if user doesn't return
    if (_autoEndTimeout) clearTimeout(_autoEndTimeout);
    const timeout = setTimeout(() => {
      const state = get();
      if (state.isRecording && state.isPaused && state._pausedAt) {
        state.endMeeting();
        state.reset();
      }
    }, 5 * 60 * 1000);
    set({ _autoEndTimeout: timeout, _pingInterval: ping });
  },

  resumeOnReturn: () => {
    const { isRecording, isPaused, _pausedAt, _ws, _autoEndTimeout, _pingInterval } = get();
    if (!isRecording || !isPaused || !_pausedAt) return false;

    // Cancel auto-end timer and ping keepalive
    if (_autoEndTimeout) clearTimeout(_autoEndTimeout);
    if (_pingInterval) clearInterval(_pingInterval);
    set({ _autoEndTimeout: null, _pingInterval: null });

    // Check if paused for more than 5 minutes
    const elapsed = Date.now() - _pausedAt;
    if (elapsed > 5 * 60 * 1000) {
      // Too long — auto-end
      get().endMeeting();
      get().reset();
      return false;
    }

    // Resume
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: "resume" }));
    }
    set({ isPaused: false, _pausedAt: null });
    return true;
  },

  endMeeting: async () => {
    const { activeMeeting, _ws, _audioContext, _mediaStream, _workletNode, _durationInterval } = get();
    if (!activeMeeting) return null;

    // Stop timer
    if (_durationInterval) clearInterval(_durationInterval);

    // Stop audio
    if (_workletNode) {
      _workletNode.disconnect();
    }
    if (_mediaStream) {
      _mediaStream.getTracks().forEach((t) => t.stop());
    }
    if (_audioContext) {
      await _audioContext.close();
    }

    // Signal end on WebSocket
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: "end" }));
      _ws.close();
    }

    // Call REST endpoint to finalize
    try {
      const res = await fetch(
        `${BASE_URL}/api/notebooks/${activeMeeting.notebook_id}/meetings/${activeMeeting.id}/end`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        set({
          activeMeeting: { ...activeMeeting, status: "ended" },
          isRecording: false,
          _ws: null,
          _audioContext: null,
          _mediaStream: null,
          _workletNode: null,
          _durationInterval: null,
        });
        return data;
      }
    } catch (e) {
      console.error("Failed to end meeting:", e);
    }

    set({ isRecording: false });
    return null;
  },

  renameSpeaker: (speakerId: string, name: string) => {
    const { activeMeeting } = get();
    set((s) => ({
      speakerMap: { ...s.speakerMap, [speakerId]: name },
    }));

    // Persist to backend
    if (activeMeeting) {
      fetch(
        `${BASE_URL}/api/notebooks/${activeMeeting.notebook_id}/meetings/${activeMeeting.id}/speakers`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAccessToken()}`,
          },
          body: JSON.stringify({ speaker_map: { [speakerId]: name } }),
        }
      ).catch(console.error);
    }
  },

  reset: () => {
    const { _durationInterval, _ws, _mediaStream, _audioContext, _autoEndTimeout } = get();
    if (_durationInterval) clearInterval(_durationInterval);
    if (_autoEndTimeout) clearTimeout(_autoEndTimeout);
    if (_ws) _ws.close();
    if (_mediaStream) _mediaStream.getTracks().forEach((t) => t.stop());
    if (_audioContext) _audioContext.close();
    set({
      activeMeeting: null,
      utterances: [],
      isRecording: false,
      isPaused: false,
      speakerMap: {},
      duration: 0,
      error: null,
      _ws: null,
      _audioContext: null,
      _mediaStream: null,
      _workletNode: null,
      _durationInterval: null,
      _autoEndTimeout: null,
      _pingInterval: null,
      _pausedAt: null,
    });
  },
}));

// Pause recording when browser tab/window is closed
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    const state = useMeetingStore.getState();
    if (state.isRecording && !state.isPaused) {
      state.pauseOnLeave();
    }
  });
}
