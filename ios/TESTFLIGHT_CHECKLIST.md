# TestFlight Pre-Release Checklist

## Summary AI iOS App - v1.0.0

Before submitting to TestFlight, verify each item below. Check the box when complete.

---

## 1. Recording Behavior

### Basic Recording
- [ ] Tap record button starts recording immediately
- [ ] Timer increments correctly during recording
- [ ] Audio level indicator responds to voice input
- [ ] Pause/resume recording works correctly
- [ ] Stop recording saves file successfully
- [ ] Cancel recording discards file properly
- [ ] Recording title can be set before/during recording

### Microphone Permission
- [ ] Permission dialog appears on first recording attempt
- [ ] Denied permission shows appropriate error message
- [ ] Settings link opens iOS Settings to enable permission
- [ ] Recording button disabled when permission denied

---

## 2. Background Recording

### Screen Lock Behavior
- [ ] Recording continues when screen locks (auto-lock or power button)
- [ ] Timer continues accurately during lock
- [ ] Audio continues recording while locked
- [ ] Unlock shows correct recording state
- [ ] Control Center shows recording indicator (if applicable)

### App Backgrounding
- [ ] Recording continues when switching to another app
- [ ] Recording survives brief interruptions (notifications)
- [ ] Recording pauses gracefully during phone calls
- [ ] Recording resumes (or stays paused) after call ends
- [ ] No audio glitches on interrupt/resume

### Audio Session Interruptions
- [ ] Phone call interruption pauses recording
- [ ] Siri activation pauses recording
- [ ] Alarm/timer interruption handled gracefully
- [ ] Music/podcast playback from other apps handled

---

## 3. Long Recordings

### Duration Tests
- [ ] Record for 5 minutes - verify timer accuracy
- [ ] Record for 30 minutes - verify stability
- [ ] Record for 60+ minutes - verify no memory issues
- [ ] Very long recording (2+ hours) - verify file saves correctly

### Resource Management
- [ ] Memory usage stays reasonable during long recordings
- [ ] Battery drain is acceptable
- [ ] Device doesn't overheat
- [ ] File size is proportional to duration (~1MB per minute for AAC)

### Large File Handling
- [ ] Large file (100MB+) displays progress during upload
- [ ] Upload progress is accurate
- [ ] App remains responsive during large uploads

---

## 4. Failed Uploads

### Network Errors
- [ ] Upload fails gracefully on no network
- [ ] Error message clearly indicates network issue
- [ ] Local recording file preserved for retry
- [ ] Retry button works after reconnecting
- [ ] Partial upload doesn't corrupt state

### Server Errors
- [ ] 500 server error shows user-friendly message
- [ ] 401 unauthorized triggers re-authentication
- [ ] 413 payload too large shows size limit message
- [ ] Timeout handled with retry option

### Recovery
- [ ] App restart preserves pending uploads (if implemented)
- [ ] Manual retry from recordings list works
- [ ] Failed recording shown with error indicator
- [ ] Clear error state possible

---

## 5. Failed Transcription

### Processing Failures
- [ ] "Failed" status shown clearly in recordings list
- [ ] Error message displayed in detail view
- [ ] Retry option available (if implemented)
- [ ] Other recordings unaffected

### Partial Failures
- [ ] Transcript available even if summary fails
- [ ] Q&A works with transcript even without summary
- [ ] Graceful handling of missing data

### Edge Cases
- [ ] Empty/silent recording handled
- [ ] Non-speech audio handled (music, noise)
- [ ] Unsupported language shows clear error

---

## 6. Q&A Correctness Sanity Checks

### Answer Quality
- [ ] Simple factual question returns correct answer
- [ ] Question about specific topic finds relevant segments
- [ ] "Who said..." questions identify speakers correctly
- [ ] "When was...discussed" finds correct timestamps

### Citations
- [ ] Citations link to correct transcript segments
- [ ] Tapping citation navigates to transcript tab
- [ ] Citation text matches actual transcript

### Edge Cases
- [ ] Question about content not in transcript says "not found"
- [ ] Very long question handled gracefully
- [ ] Special characters in question don't break
- [ ] Empty question prevented by UI

