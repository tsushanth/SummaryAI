# Google Play listing drafts, 26 November 2026

Folder `A/` was approved by the owner and published to the default listing (short and full description, all 21 locales; titles unchanged) on 27 November 2026 at 10:48 PT, and read back identical. `B/` and `B-optional/` are not published. The Fastfile does not upload listing text.

| Folder | What it is | When it may be published |
|---|---|---|
| `A/<locale>/` | True on 26 November 2026. No phone calling claims. Describes multilingual support. | After approval |
| `B/<locale>/` | A plus calling to United States and Canada numbers. | Only when the phone release has reached all users and every B check below has passed |
| `B-optional/<locale>/` | B plus a paid own number, a phone agent, or both. | Not now. Neither feature can be bought or set up in the code read on 26 November |

21 locales, the same set Play served on 26 November: ar, de-DE, en-US, es-ES, fil, fr-FR, hi-IN, id, it-IT, ja-JP, ko-KR, ms, nl-NL, pl-PL, pt-BR, pt-PT, ru-RU, th, tr-TR, vi, zh-CN. Titles are the ones live on that day.

## What A claims, and why

| Claim | Basis | Still open |
|---|---|---|
| Transcripts in 30 languages | Auto-detect speech-to-text (`backend/src/services/stt/`). The provider documents 33 languages for detection. A synthetic-voice test with the production request returned the right language and a transcript for the 30 listed. Test speech is not real meeting audio | Estonian and Latvian are documented but were not tested. Romanian was tested and detected as another language, so it is left out. Hebrew, Croatian, Arabic, Filipino and Cantonese are not detected |
| One main language per recording | Provider behaviour for detection | None |
| Language can be chosen for online meetings | Join Meeting screen (Android) and web | None |
| Summaries in the recording's language; 1 of 15 can be chosen on the web | Server release v70 (26 November): with no language chosen the prompt names the detected language; checked with made-up transcripts in 11 cases. Stored summaries are unchanged | Not checked with a real device recording in each language |
| 15 summary languages on the web app | `web/src/lib/outputLanguages.ts`. The Android app has no summary language setting | None |
| App in 27 languages | 30 resource sets, no missing strings at tags `play/1.7.13-66` and `play/1.7.15-68`. Chinese has Simplified and Traditional, Portuguese has Brazil and Portugal | A few hard-coded English strings remain (`android/app/hardcoded-ui-strings.baseline.json`) |
| Speaker labels and renaming, search, questions, web upload | Code at the production tags | None |
| Meeting bot for Zoom, Google Meet and Microsoft Teams | `backend/src/services/recallService.ts` | Run one real Microsoft Teams meeting, or drop Teams |
| Free, no card and no subscription; AI Coach uses credits | `backend/src/services/freeTier.ts` | None |

## What must be checked before B is published

The calling code was still being written when these drafts were made. Check each line against the released build.

| Id | Claim in B | Check |
|---|---|---|
| V1 | Calling is available (all of B) | The release is at 100 percent on production and calling is on for every account |
| V2 | Call United States and Canada numbers from the app | A real call to each country from a Play-installed build |
| V3 | Verify your own US or Canada number once; people you call see it | Verification passes and the called phone shows the number |
| V4 | Both people hear a recording notice before being connected | Notice wording approved; heard on both phones; no recording is kept without it |
| V5 | Recording, transcript and summary after the call | Real calls in English and at least one other language; phone audio quality has not been tested |
| V6 | Up to 30 free minutes a month, 30 minutes per call, monthly limit shared by all users | The released limits match, including what a user sees when either limit is reached |
| V7 | Outgoing calls only, over the internet, no emergency calls | Confirm incoming calls are off and emergency numbers are refused |
| V8 | Toll-free, premium, special-rate numbers, Alaska, Canadian territories and US territories not supported | Matches the released number rules (`backend/src/phone/`) |
| V9 | Free, no card and no subscription | Nothing in the calling release can be bought |
| V10 | No sign-in condition is stated | The code asks for an email, Google or Apple account. If other account types exist, add this to the text |
| V11 | Store compliance | Permission and foreground service declarations, Data safety form and privacy policy cover phone numbers and call audio |
| V12 | Screenshots agree with the text | Update screenshots and check the in-app calling screens in the listed languages |
| N1 | Own number (optional) | Buyable through Play, price shown, what incoming calls do. If it renews, the text must not say there is no subscription |
| G1 | Phone agent from one prompt (optional) | Works from one prompt for a normal user; direction of calls, cost and limits known, and any needed wording added |

## Translations

All new sentences in the 20 non-English locales are machine written and have had no native review. Unchanged bullets are copied from the live listing. Language names come from standard locale data. Check first: ar and fil (they say speech in that language is not transcribed), the calling section of B (it states limits and exclusions), ja-JP, ko-KR, th and hi-IN.

## Publishing

1. Get approval of the English text.
2. Pause any automated listing job for this app that could overwrite or restore the text.
3. Update title, short description and full description for all 21 locales in one edit.
4. Read every locale back and compare it with these files.
5. Refresh `android/fastlane/metadata/android/` from the live listing (it holds only 10 of the 21 locales and still mentions phone calls).
