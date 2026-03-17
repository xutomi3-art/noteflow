# Noteflow E2E Test Cases

## Bug Regression Tests

Each test case corresponds to a bug that was found and fixed. These must pass on every release.

### TC-001: OAuth new user gets default notebooks with demo sources and notes
- **Bug:** OAuth new users got empty notebooks — no saved notes, no sources
- **Root cause:** `create_note()` called without `user_id`; no source upload logic
- **Steps:**
  1. Register a new user via Microsoft SSO (or Google SSO, or email)
  2. Open Dashboard
  3. Verify 3 notebooks in order: Getting Started (1st), Meeting Notes (2nd), My Research (3rd)
  4. Open Getting Started → verify 1 source (noteflow-user-manual.md) + 2 saved notes
  5. Open Meeting Notes → verify 3 sources (meeting md files) + 2 saved notes
  6. Open My Research → verify 3 sources (report + xlsx + overview) + 2 saved notes
- **Expected:** All notebooks have sources processing/ready and visible saved notes

### TC-002: Studio content language matches document language
- **Bug:** LLM output FAQ/Summary/Action Items in French/Spanish despite English documents
- **Root cause:** Prompt said "detect language" but LLM ignored; fixed with `_detect_language()` CJK check + explicit "You MUST write in {lang}"
- **Steps:**
  1. Upload an English document
  2. Click Summary → verify English output
  3. Click FAQ → verify English output
  4. Click Action Items → verify English output
  5. Click Mind Map → verify node labels in English
  6. Upload a Chinese document to a different notebook
  7. Repeat → verify all outputs in Chinese
- **Expected:** Output language always matches document language

### TC-003: Overview and suggested questions language
- **Bug:** Overview text appeared in Spanish/French
- **Root cause:** Same as TC-002
- **Steps:**
  1. Upload an English document
  2. Open notebook → wait for overview in Chat panel
  3. Verify overview text is in English
  4. Verify 3 suggested questions are in English and practical
- **Expected:** Overview and questions match document language

### TC-004: Overview caching — DB-persisted, invalidate on source change
- **Bug:** Overview called LLM on every page load (slow); in-memory cache lost on restart
- **Fix:** Cache in `notebooks.overview_cache` column, keyed by `overview_source_hash`
- **Steps:**
  1. Open notebook with sources → note overview load time (first: slow)
  2. Refresh page → overview appears instantly (DB cached)
  3. Restart backend container → refresh → still instant (DB not memory)
  4. Upload a new document → wait for processing
  5. Refresh → overview regenerates (hash changed)
- **Expected:** Cached overview persists across restarts; new sources trigger regeneration

### TC-005: Mind Map saved as note renders as tree view
- **Bug:** Mind Map saved to notes showed plain text instead of tree
- **Root cause:** `handleMinimizeStudioContent` converted JSON to markdown text
- **Fix:** Save raw JSON; `NoteContent` detects JSON and uses `MindMapTreeView`
- **Steps:**
  1. Generate Mind Map in Studio
  2. Click minimize (↗) to save as note
  3. Find note in SAVED NOTES
  4. Click to expand
  5. Verify colored tree structure, not plain text
- **Expected:** Mind Map notes render as interactive tree view

### TC-006: Studio panel auto-expands when content is generated
- **Bug:** Studio panel didn't widen for Action Items
- **Root cause:** Race condition in `useEffect` tracking `isGenerating` transitions
- **Fix:** Track `studioContent` count changes directly
- **Steps:**
  1. Open notebook with sources, note Studio panel width
  2. Click Summary → verify panel widens
  3. Click FAQ → panel stays wide
  4. Click Action Items → panel stays wide
  5. Click Mind Map → panel stays wide
- **Expected:** Studio panel auto-expands to ~520px when any content appears

### TC-007: Microsoft SSO login flow
- **Steps:**
  1. Go to /login → verify "Sign in with Microsoft" button visible
  2. Click → redirected to Microsoft login
  3. Sign in → authorize → redirected back to Noteflow /dashboard
  4. Verify user profile shows correct name and email
  5. Go to /register → verify "Sign up with Microsoft" button visible
- **Expected:** Complete Microsoft SSO flow works end-to-end

### TC-008: Microsoft SSO account linking
- **Steps:**
  1. Register local account with email X
  2. Log out → sign in with Microsoft using same email X
  3. Verify accounts linked (same user, `microsoft_id` populated)
  4. Verify existing notebooks preserved
  5. `auth_provider` stays "local" (only changes if was "local" before)
- **Expected:** Microsoft identity linked, no duplicate user

### TC-009: Login error message is provider-aware
- **Bug:** Error always said "use the Google button" even for Microsoft users
- **Steps:**
  1. Create user via Microsoft SSO (no password)
  2. Try login with email + password
  3. Verify error: "This account uses Microsoft sign-in. Please use the Microsoft button."
  4. Create user via Google SSO
  5. Try login with email + password
  6. Verify error mentions "Google"
- **Expected:** Error message shows correct SSO provider name

### TC-010: Slide Deck button hidden
- **Steps:**
  1. Open any notebook
  2. Check Studio panel buttons
  3. Verify: Summary, FAQ, Mind Map, Action Items visible
  4. Verify: Slide Deck button NOT visible
- **Expected:** Only 4 Studio buttons (no Slide Deck)

### TC-011: Beta badge visible on all pages
- **Steps:**
  1. Go to /login → verify "Beta" badge next to "Noteflow"
  2. Go to /register → verify "Beta" badge
  3. Log in → Dashboard → verify "Beta" badge
  4. Open any notebook → verify "Beta" badge in header
- **Expected:** Green "Beta" badge visible on all 4 page types

### TC-012: Admin batch delete users
- **Steps:**
  1. Log in as admin → /admin/users
  2. Verify checkboxes on each user row + select-all in header
  3. Select 2 users → verify "Delete 2 users" red button appears
  4. Click delete → confirm dialog → users removed from list
  5. Select all → click delete → confirm → verify admin NOT deleted (self-protection)
  6. Verify deleted users' data is gone (notebooks, sources, messages)
- **Expected:** Batch delete works with confirmation, admin protected

### TC-013: Admin delete preserves shared notebooks
- **Steps:**
  1. User A creates notebook and shares with User B (editor)
  2. Admin deletes User A
  3. Verify shared notebook still exists
  4. Verify User B is now owner of the notebook
  5. Verify sources uploaded by User A still exist (uploaded_by = User B)
  6. Verify User A's personal (non-shared) notebooks are fully deleted
- **Expected:** Shared notebooks transfer ownership; personal notebooks deleted

### TC-014: Google OAuth uses SOCKS5 proxy on China servers
- **Steps:**
  1. Verify `GOOGLE_PROXY` env var is passed to backend container
  2. Click "Sign in with Google" on China server
  3. Verify redirect to Google consent screen works (not blocked)
  4. Verify `MICROSOFT_PROXY` is NOT set (Microsoft doesn't need proxy)
- **Expected:** Google OAuth works via proxy; Microsoft direct

### TC-015: New user demo sources process successfully
- **Steps:**
  1. Register new user
  2. Wait 30 seconds for background processing
  3. Open Getting Started → verify source status = "ready"
  4. Open Meeting Notes → verify all 3 sources = "ready"
  5. Open My Research → verify all 3 sources = "ready" (including .xlsx)
  6. Select a source → ask a question → verify AI answers with citations
- **Expected:** All 7 demo sources process to "ready" and are queryable