### Response Times
- [ ] Simple questions respond in <5 seconds
- [ ] Complex questions respond in <15 seconds
- [ ] Loading indicator shown during processing

---

## 7. Search Functionality

### Basic Search
- [ ] Search finds recordings by title
- [ ] Search finds content in transcripts
- [ ] Multiple keyword search works (AND logic)
- [ ] Case-insensitive search
- [ ] Recent searches saved and displayed

### Results
- [ ] Results show matching recordings
- [ ] Match count displayed
- [ ] Matching segments highlighted
- [ ] Tap result navigates to detail view

---

## 8. Export Functionality

### Export Formats
- [ ] Plain text export generates .txt file
- [ ] Markdown export generates .md file
- [ ] PDF export generates properly formatted PDF

### Share Sheet
- [ ] Share sheet appears with export options
- [ ] File can be saved to Files
- [ ] File can be shared via Messages/Mail
- [ ] AirDrop works

### Content Options
- [ ] Summary-only export works
- [ ] Full transcript export works
- [ ] Selective content (key points, action items) works

---

## 9. Authentication

### Sign In
- [ ] Sign in with Apple works
- [ ] Email/password sign in works
- [ ] Sign up creates new account
- [ ] Session persists across app restarts
- [ ] Invalid credentials show error

### Sign Out
- [ ] Sign out clears session
- [ ] Sign out navigates to login screen
- [ ] Local data cleared appropriately

### Session Management
- [ ] Expired token refreshes automatically
- [ ] Network error during auth handled
- [ ] Multiple devices handled (if applicable)

---

## 10. UI/UX Polish

### Visual
- [ ] App icon displays correctly
- [ ] Launch screen appears during startup
- [ ] Dark mode supported
- [ ] Dynamic type (accessibility) respected
- [ ] No layout issues on different iPhone sizes

### Navigation
- [ ] Tab bar navigation works correctly
- [ ] Back buttons work in all flows
- [ ] Swipe to go back works
- [ ] Pull-to-refresh works on lists

### Performance
- [ ] App launches in <2 seconds
- [ ] Scrolling is smooth (60fps)
- [ ] Transitions are smooth
- [ ] No visible loading jank

---

## 11. Settings & Legal

### Settings Screen
- [ ] Account email displayed correctly
- [ ] Sign out works from settings
- [ ] Privacy Policy link opens in browser/Safari
- [ ] Terms of Service link opens
- [ ] Consent reminder text visible

### Privacy
- [ ] NSMicrophoneUsageDescription in Info.plist
- [ ] App Transport Security configured
- [ ] No sensitive data logged in production

---

## 12. Build Configuration

### Info.plist
- [ ] Bundle ID is correct (com.summaryai.app)
- [ ] Version number set correctly
- [ ] Build number incremented
- [ ] Required device capabilities set
- [ ] Background modes configured (audio)

### Signing
- [ ] App signed with distribution certificate
- [ ] Provisioning profile includes TestFlight devices
- [ ] Entitlements configured correctly

### Dependencies
- [ ] All dependencies resolved
- [ ] No debug flags in release build
- [ ] API endpoints point to production

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| QA Lead | | | |
| Product Owner | | | |

---

## Notes

### Known Issues
_List any known issues that are acceptable for this release:_
1.
2.
3.

### Deferred Items
_List features intentionally deferred to future releases:_
1. Offline mode for cached recordings
2. Advanced search with filters
3. Audio playback with transcript sync
4. Real-time transcription preview

---

## Remaining TODOs Before Production

### Security
- [ ] Move tokens from UserDefaults to Keychain
- [ ] Implement certificate pinning for API calls
- [ ] Add jailbreak detection (optional)
- [ ] Audit for sensitive data exposure

### Backend Integration
- [ ] Verify Supabase production credentials
- [ ] Test with production API endpoints
- [ ] Verify rate limiting behavior
- [ ] Test webhook/push notification delivery

### App Store
- [ ] Privacy Nutrition Labels prepared
- [ ] App Store screenshots (all sizes)
- [ ] App Store description finalized
- [ ] Review guidelines compliance check

### Legal
- [ ] Privacy Policy URL live
- [ ] Terms of Service URL live
- [ ] GDPR compliance verified
- [ ] Recording consent language reviewed by legal
