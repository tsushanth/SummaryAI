# MeetingMind phone calls: design (2026-11-26)

Call from the Android app showing your own number; the call is recorded, transcribed and summarised like any recording.
United States and Canada first. Calling is **off** for everyone until the owner switches it on.

## Phases
1. **Own number, outbound** (this document's detail; built): verify your number, call, record, spend control.
2. **Numbers**: a small shared pool per country; a personal number bought through a Google Play subscription that the
   server verifies; incoming calls. Purchase stays off until price and amounts are approved (server configuration).
3. **Agent**: describe in one prompt what a Calldesk agent should do on your calls; call list with transcripts and results.

## Phase 1

### Flow
- `GET /v1/api/phone/status` decides whether the app shows the Phone tab (per account).
- Verification: `POST /verify/start` books the attempt, then asks the carrier to ring the number. The app shows a code,
  the person types it on the keypad, a signed callback registers the number as a verified outgoing caller ID. The server
  neither stores nor logs the code. One verified number has one owner.
- Call: the app shows a consent screen (every call), then `POST /calls`. The server checks account, number, destination
  and limits, reserves the worst-case cost and the time limit, and returns a 2-minute token for that one call.
- The carrier asks our webhook what to do. The reservation is claimed once; number dialled, caller ID and time limit come
  from the server's records, never from the app. Anything unexpected rejects the call.
- Recording notice: spoken to the app user before dialling and to the called person after they answer, before the two are
  connected. If it cannot be recorded that the called person was told, the call is ended; audio of a call without that
  mark is deleted unheard. The words are in one constant, `RECORDING_NOTICE` (`backend/src/phone/constants.ts`).
  **The wording is a proposal ("This call is being recorded.", with Spanish and French versions followed by English) and
  is not approved yet.**
- Recording: saved to our storage as a normal recording (`source = phone_call`, type meeting), transcribed and summarised
  by the existing pipeline, then deleted at the carrier. A sweeper (every minute) repairs lost callbacks.

### Separate calls subaccount
Calls, verified numbers, recordings and spend of this feature live in their own carrier subaccount, with dialing allowed
to the United States and Canada only and the carrier's own monthly usage alarm pointing at `/usage-alarm` (which halts
calling for the month).

### Numbers allowed
E.164 typed with the country code (never added silently); in-service geographic area codes of the United States and
Canada from the numbering plan administrator's list. Refused: every other +1 destination, Alaska 907, northern Canada
867, toll-free, premium and other special ranges.

### Spend control (migration 032)
- `phone_ledger` plus SQL functions; one advisory lock serialises every decision. No reservation, no call.
- A hard cap per UTC calendar month on company money in total (verification calls, calls, recording, transcription,
  summaries); 30 free minutes per user and per own number per month; calls of at most 30 minutes; one call at a time.
- A call's time limit is the smallest of the user's minutes left, what the month can still pay, and the maximum.
- Rate limits on verification attempts (per user, per number, overall, with their own share of the cap) and on calls
  (per user, per destination, overall). All limits are in `phone_limits()`; changing one needs a migration.
- Settlement replaces the reservation with the real durations read from the carrier; if the carrier cannot be asked,
  the whole reservation stays booked.

### Switches (all off in production)
| Setting | Effect |
|---|---|
| `FEATURE_PHONE_CALLS=1` | on for every signed-in user |
| `PHONE_CALLS_TESTER_IDS` | on for the listed account ids only |
| `PHONE_TWILIO_ACCOUNT_SID`, `PHONE_TWILIO_AUTH_TOKEN`, `PHONE_TWILIO_API_KEY_SID`, `PHONE_TWILIO_API_KEY_SECRET`, `PHONE_TWILIO_TWIML_APP_SID`, `PHONE_NUMBER_HASH_KEY` | required for either switch to do anything |

The web phone pages stay hidden (their own flag). iOS is out of scope.

### Android
Permissions used by calling (all already declared by the app): `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, plus what the calling SDK's own manifest
already merged. None added; the old phone-only permissions stay removed. The screen says emergency calls are not possible.

### Measurement
`activation_events`, name `phone_step` (server written): tab opened, number requested, consent shown or declined,
verification started / ok / failed with reason, call started / refused / connected / ended / recorded / discarded /
transcribed / failed, cap hit, answer to "Is this for a business?" (skippable, with optional type). Test accounts and
test devices are marked. `phone_funnel(since)` splits by business answer and country and counts week-2 repeat use.
Failures raise `phone_calls` alerts. No number, name or code is stored in events or alerts.

### Languages
- App strings: all 31 app languages (translations not yet reviewed by native speakers).
- Recording notice: English, Spanish, French (proposed wording). Verification call: English only (carrier limit).
- Transcription: the existing pipeline detects the language. Verification status per language is recorded in the release
  notes (`docs/DEPLOYED.md`).

### Not covered by phase 1
Incoming calls; web or iOS calling; countries other than the United States and Canada; a live-call test of the Android
app (needs a person with a phone).

## Phase 2 (planned)
- Numbers are bought only in countries where the carrier sells them without extra registration (United States, Canada).
- **Shared pool numbers cannot take incoming calls for everyone.** A return call is routed by the pair (pool number,
  caller): when a user calls someone from a pool number, that pair is assigned to the user, and a database uniqueness rule
  means no other user can be given the same pair while it is active (another pool number is chosen instead, or the call is
  refused). A return call is forwarded to the user's verified phone with the recording notice. An unknown caller hears
  that the number cannot take the call. No agent on pool numbers.
- **Personal numbers**: one per subscriber, bought when a Google Play subscription is verified on the server, released
  after it ends. Subscription money pays only that user's number and included minutes, which stop when used up. Price and
  amounts are server configuration; purchase is off until approved.
- The company cap covers pool numbers and all free usage.

## Phase 3 (planned)
- One prompt creates a Calldesk agent through a server-to-server partner API; no setup, no extra abilities.
- Telephony, recording, the notice and the ledger stay in MeetingMind; the agent joins a call as a media stream.
- Inbound agents on personal numbers only. Outbound agent calls stay off until the owner decides.
- Call list shows transcript, summary and outcome as Calldesk reports them; agent minutes are reserved in the same ledger.
