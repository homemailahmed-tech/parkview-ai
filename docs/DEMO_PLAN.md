# Demo plan & roadmap

## 3-minute demo script (phone-sized screen)

1. **Overview** — fictional Parkside Demo Guest House; point out the AI badge (*Simulation* or the configured Meta route), the AI provider panel, and the Staff/Owner switch.
2. **Enquiries → Lindiwe** (church choir, 14 adults, 4 couples, driver, wheelchair user).
   *Read with AI* → dates and guest parties appear; edit anything if needed.
3. **Find room options** → Option A (most efficient) vs Option B (more privacy). Show bed plans, wheelchair → Room 1, driver alone,
   and the deterministic comparison. *Explain options* for the AI explanation.
4. **Use Option A** → quote with room-based lines, 5% group discount, deposit. *Personalise greeting*, *Copy* for WhatsApp.
5. **Submit for owner approval** → note *Approve* is disabled for staff. Switch to **Owner** → approve.
6. *Mark as sent* → *Guest accepted* → *Request deposit* → note *Confirm* is disabled → *Record simulated deposit* → *Confirm booking*.
7. **Rooms** → the booking now blocks the availability grid.
8. **Smart Maps** → "What can we do with children near the hotel?" and "Find Halaal food near our accommodation":
   markers, directions, *Take me back to my accommodation*, arrival & parking, and the honest caveats (sample data, Halaal unverified,
   no invented travel times).

## Roadmap

| Status | Item |
| --- | --- |
| ✅ Mission 1 | Dashboard, inventory, inbox, allocation engine, quotation builder, owner workflow, demo mode, tests |
| ✅ Mission 1 addendum | Smart Maps & concierge with sample data; Google Places/Routes prepared behind a billing gate |
| ✅ Mission 2 | Meta Model API (Muse Spark 1.3) + open-weight provider support, failure handling, spend cap, Smart Maps failure handling |
| ✅ Mission 3 | Secure phone demo prep: demo access code, owner login, rate limits, security headers, Android checks, Vercel Hobby plan (awaiting owner approval to deploy) |
| ✅ 1 Nov 2026 | Live Meta Model API: enquiry interpretation verified with `muse-spark-1.3` (2 requests, docs/LIVE_META_VERIFICATION.md); head-count guard and booking-safeguard tests added |
| ⏳ Not yet live | Option explanations, greeting and concierge via Meta (same client; mocked tests only) |
| ⏳ Needs owner approval | Google Maps Platform billing (Places + Routes) for live places, opening hours and travel times |
| Next | Verified Halaal data source (e.g. certifying-body listings) — never infer certification |
| Next | Live events feed; multilingual guest replies (Meta model); guest-facing concierge page/QR code |
| Later | WhatsApp Business API, real payment links, multi-property support (SmartMap is already property-agnostic) |
