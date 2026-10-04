# JWT Authentication & Token Management Architecture

This document describes how JSON Web Tokens (JWT) and secrets are managed in the World Radio application, covering both the server-side signing secret (`JWT_SECRET` in `.env`) and the client-side session tokens generated upon passcode verification.

---

## 1. High-Level Architecture

The authentication system employs a stateless, symmetric HMAC-SHA256 model:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Passcode Input                                           │
│    User enters passcode (default: 'radio-2026') in the UI   │
└──────────────────────────────┬──────────────────────────────┘
                               │ POST /api/auth/verify { passcode }
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Backend Server                                           │
│    - Verifies passcode against process.env.APP_PASSCODE      │
│    - Reads process.env.JWT_SECRET (from .env or fallback)   │
│    - Signs JWT payload using HMAC-SHA256 (30-day expiry)    │
│    - Sets 'world_radio_jwt' cookie in Set-Cookie header     │
│    - Returns { ok: true, authenticated: true, token: "..." }│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Client Browser                                           │
│    - Stores token in cookie and sessionStorage              │
│    - Displays "Connected & Authorized" status in modal      │
│    - Provides "Copy JWT" button for developer / CLI testing │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Protected Route Access (/api/tiles/*)                    │
│    Tile requests authenticate via:                          │
│      a) Cookie: 'world_radio_jwt' (automatic for Leaflet)   │
│      b) Header: 'Authorization: Bearer <token>'             │
│      c) Query:  '?token=<token>' (fallback for <img> tags)  │
│    Backend validates signature using JWT_SECRET             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Server-Side Secret (`JWT_SECRET` in `.env`)

### What It Is
`JWT_SECRET` is the private symmetric key used exclusively by the backend server to cryptographically sign and verify tokens. It functions as the server's private seal or rubber stamp.

### Storage & Configuration
- **File location:** `.env` in the application root directory.
- **Example config:**
  ```env
  # Server-Side Only - Never prefix with VITE_
  APP_PASSCODE=radio-2026
  JWT_SECRET=world-radio-jwt-secret-key-32chars!!
  ```
- **Fallback behavior:** If `JWT_SECRET` is not set in the environment, the server cleanly falls back to `'world-radio-jwt-secret-key-32chars!!'` in development mode to ensure zero downtime.
- **Production recommendation:** Generate a high-entropy 256-bit random key:
  ```bash
  openssl rand -hex 32
  ```

### Security Boundary
`JWT_SECRET` is **never exposed to the client or bundled into frontend JavaScript**. The client browser never sees or handles `JWT_SECRET`.

---

## 3. Passcode Verification & Token Issuance

When a user submits a passcode in the UI:

1. **Endpoint:** `POST /api/auth/verify`
2. **Payload:** `{"passcode": "radio-2026"}`
3. **Verification:** The backend verifies that the submitted passcode matches `APP_PASSCODE` (or default `'radio-2026'`).
4. **Token Generation (`signJwt` in `src/server/auth.ts`):**
   - **Header:** `{"alg": "HS256", "typ": "JWT"}`
   - **Payload:**
     ```json
     {
       "sub": "authorized_user",
       "role": "listener",
       "iat": 1791132966,
       "exp": 1793724966
     }
     ```
   - **Signature:**
     $$\text{Signature} = \text{HMAC-SHA256}(\text{base64url}(\text{Header}) + "." + \text{base64url}(\text{Payload}), \text{JWT\_SECRET})$$
   - **Complete Token:** `header.payload.signature`
5. **Response:**
   - HTTP response body:
     ```json
     {
       "ok": true,
       "authenticated": true,
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI...",
       "expiresAt": 1793724966
     }
     ```
   - HTTP response header:
     ```http
     Set-Cookie: world_radio_jwt=eyJhbGci...; Path=/; Max-Age=2592000; SameSite=Lax
     ```

---

## 4. Client-Side Token Management

The frontend client manages the token through `src/auth.ts` and `src/passcodeModal.ts`:

### Storage Strategy (Dual Layer)
1. **Cookie (`world_radio_jwt`):**
   Allows Leaflet map tile requests (`<img>` tags) to carry authentication automatically on same-origin requests without requiring custom JavaScript fetch headers.
2. **Session Storage (`sessionStorage.getItem('world_radio_jwt')`):**
   Allows client-side scripts to immediately detect authenticated state on reload, construct query parameters, and display the active token in the modal.

### Reactive State
- `subscribeAuth(listener)` allows all components (Top Bar badge, Discover hero chip, Sidebar navigation, Map toolbar) to immediately re-render when authentication state changes (login, logout, or token renewal).

### In-App Modal Features
- **Status Indicator:** Shows real-time connection status (`● Connected & Authorized` or `🔒 Passcode Required`).
- **Active JWT String:** Displays the current session token in a monospace field for inspection.
- **Copy JWT Button:** Copies the active token to clipboard for external API/CLI testing.
- **Log Out:** Clears the cookie (`Max-Age=0`) and removes `sessionStorage`, instantly locking backend proxies.

---

## 5. Protected Endpoint Verification

Backend proxy routes (such as `/api/tiles/*`) enforce token validation via `verifyJwt()` in `src/server/auth.ts`:

### Token Extraction Order
When a request arrives at `/api/tiles/*`, the server checks for the token in the following priority:
1. **HTTP Authorization Header:** `Authorization: Bearer <token>`
2. **Cookie Header:** `world_radio_jwt=<token>`
3. **URL Query Parameter:** `?token=<token>`

### Cryptographic Validation Process
1. Split token by `.` into 3 components: `[header, payload, signature]`.
2. Recompute expected signature:
   `crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')`
3. Compare using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
4. Decode payload and check expiration: `payload.exp > Math.floor(Date.now() / 1000)`.
5. If valid, the request proceeds to fetch upstream tiles. If invalid or missing, returns `HTTP 401 Unauthorized`.

---

## 6. CLI & Offline Token Generation

For automation, CI/CD, or terminal development, tokens can be generated directly without opening the browser:

### Built-In Script
```bash
npm run auth:token
```

### Direct Node.js Command
```bash
node scripts/generate-jwt.js
```

### Curl Testing Example
```bash
# Using Authorization Header
curl -I "http://localhost:3000/api/tiles/streets/1/0/0.png" \
  -H "Authorization: Bearer <COPIED_JWT_STRING>"

# Using Query Parameter
curl -I "http://localhost:3000/api/tiles/streets/1/0/0.png?token=<COPIED_JWT_STRING>"
```

---

## 7. File Map & Code References

| Purpose | File Path |
| :--- | :--- |
| **Server Auth Logic & Cryptography** | [`src/server/auth.ts`](/src/server/auth.ts) |
| **Protected Tile Proxy** | [`src/server/tileProxy.ts`](/src/server/tileProxy.ts) |
| **Client Auth Manager & Storage** | [`src/auth.ts`](/src/auth.ts) |
| **Passcode & Token Modal UI** | [`src/passcodeModal.ts`](/src/passcodeModal.ts) |
| **CLI Generator Utility** | [`scripts/generate-jwt.js`](/scripts/generate-jwt.js) |
| **Environment Configuration** | [`.env.example`](/.env.example), `.env` |
