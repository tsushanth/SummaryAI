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
| `FEATURE_PHONE_CALLS=1` | on for signed-in users the country rule below allows |
| `PHONE_CALLS_TESTER_IDS` | on for the listed account ids, in any country |
| `PHONE_COUNTRIES` | countries the feature is shown in; default `US,CA` (does not enable anything by itself) |
| `PHONE_TWILIO_ACCOUNT_SID`, `PHONE_TWILIO_AUTH_TOKEN`, `PHONE_TWILIO_API_KEY_SID`, `PHONE_TWILIO_API_KEY_SECRET`, `PHONE_TWILIO_TWIML_APP_SID`, `PHONE_NUMBER_HASH_KEY` | required for either switch to do anything |

The web phone pages stay hidden (their own flag). iOS is out of scope.

### Who is shown the feature (`backend/src/phone/availability.ts`)
The server decides on every `/api/phone` request, in this order:

1. Neither switch covers the account: hidden.
2. Tester account: shown.
3. The request carries no country (every released app version up to 1.7.15, and the web): hidden.
4. SIM country or network country is in `PHONE_COUNTRIES`: shown. The device region counts only when the app has
   neither.
5. The account has a verified number: shown, also abroad.

The app sends two-letter codes as headers (`x-mm-sim-country`, `x-mm-network-country`, `x-mm-device-region`, and
`x-mm-test` from test devices), read with no permission. Hidden answers are the same as with the switch off:
`/status` says `enabled: false` (the app then shows no tab and no other mention), the two lists that versions up to
1.7.13 load are empty pages, everything else is 404 `FEATURE_DISABLED`. No answer asks anyone to update; the endpoints
only old versions use answer `FEATURE_DISABLED` for everyone. Versions up to 1.7.13 draw their old Phone tab whatever
the server says. Removing a verified number and ending a trial work even while hidden.

`PHONE_COUNTRIES` changes with a server setting (the machine restarts), without an app release. It only changes what
is shown: the countries come from the device and can be forged, and which numbers can be verified, called or bought is
enforced by the number rules and the carrier settings, which stay United States and Canada. Adding a country to the list
shows the screens there but allows no number of that country.

