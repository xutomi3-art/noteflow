import { create } from "zustand";
import { api } from "../../services/api";

export interface Utterance {
  speaker_id: string;
  text: string;
  start_time_ms: number;
  end_time_ms: number;
  is_final: boolean;
  sequence: number;
}

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

  startMeeting: (notebookId: string) => Promise<void>;
  pauseMeeting: () => void;
  resumeMeeting: () => void;
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

  startMeeting: async (notebookId: string) => {
    try {
      // 1. Create meeting via REST
      const res = await fetch(`${BASE_URL}/api/notebooks/${notebookId}/meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {}),
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create meeting");
      }
      const meeting: Meeting = await res.json();

      // 2. Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 3. Set up AudioWorklet
      const audioCtx = new AudioContext({ sampleRate: 48000 });
      await audioCtx.audioWorklet.addModule("/pcm-capture-processor.js");
      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "pcm-capture-processor");
      source.connect(worklet);
      worklet.connect(audioCtx.destination); // needed to keep processing

      // 4. Open WebSocket
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = api.getToken();
      const wsUrl = `${wsProtocol}//${window.location.host}/api/notebooks/${notebookId}/meetings/${meeting.id}/audio?token=${token}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // 5. Start sending PCM chunks from worklet
        worklet.port.onmessage = (e: MessageEvent) => {
          if (ws.readyState === WebSocket.OPEN && !get().isPaused) {
            ws.send(e.data);
          }
        };
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
            };
            set((s) => {
              // Replace interim utterances from same speaker, append final
              if (utt.is_final) {
                return { utterances: [...s.utterances, utt] };
              }
              // Update last non-final from same speaker
              const updated = [...s.utterances];
              const lastIdx = updated.findLastIndex(
                (u) => u.speaker_id === utt.speaker_id && !u.is_final
              );
              if (lastIdx >= 0) {
                updated[lastIdx] = utt;
              } else {
                updated.push(utt);
              }
              return { utterances: updated };
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
          headers: api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {},
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
            ...(api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {}),
          },
          body: JSON.stringify({ speaker_map: { [speakerId]: name } }),
        }
      ).catch(console.error);
    }
  },

  reset: () => {
    const { _durationInterval, _ws, _mediaStream, _audioContext } = get();
    if (_durationInterval) clearInterval(_durationInterval);
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
    });
  },
}));
