# Meeting Transcription API

Real-time meeting transcription with speaker diarization, powered by Volcengine Seed-ASR 2.0.

## Authentication

All endpoints require JWT token via `Authorization: Bearer <token>` header.
WebSocket endpoint accepts `?token=<jwt>` query parameter.

## Endpoints

### POST /api/notebooks/{notebook_id}/meetings

Create a new meeting. Only one active meeting per notebook.

**Response** `200`:
```json
{
  "id": "uuid",
  "notebook_id": "uuid",
  "status": "recording",
  "speaker_map": {},
  "title": null,
  "source_id": null,
  "started_at": "2026-03-25T10:00:00Z",
  "ended_at": null,
  "duration_seconds": null
}
```

**Error** `400`: `{"detail": "A meeting is already active in this notebook"}`

---

### GET /api/notebooks/{notebook_id}/meetings/{meeting_id}

Get meeting details.

---

### WS /api/notebooks/{notebook_id}/meetings/{meeting_id}/audio

**WebSocket endpoint for real-time audio streaming.**

#### Client → Server

**Binary frames**: Raw PCM audio (16-bit, 16kHz, mono). Send 200ms chunks (6400 bytes each).

**Text frames** (JSON control messages):
```json
{"type": "pause"}    // Pause recording (keeps ASR session alive)
{"type": "resume"}   // Resume recording
{"type": "end"}      // End meeting
```

#### Server → Client

**Text frames** (JSON transcript updates):
```json
{
  "type": "utterance",
  "speaker_id": "speaker_1",
  "text": "Hello everyone, welcome to the meeting.",
  "start_time_ms": 12000,
  "end_time_ms": 14500,
  "is_final": true,
  "sequence": 5
}
```

Error:
```json
{"type": "error", "message": "ASR connection failed"}
```

#### Connection Flow
1. Client connects with `?token=<jwt>`
2. Server starts Volcengine ASR session
3. Client sends binary PCM audio chunks
4. Server streams back transcript utterances
5. Client sends `{"type": "end"}` to finish
6. Server closes ASR session

---

### PATCH /api/notebooks/{notebook_id}/meetings/{meeting_id}/speakers

Update speaker name mapping.

**Request**:
```json
{
  "speaker_map": {
    "speaker_1": "Tommy",
    "speaker_2": "Alice"
  }
}
```

**Response**: Updated meeting object.

---

### POST /api/notebooks/{notebook_id}/meetings/{meeting_id}/pause

Pause recording. Audio stops being sent to ASR but WebSocket stays open.

**Response**: `{"status": "paused"}`

---

### POST /api/notebooks/{notebook_id}/meetings/{meeting_id}/resume

Resume recording after pause.

**Response**: `{"status": "recording"}`

---

### POST /api/notebooks/{notebook_id}/meetings/{meeting_id}/end

End meeting. Triggers:
1. Close ASR session, collect final results
2. Format transcript as markdown with speaker names and timestamps
3. Generate meeting title via LLM
4. Create a new Source (file_type="meeting")
5. Trigger RAG pipeline (chunking + embedding)

**Response**:
```json
{
  "source_id": "uuid",
  "filename": "Meeting Title.md",
  "status": "uploading"
}
```

---

### GET /api/notebooks/{notebook_id}/meetings/{meeting_id}/utterances

List all persisted utterances for a meeting.

**Response**:
```json
[
  {
    "id": "uuid",
    "speaker_id": "speaker_1",
    "text": "Hello everyone",
    "start_time_ms": 12000,
    "end_time_ms": 14500,
    "is_final": true,
    "sequence": 1
  }
]
```

## Status Flow

```
recording → paused → recording → ... → ended
                                          ↓
                                   Source created
                                          ↓
                                   uploading → parsing → vectorizing → ready
```

## SSE Events (via /api/notebooks/{id}/sources/status)

During meeting:
```json
{"type": "meeting_utterance", "meeting_id": "uuid", "speaker_id": "speaker_1", "text": "...", "is_final": true, "sequence": 5}
```

After meeting ends:
```json
{"type": "meeting_ended", "meeting_id": "uuid", "source_id": "uuid", "title": "Q1 Budget Review"}
```

## Data Model

### meetings
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| notebook_id | UUID | FK → notebooks |
| created_by | UUID | FK → users |
| source_id | UUID | FK → sources (set after meeting ends) |
| title | String(500) | LLM-generated title |
| status | String(20) | recording/paused/ended/failed |
| speaker_map | JSON | {"speaker_1": "Tommy"} |
| started_at | DateTime | Meeting start time |
| ended_at | DateTime | Meeting end time |
| duration_seconds | Integer | Total recording duration |

### meeting_utterances
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| meeting_id | UUID | FK → meetings (CASCADE) |
| speaker_id | String(50) | Speaker identifier from ASR |
| text | Text | Transcribed text |
| start_time_ms | BigInteger | Offset from meeting start |
| end_time_ms | BigInteger | End offset |
| is_final | Boolean | True = second-pass confirmed result |
| sequence | Integer | Ordering within meeting |

## Volcengine ASR Configuration

- Endpoint: `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
- Model: Seed-ASR 2.0 (bigmodel)
- Speaker diarization: enabled (ssd_version="200")
- 二遍识别: enabled (enable_nonstream=true)
- Audio format: PCM 16-bit 16kHz mono
- Chunk size: 200ms (6400 bytes)