### Android
Permissions used by calling (all already declared by the app): `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, plus what the calling SDK's own manifest
already merged. None added; the old phone-only permissions stay removed. The screen says emergency calls are not possible.

### Measurement
`activation_events`, name `phone_step` (server written): tab opened, number requested, consent shown or declined,
verification started / ok / failed with reason, call started / refused / connected / ended / recorded / discarded /
transcribed / failed, cap hit, answer to "Is this for a business?" (skippable, with optional type). Test accounts and
test devices are marked. `phone_funnel(since)` splits by business answer and country and counts week-2 repeat use.
Since migration 035 both counts include only accounts that were shown the feature (step `feature_seen`, written by the
server at most about once a day per account and country), split by the country that showed it: the supported SIM,
network or region country, or for a verified account abroad the first one sent. `phone_funnel` adds `could_see`.
Failures raise `phone_calls` alerts. No number, name or code is stored in events or alerts.

### Languages
- App strings: all 31 app languages (translations not yet reviewed by native speakers).
- Recording notice: English, Spanish, French (proposed wording). Verification call: English only (carrier limit).
- Transcription: the existing pipeline detects the language. Verification status per language is recorded in the release
  notes (`docs/DEPLOYED.md`).

### Not covered by phase 1
Incoming calls; web or iOS calling; countries other than the United States and Canada; a live-call test of the Android
app (needs a person with a phone).

## Phase 2: numbers (server and Android screens built, switched off)
Migration 033. Nothing here works until `PHONE_NUMBERS_SCHEMA=1`; nothing can be bought until `PHONE_PURCHASE_ENABLED=1`
and `PHONE_PLAN_PRODUCT_ID` names a Google Play subscription. Price and included minutes are server settings
(`PHONE_PLAN_*`, bounded in code and in the database).
- Numbers are bought only where the carrier sells them without extra registration (United States, Canada), local numbers
  with no address requirement. A month is booked in the ledger before a number is bought.
- **Shared pool numbers cannot take incoming calls for everyone.** A return call is routed by the pair (our number,
  caller): calling someone from a shared number ties that pair to the user for 30 days, and the database allows one owner
  per pair (another shared number is chosen, or the call is refused). A return call is forwarded to the user's verified
  phone with the notice to both. Anyone else is rejected without being answered. No agent on shared numbers.
  Shared numbers are added only by an owner action (`POST /v1/internal/phone/shared-number`, secret header), at most 4.
- **Personal numbers**: one per account, after the server has confirmed the subscription with Google Play (token bound to
  one account). Subscription money pays that user's number and included minutes, which stop when used up; it never counts
  against the company cap. Rechecked every few hours; the number is released 3 days after the paid time ends.
- The company cap covers shared numbers and all free usage.

## Phase 3: agent from one prompt (server and Android screens built, switched off)
Needs the `CALLDESK_PARTNER_*` settings and the partner API to be deployed on the Calldesk side.
- `PUT /v1/api/phone/agent` takes one description (10 to 2000 characters) and a language; the agent is attached to the
  user's personal number. Each change is booked in the ledger first, a few per day.
- An incoming call on that number: the notice is spoken, recording starts, then the agent joins as a media stream with a
  one-time token and a time limit. If the agent cannot take the call it is forwarded to the user's phone.
- Telephony, recording, the notice and the ledger stay in MeetingMind. Results arrive on a signed webhook (and are
  fetched if lost); `GET /calls/:id` returns summary, outcome, transcript and the collected details as reported.
  Collected details are kept as at most 40 name and value pairs.
- `GET /v1/api/phone/agent` returns the current description so that it can be edited.
- Inbound only. Outbound agent calls are not built.
- Account deletion releases the number, deletes the agent and its data at Calldesk, and keeps only unlinked ledger rows.

## Free trial of an own number with an agent (migration 034; off)
`PHONE_AGENT_TRIAL=1` switches it on. It also needs `PHONE_NUMBERS_SCHEMA=1`, the `CALLDESK_PARTNER_*` settings and phone
calls for the account. The setting only switches: the limits are in the database function `phone_trial_limits()`.

| Limit | Value |
|---|---|
| Trials open at once / started per calendar month | 5 / 5 |
| Own numbers held at once, paid ones included | 5 |
| Agent time per trial | 15 minutes, in started minutes |
| Length | 14 days |
| Agent creations and changes per trial | 6 |
| Trials per account and per verified phone number | 1 |

- All trial spend (number rent, agent changes, agent time, forwarded calls) is company money inside the monthly cap; a
  trial cannot start, and a number is not kept into a new month, without room in it.
- A number is bought only on `POST /number` with `confirm_trial: true`, sent after the person confirms the trial screen.
  A purchase that fails does not use up the trial.
- A trial number behaves like a paid one: the agent answers, calls it cannot take ring the verified phone and calls can
  show the number; both of those use the free call minutes.
- It ends after 14 days, when the agent time is used, when the person ends it (`DELETE /number`), when the setting is
  switched off, or when the month's rent no longer fits the cap. The number and the agent are then released (checked
  every 10 minutes, after any call under way and its result). A failed release is repeated and alerted.
- A subscription bought during a trial keeps the number.
- Account deletion keeps an unlinked trial record (a keyed hash of the number), so the one-per-number rule holds.

## Android: own number, agent and results
A third tab on the Phone screen, shown only when `GET /status` answers `own_number: true`: get a number (country, optional
area code, trial confirmation), describe the agent and pick its language, edit or delete it, see the time left, end the
trial. Calls an agent took open a sheet with summary, collected details, transcript and recording. Purchase appears only
when `GET /plan` has `purchase_enabled`, a product id starting with `mm_phone_` and Google Play returns its price; those
purchases are confirmed and acknowledged by the server and never unlock MM Pro.

## Measurement of these steps
`phone_step` events (counts only; never a number or typed text): screen opened, confirmation shown or declined, trial
started / refused / ended, number added / failed / released, agent form opened, agent created / updated / removed /
failed, agent result stored, result opened, purchase started / completed / failed. Owner reads:
`GET /v1/internal/phone/funnel` and `/v1/internal/phone/steps` (secret header).

## Not built yet
Google Play product; real-time developer notifications (subscriptions are polled); outbound agent calls; a live test of
any incoming call or agent.
