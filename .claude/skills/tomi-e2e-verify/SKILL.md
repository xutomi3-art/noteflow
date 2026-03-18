---
name: tomi-e2e-verify
description: Comprehensive E2E verification of Noteflow — 266 test cases covering all features, performance benchmarks, permission isolation, and email verification via Gmail MCP
version: 1.0.0
tags: [e2e, testing, verification, playwright, noteflow]
---

# Tomi E2E Verify — Noteflow Comprehensive Test Suite

## Overview

Full verification suite for Noteflow (https://noteflow.jotoai.com). Covers:
- Backend unit/integration tests (pytest)
- Frontend unit tests (vitest)
- E2E browser tests via Playwright MCP
- Performance benchmarks
- Permission isolation
- Email verification via Gmail MCP

## Prerequisites

- Access to https://noteflow.jotoai.com (production)
- Playwright MCP browser tools available
- Gmail MCP tools available (for email verification)
- Backend running with pytest dependencies
- Frontend running with vitest dependencies

## Test Accounts

| Role | Email | Notes |
|------|-------|-------|
| Admin | admin@jotoai.com | Full admin panel access |
| Test User A | testuser-a@test.com | For sharing/collaboration |
| Test User B | testuser-b@test.com | For sharing/collaboration |
| New User | (register fresh) | For onboarding tests |

## Execution Order

1. **Backend pytest** — `cd backend && python -m pytest --cov=. --cov-report=term-missing`
2. **Frontend vitest** — `cd frontend && npm run test:coverage`
3. **E2E Browser Tests** — Playwright MCP against production
4. **Gmail MCP** — Email verification
5. **Report** — Compile results

---

# Test Cases (266 total, organized by category)

## Category 1: Authentication (20 tests)

### AUTH-001: Email registration
- Navigate to /register
- Fill email, password (8+ chars, uppercase, number, special), display name
- Submit → redirected to /dashboard
- Verify 3 demo notebooks created

### AUTH-002: Email login
- Navigate to /login
- Enter valid credentials → redirected to /dashboard

### AUTH-003: Login with wrong password
- Enter valid email, wrong password
- Verify error: "Invalid email or password"

### AUTH-004: Login with nonexistent email
- Enter unknown email → error message shown

### AUTH-005: Registration with duplicate email
- Register with existing email → error: "Email already registered"

### AUTH-006: Registration with weak password
- Try password "123" → validation error (min 8 chars)

### AUTH-007: Registration with invalid email
- Try "notanemail" → validation error

### AUTH-008: Logout
- Click user avatar → Logout → redirected to /login

### AUTH-009: Auth guard — unauthenticated access
- Visit /dashboard without login → redirected to /login

### AUTH-010: Auth guard — notebook page
- Visit /notebook/:id without login → redirected to /login

### AUTH-011: Token refresh
- Login → wait for token near expiry → verify auto-refresh

### AUTH-012: Microsoft SSO login (TC-007)
- Click "Sign in with Microsoft" → complete OAuth flow → /dashboard

### AUTH-013: Microsoft SSO account linking (TC-008)
- Register local, then SSO with same email → accounts linked

### AUTH-014: Provider-aware error message (TC-009)
- SSO user tries password login → error mentions correct provider

### AUTH-015: Password strength indicator
- Type weak password → red indicator
- Type strong password → green indicator

### AUTH-016: Password reset request
- Click "Forgot password" → enter email → verify email sent

### AUTH-017: Password reset completion
- Use reset link from email → set new password → login works

### AUTH-018: Remember me functionality
- Login with remember me → close/reopen browser → still logged in

### AUTH-019: Session expiry
- After 24h without refresh → redirected to login

### AUTH-020: Concurrent sessions
- Login from two browsers → both work

## Category 2: Dashboard (20 tests)

### DASH-001: Dashboard loads with notebooks
- Login → /dashboard shows notebook cards

### DASH-002: Create new notebook
- Click "New Notebook" → enter name → card appears

### DASH-003: Notebook card shows metadata
- Card shows: name, source count, last updated, icon

### DASH-004: Open notebook
- Click card → navigated to /notebook/:id

### DASH-005: Delete notebook
- Click delete on card → confirm → notebook removed

### DASH-006: Delete notebook cancellation
- Click delete → cancel → notebook still exists

### DASH-007: Empty dashboard state
- New user with no notebooks → shows empty state message

### DASH-008: Dashboard search
- Type in search → notebooks filtered by name

### DASH-009: Dashboard sort
- Sort by name/date → order changes

### DASH-010: Notebook count display
- Header shows total notebook count

### DASH-011: Responsive layout — desktop
- Full width → 3-4 cards per row

### DASH-012: Responsive layout — tablet
- Medium width → 2 cards per row

### DASH-013: Responsive layout — mobile
- Small width → 1 card per row

### DASH-014: Demo notebooks for new user (TC-001)
- New user gets 3 demo notebooks with sources and notes

### DASH-015: Shared notebook indicator
- Shared notebooks show sharing badge/icon

### DASH-016: Quick actions on hover
- Hover card → shows delete/share actions

### DASH-017: Notebook rename
- Click name → edit inline → save

### DASH-018: Dashboard loading state
- Shows skeleton while loading

### DASH-019: Error state
- API failure → shows error message with retry

### DASH-020: Pagination / infinite scroll
- Many notebooks → loads more on scroll

## Category 3: Source Management (30 tests)

### SRC-001: Upload PDF
- Click upload → select PDF → processing → ready

### SRC-002: Upload DOCX
- Upload .docx → processing → ready

### SRC-003: Upload PPTX
- Upload .pptx → processing → ready

### SRC-004: Upload TXT
- Upload .txt → processing → ready

### SRC-005: Upload MD
- Upload .md → processing → ready

### SRC-006: Upload XLSX
- Upload .xlsx → processing → ready

### SRC-007: Upload CSV
- Upload .csv → processing → ready

### SRC-008: Upload image (PNG/JPG)
- Upload image → processing → ready

### SRC-009: Upload via URL
- Paste URL → processing → ready

### SRC-010: Upload multiple files
- Drag multiple files → all process in parallel

### SRC-011: Upload progress indicator
- During upload → shows progress bar

### SRC-012: Processing status SSE
- After upload → status updates via SSE (processing → ready)

### SRC-013: Source list display
- All sources shown with name, type icon, status

### SRC-014: Source selection toggle
- Click source → toggles selection (checkbox)

### SRC-015: Select all / deselect all
- Toggle header checkbox → all selected/deselected

### SRC-016: Source count in chat
- Selected source count shown near chat input

### SRC-017: Delete source
- Click delete on source → confirm → removed

### SRC-018: Source type icons
- PDF=red, DOCX=blue, XLSX=green, etc.

### SRC-019: Upload size limit
- File >50MB → error message

### SRC-020: Unsupported file type
- Upload .zip → error: unsupported format

### SRC-021: Drag and drop upload
- Drag file onto drop zone → upload starts

### SRC-022: Empty source state
- No sources → shows upload prompt

### SRC-023: Source processing error
- Corrupted file → shows error status

### SRC-024: Inline PDF viewer
- Click PDF source → inline viewer opens

### SRC-025: Source filename display
- Long filenames → truncated with tooltip

### SRC-026: Unicode filename support
- Chinese/special chars in filename → displays correctly

### SRC-027: Duplicate file upload
- Upload same file twice → both listed (appended suffix)

### SRC-028: File with spaces in name
- Upload "my document.pdf" → handles correctly

### SRC-029: Special chars in filename
- Upload "file(1)[copy].txt" → handles correctly

### SRC-030: Demo sources process successfully (TC-015)
- New user → all 7 demo sources reach "ready" status

## Category 4: Chat & AI (35 tests)

### CHAT-001: Send message
- Type message → send → AI responds

### CHAT-002: Streaming response
- AI response streams token by token via SSE

### CHAT-003: Citation markers
- Response contains [1][2] inline citations

### CHAT-004: Citation click → source highlight
- Click [1] → corresponding source highlighted

### CHAT-005: Citation metadata
- Citation shows: filename, page/slide, excerpt

### CHAT-006: Scoped query — single source
- Select 1 source → question answered from that source only

### CHAT-007: Scoped query — multiple sources
- Select 3 sources → answer cites from selected sources

### CHAT-008: Scoped query — all sources
- All selected → answer cites from any source

### CHAT-009: Chat history persistence
- Send messages → refresh page → history preserved

### CHAT-010: Clear chat
- Click clear → all messages removed

### CHAT-011: Stop streaming
- Click stop button during streaming → response truncated

### CHAT-012: Empty state
- No messages → shows overview + suggested questions

### CHAT-013: Suggested questions
- Click suggested question → sends as message

### CHAT-014: Overview language (TC-003)
- Overview matches document language

### CHAT-015: Overview caching (TC-004)
- Cached in DB, invalidates on source change

### CHAT-016: Long conversation (10+ rounds)
- Continue chatting → no errors, context managed

### CHAT-017: Conversation memory
- Reference earlier messages → AI remembers context

### CHAT-018: Excel-specific chat tip (TC-016)
- Excel selected → shows "Analyzing spreadsheet data..." during loading

### CHAT-019: Many sources tip (TC-017)
- >10 sources selected → shows count tip during loading

### CHAT-020: Bottom disclaimer (TC-018)
- Static text: "AI can be inaccurate; please double-check its responses."

### CHAT-021: Token overflow friendly error (TC-020)
- Too much data → friendly error, no raw API error

### CHAT-022: SSE error handling (TC-022)
- Backend error → error shown in chat, streaming stops

### CHAT-023: Dynamic Excel budget (TC-019)
- Budget scales with matched Excel count

### CHAT-024: Dynamic content cap with history (TC-021)
- Long history → content truncated to fit

### CHAT-025: RAG top-k 10 (TC-026)
- Multi-document question → diverse citations

### CHAT-026: Qwen3.5-Plus model (TC-023)
- Model generates answers correctly

### CHAT-027: No thinking mode UI (TC-024)
- No Think button, no reasoning display

### CHAT-028: Enlarged token budget (TC-025)
- 15+ rounds + Excel → no overflow

### CHAT-029: Markdown rendering in responses
- AI response with markdown → properly rendered

### CHAT-030: Code blocks in responses
- AI response with code → syntax highlighted

### CHAT-031: Chat input autofocus
- Page load → chat input focused

### CHAT-032: Send on Enter
- Press Enter → sends message

### CHAT-033: Shift+Enter for newline
- Shift+Enter → new line in input

### CHAT-034: Paste image in chat
- Paste image → attached to message

### CHAT-035: Chat loading state
- While waiting for first token → 3-dot animation

## Category 5: Studio (25 tests)

### STUDIO-001: Generate Summary
- Click Summary → generates summary of sources

### STUDIO-002: Generate FAQ
- Click FAQ → generates Q&A pairs

### STUDIO-003: Generate Action Items
- Click Action Items → generates actionable items

### STUDIO-004: Generate Mind Map
- Click Mind Map → generates interactive mind map

### STUDIO-005: Studio language matches sources (TC-002)
- Output language matches document language

### STUDIO-006: Studio auto-expand (TC-006)
- Panel widens when content generated

### STUDIO-007: Save to notes — Summary
- Click save → summary saved as note

### STUDIO-008: Save to notes — FAQ
- Click save → FAQ saved as note

### STUDIO-009: Save to notes — Mind Map (TC-005)
- Click save → renders as tree view, not plain text

### STUDIO-010: Save to notes — Action Items
- Click save → action items saved as note

### STUDIO-011: Regenerate content
- Click regenerate → new content generated

### STUDIO-012: Studio loading state
- During generation → shows loading spinner

### STUDIO-013: Studio error state
- Generation fails → shows error with retry

### STUDIO-014: No Slide Deck button (TC-010)
- Only 4 buttons: Summary, FAQ, Mind Map, Action Items

### STUDIO-015: Studio with no sources
- No sources → shows "Add sources first" message

### STUDIO-016: Mind Map zoom/pan
- Can zoom and pan the mind map

### STUDIO-017: Mind Map node expansion
- Click node → expand/collapse children

### STUDIO-018: Studio content copy
- Click copy → content copied to clipboard

### STUDIO-019: Studio panel resize
- Drag edge → panel resizes

### STUDIO-020: Studio Chinese content
- Chinese documents → Chinese studio output

### STUDIO-021: Studio English content
- English documents → English studio output

### STUDIO-022: FAQ quality check
- Questions are relevant and practical

### STUDIO-023: Summary completeness
- Summary covers key topics from sources

### STUDIO-024: Action Items specificity
- Items are specific and actionable

### STUDIO-025: Mind Map structure
- Root node + organized child nodes

## Category 6: Saved Notes (15 tests)

### NOTE-001: Create note
- Click "Add Note" → enter text → saved

### NOTE-002: View note
- Click note → content displayed

### NOTE-003: Edit note
- Click edit → modify → save

### NOTE-004: Delete note
- Click delete → confirm → removed

### NOTE-005: Note list display
- All notes shown in sidebar

### NOTE-006: Note from Studio content
- Save studio output → appears as note

### NOTE-007: Mind Map note rendering
- Mind Map note → renders as tree view

### NOTE-008: Note search
- Search notes → filtered results

### NOTE-009: Empty notes state
- No notes → shows "No notes yet"

### NOTE-010: Note timestamp
- Shows created/updated time

### NOTE-011: Long note content
- Large note → scrollable

### NOTE-012: Note markdown support
- Markdown in note → properly rendered

### NOTE-013: Note copy
- Click copy → note content copied

### NOTE-014: Note ordering
- Most recent first

### NOTE-015: Note count display
- Shows total note count

## Category 7: Sharing & Collaboration (30 tests)

### SHARE-001: Create share link
- Click Share → generate invite link

### SHARE-002: Share modal UI
- Modal shows: link, role selector, collaborator list

### SHARE-003: Role assignment — Editor
- Invite with Editor role → can edit

### SHARE-004: Role assignment — Viewer
- Invite with Viewer role → read only

### SHARE-005: Accept invite link
- Open invite link → join notebook

### SHARE-006: Viewer restrictions
- Viewer: no upload, no delete, no edit notes

### SHARE-007: Editor capabilities
- Editor: can upload, chat, create notes

### SHARE-008: Owner capabilities
- Owner: full control including sharing

### SHARE-009: Revoke access
- Remove collaborator → they lose access

### SHARE-010: Update role
- Change Editor→Viewer → permissions update

### SHARE-011: Share link expiry
- Link disabled → no longer works

### SHARE-012: Collaborator list display
- Shows all collaborators with roles

### SHARE-013: Self-join prevention
- Owner opens own invite link → error/redirect

### SHARE-014: Multiple notebooks shared
- Share different notebooks with different users

### SHARE-015: Shared notebook on dashboard
- Shared notebook shows on collaborator's dashboard

### SHARE-016: Real-time collaboration
- Two users in same notebook → both see updates

### SHARE-017: Share notification
- User notified when added to notebook

### SHARE-018: Leave shared notebook
- Collaborator leaves → removed from list

### SHARE-019: Transfer ownership
- Owner transfers to editor → roles swap

### SHARE-020: Copy share link
- Click copy → link copied to clipboard

### SHARE-021: Share with role → email invitation
- Share → email sent to recipient

### SHARE-022: Delete shared notebook (owner)
- Owner deletes → all collaborators lose access

### SHARE-023: Admin delete preserves shared (TC-013)
- Admin deletes user → shared notebooks transferred

### SHARE-024: Concurrent editing
- Two editors → changes merge

### SHARE-025: Permission check — upload
- Viewer tries upload → blocked

### SHARE-026: Permission check — delete source
- Viewer tries delete → blocked

### SHARE-027: Permission check — share modal
- Viewer can't access share settings

### SHARE-028: Permission check — delete notebook
- Only owner can delete

### SHARE-029: Share link copy notification
- Copy shows toast "Link copied!"

### SHARE-030: Invite link format
- Link format: /invite/:token

## Category 8: Admin Panel (30 tests)

### ADMIN-001: Admin login → /admin
- Admin user → can access /admin

### ADMIN-002: Non-admin blocked
- Regular user → /admin redirects to /dashboard

### ADMIN-003: Dashboard overview
- Shows: total users, notebooks, sources, messages

### ADMIN-004: User management list
- /admin/users → shows all users

### ADMIN-005: User search
- Search by name/email

### ADMIN-006: Batch delete users (TC-012)
- Select multiple → delete → confirm → removed

### ADMIN-007: Admin self-protection
- Admin cannot delete self

### ADMIN-008: User detail view
- Click user → shows details, notebooks, activity

### ADMIN-009: LLM config page (TC-027)
- /admin/llm → Qwen3.5-Plus config fields

### ADMIN-010: LLM config update
- Change API key → save → verify

### ADMIN-011: System health (TC-029)
- /admin/system → shows service health

### ADMIN-012: No DeepSeek in health
- Only Qwen service listed

### ADMIN-013: Usage analytics
- /admin/usage → charts and metrics

### ADMIN-014: Token usage per user (TC-028)
- Table: User, Requests, Tokens, Avg/Req, Est. Cost

### ADMIN-015: Usage time range
- Switch 7d/30d → data updates

### ADMIN-016: Log viewer
- /admin/logs → recent logs

### ADMIN-017: Log filtering
- Filter by level (info/warn/error)

### ADMIN-018: Admin navigation
- Sidebar with all admin pages

### ADMIN-019: Admin responsive
- Mobile → hamburger menu

### ADMIN-020: Admin breadcrumbs
- Shows current page path

### ADMIN-021: Admin user count accuracy
- Count matches actual user list

### ADMIN-022: Admin notebook count accuracy
- Count matches total notebooks

### ADMIN-023: Admin source count accuracy
- Count matches total sources

### ADMIN-024: Admin message count accuracy
- Count matches total messages

### ADMIN-025: Admin export data
- Export user/usage data

### ADMIN-026: Admin pagination
- Large user list → paginated

### ADMIN-027: Admin sort columns
- Click column header → sort

### ADMIN-028: Admin delete confirmation
- Delete requires explicit confirmation

### ADMIN-029: Admin session management
- Admin sessions respect same token rules

### ADMIN-030: Admin audit log
- Admin actions logged

## Category 9: Navigation & UI (20 tests)

### NAV-001: Header — logo navigation
- Click logo → /dashboard

### NAV-002: Header — Beta badge (TC-011)
- Beta badge visible on all pages

### NAV-003: Back button in notebook
- Click back → /dashboard

### NAV-004: URL routing — /login
- Direct URL → login page

### NAV-005: URL routing — /register
- Direct URL → register page

### NAV-006: URL routing — /dashboard
- Direct URL → dashboard (if logged in)

### NAV-007: URL routing — /notebook/:id
- Direct URL → notebook page (if authorized)

### NAV-008: 404 page
- Invalid URL → 404 page

### NAV-009: Mobile responsive — login
- Small screen → responsive layout

### NAV-010: Mobile responsive — dashboard
- Small screen → stacked cards

### NAV-011: Mobile responsive — notebook
- Small screen → panels stack

### NAV-012: Panel resizing
- Drag panel edges → resize

### NAV-013: Panel collapse/expand
- Collapse sources panel → more space for chat

### NAV-014: Keyboard shortcuts
- Esc → close modals

### NAV-015: Loading states
- All pages show loading indicators

### NAV-016: Error boundaries
- Component error → shows fallback UI

### NAV-017: Page title
- Each page sets correct document title

### NAV-018: Favicon
- Noteflow favicon displays

### NAV-019: Scroll behavior
- Long content → smooth scrolling

### NAV-020: Theme consistency
- Apple-inspired design throughout

## Category 10: Performance Benchmarks (15 tests)

### PERF-001: Login response time
- Login API < 500ms

### PERF-002: Dashboard load time
- Dashboard renders < 2s

### PERF-003: Notebook load time
- Notebook page < 2s

### PERF-004: Chat first token time
- First AI token < 3s

### PERF-005: Overview generation time
- First overview < 10s

### PERF-006: Studio generation time
- Summary/FAQ < 15s

### PERF-007: Source upload time
- Small file upload < 2s

### PERF-008: PDF processing time
- 10-page PDF < 60s

### PERF-009: Page size check
- JS bundle < 500KB gzipped

### PERF-010: API response times
- All API endpoints < 1s (non-AI)

### PERF-011: SSE connection stability
- SSE stream maintains connection

### PERF-012: Concurrent user handling
- 5 concurrent users → no degradation

### PERF-013: Memory usage
- No memory leaks on repeated navigation

### PERF-014: Image optimization
- Images served in WebP/optimized

### PERF-015: Caching headers
- Static assets cached properly

## Category 11: Security & Permission Isolation (20 tests)

### SEC-001: XSS prevention
- Inject `<script>` in chat → escaped

### SEC-002: SQL injection prevention
- SQL in search → no effect

### SEC-003: CSRF protection
- Requests require valid token

### SEC-004: Auth token security
- Token in httpOnly cookie

### SEC-005: Password hashing
- Passwords stored hashed (bcrypt)

### SEC-006: Rate limiting
- >100 requests/min → 429

### SEC-007: Notebook isolation
- User A cannot access User B's notebook

### SEC-008: Source isolation
- User A cannot see User B's sources

### SEC-009: Chat isolation
- User A cannot read User B's chat

### SEC-010: Admin isolation
- Admin actions don't expose user passwords

### SEC-011: API authorization
- All endpoints require valid token

### SEC-012: Share token validation
- Invalid share token → 404

### SEC-013: File upload validation
- Malicious file extension → rejected

### SEC-014: Path traversal prevention
- ../../../etc/passwd → blocked

### SEC-015: Error message sanitization
- Server errors don't leak stack traces

### SEC-016: HTTPS enforcement
- HTTP → redirected to HTTPS

### SEC-017: Content Security Policy
- CSP headers present

### SEC-018: CORS configuration
- Only allowed origins

### SEC-019: Session fixation prevention
- New session on login

### SEC-020: Sensitive data in URL
- No tokens/passwords in URL params

## Category 12: Email Verification (6 tests)

### EMAIL-001: Invitation email sent
- Share notebook → email delivered to recipient

### EMAIL-002: Invitation email content
- Email contains: notebook name, inviter, accept link

### EMAIL-003: Invitation accept link works
- Click link in email → joins notebook

### EMAIL-004: Password reset email
- Request reset → email delivered

### EMAIL-005: Password reset email content
- Email contains reset link with token

### EMAIL-006: Email delivery timing
- Email arrives within 60 seconds

---

## Execution Instructions

### Phase 1: Backend Tests
```bash
cd backend && python -m pytest --cov=. --cov-report=term-missing -v
```

### Phase 2: Frontend Tests
```bash
cd frontend && npm run test:coverage
```

### Phase 3: E2E Browser Tests (Playwright MCP)

Use `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_snapshot` etc.

**Base URL:** https://noteflow.jotoai.com

**Login helper:**
1. `browser_navigate` → /login
2. `browser_fill_form` email + password
3. `browser_click` login button
4. `browser_snapshot` → verify /dashboard

### Phase 4: Gmail MCP Verification

Use `gmail_search_messages` and `gmail_read_message` to verify:
- Invitation emails
- Password reset emails

### Phase 5: Report

Compile all results into a summary table:
| Category | Total | Pass | Fail | Skip | Notes |
|----------|-------|------|------|------|-------|
