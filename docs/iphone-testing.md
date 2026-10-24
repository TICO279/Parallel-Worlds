# Test on an iPhone without an App Store build

Use the existing mobile interface in Safari, optionally with **Share → Add to
Home Screen**. This is a local test app, not an IPA or TestFlight distribution.
The PC continues to run the unchanged Phase 3 backend and own the SQLite history.
Audio still travels directly between Safari and Boson using the existing adapter.

## Start on the Windows PC

Keep the PC and iPhone on the same trusted Wi-Fi, with no client/AP isolation.
Use Node 24, pnpm and PowerShell 7 (already installed on the development PC).

```powershell
pnpm build
pnpm start
# Keep this running. In a second terminal, from the repository root:
pnpm phone
```

If the backend already runs on port 3000, reuse it; do not start a second one.
Vite is not needed for phone testing. `pnpm phone` serves the built frontend/API
through an optional gateway, binding only to the PC's selected private IPv4 address:

- HTTP port **3444**: public certificate profile and setup instructions only.
- HTTPS port **3443**: paired test app, requiring a random terminal code.
- Backend port **3000**: remains bound to `127.0.0.1` with its existing origin rules.

If several private addresses exist, select the Wi-Fi address explicitly:
`pnpm phone --host 192.168.1.10` (use your actual PC address). The command prints
the two URLs, a pairing code and the root certificate SHA-256 fingerprint. It
does not open a public tunnel, install Windows certificates or change firewall
rules. If Windows asks about firewall access, allow only your trusted private
network. Do not change the backend to `0.0.0.0` or forward these ports on a router.

## One-time setup on the iPhone

The phone must trust the temporary test certificate so Safari sees a secure HTTPS
origin and can request microphone access. This requires actions on the phone;
the PC cannot complete them for you.

1. Open **Safari** and the `http://YOUR-PC-IP:3444/` setup URL printed in the terminal.
2. Download the **Parallel Worlds Phone Test** certificate profile.
3. In **Settings → Profile Downloaded**, or **General → VPN & Device Management**,
   inspect the profile and its certificate. Compare the certificate's SHA-256
   fingerprint with the PC terminal, then install it yourself.
4. In **Settings → General → About → Certificate Trust Settings**, enable full
   trust for **Parallel Worlds Phone Test Root** yourself.
5. Return to the setup page and open the HTTPS app link. Enter the pairing code
   printed in the PC terminal. It opens Alex's profile.
6. Tap **Parallel Worlds**, then the microphone and allow Safari microphone access.
   You speak first. Use headphones to test interruptions. Optionally choose
   **Share → Add to Home Screen** for a standalone launcher.

Installing a root enables trust for certificates signed by that authority. This
helper creates a dedicated root lasting 14 days and a server certificate lasting
7 days. The root signing key is discarded immediately and is never installed on
Windows or stored on disk. The server's private key stays in ignored
`data/phone-test/phone.pfx`; do not share it. The downloadable profile contains
only the public root certificate. Do not continue past certificate warnings:
complete the profile trust setup or stop and inspect the fingerprint.

After testing, remove **Parallel Worlds Phone Test** in **Settings → General →
VPN & Device Management**. Stop `pnpm phone` with Ctrl+C to close phone access.
Restarting the gateway changes the pairing code and invalidates its old pairing
sessions. Certificates can be reused until renewal; a changed IP or expired
certificate requires installing/trusting the new profile and removing the old one.

## What to test

Alex's profile now uses the female portrait from the existing `maya.jpg` asset;
the displayed character remains Alex. The imported originals stay unchanged.
This presentation correction does not change the scenario hash, checkpoint
identity or Higgs voice configuration.

Test **profile → Parallel Worlds → multiple spoken turns → timeline suggestion →
rewind → alternative speech → Evaluate → original/alternative comparison**.
Check interruption during generation and queued playback, then disconnect/reconnect.
Keep the PC awake, both terminal processes running and Safari in the foreground.

The iPhone's device cookie creates its own saved dates; desktop browser dates are
not automatically transferred. Keep using the same IP/hostname and browser mode.
Home Screen and Safari storage behavior must be checked on the actual device.
No API key is embedded in the frontend or profile. The gateway validates the exact
host/origin and pairing cookie before forwarding requests, preserves server device
ownership/idempotency, and marks device cookies Secure on HTTPS responses.

## Troubleshooting and validation limits

| Symptom | Action |
| --- | --- |
| Setup URL cannot open | Check same Wi-Fi, selected IP, private-network firewall access and network client isolation. A phone's `127.0.0.1` refers to the phone. |
| Certificate warning or no microphone prompt | Verify the fingerprint, profile installation and full trust; use the exact HTTPS IP URL. HTTP on a LAN address cannot provide the required microphone secure context. |
| Pairing requested again | Enter the new PC code. Gateway restart clears sessions; access expires after eight hours. |
| Backend unavailable | Keep `pnpm start` running on port 3000. Rebuild after frontend changes. |
| Mic permission denied | Check Safari's website microphone permission and the iPhone input route, then tap the mic again. |
| App changes after backgrounding | Mobile browsers may suspend audio/networking. Return to the foreground and reconnect from saved server history if necessary. |
| Another phone cannot see dates | Device ownership is intentionally isolated. IDs alone do not grant access. |

Automated gateway tests verify pairing, host/origin rejection, Secure cookies,
expiry/rate limits, actual Phase 3 HTTP ownership/idempotency, and the restricted
certificate port. The existing automated voice journey still uses synthetic voice
events. Local TLS checks verify a trusted certificate connection and gateway API
traffic. An actual iPhone microphone, speaker, permissions and Home Screen install
can only be validated on the physical phone; successful setup is not proof of a
completed spoken conversation.

Verification on 2026-10-24: **318 tests passed across 28 files**; type checking and
production build passed. A live local gateway check used the generated CA with
normal certificate validation and verified trusted TLS, pairing, protected API
access, Secure device cookies, built frontend/portrait/manifest delivery and the
public-only certificate port. No certificate-validation bypass was used. The
updated portrait was checked in the browser. Actual iPhone audio and Home Screen
installation remain pending the steps above.

References: [Apple: trust manually installed certificate profiles](https://support.apple.com/en-us/102390),
[MDN: microphone secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[MDN: installable web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
