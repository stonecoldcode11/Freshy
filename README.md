# Freshy

A campus errand marketplace for Lake Forest Academy. Students post small tasks —
tutoring, food grabs, emergency runs — and approved students ("freshys") get
assigned to fulfill them.

## Running it

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## How it works today

**Roles**
- **Customer** — anyone with a profile. Posts orders, pays, tips, confirms delivery.
- **Freshy** — interviewed and approved by the owner, then unlocked with a
  one-time 4-digit code. Gets assigned orders matching their categories.
- **Owner** — you. Claims the console once with a PIN, then issues codes, monitors
  the freshy roster, and reviews reports.

**Order flow**
1. Customer fills out a slip: what, category, where, when (8:00 AM–7:30 PM), and
   for tutoring, subject + their class level.
2. Checkout runs card validation, then checks a qualified freshy exists. No match
   means no charge.
3. Order is assigned to the freshy with the lightest load who takes that category
   (and for tutoring, is at or above the student's level).
4. Freshy accepts or passes. Passing reassigns to the next eligible freshy.
5. Freshy marks delivered → customer tips and confirms → payout splits.

**Pricing** (in `CATEGORIES` at the top of `src/App.jsx`)
- Food Grab — $5 flat
- Emergency Run — $7 flat
- Tutoring — $16/hr

**Split** — freshy gets 60% of the order price plus 100% of the tip; owner gets 40%
of the order price. See `FRESHY_SHARE` / `OWNER_SHARE`.

## Things worth knowing before this goes live

These are real gaps, not nitpicks. Roughly in priority order:

1. **Payments aren't real.** The card form validates format (Luhn check, expiry,
   CVC, ZIP) but charges nothing. You need Stripe Connect — it handles the
   60/40 split automatically and keeps card numbers off your servers entirely.
   This requires a backend; the card fields must never live in client code in
   production. Note that Stripe requires the account holder to be 18+.

2. **There's no real backend.** Everything lives in browser storage. Two people on
   two phones won't see the same board once this leaves the Claude artifact. This
   is the single biggest blocker to actually using it. Supabase is probably the
   fastest path — it gives you a database, auth, and realtime updates.

3. **Auth is honor-system.** Anyone can type any name. The owner PIN sits in the
   source, so anyone who opens devtools can read it. Real accounts (school email
   login) fix both.

4. **Moderation is basic.** The profanity filter in `BLOCKED_WORDS` catches common
   swears and simple letter substitutions. It does not meaningfully cover slurs —
   use a maintained moderation library or API before real students use this.

5. **Talk to the school first.** Student-to-student payments, sharing student
   contact info, and the LFA logo all involve the school. Get that conversation
   done before launch, not after.

6. **Serious reports need an adult.** Harassment and safety reports surface a
   notice telling the reporter to tell a teacher or counselor. Keep that. You
   shouldn't be the only person holding a report like that.

## Where things live in `src/App.jsx`

| What | Constant / function |
|---|---|
| Owner PIN | `OWNER_PIN` |
| School logo (base64) | `LOGO_URL` |
| Contact for applicants | `OWNER_EMAIL`, `OWNER_PHONE` |
| Order hours | `OPEN_TIME`, `CLOSE_TIME` |
| Prices per category | `CATEGORIES` |
| Payout split | `FRESHY_SHARE`, `OWNER_SHARE` |
| Tutoring subjects + ladders | `SUBJECTS` |
| Profanity list | `BLOCKED_WORDS` |
| Report reasons | `REPORT_REASONS`, `SERIOUS_REASONS` |
| Assignment logic | `nextFreshy`, `qualifies` |
| Background doodles | `Doodles` component |

`src/storage.js` is a localStorage shim standing in for the artifact's storage
API. Swapping it for a real backend is a self-contained change — nothing in
`App.jsx` needs to move.

## Suggested next steps

`App.jsx` is one 2,300-line file. First thing to do in Claude Code is split it —
`components/`, `lib/storage.js`, `lib/pricing.js`, `lib/assignment.js`. Ask Claude
Code to do the split before adding features; it'll make everything after easier.
